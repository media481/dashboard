
    async function getTgConfig() {
        if (_tgConfigCache) return _tgConfigCache;
        try {
            const { data, error } = await supabaseClient.from('tg_config').select('key, value');
            if (error || !data || !data.length) return {};
            const cfg = {};
            data.forEach(row => {
                try { cfg[row.key] = JSON.parse(row.value); }
                catch { cfg[row.key] = row.value; }
            });
            _tgConfigCache = cfg;
            return cfg;
        } catch { return {}; }
    }

    async function saveTgConfig() {
        const botToken = document.getElementById('tg_bot_token')?.value.trim();
        const edgeUrl  = document.getElementById('tg_edge_url')?.value.trim();
        if (!botToken) { showTgStatus('❌ Bot Token wajib diisi', 'err'); return; }
        if (!edgeUrl)  { showTgStatus('❌ Edge Function URL wajib diisi', 'err'); return; }
        const recipients = collectTgRecipients();
        if (!recipients.length) { showTgStatus('❌ Tambahkan minimal 1 penerima', 'err'); return; }
        showTgStatus('⏳ Menyimpan...', 'ok');
        try {
            const rows = [
                { key: 'botToken',    value: botToken },
                { key: 'edgeUrl',     value: edgeUrl },
                { key: 'recipients',  value: JSON.stringify(recipients) },
            ];
            const { error } = await supabaseClient.from('tg_config').upsert(rows, { onConflict: 'key' });
            if (error) throw error;
            _tgConfigCache = null; // invalidate cache
            showTgStatus('✅ Konfigurasi tersimpan!', 'ok');
        } catch (err) {
            showTgStatus('❌ Gagal simpan: ' + err.message, 'err');
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
        list.innerHTML = '<p style="color:var(--text-3);font-size:12px;">⏳ Memuat konfigurasi...</p>';
        const cfg = await getTgConfig();
        const tokenInput = document.getElementById('tg_bot_token');
        const edgeInput  = document.getElementById('tg_edge_url');
        if (tokenInput && cfg.botToken) tokenInput.value = cfg.botToken;
        if (edgeInput  && cfg.edgeUrl)  edgeInput.value  = cfg.edgeUrl;
        const recipients = typeof cfg.recipients === 'string' ? JSON.parse(cfg.recipients) : (cfg.recipients || []);
        list.innerHTML = '';
        if (!recipients.length) { addTgRecipient(); return; }
        recipients.forEach(r => addTgRecipientRow(r));
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
            { val: 'program',  label: '📦 Program Baru' },
            { val: 'jadwal',   label: '📅 Jadwal Tamu' },
            { val: 'reminder', label: '🔔 Pengingat 1 Bulan' },
        ];
        row.innerHTML = `
            <input class="tg-chat-id" placeholder="Chat ID (mis: -1001234567890)" value="${escapeHtml(r.chatId||'')}" style="flex:1.2;min-width:160px;">
            <input class="tg-label" placeholder="Label (mis: Grup Admin)" value="${escapeHtml(r.label||'')}" style="flex:1;min-width:120px;">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                ${typeOpts.map(t => `<label class="tg-type-label">
                    <input type="checkbox" class="tg-type-check" value="${t.val}" ${(r.types||[]).includes(t.val)?'checked':''}> ${t.label}
                </label>`).join('')}
            </div>
            <button class="tg-remove-btn" onclick="this.closest('.tg-recipient-row').remove()" title="Hapus penerima"><i class="fas fa-times"></i></button>`;
        list.appendChild(row);
    }

    function showTgStatus(msg, type) {
        const el = document.getElementById('tgStatusMsg');
        if (!el) return;
        el.innerHTML = `<span class="tg-status ${type}">${sanitizeHtml(msg)}</span>`;
        setTimeout(() => { if(el) el.innerHTML = ''; }, 4000);
    }

    function logTg(msg, ok = true) {
        const log = document.getElementById('tgNotifLog');
        if (!log) return;
        log.style.display = 'block';
        const p = document.createElement('p');
        p.className = ok ? 'ok' : 'err';
        p.textContent = '[' + new Date().toLocaleTimeString('id-ID') + '] ' + msg;
        log.appendChild(p);
        log.scrollTop = log.scrollHeight;
    }

    // Kirim ke Supabase Edge Function
    async function sendTelegramNotif(message, eventType = 'program') {
        const cfg = await getTgConfig();
        if (!cfg.botToken || !cfg.edgeUrl) return;
        const targets = (cfg.recipients || []).filter(r => (r.types || []).includes(eventType));
        if (!targets.length) return;
        for (const target of targets) {
            try {
                const res = await fetch(cfg.edgeUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        bot_token: cfg.botToken,
                        chat_id: target.chatId,
                        message,
                        parse_mode: 'HTML'
                    })
                });
                const result = await res.json().catch(() => ({}));
                if (res.ok && result.ok !== false) {
                    logTg('✅ Terkirim ke ' + target.label, true);
                } else {
                    logTg('❌ Gagal ke ' + target.label + ': ' + (result.description || res.status), false);
                }
            } catch (err) {
                logTg('❌ Error ke ' + target.label + ': ' + err.message, false);
            }
        }
    }

    // Format pesan: Program baru / edit
    function formatTgProgram(data, isEdit = false) {
        const icon   = isEdit ? '✏️' : '🆕';
        const action = isEdit ? 'diperbarui' : 'ditambahkan';
        return `${icon} <b>Program Umroh ${action}!</b>

🕌 <b>${escapeHtml(data.nama||'-')}</b>
📅 Berangkat: ${escapeHtml(data.tgl||'-')}
⏳ Durasi: ${escapeHtml(data.durasi||'-')}
✈️ Maskapai: ${escapeHtml(data.maskapai||'-')}
💰 Harga: ${escapeHtml(data.harga_quint||'-')}

📌 <i>PT Amiru Haramain Indonesia</i>
🕐 ${new Date().toLocaleString('id-ID')}`;
    }

    // Format pesan: Jadwal tamu baru / edit
    function formatTgJadwal(entry, isEdit = false) {
        const icon   = isEdit ? '✏️' : '📅';
        const action = isEdit ? 'diperbarui' : 'baru';
        const tglFormatted = entry.tgl
            ? new Date(entry.tgl).toLocaleDateString('id-ID', {weekday:'long',day:'numeric',month:'long',year:'numeric'})
            : '-';
        return `${icon} <b>Jadwal Tamu ${action}!</b>

👤 <b>${escapeHtml(entry.nama||'-')}</b>
🏠 Asal: ${escapeHtml(entry.asal||'-')}
📅 Tanggal: ${tglFormatted}
🕐 Jam: ${escapeHtml(entry.jam||'belum ditentukan')}
👥 Jumlah: ${entry.jumlah ? entry.jumlah + ' orang' : '-'}
💼 Keperluan: ${escapeHtml(entry.keperluan||'-')}${entry.catatan ? '\n📝 Catatan: '+escapeHtml(entry.catatan) : ''}

📌 <i>PT Amiru Haramain Indonesia</i>`;
    }

    // Format pesan: Pengingat program hampir berangkat (≤ 30 hari)
    function formatTgReminder(data, sisaHari) {
        const urgency = sisaHari <= 7 ? '🚨' : sisaHari <= 14 ? '⚠️' : '🔔';
        return `${urgency} <b>PENGINGAT — Program Hampir Berangkat!</b>

🕌 <b>${escapeHtml(data.nama||'-')}</b>
📅 Tanggal Berangkat: ${escapeHtml(data.tgl||'-')}
⏰ <b>Sisa ${sisaHari} hari lagi!</b>
⏳ Durasi: ${escapeHtml(data.durasi||'-')}
✈️ Maskapai: ${escapeHtml(data.maskapai||'-')}
💰 Harga: ${escapeHtml(data.harga_quint||'-')}

📌 <i>PT Amiru Haramain Indonesia</i>
🕐 ${new Date().toLocaleString('id-ID')}`;
    }

    // Cek program yang tinggal ≤ 30 hari, kirim reminder (1x per hari per program)
    async function checkAndSendReminders() {
        const cfg = await getTgConfig();
        if (!cfg.botToken || !cfg.edgeUrl) return;
        const recipients = typeof cfg.recipients === 'string' ? JSON.parse(cfg.recipients) : (cfg.recipients || []);
        const targets = recipients.filter(r => (r.types||[]).includes('reminder'));
        if (!targets.length) return;
        if (!dataUmroh || !dataUmroh.length) return;

        // Ambil sentLog dari Supabase tg_config
        let sentLog = {};
        try {
            const { data } = await supabaseClient.from('tg_config').select('value').eq('key', TG_REMINDER_KEY).single();
            if (data) sentLog = JSON.parse(data.value);
        } catch {}

        const today = new Date(); today.setHours(0,0,0,0);
        const todayStr = today.toISOString().split('T')[0];
        let changed = false;

        for (const prog of dataUmroh) {
            if (!prog.tgl) continue;
            const tglParts = prog.tgl.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
            if (!tglParts) continue;
            const bulanMap = {januari:0,februari:1,maret:2,april:3,mei:4,juni:5,juli:6,agustus:7,september:8,oktober:9,november:10,desember:11};
            const bln = bulanMap[tglParts[2].toLowerCase()];
            if (bln === undefined) continue;
            const tglBerangkat = new Date(parseInt(tglParts[3]), bln, parseInt(tglParts[1]));
            tglBerangkat.setHours(0,0,0,0);
            const sisaMs   = tglBerangkat - today;
            const sisaHari = Math.ceil(sisaMs / (1000 * 60 * 60 * 24));
            if (sisaHari < 0 || sisaHari > 30) continue;

            // Cek sudah dikirim hari ini?
            const key = String(prog.id);
            if (sentLog[key] === todayStr) continue;

            const msg = formatTgReminder(prog, sisaHari);
            await sendTelegramNotif(msg, 'reminder');
            sentLog[key] = todayStr;
            changed = true;
        }

        // Simpan sentLog ke Supabase jika ada perubahan
        if (changed) {
            await supabaseClient.from('tg_config').upsert(
                [{ key: TG_REMINDER_KEY, value: JSON.stringify(sentLog) }],
                { onConflict: 'key' }
            );
        }
    }

    // Test kirim semua jenis notifikasi
    async function testTgNotif() {
        await saveTgConfig();
        const waktu = new Date().toLocaleString('id-ID');
        const msgProgram = `🧪 <b>TEST — Program Baru</b>

🕌 <b>Contoh: Umroh Ramadhan 2025</b>
📅 Berangkat: 01 Maret 2025
⏳ Durasi: 9 Hari
✈️ Maskapai: Saudia Airlines
💰 Harga: Rp 34.500.000

📌 <i>PT Amiru Haramain Indonesia</i>
🕐 ${waktu}`;
        const msgJadwal = `🧪 <b>TEST — Jadwal Tamu Baru</b>

👤 <b>H. Budi Santoso</b>
🏠 Asal: Ponorogo
📅 Tanggal: Senin, 27 Januari 2025
🕐 Jam: 09:00
👥 Jumlah: 3 orang
💼 Keperluan: Konsultasi Paket Umroh

📌 <i>PT Amiru Haramain Indonesia</i>`;
        const msgReminder = `🔔 <b>TEST — Pengingat Program</b>

🕌 <b>Umroh Spesial Akbar</b>
📅 Tanggal Berangkat: 15 Februari 2025
⏰ <b>Sisa 20 hari lagi!</b>

📌 <i>PT Amiru Haramain Indonesia</i>
🕐 ${waktu}`;

        showTgStatus('⏳ Mengirim test...', 'ok');
        await sendTelegramNotif(msgProgram,  'program');
        await sendTelegramNotif(msgJadwal,   'jadwal');
        await sendTelegramNotif(msgReminder, 'reminder');
        showTgStatus('✅ Test selesai! Cek log di bawah.', 'ok');
    }

    window.saveTgConfig       = saveTgConfig;
    window.addTgRecipient     = addTgRecipient;
    window.testTgNotif        = testTgNotif;
    window.renderTgRecipients = renderTgRecipients;
    // ========== END TELEGRAM ==========

