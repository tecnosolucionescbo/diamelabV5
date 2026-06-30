/**
 * Sistema Diamelab - APIs y Servicios Externos
 * Consumo de Tasa BCV y otras APIs
 * VERSIÓN ACTUALIZADA - Usa API pública de rafnixg para tasa oficial BCV
 * Muestra 4 decimales (ej. 623,0223)
 */

// ============================================
// API DE TASA BCV (OFICIAL + FALLBACK)
// ============================================

const TASA_CACHE_KEY = 'diamelab_tasa_bcv';
const TASA_CACHE_TIME = 5 * 60 * 1000; // 5 minutos (cambia según necesidad)

async function obtenerTasaBCV() {
    const cached = getCachedTasa();
    if (cached) {
        console.log('Usando tasa en caché:', cached.tasa);
        return cached;
    }

    // Intentar API del BCV primero (rafnixg)
    try {
        const tasaBCV = await fetchTasaBCVOficial();
        if (tasaBCV) {
            cacheTasa(tasaBCV);
            return { tasa: tasaBCV, fuente: 'BCV Oficial (rafnixg)' };
        }
    } catch (error) {
        console.warn('BCV oficial falló, intentando fallback...', error);
    }

    // Fallback a MonitorDolar (tasas de referencia internacional)
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

// ============================================
// FUENTE PRINCIPAL: API pública rafnixg (BCV)
// ============================================
async function fetchTasaBCVOficial() {
    try {
        const response = await fetch('https://bcv-api.rafnixg.dev/rates/', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();

        // La API puede devolver un objeto con las tasas actuales
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            if (data.USD && typeof data.USD === 'number') {
                return data.USD;
            }
        }

        // O puede devolver un arreglo histórico (el último elemento es el más reciente)
        if (Array.isArray(data) && data.length > 0) {
            const last = data[data.length - 1];
            if (last && last.USD && typeof last.USD === 'number') {
                return last.USD;
            }
        }

        return null;
    } catch (error) {
        console.warn('Error al consultar API BCV (rafnixg):', error);
        return null;
    }
}

// ============================================
// FALLBACK: MonitorDolar (tasas internacionales)
// ============================================
async function fetchTasaMonitorDolar() {
    try {
        const apisAlternativas = [
            'https://api.exchangerate-api.com/v4/latest/USD',
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
                
                if (data.rates && (data.rates.VES || data.rates.VEF)) {
                    const tasa = data.rates.VES || data.rates.VEF;
                    if (tasa && tasa > 0) return tasa;
                }
            } catch (e) {
                continue;
            }
        }

        // Último intento con DolarAPI.com (promedio)
        return await fetchTasaFromMonitor();
    } catch (error) {
        console.warn('Error en fallback MonitorDolar:', error);
        return null;
    }
}

async function fetchTasaFromMonitor() {
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

// ============================================
// CACHÉ Y ALMACENAMIENTO LOCAL
// ============================================
function cacheTasa(tasa) {
    const cacheData = {
        tasa: tasa,
        timestamp: Date.now(),
        fecha: new Date().toISOString()
    };
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
    } catch {
        return null;
    }
}

function invalidateTasaCache() {
    localStorage.removeItem(TASA_CACHE_KEY);
}

// ============================================
// ACTUALIZAR DISPLAY DE TASA (CON 4 DECIMALES)
// ============================================
async function actualizarDisplayTasa(selector = '.tasa-bcv-display') {
    const elements = document.querySelectorAll(selector);
    if (elements.length === 0) return;

    elements.forEach(el => {
        el.innerHTML = '<span class="spinner-tasa"></span>';
    });

    try {
        const { tasa, fuente } = await obtenerTasaBCV();
        // Formatear a 4 decimales con coma como separador decimal (ej. 623,0223)
        const tasaFormateada = tasa.toFixed(4).replace('.', ',');
        elements.forEach(el => {
            el.innerHTML = `
                <span class="tasa-valor">${tasaFormateada} Bs./USD</span>
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
    
    let ventasQuery = supabaseClient.from('ventas').select('estado, monto_total_usd');
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
        stats.totalVentas += parseFloat(v.monto_total_usd);
        if (v.estado === 'pendiente') stats.ventasPendientes++;
        if (v.estado === 'pagada') stats.ventasPagadas++;
        if (v.estado === 'parcial') stats.ventasParciales++;
        if (v.estado === 'anulada') stats.ventasAnuladas++;
    });

    pagos.forEach(p => {
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

// ============================================
// CRUD DE PERFILES (USUARIOS) - SOLO ADMIN
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

// ============================================
// OBTENER TODOS LOS PAGOS CON FILTROS (PARA DASHBOARD)
// ============================================

async function getAllPagosConFiltro(filtros = {}) {
    let query = supabaseClient
        .from('pagos')
        .select(`
            *,
            venta:ventas!inner(id, correlacion_a2, estado, sede, cliente:clientes(razon_social, rif))
        `);

    // Excluir pagos de ventas anuladas
    query = query.neq('venta.estado', 'anulada');

    if (filtros.validado !== undefined) {
        query = query.eq('validado', filtros.validado);
    }
    if (filtros.sede) {
        query = query.eq('venta.sede', filtros.sede);
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

// ============================================
// ACTUALIZAR PAGO (EDITAR)
// ============================================

async function actualizarPago(pagoId, data) {
    const { data: result, error } = await supabaseClient
        .from('pagos')
        .update({
            fecha_pago: data.fecha_pago,
            monto_pagado_usd: data.monto_pagado_usd,
            metodo_pago: data.metodo_pago,
            referencia: data.referencia,
            banco_origen: data.banco_origen,
            tasa_usada: data.tasa_usada,
            validado: data.validado
        })
        .eq('id', pagoId)
        .select()
        .single();

    if (error) throw error;
    return result;
}

// ============================================
// ELIMINAR PAGO
// ============================================

async function eliminarPago(pagoId) {
    // Obtener el pago para saber a qué venta pertenece
    const { data: pago, error: getError } = await supabaseClient
        .from('pagos')
        .select('venta_id')
        .eq('id', pagoId)
        .single();

    if (getError) throw getError;

    // Eliminar el pago
    const { error: deleteError } = await supabaseClient
        .from('pagos')
        .delete()
        .eq('id', pagoId);

    if (deleteError) throw deleteError;

    // Recalcular el estado de la venta (trigger)
    const { error: updateError } = await supabaseClient.rpc('actualizar_estado_venta', { p_venta_id: pago.venta_id });
    if (updateError) {
        // Si la función RPC no existe, podemos actualizar manualmente
        console.warn('No se pudo ejecutar actualizar_estado_venta:', updateError);
        // Recalcular manualmente
        await recalcularEstadoVenta(pago.venta_id);
    }

    return true;
}

// Función auxiliar para recalcular estado (manual)
async function recalcularEstadoVenta(ventaId) {
    // Obtener total pagado y monto total
    const { data: venta, error: vError } = await supabaseClient
        .from('ventas')
        .select('monto_total_usd, total_con_iva')
        .eq('id', ventaId)
        .single();
    if (vError) throw vError;

    const { data: pagos, error: pError } = await supabaseClient
        .from('pagos')
        .select('monto_pagado_usd')
        .eq('venta_id', ventaId);
    if (pError) throw pError;

    const totalPagado = pagos.reduce((sum, p) => sum + parseFloat(p.monto_pagado_usd), 0);
    const montoTotal = venta.total_con_iva || venta.monto_total_usd;
    let nuevoEstado = 'pendiente';
    if (totalPagado >= montoTotal) nuevoEstado = 'pagada';
    else if (totalPagado > 0) nuevoEstado = 'parcial';

    const { error: updateError } = await supabaseClient
        .from('ventas')
        .update({ estado: nuevoEstado })
        .eq('id', ventaId);
    if (updateError) throw updateError;
}

// Exportar funciones adicionales
window.actualizarPago = actualizarPago;
window.eliminarPago = eliminarPago;
window.getAllPagosConFiltro = getAllPagosConFiltro;

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

console.log('✅ api.js cargado - versión con tasa BCV (rafnixg) y 4 decimales');
