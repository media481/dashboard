# SETUP INSTAGRAM AUTO-UPLOAD — IG Scheduler

Panduan supaya menu **Social Media → IG Scheduler** benar-benar bisa
publish otomatis ke Instagram (bukan cuma tampil di dashboard).

> Fitur ini sudah lengkap kodenya (Edge Function + tabel + Cloudflare
> Worker cron), tapi **belum bisa jalan out-of-the-box** — ada beberapa
> bagian yang wajib kamu isi/setup manual dulu:
> 1. Akun Instagram Business/Creator + Meta App (dapat token akses).
> 2. Migrasi tabel database (`ig_accounts`, `ig_posts`, dst).
> 3. Storage bucket `ig-media` (belum ada SQL/migrasinya).
> 4. Deploy 4 Edge Function ke Supabase.
> 5. Deploy 1 Cloudflare Worker (cron trigger tiap 15 menit).
>
> Baca sampai bagian **Catatan Penting** di paling bawah sebelum deploy —
> ada 1 known issue di alur refresh token yang perlu kamu putuskan cara
> menanganinya.

---

## 0. ALUR KERJA (biar paham dulu sebelum setting)

```
Dashboard (buat/jadwalkan post)
        │  simpan ke tabel ig_posts (status = 'scheduled')
        ▼
Cloudflare Worker (cron */15 menit)
        │  POST → Edge Function ig-publish
        ▼
ig-publish (Supabase Edge Function)
        │  query ig_posts yang jatuh tempo
        │  → panggil Instagram Graph API (create container → publish)
        ▼
Instagram Graph API (graph.facebook.com)
        │  post benar-benar muncul di akun IG
        ▼
ig_posts.status = 'published'  (atau 'failed' setelah retry habis)
```

Worker cron yang sama juga memicu `ig-refresh-token` tiap Senin jam
09:00 UTC untuk memperpanjang token sebelum kedaluwarsa.

Edge Function lain yang terlibat:
- **generate-ig-caption** — opsional, cuma dipakai tombol "Generate
  dengan AI" di modal upload (butuh `GEMINI_API_KEY`, tidak wajib untuk
  auto-upload jalan).
- **ig-manual-retry** — dipicu tombol "Retry" di dashboard untuk post
  yang gagal.

---

## 1. SIAPKAN AKUN INSTAGRAM + META APP

Auto-upload butuh **Instagram Professional (Business/Creator) account**
yang terhubung ke sebuah **Facebook Page**, plus **access token** dari
Meta App. Dashboard ini **tidak** punya tombol "Connect Instagram" —
token harus kamu ambil manual lalu dimasukkan ke tabel `ig_accounts`
lewat SQL Editor (lihat bagian 3).

1. Pastikan akun Instagram-nya sudah **Professional** (Business/Creator)
   dan **terhubung ke Facebook Page** (Instagram app → Settings →
   Account → Linked accounts → Facebook).
2. Buka https://developers.facebook.com/apps → **Create App** → tipe
   **Business**.
3. Di App kamu, tambahkan produk **Instagram** (Graph API) dan
   **Facebook Login for Business**.
4. Buka **Graph API Explorer** (https://developers.facebook.com/tools/explorer/):
   - Pilih App kamu, pilih User Token.
   - Minta permission: `instagram_basic`, `instagram_content_publish`,
     `pages_show_list`, `pages_read_engagement`, `business_management`.
   - Generate token → ini **short-lived User Access Token** (~1-2 jam).
5. Tukar jadi **long-lived User Token** (~60 hari):
   ```
   GET https://graph.facebook.com/v21.0/oauth/access_token
       ?grant_type=fb_exchange_token
       &client_id=<APP_ID>
       &client_secret=<APP_SECRET>
       &fb_exchange_token=<short_lived_token_dari_step_4>
   ```
6. Ambil daftar Page + **Page Access Token** (otomatis long-lived kalau
   User Token sumbernya sudah long-lived):
   ```
   GET https://graph.facebook.com/v21.0/me/accounts
       ?access_token=<long_lived_user_token>
   ```
   Catat `id` (ini **fb_page_id**) dan `access_token` Page-nya (ini yang
   disimpan sebagai `access_token` di tabel `ig_accounts` — **Page
   Access Token**, bukan User Token).
7. Ambil **Instagram Business Account ID** dari Page tadi:
   ```
   GET https://graph.facebook.com/v21.0/<fb_page_id>
       ?fields=instagram_business_account
       &access_token=<page_access_token>
   ```
   Nilai `instagram_business_account.id` inilah **ig_user_id**.

Sekarang kamu punya 3 nilai: `ig_user_id`, `fb_page_id`,
`access_token` (Page Access Token, berlaku ~60 hari sejak step 5).

---

## 2. MIGRASI DATABASE (SQL Editor Supabase)

Kalau tabel `ig_accounts` / `ig_posts` / `ig_post_media` /
`ig_publish_logs` belum ada, jalankan di **SQL Editor** (urut, sekali
jalan, idempotent — aman diulang):

```sql
-- 1) tabel inti: ig_accounts, ig_posts, ig_publish_logs
--    isi dari sql/tambah_ig_scheduler.sql

-- 2) dukungan carousel: ig_post_media
--    isi dari sql/tambah_ig_carousel.sql (jalankan SETELAH file di atas)
```

Kalau kamu jalankan `sql/SETUP_LENGKAP_SATU_FILE.sql` (lihat
`CHECKLIST_DEPLOY.md`), cek dulu apakah kedua migrasi ini sudah
tergabung di sana — kalau belum, jalankan manual dari file aslinya:
`sql/tambah_ig_scheduler.sql` lalu `sql/tambah_ig_carousel.sql`.

### Masukkan akun IG (ganti isi tanda kurung sudut)

```sql
insert into ig_accounts (ig_user_id, fb_page_id, access_token, token_expires_at, is_active)
values (
  '<ig_user_id dari step 1.7>',
  '<fb_page_id dari step 1.6>',
  '<page_access_token dari step 1.6>',
  now() + interval '60 days',
  true
);
```

> `access_token` di sini **rahasia** — jangan pernah expose lewat query
> `select *` dari client. `js/app.js` sudah eksplisit hanya
> `select id, ig_user_id, fb_page_id, token_expires_at, is_active` untuk
> ditampilkan ke UI (lihat `loadIgAccounts()`), tapi tetap double-check
> kalau kamu menambah query baru.

---

## 3. STORAGE BUCKET `ig-media`

Belum ada migrasi SQL untuk bucket ini — buat manual:

1. Supabase Dashboard → **Storage** → **New bucket**.
2. Nama: `ig-media` (harus persis, ini yang dipakai `IG_STORAGE_BUCKET`
   di `js/app.js`).
3. **Public bucket: ON**. Wajib — Instagram Graph API butuh URL media
   yang bisa diakses publik tanpa auth (dipakai sebagai `image_url` /
   `video_url` saat create container).
4. Batas ukuran file bisa disamakan dengan `IG_MAX_FILE_SIZE` di
   `js/app.js` (10MB) kalau mau konsisten.

---

## 4. DEPLOY EDGE FUNCTIONS

Butuh Supabase CLI (`npm install -g supabase`, lalu `supabase login` &
`supabase link --project-ref <project-ref-kamu>` — lihat
`CHECKLIST_DEPLOY.md` kalau belum pernah setup).

### 4a. ig-publish (WAJIB — ini yang benar-benar publish ke IG)
```bash
supabase functions deploy ig-publish --no-verify-jwt
```
Tidak butuh secret tambahan — `SUPABASE_URL` & `SUPABASE_SERVICE_ROLE_KEY`
otomatis tersedia di environment Edge Function.

### 4b. ig-refresh-token (perpanjang token otomatis mingguan)
```bash
supabase secrets set IG_APP_ID=<APP_ID_dari_Meta_App>
supabase secrets set IG_APP_SECRET=<APP_SECRET_dari_Meta_App>
supabase functions deploy ig-refresh-token --no-verify-jwt
```
⚠️ Baca **Catatan Penting** di bawah — implementasi refresh saat ini
kemungkinan **tidak cocok** dengan Page Access Token dari alur di
Bagian 1.

### 4c. ig-manual-retry (tombol "Retry" di dashboard)
```bash
supabase functions deploy ig-manual-retry
```
Sengaja **tanpa** `--no-verify-jwt` — function ini butuh JWT user yang
sudah login (dicek manual di dalam kode via `auth.getUser()`).

### 4d. generate-ig-caption (opsional — AI caption assist)
```bash
# lewati kalau GEMINI_API_KEY sudah pernah di-set untuk
# scan-poster-ocr / generate-wa-caption (secret dipakai bareng)
supabase secrets set GEMINI_API_KEY=<apikey_dari_aistudio.google.com/apikey>
supabase functions deploy generate-ig-caption --no-verify-jwt
```

Setelah deploy, cek semuanya lewat menu **System** di dashboard → card
**"Kondisi API & Edge Function"** — tiap function di atas harus muncul
badge **Aktif**, bukan "Belum ter-deploy" atau "Tidak terjangkau".

---

## 5. DEPLOY CLOUDFLARE WORKER (CRON)

Ini bagian yang bikin publish **otomatis** jalan tanpa harus buka
dashboard — tanpa worker ini, post cuma nyangkut di status `scheduled`
selamanya, karena tidak ada yang memanggil `ig-publish` secara berkala.

```bash
cd scheduler
npm install -g wrangler   # kalau belum ada

wrangler login

# secrets (JANGAN taruh di wrangler.toml / commit ke repo)
wrangler secret put SUPABASE_FUNCTIONS_URL
# isi: https://<project-ref>.supabase.co/functions/v1

wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# isi: service_role key dari Supabase Dashboard → Project Settings → API
# (BUKAN anon key — ini key rahasia, jangan bocor ke client manapun)

wrangler deploy --config wrangler.toml
```

`wrangler.toml` sudah mengatur 2 cron trigger:
- `*/15 * * * *` → publish cycle tiap 15 menit.
- `0 9 * * 1` → refresh token tiap Senin jam 09:00 UTC (16:00 WIB).

### Uji manual tanpa nunggu cron
Worker ini juga punya endpoint HTTP untuk trigger manual (berguna buat
testing sebelum menunggu jadwal cron):
```bash
curl https://<nama-worker>.<subdomain>.workers.dev/ig-publish
curl https://<nama-worker>.<subdomain>.workers.dev/ig-refresh
```

---

## 6. TEST END-TO-END

1. Login dashboard sebagai admin → **Social Media → IG Scheduler**.
2. Pastikan bar status akun (di atas tabel) menampilkan akun IG kamu
   + sisa hari token — kalau tidak muncul, cek lagi tabel `ig_accounts`
   (harus `is_active = true`).
3. Klik **Post Baru** → upload 1 gambar, isi caption, atur jadwal
   **beberapa menit ke depan** (bukan besok, biar cepat ketauan
   hasilnya) → simpan.
4. Cek tabel `ig_posts` di Supabase → status harus `scheduled`.
5. Trigger manual (jangan nunggu 15 menit):
   ```bash
   curl https://<nama-worker>.workers.dev/ig-publish
   ```
6. Refresh menu IG Scheduler di dashboard → status post harus berubah
   jadi `published` (atau `failed` dengan pesan error kalau ada yang
   salah — cek `last_error` di tabel `ig_posts` atau detail di tabel
   `ig_publish_logs`).
7. Kalau `published` → cek langsung di akun Instagram, post-nya harus
   sudah muncul.

---

## 7. TROUBLESHOOTING CEPAT

| Gejala | Kemungkinan penyebab |
|---|---|
| Post nyangkut terus di `scheduled`, tidak pernah berubah | Worker cron belum ter-deploy, atau `SUPABASE_FUNCTIONS_URL`/`SUPABASE_SERVICE_ROLE_KEY` salah di Worker secrets |
| Status langsung `failed`, error "Tidak ada akun IG aktif" | Belum ada row di `ig_accounts` dengan `is_active = true` |
| Error `"Invalid OAuth access token"` / `"Error validating access token"` | `access_token` di `ig_accounts` sudah kedaluwarsa atau salah — ambil ulang dari Bagian 1 |
| Error saat `image_url`/`video_url` tidak bisa diakses IG | Bucket `ig-media` belum **public**, atau URL-nya salah |
| Carousel gagal, "Carousel butuh minimal 2 item media" | Item di `ig_post_media` kurang dari 2 — cek upload multi-file di modal |
| Card "Kondisi API & Edge Function" di menu System nunjuk salah satu function "Belum ter-deploy (404)" | Function itu belum di-`supabase functions deploy` |

---

## ⚠️ CATATAN PENTING — Refresh Token Kemungkinan Tidak Cocok

`ig-refresh-token` (Bagian 4b) memanggil:
```
GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token
```
Endpoint ini khusus untuk token dari alur **"Instagram API with
Instagram Login"** (login IG langsung, tanpa Facebook Page). Tapi
panduan di Bagian 1 di atas — dan skema tabel `ig_accounts` yang
mewajibkan `fb_page_id` — mengikuti alur **Facebook Login for
Business** (token Page, terhubung lewat Facebook Page).

Kedua jenis token ini **tidak saling kompatibel** untuk endpoint
refresh di atas. Artinya `ig-refresh-token` kemungkinan **tidak akan
berhasil memperpanjang** Page Access Token yang kamu buat lewat
Bagian 1, walau function-nya "sukses" ter-deploy dan terpanggil cron
tiap Senin.

Pilihan buat kamu:
1. **Termudah — pantau manual:** cek sisa hari token lewat bar status
   di menu IG Scheduler (dashboard sudah hitung otomatis dari
   `token_expires_at`), lalu ulangi Bagian 1 step 5–7 tiap ~50 hari
   sebelum kedaluwarsa, update manual via SQL:
   ```sql
   update ig_accounts
      set access_token = '<token_baru>',
          token_expires_at = now() + interval '60 days'
    where is_active = true;
   ```
2. **Lebih tepat — perbaiki `ig-refresh-token`:** ganti isi function
   supaya menukar **long-lived User Token** (bukan `access_token` Page
   yang tersimpan) lewat endpoint `fb_exchange_token` seperti di
   Bagian 1 step 5, lalu ambil ulang Page Access Token via
   `/me/accounts` (step 6). Ini butuh menyimpan User Token terpisah di
   `ig_accounts` (kolom baru) karena User Token dan Page Token berbeda.

Tidak masalah kalau untuk sekarang kamu pilih opsi 1 dulu — auto-**upload**
(bagian 15-menitan, `ig-publish`) tetap jalan normal terlepas dari isu
refresh ini, cuma nanti tokennya harus diperbarui manual sebelum
kedaluwarsa (~60 hari) supaya publish tidak mulai gagal.
