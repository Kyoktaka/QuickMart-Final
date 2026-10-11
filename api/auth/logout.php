<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/bootstrap.php';
if ($_SERVER['REQUEST_METHOD'] !== 'POST')
    json_response(['success' => false, 'message' => 'Only POST requests are allowed.'], 405);
$_SESSION = [];
if (ini_get('session.use_cookies')) {
    $params = session_get_cookie_params();
    setcookie(session_name(), ' ', time() - 42000, $params['path'], $params['domain'] ?? '', (bool) $params['secure'], (bool) $params['httponly']);
}
session_destroy();
json_response(['success' => true, 'message' => 'Logged out.']);
