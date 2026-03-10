const supabase = require('../lib/_supabase');
const { requireAuth } = require('../lib/_auth');
const { setSecurityHeaders, sanitize } = require('../lib/_security');

const GRAVEDADES_VALIDAS = ['Positiva', 'Leve', 'Moderada', 'Grave'];

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'GET, POST, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuario = await requireAuth(req, res, 'reportes');
    if (!usuario) return;

    if (req.method === 'GET') {
        try {
            const id = req.query.id;
            if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID inválido' });
            const { data: reportes } = await supabase
                .from('reportes_disciplinarios').select('*')
                .eq('id_alumno', parseInt(id)).order('fecha', { ascending: false });
            if (!reportes || reportes.length === 0) return res.json([]);
            const { data: personal } = await supabase.from('personal').select('id_personal, nombre_completo');
            const mapaPersonal = {};
            (personal || []).forEach(p => { mapaPersonal[p.id_personal] = p.nombre_completo; });
            res.json(reportes.map(r => ({ ...r, nombre_reporta: mapaPersonal[r.id_personal] || '—' })));
        } catch (e) { res.status(500).json({ error: 'Error al cargar reportes' }); }
    }

    else if (req.method === 'POST') {
        try {
            const { id_alumno, gravedad, motivo, id_personal, fecha } = req.body || {};
            // ── Validación de inputs ──
            if (!id_alumno || !gravedad || !motivo || !id_personal) return res.status(400).json({ error: 'Todos los campos son requeridos.' });
            if (!GRAVEDADES_VALIDAS.includes(gravedad)) return res.status(400).json({ error: 'Gravedad no válida.' });
            if (typeof motivo !== 'string' || motivo.trim().length < 5 || motivo.length > 500) return res.status(400).json({ error: 'El motivo debe tener entre 5 y 500 caracteres.' });
            if (isNaN(parseInt(id_alumno)) || isNaN(parseInt(id_personal))) return res.status(400).json({ error: 'IDs inválidos.' });

            const payload = {
                id_alumno: parseInt(id_alumno),
                id_personal: parseInt(id_personal),
                gravedad,
                motivo: sanitize(motivo.trim()),
                fecha: fecha || new Date().toISOString().split('T')[0]
            };
            const { error } = await supabase.from('reportes_disciplinarios').insert([payload]);
            if (error) return res.status(400).json({ error: error.message });
            res.json({ exito: true });
        } catch (e) { res.status(500).json({ error: 'Error al guardar reporte' }); }
    }

    else { res.status(405).json({ error: 'Método no permitido' }); }
};
