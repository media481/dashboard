-- ============================================================
-- MIGRASI: Tanggal Berangkat/Pulang Aktual jadi default PER PROGRAM
-- (bukan per jamaah lagi) -- lanjutan dari
-- sql/tambah_status_kepulangan_program.sql yang sudah memindahkan
-- status_kepulangan ke level program.
--
-- Sekarang tgl_berangkat_aktual & tgl_pulang_aktual juga punya versi
-- di tabel `programs` -- inilah tanggal default untuk SEMUA jamaah di
-- program itu (mewakili rombongan).
--
-- kb_jamaah.tgl_berangkat_aktual / tgl_pulang_aktual SUDAH nullable sejak
-- awal (sql/tambah_status_kepulangan_kb_jamaah.sql), jadi tidak perlu
-- diubah -- maknanya sekarang:
--   NULL   -> jamaah ikut tanggal program (kondisi normal/mayoritas)
--   terisi -> override manual untuk jamaah itu saja (mis. berangkat/
--             pulang di tanggal berbeda dari rombongannya)
--
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- (aman dijalankan berkali-kali, tidak menghapus data)
-- ============================================================

alter table programs add column if not exists tgl_berangkat_aktual date;
alter table programs add column if not exists tgl_pulang_aktual date;

-- Selesai. Tab "Status Kepulangan" di js/app.js sekarang menampilkan input
-- tanggal di panel program (mengubah programs.tgl_berangkat_aktual /
-- tgl_pulang_aktual), dan input tanggal per baris jamaah untuk override
-- individual (kosongkan tanggalnya untuk kembali ikut tanggal program).
