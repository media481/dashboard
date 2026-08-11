/* ============================================================
   SARAN INSTALL (Add to Home Screen / PWA install)
   Mendeteksi apakah aplikasi ini SUDAH dibuka sebagai app ter-install
   (standalone) atau MASIH dibuka lewat tab browser biasa, lalu otomatis
   menyarankan install lewat banner kecil di bawah layar kalau belum.

   Dua jalur berbeda karena browser tidak punya satu API universal:

   1) Android/Chrome/Edge/Samsung Internet, dsb: browser sendiri yang
      memicu event `beforeinstallprompt` kalau APP MEMENUHI SYARAT PWA
      (manifest valid, service worker terdaftar, dsb — sudah ada di
      project ini). Kita `preventDefault()` supaya mini-infobar bawaan
      browser tidak muncul, simpan event-nya, lalu tampilkan banner
      custom sendiri; tombol "Install" di banner memanggil
      `deferredPrompt.prompt()` (WAJIB dipicu dari klik user, tidak bisa
      dipanggil otomatis begitu saja karena browser akan menolaknya).

   2) iOS Safari: TIDAK PERNAH mengirim `beforeinstallprompt` sama sekali
      (keterbatasan Apple, bukan bug di sini) dan tidak ada API buat
      memicu dialog install dari JS. Satu-satunya cara di iOS adalah
      instruksi manual: Share ⎋ -> "Add to Home Screen". Jadi khusus
      iOS Safari yang terdeteksi belum standalone, banner-nya berisi
      instruksi itu (tanpa tombol "Install" karena memang tidak ada
      cara memicunya otomatis).

   Kalau app SUDAH standalone (sudah ter-install & dibuka dari ikon di
   homescreen/desktop), banner ini tidak pernah muncul sama sekali.
   ============================================================ */

const INSTALL_PROMPT_DISMISS_KEY = 'ti_install_prompt_dismissed_until';
// Kalau user tutup banner manual (bukan install), jangan muncul lagi
// selama beberapa hari — supaya tidak dianggap mengganggu tiap buka app,
// tapi tetap muncul lagi sesekali buat yang lupa/belum sempat install.
const INSTALL_PROMPT_SNOOZE_HARI = 14;

let _deferredInstallPrompt = null;

function appSudahStandalone(){
  // display-mode:standalone -> berlaku di Android/desktop Chrome/Edge dkk
  // setelah di-install. navigator.standalone -> khusus iOS Safari lama.
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function iOSSafariBelumInstall(){
  const ua = window.navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1); // iPadOS baru menyamar sbg Mac
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua); // bukan Chrome/Firefox/Edge/Opera di iOS
  return isIOS && isSafari;
}

function installPromptSedangDisembunyikan(){
  const until = Number(localStorage.getItem(INSTALL_PROMPT_DISMISS_KEY) || 0);
  return Date.now() < until;
}

function sembunyikanInstallPromptSementara(){
  const until = Date.now() + INSTALL_PROMPT_SNOOZE_HARI * 24 * 60 * 60 * 1000;
  localStorage.setItem(INSTALL_PROMPT_DISMISS_KEY, String(until));
  tutupInstallBanner();
}

function tutupInstallBanner(){
  const el = document.getElementById('install-banner');
  if (el) el.classList.remove('show');
}

function tampilkanInstallBanner({androidMode}){
  if (document.getElementById('install-banner')) return; // sudah ada, jangan dobel
  const el = document.createElement('div');
  el.id = 'install-banner';
  el.className = 'install-banner';
  el.innerHTML = androidMode
    ? `
      <div class="install-banner-icon">📲</div>
      <div class="install-banner-text">
        <div class="install-banner-title">Install Taruna Inti</div>
        <div class="install-banner-desc">Lebih cepat dibuka & tetap bisa dipakai walau koneksi lagi jelek.</div>
      </div>
      <div class="install-banner-actions">
        <button type="button" class="btn" id="install-banner-btn">Install</button>
        <button type="button" class="icon-btn" id="install-banner-close" title="Tutup" aria-label="Tutup">✕</button>
      </div>`
    : `
      <div class="install-banner-icon">📲</div>
      <div class="install-banner-text">
        <div class="install-banner-title">Install Taruna Inti di iPhone/iPad</div>
        <div class="install-banner-desc">Ketuk tombol Share <span class="install-banner-share-icon">⎋</span> di Safari, lalu pilih "Add to Home Screen".</div>
      </div>
      <div class="install-banner-actions">
        <button type="button" class="icon-btn" id="install-banner-close" title="Tutup" aria-label="Tutup">✕</button>
      </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(()=> el.classList.add('show'));

  document.getElementById('install-banner-close').onclick = sembunyikanInstallPromptSementara;
  if (androidMode){
    document.getElementById('install-banner-btn').onclick = async ()=>{
      if (!_deferredInstallPrompt) return;
      tutupInstallBanner();
      _deferredInstallPrompt.prompt();
      const { outcome } = await _deferredInstallPrompt.userChoice;
      _deferredInstallPrompt = null;
      if (outcome === 'accepted'){
        toast('✓ Terima kasih! Aplikasi sedang di-install…');
      }
      // Kalau user pilih "dismiss" di dialog bawaan browser, jangan langsung
      // tawari lagi di sesi yang sama — snooze biasa spt tombol ✕.
      else {
        sembunyikanInstallPromptSementara();
      }
    };
  }
}

// --- Jalur Android/Chrome dkk: tunggu event dari browser ---
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault(); // cegah mini-infobar bawaan, kita pakai banner sendiri
  _deferredInstallPrompt = e;
  if (appSudahStandalone() || installPromptSedangDisembunyikan()) return;
  tampilkanInstallBanner({androidMode:true});
});

// Kalau ternyata sudah/baru saja ter-install (baik lewat banner ini
// maupun lewat menu browser langsung), pastikan banner hilang & jangan
// muncul lagi.
window.addEventListener('appinstalled', ()=>{
  tutupInstallBanner();
  _deferredInstallPrompt = null;
});

// --- Jalur iOS Safari: tidak ada event, cek manual saat load ---
window.addEventListener('load', ()=>{
  if (appSudahStandalone() || installPromptSedangDisembunyikan()) return;
  if (iOSSafariBelumInstall()){
    // Kasih jeda sebentar supaya tidak "menghadang" muka user persis pas
    // halaman baru kebuka (dan supaya tidak tabrakan sama toast lain saat init).
    setTimeout(()=>{
      if (!appSudahStandalone() && !installPromptSedangDisembunyikan()){
        tampilkanInstallBanner({androidMode:false});
      }
    }, 1500);
  }
});
