/* ============================================================
   SERVICE WORKER — Buku Keuangan Karang Taruna
   Cuma nge-cache "app shell" (HTML/CSS/JS/ikon) supaya aplikasi
   tetap bisa dibuka walau sinyal jelek/offline. Data (Supabase)
   TIDAK di-cache di sini — selalu ambil langsung dari jaringan,
   supaya saldo/anggota/dll yang ditampilkan selalu data terbaru.

   NAIKKAN CACHE_VERSION setiap kali index.html/style.css/js/*
   diupdate, supaya HP pengguna otomatis ambil versi baru.
   ============================================================ */
const CACHE_VERSION = 'v48';
const CACHE_NAME = `kt-shell-${CACHE_VERSION}`;

// App awalnya 1 file besar (script.js, sudah dihapus dari repo), lalu
// dipecah jadi banyak file per modul di folder js/, lalu digabung+diminify
// jadi satu file js/app.bundle.min.js untuk production (lihat index.html) —
// yang di-precache di sini cukup hasil bundle-nya, bukan file sumbernya.
const APP_SHELL = [
  './',
  './index.html',
  './style.min.css',
  './js/app.bundle.min.js',
  './js/sw-register.js',
  './vendor/supabase.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/lucide-icons.local.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // {cache:'reload'} supaya fetch awal ini juga tidak diam-diam diambil dari
      // HTTP cache browser/CDN (lihat penjelasan lengkap di listener 'fetch' di bawah).
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n.startsWith('kt-shell-') && n !== CACHE_NAME)
             .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Cuma tangani GET same-origin. Request ke Supabase, font Google,
  // CDN supabase-js, dll dibiarkan lewat jaringan seperti biasa
  // (tidak di-cache) supaya data selalu fresh.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  // Network-first untuk app shell: kalau online, selalu pakai versi
  // terbaru dari server + update cache. Kalau offline, baru fallback
  // ke cache supaya aplikasi tetap bisa dibuka.
  //
  // CATATAN PENTING: `fetch(req)` biasa TETAP BISA diam-diam dijawab dari
  // HTTP cache bawaan browser/CDN (bukan Cache Storage kita), tergantung
  // header Cache-Control dari hosting — jadi walau kode di sini sudah
  // "network-first", device tertentu masih bisa dapat file lama beberapa
  // saat kalau layer cache HTTP itu belum kadaluarsa. `cache:'no-store'`
  // memaksa permintaan ini betul-betul ke jaringan, tidak boleh dijawab
  // dari cache manapun selain Cache Storage kita sendiri sebagai fallback.
  // FALLBACK TERAKHIR: Response buatan tangan, dipakai kalau semua upaya
  // lain (fetch jaringan MAUPUN baca dari Cache Storage) gagal total.
  const fallbackResponse = () => new Response(
    '<h1>Sedang offline</h1><p>Tidak bisa memuat halaman ini dan belum ada salinan tersimpan. Coba lagi setelah koneksi kembali.</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );

  event.respondWith(
    fetch(req.url, { cache: 'no-store' })
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {});

        // FIX: kalau server (Cloudflare) redirect request ini (mis. "/" -> "/index.html",
        // http -> https, atau strip/tambah trailing slash), `res.redirected` jadi true.
        // Untuk request navigasi (buka halaman), Chrome MENOLAK meneruskan Response yang
        // bertanda "redirected" lewat respondWith() — persis pesan error "a redirected
        // response was used for a request whose redirect mode is not 'follow'" — dan
        // seluruh halaman gagal dimuat. Solusinya: bikin Response baru dari body yang
        // sama supaya flag .redirected hilang, isi/status/header tetap identik.
        if (!res.redirected) return res;
        return res.blob().then((blob) => new Response(blob, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers
        }));
      })
      .catch(() =>
        // PENTING: rantai fallback ini HARUS selalu berakhir dengan sebuah
        // Response yang valid. Kalau fetch gagal (koneksi jelek/putus) DAN
        // request ini kebetulan tidak ada di cache DAN './index.html' juga
        // entah kenapa tidak ke-cache, hasilnya bisa `undefined` —
        // respondWith(undefined) bikin Chrome melempar net::ERR_FAILED dan
        // seluruh halaman gagal total sampai di-hard-refresh. Response
        // buatan tangan di baris terakhir ini mencegah itu: dalam skenario
        // terburuk sekalipun, user tetap dapat pesan yang jelas, bukan
        // error jaringan yang bikin bingung.
        //
        // CATATAN TAMBAHAN (penting!): caches.match() DI BAWAH INI JUGA BISA
        // REJECT sendiri, bukan cuma "tidak ketemu" — misalnya kalau Cache
        // Storage di device rusak/korup atau kena quota exceeded (pernah
        // terjadi di Chrome Android). Kalau reject ini tidak ditangkap,
        // dia akan ikut membuat promise respondWith() reject juga, dan
        // hasilnya net::ERR_FAILED persis seperti skenario di atas — inilah
        // penyebab bug "harus hapus data & cache dulu baru bisa akses".
        // Makanya seluruh chain ini dibungkus .catch() lagi supaya APAPUN
        // yang gagal (fetch atau Cache API itu sendiri), user tetap dapat
        // Response yang valid, bukan promise yang reject.
        caches.match(req)
          .then((cached) => cached || caches.match('./index.html'))
          .then((cached) => cached || fallbackResponse())
          .catch(() => fallbackResponse())
      )
      .catch(() => fallbackResponse())
  );
});
