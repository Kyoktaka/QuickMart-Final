<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config/bootstrap.php';
require_once __DIR__ . '/../../config/database.php';
require_manager();
require_post();

$data = read_json_body();
$sessionId = $data['session_id'] ?? null;
$status = $data['status'] ?? null;
$amount = $data['total_amount'] ?? 0;
$items = filter_var(
    $data['total_items'] ?? 0,
    FILTER_VALIDATE_INT,
    ['options' => ['min_range' => 0, 'max_range' => 100]]
);

if (!is_string($sessionId) || !preg_match('/^[A-Za-z0-9_-]{1,50}$/D', $sessionId)) {
    json_response(['success' => false, 'message' => 'Valid session_id is required.'], 422);
}
if (!in_array($status, ['failed', 'cancelled'], true)) {
    json_response(['success' => false, 'message' => 'Only failed or cancelled attempts can be logged here.'], 422);
}
if (!is_numeric($amount) || !is_finite((float) $amount) || (float) $amount < 0 || (float) $amount > 99999999.99) {
    json_response(['success' => false, 'message' => 'Invalid attempted total amount.'], 422);
}
if ($items === false) {
    json_response(['success' => false, 'message' => 'Invalid attempted item count.'], 422);
}

try {
    $insert = $conn->prepare(
        "INSERT INTO PURCHASEtbl
         (admin_id, session_id, status, attempt_status, attempted_items, total_amount)
         VALUES (:admin_id, :session_id, 'UNSUCCESSFUL', :attempt_status, :attempted_items, :total_amount)"
    );
    $insert->execute([
        'admin_id' => (int) $_SESSION['manager_id'],
        'session_id' => $sessionId,
        'attempt_status' => $status,
        'attempted_items' => $items,
        'total_amount' => number_format((float) $amount, 2, '.', '')
    ]);
    json_response([
        'success' => true,
        'message' => 'Unsuccessful checkout attempt recorded.',
        'session_id' => $sessionId,
        'status' => $status
    ]);
} catch (PDOException $e) {
    if ((string) $e->getCode() === '23000') {
        try {
            $check = $conn->prepare(
                'SELECT status, attempt_status FROM PURCHASEtbl WHERE session_id = :session_id LIMIT 1'
            );
            $check->execute(['session_id' => $sessionId]);
            $existing = $check->fetch();
            if ($existing && $existing['status'] === 'UNSUCCESSFUL'
                && $existing['attempt_status'] === $status) {
                json_response([
                    'success' => true, 'message' => 'Attempt already recorded.',
                    'session_id' => $sessionId, 'status' => $status
                ]);
            }
        } catch (Throwable $ignored) {
            error_log('QuickMart checkout log duplicate lookup failed.');
        }
        json_response(['success' => false, 'message' => 'This session has already been used.'], 409);
    }
    error_log('QuickMart checkout log database error: ' . get_class($e));
    json_response(['success' => false, 'message' => 'Could not record checkout attempt.'], 500);
}
