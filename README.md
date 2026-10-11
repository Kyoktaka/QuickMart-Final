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
Tag presence is estimated from repeated EPC reads with a brief configurable grace interval; verify actual USB output on the target hardware.
Manager start/exit verification uses the password auth backend; demo RFID
manager card and master-key tricks are disabled.

## Local demonstration QR checkout ONLY

Real payment is NOT integrated. For **http://localhost/QuickMart-Final/**,
the classroom QR simulation is available automatically without extra environment
variables. It is blocked on remote/LAN/public hosts, in production mode, or
when QUICKMART_DEMO_CHECKOUT=0. Do not expose this simulation publicly.
If you still see "checkout unavailable", ensure the browser is using localhost
(not a LAN IP), Apache was restarted, and the latest PHP files were pulled.
The backend recognizes the TWO fixed QR payloads only, not a live payment app.
Scan the two fixed teammate QR codes:
  QMPAY|QM-WALLET-1001|C899   => demo success (enough balance scenario)
  QMPAY|QM-WALLET-1002|C900   => demo failure (insufficient balance scenario)
These two scenarios are hardcoded SERVER-SIDE in includes/demo-qr.php.
There is NO wallet database table, balance lookup, or wallet deduction.
Successful demo checkouts update PURCHASEtbl/PURCHASE_items/RFID_tags.
Declines leave RFID tags AVAILABLE; the frontend records a failed attempt
in the existing PURCHASEtbl through api/checkout/log.php.
Unrecognized QR codes are also treated as failed attempts in this demo.
The old QMPAY|DEMO|C293 fixture is no longer accepted.

A classroom QR is not a real payment method or fraud-resistant signature.
It is automatically restricted to local browser/XAMPP testing only.
No new database migration or ERD change is required for this option.

## Transaction History and Dashboard

The PHP endpoints return real purchase records, item details for successful
purchases, failed/cancelled events, sales totals, and available stock counts.
Activity Feed remains temporary browser memory; it is NOT permanent audit logging.

## Testing

GitHub Actions checks PHP/JS syntax. This does not replace live XAMPP/MySQL,
PHPMailer SMTP, reader hardware, camera or browser flow testing.

## RFID restocking and scan stability

Restock supports **BATCH RFID registration**: select ONE product, click
Start Scanning, present several physical tags for that same product,
click Stop Scanning, review the unique EPCs, and confirm Register N Tags.
The PHP backend inserts available unique tags for the selected product.
Changing the product discards the pending scan; nothing auto-reassigns tags
that are already owned by another product. A batch supports up to 100 tags.
Keep unrelated products away from the scanner during that product's batch.
Existing incorrect assignments are **not** automatically changed.
Use docs/RFID_TAG_AUDIT.md to inspect and correct verified EPCs.

The HID reader reports EPC reads, not an authoritative in/out presence flag.
Short gaps between multi-tag reads are tolerated (first-read 6-second window,
adaptive 4.5–9-second window after repeats; plus brief empty-tray settling).
The cart remains as long as the device keeps reporting each tag. If the reader
only outputs an EPC once or periodically skips a still-present tag for longer,
the web page cannot know it remains in range; configure the reader for repeated
HID EPC output or use a vendor inventory API. Software cannot guarantee both
zero false-removals and instant physical removal from single-shot key events.
The requested 14x16-inch platform and 12–13-inch height are *physical RF*
constraints: tune and test the antenna/reader, not just the JavaScript timer.

## Authentication / password reset UI

The front-end Create Account form creates the **first manager account only**;
the redundant manager/setup-account.php has been removed.
Password reset links return to index.html and open the **existing QuickMart
Set New Password modal** using a one-time, expiring server token. The
previous standalone reset-password.html forwards old bookmarks to the
same UI. No change was made to CSS or the original design.
