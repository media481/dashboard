// ============================================================
// 1. SUPABASE CONFIG
// ============================================================
const SUPABASE_URL = "https://asfcqbwvxomkcqzdkshf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzZmNxYnd2eG9ta2NxemRrc2hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTcwNzIsImV4cCI6MjEwMDQ3MzA3Mn0.I00yrEnePXDsuZgMpZyU5HVSzRgN4_cCKNxfXv8WdXQ";
const MASKAPAI_LIST = ["Oman Air","Saudia Airlines","Lion Air","Garuda Indonesia","Emirates","Qatar Airways","Etihad Airways","Malindo Air","Air Asia","IndiGo"];
const CACHE_KEY = 'amiru_cached_data';
const CACHE_TIME_KEY = 'amiru_cache_time';
const CACHE_DURATION = 60000;
const SESSION_DURATION = 30 * 60 * 1000;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        storageKey: 'amiru_supabase_auth',
        storage: window.sessionStorage,
        autoRefreshToken: false,
        persistSession: false,
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
let featuredIds = [];
let jadwalList = [], editingJadwalId = null;
let pendaftaranList = [], editingPendaftaranId = null;

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
let cicilanJamaahInfo = null, cicilanProgramInfo = null, cicilanHargaProgram = 0;
let notaGenerating = false;
let dokSelectedProgram = null;
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
    { key: 'pas_photo', label: 'Pas Photo 4x6', type: 'single' },
    { key: 'form_pendaftaran', label: 'Form Pendaftaran', type: 'single' }
];
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

function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toastMessage');
    const iconEl = toast.querySelector('i');
    if (iconEl) {
        const iconMap = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
        iconEl.className = 'fa-solid ' + (iconMap[type] || iconMap.success);
    }
    msgEl.textContent = msg;
    toast.className = 'toast ' + type;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
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

// ============================================================
// 4. GENERATE AUTO WA TEXT
// ============================================================
function generateAutoWAText(data) {
    const s = v => (v || '').toString().replace(/javascript:/gi, 'blocked:');
    const namaUpper = s(data.nama || 'PROGRAM UMROH').toUpperCase();
    let teks = `🌟 *${namaUpper}* 🌟\n    Bersama Amiru Tour\n`;

    const durasi = data.durasi ? data.durasi.replace(/\s*hari/i, '').trim() : '';
    if (data.tgl && durasi) teks += `📅 Berangkat ${s(data.tgl)} (${durasi} Hari)\n`;
    else if (data.tgl) teks += `📅 Berangkat ${s(data.tgl)}\n`;

    if (data.maskapai) teks += `✈️ ${s(data.maskapai)}\n`;

    const hotelLines = [];
    if (data.hotel_madinah) hotelLines.push(`* Madinah: ${s(data.hotel_madinah)}`);
    if (data.hotel_makkah) hotelLines.push(`* Mekah: ${s(data.hotel_makkah)}`);
    if (hotelLines.length) teks += `🏨 Hotel:\n${hotelLines.join('\n')}\n`;

    const hargaLines = [];
    if (data.harga_quad) hargaLines.push(`* Quad: ${s(data.harga_quad)}`);
    if (data.harga_triple) hargaLines.push(`* Triple: ${s(data.harga_triple)}`);
    if (data.harga_double) hargaLines.push(`* Double: ${s(data.harga_double)}`);
    if (!hargaLines.length && data.harga_quint) hargaLines.push(`* Quint: ${s(data.harga_quint)}`);
    if (hargaLines.length) teks += `💰 Biaya:\n${hargaLines.join('\n')}\n`;

    const termasukList = data.termasuk ? data.termasuk.split('\n').map(i => i.trim()).filter(Boolean) : ['Tiket Pesawat PP', 'Visa Umroh', 'Fullboard Hotel'];
    teks += `✅ Termasuk: ${termasukList.join(', ')}\n`;

    const tidakList = data.tidak_termasuk ? data.tidak_termasuk.split('\n').map(i => i.trim()).filter(Boolean) : ['Paspor', 'Vaksin', 'Pengeluaran pribadi'];
    teks += `❌ Tidak termasuk: ${tidakList.join(', ')}\n`;

    teks += `📞 Info & Itinerary:\nwa.me/6285122336300\nwa.me/6285196241819`;
    return teks;
}

// ============================================================
// 5. TAB SWITCHING
// ============================================================
function switchTab(tabId) {
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
    if (tabId === 'pendaftaran') renderPendaftaranSection();
    if (tabId === 'keberangkatan') renderKbProgramSelector();
    if (tabId === 'dokumen') renderDokProgramSelector();
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
document.querySelectorAll('.sidebar .nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', () => switchTab(item.dataset.tab));
});

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
            currentData = sortProgramsDefault(dataUmroh.filter(p => p.is_active !== false));
            renderTable(currentData);
            updateMetrics();
            renderFeaturedSection();
            loadingEl.style.display = 'none';
            tableEl.style.display = 'table';
            return;
        }
    }

    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('programs').select('*').order('created_at', { ascending: true }),
            { label: 'Muat data program' }
        );
        if (error) throw error;

        const plainData = (data || []).map(p => ({
            id: p.id, nama: p.nama, tgl: p.tgl, durasi: p.durasi, maskapai: p.maskapai,
            harga_quint: p.harga_quint, teks_wa: p.teks_wa,
            link_form: p.link_form, link_itinerary: p.link_itinerary,
            link_poster: p.link_poster, link_metaads: p.link_metaads,
            link_dokumentasi: p.link_dokumentasi, created_at: p.created_at,
            is_active: p.is_active !== false
        }));
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(plainData));
        sessionStorage.setItem(CACHE_TIME_KEY, Date.now().toString());

        dataUmroh = plainData;
        dataUmroh.forEach(p => {
            if (p.tgl && !p.dateObj) p.dateObj = parseDateFromString(p.tgl);
            p.isAvailable = p.dateObj >= new Date();
        });
        currentData = sortProgramsDefault(dataUmroh.filter(p => p.is_active !== false));
        renderTable(currentData);
        updateMetrics();
        renderFeaturedSection();
        loadingEl.style.display = 'none';
        tableEl.style.display = 'table';

    } catch (err) {
        const msg = err?.message || String(err);
        loadingEl.innerHTML = `<div style="padding:40px;text-align:center;color:var(--danger);">
            <i class="fa-solid fa-wifi" style="font-size:24px;display:block;margin-bottom:10px;"></i>
            Gagal memuat data. Periksa koneksi internet Anda.<br>
            <span style="font-size:12px;color:var(--ink-soft);">${escapeHtml(msg)}</span><br>
            <button onclick="loadDataFromSupabase(true)" style="margin-top:12px;padding:6px 16px;border-radius:6px;border:none;background:var(--accent,#2563eb);color:#fff;cursor:pointer;">
                <i class="fa-solid fa-rotate-right"></i> Coba Lagi
            </button>
        </div>`;
        showToast('Gagal memuat data — periksa koneksi internet', 'error');
    }
}

// Tombol kecil di kolom Aksi tabel Program Umroh untuk buka salah satu dari 4
// link aset program (Poster/Itinerary/Meta Ads/Dokumentasi) di tab baru.
// Kalau link belum diisi, tombol tetap tampil tapi non-aktif (abu-abu) supaya
// urutan/posisi 4 tombolnya konsisten di setiap baris.
function renderProgramLinkBtn(url, label, iconClass) {
    const safeUrl = (url || '').trim();
    if (!safeUrl) {
        return `<button type="button" disabled title="${escapeHtml(label)} (belum diisi)" style="opacity:.35;cursor:not-allowed;"><i class="fa-solid ${iconClass}"></i></button>`;
    }
    return `<button type="button" onclick="window.open('${escapeJsAttr(safeUrl)}', '_blank', 'noopener')" title="${escapeHtml(label)}"><i class="fa-solid ${iconClass}"></i></button>`;
}

// ============================================================
// 9. RENDER TABLE
// ============================================================
// Ambil ID 3 program dengan tanggal keberangkatan paling dekat (yang belum
// lewat / masih tersedia). Dihitung dari seluruh dataUmroh yang aktif, jadi
// hasilnya tetap konsisten meski tabel sedang di-search/di-sort ulang oleh user.
function getNearestDepartureIds(count = 3) {
    const now = new Date();
    return new Set(
        dataUmroh
            .filter(p => p.is_active !== false && p.dateObj && p.dateObj >= now)
            .sort((a, b) => a.dateObj - b.dateObj)
            .slice(0, count)
            .map(p => String(p.id))
    );
}

// Hitung estimasi waktu menuju tanggal keberangkatan dalam Bahasa Indonesia.
// Hasil contoh: "hari ini", "1 hari lagi", "1 bulan 3 hari lagi", "2 tahun 1 bulan lagi".
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
    if (years) parts.push(`${years} tahun`);
    if (months) parts.push(`${months} bulan`);
    if (days) parts.push(`${days} hari`);
    if (!parts.length) parts.push('hari ini');
    return parts.join(' ') + ' lagi';
}

function renderTable(data) {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    const now = new Date();
    const canEdit = canManageProgramData(); // admin & user boleh edit/hapus, guest & publik hanya lihat
    if (!data || !data.length) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--ink-soft);">
            <i class="fa-solid fa-inbox" style="font-size:24px;display:block;margin-bottom:10px;"></i>
            Belum ada program umroh.${canEdit ? ' Klik "Tambah" untuk menambahkan.' : ''}
        </td></tr>`;
        return;
    }

    const nearestIds = getNearestDepartureIds(3);

    tbody.innerHTML = data.map(item => {
        const isAvailable = item.dateObj >= now;
        const statusClass = isAvailable ? "available" : "full";
        const statusLabel = isAvailable ? "Tersedia" : "Expired";
        const diffMs = item.dateObj - now;
        let cdText = "sudah berangkat";
        if (diffMs >= 0) {
            const diffDays = Math.floor(diffMs / (1000*60*60*24));
            const years = Math.floor(diffDays/365), months = Math.floor((diffDays%365)/30), days = (diffDays%365)%30;
            const parts = [];
            if (years) parts.push(`${years}th`);
            if (months) parts.push(`${months}bl`);
            if (days) parts.push(`${days}hr`);
            if (!parts.length) parts.push("hari ini!");
            cdText = parts.join(" ") + (diffDays>0?" lagi":"");
        }
        const isNearest = nearestIds.has(String(item.id));

        return `<tr class="${isNearest ? 'row-nearest-departure' : ''}">
            <td><strong>${escapeHtml(item.nama||'')}</strong></td>
            <td>${escapeHtml(hitungEstimasi(item.dateObj, now))}</td>
            <td>${escapeHtml(formatRupiah(item.harga_quint))}</td>
            <td>${escapeHtml(item.tgl||'-')}${isNearest ? ` <span class="nearest-badge" title="Salah satu dari 3 keberangkatan terdekat"><i class="fa-solid fa-bolt"></i> Terdekat</span>` : ''}</td>
            <td>${escapeHtml(item.durasi||'-')}</td>
            <td>${escapeHtml(item.maskapai||'-')}</td>
            <td>
                <div class="action-btns">
                    <button onclick="openDetailModal('${item.id}')" title="Detail"><i class="fa-solid fa-eye"></i></button>
                    ${renderProgramLinkBtn(item.link_poster, 'Link Poster', 'fa-image')}
                    ${renderProgramLinkBtn(item.link_itinerary, 'Link Itinerary', 'fa-route')}
                    ${renderProgramLinkBtn(item.link_metaads, 'Link Meta Ads', 'fa-bullhorn')}
                    ${renderProgramLinkBtn(item.link_dokumentasi, 'Link Dokumentasi', 'fa-images')}
                </div>
            </td>
            <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
        </tr>`;
    }).join('');
}

function updateMetrics() {
    document.getElementById('totalPrograms').textContent = dataUmroh.length;
    document.getElementById('totalFeatured').textContent = featuredIds.filter(id => {
        const p = dataUmroh.find(x => String(x.id) === id);
        return p && p.is_active !== false;
    }).length;
    document.getElementById('totalJadwal').textContent = jadwalList.length;
    document.getElementById('totalKeberangkatan').textContent = kbJamaahList.length;
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

function filterData(term) {
    const t = term.toLowerCase().trim();
    const visiblePrograms = dataUmroh.filter(p => p.is_active !== false);
    if (!t) {
        currentData = sortProgramsDefault(visiblePrograms);
    } else {
        const keywords = t.split(/\s+/).filter(Boolean);
        currentData = visiblePrograms.filter(item => {
            const haystack = [item.nama||'', item.maskapai||'', item.tgl||'', item.durasi||'', item.harga_quint||''].join(' ').toLowerCase();
            return keywords.every(kw => haystack.includes(kw));
        });
    }
    if (currentSort.column) applySortToData();
    renderTable(currentData);
}

function handleSearchInput(e) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => filterData(e.target.value), 300);
}

// ============================================================
// 11. DETAIL MODAL
// ============================================================
function openDetailModal(programId) {
    const program = dataUmroh.find(p => String(p.id) === String(programId));
    if (!program) { showToast('Program tidak ditemukan', 'error'); return; }
    const waText = program.teks_wa || generateAutoWAText(program);
    alert(`Detail Program\n\nNama: ${program.nama}\nTanggal: ${program.tgl}\nDurasi: ${program.durasi}\nMaskapai: ${program.maskapai}\nHarga: ${formatRupiah(program.harga_quint)}\n\nTeks WA:\n${waText}`);
}

// ============================================================
// 12. ADMIN LOGIN
// ============================================================
// [FIX bug #6] Password TIDAK lagi di-SELECT ke browser. Role ditentukan oleh
// KEY-nya (deterministik), bukan nilai password. Verifikasi password dilakukan di
// server lewat RPC verify_dashboard_password() (SECURITY DEFINER) — lihat
// sql/fix_bug6_auth_rpc.sql. USER_ROLES hanya menyimpan role/label untuk UI.
async function loadUserRoles() {
    USER_ROLES = {
        pass_administrator: { role: 'admin', label: 'Admin' },
        pass_admin:         { role: 'admin', label: 'Admin' },
        pass_cs:            { role: 'user',  label: 'CS / Customer Service' },
        pass_user:          { role: 'user',  label: 'User' },
        pass_guest:         { role: 'guest', label: 'Guest' }
    };
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
            sessionStorage.removeItem('admin_logged_in');
            sessionStorage.removeItem('admin_role');
            sessionStorage.removeItem('admin_login_time');
            const adminView = document.getElementById('adminPageView');
            if (adminView.style.display !== 'none') closeAdminPanel();
            renderSidebarNav();
            showToast('Sesi berakhir, silakan login ulang.', 'error');
        }
    }, SESSION_DURATION);
}

function checkSession() {
    const loggedIn = sessionStorage.getItem('admin_logged_in');
    const loginTime = sessionStorage.getItem('admin_login_time');
    const savedRole = sessionStorage.getItem('admin_role');
    if (loggedIn === 'true' && loginTime && (Date.now() - parseInt(loginTime) < SESSION_DURATION)) {
        adminLoggedIn = true;
        currentRole = savedRole || 'admin';
        setAdminSession(currentRole);
    } else {
        sessionStorage.removeItem('admin_logged_in');
        sessionStorage.removeItem('admin_role');
        sessionStorage.removeItem('admin_login_time');
        adminLoggedIn = false;
        currentRole = null;
    }
}

// [FIX bug #6] Verifikasi password di server lewat RPC SECURITY DEFINER.
// Password tidak pernah dibandingkan di browser & tidak dikembalikan oleh DB.
async function checkAdminLogin() {
    const pwd = document.getElementById('adminPasswordInput')?.value;
    const errorDiv = document.getElementById('adminLoginError');
    if (!errorDiv) return;

    if (Date.now() < loginLockTime) {
        const waitSeconds = Math.ceil((loginLockTime - Date.now()) / 1000);
        errorDiv.innerHTML = '<i class="fa-solid fa-hourglass-half"></i> Terlalu banyak percobaan. Coba lagi ' + waitSeconds + ' detik.';
        return;
    }
    if (loginLockTime && Date.now() >= loginLockTime) {
        loginAttempts = 0;
        loginLockTime = 0;
    }

    if (!pwd) {
        errorDiv.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Password kosong!';
        return;
    }

    let result;
    try {
        const { data, error } = await supabaseClient.rpc('verify_dashboard_password', { p_pass: pwd });
        if (error) throw error;
        result = data; // { ok:true, role, label } atau { ok:false }
    } catch (err) {
        console.error('checkAdminLogin RPC error:', err);
        errorDiv.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Gagal menghubungi server. Periksa koneksi.';
        return;
    }

    if (result && result.ok) {
        loginAttempts = 0;
        setAdminSession(result.role);
        const petugasNama = document.getElementById('adminPetugasInput')?.value.trim() || '';
        try { sessionStorage.setItem('admin_petugas_nama', petugasNama); } catch (_) {}
        closeAdminPanel();
        renderSidebarNav();
        showToast('Berhasil login sebagai ' + result.label);
    } else {
        loginAttempts++;
        if (loginAttempts >= 5) {
            loginLockTime = Date.now() + 60000;
            errorDiv.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Terlalu banyak percobaan. Coba lagi 1 menit.';
        } else {
            errorDiv.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Password salah! Sisa percobaan: ' + (5 - loginAttempts);
        }
    }
}


// ============================================================
// 12b. PENGATURAN USER (kelola password per role, admin only)
// ============================================================
async function saveUserSettings() {
    if (currentRole !== 'admin') { showToast('Hanya Admin yang boleh mengubah pengaturan user', 'error'); return; }
    const statusEl = document.getElementById('usSettingsStatus');
    const vals = {
        pass_admin: document.getElementById('us_pass_admin')?.value.trim() || '',
        pass_user: document.getElementById('us_pass_user')?.value.trim() || '',
        pass_guest: document.getElementById('us_pass_guest')?.value.trim() || ''
    };
    const rows = Object.entries(vals).filter(([, v]) => v).map(([key, value]) => ({ key, value }));
    if (!rows.length) { if (statusEl) statusEl.innerHTML = '<span style="color:var(--ink-soft);font-size:12.5px;">Tidak ada perubahan — isi kolom yang ingin diubah.</span>'; return; }
    try {
        for (const row of rows) {
            const { error } = await supabaseClient.rpc('set_admin_password', { p_key: row.key, p_val: row.value });
            if (error) throw error;
        }
        if (error) throw error;
        USER_ROLES = {};
        await loadUserRoles();
        ['us_pass_admin','us_pass_user','us_pass_guest'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--success);font-size:12.5px;"><i class="fa-solid fa-circle-check"></i> Password berhasil disimpan.</span>';
        showToast('Pengaturan user berhasil disimpan');
    } catch (err) {
        console.error('saveUserSettings error:', err);
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);font-size:12.5px;"><i class="fa-solid fa-circle-exclamation"></i> Gagal menyimpan: ${escapeHtml(err.message)}</span>`;
        showToast('Gagal menyimpan pengaturan user', 'error');
    }
}

function logoutAdmin() {
    adminLoggedIn = false;
    currentRole = null;
    sessionStorage.removeItem('admin_logged_in');
    sessionStorage.removeItem('admin_role');
    sessionStorage.removeItem('admin_login_time');
    sessionStorage.removeItem('admin_petugas_nama');
    if (sessionTimeout) clearTimeout(sessionTimeout);
    closeAdminPanel();
    renderSidebarNav();
    showToast('Berhasil logout');
}

// ============================================================
// 13. ADMIN PANEL
// ============================================================
let previousActiveTab = null;

// subtab: 'program' | 'crosscheck' | 'telegram' | 'usersettings' (opsional).
// Dipanggil dari menu sidebar "Manajemen" (admin) atau tombol "Login"/"Tambah" (tanpa param).
async function openAdminPanel(subtab) {
    checkSession();
    // Snapshot otomatis harian (1x/hari) — hanya untuk admin yang benar-benar login
    if (adminLoggedIn && currentRole === 'admin') {
        maybeDailySnapshot();
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
}

function renderMaskapaiOptions(selected = '') {
    let opts = '<option value="">-- Pilih Maskapai --</option>';
    MASKAPAI_LIST.forEach(m => opts += `<option value="${escapeHtml(m)}" ${selected === m ? 'selected' : ''}>${escapeHtml(m)}</option>`);
    return opts;
}

function getAdminLoginBoxHtml() {
    return `
    <div class="admin-login-box">
        <div class="admin-login-head">
            <div class="admin-login-icon"><i class="fa-solid fa-shield-halved"></i></div>
            <div>
                <h3>Masuk</h3>
                <p>Admin &middot; User &middot; Guest</p>
            </div>
        </div>
        <div class="admin-login-body">
            <label class="admin-login-label" for="adminPetugasInput">Nama Petugas <span>(opsional)</span></label>
            <input type="text" id="adminPetugasInput" placeholder="Untuk log audit" maxlength="100" onkeydown="if(event.key==='Enter')checkAdminLogin()">
            <label class="admin-login-label" for="adminPasswordInput">Password</label>
            <input type="password" id="adminPasswordInput" placeholder="••••••••" onkeydown="if(event.key==='Enter')checkAdminLogin()">
            <button onclick="checkAdminLogin()" class="btn-primary"><i class="fa-solid fa-arrow-right-to-bracket"></i> Masuk</button>
            <div id="adminLoginError" class="admin-login-error"></div>
        </div>
    </div>`;
}

const ADMIN_SUBTAB_META = {
    program: { title: 'Edit & Tambah Program', subtitle: 'Kelola data program umroh' },
    pembayaran: { title: 'Pembayaran', subtitle: 'Kelola pembayaran biaya umroh seluruh jamaah' },
    unggulan: { title: 'Program Unggulan', subtitle: 'Pilih maksimal 3 program untuk ditampilkan di beranda' },
    crosscheck: { title: 'Crosscheck', subtitle: 'Bandingkan poster dengan data program yang tersimpan' },
    telegram: { title: 'Telegram', subtitle: 'Atur notifikasi otomatis ke grup/chat Telegram' },
    auditnota: { title: 'Audit Nota', subtitle: 'Log audit setiap nota yang diterbitkan — append-only, tidak bisa diubah' },
    usersettings: { title: 'Pengaturan User', subtitle: 'Atur password untuk masing-masing role' },
    snapshot: { title: 'Snapshot / Backup', subtitle: 'Cadangan harian semua data Umroh (maksimal 10)' }
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

    if (name === 'crosscheck') {
        if (!cxSelectedProgram && adminPrograms && adminPrograms.length) {
            const prioritized = [...adminPrograms].sort((a, b) => cxGetProgramStatus(a).priority - cxGetProgramStatus(b).priority);
            cxSelectedProgram = prioritized[0].id;
        }
        renderCxProgramSelector();
        if (cxSelectedProgram) renderCxPanel(cxSelectedProgram);
    }
    if (name === 'telegram') { renderTgRecipients(); }
    if (name === 'auditnota') { loadNotaAuditLog(true); }
    if (name === 'pembayaran') { renderPembayaranPanel(); }
    if (name === 'unggulan') { renderFeaturedAdminTable(); }
    if (name === 'snapshot') { renderSnapshotAdminTable(); }
}

async function renderAdminPanel() {
    const container = document.getElementById('adminPanelBody');
    if (adminLoggedIn) {
        // ---- Role tiers ----
        // admin  : akses penuh (Program + Crosscheck + Telegram + Pengaturan User)
        // user   : hanya kelola data Program (tambah/edit/hapus), tidak bisa masuk subtab lain
        // guest  : hanya boleh melihat data Program (read-only), tidak ada tombol aksi
        const isAdmin = currentRole === 'admin';
        const isUser = currentRole === 'user';
        const isGuest = currentRole === 'guest';
        const canEditData = isAdmin || isUser; // boleh tambah/edit/hapus program
        const { data } = await supabaseClient.from('programs').select('*').order('created_at');
        adminPrograms = (data || []).map(unpackProgramAdminData).sort((a, b) => {
            const da = a.tgl ? parseDateFromString(a.tgl) : null;
            const db = b.tgl ? parseDateFromString(b.tgl) : null;
            if (!da && !db) return 0;
            if (!da) return 1;  // program tanpa tanggal ditaruh di bawah
            if (!db) return -1;
            return da - db;
        });

        container.innerHTML = `
            <div class="admin-subtab-panel" id="adminSubTab-program" style="display:block;">
            <div class="admin-toolbar">
                ${canEditData ? `<button class="btn-primary" onclick="showAdminForm()"><i class="fa-solid fa-plus"></i> Tambah Program</button>` : `<span class="admin-role-note"><i class="fa-solid fa-eye"></i> Mode lihat saja (Guest)</span>`}
                <div class="admin-toolbar-right">
                    ${isAdmin ? `
                    <button class="btn-icon-ghost" onclick="exportAdminData()" title="Export Data"><i class="fa-solid fa-download"></i></button>
                    <button class="btn-icon-ghost" onclick="importAdminData()" title="Import Data"><i class="fa-solid fa-upload"></i></button>
                    <button class="btn-icon-ghost danger" onclick="clearAllAdminData()" title="Hapus Semua Data"><i class="fa-solid fa-trash"></i></button>
                    ` : ''}
                </div>
            </div>

            ${canEditData ? `
            <div id="adminFormContainer" class="admin-form-card" style="display:none;">
                <div class="admin-form-head">
                    <h3><i class="fa-solid fa-file-pen"></i> <span id="adminFormTitle">Tambah Program Baru</span></h3>
                    <div class="admin-form-head-actions">
                        <button class="btn-submit-sm" onclick="saveAdminProgram()" title="Simpan (Ctrl+Enter)"><i class="fa-solid fa-save"></i> <span>Simpan</span></button>
                        <button class="admin-form-close" onclick="hideAdminForm()" title="Batal (Esc)">&times;</button>
                    </div>
                </div>
                <div class="admin-form-body">
                    <details id="parseBroadcastBox" class="admin-broadcast-box">
                        <summary class="label"><i class="fa-solid fa-wand-magic-sparkles"></i> Auto-isi dari Teks Broadcast <span class="bc-hint">(opsional — klik untuk buka)</span></summary>
                        <textarea id="parseBroadcastInput" rows="3" placeholder="Paste teks broadcast program umroh di sini..."></textarea>
                        <div class="bc-actions">
                            <button onclick="parseBroadcastText()"><i class="fa-solid fa-wand-magic-sparkles"></i> Isi Otomatis</button>
                            <span id="parseStatus" style="font-size:12px;color:var(--success);font-weight:600;display:none;"></span>
                        </div>
                    </details>

                    <div class="admin-fieldset">
                        <div class="admin-fieldset-title"><i class="fa-solid fa-circle-info"></i> Informasi Program</div>
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
                    </div>

                    <div class="admin-fieldset">
                        <div class="admin-fieldset-title"><i class="fa-solid fa-tags"></i> Harga per Kamar</div>
                        <div class="form-row form-row-4">
                            <div class="form-group">
                                <label>Harga Quad</label>
                                <input type="text" id="admin_harga_quad" placeholder="Rp 35.000.000" maxlength="50">
                            </div>
                            <div class="form-group">
                                <label>Harga Triple</label>
                                <input type="text" id="admin_harga_triple" placeholder="Rp 37.500.000" maxlength="50">
                            </div>
                            <div class="form-group">
                                <label>Harga Double</label>
                                <input type="text" id="admin_harga_double" placeholder="Rp 42.000.000" maxlength="50">
                            </div>
                            <div class="form-group">
                                <label>Harga Quint</label>
                                <input type="text" id="admin_harga_quint" placeholder="Rp 32.500.000" maxlength="50">
                            </div>
                        </div>
                    </div>

                    <div class="admin-fieldset">
                        <div class="admin-fieldset-title"><i class="fa-solid fa-hotel"></i> Akomodasi</div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Hotel Makkah</label>
                                <input type="text" id="admin_hotel_makkah" placeholder="Nama hotel & bintang" maxlength="100">
                            </div>
                            <div class="form-group">
                                <label>Hotel Madinah</label>
                                <input type="text" id="admin_hotel_madinah" placeholder="Nama hotel & bintang" maxlength="100">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Makan Makkah</label>
                                <input type="text" id="admin_makan_makkah" placeholder="3x Sehari / 2x Sehari" maxlength="80">
                            </div>
                            <div class="form-group">
                                <label>Makan Madinah</label>
                                <input type="text" id="admin_makan_madinah" placeholder="3x Sehari / 2x Sehari" maxlength="80">
                            </div>
                        </div>
                    </div>

                    <div class="admin-fieldset">
                        <div class="admin-fieldset-title"><i class="fa-solid fa-link"></i> Link & Aset</div>
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
                        <div class="form-row">
                            <div class="form-group">
                                <label>Link Meta Ads</label>
                                <input type="url" id="admin_link_metaads" placeholder="https://...">
                            </div>
                            <div class="form-group">
                                <label>Link Dokumentasi</label>
                                <input type="url" id="admin_link_dokumentasi" placeholder="https://...">
                            </div>
                        </div>
                    </div>

                    <div class="admin-fieldset">
                        <div class="admin-fieldset-title"><i class="fa-solid fa-align-left"></i> Konten Tambahan</div>
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
                            <textarea id="admin_catatan_cx" rows="2" placeholder="Catatan internal..." maxlength="500"></textarea>
                        </div>
                        <div class="form-group" style="margin-bottom:0;">
                            <label>Teks WA</label>
                            <textarea id="admin_teks_wa" rows="4" placeholder="Kosongkan untuk generate otomatis" maxlength="5000"></textarea>
                        </div>
                    </div>
                </div>
                <div class="admin-form-footer">
                    <button class="btn-submit" onclick="saveAdminProgram()"><i class="fa-solid fa-save"></i> Simpan</button>
                    <button class="btn-cancel" onclick="hideAdminForm()">Batal</button>
                </div>
            </div>
            ` : ''}

            <div class="admin-table-card">
                <div class="admin-table-head">
                    <h4>Daftar Program</h4>
                    <span class="count">${adminPrograms.length} program</span>
                </div>
                <div class="admin-table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Nama Program</th>
                                <th>Tanggal Berangkat</th>
                                <th>Durasi</th>
                                <th>Quad</th>
                                <th>Double</th>
                                <th>Triple</th>
                                <th>Maskapai</th>
                                ${canEditData ? `<th style="text-align:right;">Aksi</th>` : ''}
                            </tr>
                        </thead>
                        <tbody id="adminTableBody"></tbody>
                    </table>
                </div>
            </div>
            </div>

            ${isAdmin ? `
            <div class="admin-subtab-panel" id="adminSubTab-pembayaran" style="display:none;">
                <div class="admin-section-header">
                    <div><h4><i class="fa-solid fa-money-bill-wave"></i> Pembayaran Biaya Umroh</h4>
                    <p>Pantau & kelola cicilan/pelunasan biaya umroh seluruh jamaah dari semua program</p></div>
                </div>
                <div class="pb-income-hero" id="pbIncomeHero"></div>
                <div class="pb-income-breakdown-wrap">
                    <div class="pb-income-breakdown-head">
                        <h4><i class="fa-solid fa-chart-column"></i> Rincian Pemasukan per Program</h4>
                        <span class="count" id="pbBreakdownCount">0 program</span>
                    </div>
                    <div class="pb-income-breakdown-grid" id="pbIncomeBreakdown"></div>
                </div>
                <div class="cx-stats-bar" id="pbStatsBar"></div>
                <div class="admin-toolbar">
                    <input type="text" id="pbSearchInput" placeholder="Cari nama jamaah / NIK / paspor..." style="flex:1;min-width:220px;" oninput="renderPembayaranPanel()">
                    <select id="pbFilterProgram" onchange="renderPembayaranPanel()" style="min-width:180px;">
                        <option value="">Semua Program</option>
                    </select>
                    <select id="pbFilterStatus" onchange="renderPembayaranPanel()" style="min-width:160px;">
                        <option value="">Semua Status</option>
                        <option value="lunas">Lunas</option>
                        <option value="cicilan">Cicilan</option>
                        <option value="belum">Belum Bayar</option>
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
                    <div><h4><i class="fa-solid fa-star" style="color:#d97706;"></i> Program Unggulan</h4>
                    <p>Pilih maksimal 3 program untuk ditampilkan di beranda (antara running text & tabel program)</p></div>
                    <div class="sec-actions"><span id="featuredCounter" style="background:#f59e0b;color:#fff;font-size:11px;font-weight:800;padding:4px 12px;border-radius:20px;">0/3</span></div>
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

            <div class="admin-subtab-panel" id="adminSubTab-crosscheck" style="display:none;">
                <div class="admin-section-header">
                    <div><h4><i class="fa-solid fa-magnifying-glass-chart"></i> Crosscheck Data Program</h4>
                    <p>Poster dibaca otomatis (OCR) & dibandingkan dengan data teks program saat disimpan</p></div>
                </div>
                <div class="cx-stats-bar" id="cxStatsBar"></div>
                <div class="cx-selector-head">
                    <div class="cx-label-sm" style="margin-bottom:0;">Pilih Program:</div>
                    <input type="text" id="cxSearchInput" class="cx-search-input" placeholder="Cari nama program..." oninput="renderCxProgramSelector()">
                </div>
                <div class="cx-program-selector" id="cxProgramSelector"></div>
                <div id="cxPanelContent">
                    <div class="cx-empty"><i class="fa-solid fa-magnifying-glass-chart"></i><p>Pilih program di atas untuk melihat data crosscheck.</p></div>
                </div>
            </div>

            <div class="admin-subtab-panel" id="adminSubTab-telegram" style="display:none;">
                <div class="admin-section-header">
                    <div><h4><i class="fa-brands fa-telegram"></i> Notifikasi Telegram</h4>
                    <p>Kirim notifikasi otomatis ke grup/chat Telegram saat ada program/jadwal baru</p></div>
                </div>
                <div class="tg-info-box">
                    <b><i class="fa-solid fa-list-check"></i> Cara Setup:</b><br>
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
                <button class="tg-add-btn" onclick="addTgRecipient()"><i class="fa-solid fa-plus"></i> Tambah Penerima</button>
                <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;">
                    <button class="btn-primary" onclick="saveTgConfig()"><i class="fa-solid fa-save"></i> Simpan Konfigurasi</button>
                    <button class="btn-cancel" onclick="testTgNotif()"><i class="fa-solid fa-paper-plane"></i> Test Kirim</button>
                </div>
                <div id="tgStatusMsg" style="margin-top:12px;"></div>
                <div class="tg-notif-log" id="tgNotifLog" style="display:none;">
                    <p style="color:var(--ink-soft);font-size:11px;margin-bottom:6px;"><i class="fa-solid fa-list"></i> LOG PENGIRIMAN TELEGRAM:</p>
                </div>
            </div>

            <div class="admin-subtab-panel" id="adminSubTab-auditnota" style="display:none;">
                <div class="admin-section-header">
                    <div><h4><i class="fa-solid fa-file-shield"></i> Audit Nota</h4>
                    <p>Setiap nota yang diunduh (pembayaran & riwayat) otomatis tercatat di sini. Log ini append-only — tidak bisa diedit atau dihapus siapa pun, termasuk Admin.</p></div>
                </div>
                <div class="admin-toolbar">
                    <input type="text" id="auditNotaSearch" placeholder="Cari nama jamaah / no. nota / kode verifikasi..." style="flex:1;min-width:220px;" oninput="handleAuditNotaSearchInput()">
                    <select id="auditNotaFilterJenis" onchange="loadNotaAuditLog(true)" style="min-width:160px;">
                        <option value="">Semua Jenis</option>
                        <option value="pembayaran">Nota Pembayaran</option>
                        <option value="riwayat">Nota Riwayat</option>
                    </select>
                </div>
                <div class="admin-table-card">
                    <div class="admin-table-head">
                        <h4>Log Audit Nota</h4>
                        <span class="count" id="auditNotaCount">0 baris</span>
                    </div>
                    <div class="admin-table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Waktu</th>
                                    <th>No. Nota</th>
                                    <th>Jenis</th>
                                    <th>Jamaah</th>
                                    <th>Jumlah</th>
                                    <th>Dicetak Oleh</th>
                                    <th>Kode Verifikasi</th>
                                </tr>
                            </thead>
                            <tbody id="auditNotaTableBody"><tr><td colspan="7" style="text-align:center;padding:24px;color:var(--ink-soft);">Memuat...</td></tr></tbody>
                        </table>
                    </div>
                </div>
                <div style="display:flex;justify-content:center;margin-top:14px;">
                    <button class="btn-cancel" id="auditNotaLoadMoreBtn" onclick="loadNotaAuditLog(false)" style="display:none;"><i class="fa-solid fa-rotate"></i> Muat Lebih Banyak</button>
                </div>
            </div>

            <div class="admin-subtab-panel" id="adminSubTab-usersettings" style="display:none;">
                <div class="admin-section-header">
                    <div><h4><i class="fa-solid fa-user-gear"></i> Pengaturan User</h4>
                    <p>Atur password untuk masing-masing role: Admin (akses penuh), User (kelola data program), Guest (lihat saja)</p></div>
                </div>
                <div class="admin-fieldset">
                    <div class="admin-fieldset-title"><i class="fa-solid fa-key"></i> Password per Role</div>
                    <div class="form-group">
                        <label>Password Admin</label>
                        <input type="text" id="us_pass_admin" placeholder="Kosongkan jika tidak ingin mengubah" autocomplete="off">
                    </div>
                    <div class="form-group">
                        <label>Password User</label>
                        <input type="text" id="us_pass_user" placeholder="Kosongkan jika tidak ingin mengubah" autocomplete="off">
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                        <label>Password Guest</label>
                        <input type="text" id="us_pass_guest" placeholder="Kosongkan jika tidak ingin mengubah" autocomplete="off">
                    </div>
                </div>
                <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">
                    <button class="btn-primary" onclick="saveUserSettings()"><i class="fa-solid fa-save"></i> Simpan Password</button>
                </div>
                <div id="usSettingsStatus" style="margin-top:12px;"></div>
            </div>

            <div class="admin-subtab-panel" id="adminSubTab-snapshot" style="display:none;">
                <div class="snap-header">
                    <div class="snap-header-title">
                        <i class="fa-solid fa-camera-retro"></i>
                        <div>
                            <h4>Snapshot / Backup</h4>
                            <span>Maks 10 · tertua otomatis terhapus · tidak bisa dihapus manual</span>
                        </div>
                    </div>
                    <button class="btn-primary btn-sm" onclick="takeSnapshot('Manual ' + new Date().toLocaleDateString('id-ID'), 'manual').then(() => renderSnapshotAdminTable());">
                        <i class="fa-solid fa-camera"></i> Ambil
                    </button>
                </div>
                <div id="snapshotTableWrap"></div>
            </div>
            ` : ''}
        `;

        // Render tabel & siapkan form untuk role yang boleh mengedit
        renderAdminTable();
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
        container.innerHTML = getAdminLoginBoxHtml();
        setTimeout(() => {
            const pwd = document.getElementById('adminPasswordInput');
            if (pwd) pwd.focus();
        }, 100);
    }
}

function renderAdminTable() {
    const tbody = document.getElementById('adminTableBody');
    if (!tbody) return;
    const canEditData = currentRole === 'admin' || currentRole === 'user';
    const countEl = document.querySelector('.admin-table-head .count');
    if (countEl) countEl.textContent = `${adminPrograms.length} program`;
    if (!adminPrograms.length) {
        tbody.innerHTML = `<tr><td colspan="${canEditData ? 8 : 7}" style="text-align:center;padding:30px;color:var(--ink-soft);">Belum ada program.${canEditData ? ' Klik "Tambah Program" untuk mulai.' : ''}</td></tr>`;
        return;
    }
    tbody.innerHTML = adminPrograms.map(p => `
        <tr>
            <td><strong>${escapeHtml(p.nama||'-')}</strong></td>
            <td>${escapeHtml(p.tgl||'-')}</td>
            <td>${escapeHtml(p.durasi||'-')}</td>
            <td>${escapeHtml(p.harga_quad || p.harga_quint || '-')}</td>
            <td>${escapeHtml(p.harga_double||'-')}</td>
            <td>${escapeHtml(p.harga_triple||'-')}</td>
            <td>${escapeHtml(p.maskapai||'-')}</td>
            ${canEditData ? `
            <td style="text-align:right;">
                <div class="action-btns" style="justify-content:flex-end;">
                    <button onclick="editAdminProgram('${p.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="openDeleteModal('programs','${p.id}','${escapeJsAttr(p.nama)}')" class="danger" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
            ` : ''}
        </tr>
    `).join('');
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
    document.getElementById('adminFormTitle').innerText = 'Tambah Program Baru';
    document.getElementById('adminFormContainer').style.display = 'block';
    document.getElementById('adminFormContainer').scrollIntoView({ behavior: 'smooth' });
    focusAdminFormAndSnapshot();
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

function hideAdminForm(skipConfirm) {
    if (!skipConfirm && isAdminFormDirty()) {
        if (!confirm('Ada perubahan yang belum disimpan. Tutup form dan buang perubahan?')) return;
    }
    document.getElementById('adminFormContainer').style.display = 'none';
}

// Shortcut keyboard saat form Tambah/Edit Program terbuka: Esc = batal, Ctrl/Cmd+Enter = simpan
document.addEventListener('keydown', function(e) {
    const container = document.getElementById('adminFormContainer');
    if (!container || container.style.display === 'none') return;
    if (e.key === 'Escape') { hideAdminForm(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveAdminProgram(); }
});

function getAdminFormData() {
    return {
        nama: document.getElementById('admin_nama')?.value.trim() || '',
        tgl: document.getElementById('admin_tgl')?.value || '',
        durasi: document.getElementById('admin_durasi')?.value || '',
        maskapai: document.getElementById('admin_maskapai')?.value || '',
        harga_quint: document.getElementById('admin_harga_quint')?.value || '',
        harga_quad: document.getElementById('admin_harga_quad')?.value || '',
        harga_triple: document.getElementById('admin_harga_triple')?.value || '',
        harga_double: document.getElementById('admin_harga_double')?.value || '',
        hotel_makkah: document.getElementById('admin_hotel_makkah')?.value || '',
        hotel_madinah: document.getElementById('admin_hotel_madinah')?.value || '',
        makan_makkah: document.getElementById('admin_makan_makkah')?.value || '',
        makan_madinah: document.getElementById('admin_makan_madinah')?.value || '',
        link_poster: document.getElementById('admin_link_poster')?.value || '',
        link_itinerary: document.getElementById('admin_link_itinerary')?.value || '',
        link_metaads: document.getElementById('admin_link_metaads')?.value || '',
        link_dokumentasi: document.getElementById('admin_link_dokumentasi')?.value || '',
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
    document.getElementById('admin_harga_quint').value = data.harga_quint || '';
    document.getElementById('admin_harga_quad').value = data.harga_quad || '';
    document.getElementById('admin_harga_triple').value = data.harga_triple || '';
    document.getElementById('admin_harga_double').value = data.harga_double || '';
    document.getElementById('admin_hotel_makkah').value = data.hotel_makkah || '';
    document.getElementById('admin_hotel_madinah').value = data.hotel_madinah || '';
    document.getElementById('admin_makan_makkah').value = data.makan_makkah || '';
    document.getElementById('admin_makan_madinah').value = data.makan_madinah || '';
    document.getElementById('admin_link_poster').value = data.link_poster || '';
    document.getElementById('admin_link_itinerary').value = data.link_itinerary || '';
    document.getElementById('admin_link_metaads').value = data.link_metaads || '';
    document.getElementById('admin_link_dokumentasi').value = data.link_dokumentasi || '';
    document.getElementById('admin_termasuk').value = data.termasuk || '';
    document.getElementById('admin_tidak_termasuk').value = data.tidak_termasuk || '';
    document.getElementById('admin_catatan_cx').value = data.catatan_cx || '';
    document.getElementById('admin_teks_wa').value = data.teks_wa || '';
}

// Guard: hanya role 'admin' & 'user' yang boleh tambah/edit/hapus data program
function canManageProgramData() {
    return adminLoggedIn && (currentRole === 'admin' || currentRole === 'user');
}

// Sembunyikan tombol tambah data (Jadwal Tamu, Data Jamaah, Program) dari guest/publik yang belum login
function applyRoleUIVisibility() {
    const canEdit = canManageProgramData();
    const btnJadwal = document.getElementById('btnTambahJadwal');
    const btnJamaah = document.getElementById('btnTambahJamaah');
    const btnProgram = document.getElementById('btnTambahProgram');
    if (btnJadwal) btnJadwal.style.display = canEdit ? '' : 'none';
    if (btnJamaah) btnJamaah.style.display = canEdit ? '' : 'none';
    if (btnProgram) btnProgram.style.display = canEdit ? '' : 'none';
}

// ============================================================
// 12c. SIDEBAR NAV — tampilan menu sidebar menyesuaikan role
// ============================================================
// guest / belum login : hanya "Program Umroh" & "Unggulan"
// user  (sudah login)  : + "Jadwal Tamu" & "Keberangkatan" (boleh edit/hapus langsung di tabel)
// admin (sudah login)  : + menu "Manajemen" (Edit & Tambah Program, Crosscheck, Telegram, Pengaturan User)

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

function renderSidebarNav() {
    const loggedIn = !!adminLoggedIn;
    const isAdminRole = loggedIn && currentRole === 'admin';
    const roleLabels = { admin: 'Admin', user: 'User', guest: 'Guest' };

    document.querySelectorAll('.nav-loggedin-only').forEach(el => { el.style.display = loggedIn ? '' : 'none'; });
    document.querySelectorAll('.nav-admin-only').forEach(el => { el.style.display = isAdminRole ? '' : 'none'; });
    document.querySelectorAll('.login-btn').forEach(el => { el.style.display = loggedIn ? 'none' : ''; });
    document.querySelectorAll('.logout-btn').forEach(el => { el.style.display = loggedIn ? '' : 'none'; });

    const whoEl = document.getElementById('sidebarWho');
    const avatarEl = document.getElementById('sidebarAvatar');
    const label = loggedIn ? (roleLabels[currentRole] || 'User') : 'Guest';
    if (whoEl) whoEl.textContent = label;
    if (avatarEl) avatarEl.textContent = label.slice(0, 2).toUpperCase();

    // Kalau baru saja logout/kena timeout sementara sedang di tab yang kini disembunyikan,
    // kembalikan ke tab "Program Umroh" supaya tidak nyangkut di halaman kosong.
    if (!loggedIn) {
        const activePanel = document.querySelector('.tab-panel.active');
        const loggedinOnlyIds = ['tab-info', 'tab-pendaftaran', 'tab-keberangkatan', 'tab-dokumen'];
        if (activePanel && loggedinOnlyIds.includes(activePanel.id)) {
            switchTab('umroh');
        }
    }
}

async function saveAdminProgram() {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengubah data program', 'error'); return; }
    const nama = document.getElementById('admin_nama')?.value.trim();
    if (!nama) { alert('Nama program wajib diisi!'); return; }
    if (!isValidProgramName(nama)) { alert('Nama program mengandung karakter tidak valid!'); return; }

    const formData = getAdminFormData();

    // Validate URLs
    const urlFields = ['link_poster', 'link_itinerary', 'link_metaads', 'link_dokumentasi'];
    for (const field of urlFields) {
        if (formData[field] && !isValidUrl(formData[field])) {
            alert(`Link ${field.replace('_',' ')} tidak valid!`);
            return;
        }
    }

    if (!formData.teks_wa) formData.teks_wa = generateAutoWAText(formData);

    // Pack admin-only fields
    const adminOnlyFields = ['harga_quad','harga_triple','harga_double','hotel_makkah','hotel_madinah','makan_makkah','makan_madinah','termasuk','tidak_termasuk','catatan_cx'];
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

        showToast(editingProgramId ? 'Program berhasil diperbarui' : 'Program berhasil ditambahkan');
        hideAdminForm(true);
        await loadDataFromSupabase(true);
        await renderAdminPanel();

        // Notifikasi Telegram otomatis (dinamis: hanya terkirim jika konfigurasi Telegram sudah diisi)
        sendTelegramNotif(formatTgProgram(formData, isEdit), 'program');

        // Crosscheck otomatis: kalau ada link poster, baca & bandingkan otomatis di background
        if (saveData.link_poster && savedRow && savedRow.id) {
            autoScanPosterForProgram(savedRow.id);
        }

    } catch (err) {
        console.error('Save program error:', err);
        showToast('Gagal menyimpan: ' + err.message, 'error');
    }
}

async function editAdminProgram(id) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengedit program', 'error'); return; }
    await ensureAdminProgramPageReady();
    const { data, error } = await supabaseClient.from('programs').select('*').eq('id', id).single();
    if (error || !data) { showToast('Program tidak ditemukan', 'error'); return; }

    const unpacked = unpackProgramAdminData(data);
    // Data lama: harga_quint sebenarnya dipakai sebagai harga Quad (tidak ada tipe kamar Quint)
    if (!unpacked.harga_quad && unpacked.harga_quint) unpacked.harga_quad = unpacked.harga_quint;

    setAdminFormData(unpacked);
    editingProgramId = id;
    document.getElementById('adminFormTitle').innerText = 'Edit Program';
    document.getElementById('adminFormContainer').style.display = 'block';
    document.getElementById('adminFormContainer').scrollIntoView({ behavior: 'smooth' });
    focusAdminFormAndSnapshot();
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

async function clearAllAdminData() {
    if (currentRole !== 'admin') { showToast('Halaman Admin hanya untuk Administrator', 'error'); return; }
    if (!confirm('PERINGATAN: Hapus SEMUA program?')) return;
    await ensureAutoSnapshot('auto-pre-clear', 'Auto sebelum Hapus Semua');
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
    const raw = document.getElementById('parseBroadcastInput').value.trim();
    if (!raw) { showToast('Paste teks broadcast dulu', 'error'); return; }

    const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
    const clean = s => s.replace(/^\*+|\*+$/g, '').trim();
    const cleanAll = s => s.replace(/\*/g, '').trim();

    // Nama: baris pertama bold *...*
    let nama = '';
    for (const l of lines) {
        if (/^\*.+\*$/.test(l)) { nama = clean(l); break; }
    }
    if (!nama) nama = clean(lines[0]);

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
    const BULAN = {
        januari: '01', februari: '02', maret: '03', april: '04',
        mei: '05', juni: '06', juli: '07', agustus: '08',
        september: '09', oktober: '10', november: '11', desember: '12'
    };
    for (const l of lines) {
        let m = l.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
        if (m) {
            const bln = BULAN[m[3].toLowerCase()];
            if (bln) { tglISO = m[4] + '-' + bln + '-' + m[2].padStart(2, '0'); break; }
        }
        m = l.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
        if (m) {
            const bln = BULAN[m[2].toLowerCase()];
            if (bln) { tglISO = m[3] + '-' + bln + '-' + m[1].padStart(2, '0'); break; }
        }
    }

    // Hotel
    let hotel_makkah = '', hotel_madinah = '';
    for (const l of lines) {
        const mMakkah = l.match(/hotel\s*m[ae]k+ah[^:]*[:\-]\s*(.+)/i);
        if (mMakkah && !hotel_makkah) { hotel_makkah = cleanAll(mMakkah[2]); }
        const mMadinah = l.match(/hotel\s*mad[iy]nah[^:]*[:\-]\s*(.+)/i);
        if (mMadinah && !hotel_madinah) { hotel_madinah = cleanAll(mMadinah[2]); }
    }

    // Termasuk & Tidak Termasuk
    let termasuk = [], tidak_termasuk = [];
    let mode = null;
    for (const l of lines) {
        const lc = cleanAll(l).toLowerCase();
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
    setVal('admin_hotel_makkah', hotel_makkah);
    setVal('admin_hotel_madinah', hotel_madinah);
    if (termasuk.length) setVal('admin_termasuk', termasuk.join('\n'));
    if (tidak_termasuk.length) setVal('admin_tidak_termasuk', tidak_termasuk.join('\n'));

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
        nama, durasi, maskapai, harga_quad, harga_triple, harga_double, harga_quint,
        hotel_makkah, hotel_madinah,
        termasuk: termasuk.join('\n'),
        tidak_termasuk: tidak_termasuk.join('\n')
    };
    document.getElementById('admin_teks_wa').value = generateAutoWAText(parsedData);

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
    if (tglISO) parts.push('Tanggal');
    if (termasuk.length) parts.push('Fasilitas (' + termasuk.length + ' item)');

    const status = document.getElementById('parseStatus');
    status.textContent = '✓ Terisi: ' + parts.join(', ');
    status.style.display = 'inline';
    setTimeout(() => status.style.display = 'none', 6000);
    showToast('Form berhasil diisi otomatis (' + parts.length + ' field)');
}

// ============================================================
// 16. EXPORT / IMPORT
// ============================================================
async function exportAdminData() {
    showToast('Menyiapkan backup...');
    try {
        const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY };
        const res = await fetch(`${SUPABASE_URL}/rest/v1/programs?select=*&order=created_at.asc`, { headers });
        const backup = {
            _meta: { app: 'Dashboard Amiru', exported_at: new Date().toISOString(), version: '2.0' },
            programs: res.ok ? await res.json() : []
        };
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

// Import satu batch program, kembalikan {ok, failed:[{nama,reason}]}
async function importProgramList(list) {
    let ok = 0;
    const failed = [];
    for (const progRaw of list) {
        const prog = { ...progRaw };
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

function showImportResult(ok, failed) {
    if (!failed.length) {
        showToast(`Import selesai — ${ok} program`);
        return;
    }
    const list = failed.map(f => `• ${f.nama} — ${f.reason}`).join('\n');
    showToast(`Import selesai — ${ok} berhasil, ${failed.length} gagal`, 'error');
    alert(`Berikut program yang GAGAL diimport (${failed.length}):\n\n${list}`);
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
                if (imported && imported._meta && imported.programs) {
                    if (!confirm(`Restore backup dari ${new Date(imported._meta.exported_at).toLocaleString('id-ID')}?\n\n• ${imported.programs.length} program\n\nData yang ada TIDAK akan dihapus, hanya ditambah/diperbarui.`)) return;
                    await ensureAutoSnapshot('auto-pre-import', 'Auto sebelum Import');
                    showToast('Mengimport data...');
                    const { ok, failed } = await importProgramList(imported.programs);
                    await loadDataFromSupabase(true);
                    await renderAdminPanel();
                    showImportResult(ok, failed);
                } else if (Array.isArray(imported)) {
                    if (!confirm(`Import ${imported.length} program?`)) return;
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
async function collectAllUmrohData() {
    const data = {};
    for (const tbl of SNAPSHOT_TABLES) {
        try {
            const { data: rows, error } = await withRetry(
                () => supabaseClient.from(tbl).select('*'),
                { label: 'Snapshot: muat ' + tbl }
            );
            data[tbl] = error ? [] : (rows || []);
        } catch (err) {
            console.error('collectAllUmrohData error on', tbl, err);
            data[tbl] = [];
        }
    }
    return data;
}

async function takeSnapshot(label = 'Snapshot', trigger = 'manual') {
    try {
        showToast('Membuat snapshot...', 'info');
        const payload = await collectAllUmrohData();
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

// Ambil snapshot otomatis sebelum tindakan berisiko. Best-effort: gagal pun tindakan tetap lanjut.
async function ensureAutoSnapshot(trigger, label) {
    const ok = await takeSnapshot(label || ('Auto: ' + trigger), trigger);
    if (!ok) console.warn('Auto-snapshot gagal, tindakan berisiko tetap dilanjutkan.');
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
    if (!confirm('Pulihkan data dari snapshot ini?\n\nSemua tabel (program, jamaah, jadwal, pendaftaran, pembayaran, unggulan) akan di-update/insert dari snapshot. Baris yang ada di DB tapi tidak ada di snapshot TIDAK dihapus.\n\nLanjutkan?')) return;
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

function renderSnapshotAdminTable() {
    const wrap = document.getElementById('snapshotTableWrap');
    if (!wrap) return;
    wrap.innerHTML = '<div style="text-align:center;padding:18px;color:var(--ink-soft);font-size:12px;"><i class="fa-solid fa-spinner fa-spin"></i> Memuat...</div>';
    listSnapshots().then(rows => {
        const pct = Math.min(100, Math.round((rows.length / MAX_SNAPSHOTS) * 100));

        if (!rows.length) {
            wrap.innerHTML = `
                <div class="snap-progress-wrap"><div class="snap-progress-track"><div class="snap-progress-fill" style="width:0%;"></div></div><span class="snap-progress-label">0/${MAX_SNAPSHOTS}</span></div>
                <div class="snap-empty"><i class="fa-solid fa-camera-retro"></i><span>Belum ada snapshot. Klik <b>Ambil</b> untuk cadangan pertama.</span></div>`;
            return;
        }

        const itemsHtml = rows.map(r => {
            const d = new Date(r.created_at);
            const tstr = isNaN(d) ? '-' : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            const total = (r.meta && r.meta.total_rows != null) ? r.meta.total_rows : '-';
            const trig = SNAPSHOT_TRIGGER_LABEL[r.trigger] || { text: r.trigger || 'manual', color: '#64758A', tint: '#F4F7FB' };
            return `
            <div class="snap-row">
                <span class="snap-dot" style="background:${trig.color};" title="${escapeHtml(trig.text)}"></span>
                <span class="snap-row-label" title="${escapeHtml(r.label || 'Snapshot')}">${escapeHtml(r.label || 'Snapshot')}</span>
                <span class="snap-row-meta">${tstr} · ${total} baris</span>
                <button class="btn-icon-ghost btn-xs" title="Pulihkan snapshot ini" onclick="restoreSnapshot('${r.id}')"><i class="fa-solid fa-rotate-left"></i></button>
            </div>`;
        }).join('');

        wrap.innerHTML = `
            <div class="snap-progress-wrap"><div class="snap-progress-track"><div class="snap-progress-fill" style="width:${pct}%;"></div></div><span class="snap-progress-label">${rows.length}/${MAX_SNAPSHOTS}</span></div>
            <div class="snap-list">${itemsHtml}</div>`;
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
function openDeleteModal(table, id, name) {
    if (table === 'programs') {
        const jumlahJamaah = (kbJamaahList || []).filter(j => String(j.program_id) === String(id)).length;
        if (jumlahJamaah > 0) {
            showToast(`Tidak bisa hapus "${name}" — masih ada ${jumlahJamaah} jamaah terdaftar di program ini. Pindahkan atau hapus dulu data jamaahnya.`, 'error');
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
    document.getElementById('deleteConfirmModal').classList.add('open');
}

function onDeleteConfirmInput() {
    const input = document.getElementById('deleteConfirmInput').value.trim();
    document.getElementById('deleteConfirmBtn').disabled = input !== deleteTarget.name;
}

async function confirmDeleteAction() {
    if (!deleteTarget.id || !deleteTarget.table) return;
    if (deleteTarget.table === 'programs' && !canManageProgramData()) {
        showToast('Akun Anda tidak punya izin untuk menghapus program', 'error');
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
        const result = await supabaseClient.from(finishedTable).delete().eq('id', finishedId);
        if (result.error) throw result.error;

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
        } else if (finishedTable === 'kb_jamaah') {
            await loadKbJamaah();
            renderKbProgramSelector();
            renderDokProgramSelector();
            updateMetrics();
        } else if (finishedTable === 'pembayaran_jamaah') {
            // Ambil data cicilan dari DB langsung (bukan cuma cache) supaya nilai
            // yang dicatat ke audit akurat, lalu catat jejak penghapusan.
            try {
                const { data: cicRow } = await supabaseClient
                    .from('pembayaran_jamaah').select('jumlah, tanggal, metode').eq('id', finishedId).single();
                if (cicRow) {
                    await logNotaAudit({
                        jenis: 'hapus',
                        nomorNotaValue: `HAPUS/${nomorNota(cicRow)}`,
                        jamaahId: cicilanJamaahId,
                        jamaahNama: cicilanJamaahInfo?.nama,
                        programNama: cicilanProgramInfo?.nama,
                        jumlah: Number(cicRow.jumlah || 0),
                        metadata: { cicilanId: finishedId, tanggal: cicRow.tanggal, metode: cicRow.metode }
                    });
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

    let html = `<button ${jfCurrentPage === 1 ? 'disabled' : ''} onclick="goToJfPage(${jfCurrentPage - 1})" title="Sebelumnya"><i class="fa-solid fa-chevron-left"></i></button>`;
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || Math.abs(i - jfCurrentPage) <= 1) pages.push(i);
        else if (pages[pages.length - 1] !== '...') pages.push('...');
    }
    pages.forEach(p => {
        if (p === '...') html += `<span class="pf-page-ellipsis">…</span>`;
        else html += `<button class="${p === jfCurrentPage ? 'active' : ''}" onclick="goToJfPage(${p})">${p}</button>`;
    });
    html += `<button ${jfCurrentPage === totalPages ? 'disabled' : ''} onclick="goToJfPage(${jfCurrentPage + 1})" title="Berikutnya"><i class="fa-solid fa-chevron-right"></i></button>`;
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
        tbody.innerHTML = `<tr><td colspan="8"><div class="pf-empty"><i class="fa-solid fa-calendar-xmark"></i>Belum ada jadwal tamu. Klik "Tambah Jadwal" untuk menambahkan.</div></td></tr>`;
        renderJfPagination(0);
    } else if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="pf-empty"><i class="fa-solid fa-magnifying-glass"></i>Tidak ada jadwal yang cocok dengan pencarian/filter.</div></td></tr>`;
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
                        ${j.wa ? `<a href="https://wa.me/${j.wa.replace(/\D/g,'')}?text=Assalamualaikum%20${encodeURIComponent(j.nama||'')}%20kami%20dari%20PT%20Amiru%20Haramain%20Indonesia" target="_blank" class="pf-btn-wa" title="Hubungi via WhatsApp"><i class="fab fa-whatsapp"></i></a>` : ''}
                        <button type="button" class="pf-btn-edit" onclick="openJadwalModal('${j.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
                        <button type="button" class="pf-btn-delete" onclick="openDeleteModal('jadwal_tamu', '${j.id}', '${escapeJsAttr(j.nama)}')" title="Hapus"><i class="fa-solid fa-trash"></i></button>
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
        if (pfStatusFilterVal && (p.status || 'baru') !== pfStatusFilterVal) return false;
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

    let html = `<button ${pfCurrentPage === 1 ? 'disabled' : ''} onclick="goToPfPage(${pfCurrentPage - 1})" title="Sebelumnya"><i class="fa-solid fa-chevron-left"></i></button>`;
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || Math.abs(i - pfCurrentPage) <= 1) pages.push(i);
        else if (pages[pages.length - 1] !== '...') pages.push('...');
    }
    pages.forEach(p => {
        if (p === '...') html += `<span class="pf-page-ellipsis">…</span>`;
        else html += `<button class="${p === pfCurrentPage ? 'active' : ''}" onclick="goToPfPage(${p})">${p}</button>`;
    });
    html += `<button ${pfCurrentPage === totalPages ? 'disabled' : ''} onclick="goToPfPage(${pfCurrentPage + 1})" title="Berikutnya"><i class="fa-solid fa-chevron-right"></i></button>`;
    el.innerHTML = html;
}

function renderPendaftaranSection() {
    const tbody = document.getElementById('pendaftaranTableBody');
    const countEl = document.getElementById('pfCount');
    if (!tbody) return;

    const filtered = getFilteredPendaftaran();
    if (countEl) countEl.textContent = `${filtered.length} dari ${pendaftaranList.length} pendaftaran`;

    if (!pendaftaranList.length) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="pf-empty"><i class="fa-solid fa-clipboard-list"></i>Belum ada pendaftaran. Klik "Tambah Pendaftaran" untuk menambahkan.</div></td></tr>`;
        renderPfPagination(0);
        return;
    }
    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="pf-empty"><i class="fa-solid fa-magnifying-glass"></i>Tidak ada pendaftaran yang cocok dengan pencarian/filter.</div></td></tr>`;
        renderPfPagination(0);
        return;
    }

    const statusMap = {
        baru: { label: 'Baru', icon: 'fa-circle-plus' },
        dihubungi: { label: 'Dihubungi', icon: 'fa-arrows-rotate' },
        deal: { label: 'Deal', icon: 'fa-circle-check' },
        batal: { label: 'Batal', icon: 'fa-circle-xmark' }
    };

    const totalPages = Math.max(1, Math.ceil(filtered.length / PF_PAGE_SIZE));
    if (pfCurrentPage > totalPages) pfCurrentPage = totalPages;
    const start = (pfCurrentPage - 1) * PF_PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PF_PAGE_SIZE);

    tbody.innerHTML = pageItems.map(p => {
        const program = dataUmroh.find(x => String(x.id) === String(p.program_id));
        const stKey = p.status || 'baru';
        const st = statusMap[stKey] || statusMap.baru;
        return `<tr class="status-${stKey}">
            <td><span class="pf-name">${escapeHtml(p.nama || '-')}</span></td>
            <td>${escapeHtml(program ? program.nama : 'Belum ditentukan')}</td>
            <td>${p.tanggal_daftar ? escapeHtml(p.tanggal_daftar) : (p.created_at ? escapeHtml(String(p.created_at).slice(0, 10)) : '-')}</td>
            <td>${escapeHtml(p.asal || '-')}</td>
            <td>${p.wa ? escapeHtml(p.wa) : '-'}</td>
            <td><span class="pf-status-pill ${stKey}"><i class="fa-solid ${st.icon}"></i> ${st.label}</span></td>
            <td>
                <div class="pf-actions">
                    ${p.wa ? `<a href="https://wa.me/${p.wa.replace(/\D/g,'')}?text=Assalamualaikum%20${encodeURIComponent(p.nama||'')}%20kami%20dari%20PT%20Amiru%20Haramain%20Indonesia" target="_blank" class="pf-btn-wa" title="Hubungi via WhatsApp"><i class="fab fa-whatsapp"></i></a>` : ''}
                    <button type="button" class="pf-btn-edit" onclick="openPendaftaranModal('${p.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button type="button" class="pf-btn-delete" onclick="openDeleteModal('pendaftaran', '${p.id}', '${escapeJsAttr(p.nama)}')" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');

    renderPfPagination(filtered.length);
}

function openPendaftaranModal(id = null) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk menambah pendaftaran', 'error'); return; }
    const modal = document.getElementById('pendaftaranModal');
    const form = document.getElementById('pendaftaranForm');
    form.reset();
    document.getElementById('p_editId').value = '';

    const programSelect = document.getElementById('pf_program');
    programSelect.innerHTML = '<option value="">-- Belum Ditentukan --</option>' +
        (dataUmroh || []).map(prog => `<option value="${prog.id}">${escapeHtml(prog.nama)}</option>`).join('');

    if (id) {
        const p = pendaftaranList.find(item => item.id === id);
        if (!p) { showToast('Data tidak ditemukan', 'error'); return; }
        document.getElementById('pendaftaranModalTitle').textContent = 'Edit Pendaftaran';
        document.getElementById('p_editId').value = p.id;
        document.getElementById('pf_tanggal').value = p.tanggal_daftar || '';
        document.getElementById('pf_nama').value = p.nama || '';
        document.getElementById('pf_program').value = p.program_id || '';
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
        document.getElementById('pf_status').value = p.status || 'baru';
        document.getElementById('pf_catatan').value = p.catatan || '';
    } else {
        document.getElementById('pendaftaranModalTitle').textContent = 'Tambah Pendaftaran';
        document.getElementById('pf_tanggal').value = new Date().toISOString().slice(0, 10);
        document.getElementById('pf_status').value = 'baru';
    }

    modal.classList.add('open');
}

function closePendaftaranModal() {
    document.getElementById('pendaftaranModal').classList.remove('open');
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

    try {
        let result;
        if (id) {
            result = await supabaseClient.from('pendaftaran').update(data).eq('id', id);
        } else {
            result = await supabaseClient.from('pendaftaran').insert([data]);
        }
        if (result.error) throw result.error;

        showToast(id ? 'Pendaftaran berhasil diperbarui' : 'Pendaftaran berhasil ditambahkan');
        closePendaftaranModal();
        await loadPendaftaran();
        renderPendaftaranSection();

    } catch (err) {
        console.error('Save pendaftaran error:', err);
        showToast('Gagal menyimpan: ' + err.message, 'error');
    }
}

// ============================================================
// 19. KEBERANGKATAN (CRUD)
// ============================================================
async function loadKbJamaah() {
    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('kb_jamaah').select('*').order('nama', { ascending: true }),
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
        container.innerHTML = `<div class="kb-no-program"><i class="fa-solid fa-plane-departure"></i><p>Pilih program di atas untuk melihat daftar jamaah.</p></div>`;
        return;
    }

    const program = dataUmroh.find(p => String(p.id) === String(programId));
    const hargaProgram = parseRupiahToNumber(program ? program.harga_quint : 0);
    const canEdit = canManageProgramData();

    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('kb_jamaah').select('*').eq('program_id', programId).order('nama', { ascending: true }),
            { label: 'Muat data jamaah' }
        );
        if (error) throw error;

        const jamaah = data || [];
        if (!jamaah.length) {
            container.innerHTML = `<div class="kb-no-program"><i class="fa-solid fa-user-slash"></i><p>Belum ada jamaah terdaftar untuk program ini.</p></div>`;
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

        let grandTotalTagihan = 0, grandTotalDibayar = 0;

        const rows = jamaah.map(j => {
            const dibayar = totalPerJamaah[j.id] || 0;
            const sisa = Math.max(hargaProgram - dibayar, 0);
            const pct = hargaProgram > 0 ? Math.min(100, Math.round((dibayar / hargaProgram) * 100)) : 0;
            grandTotalTagihan += hargaProgram;
            grandTotalDibayar += dibayar;

            let statusLabel, statusClass;
            if (hargaProgram > 0 && dibayar >= hargaProgram) { statusLabel = '<i class="fa-solid fa-circle-check"></i> Lunas'; statusClass = 'available'; }
            else if (dibayar > 0) { statusLabel = '<i class="fa-solid fa-arrows-rotate"></i> Cicilan'; statusClass = 'limited'; }
            else { statusLabel = '<i class="fa-solid fa-hourglass-half"></i> Belum Bayar'; statusClass = 'full'; }

            return `
                <tr style="border-bottom:1px solid var(--line);">
                    <td style="padding:10px 14px;"><strong>${escapeHtml(j.nama)}</strong>${j.asal ? `<br><span style="font-size:11px;color:var(--ink-soft);">${escapeHtml(j.asal)}</span>` : ''}</td>
                    <td style="padding:10px 14px;">${j.nik || '-'}</td>
                    <td style="padding:10px 14px;">${j.paspor || '-'}</td>
                    <td style="padding:10px 14px;white-space:nowrap;">${formatRupiah(hargaProgram)}</td>
                    <td style="padding:10px 14px;white-space:nowrap;color:var(--success);font-weight:600;">${formatRupiah(dibayar)}</td>
                    <td style="padding:10px 14px;white-space:nowrap;color:${sisa > 0 ? 'var(--danger)' : 'var(--ink-soft)'};font-weight:600;">${formatRupiah(sisa)}</td>
                    <td style="padding:10px 14px;min-width:110px;">
                        <div style="background:var(--line);border-radius:6px;height:8px;overflow:hidden;">
                            <div style="background:var(--brand);height:100%;width:${pct}%;"></div>
                        </div>
                        <span style="font-size:10px;color:var(--ink-soft);">${pct}%</span>
                    </td>
                    <td style="padding:10px 14px;"><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                    <td style="padding:10px 14px;white-space:nowrap;">
                        <div class="row-actions">
                            <button class="btn-primary btn-pay" style="font-size:11px;padding:5px 10px;" onclick="openCicilanModal('${j.id}')">
                                <i class="fa-solid fa-money-bill-wave"></i> Bayar
                            </button>
                            ${canEdit ? `
                            <span class="row-actions-sep"></span>
                            <button type="button" class="row-icon-btn" onclick="openKbModal('${j.id}')" style="background:var(--brand-tint);color:var(--brand);" title="Edit data jamaah"><i class="fa-solid fa-pen"></i></button>
                            <button type="button" class="row-icon-btn" onclick="openDeleteModal('kb_jamaah', '${j.id}', '${escapeJsAttr(j.nama)}')" style="background:var(--danger-tint);color:var(--danger);" title="Hapus data jamaah"><i class="fa-solid fa-trash"></i></button>
                            ` : ''}
                        </div>
                    </td>
                </tr>`;
        }).join('');

        const grandSisa = Math.max(grandTotalTagihan - grandTotalDibayar, 0);
        const totalLunas = jamaah.filter(j => hargaProgram > 0 && (totalPerJamaah[j.id] || 0) >= hargaProgram).length;

        container.innerHTML = `
            <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
                <span class="status-badge available">${jamaah.length} Total Jamaah</span>
                <span class="status-badge available">${totalLunas} Lunas</span>
                <span class="status-badge available">Total Dibayar: ${formatRupiah(grandTotalDibayar)}</span>
                <span class="status-badge ${grandSisa > 0 ? 'full' : 'available'}">Sisa Tagihan: ${formatRupiah(grandSisa)}</span>
            </div>
            ${!hargaProgram ? `<div style="font-size:12px;color:var(--warn);margin-bottom:10px;"><i class="fa-solid fa-triangle-exclamation"></i> Harga program ini belum diisi, sisa tagihan tidak bisa dihitung akurat.</div>` : ''}
            <div class="table-container" style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead style="background:var(--bg);">
                        <tr>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Nama</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">NIK</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Paspor</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Harga Program</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Dibayar</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Sisa</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Progress</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Status</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Aksi</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;

    } catch (err) {
        console.error('Load jamaah error:', err);
        container.innerHTML = `<div class="kb-no-program" style="color:var(--danger);">
            <i class="fa-solid fa-circle-exclamation"></i>
            <p>Gagal memuat data: ${err.message}</p>
        </div>`;
    }
}

function openKbModal(id = null) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk menambah data jamaah', 'error'); return; }
    const modal = document.getElementById('kbModal');
    const form = document.getElementById('kbForm');
    form.reset();
    document.getElementById('kb_editId').value = '';
    document.getElementById('kb_pendaftaran_source').value = '';

    // Jaga-jaga: pastikan dropdown program di modal sudah terisi (mis. kalau
    // modal ini dibuka sebelum data program sempat dimuat / sinkron ulang).
    renderKbProgramSelector();

    // Pre-select program from selector
    const programSelect = document.getElementById('kbProgramSelect');
    const modalProgramSelect = document.getElementById('kb_program');
    if (programSelect.value) {
        modalProgramSelect.value = programSelect.value;
    }

    const fromPendaftaranBox = document.getElementById('kbFromPendaftaranBox');

    if (id) {
        const j = kbJamaahList.find(item => item.id === id);
        if (!j) { showToast('Data tidak ditemukan', 'error'); return; }
        fromPendaftaranBox.style.display = 'none';
        document.getElementById('kbModalTitle').textContent = 'Edit Data Jamaah';
        document.getElementById('kb_editId').value = j.id;
        document.getElementById('kb_program').value = j.program_id || '';
        document.getElementById('kb_nama').value = j.nama || '';
        document.getElementById('kb_nik').value = j.nik || '';
        document.getElementById('kb_paspor').value = j.paspor || '';
        document.getElementById('kb_wa').value = j.wa || '';
        document.getElementById('kb_asal').value = j.asal || '';
        document.getElementById('kb_status').value = j.status || 'pending';
        document.getElementById('kb_catatan').value = j.catatan || '';
    } else {
        document.getElementById('kbModalTitle').textContent = 'Tambah Data Jamaah';
        document.getElementById('kb_status').value = 'pending';
        renderKbPendaftaranOptions();
        fromPendaftaranBox.style.display = '';
    }

    modal.classList.add('open');
}

// Isi dropdown "Ambil dari Form Pendaftaran" dengan daftar calon jamaah yang
// sudah masuk lewat menu Form Pendaftaran, supaya tidak perlu ketik ulang.
function renderKbPendaftaranOptions() {
    const sel = document.getElementById('kb_from_pendaftaran');
    if (!sel) return;
    sel.value = '';
    if (!pendaftaranList || !pendaftaranList.length) {
        sel.innerHTML = '<option value="">-- Belum ada data pendaftaran --</option>';
        return;
    }
    const statusLabel = { baru: 'Baru', dihubungi: 'Dihubungi', deal: 'Deal', batal: 'Batal' };
    const sorted = [...pendaftaranList].sort((a, b) => {
        // Prioritaskan yang sudah "deal" supaya lebih cepat ditemukan
        if ((a.status === 'deal') !== (b.status === 'deal')) return a.status === 'deal' ? -1 : 1;
        return (a.nama || '').localeCompare(b.nama || '');
    });
    sel.innerHTML = '<option value="">-- Pilih calon jamaah dari Pendaftaran --</option>' +
        sorted.map(p => {
            const program = dataUmroh.find(x => String(x.id) === String(p.program_id));
            const progName = program ? program.nama : 'Belum ditentukan program';
            const st = statusLabel[p.status] || 'Baru';
            return `<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.nama || '-')} — ${escapeHtml(progName)} (${st})</option>`;
        }).join('');
}

// Salin data dari record Pendaftaran terpilih ke form Tambah Data Jamaah.
function fillKbFromPendaftaran(pendaftaranId) {
    if (!pendaftaranId) return;
    const p = pendaftaranList.find(item => String(item.id) === String(pendaftaranId));
    if (!p) { showToast('Data pendaftaran tidak ditemukan', 'error'); return; }

    if (p.program_id) document.getElementById('kb_program').value = p.program_id;
    document.getElementById('kb_nama').value = p.nama || '';
    document.getElementById('kb_nik').value = p.ktp || '';
    document.getElementById('kb_wa').value = p.wa || '';
    document.getElementById('kb_asal').value = p.asal || '';
    if (p.catatan) document.getElementById('kb_catatan').value = p.catatan;
    document.getElementById('kb_pendaftaran_source').value = p.id;

    showToast('Data diisi dari pendaftaran "' + (p.nama || '') + '" — lengkapi No. Paspor & status pembayaran lalu Simpan');
}

function closeKbModal() {
    document.getElementById('kbModal').classList.remove('open');
}

async function saveKbJamaah(e) {
    e.preventDefault();
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk menyimpan data jamaah', 'error'); return; }
    const id = document.getElementById('kb_editId').value;
    const data = {
        program_id: document.getElementById('kb_program').value,
        nama: document.getElementById('kb_nama').value.trim(),
        nik: document.getElementById('kb_nik').value.trim(),
        paspor: document.getElementById('kb_paspor').value.trim(),
        wa: document.getElementById('kb_wa').value.trim(),
        asal: document.getElementById('kb_asal').value.trim(),
        status: document.getElementById('kb_status').value,
        catatan: document.getElementById('kb_catatan').value.trim()
    };

    if (!data.program_id) { showToast('Silakan pilih program terlebih dahulu', 'error'); return; }
    if (!data.nama) { showToast('Nama jamaah wajib diisi', 'error'); return; }

    const pendaftaranSourceId = document.getElementById('kb_pendaftaran_source').value;

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

        showToast(id ? 'Data jamaah berhasil diperbarui' : 'Data jamaah berhasil ditambahkan');
        closeKbModal();
        await loadKbJamaah();
        renderKbProgramSelector();
        updateMetrics();

    } catch (err) {
        console.error('Save keberangkatan error:', err);
        showToast('Gagal menyimpan: ' + err.message, 'error');
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
    modal.classList.add('open');
    await loadCicilanHistory(jamaahId);
}

function closeCicilanModal() {
    document.getElementById('cicilanModal').classList.remove('open');
    hideNotaPreviewPanel();
    cicilanJamaahId = null;
    cicilanJamaahInfo = null;
    cicilanProgramInfo = null;
    cicilanHargaProgram = 0;
}

async function loadCicilanHistory(jamaahId) {
    try {
        const { data: jamaahRow, error: jErr } = await withRetry(
            () => supabaseClient.from('kb_jamaah').select('*').eq('id', jamaahId).single(),
            { label: 'Muat data jamaah' }
        );
        if (jErr) throw jErr;

        const program = dataUmroh.find(p => String(p.id) === String(jamaahRow.program_id));
        const hargaProgram = parseRupiahToNumber(program ? program.harga_quint : 0);
        cicilanJamaahInfo = jamaahRow;
        cicilanProgramInfo = program || null;
        cicilanHargaProgram = hargaProgram;

        const { data, error } = await withRetry(
            () => supabaseClient.from('pembayaran_jamaah').select('*').eq('jamaah_id', jamaahId).order('tanggal', { ascending: false }),
            { label: 'Muat riwayat cicilan' }
        );
        if (error) throw error;
        cicilanList = data || [];

        document.getElementById('cicilanModalTitle').textContent = 'Kelola Cicilan — ' + (jamaahRow.nama || '');

        const totalDibayar = cicilanList.reduce((sum, c) => sum + Number(c.jumlah || 0), 0);
        const sisa = Math.max(hargaProgram - totalDibayar, 0);
        const isLunas = hargaProgram > 0 && sisa <= 0;
        const pct = hargaProgram > 0 ? Math.min(100, Math.round((totalDibayar / hargaProgram) * 100)) : 0;
        document.getElementById('cicilanRingkasan').innerHTML = `
            <div class="cicilan-summary-card${isLunas ? ' is-lunas' : ''}">
                <div class="cicilan-summary-top">
                    <div>
                        <div class="cicilan-summary-label">${isLunas ? 'Status Pembayaran' : 'Sisa Tagihan'}</div>
                        <div class="cicilan-summary-sisa">${isLunas ? 'Lunas' : formatRupiah(sisa)}</div>
                    </div>
                    ${isLunas
                        ? `<span class="cicilan-summary-lunas-badge"><i class="fa-solid fa-circle-check"></i> Lunas</span>`
                        : `<span class="cicilan-summary-pct-badge">${pct}% terbayar</span>`}
                </div>
                <div class="cicilan-progress-track"><div class="cicilan-progress-fill" style="width:${pct}%;"></div></div>
                <div class="cicilan-summary-foot">
                    <span>Harga Program <b>${formatRupiah(hargaProgram)}</b></span>
                    <span>Total Dibayar <b>${formatRupiah(totalDibayar)}</b></span>
                </div>
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
        listEl.innerHTML = `<div class="cicilan-history-empty"><i class="fa-solid fa-receipt"></i><p>Belum ada pembayaran tercatat.</p></div>`;
        return;
    }
    listEl.innerHTML = cicilanList.map(c => {
        const metodeClass = c.metode === 'Cash' ? 'cash' : (c.metode === 'Transfer' ? '' : 'lainnya');
        return `
        <div class="cicilan-history-item">
            <div>
                <span class="cicilan-history-amount">${formatRupiah(Number(c.jumlah || 0))}</span>
                ${c.metode ? `<span class="cicilan-history-badge ${metodeClass}">${escapeHtml(c.metode)}</span>` : ''}
                <div class="cicilan-history-meta">${escapeHtml(c.tanggal || '-')}${c.keterangan ? ' · ' + escapeHtml(c.keterangan) : ''}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                <button type="button" class="cicilan-nota-btn" onclick="previewNotaPembayaran('${c.id}', this)" title="Preview lalu unduh nota bukti pembayaran (JPEG)">
                    <i class="fa-solid fa-file-image"></i>
                </button>
                <button type="button" class="cicilan-delete-btn" onclick="deleteCicilan('${c.id}')" title="Hapus pembayaran ini">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}

// ============================================================
// 19B2. MENU "PEMBAYARAN" (admin) — daftar pembayaran seluruh jamaah dari
// semua program dalam satu tabel, terpisah dari tab Keberangkatan yang
// per-program. Pakai ulang modal Kelola Cicilan (openCicilanModal) yang sama.
// ============================================================
// Card detail total pemasukan (hero) + rincian pemasukan per program umroh.
// `jamaahAll` = seluruh jamaah (semua program), `totalPerJamaah` = map jamaah_id -> total dibayar.
function renderPembayaranIncomeSummary(jamaahAll, totalPerJamaah) {
    const heroEl = document.getElementById('pbIncomeHero');
    const gridEl = document.getElementById('pbIncomeBreakdown');
    const countEl = document.getElementById('pbBreakdownCount');
    if (!heroEl || !gridEl) return;

    // Kelompokkan per program
    const byProgram = {};
    jamaahAll.forEach(j => {
        const pid = j.program_id != null ? String(j.program_id) : '_tanpa_program';
        if (!byProgram[pid]) {
            const program = dataUmroh.find(p => String(p.id) === pid);
            byProgram[pid] = {
                nama: program ? program.nama : 'Tanpa Program',
                tanggal: program ? program.tanggal_berangkat : null,
                harga: parseRupiahToNumber(program ? program.harga_quint : 0),
                jamaahCount: 0,
                tagihan: 0,
                dibayar: 0
            };
        }
        const g = byProgram[pid];
        g.jamaahCount += 1;
        g.tagihan += g.harga;
        g.dibayar += totalPerJamaah[j.id] || 0;
    });

    const programRows = Object.values(byProgram).map(g => {
        g.sisa = Math.max(g.tagihan - g.dibayar, 0);
        g.pct = g.tagihan > 0 ? Math.min(100, Math.round((g.dibayar / g.tagihan) * 100)) : 0;
        return g;
    }).sort((a, b) => b.dibayar - a.dibayar); // program dengan pemasukan terbesar di atas

    const grandTagihan = programRows.reduce((s, g) => s + g.tagihan, 0);
    const grandDibayar = programRows.reduce((s, g) => s + g.dibayar, 0);
    const grandSisa = Math.max(grandTagihan - grandDibayar, 0);
    const grandPct = grandTagihan > 0 ? Math.min(100, Math.round((grandDibayar / grandTagihan) * 100)) : 0;
    const totalJamaah = programRows.reduce((s, g) => s + g.jamaahCount, 0);

    // ---- Kartu hero: total pemasukan ----
    heroEl.innerHTML = `
        <div class="pb-hero-top">
            <div>
                <div class="pb-hero-label"><i class="fa-solid fa-sack-dollar"></i> Total Pemasukan Terkumpul</div>
                <div class="pb-hero-amount">${formatRupiah(grandDibayar)}</div>
            </div>
            <div class="pb-hero-pct-badge">${grandPct}% dari target</div>
        </div>
        <div class="pb-hero-progress-track"><div class="pb-hero-progress-fill" style="width:${grandPct}%;"></div></div>
        <div class="pb-hero-foot">
            <span><b>${formatRupiah(grandTagihan)}</b>Total Tagihan</span>
            <span><b>${formatRupiah(grandSisa)}</b>Sisa Belum Terbayar</span>
            <span><b>${totalJamaah}</b>Jamaah</span>
            <span><b>${programRows.length}</b>Program Berjalan</span>
        </div>
    `;

    // ---- Rincian per program ----
    if (countEl) countEl.textContent = `${programRows.length} program`;
    if (!programRows.length) {
        gridEl.innerHTML = `<div class="pb-income-empty">Belum ada data pemasukan.</div>`;
        return;
    }
    gridEl.innerHTML = programRows.map(g => `
        <div class="pb-income-card">
            <div class="pb-income-card-head">
                <span class="pb-income-card-name" title="${escapeHtml(g.nama)}">${escapeHtml(g.nama)}</span>
                <span class="pb-income-card-jamaah"><i class="fa-solid fa-user-group"></i> ${g.jamaahCount}</span>
            </div>
            <div class="pb-income-card-amount">${formatRupiah(g.dibayar)}</div>
            <div class="pb-income-card-track"><div class="pb-income-card-fill" style="width:${g.pct}%;"></div></div>
            <div class="pb-income-card-foot">
                <span>Tagihan <b>${formatRupiah(g.tagihan)}</b></span>
                <span>Sisa <b style="color:${g.sisa > 0 ? 'var(--danger)' : 'var(--ink-soft)'};">${formatRupiah(g.sisa)}</b></span>
            </div>
        </div>
    `).join('');
}

async function renderPembayaranPanel() {
    const tbody = document.getElementById('pbTableBody');
    if (!tbody) return; // panel belum/tidak sedang dibuka

    // Isi dropdown filter program (sekali saja, pertahankan pilihan yang sedang aktif)
    const progSelect = document.getElementById('pbFilterProgram');
    if (progSelect && progSelect.options.length <= 1) {
        progSelect.innerHTML = '<option value="">Semua Program</option>' +
            (dataUmroh || []).map(p => `<option value="${p.id}">${escapeHtml(p.nama)}</option>`).join('');
    }

    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--ink-soft);">Memuat...</td></tr>`;

    try {
        // Selalu ambil data jamaah terbaru supaya sinkron dengan perubahan di tab Keberangkatan
        await loadKbJamaah();

        const jamaahAll = kbJamaahList || [];
        if (!jamaahAll.length) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--ink-soft);">Belum ada data jamaah.</td></tr>`;
            document.getElementById('pbStatsBar').innerHTML = '';
            document.getElementById('pbCount').textContent = '0 jamaah';
            document.getElementById('pbIncomeHero').innerHTML = '';
            document.getElementById('pbIncomeBreakdown').innerHTML = '';
            document.getElementById('pbBreakdownCount').textContent = '0 program';
            return;
        }

        const jamaahIds = jamaahAll.map(j => j.id);
        const { data: bayarData, error: bErr } = await withRetry(
            () => supabaseClient.from('pembayaran_jamaah').select('jamaah_id, jumlah').in('jamaah_id', jamaahIds),
            { label: 'Muat data pembayaran' }
        );
        if (bErr) throw bErr;

        const totalPerJamaah = {};
        (bayarData || []).forEach(b => {
            totalPerJamaah[b.jamaah_id] = (totalPerJamaah[b.jamaah_id] || 0) + Number(b.jumlah || 0);
        });

        // ---- Card detail pemasukan (hero) + rincian pemasukan per program ----
        // Dihitung dari SELURUH data jamaah (tidak terpengaruh search/filter tabel di
        // bawah) supaya angka total pemasukan selalu mencerminkan kondisi sebenarnya.
        renderPembayaranIncomeSummary(jamaahAll, totalPerJamaah);

        const search = (document.getElementById('pbSearchInput')?.value || '').trim().toLowerCase();
        const filterProgram = document.getElementById('pbFilterProgram')?.value || '';
        const filterStatus = document.getElementById('pbFilterStatus')?.value || '';

        let rowsData = jamaahAll.map(j => {
            const program = dataUmroh.find(p => String(p.id) === String(j.program_id));
            const hargaProgram = parseRupiahToNumber(program ? program.harga_quint : 0);
            const dibayar = totalPerJamaah[j.id] || 0;
            const sisa = Math.max(hargaProgram - dibayar, 0);
            const pct = hargaProgram > 0 ? Math.min(100, Math.round((dibayar / hargaProgram) * 100)) : 0;
            let status = 'belum';
            if (hargaProgram > 0 && dibayar >= hargaProgram) status = 'lunas';
            else if (dibayar > 0) status = 'cicilan';
            return { j, program, hargaProgram, dibayar, sisa, pct, status };
        });

        if (filterProgram) rowsData = rowsData.filter(r => String(r.j.program_id) === String(filterProgram));
        if (filterStatus) rowsData = rowsData.filter(r => r.status === filterStatus);
        if (search) {
            rowsData = rowsData.filter(r =>
                (r.j.nama || '').toLowerCase().includes(search) ||
                (r.j.nik || '').toLowerCase().includes(search) ||
                (r.j.paspor || '').toLowerCase().includes(search)
            );
        }

        // Prioritaskan yang masih punya sisa tagihan terbesar supaya admin gampang follow-up
        rowsData.sort((a, b) => b.sisa - a.sisa);

        const grandTagihan = rowsData.reduce((s, r) => s + r.hargaProgram, 0);
        const grandDibayar = rowsData.reduce((s, r) => s + r.dibayar, 0);
        const grandSisa = Math.max(grandTagihan - grandDibayar, 0);
        const totalLunas = rowsData.filter(r => r.status === 'lunas').length;
        const totalBelum = rowsData.filter(r => r.status === 'belum').length;

        document.getElementById('pbStatsBar').innerHTML = `
            <span class="status-badge available">${rowsData.length} Jamaah</span>
            <span class="status-badge available">${totalLunas} Lunas</span>
            <span class="status-badge limited">${rowsData.length - totalLunas - totalBelum} Cicilan</span>
            <span class="status-badge full">${totalBelum} Belum Bayar</span>
            <span class="status-badge available">Dibayar: ${formatRupiah(grandDibayar)}</span>
            <span class="status-badge full">Sisa: ${formatRupiah(grandSisa)}</span>
        `;
        document.getElementById('pbCount').textContent = `${rowsData.length} jamaah`;

        if (!rowsData.length) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--ink-soft);">Tidak ada data yang cocok dengan filter/pencarian.</td></tr>`;
            return;
        }

        const canEdit = canManageProgramData();
        tbody.innerHTML = rowsData.map(r => {
            let statusLabel, statusClass;
            if (r.status === 'lunas') { statusLabel = '<i class="fa-solid fa-circle-check"></i> Lunas'; statusClass = 'available'; }
            else if (r.status === 'cicilan') { statusLabel = '<i class="fa-solid fa-arrows-rotate"></i> Cicilan'; statusClass = 'limited'; }
            else { statusLabel = '<i class="fa-solid fa-hourglass-half"></i> Belum Bayar'; statusClass = 'full'; }

            return `
                <tr>
                    <td><strong>${escapeHtml(r.j.nama || '-')}</strong>${r.j.asal ? `<br><span style="font-size:11px;color:var(--ink-soft);">${escapeHtml(r.j.asal)}</span>` : ''}</td>
                    <td>${escapeHtml(r.program ? r.program.nama : '-')}</td>
                    <td style="white-space:nowrap;">${formatRupiah(r.hargaProgram)}</td>
                    <td style="white-space:nowrap;color:var(--success);font-weight:600;">${formatRupiah(r.dibayar)}</td>
                    <td style="white-space:nowrap;color:${r.sisa > 0 ? 'var(--danger)' : 'var(--ink-soft)'};font-weight:600;">${formatRupiah(r.sisa)}</td>
                    <td style="min-width:110px;">
                        <div style="background:var(--line);border-radius:6px;height:8px;overflow:hidden;">
                            <div style="background:var(--brand);height:100%;width:${r.pct}%;"></div>
                        </div>
                        <span style="font-size:10px;color:var(--ink-soft);">${r.pct}%</span>
                    </td>
                    <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                    <td style="text-align:right;white-space:nowrap;">
                        <button class="btn-primary btn-pay" style="font-size:11px;padding:5px 10px;" onclick="openCicilanModal('${r.j.id}')" ${!canEdit ? 'disabled title="Tidak punya izin"' : ''}>
                            <i class="fa-solid fa-money-bill-wave"></i> Bayar
                        </button>
                    </td>
                </tr>`;
        }).join('');

    } catch (err) {
        console.error('Render pembayaran panel error:', err);
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--danger);">Gagal memuat data: ${escapeHtml(err.message)}</td></tr>`;
    }
}

// ============================================================
// 19C. NOTA PEMBAYARAN (bukti bayar per cicilan, unduh sebagai JPEG)
// Dirender di kontainer tersembunyi #notaRenderArea lalu di-snapshot
// pakai html2canvas jadi gambar JPEG yang bisa diunduh/dikirim ke jamaah.
// ============================================================
const NOTA_PERUSAHAAN = {
    brand: 'AMIRU TOUR',
    logo: 'assets/logo-amirutour.png',
    nama: 'PT AMIRU HARAMAIN INDONESIA',
    alamat: 'Jl. Taman Kenari No A3 Kledokan, Caturtunggal, Kec. Depok, Kabupaten Sleman, DIY',
    telp: '0851-2233-6300',
    email: 'salam@amirutour.com'
};

const TERBILANG_SATUAN = ['', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan', 'Sepuluh', 'Sebelas'];
function angkaKeTerbilang(n) {
    n = Math.floor(Math.abs(Number(n) || 0));
    if (n < 12) return TERBILANG_SATUAN[n];
    if (n < 20) return angkaKeTerbilang(n - 10) + ' Belas';
    if (n < 100) return angkaKeTerbilang(Math.floor(n / 10)) + ' Puluh' + (n % 10 ? ' ' + angkaKeTerbilang(n % 10) : '');
    if (n < 200) return 'Seratus' + (n % 100 ? ' ' + angkaKeTerbilang(n % 100) : '');
    if (n < 1000) return angkaKeTerbilang(Math.floor(n / 100)) + ' Ratus' + (n % 100 ? ' ' + angkaKeTerbilang(n % 100) : '');
    if (n < 2000) return 'Seribu' + (n % 1000 ? ' ' + angkaKeTerbilang(n % 1000) : '');
    if (n < 1000000) return angkaKeTerbilang(Math.floor(n / 1000)) + ' Ribu' + (n % 1000 ? ' ' + angkaKeTerbilang(n % 1000) : '');
    if (n < 1000000000) return angkaKeTerbilang(Math.floor(n / 1000000)) + ' Juta' + (n % 1000000 ? ' ' + angkaKeTerbilang(n % 1000000) : '');
    return angkaKeTerbilang(Math.floor(n / 1000000000)) + ' Miliar' + (n % 1000000000 ? ' ' + angkaKeTerbilang(n % 1000000000) : '');
}
function rupiahTerbilang(n) {
    const val = Math.floor(Math.abs(Number(n) || 0));
    if (!val) return 'Nol Rupiah';
    return (angkaKeTerbilang(val) + ' Rupiah').replace(/\s+/g, ' ').trim();
}

function nomorNota(cicilan) {
    // Nomor resmi dibuat & dikunci oleh database (trigger + sequence, lihat
    // sql/tambah_nota_audit.sql) supaya sekuensial, permanen, dan tidak
    // berubah tiap nota dicetak ulang. Fallback di bawah HANYA dipakai kalau
    // migrasi SQL itu belum dijalankan di project Supabase — diberi label
    // "(sementara)" secara eksplisit supaya tidak disalahartikan sebagai nomor resmi.
    if (cicilan && cicilan.nomor_nota) return cicilan.nomor_nota;
    if (cicilan && cicilan.id === 'draft') return 'DRAFT — belum tersimpan';
    const tgl = (cicilan.tanggal || '').replace(/-/g, '');
    const idPart = String(cicilan.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-5).toUpperCase();
    return `AHI/NOTA/${tgl || '000000'}/${idPart || '00000'} (sementara)`;
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
function getPetugasNama() {
    try { return sessionStorage.getItem('admin_petugas_nama') || ''; } catch (_) { return ''; }
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

// ---- Panel Admin "Audit Nota": daftar log yang bisa dicari/difilter, dengan
// pagination "Muat Lebih Banyak" (range-based, hemat data dibanding load semua). ----
const AUDIT_NOTA_PAGE_SIZE = 25;
let auditNotaOffset = 0;
let auditNotaSearchDebounce = null;

function handleAuditNotaSearchInput() {
    clearTimeout(auditNotaSearchDebounce);
    auditNotaSearchDebounce = setTimeout(() => loadNotaAuditLog(true), 350);
}

async function loadNotaAuditLog(reset) {
    if (currentRole !== 'admin') return;
    const tbody = document.getElementById('auditNotaTableBody');
    const loadMoreBtn = document.getElementById('auditNotaLoadMoreBtn');
    const countEl = document.getElementById('auditNotaCount');
    if (!tbody) return;

    if (reset) {
        auditNotaOffset = 0;
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--ink-soft);">Memuat...</td></tr>';
    }

    const search = (document.getElementById('auditNotaSearch')?.value || '').trim();
    const jenis = document.getElementById('auditNotaFilterJenis')?.value || '';

    try {
        let query = supabaseClient.from('nota_audit_log').select('*', { count: 'exact' }).order('created_at', { ascending: false });
        if (jenis) query = query.eq('jenis', jenis);
        if (search) {
            const s = search.replace(/[%,]/g, '');
            query = query.or(`jamaah_nama.ilike.%${s}%,nomor_nota.ilike.%${s}%,kode_verifikasi.ilike.%${s}%`);
        }
        query = query.range(auditNotaOffset, auditNotaOffset + AUDIT_NOTA_PAGE_SIZE - 1);

        const { data, error, count } = await query;
        if (error) throw error;

        const rows = data || [];
        const jenisLabel = { pembayaran: 'Nota Pembayaran', riwayat: 'Nota Riwayat' };
        const rowsHtml = rows.map(r => `
            <tr>
                <td style="white-space:nowrap;font-size:12px;">${escapeHtml(new Date(r.created_at).toLocaleString('id-ID'))}</td>
                <td style="font-family:'IBM Plex Mono',monospace;font-size:11.5px;white-space:nowrap;">${escapeHtml(r.nomor_nota || '-')}</td>
                <td>${escapeHtml(jenisLabel[r.jenis] || r.jenis)}</td>
                <td>${escapeHtml(r.jamaah_nama || '-')}</td>
                <td style="white-space:nowrap;">${r.jumlah != null ? formatRupiah(Number(r.jumlah)) : '-'}</td>
                <td>${escapeHtml(r.dicetak_oleh_nama || '-')} <span style="color:var(--ink-soft);font-size:11px;">(${escapeHtml(r.dicetak_oleh_role || '-')})</span></td>
                <td style="font-family:'IBM Plex Mono',monospace;font-size:11.5px;">${escapeHtml(r.kode_verifikasi || '-')}</td>
            </tr>`).join('');

        if (reset) {
            tbody.innerHTML = rowsHtml || '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--ink-soft);">Belum ada nota yang tercatat.</td></tr>';
        } else {
            tbody.insertAdjacentHTML('beforeend', rowsHtml);
        }

        auditNotaOffset += rows.length;
        if (countEl) countEl.textContent = `${count != null ? count : auditNotaOffset} baris`;
        if (loadMoreBtn) loadMoreBtn.style.display = (count != null && auditNotaOffset < count) ? '' : 'none';
    } catch (err) {
        console.error('loadNotaAuditLog error:', err);
        if (reset) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--danger);">Gagal memuat log audit: ${escapeHtml(err.message)}. Pastikan migrasi sql/tambah_nota_audit.sql sudah dijalankan di Supabase.</td></tr>`;
        showToast('Gagal memuat log audit nota', 'error');
    }
}

function tanggalIndonesia(isoDate) {
    if (!isoDate) return '-';
    const bulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const d = new Date(isoDate + 'T00:00:00');
    if (isNaN(d.getTime())) return isoDate;
    return `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
}

// Palet & skala font institusional dipakai konsisten di kedua jenis nota
// supaya terasa satu identitas resmi (kop surat lembaga/bank).
const NOTA_TEMA = {
    navy: '#1a355b',
    navyDeep: '#0f2138',
    gold: '#b8935a',
    tint: '#eef2f7',
    line: '#d7dfe9',
    inkSoft: '#64758A'
};

const NOTA_KODE_PREVIEW = '__PREVIEW__';
function notaKodeVerifikasiFooterHTML(kodeVerifikasi) {
    if (kodeVerifikasi === NOTA_KODE_PREVIEW) {
        return `<span style="letter-spacing:.02em;color:${NOTA_TEMA.inkSoft};font-style:italic;"> &middot; Kode Verifikasi akan dibuat &amp; dicatat ke sistem audit saat nota ini diunduh</span>`;
    }
    if (kodeVerifikasi) {
        return `<span style="letter-spacing:.06em;color:${NOTA_TEMA.inkSoft};"> &middot; Kode Verifikasi: <b style="font-family:'IBM Plex Mono',monospace;color:${NOTA_TEMA.navy};">${escapeHtml(kodeVerifikasi)}</b> &middot; tercatat di sistem audit nota</span>`;
    }
    return '';
}

function buildNotaWatermarkHTML() {
    return `
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:none;z-index:0;">
            <div style="transform:rotate(-28deg);font-size:54px;font-weight:800;letter-spacing:.12em;color:${NOTA_TEMA.navy};opacity:.045;white-space:nowrap;font-family:Georgia,'Times New Roman',serif;">${escapeHtml(NOTA_PERUSAHAAN.brand)}</div>
        </div>`;
}

function buildNotaHeaderHTML() {
    // Kop rata kiri: logo & identitas perusahaan sejajar di sisi kiri,
    // tanpa blok warna — supaya bisa ditempel di satu baris bersama judul nota.
    return `
        <div style="position:relative;z-index:1;display:flex;align-items:center;gap:10px;text-align:left;">
            <img src="${NOTA_PERUSAHAAN.logo}" alt="${escapeHtml(NOTA_PERUSAHAAN.brand)}" style="height:30px;width:auto;display:block;flex-shrink:0;">
            <div style="text-align:left;">
                <div style="font-size:10.5px;font-weight:800;color:${NOTA_TEMA.navy};letter-spacing:.01em;">${escapeHtml(NOTA_PERUSAHAAN.nama)}</div>
                <div style="font-size:7px;color:${NOTA_TEMA.inkSoft};margin-top:2px;line-height:1.35;">${escapeHtml(NOTA_PERUSAHAAN.alamat)} &middot; Telp. ${escapeHtml(NOTA_PERUSAHAAN.telp)} &middot; ${escapeHtml(NOTA_PERUSAHAAN.email)}</div>
            </div>
        </div>`;
}

function buildNotaTitleBarHTML(judul, metaLines) {
    // Tanpa blok warna: judul nota jadi teks polos rata kanan, ukuran kecil,
    // hanya dipisah garis navy tipis (dipasang oleh pemanggil) dari kop.
    const meta = metaLines.map(m => `<div style="margin-top:1px;">${m}</div>`).join('');
    return `
        <div style="position:relative;z-index:1;text-align:right;flex-shrink:0;">
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:10.5px;font-weight:700;letter-spacing:.06em;color:${NOTA_TEMA.navy};">${judul}</div>
            <div style="margin-top:2px;font-size:8px;line-height:1.4;color:${NOTA_TEMA.inkSoft};">${meta}</div>
        </div>`;
}

function buildNotaSignatureHTML(kiriLabel, kananLabel) {
    return `
        <div style="position:relative;z-index:1;display:flex;justify-content:space-between;gap:10px;font-size:8.5px;text-align:center;color:#333;">
            <div style="flex:1;">
                <div style="margin-bottom:14px;">&nbsp;</div>
                <div style="border-top:1px solid #999;padding-top:3px;font-weight:600;">${escapeHtml(kiriLabel)}</div>
            </div>
            <div style="flex:1;">
                <div style="margin-bottom:14px;">&nbsp;</div>
                <div style="border-top:1px solid #999;padding-top:3px;font-weight:600;">${escapeHtml(kananLabel)}</div>
            </div>
        </div>`;
}

function buildNotaHTML(cicilan, kodeVerifikasi) {
    const jamaah = cicilanJamaahInfo || {};
    const program = cicilanProgramInfo || {};
    const hargaProgram = cicilanHargaProgram || 0;

    const totalDibayarSemua = cicilanList.reduce((sum, c) => sum + Number(c.jumlah || 0), 0);
    const sisaTagihan = Math.max(hargaProgram - totalDibayarSemua, 0);
    const jumlah = parseRupiahToNumber(cicilan.jumlah);
    const statusLunas = hargaProgram > 0 && totalDibayarSemua >= hargaProgram;
    const lebihBayar = Math.max(totalDibayarSemua - hargaProgram, 0);

    const baris = (label, value, opts = {}) => `
        <tr>
            <td style="padding:2.5px 0;font-size:10px;color:${NOTA_TEMA.inkSoft};width:110px;vertical-align:top;">${label}</td>
            <td style="padding:2.5px 0;font-size:10px;color:#1a1a1a;vertical-align:top;${opts.bold ? 'font-weight:700;' : ''}">: ${value}</td>
        </tr>`;

    const kolomKiri = [
        baris('Diterima Dari', escapeHtml(jamaah.nama || '-'), { bold: true }),
        baris('Program Umroh', `${escapeHtml(program.nama || '-')}${program.tgl ? ' (' + escapeHtml(program.tgl) + ')' : ''}`)
    ].join('');
    const kolomKanan = [
        baris('Metode Bayar', escapeHtml(cicilan.metode || '-'))
    ].join('');

    const rekapItem = (label, value, opts = {}) => `
        <div style="flex:1;">
            <div style="font-size:8.5px;color:${NOTA_TEMA.inkSoft};text-transform:uppercase;letter-spacing:.04em;">${label}</div>
            <div style="font-size:12px;font-weight:700;margin-top:2px;${opts.color ? 'color:' + opts.color + ';' : ''}">${value}</div>
        </div>`;

    // Ukuran nota: 210 x 110 mm, dirender pada 96dpi => 794 x 416 px.
    // Layout disusun per-baris (stack ke bawah): kop+judul -> info pembayaran
    // -> jumlah diterima -> rekap tagihan -> tanda tangan, bukan kolom sejajar.
    return `
    <div style="position:relative;width:794px;height:416px;background:#fff;font-family:'Inter',Arial,sans-serif;color:#1a1a1a;padding:22px 28px;box-sizing:border-box;border:1px solid ${NOTA_TEMA.line};overflow:hidden;display:flex;flex-direction:column;">
        ${buildNotaWatermarkHTML()}

        <div style="position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-shrink:0;border-bottom:1.5px solid ${NOTA_TEMA.navy};padding-bottom:9px;margin-bottom:12px;">
            ${buildNotaHeaderHTML()}
            ${buildNotaTitleBarHTML('NOTA PEMBAYARAN', [
                `No. ${escapeHtml(nomorNota(cicilan))}`,
                `${escapeHtml(tanggalIndonesia(cicilan.tanggal))}`
            ])}
        </div>

        <div style="position:relative;z-index:1;flex:1;min-height:0;display:flex;flex-direction:column;justify-content:space-between;">
            <div style="display:flex;gap:20px;">
                <table style="width:64%;border-collapse:collapse;">
                    ${kolomKiri}
                </table>
                <table style="width:36%;border-collapse:collapse;">
                    ${kolomKanan}
                </table>
            </div>

            <div style="background:${NOTA_TEMA.tint};border-left:3px solid ${NOTA_TEMA.navy};border-radius:2px;padding:9px 16px;">
                <div style="font-size:8.5px;color:${NOTA_TEMA.inkSoft};text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px;">Jumlah Diterima</div>
                <div style="font-size:23px;font-weight:800;color:${NOTA_TEMA.navy};line-height:1.15;">${formatRupiah(jumlah)}</div>
                <div style="font-size:9.5px;color:#555;font-style:italic;margin-top:3px;">Terbilang: ${rupiahTerbilang(jumlah)}</div>
                <div style="font-size:9px;color:${NOTA_TEMA.inkSoft};margin-top:5px;padding-top:5px;border-top:1px dashed ${NOTA_TEMA.line};">Total dibayar s.d. nota ini: <b style="color:${NOTA_TEMA.navy};font-size:10px;">${formatRupiah(totalDibayarSemua)}</b></div>
                ${cicilan.keterangan ? `<div style="font-size:9.5px;color:${NOTA_TEMA.inkSoft};margin-top:5px;padding-top:5px;border-top:1px dashed ${NOTA_TEMA.line};">Untuk Pembayaran: <span style="color:#1a1a1a;font-weight:600;">${escapeHtml(cicilan.keterangan)}</span></div>` : ''}
            </div>

            <div style="display:flex;justify-content:space-between;gap:14px;padding:8px 0;border-top:1px solid ${NOTA_TEMA.line};border-bottom:1px solid ${NOTA_TEMA.line};">
                ${rekapItem('Harga Program', formatRupiah(hargaProgram))}
                ${rekapItem('Total Dibayar (s.d. hari ini)', formatRupiah(totalDibayarSemua))}
                ${rekapItem('Sisa Tagihan', statusLunas ? (lebihBayar > 0 ? `LUNAS · Lebih Bayar ${formatRupiah(lebihBayar)}` : 'LUNAS') : formatRupiah(sisaTagihan), { color: lebihBayar > 0 ? NOTA_TEMA.gold : '' })}
            </div>

            ${buildNotaSignatureHTML(jamaah.nama || 'Jamaah / Penyerah', 'Ali Santoso')}
        </div>

        <div style="position:relative;z-index:1;text-align:left;font-size:8px;color:${NOTA_TEMA.inkSoft};flex-shrink:0;margin-top:8px;padding-top:6px;border-top:1px solid ${NOTA_TEMA.line};">
            <div style="margin-bottom:3px;">
                <b>Rekening Pembayaran:</b>
                Bank Syariah Indonesia 2026 64 2027 a.n. Amiru Tour
                &nbsp;&middot;&nbsp;
                Bank Nasional Indonesia 2026 64 2026 a.n. Amiru Haramain Indonesia
            </div>
            <div style="color:#a0a8b3;">
                Dokumen ini dicetak otomatis oleh sistem dan sah sebagai bukti pembayaran resmi ${escapeHtml(NOTA_PERUSAHAAN.brand)}.
                ${notaKodeVerifikasiFooterHTML(kodeVerifikasi)}
            </div>
        </div>
    </div>`;
}

// Render nota (HTML string) ke #notaRenderArea lalu tangkap jadi <canvas> lewat
// html2canvas. Dipakai bersama oleh export JPEG maupun PDF supaya proses
// render & pengelolaan spinner tombol tidak dobel ditulis di dua tempat.
async function captureNotaCanvas(htmlString, btn) {
    if (notaGenerating) return null;
    if (typeof html2canvas === 'undefined') { showToast('Modul export gambar belum termuat, coba refresh halaman', 'error'); return null; }

    notaGenerating = true;
    const originalIcon = btn ? btn.innerHTML : null;
    if (btn) { btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; btn.disabled = true; }

    const renderArea = document.getElementById('notaRenderArea');
    renderArea.innerHTML = htmlString;

    try {
        // Tunggu gambar (logo) selesai dimuat, baru beri jeda singkat untuk layout settle,
        // supaya html2canvas tidak menyalin kanvas saat logo belum tampil.
        const imgs = Array.from(renderArea.querySelectorAll('img'));
        await Promise.all(imgs.map(img => (img.complete && img.naturalWidth > 0)
            ? Promise.resolve()
            : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; })
        ));
        await new Promise(resolve => setTimeout(resolve, 60));
        const target = renderArea.firstElementChild;
        return await html2canvas(target, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    } catch (err) {
        console.error('Generate nota error:', err);
        showToast('Gagal membuat nota: ' + err.message, 'error');
        return null;
    } finally {
        renderArea.innerHTML = '';
        notaGenerating = false;
        if (btn) { btn.innerHTML = originalIcon; btn.disabled = false; }
    }
}

async function exportNotaElementAsJpeg(htmlString, filename, btn) {
    const canvas = await captureNotaCanvas(htmlString, btn);
    if (!canvas) return false;

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Nota berhasil diunduh (JPEG)');
    return true;
}

async function exportNotaElementAsPdf(htmlString, filename, btn) {
    if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
        showToast('Modul export PDF belum termuat, coba refresh halaman', 'error');
        return false;
    }

    const canvas = await captureNotaCanvas(htmlString, btn);
    if (!canvas) return false;

    try {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
        const { jsPDF } = window.jspdf;
        // Ukuran halaman PDF dibuat pas mengikuti dimensi nota (bukan A4),
        // supaya nota tidak terpotong / ada margin putih aneh.
        const pdf = new jsPDF({
            orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
            unit: 'px',
            format: [canvas.width, canvas.height]
        });
        pdf.addImage(dataUrl, 'JPEG', 0, 0, canvas.width, canvas.height);
        pdf.save(filename);

        showToast('Nota berhasil diunduh (PDF)');
        return true;
    } catch (err) {
        console.error('Generate nota PDF error:', err);
        showToast('Gagal membuat PDF: ' + err.message, 'error');
        return false;
    }
}

// ---- Preview Nota: tampilkan dulu sebelum diunduh sebagai JPEG. Kode
// Verifikasi & pencatatan ke audit log baru terjadi saat tombol "Unduh
// JPEG" di modal preview ditekan, bukan saat preview dibuka — supaya
// batal preview tidak meninggalkan baris log audit yang "nyasar". ----
let notaPreviewPending = null;
let notaLiveDraftDebounce = null;

function setNotaPreviewPanelChrome(title, showActions) {
    const titleEl = document.getElementById('cicilanPreviewTitle');
    const actionsEl = document.getElementById('notaPreviewActions');
    if (titleEl) titleEl.textContent = title;
    if (actionsEl) actionsEl.style.display = showActions ? '' : 'none';
}

function showNotaPreviewPanel(html) {
    // Nota dirender pada ukuran aslinya (500-1123px, sesuai jenis nota) supaya
    // hasilnya identik dengan file yang diunduh — panel preview jauh lebih
    // sempit dari itu, jadi di sini kita bungkus dengan wrapper yang di-scale
    // proporsional (bukan overflow/scroll) agar yang terlihat = keseluruhan
    // nota, cuma diperkecil. Ukuran final tetap dihitung dari nota versi asli.
    const content = document.getElementById('notaPreviewContent');
    content.innerHTML = `<div class="nota-preview-scale-wrap"><div class="nota-preview-scale-inner">${html}</div></div>`;
    document.getElementById('cicilanPreviewPanel').style.display = 'block';
    requestAnimationFrame(fitNotaPreviewScale);
}

function fitNotaPreviewScale() {
    const content = document.getElementById('notaPreviewContent');
    if (!content) return;
    const wrap = content.querySelector('.nota-preview-scale-wrap');
    const inner = content.querySelector('.nota-preview-scale-inner');
    const nota = inner ? inner.firstElementChild : null;
    if (!wrap || !inner || !nota) return;

    inner.style.transform = 'none';
    const naturalWidth = nota.offsetWidth;
    const naturalHeight = nota.offsetHeight;
    if (!naturalWidth || !naturalHeight) return;

    // Skala minimum supaya teks nota (yang sudah kecil, 7-10px) tetap nyaman
    // dibaca di panel preview. Kalau ruang yang tersedia lebih sempit dari itu,
    // nota tetap ditampilkan di skala minimum ini dan kelebihannya di-scroll
    // horizontal (bukan dipaksa mengecil terus sampai tidak terbaca).
    // [MAKSIMALKAN] Skala TIDAK lagi dikunci maksimum 100% dan TIDAK diberi
    // plafon atas — nota selalu di-zoom mengisi PENUH lebar panel yang
    // tersedia (berapa pun lebar layarnya), supaya tidak ada sisa area kosong
    // kanan-kiri sama sekali. Ini murni tampilan preview (di-transform via
    // CSS) — file JPEG yang diunduh tetap dirender terpisah di ukuran &
    // resolusi aslinya lewat #notaRenderArea, jadi kualitas unduhan tidak
    // terpengaruh sama sekali oleh seberapa besar skala preview ini.
    const MIN_READABLE_SCALE = 0.75;
    const available = content.clientWidth || naturalWidth;
    const fitScale = available / naturalWidth;
    const scale = Math.max(fitScale, MIN_READABLE_SCALE);

    content.style.overflowX = (fitScale < MIN_READABLE_SCALE) ? 'auto' : 'hidden';

    inner.style.transformOrigin = 'top left';
    inner.style.transform = `scale(${scale})`;
    wrap.style.width = (naturalWidth * scale) + 'px';
    wrap.style.height = (naturalHeight * scale) + 'px';
}

window.addEventListener('resize', () => {
    const panel = document.getElementById('cicilanPreviewPanel');
    if (panel && panel.style.display !== 'none') fitNotaPreviewScale();
    const lightbox = document.getElementById('notaLightboxOverlay');
    if (lightbox && lightbox.classList.contains('open')) fitNotaLightboxScale();
});

// ---- "Perbesar" (lightbox layar penuh) untuk preview nota. Mengambil ulang
// HTML nota yang sedang tampil di panel preview (bukan generate ulang) supaya
// konsisten persis dengan yang sedang dilihat user, hanya beda skala. ----
function openNotaLightbox() {
    const panelInner = document.querySelector('#notaPreviewContent .nota-preview-scale-inner');
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

function previewNotaPembayaran(cicilanId, btn) {
    const cicilan = cicilanList.find(c => String(c.id) === String(cicilanId));
    if (!cicilan) { showToast('Data pembayaran tidak ditemukan', 'error'); return; }
    notaPreviewPending = { type: 'pembayaran', cicilanId, btn };
    setNotaPreviewPanelChrome('Preview Nota', true);
    showNotaPreviewPanel(buildNotaHTML(cicilan, NOTA_KODE_PREVIEW));
}

function previewNotaRiwayatLengkap(btn) {
    if (!cicilanJamaahId) { showToast('Data jamaah tidak valid', 'error'); return; }
    if (!cicilanList.length) { showToast('Belum ada riwayat pembayaran untuk diunduh', 'error'); return; }
    notaPreviewPending = { type: 'riwayat', btn };
    setNotaPreviewPanelChrome('Preview Nota', true);
    showNotaPreviewPanel(buildNotaRiwayatHTML(NOTA_KODE_PREVIEW));
}

// ---- Preview LIVE: nota di kanan otomatis ikut berubah selagi field
// "Tambah Pembayaran" diisi — jadi bisa dicek dulu tampilannya sebelum data
// itu benar-benar disimpan. Ini murni pratinjau di browser (tidak menyentuh
// DB / audit log sama sekali), makanya tombol Unduh disembunyikan di mode ini
// — nota resminya baru bisa diunduh setelah pembayarannya disimpan. ----
function handleCicilanFormLiveInput() {
    clearTimeout(notaLiveDraftDebounce);
    notaLiveDraftDebounce = setTimeout(updateLiveNotaDraft, 200);
}

function updateLiveNotaDraft() {
    // Jangan timpa preview nota yang sudah tersimpan & sedang menunggu diunduh
    if (notaPreviewPending && notaPreviewPending.type !== 'draft') return;

    const tanggal = document.getElementById('cic_tanggal')?.value || '';
    const jumlah = parseRupiahToNumber(document.getElementById('cic_jumlah')?.value);
    const metode = document.getElementById('cic_metode')?.value || '';
    const keterangan = document.getElementById('cic_keterangan')?.value.trim() || '';

    if (!tanggal && !jumlah) { hideNotaPreviewPanel(); return; }

    const draftCicilan = { id: 'draft', tanggal, jumlah, metode, keterangan };
    notaPreviewPending = { type: 'draft' };
    setNotaPreviewPanelChrome('Preview Nota — Live (belum disimpan)', false);
    showNotaPreviewPanel(buildNotaHTML(draftCicilan, NOTA_KODE_PREVIEW));
}

async function confirmDownloadNotaPreview(format = 'jpeg') {
    if (!notaPreviewPending) return;
    const { type, cicilanId, btn } = notaPreviewPending;
    hideNotaPreviewPanel();
    if (type === 'pembayaran') {
        await downloadNotaPembayaran(cicilanId, btn, format);
    } else if (type === 'riwayat') {
        await downloadNotaRiwayatLengkap(btn, format);
    }
}

async function downloadNotaPembayaran(cicilanId, btn, format = 'jpeg') {
    const cicilan = cicilanList.find(c => String(c.id) === String(cicilanId));
    if (!cicilan) { showToast('Data pembayaran tidak ditemukan', 'error'); return; }

    const namaJamaah = (cicilanJamaahInfo && cicilanJamaahInfo.nama ? cicilanJamaahInfo.nama : 'Jamaah').replace(/[^a-zA-Z0-9]+/g, '-');
    const nomor = nomorNota(cicilan);

    // Hitung & catat kode verifikasi SEBELUM nota dirender, supaya kodenya
    // ikut tercetak di dokumen itu sendiri (bisa dicocokkan balik ke log audit).
    const kodeVerifikasi = await logNotaAudit({
        jenis: 'pembayaran',
        nomorNotaValue: nomor,
        jamaahId: cicilanJamaahId,
        jamaahNama: cicilanJamaahInfo?.nama,
        programNama: cicilanProgramInfo?.nama,
        jumlah: Number(cicilan.jumlah || 0),
        metadata: { cicilanId: cicilan.id, tanggal: cicilan.tanggal, metode: cicilan.metode }
    });

    const exportFn = format === 'pdf' ? exportNotaElementAsPdf : exportNotaElementAsJpeg;
    const ext = format === 'pdf' ? 'pdf' : 'jpg';
    await exportFn(
        buildNotaHTML(cicilan, kodeVerifikasi),
        `Nota-Pembayaran-${namaJamaah}-${cicilan.tanggal || 'tanggal'}.${ext}`,
        btn
    );
}

function buildNotaRiwayatHTML(kodeVerifikasi) {
    const jamaah = cicilanJamaahInfo || {};
    const program = cicilanProgramInfo || {};
    const hargaProgram = cicilanHargaProgram || 0;

    const riwayat = [...cicilanList].sort((a, b) => String(a.tanggal || '').localeCompare(String(b.tanggal || '')));
    const totalDibayar = riwayat.reduce((sum, c) => sum + Number(c.jumlah || 0), 0);
    const sisaTagihan = Math.max(hargaProgram - totalDibayar, 0);
    const statusLunas = hargaProgram > 0 && totalDibayar >= hargaProgram;
    const lebihBayar = Math.max(totalDibayar - hargaProgram, 0);

    const rows = riwayat.length ? riwayat.map((c, i) => `
        <tr style="background:${i % 2 === 0 ? '#fff' : NOTA_TEMA.tint};">
            <td style="padding:7px 6px;border-bottom:1px solid ${NOTA_TEMA.line};text-align:center;color:${NOTA_TEMA.inkSoft};font-size:10px;">${i + 1}</td>
            <td style="padding:7px 6px;border-bottom:1px solid ${NOTA_TEMA.line};font-size:9px;font-family:'IBM Plex Mono',monospace;color:${NOTA_TEMA.inkSoft};white-space:nowrap;">${escapeHtml(nomorNota(c))}</td>
            <td style="padding:7px 6px;border-bottom:1px solid ${NOTA_TEMA.line};font-size:10px;">${escapeHtml(tanggalIndonesia(c.tanggal))}</td>
            <td style="padding:7px 6px;border-bottom:1px solid ${NOTA_TEMA.line};font-size:10px;">${escapeHtml(c.metode || '-')}</td>
            <td style="padding:7px 6px;border-bottom:1px solid ${NOTA_TEMA.line};font-size:10px;">${escapeHtml(c.keterangan || '-')}</td>
            <td style="padding:7px 6px;border-bottom:1px solid ${NOTA_TEMA.line};text-align:right;font-weight:700;font-size:10px;white-space:nowrap;">${formatRupiah(Number(c.jumlah || 0))}</td>
        </tr>`).join('') : `
        <tr><td colspan="6" style="padding:18px 6px;text-align:center;color:#999;font-size:10px;">Belum ada pembayaran tercatat.</td></tr>`;

    // baris & rekapItem sengaja diduplikasi persis dari buildNotaHTML (bukan
    // di-share) supaya kedua fungsi nota tetap independen dipanggil terpisah,
    // sama seperti pola kode nota lain di file ini — tapi nilainya disamakan
    // 1:1 (ukuran font, warna, spacing) supaya kedua jenis nota terasa satu
    // identitas visual yang sama persis.
    const baris = (label, value, opts = {}) => `
        <tr>
            <td style="padding:2.5px 0;font-size:10px;color:${NOTA_TEMA.inkSoft};width:110px;vertical-align:top;">${label}</td>
            <td style="padding:2.5px 0;font-size:10px;color:#1a1a1a;vertical-align:top;${opts.bold ? 'font-weight:700;' : ''}">: ${value}</td>
        </tr>`;

    const rekapItem = (label, value, opts = {}) => `
        <div style="flex:1;">
            <div style="font-size:8.5px;color:${NOTA_TEMA.inkSoft};text-transform:uppercase;letter-spacing:.04em;">${label}</div>
            <div style="font-size:12px;font-weight:700;margin-top:2px;${opts.color ? 'color:' + opts.color + ';' : ''}">${value}</div>
        </div>`;

    // Lebar & bahasa visual disamakan persis dengan Nota Pembayaran (buildNotaHTML):
    // kop+judul sebaris dipisah garis navy, info jamaah pakai tabel "baris" yang
    // sama, rekap total bergaya kartu (rekapItem), tanda tangan, dan footer
    // rekening yang identik. Bedanya cuma tinggi menyesuaikan jumlah baris
    // riwayat (tidak dikunci 416px seperti nota pembayaran, karena isinya bisa
    // jauh lebih panjang tergantung banyaknya transaksi).
    return `
    <div style="position:relative;width:794px;background:#fff;font-family:'Inter',Arial,sans-serif;color:#1a1a1a;padding:22px 28px;box-sizing:border-box;border:1px solid ${NOTA_TEMA.line};overflow:hidden;">
        ${buildNotaWatermarkHTML()}

        <div style="position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border-bottom:1.5px solid ${NOTA_TEMA.navy};padding-bottom:9px;margin-bottom:12px;">
            ${buildNotaHeaderHTML()}
            ${buildNotaTitleBarHTML('NOTA RIWAYAT PEMBAYARAN', [
                `Dicetak: ${escapeHtml(tanggalIndonesia(new Date().toISOString().slice(0, 10)))}`
            ])}
        </div>

        <div style="position:relative;z-index:1;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
                ${baris('Nama Jamaah', escapeHtml(jamaah.nama || '-'), { bold: true })}
                ${baris('Program Umroh', `${escapeHtml(program.nama || '-')}${program.tgl ? ' (' + escapeHtml(program.tgl) + ')' : ''}`)}
            </table>

            <table style="width:100%;border-collapse:collapse;margin-bottom:12px;border:1px solid ${NOTA_TEMA.line};">
                <thead>
                    <tr style="background:${NOTA_TEMA.navy};">
                        <th style="padding:8px 6px;text-align:center;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;font-weight:700;">No</th>
                        <th style="padding:8px 6px;text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;font-weight:700;">No. Nota</th>
                        <th style="padding:8px 6px;text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;font-weight:700;">Tanggal</th>
                        <th style="padding:8px 6px;text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;font-weight:700;">Metode</th>
                        <th style="padding:8px 6px;text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;font-weight:700;">Keterangan</th>
                        <th style="padding:8px 6px;text-align:right;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;font-weight:700;">Jumlah</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>

            <div style="display:flex;justify-content:space-between;gap:14px;padding:8px 0;border-top:1px solid ${NOTA_TEMA.line};border-bottom:1px solid ${NOTA_TEMA.line};margin-bottom:12px;">
                ${rekapItem('Harga Program', formatRupiah(hargaProgram))}
                ${rekapItem(`Total Dibayar (${riwayat.length}x transaksi)`, formatRupiah(totalDibayar))}
                ${rekapItem('Sisa Tagihan', statusLunas ? (lebihBayar > 0 ? `LUNAS · Lebih Bayar ${formatRupiah(lebihBayar)}` : 'LUNAS') : formatRupiah(sisaTagihan), { color: lebihBayar > 0 ? NOTA_TEMA.gold : '' })}
            </div>

            ${buildNotaSignatureHTML(jamaah.nama || 'Jamaah / Penyerah', 'Ali Santoso')}
        </div>

        <div style="position:relative;z-index:1;text-align:left;font-size:8px;color:${NOTA_TEMA.inkSoft};margin-top:8px;padding-top:6px;border-top:1px solid ${NOTA_TEMA.line};">
            <div style="margin-bottom:3px;">
                <b>Rekening Pembayaran:</b>
                Bank Syariah Indonesia 2026 64 2027 a.n. Amiru Tour
                &nbsp;&middot;&nbsp;
                Bank Nasional Indonesia 2026 64 2026 a.n. Amiru Haramain Indonesia
            </div>
            <div style="color:#a0a8b3;">
                Dokumen ini dicetak otomatis oleh sistem sebagai rekap riwayat pembayaran resmi ${escapeHtml(NOTA_PERUSAHAAN.brand)}.
                ${notaKodeVerifikasiFooterHTML(kodeVerifikasi)}
            </div>
        </div>
    </div>`;
}

async function downloadNotaRiwayatLengkap(btn, format = 'jpeg') {
    if (!cicilanJamaahId) { showToast('Data jamaah tidak valid', 'error'); return; }
    if (!cicilanList.length) { showToast('Belum ada riwayat pembayaran untuk diunduh', 'error'); return; }

    const namaJamaah = (cicilanJamaahInfo && cicilanJamaahInfo.nama ? cicilanJamaahInfo.nama : 'Jamaah').replace(/[^a-zA-Z0-9]+/g, '-');
    const tanggalFile = new Date().toISOString().slice(0, 10);
    const totalDibayar = cicilanList.reduce((sum, c) => sum + Number(c.jumlah || 0), 0);
    const daftarNomorNota = cicilanList.map(c => nomorNota(c));

    const kodeVerifikasi = await logNotaAudit({
        jenis: 'riwayat',
        nomorNotaValue: `REKAP/${daftarNomorNota.length}-NOTA/${tanggalFile}`,
        jamaahId: cicilanJamaahId,
        jamaahNama: cicilanJamaahInfo?.nama,
        programNama: cicilanProgramInfo?.nama,
        jumlah: totalDibayar,
        metadata: { daftarNomorNota, jumlahTransaksi: cicilanList.length }
    });

    const exportFn = format === 'pdf' ? exportNotaElementAsPdf : exportNotaElementAsJpeg;
    const ext = format === 'pdf' ? 'pdf' : 'jpg';
    await exportFn(
        buildNotaRiwayatHTML(kodeVerifikasi),
        `Nota-Riwayat-Pembayaran-${namaJamaah}-${tanggalFile}.${ext}`,
        btn
    );
}

async function saveCicilan(e) {
    e.preventDefault();
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengelola pembayaran', 'error'); return; }
    const jamaahId = document.getElementById('cic_jamaahId').value;
    const tanggal = document.getElementById('cic_tanggal').value;
    // Terima angka desimal (mis. 2.5 juta) — parseInt() akan memotong ke 2 juta.
    // Dibulatkan ke bawah ke rupiah utuh supaya tidak ada sen yang menggantung.
    const jumlahRaw = document.getElementById('cic_jumlah').value;
    const jumlah = Math.floor(Number(jumlahRaw));
    const metode = document.getElementById('cic_metode').value;
    const keterangan = document.getElementById('cic_keterangan').value.trim();

    if (!jamaahId) { showToast('Data jamaah tidak valid', 'error'); return; }
    if (!tanggal) { showToast('Tanggal wajib diisi', 'error'); return; }
    if (jumlahRaw === '' || isNaN(Number(jumlahRaw))) { showToast('Jumlah pembayaran harus berupa angka', 'error'); return; }
    if (!jumlah || jumlah <= 0) { showToast('Jumlah pembayaran wajib diisi', 'error'); return; }

    try {
        const { error } = await supabaseClient.from('pembayaran_jamaah').insert([{ jamaah_id: jamaahId, tanggal, jumlah, metode, keterangan }]);
        if (error) throw error;

        showToast('Pembayaran berhasil dicatat');
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
    }
}

async function deleteCicilan(id) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk menghapus pembayaran', 'error'); return; }
    const cic = cicilanList.find(c => String(c.id) === String(id));
    if (!cic) { showToast('Data pembayaran tidak ditemukan', 'error'); return; }
    // Gunakan modal konfirmasi kustom (bukan confirm() bawaan browser) supaya
    // konsisten dengan app, dan hapus dicatat ke log audit nota.
    openDeleteModal('pembayaran_jamaah', id,
        `pembayaran ${formatRupiah(Number(cic.jumlah || 0))}${cic.tanggal ? ' (' + cic.tanggal + ')' : ''}`);
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
        const { data: jamaahRow, error: jErr } = await supabaseClient.from('kb_jamaah').select('*').eq('id', jamaahId).single();
        if (jErr || !jamaahRow) return;

        const program = dataUmroh.find(p => String(p.id) === String(jamaahRow.program_id));
        const hargaProgram = parseRupiahToNumber(program ? program.harga_quint : 0);

        const { data: bayarData, error: bErr } = await supabaseClient.from('pembayaran_jamaah').select('jumlah').eq('jamaah_id', jamaahId);
        if (bErr) return;

        const totalDibayar = (bayarData || []).reduce((sum, b) => sum + Number(b.jumlah || 0), 0);
        let statusBaru;
        if (hargaProgram > 0 && totalDibayar >= hargaProgram) statusBaru = 'lunas';
        else if (totalDibayar > 0) statusBaru = 'dp';
        else statusBaru = 'pending';

        if (statusBaru !== jamaahRow.status) {
            await supabaseClient.from('kb_jamaah').update({ status: statusBaru }).eq('id', jamaahId);
            await loadKbJamaah();
        }
    } catch (err) {
        console.warn('Sync status jamaah gagal (non-fatal):', err);
    }
}

// ============================================================
// 19C. KELENGKAPAN DOKUMEN JAMAAH
// Checklist dokumen per jamaah (KTP, KK, Paspor, dst), disimpan di kolom
// kb_jamaah.dokumen (jsonb, format {key: true/false}). Guest hanya bisa
// lihat, user & admin bisa centang/uncentang langsung dari tabel.
// ============================================================
function renderDokProgramSelector() {
    const select = document.getElementById('dokProgramSelect');
    if (!select) return;

    if (!dataUmroh || dataUmroh.length === 0) {
        select.innerHTML = '<option value="">-- Belum ada program --</option>';
        return;
    }

    // Hanya tampilkan program yang memang sudah ada jamaah yang mendaftar,
    // supaya admin tinggal pilih tanpa perlu mencari di daftar panjang.
    const programsWithJamaah = dataUmroh.filter(p =>
        (kbJamaahList || []).some(j => String(j.program_id) === String(p.id))
    );

    if (programsWithJamaah.length === 0) {
        select.innerHTML = '<option value="">-- Belum ada jamaah terdaftar --</option>';
        loadDokumenForProgram('');
        return;
    }

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Pilih Program --</option>' +
        programsWithJamaah.map(p => `<option value="${p.id}">${escapeHtml(p.nama)} (${escapeHtml(p.tgl || '-')})</option>`).join('');
    select.value = (currentVal && programsWithJamaah.some(p => String(p.id) === String(currentVal))) ? currentVal : '';

    loadDokumenForProgram(select.value);
}

function selectDokProgram(id) {
    document.getElementById('dokProgramSelect').value = id;
    loadDokumenForProgram(id);
}

async function loadDokumenForProgram(programId) {
    dokSelectedProgram = programId || null;
    const container = document.getElementById('dokContent');
    const summaryEl = document.getElementById('dokSummary');
    summaryEl.innerHTML = '';

    if (!programId) {
        container.innerHTML = `<div class="kb-no-program"><i class="fa-solid fa-file-circle-check"></i><p>Pilih program di atas untuk mengecek kelengkapan dokumen jamaah.</p></div>`;
        return;
    }

    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('kb_jamaah').select('*').eq('program_id', programId).order('nama', { ascending: true }),
            { label: 'Muat data jamaah' }
        );
        if (error) throw error;
        const jamaah = data || [];

        if (!jamaah.length) {
            container.innerHTML = `<div class="kb-no-program"><i class="fa-solid fa-user-slash"></i><p>Belum ada jamaah terdaftar untuk program ini.</p></div>`;
            return;
        }

        const totalDok = DOKUMEN_JENIS.length;
        const totalLengkap = jamaah.filter(j => isDokumenLengkap(j.dokumen)).length;

        summaryEl.innerHTML = `
            <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
                <span class="status-badge available">${jamaah.length} Total Jamaah</span>
                <span class="status-badge available">${totalLengkap} Dokumen Lengkap</span>
                ${jamaah.length - totalLengkap > 0 ? `<span class="status-badge full">${jamaah.length - totalLengkap} Belum Lengkap</span>` : ''}
            </div>`;

        const canEdit = canManageProgramData();

        container.innerHTML = `
            <div class="table-container" style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead style="background:var(--bg);">
                        <tr>
                            <th rowspan="2" style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);vertical-align:bottom;">Nama</th>
                            ${DOKUMEN_JENIS.map(d => d.type === 'copy'
                                ? `<th colspan="2" style="padding:8px 10px 4px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--ink-soft);border-left:1px solid var(--line);">${escapeHtml(d.label)}</th>`
                                : `<th rowspan="2" style="padding:10px 8px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--ink-soft);vertical-align:bottom;border-left:1px solid var(--line);">${escapeHtml(d.label)}</th>`
                            ).join('')}
                            <th rowspan="2" style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);vertical-align:bottom;border-left:1px solid var(--line);">Status</th>
                        </tr>
                        <tr>
                            ${DOKUMEN_JENIS.filter(d => d.type === 'copy').map(() => `
                                <th style="padding:2px 8px 8px;text-align:center;font-size:10px;font-weight:500;color:var(--ink-soft);">FC</th>
                                <th style="padding:2px 8px 8px;text-align:center;font-size:10px;font-weight:500;color:var(--ink-soft);">Asli</th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${jamaah.map(j => {
                            const dok = j.dokumen || {};
                            const lengkap = isDokumenLengkap(dok);
                            return `
                            <tr style="border-bottom:1px solid var(--line);">
                                <td style="padding:10px 14px;"><strong>${escapeHtml(j.nama)}</strong>${j.asal ? `<br><span style="font-size:11px;color:var(--ink-soft);">${escapeHtml(j.asal)}</span>` : ''}</td>
                                ${DOKUMEN_JENIS.map(d => d.type === 'copy' ? `
                                    <td style="padding:10px 6px;text-align:center;border-left:1px solid var(--line);">
                                        <input type="checkbox" ${dok[d.key + '_fc'] ? 'checked' : ''} ${canEdit ? '' : 'disabled'}
                                            onchange="toggleDokumenJamaah('${j.id}','${d.key}_fc',this.checked)"
                                            style="width:16px;height:16px;cursor:${canEdit ? 'pointer' : 'default'};">
                                    </td>
                                    <td style="padding:10px 6px;text-align:center;">
                                        <input type="checkbox" ${dok[d.key + '_asli'] ? 'checked' : ''} ${canEdit ? '' : 'disabled'}
                                            onchange="toggleDokumenJamaah('${j.id}','${d.key}_asli',this.checked)"
                                            style="width:16px;height:16px;cursor:${canEdit ? 'pointer' : 'default'};">
                                    </td>` : `
                                    <td style="padding:10px 14px;text-align:center;border-left:1px solid var(--line);">
                                        <input type="checkbox" ${dok[d.key] ? 'checked' : ''} ${canEdit ? '' : 'disabled'}
                                            onchange="toggleDokumenJamaah('${j.id}','${d.key}',this.checked)"
                                            style="width:16px;height:16px;cursor:${canEdit ? 'pointer' : 'default'};">
                                    </td>`).join('')}
                                <td style="padding:10px 14px;border-left:1px solid var(--line);">
                                    <span class="status-badge ${lengkap ? 'available' : 'full'}">${lengkap ? '<i class="fa-solid fa-circle-check"></i> Lengkap' : '<i class="fa-solid fa-hourglass-half"></i> Belum Lengkap'}</span>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            <p style="font-size:11px;color:var(--ink-soft);margin-top:10px;">${totalDok} jenis dokumen dicek (mengikuti form Tanda Terima Dokumen): ${DOKUMEN_JENIS.map(d => d.label).join(', ')}. Untuk KTP–Kartu Vaksin, centang Fotocopy dan/atau Asli sesuai yang diserahkan jamaah.</p>
        `;

    } catch (err) {
        console.error('Load dokumen jamaah error:', err);
        container.innerHTML = `<div class="kb-no-program" style="color:var(--danger);">
            <i class="fa-solid fa-circle-exclamation"></i>
            <p>Gagal memuat data dokumen — periksa koneksi internet.</p>
        </div>`;
    }
}

function isDokumenLengkap(dok) {
    if (!dok) return false;
    return DOKUMEN_JENIS.every(d => d.type === 'copy'
        ? !!(dok[d.key + '_fc'] || dok[d.key + '_asli'])
        : !!dok[d.key]);
}

async function toggleDokumenJamaah(jamaahId, key, checked) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengubah data dokumen', 'error'); return; }
    try {
        const { data: jamaahRow, error: jErr } = await supabaseClient.from('kb_jamaah').select('dokumen').eq('id', jamaahId).single();
        if (jErr) throw jErr;

        const dokBaru = { ...(jamaahRow.dokumen || {}), [key]: checked };
        const { error } = await supabaseClient.from('kb_jamaah').update({ dokumen: dokBaru }).eq('id', jamaahId);
        if (error) throw error;

        const idx = kbJamaahList.findIndex(j => j.id === jamaahId);
        if (idx > -1) kbJamaahList[idx].dokumen = dokBaru;

        if (dokSelectedProgram) await loadDokumenForProgram(dokSelectedProgram);

    } catch (err) {
        console.error('Update dokumen jamaah error:', err);
        showToast('Gagal menyimpan status dokumen: ' + err.message, 'error');
        if (dokSelectedProgram) await loadDokumenForProgram(dokSelectedProgram);
    }
}

// ============================================================
// 20. KUITANSI
// ============================================================
function openKuitansiModal() {
    document.getElementById('kuitansiModal').classList.add('open');
    renderKwtPreview();
}

function closeKuitansiModal() {
    document.getElementById('kuitansiModal').classList.remove('open');
}

function renderKwtPreview() {
    const nomor = document.getElementById('kwt_nomor').value || '-';
    const tempat = document.getElementById('kwt_tempat_tanggal').value || '-';
    const dari = document.getElementById('kwt_dari').value || '-';
    const jumlah = document.getElementById('kwt_jumlah').value || '0';
    const terbilang = document.getElementById('kwt_terbilang').value || '-';
    const penerima = document.getElementById('kwt_penerima').value || '-';
    const keterangan = document.getElementById('kwt_keterangan').value || '-';

    document.getElementById('pv_nomor').textContent = nomor;
    document.getElementById('pv_tempat_tanggal').textContent = tempat;
    document.getElementById('pv_dari').textContent = dari;
    document.getElementById('pv_jumlah').textContent = 'Rp ' + parseInt(jumlah).toLocaleString('id-ID') + ',-';
    document.getElementById('pv_terbilang').textContent = terbilang;
    document.getElementById('pv_penerima').textContent = penerima;
    document.getElementById('pv_keterangan').textContent = keterangan;
}

function onKwtJumlahInput() {
    const val = document.getElementById('kwt_jumlah').value;
    const display = document.getElementById('kwt_jumlah_display');
    if (val) {
        display.textContent = 'Rp ' + parseInt(val).toLocaleString('id-ID') + ',-';
    } else {
        display.textContent = '';
    }
    renderKwtPreview();
}

function downloadKuitansiPDF() {
    showToast('Fitur download PDF akan segera hadir');
}

// ============================================================
// 21A. CROSSCHECK MODULE (OCR poster vs data teks)
// ============================================================
const CX_OCR_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/scan-poster-ocr`;

async function cxRunOcr(progId, imageUrl, onProgress) {
    onProgress(20);
    const res = await fetch(CX_OCR_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
    });
    onProgress(80);
    if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).error || ''; } catch (e) {}
        throw new Error(detail || `Server OCR gagal (status ${res.status})`);
    }
    const data = await res.json();
    if (!data || !data.fields) throw new Error('Respons OCR tidak valid.');
    onProgress(100);
    return data; // { fields: {...}, raw_text: "..." }
}

// Dipanggil otomatis tiap kali program (dengan link poster) disimpan
async function autoScanPosterForProgram(progId) {
    const prog = adminPrograms.find(p => String(p.id) === String(progId));
    if (!prog || !prog.link_poster) return;
    if (cxScanningIds.has(String(progId))) return;

    cxScanningIds.add(String(progId));
    cxOcrProgress[progId] = 0;
    if (String(cxSelectedProgram) === String(progId)) renderCxPanel(progId);
    renderCxProgramSelector();

    try {
        const result = await cxRunOcr(progId, prog.link_poster, (pct) => {
            cxOcrProgress[progId] = pct;
            if (String(cxSelectedProgram) === String(progId)) {
                const bar = document.getElementById('cxOcrBar_' + progId);
                if (bar) bar.style.width = pct + '%';
            }
        });

        const parsed = { ...result.fields };
        Object.keys(parsed).forEach(k => { if (!parsed[k]) delete parsed[k]; });
        parsed._raw_ocr_text = (result.raw_text || '').slice(0, 4000);

        const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
        adl.poster_data = parsed;
        adl.poster_data_source = 'ocr';
        adl.poster_scanned_at = new Date().toISOString();

        await updateProgramById(progId, { admin_data_lengkap: JSON.stringify(adl) });
        const idx = adminPrograms.findIndex(p => String(p.id) === String(progId));
        if (idx >= 0) adminPrograms[idx].admin_data_lengkap = JSON.stringify(adl);

        const mismatchCount = cxCountMismatch(progId);
        if (mismatchCount > 0) {
            showToast(`Crosscheck "${prog.nama}": ${mismatchCount} data tidak cocok dengan poster!`, 'error');
        } else {
            showToast(`Crosscheck "${prog.nama}": semua data cocok dengan poster.`);
        }
    } catch (err) {
        showToast('Pembacaan poster gagal: ' + err.message, 'error');
    } finally {
        cxScanningIds.delete(String(progId));
        delete cxOcrProgress[progId];
        renderCxProgramSelector();
        if (String(cxSelectedProgram) === String(progId)) renderCxPanel(progId);
    }
}

function cxNormalizeHarga(str) {
    if (!str) return '';
    return String(str).replace(/[^0-9]/g, '');
}
function cxNormalizeMaskapai(str) {
    return String(str || '').toLowerCase().trim().replace(/\b(airlines?|airways|air)\b/gi, '').replace(/\s+/g, ' ').trim();
}
function cxValuesMatch(field, a, b) {
    if (!a || !b) return false;
    if (field && field.indexOf('harga') === 0) {
        const na = cxNormalizeHarga(a), nb = cxNormalizeHarga(b);
        return na !== '' && na === nb;
    }
    if (field === 'maskapai') {
        const na = cxNormalizeMaskapai(a), nb = cxNormalizeMaskapai(b);
        if (!na || !nb) return false;
        return na === nb || na.includes(nb) || nb.includes(na);
    }
    return a.toLowerCase().trim() === b.toLowerCase().trim();
}

function cxCountMismatch(progId) {
    const prog = adminPrograms.find(p => String(p.id) === String(progId));
    if (!prog) return 0;
    const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
    const pd = adl.poster_data || {};
    const pairs = [
        ['nama', prog.nama, pd.nama], ['tgl', prog.tgl, pd.tgl], ['durasi', prog.durasi, pd.durasi], ['maskapai', prog.maskapai, pd.maskapai],
        ['harga_quint', prog.harga_quint, pd.harga_quint], ['harga_quad', adl.harga_quad, pd.harga_quad], ['harga_triple', adl.harga_triple, pd.harga_triple],
        ['harga_double', adl.harga_double, pd.harga_double], ['hotel_makkah', adl.hotel_makkah, pd.hotel_makkah], ['hotel_madinah', adl.hotel_madinah, pd.hotel_madinah],
    ];
    return pairs.filter(([field, a, b]) => a && b && !cxValuesMatch(field, a, b)).length;
}

// Hitung status crosscheck 1 program: dipakai bareng oleh stats bar & pill selector
function cxGetProgramStatus(p) {
    const adl = (() => { try { return p.admin_data_lengkap ? (typeof p.admin_data_lengkap === 'string' ? JSON.parse(p.admin_data_lengkap) : p.admin_data_lengkap) : null; } catch(e) { return null; } })();
    const hasData = !!(adl && Object.keys(adl).length > 0);
    const mismatchCount = adl && adl.poster_data ? cxCountMismatch(p.id) : 0;
    // priority: 0 = ada yang tidak cocok (paling urgent), 1 = belum ada data lengkap, 2 = aman
    const priority = mismatchCount > 0 ? 0 : (!hasData ? 1 : 2);
    return { adl, hasData, mismatchCount, priority };
}

function renderCxStatsBar() {
    const bar = document.getElementById('cxStatsBar');
    if (!bar) return;
    if (!adminPrograms || !adminPrograms.length) { bar.innerHTML = ''; return; }
    let mismatch = 0, missing = 0, ok = 0;
    adminPrograms.forEach(p => {
        const { priority } = cxGetProgramStatus(p);
        if (priority === 0) mismatch++; else if (priority === 1) missing++; else ok++;
    });
    bar.innerHTML = `
        <div class="cx-stat-chip ok"><i class="fa-solid fa-circle-check"></i> ${ok} cocok</div>
        <div class="cx-stat-chip warn"><i class="fa-solid fa-triangle-exclamation"></i> ${mismatch} tidak cocok</div>
        <div class="cx-stat-chip missing"><i class="fa-solid fa-circle-info"></i> ${missing} belum ada data</div>
    `;
}

function renderCxProgramSelector() {
    const sel = document.getElementById('cxProgramSelector');
    if (!sel) return;
    renderCxStatsBar();
    if (!adminPrograms || !adminPrograms.length) {
        sel.innerHTML = '<div style="font-size:13px;color:var(--ink-soft);font-style:italic;">Belum ada program.</div>';
        return;
    }
    const query = (document.getElementById('cxSearchInput')?.value || '').trim().toLowerCase();
    let list = adminPrograms.map(p => ({ p, status: cxGetProgramStatus(p) }));
    if (query) list = list.filter(({ p }) => (p.nama || '').toLowerCase().includes(query));
    // Urutkan: yang bermasalah (tidak cocok) dulu, lalu belum ada data, lalu yang sudah aman
    list.sort((a, b) => a.status.priority - b.status.priority);

    if (!list.length) {
        sel.innerHTML = '<div style="font-size:13px;color:var(--ink-soft);font-style:italic;">Tidak ada program yang cocok dengan pencarian.</div>';
        return;
    }

    sel.innerHTML = list.map(({ p, status }) => {
        const { hasData, mismatchCount } = status;
        const isActive = String(cxSelectedProgram) === String(p.id);
        const isScanning = cxScanningIds.has(String(p.id));
        return `<button class="cx-program-pill${isActive?' active':''}${mismatchCount>0?' has-warning':''}" onclick="selectCxProgram('${p.id}')">
            ${escapeHtml(p.nama||'Program')}
            ${isScanning ? '<i class="fa-solid fa-spinner fa-spin" style="color:var(--brand);font-size:9px;margin-left:2px;" title="Sedang scan poster..."></i>' : ''}
            ${!isScanning && hasData ? '<i class="fa-solid fa-circle-check" style="color:var(--success);font-size:9px;margin-left:2px;" title="Ada data lengkap"></i>' : ''}
            ${!isScanning && mismatchCount>0 ? `<i class="fa-solid fa-triangle-exclamation cx-pill-warn" title="${mismatchCount} data tidak cocok"></i>` : ''}
        </button>`;
    }).join('');
}

function selectCxProgram(id) {
    cxSelectedProgram = id;
    renderCxProgramSelector();
    renderCxPanel(id);
}

function renderCxPanel(progId) {
    const content = document.getElementById('cxPanelContent');
    if (!content) return;
    const prog = adminPrograms.find(p => String(p.id) === String(progId));
    if (!prog) { content.innerHTML = '<div class="cx-empty"><i class="fa-solid fa-magnifying-glass-chart"></i><p>Program tidak ditemukan.</p></div>'; return; }
    const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
    const val = (v) => v ? escapeHtml(v) : '<span class="cx-value empty">—</span>';
    const hasAdl = Object.keys(adl).length > 0;
    const hasPoster = !!prog.link_poster;

    const buildCompareRows = () => {
        const rows = [
            { label: 'Nama Program',  plain: prog.nama,        poster: null, field: 'nama' },
            { label: 'Tanggal',       plain: prog.tgl,         poster: null, field: 'tgl' },
            { label: 'Durasi',        plain: prog.durasi,      poster: null, field: 'durasi' },
            { label: 'Maskapai',      plain: prog.maskapai,    poster: null, field: 'maskapai' },
            { label: 'Harga Quint',   plain: prog.harga_quint, poster: null, field: 'harga_quint' },
            { label: 'Harga Quad',    plain: adl.harga_quad,   poster: null, field: 'harga_quad' },
            { label: 'Harga Triple',  plain: adl.harga_triple, poster: null, field: 'harga_triple' },
            { label: 'Harga Double',  plain: adl.harga_double, poster: null, field: 'harga_double' },
            { label: 'Hotel Makkah',  plain: adl.hotel_makkah, poster: null, field: 'hotel_makkah' },
            { label: 'Hotel Madinah', plain: adl.hotel_madinah,poster: null, field: 'hotel_madinah' },
        ];
        const pd = (() => { try { return adl.poster_data ? (typeof adl.poster_data === 'string' ? JSON.parse(adl.poster_data) : adl.poster_data) : {}; } catch(e) { return {}; } })();
        rows.forEach(r => { if (pd[r.field]) r.poster = pd[r.field]; });
        // Sembunyikan baris yang dua-duanya kosong (tidak ada info untuk dibandingkan)
        // Urutkan: yang beda (mismatch) paling atas supaya langsung kelihatan yang perlu dibenerin
        const visibleRows = rows.filter(r => r.plain || r.poster);
        visibleRows.sort((a, b) => {
            const rank = r => { const hasBoth = r.plain && r.poster; if (hasBoth && !cxValuesMatch(r.field, r.plain, r.poster)) return 0; if (!hasBoth) return 1; return 2; };
            return rank(a) - rank(b);
        });
        if (!visibleRows.length) return '<div class="cx-empty" style="padding:20px;"><p>Belum ada data untuk dibandingkan.</p></div>';
        return visibleRows.map(r => {
            const hasBoth = r.plain && r.poster;
            const isMatch = hasBoth && cxValuesMatch(r.field, r.plain, r.poster);
            const rowClass = hasBoth ? (isMatch ? 'cx-match' : 'cx-mismatch') : '';
            const pill = hasBoth ? `<span class="cx-match-pill ${isMatch?'ok':'no'}">${isMatch?'<i class="fa-solid fa-check"></i> Cocok':'<i class="fa-solid fa-xmark"></i> Beda'}</span>` : `<span class="cx-match-pill skip">—</span>`;
            return `<div class="cx-compare-row ${rowClass}">
                <div class="cx-compare-field"><div class="cx-compare-label">${escapeHtml(r.label)}</div>${pill}</div>
                <div class="cx-compare-col"><div class="cx-compare-label"><i class="fa-solid fa-file-lines"></i> Teks</div><div class="cx-compare-val ${r.plain?'':'empty'}">${r.plain ? escapeHtml(r.plain) : '—'}</div></div>
                <div class="cx-divider"></div>
                <div class="cx-compare-col"><div class="cx-compare-label"><i class="fa-solid fa-image"></i> Poster</div><div class="cx-compare-val ${r.poster?'':'empty'}">${r.poster ? escapeHtml(r.poster) : '—'}</div></div>
            </div>`;
        }).join('');
    };

    const isScanning = cxScanningIds.has(String(progId));
    const mismatchCount = adl.poster_data ? cxCountMismatch(progId) : 0;
    const posterSource = adl.poster_data_source === 'ocr' ? 'ocr' : (adl.poster_data ? 'manual' : null);

    content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
        <div style="font-size:14px;font-weight:700;color:var(--brand-deep);">${escapeHtml(prog.nama||'Program')}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            ${mismatchCount > 0 ? `<span class="cx-mismatch-count"><i class="fa-solid fa-triangle-exclamation"></i> ${mismatchCount} tidak cocok</span>` : ''}
            <button class="cx-parse-btn" onclick="openCxEditModal('${prog.id}')"><i class="fa-solid fa-edit"></i> Input Manual</button>
            ${hasPoster ? `<button class="cx-parse-btn" onclick="autoScanPosterForProgram('${prog.id}')" ${isScanning?'disabled':''}><i class="fa-solid fa-${isScanning?'spinner fa-spin':'arrows-rotate'}"></i> ${isScanning?'Memindai...':'Scan Ulang Poster'}</button>` : ''}
            ${hasPoster ? `<button class="cx-parse-btn" onclick="window.open('${escapeJsAttr(prog.link_poster)}','_blank')"><i class="fa-solid fa-image"></i> Lihat Poster</button>` : ''}
        </div>
    </div>
    ${isScanning ? `
    <div class="cx-status-bar scanning">
        <i class="fa-solid fa-spinner fa-spin"></i>
        <div style="flex:1;">
            <div>Membaca poster otomatis dengan AI (OCR)... bisa sampai ±20 detik.</div>
            <div class="cx-ocr-progress-wrap"><div class="cx-ocr-progress-bar" id="cxOcrBar_${progId}" style="width:${cxOcrProgress[progId]||0}%;"></div></div>
        </div>
    </div>` : `
    <div class="cx-status-bar ${mismatchCount > 0 ? 'warn' : (hasAdl ? 'ok' : 'missing')}">
        <i class="fa-solid fa-${mismatchCount > 0 ? 'triangle-exclamation' : (hasAdl ? 'circle-check' : 'circle-info')}"></i>
        ${mismatchCount > 0
            ? `Ditemukan <b>${mismatchCount} field</b> yang tidak cocok antara data teks & poster.`
            : (hasAdl ? 'Data lengkap tersedia. ' + (adl.poster_data ? 'Data poster sudah terbaca — semua cocok.' : (hasPoster ? 'Poster akan dibaca otomatis saat program disimpan, atau klik Scan Ulang Poster.' : 'Belum ada link poster.')) : 'Belum ada data lengkap.')}
        ${posterSource ? `<span class="cx-source-tag ${posterSource}">${posterSource === 'ocr' ? 'Sumber: OCR otomatis' : 'Sumber: Input manual'}</span>` : ''}
    </div>`}
    ${adl.poster_data ? `
    <div class="cx-section-title" style="margin-top:20px;"><i class="fa-solid fa-code-compare"></i> Perbandingan: Data Teks vs Poster</div>
    <div style="font-size:12px;color:var(--ink-soft);margin-bottom:10px;">Hijau = cocok &nbsp;·&nbsp; Merah = tidak sesuai${posterSource==='ocr' ? ' &nbsp;·&nbsp; Hasil OCR bisa salah baca, koreksi via Input Manual.' : ''}</div>
    ${buildCompareRows()}` : ''}
    `;
}

function openCxEditModal(progId) {
    const prog = adminPrograms.find(p => String(p.id) === String(progId));
    if (!prog) return;
    const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
    const pd = adl.poster_data || {};
    let modal = document.getElementById('cxEditModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'cxEditModal';
        modal.className = 'modal-overlay';
        modal.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); });
        document.body.appendChild(modal);
    }
    const fields = [
        { key: 'nama', label: 'Nama Program', val: pd.nama || prog.nama || '' },
        { key: 'tgl', label: 'Tanggal', val: pd.tgl || prog.tgl || '' },
        { key: 'durasi', label: 'Durasi', val: pd.durasi || prog.durasi || '' },
        { key: 'maskapai', label: 'Maskapai', val: pd.maskapai || prog.maskapai || '' },
        { key: 'harga_quint', label: 'Harga Quint', val: pd.harga_quint || prog.harga_quint || '' },
        { key: 'harga_quad', label: 'Harga Quad', val: pd.harga_quad || adl.harga_quad || '' },
        { key: 'harga_triple', label: 'Harga Triple', val: pd.harga_triple || adl.harga_triple || '' },
        { key: 'harga_double', label: 'Harga Double', val: pd.harga_double || adl.harga_double || '' },
        { key: 'hotel_makkah', label: 'Hotel Makkah', val: pd.hotel_makkah || adl.hotel_makkah || '' },
        { key: 'hotel_madinah', label: 'Hotel Madinah', val: pd.hotel_madinah || adl.hotel_madinah || '' },
    ];
    modal.innerHTML = `
    <div class="modal-content" style="max-width:600px;">
        <div class="modal-header">
            <h2>Input Data Poster</h2>
            <button class="modal-close" onclick="document.getElementById('cxEditModal').classList.remove('open')">&times;</button>
        </div>
        <div class="modal-body">
            <p style="font-size:12.5px;color:var(--ink-soft);margin-bottom:14px;">Ketik data yang tertera di poster untuk dibandingkan dengan data teks program.</p>
            ${adl.poster_data_source === 'ocr' && pd._raw_ocr_text ? `
            <details style="margin-bottom:16px;">
                <summary style="cursor:pointer;font-size:12px;font-weight:700;color:var(--brand);"><i class="fa-solid fa-file-lines"></i> Lihat teks mentah hasil OCR</summary>
                <div style="margin-top:8px;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:10px;font-size:11.5px;white-space:pre-wrap;max-height:140px;overflow-y:auto;">${escapeHtml(pd._raw_ocr_text)}</div>
            </details>` : ''}
            <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                ${fields.map(f => `<div class="form-group"><label>${escapeHtml(f.label)}</label><input type="text" id="cxp_${f.key}" value="${escapeHtml(f.val)}" placeholder="Dari poster..."></div>`).join('')}
            </div>
            <div class="form-actions" style="border-top:none;padding-top:14px;">
                <button class="btn-submit" onclick="saveCxPosterData('${prog.id}')"><i class="fa-solid fa-save"></i> Simpan & Bandingkan</button>
                <button class="btn-cancel" onclick="document.getElementById('cxEditModal').classList.remove('open')">Batal</button>
            </div>
        </div>
    </div>`;
    modal.classList.add('open');
}

async function saveCxPosterData(progId) {
    const prog = adminPrograms.find(p => String(p.id) === String(progId));
    if (!prog) return;
    const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
    const keys = ['nama','tgl','durasi','maskapai','harga_quint','harga_quad','harga_triple','harga_double','hotel_makkah','hotel_madinah'];
    const pd = {};
    keys.forEach(k => { const el = document.getElementById('cxp_' + k); if (el && el.value.trim()) pd[k] = el.value.trim(); });
    adl.poster_data = pd;
    adl.poster_data_source = 'manual';
    adl.poster_scanned_at = new Date().toISOString();
    try {
        await updateProgramById(progId, { admin_data_lengkap: JSON.stringify(adl) });
        const idx = adminPrograms.findIndex(p => String(p.id) === String(progId));
        if (idx >= 0) adminPrograms[idx].admin_data_lengkap = JSON.stringify(adl);
        document.getElementById('cxEditModal').classList.remove('open');
        renderCxProgramSelector();
        renderCxPanel(progId);
        showToast('Data poster disimpan — crosscheck siap!');
    } catch (err) {
        showToast('Gagal simpan: ' + err.message, 'error');
    }
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
    const grid = document.getElementById('featuredGrid');
    if (!grid) return;

    const featuredPrograms = dataUmroh.filter(p => featuredIds.includes(String(p.id)) && p.is_active !== false);

    if (!featuredPrograms.length) {
        grid.innerHTML = `<div class="featured-empty"><i class="fa-solid fa-star"></i>Belum ada program unggulan. Kelola melalui Admin Panel.</div>`;
        return;
    }

    grid.innerHTML = featuredPrograms.map(p => `
        <div class="featured-card">
            <div class="fc-title"><i class="fa-solid fa-star"></i> ${escapeHtml(p.nama)}</div>
            <div class="fc-meta">${escapeHtml(formatRupiah(p.harga_quint))} • ${escapeHtml(p.tgl)}</div>
            <div class="fc-meta" style="margin-top:4px;">${escapeHtml(p.maskapai || '')} • ${escapeHtml(p.durasi || '')}</div>
        </div>
    `).join('');
}

const MAX_FEATURED = 3;
function isFeatured(id) { return featuredIds.includes(String(id)); }

async function toggleFeatured(id) {
    id = String(id);
    if (isFeatured(id)) {
        const { error } = await supabaseClient.from('featured_programs').delete().eq('program_id', id);
        if (error) { showToast('❌ Gagal menghapus: ' + error.message, 'error'); return; }
        featuredIds = featuredIds.filter(i => i !== id);
        showToast('⭐ Program dihapus dari unggulan');
    } else {
        if (featuredIds.length >= MAX_FEATURED) { showToast('⚠️ Maksimal ' + MAX_FEATURED + ' program unggulan!', 'error'); return; }
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
    const currentCount = featuredIds.length;
    const isFull = currentCount >= MAX_FEATURED;
    const counter = document.getElementById('featuredCounter');
    if (counter) counter.textContent = currentCount + '/' + MAX_FEATURED;
    tbody.innerHTML = adminPrograms.map(p => {
        const featured = isFeatured(p.id);
        const canAdd = featured || !isFull;
        const btnLabel = featured ? '⭐ Tampil di Unggulan' : (isFull ? '🚫 Slot Penuh' : '☆ Jadikan Unggulan');
        const btnClass = featured ? 'featured-toggle-btn on' : 'featured-toggle-btn off';
        const disabled = !canAdd ? ' disabled style="opacity:.5;cursor:not-allowed;"' : '';
        return `<tr>
            <td><strong>${escapeHtml(p.nama || '-')}</strong></td>
            <td>${escapeHtml(p.tgl || '-')}</td>
            <td style="text-align:right;">
                <button class="${btnClass}"${disabled} onclick="toggleFeatured('${p.id}'); renderFeaturedAdminTable();">
                    ${btnLabel}
                </button>
            </td>
        </tr>`;
    }).join('');
}

// ============================================================
// 21B. TELEGRAM MODULE
// ============================================================
async function getTgConfig() {
    if (_tgConfigCache) return _tgConfigCache;
    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('tg_config').select('key, value'),
            { label: 'Muat konfigurasi Telegram' }
        );
        if (error || !data || !data.length) return {};
        const cfg = {};
        data.forEach(row => { try { cfg[row.key] = JSON.parse(row.value); } catch { cfg[row.key] = row.value; } });
        _tgConfigCache = cfg;
        return cfg;
    } catch { return {}; }
}

async function saveTgConfig() {
    const botToken = document.getElementById('tg_bot_token')?.value.trim();
    const edgeUrl  = document.getElementById('tg_edge_url')?.value.trim();
    if (!botToken) { showTgStatus('Bot Token wajib diisi', 'err'); return; }
    if (!edgeUrl)  { showTgStatus('Edge Function URL wajib diisi', 'err'); return; }
    const recipients = collectTgRecipients();
    if (!recipients.length) { showTgStatus('Tambahkan minimal 1 penerima', 'err'); return; }
    showTgStatus('Menyimpan...', 'ok');
    try {
        const rows = [
            { key: 'botToken', value: botToken },
            { key: 'edgeUrl', value: edgeUrl },
            { key: 'recipients', value: JSON.stringify(recipients) },
        ];
        const { error } = await supabaseClient.from('tg_config').upsert(rows, { onConflict: 'key' });
        if (error) throw error;
        _tgConfigCache = null;
        showTgStatus('Konfigurasi tersimpan!', 'ok');
    } catch (err) {
        showTgStatus('Gagal simpan: ' + err.message, 'err');
    }
}

function collectTgRecipients() {
    const rows = document.querySelectorAll('.tg-recipient-row');
    const result = [];
    rows.forEach(row => {
        const chatId = row.querySelector('.tg-chat-id')?.value.trim();
        const label  = row.querySelector('.tg-label')?.value.trim();
        const types  = [...row.querySelectorAll('.tg-type-check:checked')].map(c => c.value);
        if (chatId) result.push({ chatId, label: label || chatId, types });
    });
    return result;
}

async function renderTgRecipients() {
    const list = document.getElementById('tgRecipientsList');
    if (!list) return;
    list.innerHTML = '<p style="color:var(--ink-soft);font-size:12px;"><i class="fa-solid fa-hourglass-half"></i> Memuat konfigurasi...</p>';
    const cfg = await getTgConfig();
    const tokenInput = document.getElementById('tg_bot_token');
    const edgeInput  = document.getElementById('tg_edge_url');
    if (tokenInput && cfg.botToken) tokenInput.value = cfg.botToken;
    if (edgeInput  && cfg.edgeUrl)  edgeInput.value  = cfg.edgeUrl;
    const recipients = typeof cfg.recipients === 'string' ? JSON.parse(cfg.recipients) : (cfg.recipients || []);
    list.innerHTML = '';
    if (!recipients.length) { addTgRecipient(); return; }
    recipients.forEach(r => addTgRecipientRow(r));
}

function addTgRecipient() {
    addTgRecipientRow({ chatId: '', label: '', types: ['program', 'jadwal', 'reminder'] });
}

function addTgRecipientRow(r) {
    const list = document.getElementById('tgRecipientsList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'tg-recipient-row';
    const typeOpts = [
        { val: 'program', label: '<i class="fa-solid fa-box"></i> Program Baru' },
        { val: 'jadwal', label: '<i class="fa-solid fa-calendar-days"></i> Jadwal Tamu' },
        { val: 'reminder', label: '<i class="fa-solid fa-bell"></i> Pengingat 1 Bulan' },
    ];
    row.innerHTML = `
        <input class="tg-chat-id" placeholder="Chat ID (mis: -1001234567890)" value="${escapeHtml(r.chatId||'')}">
        <input class="tg-label" placeholder="Label (mis: Grup Admin)" value="${escapeHtml(r.label||'')}">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            ${typeOpts.map(t => `<label class="tg-type-label"><input type="checkbox" class="tg-type-check" value="${t.val}" ${(r.types||[]).includes(t.val)?'checked':''}> ${t.label}</label>`).join('')}
        </div>
        <button class="tg-remove-btn" onclick="this.closest('.tg-recipient-row').remove()" title="Hapus penerima"><i class="fa-solid fa-times"></i></button>`;
    list.appendChild(row);
}

function showTgStatus(msg, type) {
    const el = document.getElementById('tgStatusMsg');
    if (!el) return;
    const iconMap = { ok: 'fa-circle-check', err: 'fa-circle-exclamation' };
    const icon = iconMap[type] || 'fa-circle-info';
    el.innerHTML = `<span class="tg-status ${type}"><i class="fa-solid ${icon}"></i> ${escapeHtml(msg)}</span>`;
    setTimeout(() => { if (el) el.innerHTML = ''; }, 4000);
}

function logTg(msg, ok = true) {
    const log = document.getElementById('tgNotifLog');
    if (!log) return;
    log.style.display = 'block';
    const p = document.createElement('p');
    p.className = ok ? 'ok' : 'err';
    p.textContent = '[' + new Date().toLocaleTimeString('id-ID') + '] ' + msg;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
}

async function sendTelegramNotif(message, eventType = 'program') {
    const cfg = await getTgConfig();
    if (!cfg.botToken || !cfg.edgeUrl) return; // belum dikonfigurasi -> lewati diam-diam
    const recipients = typeof cfg.recipients === 'string' ? JSON.parse(cfg.recipients) : (cfg.recipients || []);
    const targets = recipients.filter(r => (r.types || []).includes(eventType));
    if (!targets.length) return;
    for (const target of targets) {
        try {
            const res = await fetch(cfg.edgeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bot_token: cfg.botToken, chat_id: target.chatId, message, parse_mode: 'HTML' })
            });
            const result = await res.json().catch(() => ({}));
            if (res.ok && result.ok !== false) logTg('Terkirim ke ' + target.label, true);
            else logTg('Gagal ke ' + target.label + ': ' + (result.description || res.status), false);
        } catch (err) {
            logTg('Error ke ' + target.label + ': ' + err.message, false);
        }
    }
}

function formatTgProgram(data, isEdit = false) {
    const icon = isEdit ? '✏️' : '🆕';
    const action = isEdit ? 'diperbarui' : 'ditambahkan';
    return `${icon} <b>Program Umroh ${action}!</b>

🕌 <b>${escapeHtml(data.nama||'-')}</b>
📅 Berangkat: ${escapeHtml(data.tgl||'-')}
⏳ Durasi: ${escapeHtml(data.durasi||'-')}
✈️ Maskapai: ${escapeHtml(data.maskapai||'-')}
💰 Harga: ${escapeHtml(data.harga_quint||'-')}

📌 <i>PT Amiru Haramain Indonesia</i>
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

📌 <i>PT Amiru Haramain Indonesia</i>`;
}

function formatTgReminder(data, sisaHari) {
    const urgency = sisaHari <= 7 ? '🚨' : sisaHari <= 14 ? '⚠️' : '🔔';
    return `${urgency} <b>PENGINGAT — Program Hampir Berangkat!</b>

🕌 <b>${escapeHtml(data.nama||'-')}</b>
📅 Tanggal Berangkat: ${escapeHtml(data.tgl||'-')}
⏰ <b>Sisa ${sisaHari} hari lagi!</b>
⏳ Durasi: ${escapeHtml(data.durasi||'-')}
✈️ Maskapai: ${escapeHtml(data.maskapai||'-')}
💰 Harga: ${escapeHtml(data.harga_quint||'-')}

📌 <i>PT Amiru Haramain Indonesia</i>
🕐 ${new Date().toLocaleString('id-ID')}`;
}

async function checkAndSendReminders() {
    const cfg = await getTgConfig();
    if (!cfg.botToken || !cfg.edgeUrl) return;
    const recipients = typeof cfg.recipients === 'string' ? JSON.parse(cfg.recipients) : (cfg.recipients || []);
    const targets = recipients.filter(r => (r.types||[]).includes('reminder'));
    if (!targets.length) return;
    if (!dataUmroh || !dataUmroh.length) return;

    let sentLog = {};
    try {
        const { data } = await supabaseClient.from('tg_config').select('value').eq('key', TG_REMINDER_KEY).single();
        if (data) sentLog = JSON.parse(data.value);
    } catch {}

    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = today.toISOString().split('T')[0];
    let changed = false;

    for (const prog of dataUmroh) {
        if (!prog.tgl) continue;
        const tglBerangkat = parseDateFromString(prog.tgl);
        if (!tglBerangkat || isNaN(tglBerangkat.getTime())) continue;
        tglBerangkat.setHours(0,0,0,0);
        const sisaMs = tglBerangkat - today;
        const sisaHari = Math.ceil(sisaMs / (1000 * 60 * 60 * 24));
        if (sisaHari < 0 || sisaHari > 30) continue;

        const key = String(prog.id);
        if (sentLog[key] === todayStr) continue;

        const msg = formatTgReminder(prog, sisaHari);
        await sendTelegramNotif(msg, 'reminder');
        sentLog[key] = todayStr;
        changed = true;
    }

    if (changed) {
        await supabaseClient.from('tg_config').upsert([{ key: TG_REMINDER_KEY, value: JSON.stringify(sentLog) }], { onConflict: 'key' });
    }
}

async function testTgNotif() {
    await saveTgConfig();
    const waktu = new Date().toLocaleString('id-ID');
    const msgProgram = `🧪 <b>TEST — Program Baru</b>\n\n🕌 <b>Contoh: Umroh Ramadhan</b>\n📅 Berangkat: 01 Maret 2027\n⏳ Durasi: 9 Hari\n✈️ Maskapai: Saudia Airlines\n💰 Harga: Rp 34.500.000\n\n📌 <i>PT Amiru Haramain Indonesia</i>\n🕐 ${waktu}`;
    const msgJadwal = `🧪 <b>TEST — Jadwal Tamu Baru</b>\n\n👤 <b>H. Budi Santoso</b>\n🏠 Asal: Ponorogo\n📅 Tanggal: Senin, 27 Januari 2027\n🕐 Jam: 09:00\n👥 Jumlah: 3 orang\n💼 Keperluan: Konsultasi Paket Umroh\n\n📌 <i>PT Amiru Haramain Indonesia</i>`;
    const msgReminder = `🔔 <b>TEST — Pengingat Program</b>\n\n🕌 <b>Umroh Spesial Akbar</b>\n📅 Tanggal Berangkat: 15 Februari 2027\n⏰ <b>Sisa 20 hari lagi!</b>\n\n📌 <i>PT Amiru Haramain Indonesia</i>\n🕐 ${waktu}`;

    showTgStatus('Mengirim test...', 'ok');
    await sendTelegramNotif(msgProgram, 'program');
    await sendTelegramNotif(msgJadwal, 'jadwal');
    await sendTelegramNotif(msgReminder, 'reminder');
    showTgStatus('Test selesai! Cek log di bawah.', 'ok');
}

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

    // Load data
    await loadUserRoles();
    checkSession(); // pulihkan status login (kalau ada) sebelum render tabel utama
    applyRoleUIVisibility();
    renderSidebarNav();
    await loadFeaturedIds();
    await loadJadwal();
    await loadPendaftaran();
    await loadKbJamaah();
    await loadDataFromSupabase();

    // Render sections
    renderJadwalSection();
    renderPendaftaranSection();
    renderKbProgramSelector();
    renderFeaturedSection();

    // Bind sort listeners on table headers (nama, tgl, maskapai, isAvailable)
    document.querySelectorAll('th.sortable').forEach(th => {
        const key = th.getAttribute('data-sort');
        if (key) th.onclick = () => sortTable(key);
    });

    // Cek & kirim pengingat Telegram untuk program yang berangkat ≤30 hari lagi (1x/hari)
    setTimeout(() => checkAndSendReminders(), 2000);
});

// ============================================================
// 23. CLOSE MODALS ON OVERLAY CLICK
// ============================================================
document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', function(e) {
        if (e.target === this) this.classList.remove('open');
    });
});

// ============================================================
// 24. POSTER HOVER POPUP
// ============================================================
function resolveImageUrl(url) {
    if (!url) return url;
    // Google Drive: /file/d/ID/view atau /file/d/ID/view?usp=...
    const gdMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (gdMatch) return `https://drive.google.com/thumbnail?id=${gdMatch[1]}&sz=w1080`;
    // Google Drive: open?id=ID
    const gdOpen = url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
    if (gdOpen) return `https://drive.google.com/thumbnail?id=${gdOpen[1]}&sz=w1080`;
    return url;
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
    const posterUrl = resolveImageUrl(el.getAttribute('data-poster'));
    const posterNama = el.getAttribute('data-nama');
    // Reset state
    img.style.display = 'none';
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
    img.onload = () => { loading.style.display = 'none'; img.style.display = 'block'; };
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
// 25. CUSTOM SEARCHABLE SELECT (pengganti dropdown <select> native)
// ============================================================
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
        trigger.innerHTML = '<span class="cs-select-value"></span><i class="fa-solid fa-chevron-down cs-select-caret"></i>';
        wrapper.appendChild(trigger);

        const panel = document.createElement('div');
        panel.className = 'cs-select-panel';
        const searchPlaceholder = selectEl.getAttribute('data-search-placeholder') || 'Cari paket umroh...';
        panel.innerHTML =
            '<div class="cs-select-search-wrap"><i class="fa-solid fa-magnifying-glass"></i>' +
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
                optionsWrap.innerHTML = '<div class="cs-select-empty"><i class="fa-solid fa-magnifying-glass" style="margin-right:6px;"></i>Paket tidak ditemukan</div>';
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

console.log('🚀 Amiru Admin Dashboard loaded!');
