/* ============================================================
   DONATUR, TRANSAKSI, OPERASIONAL (dengan auth check)
   ============================================================ */
// Teks kolom "Donasi" di tabel & LPJ: uang tampil sebagai Rupiah, barang
// tampil sebagai qty+satuan+nama barang (bukan Rupiah — donasi barang
// sengaja TIDAK dihitung sebagai uang, lihat hitungBukuUtama()).
function donasiValueText(d){
  if(d.jenis==='barang'){
    return `📦 ${Number(d.qty||1)}${d.satuan?` ${esc(d.satuan)}`:''} — ${esc(d.nama_barang||'-')}`;
  }
  return fmtRp(d.jumlah);
}
function renderDonatur(){
  const list = gDonatur().slice().sort((a,b)=>(b.tanggal||'').localeCompare(a.tanggal||''));
  const barangList = list.filter(d=>d.jenis==='barang');
  const total = list.reduce((s,d)=>s + (d.jenis==='barang' ? 0 : Number(d.jumlah||0)), 0);
  const isLoggedIn = !!getCurrentUser();
  const rows = list.map((d,idx)=>`<tr${isLoggedIn ? ` class="row-clickable" ${da('openDonaturModal', d.id)}` : ''}><td>${idx+1}</td><td>${dateResponsive(d.tanggal)}</td><td>${esc(d.nama_donatur)}</td><td class="num">${donasiValueText(d)}</td>${isLoggedIn ? `<td style="text-align:right;">
    <button class="icon-btn" ${da('hapusDonatur', d.id)}>🗑</button>
  </td>` : ''}</tr>`).join('');
  return `<div class="stat-grid"><div class="stat-card pemasukan"><div class="lbl">Total Donasi (Uang)</div><div class="val">${fmtRp(total)}</div></div>${barangList.length ? `<div class="stat-card"><div class="lbl">Sumbangan Barang</div><div class="val">${barangList.length}</div></div>` : ''}</div>
  <div class="panel"><div class="panel-head"><h3>Daftar Donatur</h3>${isLoggedIn ? `<button class="btn" ${da('openDonaturModal')}>+ Tambah</button>` : ''}</div>
  <div class="panel-body flush"><table class="general-table tanggal-nominal-table donatur-table"><thead><tr><th>No</th><th>${thResponsive('Tanggal','Tgl')}</th><th>Nama</th><th class="num">Donasi</th>${isLoggedIn ? '<th></th>' : ''}</tr></thead>
  <tbody>${rows||`<tr class="empty-row"><td colspan="${isLoggedIn?5:4}">Belum ada donasi.</td></tr>`}</tbody></table></div></div>`;
}
function toggleDonaturJenisFields(){
  const jenis = document.getElementById('f-jenis')?.value;
  const uangWrap = document.getElementById('f-uang-wrap');
  const barangWrap = document.getElementById('f-barang-wrap');
  if(uangWrap) uangWrap.style.display = jenis==='barang' ? 'none' : '';
  if(barangWrap) barangWrap.style.display = jenis==='barang' ? '' : 'none';
}
function openDonaturModal(id){
  if (!canEditSection('donatur')) { toast('⛔ Login untuk mengedit data'); return; }
  const editing = id ? db.donatur.find(d=>d.id===id) : null;
  const isBarang = editing && editing.jenis==='barang';
  setModal(editing?'Edit Donasi':'Tambah Donasi', `
    <div class="field"><label>Nama Donatur</label><input id="f-nama" value="${editing?esc(editing.nama_donatur):''}"></div>
    <div class="field-row">
      <div class="field"><label>Jenis Donasi</label><select id="f-jenis" onchange="toggleDonaturJenisFields()">
        <option value="uang" ${!isBarang?'selected':''}>💵 Uang</option>
        <option value="barang" ${isBarang?'selected':''}>📦 Barang</option>
      </select></div>
      <div class="field"><label>Tanggal</label><input id="f-tanggal" type="date" value="${editing?editing.tanggal:todayISO()}"></div>
    </div>
    <div class="field" id="f-uang-wrap" style="display:${isBarang?'none':''};"><label>Jumlah (Rp)</label><input id="f-jumlah" class="currency-input" type="text" value="${editing&&!isBarang?formatCurrency(editing.jumlah):''}"></div>
    <div id="f-barang-wrap" style="display:${isBarang?'':'none'};">
      <div class="field"><label>Nama Barang</label><input id="f-nama-barang" placeholder="mis. Air Mineral, Kipas Angin" value="${isBarang?esc(editing.nama_barang||''):''}"></div>
      <div class="field-row">
        <div class="field"><label>Qty</label><input id="f-qty-barang" type="number" min="1" value="${isBarang?(editing.qty||1):1}"></div>
        <div class="field"><label>Satuan (opsional)</label><input id="f-satuan-barang" placeholder="dus, pcs, buah" value="${isBarang?esc(editing.satuan||''):''}"></div>
      </div>
      <div class="hint">Donasi barang dicatat terpisah & TIDAK dihitung sebagai uang masuk/saldo kas — cuma muncul sebagai rincian di Daftar Donatur & LPJ.</div>
    </div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:editing?'Simpan':'Tambah', cls:'', onclick:()=>{
      const nama = document.getElementById('f-nama').value.trim();
      const jenis = document.getElementById('f-jenis').value;
      const tanggal = document.getElementById('f-tanggal').value||todayISO();
      if(!nama){ toast('Nama wajib'); return; }
      let payload, actionMsg, notifDetail;
      if(jenis==='barang'){
        const nama_barang = document.getElementById('f-nama-barang').value.trim();
        const qty = Math.max(1, Number(document.getElementById('f-qty-barang').value||1));
        const satuan = document.getElementById('f-satuan-barang').value.trim();
        if(!nama_barang){ toast('Nama barang wajib'); return; }
        payload = {jenis:'barang', nama_donatur:nama, nama_barang, qty, satuan, jumlah:0, tanggal};
        actionMsg = editing ? `✏️ Edit donasi barang: ${editing.nama_donatur} → ${nama}` : `➕ Donasi barang dari ${nama}`;
        notifDetail = `Nama: ${nama}\nBarang: ${nama_barang} (${qty}${satuan?` ${satuan}`:''})\nTanggal: ${fmtDate(tanggal)}`;
      } else {
        const jumlah = getCurrencyValue(document.getElementById('f-jumlah'));
        if(jumlah<=0){ toast('Jumlah wajib diisi'); return; }
        payload = {jenis:'uang', nama_donatur:nama, jumlah, tanggal, nama_barang:'', qty:null, satuan:''};
        actionMsg = editing ? `✏️ Edit donasi: ${editing.nama_donatur} → ${nama}` : `➕ Donasi baru dari ${nama}`;
        notifDetail = `Nama: ${nama}\nJumlah: ${fmtRp(jumlah)}\nTanggal: ${fmtDate(tanggal)}`;
      }
      if(editing){ Object.assign(editing, payload); }
      else { db.donatur.push({id:uid(), event_id:eid(), ...payload}); }
      saveDB(); closeModal(); renderContent(); renderTopbarSaldo(); toast('Disimpan');
      notifyTelegram(actionMsg, notifDetail, 'donasi');
    }}
  ]);
  setTimeout(setupAllCurrencyInputs, 50);
}
async function hapusDonatur(id){ 
  if (!canEditSection('donatur')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!(await confirmModal('Hapus?'))) return; 
  const d = db.donatur.find(x=>x.id===id);
  db.donatur=db.donatur.filter(d=>d.id!==id); 
  saveDB(); renderContent(); renderTopbarSaldo();
  if(d) notifyTelegram(`🗑️ Hapus donasi dari ${d.nama_donatur}`, d.jenis==='barang' ? `Barang: ${d.nama_barang||'-'} (${d.qty||1}${d.satuan?` ${d.satuan}`:''})` : `Jumlah: ${fmtRp(d.jumlah)}`, 'donasi');
}

function renderTransaksi(){
  const list = gTransaksiLain().slice().sort((a,b)=>(b.tanggal||'').localeCompare(a.tanggal||''));
  const total = list.reduce((s,t)=>s+Number(t.jumlah||0),0);
  const isLoggedIn = !!getCurrentUser();
  const rows = list.map((t,idx)=>`<tr${isLoggedIn ? ` class="row-clickable" ${da('openTransaksiModal', t.id)}` : ''}><td>${idx+1}</td><td>${dateResponsive(t.tanggal)}</td><td>${esc(t.keterangan||'-')}</td><td class="num">${fmtRp(t.jumlah)}</td>${isLoggedIn ? `<td style="text-align:right;">
    <button class="icon-btn" ${da('hapusTransaksi', t.id)}>🗑</button>
  </td>` : ''}</tr>`).join('');
  return `<div class="stat-grid"><div class="stat-card pemasukan"><div class="lbl">Total Pemasukan Lain</div><div class="val">${fmtRp(total)}</div></div></div>
  <div class="panel"><div class="panel-head"><h3>Pemasukan Lain</h3>${isLoggedIn ? `<div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn secondary" ${da('openKuponJalanModal')}>Penjualan Kupon Harian</button><button class="btn" ${da('openTransaksiModal')}>+ Tambah</button></div>` : ''}</div>
  <div class="panel-body flush"><table class="general-table tanggal-nominal-table transaksi-lain-table"><thead><tr><th>No</th><th>${thResponsive('Tanggal','Tgl')}</th><th>Keterangan</th><th class="num">Jumlah</th>${isLoggedIn ? '<th></th>' : ''}</tr></thead>
  <tbody>${rows||`<tr class="empty-row"><td colspan="${isLoggedIn?5:4}">Belum ada transaksi.</td></tr>`}</tbody></table></div></div>`;
}
function openTransaksiModal(id){
  if (!canEditSection('transaksi')) { toast('⛔ Login untuk mengedit data'); return; }
  const editing = id ? db.transaksiLain.find(t=>t.id===id) : null;
  setModal(editing?'Edit Transaksi':'Tambah Transaksi', `
    <div class="field-row"><div class="field"><label>Jumlah (Rp)</label><input id="f-jumlah" class="currency-input" type="text" value="${editing?formatCurrency(editing.jumlah):''}"></div>
    <div class="field"><label>Tanggal</label><input id="f-tanggal" type="date" value="${editing?editing.tanggal:todayISO()}"></div></div>
    <div class="field"><label>Keterangan</label><input id="f-ket" value="${editing?esc(editing.keterangan||''):''}"></div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:editing?'Simpan':'Tambah', cls:'', onclick:()=>{
      const jumlah = getCurrencyValue(document.getElementById('f-jumlah'));
      const tanggal = document.getElementById('f-tanggal').value||todayISO();
      const ket = document.getElementById('f-ket').value.trim();
      if(!ket||jumlah<=0){ toast('Keterangan & jumlah wajib'); return; }
      let actionMsg = '';
      if(editing){ actionMsg = `✏️ Edit transaksi: ${ket}`; Object.assign(editing,{jumlah,tanggal,keterangan:ket}); }
      else{ actionMsg = `➕ Transaksi baru: ${ket}`; db.transaksiLain.push({id:uid(),event_id:eid(),jumlah,tanggal,keterangan:ket}); }
      saveDB(); closeModal(); renderContent(); renderTopbarSaldo(); toast('Disimpan');
      notifyTelegram(actionMsg, `Jumlah: ${fmtRp(jumlah)}\nTanggal: ${fmtDate(tanggal)}\nKeterangan: ${ket || '-'}`, 'transaksi');
    }}
  ]);
  setTimeout(setupAllCurrencyInputs, 50);
}
// Jual Kupon Jalan Santai — shortcut di atas menu Pemasukan Lain: user cuma
// input jumlah kupon terjual, nominal dihitung otomatis dari harga per kupon
// yang diatur admin di Pengaturan (lihat getSettings().kuponJalanSantai &
// simpanHargaKupon() di js/15-pengaturan-event.js). Hasilnya tetap disimpan
// sebagai baris biasa di db.transaksiLain (tidak ada tabel/kolom baru),
// rincian jumlah kupon & harga per lembar ditulis di kolom keterangan.
// Total lembar kupon yang sudah terjual untuk event aktif — dihitung on-the-fly
// dari kolom kuponqty di baris-baris db.transaksiLain (diisi oleh
// simpanKuponJalan). Dipakai untuk menghitung sisa stok, baik di modal
// penjualan maupun di panel Pengaturan (lihat js/15-pengaturan-event.js).
function totalKuponTerjual(){
  return gTransaksiLain().reduce((sum,t)=>sum + Number(t.kuponqty||0), 0);
}
function openKuponJalanModal(){
  if (!canEditSection('transaksi')) { toast('⛔ Login untuk mengedit data'); return; }
  const s = getSettings();
  const harga = Number((s.kuponJalanSantai && s.kuponJalanSantai.harga) || 0);
  if(harga<=0){
    setModal('Penjualan Kupon Harian', `
      <div class="hint">Harga per kupon belum diatur. Atur dulu di <b>Pengaturan → Kupon Jalan Santai</b>, baru penjualan bisa dicatat di sini.</div>
    `, [
      {label:'Tutup', cls:'secondary', onclick:closeModal},
      {label:'Ke Pengaturan', cls:'', onclick:()=>{ closeModal(); goSection('pengaturan'); }}
    ]);
    return;
  }
  const stok = Number((s.kuponJalanSantai && s.kuponJalanSantai.stok) || 0);
  const terjual = totalKuponTerjual();
  const sisa = Math.max(0, stok - terjual);
  if(stok>0 && sisa<=0){
    setModal('Penjualan Kupon Harian', `
      <div class="hint">⚠️ Stok kupon sudah habis (${stok} lembar sudah terjual semua). Tambah stok dulu di <b>Pengaturan → Kupon Jalan Santai</b>.</div>
    `, [
      {label:'Tutup', cls:'secondary', onclick:closeModal},
      {label:'Ke Pengaturan', cls:'', onclick:()=>{ closeModal(); goSection('pengaturan'); }}
    ]);
    return;
  }
  setModal('Penjualan Kupon Harian', `
    <div class="stat-grid" style="margin-bottom:14px;">
      <div class="stat-card"><div class="lbl">Harga/Kupon</div><div class="val">${fmtRp(harga)}</div></div>
      ${stok>0 ? `<div class="stat-card${sisa<=Math.ceil(stok*0.1) ? ' stok-lebih' : ''}"><div class="lbl">Sisa Stok</div><div id="f-kupon-sisa-val" class="val">${sisa}</div></div>
      <div class="stat-card"><div class="lbl">Terjual</div><div class="val">${terjual}</div></div>` : `<div class="stat-card"><div class="lbl">Stok</div><div class="val">Tak terbatas</div></div>`}
    </div>
    <div class="field-row">
      <div class="field"><label>Jumlah Kupon Terjual</label><input id="f-kupon-qty" type="number" min="1" ${stok>0 ? `max="${sisa}"` : ''} step="1" value="1" oninput="updateKuponJalanTotal(${harga}${stok>0 ? `,${sisa}` : ''})"></div>
      <div class="field"><label>Tanggal</label><input id="f-kupon-tanggal" type="date" value="${todayISO()}"></div>
    </div>
    <div class="field"><label>Total Nominal</label><div id="f-kupon-total" class="stat-card pemasukan" style="padding:10px 12px;font-size:18px;font-weight:700;">${fmtRp(harga)}</div></div>
    <div class="field"><label>Keterangan Tambahan (opsional)</label><input id="f-kupon-ket" value="" placeholder="mis. dijual di RT 03"></div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:'Simpan', cls:'', onclick:()=>simpanKuponJalan(harga, stok>0?sisa:Infinity)}
  ]);
}
function updateKuponJalanTotal(harga, sisaStok){
  const qtyEl = document.getElementById('f-kupon-qty');
  const totalEl = document.getElementById('f-kupon-total');
  if(!qtyEl || !totalEl) return;
  const qty = Math.max(0, Math.floor(Number(qtyEl.value||0)));
  totalEl.textContent = fmtRp(qty*harga);
  const sisaEl = document.getElementById('f-kupon-sisa-val');
  if(sisaEl && Number.isFinite(sisaStok)){
    sisaEl.textContent = Math.max(0, sisaStok - qty);
  }
}
function simpanKuponJalan(harga, sisaStok){
  const qty = Math.max(0, Math.floor(Number(document.getElementById('f-kupon-qty').value||0)));
  const tanggal = document.getElementById('f-kupon-tanggal').value||todayISO();
  const tambahanKet = document.getElementById('f-kupon-ket').value.trim();
  if(qty<=0){ toast('Jumlah kupon wajib diisi'); return; }
  if(Number.isFinite(sisaStok) && qty>sisaStok){ toast(`⚠️ Stok tidak cukup, sisa hanya ${sisaStok} lembar`); return; }
  const jumlah = qty*harga;
  const keterangan = `Penjualan Kupon Jalan Santai (${qty} lembar × ${fmtRp(harga)})${tambahanKet ? ` — ${tambahanKet}` : ''}`;
  db.transaksiLain.push({id:uid(), event_id:eid(), jumlah, tanggal, keterangan, kuponqty:qty});
  saveDB(); closeModal(); renderContent(); renderTopbarSaldo(); toast('Disimpan');
  notifyTelegram('🎟️ Penjualan kupon jalan santai', `Jumlah kupon: ${qty} lembar\nHarga per kupon: ${fmtRp(harga)}\nTotal: ${fmtRp(jumlah)}\nTanggal: ${fmtDate(tanggal)}${tambahanKet ? `\nKeterangan: ${tambahanKet}` : ''}`, 'transaksi');
}
async function hapusTransaksi(id){ 
  if (!canEditSection('transaksi')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!(await confirmModal('Hapus?'))) return; 
  const t = db.transaksiLain.find(x=>x.id===id);
  db.transaksiLain=db.transaksiLain.filter(t=>t.id!==id); 
  saveDB(); renderContent(); renderTopbarSaldo();
  if(t) notifyTelegram(`🗑️ Hapus transaksi: ${t.keterangan||'-'}`, `Jumlah: ${fmtRp(t.jumlah)}`, 'transaksi');
}

function renderOperasional(){
  // Transaksi paling baru di atas: urutkan berdasarkan `created_at` (waktu baris
  // benar-benar dibuat), bukan `tanggal` (tanggal pilihan user yang bisa sama
  // atau diisi mundur untuk banyak baris sekaligus).
  const list = gOperasional().slice().sort((a,b)=>(b.created_at||b.tanggal||'').localeCompare(a.created_at||a.tanggal||''));
  const total = list.reduce((s,o)=>s+Number(o.jumlah||0),0);
  const isLoggedIn = !!getCurrentUser();
  const rows = list.map((o,idx)=>`<tr${isLoggedIn ? ` class="row-clickable" ${da('openOperasionalModal', o.id)}` : ''}><td data-label="No">${idx+1}</td><td data-label="Tgl">${dateResponsive(o.tanggal)}</td><td data-label="Keterangan">${esc(o.keterangan)}</td><td data-label="Harga" class="num">${fmtRp(o.satuan||0)}</td><td data-label="QTY" class="num">${o.qty||1}</td><td data-label="Jumlah" class="num">${fmtRp(o.jumlah)}</td>${isLoggedIn ? `<td class="operasional-actions" data-label="" style="text-align:right;">
    <button class="icon-btn" ${da('hapusOperasional', o.id)}>🗑</button>
  </td>` : ''}</tr>`).join('');
  return `<div class="stat-grid"><div class="stat-card pengeluaran"><div class="lbl">Total Operasional</div><div class="val">${fmtRp(total)}</div></div></div>
  <div class="panel"><div class="panel-head"><h3>Biaya Operasional</h3>${isLoggedIn ? `<button class="btn" ${da('openOperasionalModal')}>+ Tambah</button>` : ''}</div>
  <div class="panel-body flush"><table class="general-table operasional-table"><thead><tr><th>No</th><th>${thResponsive('Tanggal','Tgl')}</th><th>Keterangan</th><th class="num">Harga</th><th class="num">QTY</th><th class="num">Jumlah</th>${isLoggedIn ? '<th></th>' : ''}</tr></thead>
  <tbody>${rows||`<tr class="empty-row"><td colspan="${isLoggedIn?7:6}">Belum ada biaya.</td></tr>`}</tbody></table></div></div>`;
}
function hitungJumlahOperasionalModal(){
  const satuanInput = document.getElementById('f-satuan');
  const qtyInput = document.getElementById('f-qty');
  const preview = document.getElementById('f-jumlah-preview');
  if(!satuanInput || !qtyInput || !preview) return;
  const satuan = getCurrencyValue(satuanInput);
  const qty = Number(qtyInput.value) || 1;
  preview.textContent = fmtRp(satuan * qty);
}
function openOperasionalModal(id){
  if (!canEditSection('operasional')) { toast('⛔ Login untuk mengedit data'); return; }
  const editing = id ? db.operasional.find(o=>o.id===id) : null;
  setModal(editing?'Edit Biaya':'Tambah Biaya', `
    <div class="field"><label>Tanggal</label><input id="f-tanggal" type="date" value="${editing?editing.tanggal:todayISO()}"></div>
    <div class="field"><label>Keterangan</label><input id="f-ket" value="${editing?esc(editing.keterangan):''}"></div>
    <div class="field-row"><div class="field"><label>Harga Satuan (Rp)</label><input id="f-satuan" class="currency-input" type="text" oninput="hitungJumlahOperasionalModal()" value="${editing?formatCurrency(editing.satuan||0):''}"></div>
    <div class="field"><label>QTY</label><input id="f-qty" type="number" min="1" step="1" oninput="hitungJumlahOperasionalModal()" value="${editing?(editing.qty||1):1}"></div></div>
    <div class="field"><label>Jumlah</label><div id="f-jumlah-preview" style="font-weight:700; font-size:16px; padding:6px 0;">${fmtRp((editing?Number(editing.satuan||0):0)*(editing?(editing.qty||1):1))}</div><div class="hint">Otomatis: Harga Satuan × QTY</div></div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:editing?'Simpan':'Tambah', cls:'', onclick:()=>{
      const ket = document.getElementById('f-ket').value.trim();
      const satuan = getCurrencyValue(document.getElementById('f-satuan'));
      const qty = Number(document.getElementById('f-qty').value) || 1;
      const jumlah = satuan * qty;
      const tanggal = document.getElementById('f-tanggal').value||todayISO();
      if(!ket||jumlah<=0){ toast('Keterangan & harga satuan wajib'); return; }
      let actionMsg = '';
      if(editing){ actionMsg = `✏️ Edit biaya operasional: ${editing.keterangan} → ${ket}`; Object.assign(editing,{keterangan:ket,satuan,qty,jumlah,tanggal}); }
      else{ actionMsg = `➕ Biaya operasional baru: ${ket}`; db.operasional.push({id:uid(),event_id:eid(),keterangan:ket,satuan,qty,jumlah,tanggal,created_at:new Date().toISOString()}); }
      saveDB(); closeModal(); renderContent(); renderTopbarSaldo(); toast('Disimpan');
      notifyTelegram(actionMsg, `Keterangan: ${ket}\nHarga Satuan: ${fmtRp(satuan)}\nQTY: ${qty}\nJumlah: ${fmtRp(jumlah)}\nTanggal: ${fmtDate(tanggal)}`, 'operasional');
    }}
  ]);
  setTimeout(setupAllCurrencyInputs, 50);
}
async function hapusOperasional(id){ 
  if (!canEditSection('operasional')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!(await confirmModal('Hapus?'))) return; 
  const o = db.operasional.find(x=>x.id===id);
  db.operasional=db.operasional.filter(o=>o.id!==id); 
  saveDB(); renderContent(); renderTopbarSaldo();
  if(o) notifyTelegram(`🗑️ Hapus biaya operasional: ${o.keterangan}`, `Jumlah: ${fmtRp(o.jumlah)}`, 'operasional');
}

