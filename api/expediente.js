const supabase = require('../lib/_supabase');
const { requireAuth } = require('../lib/_auth');
const { setSecurityHeaders } = require('../lib/_security');

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'GET, POST, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuario = await requireAuth(req, res, 'expediente');
    if (!usuario) return;

    const tipo = req.query.tipo;
    const id = req.query.id;

    if (id && isNaN(parseInt(id))) return res.status(400).json({ error: 'ID inválido' });

    if (req.method === 'GET' && tipo === 'calificaciones') {
        const { data } = await supabase.from('calificaciones').select('*').eq('id_alumno', parseInt(id)).order('trimestre', { ascending: true });
        return res.json(data || []);
    }
    if (req.method === 'GET' && tipo === 'ficha') {
        const { data } = await supabase.from('datos_socioeconomicos').select('*').eq('id_alumno', parseInt(id)).single();
        if (!data) return res.json({});

        // Roles con acceso completo a datos sensibles
        const ROLES_COMPLETOS = ['ADMINISTRADOR', 'DIRECTIVO', 'TRABAJO SOCIAL'];
        if (!ROLES_COMPLETOS.includes(usuario.rol)) {
            // DOCENTE / PREFECTO: eliminar campos privados antes de enviar
            const CAMPOS_PRIVADOS = [
                'domicilio_calle', 'telefono_casa',
                'tutor_telefono', 'madre_telefono', 'padre_telefono'
            ];
            CAMPOS_PRIVADOS.forEach(campo => delete data[campo]);
        }

        return res.json(data);
    }
    if (req.method === 'POST' && tipo === 'ficha') {
        // Solo Admin y Trabajo Social pueden escribir la ficha
        if (!['ADMINISTRADOR', 'TRABAJO SOCIAL'].includes(usuario.rol)) {
            return res.status(403).json({ error: 'Sin permiso para modificar la ficha socioeconómica.' });
        }
        const { error } = await supabase.from('datos_socioeconomicos').upsert(req.body, { onConflict: 'id_alumno' });
        if (error) return res.status(400).json({ error: error.message });
        return res.json({ exito: true });
    }

    res.status(400).json({ error: 'Parámetros inválidos' });
};
