# Instagram Content Scheduler

Modul Instagram Content Scheduler yang diintegrasikan ke dalam **Dashboard Amiru**.

Stack: Supabase (Postgres + Storage + Edge Functions) + Vanilla JS (di `js/app.js`) + Cloudflare Worker Cron.

---

## Arsitektur

```
[Frontend Dashboard] ──> [Supabase DB + Storage] <── [Cloudflare Worker Cron (15 menit)]
                                                              │
                                                              ▼
                                                   [Edge Function: ig-publish]
                                                              │
                                                              ▼
                                                   [Instagram Graph API]
```

- **Frontend**: tab "IG Scheduler" di sidebar (nav `igScheduler`, hanya untuk role yang login).
  Upload media, tulis caption, pilih jadwal, lihat kalender & status post.
- **Storage**: bucket `ig-media` (public-read) untuk file gambar/video sebelum dipublish.
- **Database**: tabel `ig_accounts`, `ig_posts`, `ig_publish_logs` (lihat migration SQL).
- **Scheduler**: Cloudflare Worker cron tiap 15 menit → memicu Edge Function `ig-publish`.
- **Token refresh**: Edge Function `ig-refresh-token` dijalankan tiap Senin jam 9 UTC.

---

## Setup

### 1. Jalankan SQL Migration

Di Supabase Dashboard → SQL Editor → paste & run (urut):

```
sql/tambah_ig_scheduler.sql
sql/tambah_ig_carousel.sql
```

Yang pertama membuat 3 tabel inti (`ig_accounts`, `ig_posts`, `ig_publish_logs`) + RLS policies.
Yang kedua menambah tabel `ig_post_media` (item-item carousel, urutan via kolom `position`) + RLS policies — dibutuhkan untuk fitur Carousel.

### 2. Buat Storage Bucket

Di Supabase Dashboard → Storage → New Bucket:

- **Name**: `ig-media`
- **Public**: ✅ (public-read — Instagram Graph API butuh URL publik)

### 3. Deploy Edge Functions

```bash
# di folder dashboard-main/
supabase login
supabase link --project-ref <PROJECT_REF_ANDA>

# Deploy keempat function:
supabase functions deploy ig-publish --no-verify-jwt
supabase functions deploy ig-refresh-token --no-verify-jwt
supabase functions deploy ig-manual-retry
supabase functions deploy generate-ig-caption --no-verify-jwt

# Set secrets yang dibutuhkan:
supabase secrets set IG_APP_ID=<app_id_dari_meta_for_developer>
supabase secrets set IG_APP_SECRET=<app_secret_dari_meta_for_developer>
```

> `SUPABASE_URL` & `SUPABASE_SERVICE_ROLE_KEY` sudah tersedia otomatis di environment edge function.
> `GEMINI_API_KEY` dipakai bareng dengan fitur "Generate dengan AI" caption WhatsApp yang sudah ada — kalau sudah pernah di-set sebelumnya (`supabase secrets set GEMINI_API_KEY=xxxxx`), tidak perlu diulang.

### 3b. (Opsional) Fallback Multi-API-Key Gemini

Semua fungsi AI (`scan-poster-ocr`, `generate-wa-caption`, `generate-ig-caption`) sekarang mendukung lebih dari 1 `GEMINI_API_KEY` sebagai fallback — kalau key utama kena rate limit/kuota habis, otomatis coba key berikutnya sebelum menyerah. Tambahkan sebanyak yang kamu mau (maks 5), urut angka:

```bash
supabase secrets set GEMINI_API_KEY=key_pertama       # wajib — key utama, sudah ada
supabase secrets set GEMINI_API_KEY_2=key_kedua        # opsional — fallback 1
supabase secrets set GEMINI_API_KEY_3=key_ketiga       # opsional — fallback 2
```

Kalau `GEMINI_API_KEY_2` dst tidak di-set, sistem tetap jalan normal pakai 1 key saja (backward compatible, tidak ada yang perlu diubah kalau tidak butuh fallback).

> **Penting**: pakai API key dari akun Google/project GCP yang **berbeda-beda** untuk tiap key. Kalau semua key berasal dari 1 project yang sama, mereka berbagi kuota yang sama — fallback jadi tidak menolong saat kuota project itu habis. Bikin API key gratis tambahan di https://aistudio.google.com/apikey pakai akun Google lain.

Setelah menambah/mengubah secret, tidak perlu deploy ulang function — Supabase langsung memakai secret terbaru di request berikutnya.

### 4. Isi Akun Instagram

Masukkan akun IG Business/Creator Anda ke tabel `ig_accounts` via SQL Editor:

```sql
INSERT INTO ig_accounts (
  ig_user_id, fb_page_id, access_token, token_expires_at, is_active
) VALUES (
  '<IG_BUSINESS_ACCOUNT_ID>',
  '<FB_PAGE_ID>',
  '<LONG_LIVED_ACCESS_TOKEN>',
  now() + interval '60 days',
  true
);
```

> Long-lived token berlaku ~60 hari, bisa di-refresh via `ig-refresh-token` sebelum expired.

### 5. Deploy Cloudflare Worker (Scheduler)

```bash
cd scheduler/

# Install wrangler jika belum
npm install -g wrangler

# Set secrets (jangan commit ke repo!)
wrangler secret put SUPABASE_FUNCTIONS_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# Deploy
wrangler deploy --config wrangler.toml
```

Worker ini otomatis:
- **Tiap 15 menit**: trigger `ig-publish` (proses post yang sudah jatuh tempo)
- **Senin jam 9 UTC**: trigger `ig-refresh-token` (perpanjang token)

---

## Cara Pakai (Frontend)

Setelah semua setup selesai:

1. **Login** ke Dashboard (hanya admin/user yang bisa akses IG Scheduler).
2. Buka tab **IG Scheduler** di sidebar (grup "Social Media").
3. Klik **"Post Baru"** → pilih **Tipe Post**:
   - **Image** / **Video/Reels**: upload 1 file → tulis caption (atau isi "Ide/Konsep Singkat" lalu klik **Generate dengan AI**) → pilih tanggal & jam.
   - **Carousel**: klik **Tambah Media** (bisa pilih beberapa file sekaligus, campur gambar & video, min 2 maks 10) → atur urutan pakai tombol panah kiri/kanan di tiap thumbnail → tulis caption → pilih tanggal & jam.
4. Klik **Simpan**. Post otomatis berstatus **Scheduled**, muncul di kalender & daftar post.
5. Cloudflare Worker akan mem-publish ke Instagram Graph API pada jadwal yang ditentukan.
   - Untuk carousel: tiap item dibuat sebagai *child container* dulu (item video menunggu status `FINISHED`), baru digabung jadi 1 *parent container* `CAROUSEL` lalu dipublish.
6. Jika gagal, post berstatus **Failed** — bisa diklik **Retry** untuk mencoba lagi.

---

## Alur Status Post

```
draft ─(set jadwal)──> scheduled ─(cron pickup)──> publishing ──> published
                             ▲                                   │
                             │                                   ▼
                             └─(retry < max)── failed (bisa manual retry)
```

---

## Environment Variables (Cloudflare Worker)

| Nama | Keterangan |
|---|---|
| `SUPABASE_URL` | URL project Supabase |
| `SUPABASE_FUNCTIONS_URL` | `https://<ref>.supabase.co/functions/v1` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (secret — bypass RLS untuk background process) |

## Environment Secrets (Supabase Edge Functions)

| Nama | Keterangan |
|---|---|
| `SUPABASE_URL` | Otomatis tersedia |
| `SUPABASE_SERVICE_ROLE_KEY` | Otomatis tersedia |
| `IG_APP_ID` | App ID dari Meta for Developers |
| `IG_APP_SECRET` | App Secret dari Meta for Developers |

---

## Catatan Penting

- **Token IG tidak pernah diekspor ke frontend** — semua panggilan ke Graph API hanya lewat Edge Function dengan `service_role_key`.
- **Rate limit**: ig-publish memproses maks 20 post per run untuk menghindari rate limit Graph API.
- **Video/Reels**: butuh polling `status_code` hingga `FINISHED` sebelum publish (bisa hingga 60 detik). Jika belum selesai, post tetap di status `publishing` dan cron run berikutnya akan lanjutkan cek.
- **RLS**: semua tabel IG Scheduler mensyaratkan `auth.role() = 'authenticated'` — anon/publik tidak bisa akses sama sekali.
