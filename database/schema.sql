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
);

INSERT INTO PRODUCTtbl (product_name, description, unit_price, category) VALUES
('Zonrox Color Safe Bleach', 'Blossom Fresh Scent (225 ml)', 30.00, 'Home Essentials'),
('Nissin Cup Noodles', 'Seafood Flavor (40g)', 25.00, 'Food & Snacks'),
('Rice Scooper', 'Recyclable Plastic Material (18g)', 32.00, 'Home Essentials'),
('Oishi Potato Fries', 'Plain Flavor (50g)', 16.00, 'Food & Snacks'),
('Sleek Stockings', 'Soft and Breathable (1 pair)', 60.00, 'Clothing'),
('Colgate Toothbrush', 'Recyclable Plastic Material', 20.00, 'Home Essentials'),
('Dumpling Squishy', 'Fun and Relaxing (160g)', 67.00, 'Toys'),
('Lablast Detergent Bar', 'Floral Scent (130g)', 12.00, 'Home Essentials'),
('Pocky Snack Box', 'Chocolate Flavor (40g)', 35.00, 'Food & Snacks'),
('Argentina Giniling', 'Ground Pork Mix (250g)', 69.00, 'Food & Snacks');


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
);


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
);


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
);


CREATE TABLE PURCHASEtbl (
    purchase_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    admin_id INT UNSIGNED NOT NULL,
    session_id VARCHAR(50) NOT NULL UNIQUE,
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
);


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
);
