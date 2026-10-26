"""Économie Suménium (mod Sumenium Economy) : exports publics et journal privé.

- sumenium-data/export/*.json → site/eco.json (public) : boutiques, factions, baltop, FISC, HDV, statistiques.
  Les montants des exports sont déjà en Su (décimales).
- sumenium-data/journal/AAAA-MM-JJ.jsonl → envoyé au Worker (sumenium.com), JAMAIS publié :
  c'est l'historique de chaque joueur. Montants en CENTIMES dans le journal.
- sumenium-data/data/ : données internes du mod, jamais lues.

Un fichier absent ou illisible donne null dans eco.json : le site affiche « données indisponibles ».
"""
import base64, hashlib, json, os, posixpath, re, urllib.request
from datetime import datetime, timezone, timedelta

EXPORT = "sumenium-data/export"
JOURNAL = "sumenium-data/journal"
MAX_POINTS = 6000          # points gardés pour la courbe de la masse monétaire (≈ 8 mois à un par heure)
OUVERTURE = "2026-10-09T21:00:00+02:00"  # ouverture de la saison 7 : le 0 de la courbe
CHUNK = 400                # lignes de journal par envoi au Worker


def _num(v):
    try:
        return round(float(v), 2) if v is not None else None
    except (TypeError, ValueError):
        return None


def _ms(v):
    """Date du mod → millisecondes : nombre (ms) ou texte ISO 8601."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v if v > 1e11 else v * 1000)
    try:
        return int(datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def _details(d):
    """Bloc « details » du mod (v2.2) : enchantements, potion, nom perso, lore, durabilité.
    Le champ « composants » (item complet au format /give) n'est pas publié : trop lourd pour le site."""
    if not isinstance(d, dict):
        return None
    out = {}
    if d.get("nomPerso"):
        out["nomPerso"] = str(d["nomPerso"])[:80]
    ench = [{"id": e.get("id"), "niveau": e.get("niveau") or 1, "nom": e.get("nom")}
            for e in (d.get("enchantements") or []) if isinstance(e, dict) and e.get("id")]
    if ench:
        out["enchantements"] = ench
    for k in ("resume", "potion"):
        if d.get(k):
            out[k] = str(d[k])[:200]
    if isinstance(d.get("lore"), list) and d["lore"]:
        out["lore"] = [str(x)[:120] for x in d["lore"][:6]]
    if d.get("durabiliteMax"):
        out["durabilite"], out["durabiliteMax"] = d.get("durabilite"), d.get("durabiliteMax")
    return out or None


def _load(sftp, read, j, name, log):
    try:
        raw = read(sftp, j(EXPORT, name))
        if not raw.strip():
            log(f"Économie : {name} est vide")
            return None
        return json.loads(raw)
    except Exception as e:
        log(f"Économie : {name} indisponible ({type(e).__name__})")
        return None


def build(sftp, read, j, log, out_path):
    """Écrit site/eco.json et renvoie un résumé pour l'annotation du workflow."""
    eco = {"genereLe": datetime.now(timezone.utc).isoformat(), "monnaie": "Su"}

    comptes = _load(sftp, read, j, "comptes.json", log)
    faction_of = {}
    if comptes and isinstance(comptes.get("joueurs"), list):
        eco["monnaie"] = comptes.get("monnaie") or eco["monnaie"]
        eco["joueurs"] = sorted(({"nom": p.get("nom"), "solde": _num(p.get("solde")) or 0, "faction": p.get("faction"),
                                  "vuLe": p.get("vuLe")} for p in comptes["joueurs"] if p.get("nom")),
                                key=lambda p: -p["solde"])
        for p in comptes["joueurs"]:
            if p.get("uuid"):
                faction_of[p["uuid"]] = p.get("faction")
    else:
        eco["joueurs"] = None

    fac = _load(sftp, read, j, "factions.json", log)
    if fac and isinstance(fac.get("factions"), list):
        eco["factions"] = [{"id": f.get("id"), "tag": f.get("tag") or f.get("id"), "couleur": f.get("couleur"),
                            "banque": _num(f.get("banque")) or 0,
                            "membres": [{"nom": m.get("nom"), "role": str(m.get("role") or "membre").lower()}
                                        for m in (f.get("membres") or []) if m.get("nom")]}
                           for f in fac["factions"]]
    else:
        eco["factions"] = None

    bt = _load(sftp, read, j, "boutiques.json", log)
    if bt and isinstance(bt.get("boutiques"), list):
        shops = []
        for s in bt["boutiques"]:
            ot = str(s.get("proprietaireType") or "").lower()
            # Faction de la boutique : la faction propriétaire, ou celle du joueur propriétaire
            f = s.get("proprietaireId") if ot == "faction" else faction_of.get(s.get("proprietaireId")) if ot == "joueur" else None
            shops.append({"id": s.get("id"), "type": str(s.get("type") or "").lower(), "proprietaireType": ot,
                          "proprietaire": s.get("proprietaire"), "faction": f, "monde": s.get("monde"),
                          "x": s.get("x"), "y": s.get("y"), "z": s.get("z"), "item": s.get("item"), "nom": s.get("nom"),
                          "service": s.get("service"), "quantite": s.get("quantite") or 1, "prix": _num(s.get("prix")),
                          "stock": s.get("stock"), "capacite": s.get("capacite") if isinstance(s.get("capacite"), int) and s.get("capacite") > 0 else None, "rupture": bool(s.get("rupture")), "ventes": s.get("ventes") or 0,
                          "itemsEchanges": s.get("itemsEchanges") or 0, "chiffreAffaires": _num(s.get("chiffreAffaires")) or 0,
                          "creeLe": s.get("creeLe"), "details": _details(s.get("details")),
                          # Boutique de lot (mod 2.4) : 2 à 9 items différents vendus ensemble
                          "lot": [{"item": x.get("item"), "nom": x.get("nom"), "quantite": x.get("quantite") or 1, "details": _details(x.get("details"))}
                                  for x in (s.get("lot") or []) if isinstance(x, dict) and x.get("item")] or None})
        eco["boutiques"] = shops
    else:
        eco["boutiques"] = None

    fisc = _load(sftp, read, j, "prix-fisc.json", log)
    if fisc and (isinstance(fisc.get("rachat"), list) or isinstance(fisc.get("vente"), list)):
        clean = lambda lst: [{"item": r.get("item"), "nom": r.get("nom"), "prix": _num(r.get("prix")), "quantite": r.get("quantite"),
                              "x": r.get("x"), "y": r.get("y"), "z": r.get("z")} for r in (lst or [])]
        eco["fisc"] = {"rachat": clean(fisc.get("rachat")), "vente": clean(fisc.get("vente")), "prixDynamiques": fisc.get("prixDynamiques"),
                       # Objets rares (mod 2.5+) : rachetés aux PNJ sans être détruits, revendus au double ; prix selon le stock (2.6)
                       "revente": bool(fisc.get("revente")),
                       "reprise": [{"item": r.get("item"), "nom": r.get("nom"), "categorie": r.get("categorie"), "rachete": r.get("rachete", True),
                                    "prixRachat": _num(r.get("prixRachat")), "prixReference": _num(r.get("prixReference")),
                                    "demiStock": r.get("demiStock"), "baissePct": _num(r.get("baissePct")), "demandes": r.get("demandes") or 0,
                                    "stock": r.get("stock"), "rupture": bool(r.get("rupture")), "prixRevente": _num(r.get("prixRevente")),
                                    "details": _details(r.get("details"))}
                                   for r in (fisc.get("reprise") or []) if isinstance(r, dict) and r.get("item")]}
    else:
        eco["fisc"] = None

    st = _load(sftp, read, j, "stats.json", log)
    if st and isinstance(st, dict) and "masseMonetaire" in st:
        eco["stats"] = {k: st.get(k) for k in ("masseMonetaire", "soldesJoueurs", "banquesFactions", "nbJoueurs", "nbBoutiques",
                                                "nbFactions", "parJour7j", "topVentesJoueurs7j", "rachatsFisc7j", "genereLe")}
    else:
        eco["stats"] = None

    hdv = _load(sftp, read, j, "hdv.json", log)
    if hdv and isinstance(hdv.get("annonces"), list):
        eco["hdv"] = sorted(({"id": a.get("id"), "vendeur": a.get("vendeur"), "item": a.get("item"), "nom": a.get("nom"),
                              "quantite": a.get("quantite") or 1, "prixDepart": _num(a.get("prixDepart")),
                              "achatImmediat": _num(a.get("achatImmediat")), "offreActuelle": _num(a.get("offreActuelle")),
                              "meilleurEncherisseur": a.get("meilleurEncherisseur"), "nbOffres": a.get("nbOffres") or 0,
                              "fin": _ms(a.get("fin")), "details": _details(a.get("details"))} for a in hdv["annonces"]), key=lambda a: a["fin"] or 0)
    else:
        eco["hdv"] = None

    # Courbe de la masse monétaire : une ligne JSON par heure (t, masseMonetaire — ou « montant »)
    try:
        points = []
        for line in read(sftp, j(EXPORT, "masse-monetaire.jsonl")).decode("utf-8", "replace").splitlines():
            if not line.strip():
                continue
            try:
                o = json.loads(line)
            except ValueError:
                continue
            t, v = _ms(o.get("t")), _num(o.get("masseMonetaire", o.get("montant")))
            if t and v is not None:
                points.append([t, v])
        points.sort()
        ouv = _ms(OUVERTURE)
        eco["ouverture"] = ouv
        points = [p for p in points if p[0] >= ouv]
        # Les heures d'avant l'installation du mod valent 0 : la courbe part de l'ouverture (0),
        # puis passe directement au premier relevé réel (le site relie les deux en pointillés)
        while points and points[0][1] == 0:
            points.pop(0)
        if len(points) > MAX_POINTS:
            # Les 14 derniers jours gardent tous leurs points, le reste est allégé
            recent = [p for p in points if p[0] >= points[-1][0] - 14 * 86_400_000]
            old = points[:len(points) - len(recent)]
            keep = max(2, MAX_POINTS - len(recent))
            if len(old) > keep:
                step = len(old) / keep
                old = [old[int(i * step)] for i in range(keep)]
            points = old + recent
        if points and points[0][0] > ouv:
            points.insert(0, [ouv, 0])
        eco["masse"] = points if len(points) > 1 else None
    except Exception as e:
        log(f"Économie : masse-monetaire.jsonl indisponible ({type(e).__name__})")
        eco["masse"] = None

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(eco, f, ensure_ascii=False, separators=(",", ":"))
    ok = [k for k in ("boutiques", "factions", "joueurs", "fisc", "stats", "hdv", "masse") if eco.get(k) is not None]
    return f"économie : {len(ok)}/7 fichiers ({', '.join(ok) or 'aucun'})"


def items(eco_path):
    """Items présents dans eco.json (pour extraire leurs icônes)."""
    try:
        eco = json.load(open(eco_path, encoding="utf-8"))
    except Exception:
        return set()
    out = set()
    for s in eco.get("boutiques") or []:
        out.add(s.get("item"))
        for x in s.get("lot") or []:
            out.add(x.get("item"))
    for a in eco.get("hdv") or []:
        out.add(a.get("item"))
    for k in ("rachat", "vente", "reprise"):
        for r in (eco.get("fisc") or {}).get(k) or []:
            out.add(r.get("item"))
    for r in (eco.get("stats") or {}).get("rachatsFisc7j") or []:
        out.add(r.get("item"))
    return {str(i).replace("minecraft:", "") for i in out if i and re.fullmatch(r"(minecraft:)?[a-z0-9_]+", str(i))}


# ---------------------------------------------------------------- journal → Worker

def _token(secret):
    return base64.urlsafe_b64encode(hashlib.sha256(f"sumenium:ingest:{secret}".encode()).digest()).rstrip(b"=").decode()


def push_journal(sftp, read, j, log, notice):
    """Envoie au Worker les lignes du journal qu'il n'a pas encore (reprise depuis sa dernière transaction)."""
    secret = os.environ.get("DISCORD_CLIENT_SECRET")
    if not secret:
        return
    base = (os.environ.get("ESPACE_URL") or "https://sumenium.com").rstrip("/") + "/api/ingest/journal"
    headers = {"content-type": "application/json", "authorization": f"Bearer {_token(secret)}", "user-agent": "sumenium-update/1.0"}
    try:
        with urllib.request.urlopen(urllib.request.Request(base, headers=headers), timeout=20) as r:
            last = int(json.loads(r.read()).get("lastT") or 0)
    except Exception as e:
        notice("warning", f"Journal non envoyé à l'Espace : {e}")
        return
    try:
        files = sorted(f for f in sftp.listdir(j(JOURNAL)) if re.fullmatch(r"\d{4}-\d{2}-\d{2}\.jsonl", f))
    except IOError:
        return  # pas encore de journal
    # On relit depuis la veille de la dernière transaction connue (les doublons sont ignorés par le Worker)
    since = (datetime.fromtimestamp(last / 1000, timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d") if last else ""
    margin = last - 3_600_000
    lines = []
    for f in files:
        if f[:10] < since:
            continue
        for line in read(sftp, posixpath.join(j(JOURNAL), f)).decode("utf-8", "replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                t = int(json.loads(line).get("t") or 0)
            except ValueError:
                continue
            if t >= margin:
                lines.append(line)
    sent = 0
    for i in range(0, len(lines), CHUNK):
        body = json.dumps({"lines": lines[i:i + CHUNK]}).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request(base, data=body, method="POST", headers=headers), timeout=30) as r:
                sent += int(json.loads(r.read()).get("added") or 0)
        except Exception as e:
            notice("warning", f"Journal envoyé en partie seulement : {e}")
            break
    if sent:
        log(f"Journal : {sent} nouvelles transactions envoyées à l'Espace")
