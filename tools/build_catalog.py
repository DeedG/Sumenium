"""Construit site/catalog.json à partir des datapacks BACAP, BACAP ED et WB-Addon.

À relancer seulement si vous mettez à jour un de ces datapacks :
    python tools/build_catalog.py --bacap <dossier BACAP> --ed <dossier ED> --wb <dossier WB-Addon>
Chaque dossier est celui qui contient "data/" (datapack décompressé).
"""
import argparse, glob, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rewards  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--bacap", required=True)
ap.add_argument("--ed", required=True)
ap.add_argument("--wb", required=True)
ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "site", "catalog.json"))
a = ap.parse_args()

# 1) Où trouver le JSON d'un avancement à partir de son id complet
adv_roots = {
    "blazeandcave": [os.path.join(a.bacap, "data/blazeandcave/advancement")],
    "bacaped": [os.path.join(a.ed, "data/bacaped/advancement")],
    "minecraft": [os.path.join(a.ed, "data/minecraft/advancement"), os.path.join(a.bacap, "data/minecraft/advancement")],
}
def adv_json(full):
    ns, path = full.split(":", 1)
    for root in adv_roots.get(ns, []):
        p = os.path.join(root, path + ".json")
        if os.path.exists(p):
            return json.load(open(p, encoding="utf-8"))
    return None

# 2) Lien avancement -> nom du tag fanpack (via les fonctions de récompense BACAP / ED)
macro = re.compile(r'advancement_made_macro \{adv_id:"([^"]+)",reward_id:"([^"]+)"')
links = []  # (adv complet, tag complet)
reward_src = {}  # adv complet -> (dossier des fonctions de récompense, reward_id)
for pack, rew, fan in [(a.bacap, "bacap_rewards", "bacap_fanpacks"), (a.ed, "bacaped_rewards", "bacaped_fanpacks")]:
    for f in glob.glob(os.path.join(pack, "data", rew, "function", "**", "*.mcfunction"), recursive=True):
        for m in macro.finditer(open(f, encoding="utf-8").read()):
            links.append((m.group(1), fan + ":" + m.group(2)))
            reward_src.setdefault(m.group(1), (os.path.join(pack, "data", rew, "function"), m.group(2)))

# 3) Tag fanpack -> fonction de récompense du WB-Addon -> infos (adv_id WB, palier, type...)
def wb_reward(func):
    p = os.path.join(a.wb, "data", "bacap_wb_addon", "function", func.split(":", 1)[1] + ".mcfunction")
    if not os.path.exists(p):
        return None
    s = re.search(r"set value (\{.*\})", open(p, encoding="utf-8").read()).group(1)
    g = lambda k: (re.search(k + r':"((?:[^"\\]|\\.)*)"', s) or [None, None])[1]
    c = re.search(r"custom_tier_blocks:(\d+)", s)
    return {"id": g("adv_id"), "title": g("title"), "desc": g("desc"), "tab": g("tab"),
            "type": g("type"), "tier": g("tier"), "custom": int(c.group(1)) if c else None}

tag_target = {}
for fan in ("bacap_fanpacks", "bacaped_fanpacks"):
    base = os.path.join(a.wb, "data", fan, "tags", "function")
    for tj in glob.glob(os.path.join(base, "**", "*.json"), recursive=True):
        name = fan + ":" + os.path.relpath(tj, base)[:-5].replace(os.sep, "/")
        for v in json.load(open(tj, encoding="utf-8"))["values"]:
            v = v if isinstance(v, str) else v.get("id")
            if v and v.startswith("bacap_wb_addon:rewards/"):
                tag_target[name] = v

# 4) Assemblage, une entrée par adv_id du WB-Addon (c'est la clé du score global "wb")
cat = {}
for full, tag in links:
    func = tag_target.get(tag)
    if not func:
        continue
    r = wb_reward(func)
    if not r or r["type"] != "add":
        continue
    e = cat.setdefault(r["id"], dict(r, adv=[]))
    if full not in e["adv"]:
        e["adv"].append(full)
    if "rw" not in e and full in reward_src:
        fdir, rid = reward_src[full]
        items, _ = rewards.parse_function(os.path.join(fdir, "reward", rid + ".mcfunction"))
        trophy, _ = rewards.parse_function(os.path.join(fdir, "trophy", rid + ".mcfunction"))
        _, xp = rewards.parse_function(os.path.join(fdir, "exp", rid + ".mcfunction"))
        e["rw"] = items
        if trophy:
            e["tr"] = trophy
        if xp:
            e["xp"] = xp
    j = adv_json(full)
    if j and "req" not in e:
        crit = list(j.get("criteria", {}).keys())
        req = j.get("requirements") or [[c] for c in crit]
        e["req"] = req
        d = j.get("display") or {}
        e["hidden"] = bool(d.get("hidden"))
        e["frame"] = d.get("frame", "task")
        e["parent"] = j.get("parent")

# Titres des parents, pour "à débloquer après"
title_by_full = {f: e["title"] for e in cat.values() for f in e["adv"]}
out = []
for e in cat.values():
    e["parent"] = title_by_full.get(e.pop("parent", None) or "")
    e.setdefault("req", [])
    e.setdefault("hidden", False)
    if not e.get("rw"):
        e.pop("rw", None)
    out.append(e)
out.sort(key=lambda e: (e["tab"] or "", e["title"] or ""))
json.dump(out, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"{len(out)} avancements écrits dans {a.out}")
