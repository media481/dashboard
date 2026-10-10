-- ============================================================
-- MIGRASI: Simpan link permanen dari kb_jamaah balik ke baris
-- pendaftaran asalnya (kalau jamaah ini hasil konversi dari
-- Form Pendaftaran), supaya:
--   1. Bisa dilacak "jamaah ini dari lead yang mana".
--   2. Status pendaftaran bisa disinkronkan balik otomatis kalau
--      jamaah hasil konversi tsb dihapus (lihat app.js).
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Aman dijalankan di project yang SUDAH ada isinya.
-- ============================================================

alter table kb_jamaah add column if not exists pendaftaran_id uuid references pendaftaran(id) on delete set null;

create index if not exists idx_kb_jamaah_pendaftaran_id on kb_jamaah (pendaftaran_id);

-- Selesai.
