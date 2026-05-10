-- ════════════════════════════════════════════════════
--  OTC TOURNAMENT OPTIONS MARKET — Supabase Schema
--  Ejecutar en: Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════

-- ── TABLAS ──────────────────────────────────────────

create table if not exists players (
  id          text primary key,
  name        text not null,
  created_at  timestamptz default now()
);

create table if not exists teams (
  id             text primary key,
  name           text not null,
  flag           text default '🏳️',
  auction_price  numeric(10,2) default 0,
  final_pos      int  default null,
  display_order  int  default 0,
  created_at     timestamptz default now()
);

create table if not exists prizes (
  position  int primary key check (position > 0),
  amount    bigint not null default 0
);

create table if not exists game_settings (
  key    text primary key,
  value  text not null
);

create table if not exists orders (
  id          bigserial primary key,
  created_at  timestamptz default now(),
  player_id   text not null references players(id)  on delete cascade,
  team_id     text not null references teams(id)    on delete cascade,
  side        text not null check (side in ('BUY', 'SELL')),
  price       numeric(10,2) not null check (price > 0),
  orig_qty    int not null check (orig_qty > 0),
  rem_qty     int not null check (rem_qty >= 0),
  status      text not null default 'live' check (status in ('live', 'filled', 'cancelled'))
);

create table if not exists trades (
  id             bigserial primary key,
  created_at     timestamptz default now(),
  buy_order_id   bigint not null references orders(id),
  sell_order_id  bigint not null references orders(id),
  buyer_id       text not null references players(id),
  seller_id      text not null references players(id),
  team_id        text not null references teams(id) on delete cascade,
  qty            int not null check (qty > 0),
  price          numeric(10,2) not null check (price > 0),
  annulled       boolean not null default false
);

-- ── ÍNDICES ─────────────────────────────────────────

create index if not exists idx_orders_team   on orders (team_id, status);
create index if not exists idx_orders_player on orders (player_id);
create index if not exists idx_trades_team   on trades (team_id);
create index if not exists idx_trades_buyer  on trades (buyer_id);
create index if not exists idx_trades_seller on trades (seller_id);

-- ── ROW LEVEL SECURITY ──────────────────────────────
-- Acceso público con la anon key (correcto para un torneo cerrado/privado)
-- Si necesitás restringir, agregá auth.uid() checks aquí

alter table players      enable row level security;
alter table teams        enable row level security;
alter table prizes       enable row level security;
alter table game_settings enable row level security;
alter table orders       enable row level security;
alter table trades       enable row level security;

create policy "Public read-write" on players       for all using (true) with check (true);
create policy "Public read-write" on teams         for all using (true) with check (true);
create policy "Public read-write" on prizes        for all using (true) with check (true);
create policy "Public read-write" on game_settings for all using (true) with check (true);
create policy "Public read-write" on orders        for all using (true) with check (true);
create policy "Public read-write" on trades        for all using (true) with check (true);

-- ── HABILITAR REALTIME ──────────────────────────────
-- En Supabase Dashboard → Database → Replication
-- activar las tablas: orders, trades, game_settings, teams, players, prizes
-- O ejecutar:
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table trades;
alter publication supabase_realtime add table game_settings;
alter publication supabase_realtime add table teams;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table prizes;

-- ── DATOS INICIALES ─────────────────────────────────

insert into game_settings (key, value) values
  ('game_state', 'open'),
  ('min_qty',    '1'),
  ('max_qty',    '5')
on conflict (key) do nothing;

-- Premios en pesos (modificar según el torneo)
insert into prizes (position, amount) values
  (1,  320000), (2,  152000), (3,  86000), (4,  86000),
  (5,   40000), (6,   40000), (7,  40000), (8,  40000),
  (9,       0), (10,      0), (11,     0), (12,     0),
  (13,      0), (14,      0), (15,     0), (16,     0)
on conflict (position) do nothing;

-- Equipos (Torneo Argentino — personalizar a gusto)
insert into teams (id, name, flag, auction_price, display_order) values
  ('RIV', 'River Plate',        '🌊', 38, 1),
  ('BCA', 'Boca Juniors',       '⚓', 35, 2),
  ('RAC', 'Racing Club',        '⚡', 28, 3),
  ('IND', 'Independiente',      '🔴', 22, 4),
  ('EST', 'Estudiantes',        '📚', 20, 5),
  ('VEL', 'Vélez Sársfield',    '💫', 18, 6),
  ('TAL', 'Talleres',           '🔧', 17, 7),
  ('SLO', 'San Lorenzo',        '🔵', 16, 8),
  ('HUR', 'Huracán',            '🌀', 15, 9),
  ('CEN', 'Rosario Central',    '🌹', 14, 10),
  ('BEL', 'Belgrano',           '⚓', 13, 11),
  ('LAN', 'Lanús',              '🔩', 12, 12),
  ('AJR', 'Argentinos Juniors', '🐜', 11, 13),
  ('GLP', 'Gimnasia LP',        '🎓', 10, 14),
  ('IRV', 'Ind. Rivadavia',     '🍇',  8, 15),
  ('UNI', 'Unión',              '🤝',  7, 16)
on conflict (id) do nothing;

-- Jugadores de ejemplo (reemplazar con los reales)
insert into players (id, name) values
  ('JUGADOR1', 'Jugador 1'),
  ('JUGADOR2', 'Jugador 2'),
  ('JUGADOR3', 'Jugador 3')
on conflict (id) do nothing;
