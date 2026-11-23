# NGONET

**Classic Tile Matching Game – Household Edition**

Permainan Onet Classic bertema perabotan & perlengkapan rumah tangga. Papan 8×8 berisi 64 tile dari 48 gambar — sebagian gambar muncul 4× atau 6× sehingga pemain harus memilih pasangan dengan strategi (komposisi diatur di `js/config.js` → `TILE_GROUPS`). Papan awal & hasil Shuffle selalu bisa diselesaikan,
tanpa timer, skor dengan combo progresif, Shuffle tanpa batas (penalti 50%), dan dapat di-install sebagai PWA yang
berjalan offline. Tanpa backend, tanpa build step: HTML + CSS + JavaScript (ES modules).

## Menjalankan

Cara mana pun yang menyajikan folder ini lewat HTTP:

```bash
# PHP built-in server (tersedia di XAMPP)
php -S localhost:8099 -t .
# buka http://localhost:8099/
```

Atau lewat Apache XAMPP: `http://localhost/ngonet/` (aplikasi memakai path relatif, jadi bisa di subfolder mana pun).

> Membuka `index.html` langsung via `file://` tidak didukung (ES modules & Service Worker butuh HTTP).

## Install di Android (PWA)

PWA hanya bisa di-install dari **HTTPS** atau **localhost**. Pilihan:

1. **Hosting statis HTTPS** (paling mudah): upload seluruh isi folder (tanpa `tests/`, `tools/`, `source/` juga boleh)
   ke GitHub Pages / Netlify / Cloudflare Pages / hosting HTTPS mana pun.
2. **Dari PC lewat USB**: aktifkan USB debugging, buka `chrome://inspect/#devices` di Chrome PC, aktifkan
   *Port forwarding* `8099 → localhost:8099`, lalu di HP buka `http://localhost:8099/`.

Lalu di Chrome Android: menu ⋮ → **Add to Home screen / Install app** → **Install**. Buka sekali saat online agar
semua aset ter-cache; setelah itu NGONET bisa dimainkan tanpa internet dan berjalan dalam mode standalone.

## Struktur

```
index.html               halaman & markup UI
manifest.webmanifest     Web App Manifest
sw.js                    Service Worker (precache + offline)
css/style.css            desain (mobile-first, palet pastel, animasi, reduced-motion)
js/config.js             konstanta aturan main
js/pathfinder.js         pencarian jalur Onet (0-1 BFS, maks 2 belokan, virtual border)
js/scoring.js            combo progresif & penalti shuffle
js/game.js               state permainan murni (buat papan, match, shuffle, simpan/muat)
js/generator.js          generator susunan papan yang dijamin bisa diselesaikan
js/assets.js             preload gambar
js/audio.js              musik latar (MP3) + sound effect sintesis Web Audio
js/main.js               controller UI (render, input, garis SVG, animasi, modal)
icons/                   ikon PWA (192/512 any + maskable, apple-touch, favicon)
public/assets/onet/tiles tile-01.png … tile-48.png (128×128, latar transparan)
public/assets/onet/audio bgm.mp3 (musik latar, loop)
source/spritesheet.png   spritesheet asli 8×6
tools/                   slice-spritesheet.php, make-icons.php, make-placeholders.php
tests/                   test suite browser (index.html), offline check, screenshot harness
```

## Aset

Tile dihasilkan dari `source/spritesheet.png`:

```bash
php tools/slice-spritesheet.php source/spritesheet.png     # opsi: --size=128 --keep-card --tol=48
```

Skrip mendeteksi tiap kartu dari profil piksel (harus tepat 8 kolom × 6 baris; jika tidak, proses dihentikan tanpa
menebak), mengambil ilustrasi di dalam kartu, membuang latar kartu menjadi transparan, dan menulis
`tools/out/preview.png` untuk pengecekan visual. Setelah aset atau kode berubah pada rilis, naikkan
`CACHE_VERSION` di `sw.js`.

## Audio

Musik latar `public/assets/onet/audio/bgm.mp3` diputar loop setelah sentuhan pertama (aturan autoplay browser) dan
dijeda saat aplikasi disembunyikan. Sound effect (pilih tile, match berhasil — nadanya naik seiring combo, match gagal)
disintesis dengan Web Audio API, tanpa file. Musik & efek bisa dimatikan lewat tombol di header (tersimpan).
Untuk mengganti musik: timpa `bgm.mp3`, lalu naikkan `MEDIA_VERSION` di `sw.js`.

## Test

Jalankan server, lalu buka `http://localhost:8099/tests/` di Chrome. Halaman menjalankan unit test, fuzz test
pathfinder vs. referensi brute-force, E2E pada aplikasi asli di iframe (sampai YOU WIN), cek layout, manifest,
dan Service Worker. `tests/offline.html` dipakai untuk uji offline nyata (buka online, matikan server, buka lagi).
