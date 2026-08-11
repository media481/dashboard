-- ============================================================
-- MAKSIMALKAN NOTIFIKASI TELEGRAM
-- ============================================================
-- Menambah 2 kolom ke tabel kt_telegram_settings (baris tunggal, id='main')
-- yang sudah ada:
--   1. categories   — kontrol on/off notifikasi per kategori (anggota,
--      donasi, lomba, dst) tanpa perlu matikan semua sekaligus.
--   2. quiet_hours  — rentang jam tenang, notifikasi yang masuk di jam ini
--      ditahan dan baru dikirim otomatis setelah jam tenang berakhir.
--
-- Aman dijalankan berkali-kali (IF NOT EXISTS) dan tidak mengubah baris
-- yang sudah ada — default categories semua true (semua kategori tetap
-- aktif seperti perilaku sebelumnya) dan quiet_hours nonaktif.
-- ============================================================

alter table kt_telegram_settings
  add column if not exists categories jsonb not null default '{
    "anggota": true,
    "donasi": true,
    "transaksi": true,
    "operasional": true,
    "lomba": true,
    "belanja": true,
    "agenda": true,
    "kas": true,
    "dana_sosial": true,
    "login": true,
    "sistem": true,
    "umum": true
  }'::jsonb;

alter table kt_telegram_settings
  add column if not exists quiet_hours jsonb not null default '{
    "enabled": false,
    "start": "22:00",
    "end": "06:00"
  }'::jsonb;
