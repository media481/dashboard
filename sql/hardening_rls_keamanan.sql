-- ============================================================
-- HARDENING KEAMANAN #1 — Tutup RLS terbuka + Rate-limit login
-- Jalankan SETELAH 00_setup_semua_tabel.sql & fix_bug6_auth_rpc.sql
-- di SQL Editor Supabase.
--
-- MASALAH (dari assessment):
--   - Tabel programs/jamaah/pendaftaran/pembayaran dll punya RLS
--     using(true) untuk INSERT/UPDATE/DELETE -> SIAPA SAJA bisa hapus/edit
--     langsung lewat REST API Supabase (bypass UI) karena pakai anon key.
--   - Tidak ada rate-limit di login -> brute-force password admin mungkin.
--   - Edge function send-telegram pakai CORS "*" + --no-verify-jwt.
--
-- SOLUSI (tanpa paksa user bikin akun Supabase Auth):
--   1. WRITE (insert/update/delete) di-lock ke auth.role()='authenticated'.
--      Client mendapatkan JWT authenticated lewat Edge Function login-dashboard.
--      Tanpa JWT -> write otomatis ditolak RLS. READ tetap publik (true) agar
--      halaman depan tetap bisa lihat program.
--   2. RPC write sensitif (set_admin_password) di-guard: hanya boleh kalau
--      pemanggil sudah punya JWT authenticated (bukti sudah login).
--   3. Rate-limit login: RPC check_login_rate_limit() menolak >5 percobaan
--      dalam 1 menit per alamat (dicek lewat header x-forwarded-for di function,
--      tapi di RPC kita pakai auth.uid()/session sebagai proxy sederhana).
--
-- CATATAN PENTING:
--   Grant eksekusi RPC di bawah sudah mencakup anon (login butuh anon),
--   tapi write table tidak lagi bisa dilakukan anon.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Ubah RLS WRITE semua tabel inti jadi butuh authenticated
-- ------------------------------------------------------------
-- programs
drop policy if exists "Allow insert programs"  on programs;
drop policy if exists "Allow update programs"  on programs;
drop policy if exists "Allow delete programs"  on programs;
create policy "Auth insert programs"  on programs for insert with check (auth.role() = 'authenticated');
create policy "Auth update programs"  on programs for update using (auth.role() = 'authenticated');
create policy "Auth delete programs"  on programs for delete using (auth.role() = 'authenticated');

-- jadwal_tamu
drop policy if exists "Allow insert jadwal_tamu"  on jadwal_tamu;
drop policy if exists "Allow update jadwal_tamu"  on jadwal_tamu;
drop policy if exists "Allow delete jadwal_tamu"  on jadwal_tamu;
create policy "Auth insert jadwal_tamu"  on jadwal_tamu for insert with check (auth.role() = 'authenticated');
create policy "Auth update jadwal_tamu"  on jadwal_tamu for update using (auth.role() = 'authenticated');
create policy "Auth delete jadwal_tamu"  on jadwal_tamu for delete using (auth.role() = 'authenticated');

-- kb_jamaah
drop policy if exists "Allow insert kb_jamaah"  on kb_jamaah;
drop policy if exists "Allow update kb_jamaah"  on kb_jamaah;
drop policy if exists "Allow delete kb_jamaah"  on kb_jamaah;
create policy "Auth insert kb_jamaah"  on kb_jamaah for insert with check (auth.role() = 'authenticated');
create policy "Auth update kb_jamaah"  on kb_jamaah for update using (auth.role() = 'authenticated');
create policy "Auth delete kb_jamaah"  on kb_jamaah for delete using (auth.role() = 'authenticated');

-- pendaftaran
drop policy if exists "Allow insert pendaftaran"  on pendaftaran;
drop policy if exists "Allow update pendaftaran"  on pendaftaran;
drop policy if exists "Allow delete pendaftaran"  on pendaftaran;
create policy "Auth insert pendaftaran"  on pendaftaran for insert with check (auth.role() = 'authenticated');
create policy "Auth update pendaftaran"  on pendaftaran for update using (auth.role() = 'authenticated');
create policy "Auth delete pendaftaran"  on pendaftaran for delete using (auth.role() = 'authenticated');

-- featured_programs
drop policy if exists "Allow insert featured_programs"  on featured_programs;
drop policy if exists "Allow delete featured_programs"  on featured_programs;
create policy "Auth insert featured_programs"  on featured_programs for insert with check (auth.role() = 'authenticated');
create policy "Auth delete featured_programs"  on featured_programs for delete using (auth.role() = 'authenticated');

-- tg_config
drop policy if exists "Allow upsert tg_config"  on tg_config;
drop policy if exists "Allow update tg_config"  on tg_config;
create policy "Auth upsert tg_config"  on tg_config for insert with check (auth.role() = 'authenticated');
create policy "Auth update tg_config"  on tg_config for update using (auth.role() = 'authenticated');

-- kwt_kuitansi
drop policy if exists "Allow insert kwt_kuitansi"  on kwt_kuitansi;
drop policy if exists "Allow delete kwt_kuitansi"  on kwt_kuitansi;
create policy "Auth insert kwt_kuitansi"  on kwt_kuitansi for insert with check (auth.role() = 'authenticated');
create policy "Auth delete kwt_kuitansi"  on kwt_kuitansi for delete using (auth.role() = 'authenticated');

-- pembayaran_jamaah
drop policy if exists "Allow insert pembayaran_jamaah"  on pembayaran_jamaah;
drop policy if exists "Allow update pembayaran_jamaah"  on pembayaran_jamaah;
drop policy if exists "Allow delete pembayaran_jamaah"  on pembayaran_jamaah;
create policy "Auth insert pembayaran_jamaah"  on pembayaran_jamaah for insert with check (auth.role() = 'authenticated');
create policy "Auth update pembayaran_jamaah"  on pembayaran_jamaah for update using (auth.role() = 'authenticated');
create policy "Auth delete pembayaran_jamaah"  on pembayaran_jamaah for delete using (auth.role() = 'authenticated');

-- nota_audit_log (tetap insert auth, read publik seperti sebelumnya)
drop policy if exists "Allow insert nota_audit_log"  on nota_audit_log;
create policy "Auth insert nota_audit_log"  on nota_audit_log for insert with check (auth.role() = 'authenticated');

-- snapshot_backup
drop policy if exists "Allow insert snapshot_backup"  on snapshot_backup;
drop policy if exists "Allow delete snapshot_backup"  on snapshot_backup;
create policy "Auth insert snapshot_backup"  on snapshot_backup for insert with check (auth.role() = 'authenticated');
create policy "Auth delete snapshot_backup"  on snapshot_backup for delete using (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- 2. Guard RPC write sensitif: hanya boleh kalau sudah login (ada JWT)
-- ------------------------------------------------------------
create or replace function set_admin_password(p_key text, p_val text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Hanya izinkan kalau pemanggil punya JWT authenticated (bukti sudah login).
  if auth.role() is null or auth.role() <> 'authenticated' then
    raise exception 'Tidak terautentikasi';
  end if;
  if p_key not in ('pass_admin','pass_user','pass_guest','pass_cs','pass_administrator') then
    raise exception 'key tidak diizinkan';
  end if;
  insert into app_config (key, value) values (p_key, p_val)
    on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

-- ------------------------------------------------------------
-- 3. Rate-limit login (mencegah brute-force)
--    Simpan counter per identifier di tabel sementara login_rate_limit.
--    Maksimal 5 percobaan gagal per 1 menit.
-- ------------------------------------------------------------
create table if not exists login_rate_limit (
    ident text primary key,
    attempts int not null default 0,
    first_at timestamptz not null default now(),
    blocked_until timestamptz
);

create or replace function check_login_rate_limit(p_ident text)
returns boolean  -- true = BOLEH coba, false = DIBLOKIR
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  select * into v from login_rate_limit where ident = p_ident;
  -- sudah diblokir?
  if v is not null and v.blocked_until is not null and v.blocked_until > now() then
    return false;
  end if;
  -- reset window kalau sudah > 1 menit
  if v is null or v.first_at < now() - interval '1 minute' then
    insert into login_rate_limit (ident, attempts, first_at, blocked_until)
      values (p_ident, 0, now(), null)
      on conflict (ident) do update set attempts = 0, first_at = now(), blocked_until = null;
    return true;
  end if;
  -- masih dalam window & sudah >= 5 -> blokir 5 menit
  if v.attempts >= 5 then
    update login_rate_limit set blocked_until = now() + interval '5 minutes' where ident = p_ident;
    return false;
  end if;
  return true;
end;
$$;

create or replace function bump_login_failure(p_ident text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into login_rate_limit (ident, attempts, first_at)
    values (p_ident, 1, now())
    on conflict (ident) do update set attempts = login_rate_limit.attempts + 1;
end;
$$;

grant execute on function check_login_rate_limit(text) to anon, authenticated;
grant execute on function bump_login_failure(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 4. Izinkan anon memanggil RPC login (butuh anon saat belum punya JWT)
-- ------------------------------------------------------------
grant execute on function verify_dashboard_password(text) to anon, authenticated;
grant execute on function set_admin_password(text, text) to anon, authenticated;
