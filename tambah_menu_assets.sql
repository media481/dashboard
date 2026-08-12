-- ============================================================
-- MIGRASI: Menu "Assets" -- kumpulan link ke dokumen penting
-- (SOP, kontrak, akun cloud, dsb), mirip fitur bookmark.
-- Hanya bisa diakses lewat Admin Panel (menu Manajemen), tidak
-- tampil di halaman publik.
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ============================================================

create table if not exists assets (
    id uuid primary key default gen_random_uuid(),
    judul text not null,
    url text not null,
    kategori text,
    catatan text,
    created_at timestamptz not null default now()
);

create index if not exists idx_assets_kategori on assets (kategori);

alter table assets enable row level security;

-- Tabel ini isinya link internal (kadang berisi dokumen sensitif), jadi
-- read & write SEKALIGUS dikunci ke auth.role() = 'authenticated' --
-- konsisten dengan pola hardening_rls_pembayaran_select.sql, BUKAN
-- "using(true)" seperti tabel programs yang memang harus publik.
drop policy if exists "Auth read assets" on assets;
create policy "Auth read assets" on assets for select using (auth.role() = 'authenticated');

drop policy if exists "Auth insert assets" on assets;
create policy "Auth insert assets" on assets for insert with check (auth.role() = 'authenticated');

drop policy if exists "Auth update assets" on assets;
create policy "Auth update assets" on assets for update using (auth.role() = 'authenticated');

drop policy if exists "Auth delete assets" on assets;
create policy "Auth delete assets" on assets for delete using (auth.role() = 'authenticated');

-- Selesai. Setelah ini, menu "Assets" akan muncul di sidebar Admin Panel
-- (khusus akun yang login/authenticated) dan siap dipakai.
