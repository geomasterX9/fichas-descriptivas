const supabase = require('../lib/_supabase');
const { requireAuth } = require('../lib/_auth');
const { setSecurityHeaders } = require('../lib/_security');
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

        const buffer = fs.readFileSync(docFile.filepath);
        const pdfData = await pdfParse(buffer);
        const textoPDF = pdfData.text.replace(/"/g, '').replace(/\n/g, ' ').toUpperCase();
        const trimestreMatch = textoPDF.match(/MOMENTO:\s*(\d)/);
        const trimestre = trimestreMatch ? parseInt(trimestreMatch[1]) : 1;

        if (![1, 2, 3].includes(trimestre)) return res.status(400).json({ error: 'Trimestre no reconocido en el PDF.' });

        const { data: alumnos } = await supabase.from('alumnos').select('*');
        let contador = 0;

        for (const alumno of alumnos) {
            const nombreCompleto = `${alumno.apellidos} ${alumno.nombre}`.toUpperCase();
            const index = textoPDF.indexOf(nombreCompleto);
            if (index !== -1) {
                const fragmento = textoPDF.substring(index + nombreCompleto.length, index + nombreCompleto.length + 350);
                const calificacionesDetectadas = fragmento.match(/(10(\.0)?|[5-9](\.\d)?)/g);
                if (calificacionesDetectadas) {
                    let materiasArr = [];
                    if (alumno.grado == 1 && calificacionesDetectadas.length >= 11) {
                        ['ESP','MAT','SLI','CIE','HIS','GMM','FCE','ETE','EFI','ART','ESO'].forEach((s, i) => materiasArr.push({ sigla: s, calif: calificacionesDetectadas[i] }));
                    } else if ((alumno.grado == 2 || alumno.grado == 3) && calificacionesDetectadas.length >= 10) {
                        ['ESP','MAT','SLI','CIE','HIS','FCE','ETE','EFI','ART','ESO'].forEach((s, i) => materiasArr.push({ sigla: s, calif: calificacionesDetectadas[i] }));
                    }
                    if (materiasArr.length > 0) {
                        const suma = materiasArr.reduce((acc, m) => acc + parseFloat(m.calif), 0);
                        const promedioReal = parseFloat((suma / materiasArr.length).toFixed(1));
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
