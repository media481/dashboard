    let USER_ROLES = {};
    async function loadUserRoles() {
        try {
            const { data, error } = await supabaseClient.from('app_config').select('key, value');
            if (error || !data) return;
            data.forEach(row => {
                if (row.key === 'pass_administrator') USER_ROLES[row.value] = { role: 'administrator', label: 'Administrator' };
                if (row.key === 'pass_cs')            USER_ROLES[row.value] = { role: 'cs',            label: 'CS / Customer Service' };
            });
        } catch (_) {}
    }

    let dataUmroh = [], currentData = [], currentSort = { column: null, asc: true };
    let tickerEnabled = true; // Status Running Text (ticker), diambil dari Supabase tg_config
    let infobarEnabled = true; // Status Info Bar (cuaca/lokasi/quote), diambil dari Supabase tg_config
    let adminLoggedIn = false, currentRole = null, editingProgramId = null, adminSortColumn = null, adminSortAsc = true, adminPrograms = [];
    let debounceTimer = null, sessionTimeout = null;

    // Security: Rate limiting untuk login
    let loginAttempts = 0;
    let loginLockTime = 0;
    
    // ========== SECURITY: VALIDASI URL ==========
    function isValidUrl(string) {
        if (!string) return true; // kosong dianggap valid
        try {
            const url = new URL(string);
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch (_) {
            return false;
        }
    }
    
    // ========== SECURITY: SANITASI INPUT (Double Escape) ==========
    function sanitizeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, (m) => {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        }).replace(/javascript:/gi, 'blocked:');
    }
    
    // ========== SECURITY: VALIDASI NAMA PROGRAM ==========
    function isValidProgramName(name) {
        if (!name) return false;
        // Hanya huruf, angka, spasi, dan karakter umum yang aman
        // Izinkan huruf Latin, Arab, angka, dan karakter umum nama program
        const validPattern = /^[\p{L}\p{N}\s\-.,()+&:!?\/]+$/u;
        return validPattern.test(name);
    }
    
    // ========== SESSION MANAGEMENT ==========
    function setAdminSession(role) {
        adminLoggedIn = true;
        currentRole = role;
        sessionStorage.setItem('admin_logged_in', 'true');
        sessionStorage.setItem('admin_role', role);
        sessionStorage.setItem('admin_login_time', Date.now().toString());
        
        if (sessionTimeout) clearTimeout(sessionTimeout);
        sessionTimeout = setTimeout(() => {
            if (adminLoggedIn) {
                adminLoggedIn = false;
                currentRole = null;
                sessionStorage.removeItem('admin_logged_in');
                sessionStorage.removeItem('admin_role');
                sessionStorage.removeItem('admin_login_time');
                const modal = document.getElementById('adminModal');
                if (modal.classList.contains('show')) {
                    closeAdminModal();
                }
                showToast('⏰ Sesi berakhir, silakan login ulang.');
            }
        }, SESSION_DURATION);
    }
    
    function checkSession() {
        const loggedIn = sessionStorage.getItem('admin_logged_in');
        const loginTime = sessionStorage.getItem('admin_login_time');
        const savedRole = sessionStorage.getItem('admin_role');
        if (loggedIn === 'true' && loginTime && (Date.now() - parseInt(loginTime) < SESSION_DURATION)) {
            adminLoggedIn = true;
            currentRole = savedRole || 'administrator';
            setAdminSession(currentRole); // refresh session
        } else {
            sessionStorage.removeItem('admin_logged_in');
            sessionStorage.removeItem('admin_role');
            sessionStorage.removeItem('admin_login_time');
            adminLoggedIn = false;
            currentRole = null;
        }
    }
    
