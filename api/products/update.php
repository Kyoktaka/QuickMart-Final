<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config/bootstrap.php';
require_once __DIR__ . '/../../config/database.php';

require_manager();
require_post();

$data = read_json_body();

$productId = filter_var(
    $data['product_id'] ?? null,
    FILTER_VALIDATE_INT,
    ['options' => ['min_range' => 1]]
);

$productName = trim((string)($data['product_name'] ?? ''));
$unitPrice = $data['unit_price'] ?? $data['price'] ?? null;
$category = trim((string)($data['category'] ?? 'General'));
$size = trim((string)($data['size'] ?? ''));

if ($productId === false || $productId === null) {
    json_response([
        'success' => false,
        'message' => 'Valid product ID is required.'
    ], 400);
}

if ($productName === '') {
    json_response([
        'success' => false,
        'message' => 'Product name is required.'
    ], 400);
}

if (
    !is_numeric($unitPrice) ||
    !is_finite((float)$unitPrice) ||
    (float)$unitPrice < 0 ||
    (float)$unitPrice > 99999999.99
) {
    json_response([
        'success' => false,
        'message' => 'Valid product price is required.'
    ], 400);
}

if ($category === '') {
    $category = 'General';
}

if (
    strlen($productName) > 150 ||
    strlen($category) > 100 ||
    strlen($size) > 50
) {
    json_response([
        'success' => false,
        'message' => 'One or more product fields exceed the allowed length.'
    ], 400);
}

try {
    $check = $conn->prepare("
        SELECT product_id
        FROM PRODUCTtbl
        WHERE product_id = :product_id
    ");

    $check->execute([
        ':product_id' => $productId
    ]);

    if (!$check->fetch(PDO::FETCH_ASSOC)) {
        json_response([
            'success' => false,
            'message' => 'Product not found.'
        ], 404);
    }

    $stmt = $conn->prepare("
        UPDATE PRODUCTtbl
        SET product_name = :product_name,
            unit_price = :unit_price,
            category = :category,
            size = :size
        WHERE product_id = :product_id
    ");

    $stmt->execute([
        ':product_name' => $productName,
        ':unit_price' => $unitPrice,
        ':category' => $category,
        ':size' => $size === '' ? null : $size,
        ':product_id' => $productId
    ]);

    $formattedProductId = 'PRD-' . str_pad(
        (string)$productId,
        8,
        '0',
        STR_PAD_LEFT
    );

    json_response([
        'success' => true,
        'message' => 'Product updated successfully.',
        'product_id' => $productId,
        'formatted_product_id' => $formattedProductId
    ], 200);

} catch (PDOException $e) {
    error_log($e->getMessage());

    json_response([
        'success' => false,
        'message' => 'Failed to update product.'
    ], 500);
}
