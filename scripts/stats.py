"""Classements du site : écrit site/stats.json.

Sources lues en SFTP (lecture seule) :
  - scoreboard : Morts, premiers succès (bac_advfirst), total de succès (bac_advancements)
  - <monde>/players/stats/*.json : statistiques Minecraft de chaque joueur
  - stats/player_data/*.json : mod Player Stats (causes de mort, minerais…)
  - config/savs-common-economy/balances.json, shops.json et logs/economy.log : économie
"""
import json, os, posixpath, re, stat

TOP = 15  # joueurs gardés par statistique

# Objectifs du tableau (Tab) en jeu
TAB = [
    ("bac_advancements", "Succès obtenus"),
    ("bac_advfirst", "Premiers succès"),
    ("Morts", "Morts"),
]

CATEGORIES = {
    "minecraft:custom": "Général",
    "minecraft:mined": "Blocs minés",
    "minecraft:crafted": "Objets fabriqués",
    "minecraft:used": "Objets utilisés",
    "minecraft:broken": "Outils usés jusqu'à casser",
    "minecraft:picked_up": "Objets ramassés",
    "minecraft:dropped": "Objets jetés",
    "minecraft:killed": "Créatures tuées",
    "minecraft:killed_by": "Tué par",
}

# Libellés et unités des statistiques générales (les autres gardent leur nom anglais)
CUSTOM = {
    "play_time": ("Temps de jeu", "time"), "total_world_time": ("Temps dans le monde", "time"),
    "time_since_death": ("Temps depuis la dernière mort", "time"), "time_since_rest": ("Temps depuis le dernier sommeil", "time"),
    "sneak_time": ("Temps accroupi", "time"), "deaths": ("Morts", "n"), "player_kills": ("Joueurs tués", "n"),
    "mob_kills": ("Créatures tuées", "n"), "damage_dealt": ("Dégâts infligés", "dmg"), "damage_taken": ("Dégâts subis", "dmg"),
    "damage_blocked_by_shield": ("Dégâts bloqués au bouclier", "dmg"), "damage_absorbed": ("Dégâts absorbés", "dmg"),
    "damage_resisted": ("Dégâts résistés", "dmg"), "walk_one_cm": ("Distance à pied", "cm"),
    "sprint_one_cm": ("Distance en sprint", "cm"), "crouch_one_cm": ("Distance accroupi", "cm"),
    "swim_one_cm": ("Distance à la nage", "cm"), "fall_one_cm": ("Distance de chute", "cm"),
    "climb_one_cm": ("Distance d'escalade", "cm"), "fly_one_cm": ("Distance en vol", "cm"),
    "aviate_one_cm": ("Distance en élytres", "cm"), "boat_one_cm": ("Distance en bateau", "cm"),
    "horse_one_cm": ("Distance à cheval", "cm"), "minecart_one_cm": ("Distance en wagonnet", "cm"),
    "pig_one_cm": ("Distance à dos de cochon", "cm"), "strider_one_cm": ("Distance à dos d'arpenteur", "cm"),
    "walk_on_water_one_cm": ("Distance sur l'eau", "cm"), "walk_under_water_one_cm": ("Distance sous l'eau", "cm"),
    "happy_ghast_one_cm": ("Distance à dos de ghast", "cm"), "nautilus_one_cm": ("Distance à dos de nautile", "cm"),
    "jump": ("Sauts", "n"), "leave_game": ("Déconnexions", "n"), "fish_caught": ("Poissons pêchés", "n"),
    "animals_bred": ("Animaux élevés", "n"), "traded_with_villager": ("Échanges avec des villageois", "n"),
    "talked_to_villager": ("Discussions avec des villageois", "n"), "enchant_item": ("Objets enchantés", "n"),
    "sleep_in_bed": ("Nuits dans un lit", "n"), "open_chest": ("Coffres ouverts", "n"),
    "open_enderchest": ("Coffres de l'Ender ouverts", "n"), "open_shulker_box": ("Boîtes de Shulker ouvertes", "n"),
    "open_barrel": ("Tonneaux ouverts", "n"), "drop": ("Objets jetés", "n"), "eat_cake_slice": ("Parts de gâteau mangées", "n"),
    "raid_win": ("Raids gagnés", "n"), "raid_trigger": ("Raids déclenchés", "n"), "bell_ring": ("Cloches sonnées", "n"),
    "target_hit": ("Cibles touchées", "n"), "play_noteblock": ("Blocs musicaux joués", "n"), "play_record": ("Disques joués", "n"),
    "use_cauldron": ("Eau prise au chaudron", "n"), "fill_cauldron": ("Chaudrons remplis", "n"),
    "interact_with_crafting_table": ("Établis utilisés", "n"), "interact_with_furnace": ("Fours utilisés", "n"),
    "interact_with_anvil": ("Enclumes utilisées", "n"), "interact_with_brewingstand": ("Alambics utilisés", "n"),
    "interact_with_smithing_table": ("Tables de forgeron utilisées", "n"), "interact_with_blast_furnace": ("Hauts fourneaux utilisés", "n"),
    "interact_with_smoker": ("Fumoirs utilisés", "n"), "interact_with_grindstone": ("Meules utilisées", "n"),
    "interact_with_stonecutter": ("Tailleurs de pierre utilisés", "n"), "interact_with_loom": ("Métiers à tisser utilisés", "n"),
    "interact_with_cartography_table": ("Tables de cartographie utilisées", "n"), "interact_with_beacon": ("Balises utilisées", "n"),
    "interact_with_lectern": ("Pupitres utilisés", "n"), "interact_with_campfire": ("Feux de camp utilisés", "n"),
    "inspect_dispenser": ("Distributeurs fouillés", "n"), "inspect_dropper": ("Droppers fouillés", "n"),
    "inspect_hopper": ("Entonnoirs fouillés", "n"), "pot_flower": ("Fleurs mises en pot", "n"),
    "clean_armor": ("Armures nettoyées", "n"), "clean_banner": ("Bannières nettoyées", "n"),
    "clean_shulker_box": ("Boîtes de Shulker nettoyées", "n"), "trigger_trapped_chest": ("Coffres piégés déclenchés", "n"),
    "tune_noteblock": ("Blocs musicaux accordés", "n"), "open_barrel": ("Tonneaux ouverts", "n"),
}

MOD_DEATHS = "Causes de mort"


def pretty(key):
    key = key.split(":", 1)[-1]
    return key.replace("_", " ").replace(".", " ").strip().capitalize()


def read_json(sftp, read, path):
    try:
        return json.loads(read(sftp, path))
    except Exception:
        return None


def list_json(sftp, path):
    try:
        return [a.filename for a in sftp.listdir_attr(path) if a.filename.endswith(".json") and stat.S_ISREG(a.st_mode)]
    except IOError:
        return []


def top(values):
    """values : {pseudo: nombre} → [[pseudo, nombre], ...] trié, sans les zéros."""
    rows = [[k, v] for k, v in values.items() if v]
    rows.sort(key=lambda r: -r[1])
    return rows[:TOP]


def build(sftp, read, j, w, names, teams, scores, log):
    out = {"tab": [], "teams": [], "stats": {}, "categories": [], "economy": None}

    # 1) Valeurs du tableau en jeu
    for obj, label in TAB:
        vals = {k: v for k, v in scores.get(obj, {}).items() if not k.startswith("#") and "/" not in k}
        rows = sorted(([k, v] for k, v in vals.items()), key=lambda r: -r[1])
        out["tab"].append({"id": obj, "label": label, "rows": rows})

    # Classement des équipes (somme des membres)
    team_tot = {}
    for obj, label in TAB:
        for name, v in scores.get(obj, {}).items():
            t = teams.get(name)
            if t:
                team_tot.setdefault(t, {"team": t, "members": 0})
                team_tot[t][obj] = team_tot[t].get(obj, 0) + v
    for name, t in teams.items():
        if t in team_tot:
            team_tot[t]["members"] += 1
    out["teams"] = sorted(team_tot.values(), key=lambda r: (-r.get("bac_advancements", 0), r["team"]))
    out["playerTeams"] = teams

    # 2) Statistiques Minecraft
    stat_dir = None
    for cand in (w("players/stats"), w("stats")):
        if list_json(sftp, cand):
            stat_dir = cand
            break
    per_stat = {}
    if stat_dir:
        for fn in list_json(sftp, stat_dir):
            who = names.get(fn[:-5], fn[:8])
            d = read_json(sftp, read, posixpath.join(stat_dir, fn)) or {}
            for cat, entries in (d.get("stats") or {}).items():
                for key, v in entries.items():
                    per_stat.setdefault((cat, key), {})[who] = v
    # Mod Player Stats : causes de mort (absentes des statistiques Minecraft)
    for fn in list_json(sftp, j("stats/player_data")):
        d = read_json(sftp, read, j("stats/player_data", fn)) or {}
        who = d.get("playerName") or names.get(fn[:-5], fn[:8])
        for cause, v in (d.get("deathCauses") or {}).items():
            per_stat.setdefault((MOD_DEATHS, cause), {})[who] = v

    cats = {}
    for (cat, key), vals in per_stat.items():
        rows = top(vals)
        if not rows:
            continue
        if cat == "minecraft:custom":
            short = key.split(":", 1)[-1]
            label, unit = CUSTOM.get(short, (pretty(key), "n"))
        else:
            label, unit = pretty(key), "n"
        sid = f"{cat}|{key}"
        out["stats"][sid] = {"l": label, "u": unit, "r": rows, "t": sum(vals.values())}
        cats.setdefault(cat, []).append(sid)
    order = list(CATEGORIES) + [MOD_DEATHS]
    for cat in sorted(cats, key=lambda c: order.index(c) if c in order else 99):
        out["categories"].append({"id": cat, "label": CATEGORIES.get(cat, cat), "stats": cats[cat]})
    log(f"Statistiques : {len(out['stats'])} classements")

    # 3) Économie (Savs Common Economy)
    bal = read_json(sftp, read, j("config/savs-common-economy/balances.json"))
    if isinstance(bal, dict):
        rows = []
        for uuid, e in bal.items():
            try:
                rows.append([e.get("name") or names.get(uuid, uuid[:8]), float(e.get("balance") or 0)])
            except (TypeError, ValueError):
                pass
        rows.sort(key=lambda r: -r[1])
        eco = {"baltop": rows, "total": round(sum(r[1] for r in rows), 2), "symbol": "$"}
        cfg = read_json(sftp, read, j("config/savs-common-economy/config.json")) or {}
        eco["symbol"] = cfg.get("currencySymbol", "$")
        eco["before"] = cfg.get("symbolBeforeAmount", True)

        shops = read_json(sftp, read, j("config/savs-common-economy/shops.json")) or {}
        owners = {}
        admin = 0
        for s in shops.get("shops", []):
            if s.get("type") == "ADMIN":
                admin += 1
                continue
            o = s.get("ownerName") or "?"
            owners[o] = owners.get(o, 0) + 1
        eco["shops"] = sorted(([k, v] for k, v in owners.items()), key=lambda r: -r[1])
        eco["adminShops"] = admin

        # Journal des transactions : "[date] [TYPE] De -> Vers: $montant (détail)"
        line_re = re.compile(r"^\[([^\]]+)\] \[([A-Z_]+)\] (.+?) -> (.+?): \D*?(-?[\d.,]+)")
        sent, received, kinds = {}, {}, {}
        try:
            raw = read(sftp, j("logs/economy.log"))[-5_000_000:].decode("utf-8", "replace")
            for line in raw.splitlines():
                m = line_re.match(line)
                if not m:
                    continue
                kind, a, b = m.group(2), m.group(3), m.group(4)
                try:
                    amount = float(m.group(5).replace(",", ""))
                except ValueError:
                    continue
                kinds[kind] = kinds.get(kind, 0) + 1
                if kind.startswith("ADMIN"):
                    continue
                sent[a] = sent.get(a, 0) + amount
                received[b] = received.get(b, 0) + amount
        except Exception as e:
            log("Journal économique illisible :", e)
        eco["sent"] = top({k: round(v, 2) for k, v in sent.items()})
        eco["received"] = top({k: round(v, 2) for k, v in received.items()})
        eco["transactions"] = kinds
        out["economy"] = eco
    return out
