// ============================================================
// MODUL LAZY: MENU PEMBAYARAN (admin)  (js/modules/pembayaran.js)
// ============================================================
// Dipecah dari js/app.js dan dimuat HANYA saat dibutuhkan (ensureModuleLoaded('pembayaran') di app.js).
// Dimuat sebagai <script> biasa (BUKAN ES module): satu lingkup global dengan app.js, jadi nama
// fungsi global, onclick="..." dan data-action="..." tidak berubah.
// ATURAN: jangan mendeklarasikan ulang nama yang sudah ada di app.js (const/let ganda = SyntaxError).
// Fungsi yang dirujuk index.html / kode inti SEBELUM modul dimuat didaftarkan di LAZY_MODULES['pembayaran'].api (app.js).
// SENGAJA tetap di app.js: state cache panel (pbCacheJamaahAll, pbCacheTotalPerJamaah, pbSearchDebounce),
// sinkron status jamaah (syncJamaahStatus*) dan state modal Kelola Cicilan; UI modalnya ada di modul 'cicilan' (js/modules/cicilan.js).
// ============================================================

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

    // [FIX BUG] Sebelumnya jamaah berstatus "Batal" ikut dihitung ke tagihan
    // (target) di kartu hero & rincian per program -- padahal di tabel
    // bawahnya jamaah batal sudah punya badge terpisah & sengaja dikeluarkan
    // dari hitungan Lunas/Cicilan/Belum Bayar. Akibatnya "Sisa Belum
    // Terbayar" total selalu lebih besar dari kenyataan karena ikut
    // menghitung tagihan booking yang sudah dibatalkan (dan tidak akan
    // pernah dilunasi). Exclude di sini juga supaya konsisten dengan tabel.
    jamaahAll = jamaahAll.filter(j => j.status !== 'batal');

    // Kelompokkan per program
    const byProgram = {};
    jamaahAll.forEach(j => {
        const pid = j.program_id != null ? String(j.program_id) : '_tanpa_program';
        if (!byProgram[pid]) {
            const program = dataUmroh.find(p => String(p.id) === pid);
            byProgram[pid] = {
                nama: program ? program.nama : 'Tanpa Program',
                tanggal: program ? program.tanggal_berangkat : null,
                program,
                jamaahCount: 0,
                tagihan: 0,
                dibayar: 0
            };
        }
        const g = byProgram[pid];
        g.jamaahCount += 1;
        g.tagihan += getHargaKamarJamaah(g.program, j);
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
                <div class="pb-hero-label"><i class="bi bi-piggy-bank-fill"></i> Total Sudah Dibayar Jamaah</div>
                <div class="pb-hero-amount">${formatRupiah(grandDibayar)}</div>
            </div>
            <div class="pb-hero-pct-badge">${grandPct}% dari total tagihan</div>
        </div>
        <div class="pb-hero-progress-track"><div class="pb-hero-progress-fill" style="width:${grandPct}%;"></div></div>
        <div class="pb-hero-foot">
            <span><i class="bi bi-receipt"></i>Total Tagihan<b>${formatRupiah(grandTagihan)}</b></span>
            <span><i class="bi bi-hourglass-split"></i>Sisa Belum Terbayar<b>${formatRupiah(grandSisa)}</b></span>
            <span><i class="bi bi-people-fill"></i>Jamaah<b>${totalJamaah}</b></span>
            <span><i class="bi bi-signpost-split-fill"></i>Program Berjalan<b>${programRows.length}</b></span>
        </div>
    `;

    // ---- Rincian per program ----
    if (countEl) countEl.textContent = `${programRows.length} program`;
    if (!programRows.length) {
        gridEl.innerHTML = `<div class="pb-income-empty">Belum ada data tagihan/pembayaran.</div>`;
        return;
    }
    gridEl.innerHTML = programRows.map(g => `
        <div class="pb-income-card">
            <div class="pb-income-card-head">
                <span class="pb-income-card-name" title="${escapeHtml(g.nama)}">${escapeHtml(g.nama)}</span>
                <span class="pb-income-card-jamaah"><i class="bi bi-people-fill"></i> ${g.jamaahCount}</span>
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

    // Isi dropdown filter program -- dibangun ulang tiap kali daftar program
    // BERUBAH (program baru ditambah, dihapus, atau diarsipkan), bukan cuma
    // sekali per sesi. Dicek pakai signature ringan (gabungan ID) supaya
    // tidak render ulang percuma tiap kali panel Pembayaran dibuka tanpa ada
    // perubahan data -- sekaligus tetap mempertahankan pilihan yang aktif.
    const progSelect = document.getElementById('pbFilterProgram');
    const currentProgramSignature = (dataUmroh || []).map(p => p.id).join(',');
    if (progSelect && progSelect.dataset.builtSignature !== currentProgramSignature) {
        const currentVal = progSelect.value;
        // Sertakan tanggal keberangkatan di label supaya program dengan nama
        // sama (mis. beberapa keberangkatan "Umroh Landing Madinah" di tanggal
        // berbeda) tidak terlihat dobel/membingungkan di dropdown.
        progSelect.innerHTML = '<option value="">Semua Program</option>' +
            (dataUmroh || []).map(p => `<option value="${p.id}">${escapeHtml(p.nama)}${p.tgl ? ' — ' + escapeHtml(p.tgl) : ''}</option>`).join('');
        progSelect.dataset.builtSignature = currentProgramSignature;
        if (currentVal && (dataUmroh || []).some(p => String(p.id) === String(currentVal))) progSelect.value = currentVal;
        buildPbProgramCombo(dataUmroh || []);
    }

    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--ink-soft);">Memuat...</td></tr>`;

    try {
        // Selalu ambil data jamaah terbaru supaya sinkron dengan perubahan di tab Keberangkatan
        await loadKbJamaah();

        const jamaahAll = kbJamaahList || [];
        if (!jamaahAll.length) {
            pbCacheJamaahAll = []; pbCacheTotalPerJamaah = {};
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

        // Simpan ke cache -- pencarian/filter berikutnya baca dari sini saja,
        // TIDAK fetch ulang ke server (lihat renderPembayaranTable()).
        pbCacheJamaahAll = jamaahAll;
        pbCacheTotalPerJamaah = totalPerJamaah;

        // ---- Card detail pemasukan (hero) + rincian pemasukan per program ----
        // Dihitung dari SELURUH data jamaah (tidak terpengaruh search/filter tabel di
        // bawah) supaya angka total pemasukan selalu mencerminkan kondisi sebenarnya.
        renderPembayaranIncomeSummary(jamaahAll, totalPerJamaah);

        renderPembayaranTable();

    } catch (err) {
        console.error('Render pembayaran panel error:', err);
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--danger);">Gagal memuat data: ${escapeHtml(err.message)}</td></tr>`;
    }
}

// Filter + render ulang tabel Pembayaran dari data yang SUDAH ada di cache
// (pbCacheJamaahAll/pbCacheTotalPerJamaah) -- dipanggil tiap kali kolom cari
// diketik atau filter diganti. Sengaja dipisah dari renderPembayaranPanel()
// (yang fetch ke Supabase) supaya ketik-cari tidak lag/nge-hit server tiap huruf.
function renderPembayaranTable() {
    const tbody = document.getElementById('pbTableBody');
    if (!tbody) return;
    // Cache belum ada (panel belum pernah full-load) -- fallback ke full render.
    if (!pbCacheJamaahAll) { renderPembayaranPanel(); return; }

    const jamaahAll = pbCacheJamaahAll;
    const totalPerJamaah = pbCacheTotalPerJamaah;

    const search = (document.getElementById('pbSearchInput')?.value || '').trim().toLowerCase();
    const filterProgram = document.getElementById('pbFilterProgram')?.value || '';
    const filterStatus = document.getElementById('pbFilterStatus')?.value || '';

    let rowsData = jamaahAll.map(j => {
        const program = dataUmroh.find(p => String(p.id) === String(j.program_id));
        const hargaProgram = getHargaKamarJamaah(program, j);
        const dibayar = totalPerJamaah[j.id] || 0;
        const sisa = Math.max(hargaProgram - dibayar, 0);
        const pct = hargaProgram > 0 ? Math.min(100, Math.round((dibayar / hargaProgram) * 100)) : 0;
        let status = 'belum';
        if (j.status === 'batal') status = 'batal';
        else if (hargaProgram > 0 && dibayar >= hargaProgram) status = 'lunas';
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

    // [FIX BUG] Sama seperti renderPembayaranIncomeSummary(): tagihan &
    // sisa di stats bar ini exclude jamaah "Batal" supaya "Sisa Belum
    // Terbayar" tidak digembungkan oleh booking yang sudah dibatalkan.
    const rowsDataAktif = rowsData.filter(r => r.status !== 'batal');
    const grandTagihan = rowsDataAktif.reduce((s, r) => s + r.hargaProgram, 0);
    const grandDibayar = rowsDataAktif.reduce((s, r) => s + r.dibayar, 0);
    const grandSisa = Math.max(grandTagihan - grandDibayar, 0);
    const totalLunas = rowsData.filter(r => r.status === 'lunas').length;
    const totalBelum = rowsData.filter(r => r.status === 'belum').length;
    const totalBatal = rowsData.filter(r => r.status === 'batal').length;
    const totalCicilan = rowsData.length - totalLunas - totalBelum - totalBatal;

    document.getElementById('pbStatsBar').innerHTML = `
        <span class="status-badge neutral">${rowsData.length} Jamaah</span>
        <span class="status-badge available">${totalLunas} Lunas</span>
        <span class="status-badge limited">${totalCicilan} Cicilan</span>
        <span class="status-badge full">${totalBelum} Belum Bayar</span>
        ${totalBatal ? `<span class="status-badge batal">${totalBatal} Batal</span>` : ''}
        <span class="status-badge neutral">Dibayar: ${formatRupiah(grandDibayar)}</span>
        <span class="status-badge ${grandSisa > 0 ? 'full' : 'neutral'}">Sisa: ${formatRupiah(grandSisa)}</span>
    `;
    document.getElementById('pbCount').textContent = `${rowsData.length} jamaah`;

    if (!rowsData.length) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--ink-soft);">Tidak ada data yang cocok dengan filter/pencarian.</td></tr>`;
        return;
    }

    const canEdit = canManageProgramData();
    tbody.innerHTML = rowsData.map(r => {
        let statusLabel, statusClass;
        if (r.status === 'batal') { statusLabel = '<i class="bi bi-x-circle-fill"></i> Batal'; statusClass = 'batal'; }
        else if (r.status === 'lunas') { statusLabel = '<i class="bi bi-check-circle-fill"></i> Lunas'; statusClass = 'available'; }
        else if (r.status === 'cicilan') { statusLabel = '<i class="bi bi-arrow-repeat"></i> Cicilan'; statusClass = 'limited'; }
        else { statusLabel = '<i class="bi bi-hourglass-split"></i> Belum Bayar'; statusClass = 'full'; }

        return `
            <tr>
                <td><strong>${escapeHtml(r.j.nama || '-')}</strong>${r.j.asal ? `<br><span style="font-size:11px;color:var(--ink-soft);">${escapeHtml(r.j.asal)}</span>` : ''}</td>
                <td>${escapeHtml(r.program ? r.program.nama : '-')}</td>
                <td style="white-space:nowrap;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span>${formatRupiah(r.hargaProgram)}</span>
                        <span class="status-badge neutral pill-sm">${parseRupiahToNumber(r.j.harga_custom) > 0 ? 'Harga Khusus' : (TIPE_KAMAR_LABEL[r.j.tipe_kamar] || 'Quad')}</span>
                    </div>
                </td>
                <td style="white-space:nowrap;color:var(--ink);font-weight:600;">${formatRupiah(r.dibayar)}</td>
                <td style="white-space:nowrap;color:var(--ink);font-weight:600;">${formatRupiah(r.sisa)}</td>
                <td style="min-width:130px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <div style="flex:1;background:var(--line);border-radius:6px;height:8px;overflow:hidden;">
                            <div style="background:var(--brand);height:100%;width:${r.pct}%;"></div>
                        </div>
                        <span class="status-badge neutral pill-sm">${r.pct}%</span>
                    </div>
                </td>
                <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                <td style="text-align:right;white-space:nowrap;">
                    <div class="pb-actions">
                        ${(r.status === 'belum' || r.status === 'cicilan') && r.j.wa ? `
                        <button class="btn-wa-reminder" style="font-size:11px;padding:5px 10px;" id="pbWaBtn_${r.j.id}" onclick="generatePaymentReminderWA('${r.j.id}')" title="Susun & kirim reminder WA">
                            <i class="bi bi-whatsapp"></i> Reminder WA
                        </button>` : ''}
                        <button class="btn-primary btn-pay" style="font-size:11px;padding:5px 10px;" onclick="openCicilanModal('${r.j.id}')" ${!canEdit ? 'disabled title="Tidak punya izin"' : ''}>
                            Update Pembayaran
                        </button>
                    </div>
                </td>
            </tr>`;
    }).join('');
}

// Susun draft reminder pembayaran personal per jamaah pakai AI, lalu buka
// wa.me dengan teks sudah terisi -- admin TETAP yang menekan kirim di
// WhatsApp (bukan pengiriman otomatis/massal, tidak butuh WhatsApp Business
// API). Dipanggil dari tombol "Reminder WA" di menu Pembayaran.
// Edge Function: PAYMENT_REMINDER_WA_FUNCTION_URL (generate-payment-reminder-wa).
async function generatePaymentReminderWA(jamaahId) {
    const btn = document.getElementById('pbWaBtn_' + jamaahId);
    if (!pbCacheJamaahAll) { showToast('Data pembayaran belum siap, coba lagi', 'error'); return; }
    const j = pbCacheJamaahAll.find(x => String(x.id) === String(jamaahId));
    if (!j) { showToast('Data jamaah tidak ditemukan', 'error'); return; }
    if (!j.wa) { showToast('Jamaah ini tidak punya nomor WA', 'error'); return; }

    const program = dataUmroh.find(p => String(p.id) === String(j.program_id));
    const hargaProgram = getHargaKamarJamaah(program, j);
    const dibayar = (pbCacheTotalPerJamaah && pbCacheTotalPerJamaah[j.id]) || 0;
    const sisa = Math.max(hargaProgram - dibayar, 0);
    const pct = hargaProgram > 0 ? Math.min(100, Math.round((dibayar / hargaProgram) * 100)) : 0;
    let status = 'belum';
    if (hargaProgram > 0 && dibayar >= hargaProgram) status = 'lunas';
    else if (dibayar > 0) status = 'cicilan';
    if (status === 'lunas') { showToast('Jamaah ini sudah lunas', 'error'); return; }

    let sisaHari = null;
    if (program && program.tgl) {
        const tglBerangkat = parseDateFromString(program.tgl);
        if (tglBerangkat && !isNaN(tglBerangkat.getTime())) {
            const today = new Date(); today.setHours(0,0,0,0);
            tglBerangkat.setHours(0,0,0,0);
            sisaHari = Math.ceil((tglBerangkat - today) / (1000 * 60 * 60 * 24));
        }
    }

    // Buka tab kosong SEKARANG (masih dalam gesture klik user) supaya browser
    // tidak memblokirnya sebagai popup -- URL-nya diisi setelah draft AI
    // selesai disusun (lihat winRef.location.href di bawah).
    const winRef = window.open('', '_blank');

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Menyusun...'; }
    try {
        const payload = {
            namaJamaah: j.nama, namaProgram: program ? program.nama : '-',
            tglBerangkat: program ? program.tgl : '-', sisaHari,
            hargaProgram: formatRupiah(hargaProgram), dibayar: formatRupiah(dibayar),
            sisa: formatRupiah(sisa), pct, status,
            companyName: NOTA_PERUSAHAAN.nama,
            kontakWa: getWaCaptionContacts(),
        };
        const response = await fetch(PAYMENT_REMINDER_WA_FUNCTION_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": "Bearer " + SUPABASE_ANON_KEY
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            let detail = '';
            try { detail = (await response.json()).error || ''; } catch (e) {}
            throw new Error(detail || 'Gagal memanggil API (status ' + response.status + ')');
        }
        const data = await response.json();
        const message = (data.message || '').trim();
        if (!message) throw new Error('Tidak ada hasil teks dari model.');

        const waLink = `https://wa.me/${j.wa.replace(/\D/g,'')}?text=${encodeURIComponent(message)}`;
        if (winRef) { winRef.location.href = waLink; }
        else { window.open(waLink, '_blank'); } // fallback kalau window.open awal diblokir
        showToast('Draft reminder WA siap — cek tab baru untuk kirim');
    } catch (err) {
        console.error(err);
        if (winRef) winRef.close();
        // Fallback: kalau AI gagal, tetap buka WA dengan sapaan polos (non-AI)
        // supaya admin tidak buntu, tinggal ketik manual sisanya.
        const fallbackText = `Assalamualaikum ${j.nama || ''}, kami dari ${NOTA_PERUSAHAAN.nama} ingin mengingatkan sisa tagihan program ${program ? program.nama : ''} sebesar ${formatRupiah(sisa)}. Mohon konfirmasinya, terima kasih.`;
        window.open(`https://wa.me/${j.wa.replace(/\D/g,'')}?text=${encodeURIComponent(fallbackText)}`, '_blank');
        showToast('AI gagal (' + err.message + ') — dipakai draft polos sebagai cadangan', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-whatsapp"></i> Reminder WA'; }
    }
}

// ============================================================
// 19B-1. COMBOBOX FILTER PROGRAM (Menu Pembayaran)
// Native <select> browser tidak bisa distyling untuk daftar panjang
// (highlight, jarak antar-opsi, scrollbar, dst), jadi dropdown filter
// program di sini diganti tampilan custom (div-based) yang tetap sinkron
// ke <select id="pbFilterProgram"> tersembunyi supaya renderPembayaranTable()
// tidak perlu diubah. Tiap opsi juga menampilkan tanggal keberangkatan
// supaya program dengan nama sama tidak terlihat dobel/membingungkan.
// ============================================================
let pbProgramComboData = [];

function buildPbProgramCombo(programs) {
    pbProgramComboData = (programs || []).slice().sort((a, b) => {
        // Program dengan tanggal keberangkatan terdekat di atas
        const da = a.dateObj instanceof Date && !isNaN(a.dateObj) ? a.dateObj : new Date(8640000000000000);
        const db = b.dateObj instanceof Date && !isNaN(b.dateObj) ? b.dateObj : new Date(8640000000000000);
        return da - db;
    });
    renderPbProgramComboList(pbProgramComboData, '');
}

function renderPbProgramComboList(programs, activeId) {
    const listEl = document.getElementById('pbProgramComboList');
    if (!listEl) return;
    const currentVal = document.getElementById('pbFilterProgram')?.value || '';

    const allItemHtml = `
        <div class="pb-combo-item ${!currentVal ? 'active' : ''}" onclick="selectPbProgramOption('', 'Semua Program')">
            <i class="bi bi-collection"></i>
            <span class="pb-combo-item-main">Semua Program</span>
        </div>`;

    if (!programs.length) {
        listEl.innerHTML = allItemHtml + `<div class="pb-combo-empty">Program tidak ditemukan.</div>`;
        return;
    }

    listEl.innerHTML = allItemHtml + programs.map(p => `
        <div class="pb-combo-item ${String(currentVal) === String(p.id) ? 'active' : ''}" onclick="selectPbProgramOption('${p.id}', '${escapeJsAttr(p.nama)}')">
            <i class="bi bi-airplane-engines"></i>
            <span class="pb-combo-item-main">
                <span class="pb-combo-item-name">${escapeHtml(p.nama)}</span>
                ${p.tgl ? `<span class="pb-combo-item-date">${escapeHtml(p.tgl)}</span>` : ''}
            </span>
        </div>`).join('');
}

function filterPbProgramComboOptions(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) { renderPbProgramComboList(pbProgramComboData, ''); return; }
    const filtered = pbProgramComboData.filter(p => (p.nama || '').toLowerCase().includes(q) || (p.tgl || '').toLowerCase().includes(q));
    renderPbProgramComboList(filtered, '');
}

function togglePbProgramCombo() {
    const panel = document.getElementById('pbProgramComboPanel');
    const combo = document.getElementById('pbProgramCombo');
    if (!panel || !combo) return;
    const willOpen = !combo.classList.contains('open');
    closeAllPbProgramCombo();
    if (willOpen) {
        positionPbProgramComboPanel(combo, panel);
        combo.classList.add('open');
        const searchInput = document.getElementById('pbProgramComboSearch');
        if (searchInput) { searchInput.value = ''; setTimeout(() => searchInput.focus(), 30); }
        renderPbProgramComboList(pbProgramComboData, '');
    }
}

// Buka panel ke bawah selama ruang di bawah trigger cukup; kalau ruang
// di bawah lebih sempit dari perkiraan tinggi panel (dan ruang di atas
// lebih luas), panel dibuka ke atas supaya tidak kepotong viewport.
function positionPbProgramComboPanel(combo, panel) {
    const rect = combo.getBoundingClientRect();
    const estPanelHeight = Math.min(340, panel.scrollHeight || 340);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < estPanelHeight && spaceAbove > spaceBelow;
    combo.classList.toggle('drop-up', openUp);
}

function closeAllPbProgramCombo() {
    document.getElementById('pbProgramCombo')?.classList.remove('open');
}

function selectPbProgramOption(id, nama) {
    const select = document.getElementById('pbFilterProgram');
    const label = document.getElementById('pbProgramComboLabel');
    if (select) select.value = id;
    if (label) label.textContent = id ? nama : 'Semua Program';
    document.getElementById('pbProgramCombo')?.classList.remove('open');
    renderPembayaranTable();
}

document.addEventListener('click', (e) => {
    const combo = document.getElementById('pbProgramCombo');
    if (combo && combo.classList.contains('open') && !combo.contains(e.target)) {
        combo.classList.remove('open');
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllPbProgramCombo();
});

// Versi debounce dari renderPembayaranTable() -- dipakai khusus di kolom cari
// supaya tabel tidak di-render ulang di setiap ketukan tombol (nunggu jeda
// ketik ~250ms dulu), lebih responsif terutama kalau data jamaah banyak.
function handlePbSearchInput() {
    clearTimeout(pbSearchDebounce);
    pbSearchDebounce = setTimeout(renderPembayaranTable, 250);
}
