-- ============================================================
-- MIGRASI: tabel kt_organisasi_profil
--
-- LATAR BELAKANG:
-- Sebelumnya nama organisasi ("Karang Taruna Inti"), logo kop surat
-- (icons/logo-kop.png), dan nama buku kas ("Kas Karang Taruna") tertanam
-- (hardcode) di banyak tempat di js/*.js — sidebar, kop surat LPJ/nota,
-- pesan notifikasi Telegram, halaman Panduan, dll. Supaya app ini bisa
-- dipakai ulang organisasi lain (RT/RW lain, karang taruna dusun sebelah,
-- bahkan organisasi non-RT) TANPA sentuh kode sama sekali, ketiga hal
-- itu sekarang disimpan di SATU baris tabel ini (pola yang sama seperti
-- kt_telegram_settings/kt_guest_menu_settings/kt_dokumen_global — 1 baris,
-- id='main') dan diatur admin lewat Pengaturan > Profil Organisasi.
--
-- Kalau baris 'main' belum ada / kolom masih kosong, app otomatis
-- fallback ke DEFAULT_ORG_PROFILE di js/03-db-core.js (nama "Karang Taruna
-- Inti", nama kas "Kas Karang Taruna", logo icons/logo-kop.png) — jadi
-- tampilan tidak berubah sampai admin mengganti sendiri.
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================
create table if not exists kt_organisasi_profil (
  id text primary key,
  nama_organisasi text,
  nama_kas text,
  -- Disimpan sebagai base64 data URI (hasil upload lewat Pengaturan), atau
  -- kosong/null kalau admin belum pernah upload logo sendiri (app lalu
  -- fallback ke file statis icons/logo-kop.png). Pakai `text` (bukan
  -- varchar terbatas) karena data URI gambar bisa cukup panjang.
  logo text,
  updated_at timestamptz default now()
);

alter table kt_organisasi_profil enable row level security;
drop policy if exists "anon_full_access" on kt_organisasi_profil;
create policy "anon_full_access" on kt_organisasi_profil
  for all to anon using (true) with check (true);

-- Trigger updated_at otomatis, dipakai _syncSingletonRow() (js/03-db-core.js)
-- untuk mendeteksi kalau baris 'main' sudah diubah admin lain sejak kita
-- load — supaya perubahan tidak saling menimpa diam-diam. Fungsi
-- kt_set_updated_at() ini sama seperti yang dipakai supabase-conflict-
-- detection-migration.sql — dibuat ulang di sini (CREATE OR REPLACE, aman
-- dijalankan berkali-kali) untuk jaga-jaga kalau migrasi itu belum pernah
-- dijalankan di project ini.
create or replace function kt_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at on kt_organisasi_profil;
create trigger trg_set_updated_at
  before update on kt_organisasi_profil
  for each row execute function kt_set_updated_at();

-- Seed baris 'main' kalau belum ada, diisi nilai yang SAMA PERSIS dengan
-- yang sebelumnya hardcode di kode (supaya tidak ada perubahan tampilan
-- sampai admin sengaja menggantinya lewat Pengaturan > Profil Organisasi).
insert into kt_organisasi_profil (id, nama_organisasi, nama_kas, logo)
values ('main', 'Karang Taruna Inti', 'Kas Karang Taruna', null)
on conflict (id) do nothing;
