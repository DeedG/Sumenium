"""Construit site/tech.json : comment chaque succès est détecté par le jeu (critères, déclencheurs, conditions).

    python tools/build_tech.py --bacap <dossier BACAP> --ed <dossier ED>

Pour chaque entrée de site/catalog.json et chaque avancement qu'elle regroupe :
  - les critères, avec leur déclencheur (trigger) et leurs conditions mises à plat (chemin = valeur) ;
  - si un critère est « impossible », les lignes de fonctions qui accordent l'avancement à la place
    (détection faite par un datapack à chaque tick, par un score, etc.).
Le site charge ce fichier seulement quand on ouvre « Détection technique ».
"""
import argparse, glob, json, os, re

ap = argparse.ArgumentParser()
ap.add_argument("--bacap", required=True)
ap.add_argument("--ed", required=True)
here = os.path.dirname(os.path.abspath(__file__))
ap.add_argument("--catalog", default=os.path.join(here, "..", "site", "catalog.json"))
ap.add_argument("--out", default=os.path.join(here, "..", "site", "tech.json"))
a = ap.parse_args()

roots = {
    "blazeandcave": [os.path.join(a.bacap, "data/blazeandcave/advancement")],
    "bacaped": [os.path.join(a.ed, "data/bacaped/advancement")],
    "minecraft": [os.path.join(a.ed, "data/minecraft/advancement"), os.path.join(a.bacap, "data/minecraft/advancement")],
}


def adv_json(full):
    ns, path = full.split(":", 1)
    for root in roots.get(ns, []):
        p = os.path.join(root, path + ".json")
        if os.path.exists(p):
            return json.load(open(p, encoding="utf-8"))
    return None


MAX_LINES = 40


def flat(obj, prefix="", out=None):
    """Met les conditions à plat : « player.location.biomes = minecraft:plains »."""
    out = [] if out is None else out
    if len(out) >= MAX_LINES:
        return out
    if isinstance(obj, dict):
        if not obj:
            out.append(f"{prefix} = {{}}")
        for k, v in obj.items():
            flat(v, f"{prefix}.{k}" if prefix else k, out)
    elif isinstance(obj, list):
        if all(not isinstance(x, (dict, list)) for x in obj):
            out.append(f"{prefix} = " + ", ".join(map(str, obj)))
        else:
            for i, v in enumerate(obj):
                flat(v, f"{prefix}[{i}]", out)
    else:
        out.append(f"{prefix} = {json.dumps(obj, ensure_ascii=False) if isinstance(obj, str) else obj}")
    return out


# Lignes de fonctions qui accordent un avancement (« advancement grant … only <id> »)
grant_re = re.compile(r"advancement grant (\S+) only ([a-z0-9_.-]+:[a-z0-9_./-]+)(?: (\S+))?")
grants = {}
for pack in (a.bacap, a.ed):
    for f in glob.glob(os.path.join(pack, "data", "*", "function", "**", "*.mcfunction"), recursive=True):
        rel = os.path.relpath(f, os.path.join(pack, "data"))
        ns, _, rest = rel.partition(os.sep + "function" + os.sep)
        fname = ns + ":" + rest[:-11].replace(os.sep, "/")
        if "/coop_" in fname or ":config/" in fname:
            continue  # synchronisation des équipes coop / réglages : pas la vraie détection
        for line in open(f, encoding="utf-8", errors="replace"):
            m = grant_re.search(line)
            if m:
                lst = grants.setdefault(m.group(2), [])
                if len(lst) < 6:
                    lst.append({"f": fname, "l": line.strip()[:400]})

cat = json.load(open(a.catalog, encoding="utf-8"))
out = {}
for e in cat:
    advs = []
    for full in e.get("adv", []):
        j = adv_json(full)
        if not j:
            continue
        crit = []
        for name, c in (j.get("criteria") or {}).items():
            trig = c.get("trigger", "?")
            crit.append({"n": name, "t": trig.replace("minecraft:", ""), "c": flat(c.get("conditions") or {})})
        req = j.get("requirements") or [[n] for n in (j.get("criteria") or {})]
        item = {"id": full, "crit": crit, "req": req if any(len(g) > 1 for g in req) else None}
        if full in grants:
            item["grant"] = grants[full]
        advs.append(item)
    if advs:
        out[e["id"]] = advs
json.dump(out, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"{len(out)} succès décrits dans {a.out} ({os.path.getsize(a.out) // 1024} Ko)")
