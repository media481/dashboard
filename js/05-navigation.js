/* ============================================================
   NAV / ROUTING
   ============================================================ */
const SECTIONS = [
  {key:'jadwal', label:'Jadwal Kegiatan', sub:'Kelola jadwal dan pengingat', icon:'calendar', adminOnly: false},
  {key:'dashboard', label:'Buku Kegiatan', sub:'Rekap & Reminder', icon:'grid', adminOnly: false},
  {key:'anggota', label:'Iuran Anggota', sub:'Kelola iuran anggota', icon:'users', adminOnly: false},
  {key:'donatur', label:'Donatur', sub:'Sumbangan uang & barang dari donatur', icon:'heart', adminOnly: false},
  {key:'transaksi', label:'Pemasukan Lain', sub:'Pemasukan di luar iuran & donasi', icon:'swap', adminOnly: false},
  {key:'operasional', label:'Operasional Kegiatan', sub:'Biaya operasional umum event', icon:'briefcase', adminOnly: false},
  {key:'lomba', label:'Lomba & Perlengkapan', sub:'Kebutuhan barang per lomba', icon:'flag', adminOnly: false},
  {key:'database-lomba', label:'Database Lomba', sub:'Riwayat lomba & perlengkapan lintas tahun', icon:'database', adminOnly: false},
  {key:'hadiah', label:'Kebutuhan Hadiah', sub:'Belanja hadiah per kategori peserta', icon:'gift', adminOnly: false},
  {key:'hadiah-jalan', label:'Hadiah Jalan Santai', sub:'Kelola hadiah jalan santai', icon:'walk', adminOnly: false},
  {key:'belanja-perlengkapan', label:'Belanja Perlengkapan', sub:'Daftar belanja perlengkapan lomba', icon:'package', adminOnly: false},
  {key:'belanja-jalan', label:'Belanja Jalan Santai', sub:'Daftar belanja hadiah jalan santai', icon:'shopping-bag', adminOnly: false},
  {key:'belanja-hadiah', label:'Belanja Hadiah', sub:'Daftar belanja hadiah lomba', icon:'shopping', adminOnly: false},
  {key:'lpj', label:'Laporan (LPJ)', sub:'Cetak laporan pertanggungjawaban', icon:'report', adminOnly: false},
  {key:'daftar-anggota', label:'Daftar Anggota', sub:'Rekap & daftar nama anggota', icon:'clipboard', adminOnly: false},
  {key:'pengaturan', label:'Pengaturan', sub:'Tarif iuran & event', icon:'gear', adminOnly: true},
  {key:'database-anggota', label:'Database Anggota', sub:'Cek & filter semua anggota', icon:'database', adminOnly: false},
  {key:'users', label:'Manajemen User', sub:'Kelola akun pengguna', icon:'users', adminOnly: true},
  {key:'agenda', label:'Agenda Kegiatan', sub:'', icon:'calendar', adminOnly: false},
  {key:'gudang', label:'Gudang Aset', sub:'Inventaris & pinjam aset desa', icon:'package', adminOnly: false},
  {key:'jadwal-sinoman', label:'Sinoman', sub:'Jadwal piket pagi/siang/sore', icon:'calendar', adminOnly: false},
  {key:'panduan', label:'Panduan', sub:'Cara pakai aplikasi ini', icon:'book', adminOnly: false},
  {key:'dokumen', label:'Surat & Dokumen', sub:'Undangan, proposal & absensi', icon:'clipboard', adminOnly: false},
  {key:'kas', label:'Kas Karang Taruna', sub:'', icon:'wallet', adminOnly: false},
  {key:'dana-sosial', label:'Dana Sosial', sub:'Iuran bulanan Rp 5.000/anggota', icon:'coins', adminOnly: false},
  {key:'bookmark', label:'Tautan Penting', sub:'Kumpulan link penting organisasi', icon:'link', adminOnly: false},
];

// `SECTIONS` di atas adalah const statis (dievaluasi sebelum data organisasi
// ter-load), jadi label menu "Kas Karang Taruna" TIDAK BISA langsung baca
// nama kas dari Profil Organisasi di titik itu. Fungsi ini yang dipanggil
// setiap kali menu dirender (bukan `s.label` langsung) supaya label section
// 'kas' selalu ikut nama buku kas terbaru dari Pengaturan > Profil Organisasi.
function sectionLabel(s){
  return s.key === 'kas' ? getOrgNamaKas() : s.label;
}
function sectionLabelByKey(key){
  const s = SECTIONS.find(s=>s.key===key);
  return s ? sectionLabel(s) : key;
}

// Menu yang tidak terikat event tertentu (datanya global, bukan per-event).
// Menu ini ditampilkan terpisah di atas, antara info login dan dropdown
// Kegiatan Aktif, supaya jelas tidak berubah walau event aktif diganti.
const GLOBAL_MENU_KEYS = ['kas', 'dana-sosial', 'agenda', 'dokumen', 'database-anggota', 'database-lomba', 'gudang', 'bookmark', 'jadwal-sinoman', 'panduan', 'users', 'pengaturan'];

/* ============================================================
   FITUR OPSIONAL PER EVENT
   Beberapa event (mis. sekadar iuran rutin) tidak butuh semua modul.
   Fitur di bawah ini bisa dimatikan per-event lewat modal Buat/Edit
   Event. Menu inti (Buku Kegiatan, Iuran, Database Anggota, LPJ,
   Pengaturan, Manajemen User) selalu aktif dan tidak bisa dimatikan.
   ============================================================ */
const FITUR_OPSIONAL = [
  {key:'donatur', label:'Donatur', menus:['donatur']},
  {key:'transaksi', label:'Pemasukan Lain', menus:['transaksi']},
  {key:'operasional', label:'Operasional Kegiatan', menus:['operasional']},
  {key:'lomba', label:'Lomba & Perlengkapan', menus:['lomba','belanja-perlengkapan']},
  {key:'hadiah', label:'Hadiah Lomba', menus:['hadiah','belanja-hadiah']},
  {key:'jalan_santai', label:'Hadiah Jalan Santai', menus:['hadiah-jalan','belanja-jalan']},
  {key:'jadwal', label:'Jadwal Kegiatan', menus:['jadwal']},
];
// Preset dipakai di modal event supaya tidak perlu centang satu-satu tiap bikin event baru.
// Catatan: "dokumen" (Surat & Dokumen) sengaja TIDAK ada di sini lagi — sejak
// menu ini berdiri sendiri seperti Gudang, tidak bisa dimatikan per event.
const FITUR_PRESET_SEDERHANA = {donatur:false, transaksi:false, operasional:false, lomba:false, hadiah:false, jalan_santai:false, jadwal:false};
const FITUR_PRESET_LENGKAP = {donatur:true, transaksi:true, operasional:true, lomba:true, hadiah:true, jalan_santai:true, jadwal:true};

// Default: fitur dianggap aktif kalau belum pernah diset (backward-compat utk event lama).
function eventFitur(ev){
  const f = (ev && ev.fitur) || {};
  const out = {};
  FITUR_OPSIONAL.forEach(x => out[x.key] = f[x.key] !== false);
  return out;
}
// Cek apakah sebuah menu/section aktif untuk event yang sedang dibuka.
// Menu yang tidak terdaftar di FITUR_OPSIONAL (menu inti) selalu true.
function isMenuAktif(menuKey){
  const ev = activeEvent();
  if (!ev) return true;
  const fitur = eventFitur(ev);
  const item = FITUR_OPSIONAL.find(x => x.menus.includes(menuKey));
  if (!item) return true;
  return !!fitur[item.key];
}
const ICONS = {
  grid:'<rect width="7" height="7" x="3" y="3" rx="1" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect width="7" height="7" x="14" y="3" rx="1" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect width="7" height="7" x="14" y="14" rx="1" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect width="7" height="7" x="3" y="14" rx="1" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 3.128a4 4 0 0 1 0 7.744" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  database:'<ellipse cx="12" cy="5" rx="9" ry="3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 5V19A9 3 0 0 0 21 19V5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12A9 3 0 0 0 21 12" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  heart:'<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  swap:'<path d="M8 3 4 7l4 4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 7h16" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="m16 21 4-4-4-4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 17H4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  briefcase:'<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect width="20" height="14" x="2" y="6" rx="2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  flag:'<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  gift:'<path d="M12 7v14" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="7" width="18" height="4" rx="1" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  gear:'<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  shopping:'<circle cx="8" cy="21" r="1" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="19" cy="21" r="1" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  package:'<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 22V12" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><polyline points="3.29 7 12 12 20.71 7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="m7.5 4.27 9 5.15" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  walk:'<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 17h4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 13h4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  'shopping-bag':'<path d="M16 10a4 4 0 0 1-8 0" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.103 6.034h17.794" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  calendar:'<path d="M8 2v4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 2v4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect width="18" height="18" x="3" y="4" rx="2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 10h18" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  pen:'<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="m15 5 4 4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  pot:'<path d="M2 12h20" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="m4 8 16-4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="m8.86 6.78-.45-1.81a2 2 0 0 1 1.45-2.43l1.94-.48a2 2 0 0 1 2.43 1.46l.45 1.8" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  food:'<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 2v20" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  bath:'<path d="M10 4 8 6" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 19v2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12h20" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 19v2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 5 7.621 3.621A2.121 2.121 0 0 0 4 5v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  tag:'<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  report:'<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 2v5a1 1 0 0 0 1 1h5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 9H8" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 13H8" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 17H8" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  clipboard:'<rect width="8" height="4" x="8" y="2" rx="1" ry="1" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  wallet:'<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  coins:'<path d="M13.744 17.736a6 6 0 1 1-7.48-7.48" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 6h1v4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="m6.134 14.768.866-.5 2 3.464" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="8" r="6" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  book:'<path d="M12 7v14" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
};
function icon(name){ return `<svg viewBox="0 0 24 24">${ICONS[name]||''}</svg>`; }

let currentSection = 'dashboard';

function renderSidebar(){
  const sel = document.getElementById('event-select');
  sel.innerHTML = db.events.length
    ? db.events.map(e=>`<option value="${e.id}" ${e.id===db.activeEventId?'selected':''}>${esc(e.nama)}</option>`).join('')
    : `<option value="">— Belum ada event —</option>`;

  const user = getCurrentUser();
  const isLoggedIn = !!user;
  const isAdminUser = user && user.role === 'admin';
  
  // Update user info
  const nameDisplay = document.getElementById('user-name-text');
  const userIcon = document.getElementById('user-icon');
  const btnLogin = document.getElementById('btn-login');
  const btnLogout = document.getElementById('btn-logout');
  
  if (isLoggedIn) {
    nameDisplay.textContent = user.name;
    userIcon.textContent = user.role === 'admin' ? '⚡' : '👤';
    btnLogin.style.display = 'none';
    btnLogout.style.display = 'inline-block';
  } else {
    nameDisplay.textContent = 'Anggota';
    userIcon.textContent = '👤';
    btnLogin.style.display = 'inline-block';
    btnLogout.style.display = 'none';
  }

  const nav = document.getElementById('nav');
  const navGlobal = document.getElementById('nav-global');
  const isPetugasUser = user && user.role === 'petugas';
  const visibleSections = SECTIONS
    .filter(s => !s.adminOnly || isAdminUser)
    .filter(s => isMenuAktif(s.key))
    .filter(s => {
      if (!isLoggedIn) return isGuestVisible(s.key);
      if (isPetugasUser) return s.key === 'dashboard' || userSections().includes(s.key);
      return true;
    });

  const renderNavItem = s => `
    <div class="nav-item ${s.key===currentSection?'active':''} ${!isLoggedIn && !s.adminOnly ? '' : ''}" data-nav="${s.key}" title="${esc(sectionLabel(s))}">
      ${icon(s.icon)} <span>${esc(sectionLabel(s))}</span>
      ${s.adminOnly && !isAdminUser ? `<span class="lock-icon">🔒</span>` : ''}
    </div>`;

  navGlobal.innerHTML = visibleSections
    .filter(s => GLOBAL_MENU_KEYS.includes(s.key))
    .sort((a, b) => GLOBAL_MENU_KEYS.indexOf(a.key) - GLOBAL_MENU_KEYS.indexOf(b.key))
    .map(renderNavItem).join('');
  nav.innerHTML = visibleSections.filter(s => !GLOBAL_MENU_KEYS.includes(s.key)).map(renderNavItem).join('');

  // Buat event baru: khusus Administrator
  document.getElementById('btn-new-event').style.display = isAdminUser ? 'inline-block' : 'none';
}

// Nama key localStorage tempat menyimpan halaman terakhir yang dibuka, supaya
// saat halaman di-refresh (F5) user tetap berada di halaman yang sama, tidak
// selalu dilempar balik ke Buku Kegiatan (dashboard).
const LAST_SECTION_KEY = 'merdeka_last_section';

function goSection(key, opts){
  const isFallback = !!(opts && opts.isFallback);
  const user = getCurrentUser();
  const section = SECTIONS.find(s=>s.key===key);
  if (section && section.adminOnly && !(user && user.role === 'admin')) {
    if (!isFallback) toast('⛔ Hanya Admin yang bisa mengakses halaman ini');
    if (key !== 'dashboard') return goSection('dashboard', {isFallback:true});
    return;
  }
  if (section && !isMenuAktif(key)) {
    if (!isFallback) toast('⛔ Fitur ini tidak diaktifkan untuk event ini');
    if (key !== 'dashboard') return goSection('dashboard', {isFallback:true});
    return;
  }
  if (section && !user && !isGuestVisible(key)) {
    if (!isFallback) toast('⛔ Halaman ini tidak tersedia untuk Guest. Silakan login.');
    if (key !== 'dashboard') return goSection('dashboard', {isFallback:true});
    return;
  }
  if (section && user && user.role === 'petugas' && key !== 'dashboard' && !userSections().includes(key)) {
    if (!isFallback) toast('⛔ Anda tidak memiliki akses ke halaman ini');
    if (key !== 'dashboard') return goSection('dashboard', {isFallback:true});
    return;
  }
  const prevSection = currentSection;
  currentSection = key;
  // Kalau admin sempat pilih logo baru di panel Profil Organisasi tapi TIDAK
  // klik "Simpan" (mis. keburu pindah menu lain), buang draft logo itu begitu
  // admin masuk LAGI ke halaman Pengaturan dari menu lain — supaya pilihan
  // logo lama yang sudah dilupakan tidak diam-diam ikut tersimpan saat admin
  // berikutnya cuma niat ganti Nama Organisasi/Nama Kas saja. Dicek lewat
  // prevSection (bukan cuma "key==='pengaturan'") supaya draft yang MASIH
  // sedang diisi tetap aman dari re-render auto-refresh (yang tidak lewat
  // goSection, jadi tidak kena reset ini).
  if(key === 'pengaturan' && prevSection !== 'pengaturan' && typeof _pendingOrgLogo !== 'undefined'){
    _pendingOrgLogo = undefined;
  }
  // Simpan halaman terakhir supaya bertahan walau halaman di-refresh.
  try { localStorage.setItem(LAST_SECTION_KEY, key); } catch(e){}
  const meta = SECTIONS.find(s=>s.key===key);
  document.getElementById('page-title').textContent = meta ? meta.label : 'Dashboard';
  document.getElementById('page-sub').textContent = meta ? (meta.desc || meta.sub) : '';
  renderSidebar();
  renderTopbarSaldo();
  renderContent();
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('show');
  window.scrollTo({top:0, behavior:'instant'});
}

// Menu yang tidak terikat event (bisa diakses walau belum ada event 17-an
// yang dibuat/dipilih). Dipakai di renderContent (supaya halaman tidak
// nampilin "Belum ada event aktif") dan di renderTopbarSaldo (supaya chip
// saldo proyeksi kegiatan/event tidak ikut nongol di menu yang memang tidak
// terikat event tersebut — chip itu punya arti khusus untuk event aktif,
// jadi kalau ditampilkan di menu eventless malah bikin salah paham).
const EVENTLESS_SECTIONS = ['gudang', 'dokumen', 'agenda', 'kas', 'dana-sosial', 'bookmark', 'dashboard', 'pengaturan', 'users', 'panduan', 'jadwal-sinoman', 'database-lomba'];

function renderTopbarSaldo(){
  const chip = document.getElementById('saldo-chip');
  // Chip ini menampilkan proyeksi anggaran EVENT/kegiatan khusus yang aktif
  // (dari hitungBukuUtama). Di menu yang tidak terikat event (lihat
  // EVENTLESS_SECTIONS) angka ini tidak relevan dan gampang disalahpahami
  // sebagai saldo milik menu tersebut, jadi disembunyikan di menu-menu itu.
  if(!activeEvent() || EVENTLESS_SECTIONS.includes(currentSection)){ chip.style.visibility='hidden'; return; }
  chip.style.visibility='visible';
  const {saldo} = hitungBukuUtama();
  chip.classList.toggle('negatif', saldo < 0);
  document.getElementById('saldo-val').textContent = fmtRp(saldo);
}

function renderContent(){
  const el = document.getElementById('content');
  const isLoggedIn = !!getCurrentUser();
  const isAdminUser = getCurrentUser()?.role === 'admin';

  // Simpan fokus & posisi kursor input aktif (mis. kolom pencarian) agar tidak hilang saat re-render
  const activeEl = document.activeElement;
  let focusInfo = null;
  if (activeEl && el.contains(activeEl) && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && activeEl.id) {
    focusInfo = { id: activeEl.id, selStart: activeEl.selectionStart, selEnd: activeEl.selectionEnd };
  }
  
  // Menu yang tidak terikat event tetap bisa diakses walau belum ada
  // event 17-an yang dibuat/dipilih (lihat EVENTLESS_SECTIONS di atas).
  if(!activeEvent() && !EVENTLESS_SECTIONS.includes(currentSection)){
    el.innerHTML = `<div class="empty-state"><h3>Belum ada event aktif</h3><p>${isLoggedIn ? 'Buat event tahunan dulu.' : 'Login untuk membuat atau mengelola event.'}</p>
      ${isLoggedIn ? `<button class="btn" ${da('openEventModal')}>+ Buat Event Pertama</button>` : `<button class="btn" ${da('openLoginModal')}>🔑 Login untuk Mengelola</button>`}
    </div>`;
    return;
  }
  
  // Check if current section is admin-only
  const section = SECTIONS.find(s=>s.key===currentSection);
  if (section && section.adminOnly && !isAdminUser) {
    el.innerHTML = `<div class="empty-state"><h3>⛔ Akses Ditolak</h3><p>Halaman ini hanya untuk Admin.</p><button class="btn" ${da('goSection', 'dashboard')}>Kembali ke Dashboard</button></div>`;
    return;
  }

  // Check if current section's feature is turned off for this event
  if (section && !isMenuAktif(currentSection)) {
    el.innerHTML = `<div class="empty-state"><h3>Fitur tidak aktif</h3><p>Fitur ini dimatikan untuk event "${esc(activeEvent().nama)}". Aktifkan lagi lewat tombol ✎ di daftar event pada halaman Pengaturan kalau dibutuhkan.</p><button class="btn" ${da('goSection', 'dashboard')}>Kembali ke Dashboard</button></div>`;
    return;
  }

  // Check if current section is hidden for guest
  if (section && !isLoggedIn && !isGuestVisible(currentSection)) {
    el.innerHTML = `<div class="empty-state"><h3>⛔ Akses Ditolak</h3><p>Halaman ini tidak tersedia untuk Guest.</p><button class="btn" ${da('openLoginModal')}>🔑 Login untuk Mengakses</button></div>`;
    return;
  }

  // Check if current section is outside Petugas' assigned bidang
  if (section && isPetugas() && currentSection !== 'dashboard' && !userSections().includes(currentSection)) {
    el.innerHTML = `<div class="empty-state"><h3>⛔ Akses Ditolak</h3><p>Anda tidak memiliki akses ke halaman ini.</p><button class="btn" ${da('goSection', 'dashboard')}>Kembali ke Dashboard</button></div>`;
    return;
  }
  
  switch(currentSection){
    case 'panduan': el.innerHTML = renderPanduan(); break;
    case 'dashboard': el.innerHTML = renderDashboard(); break;
    case 'anggota': el.innerHTML = renderAnggota(); break;
    case 'database-anggota': el.innerHTML = renderDatabaseAnggota(); break;
    case 'donatur': el.innerHTML = renderDonatur(); break;
    case 'transaksi': el.innerHTML = renderTransaksi(); break;
    case 'operasional': el.innerHTML = renderOperasional(); break;
    case 'lomba': el.innerHTML = renderLomba(); break;
    case 'database-lomba': el.innerHTML = renderDatabaseLomba(); break;
    case 'hadiah': el.innerHTML = renderHadiah(); break;
    case 'belanja-hadiah': el.innerHTML = renderBelanjaHadiah(); break;
    case 'belanja-perlengkapan': el.innerHTML = renderBelanjaPerlengkapan(); break;
    case 'hadiah-jalan': el.innerHTML = renderHadiahJalanSantai(); break;
    case 'belanja-jalan': el.innerHTML = renderBelanjaJalanSantai(); break;
    case 'jadwal': el.innerHTML = renderJadwal(); break;
    case 'agenda': el.innerHTML = renderAgenda(); break;
    case 'gudang': el.innerHTML = renderGudang(); break;
    case 'dokumen': el.innerHTML = renderDokumen(); break;
    case 'jadwal-sinoman': el.innerHTML = renderJadwalSinoman(activeEvent()); break;
    case 'kas': el.innerHTML = renderKas(); break;
    case 'dana-sosial': el.innerHTML = renderDanaSosial(); break;
    case 'bookmark': el.innerHTML = renderBookmark(); break;
    case 'lpj': el.innerHTML = renderLPJ(); break;
    case 'daftar-anggota': el.innerHTML = renderDaftarAnggota(); break;
    case 'pengaturan': el.innerHTML = renderPengaturan(); break;
    case 'users': el.innerHTML = renderUsers(); break;
    default: el.innerHTML = renderDashboard();
  }
  
  // Setup currency inputs after content rendered
  setTimeout(setupAllCurrencyInputs, 50);
  setTimeout(setupAutoResizeTextareas, 50);

  if (currentSection === 'lpj' || currentSection === 'dokumen' || currentSection === 'daftar-anggota' || currentSection === 'jadwal-sinoman') {
    requestAnimationFrame(applyLpjMobileScale);
  }
  // Tab Proposal di menu Surat & Dokumen dipecah jadi beberapa lembar A4
  // (lihat renderProposalA4Pages di js/14-dokumen.js) — perlu diukur ulang
  // setiap render karena tergantung lebar kolom pratinjau saat ini.
  if (currentSection === 'dokumen' && typeof _dokumenTab !== 'undefined' && _dokumenTab === 'proposal') {
    requestAnimationFrame(renderProposalA4Pages);
  }

  // Kembalikan fokus & posisi kursor ke input yang sama (jika masih ada di DOM baru)
  if (focusInfo) {
    const newEl = document.getElementById(focusInfo.id);
    if (newEl) {
      newEl.focus();
      if (typeof newEl.setSelectionRange === 'function' && focusInfo.selStart != null) {
        try { newEl.setSelectionRange(focusInfo.selStart, focusInfo.selEnd); } catch(e){}
      }
    }
  }
}

