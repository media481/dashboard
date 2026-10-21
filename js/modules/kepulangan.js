// ============================================================
// MODUL LAZY: STATUS KEPULANGAN & TANDA TERIMA DOKUMEN  (js/modules/kepulangan.js)
// ============================================================
// Dipecah dari js/app.js dan dimuat HANYA saat dibutuhkan (ensureModuleLoaded('kepulangan') di app.js).
// Dimuat sebagai <script> biasa (BUKAN ES module): satu lingkup global dengan app.js, jadi nama
// fungsi global, onclick="..." dan data-action="..." tidak berubah.
// ATURAN: jangan mendeklarasikan ulang nama yang sudah ada di app.js (const/let ganda = SyntaxError).
// Fungsi yang dirujuk index.html / kode inti SEBELUM modul dimuat didaftarkan di LAZY_MODULES['kepulangan'].api (app.js).
// ============================================================

// ============================================================
// 19D2. STATUS KEPULANGAN
// Melacak progres jamaah dari belum berangkat sampai sudah pulang --
// terpisah dari status pembayaran (lunas/dp/pending). Status ini SELALU
// PER PROGRAM/ROMBONGAN (kolom programs.status_kepulangan, lihat
// sql/14_tambah_status_kepulangan_program.sql): satu status & satu tanggal
// yang berlaku untuk SELURUH jamaah di program itu, karena satu rombongan
// pasti berangkat & pulang bersama-sama di waktu yang sama -- tidak ada
// override per jamaah. Guest hanya bisa lihat, user & admin bisa ubah.
// Kolom kb_jamaah.status_kepulangan / tgl_berangkat_aktual /
// tgl_pulang_aktual (peninggalan skema lama, per-jamaah) sudah tidak
// dipakai lagi oleh UI; hanya kb_jamaah.catatan_kepulangan yang masih
// diisi per jamaah (sekadar catatan bebas, bukan status/tanggal).
// ============================================================
let kepulanganSelectedProgram = null;

// Tanggal jadwal keberangkatan program (kolom programs.tgl, format Indonesia
// spt "17 September 2026") dikonversi ke yyyy-mm-dd -- dipakai sebagai NILAI
// DEFAULT untuk input Tgl Berangkat Aktual di tab Status Kepulangan selama
// belum diisi manual, supaya admin tidak perlu isi ulang tanggal yang sudah
// ada di jadwal program. Sekadar default tampilan, belum tersimpan ke
// programs.tgl_berangkat_aktual sampai admin benar-benar menyimpan (submit
// field itu, walau isinya sama).
function tglJadwalProgramISO(programId) {
    const p = (dataUmroh || []).find(pr => String(pr.id) === String(programId));
    if (!p || !p.tgl) return '';
    const d = parseDateFromString(p.tgl);
    if (!d || isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// [STYLING] Dropdown status kepulangan diwarnai sesuai status terpilih
// (sama palet dgn .status-badge). Dipanggil onchange supaya warnanya ikut
// berubah live begitu admin ganti status, tanpa perlu render ulang tabel.
function kpRecolorStatusSelect(selectEl) {
    if (!selectEl) return;
    const info = kepulanganStatusInfo(selectEl.value);
    selectEl.className = selectEl.className.replace(/\bbadge-\S+/g, '').trim();
    selectEl.classList.add('badge-' + info.badge);
}

function renderKepulanganProgramSelector() {
    const select = document.getElementById('kepulanganProgramSelect');
    if (!select) return;

    if (!dataUmroh || dataUmroh.length === 0) {
        select.innerHTML = '<option value="">-- Belum ada program --</option>';
        return;
    }

    // Sama seperti selector Dokumen: hanya tampilkan program yang sudah
    // punya jamaah terdaftar.
    const programsWithJamaah = dataUmroh.filter(p =>
        (kbJamaahList || []).some(j => String(j.program_id) === String(p.id))
    );

    if (programsWithJamaah.length === 0) {
        select.innerHTML = '<option value="">-- Belum ada jamaah terdaftar --</option>';
        loadKepulanganForProgram('');
        return;
    }

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Pilih Program --</option>' +
        programsWithJamaah.map(p => `<option value="${p.id}">${escapeHtml(p.nama)} (${escapeHtml(p.tgl || '-')})</option>`).join('');
    select.value = (currentVal && programsWithJamaah.some(p => String(p.id) === String(currentVal))) ? currentVal : '';

    loadKepulanganForProgram(select.value);
}

function selectKepulanganProgram(id) {
    document.getElementById('kepulanganProgramSelect').value = id;
    loadKepulanganForProgram(id);
}

async function loadKepulanganForProgram(programId) {
    kepulanganSelectedProgram = programId || null;
    const container = document.getElementById('kepulanganContent');
    const summaryEl = document.getElementById('kepulanganSummary');
    summaryEl.innerHTML = '';

    if (!programId) {
        container.innerHTML = `<div class="kb-no-program"><i class="bi bi-house-door-fill"></i><p>Pilih program di atas untuk melihat & mengubah status kepulangan.</p></div>`;
        return;
    }

    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('kb_jamaah').select('*').eq('program_id', programId).eq('diarsipkan', false).order('nama', { ascending: true }),
            { label: 'Muat data jamaah' }
        );
        if (error) throw error;
        const jamaah = data || [];

        if (!jamaah.length) {
            container.innerHTML = `<div class="kb-no-program"><i class="bi bi-person-dash-fill"></i><p>Belum ada jamaah terdaftar untuk program ini.</p></div>`;
            return;
        }

        const programStatus = statusKepulanganProgram(programId);
        summaryEl.innerHTML = `
            <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
                <span class="status-badge neutral">${jamaah.length} Total Jamaah</span>
            </div>`;

        const canEdit = canManageProgramData();
        const infoProgram = kepulanganStatusInfo(programStatus);
        const tglBerangkatTersimpan = tglKepulanganProgram(programId, 'tgl_berangkat_aktual');
        // Kalau belum pernah diisi manual, default-kan ke tanggal jadwal
        // program (programs.tgl) supaya admin tidak perlu isi ulang tanggal
        // yang sudah ada di jadwal -- tetap bisa diubah kalau realisasinya beda.
        const pakaiDefaultJadwal = !tglBerangkatTersimpan;
        const programTglBerangkat = tglBerangkatTersimpan || tglJadwalProgramISO(programId);
        const programTglPulang = tglKepulanganProgram(programId, 'tgl_pulang_aktual');

        // Status & tanggal kepulangan berlaku untuk SELURUH jamaah program
        // ini sekaligus -- tidak ada override per jamaah, karena satu
        // rombongan pasti berangkat & pulang bersamaan. Dibuat 1 baris
        // (label dipendekkan, lebar field diperkecil) supaya hemat ruang.
        const programPanelHtml = `
            <div class="kp-program-panel" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:var(--bg);">
                <i class="bi bi-flag-fill" style="color:var(--ink-soft);flex-shrink:0;"></i>
                <span style="font-size:12.5px;color:var(--ink-soft);flex-shrink:0;">Status:</span>
                ${canEdit ? `
                <div class="kp-select-wrap" style="min-width:150px;">
                    <select id="kpProgramStatusSelect" class="kp-field kp-status-select badge-${infoProgram.badge}"
                        onchange="updateStatusKepulanganProgram(this.value); kpRecolorStatusSelect(this);">
                        ${KEPULANGAN_STATUS_OPSI.map(s => `<option value="${s.value}" ${s.value === programStatus ? 'selected' : ''}>${s.label}</option>`).join('')}
                    </select>
                    <i class="bi bi-chevron-down"></i>
                </div>` : `<span class="status-badge ${infoProgram.badge}">${infoProgram.label}</span>`}

                <span style="font-size:12.5px;color:var(--ink-soft);flex-shrink:0;">Berangkat:</span>
                <input type="date" class="kp-field" value="${programTglBerangkat}" ${canEdit ? '' : 'disabled'}
                    ${pakaiDefaultJadwal && programTglBerangkat ? 'title="Ikut jadwal program -- belum dikonfirmasi manual"' : ''}
                    onchange="updateTanggalKepulanganProgram('tgl_berangkat_aktual', this.value)" style="min-width:128px;flex:1 1 128px;${pakaiDefaultJadwal ? 'border-style:dashed;' : ''}">

                <span style="font-size:12.5px;color:var(--ink-soft);flex-shrink:0;">Pulang:</span>
                <input type="date" class="kp-field" value="${programTglPulang}" ${canEdit ? '' : 'disabled'}
                    onchange="updateTanggalKepulanganProgram('tgl_pulang_aktual', this.value)" style="min-width:128px;flex:1 1 128px;">

            </div>`;

        container.innerHTML = `
            ${programPanelHtml}
            <div class="table-container" style="overflow-x:auto;">
                <table style="width:100%;min-width:600px;border-collapse:collapse;font-size:13px;">
                    <thead style="background:var(--bg);">
                        <tr>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);">Nama</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);border-left:1px solid var(--line);">Catatan</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${jamaah.map(j => `
                            <tr style="border-bottom:1px solid var(--line);">
                                <td style="padding:10px 14px;"><strong>${escapeHtml(j.nama)}</strong>${j.asal ? `<br><span style="font-size:11px;color:var(--ink-soft);">${escapeHtml(j.asal)}</span>` : ''}</td>
                                <td style="padding:8px 14px;border-left:1px solid var(--line);">
                                    <input type="text" class="kp-field" value="${escapeHtml(j.catatan_kepulangan || '')}" placeholder="Opsional" ${canEdit ? '' : 'disabled'}
                                        onchange="updateKepulanganField('${j.id}','catatan_kepulangan',this.value)" style="width:100%;min-width:160px;">
                                </td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>
            <p style="font-size:11px;color:var(--ink-soft);margin-top:10px;">Status & tanggal di atas berlaku untuk seluruh jamaah di program ini -- tersimpan otomatis begitu berpindah field, tidak perlu tombol Simpan terpisah. Kolom Catatan cuma catatan bebas per jamaah (mis. titip alamat jemput), bukan status kepulangan.</p>
            ${(canEdit && jamaah.length) ? `
            <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;">
                <button type="button" class="btn-arsip-semua" onclick="arsipkanSemuaJamaah('${programId}')" title="Arsipkan semua jamaah di program ini">
                    <i class="bi bi-archive-fill"></i> Arsipkan Semua Jamaah Program Ini
                </button>
            </div>` : ''}
        `;

    } catch (err) {
        console.error('Load status kepulangan error:', err);
        container.innerHTML = `<div class="kb-no-program" style="color:var(--danger);">
            <i class="bi bi-exclamation-circle-fill"></i>
            <p>Gagal memuat data status kepulangan — periksa koneksi internet.</p>
        </div>`;
    }
}

// Ubah status kepulangan PROGRAM (rombongan) -- ini yang jadi default untuk
// semua jamaah di program ini yang belum di-override satu-satu. Cukup ubah
// 1 baris di tabel programs, tidak perlu menulis ulang tiap baris kb_jamaah.
async function updateStatusKepulanganProgram(status) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengubah data ini', 'error'); return; }
    if (!kepulanganSelectedProgram) { showToast('Pilih program terlebih dahulu', 'error'); return; }

    try {
        const { error } = await supabaseClient
            .from('programs')
            .update({ status_kepulangan: status })
            .eq('id', kepulanganSelectedProgram);
        if (error) throw error;

        const p = (dataUmroh || []).find(pr => String(pr.id) === String(kepulanganSelectedProgram));
        if (p) p.status_kepulangan = status;
        renderNavBadges();

        showToast('Status kepulangan program diperbarui', 'success');
        await loadKepulanganForProgram(kepulanganSelectedProgram);

    } catch (err) {
        console.error('Update status kepulangan program error:', err);
        showToast('Gagal menyimpan: ' + err.message, 'error');
        await loadKepulanganForProgram(kepulanganSelectedProgram);
    }
}

// Ubah tanggal berangkat/pulang aktual PROGRAM (rombongan) -- default untuk
// semua jamaah di program ini yang belum di-override satu-satu tanggalnya.
// field: 'tgl_berangkat_aktual' | 'tgl_pulang_aktual'.
async function updateTanggalKepulanganProgram(field, value) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengubah data ini', 'error'); return; }
    if (!kepulanganSelectedProgram) { showToast('Pilih program terlebih dahulu', 'error'); return; }

    try {
        const payload = { [field]: value || null };
        const { error } = await supabaseClient
            .from('programs')
            .update(payload)
            .eq('id', kepulanganSelectedProgram);
        if (error) throw error;

        const p = (dataUmroh || []).find(pr => String(pr.id) === String(kepulanganSelectedProgram));
        if (p) p[field] = payload[field];

        showToast('Tanggal program diperbarui', 'success');
        await loadKepulanganForProgram(kepulanganSelectedProgram);

    } catch (err) {
        console.error('Update tanggal kepulangan program error:', err);
        showToast('Gagal menyimpan: ' + err.message, 'error');
        await loadKepulanganForProgram(kepulanganSelectedProgram);
    }
}

// Ubah catatan bebas seorang jamaah (bukan status/tanggal -- itu sekarang
// murni per program, lihat updateStatusKepulanganProgram /
// updateTanggalKepulanganProgram).
async function updateKepulanganField(jamaahId, field, value) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengubah data ini', 'error'); return; }
    if (field !== 'catatan_kepulangan') return; // jaga-jaga, satu-satunya field per-jamaah yang tersisa
    const payload = { [field]: value === '' ? null : value };
    try {
        const { error } = await supabaseClient.from('kb_jamaah').update(payload).eq('id', jamaahId);
        if (error) throw error;

        const idx = kbJamaahList.findIndex(j => j.id === jamaahId);
        if (idx > -1) kbJamaahList[idx][field] = payload[field];
        renderNavBadges();

        showToast('Status kepulangan diperbarui', 'success');
        if (kepulanganSelectedProgram) await loadKepulanganForProgram(kepulanganSelectedProgram);

    } catch (err) {
        console.error('Update status kepulangan error:', err);
        showToast('Gagal menyimpan: ' + err.message, 'error');
        if (kepulanganSelectedProgram) await loadKepulanganForProgram(kepulanganSelectedProgram);
    }
}

// ---- NOTA "TANDA TERIMA DOKUMEN" per jamaah ----
// Dokumen bukti resmi penyerahan berkas persyaratan (KTP, KK, Paspor, dst)
// dari jamaah ke kantor, dengan kop & identitas visual yang SAMA persis
// dengan Nota Pembayaran (pakai ulang NOTA_TEMA, buildNotaHeaderHTML,
// buildNotaTitleBarHTML, buildNotaWatermarkHTML, buildNotaSignatureHTML —
// lihat bagian "19C/19D. NOTA PEMBAYARAN"). Bedanya dari Nota Pembayaran:
// bukan dokumen finansial, jadi TIDAK dicatat ke nota_audit_log & tidak
// pakai Kode Verifikasi (sistem itu khusus dokumen pembayaran/kuitansi).
let dokTandaTerimaPending = null; // { jamaah, program, html }

// Nomor dokumen dibuat deterministik dari id jamaah (bukan sequence
// database) — sengaja SELALU sama tiap kali dicetak ulang untuk jamaah yang
// sama, supaya tidak perlu migrasi SQL baru hanya untuk dokumen non-finansial ini.
function nomorTandaTerimaDokumen(jamaah) {
    const idPart = String(jamaah?.id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
    return `TTD/${new Date().getFullYear()}/${idPart || '00000000'}`;
}

function buildDokumenTandaTerimaHTML(jamaah, program) {
    const dok = jamaah.dokumen || {};
    const dokJenis = dokumenJenisUntukJamaah(jamaah);
    const totalDok = dokJenis.length;
    const totalLengkap = dokJenis.filter(d => d.type === 'copy'
        ? !!(dok[d.key + '_fc'] || dok[d.key + '_asli'])
        : !!dok[d.key]).length;
    const overallLengkap = totalLengkap === totalDok;

    const STATUS_WARNA = { ok: '#279E70', partial: NOTA_TEMA.gold, none: NOTA_TEMA.stampRed };

    // Baris status per jenis dokumen: hijau (lengkap), gold (sebagian —
    // khusus dokumen bertipe 'copy' yang baru diserahkan salah satu dari
    // Fotocopy/Asli), atau merah (belum diserahkan sama sekali).
    const rows = dokJenis.map((d, i) => {
        let label, warna;
        if (d.type === 'copy') {
            const fc = !!dok[d.key + '_fc'];
            const asli = !!dok[d.key + '_asli'];
            if (fc && asli) { label = '✓ Fotocopy &amp; Asli'; warna = STATUS_WARNA.ok; }
            else if (fc) { label = '✓ Fotocopy saja'; warna = STATUS_WARNA.partial; }
            else if (asli) { label = '✓ Asli saja'; warna = STATUS_WARNA.partial; }
            else { label = 'Belum diserahkan'; warna = STATUS_WARNA.none; }
        } else {
            const sudah = !!dok[d.key];
            label = sudah ? '✓ Sudah diserahkan' : 'Belum diserahkan';
            warna = sudah ? STATUS_WARNA.ok : STATUS_WARNA.none;
        }
        return `
        <tr style="background:${i % 2 === 0 ? '#fff' : NOTA_TEMA.tint};">
            <td style="padding:7px 8px;border-bottom:1px solid ${NOTA_TEMA.line};text-align:center;color:${NOTA_TEMA.inkSoft};font-size:10px;">${i + 1}</td>
            <td style="padding:7px 8px;border-bottom:1px solid ${NOTA_TEMA.line};font-size:10.5px;font-weight:600;">${escapeHtml(d.label)}</td>
            <td style="padding:7px 8px;border-bottom:1px solid ${NOTA_TEMA.line};font-size:10px;font-weight:700;color:${warna};">${label}</td>
        </tr>`;
    }).join('');

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

    // Sama seperti Nota Riwayat: lebar dikunci 794px (identik Nota
    // Pembayaran), tinggi dibiarkan menyesuaikan jumlah baris jenis dokumen.
    return `
    <div style="position:relative;width:794px;background:#fff;font-family:'Inter',Arial,sans-serif;color:#1a1a1a;padding:22px 28px;box-sizing:border-box;border:1px solid ${NOTA_TEMA.line};overflow:hidden;">
        ${buildNotaWatermarkHTML()}

        <div style="position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border-bottom:1.5px solid ${NOTA_TEMA.navy};padding-bottom:9px;margin-bottom:12px;">
            ${buildNotaHeaderHTML()}
            ${buildNotaTitleBarHTML('TANDA TERIMA DOKUMEN', [
                `No. ${escapeHtml(nomorTandaTerimaDokumen(jamaah))}`,
                `${escapeHtml(tanggalIndonesia(new Date().toISOString().slice(0, 10)))}`
            ])}
        </div>

        <div style="position:relative;z-index:1;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
                ${baris('Nama Jamaah', escapeHtml(jamaah.nama || '-'), { bold: true })}
                ${baris('Program Umroh', `${escapeHtml(program?.nama || '-')}${program?.tgl ? ' (' + escapeHtml(program.tgl) + ')' : ''}`)}
            </table>

            <table style="width:100%;border-collapse:collapse;margin-bottom:12px;border:1px solid ${NOTA_TEMA.line};">
                <thead>
                    <tr style="background:${NOTA_TEMA.navy};">
                        <th style="padding:8px 6px;text-align:center;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;font-weight:700;">No</th>
                        <th style="padding:8px 6px;text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;font-weight:700;">Jenis Dokumen</th>
                        <th style="padding:8px 6px;text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;font-weight:700;">Status</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>

            <div style="display:flex;justify-content:space-between;gap:14px;padding:8px 0;border-top:1px solid ${NOTA_TEMA.line};border-bottom:1px solid ${NOTA_TEMA.line};margin-bottom:12px;">
                ${rekapItem('Jenis Dokumen', `${totalDok} jenis`)}
                ${rekapItem('Dokumen Diterima', `${totalLengkap} dari ${totalDok}`)}
                ${rekapItem('Status Keseluruhan', overallLengkap ? 'LENGKAP' : 'BELUM LENGKAP', { color: overallLengkap ? STATUS_WARNA.ok : STATUS_WARNA.partial })}
            </div>

            ${buildNotaSignatureHTML(jamaah.nama || 'Jamaah / Penyerah', getPetugasDisplayName())}
        </div>

        <div style="position:relative;z-index:1;text-align:left;font-size:8px;color:${NOTA_TEMA.inkSoft};margin-top:8px;padding-top:6px;border-top:1px solid ${NOTA_TEMA.line};">
            <div style="color:#a0a8b3;">
                Dokumen ini dicetak otomatis oleh sistem sebagai bukti resmi penyerahan dokumen persyaratan program umroh dari jamaah kepada ${escapeHtml(NOTA_PERUSAHAAN.brand)}. Berkas fisik yang diserahkan tetap disimpan oleh ${escapeHtml(NOTA_PERUSAHAAN.brand)} untuk keperluan keberangkatan.
            </div>
        </div>
    </div>`;
}

async function bukaTandaTerimaDokumen(jamaahId, btn) {
    const originalIcon = btn ? btn.innerHTML : null;
    if (btn) { btn.innerHTML = '<i class="bi bi-arrow-repeat bi-spin"></i>'; btn.disabled = true; }
    try {
        const { data: jamaah, error } = await supabaseClient.from('kb_jamaah').select('*').eq('id', jamaahId).maybeSingle();
        if (error || !jamaah) throw error || new Error('Data jamaah tidak ditemukan (mungkin sudah dihapus/diarsipkan)');
        const program = dataUmroh.find(p => String(p.id) === String(jamaah.program_id)) || null;

        const html = buildDokumenTandaTerimaHTML(jamaah, program);
        dokTandaTerimaPending = { jamaah, program, html };

        const modal = document.getElementById('dokTandaTerimaModal');
        renderScaledNotaInto(document.getElementById('dokTandaTerimaPreviewContent'), html);
        modal.classList.add('open');
    } catch (err) {
        console.error('Buka Tanda Terima Dokumen error:', err);
        showToast('Gagal memuat data jamaah: ' + (err?.message || err), 'error');
    } finally {
        if (btn) { btn.innerHTML = originalIcon; btn.disabled = false; }
    }
}

function tutupTandaTerimaModal() {
    const modal = document.getElementById('dokTandaTerimaModal');
    if (modal) modal.classList.remove('open');
    const content = document.getElementById('dokTandaTerimaPreviewContent');
    if (content) content.innerHTML = '';
    dokTandaTerimaPending = null;
    closeNotaLightbox();
}

async function unduhTandaTerimaDokumen(format, btn) {
    if (!dokTandaTerimaPending) return;
    const { jamaah, html } = dokTandaTerimaPending;
    const namaJamaah = (jamaah?.nama || 'Jamaah').replace(/[^a-zA-Z0-9]+/g, '-');
    const exportFn = format === 'pdf' ? exportNotaElementAsPdf : exportNotaElementAsJpeg;
    const ext = format === 'pdf' ? 'pdf' : 'jpg';
    await exportFn(html, `Tanda-Terima-Dokumen-${namaJamaah}.${ext}`, btn);
}

window.addEventListener('resize', () => {
    const dokModal = document.getElementById('dokTandaTerimaModal');
    if (dokModal && dokModal.classList.contains('open')) fitScaleInto(document.getElementById('dokTandaTerimaPreviewContent'));
});
