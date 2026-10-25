<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config/bootstrap.php';
require_once __DIR__ . '/../../config/database.php';
require_manager();
session_write_close(); // read-only: free the session lock

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    json_response(['success' => false, 'message' => 'Only GET requests are allowed.'], 405);
}

try {
    // One PURCHASEtbl row per session. Count successful items from PURCHASE_items;
    // unsuccessful attempts preserve the reported cart size in attempted_items.
    $stmt = $conn->query("
        SELECT p.purchase_id, p.session_id, p.purchase_date,
               p.status, p.attempt_status, p.total_amount, p.attempted_items,
               (SELECT COUNT(*) FROM PURCHASE_items AS pi
                WHERE pi.purchase_id = p.purchase_id) AS purchased_items
        FROM PURCHASEtbl AS p
        ORDER BY p.purchase_date DESC, p.purchase_id DESC
    ");

    // Link each purchased item to its specific RFID tag. Pre-migration
    // transactions have NULL tag_id and therefore retain a blank EPC.
    $detailStmt = $conn->query("
        SELECT pi.purchase_id, pi.product_id, p.product_name, pi.unit_price,
               r.epc AS epc
        FROM PURCHASE_items AS pi
        INNER JOIN PRODUCTtbl AS p ON p.product_id = pi.product_id
        LEFT JOIN RFID_tags AS r ON r.tag_id = pi.tag_id
        ORDER BY pi.purchase_item_id ASC
    ");
    $receiptItems = [];
    foreach ($detailStmt->fetchAll() as $item) {
        $receiptItems[(int) $item['purchase_id']][] = [
            'epc' => $item['epc'] ?? null,
            'name' => $item['product_name'],
            'qty' => 1,
            'price' => (float) $item['unit_price']
        ];
    }

    $transactions = [];
    foreach ($stmt->fetchAll() as $row) {
        $successful = $row['status'] === 'SUCCESSFUL';
        $transactions[] = [
            'id' => (string) $row['session_id'],
            'seq' => (int) $row['purchase_id'],
            'date' => str_replace(' ', 'T', (string) $row['purchase_date']),
            'items' => $successful ? (int) $row['purchased_items'] : (int) $row['attempted_items'],
            'amount' => (float) $row['total_amount'],
            'itemsDetail' => $successful ? ($receiptItems[(int) $row['purchase_id']] ?? []) : [],
            'status' => $successful ? 'success' :
                ($row['attempt_status'] === 'cancelled' ? 'cancelled' : 'failed')
        ];
    }

    json_response([
        'success' => true,
        'message' => 'Transaction history retrieved successfully.',
        'transactions' => $transactions
    ]);
} catch (Throwable $e) {
    error_log('QuickMart transaction list failed: ' . get_class($e));
    json_response(['success' => false, 'message' => 'Failed to retrieve transaction history.'], 500);
}
