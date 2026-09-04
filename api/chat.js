// ============================================================
// api/chat.js — Mensajería interna de urgencia entre personal
// Fase 1: canales por rol + DM, historial, polling (sin push aún)
// ============================================================
const { supabase, requireAuth, setSecurityHeaders, sanitize } = require('./_lib');

const ROLES_VALIDOS = ['ADMINISTRADOR', 'DIRECTIVO', 'DOCENTE', 'PREFECTO', 'TRABAJO SOCIAL', 'ENFERMERIA'];

module.exports = async (req, res) => {
    setSecurityHeaders(res, 'GET, POST, OPTIONS', req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuario = await requireAuth(req, res, 'chat');
    if (!usuario) return;
    const db = usuario._db || supabase;

    const tipo = req.query.tipo;

    try {
        // ── GET: directorio de personal (para iniciar un DM) ──
        if (req.method === 'GET' && tipo === 'directorio') {
            const { data } = await db
                .from('usuarios')
                .select('id_usuario, nombre_completo, nombre_corto, rol')
                .order('nombre_completo', { ascending: true });
            return res.json((data || []).filter(u => u.id_usuario !== usuario.id));
        }

        // ── GET: mis canales (rol + DMs) con último mensaje y no leídos ──
        if (req.method === 'GET' && tipo === 'canales') {
            const { data: canalRol } = await db
                .from('chat_canales').select('*')
                .eq('tipo', 'ROL').eq('rol', usuario.rol).maybeSingle();
            const { data: canalesDM } = await db
                .from('chat_canales').select('*')
                .eq('tipo', 'DM')
                .or(`usuario_a.eq.${usuario.id},usuario_b.eq.${usuario.id}`);

            const canales = [canalRol, ...(canalesDM || [])].filter(Boolean);
            if (canales.length === 0) return res.json([]);
            const idsCanal = canales.map(c => c.id_canal);

            const [{ data: mensajesRecientes }, { data: lecturas }, { data: directorio }] = await Promise.all([
                db.from('chat_mensajes')
                    .select('id_canal, id_usuario, nombre_usuario, mensaje, urgente, fecha')
                    .in('id_canal', idsCanal).order('fecha', { ascending: false }).limit(500),
                db.from('chat_lecturas')
                    .select('id_canal, ultimo_leido_en')
                    .eq('id_usuario', usuario.id).in('id_canal', idsCanal),
                db.from('usuarios').select('id_usuario, nombre_completo, nombre_corto')
            ]);

            const mapaLecturas = {};
            (lecturas || []).forEach(l => { mapaLecturas[l.id_canal] = l.ultimo_leido_en; });
            const mapaNombres = {};
            (directorio || []).forEach(u => { mapaNombres[u.id_usuario] = u.nombre_corto || u.nombre_completo; });

            const resultado = canales.map(c => {
                const msgsCanal = (mensajesRecientes || []).filter(m => m.id_canal === c.id_canal);
                const ultimoLeido = mapaLecturas[c.id_canal] ? new Date(mapaLecturas[c.id_canal]) : new Date(0);
                const noLeidos = msgsCanal.filter(m => new Date(m.fecha) > ultimoLeido).length;

                let etiqueta;
                if (c.tipo === 'ROL') {
                    etiqueta = c.rol;
                } else {
                    const otroId = c.usuario_a === usuario.id ? c.usuario_b : c.usuario_a;
                    etiqueta = mapaNombres[otroId] || 'Usuario';
                }

                return {
                    id_canal: c.id_canal,
                    tipo: c.tipo,
                    rol: c.rol,
                    usuario_a: c.usuario_a,
                    usuario_b: c.usuario_b,
                    etiqueta,
                    ultimo_mensaje: msgsCanal[0] || null,
                    no_leidos: noLeidos
                };
            });

            resultado.sort((a, b) => {
                const fa = a.ultimo_mensaje ? new Date(a.ultimo_mensaje.fecha).getTime() : 0;
                const fb = b.ultimo_mensaje ? new Date(b.ultimo_mensaje.fecha).getTime() : 0;
                return fb - fa;
            });
            return res.json(resultado);
        }

        // ── GET: historial de un canal ──
        if (req.method === 'GET' && tipo === 'mensajes') {
            const idCanal = parseInt(req.query.canal);
            if (!idCanal) return res.status(400).json({ error: 'Falta canal' });

            const { data: canal } = await db.from('chat_canales').select('*').eq('id_canal', idCanal).maybeSingle();
            if (!canal) return res.status(404).json({ error: 'Canal no encontrado' });

            const pertenece = canal.tipo === 'ROL'
                ? canal.rol === usuario.rol
                : (canal.usuario_a === usuario.id || canal.usuario_b === usuario.id);
            if (!pertenece) return res.status(403).json({ error: 'No perteneces a este canal.' });

            const { data: mensajes } = await db.from('chat_mensajes')
                .select('*').eq('id_canal', idCanal)
                .order('fecha', { ascending: true })
                .limit(200);
            return res.json(mensajes || []);
        }

        // ── POST: enviar mensaje (a un canal existente, a un rol, o a una persona) ──
        if (req.method === 'POST' && tipo === 'mensaje') {
            const { canal, paraRol, paraUsuario, mensaje, urgente } = req.body || {};

            if (!mensaje || typeof mensaje !== 'string' || !mensaje.trim())
                return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
            if (mensaje.length > 1000)
                return res.status(400).json({ error: 'El mensaje no puede exceder 1000 caracteres.' });

            let idCanal;

            if (canal) {
                idCanal = parseInt(canal);
                const { data: c } = await db.from('chat_canales').select('*').eq('id_canal', idCanal).maybeSingle();
                if (!c) return res.status(404).json({ error: 'Canal no encontrado' });
                const pertenece = c.tipo === 'ROL'
                    ? c.rol === usuario.rol
                    : (c.usuario_a === usuario.id || c.usuario_b === usuario.id);
                if (!pertenece) return res.status(403).json({ error: 'No perteneces a este canal.' });
            } else if (paraRol) {
                if (!ROLES_VALIDOS.includes(paraRol))
                    return res.status(400).json({ error: 'Rol destino inválido.' });
                const { data: c } = await db.from('chat_canales').select('id_canal')
                    .eq('tipo', 'ROL').eq('rol', paraRol).single();
                if (!c) return res.status(404).json({ error: 'Canal de rol no existe.' });
                idCanal = c.id_canal;
            } else if (paraUsuario) {
                const otroId = parseInt(paraUsuario);
                if (!otroId || otroId === usuario.id)
                    return res.status(400).json({ error: 'Destinatario inválido.' });
                const a = Math.min(usuario.id, otroId);
                const b = Math.max(usuario.id, otroId);
                let { data: c } = await db.from('chat_canales').select('id_canal')
                    .eq('tipo', 'DM').eq('usuario_a', a).eq('usuario_b', b).maybeSingle();
                if (!c) {
                    const { data: nuevo, error: errCrear } = await db.from('chat_canales')
                        .insert([{ tipo: 'DM', usuario_a: a, usuario_b: b }])
                        .select('id_canal').single();
                    if (errCrear) return res.status(500).json({ error: 'No se pudo crear la conversación.' });
                    c = nuevo;
                }
                idCanal = c.id_canal;
            } else {
                return res.status(400).json({ error: 'Falta destinatario (canal, paraRol o paraUsuario).' });
            }

            const payload = {
                id_canal:       idCanal,
                id_usuario:     usuario.id,
                nombre_usuario: usuario.nombre,
                mensaje:        sanitize(mensaje.trim()),
                urgente:        !!urgente,
                fecha:          new Date().toISOString()
            };
            const { data: insertado, error } = await db.from('chat_mensajes').insert([payload]).select('*').single();
            if (error) return res.status(500).json({ error: 'No se pudo enviar el mensaje.' });

            // El remitente ya "leyó" su propio mensaje
            await db.from('chat_lecturas').upsert(
                { id_usuario: usuario.id, id_canal: idCanal, ultimo_leido_en: payload.fecha },
                { onConflict: 'id_usuario,id_canal' }
            );

            return res.json({ exito: true, mensaje: insertado });
        }

        // ── POST: marcar un canal como leído ──
        if (req.method === 'POST' && tipo === 'leido') {
            const idCanal = parseInt((req.body || {}).canal);
            if (!idCanal) return res.status(400).json({ error: 'Falta canal' });
            await db.from('chat_lecturas').upsert(
                { id_usuario: usuario.id, id_canal: idCanal, ultimo_leido_en: new Date().toISOString() },
                { onConflict: 'id_usuario,id_canal' }
            );
            return res.json({ exito: true });
        }

        return res.status(400).json({ error: `Tipo no válido: ${tipo}` });
    } catch (e) {
        res.status(500).json({ error: 'Error en chat' });
    }
};
