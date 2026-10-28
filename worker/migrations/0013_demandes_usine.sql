-- Usine demandée par la faction avec sa demande de validation, et usine finalement validée par le staff
ALTER TABLE projet_demandes ADD COLUMN usine_id INTEGER REFERENCES usines(id);
ALTER TABLE projet_demandes ADD COLUMN usine_validee INTEGER REFERENCES usines(id);
-- Demandes déjà validées : l'usine débloquée par le projet correspondant
UPDATE projet_demandes SET usine_validee = (SELECT pf.usine_id FROM projet_faction pf WHERE pf.projet_id = projet_demandes.projet_id
  AND pf.faction_id = projet_demandes.faction_id AND pf.deleted = 0 ORDER BY pf.id DESC LIMIT 1) WHERE statut = 'acceptee';
