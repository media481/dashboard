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

function renderCompanyProfileForm() {
    profileRekeningDraft = (NOTA_PERUSAHAAN.rekening || []).map(r => ({ ...r }));
    profileKontakWaDraft = (NOTA_PERUSAHAAN.kontak_wa || []).slice();
    profileLogoPendingDataUrl = null;
    return `
        <div class="admin-section-header">
            <div><h4>Profil Perusahaan</h4>
            <p>Data ini dipakai untuk kop &amp; footer semua nota (Nota Pembayaran, Nota Riwayat, Kuitansi) — ubah di sini, otomatis ikut berubah di semua nota tanpa perlu edit kode.</p></div>
        </div>

        <div class="admin-fieldset" style="margin-top:28px;">
            <div class="admin-fieldset-title"><i class="bi bi-card-image"></i> Logo</div>
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
                <img id="cp_logo_preview" src="${escapeHtml(NOTA_PERUSAHAAN.logo)}" alt="Logo" style="height:56px;width:auto;max-width:160px;object-fit:contain;border:1px solid var(--line);border-radius:8px;padding:6px;background:#fff;">
                <div>
                    <input type="file" id="cp_logo_file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onchange="handleCompanyLogoUpload(this)" style="display:block;">
                    <p style="font-size:11.5px;color:var(--ink-soft);margin-top:6px;">PNG/JPEG/WebP/SVG, disarankan latar transparan, maks 2MB.</p>
                </div>
            </div>
        </div>

        <div class="admin-fieldset">
            <div class="admin-fieldset-title"><i class="bi bi-briefcase-fill"></i> Identitas</div>
            <div class="form-group">
                <label>Brand / Nama Singkat<span class="required">*</span></label>
                <input type="text" id="cp_brand" value="${escapeHtml(NOTA_PERUSAHAAN.brand)}" placeholder="Contoh: AMIRU TOUR">
            </div>
            <div class="form-group">
                <label>Nama Perusahaan (Resmi)<span class="required">*</span></label>
                <input type="text" id="cp_nama" value="${escapeHtml(NOTA_PERUSAHAAN.nama)}" placeholder="Contoh: PT AMIRU HARAMAIN INDONESIA">
            </div>
            <div class="form-group">
                <label>Alamat<span class="required">*</span></label>
                <textarea id="cp_alamat" rows="2" placeholder="Alamat lengkap perusahaan">${escapeHtml(NOTA_PERUSAHAAN.alamat)}</textarea>
            </div>
            <div class="form-group">
                <label>Telepon</label>
                <input type="text" id="cp_telp" value="${escapeHtml(NOTA_PERUSAHAAN.telp)}" placeholder="0851-xxxx-xxxx">
            </div>
            <div class="form-group" style="margin-bottom:0;">
                <label>Email</label>
                <input type="email" id="cp_email" value="${escapeHtml(NOTA_PERUSAHAAN.email)}" placeholder="nama@domain.com">
            </div>
        </div>

        <div class="admin-fieldset">
            <div class="admin-fieldset-title"><i class="bi bi-bank"></i> Rekening Pembayaran</div>
            <p style="font-size:12.5px;color:var(--ink-soft);margin-top:-6px;margin-bottom:14px;">Daftar rekening yang dicetak di footer semua nota. Bisa lebih dari satu.</p>
            <div id="cp_rekening_list"></div>
            <button type="button" class="btn-cancel" onclick="addCompanyRekeningRow()"><i class="bi bi-plus-lg"></i> Tambah Rekening</button>
        </div>

        <div class="admin-fieldset">
            <div class="admin-fieldset-title"><i class="bi bi-whatsapp"></i> Kontak WA Marketing</div>
            <p style="font-size:12.5px;color:var(--ink-soft);margin-top:-6px;margin-bottom:14px;">Nomor WA yang dicetak di bagian penutup caption marketing (Generate Teks WA Otomatis &amp; Generate Caption AI) — beda dari field Telepon di atas.</p>
            <div id="cp_kontak_wa_list"></div>
            <button type="button" class="btn-cancel" onclick="addCompanyKontakWaRow()"><i class="bi bi-plus-lg"></i> Tambah Nomor WA</button>
        </div>

        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">
            <button class="btn-primary" onclick="saveCompanyProfile()"><i class="bi bi-save-fill"></i> Simpan Profil</button>
        </div>
        <div id="cpProfileStatus" style="margin-top:12px;"></div>
    `;
}

function renderCompanyRekeningRows() {
    const wrap = document.getElementById('cp_rekening_list');
    if (!wrap) return;
    if (!profileRekeningDraft.length) {
        wrap.innerHTML = `<p class="cp-rekening-empty">Belum ada rekening. Klik "Tambah Rekening" di bawah.</p>`;
        return;
    }
    wrap.innerHTML = profileRekeningDraft.map((r, i) => `
        <div class="cp-rekening-row">
            <div class="cp-rekening-field">
                <label>Nama Bank</label>
                <input type="text" value="${escapeHtml(r.bank || '')}" placeholder="Contoh: Bank Syariah Indonesia" oninput="updateCompanyRekeningField(${i}, 'bank', this.value)">
            </div>
            <div class="cp-rekening-field">
                <label>Nomor Rekening</label>
                <input type="text" value="${escapeHtml(r.nomor || '')}" placeholder="Contoh: 2026 64 2027" oninput="updateCompanyRekeningField(${i}, 'nomor', this.value)">
            </div>
            <div class="cp-rekening-field">
                <label>Atas Nama</label>
                <input type="text" value="${escapeHtml(r.an || '')}" placeholder="Contoh: Amiru Tour" oninput="updateCompanyRekeningField(${i}, 'an', this.value)">
            </div>
            <button type="button" class="btn-icon-ghost danger" title="Hapus" onclick="removeCompanyRekeningRow(${i})"><i class="bi bi-trash-fill"></i></button>
        </div>
    `).join('');
}

function addCompanyRekeningRow() {
    profileRekeningDraft.push({ bank: '', nomor: '', an: '' });
    renderCompanyRekeningRows();
}

function removeCompanyRekeningRow(index) {
    profileRekeningDraft.splice(index, 1);
    renderCompanyRekeningRows();
}

function updateCompanyRekeningField(index, field, value) {
    if (!profileRekeningDraft[index]) return;
    profileRekeningDraft[index][field] = value;
}

function renderCompanyKontakWaRows() {
    const wrap = document.getElementById('cp_kontak_wa_list');
    if (!wrap) return;
    if (!profileKontakWaDraft.length) {
        wrap.innerHTML = `<p class="cp-rekening-empty">Belum ada nomor WA. Klik "Tambah Nomor WA" di bawah.</p>`;
        return;
    }
    wrap.innerHTML = profileKontakWaDraft.map((n, i) => `
        <div class="cp-rekening-row" style="grid-template-columns:1fr auto;">
            <div class="cp-rekening-field">
                <label>Nomor WA (format 62xxxxxxxxxx)</label>
                <input type="text" value="${escapeHtml(n || '')}" placeholder="Contoh: 6285122336300" oninput="updateCompanyKontakWaField(${i}, this.value)">
            </div>
            <button type="button" class="btn-icon-ghost danger" title="Hapus" onclick="removeCompanyKontakWaRow(${i})"><i class="bi bi-trash-fill"></i></button>
        </div>
    `).join('');
}

function addCompanyKontakWaRow() {
    profileKontakWaDraft.push('');
    renderCompanyKontakWaRows();
}

function removeCompanyKontakWaRow(index) {
    profileKontakWaDraft.splice(index, 1);
    renderCompanyKontakWaRows();
}

function updateCompanyKontakWaField(index, value) {
    profileKontakWaDraft[index] = value;
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
        if (statusEl) statusEl.innerHTML = `<p style="color:var(--danger);font-size:13px;"><i class="bi bi-exclamation-circle-fill"></i> Brand, Nama Perusahaan, dan Alamat wajib diisi.</p>`;
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
        if (statusEl) statusEl.innerHTML = `<p style="color:var(--ink-soft);font-size:13px;"><i class="bi bi-hourglass-split"></i> Menyimpan...</p>`;
        const { error } = await supabaseClient.from('tg_config').upsert(
            [{ key: COMPANY_PROFILE_KEY, value: JSON.stringify(payload) }],
            { onConflict: 'key' }
        );
        if (error) throw error;
        NOTA_PERUSAHAAN = { ...payload };
        profileLogoPendingDataUrl = null;
        if (statusEl) statusEl.innerHTML = `<p style="color:var(--success);font-size:13px;"><i class="bi bi-check-circle-fill"></i> Profil perusahaan tersimpan.</p>`;
        showToast('✅ Profil perusahaan tersimpan');
    } catch (err) {
        if (statusEl) statusEl.innerHTML = `<p style="color:var(--danger);font-size:13px;"><i class="bi bi-exclamation-circle-fill"></i> Gagal menyimpan: ${escapeHtml(err.message || 'Error tidak diketahui')}</p>`;
        showToast('❌ Gagal menyimpan profil perusahaan');
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
}

// withBusy() (app.js): anti klik ganda + spinner. Dibungkus di sini karena fungsinya baru ada setelah modul dimuat.
if (typeof window.saveCompanyProfile === 'function') window.saveCompanyProfile = withBusy(window.saveCompanyProfile);
