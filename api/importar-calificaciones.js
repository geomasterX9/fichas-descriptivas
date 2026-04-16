const { supabase, getSupabase, requireAuth, setSecurityHeaders, sanitize, getCicloActivo, setCicloActivo, invalidarTokens } = require('./_lib');
const { IncomingForm } = require('formidable');
const fs = require('fs');
const pdfParse = require('pdf-parse');

module.exports.config = { api: { bodyParser: false } };

// Normaliza un string: quita acentos, elimina cualquier carácter no ASCII,
// colapsa espacios múltiples y convierte a mayúsculas
const norm = s => s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // quita acentos/tildes
    .replace(/[^\x00-\x7F]/g, '')                       // elimina caracteres no ASCII (ej. Ñ griega)
    .replace(/\s+/g, ' ')                               // colapsa espacios múltiples
    .trim()
    .toUpperCase();

// Busca al alumno en el texto del PDF con matching tolerante
const buscarAlumnoEnPDF = (textoPDF, alumno) => {
    const apellidos    = norm(alumno.apellidos);
    const nombre       = norm(alumno.nombre);
    const completo     = `${apellidos} ${nombre}`;
    const primerNombre = nombre.split(' ')[0];

    // Intento 1: match exacto nombre completo normalizado
    let idx = textoPDF.indexOf(completo);
    if (idx !== -1) return idx + completo.length;

    // Intento 2: match por apellidos + primera palabra del nombre en ventana de 80 chars
    idx = textoPDF.indexOf(apellidos);
    while (idx !== -1) {
        const ventana = textoPDF.substring(idx + apellidos.length, idx + apellidos.length + 80);
        if (ventana.includes(primerNombre)) {
            return idx + apellidos.length + ventana.indexOf(primerNombre) + primerNombre.length;
        }
        idx = textoPDF.indexOf(apellidos, idx + 1);
    }

    return -1;
};

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'POST, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuario = await requireAuth(req, res, 'importar-calificaciones');
    if (!usuario) return;
    const db = usuario._db || supabase;

    try {
        const form = new IncomingForm({ keepExtensions: true, maxFileSize: 10 * 1024 * 1024 });
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => { if (err) reject(err); else resolve({ fields, files }); });
        });
        const docFile = Array.isArray(files.documento) ? files.documento[0] : files.documento;
        if (!docFile) return res.status(400).json({ error: 'No se recibió archivo' });

        if (docFile.mimetype !== 'application/pdf') {
            return res.status(400).json({ error: 'Solo se aceptan archivos PDF.' });
        }

        // Leer valores seleccionados por el usuario en el frontend
        const gradoSeleccionado  = Array.isArray(fields.grado)    ? fields.grado[0]    : fields.grado;
        const grupoSeleccionado  = (Array.isArray(fields.grupo)    ? fields.grupo[0]    : fields.grupo || '').toUpperCase().trim();
        const trimestreEnviado   = parseInt(Array.isArray(fields.trimestre) ? fields.trimestre[0] : fields.trimestre);

        const buffer  = fs.readFileSync(docFile.filepath);
        const pdfData = await pdfParse(buffer);

        // Normalizar texto del PDF
        const textoPDF = norm(pdfData.text.replace(/"/g, '').replace(/\n/g, ' '));

        // ── Validar trimestre ──
        const trimestreMatch = textoPDF.match(/MOMENTO:\s*(\d)/);
        const trimestre = trimestreMatch ? parseInt(trimestreMatch[1]) : null;
        if (!trimestre || ![1, 2, 3].includes(trimestre)) {
            return res.status(400).json({ error: 'Trimestre no reconocido en el PDF.' });
        }
        if (trimestre !== trimestreEnviado) {
            return res.status(400).json({
                error: `El PDF corresponde al Trimestre ${trimestre}, pero seleccionaste el Trimestre ${trimestreEnviado}. Por favor verifica el archivo.`
            });
        }

        // ── Validar grado y grupo ──
        // El PDF trae "GRUPO: 2-B" → extraemos grado=2 y grupo=B
        const grupoMatch = textoPDF.match(/GRUPO:\s*(\d)\s*[-–]\s*([A-Z])/);
        if (grupoMatch) {
            const gradoPDF = grupoMatch[1];           // "2"
            const grupoPDF = grupoMatch[2].trim();    // "B"

            if (gradoPDF !== String(gradoSeleccionado)) {
                return res.status(400).json({
                    error: `El PDF es del ${gradoPDF}° grado, pero seleccionaste ${gradoSeleccionado}°. Por favor verifica el archivo.`
                });
            }
            if (grupoPDF !== grupoSeleccionado) {
                return res.status(400).json({
                    error: `El PDF es del grupo "${grupoPDF}", pero seleccionaste el grupo "${grupoSeleccionado}". Por favor verifica el archivo.`
                });
            }
        }

        const { data: alumnos } = await db.from('alumnos').select('*').eq('status', 'ACTIVO');
        let contador      = 0;
        let noEncontrados = [];

        for (const alumno of alumnos) {
            const posFinNombre = buscarAlumnoEnPDF(textoPDF, alumno);

            if (posFinNombre === -1) {
                noEncontrados.push(`${alumno.apellidos} ${alumno.nombre}`);
                continue;
            }

            const fragmento = textoPDF.substring(posFinNombre, posFinNombre + 400);
            const calificacionesDetectadas = fragmento.match(/(10(\.0)?|[5-9](\.\d)?)/g);

            if (!calificacionesDetectadas) continue;

            let materiasArr  = [];
            let promedioReal = null;

            if (alumno.grado == 1 && calificacionesDetectadas.length >= 12) {
                ['ESP','MAT','SLI','CIE','HIS','GMM','FCE','ETE','EFI','ART','ESO'].forEach((s, i) =>
                    materiasArr.push({ sigla: s, calif: calificacionesDetectadas[i] }));
                promedioReal = parseFloat(calificacionesDetectadas[11]);
            } else if ((alumno.grado == 2 || alumno.grado == 3) && calificacionesDetectadas.length >= 11) {
                ['ESP','MAT','SLI','CIE','HIS','FCE','ETE','EFI','ART','ESO'].forEach((s, i) =>
                    materiasArr.push({ sigla: s, calif: calificacionesDetectadas[i] }));
                promedioReal = parseFloat(calificacionesDetectadas[10]);
            }

            if (!promedioReal && materiasArr.length > 0) {
                const suma = materiasArr.reduce((acc, m) => acc + parseFloat(m.calif), 0);
                promedioReal = parseFloat((suma / materiasArr.length).toFixed(1));
            }

            if (materiasArr.length > 0) {
                await db.from('calificaciones').delete().match({ id_alumno: alumno.id_alumno, trimestre });
                await db.from('calificaciones').insert({
                    id_alumno: alumno.id_alumno, trimestre,
                    promedio_trimestral: promedioReal, materias: materiasArr
                });
                contador++;
            }
        }

        // Log con detalle de no encontrados para auditoría
        const detalle = noEncontrados.length > 0
            ? `${contador} sincronizados. No encontrados: ${noEncontrados.join(', ')}`
            : `${contador} alumnos sincronizados correctamente`;

        await db.from('logs_actividad').insert([{
            id_usuario:     usuario.id,
            nombre_usuario: usuario.nombre,
            rol:            usuario.rol,
            accion:         'IMPORTAR_CALIFICACIONES',
            detalle,
            ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown'
        }]);

        res.json({
            exito: true,
            mensaje: `Sincronizados ${contador} alumnos correctamente.`,
            no_encontrados: noEncontrados
        });

    } catch (e) {
        console.error('Error importar-calificaciones:', e.message);
        res.status(500).json({ error: 'Error al procesar archivo PDF' });
    }
};
