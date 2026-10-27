# Dashboard Amiru

Dashboard web (PWA) untuk **PT Amiru Haramain Indonesia** (travel Umroh). Dipakai tim internal untuk mengelola program Umroh, data jamaah, pembayaran, kuitansi, dan konten Instagram, dengan notifikasi Telegram dan fitur AI (Gemini) di sisi server.

- **Frontend:** vanilla JavaScript, HTML, CSS. Tanpa framework. Satu langkah build ringan (`npm run release`, esbuild) hanya untuk minify dan memberi versi cache `?v=<hash>`; hasilnya di-commit ke repo.
- **Backend:** Supabase (Postgres + RLS, Auth, Storage, Edge Functions).
- **Hosting:** Cloudflare Workers Static Assets. Worker cron terpisah untuk IG Scheduler.
- **Bahasa UI dan komentar kode:** Bahasa Indonesia.

## Fitur utama

| Area | Isi |
|---|---|
| Program Umroh | Daftar program, program unggulan, badge "Program Baru", detail dan teks WhatsApp otomatis |
| Operasional jamaah | Pendaftaran, Data Jamaah (Keberangkatan), Kelengkapan Dokumen, Status Kepulangan, Arsip Jamaah |
| Keuangan | Pembayaran dan cicilan, kuitansi PDF (jsPDF), nomor nota resmi dari database, Audit Nota (append-only) |
| Jadwal | Jadwal Tamu dan Reminder (To-Do CS) |
| Social Media | IG Scheduler (jadwal, kalender, rencana konten AI dan Rencana Setahun, tasklist, About Planner; publish otomatis dan komentar tersedia tetapi dimatikan lewat `IG_AUTOPUBLISH_ENABLED = false`), Infografis, Rekap Program, Microblog, Dokumentasi (halaman mandiri tanpa header dashboard; jadwal dan dokumentasi kegiatan umroh dari berangkat sampai pulang, dengan kartu ringkasan Total/Belum Diambil/Sudah Diambil/Sudah Diposting: shot list, status ambil/posting, link Drive, template alur umroh, dan tombol "jadikan ide konten" ke Perencanaan Konten) |
| Katalog publik | `katalog.html` dan `katalog-flip.html` (flipbook), halaman mandiri tanpa login |
| Manajemen dan System | Edit Program (hotel 1-4, parse broadcast WA dengan AI), Pembayaran, Audit Nota, Crosscheck poster vs data (OCR), Telegram, Pengaturan User dan akses menu, Snapshot backup, Assets (termasuk referensi hotel Saudi), Perusahaan, System (status API dan Edge Function) |

## Role dan akses

| Role | Akses |
|---|---|
| Anonim (belum login) | Hanya Program Umroh dan Unggulan |
| `guest` | Semua tab data yang boleh dibuka, **read-only**. Ditolak juga oleh RLS database, bukan hanya disembunyikan di UI |
| `user` | Baca dan tulis data operasional |
| `admin` | Semua akses, termasuk Manajemen dan System |

Akses menu sidebar untuk `user` dan `guest` bisa diatur per role dan per akun lewat **Pengaturan User**. Login memakai **Supabase Auth**. Akun dibuat lewat `scripts/setup-auth-accounts.mjs` (akun awal) dan Pengaturan User (akun baru).

## Arsitektur

```
Browser (PWA: index.html + js/app.min.js + 13 css/*.min.css; modul besar di js/modules/*.min.js
          dimuat lazy saat dibutuhkan, termasuk css/ig-scheduler.min.css)
   │  supabase-js (anon key + JWT login)        fetch() ke Edge Function
   ▼                                                    ▼
Supabase: Postgres + RLS + Auth + Storage      Supabase Edge Functions (Deno)
                                                   │            │
                                                   ▼            ▼
                                          Gemini API     Telegram / Instagram Graph API
                                                              ▲
Cloudflare Worker cron (scheduler/) ── tiap 15 menit ─────────┘  ig-publish, ig-sync-comments
                                    └─ Senin 09:00 UTC ─────────  ig-refresh-token
```

Detail Edge Function ada di [`supabase/functions/README.md`](supabase/functions/README.md). Detail modul Instagram ada di [`README_ig_scheduler.md`](README_ig_scheduler.md).

## Struktur repo

```
index.html              Struktur HTML. Memuat js/app.min.js dan css/*.min.css ber-?v=<hash>; daftar versi modul lazy ada di <script id="moduleVersions">
js/app.js               Sumber JS inti (~10.800 baris): logic utama, koneksi Supabase, loader modul lazy (LAZY_MODULES)
js/modules/*.js         Sumber 16 modul lazy: ig-scheduler, dokumentasi, crosscheck, dokumen, kepulangan, manifest, rooming, pengaturan-user,
                        assets, nota, pembayaran, audit-nota, cicilan, profil-perusahaan, snapshot, telegram
js/*.min.js, css/*.min.css, js/modules/*.min.js
                        HASIL build (yang benar-benar dimuat browser). Jangan diedit; dibuat ulang oleh npm run release
css/*.css               Sumber CSS: style.css (inti) + 14 modul (dokumentasi (lazy), rekap-infografis, snapshot, jadwal-tamu, assets, hotel, detail-program,
                        telegram, kepulangan, rooming, user-akses, keuangan, crosscheck, ig-scheduler). ig-scheduler dimuat lazy
katalog.html            Katalog publik mandiri (CSS+JS inline)
katalog-flip.html       Versi flipbook katalog publik, juga mandiri
manifest.json           Konfigurasi PWA
service-worker.js       Aset ber-hash cache-first, sisanya network-first; CACHE_NAME dinaikkan tiap rilis
icons/, assets/         Ikon PWA dan logo (aktif: assets/logo-amirutour.png)
sql/                    Skema dan migrasi (00 = setup satu file untuk 01-56 dan 58; 57, 59, dan 60 dijalankan terpisah; 18, 39, 40 data/konversi)
supabase/functions/     16 Edge Function (Deno/TypeScript) + _shared/gemini.ts (acuan)
scheduler/              Cloudflare Worker cron untuk IG Scheduler (deploy terpisah)
apps-script/            Google Apps Script untuk listing folder Drive (Infografis, Rekap Program)
scripts/                build.mjs, stamp-versions.mjs (rilis), setup-auth-accounts.mjs (sekali jalan), auto-generate-konten.mjs (workflow konten IG)
tests/                  9 suite tes tanpa dependency (npm test); test-core.js di root = tes IG (npm run test:ig)
.github/workflows/      keep-supabase-alive.yml (ping tiap 3 hari), auto-generate-konten.yml (Minggu 03:00 WIB)
PASANG-MANUAL-workflow/ Salinan kedua workflow + petunjuk pasang manual lewat web GitHub (bukan bagian deploy)
wrangler.jsonc          Konfigurasi deploy frontend ke Cloudflare
.assetsignore           Daftar file yang TIDAK boleh ikut terpublish (wajib ada)
```

> Yang dimuat browser hanya `js/app.min.js`, modul di `js/modules/*.min.js`, dan `css/*.min.css`. File lepas lain di root atau `js/`
> (`utils.js`, `index.ts`, `js/index.html`, `js/index.html.DISABLED_BUG`, `crosscheck-fix.diff`, `logo-amirutour.png` di root,
> `setup-auth-accounts.mjs` di root) adalah sisa lama yang tidak dipakai. `test-core.js` di root BUKAN sisa lama (dijalankan `npm run test:ig`).
> Begitu juga `style.css` lepas: yang aktif selalu `css/style.css` (+ modul di `css/`).

## Mulai dari nol

Butuh: akun Supabase, akun Cloudflare, Node.js 18+, dan Supabase CLI (`npm i -g supabase`).

1. **Database.** Di Supabase SQL Editor, jalankan `sql/00_SETUP_LENGKAP_SATU_FILE.sql` (idempoten, aman diulang; isinya kondisi akhir migrasi 01-56 dan 58). Lalu jalankan `sql/57_tambah_programs_poster_version.sql` dan `sql/59_tambah_view_total_bayar.sql`, dua migrasi yang BELUM termasuk di 00 (59 wajib ada sebelum frontend dipakai). Opsional: `sql/40_update_hotel_saudi_arabia_2026_10.sql` untuk mengisi data hotel Saudi. Untuk project yang sudah berjalan, jalankan hanya migrasi baru dari `sql/` sesuai nomor urut.
2. **Akun login.** Tabel `dashboard_profiles` dan helper role sudah ada di `sql/00` (isi `sql/28` tercakup di sana; `sql/28` hanya dijalankan terpisah di project lama yang belum bermigrasi dari login berbasis password). Buat 4 akun awal dengan `scripts/setup-auth-accounts.mjs` (sekali saja, butuh service role key, jangan pernah ditaruh di kode client). Akun berikutnya dibuat dari Pengaturan User.
3. **Edge Function.** Deploy fungsi yang dibutuhkan dan set secret-nya. Lihat [`supabase/functions/README.md`](supabase/functions/README.md).
4. **Konfigurasi frontend.** Isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di `js/app.js` (bagian "Supabase Config", baris 4-5) dengan project yang **sama** dengan tempat SQL dan fungsi dideploy, lalu `npm run release`. Project yang tidak cocok menyebabkan error `PGRST301`.
5. **Instagram (opsional).** Ikuti `INSTAGRAM_AUTOUPLOAD_SETUP.md`: Meta App, tabel `ig_*` (sudah ada di 00), bucket Storage `ig-media` (dibuat manual, public), dan Worker di `scheduler/`. Auto-publish dan sinkron komentar baru aktif bila `IG_AUTOPUBLISH_ENABLED` di `js/app.js` diubah ke `true`. Pembuatan konten otomatis mingguan: lihat `README_ig_scheduler.md` bagian "Generate Konten Otomatis".
6. **Workflow GitHub.** `keep-supabase-alive` tidak butuh secret: URL dan anon key dibaca langsung dari `js/app.js` (keduanya memang publik), jadi selalu sama dengan project yang dipakai aplikasi (format `const SUPABASE_URL = "..."` jangan diubah). Secret `SUPABASE_URL` / `SUPABASE_ANON_KEY` lama di repo boleh dihapus. `auto-generate-konten` butuh secret `AUTO_BOT_EMAIL` dan `AUTO_BOT_PASSWORD`. Kalau folder `.github` terlewat saat ekstrak/salin, ikuti `PASANG-MANUAL-workflow/BACA-DULU.txt`.

### Menjalankan lokal

Layani folder ini lewat server statis, jangan buka dengan `file://`:

```bash
npx serve .          # atau: python3 -m http.server
```

Browser memuat file `*.min.*` hasil build yang sudah ada di repo. Kalau Anda mengubah `js/` atau `css/`, jalankan dulu `npm install` (sekali, untuk esbuild) lalu `npm run release`, kalau tidak perubahan tidak terlihat dan service worker bisa melayani versi lama.

Bersihkan `sessionStorage` di DevTools bila sebelumnya ada sesi login yang rusak.

## Deploy

**Frontend (Cloudflare Workers Static Assets):** build command kosong, deploy command `npx wrangler deploy`, root `/`. Karena `directory` di `wrangler.jsonc` adalah `.`, file `.assetsignore` wajib ada agar `sql/`, `supabase/`, `scheduler/`, skrip setup, dan semua `.md` tidak ikut terpublish. Untuk folder atau file internal baru, tambahkan ke `.assetsignore`. Troubleshooting ada di `CHECKLIST_DEPLOY.md` bagian 8.

**IG Scheduler (Worker terpisah):**

```bash
npx wrangler deploy --config scheduler/wrangler.toml
npx wrangler secret put SUPABASE_FUNCTIONS_URL --config scheduler/wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config scheduler/wrangler.toml
```

**Setiap rilis:**

1. Edit file sumber (`js/app.js`, `js/modules/*.js`, `css/*.css`), jangan file `*.min.*`.
2. `npm run release` (build + tempel hash `?v=` di `index.html`), lalu commit sumber, `*.min.*`, dan `index.html` bersama-sama. `npm run check` memastikan semuanya sinkron (cocok untuk CI).
3. Naikkan `CACHE_NAME` di `service-worker.js` (sekarang `amiru-repo-cache-v159`) bila `index.html`, CSS, `app.js`, atau modul berubah, supaya PWA tidak memakai cache lama.
4. `npm test`, lalu `npx wrangler deploy`. Cloudflare tidak menjalankan build, jadi hasil minify harus sudah ada di repo.

## Testing

```bash
npm test             # 9 suite di tests/ (fungsi inti, modul lazy, service worker, CSS lazy, total bayar, retry, konten otomatis, About Planner, Dokumentasi)
npm run test:ig      # test-core.js di root: logika IG Scheduler / Perencanaan Konten
npm run test:edge    # generator rencana konten IG di edge function (butuh Node dengan --experimental-strip-types, mis. Node 22)
npm run check        # file *.min.* dan versi di index.html sinkron dengan sumber
```

Tes memuat `app.js` dan modul lewat `vm` dengan mock DOM dan Supabase tiruan, tanpa jaringan. Lihat `tests/README.md`.

## Aturan pengembangan singkat

- Edit file sumber: `js/app.js` untuk inti, atau modul yang sesuai di `js/modules/`. Ikuti pola komentar section yang ada. Jangan edit `*.min.*`.
- Fungsi baru di modul lazy yang dipanggil dari `index.html` atau kode inti sebelum modul termuat harus didaftarkan di `LAZY_MODULES[...].api` (`js/app.js`). Jangan deklarasi ulang nama yang sudah ada di `app.js` (SyntaxError, seluruh modul gagal).
- Feedback ke pengguna pakai `showToast()`, bukan `alert()`.
- Operasi **baca** yang rawan gagal jaringan dibungkus `withRetry()`. Operasi **tulis** jangan, untuk menghindari data dobel.
- Menu sidebar baru ditambahkan sebagai satu baris di `NAV_MENU` (`js/app.js`). Isi `reg: { group }` kalau menu itu harus bisa diatur lewat Pengaturan User > Akses Menu; `SIDEBAR_MENU_REGISTRY` diturunkan otomatis.
- Akurasi data finansial adalah prioritas: status pembayaran dihitung dari `SUM(pembayaran_jamaah.jumlah)` terhadap `programs.harga_quint`, refund disimpan sebagai baris negatif, dan total dibayar dibaca dari view `v_total_bayar` lewat `fetchTotalBayar()`.
- Edge Function harus berdiri sendiri dalam satu `index.ts` (lihat README functions).
- Perubahan kecil: kirim satu zip berisi file yang berubah saja, dengan path sesuai struktur repo, tidak perlu re-zip seluruh proyek.

## Dokumen lain di repo

| File | Isi |
|---|---|
| `CLAUDE.md` | Konteks mendalam untuk pengembangan (modul lazy, build dan rilis, peta `app.js`, alur pembayaran, aturan Edge Function) |
| `CHECKLIST_DEPLOY.md` | Urutan setup dan deploy (SQL, akun Supabase Auth, Edge Function, frontend Cloudflare) dan catatan keamanan |
| `supabase/functions/README.md` | Daftar Edge Function, auth, secret, deploy, dan ketidaksesuaian yang perlu ditindaklanjuti |
| `INSTAGRAM_AUTOUPLOAD_SETUP.md`, `README_ig_scheduler.md` | Setup dan arsitektur IG Scheduler |
| `pola-konten.md`, `CHECKLIST_TAHUNAN_IG.md` | Pola konten Instagram dan checklist tahunan generator |
| `tests/README.md` | Isi dan cara menjalankan suite tes |
| `CATATAN_AKSES_MENU_USER.md`, `CATATAN_PEMBERSIHAN.md`, `LAPORAN_BUG.md` | Catatan historis dan laporan analisis (bukan kondisi terkini) |

## Keamanan

- `SUPABASE_SERVICE_ROLE_KEY` hanya untuk server (Edge Function, Worker, skrip setup), tidak pernah di client atau repo.
- Anon key di `js/app.js` memang publik. Perlindungan data ada di RLS (`sql/26`, `27`, `29`, `51`; kondisi akhirnya ada di `sql/00`).
- `CHECKLIST_DEPLOY.md` bagian 6 mencatat risiko yang masih terbuka menurut `sql/00`: `tg_config` (token bot Telegram), `snapshot_backup`, serta tabel jamaah (`kb_jamaah`, `pendaftaran`) masih bisa dibaca publik, dan `jamaah_audit_log` menerima insert tanpa login. Verifikasi kebijakan RLS di database yang berjalan.
