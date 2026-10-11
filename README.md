# QuickMart Final — Integrated RFID Checkout

Source: the group's QuickMart visual frontend and the PHP/MySQL backend from
`Kyoktaka/rfid-checkout-backend`.

> **Integration in progress:** This repository contains the latest PHP/MySQL backend.
> The frontend is supplied as a separate **QuickMart-Final Frontend Overlay** ZIP
> until its original binary design assets have been uploaded. Do not assume that
> this repository is independently runnable without `index.html`, `css/`,
> `js/`, and `assets/images/`.

## Running under XAMPP

1. Install/clone to `C:\xampp\htdocs\QuickMart-Final`.
2. Copy the contents of the integrated frontend overlay's `frontend/` folder
   into the repository root. Keep the existing CSS and images.
3. Start Apache and MySQL. Use **a fresh database**: import
   `database/schema.sql` with phpMyAdmin. On a fresh import, **do not run migrations**.
4. Confirm `config/database.php` matches the local database.
5. Run `composer install` from the project root for PHPMailer.
6. Open `http://localhost/QuickMart-Final/`.
7. Sign up **the first manager only** (username + email + 8–72 byte password)
   on the same localhost machine, then sign in with the **email** and password.
   Once the first manager exists, open signup is disabled by design.
8. For forgot password set SMTP environment variables
   `QUICKMART_SMTP_USERNAME` and `QUICKMART_SMTP_PASSWORD` (Gmail app password),
   and optionally `QUICKMART_APP_BASE_URL` to match the local URL.

## Checkout payment simulation

No real payment gateway is integrated, and a scanned QR is not a real payment.
In the PHP/Apache server environment, for **localhost demonstration only**, set:
```
QUICKMART_APP_ENV=development
QUICKMART_DEMO_CHECKOUT=1
```
Example simulated QR payload: `QMPAY|DEMO|C293`. Its checksum is not a
cryptographic signature and must never be used for real purchases. Payment
checkout remains blocked with HTTP 503 without explicit demo flags, and also
requires an active manager-authorized scan session.

The connected USB UHF RFID keyboard-emulation reader emits EPC strings.
This cannot fully establish physical tag presence; calibrate the 3-second
grace period on actual hardware. The backend owns EPC registration and marks
each tag `PURCHASED` only on a committed checkout.

## Data contracts

- `api/auth/`: secure PHP manager sessions and password recovery.
- `api/products/`: create/update/list/deactivate/reactivate product data.
- `api/rfid/`: EPC lookup and product registration.
- `api/checkout/`: checkout and failed/cancelled attempt log.
- `api/transactions/list.php`: stored transaction records and product receipts.
- `api/dashboard/summary.php`: MySQL sales and inventory metrics.

The dashboard activity feed is in-memory only. Permanent activity auditing
would require an additional `ACTIVITY_LOGtbl` and backend writer logic.

## Validation

Automated GitHub Actions checks PHP and frontend JS syntax.
Live database/SMTP/USB reader/demo checkout integration still requires XAMPP
testing on the target machine.

**Do not deploy the demo checkout to a public server.**
