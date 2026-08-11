-- ============================================================
-- MIGRASI: tabel kt_kas
-- Untuk fitur baru "Kas Karang Taruna" — buku kas umum organisasi
-- yang TIDAK terikat event tahunan (17-an) sama sekali, mengikuti
-- pola kt_agenda (tidak ada kolom event_id).
--
-- Kolom debit/kredit dipakai untuk menghitung saldo berjalan
-- (running balance) di sisi aplikasi — saldo TIDAK disimpan di
-- tabel ini supaya selalu konsisten walau ada baris yang diedit
-- atau dihapus.
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================
create table if not exists kt_kas (
  id uuid primary key default gen_random_uuid(),
  tanggal date not null default current_date,
  keterangan text not null default '',
  debit numeric not null default 0,
  kredit numeric not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function kt_set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_set_updated_at on kt_kas;
create trigger trg_set_updated_at before update on kt_kas
  for each row execute function kt_set_updated_at();

alter table kt_kas enable row level security;
drop policy if exists "anon_full_access" on kt_kas;
create policy "anon_full_access" on kt_kas
  for all to anon using (true) with check (true);
