-- ============================================================
-- MIGRASI: Tabel Pembayaran & Cicilan Jamaah
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Aman dijalankan di project yang SUDAH ada isinya (pakai IF NOT EXISTS),
-- tidak akan menghapus/mengubah data yang sudah ada.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists pembayaran_jamaah (
    id uuid primary key default gen_random_uuid(),
    jamaah_id uuid not null references kb_jamaah(id) on delete cascade,
    tanggal date not null default current_date,
    jumlah numeric not null default 0,
    metode text,
    keterangan text,
    created_at timestamptz not null default now()
);

create index if not exists idx_pembayaran_jamaah_jamaah_id on pembayaran_jamaah (jamaah_id);
create index if not exists idx_pembayaran_jamaah_tanggal on pembayaran_jamaah (tanggal desc);

alter table pembayaran_jamaah enable row level security;

create policy "Allow read pembayaran_jamaah" on pembayaran_jamaah for select using (true);
create policy "Allow insert pembayaran_jamaah" on pembayaran_jamaah for insert with check (true);
create policy "Allow update pembayaran_jamaah" on pembayaran_jamaah for update using (true);
create policy "Allow delete pembayaran_jamaah" on pembayaran_jamaah for delete using (true);

-- Selesai. Setelah ini fitur "Pembayaran & Cicilan" di menu sidebar siap dipakai.
