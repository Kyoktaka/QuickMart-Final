-- Run ONCE against an existing QuickMart database, after taking a backup.
-- Fresh installations should use the updated database/schema.sql instead.
-- The session_id column already has a UNIQUE constraint, retained by MODIFY.
USE rfid_checkout_main;

ALTER TABLE PURCHASEtbl
    MODIFY COLUMN session_id VARCHAR(50) NOT NULL,
    ADD COLUMN attempt_status ENUM('failed', 'cancelled') NULL DEFAULT NULL AFTER status,
    ADD COLUMN attempted_items INT UNSIGNED NOT NULL DEFAULT 0 AFTER attempt_status;

-- Historical UNSUCCESSFUL records have an unknown reason (NULL).
-- They are displayed as 'failed' by default; do not mislabel them as cancelled.
