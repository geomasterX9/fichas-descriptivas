const supabase = require('../lib/_supabase');
const { requireAuth } = require('../lib/_auth');
const { setSecurityHeaders, sanitize } = require('../lib/_security');
const { getCicloActivo } = require('../lib/_ciclo');

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'GET, POST, PATCH, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuario = await requireAuth(req, res, 'alumnos');
    if (!usuario) return;

    const id = req.query.id;

    // ── Con ?id= → operaciones sobre un alumno individual (antes alumno.js) ──
    if (id) {
        if (isNaN(parseInt(id))) return res.status(400).json({ error: 'ID de alumno inválido' });
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
        return res.status(405).json({ error: 'Método no permitido' });
    }

    // ── Sin ?id= → lista completa del ciclo activo ──
    if (req.method === 'GET') {
        const ciclo = await getCicloActivo();
        const { data } = await supabase.from('alumnos').select('*')
            .eq('ciclo_escolar', ciclo)
            .order('apellidos', { ascending: true });
        return res.json(data || []);
    }
    // Solo ADMINISTRADOR puede crear/modificar alumnos
    if (req.method === 'POST') {
        if (usuario.rol !== 'ADMINISTRADOR') return res.status(403).json({ error: 'Solo el administrador puede crear alumnos.' });
        try {
            const ciclo = await getCicloActivo();
            const { error, data } = await supabase.from('alumnos')
                .insert([{ ...req.body, ciclo_escolar: ciclo }]).select().single();
            if (error) return res.status(400).json({ error: error.message });
            return res.json({ exito: true, alumno: data });
        } catch (e) { return res.status(500).json({ error: 'Error al crear alumno' }); }
    }
    if (req.method === 'PATCH') {
        if (usuario.rol !== 'ADMINISTRADOR') return res.status(403).json({ error: 'Solo el administrador puede modificar alumnos.' });
        try {
            const { id_alumno, ...cambios } = req.body;
            if (!id_alumno) return res.status(400).json({ error: 'Falta id_alumno' });
            const { error } = await supabase.from('alumnos').update(cambios).eq('id_alumno', id_alumno);
            if (error) return res.status(400).json({ error: error.message });
            return res.json({ exito: true });
        } catch (e) { return res.status(500).json({ error: 'Error al actualizar alumno' }); }
    }
    res.status(405).json({ error: 'Método no permitido' });
};
