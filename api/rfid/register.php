<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config/bootstrap.php';

require_manager();
require_post();
// Registering EPC tags needs a manager password approval (api/rfid/authorize-restock.php).
require_restock_authorized();

$data = read_json_body();
$productId = filter_var(
    $data['product_id'] ?? null,
    FILTER_VALIDATE_INT,
    ['options' => ['min_range' => 1]]
);
if ($productId === false || $productId === null) {
    json_response(['success' => false, 'message' => 'Valid product is required.'], 422);
}

$input = $data['epcs'] ?? (isset($data['epc']) ? [$data['epc']] : null);
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
if (!$epcs) {
    json_response([
        'success' => false,
        'message' => 'At least one valid EPC is required.',
        'registered_epcs' => [],
        'already_registered_epcs' => [],
        'already_registered_other_product_epcs' => [],
        'invalid_epcs' => $invalid
    ], 422);
}

try {
    $conn = auth_database();
    $productStmt = $conn->prepare(
        'SELECT product_id, product_name, status FROM PRODUCTtbl WHERE product_id = :id LIMIT 1'
    );
    $productStmt->execute(['id' => $productId]);
    $product = $productStmt->fetch();
    if (!$product) {
        json_response(['success' => false, 'message' => 'Product not found.'], 404);
    }
    if ((int) $product['status'] !== 1) {
        json_response(['success' => false, 'message' => 'The selected product is inactive.'], 409);
    }

    // The approval is single-use: the next registration asks for the password again.
    unset($_SESSION['restock_authorized_at']);

    // The unique EPC constraint prevents two concurrent requests from assigning one tag twice.
    // Commit each tag separately so one duplicate cannot discard an entire registration batch.
    $check = $conn->prepare('SELECT product_id FROM RFID_tags WHERE epc = :epc LIMIT 1');
    $insert = $conn->prepare(
        "INSERT INTO RFID_tags (epc, product_id, status) VALUES (:epc, :product_id, 'AVAILABLE')"
    );
    $registered = [];
    $existingSame = [];
    $existingOther = [];

    foreach ($epcs as $epc) {
        $check->execute(['epc' => $epc]);
        $existing = $check->fetch();
        if (!$existing) {
            try {
                $insert->execute(['epc' => $epc, 'product_id' => $productId]);
                $registered[] = $epc;
                continue;
            } catch (PDOException $e) {
                if ((string) $e->getCode() !== '23000') {
                    throw $e;
                }
                // Concurrent registration won the race; recheck who owns the EPC.
                $check->execute(['epc' => $epc]);
                $existing = $check->fetch();
                if (!$existing) {
                    throw $e;
                }
            }
        }
        if ((int) $existing['product_id'] === (int) $productId) {
            $existingSame[] = $epc;
        } else {
            $existingOther[] = $epc;
        }
    }

    json_response([
        'success' => true,
        'message' => 'RFID registration completed.',
        'product' => [
            'product_id' => (int) $product['product_id'],
            'product_name' => $product['product_name']
        ],
        'registered_epcs' => $registered,
        'already_registered_epcs' => $existingSame,
        'already_registered_other_product_epcs' => $existingOther,
        'invalid_epcs' => $invalid,
        'registered_count' => count($registered),
        'skipped_count' => count($existingSame) + count($existingOther) + count($invalid)
    ]);
} catch (PDOException $e) {
    error_log('QuickMart RFID registration database error: ' . get_class($e));
    json_response(['success' => false, 'message' => 'Could not register the RFID tags.'], 503);
}
