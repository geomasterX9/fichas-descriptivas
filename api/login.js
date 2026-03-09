const supabase = require('./_supabase');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { setSecurityHeaders, sanitize } = require('./_security');

const intentos = new Map();
const MAX_INTENTOS = 5;
const VENTANA_MS = 15 * 60 * 1000;

function verificarRateLimit(ip) {
    const ahora = Date.now();
    const registro = intentos.get(ip) || { count: 0, inicio: ahora };
    if (ahora - registro.inicio > VENTANA_MS) {
        intentos.set(ip, { count: 1, inicio: ahora });
        return { bloqueado: false };
    }
    if (registro.count >= MAX_INTENTOS) {
        const mins = Math.ceil((VENTANA_MS - (ahora - registro.inicio)) / 60000);
        return { bloqueado: true, minutosRestantes: mins };
    }
    registro.count++;
    intentos.set(ip, registro);
    return { bloqueado: false };
}

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'POST, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    const limite = verificarRateLimit(ip);
    if (limite.bloqueado) {
        return res.status(429).json({ error: `Demasiados intentos. Espera ${limite.minutosRestantes} minuto(s).` });
    }

    try {
        const { usuario, password, rol } = req.body || {};
        if (!usuario || !password || !rol) return res.status(400).json({ error: 'Todos los campos son requeridos.' });
        if (typeof usuario !== 'string' || usuario.length > 100) return res.status(400).json({ error: 'Datos inválidos.' });

        const { data, error } = await supabase
            .from('usuarios')
            .select('id_usuario, usuario, password, nombre_completo, rol')
            .eq('usuario', sanitize(usuario.trim().toUpperCase()))
            .eq('rol', rol.toUpperCase().trim())
            .single();

        // Siempre bcrypt — las contraseñas ya fueron migradas
        const hashFalso = '$2a$12$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
        const hash = data?.password || hashFalso;
        const passwordValido = await bcrypt.compare(password, hash);

        if (error || !data || !passwordValido) {
            return res.status(401).json({ error: 'Usuario, contraseña o rol incorrectos.' });
        }

        intentos.delete(ip);

        const token = jwt.sign(
            { id: data.id_usuario, nombre: data.nombre_completo, rol: data.rol },
            process.env.JWT_SECRET,  // sin fallback — falla si no está configurado
            { expiresIn: '8h' }
        );

        res.json({ mensaje: 'Acceso concedido', token, nombre_completo: data.nombre_completo, rol: data.rol });

    } catch (e) {
        console.error('Error en login:', e.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};
