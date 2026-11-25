import { BASE_POINTS, COMBO_WINDOW_MS } from './config.js';

/** Apakah jendela combo sudah lewat (combo putus). Sebelum match pertama tidak ada batas waktu. */
export function comboExpired(lastMatchAt, now) {
  return lastMatchAt !== null && (now - lastMatchAt) > COMBO_WINDOW_MS;
}

/**
 * Hitung combo dan poin untuk sebuah matching yang baru saja berhasil.
 * @param {number} prevCombo        combo sebelumnya (0 jika belum ada)
 * @param {number|null} lastMatchAt waktu matching sebelumnya selesai (ms), null jika belum ada
 * @param {number} now              waktu matching ini selesai (ms)
 */
export function scoreMatch(prevCombo, lastMatchAt, now) {
  const chained = lastMatchAt !== null && prevCombo > 0 && !comboExpired(lastMatchAt, now);
  const combo = chained ? prevCombo + 1 : 1;
  return { combo, points: BASE_POINTS * combo };
}
