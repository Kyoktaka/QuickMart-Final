<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config/bootstrap.php';
require_once __DIR__ . '/../../config/database.php';
require_manager();

// Inventory can request inactive rows; standard callers still receive active products.
$includeInactive = ($_GET['include_inactive'] ?? '') === '1';
$filter = $includeInactive ? '' : 'WHERE p.status = 1';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    json_response(['success' => false, 'message' => 'Only GET requests are allowed.'], 405);
}

try {
    // Physical available inventory is the number of AVAILABLE EPCs per active product.
    $stmt = $conn->query("
        SELECT p.product_id, p.product_name, p.description, p.unit_price, p.category, p.status,
               COALESCE(stock.stock_available, 0) AS stock_available
        FROM PRODUCTtbl AS p
        LEFT JOIN (
            SELECT product_id, COUNT(*) AS stock_available
            FROM RFID_tags
            WHERE status = 'AVAILABLE'
            GROUP BY product_id
        ) AS stock ON stock.product_id = p.product_id
        {$filter}
        ORDER BY p.product_id DESC
    ");

    $products = $stmt->fetchAll();
    foreach ($products as &$product) {
        $product['product_id'] = (int) $product['product_id'];
        $product['unit_price'] = (float) $product['unit_price'];
        $product['stock_available'] = (int) $product['stock_available'];
        $product['formatted_product_id'] = sprintf('PRD-%08d', $product['product_id']);
    }
    unset($product);

    json_response([
        'success' => true,
        'message' => 'Products retrieved successfully.',
        'products' => $products
    ]);
} catch (Throwable $e) {
    error_log('QuickMart product list failed: ' . get_class($e));
    json_response(['success' => false, 'message' => 'Failed to retrieve products.'], 500);
}
