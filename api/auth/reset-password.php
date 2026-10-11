<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config/bootstrap.php';

require_post();
$data = read_json_body();
$token = is_string($data['token'] ?? null) ? trim($data['token']) : '';
$password = is_string($data['password'] ?? null) ? $data['password'] : '';

if (!preg_match('/^[a-f0-9]{64}$/D', $token)) {
    json_response(['success' => false, 'message' => 'Invalid or expired reset link.'], 422);
}

if (strlen($password) < 8 || strlen($password) > 72 || str_contains($password, "\0")) {
    json_response(['success' => false, 'message' => 'Password must be 8 to 72 bytes.'], 422);
}

$tokenHash = hash('sha256', $token);

try {
    $conn = auth_database();

    $ownerStmt = $conn->prepare(
        'SELECT admin_id
         FROM PASSWORD_RESET_tokens
         WHERE token_hash = :token_hash AND used_at IS NULL AND expires_at > NOW()
         LIMIT 1'
    );
    $ownerStmt->execute(['token_hash' => $tokenHash]);
    $owner = $ownerStmt->fetch();
    if (!$owner) {
        json_response(['success' => false, 'message' => 'Invalid or expired reset link.'], 400);
    }

    $conn->beginTransaction();

    $adminStmt = $conn->prepare(
        'SELECT admin_id
         FROM ADMINtbl
         WHERE admin_id = :admin_id AND status = 1
         LIMIT 1 FOR UPDATE'
    );
    $adminStmt->execute(['admin_id' => $owner['admin_id']]);
    if (!$adminStmt->fetch()) {
        $conn->rollBack();
        json_response(['success' => false, 'message' => 'Invalid or expired reset link.'], 400);
    }

    $tokenStmt = $conn->prepare(
        'SELECT reset_id
         FROM PASSWORD_RESET_tokens
         WHERE token_hash = :token_hash AND admin_id = :admin_id
           AND used_at IS NULL AND expires_at > NOW()
         LIMIT 1 FOR UPDATE'
    );
    $tokenStmt->execute([
        'token_hash' => $tokenHash,
        'admin_id' => $owner['admin_id']
    ]);
    if (!$tokenStmt->fetch()) {
        $conn->rollBack();
        json_response(['success' => false, 'message' => 'Invalid or expired reset link.'], 400);
    }

    $newHash = password_hash($password, PASSWORD_DEFAULT);
    $update = $conn->prepare(
        'UPDATE ADMINtbl SET password_hash = :password_hash
         WHERE admin_id = :admin_id AND status = 1'
    );
    $update->execute([
        'password_hash' => $newHash,
        'admin_id' => $owner['admin_id']
    ]);
    if ($update->rowCount() !== 1) {
        throw new RuntimeException('Reset did not update an active account.');
    }

    $consume = $conn->prepare(
        'UPDATE PASSWORD_RESET_tokens SET used_at = NOW()
         WHERE admin_id = :admin_id AND used_at IS NULL'
    );
    $consume->execute(['admin_id' => $owner['admin_id']]);

    $conn->commit();
    
    clear_manager_session();
    json_response(['success' => true, 'message' => 'Password reset successfully. You can now sign in.']);
} catch (Throwable $e) {
    if (isset($conn) && $conn instanceof PDO && $conn->inTransaction()) {
        $conn->rollBack();
    }
    error_log('QuickMart reset-password failed: ' . get_class($e));
    json_response(['success' => false, 'message' => 'Could not reset password. Please try again.'], 500);
}
