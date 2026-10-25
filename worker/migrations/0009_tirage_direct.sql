-- Taille RP : le joueur peut refuser de changer de taille en jeu
ALTER TABLE players ADD COLUMN taille_fixe INTEGER NOT NULL DEFAULT 0;

-- Choix d'usines tour par tour : une faction « a fini » son tour quand elle valide (ou que le staff la passe)
CREATE TABLE usine_fini (
  faction_id INTEGER NOT NULL REFERENCES factions(id),
  tour       INTEGER NOT NULL,
  ts         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (faction_id, tour)
);
-- Le 1er tour a déjà eu lieu : toutes les factions qui ont choisi l'ont terminé
INSERT OR IGNORE INTO usine_fini (faction_id, tour, ts)
  SELECT DISTINCT faction_id, 1, 0 FROM usine_choix WHERE projet_faction_id IS NULL AND tour = 1;
