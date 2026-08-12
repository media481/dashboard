# Tests — Dashboard Amiru

Test minimal **tanpa dependency** (hanya `node:assert` bawaan Node) untuk mencegah
regresi pada fungsi-fungsi kritis. Tidak pakai framework/build step karena project
ini vanilla JS.

## Cara jalanin lokal

```bash
node tests/test-core.js
# atau
npm test
```

## Apa yang diuji

- `rupiahTerbilang(n)` — nominal terbilang (nota pembayaran). Kasus: 1, 100, 1000,
  1jt, angka dengan nol di tengah, desimal, 0.
- `parseRupiahToNumber(val)` — parsing tahan format `"1.000.000"` / `"Rp 1.500.000"` /
  null / undefined / `""`.
- `hitungEstimasi(date, now)` — kolom Estimasi (hari ini, 1 hari, 1 bln 3 hr, sudah
  berangkat, 2 thn 1 bln).
- `escapeHtml` / `escapeJsAttr` — escaping XSS.
- Konstanta kritis: `MAX_SNAPSHOTS === 10`, `takeSnapshot` terdefinisi.

## Cara kerja

`app.js` tidak dirancang untuk di-`import` (memakai `document`/`window` global di level
atas). `test-core.js` memuat `app.js` lewat `vm` dengan **mock DOM/window minimal** agar
file bisa dievaluasi di Node tanpa crash, lalu mengekspos fungsi-fungsi murni ke
`globalThis.__T` untuk diuji.

## CI

`.github/workflows/ci-tests.yml` menjalankan test + `node --check js/app.js` otomatis
setiap push/PR ke `main`/`master`.

## Menambah test

Tambahkan `test('nama', () => { ... })` di `tests/test-core.js`. Pastikan fungsi yang
diuji sudah diekspos di baris `globalThis.__T = { ... }` (di bagian bawah file test).
