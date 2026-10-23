// ============================================================
// MODUL LAZY: PROFIL PERUSAHAAN  (js/modules/profil-perusahaan.js)
// ============================================================
// Dipecah dari js/app.js dan dimuat HANYA saat dibutuhkan (ensureModuleLoaded('profil-perusahaan') di app.js).
// Dimuat sebagai <script> biasa (BUKAN ES module): satu lingkup global dengan app.js, jadi nama
// fungsi global dan onclick="..." tidak berubah.
// ATURAN: jangan mendeklarasikan ulang nama yang sudah ada di app.js (const/let ganda = SyntaxError).
// Tetap di app.js (dibaca sinkron oleh nota, caption WA, sapaan sidebar): NOTA_PERUSAHAAN, COMPANY_PROFILE_KEY,
// loadCompanyProfile(). Modul ini hanya EDITOR-nya; saveCompanyProfile() menimpa NOTA_PERUSAHAAN (let global) setelah simpan.
// Titik masuk dari inti: renderCompanyProfilePanel() (didaftarkan di LAZY_MODULES['profil-perusahaan'].api).
// ============================================================

// Draft rekening yang sedang diedit di form Profil Perusahaan (array of {bank,nomor,an})
let profileRekeningDraft = [];
// Draft nomor WA marketing yang sedang diedit (array of string, tanpa "wa.me/")
let profileKontakWaDraft = [];
// Data URL logo yang baru dipilih user tapi belum disimpan (null = belum ganti, pakai logo lama)
let profileLogoPendingDataUrl = null;
// true = ada isian yang diubah tapi belum disimpan (menampilkan penanda di bar simpan)
let profileDirty = false;

// Nilai input berdasarkan id (aman kalau elemen belum ada)
function cpVal(id) {
    const el = document.getElementById(id);
    return el && typeof el.value === 'string' ? el.value : '';
}

function cpRefreshDirty() {
    const d = document.getElementById('cp_dirty');
    if (d) d.hidden = !profileDirty;
}

function markCompanyProfileDirty() {
    profileDirty = true;
    cpRefreshDirty();
    updateCompanyProfilePreview();
}

// Dipasang di semua input teks identitas: hapus tanda merah, tandai belum tersimpan, segarkan pratinjau.
function onCompanyProfileInput(el) {
    if (el && el.classList) el.classList.remove('cp-invalid');
    markCompanyProfileDirty();
}

// Pratinjau ringkas kop & footer nota, diperbarui langsung saat mengetik (tanpa menyimpan).
function updateCompanyProfilePreview() {
    const box = document.getElementById('cp_preview');
    if (!box) return;
    const logo = profileLogoPendingDataUrl || NOTA_PERUSAHAAN.logo || '';
    const brand = cpVal('cp_brand').trim();
    const nama = cpVal('cp_nama').trim();
    const alamat = cpVal('cp_alamat').trim();
    const telp = cpVal('cp_telp').trim();
    const email = cpVal('cp_email').trim();
    const rek = profileRekeningDraft.filter(r => r.bank || r.nomor || r.an);
    const wa = profileKontakWaDraft.map(n => (n || '').replace(/\D/g, '')).filter(Boolean);
    const kontak = [alamat, telp ? 'Telp. ' + telp : '', email].filter(Boolean).map(escapeHtml).join(' &middot; ');
    box.innerHTML = `
        <div class="cp-pv-head">
            ${logo ? `<img src="${escapeHtml(logo)}" alt="">` : ''}
            <div>
                <div class="cp-pv-brand">${brand ? escapeHtml(brand) : '<span class="cp-pv-empty">Brand</span>'}</div>
                <div class="cp-pv-nama">${nama ? escapeHtml(nama) : '<span class="cp-pv-empty">Nama perusahaan</span>'}</div>
            </div>
        </div>
        <div class="cp-pv-kontak">${kontak || '<span class="cp-pv-empty">Alamat, telepon &amp; email</span>'}</div>
        <div class="cp-pv-sec">Pembayaran ke rekening</div>
        ${rek.length ? rek.map(r => `<div class="cp-pv-rek"><b>${escapeHtml(r.bank || '-')}</b> ${escapeHtml(r.nomor || '-')}<span>a.n. ${escapeHtml(r.an || '-')}</span></div>`).join('') : '<div class="cp-pv-empty">Belum ada rekening</div>'}
        <div class="cp-pv-sec">Kontak WA marketing</div>
        ${wa.length ? `<div class="cp-pv-wa">${wa.map(n => `<span><i class="bi bi-whatsapp"></i> ${escapeHtml(n)}</span>`).join('')}</div>` : '<div class="cp-pv-empty">Belum ada nomor</div>'}
    `;
}

function renderCompanyProfileForm() {
    profileRekeningDraft = (NOTA_PERUSAHAAN.rekening || []).map(r => ({ ...r }));
    profileKontakWaDraft = (NOTA_PERUSAHAAN.kontak_wa || []).slice();
    profileLogoPendingDataUrl = null;
    profileDirty = false;
    return `
        <div class="cp-wrap">
            <div class="cp-hero">
                <div class="cp-hero-icon"><i class="bi bi-building"></i></div>
                <div>
                    <h4>Profil Perusahaan</h4>
                    <p>Data ini dipakai untuk kop &amp; footer semua nota (Nota Pembayaran, Nota Riwayat, Kuitansi). Ubah di sini, otomatis ikut berubah di semua nota tanpa perlu edit kode.</p>
                </div>
            </div>

            <div class="cp-layout">
                <div class="cp-main">
                    <section class="cp-card">
                        <div class="cp-card-head">
                            <div class="cp-card-icon"><i class="bi bi-card-image"></i></div>
                            <div><h5>Logo</h5><p>Tampil di kop nota dan sidebar.</p></div>
                        </div>
                        <div class="cp-card-body">
                            <div class="cp-logo">
                                <div class="cp-logo-tile"><img id="cp_logo_preview" src="${escapeHtml(NOTA_PERUSAHAAN.logo)}" alt="Logo"></div>
                                <div class="cp-logo-info">
                                    <label class="cp-btn-upload" for="cp_logo_file"><i class="bi bi-upload"></i> Pilih Logo</label>
                                    <input type="file" id="cp_logo_file" class="cp-file-input" accept="image/png,image/jpeg,image/webp,image/svg+xml" onchange="handleCompanyLogoUpload(this)">
                                    <div id="cp_logo_name" class="cp-logo-name"></div>
                                    <p class="cp-hint">PNG/JPEG/WebP/SVG, disarankan latar transparan, maks 2MB.</p>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section class="cp-card">
                        <div class="cp-card-head">
                            <div class="cp-card-icon"><i class="bi bi-briefcase-fill"></i></div>
                            <div><h5>Identitas</h5><p>Nama dan kontak resmi yang dicetak di kop nota.</p></div>
                        </div>
                        <div class="cp-card-body">
                            <div class="cp-grid">
                                <div class="cp-field">
                                    <label for="cp_brand">Brand / Nama Singkat<span class="required">*</span></label>
                                    <input type="text" id="cp_brand" value="${escapeHtml(NOTA_PERUSAHAAN.brand)}" placeholder="Contoh: AMIRU TOUR" oninput="onCompanyProfileInput(this)">
                                </div>
                                <div class="cp-field">
                                    <label for="cp_telp">Telepon</label>
                                    <input type="text" id="cp_telp" value="${escapeHtml(NOTA_PERUSAHAAN.telp)}" placeholder="0851-xxxx-xxxx" oninput="onCompanyProfileInput(this)">
                                </div>
                                <div class="cp-field full">
                                    <label for="cp_nama">Nama Perusahaan (Resmi)<span class="required">*</span></label>
                                    <input type="text" id="cp_nama" value="${escapeHtml(NOTA_PERUSAHAAN.nama)}" placeholder="Contoh: PT AMIRU HARAMAIN INDONESIA" oninput="onCompanyProfileInput(this)">
                                </div>
                                <div class="cp-field full">
                                    <label for="cp_alamat">Alamat<span class="required">*</span></label>
                                    <textarea id="cp_alamat" rows="2" placeholder="Alamat lengkap perusahaan" oninput="onCompanyProfileInput(this)">${escapeHtml(NOTA_PERUSAHAAN.alamat)}</textarea>
                                </div>
                                <div class="cp-field full">
                                    <label for="cp_email">Email</label>
                                    <input type="email" id="cp_email" value="${escapeHtml(NOTA_PERUSAHAAN.email)}" placeholder="nama@domain.com" oninput="onCompanyProfileInput(this)">
                                </div>
                            </div>
                        </div>
                    </section>

                    <section class="cp-card">
                        <div class="cp-card-head">
                            <div class="cp-card-icon"><i class="bi bi-bank"></i></div>
                            <div><h5>Rekening Pembayaran</h5><p>Dicetak di footer semua nota. Bisa lebih dari satu.</p></div>
                        </div>
                        <div class="cp-card-body">
                            <div id="cp_rekening_list"></div>
                            <button type="button" class="cp-add" onclick="addCompanyRekeningRow()"><i class="bi bi-plus-lg"></i> Tambah Rekening</button>
                        </div>
                    </section>

                    <section class="cp-card">
                        <div class="cp-card-head">
                            <div class="cp-card-icon"><i class="bi bi-whatsapp"></i></div>
                            <div><h5>Kontak WA Marketing</h5><p>Dicetak di penutup caption marketing (Teks WA Otomatis &amp; Caption AI). Berbeda dari field Telepon di atas.</p></div>
                        </div>
                        <div class="cp-card-body">
                            <div id="cp_kontak_wa_list"></div>
                            <button type="button" class="cp-add" onclick="addCompanyKontakWaRow()"><i class="bi bi-plus-lg"></i> Tambah Nomor WA</button>
                        </div>
                    </section>

                    <section class="cp-card">
                        <div class="cp-card-head">
                            <div class="cp-card-icon"><i class="bi bi-file-earmark-pdf-fill"></i></div>
                            <div><h5>Unduh PDF</h5><p>Pintasan ke dokumen PDF di aplikasi ini, tanpa perlu membuka menu masing-masing.</p></div>
                        </div>
                        <div class="cp-card-body">
                            <div class="cp-pdf-title">Dokumen umum</div>
                            <div class="cp-pdf-grid">
                                ${cpPdfTombol('jadwal', 'bi-calendar-event', 'Jadwal Umrah', 'Semua program, A4 landscape')}
                                ${cpPdfTombol('rencana', 'bi-instagram', 'Rencana Konten IG', 'Laporan 12 bulan, A4 landscape')}
                                ${cpPdfTombol('pola', 'bi-diagram-3', 'Pola Konten IG', 'About Planner, A4 landscape')}
                            </div>

                            <div class="cp-pdf-title">Per program</div>
                            <div class="cp-field full">
                                <label for="cp_pdf_program">Program</label>
                                <select id="cp_pdf_program" onchange="cpPdfPilihProgram(this.value)">${cpPdfOpsiProgram()}</select>
                            </div>
                            <div class="cp-pdf-grid">
                                ${cpPdfTombol('manifest', 'bi-people-fill', 'Manifest', 'Daftar jamaah program terpilih')}
                                ${cpPdfTombol('rooming', 'bi-door-open-fill', 'Rooming List', 'Pembagian kamar program terpilih')}
                            </div>

                            <div class="cp-pdf-title">Per jamaah</div>
                            <div class="cp-field full">
                                <label for="cp_pdf_jamaah">Jamaah <span class="cp-label-hint">(pilih program dulu)</span></label>
                                <select id="cp_pdf_jamaah" disabled><option value="">-- Pilih jamaah --</option></select>
                            </div>
                            <div class="cp-pdf-grid">
                                ${cpPdfTombol('tandaterima', 'bi-file-earmark-check-fill', 'Tanda Terima Dokumen', 'Bukti penyerahan dokumen jamaah')}
                            </div>

                            <p class="cp-hint">Nota Pembayaran, Nota Riwayat, dan Kuitansi tidak ada di sini karena setiap unduhannya mencatat Kode Verifikasi ke sistem audit. Buka dari menu Pembayaran supaya pratinjau dan catatannya tetap terjaga.</p>
                        </div>
                    </section>
                </div>

                <aside class="cp-aside">
                    <div class="cp-aside-title"><i class="bi bi-eye"></i> Pratinjau kop &amp; footer nota <span class="cp-live">Langsung</span></div>
                    <div id="cp_preview" class="cp-preview"></div>
                    <p class="cp-hint">Ringkasan saja. Tata letak nota sebenarnya bisa sedikit berbeda.</p>
                </aside>
            </div>

            <div class="cp-savebar">
                <div class="cp-savebar-info">
                    <span id="cp_dirty" class="cp-dirty" hidden><i class="bi bi-circle-fill"></i> Ada perubahan belum disimpan</span>
                    <div id="cpProfileStatus"></div>
                </div>
                <button class="btn-primary" onclick="saveCompanyProfile()"><i class="bi bi-save-fill"></i> Simpan Profil</button>
            </div>
        </div>
    `;
}

function renderCompanyRekeningRows() {
    const wrap = document.getElementById('cp_rekening_list');
    if (!wrap) return;
    if (!profileRekeningDraft.length) {
        wrap.innerHTML = `<p class="cp-rekening-empty"><i class="bi bi-bank"></i> Belum ada rekening. Klik "Tambah Rekening" di bawah.</p>`;
        return;
    }
    wrap.innerHTML = profileRekeningDraft.map((r, i) => `
        <div class="cp-item">
            <div class="cp-item-head">
                <span class="cp-item-badge">${i + 1}</span>
                <span class="cp-item-title">Rekening ${i + 1}</span>
                <button type="button" class="btn-icon-ghost danger" title="Hapus rekening ${i + 1}" onclick="removeCompanyRekeningRow(${i})"><i class="bi bi-trash-fill"></i></button>
            </div>
            <div class="cp-item-grid">
                <div class="cp-field">
                    <label>Nama Bank</label>
                    <input type="text" value="${escapeHtml(r.bank || '')}" placeholder="Contoh: Bank Syariah Indonesia" oninput="updateCompanyRekeningField(${i}, 'bank', this.value)">
                </div>
                <div class="cp-field">
                    <label>Nomor Rekening</label>
                    <input type="text" inputmode="numeric" value="${escapeHtml(r.nomor || '')}" placeholder="Contoh: 2026 64 2027" oninput="updateCompanyRekeningField(${i}, 'nomor', this.value)">
                </div>
                <div class="cp-field">
                    <label>Atas Nama</label>
                    <input type="text" value="${escapeHtml(r.an || '')}" placeholder="Contoh: Amiru Tour" oninput="updateCompanyRekeningField(${i}, 'an', this.value)">
                </div>
            </div>
        </div>
    `).join('');
}

function addCompanyRekeningRow() {
    profileRekeningDraft.push({ bank: '', nomor: '', an: '' });
    renderCompanyRekeningRows();
    markCompanyProfileDirty();
}

function removeCompanyRekeningRow(index) {
    profileRekeningDraft.splice(index, 1);
    renderCompanyRekeningRows();
    markCompanyProfileDirty();
}

function updateCompanyRekeningField(index, field, value) {
    if (!profileRekeningDraft[index]) return;
    profileRekeningDraft[index][field] = value;
    markCompanyProfileDirty();
}

function renderCompanyKontakWaRows() {
    const wrap = document.getElementById('cp_kontak_wa_list');
    if (!wrap) return;
    if (!profileKontakWaDraft.length) {
        wrap.innerHTML = `<p class="cp-rekening-empty"><i class="bi bi-whatsapp"></i> Belum ada nomor WA. Klik "Tambah Nomor WA" di bawah.</p>`;
        return;
    }
    wrap.innerHTML = profileKontakWaDraft.map((n, i) => `
        <div class="cp-item cp-item-wa">
            <div class="cp-field">
                <label>Nomor WA ${i + 1} <span class="cp-label-hint">(format 62xxxxxxxxxx)</span></label>
                <input type="text" inputmode="numeric" value="${escapeHtml(n || '')}" placeholder="Contoh: 6285122336300" oninput="updateCompanyKontakWaField(${i}, this.value)">
            </div>
            <button type="button" class="btn-icon-ghost danger" title="Hapus nomor ${i + 1}" onclick="removeCompanyKontakWaRow(${i})"><i class="bi bi-trash-fill"></i></button>
        </div>
    `).join('');
}

function addCompanyKontakWaRow() {
    profileKontakWaDraft.push('');
    renderCompanyKontakWaRows();
    markCompanyProfileDirty();
}

function removeCompanyKontakWaRow(index) {
    profileKontakWaDraft.splice(index, 1);
    renderCompanyKontakWaRows();
    markCompanyProfileDirty();
}

function updateCompanyKontakWaField(index, value) {
    profileKontakWaDraft[index] = value;
    markCompanyProfileDirty();
}

function handleCompanyLogoUpload(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('❌ Logo terlalu besar! Maksimal 2MB.'); input.value = ''; return; }
    const reader = new FileReader();
    reader.onload = (e) => {
        profileLogoPendingDataUrl = e.target.result;
        const preview = document.getElementById('cp_logo_preview');
        if (preview) preview.src = profileLogoPendingDataUrl;
        const nameEl = document.getElementById('cp_logo_name');
        if (nameEl) nameEl.textContent = file.name || '';
        markCompanyProfileDirty();
    };
    reader.onerror = () => showToast('❌ Gagal membaca file logo.');
    reader.readAsDataURL(file);
}

async function saveCompanyProfile() {
    const statusEl = document.getElementById('cpProfileStatus');
    const brand = document.getElementById('cp_brand').value.trim();
    const nama = document.getElementById('cp_nama').value.trim();
    const alamat = document.getElementById('cp_alamat').value.trim();
    const telp = document.getElementById('cp_telp').value.trim();
    const email = document.getElementById('cp_email').value.trim();
    const rekening = profileRekeningDraft
        .map(r => ({ bank: (r.bank || '').trim(), nomor: (r.nomor || '').trim(), an: (r.an || '').trim() }))
        .filter(r => r.bank || r.nomor || r.an);
    const kontak_wa = profileKontakWaDraft
        .map(n => (n || '').replace(/\D/g, ''))
        .filter(Boolean);

    if (!brand || !nama || !alamat) {
        const kosong = [['cp_brand', brand], ['cp_nama', nama], ['cp_alamat', alamat]]
            .filter(w => !w[1]).map(w => document.getElementById(w[0])).filter(Boolean);
        kosong.forEach(el => { if (el.classList) el.classList.add('cp-invalid'); });
        if (kosong[0] && kosong[0].focus) kosong[0].focus();
        if (statusEl) statusEl.innerHTML = `<p class="cp-status is-error"><i class="bi bi-exclamation-circle-fill"></i> Brand, Nama Perusahaan, dan Alamat wajib diisi.</p>`;
        return;
    }

    const payload = {
        brand,
        nama,
        alamat,
        telp,
        email,
        logo: profileLogoPendingDataUrl || NOTA_PERUSAHAAN.logo,
        rekening,
        kontak_wa
    };

    try {
        if (statusEl) statusEl.innerHTML = `<p class="cp-status"><i class="bi bi-hourglass-split"></i> Menyimpan...</p>`;
        const { error } = await supabaseClient.from('tg_config').upsert(
            [{ key: COMPANY_PROFILE_KEY, value: JSON.stringify(payload) }],
            { onConflict: 'key' }
        );
        if (error) throw error;
        NOTA_PERUSAHAAN = { ...payload };
        profileLogoPendingDataUrl = null;
        profileDirty = false;
        cpRefreshDirty();
        if (statusEl) statusEl.innerHTML = `<p class="cp-status is-ok"><i class="bi bi-check-circle-fill"></i> Profil perusahaan tersimpan.</p>`;
        showToast('✅ Profil perusahaan tersimpan');
    } catch (err) {
        if (statusEl) statusEl.innerHTML = `<p class="cp-status is-error"><i class="bi bi-exclamation-circle-fill"></i> Gagal menyimpan: ${escapeHtml(err.message || 'Error tidak diketahui')}</p>`;
        showToast('❌ Gagal menyimpan profil perusahaan');
    }
}

// ---- Pintasan Unduh PDF (kartu "Unduh PDF" di Profil Perusahaan) ----
function cpPdfTombol(jenis, ikon, judul, ket) {
    return `<button type="button" class="cp-pdf-btn" onclick="cpUnduhPdf('${jenis}', this)">`
        + `<i class="bi ${ikon}"></i><span><b>${escapeHtml(judul)}</b><small>${escapeHtml(ket)}</small></span></button>`;
}

function cpPdfOpsiProgram() {
    const daftar = (typeof sortProgramsDefault === 'function' ? sortProgramsDefault(dataUmroh || []) : (dataUmroh || []));
    return '<option value="">-- Pilih program --</option>' + daftar.map(p =>
        `<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.nama || '-')}${p.tgl ? ' — ' + escapeHtml(p.tgl) : ''}</option>`).join('');
}

// Pilih program -> isi daftar jamaah aktif (bukan arsip) untuk pintasan Tanda Terima Dokumen.
let cpPdfJamaahReq = 0;
async function cpPdfPilihProgram(programId) {
    const sel = document.getElementById('cp_pdf_jamaah');
    if (!sel) return;
    const req = ++cpPdfJamaahReq;
    sel.disabled = true;
    if (!programId) { sel.innerHTML = '<option value="">-- Pilih jamaah --</option>'; return; }
    sel.innerHTML = '<option value="">Memuat jamaah...</option>';
    try {
        const { data, error } = await supabaseClient.from('kb_jamaah').select('id, nama')
            .eq('program_id', programId).eq('diarsipkan', false).order('nama', { ascending: true });
        if (error) throw error;
        if (req !== cpPdfJamaahReq) return; // pilihan program sudah berganti
        sel.innerHTML = (data && data.length)
            ? '<option value="">-- Pilih jamaah --</option>' + data.map(j => `<option value="${escapeHtml(String(j.id))}">${escapeHtml(j.nama || '-')}</option>`).join('')
            : '<option value="">Belum ada jamaah</option>';
        sel.disabled = !(data && data.length);
    } catch (err) {
        if (req !== cpPdfJamaahReq) return;
        console.error('cpPdfPilihProgram error:', err);
        sel.innerHTML = '<option value="">Gagal memuat jamaah</option>';
        showToast('Gagal memuat daftar jamaah: ' + (err.message || err), 'error');
    }
}

// Satu pintu untuk semua tombol. Tiap fungsi tujuan mengurus spinner tombolnya sendiri.
async function cpUnduhPdf(jenis, btn) {
    const programId = (document.getElementById('cp_pdf_program') || {}).value || '';
    const jamaahId = (document.getElementById('cp_pdf_jamaah') || {}).value || '';
    switch (jenis) {
        case 'jadwal': return downloadProgramListPdf(btn);
        case 'rencana': return igUnduhRencanaKontenPdfLangsung(btn);
        case 'pola': return igUnduhAboutPlannerPdf.call(btn);
        case 'manifest':
            if (!programId) { showToast('Pilih program dulu', 'error'); return; }
            return unduhManifestPdfProgram(programId, btn);
        case 'rooming':
            if (!programId) { showToast('Pilih program dulu', 'error'); return; }
            return unduhRoomingListPdfProgram(programId, btn);
        case 'tandaterima':
            if (!programId) { showToast('Pilih program dulu', 'error'); return; }
            if (!jamaahId) { showToast('Pilih jamaah dulu', 'error'); return; }
            return unduhTandaTerimaPdfJamaah(jamaahId, btn);
    }
}

// Mengisi #companyProfileMount (disiapkan renderAdminPanel() di app.js). Hanya render sekali per panel supaya
// isian yang belum disimpan tidak hilang saat pindah subtab; renderAdminPanel() membuat mount baru = form segar.
function renderCompanyProfilePanel() {
    const mount = document.getElementById('companyProfileMount');
    if (!mount || mount.dataset.ready === '1') return;
    mount.innerHTML = renderCompanyProfileForm();
    mount.dataset.ready = '1';
    renderCompanyRekeningRows();
    renderCompanyKontakWaRows();
    updateCompanyProfilePreview();
}

// withBusy() (app.js): anti klik ganda + spinner. Dibungkus di sini karena fungsinya baru ada setelah modul dimuat.
if (typeof window.saveCompanyProfile === 'function') window.saveCompanyProfile = withBusy(window.saveCompanyProfile);
