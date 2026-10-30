-- ============================================================
-- HARDENING: cabut akses RPC login lama + RLS login_rate_limit
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- (idempoten, aman dijalankan berkali-kali; tidak mengubah data)
--
-- MASALAH:
--   sql/28 mencabut EXECUTE verify_dashboard_password() dan set_admin_password()
--   hanya dari `anon, authenticated`. Padahal fungsi baru di Postgres otomatis
--   mendapat EXECUTE untuk PUBLIC, dan anon/authenticated mewarisinya. Akibatnya
--   di database yang dibangun lewat migrasi bernomor (bukan sql/00), kedua fungsi
--   itu MASIH bisa dipanggil lewat anon key (yang publik di js/app.js).
--   set_admin_password() tidak punya auth guard, jadi siapa pun bisa menimpa
--   password lama di app_config (jalur Edge Function login-dashboard yang sudah
--   legacy). Selain itu tabel login_rate_limit (dibuat sql/26) tidak mengaktifkan RLS.
--
-- PERBAIKAN:
--   1. Cabut EXECUTE kedua RPC dari PUBLIC, anon, authenticated. Hanya service_role
--      (Edge Function login-dashboard) yang masih bisa memanggilnya.
--   2. Aktifkan RLS di login_rate_limit tanpa policy = tertutup untuk client.
--      check_login_rate_limit() / bump_login_failure() berjalan SECURITY DEFINER,
--      jadi tidak terpengaruh.
--
-- Aplikasi memakai Supabase Auth, bukan RPC ini, jadi tidak ada fitur yang berubah.
-- Kondisi akhirnya sudah tertanam di sql/00_SETUP_LENGKAP_SATU_FILE.sql (bagian 14);
-- file ini hanya untuk project yang dibangun lewat migrasi bernomor.
-- ============================================================

do $$
begin
  if to_regprocedure('public.verify_dashboard_password(text)') is not null then
    revoke all on function public.verify_dashboard_password(text) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.set_admin_password(text, text)') is not null then
    revoke all on function public.set_admin_password(text, text) from public, anon, authenticated;
  end if;
end $$;

alter table if exists public.login_rate_limit enable row level security;
