# James — QuickMart Authentication & Password Recovery

This implementation works with the current six-table `database/schema.sql` and does not modify the other backend modules.

## Required local setup

1. Use **PHP 8.1+** (the shared `config/bootstrap.php` has a `never` return type). Enable `pdo_mysql` and `openssl` in the XAMPP PHP runtime.
2. Start Apache and MySQL; import `database/schema.sql` into the `rfid_checkout` database (or the name configured in `config/database.php`). Verify the configured MySQL port and credentials; the previous test machine did not have MySQL listening on 3306.
3. Install Composer, then run `composer install` at the repository root. This installs PHPMailer into the locally ignored `vendor/` folder. For the first installation without a committed lockfile, Composer will resolve dependencies and generate `composer.lock`; review and commit that lockfile separately once verified.
4. Set the following environment variables **in the PHP/Apache server process** (not just a new PowerShell terminal):

   - `QUICKMART_SMTP_USERNAME` — Gmail account used for sending mail
   - `QUICKMART_SMTP_PASSWORD` — Gmail App Password (keep it out of Git)
   - `QUICKMART_APP_BASE_URL` — exact application URL, e.g. `http://localhost/rfid-checkout-backend`
   - Optional: `QUICKMART_SMTP_HOST` (defaults to `smtp.gmail.com`), `QUICKMART_SMTP_PORT` (defaults to `587`)

   Restart Apache after changing its environment. Do not place live credentials in `config/mail.php` or commit them to GitHub.
5. Use the existing secure initial-account setup process. Follow its requirements for `QUICKMART_ALLOW_SETUP` and disable setup immediately after creating the first manager account.

## API contracts

- `POST api/auth/forgot-password.php` with JSON `{ "email": "manager@example.com" }`. Always returns a generic success message to avoid leaking registered addresses.
- `POST api/auth/reset-password.php` with JSON `{ "token": "64 lowercase hex characters", "password": "new password" }`. Tokens expire after 30 minutes, are stored only as SHA-256 hashes, and are consumed along with every other outstanding token for the account upon success.
- Accepted password length: **8–72 bytes** (not necessarily characters). This matches the bcrypt input limit for the current `PASSWORD_DEFAULT` algorithm and the existing account setup implementation.
- Existing sessions revalidate the account's password fingerprint on later requests, so previously signed-in sessions become invalid when a password changes.

## Test/operational notes

- PHP syntax checks do not prove that MySQL/SMTP are running. Do live tests against the actual XAMPP MySQL database and Gmail SMTP account before merging to `main`.
- The forgot-password endpoint deliberately does not disclose mail delivery errors to an unauthenticated caller. Check PHP error logs if mail is missing; ensure the App Base URL and mail variables are correctly configured.
- Add request throttling (by IP and by account) before internet deployment. Session-cookie and scan authorization controls from Phase 1 remain in place.
- The `James` branch should contain only James's changes; RFID, Product CRUD, Checkout, Transactions, Dashboard, frontend, and database schema remain owned by their respective teams.
