<?php
// Endpoint kecil HANYA untuk test otomatis lokal: menyimpan hasil test ke tests/out/report[-name].json.
// Tidak dipakai oleh aplikasi/gameplay.
header('Access-Control-Allow-Origin: *');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); exit; }
$name = preg_replace('/[^a-z0-9-]/', '', strtolower($_GET['name'] ?? ''));
@mkdir(__DIR__ . '/out', 0777, true);
file_put_contents(__DIR__ . '/out/report' . ($name ? "-$name" : '') . '.json', file_get_contents('php://input'));
echo 'ok';
