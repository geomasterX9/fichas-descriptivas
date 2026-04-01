const { supabase, getSupabase, requireAuth, setSecurityHeaders } = require('./_lib');
const { IncomingForm } = require('formidable');
const fs = require('fs');
const path = require('path');

module.exports.config = { api: { bodyParser: false } };

const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
const TAMANO_MAX = 5 * 1024 * 1024; // 5MB

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'POST, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuario = await requireAuth(req, res, 'fotos');
    if (!usuario) return;
    const db = usuario._db || supabase;

    // Detectar acción por query param: ?accion=masiva (carga masiva) o default (foto individual)
    const accion = req.query.accion;

    // ── CARGA MASIVA ──
    if (accion === 'masiva') {
        if (usuario.rol !== 'ADMINISTRADOR') {
            return res.status(403).json({ error: 'Solo el administrador puede realizar carga masiva.' });
        }

        try {
            const form = new IncomingForm({
                keepExtensions: true,
                maxFileSize: TAMANO_MAX,
                maxFiles: 500,
                maxTotalFileSize: 500 * 1024 * 1024
            });

            const { files } = await new Promise((resolve, reject) => {
                form.parse(req, (err, fields, files) => {
                    if (err) reject(err); else resolve({ fields, files });
                });
            });

            let listaFotos = files.fotos;
            if (!listaFotos) return res.status(400).json({ error: 'No se recibieron fotos.' });
            if (!Array.isArray(listaFotos)) listaFotos = [listaFotos];

            const exitosos = [];
            const fallidos = [];

            for (const foto of listaFotos) {
                const nombreOriginal = foto.originalFilename || foto.name || '';
                const nombreSinExt = path.parse(nombreOriginal).name;
                const idAlumno = parseInt(nombreSinExt);

                if (isNaN(idAlumno) || idAlumno <= 0 || String(idAlumno) !== nombreSinExt.trim()) {
                    fallidos.push(`${nombreOriginal} (nombre no es un ID válido)`);
                    continue;
                }
                if (!TIPOS_PERMITIDOS.includes(foto.mimetype)) {
                    fallidos.push(`${nombreOriginal} (tipo de archivo no permitido)`);
                    continue;
                }
                if (foto.size > TAMANO_MAX) {
                    fallidos.push(`${nombreOriginal} (supera 5MB)`);
                    continue;
                }

                try {
                    const ext = foto.mimetype.split('/')[1].replace('jpeg', 'jpg');
                    const nombreArchivo = `${idAlumno}.${ext}`;
                    const buffer = fs.readFileSync(foto.filepath);

                    const { error: uploadError } = await db.storage
                        .from('fotos_alumnos')
                        .upload(nombreArchivo, buffer, { contentType: foto.mimetype, upsert: true });

                    if (uploadError) {
                        fallidos.push(`${nombreOriginal} (error storage: ${uploadError.message})`);
                        continue;
                    }

                    const { data: urlData } = db.storage.from('fotos_alumnos').getPublicUrl(nombreArchivo);

                    const { error: updateError } = await supabase
                        .from('alumnos')
                        .update({ 'fotos-alumnos': urlData.publicUrl })
                        .eq('id_alumno', idAlumno);

                    if (updateError) {
                        fallidos.push(`${nombreOriginal} (error BD: ${updateError.message})`);
                        continue;
                    }

                    exitosos.push(`ID ${idAlumno}`);
                } catch (e) {
                    fallidos.push(`${nombreOriginal} (error interno)`);
                }
            }

            const mensaje = `${exitosos.length} fotos subidas correctamente. ${fallidos.length} archivos ignorados.`;
            return res.json({ mensaje, detalles: { exitosos, fallidos } });

        } catch (e) {
            console.error('Error carga masiva:', e);
            return res.status(500).json({ error: 'Error al procesar las fotos. Intenta con menos archivos a la vez.' });
        }
    }

    // ── FOTO INDIVIDUAL ──
    try {
        const form = new IncomingForm({ keepExtensions: true, maxFileSize: TAMANO_MAX });
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => { if (err) reject(err); else resolve({ fields, files }); });
        });

        const id_alumno = Array.isArray(fields.id_alumno) ? fields.id_alumno[0] : fields.id_alumno;
        const fotoFile  = Array.isArray(files.foto) ? files.foto[0] : files.foto;

        if (!fotoFile || !id_alumno) return res.status(400).json({ error: 'Faltan datos' });
        if (isNaN(parseInt(id_alumno))) return res.status(400).json({ error: 'ID de alumno inválido' });
        if (!TIPOS_PERMITIDOS.includes(fotoFile.mimetype))
            return res.status(400).json({ error: 'Solo se permiten imágenes JPG, PNG o WebP.' });
        if (fotoFile.size > TAMANO_MAX)
            return res.status(400).json({ error: 'La imagen no puede superar 5MB.' });

        const ext = fotoFile.mimetype.split('/')[1].replace('jpeg', 'jpg');
        const nombreArchivo = `${parseInt(id_alumno)}.${ext}`;
        const buffer = fs.readFileSync(fotoFile.filepath);

        const { error: uploadError } = await db.storage
            .from('fotos_alumnos')
            .upload(nombreArchivo, buffer, { contentType: fotoFile.mimetype, upsert: true });
        if (uploadError) return res.status(500).json({ error: uploadError.message });

        const { data: urlData } = db.storage.from('fotos_alumnos').getPublicUrl(nombreArchivo);

        const { error: updateError } = await supabase
            .from('alumnos')
            .update({ 'fotos-alumnos': urlData.publicUrl })
            .eq('id_alumno', parseInt(id_alumno));
        if (updateError) return res.status(500).json({ error: updateError.message });

        return res.json({ url: urlData.publicUrl });

    } catch (e) {
        return res.status(500).json({ error: 'Error al subir foto' });
    }
};
