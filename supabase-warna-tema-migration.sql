-- ============================================================
-- MIGRASI: kolom `warna_tema` di tabel kt_events
--
-- LATAR BELAKANG:
-- Fitur "Tema Warna per Event" menyimpan preset warna yang dipilih
-- (hijau/merah/biru/ungu/oranye/pink/emas) sebagai teks di field
-- `warna_tema` pada setiap event (lihat PRESET_TEMA & openEventModal
-- di script.js). Sama seperti kasus kolom `fitur` sebelumnya, kolom
-- ini belum ada di Supabase sampai migration ini dijalankan, jadi
-- upsert ke kt_events akan gagal dengan error PGRST204:
-- "Could not find the 'warna_tema' column of 'kt_events' in the
-- schema cache" kalau migration ini belum dijalankan.
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================

alter table kt_events add column if not exists warna_tema text default 'hijau';

-- Isi baris lama yang masih null supaya konsisten dengan default di atas.
update kt_events set warna_tema = 'hijau' where warna_tema is null;

notify pgrst, 'reload schema';
