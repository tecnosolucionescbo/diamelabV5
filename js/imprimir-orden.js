/**
 * Módulo de Impresión de Orden de Entrega
 * Formato idéntico al sistema A2 (sin anotaciones manuscritas)
 */

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const ventaId = urlParams.get('ventaId');

    if (!ventaId) {
        document.getElementById('orden-wrapper').innerHTML = `
            <div style="text-align:center;padding:40px;color:#ef4444;">
                <h2>Error</h2>
                <p>No se especificó la orden de entrega.</p>
                <button onclick="window.close()" class="btn btn-secondary">Cerrar</button>
            </div>
        `;
        return;
    }

    try {
        const venta = await getVentaById(ventaId);
        if (!venta) throw new Error('Orden no encontrada');
        renderOrden(venta);

        // Impresión automática tras un breve retraso (para que cargue el contenido)
        setTimeout(() => window.print(), 400);

    } catch (error) {
        console.error('Error cargando orden:', error);
        document.getElementById('orden-wrapper').innerHTML = `
            <div style="text-align:center;padding:40px;color:#ef4444;">
                <h2>Error al cargar la orden</h2>
                <p>${error.message}</p>
                <button onclick="window.close()" class="btn btn-secondary">Cerrar</button>
            </div>
        `;
    }
});

function renderOrden(venta) {
    // Datos de la empresa (ajústalos a tus datos reales)
    const empresa = {
        nombre: 'Diamelab, C.A.',
        rif: 'J-XXXXXXXX-X',
        direccion: 'Av. Principal, Edif. Diamelab, Ciudad Guayana',
        telefono: '0286-XXXXXXX',
        email: 'ventas@diamelab.com'
    };

    // Calcular totales
    const montoTotal = parseFloat(venta.monto_total_usd) || 0;
    const tasa = parseFloat(venta.tasa_bcv_aplicada) || 0;
    const totalBs = montoTotal * tasa;

    // Función auxiliar para formatear números con coma decimal (estilo A2)
    const fmt = (num) => {
        if (num === undefined || num === null || isNaN(num)) return '0,00';
        return num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    // ===== CONSTRUCCIÓN DEL HTML =====
    let html = '';

    // --- Encabezado ---
    html += `
        <div class="header">
            <div class="header-left">
                <img src="assets/logo-diamelab.jpg" alt="Diamelab">
                <div class="empresa">
                    <h1>${empresa.nombre}</h1>
                    <div class="slogan">Equipos e Insumos para Laboratorios Clínicos</div>
                    <div class="rif">RIF: ${empresa.rif}</div>
                </div>
            </div>
            <div class="header-right">
                <div class="titulo-orden">ORDEN DE ENTREGA</div>
                <div class="numero-orden">${venta.correlacion_a2 || 'N/A'}</div>
            </div>
        </div>
    `;

    // --- Información del cliente y fechas ---
    const cliente = venta.cliente || {};
    html += `
        <div class="info-row">
            <div class="info-cliente">
                <p><strong>Cliente:</strong> ${cliente.razon_social || 'N/A'}</p>
                <p><strong>Dirección:</strong> ${cliente.direccion || 'No registrada'}</p>
                <p><strong>R.I.F.:</strong> ${cliente.rif || 'N/A'}</p>
                <p><strong>Teléfono:</strong> ${cliente.telefono || 'N/A'}</p>
            </div>
            <div class="info-fechas">
                <p><strong>Fecha:</strong> ${formatDate(venta.fecha_emision)}</p>
                <p><strong>Vence:</strong> ${formatDate(venta.fecha_vencimiento)}</p>
                <p><strong>Vendedor:</strong> ${venta.vendedor ? venta.vendedor.full_name : 'N/A'}</p>
                <p><strong>Depósito:</strong> ${venta.sede || 'N/A'}</p>
            </div>
        </div>
    `;

    // --- Tabla de productos ---
    html += `
        <table class="tabla-orden">
            <thead>
                <tr>
                    <th style="width:18%;">Código</th>
                    <th style="width:40%;">Descripción</th>
                    <th style="width:12%;text-align:center;">Cantidad</th>
                    <th style="width:15%;text-align:right;">Precio</th>
                    <th style="width:15%;text-align:right;">Total</th>
                </tr>
            </thead>
            <tbody>
    `;

    if (venta.items && venta.items.length > 0) {
        venta.items.forEach(item => {
            html += `
                <tr>
                    <td>${item.codigo_producto || '-'}</td>
                    <td>${item.descripcion || 'Sin descripción'}</td>
                    <td class="text-center">${item.cantidad || 0}</td>
                    <td class="text-right">${fmt(item.precio_unitario_usd)}</td>
                    <td class="text-right"><strong>${fmt(item.total_item_usd)}</strong></td>
                </tr>
            `;
        });
    } else {
        html += `
            <tr>
                <td colspan="5" style="text-align:center;padding:16px;color:#6b7280;">
                    No se registraron productos en esta orden.
                </td>
            </tr>
        `;
    }

    html += `
            </tbody>
        </table>
    `;

    // --- Totales ---
    html += `
        <div class="totales">
            <div class="col">
                <div class="label">Total Neto:</div>
                <div class="valor">${fmt(montoTotal)}</div>
            </div>
            <div class="col">
                <div class="label">Total Operación:</div>
                <div class="valor">${fmt(montoTotal)}</div>
            </div>
            <div class="col">
                <div class="label">Equivalente Bs.</div>
                <div class="valor-bs">${fmt(totalBs)}</div>
            </div>
        </div>
    `;

    // --- Tasa BCV ---
    html += `
        <div class="tasa-info">
            <span>Tasa de Cambio Oficial por el BCV (VES/USD) ${fmt(tasa)}</span>
        </div>
    `;

    // --- Notas / Observaciones (textos fijos de la imagen) ---
    const notasCliente = venta.notas || '';
    html += `
        <div class="notas">
            <p><span class="texto-fijo">LA MERCANCIA VIAJA POR CUENTA Y RIESGO DEL CLIENTE</span></p>
            <p>Cayman Retercash.</p>
            <p>Relacionar Factura en la orden de entrega.</p>
            <p>Diferencia de Tasa</p>
            ${notasCliente ? `<p style="margin-top:4px;"><strong>Observaciones:</strong> ${notasCliente}</p>` : ''}
        </div>
    `;

    // --- Pie fiscal ---
    html += `
        <div class="pie-fiscal">
            <p class="destacado">Documento no válido como factura fiscal.</p>
            <p>Las retenciones de IVA e ISLR se aplicarán al momento del pago según corresponda.</p>
            <p>&copy; ${new Date().getFullYear()} Diamelab, C.A. - Todos los derechos reservados.</p>
            <p style="font-size:9px;">Este documento es una orden de entrega para el control interno y despacho de mercancía.</p>
        </div>
    `;

    // --- Botones (visibles solo en pantalla) ---
    html += `
        <div class="acciones-print">
            <button class="btn-imprimir" onclick="window.print()">🖨️ Imprimir</button>
            <button class="btn-cerrar" onclick="window.close()">Cerrar</button>
        </div>
    `;

    document.getElementById('orden-wrapper').innerHTML = html;
}
