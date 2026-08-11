-- ============================================================
-- MIGRASI: Modul Gudang Aset Desa -> digabung ke project Supabase Merdeka
-- Jalankan di Supabase Dashboard (project MERDEKA, bukan project Gudang lama)
--   > SQL Editor > New query > Run
-- Aman dijalankan berkali-kali (idempotent).
--
-- KONTEKS:
-- Sebelumnya modul Gudang (pinjam-meminjam aset desa) punya project
-- Supabase sendiri, terpisah dari Merdeka. Migrasi ini membuat tabel yang
-- sama persis di project Merdeka dengan prefix "kt_gudang_" supaya searasi
-- dengan tabel lain (kt_events, kt_anggota, dst) dan tidak tabrakan nama.
--
-- Data lama di project Gudang TIDAK otomatis pindah lewat SQL ini — kalau
-- ada data produksi lama yang mau dibawa, export dulu dari project lama
-- (lihat tombol Export JSON di menu Gudang > Kelola setelah migrasi ini
-- jalan, atau langsung lewat Supabase Table Editor > Export CSV) lalu
-- import manual / lewat tombol Import JSON di halaman yang sama.
--
-- AKSES: Modul ini TIDAK pakai PIN terpisah lagi. Hak kelola (tambah/edit/
-- hapus aset, ubah status peminjaman, hapus riwayat) memakai role login
-- Merdeka yang sudah ada (admin/user/petugas) — hanya role admin yang
-- boleh mengelola, sama seperti menu Merdeka lain yang adminOnly.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- TABEL
-- ============================================================

create table if not exists kt_gudang_inventory (
  id text primary key,
  nama text not null default '',
  gudang text not null default '',
  total integer not null default 0,
  tersedia integer not null default 0,
  is_active boolean not null default true,
  last_updated date,
  created_at timestamptz default now()
);

create table if not exists kt_gudang_transactions (
  id text primary key,
  resi text not null default '',
  nama text not null default '',
  alamat text not null default '',
  wa text not null default '',
  tgl_pinjam date,
  tgl_kembali date,
  status text not null default 'aktif', -- aktif | selesai | bermasalah
  created_at timestamptz default now()
);

create table if not exists kt_gudang_transaction_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null references kt_gudang_transactions(id) on delete cascade,
  item_id text,
  nama text not null default '',
  gudang text not null default '',
  qty integer not null default 0,
  created_at timestamptz default now()
);

-- Baris tunggal untuk nomor urut resi (mis. TRX-001, TRX-002, ...)
create table if not exists kt_gudang_resi_seq (
  id int primary key default 1,
  seq integer not null default 1
);
insert into kt_gudang_resi_seq (id, seq) values (1, 1) on conflict (id) do nothing;

-- ============================================================
-- RLS — samakan pola dengan tabel kt_* lain (anon full access).
-- Aplikasi ini tidak pakai Supabase Auth; hak kelola diatur di JS
-- lewat role login Merdeka (rpc_login), sama seperti menu lain.
-- ============================================================
do $$
declare
  t text;
  tables text[] := array[
    'kt_gudang_inventory','kt_gudang_transactions','kt_gudang_transaction_items','kt_gudang_resi_seq'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "anon_full_access" on %I;', t);
    execute format(
      'create policy "anon_full_access" on %I for all to anon using (true) with check (true);', t
    );
  end loop;
end $$;

-- ============================================================
-- RPC — perubahan stok & klaim resi HARUS atomik di server supaya
-- tidak race condition ketika dua orang mengajukan pinjam bersamaan.
-- ============================================================

drop function if exists kt_gudang_claim_next_resi();
create function kt_gudang_claim_next_resi()
returns table(seq integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_seq integer;
begin
  update kt_gudang_resi_seq set seq = seq + 1 where id = 1
    returning kt_gudang_resi_seq.seq - 1 into v_seq;
  if v_seq is null then
    insert into kt_gudang_resi_seq (id, seq) values (1, 2) on conflict (id) do nothing;
    v_seq := 1;
  end if;
  return query select v_seq;
end;
$$;
grant execute on function kt_gudang_claim_next_resi() to anon;

-- Kurangi stok saat pengajuan pinjam disetujui/dikirim. Dibatasi tidak
-- boleh sampai negatif (kalau stok sudah keburu habis oleh orang lain,
-- fungsi ini akan mengembalikan 0 baris -> JS tahu harus membatalkan/rollback).
drop function if exists kt_gudang_borrow_stock(text, integer);
create function kt_gudang_borrow_stock(p_item_id text, p_qty integer)
returns table(tersedia integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
    update kt_gudang_inventory
    set tersedia = tersedia - p_qty
    where id = p_item_id and tersedia >= p_qty
    returning kt_gudang_inventory.tersedia;
end;
$$;
grant execute on function kt_gudang_borrow_stock(text, integer) to anon;

-- Kembalikan stok saat status peminjaman diubah jadi "selesai".
-- Dibatasi maksimal = total unit (tidak bisa melebihi stok total).
drop function if exists kt_gudang_return_stock(text, integer);
create function kt_gudang_return_stock(p_item_id text, p_qty integer)
returns table(tersedia integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
    update kt_gudang_inventory
    set tersedia = least(total, tersedia + p_qty)
    where id = p_item_id
    returning kt_gudang_inventory.tersedia;
end;
$$;
grant execute on function kt_gudang_return_stock(text, integer) to anon;

-- Kurangi stok lagi kalau status "selesai" dibatalkan/dikembalikan ke
-- aktif/bermasalah. Dibatasi minimal = 0 (tidak bisa sampai negatif).
drop function if exists kt_gudang_reborrow_stock(text, integer);
create function kt_gudang_reborrow_stock(p_item_id text, p_qty integer)
returns table(tersedia integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
    update kt_gudang_inventory
    set tersedia = greatest(0, tersedia - p_qty)
    where id = p_item_id
    returning kt_gudang_inventory.tersedia;
end;
$$;
grant execute on function kt_gudang_reborrow_stock(text, integer) to anon;
