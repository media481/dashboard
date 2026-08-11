# Audit Merdeka (Taruna Inti) vs Standar "Vibe Coding in a Real Tech SaaS"

Sumber: `merdeka-main (4).zip` — PWA statis (HTML/CSS/vanilla JS) + Supabase,
deploy Cloudflare Workers assets. ~5.600 baris JS source, 30 file migrasi SQL.

Legenda: 🟢 sudah standar · 🟡 jalan tapi ada celah · 🔴 tidak ada / berisiko

| # | Aspek | Status |
|---|-------|--------|
| 1 | System design | 🟡 |
| 2 | System architecture | 🟡 |
| 3 | Frontend | 🟡 |
| 4 | APIs & backend logic | 🟡 |
| 5 | Databases & storage | 🟡 |
| 6 | Auth & permissions | 🔴 |
| 7 | Hosting & cloud | 🟢 |
| 8 | CI/CD & version control | 🔴 |
| 9 | Security | 🔴 |
| 10 | Rate limiting | 🔴 |
| 11 | Caching & CDN | 🟢 |
| 12 | Error tracking & logs | 🟡 |
| 13 | Monitoring & alerts | 🔴 |
| 14 | Testing | 🔴 |
| 15 | Scaling | 🟡 |

---

## 1. System design 🟡
Domain jelas (event → lomba/belanja/anggota/kas/gudang/dana sosial), single-tenant
satu organisasi. Wajar untuk skalanya.
**Celah:** dua pola data hidup berdampingan — `db` global + `ARRAY_TABLE_MAP` vs
modul Gudang yang fetch langsung. Ini sudah pernah bikin bug diam-diam (Gudang tak
ikut backup). Sudah didokumentasikan di CLAUDE.md, tapi tetap utang desain.
**Aksi:** migrasikan Gudang ke pola `db.xxx` yang sama, atau buat registry
`BACKUP_SOURCES[]` sehingga modul eventless baru wajib mendaftar.

## 2. System architecture 🟡
Statis + BaaS = arsitektur 2-lapis tanpa server sendiri. Tepat untuk biaya nol.
**Celah:** tidak ada lapisan backend tepercaya sama sekali. Semua aturan bisnis
(role, siapa boleh hapus apa) hidup di browser. Untuk data uang, minimal butuh
satu lapis Edge Function/Worker untuk aksi sensitif.
**Aksi:** tambah Cloudflare Worker (`/api/*`) sebagai lapisan tepercaya untuk
login, kirim Telegram, dan mutasi keuangan.

## 3. Frontend 🟡
Vanilla JS modular 30 file, bundle+minify lewat esbuild, PWA lengkap (manifest,
SW, install prompt, tour, ikon lokal Lucide — tanpa CDN pihak ketiga). Bagus.
**Celah:**
- `js/app.bundle.min.js` di-commit manual; kalau lupa `npm run build`, yang
  ter-deploy adalah kode LAMA tanpa peringatan apa pun.
- Render pakai string HTML + `esc()` manual di ratusan titik — satu kelupaan
  = XSS.
- Tidak ada code-splitting: semua modul dimuat di setiap halaman.
**Aksi:** CI yang menjalankan build lalu gagal kalau bundle berbeda dari yang
di-commit (lihat §8).

## 4. APIs & backend logic 🟡
"API" = PostgREST Supabase langsung dari browser + beberapa RPC
(`rpc_login`, `rpc_list_users`, `rpc_upsert_user`, `rpc_delete_user`,
`kt_gudang_restore_snapshot`). Operasi berisiko sudah atomik di server (bagus —
restore gudang satu transaksi, bukan delete+insert dari JS).
**Celah:**
- `api/emas.js` adalah sisa proyek **SinarKeu** (hardcode `sinarkeu.vercel.app`),
  tidak dipakai Merdeka dan tidak pernah dieksekusi di Cloudflare. Hapus.
- Panggilan Telegram dilakukan **dari browser** ke `api.telegram.org` dengan bot
  token yang diambil dari database — lihat §9.
- `saveDB()` mengirim diff seluruh tabel; tidak ada validasi tipe/nilai di server
  (constraint DB minim), jadi klien nakal bisa menulis nilai ngawur.

## 5. Databases & storage 🟡
Postgres/Supabase, 30 migrasi idempoten, ada `updated_at` server-side, deteksi
konflik multi-device, snapshot harian retensi 10, backup manual JSON.
Ini di atas rata-rata untuk proyek sekelas ini.
**Celah:**
- Migrasi dijalankan **manual** di dashboard, tanpa tabel versi skema — tidak ada
  cara tahu environment sudah di migrasi ke-berapa.
- `kt_error_log` tumbuh tanpa retensi otomatis (hanya tombol "Hapus Log").
- Logo & dokumen disimpan sebagai base64 di kolom teks (bukan Supabase Storage) —
  membengkakkan setiap `select *`.
**Aksi:** pakai Supabase CLI (`supabase/migrations/`) + `supabase db push`;
pg_cron hapus error log > 30 hari; pindahkan gambar ke Storage.

## 6. Auth & permissions 🔴 — prioritas tertinggi
Yang sudah benar: `kt_users` dikunci total dari anon (RLS aktif, nol policy),
password di-hash di server, hash tak pernah dikirim ke browser, logout mematikan
sesi di server, token sesi dikirim di header `x-session-token`.
**Celah kritis:**
1. **Semua tabel data terbuka penuh untuk `anon`** — policy `anon_full_access …
   using(true) with check(true)` pada 17+ tabel. Siapa pun yang membuka
   DevTools dan mengambil anon key (tertulis plaintext di `00-config.js`) bisa
   `select/insert/update/delete` **seluruh data keuangan** tanpa login sama sekali.
   Token sesi dikirim, tapi policy tidak pernah memeriksanya.
2. Role (`admin`/`user`/`petugas`) hanya dicek di JS (`canAccessSection`) — cuma
   menyembunyikan menu, bukan pengaman.
3. Hash password = `sha256` polos tanpa salt (`encode(digest(...),'hex')`) —
   rentan rainbow table kalau dump bocor.
**Aksi:**
```sql
-- ganti anon_full_access dengan policy yang benar-benar memverifikasi sesi
create policy "sesi_login_saja" on kt_anggota for all to anon
  using (session_is_logged_in()) with check (session_is_logged_in());
-- tulis-tulis sensitif (users, settings, telegram) -> session_is_admin()
```
plus ganti hash ke `crypt(p_password, gen_salt('bf', 10))` (pgcrypto sudah aktif).

## 7. Hosting & cloud 🟢
Cloudflare Workers assets, SPA fallback, `_headers` memasang HSTS preload,
X-Frame-Options DENY, nosniff, Referrer-Policy. Solid dan gratis.
**Catatan:** komentar di `_headers` menyebut "CSP lengkap tetap di meta tag
index.html" — **CSP itu tidak ada di `index.html`** (sudah saya cek: nol
`http-equiv`). Jadi saat ini tidak ada `script-src`/`connect-src` sama sekali.
**Aksi:** pindahkan CSP penuh ke `_headers`:
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://tykahltxzlpctfqdylno.supabase.co; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'
```
(inline `<script>` di baris 131 index.html perlu dipindah ke file agar tidak
butuh `unsafe-inline`.)

## 8. CI/CD & version control 🔴
Satu-satunya workflow adalah `keep-supabase-alive.yml` (ping tiap 3 hari) — itu
cron, bukan CI. Deploy manual, build manual, bundle di-commit tangan.
**Aksi minimum — `.github/workflows/ci.yml`:**
```yaml
on: [push, pull_request]
jobs:
  build-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci && npm run build
      - run: git diff --exit-code   # gagal kalau bundle tidak ikut di-commit
```
Lalu tambah job deploy `cloudflare/wrangler-action` pada branch `main`.

## 9. Security 🔴
- **Bot token Telegram bocor ke semua orang.** `kt_telegram_settings` ikut
  `anon_full_access`, dan `04-event-settings.js` memanggil
  `https://api.telegram.org/bot${botToken}/sendMessage` langsung dari browser.
  Siapa pun bisa membaca token dan mengambil alih bot.
  → pindahkan pengiriman ke Worker/Edge Function; simpan token sebagai secret,
  cabut policy anon pada tabel itu.
- Tidak ada CSP efektif (§7).
- `SECURITY_AUDIT.md` di repo ini isinya audit **SinarKeu**, bukan Merdeka —
  menyesatkan pembaca berikutnya. Ganti dengan dokumen ini.
- Anon key hardcode di source: wajar untuk anon key, **asalkan** RLS benar (§6).
  Sekarang RLS tidak benar, jadi efeknya setara service key bocor.
- Belum ada `Permissions-Policy` di `_headers`.

## 10. Rate limiting 🔴
Tidak ada sama sekali. `rpc_login` bisa dipanggil tanpa batas → brute-force
password 6 karakter selesai dalam hitungan menit. Yang ada hanya retry/backoff
untuk *outgoing* Telegram (bukan proteksi).
**Aksi:** tabel `kt_login_attempts (username, ip_hash, ts)`, di dalam `rpc_login`
tolak kalau >5 gagal dalam 15 menit; plus Cloudflare Rate Limiting rule di depan
`/rest/v1/rpc/rpc_login`.

## 11. Caching & CDN 🟢
Cloudflare edge untuk aset; service worker cache app-shell dengan versi
(`kt-shell-v46`) dan pembersihan cache lama; data Supabase sengaja `no-store`
dengan override `fetch` yang benar (pakai constructor `Headers` — detail yang
sering salah). Alasan tiap keputusan terdokumentasi. Ini bagian terkuat repo.
**Celah kecil:** `CACHE_VERSION` dinaikkan manual — gampang lupa.
**Aksi:** generate versi otomatis dari hash bundle di `build.js`.

## 12. Error tracking & logs 🟡
Ada global `error` + `unhandledrejection` handler, toast ke user, dan tabel
`kt_error_log` terpusat lintas device dengan `device_info`/`url`/`user_name` +
index waktu. Untuk aplikasi tanpa backend, ini sudah bagus.
**Celah:** tabel log bisa ditulis & **dihapus** siapa pun (anon full access) —
penyerang bisa membersihkan jejaknya. Tidak ada stack trace, hanya pesan toast.
Tidak ada retensi.
**Aksi:** policy `insert only` untuk anon, `delete` khusus admin; simpan
`error.stack`; pg_cron retensi 30 hari.

## 13. Monitoring & alerts 🔴
Tidak ada uptime check, tidak ada alert. Workflow keepalive gagal → hanya merah
di tab Actions, tidak ada yang diberi tahu.
**Aksi:** karena bot Telegram sudah ada, kirim alert ke chat yang sama:
(a) step `if: failure()` di workflow keepalive, (b) cron job kedua yang cek
`https://merdeka.<akun>.workers.dev` + jumlah baris `kt_error_log` 24 jam
terakhir, kirim ringkasan harian.

## 14. Testing 🔴
Nol. Tidak ada test runner, tidak ada file test; CLAUDE.md menyatakan
"testing manual di browser". Padahal logika `syncArrayTable`/deteksi konflik/
`migrasiItemIdHadiah` adalah kode paling rawan di repo, dan riwayat bug-nya
(toast sukses palsu, orphan belanja, race gudang) membuktikan itu.
**Aksi bertahap:**
1. `node --test` untuk fungsi murni: `fmtRp`, `esc`, `bersihkanOrphan*`,
   `migrasiItemIdHadiah`, `isWithinQuietHours`.
2. Vitest + mock Supabase client untuk `syncArrayTable` (kasus: konflik
   `updated_at`, ghost row, unique violation hadiah).
3. Playwright smoke: login → tambah anggota → cek dashboard.
Jalankan semuanya di workflow §8.

## 15. Scaling 🟡
Beban nyata (satu karang taruna, puluhan pengguna) jauh di bawah batas — tidak
ada masalah hari ini.
**Batas arsitektural:**
- `loadDB()` melakukan `select *` pada **21 tabel sekaligus** saat app dibuka,
  tanpa paginasi/filter event. Data beberapa tahun = payload puluhan MB di HP.
- `saveDB()` mem-push diff seluruh tabel, bukan per-baris yang berubah.
- Base64 gambar di kolom teks ikut terbawa setiap load.
- Supabase free tier akan pause; sudah diakali keepalive (solusi tepat).
**Aksi:** filter `select` berdasarkan `event_id` aktif, arsipkan event lama,
pindahkan gambar ke Storage.

---

## Urutan pengerjaan yang disarankan

1. **RLS berbasis sesi** menggantikan `anon_full_access` (§6) — ini yang membuat
   seluruh data keuangan terbuka ke publik saat ini.
2. **Cabut bot token Telegram dari klien** (§9).
3. **Rate limit `rpc_login` + hash bcrypt bersalt** (§10, §6).
4. **CSP di `_headers`** (§7).
5. **CI build-check + deploy** (§8).
6. Test unit untuk lapisan sync (§14), lalu alert Telegram (§13).
7. Bersih-bersih: hapus `api/emas.js`, ganti `SECURITY_AUDIT.md` (§4, §9).
