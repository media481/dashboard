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
sql/tambah_ig_comments.sql
sql/tambah_ig_content_plan.sql
```

Yang pertama membuat 3 tabel inti (`ig_accounts`, `ig_posts`, `ig_publish_logs`) + RLS policies.
Yang kedua menambah tabel `ig_post_media` (item-item carousel, urutan via kolom `position`) + RLS policies — dibutuhkan untuk fitur Carousel.
Yang ketiga menambah tabel `ig_comments` — lihat bagian "Fitur Komentar" di bawah.
Yang keempat menambah tabel `ig_content_plan` — lihat bagian "Content Planner Bulanan (AI)" di bawah.

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

## Fitur Komentar (Balas dari Dashboard)

Memaksimalkan izin **`instagram_manage_comments`** — bagian dari Instagram Graph API yang gratis dari Meta (tidak ada biaya per-call), tapi belum dipakai sebelumnya (sebelumnya IG Scheduler cuma publish saja).

### Yang didapat
- Semua komentar di post yang sudah *published* disinkron otomatis tiap 15 menit (bareng cron publish) ke tabel `ig_comments`.
- Notifikasi Telegram otomatis untuk komentar baru — reuse konfigurasi Telegram yang sudah ada (Pengaturan → Notifikasi Telegram), tinggal centang tipe **"Komentar IG Baru"** di penerima yang diinginkan.
- Balas, sembunyikan (hide), atau hapus komentar langsung dari tombol 💬 di tabel post — tidak perlu buka aplikasi Instagram.
- Badge merah di tombol 💬 menunjukkan jumlah komentar yang belum dibalas.

### Setup tambahan
1. Jalankan migration baru di SQL Editor:
   ```
   sql/tambah_ig_comments.sql
   ```
2. Deploy 2 edge function baru:
   ```bash
   supabase functions deploy ig-sync-comments --no-verify-jwt
   supabase functions deploy ig-comment-action
   ```
3. Redeploy Cloudflare Worker (sudah diupdate untuk trigger `ig-sync-comments` tiap tick 15 menit):
   ```bash
   cd scheduler && wrangler deploy
   ```
4. Pastikan permission **`instagram_manage_comments`** sudah disetujui di Meta App Review untuk akun IG yang dipakai (`ig_accounts`). Tanpa ini, sync komentar akan gagal dengan error permission dari Graph API.
5. (Opsional) Buka Pengaturan → Notifikasi Telegram → centang "Komentar IG Baru" pada penerima yang mau dapat notif.

### Catatan
- Sync dibatasi ke post yang published dalam 30 hari terakhir, biar tidak boros API call ke post lawas.
- Balasan yang muncul di kolom komentar Instagram (dari siapa pun) otomatis ditandai membuat status komentar induk jadi "sudah dibalas" — bukan cuma balasan yang dikirim lewat dashboard ini.
- RLS tabel `ig_comments` pakai `current_dashboard_role()` (bukan `auth.role()='authenticated'` seperti migrasi awal IG Scheduler) — guest tidak bisa lihat/balas komentar sama sekali, konsisten dengan hardening yang sudah diterapkan di tabel lain (lihat `sql/tambah_role_guest_readonly.sql`).

## Content Planner Bulanan (AI)

Tombol **"Rencana Bulanan AI"** di toolbar IG Scheduler menyusun daftar IDE post untuk
1 bulan penuh sekaligus (tersebar per tanggal, campuran promosi/edukasi/testimoni/
engagement) lewat Gemini — otomatis memakai konteks program Umroh yang berangkat di
bulan tsb (tabel `programs`) supaya harga/tanggal yang disebut tidak asal karang.

Rencana disimpan di tabel **terpisah** `ig_content_plan` (bukan `ig_posts`, karena
`ig_posts.media_url` wajib diisi sedangkan rencana baru berupa ide+draft caption, belum
ada media). Item rencana tetap tampil di **kalender yang sama** dengan post asli, dibedakan
lewat gaya dashed/muted + label "Rencana AI". Klik tombol **"Jadikan Post"** pada satu
rencana → membuka modal Post Baru dengan caption & tipe konten sudah ter-isi, tinggal
upload media & simpan (rencana otomatis ditandai `dijadikan_post` setelah post tersimpan).

### Setup tambahan
1. Jalankan migration baru di SQL Editor:
   ```
   sql/tambah_ig_content_plan.sql
   ```
2. Deploy edge function baru:
   ```bash
   supabase functions deploy generate-ig-content-plan --no-verify-jwt
   ```
   (pakai `GEMINI_API_KEY` yang sama — tidak perlu secret baru, ikut fallback multi-key kalau sudah di-set)

### Catatan
- RLS `ig_content_plan` dibatasi ke `admin`/`user` (guest tidak bisa lihat/kelola rencana).
- Rencana yang tidak relevan bisa **dilewati** (disembunyikan dari kalender, tidak dihapus)
  atau **dihapus permanen** langsung dari modal harian / modal Content Planner.

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

---

## Kalender sebagai Content Planner

Kalender IG Scheduler sekarang berfungsi sekaligus sebagai papan perencanaan konten (tanpa migrasi SQL baru — tetap memakai tabel `ig_content_plan`):

- **Chip per item** di setiap sel tanggal (maks. 3, sisanya "+N lagi"): post tampil dengan warna status & thumbnail, ide/rencana tampil putus-putus dengan ikon tipe konten (image / reels / carousel). Di layar kecil chip diringkas jadi titik.
- **Filter** Semua / Rencana / Post di atas kalender.
- **Ringkasan bulan**: jumlah ide, draft, terjadwal, terbit, gagal, komposisi tipe konten, dan jumlah hari yang masih kosong (dari hari ini ke depan).
- **Drag & drop**: seret chip ide ke tanggal lain untuk memindahkan (update `tanggal` + `bulan`). Di modal harian tersedia input tanggal sebagai alternatif untuk mobile.
- **Tambah ide cepat** dari modal harian (tema + tipe konten), tanpa harus generate AI.
- Hanya item *ide* yang bisa dipindah lewat drag & drop; jadwal post yang sudah dibuat tetap diubah lewat modal Edit supaya tidak mengganggu antrean publish.


---

## Mode Content Planner (auto-upload & komentar disisihkan)

Flag `IG_AUTOPUBLISH_ENABLED` di `js/app.js` (default `false`):

- Disembunyikan: tombol Sync Komentar, panel komentar, status akun/token IG, tombol Retry & badge komentar. Kodenya, edge function, dan cron tidak dihapus — ubah flag jadi `true` untuk mengaktifkan lagi.
- Post disimpan sebagai **draft** (bukan `scheduled`), sehingga `ig-publish` tidak menerbitkan apa pun. Post lama yang sudah berstatus `scheduled` tetap akan diterbitkan cron kecuali dijadikan draft atau cron dimatikan.
- Layout: kartu statistik bulan ini, kalender lebar, dan sidebar **Ide Bulan Ini** (dikelompokkan per tahap, bisa diseret ke kalender).
- Opsional: jalankan `sql/tambah_ig_content_plan_planner.sql` untuk kolom `pilar` & `tahap` (warna pilar di chip, keseimbangan pilar, alur Ide → Dikerjakan → Siap). Tanpa migrasi ini fitur tersebut otomatis tersembunyi.

---

## Catatan perbaikan (audit IG Scheduler)

- **Judul ide berkutip** (`Tips "umroh" hemat`) di modal "Rencana AI" kini utuh: input memakai `escapeHtmlAttr` (sebelumnya terpotong & membuka injeksi atribut).
- **Edit ide/caption**: cache lokal diperbarui lebih dulu (optimistik) dan dibalikkan + toast error kalau simpan gagal. Kartu di modal harian ikut berubah, dan render ulang saat klik "Selesai" menunggu semua simpan yang masih berjalan (bukan lagi tebakan 250 ms).
- **Anti-dobel**: tombol Simpan Draft dinonaktifkan selama menyimpan dan diblok selama upload berjalan; form ide cepat memakai guard. Kalau simpan gagal di tengah (post sudah terbuat, item carousel gagal), `ig_post_id` langsung terisi sehingga percobaan berikutnya meng-update, bukan membuat post kedua.
- **Nama file upload** dibersihkan (`igSafeFileName`): hanya huruf/angka/`_`/`-`, aksen dibuang, ekstensi dari MIME bila tidak ada.
- **Kalender**: semua chip dirender, lalu `igFitCalendarChips()` menghitung jumlah yang muat dari layout asli (setelah render & tiap ukuran grid berubah lewat `ResizeObserver`), sehingga "+N lagi" tidak terpotong. Di luar mode pas-layar tetap maks. `IG_CAL_MAX_CHIPS` (3).
- **Rencana dimuat saat halaman dibuka** (`openIgSchedulerPage` memanggil `loadIgContentPlan()`).
- **Pembersihan bucket `ig-media`**: upload yang dibatalkan/diganti, item carousel yang dibuang, dan media post yang dihapus ikut dihapus dari bucket (best effort). Butuh policy DELETE: jalankan `sql/tambah_ig_media_storage_policy.sql`.
- Minor: toast sukses carousel hanya muncul bila ada file yang berhasil; judul modal di mode planner "Draft Post Baru"/"Edit Draft Post"; URL media di pratinjau di-escape; pilar form ide cepat di-reset; klik di luar modal Upload kini membersihkan state; tanggal default memakai tanggal lokal.

## Pola Mingguan Amiru (teks di gambar + caption)

Menerapkan pola konten Amiru ke Content Planner (tombol **Rencana AI** → **Pola Mingguan Amiru**), tanpa AI:

| Hari | Jenis | Pilar planner | Tipe |
|---|---|---|---|
| Senin | Storytelling (rindu & kedekatan) | `storytelling` | Image |
| Rabu | Edukasi (bisa disimpan) | `edukasi` | Carousel |
| Jumat | Bukti Sosial (testimoni/momen jamaah) | `testimoni` | Reels |
| Minggu | Info Program (jadwal, seat, ajakan) | `promo` | Image |

- Rasio sehat ≈ 3 konten non-jualan : 1 Info Program.
- Tiap ide punya **Teks di gambar** (2–4 baris pemancing) dan **caption** yang melanjutkannya, ditutup 5 hashtag. Ejaan resmi "Umroh".
- Draf yang sudah ditulis dipakai berurutan per hari (3 Senin, 2 Rabu, 1 Jumat, 3 Minggu); slot sisanya dibuat sebagai kerangka kosong (pilar & tipe sudah terisi). Draf lengkap ada di konstanta `IG_POLA_AMIRU` di `js/app.js`.
- Tanggal yang sudah lewat atau sudah punya ide dilewati, jadi aman dijalankan di bulan berjalan.
- Bagian `[isi ...]` di draf (program, hotel, nomor WA, **kutipan asli jamaah**) harus diganti data asli sebelum diposting. Testimoni wajib dari jamaah asli dan seizin mereka.
- Tombol **Rencana AI → Generate dengan AI** sekarang juga mengikuti pola & gaya ini (edge function `generate-ig-content-plan` perlu di-deploy ulang).

Migrasi (opsional tapi disarankan): `sql/tambah_ig_content_plan_pola_amiru.sql` menambah kolom `ig_content_plan.teks_gambar`. Tanpa migrasi ini, kolom teks gambar otomatis tersembunyi dan teksnya tidak tersimpan.

Deploy: `supabase functions deploy generate-ig-content-plan --no-verify-jwt`
