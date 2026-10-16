/* Onglet Économie : données du mod Sumenium Economy (site/eco.json, relu toutes les 2 min).
   Montants des exports en Su. Chaque partie affiche « données indisponibles » si son fichier manque. */
(() => {
const $ = (id) => document.getElementById(id);
const E_ = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let E = null, loaded = false, sub = "apercu", timer = null, tick = null;
const SUBS = [["apercu", "Aperçu"], ["boutiques", "Boutiques"], ["hdv", "Hôtel des ventes"], ["fisc", "FISC"], ["factions", "Factions"], ["baltop", "Baltop"]];
const f = { q: "", owner: "", fac: "", type: "", stock: false, sort: "recent" };

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
const facById = (id) => (E && E.factions || []).find((x) => x.id === id);
const facColor = (c) => (typeof col === "function" ? col(c) : null) || (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : null) || "var(--muted)";
const facTag = (id) => { const x = facById(id); if (!x) return id ? `<span class="chip">${E_(id)}</span>` : "";
  return `<span class="ftag" style="--fc:${E_(facColor(x.couleur))}">${E_(x.tag)}</span>`; };
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
}

function render() {
  const root = $("ecoRoot");
  if (!root) return;
  if (!loaded) { root.innerHTML = '<p class="empty">Chargement…</p>'; return; }
  const when = E && E.genereLe ? (typeof ago === "function" ? ago(E.genereLe) : "") : "";
  root.innerHTML = `<nav class="subtabs" aria-label="Économie">${SUBS.map(([k, l]) =>
      `<a href="#economie/${k}" aria-current="${k === sub ? "page" : "false"}">${l}</a>`).join("")}</nav>
    ${E ? `<p class="muted small eco-when">Données du serveur ${E_(when)} · synchronisées toutes les 5 minutes</p>` : ""}
    <div id="ecoView"></div>`;
  const view = $("ecoView");
  if (!E) { view.innerHTML = unavailable(); return; }
  ({ apercu, boutiques, hdv, fisc, factions, baltop })[sub](view);
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
    <div class="board chart-board"><h3>Argent en circulation<small>un point par heure</small></h3><div id="ecoLine"></div></div>
    <div class="board chart-board"><h3>Volume des échanges<small>7 derniers jours</small></h3><div id="ecoBars"></div></div>
    <div class="boards boards-2">
      <div class="board"><h3>Objets les plus vendus<small>boutiques des joueurs, 7 j</small></h3>${topList(s && s.topVentesJoueurs7j, false)}</div>
      <div class="board"><h3>Rachats du FISC<small>7 j</small></h3>${topList(s && s.rachatsFisc7j, true)}</div>
    </div>`;
  lineChart($("ecoLine"), E.masse);
  barChart($("ecoBars"), s && s.parJour7j);
}
function topList(rows, isItemId) {
  if (!rows) return '<p class="empty">Données indisponibles.</p>';
  if (!rows.length) return '<p class="empty">Rien sur les 7 derniers jours.</p>';
  const max = Math.max(...rows.map((r) => r.montant || 0), 1);
  return `<div class="rank-scroll"><ol class="rank">${rows.map((r, i) => `<li><span class="pos">${i + 1}</span>
    <span class="who">${isItemId ? ico(r.item) + " " + E_(itemName(r.item)) : E_(r.item)}<small>× ${n0(r.quantite)}</small></span>
    <span class="val">${su(r.montant, 0)}</span><span class="bar2"><s style="width:${Math.max(2, Math.round((r.montant || 0) / max * 100))}%"></s></span></li>`).join("")}</ol></div>`;
}

// Courbe (une série) : axe Y à 4 graduations, info-bulle au survol
function lineChart(el, pts) {
  if (!pts || pts.length < 2) { el.innerHTML = `<p class="empty">${pts ? "Pas encore assez de points (un par heure)." : "Données indisponibles."}</p>`; return; }
  const W = Math.max(300, el.clientWidth || 600), H = 220, P = { l: 64, r: 12, t: 12, b: 26 };
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = xs[0], x1 = xs[xs.length - 1];
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.08; y0 = Math.max(0, y0 - pad); y1 += pad;
  const X = (t) => P.l + (t - x0) / (x1 - x0 || 1) * (W - P.l - P.r), Y = (v) => H - P.b - (v - y0) / (y1 - y0) * (H - P.t - P.b);
  const ticks = [0, 1, 2, 3].map((i) => y0 + (y1 - y0) * i / 3);
  const days = []; const d = new Date(x0); d.setHours(0, 0, 0, 0);
  for (let t = d.getTime() + 86400000; t < x1; t += 86400000) days.push(t);
  const step = Math.ceil(days.length / Math.max(1, Math.floor((W - P.l) / 80)));
  const path = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
  el.innerHTML = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe de l'argent en circulation, de ${su(ys[0], 0)} à ${su(ys[ys.length - 1], 0)}">
    ${ticks.map((v) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis" x="${P.l - 8}" y="${Y(v) + 4}" text-anchor="end">${E_(suShort(v))}</text>`).join("")}
    ${days.filter((_, i) => i % step === 0).map((t) => `<text class="axis" x="${X(t)}" y="${H - 8}" text-anchor="middle">${new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</text>`).join("")}
    <path class="line" d="${path}"/>
    <line class="cross" id="ecoCross" y1="${P.t}" y2="${H - P.b}" visibility="hidden"/><circle class="dot" id="ecoDot" r="5" visibility="hidden"/>
    <rect x="${P.l}" y="${P.t}" width="${W - P.l - P.r}" height="${H - P.t - P.b}" fill="transparent" id="ecoHit"/></svg>
    <div class="ctip" id="ecoTipL" hidden></div>`;
  const hit = $("ecoHit"), tip = $("ecoTipL"), cross = $("ecoCross"), dot = $("ecoDot");
  const move = (clientX) => {
    const r = hit.getBoundingClientRect(), t = x0 + (clientX - r.left) / r.width * (x1 - x0);
    let best = 0; for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i][0] - t) < Math.abs(pts[best][0] - t)) best = i;
    const [bt, bv] = pts[best], px = X(bt);
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", px); dot.setAttribute("cy", Y(bv)); dot.setAttribute("visibility", "visible");
    tip.innerHTML = `<b>${E_(su(bv, 0))}</b><span>${new Date(bt).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>`;
    tip.hidden = false; tip.style.left = Math.min(Math.max(px - 60, 0), W - 140) + "px";
  };
  hit.addEventListener("pointermove", (e) => move(e.clientX));
  hit.addEventListener("pointerdown", (e) => move(e.clientX));
  hit.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); });
}

// Barres empilées par jour : 4 séries (couleurs validées clair/sombre), légende + tableau
const SERIES = [["ventesJoueurs", "Ventes en boutique"], ["rachatsFisc", "Rachats du FISC"], ["ventesHdv", "Ventes à l'HDV"], ["achatsFisc", "Achats au FISC"]];
function barChart(el, days) {
  if (!days) { el.innerHTML = '<p class="empty">Données indisponibles.</p>'; return; }
  if (!days.length) { el.innerHTML = '<p class="empty">Aucun échange sur les 7 derniers jours.</p>'; return; }
  const W = Math.max(300, el.clientWidth || 600), H = 220, P = { l: 64, r: 8, t: 10, b: 26 };
  const tot = days.map((d) => SERIES.reduce((a, [k]) => a + (d[k] || 0), 0));
  const max = Math.max(...tot, 1);
  const ticks = [0, 1, 2, 3].map((i) => max * i / 3);
  const slot = (W - P.l - P.r) / days.length, bw = Math.min(46, slot * 0.6);
  const Y = (v) => H - P.b - v / max * (H - P.t - P.b);
  const lab = (d) => new Date(d.jour + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
  let bars = "";
  days.forEach((d, i) => {
    let acc = 0; const x = P.l + i * slot + (slot - bw) / 2;
    SERIES.forEach(([k], si) => {
      const v = d[k] || 0; if (!v) return;
      const y = Y(acc + v), h = Y(acc) - y; acc += v;
      bars += `<rect class="s${si}" x="${x.toFixed(1)}" y="${(y + 1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h - 2).toFixed(1)}" rx="3"/>`;
    });
    bars += `<rect class="hitbar" data-i="${i}" x="${P.l + i * slot}" y="${P.t}" width="${slot}" height="${H - P.t - P.b}" fill="transparent"/>`;
    bars += `<text class="axis" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${E_(lab(d))}</text>`;
  });
  el.innerHTML = `<div class="legend">${SERIES.map(([, l], si) => `<span><i class="sw s${si}"></i>${l}</span>`).join("")}</div>
    <svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Volume des échanges par jour sur 7 jours">
    ${ticks.map((v) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis" x="${P.l - 8}" y="${Y(v) + 4}" text-anchor="end">${E_(suShort(v))}</text>`).join("")}
    ${bars}</svg><div class="ctip" id="ecoTipB" hidden></div>
    <details class="tblview"><summary>Voir le tableau</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Jour</th><th></th>${SERIES.map(([, l]) => `<th>${l}</th>`).join("")}<th>Taxes</th></tr></thead><tbody>
    ${days.map((d) => `<tr><td>${E_(lab(d))}</td><td></td>${SERIES.map(([k]) => `<td>${su(d[k] || 0, 0)}<small class="muted"> · ${n0(d[k + "Nb"])}</small></td>`).join("")}<td>${su(d.taxes || 0, 0)}</td></tr>`).join("")}
    </tbody></table></div></details>`;
  const tip = $("ecoTipB");
  el.querySelectorAll(".hitbar").forEach((r) => {
    const show = () => {
      const d = days[+r.dataset.i];
      tip.innerHTML = `<b>${E_(lab(d))}</b>${SERIES.map(([k, l], si) => `<span><i class="sw s${si}"></i>${l} : ${su(d[k] || 0, 0)} (${n0(d[k + "Nb"])})</span>`).join("")}`;
      tip.hidden = false; tip.style.left = Math.min(Math.max(+r.getAttribute("x") - 40, 0), W - 230) + "px";
    };
    r.addEventListener("pointerenter", show); r.addEventListener("pointerdown", show);
    r.addEventListener("pointerleave", () => (tip.hidden = true));
  });
}

/* ---------------- Boutiques ---------------- */
function boutiques(view) {
  const all = E.boutiques;
  if (!all) { view.innerHTML = unavailable("boutiques"); return; }
  const owners = [...new Set(all.map((s) => s.proprietaire).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const facs = [...new Set(all.map((s) => s.faction).filter(Boolean))];
  const q = f.q.toLowerCase();
  let list = all.filter((s) => (!q || [itemName(s.item, s.nom), s.nom, s.service, s.item, s.proprietaire].join(" ").toLowerCase().includes(q))
    && (!f.owner || s.proprietaire === f.owner) && (!f.fac || s.faction === f.fac)
    && (f.type === "*" || (f.type === "fisc" ? s.proprietaireType === "fisc" : f.type === "service" ? s.type === "service" : s.proprietaireType !== "fisc"))
    && (!f.stock || !s.rupture));
  const by = { recent: (a, b) => String(b.creeLe || "").localeCompare(String(a.creeLe || "")), prix: (a, b) => unit(a) - unit(b),
    ventes: (a, b) => (b.ventes || 0) - (a.ventes || 0), az: (a, b) => itemName(a.item, a.nom).localeCompare(itemName(b.item, b.nom)) }[f.sort];
  list = list.sort(by);
  const rupt = all.filter((s) => s.rupture).length;
  view.innerHTML = `<div class="bar">
      <input type="search" id="bq" placeholder="Chercher un objet, un service, un vendeur…" value="${E_(f.q)}" aria-label="Chercher une boutique">
      <select id="bo" aria-label="Propriétaire"><option value="">Tous les vendeurs</option>${owners.map((o) => `<option${o === f.owner ? " selected" : ""}>${E_(o)}</option>`).join("")}</select>
      <select id="bf" aria-label="Faction"><option value="">Toutes les factions</option>${facs.map((x) => `<option value="${E_(x)}"${x === f.fac ? " selected" : ""}>${E_((facById(x) || {}).tag || x)}</option>`).join("")}</select>
      <select id="bt" aria-label="Type"><option value="">Boutiques des joueurs</option><option value="service"${f.type === "service" ? " selected" : ""}>Services</option><option value="fisc"${f.type === "fisc" ? " selected" : ""}>FISC</option><option value="*"${f.type === "*" ? " selected" : ""}>Tout (FISC compris)</option></select>
      <select id="bs" aria-label="Tri"><option value="recent">Tri : plus récentes</option><option value="prix"${f.sort === "prix" ? " selected" : ""}>Tri : prix à l'unité</option><option value="ventes"${f.sort === "ventes" ? " selected" : ""}>Tri : plus vendues</option><option value="az"${f.sort === "az" ? " selected" : ""}>Tri : A → Z</option></select>
      <label class="chk"><input type="checkbox" id="bk"${f.stock ? " checked" : ""}> En stock</label></div>
    <p class="count">${n0(list.length)} boutique${list.length > 1 ? "s" : ""}${rupt ? ` · ${n0(rupt)} en rupture sur le serveur` : ""}</p>
    <div class="shop-grid">${list.map(shopCard).join("") || '<p class="empty">Aucune boutique ne correspond.</p>'}</div>`;
  const keep = (id, k, val) => { $(id).oninput = $(id).onchange = (e) => { f[k] = val ? val(e.target) : e.target.value; const pos = id === "bq" ? e.target.selectionStart : null; render();
    if (pos !== null) { const el = $("bq"); el.focus(); el.setSelectionRange(pos, pos); } }; };
  keep("bq", "q"); keep("bo", "owner"); keep("bf", "fac"); keep("bt", "type"); keep("bs", "sort"); keep("bk", "stock", (t) => t.checked);
}
const unit = (s) => (s.prix || 0) / Math.max(1, s.quantite || 1);
function shopCard(s) {
  const svc = s.type === "service", fiscS = s.proprietaireType === "fisc";
  const name = svc ? (s.service || "Service") : itemName(s.item, s.nom);
  const stock = svc ? '<span class="chip ok">Stock illimité</span>' : s.rupture ? '<span class="chip warn">Rupture</span>'
    : s.stock === null || s.stock === undefined ? "" : `<span class="chip">${n0(s.stock)} en stock</span>`;
  const label = fiscS ? (s.type === "fisc_rachat" ? "Le FISC rachète" : "Le FISC vend") : "";
  return `<article class="shop${s.rupture ? " out" : ""}">
    <header>${ico(s.item)}<div><b>${E_(name)}</b>${s.quantite > 1 ? `<span class="muted small"> × ${n0(s.quantite)}</span>` : ""}
      ${!svc && s.nom && s.nom !== name && s.nom.toLowerCase() !== idOf(s.item).replace(/_/g, " ") ? `<span class="muted small nom">« ${E_(s.nom)} »</span>` : ""}</div></header>
    <p class="price">${label ? `<span class="muted small">${label} </span>` : ""}${su(s.prix)}${s.quantite > 1 ? `<span class="muted small"> · ${su(unit(s))} l'unité</span>` : ""}</p>
    <div class="tags">${stock}${s.ventes ? `<span class="chip muted">${n0(s.ventes)} vente${s.ventes > 1 ? "s" : ""}</span>` : ""}</div>
    <p class="owner">${fiscS ? "<b>FISC</b>" : `<b>${E_(s.proprietaire)}</b>`} ${s.proprietaireType === "faction" ? '<span class="muted small">boutique de faction</span>' : ""} ${facTag(s.faction)}</p>
    <p class="pos">${mapLink(s)}</p>
  </article>`;
}

/* ---------------- Hôtel des ventes ---------------- */
function hdv(view) {
  const list = E.hdv;
  if (!list) { view.innerHTML = unavailable("hôtel des ventes"); return; }
  const open = list.filter((a) => !a.fin || a.fin > Date.now());
  view.innerHTML = `<div class="card"><p class="small">Enchères de 7 jours au PNJ du spawn. Une offre dans les 5 dernières minutes prolonge l'enchère de 5 minutes. Taxe de 15 % sur le prix final.</p></div>
    <p class="count">${n0(open.length)} annonce${open.length > 1 ? "s" : ""} en cours</p>
    <div class="shop-grid">${open.map((a) => `<article class="shop hdv">
      <header>${ico(a.item)}<div><b>${E_(itemName(a.item, a.nom))}</b>${a.quantite > 1 ? `<span class="muted small"> × ${n0(a.quantite)}</span>` : ""}
        ${a.nom && a.nom !== itemName(a.item, a.nom) && a.nom.toLowerCase() !== idOf(a.item).replace(/_/g, " ") ? `<span class="muted small nom">« ${E_(a.nom)} »</span>` : ""}</div></header>
      <p class="price">${a.offreActuelle ? su(a.offreActuelle) : su(a.prixDepart)}<span class="muted small"> ${a.offreActuelle ? `offre de ${E_(a.meilleurEncherisseur || "?")} · ${n0(a.nbOffres)} offre${a.nbOffres > 1 ? "s" : ""}` : "prix de départ, aucune offre"}</span></p>
      <div class="tags">${a.achatImmediat ? `<span class="chip ok">Achat immédiat ${su(a.achatImmediat)}</span>` : '<span class="chip muted">Pas d\'achat immédiat</span>'}</div>
      <p class="owner">Vendu par <b>${E_(a.vendeur)}</b></p>
      <p class="countdown" data-fin="${a.fin || ""}">${remain(a.fin)}</p></article>`).join("") || '<p class="empty">Aucune annonce en cours.</p>'}</div>`;
}
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
  const table = (rows, sell) => rows.length ? `<div class="tbl-wrap"><table class="tbl left"><thead><tr><th>Objet</th><th>${sell ? "Prix" : "Le FISC paie"}</th>${sell ? "<th>Lot</th>" : ""}<th>Où</th></tr></thead><tbody>
    ${rows.slice().sort((a, b) => itemName(a.item, a.nom).localeCompare(itemName(b.item, b.nom))).map((r) => `<tr><td>${ico(r.item)} ${E_(itemName(r.item, r.nom))}</td><td><b>${su(r.prix)}</b>${sell ? "" : '<span class="muted small"> / unité</span>'}</td>${sell ? `<td>× ${n0(r.quantite || 1)}</td>` : ""}<td>${mapLink(r)}</td></tr>`).join("")}
    </tbody></table></div>` : '<p class="empty">Aucun.</p>';
  view.innerHTML = `${F.prixDynamiques && F.prixDynamiques !== "off" ? `<div class="banner info">Prix dynamiques activés (${E_(F.prixDynamiques)}) : les prix évoluent selon les quantités échangées.</div>` : ""}
    <div class="board"><h3>Ce que le FISC rachète<small>${n0(F.rachat.length)} objets</small></h3>${table(F.rachat, false)}</div>
    <div class="board" style="margin-top:14px"><h3>Ce que le FISC vend<small>stock illimité</small></h3>${table(F.vente, true)}</div>`;
}

/* ---------------- Factions ---------------- */
const ROLE = { chef: ["Chef", "lvl-staff"], tresorier: ["Trésorier", "lvl-attente"], membre: ["Membre", "muted"] };
function factions(view) {
  const F = E.factions;
  if (!F) { view.innerHTML = unavailable("factions"); return; }
  const order = { chef: 0, tresorier: 1, membre: 2 };
  view.innerHTML = `<div class="fac-grid">${F.slice().sort((a, b) => b.banque - a.banque).map((x) => `<article class="card fac">
    <header><h3><span class="ftag big" style="--fc:${E_(facColor(x.couleur))}">${E_(x.tag)}</span></h3><span class="chip">${n0(x.membres.length)} membre${x.membres.length > 1 ? "s" : ""}</span></header>
    <p class="price">${su(x.banque)}<span class="muted small"> en banque</span></p>
    <ul class="roster">${x.membres.slice().sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3) || a.nom.localeCompare(b.nom)).map((m) =>
      `<li>${E_(m.nom)} <span class="chip ${(ROLE[m.role] || ROLE.membre)[1]}">${(ROLE[m.role] || ROLE.membre)[0]}</span></li>`).join("")}</ul>
  </article>`).join("") || '<p class="empty">Aucune faction.</p>'}</div>`;
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
      ${facRows ? `<div class="rank-scroll"><ol class="rank">${facRows.map((x, i) => `<li><span class="pos">${i + 1}</span><span class="who"><span class="ftag" style="--fc:${E_(facColor(x.couleur))}">${E_(x.tag)}</span></span>
        <span class="val">${su(x.banque, 0)}</span><span class="bar2"><s style="width:${Math.max(2, Math.round(x.banque / max * 100))}%"></s></span></li>`).join("")}</ol></div>` : '<p class="empty">Données indisponibles.</p>'}</div>
  </div>`;
}

/* ---------------- entrée ---------------- */
function show(s) {
  if (s && SUBS.some(([k]) => k === s)) sub = s;
  if (!loaded) load(); else render();
  if (!timer) timer = setInterval(() => { if (!$("p-economie").hidden) load(); }, 120000);
  if (!tick) tick = setInterval(() => {
    if ($("p-economie").hidden || sub !== "hdv") return;
    document.querySelectorAll(".countdown[data-fin]").forEach((el) => { if (el.dataset.fin) el.innerHTML = remain(+el.dataset.fin); });
  }, 1000);
}
let rz = null;
window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (sub === "apercu" && !$("p-economie").hidden && E) render(); }, 200); });
window.Economie = { show };
})();
