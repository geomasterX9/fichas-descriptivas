// ============================================================
// lib/_ciclo.js
// Helper compartido: obtiene el ciclo escolar activo
// Uso: const { getCicloActivo } = require('./_ciclo');
// ============================================================
const supabase = require('./_supabase');

// Cache en memoria para evitar consultas repetidas en la misma
// invocación serverless (se resetea con cada cold start)
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minuto

/**
 * Retorna el ciclo escolar activo (ej. "2025-2026")
 * Lee de la tabla `configuracion` con cache de 1 minuto.
 * Si falla, retorna el fallback para no romper la app.
 */
async function getCicloActivo() {
    const ahora = Date.now();
    if (_cache && (ahora - _cacheTime) < CACHE_TTL_MS) {
        return _cache;
    }
    try {
        const { data, error } = await supabase
            .from('configuracion')
            .select('valor')
            .eq('clave', 'ciclo_activo')
            .single();

        if (error || !data) {
            console.error('[_ciclo] Error leyendo ciclo activo:', error?.message);
            return _cache || '2025-2026'; // fallback al último valor conocido
        }
        _cache = data.valor;
        _cacheTime = ahora;
        return _cache;
    } catch (e) {
        console.error('[_ciclo] Excepción:', e.message);
        return _cache || '2025-2026';
    }
}

/**
 * Actualiza el ciclo activo en la BD y limpia el cache.
 * Solo debe llamarse desde tool_ciclo al hacer cierre de ciclo.
 * @param {string} nuevoCiclo  Ej. "2026-2027"
 */
async function setCicloActivo(nuevoCiclo) {
    if (!/^\d{4}-\d{4}$/.test(nuevoCiclo)) {
        throw new Error(`Formato de ciclo inválido: "${nuevoCiclo}". Debe ser "AAAA-AAAA".`);
    }
    const { error } = await supabase
        .from('configuracion')
        .upsert({ clave: 'ciclo_activo', valor: nuevoCiclo, updated_at: new Date().toISOString() });

    if (error) throw new Error('Error al actualizar ciclo activo: ' + error.message);

    // Limpiar cache
    _cache = nuevoCiclo;
    _cacheTime = Date.now();
}

module.exports = { getCicloActivo, setCicloActivo };
