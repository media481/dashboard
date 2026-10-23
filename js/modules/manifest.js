// ============================================================
// MODUL LAZY: MANIFEST JAMAAH & EXPORT EXCEL  (js/modules/manifest.js)
// ============================================================
// Dipecah dari js/app.js dan dimuat HANYA saat dibutuhkan (ensureModuleLoaded('manifest') di app.js).
// Dimuat sebagai <script> biasa (BUKAN ES module): satu lingkup global dengan app.js, jadi nama
// fungsi global, onclick="..." dan data-action="..." tidak berubah.
// ATURAN: jangan mendeklarasikan ulang nama yang sudah ada di app.js (const/let ganda = SyntaxError).
// Fungsi yang dirujuk index.html / kode inti SEBELUM modul dimuat didaftarkan di LAZY_MODULES['manifest'].api (app.js).
// ============================================================

// ============================================================
// 19E. MANIFEST JAMAAH — daftar lengkap semua jamaah 1 program dalam satu
// dokumen (landscape, lebar 1123px = A4 landscape), siap diunduh JPEG/PDF
// untuk keperluan submit ke maskapai/imigrasi/Kemenag. Struktur & infrastruktur
// export (captureNotaCanvas, exportNotaElementAsJpeg/Pdf, kop NOTA_TEMA/
// NOTA_PERUSAHAAN) dipakai bareng dengan Tanda Terima Dokumen supaya satu
// identitas visual dengan dokumen lain, cuma beda lebar (manifest = tabel
// banyak kolom, jadi butuh landscape).
// ============================================================
let manifestPending = null; // { program, jamaah, html }

// Urutan & label kolom manifest -- dipisah supaya mudah nambah/kurang kolom
// tanpa harus ubah dua tempat (header <th> & <td> per baris).
const MANIFEST_KOLOM = [
    { key: 'no',       label: 'No',              width: '32px',  align: 'center' },
    { key: 'nama',     label: 'Nama Lengkap',     width: '15%' },
    { key: 'jk',       label: 'L/P',              width: '42px',  align: 'center' },
    { key: 'ttl',      label: 'Tempat, Tgl Lahir',width: '13%' },
    { key: 'nik',      label: 'NIK',              width: '11%' },
    { key: 'paspor',   label: 'No. Paspor',       width: '10%' },
    { key: 'alamat',   label: 'Alamat',           width: '17%' },
    { key: 'wa',       label: 'No. WA',           width: '10%' },
    { key: 'kamar',    label: 'Tipe Kamar',       width: '8%',  align: 'center' },
    { key: 'status',   label: 'Status',           width: '8%',  align: 'center' },
];

function manifestJkSingkat(jk) {
    if (jk === 'Laki-laki') return 'L';
    if (jk === 'Perempuan') return 'P';
    return '-';
}

function manifestStatusLabel(j) {
    if (j.status === 'batal') return { text: 'Batal', warna: NOTA_TEMA.stampRed };
    if (j.status === 'lunas') return { text: 'Lunas', warna: '#279E70' };
    return { text: 'Belum Lunas', warna: NOTA_TEMA.gold };
}

function buildManifestHTML(program, jamaahList) {
    const tglGenerate = tanggalIndonesia(new Date().toISOString().slice(0, 10));

    const theadCells = MANIFEST_KOLOM.map(k => `
        <th style="padding:7px 6px;text-align:${k.align || 'left'};font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;font-weight:700;${k.width ? `width:${k.width};` : ''}">${k.label}</th>
    `).join('');

    const rows = jamaahList.map((j, i) => {
        const ttl = [j.tempat_lahir, j.tgl_lahir ? tanggalIndonesia(j.tgl_lahir) : ''].filter(Boolean).join(', ');
        const st = manifestStatusLabel(j);
        const cellVal = {
            no: i + 1,
            nama: escapeHtml(j.nama || '-'),
            jk: manifestJkSingkat(j.jenis_kelamin),
            ttl: escapeHtml(ttl || '-'),
            nik: escapeHtml(j.nik || '-'),
            paspor: escapeHtml(j.paspor || '-'),
            alamat: escapeHtml(j.alamat || '-'),
            wa: escapeHtml(j.wa || '-'),
            kamar: TIPE_KAMAR_LABEL[j.tipe_kamar] || 'Quad',
            status: `<span style="color:${st.warna};font-weight:700;">${st.text}</span>`,
        };
        const tds = MANIFEST_KOLOM.map(k => `
            <td style="padding:6px;border-bottom:1px solid ${NOTA_TEMA.line};text-align:${k.align || 'left'};font-size:9px;vertical-align:top;">${cellVal[k.key]}</td>
        `).join('');
        return `<tr style="background:${i % 2 === 0 ? '#fff' : NOTA_TEMA.tint};">${tds}</tr>`;
    }).join('');

    const totalL = jamaahList.filter(j => j.jenis_kelamin === 'Laki-laki').length;
    const totalP = jamaahList.filter(j => j.jenis_kelamin === 'Perempuan').length;

    const rekapItem = (label, value) => `
        <div style="flex:1;">
            <div style="font-size:8px;color:${NOTA_TEMA.inkSoft};text-transform:uppercase;letter-spacing:.04em;">${label}</div>
            <div style="font-size:12px;font-weight:700;margin-top:2px;">${value}</div>
        </div>`;

    // Lebar dikunci 1123px (A4 landscape @96dpi) supaya tabel bisa memuat
    // banyak kolom tanpa terlalu sempit, tinggi dibiarkan mengikuti jumlah
    // baris jamaah (bisa jadi sangat panjang untuk program besar -- ini
    // memang dokumen "satu halaman panjang" untuk diunduh/dilihat digital,
    // bukan dokumen cetak fisik multi-halaman A4).
    return `
    <div style="position:relative;width:1123px;background:#fff;font-family:'Inter',Arial,sans-serif;color:#1a1a1a;padding:26px 32px;box-sizing:border-box;border:1px solid ${NOTA_TEMA.line};overflow:hidden;">
        ${buildNotaWatermarkHTML()}

        <div style="position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border-bottom:1.5px solid ${NOTA_TEMA.navy};padding-bottom:9px;margin-bottom:14px;">
            ${buildNotaHeaderHTML()}
            ${buildNotaTitleBarHTML('MANIFEST JAMAAH UMROH', [
                `${escapeHtml(program?.nama || '-')}`,
                `${program?.tgl ? escapeHtml(program.tgl) : ''}`,
                `Dicetak ${escapeHtml(tglGenerate)}`
            ])}
        </div>

        <div style="position:relative;z-index:1;display:flex;gap:14px;padding:8px 0;border-bottom:1px solid ${NOTA_TEMA.line};margin-bottom:12px;">
            ${rekapItem('Total Jamaah', jamaahList.length)}
            ${rekapItem('Laki-laki', totalL)}
            ${rekapItem('Perempuan', totalP)}
            ${rekapItem('Program', escapeHtml(program?.nama || '-'))}
        </div>

        <table style="position:relative;z-index:1;width:100%;border-collapse:collapse;margin-bottom:16px;">
            <thead><tr style="background:${NOTA_TEMA.navy};">${theadCells}</tr></thead>
            <tbody>${rows || `<tr><td colspan="${MANIFEST_KOLOM.length}" style="padding:14px;text-align:center;color:${NOTA_TEMA.inkSoft};font-size:10px;">Belum ada jamaah di program ini</td></tr>`}</tbody>
        </table>

        <div style="position:relative;z-index:1;display:flex;justify-content:flex-end;">
            <div style="width:220px;">
                <div style="position:relative;z-index:1;font-size:8.5px;text-align:center;color:#333;">
                    <div style="margin-bottom:14px;">&nbsp;</div>
                    <div style="border-top:1px solid #999;padding-top:3px;font-weight:600;">Disiapkan oleh,<br>${escapeHtml(getPetugasDisplayName())}</div>
                </div>
            </div>
        </div>

        <div style="position:relative;z-index:1;text-align:left;font-size:7.5px;color:${NOTA_TEMA.inkSoft};margin-top:10px;padding-top:6px;border-top:1px solid ${NOTA_TEMA.line};">
            Manifest ini dibuat otomatis dari data jamaah yang tersimpan di sistem ${escapeHtml(NOTA_PERUSAHAAN.brand)} pada tanggal cetak di atas. Perubahan data jamaah setelahnya tidak otomatis ikut berubah di dokumen ini -- cetak ulang untuk versi terbaru.
        </div>
    </div>`;
}

async function bukaManifestProgram(btn) {
    if (!kbSelectedProgram) { showToast('Pilih program dulu', 'error'); return; }
    const originalIcon = btn ? btn.innerHTML : null;
    if (btn) { btn.innerHTML = '<i class="bi bi-arrow-repeat bi-spin"></i>'; btn.disabled = true; }
    try {
        const program = dataUmroh.find(p => String(p.id) === String(kbSelectedProgram)) || null;
        const { data, error } = await supabaseClient.from('kb_jamaah').select('*').eq('program_id', kbSelectedProgram).eq('diarsipkan', false).order('nama', { ascending: true });
        if (error) throw error;

        const html = buildManifestHTML(program, data || []);
        manifestPending = { program, jamaah: data || [], html };

        const modal = document.getElementById('manifestModal');
        renderScaledNotaInto(document.getElementById('manifestPreviewContent'), html);
        modal.classList.add('open');
    } catch (err) {
        console.error('Buka Manifest error:', err);
        showToast('Gagal memuat data manifest: ' + (err?.message || err), 'error');
    } finally {
        if (btn) { btn.innerHTML = originalIcon; btn.disabled = false; }
    }
}

function tutupManifestModal() {
    const modal = document.getElementById('manifestModal');
    if (modal) modal.classList.remove('open');
    const content = document.getElementById('manifestPreviewContent');
    if (content) content.innerHTML = '';
    manifestPending = null;
    closeNotaLightbox();
}

async function unduhManifest(format, btn) {
    if (!manifestPending) return;
    const { program, html } = manifestPending;
    const namaProgram = (program?.nama || 'Program').replace(/[^a-zA-Z0-9]+/g, '-');
    const exportFn = format === 'pdf' ? exportNotaElementAsPdf : exportNotaElementAsJpeg;
    const ext = format === 'pdf' ? 'pdf' : 'jpg';
    await exportFn(html, `Manifest-${namaProgram}.${ext}`, btn);
}


// [SHORTCUT PROFIL PERUSAHAAN] Unduh PDF Manifest satu program langsung (tanpa membuka modal preview).
// Data & tampilan sama persis dengan bukaManifestProgram() + unduhManifest('pdf').
async function unduhManifestPdfProgram(programId, btn) {
    if (!programId) { showToast('Pilih program dulu', 'error'); return; }
    const program = dataUmroh.find(p => String(p.id) === String(programId)) || null;
    if (!program) { showToast('Program tidak ditemukan', 'error'); return; }
    try {
        const { data, error } = await supabaseClient.from('kb_jamaah').select('*').eq('program_id', programId).eq('diarsipkan', false).order('nama', { ascending: true });
        if (error) throw error;
        if (!data || !data.length) { showToast('Belum ada jamaah untuk program ini', 'error'); return; }
        const namaProgram = (program.nama || 'Program').replace(/[^a-zA-Z0-9]+/g, '-');
        await exportNotaElementAsPdf(buildManifestHTML(program, data), `Manifest-${namaProgram}.pdf`, btn);
    } catch (err) {
        console.error('Unduh Manifest PDF error:', err);
        showToast('Gagal memuat data manifest: ' + (err?.message || err), 'error');
    }
}

window.addEventListener('resize', () => {
    const manifestModal = document.getElementById('manifestModal');
    if (manifestModal && manifestModal.classList.contains('open')) fitScaleInto(document.getElementById('manifestPreviewContent'));
});

// ============================================================
// 19E2. EXPORT EXCEL — Data Jamaah per program (.xlsx via SheetJS).
// Beda dari Manifest/Rooming List (yang untuk dicetak/dibagikan sebagai
// dokumen final): ini untuk kebutuhan olah data lanjutan admin di Excel
// (rekap manual, dikirim ke pihak lain, dsb) -- semua kolom mentah + kolom
// hitungan (tagihan/dibayar/sisa) disertakan, bukan cuma yang tampil di tabel.
// ============================================================
async function exportJamaahExcel(btn) {
    if (!kbSelectedProgram) { showToast('Pilih program dulu', 'error'); return; }
    if (typeof XLSX === 'undefined') {
        try { await ensureLibLoaded('xlsx'); }
        catch (_) { showToast('Modul Excel gagal dimuat — periksa koneksi internet lalu coba lagi', 'error'); return; }
    }
    const originalIcon = btn ? btn.innerHTML : null;
    if (btn) { btn.innerHTML = '<i class="bi bi-arrow-repeat bi-spin"></i>'; btn.disabled = true; }
    try {
        const program = dataUmroh.find(p => String(p.id) === String(kbSelectedProgram)) || null;
        const { data: jamaah, error } = await supabaseClient.from('kb_jamaah')
            .select('*').eq('program_id', kbSelectedProgram).eq('diarsipkan', false).order('nama', { ascending: true });
        if (error) throw error;
        if (!jamaah || !jamaah.length) { showToast('Belum ada jamaah untuk program ini', 'error'); return; }

        const totalPerJamaah = await fetchTotalBayar({ programId: kbSelectedProgram });

        const kepulanganLabel = { belum_berangkat: 'Belum Berangkat', sudah_berangkat: 'Sudah Berangkat', sudah_pulang: 'Sudah Pulang', batal: 'Batal / No-show' };
        const programStatusKepulangan = (program && program.status_kepulangan) || 'belum_berangkat';

        const rows = jamaah.map(j => {
            const hargaProgram = parseRupiahToNumber(j.harga_custom) > 0 ? parseRupiahToNumber(j.harga_custom) : parseRupiahToNumber(program ? program.harga_quint : 0);
            const dibayar = totalPerJamaah[j.id] || 0;
            const sisa = Math.max(hargaProgram - dibayar, 0);
            let statusBayar;
            if (j.status === 'batal') statusBayar = 'Batal';
            else if (hargaProgram > 0 && dibayar >= hargaProgram) statusBayar = 'Lunas';
            else if (dibayar > 0) statusBayar = 'Cicilan';
            else statusBayar = 'Belum Bayar';

            return {
                'Nama': j.nama || '',
                'NIK': j.nik || '',
                'No. Paspor': j.paspor || '',
                'Berlaku Paspor s/d': j.paspor_exp || '',
                'Jenis Kelamin': j.jenis_kelamin === 'L' ? 'Laki-laki' : (j.jenis_kelamin === 'P' ? 'Perempuan' : ''),
                'Tempat Lahir': j.tempat_lahir || '',
                'Tgl Lahir': j.tgl_lahir || '',
                'Alamat': j.alamat || '',
                'Kode Pos': j.kode_pos || '',
                'Asal Kota': j.asal || '',
                'No. WhatsApp': j.wa || '',
                'Telp Rumah': j.telp_rumah || '',
                'Nama Ahli Waris': j.ahli_waris_nama || '',
                'Hubungan Ahli Waris': j.ahli_waris_hubungan || '',
                'Tipe Kamar': TIPE_KAMAR_LABEL[j.tipe_kamar] || 'Quad',
                'No. Kamar': j.nomor_kamar || '',
                'Harga Program (Rp)': hargaProgram,
                'Total Dibayar (Rp)': dibayar,
                'Sisa Tagihan (Rp)': sisa,
                'Status Pembayaran': statusBayar,
                'Status Visa': (VISA_STATUS_LABEL[j.visa_status || 'belum_diajukan'] || {}).label || '',
                'Status Kepulangan': kepulanganLabel[programStatusKepulangan] || '',
                'Catatan': j.catatan || ''
            };
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: Math.min(Math.max(k.length, 12), 30) }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Data Jamaah');

        const namaProgram = (program?.nama || 'Program').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 60);
        XLSX.writeFile(wb, `Data-Jamaah-${namaProgram}.xlsx`);
        showToast(`✅ Export Excel berhasil — ${rows.length} jamaah`);
    } catch (err) {
        console.error('exportJamaahExcel error:', err);
        showToast('Gagal export Excel: ' + (err?.message || err), 'error');
    } finally {
        if (btn) { btn.innerHTML = originalIcon; btn.disabled = false; }
    }
}

// Export Excel — Riwayat Pembayaran & Cicilan per program. Beda dari
// exportJamaahExcel (satu baris = satu jamaah, angka sudah dijumlah): ini
// satu baris = satu transaksi bayar/cicil (dari pembayaran_jamaah), supaya
// bisa dicek histori tanggal & metode bayarnya satu-satu, bukan cuma total.
async function exportPembayaranExcel(btn) {
    if (!kbSelectedProgram) { showToast('Pilih program dulu', 'error'); return; }
    if (typeof XLSX === 'undefined') {
        try { await ensureLibLoaded('xlsx'); }
        catch (_) { showToast('Modul Excel gagal dimuat — periksa koneksi internet lalu coba lagi', 'error'); return; }
    }
    const originalIcon = btn ? btn.innerHTML : null;
    if (btn) { btn.innerHTML = '<i class="bi bi-arrow-repeat bi-spin"></i>'; btn.disabled = true; }
    try {
        const program = dataUmroh.find(p => String(p.id) === String(kbSelectedProgram)) || null;
        const { data: jamaah, error } = await supabaseClient.from('kb_jamaah')
            .select('id, nama, nik').eq('program_id', kbSelectedProgram).eq('diarsipkan', false).order('nama', { ascending: true });
        if (error) throw error;
        if (!jamaah || !jamaah.length) { showToast('Belum ada jamaah untuk program ini', 'error'); return; }

        const jamaahById = {};
        jamaah.forEach(j => { jamaahById[j.id] = j; });
        const jamaahIds = jamaah.map(j => j.id);

        const { data: bayar, error: bErr } = await supabaseClient
            .from('pembayaran_jamaah').select('*').in('jamaah_id', jamaahIds).order('tanggal', { ascending: true });
        if (bErr) throw bErr;
        if (!bayar || !bayar.length) { showToast('Belum ada transaksi pembayaran untuk program ini', 'error'); return; }

        const rows = bayar.map(b => {
            const j = jamaahById[b.jamaah_id] || {};
            return {
                'Nama Jamaah': j.nama || '(jamaah tidak ditemukan)',
                'NIK': j.nik || '',
                'Tanggal Bayar': b.tanggal || '',
                'Jumlah (Rp)': Number(b.jumlah || 0),
                'Metode': b.metode || '',
                'No. Kuitansi': b.nomor_kuitansi || '',
                'No. Nota': b.nomor_nota || '',
                'Keterangan': b.keterangan || '',
                'Dicatat Pada': b.created_at ? new Date(b.created_at).toLocaleString('id-ID') : ''
            };
        });
        const totalSemua = rows.reduce((s, r) => s + Number(r['Jumlah (Rp)'] || 0), 0);
        rows.push({
            'Nama Jamaah': '', 'NIK': '', 'Tanggal Bayar': '', 'Jumlah (Rp)': totalSemua, 'Metode': '',
            'No. Kuitansi': '', 'No. Nota': '', 'Keterangan': 'TOTAL SEMUA TRANSAKSI', 'Dicatat Pada': ''
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: Math.min(Math.max(k.length, 12), 28) }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Pembayaran & Cicilan');

        const namaProgram = (program?.nama || 'Program').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 60);
        XLSX.writeFile(wb, `Pembayaran-Cicilan-${namaProgram}.xlsx`);
        showToast(`✅ Export Pembayaran berhasil — ${bayar.length} transaksi`);
    } catch (err) {
        console.error('exportPembayaranExcel error:', err);
        showToast('Gagal export pembayaran: ' + (err?.message || err), 'error');
    } finally {
        if (btn) { btn.innerHTML = originalIcon; btn.disabled = false; }
    }
}
