// ============================================================
// MODUL LAZY: PANEL AUDIT NOTA (admin)  (js/modules/audit-nota.js)
// ============================================================
// Dipecah dari js/app.js dan dimuat HANYA saat dibutuhkan (ensureModuleLoaded('audit-nota') di app.js).
// Dimuat sebagai <script> biasa (BUKAN ES module): satu lingkup global dengan app.js, jadi nama
// fungsi global, onclick="..." dan data-action="..." tidak berubah.
// ATURAN: jangan mendeklarasikan ulang nama yang sudah ada di app.js (const/let ganda = SyntaxError).
// Fungsi yang dirujuk index.html / kode inti SEBELUM modul dimuat didaftarkan di LAZY_MODULES['audit-nota'].api (app.js).
// SENGAJA tetap di app.js: logNotaAudit(), sha256Hex(), getPetugasNama() (pencatatan log saat nota diunduh,
// tidak boleh bergantung pada unduhan modul), pembangun nota (buildNotaHTML, ...) dan lightbox nota.
// ============================================================

// ---- Panel Admin "Audit Nota": daftar log yang bisa dicari/difilter, dengan
// pagination "Muat Lebih Banyak" (range-based, hemat data dibanding load semua). ----
const AUDIT_NOTA_PAGE_SIZE = 25;
let auditNotaOffset = 0;
let auditNotaSearchDebounce = null;

function handleAuditNotaSearchInput() {
    clearTimeout(auditNotaSearchDebounce);
    auditNotaSearchDebounce = setTimeout(() => loadNotaAuditLog(true), 350);
}

// Tampilan jenis nota (label, ikon, kelas warna) dan label hari untuk pemisah di daftar.
const AUDIT_NOTA_JENIS = {
    pembayaran: { label: 'Pembayaran', icon: 'bi-cash-coin', cls: 'an-j-pay' },
    riwayat:    { label: 'Riwayat',    icon: 'bi-clock-history', cls: 'an-j-hist' },
    kuitansi:   { label: 'Kuitansi',   icon: 'bi-receipt', cls: 'an-j-kwt' }
};
let auditNotaLastDay = '';

function anDayLabel(d) {
    const dayKey = d.toDateString();
    const now = new Date();
    const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const full = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (dayKey === now.toDateString()) return 'Hari ini · ' + full;
    if (dayKey === yest.toDateString()) return 'Kemarin · ' + full;
    return full;
}

function anSetJenis(val) {
    const input = document.getElementById('auditNotaFilterJenis');
    if (input) input.value = val;
    document.querySelectorAll('#anJenisChips .us-chip').forEach(c => c.classList.toggle('active', c.dataset.jenis === val));
    loadNotaAuditLog(true);
}
window.anSetJenis = anSetJenis;

function copyAuditKode(kode) {
    if (!kode) return;
    const done = () => showToast('Kode verifikasi disalin');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(kode).then(done).catch(() => showToast('Gagal menyalin kode', 'error'));
    } else {
        showToast('Browser tidak mendukung salin otomatis', 'error');
    }
}
window.copyAuditKode = copyAuditKode;

// Ringkasan jumlah log per jenis (query count saja, tidak menarik baris).
async function loadNotaAuditStats() {
    if (currentRole !== 'admin' && currentRole !== 'user') return;
    const count = async (jenis) => {
        let q = supabaseClient.from('nota_audit_log').select('id', { count: 'exact', head: true });
        if (jenis) q = q.eq('jenis', jenis);
        const { count: c, error } = await q;
        return error ? '-' : c;
    };
    const [total, pay, hist, kwt] = await Promise.all([count(''), count('pembayaran'), count('riwayat'), count('kuitansi')]);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v != null ? Number(v).toLocaleString('id-ID') : '-'; };
    set('anStatTotal', total); set('anStatPay', pay); set('anStatHist', hist); set('anStatKwt', kwt);
}

async function loadNotaAuditLog(reset) {
    // Sebelumnya hardcode admin-only, padahal menu "Audit Nota" sendiri sudah
    // bisa diizinkan untuk role "user" lewat Userman > Akses Menu per Role.
    // Disamakan ke pola akses "boleh kelola data" (admin/user) yang dipakai
    // di tempat lain -- guest tetap tidak dapat lihat log audit finansial ini.
    if (currentRole !== 'admin' && currentRole !== 'user') return;
    const tbody = document.getElementById('auditNotaTableBody');
    const loadMoreBtn = document.getElementById('auditNotaLoadMoreBtn');
    const countEl = document.getElementById('auditNotaCount');
    if (!tbody) return;

    if (reset) {
        auditNotaOffset = 0;
        auditNotaLastDay = '';
        tbody.innerHTML = '<tr><td colspan="7" class="us-state">Memuat...</td></tr>';
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
        const rowsHtml = rows.map(r => {
            const d = new Date(r.created_at);
            const dayKey = d.toDateString();
            let sep = '';
            if (dayKey !== auditNotaLastDay) {
                auditNotaLastDay = dayKey;
                sep = `<tr class="an-day"><td colspan="7">${escapeHtml(anDayLabel(d))}</td></tr>`;
            }
            const jm = AUDIT_NOTA_JENIS[r.jenis] || { label: r.jenis || '-', icon: 'bi-file-earmark-text', cls: '' };
            const role = r.dicetak_oleh_role || '';
            const roleCls = US_ROLE_META[role] ? ` us-role-${role}` : '';
            const kode = r.kode_verifikasi || '';
            return sep + `
            <tr>
                <td data-label="Waktu" class="an-time"><b>${escapeHtml(d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }))}</b><span>${escapeHtml(d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }))}</span></td>
                <td data-label="Nota"><div class="an-nota"><code>${escapeHtml(r.nomor_nota || '-')}</code><span class="an-jenis ${jm.cls}"><i class="bi ${jm.icon}"></i> ${escapeHtml(jm.label)}</span></div></td>
                <td data-label="Jamaah"><div class="us-user-txt"><b>${escapeHtml(r.jamaah_nama || '-')}</b>${r.program_nama ? `<span>${escapeHtml(r.program_nama)}</span>` : ''}</div></td>
                <td data-label="Jumlah" class="an-amount">${r.jumlah != null ? escapeHtml(formatRupiah(Number(r.jumlah))) : '<span class="an-none">-</span>'}</td>
                <td data-label="Dicetak oleh"><div class="us-user-txt"><b>${escapeHtml(r.dicetak_oleh_label || r.dicetak_oleh_nama || '-')}</b><span><span class="us-badge us-badge-sm${roleCls}">${escapeHtml(role || '-')}</span></span></div></td>
                <td data-label="Kode"><button type="button" class="an-code" title="Salin kode verifikasi" onclick="copyAuditKode('${escapeJsAttr(kode)}')"${kode ? '' : ' disabled'}>${escapeHtml(kode || '-')}<i class="bi bi-clipboard"></i></button></td>
                <td class="us-actions">
                    <button type="button" class="btn-icon-ghost" onclick="previewNotaFromAudit('${r.id}', this)" title="Preview nota sesuai kode verifikasi ini"><i class="bi bi-eye-fill"></i></button>
                </td>
            </tr>`;
        }).join('');

        if (reset) {
            const emptyMsg = (search || jenis) ? 'Tidak ada nota yang cocok dengan pencarian.' : 'Belum ada nota yang tercatat.';
            tbody.innerHTML = rowsHtml || `<tr><td colspan="7" class="us-state">${emptyMsg}</td></tr>`;
        } else {
            tbody.insertAdjacentHTML('beforeend', rowsHtml);
        }

        auditNotaOffset += rows.length;
        const total = count != null ? count : auditNotaOffset;
        if (countEl) countEl.textContent = (count != null && auditNotaOffset < count) ? `${auditNotaOffset} dari ${total} nota` : `${total} nota`;
        if (loadMoreBtn) loadMoreBtn.style.display = (count != null && auditNotaOffset < count) ? '' : 'none';
    } catch (err) {
        console.error('loadNotaAuditLog error:', err);
        if (reset) tbody.innerHTML = `<tr><td colspan="7" class="us-state us-state-err">Gagal memuat log audit: ${escapeHtml(err.message)}. Pastikan migrasi sql/19_tambah_nota_audit.sql sudah dijalankan di Supabase.</td></tr>`;
        showToast('Gagal memuat log audit nota', 'error');
    }
}

// ---- Preview nota langsung dari 1 baris log Audit Nota, direkonstruksi
// ulang dari kode_verifikasi & data terkait yang tersimpan di baris log itu
// (jamaah_id, metadata) — bukan menyimpan salinan HTML nota di DB, supaya
// ledger-nya tetap ringan. Untuk jenis pembayaran/riwayat, data jamaah &
// riwayat pembayaran diambil live dari DB (bisa saja beda dari kondisi saat
// nota itu pertama diterbitkan kalau datanya sudah diedit belakangan — ini
// murni alat bantu pengecekan/referensi, bukan reproduksi arsip 1:1).
// Untuk jenis kuitansi, semua data yang dibutuhkan sudah lengkap tersimpan
// di kolom metadata baris log itu sendiri, jadi tidak perlu query tambahan.
async function previewNotaFromAudit(logId, btn) {
    if (btn) btn.disabled = true;
    try {
        const { data: row, error } = await supabaseClient.from('nota_audit_log').select('*').eq('id', logId).single();
        if (error || !row) { showToast('Log audit tidak ditemukan', 'error'); return; }

        const meta = row.metadata || {};

        // Baris lama (jenis 'kuitansi' dari modal Kuitansi manual yang sudah
        // dihapus, sebelum digabung ke alur "Bayar") tidak punya cicilanId di
        // metadata-nya — data lengkapnya tersimpan langsung di metadata baris
        // log itu sendiri, jadi direkonstruksi lewat buildKuitansiHTML (legacy).
        if (row.jenis === 'kuitansi' && !meta.cicilanId) {
            const data = {
                nomor: row.nomor_nota,
                tempatTanggal: meta.tempatTanggal || '',
                dari: row.jamaah_nama || '',
                jumlah: row.jumlah != null ? String(row.jumlah) : '',
                metode: meta.metode || '',
                penerima: meta.penerima || '',
                keterangan: meta.keterangan || ''
            };
            showAuditNotaPreviewInLightbox(buildKuitansiHTML(data, row.kode_verifikasi));
            return;
        }

        if (!row.jamaah_id) { showToast('Data jamaah untuk nota ini tidak lengkap, tidak bisa dipreview', 'error'); return; }

        const { data: jamaahRow, error: jErr } = await supabaseClient.from('kb_jamaah').select('*').eq('id', row.jamaah_id).maybeSingle();
        if (jErr || !jamaahRow) { showToast('Data jamaah untuk nota ini sudah tidak ada (mungkin sudah dihapus/diarsipkan)', 'error'); return; }

        const { data: bayarRows, error: bErr } = await supabaseClient.from('pembayaran_jamaah').select('*').eq('jamaah_id', row.jamaah_id).order('tanggal', { ascending: false });
        if (bErr) throw bErr;

        // Pakai variabel global yang sama dengan yang dibaca buildNotaHTML() /
        // buildNotaRiwayatHTML() supaya hasilnya identik dengan preview biasa
        // di modal Kelola Cicilan.
        cicilanJamaahInfo = jamaahRow;
        cicilanProgramInfo = dataUmroh.find(p => String(p.id) === String(jamaahRow.program_id)) || null;
        cicilanHargaProgram = getHargaKamarJamaah(cicilanProgramInfo, jamaahRow);
        cicilanList = bayarRows || [];

        if (row.jenis === 'riwayat') {
            showAuditNotaPreviewInLightbox(buildNotaRiwayatHTML(row.kode_verifikasi));
            return;
        }

        // jenis 'pembayaran', atau 'kuitansi' baru (otomatis dari alur Bayar,
        // ditandai adanya cicilanId di metadata): cari baris cicilan aslinya
        // kalau masih ada (belum dihapus) supaya keterangan ikut tampil, lalu
        // render lewat buildNotaHTML() yang sama — judulnya (NOTA PEMBAYARAN
        // vs KUITANSI) otomatis mengikuti status lunas jamaah SAAT INI. Kalau
        // baris cicilannya sudah dihapus, rekonstruksi seadanya dari log.
        const cicilan = cicilanList.find(c => String(c.id) === String(meta.cicilanId)) || {
            id: meta.cicilanId || 'log', jumlah: row.jumlah, metode: meta.metode,
            tanggal: meta.tanggal, nomor_nota: row.nomor_nota
        };
        showAuditNotaPreviewInLightbox(buildNotaHTML(cicilan, row.kode_verifikasi));
    } catch (err) {
        console.error('previewNotaFromAudit error:', err);
        showToast('Gagal memuat preview nota', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// Tampilkan HTML nota langsung di lightbox layar penuh yang sama dipakai
// tombol "Perbesar" pada preview biasa (lihat openNotaLightbox()) — dipakai
// terpisah di sini karena preview dari Audit Nota tidak melalui panel kecil
// #notaPreviewContent lebih dulu (baris log bisa dibuka dari mana saja di
// tabel, tidak terikat ke modal Kelola Cicilan/Kuitansi yang sedang terbuka).
function showAuditNotaPreviewInLightbox(html) {
    const stage = document.getElementById('notaLightboxStage');
    const overlay = document.getElementById('notaLightboxOverlay');
    if (!stage || !overlay) return;
    stage.innerHTML = `<div>${html}</div>`;
    overlay.classList.add('open');
    document.addEventListener('keydown', handleNotaLightboxKeydown);
    requestAnimationFrame(fitNotaLightboxScale);
}
