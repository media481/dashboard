-- ============================================================
-- MIGRASI: Instagram Carousel Support
-- Tabel: ig_post_media (item-item carousel milik satu ig_posts)
--
-- Kenapa tabel terpisah (bukan JSON array di ig_posts.media_url):
-- - Gampang di-reorder (kolom `position`)
-- - Gampang di-query per item saat proses publish (bikin child
--   container satu-satu, simpan ig_child_container_id per item)
-- - Bisa campur image + video dalam satu carousel (IG mengizinkan)
--
-- Jalankan SETELAH sql/tambah_ig_scheduler.sql.
-- Idempotent — aman dijalankan berulang kali.
-- ============================================================

create table if not exists ig_post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references ig_posts(id) on delete cascade,
  media_url text not null,
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  position int not null default 0,          -- urutan tampil di carousel (0-based)
  ig_child_container_id text,               -- hasil create child container saat publish
  created_at timestamptz default now()
);

create index if not exists idx_ig_post_media_post_id on ig_post_media (post_id, position);

alter table ig_post_media enable row level security;

create policy "Allow read ig_post_media" on ig_post_media for select using (
  auth.role() = 'authenticated'
);
create policy "Allow insert ig_post_media" on ig_post_media for insert with check (
  auth.role() = 'authenticated'
);
create policy "Allow update ig_post_media" on ig_post_media for update using (
  auth.role() = 'authenticated'
);
create policy "Allow delete ig_post_media" on ig_post_media for delete using (
  auth.role() = 'authenticated'
);

-- Catatan: ig_posts.media_url tetap dipakai untuk image/video biasa,
-- dan untuk carousel diisi URL item pertama saja (buat thumbnail di
-- tabel/kalender). Daftar lengkap item carousel ada di ig_post_media.
