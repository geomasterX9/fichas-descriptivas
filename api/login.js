const supabase = require('../lib/_supabase');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { setSecurityHeaders, sanitize } = require('../lib/_security');

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'POST, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    try {
        const { usuario, password } = req.body || {};
        if (!usuario || !password) return res.status(400).json({ error: 'Usuario y contraseña son requeridos.' });
        if (typeof usuario !== 'string' || usuario.length > 100) return res.status(400).json({ error: 'Datos inválidos.' });

        const { data, error } = await supabase
            .from('usuarios')
            .select('id_usuario, usuario, password, nombre_completo, rol, materia, nombre_corto')
            .ilike('usuario', sanitize(usuario.trim()))
            .single();

        // Siempre bcrypt para evitar timing attacks
        const hashFalso = '$2a$12$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
        const hash = data?.password || hashFalso;
        const passwordValido = await bcrypt.compare(password, hash);

        if (error || !data || !passwordValido) {
            return res.status(401).json({ error: 'Usuario, contraseña o rol incorrectos.' });
        }

        // Actualizar token_valido_desde ANTES de firmar el token
        // para que el iat del token sea siempre >= token_valido_desde
        const ahora = new Date();
        await supabase
            .from('usuarios')
            .update({ token_valido_desde: ahora.toISOString() })
            .eq('id_usuario', data.id_usuario);

        const token = jwt.sign(
            { id: data.id_usuario, nombre: data.nombre_completo, rol: data.rol },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            mensaje: 'Acceso concedido',
            token,
            id_usuario: data.id_usuario,
            nombre_completo: data.nombre_completo,
            rol: data.rol,
            materia: data.materia || null,
            nombre_corto: data.nombre_corto || null
        });

    } catch (e) {
        console.error('Error en login:', e.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};
