-- ============================================================
-- MIGRASI: fitur "Dana Sosial" — iuran bulanan Rp 5.000/anggota,
-- TIDAK terikat event 17-an manapun (mengikuti pola kt_agenda/kt_kas).
--
-- Dua tabel baru:
--   1) kt_dana_sosial_anggota  → daftar anggota MASTER, terpisah
--      total dari kt_anggota (iuran per-event). Anggota baru yang
--      gabung di tengah tahun disimpan `tanggal_gabung`-nya supaya
--      bulan-bulan sebelum itu otomatis dikosongkan di sisi aplikasi
--      (bukan dianggap "belum bayar").
--   2) kt_dana_sosial_bayar    → satu baris per (anggota, tahun,
--      bulan) yang menandakan status lunas/belum. Baris baru dibuat
--      on-demand saat anggota ditandai lunas pertama kali (bulan yang
--      belum pernah disentuh otomatis dianggap "belum bayar" tanpa
--      perlu baris kosong).
--
-- Potongan konsumsi pertemuan (flat Rp 80.000/bulan) TIDAK disimpan
-- di tabel manapun — dihitung di sisi aplikasi saat rekap supaya
-- gampang diubah lagi nanti kalau kebijakan berubah.
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================

create table if not exists kt_dana_sosial_anggota (
  id uuid primary key default gen_random_uuid(),
  nama text not null,
  tanggal_gabung date not null default current_date,
  aktif boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists kt_dana_sosial_bayar (
  id uuid primary key default gen_random_uuid(),
  anggota_id uuid not null references kt_dana_sosial_anggota(id) on delete cascade,
  tahun int not null,
  bulan int not null check (bulan between 1 and 12),
  lunas boolean not null default false,
  tanggal_bayar date,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (anggota_id, tahun, bulan)
);

create index if not exists idx_dana_sosial_bayar_anggota on kt_dana_sosial_bayar(anggota_id);
create index if not exists idx_dana_sosial_bayar_tahun on kt_dana_sosial_bayar(tahun);

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

drop trigger if exists trg_set_updated_at on kt_dana_sosial_anggota;
create trigger trg_set_updated_at before update on kt_dana_sosial_anggota
  for each row execute function kt_set_updated_at();

drop trigger if exists trg_set_updated_at on kt_dana_sosial_bayar;
create trigger trg_set_updated_at before update on kt_dana_sosial_bayar
  for each row execute function kt_set_updated_at();

alter table kt_dana_sosial_anggota enable row level security;
drop policy if exists "anon_full_access" on kt_dana_sosial_anggota;
create policy "anon_full_access" on kt_dana_sosial_anggota
  for all to anon using (true) with check (true);

alter table kt_dana_sosial_bayar enable row level security;
drop policy if exists "anon_full_access" on kt_dana_sosial_bayar;
create policy "anon_full_access" on kt_dana_sosial_bayar
  for all to anon using (true) with check (true);
