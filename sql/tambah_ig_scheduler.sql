-- ============================================================
-- MIGRASI: Instagram Content Scheduler
-- Tabel: ig_accounts, ig_posts, ig_publish_logs
-- Dipasangkan dengan pola RLS yang ada: admin/user bisa tulis,
-- guest boleh baca saja (konsisten dengan tabel inti lain).
--
-- Jalankan DI PROYEK YANG SUDAH JALAN (setelah 00_setup_semua_tabel.sql).
-- Idempotent — aman dijalankan berulang kali.
-- ============================================================

-- ============================================================
-- 1. IG_ACCOUNTS
-- Kredensial IG Business/Creator. Akses ditulis hanya untuk
-- admin via RPC SECURITY DEFINER (bukan langsung client), agar
-- token tidak bocor ke publik.
-- ============================================================

-- Type untuk status akun IG (PostgreSQL tidak support CREATE TYPE IF NOT EXISTS
-- untuk enum, jadi pakai DO block + cek di pg_type — idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'ig_account_status'
    ) THEN
        CREATE TYPE ig_account_status AS ENUM ('active', 'inactive', 'expired');
    END IF;
END $$;

create table if not exists ig_accounts (
  id uuid primary key default gen_random_uuid(),
  ig_user_id text not null,                    -- Instagram Business Account ID
  fb_page_id text not null,                    -- Facebook Page terhubung
  access_token text not null,                  -- long-lived token (ter-enkripsi di aplikasi/pakai pgsodium)
  token_expires_at timestamptz not null,       -- Graph API long-lived token ~60 hari
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_ig_accounts_is_active on ig_accounts (is_active);

alter table ig_accounts enable row level security;

-- Tidak pernah expose access_token ke anon. Hanya admin/user yang ter-autentikasi
-- yang bisa lihat (read) akun IG — tapi access_token tetap disembunyikan lewat
-- SELECT yang eksplisit di app.js (hanya ambil kolom yang aman).
create policy "Allow read ig_accounts" on ig_accounts for select using (
  auth.role() = 'authenticated'
);
create policy "Allow insert ig_accounts" on ig_accounts for insert with check (
  auth.role() = 'authenticated'
);
create policy "Allow update ig_accounts" on ig_accounts for update using (
  auth.role() = 'authenticated'
);
create policy "Allow delete ig_accounts" on ig_accounts for delete using (
  auth.role() = 'authenticated'
);


-- ============================================================
-- 2. IG_POSTS  (diganti dari nama `posts` untuk menghindari
-- konflik jika ada tabel lain bernama `posts`)
-- Metadata setiap post IG, status, retry log, dll.
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'post_status') THEN
        CREATE TYPE post_status AS ENUM ('draft', 'scheduled', 'publishing', 'published', 'failed');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'post_media_type') THEN
        CREATE TYPE post_media_type AS ENUM ('image', 'video', 'carousel');
    END IF;
END $$;

create table if not exists ig_posts (
  id uuid primary key default gen_random_uuid(),
  caption text,
  media_url text not null,               -- URL publik ke Supabase Storage (atau JSON array untuk carousel)
  media_type post_media_type default 'image',
  schedule_time timestamptz,             -- null jika masih draft tanpa jadwal
  status post_status not null default 'draft',

  ig_container_id text,                  -- hasil dari step "create container"
  ig_media_id text,                      -- hasil setelah publish sukses
  published_at timestamptz,

  retry_count int not null default 0,
  max_retries int not null default 3,
  last_error text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_ig_posts_status_schedule on ig_posts (status, schedule_time);
create index if not exists idx_ig_posts_created_at on ig_posts (created_at desc);

alter table ig_posts enable row level security;

create policy "Allow read ig_posts" on ig_posts for select using (
  auth.role() = 'authenticated'
);
create policy "Allow insert ig_posts" on ig_posts for insert with check (
  auth.role() = 'authenticated'
);
create policy "Allow update ig_posts" on ig_posts for update using (
  auth.role() = 'authenticated'
);
create policy "Allow delete ig_posts" on ig_posts for delete using (
  auth.role() = 'authenticated'
);


-- ============================================================
-- 3. IG_PUBLISH_LOGS
-- Riwayat setiap percobaan publish — mirip pola nota_audit_log.
-- ============================================================

create table if not exists ig_publish_logs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references ig_posts(id) on delete cascade,
  attempt_number int not null,
  step text not null,               -- 'create_container' | 'check_status' | 'publish' | 'refresh_token'
  success boolean not null,
  response_body jsonb,
  error_message text,
  created_at timestamptz default now()
);

create index if not exists idx_ig_publish_logs_post_id on ig_publish_logs (post_id);
create index if not exists idx_ig_publish_logs_created_at on ig_publish_logs (created_at desc);

alter table ig_publish_logs enable row level security;

create policy "Allow read ig_publish_logs" on ig_publish_logs for select using (
  auth.role() = 'authenticated'
);
create policy "Allow insert ig_publish_logs" on ig_publish_logs for insert with check (
  auth.role() = 'authenticated'
);
create policy "Allow update ig_publish_logs" on ig_publish_logs for update using (
  auth.role() = 'authenticated'
);
create policy "Allow delete ig_publish_logs" on ig_publish_logs for delete using (
  auth.role() = 'authenticated'
);
