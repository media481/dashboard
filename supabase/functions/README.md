# Edge Functions

Fungsi-fungsi ini **ditulis ulang** dari nol (bukan hasil ekstrak dari repo lama),
karena source code aslinya ternyata tidak pernah disimpan di repo — hanya
dibuat langsung lewat Supabase Dashboard. Kontraknya (request/response) sudah
disesuaikan persis dengan yang dipanggil `js/app.js`, jadi tinggal deploy.

## 1. send-telegram
Proxy sederhana ke Telegram Bot API (dibutuhkan karena Telegram API tidak
mendukung CORS untuk dipanggil langsung dari browser).

Tidak butuh secret tambahan — bot token dikirim dari client (disimpan di
tabel `tg_config`).

## 2. scan-poster-ocr
Membaca gambar poster program lalu mengekstrak data pakai **Gemini Vision**.

Butuh 1 secret:
- `GEMINI_API_KEY` — ambil gratis di https://aistudio.google.com/apikey

## 3. generate-wa-caption
Menyusun caption WhatsApp promosi program dari konsep mentah, pakai **Gemini
API** (model `gemini-3.5-flash`). Dibuat untuk menggantikan pemanggilan
`api.anthropic.com` langsung dari browser di `generateCaptionAI()` (js/app.js),
yang selalu gagal di luar sandbox artifact claude.ai karena CORS diblokir dan
tidak ada API key di client.

Pakai secret yang sama dengan scan-poster-ocr:
- `GEMINI_API_KEY` — ambil gratis di https://aistudio.google.com/apikey

Kalau secret ini sudah pernah di-set untuk `scan-poster-ocr`, tidak perlu
di-set ulang — cukup deploy function-nya.

## Cara deploy (perlu Supabase CLI)

```bash
# Install CLI kalau belum ada
npm install -g supabase

# Login & hubungkan ke project
supabase login
supabase link --project-ref <project-ref-kamu>

# Deploy semua function (--no-verify-jwt karena dipanggil pakai anon key langsung dari browser)
supabase functions deploy send-telegram --no-verify-jwt
supabase functions deploy scan-poster-ocr --no-verify-jwt
supabase functions deploy generate-wa-caption --no-verify-jwt

# Set secret Gemini (dipakai bareng oleh scan-poster-ocr & generate-wa-caption)
supabase secrets set GEMINI_API_KEY=isi_api_key_kamu
```

Setelah deploy, URL function-nya:
```
https://<project-ref>.supabase.co/functions/v1/send-telegram
https://<project-ref>.supabase.co/functions/v1/scan-poster-ocr
https://<project-ref>.supabase.co/functions/v1/generate-wa-caption
```

`scan-poster-ocr` dan `generate-wa-caption` sudah otomatis dipanggil `js/app.js`
lewat `SUPABASE_URL/functions/v1/...` masing-masing — tidak perlu setting
tambahan selain deploy + secret di atas.

`send-telegram` URL-nya perlu ditempel manual di form **Pengaturan Telegram**
di aplikasi (field "Edge Function URL").
