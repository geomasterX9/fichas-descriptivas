const supabase = require('./_supabase');
const { requireAuth } = require('./_auth');
const { setSecurityHeaders } = require('./_security');
const { IncomingForm } = require('formidable');
const fs = require('fs');

module.exports.config = { api: { bodyParser: false } };

const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
const TAMANO_MAX = 5 * 1024 * 1024; // 5MB

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'POST, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuario = await requireAuth(req, res, 'foto-alumno');
    if (!usuario) return;

    try {
        const form = new IncomingForm({ keepExtensions: true, maxFileSize: TAMANO_MAX });
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => { if (err) reject(err); else resolve({ fields, files }); });
        });
        const id_alumno = Array.isArray(fields.id_alumno) ? fields.id_alumno[0] : fields.id_alumno;
        const fotoFile = Array.isArray(files.foto) ? files.foto[0] : files.foto;

        if (!fotoFile || !id_alumno) return res.status(400).json({ error: 'Faltan datos' });
        if (isNaN(parseInt(id_alumno))) return res.status(400).json({ error: 'ID de alumno inválido' });

        // ── Validar tipo de archivo ──
        if (!TIPOS_PERMITIDOS.includes(fotoFile.mimetype)) {
            return res.status(400).json({ error: 'Solo se permiten imágenes JPG, PNG o WebP.' });
        }
        if (fotoFile.size > TAMANO_MAX) {
            return res.status(400).json({ error: 'La imagen no puede superar 5MB.' });
        }

        const ext = fotoFile.mimetype.split('/')[1].replace('jpeg', 'jpg');
        const nombreArchivo = `${parseInt(id_alumno)}.${ext}`;
        const buffer = fs.readFileSync(fotoFile.filepath);

        const { error: uploadError } = await supabase.storage.from('fotos_alumnos').upload(nombreArchivo, buffer, { contentType: fotoFile.mimetype, upsert: true });
        if (uploadError) return res.status(500).json({ error: uploadError.message });

        const { data: urlData } = supabase.storage.from('fotos_alumnos').getPublicUrl(nombreArchivo);
        const { error: updateError } = await supabase.from('alumnos').update({ 'fotos-alumnos': urlData.publicUrl }).eq('id_alumno', parseInt(id_alumno));
        if (updateError) return res.status(500).json({ error: updateError.message });

        res.json({ url: urlData.publicUrl });
    } catch (e) { res.status(500).json({ error: 'Error al subir foto' }); }
};
