/* Pendaftaran service worker.
   Dulu ini inline <script> di index.html; dipindah ke file terpisah supaya
   Content-Security-Policy di _headers tidak perlu membuka 'unsafe-inline'
   untuk script (lihat AUDIT-STANDAR-SAAS.md §7). */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.error('Gagal mendaftarkan service worker:', err);
    });
  });
}
