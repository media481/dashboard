-- ============================================================
-- MIGRASI: Tambah kolom status kepulangan ke tabel kb_jamaah
-- untuk menu baru "Status Kepulangan" -- melacak progres jamaah
-- dari belum berangkat sampai sudah pulang, terpisah dari status
-- pembayaran (lunas/dp/pending) yang sudah ada.
--
-- status_kepulangan: 'belum_berangkat' | 'sudah_berangkat' | 'sudah_pulang' | 'batal'
-- (disimpan sebagai text bebas, bukan enum, supaya gampang diubah lewat
-- SQL Editor kalau suatu saat perlu status baru tanpa migrasi ulang)
--
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- (aman dijalankan berkali-kali, pakai IF NOT EXISTS, tidak menghapus data)
-- ============================================================

alter table kb_jamaah add column if not exists status_kepulangan text not null default 'belum_berangkat';
alter table kb_jamaah add column if not exists tgl_berangkat_aktual date;
alter table kb_jamaah add column if not exists tgl_pulang_aktual date;
alter table kb_jamaah add column if not exists catatan_kepulangan text;

-- Selesai. Jamaah lama otomatis dianggap "Belum Berangkat" (default di atas).
-- Tab "Status Kepulangan" di js/app.js membaca & menulis 4 kolom ini per
-- jamaah, dikelompokkan per program seperti tab Kelengkapan Dokumen.
