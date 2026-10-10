-- ============================================================
-- MIGRASI: IG Scheduler -- Tasklist mingguan (kartu "Tasklist" di Content Planner)
-- Tabel: ig_tasklist
--
-- Daftar kerjaan rutin per hari dalam seminggu (template mingguan yang berulang).
-- hari: 1 = Senin ... 7 = Minggu. Kartu Tasklist menampilkan kerjaan sesuai hari ini.
-- Opsional: tanpa migrasi ini dashboard tetap jalan (tasklist disimpan di browser saja).
-- Jalankan SETELAH sql/44_tambah_ig_content_plan.sql. Idempotent.
-- ============================================================

create table if not exists ig_tasklist (
  id uuid primary key default gen_random_uuid(),
  hari smallint not null check (hari between 1 and 7),
  nama text not null,
  urut int not null default 0,
  created_at timestamptz default now()
);

create index if not exists idx_ig_tasklist_hari on ig_tasklist (hari, urut);

alter table ig_tasklist enable row level security;

drop policy if exists "Admin/User read ig_tasklist" on ig_tasklist;
drop policy if exists "Admin/User insert ig_tasklist" on ig_tasklist;
drop policy if exists "Admin/User update ig_tasklist" on ig_tasklist;
drop policy if exists "Admin/User delete ig_tasklist" on ig_tasklist;

create policy "Admin/User read ig_tasklist" on ig_tasklist
  for select using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User insert ig_tasklist" on ig_tasklist
  for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update ig_tasklist" on ig_tasklist
  for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete ig_tasklist" on ig_tasklist
  for delete using (current_dashboard_role() in ('admin','user'));
