    // ===== PARSE BROADCAST TEXT =====
    window.parseBroadcastText = function() {
        const raw = document.getElementById('parseBroadcastInput').value.trim();
        if (!raw) { showToast('Paste teks broadcast dulu'); return; }

        const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
        const clean = s => s.replace(/^\*+|\*+$/g, '').trim();
        const cleanAll = s => s.replace(/\*/g, '').trim();

        // Nama: baris pertama bold *...*
        let nama = '';
        for (const l of lines) {
            if (/^\*.+\*$/.test(l)) { nama = clean(l); break; }
        }
        if (!nama) nama = clean(lines[0]);

        // Durasi: "Program X hari"
        let durasi = '';
        for (const l of lines) {
            const m = l.match(/program\s+(\d+)\s*hari/i) || l.match(/^(\d+)\s*hari/i);
            if (m) { durasi = m[1] + ' Hari'; break; }
        }

        // Maskapai: baris setelah *PESAWAT*
        let maskapai = '';
        for (let i = 0; i < lines.length - 1; i++) {
            if (/pesawat/i.test(clean(lines[i]))) { maskapai = clean(lines[i + 1]); break; }
        }

        // === HARGA SEMUA TIPE ===
        const parseHarga = (txt) => {
            const m = txt.replace(/\./g,'').match(/(\d{5,})/);
            return m ? 'Rp ' + parseInt(m[1]).toLocaleString('id-ID') : '';
        };

        let harga_quint = '', harga_quad = '', harga_triple = '', harga_double = '';
        for (const l of lines) {
            const lc = l.toLowerCase();
            if (/qu[ai]n[dt]|quint/i.test(lc)) {
                if (!harga_quint) harga_quint = parseHarga(l);
            } else if (/qu[ao]r[da]|quad/i.test(lc)) {
                if (!harga_quad) harga_quad = parseHarga(l);
            } else if (/triple|tripel/i.test(lc)) {
                if (!harga_triple) harga_triple = parseHarga(l);
            } else if (/double|dbl/i.test(lc)) {
                if (!harga_double) harga_double = parseHarga(l);
            }
        }
        // Jika tidak ada Quint, ambil harga termurah yang ada sebagai harga publik (harga_quint)
        // Urutan termurah: quint < quad < triple < double
        if (!harga_quint) {
            harga_quint = harga_quad || harga_triple || harga_double;
        }

        // Tanggal: cari format "DD - DD Bulan YYYY" atau "DD Bulan YYYY"
        let tglISO = '';
        const BULAN = {januari:'01',februari:'02',maret:'03',april:'04',mei:'05',juni:'06',juli:'07',agustus:'08',september:'09',oktober:'10',november:'11',desember:'12'};
        for (const l of lines) {
            let m = l.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
            if (m) {
                const bln = BULAN[m[3].toLowerCase()];
                if (bln) { tglISO = m[4] + '-' + bln + '-' + m[2].padStart(2,'0'); break; }
            }
            m = l.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
            if (m) {
                const bln = BULAN[m[2].toLowerCase()];
                if (bln) { tglISO = m[3] + '-' + bln + '-' + m[1].padStart(2,'0'); break; }
            }
        }

        // === PROGRAM WISATA ===
        // Contoh: "2D1N Dubai City Tour" atau "Old Town & Elephant Rock Al Ula"
        let program_wisata = '';
        for (const l of lines) {
            // Baris yang mengandung pola wisata (city tour, dsb) tapi bukan harga/hotel
            if (/\d+D\d+N|\d+H\d+M|city tour|old town|elephant rock|wisata|tour/i.test(l) && !/hotel|harga|biaya|visa|pesawat/i.test(l)) {
                const pw = cleanAll(l);
                if (pw.length > 3) { program_wisata = (program_wisata ? program_wisata + ' + ' : '') + pw; }
            }
        }

        // === HOTEL ===
        // Format broadcast: "*HOTEL MEKAH 4H*" (header), baris berikut = nama hotel
        // Variasi: Makkah / Mekkah / Mekah / Makkah, bisa ada "3H" / "4H" / "5H" setelah nama kota
        let hotel_makkah = '', hotel_madinah = '';
        let hotel_makkah_hari = '', hotel_madinah_hari = '';
        let hotel_makkah_jarak = '', hotel_madinah_jarak = '';
        const isMakkahHeader = s => /hotel\s*m[ae]k+ah/i.test(s);
        const isMadinahHeader = s => /hotel\s*mad[iy]nah/i.test(s);
        // Helper: ekstrak info jarak dari baris (misal "(750m 10 menit jalan kaki)" atau baris berikutnya)
        const parseJarak = (txt) => {
            const m = txt.match(/\(([^)]*(?:m|km|meter)[^)]*)\)/i) || txt.match(/(\d+\s*m[^,\n]*(?:jalan|menit)[^,\n]*)/i);
            return m ? m[1].trim() : '';
        };
        // Helper: ekstrak jumlah hari dari header hotel (misal "4H" → "4")
        const parseHariHotel = (txt) => {
            const m = txt.match(/(\d+)\s*[Hh]/);
            return m ? m[1] : '';
        };
        for (let i = 0; i < lines.length; i++) {
            const lc = cleanAll(lines[i]).toLowerCase();
            const rawLine = lines[i];
            // Inline: "Hotel Makkah : Hilton xxx" atau "Hotel Mekah 4H : Hilton"
            const mMakkahInline = rawLine.match(/hotel\s*m[ae]k+ah([^:]*)[:\-]\s*(.+)/i);
            if (mMakkahInline && !hotel_makkah) {
                hotel_makkah = cleanAll(mMakkahInline[2]);
                hotel_makkah_hari = parseHariHotel(mMakkahInline[1]);
                continue;
            }
            const mMadinahInline = rawLine.match(/hotel\s*mad[iy]nah([^:]*)[:\-]\s*(.+)/i);
            if (mMadinahInline && !hotel_madinah) {
                hotel_madinah = cleanAll(mMadinahInline[2]);
                hotel_madinah_hari = parseHariHotel(mMadinahInline[1]);
                continue;
            }
            // Header baris terpisah: baris berikut = nama hotel
            if (isMakkahHeader(lc) && !hotel_makkah && i+1 < lines.length) {
                hotel_makkah_hari = parseHariHotel(lc);
                hotel_makkah = cleanAll(lines[i+1]);
                // Cek baris setelah nama hotel untuk jarak
                if (i+2 < lines.length) hotel_makkah_jarak = parseJarak(lines[i+2]);
                continue;
            }
            if (isMadinahHeader(lc) && !hotel_madinah && i+1 < lines.length) {
                hotel_madinah_hari = parseHariHotel(lc);
                hotel_madinah = cleanAll(lines[i+1]);
                if (i+2 < lines.length) hotel_madinah_jarak = parseJarak(lines[i+2]);
                continue;
            }
            // Baris jarak standalone setelah hotel sudah diisi (misal "(750m 10 menit jalan kaki)")
            if (hotel_makkah && !hotel_makkah_jarak) { const j = parseJarak(rawLine); if(j) hotel_makkah_jarak = j; }
            if (hotel_madinah && !hotel_madinah_jarak) { const j = parseJarak(rawLine); if(j) hotel_madinah_jarak = j; }
        }

        // === MAKAN ===
        let makan_makkah = '', makan_madinah = '';
        for (const l of lines) {
            const lc = l.toLowerCase();
            const mMakkah = l.match(/makan(?:an)?\s*m[ae]k+ah[^:]*[:\-]\s*(.+)/i);
            if (mMakkah && !makan_makkah) { makan_makkah = cleanAll(mMakkah[1]); continue; }
            const mMadinah = l.match(/makan(?:an)?\s*mad[iy]nah[^:]*[:\-]\s*(.+)/i);
            if (mMadinah && !makan_madinah) { makan_madinah = cleanAll(mMadinah[1]); continue; }
            // "FullBoard" atau "3x Sehari" di dalam fasilitas
            if (/fullboard|full\s*board/i.test(lc)) {
                if (!makan_makkah) makan_makkah = 'FullBoard';
                if (!makan_madinah) makan_madinah = 'FullBoard';
            }
            if (/makan|konsumsi/i.test(lc)) {
                const m3x = l.match(/(\d+\s*[xX]\s*(?:sehari|makan))/i);
                if (m3x) { if (!makan_makkah) makan_makkah = m3x[1]; else if (!makan_madinah) makan_madinah = m3x[1]; }
            }
        }

        // === FASILITAS TERMASUK & TIDAK TERMASUK ===
        // Format broadcast: item diawali "*" (bukan bullet), header "Biaya Sudah Termasuk" / "BIAYA BELUM TERMASUK"
        let termasuk = [], tidak_termasuk = [];
        let mode = null;
        for (const l of lines) {
            const lc = cleanAll(l).toLowerCase();
            // Deteksi header section — cek "tidak termasuk" dulu (lebih spesifik)
            if (/tidak\s*termasuk|belum\s*termasuk|not\s*include/i.test(lc)) { mode = 'tidak'; continue; }
            if (/sudah\s*termasuk|biaya\s*termasuk|^termasuk$|include|fasilitas/i.test(lc)) { mode = 'termasuk'; continue; }
            if (!mode) continue;
            // Item diawali: *, -, •, ✓, angka., atau baris yang diawali bintang tunggal (format broadcast)
            const isItem = /^\*[^*]/.test(l) || /^[-•✓✈🕌🚌🍽️★]/.test(l) || /^\d+\./.test(l);
            if (isItem) {
                // Bersihkan: hapus * di awal/akhir, simbol bullet
                const item = l.replace(/^\*+/, '').replace(/\*+$/, '').replace(/^[-•✓✈🕌🚌🍽️★]\s*/, '').replace(/^\d+\.\s*/, '').trim();
                if (item && item.length > 1) {
                    if (mode === 'termasuk') termasuk.push(item);
                    else tidak_termasuk.push(item);
                }
            }
        }

        // Cocokkan maskapai ke select option
        const sel = document.getElementById('admin_maskapai');
        if (sel && maskapai) {
            const opts = Array.from(sel.options);
            const kata = maskapai.toLowerCase().split(' ')[0];
            const found = opts.find(o => o.value.toLowerCase().includes(kata));
            if (found) sel.value = found.value;
        }

        // Isi form publik
        if (nama)   document.getElementById('admin_nama').value = nama;
        if (durasi) document.getElementById('admin_durasi').value = durasi;
        if (harga_quint)  document.getElementById('admin_harga_quint').value = harga_quint;
        if (tglISO) {
            const tglInput = document.getElementById('admin_tgl_date');
            if (tglInput) { tglInput.value = tglISO; tglInput.dispatchEvent(new Event('change')); }
        }
        // Generate teks WA dengan format baru
        const parsedData = {
            nama,
            tgl: (() => { for (const l of lines) { if (/\d{1,2}\s*[-\u2013]\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}/.test(l)) return cleanAll(l); if (/\d{1,2}\s+[A-Za-z]+\s+\d{4}/.test(l)) return cleanAll(l); } return ''; })(),
            durasi, maskapai,
            harga_quad, harga_triple, harga_double, harga_quint,
            hotel_makkah, hotel_madinah,
            hotel_makkah_hari, hotel_madinah_hari,
            hotel_makkah_jarak, hotel_madinah_jarak,
            program_wisata,
            termasuk: termasuk.join('\n'),
            tidak_termasuk: tidak_termasuk.join('\n')
        };
        document.getElementById('admin_teks_wa').value = generateAutoWAText(parsedData);

        // Isi field admin-only
        const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
        setVal('admin_harga_quad', harga_quad);
        setVal('admin_harga_triple', harga_triple);
        setVal('admin_harga_double', harga_double);
        setVal('admin_hotel_makkah', hotel_makkah);
        setVal('admin_hotel_madinah', hotel_madinah);
        setVal('admin_makan_makkah', makan_makkah);
        setVal('admin_makan_madinah', makan_madinah);
        if (termasuk.length) setVal('admin_termasuk', termasuk.join('\n'));
        if (tidak_termasuk.length) setVal('admin_tidak_termasuk', tidak_termasuk.join('\n'));

        // Status
        const parts = [];
        if (nama) parts.push('Nama');
        if (durasi) parts.push('Durasi');
        if (maskapai) parts.push('Maskapai');
        if (harga_quint) parts.push('Harga Quint');
        if (harga_quad) parts.push('Quad');
        if (harga_triple) parts.push('Triple');
        if (harga_double) parts.push('Double');
        if (hotel_makkah) parts.push('Hotel Makkah');
        if (hotel_madinah) parts.push('Hotel Madinah');
        if (tglISO) parts.push('Tanggal');
        if (termasuk.length) parts.push('Fasilitas (' + termasuk.length + ' item)');

        const status = document.getElementById('parseStatus');
        status.textContent = '\u2713 Terisi: ' + parts.join(', ');
        status.style.display = 'inline';
        setTimeout(() => status.style.display = 'none', 6000);
        showToast('Form berhasil diisi otomatis (' + parts.length + ' field)');
    };
    window.resetSearch=resetSearch;window.openAdminModal=openAdminModal;window.closeAdminModal=closeAdminModal;window.checkAdminLogin=checkAdminLogin;window.logoutAdmin=logoutAdmin;window.showAdminForm=showAdminForm;window.hideAdminForm=hideAdminForm;window.saveAdminProgram=saveAdminProgram;window.editAdminProgram=editAdminProgram;window.duplicateAdminProgram=duplicateAdminProgram;window.deleteAdminProgram=deleteAdminProgram;window.clearAllAdminData=clearAllAdminData;window.exportAdminData=exportAdminData;window.importAdminData=importAdminData;window.previewAdminWA=previewAdminWA;window.sortAdminTable=sortAdminTable;window.openDetailModal=openDetailModal;window.closeDetailModal=closeDetailModal;window.copyDetailWAText=copyDetailWAText;

    function showCsLockWarning() { showToast('🔒 Fitur ini hanya untuk Administrator'); }
    window.showCsLockWarning = showCsLockWarning;

