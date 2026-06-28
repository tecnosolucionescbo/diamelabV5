/**
 * Sistema Diamelab - APIs y Servicios Externos
 * Consumo de Tasa BCV y otras APIs
 */

// ============================================
// API DE TASA BCV (OFICIAL + FALLBACK)
// ============================================

const TASA_CACHE_KEY = 'diamelab_tasa_bcv';
const TASA_CACHE_TIME = 30 * 60 * 1000; // 30 minutos

/**
 * Obtiene la tasa del BCV
 * Primero intenta la API oficial del BCV
 * Si falla, usa MonitorDolar como fallback
 * Implementa caché local para evitar múltiples requests
 */
async function obtenerTasaBCV() {
    // Verificar caché primero
    const cached = getCachedTasa();
    if (cached) {
        console.log('Usando tasa en caché:', cached.tasa);
        return cached;
    }

    // Intentar API del BCV primero
    try {
        const tasaBCV = await fetchTasaBCVOficial();
        if (tasaBCV) {
            cacheTasa(tasaBCV);
            return { tasa: tasaBCV, fuente: 'BCV Oficial' };
        }
    } catch (error) {
        console.warn('BCV oficial falló, intentando fallback...', error);
    }

    // Fallback a MonitorDolar
    try {
        const tasaMD = await fetchTasaMonitorDolar();
        if (tasaMD) {
            cacheTasa(tasaMD);
            return { tasa: tasaMD, fuente: 'MonitorDolar (Fallback)' };
        }
    } catch (error) {
        console.warn('MonitorDolar también falló:', error);
    }

    // Si todo falla, devolver tasa por defecto (última conocida o valor estándar)
    const ultimaTasa = localStorage.getItem('diamelab_ultima_tasa_valida');
    if (ultimaTasa) {
        return { tasa: parseFloat(ultimaTasa), fuente: 'Última tasa guardada (offline)' };
    }

    // Valor por defecto como último recurso
    return { tasa: 65.50, fuente: 'Valor por defecto' };
}

/**
 * Intenta obtener tasa del BCV oficial
 * Usa un proxy CORS si es necesario para entornos web
 */
async function fetchTasaBCVOficial() {
    try {
        // Intento directo a la API del BCV
        // Nota: El BCV suele bloquear CORS desde navegadores
        const response = await fetch('https://www.bcv.org.ve/', {
            method: 'GET',
            headers: {
                'Accept': 'text/html',
            }
        });

        if (!response.ok) return null;

        const html = await response.text();
        
        // Extraer tasa del HTML del BCV
        // El BCV muestra la tasa en un elemento con id específico
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Múltiples selectores posibles según la estructura del BCV
        const tasaElement = 
            doc.querySelector('#dolar') || 
            doc.querySelector('.recuadrotsmc') ||
            doc.querySelector('[id*="dolar"]') ||
            doc.querySelector('.centrado');

        if (tasaElement) {
            const texto = tasaElement.textContent;
            const match = texto.match(/(\d{1,3}(?:[.,]\d{2,3})+)/);
            if (match) {
                const tasa = parseFloat(match[1].replace('.', '').replace(',', '.'));
                if (tasa > 0) return tasa;
            }
        }

        return null;
    } catch (error) {
        console.warn('Error accediendo a BCV:', error);
        return null;
    }
}

/**
 * Fallback: Obtener tasa de MonitorDolar
 * API más confiable para entornos web
 */
async function fetchTasaMonitorDolar() {
    try {
        // Usar la API de petroapp o exchange rate API como alternativa
        // Estas suelen tener mejor soporte CORS
        const apisAlternativas = [
            // API de exchangerate (tasa oficial aproximada)
            'https://api.exchangerate-api.com/v4/latest/USD',
            // API de open.er-api
            'https://open.er-api.com/v6/latest/USD'
        ];

        for (const apiUrl of apisAlternativas) {
            try {
                const response = await fetch(apiUrl, { 
                    method: 'GET',
                    headers: { 'Accept': 'application/json' }
                });
                
                if (!response.ok) continue;
                
                const data = await response.json();
                
                // Verificar si tiene tasa VES/VEF
                if (data.rates && (data.rates.VES || data.rates.VEF)) {
                    const tasa = data.rates.VES || data.rates.VEF;
                    if (tasa && tasa > 0) return tasa;
                }
            } catch (e) {
                continue;
            }
        }

        // Si las APIs de tasa oficial no funcionan, intentar con monitor
        return await fetchTasaFromMonitor();
    } catch (error) {
        console.warn('Error en fallback MonitorDolar:', error);
        return null;
    }
}

/**
 * Obtener tasa de páginas de monitoreo
 * Esta función usa scraping de fuentes confiables
 */
async function fetchTasaFromMonitor() {
    // Para entornos de producción, se recomienda usar:
    // 1. Un Edge Function de Supabase que haga el scraping
    // 2. O una API paga confiable como:
    //    - https://pydolarve.org/ (API gratuita Venezuela)
    //    - https://ve.dolarapi.com/
    
    try {
        const response = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) return null;

        const data = await response.json();
        if (data.promedio) {
            return parseFloat(data.promedio);
        }
        return null;
    } catch (error) {
        console.warn('Error en monitor:', error);
        return null;
    }
}

/**
 * Guarda tasa en caché local
 */
function cacheTasa(tasa) {
    const cacheData = {
        tasa: tasa,
        timestamp: Date.now(),
        fecha: new Date().toISOString()
    };
    localStorage.setItem(TASA_CACHE_KEY, JSON.stringify(cacheData));
    localStorage.setItem('diamelab_ultima_tasa_valida', tasa.toString());
}

/**
 * Obtiene tasa de caché si es válida
 */
function getCachedTasa() {
    try {
        const cached = localStorage.getItem(TASA_CACHE_KEY);
        if (!cached) return null;

        const data = JSON.parse(cached);
        const age = Date.now() - data.timestamp;
        
        // Si el caché tiene menos de 30 minutos, es válido
        if (age < TASA_CACHE_TIME) {
            return { tasa: data.tasa, fuente: 'Caché local' };
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Invalida el caché de tasa (para forzar actualización)
 */
function invalidateTasaCache() {
    localStorage.removeItem(TASA_CACHE_KEY);
}

// ============================================
// MOSTRAR TASA EN UI
// ============================================

/**
 * Actualiza el display de la tasa en cualquier elemento
 * @param {string} selector - Selector CSS del elemento
 */
async function actualizarDisplayTasa(selector = '.tasa-bcv-display') {
    const elements = document.querySelectorAll(selector);
    if (elements.length === 0) return;

    elements.forEach(el => {
        el.innerHTML = '<span class="spinner-tasa"></span>';
    });

    try {
        const { tasa, fuente } = await obtenerTasaBCV();
        
        elements.forEach(el => {
            el.innerHTML = `
                <span class="tasa-valor">${formatNumber(tasa, 4)} Bs./USD</span>
                <span class="tasa-fuente">${fuente}</span>
            `;
        });
        
        return tasa;
    } catch (error) {
        elements.forEach(el => {
            el.innerHTML = '<span class="tasa-error">Error al cargar tasa</span>';
        });
        return null;
    }
}

// ============================================
// CRUD DE CLIENTES (vía Supabase)
// ============================================

async function getClientes() {
    const { data, error } = await supabaseClient
        .from('clientes')
        .select('*')
        .order('razon_social', { ascending: true });
    
    if (error) throw error;
    return data || [];
}

async function getClienteById(id) {
    const { data, error } = await supabaseClient
        .from('clientes')
        .select('*')
        .eq('id', id)
        .single();
    
    if (error) throw error;
    return data;
}

async function createCliente(clienteData) {
    const { data, error } = await supabaseClient
        .from('clientes')
        .insert([clienteData])
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

async function searchClientes(query) {
    const { data, error } = await supabaseClient
        .from('clientes')
        .select('*')
        .or(`razon_social.ilike.%${query}%,rif.ilike.%${query}%`)
        .limit(10);
    
    if (error) throw error;
    return data || [];
}

// ============================================
// CRUD DE VENTAS
// ============================================

async function getVentas(filtros = {}, limit = null, offset = 0) {
  let query = supabaseClient
    .from('ventas')
    .select(`
      *,
      cliente:clientes(id, razon_social, rif),
      vendedor:profiles(id, full_name)
    `, { count: 'exact' });

  // ... (mantén los filtros igual) ...

  // Aplicar orden y paginación
  query = query.order('fecha_emision', { ascending: false });
  if (limit !== null) {
    query = query.range(offset, offset + limit - 1);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: data || [], count };
}

async function getVentaById(id) {
    const { data, error } = await supabaseClient
        .from('ventas')
        .select(`
            *,
            cliente:clientes(id, razon_social, rif),
            vendedor:profiles(id, full_name),
            items:venta_items(*)
        `)
        .eq('id', id)
        .single();
    
    if (error) throw error;
    return data;
}

async function createVenta(ventaData, items = []) {
    // Insertar venta
    const { data: venta, error: ventaError } = await supabaseClient
        .from('ventas')
        .insert([ventaData])
        .select()
        .single();
    
    if (ventaError) throw ventaError;

    // Insertar items si existen
    if (items.length > 0) {
        const itemsWithVentaId = items.map(item => ({
            ...item,
            venta_id: venta.id
        }));

        const { error: itemsError } = await supabaseClient
            .from('venta_items')
            .insert(itemsWithVentaId);
        
        if (itemsError) throw itemsError;
    }

    return venta;
}

async function updateVenta(id, ventaData) {
    const { data, error } = await supabaseClient
        .from('ventas')
        .update(ventaData)
        .eq('id', id)
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

async function anularVenta(id) {
    return updateVenta(id, { estado: 'anulada' });
}

// ============================================
// CRUD DE PAGOS
// ============================================

async function getPagosByVenta(ventaId) {
    const { data, error } = await supabaseClient
        .from('pagos')
        .select(`
            *,
            vendedor:profiles(id, full_name)
        `)
        .eq('venta_id', ventaId)
        .order('fecha_pago', { ascending: false });
    
    if (error) throw error;
    return data || [];
}

async function getAllPagos(filtros = {}) {
    let query = supabaseClient
        .from('pagos')
        .select(`
            *,
            venta:ventas(id, correlacion_a2, cliente:clientes(razon_social)),
            vendedor:profiles(id, full_name)
        `);

    if (filtros.venta_id) {
        query = query.eq('venta_id', filtros.venta_id);
    }
    if (filtros.fecha_desde) {
        query = query.gte('fecha_pago', filtros.fecha_desde);
    }
    if (filtros.fecha_hasta) {
        query = query.lte('fecha_pago', filtros.fecha_hasta);
    }

    query = query.order('fecha_pago', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

async function createPago(pagoData, comprobanteFile = null, retIVAFile = null, retISLRFile = null) {
    // Subir archivos a Storage si existen
    if (comprobanteFile) {
        const url = await uploadFile(comprobanteFile, 'comprobantes-pagos');
        pagoData.comprobante_url = url;
    }
    if (retIVAFile) {
        const url = await uploadFile(retIVAFile, 'retenciones-iva');
        pagoData.retencion_iva_url = url;
    }
    if (retISLRFile) {
        const url = await uploadFile(retISLRFile, 'retenciones-islr');
        pagoData.retencion_islr_url = url;
    }

    const { data, error } = await supabaseClient
        .from('pagos')
        .insert([pagoData])
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

// ============================================
// STORAGE - SUBIR ARCHIVOS
// ============================================

async function uploadFile(file, bucket) {
    if (!file) return null;
    
    const fileExt = file.name.split('.').pop();
    const fileName = `${generateUUID()}.${fileExt}`;
    const filePath = `${getUserSede()}/${new Date().getFullYear()}/${fileName}`;

    const { error: uploadError } = await supabaseClient.storage
        .from(bucket)
        .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
        });

    if (uploadError) throw uploadError;

    // Obtener URL pública
    const { data: { publicUrl } } = supabaseClient.storage
        .from(bucket)
        .getPublicUrl(filePath);

    return publicUrl;
}

async function deleteFile(bucket, path) {
    const { error } = await supabaseClient.storage
        .from(bucket)
        .remove([path]);
    
    if (error) throw error;
}

// ============================================
// DASHBOARD - ESTADÍSTICAS
// ============================================

async function getDashboardStats() {
    const sede = isAdmin() ? null : getUserSede();
    
    // Ventas por estado
    let ventasQuery = supabaseClient.from('ventas').select('estado, monto_total_usd');
    if (sede) ventasQuery = ventasQuery.eq('sede', sede);
    const { data: ventas, error: vError } = await ventasQuery;
    if (vError) throw vError;

    // Pagos
    let pagosQuery = supabaseClient.from('pagos').select('monto_pagado_usd');
    if (sede) {
        pagosQuery = pagosQuery.eq('venta:sede', sede); // Esto requiere ajuste
    }
    // Para pagos por sede, hacemos un approach diferente
    const { data: pagos, error: pError } = await supabaseClient
        .from('pagos')
        .select('monto_pagado_usd, venta:ventas!inner(sede)');
    if (pError) throw pError;

    // Calcular estadísticas
    const stats = {
        totalVentas: 0,
        totalPagado: 0,
        totalPendiente: 0,
        ventasPendientes: 0,
        ventasPagadas: 0,
        ventasParciales: 0,
        ventasAnuladas: 0
    };

    ventas.forEach(v => {
        stats.totalVentas += parseFloat(v.monto_total_usd);
        if (v.estado === 'pendiente') stats.ventasPendientes++;
        if (v.estado === 'pagada') stats.ventasPagadas++;
        if (v.estado === 'parcial') stats.ventasParciales++;
        if (v.estado === 'anulada') stats.ventasAnuladas++;
    });

    // Filtrar pagos por sede si es necesario
    const pagosFiltrados = sede 
        ? (pagos || []).filter(p => p.venta && p.venta.sede === sede)
        : (pagos || []);

    pagosFiltrados.forEach(p => {
        stats.totalPagado += parseFloat(p.monto_pagado_usd);
    });

    stats.totalPendiente = stats.totalVentas - stats.totalPagado;

    return stats;
}

async function getVentasRecientes(limit = 10) {
    const sede = isAdmin() ? null : getUserSede();
    
    let query = supabaseClient
        .from('ventas')
        .select(`
            *,
            cliente:clientes(razon_social)
        `)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (sede) query = query.eq('sede', sede);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

// ============================================================
// CRUD DE PERFILES (USUARIOS) - SOLO ADMIN
// ============================================================

async function getProfiles({ limit = 100, offset = 0, filtro = '' } = {}) {
  let query = supabaseClient
    .from('profiles')
    .select('*', { count: 'exact' })
    .order('full_name', { ascending: true });

  if (filtro) {
    query = query.ilike('full_name', `%${filtro}%`);
  }

  const { data, error, count } = await query
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return { data, count };
}

async function updateProfile(id, updates) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteProfile(id) {
  // Soft delete: marcamos como inactivo (asumiendo que agregamos columna 'activo')
  // Si no existe, la agregamos en setup.sql.
  const { error } = await supabaseClient
    .from('profiles')
    .update({ activo: false })
    .eq('id', id);
  if (error) throw error;
  return true;
}

// Crear usuario (invitación) - usa signUp, el trigger creará el perfil
async function createUserWithProfile(email, password, fullName, role, sede) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        role: role,
        sede: sede
      }
    }
  });
  if (error) throw error;
  return data;
}

// ============================================================
// CRUD DE CLIENTES - ACTUALIZAR / ELIMINAR
// ============================================================

async function updateCliente(id, updates) {
  const { data, error } = await supabaseClient
    .from('clientes')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteCliente(id) {
  // Verificar si tiene ventas asociadas
  const { count, error: countError } = await supabaseClient
    .from('ventas')
    .select('*', { count: 'exact', head: true })
    .eq('cliente_id', id);
  if (countError) throw countError;
  if (count > 0) {
    throw new Error('No se puede eliminar el cliente porque tiene notas de entrega asociadas.');
  }
  const { error } = await supabaseClient
    .from('clientes')
    .delete()
    .eq('id', id);
  if (error) throw error;
  return true;
}

// ============================================================
// EXPORTAR NUEVAS FUNCIONES
// ============================================================
window.getProfiles = getProfiles;
window.updateProfile = updateProfile;
window.deleteProfile = deleteProfile;
window.createUserWithProfile = createUserWithProfile;
window.updateCliente = updateCliente;
window.deleteCliente = deleteCliente;

// ============================================
// EXPORTAR PARA USO GLOBAL
// ============================================
window.obtenerTasaBCV = obtenerTasaBCV;
window.actualizarDisplayTasa = actualizarDisplayTasa;
window.invalidateTasaCache = invalidateTasaCache;
window.getClientes = getClientes;
window.getClienteById = getClienteById;
window.createCliente = createCliente;
window.searchClientes = searchClientes;
window.getVentas = getVentas;
window.getVentaById = getVentaById;
window.createVenta = createVenta;
window.updateVenta = updateVenta;
window.anularVenta = anularVenta;
window.getPagosByVenta = getPagosByVenta;
window.getAllPagos = getAllPagos;
window.createPago = createPago;
window.uploadFile = uploadFile;
window.deleteFile = deleteFile;
window.getDashboardStats = getDashboardStats;
window.getVentasRecientes = getVentasRecientes;
