/* ============================================================
   DATABASE LOMBA
   Tidak terikat event tertentu — halaman ini mengumpulkan SEMUA
   lomba yang pernah diinput di SEMUA event/tahun, dari 2 sumber:
     1. db.lomba & db.lombaKebutuhan — lomba yang MASIH ADA saat ini
        (dimuat penuh lintas event, lihat loadDB() di js/db.js).
     2. db.lombaArsip — snapshot BEKU lomba+perlengkapan yang dibuat
        otomatis saat sebuah lomba DIHAPUS lewat menu Lomba &
        Perlengkapan (lihat hapusLomba() di js/10-lomba.js). Snapshot
        ini tidak ikut terhapus, jadi riwayatnya tetap ada di sini
        SELAMANYA meski lomba aslinya sudah dihapus.
   Keduanya digabung & dikelompokkan berdasarkan NAMA lomba. Tujuannya:
   jadi "contekan" saat bikin lomba yang sama di tahun berikutnya —
   daftar perlengkapan & harga terakhir sudah kelihatan, tinggal
   dipilih item mana yang mau disalin ke event aktif, lalu panitia
   cukup sesuaikan harga/qty-nya (lihat openPakaiLombaModal di bawah).
   Halaman ini tidak bisa dipakai buat edit, dan versi LIVE (lomba yang
   masih aktif di suatu event) juga tidak bisa dihapus dari sini — tetap
   lewat menu Lomba & Perlengkapan di event yang bersangkutan (menghapusnya
   di sana otomatis membuat snapshot arsip baru, bukan menghilangkan
   riwayatnya dari sini).
   Versi ARSIP (yang sudah dihapus dari Lomba & Perlengkapan) BISA dihapus
   permanen langsung dari sini lewat tombol 🗑 di kartunya — dipakai buat
   beresin riwayat yang salah input/dobel. Beda dengan hapus lomba live:
   ini beneran menghilangkan snapshot riwayatnya untuk selamanya, tidak
   membuat arsip baru. Lihat hapusArsipLomba() di bawah.
   ============================================================ */
let dbLombaSearch = '';
let dbLombaKategoriFilter = 'semua';
let dbLombaOpenKeys = new Set();
let dbLombaVersionSel = {};

function dbLombaNormKey(nama){ return String(nama||'').trim().toLowerCase(); }

// Kelompokkan seluruh lomba (live + arsip, lintas event) berdasarkan nama
// (case/spasi diabaikan). Tiap kelompok berisi semua "versi" (satu versi =
// satu lomba di satu event/tahun, baik yang masih ada maupun yang sudah
// dihapus/diarsipkan), dalam bentuk seragam supaya renderDbLombaCard &
// openPakaiLombaModal tidak perlu tahu asalnya dari mana. Diurutkan dari
// tahun terbaru ke terlama supaya versi yang tampil duluan paling relevan.
function dbLombaGroups(){
  const map = new Map();
  const addVersi = (nama, versi) => {
    const namaTrim = String(nama||'').trim();
    if(!namaTrim) return;
    const key = dbLombaNormKey(namaTrim);
    if(!map.has(key)) map.set(key, {key, nama:namaTrim, versions:[]});
    map.get(key).versions.push(versi);
  };

  db.lomba.forEach(l=>{
    const ev = db.events.find(e=>e.id===l.event_id) || null;
    const items = db.lombaKebutuhan.filter(k=>k.lomba_id===l.id)
      .map(k=>({nama_item:k.nama_item, harga_estimasi:k.harga_estimasi, harga_realisasi:k.harga_realisasi, qty:k.qty}));
    addVersi(l.nama, {
      isArsip: false,
      lombaId: l.id,
      kategoriPeserta: l.kategori_peserta,
      jumlahAnggotaRegu: l.jumlah_anggota_regu || 1,
      hadiahPerRegu: !!l.hadiah_per_regu,
      eventLabel: ev ? `${ev.nama}${ev.tahun?' · '+ev.tahun:''}` : 'Event terhapus',
      tahunSort: Number(ev?.tahun||0),
      tanggalSort: String(l.tanggal||''),
      items
    });
  });

  (db.lombaArsip||[]).forEach(a=>{
    addVersi(a.nama, {
      isArsip: true,
      arsipId: a.id,
      kategoriPeserta: a.kategori_peserta,
      jumlahAnggotaRegu: a.jumlah_anggota_regu || 1,
      hadiahPerRegu: !!a.hadiah_per_regu,
      eventLabel: `${a.event_nama || 'Event terhapus'}${a.event_tahun?' · '+a.event_tahun:''} · diarsipkan`,
      tahunSort: Number(a.event_tahun||0),
      tanggalSort: String(a.tanggal_arsip||''),
      items: (a.items||[]).map(k=>({nama_item:k.nama_item, harga_estimasi:k.harga_estimasi, harga_realisasi:k.harga_realisasi, qty:k.qty}))
    });
  });

  const groups = Array.from(map.values());
  groups.forEach(g=>{
    g.versions.sort((a,b)=>{
      if(b.tahunSort !== a.tahunSort) return b.tahunSort - a.tahunSort;
      return b.tanggalSort.localeCompare(a.tanggalSort);
    });
  });
  groups.sort((a,b)=>a.nama.localeCompare(b.nama,'id',{sensitivity:'base'}));
  return groups;
}

function renderDatabaseLomba(){
  const semuaGroups = dbLombaGroups();
  const q = dbLombaSearch.trim().toLowerCase();
  let groups = semuaGroups;
  if(dbLombaKategoriFilter!=='semua') groups = groups.filter(g=>g.versions.some(v=>v.kategoriPeserta===dbLombaKategoriFilter));
  if(q) groups = groups.filter(g=>g.nama.toLowerCase().includes(q));

  const totalItemUnik = new Set();
  semuaGroups.forEach(g=>{
    g.versions.forEach(v=>{
      v.items.forEach(k=> totalItemUnik.add(`${g.key}__${dbLombaNormKey(k.nama_item)}`));
    });
  });

  const statCards = `<div class="stat-grid">
    <div class="stat-card info"><div class="lbl">Nama Lomba Tersimpan</div><div class="val">${semuaGroups.length}</div></div>
    <div class="stat-card"><div class="lbl">Jenis Perlengkapan Tersimpan</div><div class="val">${totalItemUnik.size}</div></div>
  </div>`;

  const filterHtml = `<div class="filter-row">
    <div class="search-box" style="flex:1;min-width:200px;">
      <div class="search-input-wrap"><i data-lucide="search" class="inline-icon search-input-icon"></i><input type="text" id="db-lomba-search" placeholder="Cari nama lomba..." value="${esc(dbLombaSearch)}" oninput="dbLombaApplySearch(this.value)"></div>
    </div>
    <div class="field" style="margin-bottom:0;min-width:170px;">
      <label style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Kategori Peserta</label>
      <select id="db-lomba-filter-kategori" onchange="dbLombaApplyFilter(this.value)">
        <option value="semua" ${dbLombaKategoriFilter==='semua'?'selected':''}>Semua Kategori</option>
        ${KATEGORI_PESERTA.map(k=>`<option value="${k.v}" ${dbLombaKategoriFilter===k.v?'selected':''}>${k.l}</option>`).join('')}
      </select>
    </div>
  </div>`;

  const cardsHtml = groups.map(renderDbLombaCard).join('') || `<div class="empty-row" style="padding:30px;text-align:center;">${q||dbLombaKategoriFilter!=='semua' ? 'Tidak ada lomba yang cocok dengan pencarian/filter.' : 'Belum ada riwayat lomba tersimpan. Data di sini otomatis terisi begitu ada lomba yang diinput lewat menu Lomba & Perlengkapan.'}</div>`;

  return `${statCards}
  <div class="panel">
    <div class="panel-head">
      <div><h3>📚 Database Lomba</h3><div class="desc">Riwayat semua lomba yang pernah diinput beserta perlengkapannya, dari semua tahun/event — dipakai sebagai contekan saat bikin lomba serupa tahun depan. Halaman ini gabungan dari semua event, tidak cuma event aktif, dan tetap menyimpan riwayat lomba yang sudah dihapus.</div></div>
    </div>
    <div class="panel-body">
      ${filterHtml}
      ${cardsHtml}
    </div>
  </div>`;
}

// Hapus PERMANEN satu versi arsip (bukan versi live) dari db.lombaArsip.
// Beda dari hapusLomba() di js/10-lomba.js: itu menghapus lomba yang MASIH
// AKTIF lalu otomatis membuat snapshot arsip baru (riwayatnya justru
// bertambah). Ini sebaliknya — menghapus snapshot riwayat yang sudah ada
// di sini untuk selamanya, tidak bisa dikembalikan (mis. buat beresin
// arsip yang salah input/dobel). Kalau versi arsip yang dihapus adalah
// satu-satunya versi di grup ini, groupKey ikut dibersihkan dari state
// (biar tidak ada kartu kosong nyangkut di UI).
async function hapusArsipLomba(groupKey, arsipId){
  if (!canEditSection('lomba')) { toast('⛔ Login untuk mengedit data'); return; }
  const a = (db.lombaArsip||[]).find(x=>x.id===arsipId);
  if(!a){ toast('Data arsip tidak ditemukan'); return; }
  if(!(await confirmModal(`Hapus permanen riwayat "${a.nama}" (${a.event_nama||'Event terhapus'}${a.event_tahun?' · '+a.event_tahun:''})?\n\nBeda dari hapus lomba biasa: ini menghapus SNAPSHOT ARSIPNYA, jadi riwayatnya hilang selamanya dan tidak bisa dikembalikan.`))) return;
  db.lombaArsip = db.lombaArsip.filter(x=>x.id!==arsipId);
  saveDB();
  const g = dbLombaGroups().find(x=>x.key===groupKey);
  if(!g){ dbLombaOpenKeys.delete(groupKey); delete dbLombaVersionSel[groupKey]; }
  else if(dbLombaVersionSel[groupKey] >= g.versions.length) dbLombaVersionSel[groupKey] = 0;
  renderContent();
  toast(`✓ Riwayat arsip "${a.nama}" dihapus permanen`);
  notifyTelegram(`🗑️ Hapus riwayat arsip lomba: ${a.nama}`, `Snapshot arsip (${a.event_nama||'Event terhapus'}${a.event_tahun?' · '+a.event_tahun:''}) dihapus permanen dari Database Lomba.`, 'lomba');
}

function dbLombaApplySearch(v){ dbLombaSearch = v; renderContent(); }
function dbLombaApplyFilter(v){ dbLombaKategoriFilter = v; renderContent(); }
function dbLombaToggleCard(key){ dbLombaOpenKeys.has(key)?dbLombaOpenKeys.delete(key):dbLombaOpenKeys.add(key); renderContent(); }
function dbLombaPilihVersi(key, idx){ dbLombaVersionSel[key]=idx; dbLombaOpenKeys.add(key); renderContent(); }

function renderDbLombaCard(g){
  const isLoggedIn = !!getCurrentUser();
  const isOpen = dbLombaOpenKeys.has(g.key);
  const selIdx = Math.min(dbLombaVersionSel[g.key]||0, g.versions.length-1);
  const versi = g.versions[selIdx];
  const items = versi.items;
  const subtotal = items.reduce((s,k)=>s+(Number(k.harga_realisasi ?? k.harga_estimasi ?? 0)*Number(k.qty||0)),0);

  const eventChips = g.versions.map((v,i)=>{
    return `<span class="kategori-pill ${i===selIdx?'khusus':''}" style="cursor:pointer;" ${da('dbLombaPilihVersi', g.key, i)} title="Lihat perlengkapan versi ini">${esc(v.eventLabel)}</span>`;
  }).join('');

  return `<div class="lomba-card ${isOpen?'open':''}">
    <div class="lomba-card-head" ${da('dbLombaToggleCard', g.key)} style="cursor:pointer;">
      <div class="lomba-head-title"><span class="name">${esc(g.nama)}</span><span class="lomba-head-tags"><span class="kategori-pill">${labelPeserta(versi.kategoriPeserta)}</span><span class="lomba-badge">${g.versions.length} tahun dipakai</span></span></div>
      <div class="lomba-head-meta">
        <span class="lomba-badge">${items.length} item</span>
        <span class="mono lomba-head-subtotal">${fmtRp(subtotal)}</span>
        <svg class="chevron" width="16" height="16" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
    </div>
    <div class="lomba-card-body">
      <div class="hint" style="margin-bottom:8px;">Pernah dipakai di ${g.versions.length} event — klik salah satu di bawah buat lihat perlengkapan versi tahun itu:</div>
      <div class="lomba-mini-list" style="margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap;">${eventChips}</div>
      ${versi.isArsip ? `<div class="hint" style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <span>🗄️ Versi ini sudah dihapus dari menu Lomba & Perlengkapan — datanya diarsipkan di sini sebagai riwayat.</span>
        <button class="icon-btn" title="Hapus permanen riwayat arsip ini" ${da('hapusArsipLomba', g.key, versi.arsipId)} ${!isLoggedIn ? 'disabled' : ''}>🗑</button>
      </div>` : ''}
      <div style="overflow-x:auto;">
      <table class="lomba-table"><thead><tr><th>Item Perlengkapan</th><th class="num">Harga Terakhir</th><th class="num">Qty</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${items.map(k=>{
        const harga = Number(k.harga_realisasi ?? k.harga_estimasi ?? 0);
        return `<tr><td>${esc(k.nama_item)}</td><td class="num">${fmtRp(harga)}</td><td class="num"><span class="qty-pill">${k.qty}</span></td><td class="num">${fmtRp(harga*k.qty)}</td></tr>`;
      }).join('') || `<tr class="empty-row"><td colspan="4">Belum ada perlengkapan tercatat untuk versi ini.</td></tr>`}</tbody>
      ${items.length?`<tfoot><tr><td colspan="3">Subtotal</td><td class="num">${fmtRp(subtotal)}</td></tr></tfoot>`:''}
      </table></div>
      <div style="margin-top:14px;">
        <button class="btn" ${da('openPakaiLombaModal', g.key, selIdx)}>📥 Pakai Lomba Ini untuk Event Aktif</button>
      </div>
    </div>
  </div>`;
}

/* ============================================================
   PAKAI LOMBA DARI DATABASE → DISALIN KE EVENT AKTIF
   Kalau event aktif belum punya lomba dengan nama sama, dibuatkan
   lomba baru (kategori peserta & jumlah anggota regu ikut versi
   yang dipilih). Kalau sudah ada (mis. sudah sempat ditambah manual),
   item yang belum ada tinggal ditambahkan ke lomba itu — item yang
   namanya sama otomatis dilewati (anti dobel), sama seperti pola
   "Salin dari Event Lain" di Database Anggota. Harga yang disalin
   pakai harga realisasi/estimasi terakhir sebagai titik awal —
   panitia tinggal sesuaikan lagi harga & qty-nya di menu Lomba.
   Dipanggil dengan (groupKey, versionIdx) alih-alih id lomba, supaya
   bisa dipakai juga untuk versi yang sudah diarsipkan (tidak punya
   baris kt_lomba/kt_lomba_kebutuhan lagi) — lihat dbLombaGroups().
   ============================================================ */
function openPakaiLombaModal(groupKey, versionIdx){
  if (!canEditSection('lomba')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!eid()){ toast('Pilih atau buat event aktif dulu di sidebar'); return; }
  const g = dbLombaGroups().find(x=>x.key===groupKey);
  if(!g){ toast('Data lomba tidak ditemukan'); return; }
  const versi = g.versions[versionIdx] || g.versions[0];
  const items = versi.items;
  const existingTarget = gLomba().find(l=>dbLombaNormKey(l.nama)===dbLombaNormKey(g.nama));
  const existingItemNames = existingTarget ? new Set(gKebutuhan(existingTarget.id).map(k=>dbLombaNormKey(k.nama_item))) : new Set();

  const infoText = existingTarget
    ? `Event aktif sudah punya lomba bernama <b>${esc(existingTarget.nama)}</b>. Perlengkapan yang belum ada akan ditambahkan ke lomba itu (item dengan nama sama otomatis dilewati).`
    : `Akan dibuat lomba baru <b>${esc(g.nama)}</b> (${labelPeserta(versi.kategoriPeserta)}${versi.jumlahAnggotaRegu>1?`, beregu ×${versi.jumlahAnggotaRegu}`:''}) di event aktif, lengkap dengan perlengkapan terpilih. Harga yang tersalin adalah harga terakhir tercatat — tinggal disesuaikan lagi kalau ada perubahan harga/kuantitas.`;

  const rowsHtml = items.length ? items.map((k,idx)=>{
    const dobel = existingItemNames.has(dbLombaNormKey(k.nama_item));
    const harga = Number(k.harga_realisasi ?? k.harga_estimasi ?? 0);
    return `<label style="display:flex; align-items:center; gap:8px; padding:6px 2px; ${dobel?'opacity:.5;':''} border-bottom:1px solid var(--line);">
      <input type="checkbox" class="pakai-lomba-item-chk" value="${idx}" ${dobel?'disabled':'checked'} onchange="updatePakaiLombaCountLabel()">
      <span style="flex:1;">${esc(k.nama_item)} <span style="color:var(--ink-soft); font-size:11.5px;">· ${fmtRp(harga)} × ${k.qty}</span></span>
      ${dobel?'<span style="font-size:11px;color:var(--ink-soft);">sudah ada</span>':''}
    </label>`;
  }).join('') : `<div class="hint" style="padding:8px 2px;">Versi lomba ini belum punya data perlengkapan untuk disalin.</div>`;

  setModal(`📥 Pakai "${esc(g.nama)}"`, `
    <div class="hint" style="margin-bottom:12px;">${infoText}</div>
    ${items.length ? `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
      <label style="font-size:12px; display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" id="pakai-lomba-pilih-semua" onchange="togglePakaiLombaPilihSemua(this.checked)"> Pilih Semua Perlengkapan</label>
      <span id="pakai-lomba-count-label" style="font-size:12px; color:var(--ink-soft);"></span>
    </div>` : ''}
    <div style="max-height:320px; overflow-y:auto; border:1px solid var(--line); border-radius:8px; padding:4px 8px;">${rowsHtml}</div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label: existingTarget ? 'Tambahkan ke Lomba' : 'Buat Lomba', cls:'', onclick:()=>konfirmasiPakaiLomba(groupKey, versionIdx, existingTarget?existingTarget.id:null)}
  ]);
  setTimeout(()=>{
    const selectableCount = document.querySelectorAll('.pakai-lomba-item-chk:not(:disabled)').length;
    const pilihSemuaEl = document.getElementById('pakai-lomba-pilih-semua');
    if(pilihSemuaEl) pilihSemuaEl.checked = selectableCount>0;
    updatePakaiLombaCountLabel();
  }, 0);
}
function togglePakaiLombaPilihSemua(checked){
  document.querySelectorAll('.pakai-lomba-item-chk:not(:disabled)').forEach(c=>c.checked=checked);
  updatePakaiLombaCountLabel();
}
function updatePakaiLombaCountLabel(){
  const label = document.getElementById('pakai-lomba-count-label');
  if(!label) return;
  const total = document.querySelectorAll('.pakai-lomba-item-chk').length;
  const checked = document.querySelectorAll('.pakai-lomba-item-chk:checked').length;
  label.textContent = total ? `${checked} dari ${total} dipilih` : '';
}
function konfirmasiPakaiLomba(groupKey, versionIdx, existingTargetId){
  if (!canEditSection('lomba')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!eid()){ toast('Pilih atau buat event aktif dulu di sidebar'); return; }
  const g = dbLombaGroups().find(x=>x.key===groupKey);
  if(!g) return;
  const versi = g.versions[versionIdx] || g.versions[0];
  const items = versi.items;
  const checked = Array.from(document.querySelectorAll('.pakai-lomba-item-chk:checked'));

  let targetLomba = existingTargetId ? db.lomba.find(l=>l.id===existingTargetId) : null;
  let isNew = false;
  if(!targetLomba){
    targetLomba = {
      id: uid(), event_id: eid(), nama: g.nama, kategori_peserta: versi.kategoriPeserta,
      tanggal: null, jam: null,
      jumlah_anggota_regu: versi.jumlahAnggotaRegu||1, hadiah_per_regu: !!versi.hadiahPerRegu,
      estimasi_peserta: 0, koordinator_anggota_id: null, koordinator_anggota_ids: [], jadwal_id: null
    };
    db.lomba.push(targetLomba);
    isNew = true;
  }
  let count = 0;
  checked.forEach(chk=>{
    const src = items[Number(chk.value)];
    if(!src) return;
    const harga_estimasi = Number(src.harga_realisasi ?? src.harga_estimasi ?? 0);
    db.lombaKebutuhan.push({id:uid(), lomba_id:targetLomba.id, nama_item:src.nama_item, harga_estimasi, harga_realisasi:null, qty:src.qty});
    count++;
  });
  saveDB();
  // Lomba bertambah (atau perlengkapan baru masuk) → kebutuhan paket hadiah bisa berubah,
  // sinkronkan stok yang harus dibeli — sama seperti yang dilakukan openLombaModal() di
  // js/10-lomba.js. Sebelumnya jalur "Pakai Lomba Ini" ini terlewat, jadi badge kebutuhan
  // hadiah tidak langsung update setelah bikin lomba baru dari Database Lomba.
  autoSyncHadiahStok(true);
  closeModal();
  openLombaIds.add(targetLomba.id);
  goSection('lomba');
  toast(isNew ? `✓ Lomba "${targetLomba.nama}" dibuat dengan ${count} item perlengkapan — cek lagi harga & qty-nya` : `✓ ${count} item perlengkapan ditambahkan ke "${targetLomba.nama}" — cek lagi harga & qty-nya`);
  notifyTelegram(
    isNew ? `📥 Lomba baru dari Database Lomba: ${targetLomba.nama}` : `📥 Tambah perlengkapan dari Database Lomba: ${targetLomba.nama}`,
    `${count} item perlengkapan disalin dari riwayat lomba tahun sebelumnya (harga masih perlu dicek ulang).`,
    'lomba'
  );
}
