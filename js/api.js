/**
 * Sistema Diamelab - APIs y Servicios Externos
 * VERSIÓN DEFINITIVA - OBTIENE TASA BCV CON 4 DECIMALES REALES
 */

// ============================================
// CONFIGURACIÓN
// ============================================
const TASA_CACHE_KEY = 'diamelab_tasa_bcv';
const TASA_CACHE_TIME = 30 * 60 * 1000; // 30 minutos

// ============================================
// OBTENER TASA BCV (CON SCRAPING Y FALLBACKS)
// ============================================

async function obtenerTasaBCV() {
    // 1. Verificar caché válida
    const cached = getCachedTasa();
    if (cached) {
        console.log('✅ Usando tasa en caché:', cached.tasa);
        return cached;
    }

    console.log('🔄 Buscando tasa actual del BCV...');

    // 2. FUENTE PRINCIPAL: Scraping directo del BCV (más preciso)
    try {
        const tasa = await fetchTasaBCVScraping();
        if (tasa && tasa > 0) {
            console.log(`✅ Tasa obtenida por scraping: ${tasa}`);
            cacheTasa(tasa);
            return { tasa, fuente: 'BCV (Scraping directo)' };
        }
    } catch (error) {
        console.warn('⚠️ Scraping BCV falló:', error);
    }

    // 3. FUENTE ALTERNATIVA 1: PydolarVE (4 decimales)
    try {
        const tasa = await fetchTasaPydolar();
        if (tasa && tasa > 0) {
            console.log(`✅ Tasa obtenida de PydolarVE: ${tasa}`);
            cacheTasa(tasa);
            return { tasa, fuente: 'PydolarVE' };
        }
    } catch (error) {
        console.warn('⚠️ PydolarVE falló:', error);
    }

    // 4. FUENTE ALTERNATIVA 2: DolarAPI (4 decimales)
    try {
        const tasa = await fetchTasaDolarAPI();
        if (tasa && tasa > 0) {
            console.log(`✅ Tasa obtenida de DolarAPI: ${tasa}`);
            cacheTasa(tasa);
            return { tasa, fuente: 'DolarAPI' };
        }
    } catch (error) {
        console.warn('⚠️ DolarAPI falló:', error);
    }

    // 5. FUENTE ALTERNATIVA 3: ExchangeRate (solo 2 decimales, fallback)
    try {
        const tasa = await fetchTasaExchangeRate();
        if (tasa && tasa > 0) {
            console.log(`✅ Tasa obtenida de ExchangeRate: ${tasa}`);
            cacheTasa(tasa);
            return { tasa, fuente: 'ExchangeRate (fallback)' };
        }
    } catch (error) {
        console.warn('⚠️ ExchangeRate falló:', error);
    }

    // 6. Último recurso: usar la tasa manual (actualizada por el admin)
    const ultimaTasa = localStorage.getItem('diamelab_ultima_tasa_valida');
    if (ultimaTasa) {
        const tasa = parseFloat(ultimaTasa);
        console.warn(`⚠️ Usando última tasa guardada: ${tasa}`);
        return { tasa, fuente: 'Última tasa guardada (offline)' };
    }

    // 7. Valor por defecto final
    console.warn('⚠️ Todas las fuentes fallaron, usando valor por defecto');
    return { tasa: 65.50, fuente: 'Valor por defecto' };
}

// ============================================
// FUENTES DE TASA (INDIVIDUALES)
// ============================================

// 1. SCRAPING DIRECTO DE LA PÁGINA DEL BCV (usando proxy CORS)
async function fetchTasaBCVScraping() {
    try {
        // Usar proxy gratuito para evitar CORS
        const url = 'https://api.allorigins.win/raw?url=https://www.bcv.org.ve/';
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'text/html' }
        });

        if (!response.ok) {
            console.warn('❌ No se pudo acceder al BCV (HTTP', response.status, ')');
            return null;
        }

        const html = await response.text();
        
        // Buscar la tasa en el HTML con una expresión regular más precisa
        // Busca patrones como: 623,0223 o 623.0223 o 623,02
        const regex = /(?:<[^>]*>|\s)*(dólar|dolar)\s*[^<]*?(?:<[^>]*>|\s)*(\d{1,3}(?:[.,]\d{2,4}))/gi;
        let match;
        let tasas = [];
        
        // Buscar todas las ocurrencias de números con 2-4 decimales
        const numRegex = /(\d{1,3}(?:[.,]\d{2,4}))/g;
        while ((match = numRegex.exec(html)) !== null) {
            let numStr = match[1];
            // Convertir a número (reemplazar coma por punto y eliminar separadores de miles)
            let num = parseFloat(numStr.replace(/\./g, '').replace(',', '.'));
            if (!isNaN(num) && num > 0 && num < 10000) { // Rango razonable para la tasa
                tasas.push({ valor: num, texto: numStr });
            }
        }

        // Buscar la tasa más probable (la más alta con 4 decimales)
        // Normalmente la tasa del BCV es la que tiene 4 decimales
        let mejorTasa = null;
        let maxDecimales = 0;
        for (const t of tasas) {
            const decimales = (t.texto.split(',')[1] || t.texto.split('.')[1] || '').length;
            if (decimales >= maxDecimales && t.valor > 0) {
                maxDecimales = decimales;
                mejorTasa = t.valor;
            }
        }

        if (mejorTasa) {
            console.log(`🔍 Tasa encontrada en scraping: ${mejorTasa} (${maxDecimales} decimales)`);
            return mejorTasa;
        }

        // Si no se encontró con el método anterior, buscar específicamente en el recuadro del BCV
        const recuadroRegex = /<div[^>]*class="[^"]*recuadrotsmc[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
        const recuadroMatch = html.match(recuadroRegex);
        if (recuadroMatch) {
            const recuadro = recuadroMatch[1];
            const numMatch = recuadro.match(/(\d{1,3}(?:[.,]\d{2,4}))/);
            if (numMatch) {
                let num = parseFloat(numMatch[1].replace(/\./g, '').replace(',', '.'));
                if (!isNaN(num) && num > 0) {
                    console.log(`🔍 Tasa encontrada en recuadro: ${num}`);
                    return num;
                }
            }
        }

        return null;
    } catch (error) {
        console.warn('❌ Error en scraping BCV:', error);
        return null;
    }
}

// 2. PydolarVE (API pública)
async function fetchTasaPydolar() {
    try {
        const response = await fetch('https://pydolarve.org/api/v1/dolar/', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (data && data.usd && data.usd.bcv) {
            return parseFloat(data.usd.bcv);
        }
        return null;
    } catch (error) {
        console.warn('Error en PydolarVE:', error);
        return null;
    }
}

// 3. DolarAPI
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
        // Si la caché expiró, eliminarla para forzar nueva consulta
        localStorage.removeItem(TASA_CACHE_KEY);
        return null;
    } catch {
        localStorage.removeItem(TASA_CACHE_KEY);
        return null;
    }
}

function invalidateTasaCache() {
    localStorage.removeItem(TASA_CACHE_KEY);
    localStorage.removeItem('diamelab_ultima_tasa_valida');
    console.log('🗑️ Caché de tasa eliminada.');
}

// ============================================
// MOSTRAR TASA EN UI (CON 4 DECIMALES FIJOS)
// ============================================

async function actualizarDisplayTasa(selector = '.tasa-bcv-display') {
    const elements = document.querySelectorAll(selector);
    if (elements.length === 0) return;
    elements.forEach(el => { el.innerHTML = '<span class="spinner-tasa"></span>'; });
    try {
        const { tasa, fuente } = await obtenerTasaBCV();
        // Forzar 4 decimales y formatear con coma venezolana
        const tasaFormateada = tasa.toFixed(4).replace('.', ',');
        elements.forEach(el => {
            el.innerHTML = `
                <span class="tasa-valor">${tasaFormateada} Bs./USD</span>
                <span class="tasa-fuente">${fuente}</span>
            `;
        });
        console.log(`📊 Tasa mostrada: ${tasaFormateada} (${fuente})`);
        return tasa;
    } catch (error) {
        console.error('❌ Error mostrando tasa:', error);
        elements.forEach(el => { el.innerHTML = '<span class="tasa-error">Error al cargar tasa</span>'; });
        return null;
    }
}

// ============================================
// EL RESTO DEL CÓDIGO (CRUD, FACTURACIÓN, ETC.) DEBE IR AQUÍ
// ============================================
// A partir de aquí, todo lo que ya tenías en tu api.js (clientes, ventas, pagos, etc.)
// Pero asegúrate de mantener las exportaciones al final.
// ============================================

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
    if (filtros.fecha_desde) {
        query = query.gte('fecha_emision', filtros.fecha_desde);
    }
    if (filtros.fecha_hasta) {
        // Agregar un día para incluir todo el día final
        const fechaFin = new Date(filtros.fecha_hasta);
        fechaFin.setDate(fechaFin.getDate() + 1);
        const fechaFinStr = fechaFin.toISOString().split('T')[0];
        query = query.lt('fecha_emision', fechaFinStr);
    }
    if (filtros.busqueda) {
        const busqueda = filtros.busqueda.trim();
        const { data: clientes } = await supabaseClient
            .from('clientes')
            .select('id')
            .ilike('razon_social', `%${busqueda}%`);
        const ids = clientes.map(c => c.id);
        if (ids.length > 0) {
            query = query.or(`correlacion_a2.ilike.%${busqueda}%,cliente_id.in.(${ids.join(',')})`);
        } else {
            query = query.ilike('correlacion_a2', `%${busqueda}%`);
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

async function eliminarPago(pagoId) {
    const { data: pago, error: getError } = await supabaseClient
        .from('pagos')
        .select('venta_id')
        .eq('id', pagoId)
        .single();

    if (getError) throw getError;

    const { error: deleteError } = await supabaseClient
        .from('pagos')
        .delete()
        .eq('id', pagoId);

    if (deleteError) throw deleteError;

    await recalcularEstadoVenta(pago.venta_id);
    return true;
}

async function recalcularEstadoVenta(ventaId) {
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
// DASHBOARD
// ============================================
async function getDashboardStats() {
    const sede = isAdmin() ? null : getUserSede();

    // Obtener todas las ventas no anuladas
    let ventasQuery = supabaseClient
        .from('ventas')
        .select('estado, monto_total_usd, total_con_iva, monto_iva, numero_factura');
    if (sede) ventasQuery = ventasQuery.eq('sede', sede);
    const { data: ventas, error: vError } = await ventasQuery;
    if (vError) throw vError;

    // Obtener todos los pagos (para el total pagado)
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
        // Si está facturada, usar total_con_iva; si no, usar monto_total_usd
        const tieneFactura = v.numero_factura && v.numero_factura.trim() !== '';
        const monto = tieneFactura ? (parseFloat(v.total_con_iva) || parseFloat(v.monto_total_usd)) : parseFloat(v.monto_total_usd);
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
            cliente:clientes(razon_social),
            pagos:pagos(validado)
        `)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (sede) query = query.eq('sede', sede);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

// ============================================
// USUARIOS
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
// PAGOS CON FILTRO (para dashboard)
// ============================================
async function getAllPagosConFiltro(filtros = {}) {
    let query = supabaseClient
        .from('pagos')
        .select(`
            *,
            venta:ventas!inner(id, correlacion_a2, estado, sede, cliente:clientes(razon_social, rif))
        `);

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
window.actualizarPago = actualizarPago;
window.eliminarPago = eliminarPago;
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
window.getAllPagosConFiltro = getAllPagosConFiltro;

console.log('✅ api.js cargado - con scraping del BCV para tasa de 4 decimales');
