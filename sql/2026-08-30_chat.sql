-- ============================================================
-- Chat interno de urgencia entre personal — Fase 1
-- Ejecutar manualmente en el SQL Editor de Supabase.
-- No crea/modifica ninguna tabla existente.
-- ============================================================

-- Canal = "conversación". Tipo ROL (compartido por todos los del rol) o DM (1 a 1).
create table chat_canales (
  id_canal      bigint generated always as identity primary key,
  tipo          text not null check (tipo in ('ROL','DM')),
  rol           text,                    -- solo si tipo='ROL'
  usuario_a     int,                     -- solo si tipo='DM' (el menor id_usuario)
  usuario_b     int,                     -- solo si tipo='DM' (el mayor id_usuario)
  creado_en     timestamptz not null default now(),
  unique (tipo, rol),
  unique (tipo, usuario_a, usuario_b)
);

-- Pre-sembrar un canal por cada rol
insert into chat_canales (tipo, rol) values
  ('ROL','ADMINISTRADOR'), ('ROL','DIRECTIVO'), ('ROL','DOCENTE'),
  ('ROL','PREFECTO'), ('ROL','TRABAJO SOCIAL'), ('ROL','ENFERMERIA');

create table chat_mensajes (
  id_mensaje     bigint generated always as identity primary key,
  id_canal       bigint not null references chat_canales(id_canal),
  id_usuario     int not null,
  nombre_usuario text not null,
  mensaje        text not null,
  urgente        boolean not null default false,
  fecha          timestamptz not null default now()
);
create index idx_chat_mensajes_canal_fecha on chat_mensajes (id_canal, fecha);

create table chat_lecturas (
  id_usuario       int not null,
  id_canal         bigint not null references chat_canales(id_canal),
  ultimo_leido_en  timestamptz not null default now(),
  primary key (id_usuario, id_canal)
);
