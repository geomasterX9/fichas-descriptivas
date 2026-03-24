const { supabase, requireAuth, setSecurityHeaders, sanitize, getCicloActivo, setCicloActivo, invalidarTokens } = require('./_lib');
const { IncomingForm } = require('formidable');
const fs = require('fs');
const pdfParse = require('pdf-parse');

module.exports.config = { api: { bodyParser: false } };

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'POST, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Solo ADMINISTRADOR puede importar calificaciones
    const usuario = await requireAuth(req, res, 'importar-calificaciones');
    if (!usuario) return;

    try {
        const form = new IncomingForm({ keepExtensions: true, maxFileSize: 10 * 1024 * 1024 });
        const { files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => { if (err) reject(err); else resolve({ fields, files }); });
        });
        const docFile = Array.isArray(files.documento) ? files.documento[0] : files.documento;
        if (!docFile) return res.status(400).json({ error: 'No se recibió archivo' });

        // Validar que sea PDF
        if (docFile.mimetype !== 'application/pdf') {
            return res.status(400).json({ error: 'Solo se aceptan archivos PDF.' });
        }

        const normalizar = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        buffer = fs.readFileSync(docFile.filepath);
        pdfData = await pdfParse(buffer);
        textoPDF = normalizar(pdfData.text.replace(/"/g, '').replace(/\n/g, ' ').toUpperCase());
        trimestreMatch = textoPDF.match(/MOMENTO:\s*(\d)/);
        trimestre = trimestreMatch ? parseInt(trimestreMatch[1]) : 1;

        if (![1, 2, 3].includes(trimestre)) return res.status(400).json({ error: 'Trimestre no reconocido en el PDF.' });

        { data: alumnos } = await supabase.from('alumnos').select('*').eq('status', 'ACTIVO');
        let contador = 0;

        for (alumno of alumnos) {
            nombreCompleto = normalizar(`${alumno.apellidos} ${alumno.nombre}`.toUpperCase());
            index = textoPDF.indexOf(nombreCompleto);
            if (index !== -1) {
                fragmento = textoPDF.substring(index + nombreCompleto.length, index + nombreCompleto.length + 350);
                calificacionesDetectadas = fragmento.match(/(10(\.0)?|[5-9](\.\d)?)/g);
                if (calificacionesDetectadas) {
                    let materiasArr = [];
                    let promedioReal = null;
                    if (alumno.grado == 1 && calificacionesDetectadas.length >= 12) {
                        ['ESP','MAT','SLI','CIE','HIS','GMM','FCE','ETE','EFI','ART','ESO'].forEach((s, i) => materiasArr.push({ sigla: s, calif: calificacionesDetectadas[i] }));
                        promedioReal = parseFloat(calificacionesDetectadas[11]);
                    } else if ((alumno.grado == 2 || alumno.grado == 3) && calificacionesDetectadas.length >= 11) {
                        ['ESP','MAT','SLI','CIE','HIS','FCE','ETE','EFI','ART','ESO'].forEach((s, i) => materiasArr.push({ sigla: s, calif: calificacionesDetectadas[i] }));
                        promedioReal = parseFloat(calificacionesDetectadas[10]);
                    }
                    // Fallback: calcular si no se pudo extraer del PDF
                    if (!promedioReal && materiasArr.length > 0) {
                        suma = materiasArr.reduce((acc, m) => acc + parseFloat(m.calif), 0);
                        promedioReal = parseFloat((suma / materiasArr.length).toFixed(1));
                    }
                    if (materiasArr.length > 0) {
                        await supabase.from('calificaciones').delete().match({ id_alumno: alumno.id_alumno, trimestre });
                        await supabase.from('calificaciones').insert({ id_alumno: alumno.id_alumno, trimestre, promedio_trimestral: promedioReal, materias: materiasArr });
                        contador++;
                    }
                }
            }
        }
        // Registrar log de importación
        await supabase.from('logs_actividad').insert([{
            id_usuario:     usuario.id,
            nombre_usuario: usuario.nombre,
            rol:            usuario.rol,
            accion:         'IMPORTAR_CALIFICACIONES',
            detalle:        `${contador} alumnos sincronizados`,
            ip:             req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown'
        }]);
        res.json({ exito: true, mensaje: `Sincronizados ${contador} alumnos correctamente.` });
    } catch (e) { res.status(500).json({ error: 'Error al procesar archivo PDF' }); }
};
