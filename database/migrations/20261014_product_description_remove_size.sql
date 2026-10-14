-- QuickMart Product Description Consolidation (run ONCE on an existing database).
-- BACK UP rfid_checkout_main before running. Fresh installs use database/schema.sql.
-- Keep every product ID, tag mapping, manager, receipt and purchase intact.
USE rfid_checkout_main;

-- For other/custom products, preserve the old size field in the description.
-- Avoid adding it when that exact measurement is already present (ignoring spaces).
UPDATE PRODUCTtbl
SET description = CONCAT(
    TRIM(COALESCE(description, '')),
    CASE WHEN TRIM(COALESCE(description,'')) = '' THEN '' ELSE ' ' END,
    '(', TRIM(size), ')'
)
WHERE product_name NOT IN ('Zonrox Color Safe Bleach', 'Nissin Cup Noodles', 'Rice Scooper', 'Oishi Potato Fries', 'Sleek Stockings', 'Colgate Toothbrush', 'Dumpling Squishy', 'Lablast Detergent Bar', 'Pocky Snack Box', 'Argentina Giniling')
  AND size IS NOT NULL AND TRIM(size) <> ''
  AND REPLACE(LOWER(COALESCE(description, '')), ' ', '')
      NOT LIKE CONCAT('%', REPLACE(LOWER(TRIM(size)), ' ', ''), '%');

-- Apply the finalized content approved by the database team.
UPDATE PRODUCTtbl
SET description = CASE product_name
    WHEN 'Zonrox Color Safe Bleach' THEN 'Blossom Fresh Scent (225 ml)'
    WHEN 'Nissin Cup Noodles' THEN 'Seafood Flavor (40g)'
    WHEN 'Rice Scooper' THEN 'Recyclable Plastic Material (18g)'
    WHEN 'Oishi Potato Fries' THEN 'Plain Flavor (50g)'
    WHEN 'Sleek Stockings' THEN 'Soft and Breathable (1 pair)'
    WHEN 'Colgate Toothbrush' THEN 'Recyclable Plastic Material'
    WHEN 'Dumpling Squishy' THEN 'Fun and Relaxing (160g)'
    WHEN 'Lablast Detergent Bar' THEN 'Floral Scent (130g)'
    WHEN 'Pocky Snack Box' THEN 'Chocolate Flavor (40g)'
    WHEN 'Argentina Giniling' THEN 'Ground Pork Mix (250g)'
    ELSE description
END
WHERE product_name IN ('Zonrox Color Safe Bleach', 'Nissin Cup Noodles', 'Rice Scooper', 'Oishi Potato Fries', 'Sleek Stockings', 'Colgate Toothbrush', 'Dumpling Squishy', 'Lablast Detergent Bar', 'Pocky Snack Box', 'Argentina Giniling');

-- This is a one-time irreversible column removal: inspect your data/backup first.
ALTER TABLE PRODUCTtbl DROP COLUMN size;
