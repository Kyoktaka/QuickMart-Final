<?php
declare(strict_types=1);

/**
 * Fixed test fixtures for a localhost-only school payment simulation.
 *
 * No wallet accounts, balances, transfers, or real payment verification exist.
 * QR strings are public sample data; they are NOT secure payment credentials.
 *
 * @return 'success'|'insufficient_balance'|'no_internet'|'invalid'
 */
function quickmart_demo_qr_outcome(string $payload): string
{
    return match (trim($payload)) {
        // Original QuickMart classroom fixtures.
        'QMPAY|QM-WALLET-1001|C899',
        // Offline QR fixture distributed with the QuickMart demo package.
        'QUICKMART-DEMO|PAYMENT_SUCCESS|OFFLINE-V1' => 'success',

        'QMPAY|QM-WALLET-1002|C900',
        'QUICKMART-DEMO|NO_BALANCE|OFFLINE-V1' => 'insufficient_balance',

        'QUICKMART-DEMO|NO_INTERNET|OFFLINE-V1' => 'no_internet',

        default => 'invalid',
    };
}

/**
 * Localhost classroom demo ONLY; never treat a QR as verified bank payment.
 * Default local development works without Apache environment-variable setup.
 */
function quickmart_local_demo_allowed(
    string $remoteIp,
    string $host,
    string|false $appEnv,
    string|false $demoOverride
): bool {
    return in_array($remoteIp, ['127.0.0.1', '::1'], true)
        && preg_match('/\\A(?:localhost|127\\.0\\.0\\.1|\\[::1\\])(?::[0-9]{1,5})?\\z/i', $host) === 1
        && $appEnv !== 'production'
        && $demoOverride !== '0';
}
