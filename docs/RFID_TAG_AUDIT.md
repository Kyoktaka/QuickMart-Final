# QuickMart RFID registration troubleshooting

## What caused cross-product tags?
The old USB keyboard scanner emitted an entire `rfid:epcs` tray snapshot whenever
a newly seen EPC arrived. Restock bulk-submitted all EPCs in that snapshot for the
currently selected product, potentially registering multiple distinct tags to
Argentina Giniling. The DB does not silently reassign existing EPCs: it returns
`already_registered_other_product_epcs`.

The patched Restock modal has an explicit **Start Scan** button, captures exactly
one newly detected tag, then disables the reader until the next explicit scan.
Always keep other RFID tags away from the reader while registering.

## Audit existing data in phpMyAdmin

The code fix does **NOT** repair already-wrong RFID_tags rows. Review actual EPCs:

```sql
SELECT r.epc, r.product_id, p.product_name, r.status, r.registered_at
FROM RFID_tags AS r
JOIN PRODUCTtbl AS p ON p.product_id = r.product_id
ORDER BY r.registered_at DESC, r.tag_id DESC;
```

Label each physical tag's exact EPC and verify which product it belongs to.
After a database backup, correct ONLY positively identified `AVAILABLE`
misassignments, one record at a time (replace all example values):

```sql
UPDATE RFID_tags
SET product_id = 123
WHERE epc = 'ENTER_EXACT_EPC_HERE'
  AND product_id = 456
  AND status = 'AVAILABLE';
```

123 = intended product_id, 456 = currently wrong product_id.
Check that exactly one row changed, and re-run the SELECT. Never update all
Argentina rows blindly; never move PURCHASED tags without reviewing purchases.
Do not re-import the database just to hide incorrect assignments.

## Reader presence and platform size

The hardware is a USB HID keyboard-emulation UHF EPC Gen2 desktop reader.
HID keyboard events announce **reads**, not a guaranteed physical-presence
state. Software cannot guarantee a strict 14 × 16 inch platform footprint
or 12–13 inch detection height. Antenna orientation, transmit power, nearby
metal, shielding and tag placement all influence the RF field.

The presence estimator now follows each EPC's **last repeated read**, not a
12-second holding window. A first read is held for up to 1.5 seconds, and
confirmed repeating EPCs use a short adaptive timeout of about 1–2.5 seconds
(three times the observed per-tag read interval, bounded). If continuous
USB HID output arrives for a tag, it stays on screen for as long as repeat
reads continue. When reads stop after physical removal, the display removes
that EPC after a short tolerance. Actual response time depends on scan cadence.

**Do not assume continuous radio polling means the USB keyboard interface
emits every repeated EPC.** Some readers report each distinct EPC only once.
If the reader emits a tag only once and never repeats it, USB HID keystrokes
cannot prove whether it remains physically inside the read zone. Check
`RFIDScanner.getDiagnostics()`: a tag's `reads` must increase while it
remains on the tray. In such a mode, a vendor continuous-output setting or
reader SDK / status stream is needed for genuine presence/removal monitoring.

To verify true present/removed behavior:
1. Set reader to continuous inventory / repeat output mode using its actual
   vendor configuration tool, if supported.
2. Test one tag at a time at the center and four corners of the real platform,
   then lift it through the intended 12–13 inch height.
3. Inspect `RFIDScanner.getDiagnostics()` in the browser console to see
   repeated read counts and estimated read intervals.
4. Adjust RF power or antenna placement in the hardware configuration to
   approximate the target detection zone; do not rely on CSS or JavaScript
   pixels to control the antenna field.
5. Remove a tag and observe the grace interval before the item disappears.
   Ensure other EPCs remain in the kiosk cart during the experiment.
