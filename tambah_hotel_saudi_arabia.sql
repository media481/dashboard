-- ============================================================
-- MIGRASI: Tabel "hotel_saudi_arabia" -- referensi data hotel di
-- Arab Saudi (hasil import dari booking_saudi_arabia.csv), ditampilkan
-- sebagai sub-tab baru "Hotel Saudi Arabia" di dalam menu Assets.
-- Sifatnya READ-ONLY di aplikasi (hanya lihat & cari) -- data diisi
-- sekali lewat import_hotel_saudi_arabia.sql, tidak ada tombol
-- tambah/edit/hapus di UI.
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- (aman dijalankan berkali-kali, pakai IF NOT EXISTS / DROP POLICY IF EXISTS)
-- ============================================================

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

-- Read-only: hanya akun yang login (authenticated) yang boleh lihat,
-- konsisten dengan pola tabel `assets` (sql/tambah_menu_assets.sql).
-- SENGAJA tidak dibuatkan policy insert/update/delete -- di aplikasi
-- data ini murni referensi hasil import CSV, jadi lewat REST API biasa
-- (anon/authenticated key) tabel ini otomatis read-only karena RLS
-- default menolak semua operasi yang tidak ada policy-nya. Kalau
-- suatu saat perlu diedit, lakukan lewat SQL Editor (service role) atau
-- tambahkan policy insert/update/delete admin-only seperti pola di
-- sql/kunci_assets_admin_saja.sql.
drop policy if exists "Auth read hotel_saudi_arabia" on hotel_saudi_arabia;
create policy "Auth read hotel_saudi_arabia" on hotel_saudi_arabia
  for select using (auth.role() = 'authenticated');

-- Selesai. Lanjutkan dengan menjalankan import_hotel_saudi_arabia.sql
-- untuk mengisi datanya (2.375 baris dari CSV).
