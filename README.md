# QuickMart Final — Integrated Frontend and PHP/MySQL Backend

The original visual design, CSS files, and login background are preserved.
Manager accounts, products, EPC stock and transaction records are persisted in
the existing PHP/MySQL backend. No browser-stored passwords or simulated wallets.

## Run in XAMPP

1. Clone Kyoktaka/QuickMart-Final into C:\xampp\htdocs\QuickMart-Final.
2. Start Apache and MySQL.
3. For a fresh DB import database/schema.sql in phpMyAdmin (creates rfid_checkout_main).
   Do not run a historical migration after a fresh import.
4. Check config/database.php settings for local XAMPP MySQL.
5. Run composer install for PHPMailer.
6. Visit http://localhost/QuickMart-Final/
7. Signup is only for the first manager on localhost: name, email, password
   (8–72 bytes). All subsequent login uses manager email, not username.
8. Configure QUICKMART_SMTP_USERNAME and QUICKMART_SMTP_PASSWORD in PHP/Apache
   environment to send reset-password emails. Restart Apache after changes.
   The emailed secure token link changes passwords; the browser does not.

## RFID integration

The assets/js/rfid-scanner.js handler captures EPCs from the USB HID
keyboard-emulation UHF reader. Inventory modal registers EPCs using PHP API.
Kiosk scan calls PHP detect endpoint and builds grouped cart items. No local
stock deduction occurs. Only committed backend checkout marks EPCs PURCHASED.
Tag presence is approximated via a 3-second grace timeout; test on hardware.
Manager start/exit verification uses the password auth backend; demo RFID
manager card and master-key tricks are disabled.

## Local demonstration QR checkout ONLY

Real payment is NOT integrated. Without explicit demo flags, the checkout API
responds HTTP 503 and will not mark tags purchased.
For school demo on local server only, configure PHP/Apache:
  QUICKMART_APP_ENV=development
  QUICKMART_DEMO_CHECKOUT=1
Restart Apache and use QR text:
  QMPAY|DEMO|C293
The QR checksum is not a real payment signature. No balance, banking or
real payment status is verified. This must never be enabled publicly.

## Transaction History and Dashboard

The PHP endpoints return real purchase records, item details for successful
purchases, failed/cancelled events, sales totals, and available stock counts.
Activity Feed remains temporary browser memory; it is NOT permanent audit logging.

## Testing

GitHub Actions checks PHP/JS syntax. This does not replace live XAMPP/MySQL,
PHPMailer SMTP, reader hardware, camera or browser flow testing.
