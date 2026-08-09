-- ============================================================
-- TAMBAH: Kelola User (buat akun baru per-orang sebagai admin/user)
-- Jalankan di SQL Editor Supabase SETELAH sql/migrate_supabase_auth.sql.
--
-- Sebelumnya hanya ada 3 akun tetap (admin/user/guest) yang passwordnya
-- diganti lewat Edge Function admin-change-password. Migrasi ini menambah
-- kemampuan admin untuk membuat akun BARU per-orang (email+password sendiri,
-- role admin atau user) lewat Edge Function admin-create-user, dan melihat
-- daftar user yang sudah terdaftar.
-- ============================================================

-- 1. Simpan email di dashboard_profiles supaya admin bisa melihat daftar user
--    tanpa perlu Edge Function tambahan (email asli hanya ada di auth.users,
--    yang tidak bisa diakses langsung dari client).
alter table dashboard_profiles add column if not exists email text;

-- 2. Admin boleh membaca SEMUA baris profil (bukan cuma profil sendiri) supaya
--    daftar user bisa ditampilkan di Pengaturan User. Kebijakan ini ditambahkan,
--    bukan menggantikan "Read own profile" yang sudah ada (multiple permissive
--    policies pada SELECT akan digabung dengan OR).
drop policy if exists "Admin read all profiles" on dashboard_profiles;
create policy "Admin read all profiles" on dashboard_profiles
  for select using (current_dashboard_role() = 'admin');

-- Catatan: insert/update/delete pada dashboard_profiles TETAP hanya lewat
-- service role (scripts/setup-auth-accounts.mjs atau Edge Function
-- admin-create-user) -- policy "No client write profile" yang sudah ada
-- tidak diubah.
