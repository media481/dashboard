// Amiru Repository - Service Worker
// Strategi: network-first untuk file app (agar update selalu terambil saat online),
// fallback ke cache saat offline. Request ke domain luar (Supabase, CDN, Google Fonts)
// tidak di-cache, dibiarkan langsung ke jaringan.

const CACHE_NAME = 'amiru-repo-cache-v15';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

// ===== INSTALL =====
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        console.warn('[SW] Gagal precache sebagian file:', err);
      });
    })
  );
  self.skipWaiting();
});

// ===== ACTIVATE =====
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// ===== FETCH =====
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Hanya tangani GET request
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Jangan campuri request ke domain lain (Supabase, CDN font/icon, dsb)
  // biarkan browser yang menangani langsung ke jaringan.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Network-first untuk file same-origin (html, css, js, manifest, icon)
  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(req, responseClone);
        });
        return networkResponse;
      })
      .catch(() => {
        return caches.match(req).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          // Fallback terakhir untuk navigasi halaman saat offline total
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
