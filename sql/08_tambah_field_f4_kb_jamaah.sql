-- ============================================================
-- MIGRASI: Lengkapi field tabel kb_jamaah (menu Keberangkatan)
-- agar sejajar dengan field F4 di tabel `pendaftaran`, supaya
-- data lengkap (jenis kelamin, TTL, alamat, ahli waris, dst) tidak
-- hilang saat calon jamaah dikonversi dari Form Pendaftaran.
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Aman dijalankan di project yang SUDAH ada isinya (pakai IF NOT EXISTS),
-- tidak akan menghapus/mengubah data yang sudah ada.
-- ============================================================

alter table kb_jamaah add column if not exists jenis_kelamin text;
alter table kb_jamaah add column if not exists tempat_lahir text;
alter table kb_jamaah add column if not exists tgl_lahir date;
alter table kb_jamaah add column if not exists alamat text;
alter table kb_jamaah add column if not exists kode_pos text;
alter table kb_jamaah add column if not exists telp_rumah text;
alter table kb_jamaah add column if not exists ahli_waris_nama text;
alter table kb_jamaah add column if not exists ahli_waris_hubungan text;

-- Catatan: nama kolom sengaja dibuat sama persis dengan tabel `pendaftaran`
-- (jenis_kelamin, tempat_lahir, tgl_lahir, alamat, kode_pos, telp_rumah,
-- ahli_waris_nama, ahli_waris_hubungan) supaya proses salin data dari
-- Pendaftaran -> Keberangkatan tinggal copy field ke field tanpa mapping.

-- Selesai. Setelah ini modal "Tambah/Edit Data Jamaah" di menu Keberangkatan
-- sudah bisa menyimpan data lengkap F4, dan data ikut terbawa otomatis saat
-- dikonversi dari Form Pendaftaran.
