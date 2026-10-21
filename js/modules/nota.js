// ============================================================
// MODUL LAZY: NOTA PEMBAYARAN / KUITANSI  (js/modules/nota.js)
// ============================================================
// Dipecah dari js/app.js dan dimuat HANYA saat dibutuhkan (ensureModuleLoaded('nota') di app.js).
// Dimuat sebagai <script> biasa (BUKAN ES module): satu lingkup global dengan app.js, jadi nama
// fungsi global, onclick="..." dan data-action="..." tidak berubah.
// ATURAN: jangan mendeklarasikan ulang nama yang sudah ada di app.js (const/let ganda = SyntaxError).
// Fungsi yang dirujuk index.html / kode inti SEBELUM modul dimuat didaftarkan di LAZY_MODULES['nota'].api (app.js).
//
// Isi: pembangun HTML nota (pembayaran, riwayat lengkap, kuitansi legacy), tema nota, terbilang, tanggalIndonesia,
// render ke canvas + export JPEG/PDF, panel preview (+ preview live), unduh nota.
// DIPAKAI SINKRON oleh modul kepulangan, manifest, rooming, dan audit-nota -> modul-modul itu memakai
// deps: ['nota'] di LAZY_MODULES supaya file ini sudah termuat lebih dulu.
// SENGAJA tetap di app.js: NOTA_PERUSAHAAN + Profil Perusahaan, nomorNota(), nomorKuitansiTampilan(), lightbox nota
// (openNotaLightbox, closeNotaLightbox, fitNotaLightboxScale), hideNotaPreviewPanel(), state notaPreviewPending,
// logNotaAudit()/sha256Hex()/getPetugasNama() (pencatatan audit), fetchNextKuitansiNomorValue().
// ============================================================

const TERBILANG_SATUAN = ['', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan', 'Sepuluh', 'Sebelas'];

function angkaKeTerbilang(n) {
    n = Math.floor(Math.abs(Number(n) || 0));
    if (n < 12) return TERBILANG_SATUAN[n];
    if (n < 20) return angkaKeTerbilang(n - 10) + ' Belas';
    if (n < 100) return angkaKeTerbilang(Math.floor(n / 10)) + ' Puluh' + (n % 10 ? ' ' + angkaKeTerbilang(n % 10) : '');
    if (n < 200) return 'Seratus' + (n % 100 ? ' ' + angkaKeTerbilang(n % 100) : '');
    if (n < 1000) return angkaKeTerbilang(Math.floor(n / 100)) + ' Ratus' + (n % 100 ? ' ' + angkaKeTerbilang(n % 100) : '');
    if (n < 2000) return 'Seribu' + (n % 1000 ? ' ' + angkaKeTerbilang(n % 1000) : '');
    if (n < 1000000) return angkaKeTerbilang(Math.floor(n / 1000)) + ' Ribu' + (n % 1000 ? ' ' + angkaKeTerbilang(n % 1000) : '');
    if (n < 1000000000) return angkaKeTerbilang(Math.floor(n / 1000000)) + ' Juta' + (n % 1000000 ? ' ' + angkaKeTerbilang(n % 1000000) : '');
    return angkaKeTerbilang(Math.floor(n / 1000000000)) + ' Miliar' + (n % 1000000000 ? ' ' + angkaKeTerbilang(n % 1000000000) : '');
}

function rupiahTerbilang(n) {
    const val = Math.floor(Math.abs(Number(n) || 0));
    if (!val) return 'Nol Rupiah';
    return (angkaKeTerbilang(val) + ' Rupiah').replace(/\s+/g, ' ').trim();
}

function tanggalIndonesia(isoDate) {
    if (!isoDate) return '-';
    const bulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const d = new Date(isoDate + 'T00:00:00');
    if (isNaN(d.getTime())) return isoDate;
    return `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
}

// Palet & skala font institusional dipakai konsisten di kedua jenis nota
// supaya terasa satu identitas resmi (kop surat lembaga/bank).
const NOTA_TEMA = {
    navy: '#1a355b',
    navyDeep: '#0f2138',
    gold: '#b8935a',
    tint: '#eef2f7',
    line: '#d7dfe9',
    inkSoft: '#64758A',
    stampRed: '#b3372c'
};

const NOTA_KODE_PREVIEW = '__PREVIEW__';

function notaKodeVerifikasiFooterHTML(kodeVerifikasi) {
    if (kodeVerifikasi === NOTA_KODE_PREVIEW) {
        return `<span style="letter-spacing:.02em;color:${NOTA_TEMA.inkSoft};font-style:italic;"> &middot; Kode Verifikasi akan dibuat &amp; dicatat ke sistem audit saat nota ini diunduh</span>`;
    }
    if (kodeVerifikasi) {
        return `<span style="letter-spacing:.06em;color:${NOTA_TEMA.inkSoft};"> &middot; Kode Verifikasi: <b style="font-family:'IBM Plex Mono',monospace;color:${NOTA_TEMA.navy};">${escapeHtml(kodeVerifikasi)}</b> &middot; tercatat di sistem audit nota</span>`;
    }
    return '';
}

function buildNotaWatermarkHTML() {
    return `
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:none;z-index:0;">
            <div style="transform:rotate(-28deg);font-size:54px;font-weight:800;letter-spacing:.12em;color:${NOTA_TEMA.navy};opacity:.045;white-space:nowrap;font-family:Georgia,'Times New Roman',serif;">${escapeHtml(NOTA_PERUSAHAAN.brand)}</div>
        </div>`;
}

// Cap "LUNAS" bergaya stempel tinta (dua garis lingkaran, dimiringkan) —
// dimunculkan HANYA saat dokumen ini berstatus KUITANSI (pembayaran sudah
// melunasi seluruh tagihan program), sebagai penanda visual cepat bahwa
// nota ini sudah lunas tanpa perlu membaca baris "Sisa Tagihan". Diposisikan
// via `bottom`/`right` (bukan `top`) supaya konsisten menumpuk di area
// tanda tangan petugas — lazimnya cap memang dibubuhkan di dekat tanda
// tangan penerima — dan tetap pas walau tinggi nota berbeda-beda (Nota
// Riwayat tingginya dinamis mengikuti jumlah baris transaksi, tidak
// dikunci 416px seperti Nota Pembayaran).
function buildNotaLunasStampHTML(tanggalPelunasan) {
    const tgl = tanggalPelunasan ? tanggalIndonesia(tanggalPelunasan) : '';
    return `
        <div style="position:absolute;bottom:70px;right:60px;z-index:2;transform:rotate(-12deg);pointer-events:none;opacity:.85;">
            <div style="width:96px;height:96px;border-radius:50%;border:3px solid ${NOTA_TEMA.stampRed};display:flex;align-items:center;justify-content:center;">
                <div style="width:82px;height:82px;border-radius:50%;border:1px solid ${NOTA_TEMA.stampRed};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
                    <div style="font-family:Georgia,'Times New Roman',serif;font-size:17px;font-weight:800;letter-spacing:.05em;color:${NOTA_TEMA.stampRed};line-height:1.1;">LUNAS</div>
                    ${tgl ? `<div style="font-size:6.5px;font-weight:700;color:${NOTA_TEMA.stampRed};margin-top:2px;white-space:nowrap;">${escapeHtml(tgl)}</div>` : ''}
                    <div style="font-size:5px;font-weight:700;letter-spacing:.08em;color:${NOTA_TEMA.stampRed};margin-top:2px;">${escapeHtml(NOTA_PERUSAHAAN.brand || 'AMIRU TOUR')}</div>
                </div>
            </div>
        </div>`;
}

function buildNotaHeaderHTML() {
    // Kop rata kiri: logo & identitas perusahaan sejajar di sisi kiri,
    // tanpa blok warna — supaya bisa ditempel di satu baris bersama judul nota.
    return `
        <div style="position:relative;z-index:1;display:flex;align-items:center;gap:10px;text-align:left;">
            <img src="${NOTA_PERUSAHAAN.logo}" alt="${escapeHtml(NOTA_PERUSAHAAN.brand)}" style="height:30px;width:auto;display:block;flex-shrink:0;">
            <div style="text-align:left;">
                <div style="font-size:10.5px;font-weight:800;color:${NOTA_TEMA.navy};letter-spacing:.01em;">${escapeHtml(NOTA_PERUSAHAAN.nama)}</div>
                <div style="font-size:7px;color:${NOTA_TEMA.inkSoft};margin-top:2px;line-height:1.35;">${escapeHtml(NOTA_PERUSAHAAN.alamat)} &middot; Telp. ${escapeHtml(NOTA_PERUSAHAAN.telp)} &middot; ${escapeHtml(NOTA_PERUSAHAAN.email)}</div>
            </div>
        </div>`;
}

function buildNotaTitleBarHTML(judul, metaLines) {
    // Tanpa blok warna: judul nota jadi teks polos rata kanan, ukuran kecil,
    // hanya dipisah garis navy tipis (dipasang oleh pemanggil) dari kop.
    const meta = metaLines.map(m => `<div style="margin-top:1px;">${m}</div>`).join('');
    return `
        <div style="position:relative;z-index:1;text-align:right;flex-shrink:0;">
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:10.5px;font-weight:700;letter-spacing:.06em;color:${NOTA_TEMA.navy};">${judul}</div>
            <div style="margin-top:2px;font-size:8px;line-height:1.4;color:${NOTA_TEMA.inkSoft};">${meta}</div>
        </div>`;
}

// Merender daftar rekening dari NOTA_PERUSAHAAN.rekening secara dinamis
// (bukan teks tetap) — dipakai bersama oleh Nota Pembayaran, Nota Riwayat,
// dan Kuitansi supaya footer rekening ketiganya selalu sinkron.
function buildRekeningFooterHTML() {
    const daftar = (NOTA_PERUSAHAAN.rekening || [])
        .map(r => `${escapeHtml(r.bank)} ${escapeHtml(r.nomor)} a.n. ${escapeHtml(r.an)}`)
        .join('&nbsp;&middot;&nbsp;');
    return `<b>Rekening Pembayaran:</b> ${daftar || '-'}`;
}

function buildNotaSignatureHTML(kiriLabel, kananLabel) {
    return `
        <div style="position:relative;z-index:1;display:flex;justify-content:space-between;gap:10px;font-size:8.5px;text-align:center;color:#333;">
            <div style="flex:1;">
                <div style="margin-bottom:14px;">&nbsp;</div>
                <div style="border-top:1px solid #999;padding-top:3px;font-weight:600;">${escapeHtml(kiriLabel)}</div>
            </div>
            <div style="flex:1;">
                <div style="margin-bottom:14px;">&nbsp;</div>
                <div style="border-top:1px solid #999;padding-top:3px;font-weight:600;">${escapeHtml(kananLabel)}</div>
            </div>
        </div>`;
}

// [FIX BUG] Menentukan APAKAH satu baris cicilan tertentu yang benar-benar
// "menutup pelunasan" (bukan cuma "status jamaah saat ini kebetulan lunas").
// Sebelumnya isKuitansi dihitung dari status agregat SAAT INI saja
// (totalDibayarSemua >= hargaProgram) -- akibatnya kalau jamaah sudah lunas
// lewat cicilan belakangan, lalu staf reprint/preview NOTA cicilan LAMA
// (mis. DP pertama, waktu itu belum lunas), dokumen itu ikut berubah jadi
// "KUITANSI" + dapat nomor kuitansi permanen sendiri -- padahal baris itu
// bukan yang melunasi. Bisa berujung banyak "kuitansi lunas" dobel untuk
// satu jamaah yang sama.
//
// Fix: urutkan SEMUA cicilan jamaah ini secara KRONOLOGIS (pakai created_at,
// urutan transaksi benar-benar terjadi -- bukan `tanggal` yang bisa diisi
// bebas/back-date oleh staf, dan bukan urutan tampil cicilanList yang di-
// sort tanggal DESC untuk riwayat), lalu jumlahkan berjalan (running total).
// Baris ini dianggap "pelunasan" HANYA kalau: sebelum baris ini running
// total < harga (belum lunas), dan SESUDAH baris ini running total >= harga
// (jadi lunas) -- persis satu baris saja per jamaah yang bisa true.
function isCicilanPelunasan(cicilan) {
    if (!cicilan || cicilan.id === 'draft') return false;
    if (Number(cicilan.jumlah || 0) < 0) return false; // refund tidak pernah jadi kuitansi
    if (!cicilanHargaProgram || cicilanHargaProgram <= 0) return false;
    // [FIX] Urutkan berdasar `tanggal` (tanggal transaksi) dulu, BUKAN
    // `created_at`, supaya konsisten dengan cara buildNotaRiwayatHTML()
    // menentukan "tanggal pelunasan" (lihat komentar di sana) — kalau dua
    // fungsi ini beda urutan, bisa terjadi Nota Riwayat bilang lunas di
    // tanggal X tapi cicilan yang ditandai "KUITANSI" di preview per-baris
    // malah baris lain. `created_at` cuma dipakai sebagai tiebreaker kalau
    // ada 2+ transaksi persis di tanggal yang sama.
    const kronologis = [...cicilanList].sort((a, b) => {
        const da = String(a.tanggal || '');
        const db = String(b.tanggal || '');
        if (da !== db) return da.localeCompare(db);
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (ta !== tb) return ta - tb;
        return String(a.id).localeCompare(String(b.id));
    });
    let running = 0;
    for (const c of kronologis) {
        const sebelumLunas = running >= cicilanHargaProgram;
        running += Number(c.jumlah || 0);
        if (String(c.id) === String(cicilan.id)) {
            return !sebelumLunas && running >= cicilanHargaProgram;
        }
    }
    return false;
}

function buildNotaHTML(cicilan, kodeVerifikasi) {
    const jamaah = cicilanJamaahInfo || {};
    const program = cicilanProgramInfo || {};
    const hargaProgram = cicilanHargaProgram || 0;

    const totalDibayarSemua = cicilanList.reduce((sum, c) => sum + Number(c.jumlah || 0), 0);
    const sisaTagihan = Math.max(hargaProgram - totalDibayarSemua, 0);
    const jumlah = parseRupiahToNumber(cicilan.jumlah);
    const statusLunas = hargaProgram > 0 && totalDibayarSemua >= hargaProgram;
    const lebihBayar = Math.max(totalDibayarSemua - hargaProgram, 0);

    // Kalau baris cicilan ini punya harga_program_snapshot (harga acuan saat
    // transaksi itu dicatat) dan nilainya BEDA dari harga acuan saat ini
    // (mis. jamaah pindah tipe kamar setelah transaksi ini), tampilkan catatan
    // historis supaya nota lama yang di-reprint tidak terlihat "salah hitung"
    // dibanding kertas fisik yang sudah diberikan ke jamaah sebelumnya. Angka
    // Harga Program / Sisa Tagihan di rekap tetap pakai harga LIVE (sengaja,
    // lihat catatan di isCicilanPelunasan & sql/tambah_snapshot_harga_pembayaran.sql).
    const hargaSnapshot = cicilan.harga_program_snapshot != null ? Number(cicilan.harga_program_snapshot) : null;
    const hargaSnapshotBeda = hargaSnapshot != null && hargaSnapshot > 0 && hargaSnapshot !== hargaProgram;

    // Judul & nomor dokumen ditentukan OTOMATIS oleh sistem, bukan dipilih
    // manual staf: kalau baris pembayaran INI SENDIRI yang menutup pelunasan
    // (lihat isCicilanPelunasan di atas), dokumennya berjudul "KUITANSI" &
    // pakai seri nomor kuitansi terpisah (nomorKuitansiTampilan). Selain itu
    // (termasuk cicilan lama yang di-reprint setelah jamaah lunas lewat
    // pembayaran belakangan), tetap "NOTA PEMBAYARAN" dengan nomor nota biasa.
    const isKuitansi = isCicilanPelunasan(cicilan);
    const judulDokumen = isKuitansi ? 'KUITANSI' : 'NOTA PEMBAYARAN';
    const nomorDokumen = isKuitansi ? nomorKuitansiTampilan(cicilan) : nomorNota(cicilan);

    const baris = (label, value, opts = {}) => `
        <tr>
            <td style="padding:2.5px 0;font-size:10px;color:${NOTA_TEMA.inkSoft};width:110px;vertical-align:top;">${label}</td>
            <td style="padding:2.5px 0;font-size:10px;color:#1a1a1a;vertical-align:top;${opts.bold ? 'font-weight:700;' : ''}">: ${value}</td>
        </tr>`;

    const kolomKiri = [
        baris('Diterima Dari', escapeHtml(jamaah.nama || '-'), { bold: true }),
        baris('Program Umroh', `${escapeHtml(program.nama || '-')}${program.tgl ? ' (' + escapeHtml(program.tgl) + ')' : ''}`)
    ].join('');
    const kolomKanan = [
        baris('Metode Bayar', escapeHtml(cicilan.metode || '-'))
    ].join('');

    const rekapItem = (label, value, opts = {}) => `
        <div style="flex:1;">
            <div style="font-size:8.5px;color:${NOTA_TEMA.inkSoft};text-transform:uppercase;letter-spacing:.04em;">${label}</div>
            <div style="font-size:12px;font-weight:700;margin-top:2px;${opts.color ? 'color:' + opts.color + ';' : ''}">${value}</div>
        </div>`;

    // Ukuran nota: 210 x 110 mm, dirender pada 96dpi => 794 x 416 px.
    // Layout disusun per-baris (stack ke bawah): kop+judul -> info pembayaran
    // -> jumlah diterima -> rekap tagihan -> tanda tangan, bukan kolom sejajar.
    return `
    <div style="position:relative;width:794px;height:416px;background:#fff;font-family:'Inter',Arial,sans-serif;color:#1a1a1a;padding:22px 28px;box-sizing:border-box;border:1px solid ${NOTA_TEMA.line};overflow:hidden;display:flex;flex-direction:column;">
        ${buildNotaWatermarkHTML()}
        ${isKuitansi ? buildNotaLunasStampHTML(cicilan.tanggal) : ''}

        <div style="position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-shrink:0;border-bottom:1.5px solid ${NOTA_TEMA.navy};padding-bottom:9px;margin-bottom:12px;">
            ${buildNotaHeaderHTML()}
            ${buildNotaTitleBarHTML(judulDokumen, [
                `No. ${escapeHtml(nomorDokumen)}`,
                `${escapeHtml(tanggalIndonesia(cicilan.tanggal))}`
            ])}
        </div>

        <div style="position:relative;z-index:1;flex:1;min-height:0;display:flex;flex-direction:column;justify-content:space-between;">
            <div style="display:flex;gap:20px;">
                <table style="width:64%;border-collapse:collapse;">
                    ${kolomKiri}
                </table>
                <table style="width:36%;border-collapse:collapse;">
                    ${kolomKanan}
                </table>
            </div>

            <div style="background:${NOTA_TEMA.tint};border-left:3px solid ${NOTA_TEMA.navy};border-radius:2px;padding:9px 16px;">
                <div style="font-size:8.5px;color:${NOTA_TEMA.inkSoft};text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px;">Jumlah Diterima</div>
                <div style="font-size:23px;font-weight:800;color:${NOTA_TEMA.navy};line-height:1.15;">${formatRupiah(jumlah)}</div>
                <div style="font-size:9.5px;color:#555;font-style:italic;margin-top:3px;">Terbilang: ${rupiahTerbilang(jumlah)}</div>
                <div style="font-size:9px;color:${NOTA_TEMA.inkSoft};margin-top:5px;padding-top:5px;border-top:1px dashed ${NOTA_TEMA.line};">Total dibayar s.d. nota ini: <b style="color:${NOTA_TEMA.navy};font-size:10px;">${formatRupiah(totalDibayarSemua)}</b></div>
                ${cicilan.keterangan ? `<div style="font-size:9.5px;color:${NOTA_TEMA.inkSoft};margin-top:5px;padding-top:5px;border-top:1px dashed ${NOTA_TEMA.line};">Untuk Pembayaran: <span style="color:#1a1a1a;font-weight:600;">${escapeHtml(cicilan.keterangan)}</span></div>` : ''}
                ${hargaSnapshotBeda ? `<div style="font-size:9px;color:${NOTA_TEMA.inkSoft};margin-top:5px;padding-top:5px;border-top:1px dashed ${NOTA_TEMA.line};">Harga Program saat transaksi ini: <b style="color:#1a1a1a;">${formatRupiah(hargaSnapshot)}</b> <span style="font-style:italic;">(berbeda dari harga acuan saat ini karena ada perubahan tipe kamar/harga setelah transaksi ini)</span></div>` : ''}
            </div>

            <div style="display:flex;justify-content:space-between;gap:14px;padding:8px 0;border-top:1px solid ${NOTA_TEMA.line};border-bottom:1px solid ${NOTA_TEMA.line};">
                ${rekapItem('Harga Program', formatRupiah(hargaProgram))}
                ${rekapItem('Total Dibayar (s.d. hari ini)', formatRupiah(totalDibayarSemua))}
                ${rekapItem('Sisa Tagihan', statusLunas ? (lebihBayar > 0 ? `LUNAS · Lebih Bayar ${formatRupiah(lebihBayar)}` : 'LUNAS') : formatRupiah(sisaTagihan), { color: lebihBayar > 0 ? NOTA_TEMA.gold : '' })}
            </div>

            ${buildNotaSignatureHTML(jamaah.nama || 'Jamaah / Penyerah', getPetugasDisplayName())}
        </div>

        <div style="position:relative;z-index:1;text-align:left;font-size:8px;color:${NOTA_TEMA.inkSoft};flex-shrink:0;margin-top:8px;padding-top:6px;border-top:1px solid ${NOTA_TEMA.line};">
            <div style="margin-bottom:3px;">
                ${buildRekeningFooterHTML()}
            </div>
            <div style="color:#a0a8b3;">
                Dokumen ini dicetak otomatis oleh sistem dan sah sebagai bukti pembayaran resmi ${escapeHtml(NOTA_PERUSAHAAN.brand)}.
                ${notaKodeVerifikasiFooterHTML(kodeVerifikasi)}
            </div>
        </div>
    </div>`;
}

// ---- KUITANSI (LEGACY, manual, bukan dari data cicilan/pembayaran
// tersimpan) ----
// Dulu dipakai oleh tombol "Kuitansi" terpisah di tab Keberangkatan
// (diisi bebas oleh staf: nomor, jumlah, keterangan manual). Tombol & modal
// itu SUDAH DIHAPUS — sejak digabung ke alur "Bayar", dokumen "KUITANSI"
// dibuat otomatis oleh buildNotaHTML() (judul & nomornya mengikuti status
// lunas jamaah). Fungsi ini DIPERTAHANKAN hanya supaya baris lama di Audit
// Nota (jenis 'kuitansi' yang diterbitkan sebelum penggabungan ini) masih
// bisa direkonstruksi & dipreview lewat previewNotaFromAudit().
function buildKuitansiHTML(data, kodeVerifikasi) {
    const jumlah = parseRupiahToNumber(data.jumlah);
    const terbilang = data.terbilang || rupiahTerbilang(jumlah);
    const nomor = data.nomor && data.nomor.trim() ? data.nomor.trim() : '(nomor belum diisi)';

    const baris = (label, value, opts = {}) => `
        <tr>
            <td style="padding:2.5px 0;font-size:10px;color:${NOTA_TEMA.inkSoft};width:110px;vertical-align:top;">${label}</td>
            <td style="padding:2.5px 0;font-size:10px;color:#1a1a1a;vertical-align:top;${opts.bold ? 'font-weight:700;' : ''}">: ${value}</td>
        </tr>`;

    // Diterima Dari, Tempat/Tanggal, dan Metode Bayar disusun satu kolom
    // ke bawah (bukan dua kolom bersebelahan) sesuai urutan: Diterima Dari
    // di atas, lalu Tempat/Tanggal & Metode Bayar di bawahnya.
    const kolomInfo = [
        baris('Diterima Dari', escapeHtml(data.dari || '-'), { bold: true }),
        baris('Tempat / Tanggal', escapeHtml(data.tempatTanggal || '-')),
        baris('Metode Bayar', escapeHtml(data.metode || '-'))
    ].join('');

    // Ukuran & struktur layout disamakan persis dengan buildNotaHTML: 794x416px
    // (210x110mm @96dpi), disusun stack ke bawah (kop+judul -> info -> jumlah
    // diterima -> tanda tangan -> footer), bukan kolom-kolom terpisah.
    return `
    <div style="position:relative;width:794px;height:416px;background:#fff;font-family:'Inter',Arial,sans-serif;color:#1a1a1a;padding:22px 28px;box-sizing:border-box;border:1px solid ${NOTA_TEMA.line};overflow:hidden;display:flex;flex-direction:column;">
        ${buildNotaWatermarkHTML()}

        <div style="position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-shrink:0;border-bottom:1.5px solid ${NOTA_TEMA.navy};padding-bottom:9px;margin-bottom:12px;">
            ${buildNotaHeaderHTML()}
            ${buildNotaTitleBarHTML('KUITANSI', [`No. ${escapeHtml(nomor)}`])}
        </div>

        <div style="position:relative;z-index:1;flex:1;min-height:0;display:flex;flex-direction:column;justify-content:space-between;">
            <div style="display:flex;gap:20px;">
                <table style="width:100%;border-collapse:collapse;">
                    ${kolomInfo}
                </table>
            </div>

            <div style="background:${NOTA_TEMA.tint};border-left:3px solid ${NOTA_TEMA.navy};border-radius:2px;padding:9px 16px;">
                <div style="font-size:8.5px;color:${NOTA_TEMA.inkSoft};text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px;">Jumlah Diterima</div>
                <div style="font-size:23px;font-weight:800;color:${NOTA_TEMA.navy};line-height:1.15;">${formatRupiah(jumlah)}</div>
                <div style="font-size:9.5px;color:#555;font-style:italic;margin-top:3px;">Terbilang: ${escapeHtml(terbilang)}</div>
                ${data.keterangan ? `<div style="font-size:9.5px;color:${NOTA_TEMA.inkSoft};margin-top:5px;padding-top:5px;border-top:1px dashed ${NOTA_TEMA.line};">Untuk Pembayaran: <span style="color:#1a1a1a;font-weight:600;">${escapeHtml(data.keterangan)}</span></div>` : ''}
            </div>

            ${buildNotaSignatureHTML(data.dari || 'Yang Menyerahkan', data.penerima || 'Penerima')}
        </div>

        <div style="position:relative;z-index:1;text-align:left;font-size:8px;color:${NOTA_TEMA.inkSoft};flex-shrink:0;margin-top:8px;padding-top:6px;border-top:1px solid ${NOTA_TEMA.line};">
            <div style="margin-bottom:3px;">
                ${buildRekeningFooterHTML()}
            </div>
            <div style="color:#a0a8b3;">
                Dokumen ini dicetak otomatis oleh sistem dan sah sebagai bukti pembayaran resmi ${escapeHtml(NOTA_PERUSAHAAN.brand)}.
                ${notaKodeVerifikasiFooterHTML(kodeVerifikasi)}
            </div>
        </div>
    </div>`;
}

// Render nota (HTML string) ke #notaRenderArea lalu tangkap jadi <canvas> lewat
// html2canvas. Dipakai bersama oleh export JPEG maupun PDF supaya proses
// render & pengelolaan spinner tombol tidak dobel ditulis di dua tempat.
async function captureNotaCanvas(htmlString, btn) {
    if (notaGenerating) return null;
    if (typeof html2canvas === 'undefined') {
        try { await ensureLibLoaded('html2canvas'); }
        catch (_) { showToast('Modul export gambar gagal dimuat — periksa koneksi internet lalu coba lagi', 'error'); return null; }
    }

    notaGenerating = true;
    const originalIcon = btn ? btn.innerHTML : null;
    if (btn) { btn.innerHTML = '<i class="bi bi-arrow-repeat bi-spin"></i>'; btn.disabled = true; }

    const renderArea = document.getElementById('notaRenderArea');
    renderArea.innerHTML = htmlString;

    try {
        // Tunggu gambar (logo) selesai dimuat, baru beri jeda singkat untuk layout settle,
        // supaya html2canvas tidak menyalin kanvas saat logo belum tampil.
        const imgs = Array.from(renderArea.querySelectorAll('img'));
        await Promise.all(imgs.map(img => (img.complete && img.naturalWidth > 0)
            ? Promise.resolve()
            : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; })
        ));
        await new Promise(resolve => setTimeout(resolve, 60));
        const target = renderArea.firstElementChild;
        return await html2canvas(target, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    } catch (err) {
        console.error('Generate nota error:', err);
        showToast('Gagal membuat nota: ' + err.message, 'error');
        return null;
    } finally {
        renderArea.innerHTML = '';
        notaGenerating = false;
        if (btn) { btn.innerHTML = originalIcon; btn.disabled = false; }
    }
}

async function exportNotaElementAsJpeg(htmlString, filename, btn) {
    const canvas = await captureNotaCanvas(htmlString, btn);
    if (!canvas) return false;

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Nota berhasil diunduh (JPEG)');
    return true;
}

async function exportNotaElementAsPdf(htmlString, filename, btn) {
    if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
        try { await ensureLibLoaded('jspdf'); }
        catch (_) { showToast('Modul export PDF gagal dimuat — periksa koneksi internet lalu coba lagi', 'error'); return false; }
    }

    const canvas = await captureNotaCanvas(htmlString, btn);
    if (!canvas) return false;

    try {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
        const { jsPDF } = window.jspdf;
        // Ukuran halaman PDF dibuat pas mengikuti dimensi nota (bukan A4),
        // supaya nota tidak terpotong / ada margin putih aneh.
        const pdf = new jsPDF({
            orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
            unit: 'px',
            format: [canvas.width, canvas.height]
        });
        pdf.addImage(dataUrl, 'JPEG', 0, 0, canvas.width, canvas.height);
        pdf.save(filename);

        showToast('Nota berhasil diunduh (PDF)');
        return true;
    } catch (err) {
        console.error('Generate nota PDF error:', err);
        showToast('Gagal membuat PDF: ' + err.message, 'error');
        return false;
    }
}

function setNotaPreviewPanelChrome(title, showActions) {
    const titleEl = document.getElementById('cicilanPreviewTitle');
    const actionsEl = document.getElementById('notaPreviewActions');
    if (titleEl) titleEl.textContent = title;
    if (actionsEl) actionsEl.style.display = showActions ? '' : 'none';
}

// [DIPAKAI BERSAMA] Render HTML nota (apa pun jenisnya: nota pembayaran,
// nota riwayat, atau kuitansi) ke dalam sebuah kontainer, dibungkus wrapper
// yang di-scale proporsional (bukan overflow/scroll) supaya yang terlihat =
// keseluruhan nota, cuma diperkecil menyesuaikan lebar kontainer. Dipakai
// oleh showNotaPreviewPanel() (modal Kelola Cicilan).
function renderScaledNotaInto(contentEl, html) {
    if (!contentEl) return;
    contentEl.innerHTML = `<div class="nota-preview-scale-wrap"><div class="nota-preview-scale-inner">${html}</div></div>`;
    requestAnimationFrame(() => fitScaleInto(contentEl));
}

function showNotaPreviewPanel(html, autoScroll = true) {
    // Nota dirender pada ukuran aslinya (500-1123px, sesuai jenis nota) supaya
    // hasilnya identik dengan file yang diunduh — panel preview jauh lebih
    // sempit dari itu, jadi di sini kita bungkus dengan wrapper yang di-scale
    // proporsional (bukan overflow/scroll) agar yang terlihat = keseluruhan
    // nota, cuma diperkecil. Ukuran final tetap dihitung dari nota versi asli.
    const content = document.getElementById('notaPreviewContent');
    renderScaledNotaInto(content, html);
    const panel = document.getElementById('cicilanPreviewPanel');
    panel.style.display = 'block';
    // Auto-scroll panel preview ke tampilan supaya user tidak perlu scroll
    // manual — hanya untuk aksi klik preview yang eksplisit (tombol Preview
    // Nota / Unduh Nota Riwayat). Live draft (autoScroll=false) sengaja TIDAK
    // ikut auto-scroll, karena kalau ikut, tampilan akan lompat-lompat tiap
    // user mengetik di form "Tambah Pembayaran" yang letaknya di atas panel.
    if (autoScroll) {
        // Dipanggil di frame berikutnya supaya layout (display:block) sudah
        // settle dulu sebelum posisi scroll dihitung.
        requestAnimationFrame(() => {
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }
}

function fitNotaPreviewScale() {
    fitScaleInto(document.getElementById('notaPreviewContent'));
}

function fitScaleInto(content) {
    if (!content) return;
    const wrap = content.querySelector('.nota-preview-scale-wrap');
    const inner = content.querySelector('.nota-preview-scale-inner');
    const nota = inner ? inner.firstElementChild : null;
    if (!wrap || !inner || !nota) return;

    inner.style.transform = 'none';
    const naturalWidth = nota.offsetWidth;
    const naturalHeight = nota.offsetHeight;
    if (!naturalWidth || !naturalHeight) return;

    // Skala minimum supaya teks nota (yang sudah kecil, 7-10px) tetap nyaman
    // dibaca di panel preview. Kalau ruang yang tersedia lebih sempit dari itu,
    // nota tetap ditampilkan di skala minimum ini dan kelebihannya di-scroll
    // horizontal (bukan dipaksa mengecil terus sampai tidak terbaca).
    // [MAKSIMALKAN] Skala TIDAK lagi dikunci maksimum 100% dan TIDAK diberi
    // plafon atas — nota selalu di-zoom mengisi PENUH lebar panel yang
    // tersedia (berapa pun lebar layarnya), supaya tidak ada sisa area kosong
    // kanan-kiri sama sekali. Ini murni tampilan preview (di-transform via
    // CSS) — file JPEG yang diunduh tetap dirender terpisah di ukuran &
    // resolusi aslinya lewat #notaRenderArea, jadi kualitas unduhan tidak
    // terpengaruh sama sekali oleh seberapa besar skala preview ini.
    const MIN_READABLE_SCALE = 0.75;
    const available = content.clientWidth || naturalWidth;
    const fitScale = available / naturalWidth;
    const scale = Math.max(fitScale, MIN_READABLE_SCALE);

    content.style.overflowX = (fitScale < MIN_READABLE_SCALE) ? 'auto' : 'hidden';

    inner.style.transformOrigin = 'top left';
    inner.style.transform = `scale(${scale})`;
    wrap.style.width = (naturalWidth * scale) + 'px';
    wrap.style.height = (naturalHeight * scale) + 'px';
}

function previewNotaPembayaran(cicilanId, btn) {
    const cicilan = cicilanList.find(c => String(c.id) === String(cicilanId));
    if (!cicilan) { showToast('Data pembayaran tidak ditemukan', 'error'); return; }
    if (Number(cicilan.jumlah || 0) < 0) { showToast('Nota pembayaran tidak berlaku untuk baris refund', 'error'); return; }
    notaPreviewPending = { type: 'pembayaran', cicilanId, btn };
    setNotaPreviewPanelChrome('Preview Nota', true);
    showNotaPreviewPanel(buildNotaHTML(cicilan, NOTA_KODE_PREVIEW));
}

function previewNotaRiwayatLengkap(btn) {
    if (!cicilanJamaahId) { showToast('Data jamaah tidak valid', 'error'); return; }
    if (!cicilanList.length) { showToast('Belum ada riwayat pembayaran untuk diunduh', 'error'); return; }
    notaPreviewPending = { type: 'riwayat', btn };
    setNotaPreviewPanelChrome('Preview Nota', true);
    showNotaPreviewPanel(buildNotaRiwayatHTML(NOTA_KODE_PREVIEW));
}

function updateLiveNotaDraft() {
    // Jangan timpa preview nota yang sudah tersimpan & sedang menunggu diunduh
    if (notaPreviewPending && notaPreviewPending.type !== 'draft') return;

    const tanggal = document.getElementById('cic_tanggal')?.value || '';
    const jumlah = parseRupiahToNumber(document.getElementById('cic_jumlah')?.value);
    const metode = document.getElementById('cic_metode')?.value || '';
    const keterangan = document.getElementById('cic_keterangan')?.value.trim() || '';

    if (!tanggal && !jumlah) { hideNotaPreviewPanel(); return; }
    // Nota "Jumlah Diterima" tidak relevan untuk Refund — tidak ada preview live di mode ini.
    if (metode === 'Refund') { hideNotaPreviewPanel(); return; }

    const draftCicilan = { id: 'draft', tanggal, jumlah, metode, keterangan };
    notaPreviewPending = { type: 'draft' };
    setNotaPreviewPanelChrome('Preview Nota — Live (belum disimpan)', false);
    showNotaPreviewPanel(buildNotaHTML(draftCicilan, NOTA_KODE_PREVIEW), false);
}

async function confirmDownloadNotaPreview(format = 'jpeg') {
    if (!notaPreviewPending) return;
    const { type, cicilanId, btn } = notaPreviewPending;
    hideNotaPreviewPanel();
    if (type === 'pembayaran') {
        await downloadNotaPembayaran(cicilanId, btn, format);
    } else if (type === 'riwayat') {
        await downloadNotaRiwayatLengkap(btn, format);
    }
}

async function downloadNotaPembayaran(cicilanId, btn, format = 'jpeg') {
    const cicilan = cicilanList.find(c => String(c.id) === String(cicilanId));
    if (!cicilan) { showToast('Data pembayaran tidak ditemukan', 'error'); return; }
    if (Number(cicilan.jumlah || 0) < 0) { showToast('Nota pembayaran tidak berlaku untuk baris refund', 'error'); return; }

    const namaJamaah = (cicilanJamaahInfo && cicilanJamaahInfo.nama ? cicilanJamaahInfo.nama : 'Jamaah').replace(/[^a-zA-Z0-9]+/g, '-');

    // Sama seperti buildNotaHTML: dokumen ini "KUITANSI" (seri nomor
    // terpisah, dikunci permanen ke baris pembayaran ini) HANYA kalau baris
    // pembayaran INI SENDIRI yang menutup pelunasan (lihat isCicilanPelunasan
    // -- [FIX BUG] sebelumnya dicek dari status agregat SEKARANG, jadi
    // reprint cicilan lama sesudah jamaah lunas belakangan bisa salah dapat
    // nomor kuitansi sendiri). Selain itu tetap "NOTA PEMBAYARAN" biasa.
    const isKuitansi = isCicilanPelunasan(cicilan);

    let nomor;
    if (isKuitansi) {
        // Nomor kuitansi diambil SEKALI dari sequence & dikunci permanen ke
        // baris pembayaran ini (kolom nomor_kuitansi) supaya unduhan ulang
        // (JPEG lalu PDF, atau reprint di lain waktu) tetap pakai nomor yang
        // sama, tidak mengambil nomor baru tiap kali.
        if (!cicilan.nomor_kuitansi) {
            const nomorBaru = await fetchNextKuitansiNomorValue();
            try {
                const { error } = await supabaseClient.from('pembayaran_jamaah')
                    .update({ nomor_kuitansi: nomorBaru }).eq('id', cicilan.id);
                if (error) throw error;
            } catch (err) {
                console.warn('Gagal menyimpan nomor kuitansi ke database (migrasi sql/23_tambah_nomor_kuitansi_di_pembayaran.sql belum jalan?):', err);
            }
            cicilan.nomor_kuitansi = nomorBaru;
        }
        nomor = cicilan.nomor_kuitansi;
    } else {
        nomor = nomorNota(cicilan);
    }

    // Hitung & catat kode verifikasi SEBELUM nota dirender, supaya kodenya
    // ikut tercetak di dokumen itu sendiri (bisa dicocokkan balik ke log audit).
    const kodeVerifikasi = await logNotaAudit({
        jenis: isKuitansi ? 'kuitansi' : 'pembayaran',
        nomorNotaValue: nomor,
        jamaahId: cicilanJamaahId,
        jamaahNama: cicilanJamaahInfo?.nama,
        programNama: cicilanProgramInfo?.nama,
        jumlah: Number(cicilan.jumlah || 0),
        metadata: { cicilanId: cicilan.id, tanggal: cicilan.tanggal, metode: cicilan.metode }
    });

    const exportFn = format === 'pdf' ? exportNotaElementAsPdf : exportNotaElementAsJpeg;
    const ext = format === 'pdf' ? 'pdf' : 'jpg';
    const namaFile = isKuitansi
        ? `Kuitansi-${namaJamaah}-${cicilan.tanggal || 'tanggal'}.${ext}`
        : `Nota-Pembayaran-${namaJamaah}-${cicilan.tanggal || 'tanggal'}.${ext}`;
    await exportFn(buildNotaHTML(cicilan, kodeVerifikasi), namaFile, btn);
}

function buildNotaRiwayatHTML(kodeVerifikasi) {
    const jamaah = cicilanJamaahInfo || {};
    const program = cicilanProgramInfo || {};
    const hargaProgram = cicilanHargaProgram || 0;

    const riwayat = [...cicilanList].sort((a, b) => String(a.tanggal || '').localeCompare(String(b.tanggal || '')));
    const totalDibayar = riwayat.reduce((sum, c) => sum + Number(c.jumlah || 0), 0);
    const sisaTagihan = Math.max(hargaProgram - totalDibayar, 0);
    const statusLunas = hargaProgram > 0 && totalDibayar >= hargaProgram;
    const lebihBayar = Math.max(totalDibayar - hargaProgram, 0);

    // Tanggal pelunasan = tanggal transaksi cicilan yang menutup pelunasan
    // (lihat isCicilanPelunasan() -- satu sumber logika yang sama dipakai
    // juga oleh nota per-cicilan, supaya kedua nota tidak pernah beda
    // pendapat soal transaksi mana yang melunasi).
    let tanggalPelunasan = null;
    if (statusLunas) {
        const pelunas = riwayat.find(c => isCicilanPelunasan(c));
        tanggalPelunasan = pelunas ? pelunas.tanggal : null;
    }

    const rows = riwayat.length ? riwayat.map((c, i) => `
        <tr style="background:${i % 2 === 0 ? '#fff' : NOTA_TEMA.tint};">
            <td style="padding:7px 6px;border-bottom:1px solid ${NOTA_TEMA.line};text-align:center;color:${NOTA_TEMA.inkSoft};font-size:10px;">${i + 1}</td>
            <td style="padding:7px 6px;border-bottom:1px solid ${NOTA_TEMA.line};font-size:9px;font-family:'IBM Plex Mono',monospace;color:${NOTA_TEMA.inkSoft};white-space:nowrap;">${escapeHtml(nomorNota(c))}</td>
            <td style="padding:7px 6px;border-bottom:1px solid ${NOTA_TEMA.line};font-size:10px;">${escapeHtml(tanggalIndonesia(c.tanggal))}</td>
            <td style="padding:7px 6px;border-bottom:1px solid ${NOTA_TEMA.line};font-size:10px;">${escapeHtml(c.metode || '-')}</td>
            <td style="padding:7px 6px;border-bottom:1px solid ${NOTA_TEMA.line};font-size:10px;">${escapeHtml(c.keterangan || '-')}</td>
            <td style="padding:7px 6px;border-bottom:1px solid ${NOTA_TEMA.line};text-align:right;font-weight:700;font-size:10px;white-space:nowrap;">${formatRupiah(Number(c.jumlah || 0))}</td>
        </tr>`).join('') : `
        <tr><td colspan="6" style="padding:18px 6px;text-align:center;color:#999;font-size:10px;">Belum ada pembayaran tercatat.</td></tr>`;

    // baris & rekapItem sengaja diduplikasi persis dari buildNotaHTML (bukan
    // di-share) supaya kedua fungsi nota tetap independen dipanggil terpisah,
    // sama seperti pola kode nota lain di file ini — tapi nilainya disamakan
    // 1:1 (ukuran font, warna, spacing) supaya kedua jenis nota terasa satu
    // identitas visual yang sama persis.
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

    // Lebar & bahasa visual disamakan persis dengan Nota Pembayaran (buildNotaHTML):
    // kop+judul sebaris dipisah garis navy, info jamaah pakai tabel "baris" yang
    // sama, rekap total bergaya kartu (rekapItem), tanda tangan, dan footer
    // rekening yang identik. Bedanya cuma tinggi menyesuaikan jumlah baris
    // riwayat (tidak dikunci 416px seperti nota pembayaran, karena isinya bisa
    // jauh lebih panjang tergantung banyaknya transaksi).
    return `
    <div style="position:relative;width:794px;background:#fff;font-family:'Inter',Arial,sans-serif;color:#1a1a1a;padding:22px 28px;box-sizing:border-box;border:1px solid ${NOTA_TEMA.line};overflow:hidden;">
        ${buildNotaWatermarkHTML()}
        ${statusLunas ? buildNotaLunasStampHTML(tanggalPelunasan) : ''}

        <div style="position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border-bottom:1.5px solid ${NOTA_TEMA.navy};padding-bottom:9px;margin-bottom:12px;">
            ${buildNotaHeaderHTML()}
            ${buildNotaTitleBarHTML('NOTA RIWAYAT PEMBAYARAN', [
                `Dicetak: ${escapeHtml(tanggalIndonesia(new Date().toISOString().slice(0, 10)))}`
            ])}
        </div>

        <div style="position:relative;z-index:1;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
                ${baris('Nama Jamaah', escapeHtml(jamaah.nama || '-'), { bold: true })}
                ${baris('Program Umroh', `${escapeHtml(program.nama || '-')}${program.tgl ? ' (' + escapeHtml(program.tgl) + ')' : ''}`)}
            </table>

            <table style="width:100%;border-collapse:collapse;margin-bottom:12px;border:1px solid ${NOTA_TEMA.line};">
                <thead>
                    <tr style="background:${NOTA_TEMA.navy};">
                        <th style="padding:8px 6px;text-align:center;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;font-weight:700;">No</th>
                        <th style="padding:8px 6px;text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;font-weight:700;">No. Nota</th>
                        <th style="padding:8px 6px;text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;font-weight:700;">Tanggal</th>
                        <th style="padding:8px 6px;text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;font-weight:700;">Metode</th>
                        <th style="padding:8px 6px;text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;font-weight:700;">Keterangan</th>
                        <th style="padding:8px 6px;text-align:right;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#fff;font-weight:700;">Jumlah</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>

            <div style="display:flex;justify-content:space-between;gap:14px;padding:8px 0;border-top:1px solid ${NOTA_TEMA.line};border-bottom:1px solid ${NOTA_TEMA.line};margin-bottom:12px;">
                ${rekapItem('Harga Program', formatRupiah(hargaProgram))}
                ${rekapItem(`Total Dibayar (${riwayat.length}x transaksi)`, formatRupiah(totalDibayar))}
                ${rekapItem('Sisa Tagihan', statusLunas ? (lebihBayar > 0 ? `LUNAS · Lebih Bayar ${formatRupiah(lebihBayar)}` : 'LUNAS') : formatRupiah(sisaTagihan), { color: lebihBayar > 0 ? NOTA_TEMA.gold : '' })}
            </div>

            ${buildNotaSignatureHTML(jamaah.nama || 'Jamaah / Penyerah', getPetugasDisplayName())}
        </div>

        <div style="position:relative;z-index:1;text-align:left;font-size:8px;color:${NOTA_TEMA.inkSoft};margin-top:8px;padding-top:6px;border-top:1px solid ${NOTA_TEMA.line};">
            <div style="margin-bottom:3px;">
                ${buildRekeningFooterHTML()}
            </div>
            <div style="color:#a0a8b3;">
                Dokumen ini dicetak otomatis oleh sistem sebagai rekap riwayat pembayaran resmi ${escapeHtml(NOTA_PERUSAHAAN.brand)}.
                ${notaKodeVerifikasiFooterHTML(kodeVerifikasi)}
            </div>
        </div>
    </div>`;
}

async function downloadNotaRiwayatLengkap(btn, format = 'jpeg') {
    if (!cicilanJamaahId) { showToast('Data jamaah tidak valid', 'error'); return; }
    if (!cicilanList.length) { showToast('Belum ada riwayat pembayaran untuk diunduh', 'error'); return; }

    const namaJamaah = (cicilanJamaahInfo && cicilanJamaahInfo.nama ? cicilanJamaahInfo.nama : 'Jamaah').replace(/[^a-zA-Z0-9]+/g, '-');
    const tanggalFile = new Date().toISOString().slice(0, 10);
    const totalDibayar = cicilanList.reduce((sum, c) => sum + Number(c.jumlah || 0), 0);
    const daftarNomorNota = cicilanList.map(c => nomorNota(c));

    const kodeVerifikasi = await logNotaAudit({
        jenis: 'riwayat',
        nomorNotaValue: `REKAP/${daftarNomorNota.length}-NOTA/${tanggalFile}`,
        jamaahId: cicilanJamaahId,
        jamaahNama: cicilanJamaahInfo?.nama,
        programNama: cicilanProgramInfo?.nama,
        jumlah: totalDibayar,
        metadata: { daftarNomorNota, jumlahTransaksi: cicilanList.length }
    });

    const exportFn = format === 'pdf' ? exportNotaElementAsPdf : exportNotaElementAsJpeg;
    const ext = format === 'pdf' ? 'pdf' : 'jpg';
    await exportFn(
        buildNotaRiwayatHTML(kodeVerifikasi),
        `Nota-Riwayat-Pembayaran-${namaJamaah}-${tanggalFile}.${ext}`,
        btn
    );
}
