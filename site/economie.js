/* Données du mod Sumenium Economy (site/eco.json, relu toutes les 2 min) : onglet Marché, Classements › Richesse, Aide › Commandes.
   Montants des exports en Su. Chaque partie affiche « données indisponibles » si son fichier manque. */
(() => {
const $ = (id) => document.getElementById(id);
const E_ = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let E = null, loaded = false, mode = "marche", sub = "boutiques", timer = null, tick = null;
// Marché : ses sous-onglets. Richesse et Commandes sont affichés ailleurs (Classements, Aide), sans sous-onglets.
const SUBS = [["boutiques", "Acheter / vendre"], ["hdv", "Hôtel des ventes"], ["fisc", "FISC"], ["economie", "Économie du serveur"], ["detail", "Détail de l'économie"]];
const ROOTS = { marche: "ecoRoot", richesse: "richRoot", commandes: "cmdRoot" };
const f = { q: "", owner: "", fac: "", type: "", stock: false, sort: "recent" };  // type : "" | "item" | "service"

const SYM = () => (E && E.monnaie) || "Su";
const su = (v, dec = 2) => v === null || v === undefined || isNaN(v) ? "—"
  : Number(v).toLocaleString("fr-FR", { minimumFractionDigits: Number(v) % 1 && dec ? Math.min(2, dec) : 0, maximumFractionDigits: dec }) + " " + SYM();
const suShort = (v) => Math.abs(v) >= 10000 ? Number(v).toLocaleString("fr-FR", { notation: "compact", maximumFractionDigits: 1 }) + " " + SYM() : su(v, 0);
const n0 = (v) => Number(v || 0).toLocaleString("fr-FR");
const idOf = (item) => String(item || "").replace(/^minecraft:/, "");
const itemName = (item, nom) => {
  const fr = (typeof NAMES !== "undefined" && NAMES[idOf(item)]) || null;
  return fr || nom || idOf(item).replace(/_/g, " ");
};
const ico = (item) => { const id = idOf(item); const label = itemName(item).slice(0, 10);
  return `<img class="eco-ico" src="icons/${E_(id)}.png" alt="" loading="lazy" data-ph="${E_(label)}" onerror="iconFail(this)">`; };
// Détails d'un item (mod v2.2) : enchantements, potion, nom perso, lore, durabilité
const ENCH = { protection: "Protection", fire_protection: "Protection contre le feu", feather_falling: "Chute amortie", blast_protection: "Protection contre les explosions",
  projectile_protection: "Protection contre les projectiles", respiration: "Apnée", aqua_affinity: "Affinité aquatique", thorns: "Épines", depth_strider: "Agilité aquatique",
  frost_walker: "Semelles givrantes", binding_curse: "Malédiction du lien éternel", soul_speed: "Agilité des âmes", swift_sneak: "Furtivité rapide", sharpness: "Tranchant",
  smite: "Châtiment", bane_of_arthropods: "Fléau des arthropodes", knockback: "Recul", fire_aspect: "Aura de feu", looting: "Butin", sweeping_edge: "Affilage",
  efficiency: "Efficacité", silk_touch: "Toucher de soie", unbreaking: "Solidité", fortune: "Fortune", power: "Puissance", punch: "Frappe", flame: "Flamme",
  infinity: "Infinité", luck_of_the_sea: "Chance de la mer", lure: "Appât", loyalty: "Loyauté", impaling: "Empalement", riptide: "Impulsion", channeling: "Canalisation",
  multishot: "Tir multiple", quick_charge: "Charge rapide", piercing: "Perforation", mending: "Raccommodage", vanishing_curse: "Malédiction de disparition",
  density: "Densité", breach: "Brèche", wind_burst: "Rafale", lunge: "Fente" };
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const POT = { water: "Eau", mundane: "Banale", thick: "Épaisse", awkward: "Étrange", night_vision: "Vision nocturne", invisibility: "Invisibilité", leaping: "Saut",
  fire_resistance: "Résistance au feu", swiftness: "Rapidité", slowness: "Lenteur", turtle_master: "Maître tortue", water_breathing: "Respiration aquatique",
  healing: "Soin instantané", harming: "Dégâts instantanés", poison: "Poison", regeneration: "Régénération", strength: "Force", weakness: "Faiblesse", luck: "Chance",
  slow_falling: "Chute lente", wind_charged: "Charge de vent", weaving: "Tissage", oozing: "Suintement", infested: "Infestation" };
const enchName = (e) => { const id = String(e.id || "").replace(/^minecraft:/, ""); const n = ENCH[id] || e.nom || id.replace(/_/g, " ");
  const lv = e.niveau || 1; return n + (lv > 1 || !/curse|mending|silk_touch|infinity|flame|aqua_affinity|channeling|multishot/.test(id) ? " " + (ROMAN[lv] || lv) : ""); };
const potName = (p) => { const id = String(p || "").replace(/^minecraft:/, ""); const m = id.match(/^(long|strong)_(.+)$/);
  const base = POT[m ? m[2] : id] || (m ? m[2] : id).replace(/_/g, " "); return m ? base + (m[1] === "long" ? " (prolongée)" : " II") : base; };
const detText = (d) => !d ? "" : [d.nomPerso, ...(d.enchantements || []).map(enchName), d.resume, d.potion && potName(d.potion), ...(d.lore || [])].filter(Boolean).join(" ");
function det(d) {
  if (!d) return "";
  const ench = (d.enchantements || []).map((e) => `<li class="${/curse/.test(e.id) ? "curse" : ""}">${E_(enchName(e))}</li>`).join("")
    || (d.resume ? `<li>${E_(d.resume)}</li>` : "");
  const dur = d.durabiliteMax ? Math.max(0, Math.min(1, (d.durabilite ?? d.durabiliteMax) / d.durabiliteMax)) : null;
  return `<div class="idet">${ench ? `<ul class="ench">${ench}</ul>` : ""}
    ${d.potion ? `<p class="potion">🧪 ${E_(potName(d.potion))}</p>` : ""}
    ${d.lore ? `<p class="lore">${d.lore.map(E_).join("<br>")}</p>` : ""}
    ${dur !== null ? `<p class="dura" title="Durabilité ${n0(d.durabilite)} / ${n0(d.durabiliteMax)}"><span class="dbar"><s style="width:${Math.round(dur * 100)}%;--h:${Math.round(dur * 120)}"></s></span><span class="muted small">${n0(d.durabilite)} / ${n0(d.durabiliteMax)}</span></p>` : ""}</div>`;
}
const nomPerso = (o) => { const d = o.details; const n = d ? d.nomPerso : o.nom; const base = itemName(o.item, o.nom);  // avec details (v2.2), seul le vrai renommage compte
  return n && n !== base && n.toLowerCase() !== idOf(o.item).replace(/_/g, " ") ? `<span class="muted small nom">« ${E_(n)} »</span>` : ""; };
const facById = (id) => (E && E.factions || []).find((x) => x.id === id);
const head = (t, s2) => `<div class="sec-head"><h3>${t}</h3>${s2 ? `<p class="sub2">${s2}</p>` : ""}</div>`;
const plinkE = (n) => (typeof plink === "function" && /^[A-Za-z0-9_]{2,16}$/.test(n || "") ? plink(n) : E_(n));
// Recherche : sans accents ni majuscules, en français (noms du jeu) comme en anglais (nom du mod, identifiant)
const fold = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[_:]/g, " ");
const itemKeys = (item, nom) => [itemName(item), nom, idOf(item).replace(/_/g, " ")].join(" ");
const matches = (q, ...txt) => { const words = fold(q).split(/\s+/).filter(Boolean); if (!words.length) return true; const hay = fold(txt.join(" ")); return words.every((w) => hay.includes(w)); };
// Lien vers la fiche de la faction (Communauté), retrouvée par l'Espace à partir de l'id du mod
const facHref = (ecoId) => { const f = window.Espace && window.Espace.facOfEco && window.Espace.facOfEco(ecoId); return f ? `#communaute/faction/${f.id}` : null; };
const facColor = (c) => (typeof col === "function" ? col(c) : null) || (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : null) || "var(--muted)";
const facTag = (id) => { const x = facById(id); if (!x) return id ? `<span class="chip">${E_(id)}</span>` : "";
  const tag = `<span class="ftag" style="--fc:${E_(facColor(x.couleur))}">${E_(x.tag)}</span>`, h = facHref(x.id);
  return h ? `<a class="faclink" href="${h}" title="Fiche de la faction">${tag}</a>` : tag; };
// Petite icône devant le propriétaire : tête du skin pour un joueur, bannière aux couleurs pour une faction
const headE = (n) => /^[A-Za-z0-9_]{2,16}$/.test(n || "") ? `<img class="own-ico" src="heads/${encodeURIComponent(n.toLowerCase())}.png" data-n="${E_(n)}" data-s="20" onerror="headFail(this)" alt="" width="20" height="20" loading="lazy">` : "";
const facIco = (id) => { const x = facById(id); return `<span class="own-ico fac-ico" style="--fc:${E_(facColor(x && x.couleur))}" aria-hidden="true"></span>`; };
const unavailable = (what) => `<div class="card center muted">Données indisponibles${what ? ` (${E_(what)})` : ""}. Elles reviendront à la prochaine synchronisation du serveur.</div>`;
const mapLink = (o) => (o && o.x !== undefined && o.x !== null && (!o.monde || o.monde === "minecraft:overworld"))
  ? `<button class="linkbtn" data-map="${o.x},${o.y},${o.z}" title="Voir sur la carte">📍 ${o.x} / ${o.y} / ${o.z}</button>`
  : (o && o.x !== undefined ? `<span class="muted small">${E_(String(o.monde || "").replace("minecraft:", ""))} ${o.x} / ${o.y} / ${o.z}</span>` : "");

async function load() {
  try {
    const r = await fetch("eco.json?t=" + Date.now());
    E = r.ok ? await r.json() : null;
  } catch (e) { E = null; }
  loaded = true;
  render();
  if (window.refreshHome) window.refreshHome();
}

function render() {
  const root = $(ROOTS[mode]);
  if (!root) return;
  Object.values(ROOTS).forEach((id) => { if (id !== ROOTS[mode] && $(id)) $(id).innerHTML = ""; });  // un seul #ecoView à la fois
  if (mode === "commandes") { root.innerHTML = head("Commandes du mod", "Tout ce qui se fait en jeu avec le mod Sumenium Economy : boutiques, factions, hôtel des ventes.") + '<div id="ecoView"></div>'; commandes($("ecoView")); return; }
  if (!loaded) { root.innerHTML = '<p class="empty">Chargement…</p>'; return; }
  const when = E && E.genereLe ? (typeof ago === "function" ? ago(E.genereLe) : "") : "";
  const stamp = E ? `<p class="muted small eco-when">Données du serveur ${E_(when)} · synchronisées toutes les 5 minutes</p>` : "";
  if (mode === "richesse") {
    root.innerHTML = head("Richesse", "Les joueurs les plus riches et les banques de faction (mod Sumenium Economy).") + stamp + '<div id="ecoView"></div>';
    const view = $("ecoView");
    if (!E) { view.innerHTML = unavailable(); return; }
    baltop(view); return;
  }
  root.innerHTML = `<nav class="subtabs" aria-label="Marché">${SUBS.map(([k, l]) =>
      `<a href="#marche/${k}" aria-current="${k === sub ? "page" : "false"}">${l}</a>`).join("")}</nav>
    ${stamp}<div id="ecoView"></div>`;
  const view = $("ecoView");
  if (!E) { view.innerHTML = unavailable(); return; }
  ({ economie: apercu, boutiques, hdv, fisc, detail: (v) => (window.StaffEco ? window.StaffEco.render(v, { ECO: E }) : (v.innerHTML = unavailable())) })[sub](view);
  view.querySelectorAll("[data-map]").forEach((b) => (b.onclick = () => { const [x, y, z] = b.dataset.map.split(",").map(Number); showOnMap(x, y, z); }));
}

/* ---------------- Aperçu ---------------- */
function apercu(view) {
  const s = E.stats;
  const tiles = s ? `<div class="stats">
      <div class="stat sun"><b>${suShort(s.masseMonetaire)}</b><span>Argent en circulation</span></div>
      <div class="stat"><b>${suShort(s.soldesJoueurs)}</b><span>Soldes des joueurs</span></div>
      <div class="stat"><b>${suShort(s.banquesFactions)}</b><span>Banques de faction</span></div>
      <div class="stat leaf"><b>${n0(s.nbBoutiques)}</b><span>Boutiques</span></div>
    </div>` : unavailable("statistiques");
  view.innerHTML = `${tiles}
    <div class="board chart-board"><h3>Argent en circulation<small>un relevé par heure</small></h3><div id="ecoLine"></div></div>
    <h3 class="sec">Entre joueurs</h3>
    <div class="board chart-board"><h3>Échanges entre joueurs<small>7 j</small></h3><div id="ecoBars"></div></div>
    <div class="boards boards-2">
      <div class="board"><h3>Objets les plus vendus<small>boutiques · 7 j</small></h3>${topList(s && s.topVentesJoueurs7j, false)}</div>
      <div class="board"><h3>Enchères en cours<small>les plus chères</small></h3>${hdvTop()}</div>
    </div>
    <h3 class="sec">Le FISC <small>la banque du serveur : c'est lui qui crée et retire l'argent</small></h3>
    <div class="board chart-board"><h3>Argent versé et repris par le FISC<small>7 j</small></h3>
      <p class="small muted">Au-dessus : ce que le FISC paie aux joueurs (il crée cet argent). En dessous : ce qu'il leur reprend (achats, taxes, frais). C'est ce qui fait monter ou baisser l'argent en circulation.</p><div id="ecoFisc"></div></div>
    <div class="boards boards-2">
      <div class="board"><h3>Minerais rachetés par le FISC<small>7 j</small></h3>${topList(s && s.rachatsFisc7j, true)}</div>
      ${raresBoard() || '<div class="board"><h3>Objets rares du FISC</h3><p class="empty">Données indisponibles.</p></div>'}
    </div>`;
  lineChart($("ecoLine"), E.masse);
  stackChart($("ecoBars"), s && s.parJour7j, S_JOUEURS, [], "Échanges entre joueurs par jour sur 7 jours");
  stackChart($("ecoFisc"), s && s.parJour7j, S_CREE, S_RETIRE, "Argent versé et repris par le FISC par jour sur 7 jours");
}
// Le mod donne le nom en jeu de l'objet vendu (en anglais sur le serveur) : on retrouve l'objet via les boutiques
function soldName(n) {
  const b = (E.boutiques || []).find((x) => x.nom === n && x.item) || (E.hdv || []).find((x) => x.nom === n && x.item);
  if (b) return ico(b.item) + " " + E_(itemName(b.item, n));
  const sv = (E.boutiques || []).find((x) => x.service === n);
  return (sv ? '<span class="eco-ico svc" aria-hidden="true">🎫</span> ' : "") + E_(n);
}
// Enchères en cours les plus élevées (offre actuelle ou prix de départ)
function hdvTop() {
  const A = (E.hdv || []).filter((a) => !a.fin || a.fin > Date.now());
  if (!E.hdv) return '<p class="empty">Données indisponibles.</p>';
  if (!A.length) return '<p class="empty">Aucune enchère en cours.</p>';
  const rows = A.map((a) => ({ a, v: a.offreActuelle || a.prixDepart || 0 })).sort((x, y) => y.v - x.v).slice(0, 9), max = Math.max(...rows.map((r) => r.v), 1);
  return `<div class="rank-scroll"><ol class="rank">${rows.map(({ a, v }, i) => `<li><span class="pos">${i + 1}</span>
    <span class="who"><a href="#marche/hdv">${ico(a.item)} ${E_(itemName(a.item, a.nom))}</a><small>${a.quantite > 1 ? `× ${n0(a.quantite)} · ` : ""}${a.offreActuelle ? `${n0(a.nbOffres)} offre${a.nbOffres > 1 ? "s" : ""}` : "aucune offre"}</small></span>
    <span class="val">${su(v, 0)}</span><span class="bar2"><s style="width:${Math.max(2, Math.round(v / max * 100))}%"></s></span></li>`).join("")}</ol></div>`;
}
function topList(rows, isItemId) {
  if (!rows) return '<p class="empty">Données indisponibles.</p>';
  if (!rows.length) return '<p class="empty">Rien sur les 7 derniers jours.</p>';
  const max = Math.max(...rows.map((r) => r.montant || 0), 1);
  return `<div class="rank-scroll"><ol class="rank">${rows.map((r, i) => `<li><span class="pos">${i + 1}</span>
    <span class="who">${isItemId ? ico(r.item) + " " + E_(itemName(r.item)) : soldName(r.item)}<small>× ${n0(r.quantite)}</small></span>
    <span class="val">${su(r.montant, 0)}</span><span class="bar2"><s style="width:${Math.max(2, Math.round((r.montant || 0) / max * 100))}%"></s></span></li>`).join("")}</ol></div>`;
}

// Courbe de l'argent en circulation : plage de temps réglable (boutons, glisser pour zoomer,
// Ctrl + molette ou pincement du pavé tactile, double-clic pour tout revoir). Axe du temps adaptatif.
const H_ = 3600000, D_ = 86400000;
let zoom = null;  // { a, b } en ms, null = tout
const RANGES = [["24 h", D_], ["3 j", 3 * D_], ["7 j", 7 * D_], ["30 j", 30 * D_], ["Tout", 0]];
const TSTEPS = [H_, 2 * H_, 3 * H_, 6 * H_, 12 * H_, D_, 2 * D_, 7 * D_, 14 * D_, 30 * D_];
function timeTicks(a, b, px) {
  const step = TSTEPS.find((s) => (b - a) / s <= px / 74) || 30 * D_;
  const out = [], d = new Date(a);
  if (step >= D_) d.setHours(0, 0, 0, 0); else { d.setMinutes(0, 0, 0); d.setHours(d.getHours() - d.getHours() % (step / H_)); }  // 0 h, 3 h, 6 h…
  if (step === 7 * D_ || step === 14 * D_) d.setDate(d.getDate() - ((d.getDay() + 6) % 7));  // lundis
  if (step === 30 * D_) d.setDate(1);
  for (let t = d.getTime(); t <= b; ) {
    if (t >= a) out.push(t);
    const n = new Date(t);
    if (step === 30 * D_) n.setMonth(n.getMonth() + 1);
    else if (step >= D_) n.setDate(n.getDate() + step / D_);  // jours calendaires (heure d'été)
    else n.setTime(t + step);
    t = n.getTime();
  }
  const lab = (t) => {
    const x = new Date(t);
    if (step >= 30 * D_) return x.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
    if (step >= D_) return x.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    return x.getHours() === 0 ? x.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }) : x.getHours() + " h";
  };
  return out.map((t) => [t, lab(t), step < D_ && new Date(t).getHours() === 0]);
}
const dayOf = (t) => E && E.ouverture && t >= E.ouverture ? ` · jour ${Math.floor((t - E.ouverture) / D_) + 1}` : "";

function lineChart(el, all) {
  if (!all || all.length < 2) { el.innerHTML = `<p class="empty">${all ? "Pas encore assez de points (un par heure)." : "Données indisponibles."}</p>`; return; }
  const first = all[0][0], last = all[all.length - 1][0];
  // Avant le mod : on ne connaît que l'ouverture (0) et le premier relevé, reliés en pointillés
  const gap = E.ouverture && all[0][0] === E.ouverture && all[0][1] === 0 ? 1 : 0;
  const clamp = (z) => { if (!z) return null; let { a, b } = z; const w = Math.max(b - a, 2 * H_);
    a = Math.max(first, Math.min(a, last - w)); b = Math.min(last, a + w); return b - a >= last - first - 60000 ? null : { a, b }; };
  zoom = clamp(zoom);
  const a = zoom ? zoom.a : first, b = zoom ? zoom.b : last;
  const W = Math.max(300, el.clientWidth || 600), H = 230, P = { l: 64, r: 14, t: 12, b: 28 };
  // Points visibles, plus un de chaque côté pour que la ligne aille jusqu'au bord
  let i0 = all.findIndex((p) => p[0] >= a); if (i0 < 0) i0 = all.length - 1;
  let i1 = all.length - 1; while (i1 > 0 && all[i1 - 1][0] > b) i1--;
  const vis = all.slice(Math.max(0, i0 - 1), Math.min(all.length, i1 + 1));
  const inView = vis.filter((p) => p[0] >= a && p[0] <= b), ys = (inView.length ? inView : vis).map((p) => p[1]);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) { y0 -= Math.max(1, Math.abs(y0) * 0.05); y1 += Math.max(1, Math.abs(y1) * 0.05); }
  const pad = (y1 - y0) * 0.08; y0 = Math.max(0, y0 - pad); y1 += pad;
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const X = (t) => P.l + (t - a) / (b - a || 1) * iw, Y = (v) => H - P.b - (v - y0) / (y1 - y0) * ih;
  const T = (px) => a + (px - P.l) / iw * (b - a);
  const ticks = [0, 1, 2, 3].map((i) => y0 + (y1 - y0) * i / 3);
  const seg = (arr) => arr.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
  const gapPath = gap ? seg(all.slice(0, 2)) : "", mainPts = gap ? vis.filter((p) => p[0] !== all[0][0]) : vis;
  const fmtD = (t, o) => new Date(t).toLocaleString("fr-FR", o);
  const span = zoom ? `du ${fmtD(a, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} au ${fmtD(b, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
    : `depuis l'ouverture du serveur, le ${fmtD(first, { day: "numeric", month: "long" })} à ${fmtD(first, { hour: "2-digit", minute: "2-digit" })}`;
  const pressed = (ms) => ms ? !!zoom && Math.abs((b - a) - ms) < H_ && last - b < H_ : !zoom;
  el.innerHTML = `<div class="chart-tools"><div class="seg" role="group" aria-label="Période">${RANGES.filter(([, ms]) => !ms || ms < last - first)
      .map(([l, ms]) => `<button type="button" data-r="${ms}" aria-pressed="${pressed(ms)}">${l}</button>`).join("")}</div>
      <span class="muted small">${E_(span)}</span></div>
    <svg class="chart zoomable" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe de l'argent en circulation ${E_(span)}, de ${su(ys[0], 0)} à ${su(ys[ys.length - 1], 0)}">
    <defs><clipPath id="ecoClip"><rect x="${P.l}" y="${P.t - 3}" width="${iw}" height="${ih + 6}"/></clipPath></defs>
    ${ticks.map((v) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis" x="${P.l - 8}" y="${Y(v) + 4}" text-anchor="end">${E_(suShort(v))}</text>`).join("")}
    ${timeTicks(a, b, iw).map(([t, l, strong]) => `<line class="grid tick" x1="${X(t)}" x2="${X(t)}" y1="${H - P.b}" y2="${H - P.b + 4}"/><text class="axis${strong ? " strong" : ""}" x="${X(t)}" y="${H - 8}" text-anchor="middle">${E_(l)}</text>`).join("")}
    <g clip-path="url(#ecoClip)">${gapPath ? `<path class="line gap" d="${gapPath}"/>` : ""}<path class="line" d="${seg(mainPts)}"/></g>
    <rect class="sel" id="ecoSel" y="${P.t}" height="${ih}" visibility="hidden"/>
    <line class="cross" id="ecoCross" y1="${P.t}" y2="${H - P.b}" visibility="hidden"/><circle class="dot" id="ecoDot" r="5" visibility="hidden"/>
    <rect x="${P.l}" y="${P.t}" width="${iw}" height="${ih}" fill="transparent" id="ecoHit"/></svg>
    <div class="ctip" id="ecoTipL" hidden></div>
    <p class="muted small chart-help">${gap && a < all[1][0] ? "Pointillés : avant l'installation du mod d'économie, pas de relevé. " : ""}Glisse sur la courbe pour zoomer sur une période${zoom ? " · double-clic pour tout revoir" : ""}.</p>`;
  const redraw = (z) => { zoom = z; lineChart(el, all); };
  el.querySelectorAll("[data-r]").forEach((btn) => (btn.onclick = () => { const ms = +btn.dataset.r; redraw(ms ? { a: last - ms, b: last } : null); }));
  const hit = $("ecoHit"), tip = $("ecoTipL"), cross = $("ecoCross"), dot = $("ecoDot"), sel = $("ecoSel");
  const svgX = (clientX) => { const r = hit.getBoundingClientRect(); return P.l + (clientX - r.left) / r.width * iw; };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
  const move = (clientX) => {
    const t = T(svgX(clientX));
    let best = -1; vis.forEach((p, i) => { if (p[0] >= a && p[0] <= b && (best < 0 || Math.abs(p[0] - t) < Math.abs(vis[best][0] - t))) best = i; });
    if (best < 0) return hide();
    const [bt, bv] = vis[best], px = X(bt);
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", px); dot.setAttribute("cy", Y(bv)); dot.setAttribute("visibility", "visible");
    const what = gap && bt === all[0][0] ? "Ouverture du serveur" : gap && bt === all[1][0] ? "Premier relevé du mod" : "";
    tip.innerHTML = `<b>${E_(su(bv, 0))}</b><span>${E_(fmtD(bt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + dayOf(bt))}</span>${what ? `<span>${what}</span>` : ""}`;
    tip.hidden = false; tip.style.left = Math.min(Math.max(px / W * el.clientWidth - 70, 0), el.clientWidth - 170) + "px";
  };
  let drag = null;
  hit.addEventListener("pointerdown", (e) => { drag = { x: svgX(e.clientX), id: e.pointerId, moved: false }; move(e.clientX); });
  hit.addEventListener("pointermove", (e) => {
    if (drag && e.pointerId === drag.id) {
      const x = svgX(e.clientX);
      if (!drag.moved && Math.abs(x - drag.x) > 8) { drag.moved = true; try { hit.setPointerCapture(e.pointerId); } catch (_) {} }
      if (drag.moved) { const l = Math.max(P.l, Math.min(x, drag.x)), r = Math.min(P.l + iw, Math.max(x, drag.x));
        sel.setAttribute("x", l); sel.setAttribute("width", r - l); sel.setAttribute("visibility", "visible"); hide(); return; }
    }
    move(e.clientX);
  });
  const end = (e) => {
    if (!drag) return;
    const d = drag; drag = null; sel.setAttribute("visibility", "hidden");
    if (d.moved) { const ta = T(Math.min(d.x, svgX(e.clientX))), tb = T(Math.max(d.x, svgX(e.clientX))); redraw({ a: ta, b: tb }); }
  };
  hit.addEventListener("pointerup", end); hit.addEventListener("pointercancel", () => { drag = null; sel.setAttribute("visibility", "hidden"); });
  hit.addEventListener("pointerleave", () => { if (!drag) hide(); });
  hit.addEventListener("dblclick", () => redraw(null));
  // Ctrl + molette (ou pincement sur pavé tactile) : zoom centré sur le curseur ; la molette seule fait défiler la page
  hit.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const t = T(svgX(e.clientX)), k = Math.exp(Math.max(-1, Math.min(1, e.deltaY / 200)));
    redraw({ a: t - (t - a) * k, b: t + (b - t) * k });
  }, { passive: false });
}

// Barres empilées par jour : 4 séries (couleurs validées clair/sombre), légende + tableau
// Séries des graphiques par jour (parJour7j du mod) : [clé, libellé, classe de couleur]
const S_JOUEURS = [["ventesJoueurs", "Ventes en boutique", "s0"], ["ventesHdv", "Ventes à l'hôtel des ventes", "s2"]];
const S_CREE = [["rachatsFisc", "Rachats de minerais", "s1"], ["reprisesFisc", "Reprises d'objets rares", "s4"]];
const S_RETIRE = [["achatsFisc", "Achats au FISC", "s3"], ["reventesFisc", "Reventes d'objets rares", "s5"], ["taxesFrais", "Taxes et frais de boutique", "s6"]];
// Barres empilées par jour ; « neg » : séries tracées sous l'axe (argent retiré)
function stackChart(el, days, pos, neg = [], label = "") {
  if (!days) { el.innerHTML = '<p class="empty">Données indisponibles.</p>'; return; }
  days = days.map((d) => ({ ...d, taxesFrais: (d.taxes || 0) + (d.fraisBoutiques || 0), taxesFraisNb: (d.fraisBoutiquesNb || 0) }));
  const sum = (d, ser) => ser.reduce((a, [k]) => a + (d[k] || 0), 0);
  if (!days.some((d) => sum(d, pos) + sum(d, neg))) { el.innerHTML = '<p class="empty">Rien sur les 7 derniers jours.</p>'; return; }
  const W = Math.max(300, el.clientWidth || 600), H = neg.length ? 260 : 220, P = { l: 64, r: 8, t: 10, b: 26 };
  const up = Math.max(...days.map((d) => sum(d, pos)), 1), down = neg.length ? Math.max(...days.map((d) => sum(d, neg)), 1) : 0;
  const span = up + down, inner = H - P.t - P.b, zero = P.t + inner * up / span;
  const Y = (v) => zero - v / span * inner;  // v > 0 au-dessus, v < 0 en dessous
  const ticks = neg.length ? [up, up / 2, 0, -down / 2, -down] : [0, 1, 2, 3].map((i) => up * i / 3);
  const slot = (W - P.l - P.r) / days.length, bw = Math.min(46, slot * 0.6);
  // Libellés des jours : « mer. 21 », ou « M 21 » quand la place manque (téléphone)
  const lab = (d) => new Date(d.jour + "T12:00:00").toLocaleDateString("fr-FR", { weekday: slot < 64 ? "narrow" : "short", day: "numeric" });
  const labL = (d) => new Date(d.jour + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" });
  let bars = "";
  days.forEach((d, i) => {
    const x = P.l + i * slot + (slot - bw) / 2;
    [[pos, 1], [neg, -1]].forEach(([ser, sign]) => {
      let acc = 0;
      ser.forEach(([k, , c]) => {
        const v = d[k] || 0; if (!v) return;
        const y1 = Y(sign * acc), y2 = Y(sign * (acc + v)); acc += v;
        const top = Math.min(y1, y2), h = Math.abs(y2 - y1);
        bars += `<rect class="${c}" x="${x.toFixed(1)}" y="${(top + 1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h - 2).toFixed(1)}" rx="3"/>`;
      });
    });
    bars += `<rect class="hitbar" data-i="${i}" x="${P.l + i * slot}" y="${P.t}" width="${slot}" height="${inner}" fill="transparent"/>`;
    bars += `<text class="axis" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${E_(lab(d))}</text>`;
  });
  const all = [...pos, ...neg], tid = "tip" + Math.random().toString(36).slice(2, 8);
  const net = (d) => sum(d, pos) - sum(d, neg);
  el.innerHTML = `<div class="legend">${pos.map(([, l, c]) => `<span><i class="sw ${c}"></i>${l}</span>`).join("")}${neg.length ? '<span class="legend-sep" aria-hidden="true">·</span>' : ""}${neg.map(([, l, c]) => `<span><i class="sw ${c}"></i>${l}</span>`).join("")}</div>
    <svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${E_(label)}">
    ${ticks.map((v) => `<line class="grid${v === 0 && neg.length ? " zero" : ""}" x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis" x="${P.l - 8}" y="${Y(v) + 4}" text-anchor="end">${v < 0 ? "−" : v > 0 && neg.length ? "+" : ""}${E_(suShort(Math.abs(v)))}</text>`).join("")}
    ${neg.length ? `<text class="axis" x="${W - P.r}" y="${P.t + 10}" text-anchor="end">versé aux joueurs ↑</text><text class="axis" x="${W - P.r}" y="${H - P.b - 4}" text-anchor="end">repris aux joueurs ↓</text>` : ""}
    ${bars}</svg><div class="ctip" id="${tid}" hidden></div>
    <details class="tblview"><summary>Voir le tableau</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Jour</th>${all.map(([, l]) => `<th>${l}</th>`).join("")}${neg.length ? "<th>Solde</th>" : ""}</tr></thead><tbody>
    ${days.map((d) => `<tr><td>${E_(labL(d))}</td>${all.map(([k]) => `<td>${su(d[k] || 0, 0)}${d[k + "Nb"] ? `<small class="muted"> · ${n0(d[k + "Nb"])}</small>` : ""}</td>`).join("")}${neg.length ? `<td><b>${net(d) >= 0 ? "+" : "−"}${su(Math.abs(net(d)), 0)}</b></td>` : ""}</tr>`).join("")}
    </tbody></table></div></details>`;
  const tip = $(tid);
  el.querySelectorAll(".hitbar").forEach((r) => {
    const show = () => {
      const d = days[+r.dataset.i];
      tip.innerHTML = `<b>${E_(labL(d))}</b>${all.filter(([k]) => d[k]).map(([k, l, c]) => `<span><i class="sw ${c}"></i>${l} : ${su(d[k], 0)}${d[k + "Nb"] ? ` (${n0(d[k + "Nb"])})` : ""}</span>`).join("") || "<span>Rien ce jour-là</span>"}
        ${neg.length ? `<span><b>${net(d) >= 0 ? `+${su(net(d), 0)} versés` : `−${su(-net(d), 0)} repris`}</b></span>` : ""}`;
      tip.hidden = false; tip.style.left = Math.min(Math.max(+r.getAttribute("x") - 40, 0), W - 250) + "px";
    };
    r.addEventListener("pointerenter", show); r.addEventListener("pointerdown", show);
    r.addEventListener("pointerleave", () => (tip.hidden = true));
  });
}

// Objets rares du FISC : les plus recherchés (en rupture) et ce qu'il a en stock
function raresBoard() {
  const R = (E.fisc && E.fisc.reprise) || [];
  if (!R.length) return "";
  const s = E.stats || {}, days = s.parJour7j || [], tot = (k) => days.reduce((a, d) => a + (d[k] || 0), 0);
  const enStock = R.filter((r) => r.stock > 0), valeur = enStock.reduce((a, r) => a + r.stock * (r.prixRevente || 0), 0);
  const cherches = R.filter((r) => r.rachete !== false && (r.rupture || !r.stock)).sort((a, b) => (b.demandes || 0) - (a.demandes || 0) || (b.prixRachat || 0) - (a.prixRachat || 0)).slice(0, 5);
  const stock = enStock.slice().sort((a, b) => b.stock * (b.prixRevente || 0) - a.stock * (a.prixRevente || 0)).slice(0, 5);
  const li = (r, right) => `<li><span class="who">${ico(r.item)} ${E_(itemName(r.item, r.nom))}${r.demandes ? ` <span class="chip" title="Joueurs qui l'ont demandé">🔎 ${n0(r.demandes)}</span>` : ""}</span><span class="val">${right}</span></li>`;
  return `<div class="board rares-board"><h3>Objets rares du FISC<small>PNJ du spawn</small></h3>
    <div class="stats mini">
      <div class="stat"><b>${n0(enStock.length)}</b><span>objets en stock</span></div>
      <div class="stat"><b>${suShort(valeur)}</b><span>valeur à la revente</span></div>
      <div class="stat"><b>${su(tot("reprisesFisc"), 0)}</b><span>versés aux joueurs · 7 j</span></div>
      <div class="stat"><b>${su(tot("reventesFisc"), 0)}</b><span>payés par les joueurs · 7 j</span></div>
    </div>
    <h4 class="cat-h">Les plus recherchés <small class="muted">en rupture : le FISC paie</small></h4>
    ${cherches.length ? `<ol class="rank plain">${cherches.map((r) => li(r, su(r.prixRachat))).join("")}</ol>` : '<p class="empty">Tout est en stock.</p>'}
    <h4 class="cat-h">En stock <small class="muted">prix de revente</small></h4>
    ${stock.length ? `<ol class="rank plain">${stock.map((r) => li(r, `${su(r.prixRevente)} <small class="muted">× ${n0(r.stock)}</small>`)).join("")}</ol>` : '<p class="empty">Rien en stock.</p>'}
    <p class="small"><a href="#marche/fisc">Tous les objets rares et leurs prix</a> · <a href="#aide/guides/fisc">Comment marche le prix</a></p></div>`;
}

/* ---------------- Boutiques ---------------- */
function boutiques(view) {
  if (!E.boutiques) { view.innerHTML = unavailable("boutiques"); return; }
  // Le FISC a son propre onglet : ici, seulement les boutiques des joueurs et des factions
  const all = E.boutiques.filter((s) => s.proprietaireType !== "fisc");
  const owners = [...new Set(all.map((s) => s.proprietaire).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const facs = [...new Set(all.map((s) => s.faction).filter(Boolean))];
  const q = f.q.toLowerCase();
  const match = (s) => matches(f.q, itemKeys(s.item, s.nom), s.service, s.proprietaire, detText(s.details), ...((s.details && s.details.enchantements) || []).map((e) => e.nom || ""),
    ...(s.lot || []).flatMap((x) => [itemKeys(x.item, x.nom), detText(x.details)]));
  const fq = q && E.fisc ? [...(E.fisc.rachat || []), ...(E.fisc.vente || [])].filter((r) => matches(f.q, itemKeys(r.item, r.nom))).length : 0;
  let list = all.filter((s) => match(s)
    && (!f.owner || s.proprietaire === f.owner) && (!f.fac || s.faction === f.fac)
    && (!f.type || (f.type === "service" ? s.type === "service" : s.type !== "service"))
    && (!f.stock || !s.rupture));
  const by = { recent: (a, b) => String(b.creeLe || "").localeCompare(String(a.creeLe || "")), prix: (a, b) => unit(a) - unit(b),
    ventes: (a, b) => (b.ventes || 0) - (a.ventes || 0), az: (a, b) => itemName(a.item, a.nom).localeCompare(itemName(b.item, b.nom)) }[f.sort];
  list = list.sort(by);
  const rupt = all.filter((s) => s.rupture).length;
  view.innerHTML = `<div class="bar">
      <input type="search" id="bq" placeholder="Chercher un objet (français ou anglais), un enchantement, un vendeur…" value="${E_(f.q)}" aria-label="Chercher une boutique">
      <select id="bo" aria-label="Propriétaire"><option value="">Tous les vendeurs</option>${owners.map((o) => `<option${o === f.owner ? " selected" : ""}>${E_(o)}</option>`).join("")}</select>
      <select id="bf" aria-label="Faction"><option value="">Toutes les factions</option>${facs.map((x) => `<option value="${E_(x)}"${x === f.fac ? " selected" : ""}>${E_((facById(x) || {}).tag || x)}</option>`).join("")}</select>
      <select id="bt" aria-label="Type"><option value="">Objets et services</option><option value="item"${f.type === "item" ? " selected" : ""}>Objets</option><option value="service"${f.type === "service" ? " selected" : ""}>Services</option></select>
      <select id="bs" aria-label="Tri"><option value="recent">Tri : plus récentes</option><option value="prix"${f.sort === "prix" ? " selected" : ""}>Tri : prix à l'unité</option><option value="ventes"${f.sort === "ventes" ? " selected" : ""}>Tri : plus vendues</option><option value="az"${f.sort === "az" ? " selected" : ""}>Tri : A → Z</option></select>
      <label class="chk"><input type="checkbox" id="bk"${f.stock ? " checked" : ""}> En stock</label></div>
    <p class="count">${n0(list.length)} boutique${list.length > 1 ? "s" : ""}${rupt ? ` · ${n0(rupt)} en rupture sur le serveur` : ""} · <a href="#marche/fisc">${fq ? `${n0(fq)} prix du FISC pour « ${E_(f.q)} »` : "prix du FISC"} dans l'onglet FISC</a></p>
    <div class="shop-grid">${list.map(shopCard).join("") || '<p class="empty">Aucune boutique ne correspond.</p>'}</div>`;
  const keep = (id, k, val) => { $(id).oninput = $(id).onchange = (e) => { f[k] = val ? val(e.target) : e.target.value; const pos = id === "bq" ? e.target.selectionStart : null; render();
    if (pos !== null) { const el = $("bq"); el.focus(); el.setSelectionRange(pos, pos); } }; };
  keep("bq", "q"); keep("bo", "owner"); keep("bf", "fac"); keep("bt", "type"); keep("bs", "sort"); keep("bk", "stock", (t) => t.checked);
}
const unit = (s) => (s.prix || 0) / Math.max(1, s.quantite || 1);
// Boutique de lot (mod 2.4) : plusieurs items différents vendus ensemble
function lotHtml(s) {
  return `<ul class="lot">${(s.lot || []).map((x) => `<li>${ico(x.item)}<span><b>${E_(itemName(x.item, x.nom))}</b> × ${n0(x.quantite)}${x.details && x.details.enchantements ? `<small class="muted"> · ${E_(x.details.enchantements.map(enchName).join(", "))}</small>` : ""}</span></li>`).join("")}</ul>`;
}
function shopCard(s) {
  const svc = s.type === "service", fiscS = s.proprietaireType === "fisc", lot = s.type === "lot";
  const name = svc ? (s.service || "Service") : lot ? `Lot de ${(s.lot || []).length} objets` : itemName(s.item, s.nom);
  const stock = svc ? '<span class="chip ok">Stock illimité</span>' : s.rupture ? '<span class="chip warn">Rupture</span>'
    : s.stock === null || s.stock === undefined ? "" : `<span class="chip">${n0(s.stock)} en stock</span>`;
  const label = fiscS ? (s.type === "fisc_rachat" ? "Le FISC rachète" : "Le FISC vend") : "";
  return `<article class="shop${s.rupture ? " out" : ""}">
    <header>${ico(lot ? ((s.lot || [])[0] || {}).item : s.item)}<div><b>${E_(name)}</b>${!lot && s.quantite > 1 ? `<span class="muted small"> × ${n0(s.quantite)}</span>` : ""}
      ${svc || lot ? "" : nomPerso(s)}</div></header>
    ${lot ? lotHtml(s) : svc ? "" : det(s.details)}
    <p class="price">${label ? `<span class="muted small">${label} </span>` : ""}${su(s.prix)}${lot ? '<span class="muted small"> le lot</span>' : s.quantite > 1 ? `<span class="muted small"> · ${su(unit(s))} l'unité</span>` : ""}</p>
    <div class="tags">${stock}${s.ventes ? `<span class="chip muted">${n0(s.ventes)} vente${s.ventes > 1 ? "s" : ""}</span>` : ""}</div>
    <p class="owner">${fiscS ? "<b>FISC</b>" : s.proprietaireType === "faction"
      ? `${facIco(s.faction)}${facTag(s.faction) || `<b>${E_(s.proprietaire)}</b>`} <span class="muted small">boutique de faction</span>`
      : `${headE(s.proprietaire)}<b>${plinkE(s.proprietaire)}</b> ${facTag(s.faction)}`}</p>
    <p class="pos">${mapLink(s)}${window.Espace && window.Espace.canSeeShop && window.Espace.canSeeShop(s) ? " " + window.Espace.histBtn(s) : ""}</p>
  </article>`;
}

/* ---------------- Hôtel des ventes ---------------- */
function hdv(view) {
  const list = E.hdv;
  if (!list) { view.innerHTML = unavailable("hôtel des ventes"); return; }
  const open = list.filter((a) => (!a.fin || a.fin > Date.now()) && matches(hq, itemKeys(a.item, a.nom), a.vendeur, detText(a.details)));
  view.innerHTML = `<div class="card"><p class="small">Enchères de 7 jours au PNJ du spawn. Une offre dans les 5 dernières minutes prolonge l'enchère de 5 minutes. Taxe de 15 % sur le prix final. <a href="#aide/commandes/hdv">Commandes de l'hôtel des ventes</a></p></div>
    <div class="bar"><input type="search" id="hq" placeholder="Chercher un objet (français ou anglais), un vendeur…" value="${E_(hq)}" aria-label="Chercher une annonce"></div>
    <p class="count">${n0(open.length)} annonce${open.length > 1 ? "s" : ""} en cours</p>
    <div class="shop-grid">${open.map((a) => `<article class="shop hdv">
      <header>${ico(a.item)}<div><b>${E_(itemName(a.item, a.nom))}</b>${a.quantite > 1 ? `<span class="muted small"> × ${n0(a.quantite)}</span>` : ""}
        ${nomPerso(a)}</div></header>
      ${det(a.details)}
      <p class="price">${a.offreActuelle ? su(a.offreActuelle) : su(a.prixDepart)}<span class="muted small"> ${a.offreActuelle ? `offre de ${plinkE(a.meilleurEncherisseur || "?")} · ${n0(a.nbOffres)} offre${a.nbOffres > 1 ? "s" : ""}` : "prix de départ, aucune offre"}</span></p>
      <div class="tags">${a.achatImmediat ? `<span class="chip ok">Achat immédiat ${su(a.achatImmediat)}</span>` : '<span class="chip muted">Pas d\'achat immédiat</span>'}</div>
      <p class="owner">Vendu par <b>${plinkE(a.vendeur)}</b></p>
      <p class="countdown" data-fin="${a.fin || ""}">${remain(a.fin)}</p></article>`).join("") || '<p class="empty">Aucune annonce en cours.</p>'}</div>`;
  keepSearch("hq", (v) => (hq = v));
}
let hq = "", fqS = "";
// Garde le curseur dans le champ de recherche pendant que la liste se redessine
function keepSearch(id, set) { const el = $(id); if (!el) return; el.oninput = (e) => { set(e.target.value); const pos = e.target.selectionStart; render(); const n = $(id); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }; }
function remain(fin) {
  if (!fin) return "";
  const s = Math.floor((fin - Date.now()) / 1000);
  if (s <= 0) return '<span class="chip">Terminée</span>';
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  const txt = d ? `${d} j ${h} h ${String(m).padStart(2, "0")} min` : h ? `${h} h ${String(m).padStart(2, "0")} min ${String(sec).padStart(2, "0")} s` : `${m} min ${String(sec).padStart(2, "0")} s`;
  return `<span class="${s < 600 ? "soon" : ""}">⏳ ${txt}</span>`;
}

/* ---------------- FISC ---------------- */
function fisc(view) {
  const F = E.fisc;
  if (!F) { view.innerHTML = unavailable("prix du FISC"); return; }
  const keep = (rows) => rows.filter((r) => matches(fqS, itemKeys(r.item, r.nom)));
  const table = (rows, sell) => (rows = keep(rows)).length ? `<div class="tbl-wrap"><table class="tbl left"><thead><tr><th>Objet</th><th>${sell ? "Prix" : "Le FISC paie"}</th>${sell ? "<th>Lot</th>" : ""}<th>Où</th></tr></thead><tbody>
    ${rows.slice().sort((a, b) => itemName(a.item, a.nom).localeCompare(itemName(b.item, b.nom))).map((r) => `<tr><td>${ico(r.item)} ${E_(itemName(r.item, r.nom))}</td><td><b>${su(r.prix)}</b>${sell ? "" : '<span class="muted small"> / unité</span>'}</td>${sell ? `<td>× ${n0(r.quantite || 1)}</td>` : ""}<td>${mapLink(r)}</td></tr>`).join("")}
    </tbody></table></div>` : '<p class="empty">Aucun.</p>';
  view.innerHTML = `<div class="bar"><input type="search" id="fqS" placeholder="Chercher un objet (français ou anglais)…" value="${E_(fqS)}" aria-label="Chercher un objet du FISC"></div>
    ${F.prixDynamiques && !/^(off|aucun)$/i.test(F.prixDynamiques) ? `<div class="banner info">Prix dynamiques activés (${E_(F.prixDynamiques)}) : les prix évoluent selon les quantités échangées.</div>` : ""}
    ${rares(F)}
    <div class="board" style="margin-top:14px"><h3>Minerais : ce que le FISC rachète<small>coffres du FISC, objets détruits</small></h3>${table(F.rachat, false)}</div>
    <div class="board" style="margin-top:14px"><h3>Ce que le FISC vend<small>coffres du FISC, stock illimité</small></h3>${table(F.vente, true)}</div>`;
  keepSearch("fqS", (v) => (fqS = v));
}

// Objets rares (PNJ « FISC — Rachat » et « FISC — Revente ») : le prix suit le stock du FISC
function rares(F) {
  const R = (F.reprise || []).filter((r) => matches(fqS, itemKeys(r.item, r.nom) + " " + (r.categorie || "")));
  if (!(F.reprise || []).length) return "";
  const cats = [...new Set(R.map((r) => r.categorie || "Divers"))];
  const rows = (c) => R.filter((r) => (r.categorie || "Divers") === c).sort((a, b) => itemName(a.item, a.nom).localeCompare(itemName(b.item, b.nom))).map((r) => `<tr>
      <td>${ico(r.item)} ${E_(itemName(r.item, r.nom))}${r.demandes ? ` <span class="chip" title="Joueurs qui l'ont demandé cette semaine">🔎 ${n0(r.demandes)}</span>` : ""}</td>
      <td>${r.rachete === false ? '<span class="muted small">plus racheté</span>' : `<b>${su(r.prixRachat)}</b>`}</td>
      ${F.revente ? `<td>${r.rupture ? '<span class="muted small">en rupture</span>' : `<b>${su(r.prixRevente)}</b>`}</td><td>${r.stock == null ? "—" : n0(r.stock)}</td>` : ""}
      <td class="muted small">−${(r.baissePct ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %</td></tr>`).join("");
  return `<div class="board"><h3>Objets rares : rachat et revente<small>PNJ du FISC au spawn</small></h3>
    <p class="small muted">Ces objets ne sont pas détruits : le FISC les garde et les revend. Son prix suit son stock : chaque objet qu'il a déjà fait baisser un peu le prix du suivant (colonne « par objet »), et il revend au double. Prix affichés pour le prochain objet. <a href="#aide/guides/fisc">Comment ça marche</a></p>
    ${cats.length ? cats.map((c) => `<h4 class="cat-h">${E_(c)}</h4><div class="tbl-wrap"><table class="tbl left"><thead><tr><th>Objet</th><th>Le FISC paie</th>${F.revente ? "<th>Il revend</th><th>Stock</th>" : ""}<th>Par objet</th></tr></thead><tbody>${rows(c)}</tbody></table></div>`).join("") : '<p class="empty">Aucun.</p>'}</div>`;
}

/* ---------------- Baltop ---------------- */
function baltop(view) {
  const J = E.joueurs, F = E.factions;
  const facRows = F ? F.slice().sort((a, b) => b.banque - a.banque) : null;
  const max = facRows && facRows.length ? Math.max(...facRows.map((x) => x.banque), 1) : 1;
  view.innerHTML = `<div class="boards boards-2">
    <div class="board"><h3>Joueurs les plus riches<small>${J ? n0(J.length) + " joueurs" : ""}</small></h3>
      ${J ? (typeof rankList === "function" ? rankList(J.filter((p) => p.solde > 0).map((p) => [p.nom, p.solde]), (v) => su(v, 0)) : "") : '<p class="empty">Données indisponibles.</p>'}</div>
    <div class="board"><h3>Banques de faction<small>${facRows ? n0(facRows.length) + " factions" : ""}</small></h3>
      ${facRows ? `<div class="rank-scroll"><ol class="rank">${facRows.map((x, i) => `<li><span class="pos">${i + 1}</span><span class="who">${facTag(x.id)}</span>
        <span class="val">${su(x.banque, 0)}</span><span class="bar2"><s style="width:${Math.max(2, Math.round(x.banque / max * 100))}%"></s></span></li>`).join("")}</ol></div>` : '<p class="empty">Données indisponibles.</p>'}</div>
  </div>`;
}

/* ---------------- Commandes (doc « Commandes Suménium Economy », v2.6.3) ---------------- */
const SANS_COMMANDE = [
  ["Acheter dans une boutique", "Clic droit sur le coffre ou son panneau. Le chat affiche l'item (survolable), le prix et le stock. Taper ensuite la quantité dans le chat : un nombre, « tout » ou « annuler » (30 s pour répondre, invisible pour les autres)."],
  ["Acheter un lot", "Pareil qu'une boutique normale, mais on tape un nombre de lots. Le chat et le panneau montrent le contenu du lot (chaque item est survolable). Si un seul item du lot manque dans le coffre, la boutique est en rupture : on ne paie jamais un lot incomplet."],
  ["Vendre des minerais au FISC", "Clic droit sur le coffre du FISC, puis taper la quantité à vendre ou « tout ». Les minerais rachetés sont détruits."],
  ["Vendre un objet rare au FISC", "Clic droit sur le PNJ « FISC — Rachat » : un menu montre les objets rachetés (cœur de la mer, disques, ornements, tessons…) par catégorie, avec le prix du prochain et combien on en a. Clic sur l'objet puis la quantité dans le chat ou « tout ». L'objet doit être identique (pas abîmé, mêmes enchantements). Il n'est pas détruit : il rejoint le stock du FISC, et chaque objet en stock fait un peu baisser le prix du suivant."],
  ["Acheter un objet rare au FISC", "Clic droit sur le PNJ « FISC — Revente » : les objets rachetés aux joueurs, au double du prix de rachat ; le prix monte quand le stock baisse. Un objet en rupture se demande d'un clic : on est prévenu à son retour, et le FISC augmente son prix de rachat si plusieurs joueurs le cherchent."],
  ["Ravitailler sa boutique", "Le propriétaire et, pour une boutique de faction, tous les membres ouvrent le coffre normalement. Le stock et le panneau se mettent à jour à la fermeture."],
  ["Acheter dans la boutique de sa faction", "Avec son compte perso (/compte perso), cliquer sur le panneau : l'argent va dans la banque de faction."],
  ["Panneau", "Posé automatiquement à la création de la boutique (ou un panneau déjà accroché au coffre est repris). Il est ciré : personne ne peut le modifier ni le casser à part les membres."],
  ["Signal de redstone à chaque vente", "Après chaque vente (boutiques des joueurs et du FISC), le coffre émet un signal de redstone pendant 1 seconde. Une poudre de redstone, un répéteur, un comparateur ou une lampe collés au coffre le captent : libre à chacun d'en faire une sonnette, une porte, un compteur…"],
  ["Dépôt de service (optionnel)", "Un coffre ou tonneau relié à un service avec /boutique depot. Le client y pose son bon et referme le coffre : si le bon est valide pour ce service, il est consommé (un par fermeture) et le coffre émet un signal de redstone d'1 seconde pour lancer l'usine ou ouvrir une porte. Un bon déjà utilisé ou d'un autre service est refusé et reste dans le coffre. Tout le monde peut ouvrir un dépôt ; seuls les membres du service le cassent."],
  ["Hôtel des ventes", "Clic droit sur le PNJ du spawn : un menu affiche toutes les annonces (45 par page, survolables). Clic sur un item puis taper son offre dans le chat, « achat » pour l'achat immédiat ou « annuler ». L'argent de l'offre est bloqué et rendu si quelqu'un surenchérit. Une offre dans les 5 dernières minutes prolonge l'enchère de 5 minutes."],
  ["Boîte aux lettres", "Clic droit sur la boîte aux lettres du spawn : chacun y retrouve ses items gagnés aux enchères et ses invendus. On ne peut que retirer, pas déposer."],
  ["Annuaire", "Le livre sur le lutrin de l'entrée de la zone commerciale liste toutes les boutiques des joueurs, sans le FISC (propriétaire, item, prix, rupture, coordonnées). Il se met à jour tout seul et revient si quelqu'un le prend."],
  ["Marchand de têtes", "Clic droit sur le PNJ : plus de 100 000 têtes décoratives classées par catégorie puis par nom. La boussole lance une recherche (taper un mot dans le chat, souvent en anglais : cat, pumpkin…). Un clic sur une tête l'achète pour 150 Su, avec le compte utilisé (perso ou faction)."],
  ["AFK", "Sans bouger la caméra, marcher ni écrire dans le chat pendant 2 min 30, le joueur passe [AFK] dans le tab (un autoclicker ne compte pas comme une activité). Les joueurs AFK ne sont pas comptés pour passer la nuit."],
];
const JOUEURS = [
  { titre: "Compte", lignes: [
    ["/compte", "Solde perso, banque de faction, compte utilisé", "Tous"],
    ["/compte perso", "Acheter et créer des boutiques avec son compte perso", "Tous"],
    ["/compte faction", "Acheter et créer des boutiques avec la banque de faction", "Chef, trésoriers"],
    ["/historique [page]", "Achats, ventes, frais et dépôts des 30 derniers jours, avec le montant sur son compte et sur la banque de sa faction", "Tous"],
    ["/historique boutique [boutique] [page]", "Sans argument : la liste de tes boutiques et de celles de ta faction (clic pour ouvrir). Avec : toutes les ventes et changements de prix de cette boutique. Aussi sur le site (Ma fiche, fiche de faction, Marché)", "Tous"],
    ["/baltop [page]", "Classement des joueurs les plus riches, 10 par page", "Tous"],
    ["/baltop factions [page]", "Classement des banques de faction", "Tous"],
    ["/boutique (ou /boutique aide)", "Rappel des commandes de boutique, cliquables", "Tous"],
  ] },
  { titre: "Boutiques", intro: "Regarder le coffre (ou le tonneau) de la boutique pour toutes ces commandes.", lignes: [
    ["/boutique creer item <prix> <quantité>", "Crée une boutique, l'item à vendre en main. Ex. /boutique creer item 20 16 = 16 items pour 20 Su. Frais : 150 Su, ou 50 Su si on a déjà une boutique de la même famille (couleurs, essences de bois)", "Tous"],
    ["/boutique creer service <prix> <nom du bon>", "Boutique de service, stock infini : l'acheteur reçoit un bon à ce nom. Frais : 300 Su", "Tous"],
    ["/boutique creer lot <prix>", "Boutique qui vend un lot de 2 à 9 items différents. Un menu s'ouvre : y poser un exemplaire de chaque item avec la bonne quantité, puis le fermer (les items sont rendus). Remplir ensuite le coffre en vrac ; le stock est le nombre de lots complets. Ex. /boutique creer lot 500 puis 4 diamants + 16 fers dans le menu. Frais : 300 Su", "Tous"],
    ["/boutique info", "Offre, stock, ventes et chiffre d'affaires", "Tous (stats : membres)"],
    ["/boutique liste", "Toutes ses boutiques et celles de sa faction, avec stock et coordonnées", "Tous"],
    ["/boutique prix <prix> [quantité]", "Change le prix (et, pour une boutique d'item, la quantité vendue à chaque achat)", "Membres de la boutique"],
    ["/boutique panneau", "Réécrit le panneau, en reprend un accroché au coffre ou en pose un neuf", "Membres de la boutique"],
    ["/boutique faction", "Donne sa boutique perso à sa faction : tous les membres ravitaillent, les ventes vont à la banque", "Propriétaire"],
    ["/boutique perso", "Reprend une boutique de faction en perso", "Chef, créateur de la boutique"],
    ["/boutique supprimer", "Supprime la boutique (50 % des frais remboursés). Casser le coffre fait pareil", "Membres de la boutique"],
    ["/boutique depot <nom du service>", "En regardant un coffre ou un tonneau : le transforme en dépôt d'un de ses services (un bon valide déposé = signal de redstone). Optionnel", "Membres du service"],
    ["/boutique depot retirer", "Le coffre visé redevient un coffre normal (casser le coffre fait pareil)", "Membres du service"],
  ] },
  { titre: "Bons de service", lignes: [
    ["/bon verifier", "Le bon en main est-il authentique et déjà utilisé ?", "Tous"],
    ["/bon valider", "Marque le bon en main comme utilisé et le retire (facultatif : un coffre de dépôt suffit pour une ferme en libre service)", "Vendeur du service"],
  ] },
  { titre: "Factions", lignes: [
    ["/faction", "Sa faction : membres, rôles, banque", "Tous"],
    ["/faction info <faction>", "Une autre faction", "Tous"],
    ["/faction liste", "Toutes les factions", "Tous"],
    ["/faction inviter <joueur>", "Invite un joueur (8 membres max)", "Chef"],
    ["/faction rejoindre <faction>", "Accepte une invitation", "Joueur invité"],
    ["/faction quitter", "Quitte la faction (le chef doit d'abord nommer un autre chef)", "Tous"],
    ["/faction exclure <joueur>", "Exclut un membre", "Chef"],
    ["/faction role <joueur> <membre|tresorier|chef>", "Change le rôle d'un membre. Trésorier = peut dépenser la banque", "Chef"],
    ["/faction deposer <montant>", "Verse de l'argent perso dans la banque", "Tous les membres"],
    ["/faction retirer <montant>", "Retire de la banque vers son compte perso", "Chef, trésoriers"],
  ] },
  { titre: "Hôtel des ventes", intro: "Enchères de 7 jours avec achat immédiat facultatif, 3 annonces actives maximum, taxe de 15 % prélevée sur le prix final.", lignes: [
    ["/hdv vendre <prix de départ> [achat immédiat]", "Près du PNJ, met en vente tout le stack tenu en main. Ex. /hdv vendre 100 400", "Tous"],
    ["/hdv annonces", "Ses annonces en cours, avec l'offre actuelle et le temps restant", "Tous"],
    ["/hdv annuler <n°>", "Retire une annonce qui n'a pas encore d'offre (l'item va dans la boîte aux lettres)", "Vendeur"],
    ["/hdv", "Rappel du fonctionnement", "Tous"],
  ] },
];
let cq = "", STAFF_CMD = null, staffTried = false;
// La commande : surligne les <arguments>, bouton pour copier la partie avant le premier argument
const cmdHtml = (c) => { const first = c.split(/ [<[(]/)[0];
  return `<code class="cmd-c">${E_(c).replace(/(&lt;[^&]*&gt;|\[[^\]]*\])/g, '<i>$1</i>')}</code> <button class="x copy" data-copy="${E_(first)}" aria-label="Copier ${E_(first)}" title="Copier">⧉</button>`; };
const match = (...t) => !cq || t.join(" ").toLowerCase().includes(cq);
function cmdTable(sec, withWho) {
  const rows = sec.lignes.filter((l) => match(sec.titre, ...l));
  if (!rows.length) return "";
  return `<section class="board cmd-sec" id="cmd-${E_(fold(sec.titre).replace(/[^a-z0-9]+/g, "-"))}"><h3>${E_(sec.titre)}</h3>${sec.intro ? `<p class="small muted">${E_(sec.intro)}</p>` : ""}
    <div class="tbl-wrap"><table class="tbl left cmds"><thead><tr><th>Commande</th><th>Usage</th>${withWho ? "<th>Qui</th>" : ""}</tr></thead><tbody>
    ${rows.map((l) => `<tr><td>${cmdHtml(l[0])}</td><td>${E_(l[1])}</td>${withWho ? `<td class="muted small">${E_(l[2])}</td>` : ""}</tr>`).join("")}</tbody></table></div>
    ${sec.note ? `<p class="small muted">${E_(sec.note)}</p>` : ""}</section>`;
}
function commandes(view) {
  const live = /(^|\.)sumenium\.com$|^localhost$|^127\.0\.0\.1$/.test(location.hostname);
  if (live && !staffTried) {
    staffTried = true;  // réservé au staff : le Worker ne renvoie la liste qu'aux comptes Discord staff
    fetch("/api/admin/commandes", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((d) => { STAFF_CMD = d; if (mode === "commandes") render(); }).catch(() => {});
  }
  const sans = SANS_COMMANDE.filter((l) => match("en jeu", ...l));
  view.innerHTML = `<div class="bar"><input type="search" id="cq" placeholder="Chercher une commande ou une action (boutique, bon, faction, hdv…)" value="${E_(cq)}" aria-label="Chercher une commande"></div>
    <div class="banner info">Tu débutes ? Les <a href="#aide/guides">guides pas à pas</a> expliquent comment acheter, ouvrir une boutique, vendre un service ou gagner de l'argent.</div>
    <p class="small muted">Mod Sumenium Economy 2.6.3. Les montants s'écrivent avec un point (3.5). Entre &lt; &gt; : obligatoire ; entre [ ] : facultatif.</p>
    ${sans.length ? `<section class="board cmd-sec"><h3>En jeu, sans commande</h3><p class="small muted">Acheter, vendre au FISC et ravitailler se fait en cliquant sur les coffres et les PNJ, pas avec des commandes.</p>
      <div class="tbl-wrap"><table class="tbl left cmds"><thead><tr><th>Action</th><th>Comment</th></tr></thead><tbody>
      ${sans.map((l) => `<tr><td><b>${E_(l[0])}</b></td><td>${E_(l[1])}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
    <h3 class="sec">Commandes des joueurs <small>accessibles à tous ; certaines sont réservées au chef ou aux trésoriers</small></h3>
    ${JOUEURS.map((s) => cmdTable(s, true)).join("")}
    ${STAFF_CMD ? `<h3 class="sec">Commandes des admins <span class="chip lvl-staff">Staff</span> <small>${E_(STAFF_CMD.intro)}</small></h3>${STAFF_CMD.sections.map((s) => cmdTable(s, false)).join("")}` : ""}
    <p class="empty" id="cmdNone" hidden>Aucune commande ne correspond.</p>`;
  if (!view.querySelector(".cmd-sec")) $("cmdNone").hidden = false;
  $("cq").oninput = (e) => { cq = e.target.value.toLowerCase(); const pos = e.target.selectionStart; render(); const el = $("cq"); el.focus(); el.setSelectionRange(pos, pos); };
  view.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => { b.textContent = "✓"; setTimeout(() => (b.textContent = "⧉"), 1200); })));
  // Lien direct vers une section : #aide/commandes/hdv, /boutiques, /factions…
  // (la page peut se redessiner juste après, quand la liste staff arrive : on garde l'ancre 2 s)
  if (cmdAnchor && Date.now() < cmdAnchor.until) {
    const id = "cmd-" + ({ hdv: "hotel-des-ventes", boutique: "boutiques", faction: "factions", bons: "bons-de-service" }[cmdAnchor.k] || cmdAnchor.k);
    setTimeout(() => { const el = $(id); if (el) el.scrollIntoView({ block: "start" }); }, 60);
  }
}
let cmdAnchor = null;

/* ---------------- entrée ---------------- */
const visible = () => (mode === "marche" && !$("p-marche").hidden) || (mode === "richesse" && !$("p-classements").hidden);
function show(m, s) {
  mode = ROOTS[m] ? m : "marche";
  if (mode === "commandes" && s) cmdAnchor = { k: s, until: Date.now() + 2000 };
  if (mode === "marche") sub = SUBS.some(([k]) => k === s) ? s : "boutiques";
  if (!loaded) load(); else render();
  if (!timer) timer = setInterval(() => { if (visible() && !(mode === "marche" && sub === "detail")) load(); }, 120000);
  if (!tick) tick = setInterval(() => {
    if (mode !== "marche" || $("p-marche").hidden || sub !== "hdv") return;
    document.querySelectorAll(".countdown[data-fin]").forEach((el) => { if (el.dataset.fin) el.innerHTML = remain(+el.dataset.fin); });
  }, 1000);
}
let rz = null;
window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (mode === "marche" && sub === "economie" && !$("p-marche").hidden && E) render(); }, 200); });
// refresh : redessine l'onglet affiché (les noms français des objets arrivent parfois après les données)
window.Economie = { show, data: () => E, refresh: () => { if (loaded && visible()) render(); }, charts: { stackChart }, names: { enchName, potName } };
// Chargé tout de suite : l'accueil et les fiches joueur / faction s'en servent aussi
if (location.hostname !== "deedg.github.io") load();
})();
