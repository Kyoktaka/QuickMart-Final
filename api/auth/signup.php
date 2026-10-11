<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/bootstrap.php';
require_post();

// Only initialize the FIRST manager via local XAMPP; never open public signups.
$host = $_SERVER['HTTP_HOST'] ?? '';
$remote = $_SERVER['REMOTE_ADDR'] ?? '';
if (!in_array($remote, ['127.0.0.1','::1'], true)
    || preg_match('/\A(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?\z/i', $host) !== 1) {
    json_response(['success' => false, 'message' => 'Manager setup is available only on localhost.'], 403);
}
$data = read_json_body();
$name = is_string($data['admin_name'] ?? null) ? trim($data['admin_name']) : '';
$email = is_string($data['email'] ?? null) ? trim($data['email']) : '';
$password = is_string($data['password'] ?? null) ? $data['password'] : '';
if (preg_match('/\A.{1,100}\z/us', $name) !== 1
    || strlen($email) > 100 || !filter_var($email, FILTER_VALIDATE_EMAIL)
    || strlen($password) < 8 || strlen($password) > 72 || str_contains($password, "\0")) {
    json_response(['success' => false, 'message' => 'Provide a manager name, valid email, and 8–72 byte password.'], 422);
}
try {
    $conn = auth_database();
    $dbName = $conn->query('SELECT DATABASE()')->fetchColumn();
    $lockName = 'quickmart.setup.' . substr(hash('sha256', (string) $dbName), 0, 48);
    $lock = $conn->prepare('SELECT GET_LOCK(:name, 5)');
    $lock->execute(['name' => $lockName]);
    if ((int) $lock->fetchColumn() !== 1) {
        json_response(['success' => false, 'message' => 'Setup is busy. Try again.'], 503);
    }
    try {
        if ((int) $conn->query('SELECT COUNT(*) FROM ADMINtbl')->fetchColumn() !== 0) {
            json_response(['success' => false, 'message' => 'Manager account already exists. Please sign in.'], 403);
        }
        $hash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $conn->prepare(
            'INSERT INTO ADMINtbl (admin_name, email, password_hash, status) VALUES (:name,:email,:hash,1)'
        );
        $stmt->execute(['name' => $name, 'email' => $email, 'hash' => $hash]);
    } finally {
        $release = $conn->prepare('SELECT RELEASE_LOCK(:name)');
        $release->execute(['name' => $lockName]);
    }
    json_response(['success' => true, 'message' => 'Initial manager account created. Please sign in.'], 201);
} catch (PDOException $e) {
    error_log('QuickMart signup database error: ' . get_class($e));
    json_response(['success' => false, 'message' => (string) $e->getCode() === '23000'
        ? 'Manager name or email already exists.' : 'Manager registration unavailable.'], 503);
} catch (Throwable $e) {
    error_log('QuickMart signup error: ' . get_class($e));
    json_response(['success' => false, 'message' => 'Manager registration unavailable.'], 503);
}
