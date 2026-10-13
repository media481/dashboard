-- ============================================================
-- MIGRASI: Content Planner -- Link desain Canva per ide konten
-- Tabel: ig_content_plan (kolom baru: canva_url)
--
-- canva_url : link desain poster di Canva (mis. https://www.canva.com/design/...).
--             Di modal harian Content Planner muncul tombol "Canva" yang membuka
--             desain tsb di tab baru; link diisi/diubah lewat kolom "Link Canva"
--             di editor kartu ide.
--
-- Opsional: dashboard tetap jalan tanpa migrasi ini (kolom & tombol Canva
-- baru tampil setelah kolom ada). RLS tidak berubah (ikut policy ig_content_plan).
-- Idempotent -- aman dijalankan berulang kali.
-- Jalankan SETELAH sql/44_tambah_ig_content_plan.sql.
-- ============================================================

alter table ig_content_plan add column if not exists canva_url text;
