// Minify js/app.js -> js/app.min.js dan css/*.css -> css/*.min.css memakai esbuild.
// File sumber (app.js, style.css, dst.) TETAP yang diedit; file .min.* adalah hasil
// generate dan yang di-load index.html.
//
// Pemakaian (dari root repo, setelah `npm install`):
//   node scripts/build.mjs           # tulis ulang file .min.* yang berubah
//   node scripts/build.mjs --check   # hanya cek; exit 1 kalau ada .min.* yang basi
//
// Urutan rilis: `npm run release` (= build lalu stamp versi di index.html).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

const jobs = [{ src: 'js/app.js', out: 'js/app.min.js', loader: 'js' }];
// Modul lazy (js/modules/*.js, dimuat saat dibutuhkan oleh ensureModuleLoaded() di app.js).
const modDir = join(root, 'js', 'modules');
if (existsSync(modDir)) {
    for (const f of readdirSync(modDir).sort()) {
        if (!f.endsWith('.js') || f.endsWith('.min.js')) continue;
        jobs.push({ src: `js/modules/${f}`, out: `js/modules/${f.replace(/\.js$/, '.min.js')}`, loader: 'js' });
    }
}
for (const f of readdirSync(join(root, 'css')).sort()) {
    if (!f.endsWith('.css') || f.endsWith('.min.css')) continue;
    jobs.push({ src: `css/${f}`, out: `css/${f.replace(/\.css$/, '.min.css')}`, loader: 'css' });
}

let stale = 0, before = 0, after = 0;
for (const job of jobs) {
    const code = readFileSync(join(root, job.src), 'utf8');
    // JS dimuat sebagai script biasa (bukan module): esbuild TIDAK mengganti nama
    // fungsi/variabel tingkat-atas, jadi onclick="..." & window.fn tetap jalan.
    const { code: min } = await transform(code, { loader: job.loader, minify: true, legalComments: 'none' });
    const outPath = join(root, job.out);
    const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
    before += Buffer.byteLength(code); after += Buffer.byteLength(min);
    if (current !== min) {
        stale++;
        if (!checkOnly) writeFileSync(outPath, min);
        console.log(`${checkOnly ? 'BASI' : 'tulis'}  ${job.out}`);
    }
}

console.log(`${jobs.length} file, ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`);
if (checkOnly && stale) {
    console.error('File .min.* tidak sinkron dengan sumbernya. Jalankan: npm run build');
    process.exit(1);
}
