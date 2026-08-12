-- Jalankan di Supabase Dashboard -> SQL Editor
create table if not exists kwt_kuitansi (
    id uuid primary key default gen_random_uuid(),
    jamaah_id uuid null,
    nomor text,
    tempat_tanggal text,
    dari text not null,
    jumlah numeric not null default 0,
    terbilang text,
    keterangan text,
    penerima text,
    created_at timestamptz not null default now()
);

create index if not exists idx_kwt_kuitansi_created_at on kwt_kuitansi (created_at desc);
create index if not exists idx_kwt_kuitansi_jamaah_id on kwt_kuitansi (jamaah_id);

alter table kwt_kuitansi enable row level security;

-- Samakan dengan pola RLS tabel kb_jamaah/programs yang sudah ada di project ini
-- (akses langsung via anon key dari sisi client). Sesuaikan bila kebijakan RLS
-- project Anda berbeda / lebih ketat.
create policy "Allow read kwt_kuitansi" on kwt_kuitansi for select using (true);
create policy "Allow insert kwt_kuitansi" on kwt_kuitansi for insert with check (true);
create policy "Allow delete kwt_kuitansi" on kwt_kuitansi for delete using (true);
