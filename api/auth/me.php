<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/bootstrap.php';
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    json_response(['success' => false, 'message' => 'Only GET requests are allowed.'], 405);
}
$manager = current_manager();
$authorizedAt = $_SESSION['scan_authorized_at'] ?? 0;
$scanAuthorized = $manager !== null && ($_SESSION['scan_authorized'] ?? false) === true
    && is_int($authorizedAt) && $authorizedAt > 0 && $authorizedAt <= time()
    && time() - $authorizedAt < SCAN_AUTHORIZATION_TIMEOUT;
$kioskActive = $manager !== null && ($_SESSION['kiosk_active'] ?? false) === true;
session_write_close(); // read-only: free the session lock
if ($manager === null) {
    json_response(['success' => true, 'authenticated' => false, 'manager' => null]);
}
json_response(['success' => true, 'authenticated' => true, 'manager' => manager_response($manager),
    'scan_authorized' => $scanAuthorized, 'kiosk_active' => $kioskActive]);
