-- ============================================================
-- MIGRASI: Content Planner -- Pola Amiru (teks di gambar)
-- Tabel: ig_content_plan (kolom baru: teks_gambar)
--
-- teks_gambar : teks pemancing yang ditaruh DI GAMBAR/slide (2-4 baris pendek).
--               Caption (draft_caption) melanjutkan teks ini, bukan mengulanginya.
--
-- Pilar baru 'storytelling' TIDAK perlu migrasi: kolom pilar berupa text bebas
-- (lihat sql/tambah_ig_content_plan_planner.sql), jadi nilai baru langsung bisa dipakai.
--
-- Opsional: dashboard tetap jalan tanpa migrasi ini (fitur teks gambar otomatis
-- tersembunyi, tombol "Pola Mingguan Amiru" tetap bisa dipakai tapi teks gambar
-- tidak ikut tersimpan). Idempotent -- aman dijalankan berulang kali.
-- Jalankan SETELAH sql/tambah_ig_content_plan.sql.
-- ============================================================

alter table ig_content_plan add column if not exists teks_gambar text;
