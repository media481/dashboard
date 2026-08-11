-- ============================================================
-- MIGRASI: Rombak Status Kepulangan jadi default PER PROGRAM
-- (bukan per jamaah lagi). Sebelumnya (sql/tambah_status_kepulangan_kb_jamaah.sql)
-- status kepulangan disimpan & diubah satu-satu per jamaah.
--
-- Sekarang:
-- 1. Tabel `programs` punya kolom status_kepulangan sendiri -- inilah status
--    default/utama untuk SEMUA jamaah di program itu (mewakili rombongan).
-- 2. Kolom kb_jamaah.status_kepulangan jadi NULLABLE:
--      - NULL  -> jamaah ikut status program (kondisi normal/mayoritas)
--      - terisi -> override manual untuk jamaah itu saja (mis. ada yang
--        tertinggal / pulang duluan / batal sendiri, beda dari rombongannya)
--
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- (aman dijalankan berkali-kali, tidak menghapus data)
-- ============================================================

-- 1. Status kepulangan di level program (rombongan)
alter table programs add column if not exists status_kepulangan text not null default 'belum_berangkat';

-- 2. Longgarkan kolom di kb_jamaah supaya bisa NULL (artinya: ikut program)
alter table kb_jamaah alter column status_kepulangan drop not null;
alter table kb_jamaah alter column status_kepulangan drop default;

-- 3. Jamaah yang statusnya masih default lama ('belum_berangkat') dianggap
--    belum pernah di-override manual -> dikosongkan supaya otomatis ikut
--    status program. Jamaah yang statusnya SUDAH diubah ke selain
--    'belum_berangkat' (sudah_berangkat/sudah_pulang/batal) dianggap memang
--    sengaja di-override dan datanya TIDAK disentuh oleh migrasi ini.
update kb_jamaah set status_kepulangan = null where status_kepulangan = 'belum_berangkat';

-- Selesai. Tab "Status Kepulangan" di js/app.js sekarang menampilkan 1
-- dropdown "Status Kepulangan Program" di atas (mengubah programs.status_kepulangan),
-- dan dropdown per baris di tabel jamaah untuk override individual (pilih
-- "Ikuti Status Program" untuk membatalkan override).
