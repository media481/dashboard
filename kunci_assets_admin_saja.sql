-- ============================================================
-- KUNCI ASSETS: HANYA ADMIN YANG BOLEH TAMBAH/EDIT/HAPUS
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- (aman dijalankan berkali-kali, pakai DROP POLICY IF EXISTS)
--
-- LATAR BELAKANG:
--   Tabel `assets` (menu "Assets" di Admin Panel) sejak dibuat di
--   sql/tambah_menu_assets.sql cuma dikunci `auth.role() = 'authenticated'`
--   untuk insert/update/delete -- artinya SEMUA akun yang login (baik role
--   'admin' MAUPUN 'user'/editor, bahkan 'guest') sebenarnya tetap bisa
--   insert/update/delete langsung lewat REST API Supabase (mis. Postman/
--   curl pakai JWT-nya), walau tombol Edit/Hapus/Tambah Link sudah
--   disembunyikan di UI untuk role selain admin (lihat canManageAssets()
--   di js/app.js). Beda dari tabel lain (programs, kb_jamaah, dst) yang
--   sudah dikunci per-role lewat current_dashboard_role() di
--   sql/tambah_role_guest_readonly.sql.
--
-- PERMINTAAN:
--   Assets khusus dibuat LEBIH KETAT dari pola tabel lain -- kalau tabel
--   lain izinkan 'admin' & 'user' sama-sama boleh tulis, di Assets HANYA
--   'admin' yang boleh tambah/edit/hapus. Role 'user' (editor) & 'guest'
--   cuma boleh READ (lihat & buka link), walau menu "Assets"-nya sendiri
--   boleh diaktifkan untuk role 'user' lewat Akses Menu per Role.
--
-- CATATAN: perlu current_dashboard_role() sudah ada (dibuat di
-- sql/migrate_supabase_auth.sql). Kalau belum, jalankan itu dulu.
-- ============================================================

drop policy if exists "Auth insert assets" on assets;
drop policy if exists "Auth update assets" on assets;
drop policy if exists "Auth delete assets" on assets;

create policy "Admin only insert assets" on assets
  for insert with check (current_dashboard_role() = 'admin');

create policy "Admin only update assets" on assets
  for update using (current_dashboard_role() = 'admin');

create policy "Admin only delete assets" on assets
  for delete using (current_dashboard_role() = 'admin');

-- Read TIDAK diubah (tetap "Auth read assets": semua akun yang login,
-- termasuk 'user' & 'guest', tetap boleh lihat daftar Assets).

-- ============================================================
-- SELESAI. Setelah ini:
--   - Role 'admin' tetap bisa tambah/edit/hapus Assets seperti biasa.
--   - Role 'user' (editor) & 'guest' bisa LIHAT & buka link Assets, tapi
--     setiap percobaan insert/update/delete DITOLAK oleh database --
--     bukan cuma disembunyikan tombolnya di UI (yang sudah dikerjakan
--     terpisah lewat canManageAssets() di js/app.js).
-- ============================================================
