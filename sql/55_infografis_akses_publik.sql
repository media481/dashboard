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
-- ============================================================

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
