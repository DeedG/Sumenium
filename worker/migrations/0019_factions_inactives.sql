-- Faction inactive (elle a arrêté de jouer) : gardée avec son historique et ses statistiques,
-- mais sortie de l'ordre du tirage, et ses usines ne prennent plus de place sur le serveur.
ALTER TABLE factions ADD COLUMN inactive INTEGER NOT NULL DEFAULT 0;
