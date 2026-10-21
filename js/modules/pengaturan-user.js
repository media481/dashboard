// ============================================================
// MODUL LAZY: PENGATURAN USER & AKSES MENU  (js/modules/pengaturan-user.js)
// ============================================================
// Dipecah dari js/app.js dan dimuat HANYA saat dibutuhkan (ensureModuleLoaded('pengaturan-user') di app.js).
// Dimuat sebagai <script> biasa (BUKAN ES module): satu lingkup global dengan app.js, jadi nama
// fungsi global, onclick="..." dan data-action="..." tidak berubah.
// ATURAN: jangan mendeklarasikan ulang nama yang sudah ada di app.js (const/let ganda = SyntaxError).
// Fungsi yang dirujuk index.html / kode inti SEBELUM modul dimuat didaftarkan di LAZY_MODULES['pengaturan-user'].api (app.js).
// ============================================================

// ============================================================
// 12b-2. TAMBAH USER BARU (admin only)
// Lewat Edge Function admin-create-user (pakai Supabase Auth Admin API),
// membuat akun baru per-orang dengan role 'admin' atau 'user'.
// ============================================================
async function createNewUser() {
    if (currentRole !== 'admin') { showToast('Hanya Admin yang boleh menambah user', 'error'); return; }
    const statusEl = document.getElementById('usNewUserStatus');
    const label = document.getElementById('us_new_label')?.value.trim() || '';
    const email = document.getElementById('us_new_email')?.value.trim() || '';
    const password = document.getElementById('us_new_password')?.value || '';
    const dashboard_role = document.getElementById('us_new_role')?.value || 'user';

    if (!label || !email || !password) {
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger);font-size:12.5px;"><i class="bi bi-exclamation-circle-fill"></i> Nama, email, dan password wajib diisi.</span>';
        return;
    }
    if (password.length < 6) {
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger);font-size:12.5px;"><i class="bi bi-exclamation-circle-fill"></i> Password minimal 6 karakter.</span>';
        return;
    }

    if (statusEl) statusEl.innerHTML = '<span style="color:var(--ink-soft);font-size:12.5px;"><i class="bi bi-hourglass-split"></i> Membuat user...</span>';
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) throw new Error('Sesi login tidak ditemukan, silakan login ulang.');
        const resp = await fetch(ADMIN_CREATE_USER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + session.access_token
            },
            body: JSON.stringify({ email, password, label, dashboard_role })
        });
        const result = await resp.json();
        if (!resp.ok || !result.ok) throw new Error(result.description || 'Gagal menambah user');

        ['us_new_label', 'us_new_email', 'us_new_password'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--success);font-size:12.5px;"><i class="bi bi-check-circle-fill"></i> User berhasil ditambahkan.</span>';
        showToast('User baru berhasil ditambahkan');
        loadUserList();
    } catch (err) {
        console.error('createNewUser error:', err);
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);font-size:12.5px;"><i class="bi bi-exclamation-circle-fill"></i> Gagal menambah user: ${escapeHtml(err.message)}</span>`;
        showToast('Gagal menambah user', 'error');
    }
}
let usCachedUsers = [];              // hasil terakhir dashboard_profiles (dipakai filter/cari tanpa query ulang)
let usMyId = '';                     // id akun yang sedang login (tombol ganti password dimatikan untuk diri sendiri)
let usListFilter = { q: '', role: '' };

function usInitials(name) {
    const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
}

function usRelTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const m = Math.floor((Date.now() - d.getTime()) / 60000);
    if (m < 1) return 'Baru saja';
    if (m < 60) return m + ' menit lalu';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' jam lalu';
    const days = Math.floor(h / 24);
    if (days < 7) return days + ' hari lalu';
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function usStateRow(html, danger) {
    return `<tr><td colspan="4" class="us-state${danger ? ' us-state-err' : ''}">${html}</td></tr>`;
}

async function loadUserList() {
    const body = document.getElementById('usUserListBody');
    const countEl = document.getElementById('usUserListCount');
    if (!body) return;
    const { data, error } = await supabaseClient
        .from('dashboard_profiles')
        .select('id, email, label, dashboard_role, created_at, last_login')
        .order('created_at');
    if (error) {
        const isMissingSetup = /column .*email.* does not exist/i.test(error.message || '');
        const isMissingLastLogin = /column .*last_login.* does not exist/i.test(error.message || '');
        body.innerHTML = isMissingSetup
            ? usStateRow('Setup belum lengkap: jalankan <code>sql/30_tambah_kelola_user.sql</code> di SQL Editor Supabase, lalu buka lagi tab ini.', true)
            : isMissingLastLogin
            ? usStateRow('Setup belum lengkap: jalankan <code>sql/31_tambah_last_login_profiles.sql</code> di SQL Editor Supabase, lalu buka lagi tab ini.', true)
            : usStateRow('Gagal memuat daftar user: ' + escapeHtml(error.message), true);
        if (countEl) countEl.textContent = '-';
        return;
    }
    usCachedUsers = data || [];
    const { data: { session } } = await supabaseClient.auth.getSession();
    usMyId = session?.user?.id || '';

    // Ringkasan jumlah per role
    const cnt = { admin: 0, user: 0, guest: 0 };
    usCachedUsers.forEach(u => { if (cnt[u.dashboard_role] != null) cnt[u.dashboard_role]++; });
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt('usStatTotal', usCachedUsers.length);
    setTxt('usStatAdmin', cnt.admin);
    setTxt('usStatUser', cnt.user);
    setTxt('usStatGuest', cnt.guest);

    renderUserListRows();
}

function renderUserListRows() {
    const body = document.getElementById('usUserListBody');
    const countEl = document.getElementById('usUserListCount');
    if (!body) return;
    const q = usListFilter.q.trim().toLowerCase();
    const rows = usCachedUsers.filter(u =>
        (!usListFilter.role || u.dashboard_role === usListFilter.role) &&
        (!q || (u.label || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)));
    if (countEl) countEl.textContent = (q || usListFilter.role) ? `${rows.length} dari ${usCachedUsers.length} user` : `${usCachedUsers.length} user`;
    if (!rows.length) {
        body.innerHTML = usStateRow(usCachedUsers.length ? 'Tidak ada user yang cocok dengan pencarian.' : 'Belum ada data.');
        return;
    }
    body.innerHTML = rows.map(u => {
        const role = US_ROLE_META[u.dashboard_role] ? u.dashboard_role : 'user';
        const meta = US_ROLE_META[role];
        const isMe = u.id === myIdSafe();
        const name = u.label || u.email || '-';
        const last = u.last_login
            ? `<span class="us-last" title="${escapeHtml(new Date(u.last_login).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' }))}">${escapeHtml(usRelTime(u.last_login))}</span>`
            : '<span class="us-last us-last-never">Belum pernah</span>';
        const accessBtn = role === 'admin' ? '' : `<button type="button" class="btn-icon-ghost" title="Atur akses menu" onclick="usJumpToAccess('${escapeJsAttr(u.id)}')"><i class="bi bi-ui-checks-grid"></i></button>`;
        return `<tr>
            <td data-label="User"><div class="us-user"><span class="us-avatar us-role-${role}">${escapeHtml(usInitials(name))}</span><div class="us-user-txt"><b>${escapeHtml(name)}${isMe ? ' <span class="us-me">Kamu</span>' : ''}</b><span>${escapeHtml(u.email || '-')}</span></div></div></td>
            <td data-label="Role"><span class="us-badge us-role-${role}"><i class="bi ${meta.icon}"></i> ${meta.label}</span></td>
            <td data-label="Terakhir login">${last}</td>
            <td class="us-actions">
                ${accessBtn}
                <button type="button" class="btn-icon-ghost" title="${isMe ? 'Ganti password akun sendiri lewat menu profil' : 'Ganti password'}" onclick="openResetPasswordModal('${escapeJsAttr(u.id)}', '${escapeJsAttr(u.label || u.email || '')}')"${isMe ? ' disabled' : ''}><i class="bi bi-key-fill"></i></button>
            </td>
        </tr>`;
    }).join('');
}
function myIdSafe() { return usMyId; }

function usSetListFilter(key, val) {
    usListFilter[key] = val;
    if (key === 'role') document.querySelectorAll('#usRoleChips .us-chip').forEach(c => c.classList.toggle('active', c.dataset.role === val));
    renderUserListRows();
}
window.usSetListFilter = usSetListFilter;

// Kartu pilihan role di form Tambah User (mengisi input tersembunyi #us_new_role yang dibaca createNewUser).
function usPickRole(role) {
    const input = document.getElementById('us_new_role');
    if (input) input.value = role;
    document.querySelectorAll('#usRoleCards .us-rolecard').forEach(c => c.classList.toggle('active', c.dataset.role === role));
}
window.usPickRole = usPickRole;

function usGeneratePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const buf = new Uint32Array(10);
    crypto.getRandomValues(buf);
    const el = document.getElementById('us_new_password');
    if (el) el.value = Array.from(buf, n => chars[n % chars.length]).join('');
}
window.usGeneratePassword = usGeneratePassword;

// Sub-tab Akses Menu: "Per Role" atau "Per User (Pengecualian)".
function switchUsAccessMode(mode) {
    document.querySelectorAll('#usAccessSwitch button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const r = document.getElementById('usAccessRole'), u = document.getElementById('usAccessUser');
    if (r) r.style.display = mode === 'role' ? 'block' : 'none';
    if (u) u.style.display = mode === 'user' ? 'block' : 'none';
}
window.switchUsAccessMode = switchUsAccessMode;

// Tombol "Atur akses menu" di baris daftar user: loncat ke Akses Menu > Per User dengan akun itu terpilih.
async function usJumpToAccess(userId) {
    switchUsInnerTab('access');
    switchUsAccessMode('user');
    await populateUmaUserSelect();
    const sel = document.getElementById('umaUserSelect');
    if (sel) { sel.value = userId; renderUserMenuAccessMatrix(); }
}
window.usJumpToAccess = usJumpToAccess;

// Kontrol 3 pilihan (Ikuti Role / Izinkan / Larang) di matriks per user. <select class="uma-select"> tersembunyi
// tetap jadi sumber nilai yang dibaca saveUserMenuAccessMatrix().
function umaSetState(btn) {
    const seg = btn.closest('.us-seg');
    if (!seg) return;
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    seg.dataset.state = btn.dataset.v;
    const sel = seg.querySelector('select.uma-select');
    if (sel) sel.value = btn.dataset.v;
}
window.umaSetState = umaSetState;

// ============================================================
// 12b-2b. GANTI PASSWORD USER LAIN (admin only)
// Lewat Edge Function admin-reset-user-password (pakai Supabase Auth Admin
// API), admin bisa reset password user lain tanpa perlu tahu password lama.
// ============================================================
function openResetPasswordModal(userId, label) {
    if (currentRole !== 'admin') { showToast('Hanya Admin yang boleh mengganti password user', 'error'); return; }
    if (!userId) return;
    document.getElementById('rupTargetId').value = userId;
    document.getElementById('rupTargetLabel').textContent = label || '-';
    const pwdInput = document.getElementById('rupNewPassword');
    if (pwdInput) pwdInput.value = '';
    const statusEl = document.getElementById('rupStatus');
    if (statusEl) statusEl.innerHTML = '';
    document.getElementById('resetUserPasswordModal').classList.add('open');
    setTimeout(() => pwdInput && pwdInput.focus(), 100);
}
window.openResetPasswordModal = openResetPasswordModal;

function closeResetPasswordModal() {
    document.getElementById('resetUserPasswordModal').classList.remove('open');
}
window.closeResetPasswordModal = closeResetPasswordModal;

async function submitResetPassword() {
    const targetId = document.getElementById('rupTargetId')?.value || '';
    const newPassword = document.getElementById('rupNewPassword')?.value || '';
    const statusEl = document.getElementById('rupStatus');
    if (!targetId) return;
    if (!newPassword || newPassword.length < 6) {
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger);font-size:12.5px;"><i class="bi bi-exclamation-circle-fill"></i> Password baru minimal 6 karakter.</span>';
        return;
    }
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--ink-soft);font-size:12.5px;"><i class="bi bi-hourglass-split"></i> Mengganti password...</span>';
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) throw new Error('Sesi login tidak ditemukan, silakan login ulang.');
        const resp = await fetch(ADMIN_RESET_USER_PASSWORD_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + session.access_token
            },
            body: JSON.stringify({ target_user_id: targetId, new_password: newPassword })
        });
        const result = await resp.json();
        if (!resp.ok || !result.ok) throw new Error(result.description || 'Gagal mengganti password');

        showToast('Password user berhasil diganti');
        closeResetPasswordModal();
    } catch (err) {
        console.error('submitResetPassword error:', err);
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);font-size:12.5px;"><i class="bi bi-exclamation-circle-fill"></i> ${escapeHtml(err.message)}</span>`;
        showToast('Gagal mengganti password', 'error');
    }
}
window.submitResetPassword = submitResetPassword;

// ============================================================
// 12b-3. AKSES MENU SIDEBAR PER ROLE (admin only) — matrix checkbox
// User/Guest x daftar menu di SIDEBAR_MENU_REGISTRY, disimpan ke tabel
// role_menu_access. Dipakai oleh renderSidebarNav() (lihat bagian 12c)
// untuk memutuskan menu sidebar mana yang tampil utk role user/guest.
// ============================================================
async function renderRoleMenuAccessMatrix() {
    const wrap = document.getElementById('roleMenuAccessWrap');
    if (!wrap) return;
    if (currentRole !== 'admin') {
        wrap.innerHTML = '<div style="text-align:center;padding:20px;color:var(--ink-soft);">Hanya Admin yang bisa mengatur akses menu.</div>';
        return;
    }
    wrap.innerHTML = '<div style="text-align:center;padding:20px;color:var(--ink-soft);">Memuat...</div>';

    const { data, error } = await supabaseClient.from('role_menu_access').select('role, menu_key, allowed');
    if (error) {
        const isMissingSetup = /relation .*role_menu_access.* does not exist/i.test(error.message || '');
        wrap.innerHTML = isMissingSetup
            ? `<div style="padding:14px;color:var(--danger);font-size:12.5px;">Setup belum lengkap: jalankan <code>sql/33_tambah_akses_menu_role.sql</code> di SQL Editor Supabase, lalu buka lagi tab ini.</div>`
            : `<div style="padding:14px;color:var(--danger);font-size:12.5px;">Gagal memuat akses menu: ${escapeHtml(error.message)}</div>`;
        return;
    }

    const current = { user: new Set(), guest: new Set() };
    (data || []).forEach(row => { if (row.allowed && current[row.role]) current[row.role].add(row.menu_key); });

    const groups = [...new Set(SIDEBAR_MENU_REGISTRY.map(m => m.group))];
    const roleLabelMap = { user: 'User', guest: 'Guest' };
    const cols = SIDEBAR_MENU_CONFIGURABLE_ROLES;
    const rowsHtml = groups.map(group => {
        const itemsHtml = SIDEBAR_MENU_REGISTRY.filter(m => m.group === group).map(m => `
            <tr>
                <td class="us-mx-label">${escapeHtml(m.label)}</td>
                ${cols.map(role => `
                <td class="us-mx-cell"><label class="us-switch"><input type="checkbox" class="rma-check" data-role="${role}" data-menu-key="${m.key}" ${current[role].has(m.key) ? 'checked' : ''}><span class="us-switch-ui"></span></label></td>`).join('')}
            </tr>`).join('');
        return `<tr class="us-mx-group"><td colspan="${1 + cols.length}">${escapeHtml(group)}</td></tr>${itemsHtml}`;
    }).join('');

    wrap.innerHTML = `
        <div class="admin-table-wrap us-matrix">
            <table>
                <thead><tr><th>Menu</th>${cols.map(role => `<th class="us-mx-cell">${roleLabelMap[role] || role}</th>`).join('')}</tr></thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>`;
}

async function saveRoleMenuAccessMatrix() {
    if (currentRole !== 'admin') { showToast('Hanya Admin yang boleh mengubah akses menu', 'error'); return; }
    const statusEl = document.getElementById('roleMenuAccessStatus');
    const checks = document.querySelectorAll('#roleMenuAccessWrap .rma-check');
    if (!checks.length) return;

    const rows = Array.from(checks).map(el => ({
        role: el.dataset.role,
        menu_key: el.dataset.menuKey,
        allowed: el.checked,
        updated_at: new Date().toISOString()
    }));

    if (statusEl) statusEl.innerHTML = '<span style="color:var(--ink-soft);font-size:12.5px;"><i class="bi bi-hourglass-split"></i> Menyimpan...</span>';
    try {
        const { error } = await supabaseClient.from('role_menu_access').upsert(rows, { onConflict: 'role,menu_key' });
        if (error) throw error;
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--success);font-size:12.5px;"><i class="bi bi-check-circle-fill"></i> Tersimpan.</span>';
        showToast('Akses menu sidebar berhasil disimpan');
        // Muat ulang cache & terapkan langsung ke sidebar sesi ini juga (relevan
        // kalau admin sedang login sambil di-impersonate/testing role lain di tab lain).
        await loadRoleMenuAccess(true);
        renderSidebarNav();
    } catch (err) {
        console.error('saveRoleMenuAccessMatrix error:', err);
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);font-size:12.5px;"><i class="bi bi-exclamation-circle-fill"></i> Gagal menyimpan: ${escapeHtml(err.message)}</span>`;
        showToast('Gagal menyimpan akses menu', 'error');
    }
}

// ============================================================
// 12b-4. AKSES MENU SIDEBAR PER USER (override, admin only) — pengecualian
// per akun individual di atas default role_menu_access. Simpan ke tabel
// user_menu_access (sql/34_tambah_akses_menu_user.sql). Baris yang tidak
// diubah (tetap "Ikuti Role") sengaja TIDAK disimpan sbg baris di tabel --
// supaya kalau default role-nya diubah nanti lewat matrix per role, akun
// yang belum pernah dikecualikan otomatis ikut berubah juga.
// ============================================================
let umaCachedUsers = []; // {id, label, email, dashboard_role} non-admin, diisi populateUmaUserSelect()

async function populateUmaUserSelect() {
    const sel = document.getElementById('umaUserSelect');
    if (!sel || currentRole !== 'admin') return;
    const { data, error } = await supabaseClient
        .from('dashboard_profiles')
        .select('id, email, label, dashboard_role')
        .order('label');
    if (error) return; // biarkan diam -- tab "Daftar User" di sebelah sudah menampilkan pesan error setup kalau relevan
    umaCachedUsers = data || [];
    const prevValue = sel.value;
    sel.innerHTML = '<option value="">-- Pilih akun --</option>' + umaCachedUsers.map(u => {
        const roleTag = u.dashboard_role === 'admin' ? ' (Admin — selalu penuh)' : ` (${u.dashboard_role === 'guest' ? 'Guest' : 'User'})`;
        return `<option value="${escapeJsAttr(u.id)}">${escapeHtml(u.label || u.email || u.id)}${roleTag}</option>`;
    }).join('');
    if (prevValue && umaCachedUsers.some(u => u.id === prevValue)) sel.value = prevValue;
}

async function renderUserMenuAccessMatrix() {
    const sel = document.getElementById('umaUserSelect');
    const wrap = document.getElementById('userMenuAccessWrap');
    const actions = document.getElementById('userMenuAccessActions');
    if (!wrap || !actions) return;
    const userId = sel?.value || '';
    const statusEl = document.getElementById('userMenuAccessStatus');
    if (statusEl) statusEl.innerHTML = '';

    if (!userId) { wrap.innerHTML = ''; actions.style.display = 'none'; return; }

    const targetUser = umaCachedUsers.find(u => u.id === userId);
    if (targetUser && targetUser.dashboard_role === 'admin') {
        wrap.innerHTML = '<div style="padding:14px;color:var(--ink-soft);font-size:12.5px;">Akun Admin selalu punya akses menu penuh dan tidak bisa dibatasi di sini (supaya admin tidak terkunci dari akun sendiri).</div>';
        actions.style.display = 'none';
        return;
    }

    wrap.innerHTML = '<div style="text-align:center;padding:20px;color:var(--ink-soft);">Memuat...</div>';
    actions.style.display = 'none';

    const [{ data: roleRows, error: roleErr }, { data: userRows, error: userErr }] = await Promise.all([
        supabaseClient.from('role_menu_access').select('role, menu_key, allowed').eq('role', targetUser ? targetUser.dashboard_role : 'user'),
        supabaseClient.from('user_menu_access').select('menu_key, allowed').eq('user_id', userId)
    ]);
    if (roleErr || userErr) {
        const err = roleErr || userErr;
        const isMissingSetup = /relation .*user_menu_access.* does not exist/i.test(err.message || '');
        wrap.innerHTML = isMissingSetup
            ? `<div style="padding:14px;color:var(--danger);font-size:12.5px;">Setup belum lengkap: jalankan <code>sql/34_tambah_akses_menu_user.sql</code> di SQL Editor Supabase, lalu buka lagi tab ini.</div>`
            : `<div style="padding:14px;color:var(--danger);font-size:12.5px;">Gagal memuat akses menu user: ${escapeHtml(err.message)}</div>`;
        return;
    }

    const roleDefault = {}; // menu_key -> boolean, default role akun ini
    (roleRows || []).forEach(r => { roleDefault[r.menu_key] = !!r.allowed; });
    const override = {}; // menu_key -> boolean, cuma yg PUNYA baris override
    (userRows || []).forEach(r => { override[r.menu_key] = !!r.allowed; });

    const groups = [...new Set(SIDEBAR_MENU_REGISTRY.map(m => m.group))];
    const rowsHtml = groups.map(group => {
        const itemsHtml = SIDEBAR_MENU_REGISTRY.filter(m => m.group === group).map(m => {
            const hasOverride = Object.prototype.hasOwnProperty.call(override, m.key);
            const state = hasOverride ? (override[m.key] ? 'allow' : 'deny') : 'inherit';
            const defaultLabel = roleDefault[m.key] ? 'boleh' : 'tidak boleh';
            const seg = [['inherit', 'Ikuti Role'], ['allow', 'Izinkan'], ['deny', 'Larang']]
                .map(([v, t]) => `<button type="button" data-v="${v}" class="${state === v ? 'active' : ''}" onclick="umaSetState(this)">${t}</button>`).join('');
            const opts = [['inherit', 'Ikuti Role'], ['allow', 'Izinkan'], ['deny', 'Larang']]
                .map(([v, t]) => `<option value="${v}"${state === v ? ' selected' : ''}>${t}</option>`).join('');
            return `
            <tr>
                <td class="us-mx-label">${escapeHtml(m.label)}<div class="us-mx-sub">Default role: ${defaultLabel}</div></td>
                <td class="us-mx-cell"><div class="us-seg us-seg-sm" data-state="${state}">${seg}<select class="uma-select" data-menu-key="${m.key}" hidden>${opts}</select></div></td>
            </tr>`;
        }).join('');
        return `<tr class="us-mx-group"><td colspan="2">${escapeHtml(group)}</td></tr>${itemsHtml}`;
    }).join('');

    const tRole = (targetUser && US_ROLE_META[targetUser.dashboard_role]) ? targetUser.dashboard_role : 'user';
    const tName = targetUser ? (targetUser.label || targetUser.email || '-') : '-';
    wrap.innerHTML = `
        <div class="us-target">
            <span class="us-avatar us-role-${tRole}">${escapeHtml(usInitials(tName))}</span>
            <div class="us-user-txt"><b>${escapeHtml(tName)}</b><span>${escapeHtml(targetUser?.email || '')}</span></div>
            <span class="us-badge us-role-${tRole}"><i class="bi ${US_ROLE_META[tRole].icon}"></i> ${US_ROLE_META[tRole].label}</span>
        </div>
        <div class="admin-table-wrap us-matrix">
            <table>
                <thead><tr><th>Menu</th><th class="us-mx-cell">Akses</th></tr></thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>`;
    actions.style.display = 'flex';
}
window.renderUserMenuAccessMatrix = renderUserMenuAccessMatrix;

async function saveUserMenuAccessMatrix() {
    if (currentRole !== 'admin') { showToast('Hanya Admin yang boleh mengubah akses menu', 'error'); return; }
    const userId = document.getElementById('umaUserSelect')?.value || '';
    const statusEl = document.getElementById('userMenuAccessStatus');
    if (!userId) return;
    const selects = document.querySelectorAll('#userMenuAccessWrap .uma-select');
    if (!selects.length) return;

    // "inherit" -> hapus baris (kalau ada) supaya kembali ikut role.
    // "allow"/"deny" -> upsert baris dgn allowed sesuai pilihan.
    const toUpsert = [];
    const inheritKeys = [];
    selects.forEach(el => {
        const menuKey = el.dataset.menuKey;
        if (el.value === 'inherit') inheritKeys.push(menuKey);
        else toUpsert.push({ user_id: userId, menu_key: menuKey, allowed: el.value === 'allow', updated_at: new Date().toISOString() });
    });

    if (statusEl) statusEl.innerHTML = '<span style="color:var(--ink-soft);font-size:12.5px;"><i class="bi bi-hourglass-split"></i> Menyimpan...</span>';
    try {
        if (toUpsert.length) {
            const { error } = await supabaseClient.from('user_menu_access').upsert(toUpsert, { onConflict: 'user_id,menu_key' });
            if (error) throw error;
        }
        if (inheritKeys.length) {
            const { error } = await supabaseClient.from('user_menu_access').delete().eq('user_id', userId).in('menu_key', inheritKeys);
            if (error) throw error;
        }
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--success);font-size:12.5px;"><i class="bi bi-check-circle-fill"></i> Tersimpan.</span>';
        showToast('Akses menu user berhasil disimpan');
        // Kalau admin sedang menyunting akses akun dirinya sendiri (mis. login
        // sbg user biasa di tab lain buat testing), sidebar sesi ini ikut diperbarui.
        await loadUserMenuAccess(true);
        renderSidebarNav();
    } catch (err) {
        console.error('saveUserMenuAccessMatrix error:', err);
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);font-size:12.5px;"><i class="bi bi-exclamation-circle-fill"></i> Gagal menyimpan: ${escapeHtml(err.message)}</span>`;
        showToast('Gagal menyimpan akses menu user', 'error');
    }
}
window.saveUserMenuAccessMatrix = saveUserMenuAccessMatrix;

async function resetUserMenuAccessMatrix() {
    if (currentRole !== 'admin') { showToast('Hanya Admin yang boleh mengubah akses menu', 'error'); return; }
    const userId = document.getElementById('umaUserSelect')?.value || '';
    if (!userId) return;
    if (!await openActionConfirm({ title: 'Reset Akses Menu', message: 'Hapus semua pengecualian akses menu untuk akun ini? Akun ini akan kembali murni ikut default role-nya.', confirmLabel: 'Ya, Hapus' })) return;
    const statusEl = document.getElementById('userMenuAccessStatus');
    try {
        const { error } = await supabaseClient.from('user_menu_access').delete().eq('user_id', userId);
        if (error) throw error;
        showToast('Akses user dikembalikan ke default role');
        await renderUserMenuAccessMatrix();
        await loadUserMenuAccess(true);
        renderSidebarNav();
    } catch (err) {
        console.error('resetUserMenuAccessMatrix error:', err);
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);font-size:12.5px;"><i class="bi bi-exclamation-circle-fill"></i> Gagal: ${escapeHtml(err.message)}</span>`;
        showToast('Gagal reset akses user', 'error');
    }
}
window.resetUserMenuAccessMatrix = resetUserMenuAccessMatrix;

// withBusy() (app.js): anti klik ganda + spinner. Dibungkus di sini karena fungsinya baru ada setelah modul dimuat.
if (typeof window.saveRoleMenuAccessMatrix === 'function') window.saveRoleMenuAccessMatrix = withBusy(window.saveRoleMenuAccessMatrix);
if (typeof window.saveUserMenuAccessMatrix === 'function') window.saveUserMenuAccessMatrix = withBusy(window.saveUserMenuAccessMatrix);
if (typeof window.submitResetPassword === 'function') window.submitResetPassword = withBusy(window.submitResetPassword);
