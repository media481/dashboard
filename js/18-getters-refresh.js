/* ============================================================
   HELPER FUNCTIONS
   ============================================================ */
function gAnggota(){ return db.anggota.filter(a=>a.event_id===eid()); }
function gDonatur(){ return db.donatur.filter(d=>d.event_id===eid()); }
function gTransaksiLain(){ return db.transaksiLain.filter(t=>t.event_id===eid()); }
function gOperasional(){ return db.operasional.filter(o=>o.event_id===eid()); }
function gLomba(){ return db.lomba.filter(l=>l.event_id===eid()); }
function gKebutuhan(lombaId){ return db.lombaKebutuhan.filter(k=>k.lomba_id===lombaId); }
function gHadiahKategori(){ return db.hadiahKategori.filter(h=>h.event_id===eid()); }
function gLombaHadiah(lombaId){ return db.lombaHadiah.filter(lh=>lh.lomba_id===lombaId); }
function gDaftarBelanjaHadiah(){ return db.daftarBelanjaHadiah.filter(b=>b.event_id===eid()); }
function gDaftarBelanjaPerlengkapan(){ return db.daftarBelanjaPerlengkapan.filter(b=>b.event_id===eid()); }
function gHadiahJalanSantai(){ return db.hadiahJalanSantai.filter(h=>h.event_id===eid()); }
function gDaftarBelanjaJalanSantai(){ return db.daftarBelanjaJalanSantai.filter(b=>b.event_id===eid()); }
function gJadwal(){ return db.jadwal.filter(j=>j.event_id===eid()); }
// Dana Sosial — TIDAK terikat event_id sama sekali (lihat js/22-dana-sosial.js).
function gDanaSosialAnggota(){ return db.danaSosialAnggota.slice().sort((a,b)=>a.nama.localeCompare(b.nama,'id',{sensitivity:'base'})); }
function gDanaSosialBayar(){ return db.danaSosialBayar; }
// Tautan Penting — TIDAK terikat event_id sama sekali (lihat js/24-bookmark.js).
function gBookmark(){ return db.bookmark.slice().sort((a,b)=>(a.judul||'').localeCompare(b.judul||'','id',{sensitivity:'base'})); }

/* ============================================================
   AUTO-REFRESH
   ============================================================ */
let _refreshInFlight = false;

function _refreshGuardOk(){
  if(_saveDBRunning || _hasPendingLocalChange) return false;
  if(document.hidden) return false;
  if(!navigator.onLine) return false;
  const overlay = document.getElementById('overlay');
  if(overlay && overlay.classList.contains('show')) return false;
  // Jangan refresh selagi user sedang fokus mengetik di field mana pun (input/
  // textarea/select) yang belum disimpan — banyak form di app ini (Surat
  // Undangan, Proposal, Jadwal Sinoman, dll) baru menulis ke `db` saat tombol
  // "Simpan" diklik, bukan per-keystroke. renderContent() yang dipicu
  // auto-refresh menggambar ulang field itu dari data TERAKHIR TERSIMPAN, jadi
  // ketikan yang belum disimpan bisa hilang kalau siklus 20 detik ini kebetulan
  // jalan di tengah-tengah user mengetik. Mekanisme focusInfo di renderContent()
  // cuma menjaga POSISI KURSOR, bukan ISI yang belum tersimpan, jadi guard ini
  // perlu dicek terpisah di sini.
  const activeEl = document.activeElement;
  if(activeEl && ['INPUT','TEXTAREA','SELECT'].includes(activeEl.tagName) && !activeEl.disabled) return false;
  return true;
}

async function refreshFromServer(){
  if(_refreshInFlight) return;
  if(!_refreshGuardOk()) return;
  _refreshInFlight = true;
  try{
    const fresh = await loadDB();
    // Kalau loadDB() gagal total (mis. sinyal putus sebentar di tengah siklus
    // refresh ini), `fresh` isinya database KOSONG (lihat _loadFailed di loadDB()).
    // JANGAN diterapkan — biarkan data yang sudah ada di layar tetap seperti
    // semula, dan biarkan siklus refresh berikutnya yang coba lagi.
    if(fresh._loadFailed) return;
    if(!_refreshGuardOk()) return;
    db = fresh;
    // Gudang punya penyimpanan/muat data sendiri (di luar db/loadDB, lihat
    // loadGudangData) karena awalnya modul terpisah. Sebelumnya modul ini TIDAK
    // ikut auto-refresh sama sekali — datanya cuma dimuat sekali di awal + lewat
    // tombol "Segarkan" manual, jadi stok yang tampil ke user bisa basi berjam-
    // jam kalau dipakai banyak orang sekaligus. Disertakan di sini (guard yang
    // sama: dilewati kalau ada modal terbuka/sedang menyimpan/offline) supaya
    // ikut ter-refresh tiap 20 detik seperti data lainnya.
    if(gudangLoaded) await loadGudangData();
    applyOrgBranding();
    renderSidebar();
    renderTopbarSaldo();
    renderContent();
  }catch(e){
    console.error('Auto-refresh gagal, akan dicoba lagi:', e);
  }finally{
    _refreshInFlight = false;
  }
}

const AUTO_REFRESH_INTERVAL_MS = 20000;

