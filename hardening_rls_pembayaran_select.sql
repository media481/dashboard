-- ============================================================
-- HARDENING KEAMANAN #2 — Tutup akses SELECT publik ke pembayaran_jamaah
-- Jalankan SETELAH 00_setup_semua_tabel.sql & hardening_rls_keamanan.sql
-- di SQL Editor Supabase.
--
-- MASALAH:
--   hardening_rls_keamanan.sql sudah mengunci INSERT/UPDATE/DELETE
--   pembayaran_jamaah ke user yang login (authenticated), tapi policy
--   SELECT-nya (dari 00_setup_semua_tabel.sql) masih "using(true)" —
--   artinya jumlah pembayaran tiap jamaah masih bisa dibaca siapa saja
--   lewat REST API Supabase pakai anon key, tanpa login.
--
--   Berbeda dengan tabel programs (yang memang harus tetap publik supaya
--   halaman depan bisa menampilkan daftar paket umroh), seluruh pemakaian
--   SELECT pembayaran_jamaah di aplikasi ini hanya terjadi di panel admin
--   (tab Keberangkatan, panel Pembayaran, modal Kelola Cicilan) yang sudah
--   dibatasi canManageProgramData() di sisi UI — jadi aman dikunci di sisi
--   DB juga tanpa mematahkan fitur apa pun.
--
-- SOLUSI: ganti policy SELECT jadi butuh auth.role() = 'authenticated',
-- konsisten dengan policy INSERT/UPDATE/DELETE yang sudah ada.
-- ============================================================

drop policy if exists "Allow read pembayaran_jamaah" on pembayaran_jamaah;
create policy "Auth read pembayaran_jamaah" on pembayaran_jamaah
    for select using (auth.role() = 'authenticated');
