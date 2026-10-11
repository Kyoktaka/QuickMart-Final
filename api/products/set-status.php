<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/bootstrap.php';
require_once __DIR__ . '/../../config/database.php';
require_manager();
require_post();

$data = read_json_body();
$id = filter_var($data['product_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
$status = $data['status'] ?? null;
if (!$id || !in_array($status, [0, 1], true)) {
    json_response(['success' => false, 'message' => 'Valid product ID and status (0 or 1) are required.'], 422);
}
try {
    $stmt = $conn->prepare('UPDATE PRODUCTtbl SET status = :status WHERE product_id = :id');
    $stmt->execute(['status' => $status, 'id' => $id]);
    $check = $conn->prepare('SELECT product_id, status FROM PRODUCTtbl WHERE product_id = :id');
    $check->execute(['id' => $id]);
    if (!$check->fetch()) json_response(['success' => false, 'message' => 'Product not found.'], 404);
    json_response(['success' => true, 'product_id' => $id, 'status' => $status]);
} catch (Throwable $e) {
    error_log('QuickMart product status failed: ' . get_class($e));
    json_response(['success' => false, 'message' => 'Could not update product status.'], 500);
}
