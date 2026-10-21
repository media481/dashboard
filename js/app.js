// ============================================================
// 1. SUPABASE CONFIG
// ============================================================
const SUPABASE_URL = "https://vlrizloxsjejcfuxuyju.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZscml6bG94c2plamNmdXh1eWp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxOTE1NjMsImV4cCI6MjEwMTc2NzU2M30.hO5LGq4CwiZDG4hxU2cEB1nNaVdpJ5NepPZLIIA1fig";
const MASKAPAI_LIST = ["Oman Air","Saudia Airlines","Lion Air","Garuda Indonesia","Emirates","Qatar Airways","Etihad Airways","Malindo Air","Air Asia","IndiGo"];
const CACHE_KEY = 'amiru_cached_data';
const CACHE_TIME_KEY = 'amiru_cache_time';
const CACHE_DURATION = 60000;
const SESSION_DURATION = 30 * 60 * 1000;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
// [MIGRASI SUPABASE AUTH] Login sekarang lewat supabaseClient.auth.signInWithPassword()
// langsung dengan email+password yang diketik user -- Supabase Auth yang membuat &
// menandatangani JWT-nya sendiri, jadi tidak pernah tersandung isu kid/JWT Signing
// Key custom lagi. Role ditentukan dari tabel dashboard_profiles setelah login berhasil
// (lihat checkAdminLogin() dan sql/28_migrate_supabase_auth.sql).
const ADMIN_CREATE_USER_URL = SUPABASE_URL + '/functions/v1/admin-create-user';
const ADMIN_RESET_USER_PASSWORD_URL = SUPABASE_URL + '/functions/v1/admin-reset-user-password';

let supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        storageKey: 'amiru_supabase_auth',
        storage: window.sessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
    },
    realtime: { enabled: false },
    global: { fetch: (...args) => fetch(...args) }
});

// ============================================================
// 2. STATE
// ============================================================
let USER_ROLES = {};
let dataUmroh = [], currentData = [], currentSort = { column: null, asc: true };
let adminLoggedIn = false, currentRole = null, editingProgramId = null, adminSortColumn = null, adminSortAsc = true, adminPrograms = [];
let debounceTimer = null, sessionTimeout = null;
let loginAttempts = 0, loginLockTime = 0;

// Naikkan angka ini setiap kali format/skema JWT dari login-dashboard berubah
// (Dulu di sini ada applyAuthToken()/AUTH_TOKEN_SCHEMA_VERSION untuk menyuntik JWT custom
// secara manual. Sudah tidak diperlukan: supabaseClient sekarang mengelola sesi & JWT-nya
// sendiri lewat signInWithPassword() + persistSession/autoRefreshToken di atas.)
let featuredIds = [];
let jadwalList = [], editingJadwalId = null;
let pendaftaranList = [], editingPendaftaranId = null;
let assetsList = [], editingAssetId = null;
let hotelSaudiList = [], hotelSaudiLoaded = false;

// Program dianggap expired kalau Tanggal Berangkat-nya sudah lewat hari ini.
// Dipakai untuk sembunyikan program expired dari tabel dashboard utama
// (packageTable) -- TIDAK dipakai di tabel Admin, karena admin tetap perlu
// lihat & kelola program lama (ditandai badge "Expired", bukan disembunyikan).
function isProgramExpired(p) {
    return !!(p.dateObj && p.dateObj < new Date());
}

// [FITUR] Program tanpa poster (link_poster kosong) disembunyikan dari
// dashboard utama publik -- dipakai bareng dgn syarat aktif & belum expired
// yang sudah ada, supaya konsisten di semua tempat yang menampilkan/menghitung
// program publik (tabel utama, search, & counter "Total Program").
function isProgramVisibleOnDashboard(p) {
    return p.is_active !== false && !isProgramExpired(p) && !!p.link_poster;
}

// Urutkan program: yang masih tersedia dulu (tanggal terdekat), yang sudah expired selalu di baris paling bawah
function sortProgramsDefault(list) {
    const now = new Date();
    return [...list].sort((a, b) => {
        const aExpired = (a.dateObj || 0) < now, bExpired = (b.dateObj || 0) < now;
        if (aExpired !== bExpired) return aExpired ? 1 : -1;
        return (a.dateObj || 0) - (b.dateObj || 0);
    });
}
let kbJamaahList = [], kbSelectedProgram = null, editingKbId = null;
let cicilanList = [], cicilanJamaahId = null;
let cicilanJamaahInfo = null, cicilanProgramInfo = null, cicilanHargaProgram = 0, cicilanSisaTagihan = 0;
// Cache data mentah panel Pembayaran, supaya ketik di kolom cari / ganti
// filter TIDAK perlu fetch ulang ke Supabase tiap kali -- cukup filter ulang
// data yang sudah ada di memori (lihat renderPembayaranTable()).
let pbCacheJamaahAll = null, pbCacheTotalPerJamaah = null, pbSearchDebounce = null;
let notaGenerating = false;
let dokSelectedProgram = null;
let dokCacheJamaahAll = null; // cache list jamaah program aktif, dipakai tombol "Reminder WA" (generateDocumentReminderWA)
// type 'copy'   -> dua checkbox terpisah: Fotocopy & Asli (disimpan sbg {key}_fc / {key}_asli)
// type 'single' -> satu checkbox "Sudah" (disimpan sbg {key})
// Struktur ini mengikuti form fisik "Tanda Terima Dokumen" PT Amiru Haramain Indonesia.
const DOKUMEN_JENIS = [
    { key: 'ktp', label: 'KTP', type: 'copy' },
    { key: 'kk', label: 'KK', type: 'copy' },
    { key: 'paspor', label: 'Paspor', type: 'copy' },
    { key: 'buku_nikah', label: 'Buku Nikah', type: 'copy' },
    { key: 'akta_lahir', label: 'Akta Lahir', type: 'copy' },
    { key: 'ijazah', label: 'Ijazah', type: 'copy' },
    { key: 'kartu_vaksin', label: 'Kartu Vaksin', type: 'copy' },
    { key: 'pas_photo', label: 'Pas Photo 4x6', type: 'single' }
];

// Hitung usia (tahun, genap) dari tanggal lahir ISO (yyyy-mm-dd). null kalau tidak diketahui.
function hitungUsia(tglLahir) {
    if (!tglLahir) return null;
    const lahir = new Date(tglLahir);
    if (isNaN(lahir)) return null;
    const now = new Date();
    let usia = now.getFullYear() - lahir.getFullYear();
    const belumUlangTahun = (now.getMonth() < lahir.getMonth()) || (now.getMonth() === lahir.getMonth() && now.getDate() < lahir.getDate());
    if (belumUlangTahun) usia--;
    return usia;
}

// Daftar jenis dokumen yang berlaku untuk jamaah tertentu. Saat ini semua
// dokumen berlaku untuk semua jamaah (tidak ada lagi dokumen kondisional
// seperti Surat Mahram) -- fungsi ini dipertahankan supaya pemanggil di
// tempat lain (isDokumenLengkap, cetak Tanda Terima Dokumen) tidak perlu
// berubah kalau suatu saat ada dokumen kondisional baru.
function dokumenJenisUntukJamaah(jamaah) {
    return DOKUMEN_JENIS;
}

// Status visa sederhana (bukan integrasi resmi ke sistem Saudi -- cuma
// pencatatan manual oleh admin) & label tampilan tiap statusnya.
const VISA_STATUS_LABEL = {
    belum_diajukan: { label: 'Belum Diajukan', badge: 'full' },
    diproses: { label: 'Diproses', badge: 'limited' },
    terbit: { label: 'Terbit', badge: 'available' },
    ditolak: { label: 'Ditolak', badge: 'batal' }
};

// Syarat 2026: paspor minimal berlaku 6-7 bulan dari tanggal keberangkatan.
// Pakai ambang 7 bulan (lebih ketat/aman) supaya admin punya waktu mengurus
// perpanjangan sebelum mepet. Mengembalikan null kalau data tidak lengkap.
function pasporMepetInfo(pasporExp, tglBerangkat) {
    if (!pasporExp || !tglBerangkat) return null;
    const exp = new Date(pasporExp);
    const berangkat = new Date(tglBerangkat);
    if (isNaN(exp) || isNaN(berangkat)) return null;
    const batasAman = new Date(berangkat);
    batasAman.setMonth(batasAman.getMonth() + 7);
    if (exp < berangkat) return { level: 'expired', text: 'Paspor sudah/akan kadaluarsa sebelum keberangkatan' };
    if (exp < batasAman) return { level: 'mepet', text: 'Masa berlaku paspor kurang dari 7 bulan dari keberangkatan' };
    return null;
}
let deleteTarget = { table: null, id: null, name: '' };
let adminSubTab = 'program';
// ---- Crosscheck module state ----
let cxSelectedProgram = null;
let cxScanningIds = new Set(); // program id yang sedang di-OCR
let cxOcrProgress = {}; // {progId: 0..100}
// ---- Telegram module state ----
let _tgConfigCache = null;
const TG_REMINDER_KEY = 'amiru_tg_reminder_sent'; // { programId: 'YYYY-MM-DD' }

// ============================================================
// 3. UTILITY FUNCTIONS
// ============================================================
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Ambil nama hotel saja untuk tampilan ringkas di tabel (mis. kolom Hotel
// Makkah/Madinah di "Edit & Tambah Program"), buang bagian "/ Setaraf
// (X malam, Ym Z menit jalan kaki)" supaya kolom tidak makan tempat.
// Data aslinya (hotel_makkah/hotel_madinah) TIDAK diubah, ini cuma untuk
// ditampilkan. Mis. "Wahat Ajyad / Setaraf (5 malam, 700m 10 menit jalan
// kaki)" -> "Wahat Ajyad".
function hotelNamaSingkat(str) {
    if (!str) return '';
    return String(str).split('/')[0].trim();
}

// ============================================================
// [OPTIMASI LOAD] Lazy-load library CDN berat (jsPDF, html2canvas, XLSX).
// Sebelumnya ketiganya di-<script defer> di <head> dan selalu ikut ke-download
// & di-parse di SETIAP kali dashboard dibuka, padahal cuma dipakai kalau user
// benar-benar export Nota (PDF/JPEG) atau Excel. Sekarang baru diambil dari
// CDN pas dipakai pertama kali (lalu di-cache, tidak diambil ulang), supaya
// load awal dashboard lebih ringan & cepat -- fungsi export-nya sendiri
// TIDAK berubah sama sekali, cuma nunggu modulnya siap dulu sebelum jalan.
// ============================================================
const LAZY_LIB_URLS = {
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    // pdf.js: hanya untuk PREVIEW daftar program (render halaman PDF ke canvas). jsdelivr sudah diizinkan di CSP (_headers).
    pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
};
const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const _lazyLibPromises = {};

function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
            if (existing.dataset.loaded === 'true') { resolve(); return; }
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', () => reject(new Error('Gagal memuat ' + src)));
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
        // Gagal -> buang elemennya, supaya percobaan ulang membuat <script> baru (kalau dibiarkan,
        // percobaan berikutnya hanya menempel listener di elemen mati dan promise tidak pernah selesai).
        script.onerror = () => { script.remove(); reject(new Error('Gagal memuat ' + src)); };
        document.head.appendChild(script);
    });
}

// key: 'jspdf' | 'html2canvas' | 'xlsx' | 'pdfjs'. Aman dipanggil berkali-kali --
// request CDN cuma sekali per key (di-cache di _lazyLibPromises), pemanggil
// berikutnya cukup nebeng promise yang sama/sudah selesai.
function ensureLibLoaded(key) {
    if (!_lazyLibPromises[key]) {
        _lazyLibPromises[key] = loadScriptOnce(LAZY_LIB_URLS[key]).catch(err => {
            _lazyLibPromises[key] = null; // gagal (mis. offline) -> boleh dicoba lagi lain kali
            throw err;
        });
    }
    return _lazyLibPromises[key];
}

// Retry helper untuk request baca (SELECT) yang gagal karena masalah jaringan
// (mis. ERR_CONNECTION_TIMED_OUT, ERR_QUIC_PROTOCOL_ERROR, ERR_CONNECTION_ABORTED).
// HANYA dipakai untuk operasi baca — jangan dipakai untuk insert/update/upsert
// karena retry bisa menyebabkan data dobel jika request pertama sebenarnya sukses
// tapi responsnya yang gagal sampai ke browser.
async function withRetry(fn, { retries = 2, delayMs = 1000, label = '' } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (attempt < retries) {
                console.warn(`${label || 'Request'} gagal (percobaan ${attempt + 1}/${retries + 1}), coba lagi dalam ${delayMs}ms...`, err);
                await new Promise(r => setTimeout(r, delayMs));
                delayMs *= 2; // exponential backoff: 1s, 2s, 4s, ...
            }
        }
    }
    throw lastErr;
}

// Escape aman untuk disisipkan di dalam atribut onclick="...('...')"
// (escapeHtml saja tidak cukup karena tidak meng-escape tanda kutip tunggal)
function escapeJsAttr(str) {
    if (!str) return '';
    // [FIX bug #4/#5] escape juga " dan ` supaya nilai user tidak bisa
    // keluar dari atribut onclick="..." / window.open('...').
    return escapeHtml(str)
        .replace(/"/g, '&quot;')
        .replace(/`/g, '&#96;')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
}

// ============================================================
// TOAST QUEUE — stack notifikasi (maks 3 tampil bersamaan) supaya toast
// yang datang cepat berurutan (mis. auto-sync status setelah simpan
// pembayaran) tidak saling menimpa sebelum sempat terbaca. Kelebihan
// antrean ditampilkan begitu slot kosong (toast sebelumnya selesai/ditutup).
// ============================================================
const TOAST_MAX_VISIBLE = 3;
const TOAST_DEFAULT_DURATION = 3000;
let toastPendingQueue = [];
let toastActiveCount = 0;

// opts: { duration, actionLabel, onAction }
function showToast(msg, type = 'success', opts = {}) {
    toastPendingQueue.push({ msg, type, opts });
    processToastQueue();
}

// Toast dengan tombol "Urungkan" untuk aksi ringan (bukan hapus) — status
// jamaah, tipe kamar, dsb — supaya admin bisa cepat membatalkan kalau
// salah klik, tanpa harus buka lagi form editnya.
function showUndoToast(msg, onUndo, opts = {}) {
    showToast(msg, opts.type || 'success', {
        duration: opts.duration || 5000,
        actionLabel: opts.actionLabel || 'Urungkan',
        onAction: onUndo
    });
}

function processToastQueue() {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
    while (toastActiveCount < TOAST_MAX_VISIBLE && toastPendingQueue.length) {
        const next = toastPendingQueue.shift();
        renderSingleToast(stack, next.msg, next.type, next.opts || {});
    }
}

function renderSingleToast(stack, msg, type, opts) {
    const iconMap = { success: 'bi-check-circle-fill', error: 'bi-exclamation-circle-fill', info: 'bi-info-circle-fill' };
    toastActiveCount++;

    const el = document.createElement('div');
    el.className = 'toast toast-item ' + type;
    el.innerHTML = `<i class="bi ${iconMap[type] || iconMap.success}"></i> <span class="toast-msg"></span>`;
    el.querySelector('.toast-msg').textContent = msg;

    if (opts.actionLabel && typeof opts.onAction === 'function') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toast-action-btn';
        btn.textContent = opts.actionLabel;
        btn.addEventListener('click', () => {
            clearTimeout(timer);
            dismiss();
            try { opts.onAction(); } catch (err) { console.error('Toast undo action gagal:', err); }
        });
        el.appendChild(btn);
    }

    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));

    let dismissed = false;
    const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        el.classList.remove('show');
        el.classList.add('toast-leaving');
        setTimeout(() => {
            el.remove();
            toastActiveCount--;
            processToastQueue();
        }, 220);
    };

    const timer = setTimeout(dismiss, opts.duration || TOAST_DEFAULT_DURATION);
}

// ============================================================
// KONFIRMASI AKSI — pengganti confirm() bawaan browser untuk semua aksi
// berisiko (Hapus Semua, Restore Backup/Snapshot, Import Data, Tutup Form
// Tanpa Simpan), supaya tampilannya konsisten dengan modal Hapus Data.
// Mengembalikan Promise<boolean>: true kalau user menekan tombol lanjut.
// ============================================================
let _actionConfirmResolver = null;
let _actionConfirmTypedWord = null;

// opts: { title, message (boleh HTML sederhana, hanya string internal — jangan
// pernah isi dari input user tanpa escapeHtml), confirmLabel, danger, requireTypedWord }
function openActionConfirm(opts = {}) {
    const {
        title = 'Konfirmasi',
        message = '',
        confirmLabel = 'Ya, Lanjutkan',
        danger = true,
        requireTypedWord = null,
        hideCancel = false
    } = opts;
    return new Promise(resolve => {
        // Kalau ada modal konfirmasi lain yang masih menggantung (seharusnya
        // tidak terjadi di alur normal), batalkan yang lama supaya tidak nyangkut.
        if (_actionConfirmResolver) { try { _actionConfirmResolver(false); } catch (_) {} }
        _actionConfirmResolver = resolve;
        _actionConfirmTypedWord = requireTypedWord || null;

        document.getElementById('actionConfirmTitle').innerHTML =
            `<i class="bi ${danger ? 'bi-exclamation-triangle-fill' : 'bi-question-circle-fill'}"></i> ${escapeHtml(title)}`;
        document.getElementById('actionConfirmMessage').innerHTML = message;
        document.getElementById('actionConfirmBtnLabel').textContent = confirmLabel;

        const cancelBtn = document.getElementById('actionConfirmCancelBtn');
        if (cancelBtn) cancelBtn.style.display = hideCancel ? 'none' : '';
        const btn = document.getElementById('actionConfirmBtn');
        btn.className = danger ? 'btn-danger' : 'btn-submit';

        const typedWrap = document.getElementById('actionConfirmTypedWrap');
        const typedInput = document.getElementById('actionConfirmTypedInput');
        typedInput.value = '';
        if (requireTypedWord) {
            typedWrap.style.display = '';
            document.getElementById('actionConfirmTypedWord').textContent = `"${requireTypedWord}"`;
            btn.disabled = true;
        } else {
            typedWrap.style.display = 'none';
            btn.disabled = false;
        }

        document.getElementById('actionConfirmModal').classList.add('open');
        if (requireTypedWord) setTimeout(() => typedInput.focus(), 50);
    });
}

function onActionConfirmTypedInput() {
    const val = document.getElementById('actionConfirmTypedInput').value.trim();
    document.getElementById('actionConfirmBtn').disabled = val !== _actionConfirmTypedWord;
}

function resolveActionConfirm(result) {
    document.getElementById('actionConfirmModal').classList.remove('open');
    const resolver = _actionConfirmResolver;
    _actionConfirmResolver = null;
    _actionConfirmTypedWord = null;
    if (resolver) resolver(result);
}

function formatDateToIndonesian(date) {
    if (!date || isNaN(date.getTime())) return '';
    const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function parseDateFromString(dateStr) {
    if (!dateStr) return new Date();
    const months = {'Januari':0,'Februari':1,'Maret':2,'April':3,'Mei':4,'Juni':5,'Juli':6,'Agustus':7,'September':8,'Oktober':9,'November':10,'Desember':11};
    for (const [month, idx] of Object.entries(months)) {
        if (dateStr.includes(month)) {
            const parts = dateStr.split(' ');
            let day = parseInt(parts[0]), year = parseInt(parts[2]);
            if (isNaN(day)) day = parseInt(parts[0].replace(/^0+/, ''));
            return new Date(year, idx, day);
        }
    }
    return new Date(dateStr);
}

// Ubah teks harga (mis. "Rp 32.500.000", "32500000", atau angka) jadi number murni.
// Dipakai untuk menghitung sisa tagihan di fitur Pembayaran & Cicilan.
function parseRupiahToNumber(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return val;
    const digits = String(val).replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : 0;
}

// Format input nominal secara live sambil diketik: tambahkan titik ribuan
// (mis. "5000000" -> "5.000.000") supaya lebih mudah dibaca & diketik untuk
// angka besar. Field-nya sengaja type="text" (bukan number), karena
// <input type="number"> tidak bisa menampilkan titik pemisah ribuan.
// Kursor dipertahankan relatif dari akhir teks supaya tetap nyaman diketik
// walau posisi titik ikut bergeser tiap karakter ditambah/dihapus.
function formatNominalInput(el) {
    if (!el) return;
    const cursorFromEnd = el.value.length - (el.selectionStart ?? el.value.length);
    const digits = el.value.replace(/[^\d]/g, '');
    el.value = digits ? parseInt(digits, 10).toLocaleString('id-ID') : '';
    const pos = Math.max(el.value.length - cursorFromEnd, 0);
    try { el.setSelectionRange(pos, pos); } catch (_) { /* input type tanpa dukungan selection range, abaikan */ }
}

// Sama seperti formatNominalInput(), tapi ikut menambahkan prefix "Rp "
// secara live sambil diketik (mis. "39500000" -> "Rp 39.500.000"). Dipakai
// untuk field harga per kamar di modal Tambah/Edit Program, supaya admin
// tinggal ketik angka polos dan formatnya otomatis muncul rapi.
function formatRupiahInput(el) {
    if (!el) return;
    const cursorFromEnd = el.value.length - (el.selectionStart ?? el.value.length);
    const digits = el.value.replace(/[^\d]/g, '');
    el.value = digits ? 'Rp ' + parseInt(digits, 10).toLocaleString('id-ID') : '';
    const pos = Math.max(el.value.length - cursorFromEnd, 0);
    try { el.setSelectionRange(pos, pos); } catch (_) { /* input type tanpa dukungan selection range, abaikan */ }
}

// Pilih harga acuan tagihan seorang jamaah: kalau jamaah punya `harga_custom`
// (nego khusus / diskon / harga custom di luar Quad-Triple-Double program),
// itu yang dipakai. Kalau kosong, fallback ke harga tipe_kamar-nya (lihat
// sql/10_tambah_tipe_kamar_jamaah.sql untuk latar belakang). Fallback lagi ke
// harga Quad kalau harga tipe yang dipilih belum diisi di programnya (mis.
// admin belum sempat isi harga_triple) — supaya tagihan tidak tiba-tiba jadi
// Rp0 / tidak akurat, dan supaya data lama tetap berperilaku persis seperti
// sebelum fitur ini ada.
const TIPE_KAMAR_LABEL = { quad: 'Quad', triple: 'Triple', double: 'Double' };

function getHargaKamarJamaah(program, jamaah) {
    const hargaCustom = parseRupiahToNumber(jamaah ? jamaah.harga_custom : 0);
    if (hargaCustom > 0) return hargaCustom;
    if (!program) return 0;
    const hargaQuad = parseRupiahToNumber(program.harga_quad || program.harga_quint);
    const hargaTriple = parseRupiahToNumber(program.harga_triple);
    const hargaDouble = parseRupiahToNumber(program.harga_double);
    switch (jamaah ? jamaah.tipe_kamar : null) {
        case 'triple': return hargaTriple || hargaQuad;
        case 'double': return hargaDouble || hargaQuad;
        case 'quad':
        default: return hargaQuad;
    }
}

function formatRupiah(amount) {
    if (!amount && amount !== 0) return '-';
    if (typeof amount === 'string') {
        const trimmed = amount.trim();
        if (!trimmed) return '-';
        // Sudah dalam bentuk teks terformat (mis. "Rp 32.500.000") -> tampilkan apa adanya
        if (/rp/i.test(trimmed) || /[^\d.,\s]/.test(trimmed)) return trimmed;
        // String angka murni (mis. "32500000") -> lanjut diformat di bawah
        const parsed = parseInt(trimmed.replace(/[^\d]/g, ''), 10);
        if (!parsed) return trimmed;
        amount = parsed;
    }
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

function isValidProgramName(name) {
    if (!name) return false;
    const validPattern = /^[\p{L}\p{N}\s\-.,()+&:!?\/]+$/u;
    return validPattern.test(name);
}

function isValidUrl(string) {
    if (!string) return true;
    try { const url = new URL(string); return url.protocol === 'http:' || url.protocol === 'https:'; }
    catch (_) { return false; }
}

// Standarisasi ejaan "Umrah" -> "Umroh" (ejaan resmi yang dipakai Amiru Tour) di
// mana pun kata itu muncul, baik dari teks broadcast yang di-paste admin maupun
// dari hasil generate AI. Case pattern kata sumber tetap dipertahankan
// (Umrah->Umroh, UMRAH->UMROH, umrah->umroh) supaya rapi di judul/caption.
function normalizeUmrohSpelling(text) {
    if (!text) return text;
    return text.replace(/umrah/gi, (match) => {
        if (match === match.toUpperCase()) return 'UMROH';
        if (match[0] === match[0].toUpperCase()) return 'Umroh';
        return 'umroh';
    });
}

// Standarisasi singkatan "pp" (Pulang-Pergi, umum dipakai di item "Tiket
// Pesawat ... pp") supaya selalu tampil huruf besar "PP" di caption, apapun
// kapitalisasi aslinya di broadcast/input admin ("pp", "Pp", "PP" -> "PP").
// \b...\b memastikan hanya kata "pp" berdiri sendiri yang kena, bukan
// potongan tengah kata lain.
function normalizePpAbbreviation(text) {
    if (!text) return text;
    return text.replace(/\bpp\b/gi, 'PP');
}

// Ubah judul yang ditulis SEMUA HURUF BESAR (umum di broadcast WA, misal
// "UMRAH LIBURAN DESEMBER") jadi Title Case yang lebih rapi untuk field Nama
// Program ("Umroh Liburan Desember"). Kalau judulnya sudah campuran huruf
// besar/kecil (bukan all-caps), dibiarkan apa adanya supaya tidak merusak
// penulisan yang memang disengaja (misal singkatan/akronim di tengah nama).
function toTitleCaseIfAllCaps(str) {
    if (!str) return str;
    const lettersOnly = str.replace(/[^A-Za-z]/g, '');
    const isAllCaps = lettersOnly.length > 0 && lettersOnly === lettersOnly.toUpperCase();
    if (!isAllCaps) return str;
    return str.toLowerCase().replace(/(^|[\s\-\/])([a-z])/g, (m, sep, c) => sep + c.toUpperCase());
}

// Hash string sederhana (deterministik) -- dipakai untuk memilih kalimat
// pembuka secara "acak" tapi stabil: program yang sama (nama sama) akan
// selalu dapat kalimat yang sama tiap di-generate ulang (tidak berubah-ubah
// tiap klik "Isi Otomatis"), sementara antar program yang beda nama akan
// cenderung dapat kalimat pembuka yang berbeda -- jadi captionnya bervariasi,
// tidak template kaku yang sama persis tiap broadcast.
function hashStringStable(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
}

// Kalimat pembuka generik (dipakai kalau tidak ada kata kunci tema yang cocok
// di nama/durasi program) -- semua bernada promosi Amiru Tour, siap pakai
// tanpa perlu embel-embel tambahan.
const WA_OPENING_GENERIC = [
    'Wujudkan niat suci ke Tanah Suci bersama pelayanan terbaik Amiru Tour.',
    'Sempurnakan ibadah Anda di Tanah Suci bersama Amiru Tour, mitra perjalanan umroh terpercaya.',
    'Saatnya menjawab panggilan-Nya ke Baitullah bersama Amiru Tour.',
    'Nikmati perjalanan ibadah yang nyaman dan penuh berkah bersama Amiru Tour.',
    'Rasakan pengalaman umroh terbaik dengan pelayanan penuh dari Amiru Tour.',
    'Langkahkan kaki menuju Tanah Suci bersama Amiru Tour, insya Allah penuh kemudahan.',
    'Jadikan momen ibadah ke Tanah Suci lebih berkesan bersama Amiru Tour.',
    'Percayakan perjalanan suci Anda ke Baitullah bersama pelayanan terbaik Amiru Tour.'
];

// Kalimat pembuka bertema -- dipilih kalau ada kata kunci relevan di nama
// program atau info durasinya, supaya kalimat pembuka terasa "nyambung"
// dengan konteks broadcast asli, bukan sekadar generik.
const WA_OPENING_THEMED = [
    { kw: /desember|akhir\s*tahun|nataru|tahun\s*baru/i, lines: [
        'Tutup akhir tahun dengan ibadah penuh makna ke Tanah Suci bersama Amiru Tour.',
        'Sambut tahun baru dengan langkah suci ke Baitullah bersama Amiru Tour.',
        'Isi libur akhir tahun dengan perjalanan ibadah bersama Amiru Tour.'
    ] },
    { kw: /liburan|libur\s*sekolah|libur\s*panjang/i, lines: [
        'Manfaatkan momen liburan dengan ibadah yang penuh berkah bersama Amiru Tour.',
        'Isi waktu liburan dengan perjalanan suci ke Tanah Suci bersama Amiru Tour.'
    ] },
    { kw: /ramadhan|puasa/i, lines: [
        'Sambut bulan suci Ramadhan dengan ibadah umroh penuh berkah bersama Amiru Tour.',
        'Raih keberkahan Ramadhan di Tanah Suci bersama Amiru Tour.'
    ] },
    { kw: /lebaran|idul\s*fitri/i, lines: [
        'Rayakan momen kemenangan dengan ibadah ke Tanah Suci bersama Amiru Tour.'
    ] },
    { kw: /promo|hemat|diskon/i, lines: [
        'Kesempatan terbatas beribadah ke Tanah Suci dengan harga bersahabat bersama Amiru Tour.'
    ] }
];

// Pilih 1 kalimat pembuka: cari tema yang cocok dari nama+durasi program,
// kalau tidak ada yang cocok pakai pool generik -- pemilihan dalam pool
// pakai hash nama supaya stabil (bukan Math.random()).
function pickWaOpeningSentence(data) {
    const context = `${data.nama || ''} ${data.durasi || ''}`;
    const theme = WA_OPENING_THEMED.find(t => t.kw.test(context));
    const pool = theme ? theme.lines : WA_OPENING_GENERIC;
    const idx = hashStringStable(data.nama || 'default') % pool.length;
    return pool[idx];
}

// ============================================================
// 4. GENERATE AUTO WA TEXT
// ============================================================
const WA_CATATAN_PERUBAHAN = '*biaya dan jadwal sewaktu-waktu dapat berubah mengikuti ketentuan Saudi, Maskapai serta kenaikan kurs dolar dan riyal';

function generateAutoWAText(data) {
    const s = v => normalizePpAbbreviation(normalizeUmrohSpelling((v || '').toString().replace(/javascript:/gi, 'blocked:')));
    const namaUpper = s(data.nama || 'PROGRAM UMROH').toUpperCase();
    let teks = `🕋 *${namaUpper}* 🕋\n`;

    const durasi = data.durasi ? data.durasi.replace(/\s*hari/i, '').trim() : '';
    if (durasi && data.tgl) teks += `📅 ${durasi} Hari: ${s(data.tgl)}\n`;
    else if (data.tgl) teks += `📅 ${s(data.tgl)}\n`;
    teks += `${pickWaOpeningSentence(data)}\n`;
    teks += `\n`;

    const fasilitasLines = [];
    if (data.maskapai) fasilitasLines.push(`✅ ${s(data.maskapai)}`);
    if (data.hotel_madinah) fasilitasLines.push(`✅ Hotel Madinah: ${s(data.hotel_madinah)}`);
    if (data.hotel_makkah) fasilitasLines.push(`✅ Hotel Makkah: ${s(data.hotel_makkah)}`);
    // Hotel ke-3 & ke-4 (opsional), label pakai nama kota kalau diisi.
    [3, 4].forEach(n => {
        const h = data[`hotel_${n}`];
        if (h) fasilitasLines.push(`✅ Hotel ${data[`hotel_${n}_kota`] ? s(data[`hotel_${n}_kota`]) : n}: ${s(h)}`);
    });
    if (fasilitasLines.length) teks += `✈️ Fasilitas:\n${fasilitasLines.join('\n')}\n\n`;

    const hargaLines = [];
    if (data.harga_quad) hargaLines.push(`* Quad: ${s(data.harga_quad)}`);
    if (data.harga_triple) hargaLines.push(`* Triple: ${s(data.harga_triple)}`);
    if (data.harga_double) hargaLines.push(`* Double: ${s(data.harga_double)}`);
    if (!hargaLines.length && data.harga_quint) hargaLines.push(`* Quint: ${s(data.harga_quint)}`);
    if (hargaLines.length) teks += `💰 Biaya Program:\n${hargaLines.join('\n')}\n\n`;

    const termasukList = data.termasuk ? data.termasuk.split('\n').map(i => i.trim()).filter(Boolean) : ['Tiket Pesawat PP', 'Visa Umroh', 'Fullboard Hotel'];
    teks += `✅ Termasuk:\n${termasukList.map(i => `- ${s(i)}`).join('\n')}\n\n`;

    const tidakList = data.tidak_termasuk ? data.tidak_termasuk.split('\n').map(i => i.trim()).filter(Boolean) : ['Paspor', 'Vaksin', 'Pengeluaran pribadi'];
    teks += `❌ Tidak Termasuk:\n${tidakList.map(i => `- ${s(i)}`).join('\n')}\n\n`;

    // Catatan perubahan biaya/jadwal -- selalu tampil di antara Tidak Termasuk & Info
    teks += `${WA_CATATAN_PERUBAHAN}\n\n`;

    teks += `📞 Info & Itinerary:\n${(NOTA_PERUSAHAAN.kontak_wa || []).map(n => 'wa.me/' + n).join('\n')}`;
    return teks;
}

// --- Generate Caption WA pakai AI (Claude API) — diadaptasi dari tool "Generator Caption Umroh" ---
const WA_CAPTION_LIMIT = 1024; // batas umum WA sebelum caption gambar berisiko terpotong tampilannya
// Diambil dinamis dari NOTA_PERUSAHAAN.kontak_wa (function, bukan const string,
// karena dulu di-hardcode saat file di-parse -- sekarang harus dihitung ulang
// tiap dipanggil supaya ikut isi terbaru dari Profil Perusahaan).
function getWaCaptionContacts() {
    return (NOTA_PERUSAHAAN.kontak_wa || []).map(n => 'wa.me/' + n).join('\n');
}
// [FIX] System prompt AI dipindah ke Edge Function generate-wa-caption
// (supabase/functions/generate-wa-caption/index.ts) supaya panggilan ke
// Gemini API dilakukan di server, bukan langsung dari browser (lihat
// catatan di generateCaptionAI() di bawah untuk detail alasannya).
const WA_CAPTION_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/generate-wa-caption`;
// Edge Function AI untuk parsing teks broadcast (pendamping parseBroadcastText()
// yang berbasis regex -- lihat parseBroadcastTextAI() di bawah untuk detail).
const PARSE_BROADCAST_AI_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/parse-broadcast-ai`;
// Edge Function AI untuk menyusun pesan reminder Telegram yang lebih natural
// & informatif (pendamping formatTgReminder() -- lihat generateTgReminderAI()
// di bawah untuk detail & fallback).
const TG_REMINDER_AI_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/generate-tg-reminder`;
// Edge Function AI untuk menyusun draft pesan WA reminder pembayaran per
// jamaah (dipakai tombol "Reminder WA" di menu Pembayaran -- lihat
// generatePaymentReminderWA() di bawah). Admin tetap kirim manual lewat
// link wa.me, ini cuma menyusun draft teksnya.
const PAYMENT_REMINDER_WA_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/generate-payment-reminder-wa`;


function waCaptionGaugeColor(pct) {
    if (pct < 60) return 'var(--success)';
    if (pct < 90) return 'var(--warn)';
    return 'var(--danger)';
}

// Bikin tinggi textarea otomatis mengikuti panjang isinya, jadi admin tidak
// perlu drag manual (CSS max-height + overflow-y:auto tetap jadi jaring
// pengaman kalau teksnya sangat panjang -- lihat .wa-autogrow di style.css).
function autoGrowTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
}

// Cerminkan isi kotak "Teks Broadcast" (persis apa adanya, tanpa normalisasi)
// ke kotak referensi di sebelah "Teks WA (Hasil Generate)" supaya admin bisa
// bandingkan hasil generate vs sumber aslinya tanpa scroll ke atas.
function syncBroadcastRefBox() {
    const src = document.getElementById('parseBroadcastInput');
    const ref = document.getElementById('admin_teks_wa_broadcast_ref');
    if (!src || !ref) return;
    ref.value = src.value;
    autoGrowTextarea(ref);
}

// Update indikator panjang teks di bawah textarea Teks WA (dipanggil live saat admin ngetik manual juga)
function updateWaCaptionGauge(text) {
    const el = document.getElementById('waCaptionGauge');
    if (!el) return;
    const len = (text || '').length;
    if (!len) { el.innerHTML = ''; return; }
    const pct = Math.min(100, (len / WA_CAPTION_LIMIT) * 100);
    const color = waCaptionGaugeColor(pct);
    let msg = 'Aman, jauh dari batas potong.';
    if (len >= WA_CAPTION_LIMIT * 0.9) msg = 'Berisiko tinggi terpotong tampilan di WA.';
    else if (len >= WA_CAPTION_LIMIT * 0.6) msg = 'Mendekati batas umum WA.';
    el.innerHTML = `<span style="color:${color};font-weight:700;">${len} karakter</span> <span style="color:var(--ink-soft);">/ ${WA_CAPTION_LIMIT} — ${msg}</span>`;
}

// Rangkai konsep mentah dari isian form (dipakai kalau kotak "Teks Broadcast" kosong)
function buildRawConceptFromAdminForm() {
    const g = id => (document.getElementById(id)?.value || '').trim();
    const nama = g('admin_nama');
    if (!nama) return '';
    const durasi = g('admin_durasi');
    const tgl = g('admin_tgl') || g('admin_tgl_date');
    const maskapai = document.getElementById('admin_maskapai')?.value || '';
    const hotelMadinah = g('admin_hotel_madinah');
    const hotelMakkah = g('admin_hotel_makkah');
    const hargaQuint = g('admin_harga_quint');
    const hargaQuad = g('admin_harga_quad');
    const hargaTriple = g('admin_harga_triple');
    const hargaDouble = g('admin_harga_double');
    const termasuk = g('admin_termasuk');
    const tidakTermasuk = g('admin_tidak_termasuk');

    const lines = [`*${nama.toUpperCase()}*`];
    if (durasi) lines.push(`Program ${durasi}`);
    if (tgl) lines.push(`Tanggal Berangkat: ${tgl}`);
    if (maskapai) lines.push(`*PESAWAT*\n${maskapai}`);
    if (hotelMadinah) lines.push(`*HOTEL MADINAH*\n${hotelMadinah}`);
    if (hotelMakkah) lines.push(`*HOTEL MEKAH*\n${hotelMakkah}`);
    [3, 4].forEach(n => {
        const h = g(`admin_hotel_${n}`);
        if (h) lines.push(`*HOTEL ${(g(`admin_hotel_${n}_kota`) || String(n)).toUpperCase()}*\n${h}`);
    });
    const hargaLines = [];
    if (hargaQuint) hargaLines.push(`${hargaQuint} Quint`);
    if (hargaQuad) hargaLines.push(`${hargaQuad} Quad`);
    if (hargaTriple) hargaLines.push(`${hargaTriple} Triple`);
    if (hargaDouble) hargaLines.push(`${hargaDouble} Double`);
    if (hargaLines.length) lines.push(`*BIAYA PROGRAM*\n${hargaLines.join('\n')}`);
    if (termasuk) lines.push(`*Termasuk*\n${termasuk}`);
    if (tidakTermasuk) lines.push(`*Tidak Termasuk*\n${tidakTermasuk}`);
    return lines.join('\n');
}

// [AUTO-FILL] Fallback terakhir kalau kotak "Teks Broadcast" DAN form masih
// kosong: kalau program yang sedang diedit sudah pernah discan OCR poster-nya
// (lihat autoScanPosterForProgram), pakai data hasil OCR itu langsung sebagai
// bahan konsep buat AI. Jadi generate teks WA tetap bisa jalan walau admin
// belum sempat isi form manual, asal posternya sudah pernah dibaca sistem.
function buildRawConceptFromPosterData() {
    if (!editingProgramId) return '';
    const prog = adminPrograms.find(p => String(p.id) === String(editingProgramId));
    if (!prog) return '';
    const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch (e) { return {}; } })();
    const pd = adl.poster_data;
    if (!pd || !pd.nama) return '';

    const lines = [`*${pd.nama.toUpperCase()}*`];
    if (pd.durasi) lines.push(`Program ${pd.durasi}`);
    if (pd.tgl) lines.push(`Tanggal Berangkat: ${pd.tgl}`);
    if (pd.maskapai) lines.push(`*PESAWAT*\n${pd.maskapai}`);
    if (pd.hotel_madinah) lines.push(`*HOTEL MADINAH*\n${pd.hotel_madinah}`);
    if (pd.hotel_makkah) lines.push(`*HOTEL MEKAH*\n${pd.hotel_makkah}`);
    [3, 4].forEach(n => {
        if (pd[`hotel_${n}`]) lines.push(`*HOTEL ${(pd[`hotel_${n}_kota`] || String(n)).toUpperCase()}*\n${pd[`hotel_${n}`]}`);
    });
    const hargaLines = [];
    if (pd.harga_quint) hargaLines.push(`${pd.harga_quint} Quint`);
    if (pd.harga_quad) hargaLines.push(`${pd.harga_quad} Quad`);
    if (pd.harga_triple) hargaLines.push(`${pd.harga_triple} Triple`);
    if (pd.harga_double) hargaLines.push(`${pd.harga_double} Double`);
    if (hargaLines.length) lines.push(`*BIAYA PROGRAM*\n${hargaLines.join('\n')}`);
    return lines.join('\n');
}

// Jaring pengaman format setelah caption dibuat AI — AI kadang lupa ikut
// instruksi persis (misal tanda bintang di judul kelupaan, atau baris kosong
// antar section hilang). Fungsi ini merapikan otomatis tanpa mengubah isi:
// 1. Pastikan judul di baris "🕋 ... 🕋" diapit tanda bintang (*JUDUL*).
// 2. Pastikan ada baris kosong sebelum tiap header section standar.
function enforceWaCaptionFormat(text) {
    if (!text) return text;
    let lines = text.split('\n');

    // 1) Judul: kalau baris "🕋 [teks] 🕋" belum punya tanda bintang, tambahkan.
    lines = lines.map(l => {
        const m = l.match(/^(🕋\s*)([^🕋]+?)(\s*🕋)$/);
        if (m && !/^\*.+\*$/.test(m[2].trim())) {
            return `${m[1]}*${m[2].trim()}*${m[3]}`;
        }
        return l;
    });

    // 2) Baris kosong sebelum header section standar.
    const sectionHeaders = ['✈️ Fasilitas:', '💰 Biaya Program:', '✅ Termasuk:', '❌ Tidak Termasuk:', '📞 Info & Itinerary:'];
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const isHeader = sectionHeaders.some(h => lines[i].trim().startsWith(h));
        const prevLine = out[out.length - 1];
        if (isHeader && out.length > 0 && prevLine.trim() !== '') {
            out.push('');
        }
        out.push(lines[i]);
    }
    // Rapikan kalau ada baris kosong ganda (efek samping dari langkah di atas).
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Generate caption WA pakai Claude API — sumber: kotak "Teks Broadcast" kalau diisi, kalau tidak dirangkai dari field form
async function generateCaptionAI() {
    const btn = document.getElementById('btnGenCaptionAI');
    const btnText = document.getElementById('btnGenCaptionAIText');
    const teksWaEl = document.getElementById('admin_teks_wa');
    if (!teksWaEl) return;

    let raw = (document.getElementById('parseBroadcastInput')?.value || '').trim();
    let usedPosterFallback = false;
    if (!raw) raw = buildRawConceptFromAdminForm();
    if (!raw) {
        // Kotak Broadcast & form masih kosong -> coba ambil dari hasil OCR
        // poster (kalau poster program ini sudah pernah discan sebelumnya).
        raw = buildRawConceptFromPosterData();
        usedPosterFallback = !!raw;
    }
    if (!raw) { showToast('Isi dulu Nama Program, atau paste Teks Broadcast', 'error'); return; }
    if (usedPosterFallback) showToast('Form masih kosong, konsep diambil otomatis dari hasil scan poster');
    // Standarisasi ejaan "Umrah" -> "Umroh" & singkatan "pp" -> "PP" di
    // konsep sebelum dikirim ke AI.
    raw = normalizePpAbbreviation(normalizeUmrohSpelling(raw));

    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = 'Menyusun...';

    try {
        const userMsg = `KONSEP PROGRAM:\n${raw}\n\nNOMOR WA KONTAK YANG DIPAKAI DI BAGIAN PENUTUP:\n${getWaCaptionContacts()}`;
        // [FIX] Sebelumnya fetch langsung ke api.anthropic.com dari browser —
        // selalu gagal (CORS block + tidak ada API key di client) di luar
        // sandbox artifact claude.ai. Sekarang lewat Edge Function
        // generate-wa-caption yang menyimpan GEMINI_API_KEY di server
        // (pola sama dengan CX_OCR_FUNCTION_URL untuk OCR poster).
        const response = await fetch(WA_CAPTION_FUNCTION_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": "Bearer " + SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ userMsg })
        });
        if (!response.ok) {
            let detail = '';
            try { detail = (await response.json()).error || ''; } catch (e) {}
            throw new Error(detail || 'Gagal memanggil API (status ' + response.status + ')');
        }
        const data = await response.json();
        let result = (data.text || '').trim();
        if (!result) throw new Error('Tidak ada hasil teks dari model.');
        // Jaga-jaga kalau model tetap menulis "Umrah" walau sudah diinstruksikan di system prompt.
        result = normalizeUmrohSpelling(result);
        // Jaga-jaga kalau model menulis singkatan "pp" huruf kecil.
        result = normalizePpAbbreviation(result);
        // Jaga-jaga kalau model lupa tanda bintang judul / baris kosong antar section.
        result = enforceWaCaptionFormat(result);

        teksWaEl.value = result;
        updateWaCaptionGauge(result);
        autoGrowTextarea(teksWaEl);
        syncBroadcastRefBox();
        showToast('Caption WA berhasil dibuat dengan AI');
    } catch (err) {
        console.error(err);
        // Fallback offline: kalau panggilan ke AI gagal (Gemini error/limit
        // habis/internet putus), tetap hasilkan caption otomatis dari
        // template lokal (non-AI) supaya admin tidak buntu — bukan sekreatif
        // versi AI, tapi semua data penting (harga, tanggal, hotel,
        // termasuk/tidak termasuk, kontak) tetap lengkap tersusun.
        try {
            const hasBroadcastText = !!(document.getElementById('parseBroadcastInput')?.value || '').trim();
            if (hasBroadcastText) {
                // parseBroadcastText() sudah menangani parsing lengkap + langsung
                // mengisi admin_teks_wa lewat generateAutoWAText — dipakai ulang
                // di sini supaya hasilnya konsisten dengan tombol "Isi Otomatis".
                parseBroadcastText();
            } else {
                const g = id => (document.getElementById(id)?.value || '').trim();
                const data = {
                    nama: g('admin_nama'), tgl: g('admin_tgl') || g('admin_tgl_date'), durasi: g('admin_durasi'),
                    maskapai: document.getElementById('admin_maskapai')?.value || '',
                    hotel_madinah: g('admin_hotel_madinah'), hotel_makkah: g('admin_hotel_makkah'),
                    hotel_3: g('admin_hotel_3'), hotel_3_kota: g('admin_hotel_3_kota'),
                    hotel_4: g('admin_hotel_4'), hotel_4_kota: g('admin_hotel_4_kota'),
                    harga_quad: g('admin_harga_quad'), harga_triple: g('admin_harga_triple'),
                    harga_double: g('admin_harga_double'), harga_quint: g('admin_harga_quint'),
                    termasuk: g('admin_termasuk'), tidak_termasuk: g('admin_tidak_termasuk')
                };
                teksWaEl.value = generateAutoWAText(data);
                updateWaCaptionGauge(teksWaEl.value);
                autoGrowTextarea(teksWaEl);
                syncBroadcastRefBox();
            }
            showToast('AI gagal (' + err.message + ') — dipakai caption otomatis offline sebagai cadangan', 'error');
        } catch (fallbackErr) {
            console.error(fallbackErr);
            showToast('Gagal generate caption: ' + err.message, 'error');
        }
    } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'Generate dengan AI';
    }
}

// ============================================================
// 4b. GENERATE CAPTION AI MASSAL (untuk program yang teks_wa-nya kosong)
// ============================================================
// Skenario: data program sudah lengkap (hasil Parse Broadcast / OCR poster /
// isian manual admin), tapi caption WA-nya belum pernah di-generate --
// biasanya program lama/hasil import yang belum sempat dibuka satu-satu lewat
// tombol "Generate dengan AI" di form edit. Fitur ini menyisir SEMUA program
// yang teks_wa-nya masih kosong lalu generate captionnya otomatis, berjalan
// satu-per-satu (bukan paralel) supaya tidak kena rate limit Gemini free tier.

// Susun "konsep mentah" dari SATU baris program (bukan dari form DOM seperti
// buildRawConceptFromAdminForm) -- dipakai batch generator supaya tidak perlu
// buka form satu-satu. Sumber data: field program yang sudah di-unpack lewat
// unpackProgramAdminData (harga_quad/hotel/dll sudah di level atas), ditambah
// poster_data (hasil OCR) di admin_data_lengkap sebagai pelengkap untuk field
// yang cuma tersimpan di sana (mis. jarak hotel).
function buildRawConceptFromProgramRow(prog) {
    if (!prog || !prog.nama) return '';
    const adl = (() => {
        try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; }
        catch (e) { return {}; }
    })();
    const pd = adl.poster_data || {};
    const g = key => prog[key] || pd[key] || '';

    const lines = [`*${prog.nama.toUpperCase()}*`];
    const durasi = g('durasi');
    if (durasi) lines.push(`Program ${durasi.toString().replace(/\s*hari/i, '').trim()} Hari`);
    const tgl = g('tgl');
    if (tgl) lines.push(`Tanggal Berangkat: ${tgl}`);
    const maskapai = g('maskapai');
    if (maskapai) lines.push(`*PESAWAT*\n${maskapai}`);
    const hotelMadinah = g('hotel_madinah');
    if (hotelMadinah) {
        const jarak = pd.hotel_madinah_jarak || '';
        lines.push(`*HOTEL MADINAH*\n${hotelMadinah}${jarak ? `\n(${jarak})` : ''}`);
    }
    const hotelMakkah = g('hotel_makkah');
    if (hotelMakkah) {
        const jarak = pd.hotel_makkah_jarak || '';
        lines.push(`*HOTEL MEKAH*\n${hotelMakkah}${jarak ? `\n(${jarak})` : ''}`);
    }
    [3, 4].forEach(n => {
        const h = g(`hotel_${n}`);
        if (h) lines.push(`*HOTEL ${(g(`hotel_${n}_kota`) || String(n)).toUpperCase()}*\n${h}`);
    });
    const hargaLines = [];
    const hargaQuint = g('harga_quint'), hargaQuad = g('harga_quad'), hargaTriple = g('harga_triple'), hargaDouble = g('harga_double');
    if (hargaQuint) hargaLines.push(`${hargaQuint} Quint`);
    if (hargaQuad) hargaLines.push(`${hargaQuad} Quad`);
    if (hargaTriple) hargaLines.push(`${hargaTriple} Triple`);
    if (hargaDouble) hargaLines.push(`${hargaDouble} Double`);
    if (hargaLines.length) lines.push(`*BIAYA PROGRAM*\n${hargaLines.join('\n')}`);
    const termasuk = g('termasuk');
    if (termasuk) lines.push(`*Termasuk*\n${termasuk}`);
    const tidakTermasuk = g('tidak_termasuk');
    if (tidakTermasuk) lines.push(`*Tidak Termasuk*\n${tidakTermasuk}`);
    return lines.join('\n');
}

// Panggil Edge Function generate-wa-caption untuk SATU konsep mentah, lalu
// terapkan normalisasi & jaring pengaman format yang sama dengan
// generateCaptionAI() (tombol single di form) -- dipakai ulang oleh batch generator.
async function callWaCaptionAI(rawConcept) {
    const userMsg = `KONSEP PROGRAM:\n${rawConcept}\n\nNOMOR WA KONTAK YANG DIPAKAI DI BAGIAN PENUTUP:\n${getWaCaptionContacts()}`;
    const response = await fetch(WA_CAPTION_FUNCTION_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": "Bearer " + SUPABASE_ANON_KEY
        },
        body: JSON.stringify({ userMsg })
    });
    if (!response.ok) {
        let detail = '';
        try { detail = (await response.json()).error || ''; } catch (e) {}
        const err = new Error(detail || 'Gagal memanggil API (status ' + response.status + ')');
        // Edge Function membungkus error Gemini jadi status 500 (bukan meneruskan
        // 429 aslinya), jadi rate-limit/quota habis dideteksi dari isi pesan --
        // dipakai runBatchCaptionAI() untuk menghentikan loop lebih awal supaya
        // tidak menghabiskan sisa kuota percuma dengan panggilan yang pasti gagal.
        if (/429|quota|rate.?limit/i.test(detail)) err.isRateLimit = true;
        throw err;
    }
    const data = await response.json();
    let result = (data.text || '').trim();
    if (!result) throw new Error('Tidak ada hasil teks dari model.');
    result = normalizeUmrohSpelling(result);
    result = normalizePpAbbreviation(result);
    result = enforceWaCaptionFormat(result);
    return result;
}


// Cari program yang teks_wa-nya masih kosong TAPI datanya sudah cukup untuk
// disusun jadi caption (minimal nama + salah satu dari durasi/tanggal/harga) --
// program yang datanya masih terlalu kosong (baru dibuat, belum di-parse/OCR
// sama sekali) sengaja dilewati supaya AI tidak mengarang isi.
function getProgramsMissingCaption() {
    if (!adminPrograms || !adminPrograms.length) return [];
    return adminPrograms.filter(p => {
        const kosong = !p.teks_wa || !p.teks_wa.trim();
        if (!kosong) return false;
        const cukupData = !!(p.durasi || p.tgl || p.harga_quad || p.harga_quint || p.harga_triple || p.harga_double);
        return cukupData;
    });
}

// Deteksi caption yang SUDAH ADA ISINYA tapi tidak lengkap -- dicek dengan
// membandingkan section yang seharusnya ada (berdasarkan data program yang
// tersedia) terhadap section yang benar-benar muncul di teks_wa saat ini.
// Bukan menilai "bagus/jelek", murni cek struktur & kelengkapan section wajib
// supaya tidak salah tangkap caption yang sudah oke tapi gaya bahasanya beda.
function isTeksWaBelumLengkap(prog) {
    const text = (prog.teks_wa || '').trim();
    if (!text) return false; // kosong total itu urusan getProgramsMissingCaption, bukan fungsi ini

    const hasJudul = /🕋/.test(text) && /\*[^*\n]+\*/.test(text);
    const hasFasilitasData = !!(prog.maskapai || prog.hotel_makkah || prog.hotel_madinah);
    const hasFasilitasSection = /fasilitas/i.test(text);
    const hasHargaData = !!(prog.harga_quad || prog.harga_quint || prog.harga_triple || prog.harga_double);
    const hasHargaSection = /biaya\s*program/i.test(text) && (text.match(/rp\s*[\d.]+/gi) || []).length > 0;
    const hasTermasukSection = /termasuk/i.test(text);
    const hasKontakSection = /wa\.me\/|info\s*&?\s*itinerary/i.test(text);
    const terlaluPendek = text.length < 120; // caption normal biasanya jauh di atas ini

    return !hasJudul
        || (hasFasilitasData && !hasFasilitasSection)
        || (hasHargaData && !hasHargaSection)
        || !hasTermasukSection
        || !hasKontakSection
        || terlaluPendek;
}

// Sama seperti getProgramsMissingCaption(), tapi untuk caption yang ADA
// isinya tapi terdeteksi belum lengkap (lihat isTeksWaBelumLengkap).
function getProgramsIncompleteCaption() {
    if (!adminPrograms || !adminPrograms.length) return [];
    return adminPrograms.filter(p => {
        const kosong = !p.teks_wa || !p.teks_wa.trim();
        if (kosong) return false; // yang kosong total masuk kategori lain
        const cukupData = !!(p.durasi || p.tgl || p.harga_quad || p.harga_quint || p.harga_triple || p.harga_double);
        if (!cukupData) return false;
        return isTeksWaBelumLengkap(p);
    });
}

let _batchCaptionRunning = false;

// Mesin batch generic dipakai oleh tombol "Caption Kosong" & "Caption Belum
// Lengkap" -- bedanya cuma daftar target & teks konfirmasi/tombolnya.
async function runBatchCaptionAI(targets, opts) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengubah data program', 'error'); return; }
    if (_batchCaptionRunning) { showToast('Sedang berjalan, tunggu sampai selesai...'); return; }
    if (!targets.length) { showToast(opts.emptyMsg); return; }

    const daftar = targets.slice(0, 8).map(p => `• ${escapeHtml(p.nama || '(tanpa nama)')}`).join('<br>');
    const sisa = targets.length > 8 ? `<br>… dan ${targets.length - 8} program lainnya` : '';
    const ok = await openActionConfirm({
        title: opts.confirmTitle,
        message: `${opts.confirmIntro(targets.length)}<br><br>${daftar}${sisa}<br><br>Proses berjalan di background — jangan tutup halaman sampai selesai.`,
        confirmLabel: `Generate ${targets.length} Caption`,
        danger: !!opts.overwrite
    });
    if (!ok) return;

    _batchCaptionRunning = true;
    const btn = document.getElementById(opts.btnId);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Menyusun 0/' + targets.length + '...'; }

    let sukses = 0, gagal = 0, fallbackOffline = 0, kuotaHabis = false;
    const gagalNama = [];
    showToast(`Mulai generate ${targets.length} caption AI...`);

    for (let i = 0; i < targets.length; i++) {
        const prog = targets[i];
        if (btn) {
            const tag = kuotaHabis ? ' (offline)' : '';
            btn.innerHTML = `<i class="bi bi-hourglass-split"></i> Menyusun ${i + 1}/${targets.length}${tag}...`;
        }

        let hasil = null;
        let pakaiFallback = false;

        // Kalau kuota AI sudah diketahui habis (dari item sebelumnya di batch
        // ini), skip langsung ke fallback offline -- tidak perlu coba panggil
        // API lagi karena hampir pasti gagal juga, cuma buang waktu tunggu.
        if (!kuotaHabis) {
            try {
                const raw = buildRawConceptFromProgramRow(prog);
                if (!raw) throw new Error('Data program tidak cukup untuk disusun jadi konsep');
                hasil = await callWaCaptionAI(raw);
            } catch (err) {
                console.error('AI gagal untuk', prog.nama, err);
                if (err.isRateLimit) kuotaHabis = true;
                // jatuh ke fallback offline di bawah, bukan langsung dianggap gagal
            }
        }

        // Fallback offline: sama seperti catch block di generateCaptionAI()
        // (tombol single) -- generateAutoWAText() menyusun caption dari data
        // program yang sudah ada (harga, hotel, termasuk/tidak termasuk, kontak)
        // pakai template lokal, tanpa AI. Tidak sekreatif versi AI, tapi semua
        // data penting tetap lengkap tersusun & program tidak nyangkut kosong.
        if (!hasil) {
            try {
                hasil = generateAutoWAText(prog);
                pakaiFallback = true;
            } catch (err2) {
                console.error('Fallback offline gagal untuk', prog.nama, err2);
            }
        }

        if (hasil) {
            try {
                await updateProgramById(prog.id, { teks_wa: hasil });
                const idx = adminPrograms.findIndex(p => String(p.id) === String(prog.id));
                if (idx >= 0) adminPrograms[idx].teks_wa = hasil;
                sukses++;
                if (pakaiFallback) fallbackOffline++;
            } catch (errSave) {
                console.error('Gagal simpan ke DB untuk', prog.nama, errSave);
                gagal++;
                gagalNama.push(prog.nama || `#${prog.id}`);
            }
        } else {
            gagal++;
            gagalNama.push(prog.nama || `#${prog.id}`);
        }

        // Jeda cuma perlu selama masih memanggil AI -- kalau sudah mode
        // full-offline (kuotaHabis), tidak perlu tunggu, tidak ada API yang dipanggil.
        if (!kuotaHabis && i < targets.length - 1) await new Promise(r => setTimeout(r, 1200));
    }

    _batchCaptionRunning = false;
    await renderAdminPanel();

    let ringkasan = `${sukses} dari ${targets.length} caption tersimpan`;
    if (fallbackOffline > 0) ringkasan += ` (${fallbackOffline} pakai template offline karena kuota AI habis/error)`;
    if (gagal > 0) ringkasan += `, ${gagal} gagal total (${gagalNama.slice(0, 3).join(', ')}${gagalNama.length > 3 ? ', ...' : ''})`;
    showToast((gagal === 0 ? '✓ Selesai — ' : 'Selesai — ') + ringkasan, gagal > 0 ? 'error' : undefined);
}

// Entry point tombol "Caption Kosong" di toolbar Program -- tidak menimpa
// apa pun, cuma menyasar teks_wa yang benar-benar kosong.
async function batchGenerateMissingCaptions() {
    await runBatchCaptionAI(getProgramsMissingCaption(), {
        btnId: 'btnBatchCaption',
        overwrite: false,
        emptyMsg: 'Semua program sudah punya Teks WA — tidak ada yang perlu di-generate',
        confirmTitle: 'Generate Caption AI untuk Program Kosong',
        confirmIntro: n => `Ditemukan <strong>${n} program</strong> yang Teks WA-nya masih kosong (data lain sudah lengkap dari Parse Broadcast/OCR/isian manual). AI akan menyusun caption untuk semua program ini satu per satu:`
    });
}
window.batchGenerateMissingCaptions = batchGenerateMissingCaptions;

// Entry point tombol "Caption Belum Lengkap" -- INI MENIMPA teks_wa yang
// sudah ada isinya (karena terdeteksi section pentingnya hilang), makanya
// pesan konfirmasinya ditandai "danger" & bahasanya eksplisit soal timpa.
async function batchGenerateIncompleteCaptions() {
    await runBatchCaptionAI(getProgramsIncompleteCaption(), {
        btnId: 'btnBatchCaptionIncomplete',
        overwrite: true,
        emptyMsg: 'Tidak ada caption yang terdeteksi belum lengkap saat ini',
        confirmTitle: 'Generate Ulang Caption yang Belum Lengkap',
        confirmIntro: n => `Ditemukan <strong>${n} program</strong> yang Teks WA-nya SUDAH ADA ISI tapi terdeteksi belum lengkap (section wajib seperti judul/fasilitas/biaya/termasuk/kontak ada yang hilang, dibandingkan data yang tersedia). <strong style="color:var(--danger);">Isi teks_wa program-program ini akan DITIMPA</strong> dengan caption baru dari AI:`
    });
}
window.batchGenerateIncompleteCaptions = batchGenerateIncompleteCaptions;


// ============================================================
// 4c. PERSIST HALAMAN TERAKHIR
// Supaya tekan F5 (reload) tetap balik ke halaman/tab/subtab yang
// terakhir dibuka, bukan selalu dilempar ke Dashboard (tab Program
// Umroh). Disimpan di localStorage (bukan per-session), dipulihkan
// sekali di akhir alur DOMContentLoaded setelah data awal & status
// login (checkSession) siap.
// ============================================================
const LAST_VIEW_KEY = 'amiruDashboardLastView';

function saveLastView(view) {
    try { localStorage.setItem(LAST_VIEW_KEY, JSON.stringify(view)); } catch (e) { /* localStorage penuh/diblokir -- abaikan, bukan fatal */ }
}

function getLastView() {
    try {
        const raw = localStorage.getItem(LAST_VIEW_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

async function restoreLastView() {
    const last = getLastView();
    if (!last || !last.view) return;
    // Belum login (atau sesi sudah habis) -> jangan buka halaman terakhir yang
    // butuh login (IG Scheduler, Infografis, Admin, tab internal) -- kalau tidak,
    // yang tampil halaman kosong. Kembali ke dashboard utama & reset halaman tersimpan.
    // checkSession() sudah selesai dipanggil sebelum restoreLastView(), jadi
    // adminLoggedIn di titik ini sudah final.
    if (!adminLoggedIn) {
        if (last.view !== 'dashboard' || (last.tab && last.tab !== 'umroh')) {
            saveLastView({ view: 'dashboard', tab: 'umroh' });
        }
        return;
    }
    if (last.view === 'admin' && last.subtab) {
        // Kalau sesi admin ternyata sudah habis, openAdminPanel() otomatis
        // nampilin layar login biasa (subtab-nya diabaikan) -- tidak error.
        await openAdminPanel(last.subtab);
    } else if (last.view === 'igScheduler') {
        openIgSchedulerPage();
    } else if (last.view === 'infografis') {
        openInfografisPage();
    } else if (last.view === 'dashboard' && last.tab && last.tab !== 'umroh') {
        switchTab(last.tab);
    }
}

// ============================================================
// 5. TAB SWITCHING
// ============================================================
function switchTab(tabId) {
    // IG Scheduler sekarang halaman mandiri (seperti Assets dkk), bukan tab-panel
    // di dashboard utama -- alihkan ke situ, jangan diproses sebagai tab biasa.
    if (tabId === 'igScheduler') {
        openIgSchedulerPage();
        return;
    }
    if (tabId === 'infografis') {
        openInfografisPage();
        return;
    }

    // Kalau sedang di halaman Admin Panel, otomatis kembali dulu ke dashboard
    // supaya menu navigasi (Program, Unggulan, Jadwal Tamu, Keberangkatan)
    // langsung bisa diakses tanpa harus klik "Kembali" secara manual.
    const adminView = document.getElementById('adminPageView');
    if (adminView && adminView.style.display !== 'none') {
        adminView.style.display = 'none';
        document.getElementById('dashboardView').style.display = 'block';
        if (currentData && currentData.length) renderTable(currentData);
        applyRoleUIVisibility();
    }

    // Sama halnya kalau sedang di halaman IG Scheduler -- tutup dulu supaya
    // dashboardView kembali tampil, jangan sampai sidebar "tidak merespon"
    // karena tab sudah berpindah di balik layar IG Scheduler yang masih terbuka.
    const igView = document.getElementById('igSchedulerPageView');
    if (igView && igView.style.display !== 'none') {
        igView.style.display = 'none';
        document.getElementById('dashboardView').style.display = 'block';
    }

    // Sama halnya kalau sedang di halaman Infografis
    const infografisView = document.getElementById('infografisPageView');
    if (infografisView && infografisView.style.display !== 'none') {
        infografisView.style.display = 'none';
        document.getElementById('dashboardView').style.display = 'block';
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === 'tab-' + tabId);
    });
    document.querySelectorAll('.sidebar .nav-item[data-tab]').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabId);
    });
    if (tabId === 'info') renderJadwalSection();
    if (tabId === 'todocs') renderTodoCsPanel();
    if (tabId === 'pendaftaran') renderPendaftaranSection();
    if (tabId === 'keberangkatan') renderKbProgramSelector();
    if (tabId === 'dokumen') renderDokProgramSelector();
    if (tabId === 'kepulangan') renderKepulanganProgramSelector();
    if (tabId === 'arsip') { loadArsipJamaah().then(renderArsipProgramSelector); }

    saveLastView({ view: 'dashboard', tab: tabId });
}

// ============================================================
// 5b. IG SCHEDULER — halaman mandiri (bukan tab-panel/card di dashboard utama)
// ============================================================
let previousActiveTabForIg = null;

async function openIgSchedulerPage() {
    // Tutup Admin Panel dulu kalau kebetulan sedang terbuka
    const adminView = document.getElementById('adminPageView');
    if (adminView && adminView.style.display !== 'none') {
        adminView.style.display = 'none';
    }

    // Tutup Infografis kalau kebetulan sedang terbuka -- BUG FIX: sebelumnya
    // kalau pindah langsung Infografis -> IG Scheduler lewat sidebar, halaman
    // infografisPageView tidak pernah di-hide (switchTab short-circuit ke sini
    // tanpa lewat closeInfografisPage()). Akibatnya dua halaman besar
    // bertumpuk display:block sekaligus -> terasa lemot/flicker.
    const infografisView = document.getElementById('infografisPageView');
    if (infografisView && infografisView.style.display !== 'none') {
        infografisView.style.display = 'none';
    }

    const activeTabBtn = document.querySelector('.sidebar .nav-item[data-tab].active');
    previousActiveTabForIg = activeTabBtn ? activeTabBtn.dataset.tab : null;

    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('igSchedulerPageView').style.display = 'block';

    document.querySelectorAll('.sidebar .nav-item').forEach(item => item.classList.remove('active'));
    const navBtn = document.querySelector('.sidebar .nav-item[data-tab="igScheduler"]');
    if (navBtn) navBtn.classList.add('active');

    window.scrollTo({ top: 0, behavior: 'smooth' });
    saveLastView({ view: 'igScheduler' });

    // Isi halaman IG ada di modul lazy: unduh dulu (cuma sekali), baru muat data & render.
    // Kerangka halaman (HTML di index.html) sudah tampil sambil menunggu.
    try {
        await ensureModuleLoaded('ig-scheduler');
    } catch (err) {
        console.error('Gagal memuat modul IG Scheduler:', err);
        showToast('Gagal memuat modul IG Scheduler. Periksa koneksi lalu coba lagi.', 'error');
        return;
    }
    igOnPageOpen();
}

function closeIgSchedulerPage() {
    document.getElementById('igSchedulerPageView').style.display = 'none';
    document.getElementById('dashboardView').style.display = 'block';

    document.querySelectorAll('.sidebar .nav-item').forEach(item => item.classList.remove('active'));
    if (previousActiveTabForIg) {
        document.querySelectorAll('.sidebar .nav-item[data-tab]').forEach(item => {
            item.classList.toggle('active', item.dataset.tab === previousActiveTabForIg);
        });
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === previousActiveTabForIg);
        });
    } else {
        const umrohNav = document.querySelector('.sidebar .nav-item[data-tab="umroh"]');
        if (umrohNav) umrohNav.classList.add('active');
    }

    saveLastView({ view: 'dashboard', tab: previousActiveTabForIg || 'umroh' });
}

// ============================================================
// 5b. DAFTAR MENU SIDEBAR (SATU SUMBER) — dirender ke sidebar desktop DAN
// drawer mobile. Menambah menu cukup menambah satu baris di NAV_MENU:
//   tab    = id tab dashboard (data-tab)       | subtab = panel admin (data-subtab)
//   reg    = { group, label? } -> ikut tampil di Pengaturan User > Akses Menu
//            (SIDEBAR_MENU_REGISTRY diturunkan otomatis dari sini)
//   badge  = nama badge angka (id badge<Nama>Desktop / Mobile)
// gate: 'always' (semua), 'login' (nav-loggedin-only), 'admin' (nav-admin-only)
// ============================================================
const NAV_MENU = [
    { label: 'Navigasi', gate: 'login', foldable: false, items: [
        { tab: 'umroh', icon: 'bi-list-ul', text: 'Program Umroh', gate: 'always', active: true },
        { tab: 'unggulan', icon: 'bi-star-fill', text: 'Unggulan' },
        { tab: 'info', icon: 'bi-calendar-check-fill', text: 'Jadwal Tamu', reg: { group: 'Navigasi' } }
    ]},
    { label: 'Siklus Jamaah', gate: 'login', group: true, items: [
        { tab: 'todocs', icon: 'bi-list-check', text: 'Reminder', reg: { group: 'Navigasi' } },
        { tab: 'pendaftaran', icon: 'bi-clipboard-check-fill', text: 'Pendaftaran', reg: { group: 'Navigasi' } },
        { tab: 'keberangkatan', icon: 'bi-airplane-engines-fill', text: 'Data Jamaah', reg: { group: 'Navigasi' } },
        { tab: 'dokumen', icon: 'bi-file-earmark-check-fill', text: 'Dokumen', badge: 'Dokumen', reg: { group: 'Navigasi' } },
        { tab: 'kepulangan', icon: 'bi-house-door-fill', text: 'Status Kepulangan', badge: 'Kepulangan', reg: { group: 'Navigasi' } }
    ]},
    { label: 'Social Media', gate: 'login', group: true, items: [
        { tab: 'igScheduler', icon: 'bi-instagram', text: 'IG Scheduler', reg: { group: 'Social Media' } },
        { tab: 'infografis', icon: 'bi-images', text: 'Infografis', reg: { group: 'Social Media' } }
    ]},
    { label: 'Arsip', gate: 'login', group: true, items: [
        { tab: 'arsip', icon: 'bi-archive-fill', text: 'Arsip Jamaah', reg: { group: 'Navigasi' } }
    ]},
    { label: 'Manajemen', gate: 'admin', items: [
        { subtab: 'program', icon: 'bi-moon-stars-fill', text: 'Edit Program', reg: { group: 'Manajemen' } },
        { subtab: 'pembayaran', icon: 'bi-cash-stack', text: 'Pembayaran', reg: { group: 'Manajemen' } },
        { subtab: 'unggulan', icon: 'bi-star-fill', text: 'Unggulan', reg: { group: 'Manajemen', label: 'Unggulan (Admin)' } },
        { subtab: 'auditnota', icon: 'bi-file-earmark-lock2-fill', text: 'Audit Nota', reg: { group: 'Manajemen' } },
        { subtab: 'assets', icon: 'bi-bookmark-star-fill', text: 'Assets', reg: { group: 'Manajemen' } }
    ]},
    { label: 'System', gate: 'admin', items: [
        { subtab: 'systemstatus', icon: 'bi-activity', text: 'System' },
        { subtab: 'crosscheck', icon: 'bi-graph-up-arrow', text: 'Crosscheck', reg: { group: 'System' } },
        { subtab: 'telegram', icon: 'bi-telegram', text: 'Telegram', reg: { group: 'System' } },
        { subtab: 'usersettings', icon: 'bi-person-gear', text: 'Pengaturan User', reg: { group: 'System' } },
        { subtab: 'snapshot', icon: 'bi-camera2', text: 'Snapshot', title: 'Snapshot / Backup', reg: { group: 'System' } },
        { subtab: 'profil', icon: 'bi-building', text: 'Perusahaan', reg: { group: 'System' } }
    ]}
];

const NAV_FOLD_KEY = 'amiru_nav_folded';
function _navGateClass(gate) {
    return gate === 'admin' ? ' nav-admin-only is-hidden' : gate === 'login' ? ' nav-loggedin-only is-hidden' : '';
}
function buildNavHTML(variant) {
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    let html = '';
    NAV_MENU.forEach((sec, i) => {
        const foldable = sec.foldable !== false && i > 0;
        const labelCls = 'nav-label' + (sec.gate === 'admin' ? ' nav-admin-only is-hidden' : '') + (sec.group ? ' nav-group-label is-hidden' : '');
        html += i === 0
            ? `<div class="nav-label">${esc(sec.label)}</div>`
            : `<div class="${labelCls}"${foldable ? ` role="button" tabindex="0" aria-expanded="true" data-fold="${esc(sec.label)}"` : ''}>${esc(sec.label)}</div>`;
        sec.items.forEach(it => {
            const key = it.tab ? `data-tab="${it.tab}"` : `data-subtab="${it.subtab}"`;
            const gate = it.gate || sec.gate;
            const badge = it.badge ? `<span class="nav-badge" id="badge${it.badge}${variant}"></span>` : '';
            html += `<button type="button" class="nav-item${_navGateClass(gate)}${it.active ? ' active' : ''}" ${key} title="${esc(it.title || it.text)}">` +
                `<i class="bi ${it.icon}"></i> <span class="nav-text">${esc(it.text)}</span>${badge}</button>`;
        });
    });
    if (variant === 'Desktop') html += '<div class="sidebar-vtext" aria-hidden="true">PT AMIRU HARAMAIN INDONESIA</div>';
    html += '<div class="nav-login-area">' +
        '<button type="button" class="nav-item login-btn" data-nav-action="login" title="Login"><i class="bi bi-box-arrow-in-right"></i> <span class="nav-text">Login</span></button>' +
        '<button type="button" class="nav-item logout-btn is-hidden" data-nav-action="logout" title="Logout"><i class="bi bi-box-arrow-right"></i> <span class="nav-text">Logout</span></button>' +
        '</div>';
    return html;
}

function _loadNavFolded() {
    try { return new Set(JSON.parse(localStorage.getItem(NAV_FOLD_KEY) || '[]')); } catch (_) { return new Set(); }
}
function setNavFold(labelEl, folded) {
    labelEl.setAttribute('aria-expanded', String(!folded));
    labelEl.classList.toggle('is-folded', folded);
    let el = labelEl.nextElementSibling;
    while (el && !el.classList.contains('nav-label') && !el.classList.contains('nav-login-area') && !el.classList.contains('sidebar-vtext')) {
        el.classList.toggle('is-folded', folded);
        el = el.nextElementSibling;
    }
}
function toggleNavFold(labelEl) {
    const folded = labelEl.getAttribute('aria-expanded') === 'true';
    const name = labelEl.dataset.fold;
    // Kunci lipatan yang sama di desktop & mobile supaya keduanya sinkron
    document.querySelectorAll('[data-fold]').forEach(l => { if (l.dataset.fold === name) setNavFold(l, folded); });
    const set = _loadNavFolded();
    if (folded) set.add(name); else set.delete(name);
    try { localStorage.setItem(NAV_FOLD_KEY, JSON.stringify([...set])); } catch (_) {}
}

(function renderNavMenus() {
    const targets = [['sidebarNav', 'Desktop'], ['mobileSidebarNav', 'Mobile']];
    const folded = _loadNavFolded();
    targets.forEach(([id, variant]) => {
        const nav = document.getElementById(id);
        if (!nav) return;
        nav.innerHTML = buildNavHTML(variant);
        const isMobile = variant === 'Mobile';
        nav.querySelectorAll('[data-fold]').forEach(l => { if (folded.has(l.dataset.fold)) setNavFold(l, true); });
        nav.addEventListener('click', (e) => {
            const fold = e.target.closest('[data-fold]');
            if (fold) { toggleNavFold(fold); return; }
            const btn = e.target.closest('.nav-item');
            if (!btn) return;
            const done = () => { if (isMobile) toggleMobileSidebar(); };
            if (btn.dataset.tab) { if (isMobile) { switchTab(btn.dataset.tab); done(); } return; } // desktop: ditangani listener .sidebar .nav-item[data-tab]
            if (btn.dataset.subtab) { openAdminPanel(btn.dataset.subtab); done(); return; }
            if (btn.dataset.navAction === 'login') { openAdminPanel(); done(); }
            else if (btn.dataset.navAction === 'logout') { logoutAdmin(); done(); }
        });
        nav.addEventListener('keydown', (e) => {
            const fold = e.target.closest && e.target.closest('[data-fold]');
            if (fold && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleNavFold(fold); }
        });
    });
})();

// ============================================================
// AKSI KLIK DELEGASI — pengganti onclick="fn('arg')" inline di index.html.
// Markup: data-action="namaFungsiGlobal" [data-args='["arg1", 2]'].
// Pakai fase capture supaya tetap jalan walau ada handler lain yang
// menghentikan propagasi. Handler yang butuh `this`/`event` tetap inline.
// ============================================================
document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = window[el.dataset.action];
    if (typeof fn !== 'function') { console.warn('data-action tidak dikenal:', el.dataset.action); return; }
    let args = [];
    if (el.dataset.args) { try { args = JSON.parse(el.dataset.args); } catch (_) { args = []; } }
    fn.apply(el, args);
}, true);

// ============================================================
// AKSESIBILITAS MODAL — role="dialog"/aria-modal sudah ada di index.html;
// bagian ini melengkapi modal yang dibuat lewat JS, lalu mengelola fokus:
// fokus pindah ke dalam modal saat dibuka, Tab berputar di dalamnya, Esc
// menutup (lewat tombol tutup modal itu sendiri), dan fokus dikembalikan
// ke tombol pemicu saat modal ditutup.
// ============================================================
(function initModalA11y() {
    const OVERLAYS = '.modal-overlay, .mobile-sidebar-overlay';
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const lastFocus = new WeakMap();
    const wasOpen = new WeakMap();

    const dialogOf = (ov) => ov.querySelector(':scope > .modal-content, :scope > .mobile-sidebar') || ov;
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const focusables = (ov) => [...dialogOf(ov).querySelectorAll(FOCUSABLE)].filter(visible);
    const openOverlays = () => [...document.querySelectorAll(OVERLAYS)].filter(o => o.classList.contains('open'));

    function prepare(ov) {
        const dlg = dialogOf(ov);
        if (!dlg.hasAttribute('role')) dlg.setAttribute('role', 'dialog');
        dlg.setAttribute('aria-modal', 'true');
        if (!dlg.hasAttribute('aria-labelledby') && !dlg.hasAttribute('aria-label')) {
            const h = dlg.querySelector('h1, h2, h3');
            if (h) {
                if (!h.id) h.id = (ov.id || 'dlg' + Math.random().toString(36).slice(2, 7)) + '-title';
                dlg.setAttribute('aria-labelledby', h.id);
            }
        }
    }

    function onOpenChange(ov) {
        const open = ov.classList.contains('open');
        if (open === !!wasOpen.get(ov)) return;
        wasOpen.set(ov, open);
        if (open) {
            lastFocus.set(ov, document.activeElement);
            requestAnimationFrame(() => {
                const dlg = dialogOf(ov);
                if (dlg.contains(document.activeElement)) return; // modal sudah memfokuskan inputnya sendiri
                const first = focusables(ov).find(el => !el.classList.contains('modal-close') && !el.classList.contains('close-btn')) || focusables(ov)[0];
                // Input tanggal/bulan jangan jadi fokus otomatis: segmen pertamanya (mis. "October") ikut ter-blok biru seperti sedang diseleksi.
                const tglInput = first && first.tagName === 'INPUT' && /^(month|date|week|time|datetime-local)$/.test(first.type);
                if (first && !tglInput) first.focus();
                else { dlg.setAttribute('tabindex', '-1'); dlg.style.outline = 'none'; dlg.focus(); }
            });
        } else {
            const back = lastFocus.get(ov);
            lastFocus.delete(ov);
            if (back && back.isConnected && typeof back.focus === 'function' && !openOverlays().length) back.focus();
        }
    }

    document.querySelectorAll(OVERLAYS).forEach(ov => { prepare(ov); wasOpen.set(ov, ov.classList.contains('open')); });

    new MutationObserver((muts) => {
        for (const m of muts) {
            if (m.type === 'attributes') {
                if (m.target.matches && m.target.matches(OVERLAYS)) onOpenChange(m.target);
            } else {
                m.addedNodes.forEach(n => {
                    if (n.nodeType !== 1) return;
                    if (n.matches(OVERLAYS)) { prepare(n); onOpenChange(n); }
                    n.querySelectorAll && n.querySelectorAll(OVERLAYS).forEach(ov => { prepare(ov); onOpenChange(ov); });
                });
            }
        }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

    let escTarget = null;
    document.addEventListener('keydown', (e) => {
        const stack = openOverlays();
        if (!stack.length) return;
        const top = stack[stack.length - 1];
        if (e.key === 'Escape') {
            // Catat modal teratas SEBELUM handler lain jalan; kalau setelahnya
            // modal itu masih terbuka, tutup lewat tombol tutupnya sendiri.
            escTarget = top;
            setTimeout(() => {
                const t = escTarget; escTarget = null;
                if (!t || !t.classList.contains('open')) return;
                const closer = t.querySelector('.modal-close, .close-btn');
                if (closer) closer.click();
            }, 0);
            return;
        }
        if (e.key !== 'Tab') return;
        const list = focusables(top);
        if (!list.length) { e.preventDefault(); return; }
        const first = list[0], last = list[list.length - 1];
        const inside = dialogOf(top).contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
    }, true);
})();

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
document.querySelectorAll('.sidebar .nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', () => switchTab(item.dataset.tab));
});

// ============================================================
// 5c. INFOGRAFIS — halaman mandiri, galeri gambar dari folder
// Google Drive publik. Data metadata (nama file, URL thumbnail)
// di-cache di tabel Supabase `infografis_items` (Level 1 caching,
// lihat sql/tambah_infografis_items.sql) supaya dashboard baca
// dari Supabase (cepat, tidak kena CSP), bukan langsung fetch ke
// script.google.com tiap buka menu. Sinkronisasi data yang
// sebenarnya (Drive -> tabel) dikerjakan Edge Function
// sync-infografis (server-side), dipanggil lewat tombol "Refresh".
// ============================================================
const SYNC_INFOGRAFIS_URL = `${SUPABASE_URL}/functions/v1/sync-infografis`;

let infografisItems = [];
let infografisLoaded = false;
let previousActiveTabForInfografis = null;

function openInfografisPage() {
    const adminView = document.getElementById('adminPageView');
    if (adminView && adminView.style.display !== 'none') {
        adminView.style.display = 'none';
    }

    // Tutup IG Scheduler kalau kebetulan sedang terbuka -- BUG FIX: sama
    // seperti di openIgSchedulerPage(), supaya dua halaman besar tidak
    // pernah bertumpuk display:block sekaligus.
    const igView = document.getElementById('igSchedulerPageView');
    if (igView && igView.style.display !== 'none') {
        igView.style.display = 'none';
    }

    const activeTabBtn = document.querySelector('.sidebar .nav-item[data-tab].active');
    previousActiveTabForInfografis = activeTabBtn ? activeTabBtn.dataset.tab : null;

    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('infografisPageView').style.display = 'block';

    document.querySelectorAll('.sidebar .nav-item').forEach(item => item.classList.remove('active'));
    const navBtn = document.querySelector('.sidebar .nav-item[data-tab="infografis"]');
    if (navBtn) navBtn.classList.add('active');

    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadInfografisGallery();

    saveLastView({ view: 'infografis' });
}

function closeInfografisPage() {
    document.getElementById('infografisPageView').style.display = 'none';
    document.getElementById('dashboardView').style.display = 'block';

    document.querySelectorAll('.sidebar .nav-item').forEach(item => item.classList.remove('active'));
    if (previousActiveTabForInfografis) {
        document.querySelectorAll('.sidebar .nav-item[data-tab]').forEach(item => {
            item.classList.toggle('active', item.dataset.tab === previousActiveTabForInfografis);
        });
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === previousActiveTabForInfografis);
        });
    } else {
        const umrohNav = document.querySelector('.sidebar .nav-item[data-tab="umroh"]');
        if (umrohNav) umrohNav.classList.add('active');
    }

    saveLastView({ view: 'dashboard', tab: previousActiveTabForInfografis || 'umroh' });
}

// forceSync = true kalau dipanggil dari tombol "Refresh" -> minta Edge
// Function tarik ulang data terbaru dari Apps Script/Drive dulu sebelum
// query tabel. Kalau false, langsung baca cache tabel Supabase (cepat).
async function loadInfografisGallery(forceSync = false) {
    const body = document.getElementById('infografisGalleryBody');
    const countEl = document.getElementById('infografisCount');
    if (!body) return;

    if (infografisLoaded && !forceSync) {
        renderInfografisGallery();
        return;
    }

    body.innerHTML = '<div class="ig-empty"><i class="bi bi-hourglass-split"></i> Memuat...</div>';
    if (countEl) countEl.textContent = '';

    try {
        if (forceSync) {
            showToast('Menyinkron galeri dari Google Drive...', 'info');
            const syncRes = await fetch(SYNC_INFOGRAFIS_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${(await supabaseClient.auth.getSession()).data.session?.access_token || ''}`
                },
                body: JSON.stringify({})
            });
            const syncResult = await syncRes.json().catch(() => ({}));
            if (!syncResult.ok) {
                showToast('Sync gagal: ' + (syncResult.error || syncRes.statusText), 'error');
                // tetap lanjut baca cache lama di tabel supaya galeri tidak kosong total
            } else {
                showToast(`Sync selesai — ${syncResult.synced || 0} gambar`, 'success');
            }
        }

        const { data, error } = await supabaseClient
            .from('infografis_items')
            .select('id, name, thumb_url, full_url, drive_updated_at')
            .order('drive_updated_at', { ascending: false, nullsFirst: false });
        if (error) throw error;

        infografisItems = (data || []).map(row => ({
            id: row.id,
            name: row.name,
            thumbUrl: row.thumb_url,
            fullUrl: row.full_url
        }));
        infografisLoaded = true;
        renderInfografisGallery();
    } catch (err) {
        body.innerHTML = `
            <div class="ig-empty">
                <i class="bi bi-exclamation-triangle"></i>
                Gagal memuat galeri infografis.<br>
                <span style="font-size:11.5px;color:var(--ink-soft);">${escapeHtml(err.message || String(err))}</span>
            </div>`;
    }
}

function renderInfografisGallery() {
    const body = document.getElementById('infografisGalleryBody');
    const countEl = document.getElementById('infografisCount');
    if (!body) return;

    if (countEl) countEl.textContent = infografisItems.length ? `${infografisItems.length} gambar` : '';

    if (!infografisItems.length) {
        body.innerHTML = '<div class="ig-empty"><i class="bi bi-images"></i> Belum ada gambar di folder ini.</div>';
        return;
    }

    body.innerHTML = `<div class="infografis-grid">
        ${infografisItems.map(item => `
            <div class="infografis-card"
                 data-poster="${escapeHtmlAttr(item.thumbUrl || '')}"
                 data-nama="${escapeHtmlAttr(item.name || '')}"
                 onmouseenter="showPosterPopup(event,this)"
                 onmouseleave="hidePosterPopup()"
                 onclick="window.open('${escapeJsAttr(item.fullUrl || item.thumbUrl || '')}','_blank')"
                 title="${escapeHtmlAttr(item.name || '')}">
                <img src="${escapeHtmlAttr(item.thumbUrl || '')}" alt="${escapeHtmlAttr(item.name || '')}" loading="lazy">
                <div class="infografis-card-name">${escapeHtml(item.name || '')}</div>
            </div>
        `).join('')}
    </div>`;
}

window.openInfografisPage = openInfografisPage;
window.closeInfografisPage = closeInfografisPage;
window.loadInfografisGallery = loadInfografisGallery;

// ============================================================
// 5d. REKAP PROGRAM & INFOGRAFIS — dua kartu di dashboard (Infografis
// menggantikan kartu "Jadwal Tamu"; Rekap Program menggantikan "Unggulan"). Klik kartu -> galeri poster rekap 1080 x 1920 dari
// folder Google Drive KHUSUS rekap (beda folder dengan Infografis).
// Metodenya sama dengan Infografis: Apps Script -> Edge Function
// sync-rekap-program -> tabel rekap_program_items (lihat
// sql/52_tambah_rekap_program_items.sql) -> dibaca dari Supabase.
//
// Dua lapis, seperti membuka galeri di HP:
//   1. Galeri  : grid thumbnail, terbaru dulu (minimal 4 kanvas;
//                yang belum terisi tampil sebagai kanvas kosong).
//   2. Pratinjau layar penuh: klik poster -> pindah poster dengan
//                panah / tombol ← → / geser di HP; Esc atau tombol
//                kembali -> balik ke galeri.
// ============================================================
const SYNC_REKAP_PROGRAM_URL = `${SUPABASE_URL}/functions/v1/sync-rekap-program`;
const REKAP_MIN_TILES = 4;        // grid selalu minimal 4 kanvas (kosong kalau belum ada gambar)
const REKAP_SWIPE_PX = 50;        // jarak geser minimal agar dihitung pindah poster
let rekapIndex = 0;               // poster yang sedang dibuka di pratinjau

// Satu modal galeri + pratinjau dipakai bersama oleh dua kartu dashboard:
//   'rekap'      -> kartu Rekap Program (tabel rekap_program_items)
//   'infografis' -> kartu Infografis    (tabel infografis_items, lihat sql/55_infografis_akses_publik.sql)
// Keduanya boleh dibuka TANPA login (baca saja). Data tiap sumber disimpan terpisah di rekapStore.
const REKAP_SOURCES = {
    rekap: {
        table: 'rekap_program_items', syncUrl: SYNC_REKAP_PROGRAM_URL, metricId: 'totalRekapProgram',
        title: 'Rekap Program', sub: 'Poster rekap terbaru · ketuk untuk memperbesar', icon: 'bi-images',
        unit: 'poster', alt: 'Rekap Program', ratio45: false, limit: 0,
        loading: 'Memuat rekap…', syncing: 'Menyinkron rekap dari Google Drive...',
        empty: 'Belum ada gambar di folder rekap', fail: 'Gagal memuat rekap: '
    },
    infografis: {
        table: 'infografis_items', syncUrl: SYNC_INFOGRAFIS_URL, metricId: 'totalInfografis',
        title: 'Infografis', sub: 'Infografis terbaru · ketuk untuk memperbesar', icon: 'bi-pie-chart-fill',
        unit: 'gambar', alt: 'Infografis', ratio45: true, limit: 0,    // rasio 4:5; semua gambar dimuat, area lihat awal 10 (2 baris x 5), sisanya di-scroll
        loading: 'Memuat infografis…', syncing: 'Menyinkron infografis dari Google Drive...',
        empty: 'Belum ada gambar di folder infografis', fail: 'Gagal memuat infografis: '
    }
};
let rekapSource = 'rekap';        // sumber yang sedang tampil di modal
const rekapStore = {
    rekap:      { items: [], loaded: false, metricFetched: false },   // items: { id, name, fullUrl, thumbUrl, updatedAt }
    infografis: { items: [], loaded: false, metricFetched: false }
};
function rekapItems() { return rekapStore[rekapSource].items; }

function openRekapGallery(src) {
    // Boleh dibuka tanpa login (baca saja; lihat sql/53 & sql/55).
    // Tombol Refresh (sync Drive) tetap hanya tampil untuk yang boleh kelola program.
    rekapSource = REKAP_SOURCES[src] ? src : 'rekap';
    const cfg = REKAP_SOURCES[rekapSource];
    document.getElementById('rekapTitle').textContent = cfg.title;
    document.getElementById('rekapSub').textContent = cfg.sub;
    const ic = document.getElementById('rekapHeadIconI');
    if (ic) ic.className = 'bi ' + cfg.icon;
    const lbImg = document.getElementById('rekapLbImg');
    if (lbImg) lbImg.alt = cfg.alt;
    // Infografis memakai rasio 4:5 (Rekap Program tetap 9:16) -- lihat .rekap-ratio-45 di css/style.css
    ['rekapProgramModal', 'rekapLightbox'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('rekap-ratio-45', !!cfg.ratio45);
    });
    document.getElementById('rekapProgramModal').classList.add('open');
    const refreshBtn = document.getElementById('btnRekapRefresh');
    if (refreshBtn) refreshBtn.style.display = canManageProgramData() ? '' : 'none';
    loadRekapProgram();
}
function openRekapProgramModal() { openRekapGallery('rekap'); }
function openInfografisModal() { openRekapGallery('infografis'); }

// ============================================================
// MICROBLOG -- feed ringkas isi Content Planner (tabel ig_content_plan) di dashboard.
// Menggantikan tile "Keberangkatan"; klik tile membuka modal berisi kartu-kartu konten
// sederhana untuk publik (gambar + tanggal + tema + caption; tanpa filter/pilar/tahap). Gambar sementara DUMMY
// (blok warna sesuai pilar + teks_gambar) sampai media asli tersedia.
// Terbuka untuk SEMUA pengunjung (guest & anonim, baca saja). Data dibaca dari view `microblog_publik`
// (sql/58) -- bukan tabel ig_content_plan langsung -- supaya kolom internal (canva_url, dll) tidak terbuka.
// Rencana berstatus "dilewati" tidak ditampilkan.
// Urutan: tanggal terdekat (hari ini ke depan) dulu, lalu yang sudah lewat dari yang terbaru.
// ============================================================
const mbState = { items: [], loaded: false, loading: false, shown: 0, countFetched: false };
const MB_PAGE = 8;

function mbTodayKey() { return new Date().toLocaleDateString('en-CA'); }

async function refreshMicroblogMetric() {
    const el = document.getElementById('totalMicroblog');
    if (!el || mbState.countFetched) return;
    mbState.countFetched = true;
    try {
        const { count, error } = await supabaseClient.from('microblog_publik')
            .select('id', { count: 'exact', head: true });
        if (error) throw error;
        el.textContent = count ?? 0;
    } catch (_) { el.textContent = '–'; }
}

function openMicroblogModal() {
    document.getElementById('microblogModal').classList.add('open');
    loadMicroblog();
}
function closeMicroblogModal() {
    document.getElementById('microblogModal')?.classList.remove('open');
}

async function loadMicroblog() {
    const feed = document.getElementById('mbFeed');
    if (!feed || mbState.loading) return;
    mbState.loading = true;
    if (!mbState.loaded) feed.innerHTML = '<div class="mb-skel"><div></div><div></div></div><div class="mb-skel"><div></div><div></div></div>';
    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('microblog_publik').select('*').order('tanggal', { ascending: true }),
            { label: 'Muat microblog' }
        );
        if (error) throw error;
        const today = mbTodayKey();
        const rows = data || [];
        const upcoming = rows.filter(r => r.tanggal >= today);                       // sudah urut naik
        const past = rows.filter(r => r.tanggal < today).reverse();                  // terbaru dulu
        mbState.items = [...upcoming, ...past];
        mbState.loaded = true;
        mbState.shown = MB_PAGE;
        const el = document.getElementById('totalMicroblog');
        if (el) el.textContent = rows.length;
        renderMicroblog();
    } catch (err) {
        console.error('loadMicroblog error:', err);
        feed.innerHTML = '<div class="mb-empty"><i class="bi bi-exclamation-triangle"></i><p>Gagal memuat konten: ' + escapeHtml(err.message || String(err)) + '</p></div>';
    } finally {
        mbState.loading = false;
    }
}

function mbLoadMore() { mbState.shown += MB_PAGE; renderMicroblog(); }
function mbToggleCaption(btn) {
    const cap = btn.previousElementSibling;
    const open = cap.classList.toggle('open');
    btn.textContent = open ? 'Tutup' : 'Selengkapnya';
}

// Nomor WA perusahaan untuk tombol "Tanya via WhatsApp" (pakai kontak_wa pertama, fallback ke telp).
function mbWaNumber() {
    const n = String((NOTA_PERUSAHAAN.kontak_wa || [])[0] || NOTA_PERUSAHAAN.telp || '').replace(/\D/g, '');
    if (!n) return '';
    return n.startsWith('0') ? '62' + n.slice(1) : n;
}

// Pecah caption jadi paragraf + baris hashtag penutup (ditampilkan terpisah, bukan teks polos).
function mbParseCaption(raw) {
    const lines = String(raw || '').replace(/\r/g, '').trim().split('\n');
    let tags = [];
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length && /^\s*(#[^\s#]+\s*)+$/.test(lines[lines.length - 1])) {
        tags = lines.pop().match(/#[^\s#]+/g) || [];
    }
    const paras = lines.join('\n').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
    return { paras, tags };
}

// Kartu sederhana untuk pengunjung umum: gambar + nama/tanggal + judul + caption + tombol WA.
// Info internal (pilar, tipe, tahap, seri) sengaja TIDAK ditampilkan.
function mbPostHtml(pl, todayKey) {
    const pil = IG_PILLARS[pl.pilar];
    const color = pil ? pil.color : '#1565a8';
    const tipe = pl.tipe_konten || 'image';
    const d = new Date(pl.tanggal + 'T00:00:00');
    const tgl = isNaN(d) ? escapeHtml(pl.tanggal) : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const rel = pl.tanggal === todayKey ? '<span class="mb-today">Hari ini</span>' : '';
    // Teks gambar: buang baris internal ("Label gambar: ...") dan penanda "Slide N:" supaya bersih untuk publik
    const imgRaw = String(pl.teks_gambar || pl.tema || '').split('\n')
        .filter(l => !/^\s*Label gambar:/i.test(l)).join('\n')
        .replace(/^\s*Slide\s*\d+\s*[:.\-–]\s*/gim, '').trim() || String(pl.tema || '').trim();
    const blocks = imgRaw.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
    const firstBlock = (tipe === 'carousel' && blocks.length ? blocks[0] : imgRaw);
    const { paras, tags } = mbParseCaption(pl.draft_caption);
    const totalLen = paras.join('').length;
    const longCap = totalLen > 380 || paras.length > 3;
    const nl = (t) => escapeHtml(t).replace(/\n/g, '<br>');
    const capHtml = paras.map(x => `<p>${nl(x)}</p>`).join('') +
        (tags.length ? `<div class="mb-tags">${tags.map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div>` : '');
    const wa = mbWaNumber();
    const waText = `Assalamualaikum Amiru Tour, saya melihat postingan "${pl.tema || ''}" dan ingin bertanya.`;
    const actions = wa ? `<div class="mb-actions">
                <span class="mb-actions-note">Ada pertanyaan seputar umroh?</span>
                <a class="mb-wa" href="https://wa.me/${wa}?text=${encodeURIComponent(waText)}" target="_blank" rel="noopener"><i class="bi bi-whatsapp"></i> Tanya via WhatsApp</a>
            </div>` : '';
    return `<article class="mb-post">
        <div class="mb-img" style="--mb-c:${color}">
            <div class="mb-img-text">${nl(firstBlock)}</div>
            <div class="mb-img-brand"><img src="assets/logo-amirutour.png" alt="">Amiru Tour</div>
        </div>
        <div class="mb-side">
            <div class="mb-post-head">
                <img class="mb-avatar" src="assets/logo-amirutour.png" alt="Amiru Tour">
                <div class="mb-who"><b>Amiru Tour</b><span>${tgl}${rel}</span></div>
            </div>
            <h3 class="mb-tema">${escapeHtml(pl.tema || '')}</h3>
            ${capHtml ? `<div class="mb-caption${longCap ? ' mb-clamped' : ''}">${capHtml}</div>${longCap ? '<button type="button" class="mb-more" onclick="mbToggleCaption(this)">Selengkapnya</button>' : ''}` : ''}
            ${actions}
        </div>
    </article>`;
}

function renderMicroblog() {
    const feed = document.getElementById('mbFeed');
    if (!feed) return;
    const list = mbState.items;
    if (!list.length) {
        feed.innerHTML = '<div class="mb-empty"><i class="bi bi-chat-square-text"></i><p>' +
            (canManageProgramData() ? 'Belum ada konten di Content Planner. Isi lewat menu IG Scheduler.' : 'Belum ada konten untuk ditampilkan.') + '</p></div>';
        return;
    }
    const today = mbTodayKey();
    const shown = list.slice(0, mbState.shown);
    feed.innerHTML = shown.map(pl => mbPostHtml(pl, today)).join('') +
        (list.length > shown.length ? `<button type="button" class="mb-loadmore" data-action="mbLoadMore">Muat lebih banyak (${list.length - shown.length})</button>` : '');
}
window.openMicroblogModal = openMicroblogModal;
window.closeMicroblogModal = closeMicroblogModal;
window.mbLoadMore = mbLoadMore;
window.mbToggleCaption = mbToggleCaption;

function closeRekapProgramModal() {
    closeRekapLightbox();
    document.getElementById('rekapProgramModal').classList.remove('open');
    const grid = document.getElementById('rekapGrid');
    if (grid) grid.innerHTML = '';   // lepas gambar supaya tidak ikut termuat saat modal tertutup
}

// type: 'loading' | 'empty' | 'error' | null (sembunyikan)
function setRekapNote(type, text) {
    const note = document.getElementById('rekapNote');
    if (!note) return;
    if (!type) { note.style.display = 'none'; note.innerHTML = ''; return; }
    const icon = { loading: 'bi-hourglass-split', empty: 'bi-image', error: 'bi-exclamation-triangle' }[type];
    note.innerHTML = `<i class="bi ${icon}"></i><span>${escapeHtml(text || '')}</span>`;
    note.style.display = 'flex';
}

// forceSync = true (tombol Refresh) -> minta Edge Function menarik ulang
// daftar gambar dari Drive dulu, baru baca tabel. Kalau false -> baca cache.
async function loadRekapProgram(forceSync = false) {
    const src = rekapSource;           // dikunci: modal bisa ditutup/ganti sumber saat request berjalan
    const cfg = REKAP_SOURCES[src];
    const store = rekapStore[src];
    if (store.loaded && !forceSync) {
        renderRekapGallery();
        return;
    }

    renderRekapGallery(true);
    setRekapNote('loading', cfg.loading);

    try {
        if (forceSync) {
            showToast(cfg.syncing, 'info');
            const syncRes = await fetch(cfg.syncUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${(await supabaseClient.auth.getSession()).data.session?.access_token || ''}`
                },
                body: JSON.stringify({})
            });
            const syncResult = await syncRes.json().catch(() => ({}));
            if (!syncResult.ok) {
                showToast('Sync gagal: ' + (syncResult.error || syncRes.statusText), 'error');
                // tetap lanjut baca cache lama supaya galeri tidak kosong total
            } else {
                showToast(`Sync selesai — ${syncResult.synced || 0} gambar`, 'success');
            }
        }

        const { data, error } = await supabaseClient
            .from(cfg.table)
            .select('id, name, full_url, thumb_url, drive_updated_at')
            .order('drive_updated_at', { ascending: false, nullsFirst: false })
            .limit(cfg.limit || 1000);
        if (error) throw error;

        store.items = (data || [])
            .map(row => ({
                id: row.id,
                name: row.name,
                fullUrl: row.full_url || row.thumb_url,
                thumbUrl: row.thumb_url || row.full_url,
                updatedAt: row.drive_updated_at
            }))
            .filter(it => it.fullUrl);
        store.loaded = true;
        setRekapMetric(src, store.items.length);
        if (rekapSource === src) renderRekapGallery();
    } catch (err) {
        if (rekapSource === src) setRekapNote('error', cfg.fail + (err.message || String(err)));
    }
}

// ---------- Angka jumlah gambar di kartu metrik "Rekap Program" & "Infografis" ----------
// Kedua tabel boleh dibaca tanpa login (RLS: sql/53 & sql/55), jadi angkanya langsung dihitung
// ringan lewat count (head:true, tanpa baris/body). Hemat egress Supabase: dijalankan SEKALI per
// sumber per muat halaman, tidak di-polling & tidak diulang saat gagal. Setelah galeri dibuka,
// angka diperbarui dari data galeri yang memang sudah dimuat (tanpa request tambahan).
function setRekapMetric(src, n) {
    const el = document.getElementById(REKAP_SOURCES[src].metricId);
    if (el) el.textContent = (n === null || n === undefined) ? '–' : n;
}
async function refreshRekapMetric() {
    for (const src of Object.keys(REKAP_SOURCES)) {
        const store = rekapStore[src];
        if (store.loaded) { setRekapMetric(src, store.items.length); continue; }
        if (store.metricFetched) continue;
        store.metricFetched = true;   // ditandai sebelum request: gagal pun tidak diulang-ulang
        try {
            const { count, error } = await supabaseClient
                .from(REKAP_SOURCES[src].table)
                .select('id', { count: 'exact', head: true });
            if (error) throw error;
            setRekapMetric(src, count || 0);
        } catch (err) {
            console.warn('Hitung ' + REKAP_SOURCES[src].title + ' gagal:', err.message || err);
        }
    }
}
window.refreshRekapMetric = refreshRekapMetric;

function rekapDateLabel(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return '';
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// onlyEmpty = true -> hanya kanvas kosong (saat loading, sebelum data ada)
function renderRekapGallery(onlyEmpty = false) {
    const grid = document.getElementById('rekapGrid');
    const countEl = document.getElementById('rekapCount');
    if (!grid) return;

    const cfg = REKAP_SOURCES[rekapSource];
    const items = onlyEmpty ? [] : rekapItems();
    countEl.textContent = items.length ? `${items.length} ${cfg.unit}` : '';
    if (!onlyEmpty) setRekapMetric(rekapSource, items.length);

    let html = items.map((it, i) => {
        const tgl = rekapDateLabel(it.updatedAt);
        return `
        <button class="rekap-tile" onclick="openRekapLightbox(${i})" title="${escapeHtmlAttr(it.name || cfg.alt)}">
            <img src="${escapeHtmlAttr(it.thumbUrl)}" alt="${escapeHtmlAttr(it.name || cfg.alt)}" referrerpolicy="no-referrer" loading="lazy" draggable="false">
            ${i === 0 ? '<span class="rekap-tile-badge">Terbaru</span>' : ''}
            ${tgl ? `<span class="rekap-tile-label">${escapeHtml(tgl)}</span>` : ''}
        </button>`;
    }).join('');

    // Lengkapi sampai minimal 4 kanvas kosong
    for (let i = items.length; i < REKAP_MIN_TILES; i++) {
        html += '<div class="rekap-tile is-empty"><i class="bi bi-image"></i></div>';
    }
    grid.innerHTML = html;

    if (!onlyEmpty) {
        if (!items.length) setRekapNote('empty', cfg.empty);
        else setRekapNote(null);
    }
}

// ---------- Pratinjau layar penuh ----------
function openRekapLightbox(i) {
    if (i < 0 || i >= rekapItems().length) return;
    rekapIndex = i;
    document.getElementById('rekapLightbox').classList.add('open');
    renderRekapLightbox();
}

// ---------- Cache gambar pratinjau (agar perpindahan poster mulus) ----------
// Menyimpan referensi Image yang sudah/sedang dimuat supaya (1) hasil decode tidak
// dibuang browser, (2) perpindahan ke poster yang sudah dimuat duluan instan.
// Gambar berasal dari Google Drive (bukan Supabase). Dibatasi kecil karena satu poster
// 1080x1920 yang sudah di-decode memakan ~8 MB memori.
const rekapImgCache = new Map();   // url -> HTMLImageElement (urutan = LRU)
const REKAP_IMG_CACHE_MAX = 6;
let rekapLbTimer = null;           // penunda indikator "Memuat…" (hindari kedip)

function rekapImgOk(im) { return !!im && im.complete && im.naturalWidth > 0; }

function rekapPreload(url) {
    if (!url) return null;
    let im = rekapImgCache.get(url);
    if (im && im.complete && im.naturalWidth === 0) { rekapImgCache.delete(url); im = null; }  // gagal sebelumnya -> coba lagi
    if (im) { rekapImgCache.delete(url); rekapImgCache.set(url, im); return im; }              // segarkan urutan LRU
    im = new Image();
    im.referrerPolicy = 'no-referrer';
    im.decoding = 'async';
    im.src = url;
    rekapImgCache.set(url, im);
    while (rekapImgCache.size > REKAP_IMG_CACHE_MAX) rekapImgCache.delete(rekapImgCache.keys().next().value);
    return im;
}

// Animasi masuk poster utama: dir > 0 dari kanan, dir < 0 dari kiri, 0 = hanya fade.
function rekapLbAnimate(el, dir) {
    el.classList.remove('slide-next', 'slide-prev');
    if (!dir) return;
    void el.offsetWidth;   // restart animasi
    el.classList.add(dir > 0 ? 'slide-next' : 'slide-prev');
}

// Poster samping: ganti gambar HANYA setelah thumbnail baru siap (tidak ada kedip kosong).
function setRekapSide(id, n) {
    const s = document.getElementById(id);
    if (!s) return;
    const url = n ? (n.thumbUrl || n.fullUrl) : '';
    if (!url) { s.dataset.want = ''; s.removeAttribute('src'); return; }   // ujung daftar -> disembunyikan CSS
    if (s.getAttribute('src') === url) return;
    s.dataset.want = url;
    const apply = () => {
        if (s.dataset.want !== url) return;   // sudah ada permintaan yang lebih baru
        s.src = url;
        s.classList.remove('swap'); void s.offsetWidth; s.classList.add('swap');
    };
    const pre = rekapPreload(url);
    if (rekapImgOk(pre)) apply();
    else if (pre) pre.addEventListener('load', apply, { once: true });
}

function closeRekapLightbox() {
    const lb = document.getElementById('rekapLightbox');
    if (!lb) return;
    lb.classList.remove('open');
    clearTimeout(rekapLbTimer);
    const img = document.getElementById('rekapLbImg');
    if (img) {
        img.onload = img.onerror = null;
        img.removeAttribute('src');
        img.classList.remove('loaded', 'pending', 'slide-next', 'slide-prev');
    }
    ['rekapLbSidePrev', 'rekapLbSideNext'].forEach(id => {
        const s = document.getElementById(id);
        if (s) { s.dataset.want = ''; s.removeAttribute('src'); }
    });
    rekapImgCache.clear();   // lepas memori gambar yang sudah di-decode
}

function setRekapLbNote(type, text) {
    const note = document.getElementById('rekapLbNote');
    if (!note) return;
    if (!type) { note.classList.add('hide'); note.innerHTML = ''; return; }
    const icon = { loading: 'bi-hourglass-split', error: 'bi-exclamation-triangle' }[type];
    note.innerHTML = `<i class="bi ${icon}"></i><span>${escapeHtml(text || '')}</span>`;
    note.classList.remove('hide');
}

// dir: arah perpindahan (-1 / +1) untuk animasi; 0 = pembukaan pertama.
function renderRekapLightbox(dir = 0) {
    const items = rekapItems();
    const idx = rekapIndex;
    const item = items[idx];
    const img = document.getElementById('rekapLbImg');
    if (!item || !img) return;

    document.getElementById('rekapLbCount').textContent = `${idx + 1} / ${items.length}`;
    document.getElementById('rekapLbDate').textContent = rekapDateLabel(item.updatedAt);
    document.getElementById('rekapLbOpenFull').href = item.fullUrl;
    document.getElementById('btnRekapLbPrev').classList.toggle('empty', idx === 0);
    document.getElementById('btnRekapLbNext').classList.toggle('empty', idx >= items.length - 1);

    // Poster samping (kecil & blur)
    setRekapSide('rekapLbSidePrev', items[idx - 1]);
    setRekapSide('rekapLbSideNext', items[idx + 1]);

    // Poster utama. Gambar lama TIDAK dikosongkan: tetap tampil sampai yang baru siap,
    // jadi tidak ada layar kosong/kedip. Urutan: versi full kalau sudah ada di cache ->
    // kalau belum, thumbnail dulu (sudah termuat di galeri) lalu ditingkatkan ke full.
    clearTimeout(rekapLbTimer);
    img.classList.remove('pending');
    const full = item.fullUrl;
    const thumb = item.thumbUrl && item.thumbUrl !== full ? item.thumbUrl : '';
    const fullImg = rekapPreload(full);
    const thumbImg = thumb ? rekapPreload(thumb) : null;
    let animated = false;

    const onShown = () => {
        if (rekapIndex !== idx) return;
        clearTimeout(rekapLbTimer);
        setRekapLbNote(null);
        img.classList.remove('pending');
        img.classList.add('loaded');
        if (!animated) { animated = true; rekapLbAnimate(img, dir); }
    };
    const onFail = () => {
        if (rekapIndex !== idx) return;
        clearTimeout(rekapLbTimer);
        img.classList.remove('loaded', 'pending');
        setRekapLbNote('error', 'Gambar gagal dimuat. Cek apakah folder Drive sudah di-share "Anyone with the link".');
    };
    const showUrl = (url) => {
        img.onload = onShown;
        img.onerror = onFail;
        if (img.getAttribute('src') === url) { if (rekapImgOk(img)) onShown(); return; }
        img.src = url;
    };

    const fullReady = rekapImgOk(fullImg);
    const thumbReady = rekapImgOk(thumbImg);

    // Muat tetangga (kiri/kanan) di belakang layar setelah poster ini siap
    const preloadNeighbors = () => {
        if (rekapIndex !== idx) return;
        [items[idx - 1], items[idx + 1]].forEach(n => { if (n) rekapPreload(n.fullUrl); });
    };

    if (fullReady) {
        showUrl(full);
        preloadNeighbors();
    } else {
        if (thumbReady) {
            showUrl(thumb);
        } else {
            // Belum ada yang siap: redupkan gambar lama (atau tampilkan "Memuat…" kalau
            // belum ada gambar sama sekali) -- baru setelah jeda singkat, supaya tidak kedip.
            rekapLbTimer = setTimeout(() => {
                if (rekapIndex !== idx) return;
                if (img.getAttribute('src')) img.classList.add('pending');
                else setRekapLbNote('loading', 'Memuat…');
            }, 180);
        }
        if (!thumbReady && thumbImg) {
            // Thumbnail ikut dimuat: begitu siap langsung tampil (kecuali versi full sudah tampil lebih dulu)
            thumbImg.addEventListener('load', () => {
                if (rekapIndex !== idx || img.getAttribute('src') === full) return;
                showUrl(thumb);
            }, { once: true });
        }
        fullImg.addEventListener('load', () => {
            if (rekapIndex !== idx) return;
            showUrl(full);          // naikkan ke resolusi penuh (tanpa animasi ulang)
            preloadNeighbors();
        }, { once: true });
        fullImg.addEventListener('error', () => {
            if (rekapIndex !== idx) return;
            if (!thumbReady) onFail(); // thumbnail sudah tampil -> biarkan, tidak perlu error
        }, { once: true });
    }
}

// delta: -1 = sebelumnya, +1 = berikutnya. Berhenti di ujung (tidak berputar).
function rekapGo(delta) {
    const next = Math.min(Math.max(rekapIndex + delta, 0), rekapItems().length - 1);
    if (next === rekapIndex) return;
    rekapIndex = next;
    renderRekapLightbox(delta);
}

// Geser kiri/kanan di pratinjau = pindah poster
(function initRekapLightboxSwipe() {
    const stage = document.getElementById('rekapLbStage');
    if (!stage) return;
    let sx = 0, sy = 0, tracking = false;
    stage.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; tracking = true; });
    stage.addEventListener('pointercancel', () => { tracking = false; });
    stage.addEventListener('pointerup', (e) => {
        if (!tracking) return;
        tracking = false;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) >= REKAP_SWIPE_PX && Math.abs(dx) > Math.abs(dy)) rekapGo(dx < 0 ? 1 : -1);
    });
})();

// Esc menutup lapis paling atas dulu (pratinjau, baru galeri)
document.addEventListener('keydown', (e) => {
    const lb = document.getElementById('rekapLightbox');
    const gal = document.getElementById('rekapProgramModal');
    if (lb && lb.classList.contains('open')) {
        if (e.key === 'Escape') closeRekapLightbox();
        else if (e.key === 'ArrowLeft') rekapGo(-1);
        else if (e.key === 'ArrowRight') rekapGo(1);
    } else if (gal && gal.classList.contains('open') && e.key === 'Escape') {
        closeRekapProgramModal();
    }
});

window.openRekapProgramModal = openRekapProgramModal;
window.openInfografisModal = openInfografisModal;
window.closeRekapProgramModal = closeRekapProgramModal;
window.loadRekapProgram = loadRekapProgram;
window.openRekapLightbox = openRekapLightbox;
window.closeRekapLightbox = closeRekapLightbox;
window.rekapGo = rekapGo;

// ============================================================
// 6. MOBILE SIDEBAR
// ============================================================
function toggleMobileSidebar() {
    document.getElementById('mobileSidebarOverlay').classList.toggle('open');
}

// ============================================================
// 7. RENDER SKELETON
// ============================================================
function renderSkeleton(rows = 6) {
    const tbody = document.getElementById('skeletonBody');
    if (!tbody) return;
    tbody.innerHTML = Array.from({length: rows}, () => `
        <tr class="skeleton-row">
            <td><div class="skeleton skeleton-text" style="width:70%;"></div></td>
            <td><div class="skeleton skeleton-text" style="width:50%;"></div></td>
            <td><div class="skeleton skeleton-text" style="width:40%;"></div></td>
            <td><div class="skeleton skeleton-text" style="width:30%;"></div></td>
            <td><div class="skeleton skeleton-text" style="width:50%;"></div></td>
            <td><div class="skeleton skeleton-text" style="width:60%;"></div></td>
            <td><div class="skeleton skeleton-text" style="width:40%;"></div></td>
        </tr>
    `).join('');
}

// ============================================================
// 8. LOAD DATA FROM SUPABASE
// ============================================================
async function loadDataFromSupabase(forceRefresh = false) {
    const loadingEl = document.getElementById('loadingState');
    const tableEl = document.getElementById('packageTable');
    loadingEl.style.display = 'block';
    tableEl.style.display = 'none';
    renderSkeleton();

    if (!forceRefresh) {
        const cached = sessionStorage.getItem(CACHE_KEY);
        const cacheTime = sessionStorage.getItem(CACHE_TIME_KEY);
        if (cached && cacheTime && (Date.now() - parseInt(cacheTime) < CACHE_DURATION)) {
            dataUmroh = JSON.parse(cached);
            dataUmroh.forEach(p => {
                if (p.tgl && !p.dateObj) p.dateObj = parseDateFromString(p.tgl);
                p.isAvailable = p.dateObj >= new Date();
            });
            currentData = sortProgramsDefault(dataUmroh.filter(isProgramVisibleOnDashboard));
            renderTableWithSearch();
            updateMetrics();
            renderFeaturedSection();
            loadingEl.style.display = 'none';
            tableEl.style.display = 'table';
            return;
        }
    }

    try {
        const { data, error } = await withRetry(
            // [OPTIMASI DATA] Hanya kolom yang benar-benar dipetakan ke plainData di bawah
            // (tanpa status_kepulangan/tgl_*_aktual yang tidak dipakai tabel utama).
            // link_form sengaja tidak di-select: tidak ada di skema SQL & tidak dipakai.
            () => supabaseClient.from('programs').select('id, nama, tgl, durasi, maskapai, harga_quint, teks_wa, link_itinerary, link_poster, poster_version, link_metaads, link_dokumentasi, created_at, is_active, kuota_pax, admin_data_lengkap').order('created_at', { ascending: true }),
            { label: 'Muat data program' }
        );
        if (error) throw error;

        const plainData = (data || []).map(p => unpackProgramAdminData({
            id: p.id, nama: p.nama, tgl: p.tgl, durasi: p.durasi, maskapai: p.maskapai,
            harga_quint: p.harga_quint, teks_wa: p.teks_wa,
            link_form: p.link_form, link_itinerary: p.link_itinerary,
            link_poster: p.link_poster, poster_version: p.poster_version, link_metaads: p.link_metaads,
            link_dokumentasi: p.link_dokumentasi, created_at: p.created_at,
            is_active: p.is_active !== false,
            kuota_pax: p.kuota_pax || 45,
            admin_data_lengkap: p.admin_data_lengkap
        }));
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(plainData));
        sessionStorage.setItem(CACHE_TIME_KEY, Date.now().toString());

        dataUmroh = plainData;
        dataUmroh.forEach(p => {
            if (p.tgl && !p.dateObj) p.dateObj = parseDateFromString(p.tgl);
            p.isAvailable = p.dateObj >= new Date();
        });
        currentData = sortProgramsDefault(dataUmroh.filter(isProgramVisibleOnDashboard));
        renderTableWithSearch();
        updateMetrics();
        renderFeaturedSection();
        loadingEl.style.display = 'none';
        tableEl.style.display = 'table';

    } catch (err) {
        const msg = err?.message || String(err);
        loadingEl.innerHTML = `<div style="padding:40px;text-align:center;color:var(--danger);">
            <i class="bi bi-wifi" style="font-size:24px;display:block;margin-bottom:10px;"></i>
            Gagal memuat data. Periksa koneksi internet Anda.<br>
            <span style="font-size:12px;color:var(--ink-soft);">${escapeHtml(msg)}</span><br>
            <button onclick="loadDataFromSupabase(true)" style="margin-top:12px;padding:6px 16px;border-radius:6px;border:none;background:var(--accent,#2563eb);color:#fff;cursor:pointer;">
                <i class="bi bi-arrow-clockwise"></i> Coba Lagi
            </button>
        </div>`;
        showToast('Gagal memuat data — periksa koneksi internet', 'error');
    }
}

// Tombol kecil di kolom Aksi tabel Program Umroh untuk buka salah satu link
// aset program (Poster/Itinerary) di tab baru.
// Kalau link belum diisi, tombol tetap tampil tapi non-aktif (abu-abu) supaya
// urutan/posisi tombolnya konsisten di setiap baris.
function renderProgramLinkBtn(url, label, iconClass) {
    const safeUrl = (url || '').trim();
    if (!safeUrl) {
        return `<button type="button" disabled title="${escapeHtml(label)} (belum diisi)" style="opacity:.35;cursor:not-allowed;"><i class="bi ${iconClass}"></i></button>`;
    }
    return `<button type="button" onclick="window.open('${escapeJsAttr(safeUrl)}', '_blank', 'noopener')" title="${escapeHtml(label)}"><i class="bi ${iconClass}"></i></button>`;
}

// ============================================================
// 9. RENDER TABLE
// ============================================================
// Ambil ID 3 program dengan tanggal keberangkatan paling dekat (yang belum
// lewat / masih tersedia). Dihitung dari seluruh dataUmroh yang aktif, jadi
// hasilnya tetap konsisten meski tabel sedang di-search/di-sort ulang oleh user.
// Mengembalikan Map id -> peringkat (0 = paling dekat, 1, 2, ...). Tetap bisa dipakai
// lewat .has(), sedangkan .get() dipakai untuk gradasi warna baris (makin dekat makin gelap).
function getNearestDepartureIds(count = 3) {
    const now = new Date();
    const ranks = new Map();
    dataUmroh
        .filter(p => p.is_active !== false && p.dateObj && p.dateObj >= now)
        .sort((a, b) => a.dateObj - b.dateObj)
        .slice(0, count)
        .forEach((p, i) => ranks.set(String(p.id), i));
    return ranks;
}

// Hitung estimasi waktu menuju tanggal keberangkatan dalam Bahasa Indonesia.
// Hasil contoh: "hari ini", "1hr lagi", "1bln 3hr lagi", "2th 1bln lagi" (singkatan biar hemat ruang kolom).
// Menggunakan perhitungan kalender (bulan = panjang bulan asli) biar akurat.
function hitungEstimasi(dateObj, now) {
    if (!dateObj) return '-';
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    const diffMs = target - today;
    if (diffMs < 0) return 'sudah berangkat';
    if (diffMs === 0) return 'hari ini';
    let years = target.getFullYear() - today.getFullYear();
    let months = target.getMonth() - today.getMonth();
    let days = target.getDate() - today.getDate();
    if (days < 0) {
        months -= 1;
        const prevMonth = new Date(target.getFullYear(), target.getMonth(), 0);
        days += prevMonth.getDate();
    }
    if (months < 0) { years -= 1; months += 12; }
    const parts = [];
    if (years) parts.push(`${years}th`);
    if (months) parts.push(`${months}bln`);
    if (days) parts.push(`${days}hr`);
    if (!parts.length) parts.push('hari ini');
    return parts.join(' ') + ' lagi';
}

// Bangun HTML satu baris <tr> program umroh. Dipakai bareng oleh renderTable
// (tab "Program Umroh") dan renderFeaturedSection (tab "Unggulan") supaya
// tampilan kedua tabel identik persis.
// Bungkus kata pencarian dengan <mark> (aman XSS: teks di-escape per potongan)
function markSearchHit(raw, tokens) {
    const text = String(raw == null ? '' : raw);
    if (!tokens || !tokens.length) return escapeHtml(text);
    const re = new RegExp('(' + tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
    return text.split(re).map((part, i) => i % 2 ? '<mark class="srch-hit">' + escapeHtml(part) + '</mark>' : escapeHtml(part)).join('');
}
// Hotel tidak tampil di tabel: kalau pencarian cocok lewat hotel, tunjukkan baris kecil di bawah nama program
function searchHotelHintHTML(item, tokens) {
    if (!tokens || !tokens.length) return '';
    const hotels = [['Makkah', item.hotel_makkah], ['Madinah', item.hotel_madinah], [item.hotel_3_kota || 'Hotel 3', item.hotel_3], [item.hotel_4_kota || 'Hotel 4', item.hotel_4]];
    const hits = hotels.filter(h => h[1] && tokens.some(t => srchNorm(h[1]).includes(t)));
    if (!hits.length) return '';
    return `<div class="srch-via"><i class="bi bi-building"></i> ${hits.map(h => escapeHtml(h[0]) + ': ' + markSearchHit(hotelNamaSingkat(h[1]), tokens)).join(' · ')}</div>`;
}

function buildProgramRowHTML(item, now, nearestIds, hl) {
    const isExpired = item.dateObj < now;
    const kuota = item.kuota_pax || 45;
    // Jamaah "batal" tidak dihitung mengisi kuota. kbJamaahList sendiri sudah
    // terfilter diarsipkan=false (lihat loadKbJamaah), jadi jamaah program yang
    // sudah diarsipkan otomatis tidak ikut menghitung kuota di sini.
    const terisi = (kbJamaahList || []).filter(j => String(j.program_id) === String(item.id) && j.status !== 'batal').length;
    const isPenuh = terisi >= kuota;
    let statusClass, statusLabel;
    if (isExpired) { statusClass = 'full'; statusLabel = 'Expired'; }
    else if (isPenuh) { statusClass = 'full'; statusLabel = `${terisi}/${kuota} Penuh`; }
    else { statusClass = 'available'; statusLabel = `${terisi}/${kuota} Tersedia`; }
    const isNearest = nearestIds.has(String(item.id));
    const nearestRank = isNearest ? Math.min(nearestIds.get(String(item.id)) + 1, 3) : 0; // 1 = paling dekat

    const hasPosterHover = !!item.link_poster;
    const posterHoverAttrs = hasPosterHover
        ? ` data-poster="${escapeHtml(item.link_poster)}" data-poster-v="${escapeHtml(item.poster_version || '')}" data-nama="${escapeHtml(item.nama||'')}" onmouseenter="showPosterPopup(event,this)" onmouseleave="hidePosterPopup()" style="cursor:pointer;"`
        : '';

    // [VERIFIED BADGE] Badge hijau "Verified" tampil di tampilan depan hanya kalau
    // poster program itu sudah discan OCR dan semua data teks plain cocok 100%
    // dengan hasil OCR poster (lihat cxIsProgramVerified / cxCountMismatchForProgram).
    const isVerified = cxIsProgramVerified(item);
    const verifiedBadge = isVerified
        ? ` <span class="verified-badge" title="Data program ini sudah dicek otomatis (OCR) dan cocok 100% dengan poster resmi"><i class="bi bi-patch-check-fill"></i></span>`
        : '';

    // [BADGE PROGRAM BARU] Tampil otomatis di tampilan depan selama 3 hari
    // sejak program ditambahkan (created_at), lalu hilang sendiri tanpa perlu
    // aksi manual apa pun -- murni dihitung dari selisih waktu tiap kali tabel
    // di-render, bukan disimpan sebagai kolom/flag terpisah di database.
    const createdAt = item.created_at ? new Date(item.created_at) : null;
    const umurProgramMs = createdAt && !isNaN(createdAt) ? (now - createdAt) : null;
    const isProgramBaru = umurProgramMs != null && umurProgramMs >= 0 && umurProgramMs < (3 * 24 * 60 * 60 * 1000);
    const newBadge = isProgramBaru
        ? ` <span class="new-badge" title="Ditambahkan dalam 3 hari terakhir"><i class="bi bi-stars"></i> Program Baru</span>`
        : '';

    return `<tr class="${isNearest ? 'row-nearest-departure nearest-rank-' + nearestRank : ''}">
            <td title="${hasPosterHover?'Hover untuk preview poster — ':''}${escapeHtml(item.nama||'')}"><strong${posterHoverAttrs}>${markSearchHit(item.nama||'', hl)}</strong>${verifiedBadge}${newBadge}${searchHotelHintHTML(item, hl)}</td>
            <td>${escapeHtml(hitungEstimasi(item.dateObj, now))}</td>
            <td>${escapeHtml(formatRupiah(item.harga_quad || item.harga_quint))}</td>
            <td>${escapeHtml(formatRupiah(item.harga_triple))}</td>
            <td>${escapeHtml(formatRupiah(item.harga_double))}</td>
            <td>${markSearchHit(item.tgl||'-', hl)}${isNearest ? ` <span class="nearest-badge nearest-badge-${nearestRank}" title="${nearestRank === 1 ? 'Keberangkatan paling dekat' : 'Salah satu dari 3 keberangkatan terdekat'}"><i class="bi bi-lightning-charge-fill"></i> Terdekat</span>` : ''}</td>
            <td>${markSearchHit(item.durasi||'-', hl)}</td>
            <td>${markSearchHit(item.maskapai||'-', hl)}</td>
            <td>
                <div class="action-btns">
                    <button onclick="openDetailModal('${item.id}')" title="Detail"><i class="bi bi-eye-fill"></i></button>
                    ${renderProgramLinkBtn(item.link_poster, 'Link Poster', 'bi-image-fill')}
                    ${renderProgramLinkBtn(item.link_itinerary, 'Link Itinerary', 'bi-signpost-2-fill')}
                </div>
            </td>
            <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
        </tr>`;
}

function renderTable(data) {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    const now = new Date();
    const canEdit = canManageProgramData(); // admin & user boleh edit/hapus, guest & publik hanya lihat
    if (!data || !data.length) {
        if (currentSearchTerm) {   // kosong karena pencarian, bukan karena belum ada program
            tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--ink-soft);">
                <i class="bi bi-search" style="font-size:24px;display:block;margin-bottom:10px;"></i>
                Tidak ada program yang cocok dengan <strong>"${escapeHtml(currentSearchTerm)}"</strong>.<br>
                <span style="font-size:12.5px;">Coba kata lain: nama program, maskapai, hotel, tanggal, atau harga.</span><br>
                <button type="button" class="btn-homepage" style="margin-top:14px;cursor:pointer;" onclick="clearProgramSearch()"><i class="bi bi-x-circle"></i> Hapus pencarian</button>
            </td></tr>`;
            return;
        }
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--ink-soft);">
            <i class="bi bi-inbox-fill" style="font-size:24px;display:block;margin-bottom:10px;"></i>
            Belum ada program umroh.${canEdit ? ' Klik "Tambah" untuk menambahkan.' : ''}
        </td></tr>`;
        return;
    }

    const nearestIds = getNearestDepartureIds(3);
    const fuzzyNote = currentSearchFuzzy
        ? `<tr class="srch-note-row"><td colspan="10"><i class="bi bi-info-circle"></i> Tidak ada hasil yang persis untuk <strong>"${escapeHtml(currentSearchTerm)}"</strong> — menampilkan hasil yang mirip.</td></tr>`
        : '';
    tbody.innerHTML = fuzzyNote + data.map(item => buildProgramRowHTML(item, now, nearestIds, currentSearchTokens)).join('');
}

function updateMetrics() {
    document.getElementById('totalPrograms').textContent = dataUmroh.filter(isProgramVisibleOnDashboard).length;
    refreshRekapMetric();
    refreshMicroblogMetric();
}

// ============================================================
// 10. SEARCH & SORT
// ============================================================
function applySortToData() {
    const column = currentSort.column;
    if (!column) return;
    currentData.sort((a,b) => {
        if (column === 'tgl') return currentSort.asc ? a.dateObj - b.dateObj : b.dateObj - a.dateObj;
        if (column === 'isAvailable') return currentSort.asc ? (a.isAvailable?1:0)-(b.isAvailable?1:0) : (b.isAvailable?1:0)-(a.isAvailable?1:0);
        const vA = String(a[column]||'').toLowerCase(), vB = String(b[column]||'').toLowerCase();
        return currentSort.asc ? vA.localeCompare(vB) : vB.localeCompare(vA);
    });
}

function sortTable(column) {
    currentSort.asc = currentSort.column === column ? !currentSort.asc : true;
    currentSort.column = column;
    applySortToData();
    document.querySelectorAll('th.sortable .sort-icon').forEach(el => el.textContent = '⇅');
    const activeTh = document.querySelector(`th.sortable[data-sort="${column}"] .sort-icon`);
    if (activeTh) activeTh.textContent = currentSort.asc ? '▲' : '▼';
    renderTable(currentData);
}

// ---- Pencarian program (dashboard utama) ----
// Fitur: banyak kata (semua harus cocok), abaikan huruf besar/kecil & aksen, cari di nama, maskapai,
// tanggal, durasi, HOTEL (Makkah/Madinah/kota lain) dan HARGA (ketik "28950000", "28.950.000",
// "Rp 28.950.000" atau "29jt"). Kalau tidak ada hasil persis, dicoba lagi dengan toleransi typo
// (mis. "taif" -> Thaif). Hasil selalu urut tanggal berangkat, kata yang dicari di-highlight di tabel,
// dan pencarian tetap aktif saat data dimuat ulang.
let currentSearchTerm = '', currentSearchTokens = [], currentSearchFuzzy = false;

function srchNorm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function srchTokens(term) {
    let q = String(term || '').toLowerCase();
    q = q.replace(/\brp\.?\s*/g, ' ');                       // "Rp 28.950.000" -> "28.950.000"
    q = q.replace(/(\d)[.,](?=\d{3}(?!\d))/g, '$1');         // 28.950.000 -> 28950000
    q = q.replace(/(\d+)\s*(?:jt|juta)\b/g, '$1jt');         // "29 juta" -> "29jt"
    return [...new Set(srchNorm(q).split(' ').filter(Boolean))];
}
function srchIndex(item) {
    const hotels = [item.hotel_makkah, item.hotel_madinah, item.hotel_3, item.hotel_3_kota, item.hotel_4, item.hotel_4_kota];
    const text = srchNorm([item.nama, item.maskapai, item.tgl, item.durasi].concat(hotels).join(' '));
    return {
        text,
        words: text.split(' '),
        prices: [item.harga_quint, item.harga_quad, item.harga_triple, item.harga_double].map(v => String(v || '').replace(/\D/g, '')).filter(Boolean)
    };
}
// Jarak edit (transposisi dihitung 1) -- cukup untuk kata pendek
function srchDist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, k) => k);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let k = 1; k <= b.length; k++) {
            const cost = a[i - 1] === b[k - 1] ? 0 : 1;
            let v = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
            if (prev2 && i > 1 && k > 1 && a[i - 1] === b[k - 2] && a[i - 2] === b[k - 1]) v = Math.min(v, prev2[k - 2] + 1);
            cur.push(v);
        }
        prev2 = prev; prev = cur;
    }
    return prev[b.length];
}
function srchTokenMatch(tok, ix, fuzzy) {
    if (/^\d+$/.test(tok)) {
        // angka pendek (1-3 digit) = tanggal/durasi: cocokkan di AWAL kata saja, supaya "26" tidak ikut menangkap tahun "2026"
        if (tok.length <= 3) return ix.words.some(w => w.startsWith(tok));
        // angka panjang = tahun atau harga
        return ix.text.includes(tok) || ix.prices.some(pr => pr.includes(tok));
    }
    const jt = tok.match(/^(\d{1,3})jt$/);                    // "29jt" -> harga 29.xxx.xxx
    if (jt) { const re = new RegExp('^' + jt[1] + '\\d{6}$'); return ix.prices.some(pr => re.test(pr)); }
    if (ix.text.includes(tok)) return true;
    if (fuzzy && tok.length >= 4) {
        const max = tok.length >= 8 ? 2 : 1;
        return ix.words.some(w => w.length >= 3 && srchDist(tok, w, max) <= max);
    }
    return false;
}

function filterData(term) {
    const raw = String(term == null ? '' : term);
    const tokens = srchTokens(raw);
    const visiblePrograms = dataUmroh.filter(isProgramVisibleOnDashboard);
    currentSearchTerm = raw.trim();
    currentSearchFuzzy = false;
    if (!tokens.length) {
        currentSearchTokens = [];
        currentData = sortProgramsDefault(visiblePrograms);
    } else {
        const indexed = visiblePrograms.map(item => ({ item, ix: srchIndex(item) }));
        let hits = indexed.filter(h => tokens.every(t => srchTokenMatch(t, h.ix, false)));
        if (!hits.length) {
            hits = indexed.filter(h => tokens.every(t => srchTokenMatch(t, h.ix, true)));
            currentSearchFuzzy = hits.length > 0;
        }
        currentSearchTokens = tokens.filter(t => !/^\d{1,3}jt$/.test(t) && !(/^\d+$/.test(t) && t.length >= 4 && !hits.some(h => h.ix.text.includes(t))));
        currentData = sortProgramsDefault(hits.map(h => h.item));
    }
    if (currentSort.column) applySortToData();
    updateSearchUI(visiblePrograms.length);
    renderTable(currentData);
}

// Dipanggil setelah data dimuat/di-refresh: pencarian yang sedang diketik tidak hilang
function renderTableWithSearch() {
    const el = document.getElementById('searchInput');
    if (el && el.value.trim()) filterData(el.value); else { currentSearchTerm = ''; currentSearchTokens = []; currentSearchFuzzy = false; updateSearchUI(0); renderTable(currentData); }
}

function updateSearchUI(totalVisible) {
    const el = document.getElementById('searchInput');
    const clr = document.getElementById('searchClear'), cnt = document.getElementById('searchCount');
    const aktif = !!(el && el.value.trim());
    if (clr) clr.style.display = (el && el.value) ? 'inline-flex' : 'none';
    if (cnt) {
        if (aktif) {
            cnt.textContent = currentData.length + (totalVisible ? '/' + totalVisible : '');
            cnt.title = currentData.length + ' program cocok' + (totalVisible ? ' dari ' + totalVisible : '');
            cnt.style.display = 'inline-block';
        } else cnt.style.display = 'none';
    }
}

function clearProgramSearch() {
    const el = document.getElementById('searchInput');
    clearTimeout(debounceTimer);
    if (el) { el.value = ''; el.focus(); }
    filterData('');
}

function handleSearchInput(e) {
    clearTimeout(debounceTimer);
    const clr = document.getElementById('searchClear');   // tombol hapus langsung muncul/hilang saat mengetik
    if (clr) clr.style.display = e.target.value ? 'inline-flex' : 'none';
    debounceTimer = setTimeout(() => filterData(e.target.value), 150);
}

function handleSearchKeydown(e) {
    if (e.key === 'Enter') { clearTimeout(debounceTimer); filterData(e.target.value); }
    else if (e.key === 'Escape' && e.target.value) { e.preventDefault(); clearProgramSearch(); }
}

// Pintasan: "/" atau Ctrl/Cmd+K langsung fokus ke kolom cari (kalau sedang tidak mengetik di input lain)
document.addEventListener('keydown', e => {
    const isSlash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey;
    const isCtrlK = (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K');
    if (!isSlash && !isCtrlK) return;
    const t = e.target, tag = t && t.tagName;
    if (isSlash && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable))) return;
    const el = document.getElementById('searchInput');
    if (!el || !el.getClientRects().length) return;          // kolom cari sedang tidak tampil
    e.preventDefault();
    el.focus(); el.select();
});

// ============================================================
// 11. DETAIL MODAL
// ============================================================
// Urutan program untuk navigasi panah kiri/kanan di modal Detail Program. Diambil dari
// tombol "Detail" yang SEDANG TAMPIL di tabel (tab Program Umroh atau Unggulan), jadi
// urutannya selalu sama dengan yang dilihat user (sudah terfilter/terurut). Disimpan
// sekali saat modal dibuka, lalu dipakai selama pindah program di dalam modal.
let pdNavIds = [];
function pdCollectVisibleProgramIds() {
    const ids = [];
    document.querySelectorAll('button[onclick^="openDetailModal("]').forEach(btn => {
        if (btn.closest('#programDetailModal')) return;
        if (!btn.getClientRects().length) return; // baris/tab yang tersembunyi dilewati
        const m = /openDetailModal\('([^']*)'\)/.exec(btn.getAttribute('onclick') || '');
        if (m && !ids.includes(m[1])) ids.push(m[1]);
    });
    return ids;
}
function navigateProgramDetail(step) {
    const modal = document.getElementById('programDetailModal');
    if (!modal || !modal.classList.contains('open')) return;
    const cur = String(modal.dataset.programId || '');
    const idx = pdNavIds.indexOf(cur);
    if (idx === -1) return;
    const next = pdNavIds[idx + step];
    if (next === undefined) return; // sudah di ujung daftar
    openDetailModal(next);
}

function openDetailModal(programId) {
    const program = dataUmroh.find(p => String(p.id) === String(programId));
    if (!program) { showToast('Program tidak ditemukan', 'error'); return; }
    const detailModalEl = document.getElementById('programDetailModal');
    if (!detailModalEl.classList.contains('open')) {
        pdNavIds = pdCollectVisibleProgramIds();
        if (!pdNavIds.includes(String(program.id))) pdNavIds = [String(program.id)];
    }
    detailModalEl.dataset.programId = String(program.id);
    const waText = program.teks_wa || generateAutoWAText(program);
    const hargaChips = [];
    if (program.harga_quad || program.harga_quint) hargaChips.push({ label: 'Quad', nilai: formatRupiah(program.harga_quad || program.harga_quint) });
    if (program.harga_triple) hargaChips.push({ label: 'Triple', nilai: formatRupiah(program.harga_triple) });
    if (program.harga_double) hargaChips.push({ label: 'Double', nilai: formatRupiah(program.harga_double) });
    if (!hargaChips.length) hargaChips.push({ label: 'Harga', nilai: formatRupiah(program.harga_quint) });

    document.getElementById('pdModalTitle').textContent = program.nama || 'Detail Program';
    document.getElementById('pd_tgl').textContent = program.tgl || '-';
    // Tanggal program ditambahkan ke sistem (created_at), tampil mepet kanan di header modal
    const addedWrap = document.getElementById('pd_added_date');
    if (addedWrap) {
        const addedTxt = program.created_at ? formatDateToIndonesian(new Date(program.created_at)) : '';
        document.getElementById('pd_added_text').textContent = addedTxt;
        addedWrap.style.display = addedTxt ? '' : 'none';
    }
    document.getElementById('pd_durasi').textContent = program.durasi || '-';
    document.getElementById('pd_maskapai').textContent = program.maskapai || '-';
    // Tanda "Sesuai poster": tampil kalau program sudah di-crosscheck (OCR poster) dan semua datanya
    // cocok dengan poster -- logika yang sama dengan badge Verified di tabel (cxIsProgramVerified).
    const verifiedEl = document.getElementById('pd_verified');
    if (verifiedEl) verifiedEl.style.display = cxIsProgramVerified(program) ? '' : 'none';
    document.getElementById('pd_harga_row').innerHTML = hargaChips.map(h => `<div class="pd-price"><span class="pd-price-label">${escapeHtml(h.label)}</span><span class="pd-price-value">${escapeHtml(h.nilai)}</span></div>`).join('');

    // Preview poster di kolom kiri (pakai resolveImageUrl supaya link Google Drive
    // /file/d/ID/view ikut tampil sebagai gambar, sama seperti popup hover di tabel).
    renderProgramDetailPoster(program);

    const ta = document.getElementById('pd_teks_wa');
    ta.value = waText || '';
    document.getElementById('programDetailModal').classList.add('open');
    // Teks WA di-scroll di dalam panelnya sendiri (tinggi mengikuti modal), jadi cukup reset posisi scroll
    requestAnimationFrame(() => {
        ta.scrollTop = 0;
        document.querySelector('#programDetailModal .modal-content').scrollTop = 0;
    });
}
// Isi kolom poster di modal Detail Program. Tiga kondisi: ada poster (tampil
// gambar), belum ada link poster (placeholder), atau gambar gagal dimuat.
function renderProgramDetailPoster(program) {
    const img = document.getElementById('pd_poster_img');
    const loading = document.getElementById('pd_poster_loading');
    const empty = document.getElementById('pd_poster_empty');
    const err = document.getElementById('pd_poster_error');
    const link = document.getElementById('pd_poster_link');
    const openBtn = document.getElementById('pd_poster_open');
    if (!img || !loading || !empty || !err || !link || !openBtn) return;

    img.classList.remove('loaded');
    img.onload = img.onerror = null;
    img.removeAttribute('src');
    loading.style.display = 'none';
    empty.style.display = 'none';
    err.style.display = 'none';

    const rawUrl = (program.link_poster || '').trim();
    if (!rawUrl) {
        empty.style.display = 'flex';
        link.removeAttribute('href');
        link.classList.add('pd-poster-disabled');
        openBtn.style.display = 'none';
        return;
    }
    link.href = rawUrl;
    link.classList.remove('pd-poster-disabled');
    openBtn.href = rawUrl;
    openBtn.style.display = '';
    loading.style.display = 'flex';
    img.onload = () => { loading.style.display = 'none'; img.classList.add('loaded'); };
    img.onerror = () => { loading.style.display = 'none'; err.style.display = 'flex'; };
    img.src = resolveImageUrl(rawUrl, program.poster_version);
}
// Panah kiri/kanan di keyboard = program sebelumnya/berikutnya saat modal Detail Program terbuka.
document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
    const modal = document.getElementById('programDetailModal');
    if (!modal || !modal.classList.contains('open')) return;
    // Jangan ganggu pengetikan/kursor di kolom isian (textarea teks WA bersifat readonly, jadi tetap boleh)
    const t = e.target;
    if (t && (t.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.readOnly))) return;
    e.preventDefault();
    navigateProgramDetail(e.key === 'ArrowRight' ? 1 : -1);
});
function closeProgramDetailModal() {
    document.getElementById('programDetailModal').classList.remove('open');
    pdNavIds = [];
    // Kosongkan gambar supaya tidak ada poster program sebelumnya yang sempat berkedip
    const img = document.getElementById('pd_poster_img');
    if (img) { img.onload = img.onerror = null; img.removeAttribute('src'); img.classList.remove('loaded'); }
}
async function copyProgramDetailWaText() {
    const text = document.getElementById('pd_teks_wa').value;
    if (!text) { showToast('Tidak ada teks untuk disalin', 'error'); return; }
    try {
        await navigator.clipboard.writeText(text);
        showToast('Teks WA disalin ke clipboard');
    } catch (err) {
        // Fallback untuk browser/lingkungan tanpa Clipboard API (mis. HTTP non-secure)
        const ta = document.getElementById('pd_teks_wa');
        ta.removeAttribute('readonly');
        ta.focus();
        ta.select();
        try {
            document.execCommand('copy');
            showToast('Teks WA disalin ke clipboard');
        } catch (err2) {
            showToast('Gagal menyalin teks', 'error');
        } finally {
            ta.setAttribute('readonly', 'readonly');
        }
    }
}
window.closeProgramDetailModal = closeProgramDetailModal;
window.copyProgramDetailWaText = copyProgramDetailWaText;

// ============================================================
// 12. ADMIN LOGIN
// ============================================================
// [FIX bug #6] Password TIDAK lagi di-SELECT ke browser. Role ditentukan oleh
// KEY-nya (deterministik), bukan nilai password. Verifikasi password dilakukan di
// server lewat RPC verify_dashboard_password() (SECURITY DEFINER) — lihat
// sql/25_fix_bug6_auth_rpc.sql. USER_ROLES hanya menyimpan role/label untuk UI.
// ============================================================
// 12. ADMIN LOGIN  [MIGRASI: Supabase Auth asli, bukan JWT custom]
// ============================================================
// [MIGRASI] Login dengan email + password langsung ke supabaseClient.auth.signInWithPassword().
// Role ditentukan SETELAH login berhasil dengan membaca dashboard_profiles milik user
// tsb (bukan ditebak dari akun mana yang cocok) -- lihat sql/28_migrate_supabase_auth.sql.
async function loadUserRoles() {
    // Tidak ada lagi yang perlu dimuat: role dibaca dari dashboard_profiles setelah
    // login (lihat checkAdminLogin()), bukan dari app_config. Fungsi ini dipertahankan
    // sebagai no-op supaya pemanggil lama (mis. setelah ganti password) tetap aman.
    USER_ROLES = {};
}

function setAdminSession(role) {
    adminLoggedIn = true;
    currentRole = role;
    sessionStorage.setItem('admin_logged_in', 'true');
    sessionStorage.setItem('admin_role', role);
    sessionStorage.setItem('admin_login_time', Date.now().toString());
    if (sessionTimeout) clearTimeout(sessionTimeout);
    sessionTimeout = setTimeout(() => {
        if (adminLoggedIn) {
            adminLoggedIn = false;
            currentRole = null;
            supabaseClient.auth.signOut();
            sessionStorage.removeItem('admin_logged_in');
            sessionStorage.removeItem('admin_role');
            sessionStorage.removeItem('admin_login_time');
            const adminView = document.getElementById('adminPageView');
            if (adminView.style.display !== 'none') closeAdminPanel();
            renderSidebarNav();
            renderHeaderWelcome();
            showToast('Sesi berakhir, silakan login ulang.', 'error');
        }
    }, SESSION_DURATION);
}

// checkSession() dipanggil ulang tiap kali admin panel dibuka (mis. setelah reload halaman).
// Supabase Auth sendiri yang memulihkan/menyimpan JWT (persistSession: true di client init),
// jadi kita tinggal tanya supabaseClient.auth.getSession() -- tidak perlu lagi menyimpan &
// memvalidasi versi skema JWT secara manual di sessionStorage seperti sebelumnya.
async function checkSession() {
    const loggedIn = sessionStorage.getItem('admin_logged_in');
    const loginTime = sessionStorage.getItem('admin_login_time');
    const savedRole = sessionStorage.getItem('admin_role');

    if (loggedIn === 'true' && loginTime && (Date.now() - parseInt(loginTime) < SESSION_DURATION)) {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) {
            // Sesi Supabase Auth sudah tidak ada/kedaluwarsa -> paksa logout penuh.
            sessionStorage.removeItem('admin_logged_in');
            sessionStorage.removeItem('admin_role');
            sessionStorage.removeItem('admin_login_time');
            adminLoggedIn = false;
            currentRole = null;
            return;
        }
        adminLoggedIn = true;
        currentRole = savedRole || 'admin';
        setAdminSession(currentRole);
        // Sesi lama dipulihkan (app dibuka lagi) -> catat sebagai "terakhir buka app".
        supabaseClient.rpc('update_last_login').then(({ error }) => {
            if (error) console.warn('update_last_login (restore sesi) gagal:', error.message);
        });
    } else {
        sessionStorage.removeItem('admin_logged_in');
        sessionStorage.removeItem('admin_role');
        sessionStorage.removeItem('admin_login_time');
        adminLoggedIn = false;
        currentRole = null;
        await supabaseClient.auth.signOut();
    }
}

// [MIGRASI] Login dengan email + password langsung ke Supabase Auth (satu kali
// signInWithPassword, bukan coba 4 akun bergantian lagi). Role ditentukan SETELAH
// login berhasil, dengan membaca dashboard_profiles milik user tsb (bukan ditebak
// dari email yang diketik) -- supaya tetap aman walau nanti akun bertambah per-orang.
async function checkAdminLogin() {
    const email = document.getElementById('adminEmailInput')?.value.trim();
    const pwd = document.getElementById('adminPasswordInput')?.value;
    const errorDiv = document.getElementById('adminLoginError');
    if (!errorDiv) return;

    if (Date.now() < loginLockTime) {
        const waitSeconds = Math.ceil((loginLockTime - Date.now()) / 1000);
        errorDiv.innerHTML = '<i class="bi bi-hourglass-split"></i> Terlalu banyak percobaan. Coba lagi ' + waitSeconds + ' detik.';
        return;
    }
    if (loginLockTime && Date.now() >= loginLockTime) {
        loginAttempts = 0;
        loginLockTime = 0;
    }

    if (!email || !pwd) {
        errorDiv.innerHTML = '<i class="bi bi-exclamation-circle-fill"></i> Email dan password wajib diisi!';
        return;
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pwd });

    if (!error && data?.session) {
        // Ambil role dashboard user ini dari dashboard_profiles (diisi lewat
        // scripts/setup-auth-accounts.mjs atau manual di SQL Editor -- lihat sql/28_migrate_supabase_auth.sql).
        const { data: profile, error: profileErr } = await supabaseClient
            .from('dashboard_profiles')
            .select('dashboard_role, label')
            .eq('id', data.session.user.id)
            .single();

        if (profileErr || !profile) {
            await supabaseClient.auth.signOut();
            errorDiv.innerHTML = '<i class="bi bi-exclamation-circle-fill"></i> Akun ini belum terdaftar di dashboard_profiles. Hubungi admin untuk didaftarkan.';
            return;
        }

        loginAttempts = 0;
        setAdminSession(profile.dashboard_role);
        try {
            sessionStorage.setItem('admin_login_email', email);
            sessionStorage.setItem('admin_login_label', profile.label || '');
        } catch (_) {}
        // Catat waktu login ini sebagai "terakhir buka app" (tidak perlu ditunggu).
        supabaseClient.rpc('update_last_login').then(({ error }) => {
            if (error) console.warn('update_last_login gagal:', error.message);
        });
        renderHeaderWelcome();
        closeAdminPanel();
        renderSidebarNav();
        showToast('Berhasil login sebagai ' + profile.label);
    } else {
        loginAttempts++;
        if (loginAttempts >= 5) {
            loginLockTime = Date.now() + 60000;
            errorDiv.innerHTML = '<i class="bi bi-exclamation-circle-fill"></i> Terlalu banyak percobaan. Coba lagi 1 menit.';
        } else {
            errorDiv.innerHTML = '<i class="bi bi-exclamation-circle-fill"></i> Email atau password salah! Sisa percobaan: ' + (5 - loginAttempts);
        }
    }
}


// ============================================================
// PENGATURAN USER & AKSES MENU — kode utamanya dipindah ke modul lazy js/modules/pengaturan-user.js
// ============================================================
// Bagian di bawah SENGAJA tetap di sini: dipanggil kode inti secara sinkron
// (tabel/badge/validasi) sehingga tidak boleh menunggu unduhan modul.


// Metadata tampilan per role (dipakai daftar user, kartu role, matriks akses).
const US_ROLE_META = {
    admin: { label: 'Admin', icon: 'bi-shield-fill-check' },
    user:  { label: 'User',  icon: 'bi-person-fill' },
    guest: { label: 'Guest', icon: 'bi-eye-fill' }
};

async function logoutAdmin() {
    adminLoggedIn = false;
    currentRole = null;
    await supabaseClient.auth.signOut();
    sessionStorage.removeItem('admin_logged_in');
    sessionStorage.removeItem('admin_role');
    sessionStorage.removeItem('admin_login_time');
    sessionStorage.removeItem('admin_login_email');
    sessionStorage.removeItem('admin_login_label');
    if (sessionTimeout) clearTimeout(sessionTimeout);
    closeAdminPanel();
    renderSidebarNav();
    renderHeaderWelcome();
    showToast('Berhasil logout');
}

// ============================================================
// 13. ADMIN PANEL
// ============================================================
let previousActiveTab = null;

// subtab: 'program' | 'crosscheck' | 'telegram' | 'usersettings' (opsional).
// Dipanggil dari menu sidebar "Manajemen" (admin) atau tombol "Login"/"Tambah" (tanpa param).
async function openAdminPanel(subtab) {
    await checkSession();
    // Snapshot otomatis harian (1x/hari) — hanya untuk admin yang benar-benar login
    if (adminLoggedIn && currentRole === 'admin') {
        maybeDailySnapshot();
    }

    // Kalau sedang di halaman IG Scheduler / Infografis, tutup dulu supaya tidak tumpang tindih
    const igPageView = document.getElementById('igSchedulerPageView');
    if (igPageView && igPageView.style.display !== 'none') {
        igPageView.style.display = 'none';
    }
    const infografisPageView = document.getElementById('infografisPageView');
    if (infografisPageView && infografisPageView.style.display !== 'none') {
        infografisPageView.style.display = 'none';
    }

    // Remember which dashboard tab was active so we can restore it on close
    const activeTabBtn = document.querySelector('.sidebar .nav-item[data-tab].active');
    previousActiveTab = activeTabBtn ? activeTabBtn.dataset.tab : null;

    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('adminPageView').style.display = 'block';

    document.querySelectorAll('.sidebar .nav-item').forEach(item => item.classList.remove('active'));
    const activeNav = subtab
        ? document.querySelector(`.sidebar .nav-item[data-subtab="${subtab}"]`)
        : document.querySelector('.sidebar .login-btn');
    if (activeNav) activeNav.classList.add('active');

    window.scrollTo({ top: 0, behavior: 'smooth' });
    await renderAdminPanel();
    if (subtab && adminLoggedIn) switchAdminSubTab(subtab);

    // Simpan subtab yang benar-benar aktif (kalau tanpa param & belum login,
    // subtab default program tetap disimpan -- setelah login ulang otomatis
    // balik ke sini, bukan cuma ke layar login kosong).
    saveLastView({ view: 'admin', subtab: subtab || 'program' });
}

function closeAdminPanel() {
    document.getElementById('adminPageView').style.display = 'none';
    document.getElementById('dashboardView').style.display = 'block';

    document.querySelectorAll('.sidebar .nav-item').forEach(item => item.classList.remove('active'));
    if (previousActiveTab) {
        document.querySelectorAll('.sidebar .nav-item[data-tab]').forEach(item => {
            item.classList.toggle('active', item.dataset.tab === previousActiveTab);
        });
    }
    // Status login bisa berubah (login/logout) selagi Admin Panel terbuka —
    // render ulang tabel utama supaya tombol Edit/Hapus ikut menyesuaikan role terbaru
    if (currentData && currentData.length) renderTable(currentData);
    applyRoleUIVisibility();

    saveLastView({ view: 'dashboard', tab: previousActiveTab || 'umroh' });
}

function renderMaskapaiOptions(selected = '') {
    let opts = '<option value="">-- Pilih Maskapai --</option>';
    MASKAPAI_LIST.forEach(m => opts += `<option value="${escapeHtml(m)}" ${selected === m ? 'selected' : ''}>${escapeHtml(m)}</option>`);
    return opts;
}

function getAdminLoginBoxHtml() {
    return `
    <div class="admin-login-wrap">
    <div class="admin-login-box">
        <div class="admin-login-body">
            <div class="form-group">
                <label for="adminEmailInput">Email</label>
                <input type="email" id="adminEmailInput" placeholder="nama@amiru-dashboard.internal" autocomplete="username" onkeydown="if(event.key==='Enter')checkAdminLogin()">
            </div>
            <div class="form-group">
                <label for="adminPasswordInput">Password</label>
                <div class="admin-login-field has-toggle">
                    <input type="password" id="adminPasswordInput" placeholder="••••••••" autocomplete="current-password" onkeydown="if(event.key==='Enter')checkAdminLogin()">
                    <button type="button" class="toggle-pw" onclick="toggleAdminPasswordVisibility()" aria-label="Tampilkan password">
                        <i class="bi bi-eye-fill" id="adminPwToggleIcon"></i>
                    </button>
                </div>
            </div>
            <button onclick="checkAdminLogin()" class="btn-primary admin-login-submit"><i class="bi bi-box-arrow-in-right"></i> Masuk</button>
            <div id="adminLoginError" class="admin-login-error"></div>
        </div>

        <p class="admin-login-hint">Lupa password? Hubungi Admin untuk direset.</p>
    </div>
    </div>`;
}

function toggleAdminPasswordVisibility() {
    const input = document.getElementById('adminPasswordInput');
    const icon = document.getElementById('adminPwToggleIcon');
    if (!input || !icon) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    icon.className = showing ? 'bi bi-eye-fill' : 'bi bi-eye-slash-fill';
}

const ADMIN_SUBTAB_META = {
    program: { title: 'Edit & Tambah Program', subtitle: 'Kelola data program umroh' },
    pembayaran: { title: 'Pembayaran', subtitle: 'Kelola pembayaran biaya umroh seluruh jamaah' },
    unggulan: { title: 'Program Unggulan', subtitle: 'Pilih maksimal 3 program untuk ditampilkan di beranda' },
    crosscheck: { title: 'Crosscheck', subtitle: 'Bandingkan poster dengan data program yang tersimpan' },
    telegram: { title: 'Telegram', subtitle: 'Atur notifikasi otomatis ke grup/chat Telegram' },
    auditnota: { title: 'Audit Nota', subtitle: 'Log audit setiap nota yang diterbitkan — append-only, tidak bisa diubah' },
    usersettings: { title: 'Pengaturan User', subtitle: 'Tambah & kelola akun user' },
    snapshot: { title: 'Snapshot / Backup', subtitle: 'Cadangan harian semua data Umroh (maksimal 10)' },
    profil: { title: 'Profil Perusahaan', subtitle: 'Logo, nama, alamat & rekening yang dipakai di nota' },
    assets: { title: 'Assets', subtitle: 'Link ke dokumen penting & referensi data Hotel Saudi Arabia' },
    systemstatus: { title: 'System', subtitle: 'Kondisi & kesehatan sistem Dashboard Amiru saat ini' }
};

function switchAdminSubTab(name) {
    adminSubTab = name;
    document.querySelectorAll('.admin-subtab-panel').forEach(p => p.style.display = (p.id === 'adminSubTab-' + name) ? 'block' : 'none');
    document.querySelectorAll('.sidebar .nav-item[data-subtab]').forEach(b => b.classList.toggle('active', b.dataset.subtab === name));

    const meta = ADMIN_SUBTAB_META[name] || ADMIN_SUBTAB_META.program;
    const titleEl = document.getElementById('adminPageTitle');
    const subtitleEl = document.getElementById('adminPageSubtitle');
    if (titleEl) titleEl.textContent = meta.title;
    if (subtitleEl) subtitleEl.textContent = meta.subtitle;
    // Tombol "+ Tambah Program" di header cuma nyambung ke subtab Program.
    const headerActionsEl = document.getElementById('adminPageHeaderActions');
    if (headerActionsEl) headerActionsEl.style.display = (name === 'program') ? '' : 'none';

    saveLastView({ view: 'admin', subtab: name });

    if (name === 'crosscheck') {
        if (!cxSelectedProgram && adminPrograms && adminPrograms.length) {
            const cxCandidates = adminPrograms.filter(p => !cxIsProgramExpired(p));
            const prioritized = [...cxCandidates].sort((a, b) => cxGetProgramStatus(a).priority - cxGetProgramStatus(b).priority);
            if (prioritized.length) cxSelectedProgram = prioritized[0].id;
        }
        renderCxProgramSelector();
        if (cxSelectedProgram) renderCxPanel(cxSelectedProgram);
        // Muat data referensi Hotel Saudi Arabia di background lalu render ulang
        // panel supaya badge "dikenali/tidak dikenali" di baris Hotel Makkah/
        // Madinah (lihat buildCompareRows -> cxHotelRefLine) langsung muncul.
        if (CX_HOTEL_REF_HINT_ENABLED && !hotelSaudiLoaded) {
            ensureHotelReferenceLoaded().then(() => { if (cxSelectedProgram) renderCxPanel(cxSelectedProgram); });
        }
    }
    if (name === 'telegram') { renderTgRecipients(); }
    if (name === 'auditnota') { loadNotaAuditLog(true); loadNotaAuditStats(); }
    if (name === 'pembayaran') { renderPembayaranPanel(); }
    if (name === 'unggulan') { renderFeaturedAdminTable(); }
    if (name === 'snapshot') { renderSnapshotAdminTable(); }
    if (name === 'usersettings') { switchUsInnerTab('list'); switchUsAccessMode('role'); loadUserList(); renderRoleMenuAccessMatrix(); populateUmaUserSelect(); }
    if (name === 'assets') { switchAssetsInnerTab('links'); loadAssets().then(renderAssetsAdminTable); }
    if (name === 'systemstatus') { renderSystemStatusPanel(); }
}

// ============================================================
// 12d. SYSTEM STATUS
// Panel admin-only yang menampilkan kondisi/kesehatan sistem Dashboard
// Amiru itu sendiri (bukan data operasional Umroh) -- koneksi database,
// jumlah data, backup terakhir, info aplikasi/perangkat, & sesi login.
// SEMUA angka di sini diambil LIVE (query count/latency Supabase, Browser
// API) tiap kali panel dibuka/di-refresh -- tidak ada nilai hardcode yang
// dipoles supaya selalu terlihat "aman".
// ============================================================
const APP_VERSION = '1.0.0'; // ikut package.json -- update manual kalau versi di-bump

function sysRelativeTime(dateInput) {
    if (!dateInput) return '-';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '-';
    const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return 'baru saja';
    if (diffMin < 60) return `${diffMin} menit lalu`;
    const diffJam = Math.floor(diffMin / 60);
    if (diffJam < 24) return `${diffJam} jam lalu`;
    return `${Math.floor(diffJam / 24)} hari lalu`;
}

function sysStatusRow(label, valueHtml) {
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);">
        <span style="font-size:12.5px;color:var(--ink-soft);">${label}</span>
        <span style="font-size:13px;font-weight:600;text-align:right;">${valueHtml}</span>
    </div>`;
}

function sysCardHtml(title, icon, bodyHtml) {
    return `
    <div style="border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <i class="bi ${icon}" style="font-size:15px;color:var(--ink-soft);"></i>
            <h3 style="font-size:13.5px;font-weight:700;margin:0;color:var(--ink);">${title}</h3>
        </div>
        ${bodyHtml}
    </div>`;
}

function sysBadge(ok, textOk, textFail) {
    return ok
        ? `<span class="status-badge available pill-sm"><i class="bi bi-check-circle-fill"></i> ${textOk}</span>`
        : `<span class="status-badge full pill-sm"><i class="bi bi-x-circle-fill"></i> ${textFail}</span>`;
}

// Badge 4-state (dipakai khusus panel Kondisi API & Edge Function, karena
// "gagal" bisa berarti beberapa hal berbeda: fungsi belum di-deploy sama
// sekali vs error di server vs memang tidak bisa dijangkau dari browser).
function sysApiBadge(state, text) {
    const map = {
        ok:         { cls: 'available', icon: 'bi-check-circle-fill' },
        missing:    { cls: 'limited',   icon: 'bi-question-circle-fill' },
        error:      { cls: 'full',      icon: 'bi-exclamation-triangle-fill' },
        unreachable:{ cls: 'full',      icon: 'bi-x-circle-fill' },
        unset:      { cls: 'neutral',   icon: 'bi-dash-circle' },
    };
    const m = map[state] || map.error;
    return `<span class="status-badge ${m.cls} pill-sm"><i class="bi ${m.icon}"></i> ${text}</span>`;
}

// ---- Daftar Edge Function (Supabase) yang benar-benar dipanggil dari
// dashboard ini. Sengaja dibungkus FUNGSI (bukan const array langsung) dan
// baru dipanggil saat panel System dibuka -- kalau ditulis sebagai const
// di top-level, referensi ke CX_OCR_FUNCTION_URL / IG_CAPTION_FUNCTION_URL
// (yang const-nya baru dideklarasikan jauh di bawah file ini) akan kena
// temporal-dead-zone ReferenceError saat script pertama kali di-parse,
// dan itu bikin SELURUH app.js berhenti jalan. Dengan dibungkus fungsi,
// isinya baru dievaluasi belakangan (event/onclick), saat semua const di
// atas sudah pasti terinisialisasi. ----
function getSystemEdgeFunctions() {
    return [
        { label: 'generate-wa-caption', desc: 'AI Caption WA (Gemini)', url: WA_CAPTION_FUNCTION_URL },
        { label: 'parse-broadcast-ai', desc: 'AI Parse Broadcast (Gemini)', url: PARSE_BROADCAST_AI_FUNCTION_URL },
        { label: 'generate-tg-reminder', desc: 'AI Reminder Telegram (Gemini)', url: TG_REMINDER_AI_FUNCTION_URL },
        { label: 'generate-payment-reminder-wa', desc: 'AI Reminder Pembayaran (Gemini)', url: PAYMENT_REMINDER_WA_FUNCTION_URL },
        { label: 'scan-poster-ocr', desc: 'OCR Poster (Crosscheck)', url: CX_OCR_FUNCTION_URL },
        { label: 'generate-ig-caption', desc: 'AI Caption Instagram (Gemini)', url: IG_CAPTION_FUNCTION_URL },
        { label: 'admin-create-user', desc: 'Buat User (Supabase Auth Admin API)', url: ADMIN_CREATE_USER_URL },
        { label: 'admin-reset-user-password', desc: 'Reset Password User', url: ADMIN_RESET_USER_PASSWORD_URL },
        { label: 'ig-manual-retry', desc: 'Retry Publish Instagram', url: `${SUPABASE_URL}/functions/v1/ig-manual-retry` },
    ];
}

// Cek satu Edge Function dengan request OPTIONS (preflight CORS) -- BUKAN
// panggilan fungsional (tidak mengirim payload/aksi apapun ke Telegram,
// Gemini, dsb). Semua Edge Function di repo ini menjawab OPTIONS di baris
// paling atas Deno.serve() sebelum logic bisnis jalan, jadi aman dipakai
// sebagai health-check tanpa efek samping. Dibungkus timeout manual karena
// fetch() tidak punya timeout bawaan.
async function checkEdgeFunctionStatus(url, timeoutMs = 6000) {
    const t0 = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: 'OPTIONS',
            headers: { apikey: SUPABASE_ANON_KEY },
            signal: controller.signal
        });
        const latency = Math.round(performance.now() - t0);
        if (res.status === 404) return { state: 'missing', status: res.status, latency };
        if (res.ok) return { state: 'ok', status: res.status, latency };
        return { state: 'error', status: res.status, latency };
    } catch (err) {
        const latency = Math.round(performance.now() - t0);
        const timedOut = err && err.name === 'AbortError';
        return { state: 'unreachable', status: null, latency, detail: timedOut ? 'Timeout' : (err.message || String(err)) };
    } finally {
        clearTimeout(timer);
    }
}

async function renderSystemStatusPanel() {
    const el = document.getElementById('sysStatusContent');
    if (!el) return;
    if (currentRole !== 'admin') {
        el.innerHTML = `<div class="kb-no-program" style="color:var(--danger);"><i class="bi bi-shield-lock-fill"></i><p>Halaman ini khusus admin.</p></div>`;
        return;
    }
    el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--ink-soft);"><i class="bi bi-hourglass-split"></i> Memeriksa kondisi sistem &amp; Edge Function...</div>`;

    // ---- 1. Koneksi Supabase -- tes langsung (latency diukur betulan, bukan asumsi) ----
    let dbOk = false, dbError = '';
    const t0 = performance.now();
    try {
        const { error } = await supabaseClient.from('programs').select('id', { count: 'exact', head: true });
        if (error) throw error;
        dbOk = true;
    } catch (err) {
        dbError = err.message || String(err);
    }
    const dbLatency = Math.round(performance.now() - t0);

    // ---- 2. Ringkasan jumlah data -- count query per tabel, bukan dari cache ----
    const countTables = [
        { table: 'programs', label: 'Program' },
        { table: 'kb_jamaah', label: 'Data Jamaah (aktif)', filter: q => q.eq('diarsipkan', false) },
        { table: 'pendaftaran', label: 'Pendaftaran' },
        { table: 'pembayaran_jamaah', label: 'Baris Pembayaran' },
        { table: 'jadwal_tamu', label: 'Jadwal Tamu' },
    ];
    const counts = await Promise.all(countTables.map(async t => {
        try {
            let q = supabaseClient.from(t.table).select('id', { count: 'exact', head: true });
            if (t.filter) q = t.filter(q);
            const { count, error } = await q;
            if (error) throw error;
            return { ...t, count, ok: true };
        } catch (err) {
            return { ...t, count: null, ok: false };
        }
    }));

    // ---- 3. Snapshot / backup terakhir ----
    let lastSnapshot = null, snapshotCount = null, snapshotError = '';
    try {
        const { data, error } = await supabaseClient.from('snapshot_backup').select('id, created_at').order('created_at', { ascending: false });
        if (error) throw error;
        snapshotCount = (data || []).length;
        lastSnapshot = (data && data[0]) ? data[0].created_at : null;
    } catch (err) {
        snapshotError = err.message || String(err);
    }

    // ---- 4. Info aplikasi & perangkat -- dicek live lewat Browser API, TERMASUK
    // Service Worker (jujur ditampilkan "Tidak terdaftar" kalau memang belum ada
    // navigator.serviceWorker.register() dipanggil di manapun -- tidak dipoles). ----
    const online = navigator.onLine;
    const standalone = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    let swRegistered = false, swCount = 0;
    if ('serviceWorker' in navigator) {
        try {
            const regs = await navigator.serviceWorker.getRegistrations();
            swCount = regs.length;
            swRegistered = swCount > 0;
        } catch (e) {}
    }
    let storageInfo = null;
    if (navigator.storage && navigator.storage.estimate) {
        try { storageInfo = await navigator.storage.estimate(); } catch (e) {}
    }

    // ---- 5. Kondisi API & Edge Function -- ping OPTIONS ke tiap Edge Function
    // yang dipakai dashboard (lihat SYSTEM_EDGE_FUNCTIONS), sekaligus cek
    // apakah URL Edge Function Telegram (send-telegram) sudah diisi di
    // Pengaturan Telegram. Semua dijalankan paralel supaya panel tidak lama. ----
    const edgeResults = await Promise.all(
        getSystemEdgeFunctions().map(async fn => ({ ...fn, ...(await checkEdgeFunctionStatus(fn.url)) }))
    );
    let tgEdgeResult = null, tgEdgeUrl = '';
    try {
        const tgCfg = await getTgConfig();
        tgEdgeUrl = (tgCfg && tgCfg.edgeUrl) ? tgCfg.edgeUrl : '';
        if (tgEdgeUrl) tgEdgeResult = await checkEdgeFunctionStatus(tgEdgeUrl);
    } catch (e) {}

    // ---- 6. Sesi login saat ini ----
    let sessionEmail = '-';
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        sessionEmail = (session && session.user && session.user.email) || '-';
    } catch (e) {}
    let sessionExpiryText = '-';
    const loginTimeRaw = sessionStorage.getItem('admin_login_time');
    if (loginTimeRaw) {
        const sisaMs = SESSION_DURATION - (Date.now() - parseInt(loginTimeRaw));
        sessionExpiryText = sisaMs > 0 ? `${Math.max(1, Math.round(sisaMs / 60000))} menit lagi` : 'kedaluwarsa';
    }

    el.innerHTML = `
        ${sysCardHtml('Koneksi Database (Supabase)', 'bi-hdd-network-fill',
            sysStatusRow('Status', sysBadge(dbOk, 'Terhubung', 'Gagal terhubung')) +
            sysStatusRow('Latency', `${dbLatency} ms`) +
            (dbError ? sysStatusRow('Detail Error', `<span style="color:var(--danger);font-weight:500;">${escapeHtml(dbError)}</span>`) : '')
        )}
        ${sysCardHtml('Ringkasan Data', 'bi-database-fill',
            counts.map(c => sysStatusRow(c.label, c.ok ? `${c.count ?? 0}` : `<span style="color:var(--danger);">gagal dimuat</span>`)).join('')
        )}
        ${sysCardHtml('Snapshot / Backup', 'bi-camera2',
            snapshotError
                ? sysStatusRow('Status', `<span style="color:var(--danger);">${escapeHtml(snapshotError)}</span>`)
                : sysStatusRow('Backup Terakhir', lastSnapshot ? `${formatDateToIndonesian(new Date(lastSnapshot))} (${sysRelativeTime(lastSnapshot)})` : 'Belum pernah backup') +
                  sysStatusRow('Total Tersimpan', `${snapshotCount ?? 0} / 10`)
        )}
        ${sysCardHtml('Kondisi API &amp; Edge Function', 'bi-cloud-arrow-up-fill',
            edgeResults.map(r => {
                const stateText = {
                    ok: `Aktif (${r.latency} ms)`,
                    missing: 'Belum ter-deploy (404)',
                    error: `Error (status ${r.status})`,
                    unreachable: r.detail === 'Timeout' ? 'Timeout' : 'Tidak terjangkau'
                }[r.state] || 'Tidak diketahui';
                return sysStatusRow(`${r.label} <span style="color:var(--ink-soft);font-weight:400;">— ${r.desc}</span>`, sysApiBadge(r.state, stateText));
            }).join('') +
            (tgEdgeUrl
                ? sysStatusRow('send-telegram <span style="color:var(--ink-soft);font-weight:400;">— Notifikasi Telegram</span>', sysApiBadge(
                    tgEdgeResult ? tgEdgeResult.state : 'error',
                    tgEdgeResult ? ({ ok: `Aktif (${tgEdgeResult.latency} ms)`, missing: 'Belum ter-deploy (404)', error: `Error (status ${tgEdgeResult.status})`, unreachable: tgEdgeResult.detail === 'Timeout' ? 'Timeout' : 'Tidak terjangkau' }[tgEdgeResult.state] || 'Tidak diketahui') : 'Gagal cek'
                  ))
                : sysStatusRow('send-telegram <span style="color:var(--ink-soft);font-weight:400;">— Notifikasi Telegram</span>', sysApiBadge('unset', 'URL belum diatur'))
            )
        )}
        ${sysCardHtml('Aplikasi & Perangkat', 'bi-phone-fill',
            sysStatusRow('Versi Aplikasi', APP_VERSION) +
            sysStatusRow('Koneksi Internet', sysBadge(online, 'Online', 'Offline')) +
            sysStatusRow('Mode Tampilan', standalone ? 'PWA Terinstal (standalone)' : 'Browser Tab') +
            sysStatusRow('Service Worker', sysBadge(swRegistered, `Terdaftar (${swCount})`, 'Tidak terdaftar')) +
            (storageInfo ? sysStatusRow('Penyimpanan Cache', `${((storageInfo.usage || 0) / 1048576).toFixed(1)} MB / ${((storageInfo.quota || 0) / 1048576).toFixed(0)} MB`) : '')
        )}
        ${sysCardHtml('Sesi Login', 'bi-person-badge-fill',
            sysStatusRow('Login sebagai', escapeHtml(sessionEmail)) +
            sysStatusRow('Role', currentRole || '-') +
            sysStatusRow('Sesi berakhir', sessionExpiryText)
        )}
    `;
}

async function renderAdminPanel() {
    const container = document.getElementById('adminPanelBody');
    if (adminLoggedIn) {
        container.classList.remove('is-login');
        // ---- Role tiers ----
        // admin  : akses penuh (Program + Crosscheck + Telegram + Pengaturan User)
        // user   : hanya kelola data Program (tambah/edit/hapus), tidak bisa masuk subtab lain
        // guest  : hanya boleh melihat data Program (read-only), tidak ada tombol aksi
        const isAdmin = currentRole === 'admin';
        const isUser = currentRole === 'user';
        const isGuest = currentRole === 'guest';
        const canEditData = isAdmin || isUser; // boleh tambah/edit/hapus program
        const { data } = await supabaseClient.from('programs').select('*').order('created_at');
        const nowForSort = new Date();
        adminPrograms = (data || []).map(unpackProgramAdminData).sort((a, b) => {
            const da = a.tgl ? parseDateFromString(a.tgl) : null;
            const db = b.tgl ? parseDateFromString(b.tgl) : null;
            // Program yang sudah expired (tanggal berangkat sudah lewat) dinonaktifkan
            // secara tampilan & selalu ditaruh paling bawah, di bawah program tanpa tanggal.
            const aExpired = !!(da && da < nowForSort);
            const bExpired = !!(db && db < nowForSort);
            if (aExpired !== bExpired) return aExpired ? 1 : -1;
            if (!da && !db) return 0;
            if (!da) return aExpired ? -1 : 1;  // program tanpa tanggal ditaruh di bawah (kecuali dua-duanya expired)
            if (!db) return aExpired ? 1 : -1;
            return aExpired ? db - da : da - db; // expired: terbaru dulu; aktif: terdekat dulu
        });

        container.innerHTML = `
            <div class="admin-subtab-panel" id="adminSubTab-program" style="display:block;">
            <div class="admin-toolbar">
                <div class="admin-toolbar-right">
                    ${canEditData ? (() => {
                        const missingCount = getProgramsMissingCaption().length;
                        const incompleteCount = getProgramsIncompleteCaption().length;
                        let html = '';
                        if (missingCount > 0) html += `
                    <button class="btn-batch-caption" id="btnBatchCaption" onclick="batchGenerateMissingCaptions()" title="Generate Caption AI otomatis untuk program yang Teks WA-nya masih kosong">
                        <i class="bi bi-magic"></i> Caption Kosong <span class="badge-count">${missingCount}</span>
                    </button>`;
                        if (incompleteCount > 0) html += `
                    <button class="btn-batch-caption warn" id="btnBatchCaptionIncomplete" onclick="batchGenerateIncompleteCaptions()" title="Generate ulang (TIMPA) Caption WA untuk program yang isinya sudah ada tapi terdeteksi belum lengkap">
                        <i class="bi bi-exclamation-triangle"></i> Caption Belum Lengkap <span class="badge-count">${incompleteCount}</span>
                    </button>`;
                        return html;
                    })() : ''}
                </div>
            </div>

            ${canEditData ? `
            <div id="adminFormContainer" class="admin-form-card" style="display:none;">
                <div class="admin-form-stickygroup">
                    <div class="admin-form-head">
                        <h3><i class="bi bi-file-earmark-richtext-fill"></i> <span id="adminFormTitle">Tambah Program Baru</span></h3>
                        <div class="admin-form-head-actions">
                            <button class="btn-submit-sm" onclick="saveAdminProgram()" title="Simpan (Ctrl+Enter)"><i class="bi bi-floppy-fill"></i> <span>Simpan</span></button>
                            <button class="admin-form-close" onclick="hideAdminForm()" title="Batal (Esc)">&times;</button>
                        </div>
                    </div>
                    <div id="cxAutofillBanner" class="cx-autofill-note" style="display:none;"></div>
                    <div class="admin-form-anchor-nav" id="adminFormAnchorNav">
                        <button type="button" data-target="af-info" onclick="scrollToAdminSection('af-info')"><i class="bi bi-info-circle-fill"></i> Info</button>
                        <button type="button" data-target="af-harga" onclick="scrollToAdminSection('af-harga')"><i class="bi bi-tags-fill"></i> Harga</button>
                        <button type="button" data-target="af-akomodasi" onclick="scrollToAdminSection('af-akomodasi')"><i class="bi bi-building-fill"></i> Akomodasi</button>
                        <button type="button" data-target="af-link" onclick="scrollToAdminSection('af-link')"><i class="bi bi-link-45deg"></i> Link</button>
                        <button type="button" data-target="af-konten" onclick="scrollToAdminSection('af-konten')"><i class="bi bi-text-left"></i> Konten</button>
                    </div>
                </div>
                <div class="admin-form-body">
                    <details id="parseBroadcastBox" class="admin-broadcast-box">
                        <summary class="label"><i class="bi bi-magic"></i> Auto-isi dari Teks Broadcast <span class="bc-hint">(opsional — klik untuk buka)</span></summary>
                        <textarea id="parseBroadcastInput" rows="3" placeholder="Paste teks broadcast program umroh di sini..." oninput="autoGrowTextarea(this); syncBroadcastRefBox();"></textarea>
                        <div class="bc-actions">
                            <button onclick="parseBroadcastText()"><i class="bi bi-magic"></i> Isi Otomatis</button>
                            <button type="button" id="btnParseBroadcastAI" onclick="parseBroadcastTextAI()"><i class="bi bi-stars"></i> <span id="btnParseBroadcastAIText">Parse dengan AI</span></button>
                            <span id="parseStatus" style="font-size:12px;color:var(--success);font-weight:600;display:none;"></span>
                        </div>
                    </details>

                    <div class="admin-fieldset" id="af-info">
                        <div class="admin-fieldset-title"><i class="bi bi-info-circle-fill"></i> Informasi Program</div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Nama Program <span class="required">*</span></label>
                                <input type="text" id="admin_nama" placeholder="Contoh: Umroh Reguler 9 Hari" maxlength="200">
                            </div>
                            <div class="form-group">
                                <label>Tanggal Berangkat</label>
                                <input type="date" id="admin_tgl_date">
                                <input type="hidden" id="admin_tgl">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Durasi</label>
                                <input type="text" id="admin_durasi" placeholder="9 Hari" maxlength="50">
                            </div>
                            <div class="form-group">
                                <label>Maskapai</label>
                                <select id="admin_maskapai">${renderMaskapaiOptions()}</select>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Kuota Pax</label>
                                <input type="number" id="admin_kuota_pax" placeholder="45" min="1" value="45">
                            </div>
                        </div>
                    </div>

                    <div class="admin-fieldset" id="af-harga">
                        <div class="admin-fieldset-title"><i class="bi bi-tags-fill"></i> Harga per Kamar</div>
                        <div class="form-row form-row-4 form-row-harga">
                            <div class="form-group">
                                <label>Harga Quad</label>
                                <input type="text" inputmode="numeric" id="admin_harga_quad" class="input-rupiah" placeholder="Rp 35.000.000" maxlength="50" oninput="formatRupiahInput(this)">
                            </div>
                            <div class="form-group">
                                <label>Harga Triple</label>
                                <input type="text" inputmode="numeric" id="admin_harga_triple" class="input-rupiah" placeholder="Rp 37.500.000" maxlength="50" oninput="formatRupiahInput(this)">
                            </div>
                            <div class="form-group">
                                <label>Harga Double</label>
                                <input type="text" inputmode="numeric" id="admin_harga_double" class="input-rupiah" placeholder="Rp 42.000.000" maxlength="50" oninput="formatRupiahInput(this)">
                            </div>
                            <div class="form-group">
                                <label>Harga Quint</label>
                                <input type="text" inputmode="numeric" id="admin_harga_quint" class="input-rupiah" placeholder="Rp 32.500.000" maxlength="50" oninput="formatRupiahInput(this)">
                            </div>
                        </div>
                    </div>

                    <div class="admin-fieldset" id="af-akomodasi">
                        <div class="admin-fieldset-title"><i class="bi bi-building-fill"></i> Akomodasi</div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Hotel Makkah</label>
                                <input type="text" id="admin_hotel_makkah" placeholder="Nama hotel & bintang" maxlength="100" oninput="handleHotelRefInput('admin_hotel_makkah','hotelRefHint_makkah','makkah')">
                                <div class="hotel-ref-hint" id="hotelRefHint_makkah"></div>
                            </div>
                            <div class="form-group">
                                <label>Hotel Madinah</label>
                                <input type="text" id="admin_hotel_madinah" placeholder="Nama hotel & bintang" maxlength="100" oninput="handleHotelRefInput('admin_hotel_madinah','hotelRefHint_madinah','madinah')">
                                <div class="hotel-ref-hint" id="hotelRefHint_madinah"></div>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group" id="adminHotelExtra3" style="display:none;">
                                <label>Hotel 3 <span style="font-weight:400;opacity:.7;">(opsional)</span></label>
                                <div style="display:flex;gap:8px;">
                                    <select id="admin_hotel_3_kota" style="flex:0 0 112px;" onchange="updateAdminHotelExtraHint(3)">
                                        <option value="">Kota...</option>
                                        ${['Makkah','Madinah','Jeddah','Thaif','Transit'].map(k => `<option value="${k}">${k}</option>`).join('')}
                                    </select>
                                    <input type="text" id="admin_hotel_3" style="flex:1;min-width:0;" placeholder="Nama hotel & bintang" maxlength="100" oninput="handleHotelExtraInput(3)">
                                </div>
                                <div class="hotel-ref-hint" id="hotelRefHint_3"></div>
                            </div>
                            <div class="form-group" id="adminHotelExtra4" style="display:none;">
                                <label>Hotel 4 <span style="font-weight:400;opacity:.7;">(opsional)</span></label>
                                <div style="display:flex;gap:8px;">
                                    <select id="admin_hotel_4_kota" style="flex:0 0 112px;" onchange="updateAdminHotelExtraHint(4)">
                                        <option value="">Kota...</option>
                                        ${['Makkah','Madinah','Jeddah','Thaif','Transit'].map(k => `<option value="${k}">${k}</option>`).join('')}
                                    </select>
                                    <input type="text" id="admin_hotel_4" style="flex:1;min-width:0;" placeholder="Nama hotel & bintang" maxlength="100" oninput="handleHotelExtraInput(4)">
                                </div>
                                <div class="hotel-ref-hint" id="hotelRefHint_4"></div>
                            </div>
                        </div>
                        <button type="button" class="btn-footer-action" id="btnAddHotelExtra" onclick="addAdminHotelExtra()" style="margin-top:8px;"><i class="bi bi-plus-lg"></i> Tambah Hotel 3</button>
                    </div>

                    <div class="admin-fieldset" id="af-link">
                        <div class="admin-fieldset-title"><i class="bi bi-link-45deg"></i> Link & Aset</div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Link Poster</label>
                                <input type="url" id="admin_link_poster" placeholder="https://...">
                            </div>
                            <div class="form-group">
                                <label>Link Itinerary</label>
                                <input type="url" id="admin_link_itinerary" placeholder="https://...">
                            </div>
                        </div>
                    </div>

                    <div class="admin-fieldset" id="af-konten">
                        <div class="admin-fieldset-title"><i class="bi bi-text-left"></i> Konten Tambahan</div>
                        <div class="form-group">
                            <label>Fasilitas / Termasuk</label>
                            <textarea id="admin_termasuk" rows="3" placeholder="Tiket pesawat PP&#10;Visa umroh&#10;Hotel bintang 4" maxlength="2000"></textarea>
                        </div>
                        <div class="form-group">
                            <label>Tidak Termasuk</label>
                            <textarea id="admin_tidak_termasuk" rows="2" placeholder="Airport tax&#10;Biaya pengurusan paspor" maxlength="1000"></textarea>
                        </div>
                        <div class="form-group">
                            <label>Catatan Tambahan Admin</label>
                            <textarea id="admin_catatan_cx" rows="2" placeholder="Contoh: Biaya dan jadwal sewaktu-waktu dapat berubah mengikuti ketentuan Saudi, Maskapai serta kenaikan kurs Dolar dan Riyal." maxlength="500"></textarea>
                        </div>
                        <div class="form-group" style="margin-bottom:0;">
                            <div class="wa-compare-grid">
                                <div class="wa-compare-col">
                                    <div class="teks-wa-label-row">
                                        <label style="margin-bottom:0;">Teks WA (Hasil Generate)</label>
                                        <button type="button" class="btn-ai-caption" id="btnGenCaptionAI" onclick="generateCaptionAI()">
                                            <i class="bi bi-magic"></i> <span id="btnGenCaptionAIText">Generate dengan AI</span>
                                        </button>
                                    </div>
                                    <textarea id="admin_teks_wa" class="wa-autogrow" rows="4" placeholder="Kosongkan untuk generate otomatis, atau klik Generate dengan AI" maxlength="5000" oninput="updateWaCaptionGauge(this.value); autoGrowTextarea(this);"></textarea>
                                    <div id="waCaptionGauge" class="wa-caption-gauge"></div>
                                </div>
                                <div class="wa-compare-col">
                                    <label>Teks Broadcast Asli <span class="bc-hint">(untuk cek manual)</span></label>
                                    <textarea id="admin_teks_wa_broadcast_ref" class="wa-autogrow wa-broadcast-ref" rows="4" placeholder="Belum ada teks broadcast yang di-paste." readonly tabindex="-1"></textarea>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="admin-form-footer">
                    <button class="btn-submit" onclick="saveAdminProgram()"><i class="bi bi-floppy-fill"></i> Simpan</button>
                    <button class="btn-cancel" onclick="hideAdminForm()">Batal</button>
                </div>
            </div>
            ` : ''}

            <div id="adminNoPosterBanner"></div>

            <div class="admin-table-card">
                <div class="admin-table-head">
                    <h4>Daftar Program</h4>
                    <span class="count">${adminPrograms.length} program</span>
                </div>
                <div id="adminNoCaptionBanner"></div>
                <div id="adminDuplikatBanner"></div>
                <div class="admin-table-wrap">
                    <table class="admin-program-table">
                        <thead>
                            <tr>
                                <th>Nama Program</th>
                                <th>Tanggal Berangkat</th>
                                <th>Durasi</th>
                                <th class="col-harga">Quad</th>
                                <th class="col-harga">Triple</th>
                                <th class="col-harga">Double</th>
                                <th>Maskapai</th>
                                <th>Hotel Makkah</th>
                                <th>Hotel Madinah</th>
                                <th id="thAdminHotel3" style="display:none;">Hotel 3</th>
                                <th id="thAdminHotel4" style="display:none;">Hotel 4</th>
                                ${canEditData ? `<th style="text-align:right;">Aksi</th>` : ''}
                            </tr>
                        </thead>
                        <tbody id="adminTableBody"></tbody>
                    </table>
                </div>
                ${isAdmin ? `
                <div class="admin-table-foot-actions">
                    <span class="admin-table-foot-label"><i class="bi bi-shield-lock"></i> Kelola Data Program (Zona Berisiko)</span>
                    <div class="admin-table-foot-btns">
                        <button class="btn-footer-action" onclick="exportAdminData()" title="Export Data"><i class="bi bi-download"></i> Export</button>
                        <button class="btn-footer-action" onclick="importAdminData()" title="Import Data"><i class="bi bi-upload"></i> Import</button>
                        <button class="btn-footer-action danger" onclick="clearAllAdminData()" title="Hapus Semua Data"><i class="bi bi-trash-fill"></i> Hapus Semua</button>
                    </div>
                </div>
                ` : ''}
            </div>

            <div class="admin-table-card" id="adminExpiredCard" style="display:none;margin-top:18px;">
                <div class="admin-table-head">
                    <h4><i class="bi bi-clock-history" style="color:var(--ink-soft);"></i> Program Expired</h4>
                    <span class="count" id="adminExpiredCount">0 program</span>
                </div>
                <div class="admin-table-wrap">
                    <table class="admin-program-table">
                        <thead>
                            <tr>
                                <th>Nama Program</th>
                                <th>Tanggal Berangkat</th>
                                <th>Durasi</th>
                                <th class="col-harga">Quad</th>
                                <th class="col-harga">Triple</th>
                                <th class="col-harga">Double</th>
                                <th>Maskapai</th>
                                <th>Hotel Makkah</th>
                                <th>Hotel Madinah</th>
                                <th id="thAdminExpHotel3" style="display:none;">Hotel 3</th>
                                <th id="thAdminExpHotel4" style="display:none;">Hotel 4</th>
                                ${canEditData ? `<th style="text-align:right;">Aksi</th>` : ''}
                            </tr>
                        </thead>
                        <tbody id="adminExpiredTableBody"></tbody>
                    </table>
                </div>
            </div>
            </div>

            <div class="admin-subtab-panel" id="adminSubTab-pembayaran" style="display:none;">
                <div class="admin-section-header">
                    <div><h4>Pembayaran Biaya Umroh</h4>
                    <p>Pantau & kelola cicilan/pelunasan biaya umroh seluruh jamaah dari semua program</p></div>
                </div>
                <div class="pb-scope-note"><i class="bi bi-info-circle"></i> Menampilkan progres tagihan &amp; pembayaran per jamaah, bukan buku kas/laporan arus keuangan.</div>
                <div class="pb-income-hero" id="pbIncomeHero"></div>
                <div class="pb-income-breakdown-wrap">
                    <div class="pb-income-breakdown-head">
                        <h4>Rincian Tagihan &amp; Pembayaran per Program</h4>
                        <span class="count" id="pbBreakdownCount">0 program</span>
                    </div>
                    <div class="pb-income-breakdown-grid" id="pbIncomeBreakdown"></div>
                </div>
                <div class="cx-stats-bar" id="pbStatsBar"></div>
                <div class="admin-toolbar">
                    <input type="text" id="pbSearchInput" placeholder="Cari nama jamaah / NIK / paspor..." style="flex:1;min-width:220px;" oninput="handlePbSearchInput()">
                    <div class="pb-combo" id="pbProgramCombo">
                        <button type="button" class="pb-combo-trigger" id="pbProgramComboTrigger" onclick="togglePbProgramCombo()">
                            <span id="pbProgramComboLabel">Semua Program</span>
                            <i class="bi bi-chevron-down"></i>
                        </button>
                        <div class="pb-combo-panel" id="pbProgramComboPanel">
                            <div class="pb-combo-search">
                                <i class="bi bi-search"></i>
                                <input type="text" id="pbProgramComboSearch" placeholder="Cari nama program..." oninput="filterPbProgramComboOptions(this.value)" onclick="event.stopPropagation()">
                            </div>
                            <div class="pb-combo-list" id="pbProgramComboList"></div>
                        </div>
                        <select id="pbFilterProgram" onchange="renderPembayaranTable()" style="display:none;">
                            <option value="">Semua Program</option>
                        </select>
                    </div>
                    <select id="pbFilterStatus" onchange="renderPembayaranTable()" style="min-width:160px;">
                        <option value="">Semua Status</option>
                        <option value="lunas">Lunas</option>
                        <option value="cicilan">Cicilan</option>
                        <option value="belum">Belum Bayar</option>
                        <option value="batal">Batal</option>
                    </select>
                </div>
                <div class="admin-table-card">
                    <div class="admin-table-head">
                        <h4>Daftar Pembayaran Jamaah</h4>
                        <span class="count" id="pbCount">0 jamaah</span>
                    </div>
                    <div class="admin-table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Nama Jamaah</th>
                                    <th>Program</th>
                                    <th>Total Tagihan</th>
                                    <th>Dibayar</th>
                                    <th>Sisa</th>
                                    <th>Progres</th>
                                    <th>Status</th>
                                    <th style="text-align:right;">Aksi</th>
                                </tr>
                            </thead>
                            <tbody id="pbTableBody"><tr><td colspan="8" style="text-align:center;padding:24px;color:var(--ink-soft);">Memuat...</td></tr></tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="admin-subtab-panel" id="adminSubTab-unggulan" style="display:none;">
                <div class="admin-section-header">
                    <div><h4>Program Unggulan</h4>
                    <p>Pilih program untuk ditampilkan di beranda (antara running text & tabel program)</p></div>
                    <div class="sec-actions"></div>
                </div>
                <div class="admin-table-card">
                    <div class="admin-table-head">
                        <h4>Daftar Program</h4>
                        <span class="count">Klik tombol untuk menjadikan/hapus unggulan</span>
                    </div>
                    <div class="admin-table-wrap">
                        <table>
                            <thead><tr>
                                <th>Nama Program</th>
                                <th>Tanggal Berangkat</th>
                                <th style="text-align:right;">Status Unggulan</th>
                            </tr></thead>
                            <tbody id="featuredAdminTableBody"></tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="admin-subtab-panel" id="adminSubTab-systemstatus" style="display:none;">
                <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
                    <button class="btn-primary btn-sm" onclick="renderSystemStatusPanel()"><i class="bi bi-arrow-clockwise"></i> Refresh</button>
                </div>
                <div id="sysStatusContent"></div>
            </div>

            <div class="admin-subtab-panel" id="adminSubTab-crosscheck" style="display:none;">
                <div class="cx-layout">
                    <div class="cx-sidebar">
                        <div class="cx-stats-bar" id="cxStatsBar"></div>
                        <div class="cx-search-wrap">
                            <i class="bi bi-search"></i>
                            <input type="text" id="cxSearchInput" class="cx-search-input" placeholder="Cari nama program..." oninput="renderCxProgramSelector()">
                        </div>
                        <div class="cx-program-selector" id="cxProgramSelector"></div>
                    </div>
                    <div class="cx-detail-card">
                        <div id="cxPanelContent">
                            <div class="cx-empty"><i class="bi bi-graph-up-arrow"></i><p>Pilih program di atas untuk melihat data crosscheck.</p></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="admin-subtab-panel" id="adminSubTab-telegram" style="display:none;">
                <div class="admin-section-header">
                    <div><h4>Notifikasi Telegram</h4>
                    <p>Kirim notifikasi otomatis ke grup/chat Telegram saat ada program/jadwal baru</p></div>
                </div>
                <div class="tg-info-box">
                    <b><i class="bi bi-list-check"></i> Cara Setup:</b><br>
                    1. Buat bot via <b>@BotFather</b> di Telegram → dapatkan <b>Bot Token</b><br>
                    2. Tambahkan bot ke grup/chat yang diinginkan, jadikan <b>Admin</b><br>
                    3. Dapatkan <b>Chat ID</b> via <code>@userinfobot</code> atau <code>https://api.telegram.org/bot[TOKEN]/getUpdates</code><br>
                    4. Buat <b>Edge Function</b> di Supabase bernama <code>send-telegram</code> → isi URL-nya di bawah<br>
                    5. Simpan konfigurasi → notifikasi otomatis aktif!
                </div>
                <div class="tg-settings-grid">
                    <div class="form-group">
                        <label>Bot Token</label>
                        <input type="text" id="tg_bot_token" placeholder="1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ" style="font-family:'IBM Plex Mono',monospace;">
                    </div>
                    <div class="form-group">
                        <label>Edge Function URL</label>
                        <input type="url" id="tg_edge_url" placeholder="https://xxx.supabase.co/functions/v1/send-telegram" style="font-family:'IBM Plex Mono',monospace;">
                    </div>
                </div>
                <div class="cx-label-sm">Penerima Notifikasi</div>
                <p class="tg-hint">Centang jenis notifikasi yang diterima tiap penerima. <b>Pengingat 1 bulan</b> dikirim otomatis saat halaman dibuka.</p>
                <div class="tg-recipients-list" id="tgRecipientsList"></div>
                <button class="tg-add-btn" onclick="addTgRecipient()"><i class="bi bi-plus-lg"></i> Tambah Penerima</button>
                <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;">
                    <button class="btn-primary" onclick="saveTgConfig()"><i class="bi bi-floppy-fill"></i> Simpan Konfigurasi</button>
                    <button class="btn-cancel" onclick="testTgNotif()"><i class="bi bi-send-fill"></i> Test Kirim</button>
                    <button class="btn-cancel" onclick="testTgReminderAI()"><i class="bi bi-stars"></i> Test Reminder AI</button>
                </div>
                <div id="tgStatusMsg" style="margin-top:12px;"></div>
                <div class="tg-notif-log" id="tgNotifLog" style="display:none;">
                    <p style="color:var(--ink-soft);font-size:11px;margin-bottom:6px;"><i class="bi bi-list-ul"></i> LOG PENGIRIMAN TELEGRAM:</p>
                </div>
            </div>

            <div class="admin-subtab-panel" id="adminSubTab-auditnota" style="display:none;">
                <div class="us-head">
                    <div class="us-head-text">
                        <h4>Audit Nota</h4>
                        <p>Setiap nota dan kuitansi yang diunduh tercatat otomatis di sini.</p>
                    </div>
                    <span class="an-lock" title="Log ini dilindungi trigger database: tidak bisa diedit atau dihapus siapa pun, termasuk Admin."><i class="bi bi-shield-lock-fill"></i> Append-only · tidak bisa diubah</span>
                </div>

                <div class="us-stats" id="anStats">
                    <div class="us-stat"><span class="us-stat-ico"><i class="bi bi-journal-check"></i></span><div><b id="anStatTotal">-</b><span>Total tercatat</span></div></div>
                    <div class="us-stat an-j-pay"><span class="us-stat-ico"><i class="bi bi-cash-coin"></i></span><div><b id="anStatPay">-</b><span>Nota Pembayaran</span></div></div>
                    <div class="us-stat an-j-hist"><span class="us-stat-ico"><i class="bi bi-clock-history"></i></span><div><b id="anStatHist">-</b><span>Nota Riwayat</span></div></div>
                    <div class="us-stat an-j-kwt"><span class="us-stat-ico"><i class="bi bi-receipt"></i></span><div><b id="anStatKwt">-</b><span>Kuitansi</span></div></div>
                </div>

                <div class="us-card">
                    <div class="us-toolbar">
                        <div class="us-search">
                            <i class="bi bi-search"></i>
                            <input type="text" id="auditNotaSearch" placeholder="Cari nama jamaah, no. nota, atau kode verifikasi..." autocomplete="off" oninput="handleAuditNotaSearchInput()">
                        </div>
                        <input type="hidden" id="auditNotaFilterJenis" value="">
                        <div class="us-chips" id="anJenisChips">
                            <button type="button" class="us-chip active" data-jenis="" onclick="anSetJenis('')">Semua</button>
                            <button type="button" class="us-chip" data-jenis="pembayaran" onclick="anSetJenis('pembayaran')">Pembayaran</button>
                            <button type="button" class="us-chip" data-jenis="riwayat" onclick="anSetJenis('riwayat')">Riwayat</button>
                            <button type="button" class="us-chip" data-jenis="kuitansi" onclick="anSetJenis('kuitansi')">Kuitansi</button>
                        </div>
                        <span class="us-count" id="auditNotaCount">0 nota</span>
                    </div>
                    <div class="admin-table-wrap us-table-wrap">
                        <table class="an-table">
                            <thead>
                                <tr>
                                    <th>Waktu</th>
                                    <th>Nota</th>
                                    <th>Jamaah</th>
                                    <th style="text-align:right;">Jumlah</th>
                                    <th>Dicetak Oleh</th>
                                    <th>Kode Verifikasi</th>
                                    <th style="text-align:right;">Preview</th>
                                </tr>
                            </thead>
                            <tbody id="auditNotaTableBody"><tr><td colspan="7" class="us-state">Memuat...</td></tr></tbody>
                        </table>
                    </div>
                </div>
                <div style="display:flex;justify-content:center;margin-top:14px;">
                    <button class="btn-cancel an-more" id="auditNotaLoadMoreBtn" onclick="loadNotaAuditLog(false)" style="display:none;"><i class="bi bi-arrow-down-circle"></i> Muat Lebih Banyak</button>
                </div>
            </div>

            <div class="admin-subtab-panel" id="adminSubTab-usersettings" style="display:none;">
                <div class="us-head">
                    <div class="us-head-text">
                        <h4>Manajemen User</h4>
                        <p>Kelola akun login, role, dan akses menu sidebar tiap orang.</p>
                    </div>
                    <button type="button" class="btn-primary us-head-btn" onclick="switchUsInnerTab('adduser')"><i class="bi bi-person-plus-fill"></i> Tambah User</button>
                </div>

                <div class="us-stats" id="usStats">
                    <div class="us-stat"><span class="us-stat-ico"><i class="bi bi-people-fill"></i></span><div><b id="usStatTotal">-</b><span>Total user</span></div></div>
                    <div class="us-stat us-role-admin"><span class="us-stat-ico"><i class="bi bi-shield-fill-check"></i></span><div><b id="usStatAdmin">-</b><span>Admin</span></div></div>
                    <div class="us-stat us-role-user"><span class="us-stat-ico"><i class="bi bi-person-fill"></i></span><div><b id="usStatUser">-</b><span>User</span></div></div>
                    <div class="us-stat us-role-guest"><span class="us-stat-ico"><i class="bi bi-eye-fill"></i></span><div><b id="usStatGuest">-</b><span>Guest</span></div></div>
                </div>

                <div class="us-tabs">
                    <button type="button" class="assets-inner-tab-btn active" data-inner-tab="list" onclick="switchUsInnerTab('list')">
                        <i class="bi bi-people-fill"></i> Daftar User
                    </button>
                    <button type="button" class="assets-inner-tab-btn" data-inner-tab="access" onclick="switchUsInnerTab('access')">
                        <i class="bi bi-ui-checks-grid"></i> Akses Menu
                    </button>
                    <button type="button" class="assets-inner-tab-btn" data-inner-tab="adduser" onclick="switchUsInnerTab('adduser')">
                        <i class="bi bi-person-plus-fill"></i> Tambah User
                    </button>
                </div>

                <div id="usPanel-list" style="display:block;">
                    <div class="us-card">
                        <div class="us-toolbar">
                            <div class="us-search">
                                <i class="bi bi-search"></i>
                                <input type="text" id="usSearch" placeholder="Cari nama atau email..." autocomplete="off" oninput="usSetListFilter('q', this.value)">
                            </div>
                            <div class="us-chips" id="usRoleChips">
                                <button type="button" class="us-chip active" data-role="" onclick="usSetListFilter('role','')">Semua</button>
                                <button type="button" class="us-chip" data-role="admin" onclick="usSetListFilter('role','admin')">Admin</button>
                                <button type="button" class="us-chip" data-role="user" onclick="usSetListFilter('role','user')">User</button>
                                <button type="button" class="us-chip" data-role="guest" onclick="usSetListFilter('role','guest')">Guest</button>
                            </div>
                            <span class="us-count" id="usUserListCount">-</span>
                        </div>
                        <div class="admin-table-wrap us-table-wrap">
                            <table class="us-table">
                                <thead><tr><th>User</th><th>Role</th><th>Terakhir Login</th><th style="text-align:right;">Aksi</th></tr></thead>
                                <tbody id="usUserListBody"><tr><td colspan="4" class="us-state">Memuat...</td></tr></tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div id="usPanel-access" style="display:none;">
                    <div class="us-seg us-seg-top" id="usAccessSwitch">
                        <button type="button" class="active" data-mode="role" onclick="switchUsAccessMode('role')"><i class="bi bi-diagram-3-fill"></i> Per Role</button>
                        <button type="button" data-mode="user" onclick="switchUsAccessMode('user')"><i class="bi bi-person-lock"></i> Per User (Pengecualian)</button>
                    </div>

                    <div id="usAccessRole" class="us-card us-card-pad">
                        <div class="us-card-title"><i class="bi bi-diagram-3-fill"></i> Akses Menu Sidebar per Role</div>
                        <p class="us-hint">Atur menu yang boleh diakses role <b>User</b> dan <b>Guest</b>. Role <b>Admin</b> selalu punya akses penuh dan tidak bisa dikunci di sini.</p>
                        <div id="roleMenuAccessWrap">
                            <div class="us-state">Memuat...</div>
                        </div>
                        <div class="us-savebar">
                            <button class="btn-primary" id="roleMenuAccessSaveBtn" onclick="saveRoleMenuAccessMatrix()"><i class="bi bi-save-fill"></i> Simpan Akses Menu</button>
                            <span id="roleMenuAccessStatus"></span>
                        </div>
                    </div>

                    <div id="usAccessUser" class="us-card us-card-pad" style="display:none;">
                        <div class="us-card-title"><i class="bi bi-person-lock"></i> Akses Menu per User (Pengecualian)</div>
                        <p class="us-hint">Atur pengecualian untuk satu akun, misalnya dua akun sama-sama role <b>User</b> tapi salah satunya perlu dibatasi lebih ketat atau lebih longgar. Menu yang <b>tidak</b> diubah tetap ikut aturan role.</p>
                        <div class="form-group" style="max-width:380px;">
                            <label>Pilih User</label>
                            <select id="umaUserSelect" onchange="renderUserMenuAccessMatrix()">
                                <option value="">-- Pilih akun --</option>
                            </select>
                        </div>
                        <div id="userMenuAccessWrap"></div>
                        <div id="userMenuAccessActions" class="us-savebar" style="display:none;">
                            <button class="btn-primary" id="userMenuAccessSaveBtn" onclick="saveUserMenuAccessMatrix()"><i class="bi bi-save-fill"></i> Simpan Akses User Ini</button>
                            <button class="btn-cancel" id="userMenuAccessResetBtn" onclick="resetUserMenuAccessMatrix()"><i class="bi bi-arrow-counterclockwise"></i> Kembalikan ke Default Role</button>
                            <span id="userMenuAccessStatus"></span>
                        </div>
                    </div>
                </div>

                <div id="usPanel-adduser" style="display:none;">
                    <div class="us-card us-card-pad">
                        <div class="us-card-title"><i class="bi bi-person-plus-fill"></i> Tambah User Baru</div>
                        <p class="us-hint">Buat akun login untuk satu orang. Pilih role sesuai kebutuhan, role bisa dibatasi lebih lanjut di tab Akses Menu.</p>
                        <div class="us-form-grid">
                            <div class="us-form-fields">
                                <div class="form-group">
                                    <label>Nama / Label<span class="required">*</span></label>
                                    <input type="text" id="us_new_label" placeholder="Contoh: Budi Santoso" autocomplete="off">
                                </div>
                                <div class="form-group">
                                    <label>Email<span class="required">*</span></label>
                                    <input type="email" id="us_new_email" placeholder="nama@contoh.com" autocomplete="off">
                                </div>
                                <div class="form-group" style="margin-bottom:0;">
                                    <label>Password<span class="required">*</span></label>
                                    <div class="us-pass">
                                        <input type="text" id="us_new_password" placeholder="Minimal 6 karakter" autocomplete="off">
                                        <button type="button" class="btn-cancel" onclick="usGeneratePassword()" title="Buat password acak"><i class="bi bi-magic"></i> Acak</button>
                                    </div>
                                </div>
                            </div>
                            <div class="us-form-roles">
                                <label class="us-label">Role<span class="required">*</span></label>
                                <input type="hidden" id="us_new_role" value="user">
                                <div class="us-rolecards" id="usRoleCards">
                                    <button type="button" class="us-rolecard us-role-user active" data-role="user" onclick="usPickRole('user')">
                                        <span class="us-rolecard-ico"><i class="bi bi-person-fill"></i></span>
                                        <span class="us-rolecard-txt"><b>User</b><span>Kelola data program, jamaah, dan pembayaran.</span></span>
                                        <i class="bi bi-check-circle-fill us-rolecard-check"></i>
                                    </button>
                                    <button type="button" class="us-rolecard us-role-admin" data-role="admin" onclick="usPickRole('admin')">
                                        <span class="us-rolecard-ico"><i class="bi bi-shield-fill-check"></i></span>
                                        <span class="us-rolecard-txt"><b>Admin</b><span>Akses penuh ke semua menu dan pengaturan.</span></span>
                                        <i class="bi bi-check-circle-fill us-rolecard-check"></i>
                                    </button>
                                    <button type="button" class="us-rolecard us-role-guest" data-role="guest" onclick="usPickRole('guest')">
                                        <span class="us-rolecard-ico"><i class="bi bi-eye-fill"></i></span>
                                        <span class="us-rolecard-txt"><b>Guest</b><span>Hanya lihat, tanpa tambah, ubah, atau hapus.</span></span>
                                        <i class="bi bi-check-circle-fill us-rolecard-check"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="us-savebar">
                            <button class="btn-primary" onclick="createNewUser()"><i class="bi bi-person-plus-fill"></i> Tambah User</button>
                            <span id="usNewUserStatus"></span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="admin-subtab-panel" id="adminSubTab-snapshot" style="display:none;">
                <div class="snap-header">
                    <div class="snap-header-title">
                        <i class="bi bi-camera2"></i>
                        <div>
                            <h4>Snapshot / Backup</h4>
                            <span>Maks 10 · tertua otomatis terhapus · tidak bisa dihapus manual</span>
                        </div>
                    </div>
                    <button class="btn-primary btn-sm" onclick="takeSnapshot('Manual ' + new Date().toLocaleDateString('id-ID'), 'manual').then(() => renderSnapshotAdminTable());">
                        <i class="bi bi-camera-fill"></i> Ambil
                    </button>
                </div>
                <div id="snapshotTableWrap"></div>
            </div>

            <div class="admin-subtab-panel" id="adminSubTab-profil" style="display:none;">
                ${renderCompanyProfileForm()}
            </div>

            <div class="admin-subtab-panel" id="adminSubTab-assets" style="display:none;">
                <div class="assets-inner-tabs">
                    <button type="button" class="assets-inner-tab-btn active" data-inner-tab="links" onclick="switchAssetsInnerTab('links')">
                        <i class="bi bi-bookmark-star-fill"></i> Link &amp; Dokumen
                    </button>
                    <button type="button" class="assets-inner-tab-btn" data-inner-tab="hotels" onclick="switchAssetsInnerTab('hotels')">
                        <i class="bi bi-building"></i> Hotel Saudi Arabia
                    </button>
                </div>

                <div id="assetsLinksPanel" style="display:block;">
                    <div class="snap-header">
                        <div class="snap-header-title">
                            <i class="bi bi-bookmark-star-fill"></i>
                            <div>
                                <h4>Assets</h4>
                                <span>Link ke dokumen penting (SOP, kontrak, akun cloud, dsb) — mirip bookmark</span>
                            </div>
                        </div>
                        <button class="btn-primary btn-sm" onclick="openAssetModal()" ${canManageAssets() ? '' : 'style="display:none;"'}>
                            <i class="bi bi-plus-lg"></i> Tambah Link
                        </button>
                    </div>
                    <div id="assetsListWrap"></div>
                </div>

                <div id="assetsHotelPanel" style="display:none;">
                    <div class="snap-header">
                        <div class="snap-header-title">
                            <i class="bi bi-building"></i>
                            <div>
                                <h4>Hotel Saudi Arabia</h4>
                                <span>Referensi data hotel — Export CSV untuk diedit, Import CSV untuk memperbarui (data lama diganti)</span>
                            </div>
                        </div>
                        <div class="hotel-header-actions">
                            <button type="button" class="btn-export-subtle hotel-export-btn" id="hotelExportCsvBtn" onclick="exportHotelSaudiCsv()" title="Unduh seluruh data hotel sebagai CSV">
                                <i class="bi bi-filetype-csv"></i> Export CSV
                            </button>
                            <button type="button" class="btn-export-subtle hotel-import-btn" onclick="document.getElementById('hotelImportFile').click()" title="Ganti seluruh data hotel dengan file CSV" ${canManageAssets() ? '' : 'style="display:none;"'}>
                                <i class="bi bi-upload"></i> Import CSV
                            </button>
                            <input type="file" id="hotelImportFile" accept=".csv,text/csv" style="display:none;" onchange="handleHotelImportFile(this)">
                        </div>
                    </div>
                    <div class="hotel-search-bar">
                        <input type="text" id="hotelSaudiSearchInput" placeholder="Cari nama hotel, kota, atau deskripsi..." oninput="handleHotelSaudiSearchInput()">
                        <select id="hotelSaudiCitySelect" onchange="renderHotelSaudiTable()">
                            <option value="">Semua Kota</option>
                        </select>
                    </div>
                    <div id="hotelSaudiWrap"></div>
                </div>
            </div>
        `;

        // Tombol "+ Tambah Program" ditaruh di slot header (sejajar dengan
        // judul "Edit & Tambah Program", rata kanan), bukan di toolbar lagi.
        // Cuma relevan buat subtab Program, jadi visibilitasnya diatur juga
        // di switchAdminSubTab() supaya hilang saat pindah ke subtab lain.
        const headerActionsEl = document.getElementById('adminPageHeaderActions');
        if (headerActionsEl) {
            const unduhListBtn = `<button type="button" class="btn-export-subtle" onclick="downloadProgramListPdf(this)" title="Preview &amp; unduh jadwal umrah (PDF A4 landscape)"><i class="bi bi-file-earmark-pdf-fill"></i> Unduh Daftar Program</button>`;
            headerActionsEl.innerHTML = canEditData
                ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">${unduhListBtn}<button class="btn-primary" onclick="showAdminForm()"><i class="bi bi-plus-lg"></i> Tambah Program</button></div>`
                : `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;"><span class="admin-role-note"><i class="bi bi-eye-fill"></i> Mode lihat saja (Guest)</span></div>`;
            headerActionsEl.style.display = (adminSubTab === 'program') ? '' : 'none';
        }

        // Render tabel & siapkan form untuk role yang boleh mengedit
        renderAdminTable();
        renderCompanyRekeningRows(); renderCompanyKontakWaRows();
        if (canEditData) {
            const dateInput = document.getElementById('admin_tgl_date');
            if (dateInput) {
                dateInput.addEventListener('change', function() {
                    if (this.value) {
                        const [y, m, d] = this.value.split('-');
                        document.getElementById('admin_tgl').value = formatDateToIndonesian(new Date(parseInt(y), parseInt(m) - 1, parseInt(d)));
                    } else {
                        document.getElementById('admin_tgl').value = '';
                    }
                });
            }
        }
    } else {
        // Not logged in
        const titleEl = document.getElementById('adminPageTitle');
        const subtitleEl = document.getElementById('adminPageSubtitle');
        if (titleEl) titleEl.textContent = 'Login';
        if (subtitleEl) subtitleEl.textContent = 'Masuk untuk mengakses fitur pengelolaan';
        container.classList.add('is-login');
        container.innerHTML = getAdminLoginBoxHtml();
        setTimeout(() => {
            const emailInput = document.getElementById('adminEmailInput');
            if (emailInput) emailInput.focus();
        }, 100);
    }
}

function renderAdminTable() {
    const tbody = document.getElementById('adminTableBody');
    if (!tbody) return;
    const canEditData = currentRole === 'admin' || currentRole === 'user';
    const countEl = document.querySelector('.admin-table-head .count');
    // Program expired (tanggal berangkat sudah lewat) ditampilkan di tabel terpisah di bawah tabel utama
    const isAdminProgramExpired = (p) => {
        const d = p.tgl ? parseDateFromString(p.tgl) : null;
        return !!(d && d < new Date());
    };
    const expiredPrograms = adminPrograms.filter(isAdminProgramExpired)
        .sort((a, b) => parseDateFromString(b.tgl) - parseDateFromString(a.tgl)); // yang baru lewat di atas
    const activePrograms = adminPrograms.filter(p => !isAdminProgramExpired(p));
    if (countEl) countEl.textContent = `${activePrograms.length} program`;

    // Dihitung di atas (sebelum banner-banner) karena dipakai baik oleh
    // banner "Duplikat" di bawah maupun badge per-baris nanti di bawahnya.
    const duplikatInfo = computeDuplicateProgramGroups();

    // [POSTER] Card peringatan terpisah (di atas card tabel Daftar Program)
    // kalau ada program yang belum punya link poster sama sekali
    // — tanpa poster, OCR & auto-isi field tidak bisa jalan untuk program itu.
    const noPosterBanner = document.getElementById('adminNoPosterBanner');
    if (noPosterBanner) {
        const noPosterCount = adminPrograms.filter(p => !p.link_poster).length;
        noPosterBanner.innerHTML = noPosterCount > 0
            ? `<div class="admin-notice-card warn">
                    <div class="admin-notice-icon"><i class="bi bi-image"></i></div>
                    <div class="admin-notice-body">
                        <div class="admin-notice-title">${noPosterCount} program belum punya link poster</div>
                        <div class="admin-notice-text">OCR tidak bisa membaca atau mengisi otomatis data untuk program ini. Program ditandai <span class="admin-notice-hl">"Belum ada poster"</span> di tabel di bawah — klik langsung badge-nya untuk menambahkan link poster.</div>
                    </div>
                </div>`
            : '';
    }

    // [CAPTION] Banner peringatan kuning kalau ada program yang Teks WA-nya
    // kosong atau terdeteksi belum lengkap (lihat getProgramsMissingCaption /
    // getProgramsIncompleteCaption / isTeksWaBelumLengkap) -- sama gaya dengan
    // banner "Belum ada poster" di atas, supaya konsisten & gampang dilihat
    // sekilas ada berapa program yang captionnya perlu ditindaklanjuti.
    const noCaptionBanner = document.getElementById('adminNoCaptionBanner');
    if (noCaptionBanner) {
        const kosongCount = getProgramsMissingCaption().length;
        const belumLengkapCount = getProgramsIncompleteCaption().length;
        const totalBermasalah = kosongCount + belumLengkapCount;
        noCaptionBanner.innerHTML = totalBermasalah > 0
            ? `<div class="cx-status-bar warn" style="margin:0 0 14px;">
                    <i class="bi bi-chat-square-text-fill"></i>
                    <div>${kosongCount > 0 ? `${kosongCount} program Teks WA-nya masih kosong` : ''}${kosongCount > 0 && belumLengkapCount > 0 ? ', dan ' : ''}${belumLengkapCount > 0 ? `${belumLengkapCount} program Teks WA-nya belum lengkap (section wajib ada yang hilang)` : ''} — ditandai <span style="color:var(--warn);font-weight:700;">"Caption kosong/belum lengkap"</span> di tabel di bawah. Pakai tombol "Caption Kosong" / "Caption Belum Lengkap" di atas untuk generate massal, atau klik badge-nya untuk perbaiki satu per satu.</div>
                </div>`
            : '';
    }

    // [DUPLIKAT] Banner peringatan kuning kalau ada program yang kembar persis
    // (Nama + Tanggal Berangkat + Harga [semua tipe kamar] + Maskapai sama
    // semua persis dengan program lain -- lihat computeDuplicateProgramGroups()
    // di bawah) -- paling sering kejadian dari broadcast yang kepaste ulang
    // lewat "Tambah Cepat". Sama gaya dengan banner poster & caption di atas.
    const duplikatBanner = document.getElementById('adminDuplikatBanner');
    if (duplikatBanner) {
        const programDuplikatCount = duplikatInfo.size;
        const grupDuplikatCount = new Set([...duplikatInfo.values()].map(v => v.nomor)).size;
        duplikatBanner.innerHTML = programDuplikatCount > 0
            ? `<div class="cx-status-bar warn" style="margin:0 0 14px;">
                    <i class="bi bi-exclamation-triangle-fill"></i>
                    <div>${programDuplikatCount} program terindikasi duplikat dalam ${grupDuplikatCount} kelompok (nama, tanggal berangkat, harga semua tipe kamar & maskapai sama persis) — biasanya kejadian karena teks broadcast yang sama kepaste ulang lewat "Tambah Cepat". Program yang kembar ditandai <span style="color:var(--warn);font-weight:700;">"Duplikat #N"</span> dengan warna &amp; nomor yang sama di tabel di bawah (anggota satu kelompok = warna/nomor sama), dan yang ditambahkan paling terakhir dikasih tambahan <span style="color:var(--warn);font-weight:700;">"· Terbaru"</span> karena itu yang paling perlu dicek/dihapus duluan.</div>
                </div>`
            : '';
    }

    // Kolom Hotel 3 / Hotel 4 hanya ditampilkan kalau ada minimal satu program
    // yang memakainya, supaya tabel tidak melebar tanpa guna untuk program biasa.
    const showHotel3 = adminPrograms.some(p => p.hotel_3);
    const showHotel4 = adminPrograms.some(p => p.hotel_4);
    ['thAdminHotel3', 'thAdminExpHotel3'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = showHotel3 ? '' : 'none'; });
    ['thAdminHotel4', 'thAdminExpHotel4'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = showHotel4 ? '' : 'none'; });
    const extraCols = (showHotel3 ? 1 : 0) + (showHotel4 ? 1 : 0);
    const hotelExtraCell = (p, n) => {
        const nama = hotelNamaSingkat(p[`hotel_${n}`]);
        if (!nama) return '<td>-</td>';
        const kota = p[`hotel_${n}_kota`];
        return `<td>${kota ? `<span style="font-size:10.5px;opacity:.65;display:block;">${escapeHtml(kota)}</span>` : ''}${escapeHtml(nama)}</td>`;
    };

    const expiredCard = document.getElementById('adminExpiredCard');
    const expiredBody = document.getElementById('adminExpiredTableBody');
    if (!adminPrograms.length) {
        tbody.innerHTML = `<tr><td colspan="${(canEditData ? 10 : 9) + extraCols}" style="text-align:center;padding:30px;color:var(--ink-soft);">Belum ada program.${canEditData ? ' Klik "Tambah Program" untuk mulai.' : ''}</td></tr>`;
        if (expiredCard) expiredCard.style.display = 'none';
        return;
    }
    const buildAdminRow = (p) => {
        const pDate = p.tgl ? parseDateFromString(p.tgl) : null;
        const isExpiredRow = !!(pDate && pDate < new Date());
        const expiredBadge = isExpiredRow
            ? `<span class="status-badge full" style="display:inline-flex;margin:4px 0 0;padding:3px 9px;font-size:10.5px;border-radius:20px;gap:5px;"><i class="bi bi-clock-history" style="font-size:10px;"></i>Expired</span>`
            : '';
        const noPoster = !p.link_poster;
        const posterBadge = noPoster
            ? (canEditData
                ? `<button type="button" class="poster-missing-badge" onclick="quickAddPosterLink('${p.id}')" title="Klik untuk langsung tambahkan link poster program ini"><i class="bi bi-image"></i>Belum ada poster<i class="bi bi-plus-lg"></i></button>`
                : `<span class="cx-status-bar warn" style="display:inline-flex;margin:4px 0 0;padding:3px 9px;font-size:10.5px;border-radius:20px;gap:5px;"><i class="bi bi-image" style="font-size:10px;"></i>Belum ada poster</span>`)
            : '';

        // [CAPTION] Badge "Caption kosong" / "Caption belum lengkap" per baris --
        // pola & style sama dengan posterBadge di atas supaya konsisten secara visual.
        const teksWaKosong = !p.teks_wa || !p.teks_wa.trim();
        const teksWaBelumLengkap = !teksWaKosong && isTeksWaBelumLengkap(p);
        let captionBadge = '';
        if (teksWaKosong) {
            captionBadge = canEditData
                ? `<button type="button" class="poster-missing-badge" onclick="quickFixCaption('${p.id}')" title="Klik untuk langsung isi/generate Teks WA program ini"><i class="bi bi-chat-square-text"></i>Caption kosong<i class="bi bi-plus-lg"></i></button>`
                : `<span class="cx-status-bar warn" style="display:inline-flex;margin:4px 0 0;padding:3px 9px;font-size:10.5px;border-radius:20px;gap:5px;"><i class="bi bi-chat-square-text" style="font-size:10px;"></i>Caption kosong</span>`;
        } else if (teksWaBelumLengkap) {
            captionBadge = canEditData
                ? `<button type="button" class="poster-missing-badge" onclick="quickFixCaption('${p.id}')" title="Klik untuk periksa & lengkapi Teks WA program ini"><i class="bi bi-chat-square-text"></i>Caption belum lengkap<i class="bi bi-plus-lg"></i></button>`
                : `<span class="cx-status-bar warn" style="display:inline-flex;margin:4px 0 0;padding:3px 9px;font-size:10.5px;border-radius:20px;gap:5px;"><i class="bi bi-chat-square-text" style="font-size:10px;"></i>Caption belum lengkap</span>`;
        }

        // Tandai program yang punya kembaran (Nama + Tanggal Berangkat + Harga
        // [semua tipe kamar] + Maskapai sama semua persis) -- paling sering
        // kejadian dari broadcast yang kepaste ulang lewat "Tambah Cepat".
        // Semua anggota satu kelompok duplikat dikasih nomor yang SAMA (mis.
        // "Duplikat #1" muncul di 2 baris) supaya langsung ketahuan duplikat
        // sama program yang mana; yang ditambahkan PALING TERAKHIR dikasih
        // tambahan "· Terbaru" karena itu yang paling perlu dicek/dihapus duluan.
        const dupInfo = duplikatInfo.get(String(p.id));
        const duplikatBadge = dupInfo
            ? `<span class="cx-status-bar" style="display:inline-flex;margin:4px 0 0;padding:3px 9px;font-size:10.5px;border-radius:20px;gap:5px;background:${dupInfo.warna.bg};color:${dupInfo.warna.fg};font-weight:${dupInfo.terbaru ? 700 : 600};" title="Nama, Tanggal Berangkat, Harga & Maskapai sama persis dengan program lain berwarna & bernomor sama di tabel ini"><i class="bi bi-exclamation-triangle-fill" style="font-size:10px;"></i>Duplikat #${dupInfo.nomor}${dupInfo.terbaru ? ' &middot; Terbaru' : ''}</span>`
            : '';

        // [BADGE BARU] Sama seperti .new-badge di tabel Program Umroh depan
        // (buildProgramRowHTML) -- dihitung dari created_at, muncul selama 3
        // hari lalu hilang sendiri. Di sini teksnya cuma "Baru" (bukan "Program
        // Baru") karena kolomnya sudah pasti berisi program (beda dari tabel
        // depan yang butuh kata "Program" biar jelas konteksnya).
        const createdAtAdmin = p.created_at ? new Date(p.created_at) : null;
        const umurProgramAdminMs = createdAtAdmin && !isNaN(createdAtAdmin) ? (Date.now() - createdAtAdmin.getTime()) : null;
        const isProgramBaruAdmin = umurProgramAdminMs != null && umurProgramAdminMs >= 0 && umurProgramAdminMs < (3 * 24 * 60 * 60 * 1000);
        const newBadgeAdmin = isProgramBaruAdmin
            ? `<span class="new-badge" style="margin:4px 0 0;" title="Ditambahkan dalam 3 hari terakhir"><i class="bi bi-stars"></i>Baru</span>`
            : '';
        return `
        <tr${isExpiredRow ? ' class="admin-row-expired" style="opacity:.55;"' : ''}>
            <td>
                <strong>${escapeHtml(p.nama||'-')}</strong>
                ${expiredBadge}
                ${newBadgeAdmin}
                ${posterBadge}
                ${captionBadge}
                ${duplikatBadge}
            </td>
            <td>${escapeHtml(p.tgl||'-')}</td>
            <td>${escapeHtml(p.durasi||'-')}</td>
            <td class="col-harga">${escapeHtml(p.harga_quad || p.harga_quint || '-')}</td>
            <td class="col-harga">${escapeHtml(p.harga_triple||'-')}</td>
            <td class="col-harga">${escapeHtml(p.harga_double||'-')}</td>
            <td>${escapeHtml(p.maskapai||'-')}</td>
            <td>${escapeHtml(hotelNamaSingkat(p.hotel_makkah)||'-')}</td>
            <td>${escapeHtml(hotelNamaSingkat(p.hotel_madinah)||'-')}</td>
            ${showHotel3 ? hotelExtraCell(p, 3) : ''}
            ${showHotel4 ? hotelExtraCell(p, 4) : ''}
            ${canEditData ? `
            <td style="text-align:right;">
                <div class="action-btns" style="justify-content:flex-end;">
                    ${p.link_poster ? `<button onclick="refreshPosterProgram('${p.id}')" title="Refresh poster (muat ulang gambar dari Drive + scan ulang OCR)"><i class="bi bi-arrow-clockwise"></i></button>` : ''}
                    <button onclick="editAdminProgram('${p.id}')" title="Edit"><i class="bi bi-pencil-fill"></i></button>
                    <button onclick="openDeleteModal('programs','${p.id}','${escapeJsAttr(p.nama)}')" class="danger" title="Hapus"><i class="bi bi-trash-fill"></i></button>
                </div>
            </td>
            ` : ''}
        </tr>
    `;
    };
    tbody.innerHTML = activePrograms.length
        ? activePrograms.map(buildAdminRow).join('')
        : `<tr><td colspan="${(canEditData ? 10 : 9) + extraCols}" style="text-align:center;padding:30px;color:var(--ink-soft);">Tidak ada program aktif. Semua program sudah expired (lihat tabel Program Expired di bawah).</td></tr>`;
    if (expiredCard && expiredBody) {
        expiredCard.style.display = expiredPrograms.length ? '' : 'none';
        const expCountEl = document.getElementById('adminExpiredCount');
        if (expCountEl) expCountEl.textContent = `${expiredPrograms.length} program`;
        expiredBody.innerHTML = expiredPrograms.map(buildAdminRow).join('');
    }
}

// ============================================================
// 14. ADMIN CRUD OPERATIONS
// ============================================================
// Bongkar kolom JSON admin_data_lengkap (harga_quad/triple/double, hotel, makan, dll)
// ke level atas object program, supaya bisa langsung dipakai di tabel & form.
function unpackProgramAdminData(row) {
    if (!row) return row;
    if (row.admin_data_lengkap) {
        try {
            const adl = typeof row.admin_data_lengkap === 'string' ? JSON.parse(row.admin_data_lengkap) : row.admin_data_lengkap;
            return { ...row, ...adl };
        } catch (e) { /* biarkan row apa adanya kalau JSON rusak */ }
    }
    return row;
}

async function ensureAdminProgramPageReady() {
    const needsOpen = document.getElementById('adminPageView').style.display === 'none' || !document.getElementById('adminFormContainer');
    if (needsOpen) {
        await openAdminPanel('program');
    } else if (adminSubTab !== 'program') {
        switchAdminSubTab('program');
    }
}

async function showAdminForm() {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk menambah program', 'error'); return; }
    await ensureAdminProgramPageReady();
    editingProgramId = null;
    setAdminFormData({}); // bersihkan sisa data dari sesi edit sebelumnya
    cxClearAutofillHighlight(); // bersihkan sisa highlight kuning dari sesi form sebelumnya
    // Muat data referensi Hotel Saudi Arabia di background (non-blocking) supaya
    // hint di field Hotel Makkah/Madinah sudah siap begitu admin mulai mengetik.
    ensureHotelReferenceLoaded();
    ensureHotelDetailsLoaded();
    // Bersihkan juga sisa teks broadcast dari sesi tambah program sebelumnya,
    // supaya kotak referensi tidak menampilkan broadcast program lain.
    const bcInput = document.getElementById('parseBroadcastInput');
    if (bcInput) bcInput.value = '';
    syncBroadcastRefBox();
    document.getElementById('adminFormTitle').innerText = 'Tambah Program Baru';
    document.getElementById('adminFormContainer').style.display = 'block';
    document.getElementById('adminFormContainer').scrollIntoView({ behavior: 'smooth' });
    focusAdminFormAndSnapshot();
    setupAdminFormAnchorNav();
}

// ============================================================
// 13b. TAMBAH PROGRAM CEPAT (shortcut tombol "Tambah" di topbar)
// ============================================================
// Paste teks broadcast -> Isi Otomatis + Simpan sekaligus dalam 1 klik.
// Modal ini cuma "wajah" tampilan -- di baliknya tetap memakai form Tambah
// Program yang sudah ada (disembunyikan, display:none) sebagai mesin isi-
// otomatis (parseBroadcastText()) & simpan (saveAdminProgram()), supaya
// semua field lain (harga, hotel, termasuk/tidak termasuk, dll) tetap ikut
// tersimpan persis seperti alur Tambah Program biasa.
async function openQuickAddProgramModal() {
    if (!canQuickAddProgram()) { showToast('Fitur Tambah Cepat khusus admin', 'error'); return; }

    const modal = document.getElementById('quickAddProgramModal');
    const input = document.getElementById('quickAddBroadcastInput');
    const saveBtn = document.getElementById('quickAddProgramSaveBtn');
    input.value = '';
    saveBtn.disabled = true;
    input.placeholder = 'Menyiapkan form...';
    modal.classList.add('open'); // tampilkan modal DULU, baru siapkan form di baliknya

    // Siapkan form Tambah Program di background (tersembunyi di balik modal ini)
    await ensureAdminProgramPageReady();
    editingProgramId = null;
    setAdminFormData({}); // bersihkan sisa data dari sesi sebelumnya
    cxClearAutofillHighlight();
    const bcInput = document.getElementById('parseBroadcastInput');
    if (bcInput) bcInput.value = '';
    syncBroadcastRefBox();

    // Modal bisa saja sudah ditutup pengguna sebelum persiapan di atas selesai
    if (!modal.classList.contains('open')) return;
    input.placeholder = 'Paste teks broadcast di sini...';
    saveBtn.disabled = false;
    input.focus();
}

function closeQuickAddProgramModal() {
    document.getElementById('quickAddProgramModal').classList.remove('open');
    closeAdminPanel(); // kembalikan tampilan ke tab dashboard semula
}

// Deteksi program duplikat -- kriteria "ketat": Nama + Tanggal Berangkat +
// Harga (Quint/Quad/Triple/Double) + Maskapai harus sama semua baru dianggap
// duplikat. Dipakai jalur "Tambah Cepat" supaya broadcast yang kepaste ulang
// (atau sudah pernah diinput admin lain, dengan harga & maskapai yang juga
// sama) tidak diam-diam kesimpan jadi 2 baris program yang sama.
function normalizeProgramNameForDup(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
// Harga tersimpan sebagai string berformat ("Rp 12.345.000") -- ambil angkanya
// saja supaya "Rp 12.345.000" & "12345000" dianggap nilai yang sama.
function normalizeHargaForDup(s) {
    return (s || '').replace(/[^\d]/g, '');
}
// Bangun 1 kunci pembanding dari kombinasi Nama+Tanggal+Harga(4 tipe kamar)+Maskapai.
// Program tanpa Nama/Tanggal tidak pernah dianggap "punya kunci" (null) supaya
// baris kosong/belum lengkap tidak ikut kehitung saling duplikat satu sama lain.
function getDuplicateKey(p) {
    if (!p || !p.nama || !(p.tgl || '').trim()) return null;
    return [
        normalizeProgramNameForDup(p.nama),
        (p.tgl || '').trim(),
        normalizeHargaForDup(p.harga_quint),
        normalizeHargaForDup(p.harga_quad),
        normalizeHargaForDup(p.harga_triple),
        normalizeHargaForDup(p.harga_double),
        normalizeProgramNameForDup(p.maskapai)
    ].join('|');
}
function findDuplicateProgram(formData, excludeId) {
    const key = getDuplicateKey(formData);
    if (!key) return null;
    return (dataUmroh || []).find(p => {
        if (excludeId && String(p.id) === String(excludeId)) return false;
        return getDuplicateKey(p) === key;
    }) || null;
}

// Palet warna badge duplikat -- tiap kelompok duplikat kebagian 1 warna beda
// (dirotasi kalau kelompoknya lebih banyak dari jumlah warna), supaya kembaran
// program bisa langsung dikenali sekilas dari warnanya, tidak cuma dari angka.
const WARNA_BADGE_DUPLIKAT = [
    { bg: '#fee2e2', fg: '#991b1b' }, // merah
    { bg: '#dbeafe', fg: '#1e40af' }, // biru
    { bg: '#fef3c7', fg: '#92400e' }, // amber
    { bg: '#dcfce7', fg: '#166534' }, // hijau
    { bg: '#f3e8ff', fg: '#6b21a8' }, // ungu
    { bg: '#ffe4e6', fg: '#9f1239' }, // rose
    { bg: '#e0f2fe', fg: '#075985' }, // biru langit
    { bg: '#fef9c3', fg: '#854d0e' }, // kuning
];

// Kelompokkan seluruh program di dataUmroh yang kunci duplikatnya sama persis
// (Nama+Tanggal+Harga+Maskapai), lalu kasih nomor urut + warna per kelompok
// (1, 2, 3, ...) -- supaya badge "Duplikat #<nomor>" di tabel Admin bisa
// saling menunjuk: program yang duplikat & program rujukannya ditandai nomor
// DAN warna yang SAMA, jadi langsung ketahuan duplikat itu kembarannya program
// yang mana. created_at dipakai buat nentuin mana yang "Terbaru" (ditambahkan
// paling akhir) di tiap kelompok. Return: Map id(String) -> { nomor, terbaru, warna }.
function computeDuplicateProgramGroups() {
    const groupsByKey = new Map();
    (dataUmroh || []).forEach(p => {
        const key = getDuplicateKey(p);
        if (!key) return;
        if (!groupsByKey.has(key)) groupsByKey.set(key, []);
        groupsByKey.get(key).push(p);
    });

    const infoById = new Map();
    let nomorUrut = 0;
    groupsByKey.forEach(grup => {
        if (grup.length < 2) return; // bukan duplikat, cuma 1 program dengan kombinasi ini
        nomorUrut++;
        const warna = WARNA_BADGE_DUPLIKAT[(nomorUrut - 1) % WARNA_BADGE_DUPLIKAT.length];
        const waktuTambah = x => x.created_at ? new Date(x.created_at).getTime() : 0;
        const palingAkhir = grup.reduce((a, b) => (waktuTambah(b) >= waktuTambah(a) ? b : a));
        grup.forEach(p => {
            infoById.set(String(p.id), { nomor: nomorUrut, terbaru: String(p.id) === String(palingAkhir.id), warna });
        });
    });
    return infoById;
}

async function quickSaveProgramFromBroadcast() {
    const input = document.getElementById('quickAddBroadcastInput');
    const text = (input.value || '').trim();
    if (!text) { showToast('Paste teks broadcast dulu', 'error'); return; }

    const bcInput = document.getElementById('parseBroadcastInput');
    if (!bcInput) { showToast('Form belum siap, coba lagi sebentar', 'error'); return; }
    bcInput.value = text;
    parseBroadcastText();

    // Cek duplikat SEBELUM disimpan (Nama + Tanggal Berangkat + Harga [semua
    // tipe kamar] + Maskapai sama semua persis dengan program yang sudah ada)
    // -- kalau ketemu, tandai & minta konfirmasi dulu supaya tidak diam-diam
    // tersimpan dobel.
    const formDataCekDup = getAdminFormData();
    const programDuplikat = findDuplicateProgram(formDataCekDup, editingProgramId);
    if (programDuplikat) {
        const hargaDup = programDuplikat.harga_quint || programDuplikat.harga_quad || programDuplikat.harga_triple || programDuplikat.harga_double;
        const tetapSimpan = await openActionConfirm({
            title: 'Program Duplikat Terdeteksi',
            message: `Sudah ada program dengan Nama, Tanggal Berangkat, Harga &amp; Maskapai yang sama persis:<br>`
                + `<strong>${escapeHtml(programDuplikat.nama || '-')}</strong><br>`
                + `<i class="bi bi-calendar-event"></i> ${escapeHtml(programDuplikat.tgl || '-')}`
                + `${hargaDup ? ' &middot; ' + escapeHtml(hargaDup) : ''}`
                + `${programDuplikat.maskapai ? ' &middot; ' + escapeHtml(programDuplikat.maskapai) : ''}`
                + `<br><br>Tetap simpan teks broadcast ini sebagai program baru (duplikat)?`,
            confirmLabel: 'Simpan Sebagai Duplikat',
            danger: true
        });
        if (!tetapSimpan) return; // batal -> modal Tambah Cepat tetap terbuka, teks broadcast tidak hilang
    }

    const saveBtn = document.getElementById('quickAddProgramSaveBtn');
    const originalLabel = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Menyimpan...';
    const ok = await saveAdminProgram();
    saveBtn.disabled = false;
    saveBtn.innerHTML = originalLabel;

    if (ok) closeQuickAddProgramModal(); // gagal -> modal tetap terbuka, toast error sudah ditampilkan
}

// Esc = batal, Ctrl/Cmd+Enter = simpan (dari textarea sudah ditangani onkeydown-nya sendiri)
document.addEventListener('keydown', function(e) {
    const modal = document.getElementById('quickAddProgramModal');
    if (!modal || !modal.classList.contains('open')) return;
    if (e.key === 'Escape') closeQuickAddProgramModal();
});

// ---- Anchor-nav sticky di dalam form Tambah/Edit Program: supaya kalau
// salah isi di section atas (mis. Harga) user bisa lompat langsung ke situ
// tanpa scroll manual, dan tombolnya menyorot section mana yang sedang
// terlihat (via IntersectionObserver) saat user scroll manual. ----
let _adminAnchorObserver = null;
const ADMIN_ANCHOR_SECTION_IDS = ['af-info', 'af-harga', 'af-akomodasi', 'af-link', 'af-konten'];

function scrollToAdminSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const stickyGroup = document.querySelector('.admin-form-stickygroup');
    const offset = (stickyGroup ? stickyGroup.offsetHeight : 0) + 12;
    const top = window.scrollY + el.getBoundingClientRect().top - offset;
    window.scrollTo({ top, behavior: 'smooth' });
}

function setupAdminFormAnchorNav() {
    teardownAdminFormAnchorNav();
    const nav = document.getElementById('adminFormAnchorNav');
    if (!nav || typeof IntersectionObserver === 'undefined') return;
    const sections = ADMIN_ANCHOR_SECTION_IDS.map(id => document.getElementById(id)).filter(Boolean);
    if (!sections.length) return;
    _adminAnchorObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const btn = nav.querySelector(`[data-target="${entry.target.id}"]`);
            if (!btn) return;
            nav.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    }, { root: null, rootMargin: '-110px 0px -70% 0px', threshold: 0 });
    sections.forEach(s => _adminAnchorObserver.observe(s));
}

function teardownAdminFormAnchorNav() {
    if (_adminAnchorObserver) { _adminAnchorObserver.disconnect(); _adminAnchorObserver = null; }
}

// Simpan "snapshot" nilai form saat dibuka, untuk deteksi perubahan belum tersimpan
let _adminFormSnapshot = '';
function focusAdminFormAndSnapshot() {
    setTimeout(() => {
        document.getElementById('admin_nama')?.focus();
        _adminFormSnapshot = JSON.stringify(getAdminFormData());
    }, 50);
}
function isAdminFormDirty() {
    const container = document.getElementById('adminFormContainer');
    if (!container || container.style.display === 'none') return false;
    return JSON.stringify(getAdminFormData()) !== _adminFormSnapshot;
}

async function hideAdminForm(skipConfirm) {
    if (!skipConfirm && isAdminFormDirty()) {
        const ok = await openActionConfirm({
            title: 'Perubahan Belum Disimpan',
            message: 'Ada perubahan yang belum disimpan. Tutup form dan buang perubahan?',
            confirmLabel: 'Buang Perubahan',
            danger: true
        });
        if (!ok) return;
    }
    document.getElementById('adminFormContainer').style.display = 'none';
    teardownAdminFormAnchorNav();
    cxClearAutofillHighlight();
}

// Shortcut keyboard saat form Tambah/Edit Program terbuka: Esc = batal, Ctrl/Cmd+Enter = simpan
document.addEventListener('keydown', function(e) {
    const container = document.getElementById('adminFormContainer');
    if (!container || container.style.display === 'none') return;
    if (e.key === 'Escape') { hideAdminForm(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveAdminProgram(); }
});

// ------------------------------------------------------------
// Hotel ke-3 & ke-4 (opsional) -- untuk program yang menginap di lebih dari
// 2 hotel (mis. 2 hotel di Makkah, atau ada hotel transit di Jeddah).
// Field Hotel Makkah & Hotel Madinah TIDAK berubah. Hotel tambahan disimpan di
// admin_data_lengkap (JSON) sebagai hotel_3 / hotel_3_kota / hotel_4 /
// hotel_4_kota, jadi TIDAK perlu migrasi SQL. Baris Hotel 3/4 di form
// tersembunyi sampai ada isinya (hasil parse broadcast/AI, data tersimpan,
// atau tombol "Tambah Hotel 3/4").
// ------------------------------------------------------------
const ADMIN_HOTEL_EXTRA_SLOTS = [3, 4];
const ADMIN_HOTEL_EXTRA_KOTA = ['Makkah', 'Madinah', 'Jeddah', 'Thaif', 'Transit'];

function normalizeHotelKota(k) {
    const t = String(k || '').toLowerCase();
    if (/m[ae]k+ah|mecca/.test(t)) return 'Makkah';
    if (/mad[iy]nah|medina/.test(t)) return 'Madinah';
    if (/jedd?ah/.test(t)) return 'Jeddah';
    if (/tha?if/.test(t)) return 'Thaif';
    if (/transit/.test(t)) return 'Transit';
    return '';
}

// Data referensi hotel (hotel_saudi_arabia) cuma punya Makkah & Madinah,
// jadi hint ejaan hanya dipakai untuk dua kota itu.
function adminHotelExtraRefCity(n) {
    const k = (document.getElementById(`admin_hotel_${n}_kota`)?.value || '').toLowerCase();
    return (k === 'makkah' || k === 'madinah') ? k : null;
}

function updateAdminHotelExtraHint(n) {
    const hintEl = document.getElementById(`hotelRefHint_${n}`);
    const city = adminHotelExtraRefCity(n);
    if (!city) { if (hintEl) { hintEl.className = 'hotel-ref-hint'; hintEl.innerHTML = ''; } return; }
    updateHotelRefHint(`admin_hotel_${n}`, `hotelRefHint_${n}`, city);
}

function handleHotelExtraInput(n) {
    const city = adminHotelExtraRefCity(n);
    if (!city) { updateAdminHotelExtraHint(n); return; }
    handleHotelRefInput(`admin_hotel_${n}`, `hotelRefHint_${n}`, city);
}

function syncAdminHotelExtraButton() {
    const btn = document.getElementById('btnAddHotelExtra');
    if (!btn) return;
    const next = ADMIN_HOTEL_EXTRA_SLOTS.find(n => {
        const el = document.getElementById(`adminHotelExtra${n}`);
        return el && el.style.display === 'none';
    });
    btn.style.display = next ? '' : 'none';
    if (next) btn.innerHTML = `<i class="bi bi-plus-lg"></i> Tambah Hotel ${next}`;
}

function setAdminHotelExtraVisible(n, show) {
    const el = document.getElementById(`adminHotelExtra${n}`);
    if (el) el.style.display = show ? '' : 'none';
    syncAdminHotelExtraButton();
}

function addAdminHotelExtra() {
    const next = ADMIN_HOTEL_EXTRA_SLOTS.find(n => document.getElementById(`adminHotelExtra${n}`)?.style.display === 'none');
    if (!next) return;
    setAdminHotelExtraVisible(next, true);
    document.getElementById(`admin_hotel_${next}`)?.focus();
}

// Isi Hotel 3/4 dari data tersimpan (dipanggil setAdminFormData).
function setAdminHotelExtraFromData(data) {
    data = data || {};
    ADMIN_HOTEL_EXTRA_SLOTS.forEach(n => {
        const inputEl = document.getElementById(`admin_hotel_${n}`);
        const kotaEl = document.getElementById(`admin_hotel_${n}_kota`);
        if (inputEl) inputEl.value = data[`hotel_${n}`] || '';
        if (kotaEl) kotaEl.value = data[`hotel_${n}_kota`] || '';
    });
    setAdminHotelExtraVisible(3, !!(data.hotel_3 || data.hotel_4));
    setAdminHotelExtraVisible(4, !!data.hotel_4);
    ADMIN_HOTEL_EXTRA_SLOTS.forEach(n => updateAdminHotelExtraHint(n));
}

// Terapkan hotel tambahan hasil parse (regex/AI) ke form.
// extras = [{ kota, nama }] -- nama sudah gabungan "Nama (X malam, jarak)".
function applyHotelExtrasToForm(extras) {
    (extras || []).slice(0, ADMIN_HOTEL_EXTRA_SLOTS.length).forEach((h, idx) => {
        if (!h || !h.nama) return;
        const n = ADMIN_HOTEL_EXTRA_SLOTS[idx];
        const inputEl = document.getElementById(`admin_hotel_${n}`);
        const kotaEl = document.getElementById(`admin_hotel_${n}_kota`);
        if (inputEl) inputEl.value = h.nama;
        if (kotaEl) kotaEl.value = ADMIN_HOTEL_EXTRA_KOTA.includes(h.kota) ? h.kota : '';
        setAdminHotelExtraVisible(n, true);
        ensureHotelReferenceLoaded().then(() => updateAdminHotelExtraHint(n));
    });
}

// Bentuk field hotel_3/hotel_3_kota/hotel_4/hotel_4_kota dari daftar extras,
// untuk digabung ke data yang dikirim ke generateAutoWAText().
function hotelExtraDataFields(extras) {
    const out = {};
    ADMIN_HOTEL_EXTRA_SLOTS.forEach((n, idx) => {
        const h = extras && extras[idx];
        if (h && h.nama) { out[`hotel_${n}`] = h.nama; out[`hotel_${n}_kota`] = h.kota || ''; }
    });
    return out;
}

// Cari SEMUA hotel di teks broadcast (bukan cuma Makkah & Madinah pertama).
// Dukung 2 format yang sama dengan parseBroadcastText():
//   inline : "Hotel Makkah: Nama Hotel"
//   header : "HOTEL MAKKAH 3HR" / baris berikutnya nama / (opsional) baris jarak
// Kota yang dikenali: Makkah, Madinah, Jeddah, Thaif, Transit. Polanya sengaja
// ketat (satu baris penuh) supaya baris seperti "Hotel bintang 5" di daftar
// fasilitas tidak ikut terbaca sebagai hotel.
// Return: [{ kota, nama, hari, jarak }] sesuai urutan kemunculan.
function extractBroadcastHotels(lines) {
    const cleanAll = s => String(s || '').replace(/\*/g, '').trim();
    const KOTA = 'm[ae]k+ah|mad[iy]nah|jedd?ah|tha?if|transit';
    const HARI = '(?:hr|h|hari|malam|night|n)';
    const reInline = new RegExp('^[^a-z0-9]*hotel\\s*(' + KOTA + ')\\s*([^:\\-\\n]{0,20})[:\\-]\\s*(\\S.*)$', 'i');
    const reHeader = new RegExp('^[^a-z0-9]*hotel\\s*(' + KOTA + ')\\s*(?:\\(?\\s*(\\d+)\\s*' + HARI + '\\b\\)?)?\\s*[:\\-]?\\s*$', 'i');
    const reHari = new RegExp('(\\d+)\\s*' + HARI + '\\b', 'i');
    const parseJarak = (txt) => {
        const t = String(txt || '');
        const m = t.match(/\(([^)]*(?:m|km|meter)[^)]*)\)/i) || t.match(/(\d+\s*m[^,\n]*(?:jalan|menit)[^,\n]*)/i);
        return m ? m[1].trim() : '';
    };
    const isHotelLine = s => reInline.test(s) || reHeader.test(s);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const lc = cleanAll(lines[i]);
        let m = lc.match(reInline);
        if (m) {
            const hari = (m[2].match(reHari) || [])[1] || '';
            out.push({ kota: normalizeHotelKota(m[1]), nama: m[3].trim(), hari, jarak: '' });
            continue;
        }
        m = lc.match(reHeader);
        if (m && i + 1 < lines.length) {
            const namaLine = cleanAll(lines[i + 1]);
            if (!namaLine || isHotelLine(namaLine)) continue;
            const jarak = (i + 2 < lines.length) ? parseJarak(lines[i + 2]) : '';
            out.push({ kota: normalizeHotelKota(m[1]), nama: namaLine, hari: m[2] || '', jarak });
            i += jarak ? 2 : 1;
        }
    }
    return out;
}

// Buang hotel yang sudah jadi Hotel Makkah/Madinah utama (dan duplikat), sisanya
// = hotel tambahan. Dicocokkan lewat nama murni (tanpa "(X malam...)" / "/ setaraf").
function pickExtraHotels(entries, knownNames) {
    const key = s => String(s || '').toLowerCase().split('(')[0].split('/')[0].replace(/[^a-z0-9]/g, '');
    const seen = new Set((knownNames || []).map(key).filter(Boolean));
    const extras = [];
    (entries || []).forEach(h => {
        const k = key(h.nama);
        if (!k || seen.has(k)) return;
        seen.add(k);
        extras.push(h);
    });
    return extras;
}

function getAdminFormData() {
    return {
        nama: document.getElementById('admin_nama')?.value.trim() || '',
        tgl: document.getElementById('admin_tgl')?.value || '',
        durasi: document.getElementById('admin_durasi')?.value || '',
        maskapai: document.getElementById('admin_maskapai')?.value || '',
        kuota_pax: parseInt(document.getElementById('admin_kuota_pax')?.value, 10) || 45,
        harga_quint: document.getElementById('admin_harga_quint')?.value || '',
        harga_quad: document.getElementById('admin_harga_quad')?.value || '',
        harga_triple: document.getElementById('admin_harga_triple')?.value || '',
        harga_double: document.getElementById('admin_harga_double')?.value || '',
        hotel_makkah: document.getElementById('admin_hotel_makkah')?.value || '',
        hotel_madinah: document.getElementById('admin_hotel_madinah')?.value || '',
        // Hotel ke-3 & ke-4 (opsional). Kota hanya ikut tersimpan kalau hotelnya terisi.
        hotel_3: document.getElementById('admin_hotel_3')?.value || '',
        hotel_3_kota: (document.getElementById('admin_hotel_3')?.value ? document.getElementById('admin_hotel_3_kota')?.value : '') || '',
        hotel_4: document.getElementById('admin_hotel_4')?.value || '',
        hotel_4_kota: (document.getElementById('admin_hotel_4')?.value ? document.getElementById('admin_hotel_4_kota')?.value : '') || '',
        link_poster: document.getElementById('admin_link_poster')?.value || '',
        link_itinerary: document.getElementById('admin_link_itinerary')?.value || '',
        termasuk: document.getElementById('admin_termasuk')?.value || '',
        tidak_termasuk: document.getElementById('admin_tidak_termasuk')?.value || '',
        catatan_cx: document.getElementById('admin_catatan_cx')?.value || '',
        teks_wa: document.getElementById('admin_teks_wa')?.value || ''
    };
}

function setAdminFormData(data) {
    document.getElementById('admin_nama').value = data.nama || '';
    document.getElementById('admin_tgl').value = data.tgl || '';
    const dateInput = document.getElementById('admin_tgl_date');
    if (dateInput) {
        if (data.tgl) {
            const parsed = parseDateFromString(data.tgl);
            dateInput.value = (parsed && !isNaN(parsed.getTime()))
                ? `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
                : '';
        } else {
            dateInput.value = '';
        }
    }
    document.getElementById('admin_durasi').value = data.durasi || '';
    if (data.maskapai) document.getElementById('admin_maskapai').value = data.maskapai;
    document.getElementById('admin_kuota_pax').value = data.kuota_pax || 45;
    document.getElementById('admin_harga_quint').value = data.harga_quint || '';
    document.getElementById('admin_harga_quad').value = data.harga_quad || '';
    document.getElementById('admin_harga_triple').value = data.harga_triple || '';
    document.getElementById('admin_harga_double').value = data.harga_double || '';
    // Rapikan nilai harga lama yang tersimpan plain (mis. "42500000") jadi
    // "Rp 42.500.000" begitu modal dibuka, biar konsisten dengan hasil ketikan baru.
    ['admin_harga_quint', 'admin_harga_quad', 'admin_harga_triple', 'admin_harga_double'].forEach(id => {
        formatRupiahInput(document.getElementById(id));
    });
    document.getElementById('admin_hotel_makkah').value = data.hotel_makkah || '';
    document.getElementById('admin_hotel_madinah').value = data.hotel_madinah || '';
    setAdminHotelExtraFromData(data);
    document.getElementById('admin_link_poster').value = data.link_poster || '';
    document.getElementById('admin_link_itinerary').value = data.link_itinerary || '';
    document.getElementById('admin_termasuk').value = data.termasuk || '';
    document.getElementById('admin_tidak_termasuk').value = data.tidak_termasuk || '';
    document.getElementById('admin_catatan_cx').value = data.catatan_cx || '';
    document.getElementById('admin_teks_wa').value = data.teks_wa || '';
    updateWaCaptionGauge(data.teks_wa || '');
    autoGrowTextarea(document.getElementById('admin_teks_wa'));
}

// Guard: hanya role 'admin' & 'user' yang boleh tambah/edit/hapus data program
function canManageProgramData() {
    return adminLoggedIn && (currentRole === 'admin' || currentRole === 'user');
}

// Guard KHUSUS "Tambah Cepat" (topbar kanan atas): berbeda dari
// canManageProgramData() -- role 'user' TIDAK diberi izin walau boleh
// tambah/edit program lewat form biasa. Hanya 'admin' yang boleh pakai
// jalur cepat (paste broadcast langsung tersimpan) ini.
function canQuickAddProgram() {
    return adminLoggedIn && currentRole === 'admin';
}

// Guard KHUSUS Assets: berbeda dari canManageProgramData() -- di sini role
// 'user' (editor) SENGAJA TIDAK diberi izin tambah/edit/hapus walau menu
// "Assets" boleh diaktifkan untuknya lewat Akses Menu per Role (dia cuma
// boleh lihat & buka link, bukan mengelola). Hanya 'admin' yang boleh
// menambah/mengedit/menghapus. Dikunci juga di level RLS (bukan cuma UI
// ini) -- lihat sql/36_kunci_assets_admin_saja.sql.
function canManageAssets() {
    return adminLoggedIn && currentRole === 'admin';
}

// Sembunyikan tombol tambah data (Jadwal Tamu, Data Jamaah, Program) dari guest/publik yang belum login
function applyRoleUIVisibility() {
    const canEdit = canManageProgramData();
    const btnJadwal = document.getElementById('btnTambahJadwal');
    const btnProgram = document.getElementById('btnTambahProgram');
    if (btnJadwal) btnJadwal.style.display = canEdit ? '' : 'none';
    if (btnProgram) btnProgram.style.display = canQuickAddProgram() ? '' : 'none';
    // Tile Microblog: tampil untuk semua (guest & anonim juga), data dari view publik `microblog_publik`
    const tileMb = document.getElementById('metricMicroblog');
    if (tileMb) tileMb.style.display = '';
    refreshMicroblogMetric();
}

// ============================================================
// 12c. SIDEBAR NAV — tampilan menu sidebar menyesuaikan role
// ============================================================
// guest / belum login : hanya "Program Umroh" & "Unggulan"
// user  (sudah login)  : + menu yang diizinkan lewat Userman > Akses Menu Sidebar
// admin (sudah login)  : SELALU akses penuh ke semua menu (dihardcode, tidak
//                         bisa dikunci lewat pengaturan supaya admin tidak
//                         bisa mengunci akses dirinya sendiri secara tidak sengaja)
//
// Daftar semua menu sidebar yang bisa dikonfigurasi per role (role "admin"
// tidak perlu diatur di sini karena selalu penuh). `key` HARUS sama persis
// dengan atribut data-tab / data-subtab pada tombol nav di index.html.
const SIDEBAR_MENU_REGISTRY = NAV_MENU.flatMap(sec => sec.items
    .filter(it => it.reg)
    .map(it => ({ key: it.tab || it.subtab, label: it.reg.label || it.text, group: it.reg.group })));
const SIDEBAR_MENU_CONFIGURABLE_ROLES = ['user', 'guest'];

// Cache hasil baca tabel role_menu_access: { user: Set(menu_key...), guest: Set(...) }.
// null = belum pernah dimuat ATAU migrasinya belum dijalankan (tabel belum ada) --
// dalam kondisi ini renderSidebarNav() FALLBACK ke perilaku lama (nav-loggedin-only
// utk user/guest, nav-admin-only cuma admin) supaya dashboard yang belum di-migrasi
// tidak rusak tampilannya.
let roleMenuAccessMap = null;
let roleMenuAccessLoadedOnce = false;

async function loadRoleMenuAccess(forceReload = false) {
    if (roleMenuAccessLoadedOnce && !forceReload) return roleMenuAccessMap;
    try {
        const { data, error } = await supabaseClient.from('role_menu_access').select('role, menu_key, allowed');
        if (error) throw error;
        const map = { user: new Set(), guest: new Set() };
        (data || []).forEach(row => {
            if (row.allowed && map[row.role]) map[row.role].add(row.menu_key);
        });
        roleMenuAccessMap = map;
    } catch (err) {
        // Tabel belum ada (migrasi sql/33_tambah_akses_menu_role.sql belum dijalankan)
        // atau gagal koneksi -- diamkan saja & pakai fallback lama, jangan sampai
        // memutus render sidebar cuma karena fitur ini belum di-setup.
        console.warn('loadRoleMenuAccess: pakai fallback lama —', err.message);
        roleMenuAccessMap = null;
    }
    roleMenuAccessLoadedOnce = true;
    return roleMenuAccessMap;
}

// Cache override akses menu PER AKUN (bukan per role) dari tabel
// user_menu_access -- lihat sql/34_tambah_akses_menu_user.sql. Beda dari
// roleMenuAccessMap (di-cache utk SEMUA role sekaligus), cache ini cuma
// menyimpan override milik akun yang sedang login saja: { menu_key: true/false }.
// undefined utk sebuah menu_key = tidak ada override, ikuti role_menu_access.
// null = belum pernah dimuat ATAU migrasinya belum dijalankan (tabel belum
// ada) -- dalam kondisi ini dianggap "tidak ada override sama sekali",
// jadi perilaku lama (murni per role) tidak berubah.
let userMenuAccessMap = null;
let userMenuAccessLoadedForUserId = null;

async function loadUserMenuAccess(forceReload = false) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const uid = session?.user?.id || null;
    if (!uid) { userMenuAccessMap = null; userMenuAccessLoadedForUserId = null; return null; }
    if (userMenuAccessLoadedForUserId === uid && !forceReload) return userMenuAccessMap;
    try {
        const { data, error } = await supabaseClient.from('user_menu_access').select('menu_key, allowed').eq('user_id', uid);
        if (error) throw error;
        const map = {};
        (data || []).forEach(row => { map[row.menu_key] = !!row.allowed; });
        userMenuAccessMap = map;
    } catch (err) {
        // Tabel belum ada (migrasi sql/34_tambah_akses_menu_user.sql belum
        // dijalankan) atau gagal koneksi -- diamkan saja, anggap tidak ada
        // override individual sama sekali (fallback penuh ke role).
        console.warn('loadUserMenuAccess: pakai fallback role saja —', err.message);
        userMenuAccessMap = null;
    }
    userMenuAccessLoadedForUserId = uid;
    return userMenuAccessMap;
}

// Minimize sidebar jadi ikon saja (desktop). Preferensi disimpan di localStorage
// supaya tetap ciut/lebar yang sama tiap kali dashboard dibuka lagi.
const SIDEBAR_COLLAPSE_KEY = 'amiru_sidebar_collapsed';
function applySidebarCollapse(collapsed) {
    document.getElementById('sidebar')?.classList.toggle('collapsed', collapsed);
    document.querySelector('.app')?.classList.toggle('sidebar-collapsed', collapsed);
    const btn = document.getElementById('sidebarCollapseBtn');
    if (btn) btn.title = collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar';
}
function toggleSidebarCollapse() {
    const collapsed = !document.getElementById('sidebar')?.classList.contains('collapsed');
    applySidebarCollapse(collapsed);
    try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) {}
}
(function initSidebarCollapse() {
    let saved = '0';
    try { saved = localStorage.getItem(SIDEBAR_COLLAPSE_KEY) || '0'; } catch (e) {}
    if (saved === '1') applySidebarCollapse(true);
})();

async function renderSidebarNav() {
    const loggedIn = !!adminLoggedIn;
    const isAdminRole = loggedIn && currentRole === 'admin';
    const roleLabels = { admin: 'Admin', user: 'User', guest: 'Guest' };
    // Penanda belum login: dipakai CSS untuk menampilkan nama perusahaan vertikal saat sidebar ciut
    document.getElementById('sidebar')?.classList.toggle('is-guest', !loggedIn);

    // Elemen tanpa data-tab/data-subtab (mis. label section "Navigasi") tidak
    // digating di sini secara individual dulu -- hanya tombol nav yang punya
    // salah satu atribut itu yang diperiksa lewat konfigurasi per role.
    let allowedSet = null; // null = fallback lama, Set = daftar menu_key yang boleh
    let userOverride = null; // { menu_key: true/false } override akun ini, atau null
    if (loggedIn && !isAdminRole) {
        const map = await loadRoleMenuAccess();
        allowedSet = map ? (map[currentRole] || new Set()) : null;
        userOverride = await loadUserMenuAccess();
    }

    const setHidden = (el, hidden) => el.classList.toggle('is-hidden', !!hidden);

    document.querySelectorAll('.nav-loggedin-only, .nav-admin-only').forEach(el => {
        const menuKey = el.dataset.tab || el.dataset.subtab;
        if (!loggedIn) { setHidden(el, true); return; }
        if (isAdminRole) { setHidden(el, false); return; } // admin selalu penuh
        if (!menuKey) {
            // Section label ("Manajemen"/"System") -- visibilitasnya disamakan
            // lagi di bawah berdasar isi section, jangan diputuskan di sini.
            return;
        }
        // Override per akun (user_menu_access) menang kalau ada; kalau
        // tidak ada baris utk menu_key ini, baru fallback ke allowedSet
        // (role_menu_access) -- lihat catatan di loadUserMenuAccess().
        if (userOverride && Object.prototype.hasOwnProperty.call(userOverride, menuKey)) {
            setHidden(el, !userOverride[menuKey]);
            return;
        }
        if (allowedSet) {
            setHidden(el, !allowedSet.has(menuKey));
        } else {
            // Fallback (migrasi belum dijalankan): perilaku lama persis --
            // nav-loggedin-only tampil utk semua yg login, nav-admin-only
            // cuma admin (jadi disembunyikan di sini karena bukan admin).
            setHidden(el, !el.classList.contains('nav-loggedin-only'));
        }
    });

    // Label section ikut disembunyikan kalau SEMUA tombol nav di bawahnya
    // (sampai label berikutnya / akhir nav) tersembunyi -- supaya tidak ada
    // judul section menggantung tanpa isi. Label admin ("Manajemen"/"System")
    // juga digating peran admin; label grup ("Siklus Jamaah", "Arsip") berlaku
    // untuk semua role yang login.
    const syncLabel = (labelEl, adminGated) => {
        if (adminGated) {
            if (!loggedIn) { setHidden(labelEl, true); return; }
            if (isAdminRole) { setHidden(labelEl, false); return; }
        }
        let sibling = labelEl.nextElementSibling;
        let anyVisible = false;
        while (sibling && !sibling.classList.contains('nav-label') && !sibling.classList.contains('nav-login-area')) {
            if (sibling.classList.contains('nav-item') && !sibling.classList.contains('is-hidden')) { anyVisible = true; break; }
            sibling = sibling.nextElementSibling;
        }
        setHidden(labelEl, !anyVisible);
    };
    document.querySelectorAll('.nav-label.nav-admin-only').forEach(l => syncLabel(l, true));
    document.querySelectorAll('.nav-label.nav-group-label').forEach(l => syncLabel(l, false));

    document.querySelectorAll('.login-btn').forEach(el => setHidden(el, loggedIn));
    // Tombol "Homepage" (ke website utama) hanya untuk halaman utama non-login
    document.querySelectorAll('.guest-only').forEach(el => { el.style.display = loggedIn ? 'none' : ''; });
    document.querySelectorAll('.logout-btn').forEach(el => setHidden(el, !loggedIn));

    const whoEl = document.getElementById('sidebarWho');
    const avatarEl = document.getElementById('sidebarAvatar');
    // Tampilkan NAMA akun (kolom "label" di dashboard_profiles, disimpan ke
    // sessionStorage saat login -- lihat checkAdminLogin()) alih-alih sekadar
    // teks role "Admin"/"User". Kalau nama belum tersedia (mis. sesi lama
    // sebelum kolom label dipakai), fallback ke label role seperti semula.
    let namaAkun = '';
    try { namaAkun = loggedIn ? (sessionStorage.getItem('admin_login_label') || '') : ''; } catch (_) { namaAkun = ''; }
    const label = loggedIn ? (namaAkun || roleLabels[currentRole] || 'User') : 'Guest';
    if (whoEl) whoEl.textContent = label;
    if (avatarEl) avatarEl.textContent = label.slice(0, 2).toUpperCase();

    // Kalau baru saja logout/kena timeout sementara sedang di tab yang kini disembunyikan,
    // kembalikan ke tab "Program Umroh" supaya tidak nyangkut di halaman kosong.
    if (!loggedIn) {
        const activePanel = document.querySelector('.tab-panel.active');
        const loggedinOnlyIds = ['tab-info', 'tab-todocs', 'tab-pendaftaran', 'tab-keberangkatan', 'tab-dokumen', 'tab-kepulangan', 'tab-arsip'];
        if (activePanel && loggedinOnlyIds.includes(activePanel.id)) {
            switchTab('umroh');
        }
        const igPageView = document.getElementById('igSchedulerPageView');
        if (igPageView && igPageView.style.display !== 'none') {
            closeIgSchedulerPage();
            switchTab('umroh');
        }
        const infografisPageView = document.getElementById('infografisPageView');
        if (infografisPageView && infografisPageView.style.display !== 'none') {
            closeInfografisPage();
            switchTab('umroh');
        }
    }
}

async function saveAdminProgram() {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengubah data program', 'error'); return false; }
    const nama = document.getElementById('admin_nama')?.value.trim();
    if (!nama) { showToast('Nama program wajib diisi!', 'error'); return false; }
    if (!isValidProgramName(nama)) { showToast('Nama program mengandung karakter tidak valid!', 'error'); return false; }

    const formData = getAdminFormData();

    // Simpan harga_quint LAMA (sebelum ditimpa) supaya setelah save berhasil
    // bisa dideteksi apakah harganya benar-benar berubah — dipakai untuk
    // memicu syncJamaahStatusForProgram() di bawah (lihat komentar di sana).
    const oldProgramForPriceCheck = editingProgramId ? dataUmroh.find(p => String(p.id) === String(editingProgramId)) : null;
    const oldHargaQuint = oldProgramForPriceCheck ? (oldProgramForPriceCheck.harga_quint || '') : '';
    // [FIX BUG] Sebelumnya deteksi "harga berubah" cuma bandingkan harga_quint
    // (field lama/legacy) -- padahal getHargaKamarJamaah() sekarang prioritas
    // ke harga_quad, dan admin bisa ubah harga_triple/harga_double sendiri-
    // sendiri. Kalau admin cuma ubah salah satu dari 3 field itu tanpa
    // sentuh harga_quint, syncJamaahStatusForProgram() TIDAK ke-trigger,
    // padahal tagihan jamaah sudah berubah -- badge Lunas/DP/Belum Bayar
    // jadi nyangkut (stale) sampai ada transaksi pembayaran baru. Sekarang
    // bandingkan KEEMPAT field harga sekaligus.
    const oldHargaQuad = oldProgramForPriceCheck ? (oldProgramForPriceCheck.harga_quad || '') : '';
    const oldHargaTriple = oldProgramForPriceCheck ? (oldProgramForPriceCheck.harga_triple || '') : '';
    const oldHargaDouble = oldProgramForPriceCheck ? (oldProgramForPriceCheck.harga_double || '') : '';

    // Validate URLs
    const urlFields = ['link_poster', 'link_itinerary'];
    for (const field of urlFields) {
        if (formData[field] && !isValidUrl(formData[field])) {
            showToast(`Link ${field.replace('_',' ')} tidak valid!`, 'error');
            return false;
        }
    }

    if (!formData.teks_wa) formData.teks_wa = generateAutoWAText(formData);

    // Pack admin-only fields
    const adminOnlyFields = ['harga_quad','harga_triple','harga_double','hotel_makkah','hotel_madinah','hotel_3','hotel_3_kota','hotel_4','hotel_4_kota','termasuk','tidak_termasuk','catatan_cx'];
    const adl = {};
    adminOnlyFields.forEach(f => { if (formData[f]) adl[f] = formData[f]; });
    const saveData = { ...formData };
    adminOnlyFields.forEach(f => delete saveData[f]);
    if (Object.keys(adl).length > 0) saveData.admin_data_lengkap = JSON.stringify(adl);

    try {
        const isEdit = !!editingProgramId;
        let result;
        if (editingProgramId) {
            result = await supabaseClient.from('programs').update(saveData).eq('id', editingProgramId).select();
        } else {
            result = await supabaseClient.from('programs').insert([saveData]).select();
        }
        if (result.error) throw result.error;
        const savedRow = (result.data && result.data[0]) || (isEdit ? { id: editingProgramId } : null);

        saveHotelDetailsFromForm(formData); // ingat jarak/menit jalan kaki tiap hotel untuk program berikutnya (non-blocking)
        showToast(editingProgramId ? 'Program berhasil diperbarui' : 'Program berhasil ditambahkan');
        hideAdminForm(true);
        await loadDataFromSupabase(true);
        await renderAdminPanel();

        // Kalau ini edit program & harga Quint-nya berubah, sinkronkan ulang
        // status bayar (lunas/dp/pending) semua jamaah di program ini —
        // dijalankan SETELAH loadDataFromSupabase supaya dataUmroh yang
        // dipakai syncJamaahStatusForProgram() sudah berisi harga terbaru.
        if (isEdit && editingProgramId && (
            formData.harga_quint !== oldHargaQuint ||
            formData.harga_quad !== oldHargaQuad ||
            formData.harga_triple !== oldHargaTriple ||
            formData.harga_double !== oldHargaDouble
        )) {
            await syncJamaahStatusForProgram(editingProgramId);
        }

        // Notifikasi Telegram otomatis (dinamis: hanya terkirim jika konfigurasi Telegram sudah diisi)
        sendTelegramNotif(formatTgProgram(formData, isEdit), 'program');

        // Crosscheck otomatis: kalau ada link poster, baca & bandingkan otomatis di background
        if (saveData.link_poster && savedRow && savedRow.id) {
            autoScanPosterForProgram(savedRow.id);
        }

        return true;
    } catch (err) {
        console.error('Save program error:', err);
        showToast('Gagal menyimpan: ' + err.message, 'error');
        return false;
    }
}

async function editAdminProgram(id, focusFieldId) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengedit program', 'error'); return; }
    await ensureAdminProgramPageReady();
    const { data, error } = await supabaseClient.from('programs').select('*').eq('id', id).single();
    if (error || !data) { showToast('Program tidak ditemukan', 'error'); return; }

    const unpacked = unpackProgramAdminData(data);
    // Data lama: harga_quint sebenarnya dipakai sebagai harga Quad (tidak ada tipe kamar Quint)
    if (!unpacked.harga_quad && unpacked.harga_quint) unpacked.harga_quad = unpacked.harga_quint;

    setAdminFormData(unpacked);
    editingProgramId = id;
    // Kalau program ini masih punya field yang "belum dikonfirmasi" (terisi
    // otomatis dari OCR poster tapi belum sempat ditinjau/disimpan admin),
    // tandai kuning lagi di sini supaya tidak kelewat.
    cxClearAutofillHighlight();
    if (unpacked.autofilled_fields?.length) cxApplyAutofillHighlight(unpacked.autofilled_fields);
    // Muat data referensi Hotel Saudi Arabia di background, lalu tampilkan
    // hint untuk nilai Hotel Makkah/Madinah yang sudah tersimpan di program ini.
    ensureHotelDetailsLoaded().then(() => HOTEL_DETAIL_INPUT_IDS.forEach(refreshHotelDetailSuggest));
    ensureHotelReferenceLoaded().then(() => {
        updateHotelRefHint('admin_hotel_makkah', 'hotelRefHint_makkah', 'makkah');
        updateHotelRefHint('admin_hotel_madinah', 'hotelRefHint_madinah', 'madinah');
        ADMIN_HOTEL_EXTRA_SLOTS.forEach(n => updateAdminHotelExtraHint(n));
    });
    // Program lama tidak punya teks broadcast asli tersimpan — bersihkan kotak
    // broadcast & referensinya supaya tidak menampilkan sisa dari program lain.
    const bcInput = document.getElementById('parseBroadcastInput');
    if (bcInput) bcInput.value = '';
    syncBroadcastRefBox();
    document.getElementById('adminFormTitle').innerText = 'Edit Program';
    document.getElementById('adminFormContainer').style.display = 'block';
    setupAdminFormAnchorNav();

    if (focusFieldId) {
        // Shortcut: lompat & fokus langsung ke field tertentu (mis. dari badge
        // "Belum ada poster" di tabel) -- tanpa perlu scroll cari sendiri.
        _adminFormSnapshot = JSON.stringify(getAdminFormData());
        setTimeout(() => scrollToAdminFieldAndFocus(focusFieldId), 120);
    } else {
        document.getElementById('adminFormContainer').scrollIntoView({ behavior: 'smooth' });
        focusAdminFormAndSnapshot();
    }
}

// Shortcut dari badge "Belum ada poster" di tabel: buka form edit program ini
// & langsung lompat+fokus ke field Link Poster, supaya admin tidak perlu cari
// manual di antara semua field form.
function quickAddPosterLink(id) {
    editAdminProgram(id, 'admin_link_poster');
    showToast('Tempel link poster program ini, lalu klik Simpan');
}

// Shortcut dari badge "Caption kosong" / "Caption belum lengkap" di tabel:
// buka form edit program ini & langsung lompat+fokus ke kotak Teks WA, supaya
// admin bisa langsung klik "Generate dengan AI" atau isi manual tanpa cari-cari.
function quickFixCaption(id) {
    editAdminProgram(id, 'admin_teks_wa');
    showToast('Klik "Generate dengan AI" atau lengkapi Teks WA manual, lalu Simpan');
}

// Scroll ke section (fieldset) yang menaungi sebuah field form, lalu fokuskan
// field itu -- dipakai untuk shortcut lompat-ke-field (mis. quickAddPosterLink).
function scrollToAdminFieldAndFocus(fieldId) {
    const el = document.getElementById(fieldId);
    if (!el) return;
    const section = el.closest('.admin-fieldset');
    if (section) scrollToAdminSection(section.id);
    else el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => { el.focus(); el.select?.(); }, 380);
}

async function deleteProgramById(id) {
    const { error } = await supabaseClient.from('programs').delete().eq('id', id);
    if (error) throw error;
    sessionStorage.removeItem(CACHE_KEY);
}

// Dipakai modul Crosscheck & Telegram untuk update parsial 1 program tanpa re-render penuh
async function updateProgramById(id, patch) {
    const { data, error } = await supabaseClient.from('programs').update(patch).eq('id', id).select();
    if (error) throw error;
    sessionStorage.removeItem(CACHE_KEY);
    return data && data[0];
}

// [REFRESH POSTER] Dipanggil setelah file poster di Google Drive diganti (link tetap sama).
// 1) simpan poster_version = sekarang di database -> semua pengguna (dashboard & katalog)
//    memuat ulang gambar karena URL-nya berubah (&v=...);
// 2) scan ulang OCR memakai URL baru, supaya data Crosscheck ikut diperbarui.
// Catatan: thumbnail Google Drive sendiri kadang butuh beberapa menit untuk ter-update.
async function refreshPosterProgram(id) {
    if (!canManageProgramData()) { showToast('Tidak punya izin', 'error'); return; }
    const ver = Date.now();
    try {
        await updateProgramById(id, { poster_version: ver });
    } catch (err) {
        const missing = /poster_version/i.test(err.message || '');
        showToast(missing
            ? 'Kolom poster_version belum ada — jalankan sql/57_tambah_programs_poster_version.sql di Supabase dulu.'
            : 'Gagal refresh poster: ' + (err.message || err), 'error');
        return;
    }
    [adminPrograms, dataUmroh, currentData].forEach(list => {
        const row = (list || []).find(p => String(p.id) === String(id));
        if (row) row.poster_version = ver;
    });
    renderAdminTable();
    try { if (typeof renderTableWithSearch === 'function') renderTableWithSearch(); } catch (e) {}
    showToast('Poster di-refresh — memindai ulang. Kalau masih gambar lama, tunggu beberapa menit (thumbnail Google belum ter-update).', 'success');
    autoScanPosterForProgram(id);
}

// [UNDUH DAFTAR PROGRAM] PDF A4 landscape bergaya "JADWAL UMRAH" Amiru Tour:
// judul + subjudul, tabel (Tanggal, Program, Pesawat, Hotel Madinah, Hotel Mekah,
// Biaya Quad/Triple/Double), lalu blok Biaya Sudah/Belum Termasuk, Catatan, Izin PPIU
// dan tanggal Update. Baris = program yang tampil di dashboard (aktif, belum expired,
// punya poster; urut tanggal terdekat). Teks digambar langsung lewat jsPDF (bukan
// screenshot), jadi tajam & bisa diseleksi/dicari.
//
// Pemetaan kolom dari data program:
//   Tanggal = tgl | Program = durasi + keterangan dari nama (Plus <kota>, Awal/Full Ramadhan, Syawal)
//   Pesawat = maskapai + "Landing Jedah/Madinah" bila tertulis di nama program
//   Hotel Madinah / Mekah = hotel_madinah / hotel_makkah (nama singkat, sebelum tanda "/")
//   Biaya = harga_quad (atau harga_quint) / harga_triple / harga_double
const JADWAL_PDF_TERMASUK = ['Tiket Pesawat Internasional', 'Visa Umrah', 'Perlengkapan Umrah', 'Handling Bandara', 'Asuransi', 'Air Zamzam 5 liter'];
const JADWAL_PDF_BELUM_TERMASUK = ['Pembuatan Paspor', 'Vaksin Meningitis dan Polio', 'Tiket Domestik ke Jakarta', 'Hotel Transit di Jakarta', 'Biaya Kirim Perlengkapan'];
const JADWAL_PDF_CATATAN = [
    'Biaya dan jadwal sewaktu-waktu dapat berubah mengikuti ketentuan Saudi, Maskapai dan kurs riyal - dolar',
    'Pembayaran wajib ditransfer ke rekening perusahaan',
];
const JADWAL_PDF_PPIU = '07042200368110004';

async function downloadProgramListPdf(btn) {
    if (!canManageProgramData()) { showToast('Unduh daftar program hanya untuk admin & user', 'error'); return; }
    const list = sortProgramsDefault((dataUmroh || []).filter(isProgramVisibleOnDashboard));
    if (!list.length) { showToast('Belum ada program untuk diunduh', 'error'); return; }

    const oldHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-arrow-repeat bi-spin"></i> Menyiapkan preview...'; }
    try {
        if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
            try { await ensureLibLoaded('jspdf'); }
            catch (_) { showToast('Modul PDF gagal dimuat — periksa koneksi internet lalu coba lagi', 'error'); return; }
        }
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const PW = 297, PH = 210, M = 10;
        const now = new Date();

        // ---- Pemetaan data -> teks sel ----
        const cap = (w) => w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : '';
        const noRp = (v) => { const t = formatRupiah(v); return t === '-' ? '-' : t.replace(/^Rp\s*/i, ''); };
        const programText = (p) => {
            let d = String(p.durasi || '').trim();
            if (/^\d+$/.test(d)) d += ' Hari';
            const n = String(p.nama || '');
            const extra = [];
            const plus = n.match(/plus\s+([A-Za-z]+)/i);
            if (plus) extra.push('Plus ' + cap(plus[1]));
            if (/full\s+ramadhan/i.test(n)) extra.push('Full Ramadhan');
            else if (/awal\s+ramadhan/i.test(n)) extra.push('Awal Ramadhan');
            else if (/ramadhan/i.test(n)) extra.push('Ramadhan');
            if (/syawal/i.test(n)) extra.push('Syawal');
            // Jangan tulis ganda kalau durasi sudah memuat keterangan yang sama (mis. "9 Hari Syawal")
            return [d || '-', ...extra.filter(e => !d.toLowerCase().includes(e.toLowerCase()))].join(' ');
        };
        const pesawatText = (p) => {
            const n = String(p.nama || '');
            let landing = '';
            const m = n.match(/landing\s+(jed+ah|madinah|makkah|mekah)/i);
            if (m) landing = 'Landing ' + (/^jed/i.test(m[1]) ? 'Jedah' : cap(m[1]));
            else if (/jed+ah\s+madinah/i.test(n)) landing = 'Jedah Madinah';
            return [String(p.maskapai || '').trim() || '-', landing].filter(Boolean).join(' ');
        };
        const rows = list.map((p, i) => [
            String(i + 1),
            String(p.tgl || '-'),
            programText(p),
            pesawatText(p),
            hotelNamaSingkat(p.hotel_madinah) || '-',
            hotelNamaSingkat(p.hotel_makkah) || '-',
            noRp(p.harga_quad || p.harga_quint),
            noRp(p.harga_triple),
            noRp(p.harga_double),
        ]);

        // Rentang tahun untuk judul: "2026 - 2027" (atau satu tahun kalau semuanya sama)
        const years = list.map(p => p.dateObj instanceof Date && !isNaN(p.dateObj) ? p.dateObj.getFullYear() : null).filter(Boolean);
        const y1 = years.length ? Math.min(...years) : now.getFullYear();
        const y2 = years.length ? Math.max(...years) : y1;
        const judul = `JADWAL UMRAH ${y1 === y2 ? y1 : y1 + ' - ' + y2}`;

        // Logo (opsional -- kalau gagal dimuat dokumen tetap dibuat tanpa logo)
        let logo = null;
        try {
            const blob = await (await fetch('assets/logo-amirutour.png')).blob();
            logo = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
        } catch (_) { /* tanpa logo */ }

        const cols = [
            { h: 'NO' }, { h: 'TANGGAL' }, { h: 'PROGRAM' }, { h: 'PESAWAT' }, { h: 'HOTEL MADINAH' },
            { h: 'HOTEL MEKAH' }, { h: 'BIAYA QUAD' }, { h: 'BIAYA TRIPLE' }, { h: 'BIAYA DOUBLE' },
        ].map(c => ({ ...c, a: 'left', w: 0 }));
        const PAD = 2.2, HEAD_H = 6.4, TABLE_W = PW - 2 * M;

        // [LEBAR KOLOM OTOMATIS] Ukur teks terpanjang di tiap kolom (termasuk judul kolom), lalu
        // beri lebar sesuai isinya supaya semua data muat 1 baris. Kalau total melebihi lebar
        // kertas, ukuran font diperkecil bertahap (8.5 -> 6.5 pt) sampai muat; sisa ruang
        // dibagi proporsional ke semua kolom. Hanya kalau font minimum pun tidak cukup, teks
        // terpanjang baru boleh turun ke baris kedua.
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5);
        const headW = cols.map(c => pdf.getTextWidth(c.h));
        const measure = (f) => {
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(f);
            return cols.map((c, i) => Math.max(headW[i], ...rows.map(r => pdf.getTextWidth(String(r[i])))) + 2 * PAD + 0.8);
        };
        let FS = 8.5, natural = measure(FS);
        while (natural.reduce((x, y2) => x + y2, 0) > TABLE_W && FS > 6.5) { FS = Math.round((FS - 0.25) * 100) / 100; natural = measure(FS); }
        const scale = TABLE_W / natural.reduce((x, y2) => x + y2, 0);
        cols.forEach((c, i) => { c.w = natural[i] * scale; });
        const LH = FS * 0.41;
        const BLUE = [21, 101, 168], INK = [28, 28, 28], GREY = [238, 240, 242], RED = [200, 30, 30];

        const drawFirstHeader = () => {
            // Kop: logo kiri (proporsi asli 300x278), judul + subjudul di tengah, Izin PPIU kanan
            const LOGO_H = 17, LOGO_W = LOGO_H * 300 / 278;
            if (logo) pdf.addImage(logo, 'PNG', M, M, LOGO_W, LOGO_H);
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(20); pdf.setTextColor(...INK);
            pdf.text(judul, PW / 2, M + 8, { align: 'center' });
            // Subjudul: "Keberangkatan" normal + "Bandara Soetta Jakarta" tebal, dipusatkan
            pdf.setFontSize(11);
            pdf.setFont('helvetica', 'normal'); const a = 'Keberangkatan ';
            pdf.setFont('helvetica', 'bold');   const b = 'Bandara Soetta Jakarta';
            pdf.setFont('helvetica', 'normal'); const wa = pdf.getTextWidth(a);
            pdf.setFont('helvetica', 'bold');   const wb = pdf.getTextWidth(b);
            const sx = PW / 2 - (wa + wb) / 2;
            pdf.setTextColor(...INK);
            pdf.setFont('helvetica', 'normal'); pdf.text(a, sx, M + 14.6);
            pdf.setFont('helvetica', 'bold');   pdf.text(b, sx + wa, M + 14.6);
            // Izin PPIU: label kecil di atas, nomor tebal di bawah, rata kanan
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(110, 118, 126);
            pdf.text('Izin PPIU', PW - M, M + 7.2, { align: 'right' });
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...INK);
            pdf.text(JADWAL_PDF_PPIU, PW - M, M + 12, { align: 'right' });
        };
        const drawTableHead = (y) => {
            pdf.setFillColor(...BLUE); pdf.rect(M, y, PW - 2 * M, HEAD_H, 'F');
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(255, 255, 255);
            let x = M;
            cols.forEach(c => { pdf.text(c.h, x + PAD, y + 4.5); x += c.w; });
            return y + HEAD_H;
        };

        const FOOT_H = 44;                       // tinggi blok keterangan (3 kolom) di bawah tabel
        const BOTTOM = PH - 6;
        const FIRST_TOP = M + 21, NEXT_TOP = M;
        drawFirstHeader();
        let y = drawTableHead(FIRST_TOP);

        rows.forEach((cells, idx) => {
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(FS);
            const wrapped = cells.map((t, i) => pdf.splitTextToSize(t, cols[i].w - 2 * PAD + 1));
            const rowH = Math.max(...wrapped.map(l => l.length)) * LH + 1.3;
            if (y + rowH > BOTTOM) { pdf.addPage(); y = drawTableHead(NEXT_TOP); }
            if (idx % 2) { pdf.setFillColor(...GREY); pdf.rect(M, y, PW - 2 * M, rowH, 'F'); }
            pdf.setTextColor(...INK);
            let x = M;
            cells.forEach((_, i) => {
                pdf.text(wrapped[i], x + PAD, y + 0.8 + LH * 0.82, { lineHeightFactor: LH / (FS * 0.3528) });
                x += cols[i].w;
            });
            y += rowH;
        });

        // ---- Blok keterangan di bawah tabel: 3 kolom tanpa kotak/border (pindah halaman kalau tidak muat) ----
        if (y + FOOT_H > BOTTOM) { pdf.addPage(); y = NEXT_TOP; }
        const cy0 = y + 5;                                   // jarak dari tabel
        const CG = 6, CW = (PW - 2 * M - 2 * CG) / 4;        // celah antar kolom, lebar kolom 1 & 2 (Catatan = sisanya)
        const cw3 = PW - 2 * M - 2 * CW - 2 * CG;
        const CARD_H = 10 + Math.max(JADWAL_PDF_TERMASUK.length, JADWAL_PDF_BELUM_TERMASUK.length) * 4.6;
        const GREEN = [30, 130, 80];
        const drawCard = (x, w, title, accent) => {
            pdf.setFillColor(...accent); pdf.roundedRect(x, cy0, 1.1, 4, 0.5, 0.5, 'F');
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...INK);
            pdf.text(title, x + 3, cy0 + 3.1);
        };
        const drawBullets = (x, w, items, color) => {
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5);
            let ly = cy0 + 10;
            items.forEach(t => {
                const ls = pdf.splitTextToSize(t, w - 6);
                pdf.setFillColor(...color); pdf.circle(x + 1.1, ly - 1, 0.55, 'F');
                pdf.setTextColor(...INK); pdf.text(ls, x + 3.5, ly);
                ly += ls.length * 4.6;
            });
        };
        const cx1 = M, cx2 = M + CW + CG, cx3 = M + 2 * (CW + CG);
        drawCard(cx1, CW, 'BIAYA SUDAH TERMASUK', GREEN);  drawBullets(cx1, CW, JADWAL_PDF_TERMASUK, GREEN);
        drawCard(cx2, CW, 'BIAYA BELUM TERMASUK', RED);    drawBullets(cx2, CW, JADWAL_PDF_BELUM_TERMASUK, RED);
        drawCard(cx3, cw3, 'CATATAN', BLUE);               drawBullets(cx3, cw3, JADWAL_PDF_CATATAN, BLUE);

        // Lencana "Update : <tanggal>" di pojok kanan bawah blok Catatan
        const upd = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
        pdf.setFontSize(7.5);
        pdf.setFont('helvetica', 'bold'); const lbl = 'Update';
        const wl = pdf.getTextWidth(lbl);
        pdf.setFont('helvetica', 'normal'); const rest = ` : ${upd}`;
        const wr = pdf.getTextWidth(rest);
        const bw = wl + wr + 6, bh = 5.6, bx = cx3 + cw3 - bw, by = cy0 + CARD_H - bh;
        pdf.setFillColor(253, 238, 238); pdf.setDrawColor(...RED); pdf.setLineWidth(0.25);
        pdf.roundedRect(bx, by, bw, bh, 2.8, 2.8, 'FD');
        pdf.setTextColor(...RED);
        pdf.setFont('helvetica', 'bold'); pdf.text(lbl, bx + 3, by + 3.9);
        pdf.setFont('helvetica', 'normal'); pdf.text(rest, bx + 3 + wl, by + 3.9);

        // Nomor halaman hanya kalau dokumen lebih dari 1 halaman
        const total = pdf.getNumberOfPages();
        if (total > 1) {
            for (let i = 1; i <= total; i++) {
                pdf.setPage(i);
                pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(120, 130, 140);
                pdf.text(`Halaman ${i} dari ${total}`, PW / 2, PH - 3.5, { align: 'center' });
            }
        }

        // PDF TIDAK langsung diunduh: tampilkan preview dulu, unduh lewat tombol "Unduh PDF" di preview.
        await openProgramListPreview(pdf, `Jadwal-Umrah-${y1 === y2 ? y1 : y1 + '-' + y2}.pdf`, list.length, total);
    } catch (err) {
        console.error('downloadProgramListPdf error:', err);
        showToast('Gagal membuat PDF: ' + (err.message || err), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
    }
}

// ============================================================
// [PREVIEW DAFTAR PROGRAM] Modal preview PDF "Jadwal Umrah" sebelum diunduh.
// - PDF dibuat seperti biasa (jsPDF), lalu tiap halamannya digambar ke <canvas> lewat pdf.js (dimuat lazy, hanya saat preview dibuka).
//   Hasil preview = isi file yang diunduh (bukan tiruan HTML).
// - [FIT] Lebar modal dihitung dari ukuran layar supaya satu halaman A4 landscape PAS memenuhi area preview:
//   tanpa padding kanvas, tanpa sisa kiri/kanan. Dokumen lebih dari 1 halaman di-scroll ke bawah.
// - Unduh baru terjadi saat tombol "Unduh PDF" ditekan. Esc / klik di luar / Tutup = batal tanpa mengunduh.
// ============================================================
let _plp = null;   // { pdf, fileName, count, doc, n, ratio, busy, again, rt }

function ensurePlpModal() {
    let el = document.getElementById('plpOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'modal-overlay'; el.id = 'plpOverlay';
    el.innerHTML =
        '<div class="modal-content plp-box" id="plpBox" role="dialog" aria-modal="true" aria-labelledby="plpTitle">' +
            '<div class="modal-header plp-head"><h2 id="plpTitle"><i class="bi bi-file-earmark-pdf-fill"></i> Preview Daftar Program</h2>' +
                '<button type="button" class="modal-close" aria-label="Tutup preview" onclick="closeProgramListPreview()">&times;</button></div>' +
            '<div class="plp-body" id="plpBody"></div>' +
            '<div class="plp-foot"><span class="plp-meta" id="plpMeta"></span>' +
                '<button type="button" class="btn-secondary" onclick="closeProgramListPreview()">Tutup</button>' +
                '<button type="button" class="plp-wa" id="plpWa" onclick="shareProgramListWa()"><i class="bi bi-whatsapp"></i> Share WA</button>' +
                '<button type="button" class="btn-primary" id="plpDl" onclick="downloadProgramListFromPreview()"><i class="bi bi-download"></i> Unduh PDF</button></div>' +
        '</div>';
    el.addEventListener('click', e => { if (e.target === el) closeProgramListPreview(); });
    document.body.appendChild(el);
    return el;
}

// Hitung ukuran modal: lebar = lebar halaman yang muat utuh di layar (dibatasi lebar & tinggi), tinggi area preview = pas 1 halaman
// (atau lebih bila dokumen panjang, maksimal setinggi layar yang tersedia).
function plpFit() {
    if (!_plp) return;
    const box = document.getElementById('plpBox'), body = document.getElementById('plpBody');
    if (!box || !body) return;
    const head = box.querySelector('.plp-head'), foot = box.querySelector('.plp-foot');
    const gap = 10, r = _plp.ratio, n = Math.max(1, _plp.n), rl = r * (_plp.trim || 1);   // rl = rasio tinggi/lebar halaman TERAKHIR (sisa kosong di bawah sudah dipotong)
    for (let pass = 0; pass < 2; pass++) {              // pass ke-2: ukur ulang header/footer setelah lebar berubah (bisa membungkus baris)
        const chrome = head.offsetHeight + foot.offsetHeight;
        const availW = window.innerWidth - 24;           // overlay preview hanya menyisakan 12px di tiap sisi
        const availH = window.innerHeight - 24 - chrome;
        const w = Math.max(280, Math.floor(Math.min(availW, availH / (n === 1 ? rl : r))));
        const full = (n - 1) * (w * r + gap) + w * rl;
        box.style.width = w + 'px';
        body.style.height = Math.ceil(Math.min(full, availH)) + 'px';
    }
}

// Cari baris terbawah yang masih berisi (bukan putih) di kanvas -> pecahan tinggi halaman yang perlu ditampilkan (+ margin bawah setara margin atas).
function plpMeasureTrim(cv) {
    try {
        const w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, h).data;
        for (let y = h - 1; y >= 0; y--) {
            const row = y * w * 4;
            for (let x = 0; x < w; x += 2) {
                const i = row + x * 4;
                if (d[i] < 242 || d[i + 1] < 242 || d[i + 2] < 242) return Math.max(.35, Math.min(1, (y + 1) / h + .048));
            }
        }
    } catch (_) {}
    return 1;
}

async function plpRender() {
    const st = _plp;
    if (!st || !st.doc) return;
    if (st.busy) { st.again = true; return; }          // render sedang jalan (mis. layar diubah) -> ulangi setelah selesai, jangan tumpang-tindih
    st.busy = true;
    try {
        do {
            st.again = false;
            const body = document.getElementById('plpBody');
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const cssW = body.clientWidth || 800;
            const canvases = body.querySelectorAll('canvas');
            for (let i = 1; i <= st.doc.numPages; i++) {
                if (_plp !== st) return;
                const page = await st.doc.getPage(i);
                const v0 = page.getViewport({ scale: 1 });
                const vp = page.getViewport({ scale: (cssW * dpr) / v0.width });
                const cv = canvases[i - 1]; if (!cv) continue;
                cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
                await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
            }
        } while (st.again && _plp === st);
    } finally { st.busy = false; }
}

function plpKey(e) { if (e.key === 'Escape') closeProgramListPreview(); }
function plpOnResize() {
    if (!_plp) return;
    plpFit();
    clearTimeout(_plp.rt);
    _plp.rt = setTimeout(plpRender, 250);               // tajamkan ulang sesudah ukuran layar berhenti berubah
}

async function openProgramListPreview(pdf, fileName, count, pages, opts = {}) {
    const overlay = ensurePlpModal();
    const body = document.getElementById('plpBody');
    const st = _plp = { pdf, fileName, count, doc: null, n: pages, ratio: opts.ratio || 210 / 297, trim: 1, busy: false, again: false, rt: 0, unit: opts.unit || 'program', noun: opts.noun || 'Jadwal', waJudul: opts.waJudul || '', waText: opts.waText || '' };
    const ttl = document.getElementById('plpTitle');
    if (ttl) ttl.innerHTML = '<i class="bi bi-file-earmark-pdf-fill"></i> ' + escapeHtml(opts.title || 'Preview Daftar Program');
    document.getElementById('plpMeta').textContent = `${count} ${st.unit} · ${pages} halaman`;
    body.innerHTML = '<div class="plp-load"><i class="bi bi-arrow-repeat bi-spin"></i> Menyiapkan preview...</div>';
    overlay.classList.add('open');
    document.addEventListener('keydown', plpKey);
    window.addEventListener('resize', plpOnResize);
    plpFit();
    try {
        await ensureLibLoaded('pdfjs');
        const lib = window.pdfjsLib;
        lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        const data = new Uint8Array(pdf.output('arraybuffer'));
        // isEvalSupported:false -> CSP dashboard tidak mengizinkan eval. Worker lintas-origin ditolak CSP -> pdf.js otomatis jalan tanpa worker (cukup untuk 1-3 halaman).
        const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
        if (_plp !== st) { try { doc.destroy(); } catch (_) {} return; }
        st.doc = doc; st.n = doc.numPages;
        body.innerHTML = Array.from({ length: doc.numPages }, () => '<div class="plp-pg"><canvas class="plp-page"></canvas></div>').join('');
        plpFit();
        await plpRender();
        // Potong sisa kosong di bawah isi halaman terakhir, lalu lebarkan lagi sesuai layar dan render ulang supaya tajam.
        if (_plp === st) {
            const cvs = body.querySelectorAll('canvas'), last = cvs[cvs.length - 1];
            st.trim = plpMeasureTrim(last);
            if (st.trim < .98) {
                last.parentNode.style.aspectRatio = '297 / ' + (210 * st.trim).toFixed(3);
                plpFit();
                await plpRender();
            }
        }
    } catch (err) {
        console.error('openProgramListPreview error:', err);
        if (_plp === st) body.innerHTML = '<div class="plp-load">Preview tidak bisa ditampilkan (periksa koneksi internet).<br>PDF tetap bisa diunduh lewat tombol di bawah.</div>';
    }
}

function closeProgramListPreview() {
    const el = document.getElementById('plpOverlay');
    if (el) el.classList.remove('open');
    document.removeEventListener('keydown', plpKey);
    window.removeEventListener('resize', plpOnResize);
    if (_plp) { clearTimeout(_plp.rt); try { if (_plp.doc) _plp.doc.destroy(); } catch (_) {} }
    _plp = null;
    const body = document.getElementById('plpBody'); if (body) body.innerHTML = '';
}

// Share ke WhatsApp. HP / browser dengan Web Share file: lembar share sistem terbuka dengan PDF terlampir (pilih WhatsApp).
// Desktop (tidak bisa melampirkan file lewat tautan WA): PDF diunduh lalu WhatsApp dibuka dengan teks pengantar, tinggal lampirkan file-nya.
async function shareProgramListWa() {
    if (!_plp) return;
    const { pdf, fileName, count } = _plp;
    const periode = (fileName.match(/Jadwal-Umrah-(.+)\.pdf$/) || [])[1];
    const judul = _plp.waJudul || ('Jadwal Umrah' + (periode ? ' ' + periode.replace(/-/g, ' - ') : '') + ' Amiru Tour');
    const tgl = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const teks = _plp.waText || `Assalamu'alaikum, berikut ${judul} (${count} program, update ${tgl}).`;
    try {
        const file = new File([pdf.output('blob')], fileName, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: judul, text: teks });
            showToast(_plp.noun + ' dibagikan', 'success');
            return;
        }
    } catch (err) {
        if (err && err.name === 'AbortError') return;      // user menutup lembar share: tidak perlu apa-apa
        console.warn('Web Share gagal, pakai cara WhatsApp biasa:', err);
    }
    try { pdf.save(fileName); } catch (err) { showToast('Gagal membuat PDF: ' + (err.message || err), 'error'); return; }
    window.open('https://wa.me/?text=' + encodeURIComponent(teks + '\n(File PDF "' + fileName + '" terlampir)'), '_blank', 'noopener');
    showToast('PDF sudah diunduh. Di WhatsApp, lampirkan file tersebut ke chat.', 'success');
}

function downloadProgramListFromPreview() {
    if (!_plp) return;
    const { pdf, fileName, count, n, unit, noun } = _plp;
    try {
        pdf.save(fileName);
        showToast(`${noun} diunduh (${count} ${unit}, ${n} halaman)`, 'success');
    } catch (err) {
        showToast('Gagal mengunduh PDF: ' + (err.message || err), 'error');
        return;
    }
    closeProgramListPreview();
}

async function clearAllAdminData() {
    if (currentRole !== 'admin') { showToast('Halaman Admin hanya untuk Administrator', 'error'); return; }

    // Konsisten dengan hapus SATU program (lihat confirmDeleteAction()): jangan
    // izinkan Hapus Semua kalau masih ada program yang punya jamaah terdaftar
    // dan/atau pendaftaran yang belum Batal. Tanpa cek ini, deleteProgramById()
    // di bawah akan cascade-delete kb_jamaah & pembayaran_jamaah program itu
    // secara permanen (bisa lewat kalau program masih aktif/jamaahnya belum
    // lunas) -- sebelumnya cuma bisa dipulihkan lewat snapshot, sekarang
    // dicegah dari awal seperti alur hapus satu-satu.
    try {
        const [{ data: jamaahRows, error: jErr }, { data: pfRows, error: pfErr }] = await Promise.all([
            // Jamaah yang sudah diarsip (diarsipkan=true) sengaja TIDAK dihitung
            // di sini -- program yang seluruh jamaahnya sudah diarsip
            // (is_active=false) memang boleh dihapus, konsisten dengan
            // kbJamaahList (sudah difilter diarsipkan=false) yang dipakai
            // pengecekan hapus satu program di openDeleteModal().
            supabaseClient.from('kb_jamaah').select('program_id').eq('diarsipkan', false),
            supabaseClient.from('pendaftaran').select('program_id').neq('status', 'batal')
        ]);
        if (jErr) throw jErr;
        if (pfErr) throw pfErr;
        const programIdBermasalah = new Set();
        (jamaahRows || []).forEach(r => { if (r.program_id) programIdBermasalah.add(r.program_id); });
        (pfRows || []).forEach(r => { if (r.program_id) programIdBermasalah.add(r.program_id); });
        if (programIdBermasalah.size > 0) {
            showToast(`Tidak bisa Hapus Semua — ${programIdBermasalah.size} program masih punya jamaah terdaftar dan/atau pendaftaran yang belum Batal. Selesaikan/pindahkan/hapus dulu data itu (atau arsipkan programnya lewat "Arsipkan Semua" di tab Data Jamaah kalau sudah berangkat), baru Hapus Semua bisa dipakai lagi.`, 'error');
            return;
        }
    } catch (err) {
        showToast('Gagal memverifikasi data jamaah/pendaftaran sebelum Hapus Semua: ' + (err.message || err), 'error');
        return;
    }

    let jumlahProgram = null;
    try {
        const { count } = await supabaseClient.from('programs').select('id', { count: 'exact', head: true });
        jumlahProgram = count;
    } catch (_) { /* biarkan null kalau gagal hitung, tetap tampilkan konfirmasi */ }
    const ok = await openActionConfirm({
        title: 'Hapus SEMUA Program?',
        message: `Tindakan ini akan menghapus <strong>${jumlahProgram != null ? jumlahProgram + ' program' : 'SEMUA program'}</strong> beserta seluruh datanya secara permanen dan <strong>tidak dapat dibatalkan</strong>. Sebuah snapshot cadangan otomatis akan dibuat sebelum penghapusan; kalau snapshot gagal, penghapusan <strong>dibatalkan</strong>.`,
        confirmLabel: 'Hapus Semua Program',
        requireTypedWord: 'HAPUS SEMUA'
    });
    if (!ok) return;
    if (!(await ensureAutoSnapshot('auto-pre-clear', 'Auto sebelum Hapus Semua'))) {
        showToast('Hapus Semua DIBATALKAN — snapshot pengaman gagal dibuat, tidak ada data yang dihapus. Coba lagi.', 'error');
        return;
    }
    try {
        const { data } = await supabaseClient.from('programs').select('id');
        for (const prog of data) await deleteProgramById(prog.id);
        await loadDataFromSupabase(true);
        await renderAdminPanel();
        showToast('Semua program dihapus');
    } catch (err) {
        showToast('Gagal: ' + err.message, 'error');
    }
}

// ============================================================
// 15. PARSE BROADCAST
// ============================================================
function parseBroadcastText() {
    const rawInput = document.getElementById('parseBroadcastInput').value.trim();
    if (!rawInput) { showToast('Paste teks broadcast dulu', 'error'); return; }
    ensureHotelDetailsLoaded(); // jaga-jaga: pustaka detail hotel dimuat (dipakai combineHotel)
    // Broadcast dari grup WA sering pakai ejaan "Umrah" -- standarisasi ke "Umroh"
    // dan singkatan "pp" (Pulang-Pergi) huruf kecil -- standarisasi ke "PP" --
    // dulu sebelum diparsing, supaya field yang terisi otomatis (nama program,
    // termasuk/tidak termasuk, dll) ikut konsisten dengan format resmi Amiru Tour.
    const raw = normalizePpAbbreviation(normalizeUmrohSpelling(rawInput));

    const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
    const clean = s => s.replace(/^\*+|\*+$/g, '').trim();
    const cleanAll = s => s.replace(/\*/g, '').trim();

    // Nama: baris pertama bold *...*
    let nama = '';
    for (const l of lines) {
        if (/^\*.+\*$/.test(l)) { nama = clean(l); break; }
    }
    if (!nama) nama = clean(lines[0]);
    // Broadcast biasanya nulis judul ALL CAPS ("UMROH LIBURAN DESEMBER") --
    // rapikan ke Title Case ("Umroh Liburan Desember") untuk field Nama Program.
    nama = toTitleCaseIfAllCaps(nama);

    // Durasi
    let durasi = '';
    for (const l of lines) {
        const m = l.match(/program\s+(\d+)\s*hari/i) || l.match(/^(\d+)\s*hari/i);
        if (m) { durasi = m[1] + ' Hari'; break; }
    }

    // Maskapai
    let maskapai = '';
    for (let i = 0; i < lines.length - 1; i++) {
        if (/pesawat/i.test(clean(lines[i]))) { maskapai = clean(lines[i + 1]); break; }
    }

    // Harga
    const parseHarga = (txt) => {
        const m = txt.replace(/\./g, '').match(/(\d{5,})/);
        return m ? 'Rp ' + parseInt(m[1]).toLocaleString('id-ID') : '';
    };
    let harga_quint = '', harga_quad = '', harga_triple = '', harga_double = '';
    for (const l of lines) {
        const lc = l.toLowerCase();
        if (/qu[ai]n[dt]|quint/i.test(lc)) {
            if (!harga_quint) harga_quint = parseHarga(l);
        } else if (/qu[ao]r[da]|quad/i.test(lc)) {
            if (!harga_quad) harga_quad = parseHarga(l);
        } else if (/triple|tripel/i.test(lc)) {
            if (!harga_triple) harga_triple = parseHarga(l);
        } else if (/double|dbl/i.test(lc)) {
            if (!harga_double) harga_double = parseHarga(l);
        }
    }
    if (!harga_quint) harga_quint = harga_quad || harga_triple || harga_double;

    // Tanggal
    let tglISO = '';
    let tglDisplay = ''; // versi rapi "26 November 2026" -- dipakai di caption WA (baris "📅 ...")
    const BULAN = {
        januari: '01', februari: '02', maret: '03', april: '04',
        mei: '05', juni: '06', juli: '07', agustus: '08',
        september: '09', oktober: '10', november: '11', desember: '12'
    };
    // Reverse lookup (nomor bulan -> nama bulan dengan kapitalisasi baku),
    // dipakai supaya tglDisplay konsisten rapi walau broadcast asli menulis
    // nama bulan dengan huruf kecil semua ("november") atau ALL CAPS.
    const BULAN_NAMA = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    for (const l of lines) {
        let m = l.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
        if (m) {
            const bln = BULAN[m[3].toLowerCase()];
            if (bln) {
                tglISO = m[4] + '-' + bln + '-' + m[2].padStart(2, '0');
                tglDisplay = `${parseInt(m[2], 10)} ${BULAN_NAMA[parseInt(bln, 10) - 1]} ${m[4]}`;
                break;
            }
        }
        m = l.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
        if (m) {
            const bln = BULAN[m[2].toLowerCase()];
            if (bln) {
                tglISO = m[3] + '-' + bln + '-' + m[1].padStart(2, '0');
                tglDisplay = `${parseInt(m[1], 10)} ${BULAN_NAMA[parseInt(bln, 10) - 1]} ${m[3]}`;
                break;
            }
        }
    }

    // Hotel
    // Dukung 2 format broadcast:
    // 1) Inline: "Hotel Madinah: Al Ansar Platinum" (satu baris, ada titik dua)
    // 2) Header terpisah: "HOTEL MADINAH 3HR" lalu baris berikutnya = nama hotel,
    //    lalu baris berikutnya lagi (opsional) = jarak dalam kurung, misal
    //    "(200m 3 menit jalan kaki)" — format ini yang sebelumnya tidak kebaca.
    let hotel_makkah = '', hotel_madinah = '';
    let hotel_makkah_hari = '', hotel_madinah_hari = '';
    let hotel_makkah_jarak = '', hotel_madinah_jarak = '';
    const isMakkahHeader = s => /hotel\s*m[ae]k+ah/i.test(s) && !/[:\-]/.test(s);
    const isMadinahHeader = s => /hotel\s*mad[iy]nah/i.test(s) && !/[:\-]/.test(s);
    const parseJarak = (txt) => {
        const m = txt.match(/\(([^)]*(?:m|km|meter)[^)]*)\)/i) || txt.match(/(\d+\s*m[^,\n]*(?:jalan|menit)[^,\n]*)/i);
        return m ? m[1].trim() : '';
    };
    const parseHariHotel = (txt) => {
        const m = txt.match(/(\d+)\s*[Hh]/);
        return m ? m[1] : '';
    };
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const lc = cleanAll(l).toLowerCase();
        const mMakkah = l.match(/hotel\s*m[ae]k+ah[^:]*[:\-]\s*(.+)/i);
        if (mMakkah && !hotel_makkah) { hotel_makkah = cleanAll(mMakkah[1]); continue; }
        const mMadinah = l.match(/hotel\s*mad[iy]nah[^:]*[:\-]\s*(.+)/i);
        if (mMadinah && !hotel_madinah) { hotel_madinah = cleanAll(mMadinah[1]); continue; }
        // Header baris terpisah (tanpa titik dua): baris berikutnya = nama hotel
        if (isMakkahHeader(lc) && !hotel_makkah && i + 1 < lines.length) {
            hotel_makkah_hari = parseHariHotel(lc);
            hotel_makkah = cleanAll(lines[i + 1]);
            if (i + 2 < lines.length) hotel_makkah_jarak = parseJarak(lines[i + 2]);
            continue;
        }
        if (isMadinahHeader(lc) && !hotel_madinah && i + 1 < lines.length) {
            hotel_madinah_hari = parseHariHotel(lc);
            hotel_madinah = cleanAll(lines[i + 1]);
            if (i + 2 < lines.length) hotel_madinah_jarak = parseJarak(lines[i + 2]);
            continue;
        }
        // Baris jarak standalone yang belum kepasang (jaga-jaga kalau bukan persis baris i+2)
        if (hotel_makkah && !hotel_makkah_jarak) { const j = parseJarak(l); if (j) hotel_makkah_jarak = j; }
        if (hotel_madinah && !hotel_madinah_jarak) { const j = parseJarak(l); if (j) hotel_madinah_jarak = j; }
    }
    // Gabung nama hotel + malam + jarak jadi satu string siap pakai di field
    // Akomodasi Hotel & caption, format: "Nama Hotel (X malam, jarak)".
    const combineHotel = (nama, hari, jarak) => {
        if (!nama) return '';
        if (!jarak) jarak = lookupHotelDetailJarak(nama); // broadcast tak menyebut jarak -> ambil dari pustaka hotel
        const detail = [];
        if (hari) detail.push(hari + ' malam');
        if (jarak) detail.push(jarak);
        return detail.length ? `${nama} (${detail.join(', ')})` : nama;
    };
    const hotel_makkah_full = combineHotel(hotel_makkah, hotel_makkah_hari, hotel_makkah_jarak);
    const hotel_madinah_full = combineHotel(hotel_madinah, hotel_madinah_hari, hotel_madinah_jarak);
    // Hotel tambahan (ke-3 & ke-4): hotel lain di broadcast selain Makkah &
    // Madinah utama di atas (mis. hotel Makkah kedua, atau hotel Jeddah/transit).
    const hotelExtraAll = pickExtraHotels(extractBroadcastHotels(lines), [hotel_makkah, hotel_madinah])
        .map(h => ({ kota: h.kota, nama: combineHotel(h.nama, h.hari, h.jarak) }));
    const hotelExtras = hotelExtraAll.slice(0, 2);

    // Termasuk & Tidak Termasuk
    let termasuk = [], tidak_termasuk = [];
    let mode = null;
    // Baris disclaimer umum (harga/jadwal sewaktu-waktu berubah, dsb) BUKAN item
    // "Tidak Termasuk" — kalau ketemu, hentikan mode capture & simpan ke Catatan Admin
    // supaya tidak ikut tersapu jadi item termasuk/tidak termasuk.
    let catatan_admin = '';
    const isDisclaimerLine = s => /sewaktu[\s-]*waktu.*berubah|berubah.*sewaktu[\s-]*waktu|kurs\s*(dolar|usd|riyal|sar)|ketentuan\s*(saudi|pemerintah|maskapai)/i.test(s);
    for (const l of lines) {
        const lc = cleanAll(l).toLowerCase();
        if (isDisclaimerLine(lc)) {
            if (!catatan_admin) catatan_admin = cleanAll(l).replace(/^\*+/, '').replace(/^[-•✓]\s*/, '').trim();
            mode = null;
            continue;
        }
        if (/tidak\s*termasuk|belum\s*termasuk/i.test(lc)) { mode = 'tidak'; continue; }
        if (/sudah\s*termasuk|biaya\s*termasuk|^termasuk$|include|fasilitas/i.test(lc)) { mode = 'termasuk'; continue; }
        if (!mode) continue;
        const isItem = /^\*[^*]/.test(l) || /^[-•✓✈🕌🚌🍽️★]/.test(l) || /^\d+\./.test(l);
        if (isItem) {
            const item = l.replace(/^\*+/, '').replace(/\*+$/, '').replace(/^[-•✓✈🕌🚌🍽️★]\s*/, '').replace(/^\d+\.\s*/, '').trim();
            if (item && item.length > 1) {
                if (mode === 'termasuk') termasuk.push(item);
                else tidak_termasuk.push(item);
            }
        }
    }

    // Isi form
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    setVal('admin_nama', nama);
    setVal('admin_durasi', durasi);
    setVal('admin_harga_quint', harga_quint);
    setVal('admin_harga_quad', harga_quad);
    setVal('admin_harga_triple', harga_triple);
    setVal('admin_harga_double', harga_double);
    ['admin_harga_quint', 'admin_harga_quad', 'admin_harga_triple', 'admin_harga_double'].forEach(id => {
        formatRupiahInput(document.getElementById(id));
    });
    setVal('admin_hotel_makkah', hotel_makkah_full);
    setVal('admin_hotel_madinah', hotel_madinah_full);
    // Validasi otomatis vs data referensi Hotel Saudi Arabia (lihat 21c) --
    // pakai nama hotel murni (hotel_makkah/hotel_madinah, sebelum digabung
    // dengan malam & jarak) supaya pencocokan lebih akurat.
    if (hotel_makkah) { ensureHotelReferenceLoaded().then(() => updateHotelRefHint('admin_hotel_makkah', 'hotelRefHint_makkah', 'makkah')); }
    if (hotel_madinah) { ensureHotelReferenceLoaded().then(() => updateHotelRefHint('admin_hotel_madinah', 'hotelRefHint_madinah', 'madinah')); }
    applyHotelExtrasToForm(hotelExtras);
    if (termasuk.length) setVal('admin_termasuk', termasuk.join('\n'));
    if (tidak_termasuk.length) setVal('admin_tidak_termasuk', tidak_termasuk.join('\n'));
    if (catatan_admin) setVal('admin_catatan_cx', catatan_admin);

    if (tglISO) {
        const tglInput = document.getElementById('admin_tgl_date');
        if (tglInput) { tglInput.value = tglISO; tglInput.dispatchEvent(new Event('change')); }
    }

    const sel = document.getElementById('admin_maskapai');
    if (sel && maskapai) {
        const opts = Array.from(sel.options);
        const kata = maskapai.toLowerCase().split(' ')[0];
        const found = opts.find(o => o.value.toLowerCase().includes(kata));
        if (found) sel.value = found.value;
    }

    // Generate teks WA
    const parsedData = {
        nama, durasi, tgl: tglDisplay, maskapai, harga_quad, harga_triple, harga_double, harga_quint,
        hotel_makkah: hotel_makkah_full, hotel_madinah: hotel_madinah_full,
        ...hotelExtraDataFields(hotelExtras),
        termasuk: termasuk.join('\n'),
        tidak_termasuk: tidak_termasuk.join('\n')
    };
    document.getElementById('admin_teks_wa').value = generateAutoWAText(parsedData);
    updateWaCaptionGauge(document.getElementById('admin_teks_wa').value);
    autoGrowTextarea(document.getElementById('admin_teks_wa'));
    // Kotak "Teks Broadcast Asli" di sebelah hasil generate mengambil dari
    // parseBroadcastInput (bukan `raw` yang sudah dinormalisasi) supaya admin
    // membandingkan hasil generate dengan pesan broadcast persis apa adanya.
    syncBroadcastRefBox();

    const parts = [];
    if (nama) parts.push('Nama');
    if (durasi) parts.push('Durasi');
    if (maskapai) parts.push('Maskapai');
    if (harga_quint) parts.push('Harga Quint');
    if (harga_quad) parts.push('Quad');
    if (harga_triple) parts.push('Triple');
    if (harga_double) parts.push('Double');
    if (hotel_makkah) parts.push('Hotel Makkah');
    if (hotel_madinah) parts.push('Hotel Madinah');
    hotelExtras.forEach((h, i) => parts.push('Hotel ' + (i + 3)));
    if (tglISO) parts.push('Tanggal');
    if (termasuk.length) parts.push('Fasilitas (' + termasuk.length + ' item)');

    const status = document.getElementById('parseStatus');
    status.textContent = '✓ Terisi: ' + parts.join(', ');
    status.style.display = 'inline';
    setTimeout(() => status.style.display = 'none', 6000);
    showToast('Form berhasil diisi otomatis (' + parts.length + ' field)');
    if (hotelExtraAll.length > hotelExtras.length) {
        showToast(`Ada ${hotelExtraAll.length} hotel tambahan di broadcast, hanya 2 yang dimuat (Hotel 3 & 4). Cek manual sisanya.`, 'info');
    }
}

// Versi AI dari parseBroadcastText() di atas -- dipanggil lewat tombol
// terpisah "Parse dengan AI" (parseBroadcastText() regex-based tetap ada
// sebagai tombol "Isi Otomatis", dua-duanya dibiarkan berdampingan karena
// AI butuh koneksi + kena limit Gemini, sedangkan versi regex selalu jalan
// instan offline sebagai cadangan).
// Edge Function: PARSE_BROADCAST_AI_FUNCTION_URL (supabase/functions/parse-broadcast-ai).
async function parseBroadcastTextAI() {
    await ensureHotelDetailsLoaded(); // pustaka detail hotel harus siap sebelum hasil AI digabung (combineHotel)
    const btn = document.getElementById('btnParseBroadcastAI');
    const btnText = document.getElementById('btnParseBroadcastAIText');
    const rawInput = document.getElementById('parseBroadcastInput').value.trim();
    if (!rawInput) { showToast('Paste teks broadcast dulu', 'error'); return; }

    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = 'Membaca...';

    try {
        const response = await fetch(PARSE_BROADCAST_AI_FUNCTION_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": "Bearer " + SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ text: rawInput })
        });
        if (!response.ok) {
            let detail = '';
            try { detail = (await response.json()).error || ''; } catch (e) {}
            throw new Error(detail || 'Gagal memanggil API (status ' + response.status + ')');
        }
        const data = await response.json();
        const f = data.fields;
        if (!f) throw new Error('Tidak ada hasil dari model.');
        // Standarisasi ejaan "Umrah" -> "Umroh" di SEMUA field hasil AI (nama, termasuk,
        // tidak termasuk, catatan, dll), sama seperti tombol "Isi Otomatis" -- model
        // kadang tetap menulis "Umrah" mengikuti teks broadcast asli.
        Object.keys(f).forEach(k => {
            if (typeof f[k] === 'string') f[k] = normalizeUmrohSpelling(f[k]);
            else if (Array.isArray(f[k])) f[k] = f[k].map(x => typeof x === 'string' ? normalizeUmrohSpelling(x) : x);
        });

        // Isi form -- sama persis dengan bagian akhir parseBroadcastText(),
        // cuma sumber datanya dari field hasil ekstraksi AI (nama field
        // sedikit berbeda, lihat kontrak di supabase/functions/parse-broadcast-ai).
        const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
        setVal('admin_nama', f.nama);
        setVal('admin_durasi', f.durasi);
        setVal('admin_harga_quint', f.harga_quint);
        setVal('admin_harga_quad', f.harga_quad);
        setVal('admin_harga_triple', f.harga_triple);
        setVal('admin_harga_double', f.harga_double);
        ['admin_harga_quint', 'admin_harga_quad', 'admin_harga_triple', 'admin_harga_double'].forEach(id => {
            formatRupiahInput(document.getElementById(id));
        });

        const combineHotel = (nama, hari, jarak) => {
            if (!nama) return '';
            if (!jarak) jarak = lookupHotelDetailJarak(nama); // hasil AI tak menyebut jarak -> ambil dari pustaka hotel
            const detail = [];
            if (hari) detail.push(hari + ' malam');
            if (jarak) detail.push(jarak);
            return detail.length ? `${nama} (${detail.join(', ')})` : nama;
        };
        const hotelMakkahFull = combineHotel(f.hotel_makkah, f.hotel_makkah_hari, f.hotel_makkah_jarak);
        const hotelMadinahFull = combineHotel(f.hotel_madinah, f.hotel_madinah_hari, f.hotel_madinah_jarak);
        setVal('admin_hotel_makkah', hotelMakkahFull);
        setVal('admin_hotel_madinah', hotelMadinahFull);
        // Validasi otomatis vs data referensi Hotel Saudi Arabia, sama seperti parseBroadcastText().
        if (f.hotel_makkah) { ensureHotelReferenceLoaded().then(() => updateHotelRefHint('admin_hotel_makkah', 'hotelRefHint_makkah', 'makkah')); }
        if (f.hotel_madinah) { ensureHotelReferenceLoaded().then(() => updateHotelRefHint('admin_hotel_madinah', 'hotelRefHint_madinah', 'madinah')); }

        // Hotel tambahan (ke-3 & ke-4). Kalau Edge Function AI mengembalikan
        // hotel_3/hotel_3_kota/hotel_3_hari/hotel_3_jarak (dan hotel_4...), pakai itu.
        // Kalau tidak (Edge Function belum diperbarui), cari sendiri dari teks
        // broadcast dengan pembaca regex yang sama seperti tombol "Isi Otomatis".
        let hotelExtraAll = [];
        ADMIN_HOTEL_EXTRA_SLOTS.forEach(n => {
            if (f[`hotel_${n}`]) {
                hotelExtraAll.push({
                    kota: normalizeHotelKota(f[`hotel_${n}_kota`]),
                    nama: combineHotel(f[`hotel_${n}`], f[`hotel_${n}_hari`], f[`hotel_${n}_jarak`])
                });
            }
        });
        if (!hotelExtraAll.length) {
            const rawLines = normalizePpAbbreviation(normalizeUmrohSpelling(rawInput)).split('\n').map(l => l.trim()).filter(l => l);
            hotelExtraAll = pickExtraHotels(extractBroadcastHotels(rawLines), [f.hotel_makkah, f.hotel_madinah])
                .map(h => ({ kota: h.kota, nama: combineHotel(h.nama, h.hari, h.jarak) }));
        }
        const hotelExtras = hotelExtraAll.slice(0, 2);
        applyHotelExtrasToForm(hotelExtras);

        if (f.termasuk && f.termasuk.length) setVal('admin_termasuk', f.termasuk.join('\n'));
        if (f.tidak_termasuk && f.tidak_termasuk.length) setVal('admin_tidak_termasuk', f.tidak_termasuk.join('\n'));
        if (f.catatan_admin) setVal('admin_catatan_cx', f.catatan_admin);

        if (f.tgl_iso) {
            const tglInput = document.getElementById('admin_tgl_date');
            if (tglInput) { tglInput.value = f.tgl_iso; tglInput.dispatchEvent(new Event('change')); }
        }

        const sel = document.getElementById('admin_maskapai');
        if (sel && f.maskapai) {
            const opts = Array.from(sel.options);
            const kata = f.maskapai.toLowerCase().split(' ')[0];
            const found = opts.find(o => o.value.toLowerCase().includes(kata));
            if (found) sel.value = found.value;
        }

        // Generate teks WA (fallback lokal non-AI -- sama seperti parseBroadcastText(),
        // supaya konsisten; kalau admin mau caption versi AI kreatif, tetap
        // pakai tombol "Generate dengan AI" terpisah di sebelah kotak Teks WA).
        const parsedData = {
            nama: f.nama, durasi: f.durasi, tgl: f.tgl_display, maskapai: f.maskapai,
            harga_quad: f.harga_quad, harga_triple: f.harga_triple, harga_double: f.harga_double, harga_quint: f.harga_quint,
            hotel_makkah: hotelMakkahFull, hotel_madinah: hotelMadinahFull,
            ...hotelExtraDataFields(hotelExtras),
            termasuk: (f.termasuk || []).join('\n'),
            tidak_termasuk: (f.tidak_termasuk || []).join('\n')
        };
        document.getElementById('admin_teks_wa').value = generateAutoWAText(parsedData);
        updateWaCaptionGauge(document.getElementById('admin_teks_wa').value);
        autoGrowTextarea(document.getElementById('admin_teks_wa'));
        syncBroadcastRefBox();

        const parts = [];
        if (f.nama) parts.push('Nama');
        if (f.durasi) parts.push('Durasi');
        if (f.maskapai) parts.push('Maskapai');
        if (f.harga_quint) parts.push('Harga Quint');
        if (f.harga_quad) parts.push('Quad');
        if (f.harga_triple) parts.push('Triple');
        if (f.harga_double) parts.push('Double');
        if (f.hotel_makkah) parts.push('Hotel Makkah');
        if (f.hotel_madinah) parts.push('Hotel Madinah');
        hotelExtras.forEach((h, i) => parts.push('Hotel ' + (i + 3)));
        if (f.tgl_iso) parts.push('Tanggal');
        if (f.termasuk && f.termasuk.length) parts.push('Fasilitas (' + f.termasuk.length + ' item)');

        const status = document.getElementById('parseStatus');
        status.textContent = '✓ (AI) Terisi: ' + parts.join(', ');
        status.style.display = 'inline';
        setTimeout(() => status.style.display = 'none', 6000);
        showToast('Form berhasil diisi otomatis dengan AI (' + parts.length + ' field)');
        if (hotelExtraAll.length > hotelExtras.length) {
            showToast(`Ada ${hotelExtraAll.length} hotel tambahan di broadcast, hanya 2 yang dimuat (Hotel 3 & 4). Cek manual sisanya.`, 'info');
        }
    } catch (err) {
        console.error(err);
        // Fallback: kalau AI gagal (Gemini error/limit habis/internet putus),
        // jatuhkan ke parser regex biasa supaya admin tetap terbantu.
        showToast('AI gagal (' + err.message + ') — dipakai parser biasa sebagai cadangan', 'error');
        parseBroadcastText();
    } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'Parse dengan AI';
    }
}

// ============================================================
// 16. EXPORT / IMPORT
// ============================================================
async function exportAdminData() {
    showToast('Menyiapkan backup...');
    try {
        const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY };
        const res = await fetch(`${SUPABASE_URL}/rest/v1/programs?select=*&order=created_at.asc`, { headers });
        const rawPrograms = res.ok ? await res.json() : [];
        // Buang field yang sudah tidak dipakai lagi (mis. link_metaads, link_dokumentasi)
        // dari hasil backup, meski kolomnya masih ada di database.
        const backup = {
            _meta: { app: 'Dashboard Amiru', exported_at: new Date().toISOString(), version: '2.1' },
            programs: rawPrograms.map(p => pickAllowedColumns(p, PROGRAM_COLUMNS))
        };
        // Sertakan juga tabel lain supaya backup bisa dipulihkan utuh (lihat importAdminData).
        // pembayaran_jamaah (riwayat bayar/cicilan) disertakan di sini juga supaya
        // konsisten dengan SNAPSHOT_TABLES di bawah -- sebelumnya cuma masuk snapshot,
        // tidak ikut ter-backup/restore lewat export-import manual.
        for (const tbl of ['jadwal_tamu', 'kb_jamaah', 'pendaftaran', 'pembayaran_jamaah', 'featured_programs']) {
            try {
                const r = await fetch(`${SUPABASE_URL}/rest/v1/${tbl}?select=*&order=created_at.asc`, { headers });
                backup[tbl] = r.ok ? await r.json() : [];
            } catch (e) {
                backup[tbl] = [];
            }
        }
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `amiru_backup_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast(`Backup berhasil — ${backup.programs.length} program`);
    } catch (err) {
        showToast('Gagal backup: ' + err.message, 'error');
    }
}

function isValidUUID(str) {
    return typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// Kolom yang benar-benar ada di tabel `programs` (lihat sql/01_setup_semua_tabel.sql).
// File backup dari versi/tool lain bisa saja punya field tambahan (mis. field lama
// yang sudah tidak dipakai seperti "link_form", "link_metaads", "link_dokumentasi",
// atau "updated_at") -- field begitu HARUS dibuang sebelum upsert, karena
// Supabase/PostgREST menolak seluruh request kalau ada kolom yang tidak dikenal.
// link_metaads & link_dokumentasi sengaja TIDAK dimasukkan lagi di sini (fitur link
// Meta Ads/Dokumentasi sudah dihapus dari form admin) supaya export/import juga
// tidak lagi menyertakan/memulihkan data lama di kolom tersebut.
const PROGRAM_COLUMNS = [
    'id', 'nama', 'tgl', 'durasi', 'maskapai', 'harga_quint',
    'link_poster', 'poster_version', 'link_itinerary',
    'teks_wa', 'admin_data_lengkap', 'is_active', 'kuota_pax', 'created_at'
];
function pickAllowedColumns(obj, allowed) {
    const out = {};
    for (const k of allowed) { if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]; }
    return out;
}

// Import satu batch program, kembalikan {ok, failed:[{nama,reason}]}
async function importProgramList(list) {
    let ok = 0;
    const failed = [];
    for (const progRaw of list) {
        const prog = pickAllowedColumns(progRaw, PROGRAM_COLUMNS);
        const nama = prog.nama || '(tanpa nama)';
        if (!prog.nama || !isValidProgramName(prog.nama)) {
            failed.push({ nama, reason: 'Nama program kosong atau mengandung karakter tidak valid' });
            continue;
        }
        // ID lama non-UUID (mis. "prog_xxx") tidak kompatibel dengan kolom uuid di Supabase.
        // Buang id-nya supaya Supabase generate UUID baru otomatis (insert sebagai program baru).
        if (prog.id && !isValidUUID(prog.id)) {
            delete prog.id;
        }
        try {
            const { error } = await supabaseClient.from('programs').upsert([prog], { onConflict: 'id' });
            if (!error) ok++;
            else failed.push({ nama, reason: error.message || 'Error tidak diketahui dari Supabase' });
        } catch (err) {
            failed.push({ nama, reason: err.message || 'Error tidak diketahui' });
        }
    }
    return { ok, failed };
}

function showImportResult(ok, failed, otherResults) {
    const otherOk = (otherResults || []).filter(r => r.ok);
    const otherFailed = (otherResults || []).filter(r => !r.ok);
    const otherOkText = otherOk.map(r => `${r.count} ${TABLE_LABEL[r.tbl] || r.tbl}`).join(', ');

    if (!failed.length && !otherFailed.length) {
        showToast(`Import selesai — ${ok} program${otherOkText ? ', ' + otherOkText : ''}`);
        return;
    }
    const list = failed.map(f => `• ${f.nama} — ${f.reason}`).join('\n');
    const otherList = otherFailed.map(f => `• ${TABLE_LABEL[f.tbl] || f.tbl} — ${f.reason}`).join('\n');
    showToast(`Import selesai — sebagian gagal, lihat detail`, 'error');
    const detail = `Hasil import:\n\n${ok} program berhasil${otherOkText ? ', ' + otherOkText : ''}.\n${failed.length ? `\nProgram GAGAL (${failed.length}):\n${list}\n` : ''}${otherFailed.length ? `\nData lain GAGAL:\n${otherList}` : ''}`;
    openActionConfirm({ title: 'Hasil Import', message: `<div style="white-space:pre-line;max-height:50vh;overflow:auto;">${escapeHtml(detail)}</div>`, confirmLabel: 'Tutup', danger: false, hideCancel: true });
}

// Tabel opsional selain "programs" yang mungkin ada di file backup (mis. hasil
// export dari versi lain / tool lain) -- diimport kalau ada datanya, dilewati
// kalau tidak ada supaya backup lama (yang hanya berisi programs) tetap kompatibel.
// Urutan penting: kb_jamaah harus lebih dulu dari pembayaran_jamaah (FK jamaah_id),
// dan programs (diimport terpisah di pemanggil) harus lebih dulu dari semuanya.
const OPTIONAL_IMPORT_TABLES = ['jadwal_tamu', 'kb_jamaah', 'pembayaran_jamaah', 'pendaftaran', 'featured_programs'];
const TABLE_LABEL = {
    jadwal_tamu: 'jadwal tamu',
    kb_jamaah: 'data jamaah',
    pembayaran_jamaah: 'pembayaran & cicilan',
    pendaftaran: 'pendaftaran',
    featured_programs: 'program unggulan'
};
// Kolom asli tiap tabel (lihat sql/01_setup_semua_tabel.sql + migrasi sql/tambah_*.sql) --
// sama seperti PROGRAM_COLUMNS, dipakai untuk membuang field asing dari file backup
// supaya upsert tidak ditolak Supabase gara-gara kolom yang tidak dikenal.
const OPTIONAL_TABLE_COLUMNS = {
    jadwal_tamu: ['id', 'nama', 'tgl', 'jam', 'asal', 'jumlah', 'keperluan', 'wa', 'catatan', 'created_at'],
    kb_jamaah: [
        'id', 'program_id', 'nama', 'nik', 'paspor', 'wa', 'asal', 'tipe_kamar', 'harga_custom', 'status', 'catatan',
        'dokumen', 'created_at', 'jenis_kelamin', 'tempat_lahir', 'tgl_lahir', 'alamat', 'kode_pos', 'telp_rumah',
        'ahli_waris_nama', 'ahli_waris_hubungan', 'pendaftaran_id', 'paspor_exp', 'visa_status',
        // Kolom baru: nomor kamar, status kepulangan (sql/11_tambah_nomor_kamar_kb_jamaah.sql,
        // sql/13_tambah_status_kepulangan_kb_jamaah.sql), dan arsip jamaah (sql/17_tambah_arsip_jamaah.sql)
        'nomor_kamar', 'status_kepulangan', 'tgl_berangkat_aktual', 'tgl_pulang_aktual', 'catatan_kepulangan',
        'diarsipkan', 'diarsipkan_at'
    ],
    pembayaran_jamaah: [
        'id', 'jamaah_id', 'tanggal', 'jumlah', 'metode', 'keterangan', 'created_at',
        // nomor_kuitansi & nomor_nota diisi otomatis oleh trigger DB kalau kosong (lihat
        // sql/19_tambah_nota_audit.sql) -- disertakan di sini supaya nomor lama yang sudah
        // terbit tetap konsisten saat dipulihkan, bukan supaya bisa diubah manual.
        'nomor_kuitansi', 'nomor_nota'
    ],
    pendaftaran: [
        'id', 'program_id', 'nama', 'wa', 'asal', 'status', 'catatan', 'created_at',
        // Kolom F4 (sql/07_tambah_field_pendaftaran_f4.sql)
        'tanggal_daftar', 'ktp', 'jenis_kelamin', 'tempat_lahir', 'tgl_lahir', 'alamat', 'kode_pos',
        'telp_rumah', 'ahli_waris_nama', 'ahli_waris_hubungan'
    ],
    featured_programs: ['id', 'program_id', 'created_at']
};

// Import tabel-tabel opsional (selain programs) dari objek backup, upsert by id.
// Program HARUS sudah diimport lebih dulu (lihat pemanggil) karena kb_jamaah &
// featured_programs mereferensikan program_id lewat foreign key.
async function importOtherTables(imported) {
    const results = [];
    for (const tbl of OPTIONAL_IMPORT_TABLES) {
        const rows = Array.isArray(imported[tbl]) ? imported[tbl] : [];
        if (!rows.length) continue;
        const allowedCols = OPTIONAL_TABLE_COLUMNS[tbl] || null;
        const clean = rows.filter(r => r && typeof r === 'object').map(r => {
            const c = allowedCols ? pickAllowedColumns(r, allowedCols) : { ...r };
            // id lama non-UUID tidak kompatibel dengan kolom uuid -> buang supaya
            // Supabase generate UUID baru (insert sebagai baris baru).
            if (c.id && !isValidUUID(c.id)) delete c.id;
            return c;
        });
        if (!clean.length) continue;
        try {
            const { error } = await supabaseClient.from(tbl).upsert(clean, { onConflict: 'id' });
            if (error) results.push({ tbl, ok: false, count: 0, reason: error.message || 'Error tidak diketahui' });
            else results.push({ tbl, ok: true, count: clean.length });
        } catch (err) {
            results.push({ tbl, ok: false, count: 0, reason: err.message || 'Error tidak diketahui' });
        }
    }
    return results;
}

function importAdminData() {
    if (currentRole !== 'admin') { showToast('Hanya Admin yang boleh import data', 'error'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > MAX_FILE_SIZE) { showToast('File terlalu besar! Maksimal 5MB.', 'error'); return; }
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const imported = JSON.parse(event.target.result);
                const hasPrograms = imported && Array.isArray(imported.programs);
                const hasOtherData = imported && OPTIONAL_IMPORT_TABLES.some(t => Array.isArray(imported[t]) && imported[t].length);
                if (imported && imported._meta && (hasPrograms || hasOtherData)) {
                    const counts = [`${(imported.programs || []).length} program`];
                    OPTIONAL_IMPORT_TABLES.forEach(t => {
                        const n = Array.isArray(imported[t]) ? imported[t].length : 0;
                        if (n) counts.push(`${n} ${TABLE_LABEL[t]}`);
                    });
                    if (!(await openActionConfirm({
                        title: 'Restore Backup?',
                        message: `Restore backup dari <strong>${escapeHtml(new Date(imported._meta.exported_at).toLocaleString('id-ID'))}</strong>?<br><br>• ${counts.map(c => escapeHtml(c)).join('<br>• ')}<br><br>Data yang ada <strong>TIDAK</strong> akan dihapus, hanya ditambah/diperbarui.<br><br>Snapshot pengaman dibuat dulu; kalau gagal, restore dibatalkan.`,
                        confirmLabel: 'Restore Backup',
                        danger: false
                    }))) return;
                    if (!(await ensureAutoSnapshot('auto-pre-import', 'Auto sebelum Import'))) {
                        showToast('Restore DIBATALKAN — snapshot pengaman gagal dibuat, tidak ada data yang diubah. Coba lagi.', 'error');
                        return;
                    }
                    showToast('Mengimport data...');
                    const { ok, failed } = await importProgramList(imported.programs || []);
                    // Program diimport dulu (di atas) baru tabel lain, supaya foreign key
                    // program_id di kb_jamaah/featured_programs valid.
                    const otherResults = await importOtherTables(imported);
                    await loadDataFromSupabase(true);
                    if (typeof loadKbJamaah === 'function') { try { await loadKbJamaah(); } catch (e2) {} }
                    if (typeof loadJadwal === 'function') { try { await loadJadwal(); } catch (e2) {} }
                    if (typeof loadPendaftaran === 'function') { try { await loadPendaftaran(); } catch (e2) {} }
                    if (typeof loadFeaturedIds === 'function') { try { await loadFeaturedIds(); } catch (e2) {} }
                    await renderAdminPanel();
                    showImportResult(ok, failed, otherResults);
                } else if (Array.isArray(imported)) {
                    if (!(await openActionConfirm({
                        title: 'Import Program?',
                        message: `Import <strong>${imported.length} program</strong> ke database?`,
                        confirmLabel: 'Import',
                        danger: false
                    }))) return;
                    const { ok, failed } = await importProgramList(imported);
                    await loadDataFromSupabase(true);
                    await renderAdminPanel();
                    showImportResult(ok, failed);
                } else {
                    showToast('Format file tidak dikenali', 'error');
                }
            } catch (err) {
                showToast('Gagal: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// ============================================================
// 16B. SNAPSHOT BACKUP (cadangan harian semua data Umroh)
// ============================================================
// Menyimpan snapshot lengkap seluruh data Umroh ke tabel Supabase
// `snapshot_backup` (jsonb). Maksimal MAX_SNAPSHOTS snapshot terbaru
// (FIFO) — snapshot tertua otomatis dihapus saat batas tercapai.
// Snapshot otomatis diambil SEBELUM tindakan berisiko (hapus semua /
// import) supaya ada cadangan berjaga-jaga.
const MAX_SNAPSHOTS = 10;
const SNAPSHOT_TABLES = ['programs', 'kb_jamaah', 'jadwal_tamu', 'pendaftaran', 'pembayaran_jamaah', 'featured_programs'];

// Ambil seluruh baris dari semua tabel terkait dalam satu objek.
// strict=false (snapshot manual/harian): tabel yang gagal dimuat disimpan kosong.
// strict=true (snapshot pengaman sebelum Hapus Semua/Import): satu tabel gagal
// dimuat -> lempar error, supaya snapshot yang "berhasil" tidak pernah ternyata
// cadangan yang bolong (dan aksi berisiko di belakangnya ikut dibatalkan).
async function collectAllUmrohData(strict = false) {
    const data = {};
    for (const tbl of SNAPSHOT_TABLES) {
        try {
            const { data: rows, error } = await withRetry(
                () => supabaseClient.from(tbl).select('*'),
                { label: 'Snapshot: muat ' + tbl }
            );
            if (error) throw error;
            data[tbl] = rows || [];
        } catch (err) {
            console.error('collectAllUmrohData error on', tbl, err);
            if (strict) throw new Error('tabel ' + tbl + ' gagal dimuat (' + (err.message || err) + ')');
            data[tbl] = [];
        }
    }
    return data;
}

async function takeSnapshot(label = 'Snapshot', trigger = 'manual', strict = false) {
    try {
        showToast('Membuat snapshot...', 'info');
        const payload = await collectAllUmrohData(strict);
        const totalRows = SNAPSHOT_TABLES.reduce((s, t) => s + (payload[t] ? payload[t].length : 0), 0);
        const { error } = await supabaseClient.from('snapshot_backup').insert([{
            label: String(label).slice(0, 80),
            trigger: String(trigger).slice(0, 40),
            data: payload,
            meta: { total_rows: totalRows, tables: SNAPSHOT_TABLES }
        }]);
        if (error) throw error;

        // Trim FIFO: simpan hanya MAX_SNAPSHOTS terbaru
        const { data: all, error: listErr } = await supabaseClient
            .from('snapshot_backup').select('id, created_at').order('created_at', { ascending: true });
        if (!listErr && all && all.length > MAX_SNAPSHOTS) {
            const excess = all.slice(0, all.length - MAX_SNAPSHOTS);
            for (const row of excess) {
                await supabaseClient.from('snapshot_backup').delete().eq('id', row.id);
            }
        }
        showToast('✅ Snapshot tersimpan (' + totalRows + ' baris)');
        return true;
    } catch (err) {
        console.error('takeSnapshot error:', err);
        showToast('❌ Gagal membuat snapshot: ' + (err.message || err), 'error');
        return false;
    }
}

// Ambil snapshot pengaman sebelum tindakan berisiko (mode strict: cadangan harus
// lengkap). Mengembalikan true/false -- PEMANGGIL WAJIB membatalkan aksinya kalau
// false (lihat clearAllAdminData() dan importAdminData()).
async function ensureAutoSnapshot(trigger, label) {
    const ok = await takeSnapshot(label || ('Auto: ' + trigger), trigger, true);
    if (!ok) console.warn('Auto-snapshot gagal, tindakan berisiko dibatalkan oleh pemanggil.');
    return ok;
}

async function listSnapshots() {
    const { data, error } = await supabaseClient
        .from('snapshot_backup').select('id, created_at, label, trigger, meta').order('created_at', { ascending: false });
    if (error) { console.error('listSnapshots error:', error); return []; }
    return data || [];
}

// Catatan keamanan: TIDAK ada fungsi hapus snapshot manual.
// Snapshot hanya boleh hilang secara otomatis (FIFO, lihat takeSnapshot())
// begitu jumlahnya melebihi MAX_SNAPSHOTS — supaya cadangan data tidak
// bisa dihapus sembarangan oleh admin maupun pihak lain yang menyusup.

// Pulihkan seluruh data dari satu snapshot ke semua tabel (upsert by id).
async function restoreSnapshot(id) {
    if (!(await openActionConfirm({
        title: 'Pulihkan dari Snapshot?',
        message: 'Semua tabel (program, jamaah, jadwal, pendaftaran, pembayaran, unggulan) akan di-update/insert dari snapshot ini.<br><br>Baris yang ada di DB tapi tidak ada di snapshot <strong>TIDAK</strong> dihapus.',
        confirmLabel: 'Pulihkan Snapshot',
        danger: true
    }))) return;
    try {
        showToast('Memulihkan snapshot...', 'info');
        const { data: snap, error } = await supabaseClient
            .from('snapshot_backup').select('*').eq('id', id).single();
        if (error) throw error;
        const payload = (snap && snap.data) || {};
        for (const tbl of SNAPSHOT_TABLES) {
            const rows = payload[tbl] || [];
            if (!rows.length) continue;
            const clean = rows.filter(r => r && r.id).map(r => {
                const c = { ...r };
                if (c.id && !isValidUUID(c.id)) delete c.id;
                return c;
            });
            if (!clean.length) continue;
            const { error: upErr } = await supabaseClient.from(tbl).upsert(clean, { onConflict: 'id' });
            if (upErr) console.error('restoreSnapshot upsert', tbl, upErr);
        }
        await loadDataFromSupabase(true);
        if (typeof loadKbJamaah === 'function') { try { await loadKbJamaah(); } catch (e) {} }
        if (typeof loadJadwal === 'function') { try { await loadJadwal(); } catch (e) {} }
        if (typeof loadPendaftaran === 'function') { try { await loadPendaftaran(); } catch (e) {} }
        if (typeof loadFeaturedIds === 'function') { try { await loadFeaturedIds(); } catch (e) {} }
        await renderAdminPanel();
        showToast('✅ Data dipulihkan dari snapshot');
        if (adminSubTab === 'snapshot') renderSnapshotAdminTable();
    } catch (err) {
        console.error('restoreSnapshot error:', err);
        showToast('❌ Gagal pulihkan: ' + (err.message || err), 'error');
    }
}

const SNAPSHOT_TRIGGER_LABEL = {
    'manual': { text: 'Manual', color: '#1a355b', tint: '#dbe4ee' },
    'auto-daily': { text: 'Harian', color: '#279E70', tint: '#E1F5EC' },
    'auto-pre-clear': { text: 'Auto · sebelum hapus', color: '#C0392B', tint: '#FBE3E0' },
    'auto-pre-import': { text: 'Auto · sebelum import', color: '#E07B2E', tint: '#FBEBD9' }
};

// Label hari untuk header grup timeline: "Hari ini" / "Kemarin" / nama hari
// lengkap -- supaya lebih cepat dipindai dibanding tanggal mentah, terutama
// waktu ada beberapa snapshot dalam satu hari (harian + manual, dst).
function formatSnapDayLabel(d) {
    if (isNaN(d)) return '-';
    const startOfDay = x => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime(); };
    const today = startOfDay(new Date());
    const yesterday = today - 86400000;
    const tglLengkap = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    if (startOfDay(d) === today) return `Hari ini &middot; ${tglLengkap}`;
    if (startOfDay(d) === yesterday) return `Kemarin &middot; ${tglLengkap}`;
    return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function renderSnapshotAdminTable() {
    const wrap = document.getElementById('snapshotTableWrap');
    if (!wrap) return;
    wrap.innerHTML = '<div style="text-align:center;padding:18px;color:var(--ink-soft);font-size:12px;"><i class="bi bi-arrow-repeat bi-spin"></i> Memuat...</div>';
    listSnapshots().then(rows => {
        // ---- Reel kapasitas: 10 "frame" seperti gulungan film -- kiri = paling
        // tua, kanan = slot kosong yang masih tersisa. Begitu 10 slot penuh,
        // frame paling kiri (tertua) ditandai sebagai kandidat berikutnya yang
        // otomatis tergantikan (FIFO), sesuai perilaku nyata di takeSnapshot().
        const oldestToNewest = [...rows].reverse();
        const reelSlots = oldestToNewest.slice();
        while (reelSlots.length < MAX_SNAPSHOTS) reelSlots.push(null);
        const reelHtml = reelSlots.map((r, i) => {
            if (!r) return `<span class="snap-frame snap-frame-empty" title="Slot kosong"></span>`;
            const trig = SNAPSHOT_TRIGGER_LABEL[r.trigger] || { text: r.trigger || 'manual', color: '#64758A', tint: '#F4F7FB' };
            const d = new Date(r.created_at);
            const tstr = isNaN(d) ? '' : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            const isOldest = i === 0 && oldestToNewest.length >= MAX_SNAPSHOTS;
            const tip = `${r.label || 'Snapshot'} &middot; ${tstr}${isOldest ? ' &middot; akan digantikan snapshot berikutnya' : ''}`;
            return `<span class="snap-frame${isOldest ? ' snap-frame-oldest' : ''}" style="background:${trig.color};" title="${escapeHtml(tip)}"></span>`;
        }).join('');
        const reelGaugeHtml = `
            <div class="snap-reel-wrap">
                <div class="snap-reel-track">${reelHtml}</div>
                <span class="snap-reel-count">${rows.length}<em>/${MAX_SNAPSHOTS}</em></span>
            </div>`;

        if (!rows.length) {
            wrap.innerHTML = `
                ${reelGaugeHtml}
                <div class="snap-empty"><i class="bi bi-camera2"></i><span>Belum ada snapshot. Klik <b>Ambil</b> di kanan atas untuk membuat cadangan pertama.</span></div>`;
            return;
        }

        // ---- Kelompokkan per hari (data sudah urut terbaru -> tertua) ----
        const groups = [];
        let curKey = null, curGroup = null;
        rows.forEach(r => {
            const d = new Date(r.created_at);
            const key = isNaN(d) ? 'unknown' : d.toISOString().slice(0, 10);
            if (key !== curKey) {
                curGroup = { date: d, items: [] };
                groups.push(curGroup);
                curKey = key;
            }
            curGroup.items.push(r);
        });

        const groupsHtml = groups.map(g => {
            const itemsHtml = g.items.map(r => {
                const d = new Date(r.created_at);
                const tstr = isNaN(d) ? '-' : d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                const total = (r.meta && r.meta.total_rows != null) ? r.meta.total_rows : '-';
                const trig = SNAPSHOT_TRIGGER_LABEL[r.trigger] || { text: r.trigger || 'manual', color: '#64758A', tint: '#F4F7FB' };
                return `
                <div class="snap-card">
                    <span class="snap-card-dot" style="background:${trig.color};"></span>
                    <div class="snap-card-main">
                        <div class="snap-card-top">
                            <span class="snap-card-label" title="${escapeHtml(r.label || 'Snapshot')}">${escapeHtml(r.label || 'Snapshot')}</span>
                            <span class="snap-card-badge" style="color:${trig.color};background:${trig.tint};">${escapeHtml(trig.text)}</span>
                        </div>
                        <div class="snap-card-meta">${tstr} &middot; ${total} baris</div>
                    </div>
                    <button class="snap-card-restore" title="Pulihkan snapshot ini" onclick="restoreSnapshot('${r.id}')"><i class="bi bi-arrow-counterclockwise"></i></button>
                </div>`;
            }).join('');
            return `
            <div class="snap-day-group">
                <div class="snap-day-label">${formatSnapDayLabel(g.date)}</div>
                <div class="snap-timeline">${itemsHtml}</div>
            </div>`;
        }).join('');

        wrap.innerHTML = `${reelGaugeHtml}<div class="snap-groups">${groupsHtml}</div>`;
    }).catch(err => {
        wrap.innerHTML = '<div style="text-align:center;padding:18px;color:var(--danger);font-size:12px;">Gagal memuat: ' + escapeHtml(err.message || err) + '</div>';
    });
}

// Snapshot otomatis harian: throttle 1x per hari (berdasar tanggal lokal),
// sehingga tiap hari admin pertama yang buka panel otomatis menyimpan cadangan.
// Menyimpan penanda hari terakhir di localStorage agar tidak dobel dalam sehari.
const SNAP_DAILY_KEY = 'amiru_last_daily_snapshot';
async function maybeDailySnapshot() {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const last = localStorage.getItem(SNAP_DAILY_KEY);
        if (last === today) return; // sudah ada snapshot hari ini
        localStorage.setItem(SNAP_DAILY_KEY, today);
        await takeSnapshot('Harian ' + new Date().toLocaleDateString('id-ID'), 'auto-daily');
    } catch (err) {
        console.warn('maybeDailySnapshot gagal:', err);
    }
}

// ============================================================
// 17. DELETE CONFIRM
// ============================================================
// Ratakan teks konfirmasi hapus sebelum dibandingkan: Intl.NumberFormat
// (dipakai formatRupiah untuk nama konfirmasi hapus pembayaran, mis. "pembayaran
// Rp2.500.000 (2026-08-01)") kadang menyisipkan spasi tak-terputus (non-breaking
// space, U+00A0) yang tidak bisa diketik dari keyboard biasa -- kalau tidak
// dinormalisasi, tombol "Hapus Permanen" tidak akan pernah aktif walau user
// sudah mengetik ulang persis secara visual. Perbandingan juga dibuat tidak
// sensitif kapitalisasi supaya lebih toleran terhadap salah ketik kecil.
function normalizeConfirmText(str) {
    return String(str || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function openDeleteModal(table, id, name, extraWarning) {
    if (table === 'programs') {
        const jumlahJamaah = (kbJamaahList || []).filter(j => String(j.program_id) === String(id)).length;
        if (jumlahJamaah > 0) {
            showToast(`Tidak bisa hapus "${name}" — masih ada ${jumlahJamaah} jamaah terdaftar di program ini. Pindahkan atau hapus dulu data jamaahnya.`, 'error');
            return;
        }
        // Program juga tidak boleh dihapus kalau masih ada lead Pendaftaran
        // (status Baru/Dihubungi/Deal) yang menunjuk ke sini -- kalau
        // dipaksa hapus, program_id di baris pendaftaran itu jadi anak
        // hilang induk (yatim) & tampil "Belum ditentukan" tanpa penjelasan.
        const pendaftaranTerkait = (pendaftaranList || []).filter(p => String(p.program_id) === String(id) && p.status !== 'batal').length;
        if (pendaftaranTerkait > 0) {
            showToast(`Tidak bisa hapus "${name}" — masih ada ${pendaftaranTerkait} pendaftaran yang menunjuk ke program ini. Ubah program pendaftarannya dulu, atau tandai Batal.`, 'error');
            return;
        }
    }
    deleteTarget.table = table;
    deleteTarget.id = id;
    deleteTarget.name = name;
    document.getElementById('deleteConfirmLabel').textContent = `Data: ${name}`;
    document.getElementById('deleteConfirmName').textContent = `"${name}"`;
    document.getElementById('deleteConfirmInput').value = '';
    document.getElementById('deleteConfirmBtn').disabled = true;
    const warnEl = document.getElementById('deleteConfirmExtraWarning');
    if (warnEl) {
        if (extraWarning) { warnEl.textContent = extraWarning; warnEl.style.display = ''; }
        else { warnEl.textContent = ''; warnEl.style.display = 'none'; }
    }
    document.getElementById('deleteConfirmModal').classList.add('open');
}

function onDeleteConfirmInput() {
    const input = normalizeConfirmText(document.getElementById('deleteConfirmInput').value);
    document.getElementById('deleteConfirmBtn').disabled = input !== normalizeConfirmText(deleteTarget.name);
}


async function confirmDeleteAction() {
    if (!deleteTarget.id || !deleteTarget.table) return;
    if (deleteTarget.table === 'programs' && !canManageProgramData()) {
        showToast('Akun Anda tidak punya izin untuk menghapus program', 'error');
        closeDeleteConfirmModal();
        return;
    }
    if (deleteTarget.table === 'assets' && !canManageAssets()) {
        showToast('Hanya Admin yang boleh menghapus Assets', 'error');
        closeDeleteConfirmModal();
        return;
    }

    if (deleteTarget.table === 'programs') {
        // Cek ulang langsung ke database (bukan cache kbJamaahList di browser),
        // untuk jaga-jaga kalau ada jamaah yang baru saja didaftarkan oleh
        // admin/perangkat lain tepat sebelum tombol hapus ini ditekan.
        try {
            const { count, error: countErr } = await supabaseClient
                .from('kb_jamaah')
                .select('id', { count: 'exact', head: true })
                .eq('program_id', deleteTarget.id);
            if (countErr) throw countErr;
            if (count && count > 0) {
                showToast(`Tidak bisa hapus — masih ada ${count} jamaah terdaftar di program ini.`, 'error');
                closeDeleteConfirmModal();
                return;
            }
            // Sama seperti jamaah: cek ulang ke database juga untuk pendaftaran
            // yang belum Batal, jaga-jaga ada lead baru masuk barusan.
            const { count: pfCount, error: pfCountErr } = await supabaseClient
                .from('pendaftaran')
                .select('id', { count: 'exact', head: true })
                .eq('program_id', deleteTarget.id)
                .neq('status', 'batal');
            if (pfCountErr) throw pfCountErr;
            if (pfCount && pfCount > 0) {
                showToast(`Tidak bisa hapus — masih ada ${pfCount} pendaftaran yang menunjuk ke program ini.`, 'error');
                closeDeleteConfirmModal();
                return;
            }
        } catch (err) {
            console.error('Cek jamaah sebelum hapus program gagal:', err);
            showToast('Gagal memverifikasi data jamaah, coba lagi', 'error');
            closeDeleteConfirmModal();
            return;
        }
    }

    try {
        const finishedTable = deleteTarget.table;
        const finishedId = deleteTarget.id;

        // Untuk pembayaran_jamaah: ambil data barisnya SEBELUM dihapus, supaya
        // audit log (nota_audit_log) punya nilai yang akurat. Kalau diambil
        // SETELAH delete, barisnya sudah tidak ada lagi di DB -> audit selalu
        // gagal tercatat tanpa pesan error apa pun (bug lama, sudah diperbaiki).
        let cicRowSebelumHapus = null;
        if (finishedTable === 'pembayaran_jamaah') {
            const { data } = await supabaseClient
                .from('pembayaran_jamaah').select('id, jumlah, tanggal, metode, keterangan, nomor_nota, nomor_kuitansi').eq('id', finishedId).single();
            cicRowSebelumHapus = data || null;
        }

        // Untuk kb_jamaah: ambil dulu pendaftaran_id-nya (kalau jamaah ini
        // hasil konversi dari Form Pendaftaran) SEBELUM dihapus, supaya
        // setelah baris jamaah ini hilang, status pendaftaran asalnya bisa
        // disinkronkan balik ke "Baru" -- tidak nyangkut selamanya di "Deal".
        let pendaftaranIdSebelumHapus = null;
        if (finishedTable === 'kb_jamaah') {
            const { data } = await supabaseClient
                .from('kb_jamaah').select('pendaftaran_id').eq('id', finishedId).maybeSingle();
            pendaftaranIdSebelumHapus = data ? data.pendaftaran_id : null;
        }

        // [FIX] .select('id') ditambahkan supaya bisa dicek betul berapa baris
        // yang KE-HAPUS SUNGGUHAN. Tanpa ini, kalau RLS menolak (mis. sesi
        // login kedaluwarsa / role tidak lolos current_dashboard_role()),
        // Supabase tetap balas "sukses" tanpa error walau 0 baris terhapus --
        // aplikasi jadi salah menampilkan toast "berhasil dihapus" padahal
        // datanya masih ada (bug: badge kuota tetap X/45 walau "sudah dihapus").
        const result = await supabaseClient.from(finishedTable).delete().eq('id', finishedId).select('id');
        if (result.error) throw result.error;
        if (!result.data || result.data.length === 0) {
            throw new Error('Data tidak ditemukan / tidak berhasil dihapus. Kemungkinan sesi login sudah kedaluwarsa atau akun tidak punya izin — coba logout lalu login ulang.');
        }

        showToast('Data berhasil dihapus');
        closeDeleteConfirmModal();

        if (finishedTable === 'programs') {
            await loadDataFromSupabase(true);
            await renderAdminPanel();
        } else if (finishedTable === 'jadwal_tamu') {
            await loadJadwal();
            renderJadwalSection();
        } else if (finishedTable === 'pendaftaran') {
            await loadPendaftaran();
            renderPendaftaranSection();
        } else if (finishedTable === 'assets') {
            await loadAssets();
            renderAssetsAdminTable();
        } else if (finishedTable === 'kb_jamaah') {
            await loadKbJamaah();
            renderKbProgramSelector();
            renderDokProgramSelector();
            updateMetrics();
            // Badge kuota "X/45 Tersedia" di tabel Program Umroh (dan tab
            // Unggulan) dihitung ulang dari kbJamaahList setiap kali ditampilkan
            // (lihat buildProgramRowHTML), jadi tabelnya harus di-render ulang
            // di sini juga -- bukan cuma nunggu ganti tab / reload halaman.
            if (currentData && currentData.length) renderTable(currentData);
            renderFeaturedSection();

            // Sinkron balik: kalau jamaah yang baru dihapus ini tadinya hasil
            // konversi otomatis dan pendaftaran asalnya masih berstatus "Deal",
            // biarkan statusnya tetap "Deal" -- supaya begitu admin buka Edit &
            // Save lagi, otomatis dibuatkan ulang baris Data Jamaah-nya (lihat
            // autoConvertPendaftaranToJamaah, dipanggil tiap kali status
            // tersimpan sebagai "Deal" dan belum ada jamaah tertaut).
            if (pendaftaranIdSebelumHapus) {
                try {
                    const idx = pendaftaranList.findIndex(p => String(p.id) === String(pendaftaranIdSebelumHapus));
                    if (idx !== -1 && pendaftaranList[idx].status === 'deal') {
                        renderPendaftaranSection();
                        showToast('Data jamaah dihapus — pendaftaran asalnya masih "Deal", buka Edit & Simpan lagi untuk membuatkan ulang datanya', 'info');
                    }
                } catch (pErr) {
                    console.error('Sinkron balik status pendaftaran gagal:', pErr);
                }
            }
        } else if (finishedTable === 'pembayaran_jamaah') {
            // Catat jejak penghapusan pakai data yang sudah diambil sebelum delete di atas.
            try {
                if (cicRowSebelumHapus) {
                    // Kalau baris yang dihapus ini sudah pernah diunduh sebagai
                    // KUITANSI (nomor_kuitansi terisi), pakai nomor kuitansi itu
                    // di log audit -- itulah nomor dokumen resmi yang benar-benar
                    // ada di tangan jamaah, bukan nomor_nota biasa.
                    const nomorAsli = cicRowSebelumHapus.nomor_kuitansi || nomorNota(cicRowSebelumHapus);
                    await logNotaAudit({
                        jenis: 'hapus',
                        nomorNotaValue: `HAPUS/${nomorAsli}`,
                        jamaahId: cicilanJamaahId,
                        jamaahNama: cicilanJamaahInfo?.nama,
                        programNama: cicilanProgramInfo?.nama,
                        jumlah: Number(cicRowSebelumHapus.jumlah || 0),
                        metadata: { cicilanId: finishedId, tanggal: cicRowSebelumHapus.tanggal, metode: cicRowSebelumHapus.metode }
                    });
                } else {
                    console.warn('Audit hapus pembayaran dilewati: data baris tidak ditemukan sebelum dihapus.');
                }
            } catch (auditErr) {
                console.warn('Gagal mencatat audit hapus pembayaran (non-fatal):', auditErr);
            }
            await afterDeleteCicilan(cicilanJamaahId);
        }

    } catch (err) {
        console.error('Delete error:', err);
        showToast('Gagal menghapus: ' + err.message, 'error');
    }
}

function closeDeleteConfirmModal() {
    document.getElementById('deleteConfirmModal').classList.remove('open');
    deleteTarget = { table: null, id: null, name: '' };
}

// ============================================================
// 18. JADWAL TAMU (CRUD)
// ============================================================
async function loadJadwal() {
    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('jadwal_tamu').select('*').order('tgl', { ascending: true }),
            { label: 'Muat jadwal tamu' }
        );
        if (error) throw error;
        jadwalList = data || [];
        updateMetrics();
    } catch (err) {
        console.error('Load jadwal error:', err);
        jadwalList = [];
        showToast('Gagal memuat jadwal tamu — periksa koneksi internet', 'error');
    }
}

// ========== JADWAL TAMU: state untuk search/filter/pagination ==========
let jfSearchTerm = '';
let jfStatusFilterVal = '';
let jfCurrentPage = 1;
const JF_PAGE_SIZE = 25;

function handleJfSearchInput(val) {
    jfSearchTerm = val;
    jfCurrentPage = 1;
    renderJadwalSection();
}

function handleJfStatusFilter(val) {
    jfStatusFilterVal = val;
    jfCurrentPage = 1;
    renderJadwalSection();
}

function goToJfPage(page) {
    jfCurrentPage = page;
    renderJadwalSection();
}

function getJadwalStatusKey(j, today) {
    const d = new Date(j.tgl);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) return 'today';
    return d < today ? 'past' : 'upcoming';
}

function getFilteredJadwal() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const term = jfSearchTerm.trim().toLowerCase();
    return jadwalList.filter(j => {
        if (jfStatusFilterVal && getJadwalStatusKey(j, today) !== jfStatusFilterVal) return false;
        if (!term) return true;
        const haystack = [j.nama, j.asal, j.keperluan, j.wa].join(' ').toLowerCase();
        return haystack.includes(term);
    });
}

function renderJfPagination(totalItems) {
    const el = document.getElementById('jfPagination');
    if (!el) return;
    const totalPages = Math.max(1, Math.ceil(totalItems / JF_PAGE_SIZE));
    if (totalPages <= 1) { el.innerHTML = ''; return; }
    if (jfCurrentPage > totalPages) jfCurrentPage = totalPages;

    let html = `<button ${jfCurrentPage === 1 ? 'disabled' : ''} onclick="goToJfPage(${jfCurrentPage - 1})" title="Sebelumnya"><i class="bi bi-chevron-left"></i></button>`;
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || Math.abs(i - jfCurrentPage) <= 1) pages.push(i);
        else if (pages[pages.length - 1] !== '...') pages.push('...');
    }
    pages.forEach(p => {
        if (p === '...') html += `<span class="pf-page-ellipsis">…</span>`;
        else html += `<button class="${p === jfCurrentPage ? 'active' : ''}" onclick="goToJfPage(${p})">${p}</button>`;
    });
    html += `<button ${jfCurrentPage === totalPages ? 'disabled' : ''} onclick="goToJfPage(${jfCurrentPage + 1})" title="Berikutnya"><i class="bi bi-chevron-right"></i></button>`;
    el.innerHTML = html;
}

function renderJadwalSection() {
    const tbody = document.getElementById('jadwalTableBody');
    const countEl = document.getElementById('jfCount');
    if (!tbody) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const filtered = getFilteredJadwal();
    if (countEl) countEl.textContent = `${filtered.length} dari ${jadwalList.length} jadwal`;

    if (!jadwalList.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="pf-empty"><i class="bi bi-calendar-x-fill"></i>Belum ada jadwal tamu. Klik "Tambah Jadwal" untuk menambahkan.</div></td></tr>`;
        renderJfPagination(0);
    } else if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="pf-empty"><i class="bi bi-search"></i>Tidak ada jadwal yang cocok dengan pencarian/filter.</div></td></tr>`;
        renderJfPagination(0);
    } else {
        const sorted = [...filtered].sort((a, b) => new Date(a.tgl) - new Date(b.tgl));
        const totalPages = Math.max(1, Math.ceil(sorted.length / JF_PAGE_SIZE));
        if (jfCurrentPage > totalPages) jfCurrentPage = totalPages;
        const start = (jfCurrentPage - 1) * JF_PAGE_SIZE;
        const pageItems = sorted.slice(start, start + JF_PAGE_SIZE);

        const statusLabelMap = { today: 'Hari Ini', upcoming: 'Akan Datang', past: 'Selesai' };

        tbody.innerHTML = pageItems.map(j => {
            const stKey = getJadwalStatusKey(j, today);
            const tglFormatted = j.tgl ? new Date(j.tgl).toLocaleDateString('id-ID', {
                day: 'numeric', month: 'short', year: 'numeric'
            }) : '-';
            return `<tr>
                <td><span class="pf-name">${escapeHtml(j.nama || 'Tamu')}</span></td>
                <td>${escapeHtml(tglFormatted)}</td>
                <td>${j.jam ? escapeHtml(j.jam) : '-'}</td>
                <td>${escapeHtml(j.asal || '-')}</td>
                <td>${j.jumlah ? escapeHtml(String(j.jumlah)) + ' orang' : '-'}</td>
                <td>${j.keperluan ? escapeHtml(j.keperluan) : '-'}</td>
                <td><span class="jadwal-status-pill ${stKey}">${statusLabelMap[stKey]}</span></td>
                <td>
                    <div class="pf-actions">
                        ${j.wa ? `<a href="https://wa.me/${j.wa.replace(/\D/g,'')}?text=Assalamualaikum%20${encodeURIComponent(j.nama||'')}%20kami%20dari%20${encodeURIComponent(NOTA_PERUSAHAAN.nama)}" target="_blank" class="pf-btn-wa" title="Hubungi via WhatsApp"><i class="bi bi-whatsapp"></i></a>` : ''}
                        <button type="button" class="pf-btn-edit" onclick="openJadwalModal('${j.id}')" title="Edit"><i class="bi bi-pencil-fill"></i></button>
                        <button type="button" class="pf-btn-delete" onclick="openDeleteModal('jadwal_tamu', '${j.id}', '${escapeJsAttr(j.nama)}')" title="Hapus"><i class="bi bi-trash-fill"></i></button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        renderJfPagination(sorted.length);
    }

    // Update badge jumlah tamu hari ini di sidebar
    const todayCount = jadwalList.filter(j => getJadwalStatusKey(j, today) === 'today').length;
    const badge = document.getElementById('jadwalBadge');
    if (badge) {
        if (todayCount > 0) {
            badge.textContent = todayCount;
            badge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
        }
    }
}

function openJadwalModal(id = null) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk menambah jadwal', 'error'); return; }
    const modal = document.getElementById('jadwalModal');
    const form = document.getElementById('jadwalForm');
    form.reset();
    document.getElementById('j_editId').value = '';

    if (id) {
        const j = jadwalList.find(item => item.id === id);
        if (!j) { showToast('Jadwal tidak ditemukan', 'error'); return; }
        document.getElementById('jadwalModalTitle').textContent = 'Edit Jadwal Tamu';
        document.getElementById('j_editId').value = j.id;
        document.getElementById('jf_nama').value = j.nama || '';
        document.getElementById('jf_tgl').value = j.tgl || '';
        document.getElementById('jf_jam').value = j.jam || '';
        document.getElementById('jf_asal').value = j.asal || '';
        document.getElementById('jf_jumlah').value = j.jumlah || '';
        document.getElementById('jf_keperluan').value = j.keperluan || '';
        document.getElementById('jf_wa').value = j.wa || '';
        document.getElementById('jf_catatan').value = j.catatan || '';
    } else {
        document.getElementById('jadwalModalTitle').textContent = 'Tambah Jadwal Tamu';
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('jf_tgl').value = today;
    }

    modal.classList.add('open');
}

function closeJadwalModal() {
    document.getElementById('jadwalModal').classList.remove('open');
}

async function saveJadwalTamu(e) {
    e.preventDefault();
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk menyimpan jadwal', 'error'); return; }
    const id = document.getElementById('j_editId').value;
    const data = {
        nama: document.getElementById('jf_nama').value.trim(),
        tgl: document.getElementById('jf_tgl').value,
        jam: document.getElementById('jf_jam').value,
        asal: document.getElementById('jf_asal').value.trim(),
        jumlah: parseInt(document.getElementById('jf_jumlah').value) || null,
        keperluan: document.getElementById('jf_keperluan').value,
        wa: document.getElementById('jf_wa').value.trim(),
        catatan: document.getElementById('jf_catatan').value.trim()
    };

    if (!data.nama) { showToast('Nama tamu wajib diisi', 'error'); return; }
    if (!data.tgl) { showToast('Tanggal kunjungan wajib diisi', 'error'); return; }

    try {
        let result;
        if (id) {
            result = await supabaseClient.from('jadwal_tamu').update(data).eq('id', id);
        } else {
            result = await supabaseClient.from('jadwal_tamu').insert([data]);
        }
        if (result.error) throw result.error;

        showToast(id ? 'Jadwal berhasil diperbarui' : 'Jadwal berhasil ditambahkan');
        closeJadwalModal();
        await loadJadwal();
        renderJadwalSection();
        updateMetrics();
        sendTelegramNotif(formatTgJadwal(data, !!id), 'jadwal');

    } catch (err) {
        console.error('Save jadwal error:', err);
        showToast('Gagal menyimpan: ' + err.message, 'error');
    }
}

// ============================================================
// 18B. FORM PENDAFTARAN (CRUD)
// Daftar minat calon jamaah — nama, WA, program yang diminati, asal —
// dicatat di sini sebelum resmi jadi data manifest di tab Keberangkatan
// (kb_jamaah). Tidak otomatis terhubung/berpindah ke kb_jamaah; kalau
// calon jamaah deal, staf input manual sebagai data jamaah baru di
// Keberangkatan.
// ============================================================
async function loadPendaftaran() {
    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('pendaftaran').select('*').order('created_at', { ascending: false }),
            { label: 'Muat data pendaftaran' }
        );
        if (error) throw error;
        pendaftaranList = data || [];
    } catch (err) {
        console.error('Load pendaftaran error:', err);
        pendaftaranList = [];
        showToast('Gagal memuat data pendaftaran — periksa koneksi internet', 'error');
    }
}

// ========== FORM PENDAFTARAN: state untuk search/filter/pagination ==========
// Data tetap sepenuhnya di pendaftaranList (dimuat sekali dari server);
// pencarian, filter status, dan pagination semuanya dikerjakan di sisi
// klien supaya tetap ringan walau datanya sampai ratusan baris.
let pfSearchTerm = '';
let pfStatusFilterVal = '';
let pfCurrentPage = 1;
const PF_PAGE_SIZE = 25;

function handlePfSearchInput(val) {
    pfSearchTerm = val;
    pfCurrentPage = 1;
    renderPendaftaranSection();
}

function handlePfStatusFilter(val) {
    pfStatusFilterVal = val;
    pfCurrentPage = 1;
    renderPendaftaranSection();
}

function goToPfPage(page) {
    pfCurrentPage = page;
    renderPendaftaranSection();
}

function getFilteredPendaftaran() {
    const term = pfSearchTerm.trim().toLowerCase();
    return pendaftaranList.filter(p => {
        if (pfStatusFilterVal && (p.status || 'deal') !== pfStatusFilterVal) return false;
        if (!term) return true;
        const program = dataUmroh.find(x => String(x.id) === String(p.program_id));
        const haystack = [p.nama, program ? program.nama : '', p.asal, p.wa].join(' ').toLowerCase();
        return haystack.includes(term);
    });
}

function renderPfPagination(totalItems) {
    const el = document.getElementById('pfPagination');
    if (!el) return;
    const totalPages = Math.max(1, Math.ceil(totalItems / PF_PAGE_SIZE));
    if (totalPages <= 1) { el.innerHTML = ''; return; }
    if (pfCurrentPage > totalPages) pfCurrentPage = totalPages;

    let html = `<button ${pfCurrentPage === 1 ? 'disabled' : ''} onclick="goToPfPage(${pfCurrentPage - 1})" title="Sebelumnya"><i class="bi bi-chevron-left"></i></button>`;
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || Math.abs(i - pfCurrentPage) <= 1) pages.push(i);
        else if (pages[pages.length - 1] !== '...') pages.push('...');
    }
    pages.forEach(p => {
        if (p === '...') html += `<span class="pf-page-ellipsis">…</span>`;
        else html += `<button class="${p === pfCurrentPage ? 'active' : ''}" onclick="goToPfPage(${p})">${p}</button>`;
    });
    html += `<button ${pfCurrentPage === totalPages ? 'disabled' : ''} onclick="goToPfPage(${pfCurrentPage + 1})" title="Berikutnya"><i class="bi bi-chevron-right"></i></button>`;
    el.innerHTML = html;
}

// Sinkronisasi program antara Pendaftaran <-> Data Jamaah.
// Setelah pendaftaran ditandai "Deal", baris Data Jamaah dibuat & ditautkan
// lewat kb_jamaah.pendaftaran_id (lihat autoConvertPendaftaranToJamaah).
// Tapi kalau admin GANTI program jamaah tsb belakangan lewat tab Data
// Jamaah, pendaftaran.program_id bisa jadi basi/kosong kalau tidak ikut
// disinkronkan. Helper ini jadi sumber kebenaran tunggal: kalau jamaah yang
// tertaut sudah punya program, itu yang dipakai untuk ditampilkan/diedit di
// Pendaftaran -- bukan program_id lama di baris pendaftaran itu sendiri.
function getLinkedJamaahForPendaftaran(pendaftaranId) {
    if (!pendaftaranId) return null;
    return (kbJamaahList || []).find(j => String(j.pendaftaran_id) === String(pendaftaranId)) || null;
}

function getEffectiveProgramIdForPendaftaran(p) {
    if (!p) return '';
    const linkedJamaah = getLinkedJamaahForPendaftaran(p.id);
    if (linkedJamaah && linkedJamaah.program_id) return linkedJamaah.program_id;
    return p.program_id || '';
}

function renderPendaftaranSection() {
    const tbody = document.getElementById('pendaftaranTableBody');
    const countEl = document.getElementById('pfCount');
    if (!tbody) return;

    const filtered = getFilteredPendaftaran();
    if (countEl) countEl.textContent = `${filtered.length} dari ${pendaftaranList.length} pendaftaran`;

    if (!pendaftaranList.length) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="pf-empty"><i class="bi bi-clipboard-check-fill"></i>Belum ada pendaftaran. Klik "Tambah Pendaftaran" untuk menambahkan.</div></td></tr>`;
        renderPfPagination(0);
        return;
    }
    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="pf-empty"><i class="bi bi-search"></i>Tidak ada pendaftaran yang cocok dengan pencarian/filter.</div></td></tr>`;
        renderPfPagination(0);
        return;
    }

    const statusMap = {
        deal: { label: 'Deal', icon: 'bi-check-circle-fill' },
        batal: { label: 'Batal', icon: 'bi-x-circle-fill' }
    };

    const totalPages = Math.max(1, Math.ceil(filtered.length / PF_PAGE_SIZE));
    if (pfCurrentPage > totalPages) pfCurrentPage = totalPages;
    const start = (pfCurrentPage - 1) * PF_PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PF_PAGE_SIZE);

    tbody.innerHTML = pageItems.map(p => {
        const effectiveProgramId = getEffectiveProgramIdForPendaftaran(p);
        const program = dataUmroh.find(x => String(x.id) === String(effectiveProgramId));
        const stKey = p.status || 'deal';
        const st = statusMap[stKey] || statusMap.deal;
        const linkedJamaah = getLinkedJamaahForPendaftaran(p.id);
        const deleteWarning = linkedJamaah
            ? `⚠️ Pendaftaran ini sudah punya data di Data Jamaah ("${linkedJamaah.nama}"). Baris jamaah TIDAK ikut terhapus, tapi tautannya akan putus.`
            : '';
        return `<tr class="status-${stKey}">
            <td><span class="pf-name">${escapeHtml(p.nama || '-')}</span></td>
            <td>${escapeHtml(program ? program.nama : 'Belum ditentukan')}</td>
            <td>${p.tanggal_daftar ? escapeHtml(p.tanggal_daftar) : (p.created_at ? escapeHtml(String(p.created_at).slice(0, 10)) : '-')}</td>
            <td>${escapeHtml(p.asal || '-')}</td>
            <td>${p.wa ? escapeHtml(p.wa) : '-'}</td>
            <td><span class="pf-status-pill ${stKey}"><i class="bi ${st.icon}"></i> ${st.label}</span></td>
            <td>
                <div class="pf-actions">
                    ${p.wa ? `<a href="https://wa.me/${p.wa.replace(/\D/g,'')}?text=Assalamualaikum%20${encodeURIComponent(p.nama||'')}%20kami%20dari%20${encodeURIComponent(NOTA_PERUSAHAAN.nama)}" target="_blank" class="pf-btn-wa" title="Hubungi via WhatsApp"><i class="bi bi-whatsapp"></i></a>` : ''}
                    <button type="button" class="pf-btn-edit" onclick="openPendaftaranModal('${p.id}')" title="Edit"><i class="bi bi-pencil-fill"></i></button>
                    <button type="button" class="pf-btn-delete" onclick="openDeleteModal('pendaftaran', '${p.id}', '${escapeJsAttr(p.nama)}'${deleteWarning ? `, '${escapeJsAttr(deleteWarning)}'` : ''})" title="Hapus"><i class="bi bi-trash-fill"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');

    renderPfPagination(filtered.length);
}

// Program yang boleh dipilih untuk PENDAFTARAN BARU: hanya yang masih aktif
// & belum lewat tanggal keberangkatan (tidak masuk akal menawarkan program
// yang sudah expired ke calon jamaah baru). Dipakai oleh openPendaftaranModal.
// existingProgramId (opsional): kalau sedang EDIT pendaftaran lama yang
// program-nya kebetulan sudah expired/nonaktif, tetap disertakan (ditandai)
// supaya pilihan yang sudah tersimpan tidak hilang/ke-reset diam-diam.
function getSelectablePendaftaranPrograms(existingProgramId = null) {
    const now = new Date();
    const aktif = (dataUmroh || []).filter(p => p.is_active !== false && (!p.dateObj || p.dateObj >= now));
    if (existingProgramId && !aktif.some(p => String(p.id) === String(existingProgramId))) {
        const existingProg = (dataUmroh || []).find(p => String(p.id) === String(existingProgramId));
        if (existingProg) return [...aktif, { ...existingProg, _expiredTag: true }];
    }
    return aktif;
}

function openPendaftaranModal(id = null) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk menambah pendaftaran', 'error'); return; }
    const modal = document.getElementById('pendaftaranModal');
    const form = document.getElementById('pendaftaranForm');
    form.reset();
    document.getElementById('p_editId').value = '';

    const existing = id ? pendaftaranList.find(item => item.id === id) : null;
    const effectiveExistingProgramId = existing ? getEffectiveProgramIdForPendaftaran(existing) : null;
    const programSelect = document.getElementById('pf_program');
    const selectablePrograms = getSelectablePendaftaranPrograms(effectiveExistingProgramId);
    programSelect.innerHTML = '<option value="">-- Belum Ditentukan --</option>' +
        selectablePrograms.map(prog => `<option value="${prog.id}">${escapeHtml(prog.nama)}${prog.tgl ? ' (' + escapeHtml(prog.tgl) + ')' : ''}${prog._expiredTag ? ' (Sudah Lewat)' : ''}</option>`).join('');

    const jamaahLamaBox = document.getElementById('pfFromJamaahLamaBox');
    let hasExtraData = false;

    if (id) {
        const p = pendaftaranList.find(item => item.id === id);
        if (!p) { showToast('Data tidak ditemukan', 'error'); return; }
        if (jamaahLamaBox) jamaahLamaBox.style.display = 'none';
        document.getElementById('pendaftaranModalTitle').textContent = 'Edit Pendaftaran';
        document.getElementById('p_editId').value = p.id;
        document.getElementById('pf_tanggal').value = p.tanggal_daftar || '';
        document.getElementById('pf_nama').value = p.nama || '';
        document.getElementById('pf_program').value = effectiveExistingProgramId || '';
        if (effectiveExistingProgramId && String(effectiveExistingProgramId) !== String(p.program_id || '')) {
            // Program di baris Pendaftaran ternyata beda/kosong dibanding
            // program yang sudah dipilih di Data Jamaah (jamaah tertaut) --
            // tampilkan versi yang sudah disinkronkan, dan langsung tandai
            // supaya tersimpan otomatis begitu form ini di-Save.
            showToast('Program disinkronkan otomatis dari data jamaah yang sudah terdaftar', 'info');
        }
        document.getElementById('pf_ktp').value = p.ktp || '';
        document.getElementById('pf_gender').value = p.jenis_kelamin || '';
        document.getElementById('pf_tempat_lahir').value = p.tempat_lahir || '';
        document.getElementById('pf_tgl_lahir').value = p.tgl_lahir || '';
        document.getElementById('pf_alamat').value = p.alamat || '';
        document.getElementById('pf_asal').value = p.asal || '';
        document.getElementById('pf_kodepos').value = p.kode_pos || '';
        document.getElementById('pf_wa').value = p.wa || '';
        document.getElementById('pf_telp_rumah').value = p.telp_rumah || '';
        document.getElementById('pf_ahli_waris_nama').value = p.ahli_waris_nama || '';
        document.getElementById('pf_ahli_waris_hubungan').value = p.ahli_waris_hubungan || '';
        document.getElementById('pf_status').value = p.status || 'deal';
        document.getElementById('pf_catatan').value = p.catatan || '';
        // [REDESIGN] Buka otomatis bagian "Data Tambahan" kalau salah satu
        // field-nya sudah terisi, biar kelihatan tanpa perlu klik dulu.
        hasExtraData = !!(p.alamat || p.asal || p.kode_pos || p.ahli_waris_nama || p.ahli_waris_hubungan);
    } else {
        document.getElementById('pendaftaranModalTitle').textContent = 'Tambah Pendaftaran';
        document.getElementById('pf_tanggal').value = new Date().toISOString().slice(0, 10);
        document.getElementById('pf_status').value = 'deal';
        if (jamaahLamaBox) jamaahLamaBox.style.display = '';
        const cariInput = document.getElementById('pf_cari_jamaah_lama');
        if (cariInput) cariInput.value = '';
        const resultsBox = document.getElementById('pfJamaahLamaResults');
        if (resultsBox) { resultsBox.innerHTML = ''; resultsBox.style.display = 'none'; }
    }

    const pfExtraDetails = document.getElementById('pfExtraDetails');
    if (pfExtraDetails) pfExtraDetails.open = hasExtraData;

    pfSyncEditHero();

    modal.classList.add('open');
}

function closePendaftaranModal() {
    document.getElementById('pendaftaranModal').classList.remove('open');
}

// [REDESIGN] Header ringkas di modal Pendaftaran -- inisial + nama + badge
// status + nama program, diperbarui live saat diketik/dipilih supaya admin
// selalu yakin sedang menangani lead yang mana.
function pfSyncEditHero() {
    const nameEl = document.getElementById('pf_nama');
    const programSel = document.getElementById('pf_program');
    const statusSel = document.getElementById('pf_status');
    const avatarEl = document.getElementById('pfHeroAvatar');
    const nameOut = document.getElementById('pfHeroName');
    const statusOut = document.getElementById('pfHeroStatus');
    const subOut = document.getElementById('pfHeroSub');
    if (!nameEl || !avatarEl || !nameOut || !statusOut || !subOut) return;

    const nama = (nameEl.value || '').trim();
    nameOut.textContent = nama || 'Calon jamaah baru';
    avatarEl.textContent = nama ? nama.trim().charAt(0).toUpperCase() : '–';

    const statusLabels = { deal: 'Deal', batal: 'Batal' };
    const statusVal = statusSel ? (statusSel.value || 'deal') : 'deal';
    statusOut.textContent = statusLabels[statusVal] || 'Deal';
    statusOut.className = 'ms-edit-hero-status st-' + statusVal;

    const programId = programSel ? programSel.value : '';
    const program = programId ? (dataUmroh || []).find(p => String(p.id) === String(programId)) : null;
    subOut.textContent = program ? (program.nama || 'Program tanpa nama') : 'Belum ada program dipilih';
}

async function savePendaftaran(e) {
    e.preventDefault();
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk menyimpan pendaftaran', 'error'); return; }
    const id = document.getElementById('p_editId').value;
    const data = {
        tanggal_daftar: document.getElementById('pf_tanggal').value || null,
        program_id: document.getElementById('pf_program').value || null,
        nama: document.getElementById('pf_nama').value.trim(),
        ktp: document.getElementById('pf_ktp').value.trim(),
        jenis_kelamin: document.getElementById('pf_gender').value,
        tempat_lahir: document.getElementById('pf_tempat_lahir').value.trim(),
        tgl_lahir: document.getElementById('pf_tgl_lahir').value || null,
        alamat: document.getElementById('pf_alamat').value.trim(),
        wa: document.getElementById('pf_wa').value.trim(),
        telp_rumah: document.getElementById('pf_telp_rumah').value.trim(),
        asal: document.getElementById('pf_asal').value.trim(),
        kode_pos: document.getElementById('pf_kodepos').value.trim(),
        ahli_waris_nama: document.getElementById('pf_ahli_waris_nama').value.trim(),
        ahli_waris_hubungan: document.getElementById('pf_ahli_waris_hubungan').value,
        status: document.getElementById('pf_status').value,
        catatan: document.getElementById('pf_catatan').value.trim()
    };

    if (!data.nama) { showToast('Nama calon jamaah wajib diisi', 'error'); return; }
    // Begitu status ditandai "Deal", baris ini otomatis dipindah ke Data
    // Jamaah (lihat autoConvertPendaftaranToJamaah) -- makanya program
    // keberangkatan wajib sudah dipilih dulu, supaya jamaah tidak "nyasar"
    // tanpa program.
    if (data.status === 'deal' && !data.program_id) {
        showToast('⚠️ Pilih program keberangkatan dulu sebelum menandai status "Deal"', 'error');
        return;
    }

    try {
        let result;
        if (id) {
            result = await supabaseClient.from('pendaftaran').update(data).eq('id', id);
        } else {
            result = await supabaseClient.from('pendaftaran').insert([data]).select();
        }
        if (result.error) throw result.error;

        const savedId = id || (result.data && result.data[0] && result.data[0].id);

        showToast(id ? 'Pendaftaran berhasil diperbarui' : 'Pendaftaran berhasil ditambahkan');
        closePendaftaranModal();
        await loadPendaftaran();
        renderPendaftaranSection();

        // Otomatis jadi Data Jamaah -- menu "Tambah Jamaah" manual di tab
        // Data Jamaah sudah ditiadakan, jamaah hanya masuk lewat jalur ini.
        if (data.status === 'deal' && savedId) {
            await autoConvertPendaftaranToJamaah({ ...data, id: savedId });
        }

        // Sinkron ke arah sebaliknya: kalau pendaftaran yang SUDAH punya
        // jamaah (hasil Deal sebelumnya) diedit balik jadi "Batal", jamaah
        // tertaut ikut ditandai Batal di Data Jamaah -- supaya kuota program
        // otomatis lega lagi & tidak perlu diubah manual di dua tempat.
        if (id && data.status === 'batal') {
            const linkedJamaah = getLinkedJamaahForPendaftaran(id);
            if (linkedJamaah && linkedJamaah.status !== 'batal') {
                try {
                    const { error: jErr } = await supabaseClient.from('kb_jamaah').update({ status: 'batal' }).eq('id', linkedJamaah.id);
                    if (!jErr) {
                        await loadKbJamaah();
                        renderKbProgramSelector();
                        updateMetrics();
                        if (currentData && currentData.length) renderTable(currentData);
                        renderFeaturedSection();
                        showToast(`Data jamaah "${linkedJamaah.nama}" ikut ditandai "Batal"`, 'info');
                    }
                } catch (jErr) {
                    console.error('Sync batal ke kb_jamaah gagal (non-fatal):', jErr);
                }
            }
        }

    } catch (err) {
        console.error('Save pendaftaran error:', err);
        showToast('Gagal menyimpan: ' + err.message, 'error');
    }
}

// Otomatis membuat baris Data Jamaah begitu status Pendaftaran ditandai
// "Deal" -- staf tidak perlu lagi buka form Tambah Jamaah & mengetik ulang
// data yang sudah ada di Pendaftaran. Field spesifik jamaah (No. Paspor,
// tipe kamar, dll) dilengkapi belakangan lewat tombol Edit di Data Jamaah.
async function autoConvertPendaftaranToJamaah(p) {
    // Jaga-jaga dobel konversi, mis. pendaftaran lama yang statusnya sudah
    // "Deal" dari sebelum fitur otomatis ini ada, lalu disimpan ulang tanpa
    // ganti status.
    if ((kbJamaahList || []).some(j => String(j.pendaftaran_id) === String(p.id))) return;
    if (!p.program_id) return;

    const entry = {
        program_id: p.program_id,
        nama: p.nama || '',
        nik: p.ktp || '',
        wa: p.wa || '',
        asal: p.asal || '',
        tipe_kamar: 'quad',
        status: 'pending',
        catatan: p.catatan || '',
        jenis_kelamin: p.jenis_kelamin || null,
        tempat_lahir: p.tempat_lahir || null,
        tgl_lahir: p.tgl_lahir || null,
        alamat: p.alamat || null,
        kode_pos: p.kode_pos || null,
        telp_rumah: p.telp_rumah || null,
        ahli_waris_nama: p.ahli_waris_nama || null,
        ahli_waris_hubungan: p.ahli_waris_hubungan || null,
        pendaftaran_id: p.id
    };

    try {
        const { error } = await supabaseClient.from('kb_jamaah').insert([entry]);
        if (error) throw error;
        await loadKbJamaah();
        renderKbProgramSelector();
        updateMetrics();
        // Badge kuota "X/45 Tersedia" di tabel Program & Unggulan dihitung
        // dari kbJamaahList saat render, jadi perlu di-render ulang.
        if (currentData && currentData.length) renderTable(currentData);
        renderFeaturedSection();
        showToast('🕋 "' + (p.nama || '') + '" otomatis masuk Data Jamaah — lengkapi No. Paspor & data lain lewat Edit');
    } catch (err) {
        console.error('Auto convert pendaftaran ke jamaah error:', err);
        showToast('⚠️ Pendaftaran tersimpan, tapi gagal otomatis masuk Data Jamaah: ' + err.message, 'error');
    }
}

// ============================================================
// 19. KEBERANGKATAN (CRUD)
// ============================================================
async function loadKbJamaah() {
    try {
        // diarsipkan=false: jamaah yang sudah diarsipkan (lihat menu "Arsip
        // Jamaah") sengaja TIDAK ikut ke cache ini, supaya otomatis hilang
        // dari metrics, dropdown program, form cicilan, & form dokumen tanpa
        // perlu difilter ulang di tiap tempat pakainya.
        const { data, error } = await withRetry(
            () => supabaseClient.from('kb_jamaah').select('*').eq('diarsipkan', false).order('nama', { ascending: true }),
            { label: 'Muat data jamaah' }
        );
        if (error) throw error;
        kbJamaahList = data || [];
        updateMetrics();
    } catch (err) {
        console.error('Load kb_jamaah error:', err);
        kbJamaahList = [];
        showToast('Gagal memuat data jamaah — periksa koneksi internet', 'error');
    }
    renderNavBadges();
}

// Badge angka kecil di menu sidebar/tab-bar (Kelengkapan Dokumen & Status
// Kepulangan) -- dihitung langsung dari kbJamaahList (sudah terfilter
// diarsipkan=false) supaya tidak perlu query tambahan ke Supabase. Dipanggil
// ulang tiap kali kbJamaahList berubah: sesudah loadKbJamaah(), sesudah
// centang dokumen (toggleDokumenJamaah), dan sesudah ubah status kepulangan
// (updateKepulanganField).
function renderNavBadges() {
    const dokBelumLengkap = (kbJamaahList || []).filter(j => !isDokumenLengkap(j.dokumen, j)).length;
    // Sengaja hanya hitung "sudah_berangkat" (bukan "belum_berangkat") --
    // itu yang paling butuh perhatian admin karena jamaahnya sedang di
    // perjalanan tapi belum ditandai pulang, sedangkan "belum_berangkat"
    // memang wajar untuk program yang belum jalan.
    const belumPulang = (kbJamaahList || []).filter(j => efektifStatusKepulangan(j) === 'sudah_berangkat').length;

    ['badgeDokumenDesktop', 'badgeDokumenMobile', 'badgeDokumenTabbar'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = dokBelumLengkap > 99 ? '99+' : String(dokBelumLengkap);
        el.classList.toggle('show', dokBelumLengkap > 0);
    });
    ['badgeKepulanganDesktop', 'badgeKepulanganMobile', 'badgeKepulanganTabbar'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = belumPulang > 99 ? '99+' : String(belumPulang);
        el.classList.toggle('show', belumPulang > 0);
    });
}

let arsipJamaahList = [], arsipSelectedProgram = null;

async function loadArsipJamaah() {
    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('kb_jamaah').select('*').eq('diarsipkan', true).order('diarsipkan_at', { ascending: false }),
            { label: 'Muat data arsip jamaah' }
        );
        if (error) throw error;
        arsipJamaahList = data || [];
    } catch (err) {
        console.error('Load arsip jamaah error:', err);
        arsipJamaahList = [];
        showToast('Gagal memuat data arsip jamaah — periksa koneksi internet', 'error');
    }
}

function renderKbProgramSelector() {
    const select = document.getElementById('kbProgramSelect');

    // Dropdown di modal "Tambah/Edit Jamaah" HARUS selalu menampilkan SEMUA
    // program yang ada, termasuk yang belum punya jamaah sama sekali (karena
    // di situlah jamaah pertama didaftarkan). Diisi lebih dulu & terpisah dari
    // logic filter sidebar di bawah, supaya tidak ikut kena early-return.
    const modalSelect = document.getElementById('kb_program');
    if (modalSelect) {
        const currentModalVal = modalSelect.value;
        modalSelect.innerHTML = (dataUmroh && dataUmroh.length)
            ? dataUmroh.map(p => `<option value="${p.id}">${escapeHtml(p.nama)}${p.tgl ? ' (' + escapeHtml(p.tgl) + ')' : ''}</option>`).join('')
            : '<option value="">-- Belum ada program --</option>';
        if (currentModalVal && dataUmroh && dataUmroh.some(p => String(p.id) === String(currentModalVal))) {
            modalSelect.value = currentModalVal;
        }
    }

    if (!select) return;

    if (!dataUmroh || dataUmroh.length === 0) {
        select.innerHTML = '<option value="">-- Belum ada program --</option>';
        return;
    }

    // Sidebar filter: hanya tampilkan program yang memang sudah ada jamaah
    // yang mendaftar, supaya admin tinggal pilih tanpa perlu mencari di
    // daftar panjang. Ini TIDAK memengaruhi isi dropdown di modal (di atas).
    const programsWithJamaah = dataUmroh.filter(p =>
        (kbJamaahList || []).some(j => String(j.program_id) === String(p.id))
    );

    if (programsWithJamaah.length === 0) {
        select.innerHTML = '<option value="">-- Belum ada jamaah terdaftar --</option>';
        loadKbJamaahForProgram('');
        return;
    }

    // Keep current selection (kalau masih ada di daftar terfilter)
    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Pilih Program --</option>' +
        programsWithJamaah.map(p => `<option value="${p.id}">${escapeHtml(p.nama)} (${escapeHtml(p.tgl || '-')})</option>`).join('');
    select.value = (currentVal && programsWithJamaah.some(p => String(p.id) === String(currentVal))) ? currentVal : '';

    // Load jamaah for selected program
    loadKbJamaahForProgram(select.value);
}

function selectKbProgram(id) {
    document.getElementById('kbProgramSelect').value = id;
    loadKbJamaahForProgram(id);
}

async function loadKbJamaahForProgram(programId) {
    kbSelectedProgram = programId || null;
    const container = document.getElementById('kbJamaahContent');
    if (!programId) {
        container.innerHTML = `<div class="kb-no-program"><i class="bi bi-airplane-engines-fill"></i><p>Pilih program di atas untuk melihat daftar jamaah.</p></div>`;
        return;
    }

    const program = dataUmroh.find(p => String(p.id) === String(programId));
    const canEdit = canManageProgramData();

    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('kb_jamaah').select('*').eq('program_id', programId).eq('diarsipkan', false).order('nama', { ascending: true }),
            { label: 'Muat data jamaah' }
        );
        if (error) throw error;

        const jamaah = data || [];
        const exportBtnsHtml = (jamaah.length) ? `
            <button type="button" class="btn-export-subtle" id="btnRoomingList" onclick="bukaRoomingList(this)" title="Buka Rooming List (pembagian kamar) program ini">
                <i class="bi bi-door-closed-fill"></i> Rooming List
            </button>
            <button type="button" class="btn-export-subtle" id="btnExportJamaahExcel" onclick="exportJamaahExcel(this)" title="Export data jamaah ke Excel">
                <i class="bi bi-file-earmark-excel-fill"></i> Export Excel
            </button>
            <button type="button" class="btn-export-subtle" id="btnExportPembayaranExcel" onclick="exportPembayaranExcel(this)" title="Export riwayat pembayaran & cicilan ke Excel">
                <i class="bi bi-cash-coin"></i> Export Pembayaran
            </button>` : '';
        // Tombol "Arsipkan Semua Jamaah Program Ini" dipindah ke tab Status
        // Kepulangan (lihat loadKepulanganForProgram) supaya lokasinya
        // berdekatan dengan status "Sudah Pulang" yang jadi syarat arsip.
        const bottomActionsHtml = exportBtnsHtml ? `
            <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;">
                ${exportBtnsHtml}
            </div>` : '';
        if (!jamaah.length) {
            container.innerHTML = `<div class="kb-no-program"><i class="bi bi-person-dash-fill"></i><p>Belum ada jamaah terdaftar untuk program ini.</p></div>`;
            return;
        }

        const jamaahIds = jamaah.map(j => j.id);
        const { data: bayarData, error: bErr } = await withRetry(
            () => supabaseClient.from('pembayaran_jamaah').select('jamaah_id, jumlah').in('jamaah_id', jamaahIds),
            { label: 'Muat data pembayaran' }
        );
        if (bErr) throw bErr;

        const totalPerJamaah = {};
        (bayarData || []).forEach(b => {
            totalPerJamaah[b.jamaah_id] = (totalPerJamaah[b.jamaah_id] || 0) + Number(b.jumlah || 0);
        });

        let grandTotalTagihan = 0, grandTotalDibayar = 0, anyHargaKosong = false;

        const rows = jamaah.map(j => {
            const hargaProgram = getHargaKamarJamaah(program, j);
            if (!hargaProgram) anyHargaKosong = true;
            const dibayar = totalPerJamaah[j.id] || 0;
            const sisa = Math.max(hargaProgram - dibayar, 0);
            const pct = hargaProgram > 0 ? Math.min(100, Math.round((dibayar / hargaProgram) * 100)) : 0;
            grandTotalTagihan += hargaProgram;
            grandTotalDibayar += dibayar;

            let statusLabel, statusClass;
            if (j.status === 'batal') { statusLabel = '<i class="bi bi-x-circle-fill"></i> Batal'; statusClass = 'batal'; }
            else if (hargaProgram > 0 && dibayar >= hargaProgram) { statusLabel = '<i class="bi bi-check-circle-fill"></i> Lunas'; statusClass = 'available'; }
            else if (dibayar > 0) { statusLabel = '<i class="bi bi-arrow-repeat"></i> Cicilan'; statusClass = 'limited'; }
            else { statusLabel = '<i class="bi bi-hourglass-split"></i> Belum Bayar'; statusClass = 'full'; }

            const mepet = pasporMepetInfo(j.paspor_exp, program ? program.dateObj : null);
            const visaInfo = VISA_STATUS_LABEL[j.visa_status || 'belum_diajukan'] || VISA_STATUS_LABEL.belum_diajukan;

            return `
                <tr style="border-bottom:1px solid var(--line);">
                    <td style="padding:10px 14px;max-width:150px;overflow:hidden;"><strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(j.nama)}">${escapeHtml(j.nama)}</strong>${j.asal ? `<span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--ink-soft);" title="${escapeHtml(j.asal)}">${escapeHtml(j.asal)}</span>` : ''}</td>
                    <td style="padding:10px 14px;">${j.nik || '-'}</td>
                    <td style="padding:10px 14px;">${j.paspor || '-'}${mepet ? `<br><span class="status-badge ${mepet.level === 'expired' ? 'batal' : 'full'}" style="font-size:10px;margin-top:3px;" title="${escapeHtml(mepet.text)}"><i class="bi bi-exclamation-triangle-fill"></i> Paspor Mepet</span>` : ''}</td>
                    <td style="padding:10px 14px;white-space:nowrap;">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <span>${formatRupiah(hargaProgram)}</span>
                            <span class="status-badge neutral pill-sm">${parseRupiahToNumber(j.harga_custom) > 0 ? 'Harga Khusus' : (TIPE_KAMAR_LABEL[j.tipe_kamar] || 'Quad')}</span>
                        </div>
                    </td>
                    <td style="padding:10px 14px;white-space:nowrap;color:var(--ink);font-weight:600;">${formatRupiah(dibayar)}</td>
                    <td style="padding:10px 14px;white-space:nowrap;color:var(--ink);font-weight:600;">${formatRupiah(sisa)}</td>
                    <td style="padding:10px 14px;min-width:130px;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <div style="flex:1;background:var(--line);border-radius:6px;height:8px;overflow:hidden;">
                                <div style="background:var(--brand);height:100%;width:${pct}%;"></div>
                            </div>
                            <span class="status-badge neutral pill-sm">${pct}%</span>
                        </div>
                    </td>
                    <td style="padding:10px 14px;"><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                    <td style="padding:10px 14px;"><span class="status-badge ${visaInfo.badge}">Visa: ${visaInfo.label}</span></td>
                    <td style="padding:10px 14px;white-space:nowrap;">
                        <div class="row-actions">
                            <button class="btn-primary btn-pay" style="font-size:11px;padding:5px 10px;" onclick="openCicilanModal('${j.id}')">
                                Update Pembayaran
                            </button>
                            ${canEdit ? `
                            <span class="row-actions-sep"></span>
                            <button type="button" class="row-icon-btn" onclick="openKbModal('${j.id}')" style="background:var(--brand-tint);color:var(--brand);" title="Edit data jamaah"><i class="bi bi-pencil-fill"></i></button>
                            <button type="button" class="row-icon-btn" onclick="openDeleteModal('kb_jamaah', '${j.id}', '${escapeJsAttr(j.nama)}'${dibayar > 0 ? `, '⚠️ Jamaah ini punya riwayat pembayaran senilai ${escapeJsAttr(formatRupiah(dibayar))} yang akan IKUT TERHAPUS PERMANEN (nota & riwayat cicilan hilang, tidak bisa dipulihkan).'` : ''})" style="background:var(--danger-tint);color:var(--danger);" title="Hapus data jamaah"><i class="bi bi-trash-fill"></i></button>
                            ` : ''}
                        </div>
                    </td>
                </tr>`;
        }).join('');

        const grandSisa = Math.max(grandTotalTagihan - grandTotalDibayar, 0);
        const totalLunas = jamaah.filter(j => {
            if (j.status === 'batal') return false;
            const h = getHargaKamarJamaah(program, j);
            return h > 0 && (totalPerJamaah[j.id] || 0) >= h;
        }).length;
        const totalPasporMepet = jamaah.filter(j => pasporMepetInfo(j.paspor_exp, program ? program.dateObj : null)).length;

        container.innerHTML = `
            <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
                <span class="status-badge neutral">${jamaah.length} Total Jamaah</span>
                <span class="status-badge neutral">${totalLunas} Lunas</span>
                <span class="status-badge neutral">Total Dibayar: ${formatRupiah(grandTotalDibayar)}</span>
                <span class="status-badge ${grandSisa > 0 ? 'full' : 'neutral'}">Sisa Tagihan: ${formatRupiah(grandSisa)}</span>
                ${totalPasporMepet > 0 ? `<span class="status-badge full"><i class="bi bi-exclamation-triangle-fill"></i> ${totalPasporMepet} Paspor Mepet/Kadaluarsa</span>` : ''}
            </div>
            ${anyHargaKosong ? `<div style="font-size:12px;color:var(--warn);margin-bottom:10px;"><i class="bi bi-exclamation-triangle-fill"></i> Ada jamaah yang harga tipe kamarnya belum diisi di program ini, sisa tagihan jamaah tsb tidak bisa dihitung akurat.</div>` : ''}
            <div class="table-container" style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead style="background:var(--bg);">
                        <tr>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);width:150px;max-width:150px;">Nama</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">NIK</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Paspor</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Harga Program</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Dibayar</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Sisa</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Progress</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Status</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Visa</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Aksi</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            ${bottomActionsHtml}
        `;

    } catch (err) {
        console.error('Load jamaah error:', err);
        container.innerHTML = `<div class="kb-no-program" style="color:var(--danger);">
            <i class="bi bi-exclamation-circle-fill"></i>
            <p>Gagal memuat data: ${err.message}</p>
        </div>`;
    }
}

// ============================================================
// ARSIP JAMAAH — sekali arsip, tidak bisa di-unarsip (lihat sql/17_tambah_arsip_jamaah.sql)
// ============================================================
let arsipConfirmTarget = { programId: null, programNama: null, jumlah: 0 };

async function arsipkanSemuaJamaah(programId) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengarsipkan jamaah', 'error'); return; }
    const program = dataUmroh.find(p => String(p.id) === String(programId));
    if (!program) return;

    try {
        // Cek ulang langsung ke database (bukan cache), status HARUS lunas
        // atau batal untuk semua jamaah program ini sebelum boleh diarsipkan.
        const { data: jamaahProgram, error } = await supabaseClient
            .from('kb_jamaah').select('id, nama, status').eq('program_id', programId).eq('diarsipkan', false);
        if (error) throw error;

        if (!jamaahProgram || jamaahProgram.length === 0) {
            showToast('Tidak ada jamaah aktif di program ini untuk diarsipkan', 'error');
            return;
        }

        const belumLunas = jamaahProgram.filter(j => j.status !== 'lunas' && j.status !== 'batal');
        if (belumLunas.length > 0) {
            showToast(`Tidak bisa arsipkan — masih ada ${belumLunas.length} jamaah yang belum lunas (${belumLunas.slice(0, 3).map(j => j.nama).join(', ')}${belumLunas.length > 3 ? ', ...' : ''}).`, 'error');
            return;
        }

        // Status kepulangan sekarang murni per program (satu rombongan
        // berangkat & pulang bersamaan) -- cukup cek SEKALI status program
        // terbaru langsung dari database (bukan cache), bukan per jamaah.
        const { data: progFresh, error: progErr } = await supabaseClient
            .from('programs').select('status_kepulangan').eq('id', programId).single();
        if (progErr) throw progErr;
        const programStatusFresh = (progFresh && progFresh.status_kepulangan) || 'belum_berangkat';

        // Program juga HARUS sudah berstatus "Sudah Pulang" (atau "Batal/
        // No-show" kalau memang tidak jadi berangkat) sebelum boleh
        // diarsipkan -- supaya progres kepulangan tidak pernah tertutup arsip
        // selagi rombongan belum tercatat pulang (lihat tab "Status Kepulangan").
        if (programStatusFresh !== 'sudah_pulang' && programStatusFresh !== 'batal') {
            showToast(`Tidak bisa arsipkan — status program ini masih "${kepulanganStatusInfo(programStatusFresh).label}" di tab Status Kepulangan, belum "Sudah Pulang".`, 'error');
            return;
        }

        arsipConfirmTarget = { programId, programNama: program.nama, jumlah: jamaahProgram.length };
        document.getElementById('arsipConfirmLabel').textContent = `Program: ${program.nama} — ${jamaahProgram.length} jamaah akan diarsipkan`;
        document.getElementById('arsipConfirmName').textContent = `"${program.nama}"`;
        document.getElementById('arsipConfirmInput').value = '';
        document.getElementById('arsipConfirmBtn').disabled = true;
        document.getElementById('arsipConfirmModal').classList.add('open');
    } catch (err) {
        console.error('Cek jamaah sebelum arsip gagal:', err);
        showToast('Gagal memverifikasi data jamaah, coba lagi', 'error');
    }
}

function closeArsipConfirmModal() {
    document.getElementById('arsipConfirmModal').classList.remove('open');
    arsipConfirmTarget = { programId: null, programNama: null, jumlah: 0 };
}

function onArsipConfirmInput() {
    const input = document.getElementById('arsipConfirmInput').value.trim();
    document.getElementById('arsipConfirmBtn').disabled = input !== arsipConfirmTarget.programNama;
}

async function confirmArsipkanSemua() {
    const { programId, programNama } = arsipConfirmTarget;
    if (!programId) return;

    try {
        const { data: arsipRows, error: updErr } = await supabaseClient
            .from('kb_jamaah')
            .update({ diarsipkan: true, diarsipkan_at: new Date().toISOString() })
            .eq('program_id', programId).eq('diarsipkan', false)
            .select('id, nama');
        if (updErr) throw updErr;

        const { error: progErr } = await supabaseClient
            .from('programs').update({ is_active: false }).eq('id', programId);
        if (progErr) console.error('Gagal nonaktifkan program setelah arsip:', progErr);

        try {
            await supabaseClient.from('jamaah_audit_log').insert(
                (arsipRows || []).map(j => ({
                    jamaah_id: j.id,
                    jamaah_nama: j.nama,
                    aksi: 'diarsipkan',
                    field: 'diarsipkan',
                    nilai_lama: 'false',
                    nilai_baru: 'true',
                    actor_role: currentRole || 'publik',
                    actor_nama: getPetugasNama() || null
                }))
            );
        } catch (logErr) { console.error('Gagal catat audit log arsip:', logErr); }

        showToast(`Jamaah program "${programNama}" berhasil diarsipkan`);
        closeArsipConfirmModal();
        await loadDataFromSupabase(true);
        await loadKbJamaah();
        renderKbProgramSelector();
        renderKepulanganProgramSelector();
        updateMetrics();
    } catch (err) {
        console.error('Arsipkan semua jamaah error:', err);
        showToast('Gagal mengarsipkan jamaah — coba lagi', 'error');
    }
}

function renderArsipProgramSelector() {
    const select = document.getElementById('arsipProgramSelect');
    if (!select) return;

    if (!arsipJamaahList || arsipJamaahList.length === 0) {
        select.innerHTML = '<option value="">-- Belum ada jamaah terarsip --</option>';
        loadArsipJamaahForProgram('');
        return;
    }

    // Program pemilik jamaah arsip bisa saja sudah is_active=false (memang
    // dinonaktifkan otomatis saat diarsipkan), jadi ambil nama program dari
    // dataUmroh TANPA filter is_active supaya tetap muncul di selector ini.
    const programIds = [...new Set(arsipJamaahList.map(j => String(j.program_id)))];
    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Pilih Program --</option>' +
        programIds.map(id => {
            const p = dataUmroh.find(pr => String(pr.id) === id);
            const nama = p ? p.nama : '(program tidak ditemukan)';
            const count = arsipJamaahList.filter(j => String(j.program_id) === id).length;
            return `<option value="${id}">${escapeHtml(nama)} (${count} jamaah)</option>`;
        }).join('');
    select.value = (currentVal && programIds.includes(currentVal)) ? currentVal : '';
    loadArsipJamaahForProgram(select.value);
}

function selectArsipProgram(id) {
    document.getElementById('arsipProgramSelect').value = id;
    loadArsipJamaahForProgram(id);
}

async function loadArsipJamaahForProgram(programId) {
    arsipSelectedProgram = programId || null;
    const container = document.getElementById('arsipJamaahContent');
    if (!container) return;
    if (!programId) {
        container.innerHTML = `<div class="kb-no-program"><i class="bi bi-archive"></i><p>Pilih program di atas untuk melihat jamaah yang sudah diarsipkan.</p></div>`;
        return;
    }

    const jamaah = arsipJamaahList.filter(j => String(j.program_id) === String(programId));
    if (!jamaah.length) {
        container.innerHTML = `<div class="kb-no-program"><i class="bi bi-person-dash-fill"></i><p>Belum ada jamaah terarsip untuk program ini.</p></div>`;
        return;
    }

    const rows = jamaah.map(j => {
        const info = kepulanganStatusInfo(efektifStatusKepulangan(j));
        const tglPulangEfektif = efektifTglKepulangan(j, 'tgl_pulang_aktual');
        return `
        <tr style="border-bottom:1px solid var(--line);">
            <td style="padding:10px 14px;"><strong>${escapeHtml(j.nama)}</strong>${j.asal ? `<br><span style="font-size:11px;color:var(--ink-soft);">${escapeHtml(j.asal)}</span>` : ''}</td>
            <td style="padding:10px 14px;">${j.nik || '-'}</td>
            <td style="padding:10px 14px;">${j.paspor || '-'}</td>
            <td style="padding:10px 14px;"><span class="status-badge ${info.badge}">${info.label}</span>${tglPulangEfektif ? `<br><span style="font-size:11px;color:var(--ink-soft);">Pulang: ${new Date(tglPulangEfektif).toLocaleDateString('id-ID')}</span>` : ''}</td>
            <td style="padding:10px 14px;">${j.diarsipkan_at ? new Date(j.diarsipkan_at).toLocaleDateString('id-ID') : '-'}</td>
            <td style="padding:10px 14px;white-space:nowrap;">
                <button class="btn-primary" style="font-size:11px;padding:5px 10px;" onclick="openCicilanModal('${j.id}')">
                    <i class="bi bi-eye-fill"></i> Lihat Riwayat & Kuitansi
                </button>
            </td>
        </tr>`;
    }).join('');

    container.innerHTML = `
        <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
            <span class="status-badge neutral">${jamaah.length} Jamaah Terarsip</span>
        </div>
        <div class="table-container" style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead style="background:var(--bg);">
                    <tr>
                        <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Nama</th>
                        <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">NIK</th>
                        <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Paspor</th>
                        <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Status Kepulangan</th>
                        <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Tgl Diarsipkan</th>
                        <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Aksi</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

// Modal ini SEKARANG khusus untuk Edit saja -- jamaah baru hanya dibuat
// otomatis lewat Pendaftaran yang ditandai "Deal" (lihat
// autoConvertPendaftaranToJamaah), jadi menu "Tambah Jamaah" manual di tab
// Data Jamaah sudah ditiadakan.
function openKbModal(id) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengedit data jamaah', 'error'); return; }
    if (!id) return;
    const j = kbJamaahList.find(item => item.id === id);
    if (!j) { showToast('Data tidak ditemukan', 'error'); return; }

    const modal = document.getElementById('kbModal');
    const form = document.getElementById('kbForm');
    form.reset();

    // Jaga-jaga: pastikan dropdown program di modal sudah terisi (mis. kalau
    // modal ini dibuka sebelum data program sempat dimuat / sinkron ulang).
    renderKbProgramSelector();

    document.getElementById('kbModalTitle').textContent = 'Edit Data Jamaah';
    document.getElementById('kb_editId').value = j.id;
    document.getElementById('kb_program').value = j.program_id || '';
    document.getElementById('kb_nama').value = j.nama || '';
    document.getElementById('kb_nik').value = j.nik || '';
    document.getElementById('kb_paspor').value = j.paspor || '';
    document.getElementById('kb_paspor_exp').value = j.paspor_exp || '';
    document.getElementById('kb_visa_status').value = j.visa_status || 'belum_diajukan';
    document.getElementById('kb_wa').value = j.wa || '';
    document.getElementById('kb_asal').value = j.asal || '';
    document.getElementById('kb_tipe_kamar').value = j.tipe_kamar || 'quad';
    document.getElementById('kb_harga_custom').value = j.harga_custom || '';
    formatNominalInput(document.getElementById('kb_harga_custom'));
    document.getElementById('kb_status').value = j.status || 'pending';
    document.getElementById('kb_catatan').value = j.catatan || '';
    document.getElementById('kb_jenis_kelamin').value = j.jenis_kelamin || '';
    document.getElementById('kb_tempat_lahir').value = j.tempat_lahir || '';
    document.getElementById('kb_tgl_lahir').value = j.tgl_lahir || '';
    document.getElementById('kb_alamat').value = j.alamat || '';
    document.getElementById('kb_kode_pos').value = j.kode_pos || '';
    document.getElementById('kb_telp_rumah').value = j.telp_rumah || '';
    document.getElementById('kb_ahli_waris_nama').value = j.ahli_waris_nama || '';
    document.getElementById('kb_ahli_waris_hubungan').value = j.ahli_waris_hubungan || '';
    // Buka otomatis kalau salah satu field F4 sudah terisi, biar kelihatan tanpa perlu klik
    const hasF4 = j.jenis_kelamin || j.tempat_lahir || j.tgl_lahir || j.alamat || j.kode_pos || j.telp_rumah || j.ahli_waris_nama || j.ahli_waris_hubungan;
    const f4Details = document.getElementById('kbF4Details');
    if (f4Details) f4Details.open = !!hasF4;

    kbSyncEditHero();
    kbUpdatePasporBadge();

    modal.classList.add('open');
}

function closeKbModal() {
    document.getElementById('kbModal').classList.remove('open');
}

// [REDESIGN] Header ringkas di modal Edit Data Jamaah -- inisial + nama +
// nama program, diperbarui live saat nama diketik / program dipilih supaya
// admin selalu yakin sedang mengedit data siapa.
function kbSyncEditHero() {
    const nameEl = document.getElementById('kb_nama');
    const programSel = document.getElementById('kb_program');
    const avatarEl = document.getElementById('kbHeroAvatar');
    const nameOut = document.getElementById('kbHeroName');
    const subOut = document.getElementById('kbHeroSub');
    if (!nameEl || !avatarEl || !nameOut || !subOut) return;

    const nama = (nameEl.value || '').trim();
    nameOut.textContent = nama || 'Jamaah baru';
    avatarEl.textContent = nama ? nama.trim().charAt(0).toUpperCase() : '–';

    const programId = programSel ? programSel.value : '';
    const program = programId ? (dataUmroh || []).find(p => String(p.id) === String(programId)) : null;
    subOut.textContent = program ? (program.nama || 'Program tanpa nama') : 'Belum ada program dipilih';
}

// [REDESIGN] Badge otomatis utk masa berlaku paspor. Syarat 2026: minimal
// berlaku 6 bulan dari tanggal keberangkatan. Dihitung terhadap tanggal
// keberangkatan program yang dipilih kalau ada datanya, kalau tidak
// dihitung terhadap hari ini supaya tetap ada sinyal kasar.
function kbUpdatePasporBadge() {
    const badge = document.getElementById('kbPasporBadge');
    const expInput = document.getElementById('kb_paspor_exp');
    const programSel = document.getElementById('kb_program');
    if (!badge || !expInput) return;

    const expVal = expInput.value;
    if (!expVal) {
        badge.className = 'ms-badge is-kosong';
        badge.innerHTML = '<i class="bi bi-dash-circle"></i> Belum diisi';
        return;
    }

    const expDate = new Date(expVal + 'T00:00:00');
    const programId = programSel ? programSel.value : '';
    const program = programId ? (dataUmroh || []).find(p => String(p.id) === String(programId)) : null;
    const refDate = (program && program.dateObj instanceof Date && !isNaN(program.dateObj)) ? program.dateObj : new Date();

    if (expDate < refDate) {
        badge.className = 'ms-badge is-kadaluarsa';
        badge.innerHTML = '<i class="bi bi-exclamation-octagon-fill"></i> Sudah/akan kadaluarsa';
        return;
    }

    const monthsLeft = (expDate.getFullYear() - refDate.getFullYear()) * 12 + (expDate.getMonth() - refDate.getMonth());
    if (monthsLeft < 6) {
        badge.className = 'ms-badge is-mepet';
        badge.innerHTML = '<i class="bi bi-exclamation-triangle-fill"></i> Mepet, kurang dari 6 bulan';
    } else {
        badge.className = 'ms-badge is-aman';
        badge.innerHTML = '<i class="bi bi-check-circle-fill"></i> Aman';
    }
}

// Cari jamaah lama (dari program-program sebelumnya) berdasarkan nama/NIK/paspor,
// untuk kasus pelanggan lama yang mau "Daftarkan Ulang" ke program baru --
// supaya data pribadinya (NIK, alamat, ahli waris, dll) tidak perlu diketik
// ulang dari nol lewat Form Pendaftaran. Field per-trip (program, status)
// SENGAJA tidak ikut disalin karena itu spesifik ke pendaftaran baru --
// begitu pendaftaran ini ditandai "Deal", jamaah baru otomatis dibuat lagi
// lewat autoConvertPendaftaranToJamaah.
function renderPfJamaahLamaOptions(query) {
    const resultsBox = document.getElementById('pfJamaahLamaResults');
    if (!resultsBox) return;
    const q = String(query || '').trim().toLowerCase();
    if (q.length < 2) { resultsBox.innerHTML = ''; resultsBox.style.display = 'none'; return; }

    const matches = (kbJamaahList || []).filter(j => {
        const nama = (j.nama || '').toLowerCase();
        const nik = (j.nik || '').toLowerCase();
        const paspor = (j.paspor || '').toLowerCase();
        return nama.includes(q) || (nik && nik.includes(q)) || (paspor && paspor.includes(q));
    });

    // Dedupe per orang (by NIK kalau ada, fallback ke nama) supaya orang yang
    // sudah pernah ikut beberapa program tidak muncul berkali-kali -- ambil
    // baris yang paling baru (created_at terbaru) sebagai sumber data.
    const byKey = new Map();
    for (const j of matches) {
        const key = (j.nik && j.nik.trim()) ? 'nik:' + j.nik.trim() : 'nama:' + (j.nama || '').trim().toLowerCase();
        const existing = byKey.get(key);
        if (!existing || new Date(j.created_at || 0) > new Date(existing.created_at || 0)) byKey.set(key, j);
    }
    const unique = [...byKey.values()].slice(0, 8);

    if (!unique.length) {
        resultsBox.style.display = '';
        resultsBox.innerHTML = '<div style="padding:8px 10px;font-size:12px;color:var(--ink-soft);">Tidak ada jamaah lama yang cocok — lanjutkan isi manual sebagai pendaftaran baru.</div>';
        return;
    }
    resultsBox.style.display = '';
    resultsBox.innerHTML = unique.map(j => {
        const program = dataUmroh.find(x => String(x.id) === String(j.program_id));
        const progName = program ? program.nama : 'Program tidak diketahui';
        const identitas = [j.nik ? 'NIK ' + j.nik : '', j.paspor ? 'Paspor ' + j.paspor : ''].filter(Boolean).join(' · ');
        return `<div class="kb-jamaah-lama-item" onclick="fillPfFromJamaahLama('${j.id}')" style="padding:8px 10px;border-radius:8px;cursor:pointer;font-size:12px;border:1px solid transparent;" onmouseover="this.style.background='#fff';this.style.borderColor='#fbd9a3';" onmouseout="this.style.background='transparent';this.style.borderColor='transparent';">
            <div style="font-weight:600;color:var(--ink);">${escapeHtml(j.nama || '-')}</div>
            <div style="color:var(--ink-soft);">${escapeHtml(identitas || 'Identitas belum lengkap')} · terakhir ikut ${escapeHtml(progName)}</div>
        </div>`;
    }).join('');
}

// Salin data pribadi dari jamaah lama terpilih ke Form Pendaftaran -- program
// & status SENGAJA dikosongkan/direset karena itu milik pendaftaran baru.
function fillPfFromJamaahLama(jamaahId) {
    const j = (kbJamaahList || []).find(item => String(item.id) === String(jamaahId));
    if (!j) { showToast('Data jamaah lama tidak ditemukan', 'error'); return; }

    document.getElementById('pf_nama').value = j.nama || '';
    document.getElementById('pf_ktp').value = j.nik || '';
    document.getElementById('pf_wa').value = j.wa || '';
    document.getElementById('pf_asal').value = j.asal || '';
    document.getElementById('pf_gender').value = j.jenis_kelamin || '';
    document.getElementById('pf_tempat_lahir').value = j.tempat_lahir || '';
    document.getElementById('pf_tgl_lahir').value = j.tgl_lahir || '';
    document.getElementById('pf_alamat').value = j.alamat || '';
    document.getElementById('pf_kodepos').value = j.kode_pos || '';
    document.getElementById('pf_telp_rumah').value = j.telp_rumah || '';
    document.getElementById('pf_ahli_waris_nama').value = j.ahli_waris_nama || '';
    document.getElementById('pf_ahli_waris_hubungan').value = j.ahli_waris_hubungan || '';

    const pfExtraDetails = document.getElementById('pfExtraDetails');
    if (pfExtraDetails && (j.alamat || j.asal || j.kode_pos || j.ahli_waris_nama || j.ahli_waris_hubungan)) pfExtraDetails.open = true;
    pfSyncEditHero();

    const resultsBox = document.getElementById('pfJamaahLamaResults');
    if (resultsBox) { resultsBox.innerHTML = ''; resultsBox.style.display = 'none'; }
    const input = document.getElementById('pf_cari_jamaah_lama');
    if (input) input.value = j.nama || '';

    showToast('Data pribadi disalin dari riwayat "' + (j.nama || '') + '" — pilih program baru, lalu Simpan');
}

async function saveKbJamaah(e) {
    e.preventDefault();
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk menyimpan data jamaah', 'error'); return; }
    const id = document.getElementById('kb_editId').value;
    // Snapshot nilai SEBELUM diubah (dari cache lokal) supaya bisa ditawarkan
    // "Urungkan" & dicatat ke riwayat aktivitas kalau field penting berubah.
    const beforeSnapshot = id ? kbJamaahList.find(item => String(item.id) === String(id)) : null;
    const beforeCopy = beforeSnapshot ? { ...beforeSnapshot } : null;
    const data = {
        program_id: document.getElementById('kb_program').value,
        nama: document.getElementById('kb_nama').value.trim(),
        nik: document.getElementById('kb_nik').value.trim(),
        paspor: document.getElementById('kb_paspor').value.trim(),
        paspor_exp: document.getElementById('kb_paspor_exp').value || null,
        visa_status: document.getElementById('kb_visa_status').value || 'belum_diajukan',
        wa: document.getElementById('kb_wa').value.trim(),
        asal: document.getElementById('kb_asal').value.trim(),
        tipe_kamar: document.getElementById('kb_tipe_kamar').value || 'quad',
        harga_custom: document.getElementById('kb_harga_custom').value.trim(),
        status: document.getElementById('kb_status').value,
        catatan: document.getElementById('kb_catatan').value.trim(),
        jenis_kelamin: document.getElementById('kb_jenis_kelamin').value || null,
        tempat_lahir: document.getElementById('kb_tempat_lahir').value.trim() || null,
        tgl_lahir: document.getElementById('kb_tgl_lahir').value || null,
        alamat: document.getElementById('kb_alamat').value.trim() || null,
        kode_pos: document.getElementById('kb_kode_pos').value.trim() || null,
        telp_rumah: document.getElementById('kb_telp_rumah').value.trim() || null,
        ahli_waris_nama: document.getElementById('kb_ahli_waris_nama').value.trim() || null,
        ahli_waris_hubungan: document.getElementById('kb_ahli_waris_hubungan').value.trim() || null
    };

    if (!data.program_id) { showToast('Silakan pilih program terlebih dahulu', 'error'); return; }
    if (!data.nama) { showToast('Nama jamaah wajib diisi', 'error'); return; }

    // Modal ini sekarang khusus Edit -- jamaah baru dibuat otomatis lewat
    // Pendaftaran yang ditandai "Deal" (lihat autoConvertPendaftaranToJamaah),
    // jadi id di sini selalu terisi.
    const pendaftaranSourceId = null;

    try {
        let result;
        if (id) {
            result = await supabaseClient.from('kb_jamaah').update(data).eq('id', id);
        } else {
            result = await supabaseClient.from('kb_jamaah').insert([data]);
        }
        if (result.error) throw result.error;

        // Kalau jamaah ini dibuat dari data Pendaftaran, tandai pendaftarannya
        // sebagai "Deal" supaya tidak diinput dobel dari menu Form Pendaftaran.
        if (!id && pendaftaranSourceId) {
            try {
                const { error: pErr } = await supabaseClient.from('pendaftaran').update({ status: 'deal' }).eq('id', pendaftaranSourceId);
                if (!pErr) {
                    const idx = pendaftaranList.findIndex(p => String(p.id) === String(pendaftaranSourceId));
                    if (idx !== -1) pendaftaranList[idx].status = 'deal';
                    renderPendaftaranSection();
                }
            } catch (pErr) {
                console.error('Update status pendaftaran error:', pErr);
            }
        }

        // Sinkronkan balik ke Pendaftaran: kalau jamaah ini tertaut lewat
        // pendaftaran_id, & (a) program-nya barusan diganti, atau (b) status
        // baru saja masuk/keluar dari "Batal", pendaftaran asalnya ikut
        // diupdate supaya pipeline Pendaftaran & Data Jamaah tidak pernah beda
        // data (lihat getEffectiveProgramIdForPendaftaran).
        if (id && beforeCopy && beforeCopy.pendaftaran_id) {
            const programBerubah = String(beforeCopy.program_id || '') !== String(data.program_id || '');
            const jadiBatal = data.status === 'batal' && beforeCopy.status !== 'batal';
            const keluarDariBatal = beforeCopy.status === 'batal' && data.status !== 'batal';
            if (programBerubah || jadiBatal || keluarDariBatal) {
                const pendaftaranPatch = {};
                if (programBerubah) pendaftaranPatch.program_id = data.program_id;
                // "Batal" di Data Jamaah = jamaah tidak jadi berangkat -> pipeline
                // Pendaftaran ikut ditandai Batal. Sebaliknya, kalau status Batal
                // dibatalkan (jamaah aktif lagi), pipeline balik ke "Deal" karena
                // jamaahnya sudah pasti ada (bukan sekadar lead lagi).
                if (jadiBatal) pendaftaranPatch.status = 'batal';
                else if (keluarDariBatal) pendaftaranPatch.status = 'deal';

                try {
                    const { error: syncErr } = await supabaseClient.from('pendaftaran').update(pendaftaranPatch).eq('id', beforeCopy.pendaftaran_id);
                    if (!syncErr) {
                        const idx = pendaftaranList.findIndex(p => String(p.id) === String(beforeCopy.pendaftaran_id));
                        if (idx !== -1) { Object.assign(pendaftaranList[idx], pendaftaranPatch); renderPendaftaranSection(); }
                        if (jadiBatal) showToast('Pendaftaran terkait ikut ditandai "Batal"', 'info');
                        else if (keluarDariBatal) showToast('Pendaftaran terkait dikembalikan ke status "Deal"', 'info');
                    }
                } catch (syncErr) {
                    console.error('Sync ke pendaftaran gagal (non-fatal):', syncErr);
                }
            }
        }

        closeKbModal();
        await loadKbJamaah();
        renderKbProgramSelector();
        updateMetrics();
        // Sama seperti di confirmDeleteAction: badge kuota "X/45 Tersedia" di
        // tabel Program Umroh & Unggulan dihitung dari kbJamaahList saat
        // render, jadi tabelnya perlu di-render ulang begitu jamaah
        // ditambah/diedit -- bukan cuma nunggu ganti tab / reload halaman.
        if (currentData && currentData.length) renderTable(currentData);
        renderFeaturedSection();

        if (id && beforeCopy) {
            // Edit data yang sudah ada: cek field "ringan" mana yang berubah,
            // catat ke riwayat aktivitas, dan tawarkan Urungkan kalau ada yang berubah.
            const changedLabels = await logKbJamaahChanges(id, beforeCopy, data);
            if (changedLabels.length) {
                offerUndoJamaahEdit(id, beforeCopy, changedLabels);
            } else {
                showToast('Data jamaah berhasil diperbarui');
            }
        } else {
            showToast(id ? 'Data jamaah berhasil diperbarui' : 'Data jamaah berhasil ditambahkan');
        }

    } catch (err) {
        console.error('Save keberangkatan error:', err);
        showToast('Gagal menyimpan: ' + err.message, 'error');
    }
}

// Field "ringan" yang dilacak ke Riwayat Aktivitas & bisa diurungkan cepat
// lewat toast (bukan hapus, jadi wajar kalau bisa dibatalkan cepat tanpa
// buka lagi form edit). Field lain (nama, NIK, dsb) tidak butuh Urungkan
// secepat ini karena admin biasanya sadar betul saat mengetik ulang teks.
const JAMAAH_AUDIT_FIELDS = {
    status: 'Status Pembayaran',
    tipe_kamar: 'Tipe Kamar',
    harga_custom: 'Harga Khusus',
    catatan: 'Catatan'
};

// Mencatat field yang berubah ke jamaah_audit_log (ledger append-only).
// Mengembalikan daftar label field yang berubah (dipakai untuk toast Urungkan).
// Kegagalan di sini TIDAK membatalkan penyimpanan data jamaah — cukup dicatat
// ke console, supaya UX simpan data tidak terasa rapuh hanya gara-gara audit.
async function logKbJamaahChanges(jamaahId, before, after) {
    const changedFields = Object.keys(JAMAAH_AUDIT_FIELDS).filter(field => {
        const oldVal = (before[field] ?? '').toString();
        const newVal = (after[field] ?? '').toString();
        return oldVal !== newVal;
    });
    if (!changedFields.length) return [];
    try {
        const rows = changedFields.map(field => ({
            jamaah_id: jamaahId,
            jamaah_nama: after.nama || before.nama || null,
            aksi: 'ubah_' + field,
            field: JAMAAH_AUDIT_FIELDS[field],
            nilai_lama: (before[field] ?? '').toString() || '-',
            nilai_baru: (after[field] ?? '').toString() || '-',
            actor_role: currentRole || 'publik',
            actor_nama: getPetugasNama() || null
        }));
        const { error } = await supabaseClient.from('jamaah_audit_log').insert(rows);
        if (error) throw error;
    } catch (err) {
        console.warn('Gagal mencatat riwayat aktivitas jamaah (non-fatal):', err);
    }
    return changedFields.map(f => JAMAAH_AUDIT_FIELDS[f]);
}

// Toast "Urungkan" (5 detik) untuk perubahan field ringan pada jamaah —
// mengembalikan field yang berubah ke nilai sebelumnya kalau ditekan.
function offerUndoJamaahEdit(jamaahId, beforeCopy, changedLabels) {
    showUndoToast(`${changedLabels.join(', ')} diperbarui`, async () => {
        try {
            const restore = {};
            Object.keys(JAMAAH_AUDIT_FIELDS).forEach(field => { restore[field] = beforeCopy[field] ?? ''; });
            const { data: currentRow, error: curErr } = await supabaseClient
                .from('kb_jamaah').select('*').eq('id', jamaahId).maybeSingle();
            if (curErr) throw curErr;
            if (!currentRow) throw new Error('Data jamaah tidak ditemukan (mungkin sudah dihapus/diarsipkan)');
            const { error } = await supabaseClient.from('kb_jamaah').update(restore).eq('id', jamaahId);
            if (error) throw error;
            await logKbJamaahChanges(jamaahId, currentRow || {}, restore);
            await loadKbJamaah();
            renderKbProgramSelector();
            updateMetrics();
            showToast('Perubahan diurungkan');
        } catch (err) {
            console.error('Urungkan perubahan jamaah gagal:', err);
            showToast('Gagal mengurungkan: ' + err.message, 'error');
        }
    });
}

// ---- Riwayat Aktivitas per Jamaah: menampilkan isi jamaah_audit_log untuk
// 1 jamaah di panel <details> dalam modal Kelola Cicilan. Berguna untuk audit
// trail personal kalau nanti ada multi-admin (di luar nota_audit_log yang
// fokus ke kuitansi/nota pembayaran). ----
const JAMAAH_ACTIVITY_PAGE_SIZE = 20;

async function loadJamaahActivityLog(jamaahId) {
    const listEl = document.getElementById('jamaahActivityList');
    const countEl = document.getElementById('jamaahActivityCount');
    if (!listEl) return;
    try {
        const { data, error } = await supabaseClient
            .from('jamaah_audit_log')
            .select('*')
            .eq('jamaah_id', jamaahId)
            .order('created_at', { ascending: false })
            .limit(JAMAAH_ACTIVITY_PAGE_SIZE);
        if (error) throw error;

        const rows = data || [];
        if (countEl) countEl.textContent = rows.length ? `(${rows.length})` : '';
        if (!rows.length) {
            listEl.innerHTML = `<div class="jamaah-activity-empty"><i class="bi bi-journal"></i><p>Belum ada riwayat perubahan tercatat untuk jamaah ini.</p></div>`;
            return;
        }
        listEl.innerHTML = rows.map(r => {
            const waktu = r.created_at ? new Date(r.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
            const siapa = r.actor_nama || 'Tidak diketahui';
            const peran = r.actor_role ? ` (${escapeHtml(r.actor_role)})` : '';
            return `
            <div class="jamaah-activity-item">
                <div class="jamaah-activity-icon"><i class="bi bi-pencil-square"></i></div>
                <div class="jamaah-activity-body">
                    <div class="jamaah-activity-line">
                        <strong>${escapeHtml(r.field || 'Data')}</strong> diubah dari
                        <span class="jamaah-activity-val">${escapeHtml(r.nilai_lama || '-')}</span> →
                        <span class="jamaah-activity-val is-new">${escapeHtml(r.nilai_baru || '-')}</span>
                    </div>
                    <div class="jamaah-activity-meta">${escapeHtml(waktu)} · oleh ${escapeHtml(siapa)}${peran}</div>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        console.error('Load riwayat aktivitas jamaah error:', err);
        listEl.innerHTML = `<div style="padding:12px;color:var(--danger);font-size:12px;">Gagal memuat riwayat aktivitas.</div>`;
    }
}

// ============================================================
// 19B. KELOLA CICILAN (modal dipakai dari tombol "Bayar" di tabel Keberangkatan)
// ============================================================
async function openCicilanModal(jamaahId) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengelola pembayaran', 'error'); return; }
    cicilanJamaahId = jamaahId;
    hideNotaPreviewPanel();
    const modal = document.getElementById('cicilanModal');
    document.getElementById('cicilanForm').reset();
    document.getElementById('cic_jamaahId').value = jamaahId;
    document.getElementById('cic_tanggal').value = new Date().toISOString().slice(0, 10);
    document.getElementById('cicilanHistoryList').innerHTML = '<div style="padding:12px;color:var(--ink-soft);font-size:12px;">Memuat riwayat...</div>';
    document.getElementById('cicilanRingkasan').innerHTML = '';
    const activityListEl = document.getElementById('jamaahActivityList');
    if (activityListEl) activityListEl.innerHTML = '<div style="padding:12px;color:var(--ink-soft);font-size:12px;">Memuat riwayat aktivitas...</div>';
    modal.classList.add('open');
    await loadCicilanHistory(jamaahId);
    loadJamaahActivityLog(jamaahId); // tidak perlu ditunggu, boleh muncul belakangan
}

function closeCicilanModal() {
    document.getElementById('cicilanModal').classList.remove('open');
    hideNotaPreviewPanel();
    cicilanJamaahId = null;
    cicilanJamaahInfo = null;
    cicilanProgramInfo = null;
    cicilanHargaProgram = 0;
    cicilanSisaTagihan = 0;
}

async function loadCicilanHistory(jamaahId) {
    try {
        const { data: jamaahRow, error: jErr } = await withRetry(
            () => supabaseClient.from('kb_jamaah').select('*').eq('id', jamaahId).maybeSingle(),
            { label: 'Muat data jamaah' }
        );
        if (jErr) throw jErr;
        if (!jamaahRow) throw new Error('Data jamaah tidak ditemukan (mungkin sudah dihapus/diarsipkan)');

        const program = dataUmroh.find(p => String(p.id) === String(jamaahRow.program_id));
        const hargaProgram = getHargaKamarJamaah(program, jamaahRow);
        cicilanJamaahInfo = jamaahRow;
        cicilanProgramInfo = program || null;
        cicilanHargaProgram = hargaProgram;

        const { data, error } = await withRetry(
            () => supabaseClient.from('pembayaran_jamaah').select('*').eq('jamaah_id', jamaahId).order('tanggal', { ascending: false }),
            { label: 'Muat riwayat cicilan' }
        );
        if (error) throw error;
        cicilanList = data || [];

        const tipeKamarLabel = parseRupiahToNumber(jamaahRow.harga_custom) > 0 ? 'Harga Khusus' : (TIPE_KAMAR_LABEL[jamaahRow.tipe_kamar] || 'Quad');

        document.getElementById('cicilanModalTitle').innerHTML = `${jamaahRow.diarsipkan ? 'Riwayat Pembayaran (Arsip) — ' : 'Kelola Cicilan — '}${escapeHtml(jamaahRow.nama || '')} <span class="status-badge neutral pill-sm" style="vertical-align:middle;margin-left:4px;">${escapeHtml(tipeKamarLabel)}</span>`;
        const cicilanFormEl = document.getElementById('cicilanForm');
        if (cicilanFormEl) cicilanFormEl.style.display = jamaahRow.diarsipkan ? 'none' : '';

        const totalDibayar = cicilanList.reduce((sum, c) => sum + Number(c.jumlah || 0), 0);
        const sisa = Math.max(hargaProgram - totalDibayar, 0);
        cicilanSisaTagihan = sisa;
        const lebihBayar = Math.max(totalDibayar - hargaProgram, 0);
        const isLunas = hargaProgram > 0 && sisa <= 0;
        const pct = hargaProgram > 0 ? Math.min(100, Math.round((totalDibayar / hargaProgram) * 100)) : 0;
        // Peringatan kalau harga program belum diisi -- status "Lunas" tidak akan
        // pernah muncul otomatis walau sudah dibayar penuh, karena perhitungan
        // status butuh Harga Quint > 0 sebagai acuan (lihat syncJamaahStatus()).
        const hargaKosongWarning = !hargaProgram
            ? `<div class="cicilan-summary-warning"><i class="bi bi-exclamation-triangle-fill"></i> Harga Quint program ini belum diisi — status "Lunas" tidak bisa dihitung otomatis sebelum harga diisi di menu Manajemen &gt; Edit Program.</div>`
            : '';
        const lebihBayarWarning = (hargaProgram > 0 && lebihBayar > 0)
            ? `<div class="cicilan-summary-warning is-info"><i class="bi bi-info-circle-fill"></i> Kelebihan bayar ${formatRupiah(lebihBayar)} — cek apakah perlu di-refund atau dipindah sebagai DP program lain.</div>`
            : '';
        document.getElementById('cicilanRingkasan').innerHTML = `
            <div class="cicilan-summary-card${isLunas ? ' is-lunas' : ''}">
                <div class="cicilan-summary-program"><i class="bi bi-airplane-engines-fill"></i> ${program ? escapeHtml(program.nama) + (program.tgl ? ` <span class="cicilan-summary-program-date">— ${escapeHtml(program.tgl)}</span>` : '') : '<span class="cicilan-summary-program-empty">Program tidak ditemukan/sudah dihapus</span>'}</div>
                <div class="cicilan-summary-top">
                    <div>
                        <div class="cicilan-summary-label">${isLunas ? 'Status Pembayaran' : 'Sisa Tagihan'}</div>
                        <div class="cicilan-summary-sisa">${isLunas ? 'Lunas' : formatRupiah(sisa)}</div>
                    </div>
                    ${isLunas
                        ? `<span class="cicilan-summary-lunas-badge"><i class="bi bi-check-circle-fill"></i> Lunas</span>`
                        : `<span class="cicilan-summary-pct-badge">${pct}% terbayar</span>`}
                </div>
                <div class="cicilan-progress-track"><div class="cicilan-progress-fill" style="width:${pct}%;"></div></div>
                <div class="cicilan-summary-foot">
                    <span>Tipe Kamar <b>${escapeHtml(tipeKamarLabel)}</b></span>
                    <span>Harga Program <b>${formatRupiah(hargaProgram)}</b></span>
                    <span>Total Dibayar <b>${formatRupiah(totalDibayar)}</b></span>
                </div>
                ${hargaKosongWarning}
                ${lebihBayarWarning}
            </div>`;

        renderCicilanHistory();

    } catch (err) {
        console.error('Load cicilan history error:', err);
        document.getElementById('cicilanHistoryList').innerHTML = `<div style="padding:12px;color:var(--danger);font-size:12px;">Gagal memuat riwayat pembayaran.</div>`;
    }
}

function renderCicilanHistory() {
    const listEl = document.getElementById('cicilanHistoryList');
    const countEl = document.getElementById('cicilanHistoryCount');
    const btnRiwayat = document.getElementById('btnNotaRiwayat');
    if (countEl) countEl.textContent = cicilanList.length ? `(${cicilanList.length})` : '';
    if (btnRiwayat) btnRiwayat.disabled = !cicilanList.length;
    if (!cicilanList.length) {
        listEl.innerHTML = `<div class="cicilan-history-empty"><i class="bi bi-receipt"></i><p>Belum ada pembayaran tercatat.</p></div>`;
        return;
    }
    listEl.innerHTML = cicilanList.map(c => {
        const isRefund = Number(c.jumlah || 0) < 0 || c.metode === 'Refund';
        const metodeClass = isRefund ? 'refund' : (c.metode === 'Cash' ? 'cash' : (c.metode === 'Transfer' ? '' : 'lainnya'));
        const amountDisplay = isRefund
            ? `- ${formatRupiah(Math.abs(Number(c.jumlah || 0)))}`
            : formatRupiah(Number(c.jumlah || 0));
        return `
        <div class="cicilan-history-item${isRefund ? ' is-refund' : ''}">
            <div>
                <span class="cicilan-history-amount${isRefund ? ' is-refund' : ''}">${amountDisplay}</span>
                ${c.metode ? `<span class="cicilan-history-badge ${metodeClass}">${escapeHtml(c.metode)}</span>` : ''}
                <div class="cicilan-history-meta">${escapeHtml(c.tanggal || '-')}${c.keterangan ? ' · ' + escapeHtml(c.keterangan) : ''}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                ${!isRefund ? `
                <button type="button" class="cicilan-nota-btn" onclick="previewNotaPembayaran('${c.id}', this)" title="Unduh nota bukti pembayaran (JPEG)">
                    <i class="bi bi-download"></i> Unduh Nota
                </button>` : ''}
                <button type="button" class="cicilan-delete-btn" onclick="deleteCicilan('${c.id}')" title="Hapus ${isRefund ? 'refund' : 'pembayaran'} ini">
                    <i class="bi bi-trash-fill"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}

// ============================================================
// 19B2. MENU "PEMBAYARAN" (admin) — kodenya dipindah ke modul lazy js/modules/pembayaran.js
// ============================================================

// ============================================================
// 19C. NOTA PEMBAYARAN (bukti bayar per cicilan, unduh sebagai JPEG)
// Dirender di kontainer tersembunyi #notaRenderArea lalu di-snapshot
// pakai html2canvas jadi gambar JPEG yang bisa diunduh/dikirim ke jamaah.
// ============================================================
// Nilai default (fallback) dipakai selama loadCompanyProfile() belum selesai
// mengambil data dari Supabase, atau kalau baris konfigurasinya belum pernah
// diisi sama sekali. Setelah loadCompanyProfile() jalan, isi objek ini akan
// ditimpa (in-place, bukan dibuat const baru) supaya semua fungsi lain yang
// sudah menyimpan referensi ke NOTA_PERUSAHAAN otomatis ikut ter-update.
let NOTA_PERUSAHAAN = {
    brand: 'AMIRU TOUR',
    logo: 'assets/logo-amirutour.png',
    nama: 'PT AMIRU HARAMAIN INDONESIA',
    alamat: 'Jl. Taman Kenari No A3 Kledokan, Caturtunggal, Kec. Depok, Kabupaten Sleman, DIY',
    telp: '0851-2233-6300',
    email: 'salam@amirutour.com',
    // Sumber tunggal daftar rekening pembayaran yang dicetak di footer SEMUA
    // jenis nota (Nota Pembayaran, Nota Riwayat, Kuitansi) lewat
    // buildRekeningFooterHTML() — sebelumnya teks ini di-copy-paste manual
    // persis sama di 3 tempat berbeda di file ini, jadi kalau rekening
    // berubah harus diingat untuk update 3x (rawan salah satu kelewat).
    // Sekarang cukup ubah di satu tempat ini, otomatis ikut berubah di
    // ketiga jenis nota.
    rekening: [
        { bank: 'Bank Syariah Indonesia', nomor: '2026 64 2027', an: 'Amiru Tour' },
        { bank: 'Bank Nasional Indonesia', nomor: '2026 64 2026', an: 'Amiru Haramain Indonesia' }
    ],
    // Nomor WA yang dicetak di bagian penutup caption marketing WA (Generate Auto
    // WA Text & Generate Caption AI) — dulu hardcode ('6285122336300' &
    // '6285196241819') di 2 tempat berbeda di kode, terpisah dari field
    // "Telepon" di atas (yang dipakai di kop nota, bukan caption marketing).
    kontak_wa: ['6285122336300', '6285196241819']
};

// ========== PROFIL PERUSAHAAN (dinamis, tersimpan di Supabase tg_config) ==========
// Sebelumnya semua data di NOTA_PERUSAHAAN (nama, alamat, telp, email, logo,
// rekening) hardcode langsung di kode. Sekarang disimpan di tabel tg_config
// (key/value, tabel yang sama dipakai untuk pengaturan ticker/infobar) supaya
// bisa diedit lewat menu admin "Perusahaan" tanpa perlu ubah kode.
const COMPANY_PROFILE_KEY = 'company_profile';

async function loadCompanyProfile() {
    try {
        // [FIX] .single() bikin PostgREST balas 406 di console kalau baris
        // 'company_profile' belum pernah disimpan (instalasi baru) — error
        // tetap ditangani (fallback ke default) tapi noise-nya mengganggu.
        // .maybeSingle() diam-diam balas data:null kalau 0 baris, tanpa 406.
        const { data, error } = await supabaseClient.from('tg_config').select('value').eq('key', COMPANY_PROFILE_KEY).maybeSingle();
        if (error || !data || !data.value) return; // belum pernah disimpan -> pakai default
        const saved = JSON.parse(data.value);
        NOTA_PERUSAHAAN = {
            brand: saved.brand || NOTA_PERUSAHAAN.brand,
            logo: saved.logo || NOTA_PERUSAHAAN.logo,
            nama: saved.nama || NOTA_PERUSAHAAN.nama,
            alamat: saved.alamat || NOTA_PERUSAHAAN.alamat,
            telp: saved.telp || NOTA_PERUSAHAAN.telp,
            email: saved.email || NOTA_PERUSAHAAN.email,
            rekening: Array.isArray(saved.rekening) && saved.rekening.length ? saved.rekening : NOTA_PERUSAHAAN.rekening,
            kontak_wa: Array.isArray(saved.kontak_wa) && saved.kontak_wa.length ? saved.kontak_wa : NOTA_PERUSAHAAN.kontak_wa
        };
    } catch (_) {
        // Gagal ambil/parse -> diamkan, tetap pakai default supaya nota tetap bisa dicetak
    }
}

// Draft rekening yang sedang diedit di form Profil Perusahaan (array of {bank,nomor,an})
let profileRekeningDraft = [];
// Draft nomor WA marketing yang sedang diedit (array of string, tanpa "wa.me/")
let profileKontakWaDraft = [];
// Data URL logo yang baru dipilih user tapi belum disimpan (null = belum ganti, pakai logo lama)
let profileLogoPendingDataUrl = null;

function renderCompanyProfileForm() {
    profileRekeningDraft = (NOTA_PERUSAHAAN.rekening || []).map(r => ({ ...r }));
    profileKontakWaDraft = (NOTA_PERUSAHAAN.kontak_wa || []).slice();
    profileLogoPendingDataUrl = null;
    return `
        <div class="admin-section-header">
            <div><h4>Profil Perusahaan</h4>
            <p>Data ini dipakai untuk kop &amp; footer semua nota (Nota Pembayaran, Nota Riwayat, Kuitansi) — ubah di sini, otomatis ikut berubah di semua nota tanpa perlu edit kode.</p></div>
        </div>

        <div class="admin-fieldset" style="margin-top:28px;">
            <div class="admin-fieldset-title"><i class="bi bi-card-image"></i> Logo</div>
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
                <img id="cp_logo_preview" src="${escapeHtml(NOTA_PERUSAHAAN.logo)}" alt="Logo" style="height:56px;width:auto;max-width:160px;object-fit:contain;border:1px solid var(--line);border-radius:8px;padding:6px;background:#fff;">
                <div>
                    <input type="file" id="cp_logo_file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onchange="handleCompanyLogoUpload(this)" style="display:block;">
                    <p style="font-size:11.5px;color:var(--ink-soft);margin-top:6px;">PNG/JPEG/WebP/SVG, disarankan latar transparan, maks 2MB.</p>
                </div>
            </div>
        </div>

        <div class="admin-fieldset">
            <div class="admin-fieldset-title"><i class="bi bi-briefcase-fill"></i> Identitas</div>
            <div class="form-group">
                <label>Brand / Nama Singkat<span class="required">*</span></label>
                <input type="text" id="cp_brand" value="${escapeHtml(NOTA_PERUSAHAAN.brand)}" placeholder="Contoh: AMIRU TOUR">
            </div>
            <div class="form-group">
                <label>Nama Perusahaan (Resmi)<span class="required">*</span></label>
                <input type="text" id="cp_nama" value="${escapeHtml(NOTA_PERUSAHAAN.nama)}" placeholder="Contoh: PT AMIRU HARAMAIN INDONESIA">
            </div>
            <div class="form-group">
                <label>Alamat<span class="required">*</span></label>
                <textarea id="cp_alamat" rows="2" placeholder="Alamat lengkap perusahaan">${escapeHtml(NOTA_PERUSAHAAN.alamat)}</textarea>
            </div>
            <div class="form-group">
                <label>Telepon</label>
                <input type="text" id="cp_telp" value="${escapeHtml(NOTA_PERUSAHAAN.telp)}" placeholder="0851-xxxx-xxxx">
            </div>
            <div class="form-group" style="margin-bottom:0;">
                <label>Email</label>
                <input type="email" id="cp_email" value="${escapeHtml(NOTA_PERUSAHAAN.email)}" placeholder="nama@domain.com">
            </div>
        </div>

        <div class="admin-fieldset">
            <div class="admin-fieldset-title"><i class="bi bi-bank"></i> Rekening Pembayaran</div>
            <p style="font-size:12.5px;color:var(--ink-soft);margin-top:-6px;margin-bottom:14px;">Daftar rekening yang dicetak di footer semua nota. Bisa lebih dari satu.</p>
            <div id="cp_rekening_list"></div>
            <button type="button" class="btn-cancel" onclick="addCompanyRekeningRow()"><i class="bi bi-plus-lg"></i> Tambah Rekening</button>
        </div>

        <div class="admin-fieldset">
            <div class="admin-fieldset-title"><i class="bi bi-whatsapp"></i> Kontak WA Marketing</div>
            <p style="font-size:12.5px;color:var(--ink-soft);margin-top:-6px;margin-bottom:14px;">Nomor WA yang dicetak di bagian penutup caption marketing (Generate Teks WA Otomatis &amp; Generate Caption AI) — beda dari field Telepon di atas.</p>
            <div id="cp_kontak_wa_list"></div>
            <button type="button" class="btn-cancel" onclick="addCompanyKontakWaRow()"><i class="bi bi-plus-lg"></i> Tambah Nomor WA</button>
        </div>

        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">
            <button class="btn-primary" onclick="saveCompanyProfile()"><i class="bi bi-save-fill"></i> Simpan Profil</button>
        </div>
        <div id="cpProfileStatus" style="margin-top:12px;"></div>
    `;
}

function renderCompanyRekeningRows() {
    const wrap = document.getElementById('cp_rekening_list');
    if (!wrap) return;
    if (!profileRekeningDraft.length) {
        wrap.innerHTML = `<p class="cp-rekening-empty">Belum ada rekening. Klik "Tambah Rekening" di bawah.</p>`;
        return;
    }
    wrap.innerHTML = profileRekeningDraft.map((r, i) => `
        <div class="cp-rekening-row">
            <div class="cp-rekening-field">
                <label>Nama Bank</label>
                <input type="text" value="${escapeHtml(r.bank || '')}" placeholder="Contoh: Bank Syariah Indonesia" oninput="updateCompanyRekeningField(${i}, 'bank', this.value)">
            </div>
            <div class="cp-rekening-field">
                <label>Nomor Rekening</label>
                <input type="text" value="${escapeHtml(r.nomor || '')}" placeholder="Contoh: 2026 64 2027" oninput="updateCompanyRekeningField(${i}, 'nomor', this.value)">
            </div>
            <div class="cp-rekening-field">
                <label>Atas Nama</label>
                <input type="text" value="${escapeHtml(r.an || '')}" placeholder="Contoh: Amiru Tour" oninput="updateCompanyRekeningField(${i}, 'an', this.value)">
            </div>
            <button type="button" class="btn-icon-ghost danger" title="Hapus" onclick="removeCompanyRekeningRow(${i})"><i class="bi bi-trash-fill"></i></button>
        </div>
    `).join('');
}

function addCompanyRekeningRow() {
    profileRekeningDraft.push({ bank: '', nomor: '', an: '' });
    renderCompanyRekeningRows();
}

function removeCompanyRekeningRow(index) {
    profileRekeningDraft.splice(index, 1);
    renderCompanyRekeningRows();
}

function updateCompanyRekeningField(index, field, value) {
    if (!profileRekeningDraft[index]) return;
    profileRekeningDraft[index][field] = value;
}

function renderCompanyKontakWaRows() {
    const wrap = document.getElementById('cp_kontak_wa_list');
    if (!wrap) return;
    if (!profileKontakWaDraft.length) {
        wrap.innerHTML = `<p class="cp-rekening-empty">Belum ada nomor WA. Klik "Tambah Nomor WA" di bawah.</p>`;
        return;
    }
    wrap.innerHTML = profileKontakWaDraft.map((n, i) => `
        <div class="cp-rekening-row" style="grid-template-columns:1fr auto;">
            <div class="cp-rekening-field">
                <label>Nomor WA (format 62xxxxxxxxxx)</label>
                <input type="text" value="${escapeHtml(n || '')}" placeholder="Contoh: 6285122336300" oninput="updateCompanyKontakWaField(${i}, this.value)">
            </div>
            <button type="button" class="btn-icon-ghost danger" title="Hapus" onclick="removeCompanyKontakWaRow(${i})"><i class="bi bi-trash-fill"></i></button>
        </div>
    `).join('');
}

function addCompanyKontakWaRow() {
    profileKontakWaDraft.push('');
    renderCompanyKontakWaRows();
}

function removeCompanyKontakWaRow(index) {
    profileKontakWaDraft.splice(index, 1);
    renderCompanyKontakWaRows();
}

function updateCompanyKontakWaField(index, value) {
    profileKontakWaDraft[index] = value;
}

function handleCompanyLogoUpload(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('❌ Logo terlalu besar! Maksimal 2MB.'); input.value = ''; return; }
    const reader = new FileReader();
    reader.onload = (e) => {
        profileLogoPendingDataUrl = e.target.result;
        const preview = document.getElementById('cp_logo_preview');
        if (preview) preview.src = profileLogoPendingDataUrl;
    };
    reader.onerror = () => showToast('❌ Gagal membaca file logo.');
    reader.readAsDataURL(file);
}

async function saveCompanyProfile() {
    const statusEl = document.getElementById('cpProfileStatus');
    const brand = document.getElementById('cp_brand').value.trim();
    const nama = document.getElementById('cp_nama').value.trim();
    const alamat = document.getElementById('cp_alamat').value.trim();
    const telp = document.getElementById('cp_telp').value.trim();
    const email = document.getElementById('cp_email').value.trim();
    const rekening = profileRekeningDraft
        .map(r => ({ bank: (r.bank || '').trim(), nomor: (r.nomor || '').trim(), an: (r.an || '').trim() }))
        .filter(r => r.bank || r.nomor || r.an);
    const kontak_wa = profileKontakWaDraft
        .map(n => (n || '').replace(/\D/g, ''))
        .filter(Boolean);

    if (!brand || !nama || !alamat) {
        if (statusEl) statusEl.innerHTML = `<p style="color:var(--danger);font-size:13px;"><i class="bi bi-exclamation-circle-fill"></i> Brand, Nama Perusahaan, dan Alamat wajib diisi.</p>`;
        return;
    }

    const payload = {
        brand,
        nama,
        alamat,
        telp,
        email,
        logo: profileLogoPendingDataUrl || NOTA_PERUSAHAAN.logo,
        rekening,
        kontak_wa
    };

    try {
        if (statusEl) statusEl.innerHTML = `<p style="color:var(--ink-soft);font-size:13px;"><i class="bi bi-hourglass-split"></i> Menyimpan...</p>`;
        const { error } = await supabaseClient.from('tg_config').upsert(
            [{ key: COMPANY_PROFILE_KEY, value: JSON.stringify(payload) }],
            { onConflict: 'key' }
        );
        if (error) throw error;
        NOTA_PERUSAHAAN = { ...payload };
        profileLogoPendingDataUrl = null;
        if (statusEl) statusEl.innerHTML = `<p style="color:var(--success);font-size:13px;"><i class="bi bi-check-circle-fill"></i> Profil perusahaan tersimpan.</p>`;
        showToast('✅ Profil perusahaan tersimpan');
    } catch (err) {
        if (statusEl) statusEl.innerHTML = `<p style="color:var(--danger);font-size:13px;"><i class="bi bi-exclamation-circle-fill"></i> Gagal menyimpan: ${escapeHtml(err.message || 'Error tidak diketahui')}</p>`;
        showToast('❌ Gagal menyimpan profil perusahaan');
    }
}

// [NOTA] Pembangun nota (buildNotaHTML, buildNotaRiwayatHTML, buildKuitansiHTML, export JPEG/PDF, preview panel,
// terbilang, tema nota, downloadNotaPembayaran, ...) dipindah ke modul lazy js/modules/nota.js.
// Modul yang memakai pembangun nota secara sinkron (kepulangan, manifest, rooming, audit-nota) mendeklarasikan
// deps: ['nota'] di LAZY_MODULES, jadi nota.js sudah termuat sebelum modul itu dieksekusi.
// Tetap di inti: NOTA_PERUSAHAAN + Profil Perusahaan, nomorNota(), lightbox nota, hideNotaPreviewPanel(),
// notaPreviewPending, logNotaAudit() (pencatatan audit tidak boleh bergantung pada unduhan modul).

// Resize: sesuaikan skala preview nota & lightbox. fitNotaPreviewScale ada di modul nota (guard typeof).
window.addEventListener('resize', () => {
    const panel = document.getElementById('cicilanPreviewPanel');
    if (panel && panel.style.display !== 'none') if (typeof fitNotaPreviewScale === 'function') fitNotaPreviewScale();
    const lightbox = document.getElementById('notaLightboxOverlay');
    if (lightbox && lightbox.classList.contains('open')) fitNotaLightboxScale();
});

function nomorNota(cicilan) {
    // Nomor resmi dibuat & dikunci oleh database (trigger + sequence, lihat
    // sql/19_tambah_nota_audit.sql) supaya sekuensial, permanen, dan tidak
    // berubah tiap nota dicetak ulang. Fallback di bawah HANYA dipakai kalau
    // migrasi SQL itu belum dijalankan di project Supabase — diberi label
    // "(sementara)" secara eksplisit supaya tidak disalahartikan sebagai nomor resmi.
    if (cicilan && cicilan.nomor_nota) return cicilan.nomor_nota;
    if (cicilan && cicilan.id === 'draft') return 'DRAFT — belum tersimpan';
    const tgl = (cicilan.tanggal || '').replace(/-/g, '');
    const idPart = String(cicilan.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-5).toUpperCase();
    return `AHI/NOTA/${tgl || '000000'}/${idPart || '00000'} (sementara)`;
}

// Nomor yang ditampilkan saat sebuah baris pembayaran berstatus KUITANSI
// (lihat buildNotaHTML) -- seri nomornya SENGAJA terpisah dari nomorNota()
// (lihat sql/23_tambah_nomor_kuitansi_di_pembayaran.sql), diambil & dikunci
// permanen ke kolom nomor_kuitansi baris itu saat pertama kali diunduh
// (lihat downloadNotaPembayaran()). Sebelum diunduh (mis. saat preview live
// atau reprint sebelum kolomnya terisi), tampilkan placeholder yang jelas
// belum resmi -- sama semangatnya dengan fallback "(sementara)" di atas.
function nomorKuitansiTampilan(cicilan) {
    if (cicilan && cicilan.nomor_kuitansi) return cicilan.nomor_kuitansi;
    if (cicilan && cicilan.id === 'draft') return 'DRAFT — belum tersimpan';
    return `AHI/KWT/${new Date().getFullYear()}/—— (dibuat otomatis saat diunduh)`;
}

// ============================================================
// 19D. AUDIT NOTA — hash & log tiap kali nota diterbitkan/diunduh
// ============================================================
// SHA-256 hex memakai Web Crypto API bawaan browser (tanpa library tambahan).
async function sha256Hex(text) {
    const buf = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Kode Verifikasi yang dicetak di nota (pendek, mudah dibaca & diketik ulang)
// = 10 karakter pertama dari hash konten nota. Karena hash-nya deterministik
// dari data nota (nomor, jamaah, jumlah, tanggal), siapa pun bisa menghitung
// ulang hash yang sama dari data aslinya untuk mengecek nota itu tidak dipalsukan.
// dicetak_oleh_nama sekarang otomatis = email akun yang login (bukan input manual
// lagi) -- lebih akurat untuk audit karena tidak bisa diketik bebas/dipalsukan user.
// Untuk TAMPILAN di tabel Audit Nota dipakai dicetak_oleh_label (nama, mis. "Ali
// Santoso") yang disimpan terpisah lewat getPetugasDisplayName() -- lihat
// logNotaAudit() & sql/21_tambah_dicetak_oleh_label_audit.sql.
function getPetugasNama() {
    try { return sessionStorage.getItem('admin_login_email') || ''; } catch (_) { return ''; }
}

// Nama penerima/petugas yang dicetak di kolom tanda tangan kanan nota. Dulu
// nama ini ditulis tetap ("Ali Santoso") di semua nota otomatis (Nota
// Pembayaran & Nota Riwayat) walau petugas yang login/mengunduh berbeda-beda
// — sekarang diambil dinamis dari akun yang sedang login. Yang dicetak di
// nota adalah NAMA akun (kolom "label" di dashboard_profiles, mis. "Ali
// Santoso"), BUKAN email login-nya — email tetap dipakai terpisah untuk
// dicetak_oleh_nama di audit log (lebih akurat untuk audit karena tidak
// bisa diketik bebas/dipalsukan user), tapi kurang enak dibaca kalau dicetak
// di nota yang diterima jamaah.
function getPetugasDisplayName() {
    try {
        const label = sessionStorage.getItem('admin_login_label');
        if (label) return label;
    } catch (_) {}
    return getPetugasNama() || 'Petugas Amiru Tour';
}

// Mencatat 1 baris ke nota_audit_log (ledger append-only) setelah nota
// berhasil diunduh. Kegagalan di sini TIDAK membatalkan unduhan nota (nota
// sudah terlanjur di tangan user) — cukup dicatat ke console & toast ringan,
// supaya UX unduh nota tidak terasa rapuh hanya karena koneksi ke DB gempal.
async function logNotaAudit({ jenis, nomorNotaValue, jamaahId, jamaahNama, programNama, jumlah, metadata }) {
    try {
        const konten = JSON.stringify({ jenis, nomorNotaValue, jamaahId, jamaahNama, jumlah, metadata, dicetak: new Date().toISOString() });
        const hash = await sha256Hex(konten);
        const kodeVerifikasi = hash.slice(0, 10).toUpperCase();
        const { error } = await supabaseClient.from('nota_audit_log').insert([{
            nomor_nota: nomorNotaValue,
            jenis,
            jamaah_id: jamaahId || null,
            jamaah_nama: jamaahNama || null,
            program_nama: programNama || null,
            jumlah: jumlah != null ? jumlah : null,
            dicetak_oleh_role: currentRole || 'publik',
            dicetak_oleh_nama: getPetugasNama() || null,
            dicetak_oleh_label: getPetugasDisplayName() || null,
            kode_verifikasi: kodeVerifikasi,
            hash_konten: hash,
            metadata: metadata || null
        }]);
        if (error) throw error;
        return kodeVerifikasi;
    } catch (err) {
        console.warn('Gagal mencatat audit nota (non-fatal):', err);
        return null;
    }
}

// Panel Admin "Audit Nota" (daftar log, filter, pratinjau, statistik) dipindah ke js/modules/audit-nota.js.


// Salin link katalog publik (katalog.html) ke clipboard — dipakai tombol "Share Katalog" di topbar.
function getKatalogUrl() {
    return new URL('katalog.html', window.location.href).href; // buang query/hash, ikut domain aktif
}
// Helper salin ke clipboard untuk link publik; nama = "katalog" (dipakai di teks toast)
async function salinLinkPublik(url, nama) {
    try {
        await navigator.clipboard.writeText(url);
        showToast('Link ' + nama + ' disalin: ' + url);
    } catch (err) {
        // Fallback untuk browser/lingkungan tanpa Clipboard API (mis. HTTP non-secure)
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', 'readonly');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            showToast('Link ' + nama + ' disalin: ' + url);
        } catch (err2) {
            showToast('Gagal menyalin. Link ' + nama + ': ' + url, 'error');
        } finally {
            document.body.removeChild(ta);
        }
    }
}
async function copyKatalogLink() { return salinLinkPublik(getKatalogUrl(), 'katalog'); }
window.copyKatalogLink = copyKatalogLink;


// ---- Preview Nota: tampilkan dulu sebelum diunduh sebagai JPEG. Kode
// Verifikasi & pencatatan ke audit log baru terjadi saat tombol "Unduh
// JPEG" di modal preview ditekan, bukan saat preview dibuka — supaya
// batal preview tidak meninggalkan baris log audit yang "nyasar". ----
let notaPreviewPending = null;
let notaLiveDraftDebounce = null;

// ---- "Perbesar" (lightbox layar penuh) untuk preview nota. Mengambil ulang
// HTML nota yang sedang tampil di panel preview (bukan generate ulang) supaya
// konsisten persis dengan yang sedang dilihat user, hanya beda skala. ----
function openNotaLightbox(sourceContentId = 'notaPreviewContent') {
    const panelInner = document.querySelector(`#${sourceContentId} .nota-preview-scale-inner`);
    const stage = document.getElementById('notaLightboxStage');
    const overlay = document.getElementById('notaLightboxOverlay');
    if (!panelInner || !stage || !overlay || !panelInner.firstElementChild) return;
    stage.innerHTML = `<div>${panelInner.firstElementChild.outerHTML}</div>`;
    overlay.classList.add('open');
    document.addEventListener('keydown', handleNotaLightboxKeydown);
    requestAnimationFrame(fitNotaLightboxScale);
}

function closeNotaLightbox() {
    const overlay = document.getElementById('notaLightboxOverlay');
    const stage = document.getElementById('notaLightboxStage');
    if (overlay) overlay.classList.remove('open');
    if (stage) stage.innerHTML = '';
    document.removeEventListener('keydown', handleNotaLightboxKeydown);
}

function handleNotaLightboxKeydown(e) {
    if (e.key === 'Escape') closeNotaLightbox();
}

function fitNotaLightboxScale() {
    const stage = document.getElementById('notaLightboxStage');
    if (!stage) return;
    const nota = stage.firstElementChild ? stage.firstElementChild.firstElementChild : null;
    if (!nota) return;

    nota.style.transform = 'none';
    const naturalWidth = nota.offsetWidth;
    const naturalHeight = nota.offsetHeight;
    if (!naturalWidth || !naturalHeight) return;

    // Layar penuh: nota di-zoom mengisi ruang stage semaksimal mungkin, tanpa
    // plafon atas (boleh jauh lebih besar dari ukuran aslinya di monitor
    // besar — ini cuma preview via CSS transform, bukan sumber file unduhan,
    // jadi aman), dan mengecil seperlunya saja kalau viewport lebih kecil
    // dari nota.
    const availW = stage.clientWidth || naturalWidth;
    const availH = stage.clientHeight || naturalHeight;
    const scale = Math.min(availW / naturalWidth, availH / naturalHeight);

    nota.style.transformOrigin = 'top left';
    nota.style.transform = `scale(${scale})`;
    stage.firstElementChild.style.width = (naturalWidth * scale) + 'px';
    stage.firstElementChild.style.height = (naturalHeight * scale) + 'px';
}

function hideNotaPreviewPanel() {
    const panel = document.getElementById('cicilanPreviewPanel');
    if (panel) panel.style.display = 'none';
    const content = document.getElementById('notaPreviewContent');
    if (content) content.innerHTML = '';
    notaPreviewPending = null;
    closeNotaLightbox();
}

// ---- Preview LIVE: nota di kanan otomatis ikut berubah selagi field
// "Tambah Pembayaran" diisi — jadi bisa dicek dulu tampilannya sebelum data
// itu benar-benar disimpan. Ini murni pratinjau di browser (tidak menyentuh
// DB / audit log sama sekali), makanya tombol Unduh disembunyikan di mode ini
// — nota resminya baru bisa diunduh setelah pembayarannya disimpan. ----
function handleCicilanFormLiveInput() {
    clearTimeout(notaLiveDraftDebounce);
    // updateLiveNotaDraft ada di modul lazy 'nota'; gagal unduh = pratinjau live saja yang tak muncul (tanpa toast per ketikan).
    notaLiveDraftDebounce = setTimeout(() => { ensureModuleLoaded('nota').then(() => updateLiveNotaDraft()).catch(() => {}); }, 200);
}

// Isi otomatis field Jumlah dengan sisa tagihan yang masih berjalan --
// mempercepat input saat jamaah bayar pas/lunas (kasus paling sering terjadi),
// staf tidak perlu hitung manual atau lihat bolak-balik ke ringkasan di atas.
function isiSisaTagihanKeForm() {
    if (!cicilanSisaTagihan || cicilanSisaTagihan <= 0) {
        showToast('Tidak ada sisa tagihan untuk diisi otomatis', 'error');
        return;
    }
    const jumlahInput = document.getElementById('cic_jumlah');
    const metodeInput = document.getElementById('cic_metode');
    if (metodeInput && metodeInput.value === 'Refund') metodeInput.value = 'Transfer';
    if (jumlahInput) {
        jumlahInput.value = String(Math.round(cicilanSisaTagihan));
        formatNominalInput(jumlahInput);
        jumlahInput.focus();
    }
    handleCicilanFormLiveInput();
}

let cicilanSaving = false; // guard anti double-submit (double-click/double-tap pas koneksi lambat)
async function saveCicilan(e) {
    e.preventDefault();
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengelola pembayaran', 'error'); return; }
    if (cicilanSaving) return; // sudah ada proses simpan berjalan, abaikan submit susulan
    const jamaahId = document.getElementById('cic_jamaahId').value;
    const tanggal = document.getElementById('cic_tanggal').value;
    // Field cic_jumlah sekarang menampilkan titik ribuan (lihat
    // formatNominalInput()), jadi diparse pakai parseRupiahToNumber() yang
    // membuang semua karakter non-digit, bukan Number() langsung.
    const jumlahRaw = document.getElementById('cic_jumlah').value;
    const isRefund = document.getElementById('cic_metode').value === 'Refund';
    // Staf tetap mengetik angka positif (jumlah yang dikembalikan) di form;
    // untuk metode Refund kita simpan sebagai baris NEGATIF di pembayaran_jamaah
    // supaya SUM total dibayar otomatis berkurang tanpa perlu kolom/tabel baru.
    const jumlahAbs = parseRupiahToNumber(jumlahRaw);
    const jumlah = isRefund ? -jumlahAbs : jumlahAbs;
    const metode = document.getElementById('cic_metode').value;
    const keterangan = document.getElementById('cic_keterangan').value.trim();

    if (!jamaahId) { showToast('Data jamaah tidak valid', 'error'); return; }
    if (!tanggal) { showToast('Tanggal wajib diisi', 'error'); return; }
    if (!jumlahAbs || jumlahAbs <= 0) { showToast(isRefund ? 'Jumlah refund wajib diisi' : 'Jumlah pembayaran wajib diisi', 'error'); return; }

    const submitBtn = document.querySelector('#cicilanForm button[type="submit"]');
    cicilanSaving = true;
    if (submitBtn) submitBtn.disabled = true;
    try {
        // [FIX] .select('id') supaya bisa dipastikan baris pembayaran BENAR-
        // BENAR tersimpan. Tanpa ini, kalau ditolak RLS (sesi kedaluwarsa dll),
        // toast tetap bilang "berhasil" padahal uang yang dicatat tidak masuk
        // ke database sama sekali -- riskan untuk data uang.
        // harga_program_snapshot: catat harga acuan (Triple/Quad/Double/custom)
        // yang berlaku PERSIS saat transaksi ini dicatat, supaya kalau nanti
        // tipe_kamar/harga_custom jamaah berubah, nota transaksi ini tetap bisa
        // menunjukkan harga historis yang benar (lihat sql/tambah_snapshot_harga_pembayaran.sql).
        // Tidak dipakai untuk menentukan status lunas -- itu tetap live.
        const { data: insertedRows, error } = await supabaseClient.from('pembayaran_jamaah')
            .insert([{ jamaah_id: jamaahId, tanggal, jumlah, metode, keterangan, harga_program_snapshot: cicilanHargaProgram || null }]).select('id');
        if (error) throw error;
        if (!insertedRows || insertedRows.length === 0) {
            throw new Error('Pembayaran tidak berhasil tersimpan ke database. Kemungkinan sesi login sudah kedaluwarsa atau akun tidak punya izin — coba logout lalu login ulang, JANGAN dianggap sudah tercatat.');
        }

        showToast(isRefund ? 'Refund berhasil dicatat' : 'Pembayaran berhasil dicatat');
        document.getElementById('cicilanForm').reset();
        document.getElementById('cic_jamaahId').value = jamaahId;
        document.getElementById('cic_tanggal').value = new Date().toISOString().slice(0, 10);
        if (notaPreviewPending && notaPreviewPending.type === 'draft') hideNotaPreviewPanel();

        await syncJamaahStatus(jamaahId);
        await loadCicilanHistory(jamaahId);
        if (kbSelectedProgram) await loadKbJamaahForProgram(kbSelectedProgram);
        if (adminSubTab === 'pembayaran') await renderPembayaranPanel();

    } catch (err) {
        console.error('Save cicilan error:', err);
        showToast('Gagal menyimpan pembayaran: ' + err.message, 'error');
    } finally {
        cicilanSaving = false;
        if (submitBtn) submitBtn.disabled = false;
    }
}

async function deleteCicilan(id) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk menghapus pembayaran', 'error'); return; }
    const cic = cicilanList.find(c => String(c.id) === String(id));
    if (!cic) { showToast('Data pembayaran tidak ditemukan', 'error'); return; }
    // Gunakan modal konfirmasi kustom (bukan confirm() bawaan browser) supaya
    // konsisten dengan app, dan hapus dicatat ke log audit nota.
    const isRefund = Number(cic.jumlah || 0) < 0;
    openDeleteModal('pembayaran_jamaah', id,
        `${isRefund ? 'refund' : 'pembayaran'} ${formatRupiah(Math.abs(Number(cic.jumlah || 0)))}${cic.tanggal ? ' (' + cic.tanggal + ')' : ''}`);
}

// Dipanggil dari confirmDeleteAction() setelah hapus pembayaran_jamaah berhasil.
async function afterDeleteCicilan(jamaahId) {
    await syncJamaahStatus(jamaahId);
    await loadCicilanHistory(jamaahId);
    if (kbSelectedProgram) await loadKbJamaahForProgram(kbSelectedProgram);
    if (adminSubTab === 'pembayaran') await renderPembayaranPanel();
}

// Sinkronkan kolom status di kb_jamaah (lunas/dp/pending) berdasarkan total
// pembayaran yang sudah tercatat, supaya badge status di tab Keberangkatan
// selalu konsisten dengan data di tab Pembayaran & Cicilan.
async function syncJamaahStatus(jamaahId) {
    try {
        const { data: jamaahRow, error: jErr } = await supabaseClient.from('kb_jamaah').select('*').eq('id', jamaahId).maybeSingle();
        if (jErr || !jamaahRow) return;
        // Status "Batal" diset manual lewat form Edit Jamaah dan sengaja tidak
        // dihidupkan lagi otomatis oleh transaksi pembayaran/refund berikutnya.
        if (jamaahRow.status === 'batal') return;

        const program = dataUmroh.find(p => String(p.id) === String(jamaahRow.program_id));
        const hargaProgram = getHargaKamarJamaah(program, jamaahRow);

        const { data: bayarData, error: bErr } = await supabaseClient.from('pembayaran_jamaah').select('jumlah').eq('jamaah_id', jamaahId);
        if (bErr) return;

        const totalDibayar = (bayarData || []).reduce((sum, b) => sum + Number(b.jumlah || 0), 0);
        let statusBaru;
        if (hargaProgram > 0 && totalDibayar >= hargaProgram) statusBaru = 'lunas';
        else if (totalDibayar > 0) statusBaru = 'dp';
        else statusBaru = 'pending';

        if (statusBaru !== jamaahRow.status) {
            // [FIX] cek betul apakah update-nya kena baris (.select('id')) --
            // total uang di riwayat pembayaran tetap akurat kalau ini gagal,
            // tapi badge status lunas/DP/pending jamaah bisa nyangkut salah
            // dan menyesatkan staf soal siapa yang sudah/belum lunas.
            const { data: updRows, error: updErr } = await supabaseClient
                .from('kb_jamaah').update({ status: statusBaru }).eq('id', jamaahId).select('id');
            if (updErr || !updRows || !updRows.length) {
                console.warn('Sinkron status jamaah gagal tersimpan:', updErr);
                showToast('Pembayaran sudah tercatat, tapi status lunas/DP jamaah gagal disinkronkan (sesi login mungkin kedaluwarsa) — refresh halaman lalu cek ulang', 'error');
                return;
            }
            await loadKbJamaah();
        }
    } catch (err) {
        console.warn('Sync status jamaah gagal (non-fatal):', err);
    }
}

// Re-sync massal: dipanggil setelah harga sebuah program diedit, supaya
// status bayar (lunas/dp/pending) SELURUH jamaah di program itu langsung
// disesuaikan ulang dengan harga terbaru — sebelumnya status jamaah hanya
// ikut ter-update kalau ADA transaksi pembayaran baru ditambah/dihapus untuk
// jamaah itu; kalau cuma harga program yang diubah (tanpa ada
// transaksi baru), status lama tetap "nyangkut" sampai tidak sengaja
// ter-trigger oleh pembayaran berikutnya. Query dibuat batch (bukan
// per-jamaah looping seperti syncJamaahStatus) supaya tetap ringan walau
// jamaah di satu program jumlahnya banyak.
async function syncJamaahStatusForProgram(programId) {
    try {
        const program = dataUmroh.find(p => String(p.id) === String(programId));

        const { data: jamaahRows, error: jErr } = await supabaseClient.from('kb_jamaah').select('id, status, tipe_kamar, harga_custom').eq('program_id', programId);
        if (jErr || !jamaahRows || !jamaahRows.length) return;

        const jamaahIds = jamaahRows.map(j => j.id);
        const { data: bayarData, error: bErr } = await supabaseClient.from('pembayaran_jamaah').select('jamaah_id, jumlah').in('jamaah_id', jamaahIds);
        if (bErr) return;

        const totalPerJamaah = {};
        (bayarData || []).forEach(b => {
            totalPerJamaah[b.jamaah_id] = (totalPerJamaah[b.jamaah_id] || 0) + Number(b.jumlah || 0);
        });

        const updates = [];
        for (const j of jamaahRows) {
            // Lewati jamaah yang statusnya sudah dikunci "Batal" secara manual —
            // lihat catatan yang sama di syncJamaahStatus().
            if (j.status === 'batal') continue;
            const hargaProgram = getHargaKamarJamaah(program, j);
            const totalDibayar = totalPerJamaah[j.id] || 0;
            let statusBaru;
            if (hargaProgram > 0 && totalDibayar >= hargaProgram) statusBaru = 'lunas';
            else if (totalDibayar > 0) statusBaru = 'dp';
            else statusBaru = 'pending';
            if (statusBaru !== j.status) updates.push({ id: j.id, status: statusBaru });
        }
        if (!updates.length) return;

        // [FIX] cek betul berapa baris yang benar-benar ke-update
        // (.select('id')) -- kalau ada yang ditolak RLS diam-diam (sesi
        // kedaluwarsa dll), staf perlu tahu badge status jamaah itu masih
        // status LAMA, bukan diam-diam dianggap sudah tersinkron.
        const updateResults = await Promise.all(updates.map(u =>
            supabaseClient.from('kb_jamaah').update({ status: u.status }).eq('id', u.id).select('id')
        ));
        const gagalCount = updateResults.filter(r => r.error || !r.data || !r.data.length).length;
        const suksesCount = updates.length - gagalCount;

        await loadKbJamaah();
        if (String(kbSelectedProgram) === String(programId)) await loadKbJamaahForProgram(programId);
        if (adminSubTab === 'pembayaran') await renderPembayaranPanel();

        if (gagalCount > 0) {
            showToast(`Harga program berubah — ${suksesCount} status jamaah disesuaikan, TAPI ${gagalCount} gagal disinkronkan (sesi login mungkin kedaluwarsa) — refresh & cek ulang`, 'error');
        } else {
            showToast(`Harga program berubah — status bayar ${updates.length} jamaah disesuaikan otomatis`);
        }
    } catch (err) {
        console.warn('Sync status jamaah per-program gagal (non-fatal):', err);
    }
}

// ============================================================
// KELENGKAPAN DOKUMEN & TO-DO CS — kode utamanya dipindah ke modul lazy js/modules/dokumen.js
// ============================================================
// Bagian di bawah SENGAJA tetap di sini: dipanggil kode inti secara sinkron
// (tabel/badge/validasi) sehingga tidak boleh menunggu unduhan modul.


function isDokumenLengkap(dok, jamaah) {
    if (!dok) return false;
    return dokumenJenisUntukJamaah(jamaah).every(d => d.type === 'copy'
        ? !!(dok[d.key + '_fc'] || dok[d.key + '_asli'])
        : !!dok[d.key]);
}
// ============================================================
// STATUS KEPULANGAN & TANDA TERIMA DOKUMEN — kode utamanya dipindah ke modul lazy js/modules/kepulangan.js
// ============================================================
// Bagian di bawah SENGAJA tetap di sini: dipanggil kode inti secara sinkron
// (tabel/badge/validasi) sehingga tidak boleh menunggu unduhan modul.


const KEPULANGAN_STATUS_OPSI = [
    { value: 'belum_berangkat', label: 'Belum Berangkat', badge: 'batal' },
    { value: 'sudah_berangkat', label: 'Sudah Berangkat', badge: 'limited' },
    { value: 'sudah_pulang',    label: 'Sudah Pulang',    badge: 'available' },
    { value: 'batal',           label: 'Batal / No-show', badge: 'full' },
];

function kepulanganStatusInfo(value) {
    return KEPULANGAN_STATUS_OPSI.find(s => s.value === value) || KEPULANGAN_STATUS_OPSI[0];
}

// Status kepulangan program (rombongan) dari cache dataUmroh. Fallback ke
// 'belum_berangkat' kalau kolomnya belum ada (program lama / cache lama).
function statusKepulanganProgram(programId) {
    const p = (dataUmroh || []).find(pr => String(pr.id) === String(programId));
    return (p && p.status_kepulangan) || 'belum_berangkat';
}

// Tanggal berangkat/pulang aktual program (rombongan) dari cache dataUmroh.
// field: 'tgl_berangkat_aktual' | 'tgl_pulang_aktual'.
function tglKepulanganProgram(programId, field) {
    const p = (dataUmroh || []).find(pr => String(pr.id) === String(programId));
    return (p && p[field]) || '';
}

// Status kepulangan seorang jamaah = status program-nya (tidak ada override
// per jamaah lagi -- satu rombongan berangkat & pulang bersamaan).
function efektifStatusKepulangan(jamaah) {
    if (!jamaah) return 'belum_berangkat';
    return statusKepulanganProgram(jamaah.program_id);
}

// Tanggal kepulangan seorang jamaah = tanggal program-nya (tidak ada
// override per jamaah lagi). field: 'tgl_berangkat_aktual' | 'tgl_pulang_aktual'.
function efektifTglKepulangan(jamaah, field) {
    if (!jamaah) return '';
    return tglKepulanganProgram(jamaah.program_id, field);
}
// ============================================================
// MANIFEST JAMAAH & EXPORT EXCEL — kode utamanya dipindah ke modul lazy js/modules/manifest.js
// ============================================================
// ============================================================
// ROOMING LIST — kode utamanya dipindah ke modul lazy js/modules/rooming.js
// ============================================================
// ============================================================
// 20. KUITANSI — sejak digabung ke alur "Bayar" (lihat buildNotaHTML() dan
// downloadNotaPembayaran() di bagian "19C/19D. NOTA PEMBAYARAN / AUDIT
// NOTA"), tidak ada lagi tombol/modal Kuitansi manual terpisah. Fungsi di
// bawah ini yang masih tersisa:
//  - fetchNextKuitansiNomorValue(): dipakai downloadNotaPembayaran() untuk
//    mengambil nomor kuitansi otomatis (RPC next_kuitansi_nomor(), lihat
//    sql/22_tambah_nomor_kuitansi_otomatis.sql).
//  - buildKuitansiHTML(): DIPERTAHANKAN hanya untuk merekonstruksi preview
//    baris log Audit Nota lama (jenis 'kuitansi' yang dulu dibuat dari modal
//    manual, sebelum digabung) — lihat previewNotaFromAudit().
// ============================================================
async function fetchNextKuitansiNomorValue() {
    try {
        const { data, error } = await supabaseClient.rpc('next_kuitansi_nomor');
        if (error) throw error;
        return data || `AHI/KWT/${new Date().getFullYear()}/${Date.now().toString().slice(-6)} (sementara)`;
    } catch (err) {
        console.warn('Gagal mengambil nomor kuitansi otomatis (migrasi belum dijalankan?):', err);
        // Fallback sementara berbasis waktu supaya nota tetap bisa diunduh
        // walau migrasi sql/22_tambah_nomor_kuitansi_otomatis.sql belum jalan —
        // ditandai jelas "(sementara)" supaya tidak disalahartikan sebagai
        // nomor resmi tersistem.
        showToast('Nomor kuitansi otomatis gagal dibuat dari server, pakai nomor sementara. Jalankan migrasi sql/22_tambah_nomor_kuitansi_otomatis.sql', 'error');
        return `AHI/KWT/${new Date().getFullYear()}/${Date.now().toString().slice(-6)} (sementara)`;
    }
}

// ============================================================
// CROSSCHECK (OCR poster vs data) — kode utamanya dipindah ke modul lazy js/modules/crosscheck.js
// ============================================================
// Bagian di bawah SENGAJA tetap di sini: dipanggil kode inti secara sinkron
// (tabel/badge/validasi) sehingga tidak boleh menunggu unduhan modul.

// ============================================================
// 21A. CROSSCHECK MODULE (OCR poster vs data teks)
// ============================================================
const CX_OCR_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/scan-poster-ocr`;

// [AUTO-FILL] Mapping nama field OCR -> id input form admin. Dipakai bareng
// oleh autoScanPosterForProgram (isi otomatis + highlight) dan editAdminProgram
// (tampilkan ulang highlight kalau form dibuka sebelum field sempat disentuh).
const CX_AUTOFILL_FIELD_TO_INPUT = {
    nama: 'admin_nama', tgl: 'admin_tgl', durasi: 'admin_durasi', maskapai: 'admin_maskapai',
    harga_quint: 'admin_harga_quint', harga_quad: 'admin_harga_quad', harga_triple: 'admin_harga_triple',
    harga_double: 'admin_harga_double', hotel_makkah: 'admin_hotel_makkah', hotel_madinah: 'admin_hotel_madinah',
    hotel_3: 'admin_hotel_3', hotel_4: 'admin_hotel_4',
    // [CROSSCHECK] Fasilitas Termasuk/Tidak Termasuk/Catatan -- dibaca juga dari
    // poster (lihat EXTRACTION_PROMPT di scan-poster-ocr), bukan cuma dari parsing
    // teks broadcast, supaya bisa ikut dibandingkan & auto-fill kalau masih kosong.
    termasuk: 'admin_termasuk', tidak_termasuk: 'admin_tidak_termasuk', catatan_cx: 'admin_catatan_cx',
};

// Tandai field yang "belum dikonfirmasi" (baru terisi otomatis dari OCR
// poster, belum pernah disentuh admin) dengan highlight kuning + banner
// ringkas di atas form. Highlight per-field lepas otomatis begitu admin
// mengetik di situ (lihat listener 'input' delegasi di bawah); seluruhnya
// juga otomatis lepas begitu form disimpan, karena admin_data_lengkap
// dibangun ulang dari nol tiap saveAdminProgram (autofilled_fields lama ikut
// hilang, lalu autoScanPosterForProgram menandai ulang HANYA field yang
// masih kosong setelah save itu).
function cxApplyAutofillHighlight(fieldList) {
    (Array.isArray(fieldList) ? fieldList : []).forEach(field => {
        const inputId = CX_AUTOFILL_FIELD_TO_INPUT[field];
        const el = inputId && document.getElementById(inputId);
        if (el) el.classList.add('cx-autofill-pending');
    });
    cxRefreshAutofillBanner();
}

// Hapus semua highlight pending (dipanggil saat form ditutup/direset supaya
// tidak "nempel" ke sesi form berikutnya).
function cxClearAutofillHighlight() {
    Object.values(CX_AUTOFILL_FIELD_TO_INPUT).forEach(id => {
        document.getElementById(id)?.classList.remove('cx-autofill-pending');
    });
    cxRefreshAutofillBanner();
}

// Update banner ringkas "N field belum diperiksa" berdasarkan field mana yang
// MASIH bertanda kuning saat ini di layar.
function cxRefreshAutofillBanner() {
    const banner = document.getElementById('cxAutofillBanner');
    if (!banner) return;
    const stillPending = Object.values(CX_AUTOFILL_FIELD_TO_INPUT)
        .map(id => document.getElementById(id))
        .filter(el => el && el.classList.contains('cx-autofill-pending'));
    if (stillPending.length) {
        banner.style.display = 'block';
        banner.innerHTML = `<i class="bi bi-magic"></i> ${stillPending.length} field terisi otomatis dari poster (ditandai kuning) — periksa dulu sebelum disimpan.`;
    } else {
        banner.style.display = 'none';
        banner.innerHTML = '';
    }
}

// Begitu admin mengetik/memilih di field manapun yang sedang ditandai
// "pending", lepas highlight-nya — dianggap sudah diperiksa/disentuh admin.
document.addEventListener('input', function (e) {
    if (e.target?.classList?.contains('cx-autofill-pending')) {
        e.target.classList.remove('cx-autofill-pending');
        cxRefreshAutofillBanner();
    }
});

function cxNormalizeHarga(str) {
    if (!str) return '';
    return String(str).replace(/[^0-9]/g, '');
}
// --- TANGGAL: dukungan rentang & daftar tanggal terpisah (mis. poster
// "17-26 SEPTEMBER 2026" atau "4 & 11 OKTOBER 2026" vs data admin tanggal
// tunggal "17 September 2026" / "4 Oktober 2026") --------------------------
const CX_BULAN = {'januari':0,'februari':1,'maret':2,'april':3,'mei':4,'juni':5,'juli':6,'agustus':7,'september':8,'oktober':9,'november':10,'desember':11};
// Cari 1 tanggal tunggal "D Bulan YYYY" di dalam teks (dipakai untuk sisi
// yang bukan rentang/daftar). Beda dengan parseDateFromString() global
// karena di sini teksnya bisa berisi rentang/daftar di sekitarnya, jadi
// dicari via regex, bukan asumsi seluruh string persis "D Bulan YYYY".
function cxParseSingleTgl(str) {
    const s = String(str || '');
    const m = s.match(/(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})/);
    if (!m) return null;
    const bulan = CX_BULAN[m[2].toLowerCase()];
    if (bulan === undefined) return null;
    return new Date(parseInt(m[3], 10), bulan, parseInt(m[1], 10));
}
// Ubah 1 teks tanggal (bebas format -- tunggal, rentang, atau daftar
// terpisah) jadi representasi "kumpulan tanggal yang dimaksud":
//   { type: 'single', date: Date }        -> 1 tanggal spesifik
//   { type: 'list',   dates: Date[] }      -> beberapa tanggal spesifik yang
//                                             TIDAK berurutan/kontinu, mis.
//                                             "4 & 11 Oktober 2026",
//                                             "4, 11, 18 Oktober 2026",
//                                             "4 dan 11 Oktober 2026"
//   { type: 'range',  start: Date, end: Date } -> rentang tanggal kontinu,
//                                             mis. "17-26 SEPTEMBER 2026"
//                                             atau "28 September - 2 Oktober 2026"
//   null                                    -> tidak bisa di-parse sama sekali
// Fungsi ini sengaja generik (bukan daftar format tertutup) supaya format
// tanggal baru yang mirip pola di atas otomatis ikut tertangani ke depannya,
// tanpa perlu tambah kasus baru satu-satu.
function cxParseTglSet(str) {
    const s = String(str || '').trim();
    if (!s) return null;

    // 1) Daftar tanggal spesifik dalam 1 bulan yang sama, dipisah "&", ",",
    //    "/", "dan", atau "atau" -- mis. "4 & 11 OKTOBER 2026". Dicek LEBIH
    //    DULU daripada pola rentang supaya tidak salah dianggap rentang.
    const listMatch = s.match(/(\d{1,2}(?:\s*(?:,|&|\/|\bdan\b|\batau\b)\s*\d{1,2})+)\s+([a-zA-Z]+)\s+(\d{4})/i);
    if (listMatch) {
        const bulan = CX_BULAN[listMatch[2].toLowerCase()];
        if (bulan !== undefined) {
            const tahun = parseInt(listMatch[3], 10);
            const days = listMatch[1].split(/,|&|\/|dan|atau/i).map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n));
            if (days.length >= 2) return { type: 'list', dates: days.map(d => new Date(tahun, bulan, d)) };
        }
    }

    // 2) Rentang dalam 1 bulan yang sama, mis. "17-26 SEPTEMBER 2026".
    const sameMonth = s.match(/(\d{1,2})\s*-\s*(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})/);
    if (sameMonth) {
        const bulan = CX_BULAN[sameMonth[3].toLowerCase()];
        if (bulan !== undefined) {
            const tahun = parseInt(sameMonth[4], 10);
            return { type: 'range', start: new Date(tahun, bulan, parseInt(sameMonth[1], 10)), end: new Date(tahun, bulan, parseInt(sameMonth[2], 10)) };
        }
    }

    // 3) Rentang lintas bulan, mis. "28 September - 2 Oktober 2026".
    const crossMonth = s.match(/(\d{1,2})\s+([a-zA-Z]+)\s*-\s*(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})/);
    if (crossMonth) {
        const bulanAwal = CX_BULAN[crossMonth[2].toLowerCase()];
        const bulanAkhir = CX_BULAN[crossMonth[4].toLowerCase()];
        if (bulanAwal !== undefined && bulanAkhir !== undefined) {
            const tahun = parseInt(crossMonth[5], 10);
            return { type: 'range', start: new Date(tahun, bulanAwal, parseInt(crossMonth[1], 10)), end: new Date(tahun, bulanAkhir, parseInt(crossMonth[3], 10)) };
        }
    }

    // 4) Tanggal tunggal biasa, mis. "4 Oktober 2026".
    const single = cxParseSingleTgl(s);
    if (single) return { type: 'single', date: single };

    return null;
}
function cxSameDay(a, b) {
    return !!a && !!b && !isNaN(a) && !isNaN(b)
        && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
// Apakah tanggal `d` termasuk dalam kumpulan tanggal yang direpresentasikan `set`.
function cxSetContains(set, d) {
    if (!set || !d || isNaN(d)) return false;
    if (set.type === 'single') return cxSameDay(set.date, d);
    if (set.type === 'list') return set.dates.some(x => cxSameDay(x, d));
    if (set.type === 'range') return d.getTime() >= set.start.getTime() && d.getTime() <= set.end.getTime();
    return false;
}
// "Multi-value" = kumpulan yang mewakili LEBIH dari 1 kemungkinan tanggal
// (rentang beda hari, atau daftar >=2 tanggal) -- inilah yang memicu status
// "benar dengan peringatan", bukan "cocok" polos.
function cxIsMultiValue(set) {
    if (!set) return false;
    if (set.type === 'list') return set.dates.length >= 2;
    if (set.type === 'range') return set.start.getTime() !== set.end.getTime();
    return false;
}
// Bandingkan field tanggal teks vs poster, hasilnya salah satu dari:
//  'match'   - sama persis (baik secara teks, maupun sama-sama tanggal
//              tunggal yang jatuh di hari yang sama) -> hijau, "Cocok"
//  'warning' - salah satu sisi mewakili LEBIH dari 1 kemungkinan tanggal
//              (rentang seperti "17-26 September" ATAU daftar terpisah
//              seperti "4 & 11 Oktober"), dan tanggal di sisi lain termasuk
//              di dalamnya -> kuning, dianggap BENAR (tidak dihitung sebagai
//              mismatch) tapi tetap ditandai supaya staf sadar itu salah satu
//              dari beberapa opsi tanggal di poster, bukan tanggal tunggal
//              yang persis identik. Berlaku untuk format tanggal apa pun
//              yang bisa diuraikan cxParseTglSet(), bukan cuma pola tertentu.
//  'mismatch'- benar-benar tidak cocok -> merah
function cxCompareTgl(a, b) {
    if (!a || !b) return 'mismatch';
    const na = String(a).toLowerCase().trim().replace(/\s+/g, ' ');
    const nb = String(b).toLowerCase().trim().replace(/\s+/g, ' ');
    if (na === nb) return 'match';

    const setA = cxParseTglSet(a), setB = cxParseTglSet(b);
    if (!setA || !setB) return 'mismatch';

    if (cxIsMultiValue(setA) && setB.type === 'single' && cxSetContains(setA, setB.date)) return 'warning';
    if (cxIsMultiValue(setB) && setA.type === 'single' && cxSetContains(setB, setA.date)) return 'warning';
    // Kedua sisi sama-sama multi-value (mis. dua daftar/rentang beda format)
    // tapi ada tanggal yang beririsan -> tetap dianggap benar dgn peringatan.
    // [BUGFIX] Sebelumnya cuma dicek 1 arah (titik representatif sisi B vs
    // set A) -- kalau sisi A yang berupa daftar tanggal terpisah (list, mis.
    // "4 & 20 Oktober") dan sisi B rentang (range, mis. "17-26 Oktober"),
    // baris 17/26 (batas rentang B) dicek ke daftar A [4,20] -> tidak ketemu
    // -> salah dianggap 'mismatch' padahal tanggal 20 jelas ada di dalam
    // rentang 17-26. Sekarang dicek 2 arah (titik A ke set B, DAN titik B ke
    // set A) supaya urutan sisi (mana yang list / mana yang range) tidak
    // memengaruhi hasil.
    if (cxIsMultiValue(setA) && cxIsMultiValue(setB)) {
        const pointsOf = (set) => set.type === 'list' ? set.dates : [set.start, set.end];
        const overlap = pointsOf(setA).some(d => cxSetContains(setB, d)) || pointsOf(setB).some(d => cxSetContains(setA, d));
        if (overlap) return 'warning';
    }
    // Kedua sisi tanggal tunggal, teksnya beda tapi ternyata hari yang sama
    // (mis. beda format penulisan) -> tetap dianggap cocok penuh.
    if (setA.type === 'single' && setB.type === 'single' && cxSameDay(setA.date, setB.date)) return 'match';

    return 'mismatch';
}
function cxNormalizeMaskapai(str) {
    return String(str || '').toLowerCase().trim().replace(/\b(airlines?|airways|air)\b/gi, '').replace(/\s+/g, ' ').trim();
}
// Ambil "menit jalan kaki" dari teks hotel, mis. "500m 7 menit jalan kaki" -> "7"
function cxExtractWalkMinutes(str) {
    const m = String(str || '').match(/(\d+)\s*menit/i);
    return m ? m[1] : null;
}
// Saklar baris hint "Referensi Hotel Saudi Arabia — Teks: mirip ... / Poster: mirip ..."
// di panel Crosscheck. Dinonaktifkan (false). Ubah ke true untuk menyalakan lagi.
const CX_HOTEL_REF_HINT_ENABLED = false;

// Nama hotel di field manual sering lebih detail dari poster, mis.
//   Manual : "Maysan Al Maqam / Setaraf (6 malam, 500m 7 menit jalan kaki)"
//   Poster : "Maysan Al Maqam 7 menit"
// -> keduanya harus dianggap COCOK. Jadi sebelum dibandingkan, buang bagian
// "(...)" (durasi malam/jarak), bagian setelah "/" (nama hotel alternatif/setaraf),
// dan keterangan "X menit"/"X m" supaya tersisa nama hotel inti saja.
function cxNormalizeHotelName(str) {
    if (!str) return '';
    let s = String(str);
    s = s.replace(/\([^)]*\)/g, ' ');           // buang "(6 malam, 500m 7 menit jalan kaki)"
    s = s.split('/')[0];                         // buang "/ Setaraf" dst — ambil nama sebelum "/"
    s = s.replace(/\d+\s*menit\b/gi, ' ');        // buang "7 menit"
    s = s.replace(/\d+\s*m\b/gi, ' ');            // buang "500m"
    s = s.replace(/jalan\s*kaki/gi, ' ');
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
// Cocok kalau nama hotel intinya sama (salah satu bisa jadi ringkasan dari yang
// lain, jadi dicek saling contains, bukan exact) DAN, kalau kedua sisi sama-sama
// mencantumkan estimasi menit jalan kaki, angkanya harus sama. Kalau cuma salah
// satu sisi yang mencantumkan menit (mis. poster tidak menyebut jarak sama sekali),
// itu tidak dianggap mismatch — poster memang sering lebih ringkas dari data admin.
function cxHotelValuesMatch(a, b) {
    const na = cxNormalizeHotelName(a), nb = cxNormalizeHotelName(b);
    if (!na || !nb) return false;
    const nameMatch = na === nb || na.includes(nb) || nb.includes(na);
    if (!nameMatch) return false;
    const ma = cxExtractWalkMinutes(a), mb = cxExtractWalkMinutes(b);
    if (ma && mb && ma !== mb) return false;
    return true;
}
// [CROSSCHECK] Pecah textarea "satu item per baris" (admin_termasuk/tidak_termasuk,
// juga dipakai untuk versi poster yang sudah digabung jadi bentuk sama di
// autoScanPosterForProgram) jadi array item bersih, huruf kecil, untuk dibandingkan.
function cxNormalizeListItems(str) {
    return String(str || '').split('\n').map(s => s.trim().toLowerCase()).filter(Boolean);
}
function cxListItemContains(hay, item) {
    // Poster sering menulis fasilitas lebih ringkas ATAU lebih detail dari teks
    // admin -- jadi dicek saling contains, bukan harus sama persis satu baris.
    return hay.some(h => h.includes(item) || item.includes(h));
}
// Cocok kalau SETIAP item di sisi poster ketemu (fuzzy) di sisi teks. Teks admin
// boleh lebih lengkap dari poster (poster sering meringkas daftar fasilitas),
// tapi kalau poster menyebut sesuatu yang sama sekali tidak ada di teks, itu
// tanda datanya beda (mis. fasilitas tambahan yang belum diinput admin).
function cxListItemsMatch(plainStr, posterStr) {
    const plainItems = cxNormalizeListItems(plainStr);
    const posterItems = cxNormalizeListItems(posterStr);
    if (!plainItems.length || !posterItems.length) return false;
    return posterItems.every(item => cxListItemContains(plainItems, item));
}
// Ambil angka pertama dari teks durasi, mis. "9 Hari 7 Malam" -> "9",
// "9H/7M" -> "9", "9 HARI" -> "9". Dipakai cxValuesMatch('durasi', ...).
function cxNormalizeDurasi(str) {
    const m = String(str || '').match(/\d+/);
    return m ? m[0] : '';
}
// Pecah teks bebas jadi daftar kata (huruf/angka), tanda baca umum (koma,
// strip, garis miring, kurung, titik) diubah jadi spasi dulu supaya
// "dolar-riyal" ikut kehitung sebagai 2 kata terpisah "dolar" & "riyal" --
// dipakai cxTextSimilarity() untuk membandingkan 2 kalimat bebas.
function cxTextWords(str) {
    return String(str || '').toLowerCase().replace(/[.,\-\/()]/g, ' ').split(/\s+/).filter(Boolean);
}
// Skor kemiripan 2 teks bebas (0..1) = rasio Jaccard dari kata unik yang
// beririsan dibagi total kata unik gabungan keduanya. Dipakai utk mentolerir
// kalimat yang ditulis ulang beda susunan/kata tapi intinya sama (mis.
// Catatan/Disclaimer poster yang sering dirangkai ulang oleh admin/desainer),
// beda dengan pengecekan containment biasa yang butuh salah satu jadi
// substring persis dari yang lain.
function cxTextSimilarity(a, b) {
    const wa = new Set(cxTextWords(a));
    const wb = new Set(cxTextWords(b));
    if (!wa.size || !wb.size) return 0;
    let common = 0;
    wa.forEach(w => { if (wb.has(w)) common++; });
    const union = wa.size + wb.size - common;
    return union ? common / union : 0;
}
const CX_CATATAN_SIMILARITY_THRESHOLD = 0.5; // >=50% kata unik sama -> intinya dianggap sama
function cxValuesMatch(field, a, b) {
    if (!a || !b) return false;
    // [GAP-FIX] Sebelumnya 'nama' & 'durasi' jatuh ke fallback default di bawah
    // (harus sama persis huruf-demi-huruf setelah lowercase+trim), beda dengan
    // field lain (maskapai/hotel/termasuk/catatan_cx) yang semuanya sudah
    // fuzzy/normalized. Padahal nama program & format durasi di poster hampir
    // selalu ditulis beda dari data admin (mis. poster cuma "UMROH RAMADHAN"
    // sementara data teks "Umroh Ramadhan 9 Hari 7 Malam", atau durasi poster
    // "9H/7M" vs teks "9 Hari 7 Malam") -- akibatnya field ini nyaris SELALU
    // ditandai "Beda" (mismatch) walau sebenarnya cocok, bikin panel Crosscheck
    // & badge "Verified" jadi kebanyakan noise/false-positive.
    if (field === 'nama') {
        const na = String(a).toLowerCase().trim().replace(/\s+/g, ' ');
        const nb = String(b).toLowerCase().trim().replace(/\s+/g, ' ');
        return na === nb || na.includes(nb) || nb.includes(na);
    }
    if (field === 'durasi') {
        const na = cxNormalizeDurasi(a), nb = cxNormalizeDurasi(b);
        return na !== '' && na === nb;
    }
    if (field === 'tgl') {
        // 'warning' (tanggal tunggal termasuk dalam rentang poster) dianggap
        // BENAR di sini -- tidak dihitung sebagai mismatch/error. Tampilan
        // kuning "peringatan"-nya ditangani terpisah di buildCompareRows().
        return cxCompareTgl(a, b) !== 'mismatch';
    }
    if (field && field.indexOf('harga') === 0) {
        const na = cxNormalizeHarga(a), nb = cxNormalizeHarga(b);
        return na !== '' && na === nb;
    }
    if (field === 'maskapai') {
        const na = cxNormalizeMaskapai(a), nb = cxNormalizeMaskapai(b);
        if (!na || !nb) return false;
        return na === nb || na.includes(nb) || nb.includes(na);
    }
    if (field === 'hotel_makkah' || field === 'hotel_madinah' || field === 'hotel_3' || field === 'hotel_4') {
        return cxHotelValuesMatch(a, b);
    }
    if (field === 'termasuk' || field === 'tidak_termasuk') {
        return cxListItemsMatch(a, b);
    }
    if (field === 'catatan_cx') {
        // Disclaimer biasanya boilerplate -- boleh beda sedikit kata/potongan,
        // jadi dicek containment juga (poster kadang menyingkat kalimatnya).
        const na = String(a).toLowerCase().trim().replace(/\s+/g, ' ');
        const nb = String(b).toLowerCase().trim().replace(/\s+/g, ' ');
        if (na === nb || na.includes(nb) || nb.includes(na)) return true;
        // [GAP-FIX] Disclaimer sering ditulis ulang beda kalimat/urutan tapi
        // intinya sama (mis. teks "...serta kenaikan kurs dolar dan riyal"
        // vs poster "...Hotel dan kurs dolar-riyal yang berlaku" -- sama-sama
        // soal kurs berubah, cuma dirangkai beda) -- exact/containment saja
        // kena tandai "Beda" padahal maksudnya sama. Toleransi tambahan:
        // kalau kata-kata inti di kedua sisi cukup banyak yang sama (skor
        // kemiripan Jaccard), dianggap cocok juga.
        return cxTextSimilarity(a, b) >= CX_CATATAN_SIMILARITY_THRESHOLD;
    }
    return a.toLowerCase().trim() === b.toLowerCase().trim();
}

// [REFACTOR] Logika inti hitung mismatch dipisah dari lookup by-id supaya bisa
// dipakai langsung dengan objek program apa saja (adminPrograms ATAU dataUmroh
// yang dipakai tabel publik "Program Umroh" di tampilan depan). Sebelumnya
// cxCountMismatch selalu mencari ke adminPrograms, yang KOSONG selama admin
// belum login — akibatnya badge verified di tampilan depan tidak pernah bisa
// dihitung dengan benar kalau dipaksa lewat cxCountMismatch(id).
function cxCountMismatchForProgram(prog) {
    if (!prog) return 0;
    const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
    const pd = adl.poster_data || {};
    // [BUGFIX] Data lama menyimpan harga Quad di kolom `harga_quint` (lihat
    // komentar "Data lama: harga_quint sebenarnya dipakai sebagai harga Quad"
    // di editAdminProgram() & sql/10_tambah_tipe_kamar_jamaah.sql). Konvensi ini
    // sudah dipakai konsisten di >8 tempat lain di file ini (mis. baris 461,
    // 1795, 3605 -- semua pakai `harga_quad || harga_quint`), TAPI modul
    // Crosscheck sebelumnya membandingkan `harga_quint` & `harga_quad` sebagai
    // 2 field independen tanpa fallback ini. Akibatnya utk program lama yang
    // belum pernah diisi `harga_quad` (admin_data_lengkap), harga Quad asli
    // (yang nyasar tersimpan di kolom harga_quint) TIDAK PERNAH dibandingkan ke
    // hasil OCR poster sama sekali (field harga_quad-nya selalu kosong di sisi
    // teks), sementara field "Harga Quint" yang tampil malah membandingkan
    // nilai itu ke pd.harga_quint (field beda, biasanya kosong di poster).
    const legacyQuintIsQuad = !adl.harga_quad && !!prog.harga_quint;
    const pairs = [
        ['nama', prog.nama, pd.nama], ['tgl', prog.tgl, pd.tgl], ['durasi', prog.durasi, pd.durasi], ['maskapai', prog.maskapai, pd.maskapai],
        ['harga_quint', legacyQuintIsQuad ? null : prog.harga_quint, pd.harga_quint],
        ['harga_quad', adl.harga_quad || prog.harga_quint, pd.harga_quad], ['harga_triple', adl.harga_triple, pd.harga_triple],
        ['harga_double', adl.harga_double, pd.harga_double], ['hotel_makkah', adl.hotel_makkah, pd.hotel_makkah], ['hotel_madinah', adl.hotel_madinah, pd.hotel_madinah],
        ['hotel_3', adl.hotel_3, pd.hotel_3], ['hotel_4', adl.hotel_4, pd.hotel_4],
        ['termasuk', adl.termasuk, pd.termasuk], ['tidak_termasuk', adl.tidak_termasuk, pd.tidak_termasuk], ['catatan_cx', adl.catatan_cx, pd.catatan_cx],
    ];
    return pairs.filter(([field, a, b]) => a && b && !cxValuesMatch(field, a, b)).length;
}

// Hitung status crosscheck 1 program: dipakai bareng oleh stats bar & pill
// selector (admin) DAN badge "Verified" di tabel publik Program Umroh
// (tampilan depan). Menerima objek program langsung (bukan id) supaya jalan
// baik untuk item dari adminPrograms maupun dataUmroh.
// Program dianggap expired di modul Crosscheck kalau Tanggal Berangkat-nya
// (field `tgl` pada baris adminPrograms) sudah lewat hari ini. Modul
// Crosscheck sengaja tidak menampilkan program yang sudah expired (beda
// dengan tabel admin Program yang tetap menampilkannya dengan badge
// "Expired" untuk keperluan arsip/riwayat).
function cxIsProgramExpired(p) {
    if (!p || !p.tgl) return false;
    const d = parseDateFromString(p.tgl);
    return !!(d && d < new Date());
}

function cxGetProgramStatus(p) {
    const adl = (() => { try { return p.admin_data_lengkap ? (typeof p.admin_data_lengkap === 'string' ? JSON.parse(p.admin_data_lengkap) : p.admin_data_lengkap) : null; } catch(e) { return null; } })();
    const hasData = !!(adl && Object.keys(adl).length > 0);
    const hasPoster = !!(p && p.link_poster);
    const mismatchCount = adl && adl.poster_data ? cxCountMismatchForProgram(p) : 0;
    // priority: 0 = ada yang tidak cocok (paling urgent), 1 = belum ada data lengkap, 2 = aman
    const priority = mismatchCount > 0 ? 0 : (!hasData ? 1 : 2);
    return { adl, hasData, hasPoster, mismatchCount, priority };
}

// Program dianggap "Verified" (lulus OCR) kalau: sudah pernah di-scan OCR poster
// (ada poster_data hasil OCR), DAN semua field yang dibandingkan (nama, tanggal,
// durasi, maskapai, harga, hotel) antara teks plain vs hasil OCR poster cocok
// semua (tidak ada mismatch). Dipakai buildProgramRowHTML utk badge di tampilan depan.
function cxIsProgramVerified(p) {
    const adl = (() => { try { return p && p.admin_data_lengkap ? (typeof p.admin_data_lengkap === 'string' ? JSON.parse(p.admin_data_lengkap) : p.admin_data_lengkap) : null; } catch(e) { return null; } })();
    if (!adl || !adl.poster_data) return false; // belum pernah discan OCR
    return cxCountMismatchForProgram(p) === 0;
}
// ============================================================
// 21. FEATURED PROGRAMS
// ============================================================
async function loadFeaturedIds() {
    try {
        const res = await withRetry(
            () => fetch(`${SUPABASE_URL}/rest/v1/featured_programs?select=program_id`, {
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
            }),
            { label: 'Muat program unggulan' }
        );
        featuredIds = res.ok ? (await res.json()).map(r => String(r.program_id)) : [];
    } catch (err) {
        console.error('loadFeaturedIds error:', err);
        featuredIds = [];
    }
}

function renderFeaturedSection() {
    const tbody = document.getElementById('featuredTableBody');
    if (!tbody) return;

    const now = new Date();
    // Catatan: sengaja TIDAK ikut pakai isProgramVisibleOnDashboard() di sini
    // supaya perilaku lama (program expired tetap bisa tampil di tab
    // Unggulan) tidak berubah -- cuma nambah syarat wajib punya poster.
    const featuredPrograms = dataUmroh.filter(p => featuredIds.includes(String(p.id)) && p.is_active !== false && !!p.link_poster);

    if (!featuredPrograms.length) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--ink-soft);">
            <i class="bi bi-star-fill" style="font-size:24px;display:block;margin-bottom:10px;"></i>
            Belum ada program unggulan. Kelola melalui Admin Panel.
        </td></tr>`;
        return;
    }

    const nearestIds = getNearestDepartureIds(3);
    tbody.innerHTML = featuredPrograms.map(item => buildProgramRowHTML(item, now, nearestIds)).join('');
}

function isFeatured(id) { return featuredIds.includes(String(id)); }

async function toggleFeatured(id) {
    id = String(id);
    if (isFeatured(id)) {
        const { error } = await supabaseClient.from('featured_programs').delete().eq('program_id', id);
        if (error) { showToast('❌ Gagal menghapus: ' + error.message, 'error'); return; }
        featuredIds = featuredIds.filter(i => i !== id);
        showToast('⭐ Program dihapus dari unggulan');
    } else {
        // Tidak ada batas maksimal lagi — semua program bisa dijadikan unggulan.
        const { error } = await supabaseClient.from('featured_programs').insert([{ program_id: id }]);
        if (error) { showToast('❌ Gagal menambah: ' + error.message, 'error'); return; }
        featuredIds.push(id);
        showToast('⭐ Program ditambahkan ke unggulan!');
    }
    renderFeaturedSection();
    renderFeaturedAdminTable();
}

function renderFeaturedAdminTable() {
    const tbody = document.getElementById('featuredAdminTableBody');
    if (!tbody) return;
    if (!adminPrograms.length) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--ink-soft);">Belum ada program.</td></tr>';
        return;
    }
    // Urutkan berdasarkan tanggal berangkat terdekat di atas (program tanpa
    // tanggal valid ditaruh paling bawah), supaya tidak bergantung ke urutan
    // adminPrograms dari tempat lain.
    const sorted = [...adminPrograms].sort((a, b) => {
        const da = a.tgl ? parseDateFromString(a.tgl) : null;
        const db = b.tgl ? parseDateFromString(b.tgl) : null;
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da - db;
    });
    tbody.innerHTML = sorted.map(p => {
        const featured = isFeatured(p.id);
        const btnLabel = featured ? 'Tampil di Unggulan' : '☆ Jadikan Unggulan';
        const btnClass = featured ? 'featured-toggle-btn on' : 'featured-toggle-btn off';
        return `<tr>
            <td><strong>${escapeHtml(p.nama || '-')}</strong></td>
            <td>${escapeHtml(p.tgl || '-')}</td>
            <td style="text-align:right;">
                <button class="${btnClass}" onclick="toggleFeatured('${p.id}'); renderFeaturedAdminTable();">
                    ${btnLabel}
                </button>
            </td>
        </tr>`;
    }).join('');
}

// ============================================================
// TELEGRAM — kode utamanya dipindah ke modul lazy js/modules/telegram.js
// ============================================================
// Bagian di bawah SENGAJA tetap di sini: dipanggil kode inti secara sinkron
// (tabel/badge/validasi) sehingga tidak boleh menunggu unduhan modul.


function formatTgProgram(data, isEdit = false) {
    const icon = isEdit ? '✏️' : '🆕';
    const action = isEdit ? 'diperbarui' : 'ditambahkan';
    return `${icon} <b>Program Umroh ${action}!</b>

🕌 <b>${escapeHtml(data.nama||'-')}</b>
📅 Berangkat: ${escapeHtml(data.tgl||'-')}
⏳ Durasi: ${escapeHtml(data.durasi||'-')}
✈️ Maskapai: ${escapeHtml(data.maskapai||'-')}
💰 Harga: ${escapeHtml(data.harga_quint||'-')}

📌 <i>${escapeHtml(NOTA_PERUSAHAAN.nama)}</i>
🕐 ${new Date().toLocaleString('id-ID')}`;
}

function formatTgJadwal(entry, isEdit = false) {
    const icon = isEdit ? '✏️' : '📅';
    const action = isEdit ? 'diperbarui' : 'baru';
    const tglFormatted = entry.tgl
        ? new Date(entry.tgl).toLocaleDateString('id-ID', {weekday:'long',day:'numeric',month:'long',year:'numeric'})
        : '-';
    return `${icon} <b>Jadwal Tamu ${action}!</b>

👤 <b>${escapeHtml(entry.nama||'-')}</b>
🏠 Asal: ${escapeHtml(entry.asal||'-')}
📅 Tanggal: ${tglFormatted}
🕐 Jam: ${escapeHtml(entry.jam||'belum ditentukan')}
👥 Jumlah: ${entry.jumlah ? entry.jumlah + ' orang' : '-'}
💼 Keperluan: ${escapeHtml(entry.keperluan||'-')}${entry.catatan ? '\n📝 Catatan: '+escapeHtml(entry.catatan) : ''}

📌 <i>${escapeHtml(NOTA_PERUSAHAAN.nama)}</i>`;
}
// ============================================================
// 21b. ASSETS (CRUD) — kodenya dipindah ke modul lazy js/modules/assets.js
// (loadAssets, renderAssetsAdminTable, openAssetModal, saveAsset, ...)
// ============================================================

// escapeHtml tapi aman dipakai di dalam atribut href="..." (escape tanda kutip ganda juga)
function escapeHtmlAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
}

// ============================================================
// 21c. HOTEL SAUDI ARABIA (read-only) — sub-tab di dalam menu Assets,
// referensi data hotel hasil import sekali dari CSV (booking_saudi_arabia.csv).
// Tidak ada tambah/edit/hapus lewat UI -- kalau perlu diperbarui, import
// ulang lewat SQL Editor (lihat sql/37_tambah_hotel_saudi_arabia.sql &
// sql/39_import_hotel_saudi_arabia.sql).
//
// Data yang sama juga dipakai sebagai REFERENSI (bukan cuma ditampilkan di
// sub-tab-nya sendiri) di dua tempat lain:
//   - Form Tambah/Edit Program (field Hotel Makkah/Madinah) & Parse
//     Broadcast -> kasih hint kalau nama hotel yang diketik/di-parse mirip
//     atau tidak dikenali dibanding data referensi (lihat handleHotelRefInput).
//   - Panel Crosscheck (poster vs data teks) -> kasih badge "dikenali di
//     referensi" / "tidak dikenali" di baris Hotel Makkah & Madinah (lihat
//     cxHotelRefBadge, dipanggil dari buildCompareRows).
// ============================================================

// ---- Fuzzy match nama hotel vs tabel referensi (dice coefficient bigram) ----
// Dipakai bareng oleh hint form Program & badge Crosscheck. Tidak butuh
// library luar -- cukup ringan buat ~300 kandidat (Makkah+Madinah).

let hotelRefLoadPromise = null;
// Muat data referensi di background (idempotent -- aman dipanggil berkali-kali
// dari tempat berbeda). Dipakai supaya form Program & panel Crosscheck bisa
// langsung kasih hint begitu admin buka form, tanpa harus mampir dulu ke
// menu Assets > Hotel Saudi Arabia.
function ensureHotelReferenceLoaded() {
    if (hotelSaudiLoaded) return Promise.resolve();
    if (!hotelRefLoadPromise) {
        hotelRefLoadPromise = loadHotelSaudiArabia().finally(() => { hotelRefLoadPromise = null; });
    }
    return hotelRefLoadPromise;
}

// ============================================================
// PUSTAKA DETAIL HOTEL (tabel hotel_detail, sql/54_tambah_hotel_detail.sql)
// ------------------------------------------------------------
// Jarak & estimasi menit jalan kaki ("550m 7 menit jalan kaki") diingat per
// nama hotel. Efeknya:
//  1) Tiap program disimpan -> detail hotel di form (Makkah/Madinah/Hotel 3/4)
//     otomatis disimpan/diperbarui ke pustaka (saveHotelDetailsFromForm).
//  2) Isi Otomatis / Parse AI: kalau broadcast tidak menyebut jarak, jarak
//     diambil dari pustaka (lookupHotelDetailJarak, dipakai combineHotel).
//  3) Mengetik nama hotel yang sudah pernah dipakai di form -> muncul tombol
//     saran "Pakai detail tersimpan" (refreshHotelDetailSuggest).
// Jumlah malam sengaja TIDAK disimpan (beda tiap program).
// Kalau tabelnya belum dibuat di Supabase, fitur ini diam-diam non-aktif.
// ============================================================
let hotelDetailMap = {}, hotelDetailLoaded = false, hotelDetailLoadPromise = null;

function hotelDetailKey(name) {
    return String(name || '')
        .replace(/\([^)]*\)/g, ' ')                       // buang "(4 malam, ...)"
        .split('/')[0]                                    // buang "/ setaraf"
        .toLowerCase()
        .replace(/\b[1-5]\s*(\*+|bintang)|\bbintang\s*[1-5]\b|\*+/g, ' ') // buang "5*", "bintang 5"
        .replace(/[^a-z0-9\u0600-\u06FF\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// "Hilton Suites (4 malam, 550m 7 menit jalan kaki)" ->
//   { name: "Hilton Suites", malam: "4", jarak: "550m 7 menit jalan kaki" }
// Bagian kurung yang bukan "X malam" dan memuat jarak (m/km) atau "menit" dianggap detail jarak.
function parseHotelDetailText(str) {
    const text = String(str || '').trim();
    const m = text.match(/\(([^)]*)\)/);
    const name = text.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!m) return { name, malam: '', jarak: '', hasParen: false };
    const parts = m[1].split(',').map(x => x.trim()).filter(Boolean);
    let malam = '';
    const jarakParts = [];
    parts.forEach(p => {
        const mm = p.match(/(\d+)\s*malam/i);
        if (mm) { malam = mm[1]; return; }
        if (/\d/.test(p) && (/\b\d+(?:[.,]\d+)?\s*(m|meter|km)\b/i.test(p) || /menit/i.test(p))) jarakParts.push(p);
    });
    return { name, malam, jarak: jarakParts.join(', '), hasParen: true };
}

function loadHotelDetails() {
    return supabaseClient.from('hotel_detail').select('hotel_key,hotel_name,kota,jarak_text')
        .then(({ data, error }) => {
            if (error) throw error;
            hotelDetailMap = {};
            (data || []).forEach(r => { if (r.hotel_key && r.jarak_text) hotelDetailMap[r.hotel_key] = r; });
        })
        .catch(err => { console.warn('Pustaka detail hotel tidak termuat (tabel hotel_detail sudah dibuat?):', err && err.message); })
        .finally(() => { hotelDetailLoaded = true; });
}
function ensureHotelDetailsLoaded() {
    if (hotelDetailLoaded) return Promise.resolve();
    if (!hotelDetailLoadPromise) hotelDetailLoadPromise = loadHotelDetails().finally(() => { hotelDetailLoadPromise = null; });
    return hotelDetailLoadPromise;
}

// Jarak tersimpan untuk nama hotel (sinkron; '' kalau belum ada / belum termuat).
function lookupHotelDetailJarak(name) {
    const key = hotelDetailKey(name);
    return (key && hotelDetailMap[key] && hotelDetailMap[key].jarak_text) || '';
}

// Simpan/perbarui detail jarak semua hotel di form program ke pustaka.
// Dipanggil setelah program berhasil disimpan; tidak pernah memblokir/menggagalkan simpan.
async function saveHotelDetailsFromForm(formData) {
    try {
        const slots = [
            ['hotel_makkah', 'makkah'], ['hotel_madinah', 'madinah'],
            ['hotel_3', String(formData.hotel_3_kota || '').toLowerCase()],
            ['hotel_4', String(formData.hotel_4_kota || '').toLowerCase()]
        ];
        const rows = [];
        slots.forEach(([field, kota]) => {
            const d = parseHotelDetailText(formData[field]);
            const key = hotelDetailKey(d.name);
            if (!key || !d.jarak) return;
            const existing = hotelDetailMap[key];
            if (existing && existing.jarak_text === d.jarak) return; // sudah sama, tidak perlu tulis
            rows.push({ hotel_key: key, hotel_name: d.name, kota: kota || null, jarak_text: d.jarak, updated_at: new Date().toISOString() });
        });
        if (!rows.length) return;
        const uniq = Object.values(rows.reduce((acc, r) => { acc[r.hotel_key] = r; return acc; }, {}));
        const { error } = await supabaseClient.from('hotel_detail').upsert(uniq, { onConflict: 'hotel_key' });
        if (error) throw error;
        uniq.forEach(r => { hotelDetailMap[r.hotel_key] = r; });
    } catch (err) {
        console.warn('Gagal menyimpan detail hotel:', err && err.message);
    }
}

// Tombol saran di bawah field hotel: "Pakai detail tersimpan: 550m 7 menit jalan kaki".
const HOTEL_DETAIL_INPUT_IDS = ['admin_hotel_makkah', 'admin_hotel_madinah', 'admin_hotel_3', 'admin_hotel_4'];
function refreshHotelDetailSuggest(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const group = input.closest('.form-group');
    if (!group) return;
    let box = document.getElementById('hotelDetailSuggest_' + inputId);
    if (!box) {
        box = document.createElement('div');
        box.id = 'hotelDetailSuggest_' + inputId;
        box.className = 'hotel-detail-suggest';
        group.appendChild(box);
    }
    const d = parseHotelDetailText(input.value);
    const saved = d.name && !d.jarak ? lookupHotelDetailJarak(d.name) : '';
    if (!saved) { box.innerHTML = ''; box.style.display = 'none'; return; }
    box.style.display = 'flex';
    box.innerHTML = `<button type="button" class="hotel-detail-btn" onclick="applyHotelDetailSuggest('${inputId}')"><i class="bi bi-stars"></i> Pakai detail tersimpan: <b>${escapeHtml(saved)}</b></button><span class="hotel-detail-note">jumlah malam isi sendiri</span>`;
}
function applyHotelDetailSuggest(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const d = parseHotelDetailText(input.value);
    const saved = lookupHotelDetailJarak(d.name);
    if (!saved) return;
    const detail = [d.malam ? d.malam + ' malam' : '', saved].filter(Boolean).join(', ');
    input.value = `${d.name} (${detail})`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    refreshHotelDetailSuggest(inputId);
}
let _hotelDetailSuggestTimers = {};
document.addEventListener('input', function (e) {
    const id = e.target && e.target.id;
    if (!id || !HOTEL_DETAIL_INPUT_IDS.includes(id)) return;
    clearTimeout(_hotelDetailSuggestTimers[id]);
    _hotelDetailSuggestTimers[id] = setTimeout(() => { ensureHotelDetailsLoaded().then(() => refreshHotelDetailSuggest(id)); }, 400);
});

// Buang "(3 malam, 200m jalan kaki)" dkk dari string gabungan hasil
// combineHotel() di parseBroadcastText, supaya yang dicocokkan cuma nama
// hotel murni.
function stripHotelExtras(s) {
    return (s || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeHotelNameForMatch(s) {
    return stripHotelExtras(s)
        .toLowerCase()
        .replace(/[^a-z0-9\u0600-\u06FF\s]/g, ' ') // buang tanda baca, sisakan huruf/angka (termasuk Arab)
        .replace(/\s+/g, ' ')
        .trim();
}

function bigramSet(s) {
    const set = new Map();
    for (let i = 0; i < s.length - 1; i++) {
        const bg = s.substring(i, i + 2);
        set.set(bg, (set.get(bg) || 0) + 1);
    }
    return set;
}

// Dice coefficient berbasis bigram karakter -- cukup toleran terhadap typo
// ringan & urutan kata yang beda, tanpa perlu library tambahan.
function diceSimilarity(a, b) {
    const na = normalizeHotelNameForMatch(a), nb = normalizeHotelNameForMatch(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const ba = bigramSet(na), bb = bigramSet(nb);
    let intersect = 0;
    ba.forEach((count, bg) => { if (bb.has(bg)) intersect += Math.min(count, bb.get(bg)); });
    const totalA = [...ba.values()].reduce((s, c) => s + c, 0);
    const totalB = [...bb.values()].reduce((s, c) => s + c, 0);
    if (totalA + totalB === 0) return 0;
    return (2 * intersect) / (totalA + totalB);
}

// Cari hotel referensi paling mirip di kota tertentu ('makkah'/'madinah',
// cocok substring ke kolom city di hotel_saudi_arabia yang isinya lowercase).
function findBestHotelMatch(name, cityKeyword) {
    const clean = stripHotelExtras(name);
    if (!clean || !hotelSaudiLoaded || !hotelSaudiList.length) return null;
    const candidates = hotelSaudiList.filter(h => (h.city || '').toLowerCase().includes(cityKeyword));
    let best = null, bestScore = 0;
    candidates.forEach(h => {
        const score = diceSimilarity(clean, h.hotel_name || '');
        if (score > bestScore) { bestScore = score; best = h; }
    });
    return best ? { hotel: best, score: bestScore } : null;
}

const HOTEL_REF_MATCH_THRESHOLD = 0.72; // dianggap "cocok"
const HOTEL_REF_SUGGEST_THRESHOLD = 0.4; // dianggap "mirip, mungkin typo"

// Dipanggil dari oninput field Hotel Makkah/Madinah di form Program, DAN
// dari parseBroadcastText() setelah field terisi otomatis dari broadcast WA.
let hotelRefHintDebounce = {};
function handleHotelRefInput(inputId, hintId, cityKeyword) {
    clearTimeout(hotelRefHintDebounce[inputId]);
    hotelRefHintDebounce[inputId] = setTimeout(() => updateHotelRefHint(inputId, hintId, cityKeyword), 350);
}

function updateHotelRefHint(inputId, hintId, cityKeyword) {
    const input = document.getElementById(inputId);
    const hintEl = document.getElementById(hintId);
    if (!input || !hintEl) return;
    const val = input.value.trim();
    if (!val) { hintEl.className = 'hotel-ref-hint'; hintEl.innerHTML = ''; return; }

    if (!hotelSaudiLoaded) {
        hintEl.className = 'hotel-ref-hint loading';
        hintEl.innerHTML = '<i class="bi bi-arrow-repeat bi-spin"></i> Memeriksa data referensi...';
        ensureHotelReferenceLoaded().then(() => updateHotelRefHint(inputId, hintId, cityKeyword));
        return;
    }
    if (!hotelSaudiList.length) { hintEl.className = 'hotel-ref-hint'; hintEl.innerHTML = ''; return; }

    const match = findBestHotelMatch(val, cityKeyword);
    if (!match || match.score < HOTEL_REF_SUGGEST_THRESHOLD) {
        hintEl.className = 'hotel-ref-hint unknown';
        hintEl.innerHTML = `<i class="bi bi-question-circle-fill"></i> Tidak ditemukan di data referensi — cek ejaan, atau memang hotel baru`;
    } else if (match.score < HOTEL_REF_MATCH_THRESHOLD) {
        hintEl.className = 'hotel-ref-hint suggest';
        hintEl.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> Mirip: <b>${escapeHtml(match.hotel.hotel_name)}</b> — cek lagi ejaannya, mungkin typo`;
    } else {
        const scoreTxt = match.hotel.score != null ? ` &middot; skor ${escapeHtml(String(match.hotel.score))}` : '';
        hintEl.className = 'hotel-ref-hint ok';
        hintEl.innerHTML = `<i class="bi bi-check-circle-fill"></i> Cocok dengan data referensi${scoreTxt}`;
    }
}

// Tab internal menu "Pengaturan User" (Tambah User / Akses Menu / Daftar
// User) -- sama pola dengan switchAssetsInnerTab, dipisah jadi tab supaya
// tidak perlu scroll panjang buat 3 blok konten sekaligus.
function switchUsInnerTab(tab) {
    document.querySelectorAll('#adminSubTab-usersettings .assets-inner-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.innerTab === tab));
    const panels = { adduser: 'usPanel-adduser', access: 'usPanel-access', list: 'usPanel-list' };
    Object.entries(panels).forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = (key === tab) ? 'block' : 'none';
    });
}

function switchAssetsInnerTab(tab) {
    document.querySelectorAll('.assets-inner-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.innerTab === tab));
    const linksPanel = document.getElementById('assetsLinksPanel');
    const hotelPanel = document.getElementById('assetsHotelPanel');
    if (linksPanel) linksPanel.style.display = tab === 'links' ? 'block' : 'none';
    if (hotelPanel) hotelPanel.style.display = tab === 'hotels' ? 'block' : 'none';

    if (tab === 'hotels') {
        const wrap = document.getElementById('hotelSaudiWrap');
        // renderHotelSaudiTable() & kawan-kawan ada di modul lazy 'assets': tampilkan spinner selama modul diunduh.
        if (hotelSaudiLoaded && wrap && !wrap.firstElementChild) wrap.innerHTML = `<div class="pf-empty"><i class="bi bi-arrow-repeat bi-spin"></i>Memuat data hotel...</div>`;
        if (!hotelSaudiLoaded) {
            if (wrap) wrap.innerHTML = `<div class="pf-empty"><i class="bi bi-arrow-repeat bi-spin"></i>Memuat data hotel...</div>`;
            loadHotelSaudiArabia().then(() => {
                populateHotelSaudiCityFilter();
                renderHotelSaudiTable();
            });
        } else {
            renderHotelSaudiTable();
        }
    }
}

async function loadHotelSaudiArabia() {
    try {
        const { data, error } = await supabaseClient.from('hotel_saudi_arabia').select('*').order('score', { ascending: false, nullsFirst: false });
        if (error) throw error;
        hotelSaudiList = data || [];
        hotelSaudiLoaded = true;
    } catch (err) {
        console.error('Load hotel_saudi_arabia error:', err);
        hotelSaudiList = [];
        hotelSaudiLoaded = false;
        showToast('Gagal memuat data Hotel Saudi Arabia — periksa koneksi internet', 'error');
    }
}

// UI sub-tab Hotel Saudi Arabia (tabel, cari/filter, ekspor & impor CSV) dipindah ke js/modules/assets.js.
// Yang tetap di atas: loader referensi + mesin pencocokan + pustaka detail hotel (dipakai sinkron form Program & parser).


// ============================================================
// 21b. SAMBUTAN USER DI HEADER
// ============================================================
// Sebelumnya judul topbar menampilkan lokasi + cuaca perangkat (lewat browser
// geolocation + Open-Meteo). Sekarang diganti sambutan dinamis & profesional
// untuk user yang sedang login -- menyesuaikan jam (Selamat Pagi/Siang/Sore/
// Malam), nama user (dari dashboard_profiles.label, sudah tersimpan di
// sessionStorage saat login -- lihat checkAdminLogin()), dan satu kalimat
// penyemangat singkat yang berganti-ganti tiap render supaya tidak monoton.
// Kalau belum ada yang login, tampil sambutan umum ke nama brand perusahaan.
const HEADER_WELCOME_PHRASES = [
    'Semoga hari ini penuh capaian.',
    'Selamat bekerja, sukses selalu menyertai.',
    'Selamat menjalankan tugas hari ini.',
    'Mari mulai hari dengan semangat terbaik.',
    'Semoga lancar dan berkah sepanjang hari.',
    'Selamat produktif hari ini.',
];

function getHeaderGreetingWord(hour) {
    if (hour >= 4 && hour < 11) return 'Selamat Pagi';
    if (hour >= 11 && hour < 15) return 'Selamat Siang';
    if (hour >= 15 && hour < 18) return 'Selamat Sore';
    return 'Selamat Malam';
}

// Dipanggil saat halaman dimuat (setelah checkSession() memulihkan status
// login), dan diulang lagi setiap kali status login berubah (login/logout)
// supaya sambutan di header selalu sesuai user yang aktif tanpa perlu reload.
function renderHeaderWelcome() {
    const el = document.getElementById('topbarLocationWeather');
    if (!el) return;
    const greeting = getHeaderGreetingWord(new Date().getHours());
    let label = '';
    try { label = adminLoggedIn ? (sessionStorage.getItem('admin_login_label') || '') : ''; } catch (_) { label = ''; }
    const phrase = HEADER_WELCOME_PHRASES[Math.floor(Math.random() * HEADER_WELCOME_PHRASES.length)];
    if (label) {
        el.textContent = `${greeting}, ${label} — ${phrase}`;
    } else {
        const brand = (typeof NOTA_PERUSAHAAN !== 'undefined' && NOTA_PERUSAHAAN?.brand) ? NOTA_PERUSAHAAN.brand : 'Amiru Tour';
        el.textContent = `${greeting} — Selamat datang di ${brand}`;
    }
}
window.renderHeaderWelcome = renderHeaderWelcome;

// ============================================================
// 22. INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    // Skeleton rows
    const skeletonBody = document.getElementById('skeletonBody');
    skeletonBody.innerHTML = Array(5).fill(0).map(() => `
        <tr class="skeleton-row">
            <td><div class="skeleton skeleton-text" style="width:70%;"></div></td>
            <td><div class="skeleton skeleton-text" style="width:50%;"></div></td>
            <td><div class="skeleton skeleton-text" style="width:40%;"></div></td>
            <td><div class="skeleton skeleton-text" style="width:30%;"></div></td>
            <td><div class="skeleton skeleton-text" style="width:50%;"></div></td>
            <td><div class="skeleton skeleton-text" style="width:60%;"></div></td>
            <td><div class="skeleton skeleton-text" style="width:40%;"></div></td>
        </tr>
    `).join('');

    // [OPTIMASI LOAD] Sebelumnya 8 request awal ini di-await SATU-SATU secara
    // berurutan (total waktu tunggu = jumlah semua latensinya). Padahal
    // masing-masing baca tabel/endpoint yang berbeda dan tidak saling
    // bergantung satu sama lain (checkSession() cuma sinkronisasi status
    // login versi app dari sessionStorage -- JWT Supabase Auth-nya sendiri
    // sudah dipulihkan otomatis oleh client saat script dimuat, jadi request
    // lain tidak perlu menunggu checkSession() selesai dulu). Sekarang
    // dijalankan PARALEL per kelompok (Promise.all) -- hasil & urutan render
    // akhirnya sama persis, cuma total waktu tunggu jadi jauh lebih singkat
    // (mendekati request paling lambat, bukan jumlah semuanya).
    await Promise.all([
        loadCompanyProfile(),
        loadUserRoles(),
        checkSession() // pulihkan status login (kalau ada) sebelum render tabel utama
    ]);
    applyRoleUIVisibility();
    renderSidebarNav();
    await Promise.all([
        loadFeaturedIds(),
        loadJadwal(),
        loadPendaftaran(),
        loadKbJamaah(),
        loadDataFromSupabase()
    ]);

    // Render sections
    renderJadwalSection();
    renderPendaftaranSection();
    renderKbProgramSelector();
    renderFeaturedSection();
    // [OPTIMASI DATA] Data IG (post, rencana konten + 4 probe kolom + rencana tahunan,
    // tasklist, akun) dulu dimuat tiap kali aplikasi dibuka walau halaman IG tidak dipakai.
    // Semua variabel itu hanya dibaca di dalam halaman IG, jadi sekarang dimuat saat
    // openIgSchedulerPage() dipanggil (termasuk lewat restoreLastView setelah F5).
    // Kalender IG dirender oleh modul lazy IG Scheduler saat halamannya dibuka.

    // Bind sort listeners on table headers (nama, tgl, maskapai, isAvailable)
    document.querySelectorAll('th.sortable').forEach(th => {
        const key = th.getAttribute('data-sort');
        if (key) th.onclick = () => sortTable(key);
    });

    // Cek & kirim pengingat Telegram untuk program yang berangkat ≤30 hari lagi (1x/hari)
    setTimeout(() => checkAndSendReminders(), 2000);

    // Render sambutan user di header (menggantikan info lokasi & cuaca lama)
    renderHeaderWelcome();

    // Pulihkan halaman/tab/subtab terakhir yang dibuka (lihat 4c) -- dipanggil
    // paling akhir, setelah data awal & status login siap, supaya F5 tidak
    // selalu dilempar balik ke Dashboard (tab Program Umroh).
    await restoreLastView();
});

// ============================================================
// 23. CLOSE MODALS ON OVERLAY CLICK
// ============================================================
document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', function(e) {
        if (e.target !== this) return;
        // Modal IG punya state tambahan (upload sementara, tanggal harian) yang harus ikut dibersihkan
        if (this.id === 'igUploadModal' && typeof closeIgUploadModal === 'function') closeIgUploadModal();
        else if (this.id === 'igDayModal' && typeof closeIgDayModal === 'function') closeIgDayModal();
        else this.classList.remove('open');
    });
});

// ============================================================
// 24. POSTER HOVER POPUP
// ============================================================
// [REFRESH POSTER] ver = programs.poster_version (timestamp ms terakhir tombol "Refresh Poster"
// ditekan). Ditempel sebagai &v=... supaya browser tidak memakai gambar lama dari cache
// saat file di Google Drive diganti dengan link yang sama.
function resolveImageUrl(url, ver) {
    if (!url) return url;
    let out = url;
    // Google Drive: /file/d/ID/view atau /file/d/ID/view?usp=...
    const gdMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    // Google Drive: open?id=ID
    const gdOpen = url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
    const gdId = gdMatch ? gdMatch[1] : (gdOpen ? gdOpen[1] : null);
    if (gdId) out = `https://drive.google.com/thumbnail?id=${gdId}&sz=w1080`;
    if (ver) out += (out.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(ver);
    return out;
}

let _posterHideTimer = null;
function showPosterPopup(e, el) {
    clearTimeout(_posterHideTimer);
    const popup = document.getElementById('posterPopup');
    const img = document.getElementById('posterPopupImg');
    const loading = document.getElementById('posterPopupLoading');
    const errEl = document.getElementById('posterPopupError');
    const nameEl = document.getElementById('posterPopupName');
    if (!popup || !img || !loading || !errEl || !nameEl) return;
    const posterUrl = resolveImageUrl(el.getAttribute('data-poster'), el.getAttribute('data-poster-v'));
    const posterNama = el.getAttribute('data-nama');
    // Reset state
    img.classList.remove('loaded');
    img.src = '';
    loading.style.display = 'flex';
    errEl.style.display = 'none';
    nameEl.textContent = posterNama || 'Poster Program';
    // Hitung ukuran popup: rasio 1080:1350, fit ke viewport dengan margin
    const RATIO = 1080 / 1350;
    const gap = 16, margin = 12, labelH = 36;
    const vw = window.innerWidth, vh = window.innerHeight;
    const maxH = vh - margin * 2 - labelH;
    const maxW = Math.min(vw * 0.85, 1080);
    let ph, pw;
    if (maxW / RATIO + labelH <= vh - margin * 2) {
        pw = maxW; ph = Math.round(pw / RATIO);
    } else {
        ph = maxH; pw = Math.round(ph * RATIO);
    }
    // Terapkan ukuran ke elemen
    const inner = popup.querySelector('.poster-popup-inner');
    const wrap = popup.querySelector('.poster-popup-img-wrap');
    inner.style.width = pw + 'px';
    wrap.style.width = pw + 'px';
    wrap.style.height = ph + 'px';
    // Posisi: kanan kursor, geser kiri jika terpotong
    let x = e.clientX + gap;
    let y = e.clientY - Math.round(ph / 3);
    if (x + pw > vw - margin) x = e.clientX - pw - gap;
    if (x < margin) x = margin;
    if (y + ph + labelH > vh - margin) y = vh - ph - labelH - margin;
    if (y < margin) y = margin;
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
    popup.classList.add('visible');
    img.onload = () => { loading.style.display = 'none'; img.classList.add('loaded'); };
    img.onerror = () => { loading.style.display = 'none'; errEl.style.display = 'flex'; };
    img.src = posterUrl;
}
function hidePosterPopup() {
    _posterHideTimer = setTimeout(() => {
        const popup = document.getElementById('posterPopup');
        popup && popup.classList.remove('visible');
    }, 120);
}
window.showPosterPopup = showPosterPopup;
window.hidePosterPopup = hidePosterPopup;

// ============================================================
// 24. INSTAGRAM CONTENT SCHEDULER — modul lazy (js/modules/ig-scheduler.js)
// ============================================================
// Isi halaman IG Scheduler (~5.900 baris: kalender, upload, komentar, Content Planner,
// Rencana Konten, Tasklist, Rencana Setahun, Pola 7 Hari) dipecah ke file sendiri dan baru
// diunduh saat halaman IG dibuka pertama kali. Di app.js hanya tersisa:
//   1. konstanta IG yang dipakai kode inti (Microblog, System Status),
//   2. loader ensureModuleLoaded(),
//   3. stub untuk fungsi IG yang dipanggil dari index.html sebelum modul sempat dimuat.
// Tambah fungsi IG baru yang dipanggil dari index.html? Daftarkan namanya di array `api` di bawah.

const IG_CAPTION_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/generate-ig-caption`;
// false = fitur auto-upload ke IG & sinkron komentar DISEMBUNYIKAN sementara (kode &
// edge function tetap ada, tinggal ubah jadi true untuk mengaktifkan lagi). Selama
// false, post disimpan sebagai 'draft' supaya cron ig-publish (hanya memproses
// status 'scheduled') tidak menerbitkan apa pun.
const IG_AUTOPUBLISH_ENABLED = false;
const IG_PILLARS = {
    storytelling: { label: 'Storytelling',     color: '#d35400' },
    edukasi:    { label: 'Edukasi',            color: '#2b7de9' },
    promo:      { label: 'Promo Program',      color: '#e0457b' },
    testimoni:  { label: 'Testimoni',          color: '#1f9d6b' },
    manasik:    { label: 'Info Manasik',       color: '#b9770e' },
    engagement: { label: 'Engagement',         color: '#8e44ad' },
    behind:     { label: 'Behind the Scenes',  color: '#16899a' },
    kontemplasi: { label: 'Kontemplasi',       color: '#5b6abf' }
};

const LAZY_MODULES = {
    'ig-scheduler': {
        src: 'js/modules/ig-scheduler.min.js',
        // Fungsi yang dirujuk index.html (onclick / data-action). Stub meneruskan panggilan
        // setelah modul termuat; modul lalu menimpa stub dengan fungsi aslinya.
        api: [
            'closeIgAboutPlannerModal', 'closeIgActionModal', 'closeIgContentPlanModal',
            'closeIgDayModal', 'closeIgRencanaKontenModal', 'closeIgTaskModal',
            'closeIgUploadModal', 'filterIgCommentsPanel', 'generateIgCaptionAI',
            'generateIgContentPlanAI', 'igAboutPlannerMeta', 'igAddPostFromDayModal',
            'igApplyPolaMingguan', 'igDayNav', 'igDayNavToday', 'igGotoToday', 'igNewIdea',
            'igNextMonth', 'igOnTemaMingguInput', 'igPickQuickTipe', 'igPrevMonth',
            'igQuickAddPlan', 'igRefreshAll', 'igRefreshPlanPreview', 'igRenderPetaTema',
            'igRenderPlanWeekOptions', 'igRkIniHari', 'igRkRender', 'igRtRenderPanel',
            'igRtStatus', 'igRtSusunAI', 'igRtTogglePanel', 'igSalinAboutPlanner',
            'igSalinPromptPlan', 'igSalinRencanaKonten', 'igSetCalFilter', 'igUnduhAboutPlanner',
            'igUnduhRencanaKonten', 'igUnduhRencanaKontenPdf', 'onIgCarouselFilesChange',
            'onIgMediaChange', 'onIgMediaTypeChange', 'openIgAboutPlannerModal',
            'openIgContentPlanModal', 'openIgRencanaKontenModal', 'openIgUploadModal',
            'saveIgPost', 'showIgPlanGenerateForm', 'syncIgCommentsNow', 'undoIgCaptionAI'
        ]
    },
    'crosscheck': {
        src: 'js/modules/crosscheck.min.js',
        api: [
            'autoScanPosterForProgram', 'renderCxPanel', 'renderCxProgramSelector'
        ]
    },
    'dokumen': {
        src: 'js/modules/dokumen.min.js',
        api: [
            'renderDokProgramSelector', 'renderTodoCsPanel', 'selectDokProgram'
        ]
    },
    'kepulangan': {
        src: 'js/modules/kepulangan.min.js',
        deps: ['nota'],
        api: [
            'bukaTandaTerimaDokumen', 'renderKepulanganProgramSelector', 'selectKepulanganProgram',
            'tutupTandaTerimaModal', 'unduhTandaTerimaDokumen'
        ]
    },
    'manifest': {
        src: 'js/modules/manifest.min.js',
        deps: ['nota'],
        api: [
            'bukaManifestProgram', 'exportJamaahExcel', 'exportPembayaranExcel', 'tutupManifestModal',
            'unduhManifest'
        ]
    },
    'rooming': {
        src: 'js/modules/rooming.min.js',
        deps: ['nota'],
        api: [
            'autoBagiKamar', 'bukaRoomingList', 'filterRoomingList', 'simpanRoomingList',
            'tutupRoomingModal', 'unduhRoomingList'
        ]
    },
    'pengaturan-user': {
        src: 'js/modules/pengaturan-user.min.js',
        api: [
            'closeResetPasswordModal', 'createNewUser', 'loadUserList', 'populateUmaUserSelect',
            'renderRoleMenuAccessMatrix', 'renderUserMenuAccessMatrix', 'resetUserMenuAccessMatrix',
            'saveRoleMenuAccessMatrix', 'saveUserMenuAccessMatrix', 'submitResetPassword',
            'switchUsAccessMode', 'usGeneratePassword', 'usPickRole', 'usSetListFilter'
        ]
    },
    'assets': {
        src: 'js/modules/assets.min.js',
        api: [
            'closeAssetModal', 'closeHotelImportModal', 'confirmHotelImport', 'exportHotelSaudiCsv',
            'handleHotelImportFile', 'handleHotelSaudiSearchInput', 'loadAssets', 'openAssetModal',
            'populateHotelSaudiCityFilter', 'renderAssetsAdminTable', 'renderHotelSaudiTable', 'saveAsset'
        ]
    },
    'nota': {
        src: 'js/modules/nota.min.js',
        api: ['confirmDownloadNotaPreview', 'previewNotaPembayaran', 'previewNotaRiwayatLengkap']
    },
    'pembayaran': {
        src: 'js/modules/pembayaran.min.js',
        api: ['filterPbProgramComboOptions', 'generatePaymentReminderWA', 'handlePbSearchInput', 'renderPembayaranPanel', 'renderPembayaranTable', 'togglePbProgramCombo']
    },
    'audit-nota': {
        src: 'js/modules/audit-nota.min.js',
        deps: ['nota'],
        api: ['anSetJenis', 'handleAuditNotaSearchInput', 'loadNotaAuditLog', 'loadNotaAuditStats']
    },
    'telegram': {
        src: 'js/modules/telegram.min.js',
        api: [
            'addTgRecipient', 'checkAndSendReminders', 'getTgConfig', 'renderTgRecipients', 'saveTgConfig',
            'sendTelegramNotif', 'testTgNotif', 'testTgReminderAI'
        ]
    }
};
const _lazyModulePromises = {};

// Versi (?v=hash) tiap modul ditempel scripts/stamp-versions.mjs ke <script id="moduleVersions"> di index.html.
function getModuleVersion(key) {
    try {
        const el = document.getElementById('moduleVersions');
        return (el && JSON.parse(el.textContent)[key]) || '';
    } catch (_) { return ''; }
}

// Aman dipanggil berkali-kali: unduh cuma sekali; gagal (mis. offline) -> boleh dicoba lagi.
function ensureModuleLoaded(key) {
    const def = LAZY_MODULES[key];
    if (!def) return Promise.reject(new Error('Modul tidak dikenal: ' + key));
    if (!_lazyModulePromises[key]) {
        const v = getModuleVersion(key);
        // deps: modul lain yang HARUS sudah termuat sebelum skrip ini dieksekusi (dipakai sinkron di tingkat-atas/template).
        const deps = Promise.all((def.deps || []).map(ensureModuleLoaded));
        _lazyModulePromises[key] = deps.then(() => loadScriptOnce(def.src + (v ? '?v=' + v : ''))).catch(err => {
            _lazyModulePromises[key] = null;
            throw err;
        });
    }
    return _lazyModulePromises[key];
}

function _makeLazyStub(key, name) {
    const stub = function (...args) {
        return ensureModuleLoaded(key).then(() => {
            const real = window[name];
            if (typeof real !== 'function' || real === stub) {
                throw new Error('Modul ' + key + ' sudah dimuat tetapi tidak mendefinisikan ' + name + '()');
            }
            return real.apply(this, args);
        }).catch(err => {
            console.error('Modul ' + key + ':', err);
            showToast('Gagal memuat modul ' + key + '. Periksa koneksi lalu coba lagi.', 'error');
        });
    };
    return stub;
}
Object.keys(LAZY_MODULES).forEach(key => {
    LAZY_MODULES[key].api.forEach(name => {
        if (typeof window[name] !== 'function') window[name] = _makeLazyStub(key, name);
    });
});



// Membungkus <select class="searchable-select"> dengan UI kustom (bisa dicari)
// tanpa mengubah cara select tsb dipakai di tempat lain: .value masih bisa
// dibaca/ditulis seperti biasa, dan innerHTML options masih bisa diisi ulang
// (dropdown akan otomatis sinkron lewat MutationObserver).
(function () {
    let openWrapper = null;

    function closeAllPanels() {
        if (openWrapper) {
            openWrapper.classList.remove('open');
            openWrapper = null;
        }
    }
    document.addEventListener('mousedown', (e) => {
        if (openWrapper && !openWrapper.contains(e.target)) closeAllPanels();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllPanels();
    });

    function highlightMatch(text, query) {
        if (!query) return escapeHtml(text);
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return escapeHtml(text);
        return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + query.length)) + '</mark>' + escapeHtml(text.slice(idx + query.length));
    }

    function enhanceSearchableSelect(selectEl) {
        if (!selectEl || selectEl.dataset.csEnhanced) return;
        selectEl.dataset.csEnhanced = '1';
        selectEl.classList.add('cs-native-select');
        selectEl.setAttribute('tabindex', '-1');
        selectEl.setAttribute('aria-hidden', 'true');

        const wrapper = document.createElement('div');
        wrapper.className = 'cs-select-wrapper' + (selectEl.dataset.csInline === '1' ? ' cs-inline' : '');
        selectEl.parentNode.insertBefore(wrapper, selectEl);
        wrapper.appendChild(selectEl);

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'cs-select-trigger';
        trigger.innerHTML = '<span class="cs-select-value"></span><i class="bi bi-chevron-down cs-select-caret"></i>';
        wrapper.appendChild(trigger);

        const panel = document.createElement('div');
        panel.className = 'cs-select-panel';
        const searchPlaceholder = selectEl.getAttribute('data-search-placeholder') || 'Cari paket umroh...';
        panel.innerHTML =
            '<div class="cs-select-search-wrap"><i class="bi bi-search"></i>' +
            '<input type="text" class="cs-select-search" placeholder="' + escapeHtml(searchPlaceholder) + '" autocomplete="off"></div>' +
            '<div class="cs-select-options"></div>';
        wrapper.appendChild(panel);

        const searchInput = panel.querySelector('.cs-select-search');
        const optionsWrap = panel.querySelector('.cs-select-options');
        const valueLabel = trigger.querySelector('.cs-select-value');

        function updateLabel() {
            const opt = selectEl.options[selectEl.selectedIndex];
            const placeholder = selectEl.getAttribute('data-placeholder') || 'Pilih program...';
            if (opt && opt.value !== '') {
                valueLabel.textContent = opt.textContent;
                valueLabel.classList.remove('cs-placeholder');
            } else {
                valueLabel.textContent = (opt && opt.textContent) || placeholder;
                valueLabel.classList.add('cs-placeholder');
            }
        }

        function renderOptions(query) {
            const q = (query || '').trim().toLowerCase();
            const opts = Array.from(selectEl.options);
            optionsWrap.innerHTML = '';
            let anyVisible = false;
            opts.forEach((opt) => {
                const text = opt.textContent || '';
                if (q && !text.toLowerCase().includes(q)) return;
                anyVisible = true;
                const item = document.createElement('div');
                item.className = 'cs-select-option' +
                    (opt.value === selectEl.value ? ' selected' : '') +
                    (opt.disabled ? ' disabled' : '');
                item.innerHTML = highlightMatch(text, q);
                if (!opt.disabled) {
                    item.addEventListener('click', () => {
                        if (selectEl.value !== opt.value) {
                            selectEl.value = opt.value;
                            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                        closeAllPanels();
                    });
                }
                optionsWrap.appendChild(item);
            });
            if (!anyVisible) {
                optionsWrap.innerHTML = '<div class="cs-select-empty"><i class="bi bi-search" style="margin-right:6px;"></i>Paket tidak ditemukan</div>';
            }
        }

        function openPanel() {
            if (selectEl.disabled) return;
            closeAllPanels();
            wrapper.classList.add('open');
            openWrapper = wrapper;
            searchInput.value = '';
            renderOptions('');
            setTimeout(() => searchInput.focus(), 0);
        }

        trigger.addEventListener('click', () => {
            if (wrapper.classList.contains('open')) closeAllPanels();
            else openPanel();
        });
        searchInput.addEventListener('input', () => renderOptions(searchInput.value));
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { closeAllPanels(); trigger.focus(); }
        });

        // Sinkron ulang saat options di-generate ulang lewat innerHTML (mis. setelah data dimuat)
        new MutationObserver(() => {
            updateLabel();
            if (wrapper.classList.contains('open')) renderOptions(searchInput.value);
        }).observe(selectEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

        // Intercept `.value = ...` (dipakai di banyak tempat di app.js) supaya label ikut update
        const nativeDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        Object.defineProperty(selectEl, 'value', {
            configurable: true,
            get() { return nativeDesc.get.call(selectEl); },
            set(v) { nativeDesc.set.call(selectEl, v); updateLabel(); }
        });

        // Field required: tampilkan panel & fokus pencarian alih-alih bubble native yang salah posisi
        selectEl.addEventListener('invalid', (e) => {
            e.preventDefault();
            trigger.classList.add('cs-invalid');
            openPanel();
        });
        selectEl.addEventListener('change', () => trigger.classList.remove('cs-invalid'));

        updateLabel();
    }

    function scanAndEnhance() {
        document.querySelectorAll('select.searchable-select').forEach(enhanceSearchableSelect);
    }

    document.addEventListener('DOMContentLoaded', scanAndEnhance);
    // Beberapa select (mis. di dalam modal) baru muncul/berubah setelah interaksi user,
    // observer ini memastikan select baru tetap ikut diperkaya otomatis.
    new MutationObserver(scanAndEnhance).observe(document.documentElement, { childList: true, subtree: true });

    window.enhanceSearchableSelect = enhanceSearchableSelect;
})();

// ============================================================
// Tooltip kustom: menggantikan hint bawaan browser (atribut title).
// Cara kerja: saat kursor masuk ke elemen ber-title, teks dipindah ke
// data-tip (supaya hint native tidak muncul) lalu ditampilkan lewat
// satu elemen .amiru-tip yang dipakai ulang. Berlaku juga untuk elemen
// dinamis. Hanya aktif di perangkat bermouse; layar sentuh dilewati.
// Optimasi: satu elemen tooltip, listener pasif, tanpa polling terus-
// menerus, "warm start" (pindah antar tombol tanpa jeda ulang) dan
// transisi meluncur saat berpindah target.
// ============================================================
(function () {
    if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const GAP = 8, EDGE = 8;
    const DELAY = 280;        // jeda sebelum tooltip pertama muncul
    const WARM_MS = 600;      // setelah tooltip tampil, target berikutnya muncul tanpa jeda
    const LEAVE_GRACE = 90;   // toleransi saat melintasi celah antar tombol
    const SEL = '[title], [data-tip]';

    let tip = null, current = null, visible = false;
    let showTimer = 0, hideTimer = 0, lastShown = 0, mo = null;

    function ensureTip() {
        if (tip) return tip;
        tip = document.createElement('div');
        tip.className = 'amiru-tip';
        tip.setAttribute('role', 'tooltip');
        tip.id = 'amiruTip';
        document.body.appendChild(tip);
        return tip;
    }

    // Pindahkan title -> data-tip; kembalikan elemen kalau punya teks
    function prepare(el) {
        if (el.hasAttribute('title')) {
            const t = (el.getAttribute('title') || '').trim();
            el.removeAttribute('title');
            if (t) {
                el.setAttribute('data-tip', t);
                // Tombol ikon tanpa teks tetap punya nama untuk screen reader
                if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', t);
            }
        }
        return el.getAttribute('data-tip') ? el : null;
    }

    function place(el, glide) {
        const t = ensureTip();
        const r = el.getBoundingClientRect();
        const tw = t.offsetWidth, th = t.offsetHeight;
        const vw = document.documentElement.clientWidth, vh = window.innerHeight;
        const inSidebar = el.classList.contains('nav-item') && !!el.closest('nav, .sidebar');

        let pos = inSidebar ? 'right' : 'bottom';
        if (pos === 'right' && r.right + GAP + tw > vw - EDGE) pos = 'bottom';
        if (pos === 'bottom' && r.bottom + GAP + th > vh - EDGE) pos = 'top';
        if (pos === 'top' && r.top - GAP - th < EDGE) pos = 'bottom';

        let x, y;
        if (pos === 'right') { x = r.right + GAP; y = r.top + r.height / 2 - th / 2; }
        else {
            x = r.left + r.width / 2 - tw / 2;
            y = pos === 'bottom' ? r.bottom + GAP : r.top - GAP - th;
        }
        x = Math.max(EDGE, Math.min(x, vw - tw - EDGE));
        y = Math.max(EDGE, Math.min(y, vh - th - EDGE));

        t.classList.toggle('glide', !!glide);
        t.dataset.pos = pos;
        t.style.setProperty('--tip-shift', pos === 'top' ? '-4px' : pos === 'right' ? '0px' : '4px');
        t.style.setProperty('--arrow-x', Math.max(10, Math.min(tw - 10, r.left + r.width / 2 - x)) + 'px');
        t.style.setProperty('--arrow-y', Math.max(10, Math.min(th - 10, r.top + r.height / 2 - y)) + 'px');
        t.style.left = Math.round(x) + 'px';
        t.style.top = Math.round(y) + 'px';
    }

    // Awasi DOM hanya selama tooltip tampil: kalau target dilepas/disembunyikan, tutup.
    function watch() {
        if (mo || !window.MutationObserver) return;
        mo = new MutationObserver(() => {
            if (!current || !document.contains(current) || current.getClientRects().length === 0) hide(true);
        });
        mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    }
    function unwatch() { if (mo) { mo.disconnect(); mo = null; } }

    function show(el) {
        const t = ensureTip();
        const glide = visible;                       // sudah tampil -> meluncur ke target baru
        t.textContent = el.getAttribute('data-tip');
        place(el, glide);
        if (!visible) { visible = true; t.classList.add('show'); }
        el.setAttribute('aria-describedby', 'amiruTip');
        lastShown = Date.now();
        watch();
    }

    function hide(now) {
        clearTimeout(showTimer); clearTimeout(hideTimer);
        showTimer = hideTimer = 0;
        const el = current;
        current = null;
        if (el && el.getAttribute) el.removeAttribute('aria-describedby');
        if (!visible) return;
        const doHide = () => { visible = false; unwatch(); if (tip) tip.classList.remove('show', 'glide'); };
        if (now) doHide(); else hideTimer = setTimeout(doHide, LEAVE_GRACE);
    }

    function activate(el, instant) {
        clearTimeout(showTimer); clearTimeout(hideTimer);
        if (current && current !== el) current.removeAttribute('aria-describedby');
        current = el;
        const warm = visible || (Date.now() - lastShown < WARM_MS);
        if (instant || warm) show(el);
        else showTimer = setTimeout(() => { if (current === el) show(el); }, DELAY);
    }

    document.addEventListener('mouseover', (e) => {
        const raw = e.target && e.target.closest ? e.target.closest(SEL) : null;
        if (!raw) return;
        if (raw === current) { clearTimeout(hideTimer); hideTimer = 0; return; }
        const el = prepare(raw);
        if (el) activate(el, false);
    }, { capture: true, passive: true });

    document.addEventListener('mouseout', (e) => {
        if (!current) return;
        const to = e.relatedTarget;
        if (to && current.contains(to)) return;
        hide(false);
    }, { capture: true, passive: true });

    document.addEventListener('focusin', (e) => {
        const raw = e.target && e.target.closest ? e.target.closest(SEL) : null;
        if (!raw || !e.target.matches(':focus-visible')) return;
        const el = prepare(raw);
        if (el) activate(el, true);
    }, { capture: true, passive: true });

    const closeNow = () => { if (current || visible) hide(true); };
    document.addEventListener('focusout', closeNow, true);
    document.addEventListener('mousedown', closeNow, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNow(); }, true);
    document.addEventListener('visibilitychange', closeNow);
    document.documentElement.addEventListener('mouseleave', closeNow);
    window.addEventListener('scroll', closeNow, { capture: true, passive: true });
    window.addEventListener('resize', closeNow, { passive: true });
    window.addEventListener('blur', closeNow);
})();

console.log('🚀 Amiru Admin Dashboard loaded!');


// ============================================================
// STATUS LOADING TOMBOL SIMPAN/AKSI
// Membungkus fungsi simpan supaya tombolnya otomatis: aria-busy="true" +
// disabled + spinner (lihat css `button[aria-busy="true"]`), dan klik ganda
// saat koneksi lambat diabaikan sampai proses sebelumnya selesai.
// ============================================================
function _resolveBusyBtn(arg) {
    if (arg && typeof arg === 'object' && 'target' in arg) {
        if (arg.submitter) return arg.submitter;
        const t = arg.target;
        if (t && t.tagName === 'FORM') return t.querySelector('button[type="submit"], .btn-submit, .btn-submit-sm');
    }
    const a = document.activeElement;
    return a && a.tagName === 'BUTTON' ? a : null;
}

function withBusy(fn) {
    let inflight = false;
    return function (...args) {
        const ev = args[0];
        if (inflight) {
            if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
            return Promise.resolve(false);
        }
        inflight = true;
        const btn = _resolveBusyBtn(ev);
        const wasDisabled = btn ? btn.disabled : false;
        if (btn) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true; }
        const release = () => {
            inflight = false;
            if (btn) { btn.removeAttribute('aria-busy'); btn.disabled = wasDisabled; }
        };
        let result;
        try { result = fn.apply(this, args); }
        catch (err) { release(); throw err; }
        return Promise.resolve(result).finally(release);
    };
}

[
    'saveAdminProgram', 'saveJadwalTamu', 'savePendaftaran', 'saveKbJamaah',
    'saveCompanyProfile', 'saveCicilan',   // saveAsset, saveIgPost, saveCxPosterData, saveTgConfig, saveRoleMenuAccessMatrix, saveUserMenuAccessMatrix, submitResetPassword dibungkus di modulnya masing-masing
].forEach(name => {
    if (typeof window[name] === 'function') window[name] = withBusy(window[name]);
});


// ============================================================
// MONTH PICKER buatan sendiri: menggantikan panel kalender bawaan browser (tidak bisa di-style) pada
// input type="month" #igRkMulai ("Mulai dari") dan #igPlanMonth ("Bulan"). Input aslinya tetap dipakai sebagai
// penyimpan nilai "YYYY-MM" (disembunyikan), jadi seluruh kode lama (.value, onchange) jalan tanpa diubah:
// - mengisi .value lewat kode ikut memperbarui label (properti value pada elemen dibungkus)
// - memilih bulan di panel mengisi .value lalu memicu event "change"
// Keyboard: tombol dibuka dengan Enter/Spasi, panah menggeser bulan, PageUp/PageDown ganti tahun, Esc menutup panel saja.
// ============================================================
(function initMonthPicker() {
    const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const BULAN_S = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const PW = 268;
    let pop = null, cur = null;

    const parse = (v) => { const m = /^(\d{4})-(\d{2})$/.exec(v || ''); return m ? { y: +m[1], m: +m[2] - 1 } : null; };
    const key = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;

    function enhance(input) {
        if (!input || input.dataset.mp) return;
        input.dataset.mp = '1';
        const wrap = document.createElement('span');
        wrap.className = 'mp-wrap';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        input.classList.add('mp-native');
        input.tabIndex = -1;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mp-btn';
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = '<span class="mp-label"></span><i class="bi bi-calendar3" aria-hidden="true"></i>';
        wrap.appendChild(btn);
        const lab = input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
        const sync = () => {
            const p = parse(input.value);
            const teks = p ? `${BULAN[p.m]} ${p.y}` : 'Pilih bulan';
            btn.firstChild.textContent = teks;
            btn.setAttribute('aria-label', `${lab ? lab.textContent.trim() : 'Bulan'}: ${teks}. Tekan untuk mengganti bulan`);
        };
        const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        Object.defineProperty(input, 'value', { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); sync(); } });
        sync();
        btn.addEventListener('click', () => { if (cur && cur.input === input) close(); else open(input, btn); });
        if (lab) lab.addEventListener('click', (e) => { e.preventDefault(); btn.focus(); open(input, btn); });
    }

    function render() {
        const { year, focus, input } = cur;
        const sel = parse(input.value), now = new Date();
        pop.innerHTML =
            `<div class="mp-head"><button type="button" class="mp-nav" data-d="-1" tabindex="-1" aria-label="Tahun sebelumnya"><i class="bi bi-chevron-left"></i></button>` +
            `<strong class="mp-year">${year}</strong>` +
            `<button type="button" class="mp-nav" data-d="1" tabindex="-1" aria-label="Tahun berikutnya"><i class="bi bi-chevron-right"></i></button></div>` +
            `<div class="mp-grid" role="grid">` + BULAN_S.map((n, i) => {
                const cls = ['mp-m'];
                if (sel && sel.y === year && sel.m === i) cls.push('is-sel');
                if (now.getFullYear() === year && now.getMonth() === i) cls.push('is-now');
                if (focus === i) cls.push('is-focus');
                return `<button type="button" class="${cls.join(' ')}" data-m="${i}" tabindex="-1" aria-label="${BULAN[i]} ${year}">${n}</button>`;
            }).join('') + `</div>` +
            `<div class="mp-foot"><button type="button" class="mp-today" tabindex="-1">Bulan ini</button></div>`;
    }

    function place() {
        if (!pop || !cur) return;
        const r = cur.btn.getBoundingClientRect(), h = pop.offsetHeight;
        const left = Math.max(8, Math.min(r.left, window.innerWidth - PW - 8));
        let top = r.bottom + 6;
        if (top + h > window.innerHeight - 8 && r.top - 6 - h > 8) top = r.top - 6 - h;
        pop.style.left = left + 'px';
        pop.style.top = Math.max(8, top) + 'px';
    }

    function open(input, btn) {
        close();
        const now = new Date(), p = parse(input.value);
        cur = { input, btn, year: p ? p.y : now.getFullYear(), focus: p ? p.m : now.getMonth() };
        pop = document.createElement('div');
        pop.className = 'mp-pop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Pilih bulan');
        pop.addEventListener('mousedown', (e) => e.preventDefault()); // fokus tetap di tombol pemicu (tidak mengganggu fokus modal)
        pop.addEventListener('click', (e) => {
            const nav = e.target.closest('.mp-nav'), m = e.target.closest('.mp-m'), today = e.target.closest('.mp-today');
            if (nav) { cur.year += +nav.dataset.d; render(); }
            else if (m) pick(cur.year, +m.dataset.m);
            else if (today) { const t = new Date(); pick(t.getFullYear(), t.getMonth()); }
        });
        document.body.appendChild(pop);
        render();
        place();
        btn.setAttribute('aria-expanded', 'true');
        document.addEventListener('mousedown', onOutside, true);
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
    }

    function close(kembaliFokus) {
        if (!pop) return;
        document.removeEventListener('mousedown', onOutside, true);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', place);
        window.removeEventListener('scroll', place, true);
        pop.remove();
        if (cur) { cur.btn.setAttribute('aria-expanded', 'false'); if (kembaliFokus) cur.btn.focus(); }
        pop = null; cur = null;
    }

    function pick(y, m) {
        const { input } = cur, v = key(y, m), berubah = input.value !== v;
        input.value = v;
        close(true);
        if (berubah) input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function onOutside(e) {
        if (pop && !pop.contains(e.target) && !(cur && cur.btn.contains(e.target))) close();
    }

    function geser(delta) {
        let idx = cur.focus + delta, y = cur.year;
        while (idx < 0) { idx += 12; y--; }
        while (idx > 11) { idx -= 12; y++; }
        cur.focus = idx; cur.year = y;
        render();
    }

    function onKey(e) {
        if (!pop) return;
        const k = e.key;
        if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }  // jangan ikut menutup modal di belakangnya
        if (k === 'Tab') { close(); return; }
        const arah = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[k];
        if (arah) { e.preventDefault(); e.stopPropagation(); geser(arah); return; }
        if (k === 'PageUp' || k === 'PageDown') { e.preventDefault(); e.stopPropagation(); cur.year += k === 'PageUp' ? -1 : 1; render(); return; }
        if (k === 'Enter' || k === ' ') {
            e.preventDefault(); e.stopPropagation();
            window.addEventListener('keyup', (ev) => ev.preventDefault(), { once: true, capture: true });  // cegah klik tombol dari lepasnya Spasi
            pick(cur.year, cur.focus);
        }
    }

    ['igRkMulai', 'igPlanMonth'].forEach(id => enhance(document.getElementById(id)));
})();
