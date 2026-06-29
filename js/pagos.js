/**
 * Sistema Diamelab - Modulo de Pagos
 * Registro de pagos con comprobantes, retenciones y métodos de Venezuela
 * Incluye funcionalidad de validación de pagos
 */

// Estado global
let ventasCache = [];
let ventaSeleccionada = null;
let pagosCache = [];

document.addEventListener('DOMContentLoaded', async () => {
    const isAuth = await protectRoute();
    if (!isAuth) return;

    initNavigation();
    updateUserAvatarPagos();

    // Cargar tasa BCV
    await actualizarDisplayTasa('#tasa-bcv');

    // Cargar ventas para selector
    await cargarVentasSelect();

    // Setup event listeners
    setupEventListenersPagos();

    // Verificar si hay venta en URL params
    const urlParams = new URLSearchParams(window.location.search);
    const ventaId = urlParams.get('venta');
    if (ventaId) {
        document.getElementById('select-venta').value = ventaId;
        await seleccionarVenta(ventaId);
    }
});

// ============================================
// INICIALIZACION
// ============================================

function updateUserAvatarPagos() {
    const user = JSON.parse(localStorage.getItem('diamelab_user') || '{}');
    const avatarEl = document.getElementById('user-avatar');
    if (avatarEl && user.full_name) {
        const initials = user.full_name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
        avatarEl.textContent = initials;
    }
}

function setupEventListenersPagos() {
    // Selector de venta
    document.getElementById('select-venta').addEventListener('change', async (e) => {
        if (e.target.value) {
            await seleccionarVenta(e.target.value);
        } else {
            ocultarDetalleVenta();
        }
    });

    // Buscar por A2
    document.getElementById('buscar-a2').addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') await buscarPorA2();
    });
    document.getElementById('btn-buscar-venta').addEventListener('click', buscarPorA2);

    // Buscar por cliente
    document.getElementById('buscar-cliente-pago').addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') await buscarPorCliente();
    });

    // Calcular equivalencia Bs. al cambiar monto o tasa
    document.getElementById('p-monto').addEventListener('input', actualizarEquivalenciaBsPago);
    document.getElementById('p-tasa').addEventListener('input', actualizarEquivalenciaBsPago);

    // Botones
    document.getElementById('btn-guardar-pago').addEventListener('click', guardarPago);
    document.getElementById('btn-limpiar-pago').addEventListener('click', limpiarFormularioPago);

    // Refresh tasa
    document.getElementById('btn-refresh-tasa').addEventListener('click', async () => {
        invalidateTasaCache();
        showAlert('Actualizando tasa BCV...', 'info');
        await actualizarDisplayTasa('#tasa-bcv');
    });

    // Set fecha de hoy
    document.getElementById('p-fecha').value = getTodayISO();
}

// ============================================
// CARGAR VENTAS PARA SELECTOR
// ============================================

async function cargarVentasSelect() {
    try {
        // Cargar ventas pendientes, parciales y pagadas (no anuladas)
        const { data, error } = await supabaseClient
            .from('ventas')
            .select(`
                id,
                correlacion_a2,
                monto_total_usd,
                estado,
                sede,
                fecha_emision,
                fecha_vencimiento,
                cliente:clientes(id, razon_social, rif)
            `)
            .neq('estado', 'anulada')
            .order('fecha_emision', { ascending: false });

        if (error) throw error;
        ventasCache = data || [];

        // Actualizar select
        const select = document.getElementById('select-venta');
        select.innerHTML = '<option value="">Seleccione una nota de entrega...</option>' +
            ventasCache.map(v => {
                const cliente = v.cliente ? v.cliente.razon_social : 'N/A';
                const saldoInfo = v.estado === 'pagada' ? ' [PAGADA]' : '';
                return `<option value="${v.id}">${v.correlacion_a2} - ${cliente} (${v.sede})${saldoInfo}</option>`;
            }).join('');

    } catch (error) {
        console.error('Error cargando ventas:', error);
        showAlert('Error al cargar las notas de entrega', 'error');
    }
}

// ============================================
// SELECCIONAR VENTA
// ============================================

async function seleccionarVenta(ventaId) {
    try {
        // Buscar en cache o cargar
        let venta = ventasCache.find(v => v.id === ventaId);
        if (!venta) {
            venta = await getVentaById(ventaId);
        }
        ventaSeleccionada = venta;

        // Cargar pagos de esta venta
        pagosCache = await getPagosByVenta(ventaId);

        // Calcular totales
        const totalPagado = pagosCache.reduce((sum, p) => sum + parseFloat(p.monto_pagado_usd), 0);
        const saldo = parseFloat(venta.monto_total_usd) - totalPagado;
        const porcentaje = parseFloat(venta.monto_total_usd) > 0 
            ? Math.min(100, (totalPagado / parseFloat(venta.monto_total_usd)) * 100) 
            : 0;

        // Actualizar UI info
        document.getElementById('info-a2').textContent = venta.correlacion_a2;
        document.getElementById('info-cliente').textContent = venta.cliente ? venta.cliente.razon_social : 'N/A';
        document.getElementById('info-monto').textContent = formatUSD(venta.monto_total_usd);
        document.getElementById('info-pagado').textContent = formatUSD(totalPagado);
        document.getElementById('info-saldo').textContent = formatUSD(Math.max(0, saldo));
        document.getElementById('info-porcentaje').textContent = porcentaje.toFixed(0) + '%';
        document.getElementById('barra-progreso').style.width = porcentaje + '%';

        // Badge de estado
        const badgeEl = document.getElementById('venta-estado-badge');
        const badgeClasses = {
            'pendiente': 'badge-pendiente',
            'parcial': 'badge-parcial',
            'pagada': 'badge-pagada',
            'anulada': 'badge-anulada'
        };
        badgeEl.className = 'badge ' + (badgeClasses[venta.estado] || 'badge-pendiente');
        badgeEl.textContent = { 'pendiente': 'Pendiente', 'parcial': 'Parcial', 'pagada': 'Pagada', 'anulada': 'Anulada' }[venta.estado] || venta.estado;

        // Mostrar cards
        document.getElementById('info-venta-card').style.display = '';
        document.getElementById('historial-pagos-card').style.display = '';

        // Mostrar formulario solo si no está pagada completamente
        if (venta.estado === 'pagada') {
            document.getElementById('form-pago-card').style.display = 'none';
        } else {
            document.getElementById('form-pago-card').style.display = '';
            // Prellenar tasa BCV
            const tasaEl = document.getElementById('p-tasa');
            if (!tasaEl.value) {
                tasaEl.value = venta.tasa_bcv_aplicada;
            }
        }

        // Renderizar pagos
        renderizarPagos();

    } catch (error) {
        console.error('Error seleccionando venta:', error);
        showAlert('Error al cargar la informacion de la nota', 'error');
    }
}

function ocultarDetalleVenta() {
    ventaSeleccionada = null;
    pagosCache = [];
    document.getElementById('info-venta-card').style.display = 'none';
    document.getElementById('form-pago-card').style.display = 'none';
    document.getElementById('historial-pagos-card').style.display = 'none';
}

// ============================================
// BUSCAR VENTAS
// ============================================

async function buscarPorA2() {
    const a2 = document.getElementById('buscar-a2').value.trim();
    if (!a2) {
        showAlert('Ingrese un correlativo A2 para buscar', 'warning');
        return;
    }

    try {
        const { data, error } = await supabaseClient
            .from('ventas')
            .select(`
                id,
                correlacion_a2,
                monto_total_usd,
                estado,
                sede,
                fecha_emision,
                fecha_vencimiento,
                cliente:clientes(id, razon_social, rif)
            `)
            .ilike('correlacion_a2', `%${a2}%`)
            .neq('estado', 'anulada')
            .limit(10);

        if (error) throw error;

        if (!data || data.length === 0) {
            showAlert('No se encontro ninguna nota con ese correlativo', 'warning');
            return;
        }

        if (data.length === 1) {
            // Seleccionar automaticamente
            document.getElementById('select-venta').value = data[0].id;
            await seleccionarVenta(data[0].id);
        } else {
            // Actualizar select con resultados
            const select = document.getElementById('select-venta');
            select.innerHTML = '<option value="">Seleccione una nota...</option>' +
                data.map(v => {
                    const cliente = v.cliente ? v.cliente.razon_social : 'N/A';
                    return `<option value="${v.id}">${v.correlacion_a2} - ${cliente} (${v.sede})</option>`;
                }).join('');
            showAlert(`Se encontraron ${data.length} notas. Seleccione del listado.`, 'info');
        }

    } catch (error) {
        console.error('Error buscando:', error);
        showAlert('Error al buscar la nota', 'error');
    }
}

async function buscarPorCliente() {
    const query = document.getElementById('buscar-cliente-pago').value.trim();
    if (!query) {
        showAlert('Ingrese un nombre o RIF para buscar', 'warning');
        return;
    }

    try {
        // Primero buscar clientes
        const { data: clientes, error: cError } = await supabaseClient
            .from('clientes')
            .select('id, razon_social, rif')
            .or(`razon_social.ilike.%${query}%,rif.ilike.%${query}%`)
            .limit(10);

        if (cError) throw cError;

        if (!clientes || clientes.length === 0) {
            showAlert('No se encontro ningun cliente con ese criterio', 'warning');
            return;
        }

        // Buscar ventas de esos clientes
        const clienteIds = clientes.map(c => c.id);
        const { data: ventas, error: vError } = await supabaseClient
            .from('ventas')
            .select(`
                id,
                correlacion_a2,
                monto_total_usd,
                estado,
                sede,
                fecha_emision,
                fecha_vencimiento,
                cliente:clientes(id, razon_social, rif)
            `)
            .in('cliente_id', clienteIds)
            .neq('estado', 'anulada')
            .order('fecha_emision', { ascending: false })
            .limit(20);

        if (vError) throw vError;

        if (!ventas || ventas.length === 0) {
            showAlert('No se encontraron notas para ese cliente', 'warning');
            return;
        }

        // Actualizar select
        const select = document.getElementById('select-venta');
        select.innerHTML = '<option value="">Seleccione una nota...</option>' +
            ventas.map(v => {
                const cliente = v.cliente ? v.cliente.razon_social : 'N/A';
                return `<option value="${v.id}">${v.correlacion_a2} - ${cliente} (${v.sede})</option>`;
            }).join('');

        showAlert(`Se encontraron ${ventas.length} notas. Seleccione del listado.`, 'info');

    } catch (error) {
        console.error('Error buscando por cliente:', error);
        showAlert('Error al buscar', 'error');
    }
}

// ============================================
// CALCULAR EQUIVALENCIA BS
// ============================================

function actualizarEquivalenciaBsPago() {
    const monto = parseFloat(document.getElementById('p-monto').value) || 0;
    const tasa = parseFloat(document.getElementById('p-tasa').value) || 0;
    const el = document.getElementById('p-monto-bs');
    if (monto > 0 && tasa > 0) {
        el.value = formatVES(monto, tasa);
    } else {
        el.value = '';
    }
}

// ============================================
// GUARDAR PAGO
// ============================================

async function guardarPago() {
    try {
        if (!ventaSeleccionada) {
            showAlert('Seleccione una nota de entrega primero', 'warning');
            return;
        }

        // Validar campos
        const fechaPago = document.getElementById('p-fecha').value;
        const montoPagado = parseFloat(document.getElementById('p-monto').value);
        const metodoPago = document.getElementById('p-metodo').value;
        const tasaUsada = parseFloat(document.getElementById('p-tasa').value);
        const referencia = document.getElementById('p-referencia').value.trim() || null;
        const banco = document.getElementById('p-banco').value.trim() || null;
        const validado = document.getElementById('p-validado').checked;

        let errores = [];
        if (!fechaPago) errores.push('La fecha de pago es obligatoria');
        if (!montoPagado || montoPagado <= 0) errores.push('El monto pagado debe ser mayor a cero');
        if (!metodoPago) errores.push('Seleccione un metodo de pago');
        if (!tasaUsada || tasaUsada <= 0) errores.push('La tasa BCV es obligatoria');

        if (errores.length > 0) {
            showAlert(errores.join('. '), 'error');
            return;
        }

        // Verificar que no pase del saldo
        const totalPagado = pagosCache.reduce((sum, p) => sum + parseFloat(p.monto_pagado_usd), 0);
        const saldo = parseFloat(ventaSeleccionada.monto_total_usd) - totalPagado;
        if (montoPagado > saldo + 0.01) {
            const confirmed = await confirmAction(`El monto (${formatUSD(montoPagado)}) excede el saldo pendiente (${formatUSD(saldo)}). Desea continuar?`);
            if (!confirmed) return;
        }

        showLoading('#btn-guardar-pago', 'Registrando...');

        const user = JSON.parse(localStorage.getItem('diamelab_user') || '{}');

        const pagoData = {
            venta_id: ventaSeleccionada.id,
            vendedor_id: user.id,
            fecha_pago: fechaPago,
            monto_pagado_usd: montoPagado,
            tasa_usada: tasaUsada,
            metodo_pago: metodoPago,
            referencia: referencia,
            banco_origen: banco,
            validado: validado // <-- NUEVO CAMPO
        };

        // Archivos
        const comprobanteFile = document.getElementById('p-comprobante').files[0] || null;
        const retIVAFile = document.getElementById('p-ret-iva').files[0] || null;
        const retISLRFile = document.getElementById('p-ret-islr').files[0] || null;

        await createPago(pagoData, comprobanteFile, retIVAFile, retISLRFile);

        hideLoading('#btn-guardar-pago');
        showAlert('Pago registrado exitosamente', 'success');

        // Recargar datos
        limpiarFormularioPago();
        await seleccionarVenta(ventaSeleccionada.id);

    } catch (error) {
        hideLoading('#btn-guardar-pago');
        console.error('Error guardando pago:', error);
        showAlert('Error al registrar el pago: ' + error.message, 'error');
    }
}

function limpiarFormularioPago() {
    document.getElementById('p-monto').value = '';
    document.getElementById('p-metodo').value = '';
    document.getElementById('p-referencia').value = '';
    document.getElementById('p-banco').value = '';
    document.getElementById('p-comprobante').value = '';
    document.getElementById('p-ret-iva').value = '';
    document.getElementById('p-ret-islr').value = '';
    document.getElementById('p-monto-bs').value = '';
    document.getElementById('p-validado').checked = false; // Limpiar checkbox
    // Mantener fecha y tasa
}

// ============================================
// RENDERIZAR PAGOS (con columna Validado)
// ============================================

function renderizarPagos() {
    const tbody = document.getElementById('tbody-pagos');

    if (!pagosCache || pagosCache.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="9">
                <div class="empty-state">
                    <div class="empty-state-icon">&#128178;</div>
                    <h3>Sin pagos registrados</h3>
                    <p>Aun no se han registrado pagos para esta nota de entrega.</p>
                </div>
            </td></tr>
        `;
        return;
    }

    const isAdminUser = isAdmin();

    tbody.innerHTML = pagosCache.map(p => {
        const metodoLabels = {
            'Transferencia': 'Transferencia',
            'Pago Movil': 'Pago Movil',
            'Divisas Efectivo': 'Divisas Efectivo',
            'Bs Efectivo': 'Bs. Efectivo',
            'Zelle': 'Zelle',
            'Binance': 'Binance'
        };

        let comprobantesHtml = '-';
        const comps = [];
        if (p.comprobante_url) comps.push(`<a href="${p.comprobante_url}" target="_blank" style="color: var(--info); font-weight: 500;">Pago</a>`);
        if (p.retencion_iva_url) comps.push(`<a href="${p.retencion_iva_url}" target="_blank" style="color: var(--warning); font-weight: 500;">IVA</a>`);
        if (p.retencion_islr_url) comps.push(`<a href="${p.retencion_islr_url}" target="_blank" style="color: var(--diamelab-primary); font-weight: 500;">ISLR</a>`);
        if (comps.length > 0) comprobantesHtml = comps.join(' | ');

        // Estado de validación
        const validado = p.validado === true;
        const badgeValidado = validado 
            ? '<span class="badge badge-pagada">✅ Validado</span>' 
            : '<span class="badge badge-pendiente">⏳ Pendiente</span>';

        // Botón para cambiar validación (solo admin)
        const btnValidar = isAdminUser 
            ? `<button class="btn btn-sm ${validado ? 'btn-warning' : 'btn-success'}" onclick="toggleValidacionPago('${p.id}', ${validado})" title="${validado ? 'Desmarcar como validado' : 'Marcar como validado'}">
                ${validado ? '↩️' : '✅'}
               </button>`
            : '';

        return `
            <tr>
                <td>${formatDate(p.fecha_pago)}</td>
                <td><strong>${formatUSD(p.monto_pagado_usd)}</strong></td>
                <td><span class="badge badge-parcial">${metodoLabels[p.metodo_pago] || p.metodo_pago}</span></td>
                <td>${p.referencia || '-'}</td>
                <td>${p.banco_origen || '-'}</td>
                <td>${formatNumber(p.tasa_usada, 4)}</td>
                <td>${comprobantesHtml}</td>
                <td style="text-align: center;">
                    ${badgeValidado}
                    <div style="margin-top: 4px;">${btnValidar}</div>
                </td>
                <td>${p.vendedor ? p.vendedor.full_name : 'N/A'}</td>
            </tr>
        `;
    }).join('');
}

// ============================================
// TOGGLE VALIDACIÓN DE PAGO (NUEVA FUNCIÓN)
// ============================================

window.toggleValidacionPago = async function(pagoId, estadoActual) {
    if (!isAdmin()) {
        showAlert('Solo los administradores pueden validar pagos.', 'error');
        return;
    }

    const nuevoEstado = !estadoActual;
    const mensaje = nuevoEstado ? 'marcar como validado' : 'desmarcar como validado';
    const confirmado = await confirmAction(`¿Está seguro de ${mensaje} este pago?`);
    if (!confirmado) return;

    try {
        await actualizarValidacionPago(pagoId, nuevoEstado);
        showAlert(`Pago ${nuevoEstado ? 'validado' : 'desmarcado'} correctamente.`, 'success');
        // Recargar la lista de pagos
        await seleccionarVenta(ventaSeleccionada.id);
    } catch (error) {
        console.error('Error actualizando validación:', error);
        showAlert('Error al actualizar la validación: ' + error.message, 'error');
    }
};

// ============================================
// EXPORTAR FUNCIONES GLOBALES
// ============================================
window.seleccionarVenta = seleccionarVenta;
window.buscarPorA2 = buscarPorA2;
window.buscarPorCliente = buscarPorCliente;
window.toggleValidacionPago = toggleValidacionPago;
