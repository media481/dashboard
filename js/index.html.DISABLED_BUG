<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Amiru Repository</title>
    <meta name="description" content="Repository Program Umroh PT Amiru Haramain Indonesia">
    <meta name="theme-color" content="#1a6fa8">

    <!-- Security Headers via Meta Tags -->
    <meta http-equiv="X-Content-Type-Options" content="nosniff">
    <meta http-equiv="Referrer-Policy" content="strict-origin-when-cross-origin">

    <!-- Preconnect -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preconnect" href="https://cdnjs.cloudflare.com">
    <link rel="preconnect" href="https://rkdhssbyqqyheczejtix.supabase.co">

    <!-- External CSS -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" media="print" onload="this.media='all'">

    <!-- App CSS -->
    <link rel="stylesheet" href="css/style.css">

    <!-- Supabase SDK -->
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.0/dist/umd/supabase.min.js"></script>
</head>
<body>

</head>
<body>

<header class="portal-header">
    <a href="#" class="logo-area">
        <div class="logo-icon">𝞚</div>
        <div><h3>PT Amiru Haramain Indonesia</h3></div>
    </a>
    <div class="search-wrapper">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" id="searchInput" placeholder="Cari paket, maskapai, fitur... (mis: kereta cepat)">
    </div>
    <nav class="nav-links">
        <a href="https://drive.google.com/drive/folders/1YvMs0hxnenQaae50CuSmp3SobM822NnF?usp=sharing" class="nav-item" target="_blank" rel="noopener noreferrer">Video Promosi</a>
        <a href="https://drive.google.com/open?id=1Kq_iZa6sPBHIG1YAxXhPMNglOkXSDU93&usp=drive_fs" class="nav-item" target="_blank" rel="noopener noreferrer">Semua Paket</a>
        <a href="https://drive.google.com/open?id=1mhoSezYlh3S1xXILHAGc06UzNxeqYnfh&usp=drive_fs" class="nav-item" target="_blank" rel="noopener noreferrer">Media Cetak</a>
        <a href="https://drive.google.com/open?id=1EUChpUcjVUJszl_X6MZIEFW0my09T1e5&usp=drive_fs" class="nav-item" target="_blank" rel="noopener noreferrer">Infografis</a>
        <a href="https://canva.link/75lz6qng8iyea5r" class="nav-item" target="_blank" rel="noopener noreferrer">Konten FAQ</a>
        <a href="#" class="profile-btn" onclick="openAdminModal()"><i class="fa-solid fa-lock"></i>Admin</a>
    </nav>
    <button class="hamburger-btn" onclick="openDrawer()"><i class="fa-solid fa-bars"></i></button>
</header>

<div class="mobile-overlay" id="mobileOverlay" onclick="closeDrawer()">
    <div class="mobile-drawer" onclick="event.stopPropagation()">
        <div class="drawer-header"><span>🕋 Menu Navigasi</span><button class="drawer-close" onclick="closeDrawer()"><i class="fa-solid fa-xmark"></i></button></div>
        <div class="drawer-search"><i class="fa-solid fa-magnifying-glass search-icon"></i><input type="text" id="searchInputMobile" placeholder="Cari paket, fitur..."></div>
        <nav class="drawer-nav">
            <a href="https://drive.google.com/open?id=1YLrU5P7YqxpPKCGlua51pOlEAJeYEhvz&usp=drive_fs" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-file-pen"></i>Form Pendaftaran</a>
            <a href="https://drive.google.com/open?id=1Kq_iZa6sPBHIG1YAxXhPMNglOkXSDU93&usp=drive_fs" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-layer-group"></i>Semua Paket</a>
            <a href="https://drive.google.com/open?id=1mhoSezYlh3S1xXILHAGc06UzNxeqYnfh&usp=drive_fs" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-print"></i>Media Cetak</a>
            <a href="https://drive.google.com/open?id=1EUChpUcjVUJszl_X6MZIEFW0my09T1e5&usp=drive_fs" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-chart-pie"></i>Infografis</a>
            <a href="https://drive.google.com/open?id=1WwfC3kP5v7cStq75A6N7gUnIonKBIoOQ&usp=drive_fs" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-building"></i>Company Profile</a>
        </nav>
        <div class="drawer-admin"><a href="#" onclick="openAdminModal(); closeDrawer();"><i class="fa-solid fa-lock"></i>Masuk sebagai Admin</a></div>
    </div>
</div>

<div class="infobar-wrapper">
    <div class="infobar-content"><div class="infobar-text" id="infoBar">Memuat informasi...</div></div>
</div>

<div class="ticker-wrapper">
    <div class="ticker-label"><i class="fa-solid fa-circle" style="font-size:6px;animation:pulse 1.5s infinite"></i>Live</div>
    <div class="ticker-content"><div class="ticker-text" id="navTicker">Memuat informasi program...</div></div>
</div>


<div id="adminModal" class="admin-modal"><div class="admin-modal-content"><div class="admin-modal-header"><h2><i class="fas fa-database"></i> Admin Panel - Kelola Program Umroh <span id="adminRoleBadge" style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:var(--primary-subtle);color:var(--primary);margin-left:8px;display:none;"></span></h2><button onclick="closeAdminModal()"><i class="fas fa-arrow-left"></i> Kembali</button></div><div class="admin-modal-body" id="adminModalBody"></div></div></div>

<!-- PUBLIC TABS -->
<div class="pub-tabs-wrapper" id="pubTabsWrapper">
    <div class="pub-tabs-bar">
        <button class="pub-tab-btn tab-info" id="pubTabBtnInfo" onclick="switchPubTab('info', this)">
            <span class="pub-tab-icon"></span> Jadwal Tamu
        </button>
        <button class="pub-tab-btn tab-unggulan" id="pubTabBtnUnggulan" onclick="switchPubTab('unggulan', this)">
            <span class="pub-tab-icon"></span> Program Unggulan
        </button>
        <button class="pub-tab-btn active" id="pubTabBtnUmroh" onclick="switchPubTab('umroh', this)">
            <span class="pub-tab-icon"></span> Program Umroh
        </button>
        <button class="pub-tab-btn tab-keberangkatan" id="pubTabBtnKeberangkatan" onclick="switchPubTab('keberangkatan', this)">
            <span class="pub-tab-icon"></span> Detail Keberangkatan
        </button>
    </div>
    <div class="pub-tab-body">

        <!-- TAB: JADWAL TAMU -->
        <div class="pub-tab-panel" id="pub-tab-info">
            <div class="pub-sub-section" id="jadwalSection">
                <div class="pub-sub-header">
                    <div class="pub-sub-label jadwal"><i class="fa-solid fa-calendar-check"></i> Jadwal Berkunjung Tamu</div>
                    <div class="jadwal-today-badge" id="jadwalTodayCount" style="display:none;"><i class="fa-solid fa-bell"></i> <span id="jadwalTodayNum">0</span> tamu hari ini</div>
                </div>
                <div class="jadwal-grid" id="jadwalGrid">
                    <div class="jadwal-empty"><i class="fa-solid fa-calendar-xmark"></i>Belum ada jadwal tamu yang tercatat.</div>
                </div>
            </div>
        </div>

        <!-- TAB: PROGRAM UNGGULAN -->
        <div class="pub-tab-panel" id="pub-tab-unggulan">
            <div class="pub-sub-section" id="featuredSection">
                <div class="pub-sub-header">
                    <div class="pub-sub-label unggulan"><i class="fa-solid fa-star"></i> Program Unggulan</div>
                </div>
                <div class="featured-grid" id="featuredGrid">
                    <div class="featured-empty"><i class="fa-solid fa-star"></i>Belum ada program unggulan yang dipilih.</div>
                </div>
            </div>
        </div>

        <!-- TAB: PROGRAM UMROH -->
        <div class="pub-tab-panel active" id="pub-tab-umroh">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;padding:14px 18px;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:14px;background:var(--surface2);box-shadow:var(--shadow-sm);">
                <div class="page-title-row">
                    <div class="page-title-icon">🗹</div>
                    <div class="page-title"><h2>Program Umroh Amiru Tour</h2><p>PT Amiru Haramain Indonesia</p></div>
                </div>
                <div class="stats-row" id="statsRow"></div>
            </div>
            <div class="table-container">
                <div id="loadingState" class="loading-state" style="padding:0;text-align:left;">
                    <table class="skeleton-table">
                        <tbody id="skeletonBody"></tbody>
                    </table>
                </div>
                <table id="packageTable" style="display:none;">
                    <thead><tr><th class="sortable col-nama" data-sort="nama">Nama Program <span id="icon-nama" class="sort-icon">&#x21D5;</span></th><th class="col-harga">Biaya Program</th><th class="sortable" data-sort="tgl">Berangkat <span id="icon-tgl" class="sort-icon">&#x21D5;</span></th><th class="col-durasi">Durasi</th><th class="sortable col-maskapai" data-sort="maskapai">Maskapai <span id="icon-maskapai" class="sort-icon">&#x21D5;</span></th><th>Aset &amp; Aksi</th><th class="sortable" data-sort="isAvailable">Status <span id="icon-isAvailable" class="sort-icon">&#x21D5;</span></th></tr></thead>
                    <tbody id="tableBody"></tbody>
                </table>
            </div>
        </div>

        <!-- TAB: DETAIL KEBERANGKATAN -->
        <div class="pub-tab-panel" id="pub-tab-keberangkatan">
            <div class="pub-sub-header" style="margin-bottom:14px;">
                <div class="pub-sub-label" style="color:#0369a1;"><i class="fa-solid fa-plane-departure" style="color:#0369a1;"></i> Detail Keberangkatan Jamaah</div>
            </div>
            <!-- Filter program -->
            <div class="kb-program-selector" id="kbProgramSelector">
                <div style="padding:24px;color:var(--text-3);font-size:13px;">Memuat data program...</div>
            </div>
            <!-- Konten jamaah -->
            <div id="kbJamaahContent">
                <div class="kb-no-program">
                    <i class="fa-solid fa-plane-departure"></i>
                    <p>Pilih program di atas untuk melihat daftar jamaah yang berangkat.</p>
                </div>
            </div>
        </div>

    </div>
</div>

<div class="toast" id="toast"><i class="fa-solid fa-check"></i> Teks berhasil disalin!</div>

<footer class="portal-footer-simple"><p class="footer-text">&copy; 2026 <b>PT Amiru Haramain Indonesia</b>. Dibuat dengan tulus untuk tamu-tamu Allah ﷻ</p></footer>

<div class="wa-float">
    <a href="https://wa.me/6282234650150?text=Assalamualaikum%20Mas%20saya%20mau%20bertanya" target="_blank" rel="noopener noreferrer">
        <i class="fab fa-whatsapp"></i>
        <span class="tooltip">Hubungi Admin</span>
    </a>
</div>

<!-- JADWAL TAMU MODAL FORM (Admin) -->
<div id="jadwalModal" class="jadwal-modal">
    <div class="jadwal-modal-content">
        <div class="jadwal-modal-header">
            <h3><i class="fas fa-calendar-plus"></i> <span id="jadwalModalTitle">Tambah Jadwal Tamu</span></h3>
            <button onclick="closeJadwalModal()">&times;</button>
        </div>
        <div class="jadwal-modal-body">
            <div class="jadwal-form-group"><label>Nama Tamu / Rombongan *</label><input type="text" id="jf_nama" placeholder="Contoh: Keluarga Bapak Ahmad" maxlength="150"></div>
            <div class="jadwal-form-group"><label>Asal Daerah</label><input type="text" id="jf_asal" placeholder="Contoh: Ponorogo, Jawa Timur" maxlength="100"></div>
            <div class="jadwal-form-group"><label>Tanggal Kunjungan *</label><input type="date" id="jf_tgl" color-scheme="light"></div>
            <div class="jadwal-form-group"><label>Jam Kunjungan</label><input type="time" id="jf_jam" placeholder="09:00"></div>
            <div class="jadwal-form-group"><label>Jumlah Tamu</label><input type="number" id="jf_jumlah" placeholder="2" min="1" max="999"></div>
            <div class="jadwal-form-group"><label>Keperluan</label><select id="jf_keperluan"><option value="">-- Pilih Keperluan --</option><option>Konsultasi Umroh</option><option>Pendaftaran Umroh</option><option>Pelunasan</option><option>Pengambilan Dokumen</option><option>Silaturahmi</option><option>Lain-lain</option></select></div>
            <div class="jadwal-form-group"><label>No. WhatsApp Tamu</label><input type="tel" id="jf_wa" placeholder="628xxxxxxxxxx" maxlength="20"></div>
            <div class="jadwal-form-group"><label>Catatan</label><textarea id="jf_catatan" rows="3" placeholder="Catatan tambahan..." maxlength="500"></textarea></div>
            <div class="jadwal-form-actions">
                <button class="jadwal-admin-btn" onclick="saveJadwalTamu()"><i class="fas fa-save"></i> Simpan</button>
                <button class="jadwal-admin-btn secondary" onclick="closeJadwalModal()">Batal</button>
            </div>
        </div>
    </div>
</div>

<div id="kbModal" class="kb-modal">
    <div class="kb-modal-content">
        <div class="kb-modal-header">
            <h3><i class="fa-solid fa-user-plus"></i> <span id="kbModalTitle">Tambah Data Jamaah</span></h3>
            <button onclick="closeKbModal()">&times;</button>
        </div>
        <div class="kb-modal-body">
            <div class="kb-form-group">
                <label>Program Keberangkatan *</label>
                <select id="kb_program" onchange=""></select>
            </div>
            <div class="kb-form-row">
                <div class="kb-form-group">
                    <label>Nama Lengkap *</label>
                    <input type="text" id="kb_nama" placeholder="Sesuai paspor" maxlength="150">
                </div>
                <div class="kb-form-group">
                    <label>No. NIK / KTP</label>
                    <input type="text" id="kb_nik" placeholder="16 digit NIK" maxlength="20">
                </div>
            </div>
            <div class="kb-form-row">
                <div class="kb-form-group">
                    <label>No. Paspor</label>
                    <input type="text" id="kb_paspor" placeholder="Contoh: A1234567" maxlength="20">
                </div>
                <div class="kb-form-group">
                    <label>No. WhatsApp</label>
                    <input type="tel" id="kb_wa" placeholder="628xxxxxxxxxx" maxlength="20">
                </div>
            </div>
            <div class="kb-form-row">
                <div class="kb-form-group">
                    <label>Asal Daerah</label>
                    <input type="text" id="kb_asal" placeholder="Kota/Kabupaten" maxlength="100">
                </div>
                <div class="kb-form-group">
                    <label>Status Pembayaran</label>
                    <select id="kb_status">
                        <option value="lunas">Lunas</option>
                        <option value="dp">DP / Cicilan</option>
                        <option value="pending">Pending</option>
                    </select>
                </div>
            </div>
            <div class="kb-form-group">
                <label>Catatan</label>
                <textarea id="kb_catatan" rows="2" placeholder="Catatan tambahan..." maxlength="300"></textarea>
            </div>
            <div class="kb-form-actions">
                <button class="kb-form-btn primary" onclick="saveKbJamaah()"><i class="fa-solid fa-save"></i> Simpan</button>
                <button class="kb-form-btn secondary" onclick="closeKbModal()">Batal</button>
            </div>
        </div>
    </div>
</div>

<div id="detailModal" class="detail-modal"><div class="detail-modal-content"><div class="detail-modal-header"><h3><i class="fas fa-info-circle"></i> Detail Program Umroh</h3><button onclick="closeDetailModal()">&times;</button></div><div class="detail-modal-body" id="detailModalBody"></div></div></div>


<!-- POSTER HOVER POPUP -->
<div id="posterPopup">
    <div class="poster-popup-inner">
        <div class="poster-popup-img-wrap">
            <div class="poster-popup-loading" id="posterPopupLoading">
                <i class="fas fa-spinner"></i>
                <span>Memuat poster...</span>
            </div>
            <div class="poster-popup-error" id="posterPopupError">
                <i class="fas fa-image-slash"></i>
                <span>Gagal memuat poster</span>
            </div>
            <img id="posterPopupImg" src="" alt="Poster" style="display:none;" 
                onload="document.getElementById('posterPopupLoading').style.display='none';this.style.display='block';"
                onerror="document.getElementById('posterPopupLoading').style.display='none';document.getElementById('posterPopupError').style.display='flex';this.style.display='none';">
        </div>
        <div class="poster-popup-label"><i class="fas fa-image"></i> <span id="posterPopupName"></span></div>
    </div>
</div>

<div id="deleteConfirmModal" class="delete-confirm-modal">
    <div class="delete-confirm-box">
        <div class="delete-confirm-header">
            <i class="fas fa-triangle-exclamation"></i>
            <h3>Hapus Program Umroh</h3>
        </div>
        <div class="delete-confirm-body">
            <div class="delete-confirm-warning">
                <i class="fas fa-circle-exclamation"></i>
                <p><strong>Tindakan ini tidak dapat dibatalkan!</strong>Program akan dihapus permanen dari database dan tidak bisa dipulihkan.</p>
            </div>
            <div class="delete-confirm-label">Program yang akan dihapus</div>
            <div class="delete-confirm-prog-name" id="deleteConfirmProgName"></div>
            <div class="delete-confirm-label">Ketik nama program untuk konfirmasi</div>
            <input type="text" class="delete-confirm-input" id="deleteConfirmInput" placeholder="Ketik nama program di sini..." oninput="onDeleteConfirmInput()">
            <div class="delete-confirm-actions">
                <button class="delete-confirm-btn-cancel" onclick="closeDeleteConfirmModal()"><i class="fas fa-xmark"></i> Batal</button>
                <button class="delete-confirm-btn-hapus" id="deleteConfirmBtn" onclick="confirmDeleteProgram()" disabled><i class="fas fa-trash"></i> Hapus Permanen</button>
            </div>
        </div>
    </div>
</div>


<!-- App JS -->
<script src="js/app.js"></script>

</body>
</html>
