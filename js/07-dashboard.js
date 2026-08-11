/* ============================================================
   DASHBOARD
   ============================================================ */
let openBukuCards = new Set();
function toggleBukuCard(key){
  if(openBukuCards.has(key)) openBukuCards.delete(key); else openBukuCards.add(key);
  renderContent();
}
function bukuCardHtml(item){
  const isOpen = openBukuCards.has(item.key);
  const guestBlocked = !getCurrentUser() && !isGuestVisible(item.key);
  return `<div class="stat-card buku-card ${isOpen?'open':''}" ${da('toggleBukuCard', item.key)} style="cursor:pointer;">
    <div class="lbl" style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
      <span>${item.label}</span><span style="font-size:10px;color:var(--ink-soft);">${isOpen?'▲':'▼'}</span>
    </div>
    <div class="val">${fmtRp(item.value)}</div>
    ${isOpen ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--garis);font-size:12.5px;color:var(--ink-soft);">
      <div style="margin-bottom:8px;">${item.info}</div>
      ${guestBlocked
        ? `<button class="btn secondary small" disabled title="Hanya bisa dilihat setelah login">🔒 Lihat Selengkapnya</button>`
        : `<button class="btn secondary small" ${da('goSection', item.key)}>Lihat Selengkapnya →</button>`}
    </div>` : ''}
  </div>`;
}

function renderDashboard(){
  const b = hitungBukuUtama();
  const pemasukanItems = [
    {key:'anggota', label:'Total Iuran', value:b.iuran, info:`${b.jumlahIuranLunas} anggota sudah lunas`},
    {key:'donatur', label:'Total Donasi', value:b.donasi, info:`${b.jumlahDonatur} donatur tercatat${b.jumlahDonaturBarang>0?` · ${b.jumlahDonaturBarang} sumbangan barang`:''}`},
    {key:'transaksi', label:'Total Pemasukan Lain', value:b.transaksiLain, info:`${b.jumlahTransaksiLain} transaksi tercatat`},
  ].filter(item => isMenuAktif(item.key));
  const pengeluaranItems = [
    {key:'operasional', label:'Total Operasional Kegiatan', value:b.opsional, info:`${b.jumlahOperasional} biaya tercatat`},
    {key:'lomba', label:'Total Belanja Kebutuhan Lomba', value:b.kebutuhanLomba, info:`${b.jumlahKebutuhanLomba} item kebutuhan lomba`},
    {key:'hadiah', label:'Total Hadiah Lomba', value:b.hadiahLomba, info:`${b.jumlahItemHadiahLomba} item hadiah lomba`},
    {key:'hadiah-jalan', label:'Total Hadiah Jalan Santai', value:b.hadiahJalan, info:`${b.jumlahHadiahJalan} item hadiah jalan santai`},
  ].filter(item => isMenuAktif(item.key));

  const reminderCards = generateReminders();
  const isLoggedIn = !!getCurrentUser();

  return `
  ${reminderCards}
  <div class="stat-grid-ringkasan">
    <div class="stat-card pemasukan"><div class="lbl">Total Pemasukan</div><div class="val">${fmtRp(b.pemasukan)}</div></div>
    <div class="stat-card pengeluaran"><div class="lbl">Total Pengeluaran</div><div class="val">${fmtRp(b.pengeluaran)}</div></div>
  </div>
  <div class="stat-grid stat-grid-saldo">
    <div class="stat-card saldo"><div class="lbl">Saldo Akhir</div><div class="val">${fmtRp(b.saldo)}</div><div style="font-size:11px; color:var(--abu); margin-top:4px; line-height:1.4;">Proyeksi anggaran — sudah termasuk kebutuhan &amp; hadiah yang direncanakan, belum tentu semuanya sudah dibelanjakan.</div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><div><h3>Rincian Pemasukan</h3><div class="desc">Klik card untuk lihat rincian</div></div></div>
    <div class="panel-body">
      <div class="stat-grid" style="margin-bottom:0;">${pemasukanItems.map(bukuCardHtml).join('')}</div>
    </div>
  </div>
  ${kuponJalanPanelHtml()}
  <div class="panel">
    <div class="panel-head"><div><h3>Rincian Pengeluaran</h3><div class="desc">Klik card untuk lihat rincian</div></div></div>
    <div class="panel-body">
      <div class="stat-grid" style="margin-bottom:0;">${pengeluaranItems.map(bukuCardHtml).join('')}</div>
    </div>
  </div>`;
}

// Panel "Kupon Jalan Santai" di Buku Kegiatan — nunjukin sisa stok kupon
// (dari kt_settings.kuponJalanSantai.stok) & laporan ringkas kupon yang sudah
// terjual (dihitung dari kolom kuponqty di db.transaksiLain, lihat
// totalKuponTerjual() di js/09-donatur-transaksi-operasional.js). Hanya
// tampil kalau menu Pemasukan Lain aktif & fitur kupon sudah diatur admin
// (harga atau stok > 0), supaya tidak numpuk buat event yang tidak pakai
// kupon jalan santai.
function kuponJalanPanelHtml(){
  if (!isMenuAktif('transaksi')) return '';
  const s = getSettings();
  const kj = s.kuponJalanSantai || {harga:0, stok:0};
  const harga = Number(kj.harga||0);
  const stok = Number(kj.stok||0);
  if (harga<=0 && stok<=0) return ''; // fitur belum diatur, jangan tampilkan panel kosong

  const terjual = totalKuponTerjual();
  const sisa = stok>0 ? Math.max(0, stok - terjual) : null;
  const pendapatan = terjual * harga;
  const isLowStock = stok>0 && sisa!==null && sisa <= Math.ceil(stok*0.1);

  const sisaCard = stok>0 ? `
    <div class="stat-card${isLowStock ? ' stok-lebih' : ''}">
      <div class="lbl">Sisa Stok Kupon</div>
      <div class="val">${sisa} lembar</div>
      <div style="font-size:11px;color:var(--ink-soft);margin-top:4px;">dari ${stok} lembar dicetak${isLowStock ? ' · ⚠️ hampir habis' : ''}</div>
    </div>` : `
    <div class="stat-card">
      <div class="lbl">Sisa Stok Kupon</div>
      <div class="val">Tak terbatas</div>
      <div style="font-size:11px;color:var(--ink-soft);margin-top:4px;">stok belum diatur di Pengaturan</div>
    </div>`;

  const rows = gTransaksiLain()
    .filter(t => Number(t.kuponqty||0) > 0)
    .sort((a,b) => new Date(b.tanggal) - new Date(a.tanggal));
  const recentRows = rows.slice(0, 5);
  const isOpen = openBukuCards.has('kupon-laporan');
  const laporanCard = `<div class="stat-card buku-card ${isOpen?'open':''}" ${da('toggleBukuCard','kupon-laporan')} style="cursor:pointer;">
    <div class="lbl" style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
      <span>Kupon Terjual</span><span style="font-size:10px;color:var(--ink-soft);">${isOpen?'▲':'▼'}</span>
    </div>
    <div class="val">${terjual} lembar</div>
    <div style="font-size:11px;color:var(--ink-soft);margin-top:4px;">${fmtRp(pendapatan)} pendapatan</div>
    ${isOpen ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--garis);font-size:12.5px;color:var(--ink-soft);">
      ${recentRows.length ? recentRows.map(t => `
        <div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;">
          <span>${fmtDateShort(t.tanggal)} · ${t.kuponqty} lembar</span>
          <span>${fmtRp(t.jumlah)}</span>
        </div>`).join('') : '<div>Belum ada penjualan kupon tercatat.</div>'}
      ${rows.length > recentRows.length ? `<div style="margin-top:4px;">+${rows.length - recentRows.length} transaksi lainnya</div>` : ''}
      <div style="margin-top:8px;">
        ${(!getCurrentUser() && !isGuestVisible('transaksi'))
          ? `<button class="btn secondary small" disabled title="Hanya bisa dilihat setelah login">🔒 Lihat Selengkapnya</button>`
          : `<button class="btn secondary small" ${da('goSection','transaksi')}>Lihat Selengkapnya →</button>`}
      </div>
    </div>` : ''}
  </div>`;

  return `
  <div class="panel">
    <div class="panel-head"><div><h3>🎟️ Kupon Jalan Santai</h3><div class="desc">Sisa stok & laporan penjualan kupon</div></div></div>
    <div class="panel-body">
      <div class="stat-grid" style="margin-bottom:0;">${sisaCard}${laporanCard}</div>
    </div>
  </div>`;
}

function generateReminders(){
  const reminders = [];
  const today = new Date();
  const isLoggedIn = !!getCurrentUser();

  // Agenda Kegiatan — tidak terikat event, jadi selalu dicek terlepas
  // dari ada/tidaknya event aktif.
  const agendaList = gAgenda().filter(a => a.status !== 'selesai');
  const upcomingAgenda = agendaList.filter(a => {
    const aDate = new Date(a.tanggal + 'T00:00:00');
    const diffDays = Math.ceil((aDate - today) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 7;
  }).sort((a,b) => new Date(a.tanggal) - new Date(b.tanggal));

  if (upcomingAgenda.length > 0) {
    const todayAgenda = upcomingAgenda.filter(a => {
      const aDate = new Date(a.tanggal + 'T00:00:00');
      return aDate.toDateString() === today.toDateString();
    });
    const soonAgenda = upcomingAgenda.filter(a => {
      const aDate = new Date(a.tanggal + 'T00:00:00');
      return aDate.toDateString() !== today.toDateString();
    });

    let items = [];
    if (todayAgenda.length > 0) {
      items.push({label: '📌 Hari ini:', value: todayAgenda.map(a => `${a.judul} (${labelKategoriJadwal(a.kategori)})`).join(', ')});
    }
    if (soonAgenda.length > 0) {
      const soonText = soonAgenda.map(a => {
        const aDate = new Date(a.tanggal + 'T00:00:00');
        const diffDays = Math.ceil((aDate - today) / (1000 * 60 * 60 * 24));
        const dayLabel = diffDays === 1 ? 'Besok' : `${diffDays} hari lagi`;
        return `${a.judul} (${dayLabel})`;
      }).join(', ');
      items.push({label: '📅 Mendatang:', value: soonText});
    }

    reminders.push({
      type: 'info',
      icon: '📌',
      title: 'Agenda Kegiatan',
      count: upcomingAgenda.length,
      items: items,
      action: {label: 'Lihat Semua →', link: 'agenda'}
    });
  }

  // Catatan: kartu "Lomba Hari Ini!" (detail lomba yang jadwalnya hari ini)
  // sudah dipindah ke menu Jadwal Kegiatan (lihat generateJadwalReminderCard
  // di 12-jadwal-agenda-kas.js) supaya semua info jadwal — termasuk lomba —
  // ngumpul di satu tempat yang memang tentang jadwal, tidak dobel di sini.

  // Catatan: kartu notifikasi "Jadwal Mendatang" sudah dipindah ke menu
  // Jadwal Kegiatan sendiri (lihat generateJadwalReminderCard di
  // 12-jadwal-agenda-kas.js), tidak lagi ditampilkan di Buku Kegiatan supaya
  // tidak dobel dan lebih relevan langsung di menunya.

  const hadiahItems = [];
  if (isMenuAktif('hadiah')) gHadiahKategori().forEach(h => {
    h.items.forEach((item) => {
      if (Number(item.qty_dibeli||0) <= 0) return;
      const belanja = db.daftarBelanjaHadiah.find(b => b.hadiah_kategori_id === h.id && b.item_id === item.id && b.event_id === eid());
      if (!belanja || belanja.status !== 'dibeli') {
        hadiahItems.push({nama: item.nama, qty: item.qty_dibeli, kategori: labelPeserta(h.kategori_peserta)});
      }
    });
  });

  const perlengkapanItems = [];
  if (isMenuAktif('lomba')) gLomba().forEach(l => {
    gKebutuhan(l.id).forEach(k => {
      const belanja = db.daftarBelanjaPerlengkapan.find(b => b.kebutuhan_id === k.id && b.event_id === eid());
      if (!belanja || belanja.status !== 'dibeli') {
        perlengkapanItems.push({nama: k.nama_item, qty: k.qty, lomba: l.nama});
      }
    });
  });

  const jalanItems = isMenuAktif('jalan_santai') ? gHadiahJalanSantai().filter(h => {
    const belanja = db.daftarBelanjaJalanSantai.find(b => b.hadiah_jalan_id === h.id && b.event_id === eid());
    return !belanja || belanja.status !== 'dibeli';
  }) : [];

  const totalBelum = hadiahItems.length + perlengkapanItems.length + jalanItems.length;

  if (totalBelum > 0) {
    let items = [];
    if (hadiahItems.length > 0) {
      const labels = hadiahItems.slice(0, 3).map(i => `${i.nama} (${i.kategori})`).join(', ');
      items.push({label: '🎁 Hadiah Lomba:', value: hadiahItems.length > 3 ? `${labels} +${hadiahItems.length-3} lagi` : labels});
    }
    if (perlengkapanItems.length > 0) {
      const labels = perlengkapanItems.slice(0, 3).map(i => `${i.nama} (${i.lomba})`).join(', ');
      items.push({label: '📦 Perlengkapan:', value: perlengkapanItems.length > 3 ? `${labels} +${perlengkapanItems.length-3} lagi` : labels});
    }
    if (jalanItems.length > 0) {
      const labels = jalanItems.slice(0, 3).map(i => i.nama_hadiah).join(', ');
      items.push({label: '🏃 Jalan Santai:', value: jalanItems.length > 3 ? `${labels} +${jalanItems.length-3} lagi` : labels});
    }
    const type = totalBelum > 5 ? 'danger' : 'warning';
    // Tentukan tujuan link sesuai kategori yang benar-benar punya item belum dibeli.
    // Kalau cuma satu kategori yang ada isinya, arahkan langsung ke situ.
    // Kalau campuran beberapa kategori, arahkan ke kategori dengan item terbanyak
    // (bukan selalu belanja-hadiah seperti sebelumnya).
    const kategoriCounts = [
      {link: 'belanja-hadiah', count: hadiahItems.length},
      {link: 'belanja-perlengkapan', count: perlengkapanItems.length},
      {link: 'belanja-jalan', count: jalanItems.length}
    ].filter(k => k.count > 0).sort((a,b) => b.count - a.count);
    const targetLink = kategoriCounts.length > 0 ? kategoriCounts[0].link : 'belanja-hadiah';
    reminders.push({
      type: type,
      icon: '🛒',
      title: 'Belanja Belum Dibeli',
      count: totalBelum,
      items: items,
      action: {label: `Lihat ${totalBelum} Item →`, link: targetLink}
    });
  }

  const stokKurang = [];
  if (isMenuAktif('hadiah')) gHadiahKategori().forEach(h => {
    const kebutuhan = hitungKebutuhanHadiah(h.kategori_peserta, h.juara_ke);
    if (kebutuhan == null) return; // partisipasi: tidak dihitung otomatis
    h.items.forEach(item => {
      const target = hitungTargetQtyItem(item, kebutuhan);
      const dibeli = Number(item.qty_dibeli||0);
      if (dibeli < target) {
        stokKurang.push({nama: item.nama, kurang: target - dibeli, kategori: labelPeserta(h.kategori_peserta)});
      }
    });
  });

  if (stokKurang.length > 0) {
    const labels = stokKurang.slice(0, 3).map(i => `${i.nama} (kurang ${i.kurang})`).join(', ');
    reminders.push({
      type: 'warning',
      icon: '⚠️',
      title: 'Stok Hadiah Belum Sesuai Kebutuhan',
      count: stokKurang.length,
      items: [{label: 'Item:', value: stokKurang.length > 3 ? `${labels} +${stokKurang.length-3} lagi` : labels}],
      action: {label: 'Cek Stok →', link: 'hadiah'}
    });
  }

  // Kupon Jalan Santai hampir/sudah habis — cuma dicek kalau fiturnya
  // memang dipakai (stok diatur admin di Pengaturan, lihat kuponJalanPanelHtml
  // di bawah untuk panel lengkapnya di Buku Kegiatan).
  if (isMenuAktif('transaksi')) {
    const sKupon = getSettings().kuponJalanSantai || {harga:0, stok:0};
    const stokKupon = Number(sKupon.stok||0);
    if (stokKupon > 0) {
      const terjualKupon = totalKuponTerjual();
      const sisaKupon = Math.max(0, stokKupon - terjualKupon);
      if (sisaKupon <= Math.ceil(stokKupon*0.1)) {
        reminders.push({
          type: sisaKupon <= 0 ? 'danger' : 'warning',
          icon: '🎟️',
          title: sisaKupon <= 0 ? 'Stok Kupon Jalan Santai Habis' : 'Stok Kupon Jalan Santai Menipis',
          count: sisaKupon,
          items: [
            {label: 'Sisa Stok:', value: `${sisaKupon} dari ${stokKupon} lembar`, valueClass: sisaKupon<=0?'danger':'warning'},
            {label: 'Terjual:', value: `${terjualKupon} lembar`}
          ],
          action: {label: 'Kelola Kupon →', link: 'transaksi'}
        });
      }
    }
  }

  const belumBayar = gAnggota().filter(a => a.status === 'belum_lunas');
  if (belumBayar.length > 0) {
    const labels = belumBayar.slice(0, 3).map(a => a.nama).join(', ');
    const totalTunggakan = belumBayar.reduce((s,a) => s + Number(a.nominal_wajib||0), 0);
    reminders.push({
      type: 'danger',
      icon: '💰',
      title: 'Anggota Belum Bayar',
      count: belumBayar.length,
      items: [
        {label: 'Anggota:', value: belumBayar.length > 3 ? `${labels} +${belumBayar.length-3} lagi` : labels},
        {label: 'Total Tunggakan:', value: fmtRp(totalTunggakan), valueClass: 'danger'}
      ],
      action: {label: `Lihat ${belumBayar.length} Anggota →`, link: 'anggota'}
    });
  }

  const {saldo} = hitungBukuUtama();
  if (saldo < 0) {
    reminders.push({
      type: 'danger',
      icon: '🚨',
      title: '⚠️ Saldo Negatif!',
      count: fmtRp(saldo),
      items: [{label: 'Saldo saat ini:', value: fmtRp(saldo), valueClass: 'danger'}],
      action: {label: 'Cek Keuangan →', link: 'dashboard'}
    });
  }

  // Kartu Log Error — KHUSUS ADMIN. Ini murni info teknis/diagnosis
  // (riwayat toast merah/peringatan ⛔❌⚠ yg pernah muncul di SEMUA
  // perangkat/pengurus, disimpan di tabel kt_error_log — lihat
  // 16-ui-helpers.js), bukan data organisasi — jadi jangan sampai
  // kelihatan oleh user non-admin (termasuk guest & petugas).
  if (isAdmin()) {
    // Data server dimuat di belakang layar (lihat js/19-init.js -- dipreload
    // sekali saat app dibuka utk admin, sama pola dgn loadGudangData()).
    // Kalau ternyata belum sempat/gagal dimuat pas render dashboard ini
    // (mis. baru login), kick off sekali lagi di sini & render ulang begitu
    // selesai, supaya tidak perlu nunggu refresh manual.
    if (!errorLogCloudLoaded && !errorLogCloudLoading) {
      loadErrorLogFromCloud().then(() => { if (currentSection === 'dashboard') renderContent(); });
    }
    const pendingCount = getErrorLogPendingCount();
    const totalCount = errorLogCloud.length + pendingCount;
    if (totalCount > 0) {
      const recent = errorLogCloud.slice(0, 3);
      const items = recent.map(e => ({
        label: new Date(e.created_at).toLocaleString('id-ID', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}) + ':',
        value: e.message
      }));
      if (errorLogCloud.length > recent.length) {
        items.push({label: '', value: `+${errorLogCloud.length - recent.length} lainnya — ekspor log lengkap di Pengaturan`});
      }
      if (pendingCount > 0) {
        items.push({label: '📶 Belum tersinkron:', value: `${pendingCount} error tercatat offline di perangkat ini, menunggu koneksi`});
      }
      reminders.push({
        type: totalCount > 10 ? 'danger' : 'warning',
        icon: '🚨',
        title: 'Log Error Aplikasi (Admin)',
        count: totalCount,
        items: items,
        action: {label: 'Kelola Log →', link: 'pengaturan'}
      });
    }
  }

  if (reminders.length === 0) {
    return `
    <div class="reminder-grid">
      <div class="reminder-card success">
        <div class="card-header">
          <div class="icon">✅</div>
          <div class="title">Semua Aman!</div>
          <div class="count">0</div>
        </div>
        <div class="card-body">
          <div class="reminder-empty">Tidak ada pengingat saat ini. Semua data dalam kondisi baik.</div>
        </div>
        <div class="card-footer">
          ${isLoggedIn ? `<button class="btn secondary small" ${da('openJadwalModal')}>+ Tambah Jadwal</button>` : ''}
        </div>
      </div>
    </div>`;
  }

  return `
  <div class="reminder-grid">
    ${reminders.map(r => `
      <div class="reminder-card ${r.type}">
        <div class="card-header">
          <div class="icon">${r.icon}</div>
          <div class="title">${r.title}</div>
          <div class="count">${r.count}</div>
        </div>
        <div class="card-body">
          ${r.itemsHtml ? r.itemsHtml : r.items.map(item => `
            <div class="item">
              <span class="label">${item.label}</span>
              <span class="value ${item.valueClass || ''}">${esc(item.value)}</span>
            </div>
          `).join('')}
        </div>
        ${r.action ? `
        <div class="card-footer">
          ${(!getCurrentUser() && !isGuestVisible(r.action.link))
            ? `<button class="btn secondary small" disabled title="Hanya bisa dilihat setelah login">🔒 ${r.action.label.replace(/\s*→\s*$/, '')}</button>`
            : `<button class="btn ${r.type === 'danger' ? 'danger' : r.type === 'warning' ? 'orange' : r.type === 'success' ? 'success' : 'secondary'} small" ${da('goSection', r.action.link)}>${r.action.label}</button>`}
        </div>` : ''}
      </div>
    `).join('')}
  </div>`;
}

function labelKategoriJadwal(v){ return (KATEGORI_JADWAL.find(k=>k.v===v)||{}).l || v; }
