/**
 * Sistema Diamelab - Dashboard
 * Lógica del panel principal con estadísticas y resumen
 */

document.addEventListener('DOMContentLoaded', async () => {
    console.log('✅ Dashboard: DOM cargado');

    try {
        console.log('🔍 Verificando autenticación...');
        const isAuth = await protectRoute();
        if (!isAuth) {
            console.warn('⛔ No autenticado');
            return;
        }
        console.log('✅ Autenticación OK');

        initNavigation();
        updateUserAvatar();
        console.log('✅ Navegación inicializada');

        console.log('🔍 Cargando tasa BCV...');
        await actualizarDisplayTasa('#tasa-bcv');
        console.log('✅ Tasa BCV cargada');

        console.log('🔍 Cargando estadísticas...');
        await cargarEstadisticas();
        console.log('✅ Estadísticas cargadas');

        console.log('🔍 Cargando ventas recientes...');
        await cargarVentasRecientes();
        console.log('✅ Ventas recientes cargadas');

        document.getElementById('btn-refresh-tasa').addEventListener('click', async () => {
            invalidateTasaCache();
            showAlert('Actualizando tasa BCV...', 'info');
            await actualizarDisplayTasa('#tasa-bcv');
        });

        console.log('✅ Dashboard completamente cargado');

        // ===== FAB: Estado de Cuenta Rápido =====
        await configurarFAB();

    } catch (error) {
        console.error('❌ Error en el dashboard:', error);
        showAlert('Error al cargar el dashboard: ' + error.message, 'error');
    }
});

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
    }
}

// ============================================
// ESTADÍSTICAS
// ============================================

async function cargarEstadisticas() {
    try {
        console.log('🔍 Obteniendo estadísticas...');

        const stats = await getDashboardStats();

        const { data: pagos, error: errorPagos } = await supabaseClient
            .from('pagos')
            .select('validado, venta:ventas!inner(estado)')
            .neq('venta.estado', 'anulada');

        if (errorPagos) throw errorPagos;

        const totalPagos = pagos.length;
        const validados = pagos.filter(p => p.validado === true).length;
        const pendientes = totalPagos - validados;

        const { count: facturadas, error: errorFacturadas } = await supabaseClient
            .from('ventas')
            .select('*', { count: 'exact', head: true })
            .neq('estado', 'anulada')
            .not('numero_factura', 'is', null)
            .neq('numero_factura', '');

        if (errorFacturadas) throw errorFacturadas;

        const { count: pendientesFactura, error: errorPendientesFactura } = await supabaseClient
            .from('ventas')
            .select('*', { count: 'exact', head: true })
            .neq('estado', 'anulada')
            .or('numero_factura.is.null,numero_factura.eq.\'\'');

        if (errorPendientesFactura) throw errorPendientesFactura;

        document.getElementById('stat-total-ventas').textContent = formatUSD(stats.totalVentas);
        document.getElementById('stat-total-pagado').textContent = formatUSD(stats.totalPagado);
        document.getElementById('stat-total-pendiente').textContent = formatUSD(Math.max(0, stats.totalPendiente));
        document.getElementById('stat-pendientes-count').textContent = stats.ventasPendientes;

        document.getElementById('res-pendientes').textContent = stats.ventasPendientes;
        document.getElementById('res-parciales').textContent = stats.ventasParciales;
        document.getElementById('res-pagadas').textContent = stats.ventasPagadas;
        document.getElementById('res-anuladas').textContent = stats.ventasAnuladas;

        document.getElementById('stat-pagos-validados').textContent = validados;
        document.getElementById('stat-pagos-pendientes-validar').textContent = pendientes;
        document.getElementById('stat-facturas-emitidas').textContent = facturadas || 0;
        document.getElementById('stat-facturas-pendientes').textContent = pendientesFactura || 0;

        document.getElementById('stat-card-validados').addEventListener('click', () => {
            window.location.href = 'pagos.html?filtro=validados';
        });
        document.getElementById('stat-card-pendientes').addEventListener('click', () => {
            window.location.href = 'pagos.html?filtro=pendientes';
        });
        document.getElementById('stat-card-facturas-emitidas').addEventListener('click', () => {
            window.location.href = 'ventas.html?filtro=facturadas';
        });
        document.getElementById('stat-card-facturas-pendientes').addEventListener('click', () => {
            window.location.href = 'ventas.html?filtro=pendientes';
        });

        console.log('✅ Estadísticas renderizadas correctamente');

    } catch (error) {
        console.error('❌ Error cargando estadísticas:', error);
        showAlert('Error al cargar las estadísticas: ' + error.message, 'error');
    }
}

// ============================================
// VENTAS RECIENTES (con botón Estado de Cuenta)
// ============================================

async function cargarVentasRecientes() {
    try {
        console.log('🔍 Obteniendo ventas recientes...');
        const ventas = await getVentasRecientes(10);
        console.log('📊 Ventas recientes obtenidas:', ventas.length);

        const tbody = document.getElementById('tbody-ventas-recientes');

        if (!ventas || ventas.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8">
                        <div class="empty-state">
                            <div class="empty-state-icon">📄</div>
                            <h3>Sin notas de entrega</h3>
                            <p>No hay notas de entrega registradas aún. Cree la primera desde el módulo de Ventas.</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = ventas.map(v => {
            const badgeClass = {
                'pendiente': 'badge-pendiente',
                'parcial': 'badge-parcial',
                'pagada': 'badge-pagada',
                'anulada': 'badge-anulada'
            }[v.estado] || 'badge-pendiente';

            const estadoText = {
                'pendiente': 'Pendiente',
                'parcial': 'Parcial',
                'pagada': 'Pagada',
                'anulada': 'Anulada'
            }[v.estado] || v.estado;

            const clienteNombre = v.cliente ? v.cliente.razon_social : 'N/A';
            const today = new Date();
            const vencimiento = new Date(v.fecha_vencimiento);
            const diasRestantes = Math.ceil((vencimiento - today) / (1000 * 60 * 60 * 24));
            const vencimientoClass = diasRestantes < 0 ? 'text-danger' : diasRestantes <= 3 ? 'text-warning' : '';
            const vencimientoText = diasRestantes < 0 ? `Vencido (${Math.abs(diasRestantes)}d)` : `${diasRestantes}d restantes`;

            const tieneFactura = v.numero_factura && v.numero_factura.trim() !== '';
            const montoBase = parseFloat(v.monto_total_usd) || 0;
            const montoIVA = parseFloat(v.monto_iva) || 0;
            const totalConIVA = parseFloat(v.total_con_iva) || montoBase;

            const montoMostrar = tieneFactura ? totalConIVA : montoBase;
            let montoHtml = `<strong>${formatUSD(montoMostrar)}</strong>`;
            if (tieneFactura) {
                montoHtml += `<br><small style="color: var(--gray-500);">Base: ${formatUSD(montoBase)}</small>`;
            }

            // Botón Estado de Cuenta
            const botonEstadoCuenta = v.cliente_id
                ? `<button class="btn btn-sm btn-ghost" onclick="irEstadoCuenta('${v.cliente_id}')" title="Ver Estado de Cuenta del cliente" style="color:var(--diamelab-accent);">📊</button>`
                : '';

            return `
                <tr>
                    <td><strong>${v.correlacion_a2 || 'N/A'}</strong></td>
                    <td>${clienteNombre}</td>
                    <td>${formatDate(v.fecha_emision)}</td>
                    <td class="${vencimientoClass}">${formatDate(v.fecha_vencimiento)} <small>(${vencimientoText})</small></td>
                    <td>${montoHtml}</td>
                    <td><span class="badge ${badgeClass}">${estadoText}</span></td>
                    <td>${v.sede || 'N/A'}</td>
                    <td style="text-align:center;">${botonEstadoCuenta}</td>
                </tr>
            `;
        }).join('');

        console.log('✅ Ventas recientes renderizadas correctamente');

    } catch (error) {
        console.error('❌ Error cargando ventas recientes:', error);
        document.getElementById('tbody-ventas-recientes').innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center;padding:2rem;color:var(--danger);">
                    Error al cargar los datos: ${error.message}
                </td>
            </tr>
        `;
    }
}

// ============================================
// IR A ESTADO DE CUENTA DEL CLIENTE
// ============================================

window.irEstadoCuenta = function(clienteId) {
    if (!clienteId) {
        showAlert('No se puede identificar el cliente.', 'warning');
        return;
    }
    window.location.href = `estado-cuenta.html?cliente=${clienteId}`;
};

// ============================================
// FAB: BOTÓN FLOTANTE PARA ESTADO DE CUENTA
// ============================================

async function configurarFAB() {
    const fabBtn = document.getElementById('fab-estado-cuenta');
    const modal = document.getElementById('modal-fab-cliente');
    const btnCerrar = document.getElementById('btn-cerrar-fab-cliente');
    const btnCancelar = document.getElementById('btn-cancelar-fab-cliente');
    const btnIr = document.getElementById('btn-ir-fab-cliente');
    const inputBusqueda = document.getElementById('fab-buscar-cliente');
    const resultados = document.getElementById('fab-resultados');

    let clientesFab = [];
    let clienteSeleccionadoFab = null;

    async function cargarClientesFab() {
        try {
            clientesFab = await getClientes();
        } catch (error) {
            console.error('Error cargando clientes para FAB:', error);
            showAlert('Error al cargar clientes', 'error');
        }
    }

    function mostrarResultadosFab(query) {
        const q = query.trim().toLowerCase();
        const filtrados = clientesFab.filter(c =>
            c.razon_social.toLowerCase().includes(q) ||
            c.rif.toLowerCase().includes(q)
        ).slice(0, 15);

        if (filtrados.length === 0) {
            resultados.innerHTML = '<div class="item" style="color:var(--gray-400);">No se encontraron clientes</div>';
        } else {
            resultados.innerHTML = filtrados.map(c => `
                <div class="item" data-id="${c.id}" data-nombre="${c.razon_social}" data-rif="${c.rif}">
                    <strong>${c.razon_social}</strong>
                    <div class="rif">${c.rif}</div>
                </div>
            `).join('');
            resultados.querySelectorAll('.item').forEach(el => {
                el.addEventListener('click', () => {
                    const id = el.dataset.id;
                    const nombre = el.dataset.nombre;
                    const rif = el.dataset.rif;
                    clienteSeleccionadoFab = { id, nombre, rif };
                    inputBusqueda.value = nombre + ' (' + rif + ')';
                    btnIr.disabled = false;
                    resultados.style.display = 'none';
                });
            });
        }
        resultados.style.display = 'block';
    }

    fabBtn.addEventListener('click', async () => {
        await cargarClientesFab();
        clienteSeleccionadoFab = null;
        inputBusqueda.value = '';
        resultados.innerHTML = '';
        resultados.style.display = 'none';
        btnIr.disabled = true;
        modal.style.display = 'flex';
        setTimeout(() => inputBusqueda.focus(), 100);
    });

    btnCerrar.addEventListener('click', () => { modal.style.display = 'none'; });
    btnCancelar.addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) modal.style.display = 'none';
    });

    inputBusqueda.addEventListener('input', (e) => {
        const query = e.target.value;
        if (query.length >= 2) {
            mostrarResultadosFab(query);
        } else {
            resultados.style.display = 'none';
            btnIr.disabled = true;
        }
    });

    inputBusqueda.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const primerResultado = resultados.querySelector('.item');
            if (primerResultado) primerResultado.click();
        }
    });

    btnIr.addEventListener('click', () => {
        if (clienteSeleccionadoFab) {
            window.location.href = `estado-cuenta.html?cliente=${clienteSeleccionadoFab.id}`;
        } else {
            showAlert('Seleccione un cliente primero.', 'warning');
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#modal-fab-cliente')) {
            resultados.style.display = 'none';
        }
    });
}

// Exportar funciones globales
window.updateUserAvatar = updateUserAvatar;
window.cargarEstadisticas = cargarEstadisticas;
window.cargarVentasRecientes = cargarVentasRecientes;
window.irEstadoCuenta = irEstadoCuenta;
