const supabase = require('./_supabase');
const { requireAuth } = require('./_auth');
const { setSecurityHeaders } = require('./_security');

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'GET, PATCH, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuario = await requireAuth(req, res, 'alumnos');
    if (!usuario) return;

    const id = req.query.id;
    if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID de alumno inválido' });

    if (req.method === 'GET') {
        const { data } = await supabase.from('alumnos').select('*').eq('id_alumno', parseInt(id)).single();
        return res.json(data || {});
    }
    if (req.method === 'PATCH') {
        if (usuario.rol !== 'ADMINISTRADOR') return res.status(403).json({ error: 'Sin permiso para modificar datos del alumno.' });
        const { error } = await supabase.from('alumnos').update(req.body).eq('id_alumno', parseInt(id));
        if (error) return res.status(400).json({ error: error.message });
        return res.json({ exito: true });
    }
    res.status(405).json({ error: 'Método no permitido' });
};
