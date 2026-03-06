CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  invite_code TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS league_members (
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (league_id, user_id)
);

CREATE TABLE IF NOT EXISTS races (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  circuit_name TEXT NOT NULL,
  external_round INT,
  race_date TIMESTAMPTZ NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'locked', 'completed')),
  tie_breaker_value TEXT,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS race_leagues (
  race_id UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (race_id, league_id)
);

ALTER TABLE races
ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE races
ADD COLUMN IF NOT EXISTS external_round INT;

CREATE TABLE IF NOT EXISTS pick_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_order INT NOT NULL,
  is_position_based BOOLEAN NOT NULL DEFAULT FALSE,
  exact_points INT NOT NULL DEFAULT 10,
  partial_points INT NOT NULL DEFAULT 0,
  UNIQUE (race_id, name)
);

CREATE TABLE IF NOT EXISTS race_drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  driver_name TEXT NOT NULL,
  team_name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  display_order INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (race_id, driver_name)
);

ALTER TABLE race_drivers
ADD COLUMN IF NOT EXISTS team_name TEXT;

ALTER TABLE race_drivers
ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES pick_categories(id) ON DELETE CASCADE,
  value_text TEXT,
  value_number INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (race_id, league_id, user_id, category_id)
);

ALTER TABLE picks
ADD COLUMN IF NOT EXISTS league_id UUID REFERENCES leagues(id) ON DELETE CASCADE;

UPDATE picks p
SET league_id = r.league_id
FROM races r
WHERE p.race_id = r.id
  AND p.league_id IS NULL;

ALTER TABLE picks
ALTER COLUMN league_id SET NOT NULL;

ALTER TABLE picks
DROP CONSTRAINT IF EXISTS picks_race_id_user_id_category_id_key;

ALTER TABLE picks
DROP CONSTRAINT IF EXISTS picks_race_id_league_id_user_id_category_id_key;

ALTER TABLE picks
ADD CONSTRAINT picks_race_id_league_id_user_id_category_id_key UNIQUE (race_id, league_id, user_id, category_id);

CREATE TABLE IF NOT EXISTS results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES pick_categories(id) ON DELETE CASCADE,
  value_text TEXT,
  value_number INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (race_id, category_id)
);

CREATE TABLE IF NOT EXISTS scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  race_id UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  points INT NOT NULL DEFAULT 0,
  tie_breaker_delta INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (league_id, user_id, race_id)
);

ALTER TABLE scores
ADD COLUMN IF NOT EXISTS league_id UUID REFERENCES leagues(id) ON DELETE CASCADE;

UPDATE scores s
SET league_id = r.league_id
FROM races r
WHERE s.race_id = r.id
  AND s.league_id IS NULL;

ALTER TABLE scores
ALTER COLUMN league_id SET NOT NULL;

ALTER TABLE scores
DROP CONSTRAINT IF EXISTS scores_user_id_race_id_key;

ALTER TABLE scores
DROP CONSTRAINT IF EXISTS scores_league_id_user_id_race_id_key;

ALTER TABLE scores
ADD CONSTRAINT scores_league_id_user_id_race_id_key UNIQUE (league_id, user_id, race_id);

INSERT INTO race_leagues (race_id, league_id)
SELECT id, league_id
FROM races
ON CONFLICT (race_id, league_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  race_id UUID REFERENCES races(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('push_subscribed', 'deadline_reminder')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_races_league_date ON races(league_id, race_date);
CREATE INDEX IF NOT EXISTS idx_picks_race_user ON picks(race_id, user_id);
CREATE INDEX IF NOT EXISTS idx_picks_race_league_user ON picks(race_id, league_id, user_id);
CREATE INDEX IF NOT EXISTS idx_scores_race ON scores(race_id);
CREATE INDEX IF NOT EXISTS idx_scores_race_league ON scores(race_id, league_id);
CREATE INDEX IF NOT EXISTS idx_race_drivers_race ON race_drivers(race_id, display_order);
