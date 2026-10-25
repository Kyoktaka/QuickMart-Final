<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config/bootstrap.php';
require_once __DIR__ . '/../../config/database.php';

require_manager();
session_write_close(); // read-only: free the session lock

try {
    // Successful payments contribute to revenue; unsuccessful attempts do not.
    $summaryStmt = $conn->query("
        SELECT
            COALESCE(SUM(CASE WHEN status = 'SUCCESSFUL'
                              AND DATE(purchase_date) = CURRENT_DATE()
                              THEN total_amount ELSE 0 END), 0) AS sales_today,
            COALESCE(SUM(CASE WHEN status = 'SUCCESSFUL'
                              AND DATE(purchase_date) = CURRENT_DATE()
                              THEN 1 ELSE 0 END), 0) AS successful_today,
            COALESCE(SUM(CASE WHEN status = 'UNSUCCESSFUL'
                              AND (attempt_status = 'failed' OR attempt_status IS NULL)
                              AND DATE(purchase_date) = CURRENT_DATE()
                              THEN 1 ELSE 0 END), 0) AS failed_today,
            COALESCE(SUM(CASE WHEN status = 'UNSUCCESSFUL'
                              AND attempt_status = 'cancelled'
                              AND DATE(purchase_date) = CURRENT_DATE()
                              THEN 1 ELSE 0 END), 0) AS cancelled_today
        FROM PURCHASEtbl
    ");
    $summary = $summaryStmt->fetch() ?: [];

    // Inactive products are excluded even if one of their tags remains AVAILABLE.
    $inventoryStmt = $conn->query("
        SELECT COUNT(*) AS inventory_available
        FROM RFID_tags AS r
        INNER JOIN PRODUCTtbl AS p ON p.product_id = r.product_id
        WHERE r.status = 'AVAILABLE' AND p.status = 1
    ");
    $inventory = $inventoryStmt->fetch() ?: [];

    // Seven calendar dates, from six days ago through today.
    $today = new DateTimeImmutable('today');
    $dailyLabels = [];
    $dailyData = [];
    $dailyStmt = $conn->prepare("
        SELECT COALESCE(SUM(total_amount), 0) AS total_sales
        FROM PURCHASEtbl
        WHERE status = 'SUCCESSFUL'
          AND purchase_date >= :from_date
          AND purchase_date < :to_date
    ");
    for ($i = 6; $i >= 0; $i--) {
        $day = $today->modify("-$i days");
        $dailyStmt->execute([
            'from_date' => $day->format('Y-m-d 00:00:00'),
            'to_date' => $day->modify('+1 day')->format('Y-m-d 00:00:00'),
        ]);
        $row = $dailyStmt->fetch() ?: [];
        $dailyLabels[] = $day->format('D');
        $dailyData[] = (float) ($row['total_sales'] ?? 0);
    }

    // Four rolling seven-day periods (W1 oldest, W4 most recent).
    $weeklyLabels = ['W1', 'W2', 'W3', 'W4'];
    $weeklyData = [];
    $weeklyStmt = $conn->prepare("
        SELECT COALESCE(SUM(total_amount), 0) AS total_sales
        FROM PURCHASEtbl
        WHERE status = 'SUCCESSFUL'
          AND purchase_date >= :from_date
          AND purchase_date < :to_date
    ");
    for ($week = 3; $week >= 0; $week--) {
        $start = $today->modify('-' . ($week * 7 + 6) . ' days');
        $end = $today->modify('-' . ($week * 7) . ' days')->modify('+1 day');
        $weeklyStmt->execute([
            'from_date' => $start->format('Y-m-d 00:00:00'),
            'to_date' => $end->format('Y-m-d 00:00:00'),
        ]);
        $row = $weeklyStmt->fetch() ?: [];
        $weeklyData[] = (float) ($row['total_sales'] ?? 0);
    }

    json_response([
        'success' => true,
        'summary' => [
            'sales_today' => (float) ($summary['sales_today'] ?? 0),
            'inventory_available' => (int) ($inventory['inventory_available'] ?? 0),
            'successful_today' => (int) ($summary['successful_today'] ?? 0),
            'failed_today' => (int) ($summary['failed_today'] ?? 0),
            'cancelled_today' => (int) ($summary['cancelled_today'] ?? 0),
        ],
        'daily' => ['labels' => $dailyLabels, 'data' => $dailyData],
        'weekly' => ['labels' => $weeklyLabels, 'data' => $weeklyData],
    ]);
} catch (Throwable $e) {
    error_log('QuickMart dashboard error: ' . get_class($e));
    json_response(['success' => false, 'message' => 'Failed to load dashboard metrics.'], 500);
}
