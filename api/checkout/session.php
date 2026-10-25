<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/bootstrap.php';
require_once __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../includes/checkout.php';

require_manager(true);
$owner = checkout_owner();
$readOnly = ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET';
if (!$readOnly) require_post();
$data = $readOnly ? $_GET : read_json_body();

try {
    $action = $readOnly ? 'status' : ($data['action'] ?? '');
    if (!in_array($action, ['status', 'save', 'review', 'confirm', 'cancel', 'timeout'], true)) throw new CheckoutError('Unknown checkout action.', 'INVALID_ACTION', 422);
    if (in_array($action, ['save', 'review', 'confirm'], true)) require_scan_authorized();
    $conn->beginTransaction();
    if ($readOnly && !isset($data['session_id'])) {
        $latest = $conn->prepare("SELECT * FROM CHECKOUT_sessions WHERE admin_id=? AND owner_hash=? AND status IN ('CART','REVIEWED','PAYMENT') ORDER BY created_at DESC LIMIT 1 FOR UPDATE");
        $latest->execute([$_SESSION['manager_id'], $owner]);
        $row = $latest->fetch();
        if (!$row) { $conn->commit(); json_response(['success' => true, 'session' => null]); }
        checkout_expire($conn, $row);
        $conn->commit();
        json_response(checkout_payload($row));
    }
    $id = checkout_session_id($data['session_id'] ?? null);
    $exists = $conn->prepare('SELECT session_id FROM CHECKOUT_sessions WHERE session_id=?');
    $exists->execute([$id]);
    if (!$exists->fetchColumn()) {
        if (!in_array($action, ['save', 'review'], true)) throw new CheckoutError('Checkout session not found.', 'CHECKOUT_NOT_FOUND', 404);
        $active = $conn->prepare("SELECT * FROM CHECKOUT_sessions WHERE admin_id=? AND owner_hash=? AND status IN ('CART','REVIEWED','PAYMENT') ORDER BY created_at FOR UPDATE");
        $active->execute([$_SESSION['manager_id'], $owner]);
        foreach ($active->fetchAll() as $other) {
            checkout_expire($conn, $other);
            if ($other['status'] !== 'VOIDED') {
                $conn->commit();
                json_response(['success' => false, 'code' => 'ACTIVE_CHECKOUT', 'message' => 'Recover or cancel the existing checkout first.', 'session' => checkout_snapshot($other)], 409);
            }
        }
        $conn->prepare("INSERT INTO CHECKOUT_sessions (session_id,admin_id,owner_hash,epcs_json,cart_json) VALUES (?,?,?,'[]','[]')")->execute([$id, $_SESSION['manager_id'], $owner]);
    }
    $row = checkout_row($conn, $id, $owner);
    checkout_expire($conn, $row);
    if (!in_array($row['status'], ['SUCCESSFUL', 'VOIDED'], true)) {
        if ($action === 'cancel') checkout_void($conn, $row, 'cancelled');
        elseif ($action === 'timeout') {
            // A browser timer cannot prematurely void a still-valid payment.
            if (!$row['deadline_at']) throw new CheckoutError('Payment has not started.', 'PAYMENT_NOT_STARTED');
        } elseif (in_array($action, ['save', 'review'], true)) {
            $epcs = checkout_epcs($data['epcs'] ?? null, $action === 'save');
            $catalog = checkout_catalog($conn, $epcs);
            $epcsJson = json_encode($epcs, JSON_THROW_ON_ERROR);
            $cartJson = json_encode($catalog['cart'], JSON_THROW_ON_ERROR);
            $changed = $epcsJson !== $row['epcs_json'] || $cartJson !== $row['cart_json'];
            if ($changed) $row['revision']++;
            $row['epcs_json'] = $epcsJson; $row['cart_json'] = $cartJson;
            $row['total_items'] = count($epcs); $row['total_amount'] = $catalog['total'];
            if ($action === 'review') $row['status'] = 'REVIEWED';
            elseif ($changed) $row['status'] = 'CART';
            $conn->prepare('UPDATE CHECKOUT_sessions SET status=?,epcs_json=?,cart_json=?,revision=?,total_items=?,total_amount=? WHERE session_id=?')
                ->execute([$row['status'], $epcsJson, $cartJson, $row['revision'], $row['total_items'], $row['total_amount'], $id]);
        } elseif ($action === 'confirm') {
            $revision = filter_var($data['revision'] ?? null, FILTER_VALIDATE_INT);
            if ($revision !== (int) $row['revision'] || !in_array($row['status'], ['REVIEWED', 'PAYMENT'], true) || (int) $row['total_items'] < 1) throw new CheckoutError('Review the current cart before confirming payment.', 'CART_REVIEW_REQUIRED');
            $catalog = checkout_catalog($conn, json_decode($row['epcs_json'], true, 512, JSON_THROW_ON_ERROR));
            if ($catalog['total'] !== $row['total_amount'] || json_encode($catalog['cart'], JSON_THROW_ON_ERROR) !== $row['cart_json']) throw new CheckoutError('Product information changed. Review your cart again.', 'CART_CHANGED');
            $row['status'] = 'PAYMENT';
            $row['deadline_at'] ??= gmdate('Y-m-d H:i:s', time() + CHECKOUT_PAYMENT_SECONDS);
            $conn->prepare("UPDATE CHECKOUT_sessions SET status='PAYMENT',deadline_at=? WHERE session_id=?")->execute([$row['deadline_at'], $id]);
        }
    }
    $conn->commit();
    json_response(checkout_payload($row));
} catch (Throwable $error) { checkout_failure_response($conn, $error); }
