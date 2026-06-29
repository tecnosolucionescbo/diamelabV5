/**
 * Sistema Diamelab - Modulo de Ventas (Notas de Entrega)
 * CRUD completo con items opcionales, filtros, gestión de clientes y FACTURACIÓN
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

    await actualizarDisplayTasa('#tasa-bcv');
    setupSedeUsuario();
    await cargarClientes();
    await cargarVentas(true);
    setupEventListeners();
    configurarObserver();
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
    // Filtros
    document.getElementById('btn-filtrar').addEventListener('click', () => cargarVentas(true));
    document.getElementById('btn-limpiar').addEventListener('click', limpiarFiltros);
    document.getElementById('filtro-busqueda').addEventListener('input', debounce(() => cargarVentas(true), 400));
    document.getElementById('filtro-estado').addEventListener('change', () => cargarVentas(true));
    document.getElementById('filtro-facturado').addEventListener('change', () => cargarVentas(true));
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
// CONFIGURAR EVENTOS DE FACTURACIÓN
// ============================================

function setupFacturacionListeners() {
    document.getElementById('btn-cerrar-facturacion').addEventListener('click', cerrarModalFacturacion);
    document.getElementById('btn-cancelar-facturacion').addEventListener('click', cerrarModalFacturacion);
    document.getElementById('btn-guardar-facturacion').addEventListener('click', guardarFacturacion);
    document.getElementById('btn-quitar-facturacion').addEventListener('click', quitarFacturacion);
    document.getElementById('btn-calcular-iva').addEventListener('click', calcularIVA);
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
        if (indicador) {
            tbody.appendChild(indicador);
            indicador.style.display = 'none';
        }
    }

    if (paginacion.cargando || paginacion.fin) return;
    paginacion.cargando = true;
    mostrarCargaInfinita(true);

    try {
        const filtros = obtenerFiltros();
        paginacion.filtrosActuales = filtros;

        const { data, count } = await getVentas(
            filtros,
            paginacion.limit,
            paginacion.offset
        );

        if (reiniciar) {
            paginacion.total = count;
        }

        if (data.length === 0) {
            paginacion.fin = true;
            if (paginacion.offset === 0) {
                const tbody = document.getElementById('tbody-ventas');
                tbody.innerHTML = `
                    <tr><td colspan="9">
                        <div class="empty-state">
                            <div class="empty-state-icon">📄</div>
                            <h3>Sin notas de entrega</h3>
                            <p>No se encontraron notas con los filtros aplicados.</p>
                        </div>
                    </td></tr>
                `;
            }
            mostrarCargaInfinita(false);
            paginacion.cargando = false;
            return;
        }

        const tbody = document.getElementById('tbody-ventas');
        const observerTarget = document.getElementById('observer-target');
        const nuevasFilas = data.map(v => generarFilaVenta(v)).join('');

        if (observerTarget) {
            observerTarget.insertAdjacentHTML('beforebegin', nuevasFilas);
        } else {
            tbody.insertAdjacentHTML('beforeend', nuevasFilas);
        }

        paginacion.offset += data.length;
        paginacion.fin = paginacion.offset >= paginacion.total;

        if (paginacion.fin) {
            mostrarCargaInfinita(false);
        }

    } catch (error) {
        console.error('Error cargando ventas:', error);
        showAlert('Error al cargar las notas de entrega', 'error');
    } finally {
        paginacion.cargando = false;
        if (!paginacion.fin) {
            mostrarCargaInfinita(true);
        } else {
            mostrarCargaInfinita(false);
        }
    }
}

function obtenerFiltros() {
    const estado = document.getElementById('filtro-estado').value;
    const sede = document.getElementById('filtro-sede').value;
    const fechaDesde = document.getElementById('filtro-fecha-desde').value;
    const fechaHasta = document.getElementById('filtro-fecha-hasta').value;
    const busqueda = document.getElementById('filtro-busqueda').value.trim();
    const facturado = document.getElementById('filtro-facturado').value;

    const filtros = {};
    if (estado) filtros.estado = estado;
    if (sede) filtros.sede = sede;
    if (fechaDesde) filtros.fecha_desde = fechaDesde;
    if (fechaHasta) filtros.fecha_hasta = fechaHasta;
    if (busqueda) filtros.busqueda = busqueda;
    if (facturado === 'si') filtros.facturado = true;
    if (facturado === 'no') filtros.facturado = false;
    return filtros;
}

function generarFilaVenta(v) {
    const badgeClass = {
        'pendiente': 'badge-pendiente', 'parcial': 'badge-parcial',
        'pagada': 'badge-pagada', 'anulada': 'badge-anulada'
    }[v.estado] || 'badge-pendiente';

    const estadoText = { 'pendiente': 'Pendiente', 'parcial': 'Parcial', 'pagada': 'Pagada', 'anulada': 'Anulada' }[v.estado] || v.estado;
    const clienteNombre = v.cliente ? v.cliente.razon_social : 'N/A';

    const today = new Date();
    const vencimiento = new Date(v.fecha_vencimiento);
    const diasRestantes = Math.ceil((vencimiento - today) / (1000 * 60 * 60 * 24));
    const vencimientoClass = diasRestantes < 0 ? 'text-danger' : diasRestantes <= 3 ? 'text-warning' : '';
    const vencText = diasRestantes < 0 ? 'Vencido' : `${diasRestantes}d`;

    // === FACTURACIÓN ===
    const tieneFactura = v.numero_factura && v.numero_factura.trim() !== '';
    const facturaBadge = tieneFactura
        ? `<span class="badge badge-pagada" style="font-size:0.7rem;">✅ Facturada</span>`
        : `<span class="badge badge-pendiente" style="font-size:0.7rem;">⏳ Pendiente</span>`;
    const facturaNumero = tieneFactura ? v.numero_factura : '-';

    return `
        <tr>
            <td><strong>${v.correlacion_a2 || 'N/A'}</strong></td>
            <td>${clienteNombre}</td>
            <td>${v.sede || 'N/A'}</td>
            <td>${formatDate(v.fecha_emision)}</td>
            <td class="${vencimientoClass}">${formatDate(v.fecha_vencimiento)} <small>(${vencText})</small></td>
            <td><strong>${formatUSD(v.monto_total_usd)}</strong></td>
            <td><span class="badge ${badgeClass}">${estadoText}</span></td>
            <td>
                ${facturaBadge}
                ${tieneFactura ? `<br><small style="font-size:0.7rem;">Factura: ${v.numero_factura}</small>` : ''}
            </td>
            <td>
                <button class="btn btn-sm btn-ghost" onclick="verVenta('${v.id}')" title="Ver detalle">👁️</button>
                <button class="btn btn-sm btn-ghost" onclick="imprimirOrden('${v.id}')" title="Imprimir orden" style="color:var(--diamelab-primary);">🖨️</button>
                <button class="btn btn-sm btn-ghost" onclick="abrirModalFacturacion('${v.id}')" title="Gestionar facturación" style="color:${tieneFactura ? 'var(--success)' : 'var(--warning)'};">🧾</button>
                ${v.estado !== 'anulada' ? `<button class="btn btn-sm btn-ghost" onclick="registrarPago('${v.id}')" title="Registrar pago">💰</button>` : ''}
                ${isAdmin() ? `<button class="btn btn-sm btn-ghost" onclick="eliminarVentaConfirm('${v.id}')" title="Eliminar permanentemente" style="color:var(--danger);" id="btn-eliminar-venta-${v.id}">🗑️</button>` : ''}
                ${isAdmin() || v.estado === 'pendiente' ? `<button class="btn btn-sm btn-ghost" onclick="anularVentaConfirm('${v.id}')" title="Anular">🚫</button>` : ''}
            </td>
        </tr>
    `;
}

function mostrarCargaInfinita(mostrar) {
    let indicador = document.getElementById('carga-infinita-indicador');
    if (!indicador) {
        indicador = document.createElement('tr');
        indicador.id = 'carga-infinita-indicador';
        indicador.innerHTML = `<td colspan="9" style="text-align: center; padding: 1rem;">
            <div class="spinner" style="border-color: var(--gray-200); border-top-color: var(--diamelab-primary);"></div>
            <p style="margin-top: 0.5rem; color: var(--gray-400);">Cargando más notas...</p>
        </td>`;
        const tbody = document.getElementById('tbody-ventas');
        const observerTarget = document.getElementById('observer-target');
        if (observerTarget) {
            observerTarget.before(indicador);
        } else {
            tbody.appendChild(indicador);
        }
    }
    indicador.style.display = mostrar ? '' : 'none';
}

// ============================================
// CONFIGURAR OBSERVER PARA INFINITE SCROLL
// ============================================

function configurarObserver() {
    let target = document.getElementById('observer-target');
    if (!target) {
        target = document.createElement('tr');
        target.id = 'observer-target';
        target.innerHTML = `<td colspan="9" style="height: 20px;"></td>`;
        const tbody = document.getElementById('tbody-ventas');
        tbody.appendChild(target);
    }

    if (observer) observer.disconnect();

    observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !paginacion.cargando && !paginacion.fin) {
            cargarVentas(false);
        }
    }, { rootMargin: '0px 0px 100px 0px' });
    observer.observe(target);
}

// ============================================
// LIMPIAR FILTROS
// ============================================

function limpiarFiltros() {
    document.getElementById('filtro-busqueda').value = '';
    document.getElementById('filtro-estado').value = '';
    document.getElementById('filtro-fecha-desde').value = '';
    document.getElementById('filtro-fecha-hasta').value = '';
    document.getElementById('filtro-facturado').value = '';
    const filtroSede = document.getElementById('filtro-sede');
    if (filtroSede) filtroSede.value = '';
    cargarVentas(true);
}

// ============================================
// MODAL VENTA - CREAR/EDITAR
// ============================================

function abrirModalNuevaVenta() {
    editingVentaId = null;
    document.getElementById('modal-venta-titulo').textContent = 'Nueva Nota de Entrega';
    document.getElementById('form-venta').reset();
    itemsTemp = [];
    renderItemsList();
    document.getElementById('items-container').style.display = 'none';

    const hoy = getTodayISO();
    document.getElementById('v-fecha-emision').value = hoy;
    document.getElementById('v-fecha-vencimiento').value = calcularVencimiento(hoy);
    document.getElementById('v-monto-bs').value = '';

    setupSedeUsuario();
    document.getElementById('modal-venta').style.display = 'flex';
}

function cerrarModalVenta() {
    document.getElementById('modal-venta').style.display = 'none';
    editingVentaId = null;
    itemsTemp = [];
}

function actualizarEquivalenciaBs() {
    const monto = parseFloat(document.getElementById('v-monto-total').value) || 0;
    const tasa = parseFloat(document.getElementById('v-tasa-bcv').value) || 0;
    if (monto > 0 && tasa > 0) {
        document.getElementById('v-monto-bs').value = formatVES(monto, tasa);
    } else {
        document.getElementById('v-monto-bs').value = '';
    }
}

// ============================================
// ITEMS DE VENTA (OPCIONALES)
// ============================================

function agregarItem() {
    const container = document.getElementById('items-container');
    container.style.display = 'block';

    const itemId = generateUUID();
    itemsTemp.push({ id: itemId, codigo_producto: '', descripcion: '', cantidad: 1, precio_unitario_usd: 0, total_item_usd: 0 });
    renderItemsList();
}

function renderItemsList() {
    const list = document.getElementById('items-list');
    if (itemsTemp.length === 0) {
        list.innerHTML = '';
        return;
    }

    list.innerHTML = itemsTemp.map((item, index) => `
        <div class="item-row" data-item-id="${item.id}">
            <input type="text" class="form-control item-codigo" placeholder="Codigo" value="${item.codigo_producto}" onchange="updateItem('${item.id}', 'codigo', this.value)">
            <input type="text" class="form-control item-desc" placeholder="Descripcion" value="${item.descripcion}" onchange="updateItem('${item.id}', 'descripcion', this.value)">
            <input type="number" class="form-control item-cant" placeholder="0" min="0" step="0.01" value="${item.cantidad}" onchange="updateItem('${item.id}', 'cantidad', this.value); calcularTotalItem('${item.id}')">
            <input type="number" class="form-control item-precio" placeholder="0.00" min="0" step="0.01" value="${item.precio_unitario_usd}" onchange="updateItem('${item.id}', 'precio', this.value); calcularTotalItem('${item.id}')">
            <input type="text" class="form-control item-total" placeholder="0.00" value="${item.total_item_usd > 0 ? item.total_item_usd.toFixed(2) : ''}" readonly style="font-weight: 600;">
            <button type="button" class="btn-remove-item" onclick="removeItem('${item.id}')" title="Eliminar">&times;</button>
        </div>
    `).join('');
}

window.updateItem = function(itemId, field, value) {
    const item = itemsTemp.find(i => i.id === itemId);
    if (!item) return;

    switch(field) {
        case 'codigo': item.codigo_producto = value; break;
        case 'descripcion': item.descripcion = value; break;
        case 'cantidad': item.cantidad = parseFloat(value) || 0; break;
        case 'precio': item.precio_unitario_usd = parseFloat(value) || 0; break;
    }
};

window.calcularTotalItem = function(itemId) {
    const item = itemsTemp.find(i => i.id === itemId);
    if (!item) return;

    item.total_item_usd = item.cantidad * item.precio_unitario_usd;
    renderItemsList();

    const totalItems = itemsTemp.reduce((sum, i) => sum + i.total_item_usd, 0);
    if (totalItems > 0) {
        document.getElementById('v-monto-total').value = totalItems.toFixed(2);
        actualizarEquivalenciaBs();
    }
};

window.removeItem = function(itemId) {
    itemsTemp = itemsTemp.filter(i => i.id !== itemId);
    if (itemsTemp.length === 0) {
        document.getElementById('items-container').style.display = 'none';
    }
    renderItemsList();
};

// ============================================
// GUARDAR VENTA
// ============================================

async function guardarVenta() {
    try {
        const correlacion = document.getElementById('v-correlacion').value.trim();
        const clienteId = document.getElementById('v-cliente').value;
        const fechaEmision = document.getElementById('v-fecha-emision').value;
        const fechaVencimiento = document.getElementById('v-fecha-vencimiento').value;
        const sede = document.getElementById('v-sede').value;
        const tasaBcv = parseFloat(document.getElementById('v-tasa-bcv').value);
        const montoTotal = parseFloat(document.getElementById('v-monto-total').value);
        const notas = document.getElementById('v-notas').value.trim();

        let errores = [];
        if (!correlacion) errores.push('El correlativo A2 es obligatorio');
        if (!clienteId) errores.push('Debe seleccionar un cliente');
        if (!fechaEmision) errores.push('La fecha de emision es obligatoria');
        if (!fechaVencimiento) errores.push('La fecha de vencimiento es obligatoria');
        if (!sede) errores.push('Debe seleccionar la sede');
        if (!tasaBcv || tasaBcv <= 0) errores.push('La tasa BCV debe ser mayor a cero');
        if (!montoTotal || montoTotal <= 0) errores.push('El monto total debe ser mayor a cero');

        if (errores.length > 0) {
            showAlert(errores.join('. '), 'error');
            return;
        }

        showLoading('#btn-guardar-venta', 'Guardando...');

        const user = JSON.parse(localStorage.getItem('diamelab_user') || '{}');

        const ventaData = {
            correlacion_a2: correlacion,
            cliente_id: clienteId,
            vendedor_id: user.id,
            sede: sede,
            fecha_emision: fechaEmision,
            fecha_vencimiento: fechaVencimiento,
            monto_total_usd: montoTotal,
            tasa_bcv_aplicada: tasaBcv,
            notas: notas || null
        };

        const itemsValidos = itemsTemp
            .filter(i => i.descripcion && i.cantidad > 0 && i.precio_unitario_usd > 0)
            .map(i => ({
                codigo_producto: i.codigo_producto || null,
                descripcion: i.descripcion,
                cantidad: i.cantidad,
                precio_unitario_usd: i.precio_unitario_usd,
                total_item_usd: i.cantidad * i.precio_unitario_usd
            }));

        await createVenta(ventaData, itemsValidos);

        hideLoading('#btn-guardar-venta');
        showAlert('Nota de entrega creada exitosamente', 'success');
        cerrarModalVenta();
        await cargarVentas(true);

    } catch (error) {
        hideLoading('#btn-guardar-venta');
        console.error('Error guardando venta:', error);
        
        if (error.message && error.message.includes('duplicate key')) {
            showAlert('El correlativo A2 ya existe. Use uno diferente.', 'error');
        } else {
            showAlert('Error al guardar la nota de entrega: ' + error.message, 'error');
        }
    }
}

// ============================================
// VER VENTA (con botón de facturación)
// ============================================

window.verVenta = async function(ventaId) {
    try {
        viewingVentaId = ventaId;
        const venta = await getVentaById(ventaId);

        const badgeClass = {
            'pendiente': 'badge-pendiente', 'parcial': 'badge-parcial',
            'pagada': 'badge-pagada', 'anulada': 'badge-anulada'
        }[venta.estado] || 'badge-pendiente';

        const estadoText = { 'pendiente': 'Pendiente', 'parcial': 'Parcial', 'pagada': 'Pagada', 'anulada': 'Anulada' }[venta.estado] || venta.estado;

        let itemsHtml = '';
        if (venta.items && venta.items.length > 0) {
            itemsHtml = `
                <h4 style="margin: var(--space-md) 0 var(--space-sm); font-size: 1rem; color: var(--gray-700);">Productos</h4>
                <div class="table-container">
                    <table class="table">
                        <thead><tr><th>Código</th><th>Descripción</th><th>Cant.</th><th>Precio Unit.</th><th>Total</th></tr></thead>
                        <tbody>
                            ${venta.items.map(i => `
                                <tr>
                                    <td>${i.codigo_producto || '-'}</td>
                                    <td>${i.descripcion || '-'}</td>
                                    <td>${formatNumber(i.cantidad)}</td>
                                    <td>${formatUSD(i.precio_unitario_usd)}</td>
                                    <td><strong>${formatUSD(i.total_item_usd)}</strong></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        // Información de facturación
        const facturaInfo = venta.numero_factura ? `
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--space-md); margin-bottom: var(--space-md); padding: var(--space-md); background: var(--success-light); border-radius: var(--radius-md); border-left: 4px solid var(--success);">
                <div>
                    <p class="form-label">Nº Factura</p>
                    <p style="font-weight: 700; color: var(--success);">${venta.numero_factura}</p>
                </div>
                <div>
                    <p class="form-label">Fecha Factura</p>
                    <p>${venta.fecha_factura ? formatDate(venta.fecha_factura) : '-'}</p>
                </div>
                <div>
                    <p class="form-label">IVA (16%)</p>
                    <p style="font-weight: 600; color: var(--diamelab-primary);">${formatUSD(venta.monto_iva || 0)}</p>
                </div>
                <div>
                    <p class="form-label">Total con IVA</p>
                    <p style="font-size: 1.1rem; font-weight: 700; color: var(--diamelab-primary);">${formatUSD(venta.total_con_iva || venta.monto_total_usd)}</p>
                </div>
            </div>
        ` : `
            <div style="padding: var(--space-md); background: var(--gray-50); border-radius: var(--radius-md); border-left: 4px solid var(--warning); margin-bottom: var(--space-md);">
                <p style="color: var(--gray-500);">⚠️ Esta nota aún no ha sido facturada. <button class="btn btn-sm btn-success" onclick="abrirModalFacturacion('${venta.id}')">🧾 Facturar</button></p>
            </div>
        `;

        document.getElementById('ver-venta-contenido').innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); margin-bottom: var(--space-md);">
                <div>
                    <p class="form-label">Correlativo A2</p>
                    <p style="font-size: 1.125rem; font-weight: 700;">${venta.correlacion_a2}</p>
                </div>
                <div>
                    <p class="form-label">Estado</p>
                    <span class="badge ${badgeClass}">${estadoText}</span>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); margin-bottom: var(--space-md);">
                <div>
                    <p class="form-label">Cliente</p>
                    <p style="font-weight: 600;">${venta.cliente ? venta.cliente.razon_social : 'N/A'}</p>
                    ${venta.cliente ? `<p style="font-size: 0.875rem; color: var(--gray-500);">RIF: ${venta.cliente.rif}</p>` : ''}
                </div>
                <div>
                    <p class="form-label">Sede</p>
                    <p>${venta.sede}</p>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); margin-bottom: var(--space-md);">
                <div>
                    <p class="form-label">Fecha de Emisión</p>
                    <p>${formatDate(venta.fecha_emision)}</p>
                </div>
                <div>
                    <p class="form-label">Fecha de Vencimiento</p>
                    <p>${formatDate(venta.fecha_vencimiento)}</p>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--space-md); margin-bottom: var(--space-md); padding: var(--space-md); background: var(--gray-50); border-radius: var(--radius-md);">
                <div>
                    <p class="form-label">Monto Total (USD)</p>
                    <p style="font-size: 1.25rem; font-weight: 700; color: var(--diamelab-primary);">${formatUSD(venta.monto_total_usd)}</p>
                </div>
                <div>
                    <p class="form-label">Tasa BCV</p>
                    <p style="font-weight: 600;">${formatNumber(venta.tasa_bcv_aplicada, 4)} Bs./USD</p>
                </div>
                <div>
                    <p class="form-label">Equivalencia Bs.</p>
                    <p style="font-weight: 600;">${formatVES(venta.monto_total_usd, venta.tasa_bcv_aplicada)}</p>
                </div>
            </div>
            ${facturaInfo}
            ${venta.notas ? `
                <div style="margin-bottom: var(--space-md);">
                    <p class="form-label">Notas</p>
                    <p style="padding: var(--space-sm); background: var(--gray-50); border-radius: var(--radius-sm);">${venta.notas}</p>
                </div>
            ` : ''}
            ${itemsHtml}
        `;

        const footer = document.querySelector('#modal-ver-venta .modal-footer');
        if (footer) {
            footer.innerHTML = `
                <button class="btn btn-ghost" id="btn-cerrar-ver">Cerrar</button>
                <button class="btn btn-secondary" onclick="imprimirOrden('${venta.id}')" style="margin-right: 8px;">🖨️ Imprimir</button>
                <button class="btn btn-success" onclick="abrirModalFacturacion('${venta.id}')" style="margin-right: 8px;">🧾 Facturar</button>
                <a href="#" class="btn btn-primary" id="btn-ver-pagos">Ver Pagos</a>
            `;

            document.getElementById('btn-cerrar-ver').addEventListener('click', cerrarModalVerVenta);
            document.getElementById('btn-ver-pagos').addEventListener('click', (e) => {
                e.preventDefault();
                if (viewingVentaId) {
                    window.location.href = `pagos.html?venta=${viewingVentaId}`;
                } else {
                    showAlert('No se pudo identificar la venta.', 'error');
                }
            });
        }

        document.getElementById('modal-ver-venta').style.display = 'flex';

    } catch (error) {
        console.error('Error cargando venta:', error);
        showAlert('Error al cargar el detalle de la venta', 'error');
    }
};

function cerrarModalVerVenta() {
    document.getElementById('modal-ver-venta').style.display = 'none';
    viewingVentaId = null;
}

// ============================================
// FACTURACIÓN - ABRIR MODAL
// ============================================

window.abrirModalFacturacion = async function(ventaId) {
    if (!ventaId) {
        showAlert('No se identificó la nota de entrega.', 'error');
        return;
    }

    try {
        const venta = await getVentaById(ventaId);
        if (!venta) {
            showAlert('No se encontró la nota de entrega.', 'error');
            return;
        }

        document.getElementById('f-venta-id').value = venta.id;
        document.getElementById('f-numero-factura').value = venta.numero_factura || '';
        document.getElementById('f-fecha-factura').value = venta.fecha_factura || '';
        document.getElementById('f-monto-iva').value = venta.monto_iva || '';
        document.getElementById('f-monto-base').value = formatUSD(venta.monto_total_usd);
        document.getElementById('f-total-con-iva').value = formatUSD(venta.total_con_iva || venta.monto_total_usd);

        // Mostrar u ocultar botón "Quitar Factura"
        const btnQuitar = document.getElementById('btn-quitar-facturacion');
        if (venta.numero_factura && venta.numero_factura.trim() !== '') {
            btnQuitar.style.display = '';
        } else {
            btnQuitar.style.display = 'none';
        }

        document.getElementById('modal-facturacion').style.display = 'flex';

    } catch (error) {
        console.error('Error al abrir facturación:', error);
        showAlert('Error al cargar datos de facturación.', 'error');
    }
};

function cerrarModalFacturacion() {
    document.getElementById('modal-facturacion').style.display = 'none';
}

// ============================================
// CALCULAR IVA (16%)
// ============================================

function calcularIVA() {
    const ventaId = document.getElementById('f-venta-id').value;
    if (!ventaId) return;

    // Obtener el monto base de la venta (desde el campo que ya cargamos)
    const montoBaseText = document.getElementById('f-monto-base').value;
    const montoBase = parseFloat(montoBaseText.replace(/[$,]/g, '')) || 0;

    if (montoBase <= 0) {
        showAlert('El monto base debe ser mayor a cero para calcular el IVA.', 'warning');
        return;
    }

    const iva = montoBase * 0.16; // 16% de IVA
    document.getElementById('f-monto-iva').value = iva.toFixed(2);
    const totalConIva = montoBase + iva;
    document.getElementById('f-total-con-iva').value = formatUSD(totalConIva);
}

// ============================================
// GUARDAR FACTURACIÓN
// ============================================

async function guardarFacturacion() {
    const ventaId = document.getElementById('f-venta-id').value;
    const numeroFactura = document.getElementById('f-numero-factura').value.trim();
    const fechaFactura = document.getElementById('f-fecha-factura').value;
    const montoIva = parseFloat(document.getElementById('f-monto-iva').value) || 0;

    if (!numeroFactura) {
        showAlert('Debe ingresar el número de factura.', 'error');
        return;
    }

    if (!fechaFactura) {
        showAlert('Debe seleccionar la fecha de factura.', 'error');
        return;
    }

    try {
        showLoading('#btn-guardar-facturacion', 'Guardando...');

        await actualizarFacturaVenta(ventaId, numeroFactura, montoIva, fechaFactura);

        hideLoading('#btn-guardar-facturacion');
        showAlert('Factura asociada exitosamente.', 'success');
        cerrarModalFacturacion();
        await cargarVentas(true);

        // Si el modal de detalle está abierto, actualizarlo
        if (document.getElementById('modal-ver-venta').style.display === 'flex' && viewingVentaId) {
            await verVenta(viewingVentaId);
        }

    } catch (error) {
        hideLoading('#btn-guardar-facturacion');
        console.error('Error guardando facturación:', error);
        showAlert('Error al guardar: ' + error.message, 'error');
    }
}

// ============================================
// QUITAR FACTURACIÓN
// ============================================

async function quitarFacturacion() {
    const confirmado = await confirmAction('¿Está seguro de eliminar la factura asociada a esta nota?');
    if (!confirmado) return;

    const ventaId = document.getElementById('f-venta-id').value;

    try {
        showLoading('#btn-quitar-facturacion', 'Eliminando...');

        await actualizarFacturaVenta(ventaId, null, 0, null);

        hideLoading('#btn-quitar-facturacion');
        showAlert('Factura eliminada correctamente.', 'success');
        cerrarModalFacturacion();
        await cargarVentas(true);

        if (document.getElementById('modal-ver-venta').style.display === 'flex' && viewingVentaId) {
            await verVenta(viewingVentaId);
        }

    } catch (error) {
        hideLoading('#btn-quitar-facturacion');
        console.error('Error quitando factura:', error);
        showAlert('Error al eliminar la factura: ' + error.message, 'error');
    }
}

// ============================================
// ANULAR VENTA
// ============================================

window.anularVentaConfirm = async function(ventaId) {
    const confirmed = await confirmAction('Esta seguro de anular esta nota de entrega? Esta accion no se puede deshacer.');
    if (!confirmed) return;

    try {
        await anularVenta(ventaId);
        showAlert('Nota de entrega anulada correctamente', 'success');
        await cargarVentas(true);
    } catch (error) {
        console.error('Error anulando venta:', error);
        showAlert('Error al anular la nota de entrega', 'error');
    }
};

// ============================================
// ELIMINAR VENTA (SOLO ADMIN, PERMANENTE)
// ============================================

window.eliminarVentaConfirm = async function(ventaId) {
    if (!isAdmin()) {
        showAlert('Solo los administradores pueden eliminar notas de entrega.', 'error');
        return;
    }

    const confirmado = await confirmAction(
        '⚠️ ¿Está SEGURO de eliminar esta nota de entrega? Esta acción es PERMANENTE y no se puede deshacer. ' +
        'Se eliminarán todos los datos relacionados (ítems y pagos).'
    );
    if (!confirmado) return;

    try {
        const btn = document.getElementById('btn-eliminar-venta-' + ventaId);
        if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

        const { data: pagos, error: pError } = await supabaseClient
            .from('pagos')
            .select('id')
            .eq('venta_id', ventaId);
        if (pError) throw pError;

        if (pagos && pagos.length > 0) {
            const confirmarPagos = await confirmAction(
                `⚠️ Esta nota tiene ${pagos.length} pago(s) registrados. ¿Desea eliminarlos también y continuar?`
            );
            if (!confirmarPagos) {
                if (btn) { btn.textContent = '🗑️'; btn.disabled = false; }
                return;
            }
            for (const pago of pagos) {
                const { error: delPago } = await supabaseClient
                    .from('pagos')
                    .delete()
                    .eq('id', pago.id);
                if (delPago) throw delPago;
            }
        }

        await deleteVenta(ventaId);

        if (btn) { btn.textContent = '✅'; btn.disabled = false; }
        showAlert('Nota de entrega eliminada permanentemente.', 'success');
        await cargarVentas(true);

    } catch (error) {
        const btn = document.getElementById('btn-eliminar-venta-' + ventaId);
        if (btn) { btn.textContent = '🗑️'; btn.disabled = false; }
        console.error('Error eliminando venta:', error);
        showAlert('Error al eliminar: ' + error.message, 'error');
    }
};

// ============================================
// REGISTRAR PAGO (redirige a pagos)
// ============================================

window.registrarPago = function(ventaId) {
    window.location.href = `pagos.html?venta=${ventaId}`;
};

// ============================================
// IMPRIMIR ORDEN DE ENTREGA
// ============================================

window.imprimirOrden = function(ventaId) {
    if (!ventaId) {
        showAlert('No se puede imprimir: falta el identificador de la orden.', 'error');
        return;
    }
    const url = `imprimir-orden.html?ventaId=${ventaId}`;
    const ventana = window.open(url, '_blank', 'width=1024,height=768,scrollbars=yes,resizable=yes');
    if (!ventana) {
        showAlert('Por favor, permita ventanas emergentes para imprimir.', 'warning');
    }
};

// ============================================
// MODAL CLIENTE - NUEVO
// ============================================

function abrirModalCliente() {
    document.getElementById('form-cliente').reset();
    document.getElementById('modal-cliente').style.display = 'flex';
}

function cerrarModalCliente() {
    document.getElementById('modal-cliente').style.display = 'none';
}

async function guardarCliente() {
    try {
        const razon = document.getElementById('c-razon').value.trim();
        const rif = document.getElementById('c-rif').value.trim();
        const direccion = document.getElementById('c-direccion').value.trim() || null;
        const telefono = document.getElementById('c-telefono').value.trim() || null;
        const email = document.getElementById('c-email').value.trim() || null;

        if (!razon) { showAlert('La razon social es obligatoria', 'error'); return; }
        if (!rif) { showAlert('El RIF es obligatorio', 'error'); return; }

        const rifError = validateRIF(rif);
        if (rifError) { showAlert(rifError, 'error'); return; }

        showLoading('#btn-guardar-cliente', 'Guardando...');

        const nuevoCliente = await createCliente({
            razon_social: razon,
            rif: rif,
            direccion: direccion,
            telefono: telefono,
            email: email
        });

        hideLoading('#btn-guardar-cliente');
        showAlert('Cliente creado exitosamente', 'success');
        cerrarModalCliente();

        await cargarClientes();
        document.getElementById('v-cliente').value = nuevoCliente.id;

    } catch (error) {
        hideLoading('#btn-guardar-cliente');
        console.error('Error creando cliente:', error);
        if (error.message && error.message.includes('duplicate')) {
            showAlert('Ya existe un cliente con ese RIF', 'error');
        } else {
            showAlert('Error al crear el cliente: ' + error.message, 'error');
        }
    }
}
