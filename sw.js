/* NGONET Service Worker
 *
 * Strategi:
 * - Install  : precache seluruh app shell + 48 aset tile + ikon + manifest.
 * - HTML/JS/CSS/manifest : network-first dengan batas waktu → selalu dapat versi terbaru
 *   saat online, fallback ke cache saat offline / koneksi lambat.
 * - Gambar   : cache-first + revalidasi di latar belakang (stale-while-revalidate),
 *   sehingga cepat dan tetap ter-update pada kunjungan berikutnya.
 * - Activate : hapus cache versi lama.
 * Naikkan CACHE_VERSION setiap rilis agar precache diperbarui.
 */
const CACHE_VERSION = 'ngonet-v1';
const NETWORK_TIMEOUT_MS = 3000;

const TILES = Array.from({ length: 48 }, (_, i) => `public/assets/onet/tiles/tile-${String(i + 1).padStart(2, '0')}.png`);
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/main.js',
  'js/config.js',
  'js/game.js',
  'js/pathfinder.js',
  'js/scoring.js',
  'js/assets.js',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  ...TILES,
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // cache: 'reload' memastikan file diambil dari jaringan, bukan HTTP cache lama.
    await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('ngonet-') && k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isImage(request, url) {
  return request.destination === 'image' || /\.(png|svg|jpe?g|webp)$/i.test(url.pathname);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await Promise.race([
      fetch(request, { cache: 'no-cache' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
    ]);
    if (response && response.ok) {
      cache.put(request, response.clone());
      return response;
    }
    // Server error (mis. 5xx) → pakai versi cache bila ada.
    const fallback = await cache.match(request, { ignoreSearch: true });
    return fallback || response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = (await cache.match('index.html')) || (await cache.match('./'));
      if (shell) return shell;
    }
    throw err;
  }
}

async function staleWhileRevalidate(event) {
  const { request } = event;
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, { ignoreSearch: true });
  const update = fetch(request)
    .then((response) => { if (response && response.ok) cache.put(request, response.clone()); return response; })
    .catch(() => null);
  if (cached) {
    event.waitUntil(update);
    return cached;
  }
  const fresh = await update;
  if (fresh) return fresh;
  return new Response('', { status: 504, statusText: 'Offline' });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // NGONET tidak memakai sumber eksternal

  if (isImage(request, url)) {
    event.respondWith(staleWhileRevalidate(event));
  } else {
    event.respondWith(networkFirst(request));
  }
});
