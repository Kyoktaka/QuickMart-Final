<?php

declare(strict_types=1);

require_once __DIR__ . '/../../config/bootstrap.php';
require_manager(true);
require_post();

if (($_SESSION['kiosk_active'] ?? false) === true
    && (time() - (int) ($_SESSION['kiosk_exit_authorized_at'] ?? 0) >= 60)) {
    json_response(['success' => false, 'code' => 'EXIT_AUTH_REQUIRED', 'message' => 'Verify the manager password before leaving Product Recognition.'], 403);
}

unset($_SESSION['scan_authorized'], $_SESSION['scan_authorized_at'], $_SESSION['kiosk_active'], $_SESSION['kiosk_exit_authorized_at']);

json_response([
    'success' => true,
    'message' => 'Scanning authorization revoked.'
]);
