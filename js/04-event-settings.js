/* ============================================================
   TEMA WARNA PER EVENT
   ============================================================
   Warna utama aplikasi (sidebar, tombol, aksen) dikendalikan lewat 3 CSS
   variable: --merah, --merah-dark, --merah-tint (lihat :root di style.css).
   Tiap event bisa punya `warna_tema` sendiri (salah satu key di
   PRESET_TEMA) — begitu event di-switch, applyTemaWarna() menimpa 3
   variable itu di :root supaya tampilan langsung berubah tanpa reload.
   Default 'hijau' dipakai untuk event lama yang belum pernah pilih tema.
   ============================================================ */
const PRESET_TEMA = [
  {key:'hijau',  label:'Hijau (Default)', main:'#2F7D5A', dark:'#1D4B36', tint:'#E1EFE7'},
  {key:'merah',  label:'Merah Bata',      main:'#B5423E', dark:'#7A2A27', tint:'#F3E0DE'},
  {key:'biru',   label:'Biru Teal',       main:'#2E7D82', dark:'#1B4D50', tint:'#DCEDEC'},
  {key:'ungu',   label:'Ungu',            main:'#7B4C8C', dark:'#4E2F59', tint:'#EDE1F0'},
  {key:'oranye', label:'Oranye',          main:'#B8763A', dark:'#7A4E22', tint:'#F1E2D2'},
  {key:'pink',   label:'Pink',            main:'#C94C7C', dark:'#832F51', tint:'#F5E0E8'},
  {key:'emas',   label:'Emas',            main:'#C99A3C', dark:'#8A6A1E', tint:'#F6ECD3'},
];

function eventTema(ev){
  const key = (ev && ev.warna_tema) || 'hijau';
  return PRESET_TEMA.find(t=>t.key===key) || PRESET_TEMA[0];
}

function applyTemaWarna(key){
  const tema = PRESET_TEMA.find(t=>t.key===key) || PRESET_TEMA[0];
  const root = document.documentElement.style;
  root.setProperty('--merah', tema.main);
  root.setProperty('--merah-dark', tema.dark);
  root.setProperty('--merah-tint', tema.tint);
  // Samakan juga warna chrome browser/PWA (address bar di HP) dengan tema aktif.
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if(metaTheme) metaTheme.setAttribute('content', tema.dark);
}

function eid(){ return db.activeEventId; }
function getSettings(){
  if(!eid()) return {tarif:{sekolah:0,bekerja:0,perantauan:0,khusus:0}, hadiahBudget:{}, dokumen:{}, kategoriToko:{customCategories:[],keywords:{}}, kuponJalanSantai:{harga:0,stok:0}};
  if(!db.settings[eid()]) db.settings[eid()] = {tarif:{sekolah:0,bekerja:0,perantauan:0,khusus:0}, hadiahBudget:{}, dokumen:{}, kategoriToko:{customCategories:[],keywords:{}}, kuponJalanSantai:{harga:0,stok:0}};
  if(!db.settings[eid()].hadiahBudget) db.settings[eid()].hadiahBudget = {};
  if(!db.settings[eid()].dokumen) db.settings[eid()].dokumen = {};
  // Harga & Stok Kupon Jalan Santai — dipakai menu "Jual Kupon Jalan Santai" di
  // Pemasukan Lain (js/09-donatur-transaksi-operasional.js) supaya user tinggal
  // input jumlah kupon terjual, nominal dihitung otomatis dari harga yg diatur
  // admin di sini. stok = total lembar kupon yang dicetak/tersedia untuk event
  // ini; sisa stok dihitung on-the-fly (stok - total kuponQty terjual di
  // db.transaksiLain), bukan disimpan terpisah, supaya tidak pernah "nyleneh"/
  // meleset walau ada transaksi kupon yang diedit atau dihapus manual.
  if(!db.settings[eid()].kuponJalanSantai) db.settings[eid()].kuponJalanSantai = {harga:0,stok:0};
  if(db.settings[eid()].kuponJalanSantai.stok===undefined) db.settings[eid()].kuponJalanSantai.stok = 0;
  // kategoriToko: kategori toko kustom + kata kunci tambahan untuk pengelompokan
  // checklist Belanja Hadiah/Perlengkapan (lihat KATEGORI_TOKO_LIST di 11-belanja.js).
  // Per-event karena kebutuhan lomba beda tiap tahun (mis. alat olahraga, dekorasi).
  if(!db.settings[eid()].kategoriToko) db.settings[eid()].kategoriToko = {customCategories:[],keywords:{}};
  if(!db.settings[eid()].kategoriToko.customCategories) db.settings[eid()].kategoriToko.customCategories = [];
  if(!db.settings[eid()].kategoriToko.keywords) db.settings[eid()].kategoriToko.keywords = {};
  return db.settings[eid()];
}
// Surat & Dokumen tidak terikat event — satu set draft global untuk seluruh
// organisasi, sama seperti Gudang. Lihat syncDokumenGlobal()/kt_dokumen_global.
function getDokumenGlobal(){
  if(!db.dokumenGlobal) db.dokumenGlobal = {};
  if(!db.dokumenGlobal.undangan) db.dokumenGlobal.undangan = {};
  if(!db.dokumenGlobal.proposal) db.dokumenGlobal.proposal = {};
  if(!db.dokumenGlobal.absensi) db.dokumenGlobal.absensi = {};
  if(!db.dokumenGlobal.jadwal_sinoman) db.dokumenGlobal.jadwal_sinoman = {
    judul: '', tempat: '',
    rows: Array.from({length:5}, () => ({ pagi:'', siang:'', sore:'' })),
  };
  if(!Array.isArray(db.dokumenGlobal.jadwal_sinoman.rows) || !db.dokumenGlobal.jadwal_sinoman.rows.length){
    db.dokumenGlobal.jadwal_sinoman.rows = Array.from({length:5}, () => ({ pagi:'', siang:'', sore:'' }));
  }
  // Jadwal Petugas — blok kedua yang tampilannya sama persis seperti Jadwal
  // Sinoman di atas, cuma beda label kolom (Petugas A/B/C, bukan Pagi/Siang/
  // Sore). Lihat JADWAL_BLOCKS di js/14-dokumen.js.
  if(!db.dokumenGlobal.jadwal_petugas) db.dokumenGlobal.jadwal_petugas = {
    judul: '', tempat: '',
    rows: Array.from({length:3}, () => ({ a:'', b:'', c:'' })),
  };
  if(!Array.isArray(db.dokumenGlobal.jadwal_petugas.rows) || !db.dokumenGlobal.jadwal_petugas.rows.length){
    db.dokumenGlobal.jadwal_petugas.rows = Array.from({length:3}, () => ({ a:'', b:'', c:'' }));
  }
  return db.dokumenGlobal;
}

// Budget hadiah diatur per kombinasi Kategori Peserta (anak/ibu/dst) x Juara (1/2/3/partisipasi).
// Dipakai sebagai acuan target belanja hadiah, dibandingkan dengan total belanja aktual per paket.
function getHadiahBudget(kategoriPeserta, juaraKe){
  const s = getSettings();
  return Number((s.hadiahBudget[kategoriPeserta] || {})[juaraKe] || 0);
}

/* ============================================================
   TELEGRAM NOTIFICATION
   ============================================================
   "Dimaksimalkan" lewat 3 hal (lihat masing-masing bagian di bawah):
   1. KATEGORI — admin bisa matikan notifikasi jenis tertentu (mis. Gudang)
      tanpa mematikan semua notifikasi sekaligus (lihat TELEGRAM_CATEGORIES).
   2. KEANDALAN — kalau gagal kirim (internet putus, error Telegram, kena
      rate limit) pesan di-retry otomatis beberapa kali, dan kalau tetap
      gagal disimpan ke antrian offline (localStorage) untuk dicoba lagi
      otomatis nanti — bukan hilang diam-diam seperti sebelumnya (dulu
      cuma console.error, user tidak pernah tahu ada notifikasi gagal).
   3. JAM TENANG — admin bisa atur rentang jam supaya tidak spam notifikasi
      tengah malam; pesan yang masuk saat jam tenang otomatis ditahan di
      antrian yang sama dan baru dikirim begitu jam tenang berakhir.
   ============================================================ */

// TELEGRAM_CATEGORIES, defaultTelegramCategories(), dan defaultTelegramQuietHours()
// didefinisikan di js/03-db-core.js (bukan di sini) — lihat catatan di sana
// soal kenapa (defaultDB() butuh fungsi ini sebelum file ini sempat dimuat).

// Selalu kembalikan bentuk LENGKAP (categories & quietHours tergabung dengan
// default) supaya pemanggil lain tidak perlu tahu soal migrasi data lama yang
// belum punya field ini — sama seperti pola getSettings()/getHadiahBudget().
function getTelegramSettings(){
  const t = db.telegram || {};
  return {
    botToken: t.botToken || '',
    chatId: t.chatId || '',
    enabled: !!t.enabled,
    categories: { ...defaultTelegramCategories(), ...(t.categories||{}) },
    quietHours: { ...defaultTelegramQuietHours(), ...(t.quietHours||{}) },
  };
}

/* ============================================================
   PROFIL ORGANISASI
   ============================================================
   Satu-satunya sumber nama organisasi/logo/nama kas yang tampil di seluruh
   app (sidebar, kop surat, nota, pesan Telegram, dll). Diatur admin lewat
   Pengaturan > Profil Organisasi (lihat renderPengaturan() &
   simpanOrgProfile() di js/15-pengaturan-event.js). Kalau belum pernah
   diisi, otomatis fallback ke DEFAULT_ORG_PROFILE (lihat js/03-db-core.js)
   supaya tampilan tetap seperti sebelumnya sampai admin ganti sendiri.
   ============================================================ */
function getOrgProfil(){
  if(!db.orgProfile) db.orgProfile = { ...DEFAULT_ORG_PROFILE };
  return db.orgProfile;
}
function getOrgNama(){ return getOrgProfil().nama || DEFAULT_ORG_PROFILE.nama; }
function getOrgNamaKas(){ return getOrgProfil().namaKas || DEFAULT_ORG_PROFILE.namaKas; }
// Kembalikan logo custom (base64 data URI) kalau admin sudah upload sendiri,
// kalau belum, fallback ke file statis icons/logo-kop.png (logo bawaan app).
function getOrgLogo(){ return getOrgProfil().logo || 'icons/logo-kop.png'; }

// Dorong nama organisasi ke bagian-bagian statis di index.html yang dirender
// SEBELUM data ter-load (judul tab browser & nama di sidebar) — satu-satunya
// tempat "putih polos" yang tidak bisa dibaca langsung dari template string
// seperti panel/render lain, jadi perlu diisi manual di sini. Dipanggil sekali
// saat initApp() (js/19-init.js) dan lagi tiap kali Profil Organisasi disimpan.
function applyOrgBranding(){
  const nama = getOrgNama();
  const brandTitle = document.querySelector('.sidebar .brand h1');
  if(brandTitle) brandTitle.textContent = nama.toUpperCase();
  document.title = nama;
}

/* ============================================================
   AKSES GUEST (menu apa saja yang boleh dilihat tanpa login)
   ============================================================ */
function isGuestVisible(sectionKey){
  // Default: section boleh dilihat guest kecuali eksplisit diset false
  return !(db.guestMenu && db.guestMenu[sectionKey] === false);
}

function saveTelegramSettings(settings){
  db.telegram = settings;
  saveDB();
}

/* ------------------------------------------------------------
   KEANDALAN: retry otomatis + antrian offline
   ------------------------------------------------------------
   Dulu kalau sendTelegramNotification() gagal (koneksi putus/error Telegram),
   pesan langsung hilang — cuma console.error, tidak ada jejak sama sekali.
   Sekarang: setiap kegagalan dicoba lagi beberapa kali (dengan jeda), dan
   kalau tetap gagal disimpan ke antrian di localStorage supaya bisa dicoba
   lagi otomatis nanti (lihat flushTelegramQueue(), dipanggil dari
   js/19-init.js saat online lagi / berkala / saat app dibuka).
   ------------------------------------------------------------ */
const TELEGRAM_RETRY_DELAYS_MS = [0, 1500, 4000]; // percobaan ke-1 langsung, lalu jeda makin lama
const TELEGRAM_QUEUE_KEY = 'kt_telegram_pending_queue';
const TELEGRAM_QUEUE_MAX = 50; // batasi ukuran antrian supaya tidak numpuk tak terbatas kalau offline lama
const TELEGRAM_QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // buang pesan lebih basi dari 7 hari

function _sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

// Pengiriman notifikasi TIDAK LAGI memanggil api.telegram.org langsung dari
// browser. Dulu URL-nya mengandung `settings.botToken` yang dibaca dari tabel
// kt_telegram_settings — dan tabel itu bisa dibaca siapa pun lewat anon key,
// jadi bot token efektif publik dan bisa diambil alih orang lain.
// Sekarang klien POST ke /api/telegram (same-origin). Bot token hidup sebagai
// secret Cloudflare Worker (lihat src/worker.js) dan tidak pernah dikirim ke
// browser sama sekali. Worker memverifikasi sesi login dulu, menerapkan rate
// limit, lalu meneruskan respons Telegram apa adanya — termasuk error_code 429
// + parameters.retry_after, supaya logika retry/backoff di bawah tetap jalan.
async function _telegramApiCall(settings, message){
  const headers = { 'Content-Type': 'application/json' };
  try{
    const token = localStorage.getItem('kt_session_token');
    if(token) headers['x-session-token'] = token;
  }catch(e){}

  const response = await fetch('/api/telegram', {
    method: 'POST',
    headers,
    body: JSON.stringify({ chat_id: settings.chatId, text: message })
  });
  const result = await response.json();
  return { ok: !!result.ok, result };
}

function _loadTelegramQueue(){
  try{
    const raw = localStorage.getItem(TELEGRAM_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch(e){ return []; }
}
function _saveTelegramQueue(queue){
  // localStorage bisa penuh/diblokir (mode privat dsb) — kalau gagal simpan,
  // antrian cuma hidup di memori untuk sesi ini, tidak perlu sampai crash app.
  try{ localStorage.setItem(TELEGRAM_QUEUE_KEY, JSON.stringify(queue)); }catch(e){}
}
function _queueTelegramMessage(message){
  let queue = _loadTelegramQueue();
  queue.push({ message, ts: Date.now() });
  if(queue.length > TELEGRAM_QUEUE_MAX) queue = queue.slice(queue.length - TELEGRAM_QUEUE_MAX);
  _saveTelegramQueue(queue);
}
// Dipakai di UI Pengaturan untuk kasih tahu admin ada berapa notifikasi yang
// masih menunggu dikirim (gagal/kena jam tenang), plus tombol kirim ulang manual.
function getTelegramQueueCount(){ return _loadTelegramQueue().length; }

let _telegramFlushInProgress = false;
async function flushTelegramQueue(){
  if(_telegramFlushInProgress) return;
  const settings = getTelegramSettings();
  // Dulu guard ini juga mengecek settings.botToken. Token sekarang ada di
  // server (secret Worker) dan klien memang tidak memilikinya, jadi yang
  // relevan diperiksa di sini tinggal chatId.
  if(!settings.enabled || !settings.chatId) return;
  // Jangan kirim antrian selagi masih jam tenang — coba lagi otomatis lewat
  // interval berkala setelah jam tenang berakhir (lihat js/19-init.js).
  if(isWithinQuietHours(settings)) return;
  let queue = _loadTelegramQueue();
  if(!queue.length) return;
  const now = Date.now();
  const beforeFilter = queue.length;
  queue = queue.filter(item => (now - item.ts) < TELEGRAM_QUEUE_MAX_AGE_MS);
  if(queue.length !== beforeFilter) _saveTelegramQueue(queue);
  if(!queue.length) return;
  _telegramFlushInProgress = true;
  try{
    while(queue.length){
      let sentOk = false;
      try{
        const { ok } = await _telegramApiCall(settings, queue[0].message);
        sentOk = ok;
      }catch(e){ sentOk = false; }
      if(!sentOk) break; // masih gagal — hentikan, sisanya dicoba lagi nanti (urutan tetap terjaga)
      queue.shift();
      _saveTelegramQueue(queue);
    }
  } finally {
    _telegramFlushInProgress = false;
  }
}

async function sendTelegramNotification(message, isTest = false){
  const settings = getTelegramSettings();
  if(!settings.enabled || !settings.chatId){
    if(isTest) toast('⚠️ Telegram belum dikonfigurasi. Atur di Pengaturan.');
    return false;
  }
  for(let attempt = 0; attempt < TELEGRAM_RETRY_DELAYS_MS.length; attempt++){
    if(TELEGRAM_RETRY_DELAYS_MS[attempt] > 0) await _sleep(TELEGRAM_RETRY_DELAYS_MS[attempt]);
    try{
      const { ok, result } = await _telegramApiCall(settings, message);
      if(ok){
        if(isTest) toast('✅ Notifikasi Telegram berhasil dikirim!');
        return true;
      }
      // Kena rate limit Telegram — tunggu sesuai retry_after (dibatasi maks 10
      // detik supaya tidak menggantung lama), lalu coba lagi di iterasi berikutnya.
      if(result?.error_code === 429 && result?.parameters?.retry_after){
        await _sleep(Math.min(result.parameters.retry_after * 1000, 10000));
        continue;
      }
      console.error('Telegram error:', result);
      // Error selain rate-limit (token/chat id salah dsb) besar kemungkinan akan
      // gagal lagi kalau di-retry — hentikan percobaan, tidak perlu buang waktu.
      break;
    }catch(e){
      console.error('Telegram send error:', e);
      // Kemungkinan cuma masalah koneksi sesaat — lanjut ke percobaan berikutnya.
    }
  }
  if(isTest){
    toast('❌ Gagal kirim notifikasi. Cek token, chat ID, atau koneksi internet.');
    return false;
  }
  // Semua percobaan gagal — simpan ke antrian offline supaya dicoba lagi
  // otomatis nanti (lihat flushTelegramQueue()), bukan hilang begitu saja.
  _queueTelegramMessage(message);
  return false;
}

// Telegram parse_mode 'HTML' hanya mengizinkan tag tertentu; karakter < > & pada teks dinamis
// (nama anggota/keterangan dsb, yang berasal dari input user) harus di-escape, kalau tidak
// Telegram akan menolak seluruh pesan (parse error) dan notifikasi gagal terkirim tanpa
// pemberitahuan ke user (hanya console.error).
function escTelegram(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Buang semua ikon/emoji dari teks notifikasi Telegram (dipakai baik untuk
// bagian statis pesan maupun `action`/`data` yang dikirim tiap pemanggil
// notifyTelegram() — jadi cukup diterapkan SEKALI di sini, tidak perlu ubah
// satu-satu di ~70 tempat pemanggilan yang tersebar di seluruh app). Rentang
// unicode di bawah ini mencakup emoji pictograph, dingbat, simbol misc, dan
// panah (↩️ ↓ dst) yang dipakai di action message app ini.
function stripEmoji(s){
  return String(s ?? '')
    .replace(/[\u{1F1E6}-\u{1FFFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function formatNotificationMessage(action, data, eventName){
  const timestamp = new Date().toLocaleString('id-ID');
  const user = getCurrentUser();
  const userName = user ? user.name : 'Guest (View Only)';
  const userRole = user ? user.role : 'guest';
  let msg = `<b>${escTelegram(getOrgNama())} - Buku Keuangan</b>\n\n`;
  msg += `<b>Event:</b> ${escTelegram(eventName)}\n`;
  msg += `<b>Waktu:</b> ${escTelegram(timestamp)}\n`;
  msg += `<b>User:</b> ${escTelegram(userName)} (${escTelegram(userRole)})\n\n`;
  msg += `<b>Aksi:</b> ${escTelegram(stripEmoji(action))}\n`;
  if(data) msg += `<b>Detail:</b>\n${escTelegram(stripEmoji(data))}\n`;
  
  if(activeEvent()){
    const {saldo, pemasukan, pengeluaran} = hitungBukuUtama();
    msg += `\n<b>Saldo Akhir:</b> ${fmtRp(saldo)}`;
    msg += `\n<b>Pemasukan:</b> ${fmtRp(pemasukan)}`;
    msg += `\n<b>Pengeluaran:</b> ${fmtRp(pengeluaran)}`;
  }
  return msg;
}

/* ------------------------------------------------------------
   JAM TENANG
   ------------------------------------------------------------
   Rentang start/end format "HH:MM". Mendukung rentang yang melewati
   tengah malam (mis. 22:00–06:00) maupun rentang biasa dalam hari yang
   sama (mis. 13:00–15:00).
   ------------------------------------------------------------ */
function isWithinQuietHours(settings){
  const qh = settings?.quietHours;
  if(!qh || !qh.enabled || !qh.start || !qh.end) return false;
  const [sh, sm] = qh.start.split(':').map(Number);
  const [eh, em] = qh.end.split(':').map(Number);
  if([sh,sm,eh,em].some(n => Number.isNaN(n))) return false;
  const startMin = sh*60 + sm, endMin = eh*60 + em;
  if(startMin === endMin) return false; // rentang kosong, anggap tidak aktif
  const now = new Date();
  const curMin = now.getHours()*60 + now.getMinutes();
  if(startMin < endMin) return curMin >= startMin && curMin < endMin;
  // Rentang melewati tengah malam, mis. 22:00–06:00
  return curMin >= startMin || curMin < endMin;
}

async function notifyTelegram(action, data = '', category = 'umum'){
  const settings = getTelegramSettings();
  if(!settings.enabled) return;
  // Kategori dimatikan admin lewat Pengaturan → lewati sepenuhnya, tidak
  // dikirim maupun diantrikan.
  if(settings.categories && settings.categories[category] === false) return;
  // Only notify if user is logged in (not guest)
  if(!getCurrentUser()) return;
  const eventName = activeEvent()?.nama || 'Tidak ada event aktif';
  const message = formatNotificationMessage(action, data, eventName);
  if(isWithinQuietHours(settings)){
    // Jam tenang aktif — tahan pesan di antrian yang sama dengan antrian
    // retry gagal-kirim; otomatis terkirim begitu jam tenang berakhir
    // (lihat flushTelegramQueue(), dipanggil berkala dari js/19-init.js).
    _queueTelegramMessage(message);
    return;
  }
  await sendTelegramNotification(message);
}

