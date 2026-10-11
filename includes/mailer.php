<?php
declare(strict_types=1);

use PHPMailer\PHPMailer\PHPMailer;

require_once __DIR__ . '/../config/mail.php';

function send_password_reset_email(string $recipient, string $resetUrl, string $adminName = 'Manager'): bool
{
    if (MAIL_USERNAME === '' || MAIL_PASSWORD === '') {
        error_log('QuickMart SMTP environment variables have not been configured.');
        return false;
    }

    $autoload = __DIR__ . '/../vendor/autoload.php';
    if (!is_file($autoload)) {
        error_log('QuickMart PHPMailer dependency missing: run composer install.');
        return false;
    }

    try {
        require_once $autoload;
        $mail = new PHPMailer(true);
        $mail->isSMTP();
        $mail->Host = MAIL_HOST;
        $mail->Port = MAIL_PORT;
        $mail->SMTPAuth = true;
        $mail->Username = MAIL_USERNAME;
        $mail->Password = MAIL_PASSWORD;
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        $mail->CharSet = 'UTF-8';
        $mail->setFrom(MAIL_USERNAME, MAIL_FROM_NAME);
        $mail->addAddress($recipient, $adminName);
        $mail->isHTML(true);
        $mail->Subject = 'QuickMart - Manager Password Reset';

        $safeName = htmlspecialchars($adminName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeUrl = htmlspecialchars($resetUrl, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $mail->Body = '<p>Hello ' . $safeName . ',</p>'
            . '<p>A password reset was requested for your QuickMart manager account.</p>'
            . '<p><a href="' . $safeUrl . '">Reset your password</a></p>'
            . '<p>This link expires in 30 minutes and can be used only once.</p>'
            . '<p>If you did not request this, ignore this message.</p>';
        $mail->AltBody = "Hello {$adminName},\n\nReset your QuickMart password: {$resetUrl}\n\nThe link expires in 30 minutes and can be used only once.";

        return $mail->send();
    } catch (Throwable $e) {
        // Do not expose server paths, SMTP credentials or recipient addresses in API responses.
        error_log('QuickMart password reset email failed: ' . get_class($e));
        return false;
    }
}
