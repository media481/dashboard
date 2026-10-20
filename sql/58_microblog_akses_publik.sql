-- ============================================================
-- MICROBLOG: boleh dibuka TANPA login (guest & pengunjung anonim, baca saja)
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- (aman dijalankan berkali-kali)
--
-- Tile/modal "Microblog" di dashboard utama membaca ig_content_plan, yang RLS-nya
-- hanya untuk admin & user (sql/44). Daripada membuka tabel itu langsung ke anon
-- (kolom internal seperti canva_url, ig_post_id, sumber_program_id ikut terbuka),
-- dibuat VIEW yang hanya memuat kolom yang dipakai tampilan microblog dan
-- menyembunyikan rencana berstatus 'dilewati'.
--
-- View berjalan dengan hak pemilik (default Postgres, TANPA security_invoker),
-- jadi bisa membaca ig_content_plan walau anon tidak punya policy di tabelnya.
-- Tabel ig_content_plan sendiri TIDAK diubah: insert/update/delete dan baca
-- penuh tetap hanya admin & user.
-- ============================================================

-- Pastikan kolom Content Planner yang dipakai view ini ada (sama dengan sql/45, 46, 47).
-- Kalau migrasi itu sudah pernah dijalankan, bagian ini tidak mengubah apa-apa.
alter table public.ig_content_plan add column if not exists pilar text;
alter table public.ig_content_plan add column if not exists tahap text not null default 'ide';
alter table public.ig_content_plan add column if not exists teks_gambar text;
alter table public.ig_content_plan add column if not exists tema_minggu text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ig_content_plan_tahap_check') then
    alter table public.ig_content_plan
      add constraint ig_content_plan_tahap_check check (tahap in ('ide', 'dikerjakan', 'siap'));
  end if;
end $$;

drop view if exists public.microblog_publik;

create view public.microblog_publik as
select
  id,
  tanggal,
  tema,
  tipe_konten,
  draft_caption,
  status,
  pilar,
  tahap,
  teks_gambar,
  tema_minggu
from public.ig_content_plan
where status <> 'dilewati';

revoke all on public.microblog_publik from public;
grant select on public.microblog_publik to anon, authenticated;
