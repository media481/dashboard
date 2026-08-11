/* ============================================================
   EVENT DELEGATION CORE
   ------------------------------------------------------------
   TAHAP 1 dari refactor "hapus onclick inline di template string".
   Lihat REFACTOR-EVENT-DELEGATION.md di root repo untuk progres,
   daftar modul yang sudah/belum dimigrasi, dan cara lanjut di sesi lain.

   MASALAH LAMA:
   Hampir semua render*() menghasilkan HTML lewat template string
   dengan onclick="fn('${x}')" inline. Ini rawan bug escaping quote
   (nama anggota yang mengandung tanda kutip bisa merusak HTML), dan
   setiap browser modern akan memblokir onclick inline kalau suatu
   saat CSP diperketat ke script-src tanpa 'unsafe-inline'.

   POLA BARU:
   Ganti  onclick="fn('${x}', y)"
   jadi   ${da('fn', x, y)}
   (dipanggil sebagai ekspresi JS di dalam template string, BUKAN
   string biasa — jadi x/y dikirim sebagai nilai JS asli, tidak perlu
   di-quote manual lagi).

   da() menghasilkan atribut data-action + data-args (JSON). SATU
   listener click didaftarkan di document.body (mencakup #content
   maupun modal #modal-body/#modal-foot yang di luar #content),
   memakai closest('[data-action]') supaya tetap kerja untuk elemen
   nested (mis. <span> di dalam <button>).

   CATATAN: onclick native tanpa argumen & tanpa fungsi app (mis.
   onclick="window.print()", onclick="location.reload()") SENGAJA
   TIDAK dimigrasi — tidak ada fungsi global untuk dipanggil lewat
   window[fnName], dan tidak ada risiko escaping karena tidak ada
   argumen dinamis. Lihat REFACTOR-EVENT-DELEGATION.md bagian
   "Dikecualikan".
   ============================================================ */

/**
 * Bikin atribut data-action/data-args untuk dipasang di template string.
 * Dipakai sebagai ekspresi, contoh:
 *   `<button ${da('hapusBookmark', b.id)}>Hapus</button>`
 * @param {string} fnName - nama fungsi global (harus ada di window)
 * @param {...*} args - argumen yang akan dikirim ke fungsi tsb (nilai JS asli)
 * @returns {string} string atribut HTML, siap disisipkan ke dalam tag
 */
function da(fnName, ...args) {
  const json = JSON.stringify(args);
  // data-args pakai kutip TUNGGAL supaya JSON (yang pakai kutip ganda) tidak
  // perlu di-escape lagi. Yang tetap perlu di-escape cuma & < ' kalau ada
  // di dalam nilai string argumen.
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/'/g, '&#39;');
  return `data-action="${fnName}" data-args='${escaped}'`;
}

(function setupEventDelegation() {
  function parseArgs(el) {
    const raw = el.getAttribute('data-args');
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('[event-delegation] data-args tidak valid JSON:', raw, e);
      return [];
    }
  }

  document.body.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    // Elemen <a href="#" ...> dulu butuh "return false" di onclick supaya
    // tidak lompat ke atas halaman / menambah '#' ke URL. da() cuma
    // menghasilkan atribut, tidak ada "return false", jadi preventDefault
    // di sini menggantikan itu untuk SEMUA link data-action (aman untuk
    // <button> juga karena button tidak punya default action).
    if (el.tagName === 'A') e.preventDefault();
    const fnName = el.getAttribute('data-action');
    const fn = window[fnName];
    if (typeof fn !== 'function') {
      console.error('[event-delegation] Fungsi global tidak ditemukan:', fnName);
      return;
    }
    const args = parseArgs(el);
    fn.apply(el, args);
  });
})();
