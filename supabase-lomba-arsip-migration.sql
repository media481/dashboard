-- ============================================================
-- MIGRASI: tabel kt_lomba_arsip
--
-- Untuk fitur "Arsip Lomba" — snapshot BEKU lomba+perlengkapannya
-- yang dibuat OTOMATIS saat sebuah lomba dihapus lewat menu Lomba &
-- Perlengkapan (lihat hapusLomba() di js/10-lomba.js). Tujuannya
-- supaya menu Database Lomba (js/10b-database-lomba.js) tetap
-- menyimpan riwayat lomba tsb SELAMANYA walau data aslinya di
-- kt_lomba/kt_lomba_kebutuhan sudah dihapus.
--
-- SENGAJA TIDAK ada foreign key ke kt_lomba atau kt_events — semua
-- datanya adalah snapshot/beku (termasuk nama event & tahun saat itu
-- disimpan sebagai teks biasa), supaya baris di sini tetap aman dan
-- tidak ikut terhapus walau lomba ATAU event aslinya sudah tidak ada.
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================
create table if not exists kt_lomba_arsip (
  id uuid primary key default gen_random_uuid(),
  nama text not null default '',
  kategori_peserta text,
  jumlah_anggota_regu integer default 1,
  hadiah_per_regu boolean default false,
  event_nama text,
  event_tahun text,
  tanggal_arsip date,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Trigger updated_at (fungsi ini sudah dibuat oleh
-- supabase-conflict-detection-migration.sql, tapi didefinisikan ulang
-- di sini juga supaya file ini tetap bisa dijalankan berdiri sendiri).
create or replace function kt_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at on kt_lomba_arsip;
create trigger trg_set_updated_at before update on kt_lomba_arsip
  for each row execute function kt_set_updated_at();

alter table kt_lomba_arsip enable row level security;
drop policy if exists "anon_full_access" on kt_lomba_arsip;
create policy "anon_full_access" on kt_lomba_arsip
  for all to anon using (true) with check (true);
