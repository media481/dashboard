/* ============================================================
   LOMBA & KEBUTUHAN (dengan auth check)
   ============================================================ */
let openLombaIds = new Set();
let lombaActiveTab = {};
let _lombaModalEditingId = null; // null saat modal Tambah Lomba, diisi id saat Edit (dipakai buat matiin autofill dari nama tersimpan pas edit)
function getLombaTab(id){ return lombaActiveTab[id] || 'kebutuhan'; }
function setLombaTab(id, tab){ lombaActiveTab[id] = tab; renderContent(); }

function renderLomba(){
  const list = gLomba();
  const totalKebutuhan = db.lombaKebutuhan.filter(k=>list.some(l=>l.id===k.lomba_id))
    .reduce((s,k)=>s + (Number(k.harga_realisasi ?? k.harga_estimasi ?? 0)*Number(k.qty||0)), 0);
  const isLoggedIn = !!getCurrentUser();

  // Ringkasan kelengkapan setup lintas semua lomba (lihat setupChecks di
  // renderLombaCard) — dipakai untuk stat-card "Lomba Siap" di atas daftar,
  // supaya kelihatan berapa lomba yang sudah 100% lengkap tanpa buka satu-satu.
  const juaraUtama = JUARA_LIST.filter(j=>j.v!=='partisipasi');
  const lombaLengkapCount = list.filter(l=>{
    const punyaKebutuhan = gKebutuhan(l.id).length>0;
    const juaraTersedia = juaraUtama.filter(j=>gHadiahKategori().some(h=>h.kategori_peserta===l.kategori_peserta && h.juara_ke===j.v));
    return punyaKebutuhan && juaraTersedia.length===juaraUtama.length && getKoordinatorIds(l).length>0;
  }).length;

  // Kelompokkan lomba berdasarkan jadwal (tanggal). Lomba dengan jam berbeda
  // di tanggal yang sama tetap satu grup, diurutkan berdasarkan jam.
  const grupTanggal = {};
  const tanpaJadwal = [];
  list.forEach(l=>{
    if(l.tanggal){
      (grupTanggal[l.tanggal] = grupTanggal[l.tanggal] || []).push(l);
    } else {
      tanpaJadwal.push(l);
    }
  });
  const tanggalUrut = Object.keys(grupTanggal).sort((a,b)=>a.localeCompare(b));
  tanggalUrut.forEach(tgl=> grupTanggal[tgl].sort((a,b)=>String(a.jam||'').localeCompare(String(b.jam||''))));

  let nomorGlobal = 0;
  function renderLombaCard(l){
    nomorGlobal++;
    const idx = nomorGlobal;
    const items = gKebutuhan(l.id);
    const subtotal = items.reduce((s,k)=>s+(Number(k.harga_realisasi ?? k.harga_estimasi ?? 0)*Number(k.qty||0)),0);
    const isOpen = openLombaIds.has(l.id);
    const activeTab = getLombaTab(l.id);
    const juaraUtama = JUARA_LIST.filter(j=>j.v!=='partisipasi');
    const juaraTersedia = juaraUtama.filter(j=>gHadiahKategori().some(h=>h.kategori_peserta===l.kategori_peserta && h.juara_ke===j.v));
    const hadiahBadge = juaraTersedia.length===0
      ? `<span class="lomba-badge warn">Hadiah belum diatur</span>`
      : (juaraTersedia.length<juaraUtama.length ? `<span class="lomba-badge warn">Hadiah sebagian</span>` : '');
    // Progress kelengkapan setup lomba: 3 aspek yang perlu dilengkapi supaya
    // lomba siap jalan — kebutuhan barang diisi, hadiah diatur lengkap untuk
    // semua juara, dan koordinator sudah ditunjuk. Dipakai untuk progress bar
    // ringkas di kepala kartu supaya kelengkapan tiap lomba kelihatan tanpa
    // perlu buka kartunya satu-satu.
    const setupChecks = [items.length>0, juaraTersedia.length===juaraUtama.length, getKoordinatorIds(l).length>0];
    const setupDone = setupChecks.filter(Boolean).length;
    const setupPct = Math.round(setupDone/setupChecks.length*100);
    const setupColor = setupPct===100 ? 'var(--hijau)' : (setupPct===0 ? 'var(--merah)' : 'var(--orange)');
    return `
    <div class="lomba-card ${isOpen?'open':''}">
      <div class="lomba-card-head" ${da('toggleLombaCard', l.id)} style="cursor:pointer;">
        <div class="lomba-head-title"><span class="nomor-badge kategori-${l.kategori_peserta}">${idx}</span><span class="name">${esc(l.nama)}</span><span class="lomba-head-tags"><span class="kategori-pill">${labelPeserta(l.kategori_peserta)}</span>${l.jam?`<span class="jam-pill">🕐 ${esc(l.jam)}</span>`:''}${Number(l.jumlah_anggota_regu||1)>1?`<span class="kategori-pill khusus">👥 Beregu ×${l.jumlah_anggota_regu}${l.hadiah_per_regu?' · 1 hadiah/regu':''}</span>`:''}</span></div>
        <div class="lomba-head-meta">
          <span class="lomba-badge">${items.length} item</span>
          ${hadiahBadge}
          <span class="mono lomba-head-subtotal">${fmtRp(subtotal)}</span>
          <span class="lomba-progress-wrap" title="Kelengkapan setup: ${setupDone}/${setupChecks.length} (kebutuhan barang, hadiah, koordinator)">
            <span class="lomba-progress-bar"><span class="lomba-progress-fill" style="width:${setupPct}%;background:${setupColor};"></span></span>
            <span class="lomba-progress-txt">${setupDone}/${setupChecks.length}</span>
          </span>
          <span class="lomba-head-actions">
            <button class="icon-btn" ${!isLoggedIn ? 'disabled' : da('openLombaModal', l.id)}>✎</button>
            <button class="icon-btn" ${!isLoggedIn ? 'disabled' : da('hapusLomba', l.id)}>🗑</button>
            <svg class="chevron" width="16" height="16" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </div>
      </div>
      <div class="lomba-card-body">
        <div class="lomba-tabs">
          <button type="button" class="lomba-tabbtn ${activeTab==='kebutuhan'?'active':''}" ${da('setLombaTab', l.id, 'kebutuhan')}>Kebutuhan Barang</button>
          <button type="button" class="lomba-tabbtn ${activeTab==='hadiah'?'active':''}" ${da('setLombaTab', l.id, 'hadiah')}>Hadiah${hadiahBadge?' •':''}</button>
          <button type="button" class="lomba-tabbtn ${activeTab==='koordinator'?'active':''}" ${da('setLombaTab', l.id, 'koordinator')}>Koordinator${getKoordinatorIds(l).length===0?' <span class="lomba-badge warn" style="margin-left:4px;">Belum ada</span>':''}</button>
        </div>

        <div style="display:${activeTab==='kebutuhan'?'block':'none'};">
        <div style="overflow-x:auto;">
        <table class="lomba-table"><thead><tr><th>Item</th><th class="num">Harga</th><th class="num">Qty</th><th class="num">Subtotal</th><th></th></tr></thead>
        <tbody>${items.map(k=>{
          const harga = Number(k.harga_realisasi ?? k.harga_estimasi ?? 0);
          const belanja = db.daftarBelanjaPerlengkapan.find(b=>b.kebutuhan_id===k.id && b.event_id===eid());
          const sudahDibeli = belanja && belanja.status === 'dibeli';
          const hargaCell = k.harga_realisasi!=null ? fmtRp(k.harga_realisasi) : `${fmtRp(k.harga_estimasi)}<span style="color:var(--abu); font-size:11px;"> (estimasi)</span>`;
          return `<tr class="${sudahDibeli?'dibeli':''}"><td>${esc(k.nama_item)} ${sudahDibeli?'<span class="status-dibeli-pill">✓ Dibeli</span>':''}</td><td class="num">${hargaCell}</td><td class="num"><span class="qty-pill">${k.qty}</span></td><td class="num">${fmtRp(harga*k.qty)}</td><td style="text-align:right;white-space:nowrap;">
            <button class="icon-btn" ${!isLoggedIn ? 'disabled' : da('openKebutuhanModal', l.id, k.id)}>✎</button>
            <button class="icon-btn" ${!isLoggedIn ? 'disabled' : da('hapusKebutuhan', k.id)}>🗑</button>
          </td></tr>`;
        }).join('')||`<tr class="empty-row"><td colspan="5">Belum ada kebutuhan.</td></tr>`}</tbody>
        ${items.length?`<tfoot><tr><td colspan="3">Subtotal</td><td class="num">${fmtRp(subtotal)}</td><td></td></tr></tfoot>`:''}</table></div>
        ${isLoggedIn ? `
        <div class="quick-add-row">
          <input id="qa-nama-${l.id}" type="text" placeholder="Nama item baru" onkeydown="if(event.key==='Enter'){event.preventDefault(); tambahKebutuhanCepat('${l.id}');}">
          <input id="qa-harga-${l.id}" type="text" class="currency-input" placeholder="Harga" onkeydown="if(event.key==='Enter'){event.preventDefault(); tambahKebutuhanCepat('${l.id}');}">
          <input id="qa-qty-${l.id}" type="number" min="1" value="1" placeholder="Qty" onkeydown="if(event.key==='Enter'){event.preventDefault(); tambahKebutuhanCepat('${l.id}');}">
          <button class="btn secondary small" ${da('tambahKebutuhanCepat', l.id)}>+ Tambah</button>
        </div>` : ''}
        </div>
        <div style="display:${activeTab==='hadiah'?'block':'none'};">
        ${renderHadiahLombaBlock(l)}
        </div>
        <div style="display:${activeTab==='koordinator'?'block':'none'};">
        ${renderKoordinatorLombaBlock(l, isLoggedIn)}
        </div>
      </div>
    </div>`;
  }

  function renderJadwalGroup(labelHtml, items, extraClass){
    return `<div class="jadwal-group ${extraClass||''}">
      <div class="jadwal-group-header">
        ${labelHtml}
        <span class="jadwal-group-count">${items.length} lomba</span>
      </div>
      <div class="jadwal-group-body">${items.map(renderLombaCard).join('')}</div>
    </div>`;
  }

  const groupsHtml = tanggalUrut.map(tgl=>{
    return renderJadwalGroup(
      `<span class="jadwal-group-icon">🗓️</span><span class="jadwal-group-title">${fmtDateHari(tgl)}</span>`,
      grupTanggal[tgl]
    );
  }).join('')
  + (tanpaJadwal.length ? renderJadwalGroup(
      `<span class="jadwal-group-icon">❔</span><span class="jadwal-group-title">Belum Dijadwalkan</span>`,
      tanpaJadwal,
      'jadwal-group-none'
    ) : '');

  return `<div class="stat-grid"><div class="stat-card pengeluaran"><div class="lbl">Total Kebutuhan</div><div class="val">${fmtRp(totalKebutuhan)}</div></div>${list.length ? `<div class="stat-card${lombaLengkapCount<list.length ? ' stok-lebih' : ' saldo'}"><div class="lbl">Lomba Siap</div><div class="val">${lombaLengkapCount}/${list.length}</div><div style="font-size:11px; color:var(--abu); margin-top:4px;">Kebutuhan barang + hadiah + koordinator lengkap</div></div>` : ''}</div>
  <div class="panel"><div class="panel-head"><div><h3>Daftar Lomba</h3><div class="desc">Dikelompokkan berdasarkan jadwal · klik kartu untuk buka rincian</div></div>${isLoggedIn ? `<button class="btn" ${da('openLombaModal')}>+ Tambah Lomba</button>` : ''}</div>
  <div class="panel-body">${groupsHtml||`<div class="empty-row" style="padding:30px;text-align:center;">Belum ada lomba.</div>`}</div></div>`;
}
function labelPeserta(v){ return (KATEGORI_PESERTA.find(k=>k.v===v)||{}).l || v; }
function toggleLombaCard(id){ openLombaIds.has(id)?openLombaIds.delete(id):openLombaIds.add(id); renderContent(); }

function tambahKebutuhanCepat(lombaId){
  if (!canEditSection('lomba')) { toast('⛔ Login untuk mengedit data'); return; }
  const namaEl = document.getElementById(`qa-nama-${lombaId}`);
  const hargaEl = document.getElementById(`qa-harga-${lombaId}`);
  const qtyEl = document.getElementById(`qa-qty-${lombaId}`);
  const nama_item = namaEl.value.trim();
  const harga_estimasi = getCurrencyValue(hargaEl);
  const qty = Number(qtyEl.value || 1);
  if(!nama_item || qty<=0){ toast('Nama & qty wajib diisi'); return; }
  db.lombaKebutuhan.push({id:uid(), lomba_id:lombaId, nama_item, harga_estimasi, harga_realisasi:null, qty});
  saveDB(); openLombaIds.add(lombaId); lombaActiveTab[lombaId]='kebutuhan'; renderContent(); renderTopbarSaldo(); toast('Disimpan');
  const lomba = db.lomba.find(x=>x.id===lombaId);
  notifyTelegram(`➕ Item kebutuhan baru: ${nama_item}`, `Lomba: ${lomba?.nama || lombaId}\nQty: ${qty}\nEstimasi: ${fmtRp(harga_estimasi)}`, 'lomba');
}

// Paket hadiah tidak lagi dipilih manual per lomba — otomatis mengikuti kategori peserta lomba.
// Blok ini menampilkan (read-only) rincian item + qty dari paket yang otomatis berlaku untuk lomba ini.
// Ikon dipilih dari emoji yang SUDAH dipetakan di EMOJI_ICON_MAP (js/21-icons-lucide.js)
// supaya otomatis dikonversi jadi SVG Lucide selaras dengan seluruh icon lain di app —
// BUKAN emoji medali (🥇🥈🥉) yang tidak ada di peta itu dan akan tampil sebagai emoji
// bawaan OS (beda gaya/warna tiap perangkat, tidak seragam dengan icon system app).
// Juara 1-3 pakai icon yang SAMA (trophy), dibedakan lewat warna teks (emas/perak/
// perunggu di CSS .juara-tag-1/2/3) — Partisipasi pakai icon "users" karena hadiahnya
// untuk semua peserta, bukan pemenang.
const JUARA_MEDAL = {'1':'🏆','2':'🏆','3':'🏆','partisipasi':'👥'};
function renderHadiahLombaBlock(lomba){
  const rows = JUARA_LIST.map(j=>{
    const opsi = gHadiahKategori().filter(h=> h.kategori_peserta===lomba.kategori_peserta && h.juara_ke===j.v);
    const itemsFlat = opsi.flatMap(h=>h.items);
    const isiPaket = itemsFlat.length
      ? `<div class="juara-items">${itemsFlat.map(item=>`<span class="juara-item-chip">${esc(item.nama)}<b>×${item.qty_per_paket||1}</b></span>`).join('')}</div>`
      : `<span class="hint">Belum ada paket</span>`;
    return `<div class="juara-row"><div class="juara-tag juara-tag-${j.v}"><span class="juara-medal">${JUARA_MEDAL[j.v]||'🏅'}</span>${j.l}</div>${isiPaket}</div>`;
  }).join('');
  const noStok = gHadiahKategori().filter(h=>h.kategori_peserta===lomba.kategori_peserta).length === 0;
  return `<div class="hint" style="margin-bottom:8px;">Paket hadiah berlaku otomatis untuk semua lomba kategori ${labelPeserta(lomba.kategori_peserta)}, bukan cuma lomba ini — kelola dari menu Hadiah.</div>${rows}${noStok?`<div class="hint" style="margin-top:8px;">Belum ada paket hadiah untuk kategori ini. <a style="color:var(--merah);font-weight:600;cursor:pointer;" ${da('goSection', 'hadiah')}>Tambah di sini</a></div>`:''}`;
}

// Koordinator lomba diambil dari Database Anggota (bukan input bebas), supaya
// datanya konsisten dan bisa dilacak. Satu lomba bisa punya lebih dari satu
// koordinator, disimpan sebagai array id di koordinator_anggota_ids (lihat
// supabase-lomba-koordinator-multi-migration.sql). Kolom lama
// koordinator_anggota_id (tunggal) tetap diisi = koordinator pertama, untuk
// kompatibilitas mundur.
function getKoordinatorIds(lomba){
  if(Array.isArray(lomba.koordinator_anggota_ids)) return lomba.koordinator_anggota_ids.filter(Boolean);
  return lomba.koordinator_anggota_id ? [lomba.koordinator_anggota_id] : [];
}
function renderKoordinatorLombaBlock(lomba, isLoggedIn){
  const anggotaList = gAnggota().slice().sort((a,b)=>(a.nama||'').localeCompare(b.nama||'', 'id', {sensitivity:'base'}));
  if(anggotaList.length===0){
    return `<div class="hint">Belum ada data di Database Anggota untuk event ini. <a style="color:var(--merah);font-weight:600;cursor:pointer;" ${da('goSection', 'database-anggota')}>Tambah di sini</a></div>`;
  }
  const koordinatorIds = getKoordinatorIds(lomba);
  const koordinatorList = koordinatorIds.map(id=>db.anggota.find(a=>a.id===id)).filter(Boolean);
  const sisaAnggota = anggotaList.filter(a=>!koordinatorIds.includes(a.id));

  const listHtml = koordinatorList.length ? `<div class="koordinator-list">${koordinatorList.map(k=>`
    <div class="koordinator-chip">
      <span class="koordinator-avatar">${esc((k.nama||'?').trim().charAt(0).toUpperCase())}</span>
      <span class="koordinator-nama">${esc(k.nama)}</span>
      <button class="icon-btn" ${!isLoggedIn?'disabled':da('hapusKoordinatorLomba', lomba.id, k.id)} title="Hapus koordinator">✕</button>
    </div>`).join('')}</div>` : `<div class="hint">Belum ada koordinator dipilih untuk lomba ini.</div>`;

  const addRow = !isLoggedIn ? '' : (sisaAnggota.length ? `
  <div class="field combo" style="max-width:360px;margin-top:12px;margin-bottom:0;position:relative;">
    <button type="button" id="koordinator-add-trigger-${lomba.id}" class="combo-trigger placeholder" ${da('toggleKoordinatorCombo', lomba.id)}>
      <span class="combo-trigger-label">-- Pilih Anggota --</span>
      ${comboIconChevron()}
    </button>
  </div>` : `<div class="hint" style="margin-top:10px;">Semua anggota sudah jadi koordinator lomba ini.</div>`);

  return `${listHtml}${addRow}`;
}

// ===== Combo dropdown pencarian anggota (untuk pilih koordinator lomba) =====
function comboIconChevron(){
  return `<svg class="combo-chevron" width="15" height="15" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function comboIconSearch(){
  return `<svg width="15" height="15" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" fill="none"/><path d="m21 21-4.34-4.34" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;
}
let _koordComboLombaId = null;
let _koordComboPanelEl = null;
let _koordComboSearch = '';
function koordComboPositionPanel(trigger, panel){
  const rect = trigger.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const panelWidth = Math.min(vw - 16, Math.max(rect.width, 280));
  panel.style.left = Math.max(8, rect.left) + 'px';
  panel.style.width = panelWidth + 'px';
  const panelH = panel.offsetHeight || 300;
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
function koordComboOptionsHtml(lombaId){
  const lomba = db.lomba.find(l=>l.id===lombaId);
  if(!lomba) return '';
  const koordinatorIds = getKoordinatorIds(lomba);
  const anggotaList = gAnggota().slice().sort((a,b)=>(a.nama||'').localeCompare(b.nama||'', 'id', {sensitivity:'base'}));
  const sisaAnggota = anggotaList.filter(a=>!koordinatorIds.includes(a.id));
  const key = _koordComboSearch.trim().toLowerCase();
  const filtered = key ? sisaAnggota.filter(a=>(a.nama||'').toLowerCase().includes(key)) : sisaAnggota;
  const optionsHtml = filtered.map(a=>`<button type="button" class="combo-option" ${da('pilihKoordinatorCombo', lombaId, a.id)}>
      <span class="combo-option-main"><span class="combo-option-name">${esc(a.nama)}</span></span>
      ${a.rt?`<span class="combo-option-side"><span class="combo-option-sisa">${esc(labelRT(getRT(a)))}</span></span>`:''}
    </button>`).join('');
  return optionsHtml || `<div class="combo-empty">${sisaAnggota.length ? 'Tidak ditemukan.' : 'Semua anggota sudah jadi koordinator.'}</div>`;
}
function koordComboPanelHtml(lombaId){
  return `
    <div class="combo-search-wrap">
      <span class="combo-search-icon">${comboIconSearch()}</span>
      <input type="text" class="combo-search-input" placeholder="Cari nama anggota..." value="${esc(_koordComboSearch)}" oninput="onKoordComboSearch('${lombaId}', this.value)">
    </div>
    <div class="combo-list" data-combo-list>${koordComboOptionsHtml(lombaId)}</div>`;
}
function toggleKoordinatorCombo(lombaId){
  const trigger = document.getElementById(`koordinator-add-trigger-${lombaId}`);
  if(!trigger) return;
  if(_koordComboLombaId === lombaId){ closeKoordinatorCombo(); return; }
  closeKoordinatorCombo();
  _koordComboSearch = '';
  const panel = document.createElement('div');
  panel.className = 'combo-panel combo-panel-floating';
  panel.id = 'koordinator-combo-floating';
  panel.innerHTML = koordComboPanelHtml(lombaId);
  document.body.appendChild(panel);
  koordComboPositionPanel(trigger, panel);
  requestAnimationFrame(()=>{
    panel.classList.add('show');
    const input = panel.querySelector('.combo-search-input');
    if(input) input.focus();
  });
  trigger.classList.add('open');
  _koordComboLombaId = lombaId;
  _koordComboPanelEl = panel;
}
function closeKoordinatorCombo(){
  if(_koordComboPanelEl){ _koordComboPanelEl.remove(); _koordComboPanelEl = null; }
  if(_koordComboLombaId!==null){
    const trigger = document.getElementById(`koordinator-add-trigger-${_koordComboLombaId}`);
    if(trigger) trigger.classList.remove('open');
  }
  _koordComboLombaId = null;
}
function onKoordComboSearch(lombaId, value){
  _koordComboSearch = value;
  if(!_koordComboPanelEl) return;
  const list = _koordComboPanelEl.querySelector('[data-combo-list]');
  if(list) list.innerHTML = koordComboOptionsHtml(lombaId);
}
function pilihKoordinatorCombo(lombaId, anggotaId){
  if (!canEditSection('lomba')) { toast('⛔ Login untuk mengedit data'); return; }
  const lomba = db.lomba.find(l=>l.id===lombaId);
  if(!lomba) return;
  const ids = getKoordinatorIds(lomba);
  if(ids.includes(anggotaId)){ toast('Sudah jadi koordinator'); return; }
  ids.push(anggotaId);
  lomba.koordinator_anggota_ids = ids;
  lomba.koordinator_anggota_id = ids[0] || null;
  closeKoordinatorCombo();
  saveDB(); renderContent(); toast('Koordinator ditambahkan');
  const anggota = db.anggota.find(a=>a.id===anggotaId);
  notifyTelegram(`👤 Koordinator lomba ditambahkan: ${lomba.nama}`, anggota ? `Koordinator: ${anggota.nama}` : '', 'lomba');
}
document.addEventListener('click', (e)=>{
  if(e.target.closest('.combo-panel-floating') || e.target.closest('[id^="koordinator-add-trigger-"]')) return;
  closeKoordinatorCombo();
});
window.addEventListener('resize', ()=>{
  if(_koordComboLombaId===null || !_koordComboPanelEl) return;
  const trigger = document.getElementById(`koordinator-add-trigger-${_koordComboLombaId}`);
  if(!trigger || !document.body.contains(trigger)){ closeKoordinatorCombo(); return; }
  koordComboPositionPanel(trigger, _koordComboPanelEl);
});
function hapusKoordinatorLomba(lombaId, anggotaId){
  if (!canEditSection('lomba')) { toast('⛔ Login untuk mengedit data'); return; }
  const lomba = db.lomba.find(l=>l.id===lombaId);
  if(!lomba) return;
  const ids = getKoordinatorIds(lomba).filter(id=>id!==anggotaId);
  lomba.koordinator_anggota_ids = ids;
  lomba.koordinator_anggota_id = ids[0] || null;
  saveDB(); renderContent(); toast('Koordinator dihapus');
  const anggota = db.anggota.find(a=>a.id===anggotaId);
  notifyTelegram(`🗑️ Koordinator lomba dihapus: ${lomba.nama}`, anggota ? `Koordinator: ${anggota.nama}` : '', 'lomba');
}

// Sinkronkan satu entri Jadwal & Reminder otomatis untuk lomba ini berdasarkan
// field `tanggal`. Dilacak lewat `lomba.jadwal_id` supaya edit tanggal tidak
// bikin entri duplikat, dan menghapus tanggal akan menghapus entri jadwal-nya.
// Entri jadwal ikut terikat event_id lomba (beda dari Agenda Kegiatan yang
// tidak terikat event sama sekali).
function syncAgendaLomba(lomba){
  const judul = `Lomba: ${lomba.nama}`;
  const deskripsi = `Otomatis dibuat dari data lomba (kategori: ${labelPeserta(lomba.kategori_peserta)}).`;
  if(lomba.tanggal){
    const existing = lomba.jadwal_id ? db.jadwal.find(j=>j.id===lomba.jadwal_id) : null;
    if(existing){
      // Refresh semua field yang bersumber dari lomba (termasuk deskripsi, supaya
      // tidak basi kalau kategori_peserta lomba diganti belakangan). Field yang
      // BUKAN milik lomba (mis. status selesai/aktif) sengaja tidak disentuh di sini.
      existing.judul = judul; existing.tanggal = lomba.tanggal; existing.jam = lomba.jam || null; existing.deskripsi = deskripsi;
    } else {
      const jadwalEntry = {id:uid(), event_id:lomba.event_id, judul, tanggal:lomba.tanggal, jam:lomba.jam || null, kategori:'acara', deskripsi, status:'aktif'};
      db.jadwal.push(jadwalEntry);
      lomba.jadwal_id = jadwalEntry.id;
    }
  } else if(lomba.jadwal_id){
    db.jadwal = db.jadwal.filter(j=>j.id!==lomba.jadwal_id);
    lomba.jadwal_id = null;
  }
}

// Reverse lookup: entri Jadwal mana yang otomatis mengikuti lomba tertentu.
// Dipakai di menu Jadwal Kegiatan untuk mengunci edit/hapus entri auto ini,
// supaya tidak ada drift antara data Lomba dan Jadwal (lihat catatan di
// syncAgendaLomba di atas — sinkronisasi selalu satu arah: Lomba -> Jadwal).
function getLombaForJadwal(jadwalId){
  return db.lomba.find(l=>l.jadwal_id===jadwalId) || null;
}

// ===== Combo dropdown saran Nama Lomba (pengganti <input list> datalist bawaan
// browser, yang tampilannya "mengambang"/beda gaya di tiap browser). Beda dari
// combo Pilih Anggota di atas: field ini tetap input teks bebas (boleh ketik
// nama baru), dropdown cuma nyaranin nama yang udah pernah dipakai. =====
function lombaNamaComboOptionsHtml(query){
  const groups = (typeof dbLombaGroups==='function') ? dbLombaGroups() : [];
  const key = String(query||'').trim().toLowerCase();
  const filtered = key ? groups.filter(g=>g.nama.toLowerCase().includes(key)) : groups;
  if(!filtered.length){
    return `<div class="combo-empty">${groups.length ? 'Tidak ada nama yang cocok — lanjutkan ketik untuk buat lomba/database baru.' : 'Belum ada riwayat lomba tersimpan.'}</div>`;
  }
  return filtered.slice(0,50).map(g=>{
    const versi = g.versions[0];
    return `<button type="button" class="combo-option" data-lomba-nama-key="${esc(g.key)}">
      <span class="combo-option-main"><span class="combo-option-name">${esc(g.nama)}</span></span>
      <span class="combo-option-side"><span class="combo-option-sisa">${g.versions.length}× · ${esc(versi.eventLabel)}</span></span>
    </button>`;
  }).join('');
}
let _lombaNamaComboPanelEl = null;
function lombaNamaComboPositionPanel(inputEl, panel){
  const rect = inputEl.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const panelWidth = Math.min(vw - 16, Math.max(rect.width, 260));
  panel.style.left = Math.max(8, rect.left) + 'px';
  panel.style.width = panelWidth + 'px';
  const panelH = panel.offsetHeight || 260;
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
function openLombaNamaCombo(){
  const input = document.getElementById('f-nama');
  if(!input) return;
  if(_lombaNamaComboPanelEl){ lombaNamaComboPositionPanel(input, _lombaNamaComboPanelEl); return; }
  const panel = document.createElement('div');
  panel.className = 'combo-panel combo-panel-floating';
  panel.id = 'lomba-nama-combo-floating';
  panel.innerHTML = `<div class="combo-list" data-combo-list>${lombaNamaComboOptionsHtml(input.value)}</div>`;
  panel.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-lomba-nama-key]');
    if(!btn) return;
    pilihLombaNamaCombo(btn.dataset.lombaNamaKey);
  });
  document.body.appendChild(panel);
  lombaNamaComboPositionPanel(input, panel);
  requestAnimationFrame(()=>panel.classList.add('show'));
  _lombaNamaComboPanelEl = panel;
}
function closeLombaNamaCombo(){
  if(_lombaNamaComboPanelEl){ _lombaNamaComboPanelEl.remove(); _lombaNamaComboPanelEl = null; }
}
function refreshLombaNamaCombo(value){
  if(!_lombaNamaComboPanelEl) return;
  const list = _lombaNamaComboPanelEl.querySelector('[data-combo-list]');
  if(list) list.innerHTML = lombaNamaComboOptionsHtml(value);
}
function pilihLombaNamaCombo(key){
  const groups = (typeof dbLombaGroups==='function') ? dbLombaGroups() : [];
  const g = groups.find(x=>x.key===key);
  if(!g) return;
  const input = document.getElementById('f-nama');
  if(input){ input.value = g.nama; onLombaNamaInput(g.nama); input.focus(); }
  closeLombaNamaCombo();
}
document.addEventListener('click', (e)=>{
  if(e.target.closest('.combo-panel-floating') || e.target.id==='f-nama') return;
  closeLombaNamaCombo();
});
document.addEventListener('keydown', (e)=>{
  if(e.key==='Escape') closeLombaNamaCombo();
});
window.addEventListener('resize', ()=>{
  if(!_lombaNamaComboPanelEl) return;
  const input = document.getElementById('f-nama');
  if(!input || !document.body.contains(input)){ closeLombaNamaCombo(); return; }
  lombaNamaComboPositionPanel(input, _lombaNamaComboPanelEl);
});

function openLombaModal(id){
  if (!canEditSection('lomba')) { toast('⛔ Login untuk mengedit data'); return; }
  const editing = id ? db.lomba.find(l=>l.id===id) : null;
  _lombaModalEditingId = editing ? editing.id : null;
  const anggotaAwal = editing?(editing.jumlah_anggota_regu||1):1;
  const hadiahPerReguAwal = editing ? !!editing.hadiah_per_regu : false;
  const estimasiPesertaAwal = editing?(editing.estimasi_peserta||''):'';
  const tanggalAwal = editing?(editing.tanggal||''):'';
  const jamAwal = editing?(editing.jam||''):'';
  const namaHintDefault = editing ? 'Ganti nama kalau perlu.' : 'Pilih lomba dari daftar yang sudah ada atau buat lomba baru.';
  setModal(editing?'Edit Lomba':'Tambah Lomba', `<div class="field combo" style="position:relative;"><label>Nama Lomba</label><input id="f-nama" type="text" autocomplete="off" placeholder="Pilih dari daftar atau ketik nama baru" value="${editing?esc(editing.nama):''}" oninput="onLombaNamaInput(this.value)" onfocus="openLombaNamaCombo()"><div class="hint" id="f-nama-hint">${namaHintDefault}</div></div><div class="field-row"><div class="field"><label>Tanggal Lomba (opsional)</label><input id="f-tanggal" type="date" value="${tanggalAwal}"></div><div class="field"><label>Jam (opsional)</label><input id="f-jam" type="time" value="${jamAwal}"></div></div><div class="hint" style="margin:-8px 0 14px;">Kalau tanggal diisi, otomatis dibuatkan/diperbarui pengingat di menu Jadwal & Reminder — lengkap dengan hari dan jamnya kalau diisi.</div><div class="field"><label>Kategori Peserta</label><select id="f-kategori">${KATEGORI_PESERTA.map(k=>`<option value="${k.v}" ${editing&&editing.kategori_peserta===k.v?'selected':''}>${k.l}</option>`).join('')}</select></div><div class="field"><label>Jumlah Anggota per Regu</label><input id="f-anggota" type="number" min="1" value="${anggotaAwal}" oninput="toggleHadiahPerReguHint()"><div class="hint">Isi 1 jika lomba perorangan. Jika lomba beregu (misal 1 regu = 5 orang), isi 5.</div></div><div class="field" id="f-hadiah-per-regu-wrap" style="display:${anggotaAwal>1?'block':'none'};"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="f-hadiah-per-regu" ${hadiahPerReguAwal?'checked':''} style="width:auto;"> Hadiah 1 paket untuk seluruh regu (bukan per anggota)</label><div class="hint">Dicentang: kebutuhan hadiah lomba ini dihitung 1 paket saja meski jumlah anggota regu lebih dari 1. Tidak dicentang (default): kebutuhan hadiah dikalikan jumlah anggota regu (tiap anggota dapat paket sendiri).</div></div><div class="field"><label>Estimasi Jumlah Peserta (opsional)</label><input id="f-estimasi-peserta" type="number" min="0" value="${estimasiPesertaAwal}" placeholder="mis. 30"><div class="hint">Cuma buat hitung otomatis kebutuhan hadiah PARTISIPASI (dibagi rata ke semua peserta, beda dari hadiah Juara 1-3 di atas). Kosongkan kalau hadiah partisipasi mau diatur manual seperti biasa. Kalau diisi, isi juga untuk lomba lain sekategori supaya totalnya akurat (yang belum diisi dianggap 0 peserta).</div></div>`, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:editing?'Simpan':'Tambah', cls:'', onclick:async ()=>{
      const nama=document.getElementById('f-nama').value.trim(); const kategori_peserta=document.getElementById('f-kategori').value; 
      const tanggal = document.getElementById('f-tanggal').value || null;
      const jam = document.getElementById('f-jam').value || null;
      const jumlah_anggota_regu=Math.max(1, Number(document.getElementById('f-anggota').value||1));
      const hadiah_per_regu = jumlah_anggota_regu>1 && !!document.getElementById('f-hadiah-per-regu').checked;
      const estimasi_peserta = Math.max(0, Number(document.getElementById('f-estimasi-peserta').value||0));
      if(!nama){toast('Nama wajib');return;}
      // Cek duplikat: nama yang sama (case/spasi diabaikan) udah ada di event AKTIF?
      // Cuma dicek pas Tambah (bukan Edit — karena pas edit boleh aja nama akhirnya
      // sama kayak lomba lain kalau memang disengaja, jarang kejadian). Beda dari
      // dropdown Nama Lomba di atas yang nyari ke SEMUA event (buat nyontek data
      // lama), cek ini spesifik ke event yang lagi aktif aja — tujuannya nyegah
      // kejadian nggak sengaja klik Tambah 2x jadi 2 lomba nyangkut nama sama.
      if(!editing){
        const existingSama = gLomba().find(l=>dbLombaNormKey(l.nama)===dbLombaNormKey(nama));
        if(existingSama){
          const lanjut = await confirmModal(`⚠️ Lomba "${existingSama.nama}" dengan nama yang sama udah ada di event aktif.\n\nKalau maksudnya nambah perlengkapan buat lomba itu, batalkan dulu lalu buka lomba yang sudah ada itu lewat menu Lomba & Perlengkapan (biar nggak kepisah jadi 2 entri).\n\nKalau memang sengaja mau bikin lomba terpisah dengan nama sama (misal kategori pesertanya beda), lanjutkan simpan?`, {danger:false});
          if(!lanjut) return;
        }
      }
      let actionMsg = editing ? `✏️ Edit lomba: ${editing.nama} → ${nama}` : `➕ Lomba baru: ${nama}`;
      let lombaRecord;
      let itemsDisalinCount = 0;
      if(editing){ 
        editing.nama=nama; editing.kategori_peserta=kategori_peserta; editing.tanggal=tanggal; editing.jam=jam; editing.jumlah_anggota_regu=jumlah_anggota_regu; editing.hadiah_per_regu=hadiah_per_regu; editing.estimasi_peserta=estimasi_peserta;
        lombaRecord = editing;
      }
      else{
        lombaRecord = {id:uid(),event_id:eid(),nama,kategori_peserta,tanggal,jam,jumlah_anggota_regu,hadiah_per_regu,estimasi_peserta,koordinator_anggota_id:null,koordinator_anggota_ids:[],jadwal_id:null};
        db.lomba.push(lombaRecord);
        // Nama cocok riwayat Database Lomba? Salin juga perlengkapannya (harga & qty
        // terakhir tercatat) supaya bener-bener "pakai data lomba lama", nggak cuma
        // kategori/jumlah anggota — sama seperti tombol "Pakai Lomba Ini" di menu
        // Database Lomba, tapi otomatis karena panitia sudah pilih nama itu di sini.
        const groups = (typeof dbLombaGroups==='function') ? dbLombaGroups() : [];
        const g = groups.find(x=>x.key===dbLombaNormKey(nama));
        if(g){
          const versi = g.versions[0];
          (versi.items||[]).forEach(src=>{
            const harga_estimasi = Number(src.harga_realisasi ?? src.harga_estimasi ?? 0);
            db.lombaKebutuhan.push({id:uid(), lomba_id:lombaRecord.id, nama_item:src.nama_item, harga_estimasi, harga_realisasi:null, qty:src.qty});
            itemsDisalinCount++;
          });
        }
      }
      syncAgendaLomba(lombaRecord);
      saveDB();
      // Lomba bertambah/berubah → kebutuhan paket hadiah berubah, sinkronkan stok yang harus dibeli.
      autoSyncHadiahStok(true);
      closeModal(); renderContent(); renderTopbarSaldo();
      toast(itemsDisalinCount>0 ? `✓ Disimpan — ${itemsDisalinCount} perlengkapan tersalin dari data lomba lama, cek lagi harga & qty-nya` : 'Disimpan');
      notifyTelegram(actionMsg, `Kategori: ${labelPeserta(kategori_peserta)}${tanggal?`\nJadwal: ${fmtDateJam(tanggal, jam)}`:''}\nAnggota/regu: ${jumlah_anggota_regu}${hadiah_per_regu?' (1 hadiah untuk seluruh regu)':''}${estimasi_peserta>0?`\nEstimasi peserta: ${estimasi_peserta}`:''}${itemsDisalinCount>0?`\nPerlengkapan tersalin dari data lama: ${itemsDisalinCount} item (harga masih perlu dicek ulang)`:''}`, 'lomba');
    }}
  ]);
}
// Dipanggil tiap kali input Nama Lomba berubah. Kalau namanya cocok (case/spasi
// diabaikan) sama salah satu nama di Database Lomba (gabungan lomba aktif + arsip,
// lintas event — lihat dbLombaGroups() di js/10b-database-lomba.js), otomatis isi
// Kategori Peserta & Jumlah Anggota Regu dari versi terakhirnya sebagai titik awal,
// supaya panitia tinggal pakai/salin data lomba lama tanpa isi ulang dari nol.
// Hanya jalan pas mode Tambah (bukan Edit), dan panitia tetap bebas ketik nama baru
// buat bikin lomba/database lomba baru — datalist cuma nyaranin, bukan wajib pilih.
function onLombaNamaInput(value){
  refreshLombaNamaCombo(value);
  const hintEl = document.getElementById('f-nama-hint');
  if(_lombaModalEditingId){ if(hintEl) hintEl.textContent = 'Ganti nama kalau perlu.'; return; }
  const groups = (typeof dbLombaGroups==='function') ? dbLombaGroups() : [];
  const key = (typeof dbLombaNormKey==='function') ? dbLombaNormKey(value) : String(value||'').trim().toLowerCase();
  const g = key ? groups.find(x=>x.key===key) : null;
  if(g){
    const versi = g.versions[0];
    const kategoriEl = document.getElementById('f-kategori');
    const anggotaEl = document.getElementById('f-anggota');
    const hadiahEl = document.getElementById('f-hadiah-per-regu');
    if(kategoriEl) kategoriEl.value = versi.kategoriPeserta;
    if(anggotaEl){ anggotaEl.value = versi.jumlahAnggotaRegu||1; toggleHadiahPerReguHint(); }
    if(hadiahEl) hadiahEl.checked = !!versi.hadiahPerRegu;
    const jumlahItem = (versi.items||[]).length;
    const kategoriTerpakai = Array.from(new Set(g.versions.map(v=>v.kategoriPeserta))).map(k=>labelPeserta(k));
    const kategoriNote = kategoriTerpakai.length>1
      ? ` Nama ini pernah dipakai buat kategori berbeda (${kategoriTerpakai.join(', ')}) — kalau kategorinya mau beda dari yang ke-isi otomatis, tinggal ganti dropdown Kategori Peserta di bawah, perlengkapan tetap ikut tersalin.`
      : '';
    if(hintEl) hintEl.textContent = `📚 Nama ini pernah dipakai di ${g.versions.length} event (terakhir: ${versi.eventLabel}) — Kategori & Jumlah Anggota otomatis diisi, dan ${jumlahItem} perlengkapan dari data terakhir bakal ikut tersalin pas disimpan. Cek lagi harga & qty-nya nanti.${kategoriNote}`;
    if(hintEl) hintEl.style.color = '';
  } else {
    if(hintEl) hintEl.textContent = 'Pilih lomba dari daftar yang sudah ada atau buat lomba baru.';
    if(hintEl) hintEl.style.color = '';
  }
  // Peringatan tambahan (nimpa hint di atas kalau kena): nama ini udah dipakai
  // lomba LAIN di event AKTIF (beda dari cek dbLombaGroups di atas yang lintas
  // event). Ini baru indikator visual biar ketauan dari awal ngetik — cek final
  // yang beneran nyegah kesimpen dobel tetap ada di tombol Tambah (konfirmasi).
  const dupeAktif = key ? gLomba().find(l=>dbLombaNormKey(l.nama)===key) : null;
  if(dupeAktif && hintEl){
    hintEl.textContent = `⚠️ Lomba "${dupeAktif.nama}" dengan nama ini udah ada di event aktif. Kalau maksudnya nambah perlengkapan buat lomba itu, batalkan lalu buka lomba yang sudah ada lewat menu Lomba & Perlengkapan — biar nggak kepisah jadi 2 entri.`;
    hintEl.style.color = 'var(--orange, #b5691a)';
  }
}
function toggleHadiahPerReguHint(){
  const anggota = Math.max(1, Number(document.getElementById('f-anggota').value||1));
  const wrap = document.getElementById('f-hadiah-per-regu-wrap');
  if(wrap) wrap.style.display = anggota>1 ? 'block' : 'none';
}
async function hapusLomba(id){ 
  if (!canEditSection('lomba')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!(await confirmModal('Hapus lomba ini?\n\nTenang, data lomba & perlengkapannya tetap tersimpan sebagai riwayat di menu Database Lomba.'))) return; 
  const l = db.lomba.find(x=>x.id===id);
  // Ambil dulu id kebutuhan sebelum di-filter, supaya baris status belanja
  // perlengkapan yang mereferensikannya bisa ikut dibersihkan (kalau tidak,
  // baris itu jadi orphan permanen di kt_daftar_belanja_perlengkapan).
  const kebutuhanList = db.lombaKebutuhan.filter(k=>k.lomba_id===id);
  const kebutuhanIds = kebutuhanList.map(k=>k.id);
  // Arsipkan snapshot lomba+perlengkapannya SEBELUM dihapus, supaya Database
  // Lomba (menu terpisah, lintas tahun) tetap punya riwayatnya selamanya —
  // lihat catatan lengkap di defaultDB() (field lombaArsip) & 10b-database-lomba.js.
  if(l){
    const ev = db.events.find(e=>e.id===l.event_id) || null;
    db.lombaArsip.push({
      id: uid(),
      nama: l.nama,
      kategori_peserta: l.kategori_peserta,
      jumlah_anggota_regu: l.jumlah_anggota_regu || 1,
      hadiah_per_regu: !!l.hadiah_per_regu,
      event_nama: ev ? ev.nama : null,
      event_tahun: ev ? ev.tahun : null,
      tanggal_arsip: todayISO(),
      items: kebutuhanList.map(k=>({nama_item:k.nama_item, harga_estimasi:k.harga_estimasi, harga_realisasi:k.harga_realisasi, qty:k.qty}))
    });
  }
  db.lombaHadiah=db.lombaHadiah.filter(lh=>lh.lomba_id!==id); 
  db.lombaKebutuhan=db.lombaKebutuhan.filter(k=>k.lomba_id!==id); 
  db.daftarBelanjaPerlengkapan = db.daftarBelanjaPerlengkapan.filter(b=>!kebutuhanIds.includes(b.kebutuhan_id));
  // Catatan: menghapus lomba TIDAK menurunkan qty_dibeli hadiah secara otomatis —
  // stok yang sudah disiapkan/dibeli tetap ada, bisa dikurangi manual lewat menu Kebutuhan Hadiah kalau perlu.
  if(l && l.jadwal_id){ db.jadwal = db.jadwal.filter(j=>j.id!==l.jadwal_id); }
  db.lomba=db.lomba.filter(l=>l.id!==id); 
  saveDB(); renderContent(); renderTopbarSaldo();
  if(l) notifyTelegram(`🗑️ Hapus lomba: ${l.nama}`, `Kategori: ${labelPeserta(l.kategori_peserta)}\nRiwayat & perlengkapannya masih tersimpan di Database Lomba.`, 'lomba');
}
function openKebutuhanModal(lombaId, kebutuhanId){ 
  if (!canEditSection('lomba')) { toast('⛔ Login untuk mengedit data'); return; }
  const editing=kebutuhanId?db.lombaKebutuhan.find(k=>k.id===kebutuhanId):null; 
  const l = db.lomba.find(x=>x.id===lombaId);
  setModal(editing?'Edit Kebutuhan':'Tambah Kebutuhan', `
    <div class="field"><label>Nama Item</label><input id="f-nama" value="${editing?esc(editing.nama_item):''}"></div>
    <div class="field-row"><div class="field"><label>Harga Estimasi</label><input id="f-est" class="currency-input" type="text" value="${editing?formatCurrency(editing.harga_estimasi):''}"></div>
    <div class="field"><label>Harga Realisasi</label><input id="f-real" class="currency-input" type="text" value="${editing&&editing.harga_realisasi!=null?formatCurrency(editing.harga_realisasi):''}"></div></div>
    <div class="field"><label>Qty</label><input id="f-qty" type="number" min="1" value="${editing?editing.qty:1}"></div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:editing?'Simpan':'Tambah', cls:'', onclick:()=>{
      const nama_item=document.getElementById('f-nama').value.trim(); 
      const harga_estimasi=getCurrencyValue(document.getElementById('f-est')); 
      const realVal=document.getElementById('f-real').value; 
      const harga_realisasi=realVal===''?null:getCurrencyValue(document.getElementById('f-real')); 
      const qty=Number(document.getElementById('f-qty').value||1); 
      if(!nama_item||qty<=0){toast('Nama & qty wajib');return;}
      let actionMsg = editing ? `✏️ Edit item kebutuhan: ${editing.nama_item} → ${nama_item}` : `➕ Item kebutuhan baru: ${nama_item}`;
      if(editing){Object.assign(editing,{nama_item,harga_estimasi,harga_realisasi,qty});}
      else{db.lombaKebutuhan.push({id:uid(),lomba_id:lombaId,nama_item,harga_estimasi,harga_realisasi,qty});}
      saveDB(); closeModal(); openLombaIds.add(lombaId); renderContent(); renderTopbarSaldo(); toast('Disimpan');
      const lomba = db.lomba.find(x=>x.id===lombaId);
      notifyTelegram(actionMsg, `Lomba: ${lomba?.nama || lombaId}\nItem: ${nama_item}\nQty: ${qty}\nEstimasi: ${fmtRp(harga_estimasi)}${harga_realisasi ? `\nRealisasi: ${fmtRp(harga_realisasi)}` : ''}`, 'lomba');
    }}
  ]);
  setTimeout(setupAllCurrencyInputs, 50);
}
async function hapusKebutuhan(id){ 
  if (!canEditSection('lomba')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!(await confirmModal('Hapus item?'))) return; 
  const k=db.lombaKebutuhan.find(x=>x.id===id); 
  db.lombaKebutuhan=db.lombaKebutuhan.filter(x=>x.id!==id); 
  // Ikut hapus baris status belanja perlengkapan yang mereferensikan item ini,
  // supaya tidak jadi orphan di kt_daftar_belanja_perlengkapan.
  db.daftarBelanjaPerlengkapan = db.daftarBelanjaPerlengkapan.filter(b=>b.kebutuhan_id!==id);
  saveDB(); if(k) openLombaIds.add(k.lomba_id); renderContent(); renderTopbarSaldo();
  if(k) notifyTelegram(`🗑️ Hapus item kebutuhan: ${k.nama_item}`, `Lomba: ${db.lomba.find(x=>x.id===k.lomba_id)?.nama || k.lomba_id}`, 'lomba');
}

/* ============================================================
   KEBUTUHAN HADIAH LOMBA (dengan auth check)
   ============================================================ */
// Agregat semua item hadiah yang qty_dibeli-nya melebihi kebutuhan (target),
// dikumpulkan dari SEMUA kategori peserta + juara sekaligus — dipakai untuk card
// ringkasan "Stok Lebih dari Kebutuhan" di menu Hadiah. Partisipasi yang belum
// diisi estimasi peserta (kebutuhan=null) dilewati karena memang belum punya target.
function hitungStokLebihHadiah(){
  const rows = [];
  // Pakai harga efektif per pcs dari hitungHargaAktualHadiahLomba() (di
  // 11-belanja.js) supaya "nilai" kelebihan stok ikut memperhitungkan
  // harga_eceran, bukan cuma harga_satuan/pack (lihat Bug #2).
  const hadiahAktual = hitungHargaAktualHadiahLomba();
  gHadiahKategori().forEach(h => {
    const kebutuhan = hitungKebutuhanHadiah(h.kategori_peserta, h.juara_ke);
    if(kebutuhan==null) return;
    h.items.forEach(item => {
      const target = hitungTargetQtyItem(item, kebutuhan);
      const dibeli = Number(item.qty_dibeli||0);
      if(dibeli > target){
        const lebih = dibeli - target;
        const alokasi = hadiahAktual.perItem[`${h.id}_${item.id}`];
        const hargaEfektif = alokasi ? alokasi.hargaEfektif : Number(item.harga_satuan||0);
        rows.push({
          hadiahId: h.id, itemId: item.id,
          kategori_peserta: h.kategori_peserta, juara_ke: h.juara_ke,
          nama: item.nama, target, dibeli, lebih,
          harga_satuan: Number(item.harga_satuan||0),
          nilai: lebih * hargaEfektif
        });
      }
    });
  });
  rows.sort((a,b) => b.nilai - a.nilai);
  return rows;
}
// Cek apakah item hadiah ini sudah dicentang "dibeli" di Daftar Belanja Hadiah —
// dipakai untuk memperingatkan panitia sebelum qty_dibeli-nya diubah lewat jalur lain
// (panel Stok Lebih / edit item), supaya tidak nyelip beda dengan barang fisik yang
// sudah benar-benar dibeli di toko.
function isItemHadiahSudahDibeli(hadiahId, itemId){
  const b = db.daftarBelanjaHadiah.find(x=>x.hadiah_kategori_id===hadiahId && x.item_id===itemId && x.event_id===eid());
  return !!(b && b.status === 'dibeli');
}
// Cepat turunkan qty_dibeli 1 item persis ke kebutuhan (target) saat ini — dipakai
// dari tombol "↓ Sesuaikan" di card Stok Lebih, alternatif lebih cepat dibanding
// buka modal edit item satu-satu.
async function turunkanStokHadiahKeKebutuhan(hadiahId, itemId){
  if (!canEditSection('hadiah')) { toast('⛔ Login untuk mengedit data'); return; }
  const h = db.hadiahKategori.find(x=>x.id===hadiahId);
  const item = h && h.items.find(it=>it.id===itemId);
  if(!item){ toast('Item tidak ditemukan'); return; }
  const kebutuhan = hitungKebutuhanHadiah(h.kategori_peserta, h.juara_ke);
  const target = hitungTargetQtyItem(item, kebutuhan);
  const dibeliSebelum = Number(item.qty_dibeli||0);
  if(target==null || dibeliSebelum <= target){ toast('Tidak ada kelebihan lagi'); renderContent(); return; }
  if(isItemHadiahSudahDibeli(hadiahId, itemId)){
    if(!(await confirmModal(`⚠️ "${item.nama}" sudah dicentang DIBELI di Daftar Belanja.\n\nMenurunkan qty di sini cuma mengubah angka kebutuhan (target), bukan barang fisik yang sudah dibeli — cek dulu apakah memang mau dikembalikan/dijual lagi kelebihannya. Lanjutkan?`))) return;
  }
  item.qty_dibeli = target;
  saveDB(); renderContent(); renderTopbarSaldo();
  toast(`✓ "${item.nama}" diturunkan dari ${dibeliSebelum} → ${target} pcs`);
  notifyTelegram(`↓ Turunkan stok lebih hadiah: ${item.nama}`, `Paket: ${labelPeserta(h.kategori_peserta)} - ${labelJuara(h.juara_ke)}\n${dibeliSebelum} → ${target} pcs`, 'lomba');
}
function renderHadiah(){
  const list = gHadiahKategori();
  // Pakai hitungHargaAktualHadiahLomba() (di 11-belanja.js) supaya "Total
  // Belanja Hadiah" di sini konsisten dengan Belanja Hadiah — rumus flat
  // harga_satuan*qty_dibeli mengabaikan harga_eceran untuk sisa pcs yang
  // dibeli satuan (lihat Bug #2).
  const hadiahAktual = hitungHargaAktualHadiahLomba();
  const total = hadiahAktual.total;
  const isLoggedIn = !!getCurrentUser();
  const semuaLomba = gLomba();

  const groups = KATEGORI_PESERTA.map(kp => {
    const items = list.filter(h => h.kategori_peserta === kp.v)
      .sort((a,b) => JUARA_LIST.findIndex(j=>j.v===a.juara_ke) - JUARA_LIST.findIndex(j=>j.v===b.juara_ke));
    if(!items.length) return '';
    const lombaKategoriList = semuaLomba.filter(l => l.kategori_peserta === kp.v);
    const jumlahLomba = lombaKategoriList.length;
    const totalKebutuhanPaket = lombaKategoriList.reduce((s,l)=>s+anggotaHadiahLomba(l),0);
    const adaBeregu = lombaKategoriList.some(l => Number(l.jumlah_anggota_regu||1) > 1 && !l.hadiah_per_regu);
    const groupHtml = items.map(h => {
      const isPartisipasi = h.juara_ke === 'partisipasi';
      const kebutuhan = hitungKebutuhanHadiah(kp.v, h.juara_ke);
      const kurangItems = kebutuhan!=null ? h.items.filter(item => Number(item.qty_dibeli||0) < hitungTargetQtyItem(item, kebutuhan)) : [];
      // Stok tidak pernah diturunkan otomatis (lihat autoSyncHadiahStok), jadi kalau lomba
      // dihapus atau qty_per_paket diturunkan, qty_dibeli bisa nyangkut lebih tinggi dari
      // kebutuhan riil tanpa disadari panitia. Deteksi ini supaya ada sinyal juga, bukan cuma "kurang".
      const lebihItems = kebutuhan!=null ? h.items.filter(item => Number(item.qty_dibeli||0) > hitungTargetQtyItem(item, kebutuhan)) : [];
      const totalItem = h.items.reduce((s, item) => s + (hadiahAktual.perItem[`${h.id}_${item.id}`]?.subtotal ?? 0), 0);
      // Harga SATU paket saja (isi paket × qty/paket) — dipakai untuk dibandingkan
      // dengan budget, karena budget diatur per paket/per pemenang, bukan akumulasi
      // seluruh lomba di kategori ini (yang jumlahnya beda-beda tiap kategori).
      const totalPerPaket = h.items.reduce((s, item) => s + (Number(item.harga_satuan||0) * Math.max(1,Number(item.qty_per_paket||1))), 0);
      const satuanKebutuhan = isPartisipasi ? 'peserta' : 'paket';
      const namaLombaTitle = isPartisipasi
        ? esc(lombaKategoriList.map(l => `${l.nama}: ${Number(l.estimasi_peserta||0)} peserta`).join(', '))
        : esc(lombaKategoriList.map(l => Number(l.jumlah_anggota_regu||1)>1 ? `${l.nama} (beregu ×${l.jumlah_anggota_regu}${l.hadiah_per_regu?', 1 hadiah/regu':''})` : l.nama).join(', '));
      const rincianLomba = (!isPartisipasi && adaBeregu) ? ` = ${lombaKategoriList.map(l=>anggotaHadiahLomba(l)).join('+')}` : '';
      // Kalau Partisipasi BALIK jadi manual (kebutuhan===null) padahal paketnya sudah
      // punya qty_dibeli terisi, itu bisa berarti dua hal: (a) memang dari awal belum
      // pernah diisi estimasi (normal), atau (b) SEMPAT diisi & disinkronkan otomatis,
      // lalu semua lomba kategori ini estimasinya dihapus/direset ke 0 — qty_dibeli yang
      // sudah kadung naik tadi tidak ikut turun (autoSyncHadiahStok tidak pernah
      // menurunkan otomatis) dan badge kurang/lebih otomatis hilang begitu saja karena
      // sistem berhenti melacaknya. Tanpa notice ini, kelebihan tsb jadi tidak
      // kelihatan sama sekali di halaman ini — kasih sinyal biar tetap dicek manual.
      const partisipasiManualPerluCek = isPartisipasi && kebutuhan==null && h.items.some(item => Number(item.qty_dibeli||0) > 0);
      const kebutuhanBadge = kebutuhan!=null
        ? (kurangItems.length
            ? `<span class="lomba-badge warn" style="margin-left:8px;" title="${namaLombaTitle}">⚠️ Kurang, butuh ${kebutuhan} ${satuanKebutuhan} (dari ${jumlahLomba} lomba${rincianLomba})</span>`
            : (lebihItems.length
                ? `<span class="lomba-badge info" style="margin-left:8px;" title="${namaLombaTitle} — cek kalau ada lomba yang dihapus/diubah sebelumnya">📦 Stok lebih dari kebutuhan (${kebutuhan} ${satuanKebutuhan} dari ${jumlahLomba} lomba${rincianLomba})</span>`
                : `<span class="lomba-badge" style="margin-left:8px;" title="${namaLombaTitle}">✓ Kebutuhan untuk ${jumlahLomba} lomba terpenuhi</span>`))
        : (partisipasiManualPerluCek
            ? `<span class="lomba-badge info" style="margin-left:8px;" title="Belum ada lomba kategori ${labelPeserta(kp.v)} yang diisi Estimasi Jumlah Peserta, jadi qty di bawah tidak lagi dilacak otomatis — kalau sebelumnya sempat diisi lalu dihapus/direset ke 0, qty ini bisa saja sudah tidak relevan.">✋ Mode manual, cek lagi qty-nya</span>`
            : '');
      const budget = getHadiahBudget(kp.v, h.juara_ke);
      let budgetBadge = '';
      if(budget > 0){
        const selisih = budget - totalPerPaket;
        budgetBadge = selisih < 0
          ? `<span class="lomba-badge warn" style="margin-left:8px;" title="Harga 1 paket: ${fmtRp(totalPerPaket)}">💸 Lebih ${fmtRp(Math.abs(selisih))} dari budget ${fmtRp(budget)}</span>`
          : `<span class="lomba-badge" style="margin-left:8px;" title="Harga 1 paket: ${fmtRp(totalPerPaket)}">🎯 Budget ${fmtRp(budget)} · Sisa ${fmtRp(selisih)}</span>`;
      }
      return `<div class="hadiah-group"><div class="hadiah-group-header" ${da('toggleHadiahGroup', h.id)}><div><span class="title">🏆 ${labelJuara(h.juara_ke)}</span><span style="font-size:12px;color:var(--ink-soft);margin-left:8px;">${h.items.length} item</span>${kebutuhanBadge}${budgetBadge}</div><div style="display:flex;align-items:center;gap:4px;"><span class="total">${fmtRp(totalItem)}</span>${isLoggedIn ? `<button class="icon-btn" ${da('openHadiahModal', h.id)} title="Edit paket">✎</button><button class="icon-btn" ${da('hapusHadiah', h.id)} title="Hapus paket">🗑</button>` : ''}</div></div>
        <div class="hadiah-group-body" id="hadiah-group-${h.id}" style="display:${openHadiahGroups.has(h.id)?'block':'none'};">
          ${kurangItems.length ? `<div class="hint" style="margin-bottom:10px;">${isPartisipasi ? `Sebagian item belum sesuai kebutuhan (estimasi total ${kebutuhan} peserta dari ${jumlahLomba} lomba kategori ${labelPeserta(kp.v)} × qty/paket masing-masing item).` : `Sebagian item belum sesuai kebutuhan (${jumlahLomba} lomba kategori ${labelPeserta(kp.v)}${adaBeregu?', termasuk lomba beregu':''} × qty/paket masing-masing item).`} Biasanya ini terjadi setelah "Qty per paket" sebuah item diubah manual${isPartisipasi?', atau estimasi peserta baru saja diubah':''}. Klik tombol "⚡ Sesuaikan Semua Otomatis" di atas untuk langsung menyamakan, atau edit qty item satu-satu di bawah.</div>` : (lebihItems.length ? `<div class="hint" style="margin-bottom:10px;">Sebagian item stoknya lebih dari kebutuhan (${isPartisipasi ? `estimasi ${kebutuhan} peserta` : `${jumlahLomba} lomba`} kategori ${labelPeserta(kp.v)}). Ini bisa normal (sengaja beli cadangan), atau sisa dari lomba yang sudah dihapus/dikurangi${isPartisipasi?'/estimasi peserta diturunkan':''} — qty tidak pernah diturunkan otomatis. Cek dan kurangi manual lewat tombol ✎ di item kalau memang kelebihan.</div>` : (partisipasiManualPerluCek ? `<div class="hint" style="margin-bottom:10px;">✋ Tidak ada satu pun lomba kategori ${labelPeserta(kp.v)} yang diisi "Estimasi Jumlah Peserta" saat ini, jadi qty di bawah nggak lagi dilacak otomatis dan nggak dibandingkan ke target mana pun. Kalau sebelumnya sempat diisi lalu dihapus/direset ke 0, qty ini bisa saja sudah kelebihan/kekurangan tanpa disadari — cek manual lewat tombol ✎ di tiap item, atau isi lagi Estimasi Jumlah Peserta di lomba terkait kalau mau dilacak otomatis lagi.</div>` : ''))}
          ${h.items.map((item, idx) => { const perPaket=Math.max(1,Number(item.qty_per_paket||1)); const target = hitungTargetQtyItem(item, kebutuhan); const kurang = target!=null && Number(item.qty_dibeli||0) < target; const lebih = target!=null && Number(item.qty_dibeli||0) > target;
            // Harga efektif per pcs (perpaduan harga_satuan/pack + harga_eceran untuk sisa
            // satuan), sama seperti yang dipakai di totalItem header & LPJ (lihat Bug #2 di
            // 11-belanja.js) — supaya baris ini konsisten dengan total paket di atasnya,
            // bukan flat harga_satuan yang bisa beda kalau harga_eceran sudah diatur.
            const alokasiItem = hadiahAktual.perItem[`${h.id}_${item.id}`];
            const hargaTampil = alokasiItem ? alokasiItem.hargaEfektif : Number(item.harga_satuan||0);
            const subtotalTampil = alokasiItem ? alokasiItem.subtotal : hargaTampil * Number(item.qty_dibeli||0);
            return `<div class="hadiah-item-row"><span class="item-name">${esc(item.nama)}${perPaket>1?` <span style="color:var(--ink-soft);font-size:11px;">${perPaket} buah per paket</span>`:''}${kurang?` <span style="color:var(--orange);font-size:11px;">(butuh ${target})</span>`:''}${lebih?` <span style="color:var(--biru);font-size:11px;">(kebutuhan ${target}, lebih ${Number(item.qty_dibeli)-target})</span>`:''}</span><span class="item-qty">Dibeli: ${item.qty_dibeli} <span class="item-harga-satuan" title="Harga efektif per pcs, termasuk harga eceran sisa satuan bila diatur">· ${fmtRp(hargaTampil)}/pcs</span></span><span class="item-price">${fmtRp(subtotalTampil)}</span>
            <button class="icon-btn" ${!isLoggedIn ? 'disabled' : da('editHadiahItem', h.id, item.id)}>✎</button>
            <button class="icon-btn" ${!isLoggedIn ? 'disabled' : da('hapusHadiahItem', h.id, item.id)}>🗑</button>
          </div>`;}).join('')}
          ${isLoggedIn ? `<div class="add-item-row"><input type="text" id="add-item-name-${h.id}" placeholder="Nama hadiah" style="flex:2;" onblur="autofillHargaHadiah(this)"><input type="text" id="add-item-price-${h.id}" class="currency-input" placeholder="Harga" style="flex:1;"><input type="number" id="add-item-perpaket-${h.id}" placeholder="Qty/paket" value="1" min="1" style="flex:0.7;" title="Berapa pcs item ini per 1 paket juara"><button class="btn secondary small" ${da('tambahItemHadiah', h.id, kebutuhan!=null?kebutuhan:null)}>+ Tambah</button></div>` : `<div class="hint" style="padding:8px 0;">🔒 Login untuk menambah item</div>`}
        </div></div>`;
    }).join('');
    const bereguDetail = lombaKategoriList.filter(l => Number(l.jumlah_anggota_regu||1) > 1 && !l.hadiah_per_regu).map(l => `${esc(l.nama)} ${Number(l.jumlah_anggota_regu)} orang/regu`).join(', ');
    const kebutuhanInfo = jumlahLomba > 0 ? `<span style="font-size:11.5px;color:var(--ink-soft);font-weight:500;text-transform:none;letter-spacing:0;margin-left:8px;">(${jumlahLomba} lomba${adaBeregu?` · butuh ${totalKebutuhanPaket} paket karena ada lomba beregu (${bereguDetail})`:''})</span>` : '';
    const daftarLombaInfo = lombaKategoriList.length ? `<div class="lomba-mini-list">${lombaKategoriList.map((l,i)=>{const anggota=Number(l.jumlah_anggota_regu||1); const perRegu=anggota>1&&l.hadiah_per_regu; return `<span class="lomba-mini-chip">${anggota>1?`<span class="num beregu">${anggotaHadiahLomba(l)}×</span>`:`<span class="num">${i+1}</span>`}${esc(l.nama)}${anggota>1?` <span class="beregu-tag">${perRegu?'1 hadiah/regu':'beregu'}</span>`:''}</span>`;}).join('')}</div>` : '';
    return `<div class="subgroup-title">${kp.l}${kebutuhanInfo}</div>${daftarLombaInfo}${groupHtml}`;
  }).join('');

  // Total budget SEHARUSNYA untuk seluruh event = budget per paket × jumlah paket yang
  // dibutuhkan di kategori itu (mengikuti jumlah lomba, sama seperti kebutuhan stok).
  // Untuk juara "partisipasi" yang BELUM diisi estimasi peserta (keb=null, tidak ada target
  // otomatis), budget dihitung apa adanya (×1) supaya tidak dibandingkan dengan kesalahan
  // skala. Begitu estimasi peserta diisi, keb terisi angka riil dan budget partisipasi ikut
  // dikalikan jumlah peserta seperti kategori juara lain — jauh lebih akurat daripada ×1.
  const totalBudget = KATEGORI_PESERTA.reduce((s,kp)=>s+JUARA_LIST.reduce((s2,j)=>{
    const budgetPerPaket = getHadiahBudget(kp.v, j.v);
    if(budgetPerPaket<=0) return s2;
    const keb = hitungKebutuhanHadiah(kp.v, j.v);
    // keb bisa null (belum ada target otomatis) ATAU 0 (belum ada lomba/estimasi diisi
    // untuk kategori ini). Keduanya sama-sama "belum diketahui jumlah paket yang
    // dibutuhkan", jadi budget tetap dihitung penuh (×1) — bukan ditiadakan (×0) —
    // supaya Total Budget tetap masuk akal sebelum data lomba diinput.
    return s2 + budgetPerPaket * (keb || 1);
  },0),0);

  // Card anggaran per kategori peserta — bandingkan harga PAKET (bukan akumulasi total
  // belanja) dengan budget per paket yang sudah diatur lewat tombol "Atur Budget".
  // Ini sengaja tidak dikalikan jumlah kebutuhan paket, karena budget memang dipatok
  // per satu paket/pemenang, bukan untuk seluruh kebutuhan lomba di kategori itu.
  const budgetKategoriCards = KATEGORI_PESERTA.map(kp => {
    const rincianJuara = JUARA_LIST.map(j => {
      const budgetPerPaket = getHadiahBudget(kp.v, j.v);
      if(budgetPerPaket<=0) return null;
      // Normalnya cuma ada 1 paket per kombinasi kategori+juara, tapi sistem tetap
      // mengizinkan lebih dari 1 (dengan konfirmasi peringatan saat dibuat). Kalau
      // itu terjadi, jumlahkan SEMUA paket yang cocok (bukan cuma yang pertama
      // ketemu) dan kalikan budget acuan dengan jumlah paketnya juga, supaya
      // perbandingan tetap adil (mis. 2 paket @ budget 100rb = acuan 200rb).
      const hs = list.filter(x => x.kategori_peserta === kp.v && x.juara_ke === j.v);
      const totalPerPaket = hs.reduce((s,h)=> s + h.items.reduce((s2,item)=> s2 + (Number(item.harga_satuan||0) * Math.max(1,Number(item.qty_per_paket||1))), 0), 0);
      const budgetAcuan = budgetPerPaket * Math.max(1, hs.length);
      return {label: j.l, budgetPerPaket: budgetAcuan, totalPerPaket};
    }).filter(Boolean);
    if(!rincianJuara.length) return '';
    const budgetTotal = rincianJuara.reduce((s,r)=>s+r.budgetPerPaket,0);
    const paketTotal = rincianJuara.reduce((s,r)=>s+r.totalPerPaket,0);
    const adaLebih = rincianJuara.some(r => r.totalPerPaket > r.budgetPerPaket);
    const pct = budgetTotal>0 ? Math.min(100, Math.round((paketTotal / budgetTotal) * 100)) : 0;
    const rincianHtml = rincianJuara.map(r => {
      const lebih = r.totalPerPaket > r.budgetPerPaket;
      return `<div style="display:flex;justify-content:space-between;gap:6px;font-size:11px;color:${lebih?'var(--merah)':'var(--ink-soft)'};"><span>${r.label}</span><span>${fmtRp(r.totalPerPaket)} / ${fmtRp(r.budgetPerPaket)}${lebih?' ⚠️':''}</span></div>`;
    }).join('');
    return `<div class="kategori-card k-${kp.v}">
      <div class="kc-title">Kategori ${kp.l}</div>
      <div class="kc-progress">
        <div class="kc-progress-bar"><div class="kc-progress-fill" style="width:${pct}%;${adaLebih?'background:var(--merah);':''}"></div></div>
      <div class="kc-money">
        <div class="kc-money-label">Harga paket dari</div>
        <div class="kc-money-values"><b>${fmtRp(paketTotal)}</b><span class="kc-money-sep">/</span><b>${fmtRp(budgetTotal)}</b></div>
      </div>
      </div>
      <div style="margin-top:8px;display:flex;flex-direction:column;gap:3px;">${rincianHtml}</div>
    </div>`;
  }).join('');

  const stokLebihRows = hitungStokLebihHadiah();
  const totalNilaiLebih = stokLebihRows.reduce((s,r)=>s+r.nilai,0);
  const stokLebihPanel = stokLebihRows.length ? `<div class="panel">
    <div class="panel-head"><div><h3>📦 Stok Lebih dari Kebutuhan</h3><div class="desc">Qty dibeli melebihi target — bisa sengaja (cadangan), atau sisa dari lomba yang dihapus/dikurangi qty-nya</div></div></div>
    <div class="panel-body flush">
      ${stokLebihRows.map(r => `<div class="belanja-item">
        <div class="info">
          <div class="nama"><span class="nama-text">${esc(r.nama)}</span><span class="qty-total">lebih ${r.lebih} pcs</span></div>
          <div class="detail"><span class="tag tag-orange">${labelPeserta(r.kategori_peserta)} · ${labelJuara(r.juara_ke)}</span><span>Dibeli ${r.dibeli} dari kebutuhan ${r.target}</span></div>
        </div>
        <div class="harga" style="display:flex;align-items:center;gap:8px;">
          <span>${fmtRp(r.nilai)}</span>
          ${isLoggedIn ? `<button class="btn secondary small" title="Turunkan qty_dibeli persis ke kebutuhan (${r.target})" ${da('turunkanStokHadiahKeKebutuhan', r.hadiahId, r.itemId)}>↓ Sesuaikan</button>` : ''}
        </div>
      </div>`).join('')}
    </div>
  </div>` : '';

  return `<div class="stat-grid">
    <div class="stat-card pengeluaran"><div class="lbl">Total Belanja Hadiah</div><div class="val">${fmtRp(total)}</div></div>
    ${totalBudget>0 ? `<div class="stat-card ${total>totalBudget?'defisit':'saldo'}"><div class="lbl">Total Budget Hadiah</div><div class="val">${fmtRp(totalBudget)}</div><div style="font-size:11px; color:var(--abu); margin-top:4px;">${total>totalBudget?`⚠️ Sudah lebih ${fmtRp(total-totalBudget)}`:`Sisa ${fmtRp(totalBudget-total)}`}</div></div>` : ''}
    ${stokLebihRows.length ? `<div class="stat-card stok-lebih"><div class="lbl">📦 Nilai Stok Lebih</div><div class="val">${fmtRp(totalNilaiLebih)}</div><div style="font-size:11px; color:var(--abu); margin-top:4px;">${stokLebihRows.length} item kelebihan dari kebutuhan</div></div>` : ''}
  </div>
  ${stokLebihPanel}
  ${budgetKategoriCards ? `<div class="panel"><div class="panel-head"><div><h3>Anggaran Hadiah per Kategori</h3><div class="desc">Harga 1 paket dibandingkan budget per paket (bukan akumulasi total belanja), dirinci per juara</div></div></div>
  <div class="panel-body"><div class="kategori-grid">${budgetKategoriCards}</div></div></div>` : ''}
  <div class="panel"><div class="panel-head"><div><h3>Kebutuhan Hadiah</h3><div class="desc">Setiap paket bisa berisi multiple item · Kebutuhan Juara 1-3 mengikuti jumlah lomba per kategori · Partisipasi otomatis kalau "Estimasi Jumlah Peserta" diisi di lomba (kalau belum diisi, tetap manual)</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${isLoggedIn ? `<button class="btn secondary" ${da('openHadiahBudgetModal')}>🎯 Atur Budget</button>` : ''}
      ${isLoggedIn ? `<button class="btn secondary" ${da('sesuaikanSemuaKebutuhanHadiah')}>⚡ Sesuaikan Semua Otomatis</button>` : ''}
      ${isLoggedIn ? `<button class="btn" ${da('openHadiahModal')}>+ Tambah Paket</button>` : ''}
    </div></div>
  <div class="panel-body">${groups.trim()||`<div style="padding:30px;text-align:center;color:var(--abu);">Belum ada kebutuhan hadiah.</div>`}</div></div>`;
}

// Kebutuhan paket hadiah Juara 1/2/3 = jumlah lomba pada kategori peserta tsb, dikalikan jumlah anggota regu tiap lomba
// (lomba perorangan = x1, lomba beregu = x jumlah anggota regu).
// Partisipasi: otomatis dihitung dari total "Estimasi Jumlah Peserta" tiap lomba di kategori itu,
// TAPI cuma kalau minimal satu lomba di kategori sudah diisi estimasinya — supaya event lama yang
// belum pernah isi field ini tetap seperti semula (manual, kebutuhan=null), tidak tiba-tiba
// menampilkan target 0/salah begitu fitur ini dipasang.
function anggotaHadiahLomba(l){ return l.hadiah_per_regu ? 1 : Math.max(1, Number(l.jumlah_anggota_regu||1)); }
function hitungKebutuhanHadiah(kategoriPeserta, juaraKe){
  const lombaKategori = gLomba().filter(l => l.kategori_peserta === kategoriPeserta);
  if(juaraKe === 'partisipasi'){
    const adaEstimasiDiisi = lombaKategori.some(l => Number(l.estimasi_peserta||0) > 0);
    if(!adaEstimasiDiisi) return null;
    return lombaKategori.reduce((s,l)=> s + Number(l.estimasi_peserta||0), 0);
  }
  return lombaKategori.reduce((s,l)=> s + anggotaHadiahLomba(l), 0);
}
// Target qty tiap item = kebutuhan (jumlah paket/lomba) dikalikan qty_per_paket item tsb
// (mis. pulpen 2/paket pada kategori yg butuh 3 paket => target 6, bukan 3)
function hitungTargetQtyItem(item, kebutuhan){
  if(kebutuhan==null) return null;
  return kebutuhan * Math.max(1, Number(item.qty_per_paket||1));
}
// Sinkronisasi otomatis: qty_dibeli tiap item paket hadiah (non-partisipasi) dinaikkan
// mengikuti kebutuhan (jumlah lomba x qty_per_paket) SETIAP KALI lomba atau paket berubah.
// Tidak pernah menurunkan otomatis, supaya buffer/qty manual yang sudah diisi user tidak hilang.
function autoSyncHadiahStok(silent){
  let totalDiubah = 0; const detail = []; const dibukaKembali = [];
  gHadiahKategori().forEach(h => {
    const kebutuhan = hitungKebutuhanHadiah(h.kategori_peserta, h.juara_ke);
    if(kebutuhan==null) return; // partisipasi: tetap manual
    let diubah = 0; const detailItem = [];
    h.items.forEach(item => {
      const target = hitungTargetQtyItem(item, kebutuhan);
      if(Number(item.qty_dibeli||0) < target){
        item.qty_dibeli = target; diubah++; detailItem.push(`${item.nama}→${target}`);
        // PENTING (skenario belum tertangani): kalau item ini SUDAH dicentang "dibeli"
        // di Daftar Belanja Hadiah, menaikkan target di sini secara diam-diam akan
        // membuat checklist tetap kelihatan "sudah aman" padahal kebutuhan barunya
        // belum tentu sudah dibeli fisiknya. Buka lagi checklist-nya (bukan cuma
        // menaikkan angka target) supaya barang ini muncul lagi di Belanja Hadiah
        // dan panitia sadar perlu beli tambahan — jangan biarkan status "dibeli"
        // menutupi kekurangan qty yang baru muncul.
        const belanja = db.daftarBelanjaHadiah.find(b => b.hadiah_kategori_id===h.id && b.item_id===item.id && b.event_id===eid());
        if(belanja && belanja.status === 'dibeli'){
          belanja.status = 'belum_dibeli'; belanja.tanggal_beli = null;
          dibukaKembali.push(`${item.nama} (${labelPeserta(h.kategori_peserta)} - ${labelJuara(h.juara_ke)}, sudah dibeli tapi butuh naik jadi ${target})`);
        }
      }
    });
    if(diubah>0){ totalDiubah += diubah; detail.push(`${labelPeserta(h.kategori_peserta)} - ${labelJuara(h.juara_ke)}: ${detailItem.join(', ')}`); }
  });
  if(totalDiubah>0){
    saveDB();
    if(!silent) toast(`⚡ Stok hadiah disinkronkan (${totalDiubah} item)`);
    if(dibukaKembali.length){
      toast(`⚠️ ${dibukaKembali.length} item hadiah yang sudah dibeli dibuka lagi karena kebutuhan bertambah — cek Belanja Hadiah`, 7000);
      notifyTelegram(`⚠️ Belanja hadiah dibuka lagi (kebutuhan bertambah)`, dibukaKembali.join('\n'), 'belanja');
    }
    notifyTelegram(`⚡ Stok hadiah auto-sync`, detail.join('\n'), 'lomba');
  }
  return totalDiubah;
}
// Tombol manual "Sinkronkan Ulang" — jaring pengaman kalau ada data lama/impor yang belum sinkron.
// Pada alur normal ini jarang diperlukan karena autoSyncHadiahStok() otomatis jalan
// setiap kali lomba ditambah/diedit.
function sesuaikanSemuaKebutuhanHadiah(){
  if (!canEditSection('hadiah')) { toast('⛔ Login untuk mengedit data'); return; }
  const totalDiubah = autoSyncHadiahStok(true);
  if(totalDiubah===0){ toast('Semua qty sudah sesuai kebutuhan'); return; }
  renderContent(); renderTopbarSaldo();
  toast(`⚡ ${totalDiubah} item disesuaikan`);
}

let openHadiahGroups = new Set();
function toggleHadiahGroup(id){ const el=document.getElementById(`hadiah-group-${id}`); if(!el) return; if(openHadiahGroups.has(id)){ openHadiahGroups.delete(id); el.style.display='none'; }else{ openHadiahGroups.add(id); el.style.display='block'; } }
function labelJuara(v){ return (JUARA_LIST.find(j=>j.v===v)||{}).l || v; }

// Form pengaturan budget hadiah per Kategori Peserta (Anak/Ibu/dst) x Juara (1/2/3/Partisipasi).
// Contoh: Lomba Anak - Juara 1 budget 100rb, Juara 2 budget 75rb, Juara 3 budget 50rb, dst.
function openHadiahBudgetModal(){
  if (!canEditSection('hadiah')) { toast('⛔ Login untuk mengedit data'); return; }
  const s = getSettings();
  const bodyHtml = KATEGORI_PESERTA.map(kp => {
    const budgetKp = s.hadiahBudget[kp.v] || {};
    const inputs = JUARA_LIST.map(j => `
      <div class="field">
        <label>${j.l}</label>
        <input type="text" id="budget-${kp.v}-${j.v}" class="currency-input" placeholder="Rp 0" value="${formatCurrency(budgetKp[j.v]||0)}">
      </div>`).join('');
    return `<div style="margin-bottom:14px;padding:14px 16px;border-radius:10px;background:var(--cream);border:1px solid var(--garis);">
      <div style="font-weight:700;margin-bottom:10px;">${kp.l}</div>
      <div class="field-row" style="grid-template-columns:1fr 1fr;">${inputs}</div>
    </div>`;
  }).join('');
  setModal('Atur Budget Hadiah per Kategori', `
    <div style="max-height:60vh;overflow-y:auto;padding-right:4px;">${bodyHtml}</div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:'Simpan Budget', cls:'', onclick:()=>simpanHadiahBudget()}
  ]);
  setTimeout(setupAllCurrencyInputs, 50);
}

function simpanHadiahBudget(){
  if (!canEditSection('hadiah')) { toast('⛔ Login untuk mengedit data'); return; }
  const s = getSettings();
  const newBudget = {};
  const detailLines = [];
  KATEGORI_PESERTA.forEach(kp => {
    newBudget[kp.v] = {};
    JUARA_LIST.forEach(j => {
      const el = document.getElementById(`budget-${kp.v}-${j.v}`);
      const val = el ? getCurrencyValue(el) : 0;
      newBudget[kp.v][j.v] = val;
      if(val > 0) detailLines.push(`${kp.l} - ${labelJuara(j.v)}: ${fmtRp(val)}`);
    });
  });
  s.hadiahBudget = newBudget;
  saveDB(); closeModal(); renderContent();
  toast('💾 Budget hadiah disimpan');
  notifyTelegram(`🎯 Update budget hadiah per kategori`, detailLines.length ? detailLines.join('\n') : 'Semua budget diset Rp0', 'lomba');
}

// Bangun HTML baris-baris item dari sebuah array items paket hadiah. Dipakai saat
// modal pertama dibuka (mode Edit) DAN saat checkDuplikatPaketHadiah mengembalikan
// form ke kombinasi asal paket yang sedang diedit (lihat komentar di sana).
function hadiahItemRowsHtml(items){
  return (items||[]).map((item, idx) => { if(!item.id) item.id = uid(); return `<div class="item-fields-row" data-item-id="${item.id}" style="border-bottom:1px solid var(--garis);padding-bottom:10px;margin-bottom:10px;"><div class="field"><label>Nama</label><input type="text" id="edit-item-name-${idx}" value="${esc(item.nama)}" placeholder="Nama hadiah" onblur="autofillHargaHadiah(this)"></div><div class="field"><label>Harga</label><input type="text" id="edit-item-price-${idx}" class="currency-input" value="${formatCurrency(item.harga_satuan)}" placeholder="Harga"></div><div class="field"><label>Qty/paket</label><input type="number" id="edit-item-perpaket-${idx}" value="${item.qty_per_paket||1}" min="1" placeholder="Qty/paket" title="Berapa pcs per 1 paket juara"></div><button class="btn danger-text small" ${da('removeItemRow')}>✕</button></div>`; }).join('');
}
function openHadiahModal(id){
  if (!canEditSection('hadiah')) { toast('⛔ Login untuk mengedit data'); return; }
  const editing = id ? db.hadiahKategori.find(h=>h.id===id) : null;
  // Untuk mode "Tambah Paket" baru, cari kombinasi kategori+juara yang BELUM
  // punya paket dan jadikan itu default terpilih di dropdown — bukan selalu
  // pilihan pertama (Anak - Juara 1). Kalau default selalu pilihan pertama,
  // dan kombinasi itu kebetulan sudah ada paketnya, cek duplikat yang jalan
  // begitu modal dibuka akan langsung mengalihkan ke paket lain itu SEBELUM
  // pengguna sempat memilih kategori/juara yang sebenarnya ia inginkan —
  // makanya "Tambah Paket" terasa selalu auto-pindah ke edit paket lain.
  let defaultKP = KATEGORI_PESERTA[0].v, defaultJuara = JUARA_LIST[0].v;
  if(!editing){
    const existingCombos = new Set(gHadiahKategori().map(h=>`${h.kategori_peserta}|${h.juara_ke}`));
    let found = false;
    for(const k of KATEGORI_PESERTA){
      for(const j of JUARA_LIST){
        if(!existingCombos.has(`${k.v}|${j.v}`)){ defaultKP = k.v; defaultJuara = j.v; found = true; break; }
      }
      if(found) break;
    }
    // Semua kombinasi Kategori × Juara (termasuk Partisipasi) sudah punya paket —
    // tidak ada kombinasi kosong untuk dijadikan default. Kalau dibiarkan lanjut,
    // modal akan terbuka dengan kombinasi fallback (Anak - Juara 1) yang PASTI
    // sudah terpakai, lalu checkDuplikatPaketHadiah('') di bawah langsung
    // mengalihkan diam-diam ke paket itu tanpa penjelasan — user yang klik
    // "+ Tambah Paket" jadi bingung kenapa tiba-tiba masuk mode edit paket lain.
    // Lebih jelas: beri tahu di sini dan jangan buka modalnya sama sekali.
    if(!found){
      toast('Semua kombinasi Kategori × Juara sudah punya paket hadiah. Edit paket yang ada lewat tombol ✎, atau tambah item baru di paket tersebut.');
      return;
    }
  }
  const itemsHtml = editing ? hadiahItemRowsHtml(editing.items) : '';
  const origKPArg = editing ? editing.kategori_peserta : '';
  const origJuaraArg = editing ? editing.juara_ke : '';
  // doSaveHadiah: logic simpan tunggal dipakai oleh dua tombol ("Tambah/Simpan" dan
  // "Simpan (tetap buka)") supaya perilaku simpan-nya identik — cuma beda di akhir:
  // closeAfter=true menutup modal seperti biasa, closeAfter=false membuka ulang
  // modal ini dalam mode Edit (paket yang baru saja disimpan) supaya form item
  // kosong lagi dan siap diisi item berikutnya tanpa perlu buka modal dari awal.
  const doSaveHadiah = async (closeAfter) => {
      const kategori_peserta=document.getElementById('f-kp').value; const juara_ke=document.getElementById('f-juara').value;
      const paketLain = gHadiahKategori().find(h=>h.kategori_peserta===kategori_peserta && h.juara_ke===juara_ke && (!editing || h.id!==editing.id));
      if(paketLain){
        toast(`Paket ${labelPeserta(kategori_peserta)} - ${labelJuara(juara_ke)} sudah ada, dialihkan ke paket tersebut`);
        closeModal(); openHadiahModal(paketLain.id); return;
      }
      // comboUnchanged: benar-benar mengedit paket yang sama (kombinasi kategori+juara
      // di dropdown masih sama seperti saat modal dibuka). Kalau editing tapi kombinasi
      // SUDAH diganti ke kombinasi lain yang belum ada paketnya, ini bukan lagi
      // "mengedit paket asal" — checkDuplikatPaketHadiah sudah mengosongkan form saat
      // dropdown diganti, jadi form ini sekarang mewakili paket BARU yang terpisah;
      // paket asal (origKPArg/origJuaraArg) TIDAK boleh disentuh/di-Object.assign.
      const comboUnchanged = editing && kategori_peserta===origKPArg && juara_ke===origJuaraArg;
      const kebutuhan=hitungKebutuhanHadiah(kategori_peserta, juara_ke); const existingItems=comboUnchanged?(editing.items||[]):[]; const items=[]; const container=document.getElementById('items-container'); const rows=container.querySelectorAll('.item-fields-row'); rows.forEach((row)=>{const nameInput=row.querySelector(`input[id^="edit-item-name-"]`); const priceInput=row.querySelector(`input[id^="edit-item-price-"]`); const perPaketInput=row.querySelector(`input[id^="edit-item-perpaket-"]`); if(nameInput&&priceInput){const nama=nameInput.value.trim(); const harga_satuan=getCurrencyValue(priceInput); const qty_per_paket=Math.max(1,Number((perPaketInput&&perPaketInput.value)||1)); if(!nama) return;
        const existingId = row.dataset.itemId || null;
        const matched = existingId ? existingItems.find(x=>x.id===existingId) : null;
        const qty_dibeli = matched ? Number(matched.qty_dibeli||0) : (kebutuhan!=null ? kebutuhan*qty_per_paket : qty_per_paket);
        const qty_terpakai = matched ? (matched.qty_terpakai||0) : 0;
        const id = matched ? matched.id : uid();
        const extra = matched ? {isi_per_pack: matched.isi_per_pack, harga_eceran: matched.harga_eceran, riwayatHarga: matched.riwayatHarga} : {};
        items.push({id,nama,harga_satuan,qty_dibeli,qty_per_paket,qty_terpakai,...extra});}});
      if(items.length===0){
        if(!comboUnchanged){ toast('Minimal 1 item'); return; }
        if(!(await confirmModal(`Semua item dikosongkan. Paket hadiah ${labelPeserta(kategori_peserta)} - ${labelJuara(juara_ke)} akan DIHAPUS. Lanjutkan?`))) return;
        db.hadiahKategori = db.hadiahKategori.filter(x=>x.id!==editing.id);
        saveDB(); closeModal(); renderContent(); renderTopbarSaldo(); toast('🗑️ Paket hadiah dihapus');
        notifyTelegram(`🗑️ Hapus paket hadiah ${labelPeserta(kategori_peserta)} - ${labelJuara(juara_ke)}`, 'Semua item dikosongkan dari form edit', 'lomba');
        return;
      }
      let actionMsg = comboUnchanged ? `✏️ Edit paket hadiah ${labelPeserta(kategori_peserta)} - ${labelJuara(juara_ke)}` : `➕ Paket hadiah baru ${labelPeserta(kategori_peserta)} - ${labelJuara(juara_ke)}${editing?` (terpisah dari paket ${labelPeserta(origKPArg)} - ${labelJuara(origJuaraArg)}, tidak diubah)`:''}`;
      if(comboUnchanged){ Object.assign(editing,{kategori_peserta,juara_ke,items});}
      else{ db.hadiahKategori.push({id:uid(),event_id:eid(),kategori_peserta,juara_ke,items}); }
      const currentHadiahId = comboUnchanged ? editing.id : db.hadiahKategori[db.hadiahKategori.length-1].id;
      openHadiahGroups.add(currentHadiahId);
      let totalSama = 0;
      items.forEach((it)=>{ totalSama += samakanHargaItemSejenis(it.nama, it.harga_satuan, it.id); });
      autoSyncHadiahStok(true);
      saveDB(); renderContent(); renderTopbarSaldo();
      const detail = items.map(i => `${i.nama} (${i.qty_dibeli} × ${fmtRp(i.harga_satuan)})`).join('\n');
      notifyTelegram(actionMsg, detail, 'lomba');
      // Beri tahu HASIL aksi lewat toast sesudah tersimpan — bukan lewat label
      // tombol sebelum diklik (label tombolnya sekarang statis, lihat komentar di
      // checkDuplikatPaketHadiah). comboUnchanged=false berarti baris baru dibuat
      // di db.hadiahKategori di atas, jadi ini benar-benar paket terpisah.
      const baseMsg = comboUnchanged ? '💾 Tersimpan' : '➕ Paket baru dibuat';
      if(closeAfter){
        closeModal();
        toast(totalSama>0?`${baseMsg}, harga disamakan ke ${totalSama} item lain`:baseMsg);
      } else {
        // Buka ulang modal ini (sekarang pasti dalam mode Edit karena paketnya sudah
        // ada) supaya form item kosong lagi dan siap diisi item berikutnya, tanpa
        // benar-benar keluar dari alur "tambah paket" dan tanpa perlu cari lagi
        // paketnya lewat tombol ✎.
        closeModal(); openHadiahModal(currentHadiahId);
        toast(totalSama>0?`${baseMsg}, harga disamakan ke ${totalSama} item lain — lanjut tambah item`:`${baseMsg} — lanjut tambah item`);
      }
  };
  setModal(editing?'Edit Paket':'Tambah Paket', `<div class="field-row"><div class="field"><label>Kategori</label><select id="f-kp" onchange="checkDuplikatPaketHadiah('${editing?editing.id:''}','${origKPArg}','${origJuaraArg}')">${KATEGORI_PESERTA.map(k=>`<option value="${k.v}" ${(editing?editing.kategori_peserta===k.v:defaultKP===k.v)?'selected':''}>${k.l}</option>`).join('')}</select></div><div class="field"><label>Juara</label><select id="f-juara" onchange="checkDuplikatPaketHadiah('${editing?editing.id:''}','${origKPArg}','${origJuaraArg}')">${JUARA_LIST.map(j=>`<option value="${j.v}" ${(editing?editing.juara_ke===j.v:defaultJuara===j.v)?'selected':''}>${j.l}</option>`).join('')}</select></div></div><div class="field"><label>Item Hadiah</label><div id="items-container">${itemsHtml}</div><button class="btn secondary small" ${da('addItemRow')} type="button">+ Tambah Item</button></div>`, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:'💾 Simpan', id:'btn-hadiah-save-stay', cls:'secondary', onclick:()=>doSaveHadiah(false)},
    {label:'💾 Simpan & Tutup', id:'btn-hadiah-save-close', cls:'', onclick:()=>doSaveHadiah(true)}
  ]);
  if(editing) openHadiahGroups.add(id);
  setTimeout(setupAllCurrencyInputs, 50);
  // Cek langsung begitu modal terbuka, TAPI cuma untuk mode "Tambah Paket" baru
  // (kalau kombinasi kategori+juara default-nya kebetulan sudah ada paketnya,
  // langsung alihkan ke situ). Sengaja TIDAK dijalankan saat mode Edit, supaya
  // membuka salah satu dari paket duplikat yang sudah kadung ada (dibuat sebelum
  // proteksi ini ada) tidak malah bolak-balik redirect ke paket duplikat satunya.
  if(!editing) checkDuplikatPaketHadiah('');
}
// Dipanggil saat dropdown Kategori/Juara di form paket hadiah diganti (dan sekali
// saat modal dibuka). Kalau kombinasi kategori+juara yang sedang dipilih di form
// sudah punya paket lain (bukan paket yang sedang diedit), langsung tutup modal ini
// dan buka modal edit paket yang sudah ada itu — supaya tidak pernah tercipta 2
// paket terpisah untuk kategori+juara yang sama (isi paket cukup ditambah/edit di
// paket yang sudah ada lewat "+ Tambah Item").
function checkDuplikatPaketHadiah(editingId, originalKP, originalJuara){
  const kpEl=document.getElementById('f-kp'); const jEl=document.getElementById('f-juara');
  const container=document.getElementById('items-container');
  if(!kpEl||!jEl) return;
  const kategori_peserta=kpEl.value; const juara_ke=jEl.value;
  const existing=gHadiahKategori().find(h=>h.kategori_peserta===kategori_peserta && h.juara_ke===juara_ke && h.id!==editingId);
  if(existing){
    toast(`Paket ${labelPeserta(kategori_peserta)} - ${labelJuara(juara_ke)} sudah ada, dialihkan ke paket tersebut`);
    closeModal(); openHadiahModal(existing.id);
    return;
  }
  // Kombinasi kategori/juara yang lagi dipilih di dropdown BELUM punya paket lain
  // (sudah lolos pengecekan `existing` di atas). Form di bawah ini SELALU mewakili
  // isi paket untuk kombinasi yang sedang dipilih itu — bukan cuma untuk mode
  // Tambah Paket, tapi juga mode Edit begitu dropdown-nya diganti ke kombinasi lain.
  const isOriginalCombo = !!(editingId && originalKP && originalJuara && kategori_peserta===originalKP && juara_ke===originalJuara);
  // Tombol simpan sekarang selalu berlabel statis ("Simpan" / "Simpan & Tutup") —
  // apakah aksi ini nantinya bikin paket baru atau mengedit paket asal BUKAN lagi
  // ditebak dari label tombol sebelum diklik, tapi dikasih tahu lewat toast SESUDAH
  // aksi terjadi (lihat actionMsg & toast di doSaveHadiah).
  if(container){
    if(editingId && isOriginalCombo){
      // Dropdown dikembalikan ke kombinasi asal paket yang sedang diedit:
      // tampilkan lagi item-item ASLI paket itu (bukan form kosong), supaya
      // pengguna bisa lanjut edit paket ini seperti semula.
      const editingPaket = gHadiahKategori().find(h=>h.id===editingId);
      container.innerHTML = hadiahItemRowsHtml(editingPaket ? editingPaket.items : []);
      container.querySelectorAll('.currency-input').forEach(setupCurrencyInput);
    } else {
      // Kombinasi yang sedang dipilih (baik di mode Tambah Paket baru, maupun di
      // mode Edit yang dropdown-nya sudah digeser ke kombinasi lain) belum punya
      // paket sendiri — form ini mewakili paket BARU yang masih kosong. Kosongkan
      // supaya item-item milik kombinasi sebelumnya (mis. paket asal yang sedang
      // diedit) tidak ikut kesimpan ke paket yang salah kombinasinya.
      container.innerHTML = '';
    }
  }
}
function addItemRow(){ const container=document.getElementById('items-container'); if(!container) return; const idx=Math.floor(Math.random()*10000); const row=document.createElement('div'); row.className='item-fields-row'; /* sengaja TIDAK diberi data-item-id: baris baru = item baru, id di-generate saat submit */ row.style.cssText='border-bottom:1px solid var(--garis);padding-bottom:10px;margin-bottom:10px;'; row.innerHTML=`<div class="field"><label>Nama</label><input type="text" id="edit-item-name-${idx}" placeholder="Nama hadiah" onblur="autofillHargaHadiah(this)"></div><div class="field"><label>Harga</label><input type="text" id="edit-item-price-${idx}" class="currency-input" placeholder="Harga"></div><div class="field"><label>Qty/paket</label><input type="number" id="edit-item-perpaket-${idx}" placeholder="Qty/paket" value="1" min="1" title="Berapa pcs per 1 paket juara"></div><button class="btn danger-text small" ${da('removeItemRow')}>✕</button>`; container.appendChild(row);
  // Hanya setup input currency milik baris BARU ini — jangan panggil setupAllCurrencyInputs()
  // karena itu akan menempelkan listener kedua/ketiga/dst ke input yang sudah ada sebelumnya
  // (setiap listener dibuat sebagai fungsi anonim baru sehingga browser tidak men-dedupe-nya).
  row.querySelectorAll('.currency-input').forEach(setupCurrencyInput);
}
// Dipanggil lewat data-action tanpa argumen — elemen barisnya didapat dari `this`,
// yaitu tombol yang diklik sendiri (listener delegasi di 16b-event-delegation.js
// memanggil fn.apply(el, args), jadi `this` di sini = elemen ber-data-action).
// Sengaja begini karena elemen DOM tidak bisa dikirim lewat data-args (JSON.stringify).
function removeItemRow(){ const element=this.closest('.item-fields-row'); if(!element) return; element.remove(); const container=document.getElementById('items-container'); if(container && container.querySelectorAll('.item-fields-row').length===0){ container.innerHTML='<div class="hint" style="padding:8px 0;">Belum ada item. Klik "+ Tambah Item", atau langsung Simpan untuk menghapus paket ini.</div>'; } }
// Menyamakan harga_satuan semua item hadiah (lintas semua paket kategori+juara,
// dalam event yang sama) yang namanya SAMA (dibandingkan tanpa peduli besar/kecil
// huruf & spasi berlebih) dengan harga yang baru saja diisi/diedit user di satu
// tempat. Jadi cukup ketik harga sekali, item dengan nama sama di paket lain ikut
// terisi otomatis. excludeItemId dipakai supaya item yang baru saja diedit
// manual tidak dihitung ulang sebagai "item lain yang ikut disamakan". Exclude
// by item.id (bukan hadiahId+idx) karena id tidak berubah walau urutan/array
// bergeser, sedangkan index bisa nyasar ke item lain kalau ada penghapusan
// atau reorder di antaranya.
function samakanHargaItemSejenis(nama, harga, excludeItemId){
  const key = normNamaBarang(nama);
  if(!key || !(Number(harga) > 0)) return 0;
  let count = 0;
  gHadiahKategori().forEach(h=>{
    (h.items||[]).forEach(it=>{
      if(it.id===excludeItemId) return;
      if(normNamaBarang(it.nama)===key && Number(it.harga_satuan||0)!==Number(harga)){
        it.harga_satuan = Number(harga)||0;
        count++;
      }
    });
  });
  return count;
}
// Cari harga yang sudah pernah diisi untuk item dengan nama yang sama (di paket
// manapun, event yang sama). Dipakai untuk auto-isi field harga saat nama diketik.
function cariHargaItemSejenis(nama){
  const key = normNamaBarang(nama);
  if(!key) return null;
  for(const h of gHadiahKategori()){
    for(const it of (h.items||[])){
      if(normNamaBarang(it.nama)===key && Number(it.harga_satuan||0)>0){
        return Number(it.harga_satuan);
      }
    }
  }
  return null;
}
// Cari nama item hadiah lain (paket manapun, event yang sama) yang MIRIP tapi
// tidak identik dengan nama yang baru diketik — mis. "Buku Tulis" vs "Buku
// Tulis 38 Lembar" atau typo tipis "Bulpoin" vs "Bolpoin". Dipakai untuk
// menampilkan peringatan supaya panitia sadar sebelum barang yang sama
// tercatat sebagai 2 barang berbeda di checklist (pengelompokan checklist
// murni exact-match by normNamaBarang, jadi kalau memang barang yang sama,
// namanya harus disamakan persis biar otomatis tergabung).
// excludeHadiahId+excludeItemId dipakai saat edit, supaya item yang sedang
// diedit tidak membandingkan dirinya sendiri.
function cariNamaItemHadiahMirip(nama, excludeHadiahId, excludeItemId){
  if(!String(nama||'').trim()) return null;
  const sudahDicek = new Set();
  for(const h of gHadiahKategori()){
    for(const it of (h.items||[])){
      if(h.id===excludeHadiahId && it.id===excludeItemId) continue;
      const nrm = normNamaBarang(it.nama);
      if(sudahDicek.has(nrm)) continue;
      sudahDicek.add(nrm);
      if(namaBarangMirip(nama, it.nama)) return it.nama;
    }
  }
  return null;
}
// Dipanggil saat input nama item hadiah kehilangan fokus (onblur). Kalau nama yang
// diketik sudah pernah dipakai di paket lain dengan harga tertentu, dan field harga
// di baris ini masih kosong, otomatis isi harga itu — supaya tidak perlu ketik ulang.
function autofillHargaHadiah(nameInput){
  if(!nameInput) return;
  const priceInput = document.getElementById(nameInput.id.replace('name','price'));
  if(!priceInput || getCurrencyValue(priceInput) > 0) return;
  const harga = cariHargaItemSejenis(nameInput.value);
  if(harga!=null) setCurrencyValue(priceInput, harga);
}
async function editHadiahItem(hadiahId,itemId){ 
  if (!canEditSection('hadiah')) { toast('⛔ Login untuk mengedit data'); return; }
  const h=db.hadiahKategori.find(x=>x.id===hadiahId); const item=h && h.items.find(it=>it.id===itemId); if(!item){ toast('Item tidak ditemukan'); return; }
  const newNama = await promptModal({title:'Edit Item Hadiah', label:'Nama', defaultValue:item.nama});
  if(newNama===null) return;
  const newHarga = await promptModal({title:'Edit Item Hadiah', label:'Harga (Rp)', defaultValue:item.harga_satuan, type:'currency'});
  if(newHarga===null) return;
  const newPerPaket = await promptModal({title:'Edit Item Hadiah', label:'Qty per paket', hint:'Dasar hitung kebutuhan otomatis.', defaultValue:item.qty_per_paket||1, type:'number'});
  if(newPerPaket===null) return;
  const newQty = await promptModal({title:'Edit Item Hadiah', label:'Qty total (dibeli)', hint:'Boleh diisi lebih untuk cadangan. Kalau diisi kurang dari kebutuhan (jumlah lomba × qty/paket), badge "⚠️ Kurang" akan muncul lagi.', defaultValue:item.qty_dibeli, type:'number'});
  if(newQty===null) return;
  if(!newNama.trim()||Number(newQty)<0){toast('Nama & qty wajib');return;}
  const namaMirip = cariNamaItemHadiahMirip(newNama.trim(), hadiahId, itemId);
  if(namaMirip && !(await confirmModal(`⚠️ Barang mirip terdeteksi: "${namaMirip}"\n\nNama "${newNama.trim()}" ini mirip tapi tidak identik dengan barang yang sudah ada. Kalau maksudnya barang yang SAMA, batalkan lalu ketik ulang persis "${namaMirip}" supaya otomatis tergabung di satu checklist.\n\nKalau memang barang beda, lanjutkan simpan?`))) return;
  if(Number(newQty)!==Number(item.qty_dibeli||0) && isItemHadiahSudahDibeli(hadiahId, itemId)){
    if(!(await confirmModal(`⚠️ "${item.nama}" sudah dicentang DIBELI di Daftar Belanja.\n\nQty di sini cuma angka kebutuhan (target), bukan barang fisik yang sudah dibeli — ubah kalau memang sudah dicek ulang. Lanjutkan?`))) return;
  }
  item.nama=newNama.trim(); item.harga_satuan=Number(newHarga)||0; item.qty_per_paket=Math.max(1,Number(newPerPaket)||1); item.qty_dibeli=Number(newQty)||0;
  const samaCount = samakanHargaItemSejenis(item.nama, item.harga_satuan, item.id);
  saveDB(); renderContent(); toast(samaCount>0?`Diupdate, harga disamakan ke ${samaCount} item "${item.nama}" lainnya`:'Diupdate'); 
  notifyTelegram(`✏️ Edit item hadiah: ${item.nama}`, `Paket: ${labelPeserta(h.kategori_peserta)} - ${labelJuara(h.juara_ke)}\nHarga: ${fmtRp(item.harga_satuan)}\nQty: ${item.qty_dibeli}${item.qty_per_paket>1?` (${item.qty_per_paket} buah per paket)`:''}`, 'lomba');
}
async function hapusHadiahItem(hadiahId,itemId){ 
  if (!canEditSection('hadiah')) { toast('⛔ Login untuk mengedit data'); return; }
  const h=db.hadiahKategori.find(x=>x.id===hadiahId); const itemIdx=h ? h.items.findIndex(it=>it.id===itemId) : -1; if(itemIdx===-1){ toast('Item tidak ditemukan'); return; } const itemName = h.items[itemIdx].nama; if(!(await confirmModal(`Hapus "${itemName}"?`))) return; h.items.splice(itemIdx,1); const paketHabis = h.items.length===0; if(paketHabis) db.hadiahKategori=db.hadiahKategori.filter(x=>x.id!==hadiahId);
  // Ikut hapus status belanja yang mereferensikan item ini (dan seluruh paket kalau
  // paketnya ikut terhapus karena sudah kosong), supaya tidak jadi orphan permanen
  // di kt_daftar_belanja_hadiah.
  db.daftarBelanjaHadiah = db.daftarBelanjaHadiah.filter(b=> !(b.hadiah_kategori_id===hadiahId && (b.item_id===itemId || paketHabis)));
  saveDB(); renderContent(); toast('Dihapus'); 
  notifyTelegram(`🗑️ Hapus item hadiah: ${itemName}`, `Paket: ${labelPeserta(h.kategori_peserta)} - ${labelJuara(h.juara_ke)}`, 'lomba');
}
async function tambahItemHadiah(hadiahId, kebutuhan){ 
  if (!canEditSection('hadiah')) { toast('⛔ Login untuk mengedit data'); return; }
  const h=db.hadiahKategori.find(x=>x.id===hadiahId); if(!h) return; const nama=document.getElementById(`add-item-name-${hadiahId}`).value.trim(); const harga=getCurrencyValue(document.getElementById(`add-item-price-${hadiahId}`)); const perPaketEl=document.getElementById(`add-item-perpaket-${hadiahId}`); const qtyPerPaket=Math.max(1,Number((perPaketEl&&perPaketEl.value)||1)); if(!nama){toast('Nama wajib diisi');return;}
  const namaMirip = cariNamaItemHadiahMirip(nama, null, null);
  if(namaMirip && !(await confirmModal(`⚠️ Barang mirip terdeteksi: "${namaMirip}"\n\nBarang baru "${nama}" ini mirip tapi tidak identik dengan barang yang sudah ada. Kalau maksudnya barang yang SAMA, batalkan lalu ketik ulang persis "${namaMirip}" supaya otomatis tergabung di satu checklist.\n\nKalau memang barang beda, lanjutkan simpan sebagai barang terpisah?`))) return;
  const qty = (kebutuhan!=null&&kebutuhan!=='null') ? Number(kebutuhan)*qtyPerPaket : qtyPerPaket; const newItem = {id:uid(),nama,harga_satuan:harga,qty_dibeli:qty,qty_per_paket:qtyPerPaket}; h.items.push(newItem);
  const samaCount = samakanHargaItemSejenis(nama, harga, newItem.id);
  document.getElementById(`add-item-name-${hadiahId}`).value=''; document.getElementById(`add-item-price-${hadiahId}`).value=''; if(perPaketEl) perPaketEl.value='1'; saveDB(); renderContent(); toast(samaCount>0?`Item ditambahkan, harga disamakan ke ${samaCount} item "${nama}" lainnya`:'Item ditambahkan'); 
  notifyTelegram(`➕ Item hadiah baru: ${nama}`, `Paket: ${labelPeserta(h.kategori_peserta)} - ${labelJuara(h.juara_ke)}\nHarga: ${fmtRp(harga)}\nQty: ${qty}${qtyPerPaket>1?` (${qtyPerPaket} buah per paket)`:''}`, 'lomba');
}
async function hapusHadiah(id){ 
  if (!canEditSection('hadiah')) { toast('⛔ Login untuk mengedit data'); return; }
  const h=db.hadiahKategori.find(x=>x.id===id); if(!h) return; if(!(await confirmModal('Hapus paket?'))) return; db.hadiahKategori=db.hadiahKategori.filter(x=>x.id!==id); 
  // Ikut hapus semua status belanja milik paket ini, supaya tidak jadi orphan
  // permanen di kt_daftar_belanja_hadiah.
  db.daftarBelanjaHadiah = db.daftarBelanjaHadiah.filter(b=>b.hadiah_kategori_id!==id);
  saveDB(); renderContent(); renderTopbarSaldo(); 
  notifyTelegram(`🗑️ Hapus paket hadiah`, `Kategori: ${labelPeserta(h.kategori_peserta)}\nJuara: ${labelJuara(h.juara_ke)}`, 'lomba');
}
