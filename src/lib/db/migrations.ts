// Migrazioni del database. Ogni migrazione viene applicata una sola volta, in ordine,
// e registrata in schema_migrations. Non modificare una migrazione già rilasciata:
// aggiungine una nuova.

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "schema_iniziale",
    sql: /* sql */ `
-- ============ Utenti e sessioni (dati personali) ============
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                 -- sha256 del token (il token in chiaro sta solo nel cookie)
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

-- ============ Dati pubblici del campionato ============
CREATE TABLE seasons (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,           -- es. 2026-27
  label TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  is_current INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE teams (
  id INTEGER PRIMARY KEY,
  season_code TEXT NOT NULL,
  canonical_key TEXT NOT NULL,         -- chiave normalizzata (es. inter, milan)
  name TEXT NOT NULL,
  short_name TEXT,
  tactical_notes TEXT,                 -- note tattiche inserite manualmente
  tactical_notes_source TEXT,
  tactical_notes_updated_at TEXT,
  UNIQUE(season_code, canonical_key)
);

CREATE TABLE team_external_ids (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  PRIMARY KEY (source, external_id)
);

CREATE TABLE matches (
  id INTEGER PRIMARY KEY,
  season_code TEXT NOT NULL,
  matchday INTEGER NOT NULL,
  home_team_id INTEGER NOT NULL REFERENCES teams(id),
  away_team_id INTEGER NOT NULL REFERENCES teams(id),
  kickoff_utc TEXT,                    -- ISO 8601 UTC
  kickoff_time_known INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'programmata'
    CHECK (status IN ('programmata','in_corso','terminata','rinviata','sospesa','annullata')),
  home_goals INTEGER,
  away_goals INTEGER,
  source TEXT NOT NULL,                -- fonte con precedenza più alta che ha fornito il dato
  source_priority INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT NOT NULL,
  UNIQUE(season_code, home_team_id, away_team_id)
);
CREATE INDEX matches_md ON matches(season_code, matchday);
CREATE INDEX matches_kickoff ON matches(kickoff_utc);

CREATE TABLE match_external_ids (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  PRIMARY KEY (source, external_id)
);

CREATE TABLE team_advanced_stats (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season_code TEXT NOT NULL,
  source TEXT NOT NULL,
  as_of TEXT NOT NULL,
  matches INTEGER,
  xg_for REAL,
  xg_against REAL,
  shots_for INTEGER,
  shots_against INTEGER,
  clean_sheets INTEGER,
  UNIQUE(team_id, season_code, source)
);

-- ============ Giocatori (catalogo) ============
CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  name_key TEXT NOT NULL,              -- nome normalizzato per ricerca/abbinamento
  birth_date TEXT,
  role_classic TEXT CHECK (role_classic IN ('P','D','C','A')),
  role_classic_source TEXT,            -- listone, posizione reale (stimato), manuale
  roles_mantra TEXT,                   -- ruoli Mantra separati da ;
  real_position TEXT,
  current_team_id INTEGER REFERENCES teams(id),
  status TEXT NOT NULL DEFAULT 'da_verificare'
    CHECK (status IN ('disponibile','in_dubbio','infortunato','squalificato','da_verificare','fuori_rosa')),
  status_source TEXT,
  status_updated_at TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('api','import','manuale')),
  official_verified INTEGER NOT NULL DEFAULT 0,  -- 1 = associato a un identificativo di una fonte
  last_verified_at TEXT,
  penalty_order INTEGER,               -- 1 = primo rigorista, 2 = secondo (indicazione manuale)
  penalty_order_source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX players_name_key ON players(name_key);
CREATE INDEX players_team ON players(current_team_id);

CREATE TABLE player_external_ids (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  PRIMARY KEY (source, external_id)
);
CREATE INDEX player_ext_player ON player_external_ids(player_id);

CREATE TABLE player_team_history (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  from_team_id INTEGER REFERENCES teams(id),
  to_team_id INTEGER REFERENCES teams(id),
  changed_at TEXT NOT NULL,
  source TEXT NOT NULL
);

-- ============ Rosa personale ============
CREATE TABLE roster_entries (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  added_at TEXT NOT NULL,
  removed_at TEXT,                     -- rimozione logica: lo storico resta
  purchase_price INTEGER,
  notes TEXT
);
CREATE UNIQUE INDEX roster_active ON roster_entries(user_id, player_id) WHERE removed_at IS NULL;

CREATE TABLE roster_changes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id),
  action TEXT NOT NULL CHECK (action IN ('aggiunto','rimosso','modificato','sostituito','trasferimento')),
  details TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE league_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  config TEXT NOT NULL,
  is_provisional INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- ============ Statistiche ============
CREATE TABLE player_season_stats (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season_code TEXT NOT NULL,
  source TEXT NOT NULL,
  as_of TEXT NOT NULL,
  appearances INTEGER,                 -- presenze (con voto, se la fonte è fantacalcistica)
  starts INTEGER,
  minutes INTEGER,
  avg_vote REAL,
  avg_fantavote REAL,
  goals INTEGER,                       -- gol totali, rigori compresi
  goals_conceded INTEGER,
  assists INTEGER,
  penalties_taken INTEGER,
  penalties_scored INTEGER,
  penalties_missed INTEGER,
  penalties_saved INTEGER,
  yellow_cards INTEGER,
  red_cards INTEGER,
  own_goals INTEGER,
  xg REAL,
  xa REAL,
  shots INTEGER,
  shots_on_target INTEGER,
  key_passes INTEGER,
  UNIQUE(player_id, season_code, source)
);

CREATE TABLE player_match_stats (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season_code TEXT NOT NULL,
  matchday INTEGER NOT NULL,
  match_id INTEGER REFERENCES matches(id),
  team_id INTEGER REFERENCES teams(id),
  source TEXT NOT NULL,
  played INTEGER,
  started INTEGER,
  minutes INTEGER,
  vote REAL,                           -- NULL = senza voto
  fantavote REAL,
  goals INTEGER DEFAULT 0,             -- gol su azione (i rigori segnati sono in pen_scored)
  goals_conceded INTEGER DEFAULT 0,
  assists INTEGER DEFAULT 0,
  yellow INTEGER DEFAULT 0,
  red INTEGER DEFAULT 0,
  own_goals INTEGER DEFAULT 0,
  pen_scored INTEGER DEFAULT 0,
  pen_missed INTEGER DEFAULT 0,
  pen_saved INTEGER DEFAULT 0,
  xg REAL,
  xa REAL,
  shots INTEGER,
  imported_at TEXT NOT NULL,
  UNIQUE(player_id, season_code, matchday, source)
);
CREATE INDEX pms_player ON player_match_stats(player_id, season_code);

-- ============ Disponibilità e formazioni ============
CREATE TABLE availability_reports (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('infortunio','squalifica','diffida','malattia','altro')),
  certainty TEXT NOT NULL CHECK (certainty IN ('confermato','dubbio','in_recupero','indiscrezione')),
  description TEXT,
  expected_return TEXT,                -- solo se comunicata dalla fonte
  source TEXT NOT NULL,
  url TEXT,
  reported_at TEXT NOT NULL,
  resolved_at TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('manuale','api','rss')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX avail_player ON availability_reports(player_id, resolved_at);

CREATE TABLE lineup_reports (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('probabile','ufficiale')),
  status TEXT NOT NULL CHECK (status IN ('titolare','ballottaggio','panchina','non_convocato','indisponibile')),
  probability REAL,                    -- es. 0.6 per un ballottaggio 60/40
  url TEXT,
  reported_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('manuale','api')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(match_id, player_id, source, kind)
);

-- ============ Fonti editoriali e notizie ============
CREATE TABLE editorial_opinions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season_code TEXT NOT NULL,
  matchday INTEGER,
  source TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('consigliato','schierabile','neutrale','rischioso','sconsigliato')),
  explicit_advice INTEGER NOT NULL DEFAULT 1,  -- 0 = la fonte riporta solo dati/notizie
  summary TEXT,
  url TEXT,
  published_at TEXT,
  story_key TEXT,                      -- stessa notizia ripresa da più fonti
  origin TEXT NOT NULL DEFAULT 'manuale',
  created_at TEXT NOT NULL
);
CREATE INDEX ed_player ON editorial_opinions(player_id, season_code, matchday);

CREATE TABLE news_items (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  guid TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  url TEXT,
  published_at TEXT,
  categories TEXT,
  summary TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE news_mentions (
  news_id INTEGER NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  confidence TEXT NOT NULL CHECK (confidence IN ('alta','media')),
  PRIMARY KEY (news_id, player_id)
);

-- ============ Connettori, sincronizzazioni, cache ============
CREATE TABLE connector_status (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT,
  last_test_at TEXT,
  last_test_ok INTEGER,
  last_test_message TEXT,
  usage_note TEXT
);

CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY,
  trigger TEXT NOT NULL CHECK (trigger IN ('manuale','automatico','cron')),
  scope TEXT NOT NULL,
  reason TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('in_corso','ok','parziale','errore')),
  summary TEXT
);

CREATE TABLE http_cache (
  key TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE data_discrepancies (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  field TEXT NOT NULL,
  source_a TEXT NOT NULL,
  value_a TEXT,
  source_b TEXT NOT NULL,
  value_b TEXT,
  detected_at TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  UNIQUE(entity, entity_id, field, source_a, source_b)
);

-- ============ Previsioni del modello ============
CREATE TABLE evaluations (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  season_code TEXT NOT NULL,
  matchday INTEGER NOT NULL,
  match_id INTEGER REFERENCES matches(id),
  computed_at TEXT NOT NULL,
  model_version TEXT NOT NULL,
  data_version INTEGER NOT NULL,
  fantavalue INTEGER,
  expected_points REAL,
  p_start REAL,
  p_vote REAL,
  p_goal REAL,
  p_assist REAL,
  p_yellow REAL,
  p_red REAL,
  reliability TEXT,
  payload TEXT NOT NULL,               -- valutazione completa (JSON)
  is_latest INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX eval_lookup ON evaluations(user_id, season_code, matchday, is_latest);
CREATE INDEX eval_player ON evaluations(player_id, season_code, matchday);

CREATE TABLE evaluation_changes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  season_code TEXT NOT NULL,
  matchday INTEGER NOT NULL,
  changed_at TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  significant INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX evch_lookup ON evaluation_changes(user_id, season_code, matchday);

CREATE TABLE lineup_recommendations (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_code TEXT NOT NULL,
  matchday INTEGER NOT NULL,
  strategy TEXT NOT NULL,
  module TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  model_version TEXT NOT NULL,
  data_version INTEGER NOT NULL,
  expected_points REAL,
  payload TEXT NOT NULL
);
CREATE INDEX rec_lookup ON lineup_recommendations(user_id, season_code, matchday, strategy);

CREATE TABLE saved_lineups (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_code TEXT NOT NULL,
  matchday INTEGER NOT NULL,
  module TEXT NOT NULL,
  starters TEXT NOT NULL,              -- JSON array di player_id
  bench TEXT NOT NULL,                 -- JSON array ordinato di player_id
  recommendation_id INTEGER REFERENCES lineup_recommendations(id),
  strategy TEXT,
  expected_points REAL,
  saved_at TEXT NOT NULL,
  notes TEXT,
  UNIQUE(user_id, season_code, matchday)
);

CREATE TABLE matchday_results (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_code TEXT NOT NULL,
  matchday INTEGER NOT NULL,
  saved_lineup_id INTEGER REFERENCES saved_lineups(id) ON DELETE SET NULL,
  actual_points REAL,
  expected_points REAL,
  details TEXT,
  computed_at TEXT NOT NULL,
  UNIQUE(user_id, season_code, matchday)
);

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  file_name TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('anteprima','applicato','annullato')),
  payload TEXT NOT NULL
);
`,
  },
];
