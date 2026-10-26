# QuickMart RFID Self-Checkout

QuickMart combines the team's existing manager and customer interface with a PHP REST API and a MySQL database. Managers maintain products, register physical EPC tags, authorize Product Recognition, and review transactions. Customers review a retained RFID cart before using a classroom QR payment simulation.

The frontend design and assets remain the team's supplied design. PHP/MySQL validates product availability, prices, inventory, checkout ownership, payment attempts, and final transactions. Browser storage contains recovery hints, not passwords, stock, payment proof, or authoritative totals.

**Scope:** this is a local classroom system. QR fixtures do not transfer money or verify a wallet. Physical reader isolation, RF coverage, camera operation, and email delivery require tests on the deployment computer. Automated tests do not establish those hardware or service results.

## Requirements and technology

| Component | Requirement or implementation |
| --- | --- |
| Computer | Windows laptop; XAMPP Apache and MySQL/MariaDB |
| PHP | PHP 8.1+ with `pdo_mysql`, `openssl`, and `zlib`; sessions enabled |
| Database | MySQL 8.0 or XAMPP MariaDB 10.4; InnoDB and `utf8mb4` |
| Frontend | Existing HTML, CSS, and plain JavaScript; same-origin `fetch` requests |
| Dependencies | Composer and PHPMailer, installed from `composer.lock` |
| RFID reader | USB UHF, 860–960 MHz, EPC Gen2 / ISO 18000-6C; supplied reader uses HID keyboard emulation |
| Optional bridge | Python 3.10+, PyUSB and `libusb-package`; independently accessible, verified reader interface required |
| QR camera | Webcam or compatible camera; browser camera permission on localhost or HTTPS |
| Automated checks | Python 3.10+, Node.js 20+, PHP; disposable MySQL/MariaDB for database tests |

The application does not include a vendor RF-power controller. Operating frequency, permitted power, antenna settings, reader protocol, and USB access must be checked against the actual device documentation. The supplied reader was identified on Windows as `VID_1A86 / PID_E010`, revision `0200`, with a vendor-defined HID interface `MI_00` and keyboard interface `MI_01`. These identities establish which device is the reader; they do not establish independent bridge compatibility. The bridge ships with no assumed device IDs.

## Project layout and data flow

```text
api/                 Authentication, product, RFID, checkout, dashboard and history APIs
assets/              Existing images and RFID scanner adapter
config/              Database, session/authentication and SMTP configuration
css/                 Team frontend styles
database/schema.sql  Complete fresh-install schema and ten approved products
demo-qr-codes/       Public classroom QR images
includes/            Checkout service, QR fixtures and PHPMailer integration
js/                  Frontend pages, API adapter, cart, camera and input guards
manager/             Login, dashboard, inventory, history, scan and kiosk pages
rfid-bridge/         Optional local USB reader bridge and Windows launch scripts
tests/               JavaScript, PHP/MySQL and Python regression tests
tools/               Unified checks and explicit existing-database upgrade
.github/workflows/   Automated repository checks
README.md            Project setup, operation, recovery and testing documentation
composer.json        Dependency requirements
composer.lock        Reproducible dependency versions
```

The root `index.html` opens `manager/login.html` and preserves password-reset query parameters. Pages use `js/backend.js` to call `../api/`. The usual scanner path is reader HID output, JavaScript scanner, PHP RFID validation, then MySQL product/tag lookup. When supported, the optional Python bridge replaces only the scanner-input step: USB reader, authenticated localhost bridge, JavaScript, PHP, MySQL.

RFID reads never directly deduct stock. Only a committed successful checkout marks its individual RFID tags `PURCHASED`. A product's available stock is the count of its `AVAILABLE` tags; repeated reads do not create stock or quantity.

## XAMPP installation

1. Install XAMPP with a compatible PHP runtime. Enable the PHP extensions listed above and start MySQL. Use the same PHP version for Apache and command-line checks.
2. Clone this repository into `C:\xampp\htdocs\QuickMart-Final`, then open a terminal in that directory. A different folder is allowed if the application base URL matches it.
3. Install the Composer dependencies:

   ```powershell
   composer install --no-interaction --prefer-dist
   ```

4. Choose **fresh installation** or **existing-database upgrade** below. Do not import the fresh schema over an existing database.
5. Configure the environment for the PHP/Apache process. Enable Apache `mod_rewrite` and allow this project's `.htaccess` rules with `AllowOverride All` (or the equivalent `Options` and `FileInfo` permissions) for its directory. Restart Apache after changes, then open [QuickMart on localhost](http://localhost/QuickMart-Final/).
6. On an empty database, use **Create Account** once to create the first manager. Sign in with that manager's email and password. No manager account or default password is seeded.

`vendor/` is generated and ignored by Git. Keep `composer.json` and `composer.lock`; run Composer after cloning rather than copying dependency files from a development archive. Composer is required for password-reset mail; local product and checkout operations do not depend on Gmail.

### Runtime environment

The code reads process environment variables with `getenv`; it does not load a `.env` file. `.env.example` lists reference values only and is not loaded automatically. Configure Apache using its local environment or `SetEnv` directives, keeping credentials out of the repository. A PowerShell `$env:` value affects processes started from that terminal, not an already running XAMPP Apache process.

| Variable | Default | Purpose |
| --- | --- | --- |
| `QUICKMART_DB_HOST` | `localhost` | MySQL host |
| `QUICKMART_DB_PORT` | `3306` | MySQL port |
| `QUICKMART_DB_NAME` | `rfid_checkout_main` | Application database |
| `QUICKMART_DB_USER` | `root` | Database account; use a dedicated account outside local setup |
| `QUICKMART_DB_PASSWORD` | Empty | Database password |
| `QUICKMART_SMTP_HOST` | `smtp.gmail.com` | SMTP server |
| `QUICKMART_SMTP_PORT` | `587` | STARTTLS SMTP port |
| `QUICKMART_SMTP_USERNAME` | Empty | SMTP login and sender address |
| `QUICKMART_SMTP_PASSWORD` | Empty | SMTP credential or provider app password |
| `QUICKMART_APP_BASE_URL` | `http://localhost/QuickMart-Final` | Exact base URL used in reset emails |
| `QUICKMART_APP_ENV` | Unset | `production` disables classroom checkout |
| `QUICKMART_DEMO_CHECKOUT` | Unset | `0` disables classroom checkout |

For local CLI operations, set the database variables in the current terminal if they differ from these defaults:

```powershell
$env:QUICKMART_DB_HOST = '127.0.0.1'
$env:QUICKMART_DB_PORT = '3306'
$env:QUICKMART_DB_NAME = 'rfid_checkout_main'
$env:QUICKMART_DB_USER = 'root'
```

Supply any database password through the local process environment. Do not publish real database, SMTP, or bridge credentials in screenshots, logs, commits, or this README.

### Fresh database

`database/schema.sql` is the only project SQL file and the complete fresh-install definition. It includes all eight tables, keys, indexes, password-reset structures, checkout persistence, and the approved catalog. There is no migrations directory or sequence of SQL patches to run afterward.

With MySQL running and no existing `rfid_checkout_main` database, import the file in phpMyAdmin or run from the repository root:

```powershell
Get-Content -Raw database/schema.sql | & 'C:\xampp\mysql\bin\mysql.exe' --host=127.0.0.1 --port=3306 --user=root --default-character-set=utf8mb4
if ($LASTEXITCODE -ne 0) { throw 'Fresh import failed; inspect the error before continuing.' }
```

Use the appropriate account/password options for your local installation. `CREATE DATABASE` deliberately has no `IF NOT EXISTS`; an existing database is an error. Standard-input batch mode stops at that error. Do not use `--force` or the interactive `SOURCE` command for this import, because continuing after a failed database creation could execute later statements against an existing database. Changing `schema.sql` in Git does not alter a database that is already installed.

### Existing database: backup and explicit upgrade

Do not re-import `schema.sql` and do not apply historical SQL patches. `tools/database-upgrade.php` reads the authoritative schema, recognizes supported legacy additions, and is a read-only plan unless `--apply` is present.

1. Stop Apache and all reader bridges/cashier sessions. Leave MySQL running. Review outstanding customer sessions before maintenance.
2. Configure `QUICKMART_DB_*` for the intended existing database in the terminal. Create a private backup directory **outside the repository and web root**.
3. Review the plan, then apply:

   ```powershell
   New-Item -ItemType Directory -Path 'C:\quickmart-backups' -Force
   & 'C:\xampp\php\php.exe' tools/database-upgrade.php
   & 'C:\xampp\php\php.exe' tools/database-upgrade.php --apply --maintenance-confirmed --backup-dir='C:\quickmart-backups'
   ```

4. Keep the printed `.sql.gz` backup private. Before making structural changes, the tool exports and rereads a complete compressed backup of all base tables, table definitions, and records. It refuses to continue when backup creation or verification fails.
5. Check the ten active catalog products, manager login, existing tag assignments, and historical receipts before reopening Apache and the bridge.

The upgrade retains manager accounts, password hashes, RFID tag IDs and statuses, product IDs, and purchase records. Matching approved product names retain their IDs and receive approved descriptions/prices/categories. Other products are **deactivated, never deleted**, including custom or referenced historical products. Existing tag registrations are not reassigned to replacement products. A manager must verify physical tags before making any deliberate reassignment.

Legacy `size` measurements are folded into descriptions when absent, then the old column is removed; the original column and values remain in the pre-upgrade backup. Fresh installations have no `size` column. Historical purchase items without a recorded tag receive a nullable `tag_id`, not a fabricated EPC. Older unsuccessful records with no reason continue to display as failed; previously unrecorded cancellations cannot be reconstructed.

Rerunning the upgrade does not duplicate products or reset accounts/history, but it resynchronizes the approved catalog and retires other active products again. It is an explicit catalog replacement operation, not an application-startup task. Ambiguous duplicate approved names, orphaned relationships, unsupported structures, non-InnoDB application tables, and custom views/triggers/routines/events require separate review rather than guessed repairs.

MySQL DDL commits implicitly. If an upgrade fails after DDL begins, keep application access stopped, retain the printed backup, and either correct the reported issue and rerun or restore to a **new empty database**. Never drop the original database as an automated recovery step. To inspect or restore a backup, decompress it outside the web root with a gzip-capable tool, create a separate empty database with matching server/case settings, and import the decompressed SQL into that selected database. The backup contains no `USE` or `DROP DATABASE` command. Set `QUICKMART_DB_NAME` to the verified restored database before restarting Apache. Test this procedure on a disposable server first.

For example, replace the backup filename with the printed path and choose an unused recovery database name. This PowerShell example refuses to overwrite an existing decompressed file:

```powershell
$backupPath = 'C:\quickmart-backups\REPLACE_WITH_PRINTED_BACKUP.sql.gz'
$recoveryFile = 'C:\quickmart-backups\recovery-review.sql'
$compressed = [System.IO.File]::OpenRead($backupPath)
$gzip = [System.IO.Compression.GZipStream]::new($compressed, [System.IO.Compression.CompressionMode]::Decompress)
$restored = [System.IO.File]::Open($recoveryFile, [System.IO.FileMode]::CreateNew)
try { $gzip.CopyTo($restored) }
finally { $restored.Dispose(); $gzip.Dispose(); $compressed.Dispose() }
& 'C:\xampp\mysql\bin\mysql.exe' --host=127.0.0.1 --port=3306 --user=root --execute='CREATE DATABASE quickmart_restore_review CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
if ($LASTEXITCODE -ne 0) { throw 'Choose an unused recovery database; import stopped.' }
& 'C:\xampp\mysql\bin\mysql.exe' --host=127.0.0.1 --port=3306 --user=root --database=quickmart_restore_review --default-character-set=utf8mb4 --execute='source C:/quickmart-backups/recovery-review.sql'
if ($LASTEXITCODE -ne 0) { throw 'Recovery import failed; do not restart the application.' }
```

Verify the restored accounts, tags and receipts before selecting this database in the Apache environment. Preserve the original database and compressed backup until recovery has been accepted.

### Approved default products

The source is `OOP_Products (1).xlsx`, cells A2:D11. Prices are Philippine pesos. Text follows the workbook, including `Lighweight`; the trailing formatting space in the toothbrush description is trimmed. Descriptions include the agreed measurements.

| Product | Description | Price | Category |
| --- | --- | ---: | --- |
| Alcohol Dispenser | Compact and Refillable (20g) | 30.00 | Home Essentials |
| Focus Refillable Fillers | Lighweight Pulp Paper (55gsm) | 25.00 | Home Essentials |
| Rice Scooper | Recyclable Plastic Material (18g) | 32.00 | Home Essentials |
| Lasap Iodized Salt | Premium Quality (100g) | 16.00 | Food & Snacks |
| Sleek Stockings | Soft and Breathable (1 pair) | 60.00 | Clothing |
| Colgate Toothbrush | Recyclable Plastic Material | 20.00 | Home Essentials |
| Dumpling Squishy | Fun and Relaxing (160g) | 67.00 | Toys |
| Lablast Detergent Bar | Floral Scent (130g) | 12.00 | Home Essentials |
| Pocky Snack Box | Chocolate Flavor (40g) | 35.00 | Food & Snacks |
| Urban Tee Shirt | Breathable Blue (F-Medium) | 100.00 | Clothing |

An empty installation has exactly these ten products and no preassigned EPCs. The retired sample products are not seeded. On an upgraded installation, inactive historical product rows remain available for historical relationships.

### Tables and relationships

| Table | Responsibility and relationships |
| --- | --- |
| `PRODUCTtbl` | Product description, current unit price, category and active status |
| `RFID_tags` | Unique EPC; foreign key to one product; available/purchased status and timestamps |
| `ADMINtbl` | Unique manager name/email, password hash and active status |
| `PASSWORD_RESET_tokens` | Hashed one-time token, expiry and use time; belongs to one manager |
| `PURCHASEtbl` | One unique purchase/session ID, manager, successful/unsuccessful status, attempt reason, item count and total |
| `PURCHASE_items` | Purchase detail with product, nullable physical tag, and the price charged at purchase |
| `CHECKOUT_sessions` | Browser-owner hash, manager, validated cart, revision, state, failure count, payment deadline and final purchase |
| `CHECKOUT_attempts` | Stored outcome/response for a payment request; primary key is `(session_id, attempt_id)` |

All tables use InnoDB. Foreign keys prevent deletion of products/tags still referenced by purchases and preserve manager/purchase relationships. Unique EPCs prevent duplicate physical stock; a unique purchase session prevents duplicate final purchases. Transaction history uses purchase-item prices rather than current product prices. The UI's Activity Feed is temporary browser memory, not permanent audit logging.

## Manager authentication and password reset

The first manager can be created only from a loopback request on a localhost host while `ADMINtbl` is empty. Subsequent signup is blocked. Existing accounts remain valid after an upgrade. Passwords must be 8–72 **bytes**, are hashed using PHP `password_hash`, and are verified only on the server.

PHP session cookies use HttpOnly and SameSite=Lax; Secure is enabled when HTTPS is in use. Requests recheck account status and a password fingerprint. Resetting a password invalidates existing authenticated sessions when they next access the server. Manager inactivity expires after 30 minutes; the maximum session duration is eight hours. Scan authorization lasts 15 minutes and must be renewed through manager approval when it expires.

Three failed login or manager-password attempts trigger a 60-second lockout in that PHP session; a page refresh does not reset it. These are separate from the checkout's database-backed payment attempts. Additional account/IP throttling is needed before any public deployment.

Forgot Password returns a generic response whether an account exists or mail delivery succeeds. Reset tokens contain 32 random bytes, are stored as SHA-256 hashes, expire after 30 minutes, and are single-use. A successful reset consumes all outstanding reset tokens for that manager. Links open the existing login-page reset modal; `manager/reset-password.html` preserves old bookmarks.

PHPMailer uses authenticated STARTTLS SMTP. Configure the SMTP variables and exact `QUICKMART_APP_BASE_URL`, run Composer, and restart Apache. A compatible provider can be used; Gmail requires its own supported account/app-password setup. Check the PHP/Apache error log for missing dependencies or delivery errors. Automated token tests do not verify delivery to a real mailbox.

A previous hardcoded SMTP credential remains in repository history even though current configuration no longer contains it. The account owner must revoke that old credential and create a fresh private credential before enabling email. Removing it from the current files cannot invalidate copies already present in Git history or downloaded archives.

## Product management and bulk RFID restocking

Inventory supports product creation, editing, activation/deactivation, search, category filtering, low-stock filtering, and five-row pagination. Category names and search ignore case; saving `egg` when `Egg` exists reuses the established spelling. Product removal deactivates the record instead of deleting history.

To restock, select one active product, open **Assign EPC tags**, press **Start Scanning**, and present only tags for that product. Press **Stop Scanning**, review the unique captured rows, remove incorrect pending EPCs if needed, then choose **Register N Tags**. The EPC display is read-only; typing or pasting into it does not create registrations. Changing the selected product requires discarding pending tags. Clear/Close discards pending captures without changing stock.

Registration requires a fresh manager-password approval. Approval is single-use and valid for two minutes; calling the registration API directly without it is rejected. Up to 100 EPCs are accepted per request. Duplicate reads and same-product registrations are skipped, and EPCs already owned by another product are reported rather than reassigned. A batch reports registered, same-product, other-product and invalid EPCs separately; do not assume every row was inserted because the request completed.

Incorrect old assignments are not repaired automatically. After a backup, inspect exact EPCs and label their physical products:

```sql
SELECT r.epc, r.product_id, p.product_name, r.status, r.registered_at
FROM RFID_tags AS r
JOIN PRODUCTtbl AS p ON p.product_id = r.product_id
ORDER BY r.registered_at DESC, r.tag_id DESC;
```

Only after positively identifying a specific **AVAILABLE** tag, an operator may deliberately correct its assignment. Replace every example value, verify the intended product is active, and check that exactly one row changed:

```sql
UPDATE RFID_tags
SET product_id = 123
WHERE epc = 'ENTER_EXACT_EPC_HERE'
  AND product_id = 456
  AND status = 'AVAILABLE';
```

Never bulk-move tags based only on an old product name or reassign purchased tags without reviewing their receipts.

## Reader input, isolation and optional Python bridge

### HID keyboard mode

Browser keyboard events do not identify which physical keyboard produced a character. The scanner and input guard recognize supported reader-shaped bursts, restore affected input, and suppress their trailing Enter. Ordinary typing, paste, editing and navigation are covered by simulated tests. For the verified reader-shaped 24-character frames beginning with `E2` (and legacy `30` EPCs), a short capture-phase prefix buffer prevents the initial 2–3 characters from being inserted in text fields. Normal standalone typed characters are replayed after approximately 90 ms; this is a heuristic, not a device-specific HID block. Fast manual entry of a long identical hex sequence may be mistaken for a reader, so paste a known EPC when manual entry is needed. Unknown EPC prefixes and unusually slow or nonstandard reader output can still leak before rollback. Timing detection cannot guarantee source isolation: a slow/nonstandard reader may leak characters, and sufficiently fast human hexadecimal input can be ambiguous.

All six interactive manager pages load the same capture guard in the document head, before forms become interactive. Input Tag delegates to that guard rather than applying another detector. The fallback retains the twelve-key threshold to preserve short manual PIN/hexadecimal input, recognizes gaps below 85 ms, retains an identified frame through pauses up to 340 ms, and covers bulk hexadecimal `insertText` events in `beforeinput`/`input`. The prefix buffer and fallback share the original rollback baseline so a pause cannot leave the replayed first characters behind. A completed Enter releases the next person's typing immediately. Explicit paste and composition remain available. This fixes reproduced leakage at 75 ms per key and trailing fragments after USB pauses; it cannot identify a fully slow/short reader frame or separate simultaneous human/reader hexadecimal characters. These thresholds are regression-tested examples, not a measured calibration of the supplied reader.

Uppercase reader output can include separate Shift key transitions. Those modifier keys no longer reset either input guard or replay a pending prefix. A regression reproduces the previous escaped suffix/Enter with this HID event sequence and verifies that the complete frame is rejected. This is synthetic event coverage; the supplied reader's exact modifier sequence has not been physically captured.

Holding Shift can turn reader digits into symbols such as `!`, `@`, or `)`, and Caps Lock can change letter case. Recognition now uses validated physical `Digit0`–`Digit9`/`KeyA`–`KeyF` codes, with character fallback when a code is unavailable. Shift and Caps Lock transitions preserve the frame; their native keyboard behavior is not disabled. Human input always replays its original `event.key` text rather than being changed into a digit or capital letter. The narrow `E`/`e`/`3` prefix candidates can wait up to 90 ms after the last candidate key; other typing remains immediate. Authorized RFID capture uses the same hex positions, so modifier state does not corrupt the captured EPC. Editing a normal field still cannot register stock.

Repeated keydowns no longer bypass a buffered `E2`/`30` prefix or an identified frame, including its repeated Enter. The former unconditional `event.repeat` bypass replayed the entire pending tag into the kiosk exit password. Ordinary held keys remain available, and repeats alone do not advance scanner detection. A confirmed new prefix also captures its own password value and selection, preserving the person's last hexadecimal character when a reader starts immediately afterward. All six pages use a new guard URL version to invalidate cached code. `tests/rfid-repeat-guard.js` covers these event sequences; it does not establish which events the physical reader actually emits.

The early-edit follow-up also holds Backspace, Delete and non-hexadecimal text during the first one to three pending characters. Previously those keys replayed `E`, `E2` or `E28` into the field before the rest of the scan was rejected. If the candidate is ordinary typing, buffered characters and edits replay in their original order after the short prefix window; if it becomes a recognized reader frame, only the person's distinguishable edits apply to the original value and selection. Repeated deletion keys are covered. The separate 600 ms closing-Enter window survives the 400 ms edit-release timer. Simultaneous human hexadecimal keys remain indistinguishable from scanner keys; this change does not promise physical device isolation.

Capture is enabled only in an authorized Product Recognition session or after **Start Scanning** in Inventory restocking. Manager credentials, review/remove/manual-input popups, and other pages do not authorize EPC capture. Disable continuous reader output using its vendor-supported controls while using ordinary forms if HID interference persists. Never change the laptop keyboard driver to solve this application problem.

### Identify the actual device first

Use Windows Device Manager, the reader vendor's documentation, and a read-only device listing to establish its actual USB identity and interface. With the optional Python dependencies installed:

```powershell
python -m pip install pyusb libusb-package
python rfid-bridge/rfid_bridge.py --list
```

Compare plugged/unplugged inventory carefully. Record VID, PID, interface number, protocol/report descriptor and, where available, serial number. A device label or example VID/PID from an old note is not evidence of compatibility. No physical reader was identified or claimed during automated validation.

During the subsequent physical-device investigation, the user confirmed the reader's plugged/unplugged identities above. Its `MI_00` descriptor exposes 64-byte vendor-defined reports, not the eight-byte boot-keyboard layout supported by the current bridge. Read-only HID access succeeded, but no input report was observed; an available CF-series SDK enumerated zero compatible devices. Reader-only Windows Raw Input observation also captured no fresh key events, so its output cadence and suppression remain physically unverified. No reader settings, firmware, or Windows drivers were changed. `86260900` is the reader's label/barcode, not an EPC. Obtain a verified protocol/settings tool for this exact device before changing its output mode; an unrelated reader SDK is not sufficient evidence.

### Supported bridge setup

Use the bridge only after confirming that the reader offers safe, independent USB access through an already supported interface. It accepts a verified standard eight-byte boot-keyboard HID interface with the expected interrupt-IN endpoint/report descriptor. Unsupported layouts fail closed. A vendor SDK/protocol integration is required when this does not apply. The bridge does not detach kernel drivers or install/replace Windows drivers.

Configure `rfid-bridge/rfid_bridge.json` with the **actual** `vid`, `pid`, `interface`, optional `serial`, and exact application `allowed_origins`; set `confirm_reader_interface` to `true` only after confirming those requirements. The supplied null IDs and false confirmation intentionally refuse startup. An origin is scheme plus host plus optional port, such as `http://localhost` or `http://localhost:8080`, without the application path. Do not select the laptop keyboard or an arbitrary composite-device interface.

Start the configured bridge:

```powershell
python rfid-bridge/rfid_bridge.py run
```

The bridge prints a fresh pairing command. Run that exact command in the browser console on Inventory or the kiosk, where `RFIDScanner` is loaded:

```javascript
RFIDScanner.configureBridge({token: "TOKEN_PRINTED_BY_YOUR_BRIDGE", port: 5757});
RFIDScanner.getBridgeHealth();
```

Pairing is stored only for the browser tab's session. `RFIDScanner.disconnectBridge()` removes it. To reuse a secret across bridge restarts, securely supply `QUICKMART_RFID_BRIDGE_TOKEN` with 32–128 random URL-safe characters. Keep it private.

The server binds to `127.0.0.1`, validates its Host header, exact allowed Origin and pairing token, and grants one tab an eight-second renewable capture lease. Polling occurs every 120 ms only while capture is enabled and unblocked. Releasing/claiming clears stale queued reads. Another tab cannot silently drain its queue. HTTP availability and USB reader connection are reported separately. When bridge mode is explicitly paired, disconnection does not silently switch EPC capture to keyboard input; reconnect or deliberately disconnect pairing after resolving the input path.

Bridge health distinguishes live `connected` from `lastVerifiedConnected` while `paused`. Deliberately pausing capture for a popup retains the last verified USB state so normal keyboard input is not mistaken for a wedge burst; this is not a live connection check during the pause. An observed disconnect or failed poll clears that verification.

The Windows `list-usb.bat`, `run-bridge.bat` and `debug-bridge.bat` wrappers run these same operations. Debug mode prints raw device reports; use it only during a controlled hardware test. `build-exe.bat` installs its build requirements and uses PyInstaller to create `dist/rfid_bridge.exe` with its JSON configuration; packaging does not establish device compatibility. Configure and verify each target computer before considering automatic startup.

### Antenna, power and reading range

RFID presence is estimated from repeated reads, not a physical in/out sensor. Adaptive read-gap tolerances are approximately 4.5–22 seconds, with longer first-read allowance for larger tag populations. Popup pauses do not count as reader absence. `RFIDScanner.getDiagnostics()` and `RFIDScanner.getReadHealth()` expose read counts, estimated intervals and last sightings for controlled diagnosis.

A previously discussed 18 × 12 × 12 inch platform is a test fixture, not a verified RF boundary. Position the reader under a thin nonmetal floor, then test the center, corners, height and surrounding area. Adjust supported power/antenna settings using the actual vendor tool. Packaging, metal, liquids, orientation, spacing and nearby tags affect detection. Software cannot guarantee that only nearby tags will be read, or establish a 20-tag capacity from the API's 100-EPC limit.

## Product Recognition and hold-in-cart

The manager starts Product Recognition with password verification. Each newly read EPC must be registered, available, and attached to an active product before PHP accepts it into the cart. Repeated reads of one EPC never increase quantity. Two distinct EPCs for the same product count as two physical items.

Once validated, an item remains in the cart through missed reads and recoverable lookup/network errors. Each row retains **Currently Detected** or **Currently Not Detected** information. Estimated absence changes this indicator; it does not remove a valid cart item. Lookups are serialized, stale responses are ignored, and transient lookup failures are retried without clearing the cart.

**Remove** asks the customer to confirm the number of physical units. An individually removed EPC that remains detected is suppressed to prevent immediate re-addition. Removal retains its last-read timestamp. Automatic rearming compares a returning read with the cadence measured before that read, using a gap of at least 1.5 seconds and one measured inventory cycle plus the larger of 500 ms or 25 percent of that cycle. The return gap cannot inflate its own threshold. Unmeasured first repeats do not prove removal, and time spent in a blocked popup does not count as absence. Genuine adaptive absence still clears suppression without an additional waiting period. Read gaps estimate movement; they cannot prove a physical lift-off.

**Cancel Order**, **Cancel transaction** and **Cancel Payment** finish the server cancellation, clear the cart, and apply a fixed three-second pause to the cancelled EPCs. Their next fresh RFID read after that pause automatically starts a new checkout; no rescan button is needed. Repeated reads during the pause do not extend its deadline. Products are not restored from cached presence alone, and a failed cancellation keeps the current cart instead of arming a new checkout. Refresh preserves the original deadline. Popup/authorization restrictions, exact-EPC deduplication and PHP eligibility validation still apply, including rejection of purchased, inactive and unknown tags.

A cancelled tag left on the reader can be added again after the pause because the reader continues reporting it. The visible delay is three seconds plus the wait for the next actual inventory report and backend response; a slow physical reader cannot be promised a three-to-four-second result. Individual **Remove** actions and idle timeouts retain their movement/absence rules. Explicit **Input Tag** remains a deliberate, backend-validated way to add a known EPC.

The cart becomes a server checkout session and is saved after changes. **Checkout** opens **Check your cart**. PHP validates a revision of the cart; **Confirm Checkout** must confirm that same reviewed revision before payment begins. Changes in price, product status or tag eligibility require another review.

## Checkout persistence, navigation and payment

`CHECKOUT_sessions` stores the cart, owner, revision, failed attempts, deadline and final state. The browser retains only its session ID, EPC identities and removal-suppression hints in `sessionStorage`; PHP revalidates recovered identities. Refreshing with a valid PHP session reloads the authoritative cart or final result. Payment refresh uses the existing server deadline and failure count rather than starting over.

The frontend adds a same-page history sentinel during checkout, warns on page unload where the browser permits it, and rechecks server authentication after a browser history-cache restore. Manager APIs reject privileged access while that browser is in kiosk mode. Manager exit requires fresh password verification before scan authorization is revoked. Opening a static HTML page or changing browser storage does not grant access to protected API data or manager mutations.

Browser Back, Forward, refresh, tab closing, address-bar navigation and OS shortcuts cannot be universally disabled by JavaScript. Use a separately administered Windows/browser kiosk mode if stronger physical navigation restrictions are needed. Test its recovery and authorized exit policy on the actual laptop. Recovery depends on the valid browser/PHP session; clearing cookies, session expiry or a new login does not promise automatic access to a former owner's checkout. The database retains those records for operator review.

Cart-screen inactivity cancels the order after two minutes. Payment has its own **300-second server deadline**, starting on confirmed checkout. Expiry is enforced when checkout state is next accessed; no background payment scheduler is required. Cancelling or timing out creates one unsuccessful transaction and leaves tags available. If saving cancellation fails, the frontend retains recovery information instead of discarding the cart.

### Classroom QR fixtures

The QR images in `demo-qr-codes/` may be displayed on a phone for the camera to scan. The kiosk displays the camera, not a payable wallet QR. Camera decoding uses `html5-qrcode` and, where supported, a native `BarcodeDetector` fallback. Library downloads require internet or an existing browser cache; completely offline camera operation is not guaranteed.

| Payload | Simulated outcome |
| --- | --- |
| `QUICKMART-DEMO\|PAYMENT_SUCCESS\|OFFLINE-V1` | Success |
| `QUICKMART-DEMO\|NO_BALANCE\|OFFLINE-V1` | Insufficient balance |
| `QUICKMART-DEMO\|NO_INTERNET\|OFFLINE-V1` | Network failure scenario |
| `QMPAY\|QM-WALLET-1001\|C899` | Original success fixture |
| `QMPAY\|QM-WALLET-1002\|C900` | Original insufficient-balance fixture |

These public strings are fixed classroom scenarios. There are no wallet accounts, balance queries or deductions. The NO_INTERNET fixture is submitted to PHP like the other fixtures; it does not disconnect the computer or bypass the backend. Unrecognized QR payloads also fail.

Every distinct failed submitted QR attempt, including invalid QR, is counted in MySQL. After attempts one and two, the camera pauses and the customer uses **Scan again**. The third failure voids the checkout and records its unsuccessful outcome. A stable `attempt_id` makes retries of the same request return the stored outcome instead of consuming another attempt. Actual transport failures are unresolved requests, not proof that payment succeeded or failed; recover server state before retrying.

Successful checkout locks/revalidates all participating tags and products, creates the purchase and item rows, marks tags purchased, and finalizes the checkout in one InnoDB transaction. A failure rolls the transaction back. Repeated requests return the existing successful result; unique session/request keys prevent duplicate purchases. Competing sessions cannot both purchase the same tag. Failed/voided/cancelled requests never mark their tags purchased.

Classroom checkout is enabled only when both request address and host are loopback/localhost. LAN/public hosts, `QUICKMART_APP_ENV=production`, or `QUICKMART_DEMO_CHECKOUT=0` disable it. There is no real payment gateway in this repository.

### API boundaries

JSON mutations use `Content-Type: application/json` and same-origin requests. Responses include `success` plus data or a meaningful error; the frontend never treats an HTTP error as a successful stock/payment change.

| Route | Behavior |
| --- | --- |
| `api/auth/*.php` | First-account setup, login/logout, session checks, password verification/reset |
| `api/products/*.php` | Authenticated product CRUD/status/list; optional inactive-product inventory view |
| `api/rfid/authorize-restock.php` | One registration approval after manager-password verification |
| `api/rfid/register.php` | Validated unique EPC batch registration |
| `api/rfid/detect.php` | Backend product/tag validation during authorized scanning |
| `api/rfid/list.php` | Authenticated tag inventory |
| `api/checkout/session.php` | `status`, `save`, `review`, `confirm`, `cancel`, `timeout` for the owning session |
| `api/checkout/process.php` | Server-controlled fixture outcome, persistent attempt limit and transactional completion |
| `api/checkout/log.php` | Compatibility cancellation route; client totals/failure counts are not authoritative |
| `api/transactions/list.php` | Purchase history, successful item details and failed/cancelled records |
| `api/dashboard/summary.php` | Real successful sales totals and RFID-derived inventory |

Transaction History shows newest purchases first, breaking same-second ties by purchase ID. Unsuccessful/cancelled records do not contribute to sales revenue. Purchased item prices are retained even when a product's current price changes.

## Automated checks

Run the unified portable checks from the repository root with PHP and Node.js on PATH:

```powershell
python tools/check.py
```

This runs project PHP/JavaScript/Python syntax and the relevant regression suites. For real SQL/HTTP integration tests, start a **disposable** MySQL/MariaDB service, give the test account permission to create/drop test databases, and set a server DSN **without `dbname`**:

```powershell
$env:QUICKMART_TEST_DSN = 'mysql:host=127.0.0.1;port=3306;charset=utf8mb4'
$env:QUICKMART_TEST_USER = 'root'
$env:QUICKMART_TEST_PASSWORD = ''
python tools/check.py --database
```

Do not point the test DSN at a production server. Tests create and remove only their randomly named `quickmart_test_*` databases and temporary backups. They do not load the application's production database configuration.

Database coverage includes fresh installation, the exact approved catalog, primary/foreign keys, legacy upgrades, reruns, backup restoration, safe failure, existing manager/tag/history preservation, authentication/reset-token behavior, product CRUD, restocking, checkout confirmation, persistent failed attempts, refresh/retry idempotency, competing purchases, transaction history and inventory integrity. Browser JavaScript tests simulate RFID bursts, ordinary input, multitag registration, cart retention/indicators, removal/re-arm behavior, modal blocking and interrupted requests. Bridge tests use synthetic USB reports and real local HTTP requests; they do not access a physical reader.

Local verification passed 119 backend HTTP/database checks, 35 schema/upgrade checks and 12 Python bridge tests, together with the JavaScript regression suites, including `kiosk-recovery.js` and `navigation-auth.js`. A separate automated Chrome smoke test passed ten observations across login, restocking, cart/refresh recovery, persistent payment attempts, duplicate-payment protection, navigation and manager exit, with no JavaScript errors. Its RFID events were synthetic and its camera was stubbed; it did not verify the physical reader or camera. The isolated PHP development-server harness needed a 120-second execution budget after one password verification exceeded its default 30 seconds; verify authentication latency and PHP limits on the actual Apache installation rather than treating that harness setting as a performance fix. A repeated fresh-install CLI import was also checked: batch mode stopped at the existing-database error and retained exactly ten catalog rows.

`tests/input-frame-guard.js` adds input-isolation regressions for all six pages, text/password/search/email/tel/url/number/textarea fields, delayed bursts, scheduling pauses, selection restoration, bulk insertion, composition, deliberate paste, normal manual EPC entry, and verified-bridge bypass. These tests simulate browser events and do not certify physical reader isolation.

The focused follow-up passed 82 input-frame checks, the complete portable suite, and 34 isolated Chrome form observations across the six pages, including explicit Shift transitions. The Chrome checks used automated keyboard events with backend/bootstrap scripts disabled; they verify the shared guard on actual form elements, not backend integration or physical RFID behavior. Output arriving outside the documented timing windows can still escape the heuristic.

`tests/rfid-modifier-guard.js` adds 118 checks for lowercase EPCs, Shift-modified digits, Caps Lock transitions during a frame, exact human character/selection preservation, raw-mode bypass, and authorized capture. Native Chrome reproduced the old held-Shift leak and the Caps Lock prefix leak; the patched guard passed four real-form scenarios with no submissions, and the 34 form observations across six pages passed again. Automated Chrome does not toggle the actual Caps Lock letter-case state, so case inversion is covered by simulated input events. A deliberate 650 ms pause before the closing Enter exceeds the 600 ms prefix-frame window and allows the form to submit; this confirms the documented timing limitation rather than physical-device isolation.

`tests/rfid-edit-isolation.js` exercises edits at every interior position of both supported reader prefixes, four editable field types, replacement selections and collapsed carets, ordinary text replay order, held deletion and delayed Enter. `tests/kiosk-rescan.js` loads the actual scanner together with the kiosk, including its live cadence estimator: it covers individual-removal read gaps, every cancellation control, the exact three-second boundary, automatic three-to-four-second returns, continuous-read deduplication, slow and unmeasured cadence, multiple tags, refresh, failed cancellation, popup pauses, genuine absence and backend rejection. These are simulated browser/USB/API scenarios; physical reader acceptance remains required.

The GitHub Actions workflow in `.github/workflows/` is configured to install Composer dependencies, run the unified checks, and run database integration against a disposable MySQL 8.0 service. Local database verification uses XAMPP MariaDB 10.4. Check the pull request's actual GitHub check results for remote CI status. A passing suite establishes the tested software behavior, not a complete customer playthrough or physical hardware certification.

## Manual acceptance checklist

Use a backed-up staging installation and record the actual reader model, VID/PID/interface, firmware/configuration, browser, database and PHP versions with results.

- [ ] Install an empty database and confirm exactly ten approved products, zero default managers and no seeded EPC stock. Upgrade a separate copy of existing data and restore its generated backup into another empty database.
- [ ] Create the first manager on localhost; reject another signup and remote setup. Sign in/out, reject direct unauthenticated API access, test the three-password lockout, and verify password-reset email delivery, link expiry, single use and session invalidation.
- [ ] Create/edit/deactivate a product; verify case-insensitive categories/search, pagination, displayed description/measurements and current stock. Confirm no separate size field is required.
- [ ] Restock one product with repeated reads and several distinct physical EPCs. Verify unique capture, pending-row removal, Stop/Clear/Close, product change, fresh manager approval and cross-product duplicate rejection. Confirm each inserted tag appears once in MySQL.
- [ ] Test normal typing, paste, cursor/selection editing, Backspace, Tab, Space and Enter in login, password, inventory and search fields while the reader is active/inactive. Record any HID leakage; do not label heuristic suppression physical isolation.
- [ ] For a supported bridge interface, verify keyboard operation and reader isolation in Notepad, pair the intended browser origin, check USB connection health, reject an unpaired/wrong-origin client, and verify that a second tab cannot steal capture. Unplug/reconnect during a scan and confirm recovery without false EPCs or silent mode switching.
- [ ] Test 1, 5, 10, 15 and 20 tags for 30–60 seconds each at the center, corners, height limits and outside the intended platform. Repeat with metal/liquid packaging and changed orientations; measure actual power/range using vendor-supported controls.
- [ ] In Product Recognition, verify same-EPC deduplication, different EPCs for one product, unknown/inactive/purchased rejection, retained carts during missed reads, and both detection indicators.
- [ ] Remove a cart item while it remains on the reader; confirm no immediate re-addition. Physically remove it until absence is observed, rescan, and confirm prompt eligibility with no extra suppression timer. Verify manual EPC entry remains deliberate and backend validated.
- [ ] Cancel through the cart, payment and failed-transaction controls. Verify there is no rescan button: the same available products return automatically on a fresh read after a three-second pause. Repeated reads must not extend the pause or duplicate EPCs. Refresh during the pause and verify the original deadline. A cancellation failure must keep the old cart, and purchased/inactive/unknown tags must still be rejected. Repeat with multiple physical tags and record the actual inventory/report latency.
- [ ] Review the cart, return to edit, then confirm payment. Change price/availability between review and payment and confirm the customer must review updated information.
- [ ] Test Back, Forward, refresh, page-cache restoration, attempted manager URLs, close/reopen where supported, expired scan authorization and manager exit. Recover an interrupted cart/payment under the same valid PHP session; verify manager APIs stay protected during kiosk mode.
- [ ] With camera permission enabled, scan each classroom QR image and an invalid QR. Verify camera retry, attempts one/two/three, refresh after failed attempts, the five-minute deadline, customer cancellation and cart inactivity cancellation. Confirm actual network loss does not fabricate success or failure.
- [ ] Repeat a successful payment submission and simulate a lost response. Confirm one purchase only. Try two sessions competing for the same EPC; confirm only one succeeds. Verify every failed/voided flow leaves its tags available.
- [ ] Verify history ordering, item detail, charged prices, failed/cancelled records, dashboard totals and stock against MySQL. Confirm beep/audio, responsive layout and all existing dialogs on the target laptop.

Real USB/UHF operation, camera capture, speaker playback, external SMTP delivery and the full manual browser checklist require local sign-off; simulated or HTTP integration tests do not replace them.

## Troubleshooting and operational limits

| Symptom | Check |
| --- | --- |
| Database unavailable or unknown table/column | MySQL running, correct host/port/account, `pdo_mysql`, Apache environment, and fresh import versus explicit existing upgrade. Never repair by dropping the live database. |
| Old layout/scripts or EPC field editable | Confirm Apache serves the intended checkout; hard-refresh with Ctrl+F5; verify Inventory uses the non-editable `#epc-list` and has no editable EPC input/textarea. |
| Scanner text enters ordinary fields | HID source cannot be guaranteed from browser timing. Pause vendor inventory output and investigate supported independent reader access; do not replace arbitrary keyboard drivers. |
| Bridge refuses startup | Null/mismatched VID/PID, unconfirmed interface, unsupported descriptor, unavailable existing USB access, or incorrect localhost origin. Its refusal is not evidence that a driver change is safe. |
| Bridge HTTP works but no tag reads | Inspect `RFIDScanner.getBridgeHealth()`, actual reader connection, capture lease, Start Scanning/manager authorization and vendor continuous-output settings. |
| Another tab owns capture | Close/stop that tab or wait for its short lease to expire; do not remove authentication/CORS protections. |
| Missing detection indicator or slow re-arm | Inspect read counts/intervals. One-shot output and gaps cannot prove physical presence/removal. A cart item's retention is separate from estimated detection status. |
| Incorrect product for an EPC | Audit exact physical tag mappings; the catalog upgrade does not reassign old registrations. Use the targeted, backed-up correction procedure above. |
| Camera denied/unavailable | Use localhost or HTTPS, allow camera access, close competing camera apps/tabs, and retry. Verify CDN access/cache or native decoder support for offline use. |
| Checkout unavailable | Use localhost, verify valid manager/scan authorization and schema, check demo-disable flags, and recover server state before resubmission. LAN hosts are intentionally excluded. |
| Cart sync/cancellation delayed | Keep the checkout open, restore PHP/MySQL connectivity, recover the same session and verify its server outcome; do not erase recovery data to hide the error. |
| Reset email missing | Composer/vendor autoload, SMTP STARTTLS credentials/port, firewall/provider settings, exact base URL and PHP error log. The generic browser response does not confirm delivery. |
| Whole computer/USB input freezes | Test another supported USB port/cable and vendor inventory rate; browser timing changes cannot repair a failing USB device. |

Prepared statements, server authorization, same-origin mutation checks, unique keys, transaction locks and private bridge pairing protect the implemented flows. They are not a complete public-hosting security review. Keep backups and credentials private, use least-privilege database accounts, and apply HTTPS and deployment-specific access controls where appropriate.

The root `.htaccess` disables directory listing and denies HTTP access to `.git`, `vendor`, `database`, `tests`, `tools`, `rfid-bridge`, environment files and Composer metadata. These rules require Apache `mod_rewrite` and working directory overrides; PHP's development server does not apply `.htaccess`. After configuring XAMPP, verify that requests to `database/schema.sql`, `.env.example` and `.git/config` return 403/404 while ordinary application assets still load. Do not expose the checkout on another web server until equivalent private-source restrictions are configured and verified.

Future work may add a vendor-supported reader protocol/power integration, measured antenna calibration, stronger account/IP throttling, cross-session operator recovery, self-hosted QR decoding assets for predictable offline use, and permanent audit logging. A real payment provider would require an explicit separate integration with server-side verification; public QR strings cannot provide that functionality.
