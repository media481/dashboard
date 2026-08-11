-- ============================================================
-- MIGRASI: tandai anggota Dana Sosial yang berstatus "Perantauan".
--
-- Anggota Perantauan biasanya TIDAK bayar bulanan seperti anggota
-- reguler — mereka baru pulang/nitip bayar setahun sekali. Supaya
-- tidak bikin daftar utama keliatan penuh "Belum Bayar" tiap bulan,
-- anggota Perantauan dipisah ke tabel sendiri di UI (lihat
-- js/22-dana-sosial.js), meski struktur datanya tetap sama persis
-- dengan anggota reguler (satu baris kt_dana_sosial_bayar per bulan
-- yang sudah ditandai lunas — biasanya ditandai beberapa bulan
-- sekaligus saat mereka pulang/nitip bayar).
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================

alter table kt_dana_sosial_anggota
  add column if not exists perantauan boolean not null default false;
