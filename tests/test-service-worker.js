#!/usr/bin/env node
// Tes service-worker.js: cache-first untuk aset ber-hash (?v=), network-first untuk sisanya,
// daftar aset diturunkan dari index.html, dan perapian cache lama.
// Tanpa dependency. Jalankan: node tests/test-service-worker.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createHash } = require('crypto');
const root = path.resolve(__dirname, '..');
const BASE = 'https://amiru.test/';

// ---- Lingkungan Service Worker tiruan ----
const listeners = {};
global.self = {
  addEventListener: (t, fn) => { listeners[t] = fn; },
  location: { origin: 'https://amiru.test' },
  registration: { scope: BASE },
  skipWaiting() {}, clients: { claim: async () => {} },
};
const norm = (r) => new URL(typeof r === 'string' ? r : r.url, BASE).href;
const strip = (u) => u.split('?')[0];
function makeCache() {
  const store = new Map();
  return {
    store,
    async match(req, o = {}) {
      const k = norm(req);
      for (const [u, res] of store) if (o.ignoreSearch ? strip(u) === strip(k) : u === k) return res.clone();
      return undefined;
    },
    async put(req, res) { store.set(norm(req), res.clone()); },
    async addAll(reqs) { for (const r of reqs) await this.put(r, new Response('x')); },
    async keys() { return [...store.keys()].map((u) => ({ url: u })); },
    async delete(req) { return store.delete(norm(req)); },
  };
}
const cachesMap = new Map();
global.caches = {
  async open(n) { if (!cachesMap.has(n)) cachesMap.set(n, makeCache()); return cachesMap.get(n); },
  async keys() { return [...cachesMap.keys()]; },
  async delete(n) { return cachesMap.delete(n); },
};
global.Request = class { constructor(u, o) { this.url = norm(u); Object.assign(this, o); } };
let netLog = [], netMode = 'ok', netBody = 'NET';
const basic = (body, status = 200) => { const r = new Response(body, { status }); Object.defineProperty(r, 'type', { value: 'basic' }); return r; };
global.fetch = async (req) => {
  netLog.push(norm(req));
  if (netMode === 'offline') throw new TypeError('offline');
  if (netMode === '404') return basic('nf', 404);
  return basic(netBody);
};

const sw = require(path.join(root, 'service-worker.js'));
const { isHashedAsset, extractHashedAssetUrls, cacheFirstHashed, pruneHashedAssets, ASSET_CACHE, CACHE_NAME } = sw;
const U = (p) => new URL(p, BASE);
let n = 0; const ok = (m) => console.log('  ok  ' + m); const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('isHashedAsset: hanya css/js ber-?v=<hex>', () => {
  assert(isHashedAsset(U('/js/app.min.js?v=fb14b78090')));
  assert(isHashedAsset(U('/css/style.min.css?v=b4ff0b60ef')));
  assert(isHashedAsset(U('/js/modules/nota.min.js?v=0123456789')));
  assert(!isHashedAsset(U('/js/app.min.js')));
  assert(!isHashedAsset(U('/index.html?v=fb14b78090')));
  assert(!isHashedAsset(U('/icons/icon-192.png?v=fb14b78090')));
  assert(!isHashedAsset(U('/js/app.min.js?v=xyz')));
  assert(!isHashedAsset(U('/other/app.min.js?v=fb14b78090')));
});

t('extractHashedAssetUrls: sama persis dengan file *.min.* di disk + hash cocok', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const urls = extractHashedAssetUrls(html, BASE);
  const h = (f) => createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex').slice(0, 10);
  const want = new Set(['js/app.min.js']);
  fs.readdirSync(path.join(root, 'js/modules')).filter((f) => f.endsWith('.min.js')).forEach((f) => want.add('js/modules/' + f));
  fs.readdirSync(path.join(root, 'css')).filter((f) => f.endsWith('.min.css')).forEach((f) => want.add('css/' + f));
  const expected = new Set([...want].map((f) => BASE + f + '?v=' + h(f)));
  assert.deepStrictEqual([...urls].sort(), [...expected].sort(), 'daftar aset di index.html tidak sama dengan file di disk (lupa npm run release?)');
});

t('extractHashedAssetUrls: input tak valid tidak melempar error', () => {
  assert.strictEqual(extractHashedAssetUrls('', BASE).size, 0);
  assert.strictEqual(extractHashedAssetUrls('<script id="moduleVersions" type="application/json">{rusak</script>', BASE).size, 0);
});

t('cache-first: ada di cache -> TIDAK menyentuh jaringan', async () => {
  const c = await caches.open(ASSET_CACHE); await c.put(BASE + 'js/a.min.js?v=aaaaaaaaaa', new Response('CACHED'));
  netLog = [];
  const res = await cacheFirstHashed({ url: BASE + 'js/a.min.js?v=aaaaaaaaaa' });
  assert.strictEqual(await res.text(), 'CACHED'); assert.strictEqual(netLog.length, 0);
});

t('cache-first: belum ada -> unduh sekali, simpan, berikutnya dari cache', async () => {
  netMode = 'ok'; netBody = 'FRESH'; netLog = [];
  const req = { url: BASE + 'js/b.min.js?v=bbbbbbbbbb' };
  assert.strictEqual(await (await cacheFirstHashed(req)).text(), 'FRESH');
  netBody = 'BERUBAH';
  assert.strictEqual(await (await cacheFirstHashed(req)).text(), 'FRESH');
  assert.strictEqual(netLog.length, 1);
});

t('cache-first: hash baru = URL baru -> diambil dari jaringan, bukan versi lama', async () => {
  netMode = 'ok'; netBody = 'V2'; netLog = [];
  const res = await cacheFirstHashed({ url: BASE + 'js/b.min.js?v=cccccccccc' });
  assert.strictEqual(await res.text(), 'V2'); assert.strictEqual(netLog.length, 1);
});

t('cache-first: respons 404 tidak disimpan', async () => {
  netMode = '404';
  const req = { url: BASE + 'js/hilang.min.js?v=dddddddddd' };
  const res = await cacheFirstHashed(req); assert.strictEqual(res.status, 404);
  assert.strictEqual(await (await caches.open(ASSET_CACHE)).match(req), undefined);
});

t('cache-first: offline + belum ter-cache -> pakai hash lain file yang sama, atau 503', async () => {
  netMode = 'offline';
  const c = await caches.open(ASSET_CACHE); await c.put(BASE + 'css/z.min.css?v=1111111111', new Response('LAMA'));
  assert.strictEqual(await (await cacheFirstHashed({ url: BASE + 'css/z.min.css?v=2222222222' })).text(), 'LAMA');
  assert.strictEqual((await cacheFirstHashed({ url: BASE + 'css/tak-ada.min.css?v=3333333333' })).status, 503);
  netMode = 'ok';
});

t('pruneHashedAssets: buang yang tak dirujuk; jangan buang apa pun kalau daftar kosong/kecil', async () => {
  cachesMap.delete(ASSET_CACHE);
  const c = await caches.open(ASSET_CACHE); const keep = new Set();
  for (let i = 0; i < 6; i++) { const u = BASE + 'js/k' + i + '.min.js?v=aaaaaaaaa' + i; keep.add(u); await c.put(u, new Response('k')); }
  await c.put(BASE + 'js/k0.min.js?v=0000000000', new Response('basi'));
  await pruneHashedAssets(new Set([BASE + 'x?v=aaaaaaaa']));  // terlalu kecil -> abaikan
  assert.strictEqual(c.store.size, 7);
  await pruneHashedAssets(null); assert.strictEqual(c.store.size, 7);
  await pruneHashedAssets(keep); assert.strictEqual(c.store.size, 6);
  assert(!c.store.has(BASE + 'js/k0.min.js?v=0000000000'));
});

t('handler fetch: routing cache-first vs network-first vs diabaikan', async () => {
  const run = (url, method = 'GET') => new Promise((resolve) => {
    let handled = false;
    listeners.fetch({ request: { url, method, mode: 'no-cors' }, respondWith: (p) => { handled = true; resolve(Promise.resolve(p).then(() => 'handled')); }, waitUntil: () => {} });
    if (!handled) resolve('ignored');
  });
  cachesMap.delete(ASSET_CACHE); netMode = 'ok'; netBody = 'X'; netLog = [];
  assert.strictEqual(await run(BASE + 'js/app.min.js?v=fb14b78090', 'POST'), 'ignored');
  assert.strictEqual(await run('https://xyz.supabase.co/rest/v1/programs'), 'ignored');
  assert.strictEqual(await run(BASE + 'js/app.min.js?v=fb14b78090'), 'handled');
  assert((await caches.open(ASSET_CACHE)).store.has(BASE + 'js/app.min.js?v=fb14b78090'), 'aset ber-hash masuk ASSET_CACHE');
  assert.strictEqual(await run(BASE + 'index.html'), 'handled');
  assert((await caches.open(CACHE_NAME)).store.has(BASE + 'index.html'), 'index.html tetap network-first -> masuk CACHE_NAME');
});

t('install + activate: precache aset dari index.html, buang cache lama & aset basi', async () => {
  cachesMap.clear();
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  global.fetch = async (req) => { netLog.push(norm(req)); return basic(norm(req).endsWith('index.html') ? html : 'ISI'); };
  // index.html harus sudah di shell saat install membaca daftar aset; addAll tiruan menyimpan 'x',
  // jadi taruh index.html asli lebih dulu lewat put setelah addAll -> simulasikan dengan menimpa addAll.
  const shell = await caches.open(CACHE_NAME);
  shell.addAll = async (reqs) => { for (const r of reqs) await shell.put(r, new Response(r.url.endsWith('index.html') ? html : 'x')); };
  await caches.open('amiru-repo-cache-v1'); // cache lama
  const asset = await caches.open(ASSET_CACHE); await asset.put(BASE + 'js/app.min.js?v=0000000000', new Response('basi'));
  let p; listeners.install({ waitUntil: (x) => { p = x; } }); await p;
  const want = extractHashedAssetUrls(html, BASE);
  assert.strictEqual(asset.store.size, want.size + 1);
  listeners.activate({ waitUntil: (x) => { p = x; } }); await p;
  assert(!cachesMap.has('amiru-repo-cache-v1'), 'cache lama dihapus');
  assert(cachesMap.has(ASSET_CACHE) && cachesMap.has(CACHE_NAME), 'dua cache aktif dipertahankan');
  assert.deepStrictEqual([...asset.store.keys()].sort(), [...want].sort(), 'aset basi dibuang, aset terbaru utuh');
  global.fetch = async (req) => { netLog.push(norm(req)); return basic(netBody); };
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); ok(name); n++; } catch (e) { console.error('GAGAL: ' + name + '\n', e.message); process.exit(1); }
  }
  console.log('Service worker: ' + n + ' tes lulus.');
})();
