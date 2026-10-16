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
const wrapped = code + '\n;globalThis.__T = { hitungEstimasi, rupiahTerbilang, parseRupiahToNumber, escapeHtml, escapeJsAttr, takeSnapshot, MAX_SNAPSHOTS, getHargaKamarJamaah, igBangunKonteksRegenHari, igFormatBarisPekan, igRegenerasiHariPlan, igSusunPromptEksternal, igSalinPromptPlan, IG_PLAN_PROMPT_SISTEM, igHijriMonth, igKandidatTemaMinggu, igPetaTemaSetahun, IG_TEMA_ALUR, IG_TEMA_MUSIM, IG_ALUR_GRUP, IG_ALUR_JENDELA, igAlurGrupIdx, igRtBankAlurGrup, igJenisPekan, igPolaHari, igBuildSlotPekan, igPerluJedaMusim, igTemaHariBesar, igTemaMusiman, igPeristiwaPekan, IG_POLA_VARIAN, igChipTopik, igJenisTema, igRtKesehatan, IG_TEMA_PRAKTIS, IG_RASIO_HATI };';
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
// Tema alur yang TIDAK bentrok dengan riwayat topik awal (IG_RIWAYAT_AWAL, jeda sampai 12 April 2027): tes di pekan
// 2 Nov 2026 yang dulu mengharapkan IG_TEMA_ALUR[0] sekarang mengharapkan tema bebas pertama.
const ALUR_TERBLOKIR = new Set(vm.runInContext('IG_RIWAYAT_AWAL', context).flatMap(r => r.alur || [])); // `run` baru didefinisikan lebih bawah
const ALUR_BEBAS = T.IG_TEMA_ALUR.filter(a => !ALUR_TERBLOKIR.has(a));
test('bulan Hijriah: 22 Feb 2027 = Ramadhan (9), 15 Okt 2026 = Jumadil Awal (5)', () => {
  assert.strictEqual(T.igHijriMonth(new Date(2027, 1, 22)), 9);
  assert.strictEqual(T.igHijriMonth(new Date(2026, 9, 15)), 5);
});
test('tanpa riwayat & bukan musim tema: mulai dari awal alur perjalanan', () => {
  const k = T.igKandidatTemaMinggu('2026-11-02', [], 3);
  assert.strictEqual(k[0].tema, ALUR_BEBAS[0]); assert.ok(/Awal alur/.test(k[0].alasan));
  assert.strictEqual(k.length, 3);
});
test('alur seimbang: fase yang baru tayang tidak langsung dipilih lagi, giliran pindah ke fase lain', () => {
  const k = T.igKandidatTemaMinggu('2026-11-02', [tp('2026-10-26', T.IG_TEMA_ALUR[0])], 1);
  assert.notStrictEqual(T.igAlurGrupIdx(k[0].tema), T.igAlurGrupIdx(T.IG_TEMA_ALUR[0]));
  assert.ok(/Seimbangkan alur/.test(k[0].alasan), k[0].alasan);
});
test('alur seimbang: di dalam satu fase urutan tetap menyambung dari tema terakhir fase itu', () => {
  const siap = T.IG_ALUR_GRUP[0].tema; // 'Umroh Pertama Kali' (indeks 1) sudah tayang -> tema berikutnya di fase itu = indeks 2
  const g = T.IG_ALUR_GRUP;
  const plans = [tp('2026-09-14', siap[1]), tp('2026-09-21', g[1].tema[1]), tp('2026-09-28', g[2].tema[1]), tp('2026-10-05', g[3].tema[1]), tp('2026-10-12', g[4].tema[1])];
  const k = T.igKandidatTemaMinggu('2026-10-19', plans, 8).filter(x => x.grup === 'siap');
  assert.strictEqual(k[0].tema, siap[2]);
});
test('alur seimbang: pekan berisi 7 baris ide bertema sama dihitung SATU pekan, bukan tujuh', () => {
  const g = T.IG_ALUR_GRUP;
  const tujuh = ['12', '13', '14', '15', '16', '17', '18'].map(d => tp('2026-10-' + d, g[0].tema[2])); // 1 pekan fase siap (7 baris)
  const lain = [1, 2, 3, 4].map((i, n) => tp('2026-10-' + String(19 + 7 * n).padStart(2, '0'), g[i].tema[2])); // 1 baris per pekan untuk 4 fase lain
  const k = T.igKandidatTemaMinggu('2026-11-16', tujuh.concat(lain), 8).filter(x => x.grup); // hanya saran tema alur (tema musiman bisa mendahului)
  assert.strictEqual(T.igAlurGrupIdx(k[0].tema), 0, 'fase siap tidak boleh terhukum 7x: ' + k[0].tema);
});
test('Rencana Setahun AI: bankAlurGrup memuat semua fase beserta bobot dan membuang tema yang terblokir', () => {
  const penuh = T.igRtBankAlurGrup(new Set());
  assert.strictEqual(penuh.length, T.IG_ALUR_GRUP.length);
  penuh.forEach((g, i) => { assert.strictEqual(g.id, T.IG_ALUR_GRUP[i].id); assert.strictEqual(g.bobot, T.IG_ALUR_GRUP[i].bobot); assert.strictEqual(g.tema.length, T.IG_ALUR_GRUP[i].tema.length); });
  assert.strictEqual(penuh.reduce((t, g) => t + g.tema.length, 0), T.IG_TEMA_ALUR.length);
  const blok = new Set(['Raudhah', 'Niat dan Panggilan']);
  const sisa = T.igRtBankAlurGrup(blok);
  assert.ok(!sisa.some(g => g.tema.some(t => blok.has(t))));
  const habis = new Set(T.IG_ALUR_GRUP[2].tema); // satu fase habis terblokir -> fase itu dibuang dari payload
  assert.ok(!T.igRtBankAlurGrup(habis).some(g => g.id === T.IG_ALUR_GRUP[2].id));
});
// ---- Tahap 2: pola 7 hari dinamis + jeda pekan musiman ----
const seninList = (dari, n) => Array.from({ length: n }, (_, i) => { const [y, m, d] = dari.split('-').map(Number); const t = new Date(y, m - 1, d + 7 * i); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; });
const PEKAN_52 = seninList('2026-10-19', 52);
test('jenis pekan: ada peristiwa Hijriah -> hari_besar; tema penjualan -> penjualan; selain itu biasa', () => {
  const hb = PEKAN_52.filter(sn => T.igPeristiwaPekan(sn));
  assert.ok(hb.length >= 3, 'setahun harus memuat beberapa pekan hari besar: ' + hb.length);
  hb.forEach(sn => assert.strictEqual(T.igJenisPekan(sn, 'Persiapan Fisik'), 'hari_besar'));
  const biasa = PEKAN_52.find(sn => !T.igPeristiwaPekan(sn));
  assert.strictEqual(T.igJenisPekan(biasa, 'Umroh di Libur Sekolah'), 'penjualan');
  assert.strictEqual(T.igJenisPekan(biasa, 'Persiapan Fisik'), 'biasa');
  assert.strictEqual(T.igJenisPekan(biasa, ''), 'biasa');
});
test('slot pekan biasa = pola bawaan tanpa catatan; pekan penjualan mengganti Selasa, Rabu, Jumat', () => {
  const biasa = PEKAN_52.find(sn => !T.igPeristiwaPekan(sn));
  const dasar = T.igBuildSlotPekan(biasa, new Set(), null, 'Persiapan Fisik');
  assert.deepStrictEqual([...dasar.map(x => x.peran)], ['Rasakan', 'Pahami', 'Siapkan', 'Bayangkan', 'Hindari', 'Terinspirasi', 'Renungkan']);
  assert.ok(dasar.every(x => !('catatan' in x)));
  const jual = T.igBuildSlotPekan(biasa, new Set(), null, 'Umroh di Libur Sekolah');
  assert.deepStrictEqual([...jual.map(x => x.peran)], ['Rasakan', 'Rencanakan', 'Hitung', 'Bayangkan', 'Pertimbangkan', 'Terinspirasi', 'Renungkan']);
  assert.deepStrictEqual([...jual.map(x => x.tipe_konten)], ['image', 'image', 'carousel', 'carousel', 'carousel', 'carousel', 'carousel']);
  assert.strictEqual(jual.filter(x => x.catatan).length, 3);
});
test('slot pekan hari besar: Senin, Selasa, Rabu, Jumat berganti peran dan format; Kamis, Sabtu, Minggu tetap', () => {
  const hb = PEKAN_52.find(sn => T.igPeristiwaPekan(sn));
  const sl = T.igBuildSlotPekan(hb, new Set(), null, '');
  assert.deepStrictEqual([...sl.map(x => x.peran)], ['Sambut', 'Kenali', 'Amalkan', 'Bayangkan', 'Tanya Jawab', 'Terinspirasi', 'Renungkan']);
  assert.strictEqual(sl[4].tipe_konten, 'image'); // Jumat dasar = carousel
  sl.forEach(x => { assert.ok(['storytelling', 'edukasi', 'manasik', 'kontemplasi'].includes(x.pilar)); assert.ok(['image', 'carousel'].includes(x.tipe_konten)); });
});
test('variasi 52 pekan: tidak semua pekan sama, tiap varian punya peran unik yang dikenali chip kalender', () => {
  const pola = PEKAN_52.map(sn => T.igBuildSlotPekan(sn, new Set(), null, '').map(x => x.peran + x.tipe_konten).join('|'));
  assert.ok(new Set(pola).size >= 2);
  Object.values(T.IG_POLA_VARIAN).forEach(g => Object.values(g).forEach(v => {
    assert.strictEqual(T.igChipTopik(v.peran + ': Judul ide'), 'Judul ide', v.peran);
    assert.ok(v.catatan.length > 20 && v.catatan.length <= 240, v.peran);
  }));
});
test('jeda musim: tema musiman biasa ditunda kalau pekan sebelah musiman; hari besar dan tema alur tidak terpengaruh', () => {
  assert.strictEqual(T.igPerluJedaMusim('Umroh di Libur Sekolah', ['Rencanakan Umroh di Bulan Ramadhan']), true);
  assert.strictEqual(T.igPerluJedaMusim('Umroh di Libur Sekolah', ['Persiapan Fisik']), false);
  assert.strictEqual(T.igPerluJedaMusim('Umroh di Libur Sekolah', []), false);
  assert.strictEqual(T.igPerluJedaMusim('Cinta Rasulullah dan Rindu Madinah', ['Umroh di Libur Sekolah']), false); // hari besar tidak ditunda
  assert.strictEqual(T.igPerluJedaMusim('Persiapan Fisik', ['Umroh di Libur Sekolah']), false);
  assert.strictEqual(T.igTemaHariBesar('Isra Miraj dan Makna Shalat'), true);
  assert.strictEqual(T.igTemaHariBesar('Umroh di Libur Sekolah'), false);
});
test('peta 52 pekan: tidak ada dua pekan berturut-turut bertema musiman biasa (hari besar dikecualikan)', () => {
  const peta = T.igPetaTemaSetahun('2026-10-19', [], 52, null, []);
  assert.strictEqual(peta.length, 52);
  for (let i = 1; i < peta.length; i++) {
    const a = peta[i - 1].tema, b = peta[i].tema;
    const kembar = T.igTemaMusiman(a) && T.igTemaMusiman(b) && !T.igTemaHariBesar(a) && !T.igTemaHariBesar(b);
    assert.ok(!kembar, `pekan ${i} dan ${i + 1} sama-sama musiman biasa: ${a} / ${b}`);
  }
});
test('pekan yang sudah punya tema -> tema itu saja (generate sebagian tidak ganti tema)', () => {
  const k = T.igKandidatTemaMinggu('2026-10-12', [tp('2026-10-14', 'Talbiyah')], 5);
  assert.strictEqual(k.length, 1); assert.strictEqual(k[0].tema, 'Talbiyah');
});
test('pekan di bulan Ramadhan: tema musiman didahulukan', () => {
  const k = T.igKandidatTemaMinggu('2027-02-22', [], 4);
  assert.ok(/Ramadhan/.test(k[0].tema), k[0].tema); assert.ok(/Ramadhan/.test(k[0].alasan), k[0].alasan); // 22 Feb 2027 = pekan sepuluh malam terakhir
});
test('tema yang sudah dipakai (bahkan di pekan depan) dilewati', () => {
  const k = T.igKandidatTemaMinggu('2026-11-02', [tp('2026-11-16', T.IG_TEMA_ALUR[0])], 1);
  assert.strictEqual(k[0].tema, T.IG_TEMA_ALUR[1]);
});
test('tema lebih dari setahun lalu tidak lagi memblokir (alur melingkar kembali ke tema lama)', () => {
  const A = T.IG_TEMA_ALUR;
  const plans = [tp('2025-05-26', A[0]), tp('2025-06-02', A[A.length - 1])]; // keduanya di luar jendela 365 hari
  assert.strictEqual(T.igKandidatTemaMinggu('2026-11-02', plans, 1)[0].tema, ALUR_BEBAS[0]); // A[0] terblokir riwayat awal -> tema bebas berikutnya
});
test('semua tema alur sudah terpakai -> tetap ada saran (tidak kosong)', () => {
  const semua = T.IG_TEMA_ALUR.map((tema, i) => tp(`2026-${String(1 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + (i % 4) * 7).padStart(2, '0')}`, tema));
  assert.ok(T.igKandidatTemaMinggu('2026-10-12', semua, 1)[0].tema);
});
test('tema penjualan tayang lebih awal: Rajab (2,5 bulan sebelum Ramadhan) memuat "Rencanakan Umroh di Bulan Ramadhan" paling atas', () => {
  const k = T.igKandidatTemaMinggu('2026-12-07', [], 3);
  assert.strictEqual(k[0].tema, 'Rencanakan Umroh di Bulan Ramadhan'); assert.ok(/memesan/.test(k[0].alasan)); assert.strictEqual(k[0].jual, true);
});
test('tema libur sekolah muncul April-Mei, libur akhir tahun September-Oktober', () => {
  assert.ok(T.igKandidatTemaMinggu('2027-04-12', [], 6).some(x => x.tema === 'Umroh di Libur Sekolah'));
  assert.ok(T.igKandidatTemaMinggu('2026-10-12', [], 6).some(x => x.tema === 'Umroh di Libur Akhir Tahun'));
});
test('peta setahun: tema jelang Ramadhan tayang jauh (>= 4 pekan) sebelum tema Ramadhan itu sendiri, dan tiap tema penjualan sekali saja', () => {
  const peta = T.igPetaTemaSetahun('2026-10-12', [], 52);
  const i = peta.findIndex(r => r.tema === 'Rencanakan Umroh di Bulan Ramadhan');
  const j = peta.findIndex(r => r.tema === 'Ramadhan dan Rindu Tanah Suci');
  assert.ok(i >= 0 && j >= 0 && j - i >= 4, `lead=${i} musim=${j}`);
  // Tema penjualan boleh kembali di musim yang sama tahun depan (jeda musiman 300 hari, IG_JEDA_TEMA_MUSIM_HARI), tapi tidak lebih cepat dari itu.
  ['Umroh di Libur Sekolah', 'Umroh di Libur Akhir Tahun', 'Bersiap Menyambut Musim Haji'].forEach(n => {
    const tgl = peta.filter(r => r.tema === n).map(r => new Date(r.senin + 'T00:00:00Z').getTime());
    assert.ok(tgl.length >= 1, n + ' tidak tayang');
    tgl.slice(1).forEach((x, i) => assert.ok((x - tgl[i]) / 864e5 >= 300, n + ' tayang kembali terlalu cepat'));
  });
});
test('peta 52 pekan: berurutan, tidak ada tema kembar, pekan pertama bisa dikunci pilihan admin', () => {
  const peta = T.igPetaTemaSetahun('2026-10-12', [], 52, 'Talbiyah');
  assert.strictEqual(peta.length, 52);
  assert.strictEqual(peta[0].tema, 'Talbiyah'); assert.strictEqual(peta[0].senin, '2026-10-12'); assert.strictEqual(peta[1].senin, '2026-10-19');
  // Satu-satunya pengulangan yang sah: tema musiman yang kembali di musim yang sama (jeda >= 300 hari), mis. libur akhir tahun.
  const kembar = peta.filter((r, i) => peta.findIndex(x => x.tema.toLowerCase() === r.tema.toLowerCase()) !== i);
  assert.ok(kembar.every(r => T.IG_ALUR_GRUP.every(g => !g.tema.includes(r.tema))), 'tema alur tidak boleh kembar: ' + kembar.map(r => r.tema));
  assert.ok(new Set(peta.map(r => r.tema.toLowerCase())).size >= 50);
});
test('semua tema alur terpetakan ke tepat satu fase, tanpa tema ganda antar fase', () => {
  const semua = T.IG_ALUR_GRUP.flatMap(g => g.tema);
  assert.strictEqual(new Set(semua.map(x => x.toLowerCase())).size, semua.length, 'ada tema ganda');
  assert.strictEqual(semua.length, T.IG_TEMA_ALUR.length);
  T.IG_ALUR_GRUP.forEach((g, gi) => g.tema.forEach(a => assert.strictEqual(T.igAlurGrupIdx(a), gi, a)));
  assert.strictEqual(T.igAlurGrupIdx('Isra Miraj dan Makna Shalat'), -1); // tema musiman bukan tema alur
});
test('peta 52 pekan SEIMBANG: kelima fase alur tayang di tahun pertama, jatah mengikuti bobot, tidak ada fase hilang lama', () => {
  const peta = T.igPetaTemaSetahun('2026-10-12', [], 52);
  const hitung = T.IG_ALUR_GRUP.map(() => 0); const terakhir = {}; let selisihMaks = 0;
  peta.forEach((r, i) => {
    const g = T.igAlurGrupIdx(r.tema); if (g < 0) return;
    hitung[g]++; if (g in terakhir) selisihMaks = Math.max(selisihMaks, i - terakhir[g]); terakhir[g] = i;
  });
  assert.ok(hitung.every(c => c >= 5), 'ada fase yang nyaris tak tayang: ' + hitung);
  assert.ok(Math.max(...hitung) - Math.min(...hitung) <= 4, 'jatah timpang: ' + hitung);
  assert.ok(hitung[0] >= hitung[2] && hitung[1] >= hitung[2], 'fase berbobot lebih besar harus tayang >= fase berbobot lebih kecil: ' + hitung);
  assert.ok(selisihMaks <= 12, 'satu fase menghilang ' + selisihMaks + ' pekan');
});
test('peta 52 pekan: di dalam satu fase urutan tema menyambung (tidak loncat acak)', () => {
  const peta = T.igPetaTemaSetahun('2026-10-12', [], 52);
  T.IG_ALUR_GRUP.forEach((g, gi) => {
    const idx = peta.map(r => r.tema).filter(x => T.igAlurGrupIdx(x) === gi).map(x => g.tema.indexOf(x));
    idx.slice(1).forEach((v, i) => assert.ok(v > idx[i], g.id + ' loncat mundur: ' + idx));
  });
});
test('peta 104 pekan: dua tahun penuh masih memuat Madinah, umroh bersama siapa, dan pulang secara merata', () => {
  const peta = T.igPetaTemaSetahun('2026-10-12', [], 104);
  const hitung = T.IG_ALUR_GRUP.map(() => 0); peta.forEach(r => { const g = T.igAlurGrupIdx(r.tema); if (g >= 0) hitung[g]++; });
  assert.ok(hitung.every(c => c >= 12), 'jatah dua tahun: ' + hitung);
});
test('peta setahun memuat tema musiman Ramadhan dan musim haji pada pekan yang tepat', () => {
  const peta = T.igPetaTemaSetahun('2026-10-12', [], 52);
  assert.ok(peta.some(r => /Ramadhan/.test(r.tema) && /Musim Ramadhan/.test(r.alasan)));
  assert.ok(peta.some(r => /Arafah dan Idul Adha/.test(r.alasan)));
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

// ---- #1: rantai menyambung. Generate pekan hanya menerima AWALAN berurutan; hari sesudah yang ditolak ikut diulang ----
function siapkanGenPekan(skenario, rencanaLama) {
  const log = { panggilan: [], insert: [] };
  sandbox.__g = log; sandbox.__skenario = skenario.slice(); sandbox.__rencanaLama = rencanaLama || [];
  run(`
    igContentPlan = __rencanaLama; igPosts = []; igPlanBusy = false; igTeksGambarReady = true; igPlannerColsReady = true; igTemaMingguReady = true;
    buildIgPlanProgramContext = async () => '';
    loadIgContentPlan = async () => {};
    igCallPlanFunction = async (payload) => { __g.panggilan.push(payload); const fn = __skenario.shift(); return { items: fn ? fn(payload) : [], versi: 4 }; };
    supabaseClient = { from: () => ({ insert: async (rows) => { __g.insert.push(...rows); return { error: null }; } }) };
  `);
  return log;
}
const TEMA_HARI = ['Kerinduan ladang pasir', 'Urutan langkah tawaf', 'Koper ringan bawaan', 'Perjalanan pagi malam', 'Keliru sandal ihram', 'Cerita ibu tua', 'Makna panggilan'];
const itemHari = (tgl, i, tema) => ({ tanggal: tgl, tema: tema || TEMA_HARI[i], teks_gambar: (tema || TEMA_HARI[i]) + ' tadi', draft_caption: 'Caption ' + (tema || TEMA_HARI[i]) });
// semua 7 slot -> item, kecuali indeks `kembar` memakai tema yang mirip konten lama
const balasSemua = (kembar, pengganti) => (payload) => payload.slots.map(sl => {
  const i = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].indexOf(sl.tanggal);
  const mirip = ['Kerinduan ladang pasir sunyi', null, 'Koper ringan bawaan sunyi'][kembar === 0 ? 0 : kembar === 2 ? 2 : 1];
  if (i === kembar) return itemHari(sl.tanggal, i, mirip);
  if (pengganti && i === pengganti.i) return itemHari(sl.tanggal, i, pengganti.tema);
  return itemHari(sl.tanggal, i, null);
});
const planLama = [{ id: 'lama', tanggal: '2026-09-01', tema: 'Kerinduan ladang pasir sunyi', teks_gambar: '', status: 'published', tema_minggu: 'Lain' }];
const slotPekan = () => run("igBuildSlotPekan('2026-10-12', new Set(), null)");
const opsiPekan = { temaMinggu: 'Talbiyah', temaMingguDepan: '', mulai: '2026-10-12', akhir: '2026-10-18' };

testAsync('generate pekan: Senin ditolak (mirip riwayat) -> hanya Senin & Selasa diulang, Rabu..Minggu tetap tersimpan', async () => {
  const log = siapkanGenPekan([balasSemua(0), balasSemua(-1, { i: 0, tema: 'Gemetar bersama ribuan suara' })], planLama);
  sandbox.__slots = slotPekan(); sandbox.__opsi = opsiPekan;
  const r = await run("igGeneratePlanForSlots(2026, 9, __slots, '', null, __opsi)");
  assert.strictEqual(log.panggilan.length, 2);
  assert.strictEqual(JSON.stringify(log.panggilan[1].slots.map(x => x.tanggal)), JSON.stringify(['2026-10-12', '2026-10-13']));
  assert.strictEqual(log.insert.length, 7); assert.strictEqual(r.berhasil, 7); assert.strictEqual(r.sisa.length, 0);
  assert.ok(!log.insert.some(x => x.tema === 'Kerinduan ladang pasir sunyi'), 'versi lama yang ditolak tidak boleh tersimpan');
  assert.strictEqual(log.insert.filter(x => x.tanggal === '2026-10-12').length, 1, 'tidak ada baris ganda');
});
testAsync('generate pekan (regresi bug 1): Rabu ditolak -> hanya Rabu & Kamis diulang, hari lain tidak dibuang', async () => {
  const log = siapkanGenPekan([balasSemua(2), balasSemua(-1, { i: 2, tema: 'Bekal fisik jalan jauh' })], [{ ...planLama[0], tema: 'Koper ringan bawaan sunyi' }]);
  sandbox.__slots = slotPekan(); sandbox.__opsi = opsiPekan;
  const r = await run("igGeneratePlanForSlots(2026, 9, __slots, '', null, __opsi)");
  assert.strictEqual(log.panggilan.length, 2);
  assert.strictEqual(JSON.stringify(log.panggilan[1].slots.map(x => x.tanggal)), JSON.stringify(['2026-10-14', '2026-10-15']));
  assert.ok(log.panggilan[1].konteksPekan.includes('Selasa 2026-10-13') && log.panggilan[1].konteksPekan.includes('Jumat 2026-10-16'), 'hari yang sudah jadi (sebelum & sesudah) jadi konteks');
  assert.strictEqual(r.berhasil, 7); assert.strictEqual(log.insert.length, 7);
  assert.strictEqual(JSON.stringify(log.insert.map(x => x.tanggal).sort()), JSON.stringify(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']));
});
testAsync('generate pekan: tanpa penolakan -> 1 panggilan, 7 baris, label seri benar', async () => {
  const log = siapkanGenPekan([balasSemua(-1)], []);
  sandbox.__slots = slotPekan(); sandbox.__opsi = opsiPekan;
  await run("igGeneratePlanForSlots(2026, 9, __slots, '', null, __opsi)");
  assert.strictEqual(log.panggilan.length, 1); assert.strictEqual(log.insert.length, 7);
  assert.ok(log.insert[6].teks_gambar.endsWith('Label gambar: Seri Talbiyah · 7/7'));
});
testAsync('generate pekan: hari pertama terus ditolak -> berhenti di batas putaran, hanya Senin & Selasa yang gagal, sisanya tersimpan', async () => {
  const log = siapkanGenPekan([balasSemua(0), balasSemua(0), balasSemua(0), balasSemua(0), balasSemua(0)], planLama);
  sandbox.__slots = slotPekan(); sandbox.__opsi = opsiPekan;
  const r = await run("igGeneratePlanForSlots(2026, 9, __slots, '', null, __opsi)");
  assert.ok(log.panggilan.length <= 5);
  assert.strictEqual(r.berhasil, 5); assert.strictEqual(log.insert.length, 5);
  assert.strictEqual(JSON.stringify(r.sisa.map(x => x.tanggal)), JSON.stringify(['2026-10-12', '2026-10-13']));
});

console.log('\n=== TEST: igArahanTetangga (generate ulang 1 hari tetap memenuhi janji hari sebelumnya) ===');
const rencanaTetangga = () => [
  { id: 'sen', tanggal: '2026-10-12', status: 'idea', tema_minggu: 'Talbiyah', draft_caption: 'Pembuka senin.\n\nIsi senin.\n\nTahu nggak caranya? Besok kita bahas.\n\n#UmrohBersamaAmiru #AmiruTour' },
  { id: 'sel', tanggal: '2026-10-13', status: 'idea', tema_minggu: 'Talbiyah', draft_caption: 'x' },
  { id: 'rab', tanggal: '2026-10-14', status: 'idea', tema_minggu: 'Talbiyah', draft_caption: 'Kemarin kita bahas tata caranya. Sekarang persiapannya.\n\nIsi.' },
  { id: 'min', tanggal: '2026-10-18', status: 'idea', tema_minggu: 'Talbiyah', draft_caption: 'Renungan.' },
  { id: 'sen2', tanggal: '2026-10-19', status: 'idea', tema_minggu: 'Talbiyah', draft_caption: 'Senin depan.' }
];
test('Selasa: penutup Senin & pembuka Rabu masuk arahan', () => {
  const pl = rencanaTetangga(); const a = run('igArahanTetangga')(pl, pl[1], 'Talbiyah');
  assert.strictEqual(a.length, 2);
  assert.ok(a[0].includes('Senin') && a[0].includes('Tahu nggak caranya? Besok kita bahas.') && !a[0].includes('#UmrohBersamaAmiru'));
  assert.ok(a[1].includes('Rabu') && a[1].includes('Kemarin kita bahas tata caranya'));
});
test('Senin: hanya pembuka hari sesudahnya (tidak ada hari sebelumnya di pekan yang sama)', () => {
  const pl = rencanaTetangga(); const a = run('igArahanTetangga')(pl, pl[0], 'Talbiyah');
  assert.strictEqual(a.length, 1); assert.ok(a[0].startsWith('Pembuka caption Selasa'));
});
test('Minggu: Senin pekan depan tidak dianggap hari sesudahnya', () => {
  const pl = rencanaTetangga(); const a = run('igArahanTetangga')(pl, pl[3], 'Talbiyah');
  assert.ok(!a.some(x => x.includes('Senin depan')));
});
test('hari tetangga dari seri lain atau dilewati tidak dipakai', () => {
  const pl = rencanaTetangga(); pl[0].tema_minggu = 'Lain'; pl[2].status = 'dilewati';
  assert.strictEqual(run('igArahanTetangga')(pl, pl[1], 'Talbiyah').length, 0);
});
testAsync('regen Selasa: arahan ke AI memuat janji hari sebelumnya', async () => {
  const log = siapkanMock({ balasan: [ideBaru] });
  await T.igRegenerasiHariPlan('sel');
  assert.ok(log.panggilan[0].arahan.includes('Penutup caption Senin'), log.panggilan[0].arahan);
});

// ---- #3: hook & pembuka caption tidak boleh mirip 20 posting terakhir ----
console.log('\n=== TEST: gaya 20 posting terakhir (hook & pembuka caption) ===');
const riwayatGaya = (daftar) => { const r = []; daftar.forEach(([tgl, tema, hook, buka]) => run('igRiwayatAdd')(r, tema, hook, tgl, buka)); return r; };
test('rumus pembuka: 3 kata pertama sama -> mirip, walau sisa kalimat beda', () => {
  const r = riwayatGaya([['2026-10-01', 'Topik A', 'Hook A', 'Pasir sunyi menunggu tata cara niat.']]);
  assert.strictEqual(run('igIsPembukaMirip')({ draft_caption: 'Pasir sunyi menunggu persiapan fisik.\n\nIsi' }, r), true);
});
test('rumus rujukan hari sebelumnya ("Kemarin kita bahas") dikecualikan dari cek 3 kata terhadap 20 posting terakhir', () => {
  const r = riwayatGaya([['2026-10-01', 'Topik A', 'Hook A', 'Kemarin kita bahas tata cara niat.']]);
  assert.strictEqual(run('igIsPembukaMirip')({ draft_caption: 'Kemarin kita bahas persiapan fisik.\n\nIsi' }, r), false);
});
test('rumus rujukan tetap ditolak kalau seluruh kalimat pembukanya hampir sama (cek token tidak ikut dilonggarkan)', () => {
  const r = riwayatGaya([['2026-10-01', 'Topik A', 'Hook A', 'Kemarin kita bahas tata cara niat umroh pertama.']]);
  assert.strictEqual(run('igIsPembukaMirip')({ draft_caption: 'Kemarin kita bahas tata cara niat umroh pertama.\n\nIsi' }, r), true);
});

test('pembuka beda rumus & beda isi -> tidak mirip', () => {
  const r = riwayatGaya([['2026-10-01', 'Topik A', 'Hook A', 'Kemarin kita bahas tata cara niat.']]);
  assert.strictEqual(run('igIsPembukaMirip')({ draft_caption: 'Pernah nggak kamu menahan tangis di depan pintu?' }, r), false);
});
test('token pembuka hampir sama (rumus beda) -> mirip', () => {
  const r = riwayatGaya([['2026-10-01', 'Topik A', 'Hook A', 'Bayangin kamu berdiri di depan Kabah sambil menangis diam']]);
  assert.strictEqual(run('igIsPembukaMirip')({ draft_caption: 'Coba bayangkan kamu berdiri depan Kabah sambil menangis diam' }, r), true);
});
test('kata Tema Minggu diabaikan saat membandingkan pembuka (seri yang sama tidak otomatis kembar)', () => {
  const r = riwayatGaya([['2026-10-12', 'Topik A', 'Hook A', 'Talbiyah pertama terasa gemetar di dada']]);
  const abaikan = run('igTokenSet')('Talbiyah');
  assert.strictEqual(run('igIsPembukaMirip')({ draft_caption: 'Talbiyah kedua terasa tenang sekali' }, r, abaikan), false);
});
test('hanya 20 posting terbaru yang dihitung; yang lebih lama boleh dipakai lagi', () => {
  const daftar = [['2026-01-01', 'Lama', 'Hook lama', 'Pembuka kuno sekali ini']];
  for (let i = 1; i <= 20; i++) daftar.push([`2026-02-${String(i).padStart(2, '0')}`, 'Tema ' + i, 'Hook ' + i, 'Pembukaan unik nomor ' + 'abcdefghijklmnopqrst'[i - 1] + ' saja']);
  const r = riwayatGaya(daftar);
  assert.strictEqual(run('igGayaTerbaru')(r).length, 20);
  assert.strictEqual(run('igIsPembukaMirip')({ draft_caption: 'Pembuka kuno sekali ini lagi' }, r), false, 'entri ke-21 sudah di luar 20 terakhir');
  const r2 = riwayatGaya(daftar.slice(1));
  assert.strictEqual(run('igIsPembukaMirip')({ draft_caption: 'Pembukaan unik nomor a saja' }, r2), true);
});
test('entri tanpa tanggal (tema yang baru ditolak) tidak dihitung sebagai 20 terakhir', () => {
  const r = riwayatGaya([['', 'Ditolak', 'x', 'Kemarin kita bahas sesuatu']]);
  assert.strictEqual(run('igGayaTerbaru')(r).length, 0);
});
test('igRiwayatGayaToText: terbaru dulu, memuat hook & pembuka', () => {
  const r = riwayatGaya([['2026-10-01', 'A', 'Hook satu', 'Buka satu'], ['2026-10-05', 'B', 'Hook dua', 'Buka dua']]);
  const txt = run('igRiwayatGayaToText')(r).split('\n');
  assert.strictEqual(txt.length, 2);
  assert.ok(txt[0].startsWith('- 2026-10-05') && txt[0].includes('hook: Hook dua') && txt[0].includes('pembuka: Buka dua'));
});
test('prompt untuk AI lain memuat bagian HOOK & PEMBUKA 20 POSTING TERAKHIR hanya kalau ada isinya', () => {
  const dasar = { bulanLabel: 'Oktober 2026', tanggalMulai: '2026-10-12', tanggalAkhir: '2026-10-18', temaMinggu: 'Talbiyah', slots: [], konteksProgram: '' };
  assert.ok(T.igSusunPromptEksternal({ ...dasar, riwayatGaya: '- 2026-10-05 | hook: H | pembuka: P' }).includes('HOOK & PEMBUKA CAPTION 20 POSTING TERAKHIR'));
  assert.ok(!T.igSusunPromptEksternal(dasar).includes('=== PERMINTAAN ===\nSusun paket konten Instagram yang saling menyambung untuk Oktober 2026 (rentang tanggal 2026-10-12 s/d 2026-10-18), sebanyak TEPAT 0 ide post.\n\nTEMA MINGGU: Talbiyah\n\nHOOK'));
});
testAsync('generate pekan: pembuka Rabu memakai rumus yang sama dgn Selasa -> Rabu & Kamis diulang, AI diberi riwayatGaya', async () => {
  const log = siapkanGenPekan([
    (payload) => payload.slots.map((sl, i) => ({ ...itemHari(sl.tanggal, i, null), draft_caption: (i === 2 ? 'Pasir sunyi menunggu langkah thawaf ' : i === 1 ? 'Pasir sunyi menunggu rindu ' : 'Pembuka ' + TEMA_HARI[i] + ' unik ') + TEMA_HARI[i] })),
    (payload) => payload.slots.map((sl) => { const i = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].indexOf(sl.tanggal); return { ...itemHari(sl.tanggal, i, i === 2 ? 'Bekal fisik jalan jauh' : null), draft_caption: TEMA_HARI[i] + ' dimulai dari sini' }; })
  ], []);
  sandbox.__slots = slotPekan(); sandbox.__opsi = opsiPekan;
  const r = await run("igGeneratePlanForSlots(2026, 9, __slots, '', null, __opsi)");
  assert.strictEqual(log.panggilan.length, 2);
  assert.strictEqual(JSON.stringify(log.panggilan[1].slots.map(x => x.tanggal)), JSON.stringify(['2026-10-14', '2026-10-15']));
  assert.ok(log.panggilan[1].riwayatGaya.includes('Pasir sunyi menunggu rindu'), 'pembuka hari yang sudah jadi harus dikirim ke AI');
  assert.strictEqual(r.berhasil, 7);
});
testAsync('generate pekan: rumus rujukan "Kemarin kita bahas" di Selasa-Minggu tidak membuat hari-hari itu saling menolak', async () => {
  const log = siapkanGenPekan([(payload) => payload.slots.map((sl, i) => ({ ...itemHari(sl.tanggal, i, null), draft_caption: (i === 0 ? 'Pembuka senin ' : 'Kemarin kita bahas ') + TEMA_HARI[i] }))], []);
  sandbox.__slots = slotPekan(); sandbox.__opsi = opsiPekan;
  const r = await run("igGeneratePlanForSlots(2026, 9, __slots, '', null, __opsi)");
  assert.strictEqual(log.panggilan.length, 1); assert.strictEqual(r.berhasil, 7);
});

console.log('\n=== TEST: igSeleksiPekan (hari yang ditolak menyeret hanya hari sesudahnya) ===');
const seleksi = (tgls, ditolak) => {
  const dicoba = [];
  const hasil = run('igSeleksiPekan')(tgls.map(t => ({ tanggal: t })), sl => { dicoba.push(sl.tanggal); return ditolak.includes(sl.tanggal) ? null : { tanggal: sl.tanggal }; });
  return { diterima: hasil.map(x => x.tanggal), dicoba };
};
test('tidak ada yang ditolak -> semua diterima', () => {
  assert.strictEqual(seleksi(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'], []).diterima.length, 7);
});
test('N ditolak -> N dan N+1 diulang; N+1 tidak dicoba (tidak masuk riwayat); N+2 tetap dinilai sendiri', () => {
  const r = seleksi(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'], ['2026-10-14']);
  assert.strictEqual(JSON.stringify(r.diterima), JSON.stringify(['2026-10-12', '2026-10-13', '2026-10-16', '2026-10-17', '2026-10-18']));
  assert.ok(!r.dicoba.includes('2026-10-15'));
  assert.ok(r.dicoba.includes('2026-10-16'));
});
test('N ditolak dan N+1 memang ikut diulang -> N+2 dinilai sendiri (aturan sama dengan kasus N tunggal)', () => {
  const r = seleksi(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'], ['2026-10-13']);
  assert.strictEqual(JSON.stringify(r.diterima), JSON.stringify(['2026-10-12', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']));
});
test('Minggu ditolak -> tidak ada hari sesudahnya; Senin ditolak -> Selasa ikut', () => {
  assert.strictEqual(seleksi(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'], ['2026-10-18']).diterima.length, 6);
  assert.strictEqual(seleksi(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'], ['2026-10-12']).diterima.includes('2026-10-13'), false);
});
test('slot tidak berurutan (hari di antaranya sudah terisi) -> penolakan tidak menyeret slot yang tidak bersebelahan', () => {
  const r = seleksi(['2026-10-12', '2026-10-14', '2026-10-15'], ['2026-10-12']);
  assert.strictEqual(JSON.stringify(r.diterima), JSON.stringify(['2026-10-14', '2026-10-15']));
});
testAsync('regen satu hari: payload ke AI memuat riwayatGaya', async () => {
  const log = siapkanMock({ balasan: [ideBaru] });
  await T.igRegenerasiHariPlan('sel');
  assert.ok(typeof log.panggilan[0].riwayatGaya === 'string' && log.panggilan[0].riwayatGaya.includes('Caption contoh.'));
});

// ---- #6: jeda topik 6 bulan (sesuai pola-konten.md), riwayat tidak memblokir selamanya ----
console.log('\n=== TEST: jendela jeda topik 6 bulan ===');
const dupAda = (entri, item, abaikan) => { const r = []; entri.forEach(([tgl, tema, hook]) => run('igRiwayatAdd')(r, tema, hook || '', tgl)); return run('igIsDuplicateIdea')(item, r, abaikan); };
const itemTawaf = { tanggal: '2026-10-13', tema: 'Kesalahan umum tawaf', teks_gambar: 'x' };
test('batas jendela: 12 Okt 2026 - 6 bulan = 12 Apr 2026; akhir bulan dijepit (31 Agu -> 28 Feb)', () => {
  assert.strictEqual(run('igBatasRiwayat')('2026-10-12'), '2026-04-12');
  assert.strictEqual(run('igBatasRiwayat')('2026-08-31'), '2026-02-28');
  assert.strictEqual(run('igBatasRiwayat')('2026-12-31'), '2026-06-30');
});
test('topik yang sama 5 bulan lalu -> masih memblokir', () => {
  assert.strictEqual(dupAda([['2026-05-20', 'Kesalahan umum thawaf']], itemTawaf), true);
});
test('topik yang sama 7 bulan lalu -> boleh kembali (sudut baru)', () => {
  assert.strictEqual(dupAda([['2026-03-01', 'Kesalahan umum thawaf']], itemTawaf), false);
});
test('entri tanpa tanggal (baru ditolak di proses ini) selalu memblokir', () => {
  assert.strictEqual(dupAda([['', 'Kesalahan umum thawaf']], itemTawaf), true);
});
test('entri di masa depan (rencana pekan mendatang) tetap memblokir', () => {
  assert.strictEqual(dupAda([['2026-11-10', 'Kesalahan umum thawaf']], itemTawaf), true);
});
test('tanggal ide menentukan jendela: entri Okt 2026 sudah 7 bulan bagi ide bertanggal Mei 2027', () => {
  assert.strictEqual(dupAda([['2026-10-01', 'Kesalahan umum thawaf']], { ...itemTawaf, tanggal: '2027-05-01' }), false);
  assert.strictEqual(dupAda([['2026-10-01', 'Kesalahan umum thawaf']], { ...itemTawaf, tanggal: '2027-03-01' }), true);
});
test('igRiwayatToText: hanya yang di dalam jendela, tanpa-tanggal dulu, lalu terbaru ke terlama', () => {
  const r = [];
  [['2025-01-01', 'Tua sekali'], ['2026-03-01', 'Tujuh bulan'], ['2026-06-01', 'Empat bulan'], ['2026-09-20', 'Baru sekali'], ['', 'Baru ditolak']].forEach(([tgl, tm]) => run('igRiwayatAdd')(r, tm, '', tgl));
  assert.strictEqual(run('igRiwayatToText')(r, '2026-10-12'), '- Baru ditolak\n- Baru sekali\n- Empat bulan');
});
test('igRiwayatToText: tema yang baru ditolak tidak terpotong batas 200 baris', () => {
  const r = [];
  for (let i = 0; i < 250; i++) run('igRiwayatAdd')(r, 'Topik nomor ' + i, '', `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`);
  run('igRiwayatAdd')(r, 'Tema yang baru ditolak', '', '');
  const baris = run('igRiwayatToText')(r, '2026-10-12').split('\n');
  assert.strictEqual(baris.length, 200);
  assert.strictEqual(baris[0], '- Tema yang baru ditolak');
});
testAsync('generate pekan: tema serupa dari >6 bulan lalu tidak menolak Senin (1 panggilan saja)', async () => {
  const log = siapkanGenPekan([balasSemua(0)], [{ ...planLama[0], tanggal: '2026-03-01' }]);
  sandbox.__slots = slotPekan(); sandbox.__opsi = opsiPekan;
  const r = await run("igGeneratePlanForSlots(2026, 9, __slots, '', null, __opsi)");
  assert.strictEqual(log.panggilan.length, 1); assert.strictEqual(r.berhasil, 7);
  assert.ok(!log.panggilan[0].riwayatTema.includes('Kerinduan ladang pasir sunyi'), 'riwayat >6 bulan tidak dikirim ke AI');
});

// ============================================================
// PERBAIKAN OKT 2026: tag [cek pembimbing] di dedup + riwayat topik awal sebagai data
// ============================================================
console.log('\n=== TEST: tag pembimbing di dedup & riwayat topik awal ===');
const sama = (a, b) => run('igIsSimilarText')(a, b);
// Riwayat/plan global dikosongkan selama tes lalu dipulihkan, supaya hasil tidak bergantung tes lain.
const denganDataBersih = fn => { sandbox.__sv = run('[igContentPlan, igPosts]'); run('igContentPlan = []; igPosts = [];'); try { return fn(); } finally { run('igContentPlan = __sv[0]; igPosts = __sv[1];'); } };
test('tag [cek pembimbing] tidak membuat dua judul pendek yang berbeda terbaca kembar (regresi)', () => {
  assert.strictEqual(sama('Doa di Multazam [cek pembimbing]', 'Doa saat thawaf [cek pembimbing]'), false);
  assert.strictEqual(sama('Makna Sa\'i [cek pembimbing]', 'Makna Talbiyah [cek pembimbing]'), false);
});
test('judul yang sama tetap kembar walau salah satunya bertanda', () => {
  assert.strictEqual(sama('Larangan Ihram [cek pembimbing]', 'Larangan Ihram'), true);
});
test('IG_RIWAYAT_AWAL: pemetaan alur menunjuk tema yang benar-benar ada di IG_TEMA_ALUR (9 tema)', () => {
  assert.strictEqual(ALUR_TERBLOKIR.size, 9);
  assert.ok([...ALUR_TERBLOKIR].every(a => T.IG_TEMA_ALUR.includes(a)), 'ada nama alur salah ketik');
});
test('riwayat awal ikut igBuildRiwayat: ide "larangan ihram" kembar sampai 11 Apr 2027, boleh lagi 12 Apr 2027', () => {
  denganDataBersih(() => {
    const r = run('igBuildRiwayat')();
    assert.ok(r.some(x => x.tema === 'Larangan ihram' && x.tgl === '2026-10-11'));
    const dup = tgl => run('igIsDuplicateIdea')({ tema: 'Larangan ihram untuk jamaah wanita', teks_gambar: '', tanggal: tgl }, r);
    assert.strictEqual(dup('2026-11-03'), true);
    assert.strictEqual(dup('2027-04-11'), true);
    assert.strictEqual(dup('2027-04-12'), false);
  });
});
test('riwayat awal masuk teks riwayat yang dikirim ke AI selama masih dalam jeda', () => {
  denganDataBersih(() => {
    const r = run('igBuildRiwayat')();
    assert.ok(run('igRiwayatToText')(r, '2026-11-02').includes('- Larangan ihram'));
    assert.ok(!run('igRiwayatToText')(r, '2027-04-12').includes('- Larangan ihram'));
  });
});
test('saran Tema Minggu melewati tema alur yang bentrok dengan riwayat awal', () => {
  const k = T.igKandidatTemaMinggu('2026-11-02', [], T.IG_TEMA_ALUR.length);
  assert.ok(k.length > 20);
  assert.ok(k.every(x => !ALUR_TERBLOKIR.has(x.tema)), 'saran memuat: ' + k.filter(x => ALUR_TERBLOKIR.has(x.tema)).map(x => x.tema));
  assert.ok(k.some(x => x.tema === 'Umroh Pertama Kali'), '"Umroh Pertama Kali" bukan duplikat "Pertama kali lihat Ka\'bah"');
});
test('jeda berakhir: 12 Apr 2027 tema alur itu boleh disarankan lagi, 5 Apr 2027 belum', () => {
  assert.ok(T.igKandidatTemaMinggu('2027-04-12', [], T.IG_TEMA_ALUR.length).some(x => x.tema === 'Larangan Ihram'));
  assert.ok(!T.igKandidatTemaMinggu('2027-04-05', [], T.IG_TEMA_ALUR.length).some(x => x.tema === 'Larangan Ihram'));
});

// ============================================================
// TES RENCANA SETAHUN (AI): saran utama dari rencana tersimpan, status "Rencana AI", alur susun lewat AI
// ============================================================
console.log('\n=== TEST: Rencana Setahun (tersimpan, disusun AI) ===');
const rn = (senin, tema, extra) => ({ id: 'r-' + senin, senin, tema, alasan: 'alasan uji', fokus_program: '', sumber: 'ai', terkunci: false, ...(extra || {}) });
test('pekan yang punya rencana setahun: tema rencana jadi saran UTAMA, saran otomatis jadi cadangan', () => {
  const k = T.igKandidatTemaMinggu('2026-11-02', [], 3, [rn('2026-11-02', 'Umroh Bersama Orang Tua')]);
  assert.strictEqual(k[0].tema, 'Umroh Bersama Orang Tua'); assert.strictEqual(k[0].rencana, true);
  assert.ok(/Rencana setahun: alasan uji/.test(k[0].alasan)); assert.strictEqual(k.length, 3);
  assert.ok(k.slice(1).every(x => !x.rencana));
});
test('tanpa rencana (default kosong): perilaku lama tidak berubah', () => {
  const k = T.igKandidatTemaMinggu('2026-11-02', [], 1, []);
  assert.strictEqual(k[0].tema, ALUR_BEBAS[0]); assert.ok(!k[0].rencana);
});
test('tema rencana di pekan LAIN dianggap terpakai (saran otomatis tidak mengulangnya)', () => {
  const k = T.igKandidatTemaMinggu('2026-11-02', [], 1, [rn('2026-11-23', T.IG_TEMA_ALUR[0])]);
  assert.strictEqual(k[0].tema, T.IG_TEMA_ALUR[1]);
});
test('pekan yang sudah punya isi harian nyata: tema nyata menang atas rencana setahun', () => {
  const k = T.igKandidatTemaMinggu('2026-10-12', [tp('2026-10-14', 'Talbiyah')], 5, [rn('2026-10-12', 'Thawaf')]);
  assert.strictEqual(k.length, 1); assert.strictEqual(k[0].tema, 'Talbiyah');
});
test('kandidat cadangan yang kembar dengan tema rencana dibuang', () => {
  const k = T.igKandidatTemaMinggu('2026-11-02', [], 6, [rn('2026-11-02', T.IG_TEMA_ALUR[0])]);
  assert.strictEqual(k.filter(x => x.tema === T.IG_TEMA_ALUR[0]).length, 1);
  assert.strictEqual(k[0].rencana, true);
});
test('peta setahun memakai rencana tersimpan pada pekannya dan menandainya', () => {
  const peta = T.igPetaTemaSetahun('2026-10-12', [], 6, '', [rn('2026-10-26', 'Menabung Niat Bersama Keluarga', { terkunci: true })]);
  assert.strictEqual(peta[2].senin, '2026-10-26'); assert.strictEqual(peta[2].tema, 'Menabung Niat Bersama Keluarga');
  assert.strictEqual(peta[2].rencana, true); assert.strictEqual(peta[2].terkunci, true);
  assert.ok(!peta[1].rencana);
  assert.strictEqual(new Set(peta.map(r => r.tema.toLowerCase())).size, 6);
});
test('rekap: pekan mendatang dengan rencana -> status "rencana" (bukan "saran"), terkunci terbawa; tanpa rencana tetap "saran"', () => {
  const now = new Date();
  const depan = run('igSeninDari')(run('igLocalDateKey')(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14)));
  const rekap = (rencana) => run('igRkSusun')(now.getFullYear(), now.getMonth(), [], [], rencana);
  const cari = (d) => d.bulan.flatMap(b => b.minggu).find(x => x.senin === depan);
  const dengan = rekap([rn(depan, 'Tema Rencana Uji', { terkunci: true })]);
  const w = cari(dengan);
  assert.ok(w, 'pekan uji ada di rentang 12 bulan');
  assert.strictEqual(w.status, 'rencana'); assert.strictEqual(w.terkunci, true); assert.strictEqual(w.tema, 'Tema Rencana Uji');
  assert.strictEqual(dengan.ringkas.rencana, 1);
  const tanpa = cari(rekap([]));
  assert.strictEqual(tanpa.status, 'saran'); assert.strictEqual(tanpa.terkunci, false);
});

// ---- Tahap 3: panel Kesehatan Rencana + tema baru Madinah dan "umroh bersama siapa" ----
const mg = (senin, tema) => ({ senin, minggu: run('igLocalDateKey')(new Date(Number(senin.slice(0, 4)), Number(senin.slice(5, 7)) - 1, Number(senin.slice(8)) + 6)), tema });
const HARI_KES = '2026-10-19';
test('tema baru: Madinah >= 19 dan "umroh bersama siapa" >= 17, tidak ada tema kembar antar fase', () => {
  const g = id => T.IG_ALUR_GRUP.find(x => x.id === id);
  assert.ok(g('madinah').tema.length >= 19, 'madinah ' + g('madinah').tema.length);
  assert.ok(g('bersama').tema.length >= 17, 'bersama ' + g('bersama').tema.length);
  const norm = T.IG_TEMA_ALUR.map(x => x.toLowerCase());
  assert.strictEqual(new Set(norm).size, norm.length);
});
test('tema baru tidak kembar (kemiripan kata >= 75%) dengan tema lain di fase yang sama', () => {
  const sim = run('igIsSimilarText');
  T.IG_ALUR_GRUP.forEach(g => g.tema.forEach((a, i) => g.tema.forEach((b, j) => {
    if (i < j) assert.ok(!sim(a, b), `mirip: "${a}" ~ "${b}"`);
  })));
});
test('tema alur tidak dianggap kembar dengan tema musiman (supaya tidak salah masuk fase)', () => {
  const sim = run('igIsSimilarText');
  T.IG_TEMA_ALUR.forEach(a => T.IG_TEMA_MUSIM.forEach(m => assert.ok(!sim(a, m.tema), `alur "${a}" mirip musiman "${m.tema}"`)));
});
test('IG_TEMA_PRAKTIS: setiap entri benar-benar ada di bank alur (tidak salah ketik)', () => {
  const semua = new Set(T.IG_TEMA_ALUR.map(x => x.toLowerCase()));
  [...T.IG_TEMA_PRAKTIS].forEach(x => assert.ok(semua.has(x), 'tidak ada di bank: ' + x));
});
test('igJenisTema: praktis, hati, musiman penjualan = praktis, musiman biasa = hati, ketikan sendiri = lain', () => {
  assert.strictEqual(T.igJenisTema('Dokumen dan Administrasi'), 'praktis');
  assert.strictEqual(T.igJenisTema('Pertama Melihat Kabah'), 'hati');
  assert.strictEqual(T.igJenisTema('Rencanakan Umroh di Bulan Ramadhan'), 'praktis');
  assert.strictEqual(T.igJenisTema('Menyambut Ramadhan'), 'hati');
  assert.strictEqual(T.igJenisTema('xq zv'), 'lain');
  assert.strictEqual(T.igJenisTema(''), 'lain');
});
test('kesehatan: peta 52 pekan bank sekarang -> semua fase tayang, tidak ada fase hilang/berlebih, stok tidak menipis', () => {
  const peta = T.igPetaTemaSetahun('2026-10-19', [], 52);
  const k = T.igRtKesehatan(peta, HARI_KES);
  assert.strictEqual(k.pekan, 52);
  k.fase.forEach(f => {
    assert.ok(f.jumlah > 0, 'fase tidak tayang: ' + f.id);
    assert.ok(!f.tanda.includes('absen'), 'absen: ' + f.id + ' ' + f.tanda);
    assert.ok(!f.tanda.includes('stok-menipis') && !f.tanda.includes('stok-kurang'), f.id + ' stok ' + f.stok + '/' + f.perlu);
  });
  assert.strictEqual(k.alurN + k.musimN + k.lainN, 52);
});
test('kesehatan: rasio hati-praktis dari peta setahun masuk batas sehat', () => {
  const k = T.igRtKesehatan(T.igPetaTemaSetahun('2026-10-19', [], 52), HARI_KES);
  assert.ok(k.hati + k.praktis > 20);
  assert.ok(k.hatiPersen >= T.IG_RASIO_HATI[0] * 100 && k.hatiPersen <= T.IG_RASIO_HATI[1] * 100, 'hati ' + k.hatiPersen + '%');
  assert.strictEqual(k.rasio, 'seimbang');
});
test('kesehatan: hanya satu fase 20 pekan beruntun -> fase lain ditandai hilang, fase itu berlebih', () => {
  const siap = T.IG_ALUR_GRUP[0].tema;
  const minggu = seninList(HARI_KES, 20).map((s, i) => mg(s, siap[i % siap.length]));
  const k = T.igRtKesehatan(minggu, HARI_KES);
  assert.ok(k.fase[0].tanda.includes('berlebih'));
  [1, 2, 3, 4].forEach(i => assert.ok(k.fase[i].tanda.includes('absen'), k.fase[i].id));
  assert.ok(k.catatan.some(c => /Madinah/.test(c) && /tidak tayang/.test(c)));
});
test('kesehatan: semua tema hati -> "hati-dominan"; semua praktis -> "praktis-dominan"; sangat sedikit -> tidak divonis', () => {
  const hati = ['Niat dan Panggilan', 'Restu dan Doa Keluarga', 'Pertama Melihat Kabah', 'Raudhah', 'Rindu Tanah Suci', 'Kebersamaan Rombongan', 'Ikhlas dalam Ibadah', 'Bersyukur atas Kesempatan'];
  const prak = ['Dokumen dan Administrasi', 'Perlengkapan Perjalanan', 'Persiapan Fisik', 'Miqat dan Ihram', 'Thawaf', 'Tahallul', 'Menjaga Kesehatan', 'Belajar Manasik'];
  const dari = list => seninList(HARI_KES, list.length).map((s, i) => mg(s, list[i]));
  assert.strictEqual(T.igRtKesehatan(dari(hati), HARI_KES).rasio, 'hati-dominan');
  assert.strictEqual(T.igRtKesehatan(dari(prak), HARI_KES).rasio, 'praktis-dominan');
  assert.strictEqual(T.igRtKesehatan(dari(hati.slice(0, 3)), HARI_KES).rasio, 'sedikit');
  assert.strictEqual(T.igRtKesehatan([], HARI_KES).rasio, 'kosong');
});
test('kesehatan: pekan yang sudah lewat tidak dihitung; rentang pendek (<12 pekan) tidak memvonis fase hilang', () => {
  const lama = [mg('2026-01-05', 'Niat dan Panggilan')];
  const k = T.igRtKesehatan(lama.concat(seninList(HARI_KES, 6).map(s => mg(s, 'Thawaf'))), HARI_KES);
  assert.strictEqual(k.pekan, 6);
  assert.ok(k.fase.every(f => !f.tanda.includes('absen')));
});
test('kesehatan: stok menipis terdeteksi untuk bank kecil (simulasi bank lama: Madinah 11, bersama 9 tema)', () => {
  const g = T.IG_ALUR_GRUP;
  const asli = [g[2].tema, g[3].tema]; const lama = [g[2].tema.slice(0, 11), g[3].tema.slice(0, 9)];
  try {
    g[2].tema = lama[0]; g[3].tema = lama[1];
    const k = T.igRtKesehatan(seninList(HARI_KES, 52).map(s => mg(s, 'Thawaf')), HARI_KES);
    assert.ok(k.fase[3].tanda.some(t => /^stok-/.test(t)), 'bersama 9 tema harus ditandai: ' + k.fase[3].rasioStok);
    assert.ok(k.catatan.some(c => /Umroh bersama siapa/.test(c) && /menipis|kurang/.test(c)));
  } finally { g[2].tema = asli[0]; g[3].tema = asli[1]; }
});
test('rekap markdown memuat bagian Kesehatan rencana', () => {
  run("igContentPlan = []; igRkProgram = []; igRencanaTahun = []; { const n = new Date(); igRkData = igRkSusun(n.getFullYear(), n.getMonth(), [], []); }");
  const md = run('igRkMarkdown')();
  assert.ok(/## Kesehatan rencana/.test(md));
  assert.ok(/Hati \d+ pekan, praktis \d+ pekan/.test(md));
});
test('panel kesehatan: render HTML tanpa error dan memuat semua fase', () => {
  run("igContentPlan = []; igRkProgram = []; igRencanaTahun = []; igKesBuka = null; { const n = new Date(); igRkData = igRkSusun(n.getFullYear(), n.getMonth(), [], []); }");
  const html = run('igRkKesehatanHtml')();
  assert.ok(/Kesehatan rencana/.test(html));
  T.IG_ALUR_GRUP.forEach(g => assert.ok(html.includes(g.label), g.label));
  assert.ok(/Hati dan praktis/.test(html));
});

test('promosi program otomatis: prompt klien menyebut blok FASE PROMOSI, hari praktis, dan tidak lagi mengabaikan konteks program tanpa arahan', () => {
  const p = T.IG_PLAN_PROMPT_SISTEM;
  assert.ok(/FASE PROMOSI PROGRAM PEKAN INI/.test(p));
  assert.ok(/Selasa, Rabu, atau Jumat/.test(p));
  assert.ok(!/hanya dipakai kalau ARAHAN/.test(p));
  const src = fs.readFileSync(APP_PATH, 'utf8');
  assert.ok(!/hanya dipakai kalau ARAHAN TAMBAHAN meminta info program/.test(src), 'label konteks program lama masih ada');
  assert.ok(/promosi aktif tanpa perlu arahan: sisipkan 1-2 hari praktis/.test(src));
});
// ---- Alur susun lewat AI (igRtSusunAI) dengan function & Supabase tiruan ----
let rtCounter = 0;
const temaUnik = () => { rtCounter++; return `xa${rtCounter}k xb${rtCounter}k`; };
function siapkanRt(opsi) {
  opsi = opsi || {};
  const log = { panggilan: [], upsert: [], toast: [] };
  sandbox.__g = log; sandbox.__plans = opsi.plans || []; sandbox.__ren = opsi.rencana || [];
  sandbox.__ai = opsi.ai || ((payload) => payload.pekan.map(w => ({ senin: w.senin, tema: temaUnik(), alasan: 'alasan', fokus_program: '' })));
  sandbox.__ready = opsi.ready !== false;
  run(`
    adminLoggedIn = true; currentRole = 'admin'; igRtBusy = false;
    canManageProgramData = () => adminLoggedIn && (currentRole === 'admin' || currentRole === 'user'); // pulihkan guard asli (tes lain men-stub-nya)
    igContentPlan = __plans; igRencanaTahun = __ren.slice(); igRencanaReady = __ready;
    { const n = new Date(); igRkData = igRkSusun(n.getFullYear(), n.getMonth(), igContentPlan, []); }
    igRkRender = () => {}; igRtRenderPanel = () => {}; igRtStatus = () => {}; loadIgRencanaTahun = async () => {};
    buildIgPlanProgramContext = async () => 'PROGRAM CONTOH';
    igRtPanggilAI = async (payload) => { __g.panggilan.push(payload); return { items: __ai(payload, __g.panggilan.length), versi: 1 }; };
    supabaseClient = { from: () => ({ upsert: async (rows) => { __g.upsert.push(...[].concat(rows)); return { error: null }; } }) };
    showToast = (msg, type) => { __g.toast.push({ msg, type }); };
  `);
  return log;
}
testAsync('rencana setahun: semua pekan target disimpan (sumber ai, tidak terkunci), dikirim per batch 26 pekan', async () => {
  const log = siapkanRt();
  const target = run('igRtHitungTarget()');
  assert.ok(target.length > 26, 'rentang 12 bulan harus > 26 pekan target');
  await run('igRtSusunAI()');
  assert.strictEqual(log.panggilan.length, Math.ceil(target.length / 26));
  assert.ok(log.panggilan.every(c => c.pekan.length <= 26));
  assert.strictEqual(log.upsert.length, target.length);
  assert.ok(log.upsert.every(r => r.sumber === 'ai' && r.terkunci === false && /^\d{4}-\d{2}-\d{2}$/.test(r.senin) && r.tema));
  assert.strictEqual(JSON.stringify(log.upsert.map(r => r.senin).sort()), JSON.stringify(target.map(w => w.senin).sort()));
  const c0 = log.panggilan[0];
  assert.strictEqual(c0.konteksProgram, 'PROGRAM CONTOH'); assert.ok(c0.bankAlur.length > 20); assert.ok(/Ramadhan/.test(c0.bankMusim));
  assert.ok(c0.pekan[0].masehi && 'hijri' in c0.pekan[0] && 'program' in c0.pekan[0]);
});
testAsync('rencana setahun: pekan terkunci tidak ikut dikirim/ditimpa, tapi temanya jadi riwayat & konteks sekitar', async () => {
  const hariIni = run("igLocalDateKey(new Date())");
  const awal = siapkanRt();
  const kunciSenin = run('igRtHitungTarget()')[3].senin;
  const log = siapkanRt({ rencana: [rn(kunciSenin, 'Tema Terkunci Uji', { terkunci: true })] });
  const sebelum = run('igRtHitungTarget()').length;
  await run('igRtSusunAI()');
  assert.ok(!log.upsert.some(r => r.senin === kunciSenin), 'pekan terkunci tidak boleh ditimpa');
  assert.ok(!log.panggilan.some(c => c.pekan.some(w => w.senin === kunciSenin)));
  assert.ok(log.panggilan[0].riwayatTema.includes('Tema Terkunci Uji')); assert.ok(log.panggilan[0].konteksSekitar.includes(kunciSenin + ' | Tema Terkunci Uji'));
  assert.strictEqual(log.upsert.length, sebelum); assert.ok(hariIni && awal);
});
testAsync('rencana setahun: tema AI yang mirip riwayat ditolak lalu HANYA pekan itu diulang', async () => {
  let ronde = 0;
  const log = siapkanRt({
    plans: [{ id: 'x', tanggal: '2026-01-05', tema: 'a', status: 'idea', tema_minggu: 'Persiapan Fisik' }],
    ai: (payload) => payload.pekan.map((w, i) => {
      ronde++;
      const mirip = payload.pekan.length > 5 && i === 0 && ronde <= payload.pekan.length;
      return { senin: w.senin, tema: mirip ? 'Persiapan Fisik Jamaah' : temaUnik(), alasan: 'a', fokus_program: '' };
    })
  });
  await run('igRtSusunAI()');
  const target = log.panggilan[0].pekan[0].senin;
  assert.ok(log.panggilan.length >= 2);
  const ulang = log.panggilan.find((c, i) => i > 0 && c.pekan.length === 1 && c.pekan[0].senin === target);
  assert.ok(ulang, 'pekan yang ditolak diulang sendirian');
  assert.ok(ulang.riwayatTema.includes('Persiapan Fisik Jamaah'), 'tema yang ditolak ikut riwayat supaya tidak diajukan lagi');
  assert.ok(log.upsert.some(r => r.senin === target) && !log.upsert.some(r => r.tema === 'Persiapan Fisik Jamaah'));
});
testAsync('rencana setahun: dua pekan musiman berurutan -> pekan kedua ditolak, diulang dengan arahan WAJIB alur, temanya tidak diblokir selamanya', async () => {
  const log = siapkanRt({
    ai: (payload, nomor) => payload.pekan.map((w, i) => {
      const musim = nomor === 1 && i < 2;
      return { senin: w.senin, tema: musim ? ['Umroh di Libur Sekolah', 'Bersiap Menyambut Musim Haji'][i] : temaUnik(), alasan: 'a', fokus_program: '' };
    })
  });
  await run('igRtSusunAI()');
  const [p0, p1] = log.panggilan[0].pekan;
  const ulang = log.panggilan.find((c, i) => i > 0 && c.pekan.length === 1 && c.pekan[0].senin === p1.senin);
  assert.ok(ulang, 'pekan kedua diulang sendirian');
  assert.ok(ulang.arahan.includes('WAJIB bertema alur') && ulang.arahan.includes(p1.senin), ulang.arahan);
  assert.ok(!ulang.riwayatTema.includes('Bersiap Menyambut Musim Haji'), 'ditolak karena jeda, bukan karena mirip: tidak masuk riwayat');
  const urut = [...log.upsert].sort((a, b) => a.senin.localeCompare(b.senin));
  const r0 = urut.find(r => r.senin === p0.senin), r1 = urut.find(r => r.senin === p1.senin);
  assert.strictEqual(r0.tema, 'Umroh di Libur Sekolah');
  assert.ok(r1 && r1.tema !== 'Bersiap Menyambut Musim Haji' && !T.igTemaMusiman(r1.tema));
});
testAsync('rencana setahun: tabel belum ada (migrasi belum jalan) -> tidak memanggil AI sama sekali', async () => {
  const log = siapkanRt({ ready: false });
  await run('igRtSusunAI()');
  assert.strictEqual(log.panggilan.length, 0); assert.strictEqual(log.upsert.length, 0);
  assert.ok(log.toast.some(t => t.type === 'error' && /tambah_ig_rencana_tahunan/.test(t.msg)));
});
testAsync('rencana setahun: AI gagal di batch kedua -> batch pertama tetap tersimpan, pesan error muncul', async () => {
  const log = siapkanRt({ ai: (payload, n) => { if (n >= 2) throw new Error('Gemini overload'); return payload.pekan.map(w => ({ senin: w.senin, tema: temaUnik(), alasan: 'a', fokus_program: '' })); } });
  await run('igRtSusunAI()');
  assert.strictEqual(log.upsert.length, 26);
  assert.ok(log.toast.some(t => t.type === 'error' && /Gemini overload/.test(t.msg)));
  assert.strictEqual(run('igRtBusy'), false);
});
testAsync('rencana setahun: tema alur yang bentrok riwayat awal tidak masuk bankAlur, topiknya masuk riwayatTema', async () => {
  const log = siapkanRt();
  // Pasti aktif di tes ini (tanggal mesin tes bisa di luar jendela jeda): stub, lalu pulihkan.
  run('globalThis.__awalAsli = igRiwayatAwalAktif; igRiwayatAwalAktif = () => IG_RIWAYAT_AWAL;');
  try { await run('igRtSusunAI()'); } finally { run('igRiwayatAwalAktif = globalThis.__awalAsli;'); }
  const c0 = log.panggilan[0];
  assert.ok(c0.bankAlur.length > 20 && c0.bankAlur.length === T.IG_TEMA_ALUR.length - ALUR_TERBLOKIR.size);
  assert.ok(c0.bankAlur.every(a => !ALUR_TERBLOKIR.has(a)));
  assert.ok(c0.riwayatTema.split('\n').includes('Larangan ihram'));
});
testAsync('rencana setahun: tanpa izin (guest) -> tidak ada panggilan', async () => {
  const log = siapkanRt();
  run("currentRole = 'guest'");
  await run('igRtSusunAI()');
  assert.strictEqual(log.panggilan.length, 0);
  run("currentRole = 'admin'");
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
