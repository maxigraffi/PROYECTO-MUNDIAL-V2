-- ════════════════════════════════════════════════════
--  MIGRACIÓN: Agregar autenticación a players
--  Ejecutar en: Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════

-- 1. Agregar columnas de auth a players
alter table players add column if not exists email      text unique;
alter table players add column if not exists auth_user_id uuid unique;
alter table players add column if not exists is_admin   boolean not null default false;

-- 2. Borrar jugadores de ejemplo (no tienen cuenta auth)
--    ATENCIÓN: solo correr si todavía no hay trades/órdenes reales
delete from orders where player_id in ('JUGADOR1','JUGADOR2','JUGADOR3');
delete from trades where buyer_id  in ('JUGADOR1','JUGADOR2','JUGADOR3')
                      or seller_id in ('JUGADOR1','JUGADOR2','JUGADOR3');
delete from players where id in ('JUGADOR1','JUGADOR2','JUGADOR3');

-- 3. IMPORTANTE: Desactivar confirmación de email en Supabase
--    Authentication → Email → "Confirm email" → OFF
--    (así los jugadores pueden entrar directo sin confirmar)
