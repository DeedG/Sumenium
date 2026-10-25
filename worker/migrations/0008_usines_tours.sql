-- Usines : chaque choix garde son tour (1er tour avant le lancement, 2e tour trois semaines après…).
-- Les choix déjà faits datent du 1er tour.
ALTER TABLE usine_choix ADD COLUMN tour INTEGER NOT NULL DEFAULT 1;
INSERT OR IGNORE INTO settings (key, value) VALUES ('usine_tour', '1');
