# Laporan Analisis Bug — Dashboard Amiru (dashboard-main (46).zip)

Tanggal: 2026-08-07
Tipe: analisis statis (baca kode + SQL), belum dijalankan di browser.

## Ringkasan
Webapp ini secara struktur sudah rapi (versi (46) sudah dipecah jadi modul di `js/`,
tapi `index.html` HANYA memuat `js/app.js` — file JS lainnya orphan). Ditemukan
**7 bug**: 2 fatal (app gak bisa connect ke Supabase), 1 kritis (login CS mati),
3 security (XSS + RLS terbuka), 1 struktur (file orphan rusak).

---

## BUG #1 [FATAL] SUPABASE_ANON_KEY berupa placeholder (gagal koneksi)
**Lokasi:** `js/app.js` baris 5
```js
const SUPABASE_ANON_KEY = "eyJhbG...WdXQ";   // <- literal placeholder, gak valid
```
String ini cuma 237 char placeholder, bukan JWT asli. `createClient` tetap jalan tapi
tiap request ke Supabase ditolak (401/unauthorized) → **seluruh data gagal load**.
**Fix:** ganti dengan anon key asli dari Supabase project (lihat `js/config.js` baris 3
`sb_publishable_YzVUaQ-...` yang BENAR, tapi file itu orphan jadi gak kepakai).

## BUG #2 [FATAL] SUPABASE_URL salah project
**Lokasi:** `js/app.js` baris 4
```js
const SUPABASE_URL = "https://asfcqbwvxomkcqzdkshf.supabase.co";
```
URL ini beda dengan URL benar di `js/config.js` (`rkdhssbyqqyheczejtix.supabase.co`).
Bahkan kalau key diperbaiki, URL salah → tetap gak connect. **Dua-duanya harus
disamakan dengan nilai di `js/config.js`.**

## BUG #3 [KRITIS] Login CS (pass_cs) mati total
**Lokasi:** `js/app.js` `loadUserRoles()` baris 500-503 vs `sql/00_setup_semua_tabel.sql` baris 162-165
- SQL seed HANYA membuat `pass_administrator` & `pass_cs`.
- Tapi `loadUserRoles()` di app.js memetakan:
  - `pass_admin` / `pass_administrator` → `admin` ✓
  - `pass_user` → `user`
  - `pass_guest` → `guest`
  - **`pass_cs` TIDAK dipetakan** ✗
- Akibat: CS yang login pakai password `pass_cs` gagal (`USER_ROLES[pwd]` undefined).
- Ironisnya, `js/security.js` (orphan) MEMPUNYAI pemetaan `pass_cs → cs`, tapi karena
  file itu gak diload, mapping itu gak aktif.
**Fix:** tambahkan baris di `loadUserRoles()`:
```js
if (row.key === 'pass_cs') USER_ROLES[row.value] = { role: 'user', label: 'CS / Customer Service' };
```
(dipetakan ke 'user' agar CS bisa edit data — sesuai `canManageProgramData()` yang
mengizinkan 'admin' & 'user'; kalau mau CS read-only, mapping ke 'guest').

## BUG #4 [SECURITY - XSS] escapeJsAttr tidak escape double-quote
**Lokasi:** `js/app.js` baris 109-112
```js
function escapeJsAttr(str) {
    if (!str) return '';
    return escapeHtml(str).replace(/\\/g, '\\\\').replace(/'/g, '\\'');  // <- gak escape "
}
```
`escapeHtml` hanya meng-escape `& < >`. Tanda `"` lolos. Karena nilai ini disisipkan
ke dalam `onclick="...'...'"` / `window.open('...')`, penyerang yang bisa input nama
program/jamaah/poster (atau via Supabase langsung) bisa menyuntikkan `"` untuk
memutus atribut dan menjalankan JS.
**Titik rentan konkret:**
- `js/app.js:1147` `openDeleteModal('programs','${p.id}','${escapeJsAttr(p.nama)}')`
- `js/app.js:1947` `openDeleteModal('jadwal_tamu','${j.id}','${escapeHtml(j.nama)...}')`
- `js/app.js:2169` `openDeleteModal('pendaftaran','${p.id}','${escapeHtml(p.nama)...}')`
- `js/app.js:2414` `openDeleteModal('kb_jamaah','${j.id}','${escapeHtml(j.nama)...}')`
- `js/app.js:4001` `window.open('${escapeHtml(prog.link_poster)}','_blank')`
- `js/app.js:366` `renderProgramLinkBtn` → `window.open('${escapeJsAttr(safeUrl)}'...)`
**Fix:** tambahkan `.replace(/"/g, '&quot;')` di `escapeJsAttr`, dan ubah 3 titik
(1947/2169/2414) yang pakai `escapeHtml(x).replace(/'/g,"\\'")` jadi pakai `escapeJsAttr()`.

## BUG #5 [SECURITY - XSS] link_poster/link_* di-render tanpa validasi URL di render
Sudah tercakup sebagian di #4, tapi catatan: `isValidUrl()` (baris 184) memang dipakai
saat SAVE (baris 1360), jadi URL aneh ditolak saat input. Namun kolom di DB bisa diubah
langsung via Supabase (RLS terbuka, lihat #6) sehingga tetap berisiko. Perbaikan #4
(escape quote) sudah menutup jalur injeksi atribut.

## BUG #6 [SECURITY] RLS semua tabel PERMISSIF (data & password bisa dibaca publik)
**Lokasi:** `sql/00_setup_semua_tabel.sql` baris 38-239
Setiap tabel punya policy `for select using (true)` dan `for update/insert/delete
using (true)`. Artinya SIAPA SAJA dengan anon key (atau tanpa login) bisa:
- Membaca SELURUH data (program, jamaah + NIK/paspor/WA, pendaftaran, pembayaran).
- Membaca **password login** di `app_config` (`pass_administrator`, `pass_cs`).
- Mengubah/menghapus data sembarangan via REST API publik.
Ini kebocoran privasi serius (NIK, paspor, nomor WA jamaah umroh).
**Mitigasi cepat (tanpa redesign auth):**
- `app_config`: tutup `select using (false)` untuk anon; password diverifikasi di
  server lewat Supabase RPC `SECURITY DEFINER` (bukan dibandingkan di browser).
- Data sensitif (`kb_jamaah`, `pendaftaran`, `pembayaran_jamaah`): setidaknya tutup
  `update/delete` untuk anon (`using (auth.role() = 'authenticated')`), biarkan `select`
  kalau memang mau publik (program memang publik).
- Catatan: app saat ini login via password di `app_config` + session client-side,
  bukan Supabase Auth, jadi full lock butuh migrasi ke Supabase Auth.

## BUG #7 [STRUKTUR] File orphan rusak `js/index.html` (portal lama)
**Lokasi:** `js/index.html`
File ini TIDAK diload `index.html` utama (yang utama cuma load `js/app.js`). Tapi isinya
memanggil fungsi yang TIDAK ADA di `js/app.js`:
- `openAdminModal()` (baris 50, 66)
- `openDrawer()` / `closeDrawer()` (baris 52, 66)
- `switchPubTab(...)` (baris 85, 88, 91, 94)
- `confirmDeleteProgram()` (baris 300)
Bila file ini kebuka secara kebetulan (mis. user deploy folder utuh & akses `/js/index.html`),
tombol-tombonya mati (ReferenceError) → portal rusak. Selain itu membingungkan karena
duplikat struktur dengan index.html utama.
**Fix:** hapus/quarantine `js/index.html` (dan file JS orphan lain: config.js, security.js,
admin-panel.js, crosscheck.js, dkk) karena gak dipakai — atau, kalau portal itu memang
diinginkan, sambungkan ke app.js. Rekomendasi: quarantine supaya gak membingungkan.

---

## File orphan (tidak dipakai, gak diload index.html)
`js/config.js`, `js/security.js`, `js/admin-panel.js`, `js/crosscheck.js`,
`js/featured.js`, `js/infobar.js`, `js/init.js`, `js/jadwal-tamu.js`, `js/kb-jamaah.js`,
`js/parse-broadcast.js`, `js/poster-popup.js`, `js/search-filter.js`, `js/supabase-api.js`,
`js/table.js`, `js/telegram.js`, `js/utils.js`, `js/index.html`.
Semua ini gak berpengaruh ke runtime (cuma `js/app.js` yang aktif). Keberadaannya rawan
bug "saya already benerin di security.js tapi app.js gak kebaca".

## Prioritas perbaikan
1. #1 + #2 (fatal) — app gak jalan sama sekali tanpa ini.
2. #3 (CS login) — fitur CS mati.
3. #4 + #5 (XSS) — inject JS via nama/poster.
4. #6 (RLS) — kebocoran data & password.
5. #7 (orphan) — pembersihan.
