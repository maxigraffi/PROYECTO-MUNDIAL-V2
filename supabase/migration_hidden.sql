-- ════════════════════════════════════════════════════
--  MIGRACIÓN: Agregar campo is_hidden a teams
--  Ejecutar en: Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════

alter table teams add column if not exists is_hidden boolean not null default false;
