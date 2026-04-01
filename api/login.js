const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { setSecurityHeaders, sanitize } = require('./_lib');

// ── Clientes Supabase ─────────────────────────────────────
const supabaseProduccion = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);
const supabaseDemo = createClient(
    process.env.SUPABASE_URL_DEMO,
    process.env.SUPABASE_KEY_DEMO
);

const USUARIOS_DEMO = ['demo', 'admin', 'director', 'docente1', 'docente2',
                       'docente3', 'prefecto1', 'trabajosocial', 'enfermeria'];

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'POST, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    try {
        const { usuario, password } = req.body || {};
        if (!usuario || !password)
            return res.status(400).json({ error: 'Usuario y contraseña son requeridos.' });
        if (typeof usuario !== 'string' || usuario.length > 100)
            return res.status(400).json({ error: 'Datos inválidos.' });

        const usuarioNorm = usuario.trim().toLowerCase();

        // Determinar si es usuario demo
        const esDemo = USUARIOS_DEMO.includes(usuarioNorm);
        const db = esDemo ? supabaseDemo : supabaseProduccion;

        const { data, error } = await db
            .from('usuarios')
            .select('id_usuario, usuario, password, nombre_completo, rol, materia, nombre_corto, grupos')
            .ilike('usuario', sanitize(usuarioNorm))
            .single();

        // Siempre bcrypt para evitar timing attacks
        const hashFalso = '$2a$12$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
        const hash = data?.password || hashFalso;
        const passwordValido = await bcrypt.compare(password, hash);

        if (error || !data || !passwordValido) {
            return res.status(401).json({ error: 'Usuario, contraseña o rol incorrectos.' });
        }

        // Actualizar token_valido_desde con margen de 15s
        const tvd = new Date(Date.now() - 15000);
        await db
            .from('usuarios')
            .update({ token_valido_desde: tvd.toISOString() })
            .eq('id_usuario', data.id_usuario);

        // El token incluye esDemo para que las APIs usen la BD correcta
        const token = jwt.sign(
            {
                id:     data.id_usuario,
                nombre: data.nombre_completo,
                rol:    data.rol,
                esDemo: esDemo
            },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            mensaje:         'Acceso concedido',
            token,
            id_usuario:      data.id_usuario,
            nombre_completo: data.nombre_completo,
            rol:             data.rol,
            materia:         data.materia     || null,
            nombre_corto:    data.nombre_corto || null,
            grupos:          data.grupos      || null,
            esDemo:          esDemo
        });

    } catch (e) {
        console.error('Error en login:', e.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};
