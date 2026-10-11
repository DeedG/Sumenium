-- Espace Suménium : schéma initial

CREATE TABLE users (
  discord_id   TEXT PRIMARY KEY,
  discord_name TEXT NOT NULL,
  avatar       TEXT,
  level        TEXT NOT NULL,          -- attente | sumenien | staff
  last_login   INTEGER NOT NULL
);

-- Fiche joueur (peut exister avant que le joueur se connecte : données importées)
CREATE TABLE players (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  mc_name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  discord_id    TEXT UNIQUE,
  faction_id    INTEGER REFERENCES factions(id),
  metier        TEXT NOT NULL DEFAULT '',
  metier_desc   TEXT NOT NULL DEFAULT '',
  perso_desc    TEXT NOT NULL DEFAULT '',
  activite      TEXT NOT NULL DEFAULT '',
  mort          TEXT NOT NULL DEFAULT '',  -- oui | sauf1 | sauf1_accord | accord | non
  taille_cm     INTEGER,
  taille_appliquee REAL,                   -- valeur appliquée en jeu par le staff
  deleted       INTEGER NOT NULL DEFAULT 0,
  updated       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE factions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  theme          TEXT NOT NULL DEFAULT '',
  hub            TEXT NOT NULL DEFAULT '',
  projet_commu   TEXT NOT NULL DEFAULT '',
  autres_projets TEXT NOT NULL DEFAULT '',
  recrutement    TEXT NOT NULL DEFAULT '',
  tirage         INTEGER,                  -- ordre au tirage au sort des usines
  deleted        INTEGER NOT NULL DEFAULT 0,
  updated        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE usines (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  nom     TEXT NOT NULL UNIQUE,
  taille  TEXT NOT NULL,                   -- grosse | moyenne | petite
  ordre   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE usine_choix (
  faction_id INTEGER NOT NULL REFERENCES factions(id),
  usine_id   INTEGER NOT NULL REFERENCES usines(id),
  PRIMARY KEY (faction_id, usine_id)
);

CREATE TABLE prix (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  minerai TEXT NOT NULL,
  roche   TEXT NOT NULL DEFAULT '',
  prix    REAL NOT NULL DEFAULT 0,
  ordre   INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE bases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  faction_id INTEGER NOT NULL REFERENCES factions(id),
  type       TEXT NOT NULL DEFAULT 'base',  -- hub | usine | base
  nom        TEXT NOT NULL DEFAULT '',
  x INTEGER, y INTEGER, z INTEGER,
  deleted    INTEGER NOT NULL DEFAULT 0,
  updated    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE candidats (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id),
  resume    TEXT NOT NULL DEFAULT '',
  lien      TEXT NOT NULL DEFAULT '',
  affiche   TEXT NOT NULL DEFAULT '',
  tour2     INTEGER NOT NULL DEFAULT 0,     -- qualifié pour le 2nd tour
  deleted   INTEGER NOT NULL DEFAULT 0,
  updated   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE votes (
  tour        INTEGER NOT NULL,
  discord_id  TEXT NOT NULL,
  candidat_id INTEGER NOT NULL,
  ts          INTEGER NOT NULL,
  PRIMARY KEY (tour, discord_id)
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('election', 'candidatures'),            -- fermee | candidatures | tour1 | tour2 | resultats
  ('usines_ouvertes', '1'),
  ('usines_max', '3');

CREATE TABLE whitelist (
  mc_name TEXT PRIMARY KEY COLLATE NOCASE,
  uuid    TEXT
);

CREATE TABLE audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,
  actor_id   TEXT,
  actor_name TEXT,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  action     TEXT NOT NULL,
  before     TEXT,
  after      TEXT,
  reverted   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX audit_ts ON audit(ts DESC);
CREATE INDEX players_faction ON players(faction_id);
