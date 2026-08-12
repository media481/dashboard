-- ============================================================
-- SNAPSHOT BACKUP (cadangan harian semua data Umroh)
-- ============================================================
-- Menyimpan snapshot lengkap seluruh data Umroh agar bisa dipulihkan
-- jika terjadi kesalahan (hapus massal, import rusak, dsb).
--
-- Cara pakai: jalankan SQL ini SEKALI di SQL Editor Supabase project ini.
-- Aplikasi (js/app.js) otomatis mengambil snapshot sebelum tindakan berisiko
-- dan menyimpannya ke tabel ini, maksimal 10 snapshot terbaru (FIFO).
--
-- Catatan RLS: mengikuti pola featured_programs — akses publik via anon key
-- (aplikasi memang memakai SUPABASE_ANON_KEY untuk tulis baca ringan).
-- Jika ingin lebih aman, ganti policy di bawah agar hanya role terautentikasi
-- (auth.uid() is not null) yang boleh select/insert/delete.

create table if not exists snapshot_backup (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    label text not null default 'Snapshot',
    trigger text not null default 'manual',   -- 'manual' | 'auto-pre-clear' | 'auto-pre-import' | dll
    data jsonb not null,                       -- seluruh data Umroh (programs, kb_jamaah, dll)
    meta jsonb default '{}'::jsonb
);

create index if not exists idx_snapshot_backup_created_at on snapshot_backup (created_at desc);

alter table snapshot_backup enable row level security;

create policy "Allow read snapshot_backup" on snapshot_backup for select using (true);
create policy "Allow insert snapshot_backup" on snapshot_backup for insert with check (true);
create policy "Allow delete snapshot_backup" on snapshot_backup for delete using (true);
