-- ============================================================
-- MIGRASI: Tabel Pendaftaran Calon Jamaah
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Aman dijalankan di project yang SUDAH ada isinya (pakai IF NOT EXISTS),
-- tidak akan menghapus/mengubah data yang sudah ada.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists pendaftaran (
    id uuid primary key default gen_random_uuid(),
    program_id uuid references programs(id) on delete set null,
    nama text not null,
    wa text,
    asal text,
    status text not null default 'baru',
    catatan text,
    created_at timestamptz not null default now()
);

create index if not exists idx_pendaftaran_program_id on pendaftaran (program_id);
create index if not exists idx_pendaftaran_created_at on pendaftaran (created_at desc);

alter table pendaftaran enable row level security;

create policy "Allow read pendaftaran" on pendaftaran for select using (true);
create policy "Allow insert pendaftaran" on pendaftaran for insert with check (true);
create policy "Allow update pendaftaran" on pendaftaran for update using (true);
create policy "Allow delete pendaftaran" on pendaftaran for delete using (true);

-- Selesai. Setelah ini fitur "Form Pendaftaran" di menu sidebar siap dipakai.
