const { supabase, requireAuth, setSecurityHeaders, sanitize, getCicloActivo, setCicloActivo, invalidarTokens } = require('./_lib');

const GRAVEDADES_VALIDAS = ['Positiva', 'Leve', 'Moderada', 'Grave'];

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'GET, POST, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuario = await requireAuth(req, res, 'reportes');
    if (!usuario) return;
    const db = usuario._db || supabase;

    if (req.method === 'GET') {
        try {
            const id = req.query.id;
            if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID inválido' });

            // Permite consultar ciclo específico o el activo
            const cicloQuery = req.query.ciclo || null;
            const ciclo = cicloQuery || await getCicloActivo(db);

            const { data: reportes } = await db
                .from('reportes_disciplinarios').select('*')
                .eq('id_alumno', parseInt(id))
                .eq('ciclo_escolar', ciclo)
                .order('fecha', { ascending: false });
            if (!reportes || reportes.length === 0) return res.json([]);

            // Resolver nombres: buscar en usuarios (nuevo) y personal (compatibilidad legado)
            const { data: usuariosDB } = await db.from('usuarios').select('id_usuario, nombre_completo');
            const { data: personal }   = await db.from('personal').select('id_personal, nombre_completo');
            const mapaUsuarios = {};
            const mapaPersonal = {};
            (usuariosDB || []).forEach(u => { mapaUsuarios[u.id_usuario]  = u.nombre_completo; });
            (personal   || []).forEach(p => { mapaPersonal[p.id_personal] = p.nombre_completo; });

            res.json(reportes.map(r => ({
                ...r,
                nombre_reporta: r.id_usuario
                    ? (mapaUsuarios[r.id_usuario] || '—')
                    : (mapaPersonal[r.id_personal] || '—')
            })));
        } catch (e) { res.status(500).json({ error: 'Error al cargar reportes' }); }
    }

    else if (req.method === 'POST') {
        try {
            const { id_alumno, gravedad, motivo, id_usuario, fecha, acuerdo } = req.body || {};

            if (!id_alumno || !gravedad || !motivo || !id_usuario)
                return res.status(400).json({ error: 'Todos los campos son requeridos.' });
            if (!GRAVEDADES_VALIDAS.includes(gravedad))
                return res.status(400).json({ error: 'Gravedad no válida.' });
            if (typeof motivo !== 'string' || motivo.trim().length < 5 || motivo.length > 500)
                return res.status(400).json({ error: 'El motivo debe tener entre 5 y 500 caracteres.' });
            if (isNaN(parseInt(id_alumno)) || isNaN(parseInt(id_usuario)))
                return res.status(400).json({ error: 'IDs inválidos.' });

            // Seguridad: el id_usuario del body debe coincidir con el del token JWT
            if (parseInt(id_usuario) !== parseInt(usuario.id))
                return res.status(403).json({ error: 'No puedes registrar reportes en nombre de otro usuario.' });

            const cicloActivo = await getCicloActivo(db);
            const payload = {
                id_alumno:     parseInt(id_alumno),
                id_usuario:    parseInt(id_usuario),
                gravedad,
                motivo:        sanitize(motivo.trim()),
                acuerdo:       acuerdo ? sanitize(acuerdo.trim()) : null,
                fecha:         fecha || new Date().toISOString().split('T')[0],
                ciclo_escolar: cicloActivo
            };
            const { error } = await db.from('reportes_disciplinarios').insert([payload]);
            if (error) return res.status(400).json({ error: error.message });
            res.json({ exito: true });
        } catch (e) { res.status(500).json({ error: 'Error al guardar reporte' }); }
    }

    else { res.status(405).json({ error: 'Método no permitido' }); }
};
