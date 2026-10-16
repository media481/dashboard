# Checklist Tahunan: Generator Konten IG Scheduler

Lakukan sekali setahun, idealnya awal September (sebelum Rencana Setahun berikutnya disusun).
Letakkan file ini di root repo bersama `pola-konten.md`.

## Yang jalan otomatis (tidak perlu disentuh)
- Tanggal Hijriah dan pekan hari besar (dihitung dari kalender browser).
- Rotasi tema alur dan jeda 365 hari (tema musiman 300 hari).
- Ledger tema yang sama: tema yang kembali (edisi 2+) otomatis membawa daftar ide lama ke AI dan ide lama yang diulang ditolak.

## Yang dicek manual

1. **Bank tema alur** (`IG_ALUR_GRUP` di `js/app.js`, 95 tema dalam 5 fase: sebelum berangkat 24, Makkah 36, Madinah 11, umroh bersama siapa 9, pulang 15)
   - Rotasi antar fase otomatis menurut `bobot` tiap fase. Fase paling tipis (Madinah, umroh bersama siapa) habis lebih dulu: tambahkan tema baru di fase itu lebih dulu.
   - Mau mengubah komposisi (mis. lebih banyak konten calon jamaah baru)? Ubah angka `bobot`, tidak perlu menyentuh logika.
   - Cukup untuk sekitar 2 tahun sebelum tema mulai kembali (simulasi: pekan ke-126).
   - Tambahkan 20-30 tema segar agar siklus berikutnya terasa baru.
   - Tema baru jangan mirip tema lama: cek dengan `igIsSimilarText`, atau cukup lihat peringatan saat menyimpan.
   - Tema yang tumpang tindih (misalnya fisik/stamina/kesehatan) sebaiknya tidak berdekatan.

2. **Tema musiman** (`IG_TEMA_MUSIM` di `js/app.js`)
   - Hari besar ber-`hijriRentang`: tidak perlu diubah.
   - Tema penjualan per bulan Masehi (libur sekolah, libur akhir tahun): cocokkan dengan kalender sekolah dan kebijakan musim umroh tahun itu.
   - Tema penjualan tetap tayang 2-3 bulan sebelum musimnya.

3. **`IG_RIWAYAT_AWAL`**
   - Isinya riwayat per 11 Okt 2026 dan tidak memblokir apa pun setelah 12 April 2027.
   - Boleh dibiarkan atau dihapus supaya rapi. Kalau dihapus, hapus juga salinan teksnya (poin 4).

4. **Teks panduan bertanggal** (edit keempatnya bersamaan)
   - `pola-konten.md` (bagian 6, Riwayat topik)
   - About Planner: `ABOUT_PLANNER_MD` di `js/app.js`
   - `IG_PLAN_PROMPT_SISTEM` di `js/app.js`
   - `CONTENT_PLAN_SYSTEM_PROMPT` di `supabase/functions/generate-ig-content-plan/index.ts`
   - Cari kalimat "sebelum 12 Oktober 2026" dan "jangan diulang sebelum 12 April 2027" lalu perbarui atau hapus.

5. **Rencana Setahun**
   - Buka modal Rencana Konten, lalu klik "Susun dengan AI" untuk 12 bulan ke depan.
   - Pekan yang terkunci (sudah diedit manual) tidak ditimpa.
   - Periksa tema hari besar: harus jatuh di pekan peristiwanya.

6. **Deploy ulang bila ada perubahan di edge function**
   - `supabase functions deploy generate-ig-content-plan --no-verify-jwt`
   - `supabase functions deploy generate-ig-year-plan --no-verify-jwt`
   - Jalankan tes: `node --experimental-strip-types supabase/functions/generate-ig-content-plan/test-core.mjs`

## Uji cepat sesudah update
- Generate satu pekan dengan tema yang pernah dipakai tahun lalu.
- Pastikan hook, pembuka caption, dan topik tiap hari berbeda dari edisi sebelumnya.
- Bila masih mirip, tambahkan `kunci_topik` (pencocokan topik yang pasti, bukan kata) sebagai langkah berikutnya.
