// ============================================================
// FICHA PÚBLICA — Sin JWT
// GET  ?grado=1&grupo=A   → lista alumnos del grupo
// POST (body con id_alumno) → guardar ficha
// ============================================================
const supabase = require('./_supabase');
const { setSecurityHeaders } = require('./_security');

function setCorsPublico(res, reqOrigin) {
    const permitidos = [
        'https://fichas-descriptivas.vercel.app',
        /^https:\/\/fichas-descriptivas(-[a-z0-9]+)?\.vercel\.app$/
    ];
    let origin = 'https://fichas-descriptivas.vercel.app';
    if (reqOrigin) {
        const ok = permitidos.some(p => typeof p === 'string' ? p === reqOrigin : p.test(reqOrigin));
        if (ok) origin = reqOrigin;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
}

module.exports = async (req, res) => {
    setCorsPublico(res, req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── GET: listar alumnos del grupo ──
    if (req.method === 'GET') {
        const grado = (req.query.grado || '').trim();
        const grupo = (req.query.grupo || '').toUpperCase().trim();

        if (!grado || !grupo) {
            return res.status(400).json({ error: 'Se requiere grado y grupo.' });
        }

        const gradoNum = parseInt(grado);
        if (isNaN(gradoNum) || gradoNum < 1 || gradoNum > 3) {
            return res.status(400).json({ error: 'Grado inválido.' });
        }
        if (!/^[A-F]$/.test(grupo)) {
            return res.status(400).json({ error: 'Grupo inválido.' });
        }

        const { data, error } = await supabase
            .from('alumnos')
            .select('id_alumno, nombre, apellidos, grado, grupo, ficha_completada')
            .eq('grado', gradoNum)
            .eq('grupo', grupo)
            .eq('status', 'ACTIVO')
            .order('apellidos', { ascending: true });

        if (error) return res.status(500).json({ error: 'Error al consultar alumnos.' });
        return res.json(data || []);
    }

    // ── POST: guardar ficha ──
    if (req.method === 'POST') {
        const d = req.body;
        const idAlumno = parseInt(d.id_alumno);

        if (!idAlumno || isNaN(idAlumno)) {
            return res.status(400).json({ error: 'ID de alumno inválido.' });
        }

        // Verificar que el alumno existe y no tiene ficha
        const { data: alumno, error: errAlu } = await supabase
            .from('alumnos')
            .select('id_alumno, nombre, apellidos, ficha_completada')
            .eq('id_alumno', idAlumno)
            .single();

        if (errAlu || !alumno) {
            return res.status(404).json({ error: 'Alumno no encontrado.' });
        }
        if (alumno.ficha_completada) {
            return res.status(409).json({ error: 'La ficha de este alumno ya fue completada.' });
        }

        // Validar campos mínimos
        const requeridos = ['tutor_nombre', 'tutor_telefono', 'domicilio_calle'];
        for (const campo of requeridos) {
            if (!d[campo] || String(d[campo]).trim() === '') {
                return res.status(400).json({ error: `El campo "${campo}" es obligatorio.` });
            }
        }

        const ficha = {
            id_alumno:          idAlumno,
            tutor_nombre:       String(d.tutor_nombre || '').trim().substring(0, 150),
            tutor_parentesco:   String(d.tutor_parentesco || '').trim().substring(0, 60),
            tutor_telefono:     String(d.tutor_telefono || '').trim().substring(0, 20),
            tutor_ocupacion:    String(d.tutor_ocupacion || '').trim().substring(0, 80),
            madre_nombre:       String(d.madre_nombre || '').trim().substring(0, 150),
            madre_telefono:     String(d.madre_telefono || '').trim().substring(0, 20),
            madre_ocupacion:    String(d.madre_ocupacion || '').trim().substring(0, 80),
            padre_nombre:       String(d.padre_nombre || '').trim().substring(0, 150),
            padre_telefono:     String(d.padre_telefono || '').trim().substring(0, 20),
            ocupacion_papa:     String(d.padre_ocupacion || '').trim().substring(0, 80),
            con_quien_vive:     String(d.con_quien_vive || '').trim().substring(0, 60),
            num_hermanos:       parseInt(d.num_hermanos) || 0,
            ingreso_mensual:    String(d.ingreso_mensual || '').trim().substring(0, 40),
            vivienda_tipo:      String(d.vivienda_tipo || '').trim().substring(0, 40),
            vivienda_servicios: String(d.vivienda_servicios || '').trim().substring(0, 200),
            domicilio_calle:    String(d.domicilio_calle || '').trim().substring(0, 200),
            telefono_casa:      String(d.telefono_casa || '').trim().substring(0, 20),
            condicion_salud:    String(d.condicion_salud || '').trim().substring(0, 300),
            discapacidad:       String(d.discapacidad || '').trim().substring(0, 200),
            observaciones:      String(d.observaciones || '').trim().substring(0, 500),
        };

        const { error: errFicha } = await supabase
            .from('datos_socioeconomicos')
            .upsert(ficha, { onConflict: 'id_alumno' });

        if (errFicha) return res.status(500).json({ error: 'Error al guardar. Intenta de nuevo.' });

        // Marcar ficha como completada
        await supabase
            .from('alumnos')
            .update({ ficha_completada: true })
            .eq('id_alumno', idAlumno);

        return res.json({ exito: true, nombre: alumno.nombre, apellidos: alumno.apellidos });
    }

    res.status(405).json({ error: 'Método no permitido' });
};
