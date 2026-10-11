-- Run ONCE on an existing QuickMart database that already uses the latest checkout schema.
-- Fresh installs: use database/schema.sql instead; do not run this migration.
-- These are FAKE wallets for a local school checkout demonstration only.
USE rfid_checkout_main;

CREATE TABLE IF NOT EXISTS DEMO_WALLETS (
    wallet_id VARCHAR(30) NOT NULL,
    holder VARCHAR(100) NOT NULL,
    balance DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    status TINYINT(1) NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (wallet_id)
) ENGINE=InnoDB;

-- Existing wallets are not reset to their initial balance on repeat imports.
INSERT IGNORE INTO DEMO_WALLETS (wallet_id, holder, balance, status) VALUES
('QM-WALLET-1001', 'QuickMart Demo Wallet - Enough Balance', 100000.00, 1),
('QM-WALLET-1002', 'QuickMart Demo Wallet - Insufficient Balance', 0.00, 1);
