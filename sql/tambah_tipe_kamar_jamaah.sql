-- ============================================================
-- Tambah kolom tipe_kamar di kb_jamaah
-- ============================================================
-- Latar belakang: harga tagihan per jamaah sebelumnya SELALU memakai
-- harga_quint milik program (lihat komentar di js/app.js sekitar baris 1918:
-- "Data lama: harga_quint sebenarnya dipakai sebagai harga Quad"), padahal
-- satu program bisa punya harga berbeda untuk Quad/Triple/Double. Kalau ada
-- jamaah yang ambil kamar Triple/Double, status "lunas/belum lunas"-nya jadi
-- salah karena dihitung pakai harga Quad.
--
-- Kolom ini menyimpan tipe kamar yang diambil jamaah, dipakai aplikasi untuk
-- memilih harga acuan yang benar (harga_quad / harga_triple / harga_double)
-- saat menghitung status pembayaran. Default 'quad' supaya data lama (yang
-- belum punya nilai) tetap berperilaku sama seperti sebelumnya (pakai harga
-- Quad/Quint, tidak ada perubahan tagihan mendadak untuk jamaah lama).
-- ============================================================

alter table kb_jamaah
    add column if not exists tipe_kamar text not null default 'quad';

alter table kb_jamaah
    drop constraint if exists kb_jamaah_tipe_kamar_check;

alter table kb_jamaah
    add constraint kb_jamaah_tipe_kamar_check
    check (tipe_kamar in ('quad', 'triple', 'double'));

comment on column kb_jamaah.tipe_kamar is
    'Tipe kamar yang diambil jamaah (quad/triple/double) — menentukan harga acuan tagihan dari harga_quad/harga_triple/harga_double di tabel programs. Default quad = perilaku lama (pakai harga_quint/harga_quad).';
