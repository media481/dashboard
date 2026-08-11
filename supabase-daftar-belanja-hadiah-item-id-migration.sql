-- ============================================================
-- MIGRASI: kolom item_id di tabel kt_daftar_belanja_hadiah
--
-- Kode aplikasi (lihat migrasiItemIdHadiah() & ARRAY_TABLE_MAP di
-- script.js) sudah lama pindah dari melacak status "dibeli" pakai
-- `item_index` (posisi item dalam array, rapuh karena bisa geser
-- kalau item dihapus/direorder) ke `item_id` (id tetap per item
-- hadiah). Tabel kt_daftar_belanja_hadiah di Supabase ternyata belum
-- pernah di-ALTER untuk menambahkan kolom ini, jadi setiap kali app
-- mencoba menyimpan centang belanja hadiah, PostgREST menolak dengan
-- error PGRST204: "Could not find the 'item_id' column of
-- 'kt_daftar_belanja_hadiah' in the schema cache".
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================

alter table kt_daftar_belanja_hadiah
  add column if not exists item_id uuid;

-- PostgREST cache skema kolom di memori supaya query cepat. Setelah ALTER
-- TABLE, cache itu perlu di-refresh manual lewat NOTIFY ini — kalau tidak,
-- error "Could not find the 'xxx' column ... in the schema cache" masih akan
-- muncul walau kolomnya sudah ada, sampai PostgREST reload sendiri (biasa
-- makan waktu beberapa menit).
notify pgrst, 'reload schema';
