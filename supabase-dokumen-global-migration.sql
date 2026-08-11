-- ============================================================
-- MIGRASI: tabel kt_dokumen_global
-- Sejak menu "Surat & Dokumen" dibuat berdiri sendiri (tidak
-- terikat event tahunan, sama seperti Gudang Aset), draft surat
-- undangan/proposal/absensi dipindah dari kt_settings.dokumen
-- (yang tadinya per event_id) ke satu baris global di tabel ini —
-- pola yang sama seperti kt_telegram_settings/kt_guest_menu_settings
-- (1 baris, id='main').
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================
create table if not exists kt_dokumen_global (
  id text primary key,
  dokumen jsonb not null default '{}'::jsonb
);

alter table kt_dokumen_global enable row level security;
drop policy if exists "anon_full_access" on kt_dokumen_global;
create policy "anon_full_access" on kt_dokumen_global
  for all to anon using (true) with check (true);

-- Seed baris 'main' kalau belum ada, supaya upsert pertama dari app tidak
-- perlu menangani "no rows" secara khusus.
insert into kt_dokumen_global (id, dokumen)
values ('main', '{"undangan":{},"proposal":{},"absensi":{}}'::jsonb)
on conflict (id) do nothing;

-- ============================================================
-- (Opsional) Migrasi draft lama dari kt_settings.dokumen
-- Kalau sebelumnya sudah pernah mengisi Surat Undangan/Proposal/Absensi
-- untuk salah satu event, jalankan salah satu blok di bawah ini untuk
-- memindahkan draft itu jadi draft global (timpa baris 'main' di atas).
-- Ganti 'ISI_EVENT_ID_DI_SINI' dengan event_id yang datanya mau dipindah
-- (lihat kolom event_id di tabel kt_events / kt_settings).
-- ============================================================
-- update kt_dokumen_global
-- set dokumen = (select dokumen from kt_settings where event_id = 'ISI_EVENT_ID_DI_SINI')
-- where id = 'main';
