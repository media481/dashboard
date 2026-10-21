// Menempelkan versi berbasis isi file (?v=<hash>) ke <link href="css/..."> dan
// <script src="js/..."> di index.html, supaya css/js boleh di-cache lama
// (Cache-Control immutable di _headers) tanpa risiko user terjebak di versi lama:
// file berubah -> hash berubah -> URL berubah -> browser mengunduh ulang.
//
// Pemakaian (jalankan dari root repo):
//   node scripts/stamp-versions.mjs           # tulis ulang index.html bila ada yang berubah
//   node scripts/stamp-versions.mjs --check   # hanya cek; exit 1 kalau ada versi basi
//
// Aman dijalankan berulang kali (idempoten). Folder scripts/ tidak ikut ter-deploy
// (lihat .assetsignore).
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = join(root, 'index.html');
const checkOnly = process.argv.includes('--check');

const original = readFileSync(htmlPath, 'utf8');
const pattern = /((?:href|src)=")((?:css|js)\/[A-Za-z0-9._-]+\.(?:css|js))(?:\?v=[0-9a-f]+)?(")/g;

const missing = [];
const stamped = original.replace(pattern, (full, pre, path, post) => {
    const file = join(root, path);
    if (!existsSync(file)) { missing.push(path); return full; }
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10);
    return `${pre}${path}?v=${hash}${post}`;
});

if (missing.length) {
    console.error('File tidak ditemukan:', missing.join(', '));
    process.exit(1);
}

// Versi modul lazy (js/modules/*.min.js): dimuat lewat ensureModuleLoaded() di app.js, yang membaca
// <script id="moduleVersions" type="application/json"> di index.html lalu menambahkan ?v=<hash>.
const modDir = join(root, 'js', 'modules');
const modVersions = {};
if (existsSync(modDir)) {
    for (const f of readdirSync(modDir).sort()) {
        if (!f.endsWith('.min.js')) continue;
        modVersions[f.replace(/\.min\.js$/, '')] =
            createHash('sha256').update(readFileSync(join(modDir, f))).digest('hex').slice(0, 10);
    }
}
// Versi CSS lazy (css/*.min.css yang dimuat lewat ensureStyleLoaded()): kunci 'css:<nama>'.
const cssDir = join(root, 'css');
if (existsSync(cssDir)) {
    for (const f of readdirSync(cssDir).sort()) {
        if (!f.endsWith('.min.css')) continue;
        modVersions['css:' + f.replace(/\.min\.css$/, '')] =
            createHash('sha256').update(readFileSync(join(cssDir, f))).digest('hex').slice(0, 10);
    }
}
const modTag = /(<script id="moduleVersions" type="application\/json">)([\s\S]*?)(<\/script>)/;
if (Object.keys(modVersions).length && !modTag.test(stamped)) {
    console.error('index.html tidak punya <script id="moduleVersions" type="application/json">.');
    process.exit(1);
}
const stampedAll = stamped.replace(modTag, (_, a, __, c) => `${a}${JSON.stringify(modVersions)}${c}`);

if (stampedAll === original) {
    console.log('index.html sudah memakai versi terbaru.');
    process.exit(0);
}

if (checkOnly) {
    console.error('Versi di index.html basi. Jalankan: node scripts/stamp-versions.mjs');
    process.exit(1);
}

writeFileSync(htmlPath, stampedAll);
console.log('index.html diperbarui.');
