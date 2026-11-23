// Konfigurasi permainan NGONET. Semua angka aturan main dikumpulkan di sini.
export const ROWS = 8;
export const COLS = 8;
export const TOTAL_ASSETS = 48;            // jumlah gambar unik di spritesheet
export const PAIRS = (ROWS * COLS) / 2;    // 32 pasangan per permainan
export const MAX_TURNS = 2;                // aturan Onet Classic
export const BASE_POINTS = 10;
export const COMBO_WINDOW_MS = 3000;       // jeda maksimal antar-matching agar combo naik
export const SHUFFLE_FACTOR = 0.5;         // penalti shuffle: skor * 0.5 (dibulatkan ke atas)

export const TILE_PATH = 'public/assets/onet/tiles/';

export function tileSrc(type) {
  return `${TILE_PATH}tile-${String(type).padStart(2, '0')}.png`;
}

export function allTileSources() {
  return Array.from({ length: TOTAL_ASSETS }, (_, i) => tileSrc(i + 1));
}
