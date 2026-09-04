const { supabase, requireAuth, setSecurityHeaders, sanitize, getCicloActivo, setCicloActivo, invalidarTokens } = require('./_lib');

// Convierte caracteres griegos/especiales a su equivalente ASCII
// Previene que copias desde sistemas SEP introduzcan caracteres invisiblemente distintos
const sanitizarNombre = s => {
    if (!s || typeof s !== 'string') return s;
    return s
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos estándar
        .replace(/[\u0370-\u03FF]/g, c => {               // reemplaza letras griegas por su equivalente latino
            const map = {
                '\u0391':'A','\u0392':'B','\u0393':'G','\u0394':'D','\u0395':'E','\u0396':'Z',
                '\u0397':'H','\u0398':'TH','\u0399':'I','\u039A':'K','\u039B':'L','\u039C':'M',
                '\u039D':'N','\u039E':'X','\u039F':'O','\u03A0':'P','\u03A1':'R','\u03A3':'S',
                '\u03A4':'T','\u03A5':'Y','\u03A6':'F','\u03A7':'X','\u03A8':'PS','\u03A9':'O',
                '\u03B1':'a','\u03B2':'b','\u03B3':'g','\u03B4':'d','\u03B5':'e','\u03B6':'z',
                '\u03B7':'h','\u03B8':'th','\u03B9':'i','\u03BA':'k','\u03BB':'l','\u03BC':'m',
                '\u03BD':'n','\u03BE':'x','\u03BF':'o','\u03C0':'p','\u03C1':'r','\u03C3':'s',
                '\u03C4':'t','\u03C5':'y','\u03C6':'f','\u03C7':'x','\u03C8':'ps','\u03C9':'o'
            };
            return map[c] || '';
        })
        .replace(/[^\x00-\x7F]/g, '')  // elimina cualquier otro carácter no ASCII restante
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
};

const sanitizarCampos = obj => {
    const resultado = { ...obj };
    if (resultado.apellidos) resultado.apellidos = sanitizarNombre(resultado.apellidos);
    if (resultado.nombre)    resultado.nombre    = sanitizarNombre(resultado.nombre);
    return resultado;
};

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'GET, POST, PATCH, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuario = await requireAuth(req, res, 'alumnos');
    if (!usuario) return;
    const db = usuario._db || supabase;

    const id = req.query.id;

    // ── Con ?id= → operaciones sobre un alumno individual (antes alumno.js) ──
    if (id) {
        if (isNaN(parseInt(id))) return res.status(400).json({ error: 'ID de alumno inválido' });
        if (req.method === 'GET') {
            const { data } = await db.from('alumnos').select('*').eq('id_alumno', parseInt(id)).single();
            return res.json(data || {});
        }
        if (req.method === 'PATCH') {
            if (usuario.rol !== 'ADMINISTRADOR') return res.status(403).json({ error: 'Sin permiso para modificar datos del alumno.' });
            const { error } = await db.from('alumnos').update(sanitizarCampos(req.body)).eq('id_alumno', parseInt(id));
            if (error) return res.status(400).json({ error: error.message });
            return res.json({ exito: true });
        }
        return res.status(405).json({ error: 'Método no permitido' });
    }

    // ── Sin ?id= → lista del ciclo activo, con filtros opcionales ──
    if (req.method === 'GET') {
        const ciclo = await getCicloActivo(db);
        let query = db.from('alumnos').select('*').eq('ciclo_escolar', ciclo);
        if (req.query.grado) query = query.eq('grado', parseInt(req.query.grado));
        if (req.query.grupo) query = query.eq('grupo', req.query.grupo.toUpperCase());
        if (req.query.status) {
            query = query.eq('status', req.query.status);
        } else if (usuario.rol !== 'ADMINISTRADOR') {
            // Roles que no son ADMINISTRADOR solo ven alumnos ACTIVOS
            query = query.eq('status', 'ACTIVO');
        }
        const { data } = await query.order('apellidos', { ascending: true });
        return res.json(data || []);
    }
    // ── Alta masiva (?bulk=1) → importar lista de alumnos desde xlsx, solo ADMINISTRADOR ──
    if (req.method === 'POST' && req.query.bulk === '1') {
        if (usuario.rol !== 'ADMINISTRADOR') return res.status(403).json({ error: 'Solo el administrador puede importar alumnos.' });
        const lista = Array.isArray(req.body?.alumnos) ? req.body.alumnos : [];
        if (lista.length === 0) return res.status(400).json({ error: 'No se recibieron alumnos.' });
        if (lista.length > 1000) return res.status(400).json({ error: 'Demasiados registros en una sola importación.' });

        const ciclo = await getCicloActivo(db);
        const hoy = new Date().toISOString().split('T')[0];
        const registros = [];
        for (const a of lista) {
            const grado    = parseInt(a.grado);
            const grupo    = String(a.grupo || '').trim().toUpperCase();
            const apellidos = String(a.apellidos || '').trim();
            const nombre    = String(a.nombre || '').trim();
            if (![1, 2, 3].includes(grado) || !grupo || !apellidos || !nombre) {
                return res.status(400).json({ error: `Registro inválido: "${apellidos} ${nombre}" (grado ${a.grado}, grupo ${a.grupo})` });
            }
            registros.push(sanitizarCampos({
                apellidos, nombre, grado, grupo,
                status: 'ACTIVO', ciclo_escolar: ciclo, fecha_alta: hoy
            }));
        }

        const { data, error } = await db.from('alumnos').insert(registros).select('id_alumno');
        if (error) return res.status(400).json({ error: error.message });

        await db.from('logs_actividad').insert([{
            id_usuario: usuario.id, nombre_usuario: usuario.nombre, rol: usuario.rol,
            accion: 'IMPORTAR_ALUMNOS', detalle: `Importación masiva: ${data.length} alumnos (ciclo ${ciclo})`,
            ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown'
        }]);

        return res.json({ exito: true, insertados: data.length });
    }

    // Solo ADMINISTRADOR puede crear/modificar alumnos
    if (req.method === 'POST') {
        if (usuario.rol !== 'ADMINISTRADOR') return res.status(403).json({ error: 'Solo el administrador puede crear alumnos.' });
        try {
            const ciclo = await getCicloActivo(db);
            const { error, data } = await db.from('alumnos')
                .insert([{ ...sanitizarCampos(req.body), ciclo_escolar: ciclo }]).select().single();
            if (error) return res.status(400).json({ error: error.message });
            return res.json({ exito: true, alumno: data });
        } catch (e) { return res.status(500).json({ error: 'Error al crear alumno' }); }
    }
    if (req.method === 'PATCH') {
        if (usuario.rol !== 'ADMINISTRADOR') return res.status(403).json({ error: 'Solo el administrador puede modificar alumnos.' });
        try {
            const { id_alumno, ...cambios } = req.body;
            if (!id_alumno) return res.status(400).json({ error: 'Falta id_alumno' });
            const { error } = await db.from('alumnos').update(sanitizarCampos(cambios)).eq('id_alumno', id_alumno);
            if (error) return res.status(400).json({ error: error.message });
            return res.json({ exito: true });
        } catch (e) { return res.status(500).json({ error: 'Error al actualizar alumno' }); }
    }
    res.status(405).json({ error: 'Método no permitido' });
};
