-- Fresh installations only. CREATE DATABASE intentionally fails if it already exists.
-- Existing installations: use tools/database-upgrade.php after stopping application access.
CREATE DATABASE rfid_checkout_main
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE rfid_checkout_main;


CREATE TABLE PRODUCTtbl (
    product_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    product_name VARCHAR(150) NOT NULL,
    description TEXT NULL,
    unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    category VARCHAR(100) NOT NULL DEFAULT 'General',
    status TINYINT(1) NOT NULL DEFAULT 1,

    PRIMARY KEY (product_id),
    INDEX idx_product_name (product_name),
    INDEX idx_product_category (category),
    INDEX idx_product_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO PRODUCTtbl (product_name, description, unit_price, category) VALUES
('Alcohol Dispenser', 'Compact and Refillable (20g)', 30.00, 'Home Essentials'),
('Focus Refillable Fillers', 'Lighweight Pulp Paper (55gsm)', 25.00, 'Home Essentials'),
('Rice Scooper', 'Recyclable Plastic Material (18g)', 32.00, 'Home Essentials'),
('Lasap Iodized Salt', 'Premium Quality (100g)', 16.00, 'Food & Snacks'),
('Sleek Stockings', 'Soft and Breathable (1 pair)', 60.00, 'Clothing'),
('Colgate Toothbrush', 'Recyclable Plastic Material', 20.00, 'Home Essentials'),
('Dumpling Squishy', 'Fun and Relaxing (160g)', 67.00, 'Toys'),
('Lablast Detergent Bar', 'Floral Scent (130g)', 12.00, 'Home Essentials'),
('Pocky Snack Box', 'Chocolate Flavor (40g)', 35.00, 'Food & Snacks'),
('Urban Tee Shirt', 'Breathable Blue (F-Medium)', 100.00, 'Clothing');


CREATE TABLE RFID_tags (
    tag_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    epc VARCHAR(100) NOT NULL,
    product_id INT UNSIGNED NOT NULL,
    status ENUM('AVAILABLE','PURCHASED','UNREGISTERED')
        NOT NULL DEFAULT 'AVAILABLE',
    registered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    purchased_at TIMESTAMP NULL DEFAULT NULL,

    PRIMARY KEY (tag_id),
    UNIQUE KEY uq_rfid_epc (epc),
    INDEX idx_rfid_product (product_id),
    INDEX idx_rfid_status (status),
    INDEX idx_rfid_product_status (product_id, status),

    CONSTRAINT fk_rfid_product
        FOREIGN KEY (product_id)
        REFERENCES PRODUCTtbl(product_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE ADMINtbl (
    admin_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    admin_name VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    status TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (admin_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE PASSWORD_RESET_tokens (
    reset_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    admin_id INT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (reset_id),
    UNIQUE KEY uq_password_reset_token (token_hash),
    INDEX idx_password_reset_admin (admin_id),
    INDEX idx_password_reset_expiry (expires_at),

    CONSTRAINT fk_password_reset_manager
        FOREIGN KEY (admin_id)
        REFERENCES ADMINtbl(admin_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE PURCHASEtbl (
    purchase_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    admin_id INT UNSIGNED NOT NULL,
    session_id VARCHAR(50) NOT NULL,
    attempt_status ENUM('failed','cancelled') NULL DEFAULT NULL,
    attempted_items INT UNSIGNED NOT NULL DEFAULT 0,
    status ENUM('SUCCESSFUL','UNSUCCESSFUL')
        NOT NULL DEFAULT 'SUCCESSFUL',
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    purchase_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (purchase_id),
    UNIQUE KEY uq_purchase_session (session_id),
    INDEX idx_purchase_date_status (purchase_date, status),
    INDEX idx_purchase_admin (admin_id),

    CONSTRAINT fk_purchase_admin
        FOREIGN KEY (admin_id)
        REFERENCES ADMINtbl(admin_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE PURCHASE_items (
    purchase_item_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    purchase_id INT UNSIGNED NOT NULL,
    product_id INT UNSIGNED NOT NULL,
    tag_id INT UNSIGNED NULL,
    unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    subtotal DECIMAL(10,2) NOT NULL DEFAULT 0.00,

    PRIMARY KEY (purchase_item_id),
    INDEX idx_purchase_items_purchase (purchase_id),
    INDEX idx_purchase_items_product (product_id),

    CONSTRAINT fk_purchase_item_purchase
        FOREIGN KEY (purchase_id)
        REFERENCES PURCHASEtbl(purchase_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_purchase_item_product
        FOREIGN KEY (product_id)
        REFERENCES PRODUCTtbl(product_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_purchase_item_tag
        FOREIGN KEY (tag_id)
        REFERENCES RFID_tags(tag_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- PHP/MySQL owns recoverable carts, confirmation, deadlines and payment attempts.
CREATE TABLE CHECKOUT_sessions (
    session_id VARCHAR(50) NOT NULL,
    admin_id INT UNSIGNED NOT NULL,
    owner_hash CHAR(64) NOT NULL,
    status ENUM('CART','REVIEWED','PAYMENT','SUCCESSFUL','VOIDED') NOT NULL DEFAULT 'CART',
    epcs_json LONGTEXT NOT NULL,
    cart_json LONGTEXT NOT NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 1,
    total_items INT UNSIGNED NOT NULL DEFAULT 0,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    deadline_at DATETIME NULL DEFAULT NULL,
    reason VARCHAR(255) NULL DEFAULT NULL,
    purchase_id INT UNSIGNED NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (session_id),
    INDEX idx_checkout_owner_status (admin_id, owner_hash, status),
    CONSTRAINT fk_checkout_admin FOREIGN KEY (admin_id)
        REFERENCES ADMINtbl(admin_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_checkout_purchase FOREIGN KEY (purchase_id)
        REFERENCES PURCHASEtbl(purchase_id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE CHECKOUT_attempts (
    session_id VARCHAR(50) NOT NULL,
    attempt_id VARCHAR(64) NOT NULL,
    outcome VARCHAR(40) NOT NULL,
    response_json LONGTEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (session_id, attempt_id),
    CONSTRAINT fk_checkout_attempt_session FOREIGN KEY (session_id)
        REFERENCES CHECKOUT_sessions(session_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
