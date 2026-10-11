<?php
declare(strict_types=1);

/**
 * Parse the *non-cryptographic* classroom QR payload.
 * Format: QMPAY|<wallet id>|C<sum of ASCII codes mod 997>.
 *
 * This is NOT proof of payment; it must only be used in explicit localhost demo mode.
 */
function parse_demo_qr(string $payload): ?string
{
    $parts = explode('|', trim($payload));
    if (count($parts) !== 3 || $parts[0] !== 'QMPAY'
        || preg_match('/^[A-Za-z0-9_-]{1,30}$/D', $parts[1]) !== 1) {
        return null;
    }

    $sum = 0;
    foreach (str_split($parts[1]) as $character) {
        $sum += ord($character);
    }

    return hash_equals('C' . ($sum % 997), $parts[2]) ? $parts[1] : null;
}
