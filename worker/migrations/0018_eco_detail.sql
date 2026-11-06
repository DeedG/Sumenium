-- Détail de l'économie précalculé par la mise à jour du site (GitHub Actions) : le Worker le sert tel quel,
-- sans relire ni transformer le journal (limite de 10 ms de calcul du plan gratuit Cloudflare).
-- k : staff (complet), public (anonymisé), hors (achats hors circuit, jamais servi). Corps découpé en morceaux (< 2 Mo par valeur).
CREATE TABLE IF NOT EXISTS eco_detail (
  k TEXT NOT NULL,
  part INTEGER NOT NULL,
  body TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (k, part)
);
