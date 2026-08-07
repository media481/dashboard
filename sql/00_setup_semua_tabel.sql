-- ============================================================
-- SETUP SUPABASE BARU — Amiru Repository Dashboard
-- Jalankan seluruh file ini di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Berisi semua tabel yang dipakai oleh index.html / css/style.css / js/app.js
-- ============================================================

-- Extension untuk gen_random_uuid()
create extension if not exists pgcrypto;

-- ============================================================
-- 1. PROGRAMS
-- Data utama program umroh. Field admin-only (harga_quad, hotel,
-- makan, termasuk/tidak termasuk, catatan_cx, hasil OCR poster)
-- disimpan dalam kolom JSON admin_data_lengkap.
-- ============================================================
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

create policy "Allow read programs" on programs for select using (true);
create policy "Allow insert programs" on programs for insert with check (true);
create policy "Allow update programs" on programs for update using (true);
create policy "Allow delete programs" on programs for delete using (true);


-- ============================================================
-- 2. JADWAL_TAMU
-- Jadwal kunjungan tamu ke kantor.
-- ============================================================
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

create policy "Allow read jadwal_tamu" on jadwal_tamu for select using (true);
create policy "Allow insert jadwal_tamu" on jadwal_tamu for insert with check (true);
create policy "Allow update jadwal_tamu" on jadwal_tamu for update using (true);
create policy "Allow delete jadwal_tamu" on jadwal_tamu for delete using (true);


-- ============================================================
-- 3. KB_JAMAAH
-- Data jamaah per program (Kartu Berangkat / manifest jamaah).
-- ============================================================
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

alter table kb_jamaah enable row level security;

create policy "Allow read kb_jamaah" on kb_jamaah for select using (true);
create policy "Allow insert kb_jamaah" on kb_jamaah for insert with check (true);
create policy "Allow update kb_jamaah" on kb_jamaah for update using (true);
create policy "Allow delete kb_jamaah" on kb_jamaah for delete using (true);


-- ============================================================
-- 3B. PENDAFTARAN
-- Daftar minat calon jamaah sebelum resmi jadi data di kb_jamaah.
-- ============================================================
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

alter table pendaftaran enable row level security;

create policy "Allow read pendaftaran" on pendaftaran for select using (true);
create policy "Allow insert pendaftaran" on pendaftaran for insert with check (true);
create policy "Allow update pendaftaran" on pendaftaran for update using (true);
create policy "Allow delete pendaftaran" on pendaftaran for delete using (true);


-- ============================================================
-- 4. FEATURED_PROGRAMS
-- Daftar program yang ditandai "unggulan" untuk tampil di beranda.
-- ============================================================
create table if not exists featured_programs (
    id uuid primary key default gen_random_uuid(),
    program_id uuid not null references programs(id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (program_id)
);

alter table featured_programs enable row level security;

create policy "Allow read featured_programs" on featured_programs for select using (true);
create policy "Allow insert featured_programs" on featured_programs for insert with check (true);
create policy "Allow delete featured_programs" on featured_programs for delete using (true);


-- ============================================================
-- 5. APP_CONFIG
-- Key-value config aplikasi, termasuk password login admin/CS.
-- Diisi manual lewat SQL Editor (bukan lewat form di aplikasi).
-- ============================================================
create table if not exists app_config (
    key text primary key,
    value text,
    updated_at timestamptz not null default now()
);

alter table app_config enable row level security;

-- [FIX bug #6] Password TIDAK boleh bisa dibaca publik. Anon tidak boleh SELECT/WRITE
-- app_config sama sekali; semua akses password lewat RPC SECURITY DEFINER
-- (verify_dashboard_password / set_admin_password) di sql/fix_bug6_auth_rpc.sql.
create policy "No anon read app_config"  on app_config for select using (false);
create policy "No anon write app_config" on app_config for all    using (false) with check (false);

-- Isi password awal (WAJIB diganti setelah setup!):
insert into app_config (key, value) values
    ('pass_administrator', 'ganti-password-admin'),
    ('pass_cs', 'ganti-password-cs')
on conflict (key) do nothing;


-- ============================================================
-- 6. TG_CONFIG
-- Key-value config notifikasi Telegram (bot token, edge function
-- url, daftar penerima, log pengingat keberangkatan).
-- ============================================================
create table if not exists tg_config (
    key text primary key,
    value text,
    updated_at timestamptz not null default now()
);

alter table tg_config enable row level security;

create policy "Allow read tg_config" on tg_config for select using (true);
create policy "Allow upsert tg_config" on tg_config for insert with check (true);
create policy "Allow update tg_config" on tg_config for update using (true);


-- ============================================================
-- 7. KWT_KUITANSI
-- Kuitansi pembayaran. Catatan: saat ini fitur di app.js baru
-- generate PDF di sisi klien (belum insert ke tabel ini secara
-- otomatis) — tabel ini disiapkan untuk pengembangan berikutnya.
-- ============================================================
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

create policy "Allow read kwt_kuitansi" on kwt_kuitansi for select using (true);
create policy "Allow insert kwt_kuitansi" on kwt_kuitansi for insert with check (true);
create policy "Allow delete kwt_kuitansi" on kwt_kuitansi for delete using (true);


-- ============================================================
-- 8. PEMBAYARAN_JAMAAH
-- Riwayat pembayaran/cicilan per jamaah (untuk fitur monitoring
-- Pembayaran & Cicilan). Satu jamaah bisa punya banyak baris
-- (tiap kali bayar/cicil dicatat sebagai baris baru).
-- ============================================================
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

create policy "Allow read pembayaran_jamaah" on pembayaran_jamaah for select using (true);
create policy "Allow insert pembayaran_jamaah" on pembayaran_jamaah for insert with check (true);
create policy "Allow update pembayaran_jamaah" on pembayaran_jamaah for update using (true);
create policy "Allow delete pembayaran_jamaah" on pembayaran_jamaah for delete using (true);


-- ============================================================
-- SELESAI
-- ============================================================
-- Langkah selanjutnya:
-- 1. Ganti value 'pass_administrator' dan 'pass_cs' di atas dengan
--    password asli (jalankan UPDATE app_config SET value = '...'
--    WHERE key = '...';)
-- 2. Update SUPABASE_URL & SUPABASE_ANON_KEY di js/app.js baris 4-5
--    dengan URL & anon key dari project Supabase yang baru ini.
-- 3. Fitur Crosscheck OCR (scan-poster-ocr) dan notifikasi Telegram
--    (send-telegram) memakai Supabase Edge Functions terpisah —
--    itu TIDAK dibuat oleh SQL ini dan perlu di-deploy manual lewat
--    Supabase CLI/Dashboard kalau ingin fitur itu tetap jalan.
