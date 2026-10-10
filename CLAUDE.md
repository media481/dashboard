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
css/style.css        ← SATU-SATUNYA CSS aktif (semua styling, CSS custom
                        properties di :root untuk warna brand). **PENTING:**
                        ada file `/style.css` lepas di root project yang
                        BASI/tidak dipakai (sisa restrukturisasi lama, index.html
                        tidak meng-load-nya) — jangan pernah edit file itu,
                        selalu edit `css/style.css`. Cek dulu dengan
                        `grep "style.css" index.html` kalau ragu file mana yang aktif.
js/app.js            ← SATU-SATUNYA file JS, berisi SEMUA logic + koneksi Supabase
manifest.json         ← config PWA (name, theme_color, icons)
service-worker.js     ← precache list, HARUS disinkronkan manual kalau nama file berubah
icons/                ← 9 file ikon PWA sesuai daftar di manifest.json
sql/
  01_setup_semua_tabel.sql     ← CREATE TABLE + RLS untuk semua tabel (dari nol)
  02_create_kwt_kuitansi.sql      ← SQL khusus tabel kwt_kuitansi
  03_tambah_pembayaran_jamaah.sql ← migrasi tambahan: tabel pembayaran_jamaah
                                  (jalankan ini di project yang SUDAH jalan)
  06_tambah_dokumen_jamaah.sql    ← migrasi tambahan: kolom kb_jamaah.dokumen jsonb
                                  (jalankan ini di project yang SUDAH jalan)
  04_tambah_pendaftaran.sql       ← migrasi tambahan: tabel pendaftaran (calon jamaah)
                                  (jalankan ini di project yang SUDAH jalan)
  19_tambah_nota_audit.sql        ← migrasi tambahan: nomor nota resmi dari DB (trigger +
                                  sequence, kolom pembayaran_jamaah.nomor_nota) + tabel
                                  nota_audit_log (ledger append-only, UPDATE/DELETE
                                  diblokir trigger) — lihat panel Admin > Audit Nota
                                  (jalankan ini di project yang SUDAH jalan)
  29_tambah_role_guest_readonly.sql ← kunci RLS write (insert/update/delete) semua tabel
                                  inti ke role admin/user saja lewat current_dashboard_role(),
                                  supaya role guest benar-benar read-only di database,
                                  bukan cuma disembunyikan di UI (jalankan setelah
                                  28_migrate_supabase_auth.sql & 26_hardening_rls_keamanan.sql)
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
| `assets` | Link/bookmark ke dokumen penting — tab "Link & Dokumen" di menu Assets |
| `hotel_saudi_arabia` | Referensi data hotel Arab Saudi, read-only (hasil import CSV) — tab "Hotel Saudi Arabia" di menu Assets |

Setup Supabase baru: jalankan `sql/01_setup_semua_tabel.sql` di SQL Editor, lalu ganti
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
- `guest` (sudah login) → tambahan lihat semua tab `nav-loggedin-only` (Jadwal Tamu,
  Pendaftaran, Keberangkatan, Dokumen) tapi **read-only** — tombol tambah/edit/hapus
  disembunyikan (`canManageProgramData()`) DAN ditolak di level RLS database
  (lihat `sql/29_tambah_role_guest_readonly.sql`), jadi tidak bisa ditembus lewat API
  langsung meski punya JWT authenticated
- `user` & `admin` → boleh tambah/edit/hapus data (dicek via `canManageProgramData()`)
- `admin` saja → akses section "Manajemen": Edit & Tambah Program, Crosscheck,
  Telegram, Pengaturan User

Buat akun guest baru lewat tab Admin > Pengaturan User, pilih role "Guest (lihat
saja, tanpa akses tulis)". Butuh `sql/29_tambah_role_guest_readonly.sql` sudah dijalankan
dan Edge Function `admin-create-user` sudah di-deploy ulang (ALLOWED_ROLES kini
termasuk `guest`).

Sidebar bersifat role-aware, di-render oleh `renderSidebarNav()`. Warna brand pakai CSS
custom properties `--brand`, `--brand-deep`, `--brand-tint` di `css/style.css` — ganti di
satu tempat itu untuk reskin semua elemen (sidebar, tombol aktif, dsb).

## Catatan alur Pembayaran & Cicilan (`pembayaran_jamaah`)

- Status jamaah (`lunas`/`dp`/`pending`) dihitung dari `SUM(pembayaran_jamaah.jumlah)`
  dibanding `programs.harga_quint` — **hanya kolom `harga_quint`** yang dipakai
  sebagai acuan harga per jamaah, bukan `harga_quad`/`harga_triple`/`harga_double`
  (kolom-kolom itu murni informasi tampilan paket, tidak terhubung ke jamaah
  tertentu karena `kb_jamaah` tidak punya kolom tipe kamar). Kalau `harga_quint`
  kosong, status jamaah di program itu **tidak akan pernah otomatis jadi "Lunas"**
  walau sudah dibayar penuh — modal Kelola Cicilan sekarang menampilkan
  peringatan soal ini di ringkasan.
- Refund disimpan sebagai baris **negatif** di `pembayaran_jamaah` (bukan tabel
  terpisah), supaya `SUM()` otomatis mengurangi total dibayar.
- Kelebihan bayar (total dibayar > harga program) ditampilkan sebagai peringatan
  info di ringkasan modal Kelola Cicilan — sistem tidak memblokir pembayaran
  melebihi sisa tagihan (fleksibel untuk kasus DP awal besar/pelunasan lebih).
- `saveCicilan()` punya guard `cicilanSaving` untuk cegah insert dobel kalau
  tombol submit di-double click/tap saat koneksi lambat.
- Hapus jamaah (`kb_jamaah`) akan **cascade delete** semua riwayat pembayarannya
  (FK `on delete cascade`) — modal konfirmasi hapus sekarang menampilkan
  peringatan total nilai pembayaran yang akan ikut hilang kalau jamaah itu
  punya riwayat bayar, tapi tetap tidak memblokir (beda dari hapus program yang
  diblokir total kalau masih ada jamaah).
- `nota_audit_log` bersifat append-only (trigger DB memblokir UPDATE/DELETE).
  Untuk log jenis "hapus pembayaran", data baris HARUS diambil dari DB
  **sebelum** perintah delete dijalankan (lihat `confirmDeleteAction()`) —
  kalau diambil sesudahnya baris itu sudah tidak ada lagi dan audit gagal
  tercatat tanpa pesan error (bug lama yang sudah diperbaiki, jangan diulang
  kalau refactor bagian ini).
- "Arsipkan Semua Jamaah" (tombol di tab Keberangkatan) diblokir kalau ada
  jamaah yang: (1) belum berstatus `lunas`/`batal` di pembayaran, ATAU
  (2) `status_kepulangan` belum `sudah_pulang`/`batal` (lihat tab "Status
  Kepulangan", kolom `kb_jamaah.status_kepulangan` — sql/13_tambah_status_kepulangan_kb_jamaah.sql).
  Kedua pengecekan ini sengaja hard block (bukan cuma warning) karena Arsip
  bersifat irreversible dan setelah diarsipkan jamaah hilang dari tab Status
  Kepulangan (tapi tetap terlihat read-only di tab Arsip Jamaah).
- Label menu "Keberangkatan" & "Dokumen" di UI diganti jadi "Data Jamaah" &
  "Kelengkapan Dokumen" (lebih deskriptif) — tab id di kode (`keberangkatan`,
  `dokumen`) TIDAK diubah supaya tidak perlu migrasi `role_menu_access` lama.
  Sidebar dikelompokkan visual pakai label baru "Siklus Jamaah" (class CSS
  `nav-group-label`, ditangani terpisah di `renderSidebarNav()` dari
  `nav-admin-only` karena berlaku untuk semua role yang login, bukan cuma admin).
- Badge angka merah di menu "Kelengkapan Dokumen" & "Status Kepulangan"
  (elemen `.nav-badge`, id `badgeDokumen*`/`badgeKepulangan*` x3 tempat:
  sidebar desktop/mobile/tab-bar) dihitung dari `kbJamaahList` lewat
  `renderNavBadges()` — dipanggil ulang tiap `loadKbJamaah()`,
  `toggleDokumenJamaah()`, & `updateKepulanganField()` supaya selalu real-time
  tanpa query tambahan. Badge Kepulangan sengaja HANYA menghitung status
  `sudah_berangkat` (bukan `belum_berangkat`) karena itu yang paling butuh
  perhatian admin.
- `SIDEBAR_MENU_REGISTRY` (dipakai panel Pengaturan User > Akses Menu
  Sidebar) HARUS disinkronkan manual tiap kali menambah tab sidebar baru —
  lupa menambahkannya berarti role `user`/`guest` tidak akan pernah bisa
  diberi akses ke tab itu meski nav-item-nya sudah ada di index.html (bug ini
  sempat terjadi untuk `kepulangan`, sudah diperbaiki, jangan diulang kalau
  nambah tab lagi).

## Badge "Program Baru" di tabel Program Umroh (dashboard utama)

- Muncul otomatis di kolom Nama Program (sebelah badge Verified ✅) selama
  **3 hari** sejak `programs.created_at`, lalu hilang sendiri — dihitung
  ulang tiap render (`buildProgramRowHTML()`), BUKAN kolom/flag terpisah di
  DB, jadi tidak ada job/cron yang perlu jalan buat "membersihkan" badge-nya.
  Kalau mau ubah durasinya, cari angka `3 * 24 * 60 * 60 * 1000` di
  `buildProgramRowHTML()`.
- `buildProgramRowHTML()` dipakai bareng oleh tab "Program Umroh" DAN
  "Unggulan", jadi badge ini otomatis tampil di keduanya.
- Badge yang sama (logika & durasi identik, `renderAdminTable()`) juga
  tampil di panel **Manajemen > Edit Program**, tapi teksnya cuma **"Baru"**
  (bukan "Program Baru") — beda variabel (`newBadgeAdmin`/`isProgramBaruAdmin`)
  karena tabelnya beda fungsi render, tapi ambang waktu 3 hari HARUS
  disinkronkan manual kalau salah satu diubah.
- CSS: class `.new-badge` di `css/style.css`, palet orange muda
  (`background:#FFEDD5; color:#C2410C;`), pola sama dengan
  `.verified-badge`/`.nearest-badge` di atasnya.

## Catatan UI panel "Edit & Tambah Program" (Manajemen > Edit Program)

- Tombol **Export Data**, **Import Data**, **Hapus Semua Data** (khusus role
  `admin`) sengaja dipindah dari toolbar atas (sejajar tombol Caption Kosong/
  Caption Belum Lengkap) ke **footer di bawah tabel Daftar Program**, supaya
  aksi destruktif (terutama Hapus Semua) tidak nempel dekat tombol lain yang
  sering diklik dan lebih sulit ke-tap tidak sengaja. Markup-nya ada di
  `renderAdminPanel()`, blok `.admin-table-foot-actions` tepat setelah
  `</table>` dan sebelum `.admin-table-card` ditutup.
- Class CSS baru buat footer ini (di `css/style.css`, tepat setelah rule
  `.admin-table-card`): `.admin-table-foot-actions`, `.admin-table-foot-label`,
  `.admin-table-foot-btns`, `.btn-footer-action` (varian `.danger`). Beda dari
  `.btn-icon-ghost` (kotak 36×36 icon-only) yang masih dipakai di toolbar
  Assets/Perusahaan — `.btn-footer-action` punya lebar auto + label teks di
  sebelah ikon, karena berdiri sendiri di footer (bukan sebaris dengan tombol
  ikon lain).
- Kalau nanti mau tambah tombol lain yang sifatnya "kelola data" (bukan
  filter/search/tambah-baru biasa) di panel admin lain, pertimbangkan pola
  yang sama (taruh di footer tabel, bukan toolbar atas) demi konsistensi.
- `clearAllAdminData()` (tombol "Hapus Semua") sekarang **memblokir total**
  kalau masih ada program dengan jamaah aktif (`kb_jamaah.diarsipkan = false`)
  dan/atau pendaftaran yang belum `batal` — konsisten dengan pengecekan di
  `openDeleteModal()`/`confirmDeleteAction()` untuk hapus satu program.
  Sebelumnya fungsi ini loop `deleteProgramById()` langsung tanpa cek apa pun,
  jadi program aktif ikut cascade-delete (kb_jamaah & pembayaran_jamaah-nya)
  cuma bisa dipulihkan lewat snapshot — sekarang dicegah dari awal. Program
  yang jamaahnya SUDAH diarsip (`diarsipkan = true`, lewat "Arsipkan Semua")
  tidak dihitung, jadi tetap boleh ikut kehapus.

## Kalau menambah/mengubah fitur

- Edit langsung di `js/app.js`, ikuti pola section comment yang sudah ada
- Pakai `showToast(msg, type)` untuk feedback ke user, bukan `alert()`
- Operasi baca (SELECT) yang rawan gagal jaringan → bungkus dengan `withRetry()`
- Operasi tulis (insert/update/upsert) JANGAN dibungkus `withRetry()` — risiko data dobel
- Kalau menambah file baru yang perlu di-load browser, jangan lupa update
  `service-worker.js` (`APP_SHELL` array) supaya PWA cache-nya ikut sinkron, dan naikkan
  `CACHE_NAME` versinya
- Akurasi data finansial adalah prioritas karena datanya dipakai untuk laporan resmi

## Aturan Edge Function (supabase/functions/*)

- Edge function **WAJIB berdiri sendiri dalam satu file `index.ts`**. JANGAN `import` dari
  `../_shared/...` atau file lokal lain (mis. `./postprocess.ts`): deploy dilakukan lewat
  **Supabase Dashboard** (paste satu file), dan Dashboard hanya membundel file fungsi itu
  sendiri, jadi impor lokal gagal dengan "Module not found ... _shared/gemini.ts".
- Kalau butuh helper bersama (mis. fallback Gemini multi-key), **salin helper-nya inline** ke
  tiap `index.ts` yang memakainya (contoh: `generate-ig-content-plan`, `generate-ig-caption`).
  Konsekuensinya: kalau helper diperbaiki, salinan di tiap fungsi perlu diperbarui manual.
- Impor dari URL/paket luar (mis. `npm:`/`jsr:`) tetap boleh. Yang dilarang hanya impor file lokal.
- Saat mengirim hasil kerja, sebut fungsi mana yang perlu di-deploy ulang. Untuk fungsi yang
  diubah, kirim `index.ts`-nya utuh supaya bisa langsung di-paste ke Dashboard.

## Cara kirim hasil kerja (deploy ke GitHub)

Kalau perubahan cuma menyentuh sebagian kecil file (bukan restrukturisasi besar),
**kirim file yang berubah saja satu-satu**, JANGAN re-zip seluruh folder proyek.
User tinggal replace file itu langsung di repo lalu push — re-zip seluruh proyek
cuma buang-buang waktu/token dan bikin user harus extract & diff manual buat
cari apa yang sebenarnya berubah.

## About Planner (konsep perencanaan konten, IG Scheduler)

Tombol **About Planner** di sebelah "Perencanaan Konten" (halaman IG Scheduler) membuka modal `#igAboutPlannerModal`
berisi konsep perencanaan konten Amiru yang bisa dibaca, disalin ("Salin untuk Claude"), dan diunduh (.md).

- **Sumber tunggal teks:** konstanta `ABOUT_PLANNER_MD` di `js/app.js` (section 24e). Header modal (Versi, Diperbarui)
  dibaca otomatis dari dua baris `Versi:` dan `Diperbarui:` di awal dokumen, jadi format dua baris itu jangan diubah.
  Teksnya template literal: jangan pakai karakter backtick atau urutan dollar-kurung-kurawal di dalamnya.
- `ABOUT_PLANNER_PETUNJUK` ikut tersalin di depan dokumen, menyuruh Claude mengembalikan dokumen UTUH, menaikkan Versi,
  dan menambah baris di "Riwayat Revisi".
- **Alur revisi:** salin/unduh > ubah di Claude > unggah hasilnya ke sesi pengembangan. Saat menerima dokumen revisi:
  1. Ganti isi `ABOUT_PLANNER_MD` dengan dokumen revisi (buang bagian petunjuk dan "Dampak ke sistem" kalau ikut terbawa).
  2. Pastikan Versi naik dan Riwayat Revisi bertambah.
  3. Sinkronkan aturan yang berubah ke logika yang benar-benar berjalan, sesuai bagian "Dampak ke sistem":
     `IG_PLAN_PROMPT_SISTEM`, `IG_POLA_AMIRU`, `IG_TEMA_ALUR`/`IG_TEMA_MUSIM`, `IG_JEDA_TOPIK_BULAN`, edge function
     `generate-ig-content-plan` dan `generate-ig-caption` (deploy ulang kalau berubah), serta `pola-konten.md`.
  4. Naikkan `CACHE_NAME` di `service-worker.js`.
  Mengubah teks About Planner saja TIDAK mengubah perilaku generator; generator hanya berubah lewat langkah 3.

