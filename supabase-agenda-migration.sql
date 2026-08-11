-- ============================================================
-- MIGRASI: tabel kt_agenda
-- Untuk fitur baru "Agenda Kegiatan" — agenda umum organisasi yang
-- TIDAK terikat event tahunan (17-an) sama sekali, beda dari
-- kt_jadwal yang per event_id. Polanya serupa kt_kas
-- (tidak ada kolom event_id), supaya reminder-nya tetap muncul di
-- Buku Kegiatan walau belum ada event aktif dipilih/dibuat.
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================
create table if not exists kt_agenda (
  id uuid primary key default gen_random_uuid(),
  judul text not null default '',
  tanggal date,
  kategori text default 'lainnya',
  deskripsi text default '',
  status text not null default 'aktif',
  created_at timestamptz default now()
);

alter table kt_agenda enable row level security;
drop policy if exists "anon_full_access" on kt_agenda;
create policy "anon_full_access" on kt_agenda
  for all to anon using (true) with check (true);
