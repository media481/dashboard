-- ============================================================
-- MIGRASI: Tambah field Tgl Kadaluarsa Paspor & Status Visa
-- ke tabel kb_jamaah (menu Keberangkatan), untuk menutup celah
-- pelacakan risiko 2026: paspor mepet & visa yang belum jelas
-- statusnya. Surat Mahram TIDAK butuh kolom baru -- sudah dicek
-- otomatis dari jenis_kelamin + tgl_lahir yang sudah ada, dan
-- disimpan sebagai item baru di kolom `dokumen` (jsonb) yang sudah ada.
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Aman dijalankan di project yang SUDAH ada isinya (pakai IF NOT EXISTS),
-- tidak akan menghapus/mengubah data yang sudah ada.
-- ============================================================

alter table kb_jamaah add column if not exists paspor_exp date;
alter table kb_jamaah add column if not exists visa_status text default 'belum_diajukan';

-- visa_status yang dipakai di UI (js/app.js -> VISA_STATUS_LABEL):
-- 'belum_diajukan' | 'diproses' | 'terbit' | 'ditolak'

-- Selesai. Setelah ini modal "Tambah/Edit Data Jamaah" di menu Keberangkatan
-- bisa menyimpan Tgl Kadaluarsa Paspor (dengan badge peringatan otomatis
-- kalau kurang dari 7 bulan dari tanggal keberangkatan program) dan Status
-- Visa (Belum Diajukan/Diproses/Terbit/Ditolak).
