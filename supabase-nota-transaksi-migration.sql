-- Migrasi: tambah kolom `nota` (foto struk/bukti transaksi) ke 4 tabel
-- transaksi keuangan utama: Kas Organisasi, Pemasukan Lain (Transaksi Lain),
-- Biaya Operasional, dan Donatur.
--
-- Nota disimpan sebagai base64 data URI LANGSUNG di kolom TEXT (pola yang
-- sama seperti logo organisasi di kt_organisasi_profil), BUKAN di Supabase
-- Storage — proyek ini sengaja tanpa dependency/bucket tambahan. Foto
-- dikompres di sisi klien (resize + JPEG quality) sebelum dikirim, lihat
-- kompresGambarNota() di js/16-ui-helpers.js, supaya ukuran tiap baris tetap
-- wajar mengingat setiap load aplikasi nge-fetch SEMUA baris lewat
-- `select('*')` (lihat ARRAY_TABLE_MAP di js/03-db-core.js).
--
-- Jalankan manual di Supabase Dashboard (SQL Editor). Aman dijalankan ulang
-- (IF NOT EXISTS).

ALTER TABLE kt_kas            ADD COLUMN IF NOT EXISTS nota TEXT;
ALTER TABLE kt_transaksi_lain ADD COLUMN IF NOT EXISTS nota TEXT;
ALTER TABLE kt_operasional    ADD COLUMN IF NOT EXISTS nota TEXT;
ALTER TABLE kt_donatur        ADD COLUMN IF NOT EXISTS nota TEXT;

COMMENT ON COLUMN kt_kas.nota IS 'Foto struk/bukti transaksi, base64 data URI (opsional)';
COMMENT ON COLUMN kt_transaksi_lain.nota IS 'Foto struk/bukti transaksi, base64 data URI (opsional)';
COMMENT ON COLUMN kt_operasional.nota IS 'Foto struk/bukti transaksi, base64 data URI (opsional)';
COMMENT ON COLUMN kt_donatur.nota IS 'Foto struk/bukti transaksi, base64 data URI (opsional)';
