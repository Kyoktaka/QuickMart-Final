<?php
declare(strict_types=1);

// Run only against a disposable MySQL/MariaDB service; requires CREATE/DROP DATABASE.
// The production application configuration is deliberately never loaded here.
require dirname(__DIR__) . '/tools/database-upgrade.php';

$dsn = getenv('QUICKMART_TEST_DSN');
if (!$dsn || stripos($dsn, 'dbname=') !== false) {
    fwrite(STDERR, "Set QUICKMART_TEST_DSN to a disposable MySQL server DSN WITHOUT dbname.\n");
    exit(1);
}
$checks = 0;
function database_check(bool $condition, string $message): void
{
    global $checks;
    $checks++;
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

// Values transcribed from OOP_Products (1).xlsx, sheet1 A2:D11.
// The workbook's spelling is intentional; trailing cell-format whitespace is trimmed.
$expectedCatalog = [
    ['Alcohol Dispenser', 'Compact and Refillable (20g)', '30.00', 'Home Essentials'],
    ['Focus Refillable Fillers', 'Lighweight Pulp Paper (55gsm)', '25.00', 'Home Essentials'],
    ['Rice Scooper', 'Recyclable Plastic Material (18g)', '32.00', 'Home Essentials'],
    ['Lasap Iodized Salt', 'Premium Quality (100g)', '16.00', 'Food & Snacks'],
    ['Sleek Stockings', 'Soft and Breathable (1 pair)', '60.00', 'Clothing'],
    ['Colgate Toothbrush', 'Recyclable Plastic Material', '20.00', 'Home Essentials'],
    ['Dumpling Squishy', 'Fun and Relaxing (160g)', '67.00', 'Toys'],
    ['Lablast Detergent Bar', 'Floral Scent (130g)', '12.00', 'Home Essentials'],
    ['Pocky Snack Box', 'Chocolate Flavor (40g)', '35.00', 'Food & Snacks'],
    ['Urban Tee Shirt', 'Breathable Blue (F-Medium)', '100.00', 'Clothing'],
];
function database_assert_catalog(PDO $db, array $expected): void
{
    $actual = $db->query('SELECT product_name, description, unit_price, category FROM PRODUCTtbl WHERE status = 1 ORDER BY product_name')->fetchAll(PDO::FETCH_NUM);
    usort($expected, static fn(array $a, array $b): int => strcmp($a[0], $b[0]));
    database_check($actual === $expected, 'Active catalog does not exactly match the ten approved workbook products.');
}

$server = new PDO($dsn, getenv('QUICKMART_TEST_USER') ?: 'root', getenv('QUICKMART_TEST_PASSWORD') ?: '', [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
]);
$suffix = bin2hex(random_bytes(6));
$databases = [];
$backups = [];
$backupDirectory = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'quickmart-test-backups-' . $suffix;
if (!mkdir($backupDirectory, 0700)) {
    throw new RuntimeException('Cannot create temporary backup directory.');
}
$createDatabase = static function (string $purpose) use ($server, &$databases, $suffix): string {
    $name = 'quickmart_test_' . $purpose . '_' . $suffix;
    if (!preg_match('/^quickmart_test_[a-z]+_[0-9a-f]{12}$/', $name)) {
        throw new RuntimeException('Unsafe test database name.');
    }
    $server->exec('CREATE DATABASE ' . quickmart_identifier($name) . ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    $databases[] = $name;
    $server->exec('USE ' . quickmart_identifier($name));
    return $name;
};
try {
    // Fresh import runs every CREATE TABLE and the actual authoritative seed SQL.
    $fresh = $createDatabase('schema');
    $source = preg_replace('/CREATE DATABASE rfid_checkout_main\s+CHARACTER SET utf8mb4\s+COLLATE utf8mb4_unicode_ci;\s*USE rfid_checkout_main;/', '', quickmart_schema_source());
    $server->exec($source);
    database_assert_catalog($server, $expectedCatalog);
    database_check(count(quickmart_existing_tables($server)) === 8, 'Fresh schema must define eight tables.');
    database_check(!isset(quickmart_columns($server, 'PRODUCTtbl')['size']), 'Fresh schema reintroduced size.');
    database_check((int) $server->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND ENGINE <> 'InnoDB'")->fetchColumn() === 0, 'Every table must use InnoDB.');
    database_check((int) $server->query("SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'")->fetchColumn() === 9, 'Fresh schema foreign-key relationships are incomplete.');
    database_check((int) $server->query("SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'PRIMARY KEY'")->fetchColumn() === 8, 'Every fresh table requires its primary key.');
    database_check(quickmart_upgrade_plan($server) === [], 'Fresh schema unexpectedly needs structural upgrades.');
    database_check((int) $server->query('SELECT COUNT(*) FROM ADMINtbl')->fetchColumn() === 0, 'Fresh schema must never install a default manager account.');
    $server->exec("INSERT INTO ADMINtbl(admin_name,email,password_hash) VALUES ('Schema Manager','schema@example.test','preserved-password-hash')");
    $server->exec("INSERT INTO RFID_tags(epc,product_id) VALUES ('E200000000000001',1)");
    $server->exec("INSERT INTO PURCHASEtbl(admin_id,session_id,total_amount) VALUES (1,'schema-session',30.00)");
    $server->exec('INSERT INTO PURCHASE_items(purchase_id,product_id,tag_id,unit_price,subtotal) VALUES (1,1,1,30.00,30.00)');
    $server->exec("INSERT INTO CHECKOUT_sessions(session_id,admin_id,owner_hash,epcs_json,cart_json,purchase_id) VALUES ('schema-session',1,REPEAT('a',64),'[]','[]',1)");
    $server->exec("INSERT INTO CHECKOUT_attempts(session_id,attempt_id,outcome,response_json) VALUES ('schema-session','request-1','success','{}')");
    try {
        $server->exec("INSERT INTO CHECKOUT_attempts(session_id,attempt_id,outcome,response_json) VALUES ('schema-session','request-1','success','{}')");
        database_check(false, 'Duplicate payment idempotency keys were accepted.');
    } catch (PDOException $error) {
        database_check($error->getCode() === '23000', 'Unexpected duplicate-key error.');
    }
    try {
        $server->exec('DELETE FROM PRODUCTtbl WHERE product_id=1');
        database_check(false, 'Referenced product deletion was accepted.');
    } catch (PDOException $error) {
        database_check($error->getCode() === '23000', 'Unexpected foreign-key error.');
    }

    // Real legacy shape: no reset/checkout tables, size column, short session IDs,
    // no attempt fields, and historical purchase items without individual tag IDs.
    $legacy = $createDatabase('upgrade');
    foreach (quickmart_table_definitions() as $table => $definition) {
        if (in_array($table, ['PASSWORD_RESET_tokens', 'CHECKOUT_sessions', 'CHECKOUT_attempts'], true)) {
            continue;
        }
        if ($table === 'PRODUCTtbl') {
            $definition = str_replace('description TEXT NULL,', 'description TEXT NULL, size VARCHAR(50) NULL,', $definition);
        } elseif ($table === 'PURCHASEtbl') {
            $definition = str_replace('session_id VARCHAR(50)', 'session_id VARCHAR(30)', $definition);
            $definition = preg_replace('/^    (?:attempt_status|attempted_items)[^\n]*\n/m', '', $definition);
        } elseif ($table === 'PURCHASE_items') {
            $definition = preg_replace('/^    tag_id[^\n]*\n/m', '', $definition);
            $definition = preg_replace('/,\s*CONSTRAINT fk_purchase_item_tag.*?ON DELETE RESTRICT/s', '', $definition);
        }
        $server->exec($definition);
    }
    $legacyManager = $server->prepare('INSERT INTO ADMINtbl(admin_name,email,password_hash) VALUES (?,?,?)');
    $legacyManager->execute(["Existing O'Brien Manager", 'legacy@example.test', 'unchanged-hash']);
    $server->exec("INSERT INTO PRODUCTtbl(product_name,description,size,unit_price,category) VALUES ('Zonrox Color Safe Bleach','Historical description','225 ml',30.00,'Home Essentials'),('Rice Scooper','Old approved description','18g',1.00,'Old category'),('Custom Historical Item','Already (25 g)','25g',12.00,'Custom')");
    $server->exec("INSERT INTO RFID_tags(epc,product_id,status) VALUES ('E200000000000002',1,'PURCHASED'),('E200000000000003',1,'AVAILABLE')");
    $server->exec("INSERT INTO PURCHASEtbl(admin_id,session_id,total_amount) VALUES (1,'legacy-history',30.00)");
    $server->exec('INSERT INTO PURCHASE_items(purchase_id,product_id,unit_price,subtotal) VALUES (1,1,30.00,30.00)');
    $beforeAdmin = $server->query('SELECT * FROM ADMINtbl')->fetchAll();
    $beforeTags = $server->query('SELECT * FROM RFID_tags ORDER BY tag_id')->fetchAll();
    $beforePurchases = $server->query('SELECT purchase_id,admin_id,session_id,status,total_amount,purchase_date FROM PURCHASEtbl')->fetchAll();
    $beforeProductCount = (int) $server->query('SELECT COUNT(*) FROM PRODUCTtbl')->fetchColumn();
    $plan = quickmart_upgrade_plan($server);
    database_check(count($plan) >= 7, 'Legacy plan omitted structural upgrades.');
    database_check((int) $server->query('SELECT COUNT(*) FROM PRODUCTtbl')->fetchColumn() === $beforeProductCount && isset(quickmart_columns($server, 'PRODUCTtbl')['size']), 'Dry-run changed legacy data.');
    try {
        quickmart_upgrade($server, $backupDirectory . DIRECTORY_SEPARATOR . 'missing');
        database_check(false, 'Upgrade continued without a valid backup destination.');
    } catch (RuntimeException $error) {
        database_check(isset(quickmart_columns($server, 'PRODUCTtbl')['size']), 'Backup failure mutated schema.');
    }
    $result = quickmart_upgrade($server, $backupDirectory);
    $backups[] = $result['backup'];
    database_check(is_file($result['backup']), 'Upgrade omitted the full backup.');
    database_assert_catalog($server, $expectedCatalog);
    database_check(count(quickmart_existing_tables($server)) === 8, 'Legacy upgrade omitted required tables.');
    database_check((int) $server->query("SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'")->fetchColumn() === 9, 'Legacy upgrade omitted required foreign keys.');
    database_check(!isset(quickmart_columns($server, 'PRODUCTtbl')['size']), 'Legacy size column was not consolidated.');
    database_check($server->query('SELECT * FROM ADMINtbl')->fetchAll() === $beforeAdmin, 'Manager credentials changed.');
    database_check($server->query('SELECT * FROM RFID_tags ORDER BY tag_id')->fetchAll() === $beforeTags, 'RFID registrations or statuses changed.');
    database_check($server->query('SELECT purchase_id,admin_id,session_id,status,total_amount,purchase_date FROM PURCHASEtbl')->fetchAll() === $beforePurchases, 'Purchase history changed.');
    database_check($server->query('SELECT product_id FROM PRODUCTtbl WHERE product_name = \'Rice Scooper\'')->fetchColumn() == 2, 'Approved existing product ID changed.');
    database_check($server->query('SELECT status FROM PRODUCTtbl WHERE product_id = 1')->fetchColumn() == 0, 'Referenced retired product remained active.');
    database_check($server->query('SELECT description FROM PRODUCTtbl WHERE product_id = 1')->fetchColumn() === 'Historical description (225 ml)', 'Retired measurement or description was lost.');
    database_check($server->query('SELECT description FROM PRODUCTtbl WHERE product_id = 3')->fetchColumn() === 'Already (25 g)', 'Existing measurement was duplicated.');
    database_check($server->query('SELECT tag_id FROM PURCHASE_items WHERE purchase_item_id = 1')->fetchColumn() === null, 'Historical receipt received a fabricated RFID tag.');
    database_check(quickmart_upgrade_plan($server) === [], 'Upgrade is not structurally idempotent.');
    $productsAfter = $server->query('SELECT * FROM PRODUCTtbl ORDER BY product_id')->fetchAll();
    $repeat = quickmart_upgrade($server, $backupDirectory);
    $backups[] = $repeat['backup'];
    database_check($server->query('SELECT * FROM PRODUCTtbl ORDER BY product_id')->fetchAll() === $productsAfter, 'Repeated upgrade duplicated or changed products.');

    // Prove that the compressed backup can actually restore all legacy data/DDL.
    $restore = $createDatabase('restore');
    $backupText = gzdecode(file_get_contents($result['backup']));
    database_check(is_string($backupText) && str_contains($backupText, '-- QUICKMART BACKUP COMPLETE'), 'Backup integrity marker missing.');
    $server->exec($backupText);
    database_check($server->query('SELECT * FROM ADMINtbl')->fetchAll() === $beforeAdmin, 'Backup restore lost credentials.');
    database_check($server->query('SELECT * FROM RFID_tags ORDER BY tag_id')->fetchAll() === $beforeTags, 'Backup restore lost RFID tags.');
    database_check(isset(quickmart_columns($server, 'PRODUCTtbl')['size']), 'Backup restore lost original legacy schema.');
    database_check((int) $server->query('SELECT COUNT(*) FROM PRODUCTtbl')->fetchColumn() === $beforeProductCount, 'Backup restore changed product count.');
    database_check($server->query('SELECT purchase_id,admin_id,session_id,status,total_amount,purchase_date FROM PURCHASEtbl')->fetchAll() === $beforePurchases, 'Backup restore lost history.');

    // Ambiguous duplicates must block the upgrade before a backup or any mutation.
    $server->exec("INSERT INTO PRODUCTtbl(product_name,description,unit_price,category) VALUES ('Rice Scooper','Duplicate',32.00,'Home Essentials')");
    try {
        quickmart_upgrade_plan($server);
        database_check(false, 'Ambiguous existing approved products were silently reconciled.');
    } catch (RuntimeException $error) {
        database_check(str_contains($error->getMessage(), 'Duplicate approved product'), 'Unexpected duplicate-catalog failure.');
    }
    echo "Database integration: $checks checks passed (fresh import, legacy upgrade, rerun, backup restore, integrity and safe failure).\n";
} finally {
    foreach ($databases as $name) {
        // These names were generated and validated above; production DBs are never targets.
        if (!preg_match('/^quickmart_test_[a-z]+_[0-9a-f]{12}$/', $name)) {
            throw new RuntimeException('Refusing unsafe test cleanup.');
        }
        $server->exec('DROP DATABASE ' . quickmart_identifier($name));
    }
    foreach ($backups as $path) {
        if (is_file($path)) {
            unlink($path);
        }
    }
    rmdir($backupDirectory);
}
