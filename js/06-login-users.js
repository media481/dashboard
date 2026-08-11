/* ============================================================
   LOGIN MODAL
   ============================================================ */
function openLoginModal() {
  setModal('🔑 Login', `
    <p style="color:var(--ink-soft); margin-bottom:16px;">Masuk dengan username & password akun Anda.</p>
    <div class="field-row">
      <div class="field"><label>Username</label><input id="login-username" placeholder="Username"></div>
      <div class="field"><label>Password</label><input id="login-password" type="password" placeholder="******"></div>
    </div>
    <div style="display:flex; gap:8px; margin-top:8px;">
      <button class="btn" id="login-submit-btn" ${da('manualLogin')}>Login</button>
      <button class="btn secondary" ${da('closeModal')}>Batal</button>
    </div>
  `, []);
  setTimeout(()=>{
    const pwEl = document.getElementById('login-password');
    if (pwEl) pwEl.addEventListener('keydown', e => { if (e.key === 'Enter') manualLogin(); });
    const userEl = document.getElementById('login-username');
    if (userEl) { userEl.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('login-password')?.focus(); }); userEl.focus(); }
  }, 0);
}

async function manualLogin() {
  const username = document.getElementById('login-username')?.value?.trim();
  const password = document.getElementById('login-password')?.value?.trim();
  if (!username || !password) {
    toast('⚠️ Isi username dan password');
    return;
  }
  // Sebelumnya tombol Login tetap bisa di-tap berkali-kali selama menunggu
  // respons server, tanpa keterangan apa pun kalau koneksi lambat — user bisa
  // ngetap ulang beberapa kali mengira tap pertama tidak kena. Sekarang tombol
  // dikunci + teksnya berubah selama proses berlangsung, dan dikembalikan lagi
  // kalau gagal supaya user bisa coba ulang.
  const btn = document.getElementById('login-submit-btn');
  const originalLabel = btn ? btn.textContent : 'Login';
  if(btn){ btn.disabled = true; btn.textContent = 'Memproses...'; }
  try{
    const user = await login(username, password);
    if (user) {
      closeModal();
      renderSidebar();
      renderTopbarSaldo();
      renderContent();
      const roleLabel = {admin:'Admin', user:'User', petugas:'Petugas'}[user.role] || user.role;
      toast(`✅ Login sebagai ${user.name} (${roleLabel})`);
      notifyTelegram(`🔑 User login: ${user.name}`, `Role: ${roleLabel}`, 'login');
    } else {
      toast('❌ Login gagal');
    }
  } finally {
    // Kalau berhasil, modal sudah ditutup duluan jadi elemen ini sudah tidak
    // ada lagi (aman, getElementById tinggal balikin null). Kalau gagal/modal
    // masih terbuka, tombol dikembalikan seperti semula supaya bisa dicoba lagi.
    const btnAfter = document.getElementById('login-submit-btn');
    if(btnAfter){ btnAfter.disabled = false; btnAfter.textContent = originalLabel; }
  }
}

/* ============================================================
   USER MANAGEMENT (Admin Only)
   ============================================================ */
function renderUsers() {
  if (!isAdmin()) {
    return `<div class="empty-state"><h3>⛔ Akses Ditolak</h3><p>Halaman ini hanya untuk Admin.</p></div>`;
  }
  
  const users = getUsers();
  const roleLabel = {admin:'Admin', user:'User', petugas:'Petugas'};
  const roleBadgeClass = u => u.role === 'admin' ? 'role-admin' : (u.role === 'petugas' ? 'role-petugas' : 'role-user');
  const bidangHtml = u => u.role === 'petugas'
    ? ((u.allowed_sections && u.allowed_sections.length)
        ? `<div class="mini-tag-list">${u.allowed_sections.map(k=>`<span class="mini-tag">${esc(sectionLabelByKey(k))}</span>`).join('')}</div>`
        : '<span class="mini-tag mini-tag-muted">Belum ada bidang</span>')
    : '<span class="mini-tag mini-tag-muted">Semua bidang</span>';
  const rows = users.map((u, idx) => `
    <tr>
      <td data-label="Nama">${esc(u.name)}</td>
      <td data-label="Role"><span class="badge ${roleBadgeClass(u)}">${roleLabel[u.role] || u.role}</span></td>
      <td data-label="Username">${esc(u.username)}</td>
      <td data-label="Bidang">${bidangHtml(u)}</td>
      <td data-label="Terakhir Dibuka">${fmtWaktuTerakhir(u.last_seen_at)}</td>
      <td data-label="Password"><span class="password-pill">🔒 ••••••</span></td>
      <td data-label="Aksi" class="users-actions">
        <button class="btn secondary small" ${da('openUserModal', u.id)}>✎ Edit</button>
        <button class="icon-btn" ${da('hapusUser', u.id)} ${users.length <= 1 ? 'disabled' : ''}>🗑</button>
      </td>
    </tr>
  `).join('');

  // Kartu khusus HP — lewat .users-mobile-wrap (lihat media query max-width:820px
  // di style.css), tampilan komputer TETAP pakai tabel di atas (.users-table-wrap)
  // dan tidak berubah. Password disembunyikan di kartu HP karena selalu tampil
  // "******" (tidak informatif) — ganti password tetap lewat tombol Edit.
  const cards = users.map(u => `
    <div class="jadwal-item">
      <div class="jadwal-item-top">
        <div class="jadwal-item-title" style="margin-bottom:0;">${esc(u.name)}</div>
        <span class="badge ${roleBadgeClass(u)}">${roleLabel[u.role] || u.role}</span>
      </div>
      <div class="lomba-detail-row"><span class="lbl">👤 Username</span><span class="val">${esc(u.username)}</span></div>
      <div class="lomba-detail-row"><span class="lbl">🛠️ Bidang</span><span class="val">${bidangHtml(u)}</span></div>
      <div class="lomba-detail-row"><span class="lbl">🕒 Terakhir Dibuka</span><span class="val">${fmtWaktuTerakhir(u.last_seen_at)}</span></div>
      <div class="jadwal-item-actions">
        <button class="btn secondary small" ${da('openUserModal', u.id)}>✎ Edit</button>
        <button class="icon-btn" ${da('hapusUser', u.id)} ${users.length <= 1 ? 'disabled' : ''}>🗑</button>
      </div>
    </div>
  `).join('');

  return `
  <div class="panel">
    <div class="panel-head">
      <div><h3>👥 Manajemen User</h3>
        <div class="desc">Kelola akun pengguna yang dapat mengakses sistem</div>
      </div>
      <button class="btn" ${da('openUserModal')}>+ Tambah User</button>
    </div>
    <div class="panel-body flush users-table-wrap">
      <table class="users-table">
        <thead><tr><th>Nama</th><th>Role</th><th>Username</th><th>Bidang</th><th>Terakhir Dibuka</th><th>Password</th><th></th></tr></thead>
        <tbody>${rows || `<tr class="empty-row"><td colspan="7">Belum ada user.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="panel-body users-mobile-wrap">
      <div class="jadwal-item-list">${cards || `<div class="empty-row" style="padding:30px;text-align:center;">Belum ada user.</div>`}</div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>ℹ️ Tentang Role</h3></div>
    <div class="panel-body">
      <div class="role-info-grid">
        <div class="role-info-card">
          <div class="ric-title">👤 Guest (Tidak Login)</div>
          <div class="ric-desc">Hanya bisa melihat data (read-only). Tidak bisa menambah, mengedit, atau menghapus data.</div>
        </div>
        <div class="role-info-card">
          <div class="ric-title">🛠️ Petugas</div>
          <div class="ric-desc">Login khusus untuk satu atau beberapa bidang tertentu saja (mis. hanya Iuran Anggota, atau hanya Lomba &amp; Hadiah). Di luar bidang yang ditugaskan, halaman lain tidak terlihat dan tidak bisa diakses.</div>
        </div>
        <div class="role-info-card">
          <div class="ric-title">👤 User</div>
          <div class="ric-desc">Bisa melihat dan mengedit semua data (anggota, donatur, transaksi, lomba, hadiah, dll). Tidak bisa mengakses Pengaturan.</div>
        </div>
        <div class="role-info-card">
          <div class="ric-title">⚡ Admin</div>
          <div class="ric-desc">Akses penuh termasuk Pengaturan dan Manajemen User.</div>
        </div>
      </div>
    </div>
  </div>`;
}

function openUserModal(id) {
  if (!isAdmin()) { toast('⛔ Hanya Admin'); return; }
  const users = getUsers();
  const editing = id ? users.find(u => u.id === id) : null;
  const editingSections = (editing && editing.allowed_sections) || [];
  
  setModal(editing ? '✏️ Edit User' : '➕ Tambah User', `
    <div class="field"><label>Nama Lengkap</label><input id="f-name" value="${editing ? esc(editing.name) : ''}" placeholder="Nama user"></div>
    <div class="field"><label>Username</label><input id="f-username" value="${editing ? esc(editing.username) : ''}" placeholder="username" ${editing ? 'disabled' : ''}></div>
    <div class="field"><label>Password</label><input id="f-password" type="text" value="${editing ? '******' : ''}" placeholder="${editing ? 'Kosongkan untuk tidak diubah' : 'Password baru'}"></div>
    <div class="field"><label>Role</label>
      <select id="f-role" onchange="updatePetugasSectionsVisibility()">
        <option value="user" ${editing && editing.role === 'user' ? 'selected' : ''}>User (Bisa edit semua data)</option>
        <option value="petugas" ${editing && editing.role === 'petugas' ? 'selected' : ''}>Petugas (Terbatas per bidang)</option>
        <option value="admin" ${editing && editing.role === 'admin' ? 'selected' : ''}>Admin (Akses penuh)</option>
      </select>
    </div>
    <div class="field" id="f-sections-field" style="${editing && editing.role === 'petugas' ? '' : 'display:none;'}">
      <label>Bidang yang Ditugaskan</label>
      <div class="hint" style="margin-bottom:8px;">Petugas hanya bisa melihat & mengelola bidang yang dicentang di bawah ini.</div>
      <div class="toggle-grid">
        ${SECTIONS.filter(s=>!s.adminOnly && s.key!=='dashboard').map(s=>`
          <label class="toggle-chip">
            <input type="checkbox" class="f-section-check" value="${s.key}" ${editingSections.includes(s.key) ? 'checked' : ''} hidden>
            <span class="toggle-box"></span>
            <span class="toggle-icon">${icon(s.icon)}</span>
            <span class="toggle-text">${esc(sectionLabel(s))}</span>
          </label>`).join('')}
      </div>
    </div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label: editing ? 'Simpan' : 'Tambah', cls:'', onclick: async () => {
      const name = document.getElementById('f-name').value.trim();
      const username = document.getElementById('f-username').value.trim();
      const password = document.getElementById('f-password').value.trim();
      const role = document.getElementById('f-role').value;
      const sections = role === 'petugas'
        ? Array.from(document.querySelectorAll('.f-section-check:checked')).map(c => c.value)
        : [];
      
      if (!name || !username) { toast('Nama dan username wajib'); return; }
      if (!editing && !password) { toast('Password wajib untuk user baru'); return; }
      if (password && password.length < 4) { toast('Password minimal 4 karakter'); return; }
      if (role === 'petugas' && sections.length === 0) { toast('Pilih minimal 1 bidang untuk Petugas'); return; }
      if (editing && editing.role === 'admin' && role !== 'admin') {
        const jumlahAdmin = getUsers().filter(u => u.role === 'admin').length;
        if (jumlahAdmin <= 1) { toast('⛔ Tidak bisa menurunkan role Admin terakhir — angkat admin lain dulu'); return; }
      }
      
      const usersList = getUsers();
      if (!editing && usersList.find(u => u.username === username)) {
        toast('Username sudah digunakan');
        return;
      }
      
      const targetId = editing ? id : uid();
      const passwordToSend = editing ? (password && password !== '******' ? password : null) : (password || 'user123');
      const { error } = await sb.rpc('rpc_upsert_user', {
        p_id: targetId,
        p_name: name,
        p_username: username,
        p_password: passwordToSend,
        p_role: role,
        p_sections: sections,
      });
      if (error) {
        console.error('Gagal menyimpan user:', error);
        toast(`⚠️ ${error.message || 'Gagal menyimpan user ke server'}`);
        return;
      }

      const { data: refreshed } = await sb.rpc('rpc_list_users');
      if (refreshed) db.users = refreshed;
      toast(editing ? '✅ User diupdate' : '✅ User ditambahkan');
      closeModal();
      if (currentSection === 'users') renderContent();
      renderSidebar();
    }}
  ]);
}
function updatePetugasSectionsVisibility() {
  const role = document.getElementById('f-role')?.value;
  const field = document.getElementById('f-sections-field');
  if (field) field.style.display = role === 'petugas' ? '' : 'none';
}

async function hapusUser(id) {
  if (!isAdmin()) { toast('⛔ Hanya Admin'); return; }
  const users = getUsers();
  if (users.length <= 1) { toast('⚠️ Minimal 1 user'); return; }
  const user = users.find(u => u.id === id);
  if (user && user.role === 'admin' && users.filter(u => u.role === 'admin').length <= 1) {
    toast('⛔ Tidak bisa menghapus Admin terakhir — angkat admin lain dulu');
    return;
  }
  if (!(await confirmModal(`Hapus user "${user?.name}"?`))) return;

  const { error } = await sb.rpc('rpc_delete_user', { p_id: id });
  if (error) { console.error('Gagal menghapus user:', error); toast(`⚠️ ${error.message || 'Gagal menghapus user'}`); return; }

  const { data: refreshed } = await sb.rpc('rpc_list_users');
  if (refreshed) db.users = refreshed;

  // If current user is deleted, logout
  const current = getCurrentUser();
  if (current && current.id === id) {
    logout();
  }
  toast('🗑️ User dihapus');
  if (currentSection === 'users') renderContent();
  renderSidebar();
}

