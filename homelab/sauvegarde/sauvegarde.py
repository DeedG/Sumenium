"""Sauvegarde hebdomadaire de la base du site Suménium (Cloudflare D1) sur le NAS.

Lit https://sumenium.com/api/admin/backup avec le jeton BACKUP_TOKEN (le même que le secret GitHub du même nom),
écrit sauvegardes/sumenium-AAAA-MM-JJ.json.gz et garde les BACKUP_KEEP dernières.
Une sauvegarde part au démarrage s'il n'y en a pas de récente, puis chaque semaine (jour et heure réglables).
Aucune dépendance : Python standard uniquement.
"""
import datetime as dt
import gzip
import json
import os
import pathlib
import sys
import time
import urllib.parse
import urllib.request

SITE = os.environ.get("SITE_URL", "https://sumenium.com").rstrip("/")
TOKEN = os.environ.get("BACKUP_TOKEN", "")
OUT = pathlib.Path(os.environ.get("BACKUP_DIR", "/sauvegardes"))
KEEP = int(os.environ.get("BACKUP_KEEP", "12"))
DAY = int(os.environ.get("BACKUP_WEEKDAY", "0"))     # 0 = lundi … 6 = dimanche
HOUR = int(os.environ.get("BACKUP_HOUR", "4"))       # heure locale (TZ)
ONCE = "--once" in sys.argv


def log(*a):
    print(dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


def get(path, **params):
    url = SITE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, headers={"authorization": "Bearer " + TOKEN, "user-agent": "sumenium-sauvegarde"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SystemExit("Jeton refusé : vérifie BACKUP_TOKEN (le même que le secret GitHub, puis redéploie l'Espace).")
            err = e
        except Exception as e:  # réseau
            err = e
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"{url} : {err}")


def backup():
    head = get("/api/admin/backup")
    tables = {}
    for t in [x["name"] for x in head["schema"] if x["type"] == "table"]:
        rows, after = [], 0
        while True:
            page = get("/api/admin/backup", table=t, after=after)
            rows += page["rows"]
            if page["next"] is None:
                break
            after = page["next"]
        tables[t] = rows
    data = {"version": 1, "site": SITE, "at": head["at"], "schema": head["schema"], "tables": tables}
    OUT.mkdir(parents=True, exist_ok=True)
    name = OUT / f"sumenium-{dt.date.today().isoformat()}.json.gz"
    tmp = name.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.chmod(tmp, 0o600)
    tmp.replace(name)
    olds = sorted(OUT.glob("sumenium-*.json.gz"))
    for old in olds[:-KEEP]:
        old.unlink()
    log(f"Sauvegarde écrite : {name.name} ({name.stat().st_size // 1024} ko, "
        f"{sum(len(r) for r in tables.values())} lignes, {len(tables)} tables) ; {min(len(olds), KEEP)} gardées.")


def last_age_days():
    files = sorted(OUT.glob("sumenium-*.json.gz"))
    return (time.time() - files[-1].stat().st_mtime) / 86400 if files else None


def main():
    if len(TOKEN) < 32:
        raise SystemExit("BACKUP_TOKEN manquant ou trop court (32 caractères minimum) dans .env.")
    if ONCE:
        return backup()
    log(f"Sauvegarde hebdomadaire de {SITE} dans {OUT} (jour {DAY}, {HOUR} h, {KEEP} gardées).")
    while True:
        age, now = last_age_days(), dt.datetime.now()
        due = age is None or age > 7.5 or (age > 6 and now.weekday() == DAY and now.hour == HOUR)
        if due:
            try:
                backup()
            except SystemExit:
                raise
            except Exception as e:
                log("Échec, nouvel essai dans une heure :", e)
        time.sleep(3600)


if __name__ == "__main__":
    main()
