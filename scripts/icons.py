"""Extrait les icônes des objets donnés en récompense (textures officielles de Minecraft).

Lancé par le workflow GitHub : télécharge le client Minecraft une fois (mis en cache),
puis copie dans site/icons/ la texture de chaque objet présent dans site/catalog.json.
"""
import json, os, sys, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, "..", "site")
OUT = os.path.join(SITE, "icons")
CACHE = os.path.join(HERE, "..", "work")
WANTED_VERSION = os.environ.get("MC_VERSION", "26.3")
NAMES_V = 2  # format de names_fr.json (2 : noms précisés pour les objets homonymes) ; changer force la régénération
# Objets sans texture simple : on prend celle d'un objet qui leur ressemble
ALIAS = {"enchanted_golden_apple": "golden_apple", "debug_stick": "stick"}


def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


_meta = None


def version_meta():
    global _meta
    if _meta is None:
        manifest = json.loads(get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"))
        ids = {v["id"]: v["url"] for v in manifest["versions"]}
        vid = WANTED_VERSION if WANTED_VERSION in ids else manifest["latest"]["release"]
        print("Version de Minecraft :", vid)
        _meta = json.loads(get(ids[vid]))
    return _meta


def client_jar():
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, "client.jar")
    if os.path.exists(path):
        return path
    with open(path, "wb") as f:
        f.write(get(version_meta()["downloads"]["client"]["url"]))
    return path


def french_names(items):
    """Noms français officiels des objets (fichier de langue fr_fr du jeu) → site/icons/names_fr.json."""
    path = os.path.join(OUT, "names_fr.json")
    if os.path.exists(path):
        old = json.load(open(path, encoding="utf-8"))
        if old.get("_v") == NAMES_V and set(items) <= set(old):
            return
    index = json.loads(get(version_meta()["assetIndex"]["url"]))
    h = index["objects"]["minecraft/lang/fr_fr.json"]["hash"]
    lang = json.loads(get(f"https://resources.download.minecraft.net/{h[:2]}/{h}"))
    names, keys = {}, {}
    for it in items:
        for key in (f"item.minecraft.{it}", f"block.minecraft.{it}"):
            if key in lang:
                names[it], keys[it] = lang[key], key
                break
    # Objets qui portent le même nom en jeu (« Disque », « Modèle de forge », « Motif de bannière ») : on précise lequel
    count = {}
    for n in names.values():
        count[n] = count.get(n, 0) + 1
    for it, n in list(names.items()):
        if count[n] < 2:
            continue
        extra = lang.get(keys[it] + ".desc")
        if it.endswith("_armor_trim_smithing_template"):
            extra = lang.get("trim_pattern.minecraft." + it[: -len("_armor_trim_smithing_template")]) or extra
        elif it.endswith("_upgrade_smithing_template"):
            extra = lang.get("upgrade.minecraft." + it[: -len("_smithing_template")]) or extra
        if extra:
            names[it] = f"{n} : {extra}"
    names["_v"] = NAMES_V
    with open(path, "w", encoding="utf-8") as f:
        json.dump(names, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Noms français : {len(names) - 1}/{len(items)} objets")


def main():
    cat = json.load(open(os.path.join(SITE, "catalog.json"), encoding="utf-8"))
    items = {i["id"] for e in cat for k in ("rw", "tr") for i in e.get(k, [])}
    # Objets vendus en boutique, au FISC et à l'hôtel des ventes (si l'économie a déjà été lue)
    sys.path.insert(0, HERE)
    import eco
    items = sorted(items | eco.items(os.path.join(SITE, "eco.json")))
    os.makedirs(OUT, exist_ok=True)
    try:
        french_names(items)
    except Exception as e:
        print(f"::warning title=Noms français::{type(e).__name__}: {e}")
    missing = [i for i in items if not os.path.exists(os.path.join(OUT, i + ".png"))]
    if not missing:
        print("Icônes déjà à jour")
        return
    z = zipfile.ZipFile(client_jar())
    names = set(z.namelist())
    base = "assets/minecraft/textures/"
    found = 0
    for it in missing:
        al = ALIAS.get(it, it)
        for cand in (f"item/{it}.png", f"block/{it}.png", f"block/{it}_front.png", f"block/{it}_side.png",
                     f"block/{it}_top.png", f"item/{it}_00.png", f"item/{al}.png", f"block/{al}.png"):
            if base + cand in names:
                with open(os.path.join(OUT, it + ".png"), "wb") as f:
                    f.write(z.read(base + cand))
                found += 1
                break
    print(f"Icônes : {found} ajoutées, {len(missing) - found} sans texture simple")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # les icônes sont un bonus : ne jamais bloquer la mise à jour
        print(f"::warning title=Icônes::{type(e).__name__}: {e}")
        sys.exit(0)
