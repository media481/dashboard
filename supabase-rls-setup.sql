-- ============================================================
-- RLS SETUP — Buku Keuangan Karang Taruna (tabel kt_*)
-- Jalankan di Supabase Dashboard > SQL Editor > New query > Run
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================
-- KONTEKS:
-- Aplikasi ini tidak pakai Supabase Auth — login diatur sendiri di JS
-- dan SUPABASE_ANON_KEY yang sama dipakai semua pengunjung. Karena itu
-- tabel DATA (anggota, donatur, transaksi, dst) tetap kita buka untuk
-- anon di Bagian 1 — itu memang cara aplikasi ini bekerja.
--
-- Yang beda: tabel kt_users (isinya password) di Bagian 2 kita KUNCI
-- TOTAL dari anon (tidak ada policy select/insert/update/delete sama
-- sekali). Satu-satunya jalan masuk adalah lewat fungsi RPC yang
-- berjalan di server (SECURITY DEFINER) dan hanya mengembalikan
-- id/nama/username/role — passwordHash TIDAK PERNAH dikirim ke browser.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- BAGIAN 1: Tabel data umum — RLS aktif, akses penuh untuk anon
-- (perilaku sama seperti sekarang, cuma diformalkan supaya tabel
-- baru yang lupa dikasih policy otomatis TERTUTUP, bukan otomatis
-- terbuka seperti kalau RLS mati total)
-- ============================================================
do $$
declare
  t text;
  tables text[] := array[
    'kt_events','kt_anggota','kt_donatur','kt_transaksi_lain','kt_operasional',
    'kt_lomba','kt_lomba_kebutuhan','kt_hadiah_kategori','kt_lomba_hadiah',
    'kt_daftar_belanja_hadiah','kt_daftar_belanja_perlengkapan',
    'kt_hadiah_jalan_santai','kt_daftar_belanja_jalan_santai','kt_jadwal',
    'kt_settings','kt_telegram_settings'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "anon_full_access" on %I;', t);
    execute format(
      'create policy "anon_full_access" on %I for all to anon using (true) with check (true);', t
    );
  end loop;
end $$;

-- Catatan: kt_telegram_settings (bot token) ikut dibuka juga di atas supaya
-- halaman Pengaturan tetap jalan seperti sekarang. Kalau nanti mau, token
-- ini juga bisa dikunci pakai pola RPC yang sama seperti kt_users — tinggal bilang.

-- ============================================================
-- BAGIAN 2: kt_users — DIKUNCI TOTAL dari anon, cuma lewat RPC
-- ============================================================

-- Tambah kolom passwordHash (huruf besar/kecil dijaga pakai tanda kutip
-- karena kolom baru ini dipakai lewat RPC, bukan diakses langsung dari JS)
alter table kt_users add column if not exists "passwordHash" text;

-- Kolom "password" lama kemungkinan masih NOT NULL dari skema awal.
-- Sekarang boleh null karena user baru/ter-migrasi akan pakai "passwordHash".
alter table kt_users alter column password drop not null;

-- Kolom untuk role "petugas": daftar key section (bidang) yang boleh
-- diakses & dikelola. Kosong untuk role admin/user (mereka tidak dibatasi).
alter table kt_users add column if not exists allowed_sections text[] not null default '{}'::text[];

-- Kolom waktu terakhir user membuka aplikasi (bukan cuma saat login lewat
-- form, tapi juga saat sesi lama di localStorage masih valid dan app
-- dibuka lagi) — dipakai untuk kolom "Terakhir Dibuka" di halaman
-- Manajemen User. Diisi lewat rpc_login (saat login) dan rpc_touch_last_seen
-- (saat app dibuka dengan sesi yang sudah ada, lihat 19-init.js).
alter table kt_users add column if not exists last_seen_at timestamptz;

alter table kt_users enable row level security;
-- SENGAJA tidak dibuatkan policy apa pun untuk anon di sini.
-- RLS aktif + nol policy = default DENY total (termasuk SELECT) untuk anon.
drop policy if exists "anon_full_access" on kt_users;

-- Seed 3 user default (admin/admin123, user/user123, user2/user123) kalau
-- belum ada. Kalau id ini sudah ada (kamu sudah pernah pakai user asli),
-- baris ini otomatis dilewati (ON CONFLICT DO NOTHING) — tidak menimpa data.
insert into kt_users (id, name, username, "passwordHash", role)
values
  ('admin1', 'Admin Utama', 'admin', encode(digest('admin123','sha256'),'hex'), 'admin'),
  ('user1',  'User 1',       'user',  encode(digest('user123','sha256'),'hex'), 'user'),
  ('user2',  'User 2',       'user2', encode(digest('user123','sha256'),'hex'), 'user')
on conflict (id) do nothing;

-- ---- rpc_login: verifikasi login, TIDAK PERNAH mengembalikan password ----
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
      update kt_users set last_seen_at = now() where kt_users.id = v_user.id;
      return query select v_user.id, v_user.name, v_user.username, v_user.role, v_user.allowed_sections;
    end if;
    return;
  elsif v_user.password is not null then
    -- kompatibilitas mundur: user lama yang masih plaintext, migrasi otomatis
    if v_user.password = p_password then
      update kt_users set "passwordHash" = v_hash, password = null, last_seen_at = now() where kt_users.id = v_user.id;
      return query select v_user.id, v_user.name, v_user.username, v_user.role, v_user.allowed_sections;
    end if;
    return;
  end if;
  return;
end;
$$;
grant execute on function rpc_login(text, text) to anon;

-- ---- rpc_list_users: daftar user untuk halaman Manajemen User (tanpa password) ----
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

-- ---- rpc_touch_last_seen: catat waktu app dibuka lagi lewat sesi yang
-- sudah tersimpan (localStorage), tanpa perlu login ulang lewat form ----
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

-- ---- rpc_upsert_user: tambah/edit user (password di-hash di server) ----
drop function if exists rpc_upsert_user(text, text, text, text, text);
drop function if exists rpc_upsert_user(text, text, text, text, text, text[]);
create function rpc_upsert_user(p_id text, p_name text, p_username text, p_password text, p_role text, p_sections text[] default '{}'::text[])
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  if p_password is not null and p_password <> '' then
    v_hash := encode(digest(p_password, 'sha256'), 'hex');
  end if;

  insert into kt_users (id, name, username, "passwordHash", role, allowed_sections)
  values (p_id, p_name, p_username, v_hash, p_role, coalesce(p_sections, '{}'::text[]))
  on conflict (id) do update
    set name = excluded.name,
        username = excluded.username,
        role = excluded.role,
        allowed_sections = coalesce(p_sections, '{}'::text[]),
        "passwordHash" = coalesce(v_hash, kt_users."passwordHash");
end;
$$;
grant execute on function rpc_upsert_user(text, text, text, text, text, text[]) to anon;

-- ---- rpc_delete_user ----
drop function if exists rpc_delete_user(text);
create function rpc_delete_user(p_id text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from kt_users where id = p_id;
$$;
grant execute on function rpc_delete_user(text) to anon;

-- ============================================================
-- BAGIAN 3: kt_guest_menu_settings — menu apa saja yang boleh
-- diakses Guest (belum login), diatur admin di halaman Pengaturan.
-- Tabel ini cuma berisi daftar key section (bukan data sensitif),
-- jadi dibuka untuk anon sama seperti kt_telegram_settings.
-- ============================================================
create table if not exists kt_guest_menu_settings (
  id text primary key,
  hidden_sections jsonb not null default '[]'::jsonb
);

alter table kt_guest_menu_settings enable row level security;
drop policy if exists "anon_full_access" on kt_guest_menu_settings;
create policy "anon_full_access" on kt_guest_menu_settings
  for all to anon using (true) with check (true);

-- Seed baris default: sembunyikan "Database Anggota" & "Jadwal & Reminder"
-- dari Guest kalau belum pernah diatur sama sekali.
insert into kt_guest_menu_settings (id, hidden_sections)
values ('main', '["database-anggota", "jadwal"]'::jsonb)
on conflict (id) do nothing;

-- ============================================================
-- BAGIAN 4: kt_settings — tambah kolom hadiah_budget
-- Untuk fitur "Atur Budget" di halaman Stok Hadiah Lomba: target
-- budget per kombinasi Kategori Peserta (anak/ibu/dst) x Juara
-- (1/2/3/partisipasi), disimpan sebagai jsonb per event_id.
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================
alter table kt_settings add column if not exists hadiah_budget jsonb not null default '{}'::jsonb;

-- ============================================================
-- SELESAI. Setelah ini dijalankan, upload ulang script.js yang sudah
-- disesuaikan (lihat pesan chat) — karena kt_users sekarang HANYA bisa
-- diakses lewat rpc_login / rpc_list_users / rpc_upsert_user / rpc_delete_user,
-- bukan lewat sb.from('kt_users') langsung lagi.
-- ============================================================
