/**
 * Sistema Diamelab - Utilidades Generales
 * Helpers y funciones de uso común en toda la aplicación
 */

// ============================================
// FORMATO DE FECHAS
// ============================================
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-VE', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric' 
    });
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-VE', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Obtener fecha actual en formato YYYY-MM-DD
function getTodayISO() {
    return new Date().toISOString().split('T')[0];
}

// Calcular fecha de vencimiento (+15 días)
function calcularVencimiento(fechaEmision) {
    const fecha = new Date(fechaEmision);
    fecha.setDate(fecha.getDate() + 15);
    return fecha.toISOString().split('T')[0];
}

// ============================================
// FORMATO DE MONEDA
// ============================================
function formatUSD(amount) {
    if (amount === null || amount === undefined) return '$0.00';
    return '$' + parseFloat(amount).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatVES(amount, tasa) {
    if (!amount || !tasa) return 'Bs. 0,00';
    const total = parseFloat(amount) * parseFloat(tasa);
    return 'Bs. ' + total.toLocaleString('es-VE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatNumber(num, decimals = 2) {
    if (num === null || num === undefined) return '0';
    return parseFloat(num).toLocaleString('es-VE', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

// ============================================
// ALERTAS Y NOTIFICACIONES
// ============================================
function showAlert(message, type = 'success') {
    // Remover alertas anteriores
    const existing = document.querySelector('.diamelab-alert');
    if (existing) existing.remove();

    const alert = document.createElement('div');
    alert.className = `diamelab-alert alert-${type}`;
    
    const iconos = {
        success: '&#10003;',
        error: '&#10007;',
        warning: '&#9888;',
        info: '&#8505;'
    };
    
    alert.innerHTML = `
        <span class="alert-icon">${iconos[type] || '&#8505;'}</span>
        <span class="alert-message">${message}</span>
        <button class="alert-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    
    document.body.appendChild(alert);
    
    // Auto-remover después de 4 segundos
    setTimeout(() => {
        if (alert.parentElement) alert.remove();
    }, 4000);
}

// ============================================
// LOADING SPINNER
// ============================================
function showLoading(element, text = 'Cargando...') {
    if (typeof element === 'string') {
        element = document.querySelector(element);
    }
    if (!element) return;
    
    element.dataset.originalHtml = element.innerHTML;
    element.disabled = true;
    element.innerHTML = `<span class="spinner"></span> ${text}`;
}

function hideLoading(element) {
    if (typeof element === 'string') {
        element = document.querySelector(element);
    }
    if (!element || !element.dataset.originalHtml) return;
    
    element.innerHTML = element.dataset.originalHtml;
    element.disabled = false;
}

// ============================================
// VALIDACIONES
// ============================================
function validateRequired(value, fieldName) {
    if (!value || value.toString().trim() === '') {
        return `El campo "${fieldName}" es obligatorio`;
    }
    return null;
}

function validatePositiveNumber(value, fieldName) {
    if (!value || parseFloat(value) <= 0) {
        return `El campo "${fieldName}" debe ser mayor a cero`;
    }
    return null;
}

function validateRIF(rif) {
    if (!rif) return 'El RIF es obligatorio';
    const regex = /^[VJEGP]-\d{8,9}-\d$/i;
    if (!regex.test(rif)) {
        return 'Formato de RIF inválido. Use formato: J-12345678-9';
    }
    return null;
}

// ============================================
// GENERADOR DE UUID (para IDs temporales)
// ============================================
function generateUUID() {
    return crypto.randomUUID ? crypto.randomUUID() : 
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
}

// ============================================
// DEBOUNCE (para inputs con delay)
// ============================================
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ============================================
// CONFIRMAR ACCIÓN
// ============================================
function confirmAction(message) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'confirm-modal';
        modal.innerHTML = `
            <div class="confirm-modal-content">
                <p class="confirm-message">${message}</p>
                <div class="confirm-buttons">
                    <button class="btn btn-secondary" id="btn-cancel">Cancelar</button>
                    <button class="btn btn-danger" id="btn-confirm">Confirmar</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        modal.querySelector('#btn-confirm').addEventListener('click', () => {
            modal.remove();
            resolve(true);
        });
        
        modal.querySelector('#btn-cancel').addEventListener('click', () => {
            modal.remove();
            resolve(false);
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(false);
            }
        });
    });
}

// ============================================
// OBTENER SEDE DEL USUARIO ACTUAL
// ============================================
function getUserSede() {
    const user = JSON.parse(localStorage.getItem('diamelab_user') || '{}');
    return user.sede || '';
}

function isAdmin() {
    const user = JSON.parse(localStorage.getItem('diamelab_user') || '{}');
    return user.role === 'admin';
}

function getUserRole() {
    const user = JSON.parse(localStorage.getItem('diamelab_user') || '{}');
    return user.role || '';
}

// ============================================
// FILTRAR POR SEDE (para arrays)
// ============================================
function filtrarPorSede(data) {
    if (isAdmin()) return data;
    const sede = getUserSede();
    return data.filter(item => item.sede === sede);
}

// ============================================
// EXPORTAR PARA USO GLOBAL
// ============================================
window.formatDate = formatDate;
window.formatDateTime = formatDateTime;
window.getTodayISO = getTodayISO;
window.calcularVencimiento = calcularVencimiento;
window.formatUSD = formatUSD;
window.formatVES = formatVES;
window.formatNumber = formatNumber;
window.showAlert = showAlert;
window.showLoading = showLoading;
window.hideLoading = hideLoading;
window.validateRequired = validateRequired;
window.validatePositiveNumber = validatePositiveNumber;
window.validateRIF = validateRIF;
window.generateUUID = generateUUID;
window.debounce = debounce;
window.confirmAction = confirmAction;
window.getUserSede = getUserSede;
window.isAdmin = isAdmin;
window.getUserRole = getUserRole;
window.filtrarPorSede = filtrarPorSede;
