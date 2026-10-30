-- ============================================================
-- INFOGRAFIS: boleh dibuka TANPA login (baca saja)
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- (aman dijalankan berkali-kali)
--
-- Kartu "Infografis" di dashboard utama (pengganti kartu Jadwal Tamu) memakai
-- modal galeri + pratinjau yang sama dengan "Rekap Program" (lihat sql/53).
-- Supaya pengunjung tanpa login (anon key) bisa membuka galerinya, tabel
-- infografis_items harus boleh DIBACA role anon.
--
-- Isi tabel hanya nama file + URL thumbnail/gambar Google Drive (folder infografis
-- yang memang sudah di-share "Anyone with the link"), jadi tidak ada data sensitif.
-- Policy insert/update/delete TIDAK disentuh: hanya Edge Function sync-infografis
-- (service role) yang menulis, dan tombol Refresh tetap hanya untuk admin/user.
--
-- CATATAN URUTAN: tidak ada migrasi lain yang membuat tabel infografis_items
-- (dulu dibuat manual), jadi file ini membuatnya sendiri bila belum ada (kolom
-- sama dengan rekap_program_items di sql/52). Aman untuk tabel yang sudah ada.
-- Sudah termasuk di sql/00_SETUP_LENGKAP_SATU_FILE.sql.
-- ============================================================

create table if not exists infografis_items (
  id               text primary key,          -- ID file Google Drive
  name             text,
  thumb_url        text,
  full_url         text,
  drive_updated_at timestamptz,
  synced_at        timestamptz default now()
);

alter table infografis_items enable row level security;

-- Buang policy SELECT lama (apa pun namanya, mis. "Auth read infografis_items")
-- supaya tidak ada dua policy baca yang saling tumpang tindih.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'infografis_items' and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.infografis_items', pol.policyname);
  end loop;
end $$;

create policy "Public read infografis_items" on infografis_items
  for select to anon, authenticated using (true);
