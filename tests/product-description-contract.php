<?php
declare(strict_types=1);
// Static contract tests; run alongside the existing syntax & QR tests.
$root = dirname(__DIR__);
$schema = file_get_contents($root . '/database/schema.sql');
$create = file_get_contents($root . '/api/products/create.php');
$update = file_get_contents($root . '/api/products/update.php');
$list = file_get_contents($root . '/api/products/list.php');
$detect = file_get_contents($root . '/api/rfid/detect.php');
$adapter = file_get_contents($root . '/js/backend.js');
if (strpos($schema, 'description TEXT NULL') === false
    || strpos($schema, 'size VARCHAR') !== false
    || strpos($schema, 'INSERT INTO PRODUCTtbl (product_name, description, unit_price, category)') === false) {
    fwrite(STDERR, "Schema does not follow description-only product contract.\n");
    exit(1);
}
foreach (['Zonrox Color Safe Bleach' => 'Blossom Fresh Scent (225 ml)',
          'Dumpling Squishy' => 'Fun and Relaxing (160g)',
          'Argentina Giniling' => 'Ground Pork Mix (250g)'] as $name => $description) {
    if (!str_contains($schema, "'$name', '$description'")) {
        fwrite(STDERR, "Default description missing for $name.\n");
        exit(1);
    }
}
foreach (['create.php' => $create, 'update.php' => $update, 'list.php' => $list,
          'rfid detect.php' => $detect, 'JS backend adapter' => $adapter] as $path => $body) {
    if (preg_match('/\\b(?:p\\.size|\\$size|size\\s*=|size\\s*:|:size|\\[.size.\\])\\b/i', $body)) {
        fwrite(STDERR, "Legacy size handling remains in $path.\n");
        exit(1);
    }
}
if (!str_contains($create, "description") || !str_contains($update, "description")
    || !str_contains($list, "p.description")) {
    fwrite(STDERR, "Description CRUD integration is incomplete.\n");
    exit(1);
}
echo "Product description/schema contract checks passed.\n";
