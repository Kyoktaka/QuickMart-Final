<?php
declare(strict_types=1);
require_once __DIR__ . '/../includes/demo-qr.php';

$cases = [
    'QMPAY|QM-WALLET-1001|C899' => 'success',
    'QMPAY|QM-WALLET-1002|C900' => 'insufficient_balance',
    'QMPAY|QM-WALLET-1001|C900' => 'invalid',
    'QMPAY|QM-WALLET-1002|C899' => 'invalid',
    'QMPAY|DEMO|C293' => 'invalid',
    'QMPAY|QM-WALLET-1003|C901' => 'invalid',
    'invalid QR' => 'invalid',
    '' => 'invalid',
];
foreach ($cases as $qr => $expected) {
    $result = quickmart_demo_qr_outcome($qr);
    if ($result !== $expected) {
        fwrite(STDERR, 'Failed case: ' . var_export($qr, true) . PHP_EOL);
        exit(1);
    }
}
if (quickmart_demo_qr_outcome('  QMPAY|QM-WALLET-1001|C899  ') !== 'success') {
    fwrite(STDERR, 'Whitespace normalization failed.' . PHP_EOL);
    exit(1);
}
echo '9 fixed demo QR test cases passed.' . PHP_EOL;

$hostCases = [
    ['127.0.0.1','localhost',false,false,true],
    ['::1','[::1]:80',false,false,true],
    ['127.0.0.1','127.0.0.1:8080',false,false,true],
    ['127.0.0.1','localhost','production',false,false],
    ['127.0.0.1','localhost',false,'0',false],
    ['192.168.1.20','localhost',false,false,false],
    ['127.0.0.1','quickmart.example.com',false,false,false],
    ['127.0.0.1','localhost.attacker.example',false,false,false],
];
foreach ($hostCases as [$ip,$host,$env,$opt,$expected]) {
    if (quickmart_local_demo_allowed($ip,$host,$env,$opt) !== $expected) {
        fwrite(STDERR, "Demo localhost gate failed for $ip / $host\n");
        exit(1);
    }
}
echo '8 local payment-gate tests passed.' . PHP_EOL;
