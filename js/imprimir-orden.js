/**
 * Módulo de Impresión de Orden de Entrega
 * Versión limpia: sin logo, sin empresa, sin textos fiscales adicionales
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

        // Impresión automática tras un breve retraso
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
    // Calcular totales
    const montoTotal = parseFloat(venta.monto_total_usd) || 0;
    const tasa = parseFloat(venta.tasa_bcv_aplicada) || 0;

    // Función auxiliar para formatear números con coma decimal (estilo A2)
    const fmt = (num) => {
        if (num === undefined || num === null || isNaN(num)) return '0,00';
        return num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    // ===== CONSTRUCCIÓN DEL HTML =====
    let html = '';

    // --- Encabezado (solo título y número, sin empresa) ---
    html += `
        <div class="header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #1a237e; padding-bottom:12px; margin-bottom:16px;">
            <div style="flex:1;"></div>
            <div style="text-align:center;">
                <div style="font-size:22px; font-weight:700; color:#1a237e; text-transform:uppercase; letter-spacing:1.5px;">Orden de Entrega</div>
                <div style="font-size:18px; font-weight:700; color:#111827; background:#eef2f6; padding:2px 18px; border-radius:4px; display:inline-block; margin-top:2px;">
                    ${venta.correlacion_a2 || 'N/A'}
                </div>
            </div>
            <div style="flex:1;"></div>
        </div>
    `;

    // --- Información del cliente y fechas ---
    const cliente = venta.cliente || {};
    html += `
        <div class="info-row" style="display:flex; justify-content:space-between; margin-bottom:14px; font-size:13px; line-height:1.6; padding:10px 14px; background:#f9fafb; border-radius:6px; border-left:4px solid #1a237e;">
            <div class="info-cliente">
                <p><strong>Cliente:</strong> ${cliente.razon_social || 'N/A'}</p>
                <p><strong>Dirección:</strong> ${cliente.direccion || 'No registrada'}</p>
                <p><strong>R.I.F.:</strong> ${cliente.rif || 'N/A'}</p>
                <p><strong>Teléfono:</strong> ${cliente.telefono || 'N/A'}</p>
            </div>
            <div class="info-fechas" style="text-align:right; white-space:nowrap;">
                <p><strong>Fecha:</strong> ${formatDate(venta.fecha_emision)}</p>
                <p><strong>Vence:</strong> ${formatDate(venta.fecha_vencimiento)}</p>
                <p><strong>Vendedor:</strong> ${venta.vendedor ? venta.vendedor.full_name : 'N/A'}</p>
                <p><strong>Depósito:</strong> ${venta.sede || 'N/A'}</p>
            </div>
        </div>
    `;

    // --- Tabla de productos ---
    html += `
        <table class="tabla-orden" style="width:100%; border-collapse:collapse; font-size:12.5px; margin:14px 0 10px 0; border:1px solid #d1d5db;">
            <thead style="background:#1a237e; color:#fff;">
                <tr>
                    <th style="padding:8px 10px; text-align:left; font-weight:600; font-size:11px; text-transform:uppercase; border:1px solid #1a237e; width:18%;">Código</th>
                    <th style="padding:8px 10px; text-align:left; font-weight:600; font-size:11px; text-transform:uppercase; border:1px solid #1a237e; width:40%;">Descripción</th>
                    <th style="padding:8px 10px; text-align:center; font-weight:600; font-size:11px; text-transform:uppercase; border:1px solid #1a237e; width:12%;">Cantidad</th>
                    <th style="padding:8px 10px; text-align:right; font-weight:600; font-size:11px; text-transform:uppercase; border:1px solid #1a237e; width:15%;">Precio</th>
                    <th style="padding:8px 10px; text-align:right; font-weight:600; font-size:11px; text-transform:uppercase; border:1px solid #1a237e; width:15%;">Total</th>
                </tr>
            </thead>
            <tbody>
    `;

    if (venta.items && venta.items.length > 0) {
        venta.items.forEach(item => {
            html += `
                <tr>
                    <td style="padding:7px 10px; border:1px solid #d1d5db;">${item.codigo_producto || '-'}</td>
                    <td style="padding:7px 10px; border:1px solid #d1d5db;">${item.descripcion || 'Sin descripción'}</td>
                    <td style="padding:7px 10px; border:1px solid #d1d5db; text-align:center;">${item.cantidad || 0}</td>
                    <td style="padding:7px 10px; border:1px solid #d1d5db; text-align:right;">${fmt(item.precio_unitario_usd)}</td>
                    <td style="padding:7px 10px; border:1px solid #d1d5db; text-align:right; font-weight:600;">${fmt(item.total_item_usd)}</td>
                </tr>
            `;
        });
    } else {
        html += `
            <tr>
                <td colspan="5" style="text-align:center;padding:16px;color:#6b7280; border:1px solid #d1d5db;">
                    No se registraron productos en esta orden.
                </td>
            </tr>
        `;
    }

    html += `
            </tbody>
        </table>
    `;

    // --- Totales (solo USD, sin equivalente en Bs.) ---
    html += `
        <div style="display:flex; justify-content:flex-end; gap:40px; font-size:14px; padding:8px 0; border-top:2px solid #e5e7eb; margin-top:6px;">
            <div style="text-align:right;">
                <div style="color:#4b5563; font-weight:500; font-size:13px;">Total Neto:</div>
                <div style="font-weight:700; font-size:18px; color:#1a237e;">${fmt(montoTotal)}</div>
            </div>
            <div style="text-align:right;">
                <div style="color:#4b5563; font-weight:500; font-size:13px;">Total Operación:</div>
                <div style="font-weight:700; font-size:18px; color:#1a237e;">${fmt(montoTotal)}</div>
            </div>
        </div>
    `;

    // --- Tasa BCV (solo el valor, sin texto adicional) ---
    html += `
        <div style="text-align:right; margin-top:8px; font-size:13px; color:#1f2937; font-weight:500; padding:4px 0;">
            <span style="background:#f3f4f6; padding:3px 14px; border-radius:4px;">
                Tasa BCV: ${fmt(tasa)} Bs./USD
            </span>
        </div>
    `;

    // --- Notas / Observaciones (solo el texto fijo y notas del cliente) ---
    const notasCliente = venta.notas || '';
    html += `
        <div style="margin-top:18px; padding:10px 14px; background:#f9fafb; border-radius:6px; font-size:12px; color:#374151; border-left:3px solid #f59e0b;">
            <p style="font-weight:600; color:#1a237e;">LA MERCANCIA VIAJA POR CUENTA Y RIESGO DEL CLIENTE</p>
            ${notasCliente ? `<p style="margin-top:4px;"><strong>Observaciones:</strong> ${notasCliente}</p>` : ''}
        </div>
    `;

    // --- Pie (sin textos fiscales, sin copyright) ---
    html += `
        <div style="margin-top:20px; padding-top:10px; border-top:1px dashed #d1d5db; font-size:10px; color:#6b7280; text-align:center; line-height:1.6;">
            <p>Documento interno de control de despacho.</p>
        </div>
    `;

    // --- Botones (visibles solo en pantalla) ---
    html += `
        <div style="text-align:center; margin-top:25px;" class="no-print">
            <button onclick="window.print()" style="padding:8px 24px; margin:0 8px; border:none; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; background:#1a237e; color:#fff;">🖨️ Imprimir</button>
            <button onclick="window.close()" style="padding:8px 24px; margin:0 8px; border:none; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; background:#e5e7eb; color:#1f2937;">Cerrar</button>
        </div>
    `;

    document.getElementById('orden-wrapper').innerHTML = html;
}
