-- Formulaire de contact du site (mentions légales, RGPD) : messages lus par le staff dans ses outils
CREATE TABLE contact (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  sujet       TEXT NOT NULL,
  nom         TEXT NOT NULL DEFAULT '',
  reponse     TEXT NOT NULL DEFAULT '',   -- comment répondre (pseudo Discord, e-mail…), facultatif
  message     TEXT NOT NULL,
  discord_id  TEXT,                       -- si l'auteur était connecté
  ip_hash     TEXT,                       -- empreinte de l'adresse IP (anti-abus), effacée après 30 jours
  traite      INTEGER NOT NULL DEFAULT 0,
  traite_par  TEXT NOT NULL DEFAULT '',
  traite_ts   INTEGER
);
CREATE INDEX contact_ts ON contact(ts DESC);
CREATE INDEX contact_ip ON contact(ip_hash, ts);
