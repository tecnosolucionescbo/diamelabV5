/**
 * Sistema Diamelab - Autenticación y Protección de Rutas
 * Login, logout, verificación de sesión y control de acceso
 */

// ============================================
// CONFIGURACIÓN
// ============================================
const AUTH_REDIRECT = {
    login: 'index.html',
    dashboard: 'dashboard.html'
};

// ============================================
// LOGIN
// ============================================
async function loginUser(email, password) {
    try {
        showLoading('#btn-login', 'Verificando...');

        const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (authError) {
            hideLoading('#btn-login');
            let errorMsg = 'Error al iniciar sesión';
            if (authError.message.includes('Invalid login credentials')) {
                errorMsg = 'Correo o contraseña incorrectos';
            } else if (authError.message.includes('Email not confirmed')) {
                errorMsg = 'El correo no ha sido confirmado. Contacte al administrador.';
            } else if (authError.message.includes('rate limit')) {
                errorMsg = 'Demasiados intentos. Espere un momento.';
            }
            showAlert(errorMsg, 'error');
            return false;
        }

        if (!authData.user) {
            hideLoading('#btn-login');
            showAlert('No se pudo obtener la información del usuario', 'error');
            return false;
        }

        const { data: profile, error: profileError } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', authData.user.id)
            .single();

        if (profileError || !profile) {
            hideLoading('#btn-login');
            showAlert('Error al cargar el perfil. Contacte al administrador.', 'error');
            return false;
        }

        if (profile.activo === false) {
            hideLoading('#btn-login');
            showAlert('Su usuario ha sido desactivado. Contacte al administrador.', 'error');
            await supabaseClient.auth.signOut();
            return false;
        }

        const sessionData = {
            id: authData.user.id,
            email: authData.user.email,
            full_name: profile.full_name || authData.user.email,
            role: profile.role || 'vendedor_bolivar',
            sede: profile.sede || 'Ciudad Bolivar',
            activo: profile.activo !== false,
            access_token: authData.session.access_token,
            expires_at: Date.now() + (authData.session.expires_in * 1000)
        };

        localStorage.setItem('diamelab_user', JSON.stringify(sessionData));
        localStorage.setItem('diamelab_session', JSON.stringify(authData.session));

        hideLoading('#btn-login');
        showAlert(`Bienvenido, ${sessionData.full_name}!`, 'success');

        setTimeout(() => {
            window.location.href = AUTH_REDIRECT.dashboard;
        }, 1000);

        return true;

    } catch (error) {
        hideLoading('#btn-login');
        console.error('Error en login:', error);
        showAlert('Error inesperado. Intente nuevamente.', 'error');
        return false;
    }
}

// ============================================
// LOGOUT
// ============================================
async function logoutUser() {
    try {
        await supabaseClient.auth.signOut();
        localStorage.removeItem('diamelab_user');
        localStorage.removeItem('diamelab_session');
        localStorage.removeItem('diamelab_tasa_bcv');
        showAlert('Sesión cerrada correctamente', 'success');
        setTimeout(() => {
            window.location.href = AUTH_REDIRECT.login;
        }, 800);
    } catch (error) {
        console.error('Error en logout:', error);
        localStorage.clear();
        window.location.href = AUTH_REDIRECT.login;
    }
}

// ============================================
// VERIFICAR SESIÓN ACTIVA
// ============================================
async function checkSession() {
    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error || !session) {
            return false;
        }

        let userData = localStorage.getItem('diamelab_user');
        if (!userData) {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (user) {
                const { data: profile } = await supabaseClient
                    .from('profiles')
                    .select('*')
                    .eq('id', user.id)
                    .single();
                if (profile) {
                    userData = {
                        id: user.id,
                        email: user.email,
                        full_name: profile.full_name,
                        role: profile.role,
                        sede: profile.sede,
                        activo: profile.activo !== false
                    };
                    localStorage.setItem('diamelab_user', JSON.stringify(userData));
                }
            }
        } else {
            const parsed = JSON.parse(userData);
            if (parsed.id) {
                const { data: profile } = await supabaseClient
                    .from('profiles')
                    .select('activo')
                    .eq('id', parsed.id)
                    .single();
                if (profile && profile.activo === false) {
                    await logoutUser();
                    return false;
                }
            }
        }

        return true;

    } catch (error) {
        console.error('Error verificando sesión:', error);
        return false;
    }
}

// ============================================
// PROTEGER RUTAS
// ============================================
async function protectRoute() {
    const isAuthenticated = await checkSession();
    if (!isAuthenticated) {
        localStorage.removeItem('diamelab_user');
        localStorage.removeItem('diamelab_session');
        window.location.href = AUTH_REDIRECT.login;
        return false;
    }
    return true;
}

// ============================================
// VERIFICAR ROL DE ADMIN
// ============================================
function requireAdmin() {
    if (!isAdmin()) {
        showAlert('Acceso denegado. Se requieren permisos de administrador.', 'error');
        setTimeout(() => {
            window.location.href = AUTH_REDIRECT.dashboard;
        }, 1500);
        return false;
    }
    return true;
}

// ============================================
// MOSTRAR INFO DE USUARIO EN NAVBAR
// ============================================
function renderUserInfo() {
    const user = JSON.parse(localStorage.getItem('diamelab_user') || '{}');
    if (!user.email) return;

    document.querySelectorAll('.user-name').forEach(el => {
        el.textContent = user.full_name || user.email;
    });

    const roleLabels = {
        'admin': 'Administrador',
        'vendedor_bolivar': 'Vendedor - Ciudad Bolívar',
        'vendedor_guayana': 'Vendedor - Ciudad Guayana',
        'vendedor_maturin': 'Vendedor - Maturín'
    };
    document.querySelectorAll('.user-role').forEach(el => {
        el.textContent = roleLabels[user.role] || user.role;
    });

    if (user.role === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = '';
        });
    } else {
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = 'none';
        });
    }

    document.querySelectorAll('.user-sede').forEach(el => {
        el.textContent = user.sede || '';
    });
}

// ============================================
// ACTUALIZAR AVATAR CON INICIALES
// ============================================
function updateUserAvatar() {
    const user = JSON.parse(localStorage.getItem('diamelab_user') || '{}');
    const avatarEl = document.getElementById('user-avatar');
    if (avatarEl && user.full_name) {
        const initials = user.full_name
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);
        avatarEl.textContent = initials;
    } else if (avatarEl) {
        avatarEl.textContent = '?';
    }
}

// ============================================
// INICIALIZAR NAVBAR Y SIDEBAR
// ============================================
function initNavigation() {
    renderUserInfo();
    updateUserAvatar();

    const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
    document.querySelectorAll('.nav-link').forEach(link => {
        const href = link.getAttribute('href');
        if (href === currentPage) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });

    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logoutUser();
        });
    }

    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }

    const btnAcerca = document.getElementById('btn-acerca');
    if (btnAcerca) {
        btnAcerca.addEventListener('click', (e) => {
            e.preventDefault();
            showAboutModal();
        });
    }
}

// ============================================
// MODAL ACERCA DE
// ============================================
function showAboutModal() {
    const existingModal = document.querySelector('.about-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.className = 'about-modal';
    modal.innerHTML = `
        <div class="about-modal-content">
            <button class="about-modal-close" onclick="this.closest('.about-modal').remove()">&times;</button>
            <div class="about-header">
                <img src="assets/logo-diamelab.jpg" alt="Diamelab" class="about-logo">
                <h2>Sistema Diamelab</h2>
                <p class="about-subtitle">Gestión de Ventas, Notas de Entrega y Pagos</p>
            </div>
            <div class="about-body">
                <div class="about-section">
                    <h3>Información del Sistema</h3>
                    <p><strong>Versión:</strong> 1.0.0</p>
                    <p><strong>Sede:</strong> Diamelab, C.A.</p>
                    <p><strong>Descripción:</strong> Sistema web para la gestión integral de notas de entrega, 
                    control de pagos y seguimiento de cuentas por cobrar, integrado con el ERP A2.</p>
                </div>
                <div class="about-section about-developer">
                    <h3>Desarrollado por</h3>
                    <div class="developer-card">
                        <div class="developer-avatar">
                            <svg viewBox="0 0 100 100" width="60" height="60">
                                <circle cx="50" cy="35" r="25" fill="#1a237e"/>
                                <path d="M10,100 Q50,60 90,100" fill="#1a237e"/>
                            </svg>
                        </div>
                        <div class="developer-info">
                            <h4>Ing. Juan Cabeza</h4>
                            <p>Desarrollador Web Senior & Arquitecto de Software</p>
                            <p class="developer-motto">"A tu disposición siempre"</p>
                        </div>
                    </div>
                </div>
                <div class="about-section">
                    <h3>Tecnologías Utilizadas</h3>
                    <div class="tech-tags">
                        <span class="tech-tag">HTML5</span>
                        <span class="tech-tag">CSS3</span>
                        <span class="tech-tag">JavaScript</span>
                        <span class="tech-tag">Supabase</span>
                        <span class="tech-tag">PostgreSQL</span>
                        <span class="tech-tag">Row Level Security</span>
                    </div>
                </div>
            </div>
            <div class="about-footer">
                <p>&copy; ${new Date().getFullYear()} Diamelab, C.A. - Todos los derechos reservados.</p>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    const closeOnEsc = (e) => {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', closeOnEsc);
        }
    };
    document.addEventListener('keydown', closeOnEsc);
}

// ============================================
// AUTO-VERIFICACIÓN AL CARGAR PÁGINAS
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    const protectedPages = ['dashboard.html', 'ventas.html', 'pagos.html', 'usuarios.html', 'clientes.html', 'backup.html', 'reportes.html'];
    const currentPage = window.location.pathname.split('/').pop();

    if (protectedPages.includes(currentPage)) {
        await protectRoute();
        initNavigation();
    }
});

// ============================================
// EXPORTAR PARA USO GLOBAL
// ============================================
window.loginUser = loginUser;
window.logoutUser = logoutUser;
window.checkSession = checkSession;
window.protectRoute = protectRoute;
window.requireAdmin = requireAdmin;
window.renderUserInfo = renderUserInfo;
window.updateUserAvatar = updateUserAvatar;
window.initNavigation = initNavigation;
window.showAboutModal = showAboutModal;
