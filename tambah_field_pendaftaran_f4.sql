-- ============================================================
-- MIGRASI: Lengkapi field tabel pendaftaran agar sesuai
-- "Formulir Pendaftaran Umroh - Haji - Tour" (kertas F4)
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Aman dijalankan di project yang SUDAH ada isinya (pakai IF NOT EXISTS),
-- tidak akan menghapus/mengubah data yang sudah ada.
-- ============================================================

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

-- Catatan kolom yang sudah ada dan dipakai ulang:
--   asal  -> menampung "Kabupaten / Kota"
--   wa    -> menampung "No. Handphone"

-- Selesai. Setelah ini form "Tambah Pendaftaran" di menu sidebar sudah
-- sesuai dengan field pada formulir kertas F4.
