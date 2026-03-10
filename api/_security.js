// ============================================================
// CABECERAS DE SEGURIDAD HTTP — EST 84
// ============================================================

// Lista de orígenes permitidos
const ORIGENES_PERMITIDOS = [
    process.env.ALLOWED_ORIGIN,           // tu URL exacta de Vercel (env var)
    'https://fichas-descriptivas.vercel.app',
].filter(Boolean);

function setSecurityHeaders(res, methods = 'GET, OPTIONS', reqOrigin) {
    // Permitir el origen si está en la lista O si es cualquier subdominio de vercel.app del proyecto
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

    // Cabeceras de seguridad HTTP
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

module.exports = { setSecurityHeaders, sanitize };
