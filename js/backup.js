/**
 * Módulo de Respaldo de Base de Datos
 * Solo para administradores
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

  // Eventos de los botones
  document.getElementById('btn-backup-estructura').addEventListener('click', exportarEstructura);

  document.getElementById('btn-backup-json-completo').addEventListener('click', () => exportarJSON('completo'));
  document.getElementById('btn-backup-json-clientes').addEventListener('click', () => exportarJSON('clientes'));
  document.getElementById('btn-backup-json-ventas').addEventListener('click', () => exportarJSON('ventas'));
  document.getElementById('btn-backup-json-pagos').addEventListener('click', () => exportarJSON('pagos'));
  document.getElementById('btn-backup-json-usuarios').addEventListener('click', () => exportarJSON('profiles'));

  document.getElementById('btn-backup-csv-clientes').addEventListener('click', () => exportarCSV('clientes'));
  document.getElementById('btn-backup-csv-ventas').addEventListener('click', () => exportarCSV('ventas'));
  document.getElementById('btn-backup-csv-pagos').addEventListener('click', () => exportarCSV('pagos'));
  document.getElementById('btn-backup-csv-usuarios').addEventListener('click', () => exportarCSV('profiles'));

  document.getElementById('btn-refresh-tasa').addEventListener('click', async () => {
    invalidateTasaCache();
    await actualizarDisplayTasa('#tasa-bcv');
  });
});

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
// 1. EXPORTAR ESTRUCTURA SQL (setup.sql)
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
      // Exportar todas las tablas principales
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
      // Exportar una tabla específica
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

    // Obtener cabeceras
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
