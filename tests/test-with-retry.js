#!/usr/bin/env node
// Tes withRetry() + isTransientResult() (js/app.js): retry untuk hasil { error }
// bergaya supabase-js (yang TIDAK melempar exception), bukan hanya untuk throw.
// Jalankan: node tests/test-with-retry.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'app.js'), 'utf8');
const a = src.match(/function isTransientResult\([\s\S]*?\n}\n/);
const b = src.match(/async function withRetry\([\s\S]*?\n}\n/);
if (!a || !b) { console.error('GAGAL: withRetry/isTransientResult tidak ditemukan'); process.exit(1); }
const ctx = vm.createContext({ console: { warn() {} }, setTimeout, Number, String, Promise });
vm.runInContext(a[0] + b[0] + '\n;globalThis.withRetry = withRetry; globalThis.isTransientResult = isTransientResult;', ctx);
const { withRetry, isTransientResult } = ctx;

// fn tiruan: mengembalikan/melempar urutan hasil, menghitung panggilan
function seq(...steps) {
  let n = 0;
  const fn = async () => { const s = steps[Math.min(n++, steps.length - 1)]; if (s instanceof Error) throw s; return s; };
  fn.calls = () => n;
  return fn;
}
const OK = { data: [1], error: null, status: 200 };
const E503 = { data: null, error: { message: 'Service Unavailable' }, status: 503 };
const NET = { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 };
const RLS = { data: null, error: { message: 'permission denied', code: '42501' }, status: 403 };
const fast = { delayMs: 1 };

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

(async () => {
  console.log('\n=== TEST: isTransientResult ===');
  await test('5xx, 429, 408, status 0, "Failed to fetch" -> transient', () => {
    assert.ok(isTransientResult(E503) && isTransientResult(NET));
    assert.ok(isTransientResult({ error: { message: 'x' }, status: 429 }));
    assert.ok(isTransientResult({ error: { message: 'x' }, status: 408 }));
    assert.ok(isTransientResult({ error: { message: 'Failed to fetch' } })); // tanpa status
  });
  await test('RLS 403, 401, 404, sukses, null -> BUKAN transient', () => {
    assert.ok(!isTransientResult(RLS));
    assert.ok(!isTransientResult({ error: { message: 'JWT expired' }, status: 401 }));
    assert.ok(!isTransientResult({ error: { message: 'x' }, status: 404 }));
    assert.ok(!isTransientResult(OK) && !isTransientResult(null) && !isTransientResult(undefined));
  });
  await test('Response fetch mentah: 503 transient, 200/404 bukan', () => {
    assert.ok(isTransientResult({ ok: false, status: 503 }));
    assert.ok(!isTransientResult({ ok: true, status: 200 }));
    assert.ok(!isTransientResult({ ok: false, status: 404 }));
  });

  console.log('\n=== TEST: withRetry ===');
  await test('hasil { error } transient lalu sukses -> diulang & mengembalikan hasil sukses', async () => {
    const fn = seq(NET, E503, OK);
    const r = await withRetry(fn, fast);
    assert.strictEqual(r, OK); assert.strictEqual(fn.calls(), 3);
  });
  await test('gagal terus -> berhenti di 3 percobaan, hasil { error } terakhir dikembalikan (tidak dilempar)', async () => {
    const fn = seq(E503);
    const r = await withRetry(fn, fast);
    assert.strictEqual(r, E503); assert.strictEqual(fn.calls(), 3);
  });
  await test('error RLS/4xx -> TIDAK diulang (1 panggilan)', async () => {
    const fn = seq(RLS);
    const r = await withRetry(fn, fast);
    assert.strictEqual(r, RLS); assert.strictEqual(fn.calls(), 1);
  });
  await test('sukses langsung -> 1 panggilan', async () => {
    const fn = seq(OK);
    assert.strictEqual(await withRetry(fn, fast), OK); assert.strictEqual(fn.calls(), 1);
  });
  await test('exception: diulang lalu sukses; kalau terus melempar -> dilempar ulang', async () => {
    const fn = seq(new Error('boom'), OK);
    assert.strictEqual(await withRetry(fn, fast), OK); assert.strictEqual(fn.calls(), 2);
    const fn2 = seq(new Error('selalu gagal'));
    await assert.rejects(() => withRetry(fn2, fast), /selalu gagal/);
    assert.strictEqual(fn2.calls(), 3);
  });
  await test('retries: 0 -> tidak mengulang', async () => {
    const fn = seq(E503);
    assert.strictEqual(await withRetry(fn, { retries: 0, delayMs: 1 }), E503); assert.strictEqual(fn.calls(), 1);
  });
  await test('backoff berlipat ganda (delay 1 -> 2 ms) tanpa menunda berlebihan', async () => {
    const t0 = Date.now();
    await withRetry(seq(E503), { delayMs: 5 });  // 5 + 10 ms
    const dt = Date.now() - t0;
    assert.ok(dt >= 14 && dt < 500, 'dt=' + dt);
  });
  console.log(`\n=== HASIL: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})();
