# Catatan Progres: Akses Menu Sidebar per User (Pengecualian)

Status per sesi ini: **SELESAI secara kode, BELUM diverifikasi jalan di Supabase asli**
(karena migrasi SQL-nya belum pernah dijalankan admin).

## Yang sudah selesai

- **Tahap 1 — Database**: `sql/tambah_akses_menu_user.sql` — tabel
  `user_menu_access(user_id, menu_key, allowed)`. File ini sempat "hilang" dari
  paket sebelumnya (kode di `js/app.js` sudah mereferensikannya di banyak
  tempat, tapi file SQL-nya sendiri belum ada di folder `sql/`) — sudah dibuat
  ulang di sesi ini mengikuti pola persis `sql/tambah_akses_menu_role.sql`
  (RLS read/insert/update/delete untuk `auth.role() = 'authenticated'`, tanpa
  seed data karena isinya murni pengecualian manual per akun).
- **Tahap 2 — Logika `renderSidebarNav()`**: sudah ada & lengkap di
  `js/app.js` (fungsi `loadUserMenuAccess()` + prioritas override akun >
  fallback role > fallback lama kalau migrasi belum jalan). Tidak disentuh
  lagi di sesi ini, cuma diverifikasi sudah benar.
- **Tahap 3 — UI Admin**: sudah ada & lengkap, semuanya inline di
  `js/app.js` (blok HTML "Akses Menu per User (Pengecualian)" digenerate
  lewat template string di sekitar fungsi `renderRoleMenuAccessMatrix()` /
  tab `usPanel-access`, bukan di `index.html` — proyek ini sudah dipecah jadi
  index.html + js/app.js + style.css, lihat `CATATAN_PEMBERSIHAN.md` Ronde 3).
  Fungsi terkait: `populateUmaUserSelect()`, `renderUserMenuAccessMatrix()`,
  `saveUserMenuAccessMatrix()`, `resetUserMenuAccessMatrix()` — semua sudah
  di-`window.`-expose dan dipanggil dari tab Userman > Akses Menu.

## Yang BELUM dilakukan / perlu dicek di sesi berikutnya

1. **Migrasi belum pernah dijalankan** di Supabase project yang sebenarnya.
   Kalau sesi berikutnya lanjut fitur ini, tanyakan dulu ke user apakah
   `sql/tambah_akses_menu_user.sql` sudah dijalankan — kalau belum, tab
   "Akses Menu per User" di Userman akan tetap menampilkan pesan
   "Setup belum lengkap: jalankan sql/tambah_akses_menu_user.sql...".
2. **Belum ada testing end-to-end** (belum ada laporan dari user bahwa
   dropdown pilih akun → set Izinkan/Larang/Ikuti Role → Simpan → sidebar
   akun lain berubah sesuai, benar-benar berhasil dicoba).
3. `service-worker.js` **tidak perlu** diubah untuk perubahan ini — file SQL
   tidak di-load browser, dan `js/app.js` bukan file baru (sudah ada di
   `APP_SHELL` sebelumnya).
4. Kalau nanti menambah tab sidebar baru, ingat catatan di `CLAUDE.md`:
   `SIDEBAR_MENU_REGISTRY` harus disinkronkan manual, kalau tidak menu baru
   itu tidak akan pernah bisa diberi akses (baik lewat role_menu_access
   maupun user_menu_access) meski nav-item-nya sudah tampil di sidebar.

## Cara lanjut / pasang (ringkas)

1. Jalankan `sql/tambah_akses_menu_role.sql` dulu kalau belum pernah (Tahap
   akses per role, prasyarat).
2. Jalankan `sql/tambah_akses_menu_user.sql` (baru dibuat sesi ini).
3. Buka Userman → Akses Menu → scroll ke blok "Akses Menu per User
   (Pengecualian)" → pilih akun → atur → Simpan.
4. Kalau ada bug/perilaku aneh, cek dulu `js/app.js` sekitar baris 2110-2270
   (fungsi Tahap 3) dan baris 3757-3850 (fungsi Tahap 2 / `renderSidebarNav`).
