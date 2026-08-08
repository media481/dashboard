-- ============================================================================
--  SETUP LENGKAP DASHBOARD AMIRU — 1 FILE, BEBAS URUTAN (v2, idempoten penuh)
-- ============================================================================
--  Cara pakai:
--    1. Buka Supabase Dashboard -> SQL Editor -> New Query.
--    2. Paste SELURUH isi file ini.
--    3. Klik Run (Ctrl/Cmd+Enter).
--    4. Selesai. TIDAK perlu menjalankan file SQL lainnya.
--
--  File ini menggabungkan semua migrasi (00_setup + tambah_* + fix_bug6 +
--  hardening_rls) MENJADI SATU, dengan kebijakan RLS FINAL langsung tertanam.
--
--  IDEMPOTEN PENUH: setiap CREATE POLICY didahului DROP untuk SEMUA skema
--  penamaan yang mungkin pernah ada ("Allow ...", "Auth ...", "Pub read ...",
--  "No anon ..."). Jadi aman dijalankan berulang, baik di project kosong
--  maupun project yang SUDAH pernah dijalankan SQL hardening sebelumnya
--  (tidak akan error "policy already exists").
--
--  ===========================================================================
--  KEBIJAKAN KEAMANAN YANG DITERAPKAN (WAJIB DIBACA)
--  ===========================================================================
--  * app_config (password login): SELECT & WRITE DITUTUP TOTAL untuk anon.
--    Verifikasi lewat RPC verify_dashboard_password() (SECURITY DEFINER).
--  * Tabel LAIN: READ = publik (true); WRITE = hanya auth.role()='authenticated'.
--    Client dapat JWT authenticated lewat Edge Function login-dashboard.
--  * PERINGATAN: tg_config (bot token) & snapshot_backup masih publik-read
--    (dibaca client dgn anon key) — sengaja agar fitur Telegram jalan tanpa
--    login, tapi token terekspos. Kunci ke authenticated bila mau lebih aman.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. PROGRAMS
-- ============================================================================
create table if not exists programs (
    id uuid primary key default gen_random_uuid(),
    nama text not null,
    tgl text,
    durasi text,
    maskapai text,
    harga_quint text,
    link_poster text,
    link_itinerary text,
    link_metaads text,
    link_dokumentasi text,
    teks_wa text,
    admin_data_lengkap jsonb,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);
create index if not exists idx_programs_created_at on programs (created_at desc);
create index if not exists idx_programs_is_active on programs (is_active);

alter table programs enable row level security;
drop policy if exists "Allow read programs"   on programs;
drop policy if exists "Auth read programs"    on programs;
drop policy if exists "Pub read programs"     on programs;
drop policy if exists "Allow insert programs" on programs;
drop policy if exists "Auth insert programs"  on programs;
drop policy if exists "Allow update programs" on programs;
drop policy if exists "Auth update programs"  on programs;
drop policy if exists "Allow delete programs" on programs;
drop policy if exists "Auth delete programs"  on programs;
create policy "Pub read programs" on programs for select using (true);
create policy "Auth insert programs" on programs for insert with check (auth.role() = 'authenticated');
create policy "Auth update programs" on programs for update using (auth.role() = 'authenticated');
create policy "Auth delete programs" on programs for delete using (auth.role() = 'authenticated');

-- ============================================================================
-- 2. JADWAL_TAMU
-- ============================================================================
create table if not exists jadwal_tamu (
    id uuid primary key default gen_random_uuid(),
    nama text not null,
    tgl date not null,
    jam text,
    asal text,
    jumlah integer,
    keperluan text,
    wa text,
    catatan text,
    created_at timestamptz not null default now()
);
create index if not exists idx_jadwal_tamu_tgl on jadwal_tamu (tgl asc);

alter table jadwal_tamu enable row level security;
drop policy if exists "Allow read jadwal_tamu"   on jadwal_tamu;
drop policy if exists "Auth read jadwal_tamu"    on jadwal_tamu;
drop policy if exists "Pub read jadwal_tamu"     on jadwal_tamu;
drop policy if exists "Allow insert jadwal_tamu" on jadwal_tamu;
drop policy if exists "Auth insert jadwal_tamu"  on jadwal_tamu;
drop policy if exists "Allow update jadwal_tamu" on jadwal_tamu;
drop policy if exists "Auth update jadwal_tamu"  on jadwal_tamu;
drop policy if exists "Allow delete jadwal_tamu" on jadwal_tamu;
drop policy if exists "Auth delete jadwal_tamu"  on jadwal_tamu;
create policy "Pub read jadwal_tamu" on jadwal_tamu for select using (true);
create policy "Auth insert jadwal_tamu" on jadwal_tamu for insert with check (auth.role() = 'authenticated');
create policy "Auth update jadwal_tamu" on jadwal_tamu for update using (auth.role() = 'authenticated');
create policy "Auth delete jadwal_tamu" on jadwal_tamu for delete using (auth.role() = 'authenticated');

-- ============================================================================
-- 3. KB_JAMAAH
-- ============================================================================
create table if not exists kb_jamaah (
    id uuid primary key default gen_random_uuid(),
    program_id uuid references programs(id) on delete cascade,
    nama text not null,
    nik text,
    paspor text,
    wa text,
    asal text,
    status text,
    catatan text,
    dokumen jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);
create index if not exists idx_kb_jamaah_program_id on kb_jamaah (program_id);
create index if not exists idx_kb_jamaah_nama on kb_jamaah (nama);

alter table kb_jamaah add column if not exists dokumen jsonb not null default '{}'::jsonb;

alter table kb_jamaah enable row level security;
drop policy if exists "Allow read kb_jamaah"   on kb_jamaah;
drop policy if exists "Auth read kb_jamaah"    on kb_jamaah;
drop policy if exists "Pub read kb_jamaah"     on kb_jamaah;
drop policy if exists "Allow insert kb_jamaah" on kb_jamaah;
drop policy if exists "Auth insert kb_jamaah"  on kb_jamaah;
drop policy if exists "Allow update kb_jamaah" on kb_jamaah;
drop policy if exists "Auth update kb_jamaah"  on kb_jamaah;
drop policy if exists "Allow delete kb_jamaah" on kb_jamaah;
drop policy if exists "Auth delete kb_jamaah"  on kb_jamaah;
create policy "Pub read kb_jamaah" on kb_jamaah for select using (true);
create policy "Auth insert kb_jamaah" on kb_jamaah for insert with check (auth.role() = 'authenticated');
create policy "Auth update kb_jamaah" on kb_jamaah for update using (auth.role() = 'authenticated');
create policy "Auth delete kb_jamaah" on kb_jamaah for delete using (auth.role() = 'authenticated');

-- ============================================================================
-- 3B. PENDAFTARAN
-- ============================================================================
create table if not exists pendaftaran (
    id uuid primary key default gen_random_uuid(),
    program_id uuid references programs(id) on delete set null,
    nama text not null,
    wa text,
    asal text,
    status text not null default 'baru',
    catatan text,
    created_at timestamptz not null default now()
);
create index if not exists idx_pendaftaran_program_id on pendaftaran (program_id);
create index if not exists idx_pendaftaran_created_at on pendaftaran (created_at desc);

alter table pendaftaran add column if not exists tanggal_daftar date;
alter table pendaftaran add column if not exists ktp text;
alter table pendaftaran add column if not exists jenis_kelamin text;
alter table pendaftaran add column if not exists tempat_lahir text;
alter table pendaftaran add column if not exists tgl_lahir date;
alter table pendaftaran add column if not exists alamat text;
alter table pendaftaran add column if not exists kode_pos text;
alter table pendaftaran add column if not exists telp_rumah text;
alter table pendaftaran add column if not exists ahli_waris_nama text;
alter table pendaftaran add column if not exists ahli_waris_hubungan text;

alter table pendaftaran enable row level security;
drop policy if exists "Allow read pendaftaran"   on pendaftaran;
drop policy if exists "Auth read pendaftaran"    on pendaftaran;
drop policy if exists "Pub read pendaftaran"     on pendaftaran;
drop policy if exists "Allow insert pendaftaran" on pendaftaran;
drop policy if exists "Auth insert pendaftaran"  on pendaftaran;
drop policy if exists "Allow update pendaftaran" on pendaftaran;
drop policy if exists "Auth update pendaftaran"  on pendaftaran;
drop policy if exists "Allow delete pendaftaran" on pendaftaran;
drop policy if exists "Auth delete pendaftaran"  on pendaftaran;
create policy "Pub read pendaftaran" on pendaftaran for select using (true);
create policy "Auth insert pendaftaran" on pendaftaran for insert with check (auth.role() = 'authenticated');
create policy "Auth update pendaftaran" on pendaftaran for update using (auth.role() = 'authenticated');
create policy "Auth delete pendaftaran" on pendaftaran for delete using (auth.role() = 'authenticated');

-- ============================================================================
-- 4. FEATURED_PROGRAMS
-- ============================================================================
create table if not exists featured_programs (
    id uuid primary key default gen_random_uuid(),
    program_id uuid not null references programs(id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (program_id)
);

alter table featured_programs enable row level security;
drop policy if exists "Allow read featured_programs"   on featured_programs;
drop policy if exists "Auth read featured_programs"    on featured_programs;
drop policy if exists "Pub read featured_programs"     on featured_programs;
drop policy if exists "Allow insert featured_programs" on featured_programs;
drop policy if exists "Auth insert featured_programs"  on featured_programs;
drop policy if exists "Allow delete featured_programs" on featured_programs;
drop policy if exists "Auth delete featured_programs"  on featured_programs;
create policy "Pub read featured_programs" on featured_programs for select using (true);
create policy "Auth insert featured_programs" on featured_programs for insert with check (auth.role() = 'authenticated');
create policy "Auth delete featured_programs" on featured_programs for delete using (auth.role() = 'authenticated');

-- ============================================================================
-- 5. APP_CONFIG  (password — TERTUTUP total untuk anon)
-- ============================================================================
create table if not exists app_config (
    key text primary key,
    value text,
    updated_at timestamptz not null default now()
);

alter table app_config enable row level security;
drop policy if exists "Allow read app_config"   on app_config;
drop policy if exists "Auth read app_config"    on app_config;
drop policy if exists "No anon read app_config" on app_config;
drop policy if exists "Allow upsert app_config" on app_config;
drop policy if exists "Allow update app_config" on app_config;
drop policy if exists "Auth update app_config" on app_config;
drop policy if exists "No anon write app_config" on app_config;
create policy "No anon read app_config"  on app_config for select using (false);
create policy "No anon write app_config" on app_config for all    using (false) with check (false);

insert into app_config (key, value) values
    ('pass_administrator', 'ganti-password-admin'),
    ('pass_cs', 'ganti-password-cs')
on conflict (key) do nothing;

-- ============================================================================
-- 6. TG_CONFIG
-- ============================================================================
create table if not exists tg_config (
    key text primary key,
    value text,
    updated_at timestamptz not null default now()
);

alter table tg_config enable row level security;
drop policy if exists "Allow read tg_config"   on tg_config;
drop policy if exists "Auth read tg_config"    on tg_config;
drop policy if exists "Pub read tg_config"     on tg_config;
drop policy if exists "Allow upsert tg_config" on tg_config;
drop policy if exists "Auth upsert tg_config" on tg_config;
drop policy if exists "Allow update tg_config" on tg_config;
drop policy if exists "Auth update tg_config" on tg_config;
create policy "Pub read tg_config" on tg_config for select using (true);
create policy "Auth upsert tg_config" on tg_config for insert with check (auth.role() = 'authenticated');
create policy "Auth update tg_config" on tg_config for update using (auth.role() = 'authenticated');

-- ============================================================================
-- 7. KWT_KUITANSI
-- ============================================================================
create table if not exists kwt_kuitansi (
    id uuid primary key default gen_random_uuid(),
    jamaah_id uuid null,
    nomor text,
    tempat_tanggal text,
    dari text not null,
    jumlah numeric not null default 0,
    terbilang text,
    keterangan text,
    penerima text,
    created_at timestamptz not null default now()
);
create index if not exists idx_kwt_kuitansi_created_at on kwt_kuitansi (created_at desc);
create index if not exists idx_kwt_kuitansi_jamaah_id on kwt_kuitansi (jamaah_id);

alter table kwt_kuitansi enable row level security;
drop policy if exists "Allow read kwt_kuitansi"   on kwt_kuitansi;
drop policy if exists "Auth read kwt_kuitansi"    on kwt_kuitansi;
drop policy if exists "Pub read kwt_kuitansi"     on kwt_kuitansi;
drop policy if exists "Allow insert kwt_kuitansi" on kwt_kuitansi;
drop policy if exists "Auth insert kwt_kuitansi"  on kwt_kuitansi;
drop policy if exists "Allow delete kwt_kuitansi" on kwt_kuitansi;
drop policy if exists "Auth delete kwt_kuitansi"  on kwt_kuitansi;
create policy "Pub read kwt_kuitansi" on kwt_kuitansi for select using (true);
create policy "Auth insert kwt_kuitansi" on kwt_kuitansi for insert with check (auth.role() = 'authenticated');
create policy "Auth delete kwt_kuitansi" on kwt_kuitansi for delete using (auth.role() = 'authenticated');

-- ============================================================================
-- 8. PEMBAYARAN_JAMAAH  (+ nomor_nota, trigger, audit log)
-- ============================================================================
create table if not exists pembayaran_jamaah (
    id uuid primary key default gen_random_uuid(),
    jamaah_id uuid not null references kb_jamaah(id) on delete cascade,
    tanggal date not null default current_date,
    jumlah numeric not null default 0,
    metode text,
    keterangan text,
    created_at timestamptz not null default now()
);
create index if not exists idx_pembayaran_jamaah_jamaah_id on pembayaran_jamaah (jamaah_id);
create index if not exists idx_pembayaran_jamaah_tanggal on pembayaran_jamaah (tanggal desc);

alter table pembayaran_jamaah enable row level security;
drop policy if exists "Allow read pembayaran_jamaah"   on pembayaran_jamaah;
drop policy if exists "Auth read pembayaran_jamaah"    on pembayaran_jamaah;
drop policy if exists "Pub read pembayaran_jamaah"     on pembayaran_jamaah;
drop policy if exists "Allow insert pembayaran_jamaah" on pembayaran_jamaah;
drop policy if exists "Auth insert pembayaran_jamaah"  on pembayaran_jamaah;
drop policy if exists "Allow update pembayaran_jamaah" on pembayaran_jamaah;
drop policy if exists "Auth update pembayaran_jamaah"  on pembayaran_jamaah;
drop policy if exists "Allow delete pembayaran_jamaah" on pembayaran_jamaah;
drop policy if exists "Auth delete pembayaran_jamaah"  on pembayaran_jamaah;
create policy "Pub read pembayaran_jamaah" on pembayaran_jamaah for select using (true);
create policy "Auth insert pembayaran_jamaah" on pembayaran_jamaah for insert with check (auth.role() = 'authenticated');
create policy "Auth update pembayaran_jamaah" on pembayaran_jamaah for update using (auth.role() = 'authenticated');
create policy "Auth delete pembayaran_jamaah" on pembayaran_jamaah for delete using (auth.role() = 'authenticated');

create sequence if not exists nota_nomor_seq start 1;
alter table pembayaran_jamaah add column if not exists nomor_nota text;
create unique index if not exists idx_pembayaran_jamaah_nomor_nota on pembayaran_jamaah (nomor_nota);

create or replace function set_nomor_nota() returns trigger as $$
begin
    if new.nomor_nota is null or new.nomor_nota = '' then
        new.nomor_nota := 'AHI/' || to_char(coalesce(new.tanggal, current_date), 'YYYY')
            || '/' || lpad(nextval('nota_nomor_seq')::text, 6, '0');
    end if;
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_nomor_nota on pembayaran_jamaah;
create trigger trg_set_nomor_nota
    before insert on pembayaran_jamaah
    for each row execute function set_nomor_nota();

create or replace function lindungi_nomor_nota() returns trigger as $$
begin
    if old.nomor_nota is not null and new.nomor_nota is distinct from old.nomor_nota then
        raise exception 'nomor_nota tidak boleh diubah setelah diterbitkan';
    end if;
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_lindungi_nomor_nota on pembayaran_jamaah;
create trigger trg_lindungi_nomor_nota
    before update on pembayaran_jamaah
    for each row execute function lindungi_nomor_nota();

with belum_bernomor as (
    select id, tanggal,
           row_number() over (order by tanggal asc, created_at asc) as urutan
    from pembayaran_jamaah
    where nomor_nota is null or nomor_nota = ''
)
update pembayaran_jamaah p
set nomor_nota = 'AHI/' || to_char(coalesce(b.tanggal, current_date), 'YYYY')
    || '/' || lpad(nextval('nota_nomor_seq')::text, 6, '0')
from belum_bernomor b
where p.id = b.id;

create table if not exists nota_audit_log (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    nomor_nota text not null,
    jenis text not null check (jenis in ('pembayaran', 'riwayat')),
    jamaah_id uuid,
    jamaah_nama text,
    program_nama text,
    jumlah numeric,
    dicetak_oleh_role text,
    dicetak_oleh_nama text,
    kode_verifikasi text not null,
    hash_konten text not null,
    metadata jsonb
);
create index if not exists idx_nota_audit_log_nomor_nota on nota_audit_log (nomor_nota);
create index if not exists idx_nota_audit_log_kode_verifikasi on nota_audit_log (kode_verifikasi);
create index if not exists idx_nota_audit_log_created_at on nota_audit_log (created_at desc);

alter table nota_audit_log enable row level security;
drop policy if exists "Allow read nota_audit_log"   on nota_audit_log;
drop policy if exists "Auth read nota_audit_log"    on nota_audit_log;
drop policy if exists "Pub read nota_audit_log"     on nota_audit_log;
drop policy if exists "Allow insert nota_audit_log" on nota_audit_log;
drop policy if exists "Auth insert nota_audit_log"  on nota_audit_log;
create policy "Pub read nota_audit_log" on nota_audit_log for select using (true);
create policy "Auth insert nota_audit_log" on nota_audit_log for insert with check (auth.role() = 'authenticated');

create or replace function blokir_ubah_nota_audit_log() returns trigger as $$
begin
    raise exception 'nota_audit_log bersifat append-only — baris yang sudah tercatat tidak boleh diubah atau dihapus';
end;
$$ language plpgsql;

drop trigger if exists trg_blokir_update_nota_audit_log on nota_audit_log;
create trigger trg_blokir_update_nota_audit_log
    before update on nota_audit_log
    for each row execute function blokir_ubah_nota_audit_log();

drop trigger if exists trg_blokir_delete_nota_audit_log on nota_audit_log;
create trigger trg_blokir_delete_nota_audit_log
    before delete on nota_audit_log
    for each row execute function blokir_ubah_nota_audit_log();

-- ============================================================================
-- 9. SNAPSHOT_BACKUP
-- ============================================================================
create table if not exists snapshot_backup (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    label text not null default 'Snapshot',
    trigger text not null default 'manual',
    data jsonb not null,
    meta jsonb default '{}'::jsonb
);
create index if not exists idx_snapshot_backup_created_at on snapshot_backup (created_at desc);

alter table snapshot_backup enable row level security;
drop policy if exists "Allow read snapshot_backup"   on snapshot_backup;
drop policy if exists "Auth read snapshot_backup"    on snapshot_backup;
drop policy if exists "Pub read snapshot_backup"     on snapshot_backup;
drop policy if exists "Allow insert snapshot_backup" on snapshot_backup;
drop policy if exists "Auth insert snapshot_backup"  on snapshot_backup;
drop policy if exists "Allow delete snapshot_backup" on snapshot_backup;
drop policy if exists "Auth delete snapshot_backup"  on snapshot_backup;
create policy "Pub read snapshot_backup" on snapshot_backup for select using (true);
create policy "Auth insert snapshot_backup" on snapshot_backup for insert with check (auth.role() = 'authenticated');
create policy "Auth delete snapshot_backup" on snapshot_backup for delete using (auth.role() = 'authenticated');

-- ============================================================================
-- 10. RPC AUTH
-- ============================================================================
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

create or replace function set_admin_password(p_key text, p_val text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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

-- ============================================================================
-- 11. RATE-LIMIT LOGIN
-- ============================================================================
create table if not exists login_rate_limit (
    ident text primary key,
    attempts int not null default 0,
    first_at timestamptz not null default now(),
    blocked_until timestamptz
);

create or replace function check_login_rate_limit(p_ident text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  select * into v from login_rate_limit where ident = p_ident;
  if v is not null and v.blocked_until is not null and v.blocked_until > now() then
    return false;
  end if;
  if v is null or v.first_at < now() - interval '1 minute' then
    insert into login_rate_limit (ident, attempts, first_at, blocked_until)
      values (p_ident, 0, now(), null)
      on conflict (ident) do update set attempts = 0, first_at = now(), blocked_until = null;
    return true;
  end if;
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
grant execute on function verify_dashboard_password(text) to anon, authenticated;
grant execute on function set_admin_password(text, text) to anon, authenticated;

-- ============================================================================
-- SELESAI.
--  - Ganti password default:
--      update app_config set value='...' where key='pass_administrator';
--  - Samakan SUPABASE_URL & ANON_KEY di js/app.js dengan project ini.
--  - Deploy edge function login-dashboard + import JWT Signing Key.
-- ============================================================================
