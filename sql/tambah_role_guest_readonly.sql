-- ============================================================
-- TAMBAH ROLE GUEST (VIEW-ONLY) — kunci di level RLS, bukan cuma UI
-- Jalankan SETELAH migrate_supabase_auth.sql & hardening_rls_keamanan.sql
-- di SQL Editor Supabase.
--
-- MASALAH YANG DIPERBAIKI:
--   Role 'guest' sudah ada di constraint dashboard_profiles.dashboard_role
--   dan sudah dipakai untuk sembunyikan tombol tambah/edit di UI
--   (lihat canManageProgramData() di js/app.js), TAPI RLS write policy dari
--   hardening_rls_keamanan.sql cuma cek `auth.role() = 'authenticated'`.
--   Artinya SEMUA user yang login -- termasuk guest -- tetap bisa
--   insert/update/delete langsung lewat REST API Supabase (mis. pakai
--   Postman/curl dengan JWT guest), bypass tombol UI yang disembunyikan.
--
-- SOLUSI:
--   Ganti syarat write dari "authenticated" jadi "current_dashboard_role()
--   in ('admin','user')" -- guest otomatis ditolak RLS walau punya JWT sah.
--   READ tetap terbuka untuk semua (termasuk publik/anon), tidak berubah.
-- ============================================================

-- ------------------------------------------------------------
-- 1. programs
-- ------------------------------------------------------------
drop policy if exists "Auth insert programs" on programs;
drop policy if exists "Auth update programs" on programs;
create policy "Admin/User insert programs" on programs
  for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update programs" on programs
  for update using (current_dashboard_role() in ('admin','user'));
-- delete programs sudah admin-only sejak migrate_supabase_auth.sql, tidak diubah.

-- ------------------------------------------------------------
-- 2. jadwal_tamu
-- ------------------------------------------------------------
drop policy if exists "Auth insert jadwal_tamu" on jadwal_tamu;
drop policy if exists "Auth update jadwal_tamu" on jadwal_tamu;
drop policy if exists "Auth delete jadwal_tamu" on jadwal_tamu;
create policy "Admin/User insert jadwal_tamu" on jadwal_tamu
  for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update jadwal_tamu" on jadwal_tamu
  for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete jadwal_tamu" on jadwal_tamu
  for delete using (current_dashboard_role() in ('admin','user'));

-- ------------------------------------------------------------
-- 3. kb_jamaah
-- ------------------------------------------------------------
drop policy if exists "Auth insert kb_jamaah" on kb_jamaah;
drop policy if exists "Auth update kb_jamaah" on kb_jamaah;
drop policy if exists "Auth delete kb_jamaah" on kb_jamaah;
create policy "Admin/User insert kb_jamaah" on kb_jamaah
  for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update kb_jamaah" on kb_jamaah
  for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete kb_jamaah" on kb_jamaah
  for delete using (current_dashboard_role() in ('admin','user'));

-- ------------------------------------------------------------
-- 4. pendaftaran
-- ------------------------------------------------------------
drop policy if exists "Auth insert pendaftaran" on pendaftaran;
drop policy if exists "Auth update pendaftaran" on pendaftaran;
drop policy if exists "Auth delete pendaftaran" on pendaftaran;
create policy "Admin/User insert pendaftaran" on pendaftaran
  for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update pendaftaran" on pendaftaran
  for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete pendaftaran" on pendaftaran
  for delete using (current_dashboard_role() in ('admin','user'));

-- ------------------------------------------------------------
-- 5. featured_programs
-- ------------------------------------------------------------
drop policy if exists "Auth insert featured_programs" on featured_programs;
drop policy if exists "Auth delete featured_programs" on featured_programs;
create policy "Admin/User insert featured_programs" on featured_programs
  for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete featured_programs" on featured_programs
  for delete using (current_dashboard_role() in ('admin','user'));

-- ------------------------------------------------------------
-- 6. tg_config
-- ------------------------------------------------------------
drop policy if exists "Auth upsert tg_config" on tg_config;
drop policy if exists "Auth update tg_config" on tg_config;
create policy "Admin/User upsert tg_config" on tg_config
  for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update tg_config" on tg_config
  for update using (current_dashboard_role() in ('admin','user'));

-- ------------------------------------------------------------
-- 7. kwt_kuitansi
-- ------------------------------------------------------------
drop policy if exists "Auth insert kwt_kuitansi" on kwt_kuitansi;
drop policy if exists "Auth delete kwt_kuitansi" on kwt_kuitansi;
create policy "Admin/User insert kwt_kuitansi" on kwt_kuitansi
  for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete kwt_kuitansi" on kwt_kuitansi
  for delete using (current_dashboard_role() in ('admin','user'));

-- ------------------------------------------------------------
-- 8. pembayaran_jamaah
-- ------------------------------------------------------------
drop policy if exists "Auth insert pembayaran_jamaah" on pembayaran_jamaah;
drop policy if exists "Auth update pembayaran_jamaah" on pembayaran_jamaah;
create policy "Admin/User insert pembayaran_jamaah" on pembayaran_jamaah
  for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update pembayaran_jamaah" on pembayaran_jamaah
  for update using (current_dashboard_role() in ('admin','user'));
-- delete pembayaran_jamaah sudah admin-only sejak migrate_supabase_auth.sql, tidak diubah.

-- ------------------------------------------------------------
-- 9. nota_audit_log (insert saja, ledger append-only)
-- ------------------------------------------------------------
drop policy if exists "Auth insert nota_audit_log" on nota_audit_log;
create policy "Admin/User insert nota_audit_log" on nota_audit_log
  for insert with check (current_dashboard_role() in ('admin','user'));

-- ------------------------------------------------------------
-- 10. snapshot_backup
-- ------------------------------------------------------------
drop policy if exists "Auth insert snapshot_backup" on snapshot_backup;
drop policy if exists "Auth delete snapshot_backup" on snapshot_backup;
create policy "Admin/User insert snapshot_backup" on snapshot_backup
  for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete snapshot_backup" on snapshot_backup
  for delete using (current_dashboard_role() in ('admin','user'));

-- ============================================================
-- SELESAI. Setelah ini:
--   - Akun dengan dashboard_role = 'guest' bisa login (dapat JWT authenticated),
--     bisa lihat semua tab yang sebelumnya cuma untuk user login, TAPI setiap
--     percobaan insert/update/delete akan ditolak RLS di database --
--     bukan cuma disembunyikan di UI.
--   - Buat akun guest lewat tab "Pengaturan User" di dashboard (role "Guest
--     (lihat saja)"), atau manual: pilih user di Supabase Auth, lalu
--     update dashboard_profiles set dashboard_role = 'guest' where id = '...';
-- ============================================================
