# Catatan: Akses Menu Sidebar per User (Pengecualian)

Ditulis ulang 2026-10-23 dari kondisi kode saat ini (versi lama berstatus "selesai secara kode, belum diverifikasi" dan merujuk ke baris
`js/app.js` yang sudah bergeser). Catatan ini hanya menjelaskan **apa yang ada** dan **apa yang belum bisa dipastikan dari repo**.

## Cara kerja

Visibilitas menu sidebar ditentukan berlapis, dari yang paling kuat:

1. **Pengecualian per akun** di tabel `user_menu_access(user_id, menu_key, allowed)` (`sql/34_tambah_akses_menu_user.sql`).
2. **Aturan per role** di `role_menu_access` (`sql/33_tambah_akses_menu_role.sql`).
3. **Bawaan** dari `NAV_MENU` (`js/app.js`): menu tanpa baris di kedua tabel mengikuti gate-nya (admin saja / login / selalu).
   Menu yang belum punya baris di `role_menu_access` (Reminder, Status Kepulangan, IG Scheduler, Infografis) default-nya tersembunyi untuk
   `user`/`guest` sampai admin mengaturnya.

Kedua tabel sudah termasuk di `sql/00_SETUP_LENGKAP_SATU_FILE.sql`; `sql/33` dan `sql/34` hanya perlu dijalankan terpisah di project lama.
Kalau `sql/34` belum dijalankan, blok "Akses Menu per User" menampilkan pesan "Setup belum lengkap" dan sidebar memakai fallback role.

## Letak kode

- `js/app.js`: `loadUserMenuAccess()` dan `renderSidebarNav()` (di sekitar section 12c), `NAV_MENU` dan `SIDEBAR_MENU_REGISTRY`
  (section 5b), serta kerangka HTML panel `usPanel-access`.
- `js/modules/pengaturan-user.js` (modul lazy `pengaturan-user`, dibuka lewat Admin > Pengaturan User): `renderRoleMenuAccessMatrix()`,
  `populateUmaUserSelect()`, `renderUserMenuAccessMatrix()`, `saveUserMenuAccessMatrix()`, `resetUserMenuAccessMatrix()`.
- Pilihan per akun: **Izinkan / Larang / Ikuti Role**.

## Menambah menu baru

Tambahkan satu baris di `NAV_MENU` (`js/app.js`). Isi `reg: { group: '...' }` agar menu itu muncul di matriks Akses Menu;
`SIDEBAR_MENU_REGISTRY` diturunkan otomatis dari `NAV_MENU`, tidak perlu disinkronkan manual lagi (catatan lama yang menyuruh itu sudah usang).
Tab dengan id `keberangkatan` dan `dokumen` sengaja tidak diganti namanya (label UI: "Data Jamaah" dan "Dokumen") supaya data `role_menu_access` lama tetap cocok.

## Yang belum bisa dipastikan dari repo

- Apakah `sql/34` sudah dijalankan di Supabase yang sebenarnya, dan apakah alur pilih akun > Izinkan/Larang/Ikuti Role > Simpan > sidebar berubah
  sudah diuji end-to-end oleh admin. Tidak ada tes otomatis untuk bagian ini (`tests/` tidak menyentuh matriks akses). Tanyakan ke admin sebelum menganggapnya terverifikasi.

## Catatan keamanan

RLS `role_menu_access` dan `user_menu_access` mengizinkan insert/update/delete untuk semua `authenticated` (termasuk `guest`) menurut `sql/00`.
Pembatasan ke admin hanya ada di UI. Perketat policy ke `current_dashboard_role() = 'admin'` bila perlu.
