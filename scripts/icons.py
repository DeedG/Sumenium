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
NAMES_V = 3  # 3 : objets et créatures des statistiques ; format de names_fr.json (2 : noms précisés pour les objets homonymes) ; changer force la régénération
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
        for key in (f"item.minecraft.{it}", f"block.minecraft.{it}", f"entity.minecraft.{it}"):
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


def stat_ids():
    """Objets et créatures des statistiques Minecraft (site/stats.json) : noms français et icônes sur le site."""
    try:
        st = json.load(open(os.path.join(SITE, "stats.json"), encoding="utf-8"))
    except Exception:
        return set(), set()
    items, mobs = set(), set()
    for sid in st.get("stats") or {}:
        cat, _, key = sid.partition("|")
        k = key.replace("minecraft:", "")
        if not k.replace("_", "").isalnum():
            continue
        if cat in ("minecraft:mined", "minecraft:crafted", "minecraft:used", "minecraft:broken", "minecraft:picked_up", "minecraft:dropped"):
            items.add(k)
        elif cat in ("minecraft:killed", "minecraft:killed_by"):
            items.add(k)  # créatures : nom via entity.minecraft.<id>
    return items, mobs


# Icônes des types de statistiques (site/icons/stat/<type>.png) : textures du jeu, plusieurs candidates par type
STAT_ICONS = {
    "mined": ["item/iron_pickaxe"], "crafted": ["block/crafting_table_front"], "used": ["item/flint_and_steel"],
    "broken": ["block/damaged_anvil_top", "item/wooden_pickaxe"], "picked_up": ["item/hopper"], "dropped": ["block/dropper_front"],
    "killed": ["item/iron_sword"], "killed_by": ["item/bone"], "deaths": ["item/totem_of_undying"],
    "time": ["item/clock_00"], "walk": ["item/leather_boots"], "sprint": ["item/golden_boots"], "crouch": ["item/leather_leggings"],
    "swim": ["item/water_bucket"], "boat": ["item/oak_boat"], "horse": ["item/saddle"], "pig": ["item/carrot_on_a_stick"],
    "strider": ["item/warped_fungus_on_a_stick"], "minecart": ["item/minecart"], "aviate": ["item/elytra"], "fly": ["item/feather"],
    "fall": ["item/feather"], "climb": ["block/ladder"], "jump": ["item/rabbit_foot"], "player_kill": ["item/diamond_sword"],
    "open": ["block/barrel_top"], "enchant": ["item/enchanted_book"], "eat": ["item/cake", "item/cooked_beef"], "sleep": ["item/clock_00"],
    "trade": ["item/emerald"], "fish": ["item/fishing_rod"], "brew": ["item/brewing_stand"], "anvil": ["block/anvil_top"],
    "note": ["block/note_block"], "plant": ["item/wheat_seeds"], "clean": ["item/water_bucket"], "bell": ["item/bell"],
    "raid": ["item/ominous_banner", "item/crossbow_standby"], "target": ["block/target_side"], "generic": ["item/book"],
    "heart": ["gui/sprites/hud/heart/full", "gui/sprites/hud/heart/container"],
}


def stat_icons(z, names):
    out = os.path.join(OUT, "stat")
    os.makedirs(out, exist_ok=True)
    base, made = "assets/minecraft/textures/", 0
    for key, cands in STAT_ICONS.items():
        path = os.path.join(out, key + ".png")
        if os.path.exists(path):
            continue
        for c in cands:
            if base + c + ".png" in names:
                with open(path, "wb") as f:
                    f.write(z.read(base + c + ".png"))
                made += 1
                break
    # Cœur brisé (dégâts infligés) : le cœur du jeu, fendu en deux
    heart, broken = os.path.join(out, "heart.png"), os.path.join(out, "heart_broken.png")
    if os.path.exists(heart) and not os.path.exists(broken):
        try:
            from PIL import Image
            im = Image.open(heart).convert("RGBA")
            w, h = im.size
            res = Image.new("RGBA", (w + 2, h), (0, 0, 0, 0))
            mid = w // 2
            res.paste(im.crop((0, 0, mid, h)), (0, 1))          # moitié gauche un peu plus bas
            res.paste(im.crop((mid, 0, w, h)), (mid + 2, 0))    # moitié droite décalée : la fente
            res.save(broken)
            made += 1
        except Exception as e:
            print("Cœur brisé non créé :", e)
    have = len([f for f in os.listdir(out) if f.endswith(".png")])
    print(f"::notice title=Icônes des statistiques::{have} sur {len(STAT_ICONS) + 1} ({made} ajoutées)")


def main():
    cat = json.load(open(os.path.join(SITE, "catalog.json"), encoding="utf-8"))
    items = {i["id"] for e in cat for k in ("rw", "tr") for i in e.get(k, [])}
    # Objets vendus en boutique, au FISC et à l'hôtel des ventes (si l'économie a déjà été lue)
    sys.path.insert(0, HERE)
    import eco
    items = sorted(items | eco.items(os.path.join(SITE, "eco.json")) | stat_ids()[0])
    os.makedirs(OUT, exist_ok=True)
    try:
        french_names(items)
    except Exception as e:
        print(f"::warning title=Noms français::{type(e).__name__}: {e}")
    missing = [i for i in items if not os.path.exists(os.path.join(OUT, i + ".png"))]
    if not os.path.exists(os.path.join(OUT, "stat", "heart_broken.png")):
        try:
            zz = zipfile.ZipFile(client_jar())
            stat_icons(zz, set(zz.namelist()))
        except Exception as e:
            print(f"::warning title=Icônes des statistiques::{type(e).__name__}: {e}")
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
