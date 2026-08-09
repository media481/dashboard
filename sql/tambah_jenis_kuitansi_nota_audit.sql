-- ============================================================
-- MIGRASI: Tambah jenis 'kuitansi' ke nota_audit_log
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Prasyarat: sql/tambah_nota_audit.sql sudah pernah dijalankan (tabel
-- nota_audit_log sudah ada).
--
-- Kenapa perlu ini: tabel Kuitansi (modal "Kuitansi" di tab Keberangkatan)
-- sekarang disamakan desain & alur unduhnya dengan Nota Pembayaran,
-- termasuk ikut tercatat ke nota_audit_log. Tapi kolom `jenis` di tabel itu
-- awalnya dikunci CHECK constraint hanya boleh 'pembayaran' / 'riwayat'
-- (lihat sql/tambah_nota_audit.sql), jadi perlu dilonggarkan supaya
-- 'kuitansi' juga diterima.
-- ============================================================

alter table nota_audit_log drop constraint if exists nota_audit_log_jenis_check;

alter table nota_audit_log
    add constraint nota_audit_log_jenis_check
    check (jenis in ('pembayaran', 'riwayat', 'kuitansi'));

-- Selesai. Setelah ini modal Kuitansi (tab Keberangkatan) bisa mencatat
-- audit log dengan jenis = 'kuitansi', dan akan muncul di panel
-- Admin > Audit Nota dengan filter "Kuitansi".
