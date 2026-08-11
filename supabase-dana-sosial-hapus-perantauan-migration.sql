-- ============================================================
-- MIGRASI: hapus fitur Perantauan dari Dana Sosial.
--
-- Latar belakang: Anggota Perantauan sebelumnya ditangani di Dana Sosial
-- (bayar rapel setahun sekali, tabel terpisah). Keputusan baru: pembayaran
-- Perantauan sekarang untuk kegiatan Halal Bihalal, dikelola lewat menu
-- Anggota (Iuran per-Event, kategori "Perantauan") — BUKAN lewat Dana
-- Sosial lagi. Lihat js/22-dana-sosial.js & js/12-jadwal-agenda-kas.js
-- untuk perubahan kode sisi client-nya.
--
-- Migrasi ini:
--   1) Menghapus SEMUA riwayat bayar (kt_dana_sosial_bayar) milik anggota
--      yang sebelumnya ditandai perantauan = true.
--   2) Menghapus anggota tsb dari kt_dana_sosial_anggota.
--   3) Menghapus kolom `perantauan` dari kt_dana_sosial_anggota (sudah
--      tidak dipakai kode client sama sekali).
--
-- PERINGATAN: langkah 1 & 2 BERSIFAT DESTRUKTIF — riwayat bayar Dana
-- Sosial anggota Perantauan (kalau ada yang sudah tercatat lunas di sana)
-- akan hilang permanen. Sesuai keputusan: uang itu memang bukan Dana
-- Sosial, jadi datanya tidak perlu dipertahankan di tabel ini. Kalau
-- suatu saat perlu arsip riwayatnya, backup dulu manual sebelum
-- menjalankan migrasi ini (mis. `select * from kt_dana_sosial_anggota
-- where perantauan = true` dan `select * from kt_dana_sosial_bayar where
-- anggota_id in (...)`).
--
-- Aman dijalankan berkali-kali (idempotent) — begitu kolom `perantauan`
-- sudah tidak ada, blok DELETE otomatis dilewati lewat pengecekan
-- to_regclass/column, dan `drop column if exists` tidak error walau
-- diulang.
-- ============================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'kt_dana_sosial_anggota' and column_name = 'perantauan'
  ) then
    delete from kt_dana_sosial_bayar
      where anggota_id in (select id from kt_dana_sosial_anggota where perantauan = true);

    delete from kt_dana_sosial_anggota
      where perantauan = true;
  end if;
end $$;

alter table kt_dana_sosial_anggota
  drop column if exists perantauan;
