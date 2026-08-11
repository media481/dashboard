-- ============================================================
-- MIGRASI: kolom donasi BARANG di tabel kt_donatur
--
-- LATAR BELAKANG:
-- Menu Donatur sebelumnya cuma bisa catat sumbangan UANG (kolom
-- `jumlah`, ikut dihitung ke saldo kas lewat hitungBukuUtama() di
-- js/16-ui-helpers.js). Sekarang bisa juga catat sumbangan BARANG
-- (mis. konsumsi, alat tulis, kipas angin) — sengaja dipisah dari
-- perhitungan uang/saldo kas, cuma tercatat & tampil di Daftar
-- Donatur + LPJ sebagai rincian barang, BUKAN uang masuk.
--
-- Kolom baru:
--   jenis        'uang' | 'barang' — default 'uang' supaya baris lama
--                (dibuat sebelum fitur ini ada) otomatis dianggap donasi
--                uang seperti perilaku sebelumnya, tidak perlu diisi ulang.
--   nama_barang  nama barang (cuma dipakai kalau jenis='barang').
--   qty          jumlah barang (cuma dipakai kalau jenis='barang').
--   satuan       satuan barang, opsional (mis. "dus", "pcs", "buah").
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================

alter table kt_donatur add column if not exists jenis text default 'uang';
alter table kt_donatur add column if not exists nama_barang text default '';
alter table kt_donatur add column if not exists qty numeric;
alter table kt_donatur add column if not exists satuan text default '';

-- Isi baris lama yang masih null supaya konsisten dengan default di atas
-- (tidak mempengaruhi baris baru yang dibuat setelah migrasi ini).
update kt_donatur set jenis = 'uang' where jenis is null;
