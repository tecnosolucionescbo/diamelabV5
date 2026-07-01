/**
 * Sistema Diamelab - Modulo de Pagos
 * Versión con soporte para IVA, edición de pagos y conversión Bs. a USD
 * CORREGIDO: función toggleValidacionPago maneja modo global sin errores
 * AHORA CON COLUMNA "MONTO (Bs.)" EN EL HISTORIAL
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

    // Eventos del modal de edición
    const btnCerrarEditar = document.getElementById('btn-cerrar-editar-pago');
    if (btnCerrarEditar) btnCerrarEditar.addEventListener('click', cerrarModalEditarPago);

    const btnCancelarEditar = document.getElementById('btn-cancelar-editar-pago');
    if (btnCancelarEditar) btnCancelarEditar.addEventListener('click', cerrarModalEditarPago);

    const btnGuardarEditar = document.getElementById('btn-guardar-editar-pago');
    if (btnGuardarEditar) btnGuardarEditar.addEventListener('click', guardarEdicionPago);

    const modalEditar = document.getElementById('modal-editar-pago');
    if (modalEditar) {
        modalEditar.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) cerrarModalEditarPago();
        });
    }

    // Eventos para cálculo de equivalente en el formulario principal
    const pMonto = document.getElementById('p-monto-bs');
    const pTasa = document.getElementById('p-tasa');
    const pFecha = document.getElementById('p-fecha');

    if (pMonto) {
        pMonto.addEventListener('input', function() {
            console.log('🔁 Evento input en p-monto-bs (principal)');
            calcularEquivalenteUSD('p');
        });
    }
    if (pTasa) {
        pTasa.addEventListener('input', function() {
            console.log('🔁 Evento input en p-tasa (principal)');
            calcularEquivalenteUSD('p');
        });
    }
    if (pFecha) {
        pFecha.addEventListener('change', function() {
            manejarCambioFecha('p');
        });
    }

    // Eventos para el modal de edición
    const epMonto = document.getElementById('ep-monto-bs');
    const epTasa = document.getElementById('ep-tasa');
    const epFecha = document.getElementById('ep-fecha');

    if (epMonto) {
        epMonto.addEventListener('input', function() {
            console.log('🔁 Evento input en ep-monto-bs (edición)');
            calcularEquivalenteUSD('ep');
        });
    }
    if (epTasa) {
        epTasa.addEventListener('input', function() {
            console.log('🔁 Evento input en ep-tasa (edición)');
            calcularEquivalenteUSD('ep');
        });
    }
    if (epFecha) {
        epFecha.addEventListener('change', function() {
            manejarCambioFecha('ep');
        });
    }

    // Verificar URL params
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

    const filtroValidacion = document.getElementById('filtro-validacion');
    if (filtroValidacion) {
        filtroValidacion.addEventListener('change', () => renderizarPagos());
    }
});

// ============================================
// FUNCIÓN DE CONFIGURACIÓN DE EVENTOS (CORREGIDA)
// ============================================
function setupEventListenersPagos() {
    // Select de ventas
    const selectVenta = document.getElementById('select-venta');
    if (selectVenta) {
        selectVenta.addEventListener('change', async (e) => {
            if (e.target.value) {
                await seleccionarVenta(e.target.value);
            } else {
                ocultarDetalleVenta();
            }
        });
    }

    // Búsqueda por A2
    const buscarA2 = document.getElementById('buscar-a2');
    if (buscarA2) {
        buscarA2.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') await buscarPorA2();
        });
    }

    const btnBuscarVenta = document.getElementById('btn-buscar-venta');
    if (btnBuscarVenta) {
        btnBuscarVenta.addEventListener('click', buscarPorA2);
    }

    // Búsqueda por cliente
    const buscarCliente = document.getElementById('buscar-cliente-pago');
    if (buscarCliente) {
        buscarCliente.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') await buscarPorCliente();
        });
    }

    // Guardar y limpiar
    const btnGuardar = document.getElementById('btn-guardar-pago');
    if (btnGuardar) {
        btnGuardar.addEventListener('click', guardarPago);
    }

    const btnLimpiar = document.getElementById('btn-limpiar-pago');
    if (btnLimpiar) {
        btnLimpiar.addEventListener('click', limpiarFormularioPago);
    }

    // Refrescar tasa
    const btnRefresh = document.getElementById('btn-refresh-tasa');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', async () => {
            if (typeof invalidateTasaCache === 'function') invalidateTasaCache();
            if (typeof showAlert === 'function') showAlert('Actualizando tasa BCV...', 'info');
            if (typeof actualizarDisplayTasa === 'function') await actualizarDisplayTasa('#tasa-bcv');
            if (typeof cargarTasaActual === 'function') cargarTasaActual('p');
        });
    }

    // Fecha por defecto
    const pFecha = document.getElementById('p-fecha');
    if (pFecha && typeof getTodayISO === 'function') {
        pFecha.value = getTodayISO();
    }
}

// ============================================
// FUNCIONES AUXILIARES (faltantes)
// ============================================

// Calcula el saldo de una venta sumando todos sus pagos
async function calcularSaldoVenta(ventaId) {
    try {
        // Obtener la venta
        const { data: venta, error: vError } = await supabaseClient
            .from('ventas')
            .select('monto_total_usd, total_con_iva, numero_factura')
            .eq('id', ventaId)
            .single();
        if (vError) throw vError;

        // Obtener los pagos de esa venta
        const { data: pagos, error: pError } = await supabaseClient
            .from('pagos')
            .select('monto_pagado_usd')
            .eq('venta_id', ventaId);
        if (pError) throw pError;

        const totalPagado = pagos.reduce((sum, p) => sum + parseFloat(p.monto_pagado_usd || 0), 0);
        const tieneFactura = venta.numero_factura && venta.numero_factura.trim() !== '';
        const montoTotalAPagar = tieneFactura ? (venta.total_con_iva || venta.monto_total_usd) : venta.monto_total_usd;

        return montoTotalAPagar - totalPagado;
    } catch (error) {
        console.error('Error calculando saldo de venta:', error);
        return 0;
    }
}

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

// ============================================
// CARGAR VENTAS
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
            await cargarTasaActual('p');
            const montoBsInput = document.getElementById('p-monto-bs');
            if (montoBsInput && parseFloat(montoBsInput.value) > 0) {
                calcularEquivalenteUSD('p');
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
// FUNCIONES DE TASA Y EQUIVALENTE
// ============================================

async function cargarTasaActual(prefix) {
    console.log(`🔄 cargarTasaActual('${prefix}')`);

    const tasaTopbar = document.querySelector('.tasa-valor');
    let tasa = null;

    if (tasaTopbar) {
        let tasaTexto = tasaTopbar.textContent.trim();
        let match = tasaTexto.match(/(\d{1,3}(?:[.,]\d{4}))/);
        if (match) {
            tasa = parseFloat(match[1].replace('.', '').replace(',', '.'));
            console.log(`✅ Tasa del topbar: ${tasa}`);
        }
    }

    if (!tasa) {
        try {
            const result = await obtenerTasaBCV();
            if (result && result.tasa) {
                tasa = result.tasa;
                console.log(`✅ Tasa de API: ${tasa}`);
            }
        } catch (error) {
            console.error('❌ Error API:', error);
        }
    }

    if (!tasa) {
        tasa = 623.02;
        console.warn(`⚠️ Tasa por defecto: ${tasa}`);
    }

    const tasaInput = document.getElementById(prefix + '-tasa');
    if (tasaInput) {
        tasaInput.value = tasa;
        tasaInput.dataset.tasaOriginal = tasa;
        console.log(`✅ Tasa cargada en ${prefix}-tasa: ${tasa}`);
    } else {
        console.error(`❌ No se encontró ${prefix}-tasa`);
    }

    calcularEquivalenteUSD(prefix);
}

function calcularEquivalenteUSD(prefix) {
    console.log(`🔄 calcularEquivalenteUSD('${prefix}')`);

    const montoId = prefix + '-monto-bs';
    const tasaId = prefix + '-tasa';
    const displayId = prefix + '-equivalente-usd-display';
    const hiddenId = prefix + '-monto-usd-calculado';

    const montoBsInput = document.getElementById(montoId);
    const tasaInput = document.getElementById(tasaId);
    const displayDiv = document.getElementById(displayId);
    const hiddenInput = document.getElementById(hiddenId);

    if (!montoBsInput) {
        console.error(`❌ No se encontró #${montoId}`);
        return;
    }
    if (!tasaInput) {
        console.error(`❌ No se encontró #${tasaId}`);
        return;
    }
    if (!displayDiv) {
        console.error(`❌ No se encontró #${displayId}`);
        return;
    }
    if (!hiddenInput) {
        console.error(`❌ No se encontró #${hiddenId}`);
        return;
    }

    const montoBs = parseFloat(montoBsInput.value) || 0;
    const tasa = parseFloat(tasaInput.value) || 0;

    console.log(`📊 Monto Bs: ${montoBs}, Tasa: ${tasa}`);

    if (montoBs > 0 && tasa > 0) {
        const usd = montoBs / tasa;
        displayDiv.textContent = '$' + usd.toFixed(2);
        hiddenInput.value = usd.toFixed(2);
        console.log(`✅ USD: $${usd.toFixed(2)}`);
    } else {
        displayDiv.textContent = '$0.00';
        hiddenInput.value = '0';
        console.log('ℹ️ Equivalente en $0.00');
    }
}

function manejarCambioFecha(prefix) {
    const fechaInput = document.getElementById(prefix + '-fecha');
    const tasaInput = document.getElementById(prefix + '-tasa');
    const statusText = document.getElementById(prefix + '-tasa-status');

    if (!fechaInput || !tasaInput) return;

    const fechaSeleccionada = new Date(fechaInput.value);
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const esHoy = fechaSeleccionada.getTime() === hoy.getTime();

    if (esHoy) {
        tasaInput.disabled = true;
        tasaInput.style.background = 'var(--gray-100)';
        if (statusText) {
            statusText.textContent = 'Tasa automática del día (no editable)';
            statusText.style.color = 'var(--gray-500)';
        }
        cargarTasaActual(prefix);
    } else {
        tasaInput.disabled = false;
        tasaInput.style.background = '';
        if (statusText) {
            statusText.textContent = 'Fecha retroactiva - puede ajustar la tasa manualmente';
            statusText.style.color = 'var(--warning)';
        }
        calcularEquivalenteUSD(prefix);
    }
}

// ============================================
// GUARDAR PAGO (CREACIÓN) - CORREGIDO
// ============================================

async function guardarPago() {
    try {
        if (!ventaSeleccionada) {
            showAlert('Seleccione una nota de entrega primero', 'warning');
            return;
        }

        const fechaPago = document.getElementById('p-fecha').value;
        const montoUSD = parseFloat(document.getElementById('p-monto-usd-calculado').value) || 0;
        const metodoPago = document.getElementById('p-metodo').value;
        const tasaUsada = parseFloat(document.getElementById('p-tasa').value);
        const referenciaOriginal = document.getElementById('p-referencia').value.trim() || null;
        const banco = document.getElementById('p-banco').value.trim() || null;
        const validado = document.getElementById('p-validado').checked;

        let errores = [];
        if (!fechaPago) errores.push('La fecha de pago es obligatoria');
        if (montoUSD <= 0) errores.push('El monto en USD debe ser mayor a cero');
        if (!metodoPago) errores.push('Seleccione un metodo de pago');
        if (!tasaUsada || tasaUsada <= 0) errores.push('La tasa BCV es obligatoria');

        if (errores.length > 0) {
            showAlert(errores.join('. '), 'error');
            return;
        }

        // Calcular saldo de la nota seleccionada
        const tieneFactura = ventaSeleccionada.numero_factura && ventaSeleccionada.numero_factura.trim() !== '';
        const montoTotalAPagar = tieneFactura ? (ventaSeleccionada.total_con_iva || ventaSeleccionada.monto_total_usd) : ventaSeleccionada.monto_total_usd;
        const totalPagado = pagosCache.reduce((sum, p) => sum + parseFloat(p.monto_pagado_usd), 0);
        const saldo = montoTotalAPagar - totalPagado;

        // Si el monto pagado es menor o igual al saldo, pago normal
        if (montoUSD <= saldo + 0.01) {
            await guardarPagoSimple(ventaSeleccionada.id, montoUSD, fechaPago, metodoPago, tasaUsada, referenciaOriginal, banco, validado);
            return;
        }

        // ===== EXCEDENTE: Buscar otras notas del cliente con saldo pendiente =====
        const clienteId = ventaSeleccionada.cliente_id;
        if (!clienteId) {
            showAlert('La nota seleccionada no tiene cliente asociado. No se puede distribuir el excedente.', 'error');
            return;
        }

        // 1. Obtener todas las notas del mismo cliente (excepto la actual)
        const { data: otrasNotas, error: errorNotas } = await supabaseClient
            .from('ventas')
            .select(`
                id,
                correlacion_a2,
                monto_total_usd,
                total_con_iva,
                numero_factura,
                estado,
                fecha_emision,
                cliente:clientes(id, razon_social, rif)
            `)
            .eq('cliente_id', clienteId)
            .neq('id', ventaSeleccionada.id)
            .neq('estado', 'pagada')
            .neq('estado', 'anulada')
            .order('fecha_emision', { ascending: false });

        if (errorNotas) throw errorNotas;

        // 2. Calcular saldo de cada nota
        const notasConSaldo = [];
        for (const nota of otrasNotas || []) {
            const saldoNota = await calcularSaldoVenta(nota.id);
            if (saldoNota > 0.01) {
                notasConSaldo.push({ ...nota, saldo: saldoNota });
            }
        }

        if (notasConSaldo.length === 0) {
            const confirmado = await confirmAction(
                `El monto (${formatUSD(montoUSD)}) excede el saldo pendiente (${formatUSD(saldo)}). ` +
                `No hay otras notas de este cliente con saldo pendiente. ¿Desea continuar registrando el pago completo en esta nota?`
            );
            if (!confirmado) return;
            await guardarPagoSimple(ventaSeleccionada.id, montoUSD, fechaPago, metodoPago, tasaUsada, referenciaOriginal, banco, validado);
            return;
        }

        // 3. Mostrar modal de distribución
        await mostrarModalDistribucion(ventaSeleccionada, saldo, montoUSD, notasConSaldo, {
            fechaPago,
            metodoPago,
            tasaUsada,
            referenciaOriginal,
            banco,
            validado
        });

    } catch (error) {
        hideLoading('#btn-guardar-pago');
        console.error('Error guardando pago:', error);
        showAlert('Error al registrar el pago: ' + error.message, 'error');
    }
}

function limpiarFormularioPago() {
    document.getElementById('p-monto-bs').value = '';
    document.getElementById('p-metodo').value = '';
    document.getElementById('p-referencia').value = '';
    document.getElementById('p-banco').value = '';
    document.getElementById('p-comprobante').value = '';
    document.getElementById('p-ret-iva').value = '';
    document.getElementById('p-ret-islr').value = '';
    document.getElementById('p-validado').checked = false;
    document.getElementById('p-equivalente-usd-display').textContent = '$0.00';
    document.getElementById('p-monto-usd-calculado').value = '0';
}

// ============================================
// RENDERIZAR PAGOS (CON COLUMNA MONTO BS.)
// ============================================

function renderizarPagos() {
    const tbody = document.getElementById('tbody-pagos');

    if (!pagosCache || pagosCache.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="10">
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
            <tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--gray-400);">
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

        // === MONTO EN BOLÍVARES ===
        const montoUSD = parseFloat(p.monto_pagado_usd) || 0;
        const tasa = parseFloat(p.tasa_usada) || 0;
        const montoBs = montoUSD * tasa;
        const montoBsFormateado = montoBs.toFixed(2).replace('.', ',');

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
                <td><strong>${formatUSD(montoUSD)}</strong></td>
                <td><strong style="color: var(--diamelab-primary);">Bs. ${montoBsFormateado}</strong></td>
                <td><span class="badge badge-parcial">${metodoLabels[p.metodo_pago] || p.metodo_pago}</span></td>
                <td>${p.referencia || '-'}</td>
                <td>${p.banco_origen || '-'}</td>
                <td>${formatNumber(tasa, 4)}</td>
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
        document.getElementById('ep-metodo').value = pago.metodo_pago || '';
        document.getElementById('ep-referencia').value = pago.referencia || '';
        document.getElementById('ep-banco').value = pago.banco_origen || '';
        document.getElementById('ep-tasa').value = pago.tasa_usada;
        document.getElementById('ep-validado').checked = pago.validado === true;

        const montoUSD = parseFloat(pago.monto_pagado_usd) || 0;
        const tasa = parseFloat(pago.tasa_usada) || 0;
        const montoBs = montoUSD * tasa;
        document.getElementById('ep-monto-bs').value = montoBs.toFixed(2);

        const displayDiv = document.getElementById('ep-equivalente-usd-display');
        const hiddenInput = document.getElementById('ep-monto-usd-calculado');
        if (displayDiv && hiddenInput) {
            displayDiv.textContent = '$' + montoUSD.toFixed(2);
            hiddenInput.value = montoUSD.toFixed(2);
        }

        manejarCambioFecha('ep');

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
    const montoUSD = parseFloat(document.getElementById('ep-monto-usd-calculado').value) || 0;
    const metodo_pago = document.getElementById('ep-metodo').value;
    const referencia = document.getElementById('ep-referencia').value.trim() || null;
    const banco_origen = document.getElementById('ep-banco').value.trim() || null;
    const tasa_usada = parseFloat(document.getElementById('ep-tasa').value);
    const validado = document.getElementById('ep-validado').checked;

    if (!fecha_pago || montoUSD <= 0 || !metodo_pago || !tasa_usada) {
        showAlert('Todos los campos obligatorios deben estar llenos.', 'error');
        return;
    }

    try {
        showLoading('#btn-guardar-editar-pago', 'Actualizando...');

        const data = { fecha_pago, monto_pagado_usd: montoUSD, metodo_pago, referencia, banco_origen, tasa_usada, validado };
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

        if (ventaSeleccionada) {
            await seleccionarVenta(ventaSeleccionada.id);
        } else {
            const urlParams = new URLSearchParams(window.location.search);
            const filtro = urlParams.get('filtro');
            if (filtro) {
                await cargarPagosGlobales(filtro);
            } else {
                renderizarPagos();
            }
        }
    } catch (error) {
        console.error('Error actualizando validación:', error);
        showAlert('Error al actualizar la validación: ' + error.message, 'error');
    }
};

// ============================================
// PAGOS GLOBALES (CON COLUMNA MONTO BS.)
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
            <tr><td colspan="10">
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

        // === MONTO EN BOLÍVARES ===
        const montoUSD = parseFloat(p.monto_pagado_usd) || 0;
        const tasa = parseFloat(p.tasa_usada) || 0;
        const montoBs = montoUSD * tasa;
        const montoBsFormateado = montoBs.toFixed(2).replace('.', ',');

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
                <td><strong>${formatUSD(montoUSD)}</strong></td>
                <td><strong style="color: var(--diamelab-primary);">Bs. ${montoBsFormateado}</strong></td>
                <td><span class="badge badge-parcial">${metodoLabels[p.metodo_pago] || p.metodo_pago}</span></td>
                <td>${p.referencia || '-'}</td>
                <td>${p.banco_origen || '-'}</td>
                <td>${formatNumber(tasa, 4)}</td>
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
// GUARDAR PAGO SIMPLE (una sola nota)
// ============================================

async function guardarPagoSimple(ventaId, montoUSD, fechaPago, metodoPago, tasaUsada, referencia, banco, validado) {
    try {
        showLoading('#btn-guardar-pago', 'Registrando...');

        const user = JSON.parse(localStorage.getItem('diamelab_user') || '{}');

        const pagoData = {
            venta_id: ventaId,
            vendedor_id: user.id,
            fecha_pago: fechaPago,
            monto_pagado_usd: montoUSD,
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
        console.error('Error guardando pago simple:', error);
        showAlert('Error al registrar el pago: ' + error.message, 'error');
        throw error;
    }
}

// ============================================
// MOSTRAR MODAL DE DISTRIBUCIÓN
// ============================================

let distribucionData = null;

async function mostrarModalDistribucion(ventaPrincipal, saldoPrincipal, montoTotal, notasDisponibles, datosPago) {
    const excedente = montoTotal - saldoPrincipal;
    const modal = document.getElementById('modal-distribucion');

    // Guardar datos para usar al confirmar
    distribucionData = {
        ventaPrincipal,
        saldoPrincipal,
        montoTotal,
        excedente,
        notasDisponibles,
        datosPago,
        asignaciones: {}
    };

    // Llenar información
    document.getElementById('d-monto-total').textContent = formatUSD(montoTotal);
    document.getElementById('d-saldo-nota').textContent = formatUSD(saldoPrincipal);
    document.getElementById('d-excedente').textContent = formatUSD(excedente);

    // Llenar tabla de notas disponibles
    const tbody = document.getElementById('d-tbody-notas');
    tbody.innerHTML = '';

    const referenciaBase = datosPago.referenciaOriginal || 'PAGO';

    notasDisponibles.forEach((nota, index) => {
        const refSugerida = `${referenciaBase}-${index + 1}`;
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--gray-100)';
        tr.innerHTML = `
            <td style="padding: 6px 8px; text-align: center;">
                <input type="checkbox" class="d-check-nota" data-id="${nota.id}" ${index === 0 ? 'checked' : ''} style="width: 16px; height: 16px;">
            </td>
            <td style="padding: 6px 8px;">
                <strong>${nota.correlacion_a2}</strong>
                ${nota.numero_factura ? `<br><small style="color: var(--gray-500);">Factura: ${nota.numero_factura}</small>` : ''}
            </td>
            <td style="padding: 6px 8px; text-align: left;">
                <span style="color: var(--danger); font-weight: 600;">${formatUSD(nota.saldo)}</span>
            </td>
            <td style="padding: 6px 8px; text-align: center;">
                <input type="number" class="form-control d-monto-asignar" data-venta-id="${nota.id}" 
                       style="width: 100px; padding: 0.3rem 0.5rem; font-size: 0.875rem; display: inline-block;" 
                       value="${index === 0 ? Math.min(excedente, nota.saldo).toFixed(2) : '0.00'}" 
                       step="0.01" min="0" max="${nota.saldo}">
            </td>
            <td style="padding: 6px 8px;">
                <input type="text" class="form-control d-referencia" data-id="${nota.id}" 
                       style="width: 120px; padding: 0.3rem 0.5rem; font-size: 0.75rem;" 
                       value="${refSugerida}">
            </td>
        `;
        tbody.appendChild(tr);

        // Inicializar asignación
        distribucionData.asignaciones[nota.id] = index === 0 ? Math.min(excedente, nota.saldo) : 0;

        // Eventos para actualizar el total restante al cambiar monto
        const inputMonto = tr.querySelector('.d-monto-asignar');
        const checkbox = tr.querySelector('.d-check-nota');
        const inputRef = tr.querySelector('.d-referencia');

        inputMonto.addEventListener('input', function() {
            const ventaId = this.dataset.ventaId;
            const val = parseFloat(this.value) || 0;
            distribucionData.asignaciones[ventaId] = val;
            // Guardar referencia
            distribucionData.referencias = distribucionData.referencias || {};
            distribucionData.referencias[ventaId] = inputRef.value;
            actualizarExcedenteRestante();
        });

        inputRef.addEventListener('input', function() {
            const ventaId = this.dataset.id;
            distribucionData.referencias = distribucionData.referencias || {};
            distribucionData.referencias[ventaId] = this.value;
        });

        checkbox.addEventListener('change', function() {
            const row = this.closest('tr');
            const inputMonto = row.querySelector('.d-monto-asignar');
            const inputRef = row.querySelector('.d-referencia');
            if (!this.checked) {
                inputMonto.value = '0.00';
                inputMonto.disabled = true;
                inputRef.disabled = true;
                distribucionData.asignaciones[inputMonto.dataset.ventaId] = 0;
            } else {
                inputMonto.disabled = false;
                inputRef.disabled = false;
                // Si el monto es 0, asignar un monto sugerido
                if (parseFloat(inputMonto.value) === 0) {
                    const excedenteRestante = calcularExcedenteRestante();
                    const nota = notasDisponibles.find(n => n.id === inputMonto.dataset.ventaId);
                    if (nota && excedenteRestante > 0) {
                        const maximo = Math.min(excedenteRestante, nota.saldo);
                        inputMonto.value = maximo.toFixed(2);
                        distribucionData.asignaciones[inputMonto.dataset.ventaId] = maximo;
                    }
                }
                actualizarExcedenteRestante();
            }
        });

        // Guardar referencia inicial
        distribucionData.referencias = distribucionData.referencias || {};
        distribucionData.referencias[nota.id] = refSugerida;

        // Si el primer checkbox está marcado, deshabilitar el input de referencia si no se quiere editar, pero lo dejamos editable
    });

    actualizarExcedenteRestante();

    // Mostrar modal
    modal.style.display = 'flex';

    // Eventos del modal
    document.getElementById('btn-cerrar-distribucion').addEventListener('click', cerrarModalDistribucion);
    document.getElementById('btn-cancelar-distribucion').addEventListener('click', cerrarModalDistribucion);
    document.getElementById('btn-confirmar-distribucion').addEventListener('click', confirmarDistribucion);
    modal.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) cerrarModalDistribucion();
    });
}

function cerrarModalDistribucion() {
    document.getElementById('modal-distribucion').style.display = 'none';
    distribucionData = null;
}

function calcularExcedenteRestante() {
    if (!distribucionData) return 0;
    const totalAsignado = Object.values(distribucionData.asignaciones).reduce((sum, v) => sum + v, 0);
    return distribucionData.excedente - totalAsignado;
}

function actualizarExcedenteRestante() {
    const restante = calcularExcedenteRestante();
    document.getElementById('d-excedente-restante').textContent = formatUSD(Math.max(0, restante));
    document.getElementById('d-excedente-restante').style.color = restante < 0 ? 'var(--danger)' : 'var(--diamelab-primary)';
}

async function confirmarDistribucion() {
    if (!distribucionData) return;

    const { ventaPrincipal, saldoPrincipal, montoTotal, notasDisponibles, datosPago, asignaciones, referencias } = distribucionData;

    // Validar que el excedente esté completamente asignado
    const excedente = montoTotal - saldoPrincipal;
    const totalAsignado = Object.values(asignaciones).reduce((sum, v) => sum + v, 0);
    const diferencia = excedente - totalAsignado;

    if (Math.abs(diferencia) > 0.01) {
        showAlert(`Falta asignar ${formatUSD(diferencia)} del excedente. Ajuste los montos.`, 'warning');
        return;
    }

    // Filtrar notas con monto > 0
    const notasSeleccionadas = notasDisponibles.filter(n => asignaciones[n.id] > 0.01);

    // Confirmar con el usuario
    let mensaje = `Se distribuirá el pago de ${formatUSD(montoTotal)} de la siguiente manera:\n`;
    mensaje += `- Nota ${ventaPrincipal.correlacion_a2}: ${formatUSD(saldoPrincipal)}\n`;
    notasSeleccionadas.forEach(n => {
        mensaje += `- Nota ${n.correlacion_a2}: ${formatUSD(asignaciones[n.id])} (Ref: ${referencias[n.id] || 'N/A'})\n`;
    });
    mensaje += '\n¿Desea continuar?';

    const confirmado = await confirmAction(mensaje);
    if (!confirmado) return;

    try {
        showLoading('#btn-confirmar-distribucion', 'Registrando pagos...');

        const user = JSON.parse(localStorage.getItem('diamelab_user') || '{}');
        const comprobanteFile = document.getElementById('p-comprobante').files[0] || null;
        const retIVAFile = document.getElementById('p-ret-iva').files[0] || null;
        const retISLRFile = document.getElementById('p-ret-islr').files[0] || null;

        // Construir lista de pagos a crear
        const pagosData = [];

        // Pago principal (saldo de la nota seleccionada)
        if (saldoPrincipal > 0.01) {
            const refPrincipal = datosPago.referenciaOriginal || 'PAGO';
            pagosData.push({
                venta_id: ventaPrincipal.id,
                vendedor_id: user.id,
                fecha_pago: datosPago.fechaPago,
                monto_pagado_usd: saldoPrincipal,
                tasa_usada: datosPago.tasaUsada,
                metodo_pago: datosPago.metodoPago,
                referencia: refPrincipal,
                banco_origen: datosPago.banco,
                validado: datosPago.validado
            });
        }

        // Pagos para las notas seleccionadas
        for (const nota of notasSeleccionadas) {
            const monto = asignaciones[nota.id] || 0;
            const ref = referencias[nota.id] || `${datosPago.referenciaOriginal || 'PAGO'}-${notasSeleccionadas.indexOf(nota) + 1}`;
            if (monto > 0.01) {
                pagosData.push({
                    venta_id: nota.id,
                    vendedor_id: user.id,
                    fecha_pago: datosPago.fechaPago,
                    monto_pagado_usd: monto,
                    tasa_usada: datosPago.tasaUsada,
                    metodo_pago: datosPago.metodoPago,
                    referencia: ref,
                    banco_origen: datosPago.banco,
                    validado: datosPago.validado
                });
            }
        }

        // Crear todos los pagos con los mismos archivos adjuntos
        await createPagosMultiples(pagosData, comprobanteFile, retIVAFile, retISLRFile);

        hideLoading('#btn-confirmar-distribucion');
        showAlert(`Pago distribuido exitosamente en ${pagosData.length} nota(s).`, 'success');
        cerrarModalDistribucion();
        limpiarFormularioPago();
        await seleccionarVenta(ventaPrincipal.id);

    } catch (error) {
        hideLoading('#btn-confirmar-distribucion');
        console.error('Error creando pagos distribuidos:', error);
        showAlert('Error al registrar los pagos: ' + error.message, 'error');
    }
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
