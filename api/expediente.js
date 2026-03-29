const { supabase, requireAuth, setSecurityHeaders, sanitize, getCicloActivo, setCicloActivo, invalidarTokens } = require('./_lib');

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'GET, POST, DELETE, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuario = await requireAuth(req, res, 'expediente');
    if (!usuario) return;

    const tipo  = req.query.tipo;
    const id    = req.query.id;
    const cicloQuery = req.query.ciclo || null;

    if (id && isNaN(parseInt(id))) return res.status(400).json({ error: 'ID inválido' });

    // Rutas médicas — despachar a handlers dedicados
    if (tipo === 'medico')               return handleMedico(req, res, usuario, id);
    if (tipo === 'visitas_enfermeria')   return handleVisitas(req, res, usuario, id);
    if (tipo === 'justificante')         return handleJustificante(req, res, usuario, id);

    // Historial de todos los expedientes médicos registrados
    if (req.method === 'GET' && tipo === 'medico_historial') {
        const ROLES_MEDICO_H = ['ADMINISTRADOR', 'DIRECTIVO', 'ENFERMERIA'];
        if (!ROLES_MEDICO_H.includes(usuario.rol))
            return res.status(403).json({ error: 'Sin acceso.' });
        const { data } = await supabase
            .from('expedientes_medicos')
            .select('*, alumnos(apellidos, nombre, grado, grupo)')
            .order('fecha_actualizacion', { ascending: false })
            .limit(50);
        return res.json(data || []);
    }

    const ciclo = cicloQuery || await getCicloActivo();

    if (req.method === 'GET' && tipo === 'calificaciones') {
        const { data } = await supabase.from('calificaciones').select('*')
            .eq('id_alumno', parseInt(id))
            .eq('ciclo_escolar', ciclo)
            .order('trimestre', { ascending: true });
        return res.json(data || []);
    }
    if (req.method === 'GET' && tipo === 'ficha') {
        const { data } = await supabase.from('datos_socioeconomicos').select('*')
            .eq('id_alumno', parseInt(id))
            .eq('ciclo_escolar', ciclo)
            .single();
        if (!data) return res.json({});

        const ROLES_COMPLETOS = ['ADMINISTRADOR', 'DIRECTIVO', 'TRABAJO SOCIAL'];
        if (!ROLES_COMPLETOS.includes(usuario.rol)) {
            const CAMPOS_PRIVADOS = [
                'domicilio_calle', 'telefono_casa',
                'tutor_telefono', 'madre_telefono', 'padre_telefono'
            ];
            CAMPOS_PRIVADOS.forEach(campo => delete data[campo]);
        }
        return res.json(data);
    }
    // Evaluaciones parciales — GET
    if (req.method === 'GET' && tipo === 'evaluaciones_parciales') {
        const ciclo = await getCicloActivo();
        const { data } = await supabase.from('evaluaciones_parciales').select('*')
            .eq('id_alumno', parseInt(id))
            .eq('ciclo_escolar', ciclo)
            .order('trimestre', { ascending: true });
        return res.json(data || []);
    }

    // Evaluaciones parciales — POST (guardar/actualizar)
    if (req.method === 'POST' && tipo === 'evaluaciones_parciales') {
        const { id_alumno, trimestre, materias } = req.body || {};
        if (!id_alumno || !trimestre || !materias)
            return res.status(400).json({ error: 'Faltan parámetros.' });
        const ciclo = await getCicloActivo();
        const { error } = await supabase.from('evaluaciones_parciales')
            .upsert({
                id_alumno:    parseInt(id_alumno),
                trimestre:    parseInt(trimestre),
                materias,
                ciclo_escolar: ciclo,
                id_usuario:   usuario.id,
                fecha_registro: new Date().toISOString()
            }, { onConflict: 'id_alumno,trimestre,ciclo_escolar' });
        if (error) return res.status(400).json({ error: error.message });
        return res.json({ exito: true });
    }

    // Guardar motivos de reprobación — cualquier rol puede registrarlos
    if (req.method === 'POST' && tipo === 'motivos_reprobacion') {
        const { id_alumno, trimestre, motivos_reprobacion } = req.body || {};
        if (!id_alumno || !trimestre) return res.status(400).json({ error: 'Faltan parámetros.' });
        if (typeof motivos_reprobacion !== 'string' || motivos_reprobacion.length > 1000)
            return res.status(400).json({ error: 'El texto no puede exceder 1000 caracteres.' });
        const { error } = await supabase.from('calificaciones')
            .update({ motivos_reprobacion: motivos_reprobacion.trim() || null })
            .eq('id_alumno', parseInt(id_alumno))
            .eq('trimestre', parseInt(trimestre));
        if (error) return res.status(400).json({ error: error.message });
        return res.json({ exito: true });
    }

    if (req.method === 'POST' && tipo === 'ficha') {
        if (!['ADMINISTRADOR', 'TRABAJO SOCIAL'].includes(usuario.rol)) {
            return res.status(403).json({ error: 'Sin permiso para modificar la ficha socioeconómica.' });
        }
        const cicloActivo = await getCicloActivo();
        const { error } = await supabase.from('datos_socioeconomicos')
            .upsert({ ...req.body, ciclo_escolar: cicloActivo }, { onConflict: 'id_alumno' });
        if (error) return res.status(400).json({ error: error.message });
        return res.json({ exito: true });
    }


    // GET recuperacion de un alumno
    if (req.method === 'GET' && tipo === 'recuperacion') {
        const { data } = await supabase.from('calificaciones')
            .select('trimestre, materias, recuperacion')
            .eq('id_alumno', parseInt(id))
            .eq('ciclo_escolar', ciclo)
            .order('trimestre', { ascending: true });
        return res.json(data || []);
    }

    // POST guardar/actualizar calificacion de recuperacion
    if (req.method === 'POST' && tipo === 'recuperacion') {
        const { id_alumno, trimestre, sigla, calif_recuperacion } = req.body || {};
        if (!id_alumno || !trimestre || !sigla || calif_recuperacion === undefined)
            return res.status(400).json({ error: 'Faltan parámetros.' });

        const califNum = parseFloat(calif_recuperacion);
        if (isNaN(califNum) || califNum < 5 || califNum > 10)
            return res.status(400).json({ error: 'Calificación inválida (5-10).' });

        // Verificar permisos: admin puede todo, docente solo su materia
        if (usuario.rol !== 'ADMINISTRADOR' && usuario.rol !== 'DIRECTIVO') {
            const { data: uDB } = await supabase
                .from('usuarios').select('materia').eq('id_usuario', usuario.id).single();
            const materias = Array.isArray(uDB?.materia) ? uDB.materia : [];
            if (!materias.includes(sigla))
                return res.status(403).json({ error: 'Solo puedes editar tus materias asignadas.' });
        }

        // Leer recuperacion actual
        const { data: calActual } = await supabase
            .from('calificaciones')
            .select('recuperacion, materias')
            .eq('id_alumno', parseInt(id_alumno))
            .eq('trimestre', parseInt(trimestre))
            .eq('ciclo_escolar', ciclo)
            .single();

        if (!calActual) return res.status(404).json({ error: 'No se encontró el registro de calificaciones.' });

        // Obtener calif original
        const materiaObj = (calActual.materias || []).find(m => m.sigla === sigla);
        const califOriginal = materiaObj ? materiaObj.calif : null;

        let recuperacionArr = Array.isArray(calActual.recuperacion) ? [...calActual.recuperacion] : [];
        const idx = recuperacionArr.findIndex(r => r.sigla === sigla);
        const nuevaEntrada = { sigla, calif_original: califOriginal, calif_recuperacion: califNum };

        if (idx >= 0) recuperacionArr[idx] = nuevaEntrada;
        else recuperacionArr.push(nuevaEntrada);

        // Actualizar también la calificación en el array materias
        const materiasActualizadas = (calActual.materias || []).map(m =>
            m.sigla === sigla ? { ...m, calif: String(califNum) } : m
        );

        const { error } = await supabase.from('calificaciones')
            .update({ recuperacion: recuperacionArr, materias: materiasActualizadas })
            .eq('id_alumno', parseInt(id_alumno))
            .eq('trimestre', parseInt(trimestre))
            .eq('ciclo_escolar', ciclo);

        if (error) return res.status(400).json({ error: error.message });
        return res.json({ exito: true });
    }

    res.status(400).json({ error: 'Parámetros inválidos' });
};

// ── ROLES CON ACCESO MÉDICO ──────────────────────────────────
const ROLES_MEDICO = ['ADMINISTRADOR', 'DIRECTIVO', 'ENFERMERIA'];

// ── EXPEDIENTE MÉDICO ────────────────────────────────────────
// GET  /api/expediente?tipo=medico&id=X
// POST /api/expediente?tipo=medico  { id_alumno, ...campos }
async function handleMedico(req, res, usuario, id) {
    if (!ROLES_MEDICO.includes(usuario.rol))
        return res.status(403).json({ error: 'Sin acceso al expediente médico.' });

    if (req.method === 'GET') {
        const { data } = await supabase.from('expedientes_medicos')
            .select('*').eq('id_alumno', parseInt(id)).maybeSingle();
        return res.json(data || {});
    }
    if (req.method === 'POST') {
        const { id_alumno, ...campos } = req.body || {};
        if (!id_alumno) return res.status(400).json({ error: 'Falta id_alumno' });
        const { error } = await supabase.from('expedientes_medicos')
            .upsert({ ...campos, id_alumno: parseInt(id_alumno),
                      actualizado_por: usuario.nombre,
                      fecha_actualizacion: new Date().toISOString() },
                    { onConflict: 'id_alumno' });
        if (error) return res.status(400).json({ error: error.message });
        return res.json({ exito: true });
    }
    return res.status(405).json({ error: 'Método no permitido' });
}

// ── VISITAS A ENFERMERÍA ─────────────────────────────────────
// GET  /api/expediente?tipo=visitas_enfermeria&id=X
// POST /api/expediente?tipo=visitas_enfermeria  { id_alumno, fecha, motivo, tratamiento }
async function handleVisitas(req, res, usuario, id) {
    if (!ROLES_MEDICO.includes(usuario.rol))
        return res.status(403).json({ error: 'Sin acceso a visitas de enfermería.' });

    if (req.method === 'GET') {
        const { data } = await supabase.from('visitas_enfermeria')
            .select('*').eq('id_alumno', parseInt(id))
            .order('fecha', { ascending: false });
        return res.json(data || []);
    }
    if (req.method === 'POST') {
        const { id_alumno, fecha, motivo, tratamiento } = req.body || {};
        if (!id_alumno || !motivo) return res.status(400).json({ error: 'Faltan parámetros.' });
        const { error } = await supabase.from('visitas_enfermeria').insert({
            id_alumno: parseInt(id_alumno),
            fecha: fecha || new Date().toISOString().split('T')[0],
            motivo, tratamiento: tratamiento || null,
            registrado_por: usuario.nombre
        });
        if (error) return res.status(400).json({ error: error.message });
        return res.json({ exito: true });
    }
    return res.status(405).json({ error: 'Método no permitido' });
}

// ── JUSTIFICANTES MÉDICOS ────────────────────────────────────
// GET    /api/expediente?tipo=justificante&id=X  (historial del alumno)
// GET    /api/expediente?tipo=justificante        (activos hoy — para notif docentes)
// POST   /api/expediente?tipo=justificante  { id_alumno, fecha_inicio, fecha_fin, motivo }
// DELETE /api/expediente?tipo=justificante&id=X  (desactivar)
async function handleJustificante(req, res, usuario, id) {
    if (!ROLES_MEDICO.includes(usuario.rol) && !['DOCENTE','PREFECTO','TRABAJO SOCIAL'].includes(usuario.rol))
        return res.status(403).json({ error: 'Sin acceso a justificantes.' });

    if (req.method === 'GET') {
        if (id) {
            // Historial de un alumno
            const { data } = await supabase.from('justificantes_medicos')
                .select('*').eq('id_alumno', parseInt(id))
                .order('fecha_inicio', { ascending: false });
            return res.json(data || []);
        } else {
            // Justificantes emitidos en los últimos 7 días — para notificación a docentes
            const hoy = new Date().toISOString().split('T')[0];
            const haceUnaSemana = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const { data } = await supabase.from('justificantes_medicos')
                .select('*, alumnos(apellidos, nombre, grado, grupo)')
                .eq('activo', true)
                .gte('fecha_fin', haceUnaSemana)
                .order('fecha_fin', { ascending: true });
            return res.json(data || []);
        }
    }
    if (req.method === 'POST') {
        if (!ROLES_MEDICO.includes(usuario.rol))
            return res.status(403).json({ error: 'Solo enfermería puede emitir justificantes.' });
        const { id_alumno, fecha_inicio, fecha_fin, motivo } = req.body || {};
        if (!id_alumno || !fecha_inicio || !fecha_fin || !motivo)
            return res.status(400).json({ error: 'Faltan parámetros.' });
        const { error } = await supabase.from('justificantes_medicos').insert({
            id_alumno: parseInt(id_alumno), fecha_inicio, fecha_fin,
            motivo, activo: true, registrado_por: usuario.nombre
        });
        if (error) return res.status(400).json({ error: error.message });
        return res.json({ exito: true });
    }
    if (req.method === 'DELETE') {
        if (!ROLES_MEDICO.includes(usuario.rol))
            return res.status(403).json({ error: 'Sin permiso.' });
        const { error } = await supabase.from('justificantes_medicos')
            .update({ activo: false }).eq('id', parseInt(id));
        if (error) return res.status(400).json({ error: error.message });
        return res.json({ exito: true });
    }
    return res.status(405).json({ error: 'Método no permitido' });
}
