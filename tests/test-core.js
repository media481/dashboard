#!/usr/bin/env node
// ============================================================
// TEST CORE — Dashboard Amiru
// Runner minimal TANPA dependency (hanya node:assert) untuk
// mencegah regresi pada fungsi-fungsi kritis (terbilang, estimasi,
// parsing rupiah, escaping XSS, FIFO snapshot).
//
// Cara jalanin lokal:  node tests/test-core.js
// Atau via npm:        npm test
// CI: dijalankan otomatis oleh .github/workflows/ci-tests.yml
//
// app.js tidak dirancang untuk di-import (pakai document/window global
// di level atas), jadi kita load lewat vm dengan context mock DOM
// yang cukup agar file tidak crash saat di-parse/dievaluasi.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const APP_PATH = path.resolve(__dirname, '..', 'js', 'app.js');

// ---- Mock DOM/window minimal supaya app.js bisa di-eval di Node ----
function makeEl() {
  // Mock element dengan simulasi escaping textContent -> innerHTML (seperti browser)
  // supaya escapeHtml() bisa diuji secara valid di Node tanpa jsdom.
  let _text = '';
  const el = {
    style: {}, classList: { add(){}, remove(){}, contains(){return false;} },
    addEventListener(){}, removeEventListener(){}, appendChild(){},
    setAttribute(){}, getAttribute(){return null;}, querySelector(){return null;},
    querySelectorAll(){return [];}, focus(){}, click(){}, value: '',
    set textContent(v){ _text = String(v); },
    get textContent(){ return _text; },
    set innerHTML(v){ _text = String(v); },
    get innerHTML(){ return String(_text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
  };
  return el;
}
const sandbox = {
  console,
  window: {
    supabase: { createClient: () => ({ from: () => ({ select: () => ({}) }), rpc: () => ({}) }) },
    addEventListener(){}, removeEventListener(){},
    location: { hostname: 'localhost', href: 'http://localhost/' },
    sessionStorage: { getItem(){return null;}, setItem(){}, removeItem(){} },
    localStorage: { getItem(){return null;}, setItem(){}, removeItem(){} },
    matchMedia: () => ({ matches: false, addListener(){}, removeListener(){} }),
    enhanceSearchableSelect: () => {},
  },
  document: {
    addEventListener(){}, removeEventListener(){},
    getElementById: () => makeEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => makeEl(),
    documentElement: makeEl(),
    body: makeEl(),
  },
  navigator: { userAgent: 'node-test' },
  location: { hostname: 'localhost', href: 'http://localhost/' },
  localStorage: { getItem(){return null;}, setItem(){}, removeItem(){} },
  sessionStorage: { getItem(){return null;}, setItem(){}, removeItem(){} },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, RegExp, Error,
  MutationObserver: class { observe(){} disconnect(){} },
  alert: () => {},
};
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;

// Evaluasi app.js di sandbox, ekspos fungsi via module.exports tiruan
const code = fs.readFileSync(APP_PATH, 'utf8');
const context = vm.createContext(sandbox);
// Tambahkan penangkap: deklarasikan fungsi sebagai property di sandbox
// dengan meng-append kode yang menaruh fungsi ke globalThis
const wrapped = code + '\n;globalThis.__T = { hitungEstimasi, rupiahTerbilang, parseRupiahToNumber, escapeHtml, escapeJsAttr, takeSnapshot, MAX_SNAPSHOTS, getHargaKamarJamaah, igIsSimilarText, igIsDuplicateIdea, igRiwayatAdd, igBuildSlotBulan, igPickEvenly, igBuildPolaMingguan, igBuildSlotPekan, igDaftarPekanBulan, igMinusTokens, IG_POLA_AMIRU, IG_PILLARS };';
vm.runInContext(wrapped, context, { filename: 'app.js' });
const T = sandbox.__T;

if (!T || !T.hitungEstimasi) {
  console.error('GAGAL: fungsi inti tidak ter-expose dari app.js');
  process.exit(1);
}

// ============================================================
// TEST CASES
// ============================================================
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('\n=== TEST: rupiahTerbilang (nominal terbilang) ===');
test('1 -> Satu Rupiah', () => assert.strictEqual(T.rupiahTerbilang(1), 'Satu Rupiah'));
test('100 -> Seratus Rupiah', () => assert.strictEqual(T.rupiahTerbilang(100), 'Seratus Rupiah'));
test('1000 -> Seribu Rupiah', () => assert.strictEqual(T.rupiahTerbilang(1000), 'Seribu Rupiah'));
test('1000000 -> Satu Juta Rupiah', () => assert.strictEqual(T.rupiahTerbilang(1000000), 'Satu Juta Rupiah'));
test('1001000 -> Satu Juta Seribu Rupiah', () => assert.strictEqual(T.rupiahTerbilang(1001000), 'Satu Juta Seribu Rupiah'));
test('1234567 -> format baku', () => assert.strictEqual(T.rupiahTerbilang(1234567), 'Satu Juta Dua Ratus Tiga Puluh Empat Ribu Lima Ratus Enam Puluh Tujuh Rupiah'));
test('0 -> Nol Rupiah', () => assert.strictEqual(T.rupiahTerbilang(0), 'Nol Rupiah'));
test('desimal -> dibulatkan', () => assert.strictEqual(T.rupiahTerbilang(1500.9), 'Seribu Lima Ratus Rupiah'));

console.log('\n=== TEST: parseRupiahToNumber (tahan format) ===');
test('"1000000" -> 1000000', () => assert.strictEqual(T.parseRupiahToNumber('1000000'), 1000000));
test('"1.000.000" -> 1000000', () => assert.strictEqual(T.parseRupiahToNumber('1.000.000'), 1000000));
test('"Rp 1.500.000" -> 1500000', () => assert.strictEqual(T.parseRupiahToNumber('Rp 1.500.000'), 1500000));
test('null -> 0', () => assert.strictEqual(T.parseRupiahToNumber(null), 0));
test('undefined -> 0', () => assert.strictEqual(T.parseRupiahToNumber(undefined), 0));
test('"" -> 0', () => assert.strictEqual(T.parseRupiahToNumber(''), 0));

console.log('\n=== TEST: hitungEstimasi (kolom Estimasi) ===');
const now = new Date('2026-08-07T12:00:00');
test('hari ini', () => assert.strictEqual(T.hitungEstimasi(new Date('2026-08-07T12:00:00'), now), 'hari ini'));
test('1hr lagi', () => assert.strictEqual(T.hitungEstimasi(new Date('2026-08-08T12:00:00'), now), '1hr lagi'));
test('1bln 3hr lagi', () => assert.strictEqual(T.hitungEstimasi(new Date('2026-09-10T12:00:00'), now), '1bln 3hr lagi'));
test('sudah berangkat (lewat)', () => assert.ok(/sudah berangkat/i.test(T.hitungEstimasi(new Date('2026-08-01T12:00:00'), now))));
test('2th 1bln lagi', () => assert.strictEqual(T.hitungEstimasi(new Date('2028-09-07T12:00:00'), now), '2th 1bln lagi'));

console.log('\n=== TEST: escapeHtml / escapeJsAttr (XSS) ===');
test('escape <script>', () => assert.strictEqual(T.escapeHtml('<script>'), '&lt;script&gt;'));
test('escape quote di attr (aman dari break-out)', () => {
  const out = T.escapeJsAttr(`'onclick=alert(1)`);
  // ' harusnya jadi \' (escaped) sehingga tidak bisa keluar dari atribut onclick="..."
  assert.ok(out.includes("\\'"), 'single quote harus di-escape jadi \\\\');
});

console.log('\n=== TEST: konstanta & wiring kritis ===');
test('MAX_SNAPSHOTS = 10', () => assert.strictEqual(T.MAX_SNAPSHOTS, 10));
test('takeSnapshot terdefinisi', () => assert.strictEqual(typeof T.takeSnapshot, 'function'));

console.log('\n=== TEST: getHargaKamarJamaah (harga per tipe kamar) ===');
const progFull = { harga_quad: 'Rp 32.500.000', harga_triple: 'Rp 37.500.000', harga_double: 'Rp 42.000.000' };
test('quad -> harga_quad', () => assert.strictEqual(T.getHargaKamarJamaah(progFull, { tipe_kamar: 'quad' }), 32500000));
test('triple -> harga_triple', () => assert.strictEqual(T.getHargaKamarJamaah(progFull, { tipe_kamar: 'triple' }), 37500000));
test('double -> harga_double', () => assert.strictEqual(T.getHargaKamarJamaah(progFull, { tipe_kamar: 'double' }), 42000000));
test('tipe_kamar kosong/tidak dikenal -> fallback quad', () => assert.strictEqual(T.getHargaKamarJamaah(progFull, {}), 32500000));
test('jamaah null -> tetap fallback quad dari program', () => assert.strictEqual(T.getHargaKamarJamaah(progFull, null), 32500000));
test('program null, jamaah null -> 0', () => assert.strictEqual(T.getHargaKamarJamaah(null, null), 0));
test('data lama: harga_quad kosong -> fallback harga_quint', () => {
  const prog = { harga_quint: 'Rp 30.000.000' };
  assert.strictEqual(T.getHargaKamarJamaah(prog, { tipe_kamar: 'quad' }), 30000000);
});
test('triple diminta tapi harga_triple belum diisi -> fallback ke quad', () => {
  const prog = { harga_quad: 'Rp 32.500.000' };
  assert.strictEqual(T.getHargaKamarJamaah(prog, { tipe_kamar: 'triple' }), 32500000);
});
test('harga_custom diisi -> override, abaikan tipe_kamar & harga program', () => {
  assert.strictEqual(T.getHargaKamarJamaah(progFull, { tipe_kamar: 'double', harga_custom: 'Rp 25.000.000' }), 25000000);
});
test('harga_custom diisi tapi program null -> tetap pakai harga_custom', () => {
  assert.strictEqual(T.getHargaKamarJamaah(null, { harga_custom: 'Rp 25.000.000' }), 25000000);
});
test('harga_custom kosong string -> tidak override, tetap pakai tipe_kamar', () => {
  assert.strictEqual(T.getHargaKamarJamaah(progFull, { tipe_kamar: 'triple', harga_custom: '' }), 37500000);
});


console.log('\n=== TEST: Content Planner — anti-duplikat & slot bulan ===');
const mkRiwayat = (...temas) => { const r = []; temas.forEach(t => T.igRiwayatAdd(r, t, '', '')); return r; };
test('tema sama persis -> duplikat', () => assert.ok(T.igIsSimilarText('Pertama kali lihat Ka\'bah', 'Pertama kali lihat Ka\'bah')));
test('tema beda kata tapi topik sama -> duplikat', () => assert.ok(T.igIsSimilarText('Bawaan yang sering ketinggalan', 'Bawaan wanita yang sering ketinggalan')));
test('topik beda -> bukan duplikat', () => assert.ok(!T.igIsSimilarText('Doa di Raudhah', 'Doa di Multazam')));
test('1 kata inti hanya duplikat kalau persis sama', () => {
  assert.ok(!T.igIsSimilarText('Niat umroh', 'Niat umroh bersama orang tua'));
  assert.ok(T.igIsSimilarText('Niat umroh', 'Niat Umrah'));
});
test('kata umum bisnis (umroh/jamaah) diabaikan', () => assert.ok(!T.igIsSimilarText('Tips umroh jamaah lansia', 'Tips umroh jamaah pertama kali')));
test('igIsDuplicateIdea: cocok dengan riwayat lintas bulan', () => {
  const r = mkRiwayat('Sa\'i: Safa dan Marwah', 'Kesalahan umum saat umroh');
  assert.ok(T.igIsDuplicateIdea({ tema: 'Makna Sa\'i di Safa Marwah', teks_gambar: '' }, r));
  assert.ok(!T.igIsDuplicateIdea({ tema: 'Tidur nyenyak di Madinah', teks_gambar: '' }, r));
});
test('igIsDuplicateIdea: teks gambar (hook) yang sama dianggap duplikat walau tema beda', () => {
  const r = []; T.igRiwayatAdd(r, 'Tema A', 'Tujuh kali bolak-balik.\nBukan untuk sampai.', '');
  assert.ok(T.igIsDuplicateIdea({ tema: 'Judul lain sama sekali', teks_gambar: 'Tujuh kali bolak-balik.\nLain lagi' }, r));
});
test('igBuildSlotBulan: Okt 2026 -> 7 hari penuh (31 slot), urut & valid', () => {
  const slots = T.igBuildSlotBulan(2026, 9, new Set(), null);
  assert.strictEqual(slots.length, 31);
  assert.strictEqual(slots[0].tanggal, '2026-10-01');
  assert.deepStrictEqual(slots.map(s => s.tanggal), slots.map(s => s.tanggal).slice().sort());
});
test('igBuildSlotBulan: lewati tanggal terisi & tanggal lampau', () => {
  const slots = T.igBuildSlotBulan(2026, 9, new Set(['2026-10-09']), '2026-10-08');
  assert.ok(slots.every(s => s.tanggal >= '2026-10-08' && s.tanggal !== '2026-10-09'));
});
test('igPickEvenly: n slot tersebar tanpa duplikat', () => {
  const arr = T.igBuildSlotBulan(2026, 9, new Set(), null).slice(0, 17);
  const pick = T.igPickEvenly(arr, 5);
  assert.strictEqual(pick.length, 5);
  assert.strictEqual(new Set(pick.map(x => x.tanggal)).size, 5);
  assert.strictEqual(T.igPickEvenly(arr, 99).length, 17);
});

// array dari vm beda realm -> bandingkan lewat JSON
const eqJson = (x, y) => assert.strictEqual(JSON.stringify(x), JSON.stringify(y));
// ---- Pola 7 hari menyambung (pola-konten.md bagian 3) ----
test('IG_POLA_AMIRU: 7 hari sesuai pola (pilar, tipe, peran, urutan 1-7)', () => {
  const P = T.IG_POLA_AMIRU;
  const urut = [1, 2, 3, 4, 5, 6, 0].map(d => `${P[d].hari}:${P[d].peran}:${P[d].pilar}:${P[d].tipe}`);
  eqJson(urut, [
    'Senin:Rasakan:storytelling:image', 'Selasa:Pahami:manasik:image', 'Rabu:Siapkan:edukasi:carousel',
    'Kamis:Bayangkan:storytelling:carousel', 'Jumat:Hindari:edukasi:carousel',
    'Sabtu:Terinspirasi:storytelling:carousel', 'Minggu:Renungkan:kontemplasi:carousel'
  ]);
  eqJson([1, 2, 3, 4, 5, 6, 0].map(d => P[d].urutan), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(T.IG_PILLARS.kontemplasi);
});
test('IG_POLA_AMIRU: tanpa video & kerangka carousel maksimal 5 slide', () => {
  Object.values(T.IG_POLA_AMIRU).forEach(p => {
    assert.ok(p.tipe === 'image' || p.tipe === 'carousel');
    if (p.tipe === 'carousel') {
      const n = (p.kosong.teks.match(/Slide\s*\d+/g) || []).length;
      assert.ok(n >= 1 && n <= 5, `${p.hari}: ${n} slide`);
      assert.ok(!/Slide\s*\d+\s*-\s*\d+/.test(p.kosong.teks), `${p.hari}: tanpa rentang slide`);
    }
    assert.ok(!/\\n/.test(p.kosong.teks), `${p.hari}: tidak ada \\n literal`);
  });
});
test('igBuildSlotPekan: Senin 12 Okt 2026 -> 7 slot Senin..Minggu berurutan', () => {
  const s = T.igBuildSlotPekan('2026-10-12', new Set(), null);
  eqJson(s.map(x => x.tanggal), ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  eqJson(s.map(x => x.hari), ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']);
  eqJson(s.map(x => x.urutan), [1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(s.filter(x => x.tipe_konten === 'carousel').length, 5);
});
test('igBuildSlotPekan: melintasi pergantian bulan, lewati terisi & lampau', () => {
  const s = T.igBuildSlotPekan('2026-10-26', new Set(['2026-10-28']), '2026-10-27');
  eqJson(s.map(x => x.tanggal), ['2026-10-27', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
});
test('igDaftarPekanBulan: Okt 2026 -> pekan Senin-Minggu yang menyentuh bulan itu', () => {
  const d = T.igDaftarPekanBulan(2026, 9);
  assert.strictEqual(d[0].senin, '2026-09-28'); // 1 Okt 2026 = Kamis
  assert.strictEqual(d[d.length - 1].senin, '2026-10-26');
  assert.ok(d.every(x => new Date(x.senin + 'T00:00:00').getDay() === 1));
  assert.ok(d.some(x => x.senin === '2026-10-12' && x.minggu === '2026-10-18'));
});
test('igIsDuplicateIdea: kata tema minggu diabaikan, ide sepekan tidak saling kembar', () => {
  const r = []; T.igRiwayatAdd(r, 'Talbiyah di miqat', 'Slide 1: Talbiyah pertama di miqat', '');
  const item = { tema: 'Talbiyah di miqat', teks_gambar: '' };
  assert.ok(T.igIsDuplicateIdea(item, r)); // tanpa abaikan: kembar
  const abaikan = new Set(['talbiyah']);
  assert.ok(T.igIsDuplicateIdea(item, r, abaikan)); // sisa "miqat" sama persis -> tetap duplikat
  assert.ok(!T.igIsDuplicateIdea({ tema: 'Talbiyah menghafal 2 minggu', teks_gambar: '' }, r, abaikan));
});
test('igBuildPolaMingguan: semua slot berupa kerangka kosong (tanpa draf bawaan)', () => {
  const r = T.igBuildPolaMingguan(2026, 9, new Set(), null);
  assert.ok(r.rows.length > 0);
  assert.ok(r.rows.every(x => !x._berisi && x.draft_caption === '' && x.tahap === 'ide'));
  assert.ok(r.rows.every(x => x.pilar && x.tipe_konten));
});

// ============================================================
console.log(`\n=== HASIL: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
