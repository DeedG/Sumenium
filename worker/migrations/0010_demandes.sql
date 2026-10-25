-- Demandes faites depuis le site, validées par le staff
CREATE TABLE faction_demandes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  theme      TEXT NOT NULL DEFAULT '',
  couleur    TEXT NOT NULL DEFAULT 'white',      -- couleur d'équipe Minecraft
  membres    TEXT NOT NULL DEFAULT '[]',         -- pseudos (JSON), le premier sera chef
  player_id  INTEGER NOT NULL REFERENCES players(id),
  statut     TEXT NOT NULL DEFAULT 'attente',    -- attente | acceptee | refusee | annulee
  reponse    TEXT NOT NULL DEFAULT '',
  faction_id INTEGER,                            -- faction créée à l'acceptation
  ts         INTEGER NOT NULL DEFAULT 0,
  updated    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE projet_demandes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  projet_id  INTEGER NOT NULL REFERENCES projets(id),
  faction_id INTEGER NOT NULL REFERENCES factions(id),
  player_id  INTEGER NOT NULL REFERENCES players(id),
  note       TEXT NOT NULL DEFAULT '',
  statut     TEXT NOT NULL DEFAULT 'attente',    -- attente | acceptee | refusee | annulee
  reponse    TEXT NOT NULL DEFAULT '',
  ts         INTEGER NOT NULL DEFAULT 0,
  updated    INTEGER NOT NULL DEFAULT 0
);
-- Création de factions par les joueurs : fermée tant que les factions existantes ne sont pas pleines
INSERT OR IGNORE INTO settings (key, value) VALUES ('factions_ouvertes', '0');
