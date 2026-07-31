# CLAUDE.md

Panduan konteks untuk Claude (atau siapa pun) saat mengerjakan proyek ini.

## Apa proyek ini

**Dashboard Amiru** — dashboard web untuk PT Amiru Haramain Indonesia (travel Umroh):
mengelola data program Umroh, jadwal tamu, data jamaah per program, kuitansi, notifikasi
Telegram, dan crosscheck poster promosi vs data yang diinput. Dipakai oleh 3 role:
`admin`, `user`, `guest` (dan pengunjung anonim yang belum login).

Bahasa UI & komentar kode: **Bahasa Indonesia**. Ikuti gaya ini saat menambah fitur.

## Stack

- Vanilla JavaScript (tanpa framework/bundler), HTML, CSS murni
- Supabase (Postgres + REST API) sebagai backend, diakses langsung dari browser
  via `@supabase/supabase-js` (CDN) dan sebagian via `fetch()` manual ke endpoint REST
- Supabase Edge Functions (Deno/TypeScript) untuk hal yang butuh secret/server-side
- PWA: `manifest.json` + `service-worker.js` (strategi network-first, fallback cache)
- jsPDF (CDN) untuk generate kuitansi PDF

## Struktur file AKTIF (yang benar-benar di-load browser)

```
index.html          ← struktur HTML saja, load css/style.css + js/app.js
css/style.css        ← semua styling (CSS custom properties di :root untuk warna brand)
js/app.js            ← SATU-SATUNYA file JS, berisi SEMUA logic + koneksi Supabase
manifest.json         ← config PWA (name, theme_color, icons)
service-worker.js     ← precache list, HARUS disinkronkan manual kalau nama file berubah
icons/                ← 9 file ikon PWA sesuai daftar di manifest.json
sql/
  00_setup_semua_tabel.sql     ← CREATE TABLE + RLS untuk semua tabel (dari nol)
  create_kwt_kuitansi.sql      ← SQL khusus tabel kwt_kuitansi
  tambah_pembayaran_jamaah.sql ← migrasi tambahan: tabel pembayaran_jamaah
                                  (jalankan ini di project yang SUDAH jalan)
  tambah_dokumen_jamaah.sql    ← migrasi tambahan: kolom kb_jamaah.dokumen jsonb
                                  (jalankan ini di project yang SUDAH jalan)
  tambah_pendaftaran.sql       ← migrasi tambahan: tabel pendaftaran (calon jamaah)
                                  (jalankan ini di project yang SUDAH jalan)
  tambah_nota_audit.sql        ← migrasi tambahan: nomor nota resmi dari DB (trigger +
                                  sequence, kolom pembayaran_jamaah.nomor_nota) + tabel
                                  nota_audit_log (ledger append-only, UPDATE/DELETE
                                  diblokir trigger) — lihat panel Admin > Audit Nota
                                  (jalankan ini di project yang SUDAH jalan)
.github/workflows/
  keep-supabase-alive.yml      ← ping REST API tiap 3 hari biar project Supabase
                                  free tier tidak auto-pause (butuh secret
                                  SUPABASE_URL & SUPABASE_ANON_KEY di repo GitHub)
supabase/functions/
  send-telegram/index.ts       ← proxy ke Telegram Bot API
  scan-poster-ocr/index.ts     ← OCR poster pakai Gemini Vision (butuh GEMINI_API_KEY)
  README.md                     ← panduan deploy edge functions via Supabase CLI
```

**PENTING:** `index.html` HANYA punya satu `<script src="js/app.js">`. Tidak ada file JS
lain yang di-load. Kalau menambah fitur, tambahkan langsung ke `js/app.js` (jangan buat
file `.js` baru terpisah kecuali memang berniat mengubah `index.html` untuk me-load-nya
juga, dan update `service-worker.js` precache list-nya).

Riwayat: proyek ini pernah beberapa kali disusun ulang (monolith → dipecah jadi ~22 file
modular → digabung lagi jadi satu `js/app.js`). Kalau menemukan file `.js` lepas di root
atau folder `js/` selain `app.js`, kemungkinan besar itu sisa lama yang tidak dipakai —
cek dulu apakah direferensikan di `index.html`/`service-worker.js` sebelum diasumsikan aktif.

## Tabel Supabase yang dipakai

| Tabel | Fungsi |
|---|---|
| `programs` | Data program Umroh (field admin-only digabung di kolom `admin_data_lengkap` jsonb) |
| `jadwal_tamu` | Jadwal kunjungan tamu ke kantor |
| `kb_jamaah` | Data jamaah per program (kolom `dokumen` jsonb = checklist kelengkapan dokumen per jamaah) |
| `pendaftaran` | Daftar minat calon jamaah (nama, WA, program diminati, asal) sebelum resmi masuk `kb_jamaah` |
| `pembayaran_jamaah` | Riwayat pembayaran/cicilan per jamaah (tampil menyatu di tab "Keberangkatan") |
| `featured_programs` | Program yang ditandai unggulan (diakses via `fetch()` REST langsung, bukan `.from()`) |
| `app_config` | Password login admin/CS (key-value) |
| `tg_config` | Config notifikasi Telegram (bot token, edge URL, daftar penerima) |
| `kwt_kuitansi` | Kuitansi — tabel sudah disiapkan, belum otomatis dipakai di `js/app.js` |

Setup Supabase baru: jalankan `sql/00_setup_semua_tabel.sql` di SQL Editor, lalu ganti
password default di `app_config`, lalu update `SUPABASE_URL` & `SUPABASE_ANON_KEY` di
`js/app.js` baris 4–5.

## Peta bagian `js/app.js` (2500+ baris, dibagi per komentar section)

1. Supabase Config — 2. State — 3. Utility Functions (termasuk `withRetry()` untuk
   retry request baca yang gagal karena masalah jaringan) — 4. Generate Auto WA Text —
5. Tab Switching — 6. Mobile Sidebar — 7. Render Skeleton — 8. Load Data from Supabase —
9. Render Table — 10. Search & Sort — 11. Detail Modal — 12. Admin Login —
13. Admin Panel — 14. Admin CRUD Operations — 15. Parse Broadcast (auto-isi form dari
teks broadcast WA) — 16. Export/Import — 17. Delete Confirm — 18. Jadwal Tamu (CRUD) —
18B. Form Pendaftaran (CRUD daftar minat calon jamaah, tabel `pendaftaran`) —
19. Keberangkatan (CRUD data jamaah + tabel pembayaran/cicilan tergabung dalam satu tab,
terhubung ke harga program & auto-sync status di kb_jamaah) — 19B. Kelola Cicilan
(modal dipakai dari tombol "Bayar" di tabel Keberangkatan) —
19C. Kelengkapan Dokumen (checklist dokumen per jamaah, disimpan di kolom
kb_jamaah.dokumen jsonb) —
20. Kuitansi — 21. Featured Programs —
21A. Crosscheck Module (OCR poster vs data) — 21B. Telegram Module —
22. Init — 23. Close Modals on Overlay Click — 24. Poster Hover Popup

## Role & akses

Role: `admin`, `user`, `guest`, atau belum login sama sekali (anonim).
- Anonim → hanya lihat "Program Umroh" & "Unggulan"
- `guest` (sudah login) → tambahan lihat "Jadwal Tamu" & "Keberangkatan" (read-only)
- `user` & `admin` → boleh tambah/edit/hapus data (dicek via `canManageProgramData()`)
- `admin` saja → akses section "Manajemen": Edit & Tambah Program, Crosscheck,
  Telegram, Pengaturan User

Sidebar bersifat role-aware, di-render oleh `renderSidebarNav()`. Warna brand pakai CSS
custom properties `--brand`, `--brand-deep`, `--brand-tint` di `css/style.css` — ganti di
satu tempat itu untuk reskin semua elemen (sidebar, tombol aktif, dsb).

## Kalau menambah/mengubah fitur

- Edit langsung di `js/app.js`, ikuti pola section comment yang sudah ada
- Pakai `showToast(msg, type)` untuk feedback ke user, bukan `alert()`
- Operasi baca (SELECT) yang rawan gagal jaringan → bungkus dengan `withRetry()`
- Operasi tulis (insert/update/upsert) JANGAN dibungkus `withRetry()` — risiko data dobel
- Kalau menambah file baru yang perlu di-load browser, jangan lupa update
  `service-worker.js` (`APP_SHELL` array) supaya PWA cache-nya ikut sinkron, dan naikkan
  `CACHE_NAME` versinya
- Akurasi data finansial adalah prioritas karena datanya dipakai untuk laporan resmi
