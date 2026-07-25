# Catatan Pembersihan Struktur

## Kesimpulan: file yang menghubungkan ke Supabase
Satu-satunya sumber koneksi Supabase yang AKTIF dipakai adalah:
- `index.html` → tag `<script>` di sekitar baris 1392, berisi `SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `supabaseClient`.

index.html adalah file SELF-CONTAINED: semua CSS, JS, dan logic sudah digabung inline
di dalamnya (tidak load file .js/.css eksternal apa pun selain library CDN Supabase & jsPDF).

## Yang dipindahkan ke folder `_legacy_unused/`
File-file berikut TIDAK direferensikan oleh index.html sama sekali (dead code / versi lama):
- `js_folder/` — seluruh versi modular lama (js/app.js, js/config.js, dll)
- File .js lepas di root: admin-panel.js, app.js, config.js, crosscheck.js, infobar.js,
  init.js, jadwal-tamu.js, kb-jamaah.js, parse-broadcast.js, poster-popup.js,
  search-filter.js, security.js, supabase-api.js, table.js, telegram.js, utils.js
- `css/style.css` — index.html sudah punya <style> inline sendiri, file ini tidak di-load

Tidak ada yang dihapus permanen, hanya dipindah ke folder arsip supaya tidak
membingungkan lagi kalau nanti perlu cek referensi lama.

## Bug kecil yang ikut diperbaiki
`service-worker.js` sebelumnya mem-precache `./css/style.css` dan `./js/app.js` —
padahal dua file itu tidak pernah dipakai index.html. Ini sudah dihapus dari
daftar precache, dan versi cache dinaikkan ke v16 supaya browser lama refresh
service worker-nya.

## Duplikasi ikon (Ronde 2)
Sudah dicek: `manifest.json` hanya mereferensikan file di folder `icons/` (9 file,
semua ukuran + versi maskable), dan `index.html` hanya pakai `icons/icon-180.png`
+ `icons/icon-192.png`. Ikon duplikat yang ada di root (`icon-144.png`, `icon.svg`,
dst — 10 file) dipindahkan ke `_legacy_unused/root_duplicate_icons/`.

## File salah label (Ronde 2)
`create_kwt_kuitansi.sql` di root ternyata ISINYA KODE JS (fitur KB Jamaah),
bukan SQL — nama filenya menyesatkan. SQL yang benar untuk tabel `kwt_kuitansi`
ada di `sql/create_kwt_kuitansi.sql` dan itu yang dipertahankan. File yang salah
label dipindah ke `_legacy_unused/create_kwt_kuitansi_MISLABELED_actually_js.sql`.

## Struktur akhir folder aktif
```
index.html                     ← aplikasi utama (self-contained + koneksi Supabase)
manifest.json                  ← config PWA
service-worker.js              ← sudah diperbaiki
icons/                         ← 9 ikon sesuai manifest.json
sql/create_kwt_kuitansi.sql    ← SQL yang benar
```
Semua yang lain ada di `_legacy_unused/` — tidak dihapus, tinggal review lalu
hapus manual kalau sudah yakin tidak dibutuhkan lagi.
