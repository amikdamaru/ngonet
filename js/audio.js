// Audio NGONET: background music (file MP3 lokal) + sound effect hasil sintesis Web Audio.
//
// - Browser melarang audio berbunyi sebelum ada interaksi pengguna, jadi semuanya baru
//   "dibuka" (unlock) pada sentuhan/klik/tombol pertama.
// - BGM diambil sekali lewat fetch (melalui Service Worker → tersedia offline), lalu diputar
//   dari blob URL agar tidak bergantung pada HTTP Range request.
// - BGM dijeda saat aplikasi tidak terlihat (pindah aplikasi / layar mati) dan dilanjutkan lagi.
// - Sound effect disintesis (tanpa file), ringan dan langsung tersedia offline.

export const BGM_SRC = 'public/assets/onet/audio/bgm.mp3';
const SETTINGS_KEY = 'ngonet:audio';
const BGM_VOLUME = 0.35;
const SFX_VOLUME = 0.6;

function loadSettings() {
  try {
    const s = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}');
    return { music: s.music !== false, sfx: s.sfx !== false };
  } catch { return { music: true, sfx: true }; }
}
function saveSettings(s) {
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* abaikan */ }
}

export function createAudio() {
  const settings = loadSettings();
  const listeners = new Set();
  let ctx = null;
  let master = null;
  let unlocked = false;
  let bgm = null;
  let bgmLoading = null;
  let fadeTimer = 0;

  // ------------------------------------------------------------ Web Audio
  function ensureContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = SFX_VOLUME;
    master.connect(ctx.destination);
    return ctx;
  }

  /** Satu nada dengan envelope attack/decay eksponensial. */
  function tone({ freq, to = freq, type = 'sine', start = 0, dur = 0.2, gain = 0.3, attack = 0.005, filter = null }) {
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur * 0.8);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const history = []; // sfx yang benar-benar dibunyikan (untuk debugging/test)
  function canPlaySfx(name) {
    if (!settings.sfx || !unlocked || !ensureContext()) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    history.push(name);
    if (history.length > 20) history.shift();
    return true;
  }

  // Tangga nada pentatonik untuk denting match (naik seiring combo).
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const noteHz = (semi) => 659.25 * Math.pow(2, semi / 12); // dasar E5

  const sfx = {
    /** Pilih tile pertama: "pop" kecil yang lembut. */
    select() {
      if (!canPlaySfx('select')) return;
      tone({ freq: 520, to: 860, type: 'triangle', dur: 0.09, gain: 0.22 });
      tone({ freq: 1040, type: 'sine', start: 0.01, dur: 0.06, gain: 0.05 });
    },
    /** Match berhasil: denting dua nada seperti lonceng; makin tinggi saat combo naik. */
    match(combo = 1) {
      if (!canPlaySfx('match')) return;
      const step = Math.min(Math.max(combo, 1) - 1, PENTA.length - 3);
      const a = noteHz(PENTA[step]);
      const b = noteHz(PENTA[step + 2]);
      tone({ freq: a, dur: 0.32, gain: 0.26 });
      tone({ freq: a * 2, dur: 0.18, gain: 0.05 });            // harmonik ringan
      tone({ freq: b, start: 0.08, dur: 0.45, gain: 0.26 });
      tone({ freq: b * 2, start: 0.08, dur: 0.22, gain: 0.05 });
    },
    /** Match gagal: "bonk" rendah yang singkat, tidak mengagetkan. */
    fail() {
      if (!canPlaySfx('fail')) return;
      tone({ freq: 240, to: 150, type: 'square', dur: 0.16, gain: 0.12, filter: 900 });
      tone({ freq: 180, to: 110, type: 'triangle', start: 0.07, dur: 0.2, gain: 0.16 });
    },
  };

  // ------------------------------------------------------------ BGM
  function loadBgm() {
    if (bgmLoading) return bgmLoading;
    bgmLoading = fetch(BGM_SRC)
      .then((r) => { if (!r.ok) throw new Error(`BGM ${r.status}`); return r.blob(); })
      .then((blob) => {
        bgm = new Audio();
        bgm.src = URL.createObjectURL(blob);
        bgm.loop = true;
        bgm.preload = 'auto';
        bgm.volume = 0;
        return bgm;
      })
      .catch((err) => { console.warn('[NGONET] BGM gagal dimuat:', err); bgmLoading = null; return null; });
    return bgmLoading;
  }

  function fadeTo(target, ms = 600, then) {
    window.clearInterval(fadeTimer);
    if (!bgm) return;
    const from = bgm.volume;
    const t0 = performance.now();
    fadeTimer = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      bgm.volume = Math.max(0, Math.min(1, from + (target - from) * k));
      if (k >= 1) { window.clearInterval(fadeTimer); then?.(); }
    }, 30);
  }

  async function playMusic() {
    if (!settings.music || !unlocked || document.visibilityState === 'hidden') return;
    const el = await loadBgm();
    if (!el || !settings.music || document.visibilityState === 'hidden') return;
    try {
      await el.play();
      fadeTo(BGM_VOLUME, 800);
    } catch { /* masih diblokir browser: dicoba lagi pada interaksi berikutnya */ }
  }

  function pauseMusic(fade = true) {
    if (!bgm || bgm.paused) return;
    if (fade) fadeTo(0, 250, () => bgm.pause());
    else { window.clearInterval(fadeTimer); bgm.pause(); }
  }

  // ------------------------------------------------------------ unlock & lifecycle
  function unlock() {
    if (!unlocked) {
      unlocked = true;
      ensureContext();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (settings.music && (!bgm || bgm.paused)) playMusic();
  }

  // Event yang dihitung sebagai "user activation" oleh browser.
  for (const type of ['pointerup', 'touchend', 'keydown', 'click']) {
    document.addEventListener(type, unlock, { capture: true, passive: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      pauseMusic(false);
      if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    } else if (unlocked) {
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      playMusic();
    }
  });

  function emit() { listeners.forEach((fn) => fn({ ...settings })); }

  return {
    sfx,
    get settings() { return { ...settings }; },
    get musicPlaying() { return !!bgm && !bgm.paused; },
    get history() { return history.slice(); },
    onChange(fn) { listeners.add(fn); fn({ ...settings }); },
    /** Muat BGM di latar belakang (setelah game tampil) agar siap saat sentuhan pertama. */
    preload() { return loadBgm(); },
    setMusic(on) {
      settings.music = !!on;
      saveSettings(settings);
      if (settings.music) playMusic(); else pauseMusic();
      emit();
    },
    setSfx(on) {
      settings.sfx = !!on;
      saveSettings(settings);
      emit();
    },
  };
}
