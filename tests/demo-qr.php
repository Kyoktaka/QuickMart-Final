<?php
declare(strict_types=1);

require_once __DIR__ . '/../includes/demo-qr.php';

$fixtures = [
    'QMPAY|QM-WALLET-1001|C899' => 'QM-WALLET-1001',
    'QMPAY|QM-WALLET-1002|C900' => 'QM-WALLET-1002',
    'QMPAY|DEMO|C293' => 'DEMO', // Older demo QR: valid format, not a seeded wallet
    'QMPAY|QM-WALLET-1002|C899' => null, // Mismatched checksum
    'QMPAY|UNKNOWN|C12' => null,
    'QMPAY|X||C88' => null,
    '' => null,
];
foreach ($fixtures as $qr => $expected) {
    $actual = parse_demo_qr($qr);
    if ($actual !== $expected) {
        fwrite(STDERR, 'QR fixture failed: ' . var_export($qr, true) . PHP_EOL);
        exit(1);
    }
}
echo 'QR parsing fixtures passed (' . count($fixtures) . ').' . PHP_EOL;
