/* ============================================================
   PERHITUNGAN HARGA AKTUAL HADIAH LOMBA — sumber kebenaran tunggal
   untuk total belanja hadiah, dipakai bersama oleh Belanja Hadiah
   (renderBelanjaHadiah di 11-belanja.js), Dashboard (hitungBukuUtama
   di 16-ui-helpers.js), Kebutuhan Hadiah (renderHadiah di 10-lomba.js),
   dan LPJ (renderLPJ di 13-lpj.js).
   ------------------------------------------------------------
   Bug #2: dulu keempat tempat itu menghitung total hadiah lomba
   dengan rumus flat (harga_satuan * qty_dibeli) yang mengabaikan
   harga_eceran. Begitu panitia mengatur harga eceran berbeda untuk
   sisa pcs yang tidak genap 1 pack (lewat "✎ Update harga & kemasan"
   di Belanja Hadiah), Dashboard/Kebutuhan Hadiah/LPJ jadi under-estimate
   dibanding pengeluaran riil.
   ------------------------------------------------------------
   Bug #3 (susulan dari Bug #2): fix di atas awalnya diimplementasikan
   dengan cara renderBelanjaHadiah() punya salinan rumus pack+eceran+
   packRef SENDIRI, dan fungsi ini "meniru persis" rumus itu di tempat
   terpisah. Dua salinan rumus yang harus selalu identik tapi ditulis
   manual di dua tempat gampang ke-drift kalau salah satu diubah tanpa
   ikut mengubah yang lain (persis ini yang bikin tie-break packRef
   sempat beda antar halaman). Sekarang renderBelanjaHadiah() memanggil
   fungsi ini langsung dan pakai perGroup di bawah untuk breakdown
   pack/eceran per grup — HANYA ADA SATU implementasi rumus ini di
   seluruh app, supaya kelas bug ini tidak bisa terulang lagi.
   ============================================================ */
/* ============================================================
   CARD PROGRESS BELANJA — dipakai bersama oleh Belanja Hadiah,
   Belanja Perlengkapan, dan Belanja Jalan Santai supaya progres
   (persentase item yang sudah dibeli) kelihatan langsung di atas
   daftar, konsisten dengan progress bar kelengkapan setup lomba
   (lihat renderLombaCard di 10-lomba.js).
   ============================================================ */
function progressBelanjaCardHtml(totalItem, totalSudah){
  if(!totalItem) return '';
  const pct = Math.round((totalSudah/totalItem)*100);
  const color = pct===100 ? 'var(--hijau)' : (pct===0 ? 'var(--merah)' : 'var(--orange)');
  return `<div class="stat-card${pct===100?' saldo':' stok-lebih'}">
    <div class="lbl">Progress Belanja</div>
    <div class="val">${pct}% <span style="font-size:12px;font-weight:500;color:var(--ink-soft);">(${totalSudah}/${totalItem})</span></div>
    <div class="stat-progress-bar"><div class="stat-progress-fill" style="width:${pct}%;background:${color};"></div></div>
  </div>`;
}
function snapshotBelanjaHadiah(item){
  return { qty_snapshot:Number(item.qty_dibeli||0), harga_satuan_snapshot:Number(item.harga_satuan||0), harga_eceran_snapshot:Number(item.harga_eceran!=null?item.harga_eceran:item.harga_satuan||0), isi_per_pack_snapshot:Math.max(1,Number(item.isi_per_pack||1)) };
}

// onlyPurchased dipakai oleh buku kas/LPJ. Halaman belanja tetap memakai
// default false supaya bisa menampilkan estimasi target yang belum dibeli.
function hitungHargaAktualHadiahLomba({onlyPurchased=false}={}){
  const statusMap = onlyPurchased ? new Map(gDaftarBelanjaHadiah().filter(b=>b.status==='dibeli').map(b=>[`${b.hadiah_kategori_id}_${b.item_id}`,b])) : null;
  const items = [];
  gHadiahKategori().forEach(h => {
    h.items.forEach(item => {
      if (Number(item.qty_dibeli||0) <= 0) return;
      const belanja = statusMap && statusMap.get(`${h.id}_${item.id}`);
      if(onlyPurchased && !belanja) return;
      items.push({
        hadiahId: h.id, itemId: item.id, itemNama: item.nama,
        // Baris lama tanpa snapshot tetap kompatibel, tetapi transaksi baru
        // selalu memakai nilai saat statusnya menjadi "dibeli".
        itemHarga: belanja?.harga_satuan_snapshot ?? item.harga_satuan,
        itemHargaEceran: belanja?.harga_eceran_snapshot ?? (item.harga_eceran!=null ? item.harga_eceran : item.harga_satuan),
        itemQtyDibeli: belanja?.qty_snapshot ?? item.qty_dibeli,
        isi_per_pack: belanja?.isi_per_pack_snapshot ?? (item.isi_per_pack||1),
        kategori_peserta: h.kategori_peserta, juara_ke: h.juara_ke
      });
    });
  });

  // Kelompokkan per NAMA barang (gabungan lintas kategori peserta & juara),
  // sama seperti renderBelanjaHadiah, karena harga pack/eceran disepakati
  // per barang, bukan per paket kategori/juara.
  const nameMap = {};
  items.forEach(item => {
    const key = normNamaBarang(item.itemNama);
    if(!nameMap[key]) nameMap[key] = [];
    nameMap[key].push(item);
  });

  let total = 0;
  const perItem = {};
  const perGroup = {};
  Object.entries(nameMap).forEach(([namaKey, listMentah]) => {
    // PENTING (konsistensi lintas halaman): packRef di bawah dipilih via reduce
    // yang, kalau ada beberapa item isi_per_pack-nya SAMA (paling sering: sama-sama
    // masih default 1), jatuh ke item PERTAMA dalam array `list`. Urutan array itu
    // harus SAMA PERSIS dengan urutan yang dipakai renderBelanjaHadiah (sort per
    // kategori_peserta lalu juara_ke) — sebelumnya di sini dibiarkan urutan mentah
    // db.hadiahKategori (urutan tersimpan/dibuat), beda dari renderBelanjaHadiah.
    // Kalau ada item senama dgn harga_satuan BEDA (belum sempat disamakan) dan
    // isi_per_pack sama, packRef yang kepilih bisa beda antara halaman Belanja
    // Hadiah vs Dashboard/Kebutuhan Hadiah/LPJ — total yang tampil jadi tidak
    // konsisten, padahal itu justru tujuan fix Bug #2 di atas.
    const list = listMentah.slice().sort((a,b) => {
      if(a.kategori_peserta !== b.kategori_peserta) return a.kategori_peserta.localeCompare(b.kategori_peserta);
      return a.juara_ke.localeCompare(b.juara_ke);
    });
    const totalQty = list.reduce((s,i)=>s+Number(i.itemQtyDibeli||0),0);
    const packRef = list.reduce((best, cur) => Number(cur.isi_per_pack||1) > Number(best.isi_per_pack||1) ? cur : best, list[0]);
    const isiPerPack = Math.max(1, Number(packRef.isi_per_pack||1));
    const jumlahPackUtuh = isiPerPack > 1 ? Math.floor(totalQty / isiPerPack) : 0;
    const sisaSatuan = isiPerPack > 1 ? totalQty % isiPerPack : 0;
    const hargaPerPcsPack = Number(packRef.itemHarga||0);
    const hargaEceran = Number(packRef.itemHargaEceran!=null ? packRef.itemHargaEceran : hargaPerPcsPack);
    const hargaEceranBeda = isiPerPack > 1 && hargaEceran !== hargaPerPcsPack;
    const totalHarga = isiPerPack > 1
      ? (jumlahPackUtuh * isiPerPack * hargaPerPcsPack) + (sisaSatuan * hargaEceran)
      : totalQty * hargaPerPcsPack;
    total += totalHarga;
    perGroup[namaKey] = {
      totalQty, totalHarga, isiPerPack, jumlahPackUtuh, sisaSatuan,
      hargaPerPcsPack, hargaEceran, hargaEceranBeda
    };

    // Alokasikan totalHarga grup ini proporsional ke tiap item (by qty),
    // supaya rincian per kategori/juara (Kebutuhan Hadiah, LPJ) tetap
    // sinkron dengan total gabungan di Belanja Hadiah, walau barang yang
    // sama dipakai di beberapa paket kategori/juara berbeda.
    // ------------------------------------------------------------
    // PENTING (rounding): subtotal = totalHarga * qty/totalQty dibulatkan
    // SENDIRI-SENDIRI per item kalau langsung dipakai (mis. saat ditampilkan
    // fmtRp, atau dijumlah ulang manual pas cross-check LPJ). Kalau tiap item
    // dibulatkan begitu saja, jumlah seluruh rincian bisa beda beberapa
    // rupiah dari totalHarga grup (klasik masalah pembulatan pembagian
    // proporsional). Jadi di sini dipakai metode "largest remainder": bagi
    // rata dulu (floor), lalu sisa rupiah (dari pembulatan ke bawah semua
    // item) dibagikan satu-satu ke item dengan sisa desimal terbesar —
    // hasilnya SELALU pas, sum(subtotal per item) === Math.round(totalHarga).
    const totalHargaBulat = Math.round(totalHarga);
    if(totalQty <= 0 || totalHargaBulat === 0){
      list.forEach(i => { perItem[`${i.hadiahId}_${i.itemId}`] = { subtotal: 0, hargaEfektif: 0 }; });
    } else {
      const shares = list.map(i => {
        const qty = Number(i.itemQtyDibeli||0);
        const rawShare = totalHargaBulat * (qty / totalQty);
        return { i, qty, rupiah: Math.floor(rawShare), sisaDesimal: rawShare - Math.floor(rawShare) };
      });
      let sisaRupiah = totalHargaBulat - shares.reduce((s,x)=>s+x.rupiah,0);
      shares.slice().sort((a,b)=>b.sisaDesimal-a.sisaDesimal).forEach(x=>{
        if(sisaRupiah>0){ x.rupiah += 1; sisaRupiah--; }
      });
      shares.forEach(x=>{
        perItem[`${x.i.hadiahId}_${x.i.itemId}`] = { subtotal: x.rupiah, hargaEfektif: x.qty > 0 ? x.rupiah / x.qty : 0 };
      });
    }
  });

  return { total, perItem, perGroup };
}

/* ============================================================
   KATEGORI TOKO — pengelompokan otomatis daftar belanja hadiah
   berdasarkan nama item, supaya barang sejenis (alat tulis,
   kebutuhan dapur, makanan, kamar mandi) tidak campur dan bisa
   dibeli sekaligus di satu toko.
   ============================================================ */
const KATEGORI_TOKO_LIST = [
  {key:'alat_tulis', label:'Alat Tulis', icon:'pen'},
  {key:'dapur', label:'Kebutuhan Dapur', icon:'pot'},
  {key:'makanan', label:'Makanan & Jajanan', icon:'food'},
  {key:'kamar_mandi', label:'Kamar Mandi', icon:'bath'},
  {key:'lainnya', label:'Lainnya', icon:'tag'}
];
const KATEGORI_TOKO_KEYWORDS = {
  alat_tulis: ['pulpen','bolpoin','bolpen','pena','pensil','penghapus','penggaris','buku tulis','buku gambar','buku','spidol','crayon','krayon','lem','gunting','kertas hvs','kertas lipat','kertas origami','kertas manila','kertas warna','kertas buffalo','kertas asturo','kertas concord','map plastik',' map','stabilo','tipe-x','tipe x','tip-x','tip x','tipex','rautan','sampul','isolasi','selotip','staples','klip','tinta','stiker','origami','karton','pewarna','cat air','sketchbook'],
  dapur: ['piring','gelas','mangkok','mangkuk','panci','wajan','sendok','garpu','pisau dapur','pisau','termos','toples','ember','gayung','baskom','rantang','teflon','talenan','serbet','kompor','tupperware','kotak makan','nampan','cobek','teko','dispenser','centong','saringan'],
  makanan: ['snack','snek','biskuit','wafer','coklat','cokelat','permen','minyak goreng','minyak','gula pasir','gula','kopi','teh','susu','indomie','mie instan','mie','sarden','kecap','saus','roti','sirup','minuman','air mineral','aqua','beras','telur','kornet','sosis','keju','selai','madu','kacang','kerupuk','chiki','marimas','agar-agar','agar','jelly','jeli','jajan','oreo','tango','richeese','chitato','taro','better','gery','roma','pop mie'],
  kamar_mandi: ['sabun','shampo','sampo','sikat gigi','sikat','odol','pasta gigi','handuk','tissue','tisu','pewangi','pembersih lantai','pembersih','deterjen','detergen','pembalut','cotton bud','parfum','minyak wangi','sunlight','rinso','molto','downy','pengharum','kapas','sandal']
};
function kategoriTokoFromNama(nama){
  const n = ' ' + (nama||'').toLowerCase().trim() + ' ';
  // Batas kata untuk kata kunci kustom: tanda baca (koma, titik, kurung, dst)
  // yang nempel langsung ke kata kuncinya harus dianggap SAMA dengan spasi,
  // supaya "Bola Voli, size 5" tetap ketemu kata kunci "voli" — kalau cuma
  // dibungkus spasi literal seperti `n` di atas, koma yang nempel langsung
  // bikin batas katanya tidak pernah ketemu (bug: kata kunci diam-diam gagal
  // match tanpa error apa pun).
  const nBatas = ' ' + (nama||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,' ').trim() + ' ';
  // 1) Kata kunci kustom yang ditambahkan admin lewat "Kelola Kategori Toko"
  //    dicek LEBIH DULU, supaya admin bisa override kategori bawaan kalau perlu
  //    (mis. "buku" biasanya alat_tulis, tapi admin bisa arahkan ke kategori lain).
  const kustom = (typeof getSettings==='function' ? getSettings().kategoriToko : null) || {};
  const keywordsKustom = kustom.keywords || {};
  for(const kw of Object.keys(keywordsKustom)){
    if(!kw) continue;
    const kwBatas = ' ' + kw.toLowerCase().trim().replace(/[^a-z0-9]+/g,' ').trim() + ' ';
    if(n.includes(' ' + kw.toLowerCase().trim() + ' ') || nBatas.includes(kwBatas)) return keywordsKustom[kw];
  }
  // 2) Kategori & kata kunci bawaan (tetap, tidak bisa diedit lewat UI).
  for(const kat of ['alat_tulis','dapur','makanan','kamar_mandi']){
    if(KATEGORI_TOKO_KEYWORDS[kat].some(kw => n.includes(kw))) return kat;
  }
  return 'lainnya';
}
// Daftar kategori toko LENGKAP: bawaan + kustom milik event aktif (disisipkan
// sebelum "Lainnya" supaya barang yang sudah dikategorikan admin tetap tampil
// terkelompok rapi, bukan di paling bawah).
function daftarKategoriTokoLengkap(){
  const kustom = (typeof getSettings==='function' ? getSettings().kategoriToko : null) || {};
  const customCategories = kustom.customCategories || [];
  const bawaan = KATEGORI_TOKO_LIST.slice(0, -1); // semua kecuali "Lainnya"
  const lainnya = KATEGORI_TOKO_LIST[KATEGORI_TOKO_LIST.length-1];
  return [...bawaan, ...customCategories, lainnya];
}
function infoKategoriToko(key){ return daftarKategoriTokoLengkap().find(k=>k.key===key) || KATEGORI_TOKO_LIST[KATEGORI_TOKO_LIST.length-1]; }

// Ikon yang tersedia untuk kategori toko kustom (dibatasi ke ikon yang sudah
// terdaftar di ICONS map / 05-navigation.js, supaya tidak ada ikon kosong).
const IKON_KATEGORI_TOKO_KUSTOM = ['tag','flag','walk','heart','shopping','shopping-bag','grid','gear','briefcase','book','coins','swap','database','link'];

// Tambah kategori toko kustom baru untuk event aktif (mis. "Alat Olahraga",
// "Dekorasi") supaya barang yang tidak cocok kata kunci bawaan tidak numpuk
// tanpa arti di "Lainnya".
function tambahKategoriTokoKustom(label, icon){
  const lbl = String(label||'').trim();
  if(!lbl){ toast('Nama kategori wajib diisi'); return null; }
  const s = getSettings();
  const key = 'kustom_' + normNamaBarang(lbl).replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') + '_' + Math.random().toString(36).slice(2,6);
  const bawaanDupe = KATEGORI_TOKO_LIST.find(k=>normNamaBarang(k.label)===normNamaBarang(lbl));
  if(bawaanDupe){ toast(`"${bawaanDupe.label}" sudah jadi kategori bawaan, pakai itu saja`); return bawaanDupe.key; }
  const dupe = s.kategoriToko.customCategories.find(k=>normNamaBarang(k.label)===normNamaBarang(lbl));
  if(dupe){ toast(`Kategori "${dupe.label}" sudah ada`); return dupe.key; }
  const cat = {key, label:lbl, icon: IKON_KATEGORI_TOKO_KUSTOM.includes(icon)?icon:'tag'};
  s.kategoriToko.customCategories.push(cat);
  saveDB(); return key;
}
async function hapusKategoriTokoKustom(key){
  const s = getSettings();
  if(!(await confirmModal('Hapus kategori ini? Kata kunci yang mengarah ke kategori ini akan ikut dihapus, barangnya kembali masuk "Lainnya".'))) return;
  s.kategoriToko.customCategories = s.kategoriToko.customCategories.filter(k=>k.key!==key);
  Object.keys(s.kategoriToko.keywords).forEach(kw => { if(s.kategoriToko.keywords[kw]===key) delete s.kategoriToko.keywords[kw]; });
  saveDB(); renderContent(); toast('Kategori dihapus');
  bukaModalKelolaKategoriToko(); // refresh modal ini juga, bukan cuma #content di belakangnya
}
// Tambah/timpa satu kata kunci -> kategori (bawaan atau kustom). Dipakai baik
// dari modal "Kelola Kategori Toko" maupun jalur cepat "Masukkan kategori"
// langsung dari barang yang nangkring di grup "Lainnya".
function tambahKataKunciKategoriToko(kataKunci, kategoriKey){
  const kw = String(kataKunci||'').trim().toLowerCase();
  if(!kw || !kategoriKey){ toast('Kata kunci & kategori wajib diisi'); return; }
  const s = getSettings();
  s.kategoriToko.keywords[kw] = kategoriKey;
  saveDB();
}
function hapusKataKunciKategoriToko(kataKunci){
  const s = getSettings();
  delete s.kategoriToko.keywords[kataKunci];
  saveDB(); renderContent(); toast('Kata kunci dihapus');
  bukaModalKelolaKategoriToko(); // refresh modal ini juga, bukan cuma #content di belakangnya
}

// Opsi <select> kategori (bawaan + kustom, TANPA "Lainnya" — kata kunci baru
// harus diarahkan ke kategori yang berarti, bukan balik ke "Lainnya").
function optionsKategoriTokoHtml(selectedKey){
  return daftarKategoriTokoLengkap().filter(k=>k.key!=='lainnya').map(k =>
    `<option value="${esc(k.key)}" ${k.key===selectedKey?'selected':''}>${esc(k.label)}</option>`
  ).join('') + `<option value="__baru__">+ Buat kategori baru...</option>`;
}
function optionsIkonKategoriTokoHtml(selected){
  return IKON_KATEGORI_TOKO_KUSTOM.map(i => `<option value="${i}" ${i===selected?'selected':''}>${i}</option>`).join('');
}
// Jalur cepat: dipanggil dari tombol "🏷️ Kategori" pada barang di grup "Lainnya".
// Menyamakan kategori barang ini dengan menambahkan nama persisnya sebagai kata
// kunci baru — sekali klik, tanpa harus bolak-balik ke halaman Pengaturan.
function bukaQuickAssignKategoriToko(gi){
  if (!canEditSection('belanja-hadiah')) { toast('⛔ Login untuk mengedit data'); return; }
  const g = window._belanjaHadiahGroups && window._belanjaHadiahGroups[gi];
  if(!g){ toast('Barang tidak ditemukan'); return; }
  setModal(`Kategori toko: "${g.nama}"`, `
    <div class="field">
      <label>Masukkan ke kategori toko</label>
      <select id="qa-kat-select" onchange="document.getElementById('qa-kat-baru-wrap').style.display=(this.value==='__baru__'?'block':'none')">
        ${optionsKategoriTokoHtml(null)}
      </select>
      <div class="hint">Barang lain dengan nama persis sama akan ikut masuk kategori ini juga.</div>
    </div>
    <div class="field" id="qa-kat-baru-wrap" style="display:none;">
      <label>Nama kategori baru</label>
      <input id="qa-kat-baru-label" type="text" placeholder="mis. Alat Olahraga, Dekorasi">
      <label style="margin-top:6px;">Ikon</label>
      <select id="qa-kat-baru-icon">${optionsIkonKategoriTokoHtml('tag')}</select>
    </div>
  `, [
    {label:'Batal', cls:'secondary', onclick: closeModal},
    {label:'Simpan', cls:'', onclick:()=>{
      const sel = document.getElementById('qa-kat-select').value;
      let kategoriKey = sel;
      if(sel === '__baru__'){
        const lbl = document.getElementById('qa-kat-baru-label').value;
        const ic = document.getElementById('qa-kat-baru-icon').value;
        kategoriKey = tambahKategoriTokoKustom(lbl, ic);
        if(!kategoriKey) return; // validasi gagal, modal tetap terbuka
      }
      tambahKataKunciKategoriToko(g.nama, kategoriKey);
      closeModal(); renderContent(); toast(`"${g.nama}" dipindah ke kategori "${infoKategoriToko(kategoriKey).label}"`);
    }}
  ]);
}
// Wrapper baca-input dipanggil lewat data-action dari modal Kelola Kategori Toko
// (lihat bukaModalKelolaKategoriToko) — dipisah dari onclick inline lama supaya
// bisa dimigrasi ke da() tanpa perlu kirim value input lewat data-args.
function tambahKategoriTokoKustomDariInput(){
  const lbl = document.getElementById('kk-cat-label').value;
  const ic = document.getElementById('kk-cat-icon').value;
  if (tambahKategoriTokoKustom(lbl, ic)) {
    document.getElementById('kk-cat-label').value = '';
    bukaModalKelolaKategoriToko();
  }
}
function tambahKataKunciKategoriTokoDariInput(){
  const kw = document.getElementById('kk-kw-text').value;
  const kat = document.getElementById('kk-kw-cat').value;
  if (!kw.trim()) { toast('Kata kunci wajib diisi'); return; }
  tambahKataKunciKategoriToko(kw, kat);
  document.getElementById('kk-kw-text').value = '';
  bukaModalKelolaKategoriToko();
}
// Halaman kelola lengkap: lihat & hapus kategori kustom + kata kunci kustom,
// dan tambah kata kunci baru bebas (tidak harus dari nama barang yang sudah ada).
function bukaModalKelolaKategoriToko(){
  if (!canEditSection('belanja-hadiah')) { toast('⛔ Login untuk mengedit data'); return; }
  const s = getSettings();
  const customCats = s.kategoriToko.customCategories || [];
  const keywords = s.kategoriToko.keywords || {};
  const catRowsHtml = customCats.length ? customCats.map(c => `
    <div class="belanja-subitem">
      <div class="sub-info"><span>${icon(c.icon)} ${esc(c.label)}</span></div>
      <button class="btn-small-icon danger-text" title="Hapus kategori" ${da('hapusKategoriTokoKustom', c.key)}>✕</button>
    </div>`).join('') : `<div class="hint" style="padding:6px 0;">Belum ada kategori kustom.</div>`;
  const kwRowsHtml = Object.keys(keywords).length ? Object.keys(keywords).sort().map(kw => `
    <div class="belanja-subitem">
      <div class="sub-info"><span>"${esc(kw)}" → ${esc(infoKategoriToko(keywords[kw]).label)}</span></div>
      <button class="btn-small-icon danger-text" title="Hapus kata kunci" ${da('hapusKataKunciKategoriToko', kw)}>✕</button>
    </div>`).join('') : `<div class="hint" style="padding:6px 0;">Belum ada kata kunci kustom.</div>`;

  setModal('⚙️ Kelola Kategori Toko', `
    <div class="hint" style="margin-bottom:10px;">Kategori & kata kunci bawaan (alat tulis, dapur, makanan, kamar mandi) tetap ada dan tidak bisa diubah. Di sini kamu cuma menambah kategori/kata kunci BARU khusus event ini (mis. kebutuhan lomba tahun ini beda-beda), supaya barang yang tidak cocok kata kunci bawaan tidak numpuk begitu saja di "Lainnya".</div>

    <div class="field"><label>Kategori kustom</label>${catRowsHtml}</div>
    <div class="field" style="display:flex;gap:6px;align-items:flex-end;">
      <div style="flex:1;"><label>Kategori baru</label><input id="kk-cat-label" type="text" placeholder="mis. Alat Olahraga"></div>
      <div><label>Ikon</label><select id="kk-cat-icon">${optionsIkonKategoriTokoHtml('tag')}</select></div>
      <button class="btn small" ${da('tambahKategoriTokoKustomDariInput')}>+ Tambah</button>
    </div>

    <div class="field" style="margin-top:14px;"><label>Kata kunci kustom</label>${kwRowsHtml}</div>
    <div class="field" style="display:flex;gap:6px;align-items:flex-end;">
      <div style="flex:1;"><label>Kata kunci</label><input id="kk-kw-text" type="text" placeholder="mis. bola voli"></div>
      <div style="flex:1;"><label>Kategori</label><select id="kk-kw-cat">${optionsKategoriTokoHtml(null).replace('<option value="__baru__">+ Buat kategori baru...</option>','')}</select></div>
      <button class="btn small" ${da('tambahKataKunciKategoriTokoDariInput')}>+ Tambah</button>
    </div>
  `, [
    {label:'Tutup', cls:'', onclick:()=>{ closeModal(); renderContent(); }}
  ]);
}

/* ============================================================
   BELANJA HADIAH, BELANJA PERLENGKAPAN, BELANJA JALAN (dengan auth check)
   ============================================================ */
function renderBelanjaHadiah(){
  const semuaHadiah = gHadiahKategori();
  const daftar = gDaftarBelanjaHadiah();
  const statusMap = {};
  daftar.forEach(b => { const key = `${b.hadiah_kategori_id}_${b.item_id}`; statusMap[key] = b; });

  const items = [];
  semuaHadiah.forEach(h => {
    h.items.forEach((item, idx) => {
      if (Number(item.qty_dibeli||0) <= 0) return;
      const key = `${h.id}_${item.id}`;
      const belanja = statusMap[key] || null;
      const status = belanja ? belanja.status : 'belum_dibeli';
      const tanggalBeli = belanja ? belanja.tanggal_beli : null;
      items.push({...h, itemIndex: idx, itemId: item.id, itemNama: item.nama, itemHarga: item.harga_satuan, itemHargaEceran: (item.harga_eceran!=null?item.harga_eceran:item.harga_satuan), itemQtyDibeli: item.qty_dibeli, isi_per_pack: item.isi_per_pack||1, riwayatHarga: item.riwayatHarga||[], status, tanggalBeli, sudahDibeli: status==='dibeli', key});
    });
  });

  items.sort((a,b) => {
    if(a.sudahDibeli !== b.sudahDibeli) return a.sudahDibeli ? 1 : -1;
    if(a.kategori_peserta !== b.kategori_peserta) return a.kategori_peserta.localeCompare(b.kategori_peserta);
    return a.juara_ke.localeCompare(b.juara_ke);
  });

  const isLoggedIn = !!getCurrentUser();

  if(!items.length) return `<div class="belanja-toko-page"><div class="panel"><div class="panel-head"><h3>🎁 Belanja Hadiah</h3></div><div class="panel-body"><div class="empty-state"><h3>Belum ada hadiah</h3>${isLoggedIn ? `<button class="btn" ${da('goSection', 'hadiah')}>+ Tambah Hadiah</button>` : ''}</div></div></div></div>`;

  // Kelompokkan per NAMA barang (gabungan lintas kategori peserta & juara) menjadi SATU checklist
  const nameMap = {};
  items.forEach(item => {
    const key = normNamaBarang(item.itemNama);
    if(!nameMap[key]) nameMap[key] = {nama: item.itemNama, list: []};
    nameMap[key].list.push(item);
  });

  // Lalu kelompokkan per KATEGORI TOKO (alat tulis / dapur / makanan / kamar mandi / lainnya)
  // supaya barang sejenis tidak campur dan bisa dibeli sekaligus di satu toko.
  const kategoriOrder = daftarKategoriTokoLengkap().map(k=>k.key);
  const nameGroups = Object.values(nameMap).map(g => ({...g, kategoriToko: kategoriTokoFromNama(g.nama)})).sort((a,b) => {
    const ordA = kategoriOrder.indexOf(a.kategoriToko), ordB = kategoriOrder.indexOf(b.kategoriToko);
    if(ordA !== ordB) return ordA - ordB;
    const aBelum = a.list.some(i=>!i.sudahDibeli), bBelum = b.list.some(i=>!i.sudahDibeli);
    if(aBelum !== bBelum) return aBelum ? -1 : 1;
    return a.nama.localeCompare(b.nama);
  });

  window._belanjaHadiahGroups = {};
  let lastKategoriToko = null;
  let totalItem = 0, totalBelum = 0;
  // Satu-satunya sumber rumus pack+eceran (lihat Bug #2 & #3 di komentar
  // hitungHargaAktualHadiahLomba, 11-belanja.js) — perGroup dikunci per
  // normNamaBarang(nama), sama seperti nameMap di atas.
  const hadiahAktual = hitungHargaAktualHadiahLomba();
  const totalEstimasi = hadiahAktual.total;
  let totalBelumEstimasi = 0;
  const groups = nameGroups.map((g, gi) => {
    const list = g.list.slice().sort((a,b) => {
      if(a.kategori_peserta !== b.kategori_peserta) return a.kategori_peserta.localeCompare(b.kategori_peserta);
      return a.juara_ke.localeCompare(b.juara_ke);
    });
    window._belanjaHadiahGroups[gi] = {nama: g.nama, refs: list.map(i=>({hadiahId:i.id, itemId:i.itemId}))};

    const semuaDibeli = list.every(i=>i.sudahDibeli);
    const belum = list.filter(i=>!i.sudahDibeli);
    const tglTerbaru = list.filter(i=>i.tanggalBeli).map(i=>i.tanggalBeli).sort().pop();

    totalItem++;
    if(!semuaDibeli) totalBelum++;

    // Breakdown pack/eceran grup ini diambil dari hadiahAktual.perGroup (bukan
    // dihitung ulang di sini) supaya angka yang tampil di Belanja Hadiah SELALU
    // identik dengan Dashboard/Kebutuhan Hadiah/LPJ, yang sama-sama memakai
    // hitungHargaAktualHadiahLomba(). Fallback nol dipakai kalau kunci ternyata
    // tidak ada (seharusnya tidak pernah terjadi karena nameMap di sini &
    // di hitungHargaAktualHadiahLomba dibangun dari item qty_dibeli>0 yang sama).
    const namaKey = normNamaBarang(g.nama);
    const grp = hadiahAktual.perGroup[namaKey] || {totalQty:0, totalHarga:0, isiPerPack:1, jumlahPackUtuh:0, sisaSatuan:0, hargaPerPcsPack:0, hargaEceran:0, hargaEceranBeda:false};
    const {totalQty, totalHarga, isiPerPack, jumlahPackUtuh, sisaSatuan, hargaPerPcsPack, hargaEceran, hargaEceranBeda} = grp;

    // PENTING (konsistensi pembulatan — kelas bug yang sama dengan Bug #2/#3):
    // dulu di sini dipakai rumus proporsional mentah sendiri
    // (totalHarga * belumQty/totalQty), BUKAN alokasi per-item yang sudah
    // dibulatkan lewat metode "largest remainder" di hadiahAktual.perItem.
    // Akibatnya "Belum dibeli: Rp ..." bisa beda beberapa rupiah dari
    // (Estimasi Total - yang sudah dibeli), padahal hadiahAktual.perItem
    // sudah dijamin sum(subtotal per item) === Math.round(totalHarga grup)
    // (lihat komentar largest remainder di hitungHargaAktualHadiahLomba).
    // Sekarang dijumlah langsung dari alokasi.subtotal item yang belum
    // dibeli, supaya SELALU konsisten dengan totalEstimasi & rincian lain.
    totalBelumEstimasi += belum.reduce((s,i) => {
      const alokasi = hadiahAktual.perItem[`${i.hadiahId}_${i.itemId}`];
      return s + (alokasi ? alokasi.subtotal : 0);
    }, 0);

    const tagHtml = list.map(item => {
      // Hadiah non-partisipasi digabung dari SEMUA lomba dgn kategori_peserta yang sama
      // (lihat hitungKebutuhanHadiah di 10-lomba.js), jadi qty di sini bukan utk 1 lomba
      // saja. Tambahkan info jumlah lomba biar user tahu kenapa qty-nya sebesar itu.
      const jumlahLomba = item.juara_ke !== 'partisipasi' ? gLomba().filter(l=>l.kategori_peserta===item.kategori_peserta).length : 0;
      const lombaInfo = jumlahLomba > 1 ? ` <span style="opacity:.65;">(gabungan ${jumlahLomba} lomba)</span>` : '';
      return `<span class="tag">Kategori: ${labelPeserta(item.kategori_peserta)} · ${labelJuara(item.juara_ke)} · ${item.itemQtyDibeli} pcs${lombaInfo}</span>`;
    }).join('');
    const packTagHtml = jumlahPackUtuh > 0
      ? `<span class="tag pack-tag">📦 Beli ${jumlahPackUtuh} pack (isi ${isiPerPack}${hargaEceranBeda?`, ${fmtRp(hargaPerPcsPack*isiPerPack)}/pack`:''})${sisaSatuan>0?` + ${sisaSatuan} pcs satuan${hargaEceranBeda?` @${fmtRp(hargaEceran)}`:''}`:''} → ${totalQty} pcs</span>`
      : (isiPerPack > 1 ? `<span class="tag pack-tag">📦 Beli ${sisaSatuan} pcs satuan${hargaEceranBeda?` @${fmtRp(hargaEceran)}`:''} (kurang dari 1 pack isi ${isiPerPack})</span>` : '');

    // Header kategori toko, muncul setiap kali kategori berganti
    let headerHtml = '';
    if(g.kategoriToko !== lastKategoriToko){
      lastKategoriToko = g.kategoriToko;
      const info = infoKategoriToko(g.kategoriToko);
      const groupItemCount = nameGroups.filter(x=>x.kategoriToko===g.kategoriToko).length;
      headerHtml = `<div class="kategori-toko-header"><div class="kategori-toko-icon">${icon(info.icon)}</div><div class="kategori-toko-label">${esc(info.label)}</div><div class="kategori-toko-count">${groupItemCount} item</div></div>`;
    }

    return `${headerHtml}<div class="belanja-item ${semuaDibeli?'dibeli':''}">
      <span class="nomor-urut">${totalItem}</span>
      <div class="checkbox-wrapper ${semuaDibeli?'checked':''} ${!isLoggedIn ? 'disabled' : ''}" ${isLoggedIn ? da('toggleBelanjaHadiahGroup', gi) : da('toast', '⛔ Login untuk mengedit')}></div>
      <div class="info">
        <div class="nama"><span class="nama-text">${esc(g.nama)}</span><span class="qty-total">(Total: ${totalQty} pcs)</span></div>
        <div class="detail">${packTagHtml}${tagHtml}${semuaDibeli&&tglTerbaru?`<span>✓ Dibeli: ${fmtDate(tglTerbaru)}</span>`:(belum.length && belum.length<list.length ? `<span style="color:var(--orange);">Sebagian belum (${belum.length}/${list.length})</span>` : '')}</div>
      </div>
      <div class="harga" style="display:flex; align-items:center; gap:4px;">
        <span>${fmtRp(totalHarga)}</span>
        ${g.kategoriToko==='lainnya' ? `<button class="btn-small-icon" title="Barang ini masuk 'Lainnya' — klik untuk pindahkan ke kategori toko lain" ${isLoggedIn ? da('bukaQuickAssignKategoriToko', gi) : da('toast', '⛔ Login untuk mengedit')} ${!isLoggedIn ? 'disabled' : ''}>${icon('tag')}</button>` : ''}
        ${list.some(i=>(i.riwayatHarga||[]).length) ? `<button class="btn-small-icon" title="Riwayat perubahan harga" ${da('bukaRiwayatHargaBarang', gi)}>${icon('report')}</button>` : ''}
        <button class="btn-small-icon" title="Update harga & kemasan" ${isLoggedIn ? da('editHargaBelanjaHadiahGroup', gi) : da('toast', '⛔ Login untuk mengedit')} ${!isLoggedIn ? 'disabled' : ''}>${icon('pen')}</button>
      </div>
    </div>`;
  }).join('');

  return `<div class="belanja-toko-page"><div class="stat-grid"><div class="stat-card belanja-hadiah"><div class="lbl">Total Item</div><div class="val">${totalItem}</div></div><div class="stat-card pemasukan"><div class="lbl">Belum Dibeli</div><div class="val">${totalBelum}</div></div><div class="stat-card saldo"><div class="lbl">Estimasi Total</div><div class="val">${fmtRp(totalEstimasi)}</div></div>${progressBelanjaCardHtml(totalItem, totalItem-totalBelum)}</div>
  <div class="panel"><div class="panel-head"><div><h3>🎁 Daftar Belanja Hadiah</h3><div class="desc">Belum dibeli: <strong>${fmtRp(totalBelumEstimasi)}</strong></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn success small" ${da('tandaiSemuaBelanjaHadiah')} ${!isLoggedIn ? 'disabled' : ''}>✓ Semua Dibeli</button>
      <button class="btn secondary small" ${da('resetSemuaBelanjaHadiah')} ${!isLoggedIn ? 'disabled' : ''}>↺ Reset</button>
      <button class="btn secondary small" ${da('bukaModalKelolaKategoriToko')} ${!isLoggedIn ? 'disabled' : ''}>⚙️ Kelola Kategori Toko</button>
    </div></div>
  <div class="panel-body">${groups}</div></div></div>`;
}

function toggleBelanjaHadiah(hadiahId, itemId){
  if (!canEditSection('belanja-hadiah')) { toast('⛔ Login untuk mengedit data'); return; }
  const h = db.hadiahKategori.find(x=>x.id===hadiahId);
  const item = h && h.items.find(it=>it.id===itemId);
  if(!item) { toast('Item tidak ditemukan'); return; }
  let existing = db.daftarBelanjaHadiah.find(b => b.hadiah_kategori_id === hadiahId && b.item_id === itemId && b.event_id === eid());
  let actionMsg = '';
  if (existing) {
    if (existing.status === 'dibeli') { 
      existing.status = 'belum_dibeli'; existing.tanggal_beli = null; 
      actionMsg = `↩️ Belanja hadiah dibatalkan: ${item.nama}`;
      toast(`"${item.nama}" → belum dibeli`); 
    }
    else { 
      existing.status = 'dibeli'; existing.tanggal_beli = todayISO(); Object.assign(existing, snapshotBelanjaHadiah(item));
      actionMsg = `✅ Belanja hadiah DIBELI: ${item.nama}`;
      toast(`✓ "${item.nama}" dibeli`); 
    }
  } else {
    db.daftarBelanjaHadiah.push({id:uid(), event_id:eid(), hadiah_kategori_id:hadiahId, item_id:itemId, status:'dibeli', tanggal_beli:todayISO(), ...snapshotBelanjaHadiah(item)});
    actionMsg = `✅ Belanja hadiah DIBELI: ${item.nama}`;
    toast(`✓ "${item.nama}" dibeli`);
  }
  saveDB(); renderContent(); renderTopbarSaldo();
  if(actionMsg) notifyTelegram(actionMsg, `Paket: ${labelPeserta(h.kategori_peserta)} - ${labelJuara(h.juara_ke)}\nQty: ${item.qty_dibeli}\nHarga: ${fmtRp(item.harga_satuan)}`, 'belanja');
}
async function toggleBelanjaHadiahGroup(gi){
  if (!canEditSection('belanja-hadiah')) { toast('⛔ Login untuk mengedit data'); return; }
  const group = (window._belanjaHadiahGroups||{})[gi];
  if(!group || !group.refs.length){ toast('Item tidak ditemukan'); return; }
  const semuaDibeli = group.refs.every(r => {
    const existing = db.daftarBelanjaHadiah.find(b=>b.hadiah_kategori_id===r.hadiahId && b.item_id===r.itemId && b.event_id===eid());
    return existing && existing.status === 'dibeli';
  });
  const newStatus = semuaDibeli ? 'belum_dibeli' : 'dibeli';
  const tgl = newStatus === 'dibeli' ? todayISO() : null;
  const detail = [];
  group.refs.forEach(r => {
    const h = db.hadiahKategori.find(x=>x.id===r.hadiahId);
    if(!h || !h.items.find(it=>it.id===r.itemId)) return;
    let existing = db.daftarBelanjaHadiah.find(b=>b.hadiah_kategori_id===r.hadiahId && b.item_id===r.itemId && b.event_id===eid());
    const item = h.items.find(it=>it.id===r.itemId);
    if(existing){ existing.status = newStatus; existing.tanggal_beli = tgl; if(newStatus==='dibeli') Object.assign(existing, snapshotBelanjaHadiah(item)); }
    else { db.daftarBelanjaHadiah.push({id:uid(), event_id:eid(), hadiah_kategori_id:r.hadiahId, item_id:r.itemId, status:newStatus, tanggal_beli:tgl, ...(newStatus==='dibeli'?snapshotBelanjaHadiah(item):{})}); }
    detail.push(`${labelPeserta(h.kategori_peserta)} - ${labelJuara(h.juara_ke)}`);
  });
  saveDB(); renderContent(); renderTopbarSaldo();
  if(newStatus==='dibeli'){
    toast(`✓ "${group.nama}" dibeli (semua juara)`);
    notifyTelegram(`✅ Belanja hadiah DIBELI: ${group.nama}`, detail.join('\n'), 'belanja');
  } else {
    toast(`"${group.nama}" → belum dibeli`);
    notifyTelegram(`↩️ Belanja hadiah dibatalkan: ${group.nama}`, detail.join('\n'), 'belanja');
  }
}
async function editHargaBelanjaHadiahGroup(gi){
  if (!canEditSection('belanja-hadiah')) { toast('⛔ Login untuk mengedit data'); return; }
  const group = (window._belanjaHadiahGroups||{})[gi];
  if(!group || !group.refs.length){ toast('Item tidak ditemukan'); return; }
  // Acuan nilai "sekarang" = item dengan isi_per_pack TERBESAR di grup ini (sama
  // seperti packRef di renderBelanjaHadiah/hitungHargaAktualHadiahLomba), BUKAN
  // refs[0] apa adanya. refs diurutkan per kategori+juara, bukan per kapan item
  // ditambahkan — kalau item baru bernama sama (isi_per_pack masih default 1,
  // harga masih 0) kebetulan jatuh di urutan pertama, form ini akan menampilkan
  // "isi 1 / harga Rp0" sebagai nilai sekarang padahal grup ini sudah dikonfigurasi
  // pack di item lain, berisiko admin tanpa sadar menimpa konfigurasi yang benar.
  const refItems = group.refs.map(r => {
    const h = db.hadiahKategori.find(x=>x.id===r.hadiahId);
    return h ? h.items.find(it=>it.id===r.itemId) : null;
  }).filter(Boolean);
  if(!refItems.length){ toast('Item tidak ditemukan'); return; }
  const refItem = refItems.reduce((best, cur) => Number(cur.isi_per_pack||1) > Number(best.isi_per_pack||1) ? cur : best, refItems[0]);

  const isiSekarang = Math.max(1, Number(refItem.isi_per_pack||1));
  const isiInput = await promptModal({
    title: `"${group.nama}"`,
    label: 'Dijual isi berapa per pack?',
    hint: 'Ini soal kemasan di TOKO (bukan "paket hadiah" per pemenang). Isi 1 kalau dijual satuan/bijian, isi 12 kalau 1 pack toko = 12 pcs, dst.',
    defaultValue: isiSekarang, type:'number'
  });
  if(isiInput===null) return;
  const isiPerPack = Math.max(1, Number(String(isiInput).replace(/[^0-9]/g,''))||1);

  const hargaSatuanSekarang = Number(refItem.harga_satuan||0);
  const isPack = isiPerPack > 1;
  const labelHarga = isPack ? `Harga per PACK (isi ${isiPerPack} pcs)` : 'Harga per pcs (satuan)';
  const defaultHargaInput = isPack ? hargaSatuanSekarang * isiPerPack : hargaSatuanSekarang;
  const hargaInput = await promptModal({
    title: `"${group.nama}"`,
    label: `${labelHarga} (Rp)`,
    defaultValue: defaultHargaInput, type:'currency'
  });
  if(hargaInput===null) return;
  const hargaMasuk = Number(hargaInput)||0;
  if(!(hargaMasuk >= 0)){ toast('Harga tidak valid'); return; }
  const hargaSatuanBaru = isPack ? Math.round(hargaMasuk / isiPerPack) : hargaMasuk;

  // Kalau dijual per pack, tanya juga harga satuan/eceran (buat sisa pcs yang tidak
  // genap 1 pack) — bisa beda dari hasil bagi harga pack, biasanya lebih mahal.
  let hargaEceranBaru = hargaSatuanBaru;
  if(isPack){
    const eceranSekarang = refItem.harga_eceran!=null ? refItem.harga_eceran : hargaSatuanBaru;
    const eceranInput = await promptModal({
      title: `"${group.nama}"`,
      label: 'Harga per pcs kalau beli SATUAN/eceran (Rp)',
      hint: `Sisa yang tidak genap 1 pack. Isi sama dengan ${fmtRp(hargaSatuanBaru)} kalau harganya nggak beda.`,
      defaultValue: eceranSekarang, type:'currency'
    });
    if(eceranInput===null) return;
    const eceranMasuk = Number(eceranInput)||0;
    if(eceranMasuk >= 0) hargaEceranBaru = eceranMasuk;
  }

  // Grup ini digabung cuma berdasarkan NAMA barang, lintas kategori peserta & juara
  // (lihat renderBelanjaHadiah). Kalau ternyata item-item di dalamnya SUDAH punya
  // harga_satuan berbeda-beda (mis. sengaja dibedakan kualitas antar kategori, tapi
  // kebetulan nama itemnya sama persis), update ini akan menyamakan semuanya ke satu
  // harga baru — perlu konfirmasi eksplisit dulu supaya tidak silently menghapus
  // perbedaan itu tanpa disadari.
  const hargaSebelumSet = new Set();
  const rincianSebelum = [];
  group.refs.forEach(r => {
    const h = db.hadiahKategori.find(x=>x.id===r.hadiahId);
    const item = h && h.items.find(it=>it.id===r.itemId);
    if(item){
      hargaSebelumSet.add(Number(item.harga_satuan||0));
      rincianSebelum.push(`${labelPeserta(h.kategori_peserta)} - ${labelJuara(h.juara_ke)}: ${fmtRp(item.harga_satuan||0)}/pcs`);
    }
  });
  if(hargaSebelumSet.size > 1){
    const lanjut = await confirmModal(`⚠️ "${group.nama}" saat ini punya harga BERBEDA di tiap paket (mungkin sengaja dibedakan):\n\n${rincianSebelum.join('\n')}\n\nMelanjutkan akan MENYAMAKAN semua ke satu harga baru. Yakin lanjut?`);
    if(!lanjut){ toast('Dibatalkan, harga tidak diubah'); return; }
  }

  // Kalau ada item di grup ini yang statusnya SUDAH "dibeli" di checklist, harga baru
  // ini akan mengubah retroaktif semua perhitungan (Dashboard, LPJ, total belanja)
  // yang sudah mengandalkan harga lama — termasuk kalau nota aslinya sudah tidak ada
  // lagi untuk dicek ulang. Tampilkan dulu harga LAMA vs BARU eksplisit di sini
  // supaya salah ketik ketahuan SEBELUM tersimpan (bukan cuma dari riwayat sesudahnya).
  const sudahDibeliRefs = group.refs.filter(r => isItemHadiahSudahDibeli(r.hadiahId, r.itemId));
  if(sudahDibeliRefs.length){
    const lanjut = await confirmModal(`⚠️ "${group.nama}" SUDAH dicentang dibeli di checklist (${sudahDibeliRefs.length} paket).\n\nHarga lama: ${fmtRp(hargaSatuanSekarang)}/pcs\nHarga baru: ${fmtRp(hargaSatuanBaru)}/pcs\n\nMengubah harga di sini akan menimpa angka yang sudah dipakai di Dashboard & LPJ. Cek dulu apakah angka barunya benar (sesuai nota asli), bukan salah ketik — perubahan ini akan tercatat di riwayat harga. Lanjutkan?`);
    if(!lanjut){ toast('Dibatalkan, harga tidak diubah'); return; }
  }

  let count = 0, totalQty = 0;
  const waktuUbah = new Date().toISOString();
  const olehSiapa = (getCurrentUser() && getCurrentUser().name) || 'Tidak diketahui';
  group.refs.forEach(r => {
    const h = db.hadiahKategori.find(x=>x.id===r.hadiahId);
    const item = h && h.items.find(it=>it.id===r.itemId);
    if(item){
      const hargaSatuanLama = Number(item.harga_satuan||0), hargaEceranLama = Number(item.harga_eceran!=null?item.harga_eceran:item.harga_satuan||0), isiPerPackLama = Number(item.isi_per_pack||1);
      // Cuma dicatat kalau memang ada yang berubah — supaya riwayat tidak numpuk entry
      // kosong tiap kali admin buka & Simpan tanpa mengubah angka.
      if(hargaSatuanLama!==hargaSatuanBaru || hargaEceranLama!==hargaEceranBaru || isiPerPackLama!==isiPerPack){
        if(!Array.isArray(item.riwayatHarga)) item.riwayatHarga = [];
        item.riwayatHarga.push({
          waktu: waktuUbah, oleh: olehSiapa,
          sudahDibeliSaatDiubah: isItemHadiahSudahDibeli(r.hadiahId, r.itemId),
          harga_satuan_lama: hargaSatuanLama, harga_satuan_baru: hargaSatuanBaru,
          harga_eceran_lama: hargaEceranLama, harga_eceran_baru: hargaEceranBaru,
          isi_per_pack_lama: isiPerPackLama, isi_per_pack_baru: isiPerPack,
        });
      }
      item.harga_satuan = hargaSatuanBaru;
      item.isi_per_pack = isiPerPack;
      item.harga_eceran = hargaEceranBaru;
      totalQty += Number(item.qty_dibeli||0);
      count++;
    }
  });
  saveDB(); renderContent(); renderTopbarSaldo();

  if(isPack){
    const jumlahPackUtuh = Math.floor(totalQty / isiPerPack);
    const sisaSatuan = totalQty % isiPerPack;
    const eceranBeda = hargaEceranBaru !== hargaSatuanBaru;
    const rincianBeli = jumlahPackUtuh > 0
      ? `${jumlahPackUtuh} pack${sisaSatuan>0?` + ${sisaSatuan} pcs satuan${eceranBeda?` @${fmtRp(hargaEceranBaru)}`:''}`:''}`
      : `${sisaSatuan} pcs satuan${eceranBeda?` @${fmtRp(hargaEceranBaru)}`:''}`;
    toast(`✓ "${group.nama}": beli ${rincianBeli} (isi ${isiPerPack}/pack) — Rp${fmtRp(hargaSatuanBaru)}/pcs${eceranBeda?`, eceran Rp${fmtRp(hargaEceranBaru)}/pcs`:''}`);
    notifyTelegram(`✏️ Update kemasan & harga belanja hadiah: ${group.nama}`, `Isi per pack: ${isiPerPack}\nHarga per pack: ${fmtRp(hargaMasuk)} (≈ ${fmtRp(hargaSatuanBaru)}/pcs)${eceranBeda?`\nHarga eceran/satuan: ${fmtRp(hargaEceranBaru)}/pcs`:''}\nKebutuhan: ${totalQty} pcs → beli ${rincianBeli}`, 'belanja');
  } else {
    toast(`✓ Harga "${group.nama}" diupdate ke ${fmtRp(hargaSatuanBaru)}/pcs (${count} paket)`);
    notifyTelegram(`✏️ Update harga belanja hadiah: ${group.nama}`, `Harga satuan baru: ${fmtRp(hargaSatuanBaru)}\nDiterapkan ke ${count} paket`, 'belanja');
  }
}
// Riwayat perubahan harga/kemasan — dicatat otomatis di editHargaBelanjaHadiahGroup
// tiap kali harga_satuan/harga_eceran/isi_per_pack benar-benar berubah (lihat
// item.riwayatHarga). Ditampilkan di sini supaya kalau ada harga yang kelihatan
// janggal (atau dicurigai salah ketik), panitia bisa cek angka LAMA-nya tanpa
// harus mengandalkan nota fisik yang mungkin sudah hilang.
function bukaRiwayatHargaBarang(gi){
  const group = (window._belanjaHadiahGroups||{})[gi];
  if(!group || !group.refs.length){ toast('Item tidak ditemukan'); return; }
  const entries = [];
  group.refs.forEach(r => {
    const h = db.hadiahKategori.find(x=>x.id===r.hadiahId);
    const item = h && h.items.find(it=>it.id===r.itemId);
    if(item && Array.isArray(item.riwayatHarga)){
      item.riwayatHarga.forEach(riw => entries.push({...riw, paket: `${labelPeserta(h.kategori_peserta)} - ${labelJuara(h.juara_ke)}`}));
    }
  });
  entries.sort((a,b) => (b.waktu||'').localeCompare(a.waktu||''));
  const rowsHtml = entries.length ? entries.map(e => `
    <div class="belanja-subitem">
      <div class="sub-info">
        <span>${fmtDate((e.waktu||'').slice(0,10))} · ${esc(e.oleh||'-')} · ${esc(e.paket)}${e.sudahDibeliSaatDiubah?' · <span style="color:var(--orange);">sudah dibeli saat diubah</span>':''}</span>
        <span class="sub-qty">${fmtRp(e.harga_satuan_lama)} → ${fmtRp(e.harga_satuan_baru)}/pcs${e.harga_eceran_lama!==e.harga_eceran_baru?` · eceran ${fmtRp(e.harga_eceran_lama)} → ${fmtRp(e.harga_eceran_baru)}`:''}${e.isi_per_pack_lama!==e.isi_per_pack_baru?` · isi/pack ${e.isi_per_pack_lama} → ${e.isi_per_pack_baru}`:''}</span>
      </div>
    </div>`).join('') : `<div class="hint" style="padding:6px 0;">Belum ada riwayat perubahan harga.</div>`;
  setModal(`🕘 Riwayat Harga: "${group.nama}"`, `<div class="belanja-subitem-list">${rowsHtml}</div>`, [
    {label:'Tutup', cls:'', onclick: closeModal}
  ]);
}
function tandaiSemuaBelanjaHadiah(){ 
  if (!canEditSection('belanja-hadiah')) { toast('⛔ Login untuk mengedit data'); return; }
  const hadiahList=gHadiahKategori(); let count=0; let detail = [];
  hadiahList.forEach(h=>{h.items.forEach((item)=>{if(Number(item.qty_dibeli||0)<=0)return; const existing=db.daftarBelanjaHadiah.find(b=>b.hadiah_kategori_id===h.id&&b.item_id===item.id&&b.event_id===eid()); if(!existing||existing.status!=='dibeli'){if(existing){existing.status='dibeli';existing.tanggal_beli=todayISO();}else{db.daftarBelanjaHadiah.push({id:uid(),event_id:eid(),hadiah_kategori_id:h.id,item_id:item.id,status:'dibeli',tanggal_beli:todayISO()});}count++;detail.push(`${item.nama} (${labelPeserta(h.kategori_peserta)})`);}});}); 
  if(count===0){toast('Semua sudah dibeli');}else{saveDB();renderContent();renderTopbarSaldo();toast(`✓ ${count} item dibeli`);
  notifyTelegram(`✅ ${count} item hadiah lomba DIBELI`, detail.join('\n'), 'belanja');} }
async function resetSemuaBelanjaHadiah(){ 
  if (!canEditSection('belanja-hadiah')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!(await confirmModal('Reset semua status?'))) return; 
  const list=gDaftarBelanjaHadiah(); 
  list.forEach(b=>{b.status='belum_dibeli';b.tanggal_beli=null;}); 
  saveDB(); renderContent(); toast('Reset'); 
  notifyTelegram(`↩️ Reset semua status belanja hadiah`, `Semua status dikembalikan ke "belum dibeli"`, 'belanja');
}
// Grup barang di Daftar Belanja Perlengkapan yang sedang dibuka rinciannya (expand),
// supaya status "sebagian dibeli" bisa ditandai per lomba tanpa pindah menu.
// Dikunci pakai nama barang (bukan index) karena urutan grup bisa berubah tiap render.
let openBelanjaPerlengkapanGroups = new Set();
function toggleBelanjaPerlengkapanGroupExpand(groupKey){
  openBelanjaPerlengkapanGroups.has(groupKey) ? openBelanjaPerlengkapanGroups.delete(groupKey) : openBelanjaPerlengkapanGroups.add(groupKey);
  renderContent();
}
function renderBelanjaPerlengkapan(){
  const semuaKebutuhan = [];
  gLomba().forEach(l => { gKebutuhan(l.id).forEach(k => { semuaKebutuhan.push({...k, lombaNama: l.nama, lombaKategori: l.kategori_peserta}); }); });
  const daftar = gDaftarBelanjaPerlengkapan();
  const statusMap = {}; daftar.forEach(b => { statusMap[b.kebutuhan_id] = b; });

  const items = semuaKebutuhan.map(k => {
    const belanja = statusMap[k.id] || null;
    const status = belanja ? belanja.status : 'belum_dibeli';
    const harga = Number(k.harga_realisasi ?? k.harga_estimasi ?? 0);
    return {...k, status, tanggalBeli: belanja?.tanggal_beli, sudahDibeli: status==='dibeli', hargaTotal: harga * Number(k.qty||0)};
  });
  items.sort((a,b) => { if(a.sudahDibeli!==b.sudahDibeli) return a.sudahDibeli?1:-1; return a.lombaNama.localeCompare(b.lombaNama); });

  const totalItem = items.length, totalBelum = items.filter(i=>!i.sudahDibeli).length, totalEstimasi = items.reduce((s,i)=>s+i.hargaTotal,0), totalBelumEstimasi = items.filter(i=>!i.sudahDibeli).reduce((s,i)=>s+i.hargaTotal,0);
  const isLoggedIn = !!getCurrentUser();
  
  if(!items.length) return `<div class="belanja-toko-page"><div class="panel"><div class="panel-head"><h3>📦 Belanja Perlengkapan</h3></div><div class="panel-body"><div class="empty-state"><h3>Belum ada perlengkapan</h3>${isLoggedIn ? `<button class="btn" ${da('goSection', 'lomba')}>+ Tambah Kebutuhan</button>` : ''}</div></div></div></div>`;

  // Kelompokkan per NAMA barang (gabungan lintas lomba), total kebutuhan digabung, detail per lomba tetap ada
  const nameMap = {};
  items.forEach(item => {
    const key = normNamaBarang(item.nama_item);
    if(!nameMap[key]) nameMap[key] = {nama: item.nama_item, list: []};
    nameMap[key].list.push(item);
  });
  const nameGroups = Object.values(nameMap).sort((a,b) => {
    const aBelum = a.list.some(i=>!i.sudahDibeli), bBelum = b.list.some(i=>!i.sudahDibeli);
    if(aBelum !== bBelum) return aBelum ? -1 : 1;
    return a.nama.localeCompare(b.nama);
  });

  window._belanjaPerlengkapanGroups = {};
  const groupHtml = nameGroups.map((g, gi) => {
    const groupItems = g.list.slice().sort((a,b) => a.lombaNama.localeCompare(b.lombaNama));
    window._belanjaPerlengkapanGroups[gi] = {nama: g.nama, refs: groupItems.map(i=>i.id)};

    const totalQty = groupItems.reduce((s,i)=>s+Number(i.qty||0),0);
    const totalHarga = groupItems.reduce((s,i)=>s+i.hargaTotal,0);
    const semuaDibeli = groupItems.every(i=>i.sudahDibeli);
    const groupBelum = groupItems.filter(i=>!i.sudahDibeli);
    const tglTerbaru = groupItems.filter(i=>i.tanggalBeli).map(i=>i.tanggalBeli).sort().pop();

    // Grup dengan >1 lomba bisa di-expand untuk menandai status beli per lomba
    // secara terpisah (dulu ini cuma bisa dilakukan dari menu Lomba).
    const groupKey = normNamaBarang(g.nama);
    const isMulti = groupItems.length > 1;
    const isExpanded = isMulti && openBelanjaPerlengkapanGroups.has(groupKey);

    const tagHtml = groupItems.map(item => `<span class="tag tag-orange">📋 ${esc(item.lombaNama)} · ${labelPeserta(item.lombaKategori)} · ${item.qty}</span>`).join('');

    const subRows = !isExpanded ? '' : `<div class="belanja-subitem-list">${groupItems.map(item => `
      <div class="belanja-subitem ${item.sudahDibeli?'dibeli':''}">
        <div class="checkbox-wrapper small ${item.sudahDibeli?'checked':''} ${!isLoggedIn ? 'disabled' : ''}" ${isLoggedIn ? da('toggleBelanjaPerlengkapan', item.id) : da('toast', '⛔ Login untuk mengedit')}></div>
        <div class="sub-info">
          <span>📋 ${esc(item.lombaNama)} · ${labelPeserta(item.lombaKategori)}</span>
          <span class="sub-qty">${item.qty} · ${fmtRp(item.hargaTotal)}</span>
        </div>
        <button class="btn-small-icon" title="Edit item" ${isLoggedIn ? da('editBelanjaPerlengkapan', item.id) : da('toast', '⛔ Login untuk mengedit')} ${!isLoggedIn ? 'disabled' : ''}>${icon('pen')}</button>
      </div>`).join('')}</div>`;

    return `<div class="belanja-item ${semuaDibeli?'dibeli':''}">
      <span class="nomor-urut">${gi+1}</span>
      <div class="checkbox-wrapper ${semuaDibeli?'checked':''} ${!isLoggedIn ? 'disabled' : ''}" ${isLoggedIn ? da('toggleBelanjaPerlengkapanGroup', gi) : da('toast', '⛔ Login untuk mengedit')}></div>
      <div class="info">
        <div class="nama"><span class="nama-text">${esc(g.nama)}</span><span class="qty-total">(Total: ${totalQty})</span>${isMulti ? `<button type="button" class="expand-toggle" title="${isExpanded?'Tutup rincian per lomba':'Buka rincian per lomba'}" ${da('toggleBelanjaPerlengkapanGroupExpand', groupKey)}>${isExpanded?'▲ Tutup':'▼ Rincian'}</button>` : ''}</div>
        <div class="detail">${!isExpanded ? tagHtml : ''}${semuaDibeli&&tglTerbaru?`<span>✓ Dibeli: ${fmtDate(tglTerbaru)}</span>`:(groupBelum.length && groupBelum.length<groupItems.length ? `<span style="color:var(--orange);">Sebagian belum (${groupBelum.length}/${groupItems.length})</span>` : '')}</div>
        ${subRows}
      </div>
      <div class="harga" style="display:flex; align-items:center; gap:4px;">
        <span>${fmtRp(totalHarga)}</span>
        ${!isMulti ? `<button class="btn-small-icon" title="Edit item" ${isLoggedIn ? da('editBelanjaPerlengkapan', groupItems[0].id) : da('toast', '⛔ Login untuk mengedit')} ${!isLoggedIn ? 'disabled' : ''}>${icon('pen')}</button>` : ''}
      </div>
    </div>`;
  }).join('');

  return `<div class="belanja-toko-page"><div class="stat-grid"><div class="stat-card belanja-perlengkapan"><div class="lbl">Total Item</div><div class="val">${totalItem}</div></div><div class="stat-card pemasukan"><div class="lbl">Belum Dibeli</div><div class="val">${totalBelum}</div></div><div class="stat-card saldo"><div class="lbl">Estimasi Total</div><div class="val">${fmtRp(totalEstimasi)}</div></div>${progressBelanjaCardHtml(totalItem, totalItem-totalBelum)}</div>
  <div class="panel"><div class="panel-head"><div><h3>📦 Daftar Belanja Perlengkapan</h3><div class="desc">Belum dibeli: <strong>${fmtRp(totalBelumEstimasi)}</strong></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn success small" ${da('tandaiSemuaBelanjaPerlengkapan')} ${!isLoggedIn ? 'disabled' : ''}>✓ Semua Dibeli</button>
      <button class="btn secondary small" ${da('resetSemuaBelanjaPerlengkapan')} ${!isLoggedIn ? 'disabled' : ''}>↺ Reset</button>
    </div></div>
  <div class="panel-body">${groupHtml}</div></div></div>`;
}

function toggleBelanjaPerlengkapan(kebutuhanId, belanjaId){
  if (!canEditSection('belanja-perlengkapan')) { toast('⛔ Login untuk mengedit data'); return; }
  const k = db.lombaKebutuhan.find(x=>x.id===kebutuhanId);
  if(!k) { toast('Item tidak ditemukan'); return; }
  let existing = db.daftarBelanjaPerlengkapan.find(b => b.kebutuhan_id === kebutuhanId && b.event_id === eid());
  let actionMsg = '';
  const nominalRealisasi = Number(k.harga_realisasi ?? k.harga_estimasi ?? 0) * Number(k.qty||0);
  if (existing) {
    if (existing.status === 'dibeli') { 
      existing.status = 'belum_dibeli'; existing.tanggal_beli = null; 
      actionMsg = `↩️ Belanja perlengkapan dibatalkan: ${k.nama_item}`;
      toast(`"${k.nama_item}" → belum dibeli`); 
    }
    else { 
      existing.status = 'dibeli'; existing.tanggal_beli = todayISO(); existing.nominal_realisasi = nominalRealisasi;
      actionMsg = `✅ Belanja perlengkapan DIBELI: ${k.nama_item}`;
      toast(`✓ "${k.nama_item}" dibeli`); 
    }
  } else {
    db.daftarBelanjaPerlengkapan.push({id:uid(), event_id:eid(), kebutuhan_id:kebutuhanId, status:'dibeli', tanggal_beli:todayISO(), nominal_realisasi:nominalRealisasi});
    actionMsg = `✅ Belanja perlengkapan DIBELI: ${k.nama_item}`;
    toast(`✓ "${k.nama_item}" dibeli`);
  }
  saveDB(); renderContent(); renderTopbarSaldo();
  if(actionMsg) notifyTelegram(actionMsg, `Item: ${k.nama_item}\nQty: ${k.qty}\nLomba: ${db.lomba.find(x=>x.id===k.lomba_id)?.nama || k.lomba_id}`, 'belanja');
}
function toggleBelanjaPerlengkapanGroup(gi){
  if (!canEditSection('belanja-perlengkapan')) { toast('⛔ Login untuk mengedit data'); return; }
  const group = (window._belanjaPerlengkapanGroups||{})[gi];
  if(!group || !group.refs.length){ toast('Item tidak ditemukan'); return; }
  const semuaDibeli = group.refs.every(kid => {
    const existing = db.daftarBelanjaPerlengkapan.find(b=>b.kebutuhan_id===kid && b.event_id===eid());
    return existing && existing.status === 'dibeli';
  });
  const newStatus = semuaDibeli ? 'belum_dibeli' : 'dibeli';
  const tgl = newStatus === 'dibeli' ? todayISO() : null;
  const detail = [];
  group.refs.forEach(kid => {
    const k = db.lombaKebutuhan.find(x=>x.id===kid);
    if(!k) return;
    let existing = db.daftarBelanjaPerlengkapan.find(b=>b.kebutuhan_id===kid && b.event_id===eid());
    if(existing){ existing.status = newStatus; existing.tanggal_beli = tgl; }
    else { db.daftarBelanjaPerlengkapan.push({id:uid(), event_id:eid(), kebutuhan_id:kid, status:newStatus, tanggal_beli:tgl}); }
    detail.push(`${db.lomba.find(x=>x.id===k.lomba_id)?.nama || k.lomba_id}`);
  });
  saveDB(); renderContent(); renderTopbarSaldo();
  if(newStatus==='dibeli'){
    toast(`✓ "${group.nama}" dibeli (semua lomba)`);
    notifyTelegram(`✅ Belanja perlengkapan DIBELI: ${group.nama}`, detail.join('\n'), 'belanja');
  } else {
    toast(`"${group.nama}" → belum dibeli`);
    notifyTelegram(`↩️ Belanja perlengkapan dibatalkan: ${group.nama}`, detail.join('\n'), 'belanja');
  }
}
function tandaiSemuaBelanjaPerlengkapan(){ 
  if (!canEditSection('belanja-perlengkapan')) { toast('⛔ Login untuk mengedit data'); return; }
  let count=0; let detail = [];
  gLomba().forEach(l=>{gKebutuhan(l.id).forEach(k=>{const existing=db.daftarBelanjaPerlengkapan.find(b=>b.kebutuhan_id===k.id&&b.event_id===eid()); if(!existing||existing.status!=='dibeli'){if(existing){existing.status='dibeli';existing.tanggal_beli=todayISO();}else{db.daftarBelanjaPerlengkapan.push({id:uid(),event_id:eid(),kebutuhan_id:k.id,status:'dibeli',tanggal_beli:todayISO()});}count++;detail.push(`${k.nama_item} (${l.nama})`);}});}); 
  if(count===0){toast('Semua sudah dibeli');}else{saveDB();renderContent();renderTopbarSaldo();toast(`✓ ${count} item dibeli`);
  notifyTelegram(`✅ ${count} item perlengkapan DIBELI`, detail.join('\n'), 'belanja');} }
async function resetSemuaBelanjaPerlengkapan(){ 
  if (!canEditSection('belanja-perlengkapan')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!(await confirmModal('Reset semua status?'))) return; 
  const list=gDaftarBelanjaPerlengkapan(); 
  list.forEach(b=>{b.status='belum_dibeli';b.tanggal_beli=null;}); 
  saveDB(); renderContent(); toast('Reset');
  notifyTelegram(`↩️ Reset semua status belanja perlengkapan`, `Semua status dikembalikan ke "belum dibeli"`, 'belanja');
}
async function editBelanjaPerlengkapan(kebutuhanId){ 
  if (!canEditSection('belanja-perlengkapan')) { toast('⛔ Login untuk mengedit data'); return; }
  const k=db.lombaKebutuhan.find(x=>x.id===kebutuhanId); if(!k) return;
  const newNama = await promptModal({title:'Edit Item Perlengkapan', label:'Nama Item', defaultValue:k.nama_item});
  if(newNama===null) return;
  const newEst = await promptModal({title:'Edit Item Perlengkapan', label:'Harga Estimasi (Rp)', defaultValue:k.harga_estimasi, type:'currency'});
  if(newEst===null) return;
  const newQty = await promptModal({title:'Edit Item Perlengkapan', label:'Qty', defaultValue:k.qty, type:'number'});
  if(newQty===null) return;
  if(!newNama.trim()||Number(newQty)<=0){toast('Nama & qty wajib');return;} k.nama_item=newNama.trim(); k.harga_estimasi=Number(newEst)||0; k.qty=Number(newQty)||0; saveDB(); renderContent(); toast('Diupdate'); 
  notifyTelegram(`✏️ Edit item perlengkapan: ${k.nama_item}`, `Lomba: ${db.lomba.find(x=>x.id===k.lomba_id)?.nama || k.lomba_id}\nQty: ${k.qty}\nEstimasi: ${fmtRp(k.harga_estimasi)}`, 'belanja');
}

/* ============================================================
   HADIAH JALAN SANTAI & BELANJA JALAN (dengan auth check)
   ============================================================ */
function renderHadiahJalanSantai(){
  const list = gHadiahJalanSantai();
  const total = list.reduce((s,h) => s + (Number(h.harga_satuan||0) * Number(h.qty||0)), 0);
  const totalItems = list.reduce((s,h) => s + Number(h.qty||0), 0);
  const isLoggedIn = !!getCurrentUser();

  const rows = list.map((h, idx) => {
    const belanja = db.daftarBelanjaJalanSantai.find(b => b.hadiah_jalan_id === h.id && b.event_id === eid());
    const sudahDibeli = belanja && belanja.status === 'dibeli';
    return `
    <tr class="${sudahDibeli?'dibeli':''}">
      <td>${idx+1}</td>
      <td>${esc(h.nama_hadiah)} ${sudahDibeli?'<span class="status-dibeli-pill">✓ Dibeli</span>':''}</td>
      <td class="num">${fmtRp(h.harga_satuan)}</td>
      <td class="num">${h.qty}</td>
      <td class="num">${fmtRp(Number(h.harga_satuan||0) * Number(h.qty||0))}</td>
      <td style="text-align:right; white-space:nowrap;">
        <button class="icon-btn" ${da('openHadiahJalanModal', h.id)} ${!isLoggedIn ? 'disabled' : ''} title="Edit">✎</button>
        <button class="icon-btn" ${da('hapusHadiahJalan', h.id)} ${!isLoggedIn ? 'disabled' : ''} title="Hapus">🗑</button>
      </td>
    </tr>`;
  }).join('');

  return `
  <div class="stat-grid">
    <div class="stat-card jalan-santai"><div class="lbl">Total Hadiah</div><div class="val">${list.length}</div></div>
    <div class="stat-card pengeluaran"><div class="lbl">Total Item</div><div class="val">${totalItems}</div></div>
    <div class="stat-card saldo"><div class="lbl">Total Biaya</div><div class="val">${fmtRp(total)}</div></div>
  </div>
  <div class="panel">
    <div class="panel-head">
      <div><h3>🏃 Hadiah Jalan Santai</h3>
        <div class="desc">Kelola hadiah untuk acara jalan santai</div>
      </div>
      ${isLoggedIn ? `<button class="btn pink" ${da('openHadiahJalanModal')}>+ Tambah Hadiah</button>` : ''}
    </div>
    <div class="panel-body flush">
      <table class="jalan-table">
        <thead><tr><th>No</th><th>Nama Hadiah</th><th class="num">Harga Satuan</th><th class="num">Qty</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>${rows || `<tr class="empty-row"><td colspan="6">Belum ada hadiah jalan santai.</td></tr>`}</tbody>
        ${list.length > 0 ? `<tfoot><tr><td colspan="4">Total</td><td class="num">${fmtRp(total)}</td><td></td></tr></tfoot>` : ''}
      </table>
    </div>
  </div>`;
}

function openHadiahJalanModal(id){
  if (!canEditSection('hadiah-jalan')) { toast('⛔ Login untuk mengedit data'); return; }
  const editing = id ? db.hadiahJalanSantai.find(h=>h.id===id) : null;
  setModal(editing?'Edit Hadiah Jalan Santai':'Tambah Hadiah Jalan Santai', `
    <div class="field"><label>Nama Hadiah</label><input id="f-nama" value="${editing?esc(editing.nama_hadiah):''}" placeholder="mis. Baju, Topi, Snack Pack"></div>
    <div class="field-row">
      <div class="field"><label>Harga Satuan (Rp)</label><input id="f-harga" class="currency-input" type="text" value="${editing?formatCurrency(editing.harga_satuan):''}"></div>
      <div class="field"><label>Qty</label><input id="f-qty" type="number" min="1" value="${editing?editing.qty:1}"></div>
    </div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:editing?'Simpan':'Tambah', cls:'pink', onclick:()=>{
      const nama_hadiah = document.getElementById('f-nama').value.trim();
      const qty = Number(document.getElementById('f-qty').value||0);
      const harga_satuan = getCurrencyValue(document.getElementById('f-harga'));
      if(!nama_hadiah || qty <= 0 || harga_satuan <= 0){ toast('Nama, qty & harga wajib diisi'); return; }
      let actionMsg = editing ? `✏️ Edit hadiah jalan santai: ${editing.nama_hadiah} → ${nama_hadiah}` : `➕ Hadiah jalan santai baru: ${nama_hadiah}`;
      if(editing){ Object.assign(editing, {nama_hadiah, qty, harga_satuan}); }
      else{ db.hadiahJalanSantai.push({id:uid(), event_id:eid(), nama_hadiah, qty, harga_satuan}); }
      saveDB(); closeModal(); renderContent(); renderTopbarSaldo(); toast('Hadiah jalan santai disimpan');
      notifyTelegram(actionMsg, `Qty: ${qty}\nHarga: ${fmtRp(harga_satuan)}\nTotal: ${fmtRp(harga_satuan * qty)}`, 'belanja');
    }}
  ]);
  setTimeout(setupAllCurrencyInputs, 50);
}

async function hapusHadiahJalan(id){
  if (!canEditSection('hadiah-jalan')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!(await confirmModal('Hapus hadiah ini?'))) return;
  const h = db.hadiahJalanSantai.find(x=>x.id===id);
  db.hadiahJalanSantai = db.hadiahJalanSantai.filter(h=>h.id!==id);
  // Ikut hapus status belanja yang mereferensikan hadiah ini, supaya tidak jadi
  // orphan permanen di kt_daftar_belanja_jalan_santai.
  db.daftarBelanjaJalanSantai = db.daftarBelanjaJalanSantai.filter(b=>b.hadiah_jalan_id!==id);
  saveDB(); renderContent(); renderTopbarSaldo();
  if(h) notifyTelegram(`🗑️ Hapus hadiah jalan santai: ${h.nama_hadiah}`, `Qty: ${h.qty}\nHarga: ${fmtRp(h.harga_satuan)}`, 'belanja');
}

function toggleBelanjaJalan(hadiahId){
  if (!canEditSection('hadiah-jalan') && !canEditSection('belanja-jalan')) { toast('⛔ Login untuk mengedit data'); return; }
  const h = db.hadiahJalanSantai.find(x=>x.id===hadiahId);
  if(!h) { toast('Hadiah tidak ditemukan'); return; }
  
  let existing = db.daftarBelanjaJalanSantai.find(b => b.hadiah_jalan_id === hadiahId && b.event_id === eid());
  let actionMsg = '';
  
  if (existing) {
    if (existing.status === 'dibeli') {
      existing.status = 'belum_dibeli';
      existing.tanggal_beli = null;
      actionMsg = `↩️ Belanja jalan santai dibatalkan: ${h.nama_hadiah}`;
      toast(`"${h.nama_hadiah}" → belum dibeli`);
    } else {
      existing.status = 'dibeli';
      existing.tanggal_beli = todayISO();
      existing.nominal_realisasi = Number(h.harga_satuan||0)*Number(h.qty||0);
      actionMsg = `✅ Belanja jalan santai DIBELI: ${h.nama_hadiah}`;
      toast(`✓ "${h.nama_hadiah}" dibeli`);
    }
  } else {
    db.daftarBelanjaJalanSantai.push({
      id: uid(),
      event_id: eid(),
      hadiah_jalan_id: hadiahId,
      status: 'dibeli',
      tanggal_beli: todayISO(),
      nominal_realisasi: Number(h.harga_satuan||0)*Number(h.qty||0)
    });
    actionMsg = `✅ Belanja jalan santai DIBELI: ${h.nama_hadiah}`;
    toast(`✓ "${h.nama_hadiah}" dibeli`);
  }
  saveDB(); renderContent(); renderTopbarSaldo();
  if(actionMsg) notifyTelegram(actionMsg, `Qty: ${h.qty}\nHarga: ${fmtRp(h.harga_satuan)}`, 'belanja');
}
function toggleBelanjaJalanGroup(gi){
  if (!canEditSection('hadiah-jalan') && !canEditSection('belanja-jalan')) { toast('⛔ Login untuk mengedit data'); return; }
  const group = (window._belanjaJalanGroups||{})[gi];
  if(!group || !group.refs.length){ toast('Item tidak ditemukan'); return; }
  const semuaDibeli = group.refs.every(hid => {
    const existing = db.daftarBelanjaJalanSantai.find(b=>b.hadiah_jalan_id===hid && b.event_id===eid());
    return existing && existing.status === 'dibeli';
  });
  const newStatus = semuaDibeli ? 'belum_dibeli' : 'dibeli';
  const tgl = newStatus === 'dibeli' ? todayISO() : null;
  const detail = [];
  group.refs.forEach(hid => {
    const h = db.hadiahJalanSantai.find(x=>x.id===hid);
    if(!h) return;
    let existing = db.daftarBelanjaJalanSantai.find(b=>b.hadiah_jalan_id===hid && b.event_id===eid());
    if(existing){ existing.status = newStatus; existing.tanggal_beli = tgl; }
    else { db.daftarBelanjaJalanSantai.push({id:uid(), event_id:eid(), hadiah_jalan_id:hid, status:newStatus, tanggal_beli:tgl}); }
    detail.push(`Qty ${h.qty} × ${fmtRp(h.harga_satuan)}`);
  });
  saveDB(); renderContent(); renderTopbarSaldo();
  if(newStatus==='dibeli'){
    toast(`✓ "${group.nama}" dibeli`);
    notifyTelegram(`✅ Belanja jalan santai DIBELI: ${group.nama}`, detail.join('\n'), 'belanja');
  } else {
    toast(`"${group.nama}" → belum dibeli`);
    notifyTelegram(`↩️ Belanja jalan santai dibatalkan: ${group.nama}`, detail.join('\n'), 'belanja');
  }
}

function renderBelanjaJalanSantai(){
  const list = gHadiahJalanSantai();
  const daftar = gDaftarBelanjaJalanSantai();
  const statusMap = {};
  daftar.forEach(b => { statusMap[b.hadiah_jalan_id] = b; });

  const items = list.map(h => {
    const belanja = statusMap[h.id] || null;
    const status = belanja ? belanja.status : 'belum_dibeli';
    const tanggalBeli = belanja ? belanja.tanggal_beli : null;
    const sudahDibeli = status === 'dibeli';
    return {
      ...h,
      status,
      tanggalBeli,
      sudahDibeli,
      belanjaId: belanja ? belanja.id : null,
      hargaTotal: Number(h.harga_satuan||0) * Number(h.qty||0)
    };
  });

  items.sort((a,b) => {
    if (a.sudahDibeli !== b.sudahDibeli) return a.sudahDibeli ? 1 : -1;
    return a.nama_hadiah.localeCompare(b.nama_hadiah);
  });

  const totalItem = items.length;
  const totalBelum = items.filter(i => !i.sudahDibeli).length;
  const totalSudah = items.filter(i => i.sudahDibeli).length;
  const totalEstimasi = items.reduce((s, i) => s + i.hargaTotal, 0);
  const totalBelumEstimasi = items.filter(i => !i.sudahDibeli).reduce((s, i) => s + i.hargaTotal, 0);
  const isLoggedIn = !!getCurrentUser();

  if (!items.length) {
    return `
    <div class="belanja-toko-page">
    <div class="panel">
      <div class="panel-head"><h3>🛍️ Belanja Jalan Santai</h3></div>
      <div class="panel-body">
        <div class="empty-state"><h3>Belum ada hadiah</h3><p>Tambahkan hadiah jalan santai dulu.</p>
          ${isLoggedIn ? `<button class="btn pink" ${da('goSection', 'hadiah-jalan')}>+ Tambah Hadiah</button>` : ''}
        </div>
      </div>
    </div>
    </div>`;
  }

  // Kelompokkan per NAMA hadiah (kalau ada beberapa entri dengan nama sama), total digabung
  const nameMap = {};
  items.forEach(item => {
    const key = normNamaBarang(item.nama_hadiah);
    if(!nameMap[key]) nameMap[key] = {nama: item.nama_hadiah, list: []};
    nameMap[key].list.push(item);
  });
  const nameGroups = Object.values(nameMap).sort((a,b) => {
    const aBelum = a.list.some(i=>!i.sudahDibeli), bBelum = b.list.some(i=>!i.sudahDibeli);
    if(aBelum !== bBelum) return aBelum ? -1 : 1;
    return a.nama.localeCompare(b.nama);
  });

  window._belanjaJalanGroups = {};
  const groups = nameGroups.map((g, gi) => {
    const groupItems = g.list;
    window._belanjaJalanGroups[gi] = {nama: g.nama, refs: groupItems.map(i=>i.id)};

    const totalQty = groupItems.reduce((s,i)=>s+Number(i.qty||0),0);
    const totalHarga = groupItems.reduce((s, i) => s + i.hargaTotal, 0);
    const semuaDibeli = groupItems.every(i=>i.sudahDibeli);
    const groupBelum = groupItems.filter(i => !i.sudahDibeli);
    const tglTerbaru = groupItems.filter(i=>i.tanggalBeli).map(i=>i.tanggalBeli).sort().pop();

    const tagHtml = groupItems.map(item => `<span class="tag tag-pink">${item.qty} @${fmtRp(item.harga_satuan)}</span>`).join('');

    return `<div class="belanja-item ${semuaDibeli ? 'dibeli' : ''}">
      <span class="nomor-urut">${gi+1}</span>
      <div class="checkbox-wrapper ${semuaDibeli ? 'checked' : ''} ${!isLoggedIn ? 'disabled' : ''}" 
           ${isLoggedIn ? da('toggleBelanjaJalanGroup', gi) : da('toast', '⛔ Login untuk mengedit')}>
      </div>
      <div class="info">
        <div class="nama"><span class="nama-text">${esc(g.nama)}</span><span class="qty-total">(Total: ${totalQty})</span></div>
        <div class="detail">${tagHtml}${semuaDibeli&&tglTerbaru?`<span>✓ Dibeli: ${fmtDate(tglTerbaru)}</span>`:(groupBelum.length && groupBelum.length<groupItems.length ? `<span style="color:var(--orange);">Sebagian belum (${groupBelum.length}/${groupItems.length})</span>` : '')}</div>
      </div>
      <div class="harga">${fmtRp(totalHarga)}</div>
    </div>`;
  }).join('');

  return `
  <div class="belanja-toko-page">
  <div class="stat-grid">
    <div class="stat-card jalan-santai"><div class="lbl">Total Item</div><div class="val">${totalItem}</div></div>
    <div class="stat-card pemasukan"><div class="lbl">Belum Dibeli</div><div class="val">${totalBelum}</div></div>
    <div class="stat-card pengeluaran"><div class="lbl">Sudah Dibeli</div><div class="val">${totalSudah}</div></div>
    <div class="stat-card saldo"><div class="lbl">Estimasi Total</div><div class="val">${fmtRp(totalEstimasi)}</div></div>
    ${progressBelanjaCardHtml(totalItem, totalSudah)}
  </div>
  <div class="panel">
    <div class="panel-head">
      <div><h3>🛍️ Daftar Belanja Hadiah Jalan Santai</h3>
        <div class="desc">Belum dibeli: <strong>${fmtRp(totalBelumEstimasi)}</strong></div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn success small" ${da('tandaiSemuaBelanjaJalan')} ${!isLoggedIn ? 'disabled' : ''}>✓ Semua Dibeli</button>
        <button class="btn secondary small" ${da('resetSemuaBelanjaJalan')} ${!isLoggedIn ? 'disabled' : ''}>↺ Reset</button>
      </div>
    </div>
    <div class="panel-body">
      ${groups}
    </div>
  </div>
  </div>`;
}

function tandaiSemuaBelanjaJalan(){
  if (!canEditSection('belanja-jalan')) { toast('⛔ Login untuk mengedit data'); return; }
  const list = gHadiahJalanSantai();
  let count = 0;
  let detail = [];
  list.forEach(h => {
    const existing = db.daftarBelanjaJalanSantai.find(b => b.hadiah_jalan_id === h.id && b.event_id === eid());
    if (!existing || existing.status !== 'dibeli') {
      const nominalRealisasi=Number(h.harga_satuan||0)*Number(h.qty||0);
      if (existing) { existing.status = 'dibeli'; existing.tanggal_beli = todayISO(); existing.nominal_realisasi=nominalRealisasi; }
      else { db.daftarBelanjaJalanSantai.push({id:uid(), event_id:eid(), hadiah_jalan_id:h.id, status:'dibeli', tanggal_beli:todayISO(), nominal_realisasi:nominalRealisasi}); }
      count++;
      detail.push(`${h.nama_hadiah}`);
    }
  });
  if(count===0){ toast('Semua sudah dibeli'); }
  else { saveDB(); renderContent(); renderTopbarSaldo(); toast(`✓ ${count} item dibeli`);
  notifyTelegram(`✅ ${count} item jalan santai DIBELI`, detail.join('\n'), 'belanja'); }
}

async function resetSemuaBelanjaJalan(){
  if (!canEditSection('belanja-jalan')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!(await confirmModal('Reset semua status belanja?'))) return;
  const list = gDaftarBelanjaJalanSantai();
  list.forEach(b => { b.status = 'belum_dibeli'; b.tanggal_beli = null; });
  saveDB(); renderContent(); toast('Reset semua status');
  notifyTelegram(`↩️ Reset semua status belanja jalan santai`, `Semua status dikembalikan ke "belum dibeli"`, 'belanja');
}
