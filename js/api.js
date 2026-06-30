/**
 * Sistema Diamelab - APIs y Servicios Externos
 * Consumo de Tasa BCV y otras APIs
 */

// ============================================
// API DE TASA BCV (OFICIAL + FALLBACK)
// ============================================

const TASA_CACHE_KEY = 'diamelab_tasa_bcv';
const TASA_CACHE_TIME = 5 * 60 * 1000; // 5 minutos (reducido para actualizar más rápido)

async function obtenerTasaBCV() {
    const cached = getCachedTasa();
    if (cached) {
        console.log('Usando tasa en caché:', cached.tasa);
        return cached;
    }

    // PRIORIDAD 1: PydolarVE (API oficial de Venezuela, 4 decimales)
    try {
        const tasa = await fetchTasaPydolar();
        if (tasa) {
            cacheTasa(tasa);
            return { tasa: tasa, fuente: 'PydolarVE (Oficial)' };
        }
    } catch (error) {
        console.warn('PydolarVE falló, intentando siguiente fuente...', error);
    }

    // PRIORIDAD 2: DolarAPI (alternativa, 4 decimales)
    try {
        const tasa = await fetchTasaDolarAPI();
        if (tasa) {
            cacheTasa(tasa);
            return { tasa: tasa, fuente: 'DolarAPI' };
        }
    } catch (error) {
        console.warn('DolarAPI falló, intentando siguiente fuente...', error);
    }

    // PRIORIDAD 3: Proxy alternativo (bcv-api2)
    try {
        const tasa = await fetchTasaProxyAlternativo();
        if (tasa) {
            cacheTasa(tasa);
            return { tasa: tasa, fuente: 'Proxy Alternativo' };
        }
    } catch (error) {
        console.warn('Proxy alternativo falló:', error);
    }

    // PRIORIDAD 4: ExchangeRate (solo 2 decimales, fallback)
    try {
        const tasa = await fetchTasaExchangeRate();
        if (tasa) {
            cacheTasa(tasa);
            return { tasa: tasa, fuente: 'ExchangeRate (fallback)' };
        }
    } catch (error) {
        console.warn('ExchangeRate también falló:', error);
    }

    // Último recurso: caché o valor por defecto
    const ultimaTasa = localStorage.getItem('diamelab_ultima_tasa_valida');
    if (ultimaTasa) {
        return { tasa: parseFloat(ultimaTasa), fuente: 'Última tasa guardada (offline)' };
    }
    return { tasa: 65.50, fuente: 'Valor por defecto' };
}

// ============================================
// FUENTES DE TASA
// ============================================

// 1. PydolarVE (recomendada, oficial, 4 decimales)
async function fetchTasaPydolar() {
    try {
        const response = await fetch('https://pydolarve.org/api/v1/dolar/', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) return null;
        const data = await response.json();
        // La API devuelve: { "usd": { "bcv": 623.0223, ... } }
        if (data && data.usd && data.usd.bcv) {
            return parseFloat(data.usd.bcv);
        }
        return null;
    } catch (error) {
        console.warn('Error en PydolarVE:', error);
        return null;
    }
}

// 2. DolarAPI (alternativa, 4 decimales)
async function fetchTasaDolarAPI() {
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
        console.warn('Error en DolarAPI:', error);
        return null;
    }
}

// 3. Proxy alternativo (bcv-api2)
async function fetchTasaProxyAlternativo() {
    try {
        const response = await fetch('https://bcv-api2.vercel.app/api/tasa', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (data.tasa && data.tasa > 0) {
            return parseFloat(data.tasa);
        }
        return null;
    } catch (error) {
        console.warn('Error en proxy alternativo:', error);
        return null;
    }
}

// 4. ExchangeRate (fallback, solo 2 decimales)
async function fetchTasaExchangeRate() {
    try {
        const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (data.rates && data.rates.VES) {
            return parseFloat(data.rates.VES);
        }
        return null;
    } catch (error) {
        console.warn('Error en ExchangeRate:', error);
        return null;
    }
}

// ============================================
// CACHÉ DE TASA
// ============================================

function cacheTasa(tasa) {
    const cacheData = { tasa, timestamp: Date.now(), fecha: new Date().toISOString() };
    localStorage.setItem(TASA_CACHE_KEY, JSON.stringify(cacheData));
    localStorage.setItem('diamelab_ultima_tasa_valida', tasa.toString());
}

function getCachedTasa() {
    try {
        const cached = localStorage.getItem(TASA_CACHE_KEY);
        if (!cached) return null;
        const data = JSON.parse(cached);
        const age = Date.now() - data.timestamp;
        if (age < TASA_CACHE_TIME) {
            return { tasa: data.tasa, fuente: 'Caché local' };
        }
        return null;
    } catch { return null; }
}

function invalidateTasaCache() {
    localStorage.removeItem(TASA_CACHE_KEY);
    localStorage.removeItem('diamelab_ultima_tasa_valida');
}

// ============================================
// MOSTRAR TASA EN UI (CON 4 DECIMALES)
// ============================================

async function actualizarDisplayTasa(selector = '.tasa-bcv-display') {
    const elements = document.querySelectorAll(selector);
    if (elements.length === 0) return;
    elements.forEach(el => { el.innerHTML = '<span class="spinner-tasa"></span>'; });
    try {
        const { tasa, fuente } = await obtenerTasaBCV();
        // Formatear con 4 decimales y coma como separador decimal
        const tasaFormateada = tasa.toFixed(4).replace('.', ',');
        elements.forEach(el => {
            el.innerHTML = `<span class="tasa-valor">${tasaFormateada} Bs./USD</span><span class="tasa-fuente">${fuente}</span>`;
        });
        return tasa;
    } catch (error) {
        elements.forEach(el => { el.innerHTML = '<span class="tasa-error">Error al cargar tasa</span>'; });
        return null;
    }
}

// ============================================
// CRUD DE CLIENTES
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
// CRUD DE VENTAS (con paginación)
// ============================================

async function getVentas(filtros = {}, limit = null, offset = 0) {
    let query = supabaseClient
        .from('ventas')
        .select(`
            *,
            cliente:clientes(id, razon_social, rif),
            vendedor:profiles(id, full_name)
        `, { count: 'exact' });

    if (filtros.estado) query = query.eq('estado', filtros.estado);
    if (filtros.sede && !isAdmin()) query = query.eq('sede', getUserSede());
    else if (filtros.sede) query = query.eq('sede', filtros.sede);
    if (filtros.cliente_id) query = query.eq('cliente_id', filtros.cliente_id);
    if (filtros.fecha_desde) query = query.gte('fecha_emision', filtros.fecha_desde);
    if (filtros.fecha_hasta) query = query.lte('fecha_emision', filtros.fecha_hasta);
    if (filtros.busqueda) {
        const { data: clientes } = await supabaseClient
            .from('clientes')
            .select('id')
            .ilike('razon_social', `%${filtros.busqueda}%`);
        const ids = clientes.map(c => c.id);
        if (ids.length > 0) {
            query = query.or(`correlacion_a2.ilike.%${filtros.busqueda}%,cliente_id.in.(${ids.join(',')})`);
        } else {
            query = query.ilike('correlacion_a2', `%${filtros.busqueda}%`);
        }
    }
    if (filtros.facturado === true) {
        query = query.not('numero_factura', 'is', null).neq('numero_factura', '');
    } else if (filtros.facturado === false) {
        query = query.or('numero_factura.is.null,numero_factura.eq.\'\'');
    }

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
    const { data: venta, error: ventaError } = await supabaseClient
        .from('ventas')
        .insert([ventaData])
        .select()
        .single();
    if (ventaError) throw ventaError;
    if (items.length > 0) {
        const itemsWithVentaId = items.map(item => ({ ...item, venta_id: venta.id }));
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

async function deleteVenta(id) {
    const { count, error: countError } = await supabaseClient
        .from('pagos')
        .select('*', { count: 'exact', head: true })
        .eq('venta_id', id);
    if (countError) throw countError;
    if (count > 0) {
        throw new Error(`La venta tiene ${count} pagos asociados. Debe eliminarlos primero.`);
    }
    const { error } = await supabaseClient
        .from('ventas')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return true;
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
    if (filtros.venta_id) query = query.eq('venta_id', filtros.venta_id);
    if (filtros.fecha_desde) query = query.gte('fecha_pago', filtros.fecha_desde);
    if (filtros.fecha_hasta) query = query.lte('fecha_pago', filtros.fecha_hasta);
    query = query.order('fecha_pago', { ascending: false });
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

async function createPago(pagoData, comprobanteFile = null, retIVAFile = null, retISLRFile = null) {
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

async function actualizarValidacionPago(pagoId, validado) {
    const { data, error } = await supabaseClient
        .from('pagos')
        .update({ validado: validado })
        .eq('id', pagoId)
        .select()
        .single();
    if (error) throw error;
    return data;
}

// ============================================
// FACTURACIÓN
// ============================================

async function actualizarFacturaVenta(ventaId, numeroFactura, montoIva, fechaFactura) {
    const updates = {
        numero_factura: numeroFactura || null,
        monto_iva: montoIva || 0,
        fecha_factura: fechaFactura || null
    };
    const { data, error } = await supabaseClient
        .from('ventas')
        .update(updates)
        .eq('id', ventaId)
        .select()
        .single();
    if (error) throw error;
    return data;
}

async function getReporteVentas(sede, fechaDesde, fechaHasta) {
    let query = supabaseClient
        .from('ventas')
        .select(`
            id,
            correlacion_a2,
            fecha_emision,
            fecha_vencimiento,
            monto_total_usd,
            monto_iva,
            total_con_iva,
            numero_factura,
            fecha_factura,
            estado,
            sede,
            cliente:clientes(razon_social, rif)
        `);

    if (sede) query = query.eq('sede', sede);
    if (fechaDesde) query = query.gte('fecha_emision', fechaDesde);
    if (fechaHasta) query = query.lte('fecha_emision', fechaHasta);
    query = query.neq('estado', 'anulada');

    const { data, error } = await query.order('fecha_emision', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function getVentasCompletasConPagos(sede = null) {
    let query = supabaseClient
        .from('ventas')
        .select(`
            *,
            cliente:clientes(razon_social, rif, direccion, telefono, email),
            vendedor:profiles(full_name),
            items:venta_items(*),
            pagos:pagos(*)
        `)
        .neq('estado', 'anulada');

    if (sede) query = query.eq('sede', sede);

    const { data, error } = await query.order('fecha_emision', { ascending: false });
    if (error) throw error;
    return data || [];
}

// ============================================
// STORAGE
// ============================================

async function uploadFile(file, bucket) {
    if (!file) return null;
    const fileExt = file.name.split('.').pop();
    const fileName = `${generateUUID()}.${fileExt}`;
    const filePath = `${getUserSede()}/${new Date().getFullYear()}/${fileName}`;
    const { error: uploadError } = await supabaseClient.storage
        .from(bucket)
        .upload(filePath, file, { cacheControl: '3600', upsert: false });
    if (uploadError) throw uploadError;
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

    let ventasQuery = supabaseClient
        .from('ventas')
        .select('estado, monto_total_usd');
    if (sede) ventasQuery = ventasQuery.eq('sede', sede);
    const { data: ventas, error: vError } = await ventasQuery;
    if (vError) throw vError;

    let pagosQuery = supabaseClient
        .from('pagos')
        .select('monto_pagado_usd, venta_id');
    if (sede) {
        const { data: ventasSede, error: vsError } = await supabaseClient
            .from('ventas')
            .select('id')
            .eq('sede', sede)
            .neq('estado', 'anulada');
        if (vsError) throw vsError;
        const ids = ventasSede.map(v => v.id);
        if (ids.length === 0) {
            pagosQuery = pagosQuery.in('venta_id', []);
        } else {
            pagosQuery = pagosQuery.in('venta_id', ids);
        }
    }
    const { data: pagos, error: pError } = await pagosQuery;
    if (pError) throw pError;

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
        const monto = parseFloat(v.monto_total_usd) || 0;
        stats.totalVentas += monto;
        if (v.estado === 'pendiente') stats.ventasPendientes++;
        if (v.estado === 'pagada') stats.ventasPagadas++;
        if (v.estado === 'parcial') stats.ventasParciales++;
        if (v.estado === 'anulada') stats.ventasAnuladas++;
    });

    pagos.forEach(p => {
        stats.totalPagado += parseFloat(p.monto_pagado_usd) || 0;
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

// ============================================
// USUARIOS (PERFILES)
// ============================================

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
    const { error } = await supabaseClient
        .from('profiles')
        .update({ activo: false })
        .eq('id', id);
    if (error) throw error;
    return true;
}

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

// ============================================
// CLIENTES - ACTUALIZAR / ELIMINAR
// ============================================

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
// EXPORTAR PARA USO GLOBAL
// ============================================================
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
window.deleteVenta = deleteVenta;
window.getPagosByVenta = getPagosByVenta;
window.getAllPagos = getAllPagos;
window.createPago = createPago;
window.actualizarValidacionPago = actualizarValidacionPago;
window.actualizarFacturaVenta = actualizarFacturaVenta;
window.getReporteVentas = getReporteVentas;
window.getVentasCompletasConPagos = getVentasCompletasConPagos;
window.uploadFile = uploadFile;
window.deleteFile = deleteFile;
window.getDashboardStats = getDashboardStats;
window.getVentasRecientes = getVentasRecientes;
window.getProfiles = getProfiles;
window.updateProfile = updateProfile;
window.deleteProfile = deleteProfile;
window.createUserWithProfile = createUserWithProfile;
window.updateCliente = updateCliente;
window.deleteCliente = deleteCliente;
