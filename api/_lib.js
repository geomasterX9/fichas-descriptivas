// ============================================================
// _lib.js — EST 84 · Helpers unificados (supabase + auth + security)
// ============================================================
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

// ── Supabase ──────────────────────────────────────────────
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// ── Permisos por recurso ──────────────────────────────────
const PERMISOS = {
    dashboard:                 ['ADMINISTRADOR', 'DIRECTIVO'],
    alumnos:                   ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL'],
    reportes:                  ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL'],
    expediente:                ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL'],
    personal:                  ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL'],
    'foto-alumno':             ['ADMINISTRADOR', 'DIRECTIVO'],
    'importar-calificaciones': ['ADMINISTRADOR'],
};

// ── Auth ──────────────────────────────────────────────────
async function requireAuth(req, res, recurso) {
    if (req.method === 'OPTIONS') return true;

    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
        return null;
    }

    const token = authHeader.split(' ')[1];

    try {
        const usuario = jwt.verify(token, process.env.JWT_SECRET);

        const { data: usuarioDB } = await supabase
            .from('usuarios')
            .select('token_valido_desde')
            .eq('id_usuario', usuario.id)
            .single();

        if (usuarioDB?.token_valido_desde) {
            const validoDesde = new Date(usuarioDB.token_valido_desde).getTime() / 1000;
            const MARGEN_SEG = 10;
            if (usuario.iat < (validoDesde - MARGEN_SEG)) {
                res.status(401).json({ error: 'Sesión invalidada. Vuelve a iniciar sesión.' });
                return null;
            }
        }

        if (recurso && PERMISOS[recurso] && !PERMISOS[recurso].includes(usuario.rol)) {
            res.status(403).json({ error: 'No tienes permiso para acceder a este recurso.' });
            return null;
        }

        return usuario;
    } catch (e) {
        if (e.name === 'TokenExpiredError') {
            res.status(401).json({ error: 'Sesión expirada. Vuelve a iniciar sesión.' });
        } else {
            res.status(401).json({ error: 'Token inválido.' });
        }
        return null;
    }
}

async function invalidarTokens(id_usuario) {
    await supabase
        .from('usuarios')
        .update({ token_valido_desde: new Date().toISOString() })
        .eq('id_usuario', id_usuario);
}

// ── Security headers ──────────────────────────────────────
const ORIGENES_PERMITIDOS = [
    process.env.ALLOWED_ORIGIN,
    'https://fichas-descriptivas.vercel.app',
].filter(Boolean);

function setSecurityHeaders(res, methods = 'GET, OPTIONS', reqOrigin) {
    let origin = ORIGENES_PERMITIDOS[0] || '*';
    if (reqOrigin) {
        const esPermitido = ORIGENES_PERMITIDOS.includes(reqOrigin) ||
            /^https:\/\/fichas-descriptivas(-[a-z0-9]+)?\.vercel\.app$/.test(reqOrigin);
        if (esPermitido) origin = reqOrigin;
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Vary', 'Origin');

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function sanitize(val) {
    if (typeof val !== 'string') return val;
    return val
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .trim();
}

// ── Ciclo escolar activo ──────────────────────────────────
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60 * 1000;

async function getCicloActivo() {
    const ahora = Date.now();
    if (_cache && (ahora - _cacheTime) < CACHE_TTL_MS) return _cache;
    try {
        const { data, error } = await supabase
            .from('configuracion').select('valor').eq('clave', 'ciclo_activo').single();
        if (error || !data) return _cache || '2025-2026';
        _cache = data.valor;
        _cacheTime = ahora;
        return _cache;
    } catch (e) { return _cache || '2025-2026'; }
}

async function setCicloActivo(nuevoCiclo) {
    if (!/^\d{4}-\d{4}$/.test(nuevoCiclo))
        throw new Error(`Formato de ciclo inválido: "${nuevoCiclo}".`);
    const { error } = await supabase.from('configuracion')
        .upsert({ clave: 'ciclo_activo', valor: nuevoCiclo, updated_at: new Date().toISOString() });
    if (error) throw new Error('Error al actualizar ciclo activo: ' + error.message);
    _cache = nuevoCiclo;
    _cacheTime = Date.now();
}

module.exports = { supabase, requireAuth, invalidarTokens, setSecurityHeaders, sanitize, getCicloActivo, setCicloActivo };
