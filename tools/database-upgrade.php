<?php
declare(strict_types=1);

/**
 * Explicit CLI upgrade for the known QuickMart schema. Dry-run is the default.
 * Stop Apache/bridge first. A verified, complete backup is written before any DDL.
 * MySQL DDL commits implicitly: recover into an empty database from that backup
 * if interrupted, or rerun this idempotent upgrade after correcting the error.
 */
function quickmart_identifier(string $name): string
{
    return '`' . str_replace('`', '``', $name) . '`';
}

function quickmart_schema_source(): string
{
    $source = file_get_contents(dirname(__DIR__) . '/database/schema.sql');
    if ($source === false) {
        throw new RuntimeException('Cannot read authoritative schema.sql.');
    }
    return $source;
}

function quickmart_table_definitions(): array
{
    preg_match_all('/CREATE TABLE (\w+) \(.*?\) ENGINE=InnoDB[^;]*;/s', quickmart_schema_source(), $matches);
    $definitions = [];
    foreach ($matches[1] as $index => $name) {
        $definitions[$name] = $matches[0][$index];
    }
    if (count($definitions) !== 8) {
        throw new RuntimeException('Expected eight authoritative table definitions.');
    }
    return $definitions;
}

function quickmart_approved_catalog(): array
{
    if (!preg_match('/INSERT INTO PRODUCTtbl \(product_name, description, unit_price, category\) VALUES\s*(.*?);/s', quickmart_schema_source(), $seed)) {
        throw new RuntimeException('Cannot read the authoritative product catalog.');
    }
    preg_match_all("/\('((?:''|[^'])*)', '((?:''|[^'])*)', ([0-9]+\.[0-9]{2}), '((?:''|[^'])*)'\)/", $seed[1], $rows, PREG_SET_ORDER);
    if (count($rows) !== 10) {
        throw new RuntimeException('Expected exactly ten approved products.');
    }
    return array_map(static fn(array $row): array => [
        'product_name' => str_replace("''", "'", $row[1]),
        'description' => str_replace("''", "'", $row[2]),
        'unit_price' => $row[3],
        'category' => str_replace("''", "'", $row[4]),
    ], $rows);
}

function quickmart_columns(PDO $db, string $table): array
{
    $columns = [];
    foreach ($db->query('SHOW COLUMNS FROM ' . quickmart_identifier($table)) as $column) {
        $columns[$column['Field']] = $column;
    }
    return $columns;
}

function quickmart_existing_tables(PDO $db): array
{
    $tables = [];
    $canonicalNames = [];
    if ((int) $db->query('SELECT @@lower_case_table_names')->fetchColumn() !== 0) {
        // XAMPP/Windows stores SHOW TABLES names in lowercase; Linux is case-sensitive.
        foreach (array_keys(quickmart_table_definitions()) as $name) {
            $canonicalNames[strtolower($name)] = $name;
        }
    }
    foreach ($db->query('SHOW FULL TABLES') as $row) {
        $values = array_values($row);
        if ($values[1] !== 'BASE TABLE') {
            throw new RuntimeException('Custom database views require a separately reviewed upgrade and backup.');
        }
        $tables[] = $canonicalNames[strtolower($values[0])] ?? $values[0];
    }
    return $tables;
}

function quickmart_upgrade_plan(PDO $db): array
{
    $tables = quickmart_existing_tables($db);
    $definitions = quickmart_table_definitions();
    $operations = [];
    if (!in_array('PRODUCTtbl', $tables, true) || !in_array('ADMINtbl', $tables, true)) {
        throw new RuntimeException('Existing database must contain PRODUCTtbl and ADMINtbl; fresh installations use schema.sql.');
    }
    if ($db->query('SHOW TRIGGERS')->fetch() !== false) {
        throw new RuntimeException('Custom triggers require a separately reviewed upgrade and backup.');
    }
    foreach (['ROUTINES', 'EVENTS'] as $kind) {
        $field = $kind === 'ROUTINES' ? 'ROUTINE_SCHEMA' : 'EVENT_SCHEMA';
        if ((int) $db->query("SELECT COUNT(*) FROM information_schema.$kind WHERE $field = DATABASE()")->fetchColumn() !== 0) {
            throw new RuntimeException('Custom routines/events require a separately reviewed upgrade and backup.');
        }
    }
    $knownAdditions = [
        'PURCHASEtbl' => [
            'attempt_status' => "ENUM('failed','cancelled') NULL DEFAULT NULL",
            'attempted_items' => 'INT UNSIGNED NOT NULL DEFAULT 0',
        ],
        'PURCHASE_items' => ['tag_id' => 'INT UNSIGNED NULL DEFAULT NULL'],
    ];
    foreach ($definitions as $table => $definition) {
        if (!in_array($table, $tables, true)) {
            $operations[] = $definition;
            continue;
        }
        $engine = $db->prepare('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?');
        $engine->execute([$table]);
        if (strtoupper((string) $engine->fetchColumn()) !== 'INNODB') {
            throw new RuntimeException("$table must use InnoDB before this upgrade; have its engine conversion reviewed separately.");
        }
        $columns = quickmart_columns($db, $table);
        if ($table === 'PRODUCTtbl' && isset($columns['size'])) {
            // Preserve measurements before retiring the legacy column; reruns do not append twice.
            $operations[] = "UPDATE PRODUCTtbl SET description = CONCAT(TRIM(COALESCE(description, '')), CASE WHEN TRIM(COALESCE(description, '')) = '' THEN '' ELSE ' ' END, '(', TRIM(size), ')') WHERE size IS NOT NULL AND TRIM(size) <> '' AND LOCATE(REPLACE(LOWER(TRIM(size)), ' ', ''), REPLACE(LOWER(COALESCE(description, '')), ' ', '')) = 0";
            $operations[] = 'ALTER TABLE PRODUCTtbl DROP COLUMN size';
        }
        preg_match_all('/^    ([a-z][a-z_0-9]*) (?:INT|BIGINT|TINYINT|VARCHAR|CHAR|TEXT|LONGTEXT|ENUM|DECIMAL|TIMESTAMP|DATETIME)\b/m', $definition, $expectedColumns);
        foreach ($expectedColumns[1] as $column) {
            if (!isset($columns[$column])) {
                $addition = $knownAdditions[$table][$column] ?? null;
                if ($addition === null) {
                    throw new RuntimeException("Unsupported legacy schema: missing $table.$column. No changes made.");
                }
                $operations[] = 'ALTER TABLE ' . quickmart_identifier($table) . ' ADD COLUMN ' . quickmart_identifier($column) . ' ' . $addition;
            }
        }
        if ($table === 'PURCHASEtbl') {
            if (!preg_match('/^varchar\((\d+)\)$/i', $columns['session_id']['Type'], $length)) {
                throw new RuntimeException('Unsupported PURCHASEtbl.session_id type.');
            }
            if ((int) $length[1] < 50) {
                $operations[] = 'ALTER TABLE PURCHASEtbl MODIFY COLUMN session_id VARCHAR(50) NOT NULL';
            }
            $duplicates = $db->query('SELECT session_id FROM PURCHASEtbl GROUP BY session_id HAVING COUNT(*) > 1 LIMIT 1')->fetch();
            if ($duplicates !== false || (int) $db->query('SELECT COUNT(*) FROM PURCHASEtbl WHERE session_id IS NULL')->fetchColumn() !== 0) {
                throw new RuntimeException('Duplicate or NULL purchase session IDs require manual reconciliation; history was not changed.');
            }
            $uniqueSession = false;
            $indexes = [];
            foreach ($db->query('SHOW INDEX FROM PURCHASEtbl') as $index) {
                if ((int) $index['Non_unique'] === 0) {
                    $indexes[$index['Key_name']][] = $index['Column_name'];
                }
            }
            foreach ($indexes as $indexColumns) {
                $uniqueSession = $uniqueSession || $indexColumns === ['session_id'];
            }
            if (!$uniqueSession) {
                $operations[] = 'ALTER TABLE PURCHASEtbl ADD UNIQUE KEY uq_purchase_session (session_id)';
            }
        }
    }
    // Preserve relational guarantees on legacy schemas, including nullable historical tag IDs.
    foreach ($definitions as $table => $definition) {
        if (!in_array($table, $tables, true)) {
            continue; // CREATE TABLE already contains every required foreign key.
        }
        preg_match_all('/CONSTRAINT (\w+)\s+FOREIGN KEY \((\w+)\)\s+REFERENCES (\w+)\((\w+)\)\s+ON UPDATE (CASCADE|RESTRICT)\s+ON DELETE (CASCADE|RESTRICT)/', $definition, $foreignKeys, PREG_SET_ORDER);
        foreach ($foreignKeys as $key) {
            [, $name, $column, $referencedTable, $referencedColumn, $updateRule, $deleteRule] = $key;
            $findKey = $db->prepare('SELECT k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = ? AND k.COLUMN_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL');
            $findKey->execute([$table, $column]);
            $existingKey = $findKey->fetch();
            if ($existingKey !== false) {
                if (strcasecmp($existingKey['REFERENCED_TABLE_NAME'], $referencedTable) !== 0 || $existingKey['REFERENCED_COLUMN_NAME'] !== $referencedColumn
                    || $existingKey['UPDATE_RULE'] !== $updateRule || $existingKey['DELETE_RULE'] !== $deleteRule) {
                    throw new RuntimeException("Unsupported foreign key on $table.$column requires manual review.");
                }
                continue;
            }
            $columns = quickmart_columns($db, $table);
            if (isset($columns[$column]) && in_array($referencedTable, $tables, true)) {
                $orphan = $db->query('SELECT 1 FROM ' . quickmart_identifier($table) . ' c LEFT JOIN ' . quickmart_identifier($referencedTable) . ' p ON c.' . quickmart_identifier($column) . ' = p.' . quickmart_identifier($referencedColumn) . ' WHERE c.' . quickmart_identifier($column) . ' IS NOT NULL AND p.' . quickmart_identifier($referencedColumn) . ' IS NULL LIMIT 1')->fetch();
                if ($orphan !== false) {
                    throw new RuntimeException("Orphaned records in $table.$column require manual reconciliation; no records were deleted.");
                }
            }
            $operations[] = 'ALTER TABLE ' . quickmart_identifier($table) . ' ADD CONSTRAINT ' . quickmart_identifier($name)
                . ' FOREIGN KEY (' . quickmart_identifier($column) . ') REFERENCES ' . quickmart_identifier($referencedTable)
                . '(' . quickmart_identifier($referencedColumn) . ") ON UPDATE $updateRule ON DELETE $deleteRule";
        }
    }
    $productLookup = $db->prepare('SELECT COUNT(*) FROM PRODUCTtbl WHERE product_name = ?');
    foreach (quickmart_approved_catalog() as $product) {
        $productLookup->execute([$product['product_name']]);
        if ((int) $productLookup->fetchColumn() > 1) {
            throw new RuntimeException('Duplicate approved product name requires manual reconciliation: ' . $product['product_name']);
        }
    }
    return $operations;
}

/** All base tables are exported, including application-independent custom tables. */
function quickmart_database_backup(PDO $db, string $directory): string
{
    if (!is_dir($directory) || !is_writable($directory)) {
        throw new RuntimeException('Create a writable backup directory outside the web/repository root first.');
    }
    $directory = realpath($directory);
    $projectRoot = realpath(dirname(__DIR__));
    $normalized = strtolower(str_replace('\\', '/', $directory));
    $project = strtolower(str_replace('\\', '/', $projectRoot));
    if ($normalized === $project || str_starts_with($normalized . '/', $project . '/')) {
        throw new RuntimeException('Backups contain credentials/history: choose a directory outside the web/repository root.');
    }
    $database = (string) $db->query('SELECT DATABASE()')->fetchColumn();
    $path = $directory . DIRECTORY_SEPARATOR . preg_replace('/[^a-zA-Z0-9_-]/', '_', $database)
        . '-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.sql.gz';
    $output = gzopen($path, 'wb9');
    if ($output === false) {
        throw new RuntimeException('Could not create backup. No database changes made.');
    }
    @chmod($path, 0600);
    $write = static function (string $text) use ($output): void {
        if (gzwrite($output, $text) !== strlen($text)) {
            throw new RuntimeException('Backup write failed. No database changes made.');
        }
    };
    try {
        $db->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        $db->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT');
        $write("-- QuickMart pre-upgrade backup of $database. Restore only into a NEW, EMPTY database.\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n");
        foreach (quickmart_existing_tables($db) as $table) {
            $quoted = quickmart_identifier($table);
            $create = $db->query('SHOW CREATE TABLE ' . $quoted)->fetch(PDO::FETCH_NUM);
            $write($create[1] . ";\n");
            $rows = $db->query('SELECT * FROM ' . $quoted);
            while ($row = $rows->fetch(PDO::FETCH_ASSOC)) {
                $fields = implode(', ', array_map('quickmart_identifier', array_keys($row)));
                $values = implode(', ', array_map(static fn($value): string => $value === null ? 'NULL' : $db->quote((string) $value), array_values($row)));
                $write("INSERT INTO $quoted ($fields) VALUES ($values);\n");
            }
        }
        $write("SET FOREIGN_KEY_CHECKS=1;\n-- QUICKMART BACKUP COMPLETE\n");
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        gzclose($output);
        @unlink($path);
        throw $error;
    }
    gzclose($output);
    $check = gzopen($path, 'rb');
    if ($check === false) {
        throw new RuntimeException('Cannot verify backup. No database changes made.');
    }
    $tail = '';
    while (!gzeof($check)) {
        $chunk = gzread($check, 65536);
        if ($chunk === false) {
            gzclose($check);
            throw new RuntimeException('Backup verification failed. No database changes made.');
        }
        $tail = substr($tail . $chunk, -100);
    }
    gzclose($check);
    if (!str_contains($tail, '-- QUICKMART BACKUP COMPLETE')) {
        throw new RuntimeException('Backup is incomplete. No database changes made.');
    }
    return $path;
}

function quickmart_upgrade(PDO $db, string $backupDirectory): array
{
    $database = (string) $db->query('SELECT DATABASE()')->fetchColumn();
    $lockName = 'quickmart-upgrade-' . substr(hash('sha256', $database), 0, 32);
    $lock = $db->prepare('SELECT GET_LOCK(?, 0)');
    $lock->execute([$lockName]);
    if ((int) $lock->fetchColumn() !== 1) {
        throw new RuntimeException('Another database upgrade is already running.');
    }
    try {
        $plan = quickmart_upgrade_plan($db);
        $backup = quickmart_database_backup($db, $backupDirectory);
        // Print the recovery location before the first implicitly committed DDL.
        if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
            fwrite(STDOUT, "Verified backup: $backup\n");
        }
        foreach ($plan as $statement) {
            $db->exec($statement);
        }
        $catalog = quickmart_approved_catalog();
        $db->beginTransaction();
        $names = array_column($catalog, 'product_name');
        $retire = $db->prepare('UPDATE PRODUCTtbl SET status = 0 WHERE product_name NOT IN (' . implode(',', array_fill(0, count($names), '?')) . ')');
        $retire->execute($names);
        $find = $db->prepare('SELECT product_id FROM PRODUCTtbl WHERE product_name = ? LIMIT 1 FOR UPDATE');
        $update = $db->prepare('UPDATE PRODUCTtbl SET product_name = :product_name, description = :description, unit_price = :unit_price, category = :category, status = 1 WHERE product_id = :product_id');
        $insert = $db->prepare('INSERT INTO PRODUCTtbl (product_name, description, unit_price, category, status) VALUES (:product_name, :description, :unit_price, :category, 1)');
        foreach ($catalog as $product) {
            $find->execute([$product['product_name']]);
            $id = $find->fetchColumn();
            if ($id === false) {
                $insert->execute($product);
            } else {
                $update->execute($product + ['product_id' => $id]);
            }
        }
        $db->commit();
        return ['backup' => $backup, 'schema_operations' => count($plan), 'approved_products' => count($catalog)];
    } finally {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        $release = $db->prepare('SELECT RELEASE_LOCK(?)');
        $release->execute([$lockName]);
    }
}

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    try {
        $options = getopt('', ['apply', 'maintenance-confirmed', 'backup-dir:', 'help']);
        if (isset($options['help'])) {
            echo "Usage: php tools/database-upgrade.php [--apply --maintenance-confirmed --backup-dir=ABSOLUTE_DIRECTORY]\nDefault: read-only plan. Configure QUICKMART_DB_* as for the application.\nStop Apache and scanner bridges before --apply. Backup contains sensitive data.\nRestore the .sql.gz backup only into a separate EMPTY database, then point QUICKMART_DB_NAME at the restored database.\n";
            exit(0);
        }
        require dirname(__DIR__) . '/config/database.php';
        $plan = quickmart_upgrade_plan($conn);
        echo 'Database: ' . $conn->query('SELECT DATABASE()')->fetchColumn() . "\n";
        echo count($plan) . " schema change(s); synchronize ten approved products; retire other products without deleting records.\n";
        if (isset($options['apply'])) {
            if (!isset($options['maintenance-confirmed'], $options['backup-dir'])) {
                throw new RuntimeException('--apply requires --maintenance-confirmed and --backup-dir. Stop application access first.');
            }
            $result = quickmart_upgrade($conn, (string) $options['backup-dir']);
            echo 'Upgrade complete. Approved active products: ' . $result['approved_products'] . ".\n";
        } else {
            foreach ($plan as $statement) {
                echo $statement . ";\n";
            }
            echo "Dry-run only; no changes or backup written.\n";
        }
    } catch (Throwable $error) {
        fwrite(STDERR, 'Upgrade failed: ' . $error->getMessage() . "\nIf DDL began, retain the printed backup and keep application access stopped until recovery.\n");
        exit(1);
    }
}
