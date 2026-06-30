/**
 * Sistema Diamelab - Modulo de Pagos
 * Registro de pagos con comprobantes, retenciones y métodos de Venezuela
 * Incluye funcionalidad de validación de pagos, filtros y resumen
 * AHORA CON SOPORTE PARA IVA EN FACTURAS Y EDICIÓN/ELIMINACIÓN DE PAGOS
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

    await actualizarDisplayTasa('#tasa-bcv');
    await cargarVentasSelect();
    setupEventListenersPagos();

    // Eventos del modal de edición de pago
    document.getElementById('btn-cerrar-editar-pago').addEventListener('click', cerrarModalEditarPago);
    document.getElementById('btn-cancelar-editar-pago').addEventListener('click', cerrarModalEditarPago);
    document.getElementById('btn-guardar-editar-pago').addEventListener('click', guardarEdicionPago);
    document.getElementById('modal-editar-pago').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) cerrarModalEditarPago();
    });

    const urlParams = new URLSearchParams(window.location.search);
    const filtroGlobal = urlParams.get('filtro');
    const ventaId = urlParams.get('venta');

    if (filtroGlobal && !ventaId) {
        document.getElementById('select-venta').disabled = true;
        document.getElementById('buscar-a2').disabled = true;
        document.getElementById('buscar-cliente-pago').disabled = true;
        document.getElementById('btn-buscar-venta').disabled = true;
        document.getElementById('form-pago-card').style.display = 'none';
        document.getElementById('info-venta-card').style.display = 'none';
        document.getElementById('historial-pagos-card').style.display = '';
        await cargarPagosGlobales(filtroGlobal);
        return;
    }

    if (ventaId) {
        document.getElementById('select-venta').value = ventaId;
        await seleccionarVenta(ventaId);
    }

    document.getElementById('filtro-validacion').addEventListener('change', () => renderizarPagos());
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
    document.getElementById('select-venta').addEventListener('change', async (e) => {
        if (e.target.value) {
            await seleccionarVenta(e.target.value);
        } else {
            ocultarDetalleVenta();
        }
    });

    document.getElementById('buscar-a2').addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') await buscarPorA2();
    });
    document.getElementById('btn-buscar-venta').addEventListener('click', buscarPorA2);

    document.getElementById('buscar-cliente-pago').addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') await buscarPorCliente();
    });

    document.getElementById('p-monto').addEventListener('input', actualizarEquivalenciaBsPago);
    document.getElementById('p-tasa').addEventListener('input', actualizarEquivalenciaBsPago);

    document.getElementById('btn-guardar-pago').addEventListener('click', guardarPago);
    document.getElementById('btn-limpiar-pago').addEventListener('click', limpiarFormularioPago);

    document.getElementById('btn-refresh-tasa').addEventListener('click', async () => {
        invalidateTasaCache();
        showAlert('Actualizando tasa BCV...', 'info');
        await actualizarDisplayTasa('#tasa-bcv');
    });

    document.getElementById('p-fecha').value = getTodayISO();
}

// ============================================
// CARGAR VENTAS PARA SELECTOR
// ============================================

async function cargarVentasSelect() {
    try {
        const { data, error } = await supabaseClient
            .from('ventas')
            .select(`
                id,
                correlacion_a2,
                monto_total_usd,
                total_con_iva,
                numero_factura,
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

        const select = document.getElementById('select-venta');
        select.innerHTML = '<option value="">Seleccione una nota de entrega...</option>' +
            ventasCache.map(v => {
                const cliente = v.cliente ? v.cliente.razon_social : 'N/A';
                const saldoInfo = v.estado === 'pagada' ? ' [PAGADA]' : '';
                const facturaInfo = v.numero_factura ? ' 🧾' : '';
                return `<option value="${v.id}">${v.correlacion_a2} - ${cliente} (${v.sede})${saldoInfo}${facturaInfo}</option>`;
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
        let venta = ventasCache.find(v => v.id === ventaId);
        if (!venta) {
            venta = await getVentaById(ventaId);
        }
        ventaSeleccionada = venta;
        pagosCache = await getPagosByVenta(ventaId);

        const tieneFactura = venta.numero_factura && venta.numero_factura.trim() !== '';
        const montoTotalAPagar = tieneFactura ? (venta.total_con_iva || venta.monto_total_usd) : venta.monto_total_usd;
        const montoBase = venta.monto_total_usd;
        const montoIVA = venta.monto_iva || 0;

        const totalPagado = pagosCache.reduce((sum, p) => sum + parseFloat(p.monto_pagado_usd), 0);
        const saldo = montoTotalAPagar - totalPagado;
        const porcentaje = montoTotalAPagar > 0 ? Math.min(100, (totalPagado / montoTotalAPagar) * 100) : 0;

        document.getElementById('info-a2').textContent = venta.correlacion_a2;
        document.getElementById('info-cliente').textContent = venta.cliente ? venta.cliente.razon_social : 'N/A';
        document.getElementById('info-monto').textContent = formatUSD(montoTotalAPagar);
        document.getElementById('info-pagado').textContent = formatUSD(totalPagado);
        document.getElementById('info-saldo').textContent = formatUSD(Math.max(0, saldo));
        document.getElementById('info-porcentaje').textContent = porcentaje.toFixed(0) + '%';
        document.getElementById('barra-progreso').style.width = porcentaje + '%';

        const labelMonto = document.getElementById('info-monto-label');
        if (tieneFactura) {
            labelMonto.textContent = 'Total Factura (USD)';
        } else {
            labelMonto.textContent = 'Monto Total (USD)';
        }

        const containerBase = document.getElementById('info-monto-base-container');
        const containerIVA = document.getElementById('info-iva-container');
        const containerTotalFactura = document.getElementById('info-total-factura-container');

        if (tieneFactura) {
            containerBase.style.display = '';
            document.getElementById('info-monto-base').textContent = formatUSD(montoBase);
            containerIVA.style.display = '';
            document.getElementById('info-iva').textContent = formatUSD(montoIVA);
            containerTotalFactura.style.display = '';
            document.getElementById('info-total-factura').textContent = formatUSD(montoTotalAPagar);
        } else {
            containerBase.style.display = 'none';
            containerIVA.style.display = 'none';
            containerTotalFactura.style.display = 'none';
        }

        const badgeEl = document.getElementById('venta-estado-badge');
        const badgeClasses = {
            'pendiente': 'badge-pendiente',
            'parcial': 'badge-parcial',
            'pagada': 'badge-pagada',
            'anulada': 'badge-anulada'
        };
        badgeEl.className = 'badge ' + (badgeClasses[venta.estado] || 'badge-pendiente');
        const estadoLabels = { 'pendiente': 'Pendiente', 'parcial': 'Parcial', 'pagada': 'Pagada', 'anulada': 'Anulada' };
        badgeEl.textContent = estadoLabels[venta.estado] || venta.estado;

        document.getElementById('info-venta-card').style.display = '';
        document.getElementById('historial-pagos-card').style.display = '';

        if (venta.estado === 'pagada' || saldo <= 0.01) {
            document.getElementById('form-pago-card').style.display = 'none';
        } else {
            document.getElementById('form-pago-card').style.display = '';
            const tasaEl = document.getElementById('p-tasa');
            if (!tasaEl.value) {
                tasaEl.value = venta.tasa_bcv_aplicada;
            }
        }

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
                total_con_iva,
                numero_factura,
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
            document.getElementById('select-venta').value = data[0].id;
            await seleccionarVenta(data[0].id);
        } else {
            const select = document.getElementById('select-venta');
            select.innerHTML = '<option value="">Seleccione una nota...</option>' +
                data.map(v => {
                    const cliente = v.cliente ? v.cliente.razon_social : 'N/A';
                    const facturaInfo = v.numero_factura ? ' 🧾' : '';
                    return `<option value="${v.id}">${v.correlacion_a2} - ${cliente} (${v.sede})${facturaInfo}</option>`;
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

        const clienteIds = clientes.map(c => c.id);
        const { data: ventas, error: vError } = await supabaseClient
            .from('ventas')
            .select(`
                id,
                correlacion_a2,
                monto_total_usd,
                total_con_iva,
                numero_factura,
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

        const select = document.getElementById('select-venta');
        select.innerHTML = '<option value="">Seleccione una nota...</option>' +
            ventas.map(v => {
                const cliente = v.cliente ? v.cliente.razon_social : 'N/A';
                const facturaInfo = v.numero_factura ? ' 🧾' : '';
                return `<option value="${v.id}">${v.correlacion_a2} - ${cliente} (${v.sede})${facturaInfo}</option>`;
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

        const tieneFactura = ventaSeleccionada.numero_factura && ventaSeleccionada.numero_factura.trim() !== '';
        const montoTotalAPagar = tieneFactura ? (ventaSeleccionada.total_con_iva || ventaSeleccionada.monto_total_usd) : ventaSeleccionada.monto_total_usd;
        const totalPagado = pagosCache.reduce((sum, p) => sum + parseFloat(p.monto_pagado_usd), 0);
        const saldo = montoTotalAPagar - totalPagado;

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
            validado: validado
        };

        const comprobanteFile = document.getElementById('p-comprobante').files[0] || null;
        const retIVAFile = document.getElementById('p-ret-iva').files[0] || null;
        const retISLRFile = document.getElementById('p-ret-islr').files[0] || null;

        await createPago(pagoData, comprobanteFile, retIVAFile, retISLRFile);

        hideLoading('#btn-guardar-pago');
        showAlert('Pago registrado exitosamente', 'success');

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
    document.getElementById('p-validado').checked = false;
}

// ============================================
// RENDERIZAR PAGOS CON BOTONES EDITAR/ELIMINAR
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
        actualizarResumen();
        return;
    }

    const filtro = document.getElementById('filtro-validacion').value;
    let pagosFiltrados = pagosCache;

    if (filtro === 'validados') {
        pagosFiltrados = pagosCache.filter(p => p.validado === true);
    } else if (filtro === 'pendientes') {
        pagosFiltrados = pagosCache.filter(p => p.validado !== true);
    }

    if (pagosFiltrados.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--gray-400);">
                No hay pagos ${filtro === 'validados' ? 'validados' : filtro === 'pendientes' ? 'pendientes' : ''} para mostrar.
            </td></tr>
        `;
        actualizarResumen();
        return;
    }

    const isAdminUser = isAdmin();

    tbody.innerHTML = pagosFiltrados.map(p => {
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

        const validado = p.validado === true;
        const badgeValidado = validado 
            ? '<span class="badge badge-pagada">✅ Validado</span>' 
            : '<span class="badge badge-pendiente">⏳ Pendiente</span>';

        let accionesHtml = '';
        if (isAdminUser) {
            accionesHtml = `
                <div style="display: flex; gap: 4px; justify-content: center; margin-top: 4px;">
                    <button class="btn btn-sm btn-ghost" onclick="editarPago('${p.id}')" title="Editar pago" style="color: var(--info);">✏️</button>
                    <button class="btn btn-sm btn-ghost" onclick="eliminarPagoConfirm('${p.id}')" title="Eliminar pago" style="color: var(--danger);">🗑️</button>
                </div>
            `;
        }

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
                <td>
                    ${p.vendedor ? p.vendedor.full_name : 'N/A'}
                    ${accionesHtml}
                </td>
            </tr>
        `;
    }).join('');

    actualizarResumen();
}

function actualizarResumen() {
    const total = pagosCache.length;
    const validados = pagosCache.filter(p => p.validado === true).length;
    const pendientes = total - validados;

    document.getElementById('total-pagos').textContent = total;
    document.getElementById('total-validados').textContent = validados;
    document.getElementById('total-pendientes-validacion').textContent = pendientes;
}

// ============================================
// EDITAR PAGO
// ============================================

window.editarPago = async function(pagoId) {
    if (!isAdmin()) {
        showAlert('Solo los administradores pueden editar pagos.', 'error');
        return;
    }

    try {
        const pago = pagosCache.find(p => p.id === pagoId);
        if (!pago) {
            showAlert('Pago no encontrado.', 'error');
            return;
        }

        document.getElementById('ep-id').value = pago.id;
        document.getElementById('ep-fecha').value = pago.fecha_pago;
        document.getElementById('ep-monto').value = pago.monto_pagado_usd;
        document.getElementById('ep-metodo').value = pago.metodo_pago || '';
        document.getElementById('ep-referencia').value = pago.referencia || '';
        document.getElementById('ep-banco').value = pago.banco_origen || '';
        document.getElementById('ep-tasa').value = pago.tasa_usada;
        document.getElementById('ep-validado').checked = pago.validado === true;

        document.getElementById('modal-editar-pago').style.display = 'flex';
    } catch (error) {
        console.error('Error al cargar pago para editar:', error);
        showAlert('Error al cargar el pago.', 'error');
    }
};

function cerrarModalEditarPago() {
    document.getElementById('modal-editar-pago').style.display = 'none';
}

async function guardarEdicionPago() {
    const pagoId = document.getElementById('ep-id').value;
    const fecha_pago = document.getElementById('ep-fecha').value;
    const monto_pagado_usd = parseFloat(document.getElementById('ep-monto').value);
    const metodo_pago = document.getElementById('ep-metodo').value;
    const referencia = document.getElementById('ep-referencia').value.trim() || null;
    const banco_origen = document.getElementById('ep-banco').value.trim() || null;
    const tasa_usada = parseFloat(document.getElementById('ep-tasa').value);
    const validado = document.getElementById('ep-validado').checked;

    if (!fecha_pago || !monto_pagado_usd || !metodo_pago || !tasa_usada) {
        showAlert('Todos los campos obligatorios deben estar llenos.', 'error');
        return;
    }

    try {
        showLoading('#btn-guardar-editar-pago', 'Actualizando...');

        const data = { fecha_pago, monto_pagado_usd, metodo_pago, referencia, banco_origen, tasa_usada, validado };
        await actualizarPago(pagoId, data);

        hideLoading('#btn-guardar-editar-pago');
        showAlert('Pago actualizado correctamente.', 'success');
        cerrarModalEditarPago();
        await seleccionarVenta(ventaSeleccionada.id);
    } catch (error) {
        hideLoading('#btn-guardar-editar-pago');
        console.error('Error actualizando pago:', error);
        showAlert('Error al actualizar: ' + error.message, 'error');
    }
}

// ============================================
// ELIMINAR PAGO
// ============================================

window.eliminarPagoConfirm = async function(pagoId) {
    if (!isAdmin()) {
        showAlert('Solo los administradores pueden eliminar pagos.', 'error');
        return;
    }

    const confirmado = await confirmAction('⚠️ ¿Está seguro de eliminar este pago? Esta acción no se puede deshacer.');
    if (!confirmado) return;

    try {
        await eliminarPago(pagoId);
        showAlert('Pago eliminado correctamente.', 'success');
        if (ventaSeleccionada) {
            await seleccionarVenta(ventaSeleccionada.id);
        } else {
            const filtro = new URLSearchParams(window.location.search).get('filtro');
            if (filtro) {
                await cargarPagosGlobales(filtro);
            }
        }
    } catch (error) {
        console.error('Error eliminando pago:', error);
        showAlert('Error al eliminar: ' + error.message, 'error');
    }
};

// ============================================
// TOGGLE VALIDACIÓN
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
        await seleccionarVenta(ventaSeleccionada.id);
    } catch (error) {
        console.error('Error actualizando validación:', error);
        showAlert('Error al actualizar la validación: ' + error.message, 'error');
    }
};

// ============================================
// PAGOS GLOBALES
// ============================================

async function cargarPagosGlobales(filtro) {
    try {
        let validado = undefined;
        if (filtro === 'validados') validado = true;
        else if (filtro === 'pendientes') validado = false;

        const data = await getAllPagosConFiltro({ validado });

        const titulo = document.querySelector('#historial-pagos-card .card-header h3');
        if (titulo) {
            const etiqueta = filtro === 'validados' ? '✅ Pagos Validados' : '⏳ Pagos Pendientes de Validar';
            titulo.textContent = `Historial de ${etiqueta}`;
        }

        pagosCache = data;
        ventaSeleccionada = null;

        const total = pagosCache.length;
        const validados = pagosCache.filter(p => p.validado === true).length;
        const pendientes = total - validados;

        document.getElementById('total-pagos').textContent = total;
        document.getElementById('total-validados').textContent = validados;
        document.getElementById('total-pendientes-validacion').textContent = pendientes;

        renderizarPagosGlobales();
    } catch (error) {
        console.error('Error cargando pagos globales:', error);
        showAlert('Error al cargar los pagos: ' + error.message, 'error');
    }
}

function renderizarPagosGlobales() {
    const tbody = document.getElementById('tbody-pagos');

    if (!pagosCache || pagosCache.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="9">
                <div class="empty-state">
                    <div class="empty-state-icon">&#128178;</div>
                    <h3>Sin pagos</h3>
                    <p>No hay pagos que coincidan con el filtro seleccionado.</p>
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

        const validado = p.validado === true;
        const badgeValidado = validado 
            ? '<span class="badge badge-pagada">✅ Validado</span>' 
            : '<span class="badge badge-pendiente">⏳ Pendiente</span>';

        let accionesHtml = '';
        if (isAdminUser) {
            accionesHtml = `
                <div style="display: flex; gap: 4px; justify-content: center; margin-top: 4px;">
                    <button class="btn btn-sm btn-ghost" onclick="editarPago('${p.id}')" title="Editar pago" style="color: var(--info);">✏️</button>
                    <button class="btn btn-sm btn-ghost" onclick="eliminarPagoConfirm('${p.id}')" title="Eliminar pago" style="color: var(--danger);">🗑️</button>
                </div>
            `;
        }

        const btnValidar = isAdminUser 
            ? `<button class="btn btn-sm ${validado ? 'btn-warning' : 'btn-success'}" onclick="toggleValidacionPago('${p.id}', ${validado})" title="${validado ? 'Desmarcar como validado' : 'Marcar como validado'}">
                ${validado ? '↩️' : '✅'}
               </button>`
            : '';

        const ventaInfo = p.venta ? `${p.venta.correlacion_a2} (${p.venta.cliente?.razon_social || 'N/A'})` : 'N/A';

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
                <td>
                    ${p.vendedor ? p.vendedor.full_name : 'N/A'}
                    ${accionesHtml}
                </td>
            </tr>
        `;
    }).join('');
}

// ============================================
// EXPORTAR FUNCIONES GLOBALES
// ============================================
window.seleccionarVenta = seleccionarVenta;
window.buscarPorA2 = buscarPorA2;
window.buscarPorCliente = buscarPorCliente;
window.toggleValidacionPago = toggleValidacionPago;
window.editarPago = editarPago;
window.eliminarPagoConfirm = eliminarPagoConfirm;
