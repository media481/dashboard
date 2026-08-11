/* ============================================================
   SURAT & DOKUMEN
   Kumpulan dokumen siap cetak: Surat Undangan Kegiatan, Proposal
   Kegiatan, dan Form Absensi (berdasar Database Anggota). Draft
   teksnya disimpan di db.dokumenGlobal (kolom jsonb `dokumen` di
   tabel kt_dokumen_global — lihat supabase-dokumen-global-migration.sql,
   tidak perlu migrasi baru karena kolomnya jsonb bebas struktur).
   Pola cetaknya sama seperti LPJ: render di layar, lalu tombol
   "Cetak / Simpan sebagai PDF" yang memanggil window.print().

   Jadwal Sinoman (jadwal piket pagi/siang/sore, nama dipilih dari
   Database Anggota) dulu jadi salah satu tab di sini, TAPI sekarang
   sudah jadi menu tersendiri di sidebar (lihat SECTIONS/GLOBAL_MENU_KEYS
   di js/05-navigation.js, key 'jadwal-sinoman') — halaman penuh seperti
   LPJ/Daftar Anggota, bukan tab. Fungsi render-nya (renderJadwalSinoman
   dkk, di bawah ini) tetap di file ini karena masih pakai helper &
   struktur data yang sama seperti dokumen lain di sini.
   ============================================================ */
function nl2br(s){ return esc(s).replace(/\n/g, '<br>'); }

// Nama untuk dropdown Pagi/Siang/Sore di Jadwal Sinoman — diambil dari
// Database Anggota (bukan ketik bebas), sama seperti dropdown lain di app ini.
function dokumenDaftarNama(){
  const set = new Set();
  db.anggota.forEach(a => { if(a.nama && a.nama.trim()) set.add(a.nama.trim()); });
  return [...set].sort((a,b)=>a.localeCompare(b));
}
// (Dulu ada dokumenOptionsNama() untuk <select> native Pagi/Siang/Sore —
// sekarang diganti combo dropdown custom, lihat blok "COMBO DROPDOWN PESERTA
// JADWAL SINOMAN" di bawah, supaya senada dengan combo Koordinator Lomba.)

let _dokumenTab = 'undangan';
function gotoDokumenTab(tab){ _dokumenTab = tab; renderContent(); }

function renderDokumen(){
  // Berdiri sendiri seperti Gudang — tetap bisa dibuka walau belum ada
  // event aktif. `ev` di bawah cuma dipakai sebagai bantuan pra-isi teks
  // (nama kegiatan, rincian anggaran) kalau kebetulan ada event aktif.
  const ev = activeEvent();
  const tabs = [
    {key:'undangan', label:'📨 Surat Undangan'},
    {key:'proposal', label:'📋 Proposal Kegiatan'},
    {key:'absensi', label:'📝 Form Absensi'},
  ];
  const tabNav = `<div class="dokumen-tabs no-print">${tabs.map(t=>`<button type="button" class="dokumen-tab ${_dokumenTab===t.key?'active':''}" ${da('gotoDokumenTab', t.key)}>${t.label}</button>`).join('')}</div>`;
  let body = '';
  if(_dokumenTab==='proposal') body = renderProposalKegiatan(ev);
  else if(_dokumenTab==='absensi') body = renderFormAbsensi(ev);
  else body = renderSuratUndangan(ev);
  return tabNav + body;
}

/* ---------- 1. Surat Undangan Kegiatan ---------- */
// Membungkus form-isi (kiri) & pratinjau (kanan) supaya di layar lebar
// keduanya tampil berdampingan (lihat .dokumen-layout di style.css) — jadi
// tidak perlu scroll ke bawah untuk lihat hasil saat mengisi form. Di layar
// sempit/HP, CSS otomatis menumpuk keduanya secara vertikal seperti biasa.
// Kalau editForm kosong (guest, tidak login), pratinjau ditampilkan sendiri
// tanpa pembungkus grid, supaya tetap center seperti tampilan guest sebelumnya.
function wrapDokumenLayout(editFormHtml, previewHtml){
  if(!editFormHtml) return previewHtml;
  return `<div class="dokumen-layout">${editFormHtml}<div class="dokumen-preview-col">${previewHtml}</div></div>`;
}

function renderSuratUndangan(ev){
  const isLoggedIn = !!getCurrentUser();
  const d = getDokumenGlobal().undangan || {};
  const namaKegiatanDefault = d.nama_kegiatan || (ev ? ev.nama : '');
  const editForm = isLoggedIn ? `
  <div class="panel no-print">
    <div class="panel-head"><h3>✏️ Isi Data Surat Undangan</h3></div>
    <div class="panel-body">
      <div class="field-row">
        <div class="field"><label>Nomor Surat</label><input id="doc-und-nomor" value="${esc(d.nomor_surat||'')}" placeholder="001/KT-Inti/VII/2026" oninput="liveUndangan('nomor_surat', this.value)"></div>
        <div class="field"><label>Perihal</label><input id="doc-und-perihal" value="${esc(d.perihal||'')}" placeholder="Undangan Rapat Persiapan" oninput="liveUndangan('perihal', this.value)"></div>
      </div>
      <div class="field"><label>Nama Kegiatan</label><input id="doc-und-nama-kegiatan" value="${esc(namaKegiatanDefault)}" placeholder="Contoh: 17-an Tahun 2026" oninput="liveUndangan('nama_kegiatan', this.value)"></div>
      <div class="field"><label>Kepada Yth.</label><input id="doc-und-kepada" value="${esc(d.kepada||'')}" placeholder="Seluruh Warga RT 01-03 / Pengurus Karang Taruna" oninput="liveUndangan('kepada', this.value)"></div>
      <div class="field-row">
        <div class="field"><label>Hari, Tanggal</label><input id="doc-und-hari-tanggal" value="${esc(d.hari_tanggal||'')}" placeholder="Minggu, 17 Agustus 2026" oninput="liveUndangan('hari_tanggal', this.value)"></div>
        <div class="field"><label>Waktu</label><input id="doc-und-waktu" value="${esc(d.waktu||'')}" placeholder="19.30 WIB - selesai" oninput="liveUndangan('waktu', this.value)"></div>
      </div>
      <div class="field"><label>Tempat</label><input id="doc-und-tempat" value="${esc(d.tempat||'')}" placeholder="Balai Desa / Rumah Bapak RT 02" oninput="liveUndangan('tempat', this.value)"></div>
      <div class="field"><label>Acara</label><input id="doc-und-acara" value="${esc(d.acara||'')}" placeholder="Rapat persiapan ${esc(namaKegiatanDefault||'kegiatan')}" oninput="liveUndangan('acara', this.value)"></div>
      <div class="field"><label>Catatan Tambahan (opsional)</label><textarea id="doc-und-catatan" rows="3" data-autoresize="true" placeholder="Mohon hadir tepat waktu..." oninput="liveUndangan('catatan', this.value)">${esc(d.catatan||'')}</textarea></div>
      <div class="field-row">
        <div class="field"><label>Jabatan Penandatangan 1</label><input id="doc-und-jab1" value="${esc(d.jabatan1||'Ketua Panitia')}" oninput="liveUndangan('jabatan1', this.value)"></div>
        <div class="field"><label>Nama Penandatangan 1</label><input id="doc-und-nama1" value="${esc(d.nama1||'')}" oninput="liveUndangan('nama1', this.value)"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Jabatan Penandatangan 2</label><input id="doc-und-jab2" value="${esc(d.jabatan2||'Sekretaris')}" oninput="liveUndangan('jabatan2', this.value)"></div>
        <div class="field"><label>Nama Penandatangan 2</label><input id="doc-und-nama2" value="${esc(d.nama2||'')}" oninput="liveUndangan('nama2', this.value)"></div>
      </div>
      <div class="field-hint" style="color:var(--ink-soft); font-size:12.5px; margin-top:6px;">✅ Tersimpan otomatis saat Anda mengetik.</div>
    </div>
  </div>` : '';

  return wrapDokumenLayout(editForm, `
  <div class="lpj-scale-wrap" id="lpj-scale-wrap">
  <div class="lpj-print-area surat-print-area" id="lpj-print-area">
    <div class="lpj-header">
      <div class="lpj-header-inner">
        <img src="${esc(getOrgLogo())}" alt="Logo ${esc(getOrgNama())}" class="lpj-logo">
        <div class="lpj-header-text">
          <div class="lpj-eyebrow">${esc(getOrgNama())}</div>
          <h2>SURAT UNDANGAN</h2>
          <div class="lpj-sub" id="und-prev-nomor">${d.nomor_surat ? `Nomor: ${esc(d.nomor_surat)}` : 'Nomor: -'}</div>
        </div>
        <div class="lpj-header-spacer" aria-hidden="true"></div>
      </div>
    </div>

    <p class="surat-body">Perihal: <strong id="und-prev-perihal">${esc(d.perihal||'-')}</strong></p>
    <p class="surat-body">Kepada Yth.<br><strong id="und-prev-kepada">${esc(d.kepada||'-')}</strong><br>di Tempat</p>
    <p class="surat-body">Dengan hormat,</p>
    <p class="surat-body">Sehubungan dengan pelaksanaan kegiatan <strong id="und-prev-namakegiatan">${esc(d.nama_kegiatan||'-')}</strong>, kami mengundang Bapak/Ibu/Saudara/i untuk hadir pada:</p>
    <table class="lpj-table surat-detail-table">
      <tbody>
        <tr><td class="surat-detail-label">Hari, Tanggal</td><td>: <span id="und-prev-haritanggal">${esc(d.hari_tanggal||'-')}</span></td></tr>
        <tr><td class="surat-detail-label">Waktu</td><td>: <span id="und-prev-waktu">${esc(d.waktu||'-')}</span></td></tr>
        <tr><td class="surat-detail-label">Tempat</td><td>: <span id="und-prev-tempat">${esc(d.tempat||'-')}</span></td></tr>
        <tr><td class="surat-detail-label">Acara</td><td>: <span id="und-prev-acara">${esc(d.acara||'-')}</span></td></tr>
      </tbody>
    </table>
    <p class="surat-body" id="und-prev-catatan" style="${d.catatan ? '' : 'display:none'}">${d.catatan ? nl2br(d.catatan) : ''}</p>
    <p class="surat-body">Demikian undangan ini kami sampaikan. Atas perhatian dan kehadirannya kami ucapkan terima kasih.</p>

    <div class="lpj-signature">
      <div class="surat-ttd"><div id="und-prev-jab1">${esc(d.jabatan1||'Ketua Panitia')}</div><div class="surat-ttd-space"></div><div><strong id="und-prev-nama1">${esc(d.nama1||'(.....................)')}</strong></div></div>
      <div class="surat-ttd"><div id="und-prev-jab2">${esc(d.jabatan2||'Sekretaris')}</div><div class="surat-ttd-space"></div><div><strong id="und-prev-nama2">${esc(d.nama2||'(.....................)')}</strong></div></div>
    </div>
  </div>
  </div>
  ${isLoggedIn ? `<div class="lpj-toolbar no-print"><button class="btn small" onclick="window.print()">🖨️ Cetak / Simpan sebagai PDF</button></div>` : ''}`);
}

function setPrevText(id, text){ const el = document.getElementById(id); if(el) el.textContent = text; }

// Autosave: dipanggil langsung dari oninput tiap field form Undangan.
// Menyimpan ke db (lalu ke Supabase via saveDB() yang sudah di-debounce 400ms)
// TANPA renderContent(), supaya form tidak di-render ulang & fokus/kursor
// input tidak hilang saat user masih mengetik. Pratinjau surat di-update
// langsung lewat DOM (textContent) supaya tetap tampak realtime.
function liveUndangan(field, value){
  if (!canEditSection('dokumen')) { toast('⛔ Login untuk mengedit data'); return; }
  const s = getDokumenGlobal();
  s.undangan = s.undangan || {};
  s.undangan[field] = value;
  saveDB();

  if(field === 'nomor_surat') setPrevText('und-prev-nomor', value ? `Nomor: ${value}` : 'Nomor: -');
  else if(field === 'perihal') setPrevText('und-prev-perihal', value || '-');
  else if(field === 'kepada') setPrevText('und-prev-kepada', value || '-');
  else if(field === 'nama_kegiatan') setPrevText('und-prev-namakegiatan', value || '-');
  else if(field === 'hari_tanggal') setPrevText('und-prev-haritanggal', value || '-');
  else if(field === 'waktu') setPrevText('und-prev-waktu', value || '-');
  else if(field === 'tempat') setPrevText('und-prev-tempat', value || '-');
  else if(field === 'acara') setPrevText('und-prev-acara', value || '-');
  else if(field === 'catatan'){
    const el = document.getElementById('und-prev-catatan');
    if(el){
      if(value){ el.style.display=''; el.innerHTML = nl2br(value); }
      else { el.style.display='none'; el.innerHTML=''; }
    }
  }
  else if(field === 'jabatan1') setPrevText('und-prev-jab1', value || 'Ketua Panitia');
  else if(field === 'nama1') setPrevText('und-prev-nama1', value || '(.....................)');
  else if(field === 'jabatan2') setPrevText('und-prev-jab2', value || 'Sekretaris');
  else if(field === 'nama2') setPrevText('und-prev-nama2', value || '(.....................)');
}

/* ---------- 2. Proposal Kegiatan ---------- */
// Pratinjau Proposal ditampilkan sebagai beberapa LEMBAR A4 terpisah (Halaman 1,
// Halaman 2, dst — mirip mode "Print Layout" di Word/Google Docs), bukan cuma
// 1 kotak yang memanjang ke bawah. Triknya:
//   1. Seluruh isi dokumen dirender UTUH & mengalir apa adanya (tanpa dipotong)
//      di dalam elemen tersembunyi #lpj-print-source — elemen ini juga yang
//      dipakai browser saat Cetak/Simpan PDF (lihat .a4-print-source & aturan
//      lain punya class surat-print-area di style.css).
//   2. renderProposalA4Pages() mengukur tinggi elemen itu, membaginya per
//      kelipatan tinggi 1 halaman A4 (rasio 210:297 dari lebar render saat
//      ini), lalu untuk tiap halaman menampilkan "jendela" kotak berukuran
//      A4 yang isinya digeser ke atas (margin-top negatif) supaya cuma
//      menampilkan potongan konten milik halaman itu — hasilnya beberapa
//      kotak A4 terpisah di #lpj-print-area (class .a4-pages).
// Catatan: ini cuma potongan VISUAL untuk pratinjau di layar. Pembagian
// halaman yang sebenarnya saat dicetak/disimpan PDF tetap ditentukan browser
// dari #lpj-print-source (lebih akurat, menghormati page-break-avoid di
// style.css supaya judul/tabel tidak terpotong di tengah halaman) — jadi
// hasil cetak boleh beda 1-2 baris dari potongan pratinjau ini.
function renderProposalKegiatan(ev){
  const isLoggedIn = !!getCurrentUser();
  const d = getDokumenGlobal().proposal || {};
  const temaDefault = d.tema || (ev ? ev.nama : '');

  const editForm = isLoggedIn ? `
  <div class="panel no-print">
    <div class="panel-head"><h3>✏️ Isi Data Proposal</h3></div>
    <div class="panel-body">
      <div class="field"><label>Tema/Judul Kegiatan</label><input id="doc-prop-tema" value="${esc(temaDefault)}" placeholder="Contoh: 17-an Tahun 2026" oninput="liveProposal('tema', this.value)"></div>
      <div class="field"><label>Latar Belakang</label><textarea id="doc-prop-latar" rows="4" data-autoresize="true" placeholder="Uraikan alasan/konteks kegiatan ini diadakan..." oninput="liveProposal('latar_belakang', this.value)">${esc(d.latar_belakang||'')}</textarea></div>
      <div class="field"><label>Maksud &amp; Tujuan</label><textarea id="doc-prop-tujuan" rows="3" data-autoresize="true" placeholder="Satu tujuan per baris" oninput="liveProposal('tujuan', this.value)">${esc(d.tujuan||'')}</textarea></div>
      <div class="field"><label>Susunan Acara</label><textarea id="doc-prop-susunan" rows="4" data-autoresize="true" placeholder="Satu kegiatan per baris, mis: 19.30 - Pembukaan" oninput="liveProposal('susunan_acara', this.value)">${esc(d.susunan_acara||'')}</textarea></div>
      <div class="field"><label>Penutup (opsional)</label><textarea id="doc-prop-penutup" rows="2" data-autoresize="true" placeholder="Paragraf penutup, kosongkan untuk pakai kalimat baku" oninput="liveProposal('penutup', this.value)">${esc(d.penutup||'')}</textarea></div>
      <div class="field-row">
        <div class="field"><label>Jabatan Penandatangan 1</label><input id="doc-prop-jab1" value="${esc(d.jabatan1||'Ketua Panitia')}" oninput="liveProposal('jabatan1', this.value)"></div>
        <div class="field"><label>Nama Penandatangan 1</label><input id="doc-prop-nama1" value="${esc(d.nama1||'')}" oninput="liveProposal('nama1', this.value)"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Jabatan Penandatangan 2</label><input id="doc-prop-jab2" value="${esc(d.jabatan2||'Ketua Karang Taruna')}" oninput="liveProposal('jabatan2', this.value)"></div>
        <div class="field"><label>Nama Penandatangan 2</label><input id="doc-prop-nama2" value="${esc(d.nama2||'')}" oninput="liveProposal('nama2', this.value)"></div>
      </div>
      <div class="field-hint" style="color:var(--ink-soft); font-size:12.5px; margin-top:6px;">✅ Tersimpan otomatis saat Anda mengetik.</div>
    </div>
  </div>` : '';

  const contentHtml = proposalContentHtml(ev, d);

  return wrapDokumenLayout(editForm, `
  <div class="lpj-scale-wrap" id="lpj-scale-wrap">
    <div class="a4-pages no-print" id="lpj-print-area"></div>
  </div>
  <div class="lpj-print-area surat-print-area a4-print-source" id="lpj-print-source">${contentHtml}</div>
  <p class="field-hint no-print" style="color:var(--ink-soft); font-size:12.5px; text-align:center; margin-top:8px;">📄 Pratinjau dipecah per lembar A4 (lihat label "Halaman X dari Y") — pembagiannya perkiraan, hasil cetak/PDF asli bisa beda 1-2 baris karena judul &amp; tabel diusahakan tidak terpotong di tengah halaman.</p>
  ${isLoggedIn ? `<div class="lpj-toolbar no-print"><button class="btn small" onclick="window.print()">🖨️ Cetak / Simpan sebagai PDF</button></div>` : ''}`);
}

// Isi dokumen Proposal saja (tanpa pembungkus kotak/A4), dipakai ulang oleh
// renderProposalKegiatan() (render awal) dan refreshProposalPreview() (saat
// mengetik di form, lihat liveProposal()).
function proposalContentHtml(ev, d){
  d = d || {};
  const temaDefault = d.tema || (ev ? ev.nama : '');
  const b = hitungBukuUtama();
  const showDonatur = isMenuAktif('donatur');
  const showTransaksi = isMenuAktif('transaksi');
  const showOperasional = isMenuAktif('operasional');
  const showLomba = isMenuAktif('lomba');
  const showHadiah = isMenuAktif('hadiah');
  const showJalan = isMenuAktif('jalan_santai');
  const tujuanItems = (d.tujuan||'').split('\n').map(s=>s.trim()).filter(Boolean);
  const susunanItems = (d.susunan_acara||'').split('\n').map(s=>s.trim()).filter(Boolean);

  return `
    <div class="lpj-header">
      <div class="lpj-header-inner">
        <img src="${esc(getOrgLogo())}" alt="Logo ${esc(getOrgNama())}" class="lpj-logo">
        <div class="lpj-header-text">
          <div class="lpj-eyebrow">${esc(getOrgNama())}</div>
          <h2>PROPOSAL KEGIATAN</h2>
          <div class="lpj-sub">${esc(temaDefault||'-')}${ev ? ` — Tahun ${esc(String(ev.tahun))}` : ''}</div>
        </div>
        <div class="lpj-header-spacer" aria-hidden="true"></div>
      </div>
    </div>

    <h3>1. Latar Belakang</h3>
    <p class="surat-body">${d.latar_belakang ? nl2br(d.latar_belakang) : '<span class="hint">Belum diisi.</span>'}</p>

    <h3>2. Maksud &amp; Tujuan</h3>
    <div>${tujuanItems.length ? `<ul class="proposal-list">${tujuanItems.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="surat-body"><span class="hint">Belum diisi.</span></p>'}</div>

    <h3>3. Susunan Acara</h3>
    <div>${susunanItems.length ? `<ul class="proposal-list">${susunanItems.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="surat-body"><span class="hint">Belum diisi.</span></p>'}</div>

    <h3>4. Rencana Anggaran</h3>
    <p class="field-hint" style="color:var(--ink-soft); font-size:12.5px; margin:-4px 0 10px;">${ev ? 'Diambil otomatis dari data yang sudah tercatat di sistem saat ini — sesuaikan lewat menu terkait sebelum dicetak bila perlu.' : 'Belum ada event aktif dipilih di sidebar, jadi rincian di bawah masih menunjukkan Rp 0. Pilih event aktif dulu kalau ingin rincian anggaran terisi otomatis.'}</p>
    <table class="lpj-table">
      <tbody>
        <tr class="lpj-subtotal"><td>Rencana Pemasukan</td><td class="num">${fmtRp(b.pemasukan)}</td></tr>
        <tr><td class="indent">Iuran Anggota</td><td class="num">${fmtRp(b.iuran)}</td></tr>
        ${showDonatur ? `<tr><td class="indent">Donatur</td><td class="num">${fmtRp(b.donasi)}</td></tr>` : ''}
        ${showTransaksi ? `<tr><td class="indent">Pemasukan Lain</td><td class="num">${fmtRp(b.transaksiLain)}</td></tr>` : ''}
        <tr class="lpj-subtotal"><td>Rencana Pengeluaran</td><td class="num">${fmtRp(b.pengeluaran)}</td></tr>
        ${showOperasional ? `<tr><td class="indent">Operasional Kegiatan</td><td class="num">${fmtRp(b.opsional)}</td></tr>` : ''}
        ${showLomba ? `<tr><td class="indent">Kebutuhan Lomba</td><td class="num">${fmtRp(b.kebutuhanLomba)}</td></tr>` : ''}
        ${showHadiah ? `<tr><td class="indent">Hadiah Lomba</td><td class="num">${fmtRp(b.hadiahLomba)}</td></tr>` : ''}
        ${showJalan ? `<tr><td class="indent">Hadiah Jalan Santai</td><td class="num">${fmtRp(b.hadiahJalan)}</td></tr>` : ''}
        <tr class="lpj-total"><td>Selisih (Saldo)</td><td class="num">${fmtRp(b.saldo)}</td></tr>
      </tbody>
    </table>

    <h3>5. Penutup</h3>
    <p class="surat-body">${d.penutup ? nl2br(d.penutup) : `Demikian proposal kegiatan <strong>${esc(temaDefault||'ini')}</strong> ini kami susun. Besar harapan kami atas dukungan dan partisipasi semua pihak demi kelancaran acara ini.`}</p>

    <div class="lpj-signature">
      <div class="surat-ttd"><div>${esc(d.jabatan1||'Ketua Panitia')}</div><div class="surat-ttd-space"></div><div><strong>${esc(d.nama1||'(.....................)')}</strong></div></div>
      <div class="surat-ttd"><div>${esc(d.jabatan2||'Ketua Karang Taruna')}</div><div class="surat-ttd-space"></div><div><strong>${esc(d.nama2||'(.....................)')}</strong></div></div>
    </div>`;
}

// Memecah #lpj-print-source (dokumen utuh, tidak terpotong) jadi beberapa
// kotak "lembar" A4 di #lpj-print-area. Dipanggil setelah render awal (lihat
// hook di js/05-navigation.js), setelah resize (js/13-lpj.js), dan setelah
// tiap perubahan form (refreshProposalPreview di bawah). Aman dipanggil dari
// tab dokumen lain / section lain — langsung keluar kalau elemennya bukan
// milik pratinjau Proposal.
function renderProposalA4Pages(){
  const host = document.getElementById('lpj-print-area');
  const source = document.getElementById('lpj-print-source');
  if(!host || !source || !host.classList.contains('a4-pages')) return;
  const pageWidth = source.clientWidth;
  if(!pageWidth) return;
  // Margin atas-bawah pratinjau disamakan dengan margin @page saat cetak
  // (15mm, lihat aturan @media print di style.css) supaya potongan antar
  // halaman di layar terlihat rapi (ada jarak, tidak nempel/terpotong pas
  // di garis batas) dan kira-kira mendekati hasil cetak/PDF asli.
  const scale = pageWidth / 210; // px per mm (lebar kertas A4 = 210mm)
  const marginPx = Math.round(15 * scale);
  const pageHeight = pageWidth * (297 / 210); // tinggi kotak "kertas" penuh
  const usableHeight = pageHeight - (marginPx * 2); // tinggi konten yang ditampilkan per halaman, di luar margin atas-bawah
  const contentHeight = source.scrollHeight;
  const numPages = Math.max(1, Math.ceil(contentHeight / usableHeight));
  const contentHtml = source.innerHTML;
  let html = '';
  for(let i = 0; i < numPages; i++){
    html += `<div class="a4-page-wrap">
      <div class="a4-page" style="height:${pageHeight}px;">
        <div class="a4-page-clip" style="top:${marginPx}px; bottom:${marginPx}px;">
          <div class="a4-page-inner lpj-print-area surat-print-area" style="margin-top:-${i * usableHeight}px;">${contentHtml}</div>
        </div>
      </div>
      <div class="a4-page-label no-print">Halaman ${i + 1} dari ${numPages}</div>
    </div>`;
  }
  host.innerHTML = html;
}

let _proposalPreviewTimer = null;
// Autosave: sama seperti liveUndangan — simpan ke db + Supabase (debounced),
// lalu render ulang isi dokumen (proposalContentHtml) & paginasi A4-nya.
// Full re-render (bukan patch DOM per elemen seperti sebelumnya) sengaja
// dipilih karena isi dokumen sekarang digandakan ke beberapa halaman + 1
// sumber tersembunyi — patch id satu-satu jadi tidak cukup lagi. Di-debounce
// 150ms supaya tidak mengukur ulang tinggi halaman di setiap ketikan huruf.
function liveProposal(field, value){
  if (!canEditSection('dokumen')) { toast('⛔ Login untuk mengedit data'); return; }
  const s = getDokumenGlobal();
  s.proposal = s.proposal || {};
  s.proposal[field] = value;
  saveDB();
  refreshProposalPreview();
}
function refreshProposalPreview(){
  const source = document.getElementById('lpj-print-source');
  if(!source) return; // sedang tidak di tab Proposal
  source.innerHTML = proposalContentHtml(activeEvent(), getDokumenGlobal().proposal || {});
  clearTimeout(_proposalPreviewTimer);
  _proposalPreviewTimer = setTimeout(renderProposalA4Pages, 150);
}


/* ---------- 3. Form Absensi (dari Database Anggota) ---------- */
function renderFormAbsensi(ev){
  const isLoggedIn = !!getCurrentUser();
  const d = getDokumenGlobal().absensi || {};
  const judulDefault = d.judul || (ev ? ev.nama : '');
  const filterKategori = d.filter_kategori || '';
  const filterRT = d.filter_rt || '';
  // Kalau ada event aktif, tampilkan anggota event itu saja (roster tahunan).
  // Kalau tidak ada event aktif (menu ini kini berdiri sendiri), tampilkan
  // seluruh anggota dari semua event supaya form absensi tetap bisa dipakai.
  let list = (ev ? gAnggota() : db.anggota).slice().sort((a,b)=>a.nama.localeCompare(b.nama));
  if(filterKategori) list = list.filter(a=>a.kategori===filterKategori);
  if(filterRT) list = list.filter(a=>getRT(a)===filterRT);

  const editForm = isLoggedIn ? `
  <div class="panel no-print">
    <div class="panel-head"><h3>✏️ Pengaturan Form Absensi</h3></div>
    <div class="panel-body">
      ${!ev ? `<div class="field-hint" style="color:var(--ink-soft); font-size:12.5px; margin:-2px 0 8px;">Belum ada event aktif dipilih di sidebar, jadi daftar di bawah menampilkan anggota dari semua event. Pilih event aktif dulu kalau ingin daftar dipersempit ke roster tahun itu saja.</div>` : ''}
      <div class="field-row">
        <div class="field"><label>Judul Acara</label><input id="doc-abs-judul" value="${esc(judulDefault)}" placeholder="Contoh: 17-an Tahun 2026" oninput="liveAbsensi('judul', this.value)"></div>
        <div class="field"><label>Tanggal</label><input id="doc-abs-tanggal" type="date" value="${esc(d.tanggal||todayISO())}" onchange="liveAbsensi('tanggal', this.value)"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Filter Kategori</label>
          <select id="doc-abs-kategori" onchange="filterAbsensi()">
            <option value="">Semua Kategori</option>
            ${KATEGORI_ANGGOTA.map(k=>`<option value="${k.v}" ${filterKategori===k.v?'selected':''}>${esc(k.l)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Filter RT</label>
          <select id="doc-abs-rt" onchange="filterAbsensi()">
            <option value="">Semua RT</option>
            ${RT_LIST.map(r=>`<option value="${r.v}" ${filterRT===r.v?'selected':''}>${esc(r.l)}</option>`).join('')}
          </select>
        </div>
      </div>
      ${(filterKategori||filterRT) ? `<div class="field-hint" style="color:var(--orange); font-size:12.5px; margin-top:6px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">⚠️ Filter aktif (${[filterKategori?labelKategori(filterKategori):'', filterRT?labelRT(filterRT):''].filter(Boolean).join(' · ')}) — sebagian anggota sengaja disembunyikan dari daftar di bawah, dan filter ini tetap tersimpan sampai direset. <button class="btn secondary small" ${da('resetFilterAbsensi')}>↺ Reset Filter</button></div>` : `<div class="field-hint" style="color:var(--ink-soft); font-size:12.5px; margin-top:6px;">✅ Tersimpan otomatis saat Anda mengetik. Tidak ada filter aktif — daftar di bawah menampilkan semua anggota.</div>`}
    </div>
  </div>` : '';

  return wrapDokumenLayout(editForm, `
  <div class="lpj-scale-wrap" id="lpj-scale-wrap">
  <div class="lpj-print-area surat-print-area" id="lpj-print-area">
    <div class="lpj-header">
      <div class="lpj-header-inner">
        <img src="${esc(getOrgLogo())}" alt="Logo ${esc(getOrgNama())}" class="lpj-logo">
        <div class="lpj-header-text">
          <div class="lpj-eyebrow">${esc(getOrgNama())}</div>
          <h2>DAFTAR HADIR</h2>
          <div class="lpj-sub" id="abs-prev-judul">${esc(judulDefault||'-')}</div>
          <div class="lpj-meta">Tanggal: <span id="abs-prev-tanggal">${fmtDate(d.tanggal||todayISO())}</span>${filterKategori?` · Kategori: ${esc(labelKategori(filterKategori))}`:''}${filterRT?` · ${esc(labelRT(filterRT))}`:''}</div>
        </div>
        <div class="lpj-header-spacer" aria-hidden="true"></div>
      </div>
    </div>

    <table class="lpj-table absensi-table">
      <thead><tr><th style="width:36px;">No</th><th>Nama</th><th>RT</th><th>Tanda Tangan</th></tr></thead>
      <tbody>
        ${list.length ? list.map((a,i)=>`<tr><td class="num">${i+1}</td><td>${esc(a.nama)}</td><td>${esc(labelRT(a.rt))}</td><td class="absensi-ttd-cell"></td></tr>`).join('') : `<tr class="empty-row"><td colspan="4">Belum ada data anggota${filterKategori||filterRT?' yang cocok dengan filter ini':''}.</td></tr>`}
      </tbody>
    </table>
  </div>
  </div>
  ${isLoggedIn ? `<div class="lpj-toolbar no-print"><button class="btn small" onclick="window.print()">🖨️ Cetak / Simpan sebagai PDF</button></div>` : ''}`);
}

function filterAbsensi(){
  // Filter tampilan saja (tidak mengubah data), tapi tetap ditulis ke db.absensi
  // supaya filter tersimpan; batasi ke yang berhak edit dokumen supaya konsisten
  // dengan liveAbsensi dan tidak menimpa data kalau dipanggil manual dari console.
  if (!canEditSection('dokumen')) { toast('⛔ Login untuk mengedit data'); return; }
  const s = getDokumenGlobal();
  s.absensi = s.absensi || {};
  s.absensi.filter_kategori = document.getElementById('doc-abs-kategori').value;
  s.absensi.filter_rt = document.getElementById('doc-abs-rt').value;
  saveDB(); renderContent();
}
function resetFilterAbsensi(){
  // Filter RT/Kategori tersimpan permanen di dokumenGlobal.absensi, jadi kalau
  // lupa direset dia diam-diam menyembunyikan anggota di kunjungan berikutnya.
  // Tombol ini eksplisit mengosongkan kedua filter tersebut.
  if (!canEditSection('dokumen')) { toast('⛔ Login untuk mengedit data'); return; }
  const s = getDokumenGlobal();
  s.absensi = s.absensi || {};
  s.absensi.filter_kategori = '';
  s.absensi.filter_rt = '';
  saveDB(); renderContent();
  toast('Filter form absensi direset — semua anggota ditampilkan');
}
function liveAbsensi(field, value){
  if (!canEditSection('dokumen')) { toast('⛔ Login untuk mengedit data'); return; }
  const s = getDokumenGlobal();
  s.absensi = s.absensi || {};
  s.absensi[field] = value;
  saveDB();

  if(field === 'judul') setPrevText('abs-prev-judul', value || '-');
  else if(field === 'tanggal') setPrevText('abs-prev-tanggal', fmtDate(value||todayISO()));
}

/* ---------- 4. Jadwal Sinoman & Jadwal Petugas ----------
   Dua blok jadwal bawaan (piket pagi/siang/sore, dan petugas A/B/C) yang
   tampilannya SAMA PERSIS — cuma beda label kolom & key data — jadi
   dirender lewat satu set fungsi generik yang dipanggil per blockKey
   ('jadwal_sinoman'/'jadwal_petugas'). Selain 2 blok bawaan ini, user bisa
   menambah tabel tambahan sebanyak apa pun lewat tombol "+ Tambah Tabel" —
   disimpan di array s.jadwal_extra (format 3 kolom generik c1/c2/c3, label
   & subjudul full-editable, sama seperti 2 blok bawaan). blockKey untuk
   tabel tambahan berformat 'extra_<id>'. Fungsi getJadwalBlockData/
   getJadwalBlockFields adalah lapisan abstraksi supaya kode render & combo
   dropdown di bawah tidak perlu tahu apakah blockKey itu blok bawaan atau
   tabel tambahan. */
const JADWAL_BLOCKS = {
  jadwal_sinoman: {
    subLabel: 'Piket Sinoman (Pagi / Siang / Sore)',
    fields: [
      {key:'pagi', label:'Pagi'},
      {key:'siang', label:'Siang'},
      {key:'sore', label:'Sore'},
    ],
  },
  jadwal_petugas: {
    subLabel: 'Petugas',
    fields: [
      {key:'a', label:'Petugas A'},
      {key:'b', label:'Petugas B'},
      {key:'c', label:'Petugas C'},
    ],
  },
};
const JADWAL_EXTRA_FIELDS = [
  {key:'c1', label:'Kolom 1'},
  {key:'c2', label:'Kolom 2'},
  {key:'c3', label:'Kolom 3'},
];
// Judul acara & tempat dulunya disimpan terpisah per blok (jadwal_sinoman
// vs jadwal_petugas), padahal keduanya selalu satu acara yang sama —
// cuma beda divisi (piket vs petugas). Sekarang keduanya digabung jadi
// satu editor & satu kop cetak; sumber datanya tetap disimpan di
// s.jadwal_sinoman.judul/.tempat (dicermin ke jadwal_petugas biar data
// lama yang mungkin masih kebaca dari sana tetap sinkron).

function isJadwalExtraKey(blockKey){ return blockKey.indexOf('extra_')===0; }
function getJadwalExtraList(){
  const s = getDokumenGlobal();
  if(!s.jadwal_extra) s.jadwal_extra = [];
  return s.jadwal_extra;
}
function getJadwalBlockKeys(){
  // 'jadwal_sinoman' selalu tabel PERTAMA dan tidak bisa dihapus (lihat
  // renderJadwalBlockTableEdit — tombol hapus cuma dirender untuk tabel
  // ke-2 dst). 'jadwal_petugas' adalah tabel bawaan ke-2 yang SEKARANG bisa
  // dihapus user (ditandai flag .hidden, lihat jadwalRemoveBuiltinBlock) —
  // makanya di-filter di sini kalau sudah dihapus, sama seperti tabel extra.
  const s = getDokumenGlobal();
  const keys = ['jadwal_sinoman'];
  if(!(s.jadwal_petugas && s.jadwal_petugas.hidden)) keys.push('jadwal_petugas');
  keys.push(...getJadwalExtraList().map(e=>'extra_'+e.id));
  return keys;
}
function getJadwalBlockData(blockKey){
  if(isJadwalExtraKey(blockKey)) return getJadwalExtraList().find(e=>('extra_'+e.id)===blockKey);
  return getDokumenGlobal()[blockKey];
}
function getJadwalBlockFields(blockKey){
  if(isJadwalExtraKey(blockKey)) return JADWAL_EXTRA_FIELDS;
  return JADWAL_BLOCKS[blockKey].fields;
}
function getJadwalBlockDefaultSubLabel(blockKey){
  if(isJadwalExtraKey(blockKey)) return 'Tabel Tambahan';
  return JADWAL_BLOCKS[blockKey].subLabel;
}

// Teks subjudul tabel ("Piket Sinoman...", "Petugas") dan label tiap kolom
// ("Pagi"/"Siang"/"Sore", "Petugas A/B/C") bisa diketik manual per acara —
// nilainya disimpan di d.subLabel / d.fieldLabels[key], dengan fallback ke
// default kalau belum pernah diubah user.
function jadwalSubLabel(blockKey){
  const d = getJadwalBlockData(blockKey);
  return d.subLabel !== undefined ? d.subLabel : getJadwalBlockDefaultSubLabel(blockKey);
}
function jadwalFieldLabel(blockKey, fieldKey){
  const d = getJadwalBlockData(blockKey);
  if(d.fieldLabels && d.fieldLabels[fieldKey] !== undefined) return d.fieldLabels[fieldKey];
  return getJadwalBlockFields(blockKey).find(f=>f.key===fieldKey).label;
}

function jadwalAddExtraTable(){
  if (!canEditSection('jadwal-sinoman')) { toast('⛔ Login untuk mengedit data'); return; }
  const list = getJadwalExtraList();
  const emptyRow = {};
  JADWAL_EXTRA_FIELDS.forEach(f=>{ emptyRow[f.key] = ''; });
  list.push({ id: String(Date.now()), subLabel: '', fieldLabels: {}, rows: [emptyRow] });
  saveDB(); renderContent();
  toast('✅ Tabel baru ditambahkan');
}
async function jadwalRemoveExtraTable(id){
  if (!canEditSection('jadwal-sinoman')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!(await confirmModal('Hapus tabel tambahan ini beserta semua isinya?'))) return;
  const s = getDokumenGlobal();
  s.jadwal_extra = getJadwalExtraList().filter(e=>e.id!==id);
  saveDB(); renderContent();
}
// Menghapus tabel bawaan "Jadwal Petugas" (tabel ke-2). Tabel pertama
// (Jadwal Sinoman) sengaja TIDAK bisa dihapus — lihat renderJadwalBlockTableEdit,
// tombol hapus cuma dirender kalau blockKey bukan tabel pertama. Datanya
// tidak dibuang permanen, cuma ditandai .hidden supaya kalau suatu saat perlu
// dikembalikan, isian lama (kalau ada) tidak hilang.
async function jadwalRemoveBuiltinBlock(blockKey){
  if (!canEditSection('jadwal-sinoman')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!(await confirmModal('Hapus tabel ini beserta semua isinya?'))) return;
  const d = getJadwalBlockData(blockKey);
  if(!d) return;
  d.hidden = true;
  saveDB(); renderContent();
}

function renderJadwalSinoman(ev){
  const isLoggedIn = !!getCurrentUser();
  const editForm = isLoggedIn ? renderJadwalMergedEditForm(ev) : '';
  const printInner = renderJadwalMergedPrintInner(ev);

  return wrapDokumenLayout(editForm, `
  <div class="lpj-scale-wrap" id="lpj-scale-wrap">
  <div class="lpj-print-area surat-print-area js-f4-area" id="lpj-print-area">
    ${printInner}
  </div>
  </div>
  ${isLoggedIn ? `<div class="lpj-toolbar no-print"><button class="btn small" ${da('jadwalExportImage')}>🖼️ Download Gambar</button></div>` : ''}`);
}
// Export lembar Jadwal Sinoman jadi file PNG lewat html2canvas, dengan
// tampilan identik seperti pratinjau di layar (elemen di luar
// #lpj-print-area — form isian, tombol, dsb — otomatis tidak ikut ter-capture
// karena memang tidak ada di dalam elemen yang di-screenshot). Pola sama
// seperti export Nota Peminjaman Gudang (js/17c-gudang-histori-kelola.js).
async function jadwalExportImage(){
  const el = document.getElementById('lpj-print-area');
  if(!el){ toast('⛔ Gagal menemukan lembar Jadwal Sinoman'); return; }
  try {
    await ensureHtml2Canvas();
  } catch (e) {
    toast('⛔ Gagal memuat modul export gambar. Cek koneksi internet lalu muat ulang.');
    return;
  }
  toast('⏳ Membuat gambar...');
  html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true }).then(canvas => {
    const sD = getDokumenGlobal().jadwal_sinoman;
    const slug = (sD.judul || 'acara').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
    const link = document.createElement('a');
    link.download = `jadwal-sinoman-${slug || 'acara'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('⬇ Gambar berhasil diunduh');
  }).catch(err => {
    console.error('Gagal export gambar Jadwal Sinoman:', err);
    toast('⛔ Gagal membuat gambar: ' + (err.message||'error tak dikenal'));
  });
}

function renderJadwalMergedEditForm(ev){
  const sD = getDokumenGlobal().jadwal_sinoman;
  const judulDefault = sD.judul || (ev ? ev.nama : '');
  const tablesHtml = getJadwalBlockKeys().map(blockKey=>renderJadwalBlockTableEdit(blockKey)).join('');

  return `
  <div class="panel no-print">
    <div class="panel-head"><h3>✏️ Isi Jadwal Sinoman</h3></div>
    <div class="panel-body">
      <div class="field-row">
        <div class="field"><label>Judul Acara</label><input id="doc-js-judul" value="${esc(judulDefault)}" placeholder="Contoh: 17-an Tahun 2026" oninput="liveJadwalMerged('judul', this.value)"></div>
        <div class="field"><label>Tempat</label><input id="doc-js-tempat" value="${esc(sD.tempat||'')}" placeholder="Balai Desa / Rumah Bapak RT 02" oninput="liveJadwalMerged('tempat', this.value)"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Hari</label><input id="doc-js-hari" value="${esc(sD.hari||'')}" placeholder="Minggu" oninput="liveJadwalMerged('hari', this.value)"></div>
        <div class="field"><label>Tanggal</label><input type="date" id="doc-js-tanggal" value="${esc(sD.tanggal||'')}" oninput="liveJadwalMerged('tanggal', this.value)"></div>
      </div>
      <div class="field"><label>Nama Ketua Karang Taruna</label><input id="doc-js-nama-ketua" value="${esc(sD.nama_ketua||'')}" placeholder="cth. Budi Santoso" oninput="liveJadwalMerged('nama_ketua', this.value)"></div>
      <div class="field-hint" style="color:var(--ink-soft); font-size:12px; margin-top:2px;">Nama ini dipakai untuk teks pengesahan di bagian bawah lembar cetak.</div>

      <div class="field-hint" style="color:var(--ink-soft); font-size:12.5px; margin:16px 0 6px;">✅ Tersimpan otomatis saat Anda mengetik. Nama dipilih dari Database Anggota juga tersimpan otomatis.</div>
      ${tablesHtml}
      <button class="btn secondary small" style="margin-top:18px;" ${da('jadwalAddExtraTable')}>+ Tambah Tabel</button>
    </div>
  </div>`;
}

function renderJadwalBlockTableEdit(blockKey){
  const fields = getJadwalBlockFields(blockKey);
  const d = getJadwalBlockData(blockKey);
  const theadCells = fields.map(f=>`<th><input class="jadwal-th-input" value="${esc(jadwalFieldLabel(blockKey, f.key))}" placeholder="${esc(f.label)}" oninput="liveJadwalFieldLabel('${blockKey}', '${f.key}', this.value)" style="width:100%; border:none; background:transparent; font-weight:600; text-align:center; font-size:inherit; font-family:inherit; color:inherit; padding:2px;"></th>`).join('');
  const colgroupMiddle = fields.map(()=>'<col>').join('');

  const rowsEdit = d.rows.map((r,idx)=>{
    const cells = fields.map(f=>{
      const koordBadge = idx===0 ? `<span class="koord-badge">Koord</span>` : '';
      return `<td><div style="display:flex; align-items:center; gap:6px; min-width:0;"><div style="flex:1; min-width:0;">${blkComboTriggerHtml(blockKey, idx, f.key, r[f.key])}</div>${koordBadge}</div></td>`;
    }).join('');
    return `
    <tr>
      <td>${idx+1}</td>
      ${cells}
      <td style="width:36px;"><button class="icon-btn" ${da('jadwalBlockRemoveRow', blockKey, idx)} title="Hapus baris">✕</button></td>
    </tr>`;
  }).join('');

  // Tombol hapus tabel: SEMUA tabel bisa dihapus KECUALI tabel pertama
  // (jadwal_sinoman) — lihat getJadwalBlockKeys(), jadwal_sinoman selalu
  // berada di index 0. Tabel bawaan ke-2 (jadwal_petugas) dihapus lewat
  // jadwalRemoveBuiltinBlock(), tabel tambahan lewat jadwalRemoveExtraTable().
  const isFirstTable = blockKey === getJadwalBlockKeys()[0];
  let hapusTabelBtn = '';
  if(!isFirstTable){
    hapusTabelBtn = isJadwalExtraKey(blockKey)
      ? `<button class="icon-btn" ${da('jadwalRemoveExtraTable', blockKey.slice(6))} title="Hapus tabel ini">🗑️</button>`
      : `<button class="icon-btn" ${da('jadwalRemoveBuiltinBlock', blockKey)} title="Hapus tabel ini">🗑️</button>`;
  }

  return `
    <div style="display:flex; align-items:center; gap:8px; margin:18px 0 12px;">
      <input class="jadwal-subhead-input" id="doc-subhead-${blockKey}" value="${esc(jadwalSubLabel(blockKey))}" placeholder="Judul bagian, mis. Piket Sinoman" oninput="liveJadwalSubLabel('${blockKey}', this.value)" style="flex:1; min-width:0; font-weight:600; border:none; border-bottom:1px dashed var(--line); background:transparent; font-size:12.5px; font-family:inherit; color:inherit; padding:4px 0;">
      ${hapusTabelBtn}
    </div>
    <table class="lpj-table js-edit-table">
      <colgroup><col style="width:36px;">${colgroupMiddle}<col style="width:36px;"></colgroup>
      <thead><tr><th></th>${theadCells}<th></th></tr></thead>
      <tbody>${rowsEdit}</tbody>
    </table>
    <button class="btn secondary small" ${da('jadwalBlockAddRow', blockKey)}>+ Tambah Baris</button>`;
}

function renderJadwalMergedPrintInner(ev){
  const sD = getDokumenGlobal().jadwal_sinoman;
  const judulDefault = sD.judul || (ev ? ev.nama : '');
  const tablesHtml = getJadwalBlockKeys().map(blockKey=>renderJadwalBlockTablePrint(blockKey)).join('');
  const hariTanggalText = jadwalHariTanggalText(sD);

  return `
    <div class="lpj-header">
      <div class="lpj-header-inner">
        <img src="${esc(getOrgLogo())}" alt="Logo ${esc(getOrgNama())}" class="lpj-logo">
        <div class="lpj-header-text">
          <div class="lpj-eyebrow">${esc(getOrgNama())}</div>
          <h2>JADWAL SINOMAN</h2>
          <div class="lpj-sub" id="js-prev-judul">${esc(judulDefault||'-')}</div>
          <div class="lpj-meta" id="js-prev-tempat">${sD.tempat ? `Tempat: ${esc(sD.tempat)}` : ''}</div>
          <div class="lpj-meta" id="js-prev-haritanggal">${esc(hariTanggalText)}</div>
        </div>
        <div class="lpj-header-spacer" aria-hidden="true"></div>
      </div>
    </div>

    ${tablesHtml}

    <div class="lpj-signature" style="justify-content:flex-end;">
      <div class="surat-ttd">
        <div>Ditetapkan oleh Ketua Karang Taruna</div>
        <div class="surat-ttd-space" style="height:26px;"></div>
        <div><strong id="js-prev-nama-ketua">${esc(sD.nama_ketua||'(.....................)')}</strong></div>
      </div>
    </div>`;
}
// Gabungan teks "Hari, Tanggal" untuk baris meta di kop cetak — Hari
// (bebas ketik) dan Tanggal (date picker, diformat lewat fmtDate) bisa diisi
// salah satu saja atau keduanya. Mengembalikan teks MENTAH (belum di-esc)
// supaya bisa dipakai baik lewat esc() di template HTML awal, maupun lewat
// textContent (setPrevText) saat live update — textContent sudah otomatis
// aman dari HTML injection tanpa perlu esc lagi.
function jadwalHariTanggalText(sD){
  const parts = [];
  if(sD.hari) parts.push(sD.hari);
  if(sD.tanggal) parts.push(fmtDate(sD.tanggal));
  return parts.join(', ');
}

function renderJadwalBlockTablePrint(blockKey){
  const fields = getJadwalBlockFields(blockKey);
  const d = getJadwalBlockData(blockKey);
  const theadCells = fields.map(f=>`<th id="js-print-th-${blockKey}-${f.key}">${esc(jadwalFieldLabel(blockKey, f.key))}</th>`).join('');
  const rowsPrint = d.rows.map((r,idx)=>{
    const cells = fields.map(f=>{
      const val = r[f.key];
      if(!val) return `<td>-</td>`;
      const koordBadge = idx===0 ? `<span class="koord-badge">Koord</span>` : '';
      return `<td>${esc(val)}${koordBadge}</td>`;
    }).join('');
    return `<tr><td>${idx+1}</td>${cells}</tr>`;
  }).join('');

  return `
    <div class="jadwal-print-subhead" id="js-print-subhead-${blockKey}" style="font-weight:600; font-size:12.5px; margin:26px 0 12px;">${esc(jadwalSubLabel(blockKey))}</div>
    <table class="lpj-table js-print-table">
      <thead><tr><th style="width:60px;">No</th>${theadCells}</tr></thead>
      <tbody>${rowsPrint || `<tr class="empty-row"><td colspan="${fields.length+1}">Belum ada jadwal diisi.</td></tr>`}</tbody>
    </table>`;
}

function liveJadwalMerged(field, value){
  if (!canEditSection('jadwal-sinoman')) { toast('⛔ Login untuk mengedit data'); return; }
  const s = getDokumenGlobal();
  s.jadwal_sinoman[field] = value;
  s.jadwal_petugas[field] = value;
  saveDB();

  if(field === 'judul') setPrevText('js-prev-judul', value || '-');
  else if(field === 'tempat') setPrevText('js-prev-tempat', value ? `Tempat: ${value}` : '');
  else if(field === 'hari' || field === 'tanggal') setPrevText('js-prev-haritanggal', jadwalHariTanggalText(s.jadwal_sinoman));
  if(field === 'nama_ketua') setPrevText('js-prev-nama-ketua', value || '(.....................)');
}
function liveJadwalSubLabel(blockKey, value){
  if (!canEditSection('jadwal-sinoman')) { toast('⛔ Login untuk mengedit data'); return; }
  const d = getJadwalBlockData(blockKey);
  if(!d) return;
  d.subLabel = value;
  saveDB();
  setPrevText(`js-print-subhead-${blockKey}`, value || '');
}
function liveJadwalFieldLabel(blockKey, fieldKey, value){
  if (!canEditSection('jadwal-sinoman')) { toast('⛔ Login untuk mengedit data'); return; }
  const d = getJadwalBlockData(blockKey);
  if(!d) return;
  if(!d.fieldLabels) d.fieldLabels = {};
  d.fieldLabels[fieldKey] = value;
  saveDB();
  setPrevText(`js-print-th-${blockKey}-${fieldKey}`, value || '');
}
function jadwalBlockSetCell(blockKey, idx, field, value){
  if (!canEditSection('jadwal-sinoman')) { toast('⛔ Login untuk mengedit data'); return; }
  const d = getJadwalBlockData(blockKey);
  if(!d || !d.rows[idx]) return;
  d.rows[idx][field] = value;
  saveDB();
}
function jadwalBlockAddRow(blockKey){
  if (!canEditSection('jadwal-sinoman')) { toast('⛔ Login untuk mengedit data'); return; }
  const fields = getJadwalBlockFields(blockKey);
  const d = getJadwalBlockData(blockKey);
  if(!d) return;
  const emptyRow = {};
  fields.forEach(f=>{ emptyRow[f.key] = ''; });
  d.rows.push(emptyRow);
  saveDB(); renderContent();
}
function jadwalBlockRemoveRow(blockKey, idx){
  if (!canEditSection('jadwal-sinoman')) { toast('⛔ Login untuk mengedit data'); return; }
  const d = getJadwalBlockData(blockKey);
  if(!d || d.rows.length<=1) return;
  d.rows.splice(idx,1);
  saveDB(); renderContent();
}

/* ============================================================
   COMBO DROPDOWN NAMA (pengganti <select> native) — Jadwal Sinoman &
   Jadwal Petugas. Tombol trigger + panel melayang + kolom cari, mengikuti
   pola yang sama dipakai combo Koordinator Lomba (js/10-lomba.js) supaya
   senada tema app. Nama yang sudah dipakai di slot LAIN ditampilkan
   nonaktif dengan badge "Sudah dipilih" — meniru pola combo pilih Barang
   Gudang (js/17b-gudang-pinjam.js) — supaya satu orang tidak bisa kepilih
   dobel di lebih dari satu slot. Cakupan "sudah dipakai" dibatasi PER BLOK
   (Jadwal Sinoman dan Jadwal Petugas dicek terpisah, bukan gabungan),
   karena keduanya mewakili kegiatan yang berbeda.
   Satu set fungsi generik ini dipakai untuk KEDUA blok, dibedakan lewat
   parameter blockKey ('jadwal_sinoman'/'jadwal_petugas'). */
function blkComboIconChevron(){
  return `<svg class="combo-chevron" width="15" height="15" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function blkComboIconSearch(){
  return `<svg width="15" height="15" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" fill="none"/><path d="m21 21-4.34-4.34" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;
}
function blkComboIconCheck(){
  return `<svg class="combo-check" width="15" height="15" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function blkComboTriggerHtml(blockKey, idx, field, value){
  return `<div class="field combo" style="margin-bottom:0; position:relative;">
    <button type="button" id="blk-combo-trigger-${blockKey}-${idx}-${field}" class="combo-trigger blk-combo-trigger${value?'':' placeholder'}" ${da('toggleBlkCombo', blockKey, idx, field)}>
      <span class="combo-trigger-label">${value ? esc(value) : '-- Pilih Nama --'}</span>
      ${blkComboIconChevron()}
    </button>
  </div>`;
}
// Nama yang sudah dipakai di slot LAIN dalam blok yang SAMA (bukan idx+field
// yang sedang dibuka) — dikumpulkan dari semua baris & kolom blok ini saja.
// Nilai spesial BLK_SEMUA_ANGGOTA sengaja TIDAK dimasukkan ke set ini, supaya
// tetap bisa dipilih berkali-kali di slot mana pun (bukan "nama orang" yang
// harus unik per slot — lihat blkComboSemuaAnggotaOptionHtml).
function blkComboNamaDipakai(blockKey, excludeIdx, excludeField){
  const fields = getJadwalBlockFields(blockKey);
  const rows = getJadwalBlockData(blockKey).rows;
  const set = new Set();
  rows.forEach((r,idx)=>{
    fields.forEach(f=>{
      if(idx===excludeIdx && f.key===excludeField) return;
      if(r[f.key] && r[f.key]!==BLK_SEMUA_ANGGOTA) set.add(r[f.key]);
    });
  });
  return set;
}
let _blkComboOpenKey = null; // format `${blockKey}-${idx}-${field}`
let _blkComboPanelEl = null;
let _blkComboSearch = '';
function blkComboPositionPanel(trigger, panel){
  const rect = trigger.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const panelWidth = Math.min(vw - 16, Math.max(rect.width, 260));
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
// Opsi spesial "Semua Anggota" — untuk kasus 1 shift piket butuh SEMUA
// anggota turun (bukan cuma 1-3 orang seperti biasa). Nilainya disimpan apa
// adanya sebagai teks "Semua Anggota" di sel tabel (sama seperti nama biasa
// atau nama manual), jadi tidak perlu ubah struktur data — cukup ditandai
// khusus di blkComboNamaDipakai supaya boleh dipilih di banyak slot sekaligus.
const BLK_SEMUA_ANGGOTA = 'Semua Anggota';
function blkComboSemuaAnggotaOptionHtml(blockKey, idx, field, selectedNama){
  const key = _blkComboSearch.trim().toLowerCase();
  if(key && !BLK_SEMUA_ANGGOTA.toLowerCase().includes(key)) return '';
  const isSelected = selectedNama === BLK_SEMUA_ANGGOTA;
  return `<button type="button" class="combo-option combo-option-special${isSelected?' selected':''}" ${da('selectBlkComboNama', blockKey, idx, field, BLK_SEMUA_ANGGOTA)}>
      <span class="combo-option-main"><span class="combo-option-name">👥 ${BLK_SEMUA_ANGGOTA}</span></span>
      <span class="combo-option-side">${isSelected?blkComboIconCheck():''}</span>
    </button>`;
}
// Nama manual di luar Database Anggota — untuk kasus petugas piket yang
// bukan anggota Karang Taruna (warga tambahan, tamu, dsb). User cukup
// mengetik nama di kolom cari; kalau nama itu belum ada persis di Database
// Anggota, muncul opsi "Gunakan nama ini" yang menyimpan teks ketikan apa
// adanya (bukan dari daftar), sama seperti nama dari database.
function blkComboManualOptionHtml(blockKey, idx, field){
  const raw = _blkComboSearch.trim();
  if(!raw) return '';
  if(raw.toLowerCase()===BLK_SEMUA_ANGGOTA.toLowerCase()) return '';
  const names = dokumenDaftarNama();
  const sudahAdaPersis = names.some(n=>n.toLowerCase()===raw.toLowerCase());
  if(sudahAdaPersis) return '';
  return `<button type="button" class="combo-option combo-option-manual" ${da('selectBlkComboNama', blockKey, idx, field, raw)}>
      <span class="combo-option-main"><span class="combo-option-name">✏️ Gunakan "${esc(raw)}" (nama manual, bukan anggota)</span></span>
    </button>`;
}
function blkComboOptionsHtml(blockKey, idx, field){
  const names = dokumenDaftarNama();
  const d = getJadwalBlockData(blockKey);
  const selectedNama = (d.rows[idx] && d.rows[idx][field]) || '';
  const dipakai = blkComboNamaDipakai(blockKey, idx, field);
  const key = _blkComboSearch.trim().toLowerCase();
  const filtered = key ? names.filter(n=>n.toLowerCase().includes(key)) : names;
  const optionsHtml = filtered.map(n=>{
    const isSelected = n===selectedNama;
    const nonAktif = dipakai.has(n) && !isSelected;
    return `<button type="button" class="combo-option${nonAktif?' disabled':''}${isSelected?' selected':''}"
      ${nonAktif?'disabled':da('selectBlkComboNama', blockKey, idx, field, n)}>
      <span class="combo-option-main"><span class="combo-option-name">${esc(n)}</span></span>
      <span class="combo-option-side">${nonAktif?'<span class="badge stok-habis">Sudah dipilih</span>':''}${isSelected?blkComboIconCheck():''}</span>
    </button>`;
  }).join('');
  const manualHtml = blkComboManualOptionHtml(blockKey, idx, field);
  const semuaAnggotaHtml = blkComboSemuaAnggotaOptionHtml(blockKey, idx, field, selectedNama);
  const clearHtml = selectedNama ? `<button type="button" class="combo-option" ${da('selectBlkComboNama', blockKey, idx, field, '')}>
      <span class="combo-option-main"><span class="combo-option-name" style="color:var(--ink-soft);">— Kosongkan pilihan —</span></span>
    </button>` : '';
  return clearHtml + semuaAnggotaHtml + manualHtml + (optionsHtml || `<div class="combo-empty">${key ? ((manualHtml||semuaAnggotaHtml) ? '' : 'Tidak ditemukan.') : 'Belum ada data di Database Anggota.'}</div>`);
}
function blkComboPanelHtml(blockKey, idx, field){
  return `
    <div class="combo-search-wrap">
      <span class="combo-search-icon">${blkComboIconSearch()}</span>
      <input type="text" class="combo-search-input" placeholder="Cari nama anggota, atau ketik nama manual..." value="${esc(_blkComboSearch)}" oninput="onBlkComboSearch('${blockKey}', ${idx}, '${field}', this.value)">
    </div>
    <div class="combo-list" data-combo-list>${blkComboOptionsHtml(blockKey, idx, field)}</div>`;
}
function toggleBlkCombo(blockKey, idx, field){
  const key = `${blockKey}-${idx}-${field}`;
  const trigger = document.getElementById(`blk-combo-trigger-${key}`);
  if(!trigger) return;
  if(_blkComboOpenKey === key){ closeAllBlkCombos(); return; }
  closeAllBlkCombos();
  _blkComboSearch = '';
  const panel = document.createElement('div');
  panel.className = 'combo-panel combo-panel-floating';
  panel.id = 'blk-combo-floating';
  panel.innerHTML = blkComboPanelHtml(blockKey, idx, field);
  document.body.appendChild(panel);
  blkComboPositionPanel(trigger, panel);
  requestAnimationFrame(()=>{
    panel.classList.add('show');
    const input = panel.querySelector('.combo-search-input');
    if(input) input.focus();
  });
  trigger.classList.add('open');
  _blkComboOpenKey = key;
  _blkComboPanelEl = panel;
}
function closeAllBlkCombos(){
  if(_blkComboPanelEl){ _blkComboPanelEl.remove(); _blkComboPanelEl = null; }
  document.querySelectorAll('.blk-combo-trigger.open').forEach(t=>t.classList.remove('open'));
  _blkComboOpenKey = null;
}
function onBlkComboSearch(blockKey, idx, field, value){
  _blkComboSearch = value;
  if(!_blkComboPanelEl) return;
  const list = _blkComboPanelEl.querySelector('[data-combo-list]');
  if(list) list.innerHTML = blkComboOptionsHtml(blockKey, idx, field);
}
function selectBlkComboNama(blockKey, idx, field, value){
  jadwalBlockSetCell(blockKey, idx, field, value);
  closeAllBlkCombos();
  renderContent();
}
document.addEventListener('click', (e)=>{
  if(e.target.closest('.combo-panel-floating') || e.target.closest('.blk-combo-trigger')) return;
  closeAllBlkCombos();
});
window.addEventListener('resize', ()=>{
  if(_blkComboOpenKey===null || !_blkComboPanelEl) return;
  const trigger = document.getElementById(`blk-combo-trigger-${_blkComboOpenKey}`);
  if(!trigger || !document.body.contains(trigger)){ closeAllBlkCombos(); return; }
  blkComboPositionPanel(trigger, _blkComboPanelEl);
});
document.addEventListener('keydown', (e)=>{
  if(e.key==='Escape') closeAllBlkCombos();
});
