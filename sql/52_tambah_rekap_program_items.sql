-- ============================================================
-- REKAP PROGRAM: cache daftar gambar dari folder Google Drive
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- (aman dijalankan berkali-kali)
--
-- Dipakai kartu "Rekap Program" di dashboard (klik -> modal gambar
-- 1080 x 1920). Polanya sama dengan tabel infografis_items:
--   Drive (folder khusus rekap) -> Apps Script -> Edge Function
--   sync-rekap-program -> tabel ini -> dibaca dashboard.
-- Hanya Edge Function (service role) yang menulis; dashboard cuma
-- membaca, jadi TIDAK ada policy insert/update/delete.
-- ============================================================

create table if not exists rekap_program_items (
  id               text primary key,          -- ID file Google Drive
  name             text,
  thumb_url        text,
  full_url         text,
  drive_updated_at timestamptz,
  synced_at        timestamptz default now()
);

alter table rekap_program_items enable row level security;

drop policy if exists "Auth read rekap_program_items" on rekap_program_items;
create policy "Auth read rekap_program_items" on rekap_program_items
  for select using (auth.role() = 'authenticated');
