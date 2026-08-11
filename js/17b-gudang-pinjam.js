/* ============================================================
   TAB: AJUKAN PINJAM
   ============================================================ */
function renderGudangPinjam(){
  const belumKembali = gudangTransactions.filter(t=>t.status==='aktif'||t.status==='bermasalah');
  const totalUnitBelumKembali = belumKembali.reduce((s,t)=>s+t.items.reduce((x,it)=>x+it.qty,0),0);

  const statusCard = belumKembali.length===0 ? `
    <div class="panel" style="border-left:3px solid var(--hijau);">
      <div class="panel-body"><b>✅ Semua Barang Sudah Kembali</b><div class="desc" style="margin-top:4px;">Tidak ada peminjaman yang sedang berjalan saat ini.</div></div>
    </div>` : `
    <div class="panel" style="border-left:3px solid var(--orange);">
      <div class="panel-body">
        <b>⚠️ ${totalUnitBelumKembali} unit belum kembali</b>
        <div class="desc" style="margin-top:4px;">${belumKembali.length} peminjaman masih berada di luar gudang. Lihat detailnya di tab Riwayat Peminjaman.</div>
      </div>
    </div>`;

  return `
  ${statusCard}
  <div class="panel">
    <div class="panel-head">
      <div><h3>Pengajuan Pinjam Aset</h3><div class="desc">Isi form untuk meminjam barang inventaris desa. Stok akan berkurang otomatis setelah pengajuan dikirim.</div></div>
      <button class="btn" ${da('openGudangPinjamModal')}>+ Ajukan Peminjaman</button>
    </div>
  </div>`;
}

// Nota nomor & tampilan dipakai di 2 tempat: modal konfirmasi sebelum kirim,
// dan tab Riwayat Peminjaman (supaya peminjam bisa lihat ulang nota yang sudah disetujui).
function buildGudangNotaHtml({resi, nama, alamat, pencatat, tglPinjam, tglKembali, items, tanggalCetak, statusHtml}){
  const dataPeminjam = [
    ['Nama Peminjam', esc(nama)],
    ['RT / Alamat', esc(alamat)],
  ];
  const dataPeminjaman = [
    ['Pencatat', esc(pencatat)],
    ['Tanggal Pinjam', fmtGudangTanggal(tglPinjam)],
    ['Rencana Kembali', fmtGudangTanggal(tglKembali)],
  ];
  const totalQty = items.reduce((s,it)=>s+Number(it.qty||0),0);
  // Kolom "Gudang" digabung jadi sub-teks di bawah nama barang (bukan kolom
  // terpisah) supaya tabel cuma 3 kolom — di layar HP yang sempit, 4 kolom
  // (No/Nama/Gudang/Qty) gampang kepotong di sisi kanan karena kolom Gudang
  // ikut rebutan lebar dengan kolom lain.
  const itemRows = items.map((it,i)=>`<tr>
    <td class="no">${i+1}</td>
    <td class="nama-cell"><div class="nb-nama">${esc(it.nama)}</div><div class="nb-gudang">${esc(it.gudang)}</div></td>
    <td class="num">${it.qty}</td>
  </tr>`).join('');
  return `
    <div class="nota-sheet" id="gudang-nota-sheet">
      <div class="nota-header">
        <img src="${esc(getOrgLogo())}" alt="Logo ${esc(getOrgNama())}" class="nota-logo">
        <div class="nota-header-text">
          <div class="nota-org">${esc(getOrgNama())}</div>
          <div class="nota-org-sub">Bagian Gudang &amp; Inventaris</div>
        </div>
        <div class="nota-title-wrap">
          <div class="nota-title">Nota Pengajuan Pinjam</div>
          <div class="nota-no">No. ${esc(resi)} · ${fmtGudangTanggal(tanggalCetak)}</div>
        </div>
      </div>
      <div class="nota-body">
        <div class="nota-section-label">Data Peminjam</div>
        <div class="nota-info-grid">
          ${dataPeminjam.map(([l,v])=>`<div class="nota-info-item"><span class="l">${l}</span><span class="v">${v}</span></div>`).join('')}
        </div>
        <div class="nota-section-label">Detail Peminjaman</div>
        <div class="nota-info-grid">
          ${dataPeminjaman.map(([l,v])=>`<div class="nota-info-item"><span class="l">${l}</span><span class="v">${v}</span></div>`).join('')}
        </div>
        <div class="nota-section-label">Rincian Barang</div>
        <table class="nota-table">
          <thead><tr><th style="width:24px;">No</th><th>Nama Barang</th><th class="num">Qty</th></tr></thead>
          <tbody>${itemRows}</tbody>
          <tfoot><tr class="nota-total-row"><td colspan="2">Total ${items.length} jenis barang</td><td class="num">${totalQty} unit</td></tr></tfoot>
        </table>
      </div>
      ${statusHtml || ''}
    </div>`;
}

// Opsi RT pada form pengajuan pinjam — beda dari RT_LIST menu Anggota, karena di sini
// perlu opsi "Lainnya" untuk peminjam dari luar desa (input alamat manual).
const GUDANG_PINJAM_RT_LIST = [
  {v:'rt1', l:'RT 1'},
  {v:'rt2', l:'RT 2'},
  {v:'rt3', l:'RT 3'},
  {v:'lainnya', l:'Lainnya (Luar Desa)'},
];
let _gudangPinjamRows = [];
let _gudangPinjamHeader = {nama:'', rt:'', alamatCustom:'', pencatat:'', tglPinjam:'', tglKembali:''};
function openGudangPinjamModal(){
  const aktif = gudangInventory.filter(i=>i.isActive);
  if(aktif.length===0){ toast('⛔ Belum ada aset aktif yang bisa dipinjam.'); return; }
  _gudangPinjamRows = [{itemId:'', qty:1}];
  _gudangPinjamHeader = {nama:'', rt:'', alamatCustom:'', pencatat:'', tglPinjam:todayISO(), tglKembali:''};
  renderGudangPinjamModalBody();
}
function gudangComboIconChevron(){
  return `<svg class="combo-chevron" width="15" height="15" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function gudangComboIconCheck(){
  return `<svg class="combo-check" width="15" height="15" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function gudangComboItemLabel(i){ return i ? `${i.nama} — ${i.gudang}` : ''; }
function gudangComboPanelHtml(idx, selectedId){
  const {order, map} = gudangGroupByLokasi(gudangInventory.filter(i=>i.isActive));
  // Barang yang sudah dipilih di baris LAIN (bukan baris ini sendiri) tidak boleh
  // dipilih lagi — mencegah barang yang sama muncul di 2 baris berbeda dalam satu
  // pengajuan (dulu cuma di-merge otomatis saat submit, jadi user bisa bingung
  // kenapa barang A kelihatan dobel di dropdown).
  const dipilihDiBarisLain = new Set(
    _gudangPinjamRows.filter((r,i)=>i!==idx && r.itemId).map(r=>r.itemId)
  );
  const groupsHtml = order.map(lokasi=>`
    <div class="combo-group" data-combo-group>
      <div class="combo-group-label">${esc(lokasi)}</div>
      ${map[lokasi].map(i=>{
        const habis = i.tersedia<=0;
        const sudahDipilih = dipilihDiBarisLain.has(i.id);
        const nonAktif = habis || sudahDipilih;
        const selected = i.id===selectedId;
        return `<button type="button" class="combo-option${nonAktif?' disabled':''}${selected?' selected':''}"
          ${nonAktif?'disabled':da('selectGudangComboItem', idx, i.id)}>
          <span class="combo-option-main">
            <span class="combo-option-name">${esc(i.nama)}</span>
          </span>
          <span class="combo-option-side">
            ${habis ? '<span class="badge stok-habis">Habis</span>' : sudahDipilih ? '<span class="badge stok-habis">Sudah dipilih</span>' : `<span class="combo-option-sisa">Sisa ${i.tersedia}</span>`}
            ${selected ? gudangComboIconCheck() : ''}
          </span>
        </button>`;
      }).join('')}
    </div>`).join('');
  return `
    <div class="combo-list" data-combo-list>${groupsHtml || '<div class="combo-empty">Belum ada aset aktif.</div>'}</div>`;
}
let _gudangComboOpenIdx = null;
let _gudangComboPanelEl = null;
function gudangComboPositionPanel(trigger, panel){
  const rect = trigger.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  // Lebar panel dilebarkan minimal 280px (atau lebar trigger kalau memang lebih lebar dari itu),
  // supaya nama barang yang panjang tidak terpotong di layar sempit/mobile — panel tidak lagi
  // dibatasi persis selebar tombol combo yang berbagi ruang dengan kolom Jumlah & tombol hapus.
  const panelWidth = Math.min(vw - 16, Math.max(rect.width, 280));
  panel.style.left = Math.max(8, rect.left) + 'px';
  panel.style.width = panelWidth + 'px';
  // Ukur tinggi panel dulu (sudah ada di body tapi belum "show") supaya bisa hitung apakah cukup ruang di bawah.
  const panelH = panel.offsetHeight || 320;
  const spaceBelow = vh - rect.bottom;
  const spaceAbove = rect.top;
  if(spaceBelow < panelH + 12 && spaceAbove > spaceBelow){
    panel.style.top = Math.max(8, rect.top - panelH - 6) + 'px';
  } else {
    panel.style.top = (rect.bottom + 6) + 'px';
  }
  // Jangan sampai melebar keluar dari layar di kanan
  const maxLeft = vw - panelWidth - 8;
  if(parseFloat(panel.style.left) > maxLeft) panel.style.left = Math.max(8, maxLeft) + 'px';
}
function gudangRTComboPanelHtml(selectedValue){
  const optionsHtml = GUDANG_PINJAM_RT_LIST.map(r=>{
    const selected = r.v === selectedValue;
    return `<button type="button" class="combo-option${selected?' selected':''}" ${da('selectGudangRT', r.v)}>
      <span class="combo-option-main"><span class="combo-option-name">${esc(r.l)}</span></span>
      <span class="combo-option-side">${selected ? gudangComboIconCheck() : ''}</span>
    </button>`;
  }).join('');
  return `<div class="combo-list" data-combo-list>${optionsHtml}</div>`;
}
function toggleGudangRTCombo(){
  const trigger = document.getElementById('gp-rt-trigger');
  if(!trigger) return;
  if(_gudangComboOpenIdx === 'rt'){ closeAllGudangCombos(); return; }
  closeAllGudangCombos();
  const panel = document.createElement('div');
  panel.className = 'combo-panel combo-panel-floating';
  panel.id = 'gudang-combo-floating';
  panel.innerHTML = gudangRTComboPanelHtml(_gudangPinjamHeader.rt);
  document.body.appendChild(panel);
  gudangComboPositionPanel(trigger, panel);
  requestAnimationFrame(()=>panel.classList.add('show'));
  trigger.classList.add('open');
  _gudangComboOpenIdx = 'rt';
  _gudangComboPanelEl = panel;
}
function selectGudangRT(v){
  _gudangPinjamHeader.rt = v;
  closeAllGudangCombos();
  renderGudangPinjamModalBody();
}
function toggleGudangCombo(idx){
  const trigger = document.getElementById(`gp-combo-trigger-${idx}`);
  if(!trigger) return;
  if(_gudangComboOpenIdx === idx){ closeAllGudangCombos(); return; }
  closeAllGudangCombos();
  const row = _gudangPinjamRows[idx];
  const panel = document.createElement('div');
  panel.className = 'combo-panel combo-panel-floating';
  panel.id = 'gudang-combo-floating';
  panel.innerHTML = gudangComboPanelHtml(idx, row ? row.itemId : '');
  document.body.appendChild(panel);
  gudangComboPositionPanel(trigger, panel);
  requestAnimationFrame(()=>panel.classList.add('show'));
  trigger.classList.add('open');
  _gudangComboOpenIdx = idx;
  _gudangComboPanelEl = panel;
}
function closeAllGudangCombos(){
  if(_gudangComboPanelEl){ _gudangComboPanelEl.remove(); _gudangComboPanelEl = null; }
  document.querySelectorAll('.combo-trigger.open').forEach(t=>t.classList.remove('open'));
  _gudangComboOpenIdx = null;
}
function selectGudangComboItem(idx, itemId){
  _gudangPinjamRows[idx].itemId = itemId;
  closeAllGudangCombos();
  renderGudangPinjamModalBody();
}
document.addEventListener('click', (e)=>{
  if(e.target.closest('.combo-panel-floating') || e.target.closest('.combo-trigger')) return;
  closeAllGudangCombos();
});
function gudangComboRepositionOpen(){
  if(_gudangComboOpenIdx===null || !_gudangComboPanelEl) return;
  const trigger = document.getElementById(`gp-combo-trigger-${_gudangComboOpenIdx}`);
  if(!trigger || !document.body.contains(trigger)){ closeAllGudangCombos(); return; }
  gudangComboPositionPanel(trigger, _gudangComboPanelEl);
}
// Pakai reposisi (bukan tutup) saat resize/scroll — resize sering terpicu oleh
// keyboard HP yang muncul waktu kolom cari di-fokus, jadi kalau langsung ditutup
// dropdown-nya akan langsung hilang lagi begitu baru dibuka (flicker berulang).
window.addEventListener('resize', gudangComboRepositionOpen);
window.addEventListener('scroll', gudangComboRepositionOpen, true);
document.addEventListener('keydown', (e)=>{
  if(e.key==='Escape') closeAllGudangCombos();
});
function renderGudangPinjamModalBody(){
  const activeInv = gudangInventory.filter(i=>i.isActive);
  const rowsHtml = _gudangPinjamRows.map((r,idx)=>{
    const selectedItem = activeInv.find(i=>i.id===r.itemId);
    return `
    <div class="item-fields-row" style="display:flex; gap:8px; align-items:flex-end; margin-bottom:10px;">
      <div class="field combo" style="flex:2; margin-bottom:0; position:relative;">
        ${idx===0 ? `<label>Barang <span class="combo-hint">— ketuk untuk lihat daftar &amp; stok</span></label>` : ''}
        <button type="button" id="gp-combo-trigger-${idx}" class="combo-trigger${selectedItem?'':' placeholder'}" ${da('toggleGudangCombo', idx)}>
          <span class="combo-trigger-label">${selectedItem ? esc(gudangComboItemLabel(selectedItem)) : '-- Pilih Barang --'}</span>
          ${gudangComboIconChevron()}
        </button>
      </div>
      <div class="field" style="flex:1; margin-bottom:0;">
        ${idx===0 ? `<label>Jumlah</label>` : ''}
        <input type="number" min="1" value="${r.qty}" oninput="_gudangPinjamRows[${idx}].qty=parseInt(this.value,10)||1">
      </div>
      <button type="button" class="icon-btn" title="Hapus baris" ${da('gudangPinjamRemoveRow', idx)}>🗑</button>
    </div>`;
  }).join('');

  const rtValue = _gudangPinjamHeader.rt;
  const isLainnya = rtValue === 'lainnya';
  const rtSelected = GUDANG_PINJAM_RT_LIST.find(r=>r.v===rtValue);
  const body = `
    <div class="field"><label>Nama Peminjam</label><input type="text" id="gp-nama" placeholder="Nama lengkap peminjam" value="${esc(_gudangPinjamHeader.nama)}" oninput="_gudangPinjamHeader.nama=this.value"></div>
    <div class="field combo" style="margin-bottom:0; position:relative;">
      <label>RT</label>
      <button type="button" id="gp-rt-trigger" class="combo-trigger${rtSelected?'':' placeholder'}" ${da('toggleGudangRTCombo')}>
        <span class="combo-trigger-label">${rtSelected ? esc(rtSelected.l) : '-- Pilih RT --'}</span>
        ${gudangComboIconChevron()}
      </button>
    </div>
    ${isLainnya ? `<div class="field" style="margin-top:14px;"><label>Alamat Lengkap <span class="combo-hint">— untuk peminjam luar desa</span></label><input type="text" id="gp-alamat-custom" placeholder="Contoh: Ds. Sukamaju, Kec. ..." value="${esc(_gudangPinjamHeader.alamatCustom)}" oninput="_gudangPinjamHeader.alamatCustom=this.value"></div>` : `<div style="margin-bottom:14px;"></div>`}
    <div class="field"><label>Nama Pencatat</label><input type="text" id="gp-pencatat" placeholder="Nama petugas pencatat" value="${esc(_gudangPinjamHeader.pencatat)}" oninput="_gudangPinjamHeader.pencatat=this.value"></div>
    <div class="filter-row">
      <div class="field" style="flex:1;"><label>Tanggal Pinjam</label><input type="date" id="gp-tgl-pinjam" value="${esc(_gudangPinjamHeader.tglPinjam)}" oninput="_gudangPinjamHeader.tglPinjam=this.value"></div>
      <div class="field" style="flex:1;"><label>Rencana Kembali</label><input type="date" id="gp-tgl-kembali" value="${esc(_gudangPinjamHeader.tglKembali)}" oninput="_gudangPinjamHeader.tglKembali=this.value"></div>
    </div>
    <div style="border-top:1px solid var(--garis); padding-top:14px; margin-top:6px;">
      <label style="display:block; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-soft); margin-bottom:10px;">Barang yang Dipinjam</label>
      <div id="gp-item-rows">${rowsHtml}</div>
      <button type="button" class="btn secondary small" ${da('gudangPinjamAddRow')}>+ Tambah Barang Lain</button>
    </div>`;

  setModal('Ajukan Peminjaman Aset', body, [
    {label:'Batal', cls:'secondary', onclick: closeModal},
    {label:'Periksa & Kirim', onclick: gudangValidateAndConfirmPinjam},
  ]);
}
function gudangPinjamAddRow(){
  _gudangPinjamRows.push({itemId:'', qty:1});
  const newIdx = _gudangPinjamRows.length-1;
  renderGudangPinjamModalBody();
  setTimeout(()=>toggleGudangCombo(newIdx), 80);
}
function gudangPinjamRemoveRow(idx){
  if(_gudangPinjamRows.length<=1){ toast('Minimal satu baris barang diperlukan.'); return; }
  closeAllGudangCombos();
  _gudangPinjamRows.splice(idx,1);
  renderGudangPinjamModalBody();
}

function gudangValidateAndConfirmPinjam(){
  const nama = document.getElementById('gp-nama').value.trim();
  const rt = _gudangPinjamHeader.rt;
  if(!rt){ toast('⛔ Pilih RT peminjam.'); return; }
  const rtLabel = (GUDANG_PINJAM_RT_LIST.find(r=>r.v===rt)||{}).l || rt;
  const alamat = rt==='lainnya' ? (document.getElementById('gp-alamat-custom').value.trim()) : rtLabel;
  if(rt==='lainnya' && !alamat){ toast('⛔ Isi alamat lengkap untuk peminjam luar desa.'); return; }
  const wa = document.getElementById('gp-pencatat').value.trim();
  const tglPinjam = document.getElementById('gp-tgl-pinjam').value;
  const tglKembali = document.getElementById('gp-tgl-kembali').value;

  if(!nama || !alamat || !wa || !tglPinjam || !tglKembali){ toast('⛔ Lengkapi semua data peminjam.'); return; }
  if(tglKembali < tglPinjam){ toast('⛔ Tanggal kembali tidak boleh sebelum tanggal pinjam.'); return; }

  const items = [];
  for(const r of _gudangPinjamRows){
    if(!r.itemId){ toast('⛔ Pilih barang pada setiap baris.'); return; }
    if(!r.qty || r.qty<1){ toast('⛔ Jumlah barang harus minimal 1.'); return; }
    const inv = gudangInventory.find(i=>i.id===r.itemId);
    if(!inv){ toast('⛔ Barang tidak ditemukan.'); return; }
    items.push({itemId:r.itemId, nama:inv.nama, gudang:inv.gudang, qty:r.qty});
  }
  const merged = {};
  items.forEach(it=>{ if(merged[it.itemId]) merged[it.itemId].qty+=it.qty; else merged[it.itemId]={...it}; });
  const finalItems = Object.values(merged);
  for(const it of finalItems){
    const inv = gudangInventory.find(i=>i.id===it.itemId);
    if(it.qty > inv.tersedia){ toast(`⛔ Total ${it.nama} melebihi stok tersedia (${inv.tersedia}).`); return; }
  }

  const pending = {nama, alamat, wa, tglPinjam, tglKembali, finalItems};
  const nomorNota = 'NP-' + Date.now().toString().slice(-6);
  const notaHtml = buildGudangNotaHtml({
    resi: nomorNota, nama, alamat, pencatat: wa, tglPinjam, tglKembali,
    items: finalItems, tanggalCetak: todayISO(),
    statusHtml: `<div class="nota-footer">⚠️ <span>Setelah dikirim, stok barang langsung berkurang dan data tersimpan di server. Periksa nama barang &amp; jumlah dengan teliti sebelum melanjutkan.</span></div>`,
  });
  setModal('Periksa Sebelum Mengirim', notaHtml, [
    {label:'Periksa Lagi', cls:'secondary', onclick: renderGudangPinjamModalBody},
    {label:'Ya, Sudah Benar — Kirim', onclick: ()=>gudangSubmitPinjam(pending)},
  ]);
}

async function gudangSubmitPinjam(p){
  closeModal();
  toast('⏳ Mengirim pengajuan...');
  try{
    const seqRes = await sb.rpc('kt_gudang_claim_next_resi', {});
    if(seqRes.error || !seqRes.data || !seqRes.data.length) throw new Error(seqRes.error?.message || 'Gagal mengklaim nomor resi.');
    const seq = seqRes.data[0].seq;
    const resi = 'TRX-' + String(seq).padStart(3,'0');
    const trxId = uid();

    // Insert transaksi + rincian barang + potong stok dilakukan ATOMIK di server
    // lewat satu RPC (kt_gudang_submit_pinjam) — kalau stok item mana pun tidak
    // cukup, atau salah satu langkah gagal di tengah, Postgres otomatis
    // membatalkan semuanya. Tidak perlu lagi rollback manual dari sisi JS.
    const itemsPayload = p.finalItems.map(it => ({item_id: it.itemId, nama: it.nama, gudang: it.gudang, qty: it.qty}));
    const r = await sb.rpc('kt_gudang_submit_pinjam', {
      p_trx_id: trxId, p_resi: resi, p_nama: p.nama, p_alamat: p.alamat, p_wa: p.wa,
      p_tgl_pinjam: p.tglPinjam, p_tgl_kembali: p.tglKembali, p_items: itemsPayload,
    });
    if(r.error) throw new Error(r.error.message || 'Gagal menyimpan pengajuan.');

    // RPC sudah sukses penuh di server -> baru sinkronkan state lokal.
    p.finalItems.forEach(it => {
      const invItem = gudangInventory.find(i=>i.id===it.itemId);
      if(invItem) invItem.tersedia -= it.qty;
    });
    const trx = {id:trxId, resi, nama:p.nama, alamat:p.alamat, wa:p.wa, tglPinjam:p.tglPinjam, tglKembali:p.tglKembali, status:'aktif', items:p.finalItems};
    gudangTransactions.unshift(trx);
    toast('✅ Peminjaman berhasil disimpan.');
    gudangOpenReceipt(trx);
  }catch(err){
    console.error(err);
    toast('⛔ Gagal menyimpan: ' + err.message);
  }
}

function gudangBuildWaMessage(trx){
  const itemsText = trx.items.map(it=>`- ${it.qty}× ${it.nama} (${it.gudang})`).join('%0A');
  return `*PENGAJUAN PINJAM ASET DESA*%0AResi: ${trx.resi}%0ANama: ${trx.nama}%0AAlamat: ${trx.alamat}%0ATgl Pinjam: ${fmtGudangTanggal(trx.tglPinjam)}%0ARencana Kembali: ${fmtGudangTanggal(trx.tglKembali)}%0A%0ABarang:%0A${itemsText}`;
}
function gudangOpenReceipt(trx){
  const lines = [
    ['Alamat', esc(trx.alamat)], ['Pencatat', esc(trx.wa)],
    ['Tgl Pinjam', fmtGudangTanggal(trx.tglPinjam)], ['Rencana Kembali', fmtGudangTanggal(trx.tglKembali)],
    ...trx.items.map(it=>['Barang', `${it.qty}× ${esc(it.nama)} (${esc(it.gudang)})`]),
  ];
  const body = `<p class="mono" style="font-size:15px; margin:0 0 12px;">#${esc(trx.resi)} — ${esc(trx.nama)}</p>
    ${lines.map(([k,v])=>`<div class="filter-row" style="margin-bottom:4px;"><b style="min-width:120px;">${k}</b><span>${v}</span></div>`).join('')}`;
  setModal('Bukti Pengajuan', body, [
    {label:'Tutup', cls:'secondary', onclick: closeModal},
    {label:'Kirim ke WhatsApp Admin', onclick: ()=>window.open(`https://wa.me/?text=${gudangBuildWaMessage(trx)}`, '_blank')},
  ]);
}
