<?php
declare(strict_types=1);

// Compatibility route: closing a checkout must use its authoritative server cart.
// Client-supplied totals and failure counts are never written to purchase history.
require_once __DIR__ . '/../../config/bootstrap.php';
require_once __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../includes/checkout.php';
require_manager(true);
require_post();
$data = read_json_body();
try {
    $id = checkout_session_id($data['session_id'] ?? null);
    if (($data['status'] ?? '') !== 'cancelled') throw new CheckoutError('Payment failures and timeouts are recorded by the checkout service.', 'SERVER_PAYMENT_STATUS_REQUIRED', 422);
    $conn->beginTransaction();
    $row = checkout_row($conn, $id, checkout_owner());
    checkout_expire($conn, $row);
    checkout_void($conn, $row, 'cancelled');
    $conn->commit();
    json_response(checkout_payload($row));
} catch (Throwable $error) { checkout_failure_response($conn, $error); }
