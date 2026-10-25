<?php
declare(strict_types=1);

// This test creates and drops only its own randomly named quickmart_test_backend_* database.
// The supplied DSN must point to a disposable MySQL/MariaDB test server, never production.
$dsn = getenv('QUICKMART_TEST_DSN');
if (!$dsn) { fwrite(STDERR, "Set QUICKMART_TEST_DSN to a disposable MySQL/MariaDB server.\n"); exit(2); }
$root = dirname(__DIR__);
$dbName = 'quickmart_test_backend_' . bin2hex(random_bytes(6));
$db = new PDO($dsn, getenv('QUICKMART_TEST_USER') ?: 'root', getenv('QUICKMART_TEST_PASSWORD') ?: '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$processes = [];
$logs = [];
$checks = 0;
function check(bool $condition, string $message): void
{
    global $checks;
    $checks++;
    if (!$condition) throw new RuntimeException($message);
}
function request(string $base, string $path, ?array $body, string &$cookie, int $expected = 200): array
{
    $headers = "Accept: application/json\r\n" . ($cookie ? "Cookie: $cookie\r\n" : '');
    if ($body !== null) $headers .= "Content-Type: application/json\r\n";
    $context = stream_context_create(['http' => ['method' => $body === null ? 'GET' : 'POST', 'header' => $headers,
        'content' => $body === null ? '' : json_encode($body, JSON_THROW_ON_ERROR), 'ignore_errors' => true, 'timeout' => 10]]);
    $urlPath = str_contains($path, '?') ? str_replace('?', '.php?', $path) : $path . '.php';
    $raw = file_get_contents($base . '/api/' . $urlPath, false, $context);
    $responseHeaders = $http_response_header ?? [];
    foreach ($responseHeaders as $header) if (preg_match('/^Set-Cookie:\s*([^;]+)/i', $header, $match)) $cookie = $match[1];
    preg_match('/\s(\d{3})\s/', $responseHeaders[0] ?? '', $match);
    $status = (int) ($match[1] ?? 0);
    $data = json_decode((string) $raw, true, 512, JSON_THROW_ON_ERROR);
    check($status === $expected, "$path expected HTTP $expected, got $status: " . ($data['message'] ?? (string) $raw));
    return $data;
}
function action(string $base, string &$cookie, string $id, string $action, array $extra = [], int $expected = 200): array
{
    return request($base, 'checkout/session', ['session_id' => $id, 'action' => $action] + $extra, $cookie, $expected);
}
function payment(string $base, string &$cookie, string $id, string $attempt, string $qr, int $expected = 200): array
{
    return request($base, 'checkout/process', ['session_id' => $id, 'attempt_id' => $attempt, 'payment_qr' => $qr], $cookie, $expected);
}
function reviewed(string $base, string &$cookie, string $id, array $epcs): array
{
    $review = action($base, $cookie, $id, 'review', ['epcs' => $epcs]);
    return action($base, $cookie, $id, 'confirm', ['revision' => $review['session']['revision']]);
}
try {
    $schema = file_get_contents($root . '/database/schema.sql');
    $schema = str_replace('rfid_checkout_main', $dbName, $schema);
    $db->exec($schema);
    $env = getenv();
    preg_match('/(?:^|;)host=([^;]+)/', substr($dsn, 6), $host);
    preg_match('/(?:^|;)port=([0-9]+)/', substr($dsn, 6), $port);
    $env['QUICKMART_DB_HOST'] = $host[1] ?? '127.0.0.1';
    $env['QUICKMART_DB_PORT'] = $port[1] ?? '3306';
    $env['QUICKMART_DB_NAME'] = $dbName;
    $env['QUICKMART_DB_USER'] = getenv('QUICKMART_TEST_USER') ?: 'root';
    $env['QUICKMART_DB_PASSWORD'] = getenv('QUICKMART_TEST_PASSWORD') ?: '';
    $env['QUICKMART_SMTP_USERNAME'] = '';
    $env['QUICKMART_SMTP_PASSWORD'] = '';
    $env['QUICKMART_APP_ENV'] = 'test';
    $env['QUICKMART_DEMO_CHECKOUT'] = '1';
    // Two real PHP HTTP servers share the test database/session store for concurrent-submit coverage.
    foreach ([0, 1] as $index) {
        $socket = stream_socket_server('tcp://127.0.0.1:0');
        $address = stream_socket_get_name($socket, false); fclose($socket);
        $log = tempnam(sys_get_temp_dir(), 'quickmart-test-'); $logs[] = $log;
        $process = proc_open([PHP_BINARY, '-S', $address, '-t', $root], [0 => ['pipe', 'r'], 1 => ['file', $log, 'a'], 2 => ['file', $log, 'a']], $pipes, $root, $env);
        if (!is_resource($process)) throw new RuntimeException('Could not start PHP test server.');
        fclose($pipes[0]); $processes[] = $process;
        $bases[$index] = 'http://' . $address;
        $ready = false;
        for ($attempt = 0; $attempt < 50; $attempt++) {
            $probe = @stream_socket_client('tcp://' . $address, $errno, $error, .1);
            if ($probe) { fclose($probe); $ready = true; break; }
            usleep(100000);
        }
        check($ready, 'PHP test server did not start.');
    }
    $base = $bases[0]; $cookie = ''; $other = ''; $anonymous = '';
    request($base, 'products/list', null, $anonymous, 401);
    request($base, 'checkout/session', null, $anonymous, 401);
    $password = 'QuickMart-test-42';
    request($base, 'auth/signup', ['admin_name' => 'Test Manager', 'email' => 'manager@example.test', 'password' => $password], $cookie, 201);
    request($base, 'auth/signup', ['admin_name' => 'Second', 'email' => 'second@example.test', 'password' => $password], $cookie, 403);
    request($base, 'auth/login', ['email' => 'manager@example.test', 'password' => 'wrong'], $other, 401);
    request($base, 'auth/login', ['email' => 'manager@example.test', 'password' => 'wrong'], $other, 401);
    request($base, 'auth/login', ['email' => 'manager@example.test', 'password' => 'wrong'], $other, 429);
    request($base, 'auth/login', ['email' => 'manager@example.test', 'password' => $password], $other, 429);
    $other = '';
    request($base, 'auth/login', ['email' => 'manager@example.test', 'password' => $password], $cookie);
    request($base, 'auth/login', ['email' => 'manager@example.test', 'password' => $password], $other);
    $created = request($base, 'products/create', ['product_name' => 'Test product', 'description' => '100 g', 'category' => 'Test', 'unit_price' => '12.34'], $cookie, 201);
    $product = $created['product']['product_id'];
    request($base, 'products/update', ['product_id' => $product, 'product_name' => 'Test product revised', 'description' => '100 g', 'category' => 'test', 'unit_price' => '12.34'], $cookie);
    check($db->query("SELECT category FROM PRODUCTtbl WHERE product_id=$product")->fetchColumn() === 'test', 'Category update failed.');
    request($base, 'rfid/register', ['product_id' => $product, 'epcs' => ['TEST_A']], $cookie, 403);
    request($base, 'rfid/authorize-restock', ['password' => $password], $cookie);
    $registered = request($base, 'rfid/register', ['product_id' => $product, 'epcs' => ['TEST_A', 'test_a', 'TEST_B', 'TEST_C', 'TEST_D', 'TEST_E', 'TEST_F', 'TEST_G', 'TEST_H', 'TEST_I']], $cookie);
    check($registered['registered_count'] === 9, 'RFID batch deduplication failed.');
    request($base, 'rfid/register', ['product_id' => $product, 'epcs' => ['TEST_J']], $cookie, 403);
    request($base, 'products/set-status', ['product_id' => $product, 'status' => 0], $cookie);
    request($base, 'products/set-status', ['product_id' => $product, 'status' => 1], $cookie);
    $disposable = request($base, 'products/create', ['product_name' => 'Disposable', 'unit_price' => '1.00'], $cookie, 201)['product']['product_id'];
    request($base, 'products/delete', ['product_id' => $disposable], $cookie);
    check((int) $db->query("SELECT status FROM PRODUCTtbl WHERE product_id=$disposable")->fetchColumn() === 0, 'Delete must preserve product row.');
    $scanDenied = request($base, 'rfid/detect', ['epcs' => ['TEST_A']], $cookie, 403);
    check($scanDenied['code'] === 'SCAN_AUTH_REQUIRED', 'Expired/missing scan authorization must be distinguishable from manager access denial.');
    request($base, 'auth/verify-password', ['password' => $password, 'purpose' => 'scan'], $cookie);
    $me = request($base, 'auth/me', null, $cookie);
    check($me['scan_authorized'] && $me['kiosk_active'], 'Server scan authorization absent.');
    check(request($base, 'checkout/session', null, $cookie)['session'] === null, 'Fresh kiosk must not recover a nonexistent checkout.');
    request($base, 'products/create', ['product_name' => 'Bypass', 'unit_price' => 1], $cookie, 403);
    request($base, 'dashboard/summary', null, $cookie, 403);
    request($base, 'transactions/list', null, $cookie, 403);
    request($base, 'auth/revoke-scan', [], $cookie, 403);
    request($base, 'auth/logout', [], $cookie, 403);
    $detected = request($base, 'rfid/detect', ['epcs' => ['TEST_A', 'TEST_A', 'TEST_B', 'UNKNOWN']], $cookie);
    check(count($detected['grouped_items']) === 1 && (int) $detected['grouped_items'][0]['quantity'] === 2, 'Different EPCs must count as physical items; repeated EPCs must not.');
    action($base, $cookie, 'ORDER_A', 'save', ['epcs' => ['TEST_A', 'TEST_B']]);
    check(request($base, 'checkout/session', null, $cookie)['session']['session_id'] === 'ORDER_A', 'Missing browser hint must recover the owned active checkout.');
    action($base, $cookie, 'ORDER_A', 'confirm', ['revision' => 2], 409);
    payment($base, $cookie, 'ORDER_A', 'ATTEMPT_EARLY', 'QMPAY|QM-WALLET-1001|C899', 409);
    $first = reviewed($base, $cookie, 'ORDER_A', ['TEST_A', 'TEST_A', 'TEST_B']);
    check($first['session']['total_items'] === 2 && $first['session']['total_amount'] === 24.68, 'Server checkout totals incorrect.');
    $deadline = $first['session']['deadline_at'];
    check($deadline > time() * 1000 && $deadline <= (time() + 301) * 1000, 'Payment deadline must be five minutes.');
    action($base, $cookie, 'ORDER_OTHER', 'save', ['epcs' => ['TEST_C']], 409);
    // A browser with the same manager credentials cannot recover or mutate another browser's checkout.
    action($base, $other, 'ORDER_A', 'cancel', [], 404);
    request($base, 'auth/verify-password', ['password' => $password], $other);
    payment($base, $other, 'ORDER_A', 'STOLEN', 'QMPAY|QM-WALLET-1001|C899', 404);
    $failure = payment($base, $cookie, 'ORDER_A', 'FAIL_1', 'invalid QR', 422);
    check($failure['session']['failed_attempts'] === 1, 'Invalid QR must consume exactly one attempt.');
    $replay = payment($base, $cookie, 'ORDER_A', 'FAIL_1', 'QMPAY|QM-WALLET-1001|C899', 422);
    check($replay['session']['failed_attempts'] === 1, 'Replayed attempt must not consume another attempt or change its outcome.');
    $edited = action($base, $cookie, 'ORDER_A', 'save', ['epcs' => []]);
    check($edited['session']['total_items'] === 0 && $edited['session']['failed_attempts'] === 1 && $edited['session']['deadline_at'] === $deadline, 'Cart edits reset deadline or attempts.');
    action($base, $cookie, 'ORDER_A', 'review', ['epcs' => []], 422);
    $again = reviewed($base, $cookie, 'ORDER_A', ['TEST_A', 'TEST_B']);
    check($again['session']['deadline_at'] === $deadline, 'Confirmation reset payment deadline.');
    $failure = payment($base, $cookie, 'ORDER_A', 'FAIL_2', 'QUICKMART-DEMO|NO_BALANCE|OFFLINE-V1', 422);
    check($failure['session']['attempts_left'] === 1, 'No-balance attempt not counted.');
    $failure = payment($base, $cookie, 'ORDER_A', 'FAIL_3', 'QUICKMART-DEMO|NO_INTERNET|OFFLINE-V1', 422);
    check($failure['session']['status'] === 'VOIDED' && $failure['session']['failed_attempts'] === 3, 'Third failure must void order.');
    check(request($base, 'checkout/session', null, $cookie)['session'] === null, 'No active checkout must not restore an old terminal checkout.');
    check(request($base, 'checkout/session?session_id=ORDER_A', null, $cookie)['session']['status'] === 'VOIDED', 'Hinted terminal checkout must remain recoverable.');
    payment($base, $cookie, 'ORDER_A', 'FAIL_4', 'QMPAY|QM-WALLET-1001|C899', 409);
    check((int) $db->query("SELECT COUNT(*) FROM PURCHASEtbl WHERE session_id='ORDER_A' AND status='UNSUCCESSFUL'")->fetchColumn() === 1, 'Voided history must be exactly once.');
    check((int) $db->query("SELECT COUNT(*) FROM RFID_tags WHERE epc IN ('TEST_A','TEST_B') AND status='AVAILABLE'")->fetchColumn() === 2, 'Failed checkout changed RFID stock.');
    reviewed($base, $cookie, 'ORDER_SUCCESS', ['TEST_A', 'TEST_B']);
    if (function_exists('curl_multi_init')) {
        $multi = curl_multi_init(); $handles = [];
        foreach ($bases as $index => $concurrentBase) {
            $handle = curl_init($concurrentBase . '/api/checkout/process.php');
            curl_setopt_array($handle, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode(['session_id' => 'ORDER_SUCCESS', 'attempt_id' => 'CONCURRENT_' . $index, 'payment_qr' => 'QUICKMART-DEMO|PAYMENT_SUCCESS|OFFLINE-V1']), CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Cookie: ' . $cookie], CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10]);
            curl_multi_add_handle($multi, $handle); $handles[] = $handle;
        }
        do { $status = curl_multi_exec($multi, $running); if ($running) curl_multi_select($multi, .2); } while ($running && $status === CURLM_OK);
        foreach ($handles as $handle) {
            $paid = json_decode(curl_multi_getcontent($handle), true, 512, JSON_THROW_ON_ERROR);
            check(curl_getinfo($handle, CURLINFO_HTTP_CODE) === 200 && $paid['success'], 'Concurrent payment/replay failed.');
            curl_multi_remove_handle($multi, $handle); curl_close($handle);
        }
        curl_multi_close($multi);
    } else payment($base, $cookie, 'ORDER_SUCCESS', 'SUCCESS_1', 'QUICKMART-DEMO|PAYMENT_SUCCESS|OFFLINE-V1');
    $paid = payment($base, $cookie, 'ORDER_SUCCESS', 'SUCCESS_2', 'QMPAY|QM-WALLET-1001|C899');
    check($paid['purchase']['total_amount'] === 24.68, 'Successful total mismatch.');
    check((int) $db->query("SELECT COUNT(*) FROM PURCHASEtbl WHERE session_id='ORDER_SUCCESS'")->fetchColumn() === 1, 'Repeated success created duplicate purchase.');
    check((int) $db->query("SELECT COUNT(*) FROM PURCHASE_items i JOIN PURCHASEtbl p ON p.purchase_id=i.purchase_id WHERE p.session_id='ORDER_SUCCESS'")->fetchColumn() === 2, 'Success missing physical item records.');
    check((int) $db->query("SELECT COUNT(*) FROM RFID_tags WHERE epc IN ('TEST_A','TEST_B') AND status='PURCHASED'")->fetchColumn() === 2, 'Successful checkout did not update tags.');
    action($base, $cookie, 'ORDER_SOLD', 'review', ['epcs' => ['TEST_A']], 409);
    reviewed($base, $cookie, 'ORDER_TIMEOUT', ['TEST_C']);
    $premature = action($base, $cookie, 'ORDER_TIMEOUT', 'timeout');
    check($premature['session']['status'] === 'PAYMENT', 'Client timer prematurely voided payment.');
    $db->exec("UPDATE CHECKOUT_sessions SET deadline_at='2000-01-01 00:00:00' WHERE session_id='ORDER_TIMEOUT'");
    $expired = action($base, $cookie, 'ORDER_TIMEOUT', 'status');
    check($expired['session']['status'] === 'VOIDED' && $expired['session']['reason'] === 'timeout', 'Backend deadline not enforced on recovery.');
    payment($base, $cookie, 'ORDER_TIMEOUT', 'TOO_LATE', 'QMPAY|QM-WALLET-1001|C899', 409);
    action($base, $cookie, 'ORDER_CANCEL', 'save', ['epcs' => ['TEST_D']]);
    action($base, $cookie, 'ORDER_CANCEL', 'cancel'); action($base, $cookie, 'ORDER_CANCEL', 'cancel');
    check((int) $db->query("SELECT COUNT(*) FROM PURCHASEtbl WHERE session_id='ORDER_CANCEL' AND attempt_status='cancelled'")->fetchColumn() === 1, 'Cancellation not idempotent.');
    reviewed($base, $cookie, 'ORDER_ROLLBACK', ['TEST_E', 'TEST_F']);
    $db->exec("CREATE TRIGGER test_checkout_rollback BEFORE UPDATE ON RFID_tags FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test rollback'");
    payment($base, $cookie, 'ORDER_ROLLBACK', 'ROLLBACK', 'QMPAY|QM-WALLET-1001|C899', 503);
    check((int) $db->query("SELECT COUNT(*) FROM PURCHASEtbl WHERE session_id='ORDER_ROLLBACK'")->fetchColumn() === 0, 'Failed transaction left partial purchase.');
    check((int) $db->query("SELECT COUNT(*) FROM RFID_tags WHERE epc IN ('TEST_E','TEST_F') AND status='AVAILABLE'")->fetchColumn() === 2, 'Failed transaction changed tags.');
    $db->exec('DROP TRIGGER test_checkout_rollback');
    payment($base, $cookie, 'ORDER_ROLLBACK', 'ROLLBACK', 'QMPAY|QM-WALLET-1001|C899');
    reviewed($base, $cookie, 'ORDER_PRICE', ['TEST_G']);
    $db->exec("UPDATE PRODUCTtbl SET unit_price=13.00 WHERE product_id=$product");
    payment($base, $cookie, 'ORDER_PRICE', 'STALE_PRICE', 'QMPAY|QM-WALLET-1001|C899', 409);
    action($base, $cookie, 'ORDER_PRICE', 'cancel');
    request($base, 'auth/verify-password', ['password' => $password, 'purpose' => 'exit'], $cookie);
    request($base, 'auth/revoke-scan', [], $cookie);
    request($base, 'dashboard/summary', null, $cookie);
    request($base, 'transactions/list', null, $cookie);
    // Reset links are hashed, single use, and revoke already-authenticated sessions.
    $rawToken = str_repeat('a', 64); $hash = hash('sha256', $rawToken);
    $db->prepare('INSERT INTO PASSWORD_RESET_tokens (admin_id,token_hash,expires_at) SELECT admin_id,?,DATE_ADD(NOW(),INTERVAL 30 MINUTE) FROM ADMINtbl LIMIT 1')->execute([$hash]);
    $newPassword = 'QuickMart-replaced-42';
    request($base, 'auth/reset-password', ['token' => $rawToken, 'password' => $newPassword], $anonymous);
    request($base, 'auth/reset-password', ['token' => $rawToken, 'password' => $newPassword], $anonymous, 400);
    $me = request($base, 'auth/me', null, $cookie); check(!$me['authenticated'], 'Password reset did not revoke old authentication.');
    request($base, 'auth/login', ['email' => 'manager@example.test', 'password' => $newPassword], $cookie);
    $expiredToken = str_repeat('b', 64);
    $db->prepare("INSERT INTO PASSWORD_RESET_tokens (admin_id,token_hash,expires_at) SELECT admin_id,?,'2000-01-01' FROM ADMINtbl LIMIT 1")->execute([hash('sha256', $expiredToken)]);
    request($base, 'auth/reset-password', ['token' => $expiredToken, 'password' => $newPassword], $anonymous, 400);
    $unknown = request($base, 'auth/forgot-password', ['email' => 'unknown@example.test'], $anonymous);
    $known = request($base, 'auth/forgot-password', ['email' => 'manager@example.test'], $anonymous);
    check($unknown === $known, 'Password reset leaked registered email status.');
    request($base, 'auth/logout', [], $cookie);
    request($base, 'products/list', null, $cookie, 401);
    echo "Backend HTTP/MySQL integration: $checks checks passed" . (function_exists('curl_multi_init') ? ', concurrent submissions covered' : ', cURL concurrency unavailable') . ".\n";
} finally {
    foreach ($processes as $process) { proc_terminate($process); proc_close($process); }
    foreach ($logs as $log) @unlink($log);
    if (preg_match('/^quickmart_test_backend_[a-f0-9]{12}$/D', $dbName)) $db->exec('DROP DATABASE IF EXISTS `' . $dbName . '`');
}
