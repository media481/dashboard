-- Migrasi: pindahkan reminder otomatis lomba dari Agenda Kegiatan (kt_agenda)
-- ke Jadwal & Reminder (kt_jadwal).
--
-- Sebelumnya kt_lomba.agenda_id menunjuk ke baris di kt_agenda (tidak terikat
-- event). Sekarang dipindah ke kt_lomba.jadwal_id yang menunjuk ke baris di
-- kt_jadwal (terikat event_id, sama seperti event_id lomba-nya).
--
-- Jalankan sekali saja lewat SQL editor Supabase.

-- 1) Tambah kolom baru di kt_lomba
alter table kt_lomba add column if not exists jadwal_id uuid;

-- 2) Pindahkan entri kt_agenda yang berasal dari lomba ke kt_jadwal,
--    sambil membawa event_id dari lomba pemiliknya.
insert into kt_jadwal (id, event_id, judul, tanggal, kategori, deskripsi, status)
select a.id, l.event_id, a.judul, a.tanggal, a.kategori, a.deskripsi, a.status
from kt_agenda a
join kt_lomba l on l.agenda_id = a.id
on conflict (id) do nothing;

-- 3) Set jadwal_id di kt_lomba supaya link-nya ikut pindah
update kt_lomba l
set jadwal_id = l.agenda_id
where l.agenda_id is not null;

-- 4) Hapus entri lama di kt_agenda yang sudah dipindahkan
delete from kt_agenda a
using kt_lomba l
where l.agenda_id = a.id;

-- 5) (Opsional, jalankan manual setelah memastikan data di atas sudah benar)
-- Kolom agenda_id di kt_lomba sudah tidak dipakai lagi oleh aplikasi,
-- boleh dihapus kalau mau beres-beres skema:
-- alter table kt_lomba drop column agenda_id;
