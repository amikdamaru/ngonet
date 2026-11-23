// Controller UI NGONET: menghubungkan state permainan (game.js) dengan DOM.
import { COLS, ROWS, PAIRS, COMBO_WINDOW_MS, tileSrc, allTileSources } from './config.js';
import {
  createGame, tryMatch, shuffleBoard, remaining, isWon, hasAvailableMove,
  posOf, serialize, deserialize,
} from './game.js';
import { preloadImages } from './assets.js';

const STORAGE_KEY = 'ngonet:game:v1';
const BEST_KEY = 'ngonet:best';

const $ = (id) => document.getElementById(id);
const els = {
  loader: $('loader'), loadBar: $('loadBar'), loadText: $('loadText'), loadProgress: $('loadProgress'), retryBtn: $('retryBtn'),
  app: $('app'), board: $('board'), boardWrap: $('boardWrap'), links: $('links'),
  score: $('score'), scorePop: $('scorePop'), pairs: $('pairs'), best: $('best'),
  combo: $('combo'), comboText: $('comboText'), comboBar: $('comboBar'),
  notice: $('notice'), shuffleBtn: $('shuffleBtn'), restartBtn: $('restartBtn'),
  confirmModal: $('confirmModal'), confirmYes: $('confirmYes'), confirmNo: $('confirmNo'),
  winModal: $('winModal'), winScore: $('winScore'), winBest: $('winBest'), playAgainBtn: $('playAgainBtn'), confetti: $('confetti'),
};

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => motionQuery.matches;

// Durasi animasi (ms). State permainan dikomit seketika; animasi hanya visual.
const T = {
  get link() { return reduced() ? 160 : 300; },
  get remove() { return reduced() ? 0 : 260; },
  get invalid() { return reduced() ? 220 : 340; },
  get shuffle() { return reduced() ? 0 : 380; },
};

let state = null;
let selected = null;           // indeks papan tile yang sedang dipilih
let gen = 0;                   // generasi permainan: callback lama diabaikan setelah restart
let shuffling = false;         // kunci input singkat selama animasi shuffle
let comboTimer = 0;
const tileEls = new Map();     // tile.id -> elemen

// ---------------------------------------------------------------- storage
const store = {
  get(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
  set(key, val) { try { window.localStorage.setItem(key, val); } catch { /* abaikan */ } },
  del(key) { try { window.localStorage.removeItem(key); } catch { /* abaikan */ } },
};
const getBest = () => Math.max(0, parseInt(store.get(BEST_KEY) || '0', 10) || 0);
function save() {
  if (!state) return;
  if (isWon(state)) store.del(STORAGE_KEY); else store.set(STORAGE_KEY, serialize(state));
}
function loadSaved() {
  const raw = store.get(STORAGE_KEY);
  if (!raw) return null;
  try { return deserialize(raw); } catch { return null; }
}

// ---------------------------------------------------------------- helpers
function restartAnim(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // reflow agar animasi bisa diulang
  el.classList.add(cls);
}
const later = (fn, ms) => {
  const g = gen;
  return window.setTimeout(() => { if (g === gen) fn(); }, ms);
};

// ---------------------------------------------------------------- render
function createTileEl(tile) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tile';
  btn.dataset.id = String(tile.id);
  btn.setAttribute('aria-label', `Tile ${tile.type}`);
  const img = document.createElement('img');
  img.src = tileSrc(tile.type);
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  btn.appendChild(img);
  return btn;
}

function placeTile(el, index) {
  const { r, c } = posOf(state, index);
  el.dataset.index = String(index);
  el.style.gridRow = String(r + 1);
  el.style.gridColumn = String(c + 1);
}

function renderBoard(animateIn) {
  els.board.textContent = '';
  els.links.textContent = '';
  tileEls.clear();
  const frag = document.createDocumentFragment();
  state.board.forEach((tile, i) => {
    if (!tile) return;
    const el = createTileEl(tile);
    placeTile(el, i);
    if (animateIn && !reduced()) {
      const { r, c } = posOf(state, i);
      el.classList.add('enter');
      el.style.animationDelay = `${(r + c) * 14}ms`;
      el.addEventListener('animationend', () => { el.classList.remove('enter'); el.style.animationDelay = ''; }, { once: true });
    }
    tileEls.set(tile.id, el);
    frag.appendChild(el);
  });
  els.board.appendChild(frag);
}

function updateStats() {
  els.score.textContent = String(state.score);
  els.pairs.textContent = String(remaining(state) / 2);
  els.best.textContent = String(getBest());
}

function popScore(text, minus) {
  els.scorePop.textContent = text;
  els.scorePop.classList.toggle('minus', !!minus);
  restartAnim(els.scorePop, 'show');
  restartAnim(els.score, 'bump');
}

function showCombo(combo) {
  window.clearTimeout(comboTimer);
  if (combo < 2) { hideCombo(); return; }
  els.comboText.textContent = `COMBO x${combo}`;
  els.combo.classList.add('active');
  restartAnim(els.comboText, 'bump');
  restartAnim(els.comboBar, 'run');
  comboTimer = window.setTimeout(hideCombo, COMBO_WINDOW_MS);
}
function hideCombo() {
  window.clearTimeout(comboTimer);
  els.combo.classList.remove('active');
  els.comboBar.classList.remove('run');
}

function setNotice(text) {
  els.notice.textContent = text || '';
  els.shuffleBtn.classList.toggle('attention', !!text);
}
function checkDeadlock() {
  if (remaining(state) > 0 && !hasAvailableMove(state)) {
    setNotice('Tidak ada pasangan yang bisa dihubungkan. Tekan Shuffle.');
  } else {
    setNotice('');
  }
}

// ---------------------------------------------------------------- garis penghubung
function boardMetrics() {
  const cs = window.getComputedStyle(els.board);
  const w = els.board.clientWidth;
  const h = els.board.clientHeight;
  const padX = parseFloat(cs.paddingLeft) || 0;
  const padY = parseFloat(cs.paddingTop) || 0;
  const gapX = parseFloat(cs.columnGap) || 0;
  const gapY = parseFloat(cs.rowGap) || 0;
  const pitchX = (w - 2 * padX + gapX) / COLS;
  const pitchY = (h - 2 * padY + gapY) / ROWS;
  return { w, h, padX, padY, pitchX, pitchY, tileW: pitchX - gapX, tileH: pitchY - gapY };
}

/** Titik tengah sel (r,c). Sel virtual (-1 atau rows/cols) dipetakan ke tengah area padding papan. */
function cellCenter(m, r, c) {
  const x = c < 0 ? m.padX / 2 : c >= COLS ? m.w - m.padX / 2 : m.padX + c * m.pitchX + m.tileW / 2;
  const y = r < 0 ? m.padY / 2 : r >= ROWS ? m.h - m.padY / 2 : m.padY + r * m.pitchY + m.tileH / 2;
  return { x, y };
}

function drawPath(points) {
  const m = boardMetrics();
  els.links.setAttribute('viewBox', `0 0 ${m.w} ${m.h}`);
  const pts = points.map((p) => cellCenter(m, p.r, p.c));
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);

  const NS = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(NS, 'g');
  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
  line.setAttribute('class', 'link-line draw');
  line.style.strokeWidth = `${Math.max(3, m.tileW * 0.09).toFixed(1)}px`;
  line.style.strokeDasharray = String(len);
  line.style.strokeDashoffset = String(len);
  g.appendChild(line);
  const rDot = Math.max(3, m.tileW * 0.09);
  for (const p of [pts[0], pts[pts.length - 1]]) {
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', p.x.toFixed(1));
    dot.setAttribute('cy', p.y.toFixed(1));
    dot.setAttribute('r', rDot.toFixed(1));
    dot.setAttribute('class', 'link-dot');
    g.appendChild(dot);
  }
  els.links.appendChild(g);
  window.setTimeout(() => g.remove(), 700);
}

// ---------------------------------------------------------------- interaksi tile
function elAtIndex(i) {
  const t = state.board[i];
  return t ? tileEls.get(t.id) : null;
}

function select(i) {
  selected = i;
  elAtIndex(i)?.classList.add('selected');
}
function deselect() {
  if (selected !== null) elAtIndex(selected)?.classList.remove('selected');
  selected = null;
}

function onTileActivate(index, id) {
  if (shuffling || !state) return;
  const tile = state.board[index];
  if (!tile || tile.id !== id) return; // tile sudah hilang / elemen basi

  if (selected === null) { select(index); return; }
  if (selected === index) { deselect(); return; } // tap tile yang sama: batalkan pilihan
  attemptMatch(selected, index);
}

function attemptMatch(i, j) {
  const elA = elAtIndex(i);
  const elB = elAtIndex(j);
  const now = performance.now(); // waktu matching selesai = patokan combo
  const res = tryMatch(state, i, j, now);
  selected = null;

  if (!res.ok) {
    for (const el of [elA, elB]) {
      if (!el) continue;
      el.classList.remove('selected');
      restartAnim(el, 'invalid');
      window.setTimeout(() => el.classList.remove('invalid'), T.invalid);
    }
    return;
  }

  // Sukses: state sudah dikomit. Sisanya visual.
  for (const el of [elA, elB]) {
    el.classList.remove('selected', 'invalid');
    el.classList.add('matched');
    el.disabled = true;
  }
  drawPath(res.path.points);
  const ids = res.tiles.map((t) => t.id);
  window.setTimeout(() => {
    for (const el of [elA, elB]) el.classList.add('removing');
    window.setTimeout(() => {
      elA.remove(); elB.remove();
      ids.forEach((id) => { if (tileEls.get(id) === elA || tileEls.get(id) === elB) tileEls.delete(id); });
    }, T.remove);
  }, T.link);

  updateStats();
  popScore(`+${res.points}`);
  showCombo(res.combo);
  save();

  if (isWon(state)) {
    hideCombo();
    setNotice('');
    later(showWin, T.link + T.remove + 150);
  } else {
    checkDeadlock();
  }
}

// ---------------------------------------------------------------- shuffle
function onShuffle() {
  if (shuffling || !state || remaining(state) === 0) return;
  deselect();
  const before = state.score;

  // FLIP: catat posisi awal
  const first = new Map();
  if (!reduced()) {
    state.board.forEach((t) => { if (t) first.set(t.id, tileEls.get(t.id).getBoundingClientRect()); });
  }

  shuffleBoard(state);
  state.board.forEach((t, i) => { if (t) placeTile(tileEls.get(t.id), i); });

  if (!reduced()) {
    const moved = [];
    state.board.forEach((t) => {
      if (!t) return;
      const el = tileEls.get(t.id);
      const a = first.get(t.id);
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (!dx && !dy) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      moved.push(el);
    });
    void els.board.offsetWidth;
    for (const el of moved) {
      el.style.transition = `transform ${T.shuffle}ms cubic-bezier(.35,.9,.3,1)`;
      el.style.transform = '';
    }
    shuffling = true;
    window.setTimeout(() => {
      for (const el of moved) el.style.transition = '';
      shuffling = false;
    }, T.shuffle + 20);
  }

  hideCombo();
  updateStats();
  if (before > 0) popScore(`−${before - state.score}`, true);
  save();
  checkDeadlock();
}

// ---------------------------------------------------------------- restart & victory
function newGame() {
  gen++;
  shuffling = false;
  selected = null;
  state = createGame();
  hideCombo();
  setNotice('');
  renderBoard(true);
  updateStats();
  save();
  checkDeadlock();
}

function openModal(modal, focusEl) {
  modal.hidden = false;
  focusEl?.focus({ preventScroll: true });
}
function closeModal(modal) { modal.hidden = true; }

function showWin() {
  const final = state.score;
  const prevBest = getBest();
  const isBest = final > prevBest;
  if (isBest) store.set(BEST_KEY, String(final));
  store.del(STORAGE_KEY);
  els.winScore.textContent = String(final);
  els.winBest.textContent = isBest && final > 0 ? 'Rekor baru!' : `Best: ${Math.max(prevBest, final)}`;
  updateStats();

  els.confetti.textContent = '';
  if (!reduced()) {
    const colors = ['#C89F75', '#EBD7BD', '#E5DCCB', '#A97F55', '#FFFCF5', '#D9B38C'];
    for (let k = 0; k < 28; k++) {
      const i = document.createElement('i');
      i.style.left = `${Math.random() * 100}%`;
      i.style.background = colors[k % colors.length];
      i.style.animationDuration = `${1.6 + Math.random() * 1.6}s`;
      i.style.animationDelay = `${Math.random() * 0.6}s`;
      i.style.setProperty('--dx', `${(Math.random() - 0.5) * 120}px`);
      i.style.setProperty('--rot', `${(Math.random() > 0.5 ? 1 : -1) * (180 + Math.random() * 360)}deg`);
      const s = 7 + Math.random() * 7;
      i.style.width = `${s}px`; i.style.height = `${s}px`;
      els.confetti.appendChild(i);
    }
  }
  openModal(els.winModal, els.playAgainBtn);
}

// ---------------------------------------------------------------- event binding
function bindEvents() {
  els.board.addEventListener('click', (e) => {
    const el = e.target.closest('.tile');
    if (!el || el.disabled) return;
    onTileActivate(Number(el.dataset.index), Number(el.dataset.id));
  });
  els.board.addEventListener('contextmenu', (e) => e.preventDefault());

  els.shuffleBtn.addEventListener('click', onShuffle);
  els.restartBtn.addEventListener('click', () => openModal(els.confirmModal, els.confirmNo));
  els.confirmNo.addEventListener('click', () => closeModal(els.confirmModal));
  els.confirmYes.addEventListener('click', () => { closeModal(els.confirmModal); newGame(); });
  els.confirmModal.addEventListener('click', (e) => { if (e.target === els.confirmModal) closeModal(els.confirmModal); });
  els.playAgainBtn.addEventListener('click', () => { closeModal(els.winModal); els.confetti.textContent = ''; newGame(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.confirmModal.hidden) closeModal(els.confirmModal);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
}

// ---------------------------------------------------------------- service worker
function registerSW() {
  const secure = window.isSecureContext;
  if (!('serviceWorker' in navigator) || !secure) return;
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('[NGONET] SW gagal didaftarkan:', err));
}

// ---------------------------------------------------------------- start
async function start() {
  registerSW();
  const sources = allTileSources();
  els.loadProgress.setAttribute('aria-valuemax', String(sources.length));
  els.retryBtn.hidden = true;
  els.loadText.textContent = 'Memuat aset…';
  try {
    await preloadImages(sources, (done, total) => {
      els.loadBar.style.width = `${(done / total) * 100}%`;
      els.loadProgress.setAttribute('aria-valuenow', String(done));
      els.loadText.textContent = `Memuat aset… ${done}/${total}`;
    });
  } catch (err) {
    els.loadText.textContent = `Gagal memuat aset (${err.message}). Periksa koneksi lalu coba lagi.`;
    els.retryBtn.hidden = false;
    return;
  }

  state = loadSaved() || createGame();
  bindEvents();
  els.loader.hidden = true;
  els.app.hidden = false;
  renderBoard(true);
  updateStats();
  save();
  checkDeadlock();
}

els.retryBtn.addEventListener('click', () => window.location.reload());
start();

// Untuk debugging/test di browser (tidak dipakai oleh gameplay).
window.__ngonet = {
  get state() { return state; },
  get selected() { return selected; },
  PAIRS,
};
