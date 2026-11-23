<?php
/**
 * NGONET – generator ikon aplikasi PWA (PHP GD, digambar 4x lalu diperkecil agar halus).
 * Pemakaian: php tools/make-icons.php
 * Hasil: icons/icon-192.png, icon-512.png, icon-maskable-192.png, icon-maskable-512.png, apple-touch-icon.png
 */
const SS = 4; // supersampling

function hexc($im, string $hex, int $alpha = 0) {
    $hex = ltrim($hex, '#');
    return imagecolorallocatealpha($im, hexdec(substr($hex, 0, 2)), hexdec(substr($hex, 2, 2)), hexdec(substr($hex, 4, 2)), $alpha);
}

function roundedRect($im, float $x1, float $y1, float $x2, float $y2, float $r, $col): void {
    [$x1, $y1, $x2, $y2, $r] = array_map(fn($v) => (int)round($v), [$x1, $y1, $x2, $y2, $r]);
    imagefilledrectangle($im, $x1 + $r, $y1, $x2 - $r, $y2, $col);
    imagefilledrectangle($im, $x1, $y1 + $r, $x2, $y2 - $r, $col);
    foreach ([[$x1 + $r, $y1 + $r], [$x2 - $r, $y1 + $r], [$x1 + $r, $y2 - $r], [$x2 - $r, $y2 - $r]] as [$cx, $cy]) {
        imagefilledellipse($im, $cx, $cy, 2 * $r, 2 * $r, $col);
    }
}

/**
 * Gambar ikon pada kanvas berukuran $px (px akhir).
 * $maskable: latar penuh tanpa sudut transparan & konten diperkecil ke zona aman.
 * $rounded : latar berupa rounded-square (untuk ikon "any").
 */
function drawIcon(int $px, bool $maskable, bool $rounded): GdImage {
    $N = $px * SS;
    $im = imagecreatetruecolor($N, $N);
    imagealphablending($im, false);
    imagesavealpha($im, true);
    imagefilledrectangle($im, 0, 0, $N - 1, $N - 1, imagecolorallocatealpha($im, 0, 0, 0, 127));
    imagealphablending($im, true);

    $u = $N / 512; // satuan desain 512
    if ($rounded) roundedRect($im, 0, 0, $N - 1, $N - 1, 112 * $u, hexc($im, '#F5F0E6'));
    else imagefilledrectangle($im, 0, 0, $N - 1, $N - 1, hexc($im, '#F5F0E6'));

    // skala konten di sekitar pusat (maskable: zona aman lingkaran r=40%)
    $k = $maskable ? 0.74 : 1.0;
    $T = fn(float $v) => (256 + ($v - 256) * $k) * $u;

    $tiles = [[72, 212, 240, 380], [272, 212, 440, 380]];
    // garis penghubung: dari atas tile kiri, naik, ke kanan, turun ke tile kanan (2 belokan)
    $accent = hexc($im, '#C89F75');
    $th = (int)round(16 * $k * $u);
    imagesetthickness($im, $th);
    $pts = [[156, 212], [156, 128], [356, 128], [356, 212]];
    for ($i = 1; $i < count($pts); $i++) {
        imageline($im, (int)$T($pts[$i - 1][0]), (int)$T($pts[$i - 1][1]), (int)$T($pts[$i][0]), (int)$T($pts[$i][1]), $accent);
    }
    imagesetthickness($im, 1);
    foreach ($pts as $p) imagefilledellipse($im, (int)$T($p[0]), (int)$T($p[1]), $th, $th, $accent);

    foreach ($tiles as [$x1, $y1, $x2, $y2]) {
        // bayangan bawah + border + isi
        roundedRect($im, $T($x1), $T($y1 + 10), $T($x2), $T($y2 + 10), 30 * $k * $u, hexc($im, '#E5DCCB'));
        roundedRect($im, $T($x1), $T($y1), $T($x2), $T($y2), 30 * $k * $u, hexc($im, '#DCCFB8'));
        roundedRect($im, $T($x1 + 6), $T($y1 + 6), $T($x2 - 6), $T($y2 - 6), 25 * $k * $u, hexc($im, '#FFFCF5'));
        // rumah mungil
        $cx = ($x1 + $x2) / 2; $cy = ($y1 + $y2) / 2 + 6;
        imagefilledpolygon($im, [
            (int)$T($cx - 56), (int)$T($cy - 4),
            (int)$T($cx), (int)$T($cy - 56),
            (int)$T($cx + 56), (int)$T($cy - 4),
        ], $accent);
        roundedRect($im, $T($cx - 38), $T($cy - 10), $T($cx + 38), $T($cy + 48), 8 * $k * $u, hexc($im, '#665644'));
        roundedRect($im, $T($cx - 12), $T($cy + 14), $T($cx + 12), $T($cy + 48), 5 * $k * $u, hexc($im, '#FFFCF5'));
    }

    $out = imagecreatetruecolor($px, $px);
    imagealphablending($out, false);
    imagesavealpha($out, true);
    imagefilledrectangle($out, 0, 0, $px - 1, $px - 1, imagecolorallocatealpha($out, 0, 0, 0, 127));
    imagecopyresampled($out, $im, 0, 0, 0, 0, $px, $px, $N, $N);
    imagedestroy($im);
    return $out;
}

$dir = dirname(__DIR__) . '/icons';
@mkdir($dir, 0777, true);
$jobs = [
    ['icon-192.png', 192, false, true],
    ['icon-512.png', 512, false, true],
    ['icon-maskable-192.png', 192, true, false],
    ['icon-maskable-512.png', 512, true, false],
    ['apple-touch-icon.png', 180, false, false],
];
foreach ($jobs as [$name, $px, $mask, $round]) {
    $im = drawIcon($px, $mask, $round);
    imagepng($im, "$dir/$name", 9);
    imagedestroy($im);
    echo "  icons/$name ({$px}x{$px})\n";
}
