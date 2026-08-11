/* ============================================================
   TUR INTERAKTIF (ONBOARDING WALKTHROUGH)
   ------------------------------------------------------------
   Highlight elemen UI selangkah demi selangkah untuk setiap menu,
   dipicu lewat tombol bulat "🎯" yang mengambang di pojok kanan
   bawah (lihat initTourButton(), dipanggil dari 19-init.js).

   Cara kerja:
   - TOUR_DEFS berisi daftar langkah per section key (lihat SECTIONS
     di 05-navigation.js). Tiap langkah: {sel, title, text}.
     `sel` boleh berisi beberapa kandidat selector dipisah koma —
     dicoba satu-satu, dipakai yang pertama ketemu di DOM.
   - Kalau sebuah langkah menunjuk elemen yang kebetulan tidak ada
     di DOM saat ini (mis. tombol yang cuma muncul kalau sudah
     login, atau data masih kosong), langkah itu otomatis
     dilewati — supaya tur tidak macet nunjuk ke elemen kosong.
   - Section yang belum didaftarkan manual di TOUR_DEFS tetap dapat
     tur generik dari tourStepsFor() (fallback), supaya setiap menu
     tetap kebagian tur walau singkat.
   ============================================================ */

const TOUR_DEFS = {
  dashboard: [
    {sel:'.saldo-chip', title:'Proyeksi Saldo', text:'Chip ini di pojok kanan atas selalu nunjukin proyeksi saldo event yang lagi aktif — sudah termasuk kebutuhan/hadiah yang direncanakan, belum tentu sudah dibelanjakan beneran.'},
    {sel:'.stat-grid-ringkasan, .stat-grid', title:'Rekap Kegiatan', text:'Di sini kelihatan ringkasan pemasukan, pengeluaran, dan saldo event yang aktif secara real-time.'},
    {sel:'[data-action="toggleBukuCard"]', title:'Detail per Kategori', text:'Klik kartu ini buat buka/tutup rincian tiap kategori transaksi (iuran, donatur, operasional, dst).'},
  ],
  jadwal: [
    {sel:'[data-action="openJadwalModal"]', title:'Tambah Jadwal', text:'Klik tombol ini buat nyatet jadwal/pengingat baru — bisa diisi tanggal, jam, dan kategori (belanja, rapat, acara, dll).'},
    {sel:'.panel-head', title:'Daftar Jadwal', text:'Semua jadwal yang sudah dibuat muncul di sini, biasanya diurutkan dari yang paling dekat tanggalnya.'},
  ],
  anggota: [
    {sel:'#search-input-anggota', title:'Cari Anggota', text:'Ketik nama di sini buat nyari anggota tertentu dengan cepat, tanpa perlu scroll manual.'},
    {sel:'[data-action="openAnggotaModal"]', title:'Tambah Anggota', text:'Klik tombol ini buat nambah anggota baru ke daftar iuran event ini.'},
    {sel:'.panel-head', title:'Status Bayar', text:'Baris yang belum lunas biasanya ditandai warna beda, jadi gampang kelihatan siapa yang masih nunggak.'},
  ],
  donatur: [
    {sel:'[data-action="openDonaturModal"]', title:'Tambah Donatur', text:'Catat sumbangan dari donatur lewat tombol ini — bisa uang atau barang, di luar iuran anggota biasa.'},
    {sel:'.panel-head', title:'Rekap Donasi', text:'Total donasi yang masuk kelihatan di bagian atas panel ini.'},
  ],
  transaksi: [
    {sel:'[data-action="openTransaksiModal"]', title:'Tambah Pemasukan Lain', text:'Buat pemasukan yang bukan iuran maupun donasi (mis. hasil jualan, sponsor) lewat tombol ini.'},
    {sel:'.panel-head', title:'Daftar Pemasukan', text:'Semua pemasukan lain yang sudah dicatat muncul di daftar ini.'},
  ],
  operasional: [
    {sel:'[data-action="openOperasionalModal"]', title:'Tambah Biaya Operasional', text:'Catat biaya operasional umum acara (konsumsi, sewa, dekorasi, dll) lewat tombol ini.'},
    {sel:'.panel-head', title:'Rekap Operasional', text:'Total biaya operasional yang sudah dicatat kelihatan di bagian atas.'},
  ],
  lomba: [
    {sel:'[data-action="openLombaModal"]', title:'Tambah Lomba', text:'Klik tombol ini buat nambah lomba baru — isi nama, kategori peserta, dan jumlah anggota per regu kalau lomba beregu.'},
    {sel:'.lomba-badge', title:'Status Hadiah', text:'Badge ini nunjukin apakah paket hadiah lomba ini sudah lengkap diatur atau belum — cek warnanya, kuning berarti belum lengkap.'},
    {sel:'[data-action="openKebutuhanModal"]', title:'Kebutuhan Perlengkapan', text:'Tiap lomba bisa dicatat perlengkapan yang dibutuhkan (mis. bendera, peluit) lewat tombol ini.'},
    {sel:'[data-action="toggleKoordinatorCombo"], [data-action="pilihKoordinatorCombo"]', title:'Koordinator Lomba', text:'Pilih anggota dari Database Anggota buat jadi koordinator/penanggung jawab lomba ini — boleh lebih dari satu orang.'},
  ],
  hadiah: [
    {sel:'[data-action="openHadiahBudgetModal"]', title:'Atur Budget', text:'Tentukan dulu budget per paket hadiah untuk tiap kombinasi kategori peserta × juara lewat tombol ini, biar kelihatan kalau belanja kebablasan.'},
    {sel:'[data-action="openHadiahModal"]', title:'Tambah Paket Hadiah', text:'Bikin paket hadiah baru (isi item, harga, qty per paket) untuk kombinasi kategori peserta & juara yang belum ada paketnya.'},
    {sel:'.hadiah-group-header', title:'Kartu Paket Hadiah', text:'Tiap kartu di sini mewakili 1 paket hadiah — sekarang otomatis diurutkan Juara 1 → 2 → 3 → Partisipasi. Klik kartunya buat buka rincian item.'},
    {sel:'[data-action="sesuaikanSemuaKebutuhanHadiah"]', title:'Sesuaikan Otomatis', text:'Kalau ada badge "Kurang" karena qty per paket baru diubah, klik tombol ini biar semua item disamakan otomatis ke kebutuhan terbaru — nggak perlu edit satu-satu.'},
  ],
  'hadiah-jalan': [
    {sel:'[data-action="openHadiahJalanModal"]', title:'Tambah Hadiah Jalan Santai', text:'Susun daftar hadiah jalan santai (mis. hadiah utama, hiburan) lewat tombol ini.'},
    {sel:'.panel-head', title:'Daftar Hadiah', text:'Semua hadiah jalan santai yang sudah diatur muncul di sini.'},
  ],
  'belanja-perlengkapan': [
    {sel:'[data-action="tandaiSemuaBelanjaPerlengkapan"]', title:'Tandai Semua Dibeli', text:'Kalau belanjaan sudah dibeli semua, klik tombol ini biar nggak perlu centang satu-satu.'},
    {sel:'.panel-head', title:'Daftar Belanja Perlengkapan', text:'Ini daftar belanja aktual perlengkapan lomba — dibandingkan sama kebutuhan yang diatur di menu Lomba & Perlengkapan.'},
  ],
  'belanja-hadiah': [
    {sel:'[data-action="bukaModalKelolaKategoriToko"]', title:'Kategori Toko', text:'Atur kategori & kata kunci toko lewat tombol ini, biar pengelompokan belanja hadiah lebih rapi.'},
    {sel:'[data-action="tandaiSemuaBelanjaHadiah"]', title:'Tandai Semua Dibeli', text:'Kalau semua item hadiah di daftar ini sudah dibeli, klik tombol ini buat tandai sekaligus.'},
    {sel:'.panel-head', title:'Daftar Belanja Hadiah', text:'Ini catatan belanja aktual hadiah lomba — dibandingkan sama target di menu Kebutuhan Hadiah.'},
  ],
  'belanja-jalan': [
    {sel:'[data-action="tandaiSemuaBelanjaJalan"]', title:'Tandai Semua Dibeli', text:'Klik tombol ini kalau semua belanja hadiah jalan santai sudah dibeli.'},
    {sel:'.panel-head', title:'Daftar Belanja', text:'Rincian belanja aktual hadiah jalan santai ada di sini.'},
  ],
  lpj: [
    {sel:'[onclick="window.print()"]', title:'Cetak LPJ', text:'Kalau acara sudah selesai dan semua data sudah lengkap, klik tombol ini buat cetak atau simpan sebagai PDF.'},
    {sel:'#lpj-print-area, .lpj-print-area', title:'Isi Laporan', text:'Semua rekap otomatis tersusun di sini — iuran, donatur, lomba, hadiah, sampai saldo akhir — tinggal cetak, nggak perlu rekap manual.'},
  ],
  'daftar-anggota': [
    {sel:'[onclick="window.print()"]', title:'Cetak Daftar', text:'Klik tombol ini buat cetak/download daftar nama anggota, misalnya buat kebutuhan absensi.'},
    {sel:'.panel-head', title:'Rekap Anggota', text:'Ringkasan jumlah anggota per RT, kategori, dan gender ada di bagian ini.'},
  ],
  'database-anggota': [
    {sel:'#search-input', title:'Cari Anggota', text:'Ketik nama di sini buat cari anggota tertentu dari seluruh data master.'},
    {sel:'.panel-head', title:'Filter & Urutkan', text:'Gunakan filter kategori, status, gender, atau RT di panel ini buat mempersempit tampilan data.'},
  ],
  pengaturan: [
    {sel:'[data-action="openEventModal"]', title:'Buat Event Baru', text:'Klik tombol ini buat bikin event/kegiatan tahunan baru, lengkap dengan fitur mana aja yang mau diaktifkan.'},
    {sel:'.panel-head', title:'Tarif & Daftar Event', text:'Atur tarif iuran dan kelola daftar event yang sudah pernah dibuat di halaman ini.'},
  ],
  users: [
    {sel:'[data-action="openUserModal"]', title:'Tambah User', text:'Klik tombol ini buat bikin akun pengguna baru beserta perannya (Admin/User/Petugas).'},
    {sel:'.panel-head', title:'Daftar User', text:'Semua akun yang terdaftar dan perannya masing-masing kelihatan di sini.'},
  ],
  agenda: [
    {sel:'[data-action="openAgendaModal"]', title:'Tambah Agenda', text:'Catat agenda organisasi yang tidak terikat ke satu event tertentu lewat tombol ini.'},
    {sel:'.panel-head', title:'Daftar Agenda', text:'Semua catatan agenda organisasi ada di sini, datanya tetap sama walau event aktif diganti.'},
  ],
  gudang: [
    {sel:'[data-action="openGudangPinjamModal"]', title:'Pinjam Barang', text:'Klik tombol ini buat catat peminjaman aset/barang milik desa atau organisasi.'},
    {sel:'[data-action="openGudangStokModal"]', title:'Tambah/Edit Stok', text:'Kelola daftar barang beserta jumlah stoknya lewat tombol ini.'},
  ],
  dokumen: [
    {sel:'.dokumen-tabs', title:'Pilih Jenis Dokumen', text:'Pindah antar tab Surat Undangan, Proposal Kegiatan, atau Form Absensi lewat tombol-tombol ini.'},
    {sel:'.dokumen-layout, .panel', title:'Isi & Pratinjau', text:'Isi datanya di sisi form, pratinjau dokumen langsung kelihatan di sebelahnya — tinggal cetak kalau sudah pas.'},
  ],
  'jadwal-sinoman': [
    {sel:'[data-action="jadwalAddExtraTable"]', title:'Tambah Tabel', text:'Butuh tabel petugas tambahan selain Sinoman? Klik tombol ini buat nambah tabel baru.'},
    {sel:'.panel, .dokumen-layout', title:'Isi Jadwal Piket', text:'Pilih nama petugas pagi/siang/sore dari Database Anggota, lalu bisa dicetak atau di-download sebagai gambar.'},
  ],
  kas: [
    {sel:'[data-action="openKasModal"]', title:'Tambah Transaksi Kas', text:'Catat pemasukan/pengeluaran buku kas umum organisasi (terpisah dari kas per event) lewat tombol ini.'},
    {sel:'.panel-head', title:'Rekap Kas', text:'Saldo dan riwayat transaksi kas umum organisasi kelihatan di halaman ini.'},
  ],
  'dana-sosial': [
    {sel:'[data-action="openDanaSosialAnggotaModal"]', title:'Tambah Anggota Dana Sosial', text:'Daftarkan anggota ke iuran bulanan Dana Sosial lewat tombol ini.'},
    {sel:'[data-action="openImporDanaSosialModal"]', title:'Impor dari Database', text:'Sudah ada di Database Anggota? Tinggal impor lewat tombol ini, nggak perlu input ulang manual.'},
    {sel:'.panel-head', title:'Rekap & Perantauan', text:'Anggota Perantauan biasanya bayar rapel setahun sekali — cek tabel khususnya di tab Rekap Bulanan.'},
  ],
  bookmark: [
    {sel:'[data-action="openBookmarkModal"]', title:'Tambah Tautan', text:'Simpan link penting organisasi (grup WA, form pendaftaran, rekening donasi, dll) lewat tombol ini.'},
    {sel:'.panel-head', title:'Daftar Tautan', text:'Semua link yang sudah disimpan bisa diakses siapa aja dari sini, tanpa perlu login.'},
  ],
};

// Tur generik dipakai kalau section belum didaftarkan manual di TOUR_DEFS di
// atas — supaya SEMUA menu tetap kebagian tur walau singkat.
//
// CATATAN PENTING: banyak langkah di TOUR_DEFS menunjuk tombol yang cuma ada
// kalau user sudah login (mis. tombol "Tambah") atau kalau datanya sudah ada
// (mis. .lomba-badge, .hadiah-group-header). Kalau SEMUA langkah di satu
// section kebetulan tidak ketemu (mis. dibuka sebagai guest, atau event baru
// yang datanya masih kosong), showTourStep() akan skip terus sampai habis
// lalu langsung closeTour() — hasilnya tur kelihatan "jalan sendiri lalu
// hilang sendiri" padahal user baru saja klik tombol 🎯, belum sempat pencet
// apa-apa. Makanya di sini selalu ditambahkan 1 langkah fallback yang nunjuk
// ke #page-title, elemen statis di topbar yang PASTI selalu ada di DOM apa
// pun kondisi login/datanya — supaya tur nggak pernah nutup sendiri tanpa
// sempat kelihatan sama sekali.
function tourStepsFor(sectionKey){
  const custom = TOUR_DEFS[sectionKey];
  const meta = SECTIONS.find(s => s.key === sectionKey);
  const label = meta ? sectionLabel(meta) : 'halaman ini';
  const desc = meta ? (meta.desc || meta.sub) : '';
  const fallbackStep = {sel:'#page-title', title:label, text: desc ? `${desc}. Beberapa tombol di tur ini mungkin nggak kelihatan tergantung status login/data — jelajahi tombol-tombol yang ada.` : `Halaman ${label} — jelajahi tombol-tombol yang ada di sini.`};
  if(custom && custom.length) return [...custom, fallbackStep];
  return [
    fallbackStep,
    {sel:'#content .panel-head, #content .panel', title:'Isi Halaman', text:'Di sinilah data & aksi buat menu ini ditampilkan.'},
  ];
}

let _tourSteps = [];
let _tourIndex = 0;
let _tourResizeHandler = null;

function startTourForCurrentSection(){
  startTour(currentSection);
}

function startTour(sectionKey){
  closeTour();
  _tourSteps = tourStepsFor(sectionKey);
  _tourIndex = 0;
  buildTourDom();
  showTourStep(0);
}

function findFirstMatch(selList){
  const parts = String(selList || '').split(',').map(s => s.trim()).filter(Boolean);
  for(const p of parts){
    try{ const el = document.querySelector(p); if(el) return el; }catch(e){ /* selector nggak valid, lewati */ }
  }
  return null;
}

function buildTourDom(){
  if(document.getElementById('tour-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'tour-overlay';
  overlay.innerHTML = `
    <div class="tour-spotlight" id="tour-spotlight"></div>
    <div class="tour-tooltip" id="tour-tooltip">
      <div class="tour-tooltip-head">
        <span class="tour-step-count" id="tour-step-count"></span>
        <button class="tour-close" id="tour-close" type="button" aria-label="Tutup tur">✕</button>
      </div>
      <div class="tour-title" id="tour-title"></div>
      <div class="tour-text" id="tour-text"></div>
      <div class="tour-foot">
        <button class="btn secondary small" id="tour-prev" type="button">‹ Sebelumnya</button>
        <button class="btn small" id="tour-next" type="button">Lanjut ›</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('tour-close').onclick = closeTour;
  document.getElementById('tour-prev').onclick = () => showTourStep(_tourIndex - 1);
  document.getElementById('tour-next').onclick = () => {
    if(_tourIndex >= _tourSteps.length - 1) closeTour();
    else showTourStep(_tourIndex + 1);
  };
  overlay.addEventListener('click', (e) => { if(e.target.id === 'tour-overlay') closeTour(); });
  _tourResizeHandler = () => positionTourTooltip();
  window.addEventListener('resize', _tourResizeHandler);
  window.addEventListener('scroll', _tourResizeHandler, true);
  document.addEventListener('keydown', tourKeyHandler);
}

function tourKeyHandler(e){
  if(e.key === 'Escape') closeTour();
}

function showTourStep(idx){
  if(idx < 0) idx = 0;
  // Lompatin langkah yang elemennya nggak ketemu di DOM saat ini (mis.
  // tombol yang cuma muncul kalau sudah login atau data masih kosong).
  while(idx < _tourSteps.length && !findFirstMatch(_tourSteps[idx].sel)){
    idx++;
  }
  if(idx >= _tourSteps.length){ closeTour(); return; }
  _tourIndex = idx;
  const step = _tourSteps[idx];
  const target = findFirstMatch(step.sel);
  document.getElementById('tour-step-count').textContent = `Langkah ${idx + 1}/${_tourSteps.length}`;
  document.getElementById('tour-title').textContent = step.title;
  document.getElementById('tour-text').textContent = step.text;
  document.getElementById('tour-prev').style.visibility = idx === 0 ? 'hidden' : 'visible';
  document.getElementById('tour-next').textContent = idx === _tourSteps.length - 1 ? '✓ Selesai' : 'Lanjut ›';
  if(target){
    target.scrollIntoView({block:'center', behavior:'smooth'});
    setTimeout(() => positionTourTooltip(target), 260);
  }
}

function positionTourTooltip(target){
  const spotlight = document.getElementById('tour-spotlight');
  const tooltip = document.getElementById('tour-tooltip');
  if(!spotlight || !tooltip) return;
  if(!target){
    const step = _tourSteps[_tourIndex];
    target = step ? findFirstMatch(step.sel) : null;
  }
  if(!target){ spotlight.style.display = 'none'; return; }
  const r = target.getBoundingClientRect();
  const pad = 6;
  spotlight.style.display = 'block';
  spotlight.style.top = `${r.top - pad}px`;
  spotlight.style.left = `${r.left - pad}px`;
  spotlight.style.width = `${r.width + pad * 2}px`;
  spotlight.style.height = `${r.height + pad * 2}px`;

  const tw = tooltip.offsetWidth || 300;
  const th = tooltip.offsetHeight || 150;
  const vw = window.innerWidth, vh = window.innerHeight;
  let top = r.bottom + 16;
  let left = Math.min(Math.max(r.left, 12), Math.max(12, vw - tw - 12));
  if(top + th > vh - 12) top = r.top - th - 16;
  if(top < 12) top = Math.min(Math.max(12, (vh - th) / 2), Math.max(12, vh - th - 12));
  tooltip.style.top = `${Math.max(12, top)}px`;
  tooltip.style.left = `${left}px`;
}

function closeTour(){
  const overlay = document.getElementById('tour-overlay');
  if(overlay) overlay.remove();
  if(_tourResizeHandler){
    window.removeEventListener('resize', _tourResizeHandler);
    window.removeEventListener('scroll', _tourResizeHandler, true);
    _tourResizeHandler = null;
  }
  document.removeEventListener('keydown', tourKeyHandler);
}

// Tombol bulat mengambang buat mulai tur halaman yang sedang dibuka.
function initTourButton(){
  if(document.getElementById('tour-fab')) return;
  const btn = document.createElement('button');
  btn.id = 'tour-fab';
  btn.type = 'button';
  btn.title = 'Mulai tur halaman ini';
  btn.setAttribute('aria-label', 'Mulai tur halaman ini');
  btn.textContent = '🎯';
  btn.onclick = startTourForCurrentSection;
  document.body.appendChild(btn);
}
