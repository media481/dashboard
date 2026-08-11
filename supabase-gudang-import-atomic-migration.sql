-- ============================================================
-- MIGRASI: import backup Gudang jadi atomik (semua-atau-tidak-sama-sekali)
-- Jalankan di Supabase Dashboard project MERDEKA > SQL Editor > Run.
-- Aman dijalankan berkali-kali (idempotent).
--
-- MASALAH: Import Gudang (tombol "Import Backup" di tab Kelola
-- Inventaris) sebelumnya melakukan banyak insert/upsert terpisah satu
-- per satu langsung dari JS (satu per aset, satu per transaksi, satu
-- per item). Kalau koneksi terputus atau salah satu baris gagal di
-- tengah proses, sebagian data sudah kepalang tersimpan sementara
-- sisanya tidak — hasil akhirnya campur aduk (setengah ke-import)
-- tanpa cara mudah buat tahu baris mana saja yang berhasil.
--
-- PERBAIKAN: satukan SELURUH proses import (semua aset + semua
-- transaksi + semua item) jadi SATU transaksi atomik di server, mengikuti
-- pola yang sama seperti kt_gudang_submit_pinjam & kt_gudang_change_status
-- (lihat supabase-gudang-atomic-fix-migration.sql) — kalau ada satu saja
-- baris yang gagal (mis. format data rusak), PostgreSQL otomatis
-- rollback SEMUANYA, jadi tidak pernah ada state "setengah ke-import".
--
-- Import bersifat "upsert": aset & transaksi yang id-nya sudah ada akan
-- ditimpa datanya (bukan didobel), sesuai perilaku sebelumnya. Khusus
-- rincian barang per transaksi (kt_gudang_transaction_items) dihapus
-- dulu lalu ditulis ulang per transaksi yang di-import, supaya import
-- file backup yang sama berkali-kali tidak numpuk baris duplikat.
-- ============================================================

drop function if exists kt_gudang_import_backup(jsonb, jsonb);
create function kt_gudang_import_backup(p_inventory jsonb, p_transactions jsonb)
returns table(inventory_count integer, transaction_count integer, item_count integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  inv jsonb;
  trx jsonb;
  it jsonb;
  v_trx_id text;
  v_inv_count integer := 0;
  v_trx_count integer := 0;
  v_item_count integer := 0;
begin
  for inv in select * from jsonb_array_elements(coalesce(p_inventory, '[]'::jsonb))
  loop
    if coalesce(inv->>'nama', '') = '' or coalesce(inv->>'gudang', '') = '' then
      raise exception 'Data aset tidak lengkap (nama/lokasi kosong): %', inv;
    end if;

    insert into kt_gudang_inventory (id, nama, gudang, total, tersedia, is_active, last_updated)
    values (
      coalesce(nullif(inv->>'id', ''), gen_random_uuid()::text),
      inv->>'nama', inv->>'gudang',
      coalesce((inv->>'total')::integer, 0),
      coalesce((inv->>'tersedia')::integer, 0),
      coalesce((inv->>'isActive')::boolean, true),
      coalesce(nullif(inv->>'lastUpdated','')::timestamptz, now())
    )
    on conflict (id) do update set
      nama = excluded.nama, gudang = excluded.gudang, total = excluded.total,
      tersedia = excluded.tersedia, is_active = excluded.is_active, last_updated = excluded.last_updated;
    v_inv_count := v_inv_count + 1;
  end loop;

  for trx in select * from jsonb_array_elements(coalesce(p_transactions, '[]'::jsonb))
  loop
    v_trx_id := coalesce(nullif(trx->>'id', ''), gen_random_uuid()::text);

    insert into kt_gudang_transactions (id, resi, nama, alamat, wa, tgl_pinjam, tgl_kembali, status)
    values (
      v_trx_id, trx->>'resi', trx->>'nama', trx->>'alamat', trx->>'wa',
      nullif(trx->>'tglPinjam','')::date, nullif(trx->>'tglKembali','')::date,
      coalesce(nullif(trx->>'status',''), 'aktif')
    )
    on conflict (id) do update set
      resi = excluded.resi, nama = excluded.nama, alamat = excluded.alamat, wa = excluded.wa,
      tgl_pinjam = excluded.tgl_pinjam, tgl_kembali = excluded.tgl_kembali, status = excluded.status;
    v_trx_count := v_trx_count + 1;

    delete from kt_gudang_transaction_items where transaction_id = v_trx_id;

    for it in select * from jsonb_array_elements(coalesce(trx->'items', '[]'::jsonb))
    loop
      insert into kt_gudang_transaction_items (transaction_id, item_id, nama, gudang, qty)
      values (v_trx_id, it->>'itemId', it->>'nama', it->>'gudang', coalesce((it->>'qty')::integer, 0));
      v_item_count := v_item_count + 1;
    end loop;
  end loop;

  return query select v_inv_count, v_trx_count, v_item_count;
end;
$$;
grant execute on function kt_gudang_import_backup(jsonb, jsonb) to anon;
