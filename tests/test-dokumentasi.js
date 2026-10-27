// Tes modul Dokumentasi (Social Media > Dokumentasi): js/modules/dokumentasi.js
// - template alur umroh menghasilkan baris yang lolos CHECK constraint sql/60 untuk semua kombinasi durasi/urutan/hari Madinah
// - tanggal per hari, tampilan teks salinan, pengamanan link, dan pendaftaran stub LAZY_MODULES vs markup index.html
// Jalankan: node tests/test-dokumentasi.js   (USE_MIN=1 untuk menguji hasil build *.min.js)
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const EXT = process.env.USE_MIN ? '.min.js' : '.js';
const reg = {};
function el(id) { if (reg[id]) return reg[id]; const e = { id, style: {}, dataset: {}, value: '', _html: '', classList: { add() {}, remove() {}, contains() { return false } }, addEventListener() {}, removeEventListener() {}, appendChild() {}, setAttribute() {}, getAttribute() { return null }, querySelector() { return null }, querySelectorAll() { return [] }, focus() {}, click() {}, remove() {}, reset() {}, get innerHTML() { return this._html }, set innerHTML(v) { this._html = String(v) }, textContent: '' }; return reg[id] = e; }
const sandbox = { console: { log() {}, warn() {}, error() {} }, window: {}, document: { addEventListener() {}, removeEventListener() {}, getElementById: id => (id === 'igRkMulai' || id === 'igPlanMonth') ? null : el(id), querySelector: () => null, querySelectorAll: () => [], createElement: () => el('_new' + Math.random()), documentElement: el('html'), body: el('body'), head: el('head') },
  navigator: { userAgent: 't' }, location: { hostname: 'localhost', href: 'http://localhost/' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem() { return null }, setItem() {}, removeItem() {} },
  fetch: async () => ({ ok: true, json: async () => ({}) }), setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, RegExp, Error, Promise, Number, String, Array, Object, Set, Map, Intl, URL,
  MutationObserver: class { observe() {} disconnect() {} }, alert() {} };
Object.assign(sandbox, { supabase: { createClient: () => ({}) }, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addListener() {}, removeListener() {} }), enhanceSearchableSelect() {} });
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/js/app.js', 'utf8'), ctx, { filename: 'app.js' });
vm.runInContext(fs.readFileSync(ROOT + '/js/modules/dokumentasi' + EXT, 'utf8'), ctx, { filename: 'dokumentasi' + EXT });
const run = s => vm.runInContext(s, ctx);

let passed = 0, failed = 0;
const T = (n, f) => { try { f(); passed++; console.log('  ✓ ' + n); } catch (e) { failed++; console.error('  ✗ ' + n + '\n      ' + e.message); } };
console.log('\n=== TEST: Dokumentasi ===');

const FASE = ['persiapan', 'keberangkatan', 'madinah', 'makkah', 'kepulangan', 'lainnya'];
const KAT = ['perjalanan', 'ibadah', 'ziarah', 'hotel', 'kebersamaan', 'lainnya'];
const MEDIA = ['foto', 'video', 'reels', 'story', 'testimoni'];

T('template: semua kombinasi lolos constraint sql/60 dan memakai id katalog yang ada', () => {
  const pilar = Object.keys(run('IG_PILLARS'));
  let total = 0;
  for (let durasi = 6; durasi <= 30; durasi++) {
    for (const urutan of ['madinah-makkah', 'makkah-madinah']) {
      for (let hMad = 2; hMad <= durasi - 4; hMad++) {
        const rows = run(`dkgBangunBarisTemplate('p1', ${JSON.stringify({ durasi, urutan, hariMadinah: hMad, tglBerangkat: '2026-11-03' })})`);
        assert(rows.length > 10, 'terlalu sedikit baris');
        rows.forEach(r => {
          total++;
          assert(r.judul && r.judul.trim(), 'judul kosong');
          assert(Number.isInteger(r.hari_ke) && r.hari_ke >= 1 && r.hari_ke <= 60, 'hari_ke di luar 1..60: ' + r.hari_ke);
          assert(FASE.includes(r.fase), 'fase tidak valid: ' + r.fase);
          assert(KAT.includes(r.kategori), 'kategori tidak valid: ' + r.kategori);
          assert(r.jenis_media.every(m => MEDIA.includes(m)), 'media tidak valid');
          assert(!r.pilar || pilar.includes(r.pilar), 'pilar tidak dikenal: ' + r.pilar);
          assert.strictEqual(r.status, 'rencana');
        });
      }
    }
  }
  assert(total > 1000);
});

T('template 9 hari Madinah dulu (3 hari Madinah): hari 1 berangkat, hari 9 tiba, tanggal mengikuti hari', () => {
  const rows = run(`dkgBangunBarisTemplate('p1', { durasi: 9, urutan: 'madinah-makkah', hariMadinah: 3, tglBerangkat: '2026-11-03' })`);
  const hari = h => rows.filter(r => r.hari_ke === h && r.fase !== 'persiapan');
  assert(hari(1).some(r => r.judul.startsWith('Kumpul')));
  assert(hari(9).some(r => r.judul.startsWith('Tiba di tanah air')));
  assert.strictEqual(Math.max(...rows.map(r => r.hari_ke)), 9);
  assert(hari(2).some(r => r.fase === 'madinah'));
  assert(hari(4).some(r => r.judul.includes('Bir Ali')), 'miqat Bir Ali harus di hari terakhir Madinah');
  assert(hari(5).some(r => r.judul === 'Thawaf umroh'));
  assert(hari(8).some(r => r.judul.startsWith('Thawaf wada')) && hari(8).some(r => r.judul.startsWith('Penerbangan pulang')));
  rows.filter(r => r.fase !== 'persiapan').forEach(r => assert.strictEqual(r.tanggal, run(`dkgAddDays('2026-11-03', ${r.hari_ke - 1})`)));
  assert.strictEqual(hari(9)[0].tanggal, '2026-11-11');
  const persiapan = rows.filter(r => r.fase === 'persiapan');
  assert(persiapan.length === 1 && persiapan[0].tanggal === null);
});

T('template Makkah dulu: umroh di hari 2, Madinah sesudahnya tanpa miqat Bir Ali', () => {
  const rows = run(`dkgBangunBarisTemplate('p1', { durasi: 9, urutan: 'makkah-madinah', hariMadinah: 3, tglBerangkat: null })`);
  const hari = h => rows.filter(r => r.hari_ke === h);
  assert(hari(2).some(r => r.judul === 'Thawaf umroh'));
  assert(!rows.some(r => r.judul.includes('Bir Ali')));
  assert(rows.some(r => r.fase === 'madinah' && r.hari_ke > 5));
  assert(rows.every(r => r.tanggal === null), 'tanpa tanggal berangkat, tanggal harus null');
});

T('tanggal & durasi: helper tanggal lokal tanpa geser zona waktu', () => {
  assert.strictEqual(run("dkgAddDays('2026-12-30', 3)"), '2027-01-02');
  assert.strictEqual(run("dkgAddDays('2026-02-27', 2)"), '2026-03-01');
  assert.strictEqual(run("dkgFormatTanggal('2026-11-03')"), 'Selasa, 3 November 2026');
  assert.strictEqual(run("dkgFormatTanggal('2026-11-03', false)"), '3 November 2026');
  assert.strictEqual(run("dkgIso(new Date(2026, 10, 3))"), '2026-11-03');
});

T('dkgSafeUrl: hanya http(s); javascript: ditolak', () => {
  assert.strictEqual(run("dkgSafeUrl('javascript:alert(1)')"), '#');
  assert.strictEqual(run("dkgSafeUrl('drive.google.com/x')"), 'https://drive.google.com/x');
  assert.strictEqual(run("dkgSafeUrl('')"), '#');
});

T('dkgTipeKonten memetakan media ke enum post_media_type', () => {
  assert.strictEqual(run("dkgTipeKonten(['foto','reels'])"), 'video');
  assert.strictEqual(run("dkgTipeKonten(['foto'])"), 'carousel');
  assert.strictEqual(run("dkgTipeKonten(['story'])"), 'image');
  assert.strictEqual(run("dkgTipeKonten([])"), 'image');
});

T('teks salinan: urut per hari, kegiatan dilewati tidak ikut', () => {
  run(`dataUmroh = [{ id: 'p1', nama: 'Umroh Test', tgl: '3 November 2026', durasi: '9 Hari' }]; dkgProgramId = 'p1';
       dkgItems = [
         { id: 'a', hari_ke: 2, tanggal: '2026-11-04', waktu: '08:00', fase: 'madinah', judul: 'B', lokasi: 'Nabawi', status: 'rencana', jenis_media: ['foto'], shot_list: 'wide', urutan: 10 },
         { id: 'b', hari_ke: 1, tanggal: '2026-11-03', fase: 'keberangkatan', judul: 'A', status: 'rencana', jenis_media: [], urutan: 10 },
         { id: 'c', hari_ke: 1, fase: 'keberangkatan', judul: 'DILEWATI', status: 'dilewati', jenis_media: [], urutan: 20 },
         { id: 'd', hari_ke: 1, fase: 'persiapan', judul: 'Manasik', status: 'rencana', jenis_media: [], urutan: 10 }
       ];`);
  const t = run('dkgBangunTeks()');
  assert(t.indexOf('Persiapan') < t.indexOf('Hari 1') && t.indexOf('Hari 1') < t.indexOf('Hari 2'));
  assert(!t.includes('DILEWATI'));
  assert(t.includes('08:00 | B @ Nabawi') && t.includes('Ambil: Foto') && t.includes('Shot list: wide'));
  assert.strictEqual(run('dkgDurasiProgram("p1")'), 9);
  assert.strictEqual(run('dkgTglBerangkatProgram("p1")'), '2026-11-03');
});

T('stub LAZY_MODULES: semua nama di api ada di modul, dan semua fungsi yang dipanggil markup index.html terdaftar', () => {
  const def = run("LAZY_MODULES['dokumentasi']");
  assert(def && def.src === 'js/modules/dokumentasi.min.js' && def.css.includes('dokumentasi'));
  def.api.forEach(n => assert.strictEqual(run(`typeof ${n}`), 'function', n + ' tidak terdefinisi di modul'));
  const html = fs.readFileSync(ROOT + '/index.html', 'utf8');
  const start = html.indexOf('id="tab-dokumentasi"');
  const blok = html.slice(start, html.indexOf('id="igSchedulerPageView"', start)) + html.slice(html.indexOf('id="dkgModal"'), html.indexOf('id="hotelImportModal"'));
  const dipakai = new Set();
  for (const m of blok.matchAll(/data-action="([A-Za-z0-9_]+)"/g)) dipakai.add(m[1]);
  for (const m of blok.matchAll(/on(?:submit|change|click)="([A-Za-z0-9_]+)\(/g)) dipakai.add(m[1]);
  assert(dipakai.size >= 8, 'markup Dokumentasi tidak terbaca');
  dipakai.forEach(n => assert(def.api.includes(n), n + ' dipakai index.html tetapi tidak ada di LAZY_MODULES.dokumentasi.api'));
});

T('render: input user di-escape, tidak ada "undefined", guest tidak melihat tombol ubah', () => {
  run(`currentRole = 'admin'; adminLoggedIn = true;
       dkgProgramId = 'p1';
       dkgItems = [{ id: 'x1', hari_ke: 1, tanggal: '2026-11-03', waktu: '05:30', fase: 'keberangkatan', kategori: 'perjalanan',
         judul: '<img src=x onerror=alert(1)>', lokasi: '"><script>1</script>', deskripsi: '<b>d</b>', shot_list: 'wide', ide_konten: null, catatan: null,
         link_drive: 'javascript:alert(1)', pilar: 'storytelling', status: 'sudah_diambil', jenis_media: ['foto', 'reels'], content_plan_id: null }];`);
  const body = el('dkgBody');
  run('canManageProgramData = () => true; renderDkgContent()');
  const admin = body.innerHTML;
  assert(!admin.includes('<img src=x') && !admin.includes('<script>1'), 'judul/lokasi tidak di-escape');
  assert(!/undefined|\bnull\b/.test(admin), 'ada undefined/null di HTML');
  assert(admin.includes('data-action="deleteDkg"') && admin.includes('dkg-stat'));
  assert(!admin.includes('href="javascript:'), 'link javascript: lolos ke href');
  run('canManageProgramData = () => false; renderDkgContent()');
  const guest = body.innerHTML;
  assert(!guest.includes('deleteDkg') && !guest.includes('openDkgModal') && !guest.includes('<select class="dkg-status-select'), 'guest melihat kontrol ubah');
  assert(guest.includes('dkg-status-pill'));
});

T('menu: Dokumentasi ada di section Social Media dan terdaftar di Akses Menu', () => {
  const sec = run("NAV_MENU.find(s => s.label === 'Social Media')");
  const item = sec.items.find(i => i.tab === 'dokumentasi');
  assert(item && item.reg && item.reg.group === 'Social Media');
  assert(run("SIDEBAR_MENU_REGISTRY.some(m => m.key === 'dokumentasi' && m.group === 'Social Media')"));
});

console.log(`\n=== HASIL: ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
