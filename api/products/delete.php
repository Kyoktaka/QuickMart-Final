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

if ($productId === false || $productId === null) {
    json_response([
        'success' => false,
        'message' => 'Valid product ID is required.'
    ], 400);
}

try {
    $stmt = $conn->prepare("
        UPDATE PRODUCTtbl
        SET status = 0
        WHERE product_id = :product_id
        AND status = 1
    ");

    $stmt->execute([
        ':product_id' => $productId
    ]);

    if ($stmt->rowCount() === 0) {
        $check = $conn->prepare("
            SELECT status
            FROM PRODUCTtbl
            WHERE product_id = :product_id
        ");

        $check->execute([
            ':product_id' => $productId
        ]);

        $product = $check->fetch(PDO::FETCH_ASSOC);

        if (!$product) {
            json_response([
                'success' => false,
                'message' => 'Product not found.'
            ], 404);
        }

        json_response([
            'success' => false,
            'message' => 'Product is already inactive.'
        ], 409);
    }

    $formattedProductId = 'PRD-' . str_pad(
        (string)$productId,
        8,
        '0',
        STR_PAD_LEFT
    );

    json_response([
        'success' => true,
        'message' => 'Product deleted successfully.',
        'product_id' => $productId,
        'formatted_product_id' => $formattedProductId
    ], 200);

} catch (PDOException $e) {
    error_log($e->getMessage());

    json_response([
        'success' => false,
        'message' => 'Failed to delete product.'
    ], 500);
}