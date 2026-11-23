import { BASE_POINTS, COMBO_WINDOW_MS, SHUFFLE_FACTOR } from './config.js';

/**
 * Hitung combo dan poin untuk sebuah matching yang baru saja berhasil.
 * @param {number} prevCombo        combo sebelumnya (0 jika belum ada)
 * @param {number|null} lastMatchAt waktu matching sebelumnya selesai (ms), null jika belum ada
 * @param {number} now              waktu matching ini selesai (ms)
 */
export function scoreMatch(prevCombo, lastMatchAt, now) {
  const chained = lastMatchAt !== null && prevCombo > 0 && (now - lastMatchAt) <= COMBO_WINDOW_MS;
  const combo = chained ? prevCombo + 1 : 1;
  return { combo, points: BASE_POINTS * combo };
}

/** Penalti shuffle: newScore = Math.ceil(currentScore * 0.5), tidak pernah negatif. */
export function shufflePenalty(score) {
  return Math.max(0, Math.ceil(Math.max(0, score) * SHUFFLE_FACTOR));
}
