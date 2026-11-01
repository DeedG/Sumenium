-- Fiche de faction : usines et projets communautaires souhaités (indicatifs, listes d'id en JSON)
ALTER TABLE factions ADD COLUMN usines_souhaitees TEXT NOT NULL DEFAULT '[]';
ALTER TABLE factions ADD COLUMN projets_souhaites TEXT NOT NULL DEFAULT '[]';

-- Rang de chaque faction au tirage, tour par tour (factions.tirage reste l'ordre du tour en cours)
CREATE TABLE tirages (
  tour       INTEGER NOT NULL,
  faction_id INTEGER NOT NULL,
  rang       INTEGER NOT NULL,
  PRIMARY KEY (tour, faction_id)
);
-- 1er tour : le dernier rang inscrit à l'historique avant le passage au 2e tour (sinon le rang actuel)
INSERT INTO tirages (tour, faction_id, rang)
SELECT 1, f.id, COALESCE((SELECT json_extract(a.after, '$.tirage') FROM audit a
    WHERE a.entity = 'factions' AND a.entity_id = CAST(f.id AS TEXT) AND json_extract(a.after, '$.tirage') IS NOT NULL
      AND a.ts < (SELECT MIN(b.ts) FROM audit b WHERE b.entity = 'settings' AND b.entity_id = 'usine_tour' AND json_extract(b.after, '$.value') = '2')
    ORDER BY a.ts DESC, a.id DESC LIMIT 1), f.tirage)
FROM factions f WHERE f.deleted = 0 AND f.tirage IS NOT NULL;
-- tour en cours (s'il a dépassé le 1er) : le rang actuel
INSERT OR REPLACE INTO tirages (tour, faction_id, rang)
SELECT CAST(s.value AS INTEGER), f.id, f.tirage FROM factions f, settings s
WHERE s.key = 'usine_tour' AND CAST(s.value AS INTEGER) > 1 AND f.deleted = 0 AND f.tirage IS NOT NULL;
