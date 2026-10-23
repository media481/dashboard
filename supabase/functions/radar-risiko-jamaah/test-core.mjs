// Tes untuk edge function radar-risiko-jamaah (tanpa Deno, tanpa jaringan).
// Jalankan:  node --experimental-strip-types supabase/functions/radar-risiko-jamaah/test-core.mjs   (Node >= 22.6)
// Cara kerja: index.ts dimuat apa adanya (hanya import createClient & Deno.serve diganti shim). Fungsi murni
// diuji langsung lewat export; handler diuji dengan database tiruan di memori.
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
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'radar-')), 'index.mts');
fs.writeFileSync(tmp, src);

const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'SRK' };
globalThis.Deno = { env: { get: k => env[k] } };

// ---- Database tiruan: tabel -> baris. Mendukung select/eq/in/order/range/single/maybeSingle. ----
const DB = {};
const kirimanTelegram = [];
function bangun(tabel) {
  const f = { eq: [], in: [], mulai: 0, akhir: Infinity, tunggal: false };
  const q = {
    select() { return q; },
    eq(k, v) { f.eq.push([k, v]); return q; },
    in(k, v) { f.in.push([k, v]); return q; },
    order() { return q; },
    range(a, b) { f.mulai = a; f.akhir = b; return q; },
    single() { f.tunggal = true; return q; },
    then(res, rej) {
      let rows = (DB[tabel] || []).filter(r => f.eq.every(([k, v]) => r[k] === v) && f.in.every(([k, v]) => v.includes(r[k])));
      rows = rows.slice(f.mulai, f.akhir + 1);
      return Promise.resolve(f.tunggal ? { data: rows[0] || null, error: null } : { data: rows, error: null }).then(res, rej);
    },
  };
  return q;
}
globalThis.__createClient = () => ({
  auth: { getUser: async (t) => t === 'TOKEN-ADMIN' || t === 'TOKEN-USER' ? { data: { user: { id: t } }, error: null } : { data: null, error: { message: 'bad' } } },
  from: (t) => bangun(t),
});
globalThis.fetch = async (url, opts) => { kirimanTelegram.push({ url: String(url), body: JSON.parse(opts.body) }); return { ok: true, json: async () => ({ ok: true }) }; };

const M = await import(pathToFileURL(tmp).href);
const handler = globalThis.__handler;

let passed = 0, failed = 0;
async function t(nama, fn) {
  try { await fn(); passed++; console.log('  ✓', nama); } catch (e) { failed++; console.log('  ✗', nama, '\n    ', e.message); }
}

// Waktu acuan: 1 Okt 2026 12:00 WIB
const NOW = Date.UTC(2026, 9, 1, 5, 0, 0);
const ms = (y, m, d) => Date.UTC(y, m - 1, d);
const dokLengkap = { ktp_fc: 1, kk_asli: 1, paspor_fc: 1, buku_nikah_fc: 1, akta_lahir_fc: 1, ijazah_fc: 1, kartu_vaksin_fc: 1, pas_photo: 1 };

console.log('\n=== TEST: parse tanggal berangkat ===');
await t('rentang "17-26 SEPTEMBER 2026"', () => assert.equal(M.parseTglBerangkat('17-26 SEPTEMBER 2026'), ms(2026, 9, 17)));
await t('daftar "4 & 11 Oktober 2026"', () => assert.equal(M.parseTglBerangkat('4 & 11 Oktober 2026'), ms(2026, 10, 4)));
await t('lintas bulan "28 September - 2 Oktober 2026"', () => assert.equal(M.parseTglBerangkat('28 September - 2 Oktober 2026'), ms(2026, 9, 28)));
await t('lintas tahun "28 Desember - 3 Januari 2027" mulai di 2026', () => assert.equal(M.parseTglBerangkat('28 Desember - 3 Januari 2027'), ms(2026, 12, 28)));
await t('singkatan "10 Jan 2027"', () => assert.equal(M.parseTglBerangkat('10 Jan 2027'), ms(2027, 1, 10)));
await t('teks tanpa tanggal -> null', () => { assert.equal(M.parseTglBerangkat('TBA'), null); assert.equal(M.parseTglBerangkat(''), null); assert.equal(M.parseTglBerangkat(null), null); });
await t('hariMenuju memakai tanggal Jakarta (23:30 UTC sudah esok hari WIB)', () => {
  assert.equal(M.hariMenuju(ms(2026, 10, 11), NOW), 10);
  const lewatTengahMalamWib = Date.UTC(2026, 9, 1, 18, 0, 0); // 2 Okt 01:00 WIB
  assert.equal(M.hariMenuju(ms(2026, 10, 11), lewatTengahMalamWib), 9);
});

console.log('\n=== TEST: harga, dokumen, paspor ===');
await t('harga_custom menang atas harga kamar', () => assert.equal(M.hargaJamaah({ harga_quint: 'Rp 30.000.000' }, { harga_custom: 'Rp 28.000.000', tipe_kamar: 'quad' }), 28000000));
await t('tipe kamar triple dari admin_data_lengkap; fallback ke Quad kalau kosong', () => {
  const p = { harga_quint: '30000000', admin_data_lengkap: JSON.stringify({ harga_triple: 'Rp 33.000.000' }) };
  assert.equal(M.hargaJamaah(p, { tipe_kamar: 'triple' }), 33000000);
  assert.equal(M.hargaJamaah(p, { tipe_kamar: 'double' }), 30000000);
});
await t('dokumen: fc ATAU asli dianggap ada; pas photo satu centang', () => {
  assert.deepEqual(M.dokumenKurang(dokLengkap), []);
  assert.deepEqual(M.dokumenKurang({ ...dokLengkap, ktp_fc: 0, pas_photo: 0 }), ['KTP', 'Pas Photo 4x6']);
  assert.equal(M.dokumenKurang(null).length, 8);
});
await t('paspor: expired, mepet (<7 bulan), ok, belum diisi', () => {
  const b = ms(2026, 10, 20);
  assert.equal(M.statusPaspor('2026-10-01', b), 'expired');
  assert.equal(M.statusPaspor('2027-03-01', b), 'mepet');
  assert.equal(M.statusPaspor('2027-06-01', b), 'ok');
  assert.equal(M.statusPaspor(null, b), 'belum_diisi');
});

console.log('\n=== TEST: skor jamaah ===');
const prog = { id: 'p1', nama: 'Umroh Reguler', tgl: '11 Oktober 2026', harga_quint: '30000000', kuota_pax: 45 };
const berangkat = ms(2026, 10, 11);
await t('jamaah beres semua -> skor 0, siap', () => {
  const n = M.nilaiJamaah({ dokumen: dokLengkap, paspor_exp: '2028-01-01', visa_status: 'terbit', tipe_kamar: 'quad' }, prog, 30000000, 10, berangkat);
  assert.equal(n.skor, 0); assert.equal(n.level, 'aman'); assert.equal(n.siap, true);
});
await t('H-10, belum bayar, visa belum, dokumen kosong -> level kritis', () => {
  const n = M.nilaiJamaah({ dokumen: {}, paspor_exp: '2028-01-01', visa_status: 'belum_diajukan' }, prog, 0, 10, berangkat);
  assert.ok(n.skor >= 70, 'skor ' + n.skor); assert.equal(n.level, 'kritis'); assert.equal(n.siap, false);
  assert.equal(n.alasan[0].kode, 'belum_lunas'); // diurutkan poin terbesar dulu
});
await t('urgensi: kekurangan yang sama lebih ringan kalau berangkat masih jauh', () => {
  const j = { dokumen: {}, paspor_exp: '2028-01-01', visa_status: 'belum_diajukan' };
  const dekat = M.nilaiJamaah(j, prog, 0, 10, berangkat).skor;
  const jauh = M.nilaiJamaah(j, prog, 0, 60, berangkat).skor;
  assert.ok(jauh < dekat, `${jauh} < ${dekat}`);
});
await t('visa ditolak & paspor kadaluarsa memberi poin tetap besar', () => {
  const n = M.nilaiJamaah({ dokumen: dokLengkap, paspor_exp: '2026-09-01', visa_status: 'ditolak' }, prog, 30000000, 60, berangkat);
  assert.equal(n.skor, 80); assert.equal(n.level, 'kritis');
});
await t('harga program kosong ditandai, bukan dianggap lunas', () => {
  const n = M.nilaiJamaah({ dokumen: dokLengkap, paspor_exp: '2028-01-01', visa_status: 'terbit' }, { ...prog, harga_quint: '' }, 0, 10, berangkat);
  assert.ok(n.alasan.some(a => a.kode === 'harga_kosong')); assert.equal(n.siap, false);
});
await t('kelebihan bayar dicatat tanpa poin', () => {
  const n = M.nilaiJamaah({ dokumen: dokLengkap, paspor_exp: '2028-01-01', visa_status: 'terbit' }, prog, 32000000, 10, berangkat);
  const a = n.alasan.find(x => x.kode === 'kelebihan_bayar'); assert.ok(a); assert.equal(a.poin, 0);
});

console.log('\n=== TEST: draf WA ===');
await t('normalisasi nomor WA', () => {
  assert.equal(M.normalisasiWa('0812-3456-7890'), '6281234567890');
  assert.equal(M.normalisasiWa('81234567890'), '6281234567890');
  assert.equal(M.normalisasiWa('+62 812 3456 7890'), '6281234567890');
  assert.equal(M.normalisasiWa('123'), null); assert.equal(M.normalisasiWa(''), null);
});
await t('draf memuat dokumen kurang & sisa bayar, TIDAK memuat status visa', () => {
  const j = { nama: 'Siti', dokumen: { ...dokLengkap, ktp_fc: 0 }, paspor_exp: '2028-01-01', visa_status: 'belum_diajukan' };
  const n = M.nilaiJamaah(j, prog, 10000000, 10, berangkat);
  const d = M.susunDrafWa(j, prog, n, 10, { brand: 'Amiru Tour', kontakWa: '6285122336300' });
  assert.match(d, /Bapak\/Ibu Siti/); assert.match(d, /KTP/); assert.match(d, /Rp 20\.000\.000/); assert.match(d, /tinggal 10 hari/);
  assert.match(d, /wa\.me\/6285122336300/); assert.doesNotMatch(d, /[Vv]isa/);
});
await t('jamaah tanpa tindakan untuk jamaah -> tidak ada draf', () => {
  const j = { nama: 'Ali', dokumen: dokLengkap, paspor_exp: '2028-01-01', visa_status: 'belum_diajukan' };
  const n = M.nilaiJamaah(j, prog, 30000000, 10, berangkat);
  assert.equal(M.susunDrafWa(j, prog, n, 10, {}), null);
});

// ---- Data uji untuk handler ----
DB.programs = [
  { id: 'p1', nama: 'Umroh Reguler', tgl: '11 Oktober 2026', harga_quint: '30000000', admin_data_lengkap: null, is_active: true, status_kepulangan: 'belum_berangkat', kuota_pax: 45 },
  { id: 'p2', nama: 'Umroh Jauh', tgl: '20 Desember 2026', harga_quint: '30000000', admin_data_lengkap: null, is_active: true, status_kepulangan: 'belum_berangkat', kuota_pax: 45 },
  { id: 'p3', nama: 'Sudah Berangkat', tgl: '1 September 2026', harga_quint: '30000000', admin_data_lengkap: null, is_active: true, status_kepulangan: 'sudah_berangkat', kuota_pax: 45 },
];
DB.kb_jamaah = [
  { id: 'j1', program_id: 'p1', nama: 'Siti', wa: '081234567890', tipe_kamar: 'quad', harga_custom: '', status: 'dp', dokumen: {}, paspor_exp: '2028-01-01', visa_status: 'belum_diajukan', diarsipkan: false },
  { id: 'j2', program_id: 'p1', nama: 'Ali', wa: '', tipe_kamar: 'quad', harga_custom: '', status: 'lunas', dokumen: dokLengkap, paspor_exp: '2028-01-01', visa_status: 'terbit', diarsipkan: false },
  { id: 'j3', program_id: 'p1', nama: 'Batal', wa: '0811', tipe_kamar: 'quad', harga_custom: '', status: 'batal', dokumen: {}, paspor_exp: null, visa_status: 'belum_diajukan', diarsipkan: false },
  { id: 'j4', program_id: 'p1', nama: 'Arsip', wa: '0811', tipe_kamar: 'quad', harga_custom: '', status: 'lunas', dokumen: {}, paspor_exp: null, visa_status: 'belum_diajukan', diarsipkan: true },
  { id: 'j5', program_id: 'p2', nama: 'Budi', wa: '0822', tipe_kamar: 'quad', harga_custom: '', status: 'pending', dokumen: {}, paspor_exp: null, visa_status: 'belum_diajukan', diarsipkan: false },
];
DB.v_total_bayar = [
  { jamaah_id: 'j1', program_id: 'p1', total_dibayar: 5000000 },
  { jamaah_id: 'j2', program_id: 'p1', total_dibayar: 30000000 },
];
DB.dashboard_profiles = [{ id: 'TOKEN-ADMIN', dashboard_role: 'admin' }, { id: 'TOKEN-USER', dashboard_role: 'user' }];
DB.tg_config = [
  { key: 'company_profile', value: JSON.stringify({ brand: 'AMIRU TOUR', kontak_wa: ['6285122336300'] }) },
  { key: 'botToken', value: 'BOT123' },
  { key: 'recipients', value: JSON.stringify([{ chatId: '111', label: 'Admin', types: ['program'] }, { chatId: '222', label: 'Radar', types: ['radar'] }]) },
];

const panggil = (bodi, token = 'TOKEN-ADMIN') => handler(new Request('http://x', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(bodi),
}));

// Handler memakai Date.now(); kunci ke NOW supaya hasil deterministik
const asliNow = Date.now; Date.now = () => NOW;

console.log('\n=== TEST: hitungRadar & handler ===');
await t('tanpa token, token palsu, dan role user ditolak (401)', async () => {
  assert.equal((await panggil({}, null)).status, 401);
  assert.equal((await panggil({}, 'TOKEN-PALSU')).status, 401);
  assert.equal((await panggil({}, 'TOKEN-USER')).status, 401);
});
await t('service role key diterima (cron)', async () => assert.equal((await panggil({}, 'SRK')).status, 200));
await t('GET ditolak 405, OPTIONS ok', async () => {
  assert.equal((await handler(new Request('http://x', { method: 'GET' }))).status, 405);
  assert.equal((await handler(new Request('http://x', { method: 'OPTIONS' }))).status, 200);
});
await t('horizon 60 hari: p1 ikut, p2 (80 hari) dan p3 (sudah berangkat) tidak', async () => {
  const r = await (await panggil({})).json();
  assert.deepEqual(r.programs.map(p => p.id), ['p1']);
});
await t('jamaah batal & arsip tidak dihitung; hasil urut skor tertinggi', async () => {
  const p = (await (await panggil({})).json()).programs[0];
  assert.equal(p.jumlah_jamaah, 2);
  assert.deepEqual(p.jamaah.map(j => j.nama), ['Siti', 'Ali']);
  assert.equal(p.siap, 1); assert.equal(p.hari_menuju, 10);
  assert.equal(p.belum_lunas, 1); assert.equal(p.total_sisa_tagihan, 25000000);
});
await t('draf & tautan WA hanya untuk yang punya nomor valid; tanpa nomor diberi catatan', async () => {
  const p = (await (await panggil({})).json()).programs[0];
  const siti = p.jamaah.find(j => j.nama === 'Siti');
  assert.match(siti.wa_link, /^https:\/\/wa\.me\/6281234567890\?text=/);
  assert.match(decodeURIComponent(siti.wa_link), /AMIRU TOUR/);
  const ali = p.jamaah.find(j => j.nama === 'Ali');
  assert.equal(ali.draf_wa, null); assert.equal(ali.wa_link, null);
});
await t('program_id menilai satu program meski di luar horizon', async () => {
  const r = await (await panggil({ program_id: 'p2' })).json();
  assert.deepEqual(r.programs.map(p => p.id), ['p2']);
});
await t('horizon_hari diperlebar -> p2 ikut, urut dari skor tertinggi', async () => {
  const r = await (await panggil({ horizon_hari: 120 })).json();
  assert.deepEqual(r.programs.map(p => p.id).sort(), ['p1', 'p2']);
  assert.ok(r.programs[0].skor >= r.programs[1].skor);
});
await t('tanpa kirim_telegram tidak ada pesan keluar', async () => {
  kirimanTelegram.length = 0; await panggil({});
  assert.equal(kirimanTelegram.length, 0);
});
await t('kirim_telegram: pilih penerima bertipe radar dulu, isi pesan = ringkasan', async () => {
  kirimanTelegram.length = 0;
  const r = await (await panggil({ kirim_telegram: true })).json();
  assert.deepEqual(r.telegram, { terkirim: 1, gagal: 0 });
  assert.equal(kirimanTelegram[0].body.chat_id, '222');
  assert.match(kirimanTelegram[0].url, /botBOT123\/sendMessage/);
  assert.match(kirimanTelegram[0].body.text, /Umroh Reguler/);
});
await t('hanya_jika_ada_masalah: dilewati kalau semua aman', async () => {
  const simpan = DB.kb_jamaah; DB.kb_jamaah = simpan.filter(j => j.id === 'j2');
  kirimanTelegram.length = 0;
  const r = await (await panggil({ kirim_telegram: true, hanya_jika_ada_masalah: true })).json();
  assert.equal(r.telegram.terkirim, 0); assert.equal(kirimanTelegram.length, 0);
  DB.kb_jamaah = simpan;
});
await t('ringkasan teks aman dari HTML mentah & dibatasi panjangnya', async () => {
  const nama = '<b>x</b>';
  const prgs = Array.from({ length: 60 }, (_, i) => ({ nama: nama + i, level: 'kritis', hari_menuju: 5, skor: 90, siap: 0, jumlah_jamaah: 3, belum_lunas: 3, total_sisa_tagihan: 1e7, dokumen_belum_lengkap: 3, visa_belum_terbit: 3, paspor_bermasalah: 0, jamaah: [], peringatan_data: null }));
  const teks = M.susunRingkasanTeks(prgs, NOW);
  assert.ok(teks.length <= 3900); assert.doesNotMatch(teks, /<b>x<\/b>/); assert.match(teks, /&lt;b&gt;x/);
});
await t('lebih dari 1000 jamaah dibaca per halaman (tidak terpotong diam-diam)', async () => {
  const simpan = DB.kb_jamaah, simpanBayar = DB.v_total_bayar;
  DB.kb_jamaah = Array.from({ length: 2300 }, (_, i) => ({ id: 'k' + String(i).padStart(5, '0'), program_id: 'p1', nama: 'J' + i, wa: '', tipe_kamar: 'quad', harga_custom: '', status: 'dp', dokumen: dokLengkap, paspor_exp: '2028-01-01', visa_status: 'terbit', diarsipkan: false }));
  DB.v_total_bayar = [];
  const p = (await (await panggil({})).json()).programs[0];
  assert.equal(p.jumlah_jamaah, 2300);
  DB.kb_jamaah = simpan; DB.v_total_bayar = simpanBayar;
});
Date.now = asliNow;

console.log(`\n=== HASIL: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
