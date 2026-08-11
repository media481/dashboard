/* ============================================================
   LPJ - scale tampilan di layar kecil (HP) supaya identik dengan
   tampilan desktop, hanya diperkecil proporsional (bukan reflow/
   ubah layout). Menggunakan CSS zoom, dihitung ulang tiap resize.
   ============================================================ */
const LPJ_DESIGN_WIDTH = 820;
function applyLpjMobileScale(){
  const wrap = document.getElementById('lpj-scale-wrap');
  const area = document.getElementById('lpj-print-area');
  if (!wrap || !area) return;
  if (window.innerWidth > LPJ_DESIGN_WIDTH){
    area.style.zoom = '';
    return;
  }
  const available = wrap.clientWidth;
  if (!available) return;
  const scale = Math.min(1, available / LPJ_DESIGN_WIDTH);
  area.style.zoom = scale;
}
window.addEventListener('resize', ()=>{
  if (currentSection === 'lpj' || currentSection === 'dokumen' || currentSection === 'daftar-anggota') applyLpjMobileScale();
  if (currentSection === 'dokumen' && typeof _dokumenTab !== 'undefined' && _dokumenTab === 'proposal' && typeof renderProposalA4Pages === 'function') renderProposalA4Pages();
});

/* ============================================================
   LAPORAN PERTANGGUNGJAWABAN (LPJ) - native, tanpa AI
   Merangkai data yang sudah ada di db jadi laporan siap cetak/PDF.
   ============================================================ */
function renderLPJ(){
  const ev = activeEvent();
  if (!ev) return `<div class="panel"><div class="panel-body" style="padding:24px;">Tidak ada event aktif.</div></div>`;

  const b = hitungBukuUtama();
  const anggotaList = gAnggota();
  const kategoriRekap = KATEGORI_ANGGOTA.map(k=>{
    const listK = anggotaList.filter(a=>a.kategori===k.v);
    const lunasK = listK.filter(a=>a.status==='lunas');
    return { label:k.l, total:listK.length, lunas:lunasK.length, nominal:lunasK.reduce((s,a)=>s+Number(a.nominal_wajib||0),0) };
  }).filter(r=>r.total>0);

  const donaturList = gDonatur().slice().sort((x,y)=>(x.tanggal||'').localeCompare(y.tanggal||''));
  const transaksiList = gTransaksiLain().slice().sort((x,y)=>(x.tanggal||'').localeCompare(y.tanggal||''));
  const operasionalList = gOperasional().slice().sort((x,y)=>(x.tanggal||'').localeCompare(y.tanggal||''));

  const kebutuhanRows = [];
  const belanjaPerlengkapan = new Map(gDaftarBelanjaPerlengkapan().filter(b=>b.status==='dibeli').map(b=>[b.kebutuhan_id,b]));
  gLomba().forEach(l=>{
    gKebutuhan(l.id).forEach(k=>{
      const belanja=belanjaPerlengkapan.get(k.id); if(!belanja) return;
      const subtotal=Number(belanja.nominal_realisasi ?? (Number(k.harga_realisasi ?? k.harga_estimasi ?? 0)*Number(k.qty||0)));
      const harga=Number(k.qty||0)>0 ? subtotal/Number(k.qty) : 0;
      kebutuhanRows.push({ lomba:l.nama, nama:k.nama_item, qty:k.qty, harga, subtotal });
    });
  });

  const hadiahRows = [];
  const urutanKategori = KATEGORI_PESERTA.map(k=>k.v);
  const urutanJuara = JUARA_LIST.map(j=>j.v);
  // Pakai hitungHargaAktualHadiahLomba() (di 11-belanja.js) supaya rincian per
  // item di LPJ konsisten dengan Belanja Hadiah & ringkasan b.hadiahLomba —
  // rumus flat harga_satuan*qty_dibeli mengabaikan harga_eceran untuk sisa pcs
  // yang dibeli satuan (lihat Bug #2). "harga" di sini jadi harga efektif per
  // pcs (hasil subtotal/qty) supaya qty × harga tetap sama dengan subtotal.
  const hadiahAktual = hitungHargaAktualHadiahLomba({onlyPurchased:true});
  gHadiahKategori().slice().sort((a,b)=>{
    const ka = urutanKategori.indexOf(a.kategori_peserta), kb = urutanKategori.indexOf(b.kategori_peserta);
    if(ka !== kb) return ka - kb;
    return urutanJuara.indexOf(a.juara_ke) - urutanJuara.indexOf(b.juara_ke);
  }).forEach(h=>{
    (h.items||[]).forEach(item=>{
      const alokasi = hadiahAktual.perItem[`${h.id}_${item.id}`];
      const subtotal = alokasi ? alokasi.subtotal : 0;
      const harga = alokasi ? alokasi.hargaEfektif : Number(item.harga_satuan||0);
      hadiahRows.push({ kategori:labelPeserta(h.kategori_peserta), juara:labelJuara(h.juara_ke), nama:item.nama, qty:item.qty_dibeli, harga, subtotal });
    });
  });

  const hadiahJalanList = gHadiahJalanSantai().filter(h=>{ const b=gDaftarBelanjaJalanSantai().find(x=>x.hadiah_jalan_id===h.id); return b?.status==='dibeli'; });
  const isLoggedIn = !!getCurrentUser();

  const emptyRow = (n,text)=>`<tr class="empty-row"><td colspan="${n}">${text}</td></tr>`;

  const showDonatur = isMenuAktif('donatur');
  const showTransaksi = isMenuAktif('transaksi');
  const showOperasional = isMenuAktif('operasional');
  const showLomba = isMenuAktif('lomba');
  const showHadiah = isMenuAktif('hadiah');
  const showJalan = isMenuAktif('jalan_santai');

  // 2. Rincian Pemasukan — Iuran Anggota selalu ada, sisanya menyesuaikan fitur event
  const pemasukanSubs = [
    { title:'Iuran Anggota', html:`
    <div class="lpj-table-scroll"><table class="lpj-table lpj-detail lpj-iuran-table">
      <thead><tr><th>Kategori</th><th>Anggota</th><th>Lunas</th><th class="num">Total Terkumpul</th></tr></thead>
      <tbody>${kategoriRekap.map(r=>`<tr><td>${esc(r.label)}</td><td>${r.total}</td><td>${r.lunas}</td><td class="num">${fmtRp(r.nominal)}</td></tr>`).join('') || emptyRow(4,'Belum ada data anggota.')}</tbody>
    </table></div>` },
  ];
  if (showDonatur) pemasukanSubs.push({ title:'Donatur', html:`
    <div class="lpj-table-scroll"><table class="lpj-table lpj-detail">
      <thead><tr><th>Tanggal</th><th>Nama</th><th class="num">Donasi</th></tr></thead>
      <tbody>${donaturList.map(d=>`<tr><td>${fmtDate(d.tanggal)}</td><td>${esc(d.nama_donatur)}</td><td class="num">${donasiValueText(d)}</td></tr>`).join('') || emptyRow(3,'Belum ada donasi.')}</tbody>
    </table></div>` });
  if (showTransaksi) pemasukanSubs.push({ title:'Pemasukan Lain', html:`
    <div class="lpj-table-scroll"><table class="lpj-table lpj-detail">
      <thead><tr><th>No</th><th>Tanggal</th><th>Keterangan</th><th class="num">Jumlah</th></tr></thead>
      <tbody>${transaksiList.map((t,idx)=>`<tr><td>${idx+1}</td><td>${fmtDate(t.tanggal)}</td><td>${esc(t.keterangan||'-')}</td><td class="num">${fmtRp(t.jumlah)}</td></tr>`).join('') || emptyRow(4,'Belum ada transaksi.')}</tbody>
    </table></div>` });

  // 3. Rincian Pengeluaran — semua sub-bagian opsional, tergantung fitur event
  const pengeluaranSubs = [];
  if (showOperasional) pengeluaranSubs.push({ title:'Operasional Kegiatan', html:`
    <div class="lpj-table-scroll"><table class="lpj-table lpj-detail">
      <thead><tr><th>Tanggal</th><th>Nama</th><th class="num">Qty</th><th class="num">Harga Satuan</th><th class="num">Jumlah</th></tr></thead>
      <tbody>${operasionalList.map(o=>`<tr><td>${fmtDate(o.tanggal)}</td><td>${esc(o.keterangan)}</td><td class="num">${o.qty||1}</td><td class="num">${fmtRp(o.satuan||0)}</td><td class="num">${fmtRp(o.jumlah)}</td></tr>`).join('') || emptyRow(5,'Belum ada biaya operasional.')}</tbody>
    </table></div>` });
  if (showLomba) pengeluaranSubs.push({ title:'Kebutuhan Lomba', html:`
    <div class="lpj-table-scroll"><table class="lpj-table lpj-detail lpj-kebutuhan-table">
      <thead><tr><th>Lomba</th><th>Nama Barang</th><th class="num">Qty</th><th class="num">Harga</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${kebutuhanRows.map(r=>`<tr><td>${esc(r.lomba)}</td><td>${esc(r.nama)}</td><td class="num">${r.qty}</td><td class="num">${fmtRp(r.harga)}</td><td class="num">${fmtRp(r.subtotal)}</td></tr>`).join('') || emptyRow(5,'Belum ada data kebutuhan lomba.')}</tbody>
    </table></div>` });
  if (showHadiah) pengeluaranSubs.push({ title:'Hadiah Lomba', html:`
    <div class="lpj-table-scroll"><table class="lpj-table lpj-detail lpj-hadiah-table">
      <thead><tr><th>Kategori</th><th>Juara</th><th>Nama Barang</th><th class="num">Qty</th><th class="num">Harga</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${hadiahRows.map(r=>`<tr><td>${esc(r.kategori)}</td><td>${esc(r.juara)}</td><td>${esc(r.nama)}</td><td class="num">${r.qty}</td><td class="num">${fmtRp(r.harga)}</td><td class="num">${fmtRp(r.subtotal)}</td></tr>`).join('') || emptyRow(6,'Belum ada data hadiah lomba.')}</tbody>
    </table></div>` });
  if (showJalan) pengeluaranSubs.push({ title:'Hadiah Jalan Santai', html:`
    <div class="lpj-table-scroll"><table class="lpj-table lpj-detail lpj-jalan-santai-table">
      <thead><tr><th>Nama Barang</th><th class="num">Qty</th><th class="num">Harga</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${hadiahJalanList.map(h=>`<tr><td>${esc(h.nama_hadiah)}</td><td class="num">${h.qty}</td><td class="num">${fmtRp(h.harga_satuan)}</td><td class="num">${fmtRp(Number(h.harga_satuan||0)*Number(h.qty||0))}</td></tr>`).join('') || emptyRow(4,'Belum ada data hadiah jalan santai.')}</tbody>
    </table></div>` });

  const pemasukanHtml = pemasukanSubs.map((s,i)=>`<h4>2.${i+1} ${esc(s.title)}</h4>${s.html}`).join('');
  const pengeluaranHtml = pengeluaranSubs.length
    ? pengeluaranSubs.map((s,i)=>`<h4>3.${i+1} ${esc(s.title)}</h4>${s.html}`).join('')
    : `<p style="font-size:13px; color:var(--ink-soft); margin:8px 0 20px;">Tidak ada modul pengeluaran yang diaktifkan untuk event ini.</p>`;

  return `
  <div class="lpj-scale-wrap" id="lpj-scale-wrap">
  <div class="lpj-print-area" id="lpj-print-area">
    <div class="lpj-header">
      <div class="lpj-header-inner">
        <img src="${esc(getOrgLogo())}" alt="Logo ${esc(getOrgNama())}" class="lpj-logo">
        <div class="lpj-header-text">
          <div class="lpj-eyebrow">${esc(getOrgNama())}</div>
          <h2>LAPORAN PERTANGGUNGJAWABAN (LPJ)</h2>
          <div class="lpj-sub">Kegiatan: ${esc(ev.nama)} — Tahun ${esc(String(ev.tahun))}</div>
          <div class="lpj-meta">Dicetak: ${fmtDate(todayISO())}</div>
        </div>
        <div class="lpj-header-spacer" aria-hidden="true"></div>
      </div>
    </div>

    <h3>1. Ringkasan Keuangan</h3>
    <table class="lpj-table">
      <tbody>
        <tr class="lpj-subtotal"><td>Total Pemasukan</td><td class="num">${fmtRp(b.pemasukan)}</td></tr>
        <tr><td class="indent">Iuran Anggota (${b.jumlahIuranLunas} lunas)</td><td class="num">${fmtRp(b.iuran)}</td></tr>
        ${showDonatur ? `<tr><td class="indent">Donatur (${b.jumlahDonatur} donasi)</td><td class="num">${fmtRp(b.donasi)}</td></tr>` : ''}
        ${showDonatur && b.jumlahDonaturBarang>0 ? `<tr><td class="indent" style="font-style:italic;color:var(--ink-soft);font-size:12px;">+ ${b.jumlahDonaturBarang} sumbangan barang (bukan uang, lihat rincian Donatur di bawah)</td><td class="num"></td></tr>` : ''}
        ${showTransaksi ? `<tr><td class="indent">Pemasukan Lain (${b.jumlahTransaksiLain})</td><td class="num">${fmtRp(b.transaksiLain)}</td></tr>` : ''}
        <tr class="lpj-subtotal"><td>Total Pengeluaran</td><td class="num">${fmtRp(b.pengeluaran)}</td></tr>
        ${showOperasional ? `<tr><td class="indent">Operasional Kegiatan (${b.jumlahOperasional})</td><td class="num">${fmtRp(b.opsional)}</td></tr>` : ''}
        ${showLomba ? `<tr><td class="indent">Kebutuhan Lomba (${b.jumlahKebutuhanLomba})</td><td class="num">${fmtRp(b.kebutuhanLomba)}</td></tr>` : ''}
        ${showHadiah ? `<tr><td class="indent">Hadiah Lomba (${b.jumlahItemHadiahLomba} item)</td><td class="num">${fmtRp(b.hadiahLomba)}</td></tr>` : ''}
        ${showJalan ? `<tr><td class="indent">Hadiah Jalan Santai (${b.jumlahHadiahJalan})</td><td class="num">${fmtRp(b.hadiahJalan)}</td></tr>` : ''}
        <tr class="lpj-total"><td>Saldo Akhir</td><td class="num">${fmtRp(b.saldo)}</td></tr>
      </tbody>
    </table>

    <h3>2. Rincian Pemasukan</h3>
    ${pemasukanHtml}

    <h3>3. Rincian Pengeluaran</h3>
    ${pengeluaranHtml}

    <h3>4. Penutup</h3>
    <p class="lpj-penutup">Demikian Laporan Pertanggungjawaban kegiatan <strong>${esc(ev.nama)}</strong> ini kami susun berdasarkan data yang tercatat pada sistem, untuk dipergunakan sebagaimana mestinya.</p>
  </div>
  </div>

  ${isLoggedIn ? `
  <div class="lpj-toolbar no-print">
    <button class="btn small" onclick="window.print()">🖨️ Cetak / Simpan sebagai PDF</button>
  </div>` : ''}`;
}

/* ============================================================
   DAFTAR ANGGOTA - rekap & daftar nama anggota per event, format
   cetak sama seperti LPJ (pakai class lpj-* & mekanisme scale yang sama).
   ============================================================ */
function renderDaftarAnggota(){
  const ev = activeEvent();
  if (!ev) return `<div class="panel"><div class="panel-body" style="padding:24px;">Tidak ada event aktif.</div></div>`;

  const isLoggedIn = !!getCurrentUser();

  // Urutkan berdasarkan abjad nama saja (tidak dikelompokkan per RT).
  const anggotaList = gAnggota().slice().sort((a,b)=>(a.nama||'').localeCompare(b.nama||'', 'id', {sensitivity:'base'}));

  const totalAnggota = anggotaList.length;
  const totalPria = anggotaList.filter(a=>getGender(a)==='pria').length;
  const totalWanita = anggotaList.filter(a=>getGender(a)==='wanita').length;
  const totalTakDiketahui = totalAnggota - totalPria - totalWanita;

  const rekapRT = RT_LIST.map(r=>({
    label: r.l,
    total: anggotaList.filter(a=>getRT(a)===r.v).length,
  }));

  const rekapKategori = KATEGORI_ANGGOTA.map(k=>({
    label: k.l,
    total: anggotaList.filter(a=>a.kategori===k.v).length,
  }));

  const emptyRow = (n,text)=>`<tr class="empty-row"><td colspan="${n}">${text}</td></tr>`;

  return `
  <div class="lpj-scale-wrap" id="lpj-scale-wrap">
  <div class="lpj-print-area" id="lpj-print-area">
    <div class="lpj-header">
      <div class="lpj-header-inner">
        <img src="${esc(getOrgLogo())}" alt="Logo ${esc(getOrgNama())}" class="lpj-logo">
        <div class="lpj-header-text">
          <div class="lpj-eyebrow">${esc(getOrgNama())}</div>
          <h2>DAFTAR ANGGOTA</h2>
          <div class="lpj-sub">Kegiatan: ${esc(ev.nama)} — Tahun ${esc(String(ev.tahun))}</div>
          <div class="lpj-meta">Dicetak: ${fmtDate(todayISO())}</div>
        </div>
        <div class="lpj-header-spacer" aria-hidden="true"></div>
      </div>
    </div>

    <h3>1. Rekap Anggota</h3>
    <table class="lpj-table">
      <tbody>
        <tr class="lpj-subtotal"><td>Total Anggota</td><td class="num">${totalAnggota} orang</td></tr>
        <tr><td class="indent">Laki-Laki</td><td class="num">${totalPria} orang</td></tr>
        <tr><td class="indent">Perempuan</td><td class="num">${totalWanita} orang</td></tr>
        ${totalTakDiketahui > 0 ? `<tr><td class="indent">Tidak diketahui</td><td class="num">${totalTakDiketahui} orang</td></tr>` : ''}
        <tr class="lpj-subtotal"><td>Per RT</td><td class="num"></td></tr>
        ${rekapRT.map(r=>`<tr><td class="indent">${esc(r.label)}</td><td class="num">${r.total} orang</td></tr>`).join('')}
        <tr class="lpj-subtotal"><td>Per Kategori</td><td class="num"></td></tr>
        ${rekapKategori.map(k=>`<tr><td class="indent">${esc(k.label)}</td><td class="num">${k.total} orang</td></tr>`).join('')}
      </tbody>
    </table>

    <h3>2. Daftar Nama Anggota</h3>
    <div class="lpj-table-scroll"><table class="lpj-table lpj-detail">
      <thead><tr><th>No</th><th>Nama</th><th>RT</th><th>Jenis Kelamin</th><th>Kategori</th></tr></thead>
      <tbody>${anggotaList.map((a,idx)=>`<tr><td>${idx+1}</td><td>${esc(a.nama)}</td><td>${esc(labelRT(getRT(a)))}</td><td>${esc(labelGender(getGender(a)))}</td><td>${esc(labelKategori(a.kategori))}</td></tr>`).join('') || emptyRow(5,'Belum ada data anggota.')}</tbody>
    </table></div>
  </div>
  </div>

  ${isLoggedIn ? `
  <div class="lpj-toolbar no-print">
    <button class="btn small" onclick="window.print()">🖨️ Cetak / Simpan sebagai PDF</button>
  </div>` : ''}`;
}

