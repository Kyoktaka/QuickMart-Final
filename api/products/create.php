<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config/bootstrap.php';
require_once __DIR__ . '/../../config/database.php';

require_manager();
require_post();

$data = read_json_body();

$productName = trim((string)($data['product_name'] ?? ''));
$category = trim((string)($data['category'] ?? 'General'));
$price = $data['unit_price'] ?? $data['price'] ?? null;
$size = trim((string)($data['size'] ?? ''));

if ($productName === '') {
    json_response([
        'success' => false,
        'message' => 'Product name is required.'
    ], 400);
}

if (!is_numeric($price) || !is_finite((float)$price) || (float)$price < 0 || (float)$price > 99999999.99) {
    json_response([
        'success' => false,
        'message' => 'Invalid product price.'
    ], 400);
}

if ($category === '') {
    $category = 'General';
}

if (strlen($productName) > 150) {
    json_response([
        'success' => false,
        'message' => 'Product name cannot exceed 150 characters.'
    ], 400);
}

if (strlen($size) > 50) {
    json_response([
        'success' => false,
        'message' => 'Product size cannot exceed 50 characters.'
    ], 400);
}

if (strlen($category) > 100) {
    json_response([
        'success' => false,
        'message' => 'Product category cannot exceed 100 characters.'
    ], 400);
}

try {
    $stmt = $conn->prepare("
        INSERT INTO PRODUCTtbl (product_name, unit_price, size, category)
        VALUES (:product_name, :unit_price, :size, :category)
    ");

    $stmt->execute([
        ':product_name' => $productName,
        ':unit_price' => $price,
        ':size' => $size === '' ? null : $size,
        ':category' => $category
    ]);

    $productId = (int) $conn->lastInsertId();

    $formattedProductId = 'PRD-' . str_pad((string)$productId, 8, '0', STR_PAD_LEFT);

    json_response([
        'success' => true,
        'message' => 'Product created successfully.',
        'product' => [
            'product_id' => $productId,
            'formatted_product_id' => $formattedProductId,
            'product_name' => $productName,
            'unit_price' => (float)$price,
            'category' => $category,
            'size' => $size,
            'status' => 1
        ]
    ], 201);

} catch (PDOException $e) {
    error_log('Product creation failed: ' . $e->getMessage());

    json_response([
        'success' => false,
        'message' => 'Failed to create product.'
    ], 500);
}
