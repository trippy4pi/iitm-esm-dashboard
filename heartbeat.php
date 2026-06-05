<?php
header('Content-Type: application/json');
header('Cache-Control: no-cache, no-store, must-revalidate');

$file = 'JSONs/active_sessions.json';
$session_id = isset($_GET['sessionId']) ? preg_replace('/[^a-zA-Z0-9]/', '', $_GET['sessionId']) : '';

$active_count = 0;
$now = time();

if (!empty($session_id)) {
    $fp = fopen($file, 'c+');
    if ($fp) {
        if (flock($fp, LOCK_EX)) {
            $size = filesize($file);
            $sessions = [];
            if ($size > 0) {
                $content = fread($fp, $size);
                $sessions = json_decode($content, true);
                if (!is_array($sessions)) {
                    $sessions = [];
                }
            }
            
            // Update session timestamp
            $sessions[$session_id] = $now;
            
            // Sweep sessions older than 40 seconds
            $cutoff = $now - 40;
            foreach ($sessions as $id => $time) {
                if ($time < $cutoff) {
                    unset($sessions[$id]);
                }
            }
            
            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, json_encode($sessions));
            fflush($fp);
            flock($fp, LOCK_UN);
            
            $active_count = count($sessions);
        } else {
            $active_count = 1;
        }
        fclose($fp);
    }
} else {
    // Read count without updating if no sessionId is provided
    if (file_exists($file)) {
        $content = file_get_contents($file);
        $sessions = json_decode($content, true);
        if (is_array($sessions)) {
            $cutoff = $now - 40;
            foreach ($sessions as $id => $time) {
                if ($time >= $cutoff) {
                    $active_count++;
                }
            }
        }
    }
}

if ($active_count < 1) {
    $active_count = 1;
}

echo json_encode(['activeViewers' => $active_count]);
?>
