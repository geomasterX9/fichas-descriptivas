const jwt = require('jsonwebtoken');

const PERMISOS = {
    dashboard:                ['ADMINISTRADOR', 'DIRECTIVO'],
    alumnos:                  ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL'],
    reportes:                 ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL'],
    expediente:               ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL'],
    personal:                 ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL'],
    'foto-alumno':            ['ADMINISTRADOR', 'DIRECTIVO'],
    'importar-calificaciones':['ADMINISTRADOR'],
};

function requireAuth(req, res, recurso) {
    if (req.method === 'OPTIONS') return true;

    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
        return null;
    }

    const token = authHeader.split(' ')[1];

    try {
        // Sin fallback — falla si JWT_SECRET no está configurado en Vercel
        const usuario = jwt.verify(token, process.env.JWT_SECRET);

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

module.exports = { requireAuth };
