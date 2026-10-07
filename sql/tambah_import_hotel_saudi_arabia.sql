-- ============================================================
-- IMPORT CSV HOTEL SAUDI ARABIA (Assets > Hotel Saudi Arabia > Import CSV)
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- (aman dijalankan berkali-kali, pakai CREATE OR REPLACE)
--
-- Prasyarat: sql/tambah_hotel_saudi_arabia.sql & sql/migrate_supabase_auth.sql
-- (current_dashboard_role()) sudah pernah dijalankan.
--
-- LATAR BELAKANG:
--   Tabel hotel_saudi_arabia sengaja tidak punya policy insert/delete (read-only
--   lewat REST). Supaya admin bisa memperbarui datanya dari aplikasi, dibuat
--   SATU fungsi RPC yang:
--     1) hanya boleh dipanggil role 'admin' (dicek di dalam fungsi),
--     2) menghapus SEMUA data lama lalu mengisi dari CSV baru dalam SATU
--        transaksi -- kalau salah satu langkah gagal, data lama tetap utuh,
--     3) mereset penomoran id ke 1 supaya sama dengan hasil Export CSV.
--   Policy tabel TIDAK diubah, jadi tetap tidak bisa ditulis langsung lewat REST.
-- ============================================================

create or replace function replace_hotel_saudi_arabia(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if current_dashboard_role() is distinct from 'admin' then
    raise exception 'Hanya Admin yang boleh mengimpor data hotel' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Data CSV kosong -- import dibatalkan, data lama tidak diubah' using errcode = '22023';
  end if;

  delete from hotel_saudi_arabia where true;
  perform setval(pg_get_serial_sequence('hotel_saudi_arabia', 'id'), 1, false);

  insert into hotel_saudi_arabia (hotel_name, description, review_count, score, country, city)
  select
    trim(t.hotel_name),
    nullif(trim(t.description), ''),
    t.review_count,
    t.score,
    coalesce(nullif(trim(t.country), ''), 'Saudi Arabia'),
    lower(trim(t.city))
  from jsonb_to_recordset(p_rows) as t(
    hotel_name text, description text, review_count integer,
    score numeric, country text, city text
  )
  where nullif(trim(t.hotel_name), '') is not null
    and nullif(trim(t.city), '') is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function replace_hotel_saudi_arabia(jsonb) from public, anon;
grant execute on function replace_hotel_saudi_arabia(jsonb) to authenticated;
