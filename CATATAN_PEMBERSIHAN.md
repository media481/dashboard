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

## Ronde 3: Pecah index.html jadi 3 file
index.html tadinya self-contained (CSS + JS inline, 3656 baris). Sekarang dipecah:
- `index.html` — struktur HTML saja (457 baris), load `css/style.css` via `<link>`
  dan `js/app.js` via `<script src>`
- `css/style.css` — semua styling (937 baris)
- `js/app.js` — semua logic termasuk koneksi Supabase (2261 baris)

Koneksi Supabase sekarang ada di `js/app.js` baris 4-5 (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).

`service-worker.js` sudah disesuaikan lagi: `css/style.css` dan `js/app.js`
dikembalikan ke daftar precache, versi cache dinaikkan ke v17.

## Struktur akhir folder aktif (final)
```
index.html          ← struktur halaman
css/style.css        ← styling
js/app.js            ← logic + koneksi Supabase
manifest.json         ← config PWA
service-worker.js     ← precache list sinkron dengan struktur di atas
icons/                ← 9 ikon sesuai manifest.json
sql/create_kwt_kuitansi.sql
```

## Ronde 4: Tambah modul Poster Hover Popup
Dari `poster-popup.js` yang di-upload, isinya sebenarnya 3 bagian berbeda:
1. **`resolveImageUrl` / `showPosterPopup` / `hidePosterPopup`** — modul baru,
   BELUM ada di project → ditambahkan ke `js/app.js` (bagian "24. POSTER HOVER POPUP").
   Ditambah kecil: `img.onload`/`img.onerror` supaya loading spinner & pesan error
   benar-benar hilang/muncul sesuai kondisi (di kode asli belum di-wire).
2. **`checkAdminLogin`** — SUDAH ADA di `js/app.js`, versi yang sudah ada malah
   lebih lengkap (ada logika reset lockout otomatis). Tidak ditambahkan lagi
   supaya tidak duplikat/timpa fungsi yang lebih baik.
3. **`openDrawer` / `closeDrawer`** — TIDAK ditambahkan. Project sudah punya
   mekanisme sidebar mobile sendiri (`toggleMobileSidebar()` + elemen
   `#mobileSidebarOverlay`), jadi `openDrawer`/`closeDrawer` (pakai id
   `#mobileOverlay`) redundan dan tidak dipakai tombol mana pun.

Markup HTML popup (`#posterPopup`, `#posterPopupImg`, dst) ditambahkan di
`index.html` sebelum `</body>`, dan styling-nya di `css/style.css`
(bagian "POSTER HOVER POPUP").

### Belum otomatis tersambung
Fungsi ini butuh elemen pemicu (misalnya thumbnail/link poster program) dengan
atribut `data-poster="URL"` dan `data-nama="Nama Program"`, plus:
```html
onmouseenter="showPosterPopup(event, this)" onmouseleave="hidePosterPopup()"
```
Saya belum tahu persis di elemen/tabel mana kamu mau preview ini muncul
(mis. di daftar program admin, di tabel crosscheck, dll), jadi trigger-nya
belum saya pasang ke elemen manapun. Kabari saja di elemen mana, nanti saya pasangkan.

## Ronde 5: SQL setup untuk Supabase project baru
File baru: `sql/00_setup_semua_tabel.sql` — berisi CREATE TABLE + RLS policy
untuk SEMUA tabel yang dipakai project ini (dikumpulkan dari seluruh
`.from('...')` call di `js/app.js`):

| Tabel | Fungsi |
|---|---|
| `programs` | Data program umroh (field admin-only digabung di kolom `admin_data_lengkap` jsonb) |
| `jadwal_tamu` | Jadwal kunjungan tamu |
| `kb_jamaah` | Data jamaah per program |
| `featured_programs` | Program yang ditandai unggulan |
| `app_config` | Password login admin/CS (key-value) — sudah diisi password placeholder, WAJIB diganti |
| `tg_config` | Config notifikasi Telegram (key-value) |
| `kwt_kuitansi` | Kuitansi (tabel disiapkan, belum otomatis dipakai app.js saat ini) |

Cara pakai: buka Supabase Dashboard project baru -> SQL Editor -> New query ->
paste seluruh isi `sql/00_setup_semua_tabel.sql` -> Run.

**Yang TIDAK dibuat oleh SQL ini** (harus di-setup manual terpisah):
- Edge Function `scan-poster-ocr` (dipakai fitur Crosscheck OCR)
- Edge Function `send-telegram` (dipakai fitur notifikasi Telegram)

Setelah tabel dibuat, jangan lupa:
1. Ganti password default di `app_config` (`pass_administrator`, `pass_cs`)
2. Update `SUPABASE_URL` & `SUPABASE_ANON_KEY` di `js/app.js` baris 4-5

## Ronde 6: Edge Functions (send-telegram & scan-poster-ocr)
Dicek dari `amirubase-main__1_.zip` yang di-upload — ternyata **source code
Edge Function-nya tidak ada di repo itu**, cuma kode client yang memanggil
endpoint-nya. Function aslinya kemungkinan dibuat langsung lewat Supabase
Dashboard tanpa pernah di-commit.

Karena itu, saya TULIS ULANG kedua function dari nol berdasarkan kontrak
request/response yang dipakai `js/app.js`, ditaruh di:
```
supabase/functions/send-telegram/index.ts
supabase/functions/scan-poster-ocr/index.ts
supabase/functions/README.md   <- panduan deploy lengkap
```

- `send-telegram`: proxy ke Telegram Bot API, tidak butuh secret tambahan.
- `scan-poster-ocr`: baca poster pakai Gemini Vision, butuh secret
  `GEMINI_API_KEY` (gratis dari https://aistudio.google.com/apikey).

Cara deploy ada lengkap di `supabase/functions/README.md` (pakai Supabase CLI).
