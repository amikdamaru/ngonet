<?php
/**
 * NGONET – pemotong spritesheet 8 kolom x 6 baris menjadi 48 PNG.
 *
 * Pemakaian:
 *   php tools/slice-spritesheet.php <spritesheet.(png|jpg|webp)> [--size=128] [--keep-card] [--tol=48]
 *
 * Langkah:
 *  1. Baca ukuran gambar dan tentukan latar dari tepi gambar (transparan atau warna solid).
 *  2. Buat profil konten per kolom & baris piksel, lalu segmentasikan menjadi rentang
 *     "kartu" yang dipisahkan lajur kosong (gutter). Jumlah rentang WAJIB tepat 8 kolom
 *     dan 6 baris; jika tidak, proses dihentikan (tidak ada tebakan ukuran crop).
 *  3. Untuk setiap kartu: tentukan warna isi kartu dari cincin di sisi dalam kartu, cari
 *     kotak ilustrasi (piksel yang berbeda dari isi kartu), lalu crop persegi dengan margin
 *     yang tidak pernah melewati batas kartu (tidak tercampur gambar tetangga).
 *  4. Latar kartu yang terhubung ke tepi crop dijadikan transparan (kecuali --keep-card),
 *     sehingga ilustrasi menyatu dengan desain tile NGONET.
 *  5. Tulis public/assets/onet/tiles/tile-01.png … tile-48.png dan tools/out/preview.png.
 */

ini_set('memory_limit', '1536M');
const COLS = 8;
const ROWS = 6;

$src = null; $size = 128; $keepCard = false; $tol = 48;
foreach (array_slice($argv, 1) as $a) {
    if (str_starts_with($a, '--size=')) $size = max(64, (int)substr($a, 7));
    elseif ($a === '--keep-card') $keepCard = true;
    elseif (str_starts_with($a, '--tol=')) $tol = max(5, (int)substr($a, 6));
    else $src = $a;
}
if (!$src || !is_file($src)) {
    fwrite(STDERR, "Spritesheet tidak ditemukan. Pemakaian: php tools/slice-spritesheet.php <file> [--size=128] [--keep-card]\n");
    exit(1);
}

$root = dirname(__DIR__);
$outDir = $root . '/public/assets/onet/tiles';
$previewDir = __DIR__ . '/out';
@mkdir($outDir, 0777, true);
@mkdir($previewDir, 0777, true);

$img = @imagecreatefromstring(file_get_contents($src));
if (!$img) { fwrite(STDERR, "Format gambar tidak didukung oleh GD.\n"); exit(1); }
if (!imageistruecolor($img)) imagepalettetotruecolor($img);
$W = imagesx($img); $H = imagesy($img);
echo "Ukuran spritesheet: {$W} x {$H} px\n";

/** [r, g, b, opacity 0..127 (127 = opak)] */
function px($img, int $x, int $y): array {
    $c = imagecolorat($img, $x, $y);
    return [($c >> 16) & 255, ($c >> 8) & 255, $c & 255, 127 - (($c >> 24) & 127)];
}
function cdist(array $p, array $q): int { return abs($p[0] - $q[0]) + abs($p[1] - $q[1]) + abs($p[2] - $q[2]); }
function median(array $samples): array {
    $out = [];
    for ($i = 0; $i < 4; $i++) { $v = array_column($samples, $i); sort($v); $out[] = $v[intdiv(count($v), 2)]; }
    return $out;
}

// ---------- 1. latar ----------
$samples = [];
for ($x = 0; $x < $W; $x += 2) { $samples[] = px($img, $x, 0); $samples[] = px($img, $x, $H - 1); }
for ($y = 0; $y < $H; $y += 2) { $samples[] = px($img, 0, $y); $samples[] = px($img, $W - 1, $y); }
$bg = median($samples);
$bgTransparent = $bg[3] < 20;
echo $bgTransparent ? "Latar antar-kartu: transparan (alpha)\n" : sprintf("Latar antar-kartu: rgb(%d,%d,%d)\n", $bg[0], $bg[1], $bg[2]);
$isCard = $bgTransparent
    ? fn(array $p) => $p[3] >= 64
    : fn(array $p) => $p[3] >= 64 && cdist($p, $bg) > $GLOBALS['tol'];

// ---------- 2. profil & segmentasi ----------
$colProfile = array_fill(0, $W, 0);
$rowProfile = array_fill(0, $H, 0);
for ($y = 0; $y < $H; $y++) {
    for ($x = 0; $x < $W; $x++) {
        if ($isCard(px($img, $x, $y))) { $colProfile[$x]++; $rowProfile[$y]++; }
    }
}

/** Rentang berurutan di mana profil > ambang. Rentang sempit (noise) diabaikan. */
function segments(array $profile, int $span, int $expected): array {
    $thr = max(2, (int)round($span * 0.03));
    $runs = [];
    $n = count($profile);
    for ($i = 0; $i < $n; $i++) {
        if ($profile[$i] <= $thr) continue;
        $s = $i;
        while ($i + 1 < $n && $profile[$i + 1] > $thr) $i++;
        $runs[] = [$s, $i];
    }
    $avg = $n / $expected;
    return array_values(array_filter($runs, fn($r) => ($r[1] - $r[0] + 1) >= $avg * 0.35));
}
$xsegs = segments($colProfile, $H, COLS);
$ysegs = segments($rowProfile, $W, ROWS);
echo "Kolom kartu terdeteksi: " . count($xsegs) . " → " . implode(' ', array_map(fn($r) => "{$r[0]}-{$r[1]}", $xsegs)) . "\n";
echo "Baris kartu terdeteksi: " . count($ysegs) . " → " . implode(' ', array_map(fn($r) => "{$r[0]}-{$r[1]}", $ysegs)) . "\n";
if (count($xsegs) !== COLS || count($ysegs) !== ROWS) {
    fwrite(STDERR, "\nGrid tidak dapat dipastikan (harus tepat " . COLS . " kolom x " . ROWS . " baris kartu terpisah).\n"
        . "Proses dihentikan agar tidak ada aset yang terpotong atau tercampur. Periksa spritesheet.\n");
    exit(2);
}

// ---------- 3-5. proses setiap kartu ----------
$preview = imagecreatetruecolor(COLS * ($size + 8) + 8, ROWS * ($size + 8) + 8);
imagefill($preview, 0, 0, imagecolorallocate($preview, 0xFF, 0xFC, 0xF5));
$n = 0;
$warnings = [];
for ($r = 0; $r < ROWS; $r++) {
    for ($c = 0; $c < COLS; $c++) {
        $n++;
        [$cx0, $cx1] = $xsegs[$c];
        [$cy0, $cy1] = $ysegs[$r];
        // sisi dalam kartu: lewati border & sudut rounded kartu
        $inset = (int)round(min($cx1 - $cx0, $cy1 - $cy0) * 0.055);
        $x0 = $cx0 + $inset; $x1 = $cx1 - $inset;
        $y0 = $cy0 + $inset; $y1 = $cy1 - $inset;

        // warna isi kartu: median cincin di sisi dalam
        $ring = [];
        for ($x = $x0; $x <= $x1; $x += 2) { $ring[] = px($img, $x, $y0); $ring[] = px($img, $x, $y1); }
        for ($y = $y0; $y <= $y1; $y += 2) { $ring[] = px($img, $x0, $y); $ring[] = px($img, $x1, $y); }
        $card = median($ring);

        // Zona sudut rounded kartu: piksel di luar lingkaran sudut adalah sisa border kartu, bukan ilustrasi.
        $cr = (int)round(min($cx1 - $cx0, $cy1 - $cy0) * 0.17);
        $inCorner = function (int $x, int $y) use ($cx0, $cx1, $cy0, $cy1, $cr): bool {
            $ccx = $x < $cx0 + $cr ? $cx0 + $cr : ($x > $cx1 - $cr ? $cx1 - $cr : null);
            $ccy = $y < $cy0 + $cr ? $cy0 + $cr : ($y > $cy1 - $cr ? $cy1 - $cr : null);
            if ($ccx === null || $ccy === null) return false;
            return hypot($x - $ccx, $y - $ccy) > $cr * 0.62;
        };

        // kotak ilustrasi
        $minX = PHP_INT_MAX; $minY = PHP_INT_MAX; $maxX = -1; $maxY = -1;
        for ($y = $y0; $y <= $y1; $y++) {
            for ($x = $x0; $x <= $x1; $x++) {
                if ($inCorner($x, $y)) continue;
                $p = px($img, $x, $y);
                if ($p[3] >= 64 && cdist($p, $card) > $tol) {
                    if ($x < $minX) $minX = $x; if ($x > $maxX) $maxX = $x;
                    if ($y < $minY) $minY = $y; if ($y > $maxY) $maxY = $y;
                }
            }
        }
        if ($maxX < 0) { fwrite(STDERR, "Kartu #$n kosong.\n"); exit(3); }
        if ($minX <= $x0 || $maxX >= $x1 || $minY <= $y0 || $maxY >= $y1) {
            $warnings[] = sprintf('tile-%02d: ilustrasi menyentuh tepi dalam kartu', $n);
        }
        $bw = $maxX - $minX + 1; $bh = $maxY - $minY + 1;
        $side = (int)ceil(max($bw, $bh) * 1.06);
        $mx = ($minX + $maxX) / 2; $my = ($minY + $maxY) / 2;
        $sx = (int)round($mx - $side / 2); $sy = (int)round($my - $side / 2);

        // kanvas persegi; hanya piksel di dalam kartu yang disalin
        $sq = imagecreatetruecolor($side, $side);
        imagealphablending($sq, false); imagesavealpha($sq, true);
        $fill = $keepCard ? imagecolorallocatealpha($sq, $card[0], $card[1], $card[2], 0) : imagecolorallocatealpha($sq, 0, 0, 0, 127);
        imagefilledrectangle($sq, 0, 0, $side - 1, $side - 1, $fill);
        $ax0 = max($sx, $x0); $ay0 = max($sy, $y0);
        $ax1 = min($sx + $side - 1, $x1); $ay1 = min($sy + $side - 1, $y1);
        imagecopy($sq, $img, $ax0 - $sx, $ay0 - $sy, $ax0, $ay0, $ax1 - $ax0 + 1, $ay1 - $ay0 + 1);
        for ($y = $ay0; $y <= $ay1; $y++) {
            for ($x = $ax0; $x <= $ax1; $x++) {
                if ($inCorner($x, $y)) imagesetpixel($sq, $x - $sx, $y - $sy, $fill);
            }
        }
        if (!$keepCard) removeBackground($sq, $card, $tol);

        $out = imagecreatetruecolor($size, $size);
        imagealphablending($out, false); imagesavealpha($out, true);
        imagefilledrectangle($out, 0, 0, $size - 1, $size - 1, imagecolorallocatealpha($out, 0, 0, 0, 127));
        imagecopyresampled($out, $sq, 0, 0, 0, 0, $size, $size, $side, $side);
        $file = sprintf('%s/tile-%02d.png', $outDir, $n);
        imagepng($out, $file, 9);

        imagealphablending($preview, true);
        imagecopy($preview, $out, 8 + $c * ($size + 8), 8 + $r * ($size + 8), 0, 0, $size, $size);
        printf("  tile-%02d.png  kartu x=%d..%d y=%d..%d  ilustrasi %dx%d  -> %.1f KB\n", $n, $cx0, $cx1, $cy0, $cy1, $bw, $bh, filesize($file) / 1024);
        imagedestroy($sq); imagedestroy($out);
    }
}
imagepng($preview, $previewDir . '/preview.png', 6);
@unlink($outDir . '/PLACEHOLDER.txt');
if ($warnings) echo "\nCatatan:\n - " . implode("\n - ", $warnings) . "\n";
echo "\nSelesai: 48 tile ditulis ke public/assets/onet/tiles/. Preview: tools/out/preview.png\n";
echo "Jika aset berubah setelah rilis, naikkan CACHE_VERSION di sw.js.\n";

/** Jadikan transparan piksel latar kartu yang terhubung ke tepi crop (flood fill), dengan tepi halus. */
function removeBackground($im, array $bg, int $tol): void {
    $w = imagesx($im); $h = imagesy($im);
    $dist = function ($x, $y) use ($im, $bg) {
        $c = imagecolorat($im, $x, $y);
        if ((($c >> 24) & 127) >= 120) return -1; // sudah transparan
        return abs((($c >> 16) & 255) - $bg[0]) + abs((($c >> 8) & 255) - $bg[1]) + abs(($c & 255) - $bg[2]);
    };
    $seen = array_fill(0, $w * $h, false);
    $stack = [];
    for ($x = 0; $x < $w; $x++) { $stack[] = [$x, 0]; $stack[] = [$x, $h - 1]; }
    for ($y = 0; $y < $h; $y++) { $stack[] = [0, $y]; $stack[] = [$w - 1, $y]; }
    $clear = imagecolorallocatealpha($im, 0, 0, 0, 127);
    $edge = [];
    while ($stack) {
        [$x, $y] = array_pop($stack);
        if ($x < 0 || $y < 0 || $x >= $w || $y >= $h) continue;
        $k = $y * $w + $x;
        if ($seen[$k]) continue;
        $seen[$k] = true;
        $d = $dist($x, $y);
        if ($d === -1 || $d <= $tol) {
            imagesetpixel($im, $x, $y, $clear);
            $stack[] = [$x + 1, $y]; $stack[] = [$x - 1, $y]; $stack[] = [$x, $y + 1]; $stack[] = [$x, $y - 1];
        } elseif ($d <= $tol * 2.5) {
            $edge[] = [$x, $y, $d];
        }
    }
    // piksel transisi di tepi objek: alpha sebanding dengan jarak warna dari latar kartu
    foreach ($edge as [$x, $y, $d]) {
        $c = imagecolorat($im, $x, $y);
        $t = ($d - $tol) / ($tol * 1.5);            // 0..1
        $a = (int)round(127 * (1 - $t) * 0.85);     // 127 = transparan
        imagesetpixel($im, $x, $y, imagecolorallocatealpha($im, ($c >> 16) & 255, ($c >> 8) & 255, $c & 255, max(0, min(127, $a))));
    }
}
