// Tes tingkat-handler untuk edge function generate-ig-content-plan (tanpa Deno, tanpa jaringan).
// Jalankan:  node --experimental-strip-types supabase/functions/generate-ig-content-plan/test-core.mjs   (Node >= 22.6)
// Cara kerja: index.ts dimuat apa adanya (hanya import createClient & Deno.serve diganti shim), lalu handler dipanggil
// dengan Request tiruan; fetch ke Gemini ditangkap supaya isi permintaan & pasca-prosesnya bisa diperiksa.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 6)) { console.log('SKIP: butuh Node >= 22.6 (--experimental-strip-types)'); process.exit(0); }

const dir = path.dirname(fileURLToPath(import.meta.url));
let src = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
src = src.replace(/^import \{ createClient \}.*$/m, 'const createClient = (...a) => globalThis.__createClient(...a);')
         .replace(/^Deno\.serve\(/m, 'globalThis.__handler = (');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'igplan-')), 'index.mts');
fs.writeFileSync(tmp, src);

const env = { GEMINI_API_KEY: 'KUNCI-RAHASIA', SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 's' };
globalThis.Deno = { env: { get: k => env[k] } };
globalThis.__createClient = () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { dashboard_role: 'admin' } }) }) }) }),
});
await import(pathToFileURL(tmp).href);
const handler = globalThis.__handler;

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

// ---- helper ----
const kalimat = 'Bayangin kamu berdiri di sana, pelan-pelan dada terasa lapang dan semua beban hilang. ';
const captionOk = (akhir = '') => (kalimat.repeat(8).trim() + '\n\nChat WA aja ya.') + akhir;
const slot = { tanggal: '2026-10-12', hari: 'Senin', pilar: 'storytelling', tipe_konten: 'image' };
const item = (o = {}) => ({ tanggal: '2026-10-12', tema: 'Subuh sunyi di Madinah', tipe_konten: 'image', pilar: 'storytelling', teks_gambar: 'Pernah merinding?\nCoba rasakan', draft_caption: captionOk(), ...o });
const body = (o = {}) => ({ bulanLabel: 'Oktober 2026', jumlahPost: 1, tanggalMulai: '2026-10-12', tanggalAkhir: '2026-10-18', slots: [slot], ...o });

async function panggil(items, reqBody, envUbah = {}) {
  const calls = [];
  Object.assign(env, envUbah);
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), headers: opts.headers, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(items) }] } }] }), text: async () => '' };
  };
  const res = await handler(new Request('http://x/fn', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) }));
  for (const k of Object.keys(envUbah)) delete env[k];
  return { res, json: await res.json(), calls };
}
const jumlahTag = c => (c.match(/#[\p{L}\p{N}_]+/gu) || []).length;

console.log('\n=== TEST: permintaan ke Gemini ===');
await test('API key lewat header x-goog-api-key, TIDAK ada di URL', async () => {
  const { calls } = await panggil([item()], body());
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].headers['x-goog-api-key'], 'KUNCI-RAHASIA');
  assert.ok(!calls[0].url.includes('key='), calls[0].url);
  assert.ok(!calls[0].url.includes('KUNCI-RAHASIA'));
});
await test('responseSchema: array berisi 6 field wajib, enum pilar & tipe konten dikenal', async () => {
  const { calls } = await panggil([item()], body());
  const g = calls[0].body.generationConfig;
  assert.strictEqual(g.responseMimeType, 'application/json');
  assert.strictEqual(g.responseSchema.type, 'ARRAY');
  const it = g.responseSchema.items;
  assert.strictEqual(JSON.stringify(it.required), JSON.stringify(['tanggal', 'tema', 'tipe_konten', 'pilar', 'teks_gambar', 'draft_caption']));
  assert.strictEqual(JSON.stringify(it.properties.tipe_konten.enum), JSON.stringify(['image', 'carousel']));
  for (const p of ['storytelling', 'edukasi', 'manasik', 'kontemplasi']) assert.ok(it.properties.pilar.enum.includes(p), p);
  assert.ok(!it.properties.tipe_konten.enum.includes('video'));
});
await test('temperature tetap 1 (seri Gemini 3)', async () => {
  const { calls } = await panggil([item()], body());
  assert.strictEqual(calls[0].body.generationConfig.temperature, 1);
});
await test('kill switch IG_PLAN_RESPONSE_SCHEMA=off -> tanpa responseSchema, tetap JSON', async () => {
  const { calls } = await panggil([item()], body(), { IG_PLAN_RESPONSE_SCHEMA: 'off' });
  assert.strictEqual(calls[0].body.generationConfig.responseSchema, undefined);
  assert.strictEqual(calls[0].body.generationConfig.responseMimeType, 'application/json');
});
await test('riwayatGaya & riwayatTema masuk ke pesan user', async () => {
  const { calls } = await panggil([item()], body({ riwayatGaya: '- 2026-10-05 | hook: H | pembuka: P', riwayatTema: '- Niat umroh' }));
  const msg = calls[0].body.contents[0].parts[0].text;
  assert.ok(msg.includes('HOOK & PEMBUKA CAPTION 20 POSTING TERAKHIR') && msg.includes('pembuka: P'));
  assert.ok(msg.includes('RIWAYAT TEMA') && msg.includes('Niat umroh'));
});

console.log('\n=== TEST: pasca-proses & validator (#4 hashtag, #5 kejujuran) ===');
await test('hashtag selalu tepat 5 walau AI memberi 3 atau menempel di kalimat', async () => {
  for (const akhir of ['\n\n#UmrohBersamaAmiru #AmiruTour #Talbiyah', ' Aamiin. #UmrohBersamaAmiru #AmiruTour #A #B #C #D', '']) {
    const { json } = await panggil([item({ draft_caption: captionOk(akhir) })], body());
    assert.strictEqual(json.items.length, 1);
    assert.strictEqual(jumlahTag(json.items[0].draft_caption), 5, json.items[0].draft_caption.slice(-120));
    assert.ok(json.items[0].draft_caption.includes('#UmrohBersamaAmiru') && json.items[0].draft_caption.includes('#AmiruTour'));
  }
});
await test('teks Arab ditolak -> 200 dengan items kosong (bukan error 500)', async () => {
  const { res, json } = await panggil([item({ draft_caption: captionOk(' لبيك') })], body());
  assert.strictEqual(res.status, 200); assert.strictEqual(json.items.length, 0); assert.ok(json.ditolak[0].includes('Arab'));
  assert.strictEqual(json.versi, 4);
});
await test('janji berlebihan ("pasti mabrur") ditolak', async () => {
  const { json } = await panggil([item({ draft_caption: captionOk(' Insya Allah pasti mabrur.') })], body());
  assert.strictEqual(json.items.length, 0);
});
await test('caption terlalu pendek ditolak', async () => {
  const { json } = await panggil([item({ draft_caption: 'Singkat banget.' })], body());
  assert.strictEqual(json.items.length, 0); assert.ok(json.ditolak[0].includes('pendek'));
});
await test('1 item cacat tidak menggagalkan item lain', async () => {
  const slots = [slot, { ...slot, tanggal: '2026-10-13', hari: 'Selasa', pilar: 'manasik' }];
  const { json } = await panggil([item(), item({ tanggal: '2026-10-13', draft_caption: 'pendek' })], body({ jumlahPost: 2, slots }));
  assert.strictEqual(json.items.length, 1); assert.strictEqual(json.items[0].tanggal, '2026-10-12');
});
await test('tema soal doa/tata cara otomatis diberi [cek pembimbing]; tema biasa tidak', async () => {
  const a = await panggil([item({ tema: 'Doa saat thawaf' })], body());
  assert.ok(a.json.items[0].tema.endsWith('[cek pembimbing]'), a.json.items[0].tema);
  const b = await panggil([item({ tema: 'Subuh sunyi di Madinah', teks_gambar: 'Pernah merinding?', draft_caption: captionOk() })], body());
  assert.ok(!b.json.items[0].tema.includes('[cek pembimbing]'));
});
await test('slot memaksa pilar & tipe konten; carousel > 5 slide dibuang', async () => {
  const s = { ...slot, tipe_konten: 'carousel', pilar: 'edukasi' };
  const ok = await panggil([item({ tipe_konten: 'image', pilar: 'manasik', teks_gambar: 'Slide 1: a\nSlide 2: b' })], body({ slots: [s] }));
  assert.strictEqual(ok.json.items[0].tipe_konten, 'carousel'); assert.strictEqual(ok.json.items[0].pilar, 'edukasi');
  const lebih = await panggil([item({ teks_gambar: 'Slide 1: a\nSlide 6: z' })], body({ slots: [s] }));
  assert.ok(!lebih.json.items || lebih.json.items.length === 0);
});
await test('tanpa token login -> 401; method selain POST -> 405', async () => {
  const r1 = await handler(new Request('http://x/fn', { method: 'POST', body: '{}' }));
  assert.strictEqual(r1.status, 401);
  const r2 = await handler(new Request('http://x/fn', { method: 'GET', headers: { Authorization: 'Bearer t' } }));
  assert.strictEqual(r2.status, 405);
});

console.log(`\n=== HASIL: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
