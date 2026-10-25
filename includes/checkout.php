<?php
declare(strict_types=1);

const CHECKOUT_PAYMENT_SECONDS = 300;
const CHECKOUT_MAX_FAILURES = 3;

final class CheckoutError extends RuntimeException
{
    public function __construct(string $message, public readonly string $apiCode = 'CHECKOUT_CONFLICT', public readonly int $httpStatus = 409)
    {
        parent::__construct($message);
    }
}

function checkout_session_id(mixed $value): string
{
    if (!is_string($value) || !preg_match('/^[A-Za-z0-9_-]{1,50}$/D', $value)) {
        throw new CheckoutError('Valid session_id is required.', 'INVALID_SESSION', 422);
    }
    return $value;
}

function checkout_epcs(mixed $input, bool $allowEmpty = false): array
{
    if (!is_array($input) || (!$allowEmpty && !$input) || count($input) > 100) {
        throw new CheckoutError('Provide ' . ($allowEmpty ? '0' : '1') . ' to 100 EPCs.', 'INVALID_EPCS', 422);
    }
    $unique = [];
    foreach ($input as $value) {
        if (!is_string($value)) throw new CheckoutError('Every EPC must be a string.', 'INVALID_EPCS', 422);
        $epc = strtoupper(preg_replace('/\s+/', '', trim($value)));
        if (!preg_match('/^[A-Z0-9:_-]{1,100}$/D', $epc)) throw new CheckoutError('One or more EPCs are invalid.', 'INVALID_EPCS', 422);
        $unique[$epc] = true;
    }
    $epcs = array_keys($unique);
    sort($epcs, SORT_STRING);
    return $epcs;
}

function checkout_owner(): string
{
    if (!is_string($_SESSION['checkout_owner'] ?? null)) $_SESSION['checkout_owner'] = bin2hex(random_bytes(32));
    return hash('sha256', $_SESSION['checkout_owner']);
}

function checkout_row(PDO $db, string $id, string $owner): array
{
    $stmt = $db->prepare('SELECT * FROM CHECKOUT_sessions WHERE session_id = ? FOR UPDATE');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row || (int) $row['admin_id'] !== (int) $_SESSION['manager_id'] || !hash_equals($row['owner_hash'], $owner)) {
        throw new CheckoutError('Checkout session not found for this browser.', 'CHECKOUT_NOT_FOUND', 404);
    }
    return $row;
}

function checkout_snapshot(array $row): array
{
    return [
        'session_id' => $row['session_id'], 'status' => $row['status'],
        'epcs' => json_decode($row['epcs_json'], true, 512, JSON_THROW_ON_ERROR),
        'cart' => json_decode($row['cart_json'], true, 512, JSON_THROW_ON_ERROR),
        'revision' => (int) $row['revision'], 'total_items' => (int) $row['total_items'],
        'total_amount' => (float) $row['total_amount'], 'failed_attempts' => (int) $row['failed_attempts'],
        'attempts_left' => max(0, CHECKOUT_MAX_FAILURES - (int) $row['failed_attempts']),
        'deadline_at' => $row['deadline_at'] ? strtotime($row['deadline_at'] . ' UTC') * 1000 : null,
        'reason' => $row['reason'], 'purchase_id' => $row['purchase_id'] ? (int) $row['purchase_id'] : null,
    ];
}

function checkout_receipt(array $row): array
{
    return ['demo_mode' => true, 'demo_wallet' => 'QM-WALLET-1001', 'session_id' => $row['session_id'],
        'purchase_id' => (int) $row['purchase_id'], 'total_items' => (int) $row['total_items'],
        'total_amount' => (float) $row['total_amount'], 'cart' => json_decode($row['cart_json'], true, 512, JSON_THROW_ON_ERROR)];
}

function checkout_void(PDO $db, array &$row, string $reason): void
{
    if (in_array($row['status'], ['SUCCESSFUL', 'VOIDED'], true)) return;
    $db->prepare("INSERT INTO PURCHASEtbl (admin_id,session_id,status,attempt_status,attempted_items,total_amount) VALUES (?,?,'UNSUCCESSFUL',?,?,?)")
        ->execute([$row['admin_id'], $row['session_id'], $reason === 'cancelled' ? 'cancelled' : 'failed', $row['total_items'], $row['total_amount']]);
    $row['purchase_id'] = (int) $db->lastInsertId();
    $row['status'] = 'VOIDED';
    $row['reason'] = $reason;
    $db->prepare("UPDATE CHECKOUT_sessions SET status='VOIDED',reason=?,purchase_id=?,failed_attempts=? WHERE session_id=?")
        ->execute([$reason, $row['purchase_id'], $row['failed_attempts'], $row['session_id']]);
}

function checkout_expire(PDO $db, array &$row): void
{
    if ($row['deadline_at'] && strtotime($row['deadline_at'] . ' UTC') <= time()) checkout_void($db, $row, 'timeout');
}

/** Read authoritative prices and availability while locking tags and products in tag order. */
function checkout_catalog(PDO $db, array $epcs): array
{
    if (!$epcs) return ['cart' => [], 'items' => [], 'total' => '0.00'];
    $lookup = $db->prepare('SELECT r.tag_id,r.epc,r.product_id,r.status AS tag_status,p.status AS product_status,p.product_name,p.description,p.category,p.unit_price '
        . 'FROM RFID_tags r INNER JOIN PRODUCTtbl p ON p.product_id=r.product_id '
        . 'WHERE r.epc IN (' . implode(',', array_fill(0, count($epcs), '?')) . ') ORDER BY r.tag_id FOR UPDATE');
    $lookup->execute($epcs);
    $rows = $lookup->fetchAll();
    if (count($rows) !== count($epcs)) throw new CheckoutError('A scanned item is unregistered. Please review your cart.', 'CART_UNAVAILABLE');
    $cart = [];
    $items = [];
    $cents = 0;
    foreach ($rows as $row) {
        if ($row['tag_status'] !== 'AVAILABLE' || (int) $row['product_status'] !== 1) {
            throw new CheckoutError('A scanned item is unavailable or already purchased. Please review your cart.', 'CART_UNAVAILABLE');
        }
        // DECIMAL(10,2) stays exact when accumulated as whole cents.
        [$whole, $fraction] = array_pad(explode('.', (string) $row['unit_price'], 2), 2, '00');
        $cents += (int) $whole * 100 + (int) str_pad($fraction, 2, '0');
        if ($cents > 9999999999) throw new CheckoutError('Purchase total exceeds the supported limit.', 'TOTAL_TOO_LARGE');
        $id = (int) $row['product_id'];
        if (!isset($cart[$id])) $cart[$id] = ['id' => $id, 'name' => $row['product_name'], 'description' => $row['description'],
            'category' => $row['category'], 'code' => 'PRD-' . str_pad((string) $id, 4, '0', STR_PAD_LEFT),
            'price' => (float) $row['unit_price'], 'qty' => 0, 'scanned' => []];
        $cart[$id]['qty']++;
        $cart[$id]['scanned'][] = $row['epc'];
        $items[] = ['tag_id' => (int) $row['tag_id'], 'product_id' => $id, 'price' => $row['unit_price']];
    }
    return ['cart' => array_values($cart), 'items' => $items, 'total' => number_format($cents / 100, 2, '.', '')];
}

function checkout_payload(array $row): array
{
    $payload = ['success' => true, 'session' => checkout_snapshot($row)];
    if ($row['status'] === 'SUCCESSFUL') $payload['purchase'] = checkout_receipt($row);
    return $payload;
}

function checkout_failure_response(PDO $db, Throwable $error): never
{
    if ($db->inTransaction()) $db->rollBack();
    if ($error instanceof CheckoutError) json_response(['success' => false, 'code' => $error->apiCode, 'message' => $error->getMessage()], $error->httpStatus);
    error_log('QuickMart checkout error: ' . get_class($error));
    json_response(['success' => false, 'message' => 'Checkout unavailable. Recover this session before retrying.'], 503);
}
