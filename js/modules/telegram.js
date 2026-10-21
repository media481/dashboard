// ============================================================
// MODUL LAZY: TELEGRAM  (js/modules/telegram.js)
// ============================================================
// Dipecah dari js/app.js dan dimuat HANYA saat dibutuhkan (ensureModuleLoaded('telegram') di app.js).
// Dimuat sebagai <script> biasa (BUKAN ES module): satu lingkup global dengan app.js, jadi nama
// fungsi global, onclick="..." dan data-action="..." tidak berubah.
// ATURAN: jangan mendeklarasikan ulang nama yang sudah ada di app.js (const/let ganda = SyntaxError).
// Fungsi yang dirujuk index.html / kode inti SEBELUM modul dimuat didaftarkan di LAZY_MODULES['telegram'].api (app.js).
// ============================================================

// ============================================================
// 21B. TELEGRAM MODULE
// ============================================================
async function getTgConfig() {
    if (_tgConfigCache) return _tgConfigCache;
    try {
        const { data, error } = await withRetry(
            () => supabaseClient.from('tg_config').select('key, value'),
            { label: 'Muat konfigurasi Telegram' }
        );
        if (error || !data || !data.length) return {};
        const cfg = {};
        data.forEach(row => { try { cfg[row.key] = JSON.parse(row.value); } catch { cfg[row.key] = row.value; } });
        _tgConfigCache = cfg;
        return cfg;
    } catch { return {}; }
}

async function saveTgConfig() {
    const botToken = document.getElementById('tg_bot_token')?.value.trim();
    const edgeUrl  = document.getElementById('tg_edge_url')?.value.trim();
    if (!botToken) { showTgStatus('Bot Token wajib diisi', 'err'); return; }
    if (!edgeUrl)  { showTgStatus('Edge Function URL wajib diisi', 'err'); return; }
    const recipients = collectTgRecipients();
    if (!recipients.length) { showTgStatus('Tambahkan minimal 1 penerima', 'err'); return; }
    showTgStatus('Menyimpan...', 'ok');
    try {
        const rows = [
            { key: 'botToken', value: botToken },
            { key: 'edgeUrl', value: edgeUrl },
            { key: 'recipients', value: JSON.stringify(recipients) },
        ];
        const { error } = await supabaseClient.from('tg_config').upsert(rows, { onConflict: 'key' });
        if (error) throw error;
        _tgConfigCache = null;
        showTgStatus('Konfigurasi tersimpan!', 'ok');
    } catch (err) {
        showTgStatus('Gagal simpan: ' + err.message, 'err');
    }
}

function collectTgRecipients() {
    const rows = document.querySelectorAll('.tg-recipient-row');
    const result = [];
    rows.forEach(row => {
        const chatId = row.querySelector('.tg-chat-id')?.value.trim();
        const label  = row.querySelector('.tg-label')?.value.trim();
        const types  = [...row.querySelectorAll('.tg-type-check:checked')].map(c => c.value);
        if (chatId) result.push({ chatId, label: label || chatId, types });
    });
    return result;
}

async function renderTgRecipients() {
    const list = document.getElementById('tgRecipientsList');
    if (!list) return;
    list.innerHTML = '<p class="tg-loading"><i class="bi bi-hourglass-split"></i> Memuat konfigurasi...</p>';
    const cfg = await getTgConfig();
    const tokenInput = document.getElementById('tg_bot_token');
    const edgeInput  = document.getElementById('tg_edge_url');
    if (tokenInput && cfg.botToken) tokenInput.value = cfg.botToken;
    if (edgeInput  && cfg.edgeUrl)  edgeInput.value  = cfg.edgeUrl;
    let recipients = [];
    try { recipients = typeof cfg.recipients === 'string' ? JSON.parse(cfg.recipients) : (cfg.recipients || []); } catch { recipients = []; }
    list.innerHTML = '';
    if (!recipients.length) addTgRecipient();
    else recipients.forEach(r => addTgRecipientRow(r));
    // Panduan setup: terbuka kalau belum dikonfigurasi, terlipat kalau sudah.
    const guide = document.getElementById('tgGuide');
    if (guide) guide.open = !(cfg.botToken && cfg.edgeUrl && recipients.length);
    updateTgSummary();
}

function addTgRecipient() {
    addTgRecipientRow({ chatId: '', label: '', types: ['program', 'jadwal', 'reminder'] });
}

function addTgRecipientRow(r) {
    const list = document.getElementById('tgRecipientsList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'tg-recipient-row';
    const typeOpts = [
        { val: 'program', label: '<i class="bi bi-box-seam"></i> Program Baru' },
        { val: 'jadwal', label: '<i class="bi bi-calendar3"></i> Jadwal Tamu' },
        { val: 'reminder', label: '<i class="bi bi-bell-fill"></i> Pengingat 1 Bulan' },
        { val: 'ig_comment', label: '<i class="bi bi-instagram"></i> Komentar IG Baru' },
    ];
    row.innerHTML = `
        <span class="tg-recipient-ava"><i class="bi bi-chat-dots-fill"></i></span>
        <div class="tg-recipient-fields">
            <label class="tg-field"><span>Label</span><input class="tg-label" aria-label="Label penerima" placeholder="mis: Grup Admin" value="${escapeHtml(r.label||'')}"></label>
            <label class="tg-field"><span>Chat ID</span><input class="tg-chat-id" aria-label="Chat ID" inputmode="text" placeholder="mis: -1001234567890" value="${escapeHtml(r.chatId||'')}"></label>
        </div>
        <button type="button" class="tg-remove-btn" onclick="removeTgRecipient(this)" title="Hapus penerima" aria-label="Hapus penerima"><i class="bi bi-trash3"></i></button>
        <div class="tg-recipient-types">
            ${typeOpts.map(t => `<label class="tg-chip"><input type="checkbox" class="tg-type-check" value="${t.val}" ${(r.types||[]).includes(t.val)?'checked':''}><span class="tg-chip-body">${t.label}</span></label>`).join('')}
        </div>`;
    list.appendChild(row);
    updateTgSummary();
}

function removeTgRecipient(btn) {
    const row = btn && btn.closest('.tg-recipient-row');
    if (row) row.remove();
    updateTgSummary();
}

// Ringkasan di header panel: jumlah penerima + status "Siap" kalau token, URL, dan minimal 1 penerima terisi.
function updateTgSummary() {
    const rows = document.querySelectorAll('#tgRecipientsList .tg-recipient-row');
    let filled = 0;
    rows.forEach(r => { if (r.querySelector('.tg-chat-id')?.value.trim()) filled++; });
    const count = document.getElementById('tgCount');
    if (count) count.textContent = String(filled);
    const list = document.getElementById('tgRecipientsList');
    if (list) {
        let empty = list.querySelector('.tg-empty');
        if (!rows.length && !empty && !list.querySelector('.tg-loading')) {
            empty = document.createElement('div');
            empty.className = 'tg-empty';
            empty.innerHTML = '<i class="bi bi-people"></i>Belum ada penerima. Klik <b>Tambah Penerima</b>.';
            list.appendChild(empty);
        } else if (rows.length && empty) empty.remove();
    }
    const state = document.getElementById('tgState');
    if (state) {
        const ready = !!(document.getElementById('tg_bot_token')?.value.trim() && document.getElementById('tg_edge_url')?.value.trim() && filled);
        state.classList.toggle('is-ready', ready);
        state.textContent = ready ? 'Siap dikirim' : 'Belum lengkap';
    }
}
if (!window.__tgSummaryBound) {
    window.__tgSummaryBound = true;
    document.addEventListener('input', e => { if (e.target.closest && e.target.closest('#adminSubTab-telegram')) updateTgSummary(); });
}

function showTgStatus(msg, type) {
    const el = document.getElementById('tgStatusMsg');
    if (!el) return;
    const iconMap = { ok: 'bi-check-circle-fill', err: 'bi-exclamation-circle-fill' };
    const icon = iconMap[type] || 'bi-info-circle-fill';
    el.innerHTML = `<span class="tg-status ${type}"><i class="bi ${icon}"></i> ${escapeHtml(msg)}</span>`;
    setTimeout(() => { if (el) el.innerHTML = ''; }, 4000);
}

function logTg(msg, ok = true) {
    const log = document.getElementById('tgNotifLog');
    if (!log) return;
    log.querySelector('.tg-log-empty')?.remove();
    const row = document.createElement('div');
    row.className = 'tg-log-row ' + (ok ? 'ok' : 'err');
    const t = document.createElement('time');
    t.textContent = new Date().toLocaleTimeString('id-ID');
    const m = document.createElement('span');
    m.textContent = (ok ? '✓ ' : '✗ ') + msg;
    row.appendChild(t); row.appendChild(m);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
}

async function sendTelegramNotif(message, eventType = 'program') {
    const cfg = await getTgConfig();
    if (!cfg.botToken || !cfg.edgeUrl) return; // belum dikonfigurasi -> lewati diam-diam
    const recipients = typeof cfg.recipients === 'string' ? JSON.parse(cfg.recipients) : (cfg.recipients || []);
    const targets = recipients.filter(r => (r.types || []).includes(eventType));
    if (!targets.length) return;
    for (const target of targets) {
        try {
            const res = await fetch(cfg.edgeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bot_token: cfg.botToken, chat_id: target.chatId, message, parse_mode: 'HTML' })
            });
            const result = await res.json().catch(() => ({}));
            if (res.ok && result.ok !== false) logTg('Terkirim ke ' + target.label, true);
            else logTg('Gagal ke ' + target.label + ': ' + (result.description || res.status), false);
        } catch (err) {
            logTg('Error ke ' + target.label + ': ' + err.message, false);
        }
    }
}

function formatTgReminder(data, sisaHari) {
    const urgency = sisaHari <= 7 ? '🚨' : sisaHari <= 14 ? '⚠️' : '🔔';
    return `${urgency} <b>PENGINGAT — Program Hampir Berangkat!</b>

🕌 <b>${escapeHtml(data.nama||'-')}</b>
📅 Tanggal Berangkat: ${escapeHtml(data.tgl||'-')}
⏰ <b>Sisa ${sisaHari} hari lagi!</b>
⏳ Durasi: ${escapeHtml(data.durasi||'-')}
✈️ Maskapai: ${escapeHtml(data.maskapai||'-')}
💰 Harga: ${escapeHtml(data.harga_quint||'-')}

📌 <i>${escapeHtml(NOTA_PERUSAHAAN.nama)}</i>
🕐 ${new Date().toLocaleString('id-ID')}`;
}

// Ambil ringkasan status jamaah 1 program (dipakai generateTgReminderAI supaya
// pesan reminder bisa menyoroti hal yang perlu ditindaklanjuti admin, bukan
// cuma "sisa X hari"). Query ringan -- hanya ambil kolom status & dokumen,
// bukan semua data jamaah.
async function getJamaahStatsForProgram(programId) {
    try {
        const { data, error } = await supabaseClient
            .from('kb_jamaah')
            .select('id, status, dokumen')
            .eq('program_id', programId)
            .eq('diarsipkan', false);
        if (error || !data) return { totalJamaah: 0, jamaahLunas: 0, jamaahBelumLunas: 0, jamaahBatal: 0, dokumenBelumLengkap: 0 };

        let jamaahLunas = 0, jamaahBelumLunas = 0, jamaahBatal = 0, dokumenBelumLengkap = 0;
        data.forEach(j => {
            if (j.status === 'batal') { jamaahBatal++; return; }
            if (j.status === 'lunas') jamaahLunas++; else jamaahBelumLunas++;
            if (!isDokumenLengkap(j.dokumen, j)) dokumenBelumLengkap++;
        });
        return { totalJamaah: data.length, jamaahLunas, jamaahBelumLunas, jamaahBatal, dokumenBelumLengkap };
    } catch (err) {
        console.error('getJamaahStatsForProgram error:', err);
        return { totalJamaah: 0, jamaahLunas: 0, jamaahBelumLunas: 0, jamaahBatal: 0, dokumenBelumLengkap: 0 };
    }
}

// Versi AI dari formatTgReminder() -- menyusun pesan reminder yang lebih
// variatif & menyoroti hal yang perlu ditindaklanjuti (jamaah belum lunas /
// dokumen belum lengkap), bukan template statis yang bunyinya sama tiap hari
// selama 30 hari ke grup admin yang sama. Kalau gagal (limit Gemini habis/
// internet putus/dll), caller (checkAndSendReminders) fallback ke
// formatTgReminder() lama.
async function generateTgReminderAI(prog, sisaHari, stats) {
    const payload = {
        nama: prog.nama, tgl: prog.tgl, durasi: prog.durasi, maskapai: prog.maskapai,
        harga_quint: prog.harga_quint, sisaHari,
        totalJamaah: stats.totalJamaah, jamaahLunas: stats.jamaahLunas,
        jamaahBelumLunas: stats.jamaahBelumLunas, jamaahBatal: stats.jamaahBatal,
        dokumenBelumLengkap: stats.dokumenBelumLengkap,
        companyName: NOTA_PERUSAHAAN.nama,
    };
    const response = await fetch(TG_REMINDER_AI_FUNCTION_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": "Bearer " + SUPABASE_ANON_KEY
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        let detail = '';
        try { detail = (await response.json()).error || ''; } catch (e) {}
        throw new Error(detail || 'Gagal memanggil API (status ' + response.status + ')');
    }
    const data = await response.json();
    const message = (data.message || '').trim();
    if (!message) throw new Error('Tidak ada hasil teks dari model.');
    return message;
}

async function checkAndSendReminders() {
    const cfg = await getTgConfig();
    if (!cfg.botToken || !cfg.edgeUrl) return;
    const recipients = typeof cfg.recipients === 'string' ? JSON.parse(cfg.recipients) : (cfg.recipients || []);
    const targets = recipients.filter(r => (r.types||[]).includes('reminder'));
    if (!targets.length) return;
    if (!dataUmroh || !dataUmroh.length) return;

    let sentLog = {};
    try {
        const { data } = await supabaseClient.from('tg_config').select('value').eq('key', TG_REMINDER_KEY).maybeSingle();
        if (data) sentLog = JSON.parse(data.value);
    } catch {}

    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = today.toISOString().split('T')[0];
    let changed = false;

    for (const prog of dataUmroh) {
        if (!prog.tgl) continue;
        const tglBerangkat = parseDateFromString(prog.tgl);
        if (!tglBerangkat || isNaN(tglBerangkat.getTime())) continue;
        tglBerangkat.setHours(0,0,0,0);
        const sisaMs = tglBerangkat - today;
        const sisaHari = Math.ceil(sisaMs / (1000 * 60 * 60 * 24));
        if (sisaHari < 0 || sisaHari > 30) continue;

        const key = String(prog.id);
        if (sentLog[key] === todayStr) continue;

        // Coba versi AI dulu (lebih natural & menyoroti hal yang perlu
        // ditindaklanjuti); kalau gagal, jatuhkan ke template statis lama
        // supaya reminder tetap terkirim walau AI sedang bermasalah.
        let msg;
        try {
            const stats = await getJamaahStatsForProgram(prog.id);
            msg = await generateTgReminderAI(prog, sisaHari, stats);
        } catch (err) {
            console.error('generateTgReminderAI gagal, fallback ke template statis:', err);
            msg = formatTgReminder(prog, sisaHari);
        }
        await sendTelegramNotif(msg, 'reminder');
        sentLog[key] = todayStr;
        changed = true;
    }

    if (changed) {
        await supabaseClient.from('tg_config').upsert([{ key: TG_REMINDER_KEY, value: JSON.stringify(sentLog) }], { onConflict: 'key' });
    }
}

async function testTgNotif() {
    await saveTgConfig();
    const waktu = new Date().toLocaleString('id-ID');
    const msgProgram = `🧪 <b>TEST — Program Baru</b>\n\n🕌 <b>Contoh: Umroh Ramadhan</b>\n📅 Berangkat: 01 Maret 2027\n⏳ Durasi: 9 Hari\n✈️ Maskapai: Saudia Airlines\n💰 Harga: Rp 34.500.000\n\n📌 <i>${escapeHtml(NOTA_PERUSAHAAN.nama)}</i>\n🕐 ${waktu}`;
    const msgJadwal = `🧪 <b>TEST — Jadwal Tamu Baru</b>\n\n👤 <b>H. Budi Santoso</b>\n🏠 Asal: Ponorogo\n📅 Tanggal: Senin, 27 Januari 2027\n🕐 Jam: 09:00\n👥 Jumlah: 3 orang\n💼 Keperluan: Konsultasi Paket Umroh\n\n📌 <i>${escapeHtml(NOTA_PERUSAHAAN.nama)}</i>`;
    const msgReminder = `🔔 <b>TEST — Pengingat Program</b>\n\n🕌 <b>Umroh Spesial Akbar</b>\n📅 Tanggal Berangkat: 15 Februari 2027\n⏰ <b>Sisa 20 hari lagi!</b>\n\n📌 <i>${escapeHtml(NOTA_PERUSAHAAN.nama)}</i>\n🕐 ${waktu}`;

    showTgStatus('Mengirim test...', 'ok');
    await sendTelegramNotif(msgProgram, 'program');
    await sendTelegramNotif(msgJadwal, 'jadwal');
    await sendTelegramNotif(msgReminder, 'reminder');
    showTgStatus('Test selesai! Cek log di bawah.', 'ok');
}

// Test terpisah khusus untuk reminder versi AI (generateTgReminderAI) --
// dipakai admin untuk cek kualitas & variasi kalimat AI tanpa perlu menunggu
// ada program yang benar-benar H-30 s/d H-0. Pakai data contoh dengan skenario
// "masih ada yang belum lunas & dokumen belum lengkap" supaya kelihatan beda
// dari template statis lama.
async function testTgReminderAI() {
    await saveTgConfig();
    showTgStatus('Menyusun reminder dengan AI...', 'ok');
    const progContoh = { nama: 'Umroh Spesial Akbar', tgl: '15 Februari 2027', durasi: '9 Hari', maskapai: 'Saudia Airlines', harga_quint: 'Rp 32.500.000' };
    const statsContoh = { totalJamaah: 12, jamaahLunas: 7, jamaahBelumLunas: 5, jamaahBatal: 0, dokumenBelumLengkap: 3 };
    try {
        const msg = await generateTgReminderAI(progContoh, 20, statsContoh);
        await sendTelegramNotif(msg, 'reminder');
        showTgStatus('Test AI selesai! Cek log di bawah.', 'ok');
    } catch (err) {
        console.error(err);
        showTgStatus('AI gagal: ' + err.message + ' — cek GEMINI_API_KEY di Supabase secrets', 'err');
    }
}

// withBusy() (app.js): anti klik ganda + spinner. Dibungkus di sini karena fungsinya baru ada setelah modul dimuat.
if (typeof window.saveTgConfig === 'function') window.saveTgConfig = withBusy(window.saveTgConfig);
