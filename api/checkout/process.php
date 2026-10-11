<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config/bootstrap.php';
require_once __DIR__ . '/../../config/database.php';

require_scan_authorized();
require_post();

// There is no payment-provider verification integration yet.
// A browser 'qr:scanned' event must NEVER authorize a real purchase.
// School demo checkout is available only by explicit server opt-in and on loopback.
$demoEnabled = getenv('QUICKMART_APP_ENV') === 'development'
    && getenv('QUICKMART_DEMO_CHECKOUT') === '1'
    && in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);
if (!$demoEnabled) {
    json_response([
        'success' => false,
        'message' => 'Real payment confirmation is not configured. Checkout is disabled; ask the developer to enable local demo mode.'
    ], 503);
}

$data = read_json_body();
// Local DEMO QR check. Not real cryptographic or payment-provider validation.
$demoQr = is_string($data['payment_qr'] ?? null) ? trim($data['payment_qr']) : '';
$qrParts = explode('|', $demoQr);
if (count($qrParts) !== 3 || $qrParts[0] !== 'QMPAY'
    || preg_match('/^[A-Za-z0-9_-]{1,30}$/D', $qrParts[1]) !== 1) {
    json_response(['success' => false, 'message' => 'Invalid demonstration QR.'], 422);
}
$checkSum = 0;
foreach (str_split($qrParts[1]) as $character) {
    $checkSum += ord($character);
}
if ($qrParts[2] !== 'C' . ($checkSum % 997)) {
    json_response(['success' => false, 'message' => 'Invalid demo QR checksum.'], 422);
}
$sessionId = $data['session_id'] ?? null;
$input = $data['epcs'] ?? null;

if (!is_string($sessionId) || !preg_match('/^[A-Za-z0-9_-]{1,50}$/D', $sessionId)) {
    json_response(['success' => false, 'message' => 'Valid session_id is required.'], 422);
}
if (!is_array($input) || !$input || count($input) > 100) {
    json_response(['success' => false, 'message' => 'Provide 1 to 100 EPCs.'], 422);
}

$unique = [];
foreach ($input as $value) {
    if (!is_string($value)) {
        json_response(['success' => false, 'message' => 'Every EPC must be a string.'], 422);
    }
    $epc = strtoupper(preg_replace('/\s+/', '', trim($value)));
    if ($epc === '' || strlen($epc) > 100 || !preg_match('/^[A-Z0-9:_-]+$/D', $epc)) {
        json_response(['success' => false, 'message' => 'One or more EPCs are invalid.'], 422);
    }
    $unique[$epc] = true;
}
$epcs = array_keys($unique); 

try {
    $conn->beginTransaction();

    $sessionStmt = $conn->prepare(
        'SELECT purchase_id FROM PURCHASEtbl WHERE session_id = :session_id LIMIT 1 FOR UPDATE'
    );
    $sessionStmt->execute(['session_id' => $sessionId]);
    if ($sessionStmt->fetch()) {
        throw new DomainException('Session ID has already been used. Check transaction history.');
    }

    $placeholders = implode(',', array_fill(0, count($epcs), '?'));
    $lookup = $conn->prepare(
        'SELECT r.tag_id, r.epc, r.product_id, r.status AS tag_status, '
        . 'p.status AS product_status, p.unit_price '
        . 'FROM RFID_tags AS r '
        . 'INNER JOIN PRODUCTtbl AS p ON p.product_id = r.product_id '
        . 'WHERE r.epc IN (' . $placeholders . ') '
        . 'ORDER BY r.tag_id FOR UPDATE'
    );
    $lookup->execute($epcs);
    $rows = $lookup->fetchAll();
    $byEpc = [];
    foreach ($rows as $row) {
        $byEpc[$row['epc']] = $row;
    }

    $items = [];
    $totalCents = 0;
    foreach ($epcs as $epc) {
        $row = $byEpc[$epc] ?? null;
        if (!$row || $row['tag_status'] !== 'AVAILABLE' || (int) $row['product_status'] !== 1) {
            throw new DomainException('A scanned item is unavailable, unregistered, or already purchased. Please rescan.');
        }
        $price = (string) $row['unit_price'];
        $cents = (int) round((float) $price * 100);
        $totalCents += $cents;
        $items[] = [
            'tag_id' => (int) $row['tag_id'],
            'product_id' => (int) $row['product_id'],
            'price' => $price,
        ];
    }
    if ($totalCents > 9999999999) {
        throw new DomainException('Purchase total exceeds the supported limit.');
    }
    $total = number_format($totalCents / 100, 2, '.', '');

    $insertPurchase = $conn->prepare(
        "INSERT INTO PURCHASEtbl (admin_id, session_id, status, attempted_items, total_amount) "
        . "VALUES (:admin_id, :session_id, 'SUCCESSFUL', :attempted_items, :total_amount)"
    );
    $insertPurchase->execute([
        'admin_id' => (int) $_SESSION['manager_id'],
        'session_id' => $sessionId,
        'attempted_items' => count($items),
        'total_amount' => $total,
    ]);
    $purchaseId = (int) $conn->lastInsertId();

    $insertItem = $conn->prepare(
        'INSERT INTO PURCHASE_items (purchase_id, product_id, unit_price, subtotal) '
        . 'VALUES (:purchase_id, :product_id, :unit_price, :subtotal)'
    );
    $markTag = $conn->prepare(
        "UPDATE RFID_tags SET status = 'PURCHASED', purchased_at = NOW() "
        . "WHERE tag_id = :tag_id AND status = 'AVAILABLE'"
    );
    foreach ($items as $item) {
        $insertItem->execute([
            'purchase_id' => $purchaseId,
            'product_id' => $item['product_id'],
            'unit_price' => $item['price'],
            'subtotal' => $item['price'],
        ]);
        $markTag->execute(['tag_id' => $item['tag_id']]);
        if ($markTag->rowCount() !== 1) {
            throw new DomainException('An RFID tag changed status during checkout. Please retry with a new session.');
        }
    }

    $conn->commit();
    json_response([
        'success' => true,
        'message' => 'Demo checkout completed. No real payment was verified.',
        'demo_mode' => true,
        'session_id' => $sessionId,
        'purchase_id' => $purchaseId,
        'total_items' => count($items),
        'total_amount' => (float) $total,
    ]);
} catch (DomainException $e) {
    if ($conn->inTransaction()) $conn->rollBack();
    json_response(['success' => false, 'message' => $e->getMessage()], 409);
} catch (PDOException $e) {
    if ($conn->inTransaction()) $conn->rollBack();
    error_log('QuickMart checkout database error: ' . get_class($e));
    $status = (string) $e->getCode() === '23000' ? 409 : 500;
    json_response(['success' => false, 'message' =>
        $status === 409 ? 'Session or item already processed. Review transaction history.' : 'Could not complete checkout.'], $status);
} catch (Throwable $e) {
    if ($conn->inTransaction()) $conn->rollBack();
    error_log('QuickMart checkout error: ' . get_class($e));
    json_response(['success' => false, 'message' => 'Could not complete checkout.'], 500);
}
