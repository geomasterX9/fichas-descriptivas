const supabase = require('./_supabase');
const { requireAuth } = require('./_auth');
const { setSecurityHeaders } = require('./_security');
const { IncomingForm } = require('formidable');
const fs = require('fs');
const path = require('path');

module.exports.config = { api: { bodyParser: false } };

const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
const TAMANO_MAX = 5 * 1024 * 1024; // 5MB por foto

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'POST, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuario = requireAuth(req, res, 'carga-masiva-fotos');
    if (!usuario) return;

    // Solo ADMINISTRADOR puede hacer carga masiva
    if (usuario.rol !== 'ADMINISTRADOR') {
        return res.status(403).json({ error: 'Solo el administrador puede realizar carga masiva.' });
    }

    try {
        const form = new IncomingForm({
            keepExtensions: true,
            maxFileSize: TAMANO_MAX,
            maxFiles: 500,
            maxTotalFileSize: 500 * 1024 * 1024 // 500MB total
        });

        const { files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        // formidable puede devolver array o un solo archivo
        let listaFotos = files.fotos;
        if (!listaFotos) return res.status(400).json({ error: 'No se recibieron fotos.' });
        if (!Array.isArray(listaFotos)) listaFotos = [listaFotos];

        const exitosos = [];
        const fallidos = [];

        for (const foto of listaFotos) {
            const nombreOriginal = foto.originalFilename || foto.name || '';
            const nombreSinExt = path.parse(nombreOriginal).name;
            const idAlumno = parseInt(nombreSinExt);

            // Validar que el nombre del archivo sea un número entero válido
            if (isNaN(idAlumno) || idAlumno <= 0 || String(idAlumno) !== nombreSinExt.trim()) {
                fallidos.push(`${nombreOriginal} (nombre no es un ID válido)`);
                continue;
            }

            // Validar tipo de archivo
            if (!TIPOS_PERMITIDOS.includes(foto.mimetype)) {
                fallidos.push(`${nombreOriginal} (tipo de archivo no permitido)`);
                continue;
            }

            // Validar tamaño
            if (foto.size > TAMANO_MAX) {
                fallidos.push(`${nombreOriginal} (supera 5MB)`);
                continue;
            }

            try {
                const ext = foto.mimetype.split('/')[1].replace('jpeg', 'jpg');
                const nombreArchivo = `${idAlumno}.${ext}`;
                const buffer = fs.readFileSync(foto.filepath);

                // Subir a Supabase Storage
                const { error: uploadError } = await supabase.storage
                    .from('fotos_alumnos')
                    .upload(nombreArchivo, buffer, { contentType: foto.mimetype, upsert: true });

                if (uploadError) {
                    fallidos.push(`${nombreOriginal} (error storage: ${uploadError.message})`);
                    continue;
                }

                // Obtener URL pública
                const { data: urlData } = supabase.storage
                    .from('fotos_alumnos')
                    .getPublicUrl(nombreArchivo);

                // Actualizar registro del alumno
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
        res.json({ mensaje, detalles: { exitosos, fallidos } });

    } catch (e) {
        console.error('Error carga masiva:', e);
        res.status(500).json({ error: 'Error al procesar las fotos. Intenta con menos archivos a la vez.' });
    }
};
