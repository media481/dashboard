-- Perbaikan integritas finansial untuk instalasi yang sudah ada.
-- Aman dijalankan berulang kali.

alter table kt_kas add column if not exists updated_at timestamptz default now();
create or replace function kt_set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_set_updated_at on kt_kas;
create trigger trg_set_updated_at before update on kt_kas
  for each row execute function kt_set_updated_at();

-- Batas akhir keanggotaan supaya nonaktif tidak menghapus riwayat bulan lama.
alter table kt_dana_sosial_anggota add column if not exists tanggal_nonaktif date;

-- Snapshot nilai ketika status belanja berubah menjadi dibeli.
alter table kt_daftar_belanja_perlengkapan add column if not exists nominal_realisasi numeric;
alter table kt_daftar_belanja_jalan_santai add column if not exists nominal_realisasi numeric;
alter table kt_daftar_belanja_hadiah add column if not exists qty_snapshot numeric;
alter table kt_daftar_belanja_hadiah add column if not exists harga_satuan_snapshot numeric;
alter table kt_daftar_belanja_hadiah add column if not exists harga_eceran_snapshot numeric;
alter table kt_daftar_belanja_hadiah add column if not exists isi_per_pack_snapshot numeric;
