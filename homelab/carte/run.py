"""Carte Suménium sur le homelab.

En boucle :
  1. copie en SFTP les régions de l'Overworld qui ont changé (rien d'autre : ni Nether, ni End,
     ni fichiers de joueurs) ;
  2. lit la bordure actuelle et écrit la configuration BlueMap (tracé de la bordure +
     « brouillard » qui masque la zone hors bordure, désactivable) ;
  3. lance BlueMap, qui ne redessine que ce qui a changé.
En parallèle, toutes les 5 minutes : marqueurs du mod Sumenium Economy (boutiques, FISC, hôtel des ventes)
fusionnés dans les marqueurs de la carte (seuls les ensembles « sumenium-* » sont remplacés).

Tout se règle dans le fichier .env (voir .env.example).
"""
import contextlib, io, json, math, os, posixpath, re, shutil, socket, stat, subprocess, sys, tempfile, threading, time
from datetime import datetime

import nbtlib
import paramiko

E = os.environ.get
DATA = "/data"
WORLD = f"{DATA}/world"
BM = f"{DATA}/bluemap"
WEB = f"{DATA}/web"

CENTER_X = float(E("MAP_CENTER_X", "0"))
CENTER_Z = float(E("MAP_CENTER_Z", "0"))
RADIUS = int(E("MAP_RADIUS", "10000"))
INTERVAL = int(E("INTERVAL_MINUTES", "60")) * 60
THREADS = int(E("RENDER_THREADS", "8"))
XMX = E("JAVA_XMX", "6G")
MAP_NAME = E("MAP_NAME", "Suménium · Overworld")
MC_VERSION = E("BLUEMAP_MC_VERSION", "26.3")
FOG = E("FOG_COLOR", "18,30,22")
MARKERS_EVERY = int(E("MARKERS_MINUTES", "5")) * 60
ECO_MARKERS = "sumenium-data/export/bluemap-markers.json"
LIVE_MARKERS = f"{WEB}/maps/overworld/live/markers.json"
_eco_sets = {}


def log(*a):
    print(datetime.now().strftime("[%d/%m %H:%M:%S]"), *a, flush=True)


def connect():
    host = E("SFTP_HOST", "").strip()
    host = re.sub(r"^[a-z]+://", "", host).split("/")[0]
    if "@" in host:
        host = host.split("@", 1)[1]
    port = (E("SFTP_PORT") or "").strip()
    if ":" in host:
        host, p = host.rsplit(":", 1)
        port = port or p
    sock = socket.create_connection((host, int(port or 22)), timeout=30)
    t = paramiko.Transport(sock)
    t.banner_timeout = t.auth_timeout = 30
    try:
        t.connect(username=E("SFTP_USER", "").strip(), password=E("SFTP_PASSWORD", "").strip("\r\n"))
        sftp = paramiko.SFTPClient.from_transport(t)
        sftp.get_channel().settimeout(120)
    except BaseException:
        t.close()
        raise
    return sftp


@contextlib.contextmanager
def session():
    """Une session SFTP fermée à coup sûr. sftp.close() seul ferme le canal mais laisse la session SSH
    ouverte tant que le programme tourne : MineStrator limite les sessions et bloque les nouvelles."""
    with _sftp_lock:  # jamais deux sessions en même temps (rendu et marqueurs)
        sftp = connect()
        try:
            yield sftp
        finally:
            try:
                sftp.close()
            finally:
                sftp.get_channel().get_transport().close()


_sftp_lock = threading.Lock()


def read(sftp, path):
    buf = io.BytesIO()
    sftp.getfo(path, buf)
    return buf.getvalue()


def load_nbt(raw):
    with tempfile.NamedTemporaryFile(suffix=".dat", delete=False) as f:
        f.write(raw)
    try:
        return nbtlib.load(f.name)
    finally:
        os.unlink(f.name)


def sync():
    """Copie les régions modifiées et renvoie la bordure (centre x, z, largeur)."""
    with session() as sftp:
        return _sync(sftp)


def _sync(sftp):
    root = E("SFTP_ROOT") or "."
    j = lambda *p: posixpath.join(root, *p)
    level = "world"
    try:
        for line in read(sftp, j("server.properties")).decode("utf-8", "replace").splitlines():
            if line.startswith("level-name="):
                level = line.split("=", 1)[1].strip() or "world"
    except IOError:
        pass
    w = lambda *p: j(level, *p)

    border = None
    try:
        d = load_nbt(read(sftp, w("dimensions/minecraft/overworld/data/minecraft/world_border.dat")))["data"]
        border = (float(d["center_x"]), float(d["center_z"]), float(d["size"]))
    except Exception:
        try:
            d = load_nbt(read(sftp, w("level.dat")))["Data"]
            border = (float(d["BorderCenterX"]), float(d["BorderCenterZ"]), float(d["BorderSize"]))
        except Exception:
            log("Bordure introuvable : pas de tracé ni de brouillard ce tour-ci")

    region_rel = None
    for rel in ("dimensions/minecraft/overworld/region", "region"):
        try:
            sftp.listdir(w(rel))
            region_rel = rel
            break
        except IOError:
            continue
    if not region_rel:
        raise RuntimeError("dossier des régions de l'Overworld introuvable")

    local = os.path.join(WORLD, *region_rel.split("/"))
    os.makedirs(local, exist_ok=True)
    with open(os.path.join(WORLD, "level.dat"), "wb") as f:
        f.write(read(sftp, w("level.dat")))

    x0, x1 = math.floor(CENTER_X - RADIUS), math.ceil(CENTER_X + RADIUS) - 1
    z0, z1 = math.floor(CENTER_Z - RADIUS), math.ceil(CENTER_Z + RADIUS) - 1
    wanted = {f"r.{x}.{z}.mca" for x in range(x0 // 512, x1 // 512 + 1) for z in range(z0 // 512, z1 // 512 + 1)}
    remote = {a.filename: a for a in sftp.listdir_attr(w(region_rel)) if stat.S_ISREG(a.st_mode)}
    todo = []
    for name in sorted(wanted & remote.keys()):
        a, dst = remote[name], os.path.join(local, name)
        if os.path.exists(dst):
            st = os.stat(dst)
            if st.st_size == a.st_size and int(st.st_mtime) == int(a.st_mtime):
                continue
        todo.append(name)
    log(f"Régions à copier : {len(todo)} sur {len(wanted & remote.keys())}")
    for i, name in enumerate(todo, 1):
        a, dst = remote[name], os.path.join(local, name)
        sftp.get(w(region_rel, name), dst + ".part")
        os.replace(dst + ".part", dst)
        os.utime(dst, (a.st_atime, a.st_mtime))
        if i % 50 == 0:
            log(f"  {i}/{len(todo)}")
    return border, (x0, x1, z0, z1)


def write_config(border, box):
    cfg = f"{BM}/config"
    for d in (cfg, f"{cfg}/maps", f"{cfg}/storages", WEB):
        os.makedirs(d, exist_ok=True)
    for f in os.listdir(f"{cfg}/maps"):
        if f != "overworld.conf":
            os.remove(f"{cfg}/maps/{f}")
    x0, x1, z0, z1 = box

    def W(name, txt):
        with open(f"{cfg}/{name}", "w", encoding="utf-8") as f:
            f.write(txt)

    W("core.conf", f'''accept-download: true
data: "{BM}/data"
render-thread-count: {THREADS}
scan-for-mod-resources: false
metrics: false
log: {{ file: "{BM}/bluemap.log", append: false }}
''')
    W("storages/file.conf", f'''storage-type: file
root: "{WEB}/maps"
compression: gzip
''')
    W("webapp.conf", f'''enabled: true
webroot: "{WEB}"
update-settings-file: true
use-cookies: true
default-to-flat-view: true
client-decompression: true
scripts: [ "anti-spoil.js" ]
''')
    W("webserver.conf", "enabled: false\n")

    markers = ""
    if border:
        cx, cz, size = border
        h = size / 2
        bx0, bx1, bz0, bz1 = cx - h, cx + h, cz - h, cz + h
        sq = lambda a0, a1, b0, b1: f"[ {{ x: {a0}, z: {b0} }}, {{ x: {a1}, z: {b0} }}, {{ x: {a1}, z: {b1} }}, {{ x: {a0}, z: {b1} }} ]"
        r, g, b = [int(v) for v in FOG.split(",")]
        markers = f'''
  bordure: {{
    label: "Bordure actuelle"
    toggleable: true
    default-hidden: false
    sorting: 0
    markers: {{
      ligne: {{
        type: "shape"
        position: {{ x: {cx}, y: 320, z: {cz} }}
        label: "Bordure du monde ({int(size)} blocs de large)"
        shape: {sq(bx0, bx1, bz0, bz1)}
        shape-y: 320
        line-width: 3
        line-color: {{ r: 255, g: 200, b: 40, a: 1.0 }}
        fill-color: {{ r: 0, g: 0, b: 0, a: 0.0 }}
        depth-test: false
      }}
    }}
  }}
  brouillard: {{
    label: "Masquer hors bordure (anti-spoil)"
    toggleable: true
    default-hidden: false
    sorting: 1
    markers: {{
      zone: {{
        type: "shape"
        position: {{ x: {cx}, y: 319, z: {cz} }}
        label: "Hors bordure"
        shape: {sq(x0 - 64, x1 + 64, z0 - 64, z1 + 64)}
        holes: [ {sq(bx0, bx1, bz0, bz1)} ]
        shape-y: 319
        line-width: 0
        line-color: {{ r: 0, g: 0, b: 0, a: 0.0 }}
        fill-color: {{ r: {r}, g: {g}, b: {b}, a: 1.0 }}
        depth-test: false
      }}
    }}
  }}'''
    start = f"{{ x: {int(border[0])}, z: {int(border[1])} }}" if border else f"{{ x: {int(CENTER_X)}, z: {int(CENTER_Z)} }}"
    W("maps/overworld.conf", f'''world: "{WORLD}"
dimension: "minecraft:overworld"
name: "{MAP_NAME}"
sorting: 0
start-pos: {start}
sky-color: "#7dabff"
render-mask: [ {{ min-x: {x0}, max-x: {x1}, min-z: {z0}, max-z: {z1} }} ]
render-edges: true
enable-hires: true
enable-perspective-view: true
enable-flat-view: true
enable-free-flight-view: false
ignore-missing-light-data: true
storage: "file"
marker-sets: {{{markers}
}}
''')


def merge_markers():
    """Remplace les ensembles « sumenium-* » du markers.json de la carte, sans toucher aux autres (bordure, brouillard)."""
    if not _eco_sets or not os.path.isdir(os.path.dirname(LIVE_MARKERS)):
        return
    try:
        with open(LIVE_MARKERS, encoding="utf-8") as f:
            cur = json.load(f)
        if not isinstance(cur, dict):
            cur = {}
    except (OSError, ValueError):
        cur = {}
    merged = {k: v for k, v in cur.items() if not k.startswith("sumenium-")}
    merged.update(_eco_sets)
    tmp = LIVE_MARKERS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, separators=(",", ":"))
    os.chmod(tmp, 0o644)
    os.replace(tmp, LIVE_MARKERS)


def markers_loop():
    """Toutes les 5 minutes : relit les marqueurs du mod en SFTP et les fusionne dans la carte."""
    global _eco_sets
    while True:
        try:
            with session() as sftp:
                data = json.loads(read(sftp, posixpath.join(E("SFTP_ROOT") or ".", ECO_MARKERS)))
            sets = {k: v for k, v in data.items() if k.startswith("sumenium-") and isinstance(v, dict) and isinstance(v.get("markers"), dict)}
            if sets:
                _eco_sets = sets
                merge_markers()
        except FileNotFoundError:
            pass  # le mod n'a pas encore exporté de marqueurs
        except Exception as e:
            log("Marqueurs Suménium :", type(e).__name__, e)
        time.sleep(MARKERS_EVERY)


# À changer quand le correctif BlueMap évolue : la carte est alors entièrement redessinée une fois.
RENDER_VERSION = "bluemap-dev-a61e143"


def reset_if_needed():
    marker = f"{BM}/render-version"
    try:
        current = open(marker).read().strip()
    except OSError:
        current = ""
    if current != RENDER_VERSION:
        log("Nouvelle version du rendu : la carte va être entièrement redessinée")
        shutil.rmtree(f"{WEB}/maps/overworld", ignore_errors=True)
        os.makedirs(BM, exist_ok=True)
        with open(marker, "w") as f:
            f.write(RENDER_VERSION)


def render():
    cmd = ["java", f"-Xmx{XMX}", "-jar", "/opt/bluemap-cli.jar", "-c", f"{BM}/config",
           "-v", MC_VERSION, "-r", "-g", "-s", "--markers"]
    log("BlueMap :", " ".join(cmd[3:]))
    t = time.time()
    # Le script anti-spoil doit être en place avant le rendu (qui peut durer des heures)
    shutil.copy("/app/anti-spoil.js", f"{WEB}/anti-spoil.js")
    res = subprocess.run(cmd, cwd=BM)
    shutil.copy("/app/anti-spoil.js", f"{WEB}/anti-spoil.js")
    merge_markers()  # BlueMap réécrit markers.json : on remet tout de suite les marqueurs du mod
    log(f"BlueMap terminé (code {res.returncode}) en {int((time.time() - t) / 60)} min")


def main():
    if not E("SFTP_HOST"):
        sys.exit("SFTP_HOST manquant dans .env")
    threading.Thread(target=markers_loop, daemon=True).start()
    while True:
        start = time.time()
        try:
            border, box = sync()
            write_config(border, box)
            reset_if_needed()
            render()
        except Exception as e:
            log("Erreur :", type(e).__name__, e)
        wait = max(60, INTERVAL - (time.time() - start))
        log(f"Prochain passage dans {int(wait / 60)} min")
        time.sleep(wait)


if __name__ == "__main__":
    main()
