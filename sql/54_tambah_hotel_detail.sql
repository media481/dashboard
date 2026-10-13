-- ============================================================
-- MIGRASI: Tabel "hotel_detail" -- pustaka detail hotel (jarak & estimasi
-- menit jalan kaki) yang diingat per nama hotel.
--
-- KENAPA: jarak/menit jalan kaki adalah sifat HOTEL, bukan sifat program.
-- Dengan menyimpannya per hotel, program berikutnya yang memakai hotel yang
-- sama otomatis terisi detailnya (mis. "550m 7 menit jalan kaki") walau
-- broadcast/poster tidak menyebutkannya -- sehingga Generate Teks WA/AI
-- selalu punya data jarak yang lengkap. Jumlah malam TIDAK disimpan di sini
-- (beda tiap program).
--
-- Terisi/diperbarui otomatis oleh aplikasi setiap kali program disimpan
-- (lihat saveHotelDetailsFromForm di js/app.js).
--
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- (aman dijalankan berkali-kali). Butuh current_dashboard_role() yang
-- sudah dibuat di 28_migrate_supabase_auth.sql.
-- ============================================================

create table if not exists hotel_detail (
    id bigserial primary key,
    hotel_key text not null unique,   -- nama hotel ter-normalisasi (huruf kecil, tanpa tanda baca/bintang/kurung)
    hotel_name text not null,         -- nama hotel apa adanya dari input terakhir
    kota text,                        -- makkah / madinah / jeddah / dst (opsional)
    jarak_text text not null,         -- mis. "550m 7 menit jalan kaki"
    updated_at timestamptz not null default now()
);

alter table hotel_detail enable row level security;

-- Baca: semua akun yang login. Tulis: admin & user (guest read-only, sama
-- seperti tabel inti lain -- lihat 29_tambah_role_guest_readonly.sql).
drop policy if exists "Auth read hotel_detail" on hotel_detail;
create policy "Auth read hotel_detail" on hotel_detail
  for select using (auth.role() = 'authenticated');

drop policy if exists "Admin/User insert hotel_detail" on hotel_detail;
create policy "Admin/User insert hotel_detail" on hotel_detail
  for insert with check (current_dashboard_role() in ('admin','user'));

drop policy if exists "Admin/User update hotel_detail" on hotel_detail;
create policy "Admin/User update hotel_detail" on hotel_detail
  for update using (current_dashboard_role() in ('admin','user'));

drop policy if exists "Admin delete hotel_detail" on hotel_detail;
create policy "Admin delete hotel_detail" on hotel_detail
  for delete using (current_dashboard_role() = 'admin');
