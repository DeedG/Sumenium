-- Lien compte Discord ↔ pseudo Minecraft à prouver en jeu (/site lier <code>) quand le pseudo est déjà whitelisté
-- ou qu'une fiche existe déjà : empêche de prendre la fiche (faction, coordonnées, historique) d'un autre joueur.
CREATE TABLE liens (
  discord_id TEXT PRIMARY KEY,
  mc_name    TEXT NOT NULL COLLATE NOCASE,
  code       TEXT NOT NULL,
  ts         INTEGER NOT NULL
);
