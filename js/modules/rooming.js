// ============================================================
// MODUL LAZY: ROOMING LIST  (js/modules/rooming.js)
// ============================================================
// Dipecah dari js/app.js dan dimuat HANYA saat dibutuhkan (ensureModuleLoaded('rooming') di app.js).
// Dimuat sebagai <script> biasa (BUKAN ES module): satu lingkup global dengan app.js, jadi nama
// fungsi global, onclick="..." dan data-action="..." tidak berubah.
// ATURAN: jangan mendeklarasikan ulang nama yang sudah ada di app.js (const/let ganda = SyntaxError).
// Fungsi yang dirujuk index.html / kode inti SEBELUM modul dimuat didaftarkan di LAZY_MODULES['rooming'].api (app.js).
// ============================================================

// ============================================================
// 19F. ROOMING LIST — bagi jamaah 1 program ke kamar hotel per tipe kamar
// (Quad/Triple/Double), otomatis atau geser manual, lalu simpan ke DB
// (kolom kb_jamaah.nomor_kamar, lihat sql/11_tambah_nomor_kamar_kb_jamaah.sql)
// dan bisa diunduh sebagai dokumen (format grid kamar, bukan tabel per-orang
// seperti Manifest). Beda dari Manifest: modal ini INTERAKTIF, ada state
// kerja sementara (roomingWorking) yang baru ditulis ke DB saat "Simpan
// Perubahan" ditekan.
// ============================================================
const ROOM_KAPASITAS = { quad: 4, triple: 3, double: 2 };
const ROOM_TIPE_URUT = ['quad', 'triple', 'double'];
let roomingProgram = null;
let roomingWorking = []; // copy kerja kb_jamaah [{id, nama, tipe_kamar, nomor_kamar, status}, ...]
let roomingDirty = false;

async function bukaRoomingList(btn) {
    if (!kbSelectedProgram) { showToast('Pilih program dulu', 'error'); return; }
    const originalIcon = btn ? btn.innerHTML : null;
    if (btn) { btn.innerHTML = '<i class="bi bi-arrow-repeat bi-spin"></i>'; btn.disabled = true; }
    try {
        roomingProgram = dataUmroh.find(p => String(p.id) === String(kbSelectedProgram)) || null;
        const { data, error } = await supabaseClient.from('kb_jamaah')
            .select('id, nama, tipe_kamar, nomor_kamar, status')
            .eq('program_id', kbSelectedProgram).eq('diarsipkan', false).neq('status', 'batal')
            .order('nama', { ascending: true });
        if (error) throw error;

        roomingWorking = (data || []).map(j => ({ ...j, tipe_kamar: j.tipe_kamar || 'quad' }));
        roomingDirty = false;
        roomingSearchTerm = '';
        const searchInput = document.getElementById('roomingSearchInput');
        if (searchInput) searchInput.value = '';
        renderRoomingListBody();
        document.getElementById('roomingModal').classList.add('open');
    } catch (err) {
        console.error('Buka Rooming List error:', err);
        showToast('Gagal memuat data jamaah: ' + (err?.message || err), 'error');
    } finally {
        if (btn) { btn.innerHTML = originalIcon; btn.disabled = false; }
    }
}

async function tutupRoomingModal() {
    if (roomingDirty && !await openActionConfirm({ title: 'Perubahan Belum Disimpan', message: 'Ada perubahan yang belum disimpan. Tutup tanpa menyimpan?', confirmLabel: 'Ya, Tutup' })) return;
    document.getElementById('roomingModal').classList.remove('open');
    roomingProgram = null;
    roomingWorking = [];
    roomingDirty = false;
}

// Hitung jumlah kamar terpakai (max nomor_kamar yang sudah keisi, atau
// perkiraan dari kapasitas kalau belum ada yang dikelompokkan sama sekali)
// untuk satu tipe kamar -- dipakai buat batas atas pilihan di dropdown.
function roomingJumlahKamar(tipe) {
    const anggota = roomingWorking.filter(j => j.tipe_kamar === tipe);
    const maxTerisi = anggota.reduce((m, j) => Math.max(m, j.nomor_kamar || 0), 0);
    const perkiraan = Math.ceil(anggota.length / (ROOM_KAPASITAS[tipe] || 4)) || 1;
    return Math.max(maxTerisi, perkiraan);
}

// Isi otomatis nomor_kamar SEMUA jamaah (menimpa pengelompokan manual yang
// sudah ada) berdasarkan urutan nama & kapasitas per tipe kamar. Sengaja
// "ulang total" biar hasilnya konsisten & tidak ada kamar bolong-bolong --
// kalau admin sudah pernah geser manual dan ingin dipertahankan, jangan
// pakai tombol ini lagi setelah geser.
async function autoBagiKamar() {
    const sudahAda = roomingWorking.some(j => j.nomor_kamar);
    if (sudahAda && !await openActionConfirm({ title: 'Ulang Pembagian Kamar', message: 'Ini akan MENGULANG TOTAL semua pembagian kamar (termasuk yang sudah digeser manual). Lanjutkan?', confirmLabel: 'Ya, Ulang Total' })) return;
    ROOM_TIPE_URUT.forEach(tipe => {
        const anggota = roomingWorking.filter(j => j.tipe_kamar === tipe).sort((a, b) => (a.nama || '').localeCompare(b.nama || '', 'id'));
        const kap = ROOM_KAPASITAS[tipe] || 4;
        anggota.forEach((j, i) => { j.nomor_kamar = Math.floor(i / kap) + 1; });
    });
    roomingDirty = true;
    renderRoomingListBody();
    showToast('Kamar dibagi otomatis — klik "Simpan Perubahan" untuk menyimpan');
}

// Kata kunci pencarian nama jamaah aktif di modal Rooming List (lihat
// input #roomingSearchInput). Cuma menyaring tampilan, tidak mengubah
// roomingWorking, jadi aman dipakai sambil ada perubahan belum disimpan.
let roomingSearchTerm = '';
function filterRoomingList(value) {
    roomingSearchTerm = (value || '').trim().toLowerCase();
    renderRoomingListBody();
}

function pindahKamarJamaah(jamaahId, rawValue) {
    const j = roomingWorking.find(x => String(x.id) === String(jamaahId));
    if (!j) return;
    j.nomor_kamar = rawValue === '' ? null : parseInt(rawValue, 10);
    roomingDirty = true;
    renderRoomingListBody();
}

const TIPE_KAMAR_LABEL_ROOMING = { quad: 'Quad (4 orang/kamar)', triple: 'Triple (3 orang/kamar)', double: 'Double (2 orang/kamar)' };
// Warna aksen per tipe kamar -- dipakai konsisten di dot section, avatar
// inisial jamaah, dan dot kapasitas kamar biar satu tipe gampang dikenali
// sekilas tanpa baca teks.
const ROOM_TIPE_COLOR = { quad: 'var(--brand)', triple: '#b8935a', double: 'var(--success)' };

// Inisial dari nama jamaah (maks 2 huruf) buat avatar bulat di baris jamaah.
function rmInisial(nama) {
    const parts = (nama || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return parts.slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function renderRoomingListBody() {
    const wrap = document.getElementById('roomingListBody');
    const statsWrap = document.getElementById('roomingStatsBar');
    if (!wrap) return;

    if (!roomingWorking.length) {
        if (statsWrap) statsWrap.innerHTML = '';
        wrap.innerHTML = `<div class="rm-empty"><i class="bi bi-person-dash-fill"></i>Belum ada jamaah aktif di program ini.</div>`;
        return;
    }

    // --- Stats bar ringkas: total jamaah, kamar terpakai, dan berapa yang
    // masih perlu dikelompokkan. Dirender terpisah dari #roomingListBody
    // (lihat #roomingStatsBar di index.html) supaya bisa dibikin sticky di
    // toolbar & tetap kelihatan walau daftar jamaah discroll ke bawah.
    const totalJamaah = roomingWorking.length;
    const totalBelum = roomingWorking.filter(j => !j.nomor_kamar).length;
    const totalKamar = ROOM_TIPE_URUT.reduce((sum, tipe) => {
        const nomorTerisi = new Set(roomingWorking.filter(j => j.tipe_kamar === tipe && j.nomor_kamar).map(j => j.nomor_kamar));
        return sum + nomorTerisi.size;
    }, 0);
    if (statsWrap) {
        statsWrap.innerHTML = `
        <div class="rm-stats">
            <div class="rm-stat">
                <div class="rm-stat-icon" style="background:var(--brand-tint);color:var(--brand);"><i class="bi bi-people-fill"></i></div>
                <div><div class="rm-stat-num">${totalJamaah}</div><div class="rm-stat-label">Jamaah Aktif</div></div>
            </div>
            <div class="rm-stat">
                <div class="rm-stat-icon" style="background:var(--success-tint);color:var(--success);"><i class="bi bi-door-closed-fill"></i></div>
                <div><div class="rm-stat-num">${totalKamar}</div><div class="rm-stat-label">Kamar Terpakai</div></div>
            </div>
            <div class="rm-stat${totalBelum ? ' is-attention' : ''}">
                <div class="rm-stat-icon" style="background:${totalBelum ? 'var(--warn-tint)' : 'var(--success-tint)'};color:${totalBelum ? 'var(--warn)' : 'var(--success)'};"><i class="bi bi-${totalBelum ? 'exclamation-triangle-fill' : 'check-circle-fill'}"></i></div>
                <div><div class="rm-stat-num">${totalBelum}</div><div class="rm-stat-label">Belum Dikelompokkan</div></div>
            </div>
        </div>`;
    }

    const q = roomingSearchTerm;
    const cocok = (j) => !q || (j.nama || '').toLowerCase().includes(q);

    const sections = ROOM_TIPE_URUT.map(tipe => {
        const anggotaSemua = roomingWorking.filter(j => j.tipe_kamar === tipe);
        if (!anggotaSemua.length) return '';
        const anggota = anggotaSemua.filter(cocok);
        if (!anggota.length) return ''; // tidak ada yang cocok pencarian di tipe ini, sembunyikan section
        const warna = ROOM_TIPE_COLOR[tipe] || 'var(--brand)';
        const jumlahKamar = roomingJumlahKamar(tipe);
        const belumDikelompokkan = anggota.filter(j => !j.nomor_kamar);
        const kap = ROOM_KAPASITAS[tipe] || 4;

        const roomOptionsHtml = (selected) => {
            let opts = `<option value="">Belum ada kamar</option>`;
            for (let n = 1; n <= jumlahKamar + 1; n++) {
                opts += `<option value="${n}" ${Number(selected) === n ? 'selected' : ''}>Kamar ${n}</option>`;
            }
            return opts;
        };

        // Baris jamaah: avatar + nama + tombol "Pindah" (select native yang
        // disamarkan jadi chip supaya jelas ini tombol aksi, bukan cuma
        // label kamar biasa -- lihat .rm-move di style.css). Teks opsi
        // sengaja singkat ("Kamar 1", bukan "Pindah ke Kamar 1") supaya
        // nama jamaah di sebelahnya tidak kepotong di kartu kamar yang
        // sempit -- ikon ⇄ pada label sudah cukup menandakan ini aksi
        // pindah. Nama lengkap juga ditaruh di title (tooltip) buat jaga-
        // jaga kalau tetap terpotong pada nama yang sangat panjang.
        const occupantRowHtml = (j) => `
            <div class="rm-occupant">
                <div class="rm-avatar" style="background:${warna};">${rmInisial(j.nama)}</div>
                <span class="rm-occupant-name" title="${escapeHtml(j.nama)}">${escapeHtml(j.nama)}</span>
                <label class="rm-move" title="Pindahkan jamaah ini ke kamar lain">
                    <i class="bi bi-arrow-left-right"></i>
                    <select onchange="pindahKamarJamaah('${j.id}', this.value)">${roomOptionsHtml(j.nomor_kamar)}</select>
                </label>
            </div>`;

        const roomCards = [];
        for (let n = 1; n <= jumlahKamar; n++) {
            const isi = anggota.filter(j => j.nomor_kamar === n);
            if (!isi.length) continue;
            const over = isi.length > kap;
            const sisaSlot = Math.max(0, kap - isi.length);
            const emptySlotsHtml = Array.from({ length: sisaSlot }, () =>
                `<div class="rm-slot-empty"><i class="bi bi-plus-circle"></i>Slot kosong</div>`
            ).join('');
            roomCards.push(`
                <div class="rm-room-card${over ? ' is-over' : ''}">
                    <div class="rm-room-head">
                        <span class="rm-room-num">Kamar ${n}</span>
                        <span class="rm-room-badge" style="background:${over ? 'var(--danger-tint)' : 'var(--bg)'};color:${over ? 'var(--danger)' : 'var(--ink-soft)'};">${isi.length}/${kap}${over ? ' — kelebihan' : ''}</span>
                    </div>
                    ${isi.map(occupantRowHtml).join('')}
                    ${emptySlotsHtml}
                </div>`);
        }

        return `
            <div class="rm-section">
                <div class="rm-section-head">
                    <span class="rm-section-dot" style="background:${warna};"></span>
                    <span class="rm-section-title">${TIPE_KAMAR_LABEL_ROOMING[tipe]}</span>
                    <span class="rm-section-count">${anggota.length} jamaah</span>
                </div>
                ${belumDikelompokkan.length ? `
                <div class="rm-unassigned">
                    <div class="rm-unassigned-head"><i class="bi bi-exclamation-triangle-fill"></i> Belum Dikelompokkan (${belumDikelompokkan.length}) — pindahkan ke kamar lewat tombol di kanan nama</div>
                    <div class="rm-unassigned-grid">${belumDikelompokkan.map(occupantRowHtml).join('')}</div>
                </div>` : ''}
                ${roomCards.length ? `<div class="rm-room-grid"${belumDikelompokkan.length ? ' style="margin-top:12px;"' : ''}>${roomCards.join('')}</div>` : (belumDikelompokkan.length ? '' : `<div style="font-size:11.5px;color:var(--ink-soft);">Belum ada yang dikelompokkan.</div>`)}
            </div>`;
    }).join('');

    if (!sections) {
        wrap.innerHTML = q
            ? `<div class="rm-empty"><i class="bi bi-search"></i>Tidak ada jamaah dengan nama "${escapeHtml(roomingSearchTerm)}".</div>`
            : `<div class="rm-empty">Tidak ada data untuk ditampilkan.</div>`;
        return;
    }
    wrap.innerHTML = sections;
}

async function simpanRoomingList(btn) {
    if (!roomingWorking.length) { showToast('Tidak ada data untuk disimpan', 'error'); return; }
    const originalIcon = btn ? btn.innerHTML : null;
    if (btn) { btn.innerHTML = '<i class="bi bi-arrow-repeat bi-spin"></i>'; btn.disabled = true; }
    try {
        const updates = roomingWorking.map(j =>
            supabaseClient.from('kb_jamaah').update({ nomor_kamar: j.nomor_kamar }).eq('id', j.id)
        );
        const results = await Promise.all(updates);
        const gagal = results.filter(r => r.error);
        if (gagal.length) throw gagal[0].error;

        roomingDirty = false;
        showToast('Rooming list berhasil disimpan');
    } catch (err) {
        console.error('Simpan rooming list error:', err);
        showToast('Gagal menyimpan: ' + (err?.message || err) + ' — jalankan sql/11_tambah_nomor_kamar_kb_jamaah.sql kalau kolom belum ada', 'error');
    } finally {
        if (btn) { btn.innerHTML = originalIcon; btn.disabled = false; }
    }
}

// Dokumen rooming list untuk diunduh -- format grid kamar (bukan tabel
// per-orang seperti Manifest), lebih mudah dibaca hotel: per kamar, siapa
// saja isinya. Jamaah yang belum dikelompokkan ikut ditampilkan di bagian
// bawah supaya tidak ada yang kelewat.
function buildRoomingListHTML(program, jamaahList) {
    const tglGenerate = tanggalIndonesia(new Date().toISOString().slice(0, 10));

    const sectionsHtml = ROOM_TIPE_URUT.map(tipe => {
        const anggota = jamaahList.filter(j => j.tipe_kamar === tipe);
        if (!anggota.length) return '';
        const kap = ROOM_KAPASITAS[tipe] || 4;
        const byRoom = {};
        const belum = [];
        anggota.forEach(j => {
            if (j.nomor_kamar) { (byRoom[j.nomor_kamar] = byRoom[j.nomor_kamar] || []).push(j); }
            else belum.push(j);
        });
        const roomNums = Object.keys(byRoom).map(Number).sort((a, b) => a - b);

        const rows = roomNums.map(n => {
            const isi = byRoom[n];
            const namaCols = Array.from({ length: kap }, (_, i) => isi[i] ? escapeHtml(isi[i].nama) : '<span style="color:#c3c9d2;">-</span>');
            return `
                <tr style="background:${n % 2 === 0 ? NOTA_TEMA.tint : '#fff'};">
                    <td style="padding:6px 8px;border-bottom:1px solid ${NOTA_TEMA.line};text-align:center;font-weight:700;">${n}</td>
                    ${namaCols.map(nc => `<td style="padding:6px 8px;border-bottom:1px solid ${NOTA_TEMA.line};">${nc}</td>`).join('')}
                </tr>`;
        }).join('');

        const belumHtml = belum.length ? `
            <div style="margin-top:6px;font-size:9px;color:${NOTA_TEMA.gold};"><b>Belum dikelompokkan:</b> ${belum.map(j => escapeHtml(j.nama)).join(', ')}</div>` : '';

        return `
            <div style="margin-bottom:14px;">
                <div style="font-size:11px;font-weight:700;color:${NOTA_TEMA.navy};margin-bottom:6px;">${TIPE_KAMAR_LABEL_ROOMING[tipe]} — ${anggota.length} jamaah, ${roomNums.length} kamar</div>
                <table style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr style="background:${NOTA_TEMA.navy};">
                            <th style="padding:6px 8px;text-align:center;font-size:8.5px;text-transform:uppercase;color:#fff;width:50px;">Kamar</th>
                            ${Array.from({ length: kap }, (_, i) => `<th style="padding:6px 8px;text-align:left;font-size:8.5px;text-transform:uppercase;color:#fff;">Nama ${i + 1}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>${rows || `<tr><td colspan="${kap + 1}" style="padding:10px;text-align:center;color:${NOTA_TEMA.inkSoft};font-size:9.5px;">Belum ada kamar terisi</td></tr>`}</tbody>
                </table>
                ${belumHtml}
            </div>`;
    }).join('');

    return `
    <div style="position:relative;width:900px;background:#fff;font-family:'Inter',Arial,sans-serif;color:#1a1a1a;padding:26px 32px;box-sizing:border-box;border:1px solid ${NOTA_TEMA.line};overflow:hidden;">
        ${buildNotaWatermarkHTML()}

        <div style="position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border-bottom:1.5px solid ${NOTA_TEMA.navy};padding-bottom:9px;margin-bottom:14px;">
            ${buildNotaHeaderHTML()}
            ${buildNotaTitleBarHTML('ROOMING LIST', [
                `${escapeHtml(program?.nama || '-')}`,
                `${program?.tgl ? escapeHtml(program.tgl) : ''}`,
                `Dicetak ${escapeHtml(tglGenerate)}`
            ])}
        </div>

        <div style="position:relative;z-index:1;">
            ${sectionsHtml || `<p style="font-size:11px;color:${NOTA_TEMA.inkSoft};">Belum ada data jamaah.</p>`}
        </div>

        <div style="position:relative;z-index:1;text-align:left;font-size:7.5px;color:${NOTA_TEMA.inkSoft};margin-top:6px;padding-top:6px;border-top:1px solid ${NOTA_TEMA.line};">
            Rooming list ini dibuat otomatis dari data pembagian kamar yang tersimpan di sistem ${escapeHtml(NOTA_PERUSAHAAN.brand)} pada tanggal cetak di atas.
        </div>
    </div>`;
}

async function unduhRoomingList(format, btn) {
    if (!roomingWorking.length) { showToast('Tidak ada data untuk diunduh', 'error'); return; }
    if (roomingDirty) { showToast('Ada perubahan belum disimpan — klik "Simpan Perubahan" dulu', 'error'); return; }
    const html = buildRoomingListHTML(roomingProgram, roomingWorking);
    const namaProgram = (roomingProgram?.nama || 'Program').replace(/[^a-zA-Z0-9]+/g, '-');
    const exportFn = format === 'pdf' ? exportNotaElementAsPdf : exportNotaElementAsJpeg;
    const ext = format === 'pdf' ? 'pdf' : 'jpg';
    await exportFn(html, `Rooming-List-${namaProgram}.${ext}`, btn);
}
