-- Menyederhanakan status Pendaftaran dari (baru/dihubungi/deal/batal) jadi
-- cuma 2: Deal / Batal. Perubahan tampilan & form sudah dilakukan di
-- index.html + js/app.js. File ini mengurus DATA LAMA di database supaya
-- konsisten dengan aturan baru. Aman dijalankan berkali-kali (idempotent).

-- ------------------------------------------------------------------
-- Langkah 0: status lama "dihubungi" (kalau masih ada sisa) disamakan
-- dulu ke "baru", supaya ikut diproses di langkah berikut.
-- ------------------------------------------------------------------
update pendaftaran
set status = 'baru'
where status = 'dihubungi';

-- ------------------------------------------------------------------
-- Langkah 1: pendaftaran "baru" yang SUDAH punya program_id -> anggap
-- Deal. Buatkan baris Data Jamaah (kb_jamaah) untuk masing-masing,
-- persis seperti proses otomatis autoConvertPendaftaranToJamaah di
-- js/app.js, supaya konsisten dengan yang terjadi kalau admin submit
-- form Deal secara normal. Baris yang KEBETULAN sudah ada baris
-- kb_jamaah tertaut (pendaftaran_id) dilewati, tidak dobel insert.
-- ------------------------------------------------------------------
insert into kb_jamaah (
    program_id, nama, nik, wa, asal, tipe_kamar, status, catatan,
    jenis_kelamin, tempat_lahir, tgl_lahir, alamat, kode_pos,
    telp_rumah, ahli_waris_nama, ahli_waris_hubungan, pendaftaran_id
)
select
    p.program_id,
    coalesce(p.nama, ''),
    coalesce(p.ktp, ''),
    coalesce(p.wa, ''),
    coalesce(p.asal, ''),
    'quad',
    'pending',
    coalesce(p.catatan, ''),
    p.jenis_kelamin,
    p.tempat_lahir,
    p.tgl_lahir,
    p.alamat,
    p.kode_pos,
    p.telp_rumah,
    p.ahli_waris_nama,
    p.ahli_waris_hubungan,
    p.id
from pendaftaran p
where p.status = 'baru'
  and p.program_id is not null
  and not exists (
      select 1 from kb_jamaah j where j.pendaftaran_id = p.id
  );

-- Langkah 1b: baris pendaftaran yang barusan dibuatkan Data Jamaah-nya
-- (langkah 1 di atas), statusnya diubah jadi 'deal'.
update pendaftaran p
set status = 'deal'
where p.status = 'baru'
  and p.program_id is not null
  and exists (
      select 1 from kb_jamaah j where j.pendaftaran_id = p.id
  );

-- ------------------------------------------------------------------
-- Langkah 2: pendaftaran "baru" yang BELUM punya program_id TIDAK BISA
-- otomatis di-Deal-kan (aturan app: Deal wajib ada program keberangkatan
-- dulu -- lihat validasi di savePendaftaran, js/app.js). Baris ini
-- SENGAJA DIBIARKAN apa adanya (status tetap 'baru' di database).
--
-- Setelah migrasi ini jalan, form di aplikasi sudah tidak punya opsi
-- "Baru" lagi -- jadi baris sisa ini tidak akan muncul salah di filter
-- manapun (filternya cuma Deal/Batal), tapi datanya tetap ada. Cek
-- daftarnya lewat query berikut, lalu tentukan manual per baris (isi
-- program lalu Simpan sebagai Deal, atau tandai Batal):
--
--   select id, nama, wa, asal, created_at
--   from pendaftaran
--   where status = 'baru'
--   order by created_at desc;
