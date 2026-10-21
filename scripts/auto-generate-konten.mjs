#!/usr/bin/env node
// ============================================================
// AUTO-GENERATE KONTEN IG (pekan depan) -- dijalankan GitHub Actions tiap Minggu 03:00 WIB
// (.github/workflows/auto-generate-konten.yml).
//
// Yang dilakukan = persis tombol "Generate Konten" di Perencanaan Konten IG Scheduler, untuk pekan
// Senin-Minggu BERIKUTNYA: pilih Tema Minggu (Rencana Setahun lebih dulu, lalu saran otomatis), susun
// slot Pola 7 Hari, panggil edge function generate-ig-content-plan, buang ide yang mirip konten lama,
// lalu simpan ke ig_content_plan sebagai ide (status 'idea', tahap 'ide'). TIDAK memposting apa pun:
// admin tetap meninjau & menekan "Jadikan Post".
//
// Logika TIDAK disalin: js/app.js + js/modules/ig-scheduler.js dimuat apa adanya lewat `vm` dengan
// mock DOM (cara yang sama seperti tests/test-core.js), jadi aturan generator di browser dan di
// jadwal ini selalu sama. Konsekuensinya: kode di jalur generate (igGeneratePlanForSlots,
// igKandidatTemaMinggu, igBuildSlotPekan, buildIgPlanProgramContext, ...) tidak boleh bergantung pada DOM.
// tests/test-auto-generate.js menjaga itu.
//
// Env:
//   AUTO_BOT_EMAIL, AUTO_BOT_PASSWORD  akun Supabase Auth (role user/admin) untuk login. Wajib.
//   TARGET_SENIN   (opsional) "YYYY-MM-DD" hari Senin pekan yang digenerate. Bawaan: Senin berikutnya.
//   DRY_RUN=1      (opsional) hanya cek login, data, tema, dan slot; tidak memanggil AI / menyimpan.
//   TZ             sebaiknya Asia/Jakarta (diset di workflow) supaya "hari ini" = tanggal WIB.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeEl() {
  let _text = '';
  return {
    style: {}, dataset: {}, parentNode: { insertBefore() {} }, classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; }, focus() {}, click() {}, value: '',
    set textContent(v) { _text = String(v); }, get textContent() { return _text; },
    set innerHTML(v) { _text = String(v); }, get innerHTML() { return _text; },
  };
}

// Hari Senin berikutnya (selalu SESUDAH `hari`, bukan hari ini). Minggu -> besok; Sabtu -> lusa; Senin -> 7 hari lagi.
export function seninBerikutnya(hari) {
  const dow = hari.getDay(); // 0 = Minggu
  const selisih = ((8 - dow) % 7) || 7;
  return new Date(hari.getFullYear(), hari.getMonth(), hari.getDate() + selisih);
}

// Muat app.js + modul ig-scheduler di konteks vm. `createClient` bisa diganti (tes memakai klien palsu).
export function muatDashboard({ createClient, fetchImpl, log = console.log }) {
  const sandbox = {
    console,
    window: {
      supabase: { createClient },
      addEventListener() {}, removeEventListener() {},
      location: { hostname: 'localhost', href: 'http://localhost/' },
      sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
      localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
      matchMedia: () => ({ matches: false, addListener() {}, removeListener() {} }),
      enhanceSearchableSelect: () => {},
    },
    document: {
      addEventListener() {}, removeEventListener() {},
      getElementById: (id) => (id === 'igRkMulai' || id === 'igPlanMonth') ? null : makeEl(),
      querySelector: () => null, querySelectorAll: () => [], createElement: () => makeEl(),
      documentElement: makeEl(), body: makeEl(),
    },
    navigator: { userAgent: 'node-auto-konten' },
    location: { hostname: 'localhost', href: 'http://localhost/' },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: fetchImpl,
    setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, RegExp, Error, Promise,
    URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, structuredClone,
    MutationObserver: class { observe() {} disconnect() {} },
    alert: () => {},
  };
  sandbox.window.document = sandbox.document;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const baca = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  vm.runInContext(baca('js/app.js'), context, { filename: 'app.js' });
  vm.runInContext(baca('js/modules/ig-scheduler.js'), context, { filename: 'modules/ig-scheduler.js' });
  // Fungsi yang hanya menggambar layar / memberi toast dibuat no-op atau dialihkan ke log. canManageProgramData=false
  // mencegah loadIgContentPlan() "menyembuhkan" ide yatim secara diam-diam (bukan tugas jadwal ini).
  context.__log = log;
  vm.runInContext(`
    showToast = (m, t) => __log('[' + (t || 'info') + '] ' + m);
    renderIgCalendar = () => {}; renderIgPostTable = () => {}; updateIgSchedulerCount = () => {};
    canManageProgramData = () => false;
  `, context);
  return { context, run: (kode) => vm.runInContext(kode, context) };
}

// Inti: kembalikan { status, ... } dan lempar error hanya untuk kegagalan tak terduga.
export async function jalankan({ env = process.env, createClient, fetchImpl = (...a) => globalThis.fetch(...a), sekarang = new Date(), log = console.log } = {}) {
  const email = env.AUTO_BOT_EMAIL, password = env.AUTO_BOT_PASSWORD;
  if (!email || !password) throw new Error('Secret AUTO_BOT_EMAIL / AUTO_BOT_PASSWORD belum di-set di repo (Settings > Secrets and variables > Actions).');
  const dry = env.DRY_RUN === '1' || env.DRY_RUN === 'true';

  const { run } = muatDashboard({ createClient, fetchImpl, log });

  // 1) Login (sesi dikelola supabaseClient; igAiAuthHeaders() membaca token dari sesi ini).
  const login = await run(`supabaseClient.auth.signInWithPassword(${JSON.stringify({ email, password })})`);
  if (login.error || !login.data?.session) throw new Error('Login akun otomatis gagal: ' + (login.error?.message || 'tidak ada sesi'));
  log(`Login OK sebagai ${email}`);

  // 2) Muat data yang dibutuhkan generator (rencana, post, Rencana Setahun ikut termuat di loadIgContentPlan).
  await run('loadIgPosts()');
  await run('loadIgContentPlan()');
  const ringkas = run(`({ plan: igContentPlan.length, post: igPosts.length, rencana: igRencanaTahun.length,
    kolomPlanner: igPlannerColsReady, kolomTeksGambar: igTeksGambarReady, kolomTemaMinggu: igTemaMingguReady })`);
  log(`Data termuat: ${ringkas.plan} rencana, ${ringkas.post} post, ${ringkas.rencana} pekan di Rencana Setahun`);
  if (!ringkas.kolomPlanner || !ringkas.kolomTeksGambar || !ringkas.kolomTemaMinggu) {
    log('PERINGATAN: sql/45-47 belum lengkap dijalankan; kolom pilar/teks_gambar/tema_minggu tidak ikut tersimpan.');
  }

  // 3) Tentukan pekan target + Tema Minggu + slot (sama dengan form Perencanaan Konten).
  const targetSenin = env.TARGET_SENIN
    ? env.TARGET_SENIN
    : run('igLocalDateKey').call(null, seninBerikutnya(sekarang));
  const [sy, sm, sd] = targetSenin.split('-').map(Number);
  const seninDate = new Date(sy, sm - 1, sd);
  if (seninDate.getDay() !== 1) throw new Error(`TARGET_SENIN ${targetSenin} bukan hari Senin`);
  const minggu = run('igLocalDateKey').call(null, new Date(sy, sm - 1, sd + 6));
  const hariIni = run('igLocalDateKey').call(null, sekarang);

  const kandidat = run(`igKandidatTemaMinggu(${JSON.stringify(targetSenin)}, igContentPlan, 1)`);
  const tema = kandidat && kandidat[0];
  if (!tema || !tema.tema) throw new Error(`Tidak ada Tema Minggu untuk pekan ${targetSenin}`);
  const temaMinggu = String(tema.tema).trim();
  // Tema pekan depan (teaser penutup Minggu): sama dengan igPerbaruiSaranDepan().
  const seninDepan = run('igLocalDateKey').call(null, new Date(sy, sm - 1, sd + 7));
  const kandidatDepan = run(`(() => { const sim = igContentPlan.slice(); sim.push({ tanggal: ${JSON.stringify(targetSenin)}, tema_minggu: ${JSON.stringify(temaMinggu)}, status: 'idea' });
    return igKandidatTemaMinggu(${JSON.stringify(seninDepan)}, sim, 1); })()`);
  const temaMingguDepan = kandidatDepan && kandidatDepan[0] ? String(kandidatDepan[0].tema).trim() : '';

  const slots = run(`igBuildSlotPekan(${JSON.stringify(targetSenin)}, igTanggalTerisiSet(), ${JSON.stringify(hariIni)}, ${JSON.stringify(temaMinggu)})`);
  log(`Pekan ${targetSenin} s/d ${minggu} | tema "${temaMinggu}" (${tema.alasan}) | pekan depan: "${temaMingguDepan || '-'}" | slot kosong: ${slots.length}`);

  if (!slots.length) return { status: 'sudah_terisi', senin: targetSenin, tema: temaMinggu, berhasil: 0, sisa: 0 };
  if (dry) return { status: 'dry_run', senin: targetSenin, tema: temaMinggu, slot: slots.length, berhasil: 0, sisa: slots.length };

  // 4) Generate + simpan (anti-duplikat, putaran ulang, simpan per batch: semua di igGeneratePlanForSlots).
  const hasil = await run(`igGeneratePlanForSlots(${sy}, ${sm - 1}, ${JSON.stringify(slots)}, '', null,
    { temaMinggu: ${JSON.stringify(temaMinggu)}, temaMingguDepan: ${JSON.stringify(temaMingguDepan)}, mulai: ${JSON.stringify(targetSenin)}, akhir: ${JSON.stringify(minggu)} })`);
  const sisa = (hasil.sisa || []).length;
  log(`Selesai: ${hasil.berhasil} ide tersimpan, ${sisa} hari belum terisi${hasil.errMsg ? ', error: ' + hasil.errMsg : ''}`);
  return {
    status: hasil.errMsg ? 'error' : (sisa ? 'sebagian' : 'selesai'),
    senin: targetSenin, tema: temaMinggu, slot: slots.length, berhasil: hasil.berhasil, sisa, errMsg: hasil.errMsg || '',
  };
}

function tulisRingkasan(h) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (!f) return;
  const label = { selesai: 'Selesai', sebagian: 'Sebagian', error: 'Gagal', sudah_terisi: 'Dilewati (pekan sudah terisi)', dry_run: 'Dry run (tidak menyimpan)' }[h.status] || h.status;
  fs.appendFileSync(f, `### Auto-generate konten IG\n- Status: **${label}**\n- Pekan: ${h.senin} | Tema: ${h.tema}\n- Ide tersimpan: ${h.berhasil}${h.slot ? ' dari ' + h.slot + ' slot' : ''}\n${h.errMsg ? '- Error: ' + h.errMsg + '\n' : ''}`);
}

// Titik masuk CLI (dilewati saat di-import oleh tes).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    let createClient;
    try { ({ createClient } = await import('@supabase/supabase-js')); }
    catch { console.error('Paket @supabase/supabase-js belum terpasang: jalankan `npm install` dulu.'); process.exit(1); }
    try {
      const h = await jalankan({ createClient });
      tulisRingkasan(h);
      if (h.status === 'error' || (h.status === 'sebagian' && h.berhasil === 0)) process.exit(1);
      if (h.status === 'sebagian') console.log(`::warning::${h.sisa} hari belum terisi. Buka Perencanaan Konten dan klik Generate lagi untuk melengkapi.`);
      process.exit(0);
    } catch (err) {
      console.error('::error::' + (err.message || err));
      tulisRingkasan({ status: 'error', senin: '-', tema: '-', berhasil: 0, errMsg: err.message || String(err) });
      process.exit(1);
    }
  })();
}
