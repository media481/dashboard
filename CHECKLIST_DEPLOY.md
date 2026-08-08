# CHECKLIST DEPLOY — Dashboard Amiru

Panduan urutan supaya dashboard jalan (baca data **dan** bisa login/tulis).
Satu file SQL sudah disiapkan: `sql/SETUP_LENGKAP_SATU_FILE.sql`
(gabungan semua migrasi + hardening, **bebas urutan** — tinggal jalankan sekali).

---

## 0. PERSIAPAN SEBELUM DEPLOY (PENTING — ini penyebab error PGRST301 kamu)

Error di konsol:
```
PGRST301: None of the keys was able to decode the JWT
```
artinya `js/app.js` menunjuk ke Supabase project **A**, tapi JWT login
ditandatangani pakai secret/`kid` dari project **B**. Satu project rusak
= seluruh dashboard mati (karena token login ditempel ke SEMUA request).

**Pastikan konsisten:** URL + anon key di `js/app.js` baris 4–5 harus sama
persis dengan project tempat kamu jalankan SQL & deploy edge function.

- `app.js:4`  → `SUPABASE_URL`
- `app.js:5`  → `SUPABASE_ANON_KEY`

Cek juga `config.js` (file orphan) yang masih menunjuk project lain
(`rkdhssbyqqyheczejtix`). File itu TIDAK dipakai runtime, tapi kalau kamu
pakai nilai dari situ, pastikan itu project yang SAMA dengan `app.js`.

---

## 1. SETUP SUPABASE (SQL)

1. Buka Supabase Dashboard → project yang **sama** dengan `app.js` → **SQL Editor**.
2. New Query → paste isi `sql/SETUP_LENGKAP_SATU_FILE.sql` → **Run**.
3. Cek tidak ada error merah. (Idempoten — aman dijalankan ulang.)
4. **Ganti password default** (WAJIB, jangan biarkan `ganti-password-admin`):
   ```sql
   update app_config set value = 'PASSWORD_ADMIN_KAMU'
     where key = 'pass_administrator';
   update app_config set value = 'PASSWORD_CS_KAMU'
     where key = 'pass_cs';
   ```
5. (Opsional) isi `tg_config` untuk notifikasi Telegram, `programs` untuk data awal.

---

## 2. JWT SIGNING KEY (biar login bisa bikin token valid)

1. Supabase Dashboard → **Project Settings → JWT Signing Keys**.
2. **Create new key** → tipe *Shared secret* (HS256).
   - Biarkan Supabase generate, atau pakai secret sendiri.
   - Setelah dibuat, statusnya *Standby* (tidak perlu Rotate).
3. Catat 2 hal: **SECRET** dan **kid (UUID)**.

> Tanpa step ini, `login-dashboard` akan gagal tanda-tangan JWT → login mati.

---

## 3. DEPLOY EDGE FUNCTIONS

Butuh **Supabase CLI** (`npm i -g supabase` / `brew install supabase`).
Login: `supabase login`, lalu `supabase link --project-ref <PROJECT_REF>`.

### 3a. login-dashboard (WAJIB — kalau ini gak jalan, admin/user gak bisa login)
```bash
supabase secrets set DASHBOARD_JWT_SECRET=<SECRET_dari_step_2>
supabase secrets set DASHBOARD_JWT_KID=<kid_UUID_dari_step_2>
supabase functions deploy login-dashboard --no-verify-jwt
```
> `--no-verify-jwt` wajib: client belum punya token saat login.

### 3b. send-telegram (notifikasi)
```bash
supabase functions deploy send-telegram --no-verify-jwt
```

### 3c. scan-poster-ocr (OCR Crosscheck — butuh Gemini)
```bash
supabase secrets set GEMINI_API_KEY=<apikey_dari_aistudio.google.com/apikey>
supabase functions deploy scan-poster-ocr --no-verify-jwt
```

> Catatan: `login-dashboard` butuh juga `SUPABASE_URL` & `SUPABASE_SERVICE_ROLE_KEY`
> — itu otomatis tersedia di environment edge function, tidak perlu di-set manual.

---

## 4. SAMAKAN URL/KEY DI APP

Edit `js/app.js` baris 4–5 pakai URL & anon key project yang SAMA:
```js
const SUPABASE_URL = "https://<project_ref>.supabase.co";
const SUPABASE_ANON_KEY = "<anon_key_dari_project_yang_sama>";
```

> Jangan lupa naikkan `CACHE_NAME` di `service-worker.js` (sekarang `v33`)
> kalau kamu ubah `index.html`/`css`/`app.js`, supaya PWA tidak pakai cache lama.

---

## 5. TEST DI BROWSER

1. Buka `index.html` via server statis (bukan `file://`):
   ```bash
   npx serve .        # atau: python3 -m http.server
   ```
2. Buka DevTools → **Application → Storage → Clear sessionStorage** dulu
   (buang JWT rusak dari sesi sebelumnya).
3. Cek Console: halaman depan (Program Umroh) harus load **tanpa** error 401.
   - Kalau `programs` masih 401 → URL/key salah atau SQL belum jalan di project itu.
4. Klik menu login → masukkan password admin → harus muncul "Berhasil login".
   - Kalau gagal: cek edge function `login-dashboard` log di Supabase Dashboard
     (Functions → Logs) — biasanya `DASHBOARD_JWT_SECRET`/`KID` salah.
5. Coba tambah/edit program → harus tersimpan (WRITE butuh JWT authenticated).

---

## 6. CATATAN KEAMANAN YANG MASIH TERBUKA

| Item | Status | Keterangan |
|---|---|---|
| Password bocor ke publik | 🟢 FIX | `app_config` tertutup; verifikasi via RPC server-side |
| WRITE sembarangan (anon) | 🟢 FIX | RLS WRITE butuh `authenticated` |
| Brute-force login | 🟢 FIX | rate-limit 5/1 menit via RPC |
| **Telegram bot token terekspos** | 🔴 | `tg_config` masih `select using(true)` & dibaca client (`app.js:4961`) → token bot bisa diambil lewat REST API publik. Jika mau aman: ubah ke `auth.role()='authenticated'` (tapi fitur Telegram jadi butuh login). |
| **snapshot_backup publik** | 🟡 | `select/insert/delete using(true)` → data cadangan & isinya bisa dibaca/dihapus publik. Kunci ke `authenticated` bila mau. |
| **1 client untuk read+write** | 🟡 | App pakai 1 Supabase client; token login ditempel ke request baca. JWT rusak = data publik ikut mati (PGRST301). Idealnya pisah client baca (anon) vs tulis (token). Perlu refactor `js/app.js`. |
| File orphan di `js/` | 🟡 | 18 file JS + `js/index.html` tidak dipakai tapi membingungkan. Quarantine ke `_legacy_unused/` bila mau. |

---

## 7. RINGKASAN PERINTAH (copy-paste)

```bash
# 1. (di SQL Editor) jalankan: sql/SETUP_LENGKAP_SATU_FILE.sql

# 2. (terminal, sudah supabase login & link)
supabase secrets set DASHBOARD_JWT_SECRET=<secret>
supabase secrets set DASHBOARD_JWT_KID=<kid>
supabase functions deploy login-dashboard --no-verify-jwt
supabase functions deploy send-telegram --no-verify-jwt
supabase secrets set GEMINI_API_KEY=<key>
supabase functions deploy scan-poster-ocr --no-verify-jwt

# 3. edit js/app.js baris 4-5 -> URL & anon key project yang SAMA

# 4. lokal test
npx serve .
# lalu clear sessionStorage di browser, refresh, login.
```

---
*Dibuat dari review `dashboard-main-fixed (3).zip`. File SQL tunggal sudah
menggabungkan 00_setup + seluruh migrasi tambah_* + fix_bug6 + hardening_rls,
dengan RLS final langsung tertanam (tidak ada urutan file).*
