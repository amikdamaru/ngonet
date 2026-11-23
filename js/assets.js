// Memuat seluruh gambar tile sebelum permainan dimulai.
export function preloadImages(sources, onProgress) {
  let done = 0;
  const total = sources.length;
  onProgress?.(0, total);
  return Promise.all(sources.map((src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = async () => {
      try { if (img.decode) await img.decode(); } catch { /* sudah dimuat; decode opsional */ }
      done++;
      onProgress?.(done, total);
      resolve(img);
    };
    img.onerror = () => reject(new Error(src.split('/').pop()));
    img.src = src;
  })));
}
