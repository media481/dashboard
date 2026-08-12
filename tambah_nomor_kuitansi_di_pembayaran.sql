-- ============================================================
-- MIGRASI: Nomor Kuitansi otomatis, terikat ke baris pembayaran
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Prasyarat: sql/tambah_nomor_kuitansi_otomatis.sql sudah pernah dijalankan
-- (fungsi next_kuitansi_nomor() & sequence kuitansi_nomor_seq sudah ada).
--
-- Konteks: tombol & modal "Kuitansi" manual terpisah (tab Keberangkatan)
-- sudah dihapus. Sekarang hanya ada SATU pintu pencatatan pembayaran
-- ("Bayar" -> Kelola Cicilan), dan sistem sendiri yang menentukan judul
-- dokumennya:
--   - "KUITANSI"       -> kalau pembayaran itu membuat jamaah LUNAS
--                          (baik lunas sekali bayar, maupun cicilan
--                          terakhir yang menutup pelunasan)
--   - "NOTA PEMBAYARAN" -> kalau masih ada sisa tagihan (DP / cicilan)
--
-- Nomor "KUITANSI" TETAP pakai seri terpisah (AHI/KWT/... dari
-- next_kuitansi_nomor()), bukan nomor_nota biasa (AHI/<tahun>/...) --
-- supaya nomor itu permanen (tidak berubah tiap dicetak ulang), kolom baru
-- `nomor_kuitansi` ini dipakai untuk menyimpannya di baris pembayaran_jamaah
-- terkait, mirip pola nomor_nota di sql/tambah_nota_audit.sql.
-- ============================================================

alter table pembayaran_jamaah add column if not exists nomor_kuitansi text;

-- Nomor kuitansi harus unik & tidak boleh diedit ulang setelah diterbitkan
-- (sekali dokumen itu resmi jadi "KUITANSI", nomornya dikunci permanen).
create unique index if not exists idx_pembayaran_jamaah_nomor_kuitansi
    on pembayaran_jamaah (nomor_kuitansi) where nomor_kuitansi is not null;

create or replace function lindungi_nomor_kuitansi() returns trigger as $$
begin
    if old.nomor_kuitansi is not null and new.nomor_kuitansi is distinct from old.nomor_kuitansi then
        raise exception 'nomor_kuitansi tidak boleh diubah setelah diterbitkan';
    end if;
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_lindungi_nomor_kuitansi on pembayaran_jamaah;
create trigger trg_lindungi_nomor_kuitansi
    before update on pembayaran_jamaah
    for each row execute function lindungi_nomor_kuitansi();

-- Selesai. Setelah ini:
-- * Saat staf mengunduh nota dari baris pembayaran yang membuat jamaah
--   lunas, aplikasi (js/app.js -> downloadNotaPembayaran()) akan mengambil
--   1 nomor dari next_kuitansi_nomor() dan menyimpannya PERMANEN ke kolom
--   nomor_kuitansi baris itu -- jadi kalau nota yang sama diunduh ulang
--   (JPEG lalu PDF, atau di lain waktu), nomornya tetap sama, tidak
--   mengambil nomor baru dari sequence.
