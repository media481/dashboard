#!/usr/bin/env node
// ============================================================
// TEST About Planner: bagian pola 7 hari dokumen HARUS mengikuti IG_POLA_AMIRU + IG_POLA_VARIAN di kode.
// Memuat app.js + modul ig-scheduler.js asli di vm (loader yang sama dengan auto-generate-konten), lalu memastikan
// dokumen dibangun dari pola (tidak ada penanda {{...}} tersisa) dan ikut berubah saat pola diubah.
// ============================================================
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}

(async () => {
  const { muatDashboard } = await import(pathToFileURL(path.resolve(__dirname, '..', 'scripts', 'auto-generate-konten.mjs')).href);
  const { run } = muatDashboard({ createClient: () => ({}), fetchImpl: async () => ({ ok: true, json: async () => ({}) }), log: () => {} });
  const doc = () => run('igAboutPlannerMd()');

  console.log('\n=== TEST: About Planner mengikuti pola di kode ===');

  await test('tidak ada penanda {{...}} yang tersisa', () => {
    assert.ok(!/\{\{\w+\}\}/.test(doc()), 'masih ada penanda yang belum terisi');
  });

  await test('tabel pola memuat 7 hari dengan peran, pilar, dan format dari IG_POLA_AMIRU', () => {
    const d = doc();
    const pola = JSON.parse(run('JSON.stringify(IG_URUTAN_PEKAN.map(k => { const p = IG_POLA_AMIRU[k]; return { hari: p.hari, peran: p.peran, tipe: p.tipe, pilar: igPolaPilarLabel(p.pilar) }; }))'));
    assert.strictEqual(pola.length, 7);
    pola.forEach(p => {
      const baris = d.split('\n').find(l => l.startsWith('| ' + p.hari + ' |'));
      assert.ok(baris, 'baris ' + p.hari + ' tidak ada');
      assert.ok(baris.includes(p.peran), p.hari + ': peran ' + p.peran);
      assert.ok(baris.includes(p.pilar), p.hari + ': pilar ' + p.pilar);
      assert.ok(baris.includes(p.tipe === 'carousel' ? 'Carousel' : 'Single Post'), p.hari + ': format');
    });
  });

  await test('urutan perjalanan dan keseimbangan dihitung dari pola', () => {
    const d = doc();
    assert.ok(d.includes('rasakan > pahami > siapkan > bayangkan > hindari > terinspirasi > renungkan'));
    assert.ok(d.includes('Keseimbangan: 4 hari menyentuh hati (Senin, Kamis, Sabtu, Minggu) dan 3 hari praktis (Selasa, Rabu, Jumat).'));
  });

  await test('tabel varian pekan memuat semua peran di IG_POLA_VARIAN', () => {
    const d = doc();
    const peran = JSON.parse(run('JSON.stringify(Object.values(IG_POLA_VARIAN).flatMap(j => Object.values(j).map(v => v.peran)))'));
    assert.ok(peran.length >= 7);
    peran.forEach(p => assert.ok(d.includes(p), 'peran varian ' + p + ' tidak muncul'));
    assert.ok(d.includes('Kamis, Sabtu dan Minggu tidak berubah'));
  });

  await test('mengubah peran di IG_POLA_AMIRU langsung mengubah dokumen', () => {
    const asli = run('IG_POLA_AMIRU[3].peran');
    run("IG_POLA_AMIRU[3].peran = 'PeranUjiXyz'");
    try { assert.ok(doc().includes('PeranUjiXyz')); assert.ok(doc().includes('siapkan > bayangkan') === false); }
    finally { run("IG_POLA_AMIRU[3].peran = " + JSON.stringify(asli)); }
    assert.ok(doc().includes('siapkan > bayangkan'));
  });

  await test('mengubah varian pekan langsung mengubah tabel varian', () => {
    const asli = run('IG_POLA_VARIAN.hari_besar[1].peran');
    run("IG_POLA_VARIAN.hari_besar[1].peran = 'VarianUjiXyz'");
    try { assert.ok(doc().includes('VarianUjiXyz')); }
    finally { run("IG_POLA_VARIAN.hari_besar[1].peran = " + JSON.stringify(asli)); }
  });

  await test('format carousel bercerita (v18) tertulis di dokumen: Slide 1 hook, Keterangan Slide 2 dst, caption melanjutkan', () => {
    const d = doc();
    assert.ok(d.includes('Slide 1 = hook') && d.includes('**Keterangan:**'));
    assert.ok(d.includes('titik akhir cerita slide terakhir'));
    assert.ok(/\| 18 \| 27 Oktober 2026 \|/.test(d), 'baris Riwayat Revisi 18');
  });

  await test('header Versi/Diperbarui tetap terbaca', () => {
    const m = run('igAboutPlannerMeta(igAboutPlannerMd())');
    assert.strictEqual(m.versi, '18');
    assert.ok(/Oktober 2026/.test(m.diperbarui));
  });

  console.log(`\n=== HASIL: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})();
