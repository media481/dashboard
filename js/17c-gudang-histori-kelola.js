/* ============================================================
   TAB: RIWAYAT PEMINJAMAN
   ============================================================ */
function renderGudangHistori(){
  const canKelola = gudangCanKelola();
  const q = gudangSearchHistori.toLowerCase();
  const filtered = gudangTransactions.filter(t=>{
    const matchQ = t.resi.toLowerCase().includes(q) || t.nama.toLowerCase().includes(q);
    const matchS = !gudangFilterHistori || t.status===gudangFilterHistori;
    return matchQ && matchS;
  });
  const totalFiltered = filtered.length;
  const visible = filtered.slice(0, GUDANG_HIST_KEEP);
  const statusLabel = {aktif:'⏳ Aktif', selesai:'✅ Selesai', bermasalah:'⚠️ Bermasalah'};
  const statusBadgeCls = {aktif:'', selesai:'lunas', bermasalah:'belum'};

  const rows = visible.map(t=>{
    const itemsText = t.items.map(it=>`${it.qty}× ${esc(it.nama)} <span style="color:var(--ink-soft);">[${esc(it.gudang)}]</span>`).join('<br>');
    const statusCell = canKelola
      ? `<select onchange="gudangChangeStatus('${t.id}', this.value)">
          <option value="aktif" ${t.status==='aktif'?'selected':''}>⏳ Aktif</option>
          <option value="selesai" ${t.status==='selesai'?'selected':''}>✅ Selesai</option>
          <option value="bermasalah" ${t.status==='bermasalah'?'selected':''}>⚠️ Bermasalah</option>
        </select>`
      : `<span class="badge ${statusBadgeCls[t.status]||''}">${statusLabel[t.status]||t.status}</span>`;
    return `<tr>
      <td><b>#${esc(t.resi)}</b><div style="font-size:12px; color:var(--ink-soft);">${esc(t.nama)}</div></td>
      <td>${itemsText}</td>
      <td>${fmtGudangTanggal(t.tglPinjam)} → ${fmtGudangTanggal(t.tglKembali)}</td>
      <td>${statusCell}</td>
      <td><button type="button" class="btn secondary small" ${da('gudangShowNota', t.id)}>🧾 Lihat Nota</button></td>
    </tr>`;
  }).join('');

  const limitNote = totalFiltered > GUDANG_HIST_KEEP
    ? `<p style="font-size:11.5px; color:var(--ink-soft); margin-top:10px;">Menampilkan ${GUDANG_HIST_KEEP} riwayat terbaru dari ${totalFiltered} yang cocok. Riwayat "Selesai" yang sudah lama otomatis dihapus (maks. ${GUDANG_HIST_KEEP} disimpan); Aktif/Bermasalah tidak ikut terhapus.</p>` : '';

  return `
  <div class="panel">
    <div class="panel-head">
      <div><h3>Log Peminjaman</h3><div class="desc">${canKelola?'Ubah status transaksi lewat dropdown.':'Hanya admin yang dapat mengubah status transaksi.'}</div></div>
      ${canKelola?`<button class="btn secondary small" style="border-color:var(--merah); color:var(--merah);" ${da('gudangDeleteAllHistory')}>🗑️ Hapus Riwayat Selesai</button>`:''}
    </div>
    <div class="panel-body">
      <div class="filter-row">
        <div class="search-box" style="flex:1;min-width:180px;"><div class="search-input-wrap"><i data-lucide="search" class="inline-icon search-input-icon"></i><input type="text" id="gudang-search-histori" placeholder="Cari resi / nama..." value="${esc(gudangSearchHistori)}" oninput="gudangSearchHistori=this.value; renderContent();"></div></div>
        <div class="field" style="margin-bottom:0;">
          <select onchange="gudangFilterHistori=this.value; renderContent();">
            <option value="">Semua Status</option>
            <option value="aktif" ${gudangFilterHistori==='aktif'?'selected':''}>⏳ Aktif</option>
            <option value="selesai" ${gudangFilterHistori==='selesai'?'selected':''}>✅ Selesai</option>
            <option value="bermasalah" ${gudangFilterHistori==='bermasalah'?'selected':''}>⚠️ Bermasalah</option>
          </select>
        </div>
      </div>
      <div style="overflow-x:auto;">
      <table class="anggota-table">
        <thead><tr><th>Resi / Peminjam</th><th>Barang &amp; Gudang</th><th>Tanggal</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows || `<tr class="empty-row"><td colspan="5">Belum ada transaksi peminjaman tercatat.</td></tr>`}</tbody>
      </table>
      </div>
      ${limitNote}
    </div>
  </div>`;
}

function gudangShowNota(id){
  const t = gudangTransactions.find(x=>x.id===id);
  if(!t) return;
  const statusLabel = {aktif:'⏳ Aktif — masih di luar gudang', selesai:'✅ Selesai — barang sudah dikembalikan', bermasalah:'⚠️ Bermasalah'};
  const statusHtml = `<div class="nota-footer"><span>Status saat ini: <b>${statusLabel[t.status]||t.status}</b> · Nota ini sesuai dengan pengajuan yang sudah disetujui &amp; dikirim peminjam.</span></div>`;
  const notaHtml = buildGudangNotaHtml({
    resi: t.resi, nama: t.nama, alamat: t.alamat, pencatat: t.wa,
    tglPinjam: t.tglPinjam, tglKembali: t.tglKembali, items: t.items,
    tanggalCetak: (t.createdAt||'').slice(0,10) || t.tglPinjam,
    statusHtml,
  });
  setModal('Nota Peminjaman', notaHtml, [
    {label:'Tutup', cls:'secondary', onclick: closeModal},
    {label:'⬇ Unduh JPEG', cls:'', onclick: ()=>gudangExportNotaJPEG(t.resi)},
  ]);
}

// Export tampilan nota (di modal Riwayat Peminjaman) jadi file JPEG —
// pakai html2canvas karena nota-nya murni HTML/CSS (bukan gambar), belum
// ada elemen input yang perlu disamarkan, jadi tidak perlu toggle class 'exporting'.
async function gudangExportNotaJPEG(resi){
  const el = document.getElementById('gudang-nota-sheet');
  if(!el){ toast('⛔ Gagal menemukan nota'); return; }
  try {
    await ensureHtml2Canvas();
  } catch (e) {
    toast('⛔ Gagal memuat modul export gambar. Cek koneksi internet lalu muat ulang.');
    return;
  }
  html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true }).then(canvas => {
    const link = document.createElement('a');
    const namaFile = (resi || 'nota-peminjaman').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
    link.download = `${namaFile || 'nota-peminjaman'}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
    toast('⬇ JPEG berhasil diunduh');
  }).catch(err => {
    console.error('Gagal export JPEG nota:', err);
    toast('⛔ Gagal membuat JPEG: ' + (err.message||'error tak dikenal'));
  });
}

async function gudangPruneOldHistory(){
  const selesai = gudangTransactions.filter(t=>t.status==='selesai');
  if(selesai.length <= GUDANG_HIST_KEEP) return;
  const toDelete = selesai.slice(GUDANG_HIST_KEEP);
  const idList = toDelete.map(t=>t.id);
  // Best-effort: kalau baris item-nya gagal terhapus di sini, baris transaksi
  // induk di bawah tetap dicoba dihapus — kalau itu juga gagal (mis. karena FK
  // masih nunjuk ke item yang belum kehapus), akan ketangkep & dilog di catch
  // blok kedua. Tidak di-toast ke user karena ini cuma pruning riwayat lama di
  // background, bukan aksi yang baru saja diminta user.
  try{ await sb.from('kt_gudang_transaction_items').delete().in('transaction_id', idList); }catch(e){ console.warn('Gagal prune item riwayat gudang:', e); }
  try{
    await sb.from('kt_gudang_transactions').delete().in('id', idList);
    const delIds = new Set(idList);
    gudangTransactions = gudangTransactions.filter(t=>!delIds.has(t.id));
  }catch(e){ console.warn('Gagal prune riwayat gudang:', e); }
}

async function gudangChangeStatus(id, newStatus){
  if(!gudangCanKelola()){ toast('🔒 Hanya admin yang dapat mengubah status peminjaman.'); renderContent(); return; }
  const t = gudangTransactions.find(x=>x.id===id);
  if(!t) return;
  try{
    // Kunci baris transaksi + hitung ulang & ubah stok + update status,
    // semuanya ATOMIK di satu RPC — kalau ada langkah yang gagal di tengah,
    // server otomatis rollback semuanya (stok tidak akan "kepotong sepihak"
    // sementara status transaksinya sendiri gagal tersimpan).
    const r = await sb.rpc('kt_gudang_change_status', {p_trx_id: id, p_new_status: newStatus});
    if(r.error) throw new Error(r.error.message);
    (r.data||[]).forEach(row => {
      const inv = gudangInventory.find(i=>i.id===row.item_id);
      if(inv) inv.tersedia = row.tersedia;
    });
    t.status = newStatus;
    if(newStatus==='selesai') await gudangPruneOldHistory();
    toast('✅ Status transaksi diperbarui.');
    renderContent();
  }catch(err){
    console.error(err);
    toast('⛔ Gagal update status: ' + err.message);
    renderContent(); // pastikan dropdown balik ke status lama (t.status tidak diubah kalau gagal)
  }
}

async function gudangDeleteAllHistory(){
  if(!gudangCanKelola()){ toast('🔒 Hanya admin yang dapat menghapus riwayat.'); return; }
  const selesai = gudangTransactions.filter(t=>t.status==='selesai');
  const belumSelesai = gudangTransactions.length - selesai.length;
  if(selesai.length===0){ toast('Tidak ada riwayat berstatus "Selesai" yang bisa dihapus.'); return; }
  const ket = belumSelesai>0 ? `\n\n(${belumSelesai} transaksi Aktif/Bermasalah akan tetap disimpan.)` : '';
  if(!(await confirmModal(`Hapus ${selesai.length} riwayat peminjaman berstatus "Selesai"? Tindakan ini tidak dapat dibatalkan.${ket}`))) return;
  if(!(await confirmModal('Konfirmasi sekali lagi: riwayat akan dihapus permanen dari server. Lanjutkan?'))) return;
  const idList = selesai.map(t=>t.id);
  try{
    await sb.from('kt_gudang_transaction_items').delete().in('transaction_id', idList);
    const del = await sb.from('kt_gudang_transactions').delete().in('id', idList);
    if(del.error) throw new Error(del.error.message);
    const delIds = new Set(idList);
    gudangTransactions = gudangTransactions.filter(t=>!delIds.has(t.id));
    toast(`✅ ${selesai.length} riwayat selesai berhasil dihapus.`);
    renderContent();
  }catch(err){
    console.error(err);
    toast('⛔ Gagal menghapus riwayat: ' + err.message);
  }
}

/* ============================================================
   TAB: KELOLA INVENTARIS (admin only)
   ============================================================ */
function renderGudangKelola(){
  const totalJenis = gudangInventory.length;
  const totalTersedia = gudangInventory.reduce((s,i)=>s+i.tersedia,0);
  const totalDipinjam = gudangInventory.reduce((s,i)=>s+(i.total-i.tersedia),0);
  const q = (gudangSearchKelola||'').toLowerCase();
  const filtered = gudangInventory.filter(i=>i.nama.toLowerCase().includes(q)||i.gudang.toLowerCase().includes(q));

  const rows = filtered.map(i=>{
    const namaLabel = i.isActive ? esc(i.nama) : `${esc(i.nama)} <span class="badge readonly">Nonaktif</span>`;
    const actionBtn = i.isActive
      ? `<button class="icon-btn" title="Nonaktifkan" ${da('gudangDeleteStok', i.id)}>🗑</button>`
      : `<button class="icon-btn" title="Aktifkan kembali" ${da('gudangAktifkanStok', i.id)}>↺</button>`;
    return `<tr>
      <td>${namaLabel}</td>
      <td><span class="badge">${esc(i.gudang)}</span></td>
      <td class="num ${gudangStokBadgeClass(i.tersedia,i.total)}">${i.tersedia}</td>
      <td class="num">${i.total}</td>
      <td style="white-space:nowrap;"><button class="icon-btn" title="Edit" ${da('openGudangStokModal', i.id)}>✎</button>${actionBtn}</td>
    </tr>`;
  }).join('');

  return `
  <div class="stat-grid-ringkasan" style="margin-bottom:20px;">
    <div class="stat-card"><div class="lbl">Jenis Aset</div><div class="val">${totalJenis}</div></div>
    <div class="stat-card pemasukan"><div class="lbl">Unit Tersedia</div><div class="val">${totalTersedia}</div></div>
    <div class="stat-card"><div class="lbl">Unit Dipinjam</div><div class="val">${totalDipinjam}</div></div>
  </div>
  <div class="panel">
    <div class="panel-head">
      <div><h3>Inventory Terkini</h3><div class="desc">Export/import cadangan data Gudang kini terpusat di menu Pengaturan &gt; Cadangan Data.</div></div>
      <button class="btn" ${da('openGudangStokModal')}>+ Tambah Aset</button>
    </div>
    <div class="panel-body">
      <div class="filter-row">
        <div class="search-box" style="flex:1;"><div class="search-input-wrap"><i data-lucide="search" class="inline-icon search-input-icon"></i><input type="text" id="gudang-search-kelola" placeholder="Cari nama barang atau gudang..." value="${esc(gudangSearchKelola||'')}" oninput="gudangSearchKelola=this.value; renderContent();"></div></div>
      </div>
      <div style="overflow-x:auto;">
      <table class="anggota-table">
        <thead><tr><th>Barang</th><th>Lokasi</th><th class="num">Tersedia</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>${rows || `<tr class="empty-row"><td colspan="5">Belum ada aset tercatat. Tambahkan lewat tombol di atas.</td></tr>`}</tbody>
      </table>
      </div>
    </div>
  </div>`;
}
let gudangSearchKelola = '';

// Lokasi gudang DINAMIS — diambil dari lokasi yang sudah pernah dipakai di
// data inventaris (aktif maupun nonaktif), bukan daftar statis lagi. Ini
// dipertahankan hanya sebagai seed default ("Gudang RT 1" dst.) supaya
// pengalaman pertama kali (inventaris masih kosong) tetap punya pilihan
// yang masuk akal, sebelum admin mulai menambah aset sendiri.
const GUDANG_LOKASI_SEED_DEFAULT = ['Gudang RT 1', 'Gudang RT 2', 'Gudang RT 3', 'Gudang Karang Taruna'];
function gudangKnownLokasiList(){
  const set = new Set();
  gudangInventory.forEach(i=>{ if(i.gudang) set.add(i.gudang); });
  if(set.size===0){ GUDANG_LOKASI_SEED_DEFAULT.forEach(l=>set.add(l)); }
  return Array.from(set).sort((a,b)=>a.localeCompare(b,'id'));
}
function gudangLokasiOptions(selectedGudang){
  const known = gudangKnownLokasiList().map(l=>`<option value="${esc(l)}" ${selectedGudang===l?'selected':''}>${esc(l)}</option>`).join('');
  return `<option value="">-- Pilih Lokasi --</option>${known}<option value="__baru__">+ Lokasi Baru...</option>`;
}
// Toggle input teks "Lokasi Baru" saat opsi __baru__ dipilih di dropdown —
// dipanggil langsung dari onchange select, tidak perlu render ulang modal.
function gudangToggleLokasiBaru(val){
  const wrap = document.getElementById('gs-gudang-baru-wrap');
  if(!wrap) return;
  wrap.style.display = (val==='__baru__') ? 'block' : 'none';
  if(val==='__baru__'){ const inp=document.getElementById('gs-gudang-baru'); if(inp) setTimeout(()=>inp.focus(), 30); }
}
function openGudangStokModal(id){
  const item = id ? gudangInventory.find(i=>i.id===id) : null;
  const dipinjam = item ? (item.total - item.tersedia) : 0;
  const body = `
    <div class="field"><label>Nama Barang</label><input type="text" id="gs-nama" placeholder="Kursi Plastik Hijau" value="${item?esc(item.nama):''}"></div>
    <div class="field"><label>Lokasi / Gudang</label>
      <select id="gs-gudang" onchange="gudangToggleLokasiBaru(this.value)">${gudangLokasiOptions(item?item.gudang:'')}</select>
    </div>
    <div class="field" id="gs-gudang-baru-wrap" style="display:none;">
      <label>Nama Lokasi Baru</label>
      <input type="text" id="gs-gudang-baru" placeholder="Contoh: Gudang Balai Desa">
    </div>
    <div class="field"><label>Total Unit</label><input type="number" min="0" id="gs-total" value="${item?item.total:''}"></div>
    ${item ? `<div class="hint" style="margin:-6px 0 14px;">Sedang dipinjam: <b>${dipinjam}</b> unit. Stok tersedia otomatis dihitung dari Total Unit dikurangi yang sedang dipinjam.</div>` : ''}`;
  setModal(item?'Ubah Aset':'Tambah Aset', body, [
    {label:'Batal', cls:'secondary', onclick: closeModal},
    {label:'Simpan', onclick: ()=>gudangSaveStok(id)},
  ]);
}
async function gudangSaveStok(id){
  if(!gudangCanKelola()){ toast('🔒 Hanya admin yang dapat mengelola aset.'); closeModal(); return; }
  const nama = document.getElementById('gs-nama').value.trim();
  const gudangSel = document.getElementById('gs-gudang').value;
  const gudang = gudangSel==='__baru__'
    ? (document.getElementById('gs-gudang-baru')?.value || '').trim()
    : gudangSel.trim();
  const total = parseInt(document.getElementById('gs-total').value, 10);
  if(gudangSel==='__baru__' && !gudang){ toast('⛔ Isi nama lokasi baru.'); return; }
  if(!nama || !gudang){ toast('⛔ Nama & lokasi wajib diisi.'); return; }
  if(isNaN(total) || total<0){ toast('⛔ Total unit harus angka valid.'); return; }
  const now = todayISO();
  try{
    if(id){
      // PENTING (race condition): perhitungan `tersedia` TIDAK dilakukan di sini
      // lagi. Kalau dihitung di JS pakai data gudangInventory yang mungkin sudah
      // basi (device ini belum tentu baru saja refresh), lalu ditimpakan mentah-
      // mentah ke server, perubahan stok dari device lain (mis. ada yang baru
      // saja pinjam/kembalikan barang ini) bisa hilang tertimpa tanpa peringatan.
      // Sebagai gantinya, seluruh baca-hitung-tulis dilakukan ATOMIK di server
      // lewat RPC kt_gudang_update_asset (lock baris + hitung ulang "dipinjam"
      // dari data TERKINI di server, bukan dari data di layar kita).
      const r = await sb.rpc('kt_gudang_update_asset', {p_item_id: id, p_nama: nama, p_gudang: gudang, p_new_total: total});
      if(r.error) throw new Error(r.error.message);
      if(!r.data || !r.data.length){
        toast('⛔ Gagal menyimpan: Total Unit lebih kecil dari jumlah yang SAAT INI sedang dipinjam (mungkin baru saja ada peminjaman lain), atau aset sudah dihapus. Data disegarkan, silakan cek ulang.');
        await loadGudangData();
        renderContent();
        return;
      }
      const row = r.data[0];
      const existing = gudangInventory.find(i=>i.id===id);
      if(existing) Object.assign(existing, {nama: row.nama, gudang: row.gudang, total: row.total, tersedia: row.tersedia, lastUpdated: row.last_updated});
      toast('✅ Data aset tersimpan.');
    } else {
      const newId = uid();
      const tersedia = total;
      const ins = await sb.from('kt_gudang_inventory').insert({id:newId, nama, gudang, total, tersedia, last_updated: now, is_active: true});
      if(ins.error) throw new Error(ins.error.message);
      gudangInventory.push({id:newId, nama, gudang, total, tersedia, lastUpdated: now, isActive: true});
      toast('✅ Aset baru ditambahkan.');
    }
    closeModal();
    renderContent();
  }catch(err){
    console.error(err);
    toast('⛔ Gagal menyimpan: ' + err.message);
  }
}
async function gudangDeleteStok(id){
  if(!gudangCanKelola()){ toast('🔒 Hanya admin yang dapat mengelola aset.'); return; }
  const item = gudangInventory.find(i=>i.id===id);
  if(!item) return;
  if(!(await confirmModal(`Nonaktifkan "${item.nama}" dari inventaris aktif? Riwayat peminjaman lama tetap aman.`, {danger:false}))) return;
  try{
    const upd = await sb.from('kt_gudang_inventory').update({is_active:false}).eq('id', id);
    if(upd.error) throw new Error(upd.error.message);
    item.isActive = false;
    toast('✅ Aset dinonaktifkan.');
    renderContent();
  }catch(err){
    console.error(err);
    toast('⛔ Gagal menonaktifkan: ' + err.message);
  }
}
async function gudangAktifkanStok(id){
  if(!gudangCanKelola()){ toast('🔒 Hanya admin yang dapat mengelola aset.'); return; }
  const item = gudangInventory.find(i=>i.id===id);
  if(!item) return;
  try{
    const upd = await sb.from('kt_gudang_inventory').update({is_active:true}).eq('id', id);
    if(upd.error) throw new Error(upd.error.message);
    item.isActive = true;
    toast('✅ Aset diaktifkan kembali.');
    renderContent();
  }catch(err){
    console.error(err);
    toast('⛔ Gagal mengaktifkan: ' + err.message);
  }
}

async function gudangExportJSON(){
  // Dipanggil juga dari menu Pengaturan (backup terpusat), yang bisa diakses tanpa
  // pernah membuka menu Gudang dulu -> gudangInventory/gudangTransactions bisa masih
  // kosong (belum di-load). Pastikan data terbaru ter-load dulu sebelum diekspor.
  if(!gudangLoaded){ await loadGudangData(); }
  const payload = {exportedAt: new Date().toISOString(), inventory: gudangInventory, transactions: gudangTransactions};
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gudang-backup-${todayISO()}.json`;
  a.click();
  toast('✅ Backup Gudang berhasil diekspor.');
}
function gudangImportJSON(input){
  if(!gudangCanKelola()){ toast('🔒 Hanya admin yang dapat mengimpor data.'); input.value=''; return; }
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async (e)=>{
    try{
      const parsed = JSON.parse(e.target.result);
      if(!parsed.inventory || !parsed.transactions) throw new Error('Format file backup tidak dikenali.');
      if(!(await confirmModal(`Import akan menambah/menimpa ${parsed.inventory.length} aset dan ${parsed.transactions.length} transaksi ke database. Lanjutkan?`))) return;
      toast('⏳ Mengimpor data...');

      // Seluruh proses import (semua aset + transaksi + item) dilakukan ATOMIK
      // di server lewat satu RPC — kalau ada baris mana pun yang gagal (format
      // rusak dll), PostgreSQL otomatis rollback SEMUANYA. Tidak ada lagi
      // kemungkinan "setengah ke-import" seperti kalau dikirim satu-satu dari JS.
      // Lihat supabase-gudang-import-atomic-migration.sql.
      const r = await sb.rpc('kt_gudang_import_backup', {
        p_inventory: parsed.inventory, p_transactions: parsed.transactions,
      });
      if(r.error) throw new Error(r.error.message);
      const summary = (r.data && r.data[0]) || {inventory_count:0, transaction_count:0, item_count:0};

      await loadGudangData();
      renderContent();
      toast(`✅ Import selesai: ${summary.inventory_count} aset, ${summary.transaction_count} transaksi, ${summary.item_count} item.`);
    }catch(err){
      console.error(err);
      toast('⛔ Gagal import (tidak ada data yang tersimpan): ' + err.message, 6000);
    }
    input.value = '';
  };
  reader.readAsText(file);
}

