-- ============================================================
-- MIGRASI: Arsip Jamaah (jamaah yang sudah pulang ke tanah air)
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Aman dijalankan berulang / di project yang sudah ada isinya
-- (pakai IF NOT EXISTS di semua langkah).
--
-- Skenario (sesuai keputusan desain):
-- 1. Pemicu: manual per program sekaligus, lewat tombol "Arsipkan
--    Semua" di tab Keberangkatan setelah keberangkatan selesai.
--    Diblokir kalau masih ada jamaah yang belum lunas (status bukan
--    'lunas' / 'batal') -- pengecekan ini dilakukan di app.js
--    (arsipkanSemuaJamaah) SEBELUM update dikirim ke sini.
-- 2. Jamaah yang diarsip pindah total ke menu "Arsip Jamaah",
--    keluar dari kb_jamaah versi aktif (difilter diarsipkan=false
--    di semua query utama) dan tidak dihitung di metrics aktif.
--    Program induknya (programs.is_active) ikut dinonaktifkan
--    otomatis di aksi yang sama.
-- 3. TIDAK ada fitur un-arsip -- sekali diarsip, tetap diarsip.
--    Riwayat pembayaran (pembayaran_jamaah), kuitansi, dan
--    jamaah_audit_log TETAP nyambung normal lewat jamaah_id yang
--    sama (tidak ikut dipindah/diduplikasi), sehingga di menu Arsip
--    Jamaah tetap bisa lihat riwayat & cetak ulang kuitansi lama.
-- ============================================================

alter table kb_jamaah
    add column if not exists diarsipkan boolean not null default false;

alter table kb_jamaah
    add column if not exists diarsipkan_at timestamptz;

comment on column kb_jamaah.diarsipkan is
    'true = jamaah sudah pulang & diarsipkan (sekali arsip, tidak bisa di-unarsip). Semua query alur kerja utama HARUS filter diarsipkan=false.';
comment on column kb_jamaah.diarsipkan_at is
    'Waktu jamaah ini diarsipkan lewat tombol "Arsipkan Semua".';

create index if not exists idx_kb_jamaah_diarsipkan on kb_jamaah (diarsipkan);

-- ============================================================
-- SELESAI. Langkah selanjutnya (di kode, bukan SQL):
-- - loadKbJamaah() / loadKbJamaahForProgram() di js/app.js sudah
--   diubah untuk filter .eq('diarsipkan', false).
-- - Tombol "Arsipkan Semua" di tab Keberangkatan memanggil
--   arsipkanSemuaJamaah(programId) di js/app.js, yang melakukan:
--     1. cek tidak ada jamaah berstatus selain lunas/batal
--     2. update kb_jamaah set diarsipkan=true, diarsipkan_at=now()
--        where program_id=X and diarsipkan=false
--     3. update programs set is_active=false where id=X
--     4. catat ke jamaah_audit_log (aksi: 'diarsipkan')
-- - Menu baru "Arsip Jamaah" (tab-arsip) read-only: lihat data,
--   riwayat pembayaran, cetak ulang kuitansi -- tanpa tombol
--   edit/hapus/tambah pembayaran.
-- ============================================================
