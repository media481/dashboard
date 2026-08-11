-- ============================================================
-- MIGRASI: perbaikan race condition saat EDIT ASET (Total Unit) di Gudang
-- Jalankan di Supabase Dashboard project MERDEKA > SQL Editor > Run.
-- Aman dijalankan berkali-kali (idempotent).
--
-- MASALAH YANG DIPERBAIKI:
-- Sebelumnya, "Ubah Aset" di menu Gudang > Kelola Inventaris menghitung
-- field `tersedia` di sisi JS (browser), pakai data `total`/`tersedia`
-- yang sudah di-load sebelumnya (bisa basi, karena modul Gudang belum
-- auto-refresh berkala) lalu langsung UPDATE menimpa baris di server.
--
-- Skenario race condition:
--   1. Admin membuka form edit "Kursi Plastik" (total=10, tersedia=6 —
--      versi yang tampil di layarnya, mungkin sudah beberapa menit lalu).
--   2. Sementara form terbuka, ada warga lain mengajukan pinjam 2 unit
--      lewat RPC kt_gudang_borrow_stock -> tersedia di SERVER jadi 4.
--   3. Admin mengubah Total Unit jadi 12 lalu simpan. JS menghitung
--      "dipinjam" dari data lamanya (10-6=4), lalu mengirim
--      tersedia = 12-4 = 8 -- PADAHAL yang benar 12-6 = 6 (karena 6 unit
--      sedang dipinjam, bukan 4). Update ini MENIMPA angka yang sudah
--      benar di server dengan angka yang salah, tanpa peringatan apa pun.
--
-- PERBAIKAN:
-- Pindahkan seluruh logika (baca jumlah yang sedang dipinjam + hitung
-- tersedia baru + tulis) jadi SATU transaksi atomik di server, pakai
-- `select ... for update` supaya baris terkunci selama proses ini —
-- request kt_gudang_borrow_stock/return_stock dari device lain yang
-- menyentuh baris yang sama akan otomatis MENUNGGU giliran, bukan
-- race. Kalau ternyata Total Unit baru < jumlah yang sedang dipinjam
-- (kasus: ada yang baru saja pinjam lebih banyak sebelum admin
-- menyimpan), fungsi ini menolak (0 baris dikembalikan) dan JS akan
-- kasih tahu admin untuk menyegarkan data dan coba lagi — bukan diam-
-- diam menyimpan angka yang salah.
-- ============================================================

drop function if exists kt_gudang_update_asset(text, text, text, integer);
create function kt_gudang_update_asset(p_item_id text, p_nama text, p_gudang text, p_new_total integer)
returns table(id text, nama text, gudang text, total integer, tersedia integer, last_updated date)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_total integer;
  v_tersedia integer;
  v_dipinjam integer;
begin
  -- Kunci baris ini sampai transaksi selesai (commit/rollback), supaya
  -- borrow_stock/return_stock dari device lain menunggu, bukan balapan.
  select total, tersedia into v_total, v_tersedia
    from kt_gudang_inventory where kt_gudang_inventory.id = p_item_id
    for update;

  if v_total is null then
    return; -- item tidak ditemukan (mis. sudah dihapus device lain) -> 0 baris
  end if;

  v_dipinjam := v_total - v_tersedia;
  if p_new_total < v_dipinjam then
    return; -- total baru lebih kecil dari yang sedang dipinjam SAAT INI -> tolak, 0 baris
  end if;

  return query
    update kt_gudang_inventory k
    set nama = p_nama,
        gudang = p_gudang,
        total = p_new_total,
        tersedia = p_new_total - v_dipinjam,
        last_updated = current_date
    where k.id = p_item_id
    returning k.id, k.nama, k.gudang, k.total, k.tersedia, k.last_updated;
end;
$$;
grant execute on function kt_gudang_update_asset(text, text, text, integer) to anon;
