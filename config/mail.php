<?php
declare(strict_types=1);

define('MAIL_HOST', getenv('QUICKMART_SMTP_HOST') ?: 'smtp.gmail.com');
define('MAIL_PORT', (int) (getenv('QUICKMART_SMTP_PORT') ?: 587));
define('MAIL_USERNAME', getenv('QUICKMART_SMTP_USERNAME') ?: '');
define('MAIL_PASSWORD', getenv('QUICKMART_SMTP_PASSWORD') ?: '');
define('MAIL_FROM_NAME', 'QuickMart');
define('APP_BASE_URL', getenv('QUICKMART_APP_BASE_URL') ?: 'http://localhost/QuickMart-Final');
