#!/usr/bin/env node
// ============================================================
// TEST auto-generate konten IG (scripts/auto-generate-konten.mjs)
// Memuat app.js + modul ig-scheduler.js asli di vm dengan Supabase & edge function PALSU (tanpa jaringan),
// lalu memastikan jalur generate tidak bergantung pada DOM dan hasilnya benar: pekan depan terisi 7 hari,
// memakai tema Rencana Setahun, tidak menggandakan saat dijalankan ulang, dry run tidak menyimpan.
// ============================================================
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}

// ---- Supabase palsu: tabel in-memory + query builder yang bisa di-await ----
function bikinDb(awal) {
  const tabel = { ig_posts: [], ig_content_plan: [], ig_rencana_tahunan: [], programs: [], kb_jamaah: [], ...awal };
  let nextId = 1000;
  const client = {
    _tabel: tabel,
    auth: {
      signInWithPassword: async ({ email, password }) => (password === 'benar'
        ? { data: { session: { access_token: 'tok-' + email } }, error: null }
        : { data: { session: null }, error: { message: 'Invalid login credentials' } }),
      getSession: async () => ({ data: { session: { access_token: 'tok-bot@amiru.test' } } }),
    },
    from(nama) {
      const rows = tabel[nama] || (tabel[nama] = []);
      let op = 'select', payload = null, filter = [];
      const q = {
        select() { return q; }, order() { return q; }, limit() { return q; }, maybeSingle() { return q; },
        eq(k, v) { filter.push(r => r[k] === v); return q; },
        in(k, arr) { filter.push(r => arr.includes(r[k])); return q; },
        insert(r) { op = 'insert'; payload = Array.isArray(r) ? r : [r]; return q; },
        update(p) { op = 'update'; payload = p; return q; },
        then(res, rej) {
          try {
            if (op === 'insert') { payload.forEach(r => rows.push({ id: ++nextId, ...r })); return Promise.resolve({ data: payload, error: null }).then(res, rej); }
            const cocok = rows.filter(r => filter.every(f => f(r)));
            if (op === 'update') { cocok.forEach(r => Object.assign(r, payload)); return Promise.resolve({ data: cocok, error: null }).then(res, rej); }
            return Promise.resolve({ data: cocok.slice(), error: null }).then(res, rej);
          } catch (e) { return Promise.reject(e).then(res, rej); }
        },
      };
      return q;
    },
  };
  return client;
}

// ---- Edge function palsu: balas 1 ide per slot dengan topik & pembuka yang berbeda-beda ----
const TOPIK = ['kesiapan fisik berjalan jauh', 'perlengkapan koper ringan', 'adab memasuki masjid', 'suasana subuh sunyi',
  'menjaga kesehatan selama ibadah', 'kisah sahabat seperjalanan', 'renungan pulang membawa makna'];
const PEMBUKA = ['Pernahkah kamu membayangkan', 'Coba bayangkan sejenak', 'Sering terlewat oleh banyak orang', 'Ada satu hal kecil',
  'Tidak semua orang menyadari', 'Mari berhenti sebentar', 'Pada akhirnya setiap perjalanan'];
function bikinFetch(catatan) {
  return async (url, opt) => {
    catatan.push({ url: String(url), auth: opt && opt.headers && opt.headers.Authorization });
    const body = JSON.parse(opt.body);
    const items = body.slots.map((s, i) => ({
      tanggal: s.tanggal, tema: TOPIK[i % 7] + ' ' + s.tanggal.slice(8), tipe_konten: s.tipe_konten, pilar: s.pilar,
      teks_gambar: `${TOPIK[i % 7]} hari ${s.hari}`, draft_caption: `${PEMBUKA[i % 7]} tentang ${TOPIK[i % 7]}.\n\nIsi caption ke-${i}.\n\n#umroh #amiru #tips #ibadah #magetan`,
    }));
    return { ok: true, status: 200, json: async () => ({ versi: 5, items, perbaikan: 0 }) };
  };
}

(async () => {
  const mod = await import(pathToFileURL(path.resolve(__dirname, '..', 'scripts', 'auto-generate-konten.mjs')).href);
  const env = { AUTO_BOT_EMAIL: 'bot@amiru.test', AUTO_BOT_PASSWORD: 'benar' };
  const mingguMalam = new Date(2026, 9, 25, 3, 0, 0); // Minggu 25 Okt 2026, 03:00
  const senyap = () => {};

  console.log('\n=== TEST: seninBerikutnya ===');
  await test('Minggu -> Senin besok; Sabtu -> lusa; Senin -> 7 hari lagi', () => {
    const k = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    assert.strictEqual(k(mod.seninBerikutnya(new Date(2026, 9, 25))), '2026-10-26');
    assert.strictEqual(k(mod.seninBerikutnya(new Date(2026, 9, 24))), '2026-10-26');
    assert.strictEqual(k(mod.seninBerikutnya(new Date(2026, 9, 26))), '2026-11-2');
    assert.strictEqual(k(mod.seninBerikutnya(new Date(2026, 9, 28))), '2026-11-2');
  });

  console.log('\n=== TEST: jalankan (Supabase & edge function palsu) ===');
  await test('tanpa kredensial -> error jelas', async () => {
    await assert.rejects(() => mod.jalankan({ env: {}, createClient: () => bikinDb(), sekarang: mingguMalam, log: senyap }), /AUTO_BOT_EMAIL/);
  });

  await test('password salah -> error login', async () => {
    await assert.rejects(() => mod.jalankan({ env: { ...env, AUTO_BOT_PASSWORD: 'salah' }, createClient: () => bikinDb(), fetchImpl: bikinFetch([]), sekarang: mingguMalam, log: senyap }), /Login akun otomatis gagal/);
  });

  const db = bikinDb({ ig_rencana_tahunan: [{ id: 1, senin: '2026-10-26', tema: 'Persiapan Fisik', alasan: 'uji', terkunci: false }] });
  const panggilan = [];
  let hasil;
  await test('Minggu 03:00 -> 7 ide pekan 26 Okt-1 Nov tersimpan memakai tema Rencana Setahun', async () => {
    hasil = await mod.jalankan({ env, createClient: () => db, fetchImpl: bikinFetch(panggilan), sekarang: mingguMalam, log: senyap });
    assert.strictEqual(hasil.status, 'selesai', JSON.stringify(hasil));
    assert.strictEqual(hasil.senin, '2026-10-26');
    assert.strictEqual(hasil.tema, 'Persiapan Fisik');
    assert.strictEqual(hasil.berhasil, 7);
    const rows = db._tabel.ig_content_plan;
    assert.strictEqual(rows.length, 7);
    assert.deepStrictEqual(rows.map(r => r.tanggal).sort(), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    assert.ok(rows.every(r => r.status === 'idea' && r.tahap === 'ide' && r.tema_minggu === 'Persiapan Fisik' && r.draft_caption));
    assert.ok(rows.every(r => /Label gambar: Seri Persiapan Fisik · \d\/7/.test(r.teks_gambar)));
  });
  await test('edge function dipanggil dengan token sesi login (bukan anon key)', () => {
    assert.ok(panggilan.length >= 1);
    assert.ok(panggilan.every(c => /generate-ig-content-plan$/.test(c.url) && c.auth === 'Bearer tok-bot@amiru.test'));
  });

  await test('dijalankan ulang -> dilewati (tidak menggandakan ide)', async () => {
    const n = panggilan.length;
    const ulang = await mod.jalankan({ env, createClient: () => db, fetchImpl: bikinFetch(panggilan), sekarang: mingguMalam, log: senyap });
    assert.strictEqual(ulang.status, 'sudah_terisi');
    assert.strictEqual(db._tabel.ig_content_plan.length, 7);
    assert.strictEqual(panggilan.length, n);
  });

  await test('DRY_RUN=1 -> tidak memanggil AI dan tidak menyimpan', async () => {
    const dbKosong = bikinDb({ ig_rencana_tahunan: [{ id: 1, senin: '2026-10-26', tema: 'Persiapan Fisik', terkunci: false }] });
    const p = [];
    const r = await mod.jalankan({ env: { ...env, DRY_RUN: '1' }, createClient: () => dbKosong, fetchImpl: bikinFetch(p), sekarang: mingguMalam, log: senyap });
    assert.strictEqual(r.status, 'dry_run');
    assert.strictEqual(r.slot, 7);
    assert.strictEqual(p.length, 0);
    assert.strictEqual(dbKosong._tabel.ig_content_plan.length, 0);
  });

  await test('TARGET_SENIN bukan Senin -> error', async () => {
    await assert.rejects(() => mod.jalankan({ env: { ...env, TARGET_SENIN: '2026-10-27' }, createClient: () => bikinDb(), fetchImpl: bikinFetch([]), sekarang: mingguMalam, log: senyap }), /bukan hari Senin/);
  });

  console.log(`\n=== HASIL: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})();
