/**
 * Módulo de Respaldo de Base de Datos
 * Solo para administradores
 * Protegido por contraseña para módulos de descarga (SQL, JSON, CSV)
 * Excel no requiere contraseña
 */

// ============================================
// CONFIGURACIÓN DE CONTRASEÑA
// ============================================
// CAMBIA ESTA CONTRASEÑA POR LA QUE DESEES
const CONTRASENA_MAESTRA = 'Diamelab2026!';

// ============================================

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

  // Eventos de los botones de descarga (protegidos)
  document.getElementById('btn-backup-estructura').addEventListener('click', () => solicitarPassword('estructura'));

  document.getElementById('btn-backup-json-completo').addEventListener('click', () => solicitarPassword('json-completo'));
  document.getElementById('btn-backup-json-clientes').addEventListener('click', () => solicitarPassword('json-clientes'));
  document.getElementById('btn-backup-json-ventas').addEventListener('click', () => solicitarPassword('json-ventas'));
  document.getElementById('btn-backup-json-pagos').addEventListener('click', () => solicitarPassword('json-pagos'));
  document.getElementById('btn-backup-json-usuarios').addEventListener('click', () => solicitarPassword('json-usuarios'));

  document.getElementById('btn-backup-csv-clientes').addEventListener('click', () => solicitarPassword('csv-clientes'));
  document.getElementById('btn-backup-csv-ventas').addEventListener('click', () => solicitarPassword('csv-ventas'));
  document.getElementById('btn-backup-csv-pagos').addEventListener('click', () => solicitarPassword('csv-pagos'));
  document.getElementById('btn-backup-csv-usuarios').addEventListener('click', () => solicitarPassword('csv-usuarios'));

  // Excel NO está protegido
  document.getElementById('btn-exportar-excel-completo').addEventListener('click', exportarExcelCompleto);

  document.getElementById('btn-refresh-tasa').addEventListener('click', async () => {
    invalidateTasaCache();
    await actualizarDisplayTasa('#tasa-bcv');
  });

  // Eventos del modal de contraseña
  document.getElementById('btn-cerrar-password').addEventListener('click', cerrarModalPassword);
  document.getElementById('btn-cancelar-password').addEventListener('click', cerrarModalPassword);
  document.getElementById('btn-verificar-password').addEventListener('click', verificarPassword);
  document.getElementById('input-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') verificarPassword();
  });
  document.getElementById('modal-password').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) cerrarModalPassword();
  });
});

// ============================================
// VARIABLES PARA LA CONTRASEÑA
// ============================================
let accionPendiente = null; // Guarda qué acción ejecutar después de verificar la contraseña

// ============================================
// FUNCIONES DEL MODAL DE CONTRASEÑA
// ============================================

function solicitarPassword(accion) {
  accionPendiente = accion;
  document.getElementById('input-password').value = '';
  document.getElementById('password-error').style.display = 'none';
  document.getElementById('modal-password').style.display = 'flex';
  setTimeout(() => document.getElementById('input-password').focus(), 100);
}

function cerrarModalPassword() {
  document.getElementById('modal-password').style.display = 'none';
  accionPendiente = null;
}

function verificarPassword() {
  const input = document.getElementById('input-password').value;
  const errorEl = document.getElementById('password-error');

  if (input === CONTRASENA_MAESTRA) {
    // Contraseña correcta
    errorEl.style.display = 'none';
    cerrarModalPassword();

    // Ejecutar la acción pendiente
    if (accionPendiente) {
      ejecutarAccion(accionPendiente);
      accionPendiente = null;
    }
  } else {
    // Contraseña incorrecta
    errorEl.style.display = 'block';
    document.getElementById('input-password').value = '';
    document.getElementById('input-password').focus();
  }
}

// ============================================
// EJECUTAR ACCIÓN SEGÚN EL BOTÓN PRESIONADO
// ============================================

function ejecutarAccion(accion) {
  switch (accion) {
    case 'estructura':
      exportarEstructura();
      break;
    case 'json-completo':
      exportarJSON('completo');
      break;
    case 'json-clientes':
      exportarJSON('clientes');
      break;
    case 'json-ventas':
      exportarJSON('ventas');
      break;
    case 'json-pagos':
      exportarJSON('pagos');
      break;
    case 'json-usuarios':
      exportarJSON('profiles');
      break;
    case 'csv-clientes':
      exportarCSV('clientes');
      break;
    case 'csv-ventas':
      exportarCSV('ventas');
      break;
    case 'csv-pagos':
      exportarCSV('pagos');
      break;
    case 'csv-usuarios':
      exportarCSV('profiles');
      break;
    default:
      console.warn('Acción desconocida:', accion);
  }
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================

function mostrarStatus(mensaje, tipo = 'info') {
  const container = document.getElementById('backup-status');
  const msg = document.getElementById('backup-message');
  container.style.display = 'block';
  msg.textContent = mensaje;
  msg.className = 'mensaje ' + tipo;
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

// ============================================
// 1. EXPORTAR ESTRUCTURA SQL
// ============================================

async function exportarEstructura() {
  try {
    mostrarStatus('Descargando estructura SQL...', 'info');
    const response = await fetch('setup.sql');
    if (!response.ok) throw new Error('No se pudo cargar el archivo setup.sql');
    const sql = await response.text();
    descargarArchivo(sql, 'diamelab_estructura.sql', 'text/plain');
    mostrarStatus('✅ Estructura SQL descargada correctamente.', 'success');
  } catch (error) {
    console.error(error);
    mostrarStatus('❌ Error al descargar la estructura: ' + error.message, 'error');
    showAlert('Error al descargar estructura SQL', 'error');
  }
}

// ============================================
// 2. EXPORTAR DATOS A JSON
// ============================================

async function exportarJSON(tabla) {
  try {
    mostrarStatus(`Exportando datos de ${tabla}...`, 'info');

    if (tabla === 'completo') {
      const tablas = ['clientes', 'ventas', 'pagos', 'profiles', 'venta_items'];
      const resultado = {};
      for (const t of tablas) {
        const { data, error } = await supabaseClient.from(t).select('*');
        if (error) throw new Error(`Error en ${t}: ${error.message}`);
        resultado[t] = data || [];
      }
      const json = JSON.stringify(resultado, null, 2);
      const fecha = new Date().toISOString().slice(0, 10);
      descargarArchivo(json, `diamelab_backup_completo_${fecha}.json`, 'application/json');
      mostrarStatus(`✅ Backup completo exportado (${Object.keys(resultado).length} tablas).`, 'success');
    } else {
      const { data, error } = await supabaseClient.from(tabla).select('*');
      if (error) throw new Error(`Error en ${tabla}: ${error.message}`);
      const json = JSON.stringify(data, null, 2);
      const fecha = new Date().toISOString().slice(0, 10);
      descargarArchivo(json, `diamelab_${tabla}_${fecha}.json`, 'application/json');
      mostrarStatus(`✅ Datos de ${tabla} exportados (${data.length} registros).`, 'success');
    }
  } catch (error) {
    console.error(error);
    mostrarStatus(`❌ Error: ${error.message}`, 'error');
    showAlert('Error al exportar JSON', 'error');
  }
}

// ============================================
// 3. EXPORTAR DATOS A CSV
// ============================================

async function exportarCSV(tabla) {
  try {
    mostrarStatus(`Exportando ${tabla} a CSV...`, 'info');
    const { data, error } = await supabaseClient.from(tabla).select('*');
    if (error) throw new Error(`Error en ${tabla}: ${error.message}`);

    if (!data || data.length === 0) {
      mostrarStatus(`⚠️ No hay datos en ${tabla} para exportar.`, 'warning');
      return;
    }

    const headers = Object.keys(data[0]);
    const filas = data.map(item => headers.map(h => {
      let val = item[h];
      if (val === null || val === undefined) return '';
      if (typeof val === 'string') {
        val = val.replace(/"/g, '""');
        return `"${val}"`;
      }
      if (typeof val === 'object') {
        return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
      }
      return val;
    }).join(','));

    const csvContent = [headers.join(','), ...filas].join('\n');
    const fecha = new Date().toISOString().slice(0, 10);
    descargarArchivo(csvContent, `diamelab_${tabla}_${fecha}.csv`, 'text/csv');
    mostrarStatus(`✅ CSV de ${tabla} exportado (${data.length} registros).`, 'success');
  } catch (error) {
    console.error(error);
    mostrarStatus(`❌ Error: ${error.message}`, 'error');
    showAlert('Error al exportar CSV', 'error');
  }
}

// ============================================
// 4. EXPORTAR NOTAS CON PAGOS Y FACTURAS EN EXCEL (SIN CONTRASEÑA)
// ============================================

async function exportarExcelCompleto() {
  try {
    const sede = document.getElementById('excel-sede').value || null;
    const nombreSede = sede || 'Todas';

    mostrarStatus(`Exportando notas con pagos y facturas (${nombreSede})...`, 'info');

    const ventas = await getVentasCompletasConPagos(sede);

    if (!ventas || ventas.length === 0) {
      mostrarStatus(`⚠️ No hay notas de entrega para la sede seleccionada.`, 'warning');
      return;
    }

    const hojaNotas = [];
    const hojaPagos = [];
    const hojaFacturas = [];

    ventas.forEach(v => {
      const cliente = v.cliente || {};
      hojaNotas.push({
        'Correlativo A2': v.correlacion_a2 || '',
        'Fecha Emisión': v.fecha_emision ? formatDate(v.fecha_emision) : '',
        'Fecha Vencimiento': v.fecha_vencimiento ? formatDate(v.fecha_vencimiento) : '',
        'Cliente': cliente.razon_social || '',
        'RIF': cliente.rif || '',
        'Sede': v.sede || '',
        'Monto Base (USD)': parseFloat(v.monto_total_usd) || 0,
        'IVA (USD)': parseFloat(v.monto_iva) || 0,
        'Total con IVA (USD)': parseFloat(v.total_con_iva) || 0,
        'Tasa BCV': parseFloat(v.tasa_bcv_aplicada) || 0,
        'Estado': v.estado || '',
        'Vendedor': v.vendedor?.full_name || '',
        'Nº Factura': v.numero_factura || '',
        'Fecha Factura': v.fecha_factura ? formatDate(v.fecha_factura) : '',
        'Notas': v.notas || ''
      });

      if (v.pagos && v.pagos.length > 0) {
        v.pagos.forEach(p => {
          hojaPagos.push({
            'Correlativo A2': v.correlacion_a2 || '',
            'Cliente': cliente.razon_social || '',
            'Fecha Pago': p.fecha_pago ? formatDate(p.fecha_pago) : '',
            'Monto Pagado (USD)': parseFloat(p.monto_pagado_usd) || 0,
            'Método': p.metodo_pago || '',
            'Referencia': p.referencia || '',
            'Banco Origen': p.banco_origen || '',
            'Tasa Usada': parseFloat(p.tasa_usada) || 0,
            'Validado': p.validado ? 'Sí' : 'No',
            'Vendedor': p.vendedor?.full_name || ''
          });
        });
      }

      if (v.numero_factura) {
        hojaFacturas.push({
          'Correlativo A2': v.correlacion_a2 || '',
          'Cliente': cliente.razon_social || '',
          'Nº Factura': v.numero_factura || '',
          'Fecha Factura': v.fecha_factura ? formatDate(v.fecha_factura) : '',
          'Monto Base (USD)': parseFloat(v.monto_total_usd) || 0,
          'IVA (USD)': parseFloat(v.monto_iva) || 0,
          'Total Facturado (USD)': parseFloat(v.total_con_iva) || 0,
          'Sede': v.sede || ''
        });
      }
    });

    const wb = XLSX.utils.book_new();

    const wsNotas = XLSX.utils.json_to_sheet(hojaNotas);
    XLSX.utils.book_append_sheet(wb, wsNotas, 'Notas');

    const wsPagos = XLSX.utils.json_to_sheet(hojaPagos);
    XLSX.utils.book_append_sheet(wb, wsPagos, 'Pagos');

    const wsFacturas = XLSX.utils.json_to_sheet(hojaFacturas);
    XLSX.utils.book_append_sheet(wb, wsFacturas, 'Facturas');

    const totalBase = hojaNotas.reduce((s, r) => s + (r['Monto Base (USD)'] || 0), 0);
    const totalIVA = hojaNotas.reduce((s, r) => s + (r['IVA (USD)'] || 0), 0);
    const totalFacturado = hojaNotas.reduce((s, r) => s + (r['Total con IVA (USD)'] || 0), 0);
    const totalPagado = hojaPagos.reduce((s, r) => s + (r['Monto Pagado (USD)'] || 0), 0);
    const notasFacturadas = hojaFacturas.length;
    const notasSinFacturar = hojaNotas.filter(r => !r['Nº Factura']).length;

    const resumenData = [
      { 'Concepto': 'Sede', 'Valor': nombreSede },
      { 'Concepto': 'Total Notas', 'Valor': hojaNotas.length },
      { 'Concepto': 'Total Base (USD)', 'Valor': totalBase.toFixed(2) },
      { 'Concepto': 'Total IVA (USD)', 'Valor': totalIVA.toFixed(2) },
      { 'Concepto': 'Total Facturado (USD)', 'Valor': totalFacturado.toFixed(2) },
      { 'Concepto': 'Total Pagado (USD)', 'Valor': totalPagado.toFixed(2) },
      { 'Concepto': 'Notas Facturadas', 'Valor': notasFacturadas },
      { 'Concepto': 'Notas sin Facturar', 'Valor': notasSinFacturar },
    ];

    const wsResumen = XLSX.utils.json_to_sheet(resumenData);
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fecha = new Date().toISOString().slice(0, 10);
    a.download = `notas_pagos_facturas_${nombreSede.replace(/\s/g, '_')}_${fecha}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    mostrarStatus(`✅ Excel exportado correctamente (${hojaNotas.length} notas, ${hojaPagos.length} pagos, ${hojaFacturas.length} facturas).`, 'success');

  } catch (error) {
    console.error('Error exportando Excel:', error);
    mostrarStatus(`❌ Error: ${error.message}`, 'error');
    showAlert('Error al exportar Excel: ' + error.message, 'error');
  }
}
