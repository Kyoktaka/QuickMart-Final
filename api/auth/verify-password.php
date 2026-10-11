<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/bootstrap.php';
require_post();

unset($_SESSION['scan_authorized'], $_SESSION['scan_authorized_at']);
$manager = current_manager();
if ($manager === null) {
    json_response(['success' => false, 'authenticated' => false, 'message' => 'Manager authentication required.'], 401);
}
$data = read_json_body();
$password = is_string($data['password'] ?? null) ? $data['password'] : '';
if ($password === '' || strpos($password, "\0") !== false) {
    json_response(['success' => false, 'message' => 'Manager password is required.'], 422);
}
if (!password_verify($password, $manager['password_hash'])) {
    json_response(['success' => false, 'message' => 'Incorrect manager password.'], 401);
}
$_SESSION['scan_authorized'] = true;
$_SESSION['scan_authorized_at'] = time();
json_response(['success' => true, 'message' => 'Scanning authorization granted.']);
