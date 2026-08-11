/* ============================================================
   JADWAL (dengan auth check)
   ============================================================ */
// Kartu notifikasi "Jadwal Mendatang" — sebelumnya tampil di Buku Kegiatan
// (dashboard), sekarang dipindah ke sini supaya langsung terlihat di menu
// Jadwal Kegiatan sendiri, lebih relevan & tidak dobel dengan Buku Kegiatan.
// Setiap jadwal ditampilkan sebagai kartu detail lengkap (bukan cuma satu
// baris ringkas) — kalau entrinya otomatis nyambung ke Lomba (lihat
// getLombaForJadwal), detail perlengkapan & koordinatornya ikut ditampilkan,
// menggantikan kartu "Lomba Hari Ini!" yang dulu ada terpisah di Buku Kegiatan.
function generateJadwalReminderCard(){
  const today = new Date();
  const jadwalList = gJadwal().filter(j => j.status !== 'selesai');
  const upcomingJadwal = jadwalList.filter(j => {
    const jDate = new Date(j.tanggal + 'T00:00:00');
    const diffDays = Math.ceil((jDate - today) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 7;
  }).sort((a,b) => new Date(a.tanggal) - new Date(b.tanggal) || String(a.jam||'').localeCompare(String(b.jam||'')));

  if (upcomingJadwal.length === 0) return '';

  const itemCardsHtml = upcomingJadwal.map(j => {
    const jDate = new Date(j.tanggal + 'T00:00:00');
    const diffDays = Math.ceil((jDate - today) / (1000 * 60 * 60 * 24));
    const kapanLabel = diffDays === 0 ? 'Hari ini!' : diffDays === 1 ? 'Besok' : `${diffDays} hari lagi`;

    // Entri yang otomatis nyambung ke Lomba (lihat syncAgendaLomba di
    // 10-lomba.js) ditampilkan sebagai kartu "poster" tersendiri — lebih
    // menonjol & mudah discreenshot/dibagikan ke grup WA panitia, dibanding
    // baris label:value polos. Entri jadwal biasa (bukan lomba) tetap pakai
    // tampilan rows lama seperti semula.
    const lombaLink = getLombaForJadwal(j.id);
    if (lombaLink){
      const kebutuhan = gKebutuhan(lombaLink.id);
      const perlengkapanText = kebutuhan.length
        ? kebutuhan.map(k => `${k.nama_item} (${k.qty})`).join(', ')
        : 'Belum ada data perlengkapan';
      const koordinatorNama = getKoordinatorIds(lombaLink)
        .map(id => (db.anggota.find(a=>a.id===id)||{}).nama)
        .filter(Boolean);
      const koordinatorText = koordinatorNama.length ? koordinatorNama.join(', ') : 'Belum ada koordinator';
      return `
      <div class="lomba-poster">
        <div class="lomba-poster-kapan">${esc(kapanLabel)}</div>
        <div class="lomba-poster-kategori">${esc(labelPeserta(lombaLink.kategori_peserta))}</div>
        <h4 class="lomba-poster-title">${esc(lombaLink.nama)}</h4>
        <div class="lomba-poster-divider"></div>
        <div class="lomba-poster-grid">
          <div class="lomba-poster-item"><span class="k">🗓️ Tanggal</span><span class="v">${fmtDateHari(j.tanggal)}</span></div>
          <div class="lomba-poster-item"><span class="k">⏰ Jam</span><span class="v">${j.jam?esc(j.jam):'Belum ditentukan'}</span></div>
          <div class="lomba-poster-item full"><span class="k">📦 Perlengkapan</span><span class="v">${esc(perlengkapanText)}</span></div>
          <div class="lomba-poster-item full"><span class="k">👤 Koordinator</span><span class="v">${esc(koordinatorText)}</span></div>
        </div>
      </div>`;
    }

    return `
    <div class="lomba-detail-card">
      <div class="lomba-detail-row"><span class="lbl">🗓️ Hari &amp; Tanggal</span><span class="val">${fmtDateHari(j.tanggal)} · ${kapanLabel}</span></div>
      <div class="lomba-detail-row"><span class="lbl">⏰ Waktu</span><span class="val">${j.jam?esc(j.jam):'Belum ditentukan'}</span></div>
      <div class="lomba-detail-row"><span class="lbl">📌 Judul</span><span class="val">${esc(j.judul)}</span></div>
    </div>`;
  }).join('');

  return `
  <div class="reminder-grid">
    <div class="reminder-card info">
      <div class="card-header">
        <div class="icon">📅</div>
        <div class="title">Jadwal Mendatang</div>
        <div class="count">${upcomingJadwal.length}</div>
      </div>
      <div class="card-body">
        ${itemCardsHtml}
      </div>
    </div>
  </div>`;
}

function renderJadwal(){
  const list = gJadwal().slice().sort((a,b) => {
    return new Date(a.tanggal) - new Date(b.tanggal);
  });
  const isLoggedIn = !!getCurrentUser();

  const today = new Date();
  const cards = list.map(j => {
    const jDate = new Date(j.tanggal + 'T00:00:00');
    const diffDays = Math.ceil((jDate - today) / (1000 * 60 * 60 * 24));
    let statusLabel = '';
    let statusClass = '';
    if (j.status === 'selesai') {
      statusLabel = 'Selesai';
      statusClass = 'lunas';
    } else if (diffDays < 0) {
      statusLabel = 'Terlewat';
      statusClass = 'belum';
    } else if (diffDays === 0) {
      statusLabel = 'Hari Ini!';
      statusClass = 'dibeli';
    } else if (diffDays <= 3) {
      statusLabel = `${diffDays} hari lagi`;
      statusClass = 'dibeli';
    } else {
      statusLabel = `${diffDays} hari lagi`;
      statusClass = 'perlengkapan';
    }

    // Entri yang otomatis dibuat/di-sync dari menu Lomba (lihat syncAgendaLomba di
    // 10-lomba.js) dikunci di sini — judul/tanggal/jam-nya SELALU mengikuti data
    // lomba sumbernya, jadi edit/hapus manual di sini akan ditimpa/bikin bingung.
    // Status selesai/aktif tetap boleh diubah bebas karena field itu tidak disentuh
    // oleh sinkronisasi.
    const lombaLink = getLombaForJadwal(j.id);
    const lockBadge = lombaLink ? `<span class="lomba-badge" style="margin-left:6px;" title="Judul/tanggal/jam otomatis mengikuti data Lomba"><i data-lucide="link" class="inline-icon"></i> Otomatis</span>` : '';
    const editAction = lombaLink ? da('bukaLombaDariJadwal', lombaLink.id) : da('openJadwalModal', j.id);
    const hapusAction = lombaLink ? da('hapusJadwalLombaLocked', lombaLink.id) : da('hapusJadwal', j.id);
    const editTitle = lombaLink ? 'Edit lewat menu Lomba' : 'Edit';
    const hapusTitle = lombaLink ? 'Kelola lewat menu Lomba' : 'Hapus';

    return `
    <div class="jadwal-item ${j.status==='selesai'?'selesai':''} ${j.status!=='selesai'&&diffDays<0?'terlambat':''}">
      <div class="jadwal-item-top">
        <div class="jadwal-item-date">
          <span class="jadwal-item-date-main">${fmtDateHariShort(j.tanggal)}</span>
          ${j.jam?`<span class="jadwal-item-jam"><i data-lucide="clock" class="inline-icon"></i>${esc(j.jam)}</span>`:''}
        </div>
        <span class="badge ${statusClass}">${statusLabel}</span>
      </div>
      <div class="jadwal-item-title">${esc(j.judul)}${lockBadge}</div>
      <div class="jadwal-item-actions">
        <button class="btn secondary small" ${da('toggleJadwalStatus', j.id)} ${!isLoggedIn ? 'disabled' : ''}>${j.status === 'selesai' ? 'Buka' : 'Selesai'}</button>
        <button class="icon-btn" ${editAction} ${!isLoggedIn ? 'disabled' : ''} title="${editTitle}">✎</button>
        <button class="icon-btn" ${hapusAction} ${!isLoggedIn ? 'disabled' : ''} title="${hapusTitle}">🗑</button>
      </div>
    </div>`;
  }).join('');

  const total = list.length;
  const totalSelesai = list.filter(j => j.status === 'selesai').length;
  const totalActive = total - totalSelesai;
  const totalHariIni = list.filter(j => {
    const jDate = new Date(j.tanggal + 'T00:00:00');
    return jDate.toDateString() === today.toDateString() && j.status !== 'selesai';
  }).length;

  return `
  ${generateJadwalReminderCard()}
  <div class="stat-grid">
    <div class="stat-card info"><div class="lbl">Total Jadwal</div><div class="val">${total}</div></div>
    <div class="stat-card pemasukan"><div class="lbl">Aktif</div><div class="val">${totalActive}</div></div>
    <div class="stat-card warning"><div class="lbl">Hari Ini</div><div class="val">${totalHariIni}</div></div>
    <div class="stat-card"><div class="lbl">Selesai</div><div class="val">${totalSelesai}</div></div>
  </div>
  <div class="panel">
    <div class="panel-head">
      <div><h3>📅 Jadwal Kegiatan</h3>
        <div class="desc">Kelola jadwal kegiatan dan pengingat</div>
      </div>
      ${isLoggedIn ? `<button class="btn" ${da('openJadwalModal')}>+ Tambah Jadwal</button>` : ''}
    </div>
    <div class="panel-body">
      <div class="jadwal-item-list">${cards || `<div class="empty-row" style="padding:30px;text-align:center;">Belum ada jadwal. ${isLoggedIn ? 'Tambahkan jadwal untuk mendapatkan pengingat.' : 'Login untuk menambah jadwal.'}</div>`}</div>
    </div>
  </div>`;
}

function openJadwalModal(id){
  if (!canEditSection('jadwal')) { toast('⛔ Login untuk mengedit data'); return; }
  const editing = id ? db.jadwal.find(j=>j.id===id) : null;
  setModal(editing?'Edit Jadwal':'Tambah Jadwal', `
    <div class="field"><label>Judul</label><input id="f-judul" value="${editing?esc(editing.judul):''}" placeholder="mis. Belanja Hadiah Lomba"></div>
    <div class="field-row">
      <div class="field"><label>Tanggal</label><input id="f-tanggal" type="date" value="${editing?editing.tanggal:todayISO()}"></div>
      <div class="field"><label>Jam (opsional)</label><input id="f-jam" type="time" value="${editing?(editing.jam||''):''}"></div>
    </div>
    <div class="field"><label>Kategori</label>
      <select id="f-kategori">${KATEGORI_JADWAL.map(k=>`<option value="${k.v}" ${editing&&editing.kategori===k.v?'selected':''}>${k.l}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Deskripsi (opsional)</label>
      <textarea id="f-deskripsi" rows="3" data-autoresize="true" placeholder="Detail jadwal...">${editing?esc(editing.deskripsi||''):''}</textarea>
    </div>
    <div class="field"><label>Status</label>
      <select id="f-status">
        <option value="aktif" ${editing&&editing.status==='aktif'?'selected':''}>Aktif</option>
        <option value="selesai" ${editing&&editing.status==='selesai'?'selected':''}>Selesai</option>
      </select>
    </div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:editing?'Simpan':'Tambah', cls:'', onclick:()=>{
      const judul = document.getElementById('f-judul').value.trim();
      const tanggal = document.getElementById('f-tanggal').value;
      const jam = document.getElementById('f-jam').value || null;
      const kategori = document.getElementById('f-kategori').value;
      const deskripsi = document.getElementById('f-deskripsi').value.trim();
      const status = document.getElementById('f-status').value;
      if(!judul || !tanggal){ toast('Judul & tanggal wajib diisi'); return; }
      let actionMsg = editing ? `✏️ Edit jadwal: ${editing.judul} → ${judul}` : `➕ Jadwal baru: ${judul}`;
      if(editing){ Object.assign(editing, {judul, tanggal, jam, kategori, deskripsi, status}); }
      else{ db.jadwal.push({id:uid(), event_id:eid(), judul, tanggal, jam, kategori, deskripsi, status}); }
      saveDB(); closeModal(); renderContent(); renderTopbarSaldo(); toast('Jadwal disimpan');
      notifyTelegram(actionMsg, `Jadwal: ${fmtDateJam(tanggal, jam)}\nKategori: ${labelKategoriJadwal(kategori)}\nDeskripsi: ${deskripsi || '-'}`, 'agenda');
    }}
  ]);
}

function toggleJadwalStatus(id){
  if (!canEditSection('jadwal')) { toast('⛔ Login untuk mengedit data'); return; }
  const j = db.jadwal.find(x=>x.id===id);
  if(!j) return;
  j.status = j.status === 'selesai' ? 'aktif' : 'selesai';
  saveDB(); renderContent(); 
  const action = j.status === 'selesai' ? '✅ Selesai' : '↩️ Dibuka kembali';
  toast(`Jadwal "${j.judul}" ${j.status === 'selesai' ? 'selesai' : 'diaktifkan kembali'}`);
  notifyTelegram(`${action}: ${j.judul}`, `Jadwal: ${fmtDateJam(j.tanggal, j.jam)}`, 'agenda');
}

async function hapusJadwal(id){
  if (!canEditSection('jadwal')) { toast('⛔ Login untuk mengedit data'); return; }
  // Guard lapis kedua: kalau ada yang memanggil hapusJadwal langsung (bukan lewat
  // tombol di kartu, yang sudah dialihkan ke hapusJadwalLombaLocked), tetap cegah
  // penghapusan entri auto-lomba supaya tidak jadi referensi rusak di lomba.jadwal_id.
  const lombaLink = getLombaForJadwal(id);
  if(lombaLink){ hapusJadwalLombaLocked(lombaLink.id); return; }
  if(!(await confirmModal('Hapus jadwal ini?'))) return;
  const j = db.jadwal.find(x=>x.id===id);
  db.jadwal = db.jadwal.filter(j=>j.id!==id);
  saveDB(); renderContent(); toast('Jadwal dihapus');
  if(j) notifyTelegram(`🗑️ Hapus jadwal: ${j.judul}`, `Jadwal: ${fmtDateJam(j.tanggal, j.jam)}`, 'agenda');
}

// Dipanggil dari tombol Edit kartu jadwal auto-lomba: pindah ke menu Lomba dan
// langsung buka form edit lomba sumbernya, supaya user tidak perlu cari manual.
function bukaLombaDariJadwal(lombaId){
  goSection('lomba');
  setTimeout(()=>{ openLombaIds.add(lombaId); renderContent(); openLombaModal(lombaId); }, 60);
}

// Dipanggil dari tombol Hapus kartu jadwal auto-lomba. Tidak menghapus apa-apa —
// cuma menjelaskan kenapa dan menawarkan jalan pintas ke form lomba, supaya user
// bisa mengosongkan tanggal lomba (yang otomatis akan menghapus entri jadwal ini,
// lihat syncAgendaLomba) atau menghapus lombanya kalau memang sudah tidak dipakai.
async function hapusJadwalLombaLocked(lombaId){
  const l = db.lomba.find(x=>x.id===lombaId);
  const nama = l ? `"${l.nama}"` : 'ini';
  if(await confirmModal(`🔗 Jadwal ini otomatis mengikuti data Lomba ${nama} dan tidak bisa dihapus langsung dari sini.\n\nUntuk menghapusnya: buka form Lomba lalu kosongkan tanggalnya (atau hapus lombanya kalau sudah tidak dipakai).\n\nBuka form Lomba sekarang?`, {danger:false})){
    if(l) bukaLombaDariJadwal(lombaId); else goSection('lomba');
  }
}

/* ============================================================
   AGENDA KEGIATAN
   Sama seperti Jadwal & Reminder, tapi TIDAK terikat event sama
   sekali (tidak ada event_id) — untuk agenda umum organisasi yang
   tetap harus muncul jadi reminder di Buku Kegiatan walau belum ada
   event 17-an yang dibuat/aktif. Lihat gAgenda()/generateReminders().
   ============================================================ */
function gAgenda(){ return db.agenda; }

function renderAgenda(){
  const list = gAgenda().slice().sort((a,b) => new Date(a.tanggal) - new Date(b.tanggal));
  const isLoggedIn = !!getCurrentUser();

  const today = new Date();
  function statusAgenda(a){
    const aDate = new Date(a.tanggal + 'T00:00:00');
    const diffDays = Math.ceil((aDate - today) / (1000 * 60 * 60 * 24));
    let statusLabel = '';
    let statusClass = '';
    if (a.status === 'selesai') {
      statusLabel = 'Selesai';
      statusClass = 'lunas';
    } else if (diffDays < 0) {
      statusLabel = 'Terlewat';
      statusClass = 'belum';
    } else if (diffDays === 0) {
      statusLabel = 'Hari Ini!';
      statusClass = 'dibeli';
    } else if (diffDays <= 3) {
      statusLabel = `${diffDays} hari lagi`;
      statusClass = 'dibeli';
    } else {
      statusLabel = `${diffDays} hari lagi`;
      statusClass = 'perlengkapan';
    }
    return {diffDays, statusLabel, statusClass};
  }

  const rows = list.map(a => {
    const {diffDays, statusLabel, statusClass} = statusAgenda(a);
    return `
    <tr class="${a.status === 'selesai' ? '' : (diffDays < 0 ? 'belum-bayar' : '')}">
      <td data-label="Tanggal">${fmtDate(a.tanggal)}</td>
      <td data-label="Status"><span class="badge ${statusClass}">${statusLabel}</span></td>
      <td data-label="Kategori"><span class="kategori-pill">${labelKategoriJadwal(a.kategori)}</span></td>
      <td data-label="Judul">${esc(a.judul)}</td>
      <td data-label="Deskripsi">${esc(a.deskripsi||'-')}</td>
      <td data-label="Aksi" class="jadwal-actions" style="text-align:right; white-space:nowrap;">
        <button class="btn secondary small" ${da('toggleAgendaStatus', a.id)} ${!isLoggedIn ? 'disabled' : ''}>${a.status === 'selesai' ? 'Buka' : 'Selesai'}</button>
        <button class="icon-btn" ${da('openAgendaModal', a.id)} ${!isLoggedIn ? 'disabled' : ''} title="Edit">✎</button>
        <button class="icon-btn" ${da('hapusAgenda', a.id)} ${!isLoggedIn ? 'disabled' : ''} title="Hapus">🗑</button>
      </td>
    </tr>`;
  }).join('');

  // Kartu khusus HP — dipakai lewat .agenda-mobile-wrap (lihat media query
  // max-width:820px di style.css), tampilan komputer TETAP pakai tabel di
  // atas (.agenda-table-wrap) dan tidak berubah sama sekali. Meniru gaya
  // kartu Jadwal Kegiatan (hari/tanggal di atas, judul jadi judul kartu,
  // kategori disembunyikan supaya ringkas), tapi tanpa jam karena Agenda
  // Kegiatan memang tidak punya field jam.
  const cards = list.map(a => {
    const {diffDays, statusLabel, statusClass} = statusAgenda(a);
    return `
    <div class="jadwal-item ${a.status==='selesai'?'selesai':''} ${a.status!=='selesai'&&diffDays<0?'terlambat':''}">
      <div class="jadwal-item-top">
        <div class="jadwal-item-date">
          <span class="jadwal-item-date-main">${fmtDateHariShort(a.tanggal)}</span>
        </div>
        <span class="badge ${statusClass}">${statusLabel}</span>
      </div>
      <div class="jadwal-item-title">${esc(a.judul)}</div>
      ${a.deskripsi?`<div class="jadwal-item-desc">${esc(a.deskripsi)}</div>`:''}
      <div class="jadwal-item-actions">
        <button class="btn secondary small" ${da('toggleAgendaStatus', a.id)} ${!isLoggedIn ? 'disabled' : ''}>${a.status === 'selesai' ? 'Buka' : 'Selesai'}</button>
        <button class="icon-btn" ${da('openAgendaModal', a.id)} ${!isLoggedIn ? 'disabled' : ''} title="Edit">✎</button>
        <button class="icon-btn" ${da('hapusAgenda', a.id)} ${!isLoggedIn ? 'disabled' : ''} title="Hapus">🗑</button>
      </div>
    </div>`;
  }).join('');

  const total = list.length;
  const totalSelesai = list.filter(a => a.status === 'selesai').length;
  const totalActive = total - totalSelesai;
  const totalHariIni = list.filter(a => {
    const aDate = new Date(a.tanggal + 'T00:00:00');
    return aDate.toDateString() === today.toDateString() && a.status !== 'selesai';
  }).length;

  return `
  <div class="stat-grid">
    <div class="stat-card info"><div class="lbl">Total Agenda</div><div class="val">${total}</div></div>
    <div class="stat-card pemasukan"><div class="lbl">Aktif</div><div class="val">${totalActive}</div></div>
    <div class="stat-card warning"><div class="lbl">Hari Ini</div><div class="val">${totalHariIni}</div></div>
    <div class="stat-card"><div class="lbl">Selesai</div><div class="val">${totalSelesai}</div></div>
  </div>
  <div class="panel">
    <div class="panel-head">
      <div><h3>📌 Agenda Kegiatan</h3>
      </div>
      ${isLoggedIn ? `<button class="btn" ${da('openAgendaModal')}>+ Tambah Agenda</button>` : ''}
    </div>
    <div class="panel-body flush agenda-table-wrap">
      <table class="general-table jadwal-table">
        <thead><tr><th>Tanggal</th><th>Status</th><th>Kategori</th><th>Judul</th><th>Deskripsi</th><th></th></tr></thead>
        <tbody>${rows || `<tr class="empty-row"><td colspan="6">Belum ada agenda. ${isLoggedIn ? 'Tambahkan agenda untuk mendapatkan pengingat.' : 'Login untuk menambah agenda.'}</td></tr>`}</tbody>
      </table>
    </div>
    <div class="panel-body agenda-mobile-wrap">
      <div class="jadwal-item-list">${cards || `<div class="empty-row" style="padding:30px;text-align:center;">Belum ada agenda. ${isLoggedIn ? 'Tambahkan agenda untuk mendapatkan pengingat.' : 'Login untuk menambah agenda.'}</div>`}</div>
    </div>
  </div>`;
}

function openAgendaModal(id){
  if (!canEditSection('agenda')) { toast('⛔ Login untuk mengedit data'); return; }
  const editing = id ? db.agenda.find(a=>a.id===id) : null;
  setModal(editing?'Edit Agenda':'Tambah Agenda', `
    <div class="field"><label>Judul</label><input id="f-agenda-judul" value="${editing?esc(editing.judul):''}" placeholder="mis. Rapat Rutin Bulanan"></div>
    <div class="field-row">
      <div class="field"><label>Tanggal</label><input id="f-agenda-tanggal" type="date" value="${editing?editing.tanggal:todayISO()}"></div>
      <div class="field"><label>Kategori</label>
        <select id="f-agenda-kategori">${KATEGORI_JADWAL.map(k=>`<option value="${k.v}" ${editing&&editing.kategori===k.v?'selected':''}>${k.l}</option>`).join('')}</select>
      </div>
    </div>
    <div class="field"><label>Deskripsi (opsional)</label>
      <textarea id="f-agenda-deskripsi" rows="3" data-autoresize="true" placeholder="Detail agenda...">${editing?esc(editing.deskripsi||''):''}</textarea>
    </div>
    <div class="field"><label>Status</label>
      <select id="f-agenda-status">
        <option value="aktif" ${editing&&editing.status==='aktif'?'selected':''}>Aktif</option>
        <option value="selesai" ${editing&&editing.status==='selesai'?'selected':''}>Selesai</option>
      </select>
    </div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:editing?'Simpan':'Tambah', cls:'', onclick:()=>{
      const judul = document.getElementById('f-agenda-judul').value.trim();
      const tanggal = document.getElementById('f-agenda-tanggal').value;
      const kategori = document.getElementById('f-agenda-kategori').value;
      const deskripsi = document.getElementById('f-agenda-deskripsi').value.trim();
      const status = document.getElementById('f-agenda-status').value;
      if(!judul || !tanggal){ toast('Judul & tanggal wajib diisi'); return; }
      let actionMsg = editing ? `✏️ Edit agenda: ${editing.judul} → ${judul}` : `➕ Agenda baru: ${judul}`;
      if(editing){ Object.assign(editing, {judul, tanggal, kategori, deskripsi, status}); }
      else{ db.agenda.push({id:uid(), judul, tanggal, kategori, deskripsi, status}); }
      saveDB(); closeModal(); renderContent(); toast('Agenda disimpan');
      notifyTelegram(actionMsg, `Tanggal: ${fmtDate(tanggal)}\nKategori: ${labelKategoriJadwal(kategori)}\nDeskripsi: ${deskripsi || '-'}`, 'agenda');
    }}
  ]);
}

function toggleAgendaStatus(id){
  if (!canEditSection('agenda')) { toast('⛔ Login untuk mengedit data'); return; }
  const a = db.agenda.find(x=>x.id===id);
  if(!a) return;
  a.status = a.status === 'selesai' ? 'aktif' : 'selesai';
  saveDB(); renderContent();
  const action = a.status === 'selesai' ? '✅ Selesai' : '↩️ Dibuka kembali';
  toast(`Agenda "${a.judul}" ${a.status === 'selesai' ? 'selesai' : 'diaktifkan kembali'}`);
  notifyTelegram(`${action}: ${a.judul}`, `Tanggal: ${fmtDate(a.tanggal)}`, 'agenda');
}

async function hapusAgenda(id){
  if (!canEditSection('agenda')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!(await confirmModal('Hapus agenda ini?'))) return;
  const a = db.agenda.find(x=>x.id===id);
  db.agenda = db.agenda.filter(x=>x.id!==id);
  saveDB(); renderContent(); toast('Agenda dihapus');
  if(a) notifyTelegram(`🗑️ Hapus agenda: ${a.judul}`, `Tanggal: ${fmtDate(a.tanggal)}`, 'agenda');
}

/* ============================================================
   KAS KARANG TARUNA
   Buku kas umum organisasi — TIDAK terikat event 17-an tertentu,
   sama seperti Agenda/Gudang/Dokumen. Semua orang (termasuk guest)
   bisa melihat, tapi hanya role yang diizinkan (Admin, User, atau
   Petugas yang ditugaskan ke bidang "Kas Karang Taruna" lewat
   Manajemen User) yang bisa menambah/mengedit/menghapus baris.
   Saldo dihitung berjalan (running balance) saat render:
   saldo = saldo sebelumnya + debit - kredit.
   ============================================================ */
function gKas(){ return db.kas; }

// Baris OTOMATIS dari rekap bulanan Dana Sosial (lihat js/22-dana-sosial.js)
// — TIDAK disimpan ke db.kas/Supabase sama sekali, cuma dihitung ulang tiap
// kali Kas Organisasi dirender (makanya id-nya deterministik "auto-ds-TAHUN-BULAN",
// dipakai sebagai anchor untuk kunci edit/hapus di UI, bukan buat disimpan).
// Aturan sesuai keputusan:
//  - Nominalnya SALDO BERSIH bulan itu (terkumpul dikurangi potongan
//    konsumsi pertemuan Rp80rb) — potongan itu sendiri TIDAK dicatat sebagai
//    baris terpisah di Kas (dianggap sudah dipakai langsung dari uang tunai
//    pertemuan, tidak pernah masuk fisik ke kas organisasi).
//  - Hanya bulan yang SUDAH BERJALAN (bukan proyeksi bulan depan) dan yang
//    punya anggota wajib bayar (r.wajib > 0) yang diikutkan.
//  - Kalau saldo bersih bulan itu <= 0 (terkumpul tidak menutup potongan),
//    baris TIDAK dibuat sama sekali — tidak ada uang bersih yang masuk kas
//    bulan itu, jadi tidak masuk akal dicatat sebagai pemasukan (apalagi
//    sebagai pemasukan minus).
//  - Baris ini DIKUNCI di UI (lihat renderKas): tidak ada tombol edit/hapus,
//    cuma bisa berubah kalau data Dana Sosial sumbernya berubah (rekap
//    dihitung ulang otomatis tiap render, tidak perlu sinkron manual).
function getDanaSosialKasAutoEntries(){
  if (typeof hitungRekapBulanDanaSosial !== 'function' || !Array.isArray(db.danaSosialAnggota) || db.danaSosialAnggota.length === 0) return [];
  const now = new Date();
  const tahunMulai = db.danaSosialAnggota.reduce((min, a) => {
    const y = a.tanggal_gabung ? Number(a.tanggal_gabung.slice(0,4)) : now.getFullYear();
    return Math.min(min, y);
  }, now.getFullYear());
  const entries = [];
  for (let y = tahunMulai; y <= now.getFullYear(); y++){
    const bulanAkhir = (y === now.getFullYear()) ? (now.getMonth() + 1) : 12;
    for (let b = 1; b <= bulanAkhir; b++){
      const r = hitungRekapBulanDanaSosial(y, b);
      if (r.wajib === 0 || !r.sudahBerjalan) continue;
      const netBulan = r.terkumpul - r.potongan;
      // Defisit tetap harus tercermin sebagai kredit; melewatinya membuat
      // akumulasi Kas lebih besar daripada saldo Dana Sosial sebenarnya.
      if (netBulan === 0) continue;
      const tglAkhirBulan = new Date(y, b, 0).getDate();
      const tanggal = `${y}-${String(b).padStart(2,'0')}-${String(tglAkhirBulan).padStart(2,'0')}`;
      entries.push({
        id: `auto-ds-${y}-${b}`,
        tanggal,
        keterangan: `Rekap Dana Sosial ${DANA_SOSIAL_BULAN_LABEL[b-1]} ${y}`,
        debit: netBulan > 0 ? netBulan : 0,
        kredit: netBulan < 0 ? Math.abs(netBulan) : 0,
        created_at: `${tanggal}T00:00:00.000Z`,
        _autoDanaSosial: true,
      });
    }
  }
  return entries;
}

function renderKas(){
  const list = gKas().concat(getDanaSosialKasAutoEntries()).sort((a,b) => (a.tanggal||'').localeCompare(b.tanggal||'') || (a.created_at||'').localeCompare(b.created_at||''));
  const canKelola = canEditSection('kas');
  const totalDebit = list.reduce((s,k)=>s+Number(k.debit||0),0);
  const totalKredit = list.reduce((s,k)=>s+Number(k.kredit||0),0);

  // Hitung saldo berjalan urut kronologis (lama -> baru) dulu,
  // baru ditampilkan terbalik (baru -> lama) supaya transaksi
  // terakhir tetap muncul paling atas tapi saldo tetap benar.
  let saldo = 0;
  const withSaldo = list.map(k => {
    saldo += Number(k.debit||0) - Number(k.kredit||0);
    return {...k, _saldo: saldo};
  });
  const displayList = withSaldo.slice().reverse();

  const rows = displayList.map((k, idx) => `
    <tr>
      <td data-label="No">${idx + 1}</td>
      <td data-label="Tanggal">${fmtDateShort(k.tanggal)}</td>
      <td data-label="Keterangan">${esc(k.keterangan||'-')}${k._autoDanaSosial ? ` <span class="lomba-badge" title="Otomatis dari rekap bulanan Dana Sosial, tidak bisa diedit di sini"><i data-lucide="link" class="inline-icon"></i> Otomatis</span>` : ''}</td>
      <td data-label="Debit" class="num">${Number(k.debit||0)>0 ? fmtRp(k.debit) : '-'}</td>
      <td data-label="Kredit" class="num">${Number(k.kredit||0)>0 ? fmtRp(k.kredit) : '-'}</td>
      <td data-label="Saldo" class="num">${fmtRp(k._saldo)}</td>
      ${canKelola ? `<td class="kas-actions" style="text-align:right;white-space:nowrap;">
        ${k._autoDanaSosial ? `<span class="icon-btn" style="opacity:.5; cursor:default;" title="Kelola lewat menu Dana Sosial">🔒</span>` : `<button class="icon-btn" ${da('openKasModal', k.id)} title="Edit">✎</button>
        <button class="icon-btn" ${da('hapusKas', k.id)} title="Hapus">🗑</button>`}
      </td>` : ''}
    </tr>`).join('');

  // Tabel ringkas khusus HP — tetap berupa TABEL utuh (bukan kartu):
  // No, Keterangan, Debit, Kredit, Saldo. Kolom Tanggal & Aksi disembunyikan
  // supaya 5 kolom inti muat tanpa geser; baris bisa diketuk langsung untuk
  // Edit (tombol Hapus dipindah ke dalam modal edit, lihat openKasModal).
  // Kalau layar HP sangat sempit, kolom Saldo ikut disembunyikan lewat CSS
  // (lihat media query .kas-table-mobile di style.css) sehingga tampilan
  // jadi No, Keterangan, Debit, Kredit saja.
  const mobileRows = displayList.map((k, idx) => `
    <tr${(canKelola && !k._autoDanaSosial) ? ` class="row-clickable" ${da('openKasModal', k.id)}` : ''}>
      <td data-label="No">${idx + 1}</td>
      <td data-label="Keterangan">${esc(k.keterangan||'-')}${k._autoDanaSosial ? ' 🔒' : ''}</td>
      <td data-label="Debit" class="num">${Number(k.debit||0)>0 ? fmtRp(k.debit) : '-'}</td>
      <td data-label="Kredit" class="num">${Number(k.kredit||0)>0 ? fmtRp(k.kredit) : '-'}</td>
      <td data-label="Saldo" class="num">${fmtRp(k._saldo)}</td>
    </tr>`).join('');

  return `
  <div class="stat-grid">
    <div class="stat-card pemasukan"><div class="lbl">Total Pemasukan</div><div class="val">${fmtRp(totalDebit)}</div></div>
    <div class="stat-card pengeluaran"><div class="lbl">Total Pengeluaran</div><div class="val">${fmtRp(totalKredit)}</div></div>
    <div class="stat-card ${saldo<0?'defisit':'saldo'}"><div class="lbl">Saldo Kas</div><div class="val">${fmtRp(saldo)}</div></div>
  </div>
  <div class="panel">
    <div class="panel-head">
      <div></div>
      ${canKelola ? `<button class="btn" ${da('openKasModal')}>+ Tambah Transaksi</button>` : ''}
    </div>
    <div class="panel-body flush kas-table-wrap">
      <table class="general-table kas-table">
        <thead><tr><th>No</th><th>Tanggal</th><th>Keterangan</th><th class="num">Debit</th><th class="num">Kredit</th><th class="num">Saldo</th>${canKelola?'<th></th>':''}</tr></thead>
        <tbody>${rows || `<tr class="empty-row"><td colspan="${canKelola?7:6}">Belum ada transaksi kas. ${canKelola ? '' : 'Hanya role tertentu yang bisa menambah transaksi.'}</td></tr>`}</tbody>
      </table>
    </div>
    <div class="panel-body flush kas-mobile-wrap">
      <table class="general-table kas-table-mobile">
        <thead><tr><th>No</th><th>Keterangan</th><th class="num">Debit</th><th class="num">Kredit</th><th class="num">Saldo</th></tr></thead>
        <tbody>${mobileRows || `<tr class="empty-row"><td colspan="5">Belum ada transaksi kas. ${canKelola ? '' : 'Hanya role tertentu yang bisa menambah transaksi.'}</td></tr>`}</tbody>
      </table>
    </div>
  </div>
  <div class="kas-footnote">
    Catatan: Dokumen ini merupakan salinan digital (backup).
    Referensi utama tetap pada buku besar fisik.
    Apabila terdapat perbedaan, maka buku besar manual menjadi acuan resmi.
  </div>`;
}

function openKasModal(id){
  if (!canEditSection('kas')) { toast(`⛔ Anda tidak memiliki akses untuk mengedit ${getOrgNamaKas()}`); return; }
  if (id && String(id).startsWith('auto-ds-')) { toast('🔒 Baris ini otomatis dari rekap Dana Sosial, kelola di menu Dana Sosial'); return; }
  const editing = id ? db.kas.find(k=>k.id===id) : null;
  const editingJenis = editing ? (Number(editing.kredit||0) > 0 ? 'keluar' : 'masuk') : 'masuk';
  const editingJumlah = editing ? (editingJenis === 'masuk' ? editing.debit : editing.kredit) : 0;
  setModal(editing?'Edit Transaksi Kas':'Tambah Transaksi Kas', `
    <div class="field"><label>Jenis Transaksi</label>
      <select id="f-kas-jenis">
        <option value="masuk" ${editingJenis==='masuk'?'selected':''}>⬇️ Pemasukan</option>
        <option value="keluar" ${editingJenis==='keluar'?'selected':''}>⬆️ Pengeluaran</option>
      </select>
    </div>
    <div class="field"><label>Tanggal</label><input id="f-kas-tanggal" type="date" value="${editing?editing.tanggal:todayISO()}"></div>
    <div class="field"><label>Keterangan</label><input id="f-kas-ket" value="${editing?esc(editing.keterangan||''):''}" placeholder="mis. Iuran bulanan anggota"></div>
    <div class="field"><label>Jumlah (Rp)</label><input id="f-kas-jumlah" class="currency-input" type="text" value="${editing?formatCurrency(editingJumlah||0):''}"></div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    ...(editing ? [{label:'Hapus', cls:'danger', onclick:()=>{ closeModal(); hapusKas(editing.id); }}] : []),
    {label: editing?'Simpan':'Tambah', cls:'', onclick:()=>{
      const keterangan = document.getElementById('f-kas-ket').value.trim();
      const jenis = document.getElementById('f-kas-jenis').value;
      const jumlah = getCurrencyValue(document.getElementById('f-kas-jumlah'));
      const tanggal = document.getElementById('f-kas-tanggal').value || todayISO();
      if(!keterangan){ toast('Keterangan wajib diisi'); return; }
      if(jumlah<=0){ toast('Jumlah wajib diisi'); return; }
      const debit = jenis === 'masuk' ? jumlah : 0;
      const kredit = jenis === 'keluar' ? jumlah : 0;
      let actionMsg = '';
      if(editing){
        actionMsg = `✏️ Edit kas: ${keterangan}`;
        Object.assign(editing, {keterangan, debit, kredit, tanggal});
      } else {
        actionMsg = `➕ Kas baru: ${keterangan}`;
        db.kas.push({id:uid(), keterangan, debit, kredit, tanggal, created_at:new Date().toISOString()});
      }
      saveDB(); closeModal(); renderContent(); toast('Disimpan');
      notifyTelegram(actionMsg, `${jenis==='masuk'?'Pemasukan':'Pengeluaran'}: ${fmtRp(jumlah)}\nTanggal: ${fmtDate(tanggal)}`, 'kas');
    }}
  ]);
  setTimeout(setupAllCurrencyInputs, 50);
}

async function hapusKas(id){
  if (!canEditSection('kas')) { toast(`⛔ Anda tidak memiliki akses untuk mengedit ${getOrgNamaKas()}`); return; }
  if (id && String(id).startsWith('auto-ds-')) { toast('🔒 Baris ini otomatis dari rekap Dana Sosial, kelola di menu Dana Sosial'); return; }
  if(!(await confirmModal('Hapus transaksi kas ini?'))) return;
  const k = db.kas.find(x=>x.id===id);
  db.kas = db.kas.filter(x=>x.id!==id);
  saveDB(); renderContent();
  if(k) notifyTelegram(`🗑️ Hapus kas: ${k.keterangan}`, 'kas');
}

function kasExportJSON(){
  const payload = {exportedAt: new Date().toISOString(), kas: db.kas};
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kas-backup-${todayISO()}.json`;
  a.click();
  toast('✅ Backup Kas berhasil diekspor.');
}

// Sama seperti gudangImportJSON: menulis langsung ke tabel kt_kas lewat upsert
// (bukan lewat saveDB()/syncArrayTable biasa), lalu memuat ulang kt_kas dari
// server supaya db.kas + _lastKnownIds/_lastKnownUpdatedAt (dipakai syncArrayTable
// buat deteksi konflik & delete-diff, lihat 03-db-core.js) tetap konsisten dengan
// server — bukan sekadar push ke memori lokal begitu saja.
function kasImportJSON(input){
  if(!canEditSection('kas')){ toast('🔒 Anda tidak memiliki akses untuk mengimpor data Kas.'); input.value=''; return; }
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async (e)=>{
    try{
      const parsed = JSON.parse(e.target.result);
      if(!Array.isArray(parsed.kas)) throw new Error('Format file backup tidak dikenali.');
      if(!(await confirmModal(`Import akan MENAMBAH ${parsed.kas.length} transaksi baru ke ${getOrgNamaKas()} (data lama tidak dihapus). Lanjutkan?`))) return;
      toast('⏳ Mengimpor data...');
      const rows = parsed.kas.map(k => {
        const debit = Number(k.debit||0), kredit = Number(k.kredit||0);
        if(!Number.isFinite(debit) || !Number.isFinite(kredit) || debit < 0 || kredit < 0 || (debit > 0 && kredit > 0) || (debit === 0 && kredit === 0)) throw new Error('Setiap transaksi harus punya tepat satu nominal debit atau kredit yang positif.');
        return {
        // Import adalah mode tambah: ID baru mencegah backup menimpa transaksi lama.
        id: uid(),
        tanggal: k.tanggal || todayISO(),
        keterangan: k.keterangan || '',
        debit, kredit,
        created_at: k.created_at || new Date().toISOString(),
      }; });
      const ins = await sb.from('kt_kas').upsert(rows, {onConflict:'id'});
      if(ins.error) throw new Error(ins.error.message);

      const res = await sb.from('kt_kas').select('*');
      if(res.error) throw new Error(res.error.message);
      db.kas = res.data || [];
      _lastKnownIds['kt_kas'] = new Set(db.kas.map(r=>r.id));
      _lastKnownUpdatedAt['kt_kas'] = new Map(db.kas.map(r=>[r.id, r.updated_at||null]));

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

