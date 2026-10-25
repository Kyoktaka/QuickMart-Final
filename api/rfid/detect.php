<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config/bootstrap.php';

require_scan_authorized();
session_write_close(); // read-only lookup: do not hold the session lock while the database works
require_post();

$data = read_json_body();
$input = $data['epcs'] ?? (isset($data['epc']) ? [$data['epc']] : []);
if (!is_array($input) || count($input) > 100) {
    json_response(['success' => false, 'message' => 'epcs must be an array of at most 100 tags.'], 422);
}

$unique = [];
$invalid = [];
foreach ($input as $value) {
    if (!is_string($value)) {
        $invalid[] = is_scalar($value) ? (string) $value : '[invalid value]';
        continue;
    }
    $epc = strtoupper(preg_replace('/\s+/', '', trim($value)));
    if ($epc === '' || strlen($epc) > 100 || !preg_match('/^[A-Z0-9:_-]+$/D', $epc)) {
        $invalid[] = $value;
        continue;
    }
    $unique[$epc] = true;
}
$epcs = array_keys($unique);

$grouped = [];
$unknown = [];
$purchased = [];
$inactive = [];

if ($epcs) {
    $placeholders = implode(', ', array_fill(0, count($epcs), '?'));
    try {
        $stmt = auth_database()->prepare(
            'SELECT r.tag_id, r.epc, r.product_id, r.status AS tag_status, '
            . 'p.product_name, p.unit_price, p.category, p.status AS product_status '
            . 'FROM RFID_tags AS r '
            . 'INNER JOIN PRODUCTtbl AS p ON p.product_id = r.product_id '
            . 'WHERE r.epc IN (' . $placeholders . ')'
        );
        $stmt->execute($epcs);
        $byEpc = [];
        foreach ($stmt->fetchAll() as $row) {
            $byEpc[$row['epc']] = $row;
        }
    } catch (PDOException $e) {
        error_log('QuickMart RFID detection lookup failed: ' . get_class($e));
        json_response(['success' => false, 'message' => 'Could not process RFID detection.'], 503);
    }

    foreach ($epcs as $epc) {
        $row = $byEpc[$epc] ?? null;
        if ($row === null) {
            $unknown[] = $epc;
            continue;
        }
        if ($row['tag_status'] === 'PURCHASED') {
            $purchased[] = $epc;
            continue;
        }
        if ($row['tag_status'] !== 'AVAILABLE' || (int) $row['product_status'] !== 1) {
            $inactive[] = $epc;
            continue;
        }

        $id = (int) $row['product_id'];
        if (!isset($grouped[$id])) {
            $grouped[$id] = [
                'product_id' => $id,
                'product_name' => $row['product_name'],
                'unit_price' => (float) $row['unit_price'],
                'category' => $row['category'],
                'quantity' => 0,
                'subtotal' => 0.0,
                'epcs' => [],
                'tag_ids' => []
            ];
        }
        $grouped[$id]['quantity']++;
        $grouped[$id]['subtotal'] += (float) $row['unit_price'];
        $grouped[$id]['epcs'][] = $epc;
        $grouped[$id]['tag_ids'][] = (int) $row['tag_id'];
    }
}

$totalAmount = 0.0;
$totalQuantity = 0;
foreach ($grouped as &$item) {
    $item['subtotal'] = round($item['subtotal'], 2);
    $totalAmount += $item['subtotal'];
    $totalQuantity += $item['quantity'];
}
unset($item);

json_response([
    'success' => true,
    'grouped_items' => array_values($grouped),
    'unknown_epcs' => $unknown,
    'purchased_epcs' => $purchased,
    'inactive_epcs' => $inactive,
    'invalid_epcs' => $invalid,
    'total_amount' => round($totalAmount, 2),
    'total_quantity' => $totalQuantity,
    'detected_count' => count($epcs)
]);
