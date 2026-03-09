const supabase = require('./_supabase');
const { requireAuth } = require('./_auth');
const { setSecurityHeaders } = require('./_security');

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'GET, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuario = requireAuth(req, res, 'dashboard');
    if (!usuario) return;

    const tipo = req.query.tipo || 'kpis';

    try {
        if (tipo === 'kpis') {
            const { count: totalAlumnos } = await supabase.from('alumnos').select('*', { count: 'exact', head: true });
            const { count: totalReportes } = await supabase.from('reportes_disciplinarios').select('*', { count: 'exact', head: true });
            const { data: califRiesgo } = await supabase.from('calificaciones').select('id_alumno, promedio_trimestral, materias');
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
            const { data: calif } = await supabase.from('calificaciones').select('*');
            const { data: alum } = await supabase.from('alumnos').select('id_alumno, grado');
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
            const { data: calif } = await supabase.from('calificaciones').select('*');
            if (!calif || calif.length === 0) return res.json([]);
            const califEnRiesgo = calif.filter(c =>
                parseFloat(c.promedio_trimestral) <= 6.5 ||
                (c.materias && c.materias.some(m => parseFloat(m.calif) <= 5))
            );
            if (califEnRiesgo.length === 0) return res.json([]);
            const ids = [...new Set(califEnRiesgo.map(c => c.id_alumno))];
            const { data: alumnos } = await supabase.from('alumnos').select('*').in('id_alumno', ids);
            const lista = alumnos.map(alu => {
                const c = califEnRiesgo.find(x => x.id_alumno === alu.id_alumno);
                const reprobadas = c.materias ? c.materias.filter(m => parseFloat(m.calif) <= 6).map(m => `${m.sigla}: ${m.calif}`).join(', ') : '';
                return { ...alu, promedio: c.promedio_trimestral, materiasRiesgo: reprobadas || 'Promedio Bajo General' };
            });
            lista.sort((a, b) => { if (a.grado !== b.grado) return a.grado - b.grado; if (a.grupo !== b.grupo) return a.grupo.localeCompare(b.grupo); return a.apellidos.localeCompare(b.apellidos); });
            return res.json(lista);
        }

        if (tipo === 'reportes') {
            const { data: reportes } = await supabase.from('reportes_disciplinarios').select('*').order('fecha', { ascending: false });
            const { data: alumnos } = await supabase.from('alumnos').select('id_alumno, nombre, apellidos, grado, grupo');
            const identificados = (reportes || []).map(rep => {
                const alu = (alumnos || []).find(a => a.id_alumno == rep.id_alumno);
                return { ...rep, nombre_alumno: alu ? `${alu.apellidos} ${alu.nombre}` : 'Desconocido', grado_grupo: alu ? `${alu.grado}°"${alu.grupo}"` : '--' };
            });
            return res.json(identificados);
        }

        res.status(400).json({ error: 'Tipo no válido' });
    } catch (e) { res.status(500).json({ error: 'Error en dashboard' }); }
};
