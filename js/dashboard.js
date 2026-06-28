/**
 * Sistema Diamelab - Dashboard
 * Lógica del panel principal con estadísticas y resumen
 */

document.addEventListener('DOMContentLoaded', async () => {
    // Verificar autenticación
    const isAuth = await protectRoute();
    if (!isAuth) return;

    // Inicializar navegación
    initNavigation();
    updateUserAvatar();

    // Cargar tasa BCV
    await actualizarDisplayTasa('#tasa-bcv');

    // Cargar estadísticas
    await cargarEstadisticas();

    // Cargar ventas recientes
    await cargarVentasRecientes();

    // Setup botón refresh tasa
    document.getElementById('btn-refresh-tasa').addEventListener('click', async () => {
        invalidateTasaCache();
        showAlert('Actualizando tasa BCV...', 'info');
        await actualizarDisplayTasa('#tasa-bcv');
    });
});

/**
 * Actualiza el avatar con iniciales del usuario
 */
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

/**
 * Carga las estadísticas del dashboard
 */
async function cargarEstadisticas() {
    try {
        // Obtener todas las ventas según permisos (usando la nueva paginación)
        const { data: ventas, count } = await getVentas({}, null, 0);
        
        // Calcular estadísticas
        let totalVentas = 0;
        let totalPagado = 0;
        let ventasPendientes = 0;
        let ventasPagadas = 0;
        let ventasParciales = 0;
        let ventasAnuladas = 0;

        // IDs de ventas no anuladas para calcular pagos
        const ventasActivasIds = [];

        ventas.forEach(v => {
            const monto = parseFloat(v.monto_total_usd) || 0;
            
            if (v.estado !== 'anulada') {
                totalVentas += monto;
                ventasActivasIds.push(v.id);
            }

            if (v.estado === 'pendiente') ventasPendientes++;
            if (v.estado === 'pagada') ventasPagadas++;
            if (v.estado === 'parcial') ventasParciales++;
            if (v.estado === 'anulada') ventasAnuladas++;
        });

        // Obtener pagos de ventas activas
        if (ventasActivasIds.length > 0) {
            const { data: pagos, error } = await supabaseClient
                .from('pagos')
                .select('monto_pagado_usd, venta_id')
                .in('venta_id', ventasActivasIds);
            
            if (!error && pagos) {
                pagos.forEach(p => {
                    totalPagado += parseFloat(p.monto_pagado_usd) || 0;
                });
            }
        }

        const totalPendiente = totalVentas - totalPagado;

        // Actualizar DOM
        document.getElementById('stat-total-ventas').textContent = formatUSD(totalVentas);
        document.getElementById('stat-total-pagado').textContent = formatUSD(totalPagado);
        document.getElementById('stat-total-pendiente').textContent = formatUSD(Math.max(0, totalPendiente));
        document.getElementById('stat-pendientes-count').textContent = ventasPendientes;

        // Resumen por estado
        document.getElementById('res-pendientes').textContent = ventasPendientes;
        document.getElementById('res-parciales').textContent = ventasParciales;
        document.getElementById('res-pagadas').textContent = ventasPagadas;
        document.getElementById('res-anuladas').textContent = ventasAnuladas;

    } catch (error) {
        console.error('Error cargando estadísticas:', error);
        showAlert('Error al cargar las estadísticas', 'error');
    }
}

/**
 * Carga las ventas recientes en la tabla
 */
async function cargarVentasRecientes() {
    try {
        const ventas = await getVentasRecientes(10);
        const tbody = document.getElementById('tbody-ventas-recientes');

        if (!ventas || ventas.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7">
                        <div class="empty-state">
                            <div class="empty-state-icon">&#128196;</div>
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

            return `
                <tr>
                    <td><strong>${v.correlacion_a2 || 'N/A'}</strong></td>
                    <td>${clienteNombre}</td>
                    <td>${formatDate(v.fecha_emision)}</td>
                    <td class="${vencimientoClass}">${formatDate(v.fecha_vencimiento)} <small>(${vencimientoText})</small></td>
                    <td><strong>${formatUSD(v.monto_total_usd)}</strong></td>
                    <td><span class="badge ${badgeClass}">${estadoText}</span></td>
                    <td>${v.sede || 'N/A'}</td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error('Error cargando ventas recientes:', error);
        document.getElementById('tbody-ventas-recientes').innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 2rem; color: var(--danger);">
                    Error al cargar los datos. Intente recargar la página.
                </td>
            </tr>
        `;
    }
}

// Exportar funciones
window.updateUserAvatar = updateUserAvatar;
window.cargarEstadisticas = cargarEstadisticas;
window.cargarVentasRecientes = cargarVentasRecientes;
