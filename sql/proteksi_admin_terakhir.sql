-- ============================================================
-- FIX 1: Backfill email yang kosong ("-") di Pengaturan User
-- ============================================================
-- Kenapa email "Admin" tampil "-": kolom `email` di dashboard_profiles baru
-- ditambahkan lewat sql/tambah_kelola_user.sql, sedangkan akun Admin/User/Guest
-- awal dibuat lebih dulu lewat scripts/setup-auth-accounts.mjs (sebelum kolom
-- itu ada) -- jadi baris lamanya email-nya NULL. User yang dibuat lewat tombol
-- "Tambah User" di UI sudah otomatis terisi emailnya (lihat admin-create-user).
-- Query ini sekali jalan: menyalin email dari auth.users (sumber asli) ke
-- dashboard_profiles untuk baris yang emailnya masih kosong.
update dashboard_profiles dp
set email = au.email
from auth.users au
where dp.id = au.id
  and (dp.email is null or dp.email = '');


-- ============================================================
-- FIX 2: Proteksi supaya admin terakhir tidak bisa hilang
-- ============================================================
-- Kenapa ini perlu: dashboard_profiles.id punya
-- "on delete cascade" ke auth.users, jadi kalau akun admin terakhir dihapus
-- lewat Supabase Auth dashboard (bukan cuma lewat aplikasi ini), baris
-- dashboard_profiles-nya ikut terhapus otomatis -- dan kalau itu satu-satunya
-- admin, tidak ada lagi yang bisa login sebagai admin untuk mengelola dashboard.
-- Begitu juga kalau role admin terakhir diturunkan jadi 'user' lewat SQL Editor
-- atau fitur ubah-role yang mungkin ditambahkan nanti.
--
-- Trigger ini menolak (raise exception, transaksi dibatalkan) setiap
-- UPDATE yang menurunkan role admin terakhir, atau DELETE terhadap baris
-- admin terakhir -- berlaku di SEMUA jalur (SQL Editor, Edge Function pakai
-- service role, maupun cascade delete dari auth.users), karena trigger
-- database tidak bisa dilewati oleh Row Level Security atau service role.
create or replace function prevent_last_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining_admins int;
begin
  if (tg_op = 'DELETE' and old.dashboard_role = 'admin')
     or (tg_op = 'UPDATE' and old.dashboard_role = 'admin' and new.dashboard_role <> 'admin') then
    select count(*) into remaining_admins
    from dashboard_profiles
    where dashboard_role = 'admin' and id <> old.id;

    if remaining_admins = 0 then
      raise exception 'Tidak bisa menghapus/menurunkan role admin terakhir. Sistem wajib punya minimal 1 admin. Tambahkan admin lain dulu sebelum mengubah akun ini.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

drop trigger if exists trg_prevent_last_admin_removal on dashboard_profiles;
create trigger trg_prevent_last_admin_removal
before update or delete on dashboard_profiles
for each row execute function prevent_last_admin_removal();

-- Catatan: trigger ini TIDAK menghalangi kamu menghapus/menurunkan admin biasa
-- (bukan yang terakhir) -- hanya memblokir aksi yang akan membuat jumlah admin
-- jadi 0. Kalau memang perlu mengganti "siapa" adminnya, urutannya: tambah
-- admin baru dulu lewat tab Pengaturan User, baru turunkan/hapus admin lama.
