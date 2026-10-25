<?php
declare(strict_types=1);

const MANAGER_IDLE_TIMEOUT = 1800;
const MANAGER_SESSION_TIMEOUT = 28800;
const SCAN_AUTHORIZATION_TIMEOUT = 900;
const RESTOCK_AUTHORIZATION_TIMEOUT = 120; // seconds a manager password approval stays valid for ONE EPC registration
const AUTH_MAX_ATTEMPTS = 3;   // wrong passwords allowed before a temporary lockout
const AUTH_LOCK_SECONDS = 60;  // how long the lockout lasts

if (session_status() !== PHP_SESSION_ACTIVE) {
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', (string) MANAGER_IDLE_TIMEOUT);
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'httponly' => true,
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'samesite' => 'Lax',
    ]);
    if (!session_start()) {
        json_response(['success' => false, 'message' => 'Session unavailable. Please try again.'], 503);
    }
}

/* Categories ignore upper/lower case: if "Egg" is already registered, "egg" / "EGG" reuse "Egg". */
function canonical_category(PDO $db, string $category, int $exceptProductId = 0): string
{
    $stmt = $db->prepare(
        'SELECT category FROM PRODUCTtbl '
        . 'WHERE LOWER(category) = LOWER(:category) AND product_id <> :except_id '
        . 'ORDER BY product_id ASC LIMIT 1'
    );
    $stmt->execute([':category' => $category, ':except_id' => $exceptProductId]);
    $found = $stmt->fetchColumn();
    return is_string($found) && trim($found) !== '' ? trim($found) : $category;
}

function json_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function require_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        header('Allow: POST');
        json_response(['success' => false, 'message' => 'Only POST requests are allowed.'], 405);
    }
    // Existing frontend mutations use same-origin fetch requests.
    if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') {
        json_response(['success' => false, 'message' => 'Cross-site requests are not allowed.'], 403);
    }
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false) {
        json_response(['success' => false, 'message' => 'Could not read request body.'], 400);
    }
    if (trim($raw) === '') {
        return [];
    }
    $contentType = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
    if ($contentType !== 'application/json') {
        json_response(['success' => false, 'message' => 'Use application/json for the request body.'], 415);
    }
    try {
        $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        json_response(['success' => false, 'message' => 'Malformed JSON request.'], 400);
    }
    if (!is_array($data) || substr(ltrim($raw), 0, 1) !== '{') {
        json_response(['success' => false, 'message' => 'The request body must be a JSON object.'], 400);
    }
    return $data;
}

function auth_database(): PDO
{
    global $conn;
    try {
        // revoke-scan.php includes only bootstrap; preserve its existing contract.
        if (!isset($conn)) {
            require_once __DIR__ . '/database.php';
        }
        if (!$conn instanceof PDO) {
            throw new RuntimeException('PDO connection unavailable.');
        }
        return $conn;
    } catch (Throwable $e) {
        error_log('QuickMart authentication database unavailable: ' . get_class($e));
        json_response(['success' => false, 'message' => 'Database unavailable. Please try again.'], 503);
    }
}

/* ---------- failed-attempt limiter (3 tries, then a temporary lockout) ----------
   Counted per PHP session, separately for each bucket ('login', 'verify_password'). */
function attempt_lock_remaining(string $bucket): int
{
    $entry = $_SESSION['auth_attempts'][$bucket] ?? null;
    if (!is_array($entry)) {
        return 0;
    }
    $until = (int) ($entry['locked_until'] ?? 0);
    $now = time();
    if ($until > $now) {
        return $until - $now;
    }
    if ($until > 0) {
        unset($_SESSION['auth_attempts'][$bucket]); // lockout finished: fresh set of attempts
    }
    return 0;
}

function attempt_block_if_locked(string $bucket): void
{
    $left = attempt_lock_remaining($bucket);
    if ($left > 0) {
        json_response([
            'success' => false,
            'message' => 'Too many failed attempts. Try again in ' . $left . ' second' . ($left === 1 ? '' : 's') . '.',
            'attempts_left' => 0,
            'retry_after' => $left,
        ], 429);
    }
}

function attempt_reset(string $bucket): void
{
    unset($_SESSION['auth_attempts'][$bucket]);
}

function attempt_fail(string $bucket, string $message): never
{
    $count = (int) ($_SESSION['auth_attempts'][$bucket]['count'] ?? 0) + 1;
    if ($count >= AUTH_MAX_ATTEMPTS) {
        $_SESSION['auth_attempts'][$bucket] = ['count' => $count, 'locked_until' => time() + AUTH_LOCK_SECONDS];
        json_response([
            'success' => false,
            'message' => 'Too many failed attempts. Try again in ' . AUTH_LOCK_SECONDS . ' seconds.',
            'attempts_left' => 0,
            'retry_after' => AUTH_LOCK_SECONDS,
        ], 429);
    }
    $_SESSION['auth_attempts'][$bucket] = ['count' => $count, 'locked_until' => 0];
    $left = AUTH_MAX_ATTEMPTS - $count;
    json_response([
        'success' => false,
        'message' => $message . ' ' . $left . ' attempt' . ($left === 1 ? '' : 's') . ' left.',
        'attempts_left' => $left,
        'retry_after' => 0,
    ], 401);
}

function clear_manager_session(): void
{
    foreach (['manager_authenticated', 'manager_id', 'manager_name', 'manager_email',
        'manager_password_fingerprint', 'manager_signed_in_at', 'manager_last_active_at',
        'scan_authorized', 'scan_authorized_at', 'restock_authorized_at', 'checkout_owner',
        'kiosk_active', 'kiosk_exit_authorized_at'] as $key) {
        unset($_SESSION[$key]);
    }
}

function manager_response(array $manager): array
{
    return [
        'manager_id' => (int) $manager['admin_id'],
        'manager_name' => $manager['admin_name'],
        'email' => $manager['email'],
    ];
}

function current_manager(): ?array
{
    $now = time();
    $signedIn = $_SESSION['manager_signed_in_at'] ?? 0;
    $lastActive = $_SESSION['manager_last_active_at'] ?? 0;
    if (($_SESSION['manager_authenticated'] ?? false) !== true
        || !is_int($_SESSION['manager_id'] ?? null) || $_SESSION['manager_id'] < 1
        || !is_int($signedIn) || $signedIn <= 0 || $signedIn > $now
        || !is_int($lastActive) || $lastActive <= 0 || $lastActive > $now
        || $now - $signedIn >= MANAGER_SESSION_TIMEOUT
        || $now - $lastActive >= MANAGER_IDLE_TIMEOUT) {
        clear_manager_session();
        return null;
    }
    try {
        $stmt = auth_database()->prepare(
            'SELECT admin_id, admin_name, email, password_hash, status FROM ADMINtbl WHERE admin_id = :admin_id LIMIT 1'
        );
        $stmt->execute(['admin_id' => $_SESSION['manager_id']]);
        $manager = $stmt->fetch();
    } catch (PDOException $e) {
        error_log('QuickMart manager lookup failed.');
        json_response(['success' => false, 'message' => 'Could not verify manager session.'], 503);
    }
    $fingerprint = $_SESSION['manager_password_fingerprint'] ?? '';
    if (!$manager || (int) $manager['status'] !== 1 || !is_string($fingerprint)
        || !hash_equals(hash('sha256', $manager['password_hash']), $fingerprint)) {
        clear_manager_session();
        return null;
    }
    $_SESSION['manager_last_active_at'] = $now;
    return $manager;
}

function require_manager(bool $allowKiosk = false): void
{
    if (current_manager() === null) {
        json_response(['success' => false, 'authenticated' => false, 'message' => 'Manager authentication required.'], 401);
    }
    if (!$allowKiosk && ($_SESSION['kiosk_active'] ?? false) === true) {
        json_response(['success' => false, 'code' => 'KIOSK_ACTIVE', 'message' => 'Manager password is required to leave Product Recognition.'], 403);
    }
}

function require_scan_authorized(): void
{
    require_manager(true);
    $authorizedAt = $_SESSION['scan_authorized_at'] ?? 0;
    if (($_SESSION['scan_authorized'] ?? false) !== true || !is_int($authorizedAt)
        || $authorizedAt <= 0 || $authorizedAt > time()
        || time() - $authorizedAt >= SCAN_AUTHORIZATION_TIMEOUT) {
        unset($_SESSION['scan_authorized'], $_SESSION['scan_authorized_at']);
        json_response(['success' => false, 'code' => 'SCAN_AUTH_REQUIRED', 'message' => 'Manager must authorize customer scanning first.'], 403);
    }
}

/* EPC tag registration (Inventory > Restock) needs a fresh manager password approval.
   authorize-restock.php grants it; register.php uses it up on a successful registration. */
function require_restock_authorized(): void
{
    require_manager();
    $authorizedAt = $_SESSION['restock_authorized_at'] ?? 0;
    if (!is_int($authorizedAt) || $authorizedAt <= 0 || $authorizedAt > time()
        || time() - $authorizedAt >= RESTOCK_AUTHORIZATION_TIMEOUT) {
        unset($_SESSION['restock_authorized_at']);
        json_response([
            'success' => false,
            'code' => 'RESTOCK_AUTH_REQUIRED',
            'message' => 'Manager password is required to register EPC tags.',
        ], 403);
    }
}
