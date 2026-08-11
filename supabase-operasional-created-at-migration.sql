-- ============================================================
-- MIGRASI: kolom `created_at`, `satuan`, `qty` di tabel kt_operasional
--
-- LATAR BELAKANG (created_at):
-- Daftar Biaya Operasional perlu menampilkan transaksi PALING BARU
-- di baris paling atas. Sebelumnya urutan hanya mengandalkan kolom
-- `tanggal` (tanggal yang dipilih user, bisa sama untuk banyak baris,
-- dan bisa diisi mundur), jadi transaksi yang baru saja ditambahkan
-- tidak selalu muncul paling atas kalau tanggalnya sama/lebih lama
-- dari baris lain. Kolom `created_at` merekam kapan baris benar-benar
-- dibuat, terisi otomatis lewat default now() saat insert.
--
-- LATAR BELAKANG (satuan, qty):
-- script.js sudah lama mengirim field `satuan` (harga satuan) dan
-- `qty` untuk setiap biaya operasional, tapi kolomnya ternyata belum
-- pernah dibuat di tabel ini sama sekali — sehingga upsert selalu
-- gagal dengan error PGRST204 "Could not find the 'qty' column".
-- `satuan` dipakai sebagai HARGA SATUAN (angka, bukan lagi label teks
-- seperti "paket"/"buah"), dan `jumlah` = satuan × qty.
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================

alter table kt_operasional add column if not exists created_at timestamptz default now();
alter table kt_operasional add column if not exists satuan numeric default 0;
alter table kt_operasional add column if not exists qty integer default 1;

-- Isi baris lama yang masih null. Karena urutan/harga-satuan lama tidak
-- diketahui lagi, dipakai nilai default sekadar supaya kolomnya tidak
-- kosong (tidak mempengaruhi baris baru yang dibuat setelah migrasi ini).
update kt_operasional set created_at = now() where created_at is null;
update kt_operasional set satuan = coalesce(jumlah, 0) where satuan is null;
update kt_operasional set qty = 1 where qty is null;

