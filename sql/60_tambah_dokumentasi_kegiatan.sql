-- ============================================================
-- MIGRASI: Social Media > Dokumentasi (jadwal & dokumentasi kegiatan umroh)
-- Tabel: dokumentasi_kegiatan
--
-- Satu baris = satu kegiatan dalam perjalanan umroh sebuah program, dari
-- keberangkatan sampai kepulangan. Dipakai tim konten untuk:
--   1) tahu KAPAN & DI MANA setiap momen terjadi (jadwal per hari),
--   2) tahu APA yang harus diambil (shot list + jenis media),
--   3) melacak status dokumentasi (rencana -> sudah diambil -> sudah diposting)
--      beserta link folder Drive-nya,
--   4) menjembatani ke Perencanaan Konten IG: kolom content_plan_id terisi
--      saat kegiatan "dijadikan ide konten" (baris baru di ig_content_plan).
--
-- RLS (pola sama dengan sql/29 dan sql/44, memakai current_dashboard_role()):
--   baca  : admin, user, guest (guest read-only)
--   tulis : admin, user
--
-- Jalankan SETELAH sql/00_SETUP_LENGKAP_SATU_FILE.sql (butuh tabel programs
-- dan ig_content_plan). Tidak termasuk di 00. Idempoten, aman diulang.
-- ============================================================

create table if not exists dokumentasi_kegiatan (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,

  hari_ke integer not null default 1,          -- hari ke-N perjalanan (1 = hari keberangkatan)
  tanggal date,                                -- tanggal kegiatan (dihitung dari tgl berangkat, boleh diubah)
  waktu text,                                  -- teks bebas: "05:30", "Ba'da Subuh", "Siang"
  fase text not null default 'lainnya',        -- tahap perjalanan
  kategori text not null default 'lainnya',    -- jenis kegiatan
  lokasi text,                                 -- mis. "Masjid Nabawi", "Bandara Juanda"
  judul text not null,                         -- nama kegiatan
  deskripsi text,                              -- gambaran singkat kegiatan

  jenis_media text[] not null default '{}',    -- foto / video / reels / story / testimoni
  shot_list text,                              -- apa saja yang perlu diambil
  pilar text,                                  -- pilar konten IG yang cocok (IG_PILLARS)
  ide_konten text,                             -- ide konten turunan dari kegiatan ini

  status text not null default 'rencana',      -- rencana -> sudah_diambil -> sudah_diposting (atau dilewati)
  link_drive text,                             -- folder/file hasil dokumentasi
  catatan text,                                -- catatan lapangan
  urutan integer not null default 0,           -- urutan dalam satu hari

  content_plan_id uuid references ig_content_plan(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table dokumentasi_kegiatan drop constraint if exists dokumentasi_kegiatan_hari_ke_check;
alter table dokumentasi_kegiatan add constraint dokumentasi_kegiatan_hari_ke_check
  check (hari_ke between 1 and 60);

alter table dokumentasi_kegiatan drop constraint if exists dokumentasi_kegiatan_fase_check;
alter table dokumentasi_kegiatan add constraint dokumentasi_kegiatan_fase_check
  check (fase in ('persiapan', 'keberangkatan', 'madinah', 'makkah', 'kepulangan', 'lainnya'));

alter table dokumentasi_kegiatan drop constraint if exists dokumentasi_kegiatan_kategori_check;
alter table dokumentasi_kegiatan add constraint dokumentasi_kegiatan_kategori_check
  check (kategori in ('perjalanan', 'ibadah', 'ziarah', 'hotel', 'kebersamaan', 'lainnya'));

alter table dokumentasi_kegiatan drop constraint if exists dokumentasi_kegiatan_status_check;
alter table dokumentasi_kegiatan add constraint dokumentasi_kegiatan_status_check
  check (status in ('rencana', 'sudah_diambil', 'sudah_diposting', 'dilewati'));

alter table dokumentasi_kegiatan drop constraint if exists dokumentasi_kegiatan_judul_check;
alter table dokumentasi_kegiatan add constraint dokumentasi_kegiatan_judul_check
  check (char_length(btrim(judul)) > 0);

create index if not exists idx_dokumentasi_kegiatan_program
  on dokumentasi_kegiatan (program_id, hari_ke, urutan);
create index if not exists idx_dokumentasi_kegiatan_status
  on dokumentasi_kegiatan (status);

alter table dokumentasi_kegiatan enable row level security;

drop policy if exists "Read dokumentasi_kegiatan"         on dokumentasi_kegiatan;
drop policy if exists "Admin/User insert dokumentasi_kegiatan" on dokumentasi_kegiatan;
drop policy if exists "Admin/User update dokumentasi_kegiatan" on dokumentasi_kegiatan;
drop policy if exists "Admin/User delete dokumentasi_kegiatan" on dokumentasi_kegiatan;

create policy "Read dokumentasi_kegiatan" on dokumentasi_kegiatan
  for select using (current_dashboard_role() in ('admin', 'user', 'guest'));

create policy "Admin/User insert dokumentasi_kegiatan" on dokumentasi_kegiatan
  for insert with check (current_dashboard_role() in ('admin', 'user'));

create policy "Admin/User update dokumentasi_kegiatan" on dokumentasi_kegiatan
  for update using (current_dashboard_role() in ('admin', 'user'));

create policy "Admin/User delete dokumentasi_kegiatan" on dokumentasi_kegiatan
  for delete using (current_dashboard_role() in ('admin', 'user'));

-- Trigger updated_at
create or replace function set_updated_at_dokumentasi_kegiatan()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_dokumentasi_kegiatan_updated_at on dokumentasi_kegiatan;
create trigger trg_dokumentasi_kegiatan_updated_at
  before update on dokumentasi_kegiatan
  for each row execute function set_updated_at_dokumentasi_kegiatan();

-- Selesai. Menu "Dokumentasi" (Social Media) memakai tabel ini. Untuk user/guest,
-- menu baru default tersembunyi sampai admin mengizinkannya di Pengaturan User > Akses Menu
-- (kunci menu: dokumentasi). Admin langsung melihatnya.
