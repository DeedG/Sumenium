-- Qui a traité une demande (pseudo Discord du staff) : affiché dans le détail des demandes
ALTER TABLE projet_demandes ADD COLUMN traite_par TEXT NOT NULL DEFAULT '';
ALTER TABLE faction_demandes ADD COLUMN traite_par TEXT NOT NULL DEFAULT '';
-- Demandes déjà traitées : on le retrouve dans l'historique des modifications
UPDATE projet_demandes SET traite_par = COALESCE((SELECT a.actor_name FROM audit a WHERE a.entity = 'projet_demandes'
  AND a.entity_id = CAST(projet_demandes.id AS TEXT) AND json_extract(a.after, '$.statut') IN ('acceptee', 'refusee', 'a_completer')
  ORDER BY a.id DESC LIMIT 1), '') WHERE statut IN ('acceptee', 'refusee', 'a_completer');
UPDATE faction_demandes SET traite_par = COALESCE((SELECT a.actor_name FROM audit a WHERE a.entity = 'faction_demandes'
  AND a.entity_id = CAST(faction_demandes.id AS TEXT) AND json_extract(a.after, '$.statut') IN ('acceptee', 'refusee')
  ORDER BY a.id DESC LIMIT 1), '') WHERE statut IN ('acceptee', 'refusee');
