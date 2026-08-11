/* ============================================================
   INIT
   ============================================================ */
document.getElementById('event-select').addEventListener('change', (e)=>{ 
  if (canEdit()) setActiveEvent(e.target.value); 
  else toast('⛔ Login untuk mengubah event');
});
document.getElementById('btn-new-event').addEventListener('click', openEventModal);
document.getElementById('nav').addEventListener('click', (e)=>{
  const item = e.target.closest('[data-nav]');
  if(item) goSection(item.dataset.nav);
});
document.getElementById('nav-global').addEventListener('click', (e)=>{
  const item = e.target.closest('[data-nav]');
  if(item) goSection(item.dataset.nav);
});
document.getElementById('menu-toggle').addEventListener('click', ()=>{
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-backdrop').classList.toggle('show');
});
document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('show');
}

/* ============================================================
   SIDEBAR MINIMIZE (icon-only) — khusus desktop.
   State disimpan di localStorage supaya tetap collapsed/expanded
   walau halaman di-refresh. Tidak berlaku di mobile (di mobile
   sidebar tetap overlay penuh, lihat CSS @media max-width:820px).
   ============================================================ */
const SIDEBAR_COLLAPSED_KEY = 'merdeka_sidebar_collapsed';
function applySidebarCollapsed(collapsed){
  const label = collapsed ? 'Perbesar menu' : 'Perkecil menu';
  document.getElementById('sidebar').classList.toggle('collapsed', collapsed);
  const btn = document.getElementById('sidebar-collapse-toggle');
  btn.setAttribute('title', label);
  btn.setAttribute('aria-label', label);
}
(function initSidebarCollapse(){
  let collapsed = false;
  try { collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; } catch(e){}
  applySidebarCollapsed(collapsed);
})();
document.getElementById('sidebar-collapse-toggle').addEventListener('click', ()=>{
  const collapsed = !document.getElementById('sidebar').classList.contains('collapsed');
  applySidebarCollapsed(collapsed);
  try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch(e){}
});

/* ============================================================
   OFFLINE GUARD
   ============================================================
   Kalau perangkat kehilangan koneksi internet, layar dibuat buram +
   dikunci (lihat .offline-overlay di style.css) supaya user TIDAK BISA
   input/edit data sama sekali selama offline. Ini untuk mencegah skenario
   konflik data: user A input sesuatu saat offline pakai data yang sudah
   basi di layarnya, lalu begitu online lagi perubahannya bentrok/menimpa
   perubahan user B yang sudah tersimpan di server duluan.
   Begitu koneksi kembali, overlay hilang otomatis dan data langsung
   ditarik ulang dari server (refreshFromServer) supaya user melihat versi
   terbaru sebelum lanjut input.
*/
let _offlineToastShown = false;

function _setOfflineOverlay(show){
  const el = document.getElementById('offline-overlay');
  if(!el) return;
  el.classList.toggle('show', show);
  el.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function _handleOffline(){
  _setOfflineOverlay(true);
  if(!_offlineToastShown){
    _offlineToastShown = true;
    toast('⚠️ Koneksi internet terputus. Input dinonaktifkan sementara.', 4000);
  }
}

function _handleOnline(){
  _setOfflineOverlay(false);
  if(_offlineToastShown){
    _offlineToastShown = false;
    toast('✅ Koneksi internet kembali. Menyinkronkan data terbaru...', 3000);
  }
  // Tarik ulang data terbaru dari server begitu online lagi, supaya user
  // tidak melanjutkan input di atas data yang mungkin sudah usang.
  if(typeof refreshFromServer === 'function') refreshFromServer();
}

function initOfflineGuard(){
  // Cek status begitu app dibuka — kalau ternyata sudah offline dari awal,
  // langsung kunci layar tanpa harus menunggu event 'offline' terpicu.
  if(!navigator.onLine) _handleOffline();
  window.addEventListener('offline', _handleOffline);
  window.addEventListener('online', _handleOnline);
}
initOfflineGuard();

(async function initApp(){
  // Sebelumnya cuma ada toast() yang otomatis hilang dalam 2.4 detik — kalau
  // koneksi lambat (lumrah di lapangan/lokasi acara), setelah toast hilang
  // user tinggal menatap layar #content yang KOSONG MELOMPONG tanpa keterangan
  // apa pun, kelihatan persis seperti aplikasi hang. Sekarang dipasang layar
  // loading yang tetap ada SELAMA proses berlangsung, bukan cuma sekilas.
  const contentEl = document.getElementById('content');
  contentEl.innerHTML = `
    <div class="initial-loading" id="initial-loading">
      <div class="spinner"></div>
      <div class="msg" id="initial-loading-msg">⏳ Mengunduh data dari pusat...</div>
      <button type="button" class="btn secondary small retry-btn" id="initial-loading-retry" onclick="location.reload()">🔄 Muat Ulang Halaman</button>
    </div>`;
  // Kalau lebih dari 6 detik belum selesai, kasih tahu ini soal sinyal lambat
  // (bukan aplikasi macet) — supaya user tidak buru-buru nutup app.
  const slowTimer = setTimeout(() => {
    const msgEl = document.getElementById('initial-loading-msg');
    if(msgEl){ msgEl.textContent = '📶 Koneksi lambat, mohon tunggu sebentar...'; msgEl.classList.add('slow'); }
  }, 6000);

  // VALIDASI SESI KE SERVER sebelum memuat data.
  // Sebelumnya status login dipercaya begitu saja dari localStorage
  // (kt_auth_user), jadi sesi yang sudah dicabut admin / kedaluwarsa masih
  // terlihat "login" sampai user menekan logout sendiri — dan role di
  // localStorage bahkan bisa diedit manual jadi "admin" lewat DevTools.
  // Sekarang token diverifikasi ke server (rpc_session_user); yang menentukan
  // role sebenarnya adalah baris kt_sessions di database, bukan localStorage.
  // Catatan: ini hanya soal tampilan/UX — pengamanan sesungguhnya ada di RLS
  // policy yang memeriksa session_is_logged_in()/session_is_admin() di server.
  await validateSession();

  db = await loadDB();
  clearTimeout(slowTimer);

  if(db._loadFailed){
    // Gagal total (server tidak terjangkau dkk) — jangan lanjut menampilkan
    // dashboard dengan data kosong seolah-olah organisasi ini memang belum
    // punya data apa pun. Kasih tombol coba lagi yang jelas.
    const msgEl = document.getElementById('initial-loading-msg');
    const retryBtn = document.getElementById('initial-loading-retry');
    if(msgEl){ msgEl.textContent = '⚠️ Gagal memuat data. Cek koneksi internet, lalu coba lagi.'; msgEl.classList.remove('slow'); }
    if(retryBtn) retryBtn.style.display = 'inline-flex';
    return;
  }

  // Catat waktu terakhir app dibuka untuk user yang sesinya masih tersimpan
  // di localStorage (kasus login lewat form sudah dicatat sendiri oleh
  // rpc_login). Jalan di belakang layar, tidak memblokir tampilan awal.
  const _loggedInUser = getCurrentUser();
  if (_loggedInUser) touchLastSeen(_loggedInUser.id);

  applyTemaWarna(eventTema(activeEvent()).key);
  applyOrgBranding();
  renderSidebar();
  renderTopbarSaldo();
  initTourButton();
  // Buka kembali halaman terakhir yang dikunjungi (tersimpan di localStorage)
  // supaya refresh (F5) tidak selalu melempar user balik ke Buku Kegiatan.
  // Kalau belum pernah ada / key sudah tidak dikenal, baru fallback ke dashboard.
  let lastSection = 'dashboard';
  try {
    const saved = localStorage.getItem(LAST_SECTION_KEY);
    if (saved && SECTIONS.some(s => s.key === saved)) lastSection = saved;
  } catch(e){}
  goSection(lastSection);
  // Muat data Gudang di belakang layar (tidak memblokir tampilan awal) supaya
  // saat pertama kali buka menu Gudang, datanya sudah siap tanpa jeda loading.
  loadGudangData();

  // Log Error (kt_error_log) — cuma di-preload utk Admin (yg satu-satunya
  // role yang bisa melihatnya, lihat card notifikasi Dashboard & Pengaturan
  // di 07-dashboard.js/15-pengaturan-event.js). Sama pola dgn loadGudangData()
  // di atas: jalan di belakang layar, tidak memblokir tampilan awal.
  if (isAdmin()) loadErrorLogFromCloud();

  // Snapshot otomatis harian (lihat js/15b-snapshot.js) — jalan di belakang
  // layar, tidak memblokir tampilan awal. Cuma benar-benar bikin snapshot
  // kalau hari ini belum ada snapshot sama sekali & user sedang login.
  cobaSnapshotHarian();

  // Auto-refresh: tarik ulang data tiap 20 detik supaya perubahan dari
  // device/akun lain terlihat tanpa perlu reload manual (lihat bagian
  // AUTO-REFRESH di atas untuk pengaman-pengamannya).
  setInterval(refreshFromServer, AUTO_REFRESH_INTERVAL_MS);
  // Juga refresh langsung begitu user kembali ke tab ini (mis. habis pindah
  // app lain di HP terus balik lagi) — biar tidak perlu nunggu interval jalan.
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') refreshFromServer();
  });

  // Antrian notifikasi Telegram (gagal kirim / kena Jam Tenang) — coba kirim
  // ulang otomatis: sekali saat app baru dibuka, tiap kali koneksi online
  // lagi, dan berkala tiap 5 menit (untuk kasus Jam Tenang yang baru saja
  // berakhir). Lihat flushTelegramQueue() di js/04-event-settings.js.
  flushTelegramQueue();
  window.addEventListener('online', flushTelegramQueue);
  setInterval(flushTelegramQueue, 5 * 60 * 1000);

  // Antrian log error yang gagal tersimpan ke server (mis. toast error-nya
  // sendiri terjadi pas lagi offline) — pola sama persis dgn antrian
  // Telegram di atas. Lihat flushErrorLogQueue() di js/16-ui-helpers.js.
  flushErrorLogQueue();
  window.addEventListener('online', flushErrorLogQueue);
  setInterval(flushErrorLogQueue, 5 * 60 * 1000);
})();
