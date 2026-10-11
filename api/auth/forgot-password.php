<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config/bootstrap.php';
require_once __DIR__ . '/../../config/mail.php';
require_once __DIR__ . '/../../includes/mailer.php';

require_post();
$data = read_json_body();
$email = is_string($data['email'] ?? null) ? trim($data['email']) : '';

$generic = [
    'success' => true,
    'message' => 'If that email is registered, a password reset link has been sent.'
];

if ($email === '' || strlen($email) > 100 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_response($generic);
}

try {
    $conn = auth_database();
    $conn->beginTransaction();

    $lookup = $conn->prepare(
        'SELECT admin_id, admin_name, email
         FROM ADMINtbl
         WHERE email = :email AND status = 1
         LIMIT 1 FOR UPDATE'
    );
    $lookup->execute(['email' => $email]);
    $admin = $lookup->fetch();

    if (!$admin) {
        $conn->commit();
        json_response($generic);
    }

    $rawToken = bin2hex(random_bytes(32));
    $hash = hash('sha256', $rawToken);

    $invalidate = $conn->prepare(
        'UPDATE PASSWORD_RESET_tokens
         SET used_at = NOW()
         WHERE admin_id = :admin_id AND used_at IS NULL'
    );
    $invalidate->execute(['admin_id' => $admin['admin_id']]);

    $insert = $conn->prepare(
        'INSERT INTO PASSWORD_RESET_tokens (admin_id, token_hash, expires_at)
         VALUES (:admin_id, :token_hash, DATE_ADD(NOW(), INTERVAL 30 MINUTE))'
    );
    $insert->execute([
        'admin_id' => $admin['admin_id'],
        'token_hash' => $hash
    ]);

    $conn->commit();

    $url = rtrim(APP_BASE_URL, '/') . '/manager/reset-password.html?token=' . urlencode($rawToken);
    if (!send_password_reset_email((string) $admin['email'], $url, (string) $admin['admin_name'])) {
        error_log('QuickMart password reset email delivery failed.');
    }
} catch (Throwable $e) {
    if (isset($conn) && $conn instanceof PDO && $conn->inTransaction()) {
        $conn->rollBack();
    }
    error_log('QuickMart forgot-password failed: ' . get_class($e));
}
json_response($generic);
