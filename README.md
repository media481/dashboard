# Dashboard Amiru

Dashboard web (PWA) untuk **PT Amiru Haramain Indonesia** (travel Umroh). Dipakai tim internal untuk mengelola program Umroh, data jamaah, pembayaran, kuitansi, dan konten Instagram, dengan notifikasi Telegram dan fitur AI (Gemini) di sisi server.

- **Frontend:** vanilla JavaScript, HTML, CSS. Tanpa framework dan tanpa build step.
- **Backend:** Supabase (Postgres + RLS, Auth, Storage, Edge Functions).
- **Hosting:** Cloudflare Workers Static Assets. Worker cron terpisah untuk IG Scheduler.
- **Bahasa UI dan komentar kode:** Bahasa Indonesia.

## Fitur utama

| Area | Isi |
|---|---|
| Program Umroh | Daftar program, program unggulan, badge "Program Baru", detail dan teks WhatsApp otomatis |
| Operasional jamaah | Pendaftaran, Data Jamaah (Keberangkatan), Kelengkapan Dokumen, Status Kepulangan, Arsip Jamaah |
| Keuangan | Pembayaran dan cicilan, kuitansi PDF (jsPDF), nomor nota resmi dari database, Audit Nota (append-only) |
| Jadwal | Jadwal Tamu dan Reminder |
| Social Media | IG Scheduler (jadwal, kalender, publish otomatis, komentar, rencana konten AI) dan Infografis |
| Manajemen dan System | Edit Program, Crosscheck poster vs data (OCR), Telegram, Pengaturan User dan akses menu, Snapshot backup, Assets (termasuk referensi hotel Saudi), Perusahaan |

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
Browser (PWA: index.html + js/app.js + css/style.css + css/rekap-infografis.css + css/hotel.css + css/ig-scheduler.css + css/user-akses.css + css/keuangan.css + css/crosscheck.css)
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
index.html              Struktur HTML; memuat css/style.css, css/rekap-infografis.css, css/hotel.css, css/ig-scheduler.css, css/user-akses.css, css/keuangan.css, css/crosscheck.css, dan js/app.js
js/app.js               SATU-SATUNYA file JS aktif (seluruh logic + koneksi Supabase)
css/style.css           CSS inti (warna brand via CSS custom properties, layout, komponen umum)
css/rekap-infografis.css Modul CSS Rekap Program & Infografis (.rekap-*, .infografis-*, .poster-popup*, .poster-missing-badge, .metric-clickable)
css/hotel.css           Modul CSS Hotel Saudi Arabia (.hotel-*, hint hotel di form Program, #btnAddHotelExtra)
css/ig-scheduler.css    Modul CSS IG Scheduler (dimuat setelah style.css; modul lain menyusul bertahap)
css/user-akses.css      Modul CSS User & Akses Menu (.us-*, .rma-*)
css/keuangan.css        Modul CSS Keuangan (.pb-*, .cicilan-*, .nota-*, .kuitansi-*, .an-* Audit Nota)
css/crosscheck.css      Modul CSS Crosscheck OCR poster (.cx-*, @keyframes cxFieldFlash)
manifest.json           Konfigurasi PWA
service-worker.js       Precache + network-first; CACHE_NAME dinaikkan tiap rilis
icons/, assets/         Ikon PWA dan logo
sql/                    Skema dan migrasi (00 = setup lengkap satu file, 01-56 = migrasi bertahap)
supabase/functions/     Edge Function (Deno/TypeScript)
scheduler/              Cloudflare Worker cron untuk IG Scheduler (deploy terpisah)
apps-script/            Google Apps Script untuk listing folder Drive (Infografis, Rekap Program)
scripts/                Skrip setup sekali jalan (setup-auth-accounts.mjs)
tests/                  Test minimal tanpa dependency
.github/workflows/      keep-supabase-alive.yml (ping tiap 3 hari)
wrangler.jsonc          Konfigurasi deploy frontend ke Cloudflare
.assetsignore           Daftar file yang TIDAK boleh ikut terpublish (wajib ada)
```

> Hanya `js/app.js` yang dimuat `index.html`. File `.js` lepas lain di root atau `js/` (`utils.js`, `test-core.js`, `js/index.html`, dan sejenisnya) adalah sisa lama. Cek dulu apakah direferensikan sebelum diedit. Begitu juga `style.css` lepas di root: yang aktif selalu `css/style.css` (+ modul di `css/`).

## Mulai dari nol

Butuh: akun Supabase, akun Cloudflare, Node.js 18+, dan Supabase CLI (`npm i -g supabase`).

1. **Database.** Di Supabase SQL Editor, jalankan `sql/00_SETUP_LENGKAP_SATU_FILE.sql` (idempoten, aman diulang). Untuk project yang sudah berjalan, jalankan hanya migrasi baru dari `sql/` sesuai nomor urut.
2. **Akun login.** Jalankan `sql/28_migrate_supabase_auth.sql`, lalu `scripts/setup-auth-accounts.mjs` (sekali saja, butuh service role key, jangan pernah ditaruh di kode client).
3. **Edge Function.** Deploy fungsi yang dibutuhkan dan set secret-nya. Lihat [`supabase/functions/README.md`](supabase/functions/README.md).
4. **Konfigurasi frontend.** Isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di `js/app.js` (bagian "Supabase Config" di baris paling atas) dengan project yang **sama** dengan tempat SQL dan fungsi dideploy. Project yang tidak cocok menyebabkan error `PGRST301`.
5. **Instagram (opsional).** Ikuti `INSTAGRAM_AUTOUPLOAD_SETUP.md`: Meta App, tabel `ig_*`, bucket Storage `ig-media`, dan Worker di `scheduler/`.
6. **Secret GitHub (opsional).** Set `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di repo agar workflow `keep-supabase-alive` jalan, supaya project free tier tidak auto-pause.

### Menjalankan lokal

Tidak ada build step. Layani folder ini lewat server statis, jangan buka dengan `file://`:

```bash
npx serve .          # atau: python3 -m http.server
```

Bersihkan `sessionStorage` di DevTools bila sebelumnya ada sesi login yang rusak.

## Deploy

**Frontend (Cloudflare Workers Static Assets):** build command kosong, deploy command `npx wrangler deploy`, root `/`. Karena `directory` di `wrangler.jsonc` adalah `.`, file `.assetsignore` wajib ada agar `sql/`, `supabase/`, `scheduler/`, skrip setup, dan semua `.md` tidak ikut terpublish. Untuk folder atau file internal baru, tambahkan ke `.assetsignore`. Troubleshooting ada di `CHECKLIST_DEPLOY.md` bagian 8.

**IG Scheduler (Worker terpisah):**

```bash
npx wrangler deploy --config scheduler/wrangler.toml
npx wrangler secret put SUPABASE_FUNCTIONS_URL --config scheduler/wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config scheduler/wrangler.toml
```

**Setiap rilis:** naikkan `CACHE_NAME` di `service-worker.js` bila `index.html`, CSS, atau `app.js` berubah, supaya PWA tidak memakai cache lama.

## Testing

```bash
npm test             # node tests/test-core.js
npm run test:edge    # test generator rencana konten IG (memakai --experimental-strip-types, butuh Node versi baru)
```

`tests/test-core.js` memuat `app.js` lewat `vm` dengan mock DOM minimal, lalu menguji fungsi murni (terbilang rupiah, parsing nominal, estimasi hari, escaping XSS). Lihat `tests/README.md`.

## Aturan pengembangan singkat

- Edit langsung di `js/app.js`, ikuti pola komentar section yang ada.
- Feedback ke pengguna pakai `showToast()`, bukan `alert()`.
- Operasi **baca** yang rawan gagal jaringan dibungkus `withRetry()`. Operasi **tulis** jangan, untuk menghindari data dobel.
- Setiap tab sidebar baru harus didaftarkan juga di `SIDEBAR_MENU_REGISTRY`, kalau tidak role `user`/`guest` tidak bisa diberi akses.
- Akurasi data finansial adalah prioritas: status pembayaran dihitung dari `SUM(pembayaran_jamaah.jumlah)` terhadap `programs.harga_quint`, dan refund disimpan sebagai baris negatif.
- Edge Function harus berdiri sendiri dalam satu `index.ts` (lihat README functions).
- Perubahan kecil: kirim file yang berubah saja, tidak perlu re-zip seluruh proyek.

## Dokumen lain di repo

| File | Isi |
|---|---|
| `CLAUDE.md` | Konteks mendalam untuk pengembangan (peta `app.js`, alur pembayaran, aturan Edge Function). Sebagian angka (mis. jumlah baris `app.js`) sudah usang |
| `CHECKLIST_DEPLOY.md` | Urutan deploy. Bagian JWT Signing Key dan `login-dashboard` sudah usang sejak migrasi ke Supabase Auth |
| `INSTAGRAM_AUTOUPLOAD_SETUP.md`, `README_ig_scheduler.md` | Setup dan arsitektur IG Scheduler |
| `pola-konten.md`, `CHECKLIST_TAHUNAN_IG.md` | Pola konten Instagram dan checklist tahunan generator |
| `CATATAN_AKSES_MENU_USER.md`, `CATATAN_PEMBERSIHAN.md`, `LAPORAN_BUG.md` | Catatan historis dan laporan analisis |

## Keamanan

- `SUPABASE_SERVICE_ROLE_KEY` hanya untuk server (Edge Function, Worker, skrip setup), tidak pernah di client atau repo.
- Anon key di `js/app.js` memang publik. Perlindungan data ada di RLS (`sql/26`, `27`, `29`, `51`).
- `CHECKLIST_DEPLOY.md` bagian 6 mencatat dua risiko terbuka: token bot Telegram di `tg_config` dan akses `snapshot_backup`. Catatan itu ditulis sebelum hardening RLS terbaru, jadi verifikasi dulu kebijakan RLS di database sebelum menganggapnya masih berlaku.
