// ============================================================
// MODUL LAZY: ASSETS (link/bookmark) + UI SUB-TAB HOTEL SAUDI ARABIA  (js/modules/assets.js)
// ============================================================
// Dipecah dari js/app.js dan dimuat HANYA saat dibutuhkan (ensureModuleLoaded('assets') di app.js).
// Dimuat sebagai <script> biasa (BUKAN ES module): satu lingkup global dengan app.js, jadi nama
// fungsi global, onclick="..." dan data-action="..." tidak berubah.
// ATURAN: jangan mendeklarasikan ulang nama yang sudah ada di app.js (const/let ganda = SyntaxError).
// Fungsi yang dirujuk index.html / kode inti SEBELUM modul dimuat didaftarkan di LAZY_MODULES['assets'].api (app.js).
//
// Isi modul: CRUD link Assets, tabel Hotel Saudi Arabia (cari/filter), ekspor CSV, impor CSV.
// SENGAJA tetap di app.js (dipakai form Program / parser / Crosscheck secara sinkron):
//   loadHotelSaudiArabia, ensureHotelReferenceLoaded, mesin pencocokan (findBestHotelMatch, dice, ...),
//   hint form Program (handleHotelRefInput, updateHotelRefHint), pustaka detail hotel
//   (ensureHotelDetailsLoaded, lookupHotelDetailJarak, saveHotelDetailsFromForm, ...),
//   switchAssetsInnerTab, switchUsInnerTab, escapeHtmlAttr, state assetsList/hotelSaudiList/hotelSaudiLoaded.
// ============================================================

// ============================================================
// 21b. ASSETS (CRUD) — link/bookmark ke dokumen penting
// ============================================================

async function loadAssets() {
    try {
        const { data, error } = await supabaseClient.from('assets').select('*').order('kategori', { ascending: true, nullsFirst: false }).order('judul', { ascending: true });
        if (error) throw error;
        assetsList = data || [];
    } catch (err) {
        console.error('Load assets error:', err);
        assetsList = [];
        showToast('Gagal memuat data Assets — periksa koneksi internet', 'error');
    }
}

function renderAssetsAdminTable() {
    const wrap = document.getElementById('assetsListWrap');
    if (!wrap) return;

    if (!assetsList.length) {
        wrap.innerHTML = `<div class="pf-empty"><i class="bi bi-bookmark-star"></i>Belum ada link tersimpan. Klik "Tambah Link" untuk menambahkan dokumen penting (SOP, kontrak, akun cloud, dsb).</div>`;
        return;
    }

    // Kelompokkan per kategori supaya makin banyak link tetap rapi dicari.
    const groups = {};
    assetsList.forEach(a => {
        const key = (a.kategori || '').trim() || 'Lainnya';
        if (!groups[key]) groups[key] = [];
        groups[key].push(a);
    });
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        if (a === 'Lainnya') return 1;
        if (b === 'Lainnya') return -1;
        return a.localeCompare(b);
    });

    // Tombol Edit/Hapus hanya untuk Admin -- role 'user' (editor) cuma boleh
    // lihat & buka link walau menu Assets ini boleh diaktifkan untuknya
    // (lihat canManageAssets()).
    const canManage = canManageAssets();
    wrap.innerHTML = sortedKeys.map(key => `
        <div class="asset-group">
            <div class="asset-group-title">${escapeHtml(key)} <span class="asset-group-count">${groups[key].length}</span></div>
            <div class="asset-cards">
                ${groups[key].map(a => `
                    <div class="asset-card">
                        <a href="${escapeHtmlAttr(ensureUrlProtocol(a.url))}" target="_blank" rel="noopener noreferrer" class="asset-card-main" title="${escapeHtmlAttr(a.url || '')}">
                            <div class="asset-card-icon"><i class="bi ${getAssetIcon(a.url)}"></i></div>
                            <div class="asset-card-body">
                                <div class="asset-card-title-row">
                                    <span class="asset-card-title">${escapeHtml(a.judul || '-')}</span>
                                    ${a.catatan ? `<span class="asset-card-tag" title="${escapeHtmlAttr(a.catatan)}">${escapeHtml(a.catatan)}</span>` : ''}
                                </div>
                                <div class="asset-card-url">${escapeHtml(a.url || '')}</div>
                            </div>
                        </a>
                        ${canManage ? `
                        <div class="asset-card-actions">
                            <button type="button" class="pf-btn-edit" onclick="openAssetModal('${a.id}')" title="Edit"><i class="bi bi-pencil-fill"></i> Edit</button>
                            <button type="button" class="pf-btn-delete" onclick="openDeleteModal('assets', '${a.id}', '${escapeJsAttr(a.judul)}')" title="Hapus"><i class="bi bi-trash-fill"></i> Hapus</button>
                        </div>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

// Tambah "https://" otomatis kalau user lupa isi protokol, supaya link tetap
// bisa diklik terbuka di tab baru alih-alih dianggap path relatif.
function ensureUrlProtocol(url) {
    const u = (url || '').trim();
    if (!u) return '#';
    if (/^https?:\/\//i.test(u)) return u;
    return 'https://' + u;
}

// Tebak ikon yang relevan dari domain URL, supaya tiap kartu Assets kelihatan
// beda sekilas (Drive, Canva, YouTube, dsb) tanpa perlu field tambahan di DB.
function getAssetIcon(url) {
    const u = (url || '').toLowerCase();
    if (/drive\.google\.com|docs\.google\.com|sheets\.google\.com|slides\.google\.com/.test(u)) return 'bi-google';
    if (/canva\.com/.test(u)) return 'bi-palette-fill';
    if (/youtube\.com|youtu\.be/.test(u)) return 'bi-youtube';
    if (/figma\.com/.test(u)) return 'bi-vector-pen';
    if (/notion\.so|notion\.site/.test(u)) return 'bi-journal-text';
    if (/instagram\.com/.test(u)) return 'bi-instagram';
    if (/wa\.me|whatsapp\.com/.test(u)) return 'bi-whatsapp';
    if (/dropbox\.com/.test(u)) return 'bi-dropbox';
    if (/\.pdf(\?|$)/.test(u)) return 'bi-file-earmark-pdf-fill';
    return 'bi-link-45deg';
}


function populateHotelSaudiCityFilter() {
    const sel = document.getElementById('hotelSaudiCitySelect');
    if (!sel) return;
    const counts = {};
    hotelSaudiList.forEach(h => { const c = (h.city || '').trim(); if (c) counts[c] = (counts[c] || 0) + 1; });
    const cities = Object.keys(counts).sort();
    sel.innerHTML = '<option value="">Semua Kota</option>' + cities.map(c => `<option value="${escapeHtmlAttr(c)}">${escapeHtml(c)} (${counts[c]})</option>`).join('');
}

let hotelSaudiSearchDebounce = null;
function handleHotelSaudiSearchInput() {
    clearTimeout(hotelSaudiSearchDebounce);
    hotelSaudiSearchDebounce = setTimeout(renderHotelSaudiTable, 250);
}

function renderHotelSaudiTable() {
    const wrap = document.getElementById('hotelSaudiWrap');
    if (!wrap) return;

    if (!hotelSaudiLoaded) return;

    if (!hotelSaudiList.length) {
        wrap.innerHTML = `<div class="pf-empty"><i class="bi bi-building"></i>Data hotel belum diimport. Jalankan <code>sql/37_tambah_hotel_saudi_arabia.sql</code> lalu <code>sql/39_import_hotel_saudi_arabia.sql</code> di Supabase SQL Editor.</div>`;
        return;
    }

    const term = (document.getElementById('hotelSaudiSearchInput')?.value || '').toLowerCase().trim();
    const city = document.getElementById('hotelSaudiCitySelect')?.value || '';

    let filtered = hotelSaudiList;
    if (city) filtered = filtered.filter(h => h.city === city);
    if (term) {
        const keywords = term.split(/\s+/).filter(Boolean);
        filtered = filtered.filter(h => {
            const haystack = [h.hotel_name, h.description, h.city].join(' ').toLowerCase();
            return keywords.every(kw => haystack.includes(kw));
        });
    }

    if (!filtered.length) {
        wrap.innerHTML = `<div class="pf-empty"><i class="bi bi-search"></i>Tidak ada hotel yang cocok dengan pencarian.</div>`;
        return;
    }

    const LIMIT = 100;
    const shown = filtered.slice(0, LIMIT);
    wrap.innerHTML = `
        <div class="hotel-result-count">Menampilkan ${shown.length} dari ${filtered.length} hotel (total ${hotelSaudiList.length})${filtered.length > LIMIT ? ' — perhalus pencarian untuk hasil lebih spesifik' : ''}</div>
        <div class="hotel-table-wrap">
            <table class="hotel-table">
                <thead>
                    <tr><th>Hotel</th><th>Kota</th><th>Skor</th><th>Ulasan</th><th>Deskripsi</th></tr>
                </thead>
                <tbody>
                    ${shown.map(h => `
                        <tr>
                            <td class="hotel-name-cell">${escapeHtml(h.hotel_name || '-')}</td>
                            <td>${escapeHtml(h.city || '-')}</td>
                            <td>${h.score != null ? `<span class="hotel-score-pill">${escapeHtml(String(h.score))}</span>` : '<span style="color:var(--ink-soft);">—</span>'}</td>
                            <td>${h.review_count != null ? escapeHtml(Number(h.review_count).toLocaleString('id-ID')) : '—'}</td>
                            <td class="hotel-desc-cell" title="${escapeHtmlAttr(h.description || '')}">${escapeHtml(h.description || '-')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// Export seluruh data hotel (bukan cuma hasil filter) ke CSV supaya bisa
// diedit di Excel/Sheets lalu diimport balik ke Supabase. Kolom `id` ikut
// diexport sebagai kunci baris: baris dengan id yang sama = diperbarui,
// id dikosongkan = hotel baru. UTF-8 + BOM supaya nama hotel berhuruf Arab
// tidak rusak saat dibuka di Excel.
function csvCell(v) {
    if (v === null || v === undefined) return '';
    const str = String(v).replace(/\r?\n/g, ' ');
    return /[",;\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}
async function exportHotelSaudiCsv() {
    const btn = document.getElementById('hotelExportCsvBtn');
    if (btn) btn.disabled = true;
    try {
        if (!hotelSaudiLoaded) await loadHotelSaudiArabia();
        if (!hotelSaudiLoaded || !hotelSaudiList.length) {
            showToast('Belum ada data hotel untuk diexport', 'error');
            return;
        }
        const cols = ['id', 'hotel_name', 'city', 'country', 'score', 'review_count', 'description'];
        const rows = [...hotelSaudiList].sort((a, b) =>
            String(a.city || '').localeCompare(String(b.city || '')) || (Number(a.id) || 0) - (Number(b.id) || 0));
        const csv = [cols.join(',')]
            .concat(rows.map(h => cols.map(c => csvCell(h[c])).join(',')))
            .join('\r\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `hotel_saudi_arabia_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        showToast(`${rows.length} hotel berhasil diexport ke CSV`);
    } catch (err) {
        console.error('Export hotel CSV error:', err);
        showToast('Gagal export CSV hotel', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}
window.exportHotelSaudiCsv = exportHotelSaudiCsv;

// ============================================================
// IMPORT CSV HOTEL SAUDI ARABIA
// Alur: pilih file -> parse & validasi di browser -> pratinjau (jumlah baris,
// baris yang dilewati) -> konfirmasi -> RPC replace_hotel_saudi_arabia yang
// menghapus SEMUA data lama & mengisi data baru dalam satu transaksi.
// Hanya Admin (dicek juga di database: sql/38_tambah_import_hotel_saudi_arabia.sql).
// Kolom CSV: hotel_name, city (wajib) + country, score, review_count,
// description (opsional). Kolom `id` diabaikan (id dibuat ulang oleh database).
// ============================================================
let hotelImportPending = null;
const HOTEL_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const HOTEL_IMPORT_MAX_ROWS = 5000;
const HOTEL_CSV_ALIASES = {
    hotel_name: ['hotel_name', 'hotel', 'nama_hotel', 'nama', 'name'],
    city: ['city', 'kota'],
    country: ['country', 'negara'],
    score: ['score', 'skor', 'rating'],
    review_count: ['review_count', 'reviews', 'ulasan', 'jumlah_ulasan'],
    description: ['description', 'deskripsi', 'keterangan']
};

// Parser CSV (RFC 4180): kutip ganda, "" sebagai escape, koma/titik-koma
// di dalam kutip, baris baru di dalam kutip, BOM, CRLF/LF.
function parseCsvText(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delim = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
    const rows = [];
    let row = [], field = '', inQuotes = false;
    const pushRow = () => {
        row.push(field); field = '';
        if (row.some(c => c.trim() !== '')) rows.push(row);
        row = [];
    };
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
            } else field += ch;
        } else if (ch === '"') inQuotes = true;
        else if (ch === delim) { row.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; pushRow(); }
        else field += ch;
    }
    if (field !== '' || row.length) pushRow();
    return rows;
}

function normalizeHotelCity(v) {
    const s = String(v || '').trim().toLowerCase();
    if (/makk?a|mekk?ah?|mecca|مكة/.test(s)) return 'makkah';
    if (/madin|medin|المدينة/.test(s)) return 'madinah';
    return '';
}

// Ubah teks CSV jadi { rows, errors, total, duplicates, fatal }.
function buildHotelImportPreview(text) {
    const result = { rows: [], errors: [], total: 0, duplicates: 0, fatal: '' };
    const table = parseCsvText(text);
    if (table.length < 2) { result.fatal = 'File kosong atau hanya berisi header.'; return result; }

    const header = table[0].map(h => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
    const col = {};
    Object.entries(HOTEL_CSV_ALIASES).forEach(([key, aliases]) => {
        const idx = header.findIndex(h => aliases.includes(h));
        if (idx >= 0) col[key] = idx;
    });
    if (col.hotel_name === undefined || col.city === undefined) {
        result.fatal = 'Header CSV harus punya kolom hotel_name dan city. Gunakan file hasil Export CSV sebagai acuan.';
        return result;
    }
    if (table.length - 1 > HOTEL_IMPORT_MAX_ROWS) {
        result.fatal = `Terlalu banyak baris (maks ${HOTEL_IMPORT_MAX_ROWS.toLocaleString('id-ID')}).`;
        return result;
    }

    const seen = new Set();
    const get = (r, key) => (col[key] === undefined ? '' : String(r[col[key]] ?? '').replace(/\s+/g, ' ').trim());
    for (let i = 1; i < table.length; i++) {
        const r = table[i];
        const lineNo = i + 1;
        result.total++;
        const name = get(r, 'hotel_name');
        const cityRaw = get(r, 'city');
        if (!name) { result.errors.push(`Baris ${lineNo}: nama hotel kosong`); continue; }
        if (name.length > 200) { result.errors.push(`Baris ${lineNo} (${name.slice(0, 30)}…): nama hotel lebih dari 200 karakter`); continue; }
        const city = normalizeHotelCity(cityRaw);
        if (!city) { result.errors.push(`Baris ${lineNo} (${name}): kota "${cityRaw || '-'}" tidak dikenali — isi makkah atau madinah`); continue; }

        let score = null;
        const scoreRaw = get(r, 'score');
        if (scoreRaw !== '') {
            score = Number(scoreRaw.replace(',', '.'));
            if (!Number.isFinite(score) || score < 0 || score > 10) { result.errors.push(`Baris ${lineNo} (${name}): skor "${scoreRaw}" harus angka 0–10`); continue; }
            score = Math.round(score * 10) / 10;
        }
        let reviews = null;
        const revRaw = get(r, 'review_count').replace(/[.\s]/g, '');
        if (revRaw !== '') {
            reviews = Number(revRaw);
            if (!Number.isInteger(reviews) || reviews < 0 || reviews > 2147483647) { result.errors.push(`Baris ${lineNo} (${name}): jumlah ulasan "${get(r, 'review_count')}" harus bilangan bulat`); continue; }
        }
        const key = city + '|' + name.toLowerCase();
        if (seen.has(key)) { result.duplicates++; continue; }
        seen.add(key);
        result.rows.push({
            hotel_name: name,
            city,
            country: get(r, 'country') || 'Saudi Arabia',
            score,
            review_count: reviews,
            description: get(r, 'description') || null
        });
    }
    return result;
}

async function handleHotelImportFile(input) {
    const file = input.files && input.files[0];
    input.value = ''; // supaya file yang sama bisa dipilih lagi
    if (!file) return;
    if (!canManageAssets()) { showToast('Hanya Admin yang boleh mengimpor data hotel', 'error'); return; }
    if (file.size > HOTEL_IMPORT_MAX_BYTES) { showToast('File terlalu besar (maks 5 MB)', 'error'); return; }
    try {
        const text = await file.text();
        hotelImportPending = { fileName: file.name, preview: buildHotelImportPreview(text) };
    } catch (err) {
        console.error('Baca CSV hotel error:', err);
        showToast('Gagal membaca file CSV', 'error');
        return;
    }
    // Pastikan jumlah data lama terbaru untuk peringatan di pratinjau
    if (!hotelSaudiLoaded) await loadHotelSaudiArabia();
    renderHotelImportPreview();
    document.getElementById('hotelImportModal').classList.add('open');
}

function renderHotelImportPreview() {
    const box = document.getElementById('hotelImportBody');
    const btn = document.getElementById('hotelImportConfirmBtn');
    if (!box || !hotelImportPending) return;
    const { fileName, preview: p } = hotelImportPending;
    const oldCount = hotelSaudiList.length;
    const esc = escapeHtml;

    if (p.fatal) {
        box.innerHTML = `<div class="hotel-import-file"><i class="bi bi-file-earmark-x"></i> ${esc(fileName)}</div>
            <div class="hotel-import-alert danger"><i class="bi bi-x-octagon-fill"></i> ${esc(p.fatal)}</div>`;
        if (btn) btn.disabled = true;
        return;
    }
    const mk = p.rows.filter(r => r.city === 'makkah').length;
    const md = p.rows.filter(r => r.city === 'madinah').length;
    const noScore = p.rows.filter(r => r.score == null).length;
    const tooFew = oldCount > 0 && p.rows.length < oldCount * 0.5;
    const errList = p.errors.slice(0, 8).map(e => `<li>${esc(e)}</li>`).join('');
    const moreErr = p.errors.length > 8 ? `<li>…dan ${p.errors.length - 8} baris lain</li>` : '';

    box.innerHTML = `
        <div class="hotel-import-file"><i class="bi bi-file-earmark-spreadsheet"></i> ${esc(fileName)}</div>
        <div class="hotel-import-stats">
            <div><b>${p.rows.length}</b><span>hotel siap diimport</span></div>
            <div><b>${mk}</b><span>Makkah</span></div>
            <div><b>${md}</b><span>Madinah</span></div>
            <div><b>${p.errors.length + p.duplicates}</b><span>baris dilewati</span></div>
        </div>
        <div class="hotel-import-alert danger">
            <i class="bi bi-exclamation-triangle-fill"></i>
            <div><b>Semua ${oldCount} data hotel lama akan dihapus</b> dan diganti ${p.rows.length} hotel dari file ini. Tindakan ini tidak bisa dibatalkan — gunakan <b>Export CSV</b> dulu kalau butuh cadangan.</div>
        </div>
        ${tooFew ? `<div class="hotel-import-alert warn"><i class="bi bi-exclamation-circle-fill"></i><div>Jumlah hotel di file ini jauh lebih sedikit dari data lama (${oldCount}). Pastikan file-nya lengkap.</div></div>` : ''}
        ${p.errors.length ? `<div class="hotel-import-alert warn"><i class="bi bi-info-circle-fill"></i><div><b>${p.errors.length} baris dilewati karena tidak valid:</b><ul>${errList}${moreErr}</ul></div></div>` : ''}
        ${p.duplicates ? `<div class="hotel-import-note">${p.duplicates} baris duplikat (nama & kota sama) dilewati, baris pertama dipakai.</div>` : ''}
        ${noScore ? `<div class="hotel-import-note">${noScore} hotel tanpa skor akan tampil "—".</div>` : ''}`;
    if (btn) btn.disabled = p.rows.length === 0;
}

function closeHotelImportModal() {
    document.getElementById('hotelImportModal')?.classList.remove('open');
    hotelImportPending = null;
}

async function confirmHotelImport() {
    if (!hotelImportPending || hotelImportPending.preview.fatal || !hotelImportPending.preview.rows.length) return;
    if (!canManageAssets()) { showToast('Hanya Admin yang boleh mengimpor data hotel', 'error'); return; }
    const btn = document.getElementById('hotelImportConfirmBtn');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-arrow-repeat bi-spin"></i> Mengimpor...'; }
    try {
        const { data, error } = await supabaseClient.rpc('replace_hotel_saudi_arabia', { p_rows: hotelImportPending.preview.rows });
        if (error) throw error;
        closeHotelImportModal();
        hotelSaudiLoaded = false;
        await loadHotelSaudiArabia();
        populateHotelSaudiCityFilter();
        renderHotelSaudiTable();
        if (cxSelectedProgram) renderCxPanel(cxSelectedProgram);
        showToast(`Import selesai: ${data ?? hotelSaudiList.length} hotel menggantikan data lama`);
    } catch (err) {
        console.error('Import hotel CSV error:', err);
        const missing = err && (err.code === 'PGRST202' || /Could not find the function|does not exist/i.test(err.message || ''));
        showToast(missing
            ? 'Fungsi import belum ada di database — jalankan sql/38_tambah_import_hotel_saudi_arabia.sql dulu'
            : `Import gagal, data lama tidak berubah: ${err.message || 'kesalahan tidak diketahui'}`, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
        return;
    }
    if (btn) btn.innerHTML = origHtml;
}
window.handleHotelImportFile = handleHotelImportFile;
window.closeHotelImportModal = closeHotelImportModal;
window.confirmHotelImport = confirmHotelImport;

function openAssetModal(id = null) {
    if (!canManageAssets()) { showToast('Hanya Admin yang boleh mengelola Assets', 'error'); return; }
    editingAssetId = id;
    document.getElementById('asset_editId').value = '';
    document.getElementById('assetForm').reset();

    if (id) {
        const a = assetsList.find(item => String(item.id) === String(id));
        if (!a) { showToast('Data tidak ditemukan', 'error'); return; }
        document.getElementById('assetModalTitle').textContent = 'Edit Link';
        document.getElementById('asset_editId').value = a.id;
        document.getElementById('asset_judul').value = a.judul || '';
        document.getElementById('asset_url').value = a.url || '';
        document.getElementById('asset_kategori').value = a.kategori || '';
        document.getElementById('asset_catatan').value = a.catatan || '';
    } else {
        document.getElementById('assetModalTitle').textContent = 'Tambah Link';
    }

    document.getElementById('assetModal').classList.add('open');
    setTimeout(() => document.getElementById('asset_judul').focus(), 50);
}

function closeAssetModal() {
    document.getElementById('assetModal').classList.remove('open');
    editingAssetId = null;
}

async function saveAsset(e) {
    if (e) e.preventDefault();
    if (!canManageAssets()) { showToast('Hanya Admin yang boleh mengelola Assets', 'error'); return; }

    const id = document.getElementById('asset_editId').value;
    const judul = document.getElementById('asset_judul').value.trim();
    let url = document.getElementById('asset_url').value.trim();
    const kategori = document.getElementById('asset_kategori').value.trim();
    const catatan = document.getElementById('asset_catatan').value.trim();

    if (!judul) { showToast('Judul link wajib diisi', 'error'); return; }
    if (!url) { showToast('URL wajib diisi', 'error'); return; }
    url = ensureUrlProtocol(url);

    const data = { judul, url, kategori: kategori || null, catatan: catatan || null };

    try {
        let result;
        if (id) {
            result = await supabaseClient.from('assets').update(data).eq('id', id);
        } else {
            result = await supabaseClient.from('assets').insert([data]);
        }
        if (result.error) throw result.error;

        showToast(id ? 'Link berhasil diperbarui' : 'Link berhasil ditambahkan');
        closeAssetModal();
        await loadAssets();
        renderAssetsAdminTable();
    } catch (err) {
        console.error('Save asset error:', err);
        showToast('Gagal menyimpan: ' + err.message, 'error');
    }
}


// withBusy() (app.js): anti klik ganda + spinner. Dibungkus di sini karena fungsinya baru ada setelah modul dimuat.
if (typeof window.saveAsset === 'function') window.saveAsset = withBusy(window.saveAsset);
