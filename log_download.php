<?php
header('Content-Type: application/json');
header('Cache-Control: no-cache, no-store, must-revalidate');

$data = json_decode(file_get_contents('php://input'), true);
$type = isset($data['type']) ? $data['type'] : 'unknown';
$format = isset($data['format']) ? $data['format'] : 'unknown';

$file = 'JSONs/download_logs.txt';
$timestamp = date('Y-m-d H:i:s');
$ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';

$log_entry = "[$timestamp] IP: $ip - Type: $type - Format: $format\n";

file_put_contents($file, $log_entry, FILE_APPEND | LOCK_EX);

echo json_encode(['status' => 'success']);
?>
