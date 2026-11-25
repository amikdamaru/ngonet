// State dan aturan permainan NGONET (murni, tanpa DOM, sehingga mudah diuji).
import { ROWS, COLS, PAIRS, TOTAL_ASSETS, MAX_TURNS, TILE_GROUPS, MAX_COPIES, validateGroups } from './config.js';
import { findPath } from './pathfinder.js';
import { scoreMatch, comboExpired } from './scoring.js';
import { buildSolvableBoard, pairUp } from './generator.js';

export function shuffleInPlace(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Pilih `count` jenis gambar unik secara acak dari 1..total. */
export function pickTypes(count = PAIRS, total = TOTAL_ASSETS, rng = Math.random) {
  const all = Array.from({ length: total }, (_, i) => i + 1);
  return shuffleInPlace(all, rng).slice(0, count);
}

/**
 * Buat permainan baru. Jenis gambar dipilih acak dari 48 aset sesuai komposisi TILE_GROUPS
 * (mis. 2 jenis ×6, 4 jenis ×4, 18 jenis ×2), lalu disusun menjadi papan yang solvable.
 */
export function createGame(rng = Math.random, groups = TILE_GROUPS) {
  const distinct = validateGroups(groups);
  const types = pickTypes(distinct, TOTAL_ASSETS, rng);
  const tiles = [];
  let id = 0;
  let k = 0;
  for (const g of groups) {
    for (let n = 0; n < g.types; n++, k++) {
      for (let c = 0; c < g.copies; c++) tiles.push({ id: id++, type: types[k] });
    }
  }
  const state = freshState(tiles);
  arrangeSolvable(state, rng);
  state.initial = state.board.slice(); // susunan awal sesi ini (dipakai Restart)
  return state;
}

function freshState(board, initial = null) {
  return {
    rows: ROWS,
    cols: COLS,
    initial,                // susunan awal sesi (tidak pernah berubah)
    board,                  // indeks = r * cols + c; null = kosong
    score: 0,
    combo: 0,
    lastMatchAt: null,
    matches: 0,
    over: null,             // null | 'combo' (combo putus) | 'stuck' (tidak ada pasangan)
  };
}

/** Restart: mulai ulang sesi yang sama dengan susunan awal yang identik. */
export function restartGame(state) {
  return freshState(state.initial.slice(), state.initial);
}

/**
 * Susun tile pada sel-sel yang terisi menjadi susunan yang DIJAMIN bisa diselesaikan
 * (lihat generator.js).
 *
 * Untuk gambar yang muncul 2x, papan solvable tidak bisa buntu. Gambar yang muncul 4x/6x
 * memberi pemain pilihan pasangan; pilihan yang kurang tepat BISA membuat papan buntu —
 * itulah unsur strateginya (papan buntu = game over).
 * Fallback (praktis tidak pernah terjadi): acak seragam.
 */
export function arrangeSolvable(state, rng = Math.random) {
  const slots = [];
  const tiles = [];
  state.board.forEach((t, i) => { if (t) { slots.push(i); tiles.push(t); } });
  if (!slots.length) return state;
  const res = buildSolvableBoard(state.rows, state.cols, slots, pairUp(tiles), rng);
  if (res) {
    state.board = res.board;
  } else {
    let attempts = 0;
    do {
      shuffleInPlace(tiles, rng);
      slots.forEach((slot, k) => { state.board[slot] = tiles[k]; });
    } while (!hasAvailableMove(state) && ++attempts < 100);
  }
  return state;
}

export const indexOf = (state, r, c) => r * state.cols + c;
export const posOf = (state, i) => ({ r: Math.floor(i / state.cols), c: i % state.cols });
export const remaining = (state) => state.board.reduce((n, t) => n + (t ? 1 : 0), 0);
export const isWon = (state) => remaining(state) === 0;

export function isEmptyFn(state) {
  return (r, c) => state.board[r * state.cols + c] === null;
}

/** Cari jalur valid antara dua indeks papan (tanpa mengubah state). */
export function pathBetween(state, i, j) {
  return findPath(isEmptyFn(state), state.rows, state.cols, posOf(state, i), posOf(state, j), MAX_TURNS);
}

/**
 * Periksa apakah combo sudah putus pada waktu `now`. Jika ya, permainan berakhir (over = 'combo').
 * @returns {string|null} alasan game over
 */
export function checkComboTimeout(state, now) {
  if (!state.over && !isWon(state) && comboExpired(state.lastMatchAt, now)) state.over = 'combo';
  return state.over;
}

/**
 * Coba cocokkan tile di indeks i dan j. Jika valid, state langsung dikomit:
 * kedua tile dihapus, skor dan combo diperbarui. Animasi di UI hanya kosmetik.
 * Jika setelah matching tidak ada pasangan yang bisa dihubungkan (dan papan belum habis),
 * permainan berakhir dengan over = 'stuck'.
 * @returns {{ok:false, reason:string} | {ok:true, path:object, points:number, combo:number, tiles:object[]}}
 */
export function tryMatch(state, i, j, now) {
  if (state.over) return { ok: false, reason: 'over' };
  if (checkComboTimeout(state, now)) return { ok: false, reason: 'combo-timeout' };
  if (i === j) return { ok: false, reason: 'same-tile' };
  const a = state.board[i];
  const b = state.board[j];
  if (!a || !b) return { ok: false, reason: 'empty' };
  if (a.type !== b.type) return { ok: false, reason: 'different' };
  const path = pathBetween(state, i, j);
  if (!path) return { ok: false, reason: 'no-path' };

  const { combo, points } = scoreMatch(state.combo, state.lastMatchAt, now);
  state.board[i] = null;
  state.board[j] = null;
  state.combo = combo;
  state.lastMatchAt = now;
  state.score += points;
  state.matches += 1;
  if (!isWon(state) && !hasAvailableMove(state)) state.over = 'stuck';
  return { ok: true, path, points, combo, tiles: [a, b] };
}

/** Apakah ada setidaknya satu pasangan yang bisa dihubungkan saat ini. */
export function hasAvailableMove(state) {
  const byType = new Map();
  state.board.forEach((t, i) => {
    if (!t) return;
    if (!byType.has(t.type)) byType.set(t.type, []);
    byType.get(t.type).push(i);
  });
  for (const idxs of byType.values()) {
    for (let x = 0; x < idxs.length; x++) {
      for (let y = x + 1; y < idxs.length; y++) {
        if (pathBetween(state, idxs[x], idxs[y])) return true;
      }
    }
  }
  return false;
}

// ---- Persistensi ringan (agar permainan tidak hilang saat aplikasi ditutup) ----

// Tile tidak pernah berpindah posisi, jadi cukup simpan susunan awal + sel mana yang masih terisi.
export function serialize(state) {
  return JSON.stringify({
    v: 2,
    rows: state.rows,
    cols: state.cols,
    initial: state.initial.map((t) => (t ? [t.id, t.type] : null)),
    alive: state.board.map((t) => (t ? 1 : 0)).join(''),
    score: state.score,
    matches: state.matches,
    over: state.over,
  });
}

/**
 * Muat permainan tersimpan. Permainan yang ditutup saat combo berjalan (sudah ada match) tidak
 * bisa dilanjutkan karena waktunya pasti terlewati → dimuat sebagai GAME OVER (combo putus),
 * sehingga pemain bisa memilih Restart (susunan sama) atau New Game.
 */
export function deserialize(json) {
  const d = JSON.parse(json);
  if (!d || d.v !== 2 || d.rows !== ROWS || d.cols !== COLS) return null;
  if (!Array.isArray(d.initial) || d.initial.length !== ROWS * COLS) return null;
  if (typeof d.alive !== 'string' || !/^[01]+$/.test(d.alive) || d.alive.length !== ROWS * COLS) return null;
  const initial = d.initial.map((t) => (Array.isArray(t) ? { id: t[0], type: t[1] } : null));
  // Validasi susunan awal: penuh, jenis dalam rentang aset, id unik, tiap jenis muncul genap ≤ MAX_COPIES.
  const counts = new Map();
  const ids = new Set();
  for (const t of initial) {
    if (!t) return null;
    if (!Number.isInteger(t.type) || t.type < 1 || t.type > TOTAL_ASSETS) return null;
    if (ids.has(t.id)) return null;
    ids.add(t.id);
    counts.set(t.type, (counts.get(t.type) || 0) + 1);
  }
  for (const n of counts.values()) if (n % 2 !== 0 || n > MAX_COPIES) return null;

  const board = initial.map((t, i) => (d.alive[i] === '1' ? t : null));
  // Tile yang sudah hilang harus berpasangan: sisa tiap jenis tetap genap.
  const left = new Map();
  board.forEach((t) => { if (t) left.set(t.type, (left.get(t.type) || 0) + 1); });
  for (const n of left.values()) if (n % 2 !== 0) return null;

  const state = freshState(board, initial);
  state.score = Number.isFinite(d.score) && d.score >= 0 ? Math.floor(d.score) : 0;
  state.matches = Math.max(0, d.matches | 0);
  state.over = d.over === 'combo' || d.over === 'stuck' ? d.over : null;
  if (!state.over && !isWon(state) && state.matches > 0) state.over = 'combo';
  return state;
}
