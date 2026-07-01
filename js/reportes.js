/**
 * Módulo de Reportes de Ventas y Facturación
 * CON EXPORTACIÓN A PDF CON MEMBRETE DE DIAMELAB, C.A.
 */

document.addEventListener('DOMContentLoaded', async () => {
    const isAuth = await protectRoute();
    if (!isAuth) return;

    initNavigation();
    updateUserAvatar();

    if (!isAdmin()) {
        showAlert('Acceso denegado. Se requieren permisos de administrador.', 'error');
        setTimeout(() => window.location.href = 'dashboard.html', 1500);
        return;
    }

    await actualizarDisplayTasa('#tasa-bcv');

    // Configurar fecha por defecto (mes actual)
    const hoy = new Date();
    const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    document.getElementById('reporte-fecha-desde').value = primerDia.toISOString().split('T')[0];
    document.getElementById('reporte-fecha-hasta').value = hoy.toISOString().split('T')[0];

    // Eventos
    document.getElementById('btn-generar-reporte').addEventListener('click', generarReporte);
    document.getElementById('btn-exportar-csv').addEventListener('click', exportarCSV);
    document.getElementById('btn-exportar-pdf').addEventListener('click', exportarPDF);
    document.getElementById('btn-refresh-tasa').addEventListener('click', async () => {
        invalidateTasaCache();
        await actualizarDisplayTasa('#tasa-bcv');
    });

    // Generar reporte automático al cargar
    await generarReporte();
});

let reporteData = [];

async function generarReporte() {
    const sede = document.getElementById('reporte-sede').value;
    const fechaDesde = document.getElementById('reporte-fecha-desde').value;
    const fechaHasta = document.getElementById('reporte-fecha-hasta').value;

    if (!fechaDesde || !fechaHasta) {
        showAlert('Seleccione un rango de fechas.', 'warning');
        return;
    }

    try {
        showLoading('#btn-generar-reporte', 'Generando...');

        const data = await getReporteVentas(sede || null, fechaDesde, fechaHasta);
        reporteData = data;

        // Calcular totales
        let totalBase = 0;
        let totalIVA = 0;
        let totalFacturado = 0;
        let pendientesFactura = 0;

        data.forEach(v => {
            totalBase += parseFloat(v.monto_total_usd) || 0;
            totalIVA += parseFloat(v.monto_iva) || 0;
            totalFacturado += parseFloat(v.total_con_iva) || parseFloat(v.monto_total_usd) || 0;
            if (!v.numero_factura || v.numero_factura.trim() === '') {
                pendientesFactura++;
            }
        });

        // Mostrar resumen
        document.getElementById('reporte-resumen').style.display = '';
        document.getElementById('total-base').textContent = formatUSD(totalBase);
        document.getElementById('total-iva').textContent = formatUSD(totalIVA);
        document.getElementById('total-facturado').textContent = formatUSD(totalFacturado);
        document.getElementById('total-pendiente-factura').textContent = pendientesFactura;

        // Mostrar detalle
        const tbody = document.getElementById('tbody-reporte');
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--gray-400);">No hay datos en el período seleccionado.</td></tr>`;
        } else {
            tbody.innerHTML = data.map(v => `
                <tr>
                    <td><strong>${v.correlacion_a2 || 'N/A'}</strong></td>
                    <td>${v.cliente ? v.cliente.razon_social : 'N/A'}</td>
                    <td>${v.sede || 'N/A'}</td>
                    <td>${formatDate(v.fecha_emision)}</td>
                    <td>${formatUSD(v.monto_total_usd)}</td>
                    <td>${formatUSD(v.monto_iva || 0)}</td>
                    <td><strong>${formatUSD(v.total_con_iva || v.monto_total_usd)}</strong></td>
                    <td>
                        ${v.numero_factura ? `<span class="badge badge-pagada">${v.numero_factura}</span>` : `<span class="badge badge-pendiente">Pendiente</span>`}
                    </td>
                </tr>
            `).join('');
        }

        document.getElementById('reporte-detalle').style.display = '';
        hideLoading('#btn-generar-reporte');

    } catch (error) {
        hideLoading('#btn-generar-reporte');
        console.error('Error generando reporte:', error);
        showAlert('Error al generar el reporte: ' + error.message, 'error');
    }
}

function exportarCSV() {
    if (reporteData.length === 0) {
        showAlert('No hay datos para exportar.', 'warning');
        return;
    }

    const headers = ['Nº Nota', 'Cliente', 'Sede', 'Fecha', 'Base (USD)', 'IVA (USD)', 'Total (USD)', 'Factura'];
    const filas = reporteData.map(v => [
        v.correlacion_a2 || '',
        v.cliente ? v.cliente.razon_social : '',
        v.sede || '',
        formatDate(v.fecha_emision),
        v.monto_total_usd || 0,
        v.monto_iva || 0,
        v.total_con_iva || v.monto_total_usd || 0,
        v.numero_factura || ''
    ]);

    const csvContent = [
        headers.join(','),
        ...filas.map(row => row.join(','))
    ].join('\n');

    const fecha = new Date().toISOString().slice(0, 10);
    descargarArchivo(csvContent, `reporte_ventas_${fecha}.csv`, 'text/csv');
}

// ============================================
// EXPORTAR A PDF CON MEMBRETE
// ============================================

function exportarPDF() {
    if (reporteData.length === 0) {
        showAlert('No hay datos para exportar.', 'warning');
        return;
    }

    showLoading('#btn-exportar-pdf', 'Generando PDF...');

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('l', 'mm', 'a4');

        // ===== MEMBRETE SIMPLIFICADO (sin RIF, teléfono, email) =====
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(26, 35, 126);
        doc.text('Diamelab, C.A.', 14, 22);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(100);
        doc.text('Equipos e Insumos para Laboratorios Clínicos', 14, 28);

        // Línea separadora
        doc.setDrawColor(26, 35, 126);
        doc.setLineWidth(0.5);
        doc.line(14, 32, 284, 32);

        // Título del reporte
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0);
        doc.text('REPORTE DE VENTAS Y FACTURACIÓN', 14, 40);

        // Filtros aplicados
        const sede = document.getElementById('reporte-sede').value || 'Todas';
        const fechaDesde = document.getElementById('reporte-fecha-desde').value;
        const fechaHasta = document.getElementById('reporte-fecha-hasta').value;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(60);
        doc.text(`Sede: ${sede}  |  Período: ${formatDate(fechaDesde)} - ${formatDate(fechaHasta)}`, 14, 46);

        // Resumen en una fila
        const resumenY = 54;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        const resumenItems = [
            { label: 'Total Base', value: document.getElementById('total-base').textContent, color: [26, 35, 126] },
            { label: 'Total IVA', value: document.getElementById('total-iva').textContent, color: [245, 158, 11] },
            { label: 'Total Facturado', value: document.getElementById('total-facturado').textContent, color: [34, 197, 94] },
            { label: 'Notas sin Facturar', value: document.getElementById('total-pendiente-factura').textContent, color: [239, 68, 68] },
        ];

        let xPos = 14;
        resumenItems.forEach(item => {
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100);
            doc.text(item.label, xPos, resumenY);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(item.color[0], item.color[1], item.color[2]);
            doc.text(item.value, xPos, resumenY + 5);
            xPos += 50;
        });
        doc.setTextColor(0);

        // Tabla de datos
        const tableColumn = ['Nº Nota', 'Cliente', 'Sede', 'Fecha', 'Base (USD)', 'IVA (USD)', 'Total (USD)', 'Factura'];
        const tableRows = reporteData.map(v => [
            v.correlacion_a2 || '',
            v.cliente ? v.cliente.razon_social : '',
            v.sede || '',
            formatDate(v.fecha_emision),
            formatUSD(v.monto_total_usd),
            formatUSD(v.monto_iva || 0),
            formatUSD(v.total_con_iva || v.monto_total_usd),
            v.numero_factura || 'Pendiente'
        ]);

        doc.autoTable({
            startY: 62,
            head: [tableColumn],
            body: tableRows,
            theme: 'striped',
            headStyles: { fillColor: [26, 35, 126], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
            bodyStyles: { fontSize: 7 },
            columnStyles: {
                0: { cellWidth: 22 },
                1: { cellWidth: 45 },
                2: { cellWidth: 25 },
                3: { cellWidth: 22 },
                4: { cellWidth: 25 },
                5: { cellWidth: 22 },
                6: { cellWidth: 25 },
                7: { cellWidth: 22 }
            },
            margin: { left: 14, right: 14 }
        });

        // Pie de página
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(7);
            doc.setTextColor(150);
            doc.text(`Generado el ${new Date().toLocaleString('es-VE')} - Diamelab, C.A.`, 14, doc.internal.pageSize.height - 10);
            doc.text(`Página ${i} de ${pageCount}`, 270, doc.internal.pageSize.height - 10, { align: 'right' });
        }

        const fecha = new Date().toISOString().slice(0, 10);
        doc.save(`reporte_ventas_${fecha}.pdf`);

        hideLoading('#btn-exportar-pdf');
        showAlert('PDF generado correctamente.', 'success');

    } catch (error) {
        hideLoading('#btn-exportar-pdf');
        console.error('Error generando PDF:', error);
        showAlert('Error al generar el PDF: ' + error.message, 'error');
    }
}

function descargarArchivo(contenido, nombreArchivo, tipo = 'application/json') {
    const blob = new Blob([contenido], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
