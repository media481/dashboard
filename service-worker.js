// Amiru Repository - Service Worker
// Strategi:
//  - ASET BER-HASH (css/js dengan ?v=<hash isi file>): CACHE-FIRST. URL-nya berubah kalau isi
//    berubah (lihat scripts/stamp-versions.mjs), jadi salinan di cache tidak pernah basi.
//    Dilayani langsung dari cache tanpa menunggu jaringan (cepat, juga saat sinyal jelek),
//    disimpan di cache terpisah (ASSET_CACHE) yang TIDAK ikut terhapus saat CACHE_NAME dinaikkan.
//  - File lain (index.html, manifest, ikon): NETWORK-FIRST agar update selalu terambil saat
//    online, fallback ke cache saat offline.
// Request ke domain luar (Supabase, CDN, Google Fonts) tidak di-cache, langsung ke jaringan.

// Cache "shell": naikkan versinya tiap rilis seperti biasa (isinya diganti total).
const CACHE_NAME = 'amiru-repo-cache-v158';
// Cache aset ber-hash: bertahan lintas rilis. Isinya dirapikan otomatis saat activate
// (hanya URL yang masih dirujuk index.html terbaru yang disimpan). Naikkan angkanya
// hanya kalau ingin membuang SEMUA aset ber-hash (jarang perlu).
const ASSET_CACHE = 'amiru-assets-v1';

// Aset ber-hash (css/js + modul lazy + css lazy) TIDAK didaftar di sini: daftarnya dibaca
// otomatis dari index.html (<link>, <script src>, dan <script id="moduleVersions">),
// jadi menambah modul/CSS baru tidak perlu mengubah file ini.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
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

// ===== ASET BER-HASH =====
// Aset ber-hash = same-origin, di bawah /css/ atau /js/, berakhiran .css/.js, dengan ?v=<hex>.
function isHashedAsset(url) {
  const v = url.searchParams.get('v');
  return !!v && /^[0-9a-f]{6,}$/.test(v) &&
    /\.(?:css|js)$/.test(url.pathname) &&
    (url.pathname.includes('/css/') || url.pathname.includes('/js/'));
}

// Baca index.html -> daftar URL aset ber-hash yang sedang dipakai (Set string URL absolut).
// Sumber: atribut href/src ke css/ atau js/ ber-?v=, plus <script id="moduleVersions">
// (kunci 'nama' -> js/modules/nama.min.js, kunci 'css:nama' -> css/nama.min.css).
function extractHashedAssetUrls(html, base) {
  const out = new Set();
  const add = (path, v) => {
    if (!/^[0-9a-f]{6,}$/.test(v || '')) return;
    out.add(new URL(path + '?v=' + v, base).href);
  };
  const re = /(?:href|src)="((?:css|js)\/[A-Za-z0-9._\/-]+\.(?:css|js))\?v=([0-9a-f]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) add(m[1], m[2]);
  const tag = html.match(/<script id="moduleVersions" type="application\/json">([\s\S]*?)<\/script>/);
  if (tag) {
    try {
      const versions = JSON.parse(tag[1]);
      for (const key of Object.keys(versions)) {
        if (key.indexOf('css:') === 0) add('css/' + key.slice(4) + '.min.css', versions[key]);
        else add('js/modules/' + key + '.min.js', versions[key]);
      }
    } catch (e) {
      console.warn('[SW] moduleVersions tidak bisa dibaca:', e);
    }
  }
  return out;
}

// Unduh aset ber-hash yang belum ada di ASSET_CACHE. Gagal sebagian tidak apa-apa
// (nanti ter-cache sendiri saat dipakai); tidak pernah membatalkan install.
async function precacheHashedAssets(urls) {
  const cache = await caches.open(ASSET_CACHE);
  await Promise.all(Array.from(urls).map(async (href) => {
    try {
      if (await cache.match(href, { ignoreVary: true })) return;
      const res = await fetch(href);
      if (res && res.ok && res.type === 'basic') await cache.put(href, res);
    } catch (err) {
      console.warn('[SW] Gagal precache aset:', href, err);
    }
  }));
}

// Buang aset ber-hash lama yang sudah tidak dirujuk index.html terbaru.
async function pruneHashedAssets(keep) {
  if (!keep || keep.size < 5) return; // index.html tidak terbaca/tidak wajar -> jangan buang apa pun
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.filter((req) => !keep.has(req.url)).map((req) => cache.delete(req)));
}

async function readCachedIndexUrls() {
  const shell = await caches.open(CACHE_NAME);
  const res = await shell.match('./index.html');
  if (!res) return null;
  return extractHashedAssetUrls(await res.text(), self.registration.scope);
}

const OFFLINE_RESPONSE = () => new Response('Tidak bisa terhubung ke server. Periksa koneksi lalu muat ulang.', {
  status: 503,
  statusText: 'Service Unavailable',
  headers: { 'Content-Type': 'text/plain; charset=utf-8' }
});

// Cache-first: cocokkan URL PERSIS (termasuk ?v=). Tidak pakai ignoreSearch, karena justru
// hash di URL yang menjamin isinya benar.
async function cacheFirstHashed(req) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    // type 'basic' = same-origin; jangan simpan 404/5xx atau respons tak lazim.
    if (res && res.ok && res.type === 'basic') await cache.put(req, res.clone());
    return res;
  } catch (err) {
    // Offline dan belum pernah ter-cache: coba versi hash lain dari file yang sama
    // daripada gagal total (lebih baik ada daripada kosong saat offline).
    const other = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
    return other || OFFLINE_RESPONSE();
  }
}


// ===== INSTALL =====
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // 1) Shell (non-hash). cache:'reload' = lewati HTTP cache browser supaya salinan segar.
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' })));
    } catch (err) {
      console.warn('[SW] Gagal precache sebagian file:', err);
    }
    // 2) Aset ber-hash: daftar diturunkan dari index.html yang baru tersimpan.
    try {
      const urls = await readCachedIndexUrls();
      if (urls && urls.size) await precacheHashedAssets(urls);
      else console.warn('[SW] Tidak ada aset ber-hash terbaca dari index.html.');
    } catch (err) {
      console.warn('[SW] Gagal precache aset ber-hash:', err);
    }
  })());
  self.skipWaiting();
});

// ===== ACTIVATE =====
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME && key !== ASSET_CACHE)
        .map((key) => caches.delete(key))
    );
    try {
      await pruneHashedAssets(await readCachedIndexUrls());
    } catch (err) {
      console.warn('[SW] Gagal merapikan cache aset:', err);
    }
    await self.clients.claim();
  })());
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

  // Aset ber-hash (css/js ?v=<hash>): cache-first, isi tidak pernah berubah untuk URL yang sama.
  if (isHashedAsset(url)) {
    event.respondWith(cacheFirstHashed(req));
    return;
  }

  // Network-first untuk sisanya (html, manifest, icon, dan css/js tanpa ?v=)
  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        // Hanya simpan response sukses ke cache (jangan cache 404/5xx)
        if (networkResponse && networkResponse.ok) {
          const responseClone = networkResponse.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(req, responseClone)));
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
        return OFFLINE_RESPONSE();
      })
  );
});

// Hanya dipakai tes Node (tests/test-service-worker.js); di browser `module` tidak ada.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isHashedAsset, extractHashedAssetUrls, cacheFirstHashed, pruneHashedAssets, APP_SHELL, CACHE_NAME, ASSET_CACHE };
}
