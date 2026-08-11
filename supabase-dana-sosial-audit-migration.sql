-- ============================================================
-- MIGRASI: jejak audit untuk "tandai lunas" Dana Sosial
-- ------------------------------------------------------------
-- Fitur tandai/batalkan lunas di kt_dana_sosial_bayar sebelumnya cuma
-- nyimpen status lunas + tanggal_bayar TANPA pernah nyatet siapa yang
-- melakukannya. Ini bikin gampang dimanipulasi diam-diam (mis. ada yang
-- iseng/tergesa membatalkan status lunas orang lain tanpa jejak sama
-- sekali) — apalagi lewat halaman ini banyak orang login pakai akun
-- 'user' yang sama.
--
-- Migrasi ini nambah 2 kolom:
--   diubah_oleh  → nama/username user yang login saat toggle terakhir
--   diubah_pada  → waktu toggle terakhir (server time)
-- Diisi dari sisi aplikasi (lihat js/22-dana-sosial.js), BUKAN cuma
-- mengandalkan updated_at bawaan tabel — supaya jelas "siapa", bukan
-- cuma "kapan".
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================

alter table kt_dana_sosial_bayar add column if not exists diubah_oleh text;
alter table kt_dana_sosial_bayar add column if not exists diubah_pada timestamptz;
