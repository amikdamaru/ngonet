// Generator susunan papan yang DIJAMIN bisa diselesaikan.
//
// Simulasi maju berbasis posisi: mulai dari semua slot terisi (jenis gambar belum ditentukan),
// lalu berulang kali pilih dua slot terisi yang dapat dihubungkan (≤2 belokan, hanya lewat sel
// kosong / area luar papan) dan hapus keduanya. Karena jalur hanya bergantung pada sel mana yang
// terisi — bukan pada gambarnya — urutan ini adalah urutan penyelesaian yang valid. Setiap pasangan
// slot kemudian diberi satu jenis gambar secara acak.
//
// Pilihan pasangan dibuat acak & seragam di antara kandidat, sehingga susunan tetap bervariasi
// (tidak hanya tile bersebelahan). Jika simulasi buntu (jarang), diulang.
import { reachableTargets } from './pathfinder.js';
import { MAX_TURNS } from './config.js';

/** Peluang menghindari pasangan bersebelahan saat membangun papan (0 = mudah … 1 = paling menyebar). */
export const SPREAD = 1;

/**
 * @param {number} rows
 * @param {number} cols
 * @param {number[]} slots   indeks sel yang harus diisi (jumlah genap); sel lain dianggap kosong
 * @param {{id:number,type:number}[][]} pairs  pasangan tile (masing-masing 2 tile sejenis); panjang = slots/2
 * @param {() => number} rng
 * @param {number} maxAttempts
 * @returns {null | {board:(null|{id:number,type:number})[], solution:[number,number][]}}
 *   papan baru + satu urutan penghapusan yang valid, atau null jika gagal
 */
export function buildSolvableBoard(rows, cols, slots, pairs, rng = Math.random, maxAttempts = 50, spread = SPREAD) {
  if (slots.length !== pairs.length * 2) throw new Error('jumlah slot harus 2x jumlah pasangan');
  const size = rows * cols;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const occupied = new Uint8Array(size);
    for (const s of slots) occupied[s] = 1;
    const isEmpty = (r, c) => occupied[r * cols + c] === 0;
    const alive = slots.slice();
    const sequence = [];

    while (alive.length) {
      shuffle(alive, rng);
      let chosen = null;
      for (const a of alive) {
        let targets = reachableTargets(isEmpty, rows, cols, { r: Math.floor(a / cols), c: a % cols }, MAX_TURNS);
        if (!targets.length) continue;
        // Hindari pasangan bersebelahan (terlalu mudah) dengan peluang `spread`.
        if (rng() < spread) {
          const ar = Math.floor(a / cols), ac = a % cols;
          const far = targets.filter((b) => Math.abs(Math.floor(b / cols) - ar) + Math.abs((b % cols) - ac) > 1);
          if (far.length) targets = far;
        }
        chosen = [a, targets[Math.floor(rng() * targets.length)]];
        break;
      }
      if (!chosen) break; // buntu → ulangi percobaan
      const [a, b] = chosen;
      occupied[a] = 0; occupied[b] = 0;
      alive.splice(alive.indexOf(a), 1);
      alive.splice(alive.indexOf(b), 1);
      sequence.push(chosen);
    }
    if (alive.length) continue;

    const board = new Array(size).fill(null);
    const order = shuffle(pairs.slice(), rng);
    sequence.forEach(([a, b], k) => {
      const [t1, t2] = rng() < 0.5 ? order[k] : [order[k][1], order[k][0]];
      board[a] = t1;
      board[b] = t2;
    });
    return { board, solution: sequence };
  }
  return null;
}

/** Kelompokkan tile menjadi pasangan sejenis. */
export function pairUp(tiles) {
  const byType = new Map();
  for (const t of tiles) {
    if (!byType.has(t.type)) byType.set(t.type, []);
    byType.get(t.type).push(t);
  }
  const pairs = [];
  for (const list of byType.values()) {
    for (let i = 0; i + 1 < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
  }
  return pairs;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
