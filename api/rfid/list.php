<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/bootstrap.php';
require_manager(true);
session_write_close(); // read-only: free the session lock
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    json_response(['success' => false, 'message' => 'Only GET requests are allowed.'],405);
}
try {
    $sql = 'SELECT tag_id, epc, product_id, status, registered_at, purchased_at '
         . 'FROM RFID_tags ORDER BY tag_id DESC';
    $rows = auth_database()->query($sql)->fetchAll(PDO::FETCH_ASSOC);
    json_response(['success'=>true,'tags'=>$rows]);
} catch (PDOException $e) {
    error_log('RFID tag inventory lookup failed: '.get_class($e));
    json_response(['success'=>false,'message'=>'Could not load RFID tags.'],503);
}
