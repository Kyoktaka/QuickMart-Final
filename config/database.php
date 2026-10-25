<?php
declare(strict_types=1);

$host = getenv('QUICKMART_DB_HOST') ?: 'localhost';
$port = (int) (getenv('QUICKMART_DB_PORT') ?: 3306);
$dbname = getenv('QUICKMART_DB_NAME') ?: 'rfid_checkout_main';
$username = getenv('QUICKMART_DB_USER') ?: 'root';
$password = getenv('QUICKMART_DB_PASSWORD') !== false ? getenv('QUICKMART_DB_PASSWORD') : '';

// test connection | Powershell (project folder):
// & 'C:\xampp\php\php.exe' --% -r "require 'config/database.php'; echo 'galing IT na';"
// make sure na run nyo muna ung schema.sql sa database "rfid_checkout"

$query = "mysql:host={$host};port={$port};dbname={$dbname};charset=utf8mb4";

try {
    $conn = new PDO($query, $username, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
} catch (PDOException $e) {
    error_log('Database connection failed: ' . $e->getMessage());

    throw new RuntimeException('Database connection unavailable.', 0, $e);
}
?>
