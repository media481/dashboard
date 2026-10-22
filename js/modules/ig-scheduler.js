// ============================================================
// MODUL LAZY: IG SCHEDULER  (js/modules/ig-scheduler.js)
// ============================================================
// Dipecah dari js/app.js (bagian "24. INSTAGRAM CONTENT SCHEDULER" s/d 24h) dan dimuat
// HANYA saat halaman IG Scheduler dibuka (lihat ensureModuleLoaded() di app.js).
//
// Dimuat sebagai <script> biasa (BUKAN ES module), jadi tetap satu lingkup global dengan
// app.js: `let/const` tingkat-atas modul ini terlihat oleh app.js dan sebaliknya, nama
// fungsi global tidak berubah, dan onclick="..." / data-action="..." tetap jalan.
//
// ATURAN:
//  - Jangan mendeklarasikan ulang nama yang sudah ada di app.js (const/let ganda = SyntaxError
//    dan seluruh modul gagal dimuat). Konstanta IG yang dipakai kode inti (IG_PILLARS,
//    IG_AUTOPUBLISH_ENABLED, IG_CAPTION_FUNCTION_URL) tinggal di app.js.
//  - Fungsi yang dipanggil dari index.html / kode inti SEBELUM modul dimuat harus terdaftar di
//    LAZY_MODULES['ig-scheduler'].api di app.js (dibuatkan stub otomatis).
// ============================================================

// ============================================================
// 24. INSTAGRAM CONTENT SCHEDULER
// ============================================================
// State untuk IG Scheduler tab. Data diambil langsung dari Supabase
// via supabaseClient (tabel ig_posts, ig_accounts, ig_publish_logs).
// Semua panggilan ke Instagram Graph API hanya lewat Edge Function
// (ig-publish / ig-refresh-token / ig-manual-retry) — token IG tidak
// pernah bocor ke client.
const IG_STORAGE_BUCKET = 'ig-media';
const IG_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const IG_POSTS_PAGE_SIZE = 50;

let igPosts = [];              // cache post list
let igPostsCurrentPage = 1;
let igPostsTotal = 0;
let igSaving = false;           // guard klik ganda tombol Simpan Draft
let igQuickAdding = false;      // guard klik ganda / Enter+Tambah di form ide cepat
let igUploadsInFlight = 0;      // jumlah upload media yang sedang berjalan (Simpan diblok selama >0)
const igSessionUploads = new Set(); // URL media yang diupload di sesi modal ini (dibersihkan dari bucket kalau tidak jadi dipakai)
let igOriginalMediaUrls = [];   // URL media post yang sedang diedit sebelum diubah (dibersihkan kalau diganti)
let igAccounts = [];           // akun IG aktif (tanpa access_token)
let igCalendarCurrent = new Date(); // bulan yang sedang ditampilkan di kalender
let igCommentsUnrepliedCountByPost = {}; // { post_id: jumlah komentar belum dibalas }
let igCommentsCurrentPostId = null;      // post_id yang sedang dibuka di modal komentar
const IG_COMMENT_ACTION_URL = `${SUPABASE_URL}/functions/v1/ig-comment-action`;
const IG_SYNC_COMMENTS_URL = `${SUPABASE_URL}/functions/v1/ig-sync-comments`;

// ---- Content Planner Bulanan ----
const IG_CONTENT_PLAN_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/generate-ig-content-plan`;
let igContentPlan = [];        // cache semua baris ig_content_plan (status idea/dijadikan_post/dilewati)
let igActivePlanId = null;     // diisi saat modal upload dibuka dari tombol "Jadikan Post" -- dipakai saveIgPost untuk update status rencana setelah post tersimpan

// Badge warna sesuai status post
const IG_STATUS_COLORS = {
    draft: 'var(--ink-soft)',
    scheduled: 'var(--brand)',
    publishing: 'var(--warn)',
    published: 'var(--success)',
    failed: 'var(--danger)'
};
const IG_STATUS_LABELS = {
    draft: 'Draft',
    scheduled: 'Terjadwal',
    publishing: 'Mempublikasi',
    published: 'Dipublikasi',
    failed: 'Gagal'
};

// ---- Load IG posts ----
async function loadIgPosts(forceRefresh = false) {
    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('ig_posts').select('*').order('created_at', { ascending: false }),
            { label: 'Muat daftar post IG' }
        );
        if (error) throw error;
        igPosts = data || [];
        igPostsTotal = igPosts.length;
        renderIgPostTable();
        updateIgSchedulerCount();
        renderIgCalendar(); // refresh calendar markers
    } catch (err) {
        console.error('loadIgPosts error:', err);
        showToast('Gagal memuat daftar post IG: ' + err.message, 'error');
    }
}

// Tombol Refresh: muat ulang post DAN rencana konten (sebelumnya hanya post, jadi
// ide yang ditambah/diubah orang lain di sesi lain tidak ikut muncul).
async function igRefreshAll() {
    await Promise.all([loadIgPosts(true), loadIgContentPlan(), loadIgTasks()]);
    showToast('Data diperbarui', 'success');
}
window.igRefreshAll = igRefreshAll;

// ---- Load IG accounts (tanpa expose access_token) ----
async function loadIgAccounts() {
    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('ig_accounts').select('id, ig_user_id, fb_page_id, token_expires_at, is_active').eq('is_active', true).order('created_at', { ascending: false }),
            { label: 'Muat akun IG' }
        );
        if (error) throw error;
        igAccounts = data || [];
        renderIgAccountStatus();
        // isi dropdown akun di modal upload jika terbuka
        const picker = document.getElementById('ig_account_id');
        if (picker) {
            const currentVal = picker.value;
            picker.innerHTML = '<option value="">-- Pilih Akun IG --</option>' +
                igAccounts.map(a => `<option value="${a.id}">IG User ${a.ig_user_id}</option>`).join('');
            if (currentVal) picker.value = currentVal;
        }
    } catch (err) {
        console.error('loadIgAccounts error:', err);
    }
}

// ---- Render account status bar ----
function renderIgAccountStatus() {
    const wrap = document.getElementById('igAccountStatus');
    const nameEl = document.getElementById('igAccountName');
    const badge = document.getElementById('igAccountBadge');
    const expiry = document.getElementById('igAccountExpiry');
    if (!wrap || !nameEl || !badge || !expiry) return;

    const active = igAccounts.find(a => a.is_active);
    if (!active) {
        wrap.style.display = 'none';
        return;
    }

    wrap.style.display = 'block';
    nameEl.textContent = `IG Business #${active.ig_user_id.slice(-6)}`;

    // Hitung hari tersisa token
    const expiresAt = new Date(active.token_expires_at);
    const now = new Date();
    const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

    if (daysLeft <= 0) {
        badge.textContent = 'Expired';
        badge.className = 'ig-account-badge ig-account-expired';
        expiry.textContent = 'Token sudah kadaluarsa — refresh diperlukan';
    } else if (daysLeft < 10) {
        badge.textContent = 'Perlu Refresh';
        badge.className = 'ig-account-badge ig-account-warn';
        expiry.textContent = `Token berakhir dalam ${daysLeft} hari`;
    } else {
        badge.textContent = 'Active';
        badge.className = 'ig-account-badge ig-account-active';
        expiry.textContent = `${daysLeft} hari tersisa`;
    }
}

// ---- Render post list table ----
function renderIgPostTable() {
    const tbody = document.getElementById('igPostTableBody');
    if (!tbody) return;

    const listBox = tbody.closest('.ig-post-list-container');
    if (listBox) listBox.style.display = (!igPosts.length && !IG_AUTOPUBLISH_ENABLED) ? 'none' : '';

    if (!igPosts.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="ig-empty"><i class="bi bi-instagram"></i>Belum ada post IG. Klik "Post Baru" untuk mulai.</div></td></tr>`;
        return;
    }

    const totalPages = Math.max(1, Math.ceil(igPosts.length / IG_POSTS_PAGE_SIZE));
    if (igPostsCurrentPage > totalPages) igPostsCurrentPage = totalPages;
    const start = (igPostsCurrentPage - 1) * IG_POSTS_PAGE_SIZE;
    const pageItems = igPosts.slice(start, start + IG_POSTS_PAGE_SIZE);

    tbody.innerHTML = pageItems.map(post => {
        const scheduleFormatted = post.schedule_time ? new Date(post.schedule_time).toLocaleString('id-ID', {
            weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        }) : '-';
        const publishedFormatted = post.published_at ? new Date(post.published_at).toLocaleString('id-ID', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : '-';

        const statusColor = IG_STATUS_COLORS[post.status] || IG_STATUS_COLORS.draft;
        const statusLabel = IG_STATUS_LABELS[post.status] || post.status;

        // Preview media (untuk carousel, media_url berisi item pertama —
        // ditandai badge kecil biar kelihatan itu carousel bukan single image)
        let mediaPreview = '';
        if (post.media_type === 'image') {
            mediaPreview = `<img src="${escapeHtmlAttr(post.media_url)}" alt="media" class="ig-media-thumb" loading="lazy">`;
        } else if (post.media_type === 'video') {
            mediaPreview = `<video src="${escapeHtmlAttr(post.media_url)}" class="ig-media-thumb" preload="none"></video>`;
        } else if (post.media_type === 'carousel' && post.media_url) {
            mediaPreview = `<div class="ig-post-carousel-thumb-wrap">
                <img src="${escapeHtmlAttr(post.media_url)}" alt="carousel" class="ig-media-thumb" loading="lazy">
                <span class="ig-post-carousel-count" title="Carousel"><i class="bi bi-images"></i></span>
            </div>`;
        } else {
            mediaPreview = `<div class="ig-media-thumb ig-carousel-thumb"><i class="bi bi-images"></i></div>`;
        }

        // Aksi berdasarkan status
        const actions = [];
        if (IG_AUTOPUBLISH_ENABLED && post.status === 'failed') {
            actions.push(`<button type="button" class="ig-btn-retry" onclick="openIgActionModal('${post.id}', 'retry')" title="Retry Publish"><i class="bi bi-arrow-counterclockwise"></i> Retry</button>`);
        }
        if (['draft', 'scheduled', 'failed'].includes(post.status)) {
            actions.push(`<button type="button" class="ig-btn-edit" onclick="openIgUploadModal('${post.id}')" title="Edit"><i class="bi bi-pencil-fill"></i></button>`);
        }
        if (post.status === 'failed' || post.status === 'draft') {
            actions.push(`<button type="button" class="ig-btn-delete" onclick="openIgActionModal('${post.id}', 'delete')" title="Hapus"><i class="bi bi-trash-fill"></i></button>`);
        }
        if (post.last_error) {
            actions.push(`<button type="button" class="ig-btn-log" onclick="openIgActionModal('${post.id}', 'logs', null, '${escapeJsAttr(post.last_error || '')}')" title="Lihat Error"><i class="bi bi-info-circle-fill"></i></button>`);
        }
        if (IG_AUTOPUBLISH_ENABLED && post.status === 'published' && post.ig_media_id) {
            const unreplied = (igCommentsUnrepliedCountByPost[post.id] || 0);
            const badge = unreplied > 0 ? `<span class="ig-comment-badge">${unreplied}</span>` : '';
            actions.push(`<button type="button" class="ig-btn-comments" onclick="filterIgCommentsPanel('${post.id}')" title="Komentar"><i class="bi bi-chat-dots-fill"></i>${badge}</button>`);
        }

        return `<tr class="ig-post-row status-${post.status}">
            <td class="ig-post-media">${mediaPreview}</td>
            <td class="ig-post-caption">${escapeHtml(post.caption || '(tanpa caption)')}</td>
            <td class="ig-post-schedule">${escapeHtml(scheduleFormatted)}</td>
            <td class="ig-post-status"><span class="ig-status-pill" style="background:${statusColor}1a;color:${statusColor};">${escapeHtml(statusLabel)}</span></td>
            <td class="ig-post-published">${escapeHtml(publishedFormatted)}</td>
            <td class="ig-post-actions">${actions.join('')}</td>
        </tr>`;
    }).join('');

    // Pagination
    const paginationInfo = document.getElementById('igPostPagination') || (() => {
        const div = document.createElement('div');
        div.id = 'igPostPagination';
        div.className = 'ig-pagination';
        tbody.parentNode.parentNode.appendChild(div);
        return div;
    })();

    paginationInfo.innerHTML = `<span>Halaman ${igPostsCurrentPage} dari ${totalPages}</span>`;
    if (igPosts.length > IG_POSTS_PAGE_SIZE) {
        paginationInfo.innerHTML += `
            <button ${igPostsCurrentPage <= 1 ? 'disabled' : ''} onclick="igPrevPage()" style="padding:4px 10px;font-size:12px;border:1px solid var(--line);border-radius:6px;background:var(--surface);cursor:pointer;">‹ Prev</button>
            <button ${igPostsCurrentPage >= totalPages ? 'disabled' : ''} onclick="igNextPage()" style="padding:4px 10px;font-size:12px;border:1px solid var(--line);border-radius:6px;background:var(--surface);cursor:pointer;">Next ›</button>`;
    }
}

function igPrevPage() {
    if (igPostsCurrentPage > 1) {
        igPostsCurrentPage--;
        renderIgPostTable();
    }
}
function igNextPage() {
    const totalPages = Math.max(1, Math.ceil(igPosts.length / IG_POSTS_PAGE_SIZE));
    if (igPostsCurrentPage < totalPages) {
        igPostsCurrentPage++;
        renderIgPostTable();
    }
}

function updateIgSchedulerCount() {
    const el = document.getElementById('igSchedulerCount');
    if (!el) return;
    const totalUnread = Object.values(igCommentsUnrepliedCountByPost).reduce((a, b) => a + b, 0);
    el.textContent = `${igPosts.length} post` + (totalUnread > 0 ? ` · ${totalUnread} komentar baru` : '');
}

// ---- Calendar ----
// Tanggal acuan sebuah post di kalender: pakai jadwal jika ada, kalau tidak pakai waktu publish
function igPostRefDate(post) {
    const raw = post.schedule_time || post.published_at;
    return raw ? new Date(raw) : null;
}

// ---- MODE CONTENT PLANNER ----
const IG_STAGES = { ide: 'Ide', dikerjakan: 'Dikerjakan', siap: 'Siap posting' };
let igPlannerColsReady = false; // true kalau sql/45_tambah_ig_content_plan_planner.sql sudah dijalankan (kolom pilar & tahap)
let igTeksGambarReady = false;  // true kalau sql/46_tambah_ig_content_plan_pola_amiru.sql sudah dijalankan (kolom teks_gambar)
let igCanvaReady = false;       // true kalau sql/56_tambah_ig_content_plan_canva.sql sudah dijalankan (kolom canva_url)
let igTemaMingguReady = false;  // true kalau sql/47_tambah_ig_content_plan_tema_minggu.sql sudah dijalankan (kolom tema_minggu)

function igApplyPlannerMode() {
    const root = document.getElementById('igSchedulerPageView');
    if (!root) return;
    root.classList.toggle('ig-planner-mode', !IG_AUTOPUBLISH_ENABLED);
    if (IG_AUTOPUBLISH_ENABLED) return;
    const h = root.querySelector('.admin-page-header h1 span');
    const sub = root.querySelector('.admin-page-header p');
    if (h) h.textContent = 'Content Planner';
    if (sub) sub.textContent = 'Rencanakan ide, caption, dan jadwal konten Instagram';
    const up = document.getElementById('btnIgUpload');
    if (up) { up.className = 'btn-secondary'; up.textContent = 'Draft Post'; up.title = 'Buat draft post dengan media'; }
    // Toolbar bersih tanpa ikon: label teks saja
    const rf = document.getElementById('btnIgRefresh');
    if (rf) { rf.textContent = 'Refresh'; rf.title = 'Refresh data'; }
    const ai = document.getElementById('btnIgContentPlan');
    if (ai) ai.textContent = 'Perencanaan Konten';
    const submit = document.getElementById('igSubmitBtn');
    if (submit) submit.innerHTML = '<i class="bi bi-save"></i> Simpan Draft';
}

// Ide baru: buka modal harian (ada form tambah cepat) di hari ini / tanggal 1 bulan yang tampil
function igNewIdea() {
    const t = new Date();
    const c = igCalendarCurrent;
    const d = (t.getFullYear() === c.getFullYear() && t.getMonth() === c.getMonth()) ? t : new Date(c.getFullYear(), c.getMonth(), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    igOpenDayModal(key);
    setTimeout(() => document.getElementById('igQuickPlanTema')?.focus(), 60);
}

const IG_QUICK_IDEAS = ['Testimoni jamaah', 'Tips persiapan manasik', 'Info keberangkatan terdekat', 'Tanya jawab / polling', 'Behind the scenes tim', 'Promo seat terbatas'];

function igFillPlannerSelects() {
    const wrap = document.getElementById('igQuickPilarChips');
    if (wrap && !wrap.children.length) {
        wrap.innerHTML = Object.entries(IG_PILLARS).map(([k, v]) =>
            `<button type="button" class="ig-dm-pill" data-k="${k}" style="--pillar:${v.color};" onclick="igPickQuickPilar('${k}')">${escapeHtml(v.label)}</button>`).join('');
    }
    document.querySelectorAll('.ig-quick-meta').forEach(n => { n.style.display = igPlannerColsReady ? '' : 'none'; });
}
function igPickQuickTipe(t) {
    const inp = document.getElementById('igQuickPlanTipe');
    if (inp) inp.value = t;
    document.querySelectorAll('#igQuickTipeSeg button').forEach(b => b.classList.toggle('active', b.dataset.t === t));
}
function igPickQuickPilar(k) {
    const inp = document.getElementById('igQuickPlanPilar');
    if (!inp) return;
    inp.value = inp.value === k ? '' : k; // klik lagi = lepas pilihan
    document.querySelectorAll('#igQuickPilarChips .ig-dm-pill').forEach(b => b.classList.toggle('active', b.dataset.k === inp.value));
}
function igFillQuickIdea(i) {
    const el = document.getElementById('igQuickPlanTema');
    if (el) { el.value = IG_QUICK_IDEAS[i] || ''; el.focus(); }
}

function igPlanMetaSelects(pl) {
    const pil = '<option value="">Pilar...</option>' + Object.entries(IG_PILLARS).map(([k, v]) =>
        `<option value="${k}"${pl.pilar === k ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('');
    const tah = Object.entries(IG_STAGES).map(([k, v]) =>
        `<option value="${k}"${(pl.tahap || 'ide') === k ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
    return `<select class="ig-plan-edit-tipe" onchange="igPlanUpdateField('${pl.id}','pilar',this.value)">${pil}</select>
            <select class="ig-plan-edit-tipe" onchange="igPlanUpdateField('${pl.id}','tahap',this.value)">${tah}</select>`;
}

function igPlanBadgeHtml(pl) {
    const stage = IG_STAGES[pl.tahap || 'ide'] || 'Ide';
    const pil = IG_PILLARS[pl.pilar];
    return `<span class="ig-status-pill ig-status-pill-plan">${escapeHtml(stage)}</span>` +
        (pil ? `<span class="ig-status-pill" style="background:${pil.color}1a;color:${pil.color};">${escapeHtml(pil.label)}</span>` : '');
}

// Filter tampilan kalender: 'all' | 'plan' (hanya ide/rencana) | 'post' (hanya post IG)
let igCalFilter = 'all';
const IG_TYPE_ICONS = { image: 'bi-image', video: 'bi-camera-reels', carousel: 'bi-images' };
const IG_TYPE_LABELS = { image: 'Image', video: 'Reels', carousel: 'Carousel' };
const IG_CAL_MAX_CHIPS = 3; // jumlah chip per sel sebelum diringkas "+N lagi"

function igSetCalFilter(filter) {
    igCalFilter = ['all', 'plan', 'post'].includes(filter) ? filter : 'all';
    renderIgCalendar();
}

// Teks singkat untuk chip: baris pertama caption / tema, dipotong lewat CSS (ellipsis)
function igChipText(text, fallback) {
    const first = String(text || '').split('\n').find(l => l.trim()) || '';
    return first.trim() || fallback;
}

// Awalan peran Pola 7 Hari di judul ide ("Rasakan: ...", "Siapkan (carousel) — ..."). Perannya sudah ditentukan hari
// dalam pekan, jadi di chip kalender awalan ini hanya memakan tempat; yang membedakan ide adalah topiknya.
// Teks lengkap tetap ada di tooltip chip dan di panel/modal.
const IG_AWALAN_PERAN = /^(?:rasakan|pahami|siapkan|bayangkan|hindari|terinspirasi|renungkan|sambut|kenali|amalkan|tanya jawab|rencanakan|hitung|pertimbangkan)\b(?:\s*\([^)]*\))?\s*[:\u2014\u2013-]\s*/i;
function igChipTopik(teks) {
    const t = String(teks || '');
    const sisa = t.replace(IG_AWALAN_PERAN, '').trim();
    return sisa ? sisa.charAt(0).toUpperCase() + sisa.slice(1) : t;
}

function renderIgCalendar() {
    const monthEl = document.getElementById('igCalMonth');
    const daysEl = document.getElementById('igCalDays');
    if (!monthEl || !daysEl) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const year = igCalendarCurrent.getFullYear();
    const month = igCalendarCurrent.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDay = firstDay.getDay(); // 0 = Minggu
    const totalDays = lastDay.getDate();

    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    monthEl.textContent = `${monthNames[month]} ${year}`;

    // Kelompokkan semua post bulan ini berdasarkan tanggal
    const postsByDay = {};
    const monthPosts = [];
    igPosts.forEach(p => {
        const d = igPostRefDate(p);
        if (!d || d.getFullYear() !== year || d.getMonth() !== month) return;
        monthPosts.push(p);
        (postsByDay[d.getDate()] = postsByDay[d.getDate()] || []).push(p);
    });

    // Kelompokkan rencana konten (status 'idea' saja -- yang sudah 'dijadikan_post'
    // tidak perlu chip terpisah karena post aslinya sudah tampil dari igPosts,
    // dan yang 'dilewati' memang sengaja disembunyikan dari kalender).
    const planByDay = {};
    const seriesByDay = {};   // nama tema / seri pekan per tanggal (ide aktif maupun yang sudah jadi post)
    const monthPlans = [];
    // Untuk bar keseimbangan pilar: ide aktif + ide yang sudah dijadikan post
    // (post IG tidak punya kolom pilar, jadi pilarnya diambil dari rencana asalnya).
    const pillarPlans = [];
    igContentPlan.forEach(pl => {
        if (!pl.tanggal) return;
        const [py, pm, pd] = pl.tanggal.split('-').map(Number);
        if (py !== year || (pm - 1) !== month) return;
        if (pl.status === 'idea' || pl.status === 'dijadikan_post') {
            pillarPlans.push(pl);
            if (pl.tema_minggu && !seriesByDay[pd]) seriesByDay[pd] = pl.tema_minggu;
        }
        if (pl.status !== 'idea') return;
        monthPlans.push(pl);
        (planByDay[pd] = planByDay[pd] || []).push(pl);
    });

    const showPosts = igCalFilter !== 'plan';
    const showPlans = igCalFilter !== 'post';
    const canDrag = typeof canManageProgramData === 'function' && canManageProgramData();

    let html = '';

    // Sel kosong untuk hari terakhir bulan sebelumnya
    for (let i = 0; i < startDay; i++) {
        html += `<div class="ig-cal-day ig-cal-empty"></div>`;
    }

    let emptyFutureDays = 0;
    for (let day = 1; day <= totalDays; day++) {
        const cellDate = new Date(year, month, day);
        const isToday = cellDate.getTime() === today.getTime();
        const isPast = cellDate.getTime() < today.getTime();
        const isWeekend = cellDate.getDay() === 0 || cellDate.getDay() === 6;
        const allDayPosts = (postsByDay[day] || []).slice().sort((a, b) => igPostRefDate(a) - igPostRefDate(b));
        const allDayPlans = planByDay[day] || [];
        const dayPosts = showPosts ? allDayPosts : [];
        const dayPlans = showPlans ? allDayPlans : [];
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        // Hitung hari kosong (belum ada post maupun ide) dari hari ini ke depan
        if (!isPast && !allDayPosts.length && !allDayPlans.length) emptyFutureDays++;

        // Chip per item: post dulu (urut jam), lalu ide
        const chips = [];
        dayPosts.forEach(p => {
            const color = IG_STATUS_COLORS[p.status] || IG_STATUS_COLORS.draft;
            const statusLabel = IG_STATUS_LABELS[p.status] || p.status;
            const ref = igPostRefDate(p);
            const jam = ref ? ref.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
            const text = igChipText(p.caption, '(tanpa caption)');
            const hasThumb = p.media_type === 'image' && p.media_url;
            const lead = hasThumb
                ? `<img class="ig-cal-chip-thumb" src="${escapeHtmlAttr(p.media_url)}" loading="lazy" alt="">`
                : '';
            chips.push(`<div class="ig-cal-chip ig-cal-chip-post${hasThumb ? ' ig-cal-chip-media' : ''}" style="--chip:${color};" title="${escapeHtmlAttr(`${statusLabel}${jam ? ' · ' + jam : ''} — ${text}`)}">${lead}<span>${escapeHtml(text)}</span></div>`);
        });
        dayPlans.forEach(pl => {
            const text = igChipText(pl.tema, '(tanpa tema)');
            const topik = igChipTopik(text);
            const pil = IG_PILLARS[pl.pilar];
            const tahap = pl.tahap && pl.tahap !== 'ide' ? ` ig-cal-chip-${pl.tahap}` : '';
            const tip = `Rencana (${IG_TYPE_LABELS[pl.tipe_konten] || 'Image'}${pil ? ' · ' + pil.label : ''} · ${IG_STAGES[pl.tahap || 'ide'] || 'Ide'}${pl.tema_minggu ? ' · Seri ' + pl.tema_minggu : ''}) — ${text}${canDrag ? ' · seret ke tanggal lain untuk memindah' : ''}`;
            chips.push(`<div class="ig-cal-chip ig-cal-chip-plan${tahap}" data-plan-id="${pl.id}" ${canDrag ? 'draggable="true"' : ''} style="${pil ? `--pillar:${pil.color};` : ''}" title="${escapeHtmlAttr(tip)}"><span>${escapeHtml(topik)}</span></div>`);
        });

        // Semua chip dirender; berapa yang tampil + teks "+N lagi" dihitung di igFitCalendarChips()
        // setelah layout terbentuk (dulu selalu 3 chip -> "+N lagi" bisa terpotong di sel yang pendek).
        const chipsHtml = chips.length ? `<div class="ig-cal-chips">${chips.join('')}</div>` : '';

        const cellClasses = ['ig-cal-day'];
        if (isToday) cellClasses.push('ig-cal-today');
        if (isPast) cellClasses.push('ig-cal-past');
        if (isWeekend) cellClasses.push('ig-cal-weekend');
        if (dayPosts.length) cellClasses.push('has-posts');
        if (dayPlans.length && !dayPosts.length) cellClasses.push('has-plan-only');
        // Warna border sel per tipe konten (image / carousel / video); sel tanpa item tidak diberi kelas.
        // Tipe diambil dari item pertama yang tampil (post dulu, lalu ide) -- sama dengan urutan chip.
        const tipeSel = dayPosts.length ? dayPosts[0].media_type : (dayPlans.length ? dayPlans[0].tipe_konten : null);
        if (tipeSel) cellClasses.push('ig-type-' + (['image', 'carousel', 'video'].includes(tipeSel) ? tipeSel : 'image'));
        if (!allDayPosts.length && !allDayPlans.length && !isPast) cellClasses.push('ig-cal-gap');

        // Label seri cukup sekali per rentang hari berurutan dalam satu baris kalender (bukan di tiap sel):
        // tujuh sel berlabel sama hanya memakan lebar/tinggi chip dan di layar sempit terpotong jadi "T…".
        const kolom = (startDay + day - 1) % 7;
        const seriHariIni = showPlans ? seriesByDay[day] : '';
        const lanjutan = !!seriHariIni && kolom !== 0 && seriesByDay[day - 1] === seriHariIni;
        if (lanjutan) cellClasses.push('ig-cal-series-cont');

        html += `<div class="${cellClasses.join(' ')}" data-date="${dateKey}" onclick="igOnDayClick('${dateKey}')">
            <div class="ig-cal-day-top">
                <span class="ig-cal-day-num">${day}</span>
                ${seriHariIni && !lanjutan ? `<span class="ig-cal-series" title="${escapeHtmlAttr('Seri: ' + seriHariIni)}">${escapeHtml(seriHariIni)}</span>` : ''}
                <span class="ig-cal-add-hint" title="Tambah ide / post">+</span>
            </div>
            ${chipsHtml}
        </div>`;
    }

    daysEl.innerHTML = html;
    igBindCalendarDnD(daysEl);
    renderIgCalSummary(monthPosts, monthPlans, emptyFutureDays, pillarPlans);
    renderIgPlanSide(monthPlans);
    igBindCalendarFit();
    igFitCalendarChips();

    // Sinkronkan status aktif tombol filter
    document.querySelectorAll('#igCalFilter button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === igCalFilter);
    });
}

// ---- Muatkan chip ke dalam sel kalender ----
// Mode pas-layar (planner, desktop): tinggi sel mengikuti sisa ruang, jadi jumlah chip yang muat
// diukur dari layout asli: sembunyikan chip dari belakang sampai chip terakhir (atau "+N lagi")
// tidak melewati dasar sel. Mode lain (sel auto-tinggi / HP): batas tetap IG_CAL_MAX_CHIPS.
const IG_FIT_MQ = '(min-width: 1001px) and (min-height: 600px)';
function igFitCalendarChips() {
    const daysEl = document.getElementById('igCalDays');
    if (!daysEl) return;
    const grid = daysEl.parentElement;
    const root = document.getElementById('igSchedulerPageView');
    const visible = !!grid && grid.offsetHeight > 0; // halaman IG sedang disembunyikan -> tidak bisa diukur
    const fitMode = visible && !!root && root.classList.contains('ig-planner-mode') && window.matchMedia(IG_FIT_MQ).matches;

    daysEl.querySelectorAll('.ig-cal-chips').forEach(box => {
        const cell = box.closest('.ig-cal-day');
        const chips = Array.from(box.querySelectorAll('.ig-cal-chip'));
        if (!cell || !chips.length) return;

        let more = box.querySelector('.ig-cal-chip-more');
        if (!more) { more = document.createElement('div'); more.className = 'ig-cal-chip-more'; }
        const apply = n => {
            chips.forEach((c, i) => { c.style.display = i < n ? '' : 'none'; });
            const hidden = chips.length - n;
            if (hidden > 0) {
                // "+N" saja di layar sempit (kata "lagi" disembunyikan CSS) supaya tidak terpecah dua baris
                more.innerHTML = `+${hidden}<span class="ig-cal-more-l"> lagi</span>`;
                more.title = `${hidden} item lagi, klik hari untuk melihat semuanya`;
                if (!more.parentNode) box.appendChild(more);
            } else if (more.parentNode) {
                more.remove();
            }
        };

        box.classList.remove('is-compact');
        const cap = fitMode ? chips.length : Math.min(chips.length, IG_CAL_MAX_CHIPS);
        apply(cap);
        if (!fitMode) return;

        const cs = getComputedStyle(cell);
        const limit = cell.getBoundingClientRect().bottom - (parseFloat(cs.paddingBottom) || 0) - (parseFloat(cs.borderBottomWidth) || 0);
        const fits = () => { const last = box.lastElementChild; return !last || last.getBoundingClientRect().bottom <= limit + 0.5; };
        // Banyak chip yang muat; 0 kalau tidak ada yang muat
        const muat = () => { for (let n = cap; n > 0; n--) { apply(n); if (fits()) return n; } return 0; };
        let n = fits() ? cap : muat();
        // Sel pendek: pakai chip satu baris dulu, baru menyerah. Sel tidak boleh cuma berisi "+N lagi" tanpa satu pun item.
        if (!n) { box.classList.add('is-compact'); n = muat(); }
        if (!n) apply(1);
    });
}

// Ukur ulang saat ukuran grid berubah (resize jendela, ringkasan bulan berubah tinggi, dsb.)
let igCalFitBound = false;
function igBindCalendarFit() {
    if (igCalFitBound) return;
    const grid = document.querySelector('#igSchedulerPageView .ig-calendar-grid');
    if (!grid) return;
    igCalFitBound = true;
    let raf = 0, lastSig = '';
    const run = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
            const sig = grid.clientWidth + 'x' + grid.clientHeight;
            if (sig === lastSig) return;
            lastSig = sig;
            igFitCalendarChips();
        });
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(run).observe(grid);
    else window.addEventListener('resize', run);
}

// ---- Ringkasan bulan: kartu statistik + keseimbangan pilar konten ----
function renderIgCalSummary(monthPosts, monthPlans, emptyFutureDays, pillarPlans = monthPlans) {
    const el = document.getElementById('igCalSummary');
    if (!el) return;
    const st = t => monthPlans.filter(p => (p.tahap || 'ide') === t).length;
    const card = (n, label, cls, attrs = '') =>
        `<div class="ig-stat ${cls}"${attrs}><b>${n}</b><span>${label}</span></div>`;
    // Kartu "Hari kosong" jadi pintasan ke Perencanaan Konten (modal otomatis memilih pekan pertama yang masih punya hari kosong)
    const gapBisaDiklik = emptyFutureDays > 0 && canManageProgramData();
    const gapAttrs = gapBisaDiklik
        ? ' role="button" tabindex="0" title="Isi hari kosong lewat Perencanaan Konten" onclick="openIgContentPlanModal()" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openIgContentPlanModal();}"'
        : '';
    let html = '<div class="ig-stat-row">' +
        igTaskCardHtml() +
        card(st('ide'), 'Ide', 'ig-stat-ide') +
        card(st('dikerjakan'), 'Dikerjakan', 'ig-stat-wip') +
        card(st('siap'), 'Siap posting', 'ig-stat-ready') +
        card(monthPosts.length, 'Draft & post', 'ig-stat-post') +
        card(emptyFutureDays, 'Hari kosong', 'ig-stat-gap' + (gapBisaDiklik ? ' ig-stat-link' : ''), gapAttrs) + '</div>';

    if (igPlannerColsReady && pillarPlans.length) {
        const counts = {};
        pillarPlans.forEach(p => { const k = IG_PILLARS[p.pilar] ? p.pilar : '_none'; counts[k] = (counts[k] || 0) + 1; });
        const keys = Object.keys(counts);
        const color = k => k === '_none' ? 'var(--line)' : IG_PILLARS[k].color;
        const label = k => k === '_none' ? 'Belum ada pilar' : IG_PILLARS[k].label;
        html += `<div class="ig-pillar-bar" title="Keseimbangan pilar konten (ide aktif + yang sudah jadi post)">` +
            keys.map(k => `<span style="flex:${counts[k]};background:${color(k)};"></span>`).join('') + '</div>' +
            `<div class="ig-pillar-legend">` + keys.map(k =>
                `<span><i style="background:${color(k)};"></i>${escapeHtml(label(k))} ${counts[k]}</span>`).join('') + '</div>';
    }
    el.innerHTML = html;
}

// ---- Sidebar "Ide Bulan Ini": backlog ide, dikelompokkan per tahap, bisa diseret ke kalender ----
function renderIgPlanSide(monthPlans) {
    const body = document.getElementById('igPlanSideBody');
    const count = document.getElementById('igPlanSideCount');
    if (!body) return;
    if (count) count.textContent = monthPlans.length ? String(monthPlans.length) : '';
    igBindSideDnD(body);

    if (!monthPlans.length) {
        body.innerHTML = '<div class="ig-side-empty">Belum ada ide bulan ini</div>';
        return;
    }
    const canDrag = canManageProgramData();
    const mon = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    const sorted = monthPlans.slice().sort((a, b) => a.tanggal.localeCompare(b.tanggal));
    const groups = ['siap', 'dikerjakan', 'ide']
        .map(stage => ({ stage, items: sorted.filter(p => (p.tahap || 'ide') === stage) }))
        .filter(g => g.items.length);
    // Judul grup tahap hanya ditampilkan kalau memang membedakan sesuatu:
    // lebih dari 1 grup, atau satu-satunya grup bukan "Ide" (default).
    const showGroupTitle = groups.length > 1 || (groups[0] && groups[0].stage !== 'ide');
    body.innerHTML = groups.map(g =>
        (showGroupTitle ? `<div class="ig-side-group">${IG_STAGES[g.stage]} <em>${g.items.length}</em></div>` : '') +
        g.items.map(pl => {
            const [, m, d] = pl.tanggal.split('-').map(Number);
            const pil = IG_PILLARS[pl.pilar];
            return `<div class="ig-side-item" data-plan-id="${pl.id}" ${canDrag ? 'draggable="true"' : ''} style="--pillar:${pil ? pil.color : 'var(--brand)'};" onclick="igOnDayClick('${pl.tanggal}')">
                <span class="ig-side-date"><b>${d}</b><small>${mon[m - 1]}</small></span>
                <span class="ig-side-main">
                    <span class="ig-side-tema">${escapeHtml(pl.tema)}</span>
                    <span class="ig-side-meta"><span>${IG_TYPE_LABELS[pl.tipe_konten] || 'Image'}</span>${pil ? `<span class="ig-side-pil"><i class="ig-side-dot"></i>${escapeHtml(pil.label)}</span>` : ''}</span>
                </span>
            </div>`;
        }).join('')
    ).join('');
}

function igBindSideDnD(el) {
    if (el._dndBound) return;
    el._dndBound = true;
    el.addEventListener('dragstart', e => {
        const it = e.target.closest && e.target.closest('.ig-side-item[data-plan-id]');
        if (!it) return;
        igDragPlanId = it.dataset.planId;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', igDragPlanId); } catch (err) {}
    });
    el.addEventListener('dragend', () => {
        igDragPlanId = null;
        document.querySelectorAll('.ig-cal-drop').forEach(n => n.classList.remove('ig-cal-drop'));
    });
}

// ---- Drag & drop: pindahkan ide (chip putus-putus) ke tanggal lain ----
let igDragPlanId = null;

function igBindCalendarDnD(daysEl) {
    if (daysEl._dndBound) return; // listener cukup dipasang sekali (konten di-render ulang, container tetap)
    daysEl._dndBound = true;

    daysEl.addEventListener('dragstart', e => {
        const chip = e.target.closest && e.target.closest('.ig-cal-chip-plan[data-plan-id]');
        if (!chip) return;
        igDragPlanId = chip.dataset.planId;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', igDragPlanId); } catch (err) {}
        chip.classList.add('ig-cal-chip-dragging');
    });
    daysEl.addEventListener('dragend', () => {
        igDragPlanId = null;
        daysEl.querySelectorAll('.ig-cal-chip-dragging, .ig-cal-drop').forEach(n => n.classList.remove('ig-cal-chip-dragging', 'ig-cal-drop'));
    });
    daysEl.addEventListener('dragover', e => {
        if (!igDragPlanId) return;
        const cell = e.target.closest && e.target.closest('.ig-cal-day[data-date]');
        if (!cell) return;
        e.preventDefault(); // wajib supaya sel menerima drop
        e.dataTransfer.dropEffect = 'move';
        daysEl.querySelectorAll('.ig-cal-drop').forEach(n => { if (n !== cell) n.classList.remove('ig-cal-drop'); });
        cell.classList.add('ig-cal-drop');
    });
    daysEl.addEventListener('drop', e => {
        if (!igDragPlanId) return;
        const cell = e.target.closest && e.target.closest('.ig-cal-day[data-date]');
        if (!cell) return;
        e.preventDefault();
        const planId = igDragPlanId;
        igDragPlanId = null;
        igMovePlanToDate(planId, cell.dataset.date);
    });
}

// ---- Pindahkan 1 ide ke tanggal lain (dipakai drag & drop + input tanggal di modal harian) ----
async function igMovePlanToDate(planId, dateKey, fromModal = false) {
    if (!canManageProgramData()) {
        showToast('Akun Anda tidak punya izin untuk memindah rencana konten', 'error');
        return;
    }
    const plan = igContentPlan.find(pl => pl.id === planId);
    if (!plan || !dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
    if (plan.tanggal === dateKey) return;

    const [y, m, d] = dateKey.split('-');
    const prev = { tanggal: plan.tanggal, bulan: plan.bulan };
    // Optimistik: kalender langsung berubah, dibalikkan kalau simpan gagal
    plan.tanggal = dateKey;
    plan.bulan = `${y}-${m}-01`;
    renderIgCalendar();
    if (fromModal && igDayModalDateKey) igOpenDayModal(igDayModalDateKey);

    try {
        const { error } = await supabaseClient.from('ig_content_plan')
            .update({ tanggal: plan.tanggal, bulan: plan.bulan }).eq('id', planId);
        if (error) throw error;
        const bln = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][parseInt(m, 10) - 1];
        showToast(`Ide dipindah ke ${parseInt(d, 10)} ${bln}`, 'success');
    } catch (err) {
        console.error('igMovePlanToDate error:', err);
        plan.tanggal = prev.tanggal;
        plan.bulan = prev.bulan;
        renderIgCalendar();
        if (fromModal && igDayModalDateKey) igOpenDayModal(igDayModalDateKey);
        showToast('Gagal memindah rencana: ' + err.message, 'error');
    }
}

// ---- Tambah ide manual langsung dari modal harian ----
async function igQuickAddPlan() {
    if (!canManageProgramData()) {
        showToast('Akun Anda tidak punya izin untuk membuat rencana konten', 'error');
        return;
    }
    if (igQuickAdding) return; // Enter + klik Tambah beruntun / klik ganda -> jangan bikin ide dobel
    const dateKey = igDayModalDateKey;
    if (!dateKey) return;
    const temaEl = document.getElementById('igQuickPlanTema');
    const tipeEl = document.getElementById('igQuickPlanTipe');
    const tema = (temaEl?.value || '').trim();
    if (!tema) { showToast('Isi tema/ide dulu', 'error'); temaEl?.focus(); return; }

    const [y, m] = dateKey.split('-');
    igQuickAdding = true;
    const addBtn = document.querySelector('#igPlanQuickAdd .ig-dm-add');
    if (addBtn) addBtn.disabled = true;
    try {
        const { data, error } = await supabaseClient.from('ig_content_plan').insert({
            bulan: `${y}-${m}-01`,
            tanggal: dateKey,
            tema,
            tipe_konten: tipeEl?.value || 'image',
            draft_caption: '',
            status: 'idea',
            ...(igPlannerColsReady ? { pilar: document.getElementById('igQuickPlanPilar')?.value || null, tahap: document.getElementById('igQuickPlanTahap')?.value || 'ide' } : {})
        }).select().single();
        if (error) throw error;
        igContentPlan.push(data);
        igResetQuickPilar(); // pilar tidak boleh "menempel" ke ide berikutnya
        renderIgCalendar();
        igOpenDayModal(dateKey);
        document.getElementById('igQuickPlanTema')?.focus(); // siap ketik ide berikutnya
        showToast('Ide ditambahkan ke kalender', 'success');
    } catch (err) {
        console.error('igQuickAddPlan error:', err);
        showToast('Gagal menambah ide: ' + err.message, 'error');
    } finally {
        igQuickAdding = false;
        if (addBtn) addBtn.disabled = false;
    }
}

function igResetQuickPilar() {
    const inp = document.getElementById('igQuickPlanPilar');
    if (inp) inp.value = '';
    document.querySelectorAll('#igQuickPilarChips .ig-dm-pill').forEach(b => b.classList.remove('active'));
}

function igPrevMonth() {
    igCalendarCurrent = new Date(igCalendarCurrent.getFullYear(), igCalendarCurrent.getMonth() - 1, 1);
    renderIgCalendar();
}
function igNextMonth() {
    igCalendarCurrent = new Date(igCalendarCurrent.getFullYear(), igCalendarCurrent.getMonth() + 1, 1);
    renderIgCalendar();
}
function igGotoToday() {
    igCalendarCurrent = new Date();
    renderIgCalendar();
}

// ---- Detail post per tanggal (modal saat klik sel kalender) ----
let igDayModalDateKey = null;

function igOnDayClick(dateKey) {
    igOpenDayModal(dateKey);
}

function igDmRelLabel(y, m, d) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const diff = Math.round((new Date(y, m - 1, d) - t) / 86400000);
    if (diff === 0) return 'Hari ini';
    if (diff === 1) return 'Besok';
    if (diff === -1) return 'Kemarin';
    return diff > 0 ? `${diff} hari lagi` : `${-diff} hari lalu`;
}

function igDmMedia(post) {
    if (post.media_type === 'video') return `<video src="${escapeHtmlAttr(post.media_url)}" class="ig-dm-thumb" preload="none"></video>`;
    if (post.media_url) return `<img src="${escapeHtmlAttr(post.media_url)}" alt="" class="ig-dm-thumb" loading="lazy">`;
    return '';
}

function igDmPostCard(post) {
    const ref = igPostRefDate(post);
    const jam = ref ? ref.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
    const color = IG_STATUS_COLORS[post.status] || IG_STATUS_COLORS.draft;
    const label = IG_STATUS_LABELS[post.status] || post.status;
    const editable = ['draft', 'scheduled', 'failed'].includes(post.status);
    return `<div class="ig-dm-card ig-dm-post" style="--pillar:${color};">
        <div class="ig-dm-card-top">
            <div class="ig-dm-card-main">
                ${igDmMedia(post)}
                <div class="ig-dm-card-info">
                    <div class="ig-dm-card-title">${escapeHtml(igChipText(post.caption, '(tanpa caption)'))}</div>
                    <div class="ig-dm-badges">
                        <span class="ig-status-pill" style="background:${color}1a;color:${color};">${escapeHtml(label)}</span>
                        <span class="ig-dm-typelabel">${jam}</span>
                        <span class="ig-dm-typelabel">${IG_TYPE_LABELS[post.media_type] || 'Image'}</span>
                    </div>
                </div>
            </div>
            ${editable ? `<div class="ig-dm-card-actions"><button type="button" class="ig-dm-iconbtn" title="Edit post" onclick="closeIgDayModal(); openIgUploadModal('${post.id}')">Edit</button></div>` : ''}
        </div>
    </div>`;
}

// Link Canva: hanya http(s) yang dipakai (tolak javascript:, data:, dll). Kembalikan '' kalau tidak valid.
function igCanvaSafeUrl(raw) {
    let v = String(raw || '').trim();
    if (!v) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v;   // "canva.com/design/..." -> tambah https://
    try {
        const u = new URL(v);
        return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
    } catch (e) { return ''; }
}
// ---- Link Canva per SERI (tema_minggu) ----
// Satu seri (mis. "Talbiyah") = satu desain Canva. Link cukup diisi sekali di salah satu konten seri itu;
// semua konten dengan tema_minggu yang sama otomatis memakai link yang sama (disimpan ke semua barisnya,
// dan konten baru di seri yang sama ikut mewarisinya lewat igCanvaUrlFor).
function igCanvaSeriKey(pl) { return String((pl && pl.tema_minggu) || '').trim().toLowerCase(); }
function igCanvaSeriPlans(pl) {
    const key = igCanvaSeriKey(pl);
    if (!key) return [pl];   // tanpa tema minggu -> hanya konten ini
    return igContentPlan.filter(x => igCanvaSeriKey(x) === key);
}
function igCanvaUrlFor(pl) {
    if (!pl) return '';
    if (pl.canva_url) return pl.canva_url;
    const kembar = igCanvaSeriKey(pl) ? igCanvaSeriPlans(pl).find(x => x.canva_url) : null;
    return kembar ? kembar.canva_url : '';
}

async function igPlanSetCanva(planId, value) {
    if (!igCanvaReady) { showToast('Jalankan sql/56_tambah_ig_content_plan_canva.sql dulu agar link Canva bisa disimpan', 'error'); return; }
    const plan = igContentPlan.find(pl => pl.id === planId);
    if (!plan) return;
    const mentah = String(value || '').trim();
    const bersih = igCanvaSafeUrl(mentah);
    if (mentah && !bersih) {
        showToast('Link Canva tidak valid (harus berupa alamat http/https)', 'error');
        igSyncPlanCardDom(plan, 'canva_url');
        return;
    }
    if (bersih === igCanvaUrlFor(plan)) return;   // tidak berubah

    const targets = igCanvaSeriPlans(plan);
    const prev = targets.map(t => [t, t.canva_url || null]);
    targets.forEach(t => { t.canva_url = bersih || null; igSyncPlanCardDom(t, 'canva_url'); });   // optimistik

    const job = (async () => {
        try {
            const { error } = await supabaseClient.from('ig_content_plan')
                .update({ canva_url: bersih || null }).in('id', targets.map(t => t.id));
            if (error) throw error;
            const indicator = document.getElementById(`igPlanSaved-${planId}`);
            if (indicator) {
                indicator.innerHTML = '<i class="bi bi-check-circle-fill"></i> Tersimpan';
                indicator.classList.add('show');
                clearTimeout(indicator._hideTimer);
                indicator._hideTimer = setTimeout(() => indicator.classList.remove('show'), 1800);
            }
            if (targets.length > 1) {
                showToast(`Link Canva ${bersih ? 'disimpan' : 'dihapus'} untuk ${targets.length} konten seri "${plan.tema_minggu}"`, 'success');
            }
        } catch (err) {
            console.error('igPlanSetCanva error:', err);
            prev.forEach(([t, v]) => { t.canva_url = v; igSyncPlanCardDom(t, 'canva_url'); });
            showToast('Gagal menyimpan link Canva: ' + err.message, 'error');
        }
    })();
    igPlanPendingSaves.add(job);
    try { await job; } finally { igPlanPendingSaves.delete(job); }
}
window.igPlanSetCanva = igPlanSetCanva;

function igCanvaBtnHtml(url) {
    const href = igCanvaSafeUrl(url);
    return href ? `<a class="ig-dm-iconbtn ig-dm-canva" href="${escapeHtmlAttr(href)}" target="_blank" rel="noopener noreferrer" title="Buka desain poster di Canva" onclick="event.stopPropagation()"><i class="bi bi-palette-fill"></i> Canva</a>` : '';
}

function igDmPlanCard(pl, canEdit) {
    const pil = IG_PILLARS[pl.pilar];
    const stage = pl.tahap || 'ide';
    const cap = pl.draft_caption || '';
    const imgTxt = igSpasiSlide(pl.teks_gambar || '');
    const typeOpts = ['image', 'video', 'carousel'].map(t =>
        `<option value="${t}"${pl.tipe_konten === t ? ' selected' : ''}>${t === 'video' ? 'Video/Reels' : IG_TYPE_LABELS[t]}</option>`).join('');
    const pilOpts = igPlannerColsReady
        ? `<select class="ig-dm-input" onchange="igPlanUpdateField('${pl.id}','pilar',this.value)"><option value="">Pilar...</option>${Object.entries(IG_PILLARS).map(([k, v]) =>
            `<option value="${k}"${pl.pilar === k ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}</select>` : '';
    const stepper = igPlannerColsReady && canEdit
        ? `<div class="ig-dm-stepper" title="Tahap pengerjaan" onclick="event.stopPropagation()">${Object.entries(IG_STAGES).map(([k, v]) =>
            `<button type="button" class="${k === stage ? 'active' : ''}" onclick="igPlanSetStage('${pl.id}','${k}')">${v}</button>`).join('')}</div>` : '';
    const actions = canEdit ? `<div class="ig-dm-card-actions ig-dm-plan-actions">
            <div class="ig-dm-icons">
                ${igCanvaReady ? igCanvaBtnHtml(igCanvaUrlFor(pl)) : ''}
                <button type="button" class="ig-dm-iconbtn" title="Lewati (sembunyikan dari kalender)" onclick="igSkipPlanItem('${pl.id}')">Lewati</button>
                <button type="button" class="ig-dm-iconbtn ig-dm-danger" title="Hapus" onclick="igArmDelete(this,'${pl.id}')">Hapus</button>
            </div>
            <button type="button" class="${stage === 'siap' ? 'btn-primary' : 'btn-secondary'} ig-dm-convert" onclick="igConvertPlanToPost('${pl.id}')">Jadikan Post</button>
        </div>` : '';
    const edit = canEdit ? `<div class="ig-dm-edit" style="display:none;">
          <div class="ig-dm-edit-row ig-dm-edit-row-tema">
                <input type="text" class="ig-dm-input ig-dm-tema" value="${escapeHtmlAttr(pl.tema)}" maxlength="120" placeholder="Tema / ide"
                    onblur="igPlanUpdateField('${pl.id}','tema',this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">
                <span class="ig-plan-save-indicator" id="igPlanSaved-${pl.id}"></span>
            </div>
            <div class="ig-dm-edit-row ig-dm-edit-row-meta">
                <select class="ig-dm-input" onchange="igPlanUpdateField('${pl.id}','tipe_konten',this.value)">${typeOpts}</select>
                ${pilOpts}
                <input type="date" class="ig-dm-input" value="${escapeHtmlAttr(pl.tanggal)}" title="Pindah ke tanggal lain" onchange="igMovePlanToDate('${pl.id}',this.value,true)">
                ${igCanvaReady
                    ? `<input type="url" class="ig-dm-input ig-dm-canva-input" value="${escapeHtmlAttr(igCanvaUrlFor(pl))}" maxlength="500" autocomplete="off"
                        placeholder="${pl.tema_minggu ? `Link Canva seri ${escapeHtmlAttr(pl.tema_minggu)}` : 'Link Canva desain poster'}"
                        title="${pl.tema_minggu ? `Link desain Canva — berlaku untuk seluruh seri ${escapeHtmlAttr(pl.tema_minggu)}` : 'Link desain Canva'}"
                        onblur="igPlanSetCanva('${pl.id}',this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">`
                    : `<span class="ig-plan-canva-off" title="Jalankan sql/56_tambah_ig_content_plan_canva.sql lalu muat ulang halaman">Link Canva belum aktif (jalankan sql/56)</span>`}
            </div>
          <div class="ig-dm-edit-cols">
            <div class="ig-dm-edit-left">${igTeksGambarReady ? `<label class="ig-dm-edit-label">Teks di gambar <em>${pl.tipe_konten === 'carousel' ? '(satu blok per slide, maks 5 slide)' : '(2–4 baris pendek)'}</em></label>
            <textarea class="ig-dm-input ig-dm-textarea ig-dm-imgtext-input" rows="3" maxlength="800" placeholder="Contoh: Niat umroh itu muncul diam-diam."
                oninput="this.parentNode.querySelector('.ig-dm-imgcount').textContent=this.value.length+' / 800 karakter'"
                onblur="igPlanUpdateField('${pl.id}','teks_gambar',this.value)">${escapeHtml(imgTxt)}</textarea>
            <div class="ig-dm-edit-foot"><span class="ig-plan-char-count ig-dm-imgcount">${imgTxt.length} / 800 karakter</span></div>` : ''}</div>
            <div class="ig-dm-edit-right">
            <label class="ig-dm-edit-label ig-dm-edit-label-caption">Caption</label>
            <textarea class="ig-dm-input ig-dm-textarea ig-dm-caption-input" rows="6" maxlength="2200" placeholder="Draft caption..."
                oninput="igUpdatePlanCharCount('${pl.id}',this.value.length)"
                onblur="igPlanUpdateField('${pl.id}','draft_caption',this.value)">${escapeHtml(cap)}</textarea>
            <div class="ig-dm-edit-foot">
                <span class="ig-plan-char-count" id="igPlanCharCount-${pl.id}">${cap.length} / 2200 karakter</span>
                <button type="button" class="btn-primary ig-dm-done" onclick="igTogglePlanEdit('${pl.id}')">Selesai</button>
            </div>
            </div>
          </div>
        </div>` : '';
    // Kalau stepper tahap tampil, badge tahap teks dihilangkan (info yang sama) supaya baris meta tidak dobel.
    const pilBadge = pil ? `<span class="ig-status-pill" style="background:${pil.color}1a;color:${pil.color};">${escapeHtml(pil.label)}</span>` : '';
    const badges = stepper ? pilBadge : igPlanBadgeHtml(pl);
    return `<div class="ig-dm-card ig-dm-plan stage-${stage}" id="igDayPlanItem-${pl.id}" style="--pillar:${pil ? pil.color : 'var(--brand)'};">
        <div class="ig-dm-card-top">
            <div class="ig-dm-card-main"${canEdit ? ` onclick="igTogglePlanEdit('${pl.id}')" title="Klik untuk edit"` : ''}>
                <div class="ig-dm-card-info">
                    <div class="ig-dm-card-title">${escapeHtml(pl.tema)}</div>
                    <div class="ig-dm-badges">${badges}<span class="ig-dm-typelabel">${IG_TYPE_LABELS[pl.tipe_konten] || 'Image'}</span>${stepper}</div>
                    ${igTeksGambarReady && imgTxt ? `<div class="ig-dm-imgtext"><span>Teks di gambar</span><p>${escapeHtml(imgTxt)}</p></div>` : ''}
                    ${cap ? `<p class="ig-dm-cap">${escapeHtml(cap)}</p>` : `<p class="ig-dm-cap ig-dm-cap-empty">Belum ada caption${canEdit ? ' — klik untuk menulis' : ''}</p>`}
                </div>
            </div>
        </div>
        ${actions}
        ${edit}
    </div>`;
}

// Kartu ide yang dilewati: redup, hanya bisa dipulihkan (kembali jadi ide) atau dihapus
function igDmSkippedCard(pl, canEdit) {
    return `<div class="ig-dm-card ig-dm-plan" style="opacity:.7;">
        <div class="ig-dm-card-top">
            <div class="ig-dm-card-main">
                <div class="ig-dm-card-info">
                    <div class="ig-dm-card-title">${escapeHtml(pl.tema)}</div>
                    <div class="ig-dm-badges"><span class="ig-dm-typelabel">${IG_TYPE_LABELS[pl.tipe_konten] || 'Image'}</span></div>
                </div>
            </div>
            ${canEdit ? `<div class="ig-dm-card-actions">
                <button type="button" class="ig-dm-iconbtn" title="Kembalikan jadi ide aktif" onclick="igRestorePlanItem('${pl.id}')">Pulihkan</button>
                <button type="button" class="ig-dm-iconbtn ig-dm-danger" title="Hapus" onclick="igArmDelete(this,'${pl.id}')">Hapus</button>
            </div>` : ''}
        </div>
    </div>`;
}

function igOpenDayModal(dateKey) {
    const modal = document.getElementById('igDayModal');
    const titleEl = document.getElementById('igDayModalTitle');
    const bodyEl = document.getElementById('igDayModalBody');
    if (!modal || !bodyEl) return;

    const sameDay = modal.classList.contains('open') && igDayModalDateKey === dateKey;
    const prevScroll = sameDay ? bodyEl.scrollTop : 0;
    igDayModalDateKey = dateKey;
    igFillPlannerSelects();
    if (!sameDay) igResetQuickPilar(); // buka hari lain / modal baru -> pilihan pilar mulai bersih
    igBindDayModalKeys();

    const canEdit = canManageProgramData();
    const composer = document.getElementById('igPlanQuickAdd');
    if (composer) {
        composer.style.display = canEdit ? 'block' : 'none';
        const qt = document.getElementById('igQuickPlanTema');
        if (qt) qt.value = '';
    }
    const addBtn = document.getElementById('igDayModalAddBtn');
    if (addBtn) addBtn.style.display = canEdit ? '' : 'none';

    const [y, m, d] = dateKey.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    if (titleEl) titleEl.textContent = dateObj.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const dayPosts = igPosts.filter(p => {
        const dd = igPostRefDate(p);
        return dd && dd.getFullYear() === y && dd.getMonth() === m - 1 && dd.getDate() === d;
    }).sort((a, b) => igPostRefDate(a) - igPostRefDate(b));
    const dayPlans = igContentPlan.filter(pl => pl.status === 'idea' && pl.tanggal === dateKey);
    const daySkipped = igContentPlan.filter(pl => pl.status === 'dilewati' && pl.tanggal === dateKey);

    const meta = document.getElementById('igDmMeta');
    const rel = igDmRelLabel(y, m, d);
    const isToday = rel === 'Hari ini';
    if (meta) {
        const cnt = [dayPlans.length ? `${dayPlans.length} ide` : '', dayPosts.length ? `${dayPosts.length} post` : ''].filter(Boolean).join(' · ');
        meta.innerHTML = `<span class="ig-dm-rel${isToday ? ' is-today' : ''}">${rel}</span>${cnt ? ` · ${cnt}` : ''}`;
    }
    const todayBtn = document.getElementById('igDmTodayBtn');
    if (todayBtn) todayBtn.style.display = isToday ? 'none' : '';

    if (!dayPosts.length && !dayPlans.length && !daySkipped.length) {
        bodyEl.innerHTML = `<div class="ig-dm-empty">Belum ada konten di tanggal ini${canEdit ? '.<br>Tulis ide di kolom atas, lalu tekan Enter.' : ''}</div>`;
    } else {
        bodyEl.innerHTML =
            (dayPlans.length ? `<div class="ig-dm-section">Rencana <em>${dayPlans.length}</em></div>` + dayPlans.map(pl => igDmPlanCard(pl, canEdit)).join('') : '') +
            (dayPosts.length ? `<div class="ig-dm-section">Draft & post <em>${dayPosts.length}</em></div>` + dayPosts.map(igDmPostCard).join('') : '') +
            (daySkipped.length ? `<div class="ig-dm-section">Dilewati <em>${daySkipped.length}</em></div>` + daySkipped.map(pl => igDmSkippedCard(pl, canEdit)).join('') : '');
    }
    bodyEl.scrollTop = prevScroll;
    modal.classList.add('open');
}

// ---- Navigasi hari di dalam modal (tombol ‹ › dan keyboard ← →) ----
function igDayNav(delta) {
    if (!igDayModalDateKey) return;
    const [y, m, d] = igDayModalDateKey.split('-').map(Number);
    const nd = new Date(y, m - 1, d + delta);
    if (nd.getFullYear() !== igCalendarCurrent.getFullYear() || nd.getMonth() !== igCalendarCurrent.getMonth()) {
        igCalendarCurrent = new Date(nd.getFullYear(), nd.getMonth(), 1);
        renderIgCalendar();
    }
    igOpenDayModal(`${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}`);
}
function igDayNavToday() {
    const t = new Date();
    if (t.getFullYear() !== igCalendarCurrent.getFullYear() || t.getMonth() !== igCalendarCurrent.getMonth()) {
        igCalendarCurrent = new Date(t.getFullYear(), t.getMonth(), 1);
        renderIgCalendar();
    }
    igOpenDayModal(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);
}
let igDmKeysBound = false;
function igBindDayModalKeys() {
    if (igDmKeysBound) return;
    igDmKeysBound = true;
    document.addEventListener('keydown', e => {
        const modal = document.getElementById('igDayModal');
        if (!modal || !modal.classList.contains('open')) return;
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''));
        if (e.key === 'Escape') { closeIgDayModal(); }
        else if (!typing && e.key === 'ArrowLeft') { e.preventDefault(); igDayNav(-1); }
        else if (!typing && e.key === 'ArrowRight') { e.preventDefault(); igDayNav(1); }
    });
}

// ---- Aksi kartu rencana ----
async function igPlanSetStage(planId, stage) {
    await igPlanUpdateField(planId, 'tahap', stage);
    if (igDayModalDateKey) igOpenDayModal(igDayModalDateKey);
}
// Hapus 2 langkah: klik pertama meminta konfirmasi (3 detik), klik kedua menghapus
function igArmDelete(btn, planId) {
    if (btn.dataset.armed === '1') { igDeletePlanItem(planId); return; }
    btn.dataset.armed = '1';
    btn.classList.add('is-armed');
    btn.textContent = 'Yakin hapus?';
    setTimeout(() => {
        if (!btn.isConnected) return;
        btn.dataset.armed = '';
        btn.classList.remove('is-armed');
        btn.textContent = 'Hapus';
    }, 3000);
}

function closeIgDayModal() {
    const modal = document.getElementById('igDayModal');
    if (modal) modal.classList.remove('open');
    igDayModalDateKey = null;
}

// ---- Buka/tutup editor inline di kartu rencana (modal harian) ----
// Field auto-save lewat igPlanUpdateField (blur/change). Saat ditutup, modal
// dirender ulang (jeda singkat supaya simpan dari blur selesai dulu).
function igTogglePlanEdit(planId) {
    const card = document.getElementById(`igDayPlanItem-${planId}`);
    const edit = card && card.querySelector('.ig-dm-edit');
    if (!edit) return;
    if (edit.style.display !== 'none') {
        const key = igDayModalDateKey;
        // Tunggu semua simpan yang masih berjalan (blur tema/caption) baru render ulang, bukan
        // menebak 250 ms -- di jaringan lambat kartu sempat menampilkan teks lama.
        Promise.allSettled([...igPlanPendingSaves]).then(() => {
            if (key && igDayModalDateKey === key) igOpenDayModal(key);
        });
        return;
    }
    edit.style.display = 'block';
    card.classList.add('is-editing');
    const tema = edit.querySelector('.ig-dm-tema');
    if (tema) { tema.focus(); tema.select(); }
}

// ---- Update counter karakter live saat mengetik di textarea edit rencana ----
function igUpdatePlanCharCount(planId, length) {
    const el = document.getElementById(`igPlanCharCount-${planId}`);
    if (el) el.textContent = `${length} / 2200 karakter`;
}

function igAddPostFromDayModal() {
    const dateKey = igDayModalDateKey;
    closeIgDayModal();
    openIgUploadModal(null, dateKey);
}

// ---- Modal: Upload/Edit Post ----
// Item-item carousel yang sedang diedit di modal (state sementara sebelum Simpan).
// Tiap item: { media_url, media_type: 'image'|'video' }
let igCarouselItems = [];
const IG_CAROUSEL_MIN = 2;
const IG_CAROUSEL_MAX = 10;

function openIgUploadModal(postId = null, presetDateKey = null) {
    if (!canManageProgramData()) {
        showToast('Akun Anda tidak punya izin untuk mengelola post IG', 'error');
        return;
    }

    const modal = document.getElementById('igUploadModal');
    const form = document.getElementById('igUploadForm');
    if (!modal || !form) return;

    igDiscardSessionUploads(); // sisa upload dari sesi modal sebelumnya yang tidak jadi disimpan
    igOriginalMediaUrls = [];
    form.reset();
    document.getElementById('ig_post_id').value = '';
    document.getElementById('ig_media_url').value = '';
    document.getElementById('igMediaFileName').textContent = '-';
    document.getElementById('igCaptionCount').textContent = '2200';
    document.getElementById('ig_media_type').value = 'image';
    const ideaEl = document.getElementById('ig_caption_idea');
    if (ideaEl) ideaEl.value = '';
    igResetAICaptionState();
    igCarouselItems = [];
    renderIgCarouselGrid();
    igActivePlanId = null; // direset di sini, di-set lagi oleh igConvertPlanToPost() kalau modal dibuka dari rencana

    // Default tanggal/jam = besok pagi (atau tanggal yang dipilih dari kalender)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    document.getElementById('ig_schedule_date').value = presetDateKey || igLocalDateKey(tomorrow);
    document.getElementById('ig_schedule_time').value = '09:00';

    const modalTitle = document.getElementById('igModalTitle');
    // Mode planner hanya menyimpan DRAFT (tidak ada auto-publish), jadi judulnya jangan menjanjikan "ke Instagram"
    if (modalTitle) modalTitle.textContent = IG_AUTOPUBLISH_ENABLED ? 'Post Baru ke Instagram' : 'Draft Post Baru';

    // Clear preview
    const preview = document.getElementById('igMediaPreview');
    if (preview) preview.innerHTML = '';

    // Load akun IG & isi dropdown
    loadIgAccounts();

    if (postId) {
        // Mode edit
        const post = igPosts.find(p => p.id === postId);
        if (post) {
            modalTitle.textContent = IG_AUTOPUBLISH_ENABLED ? 'Edit Post IG' : 'Edit Draft Post';
            document.getElementById('ig_post_id').value = post.id;
            document.getElementById('ig_caption').value = post.caption || '';
            if (post.schedule_time) {
                const d = new Date(post.schedule_time);
                // Pakai komponen LOKAL untuk tanggal & jam (toISOString memberi tanggal UTC,
                // bikin tanggal mundur sehari untuk jam 00:00–06:59 WIB).
                const pad = n => String(n).padStart(2, '0');
                document.getElementById('ig_schedule_date').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                document.getElementById('ig_schedule_time').value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
            }
            document.getElementById('ig_media_type').value = post.media_type || 'image';
            document.getElementById('ig_media_url').value = post.media_url || '';
            igOriginalMediaUrls = post.media_url ? [post.media_url] : [];

            if (post.media_type === 'carousel') {
                // Ambil item carousel dari tabel ig_post_media
                loadIgCarouselItemsForEdit(post.id);
            } else if (post.media_url) {
                const pre = document.getElementById('igMediaPreview');
                if (pre) {
                    if (post.media_type === 'image') {
                        pre.innerHTML = `<img src="${escapeHtmlAttr(post.media_url)}" class="ig-media-preview-img">`;
                    } else {
                        pre.innerHTML = `<video src="${escapeHtmlAttr(post.media_url)}" class="ig-media-preview-img" controls></video>`;
                    }
                }
            }
            // Select akun default
            const accountSelect = document.getElementById('ig_account_id');
            if (accountSelect && igAccounts.length) {
                accountSelect.value = igAccounts[0].id;
            }
        }
    } else {
        // Mode baru — select first akun by default
        const accountSelect = document.getElementById('ig_account_id');
        if (accountSelect && igAccounts.length) {
            accountSelect.value = igAccounts[0].id;
        }
    }

    // Show hide account picker — kalau belum ada akun sama sekilo, tampilkan notif
    const pickerWrap = document.getElementById('igAccountPickerWrap');
    if (pickerWrap) {
        pickerWrap.style.display = igAccounts.length ? 'block' : 'none';
    }

    onIgMediaTypeChange();
    modal.classList.add('open');

    // Caption counter
    const captionEl = document.getElementById('ig_caption');
    if (captionEl) {
        captionEl.oninput = function() {
            const remaining = 2200 - this.value.length;
            const countEl = document.getElementById('igCaptionCount');
            if (countEl) countEl.textContent = Math.max(0, remaining);
        };
    }
}

// ---- Ambil item carousel yang sudah tersimpan (mode edit) ----
async function loadIgCarouselItemsForEdit(postId) {
    try {
        const { data, error } = await supabaseClient
            .from('ig_post_media')
            .select('media_url, media_type, position')
            .eq('post_id', postId)
            .order('position', { ascending: true });
        if (error) throw error;
        igCarouselItems = (data || []).map(item => ({ media_url: item.media_url, media_type: item.media_type }));
        // Catat URL asli supaya item yang nanti dibuang/diganti bisa dibersihkan dari bucket saat disimpan
        igOriginalMediaUrls = Array.from(new Set([...igOriginalMediaUrls, ...igCarouselItems.map(i => i.media_url)]));
        renderIgCarouselGrid();
    } catch (err) {
        console.error('loadIgCarouselItemsForEdit error:', err);
        showToast('Gagal memuat item carousel: ' + err.message, 'error');
    }
}

function closeIgUploadModal() {
    const modal = document.getElementById('igUploadModal');
    if (modal) modal.classList.remove('open');
    // Batal/tutup tanpa menyimpan: file yang sudah terlanjur diupload di sesi ini dibuang dari bucket
    igDiscardSessionUploads();
    igOriginalMediaUrls = [];
    igCarouselItems = [];
}

// ---- Toggle tampilan form sesuai tipe media yang dipilih ----
function onIgMediaTypeChange() {
    const mediaType = document.getElementById('ig_media_type')?.value || 'image';
    const singleWrap = document.getElementById('igSingleMediaWrap');
    const carouselWrap = document.getElementById('igCarouselMediaWrap');
    if (!singleWrap || !carouselWrap) return;

    if (mediaType === 'carousel') {
        singleWrap.style.display = 'none';
        carouselWrap.style.display = 'block';
    } else {
        singleWrap.style.display = 'block';
        carouselWrap.style.display = 'none';
        // Ganti accept sesuai tipe supaya validasi lebih jelas ke user
        const fileInput = document.getElementById('ig_media_file');
        if (fileInput) fileInput.accept = mediaType === 'video' ? '.mp4,.mov' : 'image/jpeg,image/png,image/webp';
    }
}

// ---- Handle media file change (image/video tunggal) ----
async function onIgMediaChange() {
    const input = document.getElementById('ig_media_file');
    const fileNameEl = document.getElementById('igMediaFileName');
    const urlEl = document.getElementById('ig_media_url');
    const preview = document.getElementById('igMediaPreview');

    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    const mediaType = document.getElementById('ig_media_type')?.value || 'image';

    // Validasi ukuran
    if (file.size > IG_MAX_FILE_SIZE) {
        showToast('File terlalu besar (maks 10MB)', 'error');
        return;
    }

    // Validasi tipe
    const allowedImage = ['image/jpeg', 'image/png', 'image/webp'];
    const allowedVideo = ['video/mp4', 'video/quicktime'];
    if (mediaType === 'image' && !allowedImage.includes(file.type)) {
        showToast('Format file tidak didukung untuk image (jpg, png, webp)', 'error');
        return;
    }
    if (mediaType === 'video' && !allowedVideo.includes(file.type)) {
        showToast('Format file tidak didukung untuk video (mp4, mov)', 'error');
        return;
    }

    const prevLabel = fileNameEl ? fileNameEl.textContent : '-';
    const prevUrl = urlEl ? urlEl.value : '';
    if (fileNameEl) fileNameEl.textContent = file.name;
    showToast('Mengupload media...', 'info');

    try {
        const publicUrl = await uploadIgMediaFile(file);
        if (urlEl) urlEl.value = publicUrl;

        // Preview
        if (preview) {
            if (mediaType === 'image') {
                preview.innerHTML = `<img src="${escapeHtmlAttr(publicUrl)}" class="ig-media-preview-img">`;
            } else {
                preview.innerHTML = `<video src="${escapeHtmlAttr(publicUrl)}" class="ig-media-preview-img" controls></video>`;
            }
        }

        // File pengganti dari sesi ini yang sudah tidak dipakai -> buang dari bucket
        // (file yang sudah tersimpan di post lama dibersihkan saat Simpan, lewat igOriginalMediaUrls)
        if (prevUrl && prevUrl !== publicUrl && igSessionUploads.has(prevUrl)) {
            igSessionUploads.delete(prevUrl);
            igRemoveStorageUrls([prevUrl]);
        }

        showToast('Media berhasil diupload', 'success');
    } catch (err) {
        console.error('IG upload error:', err);
        // Upload gagal: label nama file jangan menampilkan file baru padahal URL yang tersimpan masih yang lama
        if (fileNameEl) fileNameEl.textContent = prevLabel;
        input.value = '';
        showToast('Gagal upload media: ' + err.message, 'error');
    }
}

// ---- Helper: bersihkan nama file untuk nama objek di bucket ----
// Nama asli (kurung siku, emoji, spasi, spasi ganda, huruf beraksen, dll.) bisa ditolak Storage
// atau menghasilkan URL yang bermasalah di Graph API. Sisakan huruf/angka/_/- saja.
const IG_MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };
function igSafeFileName(name, mime) {
    const raw = String(name || '');
    const dot = raw.lastIndexOf('.');
    let base = dot > 0 ? raw.slice(0, dot) : raw;
    let ext = dot > 0 ? raw.slice(dot + 1) : '';
    base = base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '')
        .slice(0, 50) || 'media';
    ext = ext.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || IG_MIME_EXT[mime] || '';
    return ext ? `${base}.${ext}` : base;
}

// ---- Helper: tanggal lokal YYYY-MM-DD (toISOString memberi tanggal UTC) ----
function igLocalDateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- Helper: hapus file dari bucket ig-media berdasarkan public URL (best effort) ----
// Butuh policy DELETE di storage.objects (lihat sql/50_tambah_ig_media_storage_policy.sql). Kalau
// policy belum ada, penghapusan gagal diam-diam (hanya console.warn) dan data tidak terganggu.
function igStoragePathFromUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const marker = `/${IG_STORAGE_BUCKET}/`;
    const i = url.indexOf(marker);
    if (i === -1 || !url.startsWith(SUPABASE_URL)) return null; // bukan file bucket kita -> jangan disentuh
    let path = url.slice(i + marker.length).split('?')[0];
    try { path = decodeURIComponent(path); } catch (e) {}
    return path || null;
}
async function igRemoveStorageUrls(urls) {
    const paths = Array.from(new Set((urls || []).map(igStoragePathFromUrl).filter(Boolean)));
    if (!paths.length) return;
    try {
        const { error } = await supabaseClient.storage.from(IG_STORAGE_BUCKET).remove(paths);
        if (error) console.warn('Gagal membersihkan media IG dari bucket:', error.message);
    } catch (err) {
        console.warn('Gagal membersihkan media IG dari bucket:', err);
    }
}
function igDiscardSessionUploads() {
    const urls = Array.from(igSessionUploads);
    igSessionUploads.clear();
    if (urls.length) igRemoveStorageUrls(urls);
}

// ---- Helper: upload 1 file ke bucket ig-media, return public URL ----
async function uploadIgMediaFile(file) {
    const fileName = `ig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${igSafeFileName(file.name, file.type)}`;
    igUploadsInFlight++;
    try {
        const { data, error } = await supabaseClient.storage
            .from(IG_STORAGE_BUCKET)
            .upload(fileName, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
        if (error) throw error;

        const { data: { publicUrl } } = supabaseClient.storage
            .from(IG_STORAGE_BUCKET)
            .getPublicUrl(data.path);
        igSessionUploads.add(publicUrl);
        return publicUrl;
    } finally {
        igUploadsInFlight--;
    }
}

// ---- Handle multi-file change (carousel) ----
async function onIgCarouselFilesChange() {
    const input = document.getElementById('ig_carousel_files');
    if (!input.files || !input.files.length) return;

    const files = Array.from(input.files);
    const allowedImage = ['image/jpeg', 'image/png', 'image/webp'];
    const allowedVideo = ['video/mp4', 'video/quicktime'];

    if (igCarouselItems.length + files.length > IG_CAROUSEL_MAX) {
        showToast(`Carousel maksimal ${IG_CAROUSEL_MAX} item media`, 'error');
        input.value = '';
        return;
    }

    let uploadedCount = 0;
    for (const file of files) {
        if (file.size > IG_MAX_FILE_SIZE) {
            showToast(`File "${file.name}" terlalu besar (maks 10MB)`, 'error');
            continue;
        }
        let itemType;
        if (allowedImage.includes(file.type)) itemType = 'image';
        else if (allowedVideo.includes(file.type)) itemType = 'video';
        else {
            showToast(`Format "${file.name}" tidak didukung`, 'error');
            continue;
        }

        try {
            showToast(`Mengupload ${file.name}...`, 'info');
            const publicUrl = await uploadIgMediaFile(file);
            igCarouselItems.push({ media_url: publicUrl, media_type: itemType });
            uploadedCount++;
            renderIgCarouselGrid();
        } catch (err) {
            console.error('IG carousel upload error:', err);
            showToast(`Gagal upload ${file.name}: ` + err.message, 'error');
        }
    }

    input.value = '';
    // Toast sukses hanya kalau memang ada file yang berhasil (error per file sudah ditampilkan di atas)
    if (uploadedCount > 0) {
        showToast(uploadedCount === files.length
            ? `${uploadedCount} media carousel berhasil diupload`
            : `${uploadedCount} dari ${files.length} media berhasil diupload`, 'success');
    }
}

function igCarouselMoveItem(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= igCarouselItems.length) return;
    const tmp = igCarouselItems[index];
    igCarouselItems[index] = igCarouselItems[target];
    igCarouselItems[target] = tmp;
    renderIgCarouselGrid();
}

function igCarouselRemoveItem(index) {
    const [removed] = igCarouselItems.splice(index, 1);
    // Item yang baru diupload di sesi ini lalu dibuang -> hapus dari bucket sekarang juga.
    // (Item yang sudah tersimpan di post dibersihkan saat Simpan, supaya Batal tidak merusak post lama.)
    if (removed && igSessionUploads.has(removed.media_url)) {
        igSessionUploads.delete(removed.media_url);
        igRemoveStorageUrls([removed.media_url]);
    }
    renderIgCarouselGrid();
}

function renderIgCarouselGrid() {
    const grid = document.getElementById('igCarouselGrid');
    const countEl = document.getElementById('igCarouselCount');
    if (countEl) countEl.textContent = `${igCarouselItems.length} item`;
    if (!grid) return;

    if (!igCarouselItems.length) {
        grid.innerHTML = '';
        return;
    }

    grid.innerHTML = igCarouselItems.map((item, i) => {
        const media = item.media_type === 'video'
            ? `<video src="${escapeHtmlAttr(item.media_url)}" muted></video>`
            : `<img src="${escapeHtmlAttr(item.media_url)}" alt="item ${i + 1}">`;
        return `<div class="ig-carousel-item">
            ${media}
            <span class="ig-carousel-item-badge">${i + 1}</span>
            <div class="ig-carousel-item-actions">
                <button type="button" onclick="igCarouselMoveItem(${i}, -1)" ${i === 0 ? 'disabled' : ''} title="Geser ke kiri"><i class="bi bi-arrow-left"></i></button>
                <button type="button" class="ig-carousel-remove" onclick="igCarouselRemoveItem(${i})" title="Hapus"><i class="bi bi-trash-fill"></i></button>
                <button type="button" onclick="igCarouselMoveItem(${i}, 1)" ${i === igCarouselItems.length - 1 ? 'disabled' : ''} title="Geser ke kanan"><i class="bi bi-arrow-right"></i></button>
            </div>
        </div>`;
    }).join('');
}

// ---- Generate caption IG dengan AI (gaya feed IG, beda dari caption WA) ----
const IG_CAPTION_MAX = 2200;
const IG_AI_TIMEOUT_MS = 45000;
let igCaptionBeforeAI = null;   // isi caption sebelum ditimpa AI (untuk tombol "Kembalikan")
let igLastAICaption = '';       // hasil AI terakhir -> dikirim sebagai "hindari" supaya generate ulang beda sudut

function igUpdateCaptionCount() {
    const el = document.getElementById('ig_caption');
    const countEl = document.getElementById('igCaptionCount');
    if (el && countEl) countEl.textContent = Math.max(0, IG_CAPTION_MAX - el.value.length);
}

function igResetAICaptionState() {
    igCaptionBeforeAI = null;
    igLastAICaption = '';
    const undo = document.getElementById('btnIgCaptionUndo');
    if (undo) undo.style.display = 'none';
}

function undoIgCaptionAI() {
    const captionEl = document.getElementById('ig_caption');
    if (!captionEl || igCaptionBeforeAI === null) return;
    captionEl.value = igCaptionBeforeAI;
    igUpdateCaptionCount();
    igResetAICaptionState();
    showToast('Caption dikembalikan', 'info');
}

// Konteks seri mingguan untuk caption AI: hari & peran, Tema Minggu, teks di gambar (tanpa baris label), dan tema
// hari sebelumnya/sesudahnya di rencana yang sama. Kosong kalau modal tidak dibuka dari "Jadikan Post".
function igBuildKonteksSeri(planId) {
    const plan = planId ? igContentPlan.find(pl => pl.id === planId) : null;
    if (!plan || !plan.tanggal) return '';
    const [y, m, d] = plan.tanggal.split('-').map(Number);
    const pola = igPolaHari(plan.tanggal, plan.tema_minggu);
    const tetangga = selisih => {
        const key = igLocalDateKey(new Date(y, m - 1, d + selisih));
        const t = igContentPlan.find(pl => pl.tanggal === key && pl.status !== 'dilewati' && pl.id !== plan.id
            && (!plan.tema_minggu || pl.tema_minggu === plan.tema_minggu));
        return t ? t.tema : '';
    };
    const teksGambar = String(plan.teks_gambar || '').split('\n').filter(l => !/^Label gambar:/i.test(l)).join('\n').trim();
    const baris = [];
    if (pola) baris.push(`Hari: ${pola.hari} (${pola.urutan}/7), peran: ${pola.peran}${pola.catatan ? ` (${pola.catatan})` : ''}`);
    if (plan.tema_minggu) baris.push(`Tema Minggu: ${plan.tema_minggu}`);
    if (plan.tema) baris.push(`Judul ide: ${plan.tema}`);
    if (teksGambar) baris.push(`Teks di gambar (caption adalah lanjutannya):\n${teksGambar}`);
    const sebelumnya = tetangga(-1), besok = tetangga(1);
    if (sebelumnya) baris.push(`Konten hari sebelumnya (bahan untuk menyambung isi; jangan disebut atau dirujuk dengan kata kemarin/semalam/tadi): ${sebelumnya}`);
    if (besok) baris.push(`Konten besok (untuk teaser penutup): ${besok}`);
    return baris.join('\n');
}

async function generateIgCaptionAI() {
    const btn = document.getElementById('btnGenIgCaptionAI');
    const btnText = document.getElementById('btnGenIgCaptionAIText');
    const captionEl = document.getElementById('ig_caption');
    if (!captionEl || (btn && btn.disabled)) return; // cegah klik ganda

    // Sumber konsep: kotak "Ide/Konsep Singkat" kalau diisi, kalau kosong
    // pakai isi caption yang sudah ada (misal mau dipoles ulang jadi gaya IG).
    let raw = (document.getElementById('ig_caption_idea')?.value || '').trim();
    if (!raw) raw = (captionEl.value || '').trim();
    if (!raw) {
        showToast('Isi dulu Ide/Konsep Singkat, atau tulis draft caption', 'error');
        return;
    }

    const tujuan = document.getElementById('ig_caption_goal')?.value || 'promo';
    const mediaType = document.getElementById('ig_media_type')?.value || 'image';
    // Hanya kirim "hindari" kalau caption saat ini MASIH hasil AI sebelumnya (belum diedit manual);
    // kalau admin sudah mengubahnya, jangan paksa AI menjauhi tulisan admin.
    const hindari = (igLastAICaption && captionEl.value.trim() === igLastAICaption) ? igLastAICaption : '';
    const konteks = igBuildKonteksSeri(igActivePlanId);

    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = 'Menyusun...';

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), IG_AI_TIMEOUT_MS);

    try {
        const response = await fetch(IG_CAPTION_FUNCTION_URL, {
            method: 'POST',
            signal: ctrl.signal,
            headers: await igAiAuthHeaders(),
            body: JSON.stringify({ userMsg: raw, tujuan, mediaType, hindari, konteks })
        });
        if (!response.ok) {
            let detail = '';
            try { detail = (await response.json()).error || ''; } catch (e) {}
            if (!detail && response.status === 404) detail = 'Function generate-ig-caption belum di-deploy';
            throw new Error(detail || 'Gagal memanggil API (status ' + response.status + ')');
        }
        const data = await response.json();
        const result = (data.text || '').trim();
        if (!result) throw new Error('Tidak ada hasil teks dari model.');

        // Simpan caption lama (kalau ada & beda) supaya bisa dikembalikan
        const current = captionEl.value;
        if (current.trim() && current !== igLastAICaption) igCaptionBeforeAI = current;
        captionEl.value = result;
        igLastAICaption = result;
        igUpdateCaptionCount();
        const undo = document.getElementById('btnIgCaptionUndo');
        if (undo) undo.style.display = igCaptionBeforeAI !== null ? '' : 'none';

        showToast('Caption IG berhasil dibuat dengan AI');
        // Angka di caption yang tidak ada di konsep (harga/tanggal/kuota) -> minta admin cek
        if (Array.isArray(data.warnings) && data.warnings.length) {
            showToast(data.warnings.slice(0, 2).join(' • '), 'info');
        }
    } catch (err) {
        console.error('generateIgCaptionAI error:', err);
        const msg = err && err.name === 'AbortError'
            ? 'Waktu habis (' + (IG_AI_TIMEOUT_MS / 1000) + ' detik). Coba lagi sebentar lagi.'
            : err.message;
        showToast('Gagal generate caption: ' + msg, 'error');
    } finally {
        clearTimeout(timer);
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'Generate dengan AI';
    }
}

// ---- Save post (create / update) ----
function igSetSubmitBusy(busy) {
    const btn = document.getElementById('igSubmitBtn');
    if (!btn) return;
    if (busy) {
        btn._origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = 'Menyimpan...';
    } else {
        btn.disabled = false;
        if (btn._origHtml !== undefined) btn.innerHTML = btn._origHtml;
    }
}

async function saveIgPost(e) {
    e.preventDefault();
    if (!canManageProgramData()) return;
    if (igSaving) return; // klik ganda / Enter berulang -> jangan simpan dobel
    if (igUploadsInFlight > 0) { showToast('Tunggu upload media selesai dulu', 'info'); return; }

    const postId = document.getElementById('ig_post_id').value;
    const caption = document.getElementById('ig_caption').value.trim();
    const mediaType = document.getElementById('ig_media_type').value;
    const scheduleDate = document.getElementById('ig_schedule_date').value;
    const scheduleTime = document.getElementById('ig_schedule_time').value;

    if (!scheduleDate || !scheduleTime) { showToast('Jadwal wajib diisi', 'error'); return; }

    let mediaUrl;
    if (mediaType === 'carousel') {
        if (igCarouselItems.length < IG_CAROUSEL_MIN) {
            showToast(`Carousel butuh minimal ${IG_CAROUSEL_MIN} item media`, 'error');
            return;
        }
        mediaUrl = igCarouselItems[0].media_url; // dipakai buat thumbnail di tabel/kalender
    } else {
        mediaUrl = document.getElementById('ig_media_url').value;
        if (!mediaUrl) { showToast('Media belum diupload', 'error'); return; }
    }

    // Interpretasikan input sebagai waktu LOKAL browser (WIB), lalu kirim sebagai ISO UTC.
    // Sebelumnya string tanpa offset dibaca Postgres sebagai UTC → jadwal 09:00 WIB
    // tersimpan 09:00 UTC (= 16:00 WIB), telat 7 jam.
    const scheduleISO = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();

    const postData = {
        caption: caption || null,
        media_url: mediaUrl,
        media_type: mediaType || 'image',
        schedule_time: scheduleISO,
        status: IG_AUTOPUBLISH_ENABLED ? 'scheduled' : 'draft'
    };

    igSaving = true;
    igSetSubmitBusy(true);
    try {
        let result;
        let savedPostId = postId;
        if (postId) {
            result = await supabaseClient.from('ig_posts').update(postData).eq('id', postId).select();
        } else {
            result = await supabaseClient.from('ig_posts').insert([postData]).select();
        }

        if (result.error) throw result.error;
        if (!savedPostId && result.data && result.data[0]) {
            savedPostId = result.data[0].id;
            // Post sudah ada di DB: kalau langkah berikutnya gagal lalu user menekan Simpan lagi,
            // harus meng-update post ini, bukan membuat post kedua.
            document.getElementById('ig_post_id').value = savedPostId;
        }

        // Sinkronkan item carousel: hapus dulu item lama punya post ini, lalu insert ulang
        // sesuai urutan sekarang. Simpel & aman untuk jumlah item yang kecil (maks 10).
        if (mediaType === 'carousel' && savedPostId) {
            const { error: delErr } = await supabaseClient.from('ig_post_media').delete().eq('post_id', savedPostId);
            if (delErr) throw delErr;

            const rows = igCarouselItems.map((item, i) => ({
                post_id: savedPostId,
                media_url: item.media_url,
                media_type: item.media_type,
                position: i
            }));
            const { error: insErr } = await supabaseClient.from('ig_post_media').insert(rows);
            if (insErr) throw insErr;
        } else if (postId) {
            // Kalau edit dan tipe diganti dari carousel ke image/video, bersihkan sisa item lama
            await supabaseClient.from('ig_post_media').delete().eq('post_id', postId);
        }

        // Kalau modal ini dibuka dari tombol "Jadikan Post" di rencana konten,
        // tandai rencana tsb sebagai sudah dikonversi & link ke post yang baru dibuat.
        if (igActivePlanId && savedPostId) {
            const { error: planErr } = await supabaseClient.from('ig_content_plan')
                .update({ status: 'dijadikan_post', ig_post_id: savedPostId })
                .eq('id', igActivePlanId);
            if (planErr) {
                console.error('Gagal update status rencana:', planErr);
                showToast('Post tersimpan, tapi status rencana gagal diperbarui — ide asal mungkin masih tampil di kalender', 'error');
            }
            igActivePlanId = null;
            await loadIgContentPlan();
        }

        // Bersihkan dari bucket media yang tidak lagi dipakai: file pengganti, item carousel yang
        // dibuang, atau upload yang tidak jadi dipakai. Best effort & tidak ditunggu.
        const keepUrls = new Set(mediaType === 'carousel' ? igCarouselItems.map(i => i.media_url) : [mediaUrl]);
        const unused = [...igSessionUploads, ...igOriginalMediaUrls].filter(u => !keepUrls.has(u));
        igSessionUploads.clear();   // yang dipakai sudah resmi tersimpan; sisanya masuk daftar `unused`
        igOriginalMediaUrls = [];
        if (unused.length) igRemoveStorageUrls(unused);

        showToast(`${IG_AUTOPUBLISH_ENABLED ? 'Post' : 'Draft'} ${postId ? 'diperbarui' : 'ditambahkan'}`, 'success');
        closeIgUploadModal();
        igPostsCurrentPage = 1;
        await loadIgPosts(true);
    } catch (err) {
        console.error('saveIgPost error:', err);
        showToast('Gagal menyimpan post: ' + err.message, 'error');
    } finally {
        igSaving = false;
        igSetSubmitBusy(false);
    }
}

// ---- Delete post ----
async function deleteIgPost(postId) {
    if (!canManageProgramData()) return;
    try {
        // Kumpulkan URL media SEBELUM hapus (item carousel ikut terhapus oleh cascade) untuk dibersihkan dari bucket
        const mediaUrls = [];
        const postRow = igPosts.find(p => p.id === postId);
        if (postRow && postRow.media_url) mediaUrls.push(postRow.media_url);
        try {
            const { data: itemRows } = await supabaseClient.from('ig_post_media').select('media_url').eq('post_id', postId);
            (itemRows || []).forEach(r => { if (r.media_url) mediaUrls.push(r.media_url); });
        } catch (e) { /* abaikan: pembersihan bucket hanya best effort */ }

        // Ide asal post ini (kalau ada) dikembalikan jadi 'idea' supaya tidak hilang dari kalender.
        // Dilakukan SEBELUM hapus karena FK ig_post_id otomatis di-null-kan saat post terhapus.
        const { error: revErr } = await supabaseClient.from('ig_content_plan')
            .update({ status: 'idea', ig_post_id: null }).eq('ig_post_id', postId).eq('status', 'dijadikan_post');
        if (revErr) console.error('Gagal mengembalikan status rencana:', revErr);
        const { error } = await supabaseClient.from('ig_posts').delete().eq('id', postId);
        if (error) throw error;
        igRemoveStorageUrls(mediaUrls); // post sudah terhapus -> media yatim ikut dibuang (tidak ditunggu)
        await loadIgContentPlan();
        showToast('Post dihapus', 'success');
        closeIgActionModal();
        igPostsCurrentPage = 1;
        await loadIgPosts(true);
    } catch (err) {
        showToast('Gagal hapus post: ' + err.message, 'error');
    }
}

// ---- Retry post (manual) via edge function ----
async function retryIgPost(postId) {
    if (!canManageProgramData()) return;
    showToast('Memicu retry publish...', 'info');
    try {
        // Call edge function ig-manual-retry
        const res = await fetch(`${SUPABASE_URL}/functions/v1/ig-manual-retry`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${(await supabaseClient.auth.getSession()).data.session?.access_token || ''}`
            },
            body: JSON.stringify({ post_id: postId })
        });
        const result = await res.json();
        if (result.success || res.ok) {
            showToast('Retry berhasil — post akan dipublish lagi', 'success');
        } else {
            showToast('Retry gagal: ' + (result.error || res.statusText), 'error');
        }
        closeIgActionModal();
        await loadIgPosts(true);
    } catch (err) {
        showToast('Gagal retry: ' + err.message, 'error');
    }
}

// ============================================================
// 24b. IG COMMENTS (balas komentar dari dashboard)
// Memaksimalkan fitur GRATIS Graph API (instagram_manage_comments) yang
// sebelumnya belum dipakai — cache komentar ada di tabel ig_comments,
// disinkron oleh edge function ig-sync-comments (cron tiap 15 menit),
// aksi balas/hide/hapus lewat edge function ig-comment-action.
// ============================================================

// ---- Hitung jumlah komentar belum dibalas per post (untuk badge) ----
async function loadIgCommentsUnreadCount() {
    try {
        const { data, error } = await supabaseClient
            .from('ig_comments')
            .select('post_id')
            .eq('is_our_reply', false)
            .eq('replied', false)
            .eq('hidden', false);
        if (error) throw error;
        const counts = {};
        (data || []).forEach(row => {
            if (!row.post_id) return;
            counts[row.post_id] = (counts[row.post_id] || 0) + 1;
        });
        igCommentsUnrepliedCountByPost = counts;
        renderIgPostTable();
        updateIgSchedulerCount();
    } catch (err) {
        console.error('loadIgCommentsUnreadCount error:', err);
    }
}

// ---- Trigger sync manual (tombol "Sync Komentar") ----
async function syncIgCommentsNow() {
    showToast('Menyinkron komentar dari Instagram...', 'info');
    try {
        const res = await fetch(IG_SYNC_COMMENTS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${(await supabaseClient.auth.getSession()).data.session?.access_token || ''}`
            },
            body: JSON.stringify({})
        });
        const result = await res.json();
        if (result.ok) {
            showToast(`Sync selesai — ${result.new_comments || 0} komentar baru`, 'success');
        } else {
            showToast('Sync gagal: ' + (result.error || res.statusText), 'error');
        }
        await loadIgCommentsUnreadCount();
        await loadIgCommentsPanel();
        if (igCommentsCurrentPostId) await renderIgCommentsModalBody(igCommentsCurrentPostId);
    } catch (err) {
        showToast('Gagal sync komentar: ' + err.message, 'error');
    }
}

// ---- Panel komentar di layar utama (sisi kanan, sebelah kalender) ----
let igCommentsPanelFilterPostId = null; // null = tampilkan semua komentar

async function filterIgCommentsPanel(postId) {
    igCommentsPanelFilterPostId = postId;
    const panel = document.getElementById('igCommentsPanel') || document.querySelector('.ig-comments-panel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    await loadIgCommentsPanel();
}

async function loadIgCommentsPanel() {
    const body = document.getElementById('igCommentsPanelBody');
    const clearBtn = document.getElementById('igCommentsPanelClearBtn');
    const countEl = document.getElementById('igCommentsPanelCount');
    if (!body) return;
    if (clearBtn) clearBtn.style.display = igCommentsPanelFilterPostId ? 'inline-flex' : 'none';
    body.innerHTML = `<div class="ig-empty"><i class="bi bi-hourglass-split"></i> Memuat komentar...</div>`;

    try {
        let query = supabaseClient
            .from('ig_comments')
            .select('*, ig_posts(caption, media_url, media_type)')
            .eq('is_our_reply', false)
            .order('commented_at', { ascending: false })
            .limit(50);
        if (igCommentsPanelFilterPostId) query = query.eq('post_id', igCommentsPanelFilterPostId);

        const { data, error } = await query;
        if (error) throw error;

        if (countEl) countEl.textContent = data && data.length ? `(${data.length})` : '';

        const canManage = canManageProgramData();
        body.innerHTML = (data && data.length) ? data.map(c => {
            const post = c.ig_posts || {};
            const captionSnippet = post.caption ? escapeHtml(post.caption.slice(0, 60)) + (post.caption.length > 60 ? '…' : '') : '(tanpa caption)';
            return `
                <div class="ig-comment-item${c.hidden ? ' ig-comment-hidden' : ''}">
                    ${!igCommentsPanelFilterPostId ? `
                    <button type="button" class="ig-comment-post-ref" onclick="filterIgCommentsPanel('${c.post_id}')" title="Lihat komentar post ini saja">
                        ${post.media_url ? `<img src="${post.media_url}" class="ig-comment-post-thumb" loading="lazy">` : `<span class="ig-comment-post-thumb ig-comment-post-thumb-empty"><i class="bi bi-images"></i></span>`}
                        <span class="ig-comment-post-caption">${captionSnippet}</span>
                    </button>` : ''}
                    <div class="ig-comment-item-head">
                        <b>${escapeHtml(c.username || 'seseorang')}</b>
                        <span class="ig-comment-time">${c.commented_at ? new Date(c.commented_at).toLocaleString('id-ID') : ''}</span>
                    </div>
                    <p class="ig-comment-text">${escapeHtml(c.comment_text || '')}</p>
                    ${c.replied && c.our_reply_text ? `<div class="ig-comment-our-reply"><i class="bi bi-reply-fill"></i> Balasan kita: ${escapeHtml(c.our_reply_text)}</div>` : ''}
                    ${canManage ? `
                    <div class="ig-comment-item-actions">
                        ${!c.replied ? `
                        <input type="text" id="ig_reply_input_${c.ig_comment_id}" placeholder="Tulis balasan...">
                        <button class="btn-primary" onclick="igReplyComment('${c.ig_comment_id}')"><i class="bi bi-reply-fill"></i> Balas</button>
                        ` : ''}
                        <button class="btn-cancel" onclick="igToggleHideComment('${c.ig_comment_id}', ${c.hidden ? 'false' : 'true'})">
                            <i class="bi bi-eye${c.hidden ? '' : '-slash'}-fill"></i> ${c.hidden ? 'Tampilkan' : 'Sembunyikan'}
                        </button>
                        <button class="btn-danger" onclick="igDeleteComment('${c.ig_comment_id}')"><i class="bi bi-trash-fill"></i></button>
                    </div>` : ''}
                </div>`;
        }).join('') : `<div class="ig-empty"><i class="bi bi-chat-square-dots"></i> ${igCommentsPanelFilterPostId ? 'Belum ada komentar untuk post ini.' : 'Belum ada komentar (atau belum disinkron).'}</div>`;
    } catch (err) {
        body.innerHTML = `<p style="color:var(--danger);font-size:12.5px;">Gagal memuat komentar: ${escapeHtml(err.message)}</p>`;
    }
}
window.filterIgCommentsPanel = filterIgCommentsPanel;
window.loadIgCommentsPanel = loadIgCommentsPanel;

// ---- Buka modal komentar untuk 1 post (reuse igActionModal) ----
async function openIgCommentsModal(postId) {
    igCommentsCurrentPostId = postId;
    const modal = document.getElementById('igActionModal');
    const title = document.getElementById('igActionTitle');
    if (!modal || !title) return;
    title.textContent = 'Komentar Post';
    modal.classList.add('open');
    await renderIgCommentsModalBody(postId);
}

async function renderIgCommentsModalBody(postId) {
    const body = document.getElementById('igActionBody');
    if (!body) return;
    body.innerHTML = `<p style="color:var(--ink-soft);font-size:12.5px;"><i class="bi bi-hourglass-split"></i> Memuat komentar...</p>`;

    try {
        const { data, error } = await supabaseClient
            .from('ig_comments')
            .select('*')
            .eq('post_id', postId)
            .eq('is_our_reply', false)
            .order('commented_at', { ascending: false });
        if (error) throw error;

        const canManage = canManageProgramData();
        const listHtml = (data && data.length)
            ? data.map(c => `
                <div class="ig-comment-item" style="border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:8px;${c.hidden ? 'opacity:.55;' : ''}">
                    <div style="display:flex;justify-content:space-between;gap:8px;">
                        <b style="font-size:12.5px;">${escapeHtml(c.username || 'seseorang')}</b>
                        <span style="font-size:11px;color:var(--ink-soft);">${c.commented_at ? new Date(c.commented_at).toLocaleString('id-ID') : ''}</span>
                    </div>
                    <p style="font-size:12.5px;margin:4px 0 8px;">${escapeHtml(c.comment_text || '')}</p>
                    ${c.replied && c.our_reply_text ? `<div style="background:var(--brand-tint,#eef2ff);border-radius:6px;padding:6px 8px;font-size:12px;margin-bottom:8px;"><i class="bi bi-reply-fill"></i> Balasan kita: ${escapeHtml(c.our_reply_text)}</div>` : ''}
                    ${canManage ? `
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        ${!c.replied ? `
                        <input type="text" id="ig_reply_input_${c.ig_comment_id}" placeholder="Tulis balasan..." style="flex:1;min-width:140px;font-size:12px;padding:5px 8px;border:1px solid var(--line);border-radius:6px;">
                        <button class="btn-primary" style="font-size:11.5px;padding:5px 10px;" onclick="igReplyComment('${c.ig_comment_id}')"><i class="bi bi-reply-fill"></i> Balas</button>
                        ` : ''}
                        <button class="btn-cancel" style="font-size:11.5px;padding:5px 10px;" onclick="igToggleHideComment('${c.ig_comment_id}', ${c.hidden ? 'false' : 'true'})">
                            <i class="bi bi-eye${c.hidden ? '' : '-slash'}-fill"></i> ${c.hidden ? 'Tampilkan' : 'Sembunyikan'}
                        </button>
                        <button class="btn-danger" style="font-size:11.5px;padding:5px 10px;" onclick="igDeleteComment('${c.ig_comment_id}')"><i class="bi bi-trash-fill"></i></button>
                    </div>` : ''}
                </div>`).join('')
            : `<div class="ig-empty" style="padding:16px 0;"><i class="bi bi-chat-square-dots"></i> Belum ada komentar (atau belum disinkron).</div>`;

        body.innerHTML = `
            <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
                <button class="btn-cancel" style="font-size:11.5px;padding:5px 10px;" onclick="syncIgCommentsNow()"><i class="bi bi-arrow-repeat"></i> Sync Sekarang</button>
            </div>
            <div style="max-height:360px;overflow-y:auto;">${listHtml}</div>
            <div style="display:flex;justify-content:flex-end;margin-top:12px;">
                <button class="btn-cancel" onclick="closeIgActionModal()" style="font-size:12px;padding:6px 14px;">Tutup</button>
            </div>`;
    } catch (err) {
        body.innerHTML = `<p style="color:var(--danger);font-size:12.5px;">Gagal memuat komentar: ${escapeHtml(err.message)}</p>`;
    }
}

async function igCommentActionCall(payload) {
    const res = await fetch(IG_COMMENT_ACTION_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabaseClient.auth.getSession()).data.session?.access_token || ''}`
        },
        body: JSON.stringify(payload)
    });
    return res.json();
}

async function igReplyComment(igCommentId) {
    if (!canManageProgramData()) return;
    const input = document.getElementById(`ig_reply_input_${igCommentId}`);
    const text = input ? input.value.trim() : '';
    if (!text) { showToast('Tulis balasan dulu', 'error'); return; }
    try {
        const result = await igCommentActionCall({ ig_comment_id: igCommentId, action: 'reply', reply_text: text });
        if (result.ok) {
            showToast('Balasan terkirim', 'success');
            await loadIgCommentsPanel();
            if (igCommentsCurrentPostId) await renderIgCommentsModalBody(igCommentsCurrentPostId);
            await loadIgCommentsUnreadCount();
        } else {
            showToast('Gagal membalas: ' + (result.error || ''), 'error');
        }
    } catch (err) {
        showToast('Gagal membalas: ' + err.message, 'error');
    }
}

async function igToggleHideComment(igCommentId, hide) {
    if (!canManageProgramData()) return;
    try {
        const result = await igCommentActionCall({ ig_comment_id: igCommentId, action: hide ? 'hide' : 'unhide' });
        if (result.ok) {
            showToast(result.message || 'Berhasil', 'success');
            await loadIgCommentsPanel();
            if (igCommentsCurrentPostId) await renderIgCommentsModalBody(igCommentsCurrentPostId);
        } else {
            showToast('Gagal: ' + (result.error || ''), 'error');
        }
    } catch (err) {
        showToast('Gagal: ' + err.message, 'error');
    }
}

async function igDeleteComment(igCommentId) {
    if (!canManageProgramData()) return;
    if (!await openActionConfirm({ title: 'Hapus Komentar', message: 'Hapus komentar ini secara permanen dari Instagram?', confirmLabel: 'Ya, Hapus' })) return;
    try {
        const result = await igCommentActionCall({ ig_comment_id: igCommentId, action: 'delete' });
        if (result.ok) {
            showToast('Komentar dihapus', 'success');
            await loadIgCommentsPanel();
            if (igCommentsCurrentPostId) await renderIgCommentsModalBody(igCommentsCurrentPostId);
            await loadIgCommentsUnreadCount();
        } else {
            showToast('Gagal hapus: ' + (result.error || ''), 'error');
        }
    } catch (err) {
        showToast('Gagal hapus: ' + err.message, 'error');
    }
}

// ---- IG Action Modal (Retry / Delete / Logs) ----
function openIgActionModal(postId, action, post = null, errorDetail = '') {
    const modal = document.getElementById('igActionModal');
    const body = document.getElementById('igActionBody');
    const title = document.getElementById('igActionTitle');
    if (!modal || !body || !title) return;

    const p = post || igPosts.find(p => p.id === postId);

    if (action === 'retry') {
        title.textContent = 'Konfirmasi Retry';
        body.innerHTML = `
            <p style="color:var(--ink);margin-bottom:16px;">
                <i class="bi bi-exclamation-triangle-fill" style="color:var(--warn);"></i>
                Post ini gagal dipublish. Yakin ingin mencoba lagi?
            </p>
            ${p && p.last_error ? `<div style="background:var(--danger-tint);padding:10px;border-radius:8px;margin-bottom:12px;font-size:12.5px;color:var(--danger);"><i class="bi bi-info-circle"></i> Error: ${escapeHtml(p.last_error)}</div>` : ''}
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn-cancel" onclick="closeIgActionModal()" style="font-size:12px;padding:6px 14px;">Batal</button>
                <button class="btn-primary" onclick="retryIgPost('${postId}')" style="font-size:12px;padding:6px 14px;"><i class="bi bi-arrow-counterclockwise"></i> Retry</button>
            </div>`;
    } else if (action === 'delete') {
        title.textContent = 'Hapus Post';
        body.innerHTML = `
            <p style="color:var(--ink);margin-bottom:16px;">
                <i class="bi bi-exclamation-triangle-fill" style="color:var(--danger);"></i>
                Hapus post IG ini secara permanen?
            </p>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn-cancel" onclick="closeIgActionModal()" style="font-size:12px;padding:6px 14px;">Batal</button>
                <button class="btn-danger" onclick="deleteIgPost('${postId}')" style="font-size:12px;padding:6px 14px;"><i class="bi bi-trash-fill"></i> Hapus</button>
            </div>`;
    } else if (action === 'logs') {
        title.textContent = 'Detail Error';
        body.innerHTML = `
            <p style="color:var(--ink);margin-bottom:12px;">${escapeHtml(errorDetail || p?.last_error || 'Tidak ada detail error')}</p>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn-cancel" onclick="closeIgActionModal()" style="font-size:12px;padding:6px 14px;">Tutup</button>
            </div>`;
    } else {
        body.innerHTML = '';
    }

    modal.classList.add('open');
}

function closeIgActionModal() {
    const modal = document.getElementById('igActionModal');
    if (modal) modal.classList.remove('open');
}

// ============================================================
// 24c. CONTENT PLANNER BULANAN (AI)
// Menyusun daftar ide+draft caption untuk 1 bulan sekaligus lewat Gemini
// (edge function generate-ig-content-plan), disimpan di tabel terpisah
// ig_content_plan (BUKAN ig_posts -- rencana belum punya media). Item
// rencana ikut tampil di kalender IG Scheduler yang sama (gaya dot beda),
// dan bisa dikonversi jadi post asli lewat tombol "Jadikan Post" yang
// membuka modal upload biasa dengan caption sudah terisi.
// ============================================================

// ---- Load semua rencana (dipakai render kalender & modal harian) ----
async function loadIgContentPlan() {
    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('ig_content_plan').select('*').order('tanggal', { ascending: true }),
            { label: 'Muat rencana konten IG' }
        );
        if (error) throw error;
        igContentPlan = data || [];
        // Pulihkan ide "yatim": status dijadikan_post tapi post-nya sudah terhapus (ig_post_id null
        // karena FK on delete set null). Ide seperti ini hilang dari kalender tanpa jejak.
        const orphans = igContentPlan.filter(pl => pl.status === 'dijadikan_post' && !pl.ig_post_id);
        if (orphans.length && canManageProgramData()) {
            const { error: healErr } = await supabaseClient.from('ig_content_plan')
                .update({ status: 'idea' }).in('id', orphans.map(o => o.id));
            if (!healErr) orphans.forEach(o => { o.status = 'idea'; });
        }
        if (!igPlannerColsReady) {
            const probe = await supabaseClient.from('ig_content_plan').select('pilar,tahap').limit(1);
            igPlannerColsReady = !probe.error;
        }
        if (!igTeksGambarReady) {
            const probeImg = await supabaseClient.from('ig_content_plan').select('teks_gambar').limit(1);
            igTeksGambarReady = !probeImg.error;
        }
        if (!igTemaMingguReady) {
            const probeTema = await supabaseClient.from('ig_content_plan').select('tema_minggu').limit(1);
            igTemaMingguReady = !probeTema.error;
        }
        if (!igCanvaReady) {
            const probeCanva = await supabaseClient.from('ig_content_plan').select('canva_url').limit(1);
            igCanvaReady = !probeCanva.error;
        }
        await loadIgRencanaTahun(); // rencana tema setahun (opsional, gagal diam-diam kalau tabel belum ada)
        renderIgCalendar();
    } catch (err) {
        console.error('loadIgContentPlan error:', err);
        showToast('Gagal memuat rencana konten: ' + (err.message || err), 'error');
    }
}

// ---- Buka modal Content Planner ----
function openIgContentPlanModal() {
    if (!canManageProgramData()) {
        showToast('Akun Anda tidak punya izin untuk membuat rencana konten', 'error');
        return;
    }
    const modal = document.getElementById('igContentPlanModal');
    if (!modal) return;

    // Default bulan = bulan yang sedang ditampilkan di kalender
    const monthInput = document.getElementById('igPlanMonth');
    if (monthInput) {
        const y = igCalendarCurrent.getFullYear();
        const m = String(igCalendarCurrent.getMonth() + 1).padStart(2, '0');
        monthInput.value = `${y}-${m}`;
    }
    ['igPlanTema', 'igPlanTemaDepan', 'igPlanArahan'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    ['igPlanTema', 'igPlanTemaDepan'].forEach(id => { const el = document.getElementById(id); if (el) el.dataset.auto = '1'; }); // isi otomatis sampai diketik manual
    igRenderPlanWeekOptions();

    renderIgPlanPolaStrip();
    showIgPlanGenerateForm();
    modal.classList.add('open');
    // refresh data terbaru tiap kali modal dibuka (bisa saja ada rencana lama dari sesi lain), lalu hitung ulang pratinjau slot
    Promise.resolve(loadIgContentPlan()).then(igRenderPlanWeekOptions);
}

function closeIgContentPlanModal() {
    const modal = document.getElementById('igContentPlanModal');
    if (modal) modal.classList.remove('open');
}

// ============================================================
// 24e. ABOUT PLANNER (konsep perencanaan konten Amiru, bisa dibaca, disalin, dan direvisi lewat Claude)
// SUMBER TUNGGAL konsep ada di konstanta ABOUT_PLANNER_MD di bawah. Alur revisi:
//   1. Klik "About Planner" di IG Scheduler > "Salin untuk Claude" (atau "Unduh .md"), tempel/unggah ke Claude.
//   2. Claude mengembalikan dokumen utuh versi baru (Versi naik, Riwayat Revisi bertambah).
//   3. Unggah hasilnya ke sesi pengembangan: isi ABOUT_PLANNER_MD diganti, lalu aturan yang berubah disinkronkan ke
//      IG_PLAN_PROMPT_SISTEM, IG_POLA_AMIRU, edge function generate-ig-content-plan, dan pola-konten.md
//      (lihat bagian "About Planner" di CLAUDE.md).
// Aturan menulis isinya: jangan pakai karakter backtick atau urutan dollar-kurung-kurawal di dalam teks (ini template literal).
// Baris "Versi:" dan "Diperbarui:" dibaca otomatis untuk header modal, jadi format dua baris itu jangan diubah.
// ============================================================
const ABOUT_PLANNER_MD = `# About Planner: Konsep Perencanaan Konten Instagram Amiru Tour
Versi: 16
Diperbarui: 22 Oktober 2026
Status: disepakati Oktober 2026. Uji coba alur mingguan yang menyambung dimulai pekan Senin, 12 Oktober 2026. Ejaan resmi: "Umroh" (bukan "Umrah"), termasuk di hashtag.

## 1. Tujuan dan Prinsip

Dokumen acuan untuk membuat konten Instagram Amiru Tour (PT Amiru Haramain Indonesia) lewat fitur Perencanaan Konten di dashboard.

1. **Menyambung.** Tujuh posting dalam seminggu membahas satu tema dari tujuh sudut berurutan, supaya jamaah merasa tiap konten melanjutkan konten sebelumnya, tanpa perlu kata rujukan.
2. **Seimbang.** Hati (cerita, perasaan, renungan) dan akal (tata cara, persiapan, kesalahan umum) bergantian.
3. **Tahan jangka panjang.** Topik, hook, dan kalimat pembuka tidak boleh berulang antarhari, antarminggu, maupun antarbulan.
4. **Jujur.** Tidak ada testimoni, kutipan, angka, atau janji yang dikarang.
5. **Storytelling, bukan hard-selling.** Ajakan cukup berupa CTA ringan ("chat WA aja ya").

## 2. Kategori Konten

Hanya 3 kategori, semuanya berbasis gambar (tanpa video, Reels, atau live).

| Kategori | Keterangan |
|---|---|
| Single Post | Satu gambar |
| Carousel | Maksimal 5 slide |
| Story | Dipakai bila dibutuhkan; belum masuk pola mingguan saat ini |

Sedang dijeda: bukti sosial/testimoni, engagement (polling/pertanyaan), dan info program. Aktifkan lagi hanya bila diminta (misalnya ada keberangkatan yang perlu dipromosikan). Info program muncul bila Arahan tambahan di modal Perencanaan Konten memintanya, atau otomatis (1-2 hari praktis: Selasa, Rabu, atau Jumat) pada pekan yang punya fase promosi program.

## 3. Pola 7 Hari (satu tema mingguan)

Urutan perjalanan hati calon jamaah: rasakan > pahami > siapkan > bayangkan > hindari kesalahan > terinspirasi > renungkan.

| Hari | Pilar | Format | Peran | Jembatan ke hari berikutnya |
|---|---|---|---|---|
| Senin | Storytelling | Single Post | Rasakan: momen emosional tema minggu ini | Pertanyaan: "tahu nggak caranya?" |
| Selasa | Manasik | Image (kartu praktis) | Pahami: tata cara/doa terkait tema | "Biar siap, besok kita bahas persiapannya." |
| Rabu | Edukasi | Carousel | Siapkan: persiapan fisik/perlengkapan terkait tema | "Besok kita bayangkan perjalanannya." |
| Kamis | Storytelling bertahap | Carousel | Bayangkan: satu alur waktu/perjalanan, per slide | "Besok: kekeliruan yang sering terjadi." |
| Jumat | Edukasi | Carousel | Hindari: kesalahan umum dan FAQ | "Besok ada cerita yang mengingatkan kenapa kita berangkat." |
| Sabtu | Storytelling | Carousel | Terinspirasi: satu cerita manusiawi dalam 5 slide | "Besok kita renungkan maknanya." |
| Minggu | Kontemplasi ibadah umroh | Carousel | Renungkan: makna tema, tanpa tokoh | Menutup dan memberi teaser tema minggu depan |

Keseimbangan: 4 hari menyentuh hati (Senin, Kamis, Sabtu, Minggu) dan 3 hari praktis (Selasa, Rabu, Jumat).

**Penyambung yang terlihat jamaah**
- Pembuka caption (kecuali Senin) menyambung hari sebelumnya lewat isi, bukan lewat kata rujukan. Dilarang menyebut konten sebelumnya dengan kata kemarin, kemaren, semalam, tadi, "yang kita bahas", "melanjutkan", "meneruskan", dan sejenisnya (contoh yang salah: "Berbekal pertimbangan matang yang kita bahas kemarin", "Meneruskan perhitungan dana dan cuti kita kemarin"). Caranya: pembuka langsung masuk ke adegan, pertanyaan, atau masalah yang menjadi jawaban alami dari penutup hari sebelumnya, dan benang merahnya terbawa lewat tema, benda, perasaan, atau pertanyaan yang sama, sehingga caption tetap utuh bila dibaca sendiri. Rumus pembuka divariasikan.
- Penutup caption memancing hari berikutnya.
- Label kecil di pojok gambar, misalnya "Seri Talbiyah · 3/7". Ditambahkan otomatis oleh sistem di akhir teks gambar.

**Varian pekan (hari besar dan penjualan)**
Supaya 52 pekan tidak terasa seragam, dua jenis pekan mengganti peran dan format di beberapa hari. Kamis, Sabtu, dan Minggu tidak berubah, jadi nuansa hati dan teaser pekan depan tetap terjaga.

| Jenis pekan | Senin | Selasa | Rabu | Jumat |
|---|---|---|---|---|
| Hari besar (ada peristiwa Hijriah di pekan itu) | Sambut (single) | Kenali (single) | Amalkan (carousel) | Tanya Jawab (single) |
| Penjualan (tema pekan = tema penjualan musiman) | Rasakan | Rencanakan (single) | Hitung (carousel) | Pertimbangkan (carousel) |

Tiap peran pengganti membawa catatan singkat untuk AI. Aturan lain tidak berubah: carousel maksimal 5 slide, tanpa hard-selling, tanpa harga, angka, ayat, atau hadis karangan. Pekan hari besar didahulukan atas pekan penjualan.

**Jeda pekan musiman.** Tema musiman biasa (penjualan atau bulan Hijriah, bukan hari besar) tidak dipasang tepat sebelum atau sesudah pekan yang sudah bertema musiman. Tema hari besar dikecualikan karena tanggalnya tetap. Tema musiman yang tertunda tetap menjadi pilihan cadangan terakhir.

**Membedakan hari-hari storytelling**
- Senin: momen ibadah di satu lokasi atau peristiwa.
- Kamis (bertahap): alur waktu atau perjalanan dipecah per slide (pagi ke malam, hari pertama ke terakhir).
- Sabtu: satu cerita manusiawi yang selesai dalam 5 slide. Berbentuk ilustrasi/umum ("banyak jamaah bercerita..."), bukan klaim kejadian nyata.
- Minggu (kontemplasi) beda dari Sabtu: tanpa tokoh, murni renungan makna.

**Contoh satu minggu: tema Talbiyah**

| Hari | Hook |
|---|---|
| Senin | Pertama kali mendengar suara talbiyah bersahutan dari mana-mana |
| Selasa | Kapan talbiyah mulai dibaca dan kapan berhenti (sesuai manasik pembimbing) |
| Rabu | Menghafal talbiyah dari sekarang, jadwal latihan 2 minggu |
| Kamis | Dari miqat sampai Masjidil Haram sambil bertalbiyah |
| Jumat | Kesalahan umum soal talbiyah |
| Sabtu | Cerita ilustrasi tentang menjawab panggilan |
| Minggu | "Aku datang memenuhi panggilan-Mu": apa yang sebenarnya kita jawab? Teaser tema minggu depan |

## 4. Gaya Bahasa

- Sastrawi tapi membumi: puitis, hangat, santai seperti ngobrol dengan teman.
- Sapa pembaca dengan "kamu". Kata sehari-hari secukupnya (nggak, aja, banget), tetap sopan.
- Utamakan momen konkret yang bisa dibayangkan (gerakan, suasana, ekspresi jamaah, kekhawatiran nyata), bukan klaim umum atau bahasa brosur.
- Fokus ke perasaan: rindu, ketenangan, proses transisi jiwa, makna di balik ibadah.
- Hindari kata kaku: "tersedia", "silakan", "hubungi kami".
- Terdengar manusia, bukan AI: detail spesifik dan tak terduga (benda, bau, suara, kejadian kecil), ritme kalimat dicampur panjang dan sangat pendek, satu hari tidak harus berbentuk adegan-refleksi-pertanyaan-doa.
- Dilarang: pola "bukan sekadar X, tapi Y", daftar tiga kata berirama berulang, kalimat penutup ala kata mutiara, frasa klise (relung hati, hiruk pikuk, perjalanan spiritual, senantiasa, tentunya, sejatinya, mari kita), tanda pisah panjang, titik koma. Maksimal 2 tanda tanya dan 1 emoji per caption.
- Doa penutup tidak wajib tiap hari: maksimal 3 hari dalam sepekan, dan Minggu selalu menjadi salah satunya (jadi Senin sampai Sabtu paling banyak 2 hari). Jangan mengaku pengalaman pribadi atau kejadian nyata yang dikarang.

| JANGAN | TULIS |
|---|---|
| Umroh Oktober tersedia. Silakan daftar via WA. | Bayangin pertama kali lihat Ka'bah dari dekat. Dada sesak, mata basah, semua yang dibawa dari rumah mendadak hilang. Kalau hatimu mulai kepikiran, chat WA aja ya. |

## 5. Format Tiap Posting

1. **Teks di gambar:** 2-4 baris pendek, jadi pemancing. Untuk carousel tulis per slide: Slide 1 pemancing, Slide 2-4 isi, Slide 5 penutup (ajakan simpan/kirim atau doa singkat). Tidak diulang di caption.
2. **Caption:** lanjutan dari teks gambar, tidak terlalu singkat (3-5 paragraf pendek, sekitar 600-1200 karakter, dipisah baris kosong), maksimal 2200 karakter.
   - Konten emosional: pembukaan = suasana/refleksi; isi = hubungkan dengan pengalaman batin jamaah; penutup = pertanyaan hangat (rindu/doa), dan doa singkat HANYA di sebagian hari (lihat SUARA MANUSIA); hari lain boleh berhenti dengan satu kalimat pendek yang menggantung.
   - Konten praktis: pembukaan = masalah yang relatable; isi = poin ringkas; penutup = ajakan simpan/kirim + CTA ringan.
3. **Hashtag:** tepat 5, langsung di baris terakhir caption, tanpa label "Hashtag:" (supaya mudah disalin). #UmrohBersamaAmiru dan #AmiruTour selalu ada, 3 lainnya relevan dengan topik.

## 6. Aturan Anti-Pengulangan

- Satu topik hanya sekali. Sudut baru atas topik lama baru boleh muncul setelah jeda minimal 6 bulan.
- Hook dan pembuka caption tidak boleh mirip dengan 20 posting terakhir, terlepas dari jendela 6 bulan. Rumus 3 kata pertama pembuka caption yang sama juga dianggap mirip. Kemiripan seluruh kalimat pembuka tetap dicek, dan rumus pembuka yang sama antarhari dalam satu pekan tetap ditolak.
- Tema Minggu memakai jeda lebih ketat, 12 bulan, supaya peta setahun tidak punya tema pekan kembar.
- Kata tema minggu diabaikan saat membandingkan ide dalam satu pekan, supaya ketujuh ide tidak saling dianggap kembar.
- Isi diambil dari bank topik per hari:

| Hari | Mesin topik |
|---|---|
| Senin | Matriks lokasi x momen x perasaan |
| Selasa | Kurikulum manasik berurutan (miqat, niat, talbiyah, thawaf, doa, sa'i, tahallul, adab) |
| Rabu | Rotasi kategori persiapan: fisik, dokumen, perlengkapan, kesehatan, keuangan, adab |
| Kamis | Seri 4 minggu dengan alur/tokoh berbeda |
| Jumat | Kesalahan umum dan FAQ calon jamaah |
| Sabtu | Sisi manusiawi: pertama kali, orang tua, pasangan, rindu setelah pulang, doa yang dititipkan |
| Minggu | Renungan makna rukun/wajib dan hikmahnya |

- Tiap kuartal tambahkan topik musiman (menjelang Ramadan, musim haji, libur sekolah, akhir tahun).

**Riwayat topik awal (jangan diulang sebelum 12 April 2027)**

| Topik | Pilar | Sumber |
|---|---|---|
| Niat umroh | Storytelling | Set awal |
| Pertama kali lihat Ka'bah | Storytelling | Set awal |
| Sa'i dan kisah Siti Hajar | Storytelling | Set awal |
| Raudhah | Storytelling | Set awal |
| Subuh di Madinah | Storytelling | Paket mingguan pertama |
| Bawaan yang sering ketinggalan | Edukasi | Set awal |
| Kesalahan umum thawaf | Edukasi | Set awal |
| Urutan umroh (ihram, thawaf, sa'i, tahallul) | Edukasi | Set awal |
| Larangan ihram | Manasik | Paket mingguan pertama |
| Persiapan fisik | Edukasi | Paket mingguan pertama |
| Hari terakhir di Makkah | Storytelling bertahap | Paket mingguan pertama |
| Makkah atau Madinah | Engagement | Paket mingguan pertama |
| Umroh bersama orang tua | Info program | Set awal |
| Mulai dari yang kecil / menabung niat | Info program | Set awal |

## 7. Tema Minggu Otomatis

Dashboard menyarankan Tema Minggu tanpa AI, dengan tiga sumber dalam urutan prioritas:

1. **Tema yang sudah dipakai di pekan itu** (kalau pekan sudah pernah digenerate sebagian) tetap dipertahankan.
2. **Tema musiman** menurut bulan Hijriah/Masehi pekan itu (Maulid, Isra Miraj, Ramadhan, musim haji, libur sekolah, dan seterusnya). Tema musiman yang mengarah ke penjualan sengaja tayang 2-3 bulan sebelum musimnya, karena calon jamaah memesan jauh hari, dan didahulukan atas tema musiman biasa.
3. **Alur perjalanan jamaah yang bergiliran antar fase**, supaya setahun penuh seimbang dan tetap terasa satu cerita. Bank alur berisi 111 tema dalam lima fase: sebelum berangkat (24 tema), ibadah di Makkah (36), Madinah (19), umroh bersama siapa (17), dan pulang serta sesudahnya (15). Tiap fase punya bobot jatah (3, 3, 2, 2, 2). Fase yang paling kurang dari jatahnya dalam 8 pekan terakhir mendapat giliran berikutnya, tema musiman tidak ikut dihitung. Di dalam satu fase urutan tema tetap menyambung dari tema terakhir fase itu. Dulu alur berjalan lurus dari awal sampai akhir, sehingga di tahun pertama Madinah, umroh bersama siapa, dan pulang hampir tidak pernah tayang.

Tema yang sudah dipakai dalam rentang 365 hari ke belakang dan ke depan dilewati. Tema musiman memakai jeda lebih pendek, 300 hari, karena musim yang sama kembali tiap sekitar 354 hari (Hijriah) atau 364 hari (pekan yang sama tahun depan); tanpa ini tema musiman akan bergeser atau hilang di tahun berikutnya. Dengan begitu sistem dapat berjalan berulang tiap tahun. Admin tetap bisa mengetik Tema Minggu sendiri, dan mengisi Tema pekan depan (opsional) untuk teaser penutup Minggu.

## 8. Kejujuran dan Kehati-hatian

- Jangan mengarang ayat, hadis, atau lafaz/doa berbahasa Arab. Untuk lafaz dan tata cara tulis "sesuai manasik dari pembimbing".
- Jangan mengarang testimoni, nama jamaah, angka, harga, tanggal, hotel, atau fasilitas. Pakai placeholder [bulan], [hotel], [nomor WA] bila data belum ada.
- Testimoni hanya dari jamaah asli dan seizin jamaah.
- Jangan memberi janji berlebihan ("pasti mabrur", "dijamin berangkat", "seat pasti ada").
- Konten tata cara dan hukum ibadah ditulis secara umum, tanpa fatwa, dan dicek ke pembimbing/ustaz sebelum diposting. Di dashboard, ide bertema Manasik (Selasa) dan ide yang memuat klaim tata cara, hukum, atau lafaz (wajib, rukun, sunnah, haram, dan sejenisnya) ditandai "[cek pembimbing]" pada judul ide. Menyebut kata doa atau nama ritual saja tidak ditandai, supaya tanda itu tetap bermakna.
- Cerita Sabtu dan renungan Minggu bersifat ilustrasi/umum, bukan klaim kejadian nyata.

## 9. Cara Kerja di Dashboard

- Modal **Perencanaan Konten** dibuat sederhana dalam dua langkah: (1) pilih bulan dan pekan (Senin-Minggu), (2) isi **Tema pekan ini** (Tema Minggu, wajib, terisi otomatis dari saran). Ringkasan jumlah ide yang akan dibuat muncul di bawahnya.
- Bagian yang jarang dipakai dilipat dan terbuka lewat klik: **Pengaturan lanjutan** (Tema pekan depan dan Arahan tambahan, keduanya opsional), **Pola 7 hari**, **Peta tema 12 bulan**, dan **Cara lain** (Isi dari Pola dan Salin Prompt).
- **Generate Konten** menyusun ketujuh hari dalam satu panggilan AI, dengan peran per hari sesuai bagian 3. Hari yang sudah lewat atau sudah terisi dilewati. Selama menyusun, tombol menampilkan detik berjalan dan perkiraan waktu (biasanya 1-2 menit), karena hitungan n/7 baru bergerak di akhir.
- Setiap hari hasil AI diperiksa otomatis di server. Ditolak bila memuat teks Arab, janji berlebihan, kutipan ayat atau hadis ("bersabda", "berfirman", "QS.", "HR."), placeholder [isi ...], statistik atau klaim jumlah jamaah, kata kaku (silakan, hubungi kami, tersedia), pola atau frasa yang terasa buatan AI ("bukan sekadar X, tapi Y", frasa klise, lebih dari 2 tanda tanya, lebih dari 1 emoji, doa penutup lebih dari 2 hari dari Senin sampai Sabtu, karena satu jatah dari 3 dicadangkan untuk Minggu; doa dicari di dua paragraf terakhir caption), format teks gambar yang tidak cocok dengan tipe (carousel harus Slide 1 sampai n berurutan, 3 sampai 5 slide), caption yang menyalin teks gambar, pembuka caption yang sama dengan hari lain, atau caption yang merujuk konten sebelumnya dengan kata kemarin, kemaren, semalam, tadi, "yang kita bahas", atau "melanjutkan" (kemarin dan kemaren ditolak di seluruh caption, kata lainnya di paragraf pembuka).
- Hari yang ditolak ditulis ulang sendiri (maksimal 2 putaran) dengan alasan penolakan dan hari yang sudah lolos sebagai penyambung; hari yang sudah lolos tidak dibuang. Di dashboard, hari yang ditolak diulang bersama hari sesudahnya saja, karena pembuka hari sesudahnya menyambung penutup hari yang ditolak; hari lain yang sudah lolos tetap disimpan.
- Caption dirapikan di server: ejaan "Umroh", tepat 5 hashtag (#UmrohBersamaAmiru dan #AmiruTour selalu ada), maksimal 2200 karakter. Teks gambar juga dibersihkan dari tanda pisah panjang dan titik koma (baris tidak digabung, rentang angka seperti "Slide 2–3" dibiarkan).
- Label seri "Seri [Tema] · n/7" ditambahkan otomatis di akhir teks gambar.
- **Isi dari Pola** (di Cara lain) membuat kerangka kosong 7 hari (pilar dan format sudah terisi) tanpa AI; bagian [isi ...] diganti data asli.
- **Salin Prompt** (di Cara lain) menyalin prompt lengkap (pola 7 hari, konteks, riwayat konten lama) untuk ditempel ke asisten AI lain bila server penyusun konten bermasalah.
- Tombol **Jadikan Post** memilih tujuan caption sesuai pilar rencana (termasuk Manasik dan Kontemplasi) dan mengirim konteks seri (hari/peran, Tema Minggu, teks di gambar, tema hari sebelumnya dan hari sesudahnya, hanya sebagai bahan menyambung isi dan tidak disebut di caption) supaya caption yang digenerate ulang tetap menyambung.
- **Peta tema 12 bulan** di modal (dilipat) menampilkan tema pekan-pekan setahun supaya tidak ada tema kembar.
- **Rencana Setahun AI** (di Rencana Konten) menyusun tema 12 bulan lewat AI dengan menimbang program keberangkatan, musim, dan alur jamaah, lalu menyimpannya per pekan. Riwayat tema yang dikirim ke AI dan dipakai untuk menolak tema kembar memakai tanggal dan jendela yang sama (365 hari, musiman 300 hari), jadi tahun kedua dan seterusnya tidak memblokir tema lama selamanya. Tema yang disimpan menjadi saran utama Tema Minggu; tema yang diedit admin terkunci dan tidak ditimpa saat disusun ulang.
- Riwayat konten dibaca dari rencana dan post tersimpan, jadi AI menghindari topik lama otomatis.
- Setelah generate, hasil tampil sebagai kartu per hari yang bisa diedit langsung (tema, tipe, teks gambar, caption) dan tersimpan otomatis. Tombol utama tiap kartu adalah **Jadikan Post**; Generate Ulang per hari, Lewati, dan Hapus berupa ikon. Tombol **Atur Ulang** di atas hasil kembali ke form.

## 10. Alur Kerja Mingguan

1. Buka Perencanaan Konten, pilih pekan, isi Tema Minggu (atau pakai saran tema).
2. Generate paket 7 hari, paling lambat Jumat/Sabtu sebelum pekan tayang agar ada waktu desain.
3. Cek ide yang bertanda [cek pembimbing] ke pembimbing/ustaz.
4. Desain gambar, lalu jadikan post dan jadwalkan.

## 11. Yang Dijeda dan Belum Otomatis

- Dijeda: bukti sosial/testimoni, engagement (polling), dan Story dalam pola mingguan. Info program ikut dijeda kecuali pada pekan yang punya fase promosi program (otomatis 1-2 hari praktis) atau bila diminta lewat Arahan tambahan.
- Riwayat topik awal (bagian 6) sekarang juga tersimpan sebagai data (IG_RIWAYAT_AWAL di js/app.js): dipakai untuk menolak ide kembar, melewati tema alur yang bentrok pada saran Tema Minggu, dan Rencana Setahun AI. Menambah topik ke daftar ini masih manual, dan salinan teksnya (tabel bagian 6, prompt) harus disamakan. Selebihnya riwayat dibaca dari rencana dan post tersimpan.
- Bank topik per hari (bagian 6) belum berupa data: ia hanya arahan di prompt yang ditafsirkan AI, dijaga oleh pengecekan duplikat. Hanya Tema Minggu yang dikelola kode (bank alur dan tema musim).
- Desain gambar dan pengecekan ke pembimbing/ustaz dilakukan manusia.

## 12. Riwayat Revisi

| Versi | Tanggal | Perubahan |
|---|---|---|
| 1 | 9 Oktober 2026 | Versi awal About Planner, disusun dari pola-konten.md dan perilaku Perencanaan Konten di dashboard |
| 2 | 9 Oktober 2026 | Mutu generator mingguan: aturan mutu tulisan dan contoh gaya di prompt, pemeriksa otomatis lebih lengkap (ayat/hadis, angka, kata kaku, format carousel), perbaikan terarah hanya untuk hari yang ditolak |
| 3 | 10 Oktober 2026 | Suara manusia: larangan pola dan frasa yang terasa buatan AI, bentuk caption bervariasi antarhari, doa penutup tidak wajib tiap hari (maksimal 3 dalam sepekan), pemeriksa server menolak pola tersebut |
| 4 | 10 Oktober 2026 | Rencana Setahun AI: tema 12 bulan disusun AI, disimpan per pekan, bisa diedit dan dikunci, dan menjadi saran utama Tema Minggu |
| 5 | 10 Oktober 2026 | Tampilan modal Perencanaan Konten disederhanakan: form dua langkah, pengaturan jarang dipakai dilipat, satu aksi utama per kartu hasil. Aturan konten dan generator tidak berubah |
| 6 | 15 Oktober 2026 | Tanda [cek pembimbing] dipersempit ke klaim tata cara/hukum/lafaz dan pilar Manasik; jatah doa Minggu dicadangkan (Senin-Sabtu maksimal 2 hari, doa dicari di dua paragraf terakhir); riwayat topik awal jadi data dan memblokir tema alur yang bentrok; tanda pembimbing tidak lagi dihitung sebagai kata topik saat mendeteksi ide kembar |
| 7 | 15 Oktober 2026 | Rumus rujukan hari sebelumnya dikecualikan dari cek 3 kata terhadap 20 posting terakhir; mode pekan hanya mengulang hari yang ditolak dan hari sesudahnya; teks gambar dibersihkan dari tanda pisah panjang dan titik koma; bank tema alur diperluas menjadi 65 tema; tombol generate menampilkan perkiraan waktu; catatan bahwa bank topik per hari belum berupa data |
| 8 | 15 Oktober 2026 | Penyelarasan: contoh hook Senin tidak lagi memakai kata "ribuan" (selaras larangan klaim jumlah); generator caption manual disamakan dengan aturan doa (tidak wajib, Senin-Sabtu maksimal 2 hari) dan emoji (maksimal 1). Aturan konten tidak berubah |
| 9 | 15 Oktober 2026 | Bank tema alur diperluas dari 65 menjadi 95 tema (30 tema baru di lima tahap) supaya siklus tahunan tidak kehabisan tema dan tidak berulang dalam jendela 365 hari. Aturan konten tidak berubah |
| 10 | 15 Oktober 2026 | Siklus tahunan: tema musiman memakai jeda 300 hari (bukan 365) supaya kembali tiap tahun dan tidak bergeser atau hilang; riwayat tema untuk Rencana Setahun AI kini bertanggal dan berjendela, bukan seluruh sejarah. Diuji lewat simulasi 10 tahun (520 pekan): tanpa tema kembar non-musiman dalam 364 hari, tanpa pekan fallback, semua tema musiman tayang di musimnya. Aturan konten tidak berubah |
| 11 | 16 Oktober 2026 | Alur tema seimbang: bank alur dikelompokkan per fase dengan bobot jatah dan tiap pekan dipilih dari fase yang paling kurang dari jatahnya (dulu alur lurus, Madinah dan umroh bersama siapa baru muncul tahun ke-2). Simulasi 52 pekan: semua fase tayang, tanpa fase yang hilang lebih dari 12 pekan. Aturan konten harian tidak berubah |
| 12 | 16 Oktober 2026 | Rencana Setahun AI seimbang: bank alur dikirim ke edge function per fase beserta bobotnya, batas 80 entri dinaikkan menjadi 160, prompt diberi aturan komposisi (jatah per fase, fase kecil tetap tayang rutin, tidak lebih dari dua pekan beruntun dari fase sama), dan hasil membawa label fase. Perlu deploy ulang generate-ig-year-plan. Aturan konten harian tidak berubah |
| 13 | 16 Oktober 2026 | Pola 7 hari dinamis: pekan hari besar dan pekan penjualan memakai varian peran dan format (Sambut, Kenali, Amalkan, Tanya Jawab, Rencanakan, Hitung, Pertimbangkan) supaya 52 pekan tidak seragam, dan tema musiman biasa diberi jeda agar tidak menempati pekan berurutan (Rencana Setahun AI ikut menolak dan mengulang pekan yang melanggar). Aturan konten harian tidak berubah |
| 14 | 16 Oktober 2026 | Kesehatan Rencana: panel di modal Rencana Konten dan bagian di rekap salinan/unduhan yang menghitung pekan ke depan (komposisi per fase terhadap jatah bobot, fase yang hilang atau berlebih, stok tema per fase terhadap kebutuhan setahun, rasio tema hati dan praktis dengan batas sehat 40-65% hati). Bank alur ditambah 16 tema: Madinah 11 menjadi 19 dan umroh bersama siapa 9 menjadi 17 (total 111). Hanya laporan, tidak mengubah pemilihan tema. Aturan konten harian tidak berubah |
| 15 | 16 Oktober 2026 | Promosi program otomatis: pekan yang punya fase promosi (Kenalkan, Isi paket, Seat menipis, Penutupan) kini menyisipkan 1-2 hari praktis (Selasa, Rabu, atau Jumat) yang mengarah ke program tanpa perlu Arahan tambahan. Dulu fase hanya menjadi label di rekap karena prompt dan pemeriksa server mengabaikan konteks program tanpa arahan. Pemeriksa server melonggarkan larangan angka dan kata "tersedia" pada pekan itu. Perlu deploy ulang generate-ig-content-plan. Pause bukti sosial, polling, dan Story tidak berubah |
| 16 | 22 Oktober 2026 | Caption tidak lagi memakai kata rujukan untuk menyambung antarkonten (kemarin, kemaren, semalam, tadi, "yang kita bahas", "melanjutkan"). Penyambung kini lewat isi: pembuka langsung masuk ke adegan atau pertanyaan yang menjawab penutup hari sebelumnya, dan benang merahnya terbawa lewat tema, benda, atau perasaan yang sama. Pemeriksa server menolak caption yang merujuk, dan pengecualian rumus rujukan pada cek 3 kata dicabut. Perlu deploy ulang generate-ig-content-plan dan generate-ig-caption. Penutup caption yang memancing hari berikutnya tidak berubah |
`;

// Petunjuk yang ikut tersalin di depan dokumen supaya Claude mengembalikan dokumen dalam format yang bisa dipakai lagi.
const ABOUT_PLANNER_PETUNJUK = `PETUNJUK UNTUK CLAUDE
Di bawah garis adalah dokumen "About Planner": konsep perencanaan konten Instagram Amiru Tour yang dipakai di fitur Perencanaan Konten dashboard. Saya akan meminta perubahan pada konsep ini. Setelah mengubah:
1. Kembalikan SELURUH dokumen (bukan potongan) dalam format markdown yang sama, mulai dari baris judul "# About Planner".
2. Pertahankan dua baris "Versi:" dan "Diperbarui:" dengan format yang sama. Naikkan Versi 1 angka, isi tanggal hari ini, dan tambahkan satu baris di bagian "Riwayat Revisi" yang menjelaskan perubahannya.
3. Pertahankan nomor dan judul bagian yang tidak diubah. Jangan menambah klaim, angka, atau fakta baru yang tidak saya minta.
4. Setelah dokumen, tulis daftar singkat "Dampak ke sistem": aturan mana yang berubah, supaya bisa disinkronkan ke generator konten di dashboard.

PERUBAHAN YANG SAYA MINTA:
[tulis perubahan di sini]

----------------------------------------------------------------------

`;

// Ambil nilai baris "Versi:" dan "Diperbarui:" dari dokumen.
function igAboutPlannerMeta(md) {
    const ambil = (kunci) => {
        const m = String(md || '').match(new RegExp('^' + kunci + ':\\s*(.+)$', 'm'));
        return m ? m[1].trim() : '';
    };
    return { versi: ambil('Versi') || '?', diperbarui: ambil('Diperbarui') };
}

// Teks yang disalin/diunduh: petunjuk untuk Claude + dokumen utuh.
function igAboutPlannerTeksSalin() {
    return ABOUT_PLANNER_PETUNJUK + ABOUT_PLANNER_MD.trim() + '\n';
}

// Markdown ringan -> HTML aman (semua teks di-escape dulu). Mendukung judul, tabel, daftar, kutipan, tebal, miring.
// Judul level 1 serta baris "Versi:"/"Diperbarui:" tidak dirender (sudah ada di header modal).
function igAboutPlannerRender(md) {
    const inline = (s) => escapeHtml(s)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:]|$)/g, '$1<em>$2</em>');
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
    const isSep = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
    const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) { i++; continue; }
        let m = l.match(/^(#{1,3})\s+(.*)$/);
        if (m) {
            if (m[1].length > 1) out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
            i++; continue;
        }
        if (/^(Versi|Diperbarui):/.test(l)) { i++; continue; }
        if (isRow(l) && i + 1 < lines.length && isSep(lines[i + 1])) {
            const head = cells(l);
            i += 2;
            const rows = [];
            while (i < lines.length && isRow(lines[i])) { rows.push(cells(lines[i])); i++; }
            out.push('<div class="ig-about-table-wrap"><table><thead><tr>'
                + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
                + rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
                + '</tbody></table></div>');
            continue;
        }
        if (/^\s*(?:[-*]|\d+\.)\s+/.test(l)) {
            const urut = /^\s*\d+\./.test(l);
            const items = [];
            while (i < lines.length && (/^\s*(?:[-*]|\d+\.)\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
                if (/^\s*(?:[-*]|\d+\.)\s+/.test(lines[i])) {
                    const nested = /^\s{2,}/.test(lines[i]);
                    const teks = lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, '');
                    if (nested && items.length) items[items.length - 1] += `<div class="ig-about-sub">${inline(teks)}</div>`;
                    else items.push(inline(teks));
                } else {
                    items[items.length - 1] += ' ' + inline(lines[i].trim());
                }
                i++;
            }
            const tag = urut ? 'ol' : 'ul';
            out.push(`<${tag}>` + items.map(t => `<li>${t}</li>`).join('') + `</${tag}>`);
            continue;
        }
        if (/^>\s?/.test(l)) {
            const q = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
            out.push(`<blockquote>${inline(q.join(' '))}</blockquote>`);
            continue;
        }
        const para = [];
        while (i < lines.length && lines[i].trim() && !/^(#{1,3})\s+/.test(lines[i]) && !isRow(lines[i])
            && !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[i]) && !/^(Versi|Diperbarui):/.test(lines[i])) {
            para.push(lines[i].trim()); i++;
        }
        if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
        else i++;
    }
    return out.join('\n');
}

function openIgAboutPlannerModal() {
    const modal = document.getElementById('igAboutPlannerModal');
    if (!modal) return;
    const meta = igAboutPlannerMeta(ABOUT_PLANNER_MD);
    const metaEl = document.getElementById('igAboutPlannerMeta');
    if (metaEl) metaEl.textContent = `Versi ${meta.versi}${meta.diperbarui ? ' · Diperbarui ' + meta.diperbarui : ''}`;
    const body = document.getElementById('igAboutPlannerBody');
    if (body) { body.innerHTML = igAboutPlannerRender(ABOUT_PLANNER_MD); body.scrollTop = 0; }
    modal.classList.add('open');
}

function closeIgAboutPlannerModal() {
    const modal = document.getElementById('igAboutPlannerModal');
    if (modal) modal.classList.remove('open');
}

async function igSalinAboutPlanner() {
    const ok = await igSalinTeks(igAboutPlannerTeksSalin());
    if (ok) showToast('About Planner disalin. Tempel ke Claude, tulis perubahan yang diminta, lalu unggah hasilnya ke sesi pengembangan.');
    else showToast('Gagal menyalin. Coba tombol Unduh .md', 'error');
}

function igUnduhAboutPlanner() {
    try {
        const meta = igAboutPlannerMeta(ABOUT_PLANNER_MD);
        const blob = new Blob([igAboutPlannerTeksSalin()], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `about-planner-v${String(meta.versi).replace(/[^\w.-]/g, '')}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        showToast('File about-planner diunduh');
    } catch (e) {
        showToast('Gagal mengunduh: ' + (e.message || e), 'error');
    }
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeIgAboutPlannerModal();
});

// ============================================================
// 24g. TASKLIST MINGGUAN (kartu "Tasklist" di ringkasan Content Planner)
// Template kerjaan rutin per hari (Senin..Minggu) yang berulang tiap pekan. Kartu menampilkan kerjaan HARI INI
// (selesai/total); klik kartu -> modal berisi daftar kerjaan seminggu yang bisa ditambah/dihapus.
// Penyimpanan: tabel ig_tasklist (sql/49_tambah_ig_tasklist.sql). Kalau tabel belum ada, otomatis jatuh ke
// localStorage (hanya di browser ini). Centang "selesai" hanya untuk HARI INI dan disimpan di browser ini.
// ============================================================
const IG_TASK_HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']; // hari 1..7 (ISO)
const IG_TASK_LS = 'igTasklistLocal';
const IG_TASK_DONE_LS = 'igTasklistDone';
let igTasks = [];           // [{id, hari, nama, urut}]
let igTaskDb = true;        // false = tabel belum ada, pakai localStorage
const igTaskHariIni = () => ((new Date().getDay() + 6) % 7) + 1;

function igTaskLsGet(k, def) { try { return JSON.parse(localStorage.getItem(k)) || def; } catch (e) { return def; } }
function igTaskLsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } }
function igTaskDoneToday() {
    const all = igTaskLsGet(IG_TASK_DONE_LS, {});
    return new Set(all[igLocalDateKey(new Date())] || []);
}
function igTaskDoneSave(set) {
    const key = igLocalDateKey(new Date());
    igTaskLsSet(IG_TASK_DONE_LS, { [key]: [...set] }); // hanya simpan hari ini, yang lama otomatis hilang
}

// Status muat: kartu & modal menampilkan "Memuat…" selama data belum datang, BUKAN "Belum ada kerjaan"
// (sebelumnya kosong dulu, lalu baru terisi setelah refresh berikutnya).
let igTasksLoaded = false;  // true setelah data benar-benar terbaca (dari DB atau localStorage)
let igTaskLoading = false;
let igTaskRetryTimer = null;

// Tabel ig_tasklist belum dibuat (beda dengan gagal jaringan/sementara)
function igTaskTabelBelumAda(err) {
    const code = String((err && err.code) || '');
    return code === '42P01' || code === 'PGRST205' || /does not exist|schema cache/i.test((err && err.message) || '');
}

async function loadIgTasks(attempt = 0) {
    clearTimeout(igTaskRetryTimer);
    if (igTaskLoading && attempt === 0) return;   // sudah ada request berjalan
    igTaskLoading = true;
    if (!igTasksLoaded) { renderIgCalendar(); if (document.getElementById('igTaskModal')?.classList.contains('open')) igTaskRender(); }
    try {
        // Retry untuk gangguan jaringan sesaat (timeout/QUIC). Error "tabel belum ada" tidak di-retry.
        const res = await withRetry(async () => {
            const r = await supabaseClient.from('ig_tasklist').select('*').order('hari').order('urut').order('created_at');
            if (r.error && !igTaskTabelBelumAda(r.error)) throw r.error;   // gangguan sementara -> di-retry
            return r;
        }, { retries: 2, label: 'Muat tasklist' });
        if (res.error) throw res.error;   // tabel belum ada -> ditangani di catch (tanpa retry)
        const data = res.data;
        igTaskDb = true;
        igTasks = data || [];
        igTasksLoaded = true;
    } catch (err) {
        if (igTaskTabelBelumAda(err)) {
            // Hanya kalau tabelnya memang belum ada -> pakai localStorage
            igTaskDb = false;
            igTasks = igTaskLsGet(IG_TASK_LS, []);
            igTasksLoaded = true;
        } else {
            // Gagal sementara (jaringan/sesi): JANGAN dianggap "tidak ada data". Coba lagi otomatis di latar belakang.
            console.warn('Muat tasklist gagal:', err);
            igTasksLoaded = false;
            if (attempt < 4) igTaskRetryTimer = setTimeout(() => loadIgTasks(attempt + 1), 4000 * (attempt + 1));
        }
    }
    igTaskLoading = false;
    renderIgCalendar();
    if (document.getElementById('igTaskModal')?.classList.contains('open')) igTaskRender();
}

function igTaskCardHtml() {
    const hariIni = igTasks.filter(t => t.hari === igTaskHariIni());
    const done = igTaskDoneToday();
    const selesai = hariIni.filter(t => done.has(String(t.id))).length;
    const sisa = hariIni.filter(t => !done.has(String(t.id))).map(t => t.nama);
    const total = hariIni.length;
    const memuat = !igTasksLoaded;   // data belum datang -> jangan tampilkan "Belum ada kerjaan"
    const state = memuat ? 'is-empty' : !total ? 'is-empty' : sisa.length ? 'is-pending' : 'is-done';
    // 2 baris: (1) label kecil + hitungan, (2) NAMA kerjaan pertama yang belum selesai (ditonjolkan)
    const baris2 = memuat ? '<div class="ig-task-kosong">Memuat…</div>'
        : state === 'is-empty' ? '<div class="ig-task-kosong">Belum ada kerjaan hari ini</div>'
        : state === 'is-done' ? '<div class="ig-task-kosong">Semua kerjaan selesai</div>'
        : `<div class="ig-task-item" title="${escapeHtml(sisa[0])}"><span class="ig-task-txt">${escapeHtml(sisa[0])}</span>`
            + (sisa.length > 1 ? `<small class="ig-task-lagi">+${sisa.length - 1} lagi</small>` : '') + '</div>';
    return `<div class="ig-stat ig-stat-task ${state}" role="button" tabindex="0" onclick="openIgTaskModal()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openIgTaskModal();}" title="Klik untuk melihat dan mengatur tasklist seminggu">`
        + `<div class="ig-task-head"><i class="bi bi-bell-fill ig-task-bell" aria-hidden="true"></i>`
        + `<span class="ig-task-label">Tasklist ${IG_TASK_HARI[igTaskHariIni() - 1]}${total ? ` · ${selesai}/${total} selesai` : ''}</span></div>`
        + `<div class="ig-task-main">${baris2}</div></div>`;
}

function openIgTaskModal() {
    const modal = document.getElementById('igTaskModal');
    if (!modal) return;
    igTaskSelHari = igTaskHariIni();
    igTaskRender();
    modal.classList.add('open');
    if (!igTasksLoaded && !igTaskLoading) loadIgTasks();   // belum berhasil dimuat -> coba lagi sekarang
}
function closeIgTaskModal() {
    const modal = document.getElementById('igTaskModal');
    if (modal) modal.classList.remove('open');
}

const IG_TASK_HARI_PENDEK = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
let igTaskSelHari = 0; // hari yang sedang dibuka di modal (1..7); 0 = ikut hari ini

function igTaskPilihHari(h) { igTaskSelHari = h; igTaskRender(); }

function igTaskRender() {
    const body = document.getElementById('igTaskBody');
    if (!body) return;
    const edit = canManageProgramData();
    const hariIni = igTaskHariIni();
    const sel = igTaskSelHari >= 1 && igTaskSelHari <= 7 ? igTaskSelHari : hariIni;
    const isToday = sel === hariIni;
    const done = igTaskDoneToday();
    const note = document.getElementById('igTaskNote');
    if (note) note.textContent = igTaskDb ? '' : 'Tabel ig_tasklist belum dibuat, tasklist sementara hanya tersimpan di browser ini (jalankan sql/49_tambah_ig_tasklist.sql).';

    if (!igTasksLoaded) {
        body.innerHTML = `<div class="ig-tm-empty" style="padding:40px 0;"><i class="bi ${igTaskLoading ? 'bi-hourglass-split' : 'bi-exclamation-triangle'}"></i><span>${igTaskLoading ? 'Memuat tasklist…' : 'Tasklist belum bisa dimuat, mencoba lagi…'}</span></div>`;
        return;
    }

    // ---- Tab 7 hari ----
    const tabs = IG_TASK_HARI.map((nama, i) => {
        const h = i + 1, list = igTasks.filter(t => t.hari === h);
        const ket = h === hariIni ? `${list.filter(t => done.has(String(t.id))).length}/${list.length}` : (list.length || '–');
        return `<button type="button" role="tab" aria-selected="${h === sel}" class="ig-tm-tab${h === sel ? ' on' : ''}${h === hariIni ? ' today' : ''}" onclick="igTaskPilihHari(${h})">`
            + `<span class="ig-tm-tab-n">${IG_TASK_HARI_PENDEK[i]}</span><span class="ig-tm-tab-c">${ket}</span></button>`;
    }).join('');

    // ---- Panel hari terpilih ----
    const nama = IG_TASK_HARI[sel - 1];
    const list = igTasks.filter(t => t.hari === sel);
    const selesai = isToday ? list.filter(t => done.has(String(t.id))).length : 0;
    const semua = isToday && list.length > 0 && selesai === list.length;
    const pct = list.length ? Math.round(selesai / list.length * 100) : 0;
    const sub = isToday ? 'Hari ini' : sel === (hariIni % 7) + 1 ? 'Besok' : `Berulang tiap ${nama}`;
    const rows = list.map((t, i) => {
        const id = String(t.id), cek = isToday && done.has(id);
        const del = edit ? `<button type="button" class="ig-tm-del" onclick="igTaskHapus('${id}')" aria-label="Hapus" title="Hapus">&times;</button>` : '';
        const nm = `<span class="ig-tm-nama">${escapeHtml(t.nama)}</span>`;
        return isToday
            ? `<li class="ig-tm-item${cek ? ' done' : ''}"><label><input type="checkbox" ${cek ? 'checked' : ''} onchange="igTaskToggle('${id}')"><span class="ig-tm-box"><i class="bi bi-check-lg"></i></span>${nm}</label>${del}</li>`
            : `<li class="ig-tm-item"><span class="ig-tm-num">${i + 1}</span>${nm}${del}</li>`;
    }).join('') || `<li class="ig-tm-empty"><i class="bi bi-inbox"></i><span>Belum ada kerjaan di hari ${nama}</span></li>`;
    const form = edit
        ? `<form class="ig-tm-add" onsubmit="return igTaskTambah(event, ${sel})"><input type="text" maxlength="120" placeholder="Tambah kerjaan hari ${nama}..." aria-label="Tambah kerjaan hari ${nama}"><button type="submit">Tambah</button></form>` : '';

    body.innerHTML = `<div class="ig-tm-tabs" role="tablist">${tabs}</div>`
        + `<section class="ig-tm-panel${isToday ? ' is-today' : ''}${semua ? ' is-done' : ''}">`
        + `<div class="ig-tm-head"><div><h3>${nama}</h3><p>${sub}</p></div>`
        + `<div class="ig-tm-stat">${isToday ? `<b>${selesai}/${list.length}</b><span>${semua ? 'semua selesai' : 'selesai'}</span>` : `<b>${list.length}</b><span>kerjaan</span>`}</div></div>`
        + (isToday && list.length ? `<div class="ig-tm-bar"><div style="width:${pct}%"></div></div>` : '')
        + `<ul class="ig-tm-list">${rows}</ul>${form}</section>`;
}

async function igTaskTambah(ev, hari) {
    ev.preventDefault();
    const input = ev.target.querySelector('input');
    const nama = (input.value || '').trim();
    if (!nama) return false;
    const urut = igTasks.filter(t => t.hari === hari).length;
    input.value = '';
    if (igTaskDb) {
        const { data, error } = await supabaseClient.from('ig_tasklist').insert({ hari, nama, urut }).select().single();
        if (error) { showToast('Gagal menambah kerjaan: ' + error.message, 'error'); input.value = nama; return false; }
        igTasks.push(data);
    } else {
        igTasks.push({ id: 'l' + Date.now() + Math.random().toString(36).slice(2, 6), hari, nama, urut });
        igTaskLsSet(IG_TASK_LS, igTasks);
    }
    igTaskRender(); renderIgCalendar();
    document.querySelector('#igTaskBody .ig-tm-add input')?.focus();
    return false;
}

async function igTaskHapus(id) {
    const t = igTasks.find(x => String(x.id) === String(id));
    if (!t) return;
    if (igTaskDb) {
        const { error } = await supabaseClient.from('ig_tasklist').delete().eq('id', t.id);
        if (error) { showToast('Gagal menghapus kerjaan: ' + error.message, 'error'); return; }
    }
    igTasks = igTasks.filter(x => String(x.id) !== String(id));
    if (!igTaskDb) igTaskLsSet(IG_TASK_LS, igTasks);
    igTaskRender(); renderIgCalendar();
}

function igTaskToggle(id) {
    const done = igTaskDoneToday();
    if (done.has(id)) done.delete(id); else done.add(id);
    igTaskDoneSave(done);
    igTaskRender(); renderIgCalendar();
}

window.openIgTaskModal = openIgTaskModal;
window.closeIgTaskModal = closeIgTaskModal;
window.igTaskTambah = igTaskTambah;
window.igTaskHapus = igTaskHapus;
window.igTaskToggle = igTaskToggle;
window.igTaskPilihHari = igTaskPilihHari;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeIgTaskModal(); });

// ============================================================
// 24f. RENCANA KONTEN (rekap 12 bulan untuk evaluasi, cara kerja mirip About Planner)
// Modal baca-saja yang merangkum rencana konten setahun: per bulan (jumlah ide, jadi post, dilewati, pilar),
// per pekan (tema + isi harian). Sumber data:
//   - pekan yang sudah punya rencana  -> dibaca dari ig_content_plan (cache igContentPlan), label "Disusun"
//   - pekan yang belum punya rencana  -> proyeksi tema otomatis igPetaTemaSetahun (tanpa AI), label "Saran"
//   - pekan yang sudah lewat tanpa isi -> label "Kosong" (bahan evaluasi)
// Tombol "Salin untuk Claude" / "Unduh .md" menghasilkan rekap markdown + petunjuk evaluasi.
// Tidak menulis apa pun ke database.
// ============================================================
const IG_NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const IG_RK_STATUS = { idea: 'Ide', dijadikan_post: 'Jadi post', dilewati: 'Dilewati' };
const IG_RK_HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
let igRkProgram = []; // program aktif belum berangkat (untuk fase promosi)
let igRkData = null; // hasil igRkSusun terakhir (dipakai render, salin, dan unduh)
let igRkSudahRender = false; // false = render pertama sejak modal dibuka (bulan dibuka sesuai default); true = pertahankan bulan yang sedang terbuka
let igRencanaTahun = []; // cache ig_rencana_tahunan (1 baris per pekan: senin, tema, alasan, fokus_program, sumber, terkunci)
let igRencanaReady = false; // true kalau sql/48_tambah_ig_rencana_tahunan.sql sudah dijalankan
let igRtEditSenin = null; // Senin pekan yang temanya sedang diedit inline
let igRtBusy = false; // true selama AI menyusun rencana setahun

function igRkParseKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
function igRkTglHari(key) { const d = igRkParseKey(key); return `${IG_RK_HARI[d.getDay()]} ${igTglPendek(key)}`; }

// Susun data 12 bulan mulai bulan (y, m0). Fungsi murni terhadap plans (default igContentPlan).
function igRkSusun(y, m0, plans, programs, rencana = igRencanaTahun) {
    plans = (plans || []).filter(pl => pl.tanggal);
    const first = new Date(y, m0, 1);
    const awal = new Date(y, m0, 1 - ((first.getDay() + 6) % 7)); // Senin pada/sebelum tanggal 1
    const peta = igPetaTemaSetahun(igLocalDateKey(awal), plans, 54, '', rencana);
    const hariIni = igLocalDateKey(new Date());
    const bulan = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(y, m0 + i, 1);
        return { y: d.getFullYear(), m: d.getMonth(), minggu: [], ide: 0, post: 0, lewat: 0, total: 0, pilar: {} };
    });
    peta.forEach(r => {
        const kamis = igRkParseKey(r.senin); kamis.setDate(kamis.getDate() + 3);
        const idx = (kamis.getFullYear() - y) * 12 + kamis.getMonth() - m0;
        if (idx < 0 || idx > 11) return;
        const isi = plans.filter(pl => pl.tanggal >= r.senin && pl.tanggal <= r.minggu).sort((a, b) => a.tanggal.localeCompare(b.tanggal));
        const temaNyata = (isi.find(pl => pl.tema_minggu) || {}).tema_minggu || '';
        let status;
        if (temaNyata) status = 'disusun';
        else if (isi.length) status = 'tanpa-tema';
        else if (r.minggu < hariIni) status = 'kosong';
        else status = r.rencana ? 'rencana' : 'saran';
        const program = (programs || []).map(pr => ({ nama: pr.nama, tgl: pr.tgl, f: igFaseProgram(r.senin, pr.d) }))
            .filter(x => x.f);
        bulan[idx].minggu.push({
            senin: r.senin, minggu: r.minggu, status, isi, program,
            tema: temaNyata || r.tema, alasan: temaNyata ? '' : r.alasan,
            terkunci: status === 'rencana' && r.terkunci, fokus: r.fokus || '',
            berjalan: r.senin <= hariIni && hariIni <= r.minggu
        });
    });
    plans.forEach(pl => {
        const b = bulan.find(x => pl.tanggal.slice(0, 7) === `${x.y}-${String(x.m + 1).padStart(2, '0')}`);
        if (!b) return;
        b.total++;
        if (pl.status === 'dijadikan_post') b.post++;
        else if (pl.status === 'dilewati') b.lewat++;
        else b.ide++;
        if (pl.pilar) b.pilar[pl.pilar] = (b.pilar[pl.pilar] || 0) + 1;
    });
    const semuaMinggu = bulan.flatMap(b => b.minggu);
    return {
        bulan,
        ringkas: {
            minggu: semuaMinggu.length,
            disusun: semuaMinggu.filter(w => w.status === 'disusun' || w.status === 'tanpa-tema').length,
            kosong: semuaMinggu.filter(w => w.status === 'kosong').length,
            rencana: semuaMinggu.filter(w => w.status === 'rencana').length,
            total: bulan.reduce((a, b) => a + b.total, 0),
            post: bulan.reduce((a, b) => a + b.post, 0),
            lewat: bulan.reduce((a, b) => a + b.lewat, 0)
        },
        dari: `${IG_NAMA_BULAN[bulan[0].m]} ${bulan[0].y}`,
        sampai: `${IG_NAMA_BULAN[bulan[11].m]} ${bulan[11].y}`
    };
}

function igRkLabelPilar(k) { return (typeof IG_PILLARS !== 'undefined' && IG_PILLARS[k]) ? IG_PILLARS[k].label : k; }
const IG_RK_LABEL_STATUS = { disusun: 'Disusun', 'tanpa-tema': 'Tanpa tema', rencana: 'Rencana AI', saran: 'Saran', kosong: 'Kosong' };

let igKesBuka = null; // null = otomatis (terbuka kalau ada catatan); true/false = pilihan admin lewat panel

// Kesehatan Rencana untuk rentang yang tampil (hanya pekan dari hari ini ke depan).
function igRkKesehatan() {
    if (!igRkData) return null;
    return igRtKesehatan(igRkData.bulan.flatMap(b => b.minggu), igLocalDateKey(new Date()));
}
const IG_KES_TANDA = {
    'absen': ['Hilang', 'danger'], 'kurang-tayang': ['Kurang tayang', 'warn'], 'berlebih': ['Berlebih', 'warn'],
    'stok-kurang': ['Tema kurang', 'danger'], 'stok-menipis': ['Tema menipis', 'warn']
};
function igRkKesehatanHtml() {
    const k = igRkKesehatan();
    if (!k || !k.pekan) return '';
    const buka = igKesBuka === null ? k.catatan.length > 0 : igKesBuka;
    const rasioLabel = { seimbang: ['Seimbang', 'ok'], 'hati-dominan': ['Terlalu hati', 'warn'], 'praktis-dominan': ['Terlalu praktis', 'warn'], sedikit: ['Data masih sedikit', ''], kosong: ['Belum ada data', ''] }[k.rasio];
    const fase = k.fase.map(f => {
        const chips = f.tanda.map(t => `<span class="ig-kes-chip ${IG_KES_TANDA[t][1]}">${IG_KES_TANDA[t][0]}</span>`).join('');
        const tayang = f.jedaPertama === null ? 'belum tayang' : (f.jedaPertama === 0 ? 'tayang pekan ini' : `tayang ${f.jedaPertama} pekan lagi`);
        return `<div class="ig-kes-fase"><div class="ig-kes-nama">${escapeHtml(f.label)}${chips}</div>`
            + `<div class="ig-kes-bar" title="Porsi ${f.persen}% dari pekan alur, target ${f.targetPersen}%"><i style="width:${Math.min(100, f.persen)}%"></i><b style="left:${Math.min(100, f.targetPersen)}%"></b></div>`
            + `<div class="ig-kes-info">${f.jumlah} pekan (jatah sekitar ${f.jatah}) · ${tayang} · stok ${f.stok} tema, ${f.sisa} belum tayang, butuh sekitar ${f.perlu} per tahun</div></div>`;
    }).join('');
    const terkls = k.hati + k.praktis;
    const hatiP = terkls ? k.hatiPersen : 0;
    const lain = k.musimN + k.lainN;
    const catatan = k.catatan.length
        ? `<ul class="ig-kes-catatan">${k.catatan.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`
        : '<p class="ig-kes-ok"><i class="bi bi-check-circle"></i> Komposisi fase, rasio hati dan praktis, serta stok tema tampak sehat.</p>';
    return `<details class="ig-kes" id="igKes"${buka ? ' open' : ''} ontoggle="igKesBuka = this.open">`
        + `<summary><span><i class="bi bi-heart-pulse"></i> Kesehatan rencana</span>`
        + `<small>${k.pekan} pekan ke depan · ${k.catatan.length ? k.catatan.length + ' catatan' : 'tidak ada catatan'}</small></summary>`
        + catatan
        + `<div class="ig-kes-grid"><div><h4>Komposisi fase</h4>${fase}`
        + (lain ? `<div class="ig-kes-info">Di luar fase: ${k.musimN} pekan tema musiman${k.lainN ? `, ${k.lainN} tema ketikan sendiri` : ''}.</div>` : '') + `</div>`
        + `<div><h4>Hati dan praktis</h4>`
        + `<div class="ig-kes-rasio" title="Hati ${hatiP}%, praktis ${terkls ? 100 - hatiP : 0}%"><i style="width:${hatiP}%"></i></div>`
        + `<div class="ig-kes-info">Hati ${k.hati} pekan (${hatiP}%) · praktis ${k.praktis} pekan (${terkls ? 100 - hatiP : 0}%)</div>`
        + `<div class="ig-kes-info"><span class="ig-kes-chip ${rasioLabel[1]}">${rasioLabel[0]}</span> batas sehat hati ${Math.round(IG_RASIO_HATI[0] * 100)}-${Math.round(IG_RASIO_HATI[1] * 100)}%</div>`
        + `</div></div></details>`;
}

function igRkRender() {
    const input = document.getElementById('igRkMulai');
    const body = document.getElementById('igRkBody');
    if (!input || !body) return;
    const [y, mm] = (input.value || '').split('-').map(Number);
    if (!y || !mm) return;
    const terbuka = igRkSudahRender
        ? new Set(Array.from(body.querySelectorAll('details.ig-rk-bulan[open]')).map(x => x.dataset.bk)) : null;
    const scrollAtas = body.scrollTop;
    igRkData = igRkSusun(y, mm - 1, igContentPlan, igRkProgram);
    const d = igRkData, r = d.ringkas;
    const pakaiTerbuka = !!terbuka && d.bulan.some(b => terbuka.has(`${b.y}-${b.m}`));
    const meta = document.getElementById('igRkMeta');
    if (meta) meta.textContent = `${d.dari} – ${d.sampai} · ${r.disusun} dari ${r.minggu} pekan sudah disusun` + (r.rencana ? ` · ${r.rencana} pekan rencana AI` : '');
    const tombolRt = document.getElementById('igRtToggle');
    if (tombolRt) tombolRt.style.display = canManageProgramData() ? '' : 'none';
    const pct = r.total ? Math.round(r.post / r.total * 100) : 0;
    const stat = (n, l) => `<div class="ig-rk-stat"><strong>${n}</strong><span>${l}</span></div>`;
    let html = `<div class="ig-rk-stats">${stat(r.disusun + '/' + r.minggu, 'pekan disusun')}${r.rencana ? stat(r.rencana, 'pekan rencana AI') : ''}${stat(r.total, 'total ide')}${stat(r.post, 'jadi post (' + pct + '%)')}${stat(r.lewat, 'dilewati')}${stat(r.kosong, 'pekan lewat kosong')}</div>`;
    html += igRkKesehatanHtml();
    html += d.bulan.map((b, i) => {
        const pBulan = b.total ? Math.round(b.post / b.total * 100) : 0;
        const pil = Object.entries(b.pilar).sort((a, c) => c[1] - a[1]).map(([k, n]) => {
            const c = (typeof IG_PILLARS !== 'undefined' && IG_PILLARS[k]) ? IG_PILLARS[k].color : 'var(--ink-soft)';
            return `<span class="ig-rk-pilar" style="--c:${c}">${escapeHtml(igRkLabelPilar(k))} ${n}</span>`;
        }).join('');
        const weeks = b.minggu.map(w => {
            const badge = `<span class="ig-rk-badge ig-rk-b-${w.status}">${IG_RK_LABEL_STATUS[w.status]}</span>`
                + (w.terkunci ? ' <i class="bi bi-lock-fill ig-rt-kunci" title="Terkunci: tidak ditimpa saat rencana disusun ulang"></i>' : '');
            const sedangEdit = igRtEditSenin === w.senin && igRtBisaKelola(w);
            const nPost = w.isi.filter(p => p.status === 'dijadikan_post').length;
            const hitung = w.isi.length ? `${w.isi.length} ide${nPost ? ' · ' + nPost + ' post' : ''}` : '';
            const head = `<span class="ig-rk-tgl">${igTglPendek(w.senin)} – ${igTglPendek(w.minggu)}</span>`
                + `<span class="ig-rk-tema">${sedangEdit ? igRtEditHtml(w) : `${escapeHtml(w.tema)}${w.alasan ? `<small>${escapeHtml(w.alasan)}</small>` : ''}`}`
                + w.program.map(x => `<span class="ig-rk-prog ig-rk-f-${x.f.kode}" title="${escapeHtml(x.f.arahan)}">${escapeHtml(x.nama)} · ${x.f.label}</span>`).join('')
                + `</span>`
                + `<span class="ig-rk-meta">${badge}<small>${hitung}</small>${sedangEdit ? '' : igRtAksiHtml(w)}</span>`;
            if (!w.isi.length) return `<div class="ig-rk-minggu${w.berjalan ? ' now' : ''}"><div class="ig-rk-row">${head}</div></div>`;
            const items = w.isi.map(p => {
                const c = (p.pilar && typeof IG_PILLARS !== 'undefined' && IG_PILLARS[p.pilar]) ? IG_PILLARS[p.pilar].color : 'var(--line)';
                return `<li style="--c:${c}"><span class="ig-rk-hari">${igRkTglHari(p.tanggal)}</span>`
                    + `<span>${escapeHtml(p.tema || '(tanpa judul)')}${p.pilar ? ` <em>${escapeHtml(igRkLabelPilar(p.pilar))}</em>` : ''}</span>`
                    + `<small>${IG_RK_STATUS[p.status] || ''}</small></li>`;
            }).join('');
            return `<details class="ig-rk-minggu${w.berjalan ? ' now' : ''}"><summary class="ig-rk-row">${head}</summary><ul class="ig-rk-items">${items}</ul></details>`;
        }).join('');
        const berjalan = b.minggu.some(w => w.berjalan);
        const buka = pakaiTerbuka ? terbuka.has(`${b.y}-${b.m}`) : (berjalan || i === 0);
        return `<details class="ig-rk-bulan" data-bk="${b.y}-${b.m}"${buka ? ' open' : ''}>`
            + `<summary><span class="ig-rk-bulan-nama">${IG_NAMA_BULAN[b.m]} ${b.y}</span>`
            + `<span class="ig-rk-bulan-info">${b.total ? `${b.total} ide · ${b.post} jadi post${b.lewat ? ' · ' + b.lewat + ' dilewati' : ''}` : 'belum ada ide'}</span>`
            + `<span class="ig-rk-bar" title="${pBulan}% jadi post"><i style="width:${pBulan}%"></i></span></summary>`
            + (pil ? `<div class="ig-rk-pilars">${pil}</div>` : '')
            + `<div class="ig-rk-weeks">${weeks || '<div class="ig-rk-row"><span class="ig-rk-tema">Tidak ada pekan</span></div>'}</div>`
            + `<div class="ig-rk-lihat"><button type="button" class="ig-rk-lihat-btn" onclick="igRkLihatDiKalender(${b.y},${b.m})"><i class="bi bi-calendar-week"></i> Lihat di kalender <i class="bi bi-arrow-right"></i></button></div>`
            + `</details>`;
    }).join('');
    body.innerHTML = html;
    body.scrollTop = scrollAtas;
    igRkSudahRender = true;
    if (igRtEditSenin) setTimeout(() => { const el = document.getElementById('igRtInput'); if (el) { el.focus(); el.select(); } }, 0);
}

function igRkIniHari() {
    igRkSudahRender = false; // buka ulang / "Bulan ini": bulan terbuka kembali ke default
    igRtEditSenin = null;
    const t = new Date();
    const input = document.getElementById('igRkMulai');
    if (input) input.value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
    igRkRender();
}

function openIgRencanaKontenModal() {
    const modal = document.getElementById('igRencanaKontenModal');
    if (!modal) return;
    igRkIniHari();
    modal.classList.add('open');
    const body = document.getElementById('igRkBody');
    if (body) body.scrollTop = 0;
    // muat ulang rencana terbaru (bisa ada perubahan dari sesi lain), lalu render ulang tanpa menutup bagian yang dibuka
    Promise.all([loadIgContentPlan(), igProgramAktifRingan()]).then(([, prog]) => { // loadIgContentPlan ikut memuat rencana setahun
        igRkProgram = prog || [];
        if (modal.classList.contains('open')) igRkRender();
    });
}

function closeIgRencanaKontenModal() {
    const modal = document.getElementById('igRencanaKontenModal');
    if (modal) modal.classList.remove('open');
}

function igRkLihatDiKalender(y, m) {
    igCalendarCurrent = new Date(y, m, 1);
    renderIgCalendar();
    closeIgRencanaKontenModal();
}

// Rekap markdown + petunjuk evaluasi (dipakai Salin & Unduh).
function igRkMarkdown() {
    if (!igRkData) igRkRender();
    const d = igRkData;
    if (!d) return '';
    const r = d.ringkas;
    const hariIni = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const L = [];
    L.push('# Rencana Konten Instagram Amiru Tour: ' + d.dari + ' sampai ' + d.sampai);
    L.push('Dibuat: ' + hariIni, '');
    L.push('## Ringkasan');
    L.push(`- Pekan sudah disusun: ${r.disusun} dari ${r.minggu}`);
    L.push(`- Total ide: ${r.total} (jadi post: ${r.post}, dilewati: ${r.lewat})`);
    L.push(`- Pekan lewat tanpa isi: ${r.kosong}`, '');
    const kes = igRkKesehatan();
    if (kes && kes.pekan) {
        L.push('## Kesehatan rencana (' + kes.pekan + ' pekan ke depan)');
        kes.fase.forEach(f => L.push(`- ${f.label}: ${f.jumlah} pekan (jatah sekitar ${f.jatah}), stok ${f.stok} tema dari kebutuhan sekitar ${f.perlu} per tahun${f.tanda.length ? ' [' + f.tanda.map(t => IG_KES_TANDA[t][0]).join(', ') + ']' : ''}`));
        L.push(`- Hati ${kes.hati} pekan, praktis ${kes.praktis} pekan (hati ${kes.hatiPersen}%, batas sehat ${Math.round(IG_RASIO_HATI[0] * 100)}-${Math.round(IG_RASIO_HATI[1] * 100)}%)`);
        if (kes.musimN || kes.lainN) L.push(`- Di luar fase: ${kes.musimN} pekan musiman, ${kes.lainN} ketikan sendiri`);
        kes.catatan.forEach(c => L.push('- Catatan: ' + c));
        L.push('');
    }
    d.bulan.forEach(b => {
        L.push(`## ${IG_NAMA_BULAN[b.m]} ${b.y}`);
        L.push(`Ide: ${b.total} | Jadi post: ${b.post} | Dilewati: ${b.lewat}` + (Object.keys(b.pilar).length
            ? ' | Pilar: ' + Object.entries(b.pilar).map(([k, n]) => `${igRkLabelPilar(k)} ${n}`).join(', ') : ''), '');
        L.push('| Pekan | Tema | Status | Ide | Jadi post | Fase program |', '|---|---|---|---|---|---|');
        b.minggu.forEach(w => {
            const nPost = w.isi.filter(p => p.status === 'dijadikan_post').length;
            const tema = String(w.tema).replace(/\|/g, '/');
            L.push(`| ${igTglPendek(w.senin)} – ${igTglPendek(w.minggu)} | ${tema} | ${IG_RK_LABEL_STATUS[w.status]} | ${w.isi.length} | ${nPost} | ${w.program.map(x => String(x.nama).replace(/\|/g, '/') + ' (' + x.f.label + ')').join('; ')} |`);
        });
        const rinci = b.minggu.filter(w => w.isi.length);
        if (rinci.length) {
            L.push('', '### Isi harian');
            rinci.forEach(w => w.isi.forEach(p => {
                L.push(`- ${igRkTglHari(p.tanggal)}${p.pilar ? ' [' + igRkLabelPilar(p.pilar) + ']' : ''} ${String(p.tema || '').replace(/\s+/g, ' ')} (${IG_RK_STATUS[p.status] || ''})`);
            }));
        }
        L.push('');
    });
    return L.join('\n').trim() + '\n';
}

const IG_RK_PETUNJUK = `PETUNJUK UNTUK CLAUDE
Di bawah garis adalah rekap Rencana Konten Instagram Amiru Tour untuk 12 bulan (tema per pekan, isi harian, dan progres). Status "Disusun" = sudah ada isi harian di rencana, "Rencana AI" = tema pekan hasil perencanaan AI yang tersimpan (isi harian belum dibuat), "Saran" = proyeksi tema otomatis (belum disimpan), "Kosong" = pekan lewat tanpa isi. Tolong evaluasi:
1. Apakah tema antarpekan dan antarbulan menyambung, seimbang (hati dan akal), dan tidak berulang?
2. Apakah tema musiman (Ramadhan, libur sekolah, musim haji, akhir tahun) tayang cukup awal untuk mengarah ke penjualan?
3. Apakah sebaran pilar konten per bulan seimbang? Mana bulan atau pekan yang lemah, kosong, atau menumpuk?
4. Kolom/label "Fase program" menunjukkan fase promosi tiap keberangkatan (Kenalkan > Isi paket > Seat menipis > Penutupan). Apakah tiap keberangkatan terdekat sudah punya alur promosi yang cukup, dan tidak ada pekan yang menumpuk atau terlewat?
5. Beri rekomendasi perubahan yang konkret (maksimal 10 poin, urut prioritas). Jangan menambah fakta atau angka yang tidak ada di rekap.

CATATAN TAMBAHAN DARI SAYA:
[tulis di sini]

----------------------------------------------------------------------

`;

async function igSalinRencanaKonten() {
    const ok = await igSalinTeks(IG_RK_PETUNJUK + igRkMarkdown());
    if (ok) showToast('Rencana Konten disalin. Tempel ke Claude untuk dievaluasi.');
    else showToast('Gagal menyalin. Coba tombol Unduh .md', 'error');
}

function igUnduhRencanaKonten() {
    try {
        const blob = new Blob([IG_RK_PETUNJUK + igRkMarkdown()], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rencana-konten-${igLocalDateKey(new Date())}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        showToast('File rencana-konten diunduh');
    } catch (e) {
        showToast('Gagal mengunduh: ' + (e.message || e), 'error');
    }
}

// ============================================================
// [UNDUH PDF LAPORAN RENCANA KONTEN] Laporan 12 bulan (isi sama dengan rekap .md) sebagai PDF A4 landscape.
// Caranya SAMA dengan Unduh Daftar Program: PDF digambar lewat jsPDF (teks asli, bukan screenshot), lalu tampil
// di modal preview yang sama (openProgramListPreview) dengan tombol Tutup, Share WA, dan Unduh PDF.
// Isi: kop (logo, judul, periode), ringkasan, Kesehatan Rencana, lalu tiap bulan berisi tabel pekan
// (tema, status, ide, jadi post, fase program) dengan isi harian di bawah pekan yang sudah disusun.
// Hanya membaca igRkData (data yang sama dengan yang tampil di modal), tidak menulis apa pun ke database.
// ============================================================
// jsPDF (font bawaan) hanya mengenal Latin-1: rapikan tanda baca umum dan buang emoji/simbol lain supaya tidak jadi karakter rusak.
function igPdfAman(v) {
    return String(v == null ? '' : v)
        .replace(/[\u2018\u2019\u201A]/g, "'").replace(/[\u201C\u201D\u201E]/g, '"')
        .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...').replace(/\u00A0/g, ' ')
        .replace(/[^\u0020-\u007E\u00A1-\u00FF]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function igUnduhRencanaKontenPdf() {
    const btn = (this && this.nodeType === 1) ? this : null;
    if (!igRkData) igRkRender();
    const d = igRkData;
    if (!d) { showToast('Belum ada data rencana konten untuk diunduh', 'error'); return; }

    const oldHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-arrow-repeat bi-spin"></i> Menyiapkan preview...'; }
    try {
        if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
            try { await ensureLibLoaded('jspdf'); }
            catch (_) { showToast('Modul PDF gagal dimuat — periksa koneksi internet lalu coba lagi', 'error'); return; }
        }
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const PW = 297, PH = 210, M = 12, CW = PW - 2 * M, BOTTOM = PH - 12;
        const BLUE = [21, 101, 168], INK = [28, 28, 28], MUTED = [110, 118, 126], GREY = [238, 240, 242], SOFT = [234, 243, 250];
        const RED = [200, 30, 30], GREEN = [30, 130, 80], AMBER = [190, 115, 0];
        const T = igPdfAman;
        const r = d.ringkas;
        const now = new Date();
        const tglBuat = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
        const periode = `${d.dari} - ${d.sampai}`;
        let y = M;
        const lineH = (fs) => fs * 0.3528 * 1.18;   // tinggi baris (mm) untuk ukuran font fs (pt)
        const ensure = (h) => { if (y + h > BOTTOM) { pdf.addPage(); y = M; return true; } return false; };

        // Logo (opsional -- kalau gagal dimuat dokumen tetap dibuat tanpa logo)
        let logo = null;
        try {
            const blob = await (await fetch('assets/logo-amirutour.png')).blob();
            logo = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
        } catch (_) { /* tanpa logo */ }

        // ---- Kop ----
        const LOGO_H = 15, LOGO_W = LOGO_H * 300 / 278;
        if (logo) pdf.addImage(logo, 'PNG', M, y, LOGO_W, LOGO_H);
        const tx = M + (logo ? LOGO_W + 4 : 0);
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(...INK);
        pdf.text('RENCANA KONTEN INSTAGRAM', tx, y + 6.5);
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(...MUTED);
        pdf.text(T('Amiru Tour | Periode ' + periode), tx, y + 12.2);
        pdf.setFontSize(7); pdf.text('Dibuat', PW - M, y + 5.2, { align: 'right' });
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...INK);
        pdf.text(T(tglBuat), PW - M, y + 9.8, { align: 'right' });
        y += LOGO_H + 3;
        pdf.setDrawColor(...BLUE); pdf.setLineWidth(0.6); pdf.line(M, y, PW - M, y);
        y += 5;

        // ---- Ringkasan (kotak statistik) ----
        const pct = r.total ? Math.round(r.post / r.total * 100) : 0;
        const stats = [[r.disusun + '/' + r.minggu, 'pekan disusun']];
        if (r.rencana) stats.push([String(r.rencana), 'pekan rencana AI']);
        stats.push([String(r.total), 'total ide'], [String(r.post), `jadi post (${pct}%)`], [String(r.lewat), 'dilewati'], [String(r.kosong), 'pekan lewat kosong']);
        const SG = 2.5, SW = (CW - (stats.length - 1) * SG) / stats.length, SH = 14;
        stats.forEach((st, i) => {
            const x = M + i * (SW + SG);
            pdf.setFillColor(...GREY); pdf.roundedRect(x, y, SW, SH, 1.5, 1.5, 'F');
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.setTextColor(...BLUE);
            pdf.text(st[0], x + SW / 2, y + 6.2, { align: 'center' });
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.8); pdf.setTextColor(...MUTED);
            pdf.text(T(st[1]), x + SW / 2, y + 10.8, { align: 'center', maxWidth: SW - 2 });
        });
        y += SH + 6;

        // Judul bagian bergaya kartu (aksen warna kecil + teks tebal), sama seperti blok keterangan di PDF Jadwal Umrah
        const sectionTitle = (txt, accent) => {
            ensure(14);
            pdf.setFillColor(...accent); pdf.roundedRect(M, y, 1.1, 4, 0.5, 0.5, 'F');
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5); pdf.setTextColor(...INK);
            pdf.text(T(txt), M + 3, y + 3.2);
            y += 7;
        };
        const bullet = (txt, color, fs = 8) => {
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(fs);
            const ls = pdf.splitTextToSize(T(txt), CW - 6), lh = lineH(fs);
            ensure(ls.length * lh + 1);
            pdf.setFillColor(...color); pdf.circle(M + 1.1, y + lh * 0.55, 0.55, 'F');
            pdf.setTextColor(...INK);
            ls.forEach((l, i) => pdf.text(l, M + 3.5, y + lh * 0.8 + i * lh));
            y += ls.length * lh + 0.8;
        };

        // ---- Kesehatan rencana ----
        const kes = igRkKesehatan();
        if (kes && kes.pekan) {
            sectionTitle(`KESEHATAN RENCANA (${kes.pekan} pekan ke depan)`, RED);
            if (kes.catatan.length) kes.catatan.forEach(c => bullet(c, AMBER));
            else bullet('Komposisi fase, rasio hati dan praktis, serta stok tema tampak sehat.', GREEN);
            y += 1.5;
            // Tabel komposisi fase
            const kc = [{ h: 'FASE', w: 90 }, { h: 'PEKAN (JATAH)', w: 45 }, { h: 'STOK TEMA (BUTUH/THN)', w: 60 }, { h: 'TANDA', w: CW - 195 }];
            ensure(6 + 7 * 2);
            pdf.setFillColor(...BLUE); pdf.rect(M, y, CW, 5.8, 'F');
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.2); pdf.setTextColor(255, 255, 255);
            { let x = M; kc.forEach(c => { pdf.text(c.h, x + 2, y + 4); x += c.w; }); }
            y += 5.8;
            kes.fase.forEach((f, i) => {
                ensure(6);
                if (i % 2) { pdf.setFillColor(...GREY); pdf.rect(M, y, CW, 5.6, 'F'); }
                pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.8); pdf.setTextColor(...INK);
                const cells = [T(f.label), `${f.jumlah} (sekitar ${f.jatah})`, `${f.stok} (sekitar ${f.perlu})`, f.tanda.map(t => IG_KES_TANDA[t][0]).join(', ') || '-'];
                let x = M;
                cells.forEach((c, ci) => {
                    if (ci === 3 && f.tanda.length) pdf.setTextColor(...(f.tanda.some(t => IG_KES_TANDA[t][1] === 'danger') ? RED : AMBER));
                    pdf.text(c, x + 2, y + 3.9, { maxWidth: kc[ci].w - 3 }); x += kc[ci].w;
                    pdf.setTextColor(...INK);
                });
                y += 5.6;
            });
            y += 2.5;
            const terkls = kes.hati + kes.praktis;
            bullet(`Hati ${kes.hati} pekan, praktis ${kes.praktis} pekan (hati ${terkls ? kes.hatiPersen : 0}%, batas sehat ${Math.round(IG_RASIO_HATI[0] * 100)}-${Math.round(IG_RASIO_HATI[1] * 100)}%)`, BLUE);
            if (kes.musimN || kes.lainN) bullet(`Di luar fase: ${kes.musimN} pekan musiman, ${kes.lainN} ketikan sendiri`, BLUE);
            y += 3;
        }

        // ---- Tabel per bulan ----
        const WC = [32, 100, 24, 11, 12, CW - 179];       // Pekan | Tema | Status | Ide | Post | Fase program
        const WX = WC.map((_, i) => WC.slice(0, i).reduce((a, b) => a + b, 0));
        const HEAD = ['PEKAN', 'TEMA', 'STATUS', 'IDE', 'POST', 'FASE PROGRAM'];
        const STATUS_WARNA = { disusun: GREEN, 'tanpa-tema': AMBER, rencana: BLUE, saran: MUTED, kosong: RED };
        const drawCols = () => {
            pdf.setFillColor(215, 224, 232); pdf.rect(M, y, CW, 5.2, 'F');
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.8); pdf.setTextColor(...INK);
            HEAD.forEach((h, i) => pdf.text(h, M + WX[i] + 1.8, y + 3.6));
            y += 5.2;
        };
        const drawMonthBand = (b, lanjut) => {
            pdf.setFillColor(...BLUE); pdf.rect(M, y, CW, 6.6, 'F');
            pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5); pdf.setTextColor(255, 255, 255);
            pdf.text(`${IG_NAMA_BULAN[b.m]} ${b.y}${lanjut ? ' (lanjutan)' : ''}`, M + 2, y + 4.6);
            const info = b.total ? `${b.total} ide | ${b.post} jadi post${b.lewat ? ' | ' + b.lewat + ' dilewati' : ''}` : 'belum ada ide';
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5);
            pdf.text(info, PW - M - 2, y + 4.4, { align: 'right' });
            y += 6.6;
        };

        d.bulan.forEach(b => {
            ensure(6.6 + 5.2 + 14);
            drawMonthBand(b, false);
            const pil = Object.entries(b.pilar).sort((a, c) => c[1] - a[1]).map(([k, n]) => `${igRkLabelPilar(k)} ${n}`).join(', ');
            if (pil) {
                pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.2); pdf.setTextColor(...MUTED);
                const ls = pdf.splitTextToSize(T('Pilar: ' + pil), CW - 4);
                ls.forEach((l, i) => pdf.text(l, M + 2, y + 3.4 + i * 3.2));
                y += ls.length * 3.2 + 1.6;
            }
            drawCols();
            if (!b.minggu.length) {
                pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.8); pdf.setTextColor(...MUTED);
                pdf.text('Tidak ada pekan', M + 2, y + 4); y += 6;
            }
            // Baris baru: pindah halaman bila tidak muat, lalu ulangi kepala bulan + kolom
            const guard = (h) => { if (y + h > BOTTOM) { pdf.addPage(); y = M; drawMonthBand(b, true); drawCols(); } };

            b.minggu.forEach(w => {
                const nPost = w.isi.filter(p => p.status === 'dijadikan_post').length;
                const fase = w.program.map(x => `${x.nama} (${x.f.label})`).join('; ');
                pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.8);
                const cTema = pdf.splitTextToSize(T(w.tema) || '-', WC[1] - 3);
                const cFase = pdf.splitTextToSize(T(fase) || '-', WC[5] - 3);
                const LH = lineH(7.8);
                const rowH = Math.max(cTema.length, cFase.length, 1) * LH + 1.8;
                guard(rowH + (w.isi.length ? 5 : 0));
                pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.8);   // guard() bisa mengubah font (kepala bulan/kolom)
                pdf.setFillColor(...SOFT); pdf.rect(M, y, CW, rowH, 'F');
                const by = y + 0.9 + LH * 0.78;
                pdf.setTextColor(...INK);
                pdf.text(`${igTglPendek(w.senin)} - ${igTglPendek(w.minggu)}`, M + WX[0] + 1.8, by, { maxWidth: WC[0] - 2 });
                cTema.forEach((l, i) => pdf.text(l, M + WX[1] + 1.8, by + i * LH));
                pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...(STATUS_WARNA[w.status] || INK));
                pdf.text(IG_RK_LABEL_STATUS[w.status] || '', M + WX[2] + 1.8, by, { maxWidth: WC[2] - 2 });
                pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...INK);
                pdf.text(String(w.isi.length), M + WX[3] + 1.8, by);
                pdf.text(String(nPost), M + WX[4] + 1.8, by);
                pdf.setTextColor(...MUTED);
                cFase.forEach((l, i) => pdf.text(l, M + WX[5] + 1.8, by + i * LH));
                y += rowH;

                // Isi harian pekan ini (kecil, di bawah baris pekan)
                w.isi.forEach(p => {
                    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.2);
                    const LH2 = lineH(7.2);
                    const teks = T(p.tema || '(tanpa judul)') + (p.pilar ? '  [' + T(igRkLabelPilar(p.pilar)) + ']' : '');
                    const ls = pdf.splitTextToSize(teks, WC[1] + WC[2] + WC[3] + WC[4] - 3);
                    const h = ls.length * LH2 + 1.1;
                    guard(h);
                    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.2);
                    const by2 = y + 0.6 + LH2 * 0.78;
                    pdf.setTextColor(...MUTED); pdf.text(T(igRkTglHari(p.tanggal)), M + WX[0] + 4, by2);
                    pdf.setTextColor(...INK); ls.forEach((l, i) => pdf.text(l, M + WX[1] + 1.8, by2 + i * LH2));
                    pdf.setTextColor(...MUTED); pdf.text(T(IG_RK_STATUS[p.status] || ''), M + WX[5] + 1.8, by2);
                    y += h;
                });
                pdf.setDrawColor(225, 229, 233); pdf.setLineWidth(0.15); pdf.line(M, y, M + CW, y);
            });
            y += 5;
        });

        // Footer tiap halaman: nama dokumen di kiri, nomor halaman di kanan
        const total = pdf.getNumberOfPages();
        for (let i = 1; i <= total; i++) {
            pdf.setPage(i);
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(120, 130, 140);
            pdf.text('Rencana Konten Instagram Amiru Tour', M, PH - 6);
            pdf.text(`Halaman ${i} dari ${total}`, PW - M, PH - 6, { align: 'right' });
        }

        // PDF TIDAK langsung diunduh: tampilkan preview dulu (modal yang sama dengan Daftar Program), unduh lewat tombol "Unduh PDF".
        await openProgramListPreview(pdf, `Rencana-Konten-${igLocalDateKey(now)}.pdf`, r.minggu, total, {
            title: 'Preview Laporan Rencana Konten', unit: 'pekan', noun: 'Laporan',
            waJudul: 'Rencana Konten Instagram Amiru Tour',
            waText: `Assalamu'alaikum, berikut Rencana Konten Instagram Amiru Tour periode ${periode} (${r.disusun} dari ${r.minggu} pekan sudah disusun, update ${tglBuat}).`
        });
    } catch (err) {
        console.error('igUnduhRencanaKontenPdf error:', err);
        showToast('Gagal membuat PDF: ' + (err.message || err), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
    }
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !_plp) closeIgRencanaKontenModal();
});

// ============================================================
// 24h. RENCANA SETAHUN (AI) — tema 12 bulan disusun AI, DISIMPAN di ig_rencana_tahunan, bisa diedit/dikunci
// Beda dengan "Saran" (hitungan lokal tanpa AI, tidak tersimpan): di sini AI menimbang program keberangkatan
// (fase promosi), musim Hijriah/Masehi, alur perjalanan jamaah, dan tema yang sudah dipakai, lalu hasilnya
// disimpan per pekan. Yang tersimpan menjadi saran UTAMA di Perencanaan Konten (lihat igKandidatTemaMinggu).
// Edit manual otomatis mengunci pekan itu (tidak ditimpa saat disusun ulang). Isi harian tetap dibuat per pekan.
// Butuh sql/48_tambah_ig_rencana_tahunan.sql + edge function generate-ig-year-plan.
// ============================================================
const IG_YEAR_PLAN_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/generate-ig-year-plan`;
const IG_RT_BATCH = 26; // pekan per panggilan AI (setengah tahun): hasil tersimpan bertahap dan tidak timeout
const IG_RT_MAX_ULANG = 2; // percobaan ulang untuk pekan yang ditolak (mirip tema lain)

async function loadIgRencanaTahun() {
    try {
        const { data, error } = await supabaseClient.from('ig_rencana_tahunan').select('*').order('senin', { ascending: true });
        if (error) throw error;
        igRencanaTahun = data || [];
        igRencanaReady = true;
    } catch (e) {
        igRencanaTahun = [];
        igRencanaReady = false; // tabel belum ada (migrasi belum dijalankan): fitur Rencana Setahun tidak aktif
    }
}

// Pekan boleh diedit/dikunci/di-reset hanya untuk admin/user, tabel sudah ada, dan pekan belum punya isi harian.
function igRtBisaKelola(w) {
    return canManageProgramData() && igRencanaReady && (w.status === 'saran' || w.status === 'rencana');
}

function igRtAksiHtml(w) {
    if (!igRtBisaKelola(w)) return '';
    const s = escapeHtmlAttr(w.senin);
    const btn = (ikon, judul, fn) => `<button type="button" class="ig-rt-btn" title="${escapeHtmlAttr(judul)}" aria-label="${escapeHtmlAttr(judul)}" onclick="event.preventDefault();event.stopPropagation();${fn}('${s}')"><i class="bi ${ikon}"></i></button>`;
    if (w.status === 'saran') return `<span class="ig-rt-aksi">${btn('bi-pencil', 'Tulis tema sendiri untuk pekan ini', 'igRtEdit')}</span>`;
    return `<span class="ig-rt-aksi">${btn('bi-pencil', 'Edit tema (otomatis mengunci)', 'igRtEdit')}`
        + btn(w.terkunci ? 'bi-unlock' : 'bi-lock', w.terkunci ? 'Buka kunci: boleh ditimpa saat disusun ulang' : 'Kunci: jangan ditimpa saat disusun ulang', 'igRtKunci')
        + btn('bi-x-lg', 'Hapus rencana pekan ini (kembali ke Saran)', 'igRtHapus') + `</span>`;
}

function igRtEditHtml(w) {
    const s = escapeHtmlAttr(w.senin);
    return `<span class="ig-rt-edit"><input type="text" id="igRtInput" maxlength="80" value="${escapeHtmlAttr(w.tema)}" onkeydown="igRtKey(event,'${s}')" aria-label="Tema pekan">`
        + `<button type="button" class="btn-primary ig-rt-simpan" onclick="igRtSimpanEdit('${s}')">Simpan</button>`
        + `<button type="button" class="btn-secondary ig-rt-simpan" onclick="igRtBatalEdit()">Batal</button></span>`;
}

function igRtCariPekan(senin) {
    return igRkData ? igRkData.bulan.flatMap(b => b.minggu).find(w => w.senin === senin) : null;
}

function igRtEdit(senin) {
    const w = igRtCariPekan(senin);
    if (!w || !igRtBisaKelola(w)) return;
    igRtEditSenin = senin;
    igRkRender();
}
function igRtBatalEdit() { igRtEditSenin = null; igRkRender(); }
function igRtKey(e, senin) {
    if (e.key === 'Enter') { e.preventDefault(); igRtSimpanEdit(senin); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); igRtBatalEdit(); }
}

// Simpan tema yang diketik admin: sumber 'manual' + terkunci (supaya tidak ditimpa AI).
async function igRtSimpanEdit(senin) {
    const input = document.getElementById('igRtInput');
    const tema = String((input && input.value) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!tema) { showToast('Tema tidak boleh kosong', 'error'); return; }
    const ada = igRencanaTahun.find(x => x.senin === senin);
    if (ada && ada.tema === tema) { igRtBatalEdit(); return; }
    const row = { senin, tema, alasan: ada && ada.alasan && ada.sumber === 'ai' ? 'Diubah manual dari saran AI' : 'Diatur manual', fokus_program: ada ? ada.fokus_program : null, sumber: 'manual', terkunci: true };
    try {
        const { error } = await supabaseClient.from('ig_rencana_tahunan').upsert(row, { onConflict: 'senin' });
        if (error) throw error;
        // Peringatan lunak: tema mirip pekan lain di rencana (tetap disimpan, keputusan ada di admin)
        const mirip = igRencanaTahun.find(x => x.senin !== senin && igIsSimilarText(x.tema, tema));
        igRtEditSenin = null;
        await loadIgRencanaTahun();
        igRkRender();
        if (mirip) showToast(`Tersimpan. Perhatian: mirip dengan tema pekan ${igTglPendek(mirip.senin)} ("${mirip.tema}")`, 'info');
        else showToast('Tema pekan disimpan dan dikunci');
    } catch (e) {
        showToast('Gagal menyimpan tema: ' + (e.message || e), 'error');
    }
}

async function igRtKunci(senin) {
    const ada = igRencanaTahun.find(x => x.senin === senin);
    if (!ada || !canManageProgramData()) return;
    try {
        const { error } = await supabaseClient.from('ig_rencana_tahunan').update({ terkunci: !ada.terkunci }).eq('senin', senin);
        if (error) throw error;
        await loadIgRencanaTahun();
        igRkRender();
    } catch (e) {
        showToast('Gagal mengubah kunci: ' + (e.message || e), 'error');
    }
}

async function igRtHapus(senin) {
    const ada = igRencanaTahun.find(x => x.senin === senin);
    if (!ada || !canManageProgramData()) return;
    if (ada.terkunci && !await openActionConfirm({ title: 'Hapus Rencana Pekan', message: 'Pekan ini terkunci (sudah Anda edit atau kunci). Hapus rencananya?', confirmLabel: 'Ya, Hapus' })) return;
    try {
        const { error } = await supabaseClient.from('ig_rencana_tahunan').delete().eq('senin', senin);
        if (error) throw error;
        await loadIgRencanaTahun();
        igRkRender();
    } catch (e) {
        showToast('Gagal menghapus rencana: ' + (e.message || e), 'error');
    }
}

function igRtTogglePanel() {
    const panel = document.getElementById('igRtPanel');
    if (!panel) return;
    const buka = panel.style.display === 'none' || !panel.style.display;
    panel.style.display = buka ? 'block' : 'none';
    if (buka) igRtRenderPanel();
}

// Ringkasan di panel: berapa pekan yang akan diisi dengan pengaturan sekarang.
function igRtHitungTarget() {
    if (!igRkData) return [];
    const hariIni = igLocalDateKey(new Date());
    const timpa = !!(document.getElementById('igRtTimpa') || {}).checked;
    return igRkData.bulan.flatMap(b => b.minggu).filter(w =>
        w.minggu >= hariIni && !w.isi.length
        && (w.status === 'saran' || (w.status === 'rencana' && timpa && !w.terkunci)));
}
function igRtRenderPanel() {
    const info = document.getElementById('igRtInfo');
    if (!info) return;
    if (!igRencanaReady) {
        info.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Tabel rencana setahun belum ada. Jalankan <code>sql/48_tambah_ig_rencana_tahunan.sql</code> di Supabase SQL Editor, lalu buka ulang modal ini.';
        return;
    }
    const n = igRtHitungTarget().length;
    const dikunci = igRencanaTahun.filter(x => x.terkunci).length;
    info.innerHTML = n
        ? `<i class="bi bi-calendar-check"></i> <strong>${n}</strong> pekan akan diisi AI (${igRkData.dari} – ${igRkData.sampai}).${dikunci ? ` ${dikunci} pekan terkunci tidak disentuh.` : ''}`
        : '<i class="bi bi-info-circle"></i> Tidak ada pekan yang perlu diisi pada rentang ini (semua sudah punya isi, terkunci, atau sudah lewat).';
}

// Panggil edge function (token login, bukan anon key; pola sama dengan igCallPlanFunction).
async function igRtPanggilAI(payload) {
    const response = await fetch(IG_YEAR_PLAN_FUNCTION_URL, {
        method: 'POST',
        headers: await igAiAuthHeaders(),
        body: JSON.stringify(payload)
    });
    if (response.status === 404) throw new Error('Edge function generate-ig-year-plan belum di-deploy (supabase functions deploy generate-ig-year-plan --no-verify-jwt).');
    if (!response.ok) {
        let detail = '';
        try { detail = (await response.json()).error || ''; } catch (e) {}
        throw new Error(detail || 'Gagal memanggil API (status ' + response.status + ')');
    }
    const data = await response.json();
    if (!data || !(data.versi >= 1) || !Array.isArray(data.items)) throw new Error('Respons function rencana setahun tidak dikenali. Deploy ulang generate-ig-year-plan.');
    return data;
}

// Bank alur per fase untuk edge function (bankAlurGrup): id, label, bobot, dan tema yang belum terblokir riwayat awal.
// Fase yang temanya habis terblokir dibuang supaya AI tidak diminta mengisi fase kosong. Sumber tunggal: IG_ALUR_GRUP.
function igRtBankAlurGrup(terblokir) {
    const blok = terblokir || new Set();
    return IG_ALUR_GRUP
        .map(g => ({ id: g.id, label: g.label, bobot: g.bobot, tema: g.tema.filter(a => !blok.has(a)) }))
        .filter(g => g.tema.length);
}

function igRtBahanMusim() {
    return IG_TEMA_MUSIM.map(e => {
        const kapan = [
            ...(e.hijri || []).map(n => 'bulan Hijriah ' + IG_NAMA_HIJRI[n - 1]),
            ...(e.hijriRentang ? ['HANYA di pekan ' + e.peristiwa] : []),
            ...(e.masehi || []).map(n => 'bulan ' + IG_NAMA_BULAN[n - 1])
        ].join(', ');
        return `- ${e.tema} (tayang ${kapan}${e.jual ? '; tema penjualan, sengaja tayang lebih awal dari musimnya' : ''})`;
    }).join('\n');
}

function igRtStatus(teks, error) {
    const el = document.getElementById('igRtStatus');
    if (!el) return;
    el.textContent = teks || '';
    el.classList.toggle('error', !!error);
}

// Susun rencana: batch per setengah tahun -> cek kemiripan -> ulang pekan yang ditolak -> simpan per batch.
async function igRtSusunAI() {
    if (igRtBusy) return;
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk menyusun rencana konten', 'error'); return; }
    if (!igRencanaReady) { igRtRenderPanel(); showToast('Jalankan sql/48_tambah_ig_rencana_tahunan.sql dulu', 'error'); return; }
    if (!igRkData) igRkRender();
    const target = igRtHitungTarget();
    if (!target.length) { igRtRenderPanel(); showToast('Tidak ada pekan yang perlu diisi', 'info'); return; }

    igRtBusy = true;
    const btn = document.getElementById('igRtBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Menyusun...'; }
    let tersimpan = 0, gagal = 0, errMsg = '', functionLama = false;
    try {
        const arahan = String((document.getElementById('igRtArahan') || {}).value || '').trim().slice(0, 800);
        igRtStatus('Membaca program dan riwayat tema...');
        const konteksProgram = await buildIgPlanProgramContext(0, 0, null, true);
        const targetSet = new Set(target.map(w => w.senin));

        // Tema yang sudah terpakai / dipertahankan (WAJIB dihindari AI): isi harian nyata + rencana yang tidak ditimpa.
        const dipertahankan = igRkData.bulan.flatMap(b => b.minggu).filter(w =>
            !targetSet.has(w.senin) && (w.status === 'disusun' || w.status === 'rencana') && w.tema);
        // Riwayat BERTANGGAL supaya tahun ke-2 dan seterusnya tidak memblokir semua tema lama selamanya:
        // tema biasa memblokir dalam 365 hari dari pekan yang dicek, tema musiman 300 hari (IG_JEDA_TEMA_MUSIM_HARI),
        // supaya musim yang sama bisa kembali tiap tahun. tgl '' = selalu berlaku (riwayat awal & usulan AI yang ditolak).
        const riwayatList = []; // [{ tema, tgl }]
        const tambahRiwayat = (tema, tgl) => { if (tema) riwayatList.push({ tema, tgl: tgl || '' }); };
        dipertahankan.forEach(w => tambahRiwayat(w.tema, w.senin));
        igContentPlan.filter(pl => pl.tema_minggu).forEach(pl => tambahRiwayat(pl.tema_minggu, pl.tanggal));
        // Riwayat topik awal yang masih dalam jeda 6 bulan pada pekan pertama target: jangan diulang, dan tema alur yang
        // dipetakan ke sana dikeluarkan dari bank alur (lihat IG_RIWAYAT_AWAL).
        const senins = target.map(w => w.senin).sort();
        const seninAwal = senins[0], seninAkhir = senins[senins.length - 1];
        const awalAktif = igRiwayatAwalAktif(seninAwal);
        awalAktif.forEach(r => tambahRiwayat(r.tema, ''));
        const alurTerblokir = new Set(awalAktif.flatMap(r => r.alur || []));
        const diterima = []; // [{ senin, tema }] hasil yang lolos selama proses ini
        const hariAntara = (a, b) => Math.abs(igRkParseKey(a) - igRkParseKey(b)) / 864e5;
        const jedaHari = (t1, t2) => (igTemaMusiman(t1) || igTemaMusiman(t2)) ? IG_JEDA_TEMA_MUSIM_HARI : 365;
        // Apakah riwayat r memblokir tema baru `tema` yang akan tayang di pekan `senin`?
        const memblokir = (r, tema, senin) => !r.tgl || hariAntara(r.tgl, senin) <= jedaHari(r.tema, tema);
        const cekMirip = (tema, senin) => {
            const t = igTokenSet(tema);
            return riwayatList.some(r => memblokir(r, tema, senin) && igIsSimilarText(t, igTokenSet(r.tema)))
                || diterima.some(x => memblokir({ tema: x.tema, tgl: x.senin }, tema, senin) && igIsSimilarText(t, igTokenSet(x.tema)));
        };
        // Teks riwayat untuk AI: hanya yang masih relevan terhadap rentang pekan target (bukan seluruh sejarah).
        const jarakKeRentang = tgl => tgl < seninAwal ? hariAntara(tgl, seninAwal) : (tgl > seninAkhir ? hariAntara(tgl, seninAkhir) : 0);
        const semuaTerpakai = () => {
            const set = new Set();
            riwayatList.forEach(r => { if (!r.tgl || jarakKeRentang(r.tgl) <= jedaHari(r.tema, r.tema)) set.add(r.tema); });
            diterima.forEach(x => set.add(x.tema));
            return [...set];
        };

        // JEDA PEKAN MUSIMAN: tema musiman biasa tidak boleh menempel dengan pekan musiman lain (hari besar dikecualikan).
        // Tetangga = pekan 7 hari sebelum/sesudah yang sudah punya tema (dipertahankan atau sudah diterima di proses ini).
        const temaTetanggaMusim = senin => [...dipertahankan.map(w => ({ senin: w.senin, tema: w.tema })), ...diterima]
            .filter(x => Math.abs(hariAntara(x.senin, senin) - 7) < 0.5).map(x => x.tema);
        const jedaDitolak = new Set(); // senin yang ditolak karena jeda (bukan karena mirip): temanya TIDAK boleh masuk riwayat

        const infoPekan = w => {
            const kamis = igRkParseKey(w.senin); kamis.setDate(kamis.getDate() + 3);
            const hm = igHijriMonth(kamis);
            return {
                senin: w.senin, minggu: w.minggu,
                hijri: hm ? IG_NAMA_HIJRI[hm - 1] : '', masehi: IG_NAMA_BULAN[kamis.getMonth()],
                peristiwa: igPeristiwaPekan(w.senin),
                program: w.program.map(x => `${x.nama} (berangkat ${x.tgl}, fase ${x.f.label})`).join('; ')
            };
        };

        const batches = [];
        for (let i = 0; i < target.length; i += IG_RT_BATCH) batches.push(target.slice(i, i + IG_RT_BATCH));

        for (let bi = 0; bi < batches.length; bi++) {
            let sisa = batches[bi];
            const lolosBatch = [];
            for (let putaran = 0; putaran <= IG_RT_MAX_ULANG && sisa.length; putaran++) {
                igRtStatus(`Menyusun tema (${bi + 1}/${batches.length})${putaran ? `, mengulang ${sisa.length} pekan yang mirip` : ''}...`);
                const sekitar = [...dipertahankan.map(w => ({ senin: w.senin, tema: w.tema })), ...diterima]
                    .sort((a, b) => a.senin.localeCompare(b.senin)).map(x => `${x.senin} | ${x.tema}`).join('\n');
                const wajibAlur = sisa.filter(w => jedaDitolak.has(w.senin)).map(w => w.senin);
                const arahanPutaran = wajibAlur.length
                    ? `Pekan berikut WAJIB bertema alur (bukan musiman atau penjualan) karena pekan di sebelahnya sudah musiman: ${wajibAlur.join(', ')}.${arahan ? '\n' + arahan : ''}`.slice(0, 800)
                    : arahan;
                const data = await igRtPanggilAI({
                    pekan: sisa.map(infoPekan),
                    konteksProgram,
                    riwayatTema: semuaTerpakai().join('\n'),
                    konteksSekitar: sekitar,
                    bankAlurGrup: igRtBankAlurGrup(alurTerblokir),
                    bankAlur: IG_TEMA_ALUR.filter(a => !alurTerblokir.has(a)), // cadangan untuk function lama yang belum di-deploy ulang
                    bankMusim: igRtBahanMusim(),
                    arahan: arahanPutaran
                });
                if (data.versi < 2) functionLama = true;
                const sisaSet = new Set(sisa.map(w => w.senin));
                (data.items || []).forEach(it => {
                    if (!sisaSet.has(it.senin) || !it.tema) return;
                    if (cekMirip(it.tema, it.senin)) return; // mirip tema lain: pekan ini diulang di putaran berikutnya
                    if (igPerluJedaMusim(it.tema, temaTetanggaMusim(it.senin))) { jedaDitolak.add(it.senin); return; } // jeda pekan musiman
                    jedaDitolak.delete(it.senin);
                    diterima.push({ senin: it.senin, tema: it.tema });
                    lolosBatch.push(it);
                });
                const lolosSet = new Set(lolosBatch.map(x => x.senin));
                sisa = sisa.filter(w => !lolosSet.has(w.senin));
                // Tema yang ditolak karena mirip ikut masuk riwayat putaran berikutnya supaya tidak diajukan lagi.
                (data.items || []).filter(it => it.tema && !lolosSet.has(it.senin) && !jedaDitolak.has(it.senin)).forEach(it => tambahRiwayat(it.tema, ''));
            }
            gagal += sisa.length;

            if (lolosBatch.length) {
                igRtStatus(`Menyimpan ${lolosBatch.length} pekan...`);
                const rows = lolosBatch.map(it => ({
                    senin: it.senin, tema: it.tema, alasan: it.alasan || null,
                    fokus_program: it.fokus_program || null, sumber: 'ai', terkunci: false
                }));
                const { error } = await supabaseClient.from('ig_rencana_tahunan').upsert(rows, { onConflict: 'senin' });
                if (error) throw error;
                tersimpan += rows.length;
                await loadIgRencanaTahun();
                igRkRender();
            }
        }
    } catch (e) {
        console.error('igRtSusunAI error:', e);
        errMsg = e.message || String(e);
    } finally {
        igRtBusy = false;
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-stars"></i> Susun dengan AI'; }
    }

    await loadIgRencanaTahun();
    igRkRender();
    igRtRenderPanel();
    if (errMsg) {
        igRtStatus(tersimpan ? `Berhenti di tengah jalan: ${tersimpan} pekan sudah tersimpan. ${errMsg}` : errMsg, true);
        showToast('Rencana setahun gagal sebagian: ' + errMsg, 'error');
    } else if (gagal) {
        igRtStatus(`${tersimpan} pekan tersimpan. ${gagal} pekan belum terisi (tema yang diusulkan AI mirip tema lain atau menempel dengan pekan musiman lain); klik Susun dengan AI lagi untuk mencoba pekan itu.`);
        showToast(`${tersimpan} pekan disimpan, ${gagal} pekan belum terisi`, 'info');
    } else {
        igRtStatus(`Selesai: ${tersimpan} pekan tersimpan. Periksa temanya, edit yang kurang pas (otomatis terkunci).`
            + (functionLama ? ' Catatan: function generate-ig-year-plan masih versi lama, komposisi antarfase belum aktif. Deploy ulang function-nya.' : ''));
        showToast(`Rencana setahun tersimpan (${tersimpan} pekan)`);
    }
}

window.igRtTogglePanel = igRtTogglePanel;
window.igRtSusunAI = igRtSusunAI;
window.igRtRenderPanel = igRtRenderPanel;
window.igRtEdit = igRtEdit;
window.igRtBatalEdit = igRtBatalEdit;
window.igRtKey = igRtKey;
window.igRtSimpanEdit = igRtSimpanEdit;
window.igRtKunci = igRtKunci;
window.igRtHapus = igRtHapus;

// ---- Balik ke form generate (dipakai tombol "Generate Ulang") ----
function showIgPlanGenerateForm() {
    igPlanResultRange = null; // daftar hasil kembali ke tampilan per bulan
    const genWrap = document.getElementById('igPlanGenerateWrap');
    const resultWrap = document.getElementById('igPlanResultWrap');
    if (genWrap) genWrap.style.display = 'block';
    if (resultWrap) resultWrap.style.display = 'none';
    igRefreshPlanPreview();
}

// Label pilar untuk tampilan modal Perencanaan Konten (mengikuti istilah Pola Amiru; warna dari IG_PILLARS)
const IG_POLA_LABEL = { testimoni: 'Bukti Sosial', promo: 'Info Program' };
function igPolaPilarLabel(pilar) {
    return IG_POLA_LABEL[pilar] || (IG_PILLARS[pilar] && IG_PILLARS[pilar].label) || pilar;
}

// ---- Strip pola 7 hari (Senin-Minggu) di atas form, dibaca langsung dari IG_POLA_AMIRU ----
function renderIgPlanPolaStrip() {
    const el = document.getElementById('igPlanPolaStrip');
    if (!el) return;
    el.innerHTML = IG_URUTAN_PEKAN.map(dow => {
        const p = IG_POLA_AMIRU[dow];
        const color = (IG_PILLARS[p.pilar] && IG_PILLARS[p.pilar].color) || 'var(--brand)';
        const ikon = p.tipe === 'carousel' ? 'bi-images' : 'bi-image';
        const tip = `${p.hari} (${p.urutan}/7): ${p.peran} · ${igPolaPilarLabel(p.pilar)} · ${p.tipe === 'carousel' ? 'carousel maks 5 slide' : 'single post'}`;
        return `<div class="ig-plan-pola-chip" style="--pillar:${color}" title="${escapeHtmlAttr(tip)}">
            <b>${p.hari.slice(0, 3)}</b>
            <span>${escapeHtml(p.peran)}</span>
            <small>${escapeHtml(igPolaPilarLabel(p.pilar))}</small>
            <i class="bi ${ikon}"></i>
        </div>`;
    }).join('');
}

// ---- Isi pilihan pekan (Senin-Minggu) untuk bulan yang dipilih; default = pekan pertama yang masih punya hari kosong ----
function igRenderPlanWeekOptions() {
    const monthVal = document.getElementById('igPlanMonth')?.value;
    const sel = document.getElementById('igPlanWeek');
    if (!monthVal || !sel) return;
    const [y, m] = monthVal.split('-').map(Number);
    const hariIni = igLocalDateKey(new Date());
    const terisi = igTanggalTerisiSet();
    const sebelumnya = sel.value;
    const daftar = igDaftarPekanBulan(y, m - 1).map(pk => ({ ...pk, kosong: igBuildSlotPekan(pk.senin, terisi, hariIni).length }));
    sel.innerHTML = daftar.map(pk => {
        const ket = pk.minggu < hariIni ? ' (sudah lewat)' : pk.kosong === 0 ? ' (sudah terisi)' : '';
        return `<option value="${pk.senin}">${escapeHtml(pk.label + ket)}</option>`;
    }).join('');
    const pilih = daftar.find(pk => pk.senin === sebelumnya) || daftar.find(pk => pk.kosong > 0) || daftar[0];
    if (pilih) sel.value = pilih.senin;
    igRefreshPlanPreview();
}

// ---- Pratinjau: hari kosong di pekan terpilih yang akan diisi ----
function igRefreshPlanPreview() {
    const el = document.getElementById('igPlanPreview');
    if (!el) return;
    igPerbaruiSaranTema();
    const senin = document.getElementById('igPlanWeek')?.value;
    if (!senin) { el.textContent = ''; return; }
    const slots = igBuildSlotPekan(senin, igTanggalTerisiSet(), igLocalDateKey(new Date()), (document.getElementById('igPlanTema')?.value || '').trim());
    if (!slots.length) {
        el.innerHTML = '<i class="bi bi-info-circle"></i> Tidak ada hari kosong di pekan ini (sudah lewat atau sudah terisi semua).';
        return;
    }
    const carousel = slots.filter(s => s.tipe_konten === 'carousel').length;
    const varian = slots.filter(s => s.catatan).length;
    el.innerHTML = `<i class="bi bi-calendar-check"></i> <strong>${slots.length}</strong> ide akan dibuat: ` +
        `${slots.map(s => s.hari.slice(0, 3)).join(', ')} (${slots.length - carousel} image · ${carousel} carousel)` +
        (varian ? ` · pola pekan khusus: ${slots.filter(s => s.catatan).map(s => s.hari.slice(0, 3) + ' ' + s.peran).join(', ')}` : '');
}

// ============================================================
// TEMA MINGGU OTOMATIS (saran tema supaya setahun penuh relevan & harmonis)
// Tiga sumber, dalam urutan prioritas:
//  1. Pekan itu sudah punya tema (generate sebagian) -> tema itu dipertahankan.
//  2. TEMA MUSIMAN menurut bulan Hijriah/Masehi pekan itu (Maulid, Isra Miraj, Ramadhan, musim haji, libur sekolah, dst).
//     Tema musiman yang mengarah ke penjualan sengaja tayang 2-3 bulan SEBELUM musimnya (lihat IG_TEMA_MUSIM).
//  3. ALUR PERJALANAN JAMAAH (niat > persiapan > ihram > thawaf > sa'i > Madinah > pulang) yang dilanjutkan
//     dari tema alur terakhir yang dipakai, jadi pekan ke pekan terasa satu cerita.
// Tema yang sudah dipakai dalam +-365 hari (semua status) dilewati, jadi tidak ada pengulangan dalam setahun.
// Seluruhnya dihitung lokal (tanpa AI), jadi tetap jalan walau token AI habis.
// ============================================================
// Bank tema alur perjalanan jamaah, DIKELOMPOKKAN per fase supaya rotasi tayang seimbang setahun penuh
// (lihat igKandidatTemaMinggu). `bobot` = jatah relatif tiap fase dalam jendela IG_ALUR_JENDELA pekan terakhir;
// ubah angkanya untuk mengatur komposisi (mis. calon jamaah baru lebih banyak = naikkan `siap`). Urutan tema DI DALAM
// satu fase tetap berurutan (menyambung dari tema terakhir fase itu). Menambah tema: taruh di fase yang cocok.
const IG_ALUR_GRUP = [
    { id: 'siap', label: 'Sebelum berangkat', bobot: 3, tema: [
        'Niat dan Panggilan', 'Umroh Pertama Kali', 'Restu dan Doa Keluarga', 'Menabung Niat', 'Memilih Waktu yang Tepat untuk Berangkat',
        'Dokumen dan Administrasi', 'Menyelesaikan Urusan Sebelum Berangkat', 'Anggaran dan Keuangan Perjalanan', 'Persiapan Fisik',
        'Menjaga Kesehatan', 'Perlengkapan Perjalanan', 'Cuaca dan Pakaian di Tanah Suci', 'Mengenal Rombongan dan Pembimbing',
        'Kesiapan Hati dan Kesabaran', 'Pamit pada Keluarga dan Rumah', 'Belajar Manasik',
        'Mengatasi Rasa Takut Sebelum Berangkat', 'Menyiapkan Mental untuk Antrean dan Menunggu', 'Membiasakan Jalan Kaki Jauh', 'Menulis Daftar Doa Sebelum Berangkat',
        'Memaafkan dan Meminta Maaf Sebelum Pergi', 'Obat dan Perlengkapan Kesehatan Pribadi', 'Mengatur Barang Bawaan di Koper', 'Hari Keberangkatan dan Suasana Bandara'
    ] },
    { id: 'makkah', label: 'Ibadah di Makkah', bobot: 3, tema: [
        'Miqat dan Ihram', 'Larangan Ihram', 'Talbiyah', 'Tiba di Tanah Suci', 'Sejarah Makkah dan Kabah', 'Pertama Melihat Kabah',
        'Thawaf', 'Multazam dan Doa', 'Maqam Ibrahim', 'Air Zamzam', 'Sa\'i dan Siti Hajar', 'Tahallul', 'Adab di Masjidil Haram',
        'Shalat di Tanah Suci', 'Sabar di Keramaian', 'Ikhlas dalam Ibadah', 'Menjaga Akhlak di Perjalanan', 'Kebersamaan Rombongan',
        'Bertemu Jamaah dari Berbagai Negara', 'Menjaga Stamina Selama di Tanah Suci', 'Istirahat yang Cukup di Sela Ibadah',
        'Makanan dan Kebiasaan Makan di Tanah Suci', 'Mengabadikan Momen dengan Bijak', 'Berkabar dengan Keluarga di Rumah',
        'Mengisi Waktu di Tanah Suci', 'Ziarah di Makkah',
        'Malam Pertama di Makkah', 'Subuh di Masjidil Haram', 'Hajar Aswad dan Rukun Yamani', 'Berdoa di Tengah Keramaian',
        'Kaki Pegal dan Hati yang Tetap Kuat', 'Menjaga Wudhu dan Kebersihan', 'Dzikir dan Tilawah di Tanah Suci', 'Menjaga Lisan dan Pandangan',
        'Rendah Hati di Tanah Suci', 'Tawakal dan Menyerahkan Urusan'
    ] },
    { id: 'madinah', label: 'Madinah', bobot: 2, tema: [
        'Perjalanan ke Madinah', 'Masjid Nabawi', 'Raudhah', 'Ziarah di Madinah', 'Doa Titipan', 'Doa untuk Diri Sendiri',
        'Sedekah dan Berbagi',
        'Suasana Malam di Madinah', 'Antre Shalat Berjamaah di Madinah', 'Sejarah Hijrah ke Madinah', 'Masjid Quba',
        'Adab Berziarah ke Makam Rasulullah', 'Mengenal Jabal Uhud dan Perjuangan Para Sahabat', 'Masjid Qiblatain dan Perpindahan Kiblat',
        'Meneladani Akhlak Rasulullah', 'Menjaga Stamina di Madinah', 'Pasar Kurma dan Oleh-oleh Madinah',
        'Ketenangan Hati di Kota Nabi', 'Bersiap Meninggalkan Madinah'
    ] },
    { id: 'bersama', label: 'Umroh bersama siapa', bobot: 2, tema: [
        'Umroh Bersama Orang Tua', 'Umroh Bersama Pasangan', 'Umroh Bersama Keluarga', 'Umroh Bersama Anak', 'Umroh Bersama Sahabat',
        'Umroh untuk Lansia',
        'Umroh Sendirian', 'Umroh Bersama Saudara', 'Umroh dengan Kursi Roda dan Pendamping',
        'Umroh Bersama Ibu', 'Umroh Bersama Mertua', 'Umroh untuk Pengantin Baru', 'Umroh Setelah Pensiun',
        'Mengajak Remaja Mengenal Tanah Suci', 'Umroh Bersama Teman Pengajian', 'Umroh sebagai Hadiah untuk Orang Tercinta',
        'Umroh Rombongan Kecil yang Akrab'
    ] },
    { id: 'pulang', label: 'Pulang dan sesudahnya', bobot: 2, tema: [
        'Thawaf Wada', 'Hari Terakhir di Makkah', 'Pulang dan Oleh-oleh Hati', 'Bersyukur atas Kesempatan', 'Menjaga Kemabruran',
        'Membawa Pulang Kebiasaan Baik', 'Kembali ke Rutinitas dengan Hati Baru', 'Rindu Tanah Suci', 'Berbagi Cerita Setelah Pulang',
        'Menularkan Semangat Umroh ke Keluarga',
        'Janji pada Diri Sendiri Setelah Pulang', 'Menjaga Shalat Berjamaah Setelah Pulang', 'Menjaga Silaturahmi dengan Rombongan', 'Merencanakan Kembali ke Tanah Suci', 'Syukur Sederhana di Rumah'
    ] }
];
// Daftar rata (urutan sama seperti sebelum dikelompokkan): dipakai tes, Rencana Setahun AI, dan pencocokan riwayat.
const IG_TEMA_ALUR = IG_ALUR_GRUP.flatMap(g => g.tema);
// Jumlah pekan terakhir (khusus tema alur, tema musiman tidak dihitung) yang dipakai untuk menakar jatah tiap fase.
const IG_ALUR_JENDELA = 8;
// Indeks fase (di IG_ALUR_GRUP) dari sebuah tema; -1 kalau bukan tema alur (mis. tema musiman atau ketikan sendiri).
function igAlurGrupIdx(tema) {
    const s = String(tema || '').trim().toLowerCase();
    if (!s) return -1;
    const persis = IG_ALUR_GRUP.findIndex(g => g.tema.some(a => a.toLowerCase() === s));
    if (persis >= 0) return persis;
    return IG_ALUR_GRUP.findIndex(g => g.tema.some(a => igIsSimilarText(a, tema)));
}
// Jenis tema untuk panel Kesehatan Rencana: PRAKTIS = tata cara, persiapan, perlengkapan, logistik (sisi akal);
// selain itu tema alur dihitung HATI (kisah, rasa, renungan). Tema musiman: yang `jual:true` dihitung praktis
// (merencanakan waktu dan dana), sisanya hati. Ketikan sendiri yang tidak dikenal = 'lain' (tidak dihitung).
// Hanya untuk laporan, tidak memengaruhi pemilihan tema. Menambah tema praktis: tulis namanya persis seperti di IG_ALUR_GRUP.
const IG_TEMA_PRAKTIS = new Set([
    'Memilih Waktu yang Tepat untuk Berangkat', 'Dokumen dan Administrasi', 'Menyelesaikan Urusan Sebelum Berangkat', 'Anggaran dan Keuangan Perjalanan',
    'Menabung Niat', 'Persiapan Fisik', 'Menjaga Kesehatan', 'Perlengkapan Perjalanan', 'Cuaca dan Pakaian di Tanah Suci', 'Mengenal Rombongan dan Pembimbing',
    'Belajar Manasik', 'Membiasakan Jalan Kaki Jauh', 'Obat dan Perlengkapan Kesehatan Pribadi', 'Mengatur Barang Bawaan di Koper', 'Hari Keberangkatan dan Suasana Bandara',
    'Miqat dan Ihram', 'Larangan Ihram', 'Talbiyah', 'Tiba di Tanah Suci', 'Thawaf', 'Air Zamzam', 'Hajar Aswad dan Rukun Yamani', 'Tahallul', 'Adab di Masjidil Haram',
    'Menjaga Stamina Selama di Tanah Suci', 'Istirahat yang Cukup di Sela Ibadah', 'Makanan dan Kebiasaan Makan di Tanah Suci', 'Mengabadikan Momen dengan Bijak',
    'Berkabar dengan Keluarga di Rumah', 'Mengisi Waktu di Tanah Suci', 'Ziarah di Makkah', 'Menjaga Wudhu dan Kebersihan',
    'Perjalanan ke Madinah', 'Ziarah di Madinah', 'Adab Berziarah ke Makam Rasulullah', 'Menjaga Stamina di Madinah', 'Pasar Kurma dan Oleh-oleh Madinah', 'Bersiap Meninggalkan Madinah',
    'Umroh Bersama Anak', 'Umroh untuk Lansia', 'Umroh dengan Kursi Roda dan Pendamping', 'Umroh Setelah Pensiun',
    'Thawaf Wada', 'Merencanakan Kembali ke Tanah Suci'
].map(t => t.toLowerCase()));
function igJenisTema(tema) {
    const s = String(tema || '').trim().toLowerCase();
    if (!s) return 'lain';
    if (IG_TEMA_PRAKTIS.has(s)) return 'praktis';
    if (igAlurGrupIdx(tema) >= 0) return 'hati';
    if (igTemaMusiman(tema)) {
        const t = igTokenSet(tema);
        const e = IG_TEMA_MUSIM.find(x => igIsSimilarText(t, igTokenSet(x.tema)));
        return e && e.jual ? 'praktis' : 'hati';
    }
    return 'lain';
}
// Batas sehat porsi tema HATI dari seluruh tema alur+musiman yang terklasifikasi (pola-konten.md: 4 hari hati, 3 hari praktis per pekan).
const IG_RASIO_HATI = [0.4, 0.65];
// Fase dianggap hilang kalau tidak tayang selama sekian pekan ke depan (sama dengan aturan di edge function generate-ig-year-plan).
const IG_KES_ABSEN_PEKAN = 12;
// Perkiraan porsi pekan alur (sisanya tema musiman) untuk menakar kebutuhan tema setahun.
const IG_KES_PORSI_ALUR = 0.8;

// Kesehatan Rencana (fungsi murni): minggu = pekan hasil igRkSusun [{ senin, minggu, tema }], hariIni = 'YYYY-MM-DD'.
// Yang dihitung hanya pekan dari hariIni ke depan. Return { pekan, alurN, musimN, lainN, fase[], hati, praktis,
// hatiPersen, rasio: 'seimbang'|'hati-dominan'|'praktis-dominan'|'kosong', catatan[] }.
function igRtKesehatan(minggu, hariIni) {
    const depan = (minggu || []).filter(w => w && w.tema && w.minggu >= hariIni);
    const totalBobot = IG_ALUR_GRUP.reduce((t, g) => t + g.bobot, 0);
    const fase = IG_ALUR_GRUP.map(g => ({ id: g.id, label: g.label, bobot: g.bobot, jumlah: 0, jatah: 0, stok: g.tema.length, perlu: 0, rasioStok: 0, sisa: 0, jedaPertama: null, status: 'ok', tanda: [] }));
    let musimN = 0, lainN = 0, hati = 0, praktis = 0;
    const terpakai = IG_ALUR_GRUP.map(() => new Set());
    depan.forEach((w, k) => {
        const gi = igAlurGrupIdx(w.tema);
        if (gi >= 0) {
            fase[gi].jumlah++;
            if (fase[gi].jedaPertama === null) fase[gi].jedaPertama = k;
            const persis = IG_ALUR_GRUP[gi].tema.find(a => a.toLowerCase() === String(w.tema).trim().toLowerCase());
            if (persis) terpakai[gi].add(persis);
        } else if (igTemaMusiman(w.tema)) musimN++;
        else lainN++;
        const j = igJenisTema(w.tema);
        if (j === 'hati') hati++; else if (j === 'praktis') praktis++;
    });
    const alurN = depan.length - musimN - lainN;
    const porsi = depan.length ? Math.max(0.3, Math.min(1, alurN / depan.length)) : IG_KES_PORSI_ALUR;
    fase.forEach((f, i) => {
        f.jatah = alurN ? Math.round(alurN * f.bobot / totalBobot) : 0;
        f.persen = alurN ? Math.round(f.jumlah / alurN * 100) : 0;
        f.targetPersen = Math.round(f.bobot / totalBobot * 100);
        f.perlu = Math.max(1, Math.ceil(52 * porsi * f.bobot / totalBobot)); // tema unik yang dibutuhkan untuk 12 bulan
        f.rasioStok = Math.round(f.stok / f.perlu * 10) / 10;
        f.sisa = Math.max(0, f.stok - terpakai[i].size);
        // Hanya tandai kalau rentang cukup panjang untuk menilai.
        if (depan.length >= IG_KES_ABSEN_PEKAN) {
            if (f.jumlah === 0 || (f.jedaPertama !== null && f.jedaPertama >= IG_KES_ABSEN_PEKAN)) f.tanda.push('absen');
            else if (f.jatah >= 2 && f.jumlah <= f.jatah - 2) f.tanda.push('kurang-tayang');
            else if (f.jumlah >= f.jatah + 3 && f.jatah > 0) f.tanda.push('berlebih');
        }
        if (f.rasioStok < 1) f.tanda.push('stok-kurang');
        else if (f.rasioStok < 1.5) f.tanda.push('stok-menipis');
    });
    const terklasifikasi = hati + praktis;
    const hatiPersen = terklasifikasi ? Math.round(hati / terklasifikasi * 100) : 0;
    let rasio = 'kosong';
    if (terklasifikasi >= 6) {
        const p = hati / terklasifikasi;
        rasio = p < IG_RASIO_HATI[0] ? 'praktis-dominan' : (p > IG_RASIO_HATI[1] ? 'hati-dominan' : 'seimbang');
    } else if (terklasifikasi) rasio = 'sedikit';
    const catatan = [];
    fase.forEach(f => {
        if (f.tanda.includes('absen')) catatan.push(`Fase "${f.label}" tidak tayang dalam ${IG_KES_ABSEN_PEKAN} pekan ke depan.`);
        if (f.tanda.includes('kurang-tayang')) catatan.push(`Fase "${f.label}" baru ${f.jumlah} pekan, jatahnya sekitar ${f.jatah}.`);
        if (f.tanda.includes('berlebih')) catatan.push(`Fase "${f.label}" ${f.jumlah} pekan, melebihi jatah sekitar ${f.jatah}.`);
        if (f.tanda.includes('stok-kurang')) catatan.push(`Tema fase "${f.label}" kurang: ${f.stok} tema untuk sekitar ${f.perlu} pekan per tahun. Tambahkan di IG_ALUR_GRUP.`);
        else if (f.tanda.includes('stok-menipis')) catatan.push(`Tema fase "${f.label}" mulai menipis: ${f.stok} tema untuk sekitar ${f.perlu} pekan per tahun.`);
    });
    if (rasio === 'hati-dominan') catatan.push(`Tema hati ${hatiPersen}% (batas sehat ${Math.round(IG_RASIO_HATI[0] * 100)}-${Math.round(IG_RASIO_HATI[1] * 100)}%): tambah tema praktis.`);
    if (rasio === 'praktis-dominan') catatan.push(`Tema praktis ${100 - hatiPersen}%, tema hati hanya ${hatiPersen}% (batas sehat ${Math.round(IG_RASIO_HATI[0] * 100)}-${Math.round(IG_RASIO_HATI[1] * 100)}%): tambah tema hati.`);
    if (musimN + lainN > 0 && alurN > 0 && musimN / depan.length > 0.4) catatan.push(`Tema musiman ${musimN} dari ${depan.length} pekan: terlalu padat, alur perjalanan jamaah terpotong.`);
    return { pekan: depan.length, alurN, musimN, lainN, fase, hati, praktis, hatiPersen, rasio, catatan };
}

// Riwayat topik awal (sebelum pola mingguan dimulai 12 Okt 2026): SATU sumber data untuk (a) deteksi ide kembar
// (igBuildRiwayat), (b) saran Tema Minggu (igKandidatTemaMinggu), dan (c) Rencana Setahun AI (igRtSusunAI).
// Jeda 6 bulan (IG_JEDA_TOPIK_BULAN) dari tgl ini = tidak diulang sebelum 12 April 2027 (tgl sengaja 11 Okt supaya
// 12 April 2027 sudah boleh). `alur` = nama tema di IG_TEMA_ALUR yang dianggap SAMA dengan topik itu (pemetaan eksplisit,
// bukan kemiripan kata, supaya mis. "Umroh Pertama Kali" tidak ikut terblokir oleh "Pertama kali lihat Ka'bah").
// Daftar yang sama masih tertulis di prompt (server & IG_PLAN_PROMPT_SISTEM), About Planner, dan pola-konten.md:
// kalau menambah topik di sini, perbarui salinan teks itu juga.
const IG_RIWAYAT_AWAL = [
    { tema: 'Niat umroh', tgl: '2026-10-11', alur: ['Niat dan Panggilan'] },
    { tema: 'Pertama kali lihat Ka\'bah', tgl: '2026-10-11', alur: ['Pertama Melihat Kabah'] },
    { tema: 'Sa\'i dan kisah Siti Hajar', tgl: '2026-10-11', alur: ['Sa\'i dan Siti Hajar'] },
    { tema: 'Raudhah', tgl: '2026-10-11', alur: ['Raudhah'] },
    { tema: 'Subuh di Madinah', tgl: '2026-10-11' },
    { tema: 'Bawaan yang sering ketinggalan', tgl: '2026-10-11' },
    { tema: 'Kesalahan umum thawaf', tgl: '2026-10-11' },
    { tema: 'Urutan umroh (ihram, thawaf, sa\'i, tahallul)', tgl: '2026-10-11' },
    { tema: 'Larangan ihram', tgl: '2026-10-11', alur: ['Larangan Ihram'] },
    { tema: 'Persiapan fisik', tgl: '2026-10-11', alur: ['Persiapan Fisik'] },
    { tema: 'Hari terakhir di Makkah', tgl: '2026-10-11', alur: ['Hari Terakhir di Makkah'] },
    { tema: 'Makkah atau Madinah', tgl: '2026-10-11' },
    { tema: 'Umroh bersama orang tua', tgl: '2026-10-11', alur: ['Umroh Bersama Orang Tua'] },
    { tema: 'Mulai dari yang kecil / menabung niat', tgl: '2026-10-11', alur: ['Menabung Niat'] }
];
// Entri riwayat awal yang masih memblokir untuk tanggal acuan refKey (jendela jeda topik yang sama dengan riwayat lain).
function igRiwayatAwalAktif(refKey) {
    const batas = igBatasRiwayat(refKey);
    return IG_RIWAYAT_AWAL.filter(r => r.tgl >= batas);
}

// Tema musiman. Tiap entri: tema, hijri (nomor bulan Hijriah 1 Muharram ... 12 Dzulhijjah) dan/atau masehi (nomor bulan
// Masehi) = bulan TAYANG-nya. jual:true = tema yang mengarah ke penjualan: sengaja ditayangkan 2-3 bulan SEBELUM
// musimnya karena calon jamaah memesan jauh hari, dan didahulukan atas tema musiman biasa. Tanpa `alasan` -> "Musim <bulan>".
// Mau menambah/mengubah musim? Cukup edit daftar ini (tidak ada logika lain yang perlu disentuh).
const IG_TEMA_MUSIM = [
    { tema: 'Rencanakan Umroh di Bulan Ramadhan', hijri: [6, 7], jual: true, alasan: 'Jelang Ramadhan: calon jamaah memesan 2-3 bulan sebelumnya' },
    { tema: 'Umroh di Libur Sekolah', masehi: [4, 5], jual: true, alasan: 'Jelang libur sekolah (Juni-Juli): keluarga memesan 2-3 bulan sebelumnya' },
    { tema: 'Umroh di Libur Akhir Tahun', masehi: [9, 10], jual: true, alasan: 'Jelang libur akhir tahun: keluarga memesan 2-3 bulan sebelumnya' },
    { tema: 'Bersiap Menyambut Musim Haji', hijri: [10, 11], jual: true, alasan: 'Jelang musim haji: dibahas lebih awal supaya calon jamaah sempat bersiap' },
    // hijriRentang: [bulan, tanggalDari, tanggalSampai] = tema HARI BESAR yang hanya boleh tayang di pekan (Senin-Minggu)
    // yang salah satu harinya jatuh pada tanggal Hijriah itu. Dulu cukup cocok bulan Hijriahnya, akibatnya mis. Isra Miraj
    // (27 Rajab) tayang sampai 4 pekan terlalu awal dan "Sepuluh Malam Terakhir" tayang di pekan ke-2 Ramadhan.
    // `peristiwa` = nama peristiwa untuk label dan untuk AI Rencana Setahun.
    { tema: 'Hijrah dan Awal Tahun Baru', hijriRentang: [1, 1, 1], peristiwa: '1 Muharram (tahun baru Hijriah)', alasan: 'Pekan 1 Muharram, tahun baru Hijriah' },
    { tema: 'Cinta Rasulullah dan Rindu Madinah', hijriRentang: [3, 12, 12], peristiwa: '12 Rabiul Awal (Maulid Nabi)', alasan: 'Pekan 12 Rabiul Awal, Maulid Nabi' },
    { tema: 'Isra Miraj dan Makna Shalat', hijriRentang: [7, 27, 27], peristiwa: '27 Rajab (Isra Miraj)', alasan: 'Pekan 27 Rajab, Isra Miraj' },
    { tema: 'Menyambut Ramadhan', hijri: [8] },
    { tema: 'Ramadhan dan Rindu Tanah Suci', hijri: [9] },
    { tema: 'Sepuluh Malam Terakhir Ramadhan', hijriRentang: [9, 21, 30], peristiwa: '21-30 Ramadhan (sepuluh malam terakhir)', alasan: 'Pekan sepuluh malam terakhir Ramadhan' },
    { tema: 'Menjaga Semangat Setelah Ramadhan', hijri: [10] },
    { tema: 'Rindu Berhaji dan Makna Kurban', hijriRentang: [12, 9, 10], peristiwa: '9-10 Dzulhijjah (Arafah dan Idul Adha)', alasan: 'Pekan Arafah dan Idul Adha' }
];
const IG_NAMA_HIJRI = ['Muharram', 'Safar', 'Rabiul Awal', 'Rabiul Akhir', 'Jumadil Awal', 'Jumadil Akhir', 'Rajab', 'Sya\'ban', 'Ramadhan', 'Syawal', 'Dzulqa\'dah', 'Dzulhijjah'];

// Nomor bulan Hijriah (1-12) dari sebuah tanggal; 0 kalau browser tidak mendukung kalender Hijriah.
function igHijriMonth(date) {
    try {
        const part = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { month: 'numeric' })
            .formatToParts(date).find(p => p.type === 'month');
        const v = parseInt(part && part.value, 10);
        return v >= 1 && v <= 12 ? v : 0;
    } catch (e) { return 0; }
}

// Bulan + tanggal Hijriah (kalender Umm al-Qura bawaan browser) dari sebuah tanggal; null kalau tidak didukung.
function igHijriParts(date) {
    try {
        const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { month: 'numeric', day: 'numeric' }).formatToParts(date);
        const m = parseInt((parts.find(p => p.type === 'month') || {}).value, 10);
        const d = parseInt((parts.find(p => p.type === 'day') || {}).value, 10);
        return m >= 1 && m <= 12 && d >= 1 && d <= 30 ? { m, d } : null;
    } catch (e) { return null; }
}
// Tujuh tanggal Hijriah pekan yang dimulai Senin (y, m 1-12, d). Kosong kalau browser tidak mendukung kalender Hijriah.
function igHariHijriPekan(y, m, d) {
    const out = [];
    for (let i = 0; i < 7; i++) { const h = igHijriParts(new Date(y, m - 1, d + i)); if (h) out.push(h); }
    return out;
}
// Apakah peristiwa e (entri IG_TEMA_MUSIM ber-hijriRentang) jatuh di salah satu hari pekan ini?
function igPeristiwaCocok(e, hariH) {
    return !!e.hijriRentang && hariH.some(h => h.m === e.hijriRentang[0] && h.d >= e.hijriRentang[1] && h.d <= e.hijriRentang[2]);
}
// Peristiwa hari besar yang jatuh di pekan seninKey, untuk label / konteks AI Rencana Setahun (string kosong kalau tidak ada).
function igPeristiwaPekan(seninKey) {
    const [y, m, d] = String(seninKey).split('-').map(Number);
    const hariH = igHariHijriPekan(y, m, d);
    return IG_TEMA_MUSIM.filter(e => igPeristiwaCocok(e, hariH)).map(e => e.peristiwa).join('; ');
}

// Jeda khusus tema musiman (hari). Lebih pendek dari 365 supaya musim yang sama bisa kembali tiap tahun (lihat igKandidatTemaMinggu).
const IG_JEDA_TEMA_MUSIM_HARI = 300;
// Apakah sebuah tema bersifat musiman? Cocok dengan bank IG_TEMA_MUSIM, atau memuat kata musim/hari besar
// (supaya tema musiman buatan AI yang kalimatnya beda dari bank tetap boleh kembali tiap tahun).
const IG_KATA_MUSIM = /ramadhan|ramadan|haji|kurban|qurban|libur|isra|miraj|muharram|maulid|syawal|lebaran|idul/i;
function igTemaMusiman(tema) {
    const s = String(tema || '');
    if (IG_KATA_MUSIM.test(s)) return true;
    const t = igTokenSet(s);
    return IG_TEMA_MUSIM.some(e => igIsSimilarText(t, igTokenSet(e.tema)));
}

// Apakah tema ini tema HARI BESAR (entri IG_TEMA_MUSIM ber-hijriRentang)? Tema hari besar waktunya tidak bisa digeser,
// jadi tidak pernah ditunda oleh jeda pekan musiman.
function igTemaHariBesar(tema) {
    const t = igTokenSet(String(tema || ''));
    return IG_TEMA_MUSIM.some(e => e.hijriRentang && igIsSimilarText(t, igTokenSet(e.tema)));
}
// JEDA PEKAN MUSIMAN: tema musiman biasa (penjualan atau bulan Hijriah, bukan hari besar) tidak dipasang tepat sebelum atau
// sesudah pekan yang sudah bertema musiman, supaya pekan beruntun (mis. 22 dan 23) tidak semuanya jualan atau serba musim.
// Dulu musim yang bulannya bersebelahan bisa menempati pekan berturut-turut. Hari besar dikecualikan (tanggalnya tetap).
// temaTetangga = tema pekan sebelum dan sesudah pekan yang dicek (boleh kosong).
function igPerluJedaMusim(tema, temaTetangga) {
    if (!igTemaMusiman(tema) || igTemaHariBesar(tema)) return false;
    return (temaTetangga || []).some(t => t && igTemaMusiman(t));
}

// Daftar tema yang cocok untuk pekan yang dimulai seninKey, urut dari yang paling disarankan (fungsi murni).
// plans = igContentPlan (butuh kolom tema_minggu). Return [{ tema, alasan, tetap? }], paling banyak `maks`.
function igKandidatTemaMinggu(seninKey, plans, maks, rencana = igRencanaTahun) {
    const [y, m, d] = seninKey.split('-').map(Number);
    const kunci = (selisih) => igLocalDateKey(new Date(y, m - 1, d + selisih));
    const mingguKey = kunci(6);
    const berTema = (plans || []).filter(pl => pl.tanggal && pl.tema_minggu);

    const ada = berTema.filter(pl => pl.tanggal >= seninKey && pl.tanggal <= mingguKey)
        .sort((a, b) => a.tanggal.localeCompare(b.tanggal))[0];
    if (ada) return [{ tema: ada.tema_minggu, alasan: 'Tema yang sudah dipakai di pekan ini', tetap: true }];

    const awal = kunci(-365), akhir = kunci(365);
    // Tema di Rencana Setahun (tersimpan) pada pekan LAIN juga dianggap terpakai, supaya saran tidak mengulangnya.
    const rencanaIni = (rencana || []).find(x => x.senin === seninKey);
    const terpakai = berTema.filter(pl => pl.tanggal >= awal && pl.tanggal <= akhir).map(pl => igTokenSet(pl.tema_minggu))
        .concat((rencana || []).filter(x => x.senin !== seninKey && x.senin >= awal && x.senin <= akhir).map(x => igTokenSet(x.tema)));
    // Topik riwayat awal yang masih dalam jeda 6 bulan: tema alur yang dipetakan ke sana dilewati (lihat IG_RIWAYAT_AWAL).
    const alurTerblokir = new Set(igRiwayatAwalAktif(seninKey).flatMap(r => (r.alur || []).map(a => a.toLowerCase())));
    const sudah = tema => { const t = igTokenSet(tema); return alurTerblokir.has(String(tema).toLowerCase()) || terpakai.some(u => igIsSimilarText(t, u)); };
    // Tema MUSIMAN sengaja memakai jendela lebih pendek (IG_JEDA_TEMA_MUSIM_HARI) daripada 365 hari: musim yang sama
    // kembali tiap ~354 hari (Hijriah) atau 364 hari (pekan yang sama tahun depan), jadi jendela 365 hari akan memblokir
    // tema musiman di tahun berikutnya (bergeser atau hilang). 300 hari tetap mencegah tema musiman muncul dua kali
    // dalam satu musim, tapi mengizinkannya kembali di musim yang sama tahun depan.
    const awalM = kunci(-IG_JEDA_TEMA_MUSIM_HARI), akhirM = kunci(IG_JEDA_TEMA_MUSIM_HARI);
    const terpakaiMusim = berTema.filter(pl => pl.tanggal >= awalM && pl.tanggal <= akhirM).map(pl => igTokenSet(pl.tema_minggu))
        .concat((rencana || []).filter(x => x.senin !== seninKey && x.senin >= awalM && x.senin <= akhirM).map(x => igTokenSet(x.tema)));
    const sudahMusim = tema => { const t = igTokenSet(tema); return terpakaiMusim.some(u => igIsSimilarText(t, u)); };
    const batas = Math.max(1, maks || 6);
    const hasil = [];
    // Tema pekan sebelum/sesudah (dari isi harian atau Rencana Setahun): dasar jeda pekan musiman (igPerluJedaMusim).
    const temaPekanLain = off => {
        const a = kunci(off), b = kunci(off + 6);
        const dr = berTema.find(pl => pl.tanggal >= a && pl.tanggal <= b);
        if (dr) return dr.tema_minggu;
        const rc = (rencana || []).find(x => x.senin === a);
        return rc ? rc.tema : '';
    };
    const temaTetangga = [temaPekanLain(-7), temaPekanLain(7)].filter(Boolean);
    const musimTunda = []; // tema musiman yang ditunda karena jeda; dipakai hanya kalau alur tidak cukup mengisi daftar

    const kamis = new Date(y, m - 1, d + 3); // Kamis = tengah pekan
    const bulanH = igHijriMonth(kamis);
    const bulanM = kamis.getMonth() + 1;
    // Urutan: hari besar yang jatuh PEKAN INI (waktunya sempit, tidak boleh terlewat) > tema penjualan > musiman biasa.
    const hariH = igHariHijriPekan(y, m, d);
    const bobotMusim = e => e.hijriRentang ? 2 : (e.jual ? 1 : 0);
    IG_TEMA_MUSIM
        .filter(e => igPeristiwaCocok(e, hariH) || (bulanH && (e.hijri || []).includes(bulanH)) || (e.masehi || []).includes(bulanM))
        .sort((a, b) => bobotMusim(b) - bobotMusim(a))
        .forEach(e => {
            if (hasil.length < batas && !sudahMusim(e.tema)) {
                const item = { tema: e.tema, alasan: e.alasan || `Musim ${IG_NAMA_HIJRI[bulanH - 1]}`, jual: !!e.jual };
                if (!e.hijriRentang && igPerluJedaMusim(e.tema, temaTetangga)) musimTunda.push(item);
                else hasil.push(item);
            }
        });

    // ALUR SEIMBANG: tema alur dibagi per fase perjalanan jamaah (IG_ALUR_GRUP). Fase yang paling KURANG dari jatahnya
    // (bobot) dalam IG_ALUR_JENDELA pekan terakhir dapat giliran, jadi setahun penuh memuat persiapan, Makkah, Madinah,
    // umroh bersama siapa, dan pulang (dulu alur jalan lurus dari awal ke akhir sehingga Madinah dst baru muncul tahun ke-2).
    // Di dalam satu fase urutan tetap menyambung dari tema terakhir fase itu. Tema musiman tidak dihitung (bukan tema alur).
    const seninDari = tgl => { const [yy, mm, dd] = tgl.split('-').map(Number); const dt = new Date(yy, mm - 1, dd); return igLocalDateKey(new Date(yy, mm - 1, dd - ((dt.getDay() + 6) % 7))); };
    const perPekan = new Map(); // satu baris riwayat per pekan (tiap pekan punya sampai 7 baris ide dengan tema sama)
    berTema.filter(pl => pl.tanggal < seninKey).forEach(pl => { const k = seninDari(pl.tanggal); if (!perPekan.has(k)) perPekan.set(k, pl.tema_minggu); });
    (rencana || []).filter(x => x.senin < seninKey && x.tema).forEach(x => { if (!perPekan.has(x.senin)) perPekan.set(x.senin, x.tema); });
    const riwayatAlur = [...perPekan.entries()].sort((p, q) => q[0].localeCompare(p[0]))
        .map(([tgl, tema]) => ({ tgl, tema, g: igAlurGrupIdx(tema) })).filter(r => r.g >= 0); // terbaru dulu
    // Jatah ditakar dari pekan-pekan TERDEKAT saja (IG_ALUR_JENDELA pekan kalender ke belakang): riwayat yang sudah lama tidak ikut,
    // sedangkan penunjuk "lanjut setelah tema terakhir fase" di bawah tetap memakai seluruh riwayat.
    const batasJendela = kunci(-7 * IG_ALUR_JENDELA);
    const jendela = riwayatAlur.filter(r => r.tgl >= batasJendela).slice(0, IG_ALUR_JENDELA);
    const totalBobot = IG_ALUR_GRUP.reduce((t, g) => t + g.bobot, 0);
    const urut = IG_ALUR_GRUP.map((g, gi) => {
        const pos = jendela.findIndex(r => r.g === gi);
        const pakai = jendela.filter(r => r.g === gi).length;
        return { gi, defisit: g.bobot / totalBobot - (jendela.length ? pakai / jendela.length : 0), umur: pos < 0 ? 99 : pos };
    }).sort((p, q) => (q.defisit - p.defisit) || (q.umur - p.umur) || (p.gi - q.gi));
    const antre = urut.map(u => {
        const g = IG_ALUR_GRUP[u.gi];
        const terakhir = riwayatAlur.find(r => r.g === u.gi);
        const i0 = terakhir ? g.tema.findIndex(a => a.toLowerCase() === terakhir.tema.toLowerCase() || igIsSimilarText(a, terakhir.tema)) : -1;
        const daftar = [];
        for (let k = 1; k <= g.tema.length; k++) { const t = g.tema[(i0 + k) % g.tema.length]; if (!sudah(t)) daftar.push(t); }
        return { g, daftar, setelah: terakhir && i0 >= 0 ? g.tema[i0] : '' };
    });
    const awalAlur = !riwayatAlur.length;
    for (let putaran = 0; hasil.length < batas; putaran++) {
        let ada = false;
        for (const a of antre) {
            if (hasil.length >= batas) break;
            const t = a.daftar[putaran];
            if (t === undefined) continue;
            ada = true;
            const pertamaSekali = !hasil.some(h => h.grup);
            hasil.push({ tema: t, grup: a.g.id, alasan: pertamaSekali
                ? (awalAlur ? 'Awal alur perjalanan jamaah' : `Seimbangkan alur: giliran fase \"${a.g.label}\"` + (a.setelah ? `, lanjut setelah \"${a.setelah}\"` : ', belum tayang belakangan'))
                : `Alur perjalanan jamaah: ${a.g.label}` });
        }
        if (!ada) break;
    }
    // Tema musiman yang ditunda (pekan sebelah sudah musiman) tetap jadi pilihan terakhir, bukan hilang.
    musimTunda.forEach(it => { if (hasil.length < batas) hasil.push({ ...it, alasan: `${it.alasan} (pekan sebelah sudah tema musiman, jadi cadangan)` }); });
    // Semua tema alur sudah dipakai dalam setahun: ulang dari lanjutan alur, jangan sampai kosong.
    if (!hasil.length) {
        const i = riwayatAlur.length ? IG_TEMA_ALUR.findIndex(a => igIsSimilarText(a, riwayatAlur[0].tema)) : -1;
        hasil.push({ tema: IG_TEMA_ALUR[(i + 1) % IG_TEMA_ALUR.length], alasan: 'Semua tema sudah dipakai setahun terakhir, mengulang alur' });
    }
    // Pekan ini punya tema di Rencana Setahun (disusun AI / diatur admin): itu pilihan utama, saran otomatis jadi cadangan.
    if (rencanaIni) {
        const utama = {
            tema: rencanaIni.tema,
            alasan: 'Rencana setahun' + (rencanaIni.alasan ? ': ' + rencanaIni.alasan : ''),
            rencana: true, terkunci: !!rencanaIni.terkunci, fokus: rencanaIni.fokus_program || '', rencanaId: rencanaIni.id
        };
        const t0 = igTokenSet(utama.tema);
        return [utama, ...hasil.filter(h => !igIsSimilarText(igTokenSet(h.tema), t0))].slice(0, batas);
    }
    return hasil;
}

// Peta tema untuk `jumlah` pekan ke depan mulai seninKey: tiap pekan memakai saran teratas, dan pilihan itu
// dianggap terpakai untuk pekan berikutnya. temaAwal (opsional) = tema yang sudah dipilih admin untuk pekan pertama.
function igPetaTemaSetahun(seninKey, plans, jumlah, temaAwal, rencana = igRencanaTahun) {
    const [y, m, d] = seninKey.split('-').map(Number);
    const sim = (plans || []).slice();
    const out = [];
    for (let k = 0; k < (jumlah || 52); k++) {
        const senin = igLocalDateKey(new Date(y, m - 1, d + 7 * k));
        const minggu = igLocalDateKey(new Date(y, m - 1, d + 7 * k + 6));
        const pilihan = (k === 0 && temaAwal) ? { tema: temaAwal, alasan: 'Tema yang Anda pilih' } : igKandidatTemaMinggu(senin, sim, 1, rencana)[0];
        out.push({ senin, minggu, tema: pilihan.tema, alasan: pilihan.alasan,
            rencana: !!pilihan.rencana, terkunci: !!pilihan.terkunci, fokus: pilihan.fokus || '', rencanaId: pilihan.rencanaId || null });
        sim.push({ tanggal: senin, tema_minggu: pilihan.tema, status: 'idea' });
    }
    return out;
}

// ---- Sambungan ke form Perencanaan Konten ----
let igSaranKandidat = [];
let igSaranIdx = 0;
const igTglPendek = key => { const [, mm, dd] = key.split('-').map(Number); return `${dd} ${['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][mm - 1]}`; };

function igRenderSaranTema() {
    const el = document.getElementById('igPlanTemaSaran');
    const temaEl = document.getElementById('igPlanTema');
    if (!el || !temaEl) return;
    const k = igSaranKandidat[igSaranIdx];
    if (!k || temaEl.dataset.auto === '0') { el.innerHTML = ''; return; }
    el.innerHTML = `<i class="bi bi-stars"></i> Saran otomatis: ${escapeHtml(k.alasan)}`
        + (igSaranKandidat.length > 1 ? ` · <button type="button" class="ig-plan-link" onclick="igSaranTemaLain()">Saran lain</button>` : '');
}

// Tema pekan depan (untuk teaser Minggu) mengikuti tema pekan ini, selama admin belum mengetik sendiri.
function igPerbaruiSaranDepan() {
    const senin = document.getElementById('igPlanWeek')?.value;
    const temaEl = document.getElementById('igPlanTema');
    const depanEl = document.getElementById('igPlanTemaDepan');
    if (!senin || !depanEl || depanEl.dataset.auto === '0') return;
    const [y, m, d] = senin.split('-').map(Number);
    const seninDepan = igLocalDateKey(new Date(y, m - 1, d + 7));
    const sim = (igContentPlan || []).slice();
    const temaIni = (temaEl?.value || '').trim();
    if (temaIni) sim.push({ tanggal: senin, tema_minggu: temaIni, status: 'idea' });
    const k = igKandidatTemaMinggu(seninDepan, sim, 1)[0];
    depanEl.value = k ? k.tema : '';
    depanEl.dataset.auto = '1';
}

function igRenderPetaTema() {
    const wrap = document.getElementById('igPlanPetaWrap');
    const el = document.getElementById('igPlanPeta');
    const senin = document.getElementById('igPlanWeek')?.value;
    if (!wrap || !el || !wrap.open || !senin) return;
    const temaAwal = (document.getElementById('igPlanTema')?.value || '').trim();
    el.innerHTML = igPetaTemaSetahun(senin, igContentPlan, 52, temaAwal).map(r =>
        `<div class="ig-plan-peta-row"><span class="ig-plan-peta-tgl">${igTglPendek(r.senin)} – ${igTglPendek(r.minggu)}</span>`
        + `<span>${escapeHtml(r.tema)}<small>${escapeHtml(r.alasan)}</small></span></div>`).join('');
}

// Dipanggil tiap pekan/bulan berubah atau data rencana selesai dimuat: isi Tema Minggu otomatis selama belum diketik manual.
function igPerbaruiSaranTema() {
    const senin = document.getElementById('igPlanWeek')?.value;
    const temaEl = document.getElementById('igPlanTema');
    if (!senin || !temaEl) return;
    igSaranKandidat = igKandidatTemaMinggu(senin, igContentPlan, 8);
    igSaranIdx = 0;
    if (temaEl.dataset.auto !== '0' && igSaranKandidat[0]) { temaEl.value = igSaranKandidat[0].tema; temaEl.dataset.auto = '1'; }
    igRenderSaranTema();
    igPerbaruiSaranDepan();
    igRenderPetaTema();
}

function igSaranTemaLain() {
    const temaEl = document.getElementById('igPlanTema');
    if (!temaEl || igSaranKandidat.length < 2) return;
    igSaranIdx = (igSaranIdx + 1) % igSaranKandidat.length;
    temaEl.value = igSaranKandidat[igSaranIdx].tema;
    temaEl.dataset.auto = '1';
    igRenderSaranTema();
    igPerbaruiSaranDepan();
    igRenderPetaTema();
}

// Admin mengetik Tema Minggu sendiri: berhenti menimpa, tapi tema pekan depan & peta tetap menyesuaikan.
function igOnTemaMingguInput() {
    const temaEl = document.getElementById('igPlanTema');
    if (temaEl) temaEl.dataset.auto = '0';
    igRenderSaranTema();
    igPerbaruiSaranDepan();
    igRenderPetaTema();
}
window.igSaranTemaLain = igSaranTemaLain;
window.igOnTemaMingguInput = igOnTemaMingguInput;
window.igRenderPetaTema = igRenderPetaTema;

// ---- Fase promosi program: tiap keberangkatan dipromosikan bertahap selama ~5 pekan sebelum berangkat ----
// Dihitung dari jarak (hari) antara Senin pekan itu dan tanggal berangkat. Dipakai konteks AI dan rekap Rencana Konten.
const IG_FASE_PROGRAM = [
    { maks: 6,  kode: 'penutupan', label: 'Penutupan', arahan: 'pekan keberangkatan/penutupan: pengingat terakhir, kelengkapan dokumen dan persiapan berangkat; sebut sisa seat HANYA jika memang tinggal sedikit' },
    { maks: 13, kode: 'seat', label: 'Seat menipis', arahan: 'dorong keputusan mendaftar; sisa seat boleh disebut HANYA jika tinggal 30% kuota atau kurang, selain itu fokus pada alasan berangkat bersama Amiru' },
    { maks: 20, kode: 'paket', label: 'Isi paket', arahan: 'bahas isi paket secara konkret (hotel dan jaraknya, maskapai, durasi, itinerary, harga per tipe kamar) dengan data asli program' },
    { maks: 34, kode: 'kenalkan', label: 'Kenalkan', arahan: 'perkenalkan program lewat cerita dan manfaat, tanpa tekanan jual' }
];
// seninKey 'YYYY-MM-DD' (Senin pekan), tglBerangkat = Date. Return fase atau null kalau belum/ sudah lewat masa promosi.
function igFaseProgram(seninKey, tglBerangkat) {
    const [y, m, d] = seninKey.split('-').map(Number);
    const selisih = Math.round((new Date(tglBerangkat.getFullYear(), tglBerangkat.getMonth(), tglBerangkat.getDate()) - new Date(y, m - 1, d)) / 86400000);
    if (selisih < 0) return null;
    return IG_FASE_PROGRAM.find(f => selisih <= f.maks) || null;
}
// Senin pada/sebelum sebuah tanggal ('YYYY-MM-DD').
function igSeninDari(key) {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    return igLocalDateKey(dt);
}
// Program aktif yang belum berangkat (ringan, untuk rekap): [{nama, d, tgl}]
async function igProgramAktifRingan() {
    try {
        const { data, error } = await supabaseClient.from('programs').select('nama, tgl').eq('is_active', true);
        if (error) throw error;
        const hariIni = new Date(); hariIni.setHours(0, 0, 0, 0);
        return (data || []).map(p => ({ nama: p.nama, tgl: p.tgl, d: p.tgl ? parseDateFromString(p.tgl) : null }))
            .filter(p => p.d && !isNaN(p.d) && p.d >= hariIni).sort((a, b) => a.d - b.d);
    } catch (e) { return []; }
}

// ---- Susun ringkasan program aktif sebagai konteks AI ----
// Jendela waktu: dari awal bulan target sampai akhir 2 bulan setelahnya (3 bulan), dan program yang sudah
// berangkat (sebelum hari ini) dibuang -- konten promo harus menawarkan keberangkatan yang masih bisa didaftar,
// bukan hanya yang berangkat di bulan yang sama dengan tanggal posting. Tiap program membawa SISA SEAT nyata
// (kuota_pax dikurangi jamaah aktif non-batal) supaya AI tidak lagi menulis placeholder [jumlah].
// Query langsung ke Supabase (bukan pakai cache dataUmroh/kbJamaahList) supaya tetap akurat walau tab
// dashboard utama belum pernah dibuka di sesi ini.
async function buildIgPlanProgramContext(year, month, tglAcuan, semuaMendatang) {
    try {
        const { data, error } = await supabaseClient.from('programs')
            .select('id, nama, tgl, durasi, harga_quint, is_active, admin_data_lengkap, kuota_pax')
            .eq('is_active', true);
        if (error) throw error;

        // harga_quad/harga_triple/harga_double BUKAN kolom di tabel programs —
        // field itu disimpan di dalam JSON admin_data_lengkap (lihat komentar
        // unpackProgramAdminData di sekitar baris 3063). Harus dibongkar dulu
        // sebelum bisa dipakai, kalau tidak p.harga_quad selalu undefined.
        const unpacked = (data || []).map(p => unpackProgramAdminData(p));

        // semuaMendatang (dipakai Rencana Setahun): tanpa batas 3 bulan, semua program yang belum berangkat.
        const awalJendela = semuaMendatang ? new Date(1970, 0, 1) : new Date(year, month, 1);
        const akhirJendela = semuaMendatang ? new Date(9999, 0, 1) : new Date(year, month + 3, 0, 23, 59, 59); // akhir bulan ke-3
        const hariIni = new Date(); hariIni.setHours(0, 0, 0, 0);

        const relevant = unpacked
            .map(p => ({ p, d: p.tgl ? parseDateFromString(p.tgl) : null }))
            .filter(x => x.d && !isNaN(x.d) && x.d >= awalJendela && x.d <= akhirJendela && x.d >= hariIni)
            .sort((a, b) => a.d - b.d);

        if (!relevant.length) return '';

        // Sisa seat: hitung dari kb_jamaah (aktif, non-batal). Kalau query gagal, info seat dilewati saja.
        const terisiPerProgram = {};
        let seatOk = false;
        try {
            const { data: jam, error: jErr } = await supabaseClient.from('kb_jamaah')
                .select('program_id, status')
                .in('program_id', relevant.map(x => x.p.id))
                .eq('diarsipkan', false);
            if (jErr) throw jErr;
            (jam || []).forEach(j => {
                if (j.status === 'batal') return;
                terisiPerProgram[j.program_id] = (terisiPerProgram[j.program_id] || 0) + 1;
            });
            seatOk = true;
        } catch (seatErr) {
            console.warn('Hitung sisa seat untuk konteks AI gagal:', seatErr);
        }

        const daftar = relevant.map(({ p }) => {
            const hargaParts = [];
            if (p.harga_quint) hargaParts.push(`Quint ${p.harga_quint}`);
            if (p.harga_quad) hargaParts.push(`Quad ${p.harga_quad}`);
            if (p.harga_triple) hargaParts.push(`Triple ${p.harga_triple}`);
            if (p.harga_double) hargaParts.push(`Double ${p.harga_double}`);
            const kuota = p.kuota_pax || 45;
            const terisi = terisiPerProgram[p.id] || 0;
            const seatInfo = seatOk
                ? ` | Sisa seat: ${Math.max(0, kuota - terisi)} dari ${kuota}`
                : '';
            return `- ${p.nama} | Berangkat: ${p.tgl}${p.durasi ? ` | Durasi: ${p.durasi}` : ''}${hargaParts.length ? ` | Harga: ${hargaParts.join(', ')}` : ''}${seatInfo}`;
        }).join('\n');

        // Fase promosi untuk pekan yang sedang disusun (hanya kalau pekannya diketahui)
        let fase = '';
        if (tglAcuan) {
            const senin = igSeninDari(tglAcuan);
            const baris = relevant.map(({ p, d }) => ({ p, f: igFaseProgram(senin, d) })).filter(x => x.f)
                .map(({ p, f }) => `- ${p.nama} (berangkat ${p.tgl}): fase "${f.label}" -> ${f.arahan}`);
            if (baris.length) {
                fase = '\n\nFASE PROMOSI PROGRAM PEKAN INI (promosi aktif tanpa perlu arahan: sisipkan 1-2 hari praktis, yaitu Selasa, Rabu, atau Jumat, yang mengarah ke program ini sesuai fasenya, sisanya tetap mengikuti tema pekan; jangan jualan di semua hari, jangan mengarang data di luar daftar program):\n' + baris.join('\n');
            }
        }
        return daftar + fase;
    } catch (err) {
        console.error('buildIgPlanProgramContext error:', err);
        return '';
    }
}

// ---- Anti-duplikat: deteksi ide baru yang topiknya sama dengan konten yang pernah dibuat ----
// Kata umum & kata khas bisnis (umroh, jamaah, dst) dibuang supaya yang dibandingkan adalah topik intinya.
const IG_DEDUP_STOPWORDS = new Set([
    'yang', 'dan', 'dari', 'untuk', 'dengan', 'saat', 'pada', 'atau', 'ini', 'itu', 'kamu', 'aku', 'kita', 'kami',
    'ada', 'tidak', 'nggak', 'bisa', 'jadi', 'sebelum', 'setelah', 'sesudah', 'akan', 'sudah', 'udah', 'lagi',
    'masih', 'banget', 'aja', 'juga', 'karena', 'kalau', 'biar', 'agar', 'supaya', 'dalam', 'para', 'oleh',
    'tentang', 'umroh', 'umrah', 'jamaah', 'jemaah', 'amiru', 'tour', 'tanah', 'suci', 'konten', 'tema', 'isi',
    'slide', 'ide',
    // Penanda "[cek pembimbing]" ditempel server ke judul ide; bukan bagian topik. Tanpa ini dua judul pendek
    // yang sama-sama bertanda (mis. "Doa di Multazam" & "Doa saat thawaf") terbaca kembar.
    'cek', 'pembimbing'
]);

// Varian ejaan istilah umroh -> satu bentuk baku, supaya "tawaf" = "thawaf", "Mekah" = "Makkah", dst.
// Dipakai SETELAH apostrof dibuang (Ka'bah -> kabah, Sa'i -> sai).
const IG_DEDUP_EJAAN = {
    thawaf: 'tawaf', thowaf: 'tawaf', towaf: 'tawaf', tawwaf: 'tawaf',
    mekah: 'makkah', mekkah: 'makkah', makah: 'makkah',
    medina: 'madinah', madina: 'madinah',
    raudhah: 'raudhah', raudah: 'raudhah', roudhoh: 'raudhah', rawdah: 'raudhah', roudhah: 'raudhah',
    talbiah: 'talbiyah', talbiyyah: 'talbiyah', talbiya: 'talbiyah',
    kakbah: 'kabah', kaabah: 'kabah', kabbah: 'kabah',
    safa: 'shafa', shofa: 'shafa', marwa: 'marwah', marwan: 'marwah',
    say: 'sai', saii: 'sai',
    tahalul: 'tahallul', tahalyl: 'tahallul',
    ihrom: 'ihram', mikat: 'miqat', miqot: 'miqat',
    manasik: 'manasik', manasek: 'manasik', manasikh: 'manasik'
};
// Stemming ringan bahasa Indonesia (awalan & akhiran umum) supaya "bertawaf" = "tawaf", "melihat" = "lihat".
// Hanya dipotong kalau sisa kata masih >= 4 huruf, supaya kata pendek tidak rusak. Dipakai sama di kedua sisi
// perbandingan, jadi bentuk hasilnya tidak perlu kata baku.
function igStemToken(t) {
    let w = IG_DEDUP_EJAAN[t] || t;
    const awalan = ['mem', 'men', 'meng', 'meny', 'ber', 'ter', 'per', 'pe', 'me', 'di', 'ke', 'se'];
    for (const a of awalan) {
        if (w.startsWith(a) && w.length - a.length >= 4) { w = w.slice(a.length); break; }
    }
    const akhiran = ['kan', 'an', 'nya', 'lah', 'kah', 'i'];
    for (const a of akhiran) {
        if (w.endsWith(a) && w.length - a.length >= 4) { w = w.slice(0, -a.length); break; }
    }
    return IG_DEDUP_EJAAN[w] || w;
}

function igTokenSet(text) {
    const tokens = String(text || '').toLowerCase()
        .replace(/[’'`ʼ]/g, '')        // Ka'bah -> kabah, Sa'i -> sai
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 2 && !IG_DEDUP_STOPWORDS.has(t))
        .map(igStemToken)
        .filter(t => t.length > 2);
    return new Set(tokens);
}

// true kalau dua teks (tema / baris pertama teks gambar) membahas topik yang sama.
// a & b boleh string atau Set hasil igTokenSet().
function igIsSimilarText(a, b) {
    const A = a instanceof Set ? a : igTokenSet(a);
    const B = b instanceof Set ? b : igTokenSet(b);
    if (!A.size || !B.size) return false;
    let inter = 0;
    A.forEach(t => { if (B.has(t)) inter++; });
    if (A.size === 1 || B.size === 1) return A.size === B.size && inter === 1; // 1 kata: harus persis sama
    return inter / Math.min(A.size, B.size) >= 0.75;
}

function igFirstLine(text) {
    return String(text || '').split('\n')[0].trim();
}

// Rapikan teks gambar carousel: beri 1 baris kosong sebelum tiap "Slide 2:", "Slide 3:", dst (dan sebelum "Label gambar:")
// supaya antar slide nyaman dibaca. Slide 1 tidak diubah. Aman dipanggil berulang (idempoten).
function igSpasiSlide(text) {
    return String(text || '')
        .replace(/[ \t]*\n[ \t\n]*(?=slide\s*\d+\s*[:.)\-\u2013])/gi, '\n\n')
        .replace(/[ \t]*\n[ \t\n]*(?=Label gambar:)/gi, '\n\n');
}

// 3 kata pertama (tanpa tanda baca, tanpa filter kata umum) = "rumus pembuka". '' kalau < 3 kata.
function igRumusPembuka(teks) {
    const w = String(teks || '').toLowerCase().replace(/[’'`ʼ]/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    return w.length >= 3 ? w.slice(0, 3).join(' ') : '';
}

// Tambah 1 entri ke riwayat (struktur: { tema, tgl, _t, _h, hook, buka, _o, _o3 }).
// _t/_h = token tema / hook siap bandingkan. caption (opsional) -> pembuka caption (_o token, _o3 rumus 3 kata) dan
// hook (hook teks, apa adanya) disimpan juga supaya bisa dikirim ke AI & dicek ("20 posting terakhir").
function igRiwayatAdd(riwayat, tema, teksGambar, tgl, caption, temaMinggu) {
    const t = String(tema || '').trim();
    if (!t) return;
    const buka = igFirstLine(caption).slice(0, 160);
    riwayat.push({
        tema: t, tgl: tgl || '', _t: igTokenSet(t), _h: igTokenSet(igFirstLine(teksGambar)),
        hook: igFirstLine(teksGambar).slice(0, 120), buka, _o: igTokenSet(buka), _o3: igRumusPembuka(buka),
        // Tema Minggu asal entri ini (kalau diketahui): dipakai agar konten dengan tema sama TIDAK pernah kedaluwarsa (lihat igRiwayatAktif).
        temaMinggu: String(temaMinggu || '').trim(), _tm: temaMinggu ? igTokenSet(temaMinggu) : null
    });
}

const IG_GAYA_JUMLAH = 20; // aturan pola-konten.md bagian 6: hook & pembuka caption tidak boleh mirip 20 posting terakhir

// 20 entri terbaru (menurut tanggal) yang punya hook atau pembuka caption. Entri tanpa tanggal (tema yang baru ditolak) tidak dihitung.
function igGayaTerbaru(riwayat) {
    return (riwayat || []).filter(r => r.tgl && (r.hook || r.buka))
        .sort((a, b) => String(b.tgl).localeCompare(String(a.tgl)))
        .slice(0, IG_GAYA_JUMLAH);
}

// true kalau pembuka caption item mengulang pembuka salah satu dari 20 posting terakhir: rumus 3 kata pertama sama
// ATAU token pembukanya hampir sama (kata tema minggu dibuang lewat `abaikan`).
function igIsPembukaMirip(item, riwayat, abaikan) {
    const buka = igFirstLine(item.draft_caption).slice(0, 160);
    if (!buka) return false;
    const o3Mentah = igRumusPembuka(buka);
    const o3 = o3Mentah;
    const o = igMinusTokens(igTokenSet(buka), abaikan);
    return igGayaTerbaru(riwayat).some(r => {
        if (!r.buka) return false;
        if (o3 && r._o3 && o3 === r._o3) return true;
        const ro = igMinusTokens(r._o, abaikan);
        return o.size >= 3 && ro.size >= 3 && igIsSimilarText(o, ro);
    });
}

// Hook + pembuka caption 20 posting terakhir -> teks untuk AI (supaya ia bisa menghindarinya, bukan cuma ditolak sesudahnya).
function igRiwayatGayaToText(riwayat) {
    return igGayaTerbaru(riwayat).map(r =>
        `- ${r.tgl}${r.hook ? ' | hook: ' + r.hook : ''}${r.buka ? ' | pembuka: ' + r.buka : ''}`).join('\n');
}

// Kumpulkan SEMUA konten yang pernah dibuat (semua bulan, semua status termasuk "dilewati")
// dari rencana (ig_content_plan) + post (ig_posts, baris pertama caption).
function igBuildRiwayat() {
    const riwayat = [];
    igContentPlan.forEach(pl => {
        if (/—\s*isi\b/i.test(pl.tema || '')) return; // kerangka kosong pola mingguan, bukan konten asli
        igRiwayatAdd(riwayat, pl.tema, pl.teks_gambar, pl.tanggal, pl.draft_caption, pl.tema_minggu);
    });
    (typeof igPosts !== 'undefined' && Array.isArray(igPosts) ? igPosts : []).forEach(p => {
        const baris = igFirstLine(p.caption);
        if (!baris) return;
        const d = (typeof igPostRefDate === 'function') ? igPostRefDate(p) : null;
        igRiwayatAdd(riwayat, baris.slice(0, 100), '', d ? igLocalDateKey(d) : '', p.caption);
    });
    // Riwayat topik awal (data, bukan hanya teks prompt) ikut menghalangi ide kembar sampai jedanya habis.
    IG_RIWAYAT_AWAL.forEach(r => igRiwayatAdd(riwayat, r.tema, '', r.tgl, ''));
    return riwayat;
}

// Buang token yang ada di `abaikan` (Set) dari `set`. Dipakai supaya kata tema minggu (mis. "talbiyah")
// yang pasti muncul di ketujuh ide satu pekan tidak membuat ide sepekan saling dianggap kembar.
function igMinusTokens(set, abaikan) {
    if (!abaikan || !abaikan.size) return set;
    const out = new Set();
    set.forEach(t => { if (!abaikan.has(t)) out.add(t); });
    return out;
}

// Jeda topik (pola-konten.md bagian 6): topik/hook yang sama baru boleh muncul lagi (dengan sudut baru) setelah
// minimal 6 bulan. Jadi riwayat yang lebih tua dari jendela ini tidak lagi memblokir ide baru dan tidak dikirim ke AI.
// Beda dengan Tema Minggu (igKandidatTemaMinggu): itu memakai jeda 12 bulan, sengaja lebih ketat supaya peta
// satu tahun tidak punya tema pekan kembar; 12 bulan sudah memenuhi syarat "minimal 6 bulan".
const IG_JEDA_TOPIK_BULAN = 6;

// Batas tanggal terlama (YYYY-MM-DD) yang masih dihitung, dihitung mundur dari refKey (default: hari ini).
function igBatasRiwayat(refKey) {
    const [y, m, d] = String(refKey || igLocalDateKey(new Date())).split('-').map(Number);
    // Hari dijepit ke akhir bulan tujuan (31 Agustus - 6 bulan = 28 Februari, bukan 3 Maret).
    const akhirBulan = new Date(y, m - 1 - IG_JEDA_TOPIK_BULAN + 1, 0).getDate();
    return igLocalDateKey(new Date(y, m - 1 - IG_JEDA_TOPIK_BULAN, Math.min(d, akhirBulan)));
}

// Entri riwayat yang masih memblokir: tanpa tanggal (tema yang baru ditolak di proses ini), atau tanggalnya >= batas.
// Tanggal di masa depan (rencana pekan-pekan mendatang) tetap memblokir.
// temaTokens (opsional, igTokenSet dari Tema Minggu yang sedang dibuat): entri dengan Tema Minggu yang SAMA selalu aktif,
// berapa pun umurnya. Tema yang kembali di tahun berikutnya (mis. Talbiyah) jadi tidak bisa mengulang ide edisi lamanya;
// jeda 6 bulan hanya berlaku untuk topik LINTAS tema.
function igRiwayatAktif(riwayat, refKey, temaTokens) {
    const batas = igBatasRiwayat(refKey);
    const sama = r => !!(temaTokens && temaTokens.size && r._tm && r._tm.size && igIsSimilarText(r._tm, temaTokens));
    return (riwayat || []).filter(r => !r.tgl || r.tgl >= batas || sama(r));
}

// Ledger tema yang sama: SEMUA ide lama (umur berapa pun) dari tema minggu yang sama, selain pekan yang sedang dibuat,
// untuk dikirim ke AI supaya edisi baru memilih sudut berbeda. edisi = berapa kali tema ini sudah tayang + 1.
function igLedgerTemaIni(riwayat, temaMinggu, seninKey) {
    const tema = String(temaMinggu || '').trim();
    if (!tema) return { edisi: 1, teks: '' };
    const tokens = igTokenSet(tema);
    const [y, m, d] = String(seninKey).split('-').map(Number);
    const mingguKey = igLocalDateKey(new Date(y, m - 1, d + 6));
    const lama = (riwayat || []).filter(r => r.tgl && r._tm && r._tm.size && igIsSimilarText(r._tm, tokens) && (r.tgl < seninKey || r.tgl > mingguKey))
        .sort((a, b) => String(b.tgl).localeCompare(String(a.tgl)));
    const pekanBerbeda = new Set(lama.map(r => {
        const [yy, mm, dd] = r.tgl.split('-').map(Number);
        return igLocalDateKey(new Date(yy, mm - 1, dd - ((new Date(yy, mm - 1, dd).getDay() + 6) % 7)));
    }));
    const teks = lama.slice(0, 28).map(r => `- ${r.tgl} | ${r.tema.slice(0, 80)}${r.hook ? ' | hook: ' + r.hook.slice(0, 80) : ''}${r.buka ? ' | pembuka: ' + r.buka.slice(0, 80) : ''}`).join('\n');
    return { edisi: pekanBerbeda.size + 1, teks };
}

// Cek 1 ide ({ tema, teks_gambar | teks, tanggal? }) terhadap riwayat.
// abaikan (opsional): Set token yang tidak dihitung saat membandingkan (lihat igMinusTokens).
// Tanggal ide (kalau ada) menentukan jendela 6 bulan; tanpa tanggal dipakai hari ini.
function igIsDuplicateIdea(item, riwayat, abaikan) {
    const t = igMinusTokens(igTokenSet(item.tema), abaikan);
    const h = igMinusTokens(igTokenSet(igFirstLine(item.teks_gambar != null ? item.teks_gambar : item.teks)), abaikan);
    const aktif = igRiwayatAktif(riwayat, item.tanggal, abaikan); // abaikan = token Tema Minggu (mode pekan)
    return aktif.some(r => {
        const rt = igMinusTokens(r._t, abaikan);
        const rh = igMinusTokens(r._h, abaikan);
        return igIsSimilarText(t, rt) || (h.size >= 3 && rh.size >= 3 && igIsSimilarText(h, rh));
    }) || igIsPembukaMirip(item, riwayat, abaikan);
}

// Riwayat -> teks untuk dikirim ke AI: hanya yang masih dalam jendela jeda topik (igRiwayatAktif), tanpa tema kembar,
// dibatasi 200 baris supaya prompt tidak membengkak. Urutan: entri tanpa tanggal DULU (tema yang baru ditolak di proses
// ini -- paling relevan untuk percobaan ulang, jangan sampai terpotong), lalu yang terbaru ke yang terlama.
function igRiwayatToText(riwayat, refKey) {
    const urut = igRiwayatAktif(riwayat, refKey).sort((a, b) => {
        if (!a.tgl !== !b.tgl) return a.tgl ? 1 : -1;
        return String(b.tgl).localeCompare(String(a.tgl));
    });
    const seen = new Set();
    const baris = [];
    for (const r of urut) {
        const key = r.tema.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        baris.push('- ' + r.tema.slice(0, 80));
        if (baris.length >= 200) break;
    }
    return baris.join('\n');
}

// Slot tanggal yang harus diisi di 1 bulan, mengikuti Pola Amiru (Sen/Rab/Jum/Min).
// tanggalTerisi: Set "YYYY-MM-DD" yang sudah punya ide/post (dilewati). mulaiDari: tanggal sebelum ini tidak diisi.
function igBuildSlotBulan(year, month, tanggalTerisi, mulaiDari) {
    const lastDay = new Date(year, month + 1, 0).getDate();
    const slots = [];
    for (let d = 1; d <= lastDay; d++) {
        const pola = IG_POLA_AMIRU[new Date(year, month, d).getDay()];
        if (!pola) continue;
        const tanggal = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (mulaiDari && tanggal < mulaiDari) continue;
        if (tanggalTerisi && tanggalTerisi.has(tanggal)) continue;
        slots.push({ tanggal, hari: pola.hari, pilar: pola.pilar, tipe_konten: pola.tipe });
    }
    return slots;
}

// Slot 1 pekan Senin-Minggu mengikuti Pola 7 Hari (pola-konten.md bagian 3). seninKey = "YYYY-MM-DD" hari Senin.
// tanggalTerisi: Set tanggal yang sudah punya ide/post (dilewati). mulaiDari: tanggal sebelum ini tidak diisi.
// Tiap slot membawa `urutan` (1-7) & `peran` (Rasakan..Renungkan) untuk label seri dan konteks AI.
// temaMinggu (opsional) menentukan jenis pekan: pekan hari besar / penjualan memakai varian peran dan format (IG_POLA_VARIAN);
// hari yang memakai varian membawa `catatan` untuk AI. Tanpa temaMinggu, pekan hari besar tetap terdeteksi dari tanggalnya.
function igBuildSlotPekan(seninKey, tanggalTerisi, mulaiDari, temaMinggu) {
    const [y, m, d] = String(seninKey).split('-').map(Number);
    const slots = [];
    IG_URUTAN_PEKAN.forEach((dow, i) => {
        const tanggal = igLocalDateKey(new Date(y, m - 1, d + i));
        if (mulaiDari && tanggal < mulaiDari) return;
        if (tanggalTerisi && tanggalTerisi.has(tanggal)) return;
        const pola = igPolaHari(tanggal, temaMinggu);
        slots.push({ tanggal, hari: pola.hari, pilar: pola.pilar, tipe_konten: pola.tipe, urutan: pola.urutan, peran: pola.peran,
            ...(pola.catatan ? { catatan: pola.catatan } : {}) });
    });
    return slots;
}

// Daftar pekan (Senin-Minggu) yang menyentuh bulan terpilih: [{ senin, minggu, label }].
function igDaftarPekanBulan(year, month) {
    const awalBulan = new Date(year, month, 1);
    const akhirBulan = new Date(year, month + 1, 0);
    const mundur = (awalBulan.getDay() + 6) % 7; // jarak ke Senin sebelumnya (Senin = 0)
    const bln = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const out = [];
    for (let sen = new Date(year, month, 1 - mundur); sen <= akhirBulan; sen = new Date(sen.getFullYear(), sen.getMonth(), sen.getDate() + 7)) {
        const min = new Date(sen.getFullYear(), sen.getMonth(), sen.getDate() + 6);
        out.push({
            senin: igLocalDateKey(sen), minggu: igLocalDateKey(min),
            label: `${sen.getDate()} ${bln[sen.getMonth()]} – ${min.getDate()} ${bln[min.getMonth()]} ${min.getFullYear()}`
        });
    }
    return out;
}

// Ambil n slot dari arr (dipakai kalau user membatasi jumlah ide), tersebar merata sepanjang bulan
// DAN menjaga keseimbangan Pola Amiru: tiap pick dekat posisi idealnya, tapi hari yang sudah sering terpilih
// dikenai penalti sehingga Sen..Min bergantian rata (carousel Rab/Kam & Info Program Min ikut terpilih).
// Dulu hanya merata per indeks sehingga bisa jatuh di hari yang itu-itu saja (mis. 7 ide = 7 image, 0 carousel).
function igPickEvenly(arr, n) {
    if (n >= arr.length) return arr.slice();
    const dow = s => { const [y, m, d] = s.tanggal.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
    const hari = arr.map(dow);
    const dipakai = new Set();
    const pakaiHari = {};
    const out = [];
    for (let i = 0; i < n; i++) {
        const ideal = (i + 0.5) * arr.length / n - 0.5;
        let best = -1, bestSkor = Infinity;
        for (let j = 0; j < arr.length; j++) {
            if (dipakai.has(j)) continue;
            const skor = Math.abs(j - ideal) + (pakaiHari[hari[j]] || 0) * 10;
            if (skor < bestSkor) { bestSkor = skor; best = j; }
        }
        dipakai.add(best);
        pakaiHari[hari[best]] = (pakaiHari[hari[best]] || 0) + 1;
        out.push(arr[best]);
    }
    return out.sort((x, y) => x.tanggal.localeCompare(y.tanggal));
}

// Satu baris konteks pekan untuk AI: "Senin 2026-10-12 | Rasakan | tema | hook: ... | caption dibuka: ...".
// Dipakai generate pekan (hari yang sudah jadi) dan generate ulang satu hari.
function igFormatBarisPekan(tgl, tema, teksGambar, caption, temaMinggu) {
    const pola = igPolaHari(tgl, temaMinggu);
    const hook = igFirstLine(teksGambar).slice(0, 90);
    const buka = igFirstLine(caption).slice(0, 90);
    return `${pola ? pola.hari + ' ' : ''}${tgl} | ${pola ? pola.peran + ' | ' : ''}${String(tema).slice(0, 90)}${hook ? ' | hook: ' + hook : ''}${buka ? ' | caption dibuka: ' + buka : ''}`;
}

const IG_PLAN_BATCH = 6;    // jumlah slot per panggilan AI mode bulan (batch kecil = tidak timeout, hasil tersimpan bertahap)
const IG_PLAN_BATCH_PEKAN = 7; // mode pekan: ketujuh hari dalam SATU panggilan supaya konten menyambung
const IG_PLAN_MAX_PASS_PEKAN = 5; // mode pekan: hari yang ditolak (dan hari sesudahnya) diulang di putaran berikutnya
const IG_PLAN_MAX_PASS = 3; // total putaran (1 putaran awal + 2 percobaan ulang untuk slot yang ditolak karena duplikat)

// Header untuk edge function AI IG. Function memverifikasi token login (bukan anon key), jadi
// yang dikirim adalah access_token sesi dashboard yang sedang aktif.
async function igAiAuthHeaders() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.access_token) throw new Error('Sesi login berakhir, silakan login ulang');
    return {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + session.access_token
    };
}

async function igCallPlanFunction(payload) {
    const response = await fetch(IG_CONTENT_PLAN_FUNCTION_URL, {
        method: 'POST',
        headers: await igAiAuthHeaders(),
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        let detail = '';
        try { detail = (await response.json()).error || ''; } catch (e) {}
        throw new Error(detail || 'Gagal memanggil API (status ' + response.status + ')');
    }
    const data = await response.json();
    if (!data || !(data.versi >= 4)) {
        throw new Error('Edge function generate-ig-content-plan belum di-deploy ulang ke versi terbaru.');
    }
    return data;
}

let igPlanBusy = false; // true selama proses generate (manual atau otomatis) berjalan -> cegah dobel
let igPlanResultRange = null; // { mulai, akhir } -> daftar hasil menampilkan 1 pekan; null = 1 bulan penuh

function igHariBerikutnya(tgl) {
    const [y, m, d] = String(tgl).split('-').map(Number);
    return igLocalDateKey(new Date(y, m - 1, d + 1));
}

// Seleksi hasil mode pekan (fungsi murni, mudah dites). `coba(slot)` mengembalikan baris siap simpan atau null (ditolak).
// Aturan: hari yang ditolak membuat hari SESUDAHNYA (tanggal persis +1) ikut diulang, karena pembukanya menyambung penutup versi lama.
// Hari lain yang lolos tetap diterima. Hari yang ikut diulang tidak dicoba (coba tidak dipanggil), jadi tidak masuk riwayat.
function igSeleksiPekan(batch, coba) {
    const hasil = [];
    let prev = null;      // slot sebelumnya di batch
    let prevGagal = false;
    for (const slot of batch) {
        const berurutan = !!prev && igHariBerikutnya(prev.tanggal) === slot.tanggal;
        const ikutGagal = prevGagal && berurutan;
        let row = null;
        if (!ikutGagal) row = coba(slot);
        if (row) hasil.push(row);
        prevGagal = !row && !ikutGagal; // hari yang ikut diulang tidak menyeret hari sesudahnya lagi
        prev = slot;
    }
    return hasil;
}

// ---- Inti generate: isi daftar slot (semua dalam 1 bulan) lewat AI + anti-duplikat ----
// Alur: kirim slot ke AI per batch bersama riwayat SEMUA konten lama -> buang hasil yang mirip
// konten lama -> slot yang ditolak dicoba ulang. Return { berhasil, sisa, errMsg }.
async function igGeneratePlanForSlots(year, month, slots, arahan, onProgress, opsi) {
    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const bulanLabel = `${monthNames[month]} ${year}`;
    const bulanDari = tgl => `${String(tgl).slice(0, 7)}-01`; // tiap baris memakai bulan dari tanggalnya (pekan bisa melintasi 2 bulan)

    // Mode pekan (opsi.temaMinggu terisi): satu pekan Senin-Minggu dengan SATU tema, semua hari dikirim dalam
    // 1 panggilan supaya ketujuh konten menyambung. Tanpa opsi = mode lama (per bulan, dibagi batch kecil).
    const pekan = !!(opsi && opsi.temaMinggu);
    const temaMinggu = pekan ? String(opsi.temaMinggu).trim() : '';
    const tanggalMulai = pekan ? opsi.mulai : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const tanggalAkhir = pekan ? opsi.akhir : `${year}-${String(month + 1).padStart(2, '0')}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, '0')}`;
    const batchSize = pekan ? IG_PLAN_BATCH_PEKAN : IG_PLAN_BATCH;
    const abaikan = pekan ? igTokenSet(temaMinggu) : null;

    let berhasil = 0;
    let errMsg = '';
    let sisa = slots.slice();
    if (onProgress) onProgress(0);

    // Hari-hari yang sudah jadi di pekan ini (dari rencana tersimpan + hasil putaran ini): jadi konteks penyambung.
    const barisPekan = [];
    const catatPekan = (tgl, tema, teksGambar, caption) => barisPekan.push(igFormatBarisPekan(tgl, tema, teksGambar, caption, temaMinggu));
    if (pekan) {
        igContentPlan
            .filter(pl => pl.tanggal && pl.tanggal >= tanggalMulai && pl.tanggal <= tanggalAkhir && pl.status !== 'dilewati' && pl.draft_caption)
            .sort((x, y) => x.tanggal.localeCompare(y.tanggal))
            .forEach(pl => catatPekan(pl.tanggal, pl.tema, pl.teks_gambar, pl.draft_caption));
    }

    try {
        const konteksProgram = await buildIgPlanProgramContext(year, month, pekan ? tanggalMulai : null);
        const riwayat = igBuildRiwayat();
        const ledger = pekan ? igLedgerTemaIni(riwayat, temaMinggu, tanggalMulai) : { edisi: 1, teks: '' };

        const maxPass = pekan ? IG_PLAN_MAX_PASS_PEKAN : IG_PLAN_MAX_PASS;
        for (let pass = 0; pass < maxPass && sisa.length; pass++) {
            const gagal = [];
            for (let i = 0; i < sisa.length; i += batchSize) {
                const batch = sisa.slice(i, i + batchSize);
                const data = await igCallPlanFunction({
                    bulanLabel, jumlahPost: batch.length, tanggalMulai, tanggalAkhir,
                    konteksProgram, arahan: arahan || '', slots: batch, riwayatTema: igRiwayatToText(riwayat, tanggalMulai), riwayatGaya: igRiwayatGayaToText(riwayat),
                    ...(pekan ? {
                        temaMinggu,
                        temaMingguDepan: String(opsi.temaMingguDepan || '').trim(),
                        konteksPekan: barisPekan.join('\n'),
                        edisi: ledger.edisi,
                        riwayatTemaIni: ledger.teks
                    } : {})
                });

                const slotByDate = new Map(batch.map(s => [s.tanggal, s]));
                const rows = [];
                // Terima 1 ide untuk 1 slot -> baris siap simpan, atau null kalau mirip konten lama.
                const terima = (it, slot) => {
                    // Mirip konten lama (atau ide lain di batch ini)? Dibuang; temanya dicatat supaya percobaan ulang menghindarinya.
                    if (igIsDuplicateIdea(it, riwayat, abaikan)) {
                        igRiwayatAdd(riwayat, it.tema, it.teks_gambar, '');
                        return null;
                    }
                    igRiwayatAdd(riwayat, it.tema, it.teks_gambar, it.tanggal, it.draft_caption, pekan ? temaMinggu : '');
                    // Label kecil di pojok gambar (pola-konten.md): "Seri Talbiyah · 3/7". Ditaruh di baris sendiri di akhir teks gambar.
                    let teksGambar = igSpasiSlide(String(it.teks_gambar || '').trim());
                    if (pekan && slot.urutan) teksGambar += `${teksGambar ? '\n\n' : ''}Label gambar: Seri ${temaMinggu} · ${slot.urutan}/7`;
                    return {
                        bulan: bulanDari(it.tanggal),
                        tanggal: it.tanggal,
                        tema: String(it.tema).trim(),
                        tipe_konten: slot.tipe_konten,
                        draft_caption: it.draft_caption,
                        status: 'idea',
                        ...(igPlannerColsReady ? { pilar: slot.pilar, tahap: 'ide' } : {}),
                        ...(igTeksGambarReady ? { teks_gambar: teksGambar || null } : {}),
                        ...(pekan && igTemaMingguReady ? { tema_minggu: temaMinggu } : {})
                    };
                };

                if (pekan) {
                    // Mode pekan: pembuka caption hari N+1 menyambung penutup hari N (lewat isi). Kalau hari N ditolak lalu
                    // dibuat ulang, hanya hari N+1 yang sambungannya jadi usang, jadi cukup N dan N+1 yang diulang. Hari lain yang
                    // sudah lolos tetap disimpan (lihat igSeleksiPekan).
                    const itemByDate = new Map();
                    (data.items || []).forEach(it => { if (it && it.tanggal && !itemByDate.has(it.tanggal)) itemByDate.set(it.tanggal, it); });
                    igSeleksiPekan(batch, slot => {
                        const it = itemByDate.get(slot.tanggal);
                        return (it && it.tema && it.draft_caption) ? terima(it, slot) : null;
                    }).forEach(r => rows.push(r));
                } else {
                    (data.items || []).forEach(it => {
                        const slot = slotByDate.get(it.tanggal);
                        if (!slot || !it.tema || !it.draft_caption) return;
                        if (rows.some(r => r.tanggal === it.tanggal)) return;
                        const row = terima(it, slot);
                        if (row) rows.push(row);
                    });
                }

                batch.forEach(s => { if (!rows.some(r => r.tanggal === s.tanggal)) gagal.push(s); });

                if (rows.length) {
                    // Simpan per batch: kalau proses terputus di tengah, hasil yang sudah jadi tidak hilang.
                    const { error: insErr } = await supabaseClient.from('ig_content_plan').insert(rows);
                    if (insErr) throw insErr;
                    berhasil += rows.length;
                    rows.forEach(r => catatPekan(r.tanggal, r.tema, r.teks_gambar, r.draft_caption));
                    if (onProgress) onProgress(berhasil);
                }
            }
            sisa = gagal;
        }
    } catch (err) {
        console.error('igGeneratePlanForSlots error:', err);
        errMsg = err.message || String(err);
    }

    if (berhasil > 0) await loadIgContentPlan();
    return { berhasil, sisa, errMsg };
}

// Tanggal (YYYY-MM-DD) yang sudah terisi: ide aktif di rencana + post (tanggal yang sama tidak ditimpa)
function igTanggalTerisiSet() {
    const set = new Set(igContentPlan.filter(pl => pl.tanggal && pl.status !== 'dilewati').map(pl => pl.tanggal));
    (igPosts || []).forEach(p => {
        const d = igPostRefDate(p);
        if (d) set.add(igLocalDateKey(d));
    });
    return set;
}

// ---- Generate manual (tombol "Generate dengan AI"): satu pekan Senin-Minggu dengan satu Tema Minggu ----
// Tujuh hari disusun dalam SATU panggilan AI supaya saling menyambung (pola-konten.md bagian 3 & 9).
async function generateIgContentPlanAI() {
    if (igPlanBusy) { showToast('Masih ada proses generate yang berjalan, tunggu sebentar', 'info'); return; }
    const btn = document.getElementById('btnIgGeneratePlan');
    const btnText = document.getElementById('btnIgGeneratePlanText');
    const senin = document.getElementById('igPlanWeek')?.value; // "YYYY-MM-DD" hari Senin
    if (!senin) { showToast('Pilih bulan dan pekan dulu', 'error'); return; }
    const temaEl = document.getElementById('igPlanTema');
    const temaMinggu = (temaEl?.value || '').trim();
    if (!temaMinggu) {
        showToast('Isi Tema Minggu dulu (contoh: Talbiyah) supaya ketujuh konten menyambung', 'error');
        if (temaEl) temaEl.focus();
        return;
    }
    const temaMingguDepan = (document.getElementById('igPlanTemaDepan')?.value || '').trim();
    const arahan = (document.getElementById('igPlanArahan')?.value || '').trim();

    const hariIni = igLocalDateKey(new Date());
    const slots = igBuildSlotPekan(senin, igTanggalTerisiSet(), hariIni, temaMinggu);
    if (!slots.length) {
        showToast('Tidak ada hari kosong yang tersisa di pekan ini (sudah lewat atau sudah terisi semua)', 'info');
        return;
    }
    const [sy, sm, sd] = senin.split('-').map(Number);
    const minggu = igLocalDateKey(new Date(sy, sm - 1, sd + 6));

    igPlanBusy = true;
    if (btn) btn.disabled = true;
    // Mode pekan hanya satu panggilan AI (plus putaran perbaikan di server), jadi angka n/total baru bergerak di akhir.
    // Tampilkan detik berjalan + perkiraan supaya tidak terlihat macet.
    const tMulai = Date.now();
    let igProgresTeks = `Menyusun 0/${slots.length}`;
    const tampilProgres = () => { if (btnText) btnText.textContent = `${igProgresTeks} · ${Math.round((Date.now() - tMulai) / 1000)} dtk (biasanya 1-2 menit)...`; };
    tampilProgres();
    const ticker = setInterval(tampilProgres, 1000);
    const { berhasil, sisa, errMsg } = await igGeneratePlanForSlots(sy, sm - 1, slots, arahan,
        n => { igProgresTeks = `Menyusun ${n}/${slots.length}`; tampilProgres(); },
        { temaMinggu, temaMingguDepan, mulai: senin, akhir: minggu });
    clearInterval(ticker);
    igPlanBusy = false;
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Generate Konten';

    if (berhasil > 0) {
        igPlanResultRange = { mulai: senin, akhir: minggu };
        renderIgPlanResultList(sy, sm - 1);
        const genWrap = document.getElementById('igPlanGenerateWrap');
        const resultWrap = document.getElementById('igPlanResultWrap');
        if (genWrap) genWrap.style.display = 'none';
        if (resultWrap) resultWrap.style.display = 'block';
    }

    if (errMsg) {
        showToast(berhasil > 0
            ? `${berhasil} ide tersimpan, tapi proses berhenti: ${errMsg}. Klik Generate lagi untuk melengkapi sisanya.`
            : 'Gagal generate rencana: ' + errMsg, berhasil > 0 ? 'info' : 'error');
    } else if (sisa.length) {
        showToast(`${berhasil} ide berhasil dibuat. ${sisa.length} hari belum terisi karena hasilnya mirip konten lama atau melebihi 5 slide — klik Generate lagi untuk melengkapi (hari yang sudah jadi dipakai sebagai penyambung).`, 'info');
    } else {
        showToast(`${berhasil} ide seri "${temaMinggu}" berhasil dibuat. Cek bagian yang bertanda [cek pembimbing] sebelum diposting.`, 'success');
    }
}

// ---- Generate ulang SATU hari di daftar hasil (dengan konteks pekan) ----
// Fungsi murni (mudah dites): kumpulkan semua yang dibutuhkan AI untuk mengganti ide satu hari --
// slot hari itu, Tema Minggu, hari-hari lain di pekan yang sama sebagai penyambung, dan (khusus Minggu)
// tema pekan depan untuk teaser penutup. Return null kalau rencana tidak ada / bukan ide aktif.
function igBangunKonteksRegenHari(plans, planId) {
    const plan = (plans || []).find(pl => pl.id === planId);
    if (!plan || !plan.tanggal || plan.status !== 'idea') return null;
    const [y, m, d] = plan.tanggal.split('-').map(Number);
    if (!IG_POLA_AMIRU[new Date(y, m - 1, d).getDay()]) return null;
    const mundur = (new Date(y, m - 1, d).getDay() + 6) % 7; // jarak ke Senin (Senin = 0)
    const senin = igLocalDateKey(new Date(y, m - 1, d - mundur));
    const minggu = igLocalDateKey(new Date(y, m - 1, d - mundur + 6));

    const lain = (plans || []).filter(pl => pl.id !== plan.id && pl.tanggal && pl.tanggal >= senin && pl.tanggal <= minggu && pl.status !== 'dilewati');
    // Tema Minggu: milik rencana ini; kalau kosong (data lama), pinjam dari hari lain di pekan yang sama.
    const temaMinggu = plan.tema_minggu || (lain.find(pl => pl.tema_minggu) || {}).tema_minggu || '';
    const pola = igPolaHari(plan.tanggal, temaMinggu); // peran hari ini ikut varian pekan hari besar / penjualan
    // Hanya hari dari seri yang sama yang jadi penyambung (kalau seri diketahui); tanpa seri: semua hari di pekan itu.
    const barisPekan = lain
        .filter(pl => pl.draft_caption && (!temaMinggu || pl.tema_minggu === temaMinggu))
        .sort((a, b) => a.tanggal.localeCompare(b.tanggal))
        .map(pl => igFormatBarisPekan(pl.tanggal, pl.tema, pl.teks_gambar, pl.draft_caption, temaMinggu));

    // Teaser penutup hanya relevan untuk Minggu: ambil Tema Minggu terdekat sesudah pekan ini yang beda dari tema sekarang.
    let temaMingguDepan = '';
    if (pola.urutan === 7) {
        const depan = (plans || [])
            .filter(pl => pl.tanggal && pl.tanggal > minggu && pl.status !== 'dilewati' && pl.tema_minggu && pl.tema_minggu !== temaMinggu)
            .sort((a, b) => a.tanggal.localeCompare(b.tanggal))[0];
        if (depan) temaMingguDepan = depan.tema_minggu;
    }

    // Tipe & pilar mengikuti ide yang ada (admin mungkin sudah mengubahnya); di luar yang didukung AI, pakai pola hari.
    const tipe = (plan.tipe_konten === 'image' || plan.tipe_konten === 'carousel') ? plan.tipe_konten : pola.tipe;
    const pilar = (plan.pilar && IG_PILLARS[plan.pilar]) ? plan.pilar : pola.pilar;
    return {
        plan, tanggal: plan.tanggal, senin, minggu, temaMinggu, temaMingguDepan, barisPekan, pola,
        slot: { tanggal: plan.tanggal, hari: pola.hari, pilar, tipe_konten: tipe, urutan: pola.urutan, peran: pola.peran,
            ...(pola.catatan ? { catatan: pola.catatan } : {}) }
    };
}

// Penutup caption (paragraf terakhir sebelum hashtag) -- teaser yang dijanjikan hari itu untuk hari berikutnya.
function igCaptionPenutup(caption) {
    const baris = String(caption || '').split('\n');
    while (baris.length && (baris[baris.length - 1].trim() === '' || /^\s*(#[\p{L}\p{N}_]+\s*)+$/u.test(baris[baris.length - 1]))) baris.pop();
    const paragraf = baris.join('\n').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
    return (paragraf[paragraf.length - 1] || '').replace(/\s+/g, ' ').slice(0, 220);
}

// Arahan tambahan untuk generate ulang 1 hari: hari sebelumnya sudah menjanjikan sesuatu di penutup captionnya, dan
// hari sesudahnya sudah menyambung hari ini di pembukanya. Ide baru wajib memenuhi janji itu supaya rantai tidak putus.
// Fungsi murni. Hanya hari seri yang sama (kalau seri diketahui) & belum dilewati yang dipakai.
function igArahanTetangga(plans, plan, temaMinggu) {
    const [y, m, d] = plan.tanggal.split('-').map(Number);
    const kunci = off => igLocalDateKey(new Date(y, m - 1, d + off));
    const cari = tgl => (plans || []).find(pl => pl.id !== plan.id && pl.tanggal === tgl && pl.status !== 'dilewati'
        && pl.draft_caption && (!temaMinggu || pl.tema_minggu === temaMinggu));
    const pola = tgl => { const [yy, mm, dd] = tgl.split('-').map(Number); return IG_POLA_AMIRU[new Date(yy, mm - 1, dd).getDay()]; };
    const out = [];
    const prevT = kunci(-1), nextT = kunci(1);
    const prev = cari(prevT);
    const next = cari(nextT);
    // Senin tidak punya hari sebelumnya di pekan yang sama; Minggu tidak punya hari sesudahnya.
    if (prev && pola(prevT) && pola(prevT).urutan < pola(plan.tanggal).urutan) {
        const tutup = igCaptionPenutup(prev.draft_caption);
        if (tutup) out.push(`Penutup caption ${pola(prevT).hari} (hari sebelumnya) berbunyi: "${tutup}" -- ide baru HARUS menjawab/memenuhi teaser itu, dan pembuka captionnya menyambung ${pola(prevT).hari} lewat isi, TANPA kata rujukan (kemarin, semalam, tadi, "yang kita bahas", "melanjutkan").`);
    }
    if (next && pola(nextT) && pola(nextT).urutan > pola(plan.tanggal).urutan) {
        const buka = igFirstLine(next.draft_caption).slice(0, 160);
        if (buka) out.push(`Pembuka caption ${pola(nextT).hari} (hari sesudahnya) berbunyi: "${buka}" -- ide baru HARUS bisa disambung pembuka itu, dan penutup captionnya memancing ${pola(nextT).hari}.`);
    }
    return out;
}

// Tombol "Generate Ulang" per hari: ganti tema, teks gambar, dan caption satu hari saja (baris yang sama di-UPDATE,
// bukan ditambah), tanpa menyentuh hari lain. Ide lama ikut masuk riwayat supaya hasil barunya pasti beda sudut.
async function igRegenerasiHariPlan(planId) {
    if (!canManageProgramData()) {
        showToast('Akun Anda tidak punya izin untuk mengubah rencana konten', 'error');
        return;
    }
    if (igPlanBusy) { showToast('Masih ada proses generate yang berjalan, tunggu sebentar', 'info'); return; }
    const ctx = igBangunKonteksRegenHari(igContentPlan, planId);
    if (!ctx) { showToast('Hanya ide yang belum dijadikan post yang bisa digenerate ulang', 'info'); return; }
    const plan = ctx.plan;

    const bln = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const [ty, tm, td] = ctx.tanggal.split('-').map(Number);
    const labelHari = `${ctx.pola.hari} ${td} ${bln[tm - 1]}`;
    const ok = await openActionConfirm({
        title: 'Generate Ulang Hari Ini',
        message: `Ide <b>${escapeHtml(labelHari)}</b> (&ldquo;${escapeHtml(plan.tema)}&rdquo;) akan diganti ide baru yang tetap menyambung dengan hari lain di pekan ini. `
            + `Tema, teks di gambar, dan caption hari ini <b>ditimpa</b>, termasuk hasil edit manual. Hari lain tidak berubah.`,
        confirmLabel: 'Ya, Generate Ulang',
        danger: false
    });
    if (!ok) return;
    if (igPlanBusy) return; // dialog terbuka lama; proses lain bisa saja sudah mulai

    igPlanBusy = true;
    const btn = document.getElementById(`igPlanRegen-${planId}`);
    const btnHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Menyusun...'; }

    try {
        const bulanLabel = `${['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'][tm - 1]} ${ty}`;
        const konteksProgram = await buildIgPlanProgramContext(ty, tm - 1, ctx.tanggal);
        // Riwayat memuat ide hari ini yang lama juga -> AI diminta menghindarinya, dan hasil yang mirip ditolak.
        const riwayat = igBuildRiwayat();
        const abaikan = ctx.temaMinggu ? igTokenSet(ctx.temaMinggu) : null;
        const arahanForm = (document.getElementById('igPlanArahan')?.value || '').trim();
        const arahan = [arahanForm, `Ganti ide hari ini ("${String(plan.tema).slice(0, 100)}") dengan sudut yang BERBEDA, tetap menyambung dengan hari lain di pekan ini.`,
            ...igArahanTetangga(igContentPlan, plan, ctx.temaMinggu)]
            .filter(Boolean).join('\n');

        let hasil = null;
        for (let pass = 0; pass < IG_PLAN_MAX_PASS && !hasil; pass++) {
            const data = await igCallPlanFunction({
                bulanLabel, jumlahPost: 1, tanggalMulai: ctx.senin, tanggalAkhir: ctx.minggu,
                konteksProgram, arahan, slots: [ctx.slot], riwayatTema: igRiwayatToText(riwayat, ctx.tanggal), riwayatGaya: igRiwayatGayaToText(riwayat),
                ...(ctx.temaMinggu ? { temaMinggu: ctx.temaMinggu, ...(() => { const l = igLedgerTemaIni(riwayat, ctx.temaMinggu, ctx.senin); return { edisi: l.edisi, riwayatTemaIni: l.teks }; })() } : {}),
                ...(ctx.temaMingguDepan ? { temaMingguDepan: ctx.temaMingguDepan } : {}),
                konteksPekan: ctx.barisPekan.join('\n')
            });
            const it = (data.items || []).find(x => x && x.tanggal === ctx.tanggal && x.tema && x.draft_caption);
            if (!it) continue;
            if (igIsDuplicateIdea(it, riwayat, abaikan)) { igRiwayatAdd(riwayat, it.tema, it.teks_gambar, ''); continue; }
            hasil = it;
        }
        if (!hasil) {
            showToast('AI belum menghasilkan ide yang cukup beda dari konten lama atau melebihi 5 slide. Ide lama dipertahankan, coba klik lagi.', 'info');
            return;
        }

        // Label kecil di pojok gambar, sama seperti saat generate pekan ("Seri Talbiyah · 3/7").
        let teksGambar = igSpasiSlide(String(hasil.teks_gambar || '').trim());
        if (ctx.temaMinggu && ctx.slot.urutan) teksGambar += `${teksGambar ? '\n\n' : ''}Label gambar: Seri ${ctx.temaMinggu} · ${ctx.slot.urutan}/7`;
        const patch = {
            tema: String(hasil.tema).trim(),
            draft_caption: hasil.draft_caption,
            ...(igTeksGambarReady ? { teks_gambar: teksGambar || null } : {}),
            ...(igPlannerColsReady ? { tahap: 'ide' } : {}) // isi baru belum ditinjau -> kembali ke tahap Ide
        };
        // Hanya timpa kalau barisnya masih ide aktif (bisa saja sudah dijadikan post / dilewati dari tab lain selama menunggu AI).
        const { data: terubah, error } = await supabaseClient.from('ig_content_plan')
            .update(patch).eq('id', planId).eq('status', 'idea').select('id');
        if (error) throw error;
        if (!terubah || !terubah.length) {
            showToast('Ide ini sudah berubah status selama proses berjalan, jadi hasil baru tidak disimpan.', 'info');
            return;
        }
        await loadIgContentPlan();
        if (igDayModalDateKey) igOpenDayModal(igDayModalDateKey);
        igRefreshPlanResultListIfOpen();
        showToast(`Ide ${labelHari} diganti. Cek bagian yang bertanda [cek pembimbing] sebelum diposting.`, 'success');
    } catch (err) {
        console.error('igRegenerasiHariPlan error:', err);
        showToast('Gagal generate ulang hari ini: ' + (err.message || err), 'error');
    } finally {
        igPlanBusy = false;
        const b = document.getElementById(`igPlanRegen-${planId}`);
        if (b) { b.disabled = false; b.innerHTML = btnHtml; }
    }
}
window.igRegenerasiHariPlan = igRegenerasiHariPlan;

// ---- Salin prompt untuk AI lain (cadangan kalau token Gemini habis / edge function bermasalah) ----
// Isi prompt sistem SAMA PERSIS dengan CONTENT_PLAN_SYSTEM_PROMPT di supabase/functions/generate-ig-content-plan/index.ts
// (dijaga oleh tes di test-core.js: kalau salah satu diubah tanpa yang lain, tes gagal).
const IG_PLAN_PROMPT_SISTEM = `Kamu adalah social media strategist & copywriter untuk biro umroh "Amiru Tour" (PT Amiru Haramain Indonesia). Tugasmu menyusun PAKET KONTEN INSTAGRAM yang SALING MENYAMBUNG dalam Bahasa Indonesia: tujuh posting dalam satu pekan (Senin-Minggu) membahas SATU TEMA MINGGUAN dari tujuh sudut berurutan, supaya jamaah merasa tiap konten melanjutkan konten sebelumnya tanpa pernah menyebutnya. Tiap ide punya TEKS DI GAMBAR (pemancing pendek) dan CAPTION yang MELANJUTKAN teks gambar tersebut.

ATURAN FORMAT OUTPUT:
- Output HARUS berupa JSON array MURNI, tanpa markdown code fence, tanpa teks pembuka/penutup apa pun, cuma JSON.
- Setiap elemen array berbentuk: { "tanggal": "YYYY-MM-DD", "tema": string, "tipe_konten": "image"|"carousel" (JANGAN pernah video/Reels/live), "pilar": "storytelling"|"edukasi"|"manasik"|"kontemplasi", "sudut": string, "jembatan": string, "teks_gambar": string, "draft_caption": string }.
- Jumlah elemen HARUS sesuai jumlah yang diminta. Kalau prompt user memuat DAFTAR SLOT TANGGAL, buat TEPAT 1 ide per slot: "tanggal" persis sama dengan slot (jangan menambah, mengurangi, atau menggeser), dan pilar & tipe_konten mengikuti slot.
- Semua "tanggal" berada di dalam rentang tanggalMulai..tanggalAkhir (inklusif) dan merupakan tanggal kalender valid.
- "tema" = 1 baris singkat, judul internal untuk admin (BUKAN caption), spesifik ke sudut hari itu.
- "sudut" = 1 kalimat: apa yang BARU dibahas hari ini terhadap tema minggu (beda dari hari lain). "jembatan" = 1 kalimat: apa yang dijanjikan penutup caption untuk hari berikutnya (Minggu: teaser pekan depan). Isi keduanya DULU sebagai rencana, lalu tulis teks_gambar dan draft_caption yang konsisten dengan rencana itu. Keduanya hanya untuk perencanaan, tidak tampil di postingan.

TEMA MINGGU & KESINAMBUNGAN:
- Kalau prompt user memuat TEMA MINGGU, semua posting pekan itu membahas tema tersebut dari sudut berbeda sesuai peran hari. Kalau tidak ada, pilih SATU tema yang belum ada di RIWAYAT TEMA dan pakai konsisten untuk satu pekan (pekan berbeda = tema berbeda).
- Urutan perjalanan hati calon jamaah: rasakan > pahami > siapkan > bayangkan > hindari kesalahan > terinspirasi > renungkan. Tiap hari melanjutkan hari sebelumnya.
- Penyambung WAJIB, tapi TANPA kata rujukan: pembuka caption (kecuali Senin atau hari pertama yang dibuat tanpa konteks hari sebelumnya) menyambung hari sebelumnya lewat ISI, bukan lewat kata penghubung. DILARANG menyebut atau merujuk konten sebelumnya dengan kata "kemarin", "kemaren", "semalam", "tadi", "hari sebelumnya", "yang kita bahas", "melanjutkan", "meneruskan", "lanjutan dari", atau sejenisnya (contoh yang SALAH: "Berbekal pertimbangan matang yang kita bahas kemarin", "Meneruskan perhitungan dana dan cuti kita kemarin"). Caranya: baca penutup/jembatan hari sebelumnya, lalu buka caption langsung di adegan, pertanyaan, atau masalah yang menjadi jawaban alami dari penutup itu. Caption harus utuh bila dibaca sendiri oleh orang yang tidak melihat posting sebelumnya, sementara pembaca yang mengikuti merasakan benang merahnya dari tema, benda, perasaan, atau pertanyaan yang sama. Variasikan cara membuka tiap hari. Penutup caption memancing hari berikutnya.
- Kalau ada KONTEKS PEKAN (hari lain di pekan yang sudah jadi), sambungkan dengan hari-hari itu dan jangan mengulang sudutnya.
- Kalau ada TEMA PEKAN DEPAN, hanya Minggu yang memberi teaser tentangnya. Kalau tidak ada, Minggu cukup menutup dengan teaser umum ("minggu depan kita lanjut menyusuri perjalanan lain") TANPA menyebut topik spesifik.

POLA 7 HARI (peran tiap hari, pilar & tipe_konten ikut slot):
- SENIN = Storytelling, image, RASAKAN: momen emosional tema pekan ini di satu lokasi/peristiwa. Tutup dengan pertanyaan yang mengantar ke Selasa ("tahu nggak caranya?").
- SELASA = Manasik, image (kartu praktis), PAHAMI: tata cara/doa terkait tema, menjawab pertanyaan Senin. Tutup dengan teaser Rabu (persiapan).
- RABU = Edukasi, carousel, SIAPKAN: persiapan fisik/perlengkapan terkait tema (rotasi: fisik, dokumen, perlengkapan, kesehatan, keuangan, adab). Tutup dengan teaser Kamis.
- KAMIS = Storytelling bertahap, carousel, BAYANGKAN: satu alur waktu/perjalanan dipecah per slide (pagi > malam, atau hari pertama > terakhir). Tutup dengan teaser Jumat (kekeliruan yang sering terjadi).
- JUMAT = Edukasi, carousel, HINDARI: kesalahan umum dan FAQ calon jamaah terkait tema. Tutup dengan teaser Sabtu (cerita yang mengingatkan kenapa kita berangkat).
- SABTU = Storytelling, carousel, TERINSPIRASI: SATU cerita manusiawi yang selesai dalam 5 slide (sisi manusiawi: pertama kali, orang tua, pasangan, rindu setelah pulang, doa yang dititipkan). Berbentuk ilustrasi/umum ("banyak jamaah bercerita..."), BUKAN klaim kejadian nyata dan tanpa nama/kutipan karangan. Tutup dengan teaser Minggu (renungan makna).
- MINGGU = Kontemplasi ibadah umroh, carousel, RENUNGKAN: renungan makna tema dan hikmahnya, TANPA tokoh (beda dari Sabtu). Tutup tenang + doa singkat + teaser tema minggu depan.
- Keseimbangan: 4 hari menyentuh hati (Senin, Kamis, Sabtu, Minggu) dan 3 hari praktis (Selasa, Rabu, Jumat).
VARIAN PEKAN (hanya kalau sebuah slot membawa catatan): pekan hari besar dan pekan penjualan mengganti peran hari tertentu supaya 52 pekan tidak terasa seragam. Peran pengganti dan catatannya tertulis di DAFTAR SLOT; untuk slot itu ikuti peran dan catatan slot, bukan peran bawaan harinya. Arti peran pengganti: SAMBUT = suasana menyambut hari besar pekan ini; KENALI = makna umum hari besar dengan bahasa sederhana; AMALKAN = kebiasaan baik yang bisa dilakukan bersama keluarga; TANYA JAWAB = satu pertanyaan umum beserta jawaban singkat yang aman; RENCANAKAN = kapan dan bagaimana merencanakan umroh di musim itu; HITUNG = menyiapkan waktu, cuti, dan dana secara bertahap; PERTIMBANGKAN = pertanyaan yang pantas diajukan calon jamaah sebelum memutuskan. Aturan lain tidak berubah: pilar dan tipe_konten ikut slot, carousel maksimal 5 slide, tanpa hard-selling, tanpa harga, angka, ayat, atau hadis karangan, dan penutup praktis cukup CTA ringan. Hari tanpa catatan memakai peran bawaan.
- Kategori yang sedang DIJEDA: bukti sosial/testimoni, engagement (polling), info program. JANGAN membuatnya kecuali ARAHAN TAMBAHAN memintanya, atau kecuali KONTEKS PROGRAM memuat blok FASE PROMOSI PROGRAM PEKAN INI (aturan di bagian KONTEKS PROGRAM di bawah).

KATEGORI & FORMAT GAMBAR:
- Hanya single post (image) dan carousel, semuanya berbasis gambar. Carousel MAKSIMAL 5 SLIDE.

TEKS DI GAMBAR ("teks_gambar"):
- Single post: 2-4 baris pendek (pisahkan dengan \\n), jadi pemancing yang membuat orang berhenti scroll.
- Carousel: tulis per slide, satu slide per baris, tepat format "Slide 1: ...\\nSlide 2: ...\\nSlide 3: ...\\nSlide 4: ...\\nSlide 5: ...". Slide 1 = pemancing, Slide 2-4 = isi, Slide 5 = penutup (ajakan simpan/kirim atau doa singkat). Boleh kurang dari 5 slide, TIDAK BOLEH lebih. Jangan memakai rentang seperti "Slide 2-4".
- JANGAN diulang persis di caption; caption adalah lanjutannya. Label seri di pojok gambar ditambahkan sistem, jangan kamu tulis.

CAPTION ("draft_caption"):
- Gaya: sastrawi tapi membumi, puitis, hangat, seperti ngobrol dengan teman. Sapa pembaca dengan "kamu"; kata sehari-hari secukupnya (nggak, aja, banget) tapi tetap sopan. Hindari kata kaku: "tersedia", "silakan", "hubungi kami". Bukan bahasa brosur, bukan hard-selling.
- Utamakan momen konkret yang bisa dibayangkan (gerakan, suasana, ekspresi jamaah, kekhawatiran nyata). Fokus ke perasaan: rindu, ketenangan, proses transisi jiwa, makna di balik ibadah.
- Konten emosional (Senin, Kamis, Sabtu, Minggu): pembukaan = suasana/refleksi; isi = hubungkan dengan pengalaman batin jamaah seolah kita melihat momennya; penutup = pertanyaan hangat (rindu/doa), dan doa singkat HANYA di sebagian hari (lihat SUARA MANUSIA); hari lain boleh berhenti dengan satu kalimat pendek yang menggantung.
- Konten praktis (Selasa, Rabu, Jumat): pembukaan = masalah yang relatable; isi = poin ringkas; penutup = ajakan simpan/kirim ke teman + CTA ringan "chat WA aja ya".
- Panjang: 3-5 paragraf pendek dipisah baris kosong, sekitar 600-1200 karakter. JANGAN terlalu singkat.
- Ditutup tepat 5 hashtag di baris terakhir, tanpa label "Hashtag:". #UmrohBersamaAmiru dan #AmiruTour selalu ada, 3 lainnya relevan dengan topik.
- Ejaan selalu "Umroh" (bukan "Umrah"), termasuk di hashtag.

MUTU TULISAN (periksa diam-diam sebelum menjawab):
- Hook = baris pertama teks_gambar, maksimal sekitar 9 kata: adegan konkret, pengakuan jujur, kontras, atau pertanyaan yang spesifik. Tiap hari pakai rumus hook yang BERBEDA; rumus "Pernahkah kamu..." atau "Tahukah kamu..." maksimal sekali dalam seminggu.
- Hindari klise pembuka: "Di tengah hiruk pikuk", "Umroh bukan sekadar", "Ibadah umroh adalah", "Setiap muslim pasti", "Siapa yang tidak ingin".
- Paragraf pertama caption langsung masuk ke adegan atau masalah nyata, bukan definisi atau pengantar umum. Satu paragraf maksimal 3 kalimat, kalimat rata-rata pendek (sekitar 18 kata) supaya enak dibaca di HP.
- Satu hari = SATU gagasan utama. Jangan menumpuk beberapa topik dalam satu caption.
- Hari emosional: minimal satu detail konkret yang bisa dirasakan (suara, hawa, sentuhan, gerakan) dan satu kegelisahan yang jujur. Hari praktis: poin spesifik yang bisa langsung dikerjakan (bukan "persiapkan dirimu dengan baik") beserta alasan singkat kenapa penting.
- Kata kunci tema minggu jangan diulang-ulang; ganti dengan gambaran atau sinonim. Jangan menaruh label seperti "Hook:" atau "Caption:" di dalam isi.
- Penutup dan CTA divariasikan antarhari: "chat WA aja ya" hanya di hari praktis, dan redaksinya tidak boleh sama dua kali dalam sepekan.
- Penutup caption harus selaras dengan "jembatan" hari itu, dan pembuka caption hari berikutnya benar-benar menyambungnya.

CONTOH GAYA (hanya untuk meniru nada, kerapatan detail, dan susunan paragraf; topik contoh JANGAN dipakai sebagai ide dan kalimatnya JANGAN disalin):
[hari emosional, image, topik contoh "malam sebelum berangkat"]
teks_gambar:
Koper sudah tertutup.
Tapi hatimu belum mau tidur.
draft_caption:
Jam sebelas malam, lampu kamar tinggal satu yang menyala. Koper sudah rapi di dekat pintu, tapi kamu malah duduk di tepi kasur, memandanginya lama-lama.

Aneh ya. Berbulan-bulan menunggu hari ini, dan sekarang yang terasa justru campur aduk: senang, gugup, sedikit takut, dan rindu yang belum tahu alamatnya.

Mungkin begitulah rasanya dipanggil. Bukan cuma badan yang bersiap, tapi hati yang pelan-pelan belajar melepas semua yang ia genggam di rumah. Nggak apa-apa kalau malam ini matamu basah tanpa alasan yang jelas.

Kalau boleh menitipkan satu doa malam ini, apa yang ingin kamu titipkan? Semoga langkah pertamamu besok diringankan dan hatimu dilapangkan.

#UmrohBersamaAmiru #AmiruTour #MalamSebelumBerangkat #PersiapanUmroh #CeritaUmroh

[hari praktis, carousel, topik contoh "salinan dokumen"]
teks_gambar:
Slide 1: Satu hal kecil yang sering bikin panik di bandara
Slide 2: Foto paspor dan dokumen perjalananmu sekarang
Slide 3: Simpan di HP, kirim juga ke satu anggota keluarga
Slide 4: Catat nomor penting di kertas, jaga-jaga HP mati
Slide 5: Simpan postingan ini biar nggak lupa
draft_caption:
Pernah nggak, tanganmu refleks menepuk saku berkali-kali cuma buat memastikan dokumen masih ada? Di perjalanan sepanjang itu, rasa waswas kecil begini bisa mencuri ketenangan yang seharusnya kamu simpan untuk ibadah.

Kabar baiknya, ketenangan itu bisa dicicil dari rumah. Foto dokumen pentingmu sekarang, simpan di HP, lalu kirim juga ke satu orang yang kamu percaya. Tulis nomor-nomor penting di selembar kertas kecil, karena baterai HP kadang habis di saat yang paling nggak tepat.

Nggak butuh waktu lama, mungkin sepuluh menit sambil menunggu nasi matang. Tapi nanti di sana, kamu bisa melangkah dengan dada yang lebih ringan.

Simpan postingan ini dan kirim ke temanmu yang juga lagi bersiap. Kalau ada yang masih bikin ragu, chat WA aja ya.

#UmrohBersamaAmiru #AmiruTour #PersiapanUmroh #TipsUmroh #SiapBerangkat

SUARA MANUSIA (supaya tidak terasa buatan AI):
- Tulis seperti teman yang bercerita lewat chat, bukan pidato atau brosur. Detail harus spesifik dan agak tak terduga: benda, bau, suara, kejadian kecil (sandal tertukar di depan pintu masjid, antre wudhu, kaki pegal, air zamzam yang dingin, tas kecil yang dipeluk terus). Hindari kata abstrak berlapis ("keindahan spiritual", "kedamaian jiwa").
- Ritme kalimat jangan seragam: campur kalimat agak panjang dengan yang sangat pendek, sesekali kalimat tanpa subjek ("Pelan-pelan aja."). Paragraf boleh hanya satu kalimat. Boleh ada sikap atau pendapat kecil yang lembut, tidak semuanya netral dan manis.
- DILARANG: pola kontras "bukan sekadar X, tapi Y" / "bukan hanya X melainkan Y"; daftar tiga kata berirama ("rindu, tenang, dan syukur") lebih dari sekali dalam satu caption; kalimat penutup ala kata mutiara; "Mari kita"; kata/frasa "relung hati", "hiruk pikuk", "perjalanan spiritual", "tak terhingga", "senantiasa", "tentunya", "sejatinya", "di sanalah", "di situlah"; tanda pisah panjang (em dash dan en dash) dan titik koma (pakai titik atau koma); tanda seru beruntun; huruf kapital semua.
- Maksimal 2 tanda tanya dalam satu caption. Emoji maksimal 1, boleh nol.
- Jangan satu cetakan tiap hari (adegan > refleksi > pertanyaan > doa). Ganti bentuknya antarhari: ada yang dibuka dialog singkat, ada pengakuan jujur, ada daftar pendek, ada yang berhenti menggantung tanpa doa. Doa penutup TIDAK wajib tiap hari: pakai hanya di sebagian hari emosional (maksimal 3 dari 7 hari dalam sepekan; MINGGU selalu menjadi salah satunya, jadi Senin sampai Sabtu paling banyak 2 hari).
- Jangan mengaku pengalaman pribadi atau kejadian nyata yang dikarang ("dulu aku...", "seorang jamaah kami bilang..."). Pakai "kamu" dan "kita".
- Uji akhir: bacakan dalam hati. Kalau terdengar seperti pidato atau iklan, tulis ulang lebih pendek dan lebih spesifik.

ANTI-PENGULANGAN (PENTING):
- Satu topik hanya sekali dalam 6 bulan terakhir; sudut baru atas topik lama baru boleh muncul setelah jeda minimal 6 bulan (RIWAYAT TEMA hanya memuat 6 bulan terakhir). Setiap ide HARUS berbeda dari RIWAYAT TEMA dan dari sesama ide dalam jawaban: beda topik inti, sudut pandang, hook (teks_gambar), dan kalimat pembuka caption. Mengganti beberapa kata TIDAK dianggap berbeda. Kalau ragu sebuah ide mirip riwayat, ganti.
- Bank topik per hari: Senin = matriks lokasi x momen x perasaan; Selasa = kurikulum manasik berurutan (miqat, niat, talbiyah, thawaf, doa, sa'i, tahallul, adab); Rabu = rotasi kategori persiapan; Kamis = alur/tokoh berbeda tiap seri; Jumat = kesalahan umum & FAQ; Sabtu = sisi manusiawi; Minggu = makna rukun/wajib dan hikmahnya.
- Topik yang SUDAH PERNAH dipakai (awal pola, sebelum 12 Oktober 2026; jangan diulang sebelum 12 April 2027): niat umroh; pertama kali lihat Ka'bah; sa'i dan kisah Siti Hajar; Raudhah; subuh di Madinah; bawaan yang sering ketinggalan; kesalahan umum thawaf; urutan umroh (ihram, thawaf, sa'i, tahallul); larangan ihram; persiapan fisik; hari terakhir di Makkah; Makkah atau Madinah; umroh bersama orang tua; mulai dari yang kecil / menabung niat.
- Kalau ada EDISI ke-2 atau lebih (tema yang sama kembali di tahun/siklus berikutnya), daftar ide lamanya diberikan tanpa batas umur. Tema boleh sama, tapi tiap hari HARUS membahas sudut yang benar-benar baru: jangan menulis ulang topik, hook, atau pembuka lama dengan kata yang diganti.
- Kalau ada daftar IDE YANG SUDAH ADA, jangan mengulang topiknya dan jangan menaruh ide baru di tanggal yang sama.
- Kalau ada daftar HOOK & PEMBUKA CAPTION 20 POSTING TERAKHIR, hook (teks_gambar baris pertama) dan 3 kata pertama pembuka caption TIDAK boleh sama atau mirip dengan daftar itu, juga tidak antarhari dalam jawaban yang sama. Variasikan rumus pembuka antarhari.

KEJUJURAN & KEHATI-HATIAN:
- JANGAN mengarang ayat, hadis, atau lafaz/doa berbahasa Arab. Untuk lafaz dan tata cara tulis "sesuai manasik dari pembimbing". Soal agama dan hukum ibadah tulis secara umum, tanpa fatwa; tandai di akhir kolom "tema" dengan "[cek pembimbing]" kalau memuat tata cara, hukum, atau lafaz (menyebut kata \"doa\" atau nama ritual saja TIDAK perlu ditandai).
- JANGAN menulis kalimat bertanda "Rasulullah bersabda", "Allah berfirman", "QS.", "HR." ataupun terjemahan ayat/hadis. Cukup sampaikan makna secara umum dan arahkan ke pembimbing.
- JANGAN menulis statistik, persentase, atau klaim jumlah jamaah ("ribuan jamaah", "98%").
- JANGAN mengarang testimoni, nama jamaah, angka, harga, tanggal, hotel, atau fasilitas. Kalau butuh data yang tidak ada di prompt, pakai placeholder [bulan], [hotel], [nomor WA].
- Cerita Sabtu dan renungan Minggu bersifat ilustrasi/umum, bukan klaim kejadian nyata.
- JANGAN membuat janji berlebihan ("pasti mabrur", "dijamin berangkat", "seat pasti ada").
- KONTEKS PROGRAM dipakai dalam dua keadaan: (a) ARAHAN TAMBAHAN meminta menyelipkan info program, atau (b) konteks memuat blok FASE PROMOSI PROGRAM PEKAN INI. Pada (b) sisipkan promosi hanya di 1 sampai 2 hari, pilih hari praktis (Selasa, Rabu, atau Jumat) dan tulis sesuai fase program itu; Senin, Kamis, Sabtu, dan Minggu tetap mengikuti tema pekan supaya cerita dan renungan terjaga. Kalau DAFTAR SLOT hanya berisi satu hari, sisipkan promosi hanya bila hari itu praktis dan KONTEKS PEKAN belum memuat dua hari promosi. Tanpa blok fase dan tanpa arahan, abaikan konteks program. Saat dipakai, sebut tanggal/harga/sisa seat PERSIS seperti di konteks, utamakan keberangkatan yang masih jauh, jangan menawarkan program yang sudah berangkat atau penuh (sisa 0), dan jangan menulis "seat tinggal sedikit" kecuali sisa seat <= 10.`;

// Susun satu teks prompt utuh yang bisa ditempel ke ChatGPT / Claude / AI lain. Fungsi murni (mudah dites):
// bagian "permintaan" mengikuti susunan userMsg di edge function, bagian kosong dibuang.
// f: { bulanLabel, tanggalMulai, tanggalAkhir, temaMinggu, temaMingguDepan, slots, konteksPekan, arahan, konteksProgram, riwayatTema, riwayatGaya }
function igSusunPromptEksternal(f) {
    const slots = Array.isArray(f.slots) ? f.slots : [];
    const bagian = [
        `Susun paket konten Instagram yang saling menyambung untuk ${f.bulanLabel} (rentang tanggal ${f.tanggalMulai} s/d ${f.tanggalAkhir}), sebanyak TEPAT ${slots.length} ide post.`,
        [
            f.temaMinggu ? `TEMA MINGGU: ${f.temaMinggu}` : 'TEMA MINGGU: (tidak diisi, pilih sendiri satu tema yang belum ada di riwayat)',
            f.temaMingguDepan ? `TEMA PEKAN DEPAN (untuk teaser penutup Minggu): ${f.temaMingguDepan}` : ''
        ].filter(Boolean).join('\n')
    ];
    if (slots.length) {
        bagian.push('DAFTAR SLOT TANGGAL (isi TEPAT 1 ide per slot, tanggal persis sama, ikuti pilar & tipe_konten-nya):\n'
            + slots.map(s => `- ${s.tanggal}${s.hari ? ` (${s.hari})` : ''}${s.peran ? ` | peran: ${s.peran}` : ''} | pilar: ${s.pilar} | tipe_konten: ${s.tipe_konten}${s.catatan ? ` | catatan: ${s.catatan}` : ''}`).join('\n'));
    }
    if (f.konteksPekan && String(f.konteksPekan).trim()) {
        bagian.push('KONTEKS PEKAN (hari lain di pekan ini yang sudah jadi; sambungkan, jangan ulangi sudutnya):\n' + String(f.konteksPekan).trim().slice(0, 3000));
    }
    if (f.arahan && String(f.arahan).trim()) bagian.push('ARAHAN TAMBAHAN DARI ADMIN:\n' + String(f.arahan).trim().slice(0, 1500));
    bagian.push('KONTEKS PROGRAM (dipakai kalau ARAHAN TAMBAHAN meminta info program, atau kalau ada blok FASE PROMOSI PROGRAM PEKAN INI di dalamnya):\n'
        + (f.konteksProgram && String(f.konteksProgram).trim() ? String(f.konteksProgram) : '(tidak ada data program spesifik untuk periode ini)'));
    if (f.riwayatTema && String(f.riwayatTema).trim()) {
        bagian.push('RIWAYAT TEMA, SUDAH PERNAH DIBUAT (jangan diulang & jangan dibuat mirip):\n' + String(f.riwayatTema).slice(0, 20000));
    }
    if (f.riwayatTemaIni && String(f.riwayatTemaIni).trim()) {
        bagian.push(`EDISI ke-${f.edisi || 2} dari tema "${f.temaMinggu}". Ide di bawah SUDAH PERNAH dibuat untuk tema ini (umur berapa pun). Semua topik, sudut, hook, dan pembuka caption pekan ini HARUS berbeda dari daftar ini:\n` + String(f.riwayatTemaIni).slice(0, 4000));
    }
    if (f.riwayatGaya && String(f.riwayatGaya).trim()) {
        bagian.push('HOOK & PEMBUKA CAPTION 20 POSTING TERAKHIR (hook dan 3 kata pertama pembuka caption TIDAK boleh sama atau mirip dengan ini):\n' + String(f.riwayatGaya).slice(0, 6000));
    }
    bagian.push('Ingat: balas HANYA dengan JSON array sesuai format yang sudah dijelaskan, tidak ada teks lain.');

    return [
        'Ikuti INSTRUKSI SISTEM lalu kerjakan PERMINTAAN di bawah. Balas hanya dengan JSON array (tanpa code fence dan tanpa teks lain).',
        '=== INSTRUKSI SISTEM ===\n' + IG_PLAN_PROMPT_SISTEM,
        '=== PERMINTAAN ===\n' + bagian.join('\n\n')
    ].join('\n\n');
}

async function igSalinTeks(teks) {
    try {
        await navigator.clipboard.writeText(teks);
        return true;
    } catch (e) {
        try {
            const ta = document.createElement('textarea');
            ta.value = teks;
            ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return !!ok;
        } catch (e2) { return false; }
    }
}

// Tombol "Salin Prompt": memakai input form yang sama dengan "Generate dengan AI" (pekan, Tema Minggu, tema depan,
// arahan) dan konteks yang sama (hari kosong, riwayat konten lama, hari yang sudah jadi, program aktif),
// tapi TIDAK memanggil AI maupun menyimpan apa pun.
async function igSalinPromptPlan() {
    if (igPlanBusy) { showToast('Masih ada proses generate yang berjalan, tunggu sebentar', 'info'); return; }
    const senin = document.getElementById('igPlanWeek')?.value;
    if (!senin) { showToast('Pilih bulan dan pekan dulu', 'error'); return; }
    const temaEl = document.getElementById('igPlanTema');
    const temaMinggu = (temaEl?.value || '').trim();
    if (!temaMinggu) {
        showToast('Isi Tema Minggu dulu (contoh: Talbiyah) supaya ketujuh konten menyambung', 'error');
        if (temaEl) temaEl.focus();
        return;
    }
    const slots = igBuildSlotPekan(senin, igTanggalTerisiSet(), igLocalDateKey(new Date()), temaMinggu);
    if (!slots.length) {
        showToast('Tidak ada hari kosong yang tersisa di pekan ini (sudah lewat atau sudah terisi semua)', 'info');
        return;
    }
    const [sy, sm, sd] = senin.split('-').map(Number);
    const minggu = igLocalDateKey(new Date(sy, sm - 1, sd + 6));
    const namaBulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    igPlanBusy = true;
    const btn = document.getElementById('btnIgCopyPlanPrompt');
    if (btn) btn.disabled = true;
    try {
        const konteksProgram = await buildIgPlanProgramContext(sy, sm - 1, senin);
        const konteksPekan = igContentPlan
            .filter(pl => pl.tanggal && pl.tanggal >= senin && pl.tanggal <= minggu && pl.status !== 'dilewati' && pl.draft_caption)
            .sort((a, b) => a.tanggal.localeCompare(b.tanggal))
            .map(pl => igFormatBarisPekan(pl.tanggal, pl.tema, pl.teks_gambar, pl.draft_caption, temaMinggu))
            .join('\n');
        const prompt = igSusunPromptEksternal({
            bulanLabel: `${namaBulan[sm - 1]} ${sy}`, tanggalMulai: senin, tanggalAkhir: minggu,
            temaMinggu, temaMingguDepan: (document.getElementById('igPlanTemaDepan')?.value || '').trim(),
            slots, konteksPekan, konteksProgram,
            arahan: (document.getElementById('igPlanArahan')?.value || '').trim(),
            riwayatTema: igRiwayatToText(igBuildRiwayat(), senin),
            riwayatGaya: igRiwayatGayaToText(igBuildRiwayat()),
            ...(() => { const l = igLedgerTemaIni(igBuildRiwayat(), temaMinggu, senin); return { edisi: l.edisi, riwayatTemaIni: l.teks }; })()
        });
        if (await igSalinTeks(prompt)) {
            showToast(`Prompt disalin (${prompt.length.toLocaleString('id-ID')} karakter, ${slots.length} hari). Tempel ke ChatGPT, Claude, atau asisten lain, lalu minta balasan JSON.`, 'success');
        } else {
            showToast('Browser menolak akses clipboard. Coba lagi lewat klik langsung atau izinkan akses clipboard.', 'error');
        }
    } catch (err) {
        console.error('igSalinPromptPlan error:', err);
        showToast('Gagal menyusun prompt: ' + (err.message || err), 'error');
    } finally {
        igPlanBusy = false;
        if (btn) btn.disabled = false;
    }
}
window.igSalinPromptPlan = igSalinPromptPlan;

// ---- Render daftar hasil rencana (dalam modal, setelah generate) ----
function renderIgPlanResultList(year, month) {
    const listEl = document.getElementById('igPlanResultList');
    const countEl = document.getElementById('igPlanResultCount');
    if (!listEl) return;

    const items = igContentPlan.filter(pl => {
        if (!pl.tanggal) return false;
        if (igPlanResultRange) return pl.tanggal >= igPlanResultRange.mulai && pl.tanggal <= igPlanResultRange.akhir;
        const [py, pm] = pl.tanggal.split('-').map(Number);
        return py === year && (pm - 1) === month;
    }).sort((a, b) => a.tanggal.localeCompare(b.tanggal));

    if (countEl) {
        const ideaCount = items.filter(i => i.status === 'idea').length;
        countEl.textContent = `${items.length} rencana ${igPlanResultRange ? 'pekan ini' : 'bulan ini'} (${ideaCount} belum dijadikan post)`;
    }

    if (!items.length) {
        listEl.innerHTML = `<div class="ig-empty"><i class="bi bi-calendar-x"></i> Belum ada rencana untuk ${igPlanResultRange ? 'pekan' : 'bulan'} ini.</div>`;
        return;
    }

    const statusBadge = {
        idea: '<span class="ig-status-pill ig-status-pill-plan"><i class="bi bi-magic"></i> Rencana</span>',
        dijadikan_post: '<span class="ig-status-pill" style="background:var(--success)1a;color:var(--success);"><i class="bi bi-check-circle-fill"></i> Sudah jadi Post</span>',
        dilewati: '<span class="ig-status-pill" style="background:var(--ink-soft)1a;color:var(--ink-soft);"><i class="bi bi-slash-circle"></i> Dilewati</span>'
    };

    listEl.innerHTML = items.map(pl => {
        const [, pm, d] = pl.tanggal.split('-');
        const bulanPendek = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][parseInt(pm, 10) - 1];
        const hariPendek = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'][new Date(parseInt(pl.tanggal.slice(0, 4), 10), parseInt(pm, 10) - 1, parseInt(d, 10)).getDay()];
        const tglLabel = `<small>${hariPendek}</small><b>${parseInt(d, 10)}</b><span>${bulanPendek}</span>`;
        const isIdea = pl.status === 'idea';
        const actions = isIdea
            ? `<button type="button" class="btn-secondary" onclick="igConvertPlanToPost('${pl.id}')" style="font-size:11px;padding:4px 10px;"><i class="bi bi-arrow-up-right-circle"></i> Jadikan Post</button>
               <button type="button" class="btn-secondary" id="igPlanRegen-${pl.id}" onclick="igRegenerasiHariPlan('${pl.id}')" style="font-size:11px;padding:4px 10px;" title="Ganti ide hari ini, tetap menyambung dengan hari lain di pekan ini"><i class="bi bi-arrow-repeat"></i> Generate Ulang</button>
               <button type="button" class="btn-secondary" onclick="igSkipPlanItem('${pl.id}')" style="font-size:11px;padding:4px 10px;" title="Lewati (sembunyikan dari kalender)"><i class="bi bi-eye-slash"></i></button>
               <button type="button" class="btn-secondary ig-btn-danger" onclick="igDeletePlanItem('${pl.id}')" style="font-size:11px;padding:4px 10px;" title="Hapus"><i class="bi bi-trash"></i></button>`
            : (pl.status === 'dilewati'
                ? `<button type="button" class="btn-secondary" onclick="igRestorePlanItem('${pl.id}')" style="font-size:11px;padding:4px 10px;" title="Kembalikan jadi ide aktif"><i class="bi bi-arrow-counterclockwise"></i> Pulihkan</button>`
                : '');

        // Item 'idea' bisa diedit langsung di sini (tema, tipe konten, draft caption) --
        // auto-save saat blur/change (tanpa perlu tombol Simpan terpisah), supaya admin
        // bisa poles hasil generate sebelum "Jadikan Post" tanpa keluar-masuk modal.
        const topAndCaption = isIdea
            ? `<div class="ig-plan-result-top">
                    <input type="text" class="ig-plan-edit-tema" value="${escapeHtmlAttr(pl.tema)}" maxlength="120"
                        onblur="igPlanUpdateField('${pl.id}','tema',this.value)"
                        onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">
                    <select class="ig-plan-edit-tipe" onchange="igPlanUpdateField('${pl.id}','tipe_konten',this.value)">
                        <option value="image"${pl.tipe_konten === 'image' ? ' selected' : ''}>Image</option>
                        <option value="video"${pl.tipe_konten === 'video' ? ' selected' : ''}>Video/Reels</option>
                        <option value="carousel"${pl.tipe_konten === 'carousel' ? ' selected' : ''}>Carousel</option>
                    </select>
                    <span class="ig-plan-save-indicator" id="igPlanSaved-${pl.id}"></span>
               </div>
               ${igTeksGambarReady ? `<textarea class="ig-plan-edit-caption ig-plan-edit-imgtext" rows="2" maxlength="800" placeholder="Teks di gambar (single: 2–4 baris; carousel: maks 5 slide)"
                   onblur="igPlanUpdateField('${pl.id}','teks_gambar',this.value)">${escapeHtml(igSpasiSlide(pl.teks_gambar || ''))}</textarea>` : ''}
               <textarea class="ig-plan-edit-caption" rows="3"
                   onblur="igPlanUpdateField('${pl.id}','draft_caption',this.value)">${escapeHtml(pl.draft_caption || '')}</textarea>`
            : `<div class="ig-plan-result-top">
                    <strong>${escapeHtml(pl.tema)}</strong>
                    ${statusBadge[pl.status] || ''}
                </div>
                <p class="ig-plan-caption-preview">${escapeHtml((pl.draft_caption || '').slice(0, 140))}${(pl.draft_caption || '').length > 140 ? '…' : ''}</p>`;

        const pilarMeta = pl.pilar && IG_PILLARS[pl.pilar]
            ? `<div class="ig-plan-result-pilar" style="--pillar:${IG_PILLARS[pl.pilar].color}">${escapeHtml(igPolaPilarLabel(pl.pilar))}${pl.tema_minggu ? ' · Seri ' + escapeHtml(pl.tema_minggu) : ''}</div>`
            : '';
        return `<div class="ig-plan-result-item">
            <div class="ig-plan-result-date">${tglLabel}</div>
            <div class="ig-plan-result-body">
                ${pilarMeta}
                ${topAndCaption}
                <div class="ig-plan-result-actions">${actions}</div>
            </div>
        </div>`;
    }).join('');
}

// ---- Auto-save 1 field hasil edit inline di list rencana (tema/tipe_konten/draft_caption/pilar/tahap) ----
// Cache lokal diperbarui LEBIH DULU (optimistik) lalu dibalikkan kalau simpan gagal, supaya render
// ulang modal/kalender yang terjadi sebelum request selesai tidak menampilkan teks lama.
const igPlanPendingSaves = new Set();

// Sinkronkan teks kartu di modal harian tanpa render ulang (render ulang akan menutup editor yang sedang terbuka)
function igSyncPlanCardDom(plan, field) {
    const card = document.getElementById(`igDayPlanItem-${plan.id}`);
    if (!card) return;
    if (field === 'tema') {
        const t = card.querySelector('.ig-dm-card-title');
        if (t) t.textContent = plan.tema || '';
    } else if (field === 'canva_url') {
        const icons = card.querySelector('.ig-dm-icons');
        if (icons) {
            const old = icons.querySelector('.ig-dm-canva');
            if (old) old.remove();
            const html = igCanvaBtnHtml(igCanvaUrlFor(plan));
            if (html) icons.insertAdjacentHTML('afterbegin', html);
        }
        const inp = card.querySelector('.ig-dm-canva-input');
        if (inp && document.activeElement !== inp) inp.value = igCanvaUrlFor(plan);
    } else if (field === 'draft_caption') {
        const p = card.querySelector('.ig-dm-cap');
        if (p) {
            const cap = plan.draft_caption || '';
            p.textContent = cap || 'Belum ada caption \u2014 klik untuk menulis';
            p.classList.toggle('ig-dm-cap-empty', !cap);
        }
    }
}

async function igPlanUpdateField(planId, field, value) {
    const allowedFields = ['tema', 'tipe_konten', 'draft_caption', 'pilar', 'tahap', 'teks_gambar'];
    if (field === 'teks_gambar' && !igTeksGambarReady) return; // kolom belum ada (migrasi belum dijalankan)
    if (!allowedFields.includes(field)) return;

    const plan = igContentPlan.find(pl => pl.id === planId);
    if (!plan) return;
    const oldValue = plan[field] || '';
    const newValue = (value || '').trim();
    if (newValue === oldValue) return; // tidak berubah, skip request
    if (field === 'tema' && !newValue) { showToast('Tema tidak boleh kosong', 'error'); return; }

    const affectsCalendar = ['tema', 'tipe_konten', 'pilar', 'tahap'].includes(field); // dipakai di chip kalender
    plan[field] = newValue; // optimistik
    igSyncPlanCardDom(plan, field);
    if (affectsCalendar) renderIgCalendar();

    const job = (async () => {
        try {
            const { error } = await supabaseClient.from('ig_content_plan')
                .update({ [field]: ((field === 'pilar' || field === 'teks_gambar') && !newValue) ? null : newValue }).eq('id', planId);
            if (error) throw error;

            const indicator = document.getElementById(`igPlanSaved-${planId}`);
            if (indicator) {
                indicator.innerHTML = '<i class="bi bi-check-circle-fill"></i> Tersimpan';
                indicator.classList.add('show');
                clearTimeout(indicator._hideTimer);
                indicator._hideTimer = setTimeout(() => indicator.classList.remove('show'), 1800);
            }
        } catch (err) {
            console.error('igPlanUpdateField error:', err);
            plan[field] = oldValue; // balikkan cache
            igSyncPlanCardDom(plan, field);
            if (affectsCalendar) renderIgCalendar();
            showToast('Gagal menyimpan perubahan: ' + err.message, 'error');
        }
    })();
    igPlanPendingSaves.add(job);
    try { await job; } finally { igPlanPendingSaves.delete(job); }
}

// ---- Konversi 1 item rencana jadi post asli (buka modal upload, caption pre-fill) ----
function igConvertPlanToPost(planId) {
    const plan = igContentPlan.find(pl => pl.id === planId);
    if (!plan) return;

    closeIgDayModal();
    closeIgContentPlanModal();

    openIgUploadModal(null, plan.tanggal);
    igActivePlanId = planId;

    const captionEl = document.getElementById('ig_caption');
    if (captionEl) {
        captionEl.value = plan.draft_caption || '';
        const remaining = 2200 - captionEl.value.length;
        const countEl = document.getElementById('igCaptionCount');
        if (countEl) countEl.textContent = Math.max(0, remaining);
    }
    const mediaTypeEl = document.getElementById('ig_media_type');
    if (mediaTypeEl && plan.tipe_konten) {
        mediaTypeEl.value = plan.tipe_konten;
        onIgMediaTypeChange();
    }
    // Tujuan caption AI mengikuti pilar rencana (storytelling/edukasi/manasik/kontemplasi/...), kalau opsinya ada.
    const goalEl = document.getElementById('ig_caption_goal');
    if (goalEl && plan.pilar && [...goalEl.options].some(o => o.value === plan.pilar)) goalEl.value = plan.pilar;
    showToast('Draft caption dari rencana sudah diisi — tinggal upload media & simpan', 'info');
}

// ---- Lewati 1 item rencana (disembunyikan dari kalender, bukan dihapus) ----
async function igSkipPlanItem(planId) {
    try {
        const { error } = await supabaseClient.from('ig_content_plan').update({ status: 'dilewati' }).eq('id', planId);
        if (error) throw error;
        await loadIgContentPlan();
        showToast('Rencana dilewati', 'success');
        if (igDayModalDateKey) igOpenDayModal(igDayModalDateKey);
        // Refresh tampilan hasil di modal (kalau sedang terbuka)
        const resultWrap = document.getElementById('igPlanResultWrap');
        if (resultWrap && resultWrap.style.display !== 'none') {
            const monthVal = document.getElementById('igPlanMonth')?.value;
            if (monthVal) {
                const [y, m] = monthVal.split('-').map(Number);
                renderIgPlanResultList(y, m - 1);
            }
        }
    } catch (err) {
        showToast('Gagal melewati rencana: ' + err.message, 'error');
    }
}

// ---- Refresh daftar hasil di modal "Perencanaan Konten" kalau sedang terbuka ----
function igRefreshPlanResultListIfOpen() {
    const resultWrap = document.getElementById('igPlanResultWrap');
    if (resultWrap && resultWrap.style.display !== 'none') {
        const monthVal = document.getElementById('igPlanMonth')?.value;
        if (monthVal) {
            const [y, m] = monthVal.split('-').map(Number);
            renderIgPlanResultList(y, m - 1);
        }
    }
}

// ---- Pulihkan ide yang sebelumnya dilewati (status 'dilewati' -> 'idea') ----
async function igRestorePlanItem(planId) {
    if (!canManageProgramData()) {
        showToast('Akun Anda tidak punya izin untuk mengubah rencana konten', 'error');
        return;
    }
    try {
        const { error } = await supabaseClient.from('ig_content_plan').update({ status: 'idea' }).eq('id', planId);
        if (error) throw error;
        await loadIgContentPlan();
        showToast('Ide dipulihkan', 'success');
        if (igDayModalDateKey) igOpenDayModal(igDayModalDateKey);
        igRefreshPlanResultListIfOpen();
    } catch (err) {
        showToast('Gagal memulihkan ide: ' + err.message, 'error');
    }
}
window.igRestorePlanItem = igRestorePlanItem;

// ---- Hapus 1 item rencana permanen ----
async function igDeletePlanItem(planId) {
    try {
        const { error } = await supabaseClient.from('ig_content_plan').delete().eq('id', planId);
        if (error) throw error;
        await loadIgContentPlan();
        showToast('Rencana dihapus', 'success');
        if (igDayModalDateKey) igOpenDayModal(igDayModalDateKey);
        const resultWrap = document.getElementById('igPlanResultWrap');
        if (resultWrap && resultWrap.style.display !== 'none') {
            const monthVal = document.getElementById('igPlanMonth')?.value;
            if (monthVal) {
                const [y, m] = monthVal.split('-').map(Number);
                renderIgPlanResultList(y, m - 1);
            }
        }
    } catch (err) {
        showToast('Gagal menghapus rencana: ' + err.message, 'error');
    }
}

// ============================================================
// 24d. POLA 7 HARI AMIRU (satu tema mingguan, tujuh posting yang menyambung)
// Sumber acuan: pola-konten.md bagian 3. Tema satu pekan dibagi ke 7 sudut berurutan
// (rasakan > pahami > siapkan > bayangkan > hindari > terinspirasi > renungkan):
//   Senin  = Storytelling, image                      · RASAKAN
//   Selasa = Manasik, image (kartu praktis)           · PAHAMI
//   Rabu   = Edukasi, carousel                        · SIAPKAN
//   Kamis  = Storytelling bertahap, carousel          · BAYANGKAN
//   Jumat  = Edukasi, carousel                        · HINDARI (kesalahan umum & FAQ)
//   Sabtu  = Storytelling, carousel                   · TERINSPIRASI (cerita manusiawi)
//   Minggu = Kontemplasi ibadah umroh, carousel       · RENUNGKAN (tanpa tokoh)
// Hanya single post (image) & carousel (MAKSIMAL 5 slide), tanpa video. Bukti sosial,
// engagement, dan info program sedang DIJEDA (pilar lamanya tetap valid untuk data lama).
// Tiap ide = teks di gambar (pemancing pendek) + caption (lanjutan, bukan pengulangan)
// + 5 hashtag di akhir caption. Semua slot "kosong" di bawah adalah kerangka manual;
// isi lewat AI (tombol Generate) atau ganti bagian [isi ...] dengan data asli.
// Pilar `kontemplasi` ditambahkan untuk Minggu; `urutan` = posisi hari di label "Seri [Tema] · n/7".
// ============================================================
const IG_POLA_AMIRU = {
    1: { // Senin
        hari: 'Senin', urutan: 1, peran: 'Rasakan', pilar: 'storytelling', tipe: 'image',
        kosong: { tema: 'Rasakan — isi momen emosional tema minggu ini', teks: '[isi 2-4 baris pendek: momen emosional]\n[tutup dengan pertanyaan yang mengantar ke Selasa]' },
        isi: []
    },
    2: { // Selasa
        hari: 'Selasa', urutan: 2, peran: 'Pahami', pilar: 'manasik', tipe: 'image',
        kosong: { tema: 'Pahami — isi tata cara / doa terkait tema (cek pembimbing)', teks: '[isi 2-4 baris pendek: kartu praktis tata cara]\n[lafaz & tata cara: sesuai manasik dari pembimbing]' },
        isi: []
    },
    3: { // Rabu
        hari: 'Rabu', urutan: 3, peran: 'Siapkan', pilar: 'edukasi', tipe: 'carousel',
        kosong: { tema: 'Siapkan (carousel) — isi persiapan fisik / perlengkapan terkait tema', teks: 'Slide 1: [isi pertanyaan pemancing]\nSlide 2: [isi satu poin persiapan]\nSlide 3: [isi satu poin persiapan]\nSlide 4: [isi satu poin persiapan]\nSlide 5: Simpan, biar nggak panik nanti.' },
        isi: []
    },
    4: { // Kamis
        hari: 'Kamis', urutan: 4, peran: 'Bayangkan', pilar: 'storytelling', tipe: 'carousel',
        kosong: { tema: 'Bayangkan (carousel) — isi alur waktu / perjalanan per slide', teks: 'Slide 1: [isi kalimat pemancing]\nSlide 2: [isi awal alur waktu]\nSlide 3: [isi tengah alur]\nSlide 4: [isi akhir alur]\nSlide 5: [isi penutup / ajakan ringan]' },
        isi: []
    },
    5: { // Jumat
        hari: 'Jumat', urutan: 5, peran: 'Hindari', pilar: 'edukasi', tipe: 'carousel',
        kosong: { tema: 'Hindari (carousel) — isi kesalahan umum / FAQ terkait tema', teks: 'Slide 1: [isi kesalahan yang sering terjadi]\nSlide 2: [isi kesalahan 1 + cara menghindarinya]\nSlide 3: [isi kesalahan 2 + cara menghindarinya]\nSlide 4: [isi kesalahan 3 atau FAQ singkat]\nSlide 5: Simpan & kirim ke temanmu yang mau berangkat.' },
        isi: []
    },
    6: { // Sabtu
        hari: 'Sabtu', urutan: 6, peran: 'Terinspirasi', pilar: 'storytelling', tipe: 'carousel',
        kosong: { tema: 'Terinspirasi (carousel) — isi cerita manusiawi ilustrasi (bukan klaim kejadian nyata)', teks: 'Slide 1: [isi kalimat pemancing]\nSlide 2: [isi awal cerita]\nSlide 3: [isi tengah cerita]\nSlide 4: [isi akhir cerita]\nSlide 5: [isi penutup + doa singkat]' },
        isi: []
    },
    0: { // Minggu
        hari: 'Minggu', urutan: 7, peran: 'Renungkan', pilar: 'kontemplasi', tipe: 'carousel',
        kosong: { tema: 'Renungkan (carousel) — isi makna tema, tanpa tokoh', teks: 'Slide 1: [isi pertanyaan renungan]\nSlide 2: [isi makna 1]\nSlide 3: [isi makna 2]\nSlide 4: [isi hikmah]\nSlide 5: [isi doa singkat + teaser tema minggu depan]' },
        isi: []
    }
};
const IG_URUTAN_PEKAN = [1, 2, 3, 4, 5, 6, 0]; // Senin..Minggu (nilai getDay())

// VARIAN POLA 7 HARI. Pekan hari besar dan pekan penjualan mengganti peran (dan format) di beberapa hari supaya 52 pekan
// tidak terasa seragam. Kunci = getDay() (1 Senin ... 0 Minggu). Hari yang tidak tercantum memakai IG_POLA_AMIRU apa adanya.
// Kamis, Sabtu, dan Minggu sengaja tidak diubah: tiga hari itu menjaga nuansa hati dan jembatan ke tema pekan depan.
// `catatan` ikut dikirim ke AI sebagai bagian slot. Aturan konten lain (carousel maks 5 slide, tanpa hard-selling, tanpa
// angka/harga/ayat/hadis karangan) tetap berlaku. Peran baru harus ditambahkan juga ke IG_AWALAN_PERAN (chip kalender).
const IG_POLA_VARIAN = {
    hari_besar: {
        1: { peran: 'Sambut', pilar: 'storytelling', tipe: 'image', catatan: 'Suasana menyambut hari besar pekan ini, hangat dan membumi, tanpa mengarang kejadian atau kutipan.' },
        2: { peran: 'Kenali', pilar: 'edukasi', tipe: 'image', catatan: 'Makna hari besar secara umum dengan bahasa sederhana, tanpa ayat, hadis, atau tata cara rinci (cek pembimbing).' },
        3: { peran: 'Amalkan', pilar: 'edukasi', tipe: 'carousel', catatan: 'Kebiasaan baik yang bisa dilakukan bersama keluarga pekan ini, tanpa klaim pahala berangka, dikaitkan halus dengan rindu Tanah Suci.' },
        5: { peran: 'Tanya Jawab', pilar: 'edukasi', tipe: 'image', catatan: 'Satu pertanyaan umum seputar hari besar ini beserta jawaban singkat yang aman; kalau ragu, arahkan ke pembimbing.' }
    },
    penjualan: {
        2: { peran: 'Rencanakan', pilar: 'edukasi', tipe: 'image', catatan: 'Kapan dan bagaimana merencanakan umroh di musim ini, tanpa harga dan tanpa angka karangan.' },
        3: { peran: 'Hitung', pilar: 'edukasi', tipe: 'carousel', catatan: 'Menyiapkan waktu, cuti, dan dana secara bertahap, tanpa menyebut harga atau angka karangan.' },
        5: { peran: 'Pertimbangkan', pilar: 'edukasi', tipe: 'carousel', catatan: 'Pertanyaan yang pantas diajukan calon jamaah sebelum memutuskan; penutup cukup CTA ringan, bukan hard-selling.' }
    }
};

// Jenis pekan: 'hari_besar' (ada peristiwa Hijriah di pekan itu, dihitung dari tanggal), 'penjualan' (tema pekan = tema
// penjualan di IG_TEMA_MUSIM, jual:true), atau 'biasa'. Hari besar didahulukan karena waktunya tidak bisa digeser.
function igJenisPekan(seninKey, tema) {
    if (igPeristiwaPekan(seninKey)) return 'hari_besar';
    const t = String(tema || '').trim();
    if (t) {
        const tok = igTokenSet(t);
        if (IG_TEMA_MUSIM.some(e => e.jual && (e.tema.toLowerCase() === t.toLowerCase() || igIsSimilarText(tok, igTokenSet(e.tema))))) return 'penjualan';
    }
    return 'biasa';
}

// Pola satu hari (IG_POLA_AMIRU) setelah varian jenis pekan diterapkan. tanggalKey = 'YYYY-MM-DD'.
// Hasil: salinan pola dengan peran/pilar/tipe yang mungkin berganti, plus `varian` dan `catatan` (kosong kalau pola bawaan).
function igPolaHari(tanggalKey, temaMinggu) {
    const [y, m, d] = String(tanggalKey).split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const dasar = IG_POLA_AMIRU[dow];
    if (!dasar) return null;
    const senin = igLocalDateKey(new Date(y, m - 1, d - ((dow + 6) % 7)));
    const jenis = igJenisPekan(senin, temaMinggu);
    const v = (IG_POLA_VARIAN[jenis] || {})[dow];
    return v ? { ...dasar, peran: v.peran, pilar: v.pilar, tipe: v.tipe, varian: jenis, catatan: v.catatan } : { ...dasar, varian: '', catatan: '' };
}

// Susun baris rencana untuk 1 bulan dari pola (fungsi murni -- mudah dites).
// existingDates: Set tanggal "YYYY-MM-DD" yang sudah punya ide aktif (dilewati supaya tidak menumpuk).
// mulaiDari: "YYYY-MM-DD" -- tanggal sebelum ini dilewati (tidak ada gunanya merencanakan hari yang sudah lewat,
//   dan draf tidak habis terpakai di tanggal lampau).
// riwayat (opsional): hasil igBuildRiwayat() -- draf contoh yang topiknya sudah pernah dipakai TIDAK diulang
//   (slotnya jadi kerangka kosong), supaya bulan berikutnya tidak berisi konten yang sama persis.
function igBuildPolaMingguan(year, month, existingDates, mulaiDari, riwayat) {
    const antrean = {};
    let sudahPernah = 0;
    Object.keys(IG_POLA_AMIRU).forEach(k => {
        const semua = IG_POLA_AMIRU[k].isi;
        antrean[k] = riwayat ? semua.filter(d => !igIsDuplicateIdea(d, riwayat)) : semua.slice();
        sudahPernah += semua.length - antrean[k].length;
    });
    const lastDay = new Date(year, month + 1, 0).getDate();
    const bulanCol = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const rows = [];
    let dilewati = 0;
    let lampau = 0;
    for (let d = 1; d <= lastDay; d++) {
        const dow = new Date(year, month, d).getDay(); // 0 = Minggu
        const slot = IG_POLA_AMIRU[dow];
        if (!slot) continue;
        const tanggal = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (mulaiDari && tanggal < mulaiDari) { lampau++; continue; }
        if (existingDates && existingDates.has(tanggal)) { dilewati++; continue; }
        const draf = antrean[dow].shift();
        const src = draf || slot.kosong;
        rows.push({
            bulan: bulanCol,
            tanggal,
            tema: src.tema,
            tipe_konten: slot.tipe,
            draft_caption: draf ? draf.caption : '',
            status: 'idea',
            pilar: slot.pilar,
            tahap: draf ? 'dikerjakan' : 'ide',
            teks_gambar: igSpasiSlide(src.teks),
            _berisi: !!draf
        });
    }
    return { rows, dilewati, lampau, sudahPernah };
}

// ---- Terapkan pola mingguan ke bulan yang dipilih di modal Perencanaan Konten ----
async function igApplyPolaMingguan() {
    if (!canManageProgramData()) {
        showToast('Akun Anda tidak punya izin untuk membuat rencana konten', 'error');
        return;
    }
    const monthVal = document.getElementById('igPlanMonth')?.value; // "YYYY-MM"
    if (!monthVal) { showToast('Pilih bulan dulu', 'error'); return; }
    const [yearStr, monthStr] = monthVal.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10) - 1;

    const bulanPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
    const existingDates = new Set(igContentPlan
        .filter(pl => pl.tanggal && pl.tanggal.startsWith(bulanPrefix) && pl.status !== 'dilewati')
        .map(pl => pl.tanggal));

    const t = new Date();
    const hariIni = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    const { rows, dilewati, lampau, sudahPernah } = igBuildPolaMingguan(year, month, existingDates, hariIni, igBuildRiwayat());
    if (!rows.length) { showToast('Tidak ada tanggal pola yang tersisa di bulan ini (sudah lewat atau sudah punya ide)', 'info'); return; }

    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const ket = `Pola mingguan akan menambah ${rows.length} kerangka ide di ${monthNames[month]} ${year} ` +
        `(pilar & tipe sudah terisi, teks gambar & caption masih kosong).` +
        (dilewati ? ` ${dilewati} tanggal dilewati karena sudah ada ide.` : '') +
        (lampau ? ` ${lampau} tanggal yang sudah lewat tidak diisi.` : '') +
        `\n\nLanjutkan?`;
    if (!await openActionConfirm({ title: 'Terapkan Pola Mingguan', message: `<div style="white-space:pre-line;">${escapeHtml(ket)}</div>`, confirmLabel: 'Ya, Terapkan', danger: false })) return;

    const btn = document.getElementById('btnIgApplyPola');
    if (btn) btn.disabled = true;
    try {
        const payload = rows.map(r => {
            const o = {
                bulan: r.bulan, tanggal: r.tanggal, tema: r.tema, tipe_konten: r.tipe_konten,
                draft_caption: r.draft_caption, status: 'idea'
            };
            if (igPlannerColsReady) { o.pilar = r.pilar; o.tahap = r.tahap; }
            if (igTeksGambarReady) o.teks_gambar = r.teks_gambar;
            return o;
        });
        const { error } = await supabaseClient.from('ig_content_plan').insert(payload);
        if (error) throw error;

        let pesan = `${payload.length} ide pola mingguan ditambahkan`;
        if (!igTeksGambarReady) pesan += ' (jalankan sql/46_tambah_ig_content_plan_pola_amiru.sql agar teks gambar ikut tersimpan)';
        showToast(pesan, 'success');
        await loadIgContentPlan();
        igPlanResultRange = null;
        renderIgPlanResultList(year, month);
        const genWrap = document.getElementById('igPlanGenerateWrap');
        const resultWrap = document.getElementById('igPlanResultWrap');
        if (genWrap) genWrap.style.display = 'none';
        if (resultWrap) resultWrap.style.display = 'block';
    } catch (err) {
        console.error('igApplyPolaMingguan error:', err);
        showToast('Gagal menerapkan pola mingguan: ' + err.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// Expose functions globally
window.openIgUploadModal = openIgUploadModal;
window.closeIgUploadModal = closeIgUploadModal;
window.saveIgPost = saveIgPost;
window.onIgMediaChange = onIgMediaChange;
window.onIgAccountChange = loadIgAccounts;
window.openIgActionModal = openIgActionModal;
window.closeIgActionModal = closeIgActionModal;
window.deleteIgPost = deleteIgPost;
window.retryIgPost = retryIgPost;
window.loadIgPosts = loadIgPosts;
window.igPrevMonth = igPrevMonth;
window.igNextMonth = igNextMonth;
window.igGotoToday = igGotoToday;
window.igDayNav = igDayNav;
window.igDayNavToday = igDayNavToday;
window.igPickQuickTipe = igPickQuickTipe;
window.igPickQuickPilar = igPickQuickPilar;
window.igFillQuickIdea = igFillQuickIdea;
window.igPlanSetStage = igPlanSetStage;
window.igArmDelete = igArmDelete;
window.igNewIdea = igNewIdea;
window.igSetCalFilter = igSetCalFilter;
window.igQuickAddPlan = igQuickAddPlan;
window.igMovePlanToDate = igMovePlanToDate;
window.igOnDayClick = igOnDayClick;
window.closeIgDayModal = closeIgDayModal;
window.igTogglePlanEdit = igTogglePlanEdit;
window.igUpdatePlanCharCount = igUpdatePlanCharCount;
window.igAddPostFromDayModal = igAddPostFromDayModal;
window.igPrevPage = igPrevPage;
window.igNextPage = igNextPage;
window.openIgCommentsModal = openIgCommentsModal;
window.syncIgCommentsNow = syncIgCommentsNow;
window.igReplyComment = igReplyComment;
window.igToggleHideComment = igToggleHideComment;
window.igDeleteComment = igDeleteComment;
window.openIgContentPlanModal = openIgContentPlanModal;
window.igRefreshPlanPreview = igRefreshPlanPreview;
window.igRenderPlanWeekOptions = igRenderPlanWeekOptions;
window.closeIgContentPlanModal = closeIgContentPlanModal;
window.openIgAboutPlannerModal = openIgAboutPlannerModal;
window.closeIgAboutPlannerModal = closeIgAboutPlannerModal;
window.igSalinAboutPlanner = igSalinAboutPlanner;
window.igUnduhAboutPlanner = igUnduhAboutPlanner;
window.openIgRencanaKontenModal = openIgRencanaKontenModal;
window.closeIgRencanaKontenModal = closeIgRencanaKontenModal;
window.igRkRender = igRkRender;
window.igRkIniHari = igRkIniHari;
window.igRkLihatDiKalender = igRkLihatDiKalender;
window.igSalinRencanaKonten = igSalinRencanaKonten;
window.igUnduhRencanaKonten = igUnduhRencanaKonten;
window.igUnduhRencanaKontenPdf = igUnduhRencanaKontenPdf;
window.showIgPlanGenerateForm = showIgPlanGenerateForm;
window.generateIgContentPlanAI = generateIgContentPlanAI;
window.igConvertPlanToPost = igConvertPlanToPost;
window.igSkipPlanItem = igSkipPlanItem;
window.igDeletePlanItem = igDeletePlanItem;
window.igPlanUpdateField = igPlanUpdateField;
window.loadIgContentPlan = loadIgContentPlan;
window.igApplyPolaMingguan = igApplyPolaMingguan;

// withBusy() (app.js) membungkus tombol Simpan supaya klik ganda tertahan. Di app.js daftar
// pembungkusnya tidak lagi memuat saveIgPost karena fungsinya baru ada setelah modul ini dimuat.
if (typeof window.saveIgPost === 'function') window.saveIgPost = withBusy(window.saveIgPost);

// Dipanggil openIgSchedulerPage() (app.js) setiap halaman IG dibuka, SESUDAH modul ini selesai dimuat.
function igOnPageOpen() {
    igApplyPlannerMode();   // dulu: sesudah loadIgPosts -> kelas layout planner telat terpasang
    const dataMuat = Promise.all([
        loadIgPosts(),          // renderIgCalendar() sudah dipanggil di dalam loadIgPosts()
        loadIgContentPlan(),    // dulu tidak ikut dimuat -> ide kosong/basi sampai tombol Refresh ditekan
        loadIgTasks()           // tasklist mingguan (dulu dimuat saat boot)
    ]);
    // Generate otomatis per pekan DINONAKTIFKAN: ide hanya dibuat saat tombol Generate / Isi dari Pola diklik.
    void dataMuat;
    requestAnimationFrame(igFitCalendarChips); // halaman baru tampil: ukur ulang chip kalender
    if (IG_AUTOPUBLISH_ENABLED) {
        loadIgAccounts();
        loadIgCommentsUnreadCount();
        igCommentsPanelFilterPostId = null;
        loadIgCommentsPanel();
    }
}
window.igOnPageOpen = igOnPageOpen;

