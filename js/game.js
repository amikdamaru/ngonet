// State dan aturan permainan NGONET (murni, tanpa DOM, sehingga mudah diuji).
import { ROWS, COLS, PAIRS, TOTAL_ASSETS, MAX_TURNS } from './config.js';
import { findPath } from './pathfinder.js';
import { scoreMatch, shufflePenalty } from './scoring.js';

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

/** Buat permainan baru: 32 jenis acak, masing-masing tepat 2 tile, posisi diacak. */
export function createGame(rng = Math.random) {
  const types = pickTypes(PAIRS, TOTAL_ASSETS, rng);
  const tiles = [];
  let id = 0;
  for (const type of types) {
    tiles.push({ id: id++, type });
    tiles.push({ id: id++, type });
  }
  const state = {
    rows: ROWS,
    cols: COLS,
    board: tiles,           // indeks = r * cols + c; null = kosong
    score: 0,
    combo: 0,
    lastMatchAt: null,
    matches: 0,
    shuffles: 0,
  };
  // Papan awal diacak ulang bila kebetulan tidak punya satu pun langkah,
  // agar permainan baru tidak pernah dimulai dalam kondisi buntu.
  // (Shuffle oleh pemain sengaja TIDAK dijamin solvable, sesuai aturan.)
  let attempts = 0;
  do { shuffleInPlace(tiles, rng); } while (!hasAvailableMove(state) && ++attempts < 100);
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
 * Coba cocokkan tile di indeks i dan j. Jika valid, state langsung dikomit:
 * kedua tile dihapus, skor dan combo diperbarui. Animasi di UI hanya kosmetik.
 * @returns {{ok:false, reason:string} | {ok:true, path:object, points:number, combo:number, tiles:object[]}}
 */
export function tryMatch(state, i, j, now) {
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
  return { ok: true, path, points, combo, tiles: [a, b] };
}

/**
 * Acak ulang posisi tile yang tersisa di antara sel-sel yang masih terisi.
 * Jumlah tile, jenis, dan pasangan tidak berubah; tile yang hilang tidak kembali.
 * Skor dipotong 50% (Math.ceil) dan combo direset.
 */
export function shuffleBoard(state, rng = Math.random) {
  const slots = [];
  const tiles = [];
  state.board.forEach((t, i) => {
    if (t) { slots.push(i); tiles.push(t); }
  });
  shuffleInPlace(tiles, rng);
  slots.forEach((slot, k) => { state.board[slot] = tiles[k]; });
  state.score = shufflePenalty(state.score);
  state.combo = 0;
  state.lastMatchAt = null;
  state.shuffles += 1;
  return state;
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

export function serialize(state) {
  return JSON.stringify({
    v: 1,
    rows: state.rows,
    cols: state.cols,
    board: state.board.map((t) => (t ? [t.id, t.type] : null)),
    score: state.score,
    matches: state.matches,
    shuffles: state.shuffles,
  });
}

export function deserialize(json) {
  const d = JSON.parse(json);
  if (!d || d.v !== 1 || d.rows !== ROWS || d.cols !== COLS) return null;
  if (!Array.isArray(d.board) || d.board.length !== ROWS * COLS) return null;
  const board = d.board.map((t) => (t ? { id: t[0], type: t[1] } : null));
  // Validasi: setiap jenis muncul genap, jenis dalam rentang aset, id unik.
  const counts = new Map();
  const ids = new Set();
  for (const t of board) {
    if (!t) continue;
    if (!Number.isInteger(t.type) || t.type < 1 || t.type > TOTAL_ASSETS) return null;
    if (ids.has(t.id)) return null;
    ids.add(t.id);
    counts.set(t.type, (counts.get(t.type) || 0) + 1);
  }
  for (const n of counts.values()) if (n !== 2) return null;
  if (ids.size === 0) return null; // permainan selesai: mulai baru
  const score = Number.isFinite(d.score) && d.score >= 0 ? Math.floor(d.score) : 0;
  return {
    rows: ROWS, cols: COLS, board, score,
    combo: 0, lastMatchAt: null,
    matches: d.matches | 0, shuffles: d.shuffles | 0,
  };
}
