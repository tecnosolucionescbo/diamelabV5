/**
 * Módulo de Estado de Cuenta por Cliente
 * Versión sin duplicación de debounce (usa la de utils.js)
 */

let clientesCache = [];
let datosEstado = [];
let clienteSeleccionado = null;
let timeoutGenerar = null;

document.addEventListener('DOMContentLoaded', async () => {
    const isAuth = await protectRoute();
    if (!isAuth) return;

    initNavigation();
    updateUserAvatar();

    await actualizarDisplayTasa('#tasa-bcv');

    // Cargar clientes
    await cargarClientes();

    // Leer parámetro de URL
    const urlParams = new URLSearchParams(window.location.search);
    const clienteIdUrl = urlParams.get('cliente');

    // Fechas: Desde vacío, Hasta = hoy
    const hoy = new Date();
    document.getElementById('fecha-desde').value = '';
    document.getElementById('fecha-hasta').value = hoy.toISOString().split('T')[0];

    // Eventos
    document.getElementById('btn-generar').addEventListener('click', generarEstadoCuenta);
    document.getElementById('btn-exportar-excel').addEventListener('click', exportarExcel);
    document.getElementById('btn-exportar-pdf').addEventListener('click', exportarPDF);
    document.getElementById('btn-refresh-tasa').addEventListener('click', async () => {
        invalidateTasaCache();
        await actualizarDisplayTasa('#tasa-bcv');
    });

    // Buscador de clientes (usa debounce de utils.js)
    const inputBusqueda = document.getElementById('cliente-busqueda');
    const resultados = document.getElementById('resultados-clientes');
    const selectClientes = document.getElementById('cliente-select');

    // Debounce para el input
    inputBusqueda.addEventListener('input', debounce(async (e) => {
        const query = e.target.value.trim();
        if (query.length < 2) {
            resultados.style.display = 'none';
            return;
        }
        const filtrados = clientesCache.filter(c =>
            c.razon_social.toLowerCase().includes(query.toLowerCase()) ||
            c.rif.toLowerCase().includes(query.toLowerCase())
        ).slice(0, 15);

        if (filtrados.length === 0) {
            resultados.innerHTML = '<div class="item" style="color:var(--gray-400);">No se encontraron clientes</div>';
            resultados.style.display = 'block';
            return;
        }

        resultados.innerHTML = filtrados.map(c => `
            <div class="item" data-id="${c.id}" data-nombre="${c.razon_social}" data-rif="${c.rif}">
                <strong>${c.razon_social}</strong>
                <div class="rif">${c.rif}</div>
            </div>
        `).join('');
        resultados.style.display = 'block';

        resultados.querySelectorAll('.item').forEach(el => {
            el.addEventListener('click', () => {
                seleccionarCliente(el.dataset.id, el.dataset.nombre, el.dataset.rif);
                resultados.style.display = 'none';
                clearTimeout(timeoutGenerar);
                timeoutGenerar = setTimeout(() => generarEstadoCuenta(), 300);
            });
        });
    }, 300));

    // Evento del selector desplegable
    selectClientes.addEventListener('change', () => {
        const id = selectClientes.value;
        if (id) {
            const cliente = clientesCache.find(c => c.id === id);
            if (cliente) {
                seleccionarCliente(cliente.id, cliente.razon_social, cliente.rif);
                clearTimeout(timeoutGenerar);
                timeoutGenerar = setTimeout(() => generarEstadoCuenta(), 300);
            }
        } else {
            document.getElementById('cliente-busqueda').value = '';
            document.getElementById('cliente-seleccionado').value = '';
            clienteSeleccionado = null;
        }
    });

    // Cerrar resultados al hacer click fuera
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.busqueda-wrapper')) {
            resultados.style.display = 'none';
        }
    });

    // Enter en el buscador
    inputBusqueda.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const primerResultado = resultados.querySelector('.item');
            if (primerResultado) {
                primerResultado.click();
            }
        }
    });

    // Si vino con clienteId en URL
    if (clienteIdUrl) {
        const cliente = clientesCache.find(c => c.id === clienteIdUrl);
        if (cliente) {
            seleccionarCliente(cliente.id, cliente.razon_social, cliente.rif);
            setTimeout(() => generarEstadoCuenta(), 500);
        }
    }
});

// ============================================
// FUNCIÓN PARA SELECCIONAR CLIENTE
// ============================================

function seleccionarCliente(id, nombre, rif) {
    const input = document.getElementById('cliente-busqueda');
    const hidden = document.getElementById('cliente-seleccionado');
    const select = document.getElementById('cliente-select');

    input.value = nombre + ' (' + rif + ')';
    hidden.value = id;
    clienteSeleccionado = clientesCache.find(c => c.id === id);
    select.value = id;
    document.getElementById('resultados-clientes').style.display = 'none';
}

// ============================================
// CARGAR CLIENTES
// ============================================

async function cargarClientes() {
    try {
        clientesCache = await getClientes();
        const select = document.getElementById('cliente-select');
        select.innerHTML = '<option value="">Seleccionar de la lista...</option>' +
            clientesCache.map(c => `<option value="${c.id}">${c.razon_social} (${c.rif})</option>`).join('');
    } catch (error) {
        console.error('Error cargando clientes:', error);
        showAlert('Error al cargar clientes', 'error');
    }
}

// ============================================
// GENERAR ESTADO DE CUENTA
// ============================================

async function generarEstadoCuenta() {
    const clienteId = document.getElementById('cliente-seleccionado').value;
    const fechaDesde = document.getElementById('fecha-desde').value;
    const fechaHasta = document.getElementById('fecha-hasta').value;

    if (!clienteId) {
        showAlert('Seleccione un cliente.', 'warning');
        return;
    }

    try {
        showLoading('#btn-generar', 'Generando...');

        clienteSeleccionado = clientesCache.find(c => c.id === clienteId);

        let query = supabaseClient
            .from('ventas')
            .select(`
                *,
                cliente:clientes(razon_social, rif),
                pagos:pagos(*)
            `)
            .eq('cliente_id', clienteId)
            .neq('estado', 'anulada');

        if (fechaDesde && fechaDesde.trim() !== '') {
            query = query.gte('fecha_emision', fechaDesde);
        }
        if (fechaHasta && fechaHasta.trim() !== '') {
            const fechaFin = new Date(fechaHasta);
            fechaFin.setDate(fechaFin.getDate() + 1);
            const fechaFinStr = fechaFin.toISOString().split('T')[0];
            query = query.lt('fecha_emision', fechaFinStr);
        }

        query = query.order('fecha_emision', { ascending: false });

        const { data: ventas, error } = await query;

        if (error) throw error;

        if (!ventas || ventas.length === 0) {
            hideLoading('#btn-generar');
            showAlert('No hay notas de entrega para este cliente en el período seleccionado.', 'info');
            document.getElementById('resumen-container').style.display = 'none';
            document.getElementById('detalle-container').style.display = 'none';
            return;
        }

        // Procesar datos
        datosEstado = ventas.map(v => {
            const pagos = v.pagos || [];
            const totalPagado = pagos.reduce((sum, p) => sum + parseFloat(p.monto_pagado_usd), 0);
            const montoBase = parseFloat(v.monto_total_usd) || 0;
            const montoIVA = parseFloat(v.monto_iva) || 0;
            const totalConIVA = parseFloat(v.total_con_iva) || montoBase;
            const saldo = totalConIVA - totalPagado;

            let diasMora = 0;
            if (saldo > 0.01) {
                const hoy = new Date();
                hoy.setHours(0, 0, 0, 0);
                const vencimiento = new Date(v.fecha_vencimiento);
                vencimiento.setHours(0, 0, 0, 0);
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
                cliente: clienteSeleccionado
            };
        });

        // Resumen
        const totalFacturado = datosEstado.reduce((sum, v) => sum + v.totalConIVA, 0);
        const totalPagado = datosEstado.reduce((sum, v) => sum + v.totalPagado, 0);
        const saldoTotal = totalFacturado - totalPagado;
        const cantidadNotas = datosEstado.length;
        const notasConMora = datosEstado.filter(v => v.diasMora > 0);
        const diasMoraPromedio = notasConMora.length > 0
            ? Math.round(notasConMora.reduce((sum, v) => sum + v.diasMora, 0) / notasConMora.length)
            : 0;

        document.getElementById('resumen-container').style.display = '';
        document.getElementById('res-total-facturado').textContent = formatUSD(totalFacturado);
        document.getElementById('res-total-pagado').textContent = formatUSD(totalPagado);
        document.getElementById('res-saldo-pendiente').textContent = formatUSD(saldoTotal);
        document.getElementById('res-cantidad-notas').textContent = cantidadNotas;
        document.getElementById('res-dias-mora').textContent = diasMoraPromedio;

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

    const resumenData = [
        { 'Concepto': 'Cliente', 'Valor': clienteSeleccionado?.razon_social || '' },
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
    const clienteNombre = clienteSeleccionado?.razon_social?.replace(/\s/g, '_') || 'cliente';
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

    showLoading('#btn-exportar-pdf', 'Generando PDF...');

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('l', 'mm', 'a4');

        // Membrete simplificado
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(26, 35, 126);
        doc.text('Diamelab, C.A.', 14, 22);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(100);
        doc.text('Equipos e Insumos para Laboratorios Clínicos', 14, 28);

        doc.setDrawColor(26, 35, 126);
        doc.setLineWidth(0.5);
        doc.line(14, 32, 284, 32);

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0);
        doc.text('ESTADO DE CUENTA', 14, 40);

        const cliente = clienteSeleccionado || {};
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(60);
        doc.text(`Cliente: ${cliente.razon_social || ''}`, 14, 46);
        doc.text(`RIF: ${cliente.rif || ''}`, 14, 52);

        const resumenY = 60;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        const resumenItems = [
            { label: 'Total Facturado', value: document.getElementById('res-total-facturado').textContent, color: [26, 35, 126] },
            { label: 'Total Pagado', value: document.getElementById('res-total-pagado').textContent, color: [34, 197, 94] },
            { label: 'Saldo Pendiente', value: document.getElementById('res-saldo-pendiente').textContent, color: [239, 68, 68] },
            { label: 'Cantidad Notas', value: document.getElementById('res-cantidad-notas').textContent, color: [59, 130, 246] },
            { label: 'Días de Mora', value: document.getElementById('res-dias-mora').textContent, color: [245, 158, 11] },
        ];

        let xPos = 14;
        resumenItems.forEach(item => {
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100);
            doc.text(item.label, xPos, resumenY);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(item.color[0], item.color[1], item.color[2]);
            doc.text(item.value, xPos, resumenY + 5);
            xPos += 45;
        });
        doc.setTextColor(0);

        const tableColumn = ['Nº Nota', 'Fecha Emisión', 'Vencimiento', 'Base', 'IVA', 'Total', 'Estado', 'Factura', 'Pagado', 'Saldo', 'Mora'];
        const tableRows = datosEstado.map(v => [
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
        ]);

        doc.autoTable({
            startY: 70,
            head: [tableColumn],
            body: tableRows,
            theme: 'striped',
            headStyles: { fillColor: [26, 35, 126], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
            bodyStyles: { fontSize: 7 },
            columnStyles: {
                0: { cellWidth: 22 },
                1: { cellWidth: 20 },
                2: { cellWidth: 20 },
                3: { cellWidth: 18 },
                4: { cellWidth: 15 },
                5: { cellWidth: 18 },
                6: { cellWidth: 18 },
                7: { cellWidth: 18 },
                8: { cellWidth: 18 },
                9: { cellWidth: 18 },
                10: { cellWidth: 18 }
            },
            margin: { left: 14, right: 14 }
        });

        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(7);
            doc.setTextColor(150);
            doc.text(`Generado el ${new Date().toLocaleString('es-VE')} - Diamelab, C.A.`, 14, doc.internal.pageSize.height - 10);
            doc.text(`Página ${i} de ${pageCount}`, 270, doc.internal.pageSize.height - 10, { align: 'right' });
        }

        const clienteNombre = clienteSeleccionado?.razon_social?.replace(/\s/g, '_') || 'cliente';
        doc.save(`estado_cuenta_${clienteNombre}_${new Date().toISOString().slice(0,10)}.pdf`);

        hideLoading('#btn-exportar-pdf');
        showAlert('PDF generado correctamente.', 'success');

    } catch (error) {
        hideLoading('#btn-exportar-pdf');
        console.error('Error generando PDF:', error);
        showAlert('Error al generar el PDF: ' + error.message, 'error');
    }
}
