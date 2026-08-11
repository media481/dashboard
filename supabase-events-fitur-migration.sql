-- ============================================================
-- MIGRASI: kolom `fitur` di tabel kt_events
--
-- LATAR BELAKANG:
-- Saat membuat/edit event, script.js menyimpan pilihan modul yang
-- diaktifkan (Donatur, Transaksi, Operasional, Lomba, Hadiah,
-- Jalan Santai, Jadwal) sebagai object JSON di field `fitur` pada
-- setiap event. Kolom ini ternyata belum pernah dibuat di Supabase,
-- sehingga upsert ke kt_events gagal dengan error PGRST204:
-- "Could not find the 'fitur' column of 'kt_events' in the schema cache".
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================

alter table kt_events add column if not exists fitur jsonb default '{}'::jsonb;

-- Isi baris lama yang masih null supaya konsisten dengan default di atas.
update kt_events set fitur = '{}'::jsonb where fitur is null;
