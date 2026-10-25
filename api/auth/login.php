<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/bootstrap.php';
require_post();
$data = read_json_body();
$email = is_string($data['email'] ?? null) ? trim($data['email']) : '';
$password = is_string($data['password'] ?? null) ? $data['password'] : '';
if (strlen($email) > 100 || !filter_var($email, FILTER_VALIDATE_EMAIL)
    || $password === '' || strpos($password, "\0") !== false) {
    json_response(['success' => false, 'message' => 'Enter a valid email and password.'], 422);
}

attempt_block_if_locked('login');

try {
    $stmt = auth_database()->prepare(
        'SELECT admin_id, admin_name, email, password_hash, status FROM ADMINtbl WHERE email = :email LIMIT 1'
    );
    $stmt->execute(['email' => $email]);
    $manager = $stmt->fetch();
    if (!$manager || !password_verify($password, $manager['password_hash']) || (int) $manager['status'] !== 1) {
        attempt_fail('login', 'Incorrect email or password.');
    }
} catch (PDOException $e) {
    error_log('QuickMart login lookup failed.');
    json_response(['success' => false, 'message' => 'Could not sign in. Please try again.'], 503);
}

if (!session_regenerate_id(true)) {
    clear_manager_session();
    json_response(['success' => false, 'message' => 'Could not start manager session.'], 503);
}
clear_manager_session();
attempt_reset('login');
$_SESSION['manager_authenticated'] = true;
$_SESSION['manager_id'] = (int) $manager['admin_id'];
$_SESSION['manager_name'] = $manager['admin_name'];
$_SESSION['manager_email'] = $manager['email'];
$_SESSION['manager_password_fingerprint'] = hash('sha256', $manager['password_hash']);
$_SESSION['manager_signed_in_at'] = time();
$_SESSION['manager_last_active_at'] = time();

json_response(['success' => true, 'authenticated' => true, 'manager' => manager_response($manager)]);
