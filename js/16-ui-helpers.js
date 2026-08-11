/* ============================================================
   MODAL / TOAST HELPERS
   ============================================================ */
function setModal(title, bodyHtml, buttons){
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-foot').innerHTML = '';
  const foot = document.getElementById('modal-foot');
  buttons.forEach(b=>{
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.cls||'');
    btn.textContent = b.label;
    btn.type = 'button';
    btn.onclick = b.onclick;
    if(b.id) btn.id = b.id;
    foot.appendChild(btn);
  });
  document.getElementById('overlay').classList.add('show');
  
  // Setup currency inputs after modal body is rendered
  setTimeout(setupAllCurrencyInputs, 50);
  setTimeout(setupAutoResizeTextareas, 50);
}
function closeModal(){ document.getElementById('overlay').classList.remove('show'); if(typeof closeAllGudangCombos==='function') closeAllGudangCombos(); if(typeof closeLombaNamaCombo==='function') closeLombaNamaCombo(); }
document.getElementById('modal-close').onclick = closeModal;
// Catatan: tutup overlay HANYA jika mousedown & click sama-sama kena backdrop.
// Ini mencegah modal tertutup tidak sengaja saat user scroll/geser di dalam modal
// (jari mulai di dalam modal, geser, lalu lepas di area backdrop) atau saat
// posisi modal bergeser akibat munculnya keyboard di HP.
let overlayMouseDownOnBackdrop = false;
document.getElementById('overlay').addEventListener('mousedown', (e)=>{ overlayMouseDownOnBackdrop = (e.target.id==='overlay'); });
document.getElementById('overlay').addEventListener('click', (e)=>{ if(e.target.id==='overlay' && overlayMouseDownOnBackdrop) closeModal(); overlayMouseDownOnBackdrop = false; });

let toastTimer;

/* ============================================================
   LOG ERROR TOAST — disimpan di SERVER (tabel kt_error_log,
   lihat supabase-error-log-migration.sql), bukan cuma localStorage.
   ------------------------------------------------------------
   App ini belum punya konsep "toast merah" terpisah dari toast biasa —
   semua toast() dulu tampil dgn warna sama, cuma dibedakan lewat emoji
   di depan pesannya (konvensi yg sudah dipakai di ~500 pemanggilan
   toast() di seluruh app: ⛔ = ditolak/gagal keras, ❌ = gagal, ⚠ =
   peringatan/gagal sebagian). Daripada mengubah semua pemanggilan itu
   satu-satu (berisiko & memakan waktu besar), deteksi dilakukan di sini,
   di satu titik (toast() sendiri), berdasarkan emoji di awal pesan.
   Deteksi berbasis teks msg SEBELUM DOM di-render, jadi tidak
   terpengaruh MutationObserver auto-replace emoji→ikon Lucide di
   21-icons-lucide.js (yg jalan belakangan, di rAF terpisah).

   Kenapa di server (bukan cuma localStorage per device seperti versi
   awal fitur ini): supaya Admin bisa lihat error dari SEMUA
   perangkat/pengurus di satu tempat (card notifikasi Dashboard &
   Pengaturan → Cadangan Data), bukan cuma error di device dia sendiri.

   Resiliensi offline: kalau INSERT ke server gagal (mis. toast errornya
   sendiri justru karena lagi offline), baris itu diantrikan dulu ke
   localStorage (ERROR_LOG_PENDING_QUEUE_KEY) lalu dicoba kirim ulang
   otomatis lewat flushErrorLogQueue() — dipanggil dari js/19-init.js
   sekali saat app dibuka, tiap koneksi online lagi, dan berkala tiap 5
   menit, pola sama persis dgn antrian notifikasi Telegram
   (_queueTelegramMessage/flushTelegramQueue di js/04-event-settings.js).
   Ini SENGAJA fire-and-forget (tidak di-await di dalam toast()) supaya
   toast() sendiri tidak pernah ketunda/gagal gara-gara pencatatan log.
   ============================================================ */
const TOAST_ERROR_EMOJI_REGEX = /^\s*[⛔❌⚠]/u;
const ERROR_LOG_PENDING_QUEUE_KEY = 'kt_error_log_pending_queue';
const ERROR_LOG_PENDING_QUEUE_MAX = 100; // batasi antrian offline biar tidak numpuk tanpa batas
const ERROR_LOG_FETCH_LIMIT = 300; // ambil 300 terbaru saja dari server, cukup buat diagnosis

let errorLogCloud = [];
let errorLogCloudLoaded = false;
let errorLogCloudLoading = false;

function _buildErrorLogRow(msg){
  return {
    message: String(msg).slice(0, 2000), // jaga-jaga biar 1 pesan aneh tidak bikin row raksasa
    section: (typeof currentSection !== 'undefined' ? currentSection : null),
    event_nama: (typeof activeEvent === 'function' && activeEvent()) ? activeEvent().nama : null,
    user_name: (typeof getCurrentUser === 'function' && getCurrentUser()) ? getCurrentUser().name : null,
    device_info: (navigator.userAgent || '').slice(0, 200),
    url: location.href
  };
}

function _loadErrorLogPendingQueue(){
  try{ return JSON.parse(localStorage.getItem(ERROR_LOG_PENDING_QUEUE_KEY) || '[]'); }
  catch{ return []; }
}
function _saveErrorLogPendingQueue(queue){
  try{ localStorage.setItem(ERROR_LOG_PENDING_QUEUE_KEY, JSON.stringify(queue)); }catch(e){}
}
function _queueErrorLogRow(row){
  let queue = _loadErrorLogPendingQueue();
  queue.push(row);
  if(queue.length > ERROR_LOG_PENDING_QUEUE_MAX) queue = queue.slice(queue.length - ERROR_LOG_PENDING_QUEUE_MAX);
  _saveErrorLogPendingQueue(queue);
}

async function _recordToastError(msg){
  const row = _buildErrorLogRow(msg);
  try{
    const {error} = await sb.from('kt_error_log').insert(row);
    if(error) throw error;
    errorLogCloudLoaded = false; // ada data baru di server, cache lama basi
  }catch(e){
    // Jangan sampai kegagalan mencatat log INI malah memicu toast error baru
    // (potensi loop) -- cukup ke console + antrikan utk dicoba lagi nanti.
    console.error('Gagal simpan log error ke server, diantrikan lokal:', e);
    _queueErrorLogRow(row);
  }
}

async function flushErrorLogQueue(){
  const queue = _loadErrorLogPendingQueue();
  if(!queue.length) return;
  const remaining = [];
  for(const row of queue){
    try{
      const {error} = await sb.from('kt_error_log').insert(row);
      if(error) throw error;
    }catch(e){
      remaining.push(row);
    }
  }
  _saveErrorLogPendingQueue(remaining);
  if(remaining.length !== queue.length) errorLogCloudLoaded = false;
}

async function loadErrorLogFromCloud(){
  if(errorLogCloudLoading) return;
  errorLogCloudLoading = true;
  try{
    const {data, error} = await sb.from('kt_error_log').select('*').order('created_at', {ascending:false}).limit(ERROR_LOG_FETCH_LIMIT);
    if(error) throw error;
    errorLogCloud = data || [];
    errorLogCloudLoaded = true;
  }catch(e){
    console.error('Gagal memuat log error dari server:', e);
  }finally{
    errorLogCloudLoading = false;
  }
}

function getErrorLogPendingCount(){ return _loadErrorLogPendingQueue().length; }

async function toastErrorLogExportJSON(){
  toast('⏳ Mengambil log error dari server...');
  await loadErrorLogFromCloud();
  const pending = _loadErrorLogPendingQueue();
  const cloudEntries = errorLogCloud.map(e => ({
    timestamp: e.created_at, message: e.message, section: e.section,
    event: e.event_nama, user: e.user_name, device: e.device_info, url: e.url
  }));
  const pendingEntries = pending.map(e => ({
    timestamp: null, message: e.message, section: e.section,
    event: e.event_nama, user: e.user_name, device: e.device_info, url: e.url,
    _belum_tersinkron_ke_server: true
  }));
  const entries = [...cloudEntries, ...pendingEntries];
  if(!entries.length){ toast('Belum ada error tercatat.'); return; }
  const payload = { exported_at: new Date().toISOString(), app: 'merdeka', count: entries.length, entries };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `toast-error-log-${todayISO()}.json`;
  a.click();
  toast('✅ Log error berhasil diekspor.');
}

async function toastErrorLogClear(){
  if(!isAdmin()){ toast('⛔ Hanya Admin'); return; }
  if(!await confirmModal('Hapus SEMUA log error di SERVER (dari semua perangkat/pengurus)? Tidak bisa dibatalkan.')) return;
  try{
    const {error} = await sb.from('kt_error_log').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if(error) throw error;
    _saveErrorLogPendingQueue([]);
    errorLogCloud = [];
    errorLogCloudLoaded = true;
    toast('🗑 Log error server dibersihkan.');
    if(typeof currentSection!=='undefined' && currentSection==='pengaturan' && typeof renderContent==='function') renderContent();
  }catch(e){
    console.error('Gagal menghapus log error di server:', e);
    toast('⛔ Gagal menghapus log error: ' + (e.message || 'error tak dikenal'));
  }
}

function toast(msg, durationMs = 2400){
  const t = document.getElementById('toast');
  t.textContent = msg;
  const isError = TOAST_ERROR_EMOJI_REGEX.test(msg);
  t.classList.toggle('toast-error', isError);
  if(isError) _recordToastError(msg);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), durationMs);
}

/* ============================================================
   LAZY LOADER html2canvas — sebelumnya dimuat lewat <script> di
   index.html di SETIAP kali app dibuka, padahal cuma dipakai untuk
   2 fitur export gambar (Nota Peminjaman Gudang & Jadwal Sinoman)
   yang jarang diklik. Sekarang baru diambil dari CDN saat salah
   satu fitur itu benar-benar dipakai, supaya loading awal app lebih
   ringan untuk semua user. Dipanggil dari js/14-dokumen.js dan
   js/17c-gudang-histori-kelola.js.
   ============================================================ */
let _html2canvasLoadPromise = null;
function ensureHtml2Canvas(){
  if (typeof html2canvas !== 'undefined') return Promise.resolve();
  if (_html2canvasLoadPromise) return _html2canvasLoadPromise;
  _html2canvasLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => resolve();
    s.onerror = () => { _html2canvasLoadPromise = null; reject(new Error('gagal memuat modul export gambar')); };
    document.head.appendChild(s);
  });
  return _html2canvasLoadPromise;
}

/* ============================================================
   PROMPT MODAL — pengganti window.prompt() bawaan browser (yang
   tampilannya "native" & tidak bisa di-style) dengan modal ber-tema
   app sendiri, pakai overlay/setModal yang sudah ada.
   Dipakai dgn async/await, contoh:
     const isi = await promptModal({title:'Isi per pack', label:'...', defaultValue:5, type:'number'});
     if(isi===null) return; // user tekan Batal
   type: 'text' (default) | 'number' | 'currency'
   ============================================================ */
function promptModal({title, label, hint, defaultValue, type='text', okLabel='OK', cancelLabel='Batal'}){
  return new Promise((resolve) => {
    const inputId = 'pm-input-' + uid();
    const isCurrency = type === 'currency';
    const isNumber = type === 'number';
    const initialVal = defaultValue==null ? '' : String(defaultValue);
    setModal(title, `
      <div class="field">
        ${label ? `<label>${esc(label)}</label>` : ''}
        <input id="${inputId}" class="${isCurrency?'currency-input':''}" type="${isNumber?'number':'text'}" value="${esc(isCurrency?formatCurrency(defaultValue):initialVal)}">
        ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
      </div>
    `, [
      {label:cancelLabel, cls:'secondary', onclick:()=>{ closeModal(); resolve(null); }},
      {label:okLabel, cls:'', onclick:()=>{
        const el = document.getElementById(inputId);
        const val = isCurrency ? getCurrencyValue(el) : el.value;
        closeModal();
        resolve(val);
      }}
    ]);
    setTimeout(()=>{
      const el = document.getElementById(inputId);
      if(!el) return;
      el.focus(); el.select();
      el.addEventListener('keydown', e=>{
        if(e.key==='Enter'){ e.preventDefault(); document.querySelector('#modal-foot .btn:not(.secondary)')?.click(); }
      });
    }, 60);
  });
}

/* ============================================================
   CONFIRM MODAL — pengganti window.confirm() bawaan browser (yang
   tampilannya "native", menampilkan nama domain, & tidak bisa
   di-style) dengan modal ber-tema app sendiri, pakai overlay/setModal
   yang sudah ada (sama seperti promptModal di atas).
   Dipakai dgn async/await, contoh:
     if(!(await confirmModal('Hapus data ini?'))) return;
   Opsional: confirmModal(pesan, {title, okLabel, cancelLabel, danger})
   - pesan boleh berisi '\n\n' (jadi paragraf terpisah) & '\n' biasa
     (jadi line-break dalam paragraf yang sama).
   - danger:true (default) bikin tombol OK pakai style merah, karena
     hampir semua confirm() di app ini untuk aksi hapus/berisiko.
   ============================================================ */
function confirmModal(message, {title='Konfirmasi', okLabel='OK', cancelLabel='Batal', danger=true}={}){
  return new Promise((resolve) => {
    const paragraf = String(message??'').split('\n\n')
      .map(p => `<p style="margin:0 0 10px;white-space:pre-line;line-height:1.5;">${esc(p)}</p>`)
      .join('');
    let resolved = false;
    const finish = (val) => { if(resolved) return; resolved = true; closeModal(); resolve(val); };
    setModal(title, `<div class="confirm-body">${paragraf}</div>`, [
      {label:cancelLabel, cls:'secondary', onclick:()=>finish(false)},
      {label:okLabel, cls:danger?'danger':'', onclick:()=>finish(true)}
    ]);
    setTimeout(()=>{ document.querySelector('#modal-foot .btn:not(.secondary)')?.focus(); }, 60);
  });
}

/* ============================================================
   FUNGSI HITUNG BUKU UTAMA
   ============================================================ */
function hitungBukuUtama(){
  const anggotaLunas = gAnggota().filter(a=>a.status==='lunas');
  const iuran = anggotaLunas.reduce((s,a)=>s+Number(a.nominal_wajib||0),0);
  const donaturList = gDonatur();
  // Donasi BARANG (jenis:'barang') sengaja TIDAK dihitung sebagai uang masuk —
  // dia bukan uang yang benar-benar ada di kas, cuma barang fisik. Cuma donasi
  // UANG (jenis:'uang', atau tanpa field jenis sama sekali = data lama sebelum
  // fitur ini ada) yang ikut menyusun saldo kas. Lihat renderDonatur() &
  // openDonaturModal() di js/09-donatur-transaksi-operasional.js.
  const donaturUangList = donaturList.filter(d=>(d.jenis||'uang')!=='barang');
  const donaturBarangList = donaturList.filter(d=>d.jenis==='barang');
  const donasi = donaturUangList.reduce((s,d)=>s+Number(d.jumlah||0),0);
  const transaksiLainList = gTransaksiLain();
  const transaksiLain = transaksiLainList.reduce((s,t)=>s+Number(t.jumlah||0),0);
  const pemasukan = iuran + donasi + transaksiLain;

  const operasionalList = gOperasional();
  const opsional = operasionalList.reduce((s,o)=>s+Number(o.jumlah||0),0);
  const lombaIds = gLomba().map(l=>l.id);
  const kebutuhanLombaList = db.lombaKebutuhan.filter(k=>lombaIds.includes(k.lomba_id));
  const belanjaPerlengkapan = new Map(gDaftarBelanjaPerlengkapan().filter(b=>b.status==='dibeli').map(b=>[b.kebutuhan_id,b]));
  const kebutuhanLomba = kebutuhanLombaList.reduce((s,k)=> {
    const b=belanjaPerlengkapan.get(k.id); if(!b) return s;
    return s + Number(b.nominal_realisasi ?? (Number(k.harga_realisasi ?? k.harga_estimasi ?? 0)*Number(k.qty||0)));
  }, 0);

  // Pakai hitungHargaAktualHadiahLomba() (di 11-belanja.js) supaya konsisten
  // dengan Belanja Hadiah — rumus flat harga_satuan*qty_dibeli mengabaikan
  // harga_eceran untuk sisa pcs yang dibeli satuan (lihat Bug #2).
  const hadiahAktual = hitungHargaAktualHadiahLomba({onlyPurchased:true});
  let hadiahLomba = hadiahAktual.total; let jumlahItemHadiahLomba = 0;
  gHadiahKategori().forEach(h => {
    // Hanya hitung item yang benar-benar sudah dibeli (qty_dibeli > 0),
    // konsisten dengan hitungHargaAktualHadiahLomba() yang juga melewati
    // item qty_dibeli <= 0 saat menjumlahkan hadiahLomba di atas. Kalau
    // tidak, jumlah item yang ditampilkan (Dashboard & LPJ) bisa lebih
    // besar dari jumlah item yang benar-benar berkontribusi ke nilai
    // rupiah yang ditampilkan di sebelahnya.
    h.items.forEach(item => { if (Number(item.qty_dibeli||0) > 0) jumlahItemHadiahLomba++; });
  });

  const hadiahJalanList = gHadiahJalanSantai();
  const belanjaJalan = new Map(gDaftarBelanjaJalanSantai().filter(b=>b.status==='dibeli').map(b=>[b.hadiah_jalan_id,b]));
  const hadiahJalan = hadiahJalanList.reduce((s,h) => { const b=belanjaJalan.get(h.id); return s + (b ? Number(b.nominal_realisasi ?? (Number(h.harga_satuan||0)*Number(h.qty||0))) : 0); }, 0);

  const pengeluaran = opsional + kebutuhanLomba + hadiahLomba + hadiahJalan;
  return {
    iuran, donasi, transaksiLain, pemasukan, opsional, kebutuhanLomba, hadiahLomba, hadiahJalan, pengeluaran, saldo: pemasukan - pengeluaran,
    jumlahIuranLunas: anggotaLunas.length,
    jumlahDonatur: donaturUangList.length,
    jumlahDonaturBarang: donaturBarangList.length,
    jumlahTransaksiLain: transaksiLainList.length,
    jumlahOperasional: operasionalList.length,
    jumlahKebutuhanLomba: kebutuhanLombaList.length,
    jumlahItemHadiahLomba,
    jumlahHadiahJalan: hadiahJalanList.length,
  };
}
