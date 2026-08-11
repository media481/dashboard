-- ============================================================
-- MIGRASI: tabel kt_bookmark
-- Untuk fitur baru "Tautan Penting" — kumpulan link penting
-- organisasi (grup WA, form, rekening, dsb), TIDAK terikat event
-- tahunan (17-an) sama sekali, mengikuti pola kt_agenda/kt_kas
-- (tidak ada kolom event_id).
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================
create table if not exists kt_bookmark (
  id uuid primary key default gen_random_uuid(),
  judul text not null default '',
  url text not null default '',
  deskripsi text,
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

drop trigger if exists trg_set_updated_at on kt_bookmark;
create trigger trg_set_updated_at before update on kt_bookmark
  for each row execute function kt_set_updated_at();

alter table kt_bookmark enable row level security;
drop policy if exists "anon_full_access" on kt_bookmark;
create policy "anon_full_access" on kt_bookmark
  for all to anon using (true) with check (true);
