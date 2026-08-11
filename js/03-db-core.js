/* ============================================================
   DATA LAYER
   ============================================================ */
function uid(){ return (crypto.randomUUID ? crypto.randomUUID() : 'id-'+Date.now()+'-'+Math.random().toString(16).slice(2)); }
// Tanggal formulir harus mengikuti kalender lokal pengguna, bukan UTC.
// toISOString() menggeser tanggal menjadi hari sebelumnya pada dini hari WIB.
function todayISO(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function fmtRp(n){ return new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',minimumFractionDigits:0}).format(Number(n)||0); }
function fmtDate(iso){ if(!iso) return '-'; const d=new Date(iso+'T00:00:00'); return d.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'}); }
function fmtDateShort(iso){ if(!iso) return '-'; const d=new Date(iso+'T00:00:00'); return d.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'2-digit'}); }
// Format super-ringkas khusus layar HP (mis. tabel Pemasukan Lain & Operasional
// Kegiatan): "23/7/26" — tanpa nama bulan supaya kolom Tanggal bisa dipersempit
// dan ruang mengalir ke kolom Keterangan/Harga/Jumlah yang lebih butuh lebar.
function fmtDateMobile(iso){ if(!iso) return '-'; const d=new Date(iso+'T00:00:00'); return `${d.getDate()}/${d.getMonth()+1}/${String(d.getFullYear()).slice(-2)}`; }
// Bungkus label kolom tabel agar bisa tampil beda antara desktop (teks penuh)
// dan HP (versi singkat) murni lewat CSS (lihat .th-full/.th-short di style.css),
// tanpa perlu JS re-render saat resize layar.
function thResponsive(full, short){ return `<span class="th-full">${esc(full)}</span><span class="th-short">${esc(short)}</span>`; }
// Sama seperti thResponsive tapi untuk isi sel tanggal (dt-full/dt-short).
function dateResponsive(iso){ return `<span class="dt-full">${fmtDateShort(iso)}</span><span class="dt-short">${fmtDateMobile(iso)}</span>`; }
// Tanggal + nama hari, dipakai di mana pun hari acara perlu terlihat jelas (mis. Jadwal Lomba).
function fmtDateHari(iso){ if(!iso) return '-'; const d=new Date(iso+'T00:00:00'); return d.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); }
function fmtDateHariShort(iso){ if(!iso) return '-'; const d=new Date(iso+'T00:00:00'); return d.toLocaleDateString('id-ID',{weekday:'short',day:'numeric',month:'short',year:'numeric'}); }
// Gabungan hari, tanggal, dan jam (kalau jam-nya diisi) — format siap-tampil.
function fmtDateJam(iso, jam, {short}={}){ const tgl = short ? fmtDateHariShort(iso) : fmtDateHari(iso); return jam ? `${tgl} · ${jam}` : tgl; }
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// Waktu terakhir user membuka aplikasi (kt_users.last_seen_at, timestamp
// lengkap dgn jam — beda dari fmtDate* di atas yg cuma untuk tanggal form).
// Dipakai di halaman Manajemen User. Format relatif untuk yg baru-baru ini
// (lebih gampang dibaca sekilas), balik ke tanggal absolut kalau sudah lama.
function fmtWaktuTerakhir(iso){
  if(!iso) return 'Belum pernah';
  const d = new Date(iso);
  if(isNaN(d.getTime())) return 'Belum pernah';
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if(diffMin < 1) return 'Baru saja';
  if(diffMin < 60) return `${diffMin} menit lalu`;
  const diffJam = Math.floor(diffMin / 60);
  if(diffJam < 24) return `${diffJam} jam lalu`;
  const diffHari = Math.floor(diffJam / 24);
  const jamMenit = d.toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'});
  if(diffHari === 1) return `Kemarin, ${jamMenit}`;
  if(diffHari < 7) return `${diffHari} hari lalu`;
  return `${d.toLocaleDateString('id-ID', {day:'numeric', month:'short', year:'numeric'})}, ${jamMenit}`;
}

// Profil Organisasi — inilah SATU-SATUNYA tempat nama organisasi, logo, dan
// nama buku kas "di-hardcode". Nilai di bawah ini cuma FALLBACK yang dipakai
// kalau baris kt_organisasi_profil belum pernah diisi admin lewat halaman
// Pengaturan > Profil Organisasi (lihat getOrgProfil() di bawah). Begitu
// admin mengisi & menyimpan di sana, kode di seluruh app otomatis membaca
// nilai baru itu — TIDAK ADA nama/logo yang tertanam permanen di JS manapun
// selain default ini, supaya app bisa dipakai ulang organisasi lain (RT/RW
// lain, karang taruna dusun sebelah, bahkan non-RT) cukup lewat Pengaturan.
const DEFAULT_ORG_PROFILE = {
  nama: 'Karang Taruna Inti',
  namaKas: 'Kas Karang Taruna',
  logo: '' // kosong = pakai file statis icons/logo-kop.png (lihat getOrgLogo())
};

// Kategori notifikasi Telegram & default Jam Tenang — didefinisikan DI SINI
// (bukan di js/04-event-settings.js tempat logika notifikasi Telegram lainnya
// berada) karena defaultDB() di bawah dipanggil LANGSUNG saat script ini
// pertama kali dieksekusi (lihat `let db = defaultDB();` di akhir file),
// sebelum js/04-event-settings.js sempat dimuat — jadi kalau didefinisikan
// di sana akan kena ReferenceError "not defined". key HARUS sama persis
// dengan argumen `category` yang dikirim tiap pemanggil notifyTelegram()
// di seluruh app (lihat js/06, 08, 09, 10, 11, 12, 15, 22).
const TELEGRAM_CATEGORIES = [
  {key:'anggota',     label:'Anggota & Iuran',                icon:'👥'},
  {key:'donasi',      label:'Donasi',                          icon:'🎁'},
  {key:'transaksi',   label:'Transaksi Kas Utama',             icon:'💵'},
  {key:'operasional', label:'Biaya Operasional',               icon:'🧾'},
  {key:'lomba',       label:'Lomba',                           icon:'🏆'},
  {key:'belanja',     label:'Belanja Hadiah & Perlengkapan',   icon:'🛒'},
  {key:'agenda',      label:'Jadwal & Agenda',                 icon:'📅'},
  {key:'kas',         label:'Kas Karang Taruna',               icon:'🏦'},
  {key:'dana_sosial', label:'Dana Sosial',                     icon:'🤝'},
  {key:'login',       label:'Login User',                      icon:'🔑'},
  {key:'sistem',      label:'Sistem & Event',                  icon:'⚙️'},
  {key:'umum',        label:'Umum / Lainnya',                  icon:'📋'},
];
function defaultTelegramCategories(){
  const o = {};
  TELEGRAM_CATEGORIES.forEach(c => { o[c.key] = true; });
  return o;
}
function defaultTelegramQuietHours(){
  return { enabled:false, start:'22:00', end:'06:00' };
}

function defaultDB(){
  return {
    events: [],
    activeEventId: null,
    settings: {},
    anggota: [],
    donatur: [],
    transaksiLain: [],
    operasional: [],
    lomba: [],
    lombaKebutuhan: [],
    // Arsip Lomba — snapshot lomba+perlengkapan yang dibuat OTOMATIS saat
    // sebuah lomba dihapus lewat menu Lomba & Perlengkapan (lihat hapusLomba()
    // di js/10-lomba.js). Tujuannya supaya Database Lomba (js/10b-database-lomba.js)
    // tetap punya riwayat lomba tsb SELAMANYA walau data aslinya di kt_lomba/
    // kt_lomba_kebutuhan sudah dihapus. Baris di sini TIDAK terikat foreign key
    // ke kt_lomba/kt_events manapun (semua datanya "beku"/snapshot, termasuk
    // nama event & tahun saat itu) — supaya tetap aman disimpan walau lomba
    // atau bahkan event-nya sudah tidak ada lagi. Lihat supabase-lomba-arsip-migration.sql.
    lombaArsip: [],
    hadiahKategori: [],
    lombaHadiah: [],
    daftarBelanjaHadiah: [],
    daftarBelanjaPerlengkapan: [],
    hadiahJalanSantai: [],
    daftarBelanjaJalanSantai: [],
    jadwal: [],
    // Agenda Kegiatan — TIDAK terikat event sama sekali (beda dari
    // `jadwal` yang per event_id). Untuk agenda umum organisasi yang
    // tetap mau muncul sebagai reminder di Buku Kegiatan walau belum
    // ada event 17-an yang aktif/dibuat. Disimpan di tabel kt_agenda
    // (tanpa kolom event_id) — lihat supabase-agenda-migration.sql.
    agenda: [],
    // Kas Karang Taruna — buku kas umum organisasi, TIDAK terikat event
    // (sama seperti Agenda/Gudang/Dokumen). Setiap baris punya debit/kredit,
    // saldo dihitung berjalan (running balance) saat render, tidak disimpan
    // di DB. Disimpan di tabel kt_kas (lihat supabase-kas-migration.sql).
    kas: [],
    // Dana Sosial — iuran bulanan Rp 5.000/anggota, TIDAK terikat event
    // manapun (sama seperti Kas/Agenda). Daftar anggota MASTER terpisah
    // total dari kt_anggota (iuran per-event) — lihat js/22-dana-sosial.js
    // dan supabase-dana-sosial-migration.sql.
    danaSosialAnggota: [],
    danaSosialBayar: [],
    // Tautan Penting — kumpulan link penting organisasi (grup WA, form,
    // rekening, dsb), TIDAK terikat event sama sekali (sama seperti
    // Agenda/Kas/Gudang). Disimpan di tabel kt_bookmark, lihat
    // supabase-bookmark-migration.sql.
    bookmark: [],
    users: [...DEFAULT_USERS_FALLBACK],
    telegram: {
      botToken: '',
      chatId: '',
      enabled: false,
      // Kontrol on/off per kategori & jam tenang — lihat TELEGRAM_CATEGORIES
      // dan defaultTelegramQuietHours() di js/04-event-settings.js.
      categories: defaultTelegramCategories(),
      quietHours: defaultTelegramQuietHours()
    },
    // Menu yang TIDAK boleh dilihat guest (belum login). Section yang tidak
    // disebut di sini otomatis dianggap boleh dilihat guest (default true).
    // Diatur admin lewat halaman Pengaturan > Akses Guest.
    guestMenu: {
      'database-anggota': false,
      'jadwal': false
    },
    // Draft Surat & Dokumen (Undangan, Proposal, Absensi) — TIDAK terikat
    // event, sama seperti Gudang. Disimpan satu set global di tabel
    // kt_dokumen_global (lihat supabase-dokumen-global-migration.sql),
    // bukan lagi per event_id di kt_settings.dokumen.
    dokumenGlobal: { undangan:{}, proposal:{}, absensi:{} },
    // Profil Organisasi (nama, logo, nama buku kas) — satu baris global, sama
    // seperti telegram/guestMenu (id='main'). Lihat DEFAULT_ORG_PROFILE & getOrgProfil().
    orgProfile: { ...DEFAULT_ORG_PROFILE }
  };
}

/* ============================================================
   SUPABASE SYNC LAYER
   Setiap array di objek `db` dipetakan ke satu tabel Supabase.
   Semua fungsi render/CRUD lain tetap memanipulasi `db.xxx`
   di memori seperti sebelumnya lalu memanggil saveDB() —
   tidak ada perubahan pada logika CRUD yang sudah ada.
   ============================================================ */
const ARRAY_TABLE_MAP = {
  events: 'kt_events',
  anggota: 'kt_anggota',
  donatur: 'kt_donatur',
  transaksiLain: 'kt_transaksi_lain',
  operasional: 'kt_operasional',
  lomba: 'kt_lomba',
  lombaKebutuhan: 'kt_lomba_kebutuhan',
  lombaArsip: 'kt_lomba_arsip',
  hadiahKategori: 'kt_hadiah_kategori',
  lombaHadiah: 'kt_lomba_hadiah',
  daftarBelanjaHadiah: 'kt_daftar_belanja_hadiah',
  daftarBelanjaPerlengkapan: 'kt_daftar_belanja_perlengkapan',
  hadiahJalanSantai: 'kt_hadiah_jalan_santai',
  daftarBelanjaJalanSantai: 'kt_daftar_belanja_jalan_santai',
  jadwal: 'kt_jadwal',
  agenda: 'kt_agenda',
  kas: 'kt_kas',
  danaSosialAnggota: 'kt_dana_sosial_anggota',
  danaSosialBayar: 'kt_dana_sosial_bayar',
  bookmark: 'kt_bookmark',
};

// Migrasi satu-kali: dulu status "dibeli" di daftarBelanjaHadiah dilacak pakai
// `item_index` (posisi item dalam array `items` milik satu paket hadiah). Itu rapuh
// karena kalau item dihapus/direorder, index bergeser dan status "dibeli" nyasar ke
// item lain. Sekarang tiap item hadiah punya `id` sendiri (lihat tambahItemHadiah,
// openHadiahModal, addItemRow). Fungsi ini menjalankan migrasi SEKALI saat load:
// untuk tiap item lama yang belum punya `id`, generate id baru, lalu cocokkan ke
// record daftarBelanjaHadiah yang match hadiah_kategori_id+item_index PADA SAAT INI
// (sebelum ada hapus/reorder lagi) dan tempelkan `item_id` itu ke record tsb supaya
// status "dibeli" yang sudah ada tidak hilang/salah sasaran. Item yang sudah punya
// id (dibuat setelah fitur ini ada) dilewati.
function migrasiItemIdHadiah(result){
  let changed = false;
  (result.hadiahKategori||[]).forEach(h=>{
    (h.items||[]).forEach((item, idx)=>{
      if(item.id) return;
      item.id = uid();
      changed = true;
      (result.daftarBelanjaHadiah||[]).forEach(b=>{
        if(b.hadiah_kategori_id===h.id && b.item_index===idx && !b.item_id){
          b.item_id = item.id;
        }
      });
    });
  });
  return changed;
}

// Migrasi satu-kali: sebelum ada fix di hapusLomba/hapusKebutuhan (10-lomba.js),
// menghapus item kebutuhan lomba (atau seluruh lomba) TIDAK ikut menghapus baris
// status belanja perlengkapan (kt_daftar_belanja_perlengkapan) yang mereferensikannya
// lewat kebutuhan_id — jadi baris itu jadi sampah/orphan yang tetap tersinkron
// selamanya. Fungsi ini membersihkan baris yang kebutuhan_id-nya sudah tidak ada
// lagi di lombaKebutuhan manapun (lintas semua event, bukan cuma event aktif, biar
// tuntas sekali jalan).
function bersihkanOrphanBelanjaPerlengkapan(result){
  const kebutuhanIds = new Set((result.lombaKebutuhan||[]).map(k=>k.id));
  const before = (result.daftarBelanjaPerlengkapan||[]).length;
  result.daftarBelanjaPerlengkapan = (result.daftarBelanjaPerlengkapan||[]).filter(b=>kebutuhanIds.has(b.kebutuhan_id));
  return result.daftarBelanjaPerlengkapan.length !== before;
}

// Sama seperti di atas, tapi untuk kt_daftar_belanja_hadiah — sebelum ada fix di
// hapusHadiah/hapusHadiahItem, menghapus paket/item hadiah tidak ikut menghapus
// baris status belanjanya (dicocokkan lewat hadiah_kategori_id + item_id).
function bersihkanOrphanBelanjaHadiah(result){
  const validPairs = new Set();
  (result.hadiahKategori||[]).forEach(h=>(h.items||[]).forEach(it=>validPairs.add(`${h.id}_${it.id}`)));
  const before = (result.daftarBelanjaHadiah||[]).length;
  result.daftarBelanjaHadiah = (result.daftarBelanjaHadiah||[]).filter(b=>validPairs.has(`${b.hadiah_kategori_id}_${b.item_id}`));
  return result.daftarBelanjaHadiah.length !== before;
}

// Sama seperti di atas, tapi untuk kt_daftar_belanja_jalan_santai — sebelum ada
// fix di hapusHadiahJalan, menghapus hadiah jalan santai tidak ikut menghapus
// baris status belanjanya (dicocokkan lewat hadiah_jalan_id).
function bersihkanOrphanBelanjaJalanSantai(result){
  const hadiahJalanIds = new Set((result.hadiahJalanSantai||[]).map(h=>h.id));
  const before = (result.daftarBelanjaJalanSantai||[]).length;
  result.daftarBelanjaJalanSantai = (result.daftarBelanjaJalanSantai||[]).filter(b=>hadiahJalanIds.has(b.hadiah_jalan_id));
  return result.daftarBelanjaJalanSantai.length !== before;
}

async function loadDB(){
  const result = defaultDB();
  try{
    const entries = Object.entries(ARRAY_TABLE_MAP);
    // rpc_list_users() di server MEWAJIBKAN session_is_admin() (lihat
    // supabase-session-auth-migration.sql) — kalau dipanggil untuk user
    // biasa/petugas/guest, server menolak dengan error 403 "Unauthorized".
    // db.users sendiri CUMA dipakai di halaman Manajemen User (khusus admin,
    // lihat getUsers() di 02-auth.js & renderUsers() di 06-login-users.js),
    // jadi untuk non-admin RPC ini sengaja dilewati sama sekali supaya tidak
    // ada 403 percuma di console tiap kali app dibuka — halaman Manajemen
    // User sendiri sudah fetch ulang datanya sendiri saat dibuka/diubah.
    const usersCall = isAdmin() ? sb.rpc('rpc_list_users') : Promise.resolve({data:null, error:null});
    const [arrayResults, settingsRes, telegramRes, usersRes, guestMenuRes, dokumenGlobalRes, orgProfileRes] = await Promise.all([
      Promise.all(entries.map(([, table]) => sb.from(table).select('*'))),
      sb.from('kt_settings').select('*'),
      sb.from('kt_telegram_settings').select('*').eq('id', 'main').maybeSingle(),
      usersCall,
      sb.from('kt_guest_menu_settings').select('*').eq('id', 'main').maybeSingle(),
      sb.from('kt_dokumen_global').select('*').eq('id', 'main').maybeSingle(),
      sb.from('kt_organisasi_profil').select('*').eq('id', 'main').maybeSingle(),
    ]);

    const failedTables = [];
    entries.forEach(([key, table], idx) => {
      const res = arrayResults[idx];
      if(res.error){ console.error(`Gagal memuat ${table}:`, res.error); failedTables.push(table); return; }
      result[key] = res.data || [];
      // Catat ID mana saja yang KITA tahu ada di server saat ini. Dipakai nanti oleh
      // syncArrayTable() supaya delete-diff tidak menghapus data yang ditambahkan
      // client lain setelah kita load (lihat penjelasan di syncArrayTable).
      _lastKnownIds[table] = new Set(result[key].map(r => r.id));
      // Catat juga `updated_at` tiap baris SAAT KITA MELIHATNYA. Dipakai syncArrayTable()
      // untuk mendeteksi kalau baris yang sama sudah diubah akun/device lain setelah kita
      // load (lihat penjelasan lengkap di syncArrayTable) — supaya tidak ditimpa diam-diam.
      _lastKnownUpdatedAt[table] = new Map(result[key].map(r => [r.id, r.updated_at || null]));
    });
    if(failedTables.length){
      toast(`⚠️ Gagal memuat data: ${failedTables.join(', ')} — cek koneksi lalu muat ulang halaman`);
    }

    if(usersRes.error){ console.error('Gagal memuat users:', usersRes.error); }
    result.users = (!usersRes.error && usersRes.data && usersRes.data.length) ? usersRes.data : [...DEFAULT_USERS_FALLBACK];

    if(!settingsRes.error){
      (settingsRes.data || []).forEach(s => { result.settings[s.event_id] = { tarif: s.tarif, hadiahBudget: s.hadiah_budget || {}, dokumen: s.dokumen || {}, kategoriToko: s.kategori_toko || {customCategories:[],keywords:{}}, kuponJalanSantai: s.kupon_jalan_santai || {harga:0} }; });
      _lastKnownSettingsIds = new Set((settingsRes.data || []).map(s => s.event_id));
      // Sama seperti _lastKnownUpdatedAt di syncArrayTable — dipakai syncSettings()
      // untuk mendeteksi kalau baris event_id yang sama sudah diubah admin lain
      // sejak kita load (lihat penjelasan lengkap di syncSettings).
      _lastKnownSettingsUpdatedAt = new Map((settingsRes.data || []).map(s => [s.event_id, s.updated_at || null]));
    }

    if(!telegramRes.error){
      if(telegramRes.data){
        result.telegram = {
          // botToken SENGAJA tidak lagi dibaca dari server. Token hidup
          // sebagai secret Cloudflare Worker (src/worker.js) dan tidak pernah
          // dikirim ke browser -- lihat supabase-hardening-migration.sql
          // Bagian 4. Field ini dipertahankan (selalu string kosong) supaya
          // kode lama yang membacanya tidak error.
          botToken: '',
          chatId: telegramRes.data.chat_id || '',
          enabled: !!telegramRes.data.enabled,
          // Digabung dengan default supaya kategori BARU yang ditambahkan di
          // kode belakangan (setelah admin pertama kali simpan pengaturan)
          // otomatis AKTIF, bukan hilang/undefined di data lama.
          categories: { ...defaultTelegramCategories(), ...(telegramRes.data.categories || {}) },
          quietHours: { ...defaultTelegramQuietHours(), ...(telegramRes.data.quiet_hours || {}) },
        };
      }
      // Dicatat terlepas dari ada/tidaknya baris 'main' (null kalau belum ada baris
      // sama sekali) — dipakai syncTelegram() untuk deteksi konflik singleton row.
      _lastKnownTelegramUpdatedAt = telegramRes.data ? (telegramRes.data.updated_at || null) : null;
    }

    if(!guestMenuRes.error){
      if(guestMenuRes.data && guestMenuRes.data.hidden_sections){
        result.guestMenu = {};
        (guestMenuRes.data.hidden_sections || []).forEach(key => { result.guestMenu[key] = false; });
      }
      _lastKnownGuestMenuUpdatedAt = guestMenuRes.data ? (guestMenuRes.data.updated_at || null) : null;
    }

    if(dokumenGlobalRes.error){ console.error('Gagal memuat kt_dokumen_global:', dokumenGlobalRes.error); }
    else{
      if(dokumenGlobalRes.data && dokumenGlobalRes.data.dokumen){
        // PENTING (bug lama — data hilang): sebelumnya cuma undangan/proposal/absensi
        // yang dibaca balik ke `result.dokumenGlobal`, field `jadwal_sinoman` TIDAK
        // ikut disalin. Karena refreshFromServer() (siklus 20 detik) mengganti `db`
        // sepenuhnya dengan hasil loadDB() ini, jadwal_sinoman yang sudah tersimpan
        // di server jadi hilang dari memori tab dalam ≤20 detik, lalu getDokumenGlobal()
        // otomatis mengisinya dengan default KOSONG lagi (lihat 04-event-settings.js).
        // Kalau setelah itu ada saveDB() dari perubahan APAPUN (bukan cuma Jadwal
        // Sinoman), syncDokumenGlobal() ikut mengirim jadwal_sinoman kosong itu dan
        // MENIMPA data asli di server. Sekarang jadwal_sinoman ikut disalin balik
        // seperti field dokumen lainnya. jadwal_petugas (blok kedua, lihat
        // js/14-dokumen.js) ikut diberi perlakuan sama sejak awal dibuat, supaya
        // tidak kena bug yang sama. jadwal_extra (tabel tambahan dinamis, lihat
        // jadwalAddExtraTable() di js/14-dokumen.js) SEMPAT kena bug yang sama persis
        // saat pertama dibuat — lupa dimasukkan ke whitelist ini — makanya tabel
        // tambahan hilang begitu di-refresh atau setelah 20 detik idle. Sudah
        // ditambahkan di bawah supaya field baru serupa di masa depan cukup ditambah
        // di sini, tidak lupa lagi.
        result.dokumenGlobal = {
          undangan: dokumenGlobalRes.data.dokumen.undangan || {},
          proposal: dokumenGlobalRes.data.dokumen.proposal || {},
          absensi: dokumenGlobalRes.data.dokumen.absensi || {},
          jadwal_sinoman: dokumenGlobalRes.data.dokumen.jadwal_sinoman || undefined,
          jadwal_petugas: dokumenGlobalRes.data.dokumen.jadwal_petugas || undefined,
          jadwal_extra: dokumenGlobalRes.data.dokumen.jadwal_extra || undefined,
        };
        if(!result.dokumenGlobal.jadwal_sinoman) delete result.dokumenGlobal.jadwal_sinoman;
        if(!result.dokumenGlobal.jadwal_petugas) delete result.dokumenGlobal.jadwal_petugas;
        if(!result.dokumenGlobal.jadwal_extra) delete result.dokumenGlobal.jadwal_extra;
      }
      _lastKnownDokumenGlobalUpdatedAt = dokumenGlobalRes.data ? (dokumenGlobalRes.data.updated_at || null) : null;
    }

    if(orgProfileRes.error){ console.error('Gagal memuat kt_organisasi_profil:', orgProfileRes.error); }
    else{
      if(orgProfileRes.data){
        result.orgProfile = {
          nama: orgProfileRes.data.nama_organisasi || DEFAULT_ORG_PROFILE.nama,
          namaKas: orgProfileRes.data.nama_kas || DEFAULT_ORG_PROFILE.namaKas,
          logo: orgProfileRes.data.logo || '',
        };
      }
      // Dicatat terlepas dari ada/tidaknya baris 'main' (null kalau belum ada baris
      // sama sekali) — dipakai syncOrgProfile() untuk deteksi konflik singleton row,
      // sama seperti _lastKnownTelegramUpdatedAt dkk.
      _lastKnownOrgProfileUpdatedAt = orgProfileRes.data ? (orgProfileRes.data.updated_at || null) : null;
    }

    result.activeEventId = localStorage.getItem('kt_active_event') || (result.events[0] ? result.events[0].id : null);
  }catch(e){
    console.error('Gagal memuat data dari Supabase', e);
    toast('⚠️ Gagal terhubung ke server. Cek konfigurasi & koneksi internet.');
    // Ditandai supaya PEMANGGIL (initApp, refreshFromServer) tahu ini gagal total,
    // bukan sekadar "organisasi ini memang belum punya data" — soalnya `result`
    // di titik ini masih persis defaultDB() yang kosong melompong. Tanpa penanda
    // ini, auto-refresh yang gagal di tengah jalan (mis. sinyal putus sebentar)
    // bisa menimpa data yang sudah ada di layar dengan tampilan KOSONG.
    result._loadFailed = true;
  }
  const migrasiHadiahBerubah = migrasiItemIdHadiah(result);
  const orphanPerlengkapanDibersihkan = bersihkanOrphanBelanjaPerlengkapan(result);
  const orphanHadiahDibersihkan = bersihkanOrphanBelanjaHadiah(result);
  const orphanJalanDibersihkan = bersihkanOrphanBelanjaJalanSantai(result);
  if(migrasiHadiahBerubah || orphanPerlengkapanDibersihkan || orphanHadiahDibersihkan || orphanJalanDibersihkan){
    // Ada item hadiah lama yang baru saja diberi `id` + record belanja yang baru
    // ditautkan via `item_id`, dan/atau baris belanja (perlengkapan/hadiah/jalan
    // santai) orphan yang baru dibersihkan — simpan sekarang juga supaya migrasi
    // ini benar-benar jalan sekali dan tidak hilang kalau user langsung hapus/reorder
    // item sebelum ada perubahan lain yang memicu saveDB().
    db = result;
    saveDB();
  }
  return result;
}

// PENTING — soal keamanan data multi-device/multi-tab:
// `rows` adalah snapshot `db[key]` di memori tab ini, yang di-load SEKALI saat init.
// Kalau tab/device lain menambah baris baru ke tabel yang sama sesudah itu, baris itu
// akan muncul di `existing` (hasil select di bawah) tapi TIDAK ADA di `rows` milik kita —
// bukan karena kita menghapusnya, tapi karena kita belum pernah tahu baris itu ada.
// Dulu itu dianggap "harus dihapus" (existingIds - currentIds), jadi data yang baru
// ditambahkan device lain bisa ke-delete oleh sync device ini. Untuk mencegah itu,
// kita hanya boleh menghapus ID yang PERNAH kita kenal (ada di _lastKnownIds, artinya
// ID itu ada waktu kita load/sync terakhir) dan sekarang sudah tidak ada lagi di rows
// kita (berarti KITA yang menghapusnya). ID yang muncul di server tapi tidak pernah kita
// kenal sebelumnya dibiarkan saja — itu punya device lain, bukan urusan sync ini.
const _lastKnownIds = {};

// PENTING — soal konflik simpan bersamaan (concurrent edit) di baris yang SAMA:
// `rows` adalah snapshot PENUH tabel ini di memori tab kita, bukan diff per-field.
// Kalau device/akun lain juga sedang mengedit baris yang sama, dan mereka menyimpan
// setelah kita terakhir kali load/sync tapi SEBELUM kita menyimpan sekarang, maka
// upsert kita bisa menimpa perubahan mereka tanpa siapa pun sadar.
// Untuk mendeteksi ini: setiap tabel punya kolom `updated_at` yang di-refresh OTOMATIS
// oleh trigger Postgres (lihat supabase-conflict-detection-migration.sql) setiap kali
// baris di-UPDATE. Kita simpan `updated_at` terakhir yang KITA TAHU untuk tiap ID
// (_lastKnownUpdatedAt, diisi saat load). Sebelum upsert, kita select ulang
// `id, updated_at` dari server: kalau untuk suatu ID nilai itu SUDAH BEDA dari yang
// terakhir kita tahu, berarti ada pihak lain yang mengubahnya sejak kita load —
// baris itu kita LEWATI (tidak ditimpa), bukan langsung dipaksa overwrite.
const _lastKnownUpdatedAt = {};

// Deteksi error "unique_violation" dari Postgres (kode 23505), opsional dicocokkan
// ke nama constraint tertentu lewat isi pesan errornya.
function isUniqueViolation(err, constraintName){
  if(!err || err.code !== '23505') return false;
  return !constraintName || String(err.message||'').includes(constraintName);
}

// Dipanggil HANYA saat upsert kt_hadiah_kategori gagal karena unique_violation
// (lihat supabase-hadiah-kategori-unique-migration.sql) — artinya device/tab LAIN
// sudah lebih dulu membuat paket untuk kombinasi kategori_peserta+juara_ke yang sama
// (race condition 2 device sama-sama "Tambah Paket" untuk kombinasi identik di waktu
// berdekatan, lolos dari pengecekan di client karena masing-masing cuma cek snapshot
// lokalnya sendiri — lihat checkDuplikatPaketHadiah di js/10-lomba.js).
// Cari baris BARU (belum ada di existingMap, artinya ini yang barusan dibuat client
// ini) yang kombinasinya sekarang sudah dipakai baris lain di server (id berbeda),
// supaya bisa dikeluarkan dari batch dan sisanya tetap bisa tersimpan.
async function cariDuplikatKombinasiHadiah(candidateRows, existingMap){
  const newRows = candidateRows.filter(r => !existingMap.has(r.id));
  if(!newRows.length) return [];
  const { data, error } = await sb.from('kt_hadiah_kategori').select('id, event_id, kategori_peserta, juara_ke');
  if(error || !data) return [];
  return newRows.filter(r => data.some(s =>
    s.id !== r.id && s.event_id === r.event_id &&
    s.kategori_peserta === r.kategori_peserta && s.juara_ke === r.juara_ke
  ));
}

async function syncArrayTable(table, rows, key){
  const { data: existing, error: selErr } = await sb.from(table).select('id, updated_at');
  if(selErr){ console.error(`Gagal membaca ${table}:`, selErr); throw new Error(`Gagal membaca ${table}: ${selErr.message}`); }
  const existingMap = new Map((existing || []).map(r => [r.id, r.updated_at]));
  const existingIds = new Set(existingMap.keys());
  const knownIds = _lastKnownIds[table] || new Set();
  const knownUpdatedAt = _lastKnownUpdatedAt[table] || new Map();

  // BUG LAMA (penyebab "data terhapus muncul lagi"): tab ini dimuat sekali di awal dan
  // menyimpan snapshot penuh `rows` (=db[key]) di memori. Kalau device/tab LAIN menghapus
  // salah satu baris itu di server, tab kita tidak pernah tahu — baris itu masih ada di
  // memori kita. Begitu tab ini menyimpan (saveDB) untuk alasan APA PUN, baris itu dikirim
  // ulang oleh upsert di bawah karena kode lama mengira "tidak ada di server = baris baru".
  // Fix: kalau suatu id PERNAH kita kenal (ada di knownIds) tapi sekarang sudah hilang dari
  // server, itu bukan baris baru — itu baris "hantu" sisa sebelum kita reload, dan harus
  // dibuang dari memori kita, BUKAN dikirim ulang ke server.
  const ghostIds = new Set(rows.filter(r => knownIds.has(r.id) && !existingMap.has(r.id)).map(r => r.id));
  const ghostRows = ghostIds.size ? rows.filter(r => ghostIds.has(r.id)) : [];
  if(ghostIds.size){
    for(let i = rows.length - 1; i >= 0; i--){
      if(ghostIds.has(rows[i].id)) rows.splice(i, 1);
    }
  }

  const currentIds = new Set(rows.map(r => r.id));
  const toDelete = [...existingIds].filter(id => knownIds.has(id) && !currentIds.has(id));

  // Pisahkan baris yang aman disimpan vs yang konflik (sudah diubah pihak lain
  // sejak kita load, dan berbeda dari versi server saat ini).
  const conflicts = [];
  const rowsToUpsert = rows.filter(r => {
    if(!existingMap.has(r.id)) return true; // baris baru, pasti aman
    const serverUpdatedAt = existingMap.get(r.id);
    const lastKnown = knownUpdatedAt.get(r.id);
    if(lastKnown && serverUpdatedAt && lastKnown !== serverUpdatedAt){
      conflicts.push({ key, table, id: r.id, label: r.keterangan || r.judul || r.nama || r.namaLengkap || r.id });
      return false;
    }
    return true;
  // `updated_at` selalu dibuang sebelum dikirim: kolom ini server-managed (diisi
  // trigger/default now(), lihat supabase-conflict-detection-migration.sql), TIDAK
  // PERNAH perlu dikirim dari JS. Kalau dibiarkan, baris yang di-load dari server
  // (punya updated_at) tercampur dengan baris baru yang belum punya field itu
  // (mis. event baru dari buatEvent) dalam satu batch upsert — PostgREST menolak
  // request itu dengan 400 karena bentuk kolom antar baris tidak seragam.
  }).map(({updated_at, ...rest}) => rest);

  let savedRows = [];
  if(rowsToUpsert.length){
    let { data: upData, error: upErr } = await sb.from(table).upsert(rowsToUpsert, { onConflict: 'id' }).select('id, updated_at');
    if(upErr && key === 'hadiahKategori' && isUniqueViolation(upErr, 'kt_hadiah_kategori_kombinasi_unique')){
      const dup = await cariDuplikatKombinasiHadiah(rowsToUpsert, existingMap);
      if(dup.length){
        dup.forEach(d => {
          conflicts.push({ key, table, id: d.id, duplicate: true, label: `${labelPeserta(d.kategori_peserta)} - ${labelJuara(d.juara_ke)}` });
          // Buang dari memori (rows === db.hadiahKategori) supaya tidak terus-menerus
          // dicoba disimpan ulang tiap saveDB() berikutnya — paket ini sudah kalah race,
          // versi yang menang sudah ada di server dan akan muncul setelah reload.
          const idx = rows.findIndex(r => r.id === d.id);
          if(idx !== -1) rows.splice(idx, 1);
        });
        const dupIds = new Set(dup.map(d => d.id));
        const remaining = rowsToUpsert.filter(r => !dupIds.has(r.id));
        ({ data: upData, error: upErr } = remaining.length
          ? await sb.from(table).upsert(remaining, { onConflict: 'id' }).select('id, updated_at')
          : { data: [], error: null });
      }
    }
    if(upErr){ console.error(`Gagal menyimpan ${table}:`, upErr); throw new Error(`Gagal menyimpan ${table}: ${upErr.message}`); }
    savedRows = upData || [];
  }
  if(toDelete.length){
    const { error: delErr } = await sb.from(table).delete().in('id', toDelete);
    if(delErr){ console.error(`Gagal menghapus data lama ${table}:`, delErr); throw new Error(`Gagal menghapus ${table}: ${delErr.message}`); }
  }

  // Update memori "ID yang kita kenal": gabungan ID milik kita sendiri (currentIds)
  // dan ID milik device lain yang masih hidup di server dan tidak kita sentuh.
  const survivedRemote = [...existingIds].filter(id => !toDelete.includes(id));
  _lastKnownIds[table] = new Set([...survivedRemote, ...currentIds]);

  // Update memori `updated_at`: pakai nilai terbaru dari server untuk baris yang barusan
  // kita simpan (savedRows), dan untuk baris yang tidak kita sentuh tapi masih hidup di
  // server (termasuk baris konflik — kita catat versi server TERBARU supaya tidak terus
  // dianggap konflik kalau user cuma reload tanpa mengedit lagi).
  const newMap = new Map();
  existingMap.forEach((updatedAt, id) => newMap.set(id, updatedAt));
  savedRows.forEach(r => newMap.set(r.id, r.updated_at));
  _lastKnownUpdatedAt[table] = newMap;

  if(ghostRows.length){
    conflicts.push({ ghost: true, key, table, count: ghostRows.length, labels: ghostRows.map(r => r.keterangan || r.judul || r.nama || r.namaLengkap || r.id) });
  }
  return conflicts;
}

// Sama seperti _lastKnownIds di syncArrayTable — mencegah setting event milik device
// lain (yang belum sempat kita lihat) ikut terhapus saat kita sync.
let _lastKnownSettingsIds = new Set();
// Sama seperti _lastKnownUpdatedAt di syncArrayTable, tapi per event_id — dipakai
// syncSettings() untuk mendeteksi baris kt_settings yang sudah diubah admin lain
// sejak kita load, supaya tidak ditimpa diam-diam (lihat penjelasan lengkap di
// syncArrayTable, pola persis sama, cuma keyed by event_id bukan id).
let _lastKnownSettingsUpdatedAt = new Map();

async function syncSettings(){
  const rows = Object.keys(db.settings).map(eventId => ({ event_id: eventId, tarif: db.settings[eventId].tarif, hadiah_budget: db.settings[eventId].hadiahBudget || {}, dokumen: db.settings[eventId].dokumen || {}, kategori_toko: db.settings[eventId].kategoriToko || {customCategories:[],keywords:{}}, kupon_jalan_santai: db.settings[eventId].kuponJalanSantai || {harga:0} }));
  const { data: existing, error: selErr } = await sb.from('kt_settings').select('event_id, updated_at');
  if(selErr){ console.error('Gagal membaca kt_settings:', selErr); throw new Error(`Gagal membaca kt_settings: ${selErr.message}`); }
  const existingMap = new Map((existing || []).map(r => [r.event_id, r.updated_at]));
  const existingIds = new Set(existingMap.keys());
  const currentIds = new Set(Object.keys(db.settings));
  const toDelete = [...existingIds].filter(id => _lastKnownSettingsIds.has(id) && !currentIds.has(id));

  // Sama seperti syncArrayTable: pisahkan baris yang aman disimpan vs yang sudah
  // diubah admin lain sejak kita load (dibandingkan lewat updated_at) — baris
  // konflik DILEWATI, bukan ditimpa paksa.
  const conflicts = [];
  const rowsToUpsert = rows.filter(r => {
    if(!existingMap.has(r.event_id)) return true; // event baru, pasti aman
    const serverUpdatedAt = existingMap.get(r.event_id);
    const lastKnown = _lastKnownSettingsUpdatedAt.get(r.event_id);
    if(lastKnown && serverUpdatedAt && lastKnown !== serverUpdatedAt){
      const ev = db.events.find(e => e.id === r.event_id);
      conflicts.push({ key:'settings', table:'kt_settings', id:r.event_id, label: ev?.nama || r.event_id });
      return false;
    }
    return true;
  });

  let savedRows = [];
  if(rowsToUpsert.length){
    const { data: upData, error } = await sb.from('kt_settings').upsert(rowsToUpsert, { onConflict: 'event_id' }).select('event_id, updated_at');
    if(error){ console.error('Gagal menyimpan kt_settings:', error); throw new Error(`Gagal menyimpan kt_settings: ${error.message}`); }
    savedRows = upData || [];
  }
  if(toDelete.length){
    const { error: delErr } = await sb.from('kt_settings').delete().in('event_id', toDelete);
    if(delErr){ console.error('Gagal menghapus kt_settings lama:', delErr); throw new Error(`Gagal menghapus kt_settings: ${delErr.message}`); }
  }

  const survivedRemote = [...existingIds].filter(id => !toDelete.includes(id));
  _lastKnownSettingsIds = new Set([...survivedRemote, ...currentIds]);

  const newMap = new Map();
  existingMap.forEach((updatedAt, id) => newMap.set(id, updatedAt));
  savedRows.forEach(r => newMap.set(r.event_id, r.updated_at));
  _lastKnownSettingsUpdatedAt = newMap;

  return conflicts;
}

// Ke-3 fungsi di bawah ini (Telegram/Guest Menu/Surat & Dokumen) menyimpan ke tabel
// singleton (1 baris, id='main'). Polanya sama seperti syncArrayTable/syncSettings:
// sebelum upsert, baca dulu updated_at TERKINI di server dan bandingkan dengan yang
// terakhir kita tahu (diisi loadDB()). Kalau beda, berarti admin lain sudah menyimpan
// perubahan sejak kita load terakhir — kita LEWATI upsert (bukan ditimpa paksa) dan
// laporkan sebagai konflik, supaya user tahu harus muat ulang untuk lihat versi
// terbaru sebelum menyimpan ulang.
async function _syncSingletonRow(table, label, payload, lastKnownUpdatedAt, setLastKnownUpdatedAt){
  const { data: existing, error: selErr } = await sb.from(table).select('id, updated_at').eq('id', 'main').maybeSingle();
  if(selErr){ console.error(`Gagal membaca ${table}:`, selErr); throw new Error(`Gagal membaca ${table}: ${selErr.message}`); }
  const serverUpdatedAt = existing ? existing.updated_at : null;
  if(existing && lastKnownUpdatedAt && serverUpdatedAt && lastKnownUpdatedAt !== serverUpdatedAt){
    // Ada baris & sudah berubah sejak kita load — jangan ditimpa, laporkan konflik.
    return { conflict: { key: table, table, id: 'main', label } };
  }
  const { data: upData, error } = await sb.from(table).upsert(payload, { onConflict: 'id' }).select('updated_at').maybeSingle();
  if(error){ console.error(`Gagal menyimpan ${table}:`, error); throw new Error(`Gagal menyimpan ${label}: ${error.message}`); }
  setLastKnownUpdatedAt(upData ? upData.updated_at : null);
  return { conflict: null };
}

let _lastKnownTelegramUpdatedAt = null;
async function syncTelegram(){
  const r = await _syncSingletonRow('kt_telegram_settings', 'Pengaturan Telegram', {
    id: 'main',
    // bot_token tidak pernah ditulis dari klien lagi (klien memang sudah tidak
    // memilikinya). Kolomnya dibiarkan apa adanya di server.
    chat_id: db.telegram.chatId,
    enabled: db.telegram.enabled,
    categories: db.telegram.categories || defaultTelegramCategories(),
    quiet_hours: db.telegram.quietHours || defaultTelegramQuietHours(),
  }, _lastKnownTelegramUpdatedAt, v => { _lastKnownTelegramUpdatedAt = v; });
  return r.conflict ? [r.conflict] : [];
}

let _lastKnownGuestMenuUpdatedAt = null;
async function syncGuestMenu(){
  const hiddenSections = Object.keys(db.guestMenu || {}).filter(k => db.guestMenu[k] === false);
  const r = await _syncSingletonRow('kt_guest_menu_settings', 'Akses Guest', {
    id: 'main',
    hidden_sections: hiddenSections,
  }, _lastKnownGuestMenuUpdatedAt, v => { _lastKnownGuestMenuUpdatedAt = v; });
  return r.conflict ? [r.conflict] : [];
}

// Surat & Dokumen — satu set draft global, tidak terikat event_id (lihat
// catatan di defaultDB()). Disimpan di tabel kt_dokumen_global (1 baris, id='main').
let _lastKnownDokumenGlobalUpdatedAt = null;
async function syncDokumenGlobal(){
  const r = await _syncSingletonRow('kt_dokumen_global', 'Surat & Dokumen', {
    id: 'main',
    dokumen: db.dokumenGlobal || { undangan:{}, proposal:{}, absensi:{}, jadwal_sinoman:{}, jadwal_petugas:{} },
  }, _lastKnownDokumenGlobalUpdatedAt, v => { _lastKnownDokumenGlobalUpdatedAt = v; });
  return r.conflict ? [r.conflict] : [];
}

// Profil Organisasi (nama, logo, nama buku kas) — satu baris global, sama
// seperti kt_telegram_settings/kt_guest_menu_settings/kt_dokumen_global (id='main').
let _lastKnownOrgProfileUpdatedAt = null;
async function syncOrgProfile(){
  const r = await _syncSingletonRow('kt_organisasi_profil', 'Profil Organisasi', {
    id: 'main',
    nama_organisasi: (db.orgProfile && db.orgProfile.nama) || DEFAULT_ORG_PROFILE.nama,
    nama_kas: (db.orgProfile && db.orgProfile.namaKas) || DEFAULT_ORG_PROFILE.namaKas,
    logo: (db.orgProfile && db.orgProfile.logo) || '',
  }, _lastKnownOrgProfileUpdatedAt, v => { _lastKnownOrgProfileUpdatedAt = v; });
  return r.conflict ? [r.conflict] : [];
}

// saveDB() dipanggil di puluhan tempat setiap ada perubahan kecil. Sebelumnya setiap panggilan
// langsung melakukan sync PENUH (select+upsert+delete-diff) ke 15+ tabel sekaligus, dan bisa
// berjalan paralel tanpa lock kalau dipanggil beruntun cepat (race condition antar sync).
// Sekarang di-debounce (nunggu 400ms jeda aktivitas) dan diberi lock supaya hanya 1 proses
// sync yang jalan pada satu waktu; kalau ada request baru saat masih sync, ditandai untuk
// dijalankan ulang setelah yang sedang berjalan selesai.
let _saveDBTimer = null;
let _saveDBRunning = false;
let _saveDBQueued = false;

// Dipakai oleh refreshFromServer() (lihat bagian AUTO-REFRESH di bawah) supaya
// auto-refresh tidak pernah menimpa perubahan lokal yang belum sempat terkirim
// ke server. Selama ada perubahan yang masih menunggu disimpan (true), auto-refresh
// akan melewati siklusnya dan coba lagi nanti.
let _hasPendingLocalChange = false;

function saveDB(){
  if(db.activeEventId) localStorage.setItem('kt_active_event', db.activeEventId);
  _hasPendingLocalChange = true;
  clearTimeout(_saveDBTimer);
  _saveDBTimer = setTimeout(_flushSaveDB, 400);
}

async function _flushSaveDB(){
  if(_saveDBRunning){ _saveDBQueued = true; return; }
  _saveDBRunning = true;
  // Snapshot yang akan dikirim sudah "dipegang" di bawah ini, jadi tandai tidak ada
  // lagi perubahan lokal yang menunggu — kalau ada saveDB() baru dipanggil SELAMA
  // proses simpan ini berjalan (user masih mengedit), flag akan otomatis jadi true
  // lagi lewat panggilan saveDB() tersebut.
  _hasPendingLocalChange = false;
  
  try{
    const arrayEntries = Object.entries(ARRAY_TABLE_MAP);
    // 'events' WAJIB disimpan & ditunggu selesai LEBIH DULU, terpisah dari
    // Promise.all di bawah. Alasan: kt_settings, kt_anggota, dan hampir semua
    // tabel lain punya foreign key ke kt_events(id). Kalau event yang BARU dibuat
    // disinkron bersamaan (paralel) dengan baris-baris yang mereferensikannya,
    // ada race condition: request child bisa sampai & dieksekusi server SEBELUM
    // request kt_events selesai committed, sehingga foreign key constraint gagal
    // (error 409 "violates foreign key constraint kt_settings_event_id_fkey" dkk).
    const eventsTable = ARRAY_TABLE_MAP.events;
    const eventsConflicts = await syncArrayTable(eventsTable, db.events, 'events');

    // Sama seperti alasan 'events' di atas: beberapa tabel lain SALING punya foreign
    // key satu sama lain (bukan cuma ke kt_events), jadi tidak semuanya aman disinkron
    // bersamaan dalam satu Promise.all. Rantai dependensinya:
    //   lomba ──> lombaKebutuhan ──> daftarBelanjaPerlengkapan
    //   lomba, hadiahKategori ──> lombaHadiah
    //   hadiahKategori ──> daftarBelanjaHadiah
    //   hadiahJalanSantai ──> daftarBelanjaJalanSantai
    // Kalau baris BARU di tabel induk (mis. lombaKebutuhan) disinkron paralel dengan
    // baris BARU di tabel anak yang mereferensikannya (daftarBelanjaPerlengkapan),
    // request anak bisa sampai & dieksekusi server SEBELUM request induk selesai
    // committed → error 409 "violates foreign key constraint ..._fkey". Makanya
    // tabel-tabel ini disinkron bertahap per "level" (menunggu level sebelumnya
    // selesai), bukan semua sekaligus. Di dalam satu level tetap paralel karena
    // tidak saling bergantung.
    const LEVEL_1_KEYS = ['anggota','donatur','transaksiLain','operasional','lomba','hadiahKategori','hadiahJalanSantai','jadwal','agenda','kas','danaSosialAnggota'];
    const LEVEL_2_KEYS = ['lombaKebutuhan','lombaHadiah','daftarBelanjaHadiah','daftarBelanjaJalanSantai','danaSosialBayar'];
    const LEVEL_3_KEYS = ['daftarBelanjaPerlengkapan'];
    const otherEntries = arrayEntries.filter(([key]) => key !== 'events');
    const byKey = key => otherEntries.find(([k]) => k === key);
    const level1Entries = LEVEL_1_KEYS.map(byKey).filter(Boolean);
    const level2Entries = LEVEL_2_KEYS.map(byKey).filter(Boolean);
    const level3Entries = LEVEL_3_KEYS.map(byKey).filter(Boolean);
    // Jaga-jaga kalau ada key baru di ARRAY_TABLE_MAP yang belum dimasukkan ke daftar
    // level manapun di atas — tetap disinkron di level 1 (paralel dengan yang lain)
    // supaya tidak diam-diam terlewat.
    const categorizedKeys = new Set([...LEVEL_1_KEYS, ...LEVEL_2_KEYS, ...LEVEL_3_KEYS]);
    const uncategorizedEntries = otherEntries.filter(([key]) => !categorizedKeys.has(key));

    const level1Results = await Promise.all([
      ...level1Entries.map(([key, table]) => syncArrayTable(table, db[key], key)),
      ...uncategorizedEntries.map(([key, table]) => syncArrayTable(table, db[key], key)),
      syncSettings(),
      syncTelegram(),
      syncGuestMenu(),
      syncDokumenGlobal(),
      syncOrgProfile(),
    ]);
    const level2Results = await Promise.all(level2Entries.map(([key, table]) => syncArrayTable(table, db[key], key)));
    const level3Results = await Promise.all(level3Entries.map(([key, table]) => syncArrayTable(table, db[key], key)));

    // Hasil konflik dari 'events' (disimpan terpisah di atas) digabung dengan hasil
    // dari semua level lainnya. syncSettings/syncTelegram/syncGuestMenu/syncDokumenGlobal/
    // syncOrgProfile sekarang juga mengembalikan daftar konflik (array kosong kalau tidak ada) seperti
    // syncArrayTable, jadi seluruh isi level1Results (termasuk 4 fungsi settings di akhir
    // array Promise.all di atas) ikut dipakai langsung tanpa perlu di-slice lagi.
    const arrayConflictResults = [
      ...level1Results,
      ...level2Results,
      ...level3Results,
    ];
    const allResults = [eventsConflicts, ...arrayConflictResults].flat().filter(Boolean);
    const ghosts = allResults.filter(c => c.ghost);
    const duplicates = allResults.filter(c => !c.ghost && c.duplicate);
    const conflicts = allResults.filter(c => !c.ghost && !c.duplicate);
    if(conflicts.length){
      const contoh = conflicts.slice(0, 2).map(c => `"${c.label}"`).join(', ');
      toast(`⚠️ ${conflicts.length} perubahan (${contoh}${conflicts.length>2?', ...':''}) TIDAK disimpan karena sudah diubah pengguna lain. Muat ulang halaman untuk lihat versi terbaru.`, 7000);
    }
    if(duplicates.length){
      // Race condition "Tambah Paket" (lihat cariDuplikatKombinasiHadiah): paket yang
      // barusan dibuat di perangkat INI kalah duluan dari perangkat lain untuk
      // kombinasi kategori+juara yang sama. Bukan error database mentah — item yang
      // sempat diisi di paket ini memang tidak ikut tersimpan, jadi user perlu tahu
      // jelas supaya tidak mengira datanya hilang begitu saja.
      const contoh = duplicates.slice(0, 2).map(c => `"${c.label}"`).join(', ');
      toast(`⚠️ Paket hadiah ${contoh}${duplicates.length>2?', ...':''} baru saja dibuat perangkat lain untuk kombinasi yang sama — punya Anda tidak tersimpan. Muat ulang halaman, lalu tambahkan item lewat paket yang sudah ada.`, 8000);
    }
    if(ghosts.length){
      // Baris yang sudah dihapus di device/tab lain, dan barusan kita buang dari memori
      // tab ini juga (lihat catatan "BUG LAMA" di syncArrayTable) — bukan error, cuma info.
      const totalGhost = ghosts.reduce((s,g) => s + g.count, 0);
      const contoh = ghosts.flatMap(g => g.labels).slice(0, 2).map(l => `"${l}"`).join(', ');
      toast(`ℹ️ ${totalGhost} data (${contoh}${totalGhost>2?', ...':''}) sudah dihapus di perangkat lain, tampilan disegarkan.`, 6000);
      renderContent(); renderTopbarSaldo();
    }
  }catch(e){
    console.error('Gagal menyimpan ke Supabase', e);
    toast(`⚠️ ${e.message || 'Gagal menyimpan ke server'} — coba simpan ulang`);
  }finally{
    _saveDBRunning = false;
    if(_saveDBQueued){
      _saveDBQueued = false;
      _flushSaveDB();
    }
  }
}

// Best-effort: kalau tab ditutup saat masih ada perubahan yang belum sempat ke-sync
// (masih dalam jeda debounce), coba paksa flush segera.
window.addEventListener('beforeunload', ()=>{
  if(_saveDBTimer){ clearTimeout(_saveDBTimer); _flushSaveDB(); }
});

let db = defaultDB();

const KATEGORI_ANGGOTA = [
  {v:'sekolah', l:'Sekolah'},
  {v:'bekerja', l:'Bekerja'},
  {v:'perantauan', l:'Perantauan'},
  {v:'khusus', l:'Khusus'},
];
const RT_LIST = [
  {v:'rt1', l:'RT 1'},
  {v:'rt2', l:'RT 2'},
  {v:'rt3', l:'RT 3'},
];
const GENDER_LIST = [
  {v:'pria', l:'Laki-Laki'},
  {v:'wanita', l:'Perempuan'},
  {v:'tidak_diketahui', l:'Tidak diketahui'},
];
const KATEGORI_PESERTA = [
  {v:'anak', l:'Anak'},
  {v:'remaja', l:'Remaja'},
  {v:'ibu', l:'Ibu'},
  {v:'bapak-ibu', l:'Bapak-Ibu'},
  {v:'bapak-bapak', l:'Bapak-Bapak'},
  {v:'umum', l:'Umum'},
];
const JUARA_LIST = [
  {v:'1', l:'Juara 1'},
  {v:'2', l:'Juara 2'},
  {v:'3', l:'Juara 3'},
  {v:'partisipasi', l:'Partisipasi'},
];
const KATEGORI_JADWAL = [
  {v:'belanja', l:'🛒 Belanja'},
  {v:'rapat', l:'📋 Rapat'},
  {v:'acara', l:'🎉 Acara'},
  {v:'tenggat', l:'⏰ Tenggat'},
  {v:'lainnya', l:'📌 Lainnya'},
];

function activeEvent(){ return db.events.find(e=>e.id===db.activeEventId) || null; }
