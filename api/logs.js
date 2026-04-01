const { supabase, getSupabase, requireAuth, setSecurityHeaders, sanitize, getCicloActivo, setCicloActivo, invalidarTokens } = require('./_lib');

// Acciones válidas para registro
const ACCIONES_VALIDAS = [
    'LOGIN', 'LOGOUT',
    'VER_EXPEDIENTE', 'VER_BUSCADOR',
    'REGISTRAR_OBSERVACION', 'IMPORTAR_CALIFICACIONES',
    'SUBIR_FOTO', 'CARGA_MASIVA_FOTOS',
    'CREAR_USUARIO', 'EDITAR_USUARIO', 'ELIMINAR_USUARIO', 'CAMBIAR_CONTRASENA',
    'CREAR_ALUMNO', 'EDITAR_ALUMNO', 'BAJA_ALUMNO', 'REACTIVAR_ALUMNO',
    'VER_DASHBOARD', 'GUARDAR_FICHA', 'IMPORTAR_USUARIOS',
    'CIERRE_CICLO_EGRESADOS', 'CIERRE_CICLO_ACTIVAR',
    'RESET_DATOS'
];

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'GET, POST, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // POST: cualquier usuario autenticado puede registrar logs
    // GET:  solo ADMINISTRADOR puede consultar logs
    const recurso = req.method === 'GET' ? 'dashboard' : null;
    const usuario = await requireAuth(req, res, recurso);
    if (!usuario) return;
    const db = usuario._db || supabase;

    // ── POST: registrar una acción ──
    if (req.method === 'POST') {
        const { accion, detalle } = req.body || {};
        if (!accion || !ACCIONES_VALIDAS.includes(accion.toUpperCase())) {
            return res.status(400).json({ error: 'Acción no válida.' });
        }
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
        const { error } = await db.from('logs_actividad').insert([{
            id_usuario:     usuario.id,
            nombre_usuario: usuario.nombre,
            rol:            usuario.rol,
            accion:         accion.toUpperCase(),
            detalle:        detalle ? sanitize(String(detalle).substring(0, 300)) : null,
            ip
        }]);
        if (error) return res.status(500).json({ error: 'Error al registrar log.' });
        return res.json({ exito: true });
    }

    // ── GET: consultar logs — solo ADMINISTRADOR ──
    if (req.method === 'GET') {
        if (usuario.rol !== 'ADMINISTRADOR') {
            return res.status(403).json({ error: 'Solo el administrador puede consultar los logs.' });
        }

        const { usuario: filtroUsuario, accion: filtroAccion, fecha_ini, fecha_fin, limit = 200 } = req.query;

        let query = supabase
            .from('logs_actividad')
            .select('*')
            .order('fecha', { ascending: false })
            .limit(Math.min(parseInt(limit) || 200, 500));

        if (filtroUsuario) query = query.ilike('nombre_usuario', `%${filtroUsuario}%`);
        if (filtroAccion)  query = query.eq('accion', filtroAccion.toUpperCase());
        if (fecha_ini)     query = query.gte('fecha', fecha_ini);
        if (fecha_fin)     query = query.lte('fecha', fecha_fin + 'T23:59:59Z');

        const { data, error } = await query;
        if (error) return res.status(500).json({ error: 'Error al consultar logs.' });
        return res.json(data || []);
    }

    res.status(405).json({ error: 'Método no permitido' });
};
