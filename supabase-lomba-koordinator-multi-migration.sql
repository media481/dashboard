-- ============================================================
-- Lomba: koordinator bisa lebih dari satu orang
-- ============================================================
-- Sebelumnya kt_lomba.koordinator_anggota_id hanya menyimpan SATU id
-- anggota (kolom uuid tunggal). Sekarang satu lomba bisa punya beberapa
-- koordinator sekaligus, disimpan sebagai array id di kolom jsonb baru
-- koordinator_anggota_ids. Kolom lama koordinator_anggota_id tetap
-- dipertahankan (diisi otomatis = koordinator pertama) supaya data lama
-- / query lain yang masih memakainya tidak rusak.

alter table kt_lomba
  add column if not exists koordinator_anggota_ids jsonb not null default '[]'::jsonb;

-- Migrasi data lama: pindahkan koordinator_anggota_id (kalau ada) jadi
-- elemen pertama di koordinator_anggota_ids.
update kt_lomba
set koordinator_anggota_ids = jsonb_build_array(koordinator_anggota_id)
where koordinator_anggota_id is not null
  and (koordinator_anggota_ids is null or koordinator_anggota_ids = '[]'::jsonb);
