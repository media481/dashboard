-- ============================================================================
--  SETUP LENGKAP DASHBOARD AMIRU — 1 FILE, BEBAS URUTAN (v3, idempoten penuh)
-- ============================================================================
--  Cara pakai:
--    1. Buka Supabase Dashboard -> SQL Editor -> New Query.
--    2. Paste SELURUH isi file ini.
--    3. Klik Run (Ctrl/Cmd+Enter).
--    4. Selesai. TIDAK perlu menjalankan file SQL lainnya (lihat "TIDAK
--       termasuk" di bawah untuk 3 pengecualian).
--
--  File ini adalah KONDISI AKHIR dari migrasi sql/01 s.d. sql/56, dengan
--  kebijakan RLS FINAL langsung tertanam:
--    - 01-17, 19-27 : tabel inti, kolom tambahan, nota/kuitansi, audit log,
--                     RPC auth lama, rate-limit login, hardening RLS
--    - 28-36        : Supabase Auth (dashboard_profiles), role guest read-only,
--                     kelola user, last login, proteksi admin terakhir,
--                     akses menu per role & per user, Assets (admin-only tulis)
--    - 37-38, 54    : hotel_saudi_arabia (+ RPC import), hotel_detail
--    - 41-51, 56    : IG Scheduler (akun, post, carousel, log, komentar,
--                     content planner, rencana tahunan, tasklist, policy storage)
--    - 52-53, 55    : rekap_program_items & infografis_items (baca publik)
--
--  TIDAK termasuk (sengaja, bukan skema):
--    - sql/18  : konversi DATA pendaftaran lama (baru -> deal). Hanya perlu di
--                database lama yang punya baris status 'baru'.
--    - sql/39 & sql/40 : ISI data hotel Arab Saudi. Tabelnya dibuat di sini;
--                untuk mengisi, jalankan sql/40_update_hotel_saudi_arabia_2026_10.sql
--                (versi terbaru) setelah file ini.
--    - Bucket Storage `ig-media` dibuat manual di Dashboard -> Storage
--                (public). Policy hapus file-nya ada di bagian 18 di bawah.
--
--  IDEMPOTEN PENUH: untuk setiap tabel, SEMUA policy lama (nama apa pun —
--  "Allow ...", "Auth ...", "Pub read ...", "Admin/User ...", dst) dihapus
--  lewat helper _setup_drop_policies() lalu dibuat ulang sesuai kebijakan
--  final. Jadi aman dijalankan berulang, baik di project kosong maupun di
--  project yang SUDAH pernah menjalankan migrasi apa pun (tidak akan error
--  "policy already exists", dan tidak ada policy lama yang longgar tersisa).
--  CATATAN: policy buatan manual di Dashboard pada tabel-tabel di bawah ikut
--  terhapus saat file ini dijalankan.
--  Kolom yang ditambahkan migrasi dibuat dua kali (di CREATE TABLE untuk
--  project baru + ALTER TABLE ... ADD COLUMN IF NOT EXISTS untuk project lama),
--  jadi menjalankan file ini di project lama otomatis menyusulkan kolom baru.
--
--  ===========================================================================
--  MODEL KEAMANAN (WAJIB DIBACA)
--  ===========================================================================
--  * Login memakai Supabase Auth (signInWithPassword). Role dashboard
--    (admin / user / guest) disimpan di dashboard_profiles dan dibaca RLS lewat
--    current_dashboard_role().
--  * WRITE tabel inti = role 'admin' & 'user' saja (guest read-only di level DB).
--    Pengecualian: DELETE programs & pembayaran_jamaah = admin saja; tabel
--    assets = tulis admin saja; ig_accounts tidak bisa ditulis client.
--  * READ: tabel inti (programs, kb_jamaah, pendaftaran, dst) masih PUBLIK
--    (true) agar halaman depan bisa menampilkan data tanpa login;
--    pembayaran_jamaah, assets, hotel_*, role/user_menu_access = authenticated;
--    tabel IG = admin/user saja.
--  * app_config (password lama) tertutup total untuk anon. RPC login lama
--    (verify_dashboard_password, set_admin_password) sudah DICABUT dari
--    anon/authenticated (hanya service_role / Edge Function login-dashboard).
--  * PERINGATAN (sama seperti sebelumnya): tg_config (bot token) &
--    snapshot_backup masih publik-read, dan kb_jamaah/pendaftaran (berisi
--    NIK/KTP/paspor) juga publik-read. Kunci ke authenticated bila mau lebih aman.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Helper sementara: hapus SEMUA policy sebuah tabel (dipakai tiap bagian di
-- bawah supaya idempoten). Fungsi ini dihapus lagi di akhir file.
-- ----------------------------------------------------------------------------
create or replace function _setup_drop_policies(p_table text) returns void
language plpgsql as $$
declare
    pol record;
begin
    for pol in
        select policyname from pg_policies
        where schemaname = 'public' and tablename = p_table
    loop
        execute format('drop policy %I on public.%I', pol.policyname, p_table);
    end loop;
end;
$$;

-- ============================================================================
-- 1. DASHBOARD_PROFILES + current_dashboard_role()  (Supabase Auth; sql/28-32)
--    Dibuat paling awal karena dipakai policy semua tabel lain.
-- ============================================================================
create table if not exists dashboard_profiles (
    id             uuid primary key references auth.users(id) on delete cascade,
    dashboard_role text not null check (dashboard_role in ('admin','user','guest')),
    label          text not null,
    created_at     timestamptz not null default now()
);
alter table dashboard_profiles add column if not exists email text;
alter table dashboard_profiles add column if not exists last_login timestamptz;

-- Backfill email yang kosong (akun lama dibuat sebelum kolom email ada)
update dashboard_profiles dp
set email = au.email
from auth.users au
where dp.id = au.id
  and (dp.email is null or dp.email = '');

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

-- Catat "terakhir login" (hanya baris milik sendiri, lewat RPC)
create or replace function update_last_login()
returns void
language sql
security definer
set search_path = public
as $$
    update dashboard_profiles set last_login = now() where id = auth.uid();
$$;
grant execute on function update_last_login() to authenticated;

-- Proteksi: admin terakhir tidak boleh dihapus / diturunkan rolenya
create or replace function prevent_last_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    remaining_admins int;
begin
    if (tg_op = 'DELETE' and old.dashboard_role = 'admin')
       or (tg_op = 'UPDATE' and old.dashboard_role = 'admin' and new.dashboard_role <> 'admin') then
        select count(*) into remaining_admins
        from dashboard_profiles
        where dashboard_role = 'admin' and id <> old.id;

        if remaining_admins = 0 then
            raise exception 'Tidak bisa menghapus/menurunkan role admin terakhir. Sistem wajib punya minimal 1 admin. Tambahkan admin lain dulu sebelum mengubah akun ini.';
        end if;
    end if;

    if tg_op = 'DELETE' then
        return old;
    else
        return new;
    end if;
end;
$$;

drop trigger if exists trg_prevent_last_admin_removal on dashboard_profiles;
create trigger trg_prevent_last_admin_removal
    before update or delete on dashboard_profiles
    for each row execute function prevent_last_admin_removal();

alter table dashboard_profiles enable row level security;
select _setup_drop_policies('dashboard_profiles');
create policy "Read own profile" on dashboard_profiles
    for select using (auth.uid() = id);
create policy "Admin read all profiles" on dashboard_profiles
    for select using (current_dashboard_role() = 'admin');
-- insert/update/delete hanya lewat service role (scripts/setup-auth-accounts.mjs,
-- Edge Function admin-create-user / admin-change-password)
create policy "No client write profile" on dashboard_profiles
    for all using (false) with check (false);

-- ============================================================================
-- 2. PROGRAMS
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
    status_kepulangan text not null default 'belum_berangkat',
    tgl_berangkat_aktual date,
    tgl_pulang_aktual date,
    kuota_pax integer not null default 45,
    created_at timestamptz not null default now()
);
create index if not exists idx_programs_created_at on programs (created_at desc);
create index if not exists idx_programs_is_active on programs (is_active);

alter table programs add column if not exists status_kepulangan text not null default 'belum_berangkat';
alter table programs add column if not exists tgl_berangkat_aktual date;
alter table programs add column if not exists tgl_pulang_aktual date;
alter table programs add column if not exists kuota_pax integer not null default 45;
alter table programs drop constraint if exists programs_kuota_pax_check;
alter table programs add constraint programs_kuota_pax_check check (kuota_pax > 0);
comment on column programs.kuota_pax is
    'Jumlah kuota pax/kursi program ini (default 45). Dipakai untuk status "terisi/kuota" di tabel Program Umroh.';

alter table programs enable row level security;
select _setup_drop_policies('programs');
create policy "Pub read programs" on programs for select using (true);
create policy "Admin/User insert programs" on programs for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update programs" on programs for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin delete programs"      on programs for delete using (current_dashboard_role() = 'admin');

-- ============================================================================
-- 3. JADWAL_TAMU
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
select _setup_drop_policies('jadwal_tamu');
create policy "Pub read jadwal_tamu" on jadwal_tamu for select using (true);
create policy "Admin/User insert jadwal_tamu" on jadwal_tamu for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update jadwal_tamu" on jadwal_tamu for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete jadwal_tamu" on jadwal_tamu for delete using (current_dashboard_role() in ('admin','user'));

-- ============================================================================
-- 4. PENDAFTARAN  (dibuat sebelum kb_jamaah karena kb_jamaah.pendaftaran_id
--    mereferensikannya)
-- ============================================================================
create table if not exists pendaftaran (
    id uuid primary key default gen_random_uuid(),
    program_id uuid references programs(id) on delete set null,
    nama text not null,
    wa text,
    asal text,
    status text not null default 'baru',
    catatan text,
    tanggal_daftar date,
    ktp text,
    jenis_kelamin text,
    tempat_lahir text,
    tgl_lahir date,
    alamat text,
    kode_pos text,
    telp_rumah text,
    ahli_waris_nama text,
    ahli_waris_hubungan text,
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
select _setup_drop_policies('pendaftaran');
create policy "Pub read pendaftaran" on pendaftaran for select using (true);
create policy "Admin/User insert pendaftaran" on pendaftaran for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update pendaftaran" on pendaftaran for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete pendaftaran" on pendaftaran for delete using (current_dashboard_role() in ('admin','user'));

-- ============================================================================
-- 5. KB_JAMAAH
--    status_kepulangan / tgl_*_aktual NULL = ikut status/tanggal program.
--    diarsipkan = true -> jamaah sudah pulang & diarsipkan (tanpa un-arsip).
-- ============================================================================
create table if not exists kb_jamaah (
    id uuid primary key default gen_random_uuid(),
    program_id uuid references programs(id) on delete cascade,
    nama text not null,
    nik text,
    paspor text,
    wa text,
    asal text,
    tipe_kamar text not null default 'quad',
    harga_custom text,
    status text,
    catatan text,
    dokumen jsonb not null default '{}'::jsonb,
    jenis_kelamin text,
    tempat_lahir text,
    tgl_lahir date,
    alamat text,
    kode_pos text,
    telp_rumah text,
    ahli_waris_nama text,
    ahli_waris_hubungan text,
    pendaftaran_id uuid references pendaftaran(id) on delete set null,
    nomor_kamar integer,
    paspor_exp date,
    visa_status text default 'belum_diajukan',
    status_kepulangan text,
    tgl_berangkat_aktual date,
    tgl_pulang_aktual date,
    catatan_kepulangan text,
    diarsipkan boolean not null default false,
    diarsipkan_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists idx_kb_jamaah_program_id on kb_jamaah (program_id);
create index if not exists idx_kb_jamaah_nama on kb_jamaah (nama);

alter table kb_jamaah add column if not exists dokumen jsonb not null default '{}'::jsonb;
alter table kb_jamaah add column if not exists tipe_kamar text not null default 'quad';
alter table kb_jamaah add column if not exists harga_custom text;
alter table kb_jamaah add column if not exists jenis_kelamin text;
alter table kb_jamaah add column if not exists tempat_lahir text;
alter table kb_jamaah add column if not exists tgl_lahir date;
alter table kb_jamaah add column if not exists alamat text;
alter table kb_jamaah add column if not exists kode_pos text;
alter table kb_jamaah add column if not exists telp_rumah text;
alter table kb_jamaah add column if not exists ahli_waris_nama text;
alter table kb_jamaah add column if not exists ahli_waris_hubungan text;
alter table kb_jamaah add column if not exists pendaftaran_id uuid references pendaftaran(id) on delete set null;
alter table kb_jamaah add column if not exists nomor_kamar integer;
alter table kb_jamaah add column if not exists paspor_exp date;
alter table kb_jamaah add column if not exists visa_status text default 'belum_diajukan';
alter table kb_jamaah add column if not exists status_kepulangan text;
alter table kb_jamaah add column if not exists tgl_berangkat_aktual date;
alter table kb_jamaah add column if not exists tgl_pulang_aktual date;
alter table kb_jamaah add column if not exists catatan_kepulangan text;
alter table kb_jamaah add column if not exists diarsipkan boolean not null default false;
alter table kb_jamaah add column if not exists diarsipkan_at timestamptz;

alter table kb_jamaah drop constraint if exists kb_jamaah_tipe_kamar_check;
alter table kb_jamaah add constraint kb_jamaah_tipe_kamar_check
    check (tipe_kamar in ('quad', 'triple', 'double'));

create index if not exists idx_kb_jamaah_pendaftaran_id on kb_jamaah (pendaftaran_id);
create index if not exists idx_kb_jamaah_diarsipkan on kb_jamaah (diarsipkan);

comment on column kb_jamaah.tipe_kamar is
    'Tipe kamar yang diambil jamaah (quad/triple/double) — menentukan harga acuan tagihan dari harga_quad/harga_triple/harga_double di tabel programs. Default quad = perilaku lama (pakai harga_quint/harga_quad).';
comment on column kb_jamaah.harga_custom is
    'Harga khusus/nego per jamaah (opsional). Kalau diisi, dipakai sebagai acuan tagihan menggantikan harga tipe_kamar.';
comment on column kb_jamaah.diarsipkan is
    'true = jamaah sudah pulang & diarsipkan (sekali arsip, tidak bisa di-unarsip). Semua query alur kerja utama HARUS filter diarsipkan=false.';
comment on column kb_jamaah.diarsipkan_at is
    'Waktu jamaah ini diarsipkan lewat tombol "Arsipkan Semua".';

alter table kb_jamaah enable row level security;
select _setup_drop_policies('kb_jamaah');
create policy "Pub read kb_jamaah" on kb_jamaah for select using (true);
create policy "Admin/User insert kb_jamaah" on kb_jamaah for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update kb_jamaah" on kb_jamaah for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete kb_jamaah" on kb_jamaah for delete using (current_dashboard_role() in ('admin','user'));

-- ============================================================================
-- 6. FEATURED_PROGRAMS
-- ============================================================================
create table if not exists featured_programs (
    id uuid primary key default gen_random_uuid(),
    program_id uuid not null references programs(id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (program_id)
);

alter table featured_programs enable row level security;
select _setup_drop_policies('featured_programs');
create policy "Pub read featured_programs" on featured_programs for select using (true);
create policy "Admin/User insert featured_programs" on featured_programs for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete featured_programs" on featured_programs for delete using (current_dashboard_role() in ('admin','user'));

-- ============================================================================
-- 7. APP_CONFIG  (password jalur LAMA — TERTUTUP total untuk anon)
--    Login sekarang lewat Supabase Auth; tabel ini hanya dibaca Edge Function
--    login-dashboard (service role) selama masa transisi.
-- ============================================================================
create table if not exists app_config (
    key text primary key,
    value text,
    updated_at timestamptz not null default now()
);

alter table app_config enable row level security;
select _setup_drop_policies('app_config');
create policy "No anon read app_config"  on app_config for select using (false);
create policy "No anon write app_config" on app_config for all    using (false) with check (false);

insert into app_config (key, value) values
    ('pass_administrator', 'ganti-password-admin'),
    ('pass_cs', 'ganti-password-cs')
on conflict (key) do nothing;

-- ============================================================================
-- 8. TG_CONFIG
-- ============================================================================
create table if not exists tg_config (
    key text primary key,
    value text,
    updated_at timestamptz not null default now()
);

alter table tg_config enable row level security;
select _setup_drop_policies('tg_config');
create policy "Pub read tg_config" on tg_config for select using (true);
create policy "Admin/User upsert tg_config" on tg_config for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update tg_config" on tg_config for update using (current_dashboard_role() in ('admin','user'));

-- ============================================================================
-- 9. KWT_KUITANSI
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
select _setup_drop_policies('kwt_kuitansi');
create policy "Pub read kwt_kuitansi" on kwt_kuitansi for select using (true);
create policy "Admin/User insert kwt_kuitansi" on kwt_kuitansi for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete kwt_kuitansi" on kwt_kuitansi for delete using (current_dashboard_role() in ('admin','user'));

-- ============================================================================
-- 10. PEMBAYARAN_JAMAAH  (+ nomor_nota, nomor_kuitansi, trigger pelindung)
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
select _setup_drop_policies('pembayaran_jamaah');
-- SELECT dikunci ke user login (sql/27); hapus = admin saja (sql/28)
create policy "Auth read pembayaran_jamaah" on pembayaran_jamaah for select using (auth.role() = 'authenticated');
create policy "Admin/User insert pembayaran_jamaah" on pembayaran_jamaah for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update pembayaran_jamaah" on pembayaran_jamaah for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin delete pembayaran_jamaah" on pembayaran_jamaah for delete using (current_dashboard_role() = 'admin');

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

-- Backfill nomor_nota untuk data lama (hanya baris yang masih kosong)
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

-- Nomor KUITANSI (jamaah lunas) — seri terpisah AHI/KWT/<tahun>/<6 digit>,
-- disimpan permanen di baris pembayaran terkait (sql/23)
alter table pembayaran_jamaah add column if not exists nomor_kuitansi text;
create unique index if not exists idx_pembayaran_jamaah_nomor_kuitansi
    on pembayaran_jamaah (nomor_kuitansi) where nomor_kuitansi is not null;

create or replace function lindungi_nomor_kuitansi() returns trigger as $$
begin
    if old.nomor_kuitansi is not null and new.nomor_kuitansi is distinct from old.nomor_kuitansi then
        raise exception 'nomor_kuitansi tidak boleh diubah setelah diterbitkan';
    end if;
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_lindungi_nomor_kuitansi on pembayaran_jamaah;
create trigger trg_lindungi_nomor_kuitansi
    before update on pembayaran_jamaah
    for each row execute function lindungi_nomor_kuitansi();

-- ============================================================================
-- 11. NOTA_AUDIT_LOG  (ledger append-only)
-- ============================================================================
create table if not exists nota_audit_log (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    nomor_nota text not null,
    jenis text not null,
    jamaah_id uuid,
    jamaah_nama text,
    program_nama text,
    jumlah numeric,
    dicetak_oleh_role text,
    dicetak_oleh_nama text,
    dicetak_oleh_label text,
    kode_verifikasi text not null,
    hash_konten text not null,
    metadata jsonb
);
alter table nota_audit_log add column if not exists dicetak_oleh_label text;
alter table nota_audit_log drop constraint if exists nota_audit_log_jenis_check;
alter table nota_audit_log add constraint nota_audit_log_jenis_check
    check (jenis in ('pembayaran', 'riwayat', 'kuitansi'));

create index if not exists idx_nota_audit_log_nomor_nota on nota_audit_log (nomor_nota);
create index if not exists idx_nota_audit_log_kode_verifikasi on nota_audit_log (kode_verifikasi);
create index if not exists idx_nota_audit_log_created_at on nota_audit_log (created_at desc);

alter table nota_audit_log enable row level security;
select _setup_drop_policies('nota_audit_log');
create policy "Pub read nota_audit_log" on nota_audit_log for select using (true);
create policy "Admin/User insert nota_audit_log" on nota_audit_log for insert with check (current_dashboard_role() in ('admin','user'));

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
-- 12. JAMAAH_AUDIT_LOG  (riwayat aktivitas per jamaah, append-only; sql/24)
--     CATATAN: sama seperti sql/24, policy INSERT-nya masih terbuka (true) —
--     belum ikut dikunci ke admin/user di sql/26/29. UPDATE/DELETE tetap
--     diblokir trigger.
-- ============================================================================
create table if not exists jamaah_audit_log (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    jamaah_id uuid,
    jamaah_nama text,
    aksi text not null,
    field text,
    nilai_lama text,
    nilai_baru text,
    actor_role text,
    actor_nama text
);
create index if not exists idx_jamaah_audit_log_jamaah_id on jamaah_audit_log (jamaah_id);
create index if not exists idx_jamaah_audit_log_created_at on jamaah_audit_log (created_at desc);

alter table jamaah_audit_log enable row level security;
select _setup_drop_policies('jamaah_audit_log');
create policy "Allow read jamaah_audit_log"   on jamaah_audit_log for select using (true);
create policy "Allow insert jamaah_audit_log" on jamaah_audit_log for insert with check (true);

create or replace function blokir_ubah_jamaah_audit_log() returns trigger as $$
begin
    raise exception 'jamaah_audit_log bersifat append-only — baris yang sudah tercatat tidak boleh diubah atau dihapus';
end;
$$ language plpgsql;

drop trigger if exists trg_blokir_update_jamaah_audit_log on jamaah_audit_log;
create trigger trg_blokir_update_jamaah_audit_log
    before update on jamaah_audit_log
    for each row execute function blokir_ubah_jamaah_audit_log();

drop trigger if exists trg_blokir_delete_jamaah_audit_log on jamaah_audit_log;
create trigger trg_blokir_delete_jamaah_audit_log
    before delete on jamaah_audit_log
    for each row execute function blokir_ubah_jamaah_audit_log();

-- ============================================================================
-- 13. SNAPSHOT_BACKUP
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
select _setup_drop_policies('snapshot_backup');
create policy "Pub read snapshot_backup" on snapshot_backup for select using (true);
create policy "Admin/User insert snapshot_backup" on snapshot_backup for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete snapshot_backup" on snapshot_backup for delete using (current_dashboard_role() in ('admin','user'));

-- ============================================================================
-- 14. RPC AUTH LAMA + RATE-LIMIT LOGIN
--     verify_dashboard_password / set_admin_password sudah DICABUT dari
--     anon & authenticated (sql/28) — hanya service_role (Edge Function
--     login-dashboard) yang masih bisa memanggilnya selama masa transisi.
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

revoke all on function verify_dashboard_password(text) from public, anon, authenticated;
revoke all on function set_admin_password(text, text) from public, anon, authenticated;
grant execute on function verify_dashboard_password(text) to service_role;
grant execute on function set_admin_password(text, text) to service_role;

create table if not exists login_rate_limit (
    ident text primary key,
    attempts int not null default 0,
    first_at timestamptz not null default now(),
    blocked_until timestamptz
);
-- Hanya diakses lewat RPC SECURITY DEFINER di bawah / service role —
-- RLS aktif tanpa policy = tertutup untuk client langsung.
alter table login_rate_limit enable row level security;

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

-- ============================================================================
-- 15. NOMOR KUITANSI OTOMATIS (sequence + RPC)
-- ============================================================================
create sequence if not exists kuitansi_nomor_seq start 1;

create or replace function next_kuitansi_nomor()
returns text
language plpgsql
security definer
as $$
declare
    v_nomor text;
begin
    v_nomor := 'AHI/KWT/' || to_char(current_date, 'YYYY') || '/' || lpad(nextval('kuitansi_nomor_seq')::text, 6, '0');
    return v_nomor;
end;
$$;

grant execute on function next_kuitansi_nomor() to anon, authenticated;

-- ============================================================================
-- 16. AKSES MENU SIDEBAR: per ROLE (sql/33) & per USER (sql/34)
--     Admin selalu penuh (dihardcode di app.js), jadi tidak ada baris 'admin'.
--     Menu yang belum punya baris dianggap TIDAK diizinkan untuk user/guest
--     sampai Admin mengaturnya di Userman > Akses Menu Sidebar.
-- ============================================================================
create table if not exists role_menu_access (
    role text not null check (role in ('user', 'guest')),
    menu_key text not null,
    allowed boolean not null default false,
    updated_at timestamptz not null default now(),
    primary key (role, menu_key)
);

alter table role_menu_access enable row level security;
select _setup_drop_policies('role_menu_access');
create policy "Auth read role_menu_access"   on role_menu_access for select using (auth.role() = 'authenticated');
create policy "Auth upsert role_menu_access" on role_menu_access for insert with check (auth.role() = 'authenticated');
create policy "Auth update role_menu_access" on role_menu_access for update using (auth.role() = 'authenticated');
create policy "Auth delete role_menu_access" on role_menu_access for delete using (auth.role() = 'authenticated');

insert into role_menu_access (role, menu_key, allowed) values
    ('user', 'info', true),
    ('user', 'pendaftaran', true),
    ('user', 'keberangkatan', true),
    ('user', 'dokumen', true),
    ('user', 'arsip', true),
    ('user', 'program', false),
    ('user', 'pembayaran', false),
    ('user', 'unggulan', false),
    ('user', 'auditnota', false),
    ('user', 'assets', false),
    ('user', 'crosscheck', false),
    ('user', 'telegram', false),
    ('user', 'usersettings', false),
    ('user', 'snapshot', false),
    ('user', 'profil', false),
    ('guest', 'info', true),
    ('guest', 'pendaftaran', true),
    ('guest', 'keberangkatan', true),
    ('guest', 'dokumen', true),
    ('guest', 'arsip', true),
    ('guest', 'program', false),
    ('guest', 'pembayaran', false),
    ('guest', 'unggulan', false),
    ('guest', 'auditnota', false),
    ('guest', 'assets', false),
    ('guest', 'crosscheck', false),
    ('guest', 'telegram', false),
    ('guest', 'usersettings', false),
    ('guest', 'snapshot', false),
    ('guest', 'profil', false)
on conflict (role, menu_key) do nothing;

create table if not exists user_menu_access (
    user_id    uuid not null references auth.users(id) on delete cascade,
    menu_key   text not null,
    allowed    boolean not null default false,
    updated_at timestamptz not null default now(),
    primary key (user_id, menu_key)
);

alter table user_menu_access enable row level security;
select _setup_drop_policies('user_menu_access');
create policy "Auth read user_menu_access"   on user_menu_access for select using (auth.role() = 'authenticated');
create policy "Auth upsert user_menu_access" on user_menu_access for insert with check (auth.role() = 'authenticated');
create policy "Auth update user_menu_access" on user_menu_access for update using (auth.role() = 'authenticated');
create policy "Auth delete user_menu_access" on user_menu_access for delete using (auth.role() = 'authenticated');

-- ============================================================================
-- 17. ASSETS (sql/35-36), HOTEL_SAUDI_ARABIA (sql/37-38), HOTEL_DETAIL (sql/54)
-- ============================================================================
-- 17a. assets — baca: semua yang login; tulis: ADMIN saja
create table if not exists assets (
    id uuid primary key default gen_random_uuid(),
    judul text not null,
    url text not null,
    kategori text,
    catatan text,
    created_at timestamptz not null default now()
);
create index if not exists idx_assets_kategori on assets (kategori);

alter table assets enable row level security;
select _setup_drop_policies('assets');
create policy "Auth read assets" on assets for select using (auth.role() = 'authenticated');
create policy "Admin only insert assets" on assets for insert with check (current_dashboard_role() = 'admin');
create policy "Admin only update assets" on assets for update using (current_dashboard_role() = 'admin');
create policy "Admin only delete assets" on assets for delete using (current_dashboard_role() = 'admin');

-- 17b. hotel_saudi_arabia — referensi read-only; diisi lewat RPC import / SQL
--      (isi data: sql/40_update_hotel_saudi_arabia_2026_10.sql)
create table if not exists hotel_saudi_arabia (
    id bigserial primary key,
    hotel_name text not null,
    description text,
    review_count integer,
    score numeric(3,1),
    country text,
    city text,
    created_at timestamptz not null default now()
);
create index if not exists idx_hotel_saudi_arabia_city on hotel_saudi_arabia (city);
create index if not exists idx_hotel_saudi_arabia_score on hotel_saudi_arabia (score);

alter table hotel_saudi_arabia enable row level security;
select _setup_drop_policies('hotel_saudi_arabia');
create policy "Auth read hotel_saudi_arabia" on hotel_saudi_arabia
    for select using (auth.role() = 'authenticated');
-- Sengaja TANPA policy insert/update/delete: tulis hanya lewat RPC di bawah.

create or replace function replace_hotel_saudi_arabia(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if current_dashboard_role() is distinct from 'admin' then
    raise exception 'Hanya Admin yang boleh mengimpor data hotel' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Data CSV kosong -- import dibatalkan, data lama tidak diubah' using errcode = '22023';
  end if;

  delete from hotel_saudi_arabia where true;
  perform setval(pg_get_serial_sequence('hotel_saudi_arabia', 'id'), 1, false);

  insert into hotel_saudi_arabia (hotel_name, description, review_count, score, country, city)
  select
    trim(t.hotel_name),
    nullif(trim(t.description), ''),
    t.review_count,
    t.score,
    coalesce(nullif(trim(t.country), ''), 'Saudi Arabia'),
    lower(trim(t.city))
  from jsonb_to_recordset(p_rows) as t(
    hotel_name text, description text, review_count integer,
    score numeric, country text, city text
  )
  where nullif(trim(t.hotel_name), '') is not null
    and nullif(trim(t.city), '') is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function replace_hotel_saudi_arabia(jsonb) from public, anon;
grant execute on function replace_hotel_saudi_arabia(jsonb) to authenticated;

-- 17c. hotel_detail — pustaka jarak/menit jalan kaki per nama hotel
create table if not exists hotel_detail (
    id bigserial primary key,
    hotel_key text not null unique,   -- nama hotel ter-normalisasi
    hotel_name text not null,
    kota text,
    jarak_text text not null,         -- mis. "550m 7 menit jalan kaki"
    updated_at timestamptz not null default now()
);

alter table hotel_detail enable row level security;
select _setup_drop_policies('hotel_detail');
create policy "Auth read hotel_detail" on hotel_detail for select using (auth.role() = 'authenticated');
create policy "Admin/User insert hotel_detail" on hotel_detail for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update hotel_detail" on hotel_detail for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin delete hotel_detail" on hotel_detail for delete using (current_dashboard_role() = 'admin');

-- ============================================================================
-- 18. IG SCHEDULER (sql/41-51, 56)
--     Policy = admin/user saja (guest tidak bisa baca/tulis). Edge Function
--     memakai service_role (bypass RLS).
-- ============================================================================
do $$
begin
    if not exists (select 1 from pg_type where typname = 'ig_account_status') then
        create type ig_account_status as enum ('active', 'inactive', 'expired');
    end if;
    if not exists (select 1 from pg_type where typname = 'post_status') then
        create type post_status as enum ('draft', 'scheduled', 'publishing', 'published', 'failed');
    end if;
    if not exists (select 1 from pg_type where typname = 'post_media_type') then
        create type post_media_type as enum ('image', 'video', 'carousel');
    end if;
    if not exists (select 1 from pg_type where typname = 'content_plan_status') then
        create type content_plan_status as enum ('idea', 'dijadikan_post', 'dilewati');
    end if;
end $$;

-- 18a. ig_accounts — token tidak boleh terbaca client sama sekali
create table if not exists ig_accounts (
    id uuid primary key default gen_random_uuid(),
    ig_user_id text not null,                    -- Instagram Business Account ID
    fb_page_id text not null,                    -- Facebook Page terhubung
    access_token text not null,                  -- long-lived token
    token_expires_at timestamptz not null,
    is_active boolean default true,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);
create index if not exists idx_ig_accounts_is_active on ig_accounts (is_active);

alter table ig_accounts enable row level security;
select _setup_drop_policies('ig_accounts');
create policy "Admin/User read ig_accounts" on ig_accounts
    for select using (current_dashboard_role() in ('admin','user'));
-- Tidak ada policy insert/update/delete untuk client: akun IG diisi lewat SQL
-- Editor, token diperbarui edge function (service_role).

-- Sembunyikan kolom access_token dari role client
revoke select on ig_accounts from anon, authenticated;
grant select (id, ig_user_id, fb_page_id, token_expires_at, is_active, created_at, updated_at)
    on ig_accounts to authenticated;

-- 18b. ig_posts
create table if not exists ig_posts (
    id uuid primary key default gen_random_uuid(),
    caption text,
    media_url text not null,               -- URL publik Supabase Storage (carousel: item pertama)
    media_type post_media_type default 'image',
    schedule_time timestamptz,             -- null jika masih draft tanpa jadwal
    status post_status not null default 'draft',

    ig_container_id text,                  -- hasil step "create container"
    ig_media_id text,                      -- hasil setelah publish sukses
    published_at timestamptz,

    retry_count int not null default 0,
    max_retries int not null default 3,
    last_error text,

    created_at timestamptz default now(),
    updated_at timestamptz default now()
);
create index if not exists idx_ig_posts_status_schedule on ig_posts (status, schedule_time);
create index if not exists idx_ig_posts_created_at on ig_posts (created_at desc);

alter table ig_posts enable row level security;
select _setup_drop_policies('ig_posts');
create policy "Admin/User read ig_posts"   on ig_posts for select using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User insert ig_posts" on ig_posts for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update ig_posts" on ig_posts for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete ig_posts" on ig_posts for delete using (current_dashboard_role() in ('admin','user'));

-- 18c. ig_post_media (item carousel)
create table if not exists ig_post_media (
    id uuid primary key default gen_random_uuid(),
    post_id uuid not null references ig_posts(id) on delete cascade,
    media_url text not null,
    media_type text not null default 'image' check (media_type in ('image', 'video')),
    position int not null default 0,          -- urutan tampil (0-based)
    ig_child_container_id text,
    created_at timestamptz default now()
);
create index if not exists idx_ig_post_media_post_id on ig_post_media (post_id, position);

alter table ig_post_media enable row level security;
select _setup_drop_policies('ig_post_media');
create policy "Admin/User read ig_post_media"   on ig_post_media for select using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User insert ig_post_media" on ig_post_media for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update ig_post_media" on ig_post_media for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete ig_post_media" on ig_post_media for delete using (current_dashboard_role() in ('admin','user'));

-- 18d. ig_publish_logs — client hanya membaca; yang menulis edge function
create table if not exists ig_publish_logs (
    id uuid primary key default gen_random_uuid(),
    post_id uuid references ig_posts(id) on delete cascade,
    attempt_number int not null,
    step text not null,               -- 'create_container' | 'check_status' | 'publish' | 'refresh_token'
    success boolean not null,
    response_body jsonb,
    error_message text,
    created_at timestamptz default now()
);
create index if not exists idx_ig_publish_logs_post_id on ig_publish_logs (post_id);
create index if not exists idx_ig_publish_logs_created_at on ig_publish_logs (created_at desc);

alter table ig_publish_logs enable row level security;
select _setup_drop_policies('ig_publish_logs');
create policy "Admin/User read ig_publish_logs" on ig_publish_logs
    for select using (current_dashboard_role() in ('admin','user'));

-- 18e. ig_comments
create table if not exists ig_comments (
    id uuid primary key default gen_random_uuid(),

    post_id uuid references ig_posts(id) on delete cascade,
    ig_media_id text not null,
    ig_comment_id text not null unique,
    parent_ig_comment_id text,

    username text,
    comment_text text,
    like_count int default 0,
    commented_at timestamptz,

    is_our_reply boolean not null default false,
    hidden boolean not null default false,

    replied boolean not null default false,
    our_reply_text text,
    our_reply_ig_id text,
    replied_at timestamptz,

    synced_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);
create index if not exists idx_ig_comments_post_id on ig_comments (post_id);
create index if not exists idx_ig_comments_ig_media_id on ig_comments (ig_media_id);
create index if not exists idx_ig_comments_unreplied on ig_comments (commented_at desc)
    where is_our_reply = false and replied = false and hidden = false;

alter table ig_comments enable row level security;
select _setup_drop_policies('ig_comments');
create policy "Admin/User read ig_comments"   on ig_comments for select using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User insert ig_comments" on ig_comments for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update ig_comments" on ig_comments for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin delete ig_comments"      on ig_comments for delete using (current_dashboard_role() = 'admin');

-- 18f. ig_content_plan (Content Planner) — pilar, tahap, teks_gambar, tema_minggu, canva_url
create table if not exists ig_content_plan (
    id uuid primary key default gen_random_uuid(),

    bulan date not null,                    -- tanggal 1 bulan rencana (filter per-bulan)
    tanggal date not null,                  -- tanggal disarankan posting
    tema text not null,
    tipe_konten post_media_type default 'image',
    draft_caption text,

    status content_plan_status not null default 'idea',
    ig_post_id uuid references ig_posts(id) on delete set null,

    sumber_program_id uuid references programs(id) on delete set null,

    pilar text,                             -- edukasi/promo/testimoni/manasik/engagement/behind/storytelling/...
    tahap text not null default 'ide',      -- ide -> dikerjakan -> siap
    teks_gambar text,                       -- teks pemancing di gambar/slide
    tema_minggu text,                       -- tema satu pekan (pola 7 hari)
    canva_url text,                         -- link desain Canva

    created_at timestamptz default now(),
    updated_at timestamptz default now()
);
alter table ig_content_plan add column if not exists pilar text;
alter table ig_content_plan add column if not exists tahap text not null default 'ide';
alter table ig_content_plan add column if not exists teks_gambar text;
alter table ig_content_plan add column if not exists tema_minggu text;
alter table ig_content_plan add column if not exists canva_url text;

alter table ig_content_plan drop constraint if exists ig_content_plan_tahap_check;
alter table ig_content_plan add constraint ig_content_plan_tahap_check
    check (tahap in ('ide', 'dikerjakan', 'siap'));

create index if not exists idx_ig_content_plan_bulan on ig_content_plan (bulan);
create index if not exists idx_ig_content_plan_tanggal on ig_content_plan (tanggal);
create index if not exists idx_ig_content_plan_status on ig_content_plan (status);
create index if not exists idx_ig_content_plan_pilar on ig_content_plan (pilar);
create index if not exists idx_ig_content_plan_tema_minggu on ig_content_plan (tema_minggu);

alter table ig_content_plan enable row level security;
select _setup_drop_policies('ig_content_plan');
create policy "Admin/User read ig_content_plan"   on ig_content_plan for select using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User insert ig_content_plan" on ig_content_plan for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update ig_content_plan" on ig_content_plan for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete ig_content_plan" on ig_content_plan for delete using (current_dashboard_role() in ('admin','user'));

create or replace function set_updated_at_ig_content_plan()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_ig_content_plan_updated_at on ig_content_plan;
create trigger trg_ig_content_plan_updated_at
  before update on ig_content_plan
  for each row execute function set_updated_at_ig_content_plan();

-- 18g. ig_rencana_tahunan (satu baris = satu pekan)
create table if not exists ig_rencana_tahunan (
    id uuid primary key default gen_random_uuid(),
    senin date not null unique,
    tema text not null,
    alasan text,
    fokus_program text,
    sumber text not null default 'ai',
    terkunci boolean not null default false,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);
alter table ig_rencana_tahunan drop constraint if exists ig_rencana_tahunan_sumber_check;
alter table ig_rencana_tahunan add constraint ig_rencana_tahunan_sumber_check
    check (sumber in ('ai', 'manual'));

alter table ig_rencana_tahunan enable row level security;
select _setup_drop_policies('ig_rencana_tahunan');
create policy "Admin/User read ig_rencana_tahunan"   on ig_rencana_tahunan for select using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User insert ig_rencana_tahunan" on ig_rencana_tahunan for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update ig_rencana_tahunan" on ig_rencana_tahunan for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete ig_rencana_tahunan" on ig_rencana_tahunan for delete using (current_dashboard_role() in ('admin','user'));

create or replace function set_updated_at_ig_rencana_tahunan()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_ig_rencana_tahunan_updated_at on ig_rencana_tahunan;
create trigger trg_ig_rencana_tahunan_updated_at
  before update on ig_rencana_tahunan
  for each row execute function set_updated_at_ig_rencana_tahunan();

-- 18h. ig_tasklist (hari: 1 = Senin ... 7 = Minggu)
create table if not exists ig_tasklist (
    id uuid primary key default gen_random_uuid(),
    hari smallint not null check (hari between 1 and 7),
    nama text not null,
    urut int not null default 0,
    created_at timestamptz default now()
);
create index if not exists idx_ig_tasklist_hari on ig_tasklist (hari, urut);

alter table ig_tasklist enable row level security;
select _setup_drop_policies('ig_tasklist');
create policy "Admin/User read ig_tasklist"   on ig_tasklist for select using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User insert ig_tasklist" on ig_tasklist for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update ig_tasklist" on ig_tasklist for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete ig_tasklist" on ig_tasklist for delete using (current_dashboard_role() in ('admin','user'));

-- 18i. Storage bucket `ig-media` (dibuat manual, public): admin/user boleh
--      MENGHAPUS file (pembersihan media yatim) — sql/50
drop policy if exists "ig_media_delete_admin_user" on storage.objects;
create policy "ig_media_delete_admin_user" on storage.objects
    for delete to authenticated
    using (bucket_id = 'ig-media' and public.current_dashboard_role() in ('admin','user'));

-- ============================================================================
-- 19. REKAP_PROGRAM_ITEMS & INFOGRAFIS_ITEMS  (cache folder Google Drive)
--     Baca PUBLIK (anon boleh, isinya cuma nama file + URL gambar Drive yang
--     sudah "Anyone with the link"). Tidak ada policy tulis: hanya Edge
--     Function sync-* (service_role) yang menulis.
-- ============================================================================
create table if not exists rekap_program_items (
    id               text primary key,          -- ID file Google Drive
    name             text,
    thumb_url        text,
    full_url         text,
    drive_updated_at timestamptz,
    synced_at        timestamptz default now()
);

alter table rekap_program_items enable row level security;
select _setup_drop_policies('rekap_program_items');
create policy "Public read rekap_program_items" on rekap_program_items
    for select to anon, authenticated using (true);

-- NOTA: sql/55 mengubah policy tabel ini tetapi TIDAK ADA migrasi yang membuat
-- tabelnya — kolom di bawah mengikuti rekap_program_items & query di js/app.js
-- (select id, name, thumb_url, full_url, drive_updated_at).
create table if not exists infografis_items (
    id               text primary key,          -- ID file Google Drive
    name             text,
    thumb_url        text,
    full_url         text,
    drive_updated_at timestamptz,
    synced_at        timestamptz default now()
);

alter table infografis_items enable row level security;
select _setup_drop_policies('infografis_items');
create policy "Public read infografis_items" on infografis_items
    for select to anon, authenticated using (true);

-- ============================================================================
-- Bersihkan helper sementara
-- ============================================================================
drop function if exists _setup_drop_policies(text);

-- ============================================================================
-- SELESAI.
--  - Akun login dibuat lewat Supabase Auth (scripts/setup-auth-accounts.mjs
--    atau menu Pengaturan User). Password lama di app_config hanya untuk
--    Edge Function login-dashboard (jalur transisi):
--      update app_config set value='...' where key='pass_administrator';
--  - Samakan SUPABASE_URL & ANON_KEY di js/app.js dengan project ini.
--  - Buat bucket Storage `ig-media` (public) bila memakai IG Scheduler.
--  - Opsional: isi data hotel lewat sql/40_update_hotel_saudi_arabia_2026_10.sql
--  - Menu sidebar yang belum ada di role_menu_access (todocs, kepulangan,
--    igScheduler, infografis) default-nya TERSEMBUNYI untuk user/guest sampai
--    Admin mengaturnya di Userman > Akses Menu Sidebar.
-- ============================================================================

-- 18x. Microblog publik (view tanpa kolom internal, bisa dibaca anon/guest) -- sql/58
drop view if exists public.microblog_publik;

create view public.microblog_publik as
select
  id,
  tanggal,
  tema,
  tipe_konten,
  draft_caption,
  status,
  pilar,
  tahap,
  teks_gambar,
  tema_minggu
from public.ig_content_plan
where status <> 'dilewati';

revoke all on public.microblog_publik from public;
grant select on public.microblog_publik to anon, authenticated;
