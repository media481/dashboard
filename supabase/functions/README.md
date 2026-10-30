# Edge Functions

Kumpulan Supabase Edge Function (Deno/TypeScript) untuk Dashboard Amiru. Fungsi dipakai untuk hal yang butuh secret atau server-side: proxy Telegram, AI (Gemini), OCR poster, manajemen akun, dan integrasi Instagram Graph API.

Kontrak request/response tiap fungsi didokumentasikan di komentar header file `index.ts`-nya dan disesuaikan dengan pemanggilnya di `js/app.js` dan modul `js/modules/*.js`.

## Daftar fungsi

Ada 17 folder fungsi di repo: 16 aktif (di tabel di bawah) ditambah `login-dashboard` yang sudah legacy. `_shared/gemini.ts` hanya acuan helper, bukan fungsi.

Kolom **Auth** menunjukkan siapa yang boleh memanggil. Kolom **Deploy** menunjukkan flag yang dipakai.

### Akun dan pengguna

| Fungsi | Kegunaan | Auth | Deploy |
|---|---|---|---|
| `admin-create-user` | Membuat akun baru (role `admin`/`user`/`guest`) dari Pengaturan User. Butuh kolom `dashboard_profiles.email` (`sql/30`, sudah di `sql/00`) | Bearer token admin | `supabase functions deploy admin-create-user` |
| `admin-reset-user-password` | Admin mengganti password user lain tanpa tahu password lama | Bearer token admin | `supabase functions deploy admin-reset-user-password` |
| `admin-change-password` | Mengganti password akun bersama per role (`admin`/`user`/`guest`). Tidak dipanggil `app.js` saat ini | Bearer token admin | `supabase functions deploy admin-change-password` |

Ketiganya memverifikasi token ke Supabase Auth, lalu mengecek `dashboard_profiles.dashboard_role = 'admin'` memakai service role. Klaim dari client tidak dipercaya. Password disimpan sebagai hash satu arah, jadi admin hanya bisa mereset, tidak bisa melihat password lama.

### AI dan OCR (Gemini)

| Fungsi | Kegunaan | Auth | Model |
|---|---|---|---|
| `generate-wa-caption` | Caption WhatsApp promosi program dari konsep mentah. Body: `{ userMsg }`, respons: `{ text }` | Tanpa auth | `gemini-3.5-flash` (tertanam di kode) |
| `scan-poster-ocr` | Ekstrak data poster (nama, tanggal, harga, hotel 1-4, termasuk/tidak termasuk) untuk Crosscheck. Body: `{ imageUrl }` | Tanpa auth | `gemini-3.5-flash-lite` (tertanam di kode) |
| `generate-ig-caption` | Satu caption IG dari satu ide. Hasil dirapikan (ejaan "Umroh", 5 hashtag, maks 2200 karakter) dan diberi `warnings` untuk angka yang tidak ada di konsep | Bearer token admin/user | `GEMINI_MODEL`, bawaan `gemini-3.5-flash` |
| `generate-ig-content-plan` | Paket 7 posting Senin-Minggu yang saling menyambung dalam satu tema pekan (output JSON terstruktur) | Bearer token admin/user | `GEMINI_MODEL`, bawaan `gemini-3.5-flash` |
| `generate-ig-year-plan` | Tema per pekan untuk setahun (maks 30 pekan per panggilan). Menerima bank alur per fase + bobot (`bankAlurGrup`) dan mengembalikan label `fase` per pekan (versi 2). Isi harian dibuat oleh `generate-ig-content-plan` | Bearer token admin/user | `GEMINI_MODEL`, bawaan `gemini-3.5-flash` |

Fungsi IG AI memakai model cadangan `gemini-3.5-flash-lite`. Aturan isinya mengikuti `pola-konten.md`. Anon key saja ditolak (401). Fungsi-fungsi ini di-deploy dengan `--no-verify-jwt` karena pengecekan token dan role dilakukan di dalam kode.

`generate-wa-caption` dan `scan-poster-ocr` tidak punya auth, jadi siapa pun yang tahu URL-nya bisa memakai kuota Gemini. Pertimbangkan menambah pengecekan token seperti di fungsi IG.

### Telegram dan sinkronisasi

| Fungsi | Kegunaan | Auth | Deploy |
|---|---|---|---|
| `send-telegram` | Proxy ke Telegram Bot API (Telegram tidak mendukung CORS dari browser). Body: `{ bot_token, chat_id, message, parse_mode }`. Token bot dikirim client dari tabel `tg_config` | Dibatasi `ALLOWED_ORIGIN` (bawaan: `SUPABASE_URL`) | `--no-verify-jwt` |
| `sync-rekap-program` | Sinkron gambar Rekap Program dari folder Google Drive (via Apps Script) ke tabel `rekap_program_items`. Respons: `{ ok, synced }` | Bearer token admin/user | `supabase functions deploy sync-rekap-program` |

URL `send-telegram` ditempel manual di form **Pengaturan Telegram** (field "Edge Function URL").

### Radar risiko keberangkatan

| Fungsi | Kegunaan | Auth | Deploy |
|---|---|---|---|
| `radar-risiko-jamaah` | Menilai risiko tiap jamaah (pembayaran, visa, dokumen, paspor) dan tiap program yang berangkat dalam `horizon_hari` (bawaan 60). Mengembalikan skor, alasan, draf pengingat WA (tautan `wa.me` siap klik), dan ringkasan teks. Opsional kirim ringkasan ke Telegram. Hanya membaca data. Body (semua opsional): `{ program_id, horizon_hari, kirim_telegram, hanya_jika_ada_masalah }` | Bearer token admin, atau service role key (cron) | `supabase functions deploy radar-risiko-jamaah` |

Butuh view `v_total_bayar` (sudah di `sql/00`; project lama: `sql/59_tambah_view_total_bayar.sql`). Skor memakai aturan tetap (bukan tebakan AI), bobot naik mendekati hari berangkat; levelnya `kritis` (>= 70), `tinggi` (>= 40), `sedang` (>= 20), `aman`. Daftar dokumen, aturan paspor 7 bulan, dan pemilihan harga adalah salinan dari `js/app.js`; perbarui juga di fungsi ini kalau berubah. Telegram dikirim ke penerima bertipe `radar`; kalau tidak ada, ke penerima bertipe `program`. Tes: `npm run test:edge`.

### Instagram

| Fungsi | Kegunaan | Auth | Deploy |
|---|---|---|---|
| `ig-publish` | Publish post `scheduled` yang sudah jatuh tempo (buat container lalu publish; video/reels dipoll sampai `FINISHED`) | Service role key (cron) atau token admin/user | `--no-verify-jwt` |
| `ig-refresh-token` | Perpanjang long-lived token IG (~60 hari), hanya bila tersisa kurang dari 10 hari | Service role key (cron) atau token user valid | `--no-verify-jwt` |
| `ig-sync-comments` | Tarik komentar post 30 hari terakhir ke `ig_comments` dan kirim notifikasi Telegram untuk komentar baru | Service role key (cron) atau token user valid | `--no-verify-jwt` |
| `ig-comment-action` | Balas, sembunyikan, tampilkan, atau hapus komentar. Body: `{ ig_comment_id, action, reply_text? }` | Token admin/user (guest ditolak) | Tanpa `--no-verify-jwt` |
| `ig-manual-retry` | Reset post gagal ke `scheduled` lalu memicu `ig-publish` | Token login | Tanpa `--no-verify-jwt` |

`ig-publish`, `ig-refresh-token`, dan `ig-sync-comments` dipanggil oleh Cloudflare Worker di `scheduler/` (publish dan sync tiap 15 menit, refresh token tiap Senin 09:00 UTC). Header `apikey` sengaja **tidak** diterima sebagai kredensial karena selalu ikut di setiap request Supabase client.

Selama `IG_AUTOPUBLISH_ENABLED = false` di `js/app.js` (kondisi saat ini), frontend menyembunyikan auto-upload dan sinkron komentar dan menyimpan post IG sebagai draft. Fungsi `ig-*` dan cron tetap berjalan; post lama berstatus `scheduled` tetap diterbitkan.

### Legacy

`login-dashboard` (login berbasis password + JWT buatan sendiri) sudah digantikan Supabase Auth. Fungsi ini sudah tidak dipakai dan sebaiknya di-undeploy. Bila sudah, hapus juga secret `DASHBOARD_JWT_SECRET` dan `DASHBOARD_JWT_KID`.
Fungsi ini memanggil RPC `verify_dashboard_password()` dengan service role. Sejak `sql/00` (v4) dan `sql/61`, RPC itu hanya bisa dipanggil `service_role`, jadi
client (anon key) tidak lagi bisa memanggilnya langsung.

## Ketergantungan database

Fungsi yang mengakses database memakai `SUPABASE_SERVICE_ROLE_KEY`, jadi **melewati RLS**: yang menentukan fungsi berjalan atau tidak adalah
tabel/kolom/view-nya ada, bukan policy-nya (`generate-wa-caption`, `scan-poster-ocr`, dan `send-telegram` tidak menyentuh database). Semua objek di bawah sudah dibuat oleh `sql/00_SETUP_LENGKAP_SATU_FILE.sql` (v4); kolom "Migrasi" hanya berguna untuk project
yang dibangun lewat migrasi bernomor (lihat `sql/README.md`). Daftar ini hasil pembacaan kode `index.ts` tiap fungsi.

| Fungsi | Tabel / view / RPC yang diakses | Migrasi |
|---|---|---|
| `admin-create-user`, `admin-reset-user-password`, `admin-change-password` | `dashboard_profiles` (cek role admin; `admin-create-user` juga menulis profil baru), Auth Admin API | 28, 30 |
| `generate-ig-caption`, `generate-ig-content-plan`, `generate-ig-year-plan` | `dashboard_profiles` (cek role admin/user). Isi konten dikirim client, fungsi tidak membaca tabel konten | 28 |
| `generate-wa-caption`, `scan-poster-ocr`, `send-telegram` | Tidak ada (token Telegram dikirim client dari `tg_config`) | - |
| `sync-rekap-program` | `dashboard_profiles`, `rekap_program_items` (tulis) | 28, 52 |
| `radar-risiko-jamaah` | `dashboard_profiles`, `kb_jamaah`, `programs`, view `v_total_bayar`, `tg_config` (penerima Telegram) | 28, 59 |
| `ig-publish` | `dashboard_profiles`, `ig_accounts`, `ig_posts`, `ig_post_media`, `ig_publish_logs` | 28, 41, 42 |
| `ig-refresh-token` | `ig_accounts`, `ig_publish_logs` | 41 |
| `ig-sync-comments` | `ig_accounts`, `ig_posts`, `ig_comments` (tulis), `tg_config` | 41, 43 |
| `ig-comment-action` | `dashboard_profiles`, `ig_accounts`, `ig_comments` | 28, 41, 43 |
| `ig-manual-retry` | `ig_posts` (lalu memanggil `ig-publish`) | 41 |
| `login-dashboard` (legacy) | RPC `verify_dashboard_password` (hanya `service_role`) | 25, 61 |
| `sync-infografis` (source tidak ada di repo) | Diduga `infografis_items` (tulis); tabel dibuat `sql/00` / `sql/55` | 55 |

`parse-broadcast-ai`, `generate-tg-reminder`, dan `generate-payment-reminder-wa` juga dipanggil `app.js` tanpa source di repo, jadi ketergantungan
databasenya tidak bisa diaudit dari sini.

## Secret dan environment

`SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` tersedia otomatis di runtime Edge Function.

| Secret | Dipakai oleh | Keterangan |
|---|---|---|
| `GEMINI_API_KEY` | semua fungsi Gemini | Ambil di https://aistudio.google.com/apikey |
| `GEMINI_API_KEY_2` ... `_5` | semua fungsi Gemini (opsional) | Key cadangan, dicoba berurutan bila key sebelumnya kena limit. Pakai key dari project GCP berbeda, kalau tidak kuotanya sama |
| `GEMINI_MODEL` | `generate-ig-*` | Ganti model tanpa edit kode |
| `IG_PLAN_RESPONSE_SCHEMA`, `IG_PLAN_THINKING_LEVEL` | `generate-ig-content-plan`, `generate-ig-year-plan` | Tuning opsional output terstruktur |
| `IG_APP_ID`, `IG_APP_SECRET` | `ig-refresh-token` | Dari Meta App |
| `IG_GRAPH_API_VERSION` | semua fungsi `ig-*` | Bawaan `v21.0` |
| `REKAP_PROGRAM_API_URL` | `sync-rekap-program` | URL web app Apps Script (berakhiran `/exec`) |
| `ALLOWED_ORIGIN` | `send-telegram` | Origin frontend yang diizinkan |

Contoh:

```bash
supabase secrets set GEMINI_API_KEY=isi_api_key_kamu
supabase secrets set IG_APP_ID=xxx IG_APP_SECRET=yyy
supabase secrets set REKAP_PROGRAM_API_URL=https://script.google.com/macros/s/XXXX/exec
```

## Deploy

Via CLI:

```bash
npm install -g supabase
supabase login
supabase link --project-ref <project-ref-kamu>

# Fungsi yang dipanggil tanpa JWT user, atau yang mengecek token sendiri
for f in send-telegram scan-poster-ocr generate-wa-caption \
         generate-ig-caption generate-ig-content-plan generate-ig-year-plan \
         ig-publish ig-refresh-token ig-sync-comments; do
  supabase functions deploy $f --no-verify-jwt
done

# Fungsi yang wajib JWT user login
for f in admin-create-user admin-reset-user-password admin-change-password \
         sync-rekap-program radar-risiko-jamaah ig-comment-action ig-manual-retry; do
  supabase functions deploy $f
done
```

Via Supabase Dashboard: paste satu file `index.ts` per fungsi. Karena itu setiap fungsi harus berdiri sendiri (lihat aturan di bawah).

URL fungsi: `https://<project-ref>.supabase.co/functions/v1/<nama-fungsi>`. `js/app.js` memanggilnya lewat `SUPABASE_URL/functions/v1/...`, jadi tidak perlu konfigurasi tambahan selain deploy dan secret. Panel **System** di dashboard menampilkan daftar fungsi yang dipanggil `app.js`.

## Aturan menulis Edge Function

- **Satu fungsi = satu file `index.ts` yang berdiri sendiri.** Jangan `import` file lokal (`../_shared/...`, `./postprocess.ts`). Deploy lewat Dashboard hanya membundel file fungsi itu, dan impor lokal gagal dengan "Module not found". Import dari URL atau paket luar (`https://esm.sh/...`, `jsr:`, `npm:`) boleh.
- Helper bersama (fallback multi-key Gemini, pasca-proses caption) **disalin inline** ke tiap fungsi yang memakainya. Bila helper diperbaiki, perbarui salinan di setiap fungsi. Acuannya ada di `_shared/gemini.ts` dan `generate-ig-caption/postprocess.ts`.
- Fungsi yang dipanggil user login harus memverifikasi token ke Supabase Auth dan mengecek `dashboard_profiles.dashboard_role` dengan service role, tidak mempercayai klaim dari client.
- Saat mengirim perubahan, sebut fungsi mana yang perlu di-deploy ulang dan kirim `index.ts`-nya utuh.
- Tes: `npm run test:edge` menguji `generate-ig-content-plan` (`test-core.mjs`; butuh Node dengan `--experimental-strip-types`).

## Ketidaksesuaian yang perlu ditindaklanjuti

1. **Fungsi dipanggil `app.js` tetapi source-nya tidak ada di repo:** `parse-broadcast-ai`, `generate-tg-reminder`, `generate-payment-reminder-wa`, dan `sync-infografis`. Bila sudah ter-deploy di Supabase, ambil source-nya dan simpan ke repo. Bila belum, fitur terkait (Parse dengan AI, reminder AI, refresh Infografis) akan gagal. Untuk `parse-broadcast-ai`, client sudah menyediakan cadangan pembaca regex.
2. **`generate-wa-caption` masih `import` dari `../_shared/gemini.ts`.** Ini melanggar aturan single-file dan gagal bila dideploy lewat Dashboard. Salin helper-nya inline seperti di `scan-poster-ocr`.
3. **`ig-refresh-token` dan `ig-sync-comments` menerima token user mana pun yang valid**, tanpa cek role (`ig-publish` sudah membatasi ke admin/user). Samakan dengan `ig-publish` agar `guest` tidak bisa memicunya.

## Perawatan berkala

Dua hal di luar kendali yang berganti dari waktu ke waktu, keduanya bisa diganti lewat secret tanpa edit kode:

- **`GEMINI_MODEL`**: ganti bila Google mempensiunkan model atau muncul error model tidak ditemukan. `generate-wa-caption` dan `scan-poster-ocr` masih menanam nama modelnya di kode, jadi perlu edit dan deploy ulang.
- **`IG_GRAPH_API_VERSION`**: Meta mempensiunkan tiap versi Graph API sekitar dua tahun setelah versi berikutnya rilis. Cek changelog Meta tiap 6 bulan, mis. `supabase secrets set IG_GRAPH_API_VERSION=v23.0`, lalu uji dengan satu post percobaan.

Pengecekan yang disarankan tiap Januari dan Juli:

1. Jalankan Rencana Setahun AI untuk pekan yang belum terisi dan pastikan tema musiman tayang di bulan yang tepat.
2. Cek bank tema `IG_ALUR_GRUP` (`IG_TEMA_ALUR` diturunkan darinya) dan daftar musiman `IG_TEMA_MUSIM` di `js/modules/ig-scheduler.js`. Langkah lengkap ada di `CHECKLIST_TAHUNAN_IG.md`.
3. Pastikan token Instagram masih diperpanjang otomatis (`ig-refresh-token`) dan workflow `keep-supabase-alive` masih aktif.

Bila konsep di **About Planner** berubah, sinkronkan ke `generate-ig-content-plan` dan `generate-ig-caption` lalu deploy ulang keduanya.
