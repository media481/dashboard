-- ============================================================
-- MIGRASI: IG Scheduler — Content Planner Bulanan (AI)
-- Tabel: ig_content_plan
--
-- Menyimpan RENCANA/IDE konten IG per bulan yang di-generate AI
-- (Gemini) berdasarkan program-program yang aktif/berangkat di
-- bulan tsb. Sengaja dipisah dari `ig_posts` karena ig_posts
-- mewajibkan `media_url` (post nyata harus ada file) sedangkan
-- rencana konten baru berupa ide + draft caption, belum ada media.
--
-- Baris di sini yang sudah "dijadikan post" ditandai lewat kolom
-- ig_post_id (bukan dihapus), supaya histori rencana tetap ada.
--
-- RLS memakai current_dashboard_role() (pola sama dengan
-- sql/tambah_ig_comments.sql) — guest tidak perlu lihat rencana
-- konten sama sekali (ini alat kerja internal admin/user).
--
-- Jalankan SETELAH sql/tambah_ig_scheduler.sql & sql/migrate_supabase_auth.sql.
-- Idempotent — aman dijalankan berulang kali.
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_plan_status') THEN
        CREATE TYPE content_plan_status AS ENUM ('idea', 'dijadikan_post', 'dilewati');
    END IF;
END $$;

create table if not exists ig_content_plan (
  id uuid primary key default gen_random_uuid(),

  bulan date not null,                    -- tanggal 1 bulan rencana ini, mis. 2026-09-01 (untuk filter per-bulan)
  tanggal date not null,                  -- tanggal disarankan untuk posting
  tema text not null,                     -- topik/tema singkat (mis. "Testimoni jamaah quad")
  tipe_konten post_media_type default 'image',  -- reuse enum dari ig_posts (image/video/carousel)
  draft_caption text,                     -- draft caption hasil AI, siap dipoles/dipakai langsung

  status content_plan_status not null default 'idea',
  ig_post_id uuid references ig_posts(id) on delete set null,  -- terisi kalau sudah dikonversi jadi post asli

  sumber_program_id uuid references programs(id) on delete set null, -- program yang jadi konteks/acuan ide ini (opsional)

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_ig_content_plan_bulan on ig_content_plan (bulan);
create index if not exists idx_ig_content_plan_tanggal on ig_content_plan (tanggal);
create index if not exists idx_ig_content_plan_status on ig_content_plan (status);

alter table ig_content_plan enable row level security;

drop policy if exists "Admin/User read ig_content_plan" on ig_content_plan;
drop policy if exists "Admin/User insert ig_content_plan" on ig_content_plan;
drop policy if exists "Admin/User update ig_content_plan" on ig_content_plan;
drop policy if exists "Admin/User delete ig_content_plan" on ig_content_plan;

create policy "Admin/User read ig_content_plan" on ig_content_plan
  for select using (current_dashboard_role() in ('admin','user'));

create policy "Admin/User insert ig_content_plan" on ig_content_plan
  for insert with check (current_dashboard_role() in ('admin','user'));

create policy "Admin/User update ig_content_plan" on ig_content_plan
  for update using (current_dashboard_role() in ('admin','user'));

create policy "Admin/User delete ig_content_plan" on ig_content_plan
  for delete using (current_dashboard_role() in ('admin','user'));

-- Trigger updated_at (pola sama dengan tabel lain yang punya kolom ini)
create or replace function set_updated_at_ig_content_plan()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_ig_content_plan_updated_at on ig_content_plan;
create trigger trg_ig_content_plan_updated_at
  before update on ig_content_plan
  for each row execute function set_updated_at_ig_content_plan();
