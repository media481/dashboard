-- ============================================================
-- MIGRASI: deteksi konflik simpan bersamaan (concurrent edit)
--
-- LATAR BELAKANG:
-- syncArrayTable() di script.js mengirim SELURUH snapshot tabel
-- (bukan diff per-field) lewat upsert(onConflict:'id') tiap kali
-- ada perubahan. Kalau dua akun mengedit BARIS YANG SAMA di waktu
-- berdekatan, siapa yang menyimpan belakangan akan menimpa
-- perubahan yang lain secara diam-diam, tanpa peringatan.
--
-- PERBAIKAN:
-- Tambahkan kolom `updated_at` yang di-refresh OTOMATIS oleh
-- trigger Postgres setiap kali baris di-UPDATE (bukan diatur dari
-- JS, supaya tidak bisa salah/telat karena jam perangkat client).
-- Sisi JS lalu membandingkan `updated_at` yang terakhir diketahui
-- vs yang ada di server sebelum menimpa — kalau beda, berarti ada
-- yang mengubahnya duluan, jadi baris itu TIDAK ditimpa dan user
-- diberi tahu untuk memuat ulang.
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================

create or replace function kt_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
  tables text[] := array[
    'kt_events','kt_anggota','kt_donatur','kt_transaksi_lain','kt_operasional',
    'kt_lomba','kt_lomba_kebutuhan','kt_hadiah_kategori','kt_lomba_hadiah',
    'kt_daftar_belanja_hadiah','kt_daftar_belanja_perlengkapan',
    'kt_hadiah_jalan_santai','kt_daftar_belanja_jalan_santai','kt_jadwal',
    'kt_agenda','kt_kas'
  ];
begin
  foreach t in array tables loop
    -- Tambah kolom kalau belum ada (tabel yang sudah punya kolom ini
    -- sebelumnya cukup dilewati oleh "if not exists").
    execute format('alter table %I add column if not exists updated_at timestamptz default now();', t);
    -- Isi baris lama yang masih null.
    execute format('update %I set updated_at = now() where updated_at is null;', t);
    -- Pasang trigger (drop dulu supaya aman dijalankan berkali-kali).
    execute format('drop trigger if exists trg_set_updated_at on %I;', t);
    execute format(
      'create trigger trg_set_updated_at before update on %I for each row execute function kt_set_updated_at();', t
    );
  end loop;
end $$;
