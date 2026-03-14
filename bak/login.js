const supabase = require('../lib/_supabase');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { setSecurityHeaders, sanitize } = require('../lib/_security');
const { Redis } = require('@upstash/redis');

const MAX_INTENTOS = 5;
const VENTANA_SEG = 15 * 60; // 15 minutos en segundos

// Cliente Redis — usa variables de entorno de Vercel
const redis = new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function verificarRateLimit(ip) {
    const key = `login_intentos:${ip}`;
    try {
        // Incrementar contador; si es la primera vez, crear con TTL de 15 min
        const intentos = await redis.incr(key);
        if (intentos === 1) {
            await redis.expire(key, VENTANA_SEG);
        }
        if (intentos > MAX_INTENTOS) {
            const ttl = await redis.ttl(key);
            const mins = Math.ceil(ttl / 60);
            return { bloqueado: true, minutosRestantes: mins };
        }
        return { bloqueado: false };
    } catch (e) {
        // Si Redis falla, permitir el acceso para no bloquear a usuarios legítimos
        console.error('Redis error en rate limit:', e.message);
        return { bloqueado: false };
    }
}

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'POST, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    const limite = await verificarRateLimit(ip);
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
            .eq('usuario', sanitize(usuario.trim().toLowerCase()))
            .eq('rol', rol.toUpperCase().trim())
            .single();

        // Siempre bcrypt — las contraseñas ya fueron migradas
        const hashFalso = '$2a$12$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
        const hash = data?.password || hashFalso;
        const passwordValido = await bcrypt.compare(password, hash);

        if (error || !data || !passwordValido) {
            return res.status(401).json({ error: 'Usuario, contraseña o rol incorrectos.' });
        }

        await redis.del(`login_intentos:${ip}`); // Limpiar contador al login exitoso

        // Actualizar token_valido_desde para invalidar sesiones anteriores
        await supabase
            .from('usuarios')
            .update({ token_valido_desde: new Date().toISOString() })
            .eq('id_usuario', data.id_usuario);

        const token = jwt.sign(
            { id: data.id_usuario, nombre: data.nombre_completo, rol: data.rol },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({ mensaje: 'Acceso concedido', token, id_usuario: data.id_usuario, nombre_completo: data.nombre_completo, rol: data.rol });

    } catch (e) {
        console.error('Error en login:', e.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};
