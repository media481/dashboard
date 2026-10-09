-- ============================================================
-- MIGRASI: Content Planner -- Tema Minggu (pola 7 hari yang menyambung)
-- Tabel: ig_content_plan (kolom baru: tema_minggu)
--
-- tema_minggu : tema satu pekan (mis. "Talbiyah") yang dibagi ke 7 posting
--               Senin-Minggu. Dipakai untuk mengelompokkan ide sepekan dan
--               menyusun label gambar "Seri Talbiyah · 3/7".
--
-- Lihat pola-konten.md bagian 3 & 9. Opsional: dashboard tetap jalan tanpa
-- migrasi ini (tema minggu tetap dikirim ke AI, hanya tidak ikut tersimpan).
-- Idempotent -- aman dijalankan berulang kali.
-- Jalankan SETELAH sql/tambah_ig_content_plan.sql.
-- ============================================================

alter table ig_content_plan add column if not exists tema_minggu text;

create index if not exists idx_ig_content_plan_tema_minggu on ig_content_plan (tema_minggu);
