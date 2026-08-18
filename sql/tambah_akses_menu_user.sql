-- ============================================================
-- MIGRASI: Akses Menu Sidebar per USER (pengecualian individual) --
-- lapisan override DI ATAS role_menu_access (sql/tambah_akses_menu_role.sql),
-- supaya Admin bisa membatasi/menambah akses 1 akun tertentu tanpa mengubah
-- default seluruh role. Tidak mengubah perilaku lama sama sekali: tabel ini
-- sengaja dibiarkan KOSONG setelah migrasi -- akun tanpa baris di sini tetap
-- 100% ikut aturan role_menu_access seperti sekarang (lihat renderSidebarNav()
-- di js/app.js, override menang kalau ADA baris, fallback ke role kalau TIDAK).
-- Jalankan SETELAH sql/tambah_akses_menu_role.sql (kalau belum pernah).
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ============================================================

create table if not exists user_menu_access (
    user_id    uuid not null references auth.users(id) on delete cascade,
    menu_key   text not null,
    allowed    boolean not null default false,
    updated_at timestamptz not null default now(),
    primary key (user_id, menu_key)
);

alter table user_menu_access enable row level security;

-- Sama seperti role_menu_access: semua role yang sudah login (user/guest/admin)
-- perlu BACA tabel ini supaya sidebar masing-masing bisa dirender sesuai
-- override akun (tiap akun hanya query baris user_id = miliknya sendiri lewat
-- .eq('user_id', uid) di js/app.js, jadi tetap privat secara praktis meski
-- policy select-nya longgar). Pembatasan "hanya Admin yang boleh MENULIS"
-- ditegakkan di sisi UI (blok "Akses Menu per User" di Userman hanya
-- dirender/dipakai kalau currentRole === 'admin'), bukan lewat RLS granular --
-- konsisten dengan pola role_menu_access & assets di proyek ini.
drop policy if exists "Auth read user_menu_access" on user_menu_access;
create policy "Auth read user_menu_access" on user_menu_access for select using (auth.role() = 'authenticated');

drop policy if exists "Auth upsert user_menu_access" on user_menu_access;
create policy "Auth upsert user_menu_access" on user_menu_access for insert with check (auth.role() = 'authenticated');

drop policy if exists "Auth update user_menu_access" on user_menu_access;
create policy "Auth update user_menu_access" on user_menu_access for update using (auth.role() = 'authenticated');

drop policy if exists "Auth delete user_menu_access" on user_menu_access;
create policy "Auth delete user_menu_access" on user_menu_access for delete using (auth.role() = 'authenticated');

-- Tidak ada seed data di sini dengan sengaja (beda dari tambah_akses_menu_role.sql
-- yang seed default per role) -- tabel ini murni berisi PENGECUALIAN yang
-- dibuat manual oleh Admin lewat Userman > Akses Menu > "Akses Menu per User".
-- Baris kosong = semua akun tetap murni ikut default role-nya masing-masing,
-- sama seperti sebelum migrasi ini dijalankan.

-- Selesai. Setelah ini, buka Userman -> Akses Menu -> pilih 1 akun di
-- dropdown "Akses Menu per User (Pengecualian)" untuk mulai mengatur
-- pengecualiannya. Kalau tab ini masih menampilkan pesan "Setup belum
-- lengkap", cek lagi apakah migrasi ini benar-benar sudah ter-apply
-- (refresh halaman SQL Editor lalu jalankan ulang).
