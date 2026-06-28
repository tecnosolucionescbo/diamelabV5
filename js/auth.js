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

        // Autenticar con Supabase Auth
        const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (authError) {
            hideLoading('#btn-login');
            
            // Mensajes de error en español
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

        // Obtener perfil del usuario (rol, sede, etc.)
        const { data: profile, error: profileError } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', authData.user.id)
            .single();

        if (profileError) {
            console.warn('Error cargando perfil:', profileError);
            // Si no hay perfil, crear uno básico
            hideLoading('#btn-login');
            showAlert('Error al cargar el perfil. Contacte al administrador.', 'error');
            return false;
        }

        // Guardar datos de sesión en localStorage
        const sessionData = {
            id: authData.user.id,
            email: authData.user.email,
            full_name: profile.full_name || authData.user.email,
            role: profile.role || 'vendedor_bolivar',
            sede: profile.sede || 'Ciudad Bolivar',
            access_token: authData.session.access_token,
            expires_at: Date.now() + (authData.session.expires_in * 1000)
        };

        localStorage.setItem('diamelab_user', JSON.stringify(sessionData));
        localStorage.setItem('diamelab_session', JSON.stringify(authData.session));

        hideLoading('#btn-login');
        showAlert(`Bienvenido, ${sessionData.full_name}!`, 'success');

        // Redireccionar al dashboard después de 1 segundo
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
// REGISTRO DE USUARIO (Solo Admin)
// ============================================
async function registerUser(email, password, fullName, role, sede) {
    try {
        // Verificar que es admin
        if (!isAdmin()) {
            showAlert('Solo los administradores pueden registrar usuarios', 'error');
            return false;
        }

        // Crear usuario en Supabase Auth
        const { data, error } = await supabaseClient.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    full_name: fullName,
                    role: role,
                    sede: sede
                }
            }
        });

        if (error) {
            showAlert('Error al registrar: ' + error.message, 'error');
            return false;
        }

        showAlert('Usuario registrado exitosamente', 'success');
        return true;

    } catch (error) {
        console.error('Error en registro:', error);
        showAlert('Error inesperado al registrar usuario', 'error');
        return false;
    }
}

// ============================================
// LOGOUT
// ============================================
async function logoutUser() {
    try {
        await supabaseClient.auth.signOut();
        
        // Limpiar localStorage
        localStorage.removeItem('diamelab_user');
        localStorage.removeItem('diamelab_session');
        localStorage.removeItem('diamelab_tasa_bcv');
        
        showAlert('Sesión cerrada correctamente', 'success');
        
        setTimeout(() => {
            window.location.href = AUTH_REDIRECT.login;
        }, 800);
        
    } catch (error) {
        console.error('Error en logout:', error);
        // Forzar logout local incluso si falla el server
        localStorage.clear();
        window.location.href = AUTH_REDIRECT.login;
    }
}

// ============================================
// VERIFICAR SESIÓN ACTIVA
// ============================================
async function checkSession() {
    try {
        // Verificar sesión en Supabase
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        
        if (error || !session) {
            return false;
        }

        // Verificar que tenemos datos de usuario local
        const userData = localStorage.getItem('diamelab_user');
        if (!userData) {
            // Recuperar perfil
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (user) {
                const { data: profile } = await supabaseClient
                    .from('profiles')
                    .select('*')
                    .eq('id', user.id)
                    .single();
                
                if (profile) {
                    localStorage.setItem('diamelab_user', JSON.stringify({
                        id: user.id,
                        email: user.email,
                        full_name: profile.full_name,
                        role: profile.role,
                        sede: profile.sede
                    }));
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
// PROTEGER RUTAS (redirigir si no hay sesión)
// ============================================
async function protectRoute() {
    const isAuthenticated = await checkSession();
    
    if (!isAuthenticated) {
        // Limpiar cualquier dato residual
        localStorage.removeItem('diamelab_user');
        localStorage.removeItem('diamelab_session');
        
        // Redireccionar al login
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

    // Actualizar nombre de usuario
    const userNameElements = document.querySelectorAll('.user-name');
    userNameElements.forEach(el => {
        el.textContent = user.full_name || user.email;
    });

    // Actualizar rol
    const userRoleElements = document.querySelectorAll('.user-role');
    const roleLabels = {
        'admin': 'Administrador',
        'vendedor_bolivar': 'Vendedor - Ciudad Bolívar',
        'vendedor_guayana': 'Vendedor - Ciudad Guayana',
        'vendedor_maturin': 'Vendedor - Maturín'
    };
    userRoleElements.forEach(el => {
        el.textContent = roleLabels[user.role] || user.role;
    });

    // Mostrar/ocultar elementos de admin
    if (user.role === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = '';
        });
    } else {
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = 'none';
        });
    }

    // Actualizar sede
    const userSedeElements = document.querySelectorAll('.user-sede');
    userSedeElements.forEach(el => {
        el.textContent = user.sede || '';
    });
}

// ============================================
// INICIALIZAR NAVBAR Y SIDEBAR
// ============================================
function initNavigation() {
    // Render info de usuario
    renderUserInfo();

    // Marcar página activa en navegación
    const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
    document.querySelectorAll('.nav-link').forEach(link => {
        const href = link.getAttribute('href');
        if (href === currentPage) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });

    // Setup logout button
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logoutUser();
        });
    }

    // Setup mobile menu toggle
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }

    // Setup botón Acerca de
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
    // Remover modal anterior si existe
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

    // Cerrar al hacer click fuera
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    // Cerrar con ESC
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
    // Páginas que requieren autenticación
    const protectedPages = ['dashboard.html', 'ventas.html', 'pagos.html'];
    const currentPage = window.location.pathname.split('/').pop();

    if (protectedPages.includes(currentPage)) {
        await protectRoute();
    }

    // Inicializar navegación en todas las páginas protegidas
    if (protectedPages.includes(currentPage)) {
        initNavigation();
    }
});

// ============================================
// EXPORTAR PARA USO GLOBAL
// ============================================
window.loginUser = loginUser;
window.logoutUser = logoutUser;
window.registerUser = registerUser;
window.checkSession = checkSession;
window.protectRoute = protectRoute;
window.requireAdmin = requireAdmin;
window.renderUserInfo = renderUserInfo;
window.initNavigation = initNavigation;
window.showAboutModal = showAboutModal;
