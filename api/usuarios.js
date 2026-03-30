const { supabase, requireAuth, setSecurityHeaders, sanitize, getCicloActivo, setCicloActivo, invalidarTokens } = require('./_lib');
const bcrypt = require('bcryptjs');

const ROLES_VALIDOS = ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL', 'ENFERMERIA'];

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'GET, POST, PATCH, DELETE, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Cambio de contraseña propio — cualquier rol autenticado puede hacerlo
    if (req.method === 'PATCH' && req.body?.accion === 'cambiar_password') {
        const usuario = await requireAuth(req, res, null);
        if (!usuario) return;
        const { password_actual, password_nueva } = req.body || {};
        if (!password_actual || !password_nueva)
            return res.status(400).json({ error: 'Faltan campos requeridos.' });
        if (password_nueva.length < 5)
            return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 5 caracteres.' });
        const { data: uActual } = await supabase.from('usuarios').select('password').eq('id_usuario', usuario.id).single();
        if (!uActual) return res.status(404).json({ error: 'Usuario no encontrado.' });
        const valido = await bcrypt.compare(password_actual, uActual.password);
        if (!valido) return res.status(401).json({ error: 'La contraseña actual es incorrecta.' });
        const nuevoHash = await bcrypt.hash(password_nueva, 12);
        const { error } = await supabase.from('usuarios').update({
            password: nuevoHash,
            token_valido_desde: new Date().toISOString()
        }).eq('id_usuario', usuario.id);
        if (error) return res.status(500).json({ error: 'Error al actualizar contraseña.' });
        return res.json({ exito: true });
    }

    // Resto de operaciones — solo ADMINISTRADOR
    const usuario = await requireAuth(req, res, 'dashboard');
    if (!usuario) return;
    if (usuario.rol !== 'ADMINISTRADOR') {
        return res.status(403).json({ error: 'Solo el administrador puede gestionar usuarios.' });
    }

    // ── GET: listar todos los usuarios ──
    if (req.method === 'GET') {
        const { data, error } = await supabase
            .from('usuarios')
            .select('id_usuario, nombre_completo, usuario, rol, materia, nombre_corto, grupos, token_valido_desde')
            .order('nombre_completo', { ascending: true });
        if (error) return res.status(500).json({ error: 'Error al cargar usuarios.' });
        return res.json(data || []);
    }

    // ── POST: crear nuevo usuario ──
    if (req.method === 'POST') {
        const { nombre_completo, usuario: user, password, rol, nombre_corto, grupos } = req.body || {};

        if (!nombre_completo || !user || !password || !rol)
            return res.status(400).json({ error: 'Todos los campos son requeridos.' });
        if (!ROLES_VALIDOS.includes(rol.toUpperCase()))
            return res.status(400).json({ error: 'Rol no válido.' });
        if (typeof password !== 'string' || password.length < 6)
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
        if (typeof user !== 'string' || user.length < 3 || user.length > 50)
            return res.status(400).json({ error: 'El usuario debe tener entre 3 y 50 caracteres.' });

        // Verificar que el usuario no exista
        const { data: existe } = await supabase
            .from('usuarios')
            .select('id_usuario')
            .eq('usuario', sanitize(user.trim().toUpperCase()))
            .single();
        if (existe) return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso.' });

        const hash = await bcrypt.hash(password, 12);

        const { data, error } = await supabase.from('usuarios').insert([{
            nombre_completo: sanitize(nombre_completo.trim().toUpperCase()),
            usuario:         sanitize(user.trim().toUpperCase()),
            password:        hash,
            rol:             rol.toUpperCase(),
            nombre_corto:    nombre_corto ? sanitize(nombre_corto.trim()) : null,
            grupos:          Array.isArray(grupos) ? grupos : null,
            token_valido_desde: new Date().toISOString()
        }]).select('id_usuario, nombre_completo, usuario, rol').single();

        if (error) return res.status(500).json({ error: 'Error al crear usuario.' });
        return res.json({ exito: true, usuario: data });
    }

    // ── PATCH: editar usuario (nombre, rol o contraseña) — solo ADMINISTRADOR ──
    if (req.method === 'PATCH') {
        const { id_usuario, nombre_completo, rol, password, usuario: user, nombre_corto, grupos } = req.body || {};
        if (!id_usuario || isNaN(parseInt(id_usuario)))
            return res.status(400).json({ error: 'ID de usuario inválido.' });

        // No permitir que el admin se cambie su propio rol
        if (parseInt(id_usuario) === usuario.id && rol && rol.toUpperCase() !== 'ADMINISTRADOR')
            return res.status(400).json({ error: 'No puedes cambiar tu propio rol.' });

        const cambios = {};
        if (nombre_completo) cambios.nombre_completo = sanitize(nombre_completo.trim().toUpperCase());
        if (user)            cambios.usuario = sanitize(user.trim().toUpperCase());
        if (rol && ROLES_VALIDOS.includes(rol.toUpperCase())) cambios.rol = rol.toUpperCase();
        if (nombre_corto !== undefined) cambios.nombre_corto = nombre_corto ? sanitize(nombre_corto.trim()) : null;
        if (grupos !== undefined) cambios.grupos = Array.isArray(grupos) ? grupos : null;
        if (password) {
            if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
            cambios.password = await bcrypt.hash(password, 12);
            cambios.token_valido_desde = new Date().toISOString(); // Invalidar sesiones activas
        }

        if (Object.keys(cambios).length === 0)
            return res.status(400).json({ error: 'No hay cambios que guardar.' });

        const { error } = await supabase.from('usuarios').update(cambios).eq('id_usuario', parseInt(id_usuario));
        if (error) return res.status(500).json({ error: 'Error al actualizar usuario.' });
        return res.json({ exito: true });
    }

    // ── DELETE: eliminar usuario ──
    if (req.method === 'DELETE') {
        const { id_usuario } = req.body || {};
        if (!id_usuario || isNaN(parseInt(id_usuario)))
            return res.status(400).json({ error: 'ID de usuario inválido.' });
        if (parseInt(id_usuario) === usuario.id)
            return res.status(400).json({ error: 'No puedes eliminar tu propio usuario.' });

        const { error } = await supabase.from('usuarios').delete().eq('id_usuario', parseInt(id_usuario));
        if (error) return res.status(500).json({ error: 'Error al eliminar usuario.' });
        return res.json({ exito: true });
    }

    res.status(405).json({ error: 'Método no permitido' });
};
