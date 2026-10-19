-- Affiche (image) des candidatures à la mairie, envoyée depuis l'Espace (déjà réduite par le navigateur).
CREATE TABLE affiches (
  candidat_id INTEGER PRIMARY KEY REFERENCES candidats(id),
  mime        TEXT NOT NULL,
  data        BLOB NOT NULL,
  updated     INTEGER NOT NULL
);
