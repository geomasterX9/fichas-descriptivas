const { supabase, getSupabase, requireAuth, setSecurityHeaders, sanitize, getCicloActivo, setCicloActivo, invalidarTokens } = require('./_lib');

// Tipos accesibles para todos los roles autenticados
const TIPOS_TODOS_ROLES = ['riesgo_disciplinario', 'riesgo_academico_parcial', 'recuperacion', 'config_institucional', 'emergencia', 'asistencia', 'asistencia_fecha', 'faltas_alumno'];

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'GET, POST, DELETE, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const tipo = req.query.tipo || 'kpis';

    // Para tipos de alerta: cualquier rol autenticado puede acceder
    const recurso = TIPOS_TODOS_ROLES.includes(tipo) ? null : 'dashboard';
    const usuario = await requireAuth(req, res, recurso);
    if (!usuario) return;
    const db = usuario._db || supabase;

    try {
        if (tipo === 'kpis') {
            const ciclo = await getCicloActivo(db);
            const { count: totalAlumnos } = await db.from('alumnos').select('*', { count: 'exact', head: true }).eq('ciclo_escolar', ciclo);
            const { count: totalReportes } = await db.from('reportes_disciplinarios').select('*', { count: 'exact', head: true }).eq('ciclo_escolar', ciclo);
            const { data: califRiesgo } = await db.from('calificaciones').select('id_alumno, promedio_trimestral, materias').eq('ciclo_escolar', ciclo);
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
            const ciclo = await getCicloActivo(db);
            const { data: calif } = await db.from('calificaciones').select('*').eq('ciclo_escolar', ciclo);
            const { data: alum } = await db.from('alumnos').select('id_alumno, grado').eq('ciclo_escolar', ciclo);
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
            const ciclo = await getCicloActivo(db);
            const { data: calif } = await db.from('calificaciones').select('*').eq('ciclo_escolar', ciclo);
            if (!calif || calif.length === 0) return res.json([]);
            const califEnRiesgo = calif.filter(c =>
                parseFloat(c.promedio_trimestral) <= 6.5 ||
                (c.materias && c.materias.some(m => parseFloat(m.calif) <= 5))
            );
            if (califEnRiesgo.length === 0) return res.json([]);
            const ids = [...new Set(califEnRiesgo.map(c => c.id_alumno))];
            const { data: alumnos } = await db.from('alumnos').select('*').in('id_alumno', ids).eq('ciclo_escolar', ciclo);
            const lista = alumnos.map(alu => {
                const c = califEnRiesgo.find(x => x.id_alumno === alu.id_alumno);
                const reprobadas = c.materias ? c.materias.filter(m => parseFloat(m.calif) <= 6).map(m => `${m.sigla}: ${m.calif}`).join(', ') : '';
                return { ...alu, promedio: c.promedio_trimestral, materiasRiesgo: reprobadas || 'Promedio Bajo General' };
            });
            lista.sort((a, b) => { if (a.grado !== b.grado) return a.grado - b.grado; if (a.grupo !== b.grupo) return a.grupo.localeCompare(b.grupo); return a.apellidos.localeCompare(b.apellidos); });
            return res.json(lista);
        }

        if (tipo === 'reportes') {
            const ciclo = await getCicloActivo(db);
            const { data: reportes } = await db.from('reportes_disciplinarios').select('*')
                .eq('ciclo_escolar', ciclo).order('fecha', { ascending: false });
            const { data: alumnos } = await db.from('alumnos').select('id_alumno, nombre, apellidos, grado, grupo').eq('ciclo_escolar', ciclo);
            const identificados = (reportes || []).map(rep => {
                const alu = (alumnos || []).find(a => a.id_alumno == rep.id_alumno);
                return { ...rep, nombre_alumno: alu ? `${alu.apellidos} ${alu.nombre}` : 'Desconocido', grado_grupo: alu ? `${alu.grado}°"${alu.grupo}"` : '--' };
            });
            return res.json(identificados);
        }

        // Alumnos en riesgo académico por evaluaciones parciales
        if (tipo === 'riesgo_academico_parcial') {
            const ciclo = await getCicloActivo(db);
            const { data: evaluaciones } = await db
                .from('evaluaciones_parciales')
                .select('*')
                .eq('ciclo_escolar', ciclo);
            if (!evaluaciones || evaluaciones.length === 0) return res.json([]);

            const enRiesgo = evaluaciones.filter(e =>
                e.materias && Array.isArray(e.materias) && e.materias.length > 0 &&
                e.materias.some(m => parseFloat(m.calif) <= 6)
            );
            if (enRiesgo.length === 0) return res.json([]);

            const ids = [...new Set(enRiesgo.map(e => e.id_alumno))];
            const { data: alumnos } = await db
                .from('alumnos')
                .select('id_alumno, nombre, apellidos, grado, grupo')
                .in('id_alumno', ids)
                .eq('ciclo_escolar', ciclo)
                .order('apellidos', { ascending: true });

            const lista = (alumnos || []).map(a => {
                const evals = enRiesgo.filter(e => e.id_alumno === a.id_alumno);
                const materiasRiesgo = [];
                evals.forEach(e => {
                    (e.materias || []).forEach(m => {
                        if (parseFloat(m.calif) <= 6)
                            materiasRiesgo.push(`T${e.trimestre} ${m.sigla}:${m.calif}`);
                    });
                });
                return { ...a, materias_riesgo: materiasRiesgo, total_riesgo: materiasRiesgo.length };
            });
            lista.sort((a, b) => b.total_riesgo - a.total_riesgo);
            return res.json(lista);
        }

        // Alumnos a recuperación (materias con calif 5 en calificaciones finales)
        if (tipo === 'recuperacion') {
            const ciclo = await getCicloActivo(db);
            const rolParam = req.query.rol || null;
            const materiasParam = req.query.materias ? req.query.materias.split(',') : null;

            const { data: cals } = await db
                .from('calificaciones')
                .select('id_alumno, trimestre, materias, recuperacion, ciclo_escolar')
                .eq('ciclo_escolar', ciclo);
            if (!cals || cals.length === 0) return res.json([]);

            // Filtrar trimestres con materias en 5
            const enRecuperacion = [];
            cals.forEach(c => {
                const materiasEn5 = (c.materias || []).filter(m => parseFloat(m.calif) === 5);
                if (materiasEn5.length === 0) return;
                // Filtrar por materia si aplica (docente)
                const materiasFiltradas = materiasParam
                    ? materiasEn5.filter(m => materiasParam.includes(m.sigla))
                    : materiasEn5;
                if (materiasFiltradas.length === 0) return;
                enRecuperacion.push({
                    id_alumno: c.id_alumno,
                    trimestre: c.trimestre,
                    materias_recuperacion: materiasFiltradas,
                    recuperacion: c.recuperacion || []
                });
            });
            if (enRecuperacion.length === 0) return res.json([]);

            const ids = [...new Set(enRecuperacion.map(e => e.id_alumno))];
            const { data: alumnos } = await db
                .from('alumnos')
                .select('id_alumno, nombre, apellidos, grado, grupo')
                .in('id_alumno', ids)
                .eq('ciclo_escolar', ciclo)
                .eq('status', 'ACTIVO')
                .order('apellidos', { ascending: true });

            const lista = [];
            (alumnos || []).forEach(a => {
                const regs = enRecuperacion.filter(e => e.id_alumno === a.id_alumno);
                regs.forEach(r => {
                    lista.push({ ...a, trimestre: r.trimestre,
                        materias_recuperacion: r.materias_recuperacion,
                        recuperacion: r.recuperacion });
                });
            });
            return res.json(lista);
        }

        // Alumnos con motivos de reprobación registrados
        if (tipo === 'motivos_reprobacion') {
            const ciclo = await getCicloActivo(db);
            const { data: cals } = await db
                .from('calificaciones')
                .select('id_alumno, trimestre, materias, motivos_reprobacion')
                .eq('ciclo_escolar', ciclo)
                .not('motivos_reprobacion', 'is', null);
            // Filtrar los que tienen al menos un motivo en el array jsonb
            const calsConMotivos = (cals || []).filter(c =>
                Array.isArray(c.motivos_reprobacion) && c.motivos_reprobacion.length > 0
            );
            if (calsConMotivos.length === 0) return res.json([]);

            const ids = [...new Set(calsConMotivos.map(c => c.id_alumno))];
            const { data: alumnos } = await db
                .from('alumnos')
                .select('id_alumno, nombre, apellidos, grado, grupo')
                .in('id_alumno', ids)
                .eq('ciclo_escolar', ciclo)
                .order('apellidos', { ascending: true });

            const lista = [];
            (alumnos || []).forEach(a => {
                const regsCal = calsConMotivos.filter(c => c.id_alumno === a.id_alumno);
                regsCal.forEach(c => {
                    const reprobadas = (c.materias || [])
                        .filter(m => parseFloat(m.calif) < 6)
                        .map(m => `${m.sigla}: ${m.calif}`).join(', ');
                    // motivos_reprobacion es ahora un array jsonb
                    const motivosArr = Array.isArray(c.motivos_reprobacion) ? c.motivos_reprobacion : [];
                    // Crear una fila por cada motivo registrado
                    if (motivosArr.length > 0) {
                        motivosArr.forEach(mv => {
                            lista.push({
                                ...a,
                                trimestre: c.trimestre,
                                materias_reprobadas: reprobadas,
                                motivos_reprobacion: mv.texto || '—',
                                nombre_docente: mv.nombre || '—',
                                materia_docente: mv.materia || '—'
                            });
                        });
                    }
                });
            });
            return res.json(lista);
        }

        // ── Configuración institucional ──────────────────────────────
        if (tipo === 'config_institucional') {
            if (req.method === 'GET') {
                const { data } = await db
                    .from('configuracion')
                    .select('clave, valor')
                    .in('clave', ['nombre_escuela','clave_escuela','direccion_escuela','logo_izquierdo','logo_derecho','ciclo_activo']);
                const cfg = {};
                (data || []).forEach(r => { cfg[r.clave] = r.valor; });
                return res.json(cfg);
            }
            if (req.method === 'POST') {
                if (usuario.rol !== 'ADMINISTRADOR')
                    return res.status(403).json({ error: 'Solo el administrador puede modificar la configuración institucional.' });
                const body = req.body || {};
                const claves = ['nombre_escuela','clave_escuela','direccion_escuela','logo_izquierdo','logo_derecho','ciclo_activo'];
                await Promise.all(
                    claves.filter(c => body[c] !== undefined).map(clave =>
                        db.from('configuracion')
                            .upsert({ clave, valor: body[clave], updated_at: new Date().toISOString() })
                    )
                );
                return res.json({ exito: true });
            }
        }

        // Alumnos en riesgo disciplinario (falta grave o 3+ reportes)
        if (tipo === 'riesgo_disciplinario') {
            const ciclo = await getCicloActivo(db);
            const { data: reportes } = await db
                .from('reportes_disciplinarios')
                .select('id_alumno, gravedad')
                .eq('ciclo_escolar', ciclo)
                .neq('gravedad', 'Positiva');
            if (!reportes || reportes.length === 0) return res.json([]);

            // Agrupar por alumno
            const mapaAlumno = {};
            reportes.forEach(r => {
                if (!mapaAlumno[r.id_alumno]) mapaAlumno[r.id_alumno] = { total: 0, graves: 0 };
                mapaAlumno[r.id_alumno].total++;
                if (r.gravedad === 'Grave') mapaAlumno[r.id_alumno].graves++;
            });

            // Filtrar: falta grave O 3+ reportes
            const idsEnRiesgo = Object.keys(mapaAlumno).filter(id =>
                mapaAlumno[id].graves >= 1 || mapaAlumno[id].total >= 3
            ).map(Number);

            if (idsEnRiesgo.length === 0) return res.json([]);

            const { data: alumnos } = await db
                .from('alumnos')
                .select('id_alumno, nombre, apellidos, grado, grupo')
                .in('id_alumno', idsEnRiesgo)
                .eq('ciclo_escolar', ciclo)
                .eq('status', 'ACTIVO')
                .order('apellidos', { ascending: true });

            const lista = (alumnos || []).map(a => ({
                ...a,
                total_reportes: mapaAlumno[a.id_alumno]?.total || 0,
                reportes_graves: mapaAlumno[a.id_alumno]?.graves || 0,
            }));
            return res.json(lista);
        }

        // ── EMERGENCIA ──────────────────────────────────────────
        if (tipo === 'emergencia') {
            // GET — consultar si hay emergencia activa
            if (req.method === 'GET') {
                const { data } = await db
                    .from('emergencias')
                    .select('*')
                    .eq('activa', true)
                    .order('fecha', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                return res.json({ activa: !!data, emergencia: data || null });
            }
            // POST — activar emergencia (cualquier usuario autenticado)
            if (req.method === 'POST') {
                await db.from('emergencias').update({ activa: false }).eq('activa', true);
                const { error } = await db.from('emergencias').insert({
                    id_usuario:     usuario.id,
                    nombre_usuario: usuario.nombre,
                    rol:            usuario.rol,
                    activa:         true
                });
                if (error) return res.status(500).json({ error: error.message });
                return res.json({ exito: true });
            }
            // DELETE — desactivar (solo ADMINISTRADOR o DIRECTIVO)
            if (req.method === 'DELETE') {
                if (!['ADMINISTRADOR', 'DIRECTIVO'].includes(usuario.rol))
                    return res.status(403).json({ error: 'Sin permiso para desactivar emergencia' });
                await db.from('emergencias').update({ activa: false }).eq('activa', true);
                return res.json({ exito: true });
            }
        }

        // Operaciones de cierre de ciclo
        if (tipo === 'ciclo_config' || tipo === 'ciclo_op' ||
            tipo === 'ciclo_fichas' || tipo === 'ciclo_reportes_count' ||
            tipo === 'ciclo_reportes_todos' || tipo === 'ciclo_calificaciones') {
            return await handleCiclo(req, res, usuario, tipo);
        }


        // ── ASISTENCIA ───────────────────────────────────────────
        if (tipo === 'asistencia') {
            const hoy = new Date().toISOString().split('T')[0];

            if (req.method === 'GET') {
                const grado = req.query.grado;
                const grupo = req.query.grupo;

                if (grado && grupo) {
                    // Lista de alumnos del grupo con su estado de asistencia hoy
                    const { data: alumnos } = await db
                        .from('alumnos')
                        .select('id_alumno, apellidos, nombre')
                        .eq('grado', parseInt(grado))
                        .eq('grupo', grupo.toUpperCase())
                        .order('apellidos', { ascending: true });

                    const { data: asistencia } = await db
                        .from('asistencia')
                        .select('id_alumno, presente')
                        .eq('fecha', hoy)
                        .eq('grado', parseInt(grado))
                        .eq('grupo', grupo.toUpperCase());

                    const mapaAsist = {};
                    (asistencia || []).forEach(a => { mapaAsist[a.id_alumno] = a.presente; });

                    return res.json((alumnos || []).map(a => ({
                        ...a,
                        presente: mapaAsist[a.id_alumno] !== undefined ? mapaAsist[a.id_alumno] : null
                    })));
                } else {
                    // Ausentes de hoy para badge de docentes
                    const { data } = await db
                        .from('asistencia')
                        .select('id_alumno, grado, grupo, alumnos(apellidos, nombre, grado, grupo)')
                        .eq('fecha', hoy)
                        .eq('presente', false)
                        .order('grado', { ascending: true });
                    return res.json(data || []);
                }
            }

            if (req.method === 'POST') {
                if (!['TRABAJO SOCIAL', 'ADMINISTRADOR'].includes(usuario.rol))
                    return res.status(403).json({ error: 'Sin permiso para registrar asistencia.' });

                const { grado, grupo, alumnos: listaAlumnos, finalizado } = req.body || {};

                // Llamada de finalizado sin alumnos — solo marcar como notificado
                if (finalizado && (!listaAlumnos || listaAlumnos.length === 0)) {
                    return res.json({ exito: true });
                }

                if (!grado || !grupo || !Array.isArray(listaAlumnos) || listaAlumnos.length === 0)
                    return res.status(400).json({ error: 'Faltan parámetros.' });

                const registros = listaAlumnos.map(a => ({
                    fecha:          hoy,
                    grado:          parseInt(grado),
                    grupo:          grupo.toUpperCase(),
                    id_alumno:      a.id_alumno,
                    presente:       a.presente !== false,
                    registrado_por: usuario.nombre,
                    finalizado:     !!finalizado
                }));

                const { error } = await db
                    .from('asistencia')
                    .upsert(registros, { onConflict: 'fecha,id_alumno' });

                if (error) return res.status(400).json({ error: error.message });
                return res.json({ exito: true });
            }
        }

        // ── FALTAS ACUMULADAS POR ALUMNO ────────────────────────
        if (tipo === 'faltas_alumno') {
            const id = parseInt(req.query.id);
            if (!id || isNaN(id)) return res.status(400).json({ error: 'Falta id de alumno.' });

            // Trimestres escolares — ajustar si cambia el calendario
            const TRIMESTRES = [
                { num: 1, inicio: '-09-01', fin: '-11-30' },
                { num: 2, inicio: '-12-01', fin: '-02-28' },
                { num: 3, inicio: '-03-01', fin: '-06-30' },
            ];

            const { data: faltas } = await db
                .from('asistencia')
                .select('fecha')
                .eq('id_alumno', id)
                .eq('presente', false)
                .order('fecha', { ascending: true });

            if (!faltas || faltas.length === 0)
                return res.json({ total: 0, porSemana: [], porMes: [], porTrimestre: [] });

            const hoy = new Date();
            const anioActual = hoy.getFullYear();

            // ── Por semana (últimas 8 semanas) ──
            const semanas = {};
            faltas.forEach(f => {
                const d = new Date(f.fecha + 'T12:00:00');
                // Lunes de esa semana
                const dia = d.getDay();
                const lunes = new Date(d);
                lunes.setDate(d.getDate() - (dia === 0 ? 6 : dia - 1));
                const key = lunes.toISOString().split('T')[0];
                semanas[key] = (semanas[key] || 0) + 1;
            });
            // Últimas 8 semanas
            const porSemana = Object.entries(semanas)
                .sort((a, b) => a[0].localeCompare(b[0]))
                .slice(-8)
                .map(([fecha, faltas]) => {
                    const d = new Date(fecha + 'T12:00:00');
                    const label = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
                    return { semana: label, faltas };
                });

            // ── Por mes ──
            const meses = {};
            const NOMBRES_MES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
            faltas.forEach(f => {
                const d = new Date(f.fecha + 'T12:00:00');
                const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
                meses[key] = (meses[key] || 0) + 1;
            });
            const porMes = Object.entries(meses)
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([key, faltas]) => {
                    const [anio, mes] = key.split('-');
                    return { mes: `${NOMBRES_MES[parseInt(mes)-1]} ${anio}`, faltas };
                });

            // ── Por trimestre ──
            const conteoTrim = { 1: 0, 2: 0, 3: 0 };
            faltas.forEach(f => {
                const d = new Date(f.fecha + 'T12:00:00');
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                const mmdd = `-${mm}-${dd}`;
                // T2 cruza año: dic del año anterior + ene-feb del siguiente
                const anio = d.getFullYear();
                for (const t of TRIMESTRES) {
                    if (t.num === 2) {
                        if (mmdd >= '-12-01' || mmdd <= '-02-28') { conteoTrim[2]++; break; }
                    } else {
                        if (mmdd >= t.inicio && mmdd <= t.fin) { conteoTrim[t.num]++; break; }
                    }
                }
            });
            const porTrimestre = [1,2,3].map(n => ({ trimestre: `T${n}`, faltas: conteoTrim[n] }));

            return res.json({
                total: faltas.length,
                porSemana,
                porMes,
                porTrimestre
            });
        }

        // ── ASISTENCIA POR FECHA (para reporte) ─────────────────
        if (tipo === 'asistencia_fecha') {
            const fecha = req.query.fecha;
            if (!fecha) return res.status(400).json({ error: 'Falta parámetro fecha.' });
            const { data } = await db
                .from('asistencia')
                .select('*, alumnos(apellidos, nombre, grado, grupo)')
                .eq('fecha', fecha)
                .order('grado', { ascending: true });
            return res.json(data || []);
        }

        // ── RESET DE DATOS ───────────────────────────────────────
        if (tipo === 'reset') {
            if (req.method !== 'POST')
                return res.status(405).json({ error: 'Método no permitido.' });
            if (usuario.rol !== 'ADMINISTRADOR')
                return res.status(403).json({ error: 'Solo el administrador puede ejecutar un reset.' });

            const { tablas, confirmacion } = req.body || {};
            if (confirmacion !== 'CONFIRMAR')
                return res.status(400).json({ error: 'Confirmación inválida.' });
            if (!Array.isArray(tablas) || tablas.length === 0)
                return res.status(400).json({ error: 'Selecciona al menos una tabla.' });

            const TABLAS_PERMITIDAS = [
                'reportes_disciplinarios', 'evaluaciones_parciales', 'expedientes_medicos',
                'visitas_enfermeria', 'justificantes_medicos', 'asistencia',
                'logs_actividad', 'calificaciones', 'datos_socioeconomicos', 'emergencias'
            ];

            const tablasInvalidas = tablas.filter(t => !TABLAS_PERMITIDAS.includes(t));
            if (tablasInvalidas.length > 0)
                return res.status(400).json({ error: `Tablas no permitidas: ${tablasInvalidas.join(', ')}` });

            const errores  = [];
            const exitosas = [];

            for (const tabla of tablas) {
                const { error } = await db.rpc('truncate_tabla', { nombre_tabla: tabla });
                if (error) errores.push(`${tabla}: ${error.message}`);
                else exitosas.push(tabla);
            }

            // Registrar en logs (si logs_actividad no fue truncada)
            if (!exitosas.includes('logs_actividad')) {
                await db.from('logs_actividad').insert([{
                    id_usuario:     usuario.id,
                    nombre_usuario: usuario.nombre,
                    rol:            usuario.rol,
                    accion:         'RESET_DATOS',
                    detalle:        `Tablas limpiadas: ${exitosas.join(', ')}`,
                    ip:             req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown',
                    fecha:          new Date().toISOString()
                }]);
            }

            if (errores.length > 0 && exitosas.length === 0)
                return res.status(500).json({ error: errores.join('; ') });
            return res.json({ exito: true, exitosas, errores });
        }

        res.status(400).json({ error: 'Tipo no válido' });
    } catch (e) { res.status(500).json({ error: 'Error en dashboard' }); }
};


// ── OPERACIONES DE CIERRE DE CICLO ──────────────────────────
async function handleCiclo(req, res, usuario, operacion) {
    const db = usuario._db || supabase;
    if (usuario.rol !== 'ADMINISTRADOR') {
        return res.status(403).json({ error: 'Solo el administrador puede ejecutar el cierre de ciclo.' });
    }

    // GET: leer configuración (ej. ?tipo=ciclo_config&clave=ciclo_activo)
    if (req.method === 'GET' && operacion === 'ciclo_config') {
        const clave = req.query.clave;
        if (!clave) return res.status(400).json({ error: 'Falta parámetro clave' });
        const { data, error } = await db.from('configuracion').select('valor').eq('clave', clave).single();
        if (error || !data) return res.status(404).json({ error: 'Clave no encontrada' });
        return res.json({ clave, valor: data.valor });
    }

    // GET: todas las fichas de un ciclo (para respaldo masivo)
    if (req.method === 'GET' && operacion === 'ciclo_fichas') {
        const ciclo = req.query.ciclo;
        if (!ciclo) return res.status(400).json({ error: 'Falta ciclo' });
        const { data: alumnos3 } = await db.from('alumnos')
            .select('id_alumno').eq('grado', 3).eq('ciclo_escolar', ciclo);
        if (!alumnos3 || alumnos3.length === 0) return res.json([]);
        const ids = alumnos3.map(a => a.id_alumno);
        const { data: fichas } = await db.from('datos_socioeconomicos')
            .select('*').in('id_alumno', ids);
        return res.json(fichas || []);
    }

    // GET: conteo de reportes por alumno de un ciclo (para respaldo)
    if (req.method === 'GET' && operacion === 'ciclo_reportes_count') {
        const ciclo = req.query.ciclo;
        if (!ciclo) return res.status(400).json({ error: 'Falta ciclo' });
        const { data: alumnos3 } = await db.from('alumnos')
            .select('id_alumno').eq('grado', 3).eq('ciclo_escolar', ciclo);
        if (!alumnos3 || alumnos3.length === 0) return res.json([]);
        const ids = alumnos3.map(a => a.id_alumno);
        const { data: reportes } = await db.from('reportes_disciplinarios')
            .select('id_alumno').in('id_alumno', ids).eq('ciclo_escolar', ciclo);
        // Agrupar conteo por id_alumno
        const conteo = {};
        (reportes || []).forEach(r => { conteo[r.id_alumno] = (conteo[r.id_alumno] || 0) + 1; });
        return res.json(ids.map(id => ({ id_alumno: id, count: conteo[id] || 0 })));
    }

    // GET: todos los reportes de un ciclo (para backup completo)
    if (req.method === 'GET' && operacion === 'ciclo_reportes_todos') {
        const ciclo = req.query.ciclo;
        if (!ciclo) return res.status(400).json({ error: 'Falta ciclo' });
        const { data: alumnos } = await db.from('alumnos')
            .select('id_alumno, apellidos, nombre').eq('ciclo_escolar', ciclo);
        const ids = (alumnos || []).map(a => a.id_alumno);
        if (ids.length === 0) return res.json([]);
        const mapaAlumnos = {};
        (alumnos || []).forEach(a => { mapaAlumnos[a.id_alumno] = a.apellidos + ' ' + a.nombre; });
        const { data: reportes } = await db.from('reportes_disciplinarios')
            .select('*').in('id_alumno', ids).order('fecha', { ascending: false });
        const { data: usuariosDB } = await db.from('usuarios').select('id_usuario, nombre_completo');
        const { data: personal }   = await db.from('personal').select('id_personal, nombre_completo');
        const mapaU = {}; const mapaP = {};
        (usuariosDB || []).forEach(u => { mapaU[u.id_usuario]  = u.nombre_completo; });
        (personal   || []).forEach(p => { mapaP[p.id_personal] = p.nombre_completo; });
        return res.json((reportes || []).map(r => ({
            ...r,
            nombre_alumno: mapaAlumnos[r.id_alumno] || '',
            nombre_reporta: r.id_usuario ? (mapaU[r.id_usuario] || '') : (mapaP[r.id_personal] || '')
        })));
    }

    // GET: todas las calificaciones de un ciclo (para backup completo)
    if (req.method === 'GET' && operacion === 'ciclo_calificaciones') {
        const ciclo = req.query.ciclo;
        if (!ciclo) return res.status(400).json({ error: 'Falta ciclo' });
        const { data: cals } = await db.from('calificaciones')
            .select('*').eq('ciclo_escolar', ciclo);
        return res.json(cals || []);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    const { suboperacion } = req.body || {};

    if (suboperacion === 'eliminar_egresados') {
        const { ciclo } = req.body;
        if (!ciclo) return res.status(400).json({ error: 'Falta ciclo' });
        const { data: egresados, error: errE } = await db
            .from('alumnos').select('id_alumno').eq('grado', 3).eq('ciclo_escolar', ciclo);
        if (errE) return res.status(500).json({ error: errE.message });
        if (!egresados || egresados.length === 0) return res.json({ eliminados: 0 });
        const ids = egresados.map(a => a.id_alumno);
        await db.from('calificaciones').delete().in('id_alumno', ids);
        await db.from('reportes_disciplinarios').delete().in('id_alumno', ids);
        await db.from('datos_socioeconomicos').delete().in('id_alumno', ids);
        const { error: errDel } = await db.from('alumnos').delete().in('id_alumno', ids);
        if (errDel) return res.status(500).json({ error: errDel.message });
        await db.from('logs_actividad').insert([{
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
        const { data: actualizados, error: errP } = await db
            .from('alumnos').update({ grado: Number(a) })
            .eq('grado', Number(de)).eq('ciclo_escolar', ciclo).eq('status', 'ACTIVO').select('id_alumno');
        if (errP) return res.status(500).json({ error: errP.message });
        return res.json({ promovidos: actualizados?.length || 0 });
    }

    if (suboperacion === 'resetear_fichas') {
        const { ciclo } = req.body;
        if (!ciclo) return res.status(400).json({ error: 'Falta ciclo' });
        const { data: actualizados, error: errR } = await db
            .from('alumnos').update({ ficha_completada: false })
            .eq('ciclo_escolar', ciclo).eq('status', 'ACTIVO').select('id_alumno');
        if (errR) return res.status(500).json({ error: errR.message });
        return res.json({ reseteadas: actualizados?.length || 0 });
    }

    if (suboperacion === 'activar_ciclo') {
        const { nuevoCiclo } = req.body;
        if (!nuevoCiclo || !/^\d{4}-\d{4}$/.test(nuevoCiclo))
            return res.status(400).json({ error: 'Formato de ciclo inválido' });
        const { setCicloActivo } = require('./_lib');
        try { await setCicloActivo(nuevoCiclo, db); } catch(e) { return res.status(500).json({ error: e.message }); }
        await db.from('logs_actividad').insert([{
            id_usuario: usuario.id_usuario, nombre_usuario: usuario.nombre_completo, rol: usuario.rol,
            accion: 'CIERRE_CICLO_ACTIVAR', detalle: `Ciclo activado: ${nuevoCiclo}`,
            ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown', fecha: new Date().toISOString()
        }]);
        return res.json({ exito: true, cicloActivo: nuevoCiclo });
    }

    return res.status(400).json({ error: `Suboperacion desconocida: ${suboperacion}` });
}
