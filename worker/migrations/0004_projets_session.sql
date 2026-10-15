-- Connexion persistante : jeton Discord de renouvellement, pour revérifier les rôles sans redemander la connexion
ALTER TABLE users ADD COLUMN refresh_token TEXT;

-- Projets communautaires (débloquent une usine en plus)
CREATE TABLE projets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nom        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tailles    TEXT NOT NULL DEFAULT 'petite',   -- tailles d'usine possibles : "moyenne,petite", "petite", "moyenne"
  unique_srv INTEGER NOT NULL DEFAULT 0,        -- 1 : une seule faction peut le réaliser sur tout le serveur
  illimite   INTEGER NOT NULL DEFAULT 0,        -- 1 : réalisable plusieurs fois par la même faction
  ordre      INTEGER NOT NULL DEFAULT 0,
  deleted    INTEGER NOT NULL DEFAULT 0
);
INSERT INTO projets (nom, tailles, unique_srv, illimite, ordre) VALUES
 ('Mairie', 'moyenne,petite', 1, 0, 1),
 ('Tribunal', 'moyenne,petite', 1, 0, 2),
 ('Restaurant', 'moyenne,petite', 0, 0, 3),
 ('Musée', 'moyenne,petite', 1, 0, 4),
 ('Hub nether', 'moyenne,petite', 1, 0, 5),
 ('Couloirs nether', 'petite', 0, 0, 6),
 ('Fourniture de ressources', 'petite', 0, 0, 7),
 ('Aide à une autre faction', 'petite', 0, 0, 8),
 ('Beacon full au spawn', 'petite', 0, 0, 9),
 ('Routes du spawn', 'petite', 0, 0, 10),
 ('Éclairage du spawn', 'petite', 0, 0, 11),
 ('Organisation d''un évènement', 'moyenne', 0, 1, 12),
 ('Hôtel des ventes', 'moyenne,petite', 1, 0, 13);

-- Projets validés (par le staff, après le ticket Discord)
CREATE TABLE projet_faction (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  projet_id  INTEGER NOT NULL REFERENCES projets(id),
  faction_id INTEGER NOT NULL REFERENCES factions(id),
  usine_id   INTEGER REFERENCES usines(id),
  note       TEXT NOT NULL DEFAULT '',
  ts         INTEGER NOT NULL DEFAULT 0,
  deleted    INTEGER NOT NULL DEFAULT 0,
  updated    INTEGER NOT NULL DEFAULT 0
);

-- Une usine obtenue grâce à un projet est rattachée à ce projet
ALTER TABLE usine_choix ADD COLUMN projet_faction_id INTEGER;
