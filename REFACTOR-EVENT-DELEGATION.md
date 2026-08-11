# Refactor: Event Delegation (hapus onclick inline)

Dokumen progres untuk refactor yang dipecah 2 tahap supaya bisa dilanjut
di sesi Claude lain. **Baca ini duluan** sebelum lanjut kerja di refactor
ini.

## Kenapa

Hampir semua fungsi `render*()` menghasilkan HTML lewat template string
dengan `onclick="fn('${x}')"` inline tertanam di dalamnya. Masalahnya:

1. **Rawan bug escaping** — kalau `x` (nama anggota, keterangan transaksi,
   dll) mengandung tanda kutip (`'` atau `"`), HTML yang dihasilkan rusak
   (attribute jadi terpotong, kadang bikin tombol lain ikut rusak).
2. **event.stopPropagation() manual** dipakai berulang di banyak tempat
   cuma untuk mencegah onclick di elemen anak "menabrak" onclick di elemen
   induk (mis. tombol hapus di dalam baris tabel yang seluruh barisnya
   bisa diklik).
3. Kalau nanti CSP situs ini diperketat ke `script-src` tanpa
   `'unsafe-inline'`, semua onclick inline otomatis berhenti berfungsi.

## Pola baru

**Infrastruktur inti** ada di `js/16b-event-delegation.js` (modul baru,
sudah didaftarkan di `build.js` `MODULE_ORDER` & komentar `index.html`,
posisinya tepat setelah `16-ui-helpers.js`):

- `da(fnName, ...args)` — helper, dipanggil sebagai **ekspresi JS** di
  dalam template string (bukan string biasa), hasilnya string atribut
  `data-action="fn" data-args='[...]'` siap disisip ke tag HTML.
- Satu listener `click` di `document.body`, pakai
  `e.target.closest('[data-action]')` lalu panggil `window[fnName](...args)`.

**Cara migrasi tiap onclick:**

```js
// SEBELUM
<button onclick="hapusUser('${u.id}')">Hapus</button>

// SESUDAH
<button ${da('hapusUser', u.id)}>Hapus</button>
```

Argumen dikirim sebagai **nilai JS asli** (bukan di-quote manual jadi
string di dalam attribute), jadi tidak ada lagi masalah escaping kutip.

**`event.stopPropagation()` yang lama boleh DIHAPUS** saat migrasi kalau
tujuannya cuma mencegah onclick induk ikut kepicu — karena
`closest('[data-action]')` cuma cari **satu** elemen `data-action`
terdekat dari titik klik, jadi otomatis tidak pernah "tembus" ke induk
yang juga punya `data-action`. (Sudah diverifikasi aman untuk semua kasus
yang dimigrasi di Tahap 1 — lihat bagian "Catatan perilaku" di bawah.)

### Kasus yang SENGAJA dikecualikan (jangan dimigrasi)

- `onclick="location.reload()"` (`19-init.js`) — panggilan browser native,
  tanpa argumen dinamis, tanpa fungsi app. Tidak ada manfaat migrasi.
- `onclick="window.print()"` (`13-lpj.js`, 2x) — sama, native call.
- `onclick="event.stopPropagation();"` **tanpa** pemanggilan fungsi app
  (`07-dashboard.js` baris ~17, div pembungkus di dalam kartu buku yang
  bisa diklik) — tidak ada fungsi untuk didelegasikan lewat `data-action`.
  Dibiarkan sebagai native onclick; ini masih aman karena
  `stopPropagation()` di fase bubble akan menghentikan event SEBELUM
  sampai ke listener `document.body`, jadi behavior lama (klik di dalam
  area ini tidak men-toggle kartu) tetap terjaga.

### ⚠️ Ketergantungan tersembunyi: `25-tour.js` pakai selector `[onclick="..."]`

**Ditemukan saat mengerjakan Tahap 2A** (belum terdokumentasi sebelumnya,
jadi Tahap 1 SELESAI dengan bug ini tanpa disadari):

`js/25-tour.js` **tidak punya onclick handler sungguhan**. Semua
`onclick=` yang muncul di file itu adalah string **CSS attribute
selector** (`{sel:'[onclick="openXModal()"]', ...}`) yang dipakai fitur
tur untuk `document.querySelector()` mencari elemen target langkah tur —
menunjuk ke tombol yang didefinisikan di file LAIN.

Begitu tombol target dimigrasi ke `da()` di file aslinya, atributnya
berubah dari `onclick="fn()"` jadi `data-action="fn"` — selector lama di
`tour.js` otomatis tidak match lagi, jadi **langkah tur itu senyap gagal
tampil** (fungsinya sendiri tetap normal, cuma highlight tur-nya hilang).

**Akibatnya**: 18 selector di `tour.js` untuk fungsi yang sudah
dimigrasi di Tahap 1 (`openDonaturModal`, `openTransaksiModal`,
`openOperasionalModal`, `openUserModal`, `openGudangPinjamModal`,
`openBookmarkModal`, `toggleBukuCard`, `openGudangStokModal`, dst) sudah
**patah sejak Tahap 1 selesai** — baru diperbaiki di sesi Tahap 2A ini
(lihat tabel di bawah).

**Aturan untuk sesi berikutnya**: setiap kali memigrasi `onclick="fn(...)"`
jadi `${da('fn', ...)}` di file manapun, WAJIB cek juga
`grep -n "onclick.*fn" js/25-tour.js` — kalau ada selector yang
menunjuk fungsi itu, update juga:
- exact match: `[onclick="fn()"]` → `[data-action="fn"]`
- prefix match: `[onclick^="fn"]` → `[data-action="fn"]` (prefix `^=`
  dulu dipakai karena `onclick` lama menyisipkan argumen setelah nama
  fungsi, mis. `onclick="fn('x')"` — dengan `data-action` nilainya SELALU
  persis nama fungsi tanpa argumen, jadi cukup `=` biasa, tidak perlu `^=`
  lagi).
- `onclick="window.print()"` (2x, untuk LPJ & Daftar Anggota) TETAP
  dibiarkan apa adanya — fungsinya memang tidak pernah dimigrasi
  (native call, lihat bagian dikecualikan di atas).

## Progres

### ✅ Tahap 1 — SELESAI

Infrastruktur (`js/16b-event-delegation.js`) + 12 modul, 55 handler:

| File | Handler dimigrasi | Catatan |
|---|---|---|
| `24-bookmark.js` | 3 | — |
| `15b-snapshot.js` | 3 | — |
| `17a-gudang-core.js` | 1 | — |
| `10b-database-lomba.js` | 4 | 2x `event.stopPropagation()` dihapus (pill versi & tombol hapus arsip, sebelumnya tidak benar-benar perlu karena beda subtree dgn card-head) |
| `07-dashboard.js` | 4 | 1 onclick native (`stopPropagation` murni) dibiarkan, lihat di atas |
| `05-navigation.js` | 6 | — |
| `06-login-users.js` | 7 | — |
| `17c-gudang-histori-kelola.js` | 6 | — |
| `17b-gudang-pinjam.js` | 7 | termasuk 1 kasus atribut kondisional (`disabled` vs `da(...)`) |
| `09-donatur-transaksi-operasional.js` | 10 | 3x `event.stopPropagation()` dihapus (tombol hapus di baris yang bisa diklik) |
| `19-init.js` | 0 dimigrasi | 1 dikecualikan (native) |
| `13-lpj.js` | 0 dimigrasi | 2 dikecualikan (native) |

Build (`npm run build`) sudah dijalankan & sukses — bundle valid, tidak
ada bentrok nama fungsi/variabel antar modul.

**Belum ditest manual di browser** — perlu buka tiap halaman yang
disentuh (Dashboard, Login/User, Bookmark, Snapshot, Gudang Aset,
Gudang Pinjam, Database Lomba, Donatur/Transaksi/Operasional) dan klik
tiap tombol yang dimigrasi untuk memastikan perilakunya sama seperti
sebelum refactor.

### ✅ Tahap 2A — SELESAI

4 modul "aman" (tidak punya `document.addEventListener('click', ...)`
sendiri), 91 handler:

| File | Handler dimigrasi | Catatan |
|---|---|---|
| `08-anggota.js` | 23 | — |
| `12-jadwal-agenda-kas.js` | 15 | 2 baris (`editAction`/`hapusAction`) tadinya string onclick dirakit kondisional (`lombaLink ? ... : ...`) — sekarang dirakit pakai `da(...)` langsung jadi 2 variabel `editAction`/`hapusAction` berisi atribut `data-action` siap pakai |
| `15-pengaturan-event.js` | 26 | — |
| `11-belanja.js` | 27 | Lihat catatan khusus di bawah |

Catatan khusus `11-belanja.js`:
- 8x `event.stopPropagation()` dihapus (checkbox-wrapper & tombol aksi di
  dalam kartu `.belanja-item`/`.belanja-subitem` — kartu itu sendiri
  TIDAK punya onclick/data-action di elemen pembungkusnya, jadi
  stopPropagation sebelumnya tidak benar-benar diperlukan untuk mencegah
  tembus ke induk).
- Baris `onclick="hapusKataKunciKategoriToko('${esc(kw.replace(/\\/g,'\\\\').replace(/'/g,"\\'"))}')"`
  — ini **contoh nyata bug escaping** yang jadi alasan refactor ini ada
  (manual-escape tanda kutip di dalam attribute). Sekarang jadi
  `${da('hapusKataKunciKategoriToko', kw)}`, tidak perlu escape manual
  sama sekali karena `da()` pakai `JSON.stringify`.
- 2 blok onclick multi-statement (baca `.value` dari input DOM lalu
  panggil fungsi tambah kategori/kata-kunci) dipecah jadi 2 fungsi baru
  di file yang sama: `tambahKategoriTokoKustomDariInput()` dan
  `tambahKataKunciKategoriTokoDariInput()` — supaya bisa dipanggil lewat
  `da('...')` tanpa argumen (nilainya tetap dibaca dari DOM saat fungsi
  jalan, bukan saat render).

`npm run build` sukses setelah Tahap 2A, tidak ada bentrok nama
fungsi/variabel. `node --check` lolos untuk semua file yang diedit.

Perbaikan tambahan (bug Tahap 1 yang baru ketahuan — lihat bagian
"Ketergantungan tersembunyi: `25-tour.js`" di atas): 18 selector
`[onclick="fn()"]` / `[onclick^="fn"]` di `js/25-tour.js` untuk fungsi
yang SUDAH dimigrasi (Tahap 1 maupun Tahap 2A) diganti ke
`[data-action="fn"]`. Daftar fungsi yang selectornya sudah diperbaiki:
`openJadwalModal`, `openAnggotaModal`, `openDonaturModal`,
`openTransaksiModal`, `openOperasionalModal`, `openHadiahJalanModal`,
`tandaiSemuaBelanjaPerlengkapan`, `bukaModalKelolaKategoriToko`,
`tandaiSemuaBelanjaHadiah`, `tandaiSemuaBelanjaJalan`, `openEventModal`,
`openUserModal`, `openAgendaModal`, `openGudangPinjamModal`,
`openKasModal`, `openBookmarkModal`, `toggleBukuCard`,
`openGudangStokModal`.

`25-tour.js` sendiri **tidak dihitung** sebagai modul dengan handler
untuk dimigrasi — semua `onclick=` di dalamnya adalah selector, bukan
handler (lihat bagian ketergantungan di atas), jadi tidak masuk hitungan
"55 handler Tahap 1" / "91 handler Tahap 2A".

**Belum ditest manual di browser** — perlu buka Database Anggota, Daftar
Iuran Anggota (halaman event aktif), Jadwal, Agenda, Kas, Pengaturan
Event (profil org, tarif, kupon, Telegram, event, guest menu, tema,
fitur), User, Belanja Hadiah, Belanja Perlengkapan, Belanja Jalan Santai,
Hadiah Jalan Santai, Kelola Kategori Toko, dan tur (`?tour` / tombol tur)
untuk tiap halaman yang disentuh Tahap 2A — pastikan perilaku sama
seperti sebelum refactor.

### ✅ Tahap 2B-1 — SELESAI

2 dari 3 modul "berisiko" (punya `document.addEventListener('click', ...)`
sendiri untuk menutup combo/dropdown floating panel), 29 handler. Untuk
KEDUA file ini ternyata **tidak ada `event.stopPropagation()` sama sekali**
(dicek dengan `grep -n "onclick=\|stopPropagation"` sebelum migrasi) — jadi
walau masing-masing punya listener click sendiri, tidak ada apa pun yang
perlu dihapus/diverifikasi soal stopPropagation, aman seperti pola Tahap
1/2A biasa. Listener click masing-masing sudah menutup combo lewat
`closest('.combo-panel-floating')`/`closest('.<trigger-class>')`, bukan
lewat stopPropagation, jadi tidak konflik dengan listener `data-action` di
`document.body`.

| File | Handler dimigrasi | Catatan |
|---|---|---|
| `22-dana-sosial.js` | 13 | 1 kasus atribut kondisional (`disabled` vs `da(...)`). 1 onclick multi-statement (`closeModal(); goSection('anggota'); return false;` di link "Database Anggota" pada modal Edit Anggota) dipecah jadi fungsi baru `tutupModalDanGotoAnggota()` di file yang sama |
| `14-dokumen.js` | 16 | Pola `encodeURIComponent`/`decodeURIComponent` yang tadinya dipakai di combo nama (`selectBlkComboNama`) buat hindari masalah quote-escaping di dalam attribute onclick — dihapus, tidak perlu lagi karena `da()` pakai `JSON.stringify`. Ada `document.addEventListener('click', ...)` sendiri (baris ~973, combo nama Jadwal Sinoman/Petugas) — tidak ada stopPropagation utk dihapus |

**Perubahan infrastruktur (`js/16b-event-delegation.js`)**: ditambah
`if (el.tagName === 'A') e.preventDefault();` di listener click utama.
Dibutuhkan karena 2 link `<a href="#" onclick="...; return false;">` di
`22-dana-sosial.js` (link "Database Anggota" di 2 tempat) mengandalkan
`return false` dari onclick lama supaya tidak lompat ke atas halaman —
`da()` tidak punya mekanisme itu, jadi `preventDefault()` di listener
delegasi jadi penggantinya. Aman juga dipasang untuk semua `<a>`
ber-`data-action` lain (tidak ada saat ini) dan tidak berpengaruh ke
`<button>` (button memang tidak punya default action untuk di-preventDefault).

`npm run build` sukses setelah Tahap 2B-1 (bundle 480732 bytes), tidak ada
bentrok nama fungsi/variabel. `node --check` lolos untuk semua file yang
diedit (`22-dana-sosial.js`, `14-dokumen.js`, `16b-event-delegation.js`,
`25-tour.js`).

Selector tour.js yang diperbaiki di Tahap 2B-1: `openDanaSosialAnggotaModal`,
`openImporDanaSosialModal` (dari `22-dana-sosial.js`), `jadwalAddExtraTable`
(dari `14-dokumen.js`). Sudah dicek dengan
`grep -n "onclick.*<fn>" js/25-tour.js` untuk SEMUA fungsi yang dimigrasi
di Tahap 2B-1, bukan cuma 3 ini — fungsi lain (`toggleDsTahunCombo`,
`selectDsTahun`, `toggleDanaSosialBayar`, `setDanaSosialTab`,
`toggleAktifDanaSosialAnggota`, `hapusDanaSosialAnggota`, `gotoDokumenTab`,
`resetFilterAbsensi`, `jadwalExportImage`, `jadwalBlockRemoveRow`,
`jadwalRemoveExtraTable`, `jadwalRemoveBuiltinBlock`, `jadwalBlockAddRow`,
`toggleBlkCombo`, `selectBlkComboNama`) memang tidak punya selector di
tour.js, tidak perlu diapa-apakan.

**Belum ditest manual di browser** — perlu buka halaman Dana Sosial
(tab Daftar Bayar/Rekap/Kelola Anggota, termasuk combo pilih tahun &
modal edit anggota) dan Dokumen (tab Surat Undangan/Proposal/Absensi,
lembar Jadwal Sinoman termasuk combo pilih nama & tombol tambah/hapus
tabel/baris) serta tur (`?tour`) untuk kedua halaman ini — pastikan
perilaku sama seperti sebelum refactor.

### ✅ Tahap 2B-2a — SELESAI

`10-lomba.js` dipecah jadi 2 sub-tahap karena satu-satunya modul tersisa
(26 handler, 2 combo terpisah) — terlalu besar untuk 1 sesi. Sub-tahap
2A: bagian "Kartu Lomba" (card head, tab, kebutuhan barang) + combo
Koordinator, 15 handler:

| File (bagian) | Handler dimigrasi | Catatan |
|---|---|---|
| `10-lomba.js` (kartu lomba + koordinator) | 15 | 2x `event.stopPropagation()` dihapus (tombol edit/hapus lomba di dalam `.lomba-card-head` yang bisa diklik untuk toggle buka/tutup kartu — pola sama seperti Tahap 1/2A, aman karena `closest('[data-action]')` cuma cari elemen terdekat). 3x atribut kondisional (`disabled` vs `da(...)`, mengikuti pola `${cond?'disabled':da(...)}` yang sudah dipakai di `17b-gudang-pinjam.js`/`22-dana-sosial.js`) |

**Dicek dulu** (`grep -n "onclick=\|stopPropagation" js/10-lomba.js`
sebelum migrasi mulai): file ini punya 2
`document.addEventListener('click', ...)` sendiri (baris ~322 untuk
nutup combo Koordinator, ~449 untuk nutup combo Nama Lomba) tapi
**keduanya cuma cek `e.target.closest(...)` terhadap class/id combo**,
BUKAN `stopPropagation()` — jadi tidak ada konflik dengan listener
`data-action` di `document.body`, sama seperti pola `22-dana-sosial.js`/
`14-dokumen.js` di Tahap 2B-1. 2 `stopPropagation()` yang memang ada
(tombol edit/hapus di kepala kartu lomba) sudah dicek aman & dihapus
seperti tercatat di atas.

`node --check` lolos untuk `js/10-lomba.js` dan `js/25-tour.js`.
**`npm run build` BELUM bisa dijalankan sesi ini** — `node_modules`
tidak ada dan tidak ada akses network untuk `npm install` (environment
sandbox tanpa internet). Tidak ada fungsi baru yang ditambahkan di
sub-tahap ini (murni ganti atribut `onclick=` → `${da(...)}`, tidak ada
split onclick multi-statement jadi fungsi baru), jadi risiko bentrok
nama fungsi/variabel sangat rendah — **tetap WAJIB jalankan
`npm run build` di sesi berikutnya (atau sesi dengan akses network)
untuk verifikasi sebelum lanjut/deploy**.

Selector tour.js yang diperbaiki di Tahap 2B-2a: `openLombaModal` (exact,
dari `[onclick="openLombaModal()"]`), `openKebutuhanModal` (dari prefix
`[onclick^="..."]` ke exact `[data-action="..."]` — prefix tidak perlu
lagi karena `data-action` selalu persis nama fungsi), `toggleKoordinatorCombo`
+ `pilihKoordinatorCombo` (sama, prefix → exact).

**Belum ditest manual di browser** — perlu buka halaman Lomba (kartu
lomba: toggle buka/tutup, edit/hapus lomba, ganti tab Kebutuhan/Hadiah/
Koordinator, tambah/edit/hapus kebutuhan barang, tambah cepat kebutuhan,
tambah/hapus koordinator via combo) serta tur (`?tour`) untuk halaman
ini — pastikan perilaku sama seperti sebelum refactor. **Test ini
digabung dengan test Tahap 2B-2b** (satu halaman yang sama), jangan test
2 kali terpisah.

### ✅ Tahap 2B-2b — SELESAI

Sub-tahap terakhir dari `10-lomba.js`, bagian "Hadiah" + baris item
hadiah, 13 pemanggilan `onclick=` dimigrasi (fungsi unik: 10):

| File (bagian) | Handler dimigrasi | Catatan |
|---|---|---|
| `10-lomba.js` (hadiah) | 13 (`toggleHadiahGroup`, `openHadiahModal`, `hapusHadiah`, `editHadiahItem`, `hapusHadiahItem`, `tambahItemHadiah`, `turunkanStokHadiahKeKebutuhan`, `openHadiahBudgetModal`, `sesuaikanSemuaKebutuhanHadiah`, `addItemRow`, `removeItemRow` ×2 — baris 1025 & 1183) | 2x `event.stopPropagation()` dihapus (tombol edit/hapus di `.hadiah-group-header` yang bisa diklik untuk toggle buka/tutup — pola sama seperti kepala kartu lomba di 2B-2a, dicek aman: `toggleHadiahGroup` tidak ada sangkut-paut dengan 2 `document.addEventListener('click', ...)` combo koordinator/nama lomba di file yang sama). 2x atribut kondisional (`disabled` vs `da(...)`, `editHadiahItem`/`hapusHadiahItem`). **Kasus khusus `removeItemRow`**: onclick lama mengirim elemen DOM sebagai argumen (`removeItemRow(this.closest('.item-fields-row'))`) — DOM element TIDAK BISA dikirim lewat `data-args` (JSON.stringify akan gagal/rusak). Solusi: fungsi diubah supaya tidak lagi menerima parameter, tapi mengambil elemennya dari `this` (`this.closest('.item-fields-row')`) — ini bekerja karena listener delegasi di `16b-event-delegation.js` memanggil `fn.apply(el, args)`, jadi `this` di dalam fungsi = elemen ber-`data-action` yang diklik. Dipakai di 2 tempat: baris 1025 (render item existing lewat `hadiahItemRowsHtml`) dan baris 1183 (baris baru yang dirakit lewat `row.innerHTML=` di dalam `addItemRow()`) — keduanya sama-sama diganti `${da('removeItemRow')}` tanpa argumen. |

`npm run build` dijalankan (sesi ini punya akses network, `npm install`
sukses lalu dihapus lagi setelah build supaya arsip tetap bersih) —
bundle `js/app.bundle.min.js` 480391 bytes, **sukses, tidak ada bentrok
nama fungsi/variabel antar modul**. `node --check` lolos untuk
`js/10-lomba.js` dan `js/25-tour.js`. Verifikasi akhir: `grep -c
"onclick=" js/app.bundle.min.js` di bundle hasil build baru = 11,
semuanya pengecualian native yang memang tidak pernah dimigrasi
(`window.print()` ×7, `location.reload()` ×1, `event.stopPropagation()`
murni ×1 di `07-dashboard.js`) — **0 onclick tersisa untuk fungsi app**.

Selector tour.js yang diperbaiki di Tahap 2B-2b: `openHadiahBudgetModal`,
`openHadiahModal`, `sesuaikanSemuaKebutuhanHadiah` (exact match, semua
di section `hadiah`). `toggleHadiahGroup`, `editHadiahItem`,
`hapusHadiahItem`, `tambahItemHadiah`, `turunkanStokHadiahKeKebutuhan`,
`hapusHadiah`, `addItemRow`, `removeItemRow` tidak punya selector di
tour.js, tidak perlu diapa-apakan.

**Belum ditest manual di browser** — perlu buka halaman Lomba tab
Hadiah (toggle buka/tutup kartu paket, edit/hapus paket, edit/hapus
item, tambah item cepat, tombol Sesuaikan/Turunkan Stok, Atur Budget,
Tambah Paket beserta form-nya termasuk tombol + Tambah Item / ✕ hapus
baris item) serta tur (`?tour`) untuk section `hadiah` — pastikan
perilaku sama seperti sebelum refactor, dengan perhatian ekstra ke
tombol ✕ hapus baris item (karena perubahan `removeItemRow` dari
berbasis-argumen ke berbasis-`this`).

## ✅ REFACTOR SELESAI (semua tahap 1 + 2A + 2B)

`onclick=` inline sudah 0 di semua `js/*.js` source, kecuali
pengecualian native yang didaftarkan di bagian "Kasus yang SENGAJA
dikecualikan" di atas (`location.reload()`, `window.print()` x2,
`event.stopPropagation()` murni di `07-dashboard.js`). `npm run build`
terakhir sukses tanpa bentrok nama. `js/25-tour.js` sudah dicek ulang,
tidak ada lagi selector `[onclick=...]` tersisa selain 2 untuk
`window.print()`.

**Yang BELUM dikerjakan sebelum lanjut ke penguatan CSP:**
1. Test manual di browser untuk SEMUA halaman yang disentuh sepanjang
   Tahap 1/2A/2B (belum ada satu pun sesi yang sempat test manual —
   lihat catatan "Belum ditest manual di browser" di tiap tahap di
   atas). Ini prasyarat sebelum mempertimbangkan perketat CSP,
   supaya kalau ada regresi kelihatan dulu sebelum onclick inline
   beneran diblokir browser.
2. Setelah test manual lolos, baru pertimbangkan hapus/perketat
   `'unsafe-inline'` di `_headers` (CSP) kalau memang itu tujuan
   akhirnya.

## Cara lanjut di sesi berikutnya

1. `grep -n "onclick=" js/<nama-file>.js` untuk lihat semua yang perlu
   dimigrasi di file itu.
2. Ganti tiap `onclick="fn(args)"` jadi `${da('fn', args)}` mengikuti
   pola di atas.
3. Kalau ada `event.stopPropagation()` dibarengi pemanggilan fungsi: untuk
   Tahap 2B, WAJIB baca dulu isi `document.addEventListener('click', ...)`
   di file yang sama (lihat baris di tabel Tahap 2B) — pastikan
   stopPropagation itu tidak sedang mencegah event sampai ke listener
   tsb (misalnya supaya combo TIDAK otomatis tertutup saat klik tombol
   tertentu di dalamnya). Kalau ternyata memang cuma untuk mencegah
   onclick induk ikut kepicu (pola sama seperti Tahap 1/2A), baru aman
   dihapus.
4. **Cek `js/25-tour.js`**: `grep -n "onclick.*NAMAFUNGSI" js/25-tour.js`
   untuk tiap fungsi yang baru dimigrasi — kalau ada selector yang
   menunjuk ke situ, update ke `[data-action="..."]` (lihat bagian
   "Ketergantungan tersembunyi" di atas untuk detail & daftar yang sudah
   diperbaiki).
5. Setelah satu file selesai, jalankan `npm run build` — kalau ada
   bentrok nama fungsi/variabel antar modul, esbuild bakal gagal dan
   kasih tahu. Jalankan juga `node --check js/<file>.js` untuk tiap file
   yang diedit sebagai sanity-check sintaks cepat.
6. Update tabel progres di atas.
7. Test manual di browser untuk halaman yang disentuh.
8. Setelah SEMUA file (Tahap 1 + 2A + 2B) beres dan `onclick=` inline
   sudah 0 di semua `js/*.js` source (kecuali 2 pengecualian native yang
   didaftarkan di atas — `location.reload()` & `window.print()` x2 — plus
   1 `stopPropagation()` murni di `07-dashboard.js`), baru pertimbangkan
   untuk hapus/perketat `'unsafe-inline'` di CSP (`_headers`) kalau
   memang jadi tujuan akhirnya. Jangan lupa cek ulang `js/25-tour.js`
   sekali lagi di akhir — pastikan tidak ada lagi selector `[onclick=...]`
   tersisa selain 2 untuk `window.print()` yang memang tidak pernah
   dimigrasi.
