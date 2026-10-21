// ============================================================
// MODUL LAZY: CROSSCHECK (OCR poster vs data)  (js/modules/crosscheck.js)
// ============================================================
// Dipecah dari js/app.js dan dimuat HANYA saat dibutuhkan (ensureModuleLoaded('crosscheck') di app.js).
// Dimuat sebagai <script> biasa (BUKAN ES module): satu lingkup global dengan app.js, jadi nama
// fungsi global, onclick="..." dan data-action="..." tidak berubah.
// ATURAN: jangan mendeklarasikan ulang nama yang sudah ada di app.js (const/let ganda = SyntaxError).
// Fungsi yang dirujuk index.html / kode inti SEBELUM modul dimuat didaftarkan di LAZY_MODULES['crosscheck'].api (app.js).
// ============================================================

// Field mismatch di panel Crosscheck ada di section (fieldset) mana di form
// Edit Program -- dipakai cxGoToEditField() buat auto-scroll ke section yang
// tepat begitu form dibuka.
const CX_FIELD_TO_SECTION = {
    nama: 'af-info', tgl: 'af-info', durasi: 'af-info', maskapai: 'af-info',
    harga_quint: 'af-harga', harga_quad: 'af-harga', harga_triple: 'af-harga', harga_double: 'af-harga',
    hotel_makkah: 'af-akomodasi', hotel_madinah: 'af-akomodasi', hotel_3: 'af-akomodasi', hotel_4: 'af-akomodasi',
    termasuk: 'af-konten', tidak_termasuk: 'af-konten', catatan_cx: 'af-konten',
};

// [CROSSCHECK] Diklik dari baris "data tidak cocok" di panel Crosscheck ->
// langsung buka modal/form Edit Program terkait, auto-scroll ke section field
// itu, fokuskan inputnya, dan kasih flash merah sesaat supaya kelihatan jelas
// field mana yang dimaksud (tanpa admin perlu cari-cari manual di form).
async function cxGoToEditField(progId, field) {
    await editAdminProgram(progId);
    // Baris Hotel 3/4 tersembunyi kalau belum ada isinya -- munculkan dulu supaya bisa difokuskan.
    if (field === 'hotel_3' || field === 'hotel_4') {
        setAdminHotelExtraVisible(3, true);
        if (field === 'hotel_4') setAdminHotelExtraVisible(4, true);
    }
    const sectionId = CX_FIELD_TO_SECTION[field];
    if (sectionId) scrollToAdminSection(sectionId);
    setTimeout(() => {
        // Tanggal disimpan di input hidden 'admin_tgl' -- yang kelihatan &
        // bisa difokuskan admin adalah 'admin_tgl_date'.
        const inputId = field === 'tgl' ? 'admin_tgl_date' : CX_AUTOFILL_FIELD_TO_INPUT[field];
        const el = inputId && document.getElementById(inputId);
        if (!el) return;
        el.focus();
        if (typeof el.select === 'function') el.select();
        el.classList.add('cx-field-flash');
        setTimeout(() => el.classList.remove('cx-field-flash'), 1300);
    }, 400); // tunggu form + smooth-scroll section selesai render
}

async function cxRunOcr(progId, imageUrl, onProgress) {
    onProgress(20);
    const res = await fetch(CX_OCR_FUNCTION_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
        },
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
        // [FIX] resolveImageUrl() dulu sebelum kirim ke OCR — kalau link_poster berupa
        // link share Google Drive biasa (/file/d/ID/view), server OCR akan fetch HTML
        // halaman viewer-nya (bukan gambar) dan gagal/salah baca. Popup hover poster
        // sudah benar melakukan ini, tapi jalur OCR sebelumnya lupa dipasangi juga.
        const posterUrlForOcr = resolveImageUrl(prog.link_poster, prog.poster_version);
        const result = await cxRunOcr(progId, posterUrlForOcr, (pct) => {
            cxOcrProgress[progId] = pct;
            if (String(cxSelectedProgram) === String(progId)) {
                const bar = document.getElementById('cxOcrBar_' + progId);
                if (bar) bar.style.width = pct + '%';
            }
        });

        const parsed = { ...result.fields };
        // [CROSSCHECK] termasuk/tidak_termasuk datang dari Gemini sebagai array
        // (satu item per elemen) -- gabung jadi string satu-item-per-baris di sini
        // supaya bentuknya sama persis dengan sisi teks (adl.termasuk/tidak_termasuk,
        // yang berasal dari textarea admin_termasuk/admin_tidak_termasuk) dan bisa
        // langsung dibandingkan/dipakai isi ulang textarea tanpa konversi lagi.
        ['termasuk', 'tidak_termasuk'].forEach(k => {
            if (Array.isArray(parsed[k])) parsed[k] = parsed[k].filter(Boolean).join('\n');
        });
        Object.keys(parsed).forEach(k => { if (!parsed[k]) delete parsed[k]; });
        parsed._raw_ocr_text = (result.raw_text || '').slice(0, 4000);

        // [FIX RACE CONDITION] Ambil ulang data program TERBARU dari server
        // (bukan pakai snapshot `prog` di awal fungsi) sebelum menentukan field
        // mana yang "masih kosong". OCR ke Gemini butuh beberapa detik — kalau
        // dalam rentang waktu itu admin sempat isi & simpan manual field yang
        // sama, snapshot `prog` di awal sudah basi dan auto-fill bisa salah
        // menimpa data manual yang baru saja disimpan admin. Kalau fetch ulang
        // ini gagal (mis. koneksi putus), fallback ke snapshot lama supaya
        // proses tetap jalan (lebih aman dari gagal total, risiko basi tetap
        // lebih kecil daripada sebelumnya karena sudah dicoba di-refresh).
        let freshProg = prog;
        try {
            const { data: freshRow, error: freshErr } = await supabaseClient
                .from('programs').select('*').eq('id', progId).single();
            if (!freshErr && freshRow) freshProg = freshRow;
        } catch (e) { /* biarkan pakai snapshot lama kalau fetch gagal */ }

        const adl = (() => { try { return freshProg.admin_data_lengkap ? (typeof freshProg.admin_data_lengkap === 'string' ? JSON.parse(freshProg.admin_data_lengkap) : freshProg.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
        adl.poster_data = parsed;
        adl.poster_data_source = 'ocr';
        adl.poster_scanned_at = new Date().toISOString();

        // [AUTO-FILL] Kalau ada field yang MASIH KOSONG di data program (belum
        // pernah diisi admin), langsung isi otomatis dari hasil OCR poster —
        // supaya paket yang sudah punya poster tapi datanya belum lengkap bisa
        // auto terisi tanpa admin ketik ulang. Field yang SUDAH ada isinya
        // TIDAK PERNAH ditimpa di sini (itu tetap urusan modul crosscheck di
        // atas, yang cuma memperingatkan kalau beda, bukan menimpa otomatis).
        // Cek "kosong atau tidak" pakai freshProg/adl di atas (data TERBARU),
        // bukan snapshot lama.
        const topFilled = {};   // kolom top-level tabel programs
        const adlFilled = {};  // field di dalam admin_data_lengkap
        const filledLabels = [];
        const CX_AUTOFILL_MAP = [
            ['nama', 'top', 'Nama Program'], ['tgl', 'top', 'Tanggal'], ['durasi', 'top', 'Durasi'],
            ['maskapai', 'top', 'Maskapai'], ['harga_quint', 'top', 'Harga Quint'],
            ['harga_quad', 'adl', 'Harga Quad'], ['harga_triple', 'adl', 'Harga Triple'],
            ['harga_double', 'adl', 'Harga Double'], ['hotel_makkah', 'adl', 'Hotel Makkah'],
            ['hotel_madinah', 'adl', 'Hotel Madinah'],
            ['hotel_3', 'adl', 'Hotel 3'], ['hotel_4', 'adl', 'Hotel 4'],
            // [CROSSCHECK] where:'adl' karena termasuk/tidak_termasuk/catatan_cx disimpan
            // langsung di admin_data_lengkap (bukan kolom top-level tabel programs) --
            // sama seperti hotel_makkah/harga_quad dkk di atas.
            ['termasuk', 'adl', 'Fasilitas Termasuk'], ['tidak_termasuk', 'adl', 'Tidak Termasuk'],
            ['catatan_cx', 'adl', 'Catatan/Disclaimer'],
        ];
        CX_AUTOFILL_MAP.forEach(([field, where, label]) => {
            const ocrVal = parsed[field];
            if (!ocrVal) return;
            const currentVal = where === 'top' ? freshProg[field] : adl[field];
            if (currentVal) return; // sudah ada isinya (termasuk yang baru disimpan admin di tengah proses OCR), jangan ditimpa
            if (where === 'top') topFilled[field] = ocrVal; else adlFilled[field] = ocrVal;
            filledLabels.push(label);
        });
        Object.assign(adl, adlFilled);
        // Kota Hotel 3/4 ikut terisi dari poster kalau hotelnya baru saja terisi otomatis.
        ['hotel_3', 'hotel_4'].forEach(h => {
            if (adlFilled[h] && !adl[h + '_kota']) {
                const k = normalizeHotelKota(parsed[h + '_kota']);
                if (k) adl[h + '_kota'] = k;
            }
        });

        // [AUTO-FILL] Catat field mana saja yang barusan terisi otomatis di
        // ronde ini, supaya bisa ditandai kuning "belum dikonfirmasi" di form
        // — baik sekarang (kalau form sedang terbuka) maupun nanti kalau form
        // dibuka ulang sebelum admin sempat menyimpan/meninjau perubahan ini.
        const autofilledKeys = Object.keys({ ...topFilled, ...adlFilled });
        if (autofilledKeys.length) adl.autofilled_fields = autofilledKeys;
        else delete adl.autofilled_fields;

        await updateProgramById(progId, { ...topFilled, admin_data_lengkap: JSON.stringify(adl) });
        const idx = adminPrograms.findIndex(p => String(p.id) === String(progId));
        if (idx >= 0) Object.assign(adminPrograms[idx], freshProg, topFilled, { admin_data_lengkap: JSON.stringify(adl) });

        // Kalau form Tambah/Edit program ini sedang terbuka, ikut isi field
        // yang kosong di layar secara langsung (tanpa perlu klik apa-apa),
        // lalu tandai kuning sebagai "belum dikonfirmasi admin".
        if (String(editingProgramId) === String(progId) && autofilledKeys.length) {
            Object.entries({ ...topFilled, ...adlFilled }).forEach(([field, val]) => {
                const inputId = CX_AUTOFILL_FIELD_TO_INPUT[field];
                const el = inputId && document.getElementById(inputId);
                if (el) el.value = val;
            });
            // Hotel 3/4 yang baru terisi dari poster: munculkan barisnya + isi kota & hint.
            ['hotel_3', 'hotel_4'].forEach(h => {
                if (!adlFilled[h]) return;
                const n = h === 'hotel_3' ? 3 : 4;
                const kEl = document.getElementById(`admin_hotel_${n}_kota`);
                if (kEl && adl[h + '_kota']) kEl.value = adl[h + '_kota'];
                if (n === 4) setAdminHotelExtraVisible(3, true);
                setAdminHotelExtraVisible(n, true);
                ensureHotelReferenceLoaded().then(() => updateAdminHotelExtraHint(n));
            });
            ['admin_harga_quint', 'admin_harga_quad', 'admin_harga_triple', 'admin_harga_double'].forEach(id => {
                formatRupiahInput(document.getElementById(id));
            });
            if (topFilled.tgl) {
                const dateInput = document.getElementById('admin_tgl_date');
                const parsedTgl = parseDateFromString(topFilled.tgl);
                if (dateInput && parsedTgl && !isNaN(parsedTgl.getTime())) {
                    dateInput.value = `${parsedTgl.getFullYear()}-${String(parsedTgl.getMonth() + 1).padStart(2, '0')}-${String(parsedTgl.getDate()).padStart(2, '0')}`;
                }
            }
            cxApplyAutofillHighlight(autofilledKeys);
        }

        if (filledLabels.length) {
            showToast(`Data terisi otomatis dari poster: ${filledLabels.join(', ')}`);
        }

        const mismatchCount = cxCountMismatch(progId);
        if (mismatchCount > 0) {
            showToast(`Crosscheck "${prog.nama}": ${mismatchCount} data tidak cocok dengan poster!`, 'error');
        } else if (!filledLabels.length) {
            showToast(`Crosscheck "${prog.nama}": semua data cocok dengan poster.`);
        }
    } catch (err) {
        showToast('Pembacaan poster gagal: ' + err.message, 'error');
    } finally {
        cxScanningIds.delete(String(progId));
        delete cxOcrProgress[progId];
        renderCxProgramSelector();
        if (String(cxSelectedProgram) === String(progId)) renderCxPanel(progId);
    }
}
// [CROSSCHECK] Tampilan daftar Fasilitas Termasuk/Tidak Termasuk di panel bandingan:
// tiap item jadi satu chip, dan item yang tidak punya pasangan di sisi lain
// ditandai MERAH (class cx-li-bad) supaya langsung kelihatan bagian mana yang
// bikin status "Beda". Pencocokan memakai cxListItemContains() -- aturan yang
// sama dengan cxListItemsMatch() -- jadi tanda merah selalu konsisten dengan status.
function cxSplitListRaw(str) {
    return String(str || '').split('\n').map(s => s.trim()).filter(Boolean);
}
function cxRenderListChips(str, isBad) {
    const items = cxSplitListRaw(str);
    if (!items.length) return '—';
    return '<ul class="cx-li-list">' + items.map(it => {
        const bad = isBad(it.toLowerCase());
        return `<li class="${bad ? 'cx-li-bad' : ''}"${bad ? ' title="Tidak ditemukan padanannya di sisi lain"' : ''}>${escapeHtml(it)}</li>`;
    }).join('') + '</ul>';
}
// [OPSI B] Fallback kalau field termasuk/tidak_termasuk terstruktur GAGAL terbaca
// dari poster (mis. posternya menulis fasilitas dalam paragraf lepas, bukan daftar
// rapi, sehingga Gemini tidak bisa memecahnya jadi array) tapi teks mentah hasil
// OCR (_raw_ocr_text) tetap ada. Di sini tiap item sisi teks dicek apakah kata
// kunci uniknya (kata >=4 huruf, biar tidak kena kata umum spt "PP"/"1x") muncul
// di raw text. Ini validasi longgar (bukan pembanding definitif) -- makanya cuma
// dipakai sbg sinyal "warning" di panel, TIDAK ikut dihitung ke cxCountMismatchForProgram
// (yang harus tetap konservatif/akurat karena dipakai badge "Verified" publik).
function cxCheckListAgainstRawText(plainStr, rawText) {
    const items = cxNormalizeListItems(plainStr);
    if (!items.length || !rawText) return null;
    const rt = String(rawText).toLowerCase();
    const notFound = items.filter(item => {
        const words = item.split(/\s+/).filter(w => w.length >= 4);
        if (!words.length) return !rt.includes(item);
        return !words.some(w => rt.includes(w));
    });
    return { total: items.length, notFound };
}

function cxCountMismatch(progId) {
    const prog = adminPrograms.find(p => String(p.id) === String(progId));
    return cxCountMismatchForProgram(prog);
}

function renderCxStatsBar() {
    const bar = document.getElementById('cxStatsBar');
    if (!bar) return;
    const cxPrograms = (adminPrograms || []).filter(p => !cxIsProgramExpired(p));
    if (!cxPrograms.length) { bar.innerHTML = ''; return; }
    let mismatch = 0, missing = 0, ok = 0, noPoster = 0;
    cxPrograms.forEach(p => {
        const { priority, hasPoster } = cxGetProgramStatus(p);
        if (priority === 0) mismatch++; else if (priority === 1) missing++; else ok++;
        if (!hasPoster) noPoster++;
    });
    bar.innerHTML = `
        <div class="cx-stat-chip ok"><i class="bi bi-check-circle-fill"></i> ${ok} cocok</div>
        <div class="cx-stat-chip warn"><i class="bi bi-exclamation-triangle-fill"></i> ${mismatch} tidak cocok</div>
        <div class="cx-stat-chip missing"><i class="bi bi-info-circle-fill"></i> ${missing} belum ada data</div>
        ${noPoster > 0 ? `<div class="cx-stat-chip noposter"><i class="bi bi-image"></i> ${noPoster} belum ada poster</div>` : ''}
    `;
}

function renderCxProgramSelector() {
    const sel = document.getElementById('cxProgramSelector');
    if (!sel) return;
    renderCxStatsBar();
    const cxPrograms = (adminPrograms || []).filter(p => !cxIsProgramExpired(p));
    if (!cxPrograms.length) {
        sel.innerHTML = '<div style="font-size:13px;color:var(--ink-soft);font-style:italic;">Belum ada program.</div>';
        return;
    }
    const query = (document.getElementById('cxSearchInput')?.value || '').trim().toLowerCase();
    let list = cxPrograms.map(p => ({ p, status: cxGetProgramStatus(p) }));
    if (query) list = list.filter(({ p }) => (p.nama || '').toLowerCase().includes(query));
    // Urutkan: yang bermasalah (tidak cocok) dulu, lalu belum ada data, lalu yang sudah aman
    list.sort((a, b) => a.status.priority - b.status.priority);

    if (!list.length) {
        sel.innerHTML = '<div style="font-size:13px;color:var(--ink-soft);font-style:italic;">Tidak ada program yang cocok dengan pencarian.</div>';
        return;
    }

    sel.innerHTML = list.map(({ p, status }) => {
        const { hasData, hasPoster, mismatchCount } = status;
        const isActive = String(cxSelectedProgram) === String(p.id);
        const isScanning = cxScanningIds.has(String(p.id));
        return `<button class="cx-program-pill${isActive?' active':''}${mismatchCount>0?' has-warning':''}${!hasPoster?' no-poster':''}" onclick="selectCxProgram('${p.id}')">
            <span class="cx-pill-name">${escapeHtml(p.nama||'Program')}</span>
            ${!isScanning && !hasPoster ? '<i class="bi bi-image cx-pill-noposter" title="Belum ada link poster"></i>' : ''}
            ${isScanning ? '<i class="bi bi-arrow-repeat bi-spin" style="color:var(--brand);font-size:11px;" title="Sedang scan poster..."></i>' : ''}
            ${!isScanning && hasData ? '<i class="bi bi-check-circle-fill" style="color:var(--success);font-size:11px;" title="Ada data lengkap"></i>' : ''}
            ${!isScanning && mismatchCount>0 ? `<i class="bi bi-exclamation-triangle-fill cx-pill-warn" title="${mismatchCount} data tidak cocok"></i>` : ''}
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
    if (!prog) { content.innerHTML = '<div class="cx-empty"><i class="bi bi-graph-up-arrow"></i><p>Program tidak ditemukan.</p></div>'; return; }
    const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
    const val = (v) => v ? escapeHtml(v) : '<span class="cx-value empty">—</span>';
    const hasAdl = Object.keys(adl).length > 0;
    const hasPoster = !!prog.link_poster;

    // [REFERENSI HOTEL] Untuk baris Hotel Makkah/Madinah, kasih badge kecil
    // yang menandai apakah nama hotel di sisi Teks & Poster dikenali di data
    // referensi Hotel Saudi Arabia (lihat 21c) -- berguna khusus buat baris
    // yang "Beda" (mismatch): kalau salah satu sisi TIDAK dikenali sama sekali,
    // itu petunjuk kuat sisi itu salah baca OCR / typo, bukan cuma beda versi.
    const cxHotelRefLine = (field, plainVal, posterVal) => {
        if (!CX_HOTEL_REF_HINT_ENABLED) return '';
        if (field !== 'hotel_makkah' && field !== 'hotel_madinah' && field !== 'hotel_3' && field !== 'hotel_4') return '';
        if (!hotelSaudiLoaded || !hotelSaudiList.length) return '';
        // Hotel 3/4: referensi hanya ada untuk Makkah & Madinah, ikut kota yang dipilih di form.
        let cityKeyword = field === 'hotel_makkah' ? 'makkah' : 'madinah';
        if (field === 'hotel_3' || field === 'hotel_4') {
            const k = String(adl[field + '_kota'] || '').toLowerCase();
            if (k !== 'makkah' && k !== 'madinah') return '';
            cityKeyword = k;
        }
        const describe = (val) => {
            if (!val) return null;
            const m = findBestHotelMatch(val, cityKeyword);
            if (m && m.score >= HOTEL_REF_MATCH_THRESHOLD) return { ok: true, text: 'dikenali' };
            if (m && m.score >= HOTEL_REF_SUGGEST_THRESHOLD) return { ok: false, text: `mirip "${m.hotel.hotel_name}"?` };
            return { ok: false, text: 'tidak dikenali' };
        };
        const dPlain = describe(plainVal), dPoster = describe(posterVal);
        if (!dPlain && !dPoster) return '';
        const chip = (label, d) => !d ? '' : `<span class="cx-ref-chip ${d.ok ? 'ok' : 'warn'}">${label}: ${escapeHtml(d.text)}</span>`;
        return `<div class="cx-ref-line"><i class="bi bi-building"></i> Referensi Hotel Saudi Arabia — ${chip('Teks', dPlain)} ${chip('Poster', dPoster)}</div>`;
    };

    // [BUGFIX] Sama seperti cxCountMismatchForProgram() -- program lama
    // menyimpan harga Quad di kolom `harga_quint` (tidak ada tipe kamar Quint
    // sungguhan). Tanpa fallback ini baris "Harga Quad" di panel selalu kosong
    // di sisi Teks utk program lama, dan baris "Harga Quint" menampilkan harga
    // Quad tapi dibandingkan ke field poster yang salah (pd.harga_quint,
    // biasanya kosong) -- harga Quad asli jadi tidak pernah tervalidasi ke poster.
    const legacyQuintIsQuad = !adl.harga_quad && !!prog.harga_quint;
    const buildCompareRows = () => {
        const rows = [
            { label: 'Nama Program',  plain: prog.nama,        poster: null, field: 'nama' },
            { label: 'Tanggal',       plain: prog.tgl,         poster: null, field: 'tgl' },
            { label: 'Durasi',        plain: prog.durasi,      poster: null, field: 'durasi' },
            { label: 'Maskapai',      plain: prog.maskapai,    poster: null, field: 'maskapai' },
            { label: 'Harga Quint',   plain: legacyQuintIsQuad ? null : prog.harga_quint, poster: null, field: 'harga_quint' },
            { label: 'Harga Quad',    plain: adl.harga_quad || prog.harga_quint, poster: null, field: 'harga_quad' },
            { label: 'Harga Triple',  plain: adl.harga_triple, poster: null, field: 'harga_triple' },
            { label: 'Harga Double',  plain: adl.harga_double, poster: null, field: 'harga_double' },
            { label: 'Hotel Makkah',  plain: adl.hotel_makkah, poster: null, field: 'hotel_makkah' },
            { label: 'Hotel Madinah', plain: adl.hotel_madinah,poster: null, field: 'hotel_madinah' },
            { label: 'Hotel 3', plain: adl.hotel_3, poster: null, field: 'hotel_3' },
            { label: 'Hotel 4', plain: adl.hotel_4, poster: null, field: 'hotel_4' },
            // [CROSSCHECK] Fasilitas Termasuk/Tidak Termasuk/Catatan -- sebelumnya
            // cuma diisi dari teks broadcast & tidak pernah dibandingkan ke poster.
            { label: 'Fasilitas Termasuk', plain: adl.termasuk,       poster: null, field: 'termasuk' },
            { label: 'Tidak Termasuk',     plain: adl.tidak_termasuk, poster: null, field: 'tidak_termasuk' },
            { label: 'Catatan/Disclaimer', plain: adl.catatan_cx,     poster: null, field: 'catatan_cx' },
        ];
        const pd = (() => { try { return adl.poster_data ? (typeof adl.poster_data === 'string' ? JSON.parse(adl.poster_data) : adl.poster_data) : {}; } catch(e) { return {}; } })();
        rows.forEach(r => { if (pd[r.field]) r.poster = pd[r.field]; });
        // [OPSI B] Kalau field termasuk/tidak_termasuk terstruktur kosong di sisi
        // poster (Gemini gagal memecahnya jadi daftar rapi) tapi teks mentah OCR
        // (_raw_ocr_text) ada, cek tiap item teks admin terhadap raw text sbg
        // sinyal tambahan yang lebih longgar -- ditandai r.rawTextCheck, dipakai
        // cuma untuk tampilan (bukan dihitung ke cxCountMismatchForProgram).
        const rawText = pd._raw_ocr_text || '';
        rows.forEach(r => {
            if (r.poster || !rawText || (r.field !== 'termasuk' && r.field !== 'tidak_termasuk')) return;
            const check = cxCheckListAgainstRawText(r.plain, rawText);
            if (check) r.rawTextCheck = check;
        });
        // List item ditulis satu-per-baris di form (\n) -- dibuat jadi "a · b · c"
        // di tabel bandingan biar rapi 1 baris (CSS tabel ini tidak pre-wrap).
        const displayVal = (r, v) => (r.field === 'termasuk' || r.field === 'tidak_termasuk')
            ? cxNormalizeListItems(v).join(' · ') : v;
        // Sembunyikan baris yang dua-duanya kosong (tidak ada info untuk dibandingkan)
        // Urutkan: yang beda (mismatch) paling atas supaya langsung kelihatan yang perlu dibenerin
        const visibleRows = rows.filter(r => r.plain || r.poster);
        visibleRows.sort((a, b) => {
            // Urutan: 0 = benar-benar mismatch (paling urgent), 0.5 = sinyal
            // "cek manual" dari raw-text fallback, 1 = belum ada salah satu sisi
            // data, 2 = cocok dengan peringatan (rentang tanggal / raw-text cocok
            // longgar), 3 = cocok penuh.
            const rank = r => {
                const hasBoth = r.plain && r.poster;
                if (!hasBoth) {
                    if (r.rawTextCheck) return r.rawTextCheck.notFound.length > 0 ? 0.5 : 2;
                    return 1;
                }
                if (r.field === 'tgl') {
                    const status = cxCompareTgl(r.plain, r.poster);
                    if (status === 'mismatch') return 0;
                    if (status === 'warning') return 2;
                    return 3;
                }
                return cxValuesMatch(r.field, r.plain, r.poster) ? 3 : 0;
            };
            return rank(a) - rank(b);
        });
        if (!visibleRows.length) return '<div class="cx-empty" style="padding:20px;"><p>Belum ada data untuk dibandingkan.</p></div>';
        const headHtml = `<div class="cx-compare-head">
            <div>Field</div>
            <div><i class="bi bi-file-earmark-text-fill"></i> Teks</div>
            <div><i class="bi bi-image-fill"></i> Poster</div>
            <div class="cx-compare-head-status">Status</div>
        </div>`;
        return headHtml + visibleRows.map(r => {
            const hasBoth = r.plain && r.poster;
            // Field 'tgl' punya status ke-3: 'warning' -- tanggal tunggal
            // masih termasuk rentang tanggal poster, dianggap benar tapi
            // ditandai kuning supaya staf sadar itu bukan tanggal persis sama.
            const tglStatus = (hasBoth && r.field === 'tgl') ? cxCompareTgl(r.plain, r.poster) : null;
            const isWarning = tglStatus === 'warning';
            const isMatch = hasBoth && (tglStatus ? tglStatus === 'match' : cxValuesMatch(r.field, r.plain, r.poster));
            const rtNotFound = r.rawTextCheck ? r.rawTextCheck.notFound.length : 0;
            const rowClass = hasBoth
                ? (isWarning ? 'cx-match-warn' : (isMatch ? 'cx-match' : 'cx-mismatch'))
                : (r.rawTextCheck ? (rtNotFound > 0 ? 'cx-match-warn' : 'cx-match') : '');
            const isMismatchRow = (hasBoth && !isWarning && !isMatch) || (!hasBoth && r.rawTextCheck && rtNotFound > 0);
            let pill;
            if (hasBoth) {
                pill = isWarning
                    ? `<span class="cx-match-pill warn" title="Tanggal keberangkatan termasuk dalam rentang poster, tapi bukan tanggal yang persis sama"><i class="bi bi-exclamation-triangle-fill"></i> Cocok (Rentang)</span>`
                    : `<span class="cx-match-pill ${isMatch?'ok':'no'}">${isMatch?'<i class="bi bi-check-lg"></i> Cocok':'<i class="bi bi-x-lg"></i> Beda'}</span>`;
            } else if (r.rawTextCheck) {
                pill = rtNotFound > 0
                    ? `<span class="cx-match-pill warn" title="${rtNotFound} dari ${r.rawTextCheck.total} item tidak ditemukan di teks mentah OCR poster -- cek manual, poster mungkin tidak mencantumkan item ini atau field belum terbaca rapi"><i class="bi bi-question-diamond-fill"></i> Cek Manual</span>`
                    : `<span class="cx-match-pill ok" title="Poster tidak mencantumkan daftar rapi, tapi semua item teks ditemukan di teks mentah hasil OCR"><i class="bi bi-check-lg"></i> Kemungkinan Cocok</span>`;
            } else {
                pill = `<span class="cx-match-pill skip">—</span>`;
            }
            const posterCellVal = r.poster
                ? escapeHtml(displayVal(r, r.poster))
                : (r.rawTextCheck
                    ? `<span style="font-style:italic;">${rtNotFound > 0 ? `${rtNotFound}/${r.rawTextCheck.total} item tidak ditemukan di teks mentah OCR` : 'Semua item ditemukan di teks mentah OCR (bukan daftar rapi poster)'}</span>`
                    : '—');
            // [CROSSCHECK] Daftar fasilitas: tampil sebagai chip, item tak berpasangan = merah.
            const isListField = r.field === 'termasuk' || r.field === 'tidak_termasuk';
            let plainCellHtml = r.plain ? escapeHtml(displayVal(r, r.plain)) : '—';
            let posterCellHtml = posterCellVal;
            if (isListField) {
                const plainLower = cxNormalizeListItems(r.plain);
                const posterLower = cxNormalizeListItems(r.poster);
                if (r.plain) {
                    if (hasBoth) plainCellHtml = cxRenderListChips(r.plain, it => !isMatch && !cxListItemContains(posterLower, it));
                    else if (r.rawTextCheck) { const nf = new Set(r.rawTextCheck.notFound); plainCellHtml = cxRenderListChips(r.plain, it => nf.has(it)); }
                    else plainCellHtml = cxRenderListChips(r.plain, () => false);
                }
                if (r.poster) posterCellHtml = cxRenderListChips(r.poster, it => r.plain ? !cxListItemContains(plainLower, it) : false);
            }
            return `<div class="cx-compare-row ${rowClass}"${isMismatchRow ? ` onclick="cxGoToEditField('${progId}','${r.field}')" title="Klik untuk langsung edit field ini"` : ''}>
                <div class="cx-compare-field">${escapeHtml(r.label)}</div>
                <div class="cx-compare-col"><span class="cx-mobile-tag"><i class="bi bi-file-earmark-text-fill"></i> Teks</span><div class="cx-compare-val ${r.plain?'':'empty'}">${plainCellHtml}</div></div>
                <div class="cx-compare-col cx-compare-col-poster"><span class="cx-mobile-tag"><i class="bi bi-image-fill"></i> Poster</span><div class="cx-compare-val ${(r.poster||r.rawTextCheck)?'':'empty'}">${posterCellHtml}</div></div>
                <div class="cx-compare-status">${pill}</div>
                ${cxHotelRefLine(r.field, r.plain, r.poster)}
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
            ${mismatchCount > 0 ? `<span class="cx-mismatch-count"><i class="bi bi-exclamation-triangle-fill"></i> ${mismatchCount} tidak cocok</span>` : ''}
            ${!hasPoster ? `<button type="button" class="poster-missing-badge" onclick="quickAddPosterLink('${prog.id}')" title="Klik untuk langsung tambahkan link poster program ini"><i class="bi bi-image"></i>Belum ada poster<i class="bi bi-plus-lg"></i></button>` : ''}
            <button class="cx-parse-btn" onclick="openCxEditModal('${prog.id}')"><i class="bi bi-pencil-square"></i> Input Manual</button>
            ${hasPoster ? `<button class="cx-parse-btn" onclick="refreshPosterProgram('${prog.id}')" ${isScanning?'disabled':''} title="Poster di Drive sudah diganti? Muat ulang gambar & scan ulang"><i class="bi bi-arrow-clockwise"></i> Refresh Poster</button>` : ''}
            ${hasPoster ? `<button class="cx-parse-btn" onclick="autoScanPosterForProgram('${prog.id}')" ${isScanning?'disabled':''}><i class="bi ${isScanning?'bi-arrow-repeat bi-spin':'bi-arrow-repeat'}"></i> ${isScanning?'Memindai...':'Scan Ulang Poster'}</button>` : ''}
            ${hasPoster ? `<button class="cx-parse-btn" onclick="window.open('${escapeJsAttr(prog.link_poster)}','_blank')"><i class="bi bi-image-fill"></i> Lihat Poster</button>` : ''}
        </div>
    </div>
    ${isScanning ? `
    <div class="cx-status-bar scanning">
        <i class="bi bi-arrow-repeat bi-spin"></i>
        <div style="flex:1;">
            <div>Membaca poster otomatis dengan AI (OCR)... bisa sampai ±20 detik.</div>
            <div class="cx-ocr-progress-wrap"><div class="cx-ocr-progress-bar" id="cxOcrBar_${progId}" style="width:${cxOcrProgress[progId]||0}%;"></div></div>
        </div>
    </div>` : `
    <div class="cx-status-bar ${mismatchCount > 0 ? 'warn' : (hasAdl ? 'ok' : 'missing')}">
        <i class="bi ${mismatchCount > 0 ? 'bi-exclamation-triangle-fill' : (hasAdl ? 'bi-check-circle-fill' : 'bi-info-circle-fill')}"></i>
        ${mismatchCount > 0
            ? `Ditemukan <b>${mismatchCount} field</b> yang tidak cocok antara data teks & poster.`
            : (hasAdl ? 'Data lengkap tersedia. ' + (adl.poster_data ? 'Data poster sudah terbaca — semua cocok.' : (hasPoster ? 'Poster akan dibaca otomatis saat program disimpan, atau klik Scan Ulang Poster.' : 'Belum ada link poster.')) : 'Belum ada data lengkap.')}
        ${posterSource ? `<span class="cx-source-tag ${posterSource}">${posterSource === 'ocr' ? 'Sumber: OCR otomatis' : 'Sumber: Input manual'}</span>` : ''}
    </div>`}
    ${adl.poster_data ? `
    <div style="margin-top:16px;"></div>
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
        { key: 'hotel_3', label: 'Hotel 3', val: pd.hotel_3 || adl.hotel_3 || '' },
        { key: 'hotel_4', label: 'Hotel 4', val: pd.hotel_4 || adl.hotel_4 || '' },
        // [CROSSCHECK] Fasilitas Termasuk/Tidak Termasuk/Catatan -- multiline, jadi
        // ditandai isList supaya dirender sbg textarea (bukan input satu baris)
        // dan disimpan dalam bentuk yang sama dengan sisi teks (\n per item).
        { key: 'termasuk', label: 'Fasilitas Termasuk', val: pd.termasuk || adl.termasuk || '', isList: true },
        { key: 'tidak_termasuk', label: 'Tidak Termasuk', val: pd.tidak_termasuk || adl.tidak_termasuk || '', isList: true },
        { key: 'catatan_cx', label: 'Catatan/Disclaimer', val: pd.catatan_cx || adl.catatan_cx || '' },
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
                <summary style="cursor:pointer;font-size:12px;font-weight:700;color:var(--brand);"><i class="bi bi-file-earmark-text-fill"></i> Lihat teks mentah hasil OCR</summary>
                <div style="margin-top:8px;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:10px;font-size:11.5px;white-space:pre-wrap;max-height:140px;overflow-y:auto;">${escapeHtml(pd._raw_ocr_text)}</div>
            </details>` : ''}
            <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                ${fields.map(f => `<div class="form-group"${f.isList ? ' style="grid-column:1/-1;"' : ''}><label>${escapeHtml(f.label)}</label>${f.isList
                    ? `<textarea id="cxp_${f.key}" rows="3" placeholder="Satu item per baris...">${escapeHtml(f.val)}</textarea>`
                    : `<input type="text" id="cxp_${f.key}" value="${escapeHtml(f.val)}" placeholder="Dari poster...">`}</div>`).join('')}
            </div>
            <div class="form-actions" style="border-top:none;padding-top:14px;">
                <button class="btn-submit" onclick="saveCxPosterData('${prog.id}')"><i class="bi bi-floppy-fill"></i> Simpan & Bandingkan</button>
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
    const keys = ['nama','tgl','durasi','maskapai','harga_quint','harga_quad','harga_triple','harga_double','hotel_makkah','hotel_madinah','hotel_3','hotel_4','termasuk','tidak_termasuk','catatan_cx'];
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
        showToast('Data poster disimpan — crosscheck siap!');
    } catch (err) {
        showToast('Gagal simpan: ' + err.message, 'error');
    }
}

// withBusy() (app.js): anti klik ganda + spinner. Dibungkus di sini karena fungsinya baru ada setelah modul dimuat.
if (typeof window.saveCxPosterData === 'function') window.saveCxPosterData = withBusy(window.saveCxPosterData);
