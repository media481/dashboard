    // Render Functions
    function renderTable(data) {
        const tbody = document.getElementById('tableBody'); if (!tbody) return;
        const now = new Date();
        if (!data || !data.length) { tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📦</div><p>Belum ada program. Klik "Admin" untuk menambah.</p></div></td></tr>`; return; }
        tbody.innerHTML = '';
        data.forEach(item => {
            const isAvailable = item.dateObj >= now, statusClass = isAvailable ? "status-available" : "status-expired";
            const diffMs = item.dateObj - now;
            let cdText = "sudah berangkat", cdClass = "expired";
            if (diffMs >= 0) {
                const diffDays = Math.floor(diffMs / (1000*60*60*24));
                const years = Math.floor(diffDays/365), months = Math.floor((diffDays%365)/30), days = diffDays%30;
                const parts = []; if (years) parts.push(`${years}th`); if (months) parts.push(`${months}bl`); if (days) parts.push(`${days}hr`);
                if (!parts.length) parts.push("hari ini!");
                cdText = parts.join(" ") + (diffDays>0?" lagi":""); cdClass = diffDays<=30?"soon":diffDays<=90?"medium":"far";
            }
            const maskapaiLower = (item.maskapai||'').toLowerCase();
            let maskapaiDot = 'oman';
            if (maskapaiLower.includes('saudia')) maskapaiDot='saudia';
            else if (maskapaiLower.includes('lion')) maskapaiDot='lion';
            else if (maskapaiLower.includes('garuda')) maskapaiDot='garuda';
            else if (maskapaiLower.includes('emirates')) maskapaiDot='emirates';
            else if (maskapaiLower.includes('qatar')) maskapaiDot='qatar';
            else if (maskapaiLower.includes('etihad')) maskapaiDot='etihad';
            else if (maskapaiLower.includes('malindo')) maskapaiDot='malindo';
            else if (maskapaiLower.includes('air asia') || maskapaiLower.includes('airasia')) maskapaiDot='airasia';
            const row = document.createElement('tr');
            if (diffMs >= 0 && Math.floor(diffMs / (1000*60*60*24)) <= 30) row.classList.add('row-urgent');
            row.innerHTML = `<td><span class="package-name${item.link_poster?' has-poster':''}" onclick="openDetailModal('${item.id}')"${item.link_poster?` data-poster="${escapeHtml(item.link_poster)}" data-nama="${escapeHtml(item.nama||'')}" onmouseenter="showPosterPopup(event,this)" onmouseleave="hidePosterPopup()"`:''} title="${item.link_poster?'Hover untuk preview poster — ':''}${escapeHtml(item.nama||'')}">${escapeHtml(item.nama||'')}${item.link_poster?'<i class="fas fa-image" style="margin-left:5px;font-size:10px;color:var(--primary);opacity:.6;vertical-align:middle;"></i>':''}</span><span class="countdown ${cdClass}">🕐 ${escapeHtml(cdText)}</span>${(diffMs >= 0 && Math.floor(diffMs/(1000*60*60*24))<=30)?'<span class="urgent-badge">🔥 Segera!</span>':''}</td>
                <td class="col-harga">${item.harga_quint?`<span class="price-main">${escapeHtml(item.harga_quint)}</span><span class="price-sub">per orang (Quint)</span>`:'<span style="color:var(--text-3);">—</span>'}</td>
                <td class="date-cell">📅 ${escapeHtml(item.tgl||'')}</td>
                <td class="col-durasi"><span class="badge">⏱ ${escapeHtml(item.durasi||'')}</span></td>
                <td class="col-maskapai"><div class="maskapai-cell"><span class="maskapai-dot ${maskapaiDot}"></span>${escapeHtml(item.maskapai||'')}</div></td>
                <td><div class="actions-cell">${item.link_form?`<a href="${escapeHtml(item.link_form)}" target="_blank" class="btn-icon" data-tip="Form Daftar">📋</a>`:'<span class="btn-icon disabled">📋</span>'}${item.link_itinerary?`<a href="${escapeHtml(item.link_itinerary)}" target="_blank" class="btn-icon" data-tip="Itinerary">📄</a>`:'<span class="btn-icon disabled">📄</span>'}${item.link_poster?`<a href="${escapeHtml(item.link_poster)}" target="_blank" class="btn-icon" data-tip="Poster">🖼️</a>`:'<span class="btn-icon disabled">🖼️</span>'}${item.link_metaads?`<a href="${escapeHtml(item.link_metaads)}" target="_blank" class="btn-icon" data-tip="Meta Ads">🔗</a>`:'<span class="btn-icon disabled">🔗</span>'}${item.link_dokumentasi?`<a href="${escapeHtml(item.link_dokumentasi)}" target="_blank" class="btn-icon" data-tip="Dokumentasi">📂</a>`:'<span class="btn-icon disabled">📂</span>'}</div></td>
                <td><span class="status-pill ${statusClass}">${isAvailable?"Tersedia":"Expired"}</span></td>`;
            tbody.appendChild(row);
        });
    }

    // ========== INFO BAR: Lokasi, Cuaca, Tanggal, Salam & Quote Motivasi ==========
