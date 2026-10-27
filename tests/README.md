# Tests — Dashboard Amiru

Test **tanpa dependency** (hanya `node:assert` dan modul bawaan Node) untuk mencegah regresi pada fungsi kritis. Tidak memakai framework tes.
`app.js` tidak dirancang untuk di-`import` (memakai `document`/`window` global di level atas), jadi tes memuatnya lewat `vm` dengan
mock DOM/Supabase minimal, atau mengekstrak satu fungsi lalu menjalankannya terpisah. Tidak ada tes yang memakai jaringan.

## Cara menjalankan

```bash
npm test             # semua 9 suite di tests/ (sama dengan npm run test:ci)
node tests/test-core.js   # satu suite saja

npm run test:ig      # test-core.js di ROOT repo: logika IG Scheduler / Perencanaan Konten
npm run test:edge    # tes generator rencana konten di edge function (butuh Node dengan --experimental-strip-types, mis. Node 22)
npm run check        # bukan tes logika: pastikan *.min.* dan hash di index.html sinkron dengan sumber
```

Setelah mengubah `js/` atau `css/`, jalankan `npm run release` dulu. `test-service-worker.js` gagal bila `index.html` tidak sinkron dengan
file `*.min.*` di disk.

## Isi `npm test`

| File | Yang dijaga |
|---|---|
| `test-core.js` | Fungsi murni di `app.js`: `rupiahTerbilang`, `parseRupiahToNumber`, `hitungEstimasi`, `escapeHtml`/`escapeJsAttr` (XSS), `getHargaKamarJamaah`, beberapa fungsi anti-duplikat IG (mis. `igIsSimilarText`), dan konstanta kritis (mis. `MAX_SNAPSHOTS === 10`, `takeSnapshot` terdefinisi). Fungsi yang kini ada di modul lazy dimuat sebagai skrip kedua di konteks yang sama |
| `test-modules.js` | Integrasi modul lazy di sandbox: stub -> modul -> fungsi asli benar-benar jalan; **Hapus Semua** dan **Import** dibatalkan bila snapshot pengaman gagal (termasuk saat modul snapshot gagal diunduh); penanda snapshot harian tidak terkunci bila unduhan gagal; modul Profil Perusahaan/Kelola Cicilan menulis ke `let` di `app.js`. `USE_MIN=1 node tests/test-modules.js` menguji hasil build `*.min.js` |
| `test-total-bayar.js` | `fetchTotalBayar()`: paginasi 1000 baris, filter program (`programId`/`programIds`), penanganan error (membaca view `v_total_bayar`) |
| `test-with-retry.js` | `withRetry()` dan `isTransientResult()`: retry untuk hasil `{ error }` bergaya supabase-js (yang tidak melempar exception), bukan hanya untuk `throw` |
| `test-lazy-css.js` | `ensureStyleLoaded()` dan `ensureModuleLoaded()` yang menunggu CSS; penjaga struktur: `index.html` tidak me-link `ig-scheduler.min.css`, `.ig-empty` ada di `style.css` |
| `test-service-worker.js` | `service-worker.js` di Node dengan Cache API tiruan: aset ber-hash (`?v=`) cache-first tanpa menyentuh jaringan, hash baru = unduh baru, 404 tidak disimpan, fallback offline, install memprecache aset dari `index.html`, activate membuang cache lama dan aset basi, dan `index.html` sinkron dengan `*.min.*` di disk |
| `test-auto-generate.js` | `scripts/auto-generate-konten.mjs` dengan Supabase dan edge function palsu: jalur generate tidak bergantung DOM, pekan depan terisi 7 hari memakai tema Rencana Setahun, dijalankan ulang tidak menggandakan, `DRY_RUN=1` tidak memanggil AI dan tidak menyimpan, `TARGET_SENIN` bukan Senin = error |
| `test-about-planner.js` | Dokumen About Planner dibangun dari `IG_POLA_AMIRU` + `IG_POLA_VARIAN` (tidak ada penanda `{{...}}` tersisa) dan ikut berubah saat pola diubah; header `Versi:`/`Diperbarui:` tetap terbaca |
| `test-dokumentasi.js` | Modul Dokumentasi: template alur umroh lolos CHECK constraint sql/60 untuk semua kombinasi durasi/urutan/hari Madinah, tanggal per hari, teks Salin Jadwal, pengamanan link (`dkgSafeUrl`), escape HTML saat render + guest tanpa tombol ubah, serta kecocokan `LAZY_MODULES.dokumentasi.api` dengan markup `index.html`. `USE_MIN=1` menguji hasil build |

## Tes di luar `npm test`

- **`test-core.js` (root)** (`npm run test:ig`): tes logika IG Scheduler dan Perencanaan Konten (pola 7 hari, anti-duplikat, Rencana Setahun, jeda tema).
  Memuat `app.js` dan `js/modules/ig-scheduler.js` di `vm`.
- **`supabase/functions/generate-ig-content-plan/test-core.mjs`** (`npm run test:edge`): prompt sistem, skema respons, dan opsi
  `IG_PLAN_*` pada edge function generator rencana konten.

## CI

Belum ada workflow GitHub Actions yang menjalankan tes. Yang sudah ada di `.github/workflows/`: `keep-supabase-alive.yml` dan
`auto-generate-konten.yml`. Untuk memasang CI tes, jalankan `npm ci`/`npm install`, `npm run test:ci`, lalu `npm run check` pada push/PR.

## Menambah test

- Fungsi murni di `app.js`: tambahkan `test('nama', () => { ... })` di `tests/test-core.js` dan daftarkan nama fungsinya di array `__names` (dekat bagian atas file); fungsi yang ada di `js/modules/*.js` ditangkap otomatis.
- Perilaku modul lazy: tambahkan `await T('nama', async () => { ... })` di `tests/test-modules.js`.
- Suite baru: buat `tests/test-<nama>.js` (exit code non-zero bila gagal) lalu daftarkan di skrip `test` dan `test:ci` di `package.json`.
