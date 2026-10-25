<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/bootstrap.php';
require_once __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../includes/demo-qr.php';
require_once __DIR__ . '/../../includes/checkout.php';

require_scan_authorized();
require_post();
// Local classroom simulation is enabled automatically ONLY on the XAMPP
// loopback host. Production and LAN requests always fail closed.
if (!quickmart_local_demo_allowed((string) ($_SERVER['REMOTE_ADDR'] ?? ''), (string) ($_SERVER['HTTP_HOST'] ?? ''), getenv('QUICKMART_APP_ENV'), getenv('QUICKMART_DEMO_CHECKOUT'))) {
    json_response(['success' => false, 'message' => 'Classroom QR checkout is available on localhost only. No real payment provider is connected.'], 503);
}
$data = read_json_body();
try {
    $id = checkout_session_id($data['session_id'] ?? null);
    $attemptId = $data['attempt_id'] ?? null;
    if (!is_string($attemptId) || !preg_match('/^[A-Za-z0-9_-]{1,64}$/D', $attemptId)) throw new CheckoutError('A stable attempt_id is required for payment retries.', 'INVALID_ATTEMPT', 422);
    // Previous contract, superseded by the offline fixtures and durable attempt service below:
    // Only two classroom QR fixtures are recognized. QR text is not real payment proof.
    // The frontend records the failed attempt separately through api/checkout/log.php.
    $qr = is_string($data['payment_qr'] ?? null) ? $data['payment_qr'] : '';
    if (strlen($qr) > 1000) throw new CheckoutError('QR payload is too long.', 'INVALID_QR', 422);
    $conn->beginTransaction();
    $row = checkout_row($conn, $id, checkout_owner());
    checkout_expire($conn, $row);
    if ($row['status'] === 'SUCCESSFUL') {
        $conn->commit();
        json_response(['success' => true, 'result' => 'success', 'message' => 'Demo checkout already completed. No real payment was verified.', 'purchase' => checkout_receipt($row), 'session' => checkout_snapshot($row)]);
    }
    if ($row['status'] === 'VOIDED') {
        $conn->commit();
        json_response(['success' => false, 'code' => 'CHECKOUT_VOIDED', 'message' => 'Checkout voided: ' . $row['reason'] . '.', 'session' => checkout_snapshot($row)], 409);
    }
    $replay = $conn->prepare('SELECT response_json FROM CHECKOUT_attempts WHERE session_id=? AND attempt_id=?');
    $replay->execute([$id, $attemptId]);
    if ($stored = $replay->fetchColumn()) {
        $payload = json_decode($stored, true, 512, JSON_THROW_ON_ERROR);
        // Replay the outcome, with current session state so an old response cannot reset the UI counter.
        $payload['session'] = checkout_snapshot($row);
        $conn->commit();
        json_response($payload, 422);
    }
    if ($row['status'] !== 'PAYMENT') throw new CheckoutError('Confirm the reviewed cart before payment.', 'CART_REVIEW_REQUIRED');
    $outcome = quickmart_demo_qr_outcome($qr);
    // This is a fixed classroom scenario, not a real wallet balance check.
    // A declined demo QR cannot create a successful purchase or update any RFID tag.
    if ($outcome !== 'success') {
        $row['failed_attempts']++;
        $conn->prepare('UPDATE CHECKOUT_sessions SET failed_attempts=? WHERE session_id=?')->execute([$row['failed_attempts'], $id]);
        if ($row['failed_attempts'] >= CHECKOUT_MAX_FAILURES) checkout_void($conn, $row, 'three_failed_attempts');
        [$code, $message] = match ($outcome) {
            'insufficient_balance' => ['DEMO_INSUFFICIENT_BALANCE', 'Insufficient balance (simulated wallet).'],
            'no_internet' => ['DEMO_NO_INTERNET', 'No internet connection (simulated).'],
            default => ['INVALID_DEMO_QR', 'Unrecognized QuickMart demo QR code.'],
        };
        $payload = ['success' => false, 'code' => $code, 'message' => $message, 'session' => checkout_snapshot($row)];
        $conn->prepare('INSERT INTO CHECKOUT_attempts (session_id,attempt_id,outcome,response_json) VALUES (?,?,?,?)')->execute([$id, $attemptId, $outcome, json_encode($payload, JSON_THROW_ON_ERROR)]);
        $conn->commit();
        json_response($payload, 422);
    }
    $catalog = checkout_catalog($conn, json_decode($row['epcs_json'], true, 512, JSON_THROW_ON_ERROR));
    if ($catalog['total'] !== $row['total_amount'] || json_encode($catalog['cart'], JSON_THROW_ON_ERROR) !== $row['cart_json']) throw new CheckoutError('Product information changed. Review your cart again.', 'CART_CHANGED');
    $conn->prepare("INSERT INTO PURCHASEtbl (admin_id,session_id,status,attempted_items,total_amount) VALUES (?,?,'SUCCESSFUL',?,?)")->execute([$row['admin_id'], $id, $row['total_items'], $row['total_amount']]);
    $row['purchase_id'] = (int) $conn->lastInsertId();
    $insertItem = $conn->prepare('INSERT INTO PURCHASE_items (purchase_id,product_id,tag_id,unit_price,subtotal) VALUES (?,?,?,?,?)');
    $markTag = $conn->prepare("UPDATE RFID_tags SET status='PURCHASED',purchased_at=NOW() WHERE tag_id=? AND status='AVAILABLE'");
    foreach ($catalog['items'] as $item) {
        $insertItem->execute([$row['purchase_id'], $item['product_id'], $item['tag_id'], $item['price'], $item['price']]);
        $markTag->execute([$item['tag_id']]);
        if ($markTag->rowCount() !== 1) throw new CheckoutError('An RFID tag changed status during checkout. Please review the cart.', 'CART_UNAVAILABLE');
    }
    $row['status'] = 'SUCCESSFUL';
    $conn->prepare("UPDATE CHECKOUT_sessions SET status='SUCCESSFUL',purchase_id=? WHERE session_id=?")->execute([$row['purchase_id'], $id]);
    $payload = ['success' => true, 'result' => 'success', 'message' => 'Demo checkout completed. No real payment was verified.', 'purchase' => checkout_receipt($row), 'session' => checkout_snapshot($row)];
    $conn->prepare('INSERT INTO CHECKOUT_attempts (session_id,attempt_id,outcome,response_json) VALUES (?,?,?,?)')->execute([$id, $attemptId, 'success', json_encode($payload, JSON_THROW_ON_ERROR)]);
    $conn->commit();
    json_response($payload);
} catch (Throwable $error) { checkout_failure_response($conn, $error); }
