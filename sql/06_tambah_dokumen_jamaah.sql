-- ============================================================
-- MIGRASI: Kelengkapan Dokumen Jamaah
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Aman dijalankan di project yang SUDAH ada isinya (pakai IF NOT EXISTS),
-- tidak akan menghapus/mengubah data yang sudah ada.
-- ============================================================

-- Tambah kolom jsonb di kb_jamaah untuk menyimpan checklist dokumen,
-- contoh isi: {"ktp": true, "kk": false, "paspor": true, "foto": false, "vaksin": true}
alter table kb_jamaah
    add column if not exists dokumen jsonb not null default '{}'::jsonb;

-- Selesai. Setelah ini fitur "Kelengkapan Dokumen" di menu sidebar siap dipakai.
