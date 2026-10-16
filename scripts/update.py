"""Récupère les données du serveur en SFTP et écrit site/data.json.

Variables d'environnement (secrets GitHub) :
  SFTP_HOST, SFTP_PORT (défaut 22), SFTP_USER, SFTP_PASSWORD
  SFTP_ROOT  dossier du serveur sur le SFTP (défaut : dossier d'arrivée)
  PAGES_URL  adresse du site, pour garder les dernières données si le SFTP ne répond pas
"""
import base64, hashlib, io, json, os, posixpath, re, stat, sys, urllib.request
from datetime import datetime, timezone

import nbtlib
import paramiko

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, "..", "site")
OUT = os.path.join(SITE, "data.json")


def log(*a):
    print(*a, flush=True)


def keep_previous(reason):
    """Le SFTP n'a pas répondu : on republie les données précédentes, marquées comme anciennes."""
    prev = None
    url = os.environ.get("PAGES_URL")
    if url:
        try:
            with urllib.request.urlopen(url.rstrip("/") + "/data.json", timeout=20) as r:
                prev = json.load(r)
        except Exception as e:  # premier déploiement, site absent...
            log("Pas de données précédentes :", e)
    # Les autres fichiers du site : on reprend les précédents tels quels
    for name in ("stats.json", "eco.json"):
        if not url:
            break
        try:
            with urllib.request.urlopen(url.rstrip("/") + "/" + name, timeout=20) as r, open(os.path.join(SITE, name), "wb") as f:
                f.write(r.read())
        except Exception:
            pass
    data = prev or {}
    data["error"] = reason
    data["checked"] = datetime.now(timezone.utc).isoformat()
    json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    notice("warning", "Données précédentes conservées : " + reason)


def connect():
    # Accepte aussi "sftp://hote:port" ou "hote:port" collés depuis le panel
    host = os.environ["SFTP_HOST"].strip()
    host = re.sub(r"^[a-z]+://", "", host).split("/")[0]
    if "@" in host:
        host = host.split("@", 1)[1]
    port = (os.environ.get("SFTP_PORT") or "").strip()
    if ":" in host:
        host, p = host.rsplit(":", 1)
        port = port or p
    port = int(port or 22)
    log(f"Connexion SFTP à {host[:3]}… port {port}")
    t = paramiko.Transport((host, port))
    t.connect(username=os.environ["SFTP_USER"].strip(), password=os.environ["SFTP_PASSWORD"])
    return paramiko.SFTPClient.from_transport(t)


def read(sftp, path):
    buf = io.BytesIO()
    sftp.getfo(path, buf)
    return buf.getvalue()


def load_nbt(sftp, path):
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".dat", delete=False) as f:
        f.write(read(sftp, path))
    try:
        return nbtlib.load(f.name)
    finally:
        os.unlink(f.name)


def read_border(sftp, w):
    """Bordure de l'Overworld : centre et largeur (fichier de 26.x, sinon level.dat)."""
    try:
        d = load_nbt(sftp, w("dimensions/minecraft/overworld/data/minecraft/world_border.dat"))["data"]
        return {"x": float(d["center_x"]), "z": float(d["center_z"]), "size": float(d["size"])}
    except Exception:
        pass
    try:
        d = load_nbt(sftp, w("level.dat"))["Data"]
        return {"x": float(d["BorderCenterX"]), "z": float(d["BorderCenterZ"]), "size": float(d["BorderSize"])}
    except Exception:
        return None


def notice(kind, msg):
    """Message visible dans le résumé du workflow GitHub."""
    print(f"::{kind} title=Lecture du serveur::{msg}", flush=True)


def write_progress(catalog, players, teams):
    """Un fichier par joueur (site/progress/<pseudo>.json) : succès obtenus et critères déjà remplis."""
    pdir = os.path.join(SITE, "progress")
    os.makedirs(pdir, exist_ok=True)
    index = []
    for who, data in players.items():
        if not re.fullmatch(r"[A-Za-z0-9_]{2,16}", who):
            continue
        done, prog = {}, {}
        for e in catalog:
            reqs = e.get("req") or []
            for full in e["adv"]:
                a = data.get(full)
                if not a or not a.get("criteria"):
                    continue
                if a.get("done"):
                    done[e["id"]] = max(a["criteria"].values())
                    break
                have = sorted(c for c in a["criteria"] if any(c in g for g in reqs))
                if have:
                    prog[e["id"]] = have
        with open(os.path.join(pdir, who + ".json"), "w", encoding="utf-8") as f:
            json.dump({"name": who, "team": teams.get(who), "done": done, "prog": prog}, f, ensure_ascii=False, separators=(",", ":"))
        index.append({"name": who, "team": teams.get(who), "done": len(done)})
    index.sort(key=lambda x: x["name"].lower())
    with open(os.path.join(pdir, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))


def push_whitelist(sftp, j):
    """Envoie la whitelist à l'Espace (sumenium.alheon.fr) : seuls ces pseudos peuvent être reliés à un compte Discord."""
    secret = os.environ.get("DISCORD_CLIENT_SECRET")
    if not secret:
        return
    try:
        wl = json.loads(read(sftp, j("whitelist.json")))
        players = [{"name": e["name"], "uuid": e.get("uuid", "")} for e in wl if e.get("name")]
    except Exception as e:
        notice("warning", f"whitelist.json illisible, Espace non synchronisé : {type(e).__name__}")
        return
    if not players:
        return  # ne jamais vider la liste côté Espace sur une lecture ratée
    token = base64.urlsafe_b64encode(hashlib.sha256(f"sumenium:ingest:{secret}".encode()).digest()).rstrip(b"=").decode()
    url = (os.environ.get("ESPACE_URL") or "https://sumenium.alheon.fr").rstrip("/") + "/api/ingest/whitelist"
    req = urllib.request.Request(url, data=json.dumps({"players": players}).encode(), method="POST", headers={
        "content-type": "application/json", "authorization": f"Bearer {token}", "user-agent": "sumenium-update/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            log("Whitelist envoyée à l'Espace :", json.loads(r.read()).get("count"), "pseudos")
    except Exception as e:
        notice("warning", f"Whitelist non envoyée à l'Espace : {e}")


def main():
    sftp = connect()
    root = os.environ.get("SFTP_ROOT") or "."
    j = lambda *p: posixpath.join(root, *p)

    level = "world"
    try:
        for line in read(sftp, j("server.properties")).decode("utf-8", "replace").splitlines():
            if line.startswith("level-name="):
                level = line.split("=", 1)[1].strip() or "world"
    except IOError:
        log("server.properties introuvable, monde supposé : world")
    w = lambda *p: j(level, *p)

    # Scoreboard : succès déjà consommés, valeurs, réglages, équipes
    sb = load_nbt(sftp, w("data/minecraft/scoreboard.dat"))["data"]
    scores = {}
    for p in sb["PlayerScores"]:
        scores.setdefault(str(p["Objective"]), {})[str(p["Name"])] = int(p.get("Score", 0))
    teams = {}
    for t in sb.get("Teams", []):
        name = str(t["Name"])
        if name.startswith(("bac_", "afkDis")):
            continue
        for pl in t.get("Players", []):
            teams[str(pl)] = name

    wb = scores.get("wb", {})
    cfg = scores.get("wb_config", {})
    tier_blocks = {k.lstrip("#"): v for k, v in scores.get("wb_tier_blocks", {}).items()}
    adv_blocks = scores.get("wb_adv_blocks", {})

    # Stockage du WB-Addon : taille du monde et multiplicateur
    st = load_nbt(sftp, w("data/bacap_wb_addon/command_storage.dat"))["data"]["contents"]
    world_size = int(st.get("world_size", {}).get("world", {}).get("size", 0))
    border = read_border(sftp, w)
    if border:
        world_size = int(border["size"] // 2)
    mult_int = int(st.get("settings", {}).get("mult_int", 100))

    # Pseudos
    names = {}
    try:
        for e in json.loads(read(sftp, j("usercache.json"))):
            names[e["uuid"]] = e["name"]
    except IOError:
        pass

    # Progression de chaque joueur
    adv_dir = None
    for cand in (w("players/advancements"), w("advancements")):
        try:
            sftp.listdir(cand)
            adv_dir = cand
            break
        except IOError:
            continue
    players = {}
    if adv_dir:
        for f in sftp.listdir_attr(adv_dir):
            if f.filename.endswith(".json") and stat.S_ISREG(f.st_mode):
                uuid = f.filename[:-5]
                try:
                    players[names.get(uuid, uuid[:8])] = json.loads(read(sftp, posixpath.join(adv_dir, f.filename)))
                except Exception as e:
                    log("Fichier illisible", f.filename, e)
    # Classements (tableau en jeu, statistiques, économie) : site/stats.json
    try:
        import stats as stats_mod
        extra = stats_mod.build(sftp, read, j, w, names, teams, scores, log)
        extra["updated"] = datetime.now(timezone.utc).isoformat()
        json.dump(extra, open(os.path.join(SITE, "stats.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    except Exception as e:
        notice("warning", f"Classements non mis à jour : {type(e).__name__}: {e}")
    push_whitelist(sftp, j)
    # Économie (mod Sumenium Economy) : exports publics → site/eco.json, journal privé → Worker
    try:
        import eco as eco_mod
        eco_summary = eco_mod.build(sftp, read, j, log, os.path.join(SITE, "eco.json"))
    except Exception as e:
        eco_summary = "économie indisponible"
        notice("warning", f"Économie non mise à jour : {type(e).__name__}: {e}")
    try:
        eco_mod.push_journal(sftp, read, j, log, notice)
    except Exception as e:
        notice("warning", f"Journal non envoyé : {type(e).__name__}: {e}")
    sftp.close()

    catalog = json.load(open(os.path.join(SITE, "catalog.json"), encoding="utf-8"))
    reward_mode = cfg.get("reward_mode", 0)

    def blocks(e):
        # Même calcul que bacap_wb_addon:math/border_calculator
        if e["tier"] == "custom" and e.get("custom") is not None:
            base = e["custom"]
        else:
            v = tier_blocks.get(e["tier"], 0) if reward_mode == 1 else adv_blocks.get(e["id"], 0)
            base = (v // 100) * mult_int + ((v % 100) * mult_int) // 100
        return round(base / 100, 2)

    out = {}
    for e in catalog:
        rec = {"b": blocks(e)}
        reqs = e.get("req") or []
        if wb.get(e["id"], 0) >= 1:
            rec["done"] = 1
            # Premier joueur à l'avoir terminé, d'après les dates enregistrées
            first = None
            for who, data in players.items():
                for full in e["adv"]:
                    a = data.get(full)
                    if a and a.get("done") and a.get("criteria"):
                        at = max(a["criteria"].values())
                        if first is None or at < first[0]:
                            first = (at, who)
            if first:
                rec["at"], rec["by"] = first
                if first[1] in teams:
                    rec["team"] = teams[first[1]]
        elif reqs:
            # Meilleure progression parmi les joueurs (groupes de critères remplis)
            best = None
            for who, data in players.items():
                for full in e["adv"]:
                    a = data.get(full)
                    if not a or not a.get("criteria"):
                        continue
                    have = set(a["criteria"])
                    n = sum(1 for g in reqs if have.intersection(g))
                    if n and (best is None or n > best[0]):
                        best = (n, who, sorted(have))
            if best:
                rec["p"] = best[0]
                rec["pw"] = best[1]
                if best[1] in teams:
                    rec["team"] = teams[best[1]]
                if len(reqs) > 1:
                    rec["pc"] = best[2]
        out[e["id"]] = rec

    write_progress(catalog, players, teams)

    # Taille théorique : bordure de départ (5 blocs) + gains de tous les succès obtenus, au multiplicateur ACTUEL.
    # Le WB-Addon ne recalcule pas la bordure quand on change le multiplicateur : l'écart vient des gains passés.
    expected = 5 + sum(r["b"] for r in out.values() if r.get("done"))

    data = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "checked": datetime.now(timezone.utc).isoformat(),
        "worldSize": world_size,
        "bac": {k: scores.get("bac_settings", {}).get(k) for k in ("reward", "trophy", "exp")},
        "border": border,
        "mode": "tiers" if reward_mode == 1 else "individual",
        "multiplier": mult_int / 100,
        "expectedDiameter": round(expected, 2),
        "players": len(players),
        "adv": out,
    }
    json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    done = sum(1 for r in out.values() if r.get("done"))
    notice("notice", f"OK : monde {world_size}, {done}/{len(out)} succès obtenus, {len(players)} joueurs, {eco_summary}")


if __name__ == "__main__":
    try:
        main()
    except KeyError as e:
        keep_previous(f"Réglage manquant : {e}")
    except Exception as e:
        import socket
        if isinstance(e, socket.gaierror):
            msg = "adresse SFTP introuvable, vérifie le secret SFTP_HOST"
        elif isinstance(e, paramiko.AuthenticationException):
            msg = "identifiant ou mot de passe SFTP refusé, vérifie SFTP_USER et SFTP_PASSWORD"
        elif isinstance(e, (socket.timeout, TimeoutError, ConnectionRefusedError, paramiko.SSHException)):
            msg = f"le serveur SFTP ne répond pas, vérifie SFTP_HOST et SFTP_PORT ({e})"
        elif isinstance(e, FileNotFoundError) or (isinstance(e, IOError) and getattr(e, "errno", None) == 2):
            msg = f"fichier introuvable sur le serveur, vérifie SFTP_ROOT ({e})"
        else:
            msg = f"{type(e).__name__}: {e}"
        keep_previous(msg)
