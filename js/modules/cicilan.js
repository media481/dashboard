// ============================================================
// MODUL LAZY: KELOLA CICILAN  (js/modules/cicilan.js)
// ============================================================
// Dipecah dari js/app.js dan dimuat HANYA saat dibutuhkan (ensureModuleLoaded('cicilan') di app.js),
// yaitu saat tombol "Bayar" ditekan (openCicilanModal). Dimuat sebagai <script> biasa (BUKAN ES module):
// satu lingkup global dengan app.js, jadi nama fungsi global, onclick="..." dan data-action tidak berubah.
// ATURAN: jangan mendeklarasikan ulang nama yang sudah ada di app.js (const/let ganda = SyntaxError).
// Isi: modal Kelola Cicilan (buka/tutup, riwayat, form tambah, isi sisa tagihan, simpan, hapus).
// Tetap di app.js: state cicilanList/cicilanJamaahId/cicilanJamaahInfo/cicilanProgramInfo/cicilanHargaProgram/
// cicilanSisaTagihan (dibaca modul nota & audit-nota serta confirmDeleteAction), notaPreviewPending/
// notaLiveDraftDebounce, hideNotaPreviewPanel(), afterDeleteCicilan(), syncJamaahStatus(),
// syncJamaahStatusForProgram() (dipanggil alur inti: simpan program & konfirmasi hapus pembayaran,
// jadi sinkron status tidak boleh bergantung pada unduhan modul).
// saveCicilan()/deleteCicilan() sengaja TIDAK didaftarkan sebagai stub: form baru bisa disubmit setelah
// modal terbuka (= modul sudah termuat), dan stub tidak bisa memanggil e.preventDefault() secara sinkron.
// ============================================================

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

// withBusy() (app.js): anti klik ganda + spinner. Dibungkus di sini karena fungsinya baru ada setelah modul dimuat.
if (typeof window.saveCicilan === 'function') window.saveCicilan = withBusy(window.saveCicilan);
