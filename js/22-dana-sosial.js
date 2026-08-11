/* ============================================================
   DANA SOSIAL
   Iuran bulanan Rp 5.000/anggota — TIDAK terikat event 17-an
   manapun (sama seperti Kas Karang Taruna/Agenda/Gudang).

   Daftar anggota di sini disimpan terpisah secara teknis dari kt_anggota
   (Iuran Anggota per-event) — lihat kt_dana_sosial_anggota di
   supabase-dana-sosial-migration.sql — TAPI Database Anggota (kt_anggota)
   tetap jadi SATU-SATUNYA master nama anggota. Anggota Dana Sosial baru
   HANYA bisa masuk lewat "Ambil dari Database Anggota" (import nama yang
   sudah ada di kt_anggota); tidak ada lagi jalur tambah-manual bebas ketik
   nama di tab Kelola Anggota, supaya nama tidak dobel-master. Anggota baru
   yang gabung di tengah tahun disimpan `tanggal_gabung`-nya; bulan-bulan
   SEBELUM itu otomatis dikosongkan di tabel (bukan dianggap "belum bayar").

   Setiap bulan direkap: jumlah anggota yang lunas dikali Rp 5.000,
   dikurangi potongan konsumsi pertemuan flat Rp 80.000 (tidak bisa
   diubah per bulan — sesuai keputusan awal fitur ini). Potongan ini
   TIDAK disimpan di DB, dihitung on-the-fly saat render supaya gampang
   diubah lagi nanti kalau kebijakan berubah.

   Struktur mengikuti pola modul eventless lain (lihat renderKas() di
   js/12-jadwal-agenda-kas.js): getter global (gDanaSosialAnggota/
   gDanaSosialBayar di js/18-getters-refresh.js), guard canEditSection
   ('dana-sosial'), dan notifyTelegram() untuk perubahan data anggota
   master (BUKAN untuk tiap toggle lunas/belum per sel — itu bisa
   terjadi puluhan kali dalam semenit saat rekap pertemuan bulanan,
   jadi sengaja tidak dikirim ke Telegram supaya tidak spam).

   CATATAN: modul ini SENGAJA cuma untuk anggota reguler (iuran bulanan).
   Anggota Perantauan TIDAK lagi ditangani di sini — mereka bayar sekali
   setahun untuk kegiatan Halal Bihalal, jadi dikelola lewat menu Anggota
   (Iuran Anggota per-Event) dengan kategori "Perantauan" sendiri, bukan
   lewat Dana Sosial. (Riwayat: dulu ada tab Perantauan terpisah di sini,
   dihapus karena sifat pembayarannya beda — bukan iuran rutin bulanan.)
   ============================================================ */

const DANA_SOSIAL_IURAN_PER_ORANG = 5000;
const DANA_SOSIAL_POTONGAN_KONSUMSI = 80000;
const DANA_SOSIAL_BULAN_LABEL = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

// Dipakai untuk jejak audit "siapa yang tandai/batalkan lunas" (lihat
// PENGAMANAN TANDAI LUNAS di bawah). Ambil dari user yang sedang login;
// kalau entah kenapa tidak ada (harusnya tidak mungkin karena toggle sudah
// digerbang canEditSection), fallback ke label netral supaya tetap ada
// catatan daripada kosong sama sekali.
function namaUserDanaSosial(){
  const u = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  return (u && (u.name || u.username)) || 'Tidak diketahui';
}

// Tahun yang lagi dilihat di tabel/rekap. Reset ke tahun berjalan tiap kali
// halaman dimuat ulang (tidak perlu disimpan permanen) — cukup dropdown di
// halaman utk pindah ke tahun sebelumnya/berikutnya.
let danaSosialTahunAktif = new Date().getFullYear();

// Daftar tahun yang bisa dipilih di dropdown: tahun berjalan, tahun depan
// (biar bisa disiapkan lebih awal), plus tahun mana pun yang sudah punya
// data (baris bayar atau anggota yang gabung di tahun itu).
function danaSosialTahunList(){
  const now = new Date().getFullYear();
  const tahunSet = new Set([now, now + 1]);
  db.danaSosialBayar.forEach(b => tahunSet.add(Number(b.tahun)));
  db.danaSosialAnggota.forEach(a => { if (a.tanggal_gabung) tahunSet.add(Number(a.tanggal_gabung.slice(0,4))); });
  return Array.from(tahunSet).sort((a,b) => b - a);
}

// Anggota wajib bayar bulan ini kalau tanggal gabungnya <= bulan yang dicek.
// Bulan-bulan SEBELUM gabung otomatis tidak wajib (dikosongkan di tabel).
function isWajibDanaSosial(anggota, tahun, bulan){
  // `aktif` (default true, lihat kt_dana_sosial_anggota) menandai anggota
  // yang dinonaktifkan lewat "Nonaktifkan" di tab Kelola Anggota — biasanya
  // karena pindah/keluar tapi datanya tetap disimpan (bukan dihapus, supaya
  // riwayat bayar lama tidak hilang). Anggota nonaktif tidak lagi wajib
  // bayar bulan manapun sejak dinonaktifkan.
  // Nonaktif berlaku setelah bulan keluar, bukan mundur ke seluruh riwayat.
  if (anggota.aktif === false && anggota.tanggal_nonaktif) {
    const d = new Date(anggota.tanggal_nonaktif + 'T00:00:00');
    const nonaktifKey = d.getFullYear() * 12 + d.getMonth();
    const targetKey = Number(tahun) * 12 + (Number(bulan) - 1);
    if (targetKey > nonaktifKey) return false;
  }
  if (!anggota.tanggal_gabung) return true;
  const g = new Date(anggota.tanggal_gabung + 'T00:00:00');
  const gKey = g.getFullYear() * 12 + g.getMonth(); // bulan 0-11
  const tKey = Number(tahun) * 12 + (Number(bulan) - 1);
  return tKey >= gKey;
}

function getDanaSosialBayar(anggotaId, tahun, bulan){
  return db.danaSosialBayar.find(b => b.anggota_id === anggotaId && Number(b.tahun) === Number(tahun) && Number(b.bulan) === Number(bulan));
}

// Bulan ini sudah "terlewati" (sudah terjadi atau sedang berjalan)? Dipakai
// supaya rekap bulan-bulan yang belum terjadi diberi label "proyeksi", bukan
// dianggap sudah pasti defisit Rp 80.000.
function danaSosialSudahBerjalan(tahun, bulan){
  const now = new Date();
  const tKey = Number(tahun) * 12 + (Number(bulan) - 1);
  const nKey = now.getFullYear() * 12 + now.getMonth();
  return tKey <= nKey;
}

function hitungRekapBulanDanaSosial(tahun, bulan){
  const anggotaWajib = db.danaSosialAnggota.filter(a => isWajibDanaSosial(a, tahun, bulan));
  // "Lunas"/"Belum" tetap dilihat dari kewajiban bulan ini (status kepatuhan
  // iuran per bulan wajib) — ini TIDAK berubah walau tunggakan baru dilunasi
  // belakangan, karena statusnya sendiri (rec.lunas pada bulan wajib itu)
  // memang jadi true begitu dibayar, terlepas kapan.
  const lunasList = anggotaWajib.filter(a => { const r = getDanaSosialBayar(a.id, tahun, bulan); return r && r.lunas; });
  // "Terkumpul" (uang masuk) SENGAJA dihitung dari TANGGAL BAYAR AKTUAL
  // (tanggal_bayar), bukan dari field `bulan` (bulan wajib) pada baris
  // pembayaran. Jadi kalau anggota baru melunasi tunggakan bulan lama di
  // bulan berjalan sekarang, uangnya masuk ke rekap BULAN INI (bulan saat
  // fisik dibayar) — bukan menambah rekap bulan lama yang sudah lewat.
  // Ini supaya rekap mencerminkan kas masuk riil untuk keperluan laporan.
  const cocokBulanBayar = (b) => {
    if (!b.lunas || !b.tanggal_bayar) return false;
    const ty = Number(String(b.tanggal_bayar).slice(0, 4));
    const tm = Number(String(b.tanggal_bayar).slice(5, 7));
    return ty === Number(tahun) && tm === Number(bulan);
  };
  const terkumpulList = db.danaSosialBayar.filter(cocokBulanBayar);
  const terkumpul = terkumpulList.length * DANA_SOSIAL_IURAN_PER_ORANG;
  const potongan = DANA_SOSIAL_POTONGAN_KONSUMSI;
  return {
    wajib: anggotaWajib.length,
    lunas: lunasList.length,
    belum: anggotaWajib.length - lunasList.length,
    terkumpul, potongan,
    saldoBersih: terkumpul - potongan,
    sudahBerjalan: danaSosialSudahBerjalan(tahun, bulan),
  };
}

// Saldo Dana Sosial keseluruhan (sejak anggota pertama gabung sampai bulan
// berjalan sekarang) — dijumlahkan dari saldo bersih tiap bulan yang MEMANG
// sudah punya anggota wajib bayar (bulan sebelum ada anggota sama sekali
// tidak ikut dihitung, karena belum ada pertemuan/potongan konsumsi).
// Bulan yang belum terlewati (masa depan) sengaja tidak diikutkan supaya
// saldo tidak "dipotong" duluan untuk pertemuan yang belum terjadi.
function hitungSaldoDanaSosialTotal(){
  if (db.danaSosialAnggota.length === 0) return 0;
  const now = new Date();
  const tahunMulai = db.danaSosialAnggota.reduce((min, a) => {
    const y = a.tanggal_gabung ? Number(a.tanggal_gabung.slice(0,4)) : now.getFullYear();
    return Math.min(min, y);
  }, now.getFullYear());
  let total = 0;
  for (let y = tahunMulai; y <= now.getFullYear(); y++){
    const bulanAkhir = (y === now.getFullYear()) ? (now.getMonth() + 1) : 12;
    for (let b = 1; b <= bulanAkhir; b++){
      const r = hitungRekapBulanDanaSosial(y, b);
      if (r.wajib > 0) total += r.saldoBersih;
    }
  }
  return total;
}

// Total yang HARUS dibayar anggota reguler di tahun ini: dihitung dari
// jumlah bulan wajib yang sudah terjadi/berjalan (bukan bulan depan) tapi
// belum ditandai lunas, dikali iuran per bulan. Kalau anggota rutin bayar
// tiap bulan, nilainya selalu pas 1x iuran (bulan berjalan saja). Kalau ada
// bulan sebelumnya yang kelewat belum dibayar, nilainya ikut menumpuk
// (2x, 3x, dst iuran) sampai semua bulan yang nunggak itu dilunasi satu-
// satu. Sengaja dihitung per TAHUN yang sedang dilihat saja (tidak
// menumpuk lintas tahun) supaya angkanya konsisten dengan tabel Daftar
// Bayar yang juga per tahun.
function hitungTunggakanDanaSosial(anggota, tahun){
  let bulanBelum = 0;
  let adaBulanJatuhTempo = false; // apakah ada bulan wajib yang SUDAH berjalan di tahun ini
  for (let b = 1; b <= 12; b++){
    if (!isWajibDanaSosial(anggota, tahun, b)) continue;
    if (!danaSosialSudahBerjalan(tahun, b)) continue; // bulan depan belum dihitung nunggak
    adaBulanJatuhTempo = true;
    const rec = getDanaSosialBayar(anggota.id, tahun, b);
    if (!(rec && rec.lunas)) bulanBelum++;
  }
  // PENTING: bulanBelum === 0 BUKAN berarti "sudah lunas" kalau belum ada satupun
  // bulan yang jatuh tempo (mis. tahun sepenuhnya di masa depan). adaBulanJatuhTempo
  // membedakan dua kondisi ini supaya UI tidak salah menampilkan "Lunas" padahal
  // belum ada kewajiban apapun yang jatuh tempo.
  return { bulanBelum, total: bulanBelum * DANA_SOSIAL_IURAN_PER_ORANG, adaBulanJatuhTempo };
}

function gantiTahunDanaSosial(v){
  danaSosialTahunAktif = Number(v);
  renderContent();
}

/* ============================================================
   DROPDOWN TAHUN (pengganti <select> native)
   Sebelumnya <select> polos — kotaknya sudah dipercantik lewat CSS
   (appearance:none + panah custom), TAPI daftar pilihan yang muncul saat
   diklik tetap dirender native oleh OS/browser dan sama sekali di luar
   jangkauan CSS. Makanya diganti total jadi dropdown buatan sendiri
   (tombol trigger + panel melayang), mengikuti pola yang sama dipakai
   combo pilih Barang Gudang (js/17b-gudang-pinjam.js) dan combo pilih
   Koordinator Lomba (js/10-lomba.js) — supaya kotak DAN daftar
   pilihannya full custom, senada tema app.
   Dipakai di 2 tempat (tab Daftar Bayar/Rekap), semuanya mengubah tahun
   aktif yang SAMA (danaSosialTahunAktif) lewat gantiTahunDanaSosial() yang
   sudah ada di atas — jadi cukup satu set fungsi generik, dibedakan lewat
   idSuffix trigger-nya saja ('daftar'/'rekap').
   ============================================================ */
function dsComboIconChevron(){
  return `<svg class="combo-chevron" width="15" height="15" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function dsComboIconCheck(){
  return `<svg class="combo-check" width="15" height="15" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function dsTahunTriggerHtml(idSuffix){
  return `<button type="button" id="ds-tahun-trigger-${idSuffix}" class="combo-trigger ds-tahun-trigger" ${da('toggleDsTahunCombo', idSuffix)}>
    <span class="combo-trigger-label">${danaSosialTahunAktif}</span>
    ${dsComboIconChevron()}
  </button>`;
}
function dsTahunComboPanelHtml(){
  const tahun = danaSosialTahunAktif;
  const optionsHtml = danaSosialTahunList().map(t=>{
    const selected = t === tahun;
    return `<button type="button" class="combo-option${selected?' selected':''}" ${da('selectDsTahun', t)}>
      <span class="combo-option-main"><span class="combo-option-name">${t}</span></span>
      <span class="combo-option-side">${selected ? dsComboIconCheck() : ''}</span>
    </button>`;
  }).join('');
  return `<div class="combo-list" data-combo-list>${optionsHtml}</div>`;
}
let _dsTahunComboOpenId = null;
let _dsTahunComboPanelEl = null;
function dsTahunComboPositionPanel(trigger, panel){
  const rect = trigger.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const panelWidth = Math.max(rect.width, 120);
  panel.style.left = Math.max(8, rect.left) + 'px';
  panel.style.width = panelWidth + 'px';
  const panelH = panel.offsetHeight || 240;
  const spaceBelow = vh - rect.bottom;
  const spaceAbove = rect.top;
  if(spaceBelow < panelH + 12 && spaceAbove > spaceBelow){
    panel.style.top = Math.max(8, rect.top - panelH - 6) + 'px';
  } else {
    panel.style.top = (rect.bottom + 6) + 'px';
  }
  const maxLeft = vw - panelWidth - 8;
  if(parseFloat(panel.style.left) > maxLeft) panel.style.left = Math.max(8, maxLeft) + 'px';
}
function toggleDsTahunCombo(idSuffix){
  const trigger = document.getElementById(`ds-tahun-trigger-${idSuffix}`);
  if(!trigger) return;
  if(_dsTahunComboOpenId === idSuffix){ closeDsTahunCombo(); return; }
  closeDsTahunCombo();
  const panel = document.createElement('div');
  panel.className = 'combo-panel combo-panel-floating';
  panel.id = 'ds-tahun-combo-floating';
  panel.innerHTML = dsTahunComboPanelHtml();
  document.body.appendChild(panel);
  dsTahunComboPositionPanel(trigger, panel);
  requestAnimationFrame(()=>panel.classList.add('show'));
  trigger.classList.add('open');
  _dsTahunComboOpenId = idSuffix;
  _dsTahunComboPanelEl = panel;
}
function closeDsTahunCombo(){
  if(_dsTahunComboPanelEl){ _dsTahunComboPanelEl.remove(); _dsTahunComboPanelEl = null; }
  document.querySelectorAll('.ds-tahun-trigger.open').forEach(t=>t.classList.remove('open'));
  _dsTahunComboOpenId = null;
}
function selectDsTahun(tahun){
  // Tutup dulu sebelum ganti tahun — gantiTahunDanaSosial() memanggil
  // renderContent() yang merender ulang seluruh halaman (termasuk tombol
  // trigger-nya), jadi panel lama harus sudah dilepas dari body duluan
  // supaya tidak nyangkut nunjuk ke trigger yang sudah tidak ada lagi.
  closeDsTahunCombo();
  gantiTahunDanaSosial(tahun);
}
document.addEventListener('click', (e)=>{
  if(e.target.closest('.combo-panel-floating') || e.target.closest('.ds-tahun-trigger')) return;
  closeDsTahunCombo();
});
document.addEventListener('keydown', (e)=>{
  if(e.key==='Escape') closeDsTahunCombo();
});
window.addEventListener('resize', ()=>{
  if(_dsTahunComboOpenId===null || !_dsTahunComboPanelEl) return;
  const trigger = document.getElementById(`ds-tahun-trigger-${_dsTahunComboOpenId}`);
  if(!trigger || !document.body.contains(trigger)){ closeDsTahunCombo(); return; }
  dsTahunComboPositionPanel(trigger, _dsTahunComboPanelEl);
});

// Tab aktif di halaman Dana Sosial: 'daftar' (list nama + centang bayar saja,
// tanpa aksi kelola), 'kelola' (tambah/ubah/hapus/ambil dari Database
// Anggota), atau 'rekap' (Rekap Bulanan). Reset ke 'daftar' tiap kali
// halaman dimuat ulang (tidak perlu disimpan permanen), sama seperti pola
// tab di renderLomba().
let danaSosialActiveTab = 'daftar';
function setDanaSosialTab(tab){
  danaSosialActiveTab = tab;
  renderContent();
}

function renderDanaSosial(){
  const canEdit = canEditSection('dana-sosial');
  const tahun = danaSosialTahunAktif;
  const anggotaList = gDanaSosialAnggota();
  // Tabel Daftar Bayar & stat "Total Anggota" cuma menghitung yang masih
  // aktif — anggota yang dinonaktifkan (lihat isWajibDanaSosial) tetap ada
  // di tab Kelola Anggota supaya datanya tidak hilang, tapi disembunyikan
  // dari tabel bayar/rekap harian.
  const anggotaAktifList = anggotaList.filter(a => a.aktif !== false);
  const anggotaReguler = anggotaAktifList;
  const now = new Date();
  const rekapBulanIni = hitungRekapBulanDanaSosial(now.getFullYear(), now.getMonth() + 1);
  const saldoTotal = hitungSaldoDanaSosialTotal();

  // Header kolom bulan disiapkan dua versi (nama & angka 1-12); yang
  // ditampilkan diatur lewat CSS (.ds-bulan-full/.ds-bulan-num) supaya di
  // layar sempit (HP) otomatis pindah ke angka biar kolom tidak kesempitan.
  const theadBulan = DANA_SOSIAL_BULAN_LABEL.map((l,i) => `<th class="ds-bulan-h"><span class="ds-bulan-full">${l}</span><span class="ds-bulan-num">${i+1}</span></th>`).join('');

  function buatBarisBayar(list){
    return list.map((a, idx) => {
      const cells = DANA_SOSIAL_BULAN_LABEL.map((_, i) => {
        const bulan = i + 1;
        if (!isWajibDanaSosial(a, tahun, bulan)){
          return `<td class="ds-cell"><span class="ds-toggle ds-muted" title="Belum gabung">·</span></td>`;
        }
        const rec = getDanaSosialBayar(a.id, tahun, bulan);
        const lunas = !!(rec && rec.lunas);
        const titleTxt = `${esc(a.nama)} · ${DANA_SOSIAL_BULAN_LABEL[i]} ${tahun} — ${lunas ? 'Lunas (klik untuk batalkan)' : 'Belum bayar (klik untuk tandai lunas)'}${lunas && rec && rec.diubah_oleh ? ` · ditandai oleh ${esc(rec.diubah_oleh)}` : ''}`;
        return `<td class="ds-cell"><button type="button" class="ds-toggle ${lunas?'lunas':'belum'}" ${canEdit?da('toggleDanaSosialBayar', a.id, tahun, bulan):'disabled'} title="${titleTxt}"><span class="ds-toggle-mark">${lunas?'✓':''}</span><span class="ds-toggle-label">${lunas?'Sudah':'Belum'}</span></button></td>`;
      }).join('');
      const tunggakan = hitungTunggakanDanaSosial(a, tahun);
      const tunggakanTitle = !tunggakan.adaBulanJatuhTempo
        ? 'Belum ada bulan yang jatuh tempo di tahun ini'
        : (tunggakan.bulanBelum === 0
          ? 'Tidak ada tunggakan'
          : `Nunggak ${tunggakan.bulanBelum} bulan × ${fmtRp(DANA_SOSIAL_IURAN_PER_ORANG)}`);
      const tunggakanCell = !tunggakan.adaBulanJatuhTempo
        ? `<span class="ds-toggle-mono ds-muted" style="font-size:12px;">Belum jatuh tempo</span>`
        : (tunggakan.bulanBelum === 0
          ? `<span class="ds-lunas-tag">Lunas</span>`
          : `<span class="${tunggakan.bulanBelum>1?'ds-tunggakan-angka lebih':'ds-tunggakan-angka'}">${fmtRp(tunggakan.total)}</span>`);
      return `<tr>
        <td class="ds-no">${idx+1}</td>
        <td class="ds-nama">${esc(a.nama)}</td>
        ${cells}
        <td class="ds-cell ds-tunggakan" title="${tunggakanTitle}">${tunggakanCell}</td>
      </tr>`;
    }).join('');
  }

  const rowsReguler = buatBarisBayar(anggotaReguler);

  // Versi kartu (mobile) dari tabel Daftar Bayar reguler — dipakai di layar
  // sempit (lihat .ds-cards-mobile/.ds-daftar-bayar-desktop di CSS) supaya
  // tidak perlu scroll ke samping untuk 12 kolom bulan. Tiap anggota jadi
  // satu kartu dengan grid 4 kolom berisi 12 tombol bulan (chip kecil),
  // memakai fungsi bantu & data yang SAMA (isWajibDanaSosial/
  // getDanaSosialBayar/hitungTunggakanDanaSosial/toggleDanaSosialBayar)
  // seperti versi tabel, supaya perilaku klik & aturan tetap identik —
  // cuma tampilannya yang beda.
  function buatKartuBayar(list){
    return list.map((a, idx) => {
      const chips = DANA_SOSIAL_BULAN_LABEL.map((l, i) => {
        const bulan = i + 1;
        if (!isWajibDanaSosial(a, tahun, bulan)){
          return `<span class="ds-chip ds-chip-muted" title="${esc(a.nama)} · ${l} ${tahun} — Belum gabung">${l}</span>`;
        }
        const rec = getDanaSosialBayar(a.id, tahun, bulan);
        const lunas = !!(rec && rec.lunas);
        const titleTxt = `${esc(a.nama)} · ${l} ${tahun} — ${lunas ? 'Lunas (ketuk untuk batalkan)' : 'Belum bayar (ketuk untuk tandai lunas)'}${lunas && rec && rec.diubah_oleh ? ` · ditandai oleh ${esc(rec.diubah_oleh)}` : ''}`;
        return `<button type="button" class="ds-chip ${lunas?'lunas':'belum'}" ${canEdit?da('toggleDanaSosialBayar', a.id, tahun, bulan):'disabled'} title="${titleTxt}"><span class="ds-chip-mark">${lunas?'✓':''}</span>${l}</button>`;
      }).join('');
      const tunggakan = hitungTunggakanDanaSosial(a, tahun);
      const tunggakanCell = !tunggakan.adaBulanJatuhTempo
        ? `<span class="ds-toggle-mono ds-muted" style="font-size:11.5px;">Belum jatuh tempo</span>`
        : (tunggakan.bulanBelum === 0
          ? `<span class="ds-lunas-tag">Lunas</span>`
          : `<span class="${tunggakan.bulanBelum>1?'ds-tunggakan-angka lebih':'ds-tunggakan-angka'}">${fmtRp(tunggakan.total)}</span>`);
      return `<div class="ds-card">
        <div class="ds-card-head">
          <span class="ds-card-no">${idx+1}</span>
          <span class="ds-card-nama">${esc(a.nama)}</span>
          <span class="ds-card-tunggakan">${tunggakanCell}</span>
        </div>
        <div class="ds-chip-grid">${chips}</div>
      </div>`;
    }).join('');
  }
  const cardsReguler = buatKartuBayar(anggotaReguler);

  const kelolaRows = anggotaList.map((a, idx) => {
    const nonaktif = a.aktif === false;
    return `<tr ${nonaktif?'style="opacity:.55;"':''}>
    <td class="ds-no">${idx+1}</td>
    <td class="ds-nama">${esc(a.nama)}${nonaktif?' <span class="kategori-pill">Nonaktif</span>':''}</td>
    <td style="text-align:left; padding-left:10px;">${fmtDate(a.tanggal_gabung)}</td>
    <td style="text-align:right; white-space:nowrap;">
      ${canEdit?`<button class="icon-btn" ${da('toggleAktifDanaSosialAnggota', a.id)} title="${nonaktif?'Aktifkan kembali':'Nonaktifkan (tanpa hapus data)'}">${nonaktif?'↩️':'⏸'}</button>
      <button class="icon-btn" ${da('openDanaSosialAnggotaModal', a.id)} title="Edit">✎</button>
      <button class="icon-btn" ${da('hapusDanaSosialAnggota', a.id)} title="Hapus">🗑</button>`:''}
    </td>
  </tr>`;
  }).join('');

  const rekapRows = DANA_SOSIAL_BULAN_LABEL.map((l, i) => {
    const bulan = i + 1;
    const r = hitungRekapBulanDanaSosial(tahun, bulan);
    if (r.wajib === 0){
      return `<tr class="ds-rekap-kosong"><td>${l} ${tahun}</td><td colspan="5" class="hint">Belum ada anggota wajib bayar</td></tr>`;
    }
    return `<tr>
      <td>${l} ${tahun}</td>
      <td class="num">${r.wajib}</td>
      <td class="num">${r.lunas}</td>
      <td class="num">${fmtRp(r.terkumpul)}</td>
      <td class="num">${fmtRp(r.potongan)}</td>
      <td class="num ${r.saldoBersih<0?'ds-minus':''}">${fmtRp(r.saldoBersih)}${!r.sudahBerjalan?' <span class="hint">(proyeksi)</span>':''}</td>
    </tr>`;
  }).join('');

  let totalTerkumpulTahun = 0, totalPotonganTahun = 0;
  for (let b = 1; b <= 12; b++){
    const r = hitungRekapBulanDanaSosial(tahun, b);
    totalTerkumpulTahun += r.terkumpul;
    if (r.wajib > 0) totalPotonganTahun += r.potongan;
  }
  const totalSaldoTahun = totalTerkumpulTahun - totalPotonganTahun;

  return `
  <div class="stat-grid-ringkasan" style="margin-bottom:26px;">
    <div class="stat-card"><div class="lbl">Total Anggota</div><div class="val">${anggotaAktifList.length}</div></div>
    <div class="stat-card pemasukan"><div class="lbl">Lunas Bulan Ini (${DANA_SOSIAL_BULAN_LABEL[now.getMonth()]} ${now.getFullYear()})</div><div class="val">${rekapBulanIni.lunas} / ${rekapBulanIni.wajib}</div></div>
    <div class="stat-card ${saldoTotal<0?'defisit':'saldo'}"><div class="lbl">Saldo Dana Sosial</div><div class="val">${fmtRp(saldoTotal)}</div></div>
  </div>

  <div class="lomba-tabs">
    <button type="button" class="lomba-tabbtn ${danaSosialActiveTab==='daftar'?'active':''}" ${da('setDanaSosialTab', 'daftar')}><i data-lucide="wallet" class="inline-icon"></i> Daftar Bayar</button>
    <button type="button" class="lomba-tabbtn ${danaSosialActiveTab==='rekap'?'active':''}" ${da('setDanaSosialTab', 'rekap')}><i data-lucide="bar-chart-3" class="inline-icon"></i> Rekap Bulanan</button>
    <button type="button" class="lomba-tabbtn ${danaSosialActiveTab==='kelola'?'active':''}" ${da('setDanaSosialTab', 'kelola')}><i data-lucide="users" class="inline-icon"></i> Kelola Anggota</button>
  </div>

  <div style="display:${danaSosialActiveTab==='daftar'?'block':'none'};">
  <div class="panel">
    <div class="panel-head">
      <div><h3>Daftar Bayar</h3>
        <div class="desc">Iuran ${fmtRp(DANA_SOSIAL_IURAN_PER_ORANG)}/orang/bulan · klik sel bulan untuk tandai lunas/belum · kolom Harus Bayar menumpuk kalau ada bulan sebelumnya yang belum dilunasi</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        ${dsTahunTriggerHtml('daftar')}
      </div>
    </div>
    <div class="panel-body flush">
      <div class="ds-daftar-bayar-desktop" style="overflow-x:auto; -webkit-overflow-scrolling:touch;">
        <table class="ds-table ds-has-no">
          <thead><tr><th class="ds-no-h">No</th><th class="ds-nama-h">Nama</th>${theadBulan}<th class="ds-tunggakan-h">Harus Bayar</th></tr></thead>
          <tbody>${rowsReguler || `<tr class="empty-row"><td colspan="15">Belum ada anggota Dana Sosial. ${canEdit?'Buka tab Kelola Anggota untuk mulai.':'Hanya role tertentu yang bisa menambah anggota.'}</td></tr>`}</tbody>
        </table>
      </div>
      <div class="ds-cards-mobile">
        ${cardsReguler || `<div class="ds-cards-empty">Belum ada anggota Dana Sosial. ${canEdit?'Buka tab Kelola Anggota untuk mulai.':'Hanya role tertentu yang bisa menambah anggota.'}</div>`}
      </div>
    </div>
  </div>
  </div>

  <div style="display:${danaSosialActiveTab==='rekap'?'block':'none'};">
  <div class="panel">
    <div class="panel-head">
      <div><h3>Rekap Bulanan ${tahun}</h3>
        <div class="desc">Terkumpul dikurangi potongan konsumsi pertemuan (flat ${fmtRp(DANA_SOSIAL_POTONGAN_KONSUMSI)}/bulan)</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        ${dsTahunTriggerHtml('rekap')}
      </div>
    </div>
    <div class="panel-body flush">
      <div style="overflow-x:auto; -webkit-overflow-scrolling:touch;">
        <table class="ds-rekap-table">
          <thead><tr><th>Bulan</th><th>Wajib</th><th>Lunas</th><th>Terkumpul</th><th>Potongan</th><th>Saldo Bersih</th></tr></thead>
          <tbody>${rekapRows}</tbody>
          <tfoot><tr class="ds-rekap-total"><td>Total ${tahun}</td><td></td><td></td><td class="num">${fmtRp(totalTerkumpulTahun)}</td><td class="num">${fmtRp(totalPotonganTahun)}</td><td class="num ${totalSaldoTahun<0?'ds-minus':''}">${fmtRp(totalSaldoTahun)}</td></tr></tfoot>
        </table>
      </div>
      <div class="ds-footnote">* Saldo bulan yang belum terlewati bersifat proyeksi (asumsi potongan konsumsi tetap berlaku).</div>
    </div>
  </div>
  </div>

  <div style="display:${danaSosialActiveTab==='kelola'?'block':'none'};">
  <div class="panel">
    <div class="panel-head">
      <div><h3>Kelola Anggota Dana Sosial</h3>
        <div class="desc">Tambah, ubah, atau hapus anggota master Dana Sosial</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        ${canEdit?`<button class="btn" ${da('openImporDanaSosialModal')}>📥+ Tambah dari Database Anggota</button>`:''}
      </div>
    </div>
    <div class="field-hint" style="color:var(--ink-soft); font-size:12px; padding:10px 18px 0;">Nama anggota baru wajib ditambahkan lewat <a href="#" ${da('goSection', 'anggota')}>Database Anggota</a> terlebih dahulu, lalu diambil ke sini — supaya hanya ada satu master data anggota.</div>
    <div class="panel-body flush" style="padding-top:12px;">
      <div style="overflow-x:auto; -webkit-overflow-scrolling:touch;">
        <table class="ds-table ds-has-no">
          <thead><tr><th class="ds-no-h">No</th><th class="ds-nama-h">Nama</th><th style="text-align:left; padding-left:10px;">Tanggal Gabung</th><th style="text-align:right;">Aksi</th></tr></thead>
          <tbody>${kelolaRows || `<tr class="empty-row"><td colspan="4">Belum ada anggota Dana Sosial. ${canEdit?'Klik + Tambah dari Database Anggota untuk mulai.':'Hanya role tertentu yang bisa menambah anggota.'}</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  </div>
  </div>`;
}

// PENGAMANAN TANDAI LUNAS (lihat catatan di atas file ini): membatalkan
// lunas (rec.lunas true → false) wajib konfirmasi + tampilkan siapa yang
// menandainya terakhir, dan setiap toggle dicatat jejaknya. Menandai lunas
// (belum → lunas) tetap satu klik, tidak dipersulit, karena itu arah yang
// risikonya rendah (cuma mencatat orang sudah bayar).
async function toggleDanaSosialBayar(anggotaId, tahun, bulan){
  if (!canEditSection('dana-sosial')) { toast('⛔ Anda tidak memiliki akses untuk mengedit Dana Sosial'); return; }
  const anggota = db.danaSosialAnggota.find(a => a.id === anggotaId);
  if (!anggota) return;
  if (!isWajibDanaSosial(anggota, tahun, bulan)) return;
  let rec = getDanaSosialBayar(anggotaId, tahun, bulan);
  if (rec && rec.lunas){
    const jejak = rec.diubah_oleh ? ` Terakhir ditandai oleh ${rec.diubah_oleh}${rec.tanggal_bayar?` (${fmtDate(rec.tanggal_bayar)})`:''}.` : '';
    if (!(await confirmModal(`Batalkan status LUNAS "${anggota.nama}" untuk ${DANA_SOSIAL_BULAN_LABEL[bulan-1]} ${tahun}?${jejak}\n\nTindakan ini tercatat atas nama Anda.`))) return;
    rec.lunas = false;
    rec.tanggal_bayar = null;
    rec.diubah_oleh = namaUserDanaSosial();
    rec.diubah_pada = new Date().toISOString();
  } else if (rec){
    rec.lunas = true;
    rec.tanggal_bayar = todayISO();
    rec.diubah_oleh = namaUserDanaSosial();
    rec.diubah_pada = new Date().toISOString();
  } else {
    rec = { id: uid(), anggota_id: anggotaId, tahun: Number(tahun), bulan: Number(bulan), lunas: true, tanggal_bayar: todayISO(), diubah_oleh: namaUserDanaSosial(), diubah_pada: new Date().toISOString(), created_at: new Date().toISOString() };
    db.danaSosialBayar.push(rec);
  }
  saveDB(); renderContent();
}

// Anggota Dana Sosial baru HANYA boleh masuk lewat "Ambil dari Database
// Anggota" (openImporDanaSosialModal) — supaya Database Anggota (kt_anggota)
// tetap jadi satu-satunya master nama anggota. Fungsi ini jadi khusus EDIT
// (tanggal gabung) untuk anggota yang sudah ada di sini; kalau terpanggil
// tanpa id (jalur lama), arahkan ke Database Anggota saja.
// Dipakai lewat da() di link "Database Anggota" pada modal Edit Anggota —
// dulu onclick multi-statement "closeModal(); goSection('anggota'); return
// false;", dipecah jadi fungsi sendiri karena da() cuma bisa memanggil SATU
// fungsi (lihat REFACTOR-EVENT-DELEGATION.md).
function tutupModalDanGotoAnggota(){
  closeModal();
  goSection('anggota');
}
function openDanaSosialAnggotaModal(id){
  if (!canEditSection('dana-sosial')) { toast('⛔ Anda tidak memiliki akses untuk mengedit Dana Sosial'); return; }
  const editing = id ? db.danaSosialAnggota.find(a => a.id === id) : null;
  if (!editing){
    toast('➡️ Tambahkan nama anggota baru di Database Anggota, lalu ambil ke sini');
    goSection('anggota');
    return;
  }
  setModal('Edit Anggota Dana Sosial', `
    <div class="field"><label>Nama</label><input id="f-ds-nama" value="${esc(editing.nama)}" disabled style="opacity:.6; cursor:not-allowed;"></div>
    <div class="field-hint" style="color:var(--ink-soft); font-size:12px; margin:-8px 0 10px;">Nama diambil dari Database Anggota dan tidak bisa diubah di sini. Kalau salah ketik, perbaiki dulu di <a href="#" ${da('tutupModalDanGotoAnggota')}>Database Anggota</a>, lalu hapus &amp; ambil ulang anggota ini.</div>
    <div class="field"><label>Tanggal Gabung</label><input id="f-ds-gabung" type="date" value="${editing.tanggal_gabung}"></div>
    <div class="hint">Bulan sebelum tanggal gabung otomatis dikosongkan di tabel (dianggap belum wajib bayar).</div>
  `, [
    {label:'Batal', cls:'secondary', onclick:()=>closeModal()},
    {label:'Hapus', cls:'danger', onclick:()=>{ closeModal(); hapusDanaSosialAnggota(editing.id); }},
    {label:'Simpan', cls:'', onclick:()=>{
      const tanggal_gabung = document.getElementById('f-ds-gabung').value || todayISO();
      closeModal();
      editing.tanggal_gabung = tanggal_gabung;
      notifyTelegram(`✏️ Edit anggota Dana Sosial: ${editing.nama}`, 'dana_sosial');
      saveDB(); renderContent();
    }}
  ]);
}

// Nonaktifkan (bukan hapus): dipakai untuk anggota yang pindah/keluar tapi
// riwayat bayarnya tetap mau disimpan. Anggota nonaktif otomatis hilang dari
// tabel Daftar Bayar & Rekap Bulanan (lihat isWajibDanaSosial), tapi masih
// kelihatan (pudar + label "Nonaktif") di tab Kelola Anggota dan bisa
// diaktifkan lagi kapan saja lewat tombol yang sama.
async function toggleAktifDanaSosialAnggota(id){
  if (!canEditSection('dana-sosial')) { toast('⛔ Anda tidak memiliki akses untuk mengedit Dana Sosial'); return; }
  const a = db.danaSosialAnggota.find(x => x.id === id); if (!a) return;
  const jadiAktif = a.aktif === false; // sebelumnya nonaktif -> aktifkan, sebaliknya nonaktifkan
  if (!jadiAktif && !(await confirmModal(`Nonaktifkan "${a.nama}" dari Dana Sosial? Anggota ini akan hilang dari tabel Daftar Bayar & Rekap Bulanan, tapi riwayat bayarnya tetap tersimpan dan bisa diaktifkan lagi kapan saja.`))) return;
  a.aktif = jadiAktif;
  a.tanggal_nonaktif = jadiAktif ? null : todayISO();
  saveDB(); renderContent();
  toast(jadiAktif ? `✓ ${a.nama} diaktifkan kembali` : `⏸ ${a.nama} dinonaktifkan`);
  notifyTelegram(jadiAktif ? `↩️ Aktifkan kembali anggota Dana Sosial: ${a.nama}` : `⏸ Nonaktifkan anggota Dana Sosial: ${a.nama}`, 'dana_sosial');
}

async function hapusDanaSosialAnggota(id){
  if (!canEditSection('dana-sosial')) { toast('⛔ Anda tidak memiliki akses untuk mengedit Dana Sosial'); return; }
  const a = db.danaSosialAnggota.find(x => x.id === id); if (!a) return;
  if (!(await confirmModal(`Hapus "${a.nama}" dari Dana Sosial? Semua riwayat bayar bulanan anggota ini juga akan ikut terhapus.`))) return;
  db.danaSosialAnggota = db.danaSosialAnggota.filter(x => x.id !== id);
  db.danaSosialBayar = db.danaSosialBayar.filter(b => b.anggota_id !== id);
  saveDB(); renderContent();
  notifyTelegram(`🗑️ Hapus anggota Dana Sosial: ${a.nama}`, 'dana_sosial');
}

/* ============================================================
   IMPOR ANGGOTA DARI DATABASE ANGGOTA (kt_anggota)
   Dana Sosial punya daftar anggota MASTER TERPISAH dari kt_anggota
   (lihat catatan di atas file ini), jadi fitur ini cuma cara CEPAT
   mengisi anggota Dana Sosial dari nama-nama yang sudah ada di
   Database Anggota (iuran per-event) — bukan sinkronisasi permanen.
   Nama diambil dari SEMUA event (unik per nama, tidak peduli event
   mana), lalu nama yang sudah terdaftar di Dana Sosial dilewati
   otomatis (anti dobel).

   PENTING soal urutan dedup: nama yang sama bisa muncul di lebih dari
   satu tahun event dengan kategori berbeda (mis. dulu 'Sekolah',
   sekarang 'Perantauan'). Baris yang "menang" saat dedup dipakai untuk
   menentukan apakah orang itu SEDANG berkategori Perantauan (dan karena
   itu DIKECUALIKAN dari daftar impor Dana Sosial — lihat di bawah), jadi
   harus baris dari TAHUN EVENT TERBARU orang itu — bukan menang cuma
   karena kebetulan duluan secara abjad. Makanya diurutkan tahun (desc)
   dulu, baru nama sebagai tie-breaker dalam tahun yang sama.

   Anggota yang kategori terbarunya "Perantauan" SENGAJA tidak ikut
   ditawarkan di sini — mereka tidak bayar iuran bulanan Dana Sosial,
   dikelola lewat menu Anggota (Iuran per-Event) untuk kegiatan Halal
   Bihalal.
   ============================================================ */
function daftarNamaUnikDariDatabaseAnggota(){
  const tahunEvent = new Map(db.events.map(e => [e.id, Number(e.tahun) || 0]));
  const seen = new Set();
  const out = [];
  db.anggota.slice()
    .sort((a,b)=>{
      const ta = tahunEvent.get(a.event_id) || 0;
      const tb = tahunEvent.get(b.event_id) || 0;
      if (tb !== ta) return tb - ta; // tahun terbaru duluan
      return a.nama.localeCompare(b.nama,'id',{sensitivity:'base'});
    })
    .forEach(a=>{
      const key = (a.nama||'').trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      if (a.kategori === 'perantauan') return; // lihat catatan di atas
      out.push(a);
    });
  // Baris yang dipakai (kategori dari tahun terbaru) sudah terpilih di atas;
  // urutan TAMPILAN di modal tetap abjad seperti semula.
  return out.sort((a,b)=>a.nama.localeCompare(b.nama,'id',{sensitivity:'base'}));
}

function openImporDanaSosialModal(){
  if (!canEditSection('dana-sosial')) { toast('⛔ Anda tidak memiliki akses untuk mengedit Dana Sosial'); return; }
  const sumber = daftarNamaUnikDariDatabaseAnggota();
  if (sumber.length === 0){ toast('Database Anggota masih kosong'); return; }
  setModal('📥 Ambil Anggota dari Database Anggota', `
    <div class="field-hint" style="color:var(--ink-soft); font-size:12.5px; margin:-2px 0 10px;">Nama diambil dari Database Anggota (semua event, tanpa duplikat). Nama yang sudah terdaftar di Dana Sosial otomatis dilewati. Tanggal gabung diisi hari ini untuk semua yang dipilih.</div>
    <div class="field"><label>Tanggal Gabung</label><input id="impor-ds-gabung" type="date" value="${todayISO()}"></div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
      <label style="font-size:12px; display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" id="impor-ds-pilih-semua" onchange="toggleImporDanaSosialPilihSemua(this.checked)"> Pilih Semua</label>
      <span id="impor-ds-count-label" style="font-size:12px; color:var(--ink-soft);"></span>
    </div>
    <div id="impor-ds-list" style="max-height:320px; overflow-y:auto; border:1px solid var(--line); border-radius:8px; padding:4px 8px;"></div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:'Ambil Anggota Terpilih', cls:'', onclick:konfirmasiImporDanaSosial}
  ]);
  setTimeout(renderImporDanaSosialList, 0);
}

function renderImporDanaSosialList(){
  const listEl = document.getElementById('impor-ds-list');
  if (!listEl) return;
  const namaSekarang = new Set(db.danaSosialAnggota.map(a=>a.nama.trim().toLowerCase()));
  const sumber = daftarNamaUnikDariDatabaseAnggota();
  listEl.innerHTML = sumber.map(a=>{
    const dobel = namaSekarang.has(a.nama.trim().toLowerCase());
    return `<label style="display:flex; align-items:center; gap:8px; padding:6px 2px; ${dobel?'opacity:.5;':''} border-bottom:1px solid var(--line);">
      <input type="checkbox" class="impor-ds-chk" value="${esc(a.nama)}" ${dobel?'disabled':'checked'} onchange="updateImporDanaSosialCountLabel()">
      <span style="flex:1;">${esc(a.nama)}</span>
      ${dobel?'<span style="font-size:11px;color:var(--ink-soft);">sudah ada</span>':''}
    </label>`;
  }).join('');
  const selectableCount = document.querySelectorAll('.impor-ds-chk:not(:disabled)').length;
  const pilihSemuaEl = document.getElementById('impor-ds-pilih-semua');
  if (pilihSemuaEl) pilihSemuaEl.checked = selectableCount > 0;
  updateImporDanaSosialCountLabel();
}

function toggleImporDanaSosialPilihSemua(checked){
  document.querySelectorAll('.impor-ds-chk:not(:disabled)').forEach(c=>c.checked=checked);
  updateImporDanaSosialCountLabel();
}

function updateImporDanaSosialCountLabel(){
  const label = document.getElementById('impor-ds-count-label');
  if (!label) return;
  const total = document.querySelectorAll('.impor-ds-chk').length;
  const checked = document.querySelectorAll('.impor-ds-chk:checked').length;
  label.textContent = total ? `${checked} dari ${total} dipilih` : '';
}

function konfirmasiImporDanaSosial(){
  const checked = Array.from(document.querySelectorAll('.impor-ds-chk:checked'));
  if (checked.length === 0){ toast('Pilih minimal satu anggota untuk diambil'); return; }
  const tanggal_gabung = document.getElementById('impor-ds-gabung').value || todayISO();
  let count = 0;
  checked.forEach(chk=>{
    const nama = chk.value.trim();
    if (!nama) return;
    db.danaSosialAnggota.push({ id: uid(), nama, tanggal_gabung, aktif: true, created_at: new Date().toISOString() });
    count++;
  });
  saveDB(); closeModal(); renderContent();
  toast(`✓ ${count} anggota diambil dari Database Anggota`);
  notifyTelegram(`📥 Ambil ${count} anggota Dana Sosial dari Database Anggota`, `Tanggal gabung: ${fmtDate(tanggal_gabung)}`, 'dana_sosial');
}

/* ============================================================
   BACKUP / RESTORE DANA SOSIAL (dipanggil dari menu Pengaturan >
   Cadangan Data, mengikuti pola kasExportJSON/kasImportJSON &
   gudangExportJSON/gudangImportJSON di file lain).
   Ekspor mengambil KEDUA tabel (anggota + rekap bayar) sekaligus
   supaya satu file backup selalu lengkap & konsisten. Impor MENAMBAH
   (upsert by id), tidak menimpa/menghapus data yang sudah ada.
   ============================================================ */
async function danaSosialExportJSON(){
  const payload = {
    exportedAt: new Date().toISOString(),
    danaSosialAnggota: db.danaSosialAnggota,
    danaSosialBayar: db.danaSosialBayar,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dana-sosial-backup-${todayISO()}.json`;
  a.click();
  toast('✅ Backup Dana Sosial berhasil diekspor.');
}
function danaSosialImportJSON(input){
  if (!canEditSection('dana-sosial')) { toast('⛔ Anda tidak memiliki akses untuk mengimpor data Dana Sosial'); input.value=''; return; }
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async (e)=>{
    try{
      const parsed = JSON.parse(e.target.result);
      if(!Array.isArray(parsed.danaSosialAnggota) || !Array.isArray(parsed.danaSosialBayar)) throw new Error('Format file backup tidak dikenali.');
      if(!(await confirmModal(`Import akan MENAMBAH ${parsed.danaSosialAnggota.length} anggota dan ${parsed.danaSosialBayar.length} rekap bayar ke Dana Sosial (data lama tidak dihapus). Lanjutkan?`))) return;
      toast('⏳ Mengimpor data...');

      const anggotaRows = parsed.danaSosialAnggota.map(a => ({
        id: a.id || uid(),
        nama: a.nama || '',
        tanggal_gabung: a.tanggal_gabung || todayISO(),
        aktif: a.aktif !== false,
        created_at: a.created_at || new Date().toISOString(),
      }));
      const insAnggota = await sb.from('kt_dana_sosial_anggota').upsert(anggotaRows, {onConflict:'id'});
      if(insAnggota.error) throw new Error(insAnggota.error.message);

      const bayarRows = parsed.danaSosialBayar.map(b => ({
        id: b.id || uid(),
        anggota_id: b.anggota_id,
        tahun: Number(b.tahun),
        bulan: Number(b.bulan),
        lunas: !!b.lunas,
        tanggal_bayar: b.tanggal_bayar || null,
        diubah_oleh: b.diubah_oleh || null,
        diubah_pada: b.diubah_pada || null,
        created_at: b.created_at || new Date().toISOString(),
      }));
      const insBayar = await sb.from('kt_dana_sosial_bayar').upsert(bayarRows, {onConflict:'id'});
      if(insBayar.error) throw new Error(insBayar.error.message);

      const [resAnggota, resBayar] = await Promise.all([
        sb.from('kt_dana_sosial_anggota').select('*'),
        sb.from('kt_dana_sosial_bayar').select('*'),
      ]);
      if(resAnggota.error) throw new Error(resAnggota.error.message);
      if(resBayar.error) throw new Error(resBayar.error.message);
      db.danaSosialAnggota = resAnggota.data || [];
      db.danaSosialBayar = resBayar.data || [];
      _lastKnownIds['kt_dana_sosial_anggota'] = new Set(db.danaSosialAnggota.map(r=>r.id));
      _lastKnownUpdatedAt['kt_dana_sosial_anggota'] = new Map(db.danaSosialAnggota.map(r=>[r.id, r.updated_at||null]));
      _lastKnownIds['kt_dana_sosial_bayar'] = new Set(db.danaSosialBayar.map(r=>r.id));
      _lastKnownUpdatedAt['kt_dana_sosial_bayar'] = new Map(db.danaSosialBayar.map(r=>[r.id, r.updated_at||null]));

      toast('✅ Import selesai.');
      renderContent();
    }catch(err){
      console.error(err);
      toast('⛔ Gagal import: ' + err.message);
    }
    input.value = '';
  };
  reader.readAsText(file);
}
