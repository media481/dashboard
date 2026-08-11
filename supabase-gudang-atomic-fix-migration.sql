-- ============================================================
-- MIGRASI: perbaikan 2 celah data-integrity di modul Gudang Aset
-- Jalankan di Supabase Dashboard project MERDEKA > SQL Editor > Run.
-- Aman dijalankan berkali-kali (idempotent).
--
-- MASALAH #1 — Ajukan Pinjam: insert baris kt_gudang_transaction_items
-- sebelumnya dilakukan di JS tanpa dicek errornya, SETELAH stok sudah
-- dikurangi & transaksi sudah tercatat 'aktif'. Kalau salah satu insert
-- itu gagal (network flaky, dsb), stok sudah terlanjur berkurang
-- permanen tapi baris rincian barangnya tidak lengkap — riwayat
-- peminjaman jadi tidak akurat tanpa jejak apa pun.
--
-- MASALAH #2 — Ubah Status (Riwayat Peminjaman): stok dikembalikan/
-- dikurangi lagi (return_stock / reborrow_stock) SEBELUM update status
-- transaksi dikirim. Kalau update status itu gagal di tengah jalan,
-- stok sudah terlanjur berubah padahal status di database masih yang
-- lama — kalau admin retry, stok bisa berubah dua kali untuk satu aksi.
--
-- PERBAIKAN: satukan seluruh langkah (insert/lock/update stok + status)
-- jadi SATU transaksi atomik di server per aksi, mengikuti pola yang
-- sudah dipakai di kt_gudang_update_asset (supabase-gudang-race-fix-
-- migration.sql) — kalau ada langkah yang gagal di tengah, PostgreSQL
-- otomatis rollback semuanya, tidak ada state setengah jalan.
-- ============================================================

-- ------------------------------------------------------------
-- FIX #1: kt_gudang_submit_pinjam
-- Insert transaksi + rincian barang + potong stok tiap item, semuanya
-- dalam satu fungsi. p_items berupa JSON array: [{item_id, nama, gudang, qty}, ...]
-- Kalau stok item mana pun tidak cukup (atau item tidak ditemukan),
-- fungsi RAISE EXCEPTION -> seluruh transaksi (termasuk yang sudah
-- sempat jalan sebelumnya di loop yang sama) otomatis dibatalkan oleh
-- Postgres, tidak perlu rollback manual dari JS lagi.
-- ------------------------------------------------------------
drop function if exists kt_gudang_submit_pinjam(text, text, text, text, text, date, date, jsonb);
create function kt_gudang_submit_pinjam(
  p_trx_id text, p_resi text, p_nama text, p_alamat text, p_wa text,
  p_tgl_pinjam date, p_tgl_kembali date, p_items jsonb
)
returns table(trx_id text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  it jsonb;
  v_item_id text;
  v_qty integer;
  v_nama text;
  v_tersedia integer;
begin
  insert into kt_gudang_transactions (id, resi, nama, alamat, wa, tgl_pinjam, tgl_kembali, status)
  values (p_trx_id, p_resi, p_nama, p_alamat, p_wa, p_tgl_pinjam, p_tgl_kembali, 'aktif');

  for it in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := it->>'item_id';
    v_qty := (it->>'qty')::integer;
    v_nama := it->>'nama';

    -- Kunci baris item ini supaya tidak balapan dengan pengajuan pinjam lain
    -- yang menyentuh item yang sama secara bersamaan.
    select tersedia into v_tersedia from kt_gudang_inventory where id = v_item_id for update;
    if v_tersedia is null then
      raise exception 'Barang "%" tidak ditemukan (mungkin baru saja dihapus).', v_nama;
    end if;
    if v_tersedia < v_qty then
      raise exception 'Stok "%" tidak cukup — mungkin baru saja dipinjam orang lain. Silakan coba lagi.', v_nama;
    end if;

    update kt_gudang_inventory set tersedia = tersedia - v_qty where id = v_item_id;

    insert into kt_gudang_transaction_items (transaction_id, item_id, nama, gudang, qty)
    values (p_trx_id, v_item_id, v_nama, it->>'gudang', v_qty);
  end loop;

  return query select p_trx_id;
end;
$$;
grant execute on function kt_gudang_submit_pinjam(text, text, text, text, text, date, date, jsonb) to anon;

-- ------------------------------------------------------------
-- FIX #2: kt_gudang_change_status
-- Mengunci baris transaksi, hitung & ubah stok SEKALIGUS update status
-- dalam satu transaksi atomik. Mengembalikan tersedia terbaru tiap item
-- yang terdampak, supaya JS bisa sinkron tanpa hitung ulang sendiri.
-- Kalau status baru == status lama, tidak melakukan apa-apa (mencegah
-- stok berubah dobel kalau di-klik/retry dengan status yang sama).
-- ------------------------------------------------------------
drop function if exists kt_gudang_change_status(text, text);
create function kt_gudang_change_status(p_trx_id text, p_new_status text)
returns table(item_id text, tersedia integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_old_status text;
  v_was_active boolean;
  v_now_selesai boolean;
  it record;
begin
  select status into v_old_status from kt_gudang_transactions where id = p_trx_id for update;
  if v_old_status is null then
    raise exception 'Transaksi tidak ditemukan (mungkin sudah dihapus di device lain).';
  end if;

  if v_old_status = p_new_status then
    return; -- tidak ada perubahan, tidak perlu sentuh stok
  end if;

  v_was_active := v_old_status in ('aktif', 'bermasalah');
  v_now_selesai := p_new_status = 'selesai';

  if v_now_selesai and v_was_active then
    for it in select ti.item_id, ti.qty from kt_gudang_transaction_items ti
              where ti.transaction_id = p_trx_id and ti.item_id is not null
    loop
      update kt_gudang_inventory k set tersedia = least(k.total, k.tersedia + it.qty) where k.id = it.item_id;
    end loop;
  elsif v_old_status = 'selesai' and not v_now_selesai then
    for it in select ti.item_id, ti.qty from kt_gudang_transaction_items ti
              where ti.transaction_id = p_trx_id and ti.item_id is not null
    loop
      update kt_gudang_inventory k set tersedia = greatest(0, k.tersedia - it.qty) where k.id = it.item_id;
    end loop;
  end if;

  update kt_gudang_transactions set status = p_new_status where id = p_trx_id;

  return query
    select ti.item_id, k.tersedia
    from kt_gudang_transaction_items ti
    join kt_gudang_inventory k on k.id = ti.item_id
    where ti.transaction_id = p_trx_id and ti.item_id is not null;
end;
$$;
grant execute on function kt_gudang_change_status(text, text) to anon;
