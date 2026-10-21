# CLAUDE.md

Panduan konteks untuk Claude (atau siapa pun) saat mengerjakan proyek ini.

## Apa proyek ini

**Dashboard Amiru** — dashboard web untuk PT Amiru Haramain Indonesia (travel Umroh):
mengelola data program Umroh, jadwal tamu, data jamaah per program, kuitansi, notifikasi
Telegram, dan crosscheck poster promosi vs data yang diinput. Dipakai oleh 3 role:
`admin`, `user`, `guest` (dan pengunjung anonim yang belum login).

Bahasa UI & komentar kode: **Bahasa Indonesia**. Ikuti gaya ini saat menambah fitur.

## Stack

- Vanilla JavaScript (tanpa framework/bundler), HTML, CSS murni
- Supabase (Postgres + RLS + Auth + Storage) sebagai backend, diakses langsung dari browser
  via `@supabase/supabase-js` (CDN) dan sebagian via `fetch()` manual ke endpoint REST.
  Login memakai **Supabase Auth** (bukan lagi password di `app_config` / `login-dashboard`)
- Supabase Edge Functions (Deno/TypeScript) untuk hal yang butuh secret/server-side:
  Gemini (AI caption, OCR poster, rencana konten), Telegram, manajemen akun, Instagram Graph API
- Cloudflare: frontend di Workers Static Assets (`wrangler.jsonc`), cron IG Scheduler di Worker
  terpisah (`scheduler/`)
- PWA: `manifest.json` + `service-worker.js` (strategi network-first, fallback cache)
- jsPDF (CDN) untuk generate kuitansi PDF

## Build & rilis (minify + versi cache)

`index.html` TIDAK memuat `js/app.js` / `css/*.css` langsung, melainkan hasil minify-nya:
`js/app.min.js` dan `css/*.min.css` (dibuat esbuild lewat `scripts/build.mjs`), masing-masing
dengan `?v=<hash isi file>` (ditempel `scripts/stamp-versions.mjs`). `_headers` meng-cache
`/js/*` dan `/css/*` setahun (`immutable`), jadi versi di URL itulah yang memaksa browser
mengunduh ulang saat file berubah.

- **Tetap edit file sumber** (`js/app.js`, `css/*.css`). Jangan edit file `*.min.*` (ditimpa tiap build).
- Setelah mengubah `js/` atau `css/`: jalankan `npm install` (sekali, untuk esbuild) lalu `npm run release`
  (= `build` + `stamp`), dan commit file sumber, file `*.min.*`, dan `index.html` bersama-sama.
- `npm run check` memastikan file `*.min.*` dan versi di `index.html` sinkron dengan sumbernya
  (exit 1 kalau basi) -- cocok dipasang di CI. Lupa `release` = user bisa memakai file lama dari cache.
- Naikkan `CACHE_NAME` di `service-worker.js` kalau daftar `APP_SHELL` atau isi file precache berubah.
- `css/ig-scheduler.css` dll. tetap dipecah per modul; esbuild hanya meminify, tidak menggabungkan.

## Modul JS lazy (`js/modules/`)

`js/app.js` tidak lagi memuat semuanya. Modul besar dipecah ke `js/modules/<nama>.js` dan baru diunduh saat dibutuhkan lewat `ensureModuleLoaded('<nama>')` (di app.js, bagian "24").

- Modul yang ada sekarang (`LAZY_MODULES` di app.js bagian "24"):

  | Modul | Isi | Dibuka lewat | Tetap di app.js (dipakai inti secara sinkron) |
  |---|---|---|---|
  | `ig-scheduler` | semua halaman IG Scheduler (bagian 24 s/d 24h lama) | `openIgSchedulerPage()` → `igOnPageOpen()` | `IG_PILLARS`, `IG_AUTOPUBLISH_ENABLED`, `IG_CAPTION_FUNCTION_URL` |
  | `crosscheck` | panel Crosscheck: OCR poster, `renderCxPanel`, `openCxEditModal`, `saveCxPosterData`, `autoScanPosterForProgram` | tab Admin > Crosscheck, simpan program (auto-scan) | seluruh mesin pembanding (`cxValuesMatch`, `cxIsProgramVerified`, `cxGetProgramStatus`, ...) karena badge Verified di tabel utama butuh nilai sinkron; highlight autofill (`cxApplyAutofillHighlight`, `cxClearAutofillHighlight`) + listener `input`-nya; `CX_OCR_FUNCTION_URL`, `CX_HOTEL_REF_HINT_ENABLED` |
  | `dokumen` | tab Kelengkapan Dokumen + To-Do CS (`loadDokumenForProgram`, `renderTodoCsPanel`, reminder WA) | `switchTab('dokumen'|'todocs')` | `isDokumenLengkap()` (badge sidebar & statistik) |
  | `kepulangan` | tab Status Kepulangan + Tanda Terima Dokumen | `switchTab('kepulangan')`, tombol Tanda Terima di tab Dokumen | `kepulanganStatusInfo`, `statusKepulanganProgram`, `efektifStatusKepulangan`, `efektifTglKepulangan`, `tglKepulanganProgram`, `KEPULANGAN_STATUS_OPSI` (dipakai badge & arsip) |
  | `manifest` | Manifest Jamaah (preview/JPEG/PDF) + Export Excel jamaah & pembayaran | tombol di tab Data Jamaah | - |
  | `rooming` | Rooming List | tombol di tab Data Jamaah | - |
  | `pengaturan-user` | Admin > Pengaturan User: daftar user, tambah user, reset password, matriks akses menu per role/per user | `switchAdminSubTab('usersettings')` | `logoutAdmin()` (tombol sidebar), `US_ROLE_META` (badge role di Audit Nota) |
  | `assets` | Admin > Assets: CRUD link/bookmark, tabel Hotel Saudi Arabia (cari/filter), ekspor & impor CSV hotel | `switchAdminSubTab('assets')` → `loadAssets()`; tab Hotel di `switchAssetsInnerTab('hotels')` | `loadHotelSaudiArabia()`, `ensureHotelReferenceLoaded()`, mesin pencocokan nama hotel (`findBestHotelMatch`, `diceSimilarity`, ambang `HOTEL_REF_*`), hint form Program (`handleHotelRefInput`, `updateHotelRefHint`), pustaka detail hotel (`ensureHotelDetailsLoaded`, `lookupHotelDetailJarak`, `saveHotelDetailsFromForm`, `refreshHotelDetailSuggest`), `switchAssetsInnerTab`, `switchUsInnerTab`, `escapeHtmlAttr`, state `assetsList`/`hotelSaudiList`/`hotelSaudiLoaded` (form Program, parser Broadcast & Crosscheck memakainya secara sinkron) |
  | `nota` | Pembangun nota: `buildNotaHTML`/`buildNotaRiwayatHTML`/`buildKuitansiHTML`, `NOTA_TEMA`, terbilang, `tanggalIndonesia`, render canvas + export JPEG/PDF, panel preview (+ live), `downloadNotaPembayaran`/`downloadNotaRiwayatLengkap` | tombol Nota di modal Kelola Cicilan (`previewNotaPembayaran`, `previewNotaRiwayatLengkap`, `confirmDownloadNotaPreview`); ketikan form cicilan (`handleCicilanFormLiveInput` memuat diam-diam); otomatis sebagai `deps` | `NOTA_PERUSAHAAN` + `COMPANY_PROFILE_KEY` + `loadCompanyProfile()` (editor Profil Perusahaan ada di modul `profil-perusahaan`), `nomorNota()`, `nomorKuitansiTampilan()`, `getPetugasDisplayName()`, lightbox nota (`openNotaLightbox`, `closeNotaLightbox`, `fitNotaLightboxScale`), `hideNotaPreviewPanel()`, `notaPreviewPending`, `logNotaAudit()`/`sha256Hex()`/`getPetugasNama()`, `fetchNextKuitansiNomorValue()` |
  | `pembayaran` | Menu Pembayaran (admin): ringkasan pemasukan, tabel pembayaran seluruh jamaah, combobox filter program, Reminder WA cicilan | `switchAdminSubTab('pembayaran')` → `renderPembayaranPanel()`; tombol Reminder WA di tab Dokumen/To-Do CS | state cache `pbCacheJamaahAll`/`pbCacheTotalPerJamaah`/`pbSearchDebounce`, state modal Kelola Cicilan (`cicilanList`, `cicilanJamaahId`, ...), `afterDeleteCicilan`, `syncJamaahStatus*` (UI modalnya ada di modul `cicilan`) |
  | `audit-nota` | Admin > Audit Nota: daftar log nota (cari/filter jenis, Muat Lebih Banyak), statistik, pratinjau nota dari log | `switchAdminSubTab('auditnota')` → `loadNotaAuditLog()` + `loadNotaAuditStats()` | `logNotaAudit()`, `sha256Hex()`, `getPetugasNama()` (pencatatan saat nota diunduh: tidak boleh bergantung pada unduhan modul), pembangun nota (`buildNotaHTML`, ...) & lightbox nota |
  | `cicilan` | Modal Kelola Cicilan: riwayat pembayaran, form tambah (incl. Refund), isi sisa tagihan, `saveCicilan`, `deleteCicilan` | tombol "Bayar" di tabel Keberangkatan/Pembayaran → `openCicilanModal()` | state `cicilanList`/`cicilanJamaahId`/`cicilanJamaahInfo`/`cicilanProgramInfo`/`cicilanHargaProgram`/`cicilanSisaTagihan` (dibaca modul nota & audit-nota), `hideNotaPreviewPanel()`, `afterDeleteCicilan()`, `syncJamaahStatus()`, `syncJamaahStatusForProgram()` (dipanggil alur inti: simpan program & konfirmasi hapus pembayaran; tidak boleh bergantung pada unduhan modul) |
  | `profil-perusahaan` | Admin > Perusahaan: form editor profil (brand, nama, alamat, logo, rekening, kontak WA), `saveCompanyProfile()` | `switchAdminSubTab('profil')` → `renderCompanyProfilePanel()` (mengisi `#companyProfileMount`, sekali per panel) | `NOTA_PERUSAHAAN`, `COMPANY_PROFILE_KEY`, `loadCompanyProfile()` (dibaca sinkron oleh nota, caption WA, sapaan sidebar) |
  | `snapshot` | Admin > Snapshot / Backup: ambil/pulihkan snapshot, daftar timeline, snapshot pengaman (strict) | `switchAdminSubTab('snapshot')`, tombol Ambil, snapshot harian, `clearAllAdminData()`/`importAdminData()` | `maybeDailySnapshot()`, `SNAP_DAILY_KEY` |
  | `telegram` | Admin > Telegram: konfigurasi, penerima, kirim notifikasi, pengingat otomatis (`checkAndSendReminders`) | `switchAdminSubTab('telegram')`; `sendTelegramNotif` setelah simpan program/jadwal; `checkAndSendReminders` 2 detik setelah boot | `formatTgProgram()`, `formatTgJadwal()` (hasilnya dipakai sinkron sebagai argumen `sendTelegramNotif`) |

  **CSS lazy (`css: [...]` di `LAZY_MODULES`):** modul boleh punya CSS sendiri yang TIDAK di-`<link>` di
  `index.html`, tapi diunduh paralel oleh `ensureModuleLoaded()` lewat `ensureStyleLoaded('<nama>')` (versi
  `?v=` dari kunci `css:<nama>` di `moduleVersions`, diisi `npm run stamp`). Saat ini hanya `ig-scheduler`
  (94 KB). Halaman yang kerangkanya sudah ada di `index.html` (mis. `openIgSchedulerPage()`) harus
  `await ensureStyleLoaded(...)` SEBELUM menampilkan kerangka, supaya tidak tampil polos. SYARAT memindah CSS
  ke lazy: tidak ada kelas dari file itu yang dipakai di luar modulnya (cek app.js, index.html di luar blok
  modul, dan modul lain). Contoh yang ketahuan: `.ig-empty` dipakai galeri Infografis -> dipindah ke `style.css`.
  CSS lain (`keuangan`, `user-akses`, `crosscheck`, dst.) BELUM bisa lazy karena markup panel admin-nya dirender
  oleh `app.js` inti.

  **`deps` di `LAZY_MODULES`:** modul yang memakai fungsi/konstanta modul lain secara SINKRON (di template, tingkat-atas, atau nilai balik) harus mendeklarasikan `deps: ['<modul>']`. `ensureModuleLoaded()` memuat dep lebih dulu, baru skrip modulnya. Saat ini `kepulangan`, `manifest`, `rooming`, dan `audit-nota` ber-`deps: ['nota']` (memakai `NOTA_TEMA`, `buildNota*HTML`, `exportNotaElementAs*`, `tanggalIndonesia`, dst.). Menambah pemakai baru fungsi nota di modul lain = tambahkan `deps` itu juga.

  **Snapshot Backup (16B) sekarang modul lazy `snapshot`.** Isi: `takeSnapshot`, `collectAllUmrohData`, `ensureAutoSnapshot`, `restoreSnapshot`, `renderSnapshotAdminTable`, `MAX_SNAPSHOTS`, `SNAPSHOT_TABLES`. Dibuka lewat `switchAdminSubTab('snapshot')`, tombol Ambil, snapshot harian, dan snapshot pengaman. Tetap di app.js: `maybeDailySnapshot()` + `SNAP_DAILY_KEY` (cek throttle harian tanpa mengunduh modul). **Aturan keras:** `clearAllAdminData()` dan `importAdminData()` memeriksa hasil `await ensureAutoSnapshot(...)` dan MEMBATALKAN aksi kalau falsy; stub mengembalikan `undefined` kalau modul gagal diunduh (offline), jadi aksi tetap batal. `ensureAutoSnapshot()` memakai mode strict (satu tabel gagal dimuat = snapshot gagal). Jangan hapus pemeriksaan itu di pemanggil mana pun, termasuk pemanggil baru.
- Modul dimuat sebagai `<script>` biasa (BUKAN ES module): satu lingkup global dengan app.js, nama fungsi global tidak berubah, `onclick`/`data-action` tetap jalan. **Jangan deklarasi ulang nama yang sudah ada di app.js** (`const`/`let` ganda = SyntaxError, seluruh modul gagal).
- Fungsi modul yang dirujuk `index.html` atau kode inti sebelum modul termuat WAJIB didaftarkan di `LAZY_MODULES['ig-scheduler'].api` (app.js); stub dibuat otomatis. Konstanta yang dipakai kode inti (`IG_PILLARS`, `IG_AUTOPUBLISH_ENABLED`, `IG_CAPTION_FUNCTION_URL`) tinggal di app.js.
- Tetap edit file sumber `js/modules/*.js`, bukan `*.min.js`. `npm run release` meminify modul dan menulis hash-nya ke `<script id="moduleVersions">` di index.html. Modul baru juga perlu ditambahkan ke `APP_SHELL` di `service-worker.js` (+ naikkan `CACHE_NAME`).
- Aturan stub (penting saat memecah modul baru): stub MENGEMBALIKAN Promise, jadi hanya aman untuk fungsi yang dipanggil tanpa memakai nilai baliknya (render/buka modal/handler klik). Fungsi yang hasilnya dipakai sinkron oleh kode inti (mis. `cxIsProgramVerified`, `isDokumenLengkap`) harus tetap di app.js. `let/const` yang dibaca kode inti juga harus tetap di app.js (di modul yang belum dimuat akan `ReferenceError`). Pembungkus `withBusy()` untuk fungsi modul dipasang di akhir file modulnya (contoh: `saveCxPosterData`, `saveIgPost`).
- Pemeriksaan sebelum memecah: pastikan tidak ada fungsi modul yang memakai `event` global implisit (stub dipanggil setelah modul diunduh, `window.event` sudah hilang); nama yang dirujuk dari string HTML (`onclick="..."`, `data-action`) juga wajib ada di `api`.
- Tes (`tests/test-core.js`, `test-core.js`) memuat modul sebagai skrip kedua di konteks yang sama, jadi nama IG tetap bisa diuji.

## Struktur file AKTIF (yang benar-benar di-load browser)

```
index.html          ← struktur HTML saja, load css/style.css + css/rekap-infografis.css + css/snapshot.css + css/jadwal-tamu.css + css/assets.css + css/hotel.css + css/detail-program.css + css/telegram.css + css/kepulangan.css + css/rooming.css + css/ig-scheduler.css + css/user-akses.css + css/keuangan.css + css/crosscheck.css + js/app.js
katalog.html          ← halaman marketing publik MANDIRI (CSS+JS inline, tidak memakai app.js/style.css). Baca tabel
                        `programs` via REST dengan anon key, filter sama seperti `isProgramVisibleOnDashboard`
                        (aktif, belum expired, punya poster). Sisa seat tidak ditampilkan karena `kb_jamaah`
                        tidak publik. Isi `WA_NUMBER` di bagian konfigurasi untuk tombol WhatsApp. Kalau logika
                        filter/parse tanggal di app.js berubah, sesuaikan juga di sini. Di topbar ada 2 tombol:
                        "Share Katalog" (`#btnShareKatalog`, `copyKatalogLink()` di app.js) menyalin URL
                        katalog.html ke clipboard, dan "Katalog" (`#btnLihatKatalog`) link `href="katalog.html"`
                        yang membuka halaman ini di tab baru
katalog-flip.html     ← versi FLIPBOOK dari katalog publik, juga MANDIRI (CSS+JS inline). Data dan filter program SAMA
                        dengan katalog.html (tabel `programs`, anon key, cache localStorage `katalog_programs_v1`
                        dipakai bersama), jadi kalau logika filter/parse tanggal berubah, sesuaikan di KETIGA tempat
                        (app.js, katalog.html, katalog-flip.html). Halaman buku 4:5 (500x625 logis): sampul, daftar isi
                        (`PER_HALAMAN_DAFTAR` baris per halaman), sambutan, lalu per program sepasang halaman
                        (detail di kiri/indeks ganjil, poster di kanan/indeks genap), sampul belakang. Jumlah halaman
                        harus selalu genap (diatur `buildPages()`). Poster dimuat lazy hanya di sekitar halaman aktif
                        (`hydrate()`). Isi `WA_NUMBER` dan `WA_TAMPIL` di bagian konfigurasi. Deep link `katalog-flip.html#p5`.
                        Animasi balik halaman digerakkan JS (requestAnimationFrame, BUKAN CSS transition): lembar yang sedang bergerak diganti
                        sementara dengan `curl` (rantai strip bersendi, `startCurl()/paintCurl()`) supaya kertas melengkung; ada bayangan jatuh
                        (`.cast`), tumpukan halaman (`.stk`), sampul membuka sambil menggeser buku, dan seret-halaman (pointermove). Konstanta `BEND`.
                        Dibuka dari tombol "Flipbook" di topbar (`#btnLihatFlipbook`) dan tombol Flipbook di katalog.html;
                        tombol "Share Flipbook" (`#btnShareFlipbook`, `copyFlipbookLink()` di app.js) menyalin URL-nya.
                        `copyKatalogLink()` dan `copyFlipbookLink()` sama-sama memakai `salinLinkPublik(url, nama)`
css/style.css        ← CSS INTI (variabel :root warna brand, layout, sidebar, topbar, tombol, modal, tabel,
                        form, utilitas, responsif lintas-modul). Pemecahan per modul SELESAI: semua modul ada di file sendiri di bawah. **PENTING:** ada file `/style.css`
                        lepas di root project yang BASI/tidak dipakai (sisa restrukturisasi lama,
                        index.html tidak meng-load-nya) — jangan pernah edit file itu, selalu edit
                        `css/style.css`. Cek dulu dengan `grep "style.css" index.html` kalau ragu.
css/rekap-infografis.css ← MODUL Rekap Program & Infografis (`.rekap-*`, `@keyframes rekapSheetUp`, `.metric-clickable`,
                        `.infografis-*`, `.poster-popup*`, `.poster-missing-badge`). Di-load SETELAH style.css dan SEBELUM
                        ig-scheduler.css. `.pd-poster-*` (modal Detail Program) sengaja TIDAK di sini; itu modul Detail Program.
css/hotel.css          ← MODUL Hotel Saudi Arabia (`.hotel-*`: search/tabel di Assets, import CSV, hint kecocokan hotel & saran
                        detail hotel di form Program, `#adminFormContainer .hotel-ref-hint*`, `#btnAddHotelExtra`). Di-load setelah
                        rekap-infografis.css, sebelum ig-scheduler.css. `.assets-inner-tab-*` bukan bagian modul ini (modul Assets).
css/kepulangan.css     ← MODUL Status Kepulangan (`.kp-*`: field inline, dropdown status berwarna). Di-load setelah hotel.css,
                        sebelum ig-scheduler.css. `.kp-program-panel` hanya style inline (tanpa aturan CSS).
css/snapshot.css      ← MODUL Snapshot/Backup (`.snap-*`). Di-load setelah rekap-infografis.css.
css/jadwal-tamu.css   ← MODUL Jadwal Tamu (`.jadwal-status-pill`).
css/assets.css        ← MODUL Assets (`.asset-*`, `.assets-inner-*`). PERHATIAN: `.assets-inner-*` dipakai juga oleh tab dalam
                        Pengaturan User (`switchUsInnerTab` di app.js).
css/detail-program.css ← MODUL modal Detail Program / Teks WA (semua `.pd-*` termasuk `.pd-poster-*`, `.modal-content.pd-modal`).
css/telegram.css      ← MODUL Telegram (`.tg-*`).
css/rooming.css       ← MODUL Rooming List (`.rm-*`).
                        URUTAN LOAD (WAJIB dijaga, kaskade bergantung padanya): style.css, rekap-infografis, snapshot, jadwal-tamu,
                        assets, hotel, detail-program, telegram, kepulangan, rooming, ig-scheduler, user-akses, keuangan, crosscheck.
                        Blok @media target-sentuh (pointer: coarse) di style.css tadinya satu daftar selector bersama banyak modul;
                        bagian selector tiap modul kini ada di @media di file modulnya, sisanya tetap di style.css.
css/ig-scheduler.css ← MODUL IG Scheduler (semua `.ig-*`, `#ig*`, variabel `--ig-*`, `@keyframes ig-plan-spin`).
                        Di-load SETELAH style.css. Gaya IG baru -> taruh di sini, bukan di style.css.
                        Pemecahan CSS dilakukan bertahap per modul (SELESAI semua: IG Scheduler, User/Akses, Keuangan, Crosscheck, Rekap/Infografis, Snapshot, Jadwal Tamu, Assets, Hotel, Detail Program, Telegram, Kepulangan, Rooming);
                        modul baru WAJIB ditambah `<link>` di index.html (setelah style.css) dan di daftar
                        APP_SHELL `service-worker.js`, lalu naikkan `CACHE_NAME`.
css/user-akses.css   ← MODUL User & Akses Menu (semua `.us-*`, `.rma-*`). Di-load setelah ig-scheduler.css.
                        `.us-*` juga dipakai di luar halaman user (mis. `.us-stat` di Audit Nota, gayanya `.an-*` di keuangan.css), jadi file ini
                        tidak boleh dilepas. `.ms-*` (komponen modal bersama) dan `.cs-*` (custom select) SENGAJA
                        tetap di style.css karena bukan bagian user/akses.
css/keuangan.css     ← MODUL Keuangan (`.pb-*` halaman Pembayaran, `.cicilan-*` modal Kelola Cicilan, `.nota-*`
                        preview/lightbox nota, `.kuitansi-*`, `.an-*` Audit Nota). Di-load setelah user-akses.css (WAJIB: `.an-*`
                        dibangun di atas komponen `.us-*`, jadi urutan link: user-akses -> keuangan). PENGECUALIAN:
                        `.cx-stats-bar` ikut di file ini tapi DIPAKAI BERSAMA Crosscheck (`#cxStatsBar`) dan
                        Pembayaran (`#pbStatsBar`); chip-nya (`.cx-stat-chip*`) ada di crosscheck.css. Jangan
                        pindahkan aturan itu ke crosscheck.css.
css/crosscheck.css   ← MODUL Crosscheck OCR poster vs data (semua `.cx-*` kecuali `.cx-stats-bar`, plus
                        `@keyframes cxFieldFlash`). Di-load PALING AKHIR setelah keuangan.css. Termasuk aturan
                        `.form-group input/select/textarea.cx-autofill-pending|cx-field-flash` (highlight autofill
                        di form program, field `admin_*`); di dalam `#adminFormContainer` aturan itu dijaga oleh
                        varian ber-ID (spesifisitas lebih tinggi), jadi urutan load tidak mengubah tampilan.
js/app.js            ← SATU-SATUNYA file JS, berisi SEMUA logic + koneksi Supabase
manifest.json         ← config PWA (name, theme_color, icons)
service-worker.js     ← precache list, HARUS disinkronkan manual kalau nama file berubah.
                        `CACHE_NAME` (saat ini `amiru-repo-cache-v134`) dinaikkan tiap rilis
icons/                ← 9 file ikon PWA sesuai daftar di manifest.json
sql/                  ← skema & migrasi bernomor 00-56. `00_SETUP_LENGKAP_SATU_FILE.sql` = gabungan
                        semuanya (idempoten, bebas urutan) untuk project baru. Untuk project yang SUDAH
                        jalan, jalankan hanya migrasi baru sesuai nomor urut. Contoh penting:
                        19 (nomor nota + `nota_audit_log` append-only), 26/27 (hardening RLS),
                        28 (migrasi Supabase Auth), 29 (guest read-only di RLS), 30-36 (kelola user,
                        akses menu), 41-51 (IG Scheduler), 52-55 (rekap program, infografis)
.github/workflows/
  keep-supabase-alive.yml ← ping REST API tiap 3 hari biar project free tier tidak auto-pause
                            (secret repo: SUPABASE_URL & SUPABASE_ANON_KEY)
supabase/functions/    ← 17 Edge Function + `_shared/gemini.ts` (acuan helper). Daftar, auth, secret,
                          dan cara deploy ada di `supabase/functions/README.md`
scheduler/             ← Cloudflare Worker cron IG Scheduler (deploy terpisah, BUKAN bagian deploy dashboard)
apps-script/           ← Google Apps Script listing folder Drive (Infografis, Rekap Program)
scripts/setup-auth-accounts.mjs ← setup akun Supabase Auth awal (sekali jalan, butuh service role key)
tests/test-core.js     ← test minimal tanpa dependency (`npm test`)
wrangler.jsonc, .assetsignore, _headers ← deploy & header Cloudflare. `.assetsignore` WAJIB ada
                          (cegah sql/, supabase/, scheduler/, *.md ikut terpublish). Folder/file
                          internal baru harus ditambahkan ke sana
```

**PENTING:** `index.html` HANYA punya satu `<script src="js/app.js">`. Tidak ada file JS
lain yang di-load. Kalau menambah fitur, tambahkan langsung ke `js/app.js` (jangan buat
file `.js` baru terpisah kecuali memang berniat mengubah `index.html` untuk me-load-nya
juga, dan update `service-worker.js` precache list-nya).

Riwayat: proyek ini pernah beberapa kali disusun ulang (monolith → dipecah jadi ~22 file
modular → digabung lagi jadi satu `js/app.js`). Kalau menemukan file `.js` lepas di root
atau folder `js/` selain `app.js` (mis. `utils.js`, `test-core.js`, `js/index.html`), atau `index.ts` di root (salinan lama `generate-wa-caption`), kemungkinan besar itu sisa lama yang tidak dipakai —
cek dulu apakah direferensikan di `index.html`/`service-worker.js` sebelum diasumsikan aktif.

## Tabel Supabase yang dipakai

| Tabel | Fungsi |
|---|---|
| `programs` | Data program Umroh (field admin-only digabung di kolom `admin_data_lengkap` jsonb) |
| `jadwal_tamu` | Jadwal kunjungan tamu ke kantor |
| `kb_jamaah` | Data jamaah per program (kolom `dokumen` jsonb = checklist kelengkapan dokumen; `diarsipkan`, `status_kepulangan`) |
| `pendaftaran` | Daftar minat calon jamaah sebelum resmi masuk `kb_jamaah` |
| `pembayaran_jamaah` | Riwayat pembayaran/cicilan per jamaah (punya `nomor_nota` dari trigger DB) |
| `nota_audit_log` | Ledger audit nota, append-only (UPDATE/DELETE diblokir trigger) |
| `jamaah_audit_log` | Log audit perubahan data jamaah |
| `kwt_kuitansi` | Kuitansi |
| `featured_programs` | Program unggulan (diakses via `fetch()` REST langsung, bukan `.from()`) |
| `dashboard_profiles` | Satu baris per akun Supabase Auth: `dashboard_role` (`admin`/`user`/`guest`), label, email, last login. Dipakai RLS dan semua Edge Function untuk cek role |
| `role_menu_access`, `user_menu_access` | Akses menu sidebar per role dan pengecualian per user |
| `app_config` | Key-value config. Password login sudah TIDAK dipakai lagi sejak migrasi Supabase Auth |
| `login_rate_limit` | Sisa rate-limit login versi lama |
| `tg_config` | Config Telegram (bot token, edge URL, daftar penerima) |
| `snapshot_backup` | Snapshot backup data (maks 10, `MAX_SNAPSHOTS`) |
| `assets` | Link/bookmark dokumen penting (menu Assets, admin saja) |
| `hotel_saudi_arabia`, `hotel_detail` | Referensi hotel Arab Saudi (hasil import CSV) dan detailnya |
| `infografis_items`, `rekap_program_items` | Gambar dari folder Drive, disinkron Edge Function |
| `ig_accounts`, `ig_posts`, `ig_post_media`, `ig_publish_logs` | IG Scheduler: akun, post, media carousel, log publish |
| `ig_comments` | Komentar IG hasil `ig-sync-comments` |
| `ig_content_plan`, `ig_rencana_tahunan`, `ig_tasklist` | Perencanaan konten IG (ide harian, tema per pekan, tasklist) |
| `microblog_publik` (VIEW) | Turunan `ig_content_plan` untuk tile/modal Microblog. Dibaca anon/guest/semua role (sql/58); hanya kolom tampilan, status `dilewati` disembunyikan, `canva_url`/`ig_post_id` tidak ikut |

Daftar di atas dari `sql/00_SETUP_LENGKAP_SATU_FILE.sql`; cek file itu bila ragu.

Setup Supabase baru: jalankan `sql/00_SETUP_LENGKAP_SATU_FILE.sql` di SQL Editor, lalu
`sql/28_migrate_supabase_auth.sql` dan `scripts/setup-auth-accounts.mjs` untuk akun login,
deploy Edge Function, lalu update `SUPABASE_URL` & `SUPABASE_ANON_KEY` di `js/app.js` baris 4-5
(harus project yang SAMA dengan tempat SQL & fungsi dideploy, kalau tidak muncul error `PGRST301`).

## Peta bagian `js/app.js` (sekitar 20.000 baris, dibagi per komentar section)

1. Supabase Config — 2. State — 3. Utility Functions (termasuk `withRetry()` untuk
   retry request baca yang gagal karena masalah jaringan) — 4. Generate Auto WA Text —
5. Tab Switching — 6. Mobile Sidebar — 7. Render Skeleton — 8. Load Data from Supabase —
9. Render Table — 10. Search & Sort — 11. Detail Modal — 12. Admin Login —
13. Admin Panel — 14. Admin CRUD Operations — 15. Parse Broadcast (auto-isi form dari
teks broadcast WA) — 16. Export/Import — 17. Delete Confirm — 18. Jadwal Tamu (CRUD) —
18B. Form Pendaftaran (CRUD daftar minat calon jamaah, tabel `pendaftaran`) —
19. Keberangkatan (CRUD data jamaah + tabel pembayaran/cicilan tergabung dalam satu tab,
terhubung ke harga program & auto-sync status di kb_jamaah) — 19B. Kelola Cicilan
(modal dipakai dari tombol "Bayar" di tabel Keberangkatan) —
19C. Kelengkapan Dokumen (checklist dokumen per jamaah, disimpan di kolom
kb_jamaah.dokumen jsonb) —
20. Kuitansi — 21. Featured Programs —
21A. Crosscheck Module (OCR poster vs data) — 21B. Telegram Module —
22. Init — 23. Close Modals on Overlay Click — 24. Poster Hover Popup — 24e. About Planner —
serta modul belakangan (IG Scheduler, Rencana Konten, Infografis, Rekap Program, Pengaturan User,
Snapshot). Daftar ini tidak lengkap: cari komentar section dengan `grep -n "^// [0-9]" js/app.js`.

## Role & akses

Role: `admin`, `user`, `guest`, atau belum login sama sekali (anonim).
- Anonim → hanya lihat "Program Umroh" & "Unggulan"
- `guest` (sudah login) → tambahan lihat semua tab `nav-loggedin-only` (Jadwal Tamu,
  Pendaftaran, Keberangkatan, Dokumen) tapi **read-only** — tombol tambah/edit/hapus
  disembunyikan (`canManageProgramData()`) DAN ditolak di level RLS database
  (lihat `sql/29_tambah_role_guest_readonly.sql`), jadi tidak bisa ditembus lewat API
  langsung meski punya JWT authenticated
- `user` & `admin` → boleh tambah/edit/hapus data (dicek via `canManageProgramData()`)
- `admin` saja → akses section "Manajemen" dan "System": Edit & Tambah Program, Crosscheck,
  Telegram, Pengaturan User, Snapshot, Assets (default; menu untuk `user`/`guest` bisa diatur
  lewat Pengaturan User > Akses Menu, disimpan di `role_menu_access`/`user_menu_access`)

Buat akun guest baru lewat tab Admin > Pengaturan User, pilih role "Guest (lihat
saja, tanpa akses tulis)". Butuh `sql/29_tambah_role_guest_readonly.sql` sudah dijalankan
dan Edge Function `admin-create-user` sudah di-deploy ulang (ALLOWED_ROLES kini
termasuk `guest`).

Sidebar bersifat role-aware, di-render oleh `renderSidebarNav()`. Warna brand pakai CSS
custom properties `--brand`, `--brand-deep`, `--brand-tint` di `css/style.css` — ganti di
satu tempat itu untuk reskin semua elemen (sidebar, tombol aktif, dsb).

## Catatan alur Pembayaran & Cicilan (`pembayaran_jamaah`)

- Status jamaah (`lunas`/`dp`/`pending`) dihitung dari `SUM(pembayaran_jamaah.jumlah)`
  dibanding `programs.harga_quint` — **hanya kolom `harga_quint`** yang dipakai
  sebagai acuan harga per jamaah, bukan `harga_quad`/`harga_triple`/`harga_double`
  (kolom-kolom itu murni informasi tampilan paket, tidak terhubung ke jamaah
  tertentu karena `kb_jamaah` tidak punya kolom tipe kamar). Kalau `harga_quint`
  kosong, status jamaah di program itu **tidak akan pernah otomatis jadi "Lunas"**
  walau sudah dibayar penuh — modal Kelola Cicilan sekarang menampilkan
  peringatan soal ini di ringkasan.
- Refund disimpan sebagai baris **negatif** di `pembayaran_jamaah` (bukan tabel
  terpisah), supaya `SUM()` otomatis mengurangi total dibayar.
- Kelebihan bayar (total dibayar > harga program) ditampilkan sebagai peringatan
  info di ringkasan modal Kelola Cicilan — sistem tidak memblokir pembayaran
  melebihi sisa tagihan (fleksibel untuk kasus DP awal besar/pelunasan lebih).
- **Total dibayar per jamaah dihitung di database**, bukan di browser: view `v_total_bayar`
  (`sql/59_tambah_view_total_bayar.sql`, `security_invoker`, hanya `authenticated`) dibaca lewat
  `fetchTotalBayar({ programId | programIds })` di `app.js` (dipaginasi 1000 baris). Jangan kembali
  ke `select('jumlah').in('jamaah_id', ...)` + sum di JS: terpotong diam-diam di 1000 baris dan
  URL `.in()` kepanjangan. Kalau mau menambah halaman yang butuh total bayar, pakai helper itu.
  SQL 59 WAJIB dijalankan sebelum frontend ini di-deploy. Query yang butuh baris rinci
  (modal Kelola Cicilan, riwayat nota, export) tetap membaca `pembayaran_jamaah`.
- `saveCicilan()` punya guard `cicilanSaving` untuk cegah insert dobel kalau
  tombol submit di-double click/tap saat koneksi lambat.
- Hapus jamaah (`kb_jamaah`) akan **cascade delete** semua riwayat pembayarannya
  (FK `on delete cascade`) — modal konfirmasi hapus sekarang menampilkan
  peringatan total nilai pembayaran yang akan ikut hilang kalau jamaah itu
  punya riwayat bayar, tapi tetap tidak memblokir (beda dari hapus program yang
  diblokir total kalau masih ada jamaah).
- `nota_audit_log` bersifat append-only (trigger DB memblokir UPDATE/DELETE).
  Untuk log jenis "hapus pembayaran", data baris HARUS diambil dari DB
  **sebelum** perintah delete dijalankan (lihat `confirmDeleteAction()`) —
  kalau diambil sesudahnya baris itu sudah tidak ada lagi dan audit gagal
  tercatat tanpa pesan error (bug lama yang sudah diperbaiki, jangan diulang
  kalau refactor bagian ini).
- "Arsipkan Semua Jamaah" (tombol di tab Keberangkatan) diblokir kalau ada
  jamaah yang: (1) belum berstatus `lunas`/`batal` di pembayaran, ATAU
  (2) `status_kepulangan` belum `sudah_pulang`/`batal` (lihat tab "Status
  Kepulangan", kolom `kb_jamaah.status_kepulangan` — sql/13_tambah_status_kepulangan_kb_jamaah.sql).
  Kedua pengecekan ini sengaja hard block (bukan cuma warning) karena Arsip
  bersifat irreversible dan setelah diarsipkan jamaah hilang dari tab Status
  Kepulangan (tapi tetap terlihat read-only di tab Arsip Jamaah).
- Label menu "Keberangkatan" & "Dokumen" di UI diganti jadi "Data Jamaah" &
  "Kelengkapan Dokumen" (lebih deskriptif) — tab id di kode (`keberangkatan`,
  `dokumen`) TIDAK diubah supaya tidak perlu migrasi `role_menu_access` lama.
  Sidebar dikelompokkan visual pakai label baru "Siklus Jamaah" (class CSS
  `nav-group-label`, ditangani terpisah di `renderSidebarNav()` dari
  `nav-admin-only` karena berlaku untuk semua role yang login, bukan cuma admin).
- Badge angka merah di menu "Kelengkapan Dokumen" & "Status Kepulangan"
  (elemen `.nav-badge`, id `badgeDokumen*`/`badgeKepulangan*` x3 tempat:
  sidebar desktop/mobile/tab-bar) dihitung dari `kbJamaahList` lewat
  `renderNavBadges()` — dipanggil ulang tiap `loadKbJamaah()`,
  `toggleDokumenJamaah()`, & `updateKepulanganField()` supaya selalu real-time
  tanpa query tambahan. Badge Kepulangan sengaja HANYA menghitung status
  `sudah_berangkat` (bukan `belum_berangkat`) karena itu yang paling butuh
  perhatian admin.
- Menu sidebar desktop & drawer mobile dirender dari SATU daftar: `NAV_MENU` di `js/app.js` (section 5b).
  Menambah menu = tambah satu baris di `NAV_MENU` (isi `reg: { group }` kalau menu itu harus bisa diatur
  lewat Pengaturan User > Akses Menu). `SIDEBAR_MENU_REGISTRY` kini DITURUNKAN otomatis dari `NAV_MENU`,
  tidak perlu disinkronkan manual lagi. Jangan menulis tombol menu di `index.html` (hanya `<nav id="sidebarNav">`
  dan `<nav id="mobileSidebarNav">` kosong). Visibilitas memakai kelas `.is-hidden` (bukan `style.display`);
  label grup bisa dilipat (state di localStorage `amiru_nav_folded`).
- `index.html`: aksi klik sederhana memakai `data-action="namaFungsi"` + `data-args='["arg"]'` (listener
  delegasi di `app.js`); `onclick` inline hanya untuk yang butuh `this`/`event`. Modal sudah punya
  `role="dialog"`/`aria-modal`; perangkap fokus & Esc dikelola `initModalA11y()` di `app.js`.
- Fungsi simpan dibungkus `withBusy()` (akhir `app.js`) -> `aria-busy` + spinner + anti klik ganda.

## Badge "Program Baru" di tabel Program Umroh (dashboard utama)

- Muncul otomatis di kolom Nama Program (sebelah badge Verified ✅) selama
  **3 hari** sejak `programs.created_at`, lalu hilang sendiri — dihitung
  ulang tiap render (`buildProgramRowHTML()`), BUKAN kolom/flag terpisah di
  DB, jadi tidak ada job/cron yang perlu jalan buat "membersihkan" badge-nya.
  Kalau mau ubah durasinya, cari angka `3 * 24 * 60 * 60 * 1000` di
  `buildProgramRowHTML()`.
- `buildProgramRowHTML()` dipakai bareng oleh tab "Program Umroh" DAN
  "Unggulan", jadi badge ini otomatis tampil di keduanya.
- Badge yang sama (logika & durasi identik, `renderAdminTable()`) juga
  tampil di panel **Manajemen > Edit Program**, tapi teksnya cuma **"Baru"**
  (bukan "Program Baru") — beda variabel (`newBadgeAdmin`/`isProgramBaruAdmin`)
  karena tabelnya beda fungsi render, tapi ambang waktu 3 hari HARUS
  disinkronkan manual kalau salah satu diubah.
- CSS: class `.new-badge` di `css/style.css`, palet orange muda
  (`background:#FFEDD5; color:#C2410C;`), pola sama dengan
  `.verified-badge`/`.nearest-badge` di atasnya.

## Catatan UI panel "Edit & Tambah Program" (Manajemen > Edit Program)

- Tombol **Export Data**, **Import Data**, **Hapus Semua Data** (khusus role
  `admin`) sengaja dipindah dari toolbar atas (sejajar tombol Caption Kosong/
  Caption Belum Lengkap) ke **footer di bawah tabel Daftar Program**, supaya
  aksi destruktif (terutama Hapus Semua) tidak nempel dekat tombol lain yang
  sering diklik dan lebih sulit ke-tap tidak sengaja. Markup-nya ada di
  `renderAdminPanel()`, blok `.admin-table-foot-actions` tepat setelah
  `</table>` dan sebelum `.admin-table-card` ditutup.
- Class CSS baru buat footer ini (di `css/style.css`, tepat setelah rule
  `.admin-table-card`): `.admin-table-foot-actions`, `.admin-table-foot-label`,
  `.admin-table-foot-btns`, `.btn-footer-action` (varian `.danger`). Beda dari
  `.btn-icon-ghost` (kotak 36×36 icon-only) yang masih dipakai di toolbar
  Assets/Perusahaan — `.btn-footer-action` punya lebar auto + label teks di
  sebelah ikon, karena berdiri sendiri di footer (bukan sebaris dengan tombol
  ikon lain).
- Kalau nanti mau tambah tombol lain yang sifatnya "kelola data" (bukan
  filter/search/tambah-baru biasa) di panel admin lain, pertimbangkan pola
  yang sama (taruh di footer tabel, bukan toolbar atas) demi konsistensi.
- `clearAllAdminData()` (tombol "Hapus Semua") sekarang **memblokir total**
  kalau masih ada program dengan jamaah aktif (`kb_jamaah.diarsipkan = false`)
  dan/atau pendaftaran yang belum `batal` — konsisten dengan pengecekan di
  `openDeleteModal()`/`confirmDeleteAction()` untuk hapus satu program.
  Sebelumnya fungsi ini loop `deleteProgramById()` langsung tanpa cek apa pun,
  jadi program aktif ikut cascade-delete (kb_jamaah & pembayaran_jamaah-nya)
  cuma bisa dipulihkan lewat snapshot — sekarang dicegah dari awal. Program
  yang jamaahnya SUDAH diarsip (`diarsipkan = true`, lewat "Arsipkan Semua")
  tidak dihitung, jadi tetap boleh ikut kehapus.

## Hotel ke-3 & ke-4 di form Edit & Tambah Program

- Form Akomodasi punya Hotel Makkah & Hotel Madinah (tetap), plus **Hotel 3 & Hotel 4 opsional**
  (id `admin_hotel_3`/`admin_hotel_4` + select kota `admin_hotel_3_kota`/`admin_hotel_4_kota`).
  Barisnya tersembunyi sampai ada isinya: hasil parse, data tersimpan, atau tombol "Tambah Hotel 3/4".
- Disimpan di `admin_data_lengkap` (JSON) sebagai `hotel_3`, `hotel_3_kota`, `hotel_4`, `hotel_4_kota`
  (didaftarkan di `adminOnlyFields` di `saveAdminProgram()`), jadi **tanpa migrasi SQL**.
- Parse "Isi Otomatis" (`parseBroadcastText()`) dan "Parse dengan AI" (`parseBroadcastTextAI()`) memakai
  `extractBroadcastHotels()` + `pickExtraHotels()`: hotel apa pun selain Makkah/Madinah utama
  (hotel Makkah/Madinah kedua, atau kota Jeddah/Thaif/Transit) masuk ke Hotel 3 lalu Hotel 4.
  Lebih dari 2 hotel tambahan: hanya 2 pertama dimuat + toast info.
- Edge Function `parse-broadcast-ai` TIDAK ada di repo ini. Client sudah siap kalau fungsi itu kelak
  mengembalikan `hotel_3`, `hotel_3_kota`, `hotel_3_hari`, `hotel_3_jarak` (dan `hotel_4...`);
  selama belum, parse AI memakai pembaca regex yang sama sebagai cadangan.
- Hint ejaan vs data referensi hanya untuk kota Makkah/Madinah (tabel `hotel_saudi_arabia` cuma berisi dua kota itu).
- Ikut terpakai di `generateAutoWAText()`, `buildRawConceptFromAdminForm()`, dan `buildRawConceptFromProgramRow()`.
- Tabel Edit Program: kolom Hotel 3 / Hotel 4 hanya muncul kalau minimal satu program memakainya
  (`renderAdminTable()`, header `#thAdminHotel3`/`#thAdminHotel4`).
- Modal detail memakai `teks_wa` (atau `generateAutoWAText()` kalau kosong), jadi Hotel 3/4 ikut otomatis.
- Crosscheck poster: `hotel_3`/`hotel_4` dibandingkan seperti Hotel Makkah/Madinah (`cxValuesMatch`,
  `cxCountMismatchForProgram`, `buildCompareRows`, auto-fill, modal Input Data Poster). Edge Function
  `scan-poster-ocr` membaca `hotel_3`, `hotel_3_kota`, `hotel_4`, `hotel_4_kota` dari poster
  (**deploy ulang `scan-poster-ocr`** supaya aktif; tanpa itu Crosscheck hanya membandingkan kalau
  diisi manual lewat "Input Data Poster").
- Export/Import: backup JSON membawa kolom `admin_data_lengkap` apa adanya, jadi Hotel 3/4 otomatis ikut
  ter-backup dan ter-restore (tidak ada kode khusus).

## Kalau menambah/mengubah fitur

- Edit langsung di `js/app.js`, ikuti pola section comment yang sudah ada
- Pakai `showToast(msg, type)` untuk feedback ke user, bukan `alert()`
- Operasi baca (SELECT) yang rawan gagal jaringan → bungkus dengan `withRetry()`
- Operasi tulis (insert/update/upsert) JANGAN dibungkus `withRetry()` — risiko data dobel
- Kalau menambah file baru yang perlu di-load browser, jangan lupa update
  `service-worker.js` (`APP_SHELL` array) supaya PWA cache-nya ikut sinkron, dan naikkan
  `CACHE_NAME` versinya
- Akurasi data finansial adalah prioritas karena datanya dipakai untuk laporan resmi

## Aturan Edge Function (supabase/functions/*)

Daftar fungsi, auth, secret, dan perintah deploy: lihat `supabase/functions/README.md` (sumber utama,
perbarui di sana kalau menambah/mengubah fungsi).

- Edge function **WAJIB berdiri sendiri dalam satu file `index.ts`**. JANGAN `import` dari
  `../_shared/...` atau file lokal lain (mis. `./postprocess.ts`): deploy bisa dilakukan lewat
  **Supabase Dashboard** (paste satu file), dan Dashboard hanya membundel file fungsi itu
  sendiri, jadi impor lokal gagal dengan "Module not found ... _shared/gemini.ts".
- Kalau butuh helper bersama (fallback multi-key Gemini, pasca-proses caption), **salin helper-nya
  inline** ke tiap `index.ts` yang memakainya (contoh: `generate-ig-content-plan`,
  `generate-ig-caption`, `scan-poster-ocr`). Kalau helper diperbaiki, salinan di tiap fungsi perlu
  diperbarui manual. `_shared/gemini.ts` hanya acuan.
- Impor dari URL/paket luar (`https://esm.sh/...`, `jsr:`, `npm:`) tetap boleh. Yang dilarang hanya impor file lokal.
- Fungsi yang dipanggil user login: verifikasi token ke Supabase Auth, lalu cek
  `dashboard_profiles.dashboard_role` pakai service role. Jangan percaya klaim dari client dan
  jangan terima header `apikey` sebagai kredensial (selalu ikut di tiap request).
- Saat mengirim hasil kerja, sebut fungsi mana yang perlu di-deploy ulang. Untuk fungsi yang
  diubah, kirim `index.ts`-nya utuh supaya bisa langsung di-paste ke Dashboard.
- Masalah yang diketahui: `generate-wa-caption` masih import `_shared/gemini.ts` (melanggar aturan
  di atas); `app.js` memanggil `parse-broadcast-ai`, `generate-tg-reminder`,
  `generate-payment-reminder-wa`, `sync-infografis` yang source-nya tidak ada di repo;
  `login-dashboard` sudah legacy (digantikan Supabase Auth).

## Testing & deploy frontend

- `npm test` menjalankan `tests/test-core.js` (memuat `app.js` lewat `vm` dengan mock DOM).
  Fungsi baru yang murni dan kritis (uang, tanggal, escaping) sebaiknya ditambah ke test dan
  diekspos di `globalThis.__T`. `npm run test:edge` menguji generator rencana konten IG.
- Frontend: `npx wrangler deploy` (tanpa build step), pastikan `.assetsignore` ada. Detail dan
  troubleshooting di `CHECKLIST_DEPLOY.md` bagian 8 (bagian JWT Signing Key/`login-dashboard`
  di file itu sudah usang).
- Naikkan `CACHE_NAME` di `service-worker.js` setiap `index.html`/CSS/`app.js` berubah.

## Cara kirim hasil kerja (deploy ke GitHub)

Kalau perubahan cuma menyentuh sebagian kecil file (bukan restrukturisasi besar),
**kirim file yang berubah saja satu-satu**, JANGAN re-zip seluruh folder proyek.
User tinggal replace file itu langsung di repo lalu push — re-zip seluruh proyek
cuma buang-buang waktu/token dan bikin user harus extract & diff manual buat
cari apa yang sebenarnya berubah.

## About Planner (konsep perencanaan konten, IG Scheduler)

Tombol **About Planner** di sebelah "Perencanaan Konten" (halaman IG Scheduler) membuka modal `#igAboutPlannerModal`
berisi konsep perencanaan konten Amiru yang bisa dibaca, disalin ("Salin untuk Claude"), dan diunduh (.md).

- **Sumber tunggal teks:** konstanta `ABOUT_PLANNER_MD` di `js/app.js` (section 24e). Header modal (Versi, Diperbarui)
  dibaca otomatis dari dua baris `Versi:` dan `Diperbarui:` di awal dokumen, jadi format dua baris itu jangan diubah.
  Teksnya template literal: jangan pakai karakter backtick atau urutan dollar-kurung-kurawal di dalamnya.
- `ABOUT_PLANNER_PETUNJUK` ikut tersalin di depan dokumen, menyuruh Claude mengembalikan dokumen UTUH, menaikkan Versi,
  dan menambah baris di "Riwayat Revisi".
- **Alur revisi:** salin/unduh > ubah di Claude > unggah hasilnya ke sesi pengembangan. Saat menerima dokumen revisi:
  1. Ganti isi `ABOUT_PLANNER_MD` dengan dokumen revisi (buang bagian petunjuk dan "Dampak ke sistem" kalau ikut terbawa).
  2. Pastikan Versi naik dan Riwayat Revisi bertambah.
  3. Sinkronkan aturan yang berubah ke logika yang benar-benar berjalan, sesuai bagian "Dampak ke sistem":
     `IG_PLAN_PROMPT_SISTEM`, `IG_POLA_AMIRU`, `IG_ALUR_GRUP` (bank alur per fase + bobot; `IG_TEMA_ALUR` diturunkan darinya)/`IG_TEMA_MUSIM`, `IG_JEDA_TOPIK_BULAN`, `IG_JEDA_TEMA_MUSIM_HARI`, edge function
     `generate-ig-content-plan` dan `generate-ig-caption` (deploy ulang kalau berubah), serta `pola-konten.md`.
  4. Naikkan `CACHE_NAME` di `service-worker.js`.
  Mengubah teks About Planner saja TIDAK mengubah perilaku generator; generator hanya berubah lewat langkah 3.

