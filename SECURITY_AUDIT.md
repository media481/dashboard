# Audit Keamanan SinarKeu — Multiuser & Multidevice

Ini audit menyeluruh terhadap kode yang diupload, plus perbaikan yang sudah
saya terapkan langsung di kode. Ditulis apa adanya, termasuk batasan
arsitektur yang tidak bisa "disulap" tanpa perubahan besar.

## Model arsitektur saat ini (penting dipahami dulu)

SinarKeu **bukan** SaaS multi-tenant klasik (satu backend terpusat, banyak
user login). Modelnya: **bring-your-own-Supabase** — tiap "akun" di app ini
sebenarnya adalah satu project Supabase terpisah (URL + anon key sendiri),
dan device-device yang tahu password yang sama bisa saling sinkron karena
menurunkan AES key yang identik dari password itu. Tidak ada Supabase Auth
sama sekali; semua request pakai satu anon key yang sama untuk semua orang.

Ini valid dan wajar untuk kasus pemakaian "keluarga/kelompok kecil berbagi
satu buku kas dengan password bersama". Tapi ini **bukan** isolasi
multi-user yang sesungguhnya di level database — penting supaya ekspektasi
soal "aman untuk multiuser" ini jelas dari awal.

## Temuan & status

### 🔴 KRITIS — Data transaksi tersimpan PLAINTEXT di Supabase (SUDAH DIPERBAIKI)
Kolom `amount`, `category`, `description`, `attachment` di tabel
`transactions`, dan seluruh isi tabel `backups` (kolom `data`), dikirim ke
Supabase apa adanya — bukan ciphertext. Hanya kredensial Supabase & tabel
`settings` yang sebelumnya dienkripsi. Artinya siapa pun yang bisa membaca
database langsung (bukan lewat app) — lewat dashboard Supabase, service-role
key yang bocor, backup database yang salah taruh, dsb — bisa melihat seluruh
riwayat keuangan pengguna secara terbuka.

**Perbaikan yang sudah diterapkan:** `amount/category/description/attachment/
type` sekarang dienkripsi jadi satu kolom `enc_payload` (AES-GCM, kunci dari
password, tidak pernah dikirim ke server) sebelum push — lihat
`window.encodeCloudTxPayload`/`window.decodeCloudTxRow` di `js/crypto.js`.
Semua titik push (`transaction.js`, restore backup di `backup.js`) dan semua
titik pull (4 tempat di `transaction.js`, 1 di `backup.js`) sudah disesuaikan.
Backup cloud (tabel `backups`) sekarang menyimpan blob JSON yang juga
dienkripsi, bukan JSON polos.

**Yang perlu Anda lakukan:** jalankan `sql/harden_transactions_encryption.sql`
di Supabase SQL Editor **sebelum** deploy kode baru (menambah kolom
`enc_payload`, membuat kolom lama nullable). Baris lama tetap terbaca (ada
fallback baca plaintext lama), jadi migrasi bisa jalan bertahap tanpa
kehilangan data.

### 🔴 KRITIS — Tidak ada RLS / isolasi nyata di level database
Tidak ditemukan satupun `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY` di
migrasi yang ada. `account_tag` yang dipakai untuk memisahkan data antar
"akun" murni filter di sisi APLIKASI (client menambahkan `&account_tag=eq.X`
di query) — bukan pagar di database. Siapa pun yang punya URL + anon key
project ini bisa memanggil REST API Supabase langsung (di luar app ini sama
sekali) dan membaca/menulis/menghapus SEMUA baris, lepas dari account_tag.

**Kenapa tidak saya "RLS-kan" secara ketat:** RLS berbasis identitas (mis.
`auth.uid() = user_id`) butuh Supabase Auth — dan app ini sengaja tidak
memakainya (modelnya password + AES lokal, bukan login server). Tanpa
identitas dari server, tidak ada cara bagi Postgres membedakan "device
A milik akun X" vs "device B mengaku akun X". Saya sudah aktifkan RLS
dengan kebijakan eksplisit (bukan grant default) di
`sql/harden_transactions_encryption.sql`, tapi kebijakannya masih
mengizinkan penuh untuk role `anon` — perbaikan defensif, bukan solusi
isolasi. **Garis pertahanan sesungguhnya untuk kerahasiaan data, saat ini,
adalah enkripsi di atas** — bukan RLS. Lihat roadmap di bawah untuk solusi
isolasi yang sebenarnya.

### 🟠 TINGGI — Tidak ada proteksi brute-force di layar unlock (SUDAH DIPERBAIKI)
Sebelumnya tidak ada batas percobaan password. Saya tambahkan throttle
exponential backoff (mulai setelah 3x gagal, maksimum jeda 5 menit) di
`js/crypto.js` (`getUnlockWaitMs`/`recordUnlockAttempt`), dipasang di layar
lock utama (`js/app.js`). Catatan: ini proteksi sisi klien saja — kalau
attacker menyalin `crypto_salt` + `crypto_check` lalu brute-force offline di
mesin sendiri, throttle ini tidak berlaku (PBKDF2 300rb iterasi tetap jadi
lini pertahanan utama untuk skenario itu — pastikan password yang dipakai
cukup panjang/acak).

### 🟡 SEDANG — File `js/db.js.bak` ikut ter-deploy (SUDAH DIPERBAIKI)
File backup kode ikut ter-package ke production. Sudah dihapus dari paket
ini. Saran: tambahkan `*.bak` ke `.gitignore` agar tidak terulang.

### 🟡 SEDANG — Tidak ada security headers (SUDAH DIPERBAIKI)
Tidak ada Content-Security-Policy atau header pengaman lain. CSP utama
(script-src, connect-src, dll -- dibatasi ke CDN yang benar-benar dipakai app)
dipasang lewat meta tag di `index.html`. Header yang TIDAK bisa/tidak berfungsi
lewat meta tag (`X-Frame-Options`, `Strict-Transport-Security`,
`X-Content-Type-Options`, dan `frame-ancestors` -- yang terakhir ini secara
eksplisit diabaikan browser kalau dikirim lewat meta, per spesifikasi CSP)
sekarang dipasang lewat file `_headers` di root proyek, dibaca otomatis oleh
Cloudflare Pages tanpa perlu Worker terpisah.

### 🟡 SEDANG — Password sesi disimpan di sessionStorage dengan XOR sederhana
`_storeSessionPassword`/`restoreSessionCryptoKey` menyimpan password
ter-obfuscate (XOR, bukan enkripsi sungguhan) di sessionStorage supaya sesi
bertahan setelah `location.reload()`. Ini cukup untuk melindungi dari
"lirikan sekilas" tapi bukan enkripsi nyata — siapa pun yang punya akses
DevTools ke tab yang sedang terbuka bisa membalikkannya dalam hitungan
detik. Ini trade-off yang wajar untuk UX (supaya tidak perlu re-entry
password di setiap reload), tapi perlu disadari batasnya: kalau device fisik
dipinjam orang lain SAAT sesi masih terbuka, ini tidak melindungi apa-apa.
Auto-lock (`js/autolock.js`) yang sudah ada adalah mitigasi yang tepat untuk
skenario ini — pastikan durasinya cukup singkat untuk kebutuhan Anda.

### 🟢 RENDAH — Tidak ditemukan celah XSS pada input pengguna
Titik-titik `innerHTML` yang menyisipkan data pengguna (deskripsi transaksi,
nama akun) sudah konsisten memakai `window.escapeHtml`. Bagus, tidak perlu
perubahan.

### 🟢 CATATAN — Ekspor Google Sheets tetap plaintext (sengaja, bukan bug)
`js/backup.js` (fitur ekspor ke Google Sheets webhook) mengirim data
transaksi plaintext ke endpoint Google Apps Script milik pengguna sendiri.
Ini fitur ekspor yang memang diminta pengguna untuk keluar dari sistem
terenkripsi (agar bisa dibaca di Sheets) — bukan celah, tapi pengguna perlu
sadar bahwa begitu data diekspor ke sana, ia sudah keluar dari perlindungan
enkripsi app ini sepenuhnya (tergantung keamanan skrip Apps Script mereka
sendiri).

### 🟢 CATATAN — `payment_reminders` sudah ikut dienkripsi
Sebelumnya belum sempat dikerjakan (disebutkan di draf audit awal). Sudah
diselesaikan: `name`, `note`, `day`, `recurrence`, `month` sekarang
dienkripsi jadi kolom `enc_payload`, dengan pola identik seperti
`transactions` (termasuk fallback baca plaintext untuk baris lama). Semua
titik push (`savePaymentReminder`, `syncAllPaymentReminders`,
`migratePaymentReminders`, dan fungsi lama tak terpakai
`pushPaymentReminderToCloud` di `db.js`) dan titik pull
(`loadPaymentReminders`) sudah disesuaikan. Migrasi kolomnya sudah
ditambahkan ke `sql/harden_transactions_encryption.sql`.

## Roadmap untuk multiuser SaaS yang sesungguhnya

Kalau tujuan akhirnya benar-benar SaaS multi-tenant (banyak user asing,
masing-masing hanya boleh lihat datanya sendiri, dijamin oleh database —
bukan cuma kesepakatan aplikasi), itu perlu proyek terpisah yang lebih
besar:

1. **Migrasi ke Supabase Auth** (email/password atau magic link) — tiap user
   punya `auth.uid()` asli dari server.
2. **RLS policy per baris** berbasis `auth.uid() = user_id` di semua tabel,
   menggantikan pendekatan `account_tag` yang sekarang.
3. Model enkripsi password-lokal yang sekarang perlu disesuaikan (kunci
   enkripsi bisa tetap diturunkan dari password, tapi identitas akun/session
   dipegang oleh Supabase Auth, bukan localStorage semata).
4. Kebijakan RLS berbeda untuk `service_role` (dipakai server-side saja,
   tidak pernah di client) vs `authenticated` (dipakai client, dibatasi
   `auth.uid()`).

Ini pekerjaan multi-minggu, bukan patch kecil — beri tahu saya kalau Anda
mau mulai merancang ini, saya bisa bantu bertahap (skema dulu, lalu migrasi
data, baru ganti alur login di UI).

## Ringkasan file yang berubah di paket ini

- `js/crypto.js` — enkripsi field transaksi & payment reminder
  (`encodeCloudTxPayload`/`decodeCloudTxRow`,
  `encodeCloudReminderPayload`/`decodeCloudReminderRow`) + throttle anti
  brute-force.
- `js/transaction.js` — semua titik push/pull transaksi memakai enkripsi.
- `js/payment-reminder.js` — semua titik push/pull jadwal pembayaran
  memakai enkripsi.
- `js/backup.js` — backup cloud & restore-dari-file memakai enkripsi.
- `js/db.js` — fungsi lama `pushPaymentReminderToCloud` (tak terpakai)
  ikut diamankan untuk berjaga-jaga.
- `js/app.js` — layar lock memakai throttle.
- `index.html` — CSP + referrer policy dasar.
- `sql/harden_transactions_encryption.sql` — migrasi DB (jalankan dulu di
  Supabase sebelum deploy kode baru); mencakup `transactions`, `backups`,
  dan `payment_reminders`.
- `js/db.js.bak` — dihapus dari paket.
