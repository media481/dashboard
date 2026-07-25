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
let kbJamaahList = [], kbSelectedProgram = null, editingKbId = null;
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
    return escapeHtml(str).replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
}

function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toastMessage');
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
    if (tabId === 'keberangkatan') renderKbProgramSelector();
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
            currentData = dataUmroh.filter(p => p.is_active !== false).sort((a,b) => (a.dateObj||0) - (b.dateObj||0));
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
        currentData = dataUmroh.filter(p => p.is_active !== false).sort((a,b) => (a.dateObj||0) - (b.dateObj||0));
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

// ============================================================
// 9. RENDER TABLE
// ============================================================
function renderTable(data) {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    const now = new Date();
    const canEdit = canManageProgramData(); // admin & user boleh edit/hapus, guest & publik hanya lihat
    if (!data || !data.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--ink-soft);">
            <i class="fa-solid fa-inbox" style="font-size:24px;display:block;margin-bottom:10px;"></i>
            Belum ada program umroh.${canEdit ? ' Klik "Tambah" untuk menambahkan.' : ''}
        </td></tr>`;
        return;
    }

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

        return `<tr>
            <td><strong>${escapeHtml(item.nama||'')}</strong></td>
            <td>${escapeHtml(formatRupiah(item.harga_quint))}</td>
            <td>${escapeHtml(item.tgl||'-')}</td>
            <td>${escapeHtml(item.durasi||'-')}</td>
            <td>${escapeHtml(item.maskapai||'-')}</td>
            <td>
                <div class="action-btns">
                    <button onclick="openDetailModal('${item.id}')" title="Detail"><i class="fa-solid fa-eye"></i></button>
                    ${canEdit ? `
                    <button onclick="editAdminProgram('${item.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button class="danger" onclick="openDeleteModal('programs','${item.id}','${escapeJsAttr(item.nama)}')" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                    ` : ''}
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
        currentData = [...visiblePrograms].sort((a,b) => (a.dateObj||0) - (b.dateObj||0));
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
    alert(`📋 Detail Program\n\nNama: ${program.nama}\nTanggal: ${program.tgl}\nDurasi: ${program.durasi}\nMaskapai: ${program.maskapai}\nHarga: ${formatRupiah(program.harga_quint)}\n\n📱 Teks WA:\n${waText}`);
}

// ============================================================
// 12. ADMIN LOGIN
// ============================================================
async function loadUserRoles() {
    try {
        const { data, error } = await supabaseClient.from('app_config').select('key, value');
        if (error || !data) return;
        data.forEach(row => {
            // 'pass_administrator' tetap didukung sebagai alias lama untuk role 'admin'
            if (row.key === 'pass_admin' || row.key === 'pass_administrator') USER_ROLES[row.value] = { role: 'admin', label: 'Admin' };
            if (row.key === 'pass_user') USER_ROLES[row.value] = { role: 'user', label: 'User' };
            if (row.key === 'pass_guest') USER_ROLES[row.value] = { role: 'guest', label: 'Guest' };
        });
    } catch (_) {}
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
            showToast('⏰ Sesi berakhir, silakan login ulang.', 'error');
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

function checkAdminLogin() {
    const pwd = document.getElementById('adminPasswordInput')?.value;
    const errorDiv = document.getElementById('adminLoginError');
    if (!errorDiv) return;

    if (Date.now() < loginLockTime) {
        const waitSeconds = Math.ceil((loginLockTime - Date.now()) / 1000);
        errorDiv.innerText = `⏳ Terlalu banyak percobaan. Coba lagi ${waitSeconds} detik.`;
        return;
    }
    if (loginLockTime && Date.now() >= loginLockTime) {
        loginAttempts = 0;
        loginLockTime = 0;
    }

    const matchedUser = USER_ROLES[pwd];
    if (matchedUser) {
        loginAttempts = 0;
        setAdminSession(matchedUser.role);
        closeAdminPanel();
        renderSidebarNav();
        showToast(`✅ Berhasil login sebagai ${matchedUser.label}`);
    } else {
        loginAttempts++;
        if (loginAttempts >= 5) {
            loginLockTime = Date.now() + 60000;
            errorDiv.innerText = '❌ Terlalu banyak percobaan. Coba lagi 1 menit.';
        } else {
            errorDiv.innerText = `❌ Password salah! Sisa percobaan: ${5 - loginAttempts}`;
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
        const { error } = await supabaseClient.from('app_config').upsert(rows, { onConflict: 'key' });
        if (error) throw error;
        USER_ROLES = {};
        await loadUserRoles();
        ['us_pass_admin','us_pass_user','us_pass_guest'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--success);font-size:12.5px;">✅ Password berhasil disimpan.</span>';
        showToast('Pengaturan user berhasil disimpan');
    } catch (err) {
        console.error('saveUserSettings error:', err);
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);font-size:12.5px;">❌ Gagal menyimpan: ${escapeHtml(err.message)}</span>`;
        showToast('Gagal menyimpan pengaturan user', 'error');
    }
}

function logoutAdmin() {
    adminLoggedIn = false;
    currentRole = null;
    sessionStorage.removeItem('admin_logged_in');
    sessionStorage.removeItem('admin_role');
    sessionStorage.removeItem('admin_login_time');
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
        <div class="admin-login-top">
            <div class="admin-login-icon"><i class="fa-solid fa-shield-halved"></i></div>
            <h3>Admin Panel</h3>
            <p>Masukkan password untuk masuk</p>
        </div>
        <div class="admin-login-body">
            <div class="admin-role-chip"><i class="fa-solid fa-user-shield"></i> <span><b>Admin</b> — akses penuh</span></div>
            <div class="admin-role-chip"><i class="fa-solid fa-user-pen"></i> <span><b>User</b> — kelola data program</span></div>
            <div class="admin-role-chip"><i class="fa-solid fa-eye"></i> <span><b>Guest</b> — lihat data saja</span></div>
            <input type="password" id="adminPasswordInput" placeholder="Password" onkeydown="if(event.key==='Enter')checkAdminLogin()">
            <button onclick="checkAdminLogin()" class="btn-primary"><i class="fa-solid fa-arrow-right-to-bracket"></i> Masuk</button>
            <div id="adminLoginError" class="admin-login-error"></div>
        </div>
    </div>`;
}

const ADMIN_SUBTAB_META = {
    program: { title: 'Edit & Tambah Program', subtitle: 'Kelola data program umroh' },
    crosscheck: { title: 'Crosscheck', subtitle: 'Bandingkan poster dengan data program yang tersimpan' },
    telegram: { title: 'Telegram', subtitle: 'Atur notifikasi otomatis ke grup/chat Telegram' },
    usersettings: { title: 'Pengaturan User', subtitle: 'Atur password untuk masing-masing role' }
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

    if (name === 'crosscheck') { renderCxProgramSelector(); if (cxSelectedProgram) renderCxPanel(cxSelectedProgram); }
    if (name === 'telegram') { renderTgRecipients(); }
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
                    <button class="admin-form-close" onclick="hideAdminForm()">&times;</button>
                </div>
                <div class="admin-form-body">
                    <div id="parseBroadcastBox" class="admin-broadcast-box">
                        <div class="label"><i class="fa-solid fa-wand-magic-sparkles"></i> Auto-isi dari Teks Broadcast</div>
                        <textarea id="parseBroadcastInput" rows="3" placeholder="Paste teks broadcast program umroh di sini..."></textarea>
                        <div class="bc-actions">
                            <button onclick="parseBroadcastText()"><i class="fa-solid fa-wand-magic-sparkles"></i> Isi Otomatis</button>
                            <span id="parseStatus" style="font-size:12px;color:var(--success);font-weight:600;display:none;"></span>
                        </div>
                    </div>

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
                        <div class="form-row">
                            <div class="form-group">
                                <label>Harga Quad</label>
                                <input type="text" id="admin_harga_quad" placeholder="Rp 35.000.000" maxlength="50">
                            </div>
                            <div class="form-group">
                                <label>Harga Double</label>
                                <input type="text" id="admin_harga_double" placeholder="Rp 42.000.000" maxlength="50">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Harga Triple</label>
                                <input type="text" id="admin_harga_triple" placeholder="Rp 37.500.000" maxlength="50">
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
            <div class="admin-subtab-panel" id="adminSubTab-crosscheck" style="display:none;">
                <div class="admin-section-header">
                    <div><h4><i class="fa-solid fa-magnifying-glass-chart"></i> Crosscheck Data Program</h4>
                    <p>Poster dibaca otomatis (OCR) & dibandingkan dengan data teks program saat disimpan</p></div>
                </div>
                <div class="cx-label-sm">Pilih Program:</div>
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
                    <b>📌 Cara Setup:</b><br>
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
                    <p style="color:var(--ink-soft);font-size:11px;margin-bottom:6px;">▶ LOG PENGIRIMAN TELEGRAM:</p>
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
    document.getElementById('adminFormTitle').innerText = 'Tambah Program Baru';
    document.getElementById('adminFormContainer').style.display = 'block';
    document.getElementById('adminFormContainer').scrollIntoView({ behavior: 'smooth' });
}

function hideAdminForm() {
    document.getElementById('adminFormContainer').style.display = 'none';
}

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
        if (activePanel && (activePanel.id === 'tab-info' || activePanel.id === 'tab-keberangkatan')) {
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
        hideAdminForm();
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
    if (currentRole !== 'admin') { showToast('Hanya Admin yang boleh menghapus semua data', 'error'); return; }
    if (!confirm('⚠️ PERINGATAN: Hapus SEMUA program?')) return;
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
    showToast('⏳ Menyiapkan backup...');
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
        showToast(`✅ Backup berhasil — ${backup.programs.length} program`);
    } catch (err) {
        showToast('❌ Gagal backup: ' + err.message, 'error');
    }
}

function importAdminData() {
    if (currentRole !== 'admin') { showToast('Hanya Admin yang boleh import data', 'error'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > MAX_FILE_SIZE) { showToast('❌ File terlalu besar! Maksimal 5MB.', 'error'); return; }
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const imported = JSON.parse(event.target.result);
                if (imported && imported._meta && imported.programs) {
                    if (!confirm(`Restore backup dari ${new Date(imported._meta.exported_at).toLocaleString('id-ID')}?\n\n• ${imported.programs.length} program\n\nData yang ada TIDAK akan dihapus, hanya ditambah/diperbarui.`)) return;
                    showToast('⏳ Mengimport data...');
                    let ok = 0;
                    for (const prog of imported.programs) {
                        if (prog.nama && isValidProgramName(prog.nama)) {
                            try {
                                const { error } = await supabaseClient.from('programs').upsert([prog], { onConflict: 'id' });
                                if (!error) ok++;
                            } catch {}
                        }
                    }
                    await loadDataFromSupabase(true);
                    await renderAdminPanel();
                    showToast(`✅ Import selesai — ${ok} program`);
                } else if (Array.isArray(imported)) {
                    if (!confirm(`Import ${imported.length} program?`)) return;
                    let ok = 0;
                    for (const prog of imported) {
                        if (prog.nama && isValidProgramName(prog.nama)) {
                            try {
                                const { error } = await supabaseClient.from('programs').upsert([prog], { onConflict: 'id' });
                                if (!error) ok++;
                            } catch {}
                        }
                    }
                    await loadDataFromSupabase(true);
                    await renderAdminPanel();
                    showToast(`✅ Import selesai — ${ok} program`);
                } else {
                    showToast('❌ Format file tidak dikenali', 'error');
                }
            } catch (err) {
                showToast('❌ Gagal: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// ============================================================
// 17. DELETE CONFIRM
// ============================================================
function openDeleteModal(table, id, name) {
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

    try {
        const result = await supabaseClient.from(deleteTarget.table).delete().eq('id', deleteTarget.id);
        if (result.error) throw result.error;

        showToast('Data berhasil dihapus');
        closeDeleteConfirmModal();

        if (deleteTarget.table === 'programs') {
            await loadDataFromSupabase(true);
            await renderAdminPanel();
        } else if (deleteTarget.table === 'jadwal_tamu') {
            await loadJadwal();
            renderJadwalSection();
        } else if (deleteTarget.table === 'kb_jamaah') {
            await loadKbJamaah();
            renderKbProgramSelector();
            updateMetrics();
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

function renderJadwalSection() {
    const grid = document.getElementById('jadwalGrid');
    if (!grid) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!jadwalList.length) {
        grid.innerHTML = `<div class="jadwal-empty"><i class="fa-solid fa-calendar-xmark"></i>Belum ada jadwal tamu. Klik "Tambah Jadwal" untuk menambahkan.</div>`;
        return;
    }

    const sorted = [...jadwalList].sort((a, b) => new Date(a.tgl) - new Date(b.tgl));
    grid.innerHTML = sorted.map(j => {
        const d = new Date(j.tgl);
        d.setHours(0, 0, 0, 0);
        const isToday = d.getTime() === today.getTime();
        const isPast = d < today;
        const tglFormatted = j.tgl ? new Date(j.tgl).toLocaleDateString('id-ID', {
            weekday: 'long',
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        }) : '-';

        return `<div class="jadwal-card ${isToday ? 'today' : ''}">
            <div class="jc-title">${escapeHtml(j.nama || 'Tamu')}</div>
            <div class="jc-meta">
                <span><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(tglFormatted)}</span>
                ${j.jam ? `<span><i class="fa-regular fa-clock"></i> ${escapeHtml(j.jam)}</span>` : ''}
                ${j.jumlah ? `<span><i class="fa-solid fa-users"></i> ${escapeHtml(String(j.jumlah))} orang</span>` : ''}
            </div>
            <div class="jc-meta" style="margin-top:4px;">
                ${j.keperluan ? `<span class="jc-badge">${escapeHtml(j.keperluan)}</span>` : ''}
                ${j.asal ? `<span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(j.asal)}</span>` : ''}
                ${isPast ? '<span style="color:var(--ink-soft);font-size:11px;">✅ Selesai</span>' : ''}
            </div>
            <div class="jc-actions" style="margin-top:8px;display:flex;gap:4px;justify-content:flex-end;">
                ${j.wa ? `<a href="https://wa.me/${j.wa.replace(/\D/g,'')}?text=Assalamualaikum%20${encodeURIComponent(j.nama||'')}%20kami%20dari%20PT%20Amiru%20Haramain%20Indonesia" target="_blank" style="background:#25D366;color:#fff;border:none;padding:2px 10px;border-radius:4px;font-size:11px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;"><i class="fab fa-whatsapp"></i></a>` : ''}
            </div>
        </div>`;
    }).join('');

    // Update badge
    const todayCount = jadwalList.filter(j => {
        const d = new Date(j.tgl);
        d.setHours(0, 0, 0, 0);
        return d.getTime() === today.getTime();
    }).length;
    const badge = document.getElementById('jadwalBadge');
    if (todayCount > 0) {
        badge.textContent = todayCount;
        badge.style.display = 'inline';
    } else {
        badge.style.display = 'none';
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
    if (!select) return;

    if (!dataUmroh || dataUmroh.length === 0) {
        select.innerHTML = '<option value="">-- Belum ada program --</option>';
        return;
    }

    // Keep current selection
    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Pilih Program --</option>' +
        dataUmroh.map(p => `<option value="${p.id}">${escapeHtml(p.nama)} (${escapeHtml(p.tgl || '-')})</option>`).join('');
    if (currentVal) select.value = currentVal;

    // Also populate modal select
    const modalSelect = document.getElementById('kb_program');
    if (modalSelect) {
        modalSelect.innerHTML = dataUmroh.map(p => `<option value="${p.id}">${escapeHtml(p.nama)}</option>`).join('');
    }

    // Load jamaah for selected program
    if (select.value) loadKbJamaahForProgram(select.value);
}

function selectKbProgram(id) {
    document.getElementById('kbProgramSelect').value = id;
    loadKbJamaahForProgram(id);
}

async function loadKbJamaahForProgram(programId) {
    const container = document.getElementById('kbJamaahContent');
    if (!programId) {
        container.innerHTML = `<div class="kb-no-program"><i class="fa-solid fa-plane-departure"></i><p>Pilih program di atas untuk melihat daftar jamaah.</p></div>`;
        return;
    }

    try {
        const { data, error } = await supabaseClient.from('kb_jamaah').select('*').eq('program_id', programId).order('nama', { ascending: true });
        if (error) throw error;

        const jamaah = data || [];
        if (!jamaah.length) {
            container.innerHTML = `<div class="kb-no-program"><i class="fa-solid fa-user-slash"></i><p>Belum ada jamaah terdaftar untuk program ini.</p></div>`;
            return;
        }

        const totalLunas = jamaah.filter(j => j.status === 'lunas').length;
        const totalDp = jamaah.filter(j => j.status === 'dp').length;

        container.innerHTML = `
            <div class="table-container" style="overflow-x:auto;">
                <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
                    <span class="status-badge available">${jamaah.length} Total Jamaah</span>
                    <span class="status-badge available">${totalLunas} Lunas</span>
                    ${totalDp > 0 ? `<span class="status-badge limited">${totalDp} DP / Cicilan</span>` : ''}
                </div>
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead style="background:var(--bg);">
                        <tr>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Nama</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">NIK</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Paspor</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${jamaah.map(j => `
                            <tr style="border-bottom:1px solid var(--line);">
                                <td style="padding:10px 14px;"><strong>${escapeHtml(j.nama)}</strong>${j.asal ? `<br><span style="font-size:11px;color:var(--ink-soft);">${escapeHtml(j.asal)}</span>` : ''}</td>
                                <td style="padding:10px 14px;">${j.nik || '-'}</td>
                                <td style="padding:10px 14px;">${j.paspor || '-'}</td>
                                <td style="padding:10px 14px;">
                                    <span class="status-badge ${j.status === 'lunas' ? 'available' : j.status === 'dp' ? 'limited' : 'full'}">
                                        ${j.status === 'lunas' ? '✅ Lunas' : j.status === 'dp' ? '🔄 DP/Cicilan' : '⏳ Pending'}
                                    </span>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
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

    // Pre-select program from selector
    const programSelect = document.getElementById('kbProgramSelect');
    const modalProgramSelect = document.getElementById('kb_program');
    if (programSelect.value) {
        modalProgramSelect.value = programSelect.value;
    }

    if (id) {
        const j = kbJamaahList.find(item => item.id === id);
        if (!j) { showToast('Data tidak ditemukan', 'error'); return; }
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
    }

    modal.classList.add('open');
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

    try {
        let result;
        if (id) {
            result = await supabaseClient.from('kb_jamaah').update(data).eq('id', id);
        } else {
            result = await supabaseClient.from('kb_jamaah').insert([data]);
        }
        if (result.error) throw result.error;

        showToast(id ? 'Data jamaah berhasil diperbarui' : 'Data jamaah berhasil ditambahkan');
        closeKbModal();
        await loadKbJamaah();
        if (document.getElementById('kbProgramSelect').value) {
            loadKbJamaahForProgram(document.getElementById('kbProgramSelect').value);
        }
        updateMetrics();

    } catch (err) {
        console.error('Save keberangkatan error:', err);
        showToast('Gagal menyimpan: ' + err.message, 'error');
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
            showToast(`⚠️ Crosscheck "${prog.nama}": ${mismatchCount} data tidak cocok dengan poster!`, 'error');
        } else {
            showToast(`✅ Crosscheck "${prog.nama}": semua data cocok dengan poster.`);
        }
    } catch (err) {
        showToast('❌ Pembacaan poster gagal: ' + err.message, 'error');
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

function renderCxProgramSelector() {
    const sel = document.getElementById('cxProgramSelector');
    if (!sel) return;
    if (!adminPrograms || !adminPrograms.length) {
        sel.innerHTML = '<div style="font-size:13px;color:var(--ink-soft);font-style:italic;">Belum ada program.</div>';
        return;
    }
    sel.innerHTML = adminPrograms.map(p => {
        const adl = (() => { try { return p.admin_data_lengkap ? (typeof p.admin_data_lengkap === 'string' ? JSON.parse(p.admin_data_lengkap) : p.admin_data_lengkap) : null; } catch(e) { return null; } })();
        const hasData = adl && Object.keys(adl).length > 0;
        const isActive = String(cxSelectedProgram) === String(p.id);
        const isScanning = cxScanningIds.has(String(p.id));
        const mismatchCount = adl && adl.poster_data ? cxCountMismatch(p.id) : 0;
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
        return rows.map(r => {
            const hasBoth = r.plain && r.poster;
            const isMatch = hasBoth && cxValuesMatch(r.field, r.plain, r.poster);
            const rowClass = hasBoth ? (isMatch ? 'cx-match' : 'cx-mismatch') : '';
            const pill = hasBoth ? `<span class="cx-match-pill ${isMatch?'ok':'no'}">${isMatch?'✓ Cocok':'✗ Beda'}</span>` : `<span class="cx-match-pill skip">—</span>`;
            return `<div class="cx-compare-row ${rowClass}">
                <div class="cx-compare-col"><div class="cx-compare-label"><i class="fa-solid fa-file-lines"></i> Teks</div><div class="cx-compare-val ${r.plain?'':'empty'}">${r.plain ? escapeHtml(r.plain) : '—'}</div></div>
                <div class="cx-divider"></div>
                <div class="cx-compare-col"><div class="cx-compare-label"><i class="fa-solid fa-image"></i> Poster</div><div class="cx-compare-val ${r.poster?'':'empty'}">${r.poster ? escapeHtml(r.poster) : '—'}</div></div>
                <div style="display:flex;align-items:center;padding-left:8px;"><div class="cx-compare-label" style="min-width:60px;">${escapeHtml(r.label)}</div></div>
                ${pill}
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
            ${hasPoster ? `<button class="cx-parse-btn" onclick="window.open('${escapeHtml(prog.link_poster)}','_blank')"><i class="fa-solid fa-image"></i> Lihat Poster</button>` : ''}
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
                <summary style="cursor:pointer;font-size:12px;font-weight:700;color:var(--brand);">📄 Lihat teks mentah hasil OCR</summary>
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
        showToast('✅ Data poster disimpan — crosscheck siap!');
    } catch (err) {
        showToast('❌ Gagal simpan: ' + err.message, 'error');
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
            <div class="fc-title">⭐ ${escapeHtml(p.nama)}</div>
            <div class="fc-meta">${escapeHtml(formatRupiah(p.harga_quint))} • ${escapeHtml(p.tgl)}</div>
            <div class="fc-meta" style="margin-top:4px;">${escapeHtml(p.maskapai || '')} • ${escapeHtml(p.durasi || '')}</div>
        </div>
    `).join('');
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
    if (!botToken) { showTgStatus('❌ Bot Token wajib diisi', 'err'); return; }
    if (!edgeUrl)  { showTgStatus('❌ Edge Function URL wajib diisi', 'err'); return; }
    const recipients = collectTgRecipients();
    if (!recipients.length) { showTgStatus('❌ Tambahkan minimal 1 penerima', 'err'); return; }
    showTgStatus('⏳ Menyimpan...', 'ok');
    try {
        const rows = [
            { key: 'botToken', value: botToken },
            { key: 'edgeUrl', value: edgeUrl },
            { key: 'recipients', value: JSON.stringify(recipients) },
        ];
        const { error } = await supabaseClient.from('tg_config').upsert(rows, { onConflict: 'key' });
        if (error) throw error;
        _tgConfigCache = null;
        showTgStatus('✅ Konfigurasi tersimpan!', 'ok');
    } catch (err) {
        showTgStatus('❌ Gagal simpan: ' + err.message, 'err');
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
    list.innerHTML = '<p style="color:var(--ink-soft);font-size:12px;">⏳ Memuat konfigurasi...</p>';
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
        { val: 'program', label: '📦 Program Baru' },
        { val: 'jadwal', label: '📅 Jadwal Tamu' },
        { val: 'reminder', label: '🔔 Pengingat 1 Bulan' },
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
    el.innerHTML = `<span class="tg-status ${type}">${escapeHtml(msg)}</span>`;
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
            if (res.ok && result.ok !== false) logTg('✅ Terkirim ke ' + target.label, true);
            else logTg('❌ Gagal ke ' + target.label + ': ' + (result.description || res.status), false);
        } catch (err) {
            logTg('❌ Error ke ' + target.label + ': ' + err.message, false);
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

    showTgStatus('⏳ Mengirim test...', 'ok');
    await sendTelegramNotif(msgProgram, 'program');
    await sendTelegramNotif(msgJadwal, 'jadwal');
    await sendTelegramNotif(msgReminder, 'reminder');
    showTgStatus('✅ Test selesai! Cek log di bawah.', 'ok');
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
    await loadKbJamaah();
    await loadDataFromSupabase();

    // Render sections
    renderJadwalSection();
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

console.log('🚀 Amiru Admin Dashboard loaded!');
