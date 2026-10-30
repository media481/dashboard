# SQL: skema dan migrasi Supabase

Folder ini berisi skema database Dashboard Amiru. Ada dua jalur, pilih salah satu sesuai kondisi project.

## Mana yang harus dijalankan

| Kondisi | Yang dijalankan |
|---|---|
| **Project baru / kosong** | Hanya `00_SETUP_LENGKAP_SATU_FILE.sql`. Isinya kondisi akhir migrasi 01 s.d. 61, jadi tidak ada file bernomor lain yang wajib. |
| **Project berjalan** (sudah pernah menjalankan sebagian migrasi) | Jalankan hanya migrasi yang nomornya **lebih besar** dari yang terakhir Anda jalankan, berurutan naik. Setiap file idempoten. |
| **Project berjalan, nomor terakhir tidak diketahui** | Jalankan `00` lagi. Aman diulang. Hati-hati: `00` menghapus SEMUA policy lama di tabel yang dikelolanya (termasuk policy buatan manual di Dashboard) lalu membuatnya ulang sesuai kebijakan final. |
| **Mengisi data hotel Arab Saudi** (opsional) | `40_update_hotel_saudi_arabia_2026_10.sql` setelah `00`. `39` sudah digantikan `40`. |

`00` tidak butuh urutan khusus dengan file lain dan tidak butuh akun Supabase Auth lebih dulu. Setelah `00`, buat akun login lewat
`scripts/setup-auth-accounts.mjs` (lihat `CHECKLIST_DEPLOY.md` bagian 2).

Yang **tidak** bisa dilakukan SQL dan harus manual: bucket Storage `ig-media` (public) dibuat di Dashboard > Storage. Policy hapus file-nya
sudah ada di `00` (bagian 18i) dan `50`.

## Daftar migrasi

Kolom **Di 00** = apakah kondisi akhirnya sudah tertanam di `00`.

| No | Isi | Di 00 | Catatan / prasyarat |
|---|---|---|---|
| 01 | Setup awal semua tabel inti (programs, jadwal_tamu, kb_jamaah, pendaftaran, featured_programs, app_config, tg_config, kwt_kuitansi, pembayaran_jamaah) | Ya | Snapshot kondisi awal. Sudah memuat isi 02, 03, 04 |
| 02-04 | `kwt_kuitansi`, `pembayaran_jamaah`, `pendaftaran` | Ya | Hanya untuk project lama yang dibuat sebelum 01 memuatnya. Di project baru tidak perlu |
| 05 | `snapshot_backup` | Ya | |
| 06-17 | Kolom tambahan: dokumen jamaah, field formulir F4, tipe & nomor kamar, paspor/visa, status & tanggal kepulangan, kuota pax, arsip jamaah | Ya | Berurutan: 13 lalu 14 lalu 15 (kepulangan dipindah dari per jamaah ke per program) |
| 18 | Konversi DATA pendaftaran lama (status `baru`/`dihubungi` menjadi `deal`) | **Tidak** | Hanya perlu di database lama yang punya baris status lama. Bukan skema |
| 19-23 | Nomor nota resmi, `nota_audit_log` (append-only), jenis kuitansi, nomor kuitansi otomatis (sequence + RPC `next_kuitansi_nomor`) | Ya | 20 butuh 19; 23 butuh 22 |
| 24 | `jamaah_audit_log` | Ya | |
| 25-27 | RPC login lama, rate-limit login, hardening RLS | Ya | 25 sebelum 26 dan 28 (26 dan 28 memakai fungsi buatan 25) |
| 28 | Migrasi ke Supabase Auth: `dashboard_profiles`, `current_dashboard_role()` | Ya | Butuh akun Auth dari `scripts/setup-auth-accounts.mjs` untuk mengisi profil. 28 harus sebelum 29 dan seterusnya |
| 29 | Role `guest` read-only di RLS | Ya | Butuh 28 |
| 30-32 | Kelola user (kolom email), `last_login` + RPC `update_last_login`, proteksi admin terakhir | Ya | Berurutan |
| 33-34 | Akses menu sidebar per role (`role_menu_access`) dan per user (`user_menu_access`) | Ya | 34 butuh 33 secara konsep |
| 35-36 | Menu Assets, lalu dikunci tulis admin saja | Ya | 36 sesudah 35 |
| 37-38 | `hotel_saudi_arabia` dan RPC `replace_hotel_saudi_arabia` (import CSV) | Ya | |
| 39-40 | ISI data hotel Arab Saudi | **Tidak** | Data, bukan skema. Pakai 40 (terbaru); 39 versi lama |
| 41-43 | IG Scheduler: `ig_accounts`/`ig_posts`/`ig_publish_logs`, carousel `ig_post_media`, `ig_comments` | Ya | Berurutan |
| 44-47 | `ig_content_plan` dan kolom planner (pilar/tahap, teks_gambar, tema_minggu) | Ya | 44 dulu |
| 48-49 | `ig_rencana_tahunan`, `ig_tasklist` | Ya | |
| 50 | Policy hapus file di bucket Storage `ig-media` | Ya | Butuh skema `storage` (ada di Supabase) |
| 51 | Hardening RLS tabel IG (guest tidak boleh baca token) | Ya | Sesudah 28 (memakai `current_dashboard_role()`) dan 41, 42 (mengubah policy `ig_accounts`, `ig_posts`, `ig_post_media`, `ig_publish_logs`) |
| 52-53 | `rekap_program_items` dan baca publik | Ya | 53 butuh 52 |
| 54 | `hotel_detail` | Ya | |
| 55 | Baca publik `infografis_items` | Ya | Sejak revisi ini 55 membuat tabelnya sendiri bila belum ada |
| 56 | `ig_content_plan.canva_url` | Ya | Butuh 44 |
| 57 | `programs.poster_version` (tombol Refresh Poster) | Ya | |
| 58 | View `microblog_publik` (Microblog tanpa login) | Ya | Butuh 44. Menambah sendiri kolom dari 45-47 bila belum ada |
| 59 | View `v_total_bayar` (total dibayar per jamaah) | Ya | Butuh `pembayaran_jamaah`, `kb_jamaah`. **Wajib ada sebelum frontend dipakai** (`fetchTotalBayar()`); juga dipakai Edge Function `radar-risiko-jamaah` |
| 60 | `dokumentasi_kegiatan` (Social Media > Dokumentasi) | Ya | Butuh `programs` dan `ig_content_plan` (44) |
| 61 | Hardening: cabut EXECUTE RPC password lama dari `PUBLIC`, aktifkan RLS `login_rate_limit` | Ya | Untuk project yang dibangun lewat migrasi bernomor (lihat catatan di bawah) |

### Catatan penting 61

Migrasi 28 mencabut `verify_dashboard_password()` dan `set_admin_password()` hanya dari `anon, authenticated`. Fungsi di Postgres otomatis
punya EXECUTE untuk `PUBLIC`, jadi hak itu masih tersisa lewat pewarisan di database yang dibangun lewat migrasi bernomor. `set_admin_password()`
tidak punya auth guard. `00` sudah mencabut dari `PUBLIC` juga. Kalau project Anda berjalan dari migrasi bernomor dan belum pernah menjalankan
`00` versi ini, jalankan `61`.

## Objek utama di database

- **Tabel inti:** `programs`, `jadwal_tamu`, `kb_jamaah`, `pendaftaran`, `featured_programs`, `pembayaran_jamaah`, `kwt_kuitansi`.
- **Audit:** `nota_audit_log`, `jamaah_audit_log` (append-only lewat trigger).
- **Akun dan akses:** `dashboard_profiles`, `role_menu_access`, `user_menu_access`, `app_config` + `login_rate_limit` (jalur login lama).
- **Operasional lain:** `tg_config`, `snapshot_backup`, `assets`, `hotel_saudi_arabia`, `hotel_detail`, `rekap_program_items`, `infografis_items`,
  `dokumentasi_kegiatan`.
- **IG Scheduler:** `ig_accounts`, `ig_posts`, `ig_post_media`, `ig_publish_logs`, `ig_comments`, `ig_content_plan`, `ig_rencana_tahunan`, `ig_tasklist`.
- **View:** `v_total_bayar` (`security_invoker`, hanya `authenticated`), `microblog_publik` (hak pemilik, boleh dibaca anon).
- **RPC yang dipanggil client:** `update_last_login`, `next_kuitansi_nomor`, `replace_hotel_saudi_arabia` (admin). `current_dashboard_role()` dipakai RLS.
  `verify_dashboard_password` dan `set_admin_password` adalah jalur lama, hanya untuk `service_role`.

Pemetaan Edge Function ke tabel/view yang dibacanya ada di `supabase/functions/README.md` (bagian "Ketergantungan database").

## Aturan menambah migrasi baru

1. Nomor berikutnya: **62**. Nama `NN_kata_kerja_objek.sql`, tulis komentar header (tujuan, prasyarat, siapa yang boleh akses).
2. **Idempoten:** `create ... if not exists`, `add column if not exists`, dan `drop policy if exists ...` sebelum tiap `create policy`.
   Jangan `create policy` tanpa drop (itu yang membuat 02, 03, 04, 25 gagal saat dijalankan berurutan).
3. Pakai `current_dashboard_role()` untuk policy (bukan `auth.role() = 'authenticated'` yang meloloskan `guest`). Fungsi RPC baru:
   `revoke all ... from public, anon, authenticated` lalu `grant` hanya ke role yang perlu (mencabut dari `anon, authenticated` saja tidak cukup).
4. **Tanamkan kondisi akhirnya ke `00`:** tabel baru di `CREATE TABLE`, kolom baru di `CREATE TABLE` DAN `alter table ... add column if not exists`,
   policy lewat `select _setup_drop_policies('<tabel>')`. Perbarui header `00` (rentang nomor dan daftar).
5. Perbarui daftar di `sql/README.md` (file ini), `CLAUDE.md` (bagian `sql/` dan tabel Supabase), `README.md`, dan `CHECKLIST_DEPLOY.md`.
6. Kalau fungsi Edge baru memakai tabel itu, tambahkan ke tabel "Ketergantungan database" di `supabase/functions/README.md`.

## Cara skema ini diverifikasi

Revisi terakhir diuji di PostgreSQL 16 dengan stub skema `auth`/`storage` dan role `anon`/`authenticated`/`service_role`:

- `00` dijalankan dua kali berturut-turut pada database kosong: tanpa error (idempoten).
- Rantai `01` s.d. `61` (tanpa 39, yang hanya data) dijalankan berurutan pada database kosong: tanpa error.
- Kedua hasil dibandingkan secara semantik (kolom dan tipe, policy, constraint, index, trigger, view, hak akses, isi fungsi): identik. Yang berbeda
  hanya nama beberapa policy lama ("Pub read X" di `00` vs "Allow read X" di rantai) dan urutan kolom, tanpa efek fungsional.
- Jalur upgrade `00` versi lama (v3) lalu `00` versi ini: tanpa error, hasil identik dengan instalasi baru.
- `40` dijalankan di atas `00` (281 baris hotel), dua kali: idempoten.

Ini bukan pengganti uji di project Supabase Anda sendiri: stub tidak meniru default privilege, Realtime, atau ekstensi Supabase.
