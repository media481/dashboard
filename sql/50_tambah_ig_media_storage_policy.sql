-- ============================================================
-- IG Scheduler: izinkan admin/user MENGHAPUS file di bucket ig-media
-- ============================================================
-- Dipakai fitur pembersihan media yatim di js/app.js (igRemoveStorageUrls):
--   * upload yang dibatalkan / diganti / item carousel yang dibuang
--   * media milik post yang dihapus
-- OPSIONAL. Tanpa policy ini pembersihan gagal diam-diam (hanya console.warn),
-- file lama tetap menumpuk di bucket tapi data & fitur lain tidak terganggu.
-- Jalankan di Supabase SQL Editor (butuh current_dashboard_role() dari
-- sql/29_tambah_role_guest_readonly.sql / 28_migrate_supabase_auth.sql sudah ada).
-- ============================================================

drop policy if exists "ig_media_delete_admin_user" on storage.objects;
create policy "ig_media_delete_admin_user" on storage.objects
  for delete to authenticated
  using (bucket_id = 'ig-media' and public.current_dashboard_role() in ('admin','user'));
