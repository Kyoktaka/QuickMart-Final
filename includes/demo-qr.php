<?php
declare(strict_types=1);

/**
 * Fixed test fixtures for a localhost-only school payment simulation.
 *
 * No wallet accounts, balances, transfers, or real payment verification exist.
 * QR strings are public sample data; they are NOT secure payment credentials.
 *
 * @return 'success'|'insufficient_balance'|'invalid'
 */
function quickmart_demo_qr_outcome(string $payload): string
{
    return match (trim($payload)) {
        'QMPAY|QM-WALLET-1001|C899' => 'success',
        'QMPAY|QM-WALLET-1002|C900' => 'insufficient_balance',
        default => 'invalid',
    };
}
