    function checkAdminLogin(){
        const pwd=document.getElementById('adminPasswordInput')?.value;
        const errorDiv=document.getElementById('adminLoginError');
        
        // Rate limiting
        if(Date.now()<loginLockTime){
            const waitSeconds=Math.ceil((loginLockTime-Date.now())/1000);
            errorDiv.innerText=`⏳ Terlalu banyak percobaan. Coba lagi ${waitSeconds} detik.`;
            return;
        }
        
        const matchedUser = USER_ROLES[pwd];
        if(matchedUser){
            loginAttempts=0;
            setAdminSession(matchedUser.role);
            renderAdminPanel();
        }else{
            loginAttempts++;
            if(loginAttempts>=5){
                loginLockTime=Date.now()+60000;
                errorDiv.innerText='❌ Terlalu banyak percobaan. Coba lagi 1 menit.';
            }else{
                errorDiv.innerText=`❌ Password salah! Sisa percobaan: ${5-loginAttempts}`;
            }
        }
    }

    window.openDrawer=()=>{const ov=document.getElementById('mobileOverlay');ov&&(ov.classList.add('open'),document.body.style.overflow='hidden');};
    window.closeDrawer=()=>{const ov=document.getElementById('mobileOverlay');ov&&(ov.classList.remove('open'),document.body.style.overflow='');};

    // ===== POSTER HOVER POPUP =====
    function resolveImageUrl(url) {
        if (!url) return url;
        // Google Drive: /file/d/ID/view atau /file/d/ID/view?usp=...
        const gdMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (gdMatch) return `https://drive.google.com/thumbnail?id=${gdMatch[1]}&sz=w1080`;
        // Google Drive: open?id=ID
        const gdOpen = url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
        if (gdOpen) return `https://drive.google.com/thumbnail?id=${gdOpen[1]}&sz=w1080`;
        return url;
    }

    let _posterHideTimer = null;
    function showPosterPopup(e, el) {
        clearTimeout(_posterHideTimer);
        const popup = document.getElementById('posterPopup');
        const img = document.getElementById('posterPopupImg');
        const loading = document.getElementById('posterPopupLoading');
        const errEl = document.getElementById('posterPopupError');
        const nameEl = document.getElementById('posterPopupName');
        const posterUrl = resolveImageUrl(el.getAttribute('data-poster'));
        const posterNama = el.getAttribute('data-nama');
        // Reset state
        img.style.display = 'none';
        img.src = '';
        loading.style.display = 'flex';
        errEl.style.display = 'none';
        nameEl.textContent = posterNama || 'Poster Program';
        // Hitung ukuran popup: rasio 1080:1350, fit ke viewport dengan margin
        const RATIO = 1080 / 1350;
        const gap = 16, margin = 12, labelH = 36;
        const vw = window.innerWidth, vh = window.innerHeight;
        const maxH = vh - margin * 2 - labelH;
        const maxW = Math.min(vw * 0.85, 1080);
        let ph, pw;
        if (maxW / RATIO + labelH <= vh - margin * 2) {
            pw = maxW; ph = Math.round(pw / RATIO);
        } else {
            ph = maxH; pw = Math.round(ph * RATIO);
        }
        // Terapkan ukuran ke elemen
        const inner = popup.querySelector('.poster-popup-inner');
        const wrap = popup.querySelector('.poster-popup-img-wrap');
        inner.style.width = pw + 'px';
        wrap.style.width = pw + 'px';
        wrap.style.height = ph + 'px';
        // Posisi: kanan kursor, geser kiri jika terpotong
        let x = e.clientX + gap;
        let y = e.clientY - Math.round(ph / 3);
        if (x + pw > vw - margin) x = e.clientX - pw - gap;
        if (x < margin) x = margin;
        if (y + ph + labelH > vh - margin) y = vh - ph - labelH - margin;
        if (y < margin) y = margin;
        popup.style.left = x + 'px';
        popup.style.top = y + 'px';
        popup.classList.add('visible');
        img.src = posterUrl;
    }
    function hidePosterPopup() {
        _posterHideTimer = setTimeout(() => {
            const popup = document.getElementById('posterPopup');
            popup.classList.remove('visible');
        }, 120);
    }
    window.showPosterPopup = showPosterPopup;
    window.hidePosterPopup = hidePosterPopup;

