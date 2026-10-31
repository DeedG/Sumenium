-- Historique d'une boutique : recherche des lignes du journal par boutique
CREATE INDEX IF NOT EXISTS tx_shop ON tx(json_extract(data, '$.shop'));
