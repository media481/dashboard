/* ============================================================
   CURRENCY INPUT HELPER
   ============================================================ */
// Format angka dengan titik ribuan.
// PENTING: 0 adalah nilai VALID (mis. "Harga Realisasi: Rp 0" untuk barang
// sponsor/gratis) dan harus ditampilkan sebagai "0", BUKAN string kosong.
// String kosong ('') secara konsisten dipakai di seluruh app ini untuk
// makna "belum diisi sama sekali" (lihat mis. harga_realisasi di
// js/10-lomba.js yang membedakan field kosong = null vs field terisi
// angka apapun termasuk 0). Kalau formatCurrency(0) balikin '', kode
// pemanggil tidak bisa membedakan "sengaja diisi 0" dari "belum diisi",
// dan re-save form bisa diam-diam mengubah 0 yang sudah tersimpan jadi
// null lagi. Angka negatif TETAP ditolak (dianggap tidak valid, sama
// seperti sebelumnya) karena tidak ada field currency di app ini yang
// butuh nilai negatif — semua (tarif, harga, budget, jumlah kas dst)
// selalu bernilai 0 atau positif.
function formatCurrency(value) {
  if (value === undefined || value === null || value === '') return '';
  const num = typeof value === 'string' ? parseFloat(value.replace(/\./g, '').replace(/,/g, '')) : value;
  if (isNaN(num) || num < 0) return '';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/* ============================================================
   NORMALISASI & KEMIRIPAN NAMA BARANG — dipakai di seluruh app
   (Belanja Hadiah/Perlengkapan/Jalan Santai, sinkron harga item
   hadiah) supaya pengelompokan checklist per nama barang konsisten.
   ------------------------------------------------------------
   normNamaBarang: dulu banyak tempat cuma pakai .trim().toLowerCase(),
   jadi "Buku Tulis" dan "Buku  Tulis" (spasi ganda di tengah) dianggap
   barang BEDA padahal maksudnya sama. Di sini spasi berlebih di tengah
   ikut dirapikan jadi satu spasi, supaya keduanya digabung normal ke
   satu checklist/pack.
   namaBarangMirip: untuk kasus nama MIRIP TAPI MEMANG BEDA barang
   ("Buku Tulis" vs "Buku Tulis 38 Lembar") — ini SENGAJA TIDAK
   digabung otomatis (beda barang beneran), tapi dipakai untuk
   menampilkan peringatan "barang mirip terdeteksi" saat user
   menambah/mengedit nama item, supaya panitia bisa sadar & pilih
   mau samakan namanya persis (baru ikut tergabung) atau memang
   sengaja barang terpisah.
   ============================================================ */
function normNamaBarang(s){
  return String(s||'').trim().replace(/\s+/g,' ').toLowerCase();
}
function jarakLevenshtein(a,b){
  const m=a.length, n=b.length;
  if(m===0) return n; if(n===0) return m;
  const dp=Array.from({length:m+1},()=>new Array(n+1).fill(0));
  for(let i=0;i<=m;i++) dp[i][0]=i;
  for(let j=0;j<=n;j++) dp[0][j]=j;
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}
// true kalau a & b beda tapi cukup mirip untuk dicurigai maksudnya barang
// yang sama (typo tipis, atau salah satu adalah nama yang lain + keterangan
// tambahan di belakang, mis. "buku tulis" vs "buku tulis 38 lembar").
function namaBarangMirip(a,b){
  const na=normNamaBarang(a), nb=normNamaBarang(b);
  if(!na || !nb || na===nb) return false;
  if(na.startsWith(nb+' ') || nb.startsWith(na+' ')) return true;
  const jarak = jarakLevenshtein(na,nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen >= 4 && jarak <= 2;
}

// Parse angka dari format titik ribuan
function parseCurrency(value) {
  if (typeof value === 'string') {
    // Hapus semua titik (ribuan) dan koma (desimal), lalu konversi ke float
    return parseFloat(value.replace(/\./g, '').replace(/,/g, '.'));
  }
  return value;
}

// Setup input dengan format ribuan
function setupCurrencyInput(inputEl) {
  if (!inputEl) return;
  
  // Pastikan input memiliki class currency-input
  inputEl.classList.add('currency-input');
  
  // Set initial value if present
  const rawValue = inputEl.value.trim();
  if (rawValue) {
    const parsed = parseCurrency(rawValue);
    // >=0 (dulu >0): nilai 0 yang sudah ada di field (mis. dari value="0"
    // yang diset HTML) harus tetap ditampilkan sebagai "0", bukan dianggap
    // sama dengan tidak ada nilai sama sekali.
    if (!isNaN(parsed) && parsed >= 0) {
      inputEl.value = formatCurrency(parsed);
    }
  }
  
  // Event listener untuk formatting saat mengetik
  inputEl.addEventListener('input', function(e) {
    // Simpan posisi kursor
    const cursorPos = this.selectionStart;
    const oldLength = this.value.length;
    
    // Hapus semua titik dari nilai saat ini
    let raw = this.value.replace(/\./g, '');
    // Hanya angka yang diperbolehkan
    raw = raw.replace(/[^0-9]/g, '');
    
    if (raw === '') {
      this.value = '';
      return;
    }
    
    // Format dengan titik. Catatan: dulu formatCurrency(0) balikin '' di sini,
    // jadi field currency APAPUN langsung menghapus diri sendiri begitu user
    // mengetik angka 0 (mis. mengetik "0" untuk isi "Rp 0", atau mengetik
    // "1000" lalu backspace jadi "0") — user sama sekali tidak bisa mengisi
    // Rp 0 secara manual. Sekarang formatCurrency(0) balikin "0" dengan benar.
    const formatted = formatCurrency(parseInt(raw, 10));
    this.value = formatted;
    
    // Setel ulang posisi kursor
    const newLength = this.value.length;
    this.setSelectionRange(cursorPos + (newLength - oldLength), cursorPos + (newLength - oldLength));
  });
  
  // Saat blur, pastikan format benar
  inputEl.addEventListener('blur', function() {
    if (this.value === '') return;
    const raw = parseCurrency(this.value);
    // >=0 (dulu >0) supaya "0" yang sudah benar tampil dari handler input di
    // atas tetap dirapikan lewat formatCurrency saat blur, konsisten dengan
    // nilai lain — bukan cuma "kebetulan" sudah benar dari langkah sebelumnya.
    if (!isNaN(raw) && raw >= 0) {
      this.value = formatCurrency(raw);
    }
  });

  // Untuk nilai yang diset secara programatis
  const originalSetValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const setValue = function(value) {
    if (value !== undefined && value !== null && value !== '') {
      const num = typeof value === 'string' ? parseCurrency(value) : value;
      // >=0 (dulu >0): set terprogram ke 0 (mis. el.value = 0) harus tetap
      // diformat & ditampilkan sebagai "0", bukan jatuh ke jalur else di
      // bawah yang menampilkan angka mentah tanpa format.
      if (!isNaN(num) && num >= 0) {
        originalSetValue.set.call(this, formatCurrency(num));
        return;
      }
    }
    originalSetValue.set.call(this, value);
  };
  // Override value setter
  Object.defineProperty(inputEl, 'value', {
    get: function() { return originalSetValue.get.call(this); },
    set: setValue,
    configurable: true
  });
}

// Setup semua input dengan class currency-input di modal
function setupAllCurrencyInputs() {
  document.querySelectorAll('#modal-body .currency-input').forEach(el => {
    setupCurrencyInput(el);
  });
  document.querySelectorAll('#modal-body input[data-currency="true"]').forEach(el => {
    setupCurrencyInput(el);
  });
  document.querySelectorAll('#content .currency-input').forEach(el => {
    setupCurrencyInput(el);
  });
}

/* ============================================================
   AUTO-RESIZE TEXTAREA — tinggi textarea otomatis mengikuti jumlah
   baris teksnya (tumbuh ke bawah saat diketik/ditempel, menyusut lagi
   kalau teks dihapus), supaya user tidak perlu menyeret sudut textarea
   manual tiap kali isinya lebih panjang dari `rows` awal. Dipakai di
   Surat & Dokumen (14-dokumen.js) dan textarea lain (Jadwal, Agenda,
   Bookmark) lewat atribut data-autoresize="true" di elemennya.
   ------------------------------------------------------------
   PENTING: height direset ke 'auto' dulu sebelum baca scrollHeight —
   kalau tidak, scrollHeight yang kebaca adalah tinggi LAMA (sebelum
   teks dikurangi), jadi textarea nggak pernah menyusut waktu teks
   dihapus, cuma bisa membesar.
   ============================================================ */
function autoResizeTextarea(el){
  if(!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
function setupAutoResizeTextareas() {
  document.querySelectorAll('#content textarea[data-autoresize="true"], #modal-body textarea[data-autoresize="true"]').forEach(el => {
    if(el._autoResizeBound) { autoResizeTextarea(el); return; } // sudah pernah dipasang, cukup sesuaikan tinggi (mis. re-render dgn isi baru)
    el._autoResizeBound = true;
    el.style.overflowY = 'hidden';
    el.style.resize = 'none';
    el.addEventListener('input', () => autoResizeTextarea(el));
    autoResizeTextarea(el);
  });
}

// Helper untuk mendapatkan nilai numerik dari input format ribuan
function getCurrencyValue(inputEl) {
  if (!inputEl) return 0;
  const raw = inputEl.value.trim();
  if (!raw) return 0;
  const parsed = parseCurrency(raw);
  return isNaN(parsed) ? 0 : parsed;
}

// Helper untuk mengisi nilai input dengan format ribuan.
// Nilai 0 sengaja dibedakan dari null/undefined/'': 0 = "isi field dengan
// angka 0 yang valid", null/undefined/'' = "kosongkan field (belum diisi)".
function setCurrencyValue(inputEl, value) {
  if (!inputEl) return;
  if (value === undefined || value === null || value === '') {
    inputEl.value = '';
    return;
  }
  const num = typeof value === 'string' ? parseCurrency(value) : value;
  // <0 (dulu <=0): cuma nilai negatif/tidak valid yang ditolak sekarang,
  // 0 tetap ditampilkan sebagai "0" alih-alih dikosongkan.
  if (isNaN(num) || num < 0) {
    inputEl.value = '';
    return;
  }
  inputEl.value = formatCurrency(num);
}
