-- Journal des transactions du mod Sumenium Economy (copie privée : historique de chaque joueur)
-- Montants en CENTIMES, comme dans le journal du mod.
CREATE TABLE tx (
  id       TEXT PRIMARY KEY,      -- empreinte de la ligne du journal (évite les doublons)
  t        INTEGER NOT NULL,      -- horodatage en ms
  type     TEXT NOT NULL,
  actor    TEXT,                  -- uuid du joueur à l'origine
  from_acc TEXT,                  -- "joueur:<uuid>", "faction:<id>", "fisc" ou null
  to_acc   TEXT,
  item     TEXT,
  data     TEXT NOT NULL          -- la ligne d'origine (JSON)
);
CREATE INDEX tx_t ON tx(t DESC);
CREATE INDEX tx_actor ON tx(actor, t DESC);
CREATE INDEX tx_from ON tx(from_acc, t DESC);
CREATE INDEX tx_to ON tx(to_acc, t DESC);
