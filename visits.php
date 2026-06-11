<?php
header('Content-Type: application/json');
header('Cache-Control: no-cache, no-store, must-revalidate');

$file = 'JSONs/lifetime_visits.txt';
$default_visits = 0;

$fp = fopen($file, 'c+');
$visits = $default_visits;

if ($fp) {
    if (flock($fp, LOCK_EX)) {
        $size = filesize($file);
        if ($size > 0) {
            $content = fread($fp, $size);
            $visits = intval($content);
        }
        
        $visits++;
        
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, strval($visits));
        fflush($fp);
        flock($fp, LOCK_UN);
    }
    fclose($fp);
}

echo json_encode(['visits' => $visits]);
?>
