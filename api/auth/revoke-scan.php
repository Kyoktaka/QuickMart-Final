<?php

declare(strict_types=1);

require_once __DIR__ . '/../../config/bootstrap.php';
require_manager();
require_post();

unset($_SESSION['scan_authorized'], $_SESSION['scan_authorized_at']);

json_response([
    'success' => true,
    'message' => 'Scanning authorization revoked.'
]);
