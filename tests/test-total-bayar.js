#!/usr/bin/env node
// Tes fetchTotalBayar() (js/app.js): paginasi 1000 baris, filter program, error.
// Fungsinya diekstrak dari app.js lalu dijalankan dengan supabaseClient tiruan,
// jadi tidak perlu memuat seluruh app.js. Jalankan: node tests/test-total-bayar.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'app.js'), 'utf8');
const m = src.match(/async function fetchTotalBayar\([\s\S]*?\n}\n/);
if (!m) { console.error('GAGAL: fetchTotalBayar tidak ditemukan di app.js'); process.exit(1); }

// Basis data tiruan: view v_total_bayar dengan N jamaah (program P1/P2 bergantian)
function makeEnv(rows, failWith) {
  const calls = [];
  const supabaseClient = {
    from(table) {
      const f = { table, eq: null, in: null, range: null };
      calls.push(f);
      const q = {
        select() { return q; },
        order() { return q; },
        eq(col, v) { f.eq = [col, v]; return q; },
        in(col, v) { f.in = [col, v]; return q; },
        range(a, b) { f.range = [a, b]; return q; },
        then(res) {
          if (failWith) return res({ data: null, error: failWith });
          let r = rows;
          if (f.eq) r = r.filter(x => x[f.eq[0]] === f.eq[1]);
          if (f.in) r = r.filter(x => f.in[1].includes(x[f.in[0]]));
          const [a, b] = f.range;
          res({ data: r.slice(a, b + 1), error: null });
        },
      };
      return q;
    },
  };
  const withRetry = async (fn) => fn();
  const ctx = vm.createContext({ supabaseClient, withRetry, Number, Array });
  vm.runInContext(m[0] + '\n;globalThis.fetchTotalBayar = fetchTotalBayar;', ctx);
  return { fetchTotalBayar: ctx.fetchTotalBayar, calls };
}

const rows = Array.from({ length: 2500 }, (_, i) => ({
  jamaah_id: 'j' + String(i).padStart(5, '0'),
  program_id: i % 2 ? 'P1' : 'P2',
  total_dibayar: String(1000 + i), // numeric bisa datang sebagai string -> harus jadi Number
}));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

(async () => {
  console.log('\n=== TEST: fetchTotalBayar ===');
  await test('2500 jamaah tanpa filter -> semua terambil (3 halaman, tidak terpotong di 1000)', async () => {
    const env = makeEnv(rows);
    const t = await env.fetchTotalBayar();
    assert.strictEqual(Object.keys(t).length, 2500);
    assert.strictEqual(env.calls.length, 3);
    assert.deepStrictEqual(env.calls.map(c => c.range), [[0, 999], [1000, 1999], [2000, 2999]]);
  });
  await test('tepat 1000 baris -> minta halaman kedua lalu berhenti', async () => {
    const env = makeEnv(rows.slice(0, 1000));
    const t = await env.fetchTotalBayar();
    assert.strictEqual(Object.keys(t).length, 1000);
    assert.strictEqual(env.calls.length, 2);
  });
  await test('nilai numeric string dikonversi ke Number', async () => {
    const t = await makeEnv(rows).fetchTotalBayar();
    assert.strictEqual(t['j00005'], 1005);
    assert.strictEqual(typeof t['j00005'], 'number');
  });
  await test('programId -> hanya jamaah program itu', async () => {
    const env = makeEnv(rows);
    const t = await env.fetchTotalBayar({ programId: 'P1' });
    assert.strictEqual(Object.keys(t).length, 1250);
    assert.deepStrictEqual(env.calls[0].eq, ['program_id', 'P1']);
  });
  await test('programIds -> memakai .in(program_id); array kosong -> {} tanpa query', async () => {
    const env = makeEnv(rows);
    const t = await env.fetchTotalBayar({ programIds: ['P2'] });
    assert.strictEqual(Object.keys(t).length, 1250);
    assert.deepStrictEqual(env.calls[0].in, ['program_id', ['P2']]);
    const env2 = makeEnv(rows);
    assert.strictEqual(JSON.stringify(await env2.fetchTotalBayar({ programIds: [] })), '{}'); // JSON: objek dari vm beda realm
    assert.strictEqual(env2.calls.length, 0);
  });
  await test('error dari Supabase -> dilempar (bukan diam-diam jadi total 0)', async () => {
    const env = makeEnv(rows, new Error('relation "v_total_bayar" does not exist'));
    await assert.rejects(() => env.fetchTotalBayar(), /v_total_bayar/);
  });
  console.log(`\n=== HASIL: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})();
