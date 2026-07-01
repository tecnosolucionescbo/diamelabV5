/**
 * Sistema Diamelab - Modulo de Ventas (Notas de Entrega)
 * CRUD completo con items opcionales, filtros, gestión de clientes y FACTURACIÓN
 * BÚSQUEDA MEJORADA Y CARGA AUTOMÁTICA DE TASA BCV EN NUEVA NOTA
 */

// Estado global
let clientesCache = [];
let ventasCache = [];
let itemsTemp = [];
let editingVentaId = null;
let viewingVentaId = null;

// Estado para paginación infinita
let paginacion = {
  limit: 50,
  offset: 0,
  total: 0,
  cargando: false,
  fin: false,
  filtrosActuales: {}
};
let observer = null;

// ============================================
// INICIALIZACION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    const isAuth = await protectRoute();
    if (!isAuth) return;

    initNavigation();
    updateUserAvatarVentas();

    // === LEER FILTRO DESDE URL ===
    const urlParams = new URLSearchParams(window.location.search);
    const filtroFactura = urlParams.get('filtro');

    if (filtroFactura === 'facturadas') {
        const selectFacturado = document.getElementById('filtro-facturado');
        if (selectFacturado) selectFacturado.value = 'si';
    } else if (filtroFactura === 'pendientes') {
        const selectFacturado = document.getElementById('filtro-facturado');
        if (selectFacturado) selectFacturado.value = 'no';
    }

    // Cargar tasa BCV
    await actualizarDisplayTasa('#tasa-bcv');

    // Setup sede segun usuario
    setupSedeUsuario();

    // Cargar clientes y ventas
    await cargarClientes();
    await cargarVentas(true);

    // Configurar eventos
    setupEventListeners();

    // Configurar observer para infinite scroll
    configurarObserver();

    // ===== NUEVO: CONFIGURAR EVENTOS DE FACTURACIÓN =====
    setupFacturacionListeners();
});

// ============================================
// FUNCIONES AUXILIARES DE UI
// ============================================

function updateUserAvatarVentas() {
    const user = JSON.parse(localStorage.getItem('diamelab_user') || '{}');
    const avatarEl = document.getElementById('user-avatar');
    if (avatarEl && user.full_name) {
        const initials = user.full_name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
        avatarEl.textContent = initials;
    }
}

function setupSedeUsuario() {
    const user = JSON.parse(localStorage.getItem('diamelab_user') || '{}');
    const sedeSelect = document.getElementById('v-sede');
    
    if (user.sede && user.sede !== 'Todas') {
        sedeSelect.value = user.sede;
        if (!isAdmin()) {
            sedeSelect.disabled = true;
        }
    }

    const filtroSede = document.getElementById('filtro-sede');
    if (isAdmin() && filtroSede) {
        filtroSede.style.display = '';
    }

    const hoy = getTodayISO();
    document.getElementById('v-fecha-emision').value = hoy;
    document.getElementById('v-fecha-vencimiento').value = calcularVencimiento(hoy);
}

// ============================================
// CONFIGURAR EVENTOS
// ============================================

function setupEventListeners() {
    // Filtros principales
    document.getElementById('btn-filtrar').addEventListener('click', () => cargarVentas(true));
    document.getElementById('btn-limpiar').addEventListener('click', limpiarFiltros);
    document.getElementById('filtro-busqueda').addEventListener('input', debounce(() => cargarVentas(true), 400));
    document.getElementById('filtro-estado').addEventListener('change', () => cargarVentas(true));
    document.getElementById('filtro-facturado').addEventListener('change', () => cargarVentas(true));

    // === FILTROS DE FECHA - EVENTOS INPUT Y CHANGE ===
    const fechaDesde = document.getElementById('filtro-fecha-desde');
    const fechaHasta = document.getElementById('filtro-fecha-hasta');

    if (fechaDesde) {
        fechaDesde.addEventListener('input', () => {
            cargarVentas(true);
        });
        fechaDesde.addEventListener('change', () => {
            cargarVentas(true);
        });
    }

    if (fechaHasta) {
        fechaHasta.addEventListener('input', () => {
            cargarVentas(true);
        });
        fechaHasta.addEventListener('change', () => {
            cargarVentas(true);
        });
    }

    const filtroSede = document.getElementById('filtro-sede');
    if (filtroSede) filtroSede.addEventListener('change', () => cargarVentas(true));

    // Modal venta
    document.getElementById('btn-nueva-venta').addEventListener('click', abrirModalNuevaVenta);
    document.getElementById('btn-cerrar-modal').addEventListener('click', cerrarModalVenta);
    document.getElementById('btn-cancelar-venta').addEventListener('click', cerrarModalVenta);
    document.getElementById('btn-guardar-venta').addEventListener('click', guardarVenta);

    // Items
    document.getElementById('btn-agregar-item').addEventListener('click', agregarItem);

    // Fecha emision auto-calcula vencimiento
    document.getElementById('v-fecha-emision').addEventListener('change', (e) => {
        document.getElementById('v-fecha-vencimiento').value = calcularVencimiento(e.target.value);
    });

    // Calculo automatico de equivalencia Bs
    document.getElementById('v-monto-total').addEventListener('input', actualizarEquivalenciaBs);
    document.getElementById('v-tasa-bcv').addEventListener('input', actualizarEquivalenciaBs);

    // Modal cliente
    document.getElementById('btn-nuevo-cliente').addEventListener('click', abrirModalCliente);
    document.getElementById('btn-cerrar-modal-cliente').addEventListener('click', cerrarModalCliente);
    document.getElementById('btn-cancelar-cliente').addEventListener('click', cerrarModalCliente);
    document.getElementById('btn-guardar-cliente').addEventListener('click', guardarCliente);

    // Refresh tasa
    document.getElementById('btn-refresh-tasa').addEventListener('click', async () => {
        invalidateTasaCache();
        showAlert('Actualizando tasa BCV...', 'info');
        await actualizarDisplayTasa('#tasa-bcv');
    });

    // Cerrar modales al hacer click fuera
    document.getElementById('modal-venta').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) cerrarModalVenta();
    });
    document.getElementById('modal-cliente').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) cerrarModalCliente();
    });
    document.getElementById('modal-ver-venta').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) cerrarModalVerVenta();
    });
    document.getElementById('modal-facturacion').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) cerrarModalFacturacion();
    });
}

// ============================================
// CONFIGURAR EVENTOS DE FACTURACIÓN (CORREGIDO)
// ============================================

function setupFacturacionListeners() {
    console.log('🔍 Configurando eventos de facturación...');

    const btnCerrar = document.getElementById('btn-cerrar-facturacion');
    const btnCancelar = document.getElementById('btn-cancelar-facturacion');
    const btnGuardar = document.getElementById('btn-guardar-facturacion');
    const btnQuitar = document.getElementById('btn-quitar-facturacion');
    const btnCalcular = document.getElementById('btn-calcular-iva');
    const modal = document.getElementById('modal-facturacion');

    if (btnCerrar) {
        btnCerrar.addEventListener('click', cerrarModalFacturacion);
        console.log('✅ Evento cerrar facturación asignado');
    }

    if (btnCancelar) {
        btnCancelar.addEventListener('click', cerrarModalFacturacion);
        console.log('✅ Evento cancelar facturación asignado');
    }

    if (btnGuardar) {
        btnGuardar.addEventListener('click', function(e) {
            console.log('🔄 Botón Guardar Factura clickeado');
            guardarFacturacion();
        });
        console.log('✅ Evento guardar facturación asignado');
    } else {
        console.error('❌ btn-guardar-facturacion NO ENCONTRADO en el DOM');
    }

    if (btnQuitar) {
        btnQuitar.addEventListener('click', quitarFacturacion);
        console.log('✅ Evento quitar facturación asignado');
    }

    if (btnCalcular) {
        btnCalcular.addEventListener('click', function(e) {
            console.log('🔄 Botón Calcular IVA clickeado');
            calcularIVA();
        });
        console.log('✅ Evento calcular IVA asignado');
    }

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                cerrarModalFacturacion();
            }
        });
        console.log('✅ Evento cerrar modal por click fuera asignado');
    }
}

// ============================================
// CARGAR CLIENTES
// ============================================

async function cargarClientes() {
    try {
        clientesCache = await getClientes();
        actualizarSelectClientes();
    } catch (error) {
        console.error('Error cargando clientes:', error);
    }
}

function actualizarSelectClientes() {
    const select = document.getElementById('v-cliente');
    select.innerHTML = '<option value="">Seleccionar cliente...</option>' +
        clientesCache.map(c => `<option value="${c.id}">${c.razon_social} (${c.rif})</option>`).join('');
}

// ============================================
// CARGAR VENTAS (con infinite scroll)
// ============================================

async function cargarVentas(reiniciar = true) {
    if (reiniciar) {
        paginacion.offset = 0;
        paginacion.fin = false;
        const tbody = document.getElementById('tbody-ventas');
        const observerTarget = document.getElementById('observer-target');
        const indicador = document.getElementById('carga-infinita-indicador');
        tbody.innerHTML = '';
        if (observerTarget) tbody.appendChild(observerTarget);
       
