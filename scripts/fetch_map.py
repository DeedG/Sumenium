"""Prépare le rendu de la carte : télécharge en SFTP les régions de l'Overworld
situées dans la zone à afficher, puis écrit la configuration de BlueMap.

Seul l'Overworld est téléchargé et configuré : ni le Nether ni l'End n'apparaissent.
La zone suit la bordure du monde (ou un rayon fixe), selon map-config.json.
"""
import json, math, os, posixpath, stat, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update import connect, read, load_nbt, read_border, notice, log  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
WORK = os.path.abspath(os.path.join(ROOT, "work"))
CFG = json.load(open(os.path.join(ROOT, "map-config.json"), encoding="utf-8"))


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
        pass
    w = lambda *p: j(level, *p)

    # Zone à afficher
    border = read_border(sftp, w)
    if CFG.get("mode") == "fixed" or not border:
        cx, cz = CFG.get("center_x", 0), CFG.get("center_z", 0)
        half = CFG.get("fixed_radius", 1000)
        if not border and CFG.get("mode") != "fixed":
            notice("warning", "Bordure introuvable, rayon fixe utilisé")
    else:
        cx, cz = border["x"], border["z"]
        half = border["size"] / 2 + CFG.get("margin", 0)
    half = min(half, CFG.get("max_radius", 3000))
    box = {"min-x": math.floor(cx - half), "max-x": math.ceil(cx + half) - 1,
           "min-z": math.floor(cz - half), "max-z": math.ceil(cz + half) - 1}
    log("Zone de la carte :", box)

    # Dossier des régions de l'Overworld (26.x, puis ancien format)
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

    world_local = os.path.join(WORK, "world")
    reg_local = os.path.join(world_local, *region_rel.split("/"))
    os.makedirs(reg_local, exist_ok=True)
    open(os.path.join(world_local, "level.dat"), "wb").write(read(sftp, w("level.dat")))

    # Régions qui touchent la zone (une région = 512 × 512 blocs)
    rx0, rx1 = box["min-x"] // 512, box["max-x"] // 512
    rz0, rz1 = box["min-z"] // 512, box["max-z"] // 512
    wanted = {f"r.{x}.{z}.mca" for x in range(rx0, rx1 + 1) for z in range(rz0, rz1 + 1)}
    remote = {a.filename: a for a in sftp.listdir_attr(w(region_rel)) if stat.S_ISREG(a.st_mode)}
    got = skipped = 0
    for name in sorted(wanted & remote.keys()):
        a = remote[name]
        dst = os.path.join(reg_local, name)
        if os.path.exists(dst):
            st = os.stat(dst)
            if st.st_size == a.st_size and int(st.st_mtime) == int(a.st_mtime):
                skipped += 1
                continue
        sftp.get(w(region_rel, name), dst + ".part")
        os.replace(dst + ".part", dst)
        os.utime(dst, (a.st_atime, a.st_mtime))
        got += 1
    # On retire les régions qui ne sont plus dans la zone
    for name in os.listdir(reg_local):
        if name.endswith(".mca") and name not in wanted:
            os.remove(os.path.join(reg_local, name))
    sftp.close()
    log(f"Régions : {got} téléchargées, {skipped} inchangées")

    # Configuration BlueMap : uniquement l'Overworld, limité à la zone
    cfg = os.path.join(WORK, "bluemap-config")
    os.makedirs(os.path.join(cfg, "maps"), exist_ok=True)
    os.makedirs(os.path.join(cfg, "storages"), exist_ok=True)
    for f in os.listdir(os.path.join(cfg, "maps")):
        if f != "overworld.conf":
            os.remove(os.path.join(cfg, "maps", f))
    W = lambda name, txt: open(os.path.join(cfg, name), "w", encoding="utf-8").write(txt)
    W("core.conf", f'''accept-download: true
data: "{WORK}/bluemap-data"
render-thread-count: 4
scan-for-mod-resources: false
metrics: false
log: {{ file: "{WORK}/bluemap.log", append: false }}
''')
    W("storages/file.conf", f'''storage-type: file
root: "{WORK}/web/maps"
compression: gzip
''')
    W("webapp.conf", f'''enabled: true
webroot: "{WORK}/web"
update-settings-file: true
use-cookies: true
default-to-flat-view: {str(CFG.get("flat_view_default", True)).lower()}
client-decompression: true
''')
    W("webserver.conf", "enabled: false\n")
    W("maps/overworld.conf", f'''world: "{world_local}"
dimension: "minecraft:overworld"
name: "{CFG.get("name", "Overworld")}"
sorting: 0
start-pos: {{ x: {int(cx)}, z: {int(cz)} }}
sky-color: "#7dabff"
render-mask: [ {{ min-x: {box["min-x"]}, max-x: {box["max-x"]}, min-z: {box["min-z"]}, max-z: {box["max-z"]} }} ]
render-edges: true
enable-hires: {str(CFG.get("hires", True)).lower()}
enable-perspective-view: true
enable-flat-view: true
enable-free-flight-view: false
ignore-missing-light-data: true
storage: "file"
marker-sets: {{}}
''')
    json.dump({"box": box, "center": [cx, cz]}, open(os.path.join(WORK, "map-zone.json"), "w"))
    notice("notice", f"Carte : zone {box['max-x'] - box['min-x'] + 1} × {box['max-z'] - box['min-z'] + 1} blocs, {got} régions mises à jour")


if __name__ == "__main__":
    main()
