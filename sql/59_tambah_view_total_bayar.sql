-- ============================================================
-- OPTIMASI: View total pembayaran per jamaah (v_total_bayar)
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- WAJIB dijalankan SEBELUM deploy frontend yang memakai fetchTotalBayar().
-- Aman diulang (create or replace); tidak mengubah data apa pun.
--
-- MASALAH SEBELUMNYA:
--   Total dibayar tiap jamaah dihitung di browser: tarik SEMUA baris
--   pembayaran_jamaah (.in('jamaah_id', [ratusan UUID])) lalu dijumlahkan
--   di JS. Dua risikonya:
--     1) Supabase memotong hasil di 1000 baris TANPA error -> begitu total
--        baris cicilan > 1000, total pemasukan & status Lunas/DP salah diam-diam.
--     2) .in() dengan ratusan UUID bikin URL GET kepanjangan (batas ~8 KB).
--
-- SOLUSI: agregasi di database. Satu baris per jamaah (bukan per cicilan),
-- bisa difilter per program lewat kolom program_id.
--
-- Keamanan: security_invoker = true -> RLS tabel pembayaran_jamaah & kb_jamaah
-- tetap berlaku atas nama pemanggil (hanya user yang login yang bisa baca,
-- sama seperti sebelumnya, lihat 27_hardening_rls_pembayaran_select.sql).
-- Refund = baris negatif, jadi SUM() otomatis mengurangi total.
--
-- Butuh pembayaran_jamaah dan kb_jamaah. Sudah termasuk di
-- sql/00_SETUP_LENGKAP_SATU_FILE.sql (v4); file ini hanya untuk project yang
-- sudah berjalan. Dipakai juga oleh Edge Function radar-risiko-jamaah.
-- ============================================================

create or replace view public.v_total_bayar
with (security_invoker = true) as
select
    p.jamaah_id,
    j.program_id,
    sum(p.jumlah)  as total_dibayar,
    count(*)::int  as jumlah_transaksi
from public.pembayaran_jamaah p
join public.kb_jamaah j on j.id = p.jamaah_id
group by p.jamaah_id, j.program_id;

revoke all on public.v_total_bayar from public, anon;
grant select on public.v_total_bayar to authenticated;
