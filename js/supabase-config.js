/**
 * Sistema Diamelab - Configuración de Supabase
 * Este archivo DEBE editarse con tus credenciales reales de Supabase
 * 
 * Instrucciones:
 * 1. Ve a tu proyecto en https://supabase.com
 * 2. Ve a Project Settings > API
 * 3. Copia la URL y la anon/public key
 * 4. Reemplaza los valores aquí abajo
 */

// ============================================
// REEMPLAZA ESTOS VALORES CON TUS CREDENCIALES
// ============================================
const SUPABASE_URL = 'https://uvutatsvgexlobswuuhh.supabase.co';  // TU URL DE SUPABASE
const SUPABASE_ANON_KEY = 'sb_publishable_qYpXkE8bJLrY8TWbuZewCQ_s4ACxqfn';             // TU ANON KEY

// ============================================
// INICIALIZACIÓN DEL CLIENTE SUPABASE
// ============================================
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storage: localStorage
    }
});

// Exportar para uso global (sin módulos ES6, usando window)
window.supabaseClient = supabaseClient;
window.SUPABASE_URL = SUPABASE_URL;
