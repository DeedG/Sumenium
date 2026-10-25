-- Images jointes à une demande de validation de projet (preuves), visibles par le staff et la faction
CREATE TABLE projet_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  demande_id INTEGER NOT NULL REFERENCES projet_demandes(id),
  mime       TEXT NOT NULL,
  data       BLOB NOT NULL,
  ts         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX projet_images_demande ON projet_images (demande_id);
