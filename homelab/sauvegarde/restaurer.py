"""Transforme une sauvegarde (sumenium-AAAA-MM-JJ.json.gz) en fichier SQL pour recréer la base D1.

  python3 restaurer.py sauvegardes/sumenium-2026-11-02.json.gz > restauration.sql
  npx wrangler d1 execute sumenium --remote --file restauration.sql     (depuis le dossier worker/, sur une base VIDE)

Contient le schéma (tables, index, migrations déjà appliquées) puis toutes les lignes.
"""
import base64
import gzip
import json
import sys


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, dict) and "$b64" in v:
        return "X'" + base64.b64decode(v["$b64"]).hex() + "'"
    return "'" + str(v).replace("'", "''") + "'"


def main(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        data = json.load(f)
    out = ["PRAGMA defer_foreign_keys = true;"]
    out += [x["sql"].rstrip(";") + ";" for x in data["schema"] if x["type"] == "table"]
    for t, rows in data["tables"].items():
        for r in rows:
            r = {k: v for k, v in r.items() if k != "__rowid"}
            out.append(f'INSERT INTO "{t}" ({", ".join(chr(34) + k + chr(34) for k in r)}) VALUES ({", ".join(lit(v) for v in r.values())});')
    out += [x["sql"].rstrip(";") + ";" for x in data["schema"] if x["type"] == "index"]
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
