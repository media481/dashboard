-- ============================================================
-- REKAP PROGRAM: boleh dibuka TANPA login (baca saja)
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- (aman dijalankan berkali-kali)
--
-- Sebelumnya (sql/52) tabel rekap_program_items hanya bisa dibaca user login.
-- Sekarang pengunjung tanpa login (anon key) juga boleh MEMBACA, supaya kartu
-- & modal "Rekap Program" bisa dibuka dari dashboard utama.
--
-- Isi tabel hanya nama file + URL thumbnail/gambar Google Drive (folder rekap yang
-- memang sudah di-share "Anyone with the link"), jadi tidak ada data sensitif.
-- Tetap TIDAK ada policy insert/update/delete: hanya Edge Function sync-rekap-program
-- (service role) yang menulis, dan tombol Refresh tetap hanya untuk admin/user.
-- ============================================================

alter table rekap_program_items enable row level security;

drop policy if exists "Auth read rekap_program_items"   on rekap_program_items;
drop policy if exists "Public read rekap_program_items" on rekap_program_items;
create policy "Public read rekap_program_items" on rekap_program_items
  for select to anon, authenticated using (true);
