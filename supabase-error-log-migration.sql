-- ============================================================
-- MIGRASI: tabel kt_error_log
-- Untuk fitur "Log Error Toast" — mencatat semua toast merah/
-- peringatan (⛔❌⚠) yang muncul di app ini, DARI SEMUA
-- perangkat/pengurus (bukan cuma localStorage per device seperti
-- versi awal fitur ini), supaya Admin bisa lihat & ekspor riwayat
-- kegagalan dari satu tempat (card notifikasi Dashboard & panel
-- Pengaturan → Cadangan Data).
--
-- Ini murni tabel diagnostik/teknis, TIDAK terikat event (eventless,
-- tidak ada kolom event_id) dan SENGAJA TIDAK ikut skema backup/restore
-- (db.xxx + ARRAY_TABLE_MAP) ataupun snapshot harian — sama seperti
-- kt_gudang_* — supaya restore/pulihkan snapshot tidak diam-diam
-- menghapus/menimpa riwayat error yang justru mau diaudit.
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================
create table if not exists kt_error_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  message text not null,
  section text,
  event_nama text,
  user_name text,
  device_info text,
  url text
);

-- Index bantu query terurut waktu (dipakai admin utk lihat log terbaru).
create index if not exists idx_kt_error_log_created_at on kt_error_log (created_at desc);

alter table kt_error_log enable row level security;
drop policy if exists "anon_full_access" on kt_error_log;
create policy "anon_full_access" on kt_error_log
  for all to anon using (true) with check (true);

-- Catatan retensi: tabel ini bisa bertambah terus krn dicatat dari SEMUA
-- perangkat. Tidak ada pembersihan otomatis (cron) — pakai tombol
-- "Hapus Log" di Pengaturan → Cadangan Data (menghapus SEMUA baris) kalau
-- sudah dirasa terlalu banyak/lama. Kalau nanti mau retensi otomatis (mis.
-- buang yg lebih tua dari 30 hari), bisa tambah pg_cron job terpisah yang
-- menjalankan: delete from kt_error_log where created_at < now() - interval '30 days';
