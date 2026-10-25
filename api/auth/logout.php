<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/bootstrap.php';
require_post();
if (($_SESSION['kiosk_active'] ?? false) === true) {
    json_response(['success' => false, 'code' => 'KIOSK_ACTIVE', 'message' => 'Exit Product Recognition with the manager password before signing out.'], 403);
}
$_SESSION = [];
if (ini_get('session.use_cookies')) {
    $params = session_get_cookie_params();
    setcookie(session_name(), ' ', time() - 42000, $params['path'], $params['domain'] ?? '', (bool) $params['secure'], (bool) $params['httponly']);
}
session_destroy();
json_response(['success' => true, 'message' => 'Logged out.']);
