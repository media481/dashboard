/* ============================================================
   PENGATURAN (Admin only)
   ============================================================ */
function renderPengaturan(){
  if (!isAdmin()) {
    return `<div class="empty-state"><h3>⛔ Akses Ditolak</h3><p>Halaman Pengaturan hanya untuk Admin.</p><button class="btn" ${da('goSection', 'dashboard')}>Kembali ke Dashboard</button></div>`;
  }
  if (!errorLogCloudLoaded && !errorLogCloudLoading) {
    loadErrorLogFromCloud().then(() => { if (currentSection === 'pengaturan') renderContent(); });
  }
  
  const s = getSettings();
  const telegram = getTelegramSettings();
  const org = getOrgProfil();
  
  return `
  <!-- PROFIL ORGANISASI (white-label: ganti nama+logo di sini, tanpa sentuh kode) -->
  <div class="panel">
    <div class="panel-head">
      <div><h3>🏷️ Profil Organisasi</h3><div class="desc">Nama, logo, dan nama buku kas ini dipakai otomatis di seluruh app (sidebar, kop surat, nota, pesan notifikasi, dll) — cukup diganti di sini, tanpa perlu ubah kode.</div></div>
    </div>
    <div class="panel-body">
      <div class="field-row">
        <div class="field">
          <label>Nama Organisasi</label>
          <input id="org-nama" type="text" value="${esc(org.nama)}" placeholder="Contoh: Karang Taruna Inti">
        </div>
        <div class="field">
          <label>Nama Buku Kas <span style="font-weight:400;color:var(--ink-soft);">(opsional)</span></label>
          <input id="org-nama-kas" type="text" value="${esc(org.namaKas)}" placeholder="Contoh: Kas Karang Taruna">
        </div>
      </div>
      <div class="field">
        <label>Logo (untuk kop surat & nota)</label>
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          <img id="org-logo-preview" src="${esc(getOrgLogo())}" alt="Preview logo" style="width:64px;height:64px;object-fit:contain;border:1px solid var(--garis);border-radius:8px;background:#fff;">
          <label class="btn secondary small">📷 Pilih Gambar<input type="file" accept="image/*" style="display:none;" onchange="pilihOrgLogo(event)"></label>
          <button type="button" class="btn secondary small" ${da('hapusOrgLogo')}>↺ Pakai Logo Bawaan</button>
        </div>
        <div class="hint">Format gambar bebas (PNG/JPG disarankan), disimpan langsung di database — tidak perlu upload ke server terpisah.</div>
      </div>
      <button class="btn" ${da('simpanOrgProfile')}>💾 Simpan Profil Organisasi</button>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><h3>Tarif Iuran Anggota</h3></div>
    <div class="panel-body">
      <div class="field-row">
        <div class="field"><label>Sekolah (Rp)</label><input id="tarif-sekolah" class="currency-input" type="text" value="${formatCurrency(s.tarif.sekolah)}"></div>
        <div class="field"><label>Bekerja (Rp)</label><input id="tarif-bekerja" class="currency-input" type="text" value="${formatCurrency(s.tarif.bekerja)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Perantauan (Rp)</label><input id="tarif-perantauan" class="currency-input" type="text" value="${formatCurrency(s.tarif.perantauan)}"></div>
        <div class="field"><label style="color:var(--ungu);">Khusus</label>
          <div style="padding:10px 12px;background:var(--cream);border:1px solid var(--garis);border-radius:8px;font-size:13px;color:var(--ink-soft);">🔓 Nominal bebas — diisi manual per anggota saat ditambahkan</div>
          <div class="hint">Kategori khusus tidak punya tarif tetap, nominal iurannya diisi langsung saat menambah/mengedit anggota</div>
        </div>
      </div>
      <button class="btn" ${da('simpanTarif')}>Simpan Tarif</button>
    </div>
  </div>

  <!-- HARGA & STOK KUPON JALAN SANTAI: dipakai menu "Jual Kupon Jalan Santai" di
       Pemasukan Lain supaya nominal terhitung otomatis dari jumlah kupon terjual
       x harga ini, dan penjualan dibatasi sesuai stok yang tersedia. -->
  <div class="panel">
    <div class="panel-head"><div><h3>🎟️ Kupon Jalan Santai</h3><div class="desc">Dipakai di menu Pemasukan Lain → Jual Kupon Jalan Santai, supaya nominal terhitung otomatis dari jumlah kupon terjual dan penjualan tidak melebihi stok.</div></div></div>
    <div class="panel-body">
      <div class="field-row">
        <div class="field"><label>Harga per Kupon (Rp)</label><input id="kupon-harga" class="currency-input" type="text" value="${formatCurrency(s.kuponJalanSantai.harga)}"></div>
        <div class="field"><label>Stok Kupon (lembar)</label><input id="kupon-stok" type="number" min="0" step="1" value="${s.kuponJalanSantai.stok||0}"></div>
      </div>
      <div class="hint">Terjual sejauh ini: <b>${totalKuponTerjual()}</b> lembar &middot; Sisa stok: <b>${Math.max(0, (s.kuponJalanSantai.stok||0) - totalKuponTerjual())}</b> lembar</div>
      <button class="btn" ${da('simpanHargaKupon')}>Simpan Harga &amp; Stok Kupon</button>
    </div>
  </div>

  <!-- TELEGRAM NOTIFICATION SETTINGS -->
  <div class="panel">
    <div class="panel-head">
      <div><h3>🤖 Telegram Notifikasi</h3><div class="desc">Kirim notifikasi otomatis ke Telegram setiap ada perubahan data</div></div>
      <span class="status-pill ${telegram.enabled ? 'on' : 'off'}"><span class="status-dot"></span>${telegram.enabled ? 'Aktif' : 'Nonaktif'}</span>
    </div>
    <div class="panel-body">
      <div class="field-row">
        <div class="field field-icon">
          <label>Bot Token</label>
          <span class="field-icon-glyph">🔐</span>
          <input type="text" value="Tersimpan aman di server" disabled>
          <div class="hint">Bot token tidak lagi disimpan di aplikasi (dulu bisa dibaca
            siapa pun lewat browser). Sekarang token dipasang sekali sebagai secret
            Cloudflare: <code>npx wrangler secret put TELEGRAM_BOT_TOKEN</code></div>
        </div>
        <div class="field field-icon">
          <label>Chat ID</label>
          <span class="field-icon-glyph">💬</span>
          <input id="telegram-chat-id" type="text" value="${esc(telegram.chatId||'')}" placeholder="Chat ID tujuan">
          <div class="hint">Bisa didapat dari @userinfobot atau @getidsbot</div>
        </div>
      </div>
      <div class="settings-actions">
        <button class="btn ${telegram.enabled ? 'danger' : 'success'} small" ${da('toggleTelegram')}>
          ${telegram.enabled ? '⛔ Nonaktifkan' : '✅ Aktifkan'}
        </button>
        <button class="btn telegram small" ${da('testTelegram')}>📨 Test Kirim</button>
        <span class="spacer"></span>
        <button class="btn telegram" ${da('simpanTelegram')}>💾 Simpan</button>
      </div>

      <!-- KATEGORI NOTIFIKASI -->
      <div style="margin-top:18px;">
        <div class="settings-subhead">Kategori Notifikasi <span style="font-weight:400;color:var(--ink-soft);">(matikan yang tidak perlu tanpa nonaktifkan semua)</span></div>
        <div class="toggle-grid">
          ${TELEGRAM_CATEGORIES.map(c=>`
            <label class="toggle-chip">
              <input type="checkbox" class="telegram-category-check" data-key="${c.key}" ${telegram.categories[c.key] !== false ? 'checked' : ''} hidden>
              <span class="toggle-box"></span>
              <span class="toggle-icon">${c.icon}</span>
              <span class="toggle-text">${esc(c.label)}</span>
            </label>`).join('')}
        </div>
      </div>

      <!-- JAM TENANG -->
      <div style="margin-top:18px;">
        <div class="settings-subhead">🌙 Jam Tenang <span style="font-weight:400;color:var(--ink-soft);">(tunda kirim notifikasi di jam tertentu, mis. malam hari)</span></div>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:8px;font-weight:400;white-space:nowrap;">
            <input type="checkbox" id="telegram-quiet-enabled" ${telegram.quietHours.enabled ? 'checked' : ''}> Aktifkan Jam Tenang
          </label>
          <div class="field" style="margin-bottom:0;"><label style="font-weight:400;">Mulai</label><input id="telegram-quiet-start" type="time" value="${esc(telegram.quietHours.start)}"></div>
          <div class="field" style="margin-bottom:0;"><label style="font-weight:400;">Sampai</label><input id="telegram-quiet-end" type="time" value="${esc(telegram.quietHours.end)}"></div>
        </div>
        <div class="hint">Notifikasi yang masuk di jam tenang tidak hilang — ditahan dan otomatis dikirim begitu jam tenang berakhir.</div>
      </div>

      <!-- ANTRIAN / KEANDALAN -->
      ${getTelegramQueueCount() > 0 ? `
      <div class="field" style="margin-top:18px;">
        <div style="padding:10px 12px;background:var(--cream);border:1px solid var(--garis);border-radius:8px;font-size:13px;color:var(--ink-soft);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <span>🔔 ${getTelegramQueueCount()} notifikasi menunggu dikirim (gagal terkirim / kena Jam Tenang).</span>
          <button class="btn secondary small" ${da('retryTelegramQueue')}>🔄 Kirim Ulang Sekarang</button>
        </div>
      </div>` : ``}
    </div>
  </div>
  
  <!-- AKSES GUEST -->
  <div class="panel">
    <div class="panel-head">
      <div><h3>👁️ Akses Guest (Belum Login)</h3><div class="desc">Pilih menu yang boleh dilihat pengunjung yang belum login</div></div>
    </div>
    <div class="panel-body">
      <div class="toggle-grid">
        ${SECTIONS.filter(s=>!s.adminOnly).map(s=>`
          <label class="toggle-chip">
            <input type="checkbox" class="guest-menu-check" data-key="${s.key}" ${isGuestVisible(s.key) ? 'checked' : ''} hidden>
            <span class="toggle-box"></span>
            <span class="toggle-icon">${icon(s.icon)}</span>
            <span class="toggle-text">${esc(sectionLabel(s))}</span>
          </label>`).join('')}
      </div>
      <button class="btn" style="margin-top:14px;" ${da('simpanGuestMenu')}>💾 Simpan Akses Guest</button>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <div><h3>Manajemen Event</h3><div class="desc">Kelola event, aktifkan, atau buat event baru</div></div>
      <button class="btn gold small" ${da('openEventModal')}>+ Buat Event</button>
    </div>
    <div class="panel-body flush events-table-wrap">
      <table class="general-table"><thead><tr><th>Nama</th><th>Tahun</th><th></th></tr></thead>
      <tbody>${db.events.map(e=>`<tr><td>${esc(e.nama)}${e.id===db.activeEventId?' <span class="badge lunas">Aktif</span>':''}</td><td>${esc(e.tahun)}</td><td style="text-align:right;white-space:nowrap;">${e.id===db.activeEventId?'':`<button class="btn secondary small" ${da('setActiveEvent', e.id)}>Aktifkan</button>`}<button class="icon-btn" ${da('openEventModal', e.id)} title="Ubah nama/tahun">✎</button><button class="icon-btn" ${da('hapusEvent', e.id)} title="Hapus event">🗑</button></td></tr>`).join('')||`<tr class="empty-row"><td colspan="3">Belum ada event.</td></tr>`}</tbody></table>
    </div>
    <div class="panel-body events-mobile-wrap">
      <div class="jadwal-item-list">${db.events.map(e=>`
        <div class="jadwal-item">
          <div class="jadwal-item-top">
            <div class="jadwal-item-title" style="margin-bottom:0;">${esc(e.nama)}</div>
            ${e.id===db.activeEventId?'<span class="badge lunas">Aktif</span>':''}
          </div>
          <div class="lomba-detail-row"><span class="lbl">📅 Tahun</span><span class="val">${esc(e.tahun)}</span></div>
          <div class="jadwal-item-actions event-card-actions">
            ${e.id===db.activeEventId?'':`<button class="btn secondary small" ${da('setActiveEvent', e.id)}>Aktifkan</button>`}
            <button class="icon-btn" ${da('openEventModal', e.id)} title="Ubah nama/tahun">✎</button>
            <button class="icon-btn" ${da('hapusEvent', e.id)} title="Hapus event">🗑</button>
          </div>
        </div>`).join('') || `<div class="empty-row" style="padding:30px;text-align:center;">Belum ada event.</div>`}</div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Cadangan Data</h3></div>
    <div class="backup-row">
      <div class="backup-info">
        <div class="backup-title">📦 Backup Semua Data</div>
        <div class="backup-desc">Berisi SEMUA event sekaligus. Impor akan <b>MENIMPA</b> seluruh data.</div>
      </div>
      <div class="backup-actions">
        <button class="btn secondary" ${da('exportData')}>⬇ Ekspor</button>
        <label class="btn secondary">⬆ Impor (Timpa Semua)<input type="file" accept=".json" style="display:none;" onchange="importData(event)"></label>
      </div>
    </div>
    <div class="backup-row">
      <div class="backup-info">
        <div class="backup-title">🎉 Backup Event Aktif${activeEvent()?` — <b>${esc(activeEvent().nama)}</b>`:''}</div>
        <div class="backup-desc">Aman untuk disimpan per-kegiatan; saat diimpor akan dibuat sebagai <b>event baru</b>, tidak menimpa data lain.</div>
      </div>
      <div class="backup-actions">
        <button class="btn secondary" ${da('exportDataEvent')} ${!activeEvent()?'disabled':''}>⬇ Ekspor</button>
        <label class="btn secondary" ${!activeEvent()?'style="opacity:.5;pointer-events:none;"':''}>⬆ Impor sebagai Event Baru<input type="file" accept=".json" style="display:none;" onchange="importDataEvent(event)"></label>
      </div>
    </div>
    <div class="backup-row">
      <div class="backup-info">
        <div class="backup-title">🏬 Backup Gudang Aset</div>
        <div class="backup-desc">Inventaris + riwayat peminjaman. Data ini eventless, tidak ikut Backup Per-Event — tapi IKUT ke Backup Semua Data. Impor lewat sini akan <b>MENAMBAH</b> data, tidak menimpa (beda dari Impor Backup Semua Data yang MENIMPA).</div>
      </div>
      <div class="backup-actions">
        <button class="btn secondary" ${da('gudangExportJSON')}>⬇ Ekspor</button>
        <label class="btn secondary">⬆ Impor<input type="file" accept=".json" style="display:none;" onchange="gudangImportJSON(this)"></label>
      </div>
    </div>
    <div class="backup-row">
      <div class="backup-info">
        <div class="backup-title">💰 Backup ${esc(getOrgNamaKas())}</div>
        <div class="backup-desc">Transaksi debit/kredit. Eventless, tidak ikut Backup Per-Event — tapi IKUT ke Backup Semua Data. Impor akan <b>MENAMBAH</b> data, tidak menimpa.</div>
      </div>
      <div class="backup-actions">
        <button class="btn secondary" ${da('kasExportJSON')}>⬇ Ekspor</button>
        <label class="btn secondary">⬆ Impor<input type="file" accept=".json" style="display:none;" onchange="kasImportJSON(this)"></label>
      </div>
    </div>
    <div class="backup-row">
      <div class="backup-info">
        <div class="backup-title">🪙 Backup Dana Sosial</div>
        <div class="backup-desc">Daftar anggota + rekap bayar bulanan. Eventless, tidak ikut Backup Per-Event — tapi IKUT ke Backup Semua Data. Impor akan <b>MENAMBAH</b> data, tidak menimpa.</div>
      </div>
      <div class="backup-actions">
        <button class="btn secondary" ${da('danaSosialExportJSON')}>⬇ Ekspor</button>
        <label class="btn secondary">⬆ Impor<input type="file" accept=".json" style="display:none;" onchange="danaSosialImportJSON(this)"></label>
      </div>
    </div>
    <div class="backup-row">
      <div class="backup-info">
        <div class="backup-title">🔗 Backup Tautan Penting</div>
        <div class="backup-desc">Kumpulan link penting organisasi. Eventless, tidak ikut Backup Per-Event — tapi IKUT ke Backup Semua Data. Impor akan <b>MENAMBAH</b> data, tidak menimpa.</div>
      </div>
      <div class="backup-actions">
        <button class="btn secondary" ${da('bookmarkExportJSON')}>⬇ Ekspor</button>
        <label class="btn secondary">⬆ Impor<input type="file" accept=".json" style="display:none;" onchange="bookmarkImportJSON(this)"></label>
      </div>
    </div>
    <div class="backup-row">
      <div class="backup-info">
        <div class="backup-title">🚨 Log Error (Toast Merah)</div>
        <div class="backup-desc">Riwayat semua toast merah/peringatan (⛔❌⚠) dari SEMUA perangkat/pengurus, disimpan di server — ${errorLogCloudLoaded ? errorLogCloud.length : '...'} tercatat${getErrorLogPendingCount() > 0 ? `, ${getErrorLogPendingCount()} lagi menunggu sinkron dari perangkat ini` : ''}. Bukan bagian dari data organisasi, murni bantuan diagnosis kalau ada masalah teknis; tidak ikut Backup Semua Data.</div>
      </div>
      <div class="backup-actions">
        <button class="btn secondary" ${da('toastErrorLogExportJSON')}>⬇ Ekspor</button>
        <button class="btn secondary" ${da('toastErrorLogClear')}>🗑 Hapus Log</button>
      </div>
    </div>
  </div>
  ${renderSnapshotPanel()}`;
}

function simpanTarif(){
  if (!isAdmin()) { toast('⛔ Hanya Admin'); return; }
  const s = getSettings();
  s.tarif.sekolah = getCurrencyValue(document.getElementById('tarif-sekolah'));
  s.tarif.bekerja = getCurrencyValue(document.getElementById('tarif-bekerja'));
  s.tarif.perantauan = getCurrencyValue(document.getElementById('tarif-perantauan'));
  saveDB(); toast('Tarif iuran disimpan');
  notifyTelegram(`⚙️ Update tarif iuran`, `Sekolah: ${fmtRp(s.tarif.sekolah)}\nBekerja: ${fmtRp(s.tarif.bekerja)}\nPerantauan: ${fmtRp(s.tarif.perantauan)}\nKhusus: bebas (manual per anggota)`, 'sistem');
}

function simpanHargaKupon(){
  if (!isAdmin()) { toast('⛔ Hanya Admin'); return; }
  const s = getSettings();
  s.kuponJalanSantai.harga = getCurrencyValue(document.getElementById('kupon-harga'));
  s.kuponJalanSantai.stok = Math.max(0, Math.floor(Number(document.getElementById('kupon-stok').value||0)));
  saveDB(); toast('Harga & stok kupon disimpan'); renderContent();
  notifyTelegram(`⚙️ Update harga & stok kupon jalan santai`, `Harga per kupon: ${fmtRp(s.kuponJalanSantai.harga)}\nStok: ${s.kuponJalanSantai.stok} lembar`, 'sistem');
}

// Dipegang sementara (belum disimpan ke db.orgProfile) begitu admin memilih
// file logo baru, supaya tombol "Simpan Profil Organisasi" tetap satu-satunya
// aksi yang benar-benar menyimpan (konsisten dengan field nama/nama kas di
// panel yang sama, yang juga baru disimpan saat tombol itu diklik).
let _pendingOrgLogo = undefined;

function pilihOrgLogo(evt){
  if (!isAdmin()) { toast('⛔ Hanya Admin'); return; }
  const file = evt.target.files[0]; if(!file) return;
  if(!file.type.startsWith('image/')){ toast('⚠️ File harus berupa gambar'); return; }
  // Logo disimpan sebagai base64 langsung di kolom database (bukan upload ke
  // storage terpisah), jadi dibatasi ukurannya supaya tidak bikin tiap
  // save/load data jadi berat di seluruh app (logo ini ikut disinkron tiap
  // kali saveDB() dipanggil, sama seperti profil organisasi lainnya).
  if(file.size > 1.5 * 1024 * 1024){ toast('⚠️ Ukuran gambar maksimal 1.5 MB, coba kompres dulu'); return; }
  const reader = new FileReader();
  reader.onload = ()=>{
    _pendingOrgLogo = reader.result;
    const preview = document.getElementById('org-logo-preview');
    if(preview) preview.src = _pendingOrgLogo;
  };
  reader.onerror = ()=> toast('⚠️ Gagal membaca file gambar');
  reader.readAsDataURL(file);
}

function hapusOrgLogo(){
  if (!isAdmin()) { toast('⛔ Hanya Admin'); return; }
  _pendingOrgLogo = ''; // string kosong = balik ke logo bawaan icons/logo-kop.png
  const preview = document.getElementById('org-logo-preview');
  if(preview) preview.src = 'icons/logo-kop.png';
  toast('Logo akan dikembalikan ke bawaan setelah disimpan');
}

function simpanOrgProfile(){
  if (!isAdmin()) { toast('⛔ Hanya Admin'); return; }
  const nama = document.getElementById('org-nama').value.trim();
  const namaKas = document.getElementById('org-nama-kas').value.trim();
  if(!nama){ toast('⚠️ Nama Organisasi tidak boleh kosong'); return; }
  const org = getOrgProfil();
  org.nama = nama;
  org.namaKas = namaKas || DEFAULT_ORG_PROFILE.namaKas;
  if(_pendingOrgLogo !== undefined){ org.logo = _pendingOrgLogo; _pendingOrgLogo = undefined; }
  saveDB();
  applyOrgBranding();
  toast('✅ Profil Organisasi disimpan');
  renderSidebar();
  renderContent();
}

function simpanTelegram(){
  if (!isAdmin()) { toast('⛔ Hanya Admin'); return; }
  // botToken tidak lagi diinput/disimpan dari sini — lihat catatan di form.
  const chatId = document.getElementById('telegram-chat-id').value.trim();
  const categories = {};
  document.querySelectorAll('.telegram-category-check').forEach(c => { categories[c.dataset.key] = c.checked; });
  const quietHours = {
    enabled: document.getElementById('telegram-quiet-enabled').checked,
    start: document.getElementById('telegram-quiet-start').value || '22:00',
    end: document.getElementById('telegram-quiet-end').value || '06:00',
  };
  const settings = { botToken: '', chatId, enabled: db.telegram?.enabled || false, categories, quietHours };
  saveTelegramSettings(settings);
  toast('✅ Pengaturan Telegram disimpan');
  renderContent();
}

// Tombol "Kirim Ulang Sekarang" di panel Pengaturan — memicu flushTelegramQueue()
// secara manual (di luar jadwal otomatisnya), berguna kalau admin baru saja
// membetulkan token/koneksi dan tidak mau menunggu interval berkala.
async function retryTelegramQueue(){
  if (!isAdmin()) { toast('⛔ Hanya Admin'); return; }
  const before = getTelegramQueueCount();
  toast('🔄 Mengirim ulang notifikasi tertunda...');
  await flushTelegramQueue();
  const after = getTelegramQueueCount();
  if(after === 0) toast('✅ Semua notifikasi tertunda berhasil dikirim');
  else if(after < before) toast(`✅ ${before - after} terkirim, ${after} masih tertunda`);
  else toast('⚠️ Masih gagal — cek token, chat ID, atau koneksi internet');
  renderContent();
}

function simpanGuestMenu(){
  if (!isAdmin()) { toast('⛔ Hanya Admin'); return; }
  const checks = document.querySelectorAll('.guest-menu-check');
  const guestMenu = {};
  checks.forEach(c => { guestMenu[c.dataset.key] = c.checked; });
  db.guestMenu = guestMenu;
  saveDB();
  toast('✅ Akses Guest disimpan');
  renderSidebar();
}

function toggleTelegram(){
  if (!isAdmin()) { toast('⛔ Hanya Admin'); return; }
  const settings = getTelegramSettings();
  if(!settings.chatId){
    toast('⚠️ Isi Chat ID terlebih dahulu');
    return;
  }
  settings.enabled = !settings.enabled;
  saveTelegramSettings(settings);
  toast(settings.enabled ? '✅ Notifikasi Telegram diaktifkan' : '⛔ Notifikasi Telegram dinonaktifkan');
  renderContent();
}

async function testTelegram(){
  if (!isAdmin()) { toast('⛔ Hanya Admin'); return; }
  const settings = getTelegramSettings();
  if(!settings.chatId){
    toast('⚠️ Isi Chat ID terlebih dahulu');
    return;
  }
  if(!settings.enabled){
    if(!(await confirmModal('Notifikasi sedang nonaktif. Aktifkan sekarang?', {danger:false}))) return;
    settings.enabled = true;
    saveTelegramSettings(settings);
  }
  await sendTelegramNotification(`<b>Test Notifikasi</b>\n\nHalo! Ini adalah pesan test dari Buku Keuangan ${escTelegram(getOrgNama())}.\n\nNotifikasi berhasil terkonfigurasi!\n\nWaktu: ${new Date().toLocaleString('id-ID')}`, true);
}

function setActiveEvent(id){ 
  if (!canEdit()) { toast('⛔ Login untuk mengelola event'); return; }
  db.activeEventId = id; 
  applyTemaWarna(eventTema(db.events.find(e=>e.id===id)).key);
  saveDB(); renderSidebar();
  goSection(isMenuAktif(currentSection) ? currentSection : 'dashboard');
  notifyTelegram(`📂 Buka event: ${db.events.find(e=>e.id===id)?.nama || id}`, '', 'sistem');
}

async function hapusEvent(id){
  if (!isAdmin()) { toast('⛔ Hanya Admin'); return; }
  const e = db.events.find(x=>x.id===id); if(!e) return;
  if(!(await confirmModal(`Hapus event "${e.nama}" beserta semua data?`))) return;
  db.events = db.events.filter(x=>x.id!==id);
  delete db.settings[id];
  db.anggota = db.anggota.filter(x=>x.event_id!==id);
  db.donatur = db.donatur.filter(x=>x.event_id!==id);
  db.transaksiLain = db.transaksiLain.filter(x=>x.event_id!==id);
  db.operasional = db.operasional.filter(x=>x.event_id!==id);
  const lombaIds = db.lomba.filter(l=>l.event_id===id).map(l=>l.id);
  db.lombaKebutuhan = db.lombaKebutuhan.filter(k=>!lombaIds.includes(k.lomba_id));
  db.lombaHadiah = db.lombaHadiah.filter(lh=>!lombaIds.includes(lh.lomba_id));
  db.lomba = db.lomba.filter(l=>l.event_id!==id);
  db.hadiahKategori = db.hadiahKategori.filter(x=>x.event_id!==id);
  db.daftarBelanjaHadiah = db.daftarBelanjaHadiah.filter(x=>x.event_id!==id);
  db.daftarBelanjaPerlengkapan = db.daftarBelanjaPerlengkapan.filter(x=>x.event_id!==id);
  db.hadiahJalanSantai = db.hadiahJalanSantai.filter(x=>x.event_id!==id);
  db.daftarBelanjaJalanSantai = db.daftarBelanjaJalanSantai.filter(x=>x.event_id!==id);
  db.jadwal = db.jadwal.filter(x=>x.event_id!==id);
  if(db.activeEventId===id) db.activeEventId = db.events[0]?.id || null;
  saveDB(); renderSidebar(); goSection(db.activeEventId ? currentSection : 'dashboard');
  notifyTelegram(`🗑️ Hapus event: ${e.nama}`, '', 'sistem');
}

async function exportData(){
  if (!canEdit()) { toast('⛔ Login untuk ekspor data'); return; }
  toast('⏳ Menyiapkan data ekspor...');
  // Redaksi token Telegram — ini kredensial live, bukan "data", tidak perlu ikut ke file backup.
  const exportable = JSON.parse(JSON.stringify(db));
  if (exportable.telegram) exportable.telegram.botToken = '';
  // Gudang Aset Desa TIDAK tersimpan di object `db` (lihat catatan di
  // js/15b-snapshot.js) — diambil terpisah lewat fetchGudangBackupData()
  // supaya "Backup Semua Data" ini benar-benar memuat SEMUA data, bukan
  // cuma sebagian modul. Kalau fetch-nya gagal, file tetap diekspor tanpa
  // data gudang (mending dapat backup sebagian daripada gagal total) —
  // toast di bawah memberi tahu admin kalau itu terjadi.
  const gudangData = await fetchGudangBackupData();
  if (gudangData) exportable._gudang = gudangData;
  const blob = new Blob([JSON.stringify(exportable, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `buku-keuangan-${todayISO()}.json`;
  a.click();
  toast(gudangData
    ? '✅ Data diekspor (token Telegram tidak disertakan, atur ulang jika perlu)'
    : '⚠️ Data diekspor, TAPI data Gudang gagal diambil dan tidak ikut ke file ini — coba ekspor ulang.', gudangData ? 4000 : 7000);
  notifyTelegram(`⬇️ Ekspor data`, `File: buku-keuangan-${todayISO()}.json`, 'sistem');
}

function importData(evt){
  if (!isAdmin()) { toast('⛔ Hanya Admin'); return; }
  const file = evt.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = async ()=>{
    try{
      const parsed = JSON.parse(reader.result);
      if(!(await confirmModal('Impor akan MENIMPA data yang ada. Lanjutkan?'))) return;
      // Jaring pengaman: rekam kondisi SEBELUM ditimpa sebagai snapshot
      // "pra-aksi" (lihat js/15b-snapshot.js) — supaya kalau file impor ini
      // ternyata salah, masih bisa dipulihkan lagi dari Pengaturan > Snapshot Otomatis.
      toast('⏳ Menyimpan kondisi saat ini sebagai jaring pengaman...');
      await buatSnapshot('pra-aksi', `Sebelum impor ${file.name}`);
      db = Object.assign(defaultDB(), parsed);
      saveDB();
      // Pulihkan juga data Gudang kalau file backup-nya punya `_gudang`
      // (dibuat oleh exportData() versi baru). File backup lama (dibuat
      // sebelum perbaikan ini) tidak punya field ini — data Gudang saat
      // ini sengaja DIBIARKAN, tidak ikut ditimpa/dikosongkan.
      const gudangDipulihkan = await restoreGudangFromPayload(parsed);
      renderSidebar(); goSection('dashboard'); toast('Data diimpor');
      if (!gudangDipulihkan) {
        toast('ℹ️ File ini dibuat sebelum data Gudang ikut di-backup — data Gudang saat ini tidak diubah.', 8000);
      }
      notifyTelegram(`⬆️ Impor data`, `File: ${file.name}\nUkuran: ${(file.size/1024).toFixed(1)} KB`, 'sistem');
    }catch(e){ toast('File tidak valid'); }
  };
  reader.readAsText(file);
}

/* ============================================================
   CADANGAN DATA PER EVENT AKTIF
   Ekspor hanya mengambil data yang event_id-nya = event aktif.
   Impor membuat EVENT BARU (id & seluruh id record di-generate ulang
   supaya tidak bentrok dengan data yang sudah ada), lalu diaktifkan.
   ============================================================ */
function exportDataEvent(){
  if (!canEdit()) { toast('⛔ Login untuk ekspor data'); return; }
  const ev = activeEvent();
  if(!ev){ toast('Tidak ada event aktif'); return; }
  const id = ev.id;
  const lombaIds = db.lomba.filter(x=>x.event_id===id).map(x=>x.id);

  const payload = {
    _type: 'kt-event-backup',
    _version: 1,
    exported_at: new Date().toISOString(),
    event: { nama: ev.nama, tahun: ev.tahun, fitur: ev.fitur || null },
    settings: db.settings[id] ? { tarif: db.settings[id].tarif, hadiahBudget: db.settings[id].hadiahBudget || {}, kategoriToko: db.settings[id].kategoriToko || {customCategories:[],keywords:{}}, kuponJalanSantai: db.settings[id].kuponJalanSantai || {harga:0,stok:0} } : { tarif:{sekolah:0,bekerja:0,perantauan:0,khusus:0}, hadiahBudget:{}, kategoriToko:{customCategories:[],keywords:{}}, kuponJalanSantai:{harga:0,stok:0} },
    anggota: db.anggota.filter(x=>x.event_id===id),
    donatur: db.donatur.filter(x=>x.event_id===id),
    transaksiLain: db.transaksiLain.filter(x=>x.event_id===id),
    operasional: db.operasional.filter(x=>x.event_id===id),
    lomba: db.lomba.filter(x=>x.event_id===id),
    lombaKebutuhan: db.lombaKebutuhan.filter(x=>lombaIds.includes(x.lomba_id)),
    lombaHadiah: db.lombaHadiah.filter(x=>lombaIds.includes(x.lomba_id)),
    hadiahKategori: db.hadiahKategori.filter(x=>x.event_id===id),
    daftarBelanjaHadiah: db.daftarBelanjaHadiah.filter(x=>x.event_id===id),
    daftarBelanjaPerlengkapan: db.daftarBelanjaPerlengkapan.filter(x=>x.event_id===id),
    hadiahJalanSantai: db.hadiahJalanSantai.filter(x=>x.event_id===id),
    daftarBelanjaJalanSantai: db.daftarBelanjaJalanSantai.filter(x=>x.event_id===id),
    jadwal: db.jadwal.filter(x=>x.event_id===id),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  const safeName = (ev.nama||'event').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'event';
  a.href = URL.createObjectURL(blob);
  a.download = `backup-${safeName}-${todayISO()}.json`;
  a.click();
  toast(`✅ Data event "${ev.nama}" diekspor`);
  notifyTelegram(`⬇️ Ekspor data event`, `Event: ${ev.nama}\nFile: ${a.download}`, 'sistem');
}

function importDataEvent(evt){
  if (!canEdit()) { toast('⛔ Login untuk impor data'); return; }
  const file = evt.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = async ()=>{
    try{
      const parsed = JSON.parse(reader.result);
      if(!parsed || parsed._type !== 'kt-event-backup' || !parsed.event){
        toast('File bukan backup event yang valid'); evt.target.value=''; return;
      }
      if(!(await confirmModal(`Impor akan membuat EVENT BARU "${parsed.event.nama}" berisi salinan data dari file backup ini. Data event lain tidak akan berubah. Lanjutkan?`))){
        evt.target.value=''; return;
      }

      const newEventId = uid();
      db.events.push({ id:newEventId, nama: parsed.event.nama || 'Event Impor', tahun: parsed.event.tahun || new Date().getFullYear(), fitur: parsed.event.fitur || undefined, created_at: new Date().toISOString() });
      db.settings[newEventId] = {
        tarif: (parsed.settings && parsed.settings.tarif) ? {...parsed.settings.tarif} : {sekolah:0,bekerja:0,perantauan:0,khusus:0},
        hadiahBudget: (parsed.settings && parsed.settings.hadiahBudget) ? JSON.parse(JSON.stringify(parsed.settings.hadiahBudget)) : {},
        kategoriToko: (parsed.settings && parsed.settings.kategoriToko) ? JSON.parse(JSON.stringify(parsed.settings.kategoriToko)) : {customCategories:[],keywords:{}},
        kuponJalanSantai: (parsed.settings && parsed.settings.kuponJalanSantai) ? JSON.parse(JSON.stringify(parsed.settings.kuponJalanSantai)) : {harga:0,stok:0}
      };

      (parsed.anggota||[]).forEach(x=>{ db.anggota.push({...x, id:uid(), event_id:newEventId}); });
      (parsed.donatur||[]).forEach(x=>{ db.donatur.push({...x, id:uid(), event_id:newEventId}); });
      (parsed.transaksiLain||[]).forEach(x=>{ db.transaksiLain.push({...x, id:uid(), event_id:newEventId}); });
      (parsed.operasional||[]).forEach(x=>{ db.operasional.push({...x, id:uid(), event_id:newEventId}); });
      const jadwalIdMap = {};
      (parsed.jadwal||[]).forEach(x=>{ const nid=uid(); jadwalIdMap[x.id]=nid; db.jadwal.push({...x, id:nid, event_id:newEventId}); });

      const lombaIdMap = {};
      (parsed.lomba||[]).forEach(x=>{ const nid=uid(); lombaIdMap[x.id]=nid; db.lomba.push({...x, id:nid, event_id:newEventId,
        // jadwal_id lomba WAJIB di-remap ke ID baru jadwal hasil impor di atas — kalau
        // tidak, jadwal_id akan tetap menunjuk ke ID lama yang sudah tidak ada di event
        // baru, dan begitu lomba ini diedit lagi, syncAgendaLomba (10-lomba.js) tidak
        // akan menemukan entri lama itu dan malah membuat entri jadwal DUPLIKAT baru,
        // sementara entri jadwal hasil impor tadi jadi nyasar tidak terhubung ke lomba
        // manapun. Kalau entri jadwal sumbernya ternyata tidak ikut ter-ekspor (backup
        // lama/rusak), fallback ke null (bukan ID lama) supaya tidak nyasar diam-diam.
        jadwal_id: x.jadwal_id ? (jadwalIdMap[x.jadwal_id] || null) : null
      }); });

      const kebutuhanIdMap = {};
      (parsed.lombaKebutuhan||[]).forEach(x=>{ const nid=uid(); kebutuhanIdMap[x.id]=nid; db.lombaKebutuhan.push({...x, id:nid, lomba_id: lombaIdMap[x.lomba_id] || x.lomba_id}); });

      const hadiahKategoriIdMap = {};
      (parsed.hadiahKategori||[]).forEach(x=>{ const nid=uid(); hadiahKategoriIdMap[x.id]=nid; db.hadiahKategori.push({...x, id:nid, event_id:newEventId}); });

      (parsed.lombaHadiah||[]).forEach(x=>{ db.lombaHadiah.push({...x, id:uid(),
        lomba_id: lombaIdMap[x.lomba_id] || x.lomba_id,
        hadiah_kategori_id: hadiahKategoriIdMap[x.hadiah_kategori_id] || x.hadiah_kategori_id }); });

      (parsed.daftarBelanjaHadiah||[]).forEach(x=>{ db.daftarBelanjaHadiah.push({...x, id:uid(), event_id:newEventId,
        hadiah_kategori_id: hadiahKategoriIdMap[x.hadiah_kategori_id] || x.hadiah_kategori_id }); });

      (parsed.daftarBelanjaPerlengkapan||[]).forEach(x=>{ db.daftarBelanjaPerlengkapan.push({...x, id:uid(), event_id:newEventId,
        kebutuhan_id: kebutuhanIdMap[x.kebutuhan_id] || x.kebutuhan_id }); });

      const hadiahJalanIdMap = {};
      (parsed.hadiahJalanSantai||[]).forEach(x=>{ const nid=uid(); hadiahJalanIdMap[x.id]=nid; db.hadiahJalanSantai.push({...x, id:nid, event_id:newEventId}); });

      (parsed.daftarBelanjaJalanSantai||[]).forEach(x=>{ db.daftarBelanjaJalanSantai.push({...x, id:uid(), event_id:newEventId,
        hadiah_jalan_id: hadiahJalanIdMap[x.hadiah_jalan_id] || x.hadiah_jalan_id }); });

      db.activeEventId = newEventId;
      saveDB(); renderSidebar(); goSection('dashboard');
      toast(`✅ Event "${parsed.event.nama}" berhasil diimpor & diaktifkan`);
      notifyTelegram(`⬆️ Impor data event`, `Event baru: ${parsed.event.nama}\nFile: ${file.name}\nUkuran: ${(file.size/1024).toFixed(1)} KB`, 'sistem');
    }catch(e){
      console.error(e);
      toast('File tidak valid');
    } finally {
      evt.target.value = '';
    }
  };
  reader.readAsText(file);
}

/* ============================================================
   EVENT MODAL
   ============================================================ */
function openEventModal(id){
  if (!canEdit()) { toast('⛔ Login untuk mengelola event'); return; }
  const editing = id ? db.events.find(e=>e.id===id) : null;
  const fiturAwal = eventFitur(editing);
  const eventLain = db.events.slice().sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
  setModal(editing?'Edit Event':'Buat Event', `
    <div class="field"><label>Nama Event</label><input id="f-nama" placeholder="HUT RI 82" value="${editing?esc(editing.nama):''}"></div>
    <div class="field"><label>Tahun</label><input id="f-tahun" type="number" value="${editing?esc(editing.tahun):new Date().getFullYear()}"></div>

    <div class="field">
      <label>Warna Tema</label>
      <input type="hidden" id="f-tema" value="${eventTema(editing).key}">
      <div id="tema-swatch-list" style="display:flex; flex-wrap:wrap; gap:10px; margin-top:2px;">
        ${PRESET_TEMA.map(t=>{
          const active = eventTema(editing).key===t.key;
          return `<div class="tema-swatch" data-key="${t.key}" ${da('selectTemaModal', t.key)} title="${esc(t.label)}"
            style="width:32px; height:32px; border-radius:50%; background:${t.main}; cursor:pointer; display:flex; align-items:center; justify-content:center; border:3px solid ${active?'var(--ink)':'transparent'}; transition:border-color .15s ease;">
            ${active?'<span style="color:#fff; font-size:13px; font-weight:700;">✓</span>':''}
          </div>`;
        }).join('')}
      </div>
    </div>

    ${!editing && eventLain.length ? `
    <div class="field">
      <label>Salin Data Anggota (opsional)</label>
      <select id="f-salin-anggota">
        <option value="">— Jangan salin, mulai kosong —</option>
        ${eventLain.map(e=>{
          const jumlah = db.anggota.filter(a=>a.event_id===e.id).length;
          return `<option value="${e.id}">${esc(e.nama)} (${esc(e.tahun)}) · ${jumlah} anggota</option>`;
        }).join('')}
      </select>
      <div class="hint">Nama, kategori, RT &amp; jenis kelamin akan disalin. Status iuran diset ulang jadi "Belum Lunas" karena ini event baru.</div>
    </div>` : ''}

    <div class="field" style="margin-top:6px;">
      <label>Fitur yang Dipakai</label>
      <div class="field-hint" style="margin:-2px 0 8px; color:var(--ink-soft); font-size:12.5px;">Nonaktifkan modul yang tidak dipakai supaya menu lebih ringkas. Iuran, Buku Kegiatan & LPJ selalu aktif.</div>
      <div style="display:flex; gap:8px; margin-bottom:10px;">
        <button type="button" class="btn secondary small" ${da('setFiturModalPreset', 'lengkap')}>Pilih Semua (Lengkap)</button>
        <button type="button" class="btn secondary small" ${da('setFiturModalPreset', 'sederhana')}>Hanya Iuran & LPJ</button>
      </div>
      <div id="fitur-opsional-list" style="display:flex; flex-direction:column; gap:6px;">
        ${FITUR_OPSIONAL.map(f=>`
          <label style="display:flex; align-items:center; gap:8px; font-size:13.5px; font-weight:400;">
            <input type="checkbox" id="fitur-${f.key}" ${fiturAwal[f.key]?'checked':''}> ${esc(f.label)}
          </label>`).join('')}
      </div>
    </div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:editing?'Simpan':'Buat', cls:'', onclick:()=>{
      const nama = document.getElementById('f-nama').value.trim();
      const tahun = document.getElementById('f-tahun').value.trim();
      const warna_tema = document.getElementById('f-tema')?.value || 'hijau';
      if(!nama){ toast('Nama wajib'); return; }
      const fitur = {};
      FITUR_OPSIONAL.forEach(f => fitur[f.key] = !!document.getElementById(`fitur-${f.key}`)?.checked);
      if(editing){
        const namaLama = editing.nama;
        editing.nama = nama; editing.tahun = tahun; editing.fitur = fitur; editing.warna_tema = warna_tema;
        if(db.activeEventId === editing.id) applyTemaWarna(warna_tema);
        saveDB(); closeModal(); renderSidebar(); renderContent(); toast('Event diperbarui');
        notifyTelegram(`✏️ Edit event: ${namaLama} → ${nama}`, `Tahun: ${tahun}`, 'sistem');
      } else {
        const newId = uid();
        db.events.push({id:newId, nama, tahun, fitur, warna_tema, created_at:new Date().toISOString()});
        db.settings[newId] = {tarif:{sekolah:0,bekerja:0,perantauan:0,khusus:0}, hadiahBudget:{}};
        const sourceEventId = document.getElementById('f-salin-anggota')?.value || '';
        let jumlahDisalin = 0;
        if(sourceEventId){
          db.anggota.filter(a=>a.event_id===sourceEventId).forEach(a=>{
            db.anggota.push({id:uid(), event_id:newId, nama:a.nama, kategori:a.kategori, rt:a.rt, gender:a.gender, nominal_wajib:a.nominal_wajib, status:'belum_lunas', tanggal_bayar:null});
            jumlahDisalin++;
          });
        }
        db.activeEventId = newId;
        applyTemaWarna(warna_tema);
        saveDB(); closeModal(); renderSidebar(); goSection('pengaturan');
        toast(jumlahDisalin ? `Event dibuat, ${jumlahDisalin} anggota disalin` : 'Event dibuat');
        notifyTelegram(`📂 Event baru: ${nama}`, `Tahun: ${tahun}${jumlahDisalin ? `\nAnggota disalin: ${jumlahDisalin}` : ''}`, 'sistem');
      }
    }}
  ]);
}
function setFiturModalPreset(preset){
  const src = preset === 'lengkap' ? FITUR_PRESET_LENGKAP : FITUR_PRESET_SEDERHANA;
  FITUR_OPSIONAL.forEach(f=>{
    const cb = document.getElementById(`fitur-${f.key}`);
    if(cb) cb.checked = !!src[f.key];
  });
}

function selectTemaModal(key){
  const input = document.getElementById('f-tema');
  if(input) input.value = key;
  document.querySelectorAll('#tema-swatch-list .tema-swatch').forEach(el=>{
    const active = el.dataset.key === key;
    el.style.borderColor = active ? 'var(--ink)' : 'transparent';
    el.innerHTML = active ? '<span style="color:#fff; font-size:13px; font-weight:700;">✓</span>' : '';
  });
}

