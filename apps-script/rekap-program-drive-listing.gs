/**
 * Rekap Program — Drive Folder Listing (Google Apps Script Web App)
 * ------------------------------------------------------------------
 * Cara pakai:
 * 1. Buka https://script.google.com -> New Project
 * 2. Hapus isi default, tempel seluruh isi file ini
 * 3. Ganti FOLDER_ID di bawah dengan ID folder Google Drive REKAP PROGRAM (bukan folder infografis)
 *    (ID = bagian setelah /folders/ di URL folder-nya)
 * 4. Pastikan folder di-share "Anyone with the link" (Viewer)
 * 5. Deploy -> New deployment -> Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 6. Copy URL hasil deploy (diakhiri /exec), pasang di
 *    secret REKAP_PROGRAM_API_URL Edge Function sync-rekap-program
 *    (supabase secrets set REKAP_PROGRAM_API_URL=...)
 * 7. Setiap kali kode ini diubah, harus "Deploy" ulang (versi baru)
 *    supaya URL /exec yang lama ikut ke-update.
 */

var FOLDER_ID = 'GANTI_DENGAN_FOLDER_ID_ANDA';

function doGet(e) {
  var folder = DriveApp.getFolderById(FOLDER_ID);
  var files = folder.getFiles();
  var items = [];

  while (files.hasNext()) {
    var file = files.next();
    var mime = file.getMimeType();
    if (mime.indexOf('image/') !== 0) continue; // lewati file non-gambar

    var id = file.getId();
    items.push({
      id: id,
      name: file.getName(),
      // thumbnail cepat untuk grid galeri
      thumbUrl: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w540',
      // lebar 1080 px = resolusi asli gambar rekap 1080 x 1920
      fullUrl: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1080',
      updatedAt: file.getLastUpdated().toISOString()
    });
  }

  // Terbaru duluan
  items.sort(function (a, b) {
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });

  var out = ContentService.createTextOutput(JSON.stringify({
    ok: true,
    count: items.length,
    items: items
  }));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}
