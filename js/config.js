// Konfigurasi permainan NGONET. Semua angka aturan main dikumpulkan di sini.
export const ROWS = 8;
export const COLS = 8;
export const TOTAL_ASSETS = 48;            // jumlah gambar unik di spritesheet
export const PAIRS = (ROWS * COLS) / 2;    // 32 pasangan (langkah matching) per permainan

/**
 * Komposisi gambar dalam satu papan: `types` jenis gambar yang masing-masing muncul `copies` kali.
 * Jenis yang muncul 4x/6x memberi percabangan: satu tile bisa dipasangkan dengan beberapa tile
 * sejenis, dan pilihan pemain menentukan jalur mana yang tetap terbuka.
 * Total copies × types harus = ROWS × COLS.
 */
export const TILE_GROUPS = [
  { copies: 6, types: 2 },
  { copies: 4, types: 4 },
  { copies: 2, types: 18 },
];
export const MAX_COPIES = Math.max(...TILE_GROUPS.map((g) => g.copies));

export function validateGroups(groups) {
  const total = groups.reduce((n, g) => n + g.copies * g.types, 0);
  const distinct = groups.reduce((n, g) => n + g.types, 0);
  if (total !== ROWS * COLS) throw new Error(`TILE_GROUPS harus berjumlah ${ROWS * COLS} tile (sekarang ${total})`);
  if (groups.some((g) => g.copies % 2 !== 0 || g.copies < 2)) throw new Error('copies harus genap ≥ 2');
  if (distinct > TOTAL_ASSETS) throw new Error('jenis gambar melebihi jumlah aset');
  return distinct;
}
validateGroups(TILE_GROUPS);
export const MAX_TURNS = 2;                // aturan Onet Classic
export const BASE_POINTS = 10;
// Jeda maksimal antar-matching. Timer mulai SETELAH match pertama; jika terlewati → combo putus = GAME OVER.
export const COMBO_WINDOW_MS = 3000;

export const TILE_PATH = 'public/assets/onet/tiles/';

export function tileSrc(type) {
  return `${TILE_PATH}tile-${String(type).padStart(2, '0')}.png`;
}

export function allTileSources() {
  return Array.from({ length: TOTAL_ASSETS }, (_, i) => tileSrc(i + 1));
}
