-- ════════════════════════════════════════════════════════════
--  OTC TOURNAMENT OPTIONS MARKET — Schema V2 (Multi-torneo)
--  Cada tabla (excepto players) está vinculada a tournament_id
-- ════════════════════════════════════════════════════════════

-- ── TOURNAMENTS ─────────────────────────────────────────────
-- Un torneo es la unidad de aislamiento de datos
CREATE TABLE tournaments (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT        NOT NULL,
  status      TEXT        DEFAULT 'open' CHECK (status IN ('open', 'closed', 'liquidated')),
  admin_id    TEXT,       -- players.id del creador
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── PLAYERS (directorio global de usuarios) ─────────────────
-- Un player puede participar en múltiples torneos
CREATE TABLE players (
  id           TEXT        PRIMARY KEY,   -- generado: "MAXI", "JUANPE", etc.
  name         TEXT        NOT NULL,
  email        TEXT,
  auth_user_id UUID        REFERENCES auth.users(id) UNIQUE,
  is_admin     BOOLEAN     DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ── TOURNAMENT_PLAYERS ──────────────────────────────────────
-- Relación muchos-a-muchos: qué players están en qué torneo
CREATE TABLE tournament_players (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id     TEXT        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  joined_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tournament_id, player_id)
);

-- ── TEAMS ───────────────────────────────────────────────────
-- Cada equipo pertenece a un torneo. UUID como PK, ticker como
-- identificador amigable dentro del torneo.
CREATE TABLE teams (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  ticker        TEXT        NOT NULL,       -- ej: "RIV", "BOC", "MIL"
  name          TEXT        NOT NULL,
  flag          TEXT        DEFAULT '🏳️',
  auction_price NUMERIC     DEFAULT 0,
  final_pos     INT,
  display_order INT         DEFAULT 0,
  is_hidden     BOOLEAN     DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tournament_id, ticker)
);

-- ── PRIZES ──────────────────────────────────────────────────
CREATE TABLE prizes (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  position      INT         NOT NULL,
  amount        NUMERIC     DEFAULT 0,
  UNIQUE(tournament_id, position)
);

-- ── GAME_SETTINGS ───────────────────────────────────────────
CREATE TABLE game_settings (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  key           TEXT        NOT NULL,
  value         TEXT,
  UNIQUE(tournament_id, key)
);

-- ── ORDERS ──────────────────────────────────────────────────
CREATE TABLE orders (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id     TEXT        REFERENCES players(id),
  team_id       UUID        REFERENCES teams(id),
  side          TEXT        NOT NULL CHECK (side IN ('BUY', 'SELL')),
  price         NUMERIC     NOT NULL,
  orig_qty      INT         NOT NULL,
  rem_qty       INT         NOT NULL DEFAULT 0,
  status        TEXT        DEFAULT 'live' CHECK (status IN ('live', 'filled', 'cancelled')),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ── TRADES ──────────────────────────────────────────────────
CREATE TABLE trades (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  buy_order_id  UUID        REFERENCES orders(id),
  sell_order_id UUID        REFERENCES orders(id),
  buyer_id      TEXT        REFERENCES players(id),
  seller_id     TEXT        REFERENCES players(id),
  team_id       UUID        REFERENCES teams(id),
  qty           INT         NOT NULL,
  price         NUMERIC     NOT NULL,
  annulled      BOOLEAN     DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ── INDEXES ─────────────────────────────────────────────────
CREATE INDEX idx_orders_tournament  ON orders(tournament_id, status);
CREATE INDEX idx_orders_team        ON orders(team_id, status);
CREATE INDEX idx_orders_player      ON orders(player_id);
CREATE INDEX idx_trades_tournament  ON trades(tournament_id);
CREATE INDEX idx_trades_team        ON trades(team_id);
CREATE INDEX idx_trades_buyer       ON trades(buyer_id);
CREATE INDEX idx_trades_seller      ON trades(seller_id);
CREATE INDEX idx_teams_tournament   ON teams(tournament_id, display_order);
CREATE INDEX idx_tp_player          ON tournament_players(player_id);
CREATE INDEX idx_tp_tournament      ON tournament_players(tournament_id);

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE tournaments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE players            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams              ENABLE ROW LEVEL SECURITY;
ALTER TABLE prizes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades             ENABLE ROW LEVEL SECURITY;

-- Sistema cerrado: acceso completo para usuarios autenticados
-- El RLS garantiza que usuarios anónimos no puedan leer/escribir
CREATE POLICY "auth_all" ON tournaments        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON players            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON tournament_players FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON teams              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON prizes             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON game_settings      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON orders             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON trades             FOR ALL TO authenticated USING (true) WITH CHECK (true);
