-- ============================================================
-- TAMBAH: Catat "Terakhir Login" (kapan user terakhir buka app)
-- Jalankan di SQL Editor Supabase SETELAH sql/tambah_kelola_user.sql.
--
-- Kolom last_login diisi lewat RPC update_last_login() (SECURITY DEFINER)
-- yang dipanggil dari client setiap kali: (a) berhasil login, dan
-- (b) sesi lama dipulihkan otomatis saat app dibuka lagi (checkSession()).
-- Dibuat sebagai RPC -- bukan lewat UPDATE langsung dari client -- supaya
-- user hanya bisa meng-update baris miliknya sendiri (auth.uid()), tidak
-- bisa mengubah last_login user lain, tanpa perlu membuka policy UPDATE
-- yang lebih longgar di tabel dashboard_profiles.
-- ============================================================

alter table dashboard_profiles add column if not exists last_login timestamptz;

create or replace function update_last_login()
returns void
language sql
security definer
set search_path = public
as $$
  update dashboard_profiles set last_login = now() where id = auth.uid();
$$;

grant execute on function update_last_login() to authenticated;
