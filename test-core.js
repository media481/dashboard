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

// test-core.js bisa ditaruh di root repo ATAU di folder tests/ -- pakai lokasi js/app.js yang ada.
const APP_PATH = [path.resolve(__dirname, 'js', 'app.js'), path.resolve(__dirname, '..', 'js', 'app.js')]
  .find(p => fs.existsSync(p)) || path.resolve(__dirname, '..', 'js', 'app.js');

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
const wrapped = code + '\n;globalThis.__T = { hitungEstimasi, rupiahTerbilang, parseRupiahToNumber, escapeHtml, escapeJsAttr, takeSnapshot, MAX_SNAPSHOTS, getHargaKamarJamaah, igBangunKonteksRegenHari, igFormatBarisPekan, igRegenerasiHariPlan, igSusunPromptEksternal, igSalinPromptPlan, IG_PLAN_PROMPT_SISTEM, igHijriMonth, igKandidatTemaMinggu, igPetaTemaSetahun, IG_TEMA_ALUR, IG_TEMA_MUSIM };';
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



console.log('\n=== TEST: Salin Prompt untuk AI lain ===');
test('prompt sistem di app.js SAMA PERSIS dengan edge function generate-ig-content-plan', () => {
  const ts = fs.readFileSync(path.resolve(path.dirname(APP_PATH), '..', 'supabase', 'functions', 'generate-ig-content-plan', 'index.ts'), 'utf8');
  const a = ts.indexOf('const CONTENT_PLAN_SYSTEM_PROMPT = `') + 'const CONTENT_PLAN_SYSTEM_PROMPT = `'.length;
  const b = ts.indexOf('`;', a);
  const dariServer = vm.runInNewContext('`' + ts.slice(a, b) + '`');
  assert.strictEqual(T.IG_PLAN_PROMPT_SISTEM, dariServer);
});
const contohPrompt = () => T.igSusunPromptEksternal({
  bulanLabel: 'Oktober 2026', tanggalMulai: '2026-10-12', tanggalAkhir: '2026-10-18', temaMinggu: 'Talbiyah', temaMingguDepan: 'Thawaf',
  slots: [{ tanggal: '2026-10-12', hari: 'Senin', pilar: 'storytelling', tipe_konten: 'image' }, { tanggal: '2026-10-13', hari: 'Selasa', pilar: 'manasik', tipe_konten: 'image' }],
  konteksPekan: 'Rabu 2026-10-14 | Siapkan | Persiapan fisik', arahan: 'fokus promo Desember', konteksProgram: '', riwayatTema: '- Niat umroh\n- Raudhah'
});
test('prompt memuat instruksi sistem, tema, slot, konteks pekan, arahan, dan riwayat', () => {
  const p = contohPrompt();
  assert.ok(p.includes('=== INSTRUKSI SISTEM ===') && p.includes('POLA 7 HARI'));
  assert.ok(p.includes('sebanyak TEPAT 2 ide post'));
  assert.ok(p.includes('TEMA MINGGU: Talbiyah') && p.includes('TEMA PEKAN DEPAN (untuk teaser penutup Minggu): Thawaf'));
  assert.ok(p.includes('- 2026-10-13 (Selasa) | pilar: manasik | tipe_konten: image'));
  assert.ok(p.includes('Rabu 2026-10-14 | Siapkan') && p.includes('fokus promo Desember') && p.includes('- Raudhah'));
  assert.ok(p.trim().endsWith('tidak ada teks lain.'));
});
test('program kosong -> teks "tidak ada data program"; bagian opsional kosong tidak muncul', () => {
  const p = T.igSusunPromptEksternal({ bulanLabel: 'Oktober 2026', tanggalMulai: '2026-10-12', tanggalAkhir: '2026-10-18', temaMinggu: 'Talbiyah', slots: [{ tanggal: '2026-10-12', hari: 'Senin', pilar: 'storytelling', tipe_konten: 'image' }], konteksProgram: '' });
  const permintaan = p.slice(p.indexOf('=== PERMINTAAN ==='));  // prompt sistem sendiri menyebut istilah-istilah ini
  assert.ok(permintaan.includes('(tidak ada data program spesifik untuk periode ini)'));
  assert.ok(!permintaan.includes('TEMA PEKAN DEPAN') && !permintaan.includes('KONTEKS PEKAN') && !permintaan.includes('ARAHAN TAMBAHAN DARI ADMIN') && !permintaan.includes('RIWAYAT TEMA, SUDAH'));
});


console.log('\n=== TEST: Tema Minggu otomatis ===');
const tp = (tanggal, tema) => ({ tanggal, tema_minggu: tema, status: 'idea' });
test('bulan Hijriah: 22 Feb 2027 = Ramadhan (9), 15 Okt 2026 = Jumadil Awal (5)', () => {
  assert.strictEqual(T.igHijriMonth(new Date(2027, 1, 22)), 9);
  assert.strictEqual(T.igHijriMonth(new Date(2026, 9, 15)), 5);
});
test('tanpa riwayat & bukan musim tema: mulai dari awal alur perjalanan', () => {
  const k = T.igKandidatTemaMinggu('2026-10-12', [], 3);
  assert.strictEqual(k[0].tema, T.IG_TEMA_ALUR[0]); assert.ok(/Awal alur/.test(k[0].alasan));
  assert.strictEqual(k.length, 3);
});
test('melanjutkan alur dari tema alur terakhir yang dipakai', () => {
  const k = T.igKandidatTemaMinggu('2026-10-19', [tp('2026-10-12', T.IG_TEMA_ALUR[0])], 1);
  assert.strictEqual(k[0].tema, T.IG_TEMA_ALUR[1]);
});
test('pekan yang sudah punya tema -> tema itu saja (generate sebagian tidak ganti tema)', () => {
  const k = T.igKandidatTemaMinggu('2026-10-12', [tp('2026-10-14', 'Talbiyah')], 5);
  assert.strictEqual(k.length, 1); assert.strictEqual(k[0].tema, 'Talbiyah');
});
test('pekan di bulan Ramadhan: tema musiman didahulukan', () => {
  const k = T.igKandidatTemaMinggu('2027-02-22', [], 4);
  assert.ok(/Ramadhan/.test(k[0].tema), k[0].tema); assert.ok(/Musim Ramadhan/.test(k[0].alasan));
});
test('tema yang sudah dipakai (bahkan di pekan depan) dilewati', () => {
  const k = T.igKandidatTemaMinggu('2026-10-12', [tp('2026-10-26', T.IG_TEMA_ALUR[0])], 1);
  assert.strictEqual(k[0].tema, T.IG_TEMA_ALUR[1]);
});
test('tema lebih dari setahun lalu tidak lagi memblokir (alur melingkar kembali ke tema lama)', () => {
  const A = T.IG_TEMA_ALUR;
  const plans = [tp('2025-05-26', A[0]), tp('2025-06-02', A[A.length - 1])]; // keduanya di luar jendela 365 hari
  assert.strictEqual(T.igKandidatTemaMinggu('2026-10-12', plans, 1)[0].tema, A[0]);
});
test('semua tema alur sudah terpakai -> tetap ada saran (tidak kosong)', () => {
  const semua = T.IG_TEMA_ALUR.map((tema, i) => tp(`2026-${String(1 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + (i % 4) * 7).padStart(2, '0')}`, tema));
  assert.ok(T.igKandidatTemaMinggu('2026-10-12', semua, 1)[0].tema);
});
test('peta 52 pekan: berurutan, tidak ada tema kembar, pekan pertama bisa dikunci pilihan admin', () => {
  const peta = T.igPetaTemaSetahun('2026-10-12', [], 52, 'Talbiyah');
  assert.strictEqual(peta.length, 52);
  assert.strictEqual(peta[0].tema, 'Talbiyah'); assert.strictEqual(peta[0].senin, '2026-10-12'); assert.strictEqual(peta[1].senin, '2026-10-19');
  const unik = new Set(peta.map(r => r.tema.toLowerCase()));
  assert.strictEqual(unik.size, 52);
});
test('peta setahun memuat tema musiman Ramadhan dan musim haji pada pekan yang tepat', () => {
  const peta = T.igPetaTemaSetahun('2026-10-12', [], 52);
  assert.ok(peta.some(r => /Ramadhan/.test(r.tema) && /Musim Ramadhan/.test(r.alasan)));
  assert.ok(peta.some(r => /Musim Dzulhijjah/.test(r.alasan)));
});

// ============================================================
// TES TAHAP 6: generate ulang SATU hari dengan konteks pekan
// ============================================================
const asyncTests = [];
function testAsync(name, fn) { asyncTests.push({ name, fn }); }
const run = code => vm.runInContext(code, context);

// Pekan Senin 12 Okt - Minggu 18 Okt 2026; pekan depan (19 Okt) bertema "Thawaf".
function contohRencana() {
  const base = { status: 'idea', tema_minggu: 'Talbiyah', pilar: 'storytelling', tipe_konten: 'image', draft_caption: 'Caption contoh.\nBaris dua.', teks_gambar: 'Hook contoh\nBaris dua' };
  return [
    { ...base, id: 'sen', tanggal: '2026-10-12', tema: 'Gemetar saat pertama bilang labbaik', teks_gambar: 'Pernah merinding?\nLabel gambar: Seri Talbiyah · 1/7' },
    { ...base, id: 'sel', tanggal: '2026-10-13', tema: 'Lafaz talbiyah dan artinya', pilar: 'manasik', draft_caption: 'Kartu praktis talbiyah.' },
    { ...base, id: 'rab', tanggal: '2026-10-14', tema: 'Persiapan fisik sebelum berangkat', pilar: 'edukasi', tipe_konten: 'carousel' },
    { ...base, id: 'kam', tanggal: '2026-10-15', tema: 'Hari yang dilewati', status: 'dilewati' },
    { ...base, id: 'jum', tanggal: '2026-10-16', tema: 'Seri lain nyasar', tema_minggu: 'Sa\'i' },
    { ...base, id: 'min', tanggal: '2026-10-18', tema: 'Renungan labbaik', pilar: 'kontemplasi', tipe_konten: 'carousel' },
    { ...base, id: 'dpn', tanggal: '2026-10-19', tema: 'Thawaf pertama', tema_minggu: 'Thawaf' },
    { ...base, id: 'post', tanggal: '2026-10-17', tema: 'Sudah jadi post', status: 'dijadikan_post' }
  ];
}

console.log('\n=== TEST: igBangunKonteksRegenHari (konteks pekan untuk 1 hari) ===');
test('Selasa -> rentang pekan Senin 12 s/d Minggu 18 Okt', () => {
  const c = T.igBangunKonteksRegenHari(contohRencana(), 'sel');
  assert.strictEqual(c.senin, '2026-10-12'); assert.strictEqual(c.minggu, '2026-10-18');
});
test('Minggu tetap masuk pekan yang sama (Senin 12 Okt), bukan pekan berikutnya', () => {
  const c = T.igBangunKonteksRegenHari(contohRencana(), 'min');
  assert.strictEqual(c.senin, '2026-10-12'); assert.strictEqual(c.minggu, '2026-10-18');
});
test('slot memuat hari, pilar, tipe, urutan & peran', () => {
  const s = T.igBangunKonteksRegenHari(contohRencana(), 'sel').slot;
  assert.strictEqual(s.tanggal, '2026-10-13'); assert.strictEqual(s.hari, 'Selasa');
  assert.strictEqual(s.pilar, 'manasik'); assert.strictEqual(s.tipe_konten, 'image');
  assert.strictEqual(s.urutan, 2); assert.strictEqual(s.peran, 'Pahami');
});
test('Tema Minggu diambil dari rencana itu', () => assert.strictEqual(T.igBangunKonteksRegenHari(contohRencana(), 'sel').temaMinggu, 'Talbiyah'));
test('baris pekan: hari lain seri yang sama saja, urut tanggal, tanpa hari itu sendiri / dilewati / seri lain / pekan lain', () => {
  const b = T.igBangunKonteksRegenHari(contohRencana(), 'sel').barisPekan;
  assert.deepStrictEqual(b.map(x => x.split(' | ')[0]), ['Senin 2026-10-12', 'Rabu 2026-10-14', 'Sabtu 2026-10-17', 'Minggu 2026-10-18']);
  assert.ok(!b.join('\n').includes('Lafaz talbiyah'), 'hari yang diganti tidak boleh jadi konteks');
  assert.ok(!b.join('\n').includes('dilewati') && !b.join('\n').includes('Seri lain nyasar') && !b.join('\n').includes('Thawaf'));
});
test('format baris: hari | peran | tema | hook (baris pertama teks gambar) | caption dibuka', () => {
  const b = T.igBangunKonteksRegenHari(contohRencana(), 'sel').barisPekan[0];
  assert.strictEqual(b, 'Senin 2026-10-12 | Rasakan | Gemetar saat pertama bilang labbaik | hook: Pernah merinding? | caption dibuka: Caption contoh.');
});
test('teaser pekan depan hanya untuk Minggu', () => {
  assert.strictEqual(T.igBangunKonteksRegenHari(contohRencana(), 'sel').temaMingguDepan, '');
  assert.strictEqual(T.igBangunKonteksRegenHari(contohRencana(), 'min').temaMingguDepan, 'Thawaf');
});
test('ide yang sudah jadi post / dilewati / tidak ada -> null', () => {
  assert.strictEqual(T.igBangunKonteksRegenHari(contohRencana(), 'post'), null);
  assert.strictEqual(T.igBangunKonteksRegenHari(contohRencana(), 'kam'), null);
  assert.strictEqual(T.igBangunKonteksRegenHari(contohRencana(), 'tidak-ada'), null);
});
test('data lama tanpa tema_minggu meminjam Tema Minggu dari hari lain di pekan itu', () => {
  const rencana = contohRencana(); rencana.find(p => p.id === 'sel').tema_minggu = null;
  assert.strictEqual(T.igBangunKonteksRegenHari(rencana, 'sel').temaMinggu, 'Talbiyah');
});
test('tanpa Tema Minggu sama sekali -> semua hari pekan itu jadi penyambung, temaMinggu kosong', () => {
  const rencana = contohRencana().map(p => ({ ...p, tema_minggu: null }));
  const c = T.igBangunKonteksRegenHari(rencana, 'sel');
  assert.strictEqual(c.temaMinggu, ''); assert.ok(c.barisPekan.length >= 4);
});
test('tipe video (tidak didukung AI) kembali ke tipe pola hari', () => {
  const rencana = contohRencana(); rencana.find(p => p.id === 'sel').tipe_konten = 'video';
  assert.strictEqual(T.igBangunKonteksRegenHari(rencana, 'sel').slot.tipe_konten, 'image');
});
test('tipe carousel hasil edit admin dipertahankan', () => {
  const rencana = contohRencana(); rencana.find(p => p.id === 'sel').tipe_konten = 'carousel';
  assert.strictEqual(T.igBangunKonteksRegenHari(rencana, 'sel').slot.tipe_konten, 'carousel');
});

// ---- Alur lengkap igRegenerasiHariPlan dengan semua dependensi di-mock ----
function siapkanMock({ balasan, updateRows = [{ id: 'sel' }], konfirmasi = true }) {
  const log = { panggilan: [], patch: null, filter: [], toast: [], reload: 0 };
  sandbox.__log = log; sandbox.__balasan = balasan.slice(); sandbox.__updateRows = updateRows; sandbox.__konfirmasi = konfirmasi;
  sandbox.__rencana = contohRencana();
  run(`
    igContentPlan = __rencana; igPosts = []; igPlanBusy = false; igTeksGambarReady = true; igPlannerColsReady = true; igDayModalDateKey = null;
    canManageProgramData = () => true;
    openActionConfirm = async () => __konfirmasi;
    buildIgPlanProgramContext = async () => '';
    showToast = (m, t) => __log.toast.push({ m, t });
    loadIgContentPlan = async () => { __log.reload++; };
    igRefreshPlanResultListIfOpen = () => {};
    igCallPlanFunction = async (payload) => { __log.panggilan.push(payload); return { items: [__balasan.shift()].filter(Boolean), versi: 4 }; };
    supabaseClient = { from: () => ({ update: (patch) => { __log.patch = patch; const q = { eq: (k, v) => { __log.filter.push([k, v]); return q; }, select: async () => ({ data: __updateRows, error: null }) }; return q; } }) };
  `);
  return log;
}
const ideBaru = { tanggal: '2026-10-13', tema: 'Tiga kesalahan saat mengucap labbaik', teks_gambar: 'Sudah benar bacaanmu?\nCek lagi', draft_caption: 'Isi caption baru.\n#umroh' };
const ideKembar = { tanggal: '2026-10-13', tema: 'Lafaz talbiyah dan artinya versi lain', teks_gambar: 'x', draft_caption: 'c' };

testAsync('berhasil: 1 baris di-UPDATE (bukan insert), label seri ditambah, tahap kembali ke ide', async () => {
  const log = siapkanMock({ balasan: [ideBaru] });
  await T.igRegenerasiHariPlan('sel');
  assert.strictEqual(log.panggilan.length, 1);
  assert.strictEqual(log.patch.tema, ideBaru.tema);
  assert.strictEqual(log.patch.draft_caption, ideBaru.draft_caption);
  assert.ok(log.patch.teks_gambar.endsWith('\nLabel gambar: Seri Talbiyah · 2/7'), log.patch.teks_gambar);
  assert.strictEqual(log.patch.tahap, 'ide');
  assert.strictEqual(JSON.stringify(log.filter), JSON.stringify([['id', 'sel'], ['status', 'idea']]));
  assert.strictEqual(log.reload, 1);
  assert.strictEqual(log.toast.at(-1).t, 'success');
});
testAsync('payload ke AI: 1 slot, Tema Minggu, konteks pekan, ide lama ada di riwayat', async () => {
  const log = siapkanMock({ balasan: [ideBaru] });
  await T.igRegenerasiHariPlan('sel');
  const p = log.panggilan[0];
  assert.strictEqual(p.jumlahPost, 1); assert.strictEqual(p.slots.length, 1); assert.strictEqual(p.slots[0].tanggal, '2026-10-13');
  assert.strictEqual(p.tanggalMulai, '2026-10-12'); assert.strictEqual(p.tanggalAkhir, '2026-10-18');
  assert.strictEqual(p.temaMinggu, 'Talbiyah');
  assert.ok(p.konteksPekan.includes('Senin 2026-10-12 | Rasakan'));
  assert.ok(!p.konteksPekan.includes('Lafaz talbiyah'));
  assert.ok(p.riwayatTema.includes('Lafaz talbiyah dan artinya'), 'ide lama harus dihindari');
  assert.ok(p.arahan.includes('BERBEDA'));
});
testAsync('hasil AI yang kembar dengan ide lama ditolak lalu dicoba ulang', async () => {
  const log = siapkanMock({ balasan: [ideKembar, ideBaru] });
  await T.igRegenerasiHariPlan('sel');
  assert.strictEqual(log.panggilan.length, 2);
  assert.strictEqual(log.patch.tema, ideBaru.tema);
  assert.ok(log.panggilan[1].riwayatTema.includes('versi lain'), 'percobaan ulang harus menghindari hasil yang ditolak');
});
testAsync('semua percobaan kembar -> ide lama dipertahankan (tidak ada update), flag busy kembali false', async () => {
  const log = siapkanMock({ balasan: [ideKembar, ideKembar, ideKembar] });
  await T.igRegenerasiHariPlan('sel');
  assert.strictEqual(log.panggilan.length, 3); assert.strictEqual(log.patch, null); assert.strictEqual(log.reload, 0);
  assert.strictEqual(run('igPlanBusy'), false);
});
testAsync('batal di dialog konfirmasi -> tidak memanggil AI maupun menyimpan', async () => {
  const log = siapkanMock({ balasan: [ideBaru], konfirmasi: false });
  await T.igRegenerasiHariPlan('sel');
  assert.strictEqual(log.panggilan.length, 0); assert.strictEqual(log.patch, null);
});
testAsync('status berubah selama AI bekerja (update 0 baris) -> tidak reload, user diberi tahu', async () => {
  const log = siapkanMock({ balasan: [ideBaru], updateRows: [] });
  await T.igRegenerasiHariPlan('sel');
  assert.strictEqual(log.reload, 0); assert.strictEqual(log.toast.at(-1).t, 'info');
  assert.strictEqual(run('igPlanBusy'), false);
});
testAsync('sedang ada generate lain (igPlanBusy) -> ditolak tanpa panggilan AI', async () => {
  const log = siapkanMock({ balasan: [ideBaru] });
  run('igPlanBusy = true');
  await T.igRegenerasiHariPlan('sel');
  assert.strictEqual(log.panggilan.length, 0);
  run('igPlanBusy = false');
});
testAsync('error dari AI -> toast error, flag busy kembali false, tidak menyimpan', async () => {
  const log = siapkanMock({ balasan: [ideBaru] });
  run('igCallPlanFunction = async () => { throw new Error("server sibuk"); }');
  await T.igRegenerasiHariPlan('sel');
  assert.strictEqual(log.patch, null); assert.strictEqual(log.toast.at(-1).t, 'error');
  assert.strictEqual(run('igPlanBusy'), false);
});
testAsync('tanpa kolom teks_gambar/tahap (migrasi belum jalan) -> patch hanya tema & caption', async () => {
  const log = siapkanMock({ balasan: [ideBaru] });
  run('igTeksGambarReady = false; igPlannerColsReady = false;');
  await T.igRegenerasiHariPlan('sel');
  assert.deepStrictEqual(Object.keys(log.patch).sort(), ['draft_caption', 'tema']);
});

// ============================================================
(async () => {
  for (const t of asyncTests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.error('  ✗ ' + t.name + '\n      ' + e.message); }
  }
  console.log(`\n=== HASIL: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})();
