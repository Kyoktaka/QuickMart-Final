# QuickMart Checkout Integration — Review Before Merging

This branch fixes the `main` contract gaps: purchase session IDs, distinct failed vs cancelled
attempts, item quantities in transaction history, RFID-derived product stock and frontend IDs.

## Database migration required

For an **existing** `rfid_checkout_main` database, back up first, then run
`database/migrations/20261010_checkout_contract.sql` **once**.
It converts `PURCHASEtbl.session_id` to VARCHAR(50) and adds:
- `attempt_status`: nullable `failed`/`cancelled` for unsuccessful records.
- `attempted_items`: number of cart items shown during the unsuccessful attempt.

For a **new** installation use `database/schema.sql` (do not run the migration again).
Do not re-import the create-table schema over existing data.

Old unsuccessful records lack an attempt status and appear as `failed` by default;
it is impossible to reconstruct cancellations that were not previously recorded.

## Checkout and payment boundaries

**A QR scan is NOT proof of payment.** The existing frontend `qr:scanned` event
is a demonstration trigger. Until a server-side provider verification system is connected,
`api/checkout/process.php` fails closed with HTTP 503 and never marks tags PURCHASED.

For a **local school demonstration only**, set BOTH environment variables on
the PHP/Apache server:
- `QUICKMART_APP_ENV=development`
- `QUICKMART_DEMO_CHECKOUT=1`

Requests must originate from the PHP server's loopback address (127.0.0.1 or ::1).
The demo checkout is **not a genuine payment**. Never enable this mode on a
public/production deployment. The success response includes `demo_mode: true`.

For production, integrate the selected payment provider's **server-side verification**
before releasing a successful checkout; do not just accept a client `paid` flag.

## API contracts

- `GET api/transactions/list.php`: `transactions` array with frontend fields
  `id`, `date`, `items`, `amount`, `status` (success/failed/cancelled).
- `GET api/products/list.php`: products include `unit_price`, `stock_available`,
  `formatted_product_id`. Frontend also accepts `price` derived from `unit_price`.
- `POST api/checkout/log.php`: JSON `session_id`, `status` (failed/cancelled),
  `total_amount`, `total_items`. Failed/cancelled amounts are NOT counted as revenue.
- `POST api/checkout/process.php`: JSON `session_id` plus distinct `epcs`.
  Real payment is blocked until verified; demo returns a success with `demo_mode: true`.
- Dashboard counts only successful purchases toward revenue; failed excludes cancelled.
  An additional `cancelled_today` field is provided but ignored by old UI.

## Tests and unresolved integration

Review SQL in a staging database before merging. Test both new installs and the
one-time migration with existing rows, successful demo checkouts, repeated EPCs,
simultaneous competing checkouts, retry after timed-out session, and report counts.

No actual payment provider or live MySQL environment is configured in this review.
Nothing in this patch verifies a real QR payment.
