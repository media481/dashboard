# Merger Gudang → Merdeka — Catatan Deploy

## Yang berubah
- Menu baru **"Gudang Aset"** muncul di sidebar Merdeka (ikon kotak), dengan 4 tab:
  **Stok Barang** (publik), **Ajukan Pinjam**, **Riwayat Peminjaman**, dan
  **Kelola Inventaris** (khusus admin).
- Data gudang sekarang disimpan di project Supabase **Merdeka** (bukan project
  Gudang/Sedesa yang lama), di tabel baru berprefix `kt_gudang_...`.
- Tidak ada PIN admin terpisah lagi. Hak kelola aset, ubah status peminjaman,
  dan hapus riwayat sekarang memakai role login Merdeka — **hanya role admin**
  yang bisa. User/petugas/guest tetap bisa lihat stok & mengajukan pinjam
  (persis seperti warga umum di app Sedesa yang lama, tidak perlu login).
- Tampilan mengikuti gaya desain Merdeka yang sudah ada (kartu, panel, badge,
  modal) — bukan tampilan lama Sedesa (warna navy/kertas/copper).

## Update — perbaikan multi-user (6+ orang, device/waktu berbeda-beda)

Ditemukan satu celah race condition: saat admin mengedit **Total Unit** aset
di "Kelola Inventaris", perhitungan stok tersedia sebelumnya dilakukan di
browser pakai data yang bisa basi — kalau ada orang lain meminjam/
mengembalikan barang yang sama persis di saat itu, perubahan stoknya bisa
tertimpa diam-diam. Sudah diperbaiki jadi 1 transaksi atomik di server
(RPC `kt_gudang_update_asset`, lihat komentar di file migrasinya untuk
detail skenarionya). Modul Gudang juga sekarang ikut auto-refresh 20 detik
seperti menu lain (sebelumnya cuma dimuat sekali + tombol refresh manual).

**Langkah tambahan**: jalankan juga `supabase-gudang-race-fix-migration.sql`
di SQL Editor (project Merdeka), sekali saja, setelah migrasi Gudang utama.
Aman dijalankan berkali-kali kalau perlu.

## Langkah deploy

1. **Jalankan migrasi SQL** — buka Supabase Dashboard project **Merdeka**
   (bukan project Gudang lama) → SQL Editor → jalankan isi file
   `supabase-gudang-migration.sql`. Ini membuat tabel `kt_gudang_inventory`,
   `kt_gudang_transactions`, `kt_gudang_transaction_items`,
   `kt_gudang_resi_seq`, beserta RLS dan fungsi RPC (`kt_gudang_borrow_stock`,
   `kt_gudang_return_stock`, `kt_gudang_reborrow_stock`,
   `kt_gudang_claim_next_resi`) yang menjaga perubahan stok tetap atomik
   (aman dari race condition saat dua orang pinjam bersamaan).

2. **(Opsional) Pindahkan data lama** — kalau project Gudang lama sudah ada
   data produksi (aset & riwayat pinjam yang nyata), export dulu dari sana
   (Supabase Table Editor → Export CSV, atau tulis query manual jadi JSON
   dengan format `{inventory:[...], transactions:[...]}` sesuai struktur di
   `kt_gudang_inventory`/`kt_gudang_transactions`/`kt_gudang_transaction_items`),
   lalu import lewat tombol **Import JSON** di menu Gudang → Kelola Inventaris
   setelah app baru ini di-deploy. Tombol ini menambah data (bukan menimpa),
   jadi aman dijalankan sambil masih ada aktivitas di app.

3. **Upload semua file di folder ini** ke hosting yang sama dengan Merdeka
   (Netlify/Vercel/GitHub Pages/dst), menimpa file lama. Tidak perlu ganti
   apa pun di `SUPABASE_URL`/`SUPABASE_ANON_KEY` — keduanya masih project
   Merdeka yang sama seperti sebelumnya.

4. **Cek akses**: login sebagai admin → menu "Gudang Aset" harus muncul tab
   "Kelola Inventaris". Logout / buka sebagai tamu → menu tetap muncul tapi
   hanya tab Stok/Pinjam/Riwayat (tanpa opsi ubah status atau kelola aset).

## Catatan desain
- Gudang **tidak terikat event tahunan** (17-an) karena aset desa bersifat
  permanen sepanjang tahun — menu ini selalu bisa dibuka walau belum ada
  event aktif dipilih, beda dari menu lain yang butuh event.
- Kalau ingin membatasi menu ini hanya untuk role tertentu (mis. sembunyikan
  dari petugas kecuali ditugaskan), atur lewat halaman **Manajemen User**
  seperti mengatur bidang/section petugas lainnya — sistemnya sudah otomatis
  mendukung karena Gudang memakai mekanisme section yang sama dengan menu lain.
