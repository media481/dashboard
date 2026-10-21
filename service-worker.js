// Amiru Repository - Service Worker
// Strategi: network-first untuk file app (agar update selalu terambil saat online),
// fallback ke cache saat offline. Request ke domain luar (Supabase, CDN, Google Fonts)
// tidak di-cache, dibiarkan langsung ke jaringan.

const CACHE_NAME = 'amiru-repo-cache-v150';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.min.css',
  './css/rekap-infografis.min.css',
  './css/snapshot.min.css',
  './css/jadwal-tamu.min.css',
  './css/assets.min.css',
  './css/hotel.min.css',
  './css/detail-program.min.css',
  './css/telegram.min.css',
  './css/kepulangan.min.css',
  './css/rooming.min.css',
  './css/ig-scheduler.min.css',
  './css/user-akses.min.css',
  './css/keuangan.min.css',
  './css/crosscheck.min.css',
  './js/app.min.js',
  './js/modules/ig-scheduler.min.js',
  './js/modules/crosscheck.min.js',
  './js/modules/dokumen.min.js',
  './js/modules/kepulangan.min.js',
  './js/modules/manifest.min.js',
  './js/modules/rooming.min.js',
  './js/modules/pengaturan-user.min.js',
  './js/modules/telegram.min.js',
  './js/modules/snapshot.min.js',
  './js/modules/assets.min.js',
  './js/modules/pembayaran.min.js',
  './js/modules/audit-nota.min.js',
  './js/modules/nota.min.js',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './assets/logo-amirutour.png'
];

// ===== INSTALL =====
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // cache:'reload' = lewati HTTP cache browser saat precache, supaya salinan
      // yang disimpan selalu segar (css/js sekarang diberi Cache-Control panjang).
      return cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))).catch((err) => {
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
        // Hanya simpan response sukses ke cache (jangan cache 404/5xx)
        if (networkResponse && networkResponse.ok) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        // ignoreSearch: css/js di index.html kini berbentuk ?v=<hash>, sedangkan
        // APP_SHELL menyimpan URL tanpa query -- tanpa ini fallback offline meleset.
        const cachedResponse = await caches.match(req, { ignoreSearch: true });
        if (cachedResponse) return cachedResponse;
        // Fallback terakhir untuk navigasi halaman saat offline total
        if (req.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        // PENTING: respondWith() TIDAK boleh menerima undefined, kalau tidak
        // Chrome menampilkan ERR_INVALID_RESPONSE. Selalu kembalikan Response valid.
        return new Response('Tidak bisa terhubung ke server. Periksa koneksi lalu muat ulang.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
  );
});
