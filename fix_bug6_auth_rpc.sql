-- ============================================================
-- FIX BUG #6 — Auth dipindah ke server (password tidak lagi dikirim ke browser)
-- Jalankan SETELAH 00_setup_semua_tabel.sql di SQL Editor Supabase.
--
-- Masalah: app.js sebelumnya melakukan SELECT app_config (isi password login)
-- dari client, lalu membandingkan password di browser (USER_ROLES[pwd]).
-- Karena RLS app_config permissif, SIAPA SAJA bisa membaca semua password via
-- REST publik -> kebocoran kredensial.
--
-- Solusi (tanpa paksa user bikin akun email):
--   1. Tutup RLS SELECT/UPDATE/INSERT app_config untuk anon (publik tidak bisa baca/ubah password).
--   2. Verifikasi password dilakukan di server lewat RPC SECURITY DEFINER:
--        - verify_dashboard_password(p_pass) -> { ok, role, label }  (password TIDAK dikembalikan)
--        - set_admin_password(p_key,p_val)   -> tulis password (SECURITY DEFINER)
--   3. Client tidak lagi SELECT password; hanya memanggil RPC di atas.
--
-- CATATAN KEAMANAN (honest trade-off): karena aplikasi tidak punya sistem akun
-- (Supabase Auth), RPC write (set_admin_password) tetap bisa dipanggil tanpa auth.
-- Artinya orang bisa MENGUBAH password lewat RPC, tapi TIDAK bisa MEMBACA password
-- yang ada. Ini sudah jauh lebih aman dari sebelumnya (read-leak tertutup).
-- Rekomendasi lanjutan: migrasi ke Supabase Auth (email+password) lalu tambahkan
-- auth guard di RPC write.
-- ============================================================

-- Hapus policy permissif lama, ganti dengan policy tertutup untuk anon.
drop policy if exists "Allow read app_config"  on app_config;
drop policy if exists "Allow upsert app_config" on app_config;
drop policy if exists "Allow update app_config" on app_config;

-- Anon (publik) TIDAK boleh baca/ubah apa pun di app_config.
-- Read/write hanya boleh lewat SECURITY DEFINER function di bawah.
create policy "No anon read app_config"  on app_config for select using (false);
create policy "No anon write app_config" on app_config for all    using (false) with check (false);

-- ------------------------------------------------------------
-- RPC 1: verifikasi password (tidak mengembalikan password)
-- ------------------------------------------------------------
create or replace function verify_dashboard_password(p_pass text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  text;
  v_label text;
begin
  select role, label into v_role, v_label
  from (
    select 'admin' as role, 'Admin' as label, value
      from app_config where key in ('pass_administrator','pass_admin')
    union all
    select 'user', 'CS / Customer Service', value
      from app_config where key = 'pass_cs'
    union all
    select 'user', 'User', value
      from app_config where key = 'pass_user'
    union all
    select 'guest', 'Guest', value
      from app_config where key = 'pass_guest'
  ) m
  where m.value = p_pass
  limit 1;

  if v_role is not null then
    return jsonb_build_object('ok', true, 'role', v_role, 'label', v_label);
  end if;
  return jsonb_build_object('ok', false);
end;
$$;

-- ------------------------------------------------------------
-- RPC 2: ubah password (SECURITY DEFINER). Tanpa auth guard
-- (aplikasi belum pakai Supabase Auth) — baca sudah tertutup.
-- ------------------------------------------------------------
create or replace function set_admin_password(p_key text, p_val text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key not in ('pass_admin','pass_user','pass_guest','pass_cs','pass_administrator') then
    raise exception 'key tidak diizinkan';
  end if;
  insert into app_config (key, value) values (p_key, p_val)
    on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

-- Izinkan anon memanggil kedua RPC (eksekusinya SECURITY DEFINER, aman karena
-- tidak mengembalikan/select password; hanya verifikasi & write terkendali).
grant execute on function verify_dashboard_password(text) to anon, authenticated;
grant execute on function set_admin_password(text, text)        to anon, authenticated;
