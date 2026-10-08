-- ============================================================
-- Visitas a enfermería: registro de notificación a padres/tutor
-- Ejecutar manualmente en el SQL Editor de Supabase ANTES de
-- publicar el cambio de visitas.html / api/expediente.js.
-- Solo agrega columnas; no modifica datos existentes.
-- ============================================================

alter table visitas_enfermeria
  -- null = visita registrada antes de existir este campo (se desconoce)
  add column if not exists padres_notificados    boolean,
  add column if not exists notificacion_medio    text,   -- LLAMADA | MENSAJE | PRESENCIAL | RECADO
  add column if not exists notificacion_contacto text,   -- a quién se notificó (nombre / parentesco)
  add column if not exists notificacion_hora     text;   -- 'HH:MM'
