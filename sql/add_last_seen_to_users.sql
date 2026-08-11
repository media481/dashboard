-- ============================================================
-- TAMBAH: kolom "Terakhir Dibuka" di halaman Manajemen User
-- Jalankan sekali di Supabase Dashboard > SQL Editor > New query > Run
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================
--
-- Catatan: kalau kamu baru pertama kali setup project ini, cukup jalankan
-- supabase-rls-setup.sql versi terbaru (sudah termasuk perubahan ini) —
-- tidak perlu jalankan file ini secara terpisah. File ini khusus untuk
-- project yang sudah pernah menjalankan supabase-rls-setup.sql versi lama.
--
-- Menambahkan kolom last_seen_at di kt_users, diisi otomatis tiap kali:
--  1. User login lewat form (rpc_login), dan
--  2. Sesi lama (localStorage) masih valid dan aplikasi dibuka lagi
--     (rpc_touch_last_seen, dipanggil dari js/19-init.js).
-- ============================================================

alter table kt_users add column if not exists last_seen_at timestamptz;

-- ---- rpc_login: sekarang juga mencatat last_seen_at saat login berhasil ----
drop function if exists rpc_login(text, text);
create function rpc_login(p_username text, p_password text)
returns table(id text, name text, username text, role text, allowed_sections text[])
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user kt_users%rowtype;
  v_hash text;
begin
  select * into v_user from kt_users where kt_users.username = p_username limit 1;
  if not found then
    return;
  end if;

  v_hash := encode(digest(p_password, 'sha256'), 'hex');

  if v_user."passwordHash" is not null then
    if v_user."passwordHash" = v_hash then
      update kt_users set last_seen_at = now() where id = v_user.id;
      return query select v_user.id, v_user.name, v_user.username, v_user.role, v_user.allowed_sections;
    end if;
    return;
  elsif v_user.password is not null then
    -- kompatibilitas mundur: user lama yang masih plaintext, migrasi otomatis
    if v_user.password = p_password then
      update kt_users set "passwordHash" = v_hash, password = null, last_seen_at = now() where id = v_user.id;
      return query select v_user.id, v_user.name, v_user.username, v_user.role, v_user.allowed_sections;
    end if;
    return;
  end if;
  return;
end;
$$;
grant execute on function rpc_login(text, text) to anon;

-- ---- rpc_list_users: sekarang ikut mengembalikan last_seen_at ----
drop function if exists rpc_list_users();
create function rpc_list_users()
returns table(id text, name text, username text, role text, allowed_sections text[], last_seen_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select id, name, username, role, allowed_sections, last_seen_at from kt_users order by name;
$$;
grant execute on function rpc_list_users() to anon;

-- ---- rpc_touch_last_seen: dipanggil saat app dibuka pakai sesi lama ----
drop function if exists rpc_touch_last_seen(text);
create function rpc_touch_last_seen(p_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update kt_users set last_seen_at = now() where id = p_id;
$$;
grant execute on function rpc_touch_last_seen(text) to anon;

-- ============================================================
-- SELESAI. Setelah ini dijalankan, upload ulang js/ yang sudah
-- disesuaikan (kolom "Terakhir Dibuka" di halaman Manajemen User).
-- ============================================================
