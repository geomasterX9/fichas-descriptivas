const jwt = require('jsonwebtoken');
const supabase = require('./_supabase');

const PERMISOS = {
    dashboard:                ['ADMINISTRADOR', 'DIRECTIVO'],
    alumnos:                  ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL'],
    reportes:                 ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL'],
    expediente:               ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL'],
    personal:                 ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL'],
    'foto-alumno':            ['ADMINISTRADOR', 'DIRECTIVO'],
    'importar-calificaciones':['ADMINISTRADOR'],
};

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

        // ── Verificar que el token no haya sido invalidado ──
        const { data: usuarioDB } = await supabase
            .from('usuarios')
            .select('token_valido_desde')
            .eq('id_usuario', usuario.id)
            .single();

        if (usuarioDB?.token_valido_desde) {
            const validoDesde = new Date(usuarioDB.token_valido_desde).getTime() / 1000;
            if (usuario.iat < validoDesde) {
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

// Invalida todos los tokens activos de un usuario actualizando token_valido_desde
async function invalidarTokens(id_usuario) {
    await supabase
        .from('usuarios')
        .update({ token_valido_desde: new Date().toISOString() })
        .eq('id_usuario', id_usuario);
}

module.exports = { requireAuth, invalidarTokens };
