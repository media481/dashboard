/* ============================================================
   ANGGOTA (dengan auth check)
   ============================================================ */
let filterKategoriAnggota = 'semua';
let filterStatusAnggota = 'semua';
let searchQueryAnggota = '';

function renderAnggota(){
  const list = gAnggota();
  const s = getSettings();

  let filtered = [...list];
  if (filterKategoriAnggota !== 'semua') filtered = filtered.filter(a => a.kategori === filterKategoriAnggota);
  if (filterStatusAnggota !== 'semua') filtered = filtered.filter(a => a.status === filterStatusAnggota);
  if (searchQueryAnggota.trim()) { const q = searchQueryAnggota.toLowerCase().trim(); filtered = filtered.filter(a => a.nama.toLowerCase().includes(q)); }

  filtered.sort((a,b)=>{
    const aBelum = a.status!=='lunas', bBelum = b.status!=='lunas';
    if (aBelum !== bBelum) return aBelum ? -1 : 1;
    return a.nama.localeCompare(b.nama, 'id', {sensitivity:'base'});
  });

  const totalTerkumpul = list.filter(a=>a.status==='lunas').reduce((sum,a)=>sum+Number(a.nominal_wajib||0),0);
  const totalPotensi = list.reduce((sum,a)=>sum+Number(a.nominal_wajib||0),0);
  const lunasCount = list.filter(a=>a.status==='lunas').length;
  const isLoggedIn = !!getCurrentUser();
  const isFiltering = filterKategoriAnggota !== 'semua' || filterStatusAnggota !== 'semua' || !!searchQueryAnggota.trim();

  const rows = filtered.map(a=> isLoggedIn ? `
    <tr>
      <td>${esc(a.nama)}</td>
      <td><span class="kategori-pill ${a.kategori==='khusus'?'khusus':''}">${labelKategori(a.kategori)}</span></td>
      <td class="num">${fmtRp(a.nominal_wajib)}</td>
      <td>${a.status==='lunas'?`<span class="badge lunas">Lunas</span> <span style="font-size:11px;color:var(--ink-soft)">${fmtDate(a.tanggal_bayar)}</span>`:`<span class="badge belum">Belum</span>`}</td>
      <td style="text-align:right; white-space:nowrap;">
        <button class="btn secondary small" ${da('toggleLunas', a.id)}>${a.status==='lunas'?'Batalkan':'Tandai Lunas'}</button>
        <button class="icon-btn" ${da('openAnggotaModal', a.id)} title="Edit">✎</button>
        <button class="icon-btn" ${da('hapusAnggota', a.id)} title="Hapus">🗑</button>
      </td>
    </tr>` : `
    <tr>
      <td>${esc(a.nama)}</td>
      <td class="num">${fmtRp(a.nominal_wajib)}</td>
      <td>${a.status==='lunas'?`<span class="badge lunas">Lunas</span>`:`<span class="badge belum">Belum</span>`}</td>
    </tr>`).join('');

  const filterHtml = `<div class="filter-row">
    <div class="field" style="margin-bottom:0;min-width:150px;"><label style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Kategori</label>
      <select id="filter-kategori-anggota" onchange="applyFilterAnggota()"><option value="semua" ${filterKategoriAnggota==='semua'?'selected':''}>Semua</option>${KATEGORI_ANGGOTA.map(k=>`<option value="${k.v}" ${filterKategoriAnggota===k.v?'selected':''}>${k.l}</option>`).join('')}</select></div>
    <div class="field" style="margin-bottom:0;min-width:150px;"><label style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Status</label>
      <select id="filter-status-anggota" onchange="applyFilterAnggota()"><option value="semua" ${filterStatusAnggota==='semua'?'selected':''}>Semua</option><option value="lunas" ${filterStatusAnggota==='lunas'?'selected':''}>Lunas</option><option value="belum_lunas" ${filterStatusAnggota==='belum_lunas'?'selected':''}>Belum Lunas</option></select></div>
    <div class="search-box" style="flex:1;min-width:200px;"><div class="search-input-wrap"><i data-lucide="search" class="inline-icon search-input-icon"></i><input type="text" id="search-input-anggota" placeholder="Cari nama..." value="${esc(searchQueryAnggota)}" oninput="applySearchAnggota()"></div>${searchQueryAnggota?`<button class="btn secondary small" ${da('clearSearchAnggota')}>✕</button>`:''}</div>
    ${isFiltering?`<button class="btn secondary small" ${da('resetFilterAnggota')}>↺ Reset</button>`:''}
  </div>`;

  const tarifBelumDiisi = Number(s.tarif.sekolah||0)<=0 && Number(s.tarif.bekerja||0)<=0 && Number(s.tarif.perantauan||0)<=0;
  const tarifBanner = (tarifBelumDiisi && isLoggedIn) ? `
    <div class="panel" style="background:var(--orange-tint); border-left:3px solid var(--orange); display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:14px 16px; margin-bottom:16px;">
      <div style="font-size:13.5px; color:var(--ink-soft);">⚠️ Tarif iuran (Sekolah/Bekerja/Perantauan) belum diisi — anggota yang ditambahkan sekarang akan tercatat <b>Rp 0</b>. Set tarif dulu di Pengaturan.</div>
      <button class="btn small" ${da('goSection', 'pengaturan')} style="white-space:nowrap;">⚙️ Buka Pengaturan</button>
    </div>` : '';

  return `
  ${tarifBanner}
  <div class="stat-grid-ringkasan" style="margin-bottom:26px;">
    <div class="stat-card"><div class="lbl">Total Anggota</div><div class="val">${list.length}</div></div>
    <div class="stat-card pemasukan"><div class="lbl">Terkumpul (Lunas)</div><div class="val">${fmtRp(totalTerkumpul)}</div></div>
    <div class="stat-card"><div class="lbl">Sudah Lunas</div><div class="val">${lunasCount} / ${list.length}</div></div>
    <div class="stat-card"><div class="lbl">Potensi Total</div><div class="val">${fmtRp(totalPotensi)}</div></div>
  </div>
  <div class="panel">
    <div class="panel-head">
      <div><h3>Daftar Anggota</h3>
        <div class="desc">Tarif: Sekolah ${fmtRp(s.tarif.sekolah)} · Bekerja ${fmtRp(s.tarif.bekerja)} · Perantauan ${fmtRp(s.tarif.perantauan)} · Khusus (bebas)</div>
      </div>
      ${isLoggedIn ? `<button class="btn" ${da('openAnggotaModal')}>+ Tambah Anggota</button>` : ''}
    </div>
    <div class="panel-body">
      ${filterHtml}
      <div style="overflow-x:auto; -webkit-overflow-scrolling:touch;">
      <table class="anggota-table${isLoggedIn?'':' anggota-table-guest'}">
        <thead>${isLoggedIn ? `<tr><th>Nama</th><th>Kategori</th><th class="num">Nominal</th><th>Status</th><th></th></tr>` : `<tr><th>Nama</th><th class="num">Nominal</th><th>Status</th></tr>`}</thead>
        <tbody>${rows || `<tr class="empty-row"><td colspan="${isLoggedIn?5:3}">${isFiltering?'Tidak ditemukan.':'Belum ada anggota.'}</td></tr>`}</tbody>
      </table>
      </div>
    </div>
  </div>`;
}
function applyFilterAnggota(){ filterKategoriAnggota=document.getElementById('filter-kategori-anggota').value; filterStatusAnggota=document.getElementById('filter-status-anggota').value; renderContent(); }
function applySearchAnggota(){ searchQueryAnggota=document.getElementById('search-input-anggota').value; renderContent(); }
function clearSearchAnggota(){ searchQueryAnggota=''; renderContent(); }
function resetFilterAnggota(){ filterKategoriAnggota='semua'; filterStatusAnggota='semua'; searchQueryAnggota=''; renderContent(); }
function labelKategori(v){ return (KATEGORI_ANGGOTA.find(k=>k.v===v)||{}).l || v; }
function labelRT(v){ return (RT_LIST.find(k=>k.v===v)||{}).l || v || '-'; }

/* RT belum tentu terisi untuk data lama (a.rt kosong/undefined). Dropdown-nya
   otomatis menampilkan opsi pertama (RT 1) sebagai default visual browser,
   tapi itu cuma tampilan — datanya sendiri tetap kosong kalau tidak dibaca
   lewat helper ini. Dulu filter/sort/CSV membaca a.rt langsung sehingga baris
   yang "kelihatan" RT 1 tidak ikut ketemu saat difilter/disortir per RT 1.
   getRT() menyamakan nilai yang dipakai untuk tampilan dan untuk pencarian. */
function getRT(a){ return (a && a.rt) || RT_LIST[0].v; }

/* ============================================================
   PENEBAK JENIS KELAMIN DARI NAMA (heuristik, bukan data pasti)
   Menebak berdasarkan nama depan yang cocok dengan daftar nama umum
   di Indonesia, dengan fallback ke pola akhiran nama yang umum.
   Hasil bisa saja meleset untuk nama yang tidak umum/unisex.
   ============================================================ */
const NAMA_PRIA_UMUM = ['muhammad','mohammad','ahmad','achmad','budi','agus','dedi','deni','dedy','deny','dodi','doni','eko','fajar','hadi','hendra','hendro','iwan','joko','johan','yusuf','yusup','yudi','yudha','andi','andre','anton','aris','bagus','bayu','bima','danang','dani','dimas','edi','edo','erik','fadli','fahmi','fauzi','feri','ferry','gilang','guntur','hari','hasan','heri','herry','ilham','imam','indra','irfan','irwan','ivan','jaka','komang','ketut','made','wayan','nyoman','kurniawan','lukman','mahmud','marno','miftah','nanang','nur','oki','omar','panji','pratama','putra','ramadhan','rangga','reza','rian','ridho','rifki','rizal','rizky','robby','roni','rudi','ryan','saiful','samsul','sandi','sigit','slamet','sofyan','sugeng','sukarno','suryanto','tarno','taufik','teguh','tono','topan','trisno','umar','wahyu','wawan','wildan','yahya','yanto','yasin','zaenal','zainal','zaki','arief','ade','asep','bambang','dadang','darma','dwi','endro','faisal','gunawan','hardi','husein','ismail','kadek','kadir','madi','narto','rahmat','sutrisno','suparman','wisnu'];

const NAMA_WANITA_UMUM = ['siti','sri','dewi','ayu','putri','wulan','indah','rina','rini','ratna','ratih','ratu','ani','ana','anisa','annisa','anggi','arum','asri','citra','dian','diah','dina','eka','erna','fitri','fitria','gita','hana','ika','ina','indi','intan','ira','irma','kartika','kirana','laila','lestari','lia','lina','lisa','maya','melati','melinda','mira','nadia','nadya','nia','nina','novi','novita','nurul','oktavia','putu','rahayu','rahmawati','reni','riri','rizka','rosa','sari','septi','shinta','sinta','tania','tari','tia','tina','tuti','ulfa','ulfah','umi','vera','vina','wening','wida','wiwik','yani','yanti','yuli','yulia','yuniar','yustina','zahra','zulaikha','ambar','bella','desi','elin','endah','farah','ida','ima','juwita','kiki','lala','marlina','mega','nining','nurhayati','okta','rahma','rosita','salma','tata','titin','vika','wiwin','yeni'];

const AKHIRAN_PRIA_UMUM = ['yanto','anto','ansyah','uddin','udin','ullah','wan'];
const AKHIRAN_WANITA_UMUM = ['wati','ningsih','ningrum','yanti','nita','iyah','ita'];

function guessGender(nama){
  if(!nama) return null;
  const firstName = String(nama).trim().toLowerCase().split(/\s+/)[0].replace(/[^a-z]/g,'');
  if(!firstName) return null;
  if(NAMA_PRIA_UMUM.includes(firstName)) return 'pria';
  if(NAMA_WANITA_UMUM.includes(firstName)) return 'wanita';
  for(const s of AKHIRAN_PRIA_UMUM){ if(firstName.endsWith(s)) return 'pria'; }
  for(const s of AKHIRAN_WANITA_UMUM){ if(firstName.endsWith(s)) return 'wanita'; }
  return null;
}
function labelGender(v){ return v==='pria' ? 'Laki-Laki' : v==='wanita' ? 'Perempuan' : 'Tidak diketahui'; }

/* Jenis kelamin sekarang adalah data asli (a.gender) yang bisa dikoreksi manual.
   Untuk data lama yang belum pernah dikoreksi (a.gender belum ada), gunakan
   tebakan otomatis dari nama sebagai fallback tampilan saja. */
function getGender(a){
  if(a && a.gender) return a.gender;
  return guessGender(a && a.nama) || 'tidak_diketahui';
}

function openAnggotaModal(id){
  if (!canEditSection('anggota')) { toast('⛔ Login untuk mengedit data'); return; }
  const editing = id ? db.anggota.find(a=>a.id===id) : null;
  const s = getSettings();
  setModal(editing?'Edit Anggota':'Tambah Anggota', `
    <div class="field"><label>Nama Anggota</label><input id="f-nama" value="${editing?esc(editing.nama):''}" placeholder="Nama lengkap" oninput="autoGuessGenderFromNama()"></div>
    <div class="field"><label>Kategori</label>
      <select id="f-kategori" data-initial="${editing?editing.kategori:''}" data-nominal-awal="${editing?Number(editing.nominal_wajib||0):0}" onchange="updateNominalPreview()">
        ${KATEGORI_ANGGOTA.map(k=>`<option value="${k.v}" ${editing&&editing.kategori===k.v?'selected':''}>${k.l}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>RT</label>
      <select id="f-rt">
        ${RT_LIST.map(r=>`<option value="${r.v}" ${editing&&getRT(editing)===r.v?'selected':''}>${r.l}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Jenis Kelamin</label>
      <select id="f-gender" ${editing&&editing.gender?"data-user-edited=\"1\"":''} onchange="this.dataset.userEdited='1'">
        ${GENDER_LIST.map(g=>`<option value="${g.v}" ${getGender(editing||{nama:''})===g.v?'selected':''}>${g.l}</option>`).join('')}
      </select>
      <div class="hint">Terisi otomatis dari nama, tapi bisa dikoreksi kapan saja.</div>
    </div>
    <div class="field"><label id="f-nominal-label">Nominal Wajib (otomatis)</label>
      <input id="f-nominal" class="currency-input" value="${editing?fmtRp(editing.nominal_wajib):''}" ${editing&&editing.kategori==='khusus'?'':'disabled'} style="${editing&&editing.kategori==='khusus'?'':'background:var(--cream);'}">
      <div class="hint" id="f-nominal-hint" style="${editing&&editing.kategori==='khusus'?'':'display:none;'}">Kategori Khusus: isi nominal iuran secara bebas sesuai kesepakatan.</div>
    </div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label: editing?'Simpan':'Tambah', cls:'', onclick:()=>{
      const nama = document.getElementById('f-nama').value.trim();
      const kategori = document.getElementById('f-kategori').value;
      const rt = document.getElementById('f-rt').value;
      const gender = document.getElementById('f-gender').value;
      if(!nama){ toast('Nama anggota wajib diisi'); return; }
      // Nominal HANYA disinkronkan ke tarif terkini kalau kategorinya benar-benar
      // berubah (atau anggota baru). Kalau kategori tetap sama, nominal yang
      // sudah tersimpan dipertahankan — supaya anggota yang sudah ditandai Lunas
      // dengan tarif lama tidak diam-diam berubah cuma karena admin mengedit
      // field lain (mis. RT) setelah tarif di Pengaturan diubah. Lihat Bug #3.
      const kategoriBerubah = !editing || editing.kategori !== kategori;
      const nominal = kategori==='khusus'
        ? getCurrencyValue(document.getElementById('f-nominal'))
        : (kategoriBerubah ? (getSettings().tarif[kategori] || 0) : Number(editing.nominal_wajib||0));
      if(kategori==='khusus' && (!nominal || nominal<=0)){ toast('Isi nominal iuran untuk kategori khusus'); return; }
      let actionMsg = '';
      if(editing){
        actionMsg = `✏️ Edit anggota: ${editing.nama} → ${nama}`;
        editing.nama = nama; editing.kategori = kategori; editing.rt = rt; editing.gender = gender; editing.nominal_wajib = nominal;
      } else {
        actionMsg = `➕ Tambah anggota: ${nama} (${labelKategori(kategori)})`;
        db.anggota.push({id:uid(), event_id:eid(), nama, kategori, rt, gender, nominal_wajib:nominal, status:'belum_lunas', tanggal_bayar:null});
      }
      saveDB(); closeModal(); renderContent(); renderTopbarSaldo(); toast('Data anggota disimpan');
      notifyTelegram(actionMsg, `Nama: ${nama}\nKategori: ${labelKategori(kategori)}\nRT: ${labelRT(rt)}\nJenis Kelamin: ${labelGender(gender)}\nNominal: ${fmtRp(nominal)}`, 'anggota');
    }}
  ]);
  setTimeout(updateNominalPreview, 0);
}
function autoGuessGenderFromNama(){
  const genderEl = document.getElementById('f-gender');
  const namaEl = document.getElementById('f-nama');
  if(!genderEl || !namaEl) return;
  if(genderEl.dataset.userEdited==='1') return; // jangan timpa koreksi manual
  genderEl.value = guessGender(namaEl.value) || 'tidak_diketahui';
}
function updateNominalPreview(){
  const kEl = document.getElementById('f-kategori');
  if(!kEl) return;
  const nominalInput = document.getElementById('f-nominal');
  const labelEl = document.getElementById('f-nominal-label');
  const hintEl = document.getElementById('f-nominal-hint');
  if (!nominalInput) return;
  if (kEl.value === 'khusus') {
    nominalInput.disabled = false;
    nominalInput.style.background = '';
    if (labelEl) labelEl.textContent = 'Nominal Wajib (bebas)';
    if (hintEl) hintEl.style.display = '';
  } else {
    // Sama seperti di handler Simpan: kalau kategori belum diganti dari saat
    // modal dibuka (edit anggota lama), tampilkan nominal ASLI yang sudah
    // tersimpan — bukan tarif terkini — supaya preview tidak menyesatkan
    // sebelum disimpan. Cuma disinkronkan ke tarif kalau kategori benar-benar
    // diganti (atau anggota baru, dataset.initial kosong).
    const kategoriAwal = kEl.dataset.initial || '';
    const kategoriBerubah = kategoriAwal === '' || kategoriAwal !== kEl.value;
    const s = getSettings();
    const nilai = kategoriBerubah ? (s.tarif[kEl.value] || 0) : Number(kEl.dataset.nominalAwal || 0);
    setCurrencyValue(nominalInput, nilai);
    nominalInput.disabled = true;
    nominalInput.style.background = 'var(--cream)';
    if (labelEl) labelEl.textContent = 'Nominal Wajib (otomatis)';
    if (hintEl) hintEl.style.display = 'none';
  }
}
function toggleLunas(id){
  if (!canEditSection('anggota')) { toast('⛔ Login untuk mengedit data'); return; }
  const a = db.anggota.find(x=>x.id===id); if(!a) return;
  const statusBaru = a.status==='lunas' ? 'belum_lunas' : 'lunas';
  a.status = statusBaru;
  a.tanggal_bayar = a.status==='lunas' ? todayISO() : null;
  saveDB(); renderContent(); renderTopbarSaldo();
  if(statusBaru === 'lunas'){
    notifyTelegram(`✅ Anggota LUNAS: ${a.nama}`, `Nama: ${a.nama}\nKategori: ${labelKategori(a.kategori)}\nNominal: ${fmtRp(a.nominal_wajib)}\nTanggal Bayar: ${fmtDate(a.tanggal_bayar)}`, 'anggota');
  }else{
    notifyTelegram(`↩️ Anggota dibatalkan lunas: ${a.nama}`, `Nama: ${a.nama}\nKategori: ${labelKategori(a.kategori)}`, 'anggota');
  }
}
function updateAnggotaField(id, field, value){
  if (!canEditSection('anggota')) { toast('⛔ Login untuk mengedit data'); renderContent(); return; }
  const a = db.anggota.find(x=>x.id===id); if(!a) return;
  if(field==='rt'){
    a.rt = value;
    saveDB(); renderContent();
    toast(`RT ${a.nama} diubah ke ${labelRT(value)}`);
  } else if(field==='gender'){
    a.gender = value;
    saveDB(); renderContent();
    toast(`Jenis kelamin ${a.nama} diubah ke ${labelGender(value)}`);
  }
}
async function hapusAnggota(id){
  if (!canEditSection('anggota')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!(await confirmModal('Hapus anggota ini?'))) return;
  const a = db.anggota.find(x=>x.id===id);
  db.anggota = db.anggota.filter(a=>a.id!==id); 
  saveDB(); renderContent(); renderTopbarSaldo();
  if(a) notifyTelegram(`🗑️ Hapus anggota: ${a.nama}`, `Nama: ${a.nama}\nKategori: ${labelKategori(a.kategori)}`, 'anggota');
}

/* ============================================================
   DATABASE ANGGOTA (dengan auth check untuk tombol aksi)
   ============================================================ */
let filterKategori = 'semua';
let filterStatus = 'semua';
let filterGender = 'semua';
let filterRT = 'semua';
let searchQuery = '';
let sortBy = 'nama';
let sortOrder = 'asc';

function renderDatabaseAnggota(){
  const list = gAnggota();
  let filtered = [...list];
  if (filterKategori !== 'semua') filtered = filtered.filter(a => a.kategori === filterKategori);
  if (filterStatus !== 'semua') filtered = filtered.filter(a => a.status === filterStatus);
  if (filterGender !== 'semua') filtered = filtered.filter(a => getGender(a) === filterGender);
  if (filterRT !== 'semua') filtered = filtered.filter(a => getRT(a) === filterRT);
  if (searchQuery.trim()) { const q = searchQuery.toLowerCase().trim(); filtered = filtered.filter(a => a.nama.toLowerCase().includes(q)); }
  
  filtered.sort((a,b) => {
    let valA, valB;
    switch(sortBy){
      case 'nama': valA = a.nama; valB = b.nama; break;
      case 'kategori': valA = a.kategori; valB = b.kategori; break;
      case 'rt': valA = getRT(a); valB = getRT(b); break;
      case 'gender': valA = labelGender(getGender(a)); valB = labelGender(getGender(b)); break;
      case 'nominal': valA = Number(a.nominal_wajib||0); valB = Number(b.nominal_wajib||0); break;
      case 'status': valA = a.status; valB = b.status; break;
      case 'tanggal': valA = a.tanggal_bayar || ''; valB = b.tanggal_bayar || ''; break;
      default: valA = a.nama; valB = b.nama;
    }
    if (typeof valA === 'string') return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    return sortOrder === 'asc' ? valA - valB : valB - valA;
  });

  const total = filtered.length, totalBelum = filtered.filter(a=>a.status==='belum_lunas').length, totalLunas = filtered.filter(a=>a.status==='lunas').length;
  const totalNominal = filtered.reduce((s,a)=>s+Number(a.nominal_wajib||0),0);
  const totalTerkumpul = filtered.filter(a=>a.status==='lunas').reduce((s,a)=>s+Number(a.nominal_wajib||0),0);
  const isLoggedIn = !!getCurrentUser();

  const statKategori = {};
  KATEGORI_ANGGOTA.forEach(k => {
    const items = filtered.filter(a=>a.kategori===k.v);
    statKategori[k.v] = {label: k.l, total: items.length, lunas: items.filter(a=>a.status==='lunas').length, nominal: items.reduce((s,a)=>s+Number(a.nominal_wajib||0),0), terkumpul: items.filter(a=>a.status==='lunas').reduce((s,a)=>s+Number(a.nominal_wajib||0),0)};
  });

  const statRT = {};
  RT_LIST.forEach(r => {
    const items = filtered.filter(a=>getRT(a)===r.v);
    statRT[r.v] = {label: r.l, total: items.length, lunas: items.filter(a=>a.status==='lunas').length, nominal: items.reduce((s,a)=>s+Number(a.nominal_wajib||0),0), terkumpul: items.filter(a=>a.status==='lunas').reduce((s,a)=>s+Number(a.nominal_wajib||0),0)};
  });

  const statGender = {};
  [{v:'pria', l:'Laki-Laki'}, {v:'wanita', l:'Perempuan'}].forEach(g => {
    const items = filtered.filter(a=>getGender(a)===g.v);
    statGender[g.v] = {label: g.l, total: items.length, lunas: items.filter(a=>a.status==='lunas').length, nominal: items.reduce((s,a)=>s+Number(a.nominal_wajib||0),0), terkumpul: items.filter(a=>a.status==='lunas').reduce((s,a)=>s+Number(a.nominal_wajib||0),0)};
  });

  const rows = filtered.map(a=>`<tr class="${a.status==='belum_lunas'?'belum-bayar':''}">
    <td title="${esc(a.nama)}">${esc(a.nama)}</td>
    <td><span class="kategori-pill ${a.kategori==='khusus'?'khusus':''}">${labelKategori(a.kategori)}</span></td>
    <td><select class="inline-edit-select" onchange="updateAnggotaField('${a.id}','rt',this.value)" ${!isLoggedIn?'disabled':''}>
      ${RT_LIST.map(r=>`<option value="${r.v}" ${getRT(a)===r.v?'selected':''}>${r.l}</option>`).join('')}
    </select></td>
    <td><select class="inline-edit-select" onchange="updateAnggotaField('${a.id}','gender',this.value)" ${!isLoggedIn?'disabled':''}>
      ${GENDER_LIST.map(g=>`<option value="${g.v}" ${getGender(a)===g.v?'selected':''}>${g.l}</option>`).join('')}
    </select></td>
    <td class="num">${fmtRp(a.nominal_wajib)}</td>
    <td>${a.status==='lunas'?`<span class="badge lunas">Lunas</span>`:`<span class="badge belum">Belum Bayar</span>`}</td>
    <td style="font-size:12px;color:var(--ink-soft);">${a.status==='lunas'?fmtDate(a.tanggal_bayar):'-'}</td>
    <td style="text-align:right;white-space:nowrap;">
      <button class="btn secondary small" ${da('toggleLunas', a.id)} ${!isLoggedIn ? 'disabled' : ''}>${a.status==='lunas'?'Batalkan':'Bayar'}</button>
      <button class="icon-btn" ${da('openAnggotaModal', a.id)} ${!isLoggedIn ? 'disabled' : ''}>✎</button>
      <button class="icon-btn" ${da('hapusAnggota', a.id)} ${!isLoggedIn ? 'disabled' : ''}>🗑</button>
    </td>
  </tr>`).join('');

  const statCards = `<div class="stat-grid"><div class="stat-card info"><div class="lbl">Total Anggota</div><div class="val">${total}</div></div>
    <div class="stat-card pemasukan"><div class="lbl">Lunas</div><div class="val">${totalLunas}</div></div>
    <div class="stat-card warning"><div class="lbl">Belum Bayar</div><div class="val">${totalBelum}</div></div>
    <div class="stat-card"><div class="lbl">Total Iuran</div><div class="val">${fmtRp(totalNominal)}</div></div>
    <div class="stat-card pemasukan"><div class="lbl">Terkumpul</div><div class="val">${fmtRp(totalTerkumpul)}</div></div>
    <div class="stat-card warning"><div class="lbl">Tunggakan</div><div class="val">${fmtRp(totalNominal - totalTerkumpul)}</div></div></div>`;

  const renderCountCard = (key, s) => {
    const belum = s.total - s.lunas;
    const pct = s.nominal > 0 ? Math.round((s.terkumpul / s.nominal) * 100) : 0;
    return `
    <div class="kategori-card k-${key}">
      <div class="kc-title">${s.label}</div>
      <div class="kc-stats">
        <div class="kc-stat"><span class="n">${s.total}</span><span class="l">Anggota</span></div>
        <div class="kc-stat lunas"><span class="n">${s.lunas}</span><span class="l">Lunas</span></div>
        <div class="kc-stat belum"><span class="n">${belum}</span><span class="l">Belum</span></div>
      </div>
      <div class="kc-progress">
        <div class="kc-progress-bar"><div class="kc-progress-fill" style="width:${pct}%;"></div></div>
        <div class="kc-money"><span>Terkumpul <b>${fmtRp(s.terkumpul)}</b></span><span>dari <b>${fmtRp(s.nominal)}</b></span></div>
      </div>
    </div>`;
  };

  const statKategoriHtml = Object.entries(statKategori).map(([kv, k]) => renderCountCard(kv, k)).join('');
  const statRTHtml = Object.entries(statRT).map(([rv, r]) => renderCountCard(rv, r)).join('');
  const statGenderHtml = Object.entries(statGender).map(([gv, g]) => renderCountCard(gv, g)).join('');

  const filterHtml = `<div class="filter-row">
    <div class="field" style="margin-bottom:0;min-width:150px;"><label style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Kategori</label>
      <select id="filter-kategori" onchange="applyFilter()"><option value="semua" ${filterKategori==='semua'?'selected':''}>Semua</option>${KATEGORI_ANGGOTA.map(k=>`<option value="${k.v}" ${filterKategori===k.v?'selected':''}>${k.l}</option>`).join('')}</select></div>
    <div class="field" style="margin-bottom:0;min-width:150px;"><label style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Status</label>
      <select id="filter-status" onchange="applyFilter()"><option value="semua" ${filterStatus==='semua'?'selected':''}>Semua</option><option value="lunas" ${filterStatus==='lunas'?'selected':''}>Lunas</option><option value="belum_lunas" ${filterStatus==='belum_lunas'?'selected':''}>Belum Bayar</option></select></div>
    <div class="field" style="margin-bottom:0;min-width:150px;"><label style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Jenis Kelamin</label>
      <select id="filter-gender" onchange="applyFilter()"><option value="semua" ${filterGender==='semua'?'selected':''}>Semua</option><option value="pria" ${filterGender==='pria'?'selected':''}>Laki-Laki</option><option value="wanita" ${filterGender==='wanita'?'selected':''}>Perempuan</option><option value="tidak_diketahui" ${filterGender==='tidak_diketahui'?'selected':''}>Tidak diketahui</option></select></div>
    <div class="field" style="margin-bottom:0;min-width:150px;"><label style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">RT</label>
      <select id="filter-rt" onchange="applyFilter()"><option value="semua" ${filterRT==='semua'?'selected':''}>Semua</option>${RT_LIST.map(r=>`<option value="${r.v}" ${filterRT===r.v?'selected':''}>${r.l}</option>`).join('')}</select></div>
    <div class="search-box" style="flex:1;min-width:200px;"><div class="search-input-wrap"><i data-lucide="search" class="inline-icon search-input-icon"></i><input type="text" id="search-input" placeholder="Cari nama..." value="${esc(searchQuery)}" oninput="applySearch()"></div>${searchQuery?`<button class="btn secondary small" ${da('clearSearch')}>✕</button>`:''}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn small" ${da('exportAnggotaCSV')}>⬇ Ekspor CSV</button><button class="btn secondary small" ${da('resetFilter')}>↺ Reset</button></div>
  </div>`;

  const sortIndicator = (field) => { if (sortBy !== field) return '↕'; return sortOrder === 'asc' ? '↑' : '↓'; };

  return `${statCards}<div class="panel"><div class="panel-head"><div><h3>📋 Database Anggota</h3><div class="desc">${totalBelum} anggota belum bayar · total tunggakan ${fmtRp(totalNominal - totalTerkumpul)}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn success small" ${da('tandaiSemuaLunas')} ${!isLoggedIn ? 'disabled' : ''}>✓ Tandai Semua Lunas</button>
      ${isLoggedIn ? `<button class="btn secondary small" ${da('openSalinAnggotaModal')}>📥 Salin dari Event Lain</button>` : ''}
      ${isLoggedIn ? `<button class="btn" ${da('openAnggotaModal')}>+ Tambah</button>` : ''}
    </div></div>
    <div class="panel-body">${filterHtml}${statKategoriHtml?`<div class="kategori-grid" style="margin-bottom:16px;">${statKategoriHtml}</div>`:''}
    ${(statRTHtml||statGenderHtml)?`<div class="stat-section-label">Jumlah Anggota per RT &amp; Jenis Kelamin</div><div class="kategori-grid" style="margin-bottom:16px;">${statRTHtml}${statGenderHtml}</div>`:''}
    <div style="overflow-x:auto;"><table class="database-table"><thead><tr><th class="sortable" ${da('sortTable', 'nama')}>Nama ${sortIndicator('nama')}</th>
      <th class="sortable" ${da('sortTable', 'kategori')}>Kategori ${sortIndicator('kategori')}</th>
      <th class="sortable" ${da('sortTable', 'rt')}>RT ${sortIndicator('rt')}</th>
      <th class="sortable" ${da('sortTable', 'gender')}>Jenis Kelamin ${sortIndicator('gender')}</th>
      <th class="num sortable" ${da('sortTable', 'nominal')}>Nominal ${sortIndicator('nominal')}</th>
      <th class="sortable" ${da('sortTable', 'status')}>Status ${sortIndicator('status')}</th>
      <th class="sortable" ${da('sortTable', 'tanggal')}>Tgl Bayar ${sortIndicator('tanggal')}</th><th></th></tr></thead>
      <tbody>${rows||`<tr class="empty-row"><td colspan="8">${searchQuery?'Tidak ditemukan':'Belum ada anggota'}</td></tr>`}</tbody>
      ${filtered.length>0?`<tfoot><tr><td colspan="4">Total ${filtered.length} anggota</td><td class="num">${fmtRp(totalNominal)}</td><td colspan="3"></td></tr></tfoot>`:''}</table></div></div></div>`;
}

function applyFilter(){ filterKategori=document.getElementById('filter-kategori').value; filterStatus=document.getElementById('filter-status').value; filterGender=document.getElementById('filter-gender').value; filterRT=document.getElementById('filter-rt').value; renderContent(); }
function applySearch(){ searchQuery=document.getElementById('search-input').value; renderContent(); }
function clearSearch(){ searchQuery=''; document.getElementById('search-input').value=''; renderContent(); }
function resetFilter(){ filterKategori='semua'; filterStatus='semua'; filterGender='semua'; filterRT='semua'; searchQuery=''; sortBy='nama'; sortOrder='asc'; renderContent(); }
function sortTable(field){ if(sortBy===field){ sortOrder=sortOrder==='asc'?'desc':'asc'; }else{ sortBy=field; sortOrder='asc'; } renderContent(); }
async function tandaiSemuaLunas(){ 
  if (!canEditSection('database-anggota')) { toast('⛔ Login untuk mengedit data'); return; }
  const list=gAnggota().filter(a=>a.status==='belum_lunas'); 
  if(list.length===0){ toast('Semua anggota sudah lunas'); return; } 
  if(!(await confirmModal(`Tandai ${list.length} anggota menjadi LUNAS?`))) return; 
  list.forEach(a=>{a.status='lunas'; a.tanggal_bayar=todayISO();}); 
  saveDB(); renderContent(); renderTopbarSaldo(); 
  toast(`✓ ${list.length} anggota ditandai lunas`);
  const detail = list.map(a => `${a.nama} (${labelKategori(a.kategori)}) - ${fmtRp(a.nominal_wajib)}`).join('\n');
  notifyTelegram(`✅ ${list.length} anggota ditandai LUNAS`, detail, 'anggota');
}
function exportAnggotaCSV(){ const list=gAnggota(); if(list.length===0){ toast('Tidak ada data'); return; } let csv='No,Nama,Kategori,RT,Jenis Kelamin,Nominal,Status,Tanggal Bayar\n'; list.forEach((a,i)=>{const status=a.status==='lunas'?'Lunas':'Belum Bayar'; const tgl=a.tanggal_bayar?fmtDate(a.tanggal_bayar):'-'; csv+=`${i+1},"${a.nama}",${labelKategori(a.kategori)},${labelRT(getRT(a))},${labelGender(getGender(a))},${a.nominal_wajib},${status},${tgl}\n`;}); const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=`database-anggota-${todayISO()}.csv`; link.click(); toast('CSV berhasil diekspor'); }

/* ============================================================
   SALIN ANGGOTA DARI EVENT LAIN
   Anggota tersimpan per event_id (roster tahunan), jadi anggota yang
   didaftarkan di event tahun lalu tidak otomatis muncul di event baru
   (termasuk di Form Absensi). Fitur ini memindahkan (menyalin) anggota
   terpilih dari event lain ke event yang sedang aktif, dengan:
   - nama yang sudah ada di event aktif otomatis dilewati (anti dobel)
   - nominal iuran dihitung ulang sesuai tarif event aktif (kecuali
     kategori Khusus, nominalnya dipertahankan apa adanya)
   - status iuran direset ke Belum Lunas (event baru = tagihan baru)
   ============================================================ */
function openSalinAnggotaModal(){
  if (!canEditSection('database-anggota')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!eid()){ toast('Pilih event aktif dulu di sidebar'); return; }
  const otherEvents = db.events.filter(e=>e.id!==eid() && db.anggota.some(a=>a.event_id===e.id)).sort((a,b)=>(b.tahun||0)-(a.tahun||0));
  if(otherEvents.length===0){ toast('Belum ada anggota di event lain yang bisa disalin'); return; }
  setModal('📥 Salin Anggota dari Event Lain', `
    <div class="field"><label>Salin dari Event</label>
      <select id="salin-source-event" onchange="renderSalinAnggotaList()">
        ${otherEvents.map(e=>`<option value="${e.id}">${esc(e.nama)}${e.tahun?' ('+e.tahun+')':''}</option>`).join('')}
      </select>
    </div>
    <div class="field-hint" style="color:var(--ink-soft); font-size:12.5px; margin:-2px 0 10px;">Nama yang sudah terdaftar di event aktif otomatis dilewati. Nominal iuran mengikuti tarif event aktif, status iuran direset jadi Belum Lunas.</div>
    <div class="field-row" style="align-items:flex-end;">
      <div class="field"><label>Filter Kategori</label>
        <select id="salin-filter-kategori" onchange="renderSalinAnggotaList()">
          <option value="semua">Semua Kategori</option>
          ${KATEGORI_ANGGOTA.map(k=>`<option value="${k.v}">${k.l}</option>`).join('')}
        </select>
      </div>
      <button class="btn secondary small" type="button" style="margin-bottom:14px;" ${da('centangSalinSesuaiFilter')}>Centang kategori ini saja</button>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
      <label style="font-size:12px; display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" id="salin-pilih-semua" onchange="toggleSalinPilihSemua(this.checked)"> Pilih Semua yang Tampil</label>
      <span id="salin-count-label" style="font-size:12px; color:var(--ink-soft);"></span>
    </div>
    <div id="salin-anggota-list" style="max-height:320px; overflow-y:auto; border:1px solid var(--line); border-radius:8px; padding:4px 8px;"></div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:'Salin Anggota Terpilih', cls:'', onclick:konfirmasiSalinAnggota}
  ]);
  setTimeout(renderSalinAnggotaList, 0);
}
function renderSalinAnggotaList(){
  const sel = document.getElementById('salin-source-event');
  const listEl = document.getElementById('salin-anggota-list');
  const filterEl = document.getElementById('salin-filter-kategori');
  if(!sel || !listEl) return;
  // Simpan status centang yang sudah dipilih user sebelum render ulang
  // (mis. setelah ganti filter kategori), supaya tidak hilang.
  const prevChecked = new Set(Array.from(document.querySelectorAll('.salin-anggota-chk:checked')).map(c=>c.value));
  const isFirstRender = !listEl.dataset.rendered;
  const namaSekarang = new Set(gAnggota().map(a=>a.nama.trim().toLowerCase()));
  const sourceAnggota = db.anggota.filter(a=>a.event_id===sel.value).slice().sort((a,b)=>a.nama.localeCompare(b.nama,'id'));
  listEl.innerHTML = sourceAnggota.length ? sourceAnggota.map(a=>{
    const dobel = namaSekarang.has(a.nama.trim().toLowerCase());
    const dicentang = isFirstRender ? !dobel : prevChecked.has(a.id);
    return `<label data-kategori="${a.kategori}" style="display:flex; align-items:center; gap:8px; padding:6px 2px; ${dobel?'opacity:.5;':''} border-bottom:1px solid var(--line);">
      <input type="checkbox" class="salin-anggota-chk" value="${a.id}" ${dobel?'disabled':(dicentang?'checked':'')} onchange="updateSalinCountLabel()">
      <span style="flex:1;">${esc(a.nama)} <span style="color:var(--ink-soft); font-size:11.5px;">· ${esc(labelKategori(a.kategori))} · ${esc(labelRT(getRT(a)))}</span></span>
      ${dobel?'<span style="font-size:11px;color:var(--ink-soft);">sudah ada</span>':''}
    </label>`;
  }).join('') : `<div class="hint" style="padding:8px 2px;">Event ini belum punya data anggota.</div>`;
  listEl.dataset.rendered = '1';
  applySalinFilterKategori();
}
function applySalinFilterKategori(){
  const filterEl = document.getElementById('salin-filter-kategori');
  const filterVal = filterEl ? filterEl.value : 'semua';
  document.querySelectorAll('#salin-anggota-list > label').forEach(label=>{
    const cocok = filterVal==='semua' || label.dataset.kategori===filterVal;
    label.style.display = cocok ? '' : 'none';
  });
  const selectableCount = document.querySelectorAll('#salin-anggota-list > label:not([style*="display: none"]) .salin-anggota-chk:not(:disabled)').length;
  const pilihSemuaEl = document.getElementById('salin-pilih-semua');
  if(pilihSemuaEl){
    const checkedVisible = document.querySelectorAll('#salin-anggota-list > label:not([style*="display: none"]) .salin-anggota-chk:checked').length;
    pilihSemuaEl.checked = selectableCount>0 && checkedVisible===selectableCount;
  }
  updateSalinCountLabel();
}
function centangSalinSesuaiFilter(){
  // Reset semua centang dulu, lalu centang khusus anggota yang sesuai
  // filter kategori terpilih (kalau "Semua Kategori", ya centang semua).
  document.querySelectorAll('.salin-anggota-chk:not(:disabled)').forEach(c=>c.checked=false);
  document.querySelectorAll('#salin-anggota-list > label:not([style*="display: none"]) .salin-anggota-chk:not(:disabled)').forEach(c=>c.checked=true);
  applySalinFilterKategori();
}
function toggleSalinPilihSemua(checked){
  document.querySelectorAll('#salin-anggota-list > label:not([style*="display: none"]) .salin-anggota-chk:not(:disabled)').forEach(c=>c.checked=checked);
  updateSalinCountLabel();
}
function updateSalinCountLabel(){
  const label = document.getElementById('salin-count-label');
  if(!label) return;
  const total = document.querySelectorAll('.salin-anggota-chk').length;
  const checked = document.querySelectorAll('.salin-anggota-chk:checked').length;
  label.textContent = total ? `${checked} dari ${total} dipilih` : '';
}
function konfirmasiSalinAnggota(){
  const sel = document.getElementById('salin-source-event');
  if(!sel) return;
  const checked = Array.from(document.querySelectorAll('.salin-anggota-chk:checked'));
  if(checked.length===0){ toast('Pilih minimal satu anggota untuk disalin'); return; }
  const sourceEvent = db.events.find(e=>e.id===sel.value);
  const s = getSettings();
  let count = 0;
  checked.forEach(chk=>{
    const src = db.anggota.find(a=>a.id===chk.value);
    if(!src) return;
    const nominal = src.kategori==='khusus' ? Number(src.nominal_wajib||0) : (s.tarif[src.kategori] || 0);
    db.anggota.push({id:uid(), event_id:eid(), nama:src.nama, kategori:src.kategori, rt:getRT(src), gender:src.gender||null, nominal_wajib:nominal, status:'belum_lunas', tanggal_bayar:null});
    count++;
  });
  saveDB(); closeModal(); renderContent(); renderTopbarSaldo();
  toast(`✓ ${count} anggota disalin dari ${sourceEvent?sourceEvent.nama:'event lain'}`);
  notifyTelegram(`📥 Salin ${count} anggota dari event lain`, `Dari: ${sourceEvent?sourceEvent.nama:'-'}\nKe event aktif: ${(activeEvent()||{}).nama||'-'}`, 'anggota');
}

