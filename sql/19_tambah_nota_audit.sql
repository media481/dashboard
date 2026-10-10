-- ============================================================
-- MIGRASI: Nomor Nota Resmi (dari DB) + Log Audit Nota (append-only)
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Aman dijalankan di project yang SUDAH ada isinya (pakai IF NOT EXISTS),
-- tidak akan menghapus/mengubah data pembayaran yang sudah ada.
--
-- Yang dilakukan migrasi ini:
-- 1. Menambah kolom `nomor_nota` di tabel pembayaran_jamaah, diisi otomatis
--    oleh trigger memakai sequence global (AHI/2026/000123, sekuensial &
--    permanen — sekali dibuat, nomor itu tidak berubah lagi walau nota
--    dicetak ulang berkali-kali).
-- 2. Backfill nomor_nota untuk data pembayaran lama yang belum punya nomor,
--    diurutkan dari tanggal transaksi paling lama supaya urutannya wajar.
-- 3. Membuat tabel nota_audit_log — ledger append-only (trigger memblokir
--    UPDATE & DELETE sama sekali di level database) yang mencatat setiap
--    nota yang diterbitkan/dicetak: nomor nota, jenis, siapa yang mencetak,
--    kode verifikasi, hash konten, dan waktu.
-- ============================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------
-- 1. Sequence & kolom nomor_nota
-- ----------------------------------------------------------------
create sequence if not exists nota_nomor_seq start 1;

alter table pembayaran_jamaah add column if not exists nomor_nota text;

create or replace function set_nomor_nota() returns trigger as $$
begin
    if new.nomor_nota is null or new.nomor_nota = '' then
        new.nomor_nota := 'AHI/' || to_char(coalesce(new.tanggal, current_date), 'YYYY')
            || '/' || lpad(nextval('nota_nomor_seq')::text, 6, '0');
    end if;
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_nomor_nota on pembayaran_jamaah;
create trigger trg_set_nomor_nota
    before insert on pembayaran_jamaah
    for each row execute function set_nomor_nota();

-- Backfill data lama (urut dari transaksi paling lama), sekali jalan saja —
-- baris yang sudah punya nomor_nota (dijalankan ulang migrasinya) dilewati.
with belum_bernomor as (
    select id, tanggal,
           row_number() over (order by tanggal asc, created_at asc) as urutan
    from pembayaran_jamaah
    where nomor_nota is null or nomor_nota = ''
)
update pembayaran_jamaah p
set nomor_nota = 'AHI/' || to_char(coalesce(b.tanggal, current_date), 'YYYY')
    || '/' || lpad(nextval('nota_nomor_seq')::text, 6, '0')
from belum_bernomor b
where p.id = b.id;

-- Nomor nota harus unik & tidak boleh diedit manual dari client.
create unique index if not exists idx_pembayaran_jamaah_nomor_nota on pembayaran_jamaah (nomor_nota);

create or replace function lindungi_nomor_nota() returns trigger as $$
begin
    if old.nomor_nota is not null and new.nomor_nota is distinct from old.nomor_nota then
        raise exception 'nomor_nota tidak boleh diubah setelah diterbitkan';
    end if;
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_lindungi_nomor_nota on pembayaran_jamaah;
create trigger trg_lindungi_nomor_nota
    before update on pembayaran_jamaah
    for each row execute function lindungi_nomor_nota();

-- ----------------------------------------------------------------
-- 2. Tabel log audit nota — append-only
-- ----------------------------------------------------------------
create table if not exists nota_audit_log (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    nomor_nota text not null,
    jenis text not null check (jenis in ('pembayaran', 'riwayat')),
    jamaah_id uuid,
    jamaah_nama text,
    program_nama text,
    jumlah numeric,
    dicetak_oleh_role text,
    dicetak_oleh_nama text,
    kode_verifikasi text not null,
    hash_konten text not null,
    metadata jsonb
);

create index if not exists idx_nota_audit_log_nomor_nota on nota_audit_log (nomor_nota);
create index if not exists idx_nota_audit_log_kode_verifikasi on nota_audit_log (kode_verifikasi);
create index if not exists idx_nota_audit_log_created_at on nota_audit_log (created_at desc);

alter table nota_audit_log enable row level security;

drop policy if exists "Allow read nota_audit_log" on nota_audit_log;
create policy "Allow read nota_audit_log" on nota_audit_log for select using (true);

drop policy if exists "Allow insert nota_audit_log" on nota_audit_log;
create policy "Allow insert nota_audit_log" on nota_audit_log for insert with check (true);

-- Ledger ini SENGAJA tidak punya policy UPDATE/DELETE (RLS akan menolaknya
-- secara default), DAN ditambah trigger sebagai lapisan proteksi kedua di
-- level database supaya audit trail tidak bisa dimanipulasi lewat cara apa pun.
create or replace function blokir_ubah_nota_audit_log() returns trigger as $$
begin
    raise exception 'nota_audit_log bersifat append-only — baris yang sudah tercatat tidak boleh diubah atau dihapus';
end;
$$ language plpgsql;

drop trigger if exists trg_blokir_update_nota_audit_log on nota_audit_log;
create trigger trg_blokir_update_nota_audit_log
    before update on nota_audit_log
    for each row execute function blokir_ubah_nota_audit_log();

drop trigger if exists trg_blokir_delete_nota_audit_log on nota_audit_log;
create trigger trg_blokir_delete_nota_audit_log
    before delete on nota_audit_log
    for each row execute function blokir_ubah_nota_audit_log();

-- Selesai. Setelah ini:
-- * Nomor nota (No. Nota di dokumen cetak) dibuat & dikunci oleh database.
-- * Setiap nota yang diunduh akan otomatis tercatat di nota_audit_log
--   (lihat js/app.js -> logNotaAudit()), terlihat di menu Admin -> Audit Nota.
