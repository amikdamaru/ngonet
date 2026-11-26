// NGONET test suite (berjalan di browser; hasil ditulis ke DOM agar bisa dibaca headless Chrome).
import { ROWS, COLS, PAIRS, TOTAL_ASSETS, MAX_TURNS, TILE_GROUPS, MAX_COPIES, allTileSources } from '../js/config.js';
import {
  createGame, restartGame, tryMatch, checkComboTimeout, pathBetween, remaining, isWon, hasAvailableMove,
  isEmptyFn, posOf, serialize, deserialize, shuffleInPlace,
} from '../js/game.js';
import { buildSolvableBoard, pairUp } from '../js/generator.js';
import { BGM_SRC } from '../js/audio.js';
import { findPath, validatePath } from '../js/pathfinder.js';
import { scoreMatch } from '../js/scoring.js';

const results = [];
const $results = document.getElementById('results');
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const li = document.createElement('li');
  li.className = ok ? 'pass' : 'fail';
  li.textContent = name + (detail ? ` — ${detail}` : '');
  $results.appendChild(li);
}
async function test(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === 'string' ? detail : '');
  } catch (err) {
    record(name, false, err && err.message ? err.message : String(err));
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'expected equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 8000, step = 25) {
  const t0 = performance.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (performance.now() - t0 > timeout) throw new Error('timeout menunggu kondisi');
    await sleep(step);
  }
}

// RNG deterministik untuk test
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Papan dari 8 string: '.' kosong, '#' tile pengisi (jenis unik), huruf = jenis berpasangan.
 * Mengembalikan state + posisi tiap huruf.
 */
function makeState(rows) {
  let id = 0, filler = 1000;
  const marks = {};
  const board = [];
  rows.forEach((line, r) => {
    assert(line.length === COLS, `baris ${r} harus ${COLS} karakter`);
    [...line].forEach((ch, c) => {
      if (ch === '.') { board.push(null); return; }
      if (ch === '#') { board.push({ id: id++, type: filler++ }); return; }
      const type = ch.charCodeAt(0);
      board.push({ id: id++, type });
      (marks[ch] ||= []).push(r * COLS + c);
    });
  });
  return { state: { rows: ROWS, cols: COLS, board, score: 0, combo: 0, lastMatchAt: null, matches: 0, over: null }, marks };
}
const FULL = '########';

/** Semua pasangan sejenis (termasuk jenis 4x/6x) yang bisa dihubungkan saat ini. */
function allPairs(st) {
  const m = new Map();
  st.board.forEach((t, i) => { if (t) (m.get(t.type) || m.set(t.type, []).get(t.type)).push(i); });
  const res = [];
  for (const idx of m.values()) for (let x = 0; x < idx.length; x++) for (let y = x + 1; y < idx.length; y++) {
    if (pathBetween(st, idx[x], idx[y])) res.push([idx[x], idx[y]]);
  }
  return res;
}

function checkPath(state, i, j) {
  const p = pathBetween(state, i, j);
  if (!p) return null;
  assert(validatePath(isEmptyFn(state), ROWS, COLS, posOf(state, i), posOf(state, j), p.cells, MAX_TURNS), 'jalur yang ditemukan tidak valid');
  return p;
}

/** Referensi brute force: ada jalur ≤2 belokan jika ada titik P1, P2 pada grid ber-border dengan segmen lurus bersih. */
function referenceConnect(state, i, j) {
  const a = posOf(state, i), b = posOf(state, j);
  const free = (r, c) => {
    if (r < -1 || r > ROWS || c < -1 || c > COLS) return false;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return true;
    return state.board[r * COLS + c] === null;
  };
  const same = (p, q) => p.r === q.r && p.c === q.c;
  // segmen lurus p→q bersih (tanpa ujung)
  const clear = (p, q) => {
    if (p.r !== q.r && p.c !== q.c) return false;
    const dr = Math.sign(q.r - p.r), dc = Math.sign(q.c - p.c);
    let r = p.r + dr, c = p.c + dc;
    while (r !== q.r || c !== q.c) { if (!free(r, c)) return false; r += dr; c += dc; }
    return true;
  };
  if (clear(a, b)) return true;
  for (let r1 = -1; r1 <= ROWS; r1++) for (let c1 = -1; c1 <= COLS; c1++) {
    const p1 = { r: r1, c: c1 };
    if (same(p1, a) || same(p1, b) || !free(r1, c1) || !clear(a, p1)) continue;
    if (clear(p1, b)) return true;
    for (let r2 = -1; r2 <= ROWS; r2++) for (let c2 = -1; c2 <= COLS; c2++) {
      const p2 = { r: r2, c: c2 };
      if (same(p2, a) || same(p2, b) || same(p2, p1) || !free(r2, c2)) continue;
      if (clear(p1, p2) && clear(p2, b)) return true;
    }
  }
  return false;
}

// ============================================================ GAMEPLAY
await test('1. Papan baru berisi 64 tile', () => {
  for (let k = 0; k < 50; k++) {
    const g = createGame();
    eq(g.board.length, 64, 'panjang papan');
    eq(remaining(g), 64, 'tile terisi');
  }
});

const groupLabel = TILE_GROUPS.map((g) => `${g.types} jenis ×${g.copies}`).join(' + ');
await test(`2–3. Komposisi gambar sesuai konfigurasi (${groupLabel}) dari 48 aset`, () => {
  const seen = new Set();
  const want = TILE_GROUPS.map((g) => Array(g.types).fill(g.copies)).flat().sort((a, b) => a - b).join();
  for (let k = 0; k < 200; k++) {
    const g = createGame();
    const counts = new Map();
    g.board.forEach((t) => counts.set(t.type, (counts.get(t.type) || 0) + 1));
    eq([...counts.values()].sort((a, b) => a - b).join(), want, 'jumlah kemunculan per jenis');
    for (const type of counts.keys()) {
      assert(type >= 1 && type <= TOTAL_ASSETS, 'jenis di luar rentang aset');
      seen.add(type);
    }
    eq(new Set(g.board.map((t) => t.id)).size, 64, 'id unik');
  }
  eq(seen.size, TOTAL_ASSETS, 'seluruh 48 aset terpakai dalam 200 permainan acak');
  // jenis yang mendapat 4x/6x juga acak antar-permainan
  const sixA = (g) => { const c = new Map(); g.board.forEach((t) => c.set(t.type, (c.get(t.type) || 0) + 1)); return [...c].filter(([, n]) => n === MAX_COPIES).map(([t]) => t).sort().join(); };
  assert(sixA(createGame(mulberry32(11))) !== sixA(createGame(mulberry32(12))), 'jenis ×6 selalu sama');
  return 'semua 48 aset muncul dalam 200 permainan';
});

await test('Percabangan (contoh A1/A2/A6): pilihan pasangan menentukan jalur B6↔A3 terbuka atau tidak', () => {
  // Baris A = r0, B = r1; kolom 1..8 = c0..c7.  X muncul 4x: A1, A2, A6, H8.  Y: A3 & B6.
  const board = [
    'XXY##X##',  // A1=X A2=X A3=Y A6=X
    '#####Y##',  // B6=Y
    FULL, FULL, FULL, FULL, FULL,
    '#######X',  // H8=X
  ];
  const A1 = 0, A2 = 1, A3 = 2, A6 = 5, B6 = 13;
  // Pilihan 1: A1 dengan A6 (lewat atas papan) → B6 sekarang bisa ke A3
  let { state } = makeState(board);
  assert(pathBetween(state, A1, A2) && pathBetween(state, A1, A6), 'A1 harus bisa memilih A2 atau A6');
  assert(!pathBetween(state, B6, A3), 'awalnya B6–A3 tertutup');
  assert(tryMatch(state, A1, A6, 0).ok, 'A1–A6');
  assert(pathBetween(state, B6, A3), 'setelah A1–A6, B6–A3 harus terbuka');
  // Pilihan 2: A1 dengan A2 → A6 tetap menghalangi, B6–A3 tetap tertutup
  ({ state } = makeState(board));
  assert(tryMatch(state, A1, A2, 0).ok, 'A1–A2');
  assert(!pathBetween(state, B6, A3), 'setelah A1–A2, B6–A3 harus tetap tertutup');
});

await test('Papan generator memberi pilihan: rata-rata ≥5 giliran bercabang per game (simulasi 40 game)', () => {
  const rng = mulberry32(21);
  let branches = 0;
  for (let k = 0; k < 40; k++) {
    const g = createGame(rng);
    while (remaining(g) > 0) {
      const av = allPairs(g);
      if (!av.length) break; // buntu karena pilihan (tanpa Shuffle)
      const deg = new Map();
      for (const [i, j] of av) { deg.set(i, (deg.get(i) || 0) + 1); deg.set(j, (deg.get(j) || 0) + 1); }
      if ([...deg.values()].some((d) => d >= 2)) branches++;
      const [i, j] = av[Math.floor(rng() * av.length)];
      g.board[i] = null; g.board[j] = null;
    }
  }
  assert(branches / 40 >= 5, `rata-rata hanya ${(branches / 40).toFixed(1)}`);
  return `rata-rata ${(branches / 40).toFixed(1)} giliran bercabang dari 32`;
});

await test('Papan awal tidak pernah buntu (selalu ada ≥1 langkah)', () => {
  for (let k = 0; k < 500; k++) assert(hasAvailableMove(createGame()), `permainan ke-${k} buntu`);
});

await test('Generator: papan penuh & sebagian selalu solvable (urutan solusi diverifikasi)', () => {
  const rng = mulberry32(99);
  for (let k = 0; k < 300; k++) {
    const g = createGame(rng);
    const keepPairs = k % 3 === 0 ? 32 : 1 + Math.floor(rng() * 31);
    const pairs = pairUp(g.board).slice(0, keepPairs);
    const slots = shuffleInPlace(g.board.map((_, i) => i), rng).slice(0, keepPairs * 2);
    const res = buildSolvableBoard(ROWS, COLS, slots, pairs, rng);
    assert(res, `generator gagal di iterasi ${k}`);
    const sim = { rows: ROWS, cols: COLS, board: res.board };
    assert(res.board.every((t, i) => !!t === slots.includes(i)), 'tile harus tepat di slot yang diberikan');
    for (const [i, j] of res.solution) {
      assert(sim.board[i].type === sim.board[j].type, 'pasangan solusi beda jenis');
      assert(pathBetween(sim, i, j), 'langkah solusi tidak bisa dihubungkan');
      sim.board[i] = null; sim.board[j] = null;
    }
    eq(remaining(sim), 0, 'solusi harus menghabiskan papan');
  }
  return '300 papan, semua solusi valid';
});

await test('Teorema: bila semua gambar 2x, papan solvable tidak pernah buntu (200 game acak tanpa Shuffle)', () => {
  const rng = mulberry32(5);
  const ALL_TWO = [{ copies: 2, types: 32 }];
  for (let k = 0; k < 200; k++) {
    const g = createGame(rng, ALL_TWO);
    for (let step = 0; remaining(g) > 0; step++) {
      const av = allPairs(g);
      assert(av.length, `game ${k} buntu dengan ${remaining(g)} tile tersisa`);
      const [i, j] = av[Math.floor(rng() * av.length)];
      g.board[i] = null; g.board[j] = null;
    }
  }
});

await test('Posisi dan pemilihan gambar teracak antar-permainan', () => {
  const a = createGame(mulberry32(1)), b = createGame(mulberry32(2));
  assert(a.board.map((t) => t.type).join() !== b.board.map((t) => t.type).join(), 'susunan identik');
});

await test('4. Matching jalur lurus berhasil (bersebelahan & berjarak)', () => {
  const { state, marks } = makeState([FULL, FULL, FULL, '##AA####', FULL, '#B..B###', FULL, FULL]);
  const p1 = checkPath(state, ...marks.A);
  assert(p1 && p1.turns === 0, 'A bersebelahan harus 0 belokan');
  const p2 = checkPath(state, ...marks.B);
  assert(p2 && p2.turns === 0, 'B berjarak harus 0 belokan');
  const r = tryMatch(state, ...marks.B, 0);
  assert(r.ok, 'tryMatch B harus berhasil');
});

await test('5. Matching satu belokan berhasil', () => {
  const { state, marks } = makeState([FULL, FULL, '##A..###', '####.###', '####A###', FULL, FULL, FULL]);
  const p = checkPath(state, ...marks.A);
  assert(p && p.turns === 1, `harus 1 belokan, dapat ${p && p.turns}`);
  eq(p.points.length, 3, 'titik jalur (awal, belokan, akhir)');
});

await test('6. Matching dua belokan berhasil', () => {
  const { state, marks } = makeState([FULL, FULL, '##A.####', '###.####', '###.A###', FULL, FULL, FULL]);
  const p = checkPath(state, ...marks.A);
  assert(p && p.turns === 2, `harus 2 belokan, dapat ${p && p.turns}`);
  eq(p.points.length, 4, 'titik jalur');
  assert(tryMatch(state, ...marks.A, 0).ok, 'tryMatch harus berhasil');
});

await test('7. Matching yang butuh tiga belokan gagal', () => {
  const { state, marks } = makeState([FULL, FULL, '##A.####', '###..###', '####.###', '####.A##', FULL, FULL]);
  // staircase: kanan, bawah, kanan, bawah, kanan → ≥3 belokan
  eq(checkPath(state, ...marks.A), null, 'tidak boleh ada jalur');
  const before = remaining(state);
  const r = tryMatch(state, ...marks.A, 0);
  assert(!r.ok && r.reason === 'no-path', 'tryMatch harus gagal no-path');
  eq(remaining(state), before, 'tile tidak boleh hilang');
  eq(state.score, 0, 'skor tidak bertambah');
});

await test('8. Jalur yang melewati tile lain gagal', () => {
  const { state, marks } = makeState([FULL, FULL, FULL, '#A.#.A##', FULL, FULL, FULL, FULL]);
  eq(checkPath(state, ...marks.A), null, 'jalur terhalang tile');
});

await test('9. Jalur lewat area luar papan berhasil (atas, kiri, kanan, bawah)', () => {
  // baris atas: dua tile di tepi atas dipisah tile → keluar ke atas (2 belokan)
  let { state, marks } = makeState(['#A##A###', FULL, FULL, FULL, FULL, FULL, FULL, FULL]);
  let p = checkPath(state, ...marks.A);
  assert(p && p.turns === 2 && p.points.some((q) => q.r === -1), 'harus lewat baris virtual -1');
  // kolom kiri: pojok kiri atas & kiri bawah
  ({ state, marks } = makeState(['A#######', FULL, FULL, FULL, FULL, FULL, FULL, 'A#######']));
  p = checkPath(state, ...marks.A);
  assert(p && p.points.some((q) => q.c === -1), 'harus lewat kolom virtual -1');
  // kolom kanan
  ({ state, marks } = makeState(['#######A', FULL, FULL, FULL, FULL, FULL, FULL, '#######A']));
  p = checkPath(state, ...marks.A);
  assert(p && p.points.some((q) => q.c === COLS), 'harus lewat kolom virtual 8');
  // baris bawah
  ({ state, marks } = makeState([FULL, FULL, FULL, FULL, FULL, FULL, FULL, 'A######A']));
  p = checkPath(state, ...marks.A);
  assert(p && p.points.some((q) => q.r === ROWS), 'harus lewat baris virtual 8');
  // pojok berseberangan diagonal (kiri-atas & kanan-bawah) butuh 3 belokan → gagal
  ({ state, marks } = makeState(['A#######', FULL, FULL, FULL, FULL, FULL, FULL, '#######A']));
  eq(checkPath(state, ...marks.A), null, 'pojok diagonal pada papan penuh tidak boleh terhubung');
});

await test('10. Gambar berbeda tidak dapat dihilangkan', () => {
  const { state, marks } = makeState([FULL, FULL, FULL, '##AB####', FULL, FULL, FULL, '##AB####']);
  const r = tryMatch(state, marks.A[0], marks.B[0], 0);
  assert(!r.ok && r.reason === 'different', 'harus gagal different');
  eq(remaining(state), 64, 'tidak ada tile hilang');
  assert(!tryMatch(state, marks.A[0], marks.A[0], 0).ok, 'tile yang sama tidak boleh cocok dengan dirinya');
});

await test('Fuzz: pathfinder = referensi brute-force pada 3000 pasangan acak', () => {
  const rng = mulberry32(42);
  let agree = 0, connected = 0;
  for (let k = 0; k < 3000; k++) {
    const g = createGame(rng);
    const density = rng();
    g.board = g.board.map((t) => (rng() < density ? t : null));
    const filled = g.board.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
    if (filled.length < 2) continue;
    const i = filled[Math.floor(rng() * filled.length)];
    let j = filled[Math.floor(rng() * filled.length)];
    if (i === j) continue;
    const bfs = checkPath(g, i, j); // juga memvalidasi jalur
    const ref = referenceConnect(g, i, j);
    if (!!bfs !== ref) throw new Error(`beda hasil di iterasi ${k}: bfs=${!!bfs} ref=${ref}`);
    agree++; if (ref) connected++;
  }
  return `${agree} pasangan cocok (${connected} terhubung)`;
});

// ============================================================ SCORING
await test('11–13. Matching beruntun ≤3 detik: 10, 20, 30, 40, 50, 60', () => {
  let combo = 0, last = null; const pts = [];
  [0, 1000, 2500, 5000, 7999, 10999].forEach((t) => { const s = scoreMatch(combo, last, t); combo = s.combo; last = t; pts.push(s.points); });
  eq(pts.join(), '10,20,30,40,50,60', 'urutan poin');
});

await test('14. Combo reset jika jeda > 3 detik', () => {
  let s = scoreMatch(0, null, 0);
  s = scoreMatch(s.combo, 0, 2000); eq(s.points, 20, 'kedua');
  s = scoreMatch(s.combo, 2000, 5001); eq(s.points, 10, 'jeda 3001ms harus reset');
  eq(scoreMatch(1, 0, 3000).points, 20, 'tepat 3000ms masih combo');
});

await test('Skor terintegrasi tryMatch: 10 → 30 (tepat 3 dtk masih combo)', () => {
  const { state, marks } = makeState([FULL, FULL, 'AABBCCDD', FULL, FULL, FULL, FULL, FULL]);
  tryMatch(state, ...marks.A, 100); eq(state.score, 10, 'skor 1');
  tryMatch(state, ...marks.B, 3100); eq(state.score, 30, 'skor 2 (tepat 3 dtk)');
  eq(state.over, null, 'belum game over');
});

await test('GAME OVER: combo putus bila jeda > 3 detik; tile tidak hilang & input berikutnya ditolak', () => {
  const { state, marks } = makeState([FULL, FULL, 'AABBCCDD', FULL, FULL, FULL, FULL, FULL]);
  tryMatch(state, ...marks.A, 100);
  tryMatch(state, ...marks.B, 2000);
  const r = tryMatch(state, ...marks.C, 5001); // 3001 ms setelah match terakhir
  assert(!r.ok && r.reason === 'combo-timeout', `harus combo-timeout, dapat ${r.reason}`);
  eq(state.over, 'combo', 'state.over');
  eq(state.score, 30, 'skor tidak bertambah');
  eq(remaining(state), 64 - 4, 'tile C tidak hilang');
  const r2 = tryMatch(state, ...marks.D, 5002);
  assert(!r2.ok && r2.reason === 'over', 'setelah game over semua input ditolak');
});

await test('Timer combo baru berjalan setelah match pertama; tepat 3000 ms belum putus', () => {
  const { state, marks } = makeState([FULL, FULL, 'AABB####', FULL, FULL, FULL, FULL, FULL]);
  eq(checkComboTimeout(state, 1e9), null, 'sebelum match pertama tidak ada batas waktu');
  assert(tryMatch(state, ...marks.A, 1e9).ok, 'match pertama kapan saja');
  eq(checkComboTimeout(state, 1e9 + 3000), null, 'tepat 3000 ms');
  eq(checkComboTimeout(state, 1e9 + 3001), 'combo', '3001 ms → putus');
});

await test('GAME OVER: papan buntu (tidak ada pasangan yang bisa dihubungkan)', () => {
  const { state, marks } = makeState(['AA######', FULL, FULL, FULL, FULL, FULL, FULL, FULL]);
  const r = tryMatch(state, ...marks.A, 0);
  assert(r.ok, 'match terakhir tetap berhasil');
  eq(state.over, 'stuck', 'state.over');
});

/** Cari urutan penyelesaian lengkap (DFS + memo) — untuk mensimulasikan pemain sempurna. */
function solve(st) {
  const seen = new Set();
  const sim = { rows: ROWS, cols: COLS, board: st.board.slice() };
  const path = [];
  const dfs = () => {
    if (remaining(sim) === 0) return true;
    const key = sim.board.map((t) => (t ? 1 : 0)).join('');
    if (seen.has(key)) return false;
    seen.add(key);
    for (const [i, j] of allPairs(sim)) {
      const a = sim.board[i], b = sim.board[j];
      sim.board[i] = null; sim.board[j] = null; path.push([i, j]);
      if (dfs()) return true;
      sim.board[i] = a; sim.board[j] = b; path.pop();
    }
    return false;
  };
  return dfs() ? path : null;
}

await test('Menang: 32 match beruntun tanpa putus → skor 5280', () => {
  for (let k = 0; k < 10; k++) {
    const g = createGame(mulberry32(300 + k));
    const seq = solve(g);
    assert(seq, `papan ${k} tidak bisa diselesaikan`);
    seq.forEach(([i, j], n) => assert(tryMatch(g, i, j, 1000 + n * 2500).ok, `match ke-${n + 1}`));
    assert(isWon(g), 'harus menang');
    eq(g.over, null, 'bukan game over');
    eq(g.score, 5280, 'skor kemenangan = 10×(1+…+32)');
  }
});

await test('Restart: susunan awal identik, skor/combo/progres kembali 0', () => {
  const g = createGame(mulberry32(8));
  const sig = (b) => b.map((t) => t && `${t.id}:${t.type}`).join();
  const initialSig = sig(g.initial);
  eq(sig(g.board), initialSig, 'papan awal = initial');
  const seq = solve(g);
  for (let n = 0; n < 5; n++) tryMatch(g, ...seq[n], n * 100);
  tryMatch(g, ...seq[5], 99999); // combo putus → game over
  eq(g.over, 'combo', 'game over');
  const r1 = restartGame(g);
  eq(sig(r1.board), initialSig, 'restart pertama: susunan sama');
  eq(r1.score, 0, 'skor'); eq(r1.combo, 0, 'combo'); eq(r1.matches, 0, 'matches');
  eq(r1.over, null, 'over'); eq(r1.lastMatchAt, null, 'timer');
  tryMatch(r1, ...seq[0], 0);
  const r2 = restartGame(r1);
  eq(sig(r2.board), initialSig, 'restart kedua: tetap susunan yang sama');
  eq(remaining(r2), 64, '64 tile');
});

await test('New Game: susunan tiles baru', () => {
  const a = createGame(), b = createGame();
  assert(a.initial.map((t) => t.type).join() !== b.initial.map((t) => t.type).join(), 'susunan identik');
});

await test('Simpan/muat: susunan awal & sisa tile utuh; ditutup saat combo berjalan → game over; data rusak ditolak', () => {
  const g = createGame(mulberry32(3));
  // belum ada match → bisa dilanjutkan
  let back = deserialize(serialize(g));
  assert(back && back.over === null && remaining(back) === 64, 'sesi tanpa progres dilanjutkan');
  const seq = solve(g);
  tryMatch(g, ...seq[0], 0); tryMatch(g, ...seq[1], 100);
  back = deserialize(serialize(g));
  assert(back, 'harus bisa dimuat');
  eq(back.score, 30, 'skor');
  eq(back.board.map((t) => t && t.id).join(), g.board.map((t) => t && t.id).join(), 'sisa tile');
  eq(back.initial.map((t) => t.id).join(), g.initial.map((t) => t.id).join(), 'susunan awal');
  eq(back.over, 'combo', 'combo berjalan saat ditutup → game over');
  eq(restartGame(back).board.map((t) => t.id).join(), g.initial.map((t) => t.id).join(), 'restart setelah muat');
  const bad = JSON.parse(serialize(g));
  bad.alive = bad.alive.replace('1', '0'); // satu tile hilang tanpa pasangannya
  eq(deserialize(JSON.stringify(bad)), null, 'data rusak (jenis ganjil) ditolak');
});

// ============================================================ E2E (aplikasi asli di iframe)
function makeFrame(w, h) {
  const f = document.createElement('iframe');
  f.width = w; f.height = h;
  document.getElementById('frames').appendChild(f);
  return f;
}
async function loadApp(frame) {
  frame.src = '../index.html?test=' + Date.now();
  await waitFor(() => frame.contentDocument && frame.contentDocument.getElementById('app') && !frame.contentDocument.getElementById('app').hidden, 20000);
  await sleep(450); // animasi masuk
  return { win: frame.contentWindow, doc: frame.contentDocument };
}
function findPair(st, wantPath = true) {
  const idx = new Map();
  st.board.forEach((t, i) => { if (t) (idx.get(t.type) || idx.set(t.type, []).get(t.type)).push(i); });
  for (const list of idx.values()) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
    if (!!pathBetween(st, list[x], list[y]) === wantPath) return [list[x], list[y]];
  }
  return null;
}
function findDifferent(st) {
  const f = st.board.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
  for (const i of f) for (const j of f) if (st.board[i].type !== st.board[j].type) return [i, j];
  return null;
}
const tileEl = (doc, st, i) => doc.querySelector(`.tile[data-id="${st.board[i].id}"]`);

try { localStorage.removeItem('ngonet:game:v2'); } catch { /* */ }
const frame = makeFrame(390, 844);
let app;
await test('Aplikasi termuat & seluruh 48 aset gambar berhasil dimuat', async () => {
  app = await loadApp(frame);
  const imgs = await Promise.all(allTileSources().map((src) => new Promise((res) => {
    const im = new Image(); im.onload = () => res(im.naturalWidth); im.onerror = () => res(0); im.src = '../' + src;
  })));
  assert(imgs.every((w) => w === 128), 'ada aset gagal dimuat / ukuran salah: ' + imgs.join(','));
  const tiles = app.doc.querySelectorAll('.tile');
  eq(tiles.length, 64, 'elemen tile di DOM');
  assert([...tiles].every((t) => t.querySelector('img').complete && t.querySelector('img').naturalWidth > 0), 'gambar tile belum tampil');
});

const S = () => app.win.__ngonet.state;
const scoreText = () => Number(app.doc.getElementById('score').textContent);

await test('Interaksi: tap tile yang sama dua kali membatalkan pilihan', async () => {
  const el = tileEl(app.doc, S(), S().board.findIndex(Boolean));
  el.click();
  assert(el.classList.contains('selected'), 'harus selected');
  el.click();
  assert(!el.classList.contains('selected'), 'harus batal');
  eq(app.win.__ngonet.selected, null, 'state selected');
  eq(remaining(S()), 64, 'tidak ada matching');
});

await test('Interaksi: pasangan berbeda → feedback invalid, tile tidak hilang', async () => {
  const [i, j] = findDifferent(S());
  const a = tileEl(app.doc, S(), i), b = tileEl(app.doc, S(), j);
  a.click(); b.click();
  assert(a.classList.contains('invalid') && b.classList.contains('invalid'), 'kelas invalid');
  eq(remaining(S()), 64, 'tile tetap');
  eq(scoreText(), 0, 'skor tetap 0');
  await sleep(400);
  assert(!a.classList.contains('invalid') && !a.classList.contains('selected'), 'kembali normal');
});

await test('Interaksi: jenis sama tetapi tanpa jalur valid → tidak hilang', async () => {
  const pr = findPair(S(), false);
  if (!pr) return 'dilewati (semua pasangan kebetulan terhubung)';
  tileEl(app.doc, S(), pr[0]).click(); tileEl(app.doc, S(), pr[1]).click();
  eq(remaining(S()), 64, 'tile tetap');
  await sleep(400);
});

const $id = (id) => app.doc.getElementById(id);
const boardSig = (b) => b.map((t) => t && `${t.id}:${t.type}`).join();
/** Klik New Game dari kondisi apa pun (konfirmasi / modal game over / modal menang). */
async function clickNewGame() {
  if (!$id('overModal').hidden) { $id('overRestartBtn').click(); await sleep(50); } // game over: hanya Retry
  if (!$id('winModal').hidden) $id('winNewGameBtn').click();
  else {
    $id('newGameBtn').click();
    if (!$id('confirmModal').hidden) $id('confirmYes').click();
  }
  await sleep(450);
}
/** Mainkan n langkah dari urutan solusi dengan jeda singkat (< 3 dtk). */
async function playMoves(seq, n, gap = 40) {
  for (let k = 0; k < n; k++) {
    tileEl(app.doc, S(), seq[k][0]).click(); tileEl(app.doc, S(), seq[k][1]).click();
    await sleep(gap);
  }
}

await test('Tidak ada tombol Shuffle; tersedia Restart & New Game', async () => {
  eq($id('shuffleBtn'), null, 'tombol Shuffle harus hilang');
  eq($id('best'), null, 'Best score harus hilang');
  assert($id('wins'), 'win counter tampil');
  assert($id('restartBtn') && $id('newGameBtn'), 'tombol Restart & New Game');
});

await test('E2E skor & combo: 10 → 30 → 60, indikator COMBO x2/x3, garis tampil', async () => {
  await clickNewGame();
  const seq = solve(S());
  assert(seq, 'papan harus bisa diselesaikan');
  const expect = [10, 30, 60];
  for (let k = 0; k < 3; k++) {
    const ids = [S().board[seq[k][0]].id, S().board[seq[k][1]].id];
    tileEl(app.doc, S(), seq[k][0]).click(); tileEl(app.doc, S(), seq[k][1]).click();
    eq(scoreText(), expect[k], `skor setelah matching ke-${k + 1}`);
    assert(app.doc.querySelector('#links polyline'), 'garis penghubung harus digambar');
    eq($id('comboText').textContent, `COMBO x${k + 1}`, 'teks combo');
    // double tap pada tile yang sudah dihapus tidak berpengaruh
    const ghost = app.doc.querySelector(`.tile[data-id="${ids[0]}"]`);
    if (ghost) { ghost.click(); ghost.click(); }
    eq(app.win.__ngonet.selected, null, 'tile terhapus tidak bisa dipilih');
    eq(scoreText(), expect[k], 'skor tidak berubah akibat double tap');
  }
  eq(remaining(S()), 58, 'tersisa 58 tile');
  await sleep(700);
  eq(app.doc.querySelectorAll('.tile').length, 58, 'elemen DOM terhapus tepat sekali');
});

await test('E2E GAME OVER: jeda > 3 detik → modal Game Over hanya dengan tombol Retry', async () => {
  const st = S();
  await waitFor(() => !$id('overModal').hidden, 4500);
  eq(st.over, 'combo', 'state.over');
  assert(/Combo terputus/.test($id('overReason').textContent), 'alasan combo putus');
  eq(Number($id('overScore').textContent), 60, 'skor game over');
  assert(/3\/32/.test($id('overProgress').textContent), 'progres 3/32');
  eq($id('overRestartBtn').textContent.trim(), 'Retry', 'tombol Retry');
  eq($id('overNewGameBtn'), null, 'tidak ada tombol New Game di Game Over');
  eq($id('overModal').querySelectorAll('button').length, 1, 'satu-satunya pilihan: Retry');
  assert(!/Best/.test($id('overProgress').textContent), 'tidak ada Best score');
  // papan terkunci
  const i = st.board.findIndex(Boolean);
  tileEl(app.doc, st, i).click();
  eq(app.win.__ngonet.selected, null, 'tile tidak bisa dipilih setelah game over');
});

await test('E2E Retry dari Game Over: susunan tiles sama persis, skor 0', async () => {
  const initialSig = boardSig(S().initial);
  $id('overRestartBtn').click();
  assert($id('overModal').hidden, 'modal tertutup');
  eq(boardSig(S().board), initialSig, 'papan = susunan awal sesi');
  eq(scoreText(), 0, 'skor');
  eq(app.doc.querySelectorAll('.tile').length, 64, '64 tile tampil');
  eq(S().over, null, 'tidak over');
  await sleep(450);
});

await test('E2E Restart saat bermain: konfirmasi; Batal tidak mengubah; Restart → susunan sama', async () => {
  const seq = solve(S());
  await playMoves(seq, 2);
  const st = S(); const sig = boardSig(st.board); const score = scoreText();
  $id('restartBtn').click();
  assert(!$id('confirmModal').hidden, 'dialog konfirmasi tampil');
  eq($id('confirmYes').textContent, 'Restart', 'label tombol');
  $id('confirmNo').click();
  assert($id('confirmModal').hidden && S() === st && boardSig(st.board) === sig && scoreText() === score, 'batal tidak mengubah');
  $id('restartBtn').click();
  $id('confirmYes').click();
  eq(boardSig(S().board), boardSig(st.initial), 'susunan awal yang sama');
  eq(scoreText(), 0, 'skor 0');
  await sleep(450);
});

await test('E2E New Game: konfirmasi saat bermain → susunan tiles baru', async () => {
  const seq = solve(S());
  await playMoves(seq, 1);
  const oldInitial = boardSig(S().initial);
  $id('newGameBtn').click();
  assert(!$id('confirmModal').hidden, 'dialog konfirmasi tampil');
  eq($id('confirmYes').textContent, 'New Game', 'label tombol');
  $id('confirmYes').click();
  assert(boardSig(S().initial) !== oldInitial, 'susunan harus baru');
  eq(scoreText(), 0, 'skor 0');
  eq(remaining(S()), 64, '64 tile');
  eq($id('pairs').textContent, '32', 'pairs left');
  await sleep(450);
});

await test('Audio SFX: pilih tile → select, match gagal → fail, match berhasil → match', async () => {
  const A = app.win.__ngonet.audio;
  assert(A.settings.sfx, 'efek suara harus aktif secara default');
  await clickNewGame();
  const last = () => A.history[A.history.length - 1];
  const diff = findDifferent(S());
  tileEl(app.doc, S(), diff[0]).click();
  eq(last(), 'select', 'tap tile pertama');
  tileEl(app.doc, S(), diff[1]).click();
  eq(last(), 'fail', 'pasangan beda gambar');
  await sleep(400);
  const pr = findPair(S());
  tileEl(app.doc, S(), pr[0]).click();
  eq(last(), 'select', 'tap tile pertama (lagi)');
  tileEl(app.doc, S(), pr[1]).click();
  eq(last(), 'match', 'match berhasil');
  eq(A.history.slice(-4).join(), 'select,fail,select,match', 'urutan sfx');
  await clickNewGame(); // hindari game over di tengah test berikutnya
});

await test('Audio toggle: efek suara & musik bisa dimatikan, tersimpan, dan benar-benar membisukan', async () => {
  const A = app.win.__ngonet.audio;
  const sfxBtn = app.doc.getElementById('sfxBtn'), musicBtn = app.doc.getElementById('musicBtn');
  sfxBtn.click();
  eq(sfxBtn.getAttribute('aria-pressed'), 'false', 'tombol sfx off');
  eq(JSON.parse(localStorage.getItem('ngonet:audio')).sfx, false, 'tersimpan');
  const n = A.history.length;
  const i = S().board.findIndex(Boolean);
  tileEl(app.doc, S(), i).click(); tileEl(app.doc, S(), i).click(); // pilih lalu batal
  eq(A.history.length, n, 'tidak boleh ada sfx saat dimatikan');
  sfxBtn.click();
  eq(sfxBtn.getAttribute('aria-pressed'), 'true', 'tombol sfx on lagi');
  musicBtn.click();
  eq(musicBtn.getAttribute('aria-pressed'), 'false', 'tombol musik off');
  eq(JSON.parse(localStorage.getItem('ngonet:audio')).music, false, 'musik off tersimpan');
  await sleep(400);
  assert(!A.musicPlaying, 'musik harus berhenti');
  musicBtn.click();
  eq(musicBtn.getAttribute('aria-pressed'), 'true', 'tombol musik on lagi');
});

await test('BGM: file termuat, loop, dan diputar setelah interaksi', async () => {
  const A = app.win.__ngonet.audio;
  const el = await A.preload();
  assert(el, 'BGM gagal dimuat');
  assert(el.loop, 'BGM harus loop');
  if (!(el.duration > 0)) await new Promise((r) => { el.addEventListener('loadedmetadata', r, { once: true }); setTimeout(r, 5000); });
  assert(el.duration > 30, `durasi BGM ${el.duration}`);
  await waitFor(() => A.musicPlaying, 5000).catch(() => {});
  assert(A.musicPlaying, 'BGM tidak berputar setelah interaksi');
  await sleep(900);
  assert(el.volume > 0.2, `volume BGM ${el.volume}`);
  return `durasi ${el.duration.toFixed(1)} dtk, volume ${el.volume.toFixed(2)}`;
});

await test('23–25. Mainkan 32 match beruntun → YOU WIN!, skor 5280, win counter +1, tombol New Game', async () => {
  await clickNewGame();
  const winsBefore = Number($id('wins').textContent);
  eq(winsBefore, Number(localStorage.getItem('ngonet:wins') || 0), 'penghitung tampil = tersimpan');
  const seq = solve(S());
  assert(seq, 'papan harus bisa diselesaikan');
  await playMoves(seq, seq.length, 60);
  eq(remaining(S()), 0, 'semua tile harus habis');
  eq(S().over, null, 'tidak game over');
  const modal = $id('winModal');
  await waitFor(() => !modal.hidden, 3000);
  assert($id('overModal').hidden, 'modal game over tidak boleh muncul');
  assert(/YOU\s*WIN!/.test($id('winTitle').getAttribute('aria-label')), 'teks YOU WIN!');
  assert(modal.querySelector('.logo'), 'nama NGONET tampil');
  eq(Number($id('winScore').textContent), 5280, 'skor akhir');
  eq(Number($id('winScore').textContent), scoreText(), 'skor akhir = skor tampil');
  eq($id('winNewGameBtn').textContent.trim(), 'New Game', 'tombol New Game');
  eq(Number($id('wins').textContent), winsBefore + 1, 'win counter +1');
  eq(Number(localStorage.getItem('ngonet:wins')), winsBefore + 1, 'win counter tersimpan');
  eq($id('winCount').textContent, `Kemenangan ke-${winsBefore + 1}`, 'teks kemenangan ke-N');
  assert($id('wins').parentElement.querySelector('svg.crown'), 'ikon mahkota');
  const oldInitial = boardSig(S().initial);
  await sleep(3300);
  assert($id('overModal').hidden, 'timer combo tidak boleh memicu game over setelah menang');
  $id('winNewGameBtn').click();
  assert(modal.hidden, 'modal tertutup');
  eq(scoreText(), 0, 'skor baru 0');
  eq(remaining(S()), 64, 'papan baru 64 tile');
  assert(boardSig(S().initial) !== oldInitial, 'susunan baru');
  eq(Number($id('wins').textContent), winsBefore + 1, 'New Game tidak menambah win counter');
  return `skor akhir 5280, wins ${winsBefore} → ${winsBefore + 1}`;
});

// ============================================================ UI / layout
async function layoutCheck(w, h) {
  const f = makeFrame(w, h);
  const { doc, win } = await loadApp(f);
  const se = doc.scrollingElement;
  assert(se.scrollWidth <= se.clientWidth, `horizontal scroll: ${se.scrollWidth} > ${se.clientWidth}`);
  const board = doc.getElementById('board').getBoundingClientRect();
  const tile = doc.querySelector('.tile').getBoundingClientRect();
  assert(board.left >= 0 && board.right <= w, 'papan keluar layar');
  assert(Math.abs(tile.width - tile.height) < 1, 'tile tidak persegi');
  const btn = doc.getElementById('newGameBtn').getBoundingClientRect();
  const bg = win.getComputedStyle(doc.body).backgroundColor;
  return { tile: tile.width, board: board.width, btnBottom: btn.bottom, btnH: btn.height, bg, docH: se.scrollHeight };
}
await test('31–34. Layout portrait 390×844: tanpa scroll horizontal, tile persegi & mudah disentuh, latar krem', async () => {
  const r = await layoutCheck(390, 844);
  assert(r.tile >= 36, `tile terlalu kecil: ${r.tile}px`);
  assert(r.btnBottom <= 844, 'tombol di luar layar');
  assert(r.btnH >= 44, 'tombol terlalu kecil');
  eq(r.bg, 'rgb(245, 240, 230)', 'warna latar #F5F0E6');
  assert(r.docH <= 844, `halaman perlu scroll vertikal: ${r.docH}`);
  return `tile ${r.tile.toFixed(1)}px, papan ${r.board.toFixed(0)}px`;
});
await test('Layout ponsel kecil 360×640: semua muat tanpa scroll', async () => {
  const r = await layoutCheck(360, 640);
  assert(r.btnBottom <= 640, 'tombol di luar layar');
  assert(r.docH <= 640, `perlu scroll vertikal: ${r.docH}`);
  assert(r.tile >= 30, `tile ${r.tile}`);
  return `tile ${r.tile.toFixed(1)}px`;
});
await test('Layout desktop 1280×800: papan di tengah dengan ukuran maksimal proporsional', async () => {
  const r = await layoutCheck(1280, 800);
  assert(r.board <= 600, 'papan melebihi ukuran maksimum');
  return `papan ${r.board.toFixed(0)}px`;
});

// ============================================================ PWA
await test('26. Manifest dapat dibaca & lengkap', async () => {
  const m = await (await fetch('../manifest.webmanifest')).json();
  eq(m.name, 'NGONET', 'name'); eq(m.short_name, 'NGONET', 'short_name');
  eq(m.display, 'standalone', 'display'); eq(m.background_color, '#F5F0E6', 'background_color');
  assert(m.start_url && m.theme_color, 'start_url / theme_color');
  for (const size of ['192x192', '512x512']) {
    const icons = m.icons.filter((i) => i.sizes === size);
    assert(icons.some((i) => i.purpose.includes('any')) && icons.some((i) => i.purpose.includes('maskable')), `ikon ${size} any+maskable`);
    for (const ic of icons) {
      const w = await new Promise((res) => { const im = new Image(); im.onload = () => res(`${im.naturalWidth}x${im.naturalHeight}`); im.onerror = () => res('error'); im.src = '../' + ic.src; });
      eq(w, size, `ukuran aktual ${ic.src}`);
    }
  }
});

await test('27. Service Worker terdaftar & aktif, cache berisi seluruh aset', async () => {
  assert('serviceWorker' in navigator, 'browser tidak mendukung SW');
  let reg = null;
  const t0 = performance.now();
  while (!reg && performance.now() - t0 < 15000) {
    reg = (await navigator.serviceWorker.getRegistrations()).find((r) => r.active) || null;
    if (!reg) await sleep(100);
  }
  assert(reg && reg.active, 'SW belum aktif');
  const keys = await caches.keys();
  const key = keys.find((k) => /^ngonet-v\d+$/.test(k));
  const mediaKey = keys.find((k) => k.startsWith('ngonet-media-'));
  assert(key, 'cache ngonet tidak ada');
  assert(mediaKey, 'cache media (BGM) tidak ada');
  const cache = await caches.open(key);
  const need = ['index.html', 'css/style.css', 'js/main.js', 'js/game.js', 'js/pathfinder.js', 'js/generator.js', 'js/audio.js', 'manifest.webmanifest', ...allTileSources()];
  const base = new URL('../', location.href);
  const missing = [];
  for (const p of need) if (!(await cache.match(new URL(p, base).href))) missing.push(p);
  eq(missing.length, 0, 'aset belum ter-cache: ' + missing.join(','));
  const bgm = await (await caches.open(mediaKey)).match(new URL(BGM_SRC, base).href);
  assert(bgm, 'BGM belum ter-cache');
  const size = (await bgm.blob()).size;
  assert(size > 1e6, `ukuran BGM di cache tidak wajar: ${size}`);
  return `${key} + ${mediaKey} (BGM ${(size / 1048576).toFixed(1)} MB), ${need.length + 1} aset dicek`;
});

await test('30. Tidak ada request eksternal saat gameplay', async () => {
  const entries = frame.contentWindow.performance.getEntriesByType('resource');
  const ext = entries.filter((e) => new URL(e.name).origin !== location.origin);
  eq(ext.length, 0, 'request eksternal: ' + ext.map((e) => e.name).join(','));
  return `${entries.length} request, semuanya same-origin`;
});

// ============================================================ ringkasan
const failed = results.filter((r) => !r.ok);
document.getElementById('summary').textContent = `${results.length - failed.length}/${results.length} lulus` + (failed.length ? ` — ${failed.length} GAGAL` : '');
document.title = failed.length ? 'FAIL' : 'PASS';
document.body.dataset.done = '1';
if (new URLSearchParams(location.search).has('report')) {
  fetch('report.php', { method: 'POST', body: JSON.stringify({ ua: navigator.userAgent, results }) }).catch(() => {});
}
