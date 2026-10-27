# CHECKLIST DEPLOY — Dashboard Amiru

Urutan supaya dashboard jalan (baca data **dan** bisa login/tulis). Kondisi terkini: login memakai **Supabase Auth**,
frontend dideploy ke **Cloudflare Workers Static Assets**, dan ada satu langkah build ringan (`npm run release`).

Ringkasan jalur SQL: `sql/00_SETUP_LENGKAP_SATU_FILE.sql` = kondisi akhir migrasi 01-56 dan 58 (idempoten, **bebas urutan**).
Dua migrasi **tidak** ikut di dalamnya dan wajib dijalankan sesudahnya: `57` dan `59`.

---

## 0. PERSIAPAN SEBELUM DEPLOY (penyebab error PGRST301)

Error di konsol:
```
PGRST301: None of the keys was able to decode the JWT
```
artinya `js/app.js` menunjuk ke Supabase project **A**, tetapi token login berasal dari project **B**. Satu project salah
= seluruh dashboard mati (token login ditempel ke SEMUA request).

**Pastikan konsisten:** URL + anon key di `js/app.js` baris 4-5 harus sama persis dengan project tempat SQL dijalankan dan
Edge Function dideploy.

- `js/app.js:4` → `SUPABASE_URL`
- `js/app.js:5` → `SUPABASE_ANON_KEY`

Workflow `keep-supabase-alive` membaca dua nilai itu dari `js/app.js` juga, jadi tidak ada secret repo yang perlu disamakan.
Jangan ubah format deklarasinya (`const SUPABASE_URL = "..."`).

---

## 1. SETUP SUPABASE (SQL)

1. Buka Supabase Dashboard → project yang **sama** dengan `js/app.js` → **SQL Editor**.
2. New Query → paste isi `sql/00_SETUP_LENGKAP_SATU_FILE.sql` → **Run**. Tidak boleh ada error merah (idempoten, aman diulang).
3. Jalankan **dua migrasi yang tidak ada di 00**, masing-masing New Query → Run:
   - `sql/57_tambah_programs_poster_version.sql` (kolom `programs.poster_version`, dipakai tombol Refresh Poster)
   - `sql/59_tambah_view_total_bayar.sql` (view `v_total_bayar`; **wajib sebelum frontend dipakai**, kalau tidak total bayar dan status Lunas/DP gagal dimuat)
   - `sql/60_tambah_dokumentasi_kegiatan.sql` (tabel `dokumentasi_kegiatan`, untuk menu Social Media > Dokumentasi; tanpa ini menu menampilkan pesan agar migrasi dijalankan)
4. Opsional: `sql/40_update_hotel_saudi_arabia_2026_10.sql` untuk mengisi data referensi hotel Arab Saudi (tabelnya sudah dibuat di 00).
   `sql/18` (konversi data pendaftaran lama) hanya perlu di database lama yang masih punya baris status `baru`.
5. Buat bucket Storage `ig-media` (**public**) di Dashboard → Storage bila memakai IG Scheduler.
6. (Opsional) isi `tg_config` untuk notifikasi Telegram lewat menu Admin > Telegram, dan data awal `programs`.

> Tabel `app_config` tidak lagi dipakai untuk login. Tidak ada password yang perlu diganti di sana.

---

## 2. AKUN LOGIN (Supabase Auth)

Tabel `dashboard_profiles` (role `admin`/`user`/`guest`) dan helper `current_dashboard_role()` sudah dibuat oleh `sql/00`.
Di project lama yang masih memakai login berbasis password, jalankan dulu `sql/28_migrate_supabase_auth.sql`.

Buat 4 akun awal (sekali saja, lokal, Node 18+, **butuh service role key, jangan ditaruh di kode client**):
```bash
npm install @supabase/supabase-js
SUPABASE_URL="https://<project_ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service_role_key>" \
ADMIN_PASSWORD=... CS_PASSWORD=... USER_PASSWORD=... GUEST_PASSWORD=... \
node scripts/setup-auth-accounts.mjs
```
Akun berikutnya dibuat dari **Admin > Pengaturan User** (butuh Edge Function `admin-create-user` dan `admin-reset-user-password`, bagian 3).
Setelah `sql/00` dijalankan, menu sidebar yang belum ada di `role_menu_access` (Reminder, Status Kepulangan, IG Scheduler, Infografis, Dokumentasi)
default-nya tersembunyi untuk `user`/`guest` sampai admin mengaturnya di Pengaturan User > Akses Menu.

---

## 3. DEPLOY EDGE FUNCTIONS

Butuh **Supabase CLI** (`npm i -g supabase` / `brew install supabase`). `supabase login`, lalu `supabase link --project-ref <PROJECT_REF>`.

Daftar lengkap, auth, secret, dan flag deploy tiap fungsi ada di **`supabase/functions/README.md`** (sumber utama). Ringkasnya:

```bash
# Minimum supaya fitur inti jalan
supabase functions deploy admin-create-user
supabase functions deploy admin-reset-user-password
supabase functions deploy send-telegram --no-verify-jwt
supabase secrets set GEMINI_API_KEY=<apikey_dari_aistudio.google.com/apikey>
supabase functions deploy scan-poster-ocr --no-verify-jwt
supabase functions deploy generate-wa-caption --no-verify-jwt
supabase functions deploy sync-rekap-program        # + secret REKAP_PROGRAM_API_URL

# IG Scheduler dan AI konten (lihat INSTAGRAM_AUTOUPLOAD_SETUP.md)
supabase functions deploy generate-ig-caption --no-verify-jwt
supabase functions deploy generate-ig-content-plan --no-verify-jwt
supabase functions deploy generate-ig-year-plan --no-verify-jwt
supabase functions deploy ig-publish --no-verify-jwt
supabase functions deploy ig-refresh-token --no-verify-jwt
supabase functions deploy ig-sync-comments --no-verify-jwt
supabase functions deploy ig-comment-action
supabase functions deploy ig-manual-retry
```
`SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` otomatis tersedia di runtime Edge Function.

**Jangan deploy `login-dashboard`.** Fungsi itu legacy (digantikan Supabase Auth). Bila sudah terlanjur ter-deploy, undeploy dan hapus secret
`DASHBOARD_JWT_SECRET` dan `DASHBOARD_JWT_KID`. Tidak ada langkah "JWT Signing Key" lagi.

Ada fungsi yang dipanggil `js/app.js` tetapi source-nya belum ada di repo (`parse-broadcast-ai`, `generate-tg-reminder`,
`generate-payment-reminder-wa`, `sync-infografis`); lihat bagian "Ketidaksesuaian" di README functions. Panel **Admin > System**
menampilkan status tiap fungsi (Aktif / Belum ter-deploy / Tidak terjangkau).

---

## 4. SAMAKAN URL/KEY DI APP DAN RILIS

Edit `js/app.js` baris 4-5 dengan URL dan anon key project yang SAMA:
```js
const SUPABASE_URL = "https://<project_ref>.supabase.co";
const SUPABASE_ANON_KEY = "<anon_key_dari_project_yang_sama>";
```
Lalu, **setiap kali** `js/` atau `css/` berubah:
```bash
npm install          # sekali, untuk esbuild
npm run release      # minify -> *.min.*, tempel hash ?v= di index.html
npm run check        # opsional: pastikan semuanya sinkron
npm test
```
Commit file sumber, `*.min.*`, dan `index.html` **bersama-sama**. Naikkan `CACHE_NAME` di `service-worker.js` (sekarang `v159`)
bila `index.html`, CSS, `app.js`, atau modul berubah, supaya PWA tidak memakai cache lama.

---

## 5. TEST DI BROWSER

1. Layani lewat server statis (bukan `file://`):
   ```bash
   npx serve .        # atau: python3 -m http.server
   ```
2. DevTools → **Application → Storage → Clear sessionStorage** (buang sesi login rusak dari sebelumnya).
3. Console: halaman depan (Program Umroh) harus load **tanpa** error 401. Kalau `programs` masih 401: URL/key salah, atau SQL belum dijalankan di project itu.
4. Klik Login, masuk dengan email dan password akun dari bagian 2. Kalau gagal: cek Authentication > Users di Supabase dan baris `dashboard_profiles` akun itu.
5. Coba tambah/edit program. Tulis data butuh role `admin`/`user` (guest read-only, ditolak RLS).
6. Buka Admin > System: semua Edge Function yang Anda deploy harus berstatus Aktif.

---

## 6. CATATAN KEAMANAN (menurut `sql/00`)

Status di bawah dibaca dari kebijakan RLS di `sql/00_SETUP_LENGKAP_SATU_FILE.sql`. Database yang berjalan bisa berbeda
kalau ada policy buatan manual atau migrasi yang belum dijalankan, jadi cek di Dashboard > Authentication > Policies.

| Item | Status | Keterangan |
|---|---|---|
| Password lama di `app_config` | 🟢 | Tertutup total untuk anon; login memakai Supabase Auth |
| Write sembarangan (anon) | 🟢 | Tulis butuh role `admin`/`user` (`current_dashboard_role()`); guest read-only; hapus `programs` dan `pembayaran_jamaah` khusus admin; `assets` tulis admin saja |
| `pembayaran_jamaah`, `assets`, `hotel_*`, akses menu | 🟢 | Baca hanya `authenticated` |
| **`role_menu_access`, `user_menu_access`** | 🟡 | TULIS terbuka untuk semua `authenticated` (termasuk `guest`) lewat API; hanya UI yang membatasinya ke admin. Perketat ke `current_dashboard_role() = 'admin'` bila perlu |
| Tabel IG (`ig_*`) | 🟢 | Admin/user saja (sql/51); `ig_accounts` tidak bisa ditulis client |
| **Telegram bot token (`tg_config`)** | 🔴 | Baca masih publik (`select using (true)`) dan token dibaca client, jadi bisa diambil lewat REST API publik. Kunci ke `authenticated` bila mau aman (fitur Telegram jadi butuh login) |
| **`kb_jamaah` dan `pendaftaran`** | 🔴 | Baca masih publik, padahal berisi NIK/KTP/paspor/WA jamaah |
| **`snapshot_backup`** | 🟡 | Baca publik; isinya salinan data (termasuk data jamaah) |
| **`nota_audit_log`, `kwt_kuitansi`** | 🟡 | Baca publik; insert/hapus dibatasi admin/user (log nota append-only lewat trigger) |
| **`jamaah_audit_log`** | 🟡 | Baca DAN insert terbuka (`with check (true)`): siapa pun dengan anon key bisa menulis baris log |
| 1 client untuk baca + tulis | 🟡 | Token login ditempel ke request baca. Token rusak = data publik ikut mati (PGRST301). Idealnya dipisah (client baca anon vs tulis token) |
| File sisa lama | 🟡 | `utils.js`, `index.ts`, `js/index.html*`, `crosscheck-fix.diff`, dll tidak dipakai; sudah di-ignore `.assetsignore` |
| `PASANG-MANUAL-workflow/` | 🟡 | Belum masuk `.assetsignore`, jadi `BACA-DULU.txt` dan salinan workflow ikut terpublish. Tidak berbahaya tetapi tidak perlu; tambahkan ke `.assetsignore` |

---

## 7. RINGKASAN PERINTAH (copy-paste)

```bash
# 1. (SQL Editor) jalankan berurutan: sql/00_SETUP_LENGKAP_SATU_FILE.sql, sql/57_..., sql/59_..., sql/60_...
#    (opsional: sql/40_update_hotel_saudi_arabia_2026_10.sql)

# 2. akun login (lokal, sekali)
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ADMIN_PASSWORD=... CS_PASSWORD=... USER_PASSWORD=... GUEST_PASSWORD=... \
  node scripts/setup-auth-accounts.mjs

# 3. Edge Function (sudah supabase login & link): lihat bagian 3 dan supabase/functions/README.md

# 4. edit js/app.js baris 4-5 -> URL & anon key project yang SAMA, lalu
npm install && npm run release && npm test

# 5. uji lokal
npx serve .

# 6. deploy frontend (pastikan .assetsignore ada di root) -> lihat bagian 8
npx wrangler deploy
```

---

## 8. DEPLOY FRONTEND KE CLOUDFLARE (Workers Static Assets)

Frontend = file statis di root repo (`index.html`, `js/`, `css/`, dst.), dilayani Cloudflare lewat `wrangler.jsonc`
(`"assets": {"directory": "."}`). Cloudflare **tidak menjalankan build**: file `*.min.*` hasil `npm run release` harus sudah di-commit.

### 8a. Pengaturan di Cloudflare (Workers & Pages → project `dashboard` → Settings → Builds)
- Build command: *(kosongkan)*
- Deploy command: `npx wrangler deploy`
- Root directory: `/`

### 8b. `.assetsignore` WAJIB ada di root repo
Karena `directory` = `.`, tanpa `.assetsignore` seluruh isi repo ikut terpublish (`sql/`, `supabase/`, `scheduler/`, skrip, semua `.md`).
Yang dipakai untuk aset adalah **`.assetsignore`**, bukan `.wranglerignore`. Kalau menambah folder/file internal baru (bukan bagian web),
tambahkan juga ke `.assetsignore`. File sumber `css/*.css`, `js/app.js`, dan `js/modules/*.js` juga di-ignore (browser hanya memuat `*.min.*`,
yang dikecualikan lewat baris `!`), jadi hasil `npm run release` WAJIB ikut di-commit. Kalau menambah file web baru di folder yang sudah
di-ignore, keluarkan dulu dari daftar.

> Upload lewat dashboard GitHub: file berawalan titik disembunyikan oleh file picker.
> Buat langsung di GitHub: **Add file → Create new file** → nama `.assetsignore` (atau `.github/workflows/...`).

### 8c. Troubleshooting
| Gejala | Penyebab | Solusi |
|---|---|---|
| `Cloning repository...` lalu `Failed: error occurred while fetching repository` (menggantung ~10 menit) | Gagal di sisi Cloudflare↔GitHub, **bukan** kode. Biasanya integrasi GitHub bermasalah atau history repo terlalu besar | Retry; Disconnect lalu Connect ulang repo di Settings → Builds; cek akses app *Cloudflare Workers & Pages* di GitHub; cek `git count-objects -vH` (kalau `size-pack` ratusan MB, bersihkan history) |
| Clone terus gagal | — | Deploy manual: `npx wrangler login` lalu `npx wrangler deploy` dari root repo |
| Perubahan kode tidak terlihat di browser | `npm run release` lupa dijalankan, atau `CACHE_NAME` tidak dinaikkan | Jalankan `npm run check` (gagal = ada `*.min.*`/hash basi), commit hasilnya, naikkan `CACHE_NAME` |

### 8d. Worker terpisah (IG scheduler)
`scheduler/` adalah Worker cron tersendiri, **bukan** bagian deploy dashboard:
```bash
npx wrangler deploy --config scheduler/wrangler.toml
npx wrangler secret put SUPABASE_FUNCTIONS_URL --config scheduler/wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config scheduler/wrangler.toml
```
Cron: `*/15 * * * *` (ig-publish dan ig-sync-comments) dan `0 9 * * 1` (ig-refresh-token, Senin 09:00 UTC).

### 8e. Workflow GitHub Actions
- `keep-supabase-alive` (tiap 3 hari): tanpa secret.
- `auto-generate-konten` (Minggu 03:00 WIB): secret `AUTO_BOT_EMAIL` dan `AUTO_BOT_PASSWORD`; setup di `README_ig_scheduler.md`.
