/* ============================================================
   AUTH SYSTEM
   ============================================================ */
const AUTH_STORAGE_KEY = 'kt_auth_user';

// Fallback LOKAL kalau RPC gagal dihubungi (mis. belum jalankan supabase-rls-setup.sql).
// Tidak ada field password di sini sama sekali — login SELALU diverifikasi di server
// lewat rpc_login, browser tidak pernah menerima/menyimpan hash password.
const DEFAULT_USERS_FALLBACK = [
  { id: 'admin1', name: 'Admin Utama', username: 'admin', role: 'admin' },
  { id: 'user1', name: 'User 1', username: 'user', role: 'user' },
  { id: 'user2', name: 'User 2', username: 'user2', role: 'user' },
];

function getUsers() {
  if (db.users && db.users.length > 0) return db.users;
  return DEFAULT_USERS_FALLBACK;
}

function getCurrentUser() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return null;
}

function setCurrentUser(user) {
  if (user) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

// Token sesi dari rpc_login, dikirim ulang di header `x-session-token` tiap
// request (lihat override fetch di 00-config.js) supaya server bisa
// memverifikasi caller benar-benar sudah login sebelum RPC/tabel sensitif
// mengizinkan aksi (lihat supabase-session-auth-migration.sql).
const SESSION_TOKEN_KEY = 'kt_session_token';

function setSessionToken(token) {
  if (token) {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  }
}

function isAdmin() {
  const user = getCurrentUser();
  return user && user.role === 'admin';
}

function isUser() {
  const user = getCurrentUser();
  return user && (user.role === 'user' || user.role === 'admin');
}

function isPetugas() {
  const user = getCurrentUser();
  return user && user.role === 'petugas';
}

function userSections() {
  const user = getCurrentUser();
  return (user && user.allowed_sections) || [];
}

// Bisa akses (lihat) section ini? Admin: semua section. User: semua section
// KECUALI yang adminOnly (Pengaturan, Manajemen User). Petugas: cuma
// dashboard + section yang ditugaskan ke dia (juga tidak pernah termasuk
// section adminOnly, karena adminOnly tidak pernah masuk daftar pilihan
// bidang Petugas — lihat openUserModal di 06-login-users.js).
function canAccessSection(key) {
  const user = getCurrentUser();
  if (!user) return false;
  if (user.role === 'admin') return true;
  const section = typeof SECTIONS !== 'undefined' ? SECTIONS.find(s => s.key === key) : null;
  if (section && section.adminOnly) return false;
  if (user.role === 'user') return true;
  if (user.role === 'petugas') return key === 'dashboard' || userSections().includes(key);
  return false;
}

// Bisa edit data di section ini? Sama aturannya dengan akses,
// karena Petugas yang boleh masuk ke section-nya otomatis boleh kelola penuh di situ.
function canEditSection(key) {
  return canAccessSection(key);
}

function canEdit() {
  return isUser();
}

function canManageSettings() {
  return isAdmin();
}

// Login diverifikasi 100% di server lewat RPC rpc_login. Password mentah dikirim
// lewat HTTPS (sama seperti panggilan Supabase lain), di-hash & dibandingkan di
// Postgres — hash TIDAK PERNAH dikembalikan ke browser, dan kt_users tidak bisa
// dibaca langsung oleh anon key (lihat supabase-rls-setup.sql Bagian 2).
async function login(username, password) {
  const { data, error } = await sb.rpc('rpc_login', { p_username: username, p_password: password });
  if (error) { console.error('Login error:', error); return null; }
  if (!data || data.length === 0) return null;
  const { session_token, ...user } = data[0];
  setSessionToken(session_token || null);
  setCurrentUser(user);
  // Kalau yang login admin, db.users kemungkinan masih kosong/fallback —
  // loadDB() saat app pertama dibuka SENGAJA melewati rpc_list_users kalau
  // saat itu belum ada yang login sebagai admin (lihat 03-db-core.js, RPC ini
  // wajib session_is_admin() di server). Refresh sekali di sini supaya begitu
  // admin buka halaman Manajemen User, datanya langsung akurat, bukan
  // DEFAULT_USERS_FALLBACK.
  if (user.role === 'admin' && typeof db !== 'undefined') {
    try {
      const { data: freshUsers, error: usersErr } = await sb.rpc('rpc_list_users');
      if (!usersErr && freshUsers) db.users = freshUsers;
    } catch(e) { console.error('Gagal refresh daftar user setelah login:', e); }
  }
  return user;
}

// Catat waktu terakhir user membuka aplikasi. Dipanggil di 2 tempat:
// 1. Sesudah initApp() selesai load data & ada sesi user yang masih valid
//    (localStorage) — ini kasus paling umum, app dibuka lagi tanpa login
//    ulang lewat form (lihat js/19-init.js).
// 2. login() di bawah juga sudah menyetel last_seen_at langsung lewat
//    rpc_login di server, jadi tidak perlu panggil ini lagi setelah login.
// Sengaja tidak melempar error kalau gagal (mis. offline) — cuma catatan,
// bukan aksi kritikal, jadi tidak boleh mengganggu alur pemakaian app.
async function touchLastSeen(id) {
  if (!id) return;
  try { await sb.rpc('rpc_touch_last_seen', { p_id: id }); }
  catch (e) { console.error('Gagal mencatat waktu terakhir dibuka:', e); }
}

// Verifikasi token sesi tersimpan ke server. Dipanggil sekali saat app dibuka
// (lihat js/19-init.js). Kalau token sudah tidak berlaku (kedaluwarsa, dicabut
// karena password diganti admin, atau memang palsu), sesi lokal dibersihkan
// supaya app tidak menampilkan menu yang sebenarnya sudah tidak boleh diakses.
async function validateSession() {
  let token = null;
  try { token = localStorage.getItem(SESSION_TOKEN_KEY); } catch(e) {}

  if (!token) {
    // Tidak ada token tapi ada sisa data user di localStorage -> sisa versi
    // lama app (sebelum ada sesi server). Bersihkan, paksa login ulang.
    if (getCurrentUser()) setCurrentUser(null);
    return null;
  }

  try {
    const { data, error } = await sb.rpc('rpc_session_user');
    if (error) {
      // Error jaringan: JANGAN paksa logout — user di sinyal jelek tidak
      // seharusnya kehilangan sesinya. Biarkan apa adanya; kalau tokennya
      // memang tidak valid, server akan menolak setiap operasi tulis.
      console.error('Gagal memvalidasi sesi:', error);
      return getCurrentUser();
    }
    const user = Array.isArray(data) ? data[0] : data;
    if (!user) {
      setSessionToken(null);
      setCurrentUser(null);
      return null;
    }
    // Server adalah sumber kebenaran untuk role & hak akses.
    setCurrentUser(user);
    return user;
  } catch (e) {
    console.error('Gagal memvalidasi sesi:', e);
    return getCurrentUser();
  }
}

async function logout() {
  // Matikan sesi di SERVER dulu (bukan cuma hapus token di localStorage) --
  // kalau token ini sempat bocor, logout beneran membuatnya tidak berlaku lagi.
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  if (token) {
    try{ await sb.rpc('rpc_logout', { p_token: token }); }catch(e){ console.error('Logout RPC error:', e); }
  }
  setSessionToken(null);
  setCurrentUser(null);
  renderSidebar();
  renderTopbarSaldo();
  renderContent();
  toast('Anda telah logout');
}

