-- ============================================================
-- MIGRASI: Nomor Kuitansi Otomatis & Tersistem
-- Jalankan di: Supabase Dashboard -> SQL Editor -> New Query -> Run
--
-- Sebelumnya "Nomor Kuitansi" di modal Kuitansi (tab Keberangkatan) diisi
-- manual oleh staf (rawan salah ketik / dobel / tidak berurutan). Migrasi
-- ini membuat nomor tsb dibuat OTOMATIS oleh database, sekuensial per
-- tahun, lewat sequence + RPC function -- polanya sama dengan nomor_nota
-- di sql/tambah_nota_audit.sql, hanya di sini tidak terikat ke tabel
-- (kuitansi memang dokumen bebas, tidak selalu terhubung ke satu baris
-- pembayaran_jamaah tertentu).
--
-- Format nomor: AHI/KWT/<tahun>/<6 digit>, mis. AHI/KWT/2026/000001
-- ============================================================

create sequence if not exists kuitansi_nomor_seq start 1;

create or replace function next_kuitansi_nomor()
returns text
language plpgsql
security definer
as $$
declare
    v_nomor text;
begin
    v_nomor := 'AHI/KWT/' || to_char(current_date, 'YYYY') || '/' || lpad(nextval('kuitansi_nomor_seq')::text, 6, '0');
    return v_nomor;
end;
$$;

grant execute on function next_kuitansi_nomor() to anon, authenticated;

-- Selesai. Setelah ini, field "Nomor Kuitansi" di modal Kuitansi otomatis
-- terisi & terkunci (read-only) begitu modal dibuka -- setiap kali modal
-- dibuka, satu nomor baru "diambil" dari sequence (kalau modal ditutup
-- tanpa diunduh, nomor itu dianggap batal/terlewati, mirip buku kuitansi
-- fisik yang halamannya dibatalkan -- ini wajar & sengaja, supaya nomor
-- tidak perlu logika reservasi yang rumit).
