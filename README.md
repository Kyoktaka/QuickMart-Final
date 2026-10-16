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

## Product description consolidation (approved by database team)

`PRODUCTtbl` no longer has a separate `size` column. Product weight, volume,
material, scent, flavor, and similar details are stored in the existing
`description` field (e.g. `Blossom Fresh Scent (225 ml)`). The 10 sample
products in `database/schema.sql` now include their approved descriptions.
Product create, edit, list, RFID detection, and the frontend API adapter no
longer reference `size`.

- **New/fresh database:** import `database/schema.sql`; no migrations required.
- **Existing XAMPP database:** export a full SQL backup, stop checkout testing,
  and run `database/migrations/20261014_product_description_remove_size.sql`
  **once** in phpMyAdmin for `rfid_checkout_main`. It sets approved descriptions
  for the 10 example products, preserves any size on custom products by appending
  it to the description if not already present, then removes `size`.
  It does not drop products, accounts, purchase history, or RFID mappings.
  Review any customized descriptions and take a backup before running.
- Run the database migration **before** using the updated PHP endpoints.
  Changing `schema.sql` in GitHub does not automatically alter an existing DB.
- Sync your ERD with the implementation: remove `PRODUCTtbl.size` and show
  `PRODUCTtbl.description`. Available stock is computed from RFID tags.

## Final frontend integration (October 14, 2026)

The team-provided `quickmart` multi-page design is now the active frontend at
`manager/` folder. The root `index.html` forwards to `manager/login.html`;
the `js/backend.js`
adapter uses `../api/` from the manager pages to reach the existing PHP/MySQL APIs. All 18 original frontend CSS files
and the login background asset were preserved byte-for-byte.

Manager login, product updates, RFID EPC registration and live detection,
kiosk checkout, dashboard reporting, purchase history and reset-password
forms now call the server. The old demo storage and demo payment flows are
not used. The only new PHP endpoint is `api/rfid/list.php`, for authenticated
RFID status lookup. No database tables or columns are added by this merge.

Before launching on an existing database, first back up the database and apply
`database/migrations/20261014_product_description_remove_size.sql` once.
For a fresh install, import `database/schema.sql` instead. See the earlier
product description migration instructions above.

Run `node tests/integration-smoke.js` and `php -l api/rfid/list.php` for
syntax/contract smoke tests. Live MySQL, camera, SMTP and physical RFID reader
must still be checked locally. QR payments are classroom-only, localhost-only
fixtures and are not a real payment gateway.

## Manager page organization (October 14, 2026)

The only root-level HTML page is `index.html`. All active manager pages are
in `manager/`: `login.html`, `dashboard.html`, `history.html`,
`inventory.html`, `scan.html`, and `kiosk.html`.

The root index redirects to `manager/login.html` while preserving query
parameters, including legacy password-reset links. New reset emails point
directly to the manager login page. HTML loads root-level CSS, JS and assets
via `../css/`, `../js/`, and `../assets/`; API calls use `../api/`.
The existing PHP endpoints, session rules, CSS files, and database schema
remain unchanged. Existing `manager/reset-password.html` bookmarks also
forward to `manager/login.html`.

Run `node tests/integration-smoke.js` to check page assets, links, reset
routing, API relative paths, and RFID behavior.

## Scanner-only, read-only multi-tag EPC registration (October 16, 2026)

The Inventory > Assign EPC tags modal displays ALL **unique captured** EPCs
inside one scrolling multiline **read-only** box. The field is permanently
read-only: before Start Scanning, during scanning, after Stop Scanning, and
during registration. Manual typing, editing and pasting EPCs in the box are
not supported; the field's value is rendered exclusively from EPCs accepted
through the active `rfid:read` scan event. The backend registration request
uses that captured Set, never the field's displayed text. Repeated reads of
the same EPC do not add extra entries.

Registration flow: select ONE product, Start Scanning, present compatible
RFID tags, Stop Scanning, review the captured EPC list, Register N Tags.
To discard a scan without changing stock, use Clear or Close. A product
change discards pending tags only after confirmation. Up to 100 EPCs can be
registered per batch by the existing PHP endpoint; actual simultaneous
reader capacity must be established with physical tests.

The older editable textarea/paste feature was intentionally removed at the
user's request. All **other** appropriate input fields (manager credentials,
search, product creation and edits, kiosk manual-entry forms) still accept
normal physical keyboard input. The previous intrusive global keyboard
filter remains removed; no password/search typing delay is introduced.

**Hardware limitation:** the USB UHF reader behaves as a USB keyboard in
HID wedge mode. Browsers cannot perfectly distinguish a human keyboard
from this RFID scanner. Consequently, if the reader itself continues typing
EPCs while a separate editable field has focus, unwanted characters may
still appear there. Read-only EPC display is guaranteed by HTML semantics;
fully isolating the device requires vendor reader configuration (pause the
inventory mode during manual input) or a supported separate reader API.

Inventory HTML uses `data-epc-ui="scan-only-v4"` and versioned CSS/JS
assets. After pulling, hard-refresh the XAMPP page; if the EPC box still
accepts text check that the Apache-served project is really on the latest
commit. Browser console:
`document.querySelector('#epc-code')?.readOnly` should be `true`.
Run `node tests/inventory-batch.js` and `node tests/manual-keyboard.js`
to validate scanner-only registration and normal keyboard pass-through.
Testing is simulated and cannot verify the physical reader's HID output.

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
For multi-tag groups, software now retains first sightings longer as the
population increases (about 6–14 seconds for 1–20 unique tags, max 16 seconds).
After repeated reads, a per-EPC adaptive allowance uses approximately three
observed read cycles (minimum 4.5 seconds, maximum 22 seconds). This reduces
20-tag flicker while still allowing a genuinely removed tag to disappear.
These are INTERNAL tolerances, not visible timers or guaranteed removal delays.
Checkout QR payment has its own separate payment deadline.

The kiosk coalesces rapid tray changes into one PHP lookup, serializes backend
requests and ignores stale replies. It only clears an empty tray after a brief
settling interval; one tag removal should decrease that product's quantity
while other repeatedly read tags remain present.

**Important hardware limit:** If the reader emits every tag only once, or
misses a present EPC for longer than the read-gap tolerance, the browser
cannot distinguish removal from a missed read. No software change can
guarantee permanent on-screen presence AND automatic physical removal in
one-shot USB keyboard mode. Configure continuous/inventory/repeat EPC output
using the exact reader vendor's instructions, or integrate its supported
inventory API (if available) for stronger presence data.

The physical scanning platform is **18 x 12 x 12 inches**. Start with a reader
under its horizontal center (9 inches from the short edge, 6 inches from the
long edge), antenna face upward, under a thin NON-METAL floor. This is only a
test mounting position, not guaranteed RF coverage. For reliable 20-tag
scanning test 1, 5, 10, 15 and 20 tags for at least 30–60 seconds each, then
repeat with single-tag removal. Adjust tag spacing, antenna-to-tag distance,
orientation, and packaging before claiming 20-tag capacity. Metal/liquid
products often need specialist RFID tag placement. PHP requests accept up to
100 EPCs, but this is NOT a verified hardware multi-tag capacity.

Use `RFIDScanner.getReadHealth()` and `RFIDScanner.getDiagnostics()` in
the browser console on the authenticated kiosk for live read-cycle and
last-read diagnostics. No reader debug/expiry countdown is shown on screen.
Run `node tests/rfid-scanner.js`, `node tests/kiosk-presence.js` and
`node tests/integration-smoke.js` for simulated regression tests. Physical
USB/UHF hardware must be tested locally.

## Authentication / password reset UI

The front-end Create Account form creates the **first manager account only**;
the redundant manager/setup-account.php has been removed.
Password reset links return to index.html and open the **existing QuickMart
Set New Password modal** using a one-time, expiring server token. The
previous standalone reset-password.html forwards old bookmarks to the
same UI. No change was made to CSS or the original design.
