<?php
declare(strict_types=1);

$message = '';
$messageType = 'error';
$setupAvailable = false;
$csrfToken = '';
$requestMethod = $_SERVER['REQUEST_METHOD'] ?? '';
$remoteAddress = $_SERVER['REMOTE_ADDR'] ?? '';
$requestHost = $_SERVER['HTTP_HOST'] ?? '';

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

// Setup is an explicit, local-only operation. Never trust forwarded headers here.
$localRequest = in_array($remoteAddress, ['127.0.0.1', '::1'], true)
    && preg_match('/\A(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?\z/i', $requestHost) === 1;

if (!$localRequest) {
    http_response_code(403);
    $message = 'Initial manager setup is available only through localhost.';
} elseif (!in_array($requestMethod, ['GET', 'POST'], true)) {
    http_response_code(405);
    header('Allow: GET, POST');
    $message = 'Please use the account setup form.';
} else {
    try {
        require_once __DIR__ . '/../config/bootstrap.php';
        require_once __DIR__ . '/../config/database.php';

        if (!$conn instanceof PDO) {
            throw new RuntimeException('Setup connection unavailable.');
        }

        if ((int) $conn->query('SELECT COUNT(*) FROM ADMINtbl')->fetchColumn() > 0) {
            http_response_code(403);
            $message = 'Initial manager setup has already been completed.';
            unset($_SESSION['manager_setup_csrf']);
        } else {
            $setupAvailable = true;
            if (!is_string($_SESSION['manager_setup_csrf'] ?? null)
                || strlen($_SESSION['manager_setup_csrf']) !== 64) {
                $_SESSION['manager_setup_csrf'] = bin2hex(random_bytes(32));
            }
            $csrfToken = $_SESSION['manager_setup_csrf'];

            if ($requestMethod === 'POST') {
                $submittedToken = $_POST['csrf_token'] ?? null;
                $managerName = $_POST['manager_name'] ?? null;
                $email = $_POST['email'] ?? null;
                $password = $_POST['password'] ?? null;

                if (!is_string($submittedToken) || !hash_equals($csrfToken, $submittedToken)) {
                    http_response_code(403);
                    $message = 'Your setup session could not be verified. Please reload the page.';
                } elseif (!is_string($managerName) || !is_string($email) || !is_string($password)) {
                    http_response_code(422);
                    $message = 'Please complete all fields with valid text.';
                } else {
                    $managerName = trim($managerName);
                    $email = trim($email);

                    if (preg_match('/\A.{1,100}\z/us', $managerName) !== 1) {
                        http_response_code(422);
                        $message = 'Manager name must contain 1 to 100 valid characters.';
                    } elseif (strlen($email) > 100 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                        http_response_code(422);
                        $message = 'Please enter a valid email address of at most 100 characters.';
                    } elseif (strlen($password) < 8 || strlen($password) > 72 || strpos($password, "\0") !== false) {
                        http_response_code(422);
                        $message = 'Password must contain 8 to 72 bytes and no null characters.';
                    } else {
                        // Serialize first-account creation across requests for this database.
                        $databaseName = $conn->query('SELECT DATABASE()')->fetchColumn();
                        if (!is_string($databaseName) || $databaseName === '') {
                            throw new RuntimeException('Setup database unavailable.');
                        }
                        $lockName = 'quickmart.setup.' . substr(hash('sha256', $databaseName), 0, 48);
                        $lock = $conn->prepare('SELECT GET_LOCK(:lock_name, 5)');
                        $lock->execute(['lock_name' => $lockName]);
                        if ((int) $lock->fetchColumn() !== 1) {
                            throw new RuntimeException('Setup lock unavailable.');
                        }

                        try {
                            if ((int) $conn->query('SELECT COUNT(*) FROM ADMINtbl')->fetchColumn() > 0) {
                                http_response_code(403);
                                $setupAvailable = false;
                                $message = 'Initial manager setup has already been completed.';
                                unset($_SESSION['manager_setup_csrf']);
                            } else {
                                $passwordHash = password_hash($password, PASSWORD_DEFAULT);
                                if (!is_string($passwordHash)) {
                                    throw new RuntimeException('Password hashing unavailable.');
                                }
                                $stmt = $conn->prepare(
                                    'INSERT INTO ADMINtbl (admin_name, email, password_hash, status) '
                                    . 'VALUES (:admin_name, :email, :password_hash, 1)'
                                );
                                $stmt->execute([
                                    'admin_name' => $managerName,
                                    'email' => $email,
                                    'password_hash' => $passwordHash,
                                ]);

                                $setupAvailable = false;
                                $message = 'Manager account created successfully.';
                                $messageType = 'success';
                                unset($_SESSION['manager_setup_csrf']);
                            }
                        } finally {
                            $release = $conn->prepare('SELECT RELEASE_LOCK(:lock_name)');
                            $release->execute(['lock_name' => $lockName]);
                            if ((int) $release->fetchColumn() !== 1) {
                                throw new RuntimeException('Setup lock release failed.');
                            }
                        }
                    }
                }
            }
        }
    } catch (PDOException $e) {
        $messageType = 'error';
        if ((string) $e->getCode() === '23000') {
            http_response_code(409);
            $message = 'An account with this manager name or email already exists.';
        } else {
            http_response_code(503);
            $setupAvailable = false;
            $message = 'Account setup is temporarily unavailable. Please try again later.';
        }
        error_log('QuickMart manager setup database operation failed.');
    } catch (Throwable $e) {
        http_response_code(503);
        $setupAvailable = false;
        $messageType = 'error';
        $message = 'Account setup is temporarily unavailable. Please try again later.';
        error_log('QuickMart manager setup unavailable.');
    }
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Manager Account Setup</title>

    <style>
        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f4f6f8;
            font-family: Arial, sans-serif;
        }

        .container {
            width: 100%;
            max-width: 420px;
            background: #ffffff;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
        }

        h1 {
            margin-top: 0;
            margin-bottom: 8px;
            font-size: 24px;
        }

        p {
            color: #666;
            margin-bottom: 25px;
        }

        label {
            display: block;
            margin-bottom: 6px;
            font-weight: 600;
        }

        input {
            width: 100%;
            padding: 12px;
            margin-bottom: 16px;
            border: 1px solid #ccc;
            border-radius: 8px;
            font-size: 14px;
        }

        button {
            width: 100%;
            padding: 12px;
            border: none;
            border-radius: 8px;
            background: #111827;
            color: white;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
        }

        button:hover {
            background: #1f2937;
        }

        .message {
            padding: 12px;
            margin-bottom: 18px;
            border-radius: 8px;
            font-size: 14px;
        }

        .success {
            background: #e8f7ee;
            color: #18743a;
        }

        .error {
            background: #fdeaea;
            color: #b42318;
        }
    </style>
</head>

<body>

    <div class="container">

        <h1>Create Manager Account</h1>

        <p>
            This page is only for initial manager account creation.
        </p>

        <?php if ($message !== ''): ?>
            <div class="message <?= htmlspecialchars($messageType) ?>">
                <?= htmlspecialchars($message) ?>
            </div>
        <?php endif; ?>

        <?php if ($setupAvailable): ?>
        <form method="POST">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">

            <label for="manager_name">Manager Name</label>
            <input type="text" id="manager_name" name="manager_name" placeholder="Enter manager name" required>

            <label for="email">Email</label>
            <input type="email" id="email" name="email" placeholder="manager@gmail.com" required>

            <label for="password">Password</label>
            <input type="password" id="password" name="password" placeholder="Minimum 8 characters" required>

            <button type="submit">
                Create Manager Account
            </button>

        </form>
        <?php endif; ?>

    </div>

</body>

</html>
