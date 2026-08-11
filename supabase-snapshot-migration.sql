-- ============================================================
-- MIGRASI: tabel kt_snapshot — riwayat snapshot backup otomatis
-- Jalankan di Supabase Dashboard project MERDEKA > SQL Editor > Run.
-- Aman dijalankan berkali-kali (idempotent).
--
-- LATAR BELAKANG: fitur "Backup Semua Data" yang sudah ada (exportData/
-- importData di js/15-pengaturan-event.js) mengandalkan admin secara
-- manual mengunduh & menyimpan file .json sendiri. Kalau lupa, atau
-- filenya sudah lama, dan tiba-tiba terjadi kesalahan (mis. salah impor,
-- typo massal, bug), tidak ada jalan mundur ke kondisi sebelumnya.
--
-- Tabel ini menyimpan "foto" penuh seluruh data aplikasi (payload sama
-- persis seperti isi file Backup Semua Data, minus token Telegram) tiap
-- kali dipicu, lengkap dengan jenis pemicunya dan waktunya. Retensi
-- dijaga tetap 3 baris terakhir oleh kode JS (lihat js/15b-snapshot.js),
-- bukan oleh trigger SQL, supaya gampang di-debug/diubah dari satu tempat.
-- ============================================================
create table if not exists kt_snapshot (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  trigger text not null default 'manual' check (trigger in ('manual', 'harian', 'pra-aksi')),
  label text,
  payload jsonb not null,
  size_kb numeric
);

create index if not exists idx_kt_snapshot_created_at on kt_snapshot (created_at desc);

alter table kt_snapshot enable row level security;
drop policy if exists "anon_full_access" on kt_snapshot;
create policy "anon_full_access" on kt_snapshot
  for all to anon using (true) with check (true);
