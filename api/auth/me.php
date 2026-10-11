<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/bootstrap.php';
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    json_response(['success' => false, 'message' => 'Only GET requests are allowed.'], 405);
}
$manager = current_manager();
if ($manager === null) {
    json_response(['success' => true, 'authenticated' => false, 'manager' => null]);
}
json_response(['success' => true, 'authenticated' => true, 'manager' => manager_response($manager)]);
