-- ============================================================
-- MIGRASI: Content Planner -- pilar konten & tahap pengerjaan
-- Tabel: ig_content_plan (kolom baru: pilar, tahap)
--
-- pilar : kategori konten bebas (edukasi, promo, testimoni, manasik,
--         engagement, behind) -- dipakai untuk warna & keseimbangan konten
-- tahap : ide -> dikerjakan -> siap (sebelum dijadikan post)
--
-- Opsional: dashboard tetap jalan tanpa migrasi ini (fitur pilar/tahap
-- otomatis tersembunyi). Idempotent -- aman dijalankan berulang kali.
-- ============================================================

alter table ig_content_plan add column if not exists pilar text;
alter table ig_content_plan add column if not exists tahap text not null default 'ide';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ig_content_plan_tahap_check') then
    alter table ig_content_plan
      add constraint ig_content_plan_tahap_check check (tahap in ('ide', 'dikerjakan', 'siap'));
  end if;
end $$;

create index if not exists idx_ig_content_plan_pilar on ig_content_plan (pilar);
