/**
 * Módulo de Estado de Cuenta por Cliente
 */

let clientesCache = [];
let datosEstado = [];

document.addEventListener('DOMContentLoaded', async () => {
    const isAuth = await protectRoute();
    if (!isAuth) return;

    initNavigation();
    updateUserAvatar();

    await actualizarDisplayTasa('#tasa-bcv');

    // Cargar lista de clientes
    await cargarClientes();

    // Eventos
    document.getElementById('btn-generar').addEventListener('click', generarEstadoCuenta);
    document.getElementById('btn-exportar-excel').addEventListener('click', exportarExcel);
    document.getElementById('btn-exportar-pdf').addEventListener('click', exportarPDF);
    document.getElementById('btn-refresh-tasa').addEventListener('click', async () => {
        invalidateTasaCache();
        await actualizarDisplayTasa('#tasa-bcv');
    });

    // Evento de tecla Enter en el selector de cliente
    document.getElementById('select-cliente').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') generarEstadoCuenta();
    });
});

// ============================================
// CARGAR CLIENTES
// ============================================

async function cargarClientes() {
    try {
        const data = await getClientes();
        clientesCache = data;
        const select = document.getElementById('select-cliente');
        select.innerHTML = '<option value="">Seleccione un cliente...</option>' +
            data.map(c => `<option value="${c.id}">${c.razon_social} (${c.rif})</option>`).join('');
    } catch (error) {
        console.error('Error cargando clientes:', error);
        showAlert('Error al cargar clientes', 'error');
    }
}

// ============================================
// GENERAR ESTADO DE CUENTA
// ============================================

async function generarEstadoCuenta() {
    const clienteId = document.getElementById('select-cliente').value;
    const fechaDesde = document.getElementById('fecha-desde').value;
    const fechaHasta = document.getElementById('fecha-hasta').value;

    if (!clienteId) {
        showAlert('Seleccione un cliente.', 'warning');
        return;
    }

    try {
        showLoading('#btn-generar', 'Generando...');

        // Obtener ventas del cliente con pagos
        const filtros = { cliente_id: clienteId };
        if (fechaDesde) filtros.fecha_desde = fechaDesde;
        if (fechaHasta) filtros.fecha_hasta = fechaHasta;

        const { data: ventas } = await getVentas(filtros, null, 0);

        if (!ventas || ventas.length === 0) {
            hideLoading('#btn-generar');
            showAlert('No hay notas de entrega para este cliente en el período seleccionado.', 'info');
            document.getElementById('resumen-container').style.display = 'none';
            document.getElementById('detalle-container').style.display = 'none';
            return;
        }

        // Obtener el cliente para mostrar su nombre en el reporte
        const cliente = clientesCache.find(c => c.id === clienteId);

        // Procesar datos
        datosEstado = ventas.map(v => {
            const pagos = v.pagos || [];
            const totalPagado = pagos.reduce((sum, p) => sum + parseFloat(p.monto_pagado_usd), 0);
            const montoBase = parseFloat(v.monto_total_usd) || 0;
            const montoIVA = parseFloat(v.monto_iva) || 0;
            const totalConIVA = parseFloat(v.total_con_iva) || montoBase;
            const saldo = totalConIVA - totalPagado;

            // Días de mora (solo si saldo > 0 y vencimiento pasado)
            let diasMora = 0;
            if (saldo > 0.01) {
                const hoy = new Date();
                const vencimiento = new Date(v.fecha_vencimiento);
                if (vencimiento < hoy) {
                    const diff = hoy - vencimiento;
                    diasMora = Math.ceil(diff / (1000 * 60 * 60 * 24));
                }
            }

            return {
                ...v,
                montoBase,
                montoIVA,
                totalConIVA,
                totalPagado,
                saldo,
                diasMora,
                cliente: cliente
            };
        });

        // Calcular resumen
        const totalFacturado = datosEstado.reduce((sum, v) => sum + v.totalConIVA, 0);
        const totalPagado = datosEstado.reduce((sum, v) => sum + v.totalPagado, 0);
        const saldoTotal = totalFacturado - totalPagado;
        const cantidadNotas = datosEstado.length;
        const notasConMora = datosEstado.filter(v => v.diasMora > 0);
        const diasMoraPromedio = notasConMora.length > 0
            ? Math.round(notasConMora.reduce((sum, v) => sum + v.diasMora, 0) / notasConMora.length)
            : 0;

        // Mostrar resumen
        document.getElementById('resumen-container').style.display = '';
        document.getElementById('res-total-facturado').textContent = formatUSD(totalFacturado);
        document.getElementById('res-total-pagado').textContent = formatUSD(totalPagado);
        document.getElementById('res-saldo-pendiente').textContent = formatUSD(saldoTotal);
        document.getElementById('res-cantidad-notas').textContent = cantidadNotas;
        document.getElementById('res-dias-mora').textContent = diasMoraPromedio;

        // Mostrar tabla
        renderizarTabla(datosEstado);
        document.getElementById('detalle-container').style.display = '';

        hideLoading('#btn-generar');

    } catch (error) {
        hideLoading('#btn-generar');
        console.error('Error generando estado de cuenta:', error);
        showAlert('Error al generar el estado de cuenta: ' + error.message, 'error');
    }
}

// ============================================
// RENDERIZAR TABLA
// ============================================

function renderizarTabla(datos) {
    const tbody = document.getElementById('tbody-estado');

    if (!datos || datos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:2rem;color:var(--gray-400);">No hay datos.</td></tr>`;
        return;
    }

    tbody.innerHTML = datos.map(v => {
        const badgeEstado = {
            'pendiente': 'badge-pendiente',
            'parcial': 'badge-parcial',
            'pagada': 'badge-pagada',
            'anulada': 'badge-anulada'
        }[v.estado] || 'badge-pendiente';
        const estadoTexto = { 'pendiente': 'Pendiente', 'parcial': 'Parcial', 'pagada': 'Pagada', 'anulada': 'Anulada' }[v.estado] || v.estado;

        const moraBadge = v.diasMora > 0
            ? `<span class="badge-mora">${v.diasMora} días</span>`
            : `<span class="badge-sin-mora">Sin mora</span>`;

        const facturaTexto = v.numero_factura || '-';

        return `
            <tr>
                <td><strong>${v.correlacion_a2 || 'N/A'}</strong></td>
                <td>${formatDate(v.fecha_emision)}</td>
                <td>${formatDate(v.fecha_vencimiento)}</td>
                <td>${formatUSD(v.montoBase)}</td>
                <td style="color: var(--warning);">${formatUSD(v.montoIVA)}</td>
                <td><strong>${formatUSD(v.totalConIVA)}</strong></td>
                <td><span class="badge ${badgeEstado}">${estadoTexto}</span></td>
                <td>${facturaTexto}</td>
                <td>${formatUSD(v.totalPagado)}</td>
                <td style="color: ${v.saldo > 0.01 ? 'var(--danger)' : 'var(--success)'};">${formatUSD(v.saldo)}</td>
                <td>${moraBadge}</td>
            </tr>
        `;
    }).join('');
}

// ============================================
// EXPORTAR A EXCEL
// ============================================

function exportarExcel() {
    if (!datosEstado || datosEstado.length === 0) {
        showAlert('No hay datos para exportar.', 'warning');
        return;
    }

    // Preparar datos para Excel
    const excelData = datosEstado.map(v => ({
        'Nº Nota': v.correlacion_a2 || '',
        'Fecha Emisión': formatDate(v.fecha_emision),
        'Fecha Vencimiento': formatDate(v.fecha_vencimiento),
        'Monto Base (USD)': v.montoBase,
        'IVA (USD)': v.montoIVA,
        'Total con IVA (USD)': v.totalConIVA,
        'Estado': v.estado,
        'Factura': v.numero_factura || '',
        'Pagado (USD)': v.totalPagado,
        'Saldo (USD)': v.saldo,
        'Días de Mora': v.diasMora
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    XLSX.utils.book_append_sheet(wb, ws, 'EstadoCuenta');

    // Agregar una hoja de resumen
    const resumenData = [
        { 'Concepto': 'Cliente', 'Valor': datosEstado[0]?.cliente?.razon_social || '' },
        { 'Concepto': 'Total Facturado', 'Valor': document.getElementById('res-total-facturado').textContent },
        { 'Concepto': 'Total Pagado', 'Valor': document.getElementById('res-total-pagado').textContent },
        { 'Concepto': 'Saldo Pendiente', 'Valor': document.getElementById('res-saldo-pendiente').textContent },
        { 'Concepto': 'Cantidad de Notas', 'Valor': document.getElementById('res-cantidad-notas').textContent },
        { 'Concepto': 'Días de Mora (Promedio)', 'Valor': document.getElementById('res-dias-mora').textContent },
    ];
    const wsResumen = XLSX.utils.json_to_sheet(resumenData);
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const clienteNombre = datosEstado[0]?.cliente?.razon_social?.replace(/\s/g, '_') || 'cliente';
    a.download = `estado_cuenta_${clienteNombre}_${new Date().toISOString().slice(0,10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============================================
// EXPORTAR A PDF
// ============================================

function exportarPDF() {
    if (!datosEstado || datosEstado.length === 0) {
        showAlert('No hay datos para exportar.', 'warning');
        return;
    }

    // Capturar la tabla y resumen con html2canvas
    const contenedor = document.createElement('div');
    contenedor.style.padding = '20px';
    contenedor.style.fontFamily = 'Arial, sans-serif';
    contenedor.style.background = '#fff';
    contenedor.style.width = '100%';

    // Encabezado
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '20px';
    header.style.borderBottom = '2px solid #1a237e';
    header.style.paddingBottom = '10px';

    const titulo = document.createElement('h1');
    titulo.textContent = 'Estado de Cuenta';
    titulo.style.color = '#1a237e';
    titulo.style.margin = '0';
    header.appendChild(titulo);

    const clienteInfo = document.createElement('div');
    clienteInfo.innerHTML = `<strong>Cliente:</strong> ${datosEstado[0]?.cliente?.razon_social || ''}`;
    clienteInfo.style.fontSize = '16px';
    header.appendChild(clienteInfo);

    contenedor.appendChild(header);

    // Resumen
    const resumenDiv = document.createElement('div');
    resumenDiv.style.display = 'grid';
    resumenDiv.style.gridTemplateColumns = 'repeat(5, 1fr)';
    resumenDiv.style.gap = '10px';
    resumenDiv.style.marginBottom = '20px';
    resumenDiv.style.background = '#f9fafb';
    resumenDiv.style.padding = '15px';
    resumenDiv.style.borderRadius = '8px';
    resumenDiv.style.borderLeft = '4px solid #1a237e';

    const itemsResumen = [
        { label: 'Total Facturado', value: document.getElementById('res-total-facturado').textContent, color: '#1a237e' },
        { label: 'Total Pagado', value: document.getElementById('res-total-pagado').textContent, color: '#22c55e' },
        { label: 'Saldo Pendiente', value: document.getElementById('res-saldo-pendiente').textContent, color: '#ef4444' },
        { label: 'Cantidad Notas', value: document.getElementById('res-cantidad-notas').textContent, color: '#3b82f6' },
        { label: 'Días de Mora', value: document.getElementById('res-dias-mora').textContent, color: '#f59e0b' },
    ];
    itemsResumen.forEach(item => {
        const card = document.createElement('div');
        card.style.textAlign = 'center';
        card.innerHTML = `
            <div style="font-size: 20px; font-weight: 700; color: ${item.color};">${item.value}</div>
            <div style="font-size: 12px; color: #6b7280;">${item.label}</div>
        `;
        resumenDiv.appendChild(card);
    });
    contenedor.appendChild(resumenDiv);

    // Tabla
    const tableContainer = document.createElement('div');
    tableContainer.style.overflowX = 'auto';
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = '12px';

    // Cabecera
    const thead = document.createElement('thead');
    thead.style.background = '#1a237e';
    thead.style.color = '#fff';
    const headerRow = document.createElement('tr');
    const headers = ['Nº Nota', 'Fecha Emisión', 'Vencimiento', 'Base', 'IVA', 'Total', 'Estado', 'Factura', 'Pagado', 'Saldo', 'Mora'];
    headers.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        th.style.padding = '8px 10px';
        th.style.textAlign = 'left';
        th.style.border = '1px solid #1a237e';
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Cuerpo
    const tbody = document.createElement('tbody');
    datosEstado.forEach(v => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #e5e7eb';
        const cells = [
            v.correlacion_a2 || '',
            formatDate(v.fecha_emision),
            formatDate(v.fecha_vencimiento),
            formatUSD(v.montoBase),
            formatUSD(v.montoIVA),
            formatUSD(v.totalConIVA),
            v.estado,
            v.numero_factura || '-',
            formatUSD(v.totalPagado),
            formatUSD(v.saldo),
            v.diasMora > 0 ? `${v.diasMora} días` : 'Sin mora'
        ];
        cells.forEach((text, i) => {
            const td = document.createElement('td');
            td.textContent = text;
            td.style.padding = '6px 10px';
            td.style.border = '1px solid #e5e7eb';
            if (i === 5) td.style.fontWeight = 'bold';
            if (i === 9) td.style.color = v.saldo > 0.01 ? '#ef4444' : '#22c55e';
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableContainer.appendChild(table);
    contenedor.appendChild(tableContainer);

    // Pie de página
    const footer = document.createElement('div');
    footer.style.marginTop = '20px';
    footer.style.textAlign = 'center';
    footer.style.fontSize = '10px';
    footer.style.color = '#9ca3af';
    footer.textContent = `Generado el ${new Date().toLocaleString('es-VE')} - Diamelab, C.A.`;
    contenedor.appendChild(footer);

    // Usar html2canvas para generar la imagen y luego PDF
    showLoading('#btn-exportar-pdf', 'Generando PDF...');

    html2canvas(contenedor, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
    }).then(canvas => {
        const imgData = canvas.toDataURL('image/png');
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

        let heightLeft = pdfHeight;
        let position = 0;

        // Añadir la primera página
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pdf.internal.pageSize.getHeight();

        // Si hay más contenido, añadir páginas adicionales
        while (heightLeft > 0) {
            position = heightLeft - pdfHeight;
            pdf.addPage();
            pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
            heightLeft -= pdf.internal.pageSize.getHeight();
        }

        const clienteNombre = datosEstado[0]?.cliente?.razon_social?.replace(/\s/g, '_') || 'cliente';
        pdf.save(`estado_cuenta_${clienteNombre}_${new Date().toISOString().slice(0,10)}.pdf`);

        hideLoading('#btn-exportar-pdf');
        showAlert('PDF generado correctamente.', 'success');
    }).catch(error => {
        hideLoading('#btn-exportar-pdf');
        console.error('Error generando PDF:', error);
        showAlert('Error al generar el PDF: ' + error.message, 'error');
    });
}
