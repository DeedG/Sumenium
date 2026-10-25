"""Têtes des skins des joueurs, servies par le site (site/heads/<pseudo>.png, 8 × 8 px, visage + couche du chapeau).

mc-heads.net garde parfois en cache une tête de Steve pour un pseudo et une taille (skin changé, lookup raté),
pendant plusieurs jours. On génère donc nos têtes depuis le skin officiel (API publique de Mojang), relu une fois par jour
pour chaque joueur. Le site garde mc-heads.net en secours quand une tête manque (joueur jamais connecté, skin par défaut).

Entrée : work/joueurs.json ({uuid: pseudo}, écrit par update.py). Cache : work/heads-meta.json + site/heads/.
"""
import base64, io, json, os, re, time, urllib.error, urllib.request
from PIL import Image

OUT = "site/heads"
META = "work/heads-meta.json"
MAX_LOOKUPS = 40           # par passage (toutes les 10 min) : l'API de Mojang limite le nombre de requêtes
REFRESH = 24 * 3600        # un skin est relu au plus une fois par jour
UA = {"user-agent": "sumenium-site (heads)"}


def get(url, timeout=15):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def head(skin_png):
    im = Image.open(io.BytesIO(skin_png)).convert("RGBA")
    face = im.crop((8, 8, 16, 16))
    if im.height >= 64 or im.width >= 64:   # couche du chapeau (aussi présente dans les anciens skins 64 × 32)
        face.alpha_composite(im.crop((40, 8, 48, 16)))
    return face


def main():
    try:
        players = json.load(open("work/joueurs.json", encoding="utf-8"))
    except Exception:
        print("Têtes : pas de liste de joueurs (work/joueurs.json), rien à faire.")
        return
    try:
        meta = json.load(open(META, encoding="utf-8"))
    except Exception:
        meta = {}
    os.makedirs(OUT, exist_ok=True)
    now, done, made = time.time(), 0, 0
    todo = sorted(players.items(), key=lambda kv: (meta.get(kv[0], {}).get("t", 0)))  # les plus anciennes d'abord
    for uuid, name in todo:
        if not re.fullmatch(r"[A-Za-z0-9_]{1,16}", name or ""):
            continue
        path = os.path.join(OUT, name.lower() + ".png")
        m = meta.get(uuid, {})
        # à jour : relu il y a moins d'un jour (tête écrite, ou skin par défaut sans tête à faire)
        if m.get("name") == name and now - m.get("t", 0) < REFRESH and (os.path.exists(path) or "skin" in m and not m["skin"]):
            continue
        if done >= MAX_LOOKUPS:
            break
        done += 1
        try:
            prof = json.loads(get("https://sessionserver.mojang.com/session/minecraft/profile/" + uuid.replace("-", "")))
            tex = next((p for p in prof.get("properties", []) if p.get("name") == "textures"), None)
            skin = json.loads(base64.b64decode(tex["value"]))["textures"].get("SKIN", {}).get("url") if tex else None
            if skin:
                skin = skin.replace("http://", "https://", 1)
                if skin != m.get("skin") or not os.path.exists(path) or m.get("name") != name:
                    head(get(skin)).save(path, optimize=True)
                    made += 1
            meta[uuid] = {"name": name, "t": now, "skin": skin}
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print("Têtes : limite de l'API Mojang atteinte, suite au prochain passage.")
                break
            meta[uuid] = {**m, "t": now - REFRESH + 3600}   # nouvel essai dans une heure
        except Exception as e:
            print("Tête non générée pour", name, ":", type(e).__name__, e)
    json.dump(meta, open(META, "w", encoding="utf-8"))
    print(f"Têtes : {done} skins relus, {made} têtes mises à jour, {len(os.listdir(OUT))} au total.")


if __name__ == "__main__":
    main()
