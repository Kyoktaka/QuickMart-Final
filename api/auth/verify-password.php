<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/bootstrap.php';
require_post();

$manager = current_manager();
if ($manager === null) {
    json_response(['success' => false, 'authenticated' => false, 'message' => 'Manager authentication required.'], 401);
}
attempt_block_if_locked('verify_password');
$data = read_json_body();
$purpose = $data['purpose'] ?? 'scan';
if (!in_array($purpose, ['scan', 'exit'], true)) {
    json_response(['success' => false, 'message' => 'Invalid password verification purpose.'], 422);
}
if ($purpose === 'scan') unset($_SESSION['scan_authorized'], $_SESSION['scan_authorized_at']);
else unset($_SESSION['kiosk_exit_authorized_at']);
$password = is_string($data['password'] ?? null) ? $data['password'] : '';
if ($password === '' || strpos($password, "\0") !== false) {
    json_response(['success' => false, 'message' => 'Manager password is required.'], 422);
}
if (!password_verify($password, $manager['password_hash'])) {
    attempt_fail('verify_password', 'Incorrect manager password.');
}
attempt_reset('verify_password');
if ($purpose === 'exit') {
    $_SESSION['kiosk_exit_authorized_at'] = time();
    json_response(['success' => true, 'message' => 'Manager exit approved.']);
}
$_SESSION['scan_authorized'] = true;
$_SESSION['scan_authorized_at'] = time();
$_SESSION['kiosk_active'] = true;
json_response(['success' => true, 'message' => 'Scanning authorization granted.']);
