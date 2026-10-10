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
await test('responseSchema: array berisi 8 field wajib (sudut & jembatan ditulis SEBELUM teks gambar), enum pilar & tipe konten dikenal', async () => {
  const { calls } = await panggil([item()], body());
  const g = calls[0].body.generationConfig;
  assert.strictEqual(g.responseMimeType, 'application/json');
  assert.strictEqual(g.responseSchema.type, 'ARRAY');
  const it = g.responseSchema.items;
  const urutan = ['tanggal', 'tema', 'tipe_konten', 'pilar', 'sudut', 'jembatan', 'teks_gambar', 'draft_caption'];
  assert.strictEqual(JSON.stringify(it.required), JSON.stringify(urutan));
  assert.strictEqual(JSON.stringify(it.propertyOrdering), JSON.stringify(urutan));
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
  assert.strictEqual(json.versi, 5);
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
  const ok = await panggil([item({ tipe_konten: 'image', pilar: 'manasik', teks_gambar: 'Slide 1: a\nSlide 2: b\nSlide 3: c' })], body({ slots: [s] }));
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


// ---- helper putaran berurutan: panggilan ke-n ke Gemini mengembalikan responses[n] (terakhir diulang); Error = HTTP 500 ----
async function panggilBerurutan(responses, reqBody, envUbah = {}) {
  const calls = [];
  Object.assign(env, envUbah);
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url: String(url), body, msg: body.contents[0].parts[0].text });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) return { ok: false, status: 400, json: async () => ({}), text: async () => r.message };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: typeof r === 'string' ? r : JSON.stringify(r) }] } }] }), text: async () => '' };
  };
  const res = await handler(new Request('http://x/fn', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) }));
  for (const k of Object.keys(envUbah)) delete env[k];
  return { res, json: await res.json(), calls };
}
const captionAwal = (awal, akhir = '') => `${awal}. ${kalimat.repeat(8).trim()}\n\nChat WA aja ya.${akhir}`;
const slotSel = { tanggal: '2026-10-13', hari: 'Selasa', peran: 'Pahami', pilar: 'manasik', tipe_konten: 'image' };
const itemSel = (o = {}) => item({ tanggal: '2026-10-13', pilar: 'manasik', tema: 'Kartu praktis miqat', teks_gambar: 'Dari mana mulainya?\nIni kartunya', draft_caption: captionAwal('Kemarin kita bahas rasa'), ...o });
const dua = (o = {}) => body({ jumlahPost: 2, slots: [slot, slotSel], ...o });

console.log('\n=== TEST: validator mutu (kutipan, placeholder, angka, kata kaku, format gambar) ===');
await test('kutipan/atribusi ayat atau hadis ("Rasulullah bersabda", "QS.") ditolak', async () => {
  for (const sisip of [' Rasulullah bersabda bahwa doa itu mustajab.', ' Seperti dalam QS. Al-Baqarah.', ' Allah berfirman tentang rindu.']) {
    const { json } = await panggil([item({ draft_caption: captionOk(sisip) })], body());
    assert.strictEqual(json.items.length, 0, sisip); assert.ok(json.ditolak[0].includes('ayat atau hadis'), json.ditolak[0]);
  }
});
await test('placeholder [isi ...] ditolak, [hotel]/[bulan] tetap boleh', async () => {
  const a = await panggil([item({ teks_gambar: '[isi 2-4 baris pendek]' })], body());
  assert.strictEqual(a.json.items.length, 0); assert.ok(a.json.ditolak[0].includes('placeholder'));
  const b = await panggil([item({ draft_caption: captionOk(' Berangkat [bulan], menginap di [hotel].') })], body());
  assert.strictEqual(b.json.items.length, 1);
});
await test('statistik/klaim jumlah jamaah ditolak; boleh bila ARAHAN meminta info program', async () => {
  const a = await panggil([item({ draft_caption: captionOk(' Sebanyak 98% jamaah merasa tenang.') })], body());
  assert.strictEqual(a.json.items.length, 0); assert.ok(a.json.ditolak[0].includes('statistik'));
  const b = await panggil([item({ draft_caption: captionOk(' Ribuan jamaah sudah berangkat.') })], body());
  assert.strictEqual(b.json.items.length, 0);
  const c = await panggil([item({ draft_caption: captionOk(' Sisa 12 jamaah lagi.') })], body({ arahan: 'selipkan info program Desember' }));
  assert.strictEqual(c.json.items.length, 1);
});
await test('kata kaku ala brosur ("silakan", "tersedia") ditolak', async () => {
  const { json } = await panggil([item({ draft_caption: captionOk(' Silakan daftar via WA.') })], body());
  assert.strictEqual(json.items.length, 0); assert.ok(json.ditolak[0].includes('kata kaku'));
});
await test('terasa buatan AI: pola "bukan sekadar X, tapi Y", frasa klise, >2 tanda tanya, >1 emoji ditolak', async () => {
  const kasus = [
    [' Umroh bukan sekadar perjalanan, tapi panggilan jiwa.', 'bukan sekadar'],
    [' Hatimu mencari ketenangan di relung hati.', 'relung hati'],
    [' Siap? Yakin? Beneran?', 'tanda tanya'],
    [' \u{1F54B}\u{1F64F}', 'emoji'],
  ];
  for (const [akhir, kata] of kasus) {
    const { json } = await panggil([item({ draft_caption: captionOk(akhir) })], body());
    assert.strictEqual(json.items.length, 0, akhir); assert.ok(json.ditolak[0].includes(kata), json.ditolak[0]);
  }
});
await test('tanda pisah panjang dan titik koma dibersihkan otomatis dari caption (bukan ditolak)', async () => {
  const { json } = await panggil([item({ draft_caption: captionOk(' Pelan \u2014 pelan saja; nggak usah buru-buru.') })], body());
  assert.strictEqual(json.items.length, 1);
  assert.ok(!/[\u2014\u2013;]/.test(json.items[0].draft_caption));
});
await test('format gambar: single post tanpa "Slide n:", carousel 3-5 slide berurutan, teks gambar tidak kosong', async () => {
  const s = { ...slot, tipe_konten: 'carousel', pilar: 'edukasi' };
  const kasus = [
    [slot, 'Slide 1: a\nSlide 2: b', 'single post tidak boleh'],
    [slot, '', 'kosong'],
    [s, 'Slide 1: a\nSlide 2: b', 'minimal 3'],
    [s, 'Slide 1: a\nSlide 3: b\nSlide 4: c', 'berurutan'],
    [s, 'Slide 1: a\nSlide 2-4: b\nSlide 5: c', 'rentang'],
    [s, 'tanpa format slide sama sekali', 'minimal 3'],
  ];
  for (const [sl, teks, kata] of kasus) {
    const { json } = await panggil([item({ teks_gambar: teks })], body({ slots: [sl] }));
    assert.strictEqual(json.items.length, 0, teks); assert.ok(json.ditolak[0].includes(kata), json.ditolak[0]);
  }
  const ok = await panggil([item({ teks_gambar: 'Slide 1: a\nSlide 2: b\nSlide 3: c\nSlide 4: d\nSlide 5: e' })], body({ slots: [s] }));
  assert.strictEqual(ok.json.items.length, 1);
});
await test('caption yang mengulang teks gambar persis ditolak', async () => {
  const hook = 'Koper sudah tertutup tapi hatimu belum';
  const { json } = await panggil([item({ teks_gambar: hook, draft_caption: captionAwal(hook) })], body());
  assert.strictEqual(json.items.length, 0); assert.ok(json.ditolak[0].includes('mengulang teks gambar'));
});

console.log('\n=== TEST: perbaikan terarah (hanya slot yang ditolak ditulis ulang) ===');
await test('semua lolos -> 1 panggilan saja, sudut/jembatan tidak ikut ke frontend, versi 5', async () => {
  const { json, calls } = await panggilBerurutan([[item({ sudut: 'S', jembatan: 'J', draft_caption: captionAwal('Subuh yang lengang') }), itemSel({ sudut: 'S2', jembatan: 'J2' })]], dua());
  assert.strictEqual(calls.length, 1); assert.strictEqual(json.items.length, 2); assert.strictEqual(json.perbaikan, 0); assert.strictEqual(json.versi, 5);
  for (const it of json.items) assert.ok(!('sudut' in it) && !('jembatan' in it), JSON.stringify(Object.keys(it)));
});
await test('Selasa ditolak (terlalu pendek) -> putaran perbaikan hanya untuk Selasa, membawa alasan + Senin sebagai konteks', async () => {
  const senin = item({ jembatan: 'Besok kita bahas tata caranya', draft_caption: captionAwal('Subuh yang lengang', ' Semoga hatimu lapang.') });
  const { json, calls } = await panggilBerurutan([[senin, itemSel({ draft_caption: 'pendek' })], [itemSel({ draft_caption: captionAwal('Semalam kamu bertanya soal caranya') })]], dua());
  assert.strictEqual(calls.length, 2); assert.strictEqual(json.perbaikan, 1);
  assert.strictEqual(json.items.length, 2); assert.strictEqual(json.items[1].tanggal, '2026-10-13');
  const m = calls[1].msg;
  assert.ok(m.includes('CATATAN PERBAIKAN') && m.includes('caption terlalu pendek'));
  assert.ok(m.includes('sebanyak TEPAT 1 ide post'), 'hanya 1 slot');
  assert.ok(m.includes('- 2026-10-13 (Selasa) | peran: Pahami') && !m.includes('- 2026-10-12 (Senin)'), 'daftar slot hanya Selasa');
  assert.ok(m.includes('KONTEKS PEKAN') && m.includes('Senin 2026-10-12') && m.includes('caption ditutup:') && m.includes('Semoga hatimu lapang'), 'Senin jadi penyambung');
  assert.ok(m.includes('janji ke hari berikutnya: Besok kita bahas tata caranya'));
});
await test('hasil perbaikan untuk tanggal yang sudah lolos diabaikan (tidak menimpa hari yang sudah jadi)', async () => {
  const { json } = await panggilBerurutan([
    [item({ tema: 'Senin ASLI', draft_caption: captionAwal('Subuh yang lengang') }), itemSel({ draft_caption: 'pendek' })],
    [item({ tema: 'Senin PALSU', draft_caption: captionAwal('Tengah malam yang sunyi') }), itemSel({ draft_caption: captionAwal('Semalam kamu bertanya') })],
  ], dua());
  assert.strictEqual(json.items.length, 2); assert.strictEqual(json.items[0].tema.replace(' [cek pembimbing]', ''), 'Senin ASLI');
});
await test('rumus pembuka kembar antarhari ("Kemarin kita bahas") -> hari kedua diperbaiki dengan alasan jelas', async () => {
  const a = item({ draft_caption: captionAwal('Kemarin kita bahas rasa') });
  const { json, calls } = await panggilBerurutan([[a, itemSel()], [itemSel({ draft_caption: captionAwal('Semalam kamu bertanya soal caranya') })]], dua());
  assert.strictEqual(calls.length, 2); assert.ok(calls[1].msg.includes('rumus yang sama dengan 2026-10-12'));
  assert.strictEqual(json.items.length, 2);
});
await test('perbaikan gagal (error/JSON rusak) -> hari yang lolos tetap dikembalikan, status 200, sisanya dilaporkan di ditolak', async () => {
  for (const gagal of [new Error('boom'), 'bukan json']) {
    const { res, json } = await panggilBerurutan([[item({ draft_caption: captionAwal('Subuh yang lengang') }), itemSel({ draft_caption: 'pendek' })], gagal], dua());
    assert.strictEqual(res.status, 200); assert.strictEqual(json.items.length, 1); assert.strictEqual(json.items[0].tanggal, '2026-10-12');
    assert.ok(json.ditolak[0].startsWith('2026-10-13') && json.ditolak[0].includes('pendek'), json.ditolak[0]);
  }
});
await test('perbaikan dibatasi 2 putaran; tetap gagal -> items kosong + ditolak, bukan loop tanpa akhir', async () => {
  const { json, calls } = await panggilBerurutan([[item({ draft_caption: 'pendek' })]], body());
  assert.strictEqual(calls.length, 3); assert.strictEqual(json.items.length, 0); assert.strictEqual(json.perbaikan, 2);
});
await test('slot yang hilang dari jawaban AI (bukan ditolak validator) tidak memicu perbaikan', async () => {
  const { json, calls } = await panggilBerurutan([[item({ draft_caption: captionAwal('Subuh yang lengang') })]], dua());
  assert.strictEqual(calls.length, 1); assert.strictEqual(json.items.length, 1);
});
await test('peran hari diteruskan ke pesan AI di daftar slot', async () => {
  const { calls } = await panggilBerurutan([[item({ draft_caption: captionAwal('Subuh yang lengang') }), itemSel()]], dua({ slots: [{ ...slot, peran: 'Rasakan' }, slotSel] }));
  assert.ok(calls[0].msg.includes('- 2026-10-12 (Senin) | peran: Rasakan | pilar: storytelling | tipe_konten: image'));
});
await test('IG_PLAN_THINKING_LEVEL: default mati; low/medium/high diteruskan; nilai asing diabaikan', async () => {
  const mati = await panggilBerurutan([[item()]], body());
  assert.strictEqual(mati.calls[0].body.generationConfig.thinkingConfig, undefined);
  const tinggi = await panggilBerurutan([[item()]], body(), { IG_PLAN_THINKING_LEVEL: 'high' });
  assert.strictEqual(tinggi.calls[0].body.generationConfig.thinkingConfig.thinkingLevel, 'high');
  const asing = await panggilBerurutan([[item()]], body(), { IG_PLAN_THINKING_LEVEL: 'ngawur' });
  assert.strictEqual(asing.calls[0].body.generationConfig.thinkingConfig, undefined);
});
await test('prompt sistem memuat contoh gaya, aturan mutu tulisan, dan larangan kutipan ayat/hadis', async () => {
  const { calls } = await panggilBerurutan([[item()]], body());
  const sp = calls[0].body.system_instruction.parts[0].text;
  for (const kunci of ['MUTU TULISAN', 'CONTOH GAYA', '"sudut"', '"jembatan"', 'Rasulullah bersabda']) assert.ok(sp.includes(kunci), kunci);
});

console.log(`\n=== HASIL: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
