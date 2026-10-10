-- ============================================================
-- HARDENING: RLS IG Scheduler (ig_accounts, ig_posts, ig_post_media, ig_publish_logs)
--
-- Masalah: migrasi awal memakai auth.role() = 'authenticated' di semua tabel ini,
-- sehingga role GUEST (read-only) bisa membaca kolom access_token di ig_accounts
-- lewat API langsung, serta menulis/menghapus ig_posts. Tabel ig_comments &
-- ig_content_plan sudah memakai current_dashboard_role() — ini menyamakannya.
--
-- Aman dijalankan berulang (idempotent). Jalankan SETELAH 28_migrate_supabase_auth.sql
-- dan semua tambah_ig_*.sql. Edge Function memakai service_role (bypass RLS) sehingga
-- tidak terpengaruh.
-- ============================================================

-- 1. ig_accounts — token tidak boleh terbaca client sama sekali
drop policy if exists "Allow read ig_accounts"   on ig_accounts;
drop policy if exists "Allow insert ig_accounts" on ig_accounts;
drop policy if exists "Allow update ig_accounts" on ig_accounts;
drop policy if exists "Allow delete ig_accounts" on ig_accounts;
drop policy if exists "Admin/User read ig_accounts" on ig_accounts;

create policy "Admin/User read ig_accounts" on ig_accounts
  for select using (current_dashboard_role() in ('admin','user'));
-- Tidak ada policy insert/update/delete untuk client: akun IG diisi lewat SQL Editor
-- dan token diperbarui edge function (service_role).

-- Sembunyikan kolom access_token dari role client (kolom lain tetap bisa dibaca;
-- app.js hanya select: id, ig_user_id, fb_page_id, token_expires_at, is_active)
revoke select on ig_accounts from anon, authenticated;
grant select (id, ig_user_id, fb_page_id, token_expires_at, is_active, created_at, updated_at)
  on ig_accounts to authenticated;

-- 2. ig_posts
drop policy if exists "Allow read ig_posts"   on ig_posts;
drop policy if exists "Allow insert ig_posts" on ig_posts;
drop policy if exists "Allow update ig_posts" on ig_posts;
drop policy if exists "Allow delete ig_posts" on ig_posts;
drop policy if exists "Admin/User read ig_posts"   on ig_posts;
drop policy if exists "Admin/User insert ig_posts" on ig_posts;
drop policy if exists "Admin/User update ig_posts" on ig_posts;
drop policy if exists "Admin/User delete ig_posts" on ig_posts;

create policy "Admin/User read ig_posts"   on ig_posts for select using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User insert ig_posts" on ig_posts for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update ig_posts" on ig_posts for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete ig_posts" on ig_posts for delete using (current_dashboard_role() in ('admin','user'));

-- 3. ig_post_media
drop policy if exists "Allow read ig_post_media"   on ig_post_media;
drop policy if exists "Allow insert ig_post_media" on ig_post_media;
drop policy if exists "Allow update ig_post_media" on ig_post_media;
drop policy if exists "Allow delete ig_post_media" on ig_post_media;
drop policy if exists "Admin/User read ig_post_media"   on ig_post_media;
drop policy if exists "Admin/User insert ig_post_media" on ig_post_media;
drop policy if exists "Admin/User update ig_post_media" on ig_post_media;
drop policy if exists "Admin/User delete ig_post_media" on ig_post_media;

create policy "Admin/User read ig_post_media"   on ig_post_media for select using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User insert ig_post_media" on ig_post_media for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update ig_post_media" on ig_post_media for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete ig_post_media" on ig_post_media for delete using (current_dashboard_role() in ('admin','user'));

-- 4. ig_publish_logs — log hanya dibaca client; yang menulis edge function (service_role)
drop policy if exists "Allow read ig_publish_logs"   on ig_publish_logs;
drop policy if exists "Allow insert ig_publish_logs" on ig_publish_logs;
drop policy if exists "Allow update ig_publish_logs" on ig_publish_logs;
drop policy if exists "Allow delete ig_publish_logs" on ig_publish_logs;
drop policy if exists "Admin/User read ig_publish_logs" on ig_publish_logs;

create policy "Admin/User read ig_publish_logs" on ig_publish_logs
  for select using (current_dashboard_role() in ('admin','user'));
