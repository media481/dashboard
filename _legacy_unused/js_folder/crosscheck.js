    // ========== CROSSCHECK PANEL ==========
    let cxSelectedProgram = null;
    let cxScanningIds = new Set(); // program id yang sedang di-OCR
    let cxOcrProgress = {}; // {progId: 0..100}

    // ---- OCR ENGINE: Gemini Vision via Supabase Edge Function ----
    const CX_OCR_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/scan-poster-ocr`;

    async function cxRunOcr(progId, imageUrl, onProgress) {
        onProgress(20); // mulai: kirim request
        const res = await fetch(CX_OCR_FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl }),
        });
        onProgress(80); // request selesai, sedang proses respons
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

    // ---- ORKESTRATOR: dipanggil otomatis tiap kali program (dengan poster) disimpan ----
    async function autoScanPosterForProgram(progId) {
        const prog = adminPrograms.find(p => String(p.id) === String(progId));
        if (!prog || !prog.link_poster) return;
        if (cxScanningIds.has(String(progId))) return; // sudah berjalan, jangan dobel

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
            // Buang field kosong supaya tidak menimpa data lama dengan string kosong
            Object.keys(parsed).forEach(k => { if (!parsed[k]) delete parsed[k]; });
            parsed._raw_ocr_text = (result.raw_text || '').slice(0, 4000);

            // Simpan ke admin_data_lengkap.poster_data, tandai sumber = OCR (AI Vision)
            const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
            adl.poster_data = parsed;
            adl.poster_data_source = 'ocr';
            adl.poster_scanned_at = new Date().toISOString();

            await updateProgramById(progId, { admin_data_lengkap: JSON.stringify(adl) });
            const idx = adminPrograms.findIndex(p => String(p.id) === String(progId));
            if (idx >= 0) adminPrograms[idx].admin_data_lengkap = JSON.stringify(adl);

            const mismatchCount = cxCountMismatch(progId);
            if (mismatchCount > 0) {
                showToast(`⚠️ Crosscheck "${prog.nama}": ${mismatchCount} data tidak cocok dengan poster!`);
            } else {
                showToast(`✅ Crosscheck "${prog.nama}": semua data cocok dengan poster.`);
            }
        } catch (err) {
            showToast('❌ Pembacaan poster gagal: ' + err.message);
        } finally {
            cxScanningIds.delete(String(progId));
            delete cxOcrProgress[progId];
            renderCxProgramSelector();
            if (String(cxSelectedProgram) === String(progId)) renderCxPanel(progId);
        }
    }
    window.autoScanPosterForProgram = autoScanPosterForProgram;

    // ---- Toleransi perbandingan: field tertentu tidak perlu cocok 100% karakter ----
    // Harga: abaikan "Rp", titik/koma pemisah ribuan, spasi — yang penting nominal angkanya sama.
    function cxNormalizeHarga(str) {
        if (!str) return '';
        return String(str).replace(/[^0-9]/g, '');
    }
    // Maskapai: "Saudia Airlines" vs "Saudia" (poster kadang cuma logo/nama singkat) dianggap cocok.
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

    // Hitung berapa field yang tidak cocok antara teks plain & hasil OCR poster
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
            sel.innerHTML = '<div style="font-size:13px;color:var(--text-3);font-style:italic;">Belum ada program.</div>';
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
                ${isScanning ? '<i class="fas fa-spinner fa-spin" style="color:#1d4ed8;font-size:9px;margin-left:2px;" title="Sedang scan poster..."></i>' : ''}
                ${!isScanning && hasData ? '<i class="fas fa-circle-check" style="color:#86efac;font-size:9px;margin-left:2px;" title="Ada data lengkap"></i>' : ''}
                ${!isScanning && mismatchCount>0 ? `<i class="fas fa-triangle-exclamation cx-pill-warn" title="${mismatchCount} data tidak cocok"></i>` : ''}
            </button>`;
        }).join('');
        // Update badge
        const badge = document.getElementById('tabCountCrosscheck');
        if (badge) badge.textContent = adminPrograms.filter(p => p.admin_data_lengkap).length;
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
        if (!prog) {
            content.innerHTML = '<div class="cx-empty"><i class="fa-solid fa-magnifying-glass-chart"></i><p>Program tidak ditemukan.</p></div>';
            return;
        }
        const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
        const val = (v) => v ? escapeHtml(v) : '<span class="cx-value empty">—</span>';
        const hasAdl = Object.keys(adl).length > 0;
        const hasPoster = !!prog.link_poster;

        // Bangun rows perbandingan
        const buildCompareRows = () => {
            const rows = [
                { label: 'Nama Program',    plain: prog.nama,          poster: null, field: 'nama' },
                { label: 'Tanggal',         plain: prog.tgl,           poster: null, field: 'tgl' },
                { label: 'Durasi',          plain: prog.durasi,        poster: null, field: 'durasi' },
                { label: 'Maskapai',        plain: prog.maskapai,      poster: null, field: 'maskapai' },
                { label: 'Harga Quint',     plain: prog.harga_quint,   poster: null, field: 'harga_quint' },
                { label: 'Harga Quad',      plain: adl.harga_quad,     poster: null, field: 'harga_quad' },
                { label: 'Harga Triple',    plain: adl.harga_triple,   poster: null, field: 'harga_triple' },
                { label: 'Harga Double',    plain: adl.harga_double,   poster: null, field: 'harga_double' },
                { label: 'Hotel Makkah',    plain: adl.hotel_makkah,   poster: null, field: 'hotel_makkah' },
                { label: 'Hotel Madinah',   plain: adl.hotel_madinah,  poster: null, field: 'hotel_madinah' },
                { label: 'Makan Makkah',    plain: adl.makan_makkah,   poster: null, field: 'makan_makkah' },
                { label: 'Makan Madinah',   plain: adl.makan_madinah,  poster: null, field: 'makan_madinah' },
            ];
            // Baca data poster (dari adl.poster_data jika sudah disimpan)
            const pd = (() => { try { return adl.poster_data ? (typeof adl.poster_data === 'string' ? JSON.parse(adl.poster_data) : adl.poster_data) : {}; } catch(e) { return {}; } })();
            rows.forEach(r => { if (pd[r.field]) r.poster = pd[r.field]; });

            return rows.map(r => {
                const hasBoth = r.plain && r.poster;
                const isMatch = hasBoth && cxValuesMatch(r.field, r.plain, r.poster);
                const rowClass = hasBoth ? (isMatch ? 'cx-match' : 'cx-mismatch') : '';
                const pill = hasBoth ? `<span class="cx-match-pill ${isMatch?'ok':'no'}">${isMatch?'✓ Cocok':'✗ Beda'}</span>` : `<span class="cx-match-pill skip">—</span>`;
                return `<div class="cx-compare-row ${rowClass}">
                    <div class="cx-compare-col">
                        <div class="cx-compare-label"><i class="fas fa-file-text" style="margin-right:3px;font-size:8px;"></i>Teks Plain</div>
                        <div class="cx-compare-val ${r.plain?'':'empty'}">${r.plain ? escapeHtml(r.plain) : '—'}</div>
                    </div>
                    <div class="cx-divider"></div>
                    <div class="cx-compare-col">
                        <div class="cx-compare-label"><i class="fas fa-image" style="margin-right:3px;font-size:8px;"></i>Poster</div>
                        <div class="cx-compare-val ${r.poster?'':'empty'}">${r.poster ? escapeHtml(r.poster) : '—'}</div>
                    </div>
                    <div style="display:flex;align-items:center;padding-left:8px;">
                        <div class="cx-compare-label" style="margin-bottom:4px;text-align:center;min-width:60px;">${escapeHtml(r.label)}</div>
                    </div>
                    ${pill}
                </div>`;
            }).join('');
        };

        const isScanning = cxScanningIds.has(String(progId));
        const mismatchCount = adl.poster_data ? cxCountMismatch(progId) : 0;
        const posterSource = adl.poster_data_source === 'ocr' ? 'ocr' : (adl.poster_data ? 'manual' : null);

        content.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
            <div style="font-size:14px;font-weight:700;color:#5b21b6;">${escapeHtml(prog.nama||'Program')}</div>
            <div style="display:flex;gap:8px;align-items:center;">
                ${mismatchCount > 0 ? `<span class="cx-mismatch-count"><i class="fas fa-triangle-exclamation"></i> ${mismatchCount} tidak cocok</span>` : ''}
                <button class="cx-parse-btn" onclick="openCxEditModal('${prog.id}')"><i class="fas fa-edit"></i> Input Manual</button>
                ${hasPoster ? `<button class="cx-parse-btn" onclick="autoScanPosterForProgram('${prog.id}')" ${isScanning?'disabled':''}><i class="fas fa-${isScanning?'spinner fa-spin':'arrows-rotate'}"></i> ${isScanning?'Memindai...':'Scan Ulang Poster'}</button>` : ''}
                ${hasPoster ? `<button class="cx-parse-btn" onclick="window.open('${escapeHtml(prog.link_poster)}','_blank')"><i class="fas fa-image"></i> Lihat Poster</button>` : ''}
            </div>
        </div>

        <!-- Status banner -->
        ${isScanning ? `
        <div class="cx-status-bar scanning">
            <i class="fas fa-spinner"></i>
            <div style="flex:1;">
                <div>Membaca poster otomatis dengan AI (Gemini Vision)... bisa sampai ±20 detik jika server AI sedang sibuk (otomatis dicoba ulang).</div>
                <div class="cx-ocr-progress-wrap"><div class="cx-ocr-progress-bar" id="cxOcrBar_${progId}" style="width:${cxOcrProgress[progId]||0}%;"></div></div>
            </div>
        </div>
        ` : `
        <div class="cx-status-bar ${mismatchCount > 0 ? 'warn' : (hasAdl ? 'ok' : 'missing')}">
            <i class="fas fa-${mismatchCount > 0 ? 'triangle-exclamation' : (hasAdl ? 'circle-check' : 'circle-info')}"></i>
            ${mismatchCount > 0
                ? `Ditemukan <b>${mismatchCount} field</b> yang tidak cocok antara teks plain & poster. Periksa tabel perbandingan di bawah.`
                : (hasAdl ? 'Data lengkap tersedia. ' + (adl.poster_data ? 'Data poster sudah terbaca — semua cocok, lihat perbandingan di bawah.' : (hasPoster ? 'Poster akan dibaca otomatis saat program disimpan, atau klik <b>Scan Ulang Poster</b>.' : 'Belum ada link poster.')) : 'Belum ada data lengkap. Paste teks plain di form tambah/edit program lalu simpan.')
            }
            ${posterSource ? `<span class="cx-source-tag ${posterSource}">${posterSource === 'ocr' ? 'Sumber: AI Vision (otomatis)' : 'Sumber: Input manual'}</span>` : ''}
        </div>
        `}

        <!-- Data dari teks plain -->
        <div class="cx-section-title"><i class="fas fa-file-lines"></i> Data dari Teks Plain (Konsep)</div>
        <div class="cx-grid">
            <div class="cx-block">
                <div class="cx-block-header"><i class="fas fa-tag"></i> Harga</div>
                <div class="cx-block-body">
                    <div class="cx-field"><div class="cx-label">Quint (5 org)</div><div class="cx-value">${val(prog.harga_quint)}</div></div>
                    <div class="cx-field"><div class="cx-label">Quad (4 org)</div><div class="cx-value">${val(adl.harga_quad)}</div></div>
                    <div class="cx-field"><div class="cx-label">Triple (3 org)</div><div class="cx-value">${val(adl.harga_triple)}</div></div>
                    <div class="cx-field"><div class="cx-label">Double (2 org)</div><div class="cx-value">${val(adl.harga_double)}</div></div>
                </div>
            </div>
            <div class="cx-block">
                <div class="cx-block-header"><i class="fas fa-hotel"></i> Hotel & Konsumsi</div>
                <div class="cx-block-body">
                    <div class="cx-field"><div class="cx-label">Hotel Makkah</div><div class="cx-value">${val(adl.hotel_makkah)}</div></div>
                    <div class="cx-field"><div class="cx-label">Hotel Madinah</div><div class="cx-value">${val(adl.hotel_madinah)}</div></div>
                    <div class="cx-field"><div class="cx-label">Makan Makkah</div><div class="cx-value">${val(adl.makan_makkah)}</div></div>
                    <div class="cx-field"><div class="cx-label">Makan Madinah</div><div class="cx-value">${val(adl.makan_madinah)}</div></div>
                </div>
            </div>
            <div class="cx-block" style="grid-column:1/-1;">
                <div class="cx-block-header"><i class="fas fa-circle-check" style="color:#16a34a;"></i> Termasuk dalam Paket</div>
                <div class="cx-block-body"><div class="cx-value area">${adl.termasuk ? escapeHtml(adl.termasuk) : '<span class="empty" style="color:var(--text-3);font-style:italic;">Belum diisi</span>'}</div></div>
            </div>
            <div class="cx-block" style="grid-column:1/-1;">
                <div class="cx-block-header"><i class="fas fa-circle-xmark" style="color:#dc2626;"></i> Tidak Termasuk</div>
                <div class="cx-block-body"><div class="cx-value area">${adl.tidak_termasuk ? escapeHtml(adl.tidak_termasuk) : '<span class="empty" style="color:var(--text-3);font-style:italic;">Belum diisi</span>'}</div></div>
            </div>
            ${adl.catatan_cx ? `<div class="cx-block" style="grid-column:1/-1;">
                <div class="cx-block-header"><i class="fas fa-note-sticky"></i> Catatan Admin</div>
                <div class="cx-block-body"><div class="cx-value area">${escapeHtml(adl.catatan_cx)}</div></div>
            </div>` : ''}
        </div>

        <!-- Perbandingan dengan poster -->
        ${adl.poster_data ? `
        <div class="cx-section-title" style="margin-top:20px;"><i class="fas fa-code-compare"></i> Perbandingan: Teks Plain vs Poster</div>
        <div style="font-size:12px;color:var(--text-3);margin-bottom:10px;"><i class="fas fa-circle-check" style="color:#86efac;"></i> Hijau = cocok &nbsp; <i class="fas fa-circle-xmark" style="color:#fca5a5;"></i> Merah = tidak sesuai${posterSource==='ocr' ? ' &nbsp; · &nbsp; Hasil OCR bisa salah baca — jika ada yang keliru, klik <b>Input Manual</b> untuk mengoreksi.' : ''}</div>
        ${buildCompareRows()}
        ` : ''}
        `;
    }

    // Modal untuk input data poster (untuk crosscheck)
    function openCxEditModal(progId) {
        const prog = adminPrograms.find(p => String(p.id) === String(progId));
        if (!prog) return;
        const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
        const pd = adl.poster_data || {};

        // Buat modal dinamis
        let modal = document.getElementById('cxEditModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'cxEditModal';
            modal.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:40000;overflow-y:auto;padding:24px;backdrop-filter:blur(4px);';
            document.body.appendChild(modal);
        }
        const fields = [
            { key: 'nama',          label: 'Nama Program',  val: pd.nama    || prog.nama    || '' },
            { key: 'tgl',           label: 'Tanggal',       val: pd.tgl     || prog.tgl     || '' },
            { key: 'durasi',        label: 'Durasi',        val: pd.durasi  || prog.durasi  || '' },
            { key: 'maskapai',      label: 'Maskapai',      val: pd.maskapai|| prog.maskapai|| '' },
            { key: 'harga_quint',   label: 'Harga Quint',   val: pd.harga_quint  || prog.harga_quint  || '' },
            { key: 'harga_quad',    label: 'Harga Quad',    val: pd.harga_quad   || adl.harga_quad    || '' },
            { key: 'harga_triple',  label: 'Harga Triple',  val: pd.harga_triple || adl.harga_triple  || '' },
            { key: 'harga_double',  label: 'Harga Double',  val: pd.harga_double || adl.harga_double  || '' },
            { key: 'hotel_makkah',  label: 'Hotel Makkah',  val: pd.hotel_makkah || adl.hotel_makkah  || '' },
            { key: 'hotel_madinah', label: 'Hotel Madinah', val: pd.hotel_madinah|| adl.hotel_madinah || '' },
            { key: 'makan_makkah',  label: 'Makan Makkah',  val: pd.makan_makkah || adl.makan_makkah  || '' },
            { key: 'makan_madinah', label: 'Makan Madinah', val: pd.makan_madinah|| adl.makan_madinah || '' },
        ];

        modal.innerHTML = `
        <div style="max-width:600px;width:100%;background:#fff;border-radius:var(--radius-lg);overflow:hidden;box-shadow:var(--shadow-lg);margin:0 auto;animation:modalFadeIn .25s ease;">
            <div style="background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;padding:18px 22px;display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-size:16px;font-weight:700;">Input Data Poster</div>
                    <div style="font-size:11.5px;opacity:.8;margin-top:3px;">Ketik data yang tampil di poster untuk crosscheck</div>
                </div>
                <button onclick="document.getElementById('cxEditModal').style.display='none'" style="background:rgba(255,255,255,0.15);border:none;color:#fff;font-size:20px;cursor:pointer;width:34px;height:34px;border-radius:6px;">×</button>
            </div>
            <div style="padding:20px;">
                <div style="background:#faf5ff;border:1px solid #ede9fe;border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:12.5px;color:#5b21b6;display:flex;gap:8px;align-items:flex-start;">
                    <i class="fas fa-circle-info" style="margin-top:1px;flex-shrink:0;"></i>
                    <span>Arahkan pointer ke nama program untuk melihat poster, lalu ketik/koreksi data yang tertera di poster ke kolom di bawah ini.</span>
                </div>
                ${adl.poster_data_source === 'ocr' && pd._raw_ocr_text ? `
                <details style="margin-bottom:16px;">
                    <summary style="cursor:pointer;font-size:12px;font-weight:700;color:#7c3aed;">📄 Lihat teks mentah hasil OCR (untuk bantu koreksi)</summary>
                    <div style="margin-top:8px;background:#f8fafc;border:1px solid var(--border);border-radius:6px;padding:10px;font-size:11.5px;color:var(--text-2);white-space:pre-wrap;max-height:140px;overflow-y:auto;">${escapeHtml(pd._raw_ocr_text)}</div>
                </details>
                ` : ''}
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    ${fields.map(f => `
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="font-size:10.5px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.4px;">${escapeHtml(f.label)}</label>
                        <input type="text" id="cxp_${f.key}" value="${escapeHtml(f.val)}" style="padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit;" placeholder="Dari poster...">
                    </div>`).join('')}
                </div>
                <div style="display:flex;gap:8px;margin-top:18px;">
                    <button class="cx-save-btn" onclick="saveCxPosterData('${prog.id}')"><i class="fas fa-save"></i> Simpan & Bandingkan</button>
                    <button class="cx-parse-btn" onclick="document.getElementById('cxEditModal').style.display='none'">Batal</button>
                </div>
            </div>
        </div>`;
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
    }

    async function saveCxPosterData(progId) {
        const prog = adminPrograms.find(p => String(p.id) === String(progId));
        if (!prog) return;
        const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
        const keys = ['nama','tgl','durasi','maskapai','harga_quint','harga_quad','harga_triple','harga_double','hotel_makkah','hotel_madinah','makan_makkah','makan_madinah'];
        const pd = {};
        keys.forEach(k => {
            const el = document.getElementById('cxp_' + k);
            if (el && el.value.trim()) pd[k] = el.value.trim();
        });
        adl.poster_data = pd;
        adl.poster_data_source = 'manual';
        adl.poster_scanned_at = new Date().toISOString();
        try {
            await updateProgramById(progId, { admin_data_lengkap: JSON.stringify(adl) });
            // Update local
            const idx = adminPrograms.findIndex(p => String(p.id) === String(progId));
            if (idx >= 0) adminPrograms[idx].admin_data_lengkap = JSON.stringify(adl);
            document.getElementById('cxEditModal').style.display = 'none';
            renderCxProgramSelector();
            renderCxPanel(progId);
            showToast('✅ Data poster disimpan — crosscheck siap!');
        } catch(err) {
            showToast('❌ Gagal simpan: ' + err.message);
        }
    }

    window.selectCxProgram = selectCxProgram;
    window.openCxEditModal = openCxEditModal;
    window.saveCxPosterData = saveCxPosterData;
    // ========== END CROSSCHECK ==========
