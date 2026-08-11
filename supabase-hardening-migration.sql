-- ============================================================
-- HARDENING MIGRATION — Merdeka / Taruna Inti
-- Menutup 4 temuan prioritas dari AUDIT-STANDAR-SAAS.md:
--   §6  RLS berbasis sesi (menggantikan anon_full_access)
--   §6  Hash password bcrypt bersalt (ganti sha256 polos)
--   §9  Bot token Telegram dicabut dari klien
--   §10 Rate limit login (brute-force)
--
-- Jalankan di Supabase Dashboard > SQL Editor > Run.
-- Aman dijalankan berkali-kali (idempotent).
--
-- URUTAN DEPLOY YANG BENAR (penting, jangan dibalik):
--   1. Jalankan file SQL ini.
--   2. Deploy kode baru (Worker + bundle JS).
-- Kalau dibalik, app lama akan kehilangan akses baca sebelum kode
-- baru yang mengirim session token sempat aktif.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- BAGIAN 1: Tabel sesi
-- ============================================================
-- Selama ini js/02-auth.js sudah mengirim header `x-session-token`
-- dan memanggil rpc_logout, TAPI tabel sesinya tidak pernah dibuat
-- dan rpc_login tidak pernah mengembalikan token — jadi header itu
-- selalu kosong dan tidak ada policy yang memeriksanya. Ini yang
-- membuat seluruh data terbuka untuk anon. Bagian ini melengkapinya.

create table if not exists kt_sessions (
  token       text primary key,
  user_id     text not null references kt_users(id) on delete cascade,
  role        text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  last_used_at timestamptz not null default now()
);

-- PENTING: `create table if not exists` di atas DILEWATI kalau kt_sessions
-- sudah pernah dibuat sebelumnya (mis. dari percobaan/versi awal). Tabel lama
-- itu bisa saja belum punya semua kolom yang dipakai fungsi-fungsi di bawah,
-- dan akibatnya migrasi gagal di tengah jalan dengan error seperti:
--   ERROR: column "last_used_at" of relation "kt_sessions" does not exist
-- Karena itu setiap kolom ditambahkan secara eksplisit & idempoten di sini.
alter table kt_sessions add column if not exists user_id text;
alter table kt_sessions add column if not exists role text;
alter table kt_sessions add column if not exists created_at timestamptz not null default now();
alter table kt_sessions add column if not exists expires_at timestamptz;
alter table kt_sessions add column if not exists last_used_at timestamptz not null default now();

-- Baris sesi lama (kalau ada) kemungkinan tidak punya expires_at/role yang
-- valid. Sesi lama tidak bisa dipercaya sebagai sesi terautentikasi menurut
-- aturan baru, jadi dibuang saja — pengguna cukup login ulang sekali.
delete from kt_sessions
 where expires_at is null or role is null or user_id is null;

-- Baru setelah datanya bersih, kolom kunci boleh dijadikan NOT NULL.
do $$
begin
  begin
    alter table kt_sessions alter column expires_at set not null;
    alter table kt_sessions alter column user_id set not null;
    alter table kt_sessions alter column role set not null;
  exception when others then
    raise notice 'Lewati set not null pada kt_sessions: %', sqlerrm;
  end;
end $$;

-- Foreign key ke kt_users (kalau tabel lama dibuat tanpa constraint ini).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'kt_sessions_user_id_fkey' and conrelid = 'kt_sessions'::regclass
  ) then
    -- buang dulu sesi yatim supaya penambahan constraint tidak ditolak
    delete from kt_sessions s
     where not exists (select 1 from kt_users u where u.id = s.user_id);
    alter table kt_sessions
      add constraint kt_sessions_user_id_fkey
      foreign key (user_id) references kt_users(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_kt_sessions_expires on kt_sessions (expires_at);
create index if not exists idx_kt_sessions_user on kt_sessions (user_id);

-- Dikunci total dari anon: token hanya lahir & mati lewat RPC.
alter table kt_sessions enable row level security;
drop policy if exists "anon_full_access" on kt_sessions;

comment on table kt_sessions is
  'Sesi login aktif. Token dikirim klien di header x-session-token '
  '(lihat override fetch di js/00-config.js) dan diverifikasi oleh '
  'session_is_logged_in()/session_is_admin() di setiap RLS policy.';

-- ============================================================
-- BAGIAN 2: Fungsi pemeriksa sesi
-- ============================================================
-- Membaca header HTTP yang diteruskan PostgREST lewat GUC
-- `request.headers`. STABLE supaya dievaluasi sekali per query,
-- bukan sekali per baris (penting untuk tabel besar).

create or replace function session_token()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.headers', true)::json ->> 'x-session-token',
      ''
    ),
    ''
  );
$$;

create or replace function session_user_row()
returns kt_sessions
language sql
stable
security definer
set search_path = public
as $$
  select s.* from kt_sessions s
  where s.token = session_token()
    and s.expires_at > now()
  limit 1;
$$;

create or replace function session_is_logged_in()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from kt_sessions s
    where s.token = session_token()
      and s.expires_at > now()
  );
$$;

create or replace function session_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from kt_sessions s
    where s.token = session_token()
      and s.expires_at > now()
      and s.role = 'admin'
  );
$$;

grant execute on function session_token() to anon;
grant execute on function session_is_logged_in() to anon;
grant execute on function session_is_admin() to anon;

-- ============================================================
-- BAGIAN 3: Policy data — baca untuk tamu, TULIS hanya kalau login
-- ============================================================
-- Aplikasi ini punya mode "Guest (View Only)" yang memang disengaja
-- (lihat isGuestVisible() & kt_guest_menu_settings), jadi SELECT
-- tetap dibuka untuk anon. Yang ditutup adalah INSERT/UPDATE/DELETE
-- — sebelumnya siapa pun tanpa login bisa menghapus seluruh data
-- keuangan hanya bermodal anon key yang terlihat di DevTools.
--
-- Kalau nanti mau menutup baca juga (app internal penuh, tanpa mode
-- tamu), ganti `using (true)` di policy _read jadi
-- `using (session_is_logged_in())`.

do $$
declare
  t text;
  tables text[] := array[
    'kt_events','kt_anggota','kt_donatur','kt_transaksi_lain','kt_operasional',
    'kt_lomba','kt_lomba_kebutuhan','kt_lomba_arsip','kt_hadiah_kategori','kt_lomba_hadiah',
    'kt_daftar_belanja_hadiah','kt_daftar_belanja_perlengkapan',
    'kt_hadiah_jalan_santai','kt_daftar_belanja_jalan_santai','kt_jadwal',
    'kt_agenda','kt_kas','kt_dana_sosial_anggota','kt_dana_sosial_bayar',
    'kt_bookmark','kt_settings','kt_dokumen_global','kt_organisasi_profil',
    'kt_snapshot','kt_gudang_inventory','kt_gudang_transactions'
  ];
begin
  foreach t in array tables loop
    -- lewati tabel yang memang belum ada di project ini
    if to_regclass('public.' || t) is null then
      raise notice 'Lewati % (tabel belum ada)', t;
      continue;
    end if;

    execute format('alter table %I enable row level security;', t);

    -- Cabut policy lama yang membuka segalanya.
    execute format('drop policy if exists "anon_full_access" on %I;', t);
    execute format('drop policy if exists "%s_read" on %I;', t, t);
    execute format('drop policy if exists "%s_write" on %I;', t, t);

    execute format(
      'create policy "%s_read" on %I for select to anon using (true);', t, t
    );
    execute format(
      'create policy "%s_write" on %I for all to anon '
      'using (session_is_logged_in()) with check (session_is_logged_in());',
      t, t
    );
  end loop;
end $$;

-- ============================================================
-- BAGIAN 4: kt_telegram_settings — bot token tidak lagi milik klien
-- ============================================================
-- Sebelumnya tabel ini ikut anon_full_access DAN js/04-event-settings.js
-- memanggil api.telegram.org langsung dari browser pakai bot_token dari
-- tabel ini. Artinya token bot bisa dibaca siapa pun. Sekarang:
--   - token hidup sebagai secret di Cloudflare Worker (TELEGRAM_BOT_TOKEN)
--   - kolom bot_token dikosongkan & tidak pernah dibaca klien lagi
--   - preferensi (enabled/kategori/jam tenang) tetap boleh dibaca

alter table kt_telegram_settings enable row level security;
drop policy if exists "anon_full_access" on kt_telegram_settings;
drop policy if exists "kt_telegram_settings_read" on kt_telegram_settings;
drop policy if exists "kt_telegram_settings_write" on kt_telegram_settings;

-- Kolom rahasia dipisah dari preferensi: yang boleh dibaca cuma view.
update kt_telegram_settings set bot_token = '' where bot_token is not null and bot_token <> '';

comment on column kt_telegram_settings.bot_token is
  'TIDAK DIPAKAI LAGI — selalu string kosong. Bot token sekarang '
  'disimpan sebagai secret Cloudflare Worker (TELEGRAM_BOT_TOKEN), '
  'tidak pernah dikirim ke browser. Lihat src/worker.js.';

create policy "kt_telegram_settings_read" on kt_telegram_settings
  for select to anon using (true);
create policy "kt_telegram_settings_write" on kt_telegram_settings
  for all to anon
  using (session_is_admin()) with check (session_is_admin());

-- Guest menu: baca bebas (menentukan menu tamu), tulis admin saja.
alter table kt_guest_menu_settings enable row level security;
drop policy if exists "anon_full_access" on kt_guest_menu_settings;
drop policy if exists "kt_guest_menu_settings_read" on kt_guest_menu_settings;
drop policy if exists "kt_guest_menu_settings_write" on kt_guest_menu_settings;
create policy "kt_guest_menu_settings_read" on kt_guest_menu_settings
  for select to anon using (true);
create policy "kt_guest_menu_settings_write" on kt_guest_menu_settings
  for all to anon
  using (session_is_admin()) with check (session_is_admin());

-- ============================================================
-- BAGIAN 5: kt_error_log — boleh nulis, TIDAK boleh menghapus jejak
-- ============================================================
-- Sebelumnya anon punya akses penuh termasuk DELETE: penyerang bisa
-- membersihkan jejaknya sendiri. Sekarang insert bebas (supaya device
-- yang belum login tetap bisa melaporkan error), baca & hapus admin saja.

do $$ begin
  if to_regclass('public.kt_error_log') is not null then
    execute 'alter table kt_error_log enable row level security';
    execute 'drop policy if exists "anon_full_access" on kt_error_log';
    execute 'drop policy if exists "kt_error_log_insert" on kt_error_log';
    execute 'drop policy if exists "kt_error_log_read" on kt_error_log';
    execute 'drop policy if exists "kt_error_log_delete" on kt_error_log';
    execute 'create policy "kt_error_log_insert" on kt_error_log for insert to anon with check (true)';
    execute 'create policy "kt_error_log_read" on kt_error_log for select to anon using (session_is_logged_in())';
    execute 'create policy "kt_error_log_delete" on kt_error_log for delete to anon using (session_is_admin())';
    -- simpan stack trace kalau ada (sebelumnya cuma pesan toast)
    execute 'alter table kt_error_log add column if not exists stack text';
  end if;
end $$;

-- ============================================================
-- BAGIAN 6: Rate limit login
-- ============================================================
-- rpc_login sebelumnya bisa dipanggil tanpa batas. Password 6 karakter
-- habis di-brute-force dalam hitungan menit.

create table if not exists kt_login_attempts (
  id          bigserial primary key,
  username    text not null,
  success     boolean not null,
  attempted_at timestamptz not null default now()
);

-- Alasan sama seperti kt_sessions di atas: kalau tabel ini sudah ada dari
-- percobaan sebelumnya, `create table if not exists` dilewati dan kolomnya
-- belum tentu lengkap.
alter table kt_login_attempts add column if not exists username text;
alter table kt_login_attempts add column if not exists success boolean;
alter table kt_login_attempts add column if not exists attempted_at timestamptz not null default now();

create index if not exists idx_kt_login_attempts_lookup
  on kt_login_attempts (username, attempted_at desc);

alter table kt_login_attempts enable row level security;
drop policy if exists "anon_full_access" on kt_login_attempts;
-- nol policy = anon tidak bisa membaca/menulis langsung; hanya rpc_login
-- (SECURITY DEFINER) yang menyentuhnya.

create or replace function login_is_locked(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select count(*) >= 5
  from kt_login_attempts
  where username = p_username
    and success = false
    and attempted_at > now() - interval '15 minutes';
$$;

-- ============================================================
-- BAGIAN 7: rpc_login baru — bcrypt + rate limit + terbitkan sesi
-- ============================================================
-- Migrasi hash transparan: baris lama masih sha256 hex (64 karakter).
-- Saat user itu login benar untuk pertama kalinya setelah migrasi ini,
-- hash-nya otomatis di-upgrade jadi bcrypt bersalt. Tidak ada yang
-- perlu reset password.

drop function if exists rpc_login(text, text);
create function rpc_login(p_username text, p_password text)
returns table(
  id text, name text, username text, role text,
  allowed_sections text[], session_token text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user  kt_users%rowtype;
  v_ok    boolean := false;
  v_token text;
begin
  -- Rate limit dulu, sebelum menyentuh tabel user sama sekali.
  if login_is_locked(p_username) then
    raise exception 'Terlalu banyak percobaan login gagal. Coba lagi 15 menit lagi.'
      using errcode = 'P0001';
  end if;

  select * into v_user from kt_users where kt_users.username = p_username limit 1;

  if found then
    if v_user."passwordHash" is not null and v_user."passwordHash" <> '' then
      if v_user."passwordHash" like '$2%' then
        -- sudah bcrypt
        v_ok := (crypt(p_password, v_user."passwordHash") = v_user."passwordHash");
      else
        -- masih sha256 lama -> verifikasi, lalu upgrade ke bcrypt
        v_ok := (v_user."passwordHash" = encode(digest(p_password, 'sha256'), 'hex'));
        if v_ok then
          update kt_users
             set "passwordHash" = crypt(p_password, gen_salt('bf', 10))
           where kt_users.id = v_user.id;
        end if;
      end if;
    elsif v_user.password is not null then
      -- kompatibilitas mundur: plaintext paling lama
      v_ok := (v_user.password = p_password);
      if v_ok then
        update kt_users
           set "passwordHash" = crypt(p_password, gen_salt('bf', 10)),
               password = null
         where kt_users.id = v_user.id;
      end if;
    end if;
  end if;

  insert into kt_login_attempts (username, success) values (p_username, v_ok);

  if not v_ok then
    return;
  end if;

  -- Bersihkan sesi kedaluwarsa sekalian (murah, tidak perlu cron).
  delete from kt_sessions where expires_at < now();

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into kt_sessions (token, user_id, role, expires_at)
  values (v_token, v_user.id, v_user.role, now() + interval '30 days');

  update kt_users set last_seen_at = now() where kt_users.id = v_user.id;

  return query select
    v_user.id, v_user.name, v_user.username, v_user.role,
    v_user.allowed_sections, v_token;
end;
$$;
grant execute on function rpc_login(text, text) to anon;

-- ---- rpc_logout: matikan sesi di server (dipanggil js/02-auth.js) ----
drop function if exists rpc_logout(text);
create function rpc_logout(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from kt_sessions where token = p_token;
$$;
grant execute on function rpc_logout(text) to anon;

-- ---- rpc_session_user: validasi sesi tersimpan saat app dibuka lagi ----
-- Dipakai js/19-init.js supaya sesi yang sudah dicabut/kedaluwarsa tidak
-- terlihat "masih login" hanya karena localStorage belum dibersihkan.
drop function if exists rpc_session_user();
create function rpc_session_user()
returns table(id text, name text, username text, role text, allowed_sections text[])
language sql
security definer
set search_path = public
as $$
  update kt_sessions set last_used_at = now()
   where token = session_token() and expires_at > now();

  select u.id, u.name, u.username, u.role, u.allowed_sections
  from kt_sessions s
  join kt_users u on u.id = s.user_id
  where s.token = session_token() and s.expires_at > now()
  limit 1;
$$;
grant execute on function rpc_session_user() to anon;

-- ============================================================
-- BAGIAN 8: RPC user — sekarang wajib admin
-- ============================================================
-- Sebelumnya rpc_list_users/upsert/delete di-grant ke anon TANPA
-- pemeriksaan apa pun: siapa saja bisa memanggil rpc_delete_user
-- atau mengganti password admin lewat rpc_upsert_user.

drop function if exists rpc_list_users();
create function rpc_list_users()
returns table(id text, name text, username text, role text, allowed_sections text[], last_seen_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not session_is_admin() then
    raise exception 'Akses ditolak: hanya admin.' using errcode = 'P0001';
  end if;
  return query
    select u.id, u.name, u.username, u.role, u.allowed_sections, u.last_seen_at
    from kt_users u order by u.name;
end;
$$;
grant execute on function rpc_list_users() to anon;

drop function if exists rpc_upsert_user(text, text, text, text, text);
drop function if exists rpc_upsert_user(text, text, text, text, text, text[]);
create function rpc_upsert_user(
  p_id text, p_name text, p_username text,
  p_password text, p_role text, p_sections text[] default '{}'::text[]
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  if not session_is_admin() then
    raise exception 'Akses ditolak: hanya admin.' using errcode = 'P0001';
  end if;

  if p_password is not null and p_password <> '' then
    if length(p_password) < 8 then
      raise exception 'Password minimal 8 karakter.' using errcode = 'P0001';
    end if;
    v_hash := crypt(p_password, gen_salt('bf', 10));
  end if;

  insert into kt_users (id, name, username, "passwordHash", role, allowed_sections)
  values (p_id, p_name, p_username, v_hash, p_role, coalesce(p_sections, '{}'::text[]))
  on conflict (id) do update
    set name = excluded.name,
        username = excluded.username,
        role = excluded.role,
        allowed_sections = coalesce(p_sections, '{}'::text[]),
        "passwordHash" = coalesce(v_hash, kt_users."passwordHash");

  -- Ganti role/password -> sesi lama user itu dicabut supaya perubahan
  -- langsung berlaku, bukan menunggu token 30 hari kedaluwarsa.
  if v_hash is not null then
    delete from kt_sessions where user_id = p_id;
  else
    update kt_sessions set role = p_role where user_id = p_id;
  end if;
end;
$$;
grant execute on function rpc_upsert_user(text, text, text, text, text, text[]) to anon;

drop function if exists rpc_delete_user(text);
create function rpc_delete_user(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not session_is_admin() then
    raise exception 'Akses ditolak: hanya admin.' using errcode = 'P0001';
  end if;
  delete from kt_sessions where user_id = p_id;
  delete from kt_users where id = p_id;
end;
$$;
grant execute on function rpc_delete_user(text) to anon;

drop function if exists rpc_touch_last_seen(text);
create function rpc_touch_last_seen(p_id text)
returns void
language sql
security definer
set search_path = public
as $$
  -- Hanya boleh menyentuh baris milik sesi pemanggil sendiri.
  update kt_users set last_seen_at = now()
   where id = p_id
     and exists (
       select 1 from kt_sessions s
       where s.token = session_token()
         and s.expires_at > now()
         and s.user_id = p_id
     );
$$;
grant execute on function rpc_touch_last_seen(text) to anon;

-- ============================================================
-- SELESAI
-- ============================================================
-- Verifikasi cepat setelah dijalankan — tidak boleh ada baris
-- yang tersisa dengan policy terbuka:
--
--   select tablename, policyname, cmd, qual
--   from pg_policies
--   where schemaname = 'public' and qual = 'true' and cmd <> 'SELECT';
--
-- Uji rate limit: panggil rpc_login 6x dengan password salah,
-- panggilan ke-6 harus melempar error "Terlalu banyak percobaan".
-- ============================================================
