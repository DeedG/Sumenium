/* Marché › Détail de l'économie : tableau de bord d'après le journal du mod (via /api/eco/detail) et eco.json.
   Visible par tous : les comptes des joueurs y sont remplacés par leur faction (anonyme pour les joueurs seuls).
   Le staff connecté voit en plus les noms (rachats par joueur) et les réglages.
   Définitions (figées, voir la spec) :
   - création : le FISC (ou le staff) paie un compte ; destruction : un compte paie le FISC, plus les taxes de vente ;
   - commerce : achat en boutique ou à l'hôtel des ventes ; interne si l'acheteur et le vendeur sont de la même faction ;
   - faction d'un joueur : sa faction actuelle dans le mod ;
   - jours coupés à minuit, heure de Paris. */
(() => {
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n0 = (v) => Number(v || 0).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const su = (v) => n0(v) + " Su";
const pct = (v, d = 0) => (v === null || !isFinite(v) ? "—" : (v * 100).toLocaleString("fr-FR", { maximumFractionDigits: d }) + " %");
const idOf = (i) => String(i || "").replace(/^minecraft:/, "");
const DAY = 86400000;

const PAGES = [["vue", "Vue d'ensemble"], ["flux", "Flux entre factions"], ["usines", "Usines"], ["boutiques", "Boutiques et prix"], ["fisc", "FISC et reprise"], ["reglages", "Réglages (staff)"]];
const STAFF = () => !!(RAW && RAW.staff);
const PERIODES = [[7, "7 j"], [14, "14 j"], [30, "30 j"], [0, "Saison"]];
// Libellés des sources de création / destruction (type du journal)
const SRC = { RACHAT_FISC: "Rachats de minerais", REPRISE_FISC: "Reprises d'objets rares", REMBOURSEMENT_BOUTIQUE: "Remboursements de boutique", ADMIN: "Staff",
  ACHAT_FISC: "Achats au FISC", ACHAT_TETE: "Têtes", REVENTE_FISC: "Reventes d'objets rares", FRAIS_BOUTIQUE: "Frais de boutique", TAXE: "Taxes de vente" };

// Usine → items (première version de la spec, modifiable dans Réglages). « * » = n'importe quelle suite de lettres.
const DEFAUT_USINES = {
  "Usine à fer": ["iron_ingot", "iron_block", "iron_nugget", "poppy"],
  "Usine à pigmen / Or": ["gold_nugget", "gold_ingot", "gold_block", "golden_apple", "golden_carrot", "rotten_flesh"],
  "Usine à raid": ["emerald", "emerald_block", "totem_of_undying", "crossbow", "saddle", "redstone", "redstone_block", "glass_bottle"],
  "Usine à guardian": ["prismarine_shard", "prismarine_crystals", "prismarine", "sponge", "wet_sponge"],
  "Usine à shulker": ["shulker_shell", "shulker_box", "*_shulker_box"],
  "Usine à bibliothécaire": ["enchanted_book", "bookshelf"],
  "Usine à mob": ["bone", "arrow", "string", "spider_eye", "rotten_flesh", "gunpowder"],
  "Usine à wither skeleton": ["wither_skeleton_skull", "coal", "coal_block", "bone"],
  "Usine blocs à gravité": ["sand", "red_sand", "gravel", "*_concrete_powder", "anvil"],
  "Usine à piglins / troc": ["ender_pearl", "crying_obsidian", "quartz", "leather", "soul_sand", "fire_charge", "nether_brick", "spectral_arrow", "blackstone", "string", "obsidian"],
  "Usine à witch": ["redstone", "glowstone_dust", "sugar", "glass_bottle", "stick", "spider_eye", "gunpowder"],
  "Usine à slime": ["slime_ball", "slime_block"],
  "Usine à bois": ["*_log", "*_wood", "*_planks", "*_stem", "*_hyphae", "bamboo_block"],
  "Usine à creeper": ["gunpowder", "firework_rocket", "tnt"],
  "Usine à drowned": ["trident", "copper_ingot", "copper_block", "nautilus_shell"],
  "Usine à abeille": ["honey_bottle", "honeycomb", "honey_block", "honeycomb_block"],
  "Usine à mousse": ["moss_block", "moss_carpet"],
  "Usine à Allay/Tatou pour xp": ["experience_bottle", "armadillo_scute", "service:xp", "service:niveau", "service:repar", "service:enchant"],
  "Usine à grenouille": ["*_froglight"],
  "Usine avec spawner": ["bone", "arrow", "string", "spider_eye", "rotten_flesh"],
  "Usine à ghast": ["ghast_tear", "gunpowder"],
  "Usine à blaze": ["blaze_rod", "blaze_powder"],
  "Usine à enderman": ["ender_pearl"],
  "Usine à potions": ["potion", "splash_potion", "lingering_potion", "nether_wart"],
  "Usine à trial chamber": ["breeze_rod", "wind_charge", "trial_key", "ominous_trial_key"],
  "Usine à pillager": ["crossbow", "ominous_bottle"],
  "Usine à wither (wither rose + obsi)": ["wither_rose", "obsidian"],
  "Usine à laine": ["*_wool", "*_carpet", "mutton"],
  "Usine à Bonemeal": ["bone_meal", "bone"],
  "Ferme à bouffe hors moutons et abeilles": ["carrot", "potato", "baked_potato", "wheat", "bread", "beetroot", "melon_slice", "pumpkin", "pumpkin_pie", "cooked_*", "golden_carrot", "apple", "sweet_berries", "cake", "cookie", "*_stew", "dried_kelp"],
  "Usine à résine": ["resin_clump", "resin_block", "resin_brick*"],
  "Usine à fleur": ["dandelion", "poppy", "blue_orchid", "allium", "azure_bluet", "*_tulip", "oxeye_daisy", "cornflower", "lily_of_the_valley", "sunflower", "lilac", "rose_bush", "peony", "*_dye"],
};

let X = null;            // { ECO (eco.json), D (données de l'Espace : factions, usines), facOfEco }
async function call(method, path, body) {
  const r = await fetch(path, { method, credentials: "same-origin", headers: { "content-type": "application/json", "x-requested-with": "sumenium" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
  return j;
}
const toast = (msg, bad) => (window.Espace && window.Espace.toast ? window.Espace.toast(msg, bad) : bad && alert(msg));
let RAW = null, rawAt = 0, loadErr = null, loadingP = null;
const st = { page: "vue", per: 14, du: "", au: "", fac: "", q: "", sort: {} };
let lastEl = null, lastCtx = null;
const CSV = [];          // tableaux exportables de la page affichée

/* ---------- jours (heure de Paris) ---------- */
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const dayOf = (t) => dayFmt.format(t);
const tzOff = (t) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(t);
  const g = (k) => +p.find((x) => x.type === k).value; return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - Math.floor(t / 60000) * 60000; };
const midnight = (day) => { const u = Date.parse(day + "T00:00:00Z"); return u - tzOff(u); };
const addDays = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
const dayLabel = (day, o = { day: "numeric", month: "short" }) => new Date(day + "T12:00:00").toLocaleDateString("fr-FR", o);

/* ---------- données ---------- */
async function load(force) {
  if (RAW && !force && Date.now() - rawAt < 120000) return RAW;
  if (!loadingP) loadingP = call("GET", "/api/eco/detail").then((r) => { RAW = r; rawAt = Date.now(); loadErr = null; prep(); return r; })
    .catch((e) => { loadErr = e.message; throw e; }).finally(() => { loadingP = null; });
  return loadingP;
}

// Lignes du journal → événements classés : { t, day, type, kind, m (Su), tax, buyer/seller ou to/from (clés de faction), item, qty, shop, actor }
let EV = [], NAMES = {}, FAC = new Map(), PLAYER_FAC = new Map();
const isAcc = (v) => v && (v.startsWith("joueur:") || v.startsWith("faction:") || v.startsWith("solo:"));
function prep() {
  const ECO = X.ECO || {};
  NAMES = { ...(RAW.noms || {}) };
  const C = RAW.cols, ix = Object.fromEntries(C.map((c, i) => [c, i]));
  const rows = RAW.rows.map((r) => Object.fromEntries(C.map((c) => [c, r[ix[c]]])));
  for (const r of rows) {
    if (r.actor && r.actorName) NAMES[r.actor] = r.actorName;
    if (r.from && r.from.startsWith("joueur:") && r.fromName) NAMES[r.from.slice(7)] = NAMES[r.from.slice(7)] || r.fromName;
    if (r.to && r.to.startsWith("joueur:") && r.toName) NAMES[r.to.slice(7)] = NAMES[r.to.slice(7)] || r.toName;
  }
  // Factions du mod (clé en minuscules) et faction actuelle de chaque joueur
  FAC = new Map((ECO.factions || []).map((f) => [String(f.id).toLowerCase(), f]));
  PLAYER_FAC = new Map((ECO.joueurs || []).map((j) => [String(j.nom).toLowerCase(), j.faction ? String(j.faction).toLowerCase() : null]));
  EV = [];
  for (const r of rows) {
    const m = (Number(r.amount) || 0) / 100, tax = (Number(r.tax) || 0) / 100;
    const e = { t: r.t, day: dayOf(r.t), type: r.type, m, tax: 0, item: r.item ? idOf(r.item) : null, qty: Number(r.qty) || 0, shop: r.shop || null, actor: r.actor };
    const commerce = r.type === "ACHAT" || r.type === "ACHAT_SERVICE" || r.type === "HDV_VENTE";
    if (r.type === "HDV_OFFRE" || r.type === "HDV_REMBOURSEMENT") continue;       // argent bloqué puis rendu : neutre
    if (commerce && (isAcc(r.from) || r.type === "HDV_VENTE") && isAcc(r.to)) {
      const buyer = r.type === "HDV_VENTE" && r.actor ? "joueur:" + r.actor : r.from;
      e.kind = "commerce"; e.buyer = keyOf(buyer); e.seller = keyOf(r.to); e.tax = tax; e.internal = e.buyer === e.seller;
    } else if ((r.from === "fisc" || !r.from) && isAcc(r.to)) { e.kind = "creation"; e.to = keyOf(r.to); e.toName = nameOf(r.to); }
    else if (isAcc(r.from) && (r.to === "fisc" || !r.to)) { e.kind = "destruction"; e.from = keyOf(r.from); }
    else if (isAcc(r.from) && isAcc(r.to)) { e.kind = "transfert"; e.tax = tax; }
    else continue;
    EV.push(e);
  }
}
const nameOf = (acc) => acc && acc.startsWith("joueur:") ? NAMES[acc.slice(7)] || acc.slice(7, 15) : null;
// Clé de faction d'un compte : « f:<id du mod> », ou « s:<pseudo> » pour un joueur sans faction (sa propre faction solo)
function keyOf(acc) {
  if (!acc) return null;
  if (acc.startsWith("faction:")) return "f:" + acc.slice(8);
  if (acc.startsWith("solo:")) return "s:#" + acc.slice(5);     // joueur seul anonyme (version publique)
  const n = nameOf(acc), f = n && PLAYER_FAC.get(n.toLowerCase());
  return f ? "f:" + f : "s:" + (n || acc.slice(7, 15)).toLowerCase();
}
function facInfo(key) {
  if (!key) return { label: "?", members: 1 };
  if (key.startsWith("site:")) { const site = X.D.factions.find((f) => "site:" + f.id === key); return { label: site ? site.name + " (pas dans le mod)" : key, site, members: 1 }; }
  if (key.startsWith("s:#")) return { label: "Joueur solo", solo: true, anon: true, members: 1 };
  if (key.startsWith("s:")) { const n = key.slice(2); const j = ((X.ECO && X.ECO.joueurs) || []).find((x) => x.nom.toLowerCase() === n); return { label: (j ? j.nom : n), solo: true, members: 1 }; }
  const f = FAC.get(key.slice(2)), site = f && X.facOfEco && X.facOfEco(f.id);
  return { label: site ? site.name : f ? f.tag || f.id : key.slice(2), site, eco: f, members: f ? Math.max(1, (f.membres || []).length) : 1 };
}
const facName = (key) => facInfo(key).label;
const facHtml = (key) => { const i = facInfo(key); return i.site ? `<a href="#communaute/faction/${i.site.id}">${esc(i.label)}</a>` : i.anon ? '<span class="muted">Joueurs solo</span>' : i.solo ? `${esc(i.label)} <span class="chip">solo</span>` : esc(i.label); };
// Clé de faction d'une faction du site
const keyOfSite = (fid) => { const f = X.D.factions.find((x) => x.id === fid); for (const [k, e] of FAC) { const s = X.facOfEco && X.facOfEco(e.id); if (s && s.id === fid) return "f:" + k; } return f ? "site:" + f.id : null; };
// Faction d'une boutique d'eco.json
const shopKey = (s) => s.faction ? "f:" + String(s.faction).toLowerCase() : s.proprietaireType === "joueur" ? "s:" + String(s.proprietaire || "").toLowerCase() : null;

/* ---------- périodes ---------- */
function period() {
  const today = dayOf(Date.now());
  let a, b;
  if (st.du || st.au) { a = st.du || dayOf(Date.parse(RAW.saisonDebut)); b = st.au || today; if (b < a) [a, b] = [b, a]; }
  else if (st.per) { b = today; a = addDays(today, -(st.per - 1)); }
  else { a = dayOf(Date.parse(RAW.saisonDebut)); b = today; }
  const n = Math.round((Date.parse(b) - Date.parse(a)) / DAY) + 1;
  return { a, b, n, start: midnight(a), end: midnight(addDays(b, 1)), prev: { a: addDays(a, -n), b: addDays(a, -1), start: midnight(addDays(a, -n)), end: midnight(a) } };
}
const inP = (e, P) => e.t >= P.start && e.t < P.end;

// Indicateurs d'une période
function agg(P) {
  const o = { crea: 0, dest: 0, creaBy: {}, destBy: {}, ext: 0, int: 0, extN: 0, transf: 0, perFac: new Map(), days: new Map(), ev: [] };
  const F = (k) => { if (!o.perFac.has(k)) o.perFac.set(k, { achExt: 0, venExt: 0, achInt: 0, crea: 0, fourn: new Set(), clients: new Set(), ventesN: 0 }); return o.perFac.get(k); };
  const D = (d) => { if (!o.days.has(d)) o.days.set(d, { jour: d }); return o.days.get(d); };
  const add = (obj, k, v) => (obj[k] = (obj[k] || 0) + v);
  for (const e of EV) {
    if (!inP(e, P)) continue;
    o.ev.push(e);
    const d = D(e.day);
    if (e.kind === "creation") { o.crea += e.m; add(o.creaBy, e.type, e.m); add(d, "c_" + grpC(e.type), e.m); F(e.to).crea += e.m; }
    else if (e.kind === "destruction") { o.dest += e.m; add(o.destBy, e.type, e.m); add(d, "d_" + grpD(e.type), e.m); }
    else if (e.kind === "commerce") {
      if (e.internal) { o.int += e.m; add(d, "int", e.m); F(e.buyer).achInt += e.m; }
      else { o.ext += e.m; o.extN++; add(d, "ext", e.m); const b = F(e.buyer), s = F(e.seller); b.achExt += e.m; s.venExt += e.m; s.ventesN++; b.fourn.add(e.seller); s.clients.add(e.buyer); }
    } else if (e.kind === "transfert") o.transf += e.m;
    if (e.tax > 0) { o.dest += e.tax; add(o.destBy, "TAXE", e.tax); add(d, "d_TAXE", e.tax); }
  }
  o.net = o.crea - o.dest;
  o.creaRecue = [...o.perFac.values()].reduce((a, f) => a + f.crea, 0);
  o.partFisc = o.creaRecue + o.ext ? o.creaRecue / (o.creaRecue + o.ext) : null;
  return o;
}
function daysOf(P, o) { const out = []; for (let d = P.a; d <= P.b; d = addDays(d, 1)) out.push(o.days.get(d) || { jour: d }); return out; }

/* ---------- usines ---------- */
const cfg = () => { const c = (RAW && RAW.config) || {}; return { usines: { ...DEFAUT_USINES, ...(c.usines || {}) }, seuilPct: c.seuilPct ?? 10, seuilVentes: c.seuilVentes ?? 5 }; };
const reCache = new Map();
const foldS = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
// Ce que produit une usine : des items (« iron_ingot », « *_log ») et des services (« service:xp » = service dont le nom contient « xp »)
function matcher(nom) {
  const toks = cfg().usines[nom] || [];
  const k = nom + "|" + toks.join(",");
  if (!reCache.has(k)) {
    const items = toks.filter((t) => !t.startsWith("service:")), svc = toks.filter((t) => t.startsWith("service:")).map((t) => foldS(t.slice(8))).filter(Boolean);
    const re = items.length ? new RegExp("^(" + items.map((t) => idOf(t).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[a-z0-9_]*")).join("|") + ")$") : null;
    reCache.set(k, re || svc.length ? { re, svc, test: (item, service) => (item ? !!re && re.test(item) : !!service && svc.some((w) => foldS(service).includes(w))) } : null);
  }
  return reCache.get(k);
}
// Une boutique produit-elle pour cette usine ? (item, un des items d'un lot, ou nom du service)
const shopMatches = (m, s) => !!m && (s.type === "service" ? m.test(null, s.service) : s.lot ? s.lot.some((x) => m.test(idOf(x.item))) : m.test(idOf(s.item)));
const usineOf = (id) => X.D.usines.find((u) => u.id === id);
function usinesData() {
  const today = dayOf(Date.now()), W = { a: addDays(today, -13), b: today }; W.start = midnight(W.a); W.end = midnight(addDays(today, 1));
  const shopById = new Map(((X.ECO && X.ECO.boutiques) || []).map((s) => [s.id, s]));
  // ventes externes avec ce qu'elles vendent : item, ou nom du service de la boutique
  const ext = EV.filter((e) => e.kind === "commerce" && !e.internal && inP(e, W)).map((e) => ({ ...e, service: e.item ? null : (shopById.get(e.shop) || {}).service || null }))
    .filter((e) => e.item || e.service);
  const extTotal = EV.filter((e) => e.kind === "commerce" && !e.internal && inP(e, W)).reduce((a, e) => a + e.m, 0);
  const C = cfg(), choix = X.D.choix || [];
  const moyenne = choix.length ? extTotal / choix.length : 0, seuil = moyenne * C.seuilPct / 100;
  const holders = new Map();  // usine_id → Set(clés)
  for (const c of choix) { const k = keyOfSite(c.faction_id); if (!holders.has(c.usine_id)) holders.set(c.usine_id, new Set()); holders.get(c.usine_id).add(k); }
  const shops = (X.ECO && X.ECO.boutiques) || [];
  const list = choix.map((c) => {
    const u = usineOf(c.usine_id) || { nom: "?", taille: "" }, k = keyOfSite(c.faction_id), re = matcher(u.nom);
    const sales = re ? ext.filter((e) => e.seller === k && re.test(e.item, e.service)) : [];
    const ca = sales.reduce((a, e) => a + e.m, 0), clients = new Set(sales.map((e) => e.buyer)).size;
    const mine = re ? shops.filter((s) => shopKey(s) === k && shopMatches(re, s)) : [];
    const rupt = mine.filter((s) => s.rupture).length, nShops = mine.filter((s) => s.type !== "service").length, nSvc = mine.filter((s) => s.type === "service").length;
    const commerciale = !!re && (ca >= seuil && ca > 0 || sales.length >= C.seuilVentes);
    return { c, u, k, ca, n: sales.length, clients, rupt, nShops, nSvc, commerciale, origine: c.projet_faction_id ? "★ projet" : `tour ${c.tour || 1}`, sansItems: !re };
  });
  // Par type d'usine : détenteurs, vendeurs de ses items, CA venant de factions qui ne l'ont pas (exposé au prochain tour)
  const types = X.D.usines.map((u) => {
    const re = matcher(u.nom), h = holders.get(u.id) || new Set();
    const s = re ? ext.filter((e) => re.test(e.item, e.service)) : [];
    const vendeurs = new Map();
    for (const e of s) { const v = vendeurs.get(e.seller) || { ca: 0, expose: 0 }; v.ca += e.m; if (!h.has(e.buyer)) v.expose += e.m; vendeurs.set(e.seller, v); }
    const acheteurs = new Set(s.map((e) => e.buyer));
    return { u, holders: h, vendeurs, ca: s.reduce((a, e) => a + e.m, 0), expose: [...vendeurs.values()].reduce((a, v) => a + v.expose, 0), acheteurs, sansItems: !re };
  });
  // Services : reliés à une usine (d'après la table usine → items) ou non
  const services = shops.filter((s) => s.type === "service").map((s) => {
    const us = X.D.usines.filter((u) => shopMatches(matcher(u.nom), s)), sales = ext.filter((e) => e.shop === s.id);
    const held = us.filter((u) => (holders.get(u.id) || new Set()).has(shopKey(s)));
    return { s, us, held, n: sales.length, ca: sales.reduce((a, e) => a + e.m, 0) };
  });
  return { list, types, services, moyenne, seuil, W, C };
}

/* ---------- rendu ---------- */
function render(el, ctx) {
  lastEl = el; lastCtx = ctx;
  const Es = window.Espace || {};
  X = { ECO: ctx.ECO, D: (Es.data && Es.data()) || { factions: [], usines: [], choix: [] }, facOfEco: Es.facOfEco };
  if (!["sumenium.com", "localhost", "127.0.0.1"].includes(location.hostname)) {
    el.innerHTML = `<div class="card center"><h3>Cette partie est sur sumenium.com</h3><a class="btn" href="https://sumenium.com/${esc(location.hash)}">Ouvrir sur sumenium.com</a></div>`; return;
  }
  // Connexion ou déconnexion du staff depuis le dernier chargement : on relit
  const me = X.D.user, staffNow = !!(me && me.level === "staff");
  if (RAW && RAW.staff !== staffNow) RAW = null;
  if (st.page === "reglages" && RAW && !RAW.staff) st.page = "vue";
  if (RAW && X.ECO) prep();
  if (!RAW) {
    el.innerHTML = loadErr ? `<div class="card center"><p>${esc(loadErr)}</p><button class="btn small" id="seRetry">Réessayer</button></div>`
      : '<div class="card center loading-card"><span class="spinner" aria-hidden="true"></span><p>Chargement du journal…</p></div>';
    if ($("seRetry")) $("seRetry").onclick = () => { loadErr = null; render(el, ctx); };
    if (!loadErr) load().then(() => render(el, ctx)).catch(() => render(el, ctx));
    return;
  }
  CSV.length = 0;
  const P = period();
  const per = (v, l) => `<button type="button" data-per="${v}" aria-pressed="${!st.du && !st.au && st.per === v}">${l}</button>`;
  el.classList.add("se-root");
  el.innerHTML = `<div class="sec-head"><h3>Détail de l'économie</h3><p class="sub2">D'où vient l'argent, qui commerce avec qui, à quoi servent les usines. D'après toutes les transactions du serveur (toutes les 5 min), regroupées par faction.</p></div>
    <nav class="subtabs se-pages" aria-label="Pages du détail de l'économie">${PAGES.filter(([k]) => k !== "reglages" || STAFF()).map(([k, l]) => `<a href="#" data-sep="${k}" aria-current="${k === st.page ? "page" : "false"}">${l}</a>`).join("")}</nav>
    ${st.page !== "reglages" && st.page !== "usines" ? `<div class="bar se-bar"><div class="seg" role="group" aria-label="Période">${PERIODES.map(([v, l]) => per(v, l)).join("")}</div>
      <label class="chk">du <input type="date" id="seDu" value="${esc(st.du)}"></label><label class="chk">au <input type="date" id="seAu" value="${esc(st.au)}"></label>
      <span class="muted small">${esc(dayLabel(P.a, { day: "numeric", month: "long" }))} → ${esc(dayLabel(P.b, { day: "numeric", month: "long" }))} (${P.n} j)</span>
      <button type="button" class="btn small ghost" id="seReload" title="Relire le journal">↻</button></div>` : ""}
    <div id="sePage"></div>`;
  el.querySelectorAll("[data-sep]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); st.page = a.dataset.sep; render(el, ctx); }));
  el.querySelectorAll("[data-per]").forEach((b) => (b.onclick = () => { st.per = +b.dataset.per; st.du = st.au = ""; render(el, ctx); }));
  if ($("seDu")) { $("seDu").onchange = (e) => { st.du = e.target.value; render(el, ctx); }; $("seAu").onchange = (e) => { st.au = e.target.value; render(el, ctx); }; }
  if ($("seReload")) $("seReload").onclick = () => { RAW = null; render(el, ctx); };
  const page = $("sePage");
  ({ vue, flux, usines, boutiques, fisc, reglages })[st.page](page, P, el);
  bindCsv(page);
}

/* ---------- aides d'affichage ---------- */
// Valeur brute d'une cellule pour le tri (nombre si possible ; vide et « — » à la fin)
const sortVal = (c) => { const v = c && typeof c === "object" ? c.v : c; if (v === null || v === undefined || v === "" || v === "—") return null; return typeof v === "number" ? v : String(v); };
function table(name, head, rows, opts = {}) {
  const so = st.sort[name];
  if (so) {
    rows = rows.slice().sort((a, b) => { const x = sortVal(a[so.i]), y = sortVal(b[so.i]);
      if (x === null || y === null) return (x === null) - (y === null);
      const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "fr", { numeric: true, sensitivity: "base" });
      return so.dir * d; });
  }
  const i = CSV.push({ name, head: head.map((h) => (Array.isArray(h) ? h[0] : h)), rows: rows.map((r) => r.map((c) => (c && typeof c === "object" ? c.v : c))) }) - 1;
  const cell = (c) => (c && typeof c === "object" ? c.h : typeof c === "number" ? n0(c) : esc(c));
  return `<div class="se-tbl"><div class="tbl-wrap"><table class="tbl${opts.left ? " left" : ""}"><thead><tr>${head.map((h, hi) => `<th class="se-sort" data-sort-t="${esc(name)}" data-sort-i="${hi}" aria-sort="${so && so.i === hi ? (so.dir > 0 ? "ascending" : "descending") : "none"}" title="${esc((Array.isArray(h) ? h[1] + " · " : "") + "Cliquer pour trier")}">${esc(Array.isArray(h) ? h[0] : h)}${so && so.i === hi ? (so.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead><tbody>
    ${rows.length ? rows.slice(0, opts.max || 500).map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}" class="empty">${opts.empty || "Rien sur la période."}</td></tr>`}
    </tbody></table></div><button type="button" class="link small" data-csv="${i}">Exporter en CSV</button></div>`;
}
const H = (h, v) => ({ h, v });              // cellule HTML avec sa valeur brute (CSV)
const S = (v) => H(su(v), Math.round(v * 100) / 100);
const S2 = (v) => H(Number(v || 0).toLocaleString("fr-FR", { maximumFractionDigits: v < 10 ? 2 : 0 }) + "\u00a0Su", Math.round(v * 100) / 100);
const PC = (v, d) => H(pct(v, d), v === null || !isFinite(v) ? "" : Math.round(v * 10000) / 100);
function downloadCsv(t) {
  const q = (v) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const txt = "﻿" + [t.head, ...t.rows].map((r) => r.map(q).join(";")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: "text/csv;charset=utf-8" }));
  a.download = `sumenium-${t.name}-${dayOf(Date.now())}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const tile = (v, label, delta, help) => `<div class="stat"${help ? ` title="${esc(help)}"` : ""}><b>${v}</b><span>${esc(label)}</span>${delta || ""}</div>`;
function delta(cur, prev, fmtFn = su, good = 1, abs = false) {
  if (prev === null || prev === undefined || !isFinite(prev)) return "";
  const d = cur - prev, r = prev ? d / Math.abs(prev) : null;
  if (!d) return '<small class="se-d">= période précédente</small>';
  const cls = d * good > 0 ? "up" : "down";
  return `<small class="se-d ${cls}">${d > 0 ? "▲" : "▼"} ${r !== null && !abs ? pct(Math.abs(r)) : fmtFn(Math.abs(d))} vs période précédente</small>`;
}
const chart = (id) => `<div class="chart-board" id="${id}"></div>`;
function stack(id, days, pos, neg, label) {
  const el = $(id), C = window.Economie && window.Economie.charts;
  if (!el) return;
  if (!C) { el.innerHTML = '<p class="muted small">Graphique indisponible.</p>'; return; }
  if (!days.some((d) => [...pos, ...neg].some(([k]) => d[k]))) { el.innerHTML = '<p class="empty">Rien sur la période.</p>'; return; }
  C.stackChart(el, days, pos, neg, label);
}
function lineSvg(points, label, W = 640) {
  if (!points || points.length < 2) return '<p class="empty">Pas encore de relevé.</p>';
  W = Math.max(300, W); const Hh = 170, P = { l: 58, r: 8, t: 8, b: 22 };
  const t0 = points[0][0], t1 = points[points.length - 1][0], ys = points.map((p) => p[1]);
  let y0 = Math.min(...ys), y1 = Math.max(...ys); if (y0 === y1) { y0 -= 1; y1 += 1; } const pad = (y1 - y0) * 0.1; y0 = Math.max(0, y0 - pad); y1 += pad;
  const Xp = (t) => P.l + (t - t0) / (t1 - t0 || 1) * (W - P.l - P.r), Y = (v) => Hh - P.b - (v - y0) / (y1 - y0) * (Hh - P.t - P.b);
  const ticks = [0, 1, 2].map((i) => y0 + (y1 - y0) * i / 2);
  const step = Math.max(1, Math.round((t1 - t0) / DAY / 6)), days = [];
  for (let d = dayOf(t0 + DAY); midnight(d) < t1; d = addDays(d, step)) days.push(midnight(d));
  return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" role="img" aria-label="${esc(label)}">
    ${ticks.map((v) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis" x="${P.l - 6}" y="${Y(v) + 4}" text-anchor="end">${esc(Number(v).toLocaleString("fr-FR", { notation: "compact", maximumFractionDigits: 1 }))}</text>`).join("")}
    ${days.map((t) => `<text class="axis" x="${Xp(t)}" y="${Hh - 6}" text-anchor="middle">${esc(dayLabel(dayOf(t + 3600000)))}</text>`).join("")}
    <path class="line" d="${points.map((p, i) => `${i ? "L" : "M"}${Xp(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("")}"/></svg>`;
}
function gini(vals) {
  const v = vals.filter((x) => x > 0).sort((a, b) => a - b), n = v.length; if (n < 2) return null;
  const s = v.reduce((a, x) => a + x, 0); let acc = 0; v.forEach((x, i) => (acc += (2 * (i + 1) - n - 1) * x)); return acc / (n * s);
}

/* ---------- 1. Vue d'ensemble ---------- */
// Mêmes couleurs que Marché › Économie du serveur
const C_SER = [["c_RACHAT_FISC", "Rachats de minerais", "s1"], ["c_REPRISE_FISC", "Reprises d'objets rares", "s4"], ["c_AUTRE", "Staff, remboursements", "s2"]];
const D_SER = [["d_ACHAT_FISC", "Achats au FISC, têtes", "s3"], ["d_REVENTE_FISC", "Reventes d'objets rares", "s5"], ["d_TAXE", "Taxes, frais, staff", "s6"]];
const GRP = { RACHAT_FISC: "RACHAT_FISC", REPRISE_FISC: "REPRISE_FISC", ACHAT_FISC: "ACHAT_FISC", ACHAT_TETE: "ACHAT_FISC", REVENTE_FISC: "REVENTE_FISC" };
const grpC = (t) => GRP[t] || "AUTRE", grpD = (t) => GRP[t] || "TAXE";
function vue(el, P) {
  // Comparaison avec la période précédente seulement si elle tombe dans la saison (pas en vue « Saison »)
  const cmp = !(st.per === 0 && !st.du && !st.au) && P.prev.start >= Date.parse(RAW.saisonDebut) - DAY;
  const o = agg(P), p = cmp ? agg(P.prev) : { net: null, ext: null, partFisc: null }, E = X.ECO || {}, s = E.stats || {};
  const M = Number(s.masseMonetaire) || 0, U = usinesData();
  const nCom = U.list.filter((x) => x.commerciale).length;
  const seen = (E.joueurs || []).filter((j) => j.vuLe && Date.parse(j.vuLe) >= P.start).length;
  // Monnaie : vélocité sur 7 j, argent dormant (comptes pas vus depuis 7 j), concentration
  const today = dayOf(Date.now()), W7 = { start: midnight(addDays(today, -6)), end: midnight(addDays(today, 1)) };
  const ext7 = EV.filter((e) => e.kind === "commerce" && !e.internal && inP(e, W7)).reduce((a, e) => a + e.m, 0);
  const dormant = (E.joueurs || []).filter((j) => !j.vuLe || Date.parse(j.vuLe) < Date.now() - 7 * DAY).reduce((a, j) => a + (j.solde || 0), 0);
  const comptes = [...(E.joueurs || []).map((j) => j.solde || 0), ...(E.factions || []).map((f) => f.banque || 0)].sort((a, b) => b - a);
  const top5 = comptes.slice(0, 5).reduce((a, x) => a + x, 0);
  const actifs = (E.joueurs || []).filter((j) => j.vuLe && Date.parse(j.vuLe) >= Date.now() - 7 * DAY).map((j) => j.solde || 0);
  const hc = RAW.horsCircuit || { n: 0 };
  el.innerHTML = `<div class="stats se-tiles">
      ${tile(su(M), "Masse monétaire", "", "Soldes des joueurs + banques de faction (dernier export)")}
      ${tile((o.net >= 0 ? "+" : "−") + su(Math.abs(o.net)), "Création nette", delta(o.net, p.net, su, -1), "Création − destruction sur la période (IMPORT exclu)")}
      ${tile(su(o.ext), "Commerce externe", delta(o.ext, p.ext), "Achats en boutique et à l'hôtel des ventes entre factions différentes")}
      ${tile(n0(seen), "Joueurs vus", "", "Joueurs connectés au moins une fois depuis le début de la période")}
      ${tile(`${nCom}/${U.list.length}`, "Usines commerciales", `<small class="se-d">${pct(U.list.length ? nCom / U.list.length : null)} · sur 14 j</small>`, "Voir la page Usines pour la règle")}
      ${tile(pct(o.partFisc), "Part FISC des revenus", delta(o.partFisc ?? 0, p.partFisc, (v) => (v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " pts", -1, true), "Création reçue ÷ (création reçue + commerce externe reçu). Au-dessus de 50 %, le minage rapporte plus que le commerce.")}
    </div>
    <section class="card"><h3>Masse monétaire</h3><div id="seM"></div>
      <div class="stats mini se-mini">
        ${tile(pct(M ? ext7 / M : null, 1), "Vélocité 7 j", "", "Commerce externe sur 7 j ÷ masse monétaire")}
        ${tile(pct(M ? dormant / M : null), "Argent dormant", "", "Soldes des joueurs pas connectés depuis 7 j ÷ masse monétaire")}
        ${tile(pct(M ? top5 / M : null), "Top 5 des comptes", "", "Part des 5 plus gros comptes (joueurs et banques) dans la masse monétaire")}
        ${tile(gini(actifs) === null ? "—" : gini(actifs).toLocaleString("fr-FR", { maximumFractionDigits: 2 }), "Gini (actifs 7 j)", "", "0 = soldes égaux, 1 = tout chez un seul joueur")}
      </div></section>
    <section class="card"><h3>Création et destruction par jour</h3>${chart("seCD")}
      ${table("creation-destruction", ["Source", "Créé", "Détruit"], [...new Set([...Object.keys(o.creaBy), ...Object.keys(o.destBy)])]
        .map((k) => [SRC[k] || k, S(o.creaBy[k] || 0), S(o.destBy[k] || 0)]).sort((a, b) => (b[1].v + b[2].v) - (a[1].v + a[2].v)).concat([["Total", S(o.crea), S(o.dest)]]))}
      ${hc.n ? `<p class="muted small">Hors circuit, exclu de tous les calculs : ${n0(hc.n)} opération${hc.n > 1 ? "s" : ""} depuis le début de la saison (${su(hc.montant / 100)}).</p>` : ""}</section>
    <section class="card"><h3>Commerce par jour</h3>${chart("seCom")}
      <p class="muted small">Interne : acheteur et vendeur de la même faction (boutique utilisée comme coffre), exclu des indicateurs de commerce. Part interne sur la période : ${pct(o.ext + o.int ? o.int / (o.ext + o.int) : null)} (${su(o.int)}).</p></section>`;
  const mEl = $("seM"); mEl.innerHTML = lineSvg((E.masse || []).filter((x) => x[0] >= P.start - DAY && x[0] < P.end), "Masse monétaire sur la période", mEl.clientWidth);
  const days = daysOf(P, o);
  stack("seCD", days, C_SER, D_SER, "Argent créé et détruit par jour");
  stack("seCom", days, [["ext", "Commerce externe", "s0"], ["int", "Commerce interne", "s6"]], [], "Commerce par jour");
}

/* ---------- 2. Flux entre factions ---------- */
function flux(el, P) {
  const o = agg(P), ext = o.ev.filter((e) => e.kind === "commerce" && !e.internal);
  const keys = [...o.perFac.keys()].filter((k) => { const f = o.perFac.get(k); return f.achExt || f.venExt || f.achInt; });
  const fk = keys.filter((k) => k.startsWith("f:")).sort((a, b) => facName(a).localeCompare(facName(b)));
  const solo = keys.filter((k) => k.startsWith("s:"));
  const cols = [...fk, ...(solo.length ? ["solo"] : [])];
  const grp = (k) => (k && k.startsWith("s:") ? "solo" : k);
  const M = new Map(); let max = 0;
  for (const e of ext) { const k = grp(e.buyer) + "|" + grp(e.seller); const v = (M.get(k) || 0) + e.m; M.set(k, v); max = Math.max(max, v); }
  const lab = (k) => (k === "solo" ? "Joueurs solo" : facName(k));
  const heat = (v) => v ? ` style="background:color-mix(in srgb, var(--c0) ${Math.round(12 + 70 * Math.sqrt(v / max))}%, transparent)"` : "";
  const csvRows = cols.map((b) => [lab(b), ...cols.map((s) => Math.round(M.get(b + "|" + s) || 0))]);
  const ci = CSV.push({ name: "matrice-flux", head: ["Acheteur \\ Vendeur", ...cols.map(lab)], rows: csvRows }) - 1;
  // Joueurs solo anonymes (version publique) : une seule ligne
  const anon = keys.filter((k) => k.startsWith("s:#"));
  if (anon.length) {
    const g = { achExt: 0, venExt: 0, achInt: 0, crea: 0, fourn: new Set(), clients: new Set() };
    for (const k of anon) { const f = o.perFac.get(k); g.achExt += f.achExt; g.venExt += f.venExt; g.achInt += f.achInt; g.crea += f.crea; f.fourn.forEach((x) => g.fourn.add(grp(x))); f.clients.forEach((x) => g.clients.add(grp(x))); }
    o.perFac.set("s:#", g); keys.splice(0, keys.length, ...keys.filter((k) => !k.startsWith("s:#")), "s:#");
  }
  const membersOf = (k) => (k === "s:#" ? anon.length : facInfo(k).members);
  const rows = keys.map((k) => { const f = o.perFac.get(k), i = { ...facInfo(k), members: membersOf(k) }; return [H(facHtml(k), i.label), S(f.achExt), S(f.venExt), S(f.achExt / i.members), i.members, f.fourn.size, f.clients.size, PC(f.achExt + f.achInt ? f.achInt / (f.achExt + f.achInt) : null), S(f.crea), PC(f.crea + f.venExt ? f.crea / (f.crea + f.venExt) : null)]; })
    .sort((a, b) => b[1].v + b[2].v - a[1].v - a[2].v);
  el.innerHTML = `<section class="card"><h3>Qui achète à qui</h3>
      <p class="muted small">Commerce externe sur la période, en Su. Ligne = faction acheteuse, colonne = faction vendeuse. Les joueurs sans faction sont regroupés.</p>
      ${cols.length ? `<div class="tbl-wrap"><table class="tbl se-matrix"><thead><tr><th>Acheteur \\ Vendeur</th>${cols.map((c) => `<th>${esc(lab(c))}</th>`).join("")}<th>Total</th></tr></thead><tbody>
        ${cols.map((b) => `<tr><td>${b === "solo" ? "Joueurs solo" : facHtml(b)}</td>${cols.map((s) => { const v = M.get(b + "|" + s) || 0; return `<td${heat(v)} title="${esc(lab(b))} → ${esc(lab(s))}">${v ? n0(v) : ""}</td>`; }).join("")}<td><b>${n0(cols.reduce((a, s) => a + (M.get(b + "|" + s) || 0), 0))}</b></td></tr>`).join("")}
        <tr><td><b>Total</b></td>${cols.map((s) => `<td><b>${n0(cols.reduce((a, b) => a + (M.get(b + "|" + s) || 0), 0))}</b></td>`).join("")}<td><b>${n0(o.ext)}</b></td></tr>
        </tbody></table></div><button type="button" class="link small" data-csv="${ci}">Exporter en CSV</button>` : '<p class="empty">Rien sur la période.</p>'}</section>
    <section class="card"><h3>Par faction</h3>
      ${table("factions", ["Faction", "Achats ext.", "Ventes ext.", ["Par membre", "Achats externes ÷ membres de la faction"], "Membres", ["Fourn.", "Fournisseurs : factions distinctes chez qui elle achète"], ["Clients", "Factions distinctes qui lui achètent"], ["Interne", "Commerce interne ÷ (interne + externe), côté acheteur"], ["FISC reçu", "Argent créé reçu : rachats, reprises, staff"], ["Part FISC", "FISC reçu ÷ (FISC reçu + ventes externes)"]], rows)}
      <p class="muted small">Un joueur compte pour sa faction actuelle.</p></section>`;
}

/* ---------- 3. Usines ---------- */
function usines(el) {
  const U = usinesData();
  const byFac = new Map();
  for (const x of U.list) { const f = byFac.get(x.k) || { n: 0, com: 0, ca: 0 }; f.n++; if (x.commerciale) f.com++; f.ca += x.ca; byFac.set(x.k, f); }
  el.innerHTML = `<div class="banner info">Fenêtre fixe : les 14 derniers jours (${esc(dayLabel(U.W.a))} → ${esc(dayLabel(U.W.b))}). Une usine est <b>commerciale</b> si les boutiques de sa faction ont vendu ses items à d'autres factions pour au moins
      <b>${U.C.seuilPct} %</b> du CA externe moyen par usine (${su(U.moyenne)} → seuil ${su(U.seuil)}), <b>ou</b> en au moins <b>${U.C.seuilVentes} ventes</b> (les items bon marché comptent aussi). ${STAFF() ? "Réglable dans Réglages." : ""}</div>
    <section class="card"><h3>Toutes les usines attribuées</h3>
      ${table("usines", ["Usine", "Faction", "Taille", "Origine", "Commerciale", ["Bout.", "Boutiques de la faction qui vendent ses items (lots compris)"], ["Serv.", "Services de la faction liés à cette usine"], "CA 14 j", "Ventes", "Clients", ["Rupt.", "Boutiques de la faction en rupture sur ses items"]],
        U.list.sort((a, b) => b.ca - a.ca || a.u.nom.localeCompare(b.u.nom)).map((x) => [x.u.nom, H(facHtml(x.k), facName(x.k)), x.u.taille, x.origine,
          H(x.sansItems ? '<span class="chip warn">items à définir</span>' : x.commerciale ? '<span class="chip ok">oui</span>' : '<span class="chip">non</span>', x.sansItems ? "?" : x.commerciale ? "oui" : "non"),
          H(x.nShops ? n0(x.nShops) : '<span class="chip warn">aucune</span>', x.nShops), x.nSvc || "", S(x.ca), x.n, x.clients, x.rupt]), { empty: "Aucune usine attribuée." })}</section>
    <section class="card"><h3>Par faction</h3>
      ${table("usines-factions", ["Faction", "Usines", "Commerciales", "Taux", "CA ext. de ses usines"],
        [...byFac].sort((a, b) => b[1].ca - a[1].ca).map(([k, f]) => [H(facHtml(k), facName(k)), f.n, f.com, PC(f.com / f.n), S(f.ca)]))}</section>
    <section class="card"><h3>Par type d'usine (préparation d'un tour)</h3>
      <p class="muted small">Détenteurs : factions qui ont l'usine. Vendeurs : factions qui ont vendu ses items à d'autres sur 14 j. <b>CA exposé</b> : ventes à des factions qui n'ont pas l'usine — ce qu'un vendeur peut perdre si elles la prennent au prochain tour.</p>
      ${table("usines-types", ["Usine", "Taille", "Détenteurs", "Vendeurs", "CA ext. 14 j", ["CA exposé", "Ventes à des factions sans cette usine"], ["Acheteurs", "Factions distinctes qui achètent ses items"]],
        U.types.filter((t) => t.holders.size || t.ca).sort((a, b) => b.expose - a.expose || b.ca - a.ca).map((t) => [t.u.nom, t.u.taille,
          H([...t.holders].map(facHtml).join(", ") || '<span class="muted">libre</span>', [...t.holders].map(facName).join(", ")),
          H([...t.vendeurs].sort((a, b) => b[1].ca - a[1].ca).map(([k, v]) => `${facHtml(k)} <small class="muted">${n0(v.ca)}</small>`).join(", ") || "—", [...t.vendeurs].map(([k, v]) => `${facName(k)} ${Math.round(v.ca)}`).join(", ")),
          S(t.ca), S(t.expose), t.acheteurs.size]))}</section>
    <section class="card"><h3>Services</h3>
      <p class="muted small">${n0(U.services.filter((x) => x.us.length).length)} service${U.services.filter((x) => x.us.length).length > 1 ? "s" : ""} lié${U.services.filter((x) => x.us.length).length > 1 ? "s" : ""} à une usine,
        <b>${n0(U.services.filter((x) => !x.us.length).length)} non lié${U.services.filter((x) => !x.us.length).length > 1 ? "s" : ""}</b>. Un service est lié quand son nom contient un mot « service: » de la table usine → items${STAFF() ? " (Réglages)" : ""}.</p>
      ${table("services", ["Service", "Faction", "Usine liée", ["Usine détenue", "La faction du vendeur possède-t-elle cette usine ?"], "Ventes 14 j", "CA 14 j"],
        U.services.sort((a, b) => b.ca - a.ca).map((x) => [x.s.service || "Service", H(shopKey(x.s) ? facHtml(shopKey(x.s)) : "—", shopKey(x.s) ? facName(shopKey(x.s)) : ""),
          H(x.us.length ? esc(x.us.map((u) => u.nom).join(", ")) : '<span class="chip warn">aucune</span>', x.us.map((u) => u.nom).join(", ")),
          x.us.length ? (x.held.length ? "oui" : "non") : "", x.n, S(x.ca)]), { empty: "Aucun service en vente." })}</section>`;
}

/* ---------- 4. Boutiques et prix ---------- */
function boutiques(el, P) {
  const o = agg(P), shops = (X.ECO && X.ECO.boutiques) || [];
  const byShop = new Map();
  for (const e of o.ev) if (e.kind === "commerce" && e.shop) { const s = byShop.get(e.shop) || { ca: 0, ext: 0, n: 0, q: 0 }; s.ca += e.m; if (!e.internal) s.ext += e.m; s.n++; s.q += e.qty; byShop.set(e.shop, s); }
  const keys = [...new Set(shops.map(shopKey).filter(Boolean))].sort((a, b) => facName(a).localeCompare(facName(b)));
  const q = st.q.toLowerCase();
  const list = shops.filter((s) => (!st.fac || shopKey(s) === st.fac) && (!q || [s.nom, s.item, s.proprietaire, s.service].join(" ").toLowerCase().includes(q)));
  const unit = (s) => (s.prix || 0) / Math.max(1, s.quantite || 1);
  // Concurrence par item (boutiques d'items, hors lots) : vendeurs, écart de prix, part de marché du premier, HHI
  const items = new Map();
  for (const s of shops) { if (s.type !== "item" || s.lot || !s.item) continue; const [k, v] = variant(s); const it = items.get(k) || { nom: (s.nom || idOf(s.item)) + (v ? " — " + v : ""), id: idOf(s.item), shops: [] }; it.shops.push(s); items.set(k, it); }
  const conc = [...items].map(([k, it]) => {
    const ca = new Map(); let tot = 0;
    for (const s of it.shops) { const v = (byShop.get(s.id) || {}).ext || 0; if (v) { ca.set(shopKey(s), (ca.get(shopKey(s)) || 0) + v); tot += v; } }
    const prices = it.shops.filter((s) => !s.rupture || (byShop.get(s.id) || {}).n).map(unit).filter((x) => x > 0);
    const hhi = tot ? [...ca.values()].reduce((a, v) => a + (v / tot) ** 2, 0) : null;
    const lead = [...ca].sort((a, b) => b[1] - a[1])[0];
    const facs = new Set(it.shops.map(shopKey)).size;
    return { k: it.id, facs, nom: it.nom, vendeurs: ca.size, boutiques: it.shops.length, tot, ecart: prices.length > 1 ? (Math.max(...prices) - Math.min(...prices)) / Math.min(...prices) : null, min: prices.length ? Math.min(...prices) : null, hhi, lead };
  }).filter((c) => c.tot || c.boutiques > 1).sort((a, b) => b.tot - a.tot);
  el.innerHTML = `<section class="card"><h3>Concurrence par item</h3>
      <p class="muted small">Items vendus par plusieurs boutiques ou avec des ventes externes sur la période. Écart de prix = (max − min) ÷ min, prix à l'unité des boutiques en stock ; sous 1 %, les prix sont alignés. HHI = somme des parts de marché au carré : au-dessus de 0,5, quasi-monopole.</p>
      ${table("concurrence", ["Item", ["Bout.", "Boutiques qui vendent cet item"], ["Vendeurs", "Factions qui en ont vendu à d'autres sur la période"], "CA ext.", ["Prix min.", "Prix à l'unité le plus bas"], "Écart", "HHI", "1er vendeur"],
        conc.map((c) => [H(`${esc(c.nom)} <small class="muted">${esc(c.k)}</small>`, c.k), c.boutiques, c.vendeurs, S(c.tot), c.min === null ? "—" : S2(c.min), PC(c.ecart, 1),
          H(c.hhi === null ? "—" : `<span class="${c.hhi > 0.8 && c.facs > 1 ? "chip warn" : ""}">${c.hhi.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</span>`, c.hhi === null ? "" : Math.round(c.hhi * 100) / 100),
          c.lead ? H(`${facHtml(c.lead[0])} <small class="muted">${pct(c.lead[1] / c.tot)}</small>`, facName(c.lead[0])) : "—"]))}</section>
    <section class="card"><h3>Toutes les boutiques</h3>
      <div class="bar"><input type="search" id="seQ" placeholder="Item, propriétaire…" value="${esc(st.q)}" aria-label="Chercher une boutique">
        <select id="seFac" aria-label="Faction"><option value="">Toutes les factions</option>${keys.map((k) => `<option value="${esc(k)}"${k === st.fac ? " selected" : ""}>${esc(facName(k))}</option>`).join("")}</select></div>
      ${table("boutiques", ["Boutique", "Faction", "Prix / u", "Stock", "Ventes", "CA", ["dont ext.", "Ventes à d'autres factions"], ["CA total", "Depuis la création de la boutique"]],
        list.map((s) => { const b = byShop.get(s.id) || { ca: 0, ext: 0, n: 0 }, nom = s.lot ? `Lot : ${s.lot.map((x) => x.nom || idOf(x.item)).join(" + ")}` : s.service || s.nom || idOf(s.item);
          return [H(`${esc(nom)}${s.proprietaire ? ` <small class="muted">· ${esc(s.proprietaire)}</small>` : ""}`, nom + (s.proprietaire ? " · " + s.proprietaire : "")), H(shopKey(s) ? facHtml(shopKey(s)) : "—", shopKey(s) ? facName(shopKey(s)) : ""), S2(unit(s)),
            H(s.rupture ? '<span class="chip warn">rupture</span>' : n0(s.stock ?? 0), s.rupture ? "rupture" : s.stock ?? ""), b.n, S(b.ca), S(b.ext), S(s.chiffreAffaires || 0)]; }).sort((a, b) => b[5].v - a[5].v || b[7].v - a[7].v), { max: 400 })}</section>`;
  const qEl = $("seQ");
  if (qEl) { qEl.oninput = (e) => { st.q = e.target.value; const pos = e.target.selectionStart; boutiques(el, P); bindCsv(el); const n = $("seQ"); n.focus(); n.setSelectionRange(pos, pos); }; }
  if ($("seFac")) $("seFac").onchange = (e) => { st.fac = e.target.value; boutiques(el, P); bindCsv(el); };
}
// Variante d'un item : potion, enchantements (deux livres différents ne se font pas concurrence)
function variant(s) {
  const d = s.details || {}, N = (window.Economie && window.Economie.names) || {};
  const ench = (d.enchantements || []).map((e) => ({ ...e, id: idOf(e.id) })).sort((a, b) => a.id.localeCompare(b.id));
  const parts = [d.potion ? (N.potName ? N.potName(d.potion) : idOf(d.potion)) : null, ...ench.map((e) => (N.enchName ? N.enchName(e) : e.id + " " + (e.niveau || 1)))].filter(Boolean);
  return [[idOf(s.item), idOf(d.potion || ""), ...ench.map((e) => e.id + (e.niveau || 1))].join("|"), parts.join(", ")];
}
// Exports CSV et tri : clic sur un en-tête = croissant, puis décroissant, puis ordre par défaut
const bindCsv = (el) => {
  el.querySelectorAll("[data-csv]").forEach((b) => (b.onclick = () => downloadCsv(CSV[+b.dataset.csv])));
  el.querySelectorAll("[data-sort-t]").forEach((th) => (th.onclick = () => {
    const t = th.dataset.sortT, i = +th.dataset.sortI, cur = st.sort[t];
    st.sort[t] = !cur || cur.i !== i ? { i, dir: 1 } : cur.dir > 0 ? { i, dir: -1 } : null;
    const y = window.scrollY; render(lastEl, lastCtx); window.scrollTo(0, y);
  }));
};

/* ---------- 5. FISC et reprise ---------- */
function fisc(el, P) {
  const o = agg(P), ev = o.ev, E = X.ECO || {};
  const rachats = ev.filter((e) => e.type === "RACHAT_FISC");
  const byItem = new Map(), byPlayer = new Map(), byFac = new Map();
  for (const e of rachats) {
    const i = byItem.get(e.item) || { m: 0, q: 0 }; i.m += e.m; i.q += e.qty; byItem.set(e.item, i);
    if (STAFF()) { const n = NAMES[e.actor] || e.toName || "?"; byPlayer.set(n, (byPlayer.get(n) || 0) + e.m); }
    byFac.set(e.to, (byFac.get(e.to) || 0) + e.m);
  }
  const tot = rachats.reduce((a, e) => a + e.m, 0);
  const players = [...byPlayer].sort((a, b) => b[1] - a[1]);
  let cum = 0;
  const top5 = players.slice(0, 5).reduce((a, p) => a + p[1], 0);
  const topItems = [...byItem].sort((a, b) => b[1].m - a[1].m).slice(0, 5).map(([k]) => k);
  const days = daysOf(P, o).map((d) => { const x = { jour: d.jour }; for (const e of rachats) if (e.day === d.jour) { const k = topItems.includes(e.item) ? "r_" + e.item : "r_autres"; x[k] = (x[k] || 0) + e.m; } return x; });
  const ser = [...topItems.map((k, i) => ["r_" + k, nomItem(k), "s" + i]), ["r_autres", "Autres", "s6"]];
  // Reprise : état actuel (eco.json) + mouvements de la période
  const rep = new Map();
  for (const e of ev) if (e.type === "REPRISE_FISC" || e.type === "REVENTE_FISC") { const r = rep.get(e.item) || { verse: 0, qv: 0, encaisse: 0, qe: 0 }; if (e.type === "REPRISE_FISC") { r.verse += e.m; r.qv += e.qty; } else { r.encaisse += e.m; r.qe += e.qty; } rep.set(e.item, r); }
  const R = ((E.fisc && E.fisc.reprise) || []).map((x) => ({ ...x, mv: rep.get(idOf(x.item)) || { verse: 0, qv: 0, encaisse: 0, qe: 0 } }));
  el.innerHTML = `<div class="stats">
      ${tile(su(tot), "Rachats de minerais")}
      ${STAFF() ? tile(n0(players.length), "Vendeurs au FISC") + tile(pct(tot ? top5 / tot : null), "Part des 5 premiers", "", "Revenus du FISC captés par les 5 plus gros vendeurs") : ""}
      ${tile(su(R.reduce((a, x) => a + x.mv.verse, 0)), "Versé (reprise)")}${tile(su(R.reduce((a, x) => a + x.mv.encaisse, 0)), "Encaissé (revente)")}</div>
    <section class="card"><h3>Rachats par jour</h3>${chart("seFiscD")}</section>
    <section class="card"><h3>Rachats par item</h3>
      ${table("rachats-items", ["Item", "Quantité", "Su", "Part"], [...byItem].sort((a, b) => b[1].m - a[1].m).map(([k, v]) => [H(`${esc(nomItem(k))} <small class="muted">${esc(k)}</small>`, k), v.q, S(v.m), PC(tot ? v.m / tot : null)]))}</section>
    <section class="card"><h3>Rachats par faction</h3>
      ${(() => { let c = 0; const solo = [...byFac].filter(([k]) => k && k.startsWith("s:")).reduce((a, [, v]) => a + v, 0);
        const rows = [...byFac].filter(([k]) => !k || !k.startsWith("s:")).concat(solo ? [["s:#", solo]] : []).sort((a, b) => b[1] - a[1]);
        return table("rachats-factions", ["Faction", "Su", "Part", "Part cumulée"], rows.map(([k, v]) => { c += v; return [H(facHtml(k), facName(k)), S(v), PC(tot ? v / tot : null), PC(tot ? c / tot : null)]; })); })()}</section>
    ${STAFF() ? `<section class="card"><h3>Rachats par joueur <span class="chip lvl-staff">staff</span></h3>
      <p class="muted small">Un joueur très au-dessus des autres est à vérifier dans Ledger.</p>
      ${table("rachats-joueurs", ["Joueur", "Su", "Part", "Part cumulée"], players.map(([n, v]) => { cum += v; return [n, S(v), PC(tot ? v / tot : null), PC(tot ? cum / tot : null)]; }))}</section>` : ""}
    <section class="card"><h3>Reprise d'objets rares</h3>
      ${table("reprise", ["Objet", "Stock", "Rachat", "Revente", ["Demi-stock H", "Le prix de rachat est divisé par 2 tous les H en stock"], "Demandes", ["Versé (pér.)", "Payé aux joueurs sur la période"], ["Encaissé (pér.)", "Reçu des joueurs sur la période"]],
        R.sort((a, b) => b.mv.verse + b.mv.encaisse - a.mv.verse - a.mv.encaisse || (b.stock || 0) - (a.stock || 0)).map((x) => [H(`${esc(x.nom || nomItem(x.item))}${x.rupture ? ' <span class="chip warn">rupture</span>' : ""}`, x.nom || x.item), x.stock ?? 0,
          x.rachete === false ? "—" : S(x.prixRachat || 0), x.prixRevente ? S(x.prixRevente) : "—", x.demiStock ?? "", x.demandes || 0, H(`${su(x.mv.verse)}${x.mv.qv ? ` <small class="muted">${n0(x.mv.qv)}×</small>` : ""}`, x.mv.verse), H(`${su(x.mv.encaisse)}${x.mv.qe ? ` <small class="muted">${n0(x.mv.qe)}×</small>` : ""}`, x.mv.encaisse)]),
        { empty: "Pas de données de reprise dans l'export." })}</section>`;
  stack("seFiscD", days, ser, [], "Rachats du FISC par jour et par item");
}
const nomItem = (k) => { const B = (X.ECO && X.ECO.boutiques) || [], F = (X.ECO && X.ECO.fisc) || {};
  const hit = [...(F.rachat || []), ...(F.reprise || []), ...B].find((x) => x.item && idOf(x.item) === k && x.nom); return hit ? hit.nom : k.replace(/_/g, " "); };

/* ---------- Réglages ---------- */
function reglages(el, P, root) {
  const C = cfg();
  el.innerHTML = `<section class="card form"><h3>Usine commerciale</h3>
      <p class="muted small wide">Sur les 14 derniers jours, une usine est commerciale si les boutiques de sa faction ont vendu ses items à d'autres factions pour au moins ce pourcentage du CA externe moyen par usine, ou en au moins ce nombre de ventes. Le seuil suit ainsi la taille de l'économie.</p>
      <label>Pourcentage du CA moyen par usine<input type="number" id="seP" min="0" max="100" step="1" value="${C.seuilPct}"></label>
      <label>Ou nombre de ventes externes<input type="number" id="seV" min="0" max="1000" step="1" value="${C.seuilVentes}"></label></section>
    <section class="card form"><h3>Usine → items</h3>
      <p class="muted small wide">Un item par virgule, avec son id Minecraft (<code>iron_ingot</code>) ; <code>*</code> remplace n'importe quelle suite (<code>*_log</code>, <code>cooked_*</code>). Un item peut appartenir à plusieurs usines. Pour un service, écris <code>service:mot</code> : tout service dont le nom contient ce mot est relié à l'usine (<code>service:xp</code>, <code>service:repar</code> ; accents et majuscules ignorés).</p>
      <div class="wide se-usines">${X.D.usines.map((u) => `<label>${esc(u.nom)} <small class="muted">${esc(u.taille)}</small><input type="text" data-us="${esc(u.nom)}" value="${esc((C.usines[u.nom] || []).join(", "))}"></label>`).join("")}</div>
      <div class="wide actions"><button class="btn small" id="seSave">Enregistrer</button><button type="button" class="btn small ghost" id="seDef">Remettre les valeurs de la spec</button></div></section>`;
  const save = (usines) => call("PUT", "/api/staff/eco/config", { seuilPct: +$("seP").value, seuilVentes: +$("seV").value, usines })
    .then((r) => { RAW.config = r.config; reCache.clear(); toast("Réglages enregistrés"); render(root, { ECO: X.ECO }); }).catch((e) => toast(e.message, true));
  $("seSave").onclick = () => { const u = {}; el.querySelectorAll("[data-us]").forEach((i) => (u[i.dataset.us] = i.value.split(",").map((s) => s.trim()).filter(Boolean))); save(u); };
  $("seDef").onclick = () => { if (confirm("Remettre la table usine → items de la spec ?")) save({}); };
}

window.StaffEco = { render, reset: () => { RAW = null; } };
})();
