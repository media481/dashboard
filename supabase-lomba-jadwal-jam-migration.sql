-- Migrasi: tambah kolom jam (waktu) untuk Tanggal Lomba & Jadwal/Reminder,
-- supaya yang muncul bukan cuma tanggal tapi juga hari + jam acaranya.
--
-- Jalankan sekali saja lewat SQL editor Supabase.

alter table kt_lomba  add column if not exists jam text;
alter table kt_jadwal add column if not exists jam text;
