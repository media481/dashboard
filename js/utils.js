    // ========== FUNGSI UTAMA ==========
    function parseDateFromString(dateStr) {
        if (!dateStr) return new Date();
        const months = {'Januari':0,'Februari':1,'Maret':2,'April':3,'Mei':4,'Juni':5,'Juli':6,'Agustus':7,'September':8,'Oktober':9,'November':10,'Desember':11};
        for (const [month, idx] of Object.entries(months))
            if (dateStr.includes(month)) {
                const parts = dateStr.split(' ');
                let day = parseInt(parts[0]), year = parseInt(parts[2]);
                if (isNaN(day)) day = parseInt(parts[0].replace(/^0+/, ''));
                return new Date(year, idx, day);
            }
        return new Date(dateStr);
    }

    function formatDateToIndonesian(date) {
        if (!date || isNaN(date.getTime())) return '';
        const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
        return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
    }

    function generateAutoWAText(data) {
        const s = v => (v || '').replace(/javascript:/gi, 'blocked:');

        // Judul
        let teks = `🌟 *${s(data.nama || 'PROGRAM UMROH').toUpperCase()}* 🌟\n`;
        teks += `    Bersama Amiru Tour\n`;

        // Tanggal & durasi
        const durasi = data.durasi ? data.durasi.replace(/\s*hari/i,'').trim() : '';
        if (data.tgl && durasi) teks += `📅 Berangkat ${s(data.tgl)} (${durasi} Hari)\n`;
        else if (data.tgl) teks += `📅 Berangkat ${s(data.tgl)}\n`;

        // Maskapai
        if (data.maskapai) teks += `✈️ ${s(data.maskapai)}\n`;

        // Program wisata (dari field atau kosong)
        if (data.program_wisata) teks += `🕌 Program: ${s(data.program_wisata)}\n`;

        // Hotel
        const hotelLines = [];
        if (data.hotel_madinah) {
            const jarakMadinah = data.hotel_madinah_jarak || '';
            hotelLines.push(`* Madinah ${data.hotel_madinah_hari||''}${data.hotel_madinah_hari?'D':''}: ${s(data.hotel_madinah)}${jarakMadinah ? ' ('+jarakMadinah+')' : ''}`);
        }
        if (data.hotel_makkah) {
            const jarakMakkah = data.hotel_makkah_jarak || '';
            hotelLines.push(`* Mekah ${data.hotel_makkah_hari||''}${data.hotel_makkah_hari?'D':''}: ${s(data.hotel_makkah)}${jarakMakkah ? ' ('+jarakMakkah+')' : ''}`);
        }
        if (hotelLines.length) {
            teks += `🏨 Hotel Dekat & Strategis:\n${hotelLines.join('\n')}\n`;
        }

        // Harga
        const hargaLines = [];
        if (data.harga_quad)   hargaLines.push(`* Quad ${formatHargaJuta(data.harga_quad)}`);
        if (data.harga_triple) hargaLines.push(`* Triple ${formatHargaJuta(data.harga_triple)}`);
        if (data.harga_double) hargaLines.push(`* Double ${formatHargaJuta(data.harga_double)}`);
        if (!hargaLines.length && data.harga_quint) hargaLines.push(`* Quad ${formatHargaJuta(data.harga_quint)}`);
        if (hargaLines.length) {
            teks += `💰 Harga Paket Start Jakarta:\n${hargaLines.join('\n')}\n`;
        }

        // Termasuk
        const termasukList = data.termasuk
            ? data.termasuk.split('\n').map(i=>i.trim()).filter(Boolean)
            : ['Tiket Pesawat PP', 'Visa Umroh', 'Fullboard Hotel', 'Perlengkapan Dasar', 'Handling Bandara', 'Asuransi', 'Zamzam 5L'];
        teks += `✅ Termasuk: ${termasukList.join(', ')}\n`;

        // Tidak termasuk
        const tidakList = data.tidak_termasuk
            ? data.tidak_termasuk.split('\n').map(i=>i.trim()).filter(Boolean)
            : ['Paspor', 'Vaksin', 'Tiket Domestik', 'Hotel Transit', 'Pengeluaran pribadi'];
        teks += `❌ Tidak termasuk: ${tidakList.join(', ')}\n`;

        // Footer
        teks += `📞 Info & Itinerary:\nwa.me/6285122336300\nwa.me/6285196241819`;

        return teks;
    }

    function formatHargaJuta(hargaStr) {
        // Input: "Rp 28.950.000" atau "28950000" → output: "Rp28,95 jt"
        if (!hargaStr) return '';
        const num = parseInt(String(hargaStr).replace(/[^\d]/g, ''));
        if (!num) return hargaStr;
        const juta = num / 1000000;
        // Format: hilangkan desimal nol (30.5 jt, bukan 30.50 jt)
        const formatted = juta % 1 === 0 ? juta.toFixed(0) : juta.toFixed(2).replace(/\.?0+$/, '');
        return `Rp${formatted} jt`;
    }

    function escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]); }
    function showToast(msg) { const t = document.getElementById('toast'); t.innerHTML = '<i class="fas fa-check"></i> '; const span = document.createElement('span'); span.textContent = msg; t.appendChild(span); t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); }

    // ===== SKELETON LOADER =====
    function renderSkeleton(rows = 6) {
        const tbody = document.getElementById('skeletonBody');
        if (!tbody) return;
        tbody.innerHTML = Array.from({length: rows}, () => `
            <tr>
                <td><span class="sk sk-name"></span><span class="sk sk-badge"></span></td>
                <td><span class="sk sk-price"></span><span class="sk sk-price-sub"></span></td>
                <td><span class="sk sk-date"></span></td>
                <td><span class="sk sk-dur"></span></td>
                <td><span class="sk sk-airline"></span></td>
                <td><div class="sk-icons"><span class="sk sk-icon"></span><span class="sk sk-icon"></span><span class="sk sk-icon"></span></div></td>
                <td><span class="sk sk-status"></span></td>
            </tr>`).join('');
    }

    // Database dengan CACHE
