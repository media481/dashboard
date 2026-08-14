-- ============================================================
-- MIGRASI: IG Scheduler — Komentar & Balasan
-- Tabel: ig_comments
-- Menyimpan cache komentar dari Instagram Graph API untuk post
-- yang sudah dipublish lewat IG Scheduler, supaya bisa dibalas
-- langsung dari dashboard tanpa buka aplikasi Instagram.
--
-- RLS memakai current_dashboard_role() (pola hardening yang sudah
-- dipakai di programs/jadwal_tamu/dst — lihat sql/tambah_role_guest_readonly.sql),
-- BUKAN auth.role()='authenticated' seperti migrasi ig_* awal, supaya
-- guest tidak bisa balas/hapus komentar walau punya JWT sah.
--
-- Jalankan SETELAH sql/tambah_ig_scheduler.sql & sql/migrate_supabase_auth.sql.
-- Idempotent — aman dijalankan berulang kali.
-- ============================================================

create table if not exists ig_comments (
  id uuid primary key default gen_random_uuid(),

  post_id uuid references ig_posts(id) on delete cascade,
  ig_media_id text not null,                 -- ig_media_id dari ig_posts (post induk)
  ig_comment_id text not null unique,        -- ID komentar dari Graph API
  parent_ig_comment_id text,                 -- diisi kalau komentar ini adalah balasan (reply) di IG

  username text,
  comment_text text,
  like_count int default 0,
  commented_at timestamptz,                  -- timestamp asli dari Instagram

  is_our_reply boolean not null default false, -- true = baris ini adalah balasan kita sendiri
  hidden boolean not null default false,       -- status hide di Instagram

  replied boolean not null default false,      -- sudah dibalas dari dashboard?
  our_reply_text text,
  our_reply_ig_id text,                        -- ig_comment_id dari balasan kita
  replied_at timestamptz,

  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_ig_comments_post_id on ig_comments (post_id);
create index if not exists idx_ig_comments_ig_media_id on ig_comments (ig_media_id);
-- Index parsial untuk query "komentar belum dibalas" (dipakai badge notifikasi di dashboard)
create index if not exists idx_ig_comments_unreplied on ig_comments (commented_at desc)
  where is_our_reply = false and replied = false and hidden = false;

alter table ig_comments enable row level security;

drop policy if exists "Allow read ig_comments" on ig_comments;
drop policy if exists "Allow insert ig_comments" on ig_comments;
drop policy if exists "Allow update ig_comments" on ig_comments;
drop policy if exists "Allow delete ig_comments" on ig_comments;

-- Read: admin & user boleh lihat (guest tidak perlu akses komentar/lead)
create policy "Admin/User read ig_comments" on ig_comments
  for select using (current_dashboard_role() in ('admin','user'));

-- Insert dipakai oleh edge function ig-sync-comments (service role, bypass RLS)
-- DAN oleh dashboard saat mencatat balasan kita — batasi ke admin/user.
create policy "Admin/User insert ig_comments" on ig_comments
  for insert with check (current_dashboard_role() in ('admin','user'));

create policy "Admin/User update ig_comments" on ig_comments
  for update using (current_dashboard_role() in ('admin','user'));

create policy "Admin delete ig_comments" on ig_comments
  for delete using (current_dashboard_role() = 'admin');

-- ============================================================
-- (Opsional tapi disarankan) Tambah tipe notifikasi 'ig_comment'
-- ke config Telegram yang sudah ada (tabel tg_config, dipakai oleh
-- js/app.js -> sendTelegramNotif). Tidak perlu migrasi tabel baru —
-- tipe baru cukup ditambahkan di checkbox UI (lihat perubahan js/app.js).
-- ============================================================
