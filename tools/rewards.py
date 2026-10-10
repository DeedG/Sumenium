"""Lecture des récompenses BACAP (commandes give / xp) pour le catalogue du site."""
import json
import re

ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]


class SNBT:
    """Petit lecteur SNBT : assez pour les composants d'objets des commandes give."""

    def __init__(self, s):
        self.s, self.i = s, 0

    def ws(self):
        while self.i < len(self.s) and self.s[self.i] in " \t\n\r":
            self.i += 1

    def peek(self):
        self.ws()
        return self.s[self.i] if self.i < len(self.s) else ""

    def value(self):
        c = self.peek()
        if c == "{":
            return self.compound()
        if c == "[":
            return self.list()
        if c in "\"'":
            return self.string()
        return self.bare()

    def string(self):
        q = self.s[self.i]
        self.i += 1
        out = []
        while self.i < len(self.s):
            ch = self.s[self.i]
            if ch == "\\":
                out.append(self.s[self.i + 1])
                self.i += 2
                continue
            if ch == q:
                self.i += 1
                break
            out.append(ch)
            self.i += 1
        return "".join(out)

    def bare(self):
        m = re.compile(r"[^,\]\}\s:=]+").match(self.s, self.i)
        tok = m.group(0) if m else ""
        self.i += len(tok)
        low = tok.lower()
        if low == "true":
            return True
        if low == "false":
            return False
        n = re.fullmatch(r"(-?\d+(?:\.\d+)?)[bBsSlLfFdD]?", tok)
        if n:
            v = float(n.group(1))
            return int(v) if v.is_integer() and "." not in n.group(1) else v
        return tok

    KEY = re.compile(r"[A-Za-z0-9_.\-+]+(?::[A-Za-z0-9_.\-/+]+)?(?=\s*[=:])")

    def key(self):
        c = self.peek()
        if c in "\"'":
            k = self.string()
        else:
            m = self.KEY.match(self.s, self.i)
            k = m.group(0) if m else self.bare()
            if m:
                self.i += len(k)
        self.ws()
        if self.i < len(self.s) and self.s[self.i] in ":=":
            self.i += 1
        return str(k)

    def compound(self, end="}"):
        self.i += 1
        out = {}
        while True:
            c = self.peek()
            if c == end:
                self.i += 1
                return out
            if c == ",":
                self.i += 1
                continue
            if not c:
                return out
            k = self.key()
            out[k] = self.value()

    def list(self):
        self.i += 1
        out = []
        if re.match(r"[BIL];", self.s[self.i:self.i + 2]):
            self.i += 2
        while True:
            c = self.peek()
            if c == "]":
                self.i += 1
                return out
            if c == ",":
                self.i += 1
                continue
            if not c:
                return out
            out.append(self.value())


def strip_ns(k):
    return k.split(":", 1)[-1]


def text(c):
    """Composant de texte → {t, c, b, i} (BACAP met souvent le texte anglais dans "translate")."""
    if isinstance(c, str):
        return {"t": c}
    if isinstance(c, list):
        parts = [text(x) for x in c]
        first = parts[0] if parts else {"t": ""}
        return dict(first, t="".join(p["t"] for p in parts))
    if not isinstance(c, dict):
        return {"t": str(c)}
    t = c.get("text")
    if t is None:
        t = vanilla(c.get("translate", ""))
    for e in c.get("extra", []) or []:
        t += text(e)["t"]
    out = {"t": t}
    if c.get("color"):
        out["c"] = c["color"]
    if c.get("bold"):
        out["b"] = 1
    if c.get("italic") is False:
        out["i"] = 0
    return out


def vanilla(key):
    """Clés de traduction Minecraft courantes → texte lisible."""
    if key.startswith("enchantment.level."):
        n = int(key.rsplit(".", 1)[1])
        return ROMAN[n] if n < len(ROMAN) else str(n)
    for pre in ("enchantment.minecraft.", "item.minecraft.", "block.minecraft.", "effect.minecraft.", "entity.minecraft."):
        if key.startswith(pre):
            return pretty(key[len(pre):])
    return key


def pretty(i):
    return strip_ns(i).replace("_", " ").replace(".", " ").title()


def ench_list(v):
    if isinstance(v, dict) and "levels" in v:
        v = v["levels"]
    if not isinstance(v, dict):
        return []
    return [[pretty(k), int(lv)] for k, lv in v.items() if isinstance(lv, (int, float))]


GIVE = re.compile(r"^give\s+@\S+\s+([a-z0-9_:.\-/]+)(.*)$")


def parse_give(line):
    m = GIVE.match(line.strip())
    if not m:
        return None
    item, rest = strip_ns(m.group(1)), m.group(2).strip()
    comps = {}
    if rest.startswith("["):
        p = SNBT(rest)
        comps = {strip_ns(k): v for k, v in p.compound("]").items()}
        rest = rest[p.i:].strip()
    count = int(rest.split()[0]) if rest and rest.split()[0].isdigit() else 1
    out = {"id": item, "n": count}
    if "custom_name" in comps:
        out["name"] = text(comps["custom_name"])
    elif "item_name" in comps:
        out["name"] = text(comps["item_name"])
    lore = comps.get("lore")
    if isinstance(lore, list):
        out["lore"] = [text(x) for x in lore]
    hidden = []
    td = comps.get("tooltip_display")
    if isinstance(td, dict):
        hidden = [strip_ns(h) for h in td.get("hidden_components", [])]
    for k, key in (("enchantments", "ench"), ("stored_enchantments", "ench")):
        if k in comps and k not in hidden:
            out[key] = out.get(key, []) + ench_list(comps[k])
    if comps.get("enchantment_glint_override") or comps.get("enchantments") or comps.get("stored_enchantments"):
        out["glint"] = 1
    pc = comps.get("potion_contents")
    if isinstance(pc, dict) and pc.get("potion"):
        out["potion"] = pretty(pc["potion"])
    elif isinstance(pc, str):
        out["potion"] = pretty(pc)
    prof = comps.get("profile")
    if isinstance(prof, dict):
        for prop in prof.get("properties", []) or []:
            if isinstance(prop, dict) and prop.get("name") == "textures":
                try:
                    import base64
                    tex = json.loads(base64.b64decode(prop["value"] + "=="))
                    out["skin"] = tex["textures"]["SKIN"]["url"].replace("http://", "https://")
                except Exception:
                    pass
    ub = comps.get("unbreakable")
    if ub is not None and "unbreakable" not in hidden and not (isinstance(ub, dict) and ub.get("show_in_tooltip") is False):
        out["unbreakable"] = 1
    return out


def parse_function(path):
    """Fichier .mcfunction de récompense → (objets, xp)."""
    items, xp = [], 0
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except OSError:
        return items, xp
    for line in lines:
        line = line.strip()
        if line.startswith("give "):
            it = parse_give(line)
            if it:
                items.append(it)
        m = re.match(r"^(?:xp|experience) add @\S+ (\d+)(?: points)?\s*$", line)
        if m:
            xp += int(m.group(1))
    return items, xp
