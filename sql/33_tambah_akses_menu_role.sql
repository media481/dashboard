-- ============================================================
-- MIGRASI: Akses Menu Sidebar per Role -- memungkinkan Admin
-- mengatur lewat menu Userman menu sidebar apa saja yang boleh
-- diakses oleh role "user" dan "guest" (role "admin" selalu penuh,
-- tidak bisa dikunci lewat tabel ini -- dihardcode di app.js supaya
-- admin tidak bisa mengunci akses dirinya sendiri secara tidak sengaja).
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ============================================================

create table if not exists role_menu_access (
    role text not null check (role in ('user', 'guest')),
    menu_key text not null,
    allowed boolean not null default false,
    updated_at timestamptz not null default now(),
    primary key (role, menu_key)
);

alter table role_menu_access enable row level security;

-- Semua role yang sudah login (user/guest/admin) perlu BACA tabel ini supaya
-- sidebar masing-masing bisa dirender sesuai konfigurasi. Yang boleh MENULIS
-- sebetulnya hanya Admin -- tapi konsisten dengan pola RLS tabel lain di
-- proyek ini (mis. assets), pembatasan "hanya Admin" ditegakkan di sisi UI
-- (tombol Simpan cuma muncul untuk role Admin), bukan lewat RLS granular
-- per-role di database.
drop policy if exists "Auth read role_menu_access" on role_menu_access;
create policy "Auth read role_menu_access" on role_menu_access for select using (auth.role() = 'authenticated');

drop policy if exists "Auth upsert role_menu_access" on role_menu_access;
create policy "Auth upsert role_menu_access" on role_menu_access for insert with check (auth.role() = 'authenticated');

drop policy if exists "Auth update role_menu_access" on role_menu_access;
create policy "Auth update role_menu_access" on role_menu_access for update using (auth.role() = 'authenticated');

drop policy if exists "Auth delete role_menu_access" on role_menu_access;
create policy "Auth delete role_menu_access" on role_menu_access for delete using (auth.role() = 'authenticated');

-- Seed nilai default supaya PERILAKU SEBELUM MIGRASI INI TIDAK BERUBAH:
-- role "user" & "guest" sama-sama tetap bisa melihat 5 menu "Navigasi" yang
-- butuh login (Jadwal Tamu, Pendaftaran, Keberangkatan, Dokumen, Arsip
-- Jamaah), dan sama-sama TIDAK bisa melihat menu Manajemen/System manapun
-- (dulu semuanya nav-admin-only, terkunci penuh untuk selain Admin).
-- Setelah migrasi ini jalan, Admin bebas mengubah kombinasinya lewat
-- Userman > Akses Menu Sidebar.
insert into role_menu_access (role, menu_key, allowed) values
    ('user', 'info', true),
    ('user', 'pendaftaran', true),
    ('user', 'keberangkatan', true),
    ('user', 'dokumen', true),
    ('user', 'arsip', true),
    ('user', 'program', false),
    ('user', 'pembayaran', false),
    ('user', 'unggulan', false),
    ('user', 'auditnota', false),
    ('user', 'assets', false),
    ('user', 'crosscheck', false),
    ('user', 'telegram', false),
    ('user', 'usersettings', false),
    ('user', 'snapshot', false),
    ('user', 'profil', false),
    ('guest', 'info', true),
    ('guest', 'pendaftaran', true),
    ('guest', 'keberangkatan', true),
    ('guest', 'dokumen', true),
    ('guest', 'arsip', true),
    ('guest', 'program', false),
    ('guest', 'pembayaran', false),
    ('guest', 'unggulan', false),
    ('guest', 'auditnota', false),
    ('guest', 'assets', false),
    ('guest', 'crosscheck', false),
    ('guest', 'telegram', false),
    ('guest', 'usersettings', false),
    ('guest', 'snapshot', false),
    ('guest', 'profil', false)
on conflict (role, menu_key) do nothing;

-- Selesai. Setelah ini, buka Userman (menu Manajemen > Userman) untuk
-- mengatur akses menu sidebar per role.
