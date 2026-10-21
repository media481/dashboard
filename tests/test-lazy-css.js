#!/usr/bin/env node
// Tes CSS lazy (js/app.js): ensureStyleLoaded() + ensureModuleLoaded() yang menunggu CSS,
// dan penjaga struktur: index.html TIDAK lagi me-link ig-scheduler.min.css, .ig-empty ada
// di style.css. Jalankan: node tests/test-lazy-css.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const src = read('js/app.js');

function grab(re, nama) { const m = src.match(re); if (!m) { console.error('GAGAL: ' + nama + ' tidak ditemukan di app.js'); process.exit(1); } return m[0]; }
const code = [
  grab(/function getModuleVersion\([\s\S]*?\n}\n/, 'getModuleVersion'),
  grab(/const _lazyStylePromises = \{\};\nfunction ensureStyleLoaded\([\s\S]*?\n}\n/, 'ensureStyleLoaded'),
  grab(/const _lazyModulePromises = \{\};/, '_lazyModulePromises'),
  grab(/function ensureModuleLoaded\([\s\S]*?\n}\n/, 'ensureModuleLoaded'),
].join('\n');

// DOM tiruan: <link> yang bisa kita "selesaikan"/"gagalkan" manual
function makeEnv(versions, modules) {
  const links = [], scripts = [];
  const document = {
    head: { appendChild(el) { (el.rel ? links : scripts).push(el); } },
    createElement(tag) { return { tag, remove() { this.removed = true; } }; },
    getElementById(id) { return id === 'moduleVersions' ? { textContent: JSON.stringify(versions) } : null; },
  };
  const loadScriptOnce = src => new Promise((res) => { scripts.push({ src }); res(); });
  const ctx = vm.createContext({ document, LAZY_MODULES: modules || {}, loadScriptOnce, Promise, JSON, Error, Array, Object });
  vm.runInContext(code + '\n;globalThis.ensureStyleLoaded = ensureStyleLoaded; globalThis.ensureModuleLoaded = ensureModuleLoaded;', ctx);
  return { ctx, links, scripts };
}
const tick = () => new Promise(r => setImmediate(r));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

(async () => {
  console.log('\n=== TEST: ensureStyleLoaded ===');
  await test('membuat <link> ber-versi (?v=hash) & resolve hanya SETELAH onload', async () => {
    const { ctx, links } = makeEnv({ 'css:ig-scheduler': 'abc123' });
    let done = false;
    const p = ctx.ensureStyleLoaded('ig-scheduler').then(() => { done = true; });
    await tick();
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0].href, 'css/ig-scheduler.min.css?v=abc123');
    assert.strictEqual(links[0].rel, 'stylesheet');
    assert.strictEqual(done, false, 'belum boleh resolve sebelum onload');
    links[0].onload(); await p;
    assert.strictEqual(done, true);
  });
  await test('dipanggil berkali-kali -> hanya satu <link>', async () => {
    const { ctx, links } = makeEnv({});
    const a = ctx.ensureStyleLoaded('x'), b = ctx.ensureStyleLoaded('x');
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0].href, 'css/x.min.css'); // tanpa versi -> tanpa ?v=
    links[0].onload(); await Promise.all([a, b]);
  });
  await test('gagal (onerror) -> reject, <link> dibuang, percobaan ulang membuat <link> baru', async () => {
    const { ctx, links } = makeEnv({});
    const p = ctx.ensureStyleLoaded('x');
    links[0].onerror();
    await assert.rejects(p, /css\/x/);
    assert.strictEqual(links[0].removed, true);
    const p2 = ctx.ensureStyleLoaded('x');
    assert.strictEqual(links.length, 2);
    links[1].onload(); await p2;
  });

  console.log('\n=== TEST: ensureModuleLoaded + css ===');
  await test('modul ber-css baru dianggap siap setelah skrip DAN css selesai', async () => {
    const mods = { 'ig-scheduler': { src: 'js/modules/ig-scheduler.min.js', css: ['ig-scheduler'] } };
    const { ctx, links, scripts } = makeEnv({ 'ig-scheduler': 'm1', 'css:ig-scheduler': 'c1' }, mods);
    let ready = false;
    const p = ctx.ensureModuleLoaded('ig-scheduler').then(() => { ready = true; });
    await tick();
    assert.strictEqual(scripts[0].src, 'js/modules/ig-scheduler.min.js?v=m1');
    assert.strictEqual(links[0].href, 'css/ig-scheduler.min.css?v=c1');
    assert.strictEqual(ready, false, 'skrip sudah selesai tapi css belum -> belum siap');
    links[0].onload(); await p;
    assert.strictEqual(ready, true);
  });
  await test('css gagal -> modul gagal & boleh dicoba lagi (bukan macet selamanya)', async () => {
    const mods = { m: { src: 'js/modules/m.min.js', css: ['m'] } };
    const { ctx, links } = makeEnv({}, mods);
    const p = ctx.ensureModuleLoaded('m'); await tick();
    links[0].onerror();
    await assert.rejects(p, /css\/m/);
    const p2 = ctx.ensureModuleLoaded('m'); await tick();
    assert.strictEqual(links.length, 2);
    links[1].onload(); await p2;
  });
  await test('modul tanpa css berjalan seperti sebelumnya', async () => {
    const { ctx, links, scripts } = makeEnv({}, { n: { src: 'js/modules/n.min.js' } });
    await ctx.ensureModuleLoaded('n');
    assert.strictEqual(links.length, 0); assert.strictEqual(scripts.length, 1);
  });

  console.log('\n=== TEST: penjaga struktur ===');
  await test('index.html tidak lagi me-link ig-scheduler.min.css & versinya ada di moduleVersions', () => {
    const html = read('index.html');
    assert.ok(!/<link[^>]+ig-scheduler\.min\.css/.test(html), 'link render-blocking ig-scheduler masih ada');
    const m = html.match(/<script id="moduleVersions" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(m && JSON.parse(m[1])['css:ig-scheduler'], 'css:ig-scheduler belum di-stamp (jalankan npm run release)');
  });
  await test('.ig-empty (dipakai galeri Infografis di luar halaman IG) ada di style.css', () => {
    assert.ok(/(^|\n)\.ig-empty \{/.test(read('css/style.css')));
  });
  await test('LAZY_MODULES["ig-scheduler"] mendeklarasikan css: [\'ig-scheduler\']', () => {
    assert.ok(/'ig-scheduler': \{[\s\S]{0,600}?css: \['ig-scheduler'\]/.test(src));
  });

  console.log(`\n=== HASIL: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})();
