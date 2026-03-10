const supabase = require('../lib/_supabase');
const { requireAuth } = require('../lib/_auth');
const { setSecurityHeaders } = require('../lib/_security');
const { getCicloActivo } = require('../lib/_ciclo');

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'GET, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuario = await requireAuth(req, res, 'dashboard');
    if (!usuario) return;

    const tipo = req.query.tipo || 'kpis';

    try {
        if (tipo === 'kpis') {
            const ciclo = await getCicloActivo();
            const { count: totalAlumnos } = await supabase.from('alumnos').select('*', { count: 'exact', head: true }).eq('ciclo_escolar', ciclo);
            const { count: totalReportes } = await supabase.from('reportes_disciplinarios').select('*', { count: 'exact', head: true }).eq('ciclo_escolar', ciclo);
            const { data: califRiesgo } = await supabase.from('calificaciones').select('id_alumno, promedio_trimestral, materias').eq('ciclo_escolar', ciclo);
            const idsEnRiesgo = new Set();
            if (califRiesgo) {
                califRiesgo.forEach(c => {
                    if (parseFloat(c.promedio_trimestral) <= 6.5) idsEnRiesgo.add(c.id_alumno);
                    else if (c.materias && c.materias.some(m => parseFloat(m.calif) <= 5)) idsEnRiesgo.add(c.id_alumno);
                });
            }
            return res.json({ totalAlumnos: totalAlumnos || 0, totalReportes: totalReportes || 0, alumnosEnRiesgo: idsEnRiesgo.size });
        }

        if (tipo === 'estadisticas') {
            const ciclo = await getCicloActivo();
            const { data: calif } = await supabase.from('calificaciones').select('*').eq('ciclo_escolar', ciclo);
            const { data: alum } = await supabase.from('alumnos').select('id_alumno, grado').eq('ciclo_escolar', ciclo);
            if (!calif || !alum) return res.json({});
            const aluGrado = {};
            alum.forEach(a => aluGrado[a.id_alumno] = a.grado);
            const SIGLAS = ['ESP','MAT','SLI','CIE','HIS','GMM','FCE','ETE','EFI','ART','ESO'];
            let mats = {}; SIGLAS.forEach(s => mats[s] = []);
            let trimes = { 1: [], 2: [], 3: [] }, grads = { 1: [], 2: [], 3: [] };
            // porGradoMateria: { 1: { ESP: [], MAT: [], ... }, 2: {...}, 3: {...} }
            const pgm = { 1: {}, 2: {}, 3: {} };
            SIGLAS.forEach(s => { pgm[1][s] = []; pgm[2][s] = []; pgm[3][s] = []; });
            calif.forEach(c => {
                const v = parseFloat(c.promedio_trimestral);
                const g = aluGrado[c.id_alumno];
                if (v >= 5 && v <= 10) {
                    if (trimes[c.trimestre]) trimes[c.trimestre].push(v);
                    if (g) grads[g].push(v);
                    if (c.materias) c.materias.forEach(m => {
                        const cal = parseFloat(m.calif);
                        if (mats[m.sigla] && cal >= 5) mats[m.sigla].push(cal);
                        if (g && pgm[g][m.sigla] && cal >= 5) pgm[g][m.sigla].push(cal);
                    });
                }
            });
            const prom = arr => arr.length ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : 0;

            // Comparativo por materia desglosado por trimestre (para gráfica de líneas)
            const matSiglas = Object.keys(mats);
            const matsPorTrim = { 1: {}, 2: {}, 3: {} };
            matSiglas.forEach(s => { matsPorTrim[1][s] = []; matsPorTrim[2][s] = []; matsPorTrim[3][s] = []; });
            calif.forEach(c => {
                const t = c.trimestre;
                if ([1,2,3].includes(t) && c.materias) {
                    c.materias.forEach(m => {
                        const cal = parseFloat(m.calif);
                        if (matsPorTrim[t][m.sigla] && cal >= 5) matsPorTrim[t][m.sigla].push(cal);
                    });
                }
            });
            // Para cada materia, array de promedios [T1, T2, T3] — solo trimestres con datos
            const comparativoPorTrimestre = {};
            matSiglas.forEach(s => {
                comparativoPorTrimestre[s] = [1,2,3]
                    .filter(t => trimes[t].length > 0)
                    .map(t => prom(matsPorTrim[t][s]));
            });

            return res.json({
                porTrimestre: { labels: ['T1', 'T2', 'T3'], valores: [prom(trimes[1]), prom(trimes[2]), prom(trimes[3])] },
                porGrado: { labels: ['1°', '2°', '3°'], valores: [prom(grads[1]), prom(grads[2]), prom(grads[3])] },
                porMateria: { labels: matSiglas, valores: matSiglas.map(s => prom(mats[s])) },
                comparativoPorTrimestre,
                porGradoMateria: {
                    labels: SIGLAS,
                    grado1: SIGLAS.map(s => prom(pgm[1][s])),
                    grado2: SIGLAS.map(s => prom(pgm[2][s])),
                    grado3: SIGLAS.map(s => prom(pgm[3][s]))
                }
            });
        }

        if (tipo === 'riesgo') {
            const ciclo = await getCicloActivo();
            const { data: calif } = await supabase.from('calificaciones').select('*').eq('ciclo_escolar', ciclo);
            if (!calif || calif.length === 0) return res.json([]);
            const califEnRiesgo = calif.filter(c =>
                parseFloat(c.promedio_trimestral) <= 6.5 ||
                (c.materias && c.materias.some(m => parseFloat(m.calif) <= 5))
            );
            if (califEnRiesgo.length === 0) return res.json([]);
            const ids = [...new Set(califEnRiesgo.map(c => c.id_alumno))];
            const { data: alumnos } = await supabase.from('alumnos').select('*').in('id_alumno', ids).eq('ciclo_escolar', ciclo);
            const lista = alumnos.map(alu => {
                const c = califEnRiesgo.find(x => x.id_alumno === alu.id_alumno);
                const reprobadas = c.materias ? c.materias.filter(m => parseFloat(m.calif) <= 6).map(m => `${m.sigla}: ${m.calif}`).join(', ') : '';
                return { ...alu, promedio: c.promedio_trimestral, materiasRiesgo: reprobadas || 'Promedio Bajo General' };
            });
            lista.sort((a, b) => { if (a.grado !== b.grado) return a.grado - b.grado; if (a.grupo !== b.grupo) return a.grupo.localeCompare(b.grupo); return a.apellidos.localeCompare(b.apellidos); });
            return res.json(lista);
        }

        if (tipo === 'reportes') {
            const ciclo = await getCicloActivo();
            const { data: reportes } = await supabase.from('reportes_disciplinarios').select('*')
                .eq('ciclo_escolar', ciclo).order('fecha', { ascending: false });
            const { data: alumnos } = await supabase.from('alumnos').select('id_alumno, nombre, apellidos, grado, grupo').eq('ciclo_escolar', ciclo);
            const identificados = (reportes || []).map(rep => {
                const alu = (alumnos || []).find(a => a.id_alumno == rep.id_alumno);
                return { ...rep, nombre_alumno: alu ? `${alu.apellidos} ${alu.nombre}` : 'Desconocido', grado_grupo: alu ? `${alu.grado}°"${alu.grupo}"` : '--' };
            });
            return res.json(identificados);
        }

        // Operaciones de cierre de ciclo
        if (tipo === 'ciclo_config' || tipo === 'ciclo_op') {
            return await handleCiclo(req, res, usuario, tipo);
        }

        res.status(400).json({ error: 'Tipo no válido' });
    } catch (e) { res.status(500).json({ error: 'Error en dashboard' }); }
};


// ── OPERACIONES DE CIERRE DE CICLO ──────────────────────────
async function handleCiclo(req, res, usuario, operacion) {
    if (usuario.rol !== 'ADMINISTRADOR') {
        return res.status(403).json({ error: 'Solo el administrador puede ejecutar el cierre de ciclo.' });
    }

    // GET: leer configuración (ej. ?tipo=ciclo_config&clave=ciclo_activo)
    if (req.method === 'GET' && operacion === 'ciclo_config') {
        const clave = req.query.clave;
        if (!clave) return res.status(400).json({ error: 'Falta parámetro clave' });
        const { data, error } = await supabase.from('configuracion').select('valor').eq('clave', clave).single();
        if (error || !data) return res.status(404).json({ error: 'Clave no encontrada' });
        return res.json({ clave, valor: data.valor });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    const { suboperacion } = req.body || {};

    if (suboperacion === 'eliminar_egresados') {
        const { ciclo } = req.body;
        if (!ciclo) return res.status(400).json({ error: 'Falta ciclo' });
        const { data: egresados, error: errE } = await supabase
            .from('alumnos').select('id_alumno').eq('grado', 3).eq('ciclo_escolar', ciclo);
        if (errE) return res.status(500).json({ error: errE.message });
        if (!egresados || egresados.length === 0) return res.json({ eliminados: 0 });
        const ids = egresados.map(a => a.id_alumno);
        await supabase.from('calificaciones').delete().in('id_alumno', ids);
        await supabase.from('reportes_disciplinarios').delete().in('id_alumno', ids);
        await supabase.from('datos_socioeconomicos').delete().in('id_alumno', ids);
        const { error: errDel } = await supabase.from('alumnos').delete().in('id_alumno', ids);
        if (errDel) return res.status(500).json({ error: errDel.message });
        await supabase.from('logs_actividad').insert([{
            id_usuario: usuario.id_usuario, nombre_usuario: usuario.nombre_completo, rol: usuario.rol,
            accion: 'CIERRE_CICLO_EGRESADOS', detalle: `Eliminados ${ids.length} egresados del ciclo ${ciclo}`,
            ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown', fecha: new Date().toISOString()
        }]);
        return res.json({ eliminados: ids.length });
    }

    if (suboperacion === 'promover') {
        const { de, a, ciclo } = req.body;
        if (!de || !a || !ciclo) return res.status(400).json({ error: 'Faltan parámetros' });
        if (![1, 2].includes(Number(de)) || ![2, 3].includes(Number(a)))
            return res.status(400).json({ error: 'Grados inválidos' });
        const { data: actualizados, error: errP } = await supabase
            .from('alumnos').update({ grado: Number(a) })
            .eq('grado', Number(de)).eq('ciclo_escolar', ciclo).eq('status', 'ACTIVO').select('id_alumno');
        if (errP) return res.status(500).json({ error: errP.message });
        return res.json({ promovidos: actualizados?.length || 0 });
    }

    if (suboperacion === 'resetear_fichas') {
        const { ciclo } = req.body;
        if (!ciclo) return res.status(400).json({ error: 'Falta ciclo' });
        const { data: actualizados, error: errR } = await supabase
            .from('alumnos').update({ ficha_completada: false })
            .eq('ciclo_escolar', ciclo).eq('status', 'ACTIVO').select('id_alumno');
        if (errR) return res.status(500).json({ error: errR.message });
        return res.json({ reseteadas: actualizados?.length || 0 });
    }

    if (suboperacion === 'activar_ciclo') {
        const { nuevoCiclo } = req.body;
        if (!nuevoCiclo || !/^\d{4}-\d{4}$/.test(nuevoCiclo))
            return res.status(400).json({ error: 'Formato de ciclo inválido' });
        const { setCicloActivo } = require('../lib/_ciclo');
        try { await setCicloActivo(nuevoCiclo); } catch(e) { return res.status(500).json({ error: e.message }); }
        await supabase.from('logs_actividad').insert([{
            id_usuario: usuario.id_usuario, nombre_usuario: usuario.nombre_completo, rol: usuario.rol,
            accion: 'CIERRE_CICLO_ACTIVAR', detalle: `Ciclo activado: ${nuevoCiclo}`,
            ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown', fecha: new Date().toISOString()
        }]);
        return res.json({ exito: true, cicloActivo: nuevoCiclo });
    }

    return res.status(400).json({ error: `Suboperacion desconocida: ${suboperacion}` });
}
