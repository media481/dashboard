#!/usr/bin/env node
/* ============================================================
   BUILD SCRIPT — regenerate file production (minified) dari source.
   Jalankan setiap kali selesai edit file di js/*.js atau style.css:

     npm install   (sekali saja, install esbuild)
     npm run build

   Yang dihasilkan (INI YANG DI-DEPLOY, jangan diedit manual):
     - js/app.bundle.min.js       (gabungan+minify 27 modul js/, urutan
                                    HARUS sama seperti index.html karena
                                    modul saling bergantung lewat variabel/
                                    fungsi global, bukan ES module)
     - icons/lucide-icons.local.min.js
     - style.min.css

   Situs tetap 100% file statis (tidak ada proses build saat deploy) —
   build.js ini cuma dijalankan MANUAL di komputer Inti sebelum push/deploy,
   hasilnya (file .min.js/.min.css) ikut di-commit seperti file biasa.
   ============================================================ */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// URUTAN INI HARUS SAMA PERSIS dengan komentar di index.html.
const MODULE_ORDER = [
  '00-config.js',
  '01-utils-currency.js',
  '02-auth.js',
  '03-db-core.js',
  '04-event-settings.js',
  '05-navigation.js',
  '06-login-users.js',
  '07-dashboard.js',
  '08-anggota.js',
  '09-donatur-transaksi-operasional.js',
  '10-lomba.js',
  '10b-database-lomba.js',
  '11-belanja.js',
  '12-jadwal-agenda-kas.js',
  '13-lpj.js',
  '14-dokumen.js',
  '15-pengaturan-event.js',
  '15b-snapshot.js',
  '16-ui-helpers.js',
  '16b-event-delegation.js',
  '17a-gudang-core.js',
  '17b-gudang-pinjam.js',
  '17c-gudang-histori-kelola.js',
  '18-getters-refresh.js',
  '24-bookmark.js',
  '22-dana-sosial.js',
  '20-panduan.js',
  '25-tour.js',
  '21-icons-lucide.js',
  '23-install-prompt.js',
  '19-init.js',
];

async function buildJsBundle() {
  const jsDir = path.join(__dirname, 'js');
  const parts = [];
  for (const file of MODULE_ORDER) {
    const filePath = path.join(jsDir, file);
    const result = await esbuild.transform(fs.readFileSync(filePath, 'utf8'), { minify: true, loader: 'js' });
    parts.push(result.code.trimEnd());
  }
  const bundle = parts.join('\n;\n');
  fs.writeFileSync(path.join(jsDir, 'app.bundle.min.js'), bundle);

  // Cek cepat: pastikan hasil gabungan valid sebagai satu script (juga
  // otomatis mendeteksi kalau ada nama let/const yang bentrok antar modul).
  try {
    new Function(bundle);
  } catch (e) {
    console.error('❌ Bundle JS tidak valid setelah digabung:', e.message);
    process.exit(1);
  }
  console.log(`✅ js/app.bundle.min.js (${bundle.length} bytes)`);
}

async function buildLucide() {
  const src = path.join(__dirname, 'icons', 'lucide-icons.local.js');
  const out = path.join(__dirname, 'icons', 'lucide-icons.local.min.js');
  const result = await esbuild.transform(fs.readFileSync(src, 'utf8'), { minify: true, loader: 'js' });
  fs.writeFileSync(out, result.code);
  console.log(`✅ icons/lucide-icons.local.min.js (${result.code.length} bytes)`);
}

async function buildCss() {
  const src = path.join(__dirname, 'style.css');
  const out = path.join(__dirname, 'style.min.css');
  const result = await esbuild.transform(fs.readFileSync(src, 'utf8'), { minify: true, loader: 'css' });
  fs.writeFileSync(out, result.code);
  console.log(`✅ style.min.css (${result.code.length} bytes)`);
}

(async () => {
  await buildJsBundle();
  await buildLucide();
  await buildCss();
  console.log('\nSelesai. Jangan lupa commit file .min.js/.min.css yang berubah.');
})();
