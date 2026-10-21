// ============================================================
// MODUL LAZY: KELENGKAPAN DOKUMEN & TO-DO CS  (js/modules/dokumen.js)
// ============================================================
// Dipecah dari js/app.js dan dimuat HANYA saat dibutuhkan (ensureModuleLoaded('dokumen') di app.js).
// Dimuat sebagai <script> biasa (BUKAN ES module): satu lingkup global dengan app.js, jadi nama
// fungsi global, onclick="..." dan data-action="..." tidak berubah.
// ATURAN: jangan mendeklarasikan ulang nama yang sudah ada di app.js (const/let ganda = SyntaxError).
// Fungsi yang dirujuk index.html / kode inti SEBELUM modul dimuat didaftarkan di LAZY_MODULES['dokumen'].api (app.js).
// ============================================================

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
        container.innerHTML = `<div class="kb-no-program"><i class="bi bi-file-earmark-check-fill"></i><p>Pilih program di atas untuk mengecek kelengkapan dokumen jamaah.</p></div>`;
        return;
    }

    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('kb_jamaah').select('*').eq('program_id', programId).eq('diarsipkan', false).order('nama', { ascending: true }),
            { label: 'Muat data jamaah' }
        );
        if (error) throw error;
        const jamaah = data || [];
        dokCacheJamaahAll = jamaah;

        if (!jamaah.length) {
            container.innerHTML = `<div class="kb-no-program"><i class="bi bi-person-dash-fill"></i><p>Belum ada jamaah terdaftar untuk program ini.</p></div>`;
            return;
        }

        const totalLengkap = jamaah.filter(j => isDokumenLengkap(j.dokumen, j)).length;
        const belumLengkap = jamaah.length - totalLengkap;

        summaryEl.innerHTML = `
            <div class="kp-program-panel" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:var(--bg);">
                <i class="bi bi-file-earmark-check-fill" style="color:var(--ink-soft);flex-shrink:0;"></i>
                <span style="font-size:12.5px;color:var(--ink-soft);flex-shrink:0;">Ringkasan:</span>
                <span class="status-badge neutral">${jamaah.length} Total Jamaah</span>
                <span class="status-badge available">${totalLengkap} Dokumen Lengkap</span>
                ${belumLengkap > 0 ? `<span class="status-badge full">${belumLengkap} Belum Lengkap</span>` : ''}
            </div>`;

        const canEdit = canManageProgramData();

        container.innerHTML = `
            <div class="table-container" style="overflow-x:auto;">
                <table style="width:100%;min-width:${1010 + DOKUMEN_JENIS.filter(d => d.type === 'copy').length * 88}px;border-collapse:collapse;font-size:13px;table-layout:fixed;">
                    <colgroup>
                        <col style="width:190px;">
                        ${DOKUMEN_JENIS.map(d => d.type === 'copy' ? '<col style="width:44px;"><col style="width:44px;">' : '<col style="width:110px;">').join('')}
                        <col style="width:140px;">
                        <col style="width:190px;">
                    </colgroup>
                    <thead style="background:var(--bg);">
                        <tr>
                            <th rowspan="2" style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);vertical-align:bottom;">Nama</th>
                            ${DOKUMEN_JENIS.map(d => d.type === 'copy'
                                ? `<th colspan="2" style="padding:8px 4px 4px;text-align:center;font-size:10.5px;line-height:1.25;text-transform:uppercase;color:var(--ink-soft);border-left:1px solid var(--line);word-break:break-word;">${escapeHtml(d.label)}</th>`
                                : `<th rowspan="2" style="padding:10px 6px;text-align:center;font-size:10.5px;line-height:1.25;text-transform:uppercase;color:var(--ink-soft);vertical-align:bottom;border-left:1px solid var(--line);word-break:break-word;">${escapeHtml(d.label)}</th>`
                            ).join('')}
                            <th rowspan="2" style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);vertical-align:bottom;border-left:1px solid var(--line);">Status</th>
                            <th rowspan="2" style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--ink-soft);vertical-align:bottom;border-left:1px solid var(--line);">Aksi</th>
                        </tr>
                        <tr>
                            ${DOKUMEN_JENIS.filter(d => d.type === 'copy').map(() => `
                                <th style="padding:2px 2px 8px;text-align:center;font-size:10px;font-weight:500;color:var(--ink-soft);">FC</th>
                                <th style="padding:2px 2px 8px;text-align:center;font-size:10px;font-weight:500;color:var(--ink-soft);">Asli</th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${jamaah.map(j => {
                            const dok = j.dokumen || {};
                            const lengkap = isDokumenLengkap(dok, j);
                            return `
                            <tr style="border-bottom:1px solid var(--line);">
                                <td style="padding:10px 14px;overflow:hidden;text-overflow:ellipsis;"><strong>${escapeHtml(j.nama)}</strong>${j.asal ? `<br><span style="font-size:11px;color:var(--ink-soft);">${escapeHtml(j.asal)}</span>` : ''}</td>
                                ${DOKUMEN_JENIS.map(d => {
                                    return d.type === 'copy' ? `
                                    <td style="padding:10px 2px;text-align:center;border-left:1px solid var(--line);">
                                        <input type="checkbox" ${dok[d.key + '_fc'] ? 'checked' : ''} ${canEdit ? '' : 'disabled'}
                                            onchange="toggleDokumenJamaah('${j.id}','${d.key}_fc',this.checked)"
                                            style="width:16px;height:16px;cursor:${canEdit ? 'pointer' : 'default'};">
                                    </td>
                                    <td style="padding:10px 2px;text-align:center;">
                                        <input type="checkbox" ${dok[d.key + '_asli'] ? 'checked' : ''} ${canEdit ? '' : 'disabled'}
                                            onchange="toggleDokumenJamaah('${j.id}','${d.key}_asli',this.checked)"
                                            style="width:16px;height:16px;cursor:${canEdit ? 'pointer' : 'default'};">
                                    </td>` : `
                                    <td style="padding:10px 6px;text-align:center;border-left:1px solid var(--line);">
                                        <input type="checkbox" ${dok[d.key] ? 'checked' : ''} ${canEdit ? '' : 'disabled'}
                                            onchange="toggleDokumenJamaah('${j.id}','${d.key}',this.checked)"
                                            style="width:16px;height:16px;cursor:${canEdit ? 'pointer' : 'default'};">
                                    </td>`;
                                }).join('')}
                                <td style="padding:10px 14px;border-left:1px solid var(--line);">
                                    <span class="status-badge ${lengkap ? 'available' : 'full'}">${lengkap ? '<i class="bi bi-check-circle-fill"></i> Lengkap' : '<i class="bi bi-hourglass-split"></i> Belum Lengkap'}</span>
                                </td>
                                <td style="padding:10px 14px;border-left:1px solid var(--line);">
                                    <div class="pb-actions" style="justify-content:flex-start;">
                                        ${!lengkap && j.wa ? `
                                        <button class="btn-wa-reminder" style="font-size:11px;padding:5px 10px;" id="dokWaBtn_${j.id}" onclick="generateDocumentReminderWA('${j.id}')" title="Kirim reminder WA dokumen kurang">
                                            <i class="bi bi-whatsapp"></i> Reminder WA
                                        </button>` : ''}
                                        <div class="action-btns">
                                            <button onclick="bukaTandaTerimaDokumen('${j.id}', this)" title="Cetak Tanda Terima Dokumen"><i class="bi bi-printer-fill"></i></button>
                                        </div>
                                    </div>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            <p style="font-size:11px;color:var(--ink-soft);margin-top:10px;">Centang Fotocopy dan/atau Asli sesuai yang diserahkan jamaah. Klik <i class="bi bi-printer-fill"></i> untuk mencetak Tanda Terima Dokumen jamaah tersebut.</p>
        `;

    } catch (err) {
        console.error('Load dokumen jamaah error:', err);
        container.innerHTML = `<div class="kb-no-program" style="color:var(--danger);">
            <i class="bi bi-exclamation-circle-fill"></i>
            <p>Gagal memuat data dokumen — periksa koneksi internet.</p>
        </div>`;
    }
}

// Kirim reminder WA ke jamaah soal dokumen yang masih kurang. Beda dari
// generatePaymentReminderWA (bagian 19): ini disusun langsung di klien
// (bukan lewat Edge Function/AI) karena isinya cuma daftar dokumen yang
// belum lengkap, tidak butuh nada persuasif. Admin tetap yang menekan
// kirim di WhatsApp (buka wa.me dengan teks sudah terisi).
// Dipanggil dari tombol "Reminder WA" di tabel Kelengkapan Dokumen.
function generateDocumentReminderWA(jamaahId) {
    if (!dokCacheJamaahAll) { showToast('Data dokumen belum siap, coba lagi', 'error'); return; }
    const j = dokCacheJamaahAll.find(x => String(x.id) === String(jamaahId));
    if (!j) { showToast('Data jamaah tidak ditemukan', 'error'); return; }
    if (!j.wa) { showToast('Jamaah ini tidak punya nomor WA', 'error'); return; }

    const dok = j.dokumen || {};
    const kurang = dokumenJenisUntukJamaah(j).filter(d => d.type === 'copy'
        ? !(dok[d.key + '_fc'] || dok[d.key + '_asli'])
        : !dok[d.key]
    ).map(d => d.label);

    if (!kurang.length) { showToast('Dokumen jamaah ini sudah lengkap', 'error'); return; }

    const program = dataUmroh.find(p => String(p.id) === String(dokSelectedProgram));
    const daftarDokumen = kurang.map(label => `- ${label}`).join('\n');
    const message = `Assalamualaikum ${j.nama || ''}, kami dari ${NOTA_PERUSAHAAN.nama} ingin mengingatkan kelengkapan dokumen untuk program ${program ? program.nama : '-'}. Dokumen yang masih kami perlukan:\n${daftarDokumen}\n\nMohon segera dilengkapi ya, terima kasih.`;

    window.open(`https://wa.me/${j.wa.replace(/\D/g,'')}?text=${encodeURIComponent(message)}`, '_blank');
}

async function toggleDokumenJamaah(jamaahId, key, checked) {
    if (!canManageProgramData()) { showToast('Akun Anda tidak punya izin untuk mengubah data dokumen', 'error'); return; }
    try {
        const { data: jamaahRow, error: jErr } = await supabaseClient.from('kb_jamaah').select('dokumen').eq('id', jamaahId).maybeSingle();
        if (jErr) throw jErr;
        if (!jamaahRow) throw new Error('Data jamaah tidak ditemukan (mungkin sudah dihapus/diarsipkan)');

        const dokBaru = { ...(jamaahRow.dokumen || {}), [key]: checked };
        const { error } = await supabaseClient.from('kb_jamaah').update({ dokumen: dokBaru }).eq('id', jamaahId);
        if (error) throw error;

        const idx = kbJamaahList.findIndex(j => j.id === jamaahId);
        if (idx > -1) kbJamaahList[idx].dokumen = dokBaru;
        renderNavBadges();

        if (dokSelectedProgram) await loadDokumenForProgram(dokSelectedProgram);

    } catch (err) {
        console.error('Update dokumen jamaah error:', err);
        showToast('Gagal menyimpan status dokumen: ' + err.message, 'error');
        if (dokSelectedProgram) await loadDokumenForProgram(dokSelectedProgram);
    }
}

// ============================================================
// 19D1B. TO-DO CS
// Ringkasan tugas harian CS -- MURNI agregasi dari data yang sudah ada di
// modul lain (Pembayaran, Dokumen, Data Jamaah, Pendaftaran), tidak ada
// tabel baru & tidak menyimpan status "sudah dikerjakan" apa pun. Tujuannya
// supaya CS tidak perlu buka satu-satu tab tiap pagi untuk tahu siapa yang
// perlu ditindaklanjuti hari ini.
// ============================================================
let todoCsCacheJamaah = null; // jamaah lintas-program yang jadi sumber 3 dari 4 kategori di bawah

const TODO_CS_CICILAN_H = 30; // tampilkan cicilan yang keberangkatannya <= H-30
const TODO_CS_DOKUMEN_H = 30; // tampilkan dokumen kurang yang keberangkatannya <= H-30
const TODO_CS_LEADS_HARI = 2; // leads dianggap "belum di-follow-up" kalau sudah >= 2 hari sejak daftar & belum deal/batal

// Sisa hari ke keberangkatan program (boleh negatif kalau sudah lewat).
// null kalau program/tanggalnya tidak valid.
function todoCsDaysToDeparture(program) {
    if (!program || !(program.dateObj instanceof Date) || isNaN(program.dateObj)) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const berangkat = new Date(program.dateObj); berangkat.setHours(0, 0, 0, 0);
    return Math.round((berangkat - today) / (1000 * 60 * 60 * 24));
}

// Rombongan yang sudah pulang/batal tidak perlu lagi diingatkan cicilan,
// dokumen, atau paspor -- kecualikan dari agregasi Reminder. statusMap
// (opsional) dipakai kalau sudah ada hasil fetch fresh dari DB (lihat
// renderTodoCsPanel) -- LEBIH DIPERCAYA daripada dataUmroh cache, karena
// dataUmroh.status_kepulangan cuma ter-isi di sesi ini KALAU admin sempat
// membuka/mengubah tab Status Kepulangan (tidak ikut ter-load awal saat
// loadPrograms(), lihat juga pola serupa di arsipkanSemuaJamaah()).
function todoCsProgramMasihRelevan(programId, statusMap) {
    const st = statusMap ? (statusMap[programId] || 'belum_berangkat') : statusKepulanganProgram(programId);
    return st !== 'sudah_pulang' && st !== 'batal';
}

function todoCsLabelSisaHari(days) {
    if (days === null) return '';
    if (days < 0) return `<span style="color:var(--danger);font-weight:600;">Lewat ${Math.abs(days)} hari</span>`;
    if (days === 0) return `<span style="color:var(--danger);font-weight:600;">Berangkat hari ini</span>`;
    return `H-${days}`;
}

async function renderTodoCsPanel() {
    const el = document.getElementById('todoCsContent');
    if (!el) return;
    el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--ink-soft);"><i class="bi bi-hourglass-split"></i> Memuat data...</div>`;

    try {
        // Selalu ambil data terbaru -- panel ini dimaksudkan jadi "ringkasan
        // pagi ini", bukan sesuatu yang di-cache lama.
        await Promise.all([loadKbJamaah(), loadPendaftaran()]);

        // Ambil status_kepulangan LANGSUNG dari DB (bukan dari dataUmroh
        // cache) -- dataUmroh tidak selalu punya kolom ini ter-load di awal
        // sesi (baru ter-isi kalau admin sempat buka/ubah tab Status
        // Kepulangan di sesi berjalan). Tanpa ini, rombongan yang sebenarnya
        // sudah "Sudah Pulang"/"Batal" bisa salah ikut muncul di Reminder.
        const { data: statusRows, error: srErr } = await withRetry(
            () => supabaseClient.from('programs').select('id, status_kepulangan'),
            { label: 'Muat status kepulangan program' }
        );
        if (srErr) throw srErr;
        const statusKepulanganMap = {};
        (statusRows || []).forEach(r => { statusKepulanganMap[r.id] = r.status_kepulangan || 'belum_berangkat'; });

        const jamaahAll = (kbJamaahList || []).filter(j => todoCsProgramMasihRelevan(j.program_id, statusKepulanganMap));

        let totalPerJamaah = {};
        if (jamaahAll.length) {
            const programIds = [...new Set(jamaahAll.map(j => j.program_id).filter(Boolean))];
            totalPerJamaah = await fetchTotalBayar({ programIds });
        }

        // Simpan ke cache milik tab ini + "titipkan" ke cache Pembayaran supaya
        // tombol Reminder WA cicilan (generatePaymentReminderWA, dibuat utk tab
        // Pembayaran) tetap berfungsi walau CS belum pernah buka tab Pembayaran.
        todoCsCacheJamaah = jamaahAll;
        pbCacheJamaahAll = kbJamaahList || [];
        pbCacheTotalPerJamaah = totalPerJamaah;

        // ---- 1. Cicilan mendekati keberangkatan ----
        const cicilanItems = jamaahAll.map(j => {
            const program = dataUmroh.find(p => String(p.id) === String(j.program_id));
            const hargaProgram = getHargaKamarJamaah(program, j);
            const dibayar = totalPerJamaah[j.id] || 0;
            const sisa = Math.max(hargaProgram - dibayar, 0);
            const days = todoCsDaysToDeparture(program);
            return { j, program, sisa, days };
        }).filter(r => r.sisa > 0 && r.days !== null && r.days <= TODO_CS_CICILAN_H)
          .sort((a, b) => a.days - b.days);

        // ---- 2. Leads pendaftaran belum di-follow-up ----
        const now = new Date();
        const leadsItems = (pendaftaranList || []).filter(p => p.status !== 'deal' && p.status !== 'batal').map(p => {
            const created = p.created_at ? new Date(p.created_at) : null;
            const daysSince = (created && !isNaN(created.getTime())) ? Math.floor((now - created) / (1000 * 60 * 60 * 24)) : null;
            const effProgId = getEffectiveProgramIdForPendaftaran(p);
            const program = dataUmroh.find(x => String(x.id) === String(effProgId));
            return { p, program, daysSince };
        }).filter(r => r.daysSince === null || r.daysSince >= TODO_CS_LEADS_HARI)
          .sort((a, b) => (b.daysSince ?? 0) - (a.daysSince ?? 0));

        // ---- 3. Dokumen kurang H-30 ----
        const dokumenItems = jamaahAll.map(j => {
            const program = dataUmroh.find(p => String(p.id) === String(j.program_id));
            const days = todoCsDaysToDeparture(program);
            const lengkap = isDokumenLengkap(j.dokumen, j);
            const kurang = lengkap ? [] : dokumenJenisUntukJamaah(j).filter(d => d.type === 'copy'
                ? !((j.dokumen || {})[d.key + '_fc'] || (j.dokumen || {})[d.key + '_asli'])
                : !(j.dokumen || {})[d.key]
            );
            return { j, program, days, lengkap, kurangCount: kurang.length };
        }).filter(r => !r.lengkap && r.days !== null && r.days <= TODO_CS_DOKUMEN_H)
          .sort((a, b) => a.days - b.days);

        // ---- 4. Paspor mepet / kadaluarsa ----
        const pasporItems = jamaahAll.map(j => {
            const program = dataUmroh.find(p => String(p.id) === String(j.program_id));
            const mepet = pasporMepetInfo(j.paspor_exp, program ? program.dateObj : null);
            const days = todoCsDaysToDeparture(program);
            return { j, program, mepet, days };
        }).filter(r => r.mepet)
          .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));

        const totalTugas = cicilanItems.length + leadsItems.length + dokumenItems.length + pasporItems.length;

        el.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:18px;padding:12px 16px;border:1px solid var(--line);border-radius:10px;background:var(--bg);">
                <i class="bi bi-list-check" style="color:var(--ink-soft);flex-shrink:0;font-size:16px;"></i>
                <span style="font-size:13px;color:var(--ink-soft);">${totalTugas > 0 ? `Ada <strong style="color:var(--ink);">${totalTugas} hal</strong> yang perlu ditindaklanjuti hari ini` : 'Semua sudah aman, tidak ada yang perlu ditindaklanjuti hari ini 🎉'}</span>
                <button class="btn-primary" style="margin-left:auto;font-size:11px;padding:6px 12px;" onclick="renderTodoCsPanel()"><i class="bi bi-arrow-clockwise"></i> Refresh</button>
            </div>
            ${todoCsSectionHtml('Cicilan Mendekati Keberangkatan', 'bi-cash-coin', cicilanItems.length,
                cicilanItems.map(r => todoCsRowHtml(
                    r.j.nama, r.j.asal,
                    `${escapeHtml(r.program ? r.program.nama : '-')} • ${todoCsLabelSisaHari(r.days)}`,
                    `<div style="font-weight:700;font-size:13px;margin-bottom:4px;">${formatRupiah(r.sisa)}</div>`,
                    r.j.wa ? `<button class="btn-wa-reminder" style="font-size:11px;padding:5px 10px;" id="pbWaBtn_${r.j.id}" onclick="generatePaymentReminderWA('${r.j.id}')" title="Susun & kirim reminder WA"><i class="bi bi-whatsapp"></i> Reminder WA</button>` : ''
                )).join(''),
                'Tidak ada cicilan yang mendekati keberangkatan.'
            )}
            ${todoCsSectionHtml('Leads Belum Di-follow-up', 'bi-clipboard-check', leadsItems.length,
                leadsItems.map(r => todoCsRowHtml(
                    r.p.nama, r.p.asal,
                    `${escapeHtml(r.program ? r.program.nama : 'Program belum ditentukan')} • ${r.daysSince === null ? 'tanggal daftar tidak diketahui' : `terdaftar ${r.daysSince} hari lalu`}`,
                    '',
                    r.p.wa ? `<button class="btn-wa-reminder" style="font-size:11px;padding:5px 10px;" onclick="generateTodoLeadReminderWA('${r.p.id}')" title="Follow-up via WhatsApp"><i class="bi bi-whatsapp"></i> Follow-up WA</button>` : ''
                )).join(''),
                'Semua leads sudah di-follow-up.'
            )}
            ${todoCsSectionHtml('Dokumen Kurang (H-30)', 'bi-file-earmark-check', dokumenItems.length,
                dokumenItems.map(r => todoCsRowHtml(
                    r.j.nama, r.j.asal,
                    `${escapeHtml(r.program ? r.program.nama : '-')} • ${todoCsLabelSisaHari(r.days)}`,
                    `<div style="font-size:11.5px;margin-bottom:4px;"><span class="status-badge full pill-sm">${r.kurangCount} dokumen kurang</span></div>`,
                    r.j.wa ? `<button class="btn-wa-reminder" style="font-size:11px;padding:5px 10px;" onclick="generateTodoDokReminderWA('${r.j.id}')" title="Kirim reminder WA dokumen kurang"><i class="bi bi-whatsapp"></i> Reminder WA</button>` : ''
                )).join(''),
                'Tidak ada dokumen yang kurang menjelang keberangkatan.'
            )}
            ${todoCsSectionHtml('Paspor Mepet / Kadaluarsa', 'bi-passport', pasporItems.length,
                pasporItems.map(r => todoCsRowHtml(
                    r.j.nama, r.j.asal,
                    `${escapeHtml(r.program ? r.program.nama : '-')} • ${r.mepet.text}`,
                    '',
                    r.j.wa ? `<button class="btn-wa-reminder" style="font-size:11px;padding:5px 10px;" onclick="generateTodoPasporReminderWA('${r.j.id}')" title="Kirim reminder WA perpanjangan paspor"><i class="bi bi-whatsapp"></i> Reminder WA</button>` : ''
                )).join(''),
                'Tidak ada paspor yang mepet/kadaluarsa.'
            )}
        `;
    } catch (err) {
        console.error('Render Reminder error:', err);
        el.innerHTML = `<div class="kb-no-program" style="color:var(--danger);">
            <i class="bi bi-exclamation-circle-fill"></i>
            <p>Gagal memuat data Reminder — periksa koneksi internet.</p>
        </div>`;
    }
}

function todoCsSectionHtml(title, icon, count, bodyHtml, emptyText) {
    return `
    <div style="border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <i class="bi ${icon}" style="font-size:15px;color:var(--ink-soft);"></i>
            <h3 style="font-size:13.5px;font-weight:700;margin:0;flex:1;color:var(--ink);">${title}</h3>
            <span class="status-badge ${count > 0 ? 'full' : 'available'} pill-sm">${count}</span>
        </div>
        ${count > 0 ? bodyHtml : `<p style="color:var(--ink-soft);font-size:12px;margin:0;padding:4px 0 2px;"><i class="bi bi-check-circle-fill" style="color:var(--brand);"></i> ${emptyText}</p>`}
    </div>`;
}

function todoCsRowHtml(nama, asal, sub, detailHtml, waBtnHtml) {
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);">
        <div style="min-width:0;flex:1;">
            <strong style="font-size:13px;">${escapeHtml(nama || '-')}</strong>${asal ? `<span style="font-size:11px;color:var(--ink-soft);"> • ${escapeHtml(asal)}</span>` : ''}
            <div style="font-size:11.5px;color:var(--ink-soft);margin-top:2px;">${sub}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
            ${detailHtml}
            ${waBtnHtml}
        </div>
    </div>`;
}

// Sama seperti generateDocumentReminderWA, tapi program-nya diambil dari
// j.program_id (bukan variabel global dokSelectedProgram) karena daftar di
// Reminder berisi jamaah lintas-program sekaligus, bukan hasil pilih satu
// program di dropdown seperti tab Dokumen.
function generateTodoDokReminderWA(jamaahId) {
    if (!todoCsCacheJamaah) { showToast('Data belum siap, coba lagi', 'error'); return; }
    const j = todoCsCacheJamaah.find(x => String(x.id) === String(jamaahId));
    if (!j) { showToast('Data jamaah tidak ditemukan', 'error'); return; }
    if (!j.wa) { showToast('Jamaah ini tidak punya nomor WA', 'error'); return; }

    const dok = j.dokumen || {};
    const kurang = dokumenJenisUntukJamaah(j).filter(d => d.type === 'copy'
        ? !(dok[d.key + '_fc'] || dok[d.key + '_asli'])
        : !dok[d.key]
    ).map(d => d.label);
    if (!kurang.length) { showToast('Dokumen jamaah ini sudah lengkap', 'error'); return; }

    const program = dataUmroh.find(p => String(p.id) === String(j.program_id));
    const daftarDokumen = kurang.map(label => `- ${label}`).join('\n');
    const message = `Assalamualaikum ${j.nama || ''}, kami dari ${NOTA_PERUSAHAAN.nama} ingin mengingatkan kelengkapan dokumen untuk program ${program ? program.nama : '-'}. Dokumen yang masih kami perlukan:\n${daftarDokumen}\n\nMohon segera dilengkapi ya, terima kasih.`;
    window.open(`https://wa.me/${j.wa.replace(/\D/g,'')}?text=${encodeURIComponent(message)}`, '_blank');
}

// Reminder WA perpanjangan paspor -- disusun langsung di klien (bukan lewat
// AI) karena isinya cuma pemberitahuan tanggal kadaluarsa & anjuran
// perpanjang. Dipanggil dari tombol "Reminder WA" bagian Paspor Mepet di
// tab Reminder.
function generateTodoPasporReminderWA(jamaahId) {
    if (!todoCsCacheJamaah) { showToast('Data belum siap, coba lagi', 'error'); return; }
    const j = todoCsCacheJamaah.find(x => String(x.id) === String(jamaahId));
    if (!j) { showToast('Data jamaah tidak ditemukan', 'error'); return; }
    if (!j.wa) { showToast('Jamaah ini tidak punya nomor WA', 'error'); return; }

    const program = dataUmroh.find(p => String(p.id) === String(j.program_id));
    const mepet = pasporMepetInfo(j.paspor_exp, program ? program.dateObj : null);
    if (!mepet) { showToast('Paspor jamaah ini tidak sedang mepet/kadaluarsa', 'error'); return; }

    const expDate = j.paspor_exp ? new Date(j.paspor_exp) : null;
    const expText = (expDate && !isNaN(expDate.getTime())) ? formatDateToIndonesian(expDate) : '-';
    const message = `Assalamualaikum ${j.nama || ''}, kami dari ${NOTA_PERUSAHAAN.nama} ingin mengingatkan bahwa paspor Anda (berlaku sampai ${expText}) sudah mendekati/kurang dari masa berlaku aman untuk keberangkatan program ${program ? program.nama : '-'}. Mohon segera diurus perpanjangannya ya, terima kasih.`;
    window.open(`https://wa.me/${j.wa.replace(/\D/g,'')}?text=${encodeURIComponent(message)}`, '_blank');
}

// Follow-up WA untuk leads Pendaftaran yang belum di-follow-up -- dipanggil
// dari tombol "Follow-up WA" bagian Leads di tab Reminder.
function generateTodoLeadReminderWA(pendaftaranId) {
    const p = (pendaftaranList || []).find(x => String(x.id) === String(pendaftaranId));
    if (!p) { showToast('Data pendaftaran tidak ditemukan', 'error'); return; }
    if (!p.wa) { showToast('Pendaftaran ini tidak punya nomor WA', 'error'); return; }

    const effProgId = getEffectiveProgramIdForPendaftaran(p);
    const program = dataUmroh.find(x => String(x.id) === String(effProgId));
    const message = `Assalamualaikum ${p.nama || ''}, kami dari ${NOTA_PERUSAHAAN.nama} ingin menindaklanjuti minat pendaftaran Anda${program ? ' untuk program ' + program.nama : ''}. Apakah masih berkenan melanjutkan? Kami bantu info lebih lanjut, terima kasih.`;
    window.open(`https://wa.me/${p.wa.replace(/\D/g,'')}?text=${encodeURIComponent(message)}`, '_blank');
}
