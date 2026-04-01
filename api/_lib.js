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

// ── Supabase DEMO (base de datos aislada para demos) ──────
const supabaseDemo = createClient(
    process.env.SUPABASE_URL_DEMO,
    process.env.SUPABASE_KEY_DEMO
);

// Devuelve el cliente correcto según si el usuario es demo
function getSupabase(usuario) {
    if (usuario && usuario.esDemo) return supabaseDemo;
    return supabase;
}

// ── Permisos por recurso ──────────────────────────────────
const PERMISOS = {
    dashboard:                 ['ADMINISTRADOR', 'DIRECTIVO'],
    alumnos:                   ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL', 'ENFERMERIA'],
    reportes:                  ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL'],
    expediente:                ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL', 'ENFERMERIA'],
    personal:                  ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL', 'ENFERMERIA'],
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

        // Usar cliente demo si el token lo indica
        const db = getSupabase(usuario);

        const { data: usuarioDB } = await db
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

        // Adjuntar el cliente correcto al objeto usuario para uso en las APIs
        usuario._db = db;
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

async function invalidarTokens(id_usuario, db = supabase) {
    await db
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
let _cacheDemo = null;
let _cacheDemoTime = 0;
const CACHE_TTL_MS = 60 * 1000;

async function getCicloActivo(db = supabase) {
    const ahora = Date.now();
    const esDemo = db === supabaseDemo;
    if (esDemo) {
        if (_cacheDemo && (ahora - _cacheDemoTime) < CACHE_TTL_MS) return _cacheDemo;
    } else {
        if (_cache && (ahora - _cacheTime) < CACHE_TTL_MS) return _cache;
    }
    try {
        const { data, error } = await db
            .from('configuracion').select('valor').eq('clave', 'ciclo_activo').single();
        const fallback = esDemo ? '2026-2027' : '2025-2026';
        if (error || !data) return esDemo ? (_cacheDemo || fallback) : (_cache || fallback);
        if (esDemo) { _cacheDemo = data.valor; _cacheDemoTime = ahora; return _cacheDemo; }
        _cache = data.valor; _cacheTime = ahora; return _cache;
    } catch (e) { return esDemo ? (_cacheDemo || '2026-2027') : (_cache || '2025-2026'); }
}

async function setCicloActivo(nuevoCiclo, db = supabase) {
    if (!/^\d{4}-\d{4}$/.test(nuevoCiclo))
        throw new Error(`Formato de ciclo inválido: "${nuevoCiclo}".`);
    const { error } = await db.from('configuracion')
        .upsert({ clave: 'ciclo_activo', valor: nuevoCiclo, updated_at: new Date().toISOString() });
    if (error) throw new Error('Error al actualizar ciclo activo: ' + error.message);
    if (db === supabaseDemo) { _cacheDemo = nuevoCiclo; _cacheDemoTime = Date.now(); }
    else { _cache = nuevoCiclo; _cacheTime = Date.now(); }
}

module.exports = { supabase, supabaseDemo, getSupabase, requireAuth, invalidarTokens, setSecurityHeaders, sanitize, getCicloActivo, setCicloActivo };
