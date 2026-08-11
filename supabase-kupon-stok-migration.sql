-- ============================================================
-- MIGRASI: kolom `kuponqty` di tabel kt_transaksi_lain + stok kupon
--
-- LATAR BELAKANG:
-- Menu Pemasukan Lain -> "Penjualan Kupon Harian" (js/09-donatur-
-- transaksi-operasional.js, openKuponJalanModal/simpanKuponJalan) sekarang
-- mencatat jumlah lembar kupon yang terjual di kolom `kuponqty` pada setiap
-- baris kt_transaksi_lain, supaya sisa stok kupon (diatur admin di
-- Pengaturan -> Kupon Jalan Santai, lihat js/15-pengaturan-event.js) bisa
-- dihitung on-the-fly dari total kuponqty yang sudah terjual, tanpa perlu
-- tabel/counter terpisah yang rawan tidak sinkron.
--
-- Stok & harga kupon sendiri sudah tersimpan di kt_settings (kolom jsonb
-- kuponJalanSantai), jadi tidak perlu migrasi tambahan untuk itu.
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================

alter table kt_transaksi_lain add column if not exists kuponqty integer;

-- Baris transaksi lama (dibuat sebelum fitur stok ini ada) tidak punya info
-- jumlah kupon, jadi dibiarkan null (Number(null||0) = 0 di JS, tidak
-- dihitung sebagai kupon terjual, dan tidak mempengaruhi transaksi biasa
-- yang bukan penjualan kupon).
