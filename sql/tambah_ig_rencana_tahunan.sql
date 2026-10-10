-- ============================================================
-- MIGRASI: Rencana Konten -- Rencana Setahun (disusun AI, disimpan, bisa diedit)
-- Tabel: ig_rencana_tahunan (SATU baris = SATU pekan)
--
-- Menyimpan TEMA per pekan hasil perencanaan AI untuk setahun ke depan
-- (memperhitungkan program keberangkatan, musim, dan alur perjalanan jamaah).
-- Beda dengan ig_content_plan: di sini hanya TEMA pekan (rencana arah), bukan isi
-- harian. Isi harian tetap dibuat per pekan lewat Perencanaan Konten, dan memakai
-- tema dari tabel ini sebagai saran utama.
--
--   senin         : tanggal Senin pekan rencana (kunci unik, 1 baris per pekan)
--   tema          : tema pekan (mis. "Persiapan Fisik")
--   alasan        : 1 kalimat kenapa tema ini ada di pekan ini
--   fokus_program : nama program yang jadi jangkar promosi pekan ini (boleh kosong)
--   sumber        : 'ai' (hasil AI) | 'manual' (diketik/diedit admin)
--   terkunci      : true = tidak ditimpa saat "Susun Ulang dengan AI"
--                   (otomatis true saat admin mengedit tema)
--
-- Opsional: dashboard tetap jalan tanpa migrasi ini (tombol Rencana Setahun
-- memberi tahu untuk menjalankan SQL ini dulu). Idempotent -- aman dijalankan berulang.
-- Jalankan SETELAH sql/tambah_ig_content_plan.sql & sql/migrate_supabase_auth.sql.
-- ============================================================

create table if not exists ig_rencana_tahunan (
  id uuid primary key default gen_random_uuid(),
  senin date not null unique,
  tema text not null,
  alasan text,
  fokus_program text,
  sumber text not null default 'ai',
  terkunci boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ig_rencana_tahunan_sumber_check') then
    alter table ig_rencana_tahunan
      add constraint ig_rencana_tahunan_sumber_check check (sumber in ('ai', 'manual'));
  end if;
end $$;

alter table ig_rencana_tahunan enable row level security;

drop policy if exists "Admin/User read ig_rencana_tahunan" on ig_rencana_tahunan;
drop policy if exists "Admin/User insert ig_rencana_tahunan" on ig_rencana_tahunan;
drop policy if exists "Admin/User update ig_rencana_tahunan" on ig_rencana_tahunan;
drop policy if exists "Admin/User delete ig_rencana_tahunan" on ig_rencana_tahunan;

create policy "Admin/User read ig_rencana_tahunan" on ig_rencana_tahunan
  for select using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User insert ig_rencana_tahunan" on ig_rencana_tahunan
  for insert with check (current_dashboard_role() in ('admin','user'));
create policy "Admin/User update ig_rencana_tahunan" on ig_rencana_tahunan
  for update using (current_dashboard_role() in ('admin','user'));
create policy "Admin/User delete ig_rencana_tahunan" on ig_rencana_tahunan
  for delete using (current_dashboard_role() in ('admin','user'));

create or replace function set_updated_at_ig_rencana_tahunan()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_ig_rencana_tahunan_updated_at on ig_rencana_tahunan;
create trigger trg_ig_rencana_tahunan_updated_at
  before update on ig_rencana_tahunan
  for each row execute function set_updated_at_ig_rencana_tahunan();
