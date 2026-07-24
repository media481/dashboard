    // Admin Panel (dengan cache refresh)
    function openAdminModal() { 
        checkSession();
        document.getElementById('adminModal').classList.add('show'); 
        const pubWrapper = document.getElementById('pubTabsWrapper');
        if (pubWrapper) pubWrapper.style.display = 'none';
        renderAdminPanel(); 
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function closeAdminModal() { 
        document.getElementById('adminModal').classList.remove('show'); 
        const pubWrapper = document.getElementById('pubTabsWrapper');
        if (pubWrapper) pubWrapper.style.display = '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function renderMaskapaiOptions(selected='') { let opts='<option value="">-- Pilih Maskapai --</option>'; MASKAPAI_LIST.forEach(m=>opts+=`<option value="${escapeHtml(m)}" ${selected===m?'selected':''}>${escapeHtml(m)}</option>`); return opts; }
    
    async function renderAdminPanel() {
        const container = document.getElementById('adminModalBody');
        if (adminLoggedIn) {
            const isAdmin = currentRole === 'administrator';

            // Tampilkan role badge & tombol logout di header modal
            const roleBadge = document.getElementById('adminRoleBadge');
            if (roleBadge) {
                roleBadge.style.display = 'inline';
                roleBadge.textContent = isAdmin ? '\u{1F451} Administrator' : '\u{1F3A7} CS';
            }
            const headerLogoutBtn = document.getElementById('adminHeaderLogoutBtn');
            if (headerLogoutBtn) headerLogoutBtn.style.display = 'flex';

            const { data } = await supabaseClient.from('programs').select('*').order('created_at');
            adminPrograms = data || [];
            const featuredCount = getFeaturedIds().length;
            const jadwalCount = jadwalList.length;
            const programCount = adminPrograms.length;

            const lockIcon = `<i class="fas fa-lock" style="font-size:10px;opacity:.55;margin-left:2px;" title="Hanya Administrator"></i>`;

            container.innerHTML = `
            <!-- TOOLBAR -->
            ${isAdmin ? '' : `
            <div class="admin-toolbar" style="background:#faf5ff;border-color:#c4b5fd;align-items:center;">
                <span style="font-size:13px;font-weight:600;color:#5b21b6;"><i class="fas fa-headset"></i> Login sebagai CS &mdash; hanya dapat mengelola Jadwal Tamu</span>
            </div>`}

            <!-- FORM TAMBAH/EDIT (hanya administrator) -->
            ${isAdmin ? `
            <div id="adminFormContainer" style="display:none;" class="admin-form">
                <div class="admin-form-header">
                    <span><i class="fas fa-edit"></i> <span id="adminFormTitle">Tambah Program Baru</span></span>
                    <button class="admin-btn" onclick="hideAdminForm()">&times;</button>
                </div>
                <!-- PARSE DARI TEKS -->
                <div id="parseBroadcastBox" style="padding:16px 20px;background:#f0fdf4;border-bottom:1px solid #bbf7d0;">
                    <div style="font-size:12px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;display:flex;align-items:center;gap:6px;"><i class="fas fa-magic"></i> Auto-isi dari Teks Broadcast</div>
                    <textarea id="parseBroadcastInput" rows="4" placeholder="Paste teks broadcast program umroh di sini, lalu klik Isi Otomatis..." style="width:100%;padding:8px 12px;border:1px solid #86efac;border-radius:6px;font-size:12.5px;resize:vertical;font-family:inherit;background:#fff;outline:none;line-height:1.6;"></textarea>
                    <div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
                        <button onclick="parseBroadcastText()" style="background:#16a34a;color:#fff;border:none;padding:7px 16px;border-radius:6px;font-size:12.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;"><i class="fas fa-wand-magic-sparkles"></i> Isi Otomatis</button>
                        <button onclick="document.getElementById('parseBroadcastInput').value=''" style="background:transparent;color:#16a34a;border:1px solid #86efac;padding:7px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Hapus</button>
                        <span id="parseStatus" style="font-size:12px;color:#15803d;font-weight:600;display:none;"></span>
                    </div>
                </div>
                <div class="admin-form-body">
                    <div class="admin-form-group admin-full-width"><label>Nama Program *</label><input type="text" id="admin_nama" placeholder="Contoh: Umroh Akbar Bareng UAS" maxlength="200"></div>
                    <div class="admin-form-group"><label>Tanggal</label><input type="date" id="admin_tgl_date"><input type="hidden" id="admin_tgl"><small style="color:#64748b">Pilih tanggal dari kalender</small></div>
                    <div class="admin-form-group"><label>Durasi</label><input type="text" id="admin_durasi" placeholder="9 Hari" maxlength="50"></div>
                    <div class="admin-form-group"><label>Maskapai</label><select id="admin_maskapai">${renderMaskapaiOptions()}</select></div>
                    <div class="admin-form-group"><label>Harga</label><input type="text" id="admin_harga_quint" placeholder="Rp 32.500.000" maxlength="50"></div>
                    <div class="admin-form-group"><label>Link Form</label><input type="url" id="admin_link_form" placeholder="https://..."></div>
                    <div class="admin-form-group"><label>Link Itinerary</label><input type="url" id="admin_link_itinerary" placeholder="https://..."></div>
                    <div class="admin-form-group"><label>Link Poster</label><input type="url" id="admin_link_poster" placeholder="https://..."></div>
                    <div class="admin-form-group"><label>Link Meta Ads</label><input type="url" id="admin_link_metaads" placeholder="https://..."></div>
                    <div class="admin-form-group"><label>Link Dokumentasi</label><input type="url" id="admin_link_dokumentasi" placeholder="https://..."></div>
                    <div class="admin-form-group admin-full-width"><label>Teks WA</label><textarea id="admin_teks_wa" rows="4" placeholder="Kosongkan untuk generate otomatis" maxlength="5000"></textarea></div>
                </div>
                <!-- ADMIN-ONLY: Data Lengkap untuk Crosscheck -->
                <div style="padding:0 20px;margin-bottom:4px;">
                    <div style="font-size:11px;font-weight:800;color:#7c3aed;text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:6px;padding:10px 0 8px;border-top:1px dashed #c4b5fd;margin-top:4px;">
                        <i class="fas fa-lock" style="font-size:10px;"></i> Data Lengkap Admin (untuk Crosscheck — tidak tampil di publik)
                    </div>
                </div>
                <div class="admin-form-body" style="background:#faf5ff;border-top:1px solid #ede9fe;padding-top:16px;">
                    <div class="admin-form-group"><label style="color:#7c3aed;">Harga Quad</label><input type="text" id="admin_harga_quad" placeholder="Rp 35.000.000" maxlength="50"></div>
                    <div class="admin-form-group"><label style="color:#7c3aed;">Harga Triple</label><input type="text" id="admin_harga_triple" placeholder="Rp 37.500.000" maxlength="50"></div>
                    <div class="admin-form-group"><label style="color:#7c3aed;">Harga Double</label><input type="text" id="admin_harga_double" placeholder="Rp 42.000.000" maxlength="50"></div>
                    <div class="admin-form-group"><label style="color:#7c3aed;">Hotel Makkah</label><input type="text" id="admin_hotel_makkah" placeholder="Nama hotel & bintang" maxlength="100"></div>
                    <div class="admin-form-group"><label style="color:#7c3aed;">Hotel Madinah</label><input type="text" id="admin_hotel_madinah" placeholder="Nama hotel & bintang" maxlength="100"></div>
                    <div class="admin-form-group"><label style="color:#7c3aed;">Makan Makkah</label><input type="text" id="admin_makan_makkah" placeholder="3x Sehari / 2x Sehari" maxlength="80"></div>
                    <div class="admin-form-group"><label style="color:#7c3aed;">Makan Madinah</label><input type="text" id="admin_makan_madinah" placeholder="3x Sehari / 2x Sehari" maxlength="80"></div>
                    <div class="admin-form-group admin-full-width"><label style="color:#7c3aed;">Fasilitas / Termasuk</label><textarea id="admin_termasuk" rows="4" placeholder="Tiket pesawat PP&#10;Visa umroh&#10;Hotel bintang 4&#10;Muthawwif berpengalaman" maxlength="2000" style="background:#fff;"></textarea></div>
                    <div class="admin-form-group admin-full-width"><label style="color:#7c3aed;">Tidak Termasuk</label><textarea id="admin_tidak_termasuk" rows="3" placeholder="Airport tax&#10;Biaya pengurusan paspor&#10;Pengeluaran pribadi" maxlength="1000" style="background:#fff;"></textarea></div>
                    <div class="admin-form-group admin-full-width"><label style="color:#7c3aed;">Catatan Tambahan Admin</label><textarea id="admin_catatan_cx" rows="2" placeholder="Catatan internal untuk crosscheck..." maxlength="500" style="background:#fff;"></textarea></div>
                </div>
                <div class="form-actions">
                    <button class="admin-btn admin-btn-primary" onclick="saveAdminProgram()"><i class="fas fa-save"></i> Simpan</button>
                    <button class="admin-btn" onclick="previewAdminWA()"><i class="fab fa-whatsapp"></i> Preview WA</button>
                    <button class="admin-btn" onclick="hideAdminForm()">Batal</button>
                </div>
            </div>` : ''}

            <!-- TABS -->
            <div class="admin-tabs-bar">
                <button class="admin-tab-btn ${isAdmin ? 'active' : ''}" style="${!isAdmin ? 'opacity:.5;cursor:not-allowed;' : ''}" onclick="${isAdmin ? "switchAdminTab('umroh',this)" : 'showCsLockWarning()'}">
                    <i class="fas fa-kaaba"></i> Program Umroh ${!isAdmin ? lockIcon : ''}
                    <span class="tab-count" id="tabCountUmroh">${programCount}</span>
                </button>
                <button class="admin-tab-btn tab-star" style="${!isAdmin ? 'opacity:.5;cursor:not-allowed;' : ''}" onclick="${isAdmin ? "switchAdminTab('unggulan',this)" : 'showCsLockWarning()'}">
                    <i class="fas fa-star"></i> Program Unggulan ${!isAdmin ? lockIcon : ''}
                    <span class="tab-count" id="tabCountUnggulan">${featuredCount}/3</span>
                </button>
                <button class="admin-tab-btn tab-jadwal ${isAdmin ? '' : 'active'}" onclick="switchAdminTab('jadwal',this)">
                    <i class="fas fa-calendar-check"></i> Jadwal Tamu
                    <span class="tab-count" id="tabCountJadwal">${jadwalCount}</span>
                </button>
                <button class="admin-tab-btn tab-keberangkatan" onclick="switchAdminTab('keberangkatan',this)">
                    <i class="fas fa-plane-departure"></i> Keberangkatan
                    <span class="tab-count" id="tabCountKeberangkatan">${kbJamaahList.length}</span>
                </button>
                ${isAdmin ? `
                <button class="admin-tab-btn tab-crosscheck" onclick="switchAdminTab('crosscheck',this)">
                    <i class="fas fa-magnifying-glass-chart"></i> Crosscheck
                    <span class="tab-count" id="tabCountCrosscheck">0</span>
                </button>` : ''}
                ${isAdmin ? `
                <button class="admin-tab-btn tab-telegram" onclick="switchAdminTab('telegram',this)">
                    <i class="fab fa-telegram"></i> Telegram
                </button>` : ''}
                ${isAdmin ? `
                <button class="admin-tab-btn tab-pengaturan" onclick="switchAdminTab('pengaturan',this)">
                    <i class="fas fa-sliders"></i> Pengaturan
                </button>` : ''}
            </div>

            <!-- TAB: PROGRAM UMROH -->
            <div class="admin-tab-panel ${isAdmin ? 'active' : ''}" id="tab-umroh">
                ${!isAdmin ? `<div style="text-align:center;padding:40px 20px;"><i class="fas fa-lock" style="font-size:36px;color:#c4b5fd;display:block;margin-bottom:12px;"></i><p style="font-weight:700;color:#5b21b6;font-size:14px;">Akses Terbatas</p><p style="color:#94a3b8;font-size:13px;">Hanya <strong>Administrator</strong> yang dapat mengelola Program Umroh.</p></div>` : `
                <div class="admin-panel-section-header umroh">
                    <i class="fas fa-mosque" style="color:var(--primary);"></i>
                    <div><div class="sec-title" style="color:var(--primary);">Daftar Program Umroh</div><div class="sec-sub">Kelola semua paket umroh yang tersedia</div></div>
                    <div class="sec-actions">
                        <button class="admin-btn admin-btn-primary" onclick="showAdminForm(); document.getElementById('adminFormContainer').scrollIntoView({behavior:'smooth'})">
                            <i class="fas fa-plus"></i> Tambah
                        </button>
                    </div>
                </div>
                <div class="admin-table">
                    <table>
                        <thead><tr>
                            <th class="sortable-header" onclick="sortAdminTable('nama')">Nama Program <i class="fas fa-sort"></i></th>
                            <th class="sortable-header" onclick="sortAdminTable('harga_quint')">Harga <i class="fas fa-sort"></i></th>
                            <th class="sortable-header" onclick="sortAdminTable('tgl')">Tanggal <i class="fas fa-sort"></i></th>
                            <th>Aksi</th>
                        </tr></thead>
                        <tbody id="adminTableBody"></tbody>
                    </table>
                </div>
                <div class="admin-toolbar" style="margin-top:12px;margin-bottom:0;">
                    <button class="admin-btn" onclick="exportAdminData()"><i class="fas fa-download"></i> Export</button>
                    <button class="admin-btn" onclick="importAdminData()"><i class="fas fa-upload"></i> Import</button>
                    <button class="admin-btn admin-btn-danger" onclick="clearAllAdminData()" style="margin-left:auto;"><i class="fas fa-trash"></i> Hapus Semua</button>
                </div>`}
            </div>

            <!-- TAB: PROGRAM UNGGULAN -->
            <div class="admin-tab-panel" id="tab-unggulan">
                ${!isAdmin ? `<div style="text-align:center;padding:40px 20px;"><i class="fas fa-lock" style="font-size:36px;color:#c4b5fd;display:block;margin-bottom:12px;"></i><p style="font-weight:700;color:#5b21b6;font-size:14px;">Akses Terbatas</p><p style="color:#94a3b8;font-size:13px;">Hanya <strong>Administrator</strong> yang dapat mengelola Program Unggulan.</p></div>` : `
                <div class="admin-panel-section-header unggulan">
                    <i class="fas fa-star" style="color:#d97706;"></i>
                    <div><div class="sec-title" style="color:#92400e;">Program Unggulan</div><div class="sec-sub">Tampil di beranda antara running text dan tabel program</div></div>
                    <div class="sec-actions"><span id="featuredCounter" style="background:#f59e0b;color:#fff;font-size:11px;font-weight:800;padding:4px 12px;border-radius:20px;">${featuredCount}/3</span></div>
                </div>
                <div class="admin-table">
                    <table>
                        <thead><tr><th>Nama Program</th><th>Tanggal</th><th>Status Unggulan</th></tr></thead>
                        <tbody id="featuredAdminTableBody"></tbody>
                    </table>
                </div>`}
            </div>

            <!-- TAB: JADWAL TAMU -->
            <div class="admin-tab-panel ${isAdmin ? '' : 'active'}" id="tab-jadwal">
                <div class="admin-panel-section-header jadwal">
                    <i class="fas fa-calendar-check" style="color:#7c3aed;"></i>
                    <div><div class="sec-title" style="color:#5b21b6;">Jadwal Berkunjung Tamu</div><div class="sec-sub">Rekap tamu yang akan mengunjungi kantor</div></div>
                    <div class="sec-actions">
                        <button class="jadwal-admin-btn" style="padding:7px 14px;font-size:12px;" onclick="openJadwalModal()">
                            <i class="fas fa-plus"></i> Tambah Jadwal
                        </button>
                    </div>
                </div>
                <div class="admin-table">
                    <table>
                        <thead><tr>
                            <th>Nama Tamu</th>
                            <th>Tanggal Kunjungan</th>
                            <th>Jumlah</th>
                            <th>Keperluan</th>
                            <th>Status</th>
                            <th>Aksi</th>
                        </tr></thead>
                        <tbody id="jadwalAdminTableBody"></tbody>
                    </table>
                </div>
            </div>

            <!-- TAB: KEBERANGKATAN -->
            <div class="admin-tab-panel" id="tab-keberangkatan">
                <div class="admin-panel-section-header keberangkatan">
                    <i class="fas fa-plane-departure" style="color:#0369a1;"></i>
                    <div><div class="sec-title" style="color:#1e3a5f;">Data Jamaah Keberangkatan</div><div class="sec-sub">Kelola daftar jamaah per program umroh</div></div>
                    <div class="sec-actions">
                        <button class="kb-add-btn" onclick="openKbModal()"><i class="fa-solid fa-user-plus"></i> Tambah Jamaah</button>
                    </div>
                </div>
                <div id="kbAdminFilterWrap" style="margin-bottom:14px;">
                    <div style="font-size:12px;font-weight:700;color:var(--text-2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px;">Filter Program:</div>
                    <div class="kb-program-selector" id="kbAdminProgramSelector"></div>
                </div>
                <div id="kbAdminJamaahContent">
                    <div class="kb-no-program"><i class="fa-solid fa-plane-departure"></i><p>Pilih program di atas untuk melihat data jamaah.</p></div>
                </div>
            </div>

            <!-- TAB: TELEGRAM SETTINGS -->
            ${isAdmin ? `
            <div class="admin-tab-panel" id="tab-crosscheck">
                <div class="admin-panel-section-header crosscheck">
                    <i class="fas fa-magnifying-glass-chart" style="color:#7c3aed;font-size:16px;"></i>
                    <div>
                        <div class="sec-title" style="color:#5b21b6;">Crosscheck Data Program</div>
                        <div class="sec-sub">Poster dibaca otomatis (OCR) & dibandingkan dengan teks plain saat program disimpan</div>
                    </div>
                </div>
                <!-- Pilih program -->
                <div style="font-size:11.5px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;">Pilih Program:</div>
                <div class="cx-program-selector" id="cxProgramSelector"></div>
                <div id="cxPanelContent">
                    <div class="cx-empty"><i class="fa-solid fa-magnifying-glass-chart"></i><p>Pilih program di atas untuk melihat data crosscheck.</p></div>
                </div>
            </div>` : ''}

            <!-- TAB: TELEGRAM SETTINGS -->
            ${isAdmin ? `
            <div class="admin-tab-panel" id="tab-telegram">
                <div class="admin-panel-section-header telegram">
                    <i class="fab fa-telegram" style="color:#0088cc;font-size:18px;"></i>
                    <div>
                        <div class="sec-title" style="color:#0088cc;">Notifikasi Telegram</div>
                        <div class="sec-sub">Kirim notifikasi otomatis ke grup/chat Telegram</div>
                    </div>
                </div>
                <div class="tg-info-box">
                    <b>📌 Cara Setup:</b><br>
                    1. Buat bot via <b>@BotFather</b> di Telegram → dapatkan <b>Bot Token</b><br>
                    2. Tambahkan bot ke grup/chat yang diinginkan, jadikan <b>Admin</b><br>
                    3. Dapatkan <b>Chat ID</b> via <code>@userinfobot</code> atau <code>https://api.telegram.org/bot[TOKEN]/getUpdates</code><br>
                    4. Buat <b>Edge Function</b> di Supabase bernama <code>send-telegram</code> → isi URL-nya di bawah<br>
                    5. Simpan konfigurasi → notifikasi otomatis aktif!
                </div>
                <div class="tg-settings-grid">
                    <div>
                        <div style="font-size:12px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;">Bot Token</div>
                        <input type="text" id="tg_bot_token" placeholder="1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ"
                            style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:monospace;">
                        <small style="color:var(--text-3);font-size:11px;">Dari @BotFather</small>
                    </div>
                    <div>
                        <div style="font-size:12px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;">Edge Function URL</div>
                        <input type="url" id="tg_edge_url" placeholder="https://xxx.supabase.co/functions/v1/send-telegram"
                            style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:monospace;">
                        <small style="color:var(--text-3);font-size:11px;">URL Edge Function Supabase</small>
                    </div>
                </div>
                <div style="font-size:12px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;">Penerima Notifikasi</div>
                <div style="font-size:11.5px;color:var(--text-3);margin-bottom:10px;">Centang jenis notifikasi yang diterima tiap penerima. <b>Pengingat 1 bulan</b> dikirim otomatis saat halaman dibuka.</div>
                <div class="tg-recipients-list" id="tgRecipientsList"></div>
                <button class="tg-add-btn" onclick="addTgRecipient()"><i class="fas fa-plus"></i> Tambah Penerima</button>
                <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;">
                    <button class="tg-save-btn" onclick="saveTgConfig()"><i class="fas fa-save"></i> Simpan Konfigurasi</button>
                    <button class="tg-test-btn" onclick="testTgNotif()"><i class="fas fa-paper-plane"></i> Test Kirim</button>
                </div>
                <div id="tgStatusMsg" style="margin-top:12px;"></div>
                <div class="tg-notif-log" id="tgNotifLog" style="display:none;">
                    <p style="color:#475569;font-size:11px;margin-bottom:6px;">▶ LOG PENGIRIMAN TELEGRAM:</p>
                </div>
            </div>` : ''}

            <!-- TAB: PENGATURAN -->
            ${isAdmin ? `
            <div class="admin-tab-panel" id="tab-pengaturan">
                <div class="admin-panel-section-header pengaturan">
                    <i class="fas fa-sliders" style="color:var(--primary);font-size:18px;"></i>
                    <div>
                        <div class="sec-title" style="color:var(--primary);">Pengaturan Tampilan</div>
                        <div class="sec-sub">Atur elemen yang tampil di halaman utama untuk semua pengunjung</div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 18px;border:1px solid var(--border);border-radius:10px;background:#fff;flex-wrap:wrap;">
                    <div>
                        <div style="font-weight:700;font-size:13.5px;color:var(--text-1);"><i class="fas fa-arrows-left-right" style="margin-right:6px;color:var(--text-3);"></i>Running Text Program</div>
                        <div style="font-size:12px;color:var(--text-3);margin-top:3px;">Teks berjalan berisi daftar program umroh aktif, tampil di bawah header (bar "Live")</div>
                    </div>
                    <button class="featured-toggle-btn ${tickerEnabled ? 'on' : 'off'}" id="tickerToggleBtn" onclick="toggleTickerEnabled()">
                        <i class="fas fa-power-off"></i> ${tickerEnabled ? 'Aktif' : 'Nonaktif'}
                    </button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 18px;border:1px solid var(--border);border-radius:10px;background:#fff;flex-wrap:wrap;margin-top:12px;">
                    <div>
                        <div style="font-weight:700;font-size:13.5px;color:var(--text-1);"><i class="fas fa-cloud-sun" style="margin-right:6px;color:var(--text-3);"></i>Info Bar (Cuaca / Lokasi / Quote)</div>
                        <div style="font-size:12px;color:var(--text-3);margin-top:3px;">Bar biru paling atas berisi lokasi pengunjung, cuaca, tanggal, salam & quote motivasi</div>
                    </div>
                    <button class="featured-toggle-btn ${infobarEnabled ? 'on' : 'off'}" id="infobarToggleBtn" onclick="toggleInfobarEnabled()">
                        <i class="fas fa-power-off"></i> ${infobarEnabled ? 'Aktif' : 'Nonaktif'}
                    </button>
                </div>
            </div>` : ''}`;

            if (isAdmin) {
                const dateInput = document.getElementById('admin_tgl_date');
                if(dateInput) dateInput.addEventListener('change',function(){
                    if(this.value){const [y,m,d]=this.value.split('-');document.getElementById('admin_tgl').value=formatDateToIndonesian(new Date(parseInt(y),parseInt(m)-1,parseInt(d)));}
                    else document.getElementById('admin_tgl').value='';
                });
                renderAdminTable();
            }
            renderJadwalAdminTable();
        } else {
            const roleBadge = document.getElementById('adminRoleBadge');
            if (roleBadge) roleBadge.style.display = 'none';
            const headerLogoutBtn = document.getElementById('adminHeaderLogoutBtn');
            if (headerLogoutBtn) headerLogoutBtn.style.display = 'none';
            container.innerHTML = `<div class="admin-login-box">
                <div class="icon"><i class="fas fa-shield-alt"></i></div>
                <h3>Admin Panel</h3>
                <p style="color:#64748b;font-size:13px;margin-bottom:2px;">Masukkan password untuk masuk</p>
                <p style="color:#94a3b8;font-size:11.5px;">Administrator: akses penuh &nbsp;|&nbsp; CS: kelola jadwal tamu</p>
                <input type="password" id="adminPasswordInput" placeholder="Password" autofocus onkeydown="if(event.key==='Enter')checkAdminLogin()">
                <button onclick="checkAdminLogin()"><i class="fas fa-sign-in-alt"></i> Masuk</button>
                <div id="adminLoginError" style="color:red;font-size:12px;margin-top:16px;"></div>
            </div>`;
            setTimeout(()=>{const pwd=document.getElementById('adminPasswordInput');pwd&&pwd.focus();},100);
        }
    }

    function switchAdminTab(name, btn) {
        document.querySelectorAll('.admin-tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
        const panel = document.getElementById('tab-' + name);
        if (panel) panel.classList.add('active');
        if (btn) btn.classList.add('active');
        if (name === 'keberangkatan') {
            // Pastikan data sudah loaded sebelum render selector
            if (kbJamaahList.length > 0 || dataUmroh.length > 0) {
                renderKbAdminSelector();
            } else {
                loadKbJamaah().then(() => renderKbAdminSelector());
            }
        }
        if (name === 'crosscheck') {
            renderCxProgramSelector();
            if (cxSelectedProgram) renderCxPanel(cxSelectedProgram);
        }
        if (name === 'telegram') {
            renderTgRecipients();
        }
    }
    window.switchAdminTab = switchAdminTab;

    function renderKbAdminSelector(selectedId) {
        const sel = document.getElementById('kbAdminProgramSelector');
        if (!sel) return;
        if (!dataUmroh || dataUmroh.length === 0) {
            sel.innerHTML = '<div style="font-size:13px;color:var(--text-3);font-style:italic;">Belum ada data program.</div>';
            return;
        }
        const activeId = selectedId || kbSelectedAdminProgram || null;
        // Admin: tampilkan SEMUA program (supaya bisa input ke program manapun)
        // tapi bedakan yang sudah ada jamaahnya vs belum
        const programs = dataUmroh.slice().sort((a,b) => (a.dateObj||0) - (b.dateObj||0));
        const programsWithJamaah = programs.filter(p => kbJamaahList.some(j => String(j.program_id) === String(p.id)));
        // Tampilkan hanya yang sudah ada jamaahnya di selector; kalau kosong, tampilkan info
        if (programsWithJamaah.length === 0) {
            sel.innerHTML = '<div style="font-size:13px;color:var(--text-3);font-style:italic;">Belum ada data jamaah. Klik Tambah Jamaah untuk mulai input.</div>';
            const content = document.getElementById('kbAdminJamaahContent');
            if (content) content.innerHTML = `<div class="kb-no-program"><i class="fa-solid fa-plane-departure"></i><p>Belum ada data jamaah. Klik tombol Tambah Jamaah di atas.</p></div>`;
            return;
        }
        // Reset activeId jika programnya sudah tidak ada di list
        const resolvedId = (activeId && programsWithJamaah.find(p => String(p.id) === String(activeId))) ? activeId : null;
        if (resolvedId !== kbSelectedAdminProgram) kbSelectedAdminProgram = resolvedId;
        sel.innerHTML = programsWithJamaah.map(p => {
            const count = kbJamaahList.filter(j => String(j.program_id) === String(p.id)).length;
            const isActive = String(resolvedId) === String(p.id);
            return `<button class="kb-program-pill${isActive?' active':''}" onclick="selectKbAdminProgram('${escapeHtml(String(p.id))}')">
                ${escapeHtml(p.nama||'Program')}
                <span class="pill-count">${count}</span>
            </button>`;
        }).join('');
        renderKbAdminContent(resolvedId);
    }

    let kbSelectedAdminProgram = null;
    function selectKbAdminProgram(id) {
        kbSelectedAdminProgram = id;
        renderKbAdminSelector(id);
    }

    function renderKbAdminContent(progId) {
        const content = document.getElementById('kbAdminJamaahContent');
        if (!content) return;
        if (!progId) {
            content.innerHTML = `<div class="kb-no-program"><i class="fa-solid fa-plane-departure"></i><p>Pilih program di atas untuk melihat data jamaah.</p></div>`;
            return;
        }
        const prog = dataUmroh.find(p => String(p.id) === String(progId));
        if (!prog) return;
        const jamaah = kbJamaahList.filter(j => String(j.program_id) === String(progId));
        const totalLunas = jamaah.filter(j => j.status === 'lunas').length;
        const totalDp = jamaah.filter(j => j.status === 'dp').length;
        let tableRows = '';
        if (jamaah.length === 0) {
            tableRows = `<tr><td colspan="7"><div class="kb-empty"><i class="fa-solid fa-users"></i><p>Belum ada data jamaah untuk program ini.</p></div></td></tr>`;
        } else {
            const sorted = [...jamaah].sort((a,b) => (a.nama||'').localeCompare(b.nama||''));
            tableRows = sorted.map((j,i) => {
                const statusClass = j.status === 'lunas' ? 'kb-status-lunas' : j.status === 'dp' ? 'kb-status-dp' : 'kb-status-pending';
                const statusLabel = j.status === 'lunas' ? 'Lunas' : j.status === 'dp' ? 'DP / Cicil' : 'Pending';
                return `<tr>
                    <td style="color:var(--text-3);font-size:12px;">${i+1}</td>
                    <td><span class="kb-jamaah-name">${escapeHtml(j.nama||'-')}</span>${j.nik?`<span class="kb-jamaah-nik">NIK: ${escapeHtml(j.nik)}</span>`:''}</td>
                    <td style="font-size:12.5px;font-weight:600;">${escapeHtml(j.paspor||'-')}</td>
                    <td style="font-size:12.5px;">${escapeHtml(j.asal||'-')}</td>
                    <td style="font-size:12.5px;">${j.wa ? escapeHtml(j.wa) : '-'}</td>
                    <td><span class="kb-status-pill ${statusClass}">${statusLabel}</span></td>
                    <td><div class="admin-action-btns">
                        <button onclick="kbEditFromAdmin=true;openKbModal('${j.id}');" style="background:#ede9fe;color:#7c3aed;"><i class="fas fa-edit"></i> Edit</button>
                        ${j.wa ? `<button onclick="kbHubungi('${escapeHtml(j.wa)}','${escapeHtml(j.nama||'')}')" style="background:#dcfce7;color:#16a34a;"><i class="fab fa-whatsapp"></i></button>` : ''}
                        <button onclick="deleteKbJamaahAdmin('${j.id}')" style="background:#fee2e2;color:#dc2626;"><i class="fas fa-trash"></i></button>
                    </div></td>
                </tr>`;
            }).join('');
        }
        const tglDisplay = prog.tgl ? prog.tgl : '-';
        content.innerHTML = `
        <div class="kb-section-header">
            <div class="kb-section-title">
                <i class="fa-solid fa-plane-departure"></i>
                <div>
                    <div class="kb-prog-name">${escapeHtml(prog.nama||'Program')}</div>
                    <div class="kb-prog-date"><i class="fa-solid fa-calendar" style="margin-right:4px;"></i>${tglDisplay} &nbsp;·&nbsp; ${escapeHtml(prog.maskapai||'-')}</div>
                </div>
            </div>
            <div class="kb-section-meta">
                <span class="kb-chip total"><i class="fa-solid fa-users" style="margin-right:4px;"></i>${jamaah.length} Jamaah</span>
                <span class="kb-chip lunas">${totalLunas} Lunas</span>
                ${totalDp>0?`<span class="kb-chip dp">${totalDp} DP</span>`:''}
            </div>
        </div>
        <div class="kb-jamaah-table-wrap">
            <table class="kb-jamaah-table">
                <thead><tr><th>#</th><th>Nama Jamaah</th><th>No. Paspor</th><th>Asal Daerah</th><th>WhatsApp</th><th>Status Bayar</th><th>Aksi</th></tr></thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>`;
        const badge = document.getElementById('tabCountKeberangkatan');
        if (badge) badge.textContent = kbJamaahList.length;
    }

    let kbEditFromAdmin = false;
    window.__kbEditFromAdminProxy = { get val() { return kbEditFromAdmin; }, set val(v) { kbEditFromAdmin = v; } };

    async function deleteKbJamaahAdmin(id) {
        if (!confirm('Hapus data jamaah ini?')) return;
        const { error } = await supabaseClient.from('kb_jamaah').delete().eq('id', id);
        if (error) { showToast('❌ Gagal hapus: ' + error.message); return; }
        kbJamaahList = kbJamaahList.filter(j => j.id !== id);
        renderKbAdminSelector(kbSelectedAdminProgram);
        showToast('🗑️ Data jamaah dihapus');
    }
    window.deleteKbJamaahAdmin = deleteKbJamaahAdmin;
    window.renderKbAdminSelector = renderKbAdminSelector;
    window.selectKbAdminProgram = selectKbAdminProgram;
    
    function renderAdminTable() {
        const tbody=document.getElementById('adminTableBody');
        if(!tbody) return;
        const tabBadge = document.getElementById('tabCountUmroh');
        if (tabBadge) tabBadge.textContent = adminPrograms.length;
        if(!adminPrograms.length){tbody.innerHTML='<tr><td colspan="4" style="text-align:center;padding:40px;">Belum ada program.</td></tr>';return;}
        tbody.innerHTML='';
        adminPrograms.forEach(p=>{
            const isActive = p.is_active !== false;
            tbody.innerHTML+=`<tr class="${isActive?'':'admin-row-disabled'}"><td><strong>${escapeHtml(p.nama||'-')}</strong>${isActive?'':'<span class="program-status-badge off">Nonaktif</span>'}</td><td>${escapeHtml(p.harga_quint||'-')}</td><td>${escapeHtml(p.tgl||'-')}</td><td class="admin-action-btns"><button onclick="editAdminProgram('${p.id}')" style="background:#e0f2fe;color:#0284c7;"><i class="fas fa-edit"></i> Edit</button><button class="${isActive?'btn-disable':'btn-enable'}" onclick="toggleProgramActive('${p.id}', ${isActive})"><i class="fas fa-power-off"></i> ${isActive?'Disable':'Aktifkan'}</button><button class="btn-duplicate" onclick="duplicateAdminProgram('${p.id}')" style="background:#fef9c3;color:#854d0e;border:1px solid #fde68a;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s;"><i class="fas fa-copy"></i> Duplikat</button><button onclick="deleteAdminProgram('${p.id}')" style="background:#fee2e2;color:#dc2626;"><i class="fas fa-trash"></i> Hapus</button></td></tr>`;
        });
        renderFeaturedAdminTable();
    }
    
    function getAdminFormData() { 
        return { 
            nama: document.getElementById('admin_nama')?.value.trim()||'', 
            tgl: document.getElementById('admin_tgl')?.value||(document.getElementById('admin_tgl_date')?.value?(()=>{const [y,m,d]=document.getElementById('admin_tgl_date').value.split('-');return formatDateToIndonesian(new Date(parseInt(y),parseInt(m)-1,parseInt(d)));})():''), 
            durasi: document.getElementById('admin_durasi')?.value||'', 
            maskapai: document.getElementById('admin_maskapai')?.value||'', 
            link_form: document.getElementById('admin_link_form')?.value||'', 
            link_itinerary: document.getElementById('admin_link_itinerary')?.value||'', 
            link_poster: document.getElementById('admin_link_poster')?.value||'', 
            link_metaads: document.getElementById('admin_link_metaads')?.value||'', 
            link_dokumentasi: document.getElementById('admin_link_dokumentasi')?.value||'', 
            harga_quint: document.getElementById('admin_harga_quint')?.value||'', 
            teks_wa: document.getElementById('admin_teks_wa')?.value||'',
            // Admin-only fields (disimpan di admin_data_lengkap JSON)
            harga_quad: document.getElementById('admin_harga_quad')?.value||'',
            harga_triple: document.getElementById('admin_harga_triple')?.value||'',
            harga_double: document.getElementById('admin_harga_double')?.value||'',
            hotel_makkah: document.getElementById('admin_hotel_makkah')?.value||'',
            hotel_madinah: document.getElementById('admin_hotel_madinah')?.value||'',
            makan_makkah: document.getElementById('admin_makan_makkah')?.value||'',
            makan_madinah: document.getElementById('admin_makan_madinah')?.value||'',
            termasuk: document.getElementById('admin_termasuk')?.value||'',
            tidak_termasuk: document.getElementById('admin_tidak_termasuk')?.value||'',
            catatan_cx: document.getElementById('admin_catatan_cx')?.value||''
        }; 
    }
    
    function setAdminFormData(data) { 
        document.getElementById('admin_nama')&&(document.getElementById('admin_nama').value=data.nama||''); 
        document.getElementById('admin_tgl')&&(document.getElementById('admin_tgl').value=data.tgl||''); 
        if(document.getElementById('admin_tgl_date')){const d=parseDateFromString(data.tgl);if(d&&!isNaN(d.getTime()))document.getElementById('admin_tgl_date').value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;else document.getElementById('admin_tgl_date').value='';} 
        document.getElementById('admin_durasi')&&(document.getElementById('admin_durasi').value=data.durasi||''); 
        const sel=document.getElementById('admin_maskapai');sel&&(data.maskapai?sel.value=data.maskapai:sel.selectedIndex=0); 
        document.getElementById('admin_link_form')&&(document.getElementById('admin_link_form').value=data.link_form||''); 
        document.getElementById('admin_link_itinerary')&&(document.getElementById('admin_link_itinerary').value=data.link_itinerary||''); 
        document.getElementById('admin_link_poster')&&(document.getElementById('admin_link_poster').value=data.link_poster||''); 
        document.getElementById('admin_link_metaads')&&(document.getElementById('admin_link_metaads').value=data.link_metaads||''); 
        document.getElementById('admin_link_dokumentasi')&&(document.getElementById('admin_link_dokumentasi').value=data.link_dokumentasi||''); 
        document.getElementById('admin_harga_quint')&&(document.getElementById('admin_harga_quint').value=data.harga_quint||''); 
        document.getElementById('admin_teks_wa')&&(document.getElementById('admin_teks_wa').value=data.teks_wa||'');
        // Admin-only fields: baca dari admin_data_lengkap (JSON) atau langsung dari data
        const adl = (() => { try { return data.admin_data_lengkap ? (typeof data.admin_data_lengkap === 'string' ? JSON.parse(data.admin_data_lengkap) : data.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
        const setV = (id, val) => { const el=document.getElementById(id); if(el) el.value = val||''; };
        setV('admin_harga_quad',      data.harga_quad      || adl.harga_quad      || '');
        setV('admin_harga_triple',    data.harga_triple    || adl.harga_triple    || '');
        setV('admin_harga_double',    data.harga_double    || adl.harga_double    || '');
        setV('admin_hotel_makkah',    data.hotel_makkah    || adl.hotel_makkah    || '');
        setV('admin_hotel_madinah',   data.hotel_madinah   || adl.hotel_madinah   || '');
        setV('admin_makan_makkah',    data.makan_makkah    || adl.makan_makkah    || '');
        setV('admin_makan_madinah',   data.makan_madinah   || adl.makan_madinah   || '');
        setV('admin_termasuk',        data.termasuk        || adl.termasuk        || '');
        setV('admin_tidak_termasuk',  data.tidak_termasuk  || adl.tidak_termasuk  || '');
        setV('admin_catatan_cx',      data.catatan_cx      || adl.catatan_cx      || '');
    }
    
    function showAdminForm() {
        editingProgramId=null;
        document.getElementById('adminFormTitle').innerText='Tambah Program Baru';
        setAdminFormData({});
        document.getElementById('adminFormContainer').style.display='block';
        // Switch ke tab umroh supaya form terlihat
        const umrohTabBtn = document.querySelector('.admin-tab-btn:not(.tab-star):not(.tab-jadwal):not(.tab-keberangkatan)');
        switchAdminTab('umroh', umrohTabBtn);
    }
    function hideAdminForm() { document.getElementById('adminFormContainer').style.display='none'; }
    
    async function saveAdminProgram() { 
        const nama=document.getElementById('admin_nama')?.value.trim(); 
        if(!nama){alert('Nama program wajib diisi!');return;} 
        
        // Validasi keamanan nama program
        if (!isValidProgramName(nama)) {
            alert('Nama program mengandung karakter tidak valid!');
            return;
        }
        
        const formData=getAdminFormData(); 
        
        // Validasi keamanan URL
        const urlFields = ['link_form', 'link_itinerary', 'link_poster', 'link_metaads', 'link_dokumentasi'];
        for (const field of urlFields) {
            if (formData[field] && !isValidUrl(formData[field])) {
                alert(`Link ${field.replace('_',' ')} tidak valid! Gunakan format https://...`);
                return;
            }
        }
        
        if(!formData.teks_wa)formData.teks_wa=generateAutoWAText(formData);

        // Pack admin-only fields ke admin_data_lengkap JSON
        const adminOnlyFields = ['harga_quad','harga_triple','harga_double','hotel_makkah','hotel_madinah','makan_makkah','makan_madinah','termasuk','tidak_termasuk','catatan_cx'];
        const adl = {};
        adminOnlyFields.forEach(f => { if(formData[f]) adl[f] = formData[f]; });
        const saveData = { ...formData };
        adminOnlyFields.forEach(f => delete saveData[f]);
        if (Object.keys(adl).length > 0) saveData.admin_data_lengkap = JSON.stringify(adl);

        try{
            const isEdit = !!editingProgramId;
            let savedRow;
            if(editingProgramId){ savedRow = await updateProgramById(editingProgramId,saveData); savedRow = savedRow || {id: editingProgramId}; }
            else { savedRow = await insertProgram(saveData); }
            await loadDataFromSupabase(true);await renderAdminPanel();hideAdminForm();showToast('Program berhasil disimpan!');
            // Kirim notif Telegram
            sendTelegramNotif(formatTgProgram(formData, isEdit), 'program');
            // Crosscheck otomatis: kalau ada link poster, baca & bandingkan otomatis di background (tidak menghalangi UI)
            if (saveData.link_poster && savedRow && savedRow.id) {
                autoScanPosterForProgram(savedRow.id);
            }
        }catch(err){showToast('Gagal: '+err.message);} 
    }
    
    async function editAdminProgram(id){const{data}=await supabaseClient.from('programs').select('*').eq('id',id).single();if(data){setAdminFormData(data);editingProgramId=id;document.getElementById('adminFormTitle').innerText='Edit Program';document.getElementById('adminFormContainer').style.display='block';document.getElementById('adminFormContainer').scrollIntoView({behavior:'smooth',block:'start'});}}
    async function duplicateAdminProgram(id){
        const{data}=await supabaseClient.from('programs').select('*').eq('id',id).single();
        if(!data){showToast('❌ Program tidak ditemukan');return;}
        // Salin semua data kecuali id dan tanggal (reset tanggal agar admin isi baru)
        const dupData={...data};
        delete dupData.id;
        delete dupData.created_at;
        dupData.tgl=''; // kosongkan tanggal agar diisi ulang
        dupData.nama='[DUPLIKAT] ' + (dupData.nama||'');
        dupData.is_active=true; // duplikat selalu aktif, terlepas status program asal
        setAdminFormData(dupData);
        editingProgramId=null; // mode insert baru
        document.getElementById('adminFormTitle').innerText='Duplikat Program — Ubah Tanggal & Simpan';
        document.getElementById('adminFormContainer').style.display='block';
        // Scroll ke form
        document.getElementById('adminFormContainer').scrollIntoView({behavior:'smooth',block:'start'});
        showToast('📋 Program diduplikat — ubah tanggal lalu simpan!');
    }
    async function toggleProgramActive(id, currentlyActive){
        const newStatus = !currentlyActive;
        try{
            await updateProgramById(id, { is_active: newStatus });
            const local = adminPrograms.find(p => String(p.id) === String(id));
            if (local) local.is_active = newStatus;
            renderAdminTable();
            await loadDataFromSupabase(true);
            showToast(newStatus ? '✅ Program diaktifkan kembali' : '🚫 Program dinonaktifkan — tersembunyi dari halaman publik');
        }catch(err){
            showToast('Gagal mengubah status: ' + err.message);
        }
    }
    window.toggleProgramActive = toggleProgramActive;
    let pendingDeleteId = null;
    function deleteAdminProgram(id) {
        const prog = adminPrograms.find(p => String(p.id) === String(id));
        if (!prog) return;
        pendingDeleteId = id;
        document.getElementById('deleteConfirmProgName').textContent = prog.nama || 'Program ini';
        document.getElementById('deleteConfirmInput').value = '';
        document.getElementById('deleteConfirmBtn').disabled = true;
        document.getElementById('deleteConfirmModal').classList.add('show');
        setTimeout(() => document.getElementById('deleteConfirmInput').focus(), 100);
    }
    function closeDeleteConfirmModal() {
        document.getElementById('deleteConfirmModal').classList.remove('show');
        pendingDeleteId = null;
    }
    function onDeleteConfirmInput() {
        const prog = adminPrograms.find(p => String(p.id) === String(pendingDeleteId));
        const val = document.getElementById('deleteConfirmInput').value;
        document.getElementById('deleteConfirmBtn').disabled = !prog || val !== prog.nama;
    }
    async function confirmDeleteProgram() {
        if (!pendingDeleteId) return;
        const btn = document.getElementById('deleteConfirmBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menghapus...';
        try {
            await deleteProgramById(pendingDeleteId);
            await loadDataFromSupabase(true);
            await renderAdminPanel();
            closeDeleteConfirmModal();
            showToast('🗑️ Program berhasil dihapus');
        } catch(err) {
            showToast('Gagal hapus: ' + err.message);
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-trash"></i> Hapus Permanen';
        }
    }
    window.deleteAdminProgram = deleteAdminProgram;
    window.closeDeleteConfirmModal = closeDeleteConfirmModal;
    window.onDeleteConfirmInput = onDeleteConfirmInput;
    window.confirmDeleteProgram = confirmDeleteProgram;
    async function clearAllAdminData(){if(confirm('⚠️ PERINGATAN: Hapus SEMUA program?')){try{const{data}=await supabaseClient.from('programs').select('id');for(const prog of data)await deleteProgramById(prog.id);await loadDataFromSupabase(true);await renderAdminPanel();showToast('Semua program dihapus');}catch(err){showToast('Gagal: '+err.message);}}}
    function previewAdminWA(){const data=getAdminFormData();const waText=data.teks_wa||generateAutoWAText(data);alert('📱 Preview Teks WA:\n\n'+waText);}
    async function exportAdminData() {
        showToast('⏳ Menyiapkan backup...');
        try {
            const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY };
            const [resPrograms, resJadwal, resKb, resFeatured] = await Promise.all([
                fetch(`${SUPABASE_URL}/rest/v1/programs?select=*&order=created_at.asc`, { headers }),
                fetch(`${SUPABASE_URL}/rest/v1/jadwal_tamu?select=*&order=tgl.asc`, { headers }),
                fetch(`${SUPABASE_URL}/rest/v1/kb_jamaah?select=*&order=nama.asc`, { headers }),
                fetch(`${SUPABASE_URL}/rest/v1/featured_programs?select=*`, { headers }),
            ]);
            const backup = {
                _meta: {
                    app: 'Amiru Repository',
                    exported_at: new Date().toISOString(),
                    version: '2.0',
                },
                programs:          resPrograms.ok  ? await resPrograms.json()  : [],
                jadwal_tamu:       resJadwal.ok    ? await resJadwal.json()    : [],
                kb_jamaah:         resKb.ok        ? await resKb.json()        : [],
                featured_programs: resFeatured.ok  ? await resFeatured.json() : [],
            };
            const total = backup.programs.length + backup.jadwal_tamu.length + backup.kb_jamaah.length;
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `amiru_backup_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
            showToast(`✅ Backup berhasil — ${total} record`);
        } catch(err) {
            showToast('❌ Gagal backup: ' + err.message);
        }
    }

    function importAdminData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > MAX_FILE_SIZE) { showToast('❌ File terlalu besar! Maksimal 5MB.'); return; }
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const imported = JSON.parse(event.target.result);
                    // Format baru: objek dengan _meta (backup lengkap)
                    if (imported && imported._meta && imported.programs) {
                        const { programs = [], jadwal_tamu = [], kb_jamaah = [], featured_programs = [] } = imported;
                        const tgl = new Date(imported._meta.exported_at).toLocaleString('id-ID');
                        const msg = `Restore backup dari ${tgl}?\n\n` +
                            `• ${programs.length} program umroh\n` +
                            `• ${jadwal_tamu.length} jadwal tamu\n` +
                            `• ${kb_jamaah.length} data jamaah\n` +
                            `• ${featured_programs.length} program unggulan\n\n` +
                            `Data yang sudah ada TIDAK akan dihapus, hanya ditambah/diperbarui.`;
                        if (!confirm(msg)) return;
                        showToast('⏳ Mengimport data...');
                        let ok = 0, fail = 0;
                        for (const prog of programs) {
                            if (prog.nama && isValidProgramName(prog.nama)) {
                                try { await upsertProgram(prog); ok++; } catch { fail++; }
                            }
                        }
                        const hdr = {
                            'apikey': SUPABASE_ANON_KEY,
                            'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
                            'Content-Type': 'application/json',
                            'Prefer': 'resolution=merge-duplicates',
                        };
                        if (jadwal_tamu.length) await fetch(`${SUPABASE_URL}/rest/v1/jadwal_tamu`, { method: 'POST', headers: hdr, body: JSON.stringify(jadwal_tamu) });
                        if (kb_jamaah.length) await fetch(`${SUPABASE_URL}/rest/v1/kb_jamaah`, { method: 'POST', headers: hdr, body: JSON.stringify(kb_jamaah) });
                        if (featured_programs.length) await fetch(`${SUPABASE_URL}/rest/v1/featured_programs`, { method: 'POST', headers: hdr, body: JSON.stringify(featured_programs) });
                        await loadDataFromSupabase(true);
                        await loadJadwal();
                        await loadKbJamaah();
                        await loadFeaturedIds();
                        await renderAdminPanel();
                        showToast(`✅ Restore selesai — ${ok} program${fail ? ', ' + fail + ' gagal' : ''}`);
                    // Format lama: array program saja
                    } else if (Array.isArray(imported)) {
                        if (!confirm(`Import ${imported.length} program umroh? Data yang sudah ada tidak akan dihapus.`)) return;
                        let ok = 0;
                        for (const prog of imported) {
                            if (prog.nama && isValidProgramName(prog.nama)) {
                                try { await upsertProgram(prog); ok++; } catch {}
                            }
                        }
                        await loadDataFromSupabase(true);
                        await renderAdminPanel();
                        showToast(`✅ Import berhasil — ${ok} program`);
                    } else {
                        showToast('❌ Format file tidak dikenali');
                    }
                } catch(err) { showToast('❌ Gagal: ' + err.message); }
            };
            reader.readAsText(file);
        };
        input.click();
    }
    
    function sortAdminTable(column){adminSortAsc=adminSortColumn===column?!adminSortAsc:true;adminSortColumn=column;const programs=[...adminPrograms];programs.sort((a,b)=>{if(column==='tgl'){const dateA=parseDateFromString(a.tgl),dateB=parseDateFromString(b.tgl);return adminSortAsc?dateA-dateB:dateB-dateA;}const vA=String(a[column]||'').toLowerCase(),vB=String(b[column]||'').toLowerCase();return adminSortAsc?vA.localeCompare(vB):vB.localeCompare(vA);});adminPrograms=programs;renderAdminTable();}
    
    function logoutAdmin(){adminLoggedIn=false;currentRole=null;sessionStorage.removeItem('admin_logged_in');sessionStorage.removeItem('admin_role');sessionStorage.removeItem('admin_login_time');if(sessionTimeout)clearTimeout(sessionTimeout);const roleBadge=document.getElementById('adminRoleBadge');if(roleBadge)roleBadge.style.display='none';const headerLogoutBtn=document.getElementById('adminHeaderLogoutBtn');if(headerLogoutBtn)headerLogoutBtn.style.display='none';renderAdminPanel();}
    
