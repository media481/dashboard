-- ============================================================
-- MIGRASI: Tampilkan Nama (bukan email) di kolom "Dicetak Oleh" — Audit Nota
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Aman dijalankan di project yang SUDAH ada isinya (pakai IF NOT EXISTS),
-- tidak menghapus/mengubah data audit yang sudah tercatat.
--
-- Kenapa nambah kolom baru, bukan menimpa dicetak_oleh_nama:
-- dicetak_oleh_nama SENGAJA diisi email akun login (bukan nama bebas) supaya
-- audit trail akurat & tidak bisa dipalsukan user (lihat komentar di
-- js/app.js -> getPetugasNama()). Kolom baru dicetak_oleh_label ini hanya
-- untuk TAMPILAN di tabel Audit Nota, diisi dari dashboard_profiles.label
-- (mis. "Ali Santoso") milik akun yang mencetak, mendampingi email yang
-- tetap tersimpan apa adanya di dicetak_oleh_nama.
-- ============================================================

alter table nota_audit_log add column if not exists dicetak_oleh_label text;

-- Baris lama (sebelum migrasi ini) tidak punya dicetak_oleh_label -> di
-- tabel Audit Nota akan tetap tampil email seperti sebelumnya (fallback),
-- baris baru setelah ini akan tampil nama.
