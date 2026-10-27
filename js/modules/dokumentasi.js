// ============================================================
// MODUL LAZY: DOKUMENTASI KEGIATAN UMROH  (js/modules/dokumentasi.js)
// ============================================================
// Menu Social Media > Dokumentasi: jadwal & dokumentasi kegiatan umroh LENGKAP dari
// keberangkatan sampai kepulangan, per program. Tujuannya membantu perencanaan konten:
// tim tahu kapan & di mana momen terjadi, apa yang harus diambil (shot list), sudah
// terdokumentasi/diposting atau belum, dan bisa langsung menjadikannya ide di Perencanaan
// Konten IG (tabel ig_content_plan).
//
// Tabel: dokumentasi_kegiatan (sql/60_tambah_dokumentasi_kegiatan.sql).
// Dimuat sebagai <script> biasa (BUKAN ES module): satu lingkup global dengan app.js.
// ATURAN: jangan mendeklarasikan ulang nama yang sudah ada di app.js / modul lain (const/let ganda
// = SyntaxError). Semua nama di file ini berawalan `dkg` (jangan dicampur dengan `dok*` milik modul
// Kelengkapan Dokumen). Fungsi yang dirujuk index.html / kode inti SEBELUM modul dimuat didaftarkan di
// LAZY_MODULES['dokumentasi'].api (app.js).
// ============================================================

const DKG_FASE = [
    { value: 'persiapan', label: 'Persiapan', icon: 'bi-clipboard2-check-fill' },
    { value: 'keberangkatan', label: 'Keberangkatan', icon: 'bi-airplane-engines-fill' },
    { value: 'madinah', label: 'Madinah', icon: 'bi-moon-stars-fill' },
    { value: 'makkah', label: 'Makkah', icon: 'bi-buildings-fill' },
    { value: 'kepulangan', label: 'Kepulangan', icon: 'bi-house-door-fill' },
    { value: 'lainnya', label: 'Lainnya', icon: 'bi-three-dots' }
];
const DKG_KATEGORI = [
    { value: 'perjalanan', label: 'Perjalanan' },
    { value: 'ibadah', label: 'Ibadah' },
    { value: 'ziarah', label: 'Ziarah' },
    { value: 'hotel', label: 'Hotel & Makan' },
    { value: 'kebersamaan', label: 'Kebersamaan' },
    { value: 'lainnya', label: 'Lainnya' }
];
const DKG_MEDIA = [
    { value: 'foto', label: 'Foto', icon: 'bi-camera-fill' },
    { value: 'video', label: 'Video', icon: 'bi-camera-video-fill' },
    { value: 'reels', label: 'Reels', icon: 'bi-film' },
    { value: 'story', label: 'Story', icon: 'bi-phone-fill' },
    { value: 'testimoni', label: 'Testimoni', icon: 'bi-mic-fill' }
];
const DKG_STATUS = [
    { value: 'rencana', label: 'Rencana', badge: 'neutral' },
    { value: 'sudah_diambil', label: 'Sudah diambil', badge: 'warn' },
    { value: 'sudah_diposting', label: 'Sudah diposting', badge: 'ok' },
    { value: 'dilewati', label: 'Dilewati', badge: 'muted' }
];
const DKG_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const DKG_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const DKG_MAX_HARI = 60;

let dkgProgramId = null;
let dkgItems = [];
let dkgLoaded = false;
let dkgFilterFase = 'all';
let dkgFilterStatus = 'all';
let dkgSaving = false;
let dkgOpenDetail = new Set();   // id kegiatan yang detailnya sedang dibuka (bertahan antar render)

// ------------------------------------------------------------
// Helper kecil
// ------------------------------------------------------------
function dkgOpsi(list, value) { return list.find(o => o.value === value) || list[list.length - 1]; }

function dkgIso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dkgParseIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function dkgAddDays(iso, n) {
    const d = dkgParseIso(iso);
    if (!d) return '';
    return dkgIso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}
function dkgFormatTanggal(iso, withDay = true) {
    const d = dkgParseIso(iso);
    if (!d) return '';
    return `${withDay ? DKG_HARI[d.getDay()] + ', ' : ''}${d.getDate()} ${DKG_BULAN[d.getMonth()]} ${d.getFullYear()}`;
}
function dkgFormatTanggalPendek(iso) {
    const d = dkgParseIso(iso);
    return d ? `${d.getDate()} ${DKG_BULAN[d.getMonth()].slice(0, 3)}` : '';
}

function dkgProgram(id) {
    return (dataUmroh || []).find(p => String(p.id) === String(id)) || null;
}

// Tanggal berangkat program (yyyy-mm-dd): realisasi (tgl_berangkat_aktual) kalau ada, kalau tidak
// dari jadwal program (programs.tgl, mis. "17 September 2026"). Kosong kalau tidak terbaca.
function dkgTglBerangkatProgram(programId) {
    const aktual = (typeof tglKepulanganProgram === 'function') ? tglKepulanganProgram(programId, 'tgl_berangkat_aktual') : '';
    if (aktual && dkgParseIso(String(aktual).slice(0, 10))) return String(aktual).slice(0, 10);
    const p = dkgProgram(programId);
    if (!p || !p.tgl) return '';
    const d = parseDateFromString(p.tgl);
    return (d && !isNaN(d.getTime())) ? dkgIso(d) : '';
}

// "9 Hari 7 Malam" -> 9. Tidak terbaca -> 9 (paket umroh paling umum).
function dkgDurasiProgram(programId) {
    const p = dkgProgram(programId);
    const m = p && p.durasi ? /\d+/.exec(String(p.durasi)) : null;
    const n = m ? parseInt(m[0], 10) : 9;
    return Math.min(30, Math.max(6, n || 9));
}

// Urutan tampil: Persiapan dulu (di luar hitungan hari), lalu per hari, lalu urutan dalam hari.
function dkgSortItems(list) {
    return [...list].sort((a, b) => {
        const pa = a.fase === 'persiapan' ? 0 : 1, pb = b.fase === 'persiapan' ? 0 : 1;
        if (pa !== pb) return pa - pb;
        if (a.hari_ke !== b.hari_ke) return a.hari_ke - b.hari_ke;
        if ((a.urutan || 0) !== (b.urutan || 0)) return (a.urutan || 0) - (b.urutan || 0);
        return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
}

function dkgTabelBelumAda(err) {
    const msg = String((err && (err.message || err.details)) || '');
    return (err && (err.code === '42P01' || err.code === 'PGRST205')) || /does not exist|Could not find the table/i.test(msg);
}

// ------------------------------------------------------------
// Pemilih program
// ------------------------------------------------------------
function renderDkgProgramSelector() {
    const select = document.getElementById('dkgProgramSelect');
    if (!select) return;
    if (!dataUmroh || dataUmroh.length === 0) {
        select.innerHTML = '<option value="">-- Belum ada program --</option>';
        loadDkgForProgram('');
        return;
    }
    const current = select.value || dkgProgramId || '';
    select.innerHTML = '<option value="">-- Pilih Program --</option>' +
        dataUmroh.map(p => `<option value="${escapeHtmlAttr(String(p.id))}">${escapeHtml(p.nama)} (${escapeHtml(p.tgl || '-')})</option>`).join('');
    select.value = dataUmroh.some(p => String(p.id) === String(current)) ? current : '';
    loadDkgForProgram(select.value);
}

function selectDkgProgram(id) {
    const select = document.getElementById('dkgProgramSelect');
    if (select) select.value = id;
    dkgFilterFase = 'all';
    dkgFilterStatus = 'all';
    dkgOpenDetail = new Set();
    loadDkgForProgram(id);
}

async function loadDkgForProgram(programId) {
    dkgProgramId = programId || null;
    dkgItems = [];
    dkgLoaded = false;
    dkgSyncToolbar();
    const body = document.getElementById('dkgBody');
    if (!body) return;

    if (!programId) {
        body.innerHTML = dkgEmptyHtml('bi-camera-reels-fill', 'Pilih program umroh', 'Pilih program di atas untuk melihat jadwal & dokumentasi kegiatan umrohnya.');
        return;
    }
    body.innerHTML = `<div class="dkg-loading"><i class="bi bi-arrow-repeat bi-spin"></i> Memuat jadwal dokumentasi…</div>`;

    const requested = programId;
    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('dokumentasi_kegiatan').select('*').eq('program_id', programId)
                .order('hari_ke', { ascending: true }).order('urutan', { ascending: true }),
            { label: 'Muat dokumentasi kegiatan' }
        );
        if (error) throw error;
        if (requested !== dkgProgramId) return; // user sudah pindah program sebelum respons datang
        dkgItems = data || [];
        dkgLoaded = true;
        renderDkgContent();
    } catch (err) {
        if (requested !== dkgProgramId) return;
        console.error('loadDkgForProgram error:', err);
        body.innerHTML = dkgTabelBelumAda(err)
            ? dkgEmptyHtml('bi-database-exclamation', 'Tabel belum dibuat', 'Jalankan <strong>sql/60_tambah_dokumentasi_kegiatan.sql</strong> di Supabase SQL Editor, lalu muat ulang halaman.')
            : dkgEmptyHtml('bi-exclamation-triangle-fill', 'Gagal memuat jadwal', escapeHtml(err.message || 'kesalahan tidak dikenal'),
                `<button type="button" class="btn-secondary btn-compact" data-action="selectDkgProgram" data-args='${escapeHtmlAttr(JSON.stringify([programId]))}'><i class="bi bi-arrow-clockwise"></i> Coba lagi</button>`);
    }
}

// Tombol toolbar aktif/nonaktif sesuai program terpilih & hak akses.
function dkgSyncToolbar() {
    const can = canManageProgramData();
    const has = !!dkgProgramId;
    const set = (id, show) => { const el = document.getElementById(id); if (el) el.style.display = show ? '' : 'none'; };
    set('dkgBtnTambah', has && can);
    set('dkgBtnTemplate', has && can);
    set('dkgBtnSalin', has);
}

// ------------------------------------------------------------
// Render
// ------------------------------------------------------------
function dkgFilteredItems() {
    return dkgSortItems(dkgItems).filter(it =>
        (dkgFilterFase === 'all' || it.fase === dkgFilterFase) &&
        (dkgFilterStatus === 'all' || it.status === dkgFilterStatus));
}

function dkgSummaryHtml() {
    const total = dkgItems.length;
    const hitung = (s) => dkgItems.filter(i => i.status === s).length;
    const rencana = hitung('rencana'), diambil = hitung('sudah_diambil'), diposting = hitung('sudah_diposting'), lewat = hitung('dilewati');
    const aktif = total - lewat;
    const selesai = diambil + diposting;
    const pct = aktif > 0 ? Math.round((selesai / aktif) * 100) : 0;
    const tglRentang = (() => {
        const tgls = dkgItems.map(i => i.tanggal).filter(Boolean).sort();
        return tgls.length ? `${dkgFormatTanggalPendek(tgls[0])} – ${dkgFormatTanggal(tgls[tgls.length - 1], false)}` : '';
    })();
    const stat = (n, lbl) => `<span class="dkg-stat"><b>${n}</b> ${lbl}</span>`;
    return `
        <div class="dkg-summary">
            <div class="dkg-progress" title="Kegiatan yang sudah diambil atau diposting, di luar yang dilewati">
                <div class="dkg-progress-bar"><span style="width:${pct}%"></span></div>
                <strong>${pct}%</strong>
            </div>
            <div class="dkg-stats">
                ${stat(total, 'kegiatan')}${stat(rencana, 'rencana')}${stat(diambil, 'diambil')}${stat(diposting, 'diposting')}
                ${tglRentang ? `<span class="dkg-range"><i class="bi bi-calendar3"></i> ${escapeHtml(tglRentang)}</span>` : ''}
            </div>
        </div>`;
}

function dkgFilterBarHtml() {
    const adaFase = new Set(dkgItems.map(i => i.fase));
    const chips = [{ value: 'all', label: 'Semua' }, ...DKG_FASE.filter(f => adaFase.has(f.value))]
        .map(f => `<button type="button" class="dkg-chip${dkgFilterFase === f.value ? ' active' : ''}" data-action="setDkgFilter" data-args='["fase","${f.value}"]'>${escapeHtml(f.label)}</button>`).join('');
    const statusOpts = [{ value: 'all', label: 'Semua status' }, ...DKG_STATUS]
        .map(s => `<option value="${s.value}"${dkgFilterStatus === s.value ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('');
    return `
        <div class="dkg-filterbar">
            <div class="dkg-chips">${chips}</div>
            <select class="dkg-status-filter" aria-label="Filter status" onchange="setDkgFilter('status', this.value)">${statusOpts}</select>
        </div>`;
}

function setDkgFilter(kind, value) {
    if (kind === 'fase') dkgFilterFase = value;
    else dkgFilterStatus = value;
    renderDkgContent();
}

function dkgItemHtml(it, canEdit) {
    const status = dkgOpsi(DKG_STATUS, it.status);
    const kategori = dkgOpsi(DKG_KATEGORI, it.kategori);
    const open = dkgOpenDetail.has(it.id);
    const media = (it.jenis_media || []).map(m => {
        const o = DKG_MEDIA.find(x => x.value === m);
        return o ? `<i class="bi ${o.icon} dkg-ico" title="${escapeHtmlAttr(o.label)}"></i>` : '';
    }).join('');
    const pilar = it.pilar && typeof IG_PILLARS === 'object' && IG_PILLARS[it.pilar]
        ? `<i class="bi bi-bullseye dkg-ico" title="Pilar: ${escapeHtmlAttr(IG_PILLARS[it.pilar].label)}"></i>` : '';

    const detailRows = [];
    if (it.deskripsi) detailRows.push(['Gambaran kegiatan', it.deskripsi]);
    if (it.shot_list) detailRows.push(['Shot list (yang perlu diambil)', it.shot_list]);
    if (it.ide_konten) detailRows.push(['Ide konten', it.ide_konten]);
    if (it.catatan) detailRows.push(['Catatan lapangan', it.catatan]);
    const detailHtml = detailRows.map(([k, v]) =>
        `<div class="dkg-detail-row"><div class="dkg-detail-k">${escapeHtml(k)}</div><div class="dkg-detail-v">${escapeHtml(v)}</div></div>`).join('') +
        (it.link_drive ? `<div class="dkg-detail-row"><div class="dkg-detail-k">Hasil dokumentasi</div><div class="dkg-detail-v"><a href="${escapeHtmlAttr(dkgSafeUrl(it.link_drive))}" target="_blank" rel="noopener noreferrer"><i class="bi bi-folder2-open"></i> Buka folder / file</a></div></div>` : '');
    const adaDetail = !!detailHtml;

    const statusCtl = canEdit
        ? `<select class="dkg-status-select dkg-st-${status.badge}" aria-label="Status dokumentasi" onchange="setDkgStatus('${escapeHtmlAttr(it.id)}', this.value)">${DKG_STATUS.map(s => `<option value="${s.value}"${s.value === it.status ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}</select>`
        : `<span class="dkg-status-pill dkg-st-${status.badge}">${escapeHtml(status.label)}</span>`;

    const actions = canEdit ? `
        <div class="dkg-actions">
            <button type="button" class="dkg-icon-btn" title="${it.content_plan_id ? 'Sudah menjadi ide konten' : 'Jadikan ide di Perencanaan Konten IG'}" data-action="dkgToContentPlan" data-args='${escapeHtmlAttr(JSON.stringify([it.id]))}'${it.content_plan_id ? ' disabled' : ''}><i class="bi ${it.content_plan_id ? 'bi-check2-circle' : 'bi-lightbulb-fill'}"></i></button>
            <button type="button" class="dkg-icon-btn" title="Edit kegiatan" data-action="openDkgModal" data-args='${escapeHtmlAttr(JSON.stringify([it.id]))}'><i class="bi bi-pencil-fill"></i></button>
            <button type="button" class="dkg-icon-btn dkg-icon-danger" title="Hapus kegiatan" data-action="deleteDkg" data-args='${escapeHtmlAttr(JSON.stringify([it.id]))}'><i class="bi bi-trash3-fill"></i></button>
        </div>` : '';

    const idArg = escapeHtmlAttr(JSON.stringify([it.id]));
    const meta = [
        it.lokasi ? `<span><i class="bi bi-geo-alt-fill"></i> ${escapeHtml(it.lokasi)}</span>` : '',
        `<span>${escapeHtml(kategori.label)}</span>`,
    ].filter(Boolean).join('<span class="dkg-dot">·</span>');
    const icons = `${media}${pilar}${it.content_plan_id ? '<i class="bi bi-link-45deg dkg-ico dkg-ico-linked" title="Sudah ada di Perencanaan Konten"></i>' : ''}`;
    const toggleBtn = adaDetail
        ? `<button type="button" class="dkg-icon-btn dkg-toggle" title="${open ? 'Sembunyikan detail' : 'Lihat detail & shot list'}" aria-expanded="${open}" data-action="toggleDkgDetail" data-args='${idArg}'><i class="bi ${open ? 'bi-chevron-up' : 'bi-chevron-down'}"></i></button>`
        : '';

    return `
        <article class="dkg-item${it.status === 'dilewati' ? ' is-skipped' : ''}${open ? ' is-open' : ''}" data-id="${escapeHtmlAttr(it.id)}">
            <div class="dkg-item-main">
                <div class="dkg-time">${it.waktu ? escapeHtml(it.waktu) : '<span class="dkg-time-empty">–</span>'}</div>
                <div class="dkg-item-body">
                    <div class="dkg-item-title">${escapeHtml(it.judul)}</div>
                    <div class="dkg-item-meta">${meta}${icons ? `<span class="dkg-icos">${icons}</span>` : ''}</div>
                </div>
                <div class="dkg-item-side">
                    ${statusCtl}
                    ${actions}
                    ${toggleBtn}
                </div>
            </div>
            ${adaDetail ? `<div class="dkg-detail"${open ? '' : ' hidden'}>${detailHtml}</div>` : ''}
        </article>`;
}

// Empty state seragam modul ini (ikon bulat + judul + penjelasan + aksi opsional).
function dkgEmptyHtml(icon, judul, desc, aksiHtml) {
    return `
        <div class="dkg-empty">
            <span class="dkg-empty-icon"><i class="bi ${icon}"></i></span>
            <h4 class="dkg-empty-title">${judul}</h4>
            <p class="dkg-empty-desc">${desc}</p>
            ${aksiHtml ? `<div class="dkg-empty-actions">${aksiHtml}</div>` : ''}
        </div>`;
}

function renderDkgContent() {
    const body = document.getElementById('dkgBody');
    if (!body || !dkgProgramId) return;
    dkgSyncToolbar();
    const canEdit = canManageProgramData();

    if (!dkgItems.length) {
        body.innerHTML = dkgEmptyHtml('bi-camera-reels-fill', 'Belum ada jadwal dokumentasi',
            canEdit
                ? 'Mulai cepat dengan <strong>Buat dari Template</strong> (alur umroh lengkap dari berangkat sampai pulang), atau tambah kegiatan satu per satu.'
                : 'Jadwal dokumentasi untuk program ini belum disusun oleh tim.',
            canEdit
                ? `<button type="button" class="btn-primary btn-compact" data-action="openDkgTemplateModal"><i class="bi bi-magic"></i> Buat dari Template</button>
                   <button type="button" class="btn-secondary btn-compact" data-action="openDkgModal"><i class="bi bi-plus-lg"></i> Tambah Kegiatan</button>`
                : '');
        return;
    }

    const list = dkgFilteredItems();
    // Kelompokkan per hari (Persiapan satu kelompok tersendiri di depan).
    const groups = [];
    list.forEach(it => {
        const key = it.fase === 'persiapan' ? 'persiapan' : 'h' + it.hari_ke;
        let g = groups[groups.length - 1];
        if (!g || g.key !== key) { g = { key, hari: it.hari_ke, persiapan: it.fase === 'persiapan', items: [] }; groups.push(g); }
        g.items.push(it);
    });

    const hariHtml = groups.map(g => {
        const tgl = g.items.map(i => i.tanggal).find(Boolean) || '';
        const fases = [...new Set(g.items.map(i => dkgOpsi(DKG_FASE, i.fase).label))];
        const judul = g.persiapan ? 'Persiapan sebelum berangkat' : `Hari ${g.hari}`;
        const sub = [g.persiapan ? (tgl ? dkgFormatTanggal(tgl) : '') : (tgl ? dkgFormatTanggal(tgl) : ''), g.persiapan ? '' : fases.join(' · ')].filter(Boolean).join(' · ');
        return `
            <section class="dkg-day">
                <header class="dkg-day-head">
                    <span class="dkg-day-title">${escapeHtml(judul)}</span>
                    ${sub ? `<span class="dkg-day-sub">${escapeHtml(sub)}</span>` : ''}
                    <span class="dkg-day-count">${g.items.length}</span>
                </header>
                <div class="dkg-day-items">${g.items.map(it => dkgItemHtml(it, canEdit)).join('')}</div>
            </section>`;
    }).join('');

    body.innerHTML = dkgSummaryHtml() + dkgFilterBarHtml() +
        (hariHtml || dkgEmptyHtml('bi-funnel-fill', 'Tidak ada hasil', 'Tidak ada kegiatan yang cocok dengan filter ini.'));
}

function toggleDkgDetail(id) {
    if (dkgOpenDetail.has(id)) dkgOpenDetail.delete(id); else dkgOpenDetail.add(id);
    renderDkgContent();
}

// Link dari input user hanya boleh http(s) (cegah javascript: di atribut href).
function dkgSafeUrl(url) {
    let u = String(url || '').trim();
    if (!u) return '#';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { const p = new URL(u); return /^https?:$/.test(p.protocol) ? p.href : '#'; } catch (_) { return '#'; }
}

// ------------------------------------------------------------
// Modal tambah / edit kegiatan
// ------------------------------------------------------------
function dkgFillSelects() {
    const fase = document.getElementById('dkg_fase');
    if (fase && !fase.options.length) fase.innerHTML = DKG_FASE.map(f => `<option value="${f.value}">${escapeHtml(f.label)}</option>`).join('');
    const kat = document.getElementById('dkg_kategori');
    if (kat && !kat.options.length) kat.innerHTML = DKG_KATEGORI.map(k => `<option value="${k.value}">${escapeHtml(k.label)}</option>`).join('');
    const st = document.getElementById('dkg_status');
    if (st && !st.options.length) st.innerHTML = DKG_STATUS.map(s => `<option value="${s.value}">${escapeHtml(s.label)}</option>`).join('');
    const pil = document.getElementById('dkg_pilar');
    if (pil && !pil.options.length) {
        pil.innerHTML = '<option value="">-- Belum dipilih --</option>' +
            Object.entries(typeof IG_PILLARS === 'object' ? IG_PILLARS : {}).map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`).join('');
    }
    const med = document.getElementById('dkgMediaChecks');
    if (med && !med.children.length) {
        med.className = 'dkg-checks';
        med.innerHTML = DKG_MEDIA.map(m =>
            `<label class="dkg-check"><input type="checkbox" name="dkg_media" value="${m.value}"><span><i class="bi ${m.icon}"></i> ${escapeHtml(m.label)}</span></label>`).join('');
    }
}

function openDkgModal(id) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengubah dokumentasi', 'error'); return; }
    if (!dkgProgramId) { showToast('Pilih program dulu', 'error'); return; }
    dkgFillSelects();
    const it = id ? dkgItems.find(x => String(x.id) === String(id)) : null;
    const startIso = dkgTglBerangkatProgram(dkgProgramId);
    const val = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v == null ? '' : v; };

    document.getElementById('dkgModalTitle').textContent = it ? 'Edit Kegiatan' : 'Tambah Kegiatan';
    val('dkg_editId', it ? it.id : '');
    val('dkg_judul', it ? it.judul : '');
    val('dkg_hari_ke', it ? it.hari_ke : 1);
    val('dkg_tanggal', it ? (it.tanggal || '') : (startIso || ''));
    val('dkg_waktu', it ? it.waktu : '');
    val('dkg_fase', it ? it.fase : 'lainnya');
    val('dkg_kategori', it ? it.kategori : 'lainnya');
    val('dkg_lokasi', it ? it.lokasi : '');
    val('dkg_deskripsi', it ? it.deskripsi : '');
    val('dkg_shot_list', it ? it.shot_list : '');
    val('dkg_pilar', it ? it.pilar : '');
    val('dkg_ide_konten', it ? it.ide_konten : '');
    val('dkg_status', it ? it.status : 'rencana');
    val('dkg_link_drive', it ? it.link_drive : '');
    val('dkg_catatan', it ? it.catatan : '');
    const jenis = new Set(it ? (it.jenis_media || []) : ['foto']);
    document.querySelectorAll('#dkgMediaChecks input[name="dkg_media"]').forEach(cb => { cb.checked = jenis.has(cb.value); });

    document.getElementById('dkgModal').classList.add('open');
    setTimeout(() => document.getElementById('dkg_judul')?.focus(), 60);
}

function closeDkgModal() {
    document.getElementById('dkgModal')?.classList.remove('open');
}

// Hari ke-N mengikuti tanggal (kalau tanggal & tanggal berangkat diketahui): mengisi otomatis saat tanggal dipilih.
function dkgOnTanggalChange() {
    const tgl = document.getElementById('dkg_tanggal')?.value;
    const start = dkgTglBerangkatProgram(dkgProgramId);
    const a = dkgParseIso(tgl), b = dkgParseIso(start);
    if (!a || !b) return;
    const selisih = Math.round((a - b) / 86400000) + 1;
    if (selisih >= 1 && selisih <= DKG_MAX_HARI) document.getElementById('dkg_hari_ke').value = selisih;
}

function dkgReadForm() {
    const v = (id) => (document.getElementById(id)?.value || '').trim();
    const hari = parseInt(v('dkg_hari_ke'), 10);
    const tanggal = v('dkg_tanggal');
    let link = v('dkg_link_drive');
    if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
    return {
        judul: v('dkg_judul'),
        hari_ke: hari,
        tanggal: tanggal && dkgParseIso(tanggal) ? tanggal : null,
        waktu: v('dkg_waktu') || null,
        fase: v('dkg_fase') || 'lainnya',
        kategori: v('dkg_kategori') || 'lainnya',
        lokasi: v('dkg_lokasi') || null,
        deskripsi: v('dkg_deskripsi') || null,
        shot_list: v('dkg_shot_list') || null,
        pilar: v('dkg_pilar') || null,
        ide_konten: v('dkg_ide_konten') || null,
        status: v('dkg_status') || 'rencana',
        link_drive: link || null,
        catatan: v('dkg_catatan') || null,
        jenis_media: [...document.querySelectorAll('#dkgMediaChecks input[name="dkg_media"]:checked')].map(cb => cb.value)
    };
}

async function saveDkg(e) {
    if (e) e.preventDefault();
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengubah dokumentasi', 'error'); return; }
    if (!dkgProgramId) { showToast('Pilih program dulu', 'error'); return; }
    const data = dkgReadForm();
    if (!data.judul) { showToast('Nama kegiatan wajib diisi', 'error'); return; }
    if (!Number.isInteger(data.hari_ke) || data.hari_ke < 1 || data.hari_ke > DKG_MAX_HARI) {
        showToast(`Hari ke- harus angka 1 sampai ${DKG_MAX_HARI}`, 'error');
        return;
    }
    const id = document.getElementById('dkg_editId').value;
    try {
        let result;
        if (id) {
            result = await supabaseClient.from('dokumentasi_kegiatan').update(data).eq('id', id).select().single();
        } else {
            // Taruh di urutan paling akhir pada hari yang sama.
            const urutanMax = dkgItems.filter(i => i.hari_ke === data.hari_ke).reduce((m, i) => Math.max(m, i.urutan || 0), 0);
            result = await supabaseClient.from('dokumentasi_kegiatan')
                .insert({ ...data, program_id: dkgProgramId, urutan: urutanMax + 10 }).select().single();
        }
        if (result.error) throw result.error;
        if (id) dkgItems = dkgItems.map(i => String(i.id) === String(id) ? result.data : i);
        else dkgItems.push(result.data);
        showToast(id ? 'Kegiatan diperbarui' : 'Kegiatan ditambahkan');
        closeDkgModal();
        renderDkgContent();
    } catch (err) {
        console.error('saveDkg error:', err);
        showToast('Gagal menyimpan: ' + (err.message || err), 'error');
    }
}

async function setDkgStatus(id, status) {
    if (!canManageProgramData()) return;
    const it = dkgItems.find(x => String(x.id) === String(id));
    if (!it || it.status === status) return;
    const lama = it.status;
    it.status = status;
    renderDkgContent();
    try {
        const { error } = await supabaseClient.from('dokumentasi_kegiatan').update({ status }).eq('id', id);
        if (error) throw error;
    } catch (err) {
        console.error('setDkgStatus error:', err);
        it.status = lama;
        renderDkgContent();
        showToast('Gagal mengubah status: ' + (err.message || err), 'error');
    }
}

async function deleteDkg(id) {
    if (!canManageProgramData()) return;
    const it = dkgItems.find(x => String(x.id) === String(id));
    if (!it) return;
    const ok = await openActionConfirm({
        title: 'Hapus kegiatan?',
        message: `Kegiatan <strong>${escapeHtml(it.judul)}</strong> akan dihapus dari jadwal dokumentasi.${it.content_plan_id ? ' Ide konten di Perencanaan Konten IG tidak ikut terhapus.' : ''}`,
        confirmLabel: 'Ya, Hapus'
    });
    if (!ok) return;
    try {
        const { error } = await supabaseClient.from('dokumentasi_kegiatan').delete().eq('id', id);
        if (error) throw error;
        dkgItems = dkgItems.filter(x => String(x.id) !== String(id));
        dkgOpenDetail.delete(id);
        showToast('Kegiatan dihapus');
        renderDkgContent();
    } catch (err) {
        console.error('deleteDkg error:', err);
        showToast('Gagal menghapus: ' + (err.message || err), 'error');
    }
}

// ------------------------------------------------------------
// Jembatan ke Perencanaan Konten IG (ig_content_plan)
// ------------------------------------------------------------
function dkgTipeKonten(jenis) {
    const j = jenis || [];
    if (j.includes('reels') || j.includes('video')) return 'video';
    if (j.includes('foto')) return 'carousel';
    return 'image';
}

async function dkgToContentPlan(id) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk membuat rencana konten', 'error'); return; }
    const it = dkgItems.find(x => String(x.id) === String(id));
    if (!it) return;
    if (it.content_plan_id) { showToast('Kegiatan ini sudah menjadi ide konten'); return; }

    let tanggal = it.tanggal;
    if (!tanggal) {
        const start = dkgTglBerangkatProgram(dkgProgramId);
        if (start && it.fase !== 'persiapan') tanggal = dkgAddDays(start, it.hari_ke - 1);
    }
    if (!tanggal) { showToast('Isi tanggal kegiatan dulu supaya ide bisa masuk kalender konten', 'error'); return; }

    const tema = String(it.ide_konten || it.judul).trim().slice(0, 200);
    const [y, m] = tanggal.split('-');
    const baris = {
        bulan: `${y}-${m}-01`,
        tanggal,
        tema,
        tipe_konten: dkgTipeKonten(it.jenis_media),
        draft_caption: '',
        status: 'idea',
        sumber_program_id: dkgProgramId
    };
    try {
        // pilar/tahap ada di migrasi sql/45 (opsional di DB lama): coba dengan, ulangi tanpa kalau kolomnya belum ada.
        let res = await supabaseClient.from('ig_content_plan')
            .insert({ ...baris, pilar: it.pilar || null, tahap: 'ide' }).select('id').single();
        if (res.error && /pilar|tahap/i.test(res.error.message || '')) {
            res = await supabaseClient.from('ig_content_plan').insert(baris).select('id').single();
        }
        if (res.error) throw res.error;

        const upd = await supabaseClient.from('dokumentasi_kegiatan').update({ content_plan_id: res.data.id }).eq('id', id);
        if (upd.error) throw upd.error;
        it.content_plan_id = res.data.id;
        renderDkgContent();
        showToast(`Ide masuk ke kalender konten (${dkgFormatTanggal(tanggal, false)})`);
    } catch (err) {
        console.error('dkgToContentPlan error:', err);
        showToast('Gagal membuat ide konten: ' + (err.message || err), 'error');
    }
}

// ------------------------------------------------------------
// Template alur umroh (berangkat sampai pulang)
// ------------------------------------------------------------
// Katalog kegiatan standar. Teks shot list sengaja berupa saran umum; sesuaikan dengan program.
// Catatan aturan setempat (mis. batasan pengambilan gambar di area tertentu) selalu ikut di catatan.
const DKG_ATURAN = 'Ikuti aturan petugas setempat soal pengambilan gambar di area ini; hormati jamaah lain yang sedang beribadah.';

const DKG_KATALOG = {
    manasik: { judul: 'Manasik & pembagian perlengkapan', lokasi: 'Kantor / aula manasik', kategori: 'ibadah', fase: 'persiapan', waktu: '', media: ['foto', 'video', 'reels'],
        deskripsi: 'Latihan tata cara umroh dan pembagian koper, seragam, serta perlengkapan jamaah.',
        shot: 'Suasana manasik, praktik thawaf/sai dengan maket, pembagian perlengkapan, foto bersama seluruh jamaah, wawancara singkat harapan jamaah.',
        pilar: 'manasik', ide: 'Reels: highlight manasik akbar + 1 tip persiapan fisik & mental.' },
    kumpul: { judul: 'Kumpul & check-in di bandara', lokasi: 'Bandara keberangkatan', kategori: 'perjalanan', fase: 'keberangkatan', waktu: '', media: ['foto', 'video', 'story'],
        deskripsi: 'Jamaah berkumpul, pelepasan oleh keluarga, check-in dan bagasi.',
        shot: 'Jamaah tiba dan berkumpul, atribut rombongan, momen pelukan keluarga, check-in bagasi, foto grup di depan counter, wajah antusias jamaah.',
        pilar: 'storytelling', ide: 'Reels: "Hari H" dari koper sampai boarding, musik syahdu.' },
    terbang: { judul: 'Penerbangan menuju Arab Saudi', lokasi: 'Dalam pesawat / transit', kategori: 'perjalanan', fase: 'keberangkatan', waktu: '', media: ['foto', 'story'],
        deskripsi: 'Boarding dan perjalanan udara menuju Arab Saudi.',
        shot: 'Boarding, suasana kabin, jamaah berdoa/berzikir, sarapan di pesawat, pemandangan dari jendela.',
        pilar: 'behind', ide: 'Story: perjalanan menuju Tanah Suci, hitung mundur jam.' },
    tibaMadinah: { judul: 'Tiba di Madinah & check-in hotel', lokasi: 'Bandara Madinah / hotel', kategori: 'hotel', fase: 'madinah', waktu: '', media: ['foto', 'video', 'story'],
        deskripsi: 'Tiba di Madinah, imigrasi, menuju hotel, pembagian kamar.',
        shot: 'Ekspresi pertama jamaah di Madinah, bus & rombongan, lobi hotel, pembagian kamar, kamar dan pemandangan hotel dari jendela.',
        pilar: 'storytelling', ide: 'Reels: "Pertama kali menginjakkan kaki di Madinah" (ekspresi jamaah).' },
    nabawi: { judul: 'Ibadah di Masjid Nabawi', lokasi: 'Masjid Nabawi', kategori: 'ibadah', fase: 'madinah', waktu: 'Ba\'da Subuh', media: ['foto', 'video', 'reels'],
        deskripsi: 'Shalat berjamaah dan ibadah mandiri di Masjid Nabawi.',
        shot: 'Suasana subuh menuju masjid, payung raksasa & pelataran, jamaah berjalan bersama, momen doa/tilawah dari kejauhan, detail arsitektur.',
        pilar: 'kontemplasi', ide: 'Reels kontemplasi: suasana subuh di Nabawi dengan narasi doa pendek.', catatan: DKG_ATURAN },
    raudhah: { judul: 'Ziarah Raudhah & makam Rasulullah', lokasi: 'Raudhah, Masjid Nabawi', kategori: 'ziarah', fase: 'madinah', waktu: '', media: ['story'],
        deskripsi: 'Kunjungan ke Raudhah dan ziarah sesuai jadwal yang ditetapkan petugas.',
        shot: 'Persiapan jamaah sebelum masuk (antri/pengarahan), ekspresi haru setelah keluar, foto grup di luar area. Jangan memaksakan pengambilan gambar di dalam Raudhah.',
        pilar: 'kontemplasi', ide: 'Story/quote: pengalaman jamaah setelah dari Raudhah (tanpa gambar di dalam area).', catatan: DKG_ATURAN },
    ziarahMadinah: { judul: 'Ziarah kota Madinah', lokasi: 'Masjid Quba, Jabal Uhud, Masjid Qiblatain', kategori: 'ziarah', fase: 'madinah', waktu: 'Pagi', media: ['foto', 'video', 'reels'],
        deskripsi: 'City tour ziarah: Masjid Quba, Jabal Uhud/makam syuhada, Masjid Qiblatain, dan titik ziarah lain sesuai itinerary.',
        shot: 'Foto grup di tiap lokasi, ustadz/muthawif menjelaskan sejarah, jamaah shalat di Quba, pemandangan Uhud, plang nama lokasi.',
        pilar: 'edukasi', ide: 'Carousel edukasi: "3 tempat ziarah di Madinah & sejarah singkatnya".', catatan: DKG_ATURAN },
    kurma: { judul: 'Belanja kurma & oleh-oleh Madinah', lokasi: 'Pasar kurma Madinah', kategori: 'kebersamaan', fase: 'madinah', waktu: 'Sore', media: ['foto', 'reels', 'story'],
        deskripsi: 'Waktu bebas berbelanja kurma dan oleh-oleh.',
        shot: 'Berbagai jenis kurma, jamaah mencicipi, tawar-menawar, tas belanja, ekspresi senang.',
        pilar: 'engagement', ide: 'Reels/polling: "Kurma favoritmu apa?" dengan kurma khas Madinah.' },
    ibadahMadinah: { judul: 'Ibadah mandiri & kebersamaan jamaah', lokasi: 'Hotel / Masjid Nabawi', kategori: 'kebersamaan', fase: 'madinah', waktu: 'Malam', media: ['foto', 'story', 'testimoni'],
        deskripsi: 'Ibadah mandiri, makan bersama, dan sesi berbagi cerita jamaah.',
        shot: 'Makan bersama, jamaah saling membantu, obrolan santai, testimoni singkat (kesan pertama di Madinah).',
        pilar: 'testimoni', ide: 'Reels testimoni: kesan jamaah selama di Madinah (15-30 detik).' },
    keMakkahBirAli: { judul: 'Persiapan ihram & miqat Bir Ali', lokasi: 'Masjid Bir Ali (Dzulhulaifah)', kategori: 'ibadah', fase: 'madinah', waktu: '', media: ['foto', 'video', 'reels'],
        deskripsi: 'Mandi sunnah, mengenakan ihram, shalat sunnah ihram, dan niat umroh di miqat.',
        shot: 'Jamaah berihram bersama, muthawif membimbing niat, suasana masjid miqat, bus siap berangkat ke Makkah.',
        pilar: 'edukasi', ide: 'Carousel edukasi: urutan ihram sampai niat umroh di miqat.', catatan: DKG_ATURAN },
    busMakkah: { judul: 'Perjalanan Madinah menuju Makkah', lokasi: 'Perjalanan darat', kategori: 'perjalanan', fase: 'madinah', waktu: '', media: ['video', 'story'],
        deskripsi: 'Perjalanan bus antar kota sambil talbiyah.',
        shot: 'Jamaah bertalbiyah di bus, pemandangan jalan, istirahat di rest area, tiba di Makkah.',
        pilar: 'storytelling', ide: 'Reels: talbiyah di dalam bus ("Labbaik Allahumma labbaik").' },
    tibaMakkah: { judul: 'Tiba di Makkah & check-in hotel', lokasi: 'Hotel Makkah', kategori: 'hotel', fase: 'makkah', waktu: '', media: ['foto', 'video', 'story'],
        deskripsi: 'Tiba di Makkah, check-in hotel, pembagian kamar, istirahat singkat sebelum umroh.',
        shot: 'Kedatangan di hotel, view menara jam/Masjidil Haram dari hotel, pembagian kamar, kamar.',
        pilar: 'behind', ide: 'Story: tur singkat hotel dan jarak ke Masjidil Haram.' },
    ihramMiqat: { judul: 'Niat ihram di miqat menuju Makkah', lokasi: 'Miqat / pesawat / bus', kategori: 'ibadah', fase: 'makkah', waktu: '', media: ['foto', 'video'],
        deskripsi: 'Niat ihram sesuai rute (mis. di pesawat atau miqat yang dilewati) sebelum ke Makkah.',
        shot: 'Jamaah berihram, muthawif membimbing niat dan talbiyah, momen pertama berniat umroh.',
        pilar: 'edukasi', ide: 'Reels edukasi: "Kapan dan di mana niat ihram umroh".' },
    thawaf: { judul: 'Thawaf umroh', lokasi: 'Masjidil Haram', kategori: 'ibadah', fase: 'makkah', waktu: '', media: ['foto', 'video', 'reels'],
        deskripsi: 'Thawaf tujuh putaran mengelilingi Ka\'bah.',
        shot: 'Pertama kali jamaah melihat Ka\'bah (ekspresi), rombongan memulai thawaf dari titik sejajar Hajar Aswad, suasana mataf dari kejauhan, muthawif membimbing doa.',
        pilar: 'storytelling', ide: 'Reels: "Pertama kali melihat Ka\'bah" reaksi jamaah (izin wajah jamaah dulu).', catatan: DKG_ATURAN },
    sai: { judul: 'Sa\'i Shafa - Marwah', lokasi: 'Masjidil Haram', kategori: 'ibadah', fase: 'makkah', waktu: '', media: ['foto', 'video'],
        deskripsi: 'Sa\'i tujuh kali antara Bukit Shafa dan Marwah.',
        shot: 'Jamaah di Shafa/Marwah, lintasan sa\'i, lampu hijau, jamaah lansia dibantu pendamping.',
        pilar: 'edukasi', ide: 'Carousel edukasi: kisah Siti Hajar di balik sa\'i.', catatan: DKG_ATURAN },
    tahallul: { judul: 'Tahallul (potong rambut)', lokasi: 'Area Marwah / hotel', kategori: 'ibadah', fase: 'makkah', waktu: '', media: ['foto', 'story'],
        deskripsi: 'Tahallul sebagai penutup rangkaian umroh.',
        shot: 'Momen tahallul (hindari menampilkan jamaah tanpa izin), ekspresi lega dan haru, foto grup selesai umroh.',
        pilar: 'kontemplasi', ide: 'Story/quote: "Umroh pertama selesai" syukur jamaah.' },
    haram: { judul: 'Ibadah di Masjidil Haram', lokasi: 'Masjidil Haram', kategori: 'ibadah', fase: 'makkah', waktu: 'Subuh', media: ['foto', 'video', 'reels'],
        deskripsi: 'Shalat berjamaah, tilawah, dan thawaf sunnah.',
        shot: 'Suasana subuh dan menjelang adzan, jamaah tilawah, pelataran Masjidil Haram, detail arsitektur.',
        pilar: 'kontemplasi', ide: 'Reels kontemplasi: suasana subuh Masjidil Haram dengan teks doa.', catatan: DKG_ATURAN },
    ziarahMakkah: { judul: 'Ziarah kota Makkah', lokasi: 'Jabal Tsur, Jabal Rahmah, Arafah, Mina, Muzdalifah', kategori: 'ziarah', fase: 'makkah', waktu: 'Pagi', media: ['foto', 'video', 'reels'],
        deskripsi: 'City tour ziarah sesuai itinerary: Jabal Tsur, Jabal Rahmah, Arafah, Muzdalifah, Mina, dan titik lain.',
        shot: 'Foto grup tiap lokasi, penjelasan sejarah dari muthawif, pemandangan padang Arafah, tenda Mina, plang lokasi.',
        pilar: 'edukasi', ide: 'Carousel edukasi: "Napak tilas Arafah, Muzdalifah, Mina" untuk calon jamaah.', catatan: DKG_ATURAN },
    oleh2: { judul: 'Belanja oleh-oleh Makkah', lokasi: 'Pusat oleh-oleh / pasar sekitar hotel', kategori: 'kebersamaan', fase: 'makkah', waktu: 'Sore', media: ['foto', 'reels', 'story'],
        deskripsi: 'Waktu bebas berbelanja oleh-oleh.',
        shot: 'Barang oleh-oleh khas, jamaah berbelanja, tips memilih oleh-oleh, tas yang mulai penuh.',
        pilar: 'engagement', ide: 'Reels: "Oleh-oleh wajib dari Makkah" + ajakan komentar.' },
    kebersamaanMakkah: { judul: 'Sesi berbagi & testimoni jamaah', lokasi: 'Hotel Makkah', kategori: 'kebersamaan', fase: 'makkah', waktu: 'Malam', media: ['foto', 'story', 'testimoni'],
        deskripsi: 'Berbagi kesan dan harapan jamaah di tengah perjalanan.',
        shot: 'Wawancara singkat jamaah (izin dulu), tawa dan haru, foto bersama muthawif dan tim.',
        pilar: 'testimoni', ide: 'Reels testimoni: pesan jamaah untuk calon jamaah berikutnya.' },
    wada: { judul: 'Thawaf wada\' (perpisahan)', lokasi: 'Masjidil Haram', kategori: 'ibadah', fase: 'makkah', waktu: '', media: ['foto', 'video', 'reels'],
        deskripsi: 'Thawaf perpisahan sebelum meninggalkan Makkah.',
        shot: 'Jamaah memandang Ka\'bah untuk terakhir kali, momen doa perpisahan, foto grup terakhir di Masjidil Haram.',
        pilar: 'kontemplasi', ide: 'Reels penutup: "Sampai jumpa lagi, Ya Allah" (kontemplasi).', catatan: DKG_ATURAN },
    keBandara: { judul: 'Check-out hotel & menuju bandara', lokasi: 'Hotel / Bandara Jeddah / Bandara Madinah', kategori: 'perjalanan', fase: 'kepulangan', waktu: '', media: ['foto', 'story'],
        deskripsi: 'Check-out, bagasi, perjalanan ke bandara, dan check-in penerbangan pulang.',
        shot: 'Koper dan bagasi, pelukan perpisahan dengan staf hotel, jamaah di bus, check-in bandara.',
        pilar: 'behind', ide: 'Story: "Waktunya pulang" dengan rekap perjalanan.' },
    pulang: { judul: 'Penerbangan pulang ke tanah air', lokasi: 'Dalam pesawat', kategori: 'perjalanan', fase: 'kepulangan', waktu: '', media: ['foto', 'story'],
        deskripsi: 'Penerbangan kembali ke Indonesia.',
        shot: 'Suasana kabin, jamaah beristirahat, momen refleksi.',
        pilar: 'kontemplasi', ide: 'Story/quote refleksi: oleh-oleh terbaik adalah perubahan diri.' },
    tiba: { judul: 'Tiba di tanah air & penyambutan keluarga', lokasi: 'Bandara kedatangan', kategori: 'perjalanan', fase: 'kepulangan', waktu: '', media: ['foto', 'video', 'reels', 'testimoni'],
        deskripsi: 'Kedatangan, pengambilan bagasi, dan penyambutan keluarga.',
        shot: 'Jamaah keluar dari pintu kedatangan, pelukan keluarga, air zamzam & oleh-oleh, foto grup penutup, testimoni singkat setelah mendarat.',
        pilar: 'storytelling', ide: 'Reels penutup: haru penyambutan keluarga + testimoni singkat jamaah.' },
    closing: { judul: 'Rekap & testimoni akhir program', lokasi: 'Kantor / grup WhatsApp jamaah', kategori: 'kebersamaan', fase: 'kepulangan', waktu: '', media: ['foto', 'video', 'testimoni'],
        deskripsi: 'Pengumpulan foto/video, testimoni, dan ucapan terima kasih kepada jamaah.',
        shot: 'Foto jamaah di rumah dengan oleh-oleh, testimoni video, ucapan terima kasih dari tim.',
        pilar: 'testimoni', ide: 'Carousel: kumpulan testimoni jamaah + ajakan program berikutnya.' }
};

// Susun daftar hari -> daftar id katalog. Hari 1 = berangkat, hari terakhir = tiba di tanah air.
// durasi: total hari; urutan: 'madinah-makkah' | 'makkah-madinah'; hariMadinah: jumlah hari di Madinah.
function dkgSusunTemplate({ durasi, urutan, hariMadinah }) {
    const N = Math.max(6, Math.min(30, durasi));
    const dalamKota = N - 2;                                   // hari 2 .. N-1
    const hMad = Math.max(2, Math.min(dalamKota - 2, hariMadinah));   // minimal 2 hari di tiap kota
    const hMak = dalamKota - hMad;
    const hari = [];                                           // hari[i] = array id katalog untuk hari ke-(i+1)
    hari.push(['kumpul', 'terbang']);

    const blokMadinah = (pertama) => {
        const out = [];
        for (let i = 0; i < hMad; i++) {
            if (i === 0) out.push(pertama ? ['tibaMadinah', 'nabawi'] : ['tibaMadinah', 'nabawi', 'raudhah']);
            else if (i === 1) out.push(['nabawi', 'raudhah', 'ziarahMadinah']);
            else if (i === hMad - 1 && pertama) out.push(['nabawi', 'kurma', 'keMakkahBirAli', 'busMakkah']);
            else if (i === 2) out.push(['nabawi', 'kurma', 'ibadahMadinah']);
            else out.push(['nabawi', 'ibadahMadinah']);
        }
        // Hari di Madinah hanya 2: pastikan perjalanan ke Makkah tetap tercatat saat Madinah di depan.
        if (pertama && hMad === 2) out[1] = ['nabawi', 'raudhah', 'ziarahMadinah', 'keMakkahBirAli', 'busMakkah'];
        return out;
    };
    const blokMakkah = (pertama) => {
        const out = [];
        for (let i = 0; i < hMak; i++) {
            if (i === 0) out.push(pertama ? ['ihramMiqat', 'tibaMakkah', 'thawaf', 'sai', 'tahallul'] : ['tibaMakkah', 'thawaf', 'sai', 'tahallul']);
            else if (i === hMak - 1) out.push(['haram', 'oleh2', 'wada']);
            else if (i === 1) out.push(['haram', 'ziarahMakkah']);
            else out.push(['haram', 'kebersamaanMakkah']);
        }
        return out;
    };

    if (urutan === 'makkah-madinah') {
        blokMakkah(true).forEach(h => hari.push(h));
        blokMadinah(false).forEach(h => hari.push(h));
    } else {
        blokMadinah(true).forEach(h => hari.push(h));
        blokMakkah(false).forEach(h => hari.push(h));
    }
    // Hari N-1 (hari terakhir di Saudi): menuju bandara & terbang; hari N: tiba di tanah air.
    hari[N - 2] = hari[N - 2].concat(['keBandara', 'pulang']);
    hari.push(['tiba', 'closing']);
    return hari;
}

function dkgBangunBarisTemplate(programId, opts) {
    const hari = dkgSusunTemplate(opts);
    const rows = [];
    // Persiapan (sebelum berangkat): tanpa tanggal, ditaruh di hari_ke 1 dengan fase 'persiapan'.
    const m = DKG_KATALOG.manasik;
    rows.push(dkgBarisDariKatalog(programId, m, 1, null, 10));
    hari.forEach((ids, idx) => {
        const hariKe = idx + 1;
        const tanggal = opts.tglBerangkat ? dkgAddDays(opts.tglBerangkat, idx) : null;
        ids.forEach((id, i) => rows.push(dkgBarisDariKatalog(programId, DKG_KATALOG[id], hariKe, tanggal, (i + 1) * 10)));
    });
    return rows;
}

function dkgBarisDariKatalog(programId, k, hariKe, tanggal, urutan) {
    return {
        program_id: programId,
        hari_ke: hariKe,
        tanggal: tanggal || null,
        waktu: k.waktu || null,
        fase: k.fase,
        kategori: k.kategori,
        lokasi: k.lokasi || null,
        judul: k.judul,
        deskripsi: k.deskripsi || null,
        jenis_media: k.media || [],
        shot_list: k.shot || null,
        pilar: k.pilar || null,
        ide_konten: k.ide || null,
        catatan: k.catatan || null,
        status: 'rencana',
        urutan
    };
}

function openDkgTemplateModal() {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengubah dokumentasi', 'error'); return; }
    if (!dkgProgramId) { showToast('Pilih program dulu', 'error'); return; }
    const durasi = dkgDurasiProgram(dkgProgramId);
    document.getElementById('dkgTpl_tgl').value = dkgTglBerangkatProgram(dkgProgramId);
    document.getElementById('dkgTpl_durasi').value = durasi;
    document.getElementById('dkgTpl_urutan').value = 'madinah-makkah';
    document.getElementById('dkgTpl_madinah').value = Math.max(2, Math.floor((durasi - 2) / 2));
    const peringatan = document.getElementById('dkgTplWarn');
    if (peringatan) {
        peringatan.style.display = dkgItems.length ? '' : 'none';
        peringatan.textContent = dkgItems.length ? `Program ini sudah punya ${dkgItems.length} kegiatan. Template akan DITAMBAHKAN di bawahnya (yang sudah ada tidak dihapus).` : '';
    }
    document.getElementById('dkgTemplateModal').classList.add('open');
}

function closeDkgTemplateModal() {
    document.getElementById('dkgTemplateModal')?.classList.remove('open');
}

async function applyDkgTemplate(e) {
    if (e) e.preventDefault();
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengubah dokumentasi', 'error'); return; }
    if (!dkgProgramId || dkgSaving) return;
    const tgl = document.getElementById('dkgTpl_tgl').value;
    const durasi = parseInt(document.getElementById('dkgTpl_durasi').value, 10);
    const hMad = parseInt(document.getElementById('dkgTpl_madinah').value, 10);
    const urutan = document.getElementById('dkgTpl_urutan').value;
    if (!Number.isInteger(durasi) || durasi < 6 || durasi > 30) { showToast('Durasi harus 6 sampai 30 hari', 'error'); return; }
    if (!Number.isInteger(hMad) || hMad < 2 || hMad > durasi - 4) { showToast(`Hari di Madinah harus antara 2 dan ${durasi - 4}`, 'error'); return; }
    if (tgl && !dkgParseIso(tgl)) { showToast('Tanggal berangkat tidak valid', 'error'); return; }

    const rows = dkgBangunBarisTemplate(dkgProgramId, { durasi, urutan, hariMadinah: hMad, tglBerangkat: tgl || null });
    dkgSaving = true;
    try {
        const { data, error } = await supabaseClient.from('dokumentasi_kegiatan').insert(rows).select();
        if (error) throw error;
        dkgItems = dkgItems.concat(data || []);
        closeDkgTemplateModal();
        renderDkgContent();
        showToast(`${rows.length} kegiatan ditambahkan dari template`);
    } catch (err) {
        console.error('applyDkgTemplate error:', err);
        showToast('Gagal membuat dari template: ' + (err.message || err), 'error');
    } finally {
        dkgSaving = false;
    }
}

// ------------------------------------------------------------
// Salin jadwal (teks siap kirim ke WhatsApp tim konten)
// ------------------------------------------------------------
function dkgBangunTeks() {
    const p = dkgProgram(dkgProgramId);
    const lines = [`*JADWAL & DOKUMENTASI UMROH*`, p ? `${p.nama}${p.tgl ? ' (' + p.tgl + ')' : ''}` : ''];
    let kunci = null;
    dkgSortItems(dkgItems).filter(i => i.status !== 'dilewati').forEach(it => {
        const k = it.fase === 'persiapan' ? 'persiapan' : 'h' + it.hari_ke;
        if (k !== kunci) {
            kunci = k;
            lines.push('');
            lines.push(it.fase === 'persiapan'
                ? '*Persiapan sebelum berangkat*'
                : `*Hari ${it.hari_ke}${it.tanggal ? ' - ' + dkgFormatTanggal(it.tanggal) : ''}*`);
        }
        const media = (it.jenis_media || []).map(m => (DKG_MEDIA.find(x => x.value === m) || {}).label).filter(Boolean).join(', ');
        lines.push(`- ${it.waktu ? it.waktu + ' | ' : ''}${it.judul}${it.lokasi ? ' @ ' + it.lokasi : ''}`);
        if (media) lines.push(`  Ambil: ${media}`);
        if (it.shot_list) lines.push(`  Shot list: ${it.shot_list}`);
    });
    return lines.join('\n').trim();
}

async function salinJadwalDokumentasi() {
    if (!dkgProgramId || !dkgItems.length) { showToast('Belum ada kegiatan untuk disalin', 'error'); return; }
    const teks = dkgBangunTeks();
    try {
        await navigator.clipboard.writeText(teks);
        showToast('Jadwal dokumentasi disalin');
    } catch (err) {
        const ta = document.createElement('textarea');
        ta.value = teks;
        ta.setAttribute('readonly', 'readonly');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showToast('Jadwal dokumentasi disalin'); }
        catch (_) { showToast('Gagal menyalin jadwal', 'error'); }
        finally { document.body.removeChild(ta); }
    }
}

// withBusy() (app.js): anti klik ganda + spinner pada tombol submit. Dibungkus di sini karena fungsinya baru ada setelah modul dimuat.
if (typeof window.saveDkg === 'function') window.saveDkg = withBusy(window.saveDkg);
if (typeof window.applyDkgTemplate === 'function') window.applyDkgTemplate = withBusy(window.applyDkgTemplate);
