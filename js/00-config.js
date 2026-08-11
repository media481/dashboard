/* ============================================================
   SUPABASE CONFIG
   Ganti dengan Project URL dan anon public key dari
   Supabase Dashboard > Project Settings > API
   ============================================================ */
const SUPABASE_URL = 'https://tykahltxzlpctfqdylno.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5a2FobHR4emxwY3RmcWR5bG5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMTgxNzQsImV4cCI6MjA5NzY5NDE3NH0.QVu9Y6lPr42MITzPM5SvNczbQ8_X0usPH78e4Nj2Epc';
// PENTING: paksa SEMUA request Supabase (select/insert/update/rpc, dll) untuk
// tidak pernah diam-diam dijawab dari cache manapun (browser, WebView Android,
// atau proxy jaringan operator seluler). Tanpa ini, `cache:'no-store'` di sw.js
// TIDAK berlaku karena Supabase beda origin dari app (sw.js cuma pegang
// request same-origin) — jadi request ke Supabase murni ikut aturan HTTP
// cache bawaan browser/jaringan. Dengan override fetch ini, Supabase selalu
// jadi SATU-SATUNYA sumber kebenaran data setiap kali dipanggil, tidak ada
// kemungkinan data lama "nyangkut" dan bikin konflik antar device.
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    fetch: (url, options = {}) => {
      // PENTING: options.headers yang dikirim Supabase internal berupa objek
      // `Headers`, BUKAN plain object. Spread `{ ...options.headers }` tidak
      // bisa membaca isi `Headers` (datanya disimpan secara internal, bukan
      // enumerable property biasa), sehingga hasilnya jadi `{}` kosong dan
      // header `apikey` + `Authorization` yang sudah disiapkan Supabase malah
      // KEBUANG sebelum request dikirim -> semua request jadi 401 Unauthorized
      // "No apikey request header found". Pakai constructor `Headers` di sini
      // supaya isi header (dari instance Headers, plain object, atau array
      // pairs manapun) benar-benar ter-copy.
      const mergedHeaders = new Headers(options.headers || {});
      mergedHeaders.set('Cache-Control', 'no-cache');
      // Kirim token sesi login (kalau ada) di setiap request Supabase, supaya
      // RLS policy & RPC di server (session_is_logged_in()/session_is_admin())
      // bisa memverifikasi siapa pemanggilnya. Tanpa ini, semua request tetap
      // ikut header apikey/Authorization anon key seperti biasa -- token sesi
      // ini murni tambahan, bukan pengganti anon key.
      try{
        const token = localStorage.getItem('kt_session_token');
        if(token) mergedHeaders.set('x-session-token', token);
      }catch(e){}
      return fetch(url, {
        ...options,
        cache: 'no-store',
        headers: mergedHeaders,
      });
    },
  },
});

/* ============================================================
   GLOBAL ERROR HANDLER
   ============================================================
   Sebelumnya kalau ada error JS tak terduga (bug/null-reference/typo/dll) yang
   lolos dari try/catch manapun, tidak ada apa pun yang memberi tahu user — app
   kelihatan "diam"/hang padahal sebenarnya lagi crash di belakang layar tanpa
   sepengetahuan siapa pun.
   Ini menangkap SEMUA error yang tidak tertangkap (baik error sinkron biasa lewat
   'error', maupun Promise yang reject tanpa .catch() lewat 'unhandledrejection'),
   dicatat ke console untuk ditelusuri developer, dan user diberi tahu lewat toast
   supaya tahu harus muat ulang halaman — bukan mengira app-nya nge-hang.
   Diletakkan di paling atas file supaya aktif sedini mungkin, sebelum kode lain
   di bawahnya sempat dieksekusi.
*/
let _lastGlobalErrorToast = 0;
let _globalErrorCount = 0;

function _reportGlobalError(label, err){
  console.error(label, err);
  const msg = (err && (err.message || String(err))) || String(err || '');
  // Beberapa "error" browser sebenarnya cuma warning tidak berbahaya (mis. dipicu
  // browser saat resize cepat) — jangan sampai menakut-nakuti user dengan itu.
  if(/ResizeObserver loop/i.test(msg)) return;

  _globalErrorCount++;
  const now = Date.now();
  // Maksimal 1 toast tiap 8 detik: kalau error yang sama terjadi berulang-ulang
  // (mis. dipicu tiap kali render), user tidak dibanjiri notifikasi bertumpuk.
  if(now - _lastGlobalErrorToast < 8000) return;
  _lastGlobalErrorToast = now;
  try{
    toast(`⚠️ Terjadi kesalahan tak terduga di aplikasi${_globalErrorCount > 1 ? ` (${_globalErrorCount}x)` : ''}. Kalau tampilan tidak merespons, coba muat ulang halaman.`, 6000);
  }catch(toastErr){
    // Kalau toast sendiri gagal (mis. dipanggil sebelum DOM siap), jangan sampai
    // bikin error baru yang memicu handler ini lagi (potensi loop tak berujung).
    console.error('Gagal menampilkan toast error:', toastErr);
  }
}

window.addEventListener('error', (event) => {
  _reportGlobalError('Uncaught error:', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  _reportGlobalError('Unhandled promise rejection:', event.reason);
});

