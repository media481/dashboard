-- ============================================================
-- MIGRASI: Tambah kolom "nomor_kamar" ke tabel kb_jamaah (menu Keberangkatan)
-- untuk fitur ROOMING LIST -- pembagian jamaah ke kamar hotel per tipe
-- kamar (Quad/Triple/Double), bisa dibagi otomatis atau digeser manual,
-- lalu dicetak (lihat js/app.js -> Rooming List, dibuka dari tombol
-- "Rooming List" di tab Keberangkatan).
--
-- nomor_kamar HANYA unik dalam lingkup (program_id, tipe_kamar) yang sama
-- -- misal Kamar 1 Quad dan Kamar 1 Triple adalah kamar yang BERBEDA,
-- jadi sengaja TIDAK dibuat unique constraint gabungan (biar tidak ribet
-- kalau suatu saat perlu diubah manual lewat SQL Editor juga).
--
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- (aman dijalankan berkali-kali, pakai IF NOT EXISTS, tidak menghapus data)
-- ============================================================

alter table kb_jamaah add column if not exists nomor_kamar integer;

-- Selesai. Jamaah yang nomor_kamar-nya NULL dianggap "belum dikelompokkan"
-- di UI Rooming List -- tombol "Auto-Bagi Kamar" akan mengisi otomatis
-- berdasarkan urutan nama & kapasitas per tipe kamar (Quad=4, Triple=3,
-- Double=2 orang/kamar).
