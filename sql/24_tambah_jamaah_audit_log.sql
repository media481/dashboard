-- ============================================================
-- MIGRASI: Riwayat Aktivitas per Jamaah (jamaah_audit_log)
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Aman dijalankan di project yang SUDAH ada isinya (pakai IF NOT EXISTS).
--
-- Beda dengan nota_audit_log (yang fokus ke kuitansi/nota pembayaran),
-- tabel ini mencatat perubahan pada data jamaah itu sendiri: status
-- pembayaran, tipe kamar, harga khusus, dan catatan -- supaya kalau
-- nanti ada multi-admin, bisa dilacak siapa mengubah apa dan kapan.
--
-- Ledger ini append-only (sama seperti nota_audit_log): trigger di
-- database memblokir UPDATE & DELETE, jadi riwayat tidak bisa
-- dihapus/diedit dari sisi manapun, termasuk kalau ada bug di client.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists jamaah_audit_log (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    jamaah_id uuid,
    jamaah_nama text,
    aksi text not null,
    field text,
    nilai_lama text,
    nilai_baru text,
    actor_role text,
    actor_nama text
);

create index if not exists idx_jamaah_audit_log_jamaah_id on jamaah_audit_log (jamaah_id);
create index if not exists idx_jamaah_audit_log_created_at on jamaah_audit_log (created_at desc);

alter table jamaah_audit_log enable row level security;

drop policy if exists "Allow read jamaah_audit_log" on jamaah_audit_log;
create policy "Allow read jamaah_audit_log" on jamaah_audit_log for select using (true);

drop policy if exists "Allow insert jamaah_audit_log" on jamaah_audit_log;
create policy "Allow insert jamaah_audit_log" on jamaah_audit_log for insert with check (true);

-- Append-only: tolak UPDATE & DELETE di level database (bukan cuma RLS),
-- supaya riwayat aktivitas benar-benar tidak bisa dimanipulasi.
create or replace function blokir_ubah_jamaah_audit_log() returns trigger as $$
begin
    raise exception 'jamaah_audit_log bersifat append-only — baris yang sudah tercatat tidak boleh diubah atau dihapus';
end;
$$ language plpgsql;

drop trigger if exists trg_blokir_update_jamaah_audit_log on jamaah_audit_log;
create trigger trg_blokir_update_jamaah_audit_log
    before update on jamaah_audit_log
    for each row execute function blokir_ubah_jamaah_audit_log();

drop trigger if exists trg_blokir_delete_jamaah_audit_log on jamaah_audit_log;
create trigger trg_blokir_delete_jamaah_audit_log
    before delete on jamaah_audit_log
    for each row execute function blokir_ubah_jamaah_audit_log();

-- Selesai. Setelah ini, setiap perubahan Status Pembayaran / Tipe Kamar /
-- Harga Khusus / Catatan pada Edit Data Jamaah otomatis tercatat di sini
-- (lihat js/app.js -> logKbJamaahChanges()), dan bisa dilihat di panel
-- "Riwayat Aktivitas" dalam modal Kelola Cicilan tiap jamaah.
