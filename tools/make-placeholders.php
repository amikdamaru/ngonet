<?php
/**
 * NGONET – placeholder SEMENTARA untuk 48 tile, hanya agar game bisa diuji sebelum
 * spritesheet asli diproses. Bentuk geometris bernomor (bukan emoji, bukan aset internet).
 * Akan ditimpa oleh tools/slice-spritesheet.php.
 *
 * Pemakaian: php tools/make-placeholders.php
 */
const SIZE = 160;
const SS = 3;
$font = 'C:/Windows/Fonts/arialbd.ttf';
$colors = ['#C8826B', '#C89F75', '#B9A35E', '#7FA37A', '#6E9AA6', '#7F86B8', '#A27FB5', '#B87F96'];
$dir = dirname(__DIR__) . '/public/assets/onet/tiles';
@mkdir($dir, 0777, true);

function col($im, string $hex, int $a = 0) {
    $h = ltrim($hex, '#');
    return imagecolorallocatealpha($im, hexdec(substr($h, 0, 2)), hexdec(substr($h, 2, 2)), hexdec(substr($h, 4, 2)), $a);
}
function poly(int $n, float $cx, float $cy, float $r, float $rot = -M_PI / 2, ?float $inner = null): array {
    $pts = [];
    $count = $inner ? $n * 2 : $n;
    for ($i = 0; $i < $count; $i++) {
        $rr = ($inner && $i % 2) ? $inner : $r;
        $a = $rot + $i * 2 * M_PI / $count;
        $pts[] = (int)round($cx + cos($a) * $rr);
        $pts[] = (int)round($cy + sin($a) * $rr);
    }
    return $pts;
}

for ($n = 1; $n <= 48; $n++) {
    $N = SIZE * SS;
    $im = imagecreatetruecolor($N, $N);
    imagealphablending($im, false); imagesavealpha($im, true);
    imagefilledrectangle($im, 0, 0, $N - 1, $N - 1, imagecolorallocatealpha($im, 0, 0, 0, 127));
    imagealphablending($im, true);
    $c = col($im, $colors[($n - 1) % 8]);
    $shape = intdiv($n - 1, 8);
    $cx = $N / 2; $cy = $N / 2; $r = $N * 0.40;
    switch ($shape) {
        case 0: imagefilledellipse($im, (int)$cx, (int)$cy, (int)(2 * $r), (int)(2 * $r), $c); break;
        case 1: imagefilledrectangle($im, (int)($cx - $r * .85), (int)($cy - $r * .85), (int)($cx + $r * .85), (int)($cy + $r * .85), $c); break;
        case 2: imagefilledpolygon($im, poly(3, $cx, $cy + $r * .15, $r * 1.05), $c); break;
        case 3: imagefilledpolygon($im, poly(4, $cx, $cy, $r), $c); break;
        case 4: imagefilledpolygon($im, poly(6, $cx, $cy, $r, 0), $c); break;
        case 5: imagefilledpolygon($im, poly(5, $cx, $cy + $r * .05, $r * 1.05, -M_PI / 2, $r * .5), $c); break;
    }
    $txt = (string)$n;
    $fs = $N * 0.20;
    $box = imagettfbbox($fs, 0, $font, $txt);
    $tw = $box[2] - $box[0]; $th = $box[1] - $box[7];
    imagettftext($im, $fs, 0, (int)($cx - $tw / 2), (int)($cy + $th / 2 + ($shape === 2 ? $N * .06 : 0)), col($im, '#FFFCF5'), $font, $txt);

    $out = imagecreatetruecolor(SIZE, SIZE);
    imagealphablending($out, false); imagesavealpha($out, true);
    imagefilledrectangle($out, 0, 0, SIZE - 1, SIZE - 1, imagecolorallocatealpha($out, 0, 0, 0, 127));
    imagecopyresampled($out, $im, 0, 0, 0, 0, SIZE, SIZE, $N, $N);
    imagepng($out, sprintf('%s/tile-%02d.png', $dir, $n), 9);
}
file_put_contents("$dir/PLACEHOLDER.txt", "Tile di folder ini adalah PLACEHOLDER sementara.\nJalankan: php tools/slice-spritesheet.php <spritesheet>\n");
echo "48 placeholder ditulis ke public/assets/onet/tiles/\n";
