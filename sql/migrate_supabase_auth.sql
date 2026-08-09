-- ============================================================
-- MIGRASI: dari JWT custom (DASHBOARD_JWT_SECRET + kid) -> Supabase Auth asli
-- Jalankan di SQL Editor Supabase SETELAH akun auth dibuat lewat
-- scripts/setup-auth-accounts.mjs (lihat file itu untuk urutan langkahnya).
--
-- KENAPA INI MENYELESAIKAN PGRST301 SECARA PERMANEN:
-- Sebelumnya kita menandatangani JWT sendiri dan menaruh header `kid` yang harus
-- cocok dengan JWT Signing Key yang di-import manual di Dashboard -> rapuh,
-- dan bisa rusak lagi kapan pun Supabase mengubah aturan validasi JWT.
-- Dengan alur ini, JWT dibuat & ditandatangani oleh Supabase Auth sendiri lewat
-- signInWithPassword() -> otomatis selalu cocok dengan Signing Key yang aktif,
-- karena itu memang key resmi Supabase, bukan yang kita import manual.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabel profil dashboard: memetakan auth.uid() -> role tampilan
-- ------------------------------------------------------------
create table if not exists dashboard_profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  dashboard_role text not null check (dashboard_role in ('admin','user','guest')),
  label          text not null,
  created_at     timestamptz not null default now()
);

alter table dashboard_profiles enable row level security;

-- Setiap user yang sudah login boleh baca profilnya sendiri (untuk tahu role-nya di UI).
drop policy if exists "Read own profile" on dashboard_profiles;
create policy "Read own profile" on dashboard_profiles
  for select using (auth.uid() = id);

-- Tidak ada yang boleh insert/update/delete langsung dari client;
-- profil hanya diisi lewat scripts/setup-auth-accounts.mjs (service role) atau
-- Edge Function admin-change-password.
drop policy if exists "No client write profile" on dashboard_profiles;
create policy "No client write profile" on dashboard_profiles
  for all using (false) with check (false);

-- ------------------------------------------------------------
-- 2. Helper: role dashboard user yang sedang login (dipakai di RLS/RPC)
-- ------------------------------------------------------------
create or replace function current_dashboard_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select dashboard_role from dashboard_profiles where id = auth.uid();
$$;

grant execute on function current_dashboard_role() to authenticated;

-- ------------------------------------------------------------
-- 3. RLS write policies TIDAK PERLU diubah — auth.role() = 'authenticated'
--    di hardening_rls_keamanan.sql sudah benar & akan langsung berfungsi begitu
--    client memakai JWT asli dari Supabase Auth (bukan JWT custom).
--
--    Opsional tapi direkomendasikan: kunci operasi paling sensitif (hapus program,
--    hapus pembayaran, kelola user) supaya hanya role 'admin' yang bisa, bukan
--    sekadar "authenticated" (guest/user via login juga authenticated). Contoh:
-- ------------------------------------------------------------
drop policy if exists "Auth delete programs" on programs;
create policy "Admin delete programs" on programs
  for delete using (current_dashboard_role() = 'admin');

drop policy if exists "Auth delete pembayaran_jamaah" on pembayaran_jamaah;
create policy "Admin delete pembayaran_jamaah" on pembayaran_jamaah
  for delete using (current_dashboard_role() = 'admin');

-- Tambahkan pola yang sama untuk tabel sensitif lain (kwt_kuitansi delete,
-- snapshot_backup delete, dll) sesuai kebutuhan — tidak wajib untuk migrasi awal.

-- ------------------------------------------------------------
-- 4. Nonaktifkan jalur lama (password di app_config, RPC login lama).
--    Jangan DROP dulu — biarkan nonaktif selama masa transisi supaya mudah rollback.
-- ------------------------------------------------------------
revoke execute on function verify_dashboard_password(text) from anon, authenticated;
revoke execute on function set_admin_password(text, text)  from anon, authenticated;

-- Setelah yakin migrasi berjalan lancar di production (mis. 1-2 minggu), boleh:
--   drop function if exists verify_dashboard_password(text);
--   drop function if exists set_admin_password(text, text);
--   delete from app_config where key like 'pass_%';
