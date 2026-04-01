const { supabase, requireAuth, setSecurityHeaders, sanitize, getCicloActivo, setCicloActivo, invalidarTokens } = require('./_lib');

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'GET, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuario = await requireAuth(req, res, 'personal');
    if (!usuario) return;
    const db = usuario._db || supabase;

    try {
        const rolUsuario = req.query.rol ? req.query.rol.toUpperCase().trim() : null;
        const { data, error } = await db.from('personal').select('id_personal, nombre_completo, funcion').order('nombre_completo');
        if (error) throw error;
        const todos = data || [];
        if (!rolUsuario) return res.json(todos);
        const mapaExacto = {
            'ADMINISTRADOR':  ['ADMINISTRADOR'],
            'PREFECTO':       ['PREFECTA', 'PREFECTO'],
            'DOCENTE':        ['DOCENTE'],
            'TRABAJO SOCIAL': ['TRABAJO SOCIAL'],
            'DIRECTIVO':      ['DIRECTOR', 'SUBDIRECTORA', 'SUBDIRECTOR', 'COORDINADOR ACADÉMICO', 'COORDINADORA ACADÉMICA', 'COORDINADOR ASISTENCIA EDUCATIVA'],
        };
        const valoresPermitidos = mapaExacto[rolUsuario];
        if (!valoresPermitidos) return res.json(todos);
        res.json(todos.filter(p => valoresPermitidos.includes((p.funcion || '').trim().toUpperCase())));
    } catch (e) { res.status(500).json({ error: 'Error al cargar personal' }); }
};
