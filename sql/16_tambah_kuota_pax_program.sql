-- ============================================================
-- MIGRASI: Kuota Pax per Program Umroh
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Aman dijalankan berulang (pakai IF NOT EXISTS).
--
-- Menambah kolom kuota_pax di tabel programs, default 45.
-- Dipakai untuk menghitung status ketersediaan di tabel Program Umroh,
-- contoh: "44/45 Tersedia" (jumlah jamaah terdaftar aktif / kuota).
-- Jumlah terdaftar dihitung di client dari kb_jamaah (status != 'batal',
-- diarsipkan = false), BUKAN kolom tersimpan -- supaya selalu real-time
-- tanpa perlu trigger/sync tambahan.
-- ============================================================

alter table programs
    add column if not exists kuota_pax integer not null default 45;

comment on column programs.kuota_pax is
    'Jumlah kuota pax/kursi program ini (default 45). Dipakai untuk status "terisi/kuota" di tabel Program Umroh.';

-- Jaga-jaga: kuota tidak boleh negatif atau nol.
alter table programs drop constraint if exists programs_kuota_pax_check;
alter table programs
    add constraint programs_kuota_pax_check check (kuota_pax > 0);
