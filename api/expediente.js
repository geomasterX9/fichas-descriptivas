const { supabase, requireAuth, setSecurityHeaders, sanitize, getCicloActivo, setCicloActivo, invalidarTokens } = require('./_lib');

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'GET, POST, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuario = await requireAuth(req, res, 'expediente');
    if (!usuario) return;

    const tipo  = req.query.tipo;
    const id    = req.query.id;
    // Permite consultar ciclo histórico: ?ciclo=2024-2025 (opcional)
    const cicloQuery = req.query.ciclo || null;

    if (id && isNaN(parseInt(id))) return res.status(400).json({ error: 'ID inválido' });

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
        const { id_alumno, trimestre, motivos_reprobacion, materia } = req.body || {};
        if (!id_alumno || !trimestre) return res.status(400).json({ error: 'Faltan parámetros.' });
        if (typeof motivos_reprobacion !== 'string' || motivos_reprobacion.length > 1000)
            return res.status(400).json({ error: 'El texto no puede exceder 1000 caracteres.' });

        // Obtener nombre del docente
        const { data: usuarioDB } = await supabase
            .from('usuarios').select('nombre_completo').eq('id_usuario', usuario.id).single();
        const nombreDocente = usuarioDB?.nombre_completo || '—';

        // Leer motivos actuales
        const { data: calActual } = await supabase
            .from('calificaciones')
            .select('motivos_reprobacion')
            .eq('id_alumno', parseInt(id_alumno))
            .eq('trimestre', parseInt(trimestre))
            .single();

        let motivosArr = [];
        if (calActual?.motivos_reprobacion && Array.isArray(calActual.motivos_reprobacion)) {
            motivosArr = calActual.motivos_reprobacion;
        }

        // Reemplazar o agregar la entrada de este docente
        const idx = motivosArr.findIndex(m => m.id_usuario === usuario.id && m.materia === materia);
        const nuevaEntrada = {
            id_usuario: usuario.id,
            nombre: nombreDocente,
            materia: materia || '',
            texto: motivos_reprobacion.trim()
        };

        if (idx >= 0) {
            motivosArr[idx] = nuevaEntrada;
        } else {
            motivosArr.push(nuevaEntrada);
        }

        // Limpiar entradas vacías
        motivosArr = motivosArr.filter(m => m.texto && m.texto.trim() !== '');

        const { error } = await supabase.from('calificaciones')
            .update({ motivos_reprobacion: motivosArr.length > 0 ? motivosArr : null })
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

    res.status(400).json({ error: 'Parámetros inválidos' });
};
