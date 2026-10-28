/* Communauté (joueurs, factions, usines, élections, fiches), Projets et Mon espace (ma fiche, historique, outils staff).
   Lecture sans connexion ; toute modification demande la connexion Discord. Uniquement sur l'adresse officielle (API servie là). */
(() => {
const HOST = "sumenium.com";  // adresse officielle (l'API et la connexion Discord y sont servies)
const LIVE = ["sumenium.com", "localhost", "127.0.0.1"].includes(location.hostname);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 4 });

const MORT = { "": "Non renseigné", oui: "Accepte de se faire tuer (frappe-moi)", sauf1: "Accepte, sauf la 1ère mort",
  sauf1_accord: "Accepte, sauf la 1ère mort et sur accord", accord: "Accepte seulement sur un accord", non: "Refuse de se faire tuer" };
const MORT_COURT = { oui: "Frappe-moi", sauf1: "Sauf 1ère mort", sauf1_accord: "Sauf 1ère + accord", accord: "Sur accord", non: "Refuse" };
const ACT = { "": "Non renseigné", tres: "Je vais beaucoup trop jouer", bcp: "Je vais beaucoup jouer", moyen: "Je vais jouer moyennement", peu: "Je vais un peu jouer" };
const ACT_COURT = { tres: "Très actif", bcp: "Actif", moyen: "Moyen", peu: "Un peu" };
const LEVEL = { staff: "Staff", sumenien: "Suménien", attente: "En attente de vérification" };
const ELECTION = { fermee: "Fermée", candidatures: "Candidatures ouvertes", tour1: "Vote : 1er tour", tour2: "Vote : 2nd tour", resultats: "Résultats publiés" };
const TAILLE_USINE = { grosse: ["Grosses usines", 3], moyenne: ["Moyennes usines", 4], petite: ["Petites usines", 5] };
const TAILLE_MOT = { grosse: "grosse", moyenne: "moyenne", petite: "petite" };
// Zones rendues par ce fichier : chacune a sa racine dans la page et ses sous-onglets
const AREAS = {
  espace: { root: "espaceRoot", subs: [["fiche", "Ma fiche"], ["historique", "Mon historique"], ["staff", "Outils staff"]] },
  communaute: { root: "comRoot", subs: [["joueurs", "Joueurs"], ["factions", "Factions"], ["usines", "Usines"], ["projets", "Projets"], ["elections", "Élections"]] },
};
// Échelle RP : 1,87 m IRL = taille normale (1), comme dans l'ancien tableau
const scaleOf = (cm) => (cm ? Math.round((cm / 187) * 10000) / 10000 : null);

let ECO = null;  // site/eco.json (mod Sumenium Economy) : soldes et banques, pour relier l'Espace à l'onglet Économie
let ME = null, D = null, checking = true, area = "espace", sub = "fiche", arg = "", busy = false, lastLoad = 0, staffFaction = null, auditRows = [], auditEnd = false, WORLD = null;

/* ---------- API ---------- */
async function call(method, path, body) {
  const r = await fetch(path, {
    method, credentials: "same-origin",
    headers: { "content-type": "application/json", "x-requested-with": "sumenium" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && ME) { ME = null; reload().catch(() => {}); }
  if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
  return j;
}
function toast(msg, bad) {
  const t = $("toast");
  t.textContent = msg; t.className = bad ? "toast bad" : "toast"; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), bad ? 7000 : 2500);
}
async function act(fn, ok) {
  if (busy) return;
  busy = true;
  document.body.classList.add("busy");
  try { await fn(); if (ok) toast(ok); await reload(); }
  catch (e) { toast(e.message, true); }
  finally { busy = false; document.body.classList.remove("busy"); }
}
async function reload() {
  const eco = fetch("eco.json?t=" + Date.now()).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  D = await call("GET", "/api/data");
  ECO = await eco;
  ME = D.user || null;
  lastLoad = Date.now();
  render();
  if (window.refreshHome) window.refreshHome();
}

/* ---------- helpers ---------- */
const norm = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
// Faction du mod reliée à une faction de l'Espace : même nom ou même tag (accents, espaces et majuscules ignorés),
// sinon début du nom (« Ordo » ↔ « Ordo Lupuli »), sinon celle qui a le plus de membres en commun (2 au moins)
const _ecoFac = new Map();
function ecoFac(f) {
  if (!f || !ECO || !ECO.factions) return null;
  if (_ecoFac.has(f.id) && _ecoFac.get(f.id)[0] === ECO) return _ecoFac.get(f.id)[1];
  const n = norm(f.name), keys = (x) => [x.tag, x.id].map(norm).filter(Boolean);
  let hit = ECO.factions.find((x) => keys(x).includes(n))
    || ECO.factions.find((x) => keys(x).some((k) => k.length >= 3 && (n.startsWith(k) || k.startsWith(n))));
  if (!hit) {
    const mine = new Set(members(f.id).map((p) => norm(p.mc_name)));
    let best = 0;
    for (const x of ECO.factions) { const c = x.membres.filter((m) => mine.has(norm(m.nom))).length; if (c >= 2 && c > best) { best = c; hit = x; } }
  }
  _ecoFac.set(f.id, [ECO, hit || null]);
  return hit || null;
}
// Faction de l'Espace correspondant à une faction du mod (id du mod)
const ecoToFac = (ecoId) => (D && ecoId ? D.factions.find((f) => { const e = ecoFac(f); return e && e.id === ecoId; }) || null : null);
const ecoPlayer = (name) => ECO && ECO.joueurs ? ECO.joueurs.find((j) => norm(j.nom) === norm(name)) || null : null;
const suE = (v) => Number(v || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + "\u00a0" + ((ECO && ECO.monnaie) || "Su");
const facStyle = (f) => { const e = ecoFac(f); const c = e && typeof col === "function" ? col(e.couleur) : null; return c ? ` style="--fc:${esc(c)}"` : ""; };
const facLabel = (fid) => { const f = fac(fid); return f ? flink(f) : '<span class="chip muted">Solo</span>'; };
const ROLE_MOD = { chef: "Chef", tresorier: "Trésorier" };
const isStaff = () => ME && ME.level === "staff";
const canWrite = () => ME && ME.level !== "attente";
const me = () => D && D.players.find((p) => p.id === D.meId);
const fac = (id) => D.factions.find((f) => f.id === id);
const facName = (id) => (fac(id) || {}).name || "";
const members = (fid) => D.players.filter((p) => p.faction_id === fid);
const usine = (id) => D.usines.find((u) => u.id === id);
const projet = (id) => (D.projets || []).find((x) => x.id === id);
const canEditFac = (fid) => isStaff() || (canWrite() && me() && me().faction_id === fid);
// Chef de faction : rôle « chef » dans le mod (eco.json). Lui seul (et le staff) modifie la fiche de sa faction.
const isChefOf = (fid) => { const p = me(), f = fid && fac(fid), e = f && ecoFac(f);
  return !!(p && p.faction_id === fid && e && (e.membres || []).some((m) => norm(m.nom) === norm(p.mc_name) && m.role === "chef")); };
const canManageFac = (fid) => isStaff() || (canWrite() && isChefOf(fid));
const MC_COL = { black: ["Noir", "#000000"], dark_blue: ["Bleu foncé", "#0000AA"], dark_green: ["Vert foncé", "#00AA00"], dark_aqua: ["Cyan foncé", "#00AAAA"],
  dark_red: ["Rouge foncé", "#AA0000"], dark_purple: ["Violet", "#AA00AA"], gold: ["Or", "#FFAA00"], gray: ["Gris", "#AAAAAA"], dark_gray: ["Gris foncé", "#555555"],
  blue: ["Bleu", "#5555FF"], green: ["Vert", "#55FF55"], aqua: ["Cyan", "#55FFFF"], red: ["Rouge", "#FF5555"], light_purple: ["Rose", "#FF55FF"], yellow: ["Jaune", "#FFFF55"], white: ["Blanc", "#FFFFFF"] };
// Commandes en jeu pour créer une faction du site sur le serveur (mod + équipe vanilla pour la couleur dans la tablist)
function facCmds(name, couleur, names) {
  const id = norm(name).slice(0, 16) || "faction", tag = name.replace(/\s+/g, "").slice(0, 16), c = MC_COL[couleur] ? couleur : "white";
  const out = [`/faction admin creer ${id} ${tag} ${c}`];
  names.forEach((n) => { const cur = ECO && (ECO.factions || []).find((f) => (f.membres || []).some((m) => norm(m.nom) === norm(n)));
    if (cur) out.push(`/faction admin retirer ${n}`); out.push(`/faction admin ajouter ${n} ${id}`); });
  out.push(`/team add ${id}`, `/team modify ${id} color ${c}`, `/team modify ${id} prefix "[${name}] "`, ...names.map((n) => `/team join ${id} ${n}`));
  return out;
}
const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}"${k === (cur ?? "") ? " selected" : ""}>${esc(v)}</option>`).join("");
const facOpts = (cur, none = "Sans faction (solo)") => `<option value="">${none}</option>` + D.factions.map((f) =>
  `<option value="${f.id}"${f.id === cur ? " selected" : ""}>${esc(f.name)} (${members(f.id).length}/8)</option>`).join("");
const formData = (form) => Object.fromEntries(new FormData(form).entries());
const para = (t) => (t ? `<p class="txt">${esc(t)}</p>` : "");
const head = (title, sub2) => `<div class="sec-head"><h3>${title}</h3>${sub2 ? `<p class="sub2">${sub2}</p>` : ""}</div>`;
// Tête du skin : générée par la mise à jour du site, mc-heads.net en secours (headFail, dans index.html)
const face = (n, size = 32) => `<img class="face" src="heads/${encodeURIComponent(String(n).toLowerCase())}.png" data-n="${esc(n)}" data-s="${size}" onerror="headFail(this)" alt="" width="${size}" height="${size}" loading="lazy">`;
const plink = (n) => `<a class="plink" href="#communaute/joueur/${encodeURIComponent(n)}">${esc(n)}</a>`;
const flink = (f) => `<a class="faclink" href="#communaute/faction/${f.id}"><span class="ftag"${facStyle(f)}>${esc(f.name)}</span></a>`;
const plural = (n, one, many) => `${fmt(n)} ${n > 1 ? many : one}`;
const reglesProjet = (pr) => pr.unique_srv ? '<span class="chip lvl-staff">Unique sur le serveur</span>'
  : pr.illimite ? '<span class="chip ok">Sans limite</span>' : '<span class="chip">1 fois par faction</span>';
const taillesTxt = (t) => t.split(",").map((x) => TAILLE_MOT[x] || x).join(" ou ");
// Fiche suffisante pour être whitelisté : métier + « mourir ou survivre » (faction facultative : on peut jouer seul)
const ficheOk = (p) => !!(p.metier && p.mort);

/* ---------- connexion ---------- */
// Après la connexion Discord, on revient sur la page où le joueur a cliqué « Se connecter »
const NEXT_KEY = "sumenium-next";
function rememberPage() { try { sessionStorage.setItem(NEXT_KEY, location.hash || "#accueil"); } catch (e) {} }
document.addEventListener("click", (e) => { if (e.target.closest("a[data-login]")) rememberPage(); });
const loginBtn = (label = "Se connecter avec Discord", cls = "btn discord") => `<a class="${cls}" href="/api/auth/login" data-login>${label}</a>`;
const loginHint = (what) => !ME && LIVE ? `<p class="login-hint">${what} <a href="/api/auth/login" data-login>Connecte-toi avec Discord</a>.</p>` : "";
const DISCORD_SVG = '<svg width="18" height="14" viewBox="0 0 71 55" aria-hidden="true"><path fill="currentColor" d="M60.1 4.9A58.5 58.5 0 0 0 45.6.4a40 40 0 0 0-1.9 3.8 54 54 0 0 0-16.2 0A40 40 0 0 0 25.6.4 58.4 58.4 0 0 0 11 4.9C1.6 18.7-.9 32.2.3 45.5a58.9 58.9 0 0 0 18 9.1 43 43 0 0 0 3.8-6.3 38 38 0 0 1-6-2.9l1.5-1.1a42 42 0 0 0 36 0l1.5 1.1a38 38 0 0 1-6 2.9 43 43 0 0 0 3.8 6.3 58.7 58.7 0 0 0 18-9.1c1.5-15.4-2.5-28.8-10.8-40.6ZM23.7 37.3c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2 6.5 3.3 6.4 7.2c0 4-2.8 7.2-6.4 7.2Zm23.6 0c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2 6.5 3.3 6.4 7.2c0 4-2.8 7.2-6.4 7.2Z"/></svg>';
function renderAcct() {
  const el = $("acct");
  if (!el) return;
  if (!LIVE || checking) { el.innerHTML = ""; return; }
  const here = location.hash.startsWith("#espace") ? "page" : "false";
  if (ME) {
    const p = me(), n = p ? p.mc_name : ME.name;
    const pic = p ? face(p.mc_name, 24) : ME.avatar ? `<img src="${esc(ME.avatar)}" alt="" width="24" height="24" style="border-radius:50%">` : "";
    el.innerHTML = bellHtml() + `<a class="tabs-me" href="#espace/fiche" aria-current="${here}" aria-label="Mon espace (${esc(n)})" title="Mon espace : ma fiche, mon historique${isStaff() ? ", outils staff" : ""}">${pic}<span>${esc(n)}</span></a>`;
    bindBell();
  } else el.innerHTML = `<a class="tabs-login" href="/api/auth/login" data-login aria-label="Se connecter avec Discord" title="Se connecter avec Discord">${DISCORD_SVG}<span>Se connecter</span></a>`;
}

/* ---------- notifications (cloche à côté de Mon espace) ----------
   Calculées à partir des données déjà chargées : elles disparaissent d'elles-mêmes quand la situation est réglée.
   « Vu » est retenu dans ce navigateur seulement (pastille du nombre de nouveautés). */
const SEEN_KEY = "sumenium-notifs-vues";
const BELL_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1Z"/></svg>';
let bellOpen = false;
const seenGet = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch (e) { return new Set(); } };
const seenSet = (keys) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...keys].slice(-300))); } catch (e) {} };
const stockPct = (b) => (b.capacite > 0 && b.stock != null ? Math.round((b.stock / b.capacite) * 100) : null);
// Stock faible : moins de 10 % du coffre (si le mod donne la capacité), sinon de quoi faire moins de 3 ventes
const lowStock = (b) => !b.rupture && b.stock != null && b.type !== "service" && (b.capacite > 0 ? b.stock / b.capacite < 0.1 : b.stock < 3 * (b.quantite || 1));
function notifs() {
  if (!D || !ME) return [];
  const out = [], add = (key, icon, text, href, level = "") => out.push({ key, icon, text, href, level });
  const p = me(), st = D.settings || {};
  if (!p) add("lier", "🔗", "Relie ton pseudo Minecraft pour remplir ta fiche.", "#espace/fiche", "warn");
  else {
    const miss = [!p.metier && "métier RP", !p.mort && "mourir ou survivre"].filter(Boolean);
    if (miss.length && canWrite()) add("fiche:" + miss.join(","), "📝", `Complète ta fiche : ${miss.join(", ")}.`, "#espace/fiche", "warn");
    if (canWrite() && !p.taille_fixe && !p.taille_cm) add("taille", "📏", "Indique ta taille IRL, ou coche « garder la taille normale ».", "#espace/fiche");
  }
  // Élection
  const tourV = st.election === "tour1" ? 1 : st.election === "tour2" ? 2 : 0;
  if (tourV && p && !D.myVotes[tourV]) add("vote:" + tourV, "🗳️", `Le vote est ouvert (${tourV === 1 ? "1er" : "2nd"} tour) : tu n'as pas encore voté.`, "#communaute/elections", "warn");
  if (st.election === "candidatures") add("cand", "🏛️", "Les candidatures pour la mairie sont ouvertes.", "#communaute/elections");
  if (st.election === "resultats") add("res", "🏆", "Les résultats de l'élection sont publiés.", "#communaute/elections");
  // Tirage des usines
  const tourU = +st.usine_tour || 1;
  if (st.usines_ouvertes === "1" && (D.usineTours || {})[tourU]) {
    const T = turnState(tourU), fid = p && p.faction_id;
    if (fid && T.cur && T.cur.id === fid) add("usine-tour:" + tourU, "🏭", "C'est au tour de ta faction de choisir ses usines !", "#communaute/usines", "warn");
    else if (T.cur) add("usine-ouvert:" + tourU, "🏭", `Choix des usines en cours : au tour de ${T.cur.name}.`, "#communaute/usines");
  }
  // Boutiques (les miennes et celles de ma faction)
  if (p && ECO && ECO.boutiques) {
    const ef = p.faction_id && fac(p.faction_id) ? ecoFac(fac(p.faction_id)) : null;
    ECO.boutiques.filter((b) => (b.proprietaireType === "joueur" && norm(b.proprietaire) === norm(p.mc_name)) || (ef && b.proprietaireType === "faction" && b.faction === ef.id))
      .forEach((b) => {
        const what = `${b.type === "lot" ? "lot" : itemFr(b.item, b.nom)}${b.proprietaireType === "faction" ? " (boutique de faction)" : ""}`;
        if (b.rupture) add("rupture:" + b.id, "📦", `Rupture de stock : ${what}.`, `#communaute/joueur/${encodeURIComponent(p.mc_name)}`, "warn");
        else if (lowStock(b)) add("faible:" + b.id, "📉", `Stock faible : ${what} (${stockPct(b) != null ? stockPct(b) + " % du coffre" : fmt(b.stock) + " restants"}).`, `#communaute/joueur/${encodeURIComponent(p.mc_name)}`);
      });
  }
  // Hôtel des ventes : mes annonces qui se terminent dans moins de 24 h
  if (p && ECO && ECO.hdv) ECO.hdv.filter((a) => norm(a.vendeur) === norm(p.mc_name) && a.fin > Date.now() && a.fin - Date.now() < 86400000)
    .forEach((a) => add("hdv:" + a.id, "⏳", `Ton annonce « ${itemFr(a.item, a.nom)} » se termine dans ${Math.max(1, Math.round((a.fin - Date.now()) / 3600000))} h.`, "#marche/hdv"));
  // Réponses du staff aux demandes
  (D.factionDemandes || []).filter((d) => p && d.player_id === p.id && (d.statut === "acceptee" || d.statut === "refusee"))
    .forEach((d) => add(`fdem:${d.id}:${d.statut}`, d.statut === "acceptee" ? "✅" : "❌", `Ta demande de faction « ${d.name} » a été ${d.statut === "acceptee" ? "acceptée" : "refusée"}${d.reponse ? " : " + d.reponse : ""}.`, "#communaute/factions"));
  (D.projetDemandes || []).filter((d) => p && d.faction_id === p.faction_id && d.statut === "a_completer")
    .forEach((d) => add(`pdem:${d.id}:a_completer:${d.updated}`, "✏️", `Le staff demande de compléter « ${(projet(d.projet_id) || {}).nom || "?"} » : ${d.reponse}`, "#communaute/projets", "warn"));
  (D.projetDemandes || []).filter((d) => p && d.faction_id === p.faction_id && (d.statut === "acceptee" || d.statut === "refusee"))
    .forEach((d) => add(`pdem:${d.id}:${d.statut}`, d.statut === "acceptee" ? "✅" : "❌", `Projet « ${(projet(d.projet_id) || {}).nom || "?"} » ${d.statut === "acceptee" ? "validé" : "refusé"}${d.reponse ? " : " + d.reponse : ""}.`, "#communaute/projets"));
  // Staff : ce qui attend une action
  if (isStaff()) {
    const fd = (D.factionDemandes || []).filter((d) => d.statut === "attente").length, pd = (D.projetDemandes || []).filter((d) => d.statut === "attente").length;
    if (fd) add("st-fd:" + fd, "🛡️", `${plural(fd, "demande", "demandes")} de nouvelle faction à traiter.`, "#espace/staff", "staff");
    if (pd) add("st-pd:" + pd, "🛡️", `${plural(pd, "projet", "projets")} à valider.`, "#espace/staff", "staff");
    const wl = D.wlSynced ? D.players.filter((x) => !x.whitelisted && ficheOk(x)).length : 0;
    if (wl) add("st-wl:" + wl, "🛡️", `${plural(wl, "joueur", "joueurs")} à whitelister.`, "#espace/staff", "staff");
    const tl = D.players.filter((x) => x.taille_cm && !x.taille_fixe && (x.taille_appliquee == null || Math.abs(x.taille_appliquee - scaleOf(x.taille_cm)) >= 0.0005)).length;
    if (tl) add("st-tl:" + tl, "🛡️", `${plural(tl, "taille RP", "tailles RP")} à appliquer en jeu.`, "#espace/staff", "staff");
  }
  return out;
}
function bellHtml() {
  const list = notifs(), seen = seenGet(), n = list.filter((x) => !seen.has(x.key)).length;
  return `<div class="bell-wrap"><button type="button" class="bell" id="bellBtn" aria-expanded="${bellOpen}" aria-controls="bellPanel"
      aria-label="Notifications${n ? ` (${n} nouvelle${n > 1 ? "s" : ""})` : ""}" title="Notifications">${BELL_SVG}${n ? `<span class="bell-n">${n > 9 ? "9+" : n}</span>` : ""}</button>
    <div class="bell-panel" id="bellPanel"${bellOpen ? "" : " hidden"} role="dialog" aria-label="Notifications"><b class="bell-h">Notifications</b>
      ${list.length ? list.map((x) => `<a class="ntf${x.level ? " " + x.level : ""}${seen.has(x.key) ? "" : " new"}" href="${x.href}"><span class="ntf-i" aria-hidden="true">${x.icon}</span><span>${esc(x.text)}</span></a>`).join("")
        : '<p class="muted small">Rien de neuf pour l\'instant.</p>'}</div></div>`;
}
function bindBell() {
  const b = $("bellBtn"), pnl = $("bellPanel");
  if (!b) return;
  // Panneau placé sous la cloche, toujours dans l'écran (téléphone compris)
  const place = () => { const r = b.getBoundingClientRect(), w = Math.min(360, innerWidth - 32);
    pnl.style.top = Math.round(r.bottom + 8) + "px"; pnl.style.left = Math.round(Math.max(16, Math.min(r.right - w, innerWidth - 16 - w))) + "px"; pnl.style.width = w + "px"; };
  if (bellOpen) place();
  b.onclick = (e) => { e.stopPropagation(); bellOpen = !bellOpen; if (bellOpen) place(); pnl.hidden = !bellOpen; b.setAttribute("aria-expanded", bellOpen);
    if (bellOpen) { const seen = seenGet(); notifs().forEach((x) => seen.add(x.key)); seenSet(seen); const c = b.querySelector(".bell-n"); if (c) c.remove(); } };
  pnl.onclick = (e) => { if (e.target.closest("a")) { bellOpen = false; pnl.hidden = true; } e.stopPropagation(); };
}
document.addEventListener("click", () => { if (bellOpen) { bellOpen = false; const pnl = $("bellPanel"); if (pnl) pnl.hidden = true; const b = $("bellBtn"); if (b) b.setAttribute("aria-expanded", "false"); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && bellOpen) { bellOpen = false; renderAcct(); } });
// Relecture discrète toutes les 2 min (onglet visible) : la cloche suit sans recharger la page affichée
setInterval(async () => {
  if (!LIVE || !ME || busy || document.hidden || !D) return;
  try {
    const [d, eco] = await Promise.all([call("GET", "/api/data"), fetch("eco.json?t=" + Date.now()).then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
    if (busy) return;
    const L = d; L.choix = D.choix && area === "communaute" && sub === "usines" ? D.choix : L.choix;
    D = L; if (eco) ECO = eco; lastLoad = Date.now(); renderAcct();
  } catch (e) {}
}, 120000);

/* ---------- squelette ---------- */
function render() {
  renderAcct();
  const A = AREAS[area], root = $(A.root);
  if (!root) return;
  Object.values(AREAS).forEach((x) => { if (x.root !== A.root && $(x.root)) $(x.root).innerHTML = ""; });  // un seul #espView à la fois
  if (!LIVE) {
    root.innerHTML = `<div class="card center"><h3>Cette partie est sur ${HOST}</h3>
      <p>Fiches, factions, usines et élections sont servies par l'adresse officielle du site.</p>
      <a class="btn" href="https://${HOST}/${esc(location.hash)}">Ouvrir sur ${HOST}</a></div>`;
    return;
  }
  if (checking || !D) { root.innerHTML = '<div class="card center loading-card"><span class="spinner" aria-hidden="true"></span><p>Chargement…</p></div>'; return; }
  if (area === "espace") {
    if (!ME) {
      const err = new URLSearchParams(location.hash.split("?")[1] || "").get("erreur");
      root.innerHTML = `${err ? `<div class="banner">${esc(err)}</div>` : ""}<div class="card center">
        <h3>Mon espace</h3>
        <p>Connecte-toi avec Discord pour remplir ta fiche, voir ton historique, voter ou gérer ta faction. Tu restes connecté 30 jours sur cet appareil.</p>
        ${loginBtn()}
        <p class="muted small">Tu passes par la page officielle <b>discord.com</b> : vérifie l'adresse, et ne donne jamais ton mot de passe ailleurs. Le site reçoit seulement ton pseudo Discord et tes rôles sur le serveur Suménium, rien n'est publié sur Discord. <a href="confidentialite.html">Ce qu'on enregistre</a></p></div>`;
      return;
    }
    if (sub === "staff" && !isStaff()) sub = "fiche";
    const badge = { staff: isStaff() ? D.players.filter((p) => D.wlSynced && !p.whitelisted && ficheOk(p)).length : 0 };
    root.innerHTML = `<div class="who-bar">
        <div class="who-me">${ME.avatar ? `<img src="${esc(ME.avatar)}" alt="" width="36" height="36">` : ""}
          <div><b>${esc(ME.name)}</b><span class="chip lvl-${esc(ME.level)}">${esc(LEVEL[ME.level])}</span></div></div>
        <a class="link" href="/api/auth/logout">Se déconnecter</a></div>
      ${ME.level === "attente" ? '<div class="banner info">Ton compte est en attente de vérification : tu peux tout consulter, et tu pourras remplir ta fiche une fois le vocal passé avec le staff.</div>' : ""}
      <nav class="subtabs" aria-label="Mon espace">${A.subs.filter(([k]) => k !== "staff" || isStaff()).map(([k, l]) =>
        `<a href="#espace/${k}" aria-current="${k === sub ? "page" : "false"}">${l}${badge[k] ? ` <span class="badge">${badge[k]}</span>` : ""}</a>`).join("")}</nav>
      <div id="espView"></div>`;
  } else if (area === "communaute") {
    const cur = sub === "joueur" ? "joueurs" : sub === "faction" ? "factions" : sub;
    root.innerHTML = `<nav class="subtabs" aria-label="Communauté">${A.subs.map(([k, l]) =>
        `<a href="#communaute/${k}" aria-current="${k === cur ? "page" : "false"}">${l}</a>`).join("")}</nav>
      <div id="espView"></div>`;
  } else root.innerHTML = '<div id="espView"></div>';
  ({ fiche, historique, staff, joueurs, factions, usines, elections, projets, joueur: joueurPage, faction: factionPage })[sub]();
}
const view = (h) => ($("espView").innerHTML = h);

/* ---------- Ma fiche ---------- */
function fiche() {
  const p = me();
  if (!p) {
    if (!canWrite()) return view(head("Ma fiche", "") + '<div class="card"><p>Ta fiche sera disponible quand ton compte sera vérifié par le staff.</p></div>');
    view(head("Ma fiche", "Première étape : dis-nous quel est ton compte Minecraft.") + `<div class="card narrow"><h3>Relie ton pseudo Minecraft</h3>
      <p>Écris ton pseudo Minecraft <b>Java</b> exact. Pas besoin d'être déjà whitelisté : remplis ta fiche, et le staff t'ajoute à la whitelist une fois ta candidature validée.</p>
      <form id="claimForm" class="inline"><input name="mc_name" required maxlength="16" pattern="[A-Za-z0-9_]{3,16}" placeholder="Pseudo Minecraft" autocomplete="off" aria-label="Pseudo Minecraft">
      <button class="btn">Relier</button></form>
      <p class="muted small">Un pseudo ne peut être relié qu'à un seul compte Discord. En cas d'erreur, demande au staff.</p></div>`);
    $("claimForm").onsubmit = (e) => { e.preventDefault(); act(() => call("POST", "/api/me/claim", formData(e.target)), "Pseudo relié !"); };
    return;
  }
  const sc = scaleOf(p.taille_cm);
  const applied = p.taille_appliquee != null ? p.taille_appliquee : null;
  const f = p.faction_id ? fac(p.faction_id) : null;
  view(head("Ma fiche", "Ce que les autres joueurs voient de toi, et ce dont le staff a besoin.") + `<div class="fiche-grid">
    <aside class="card profile">
      <div class="profile-id">${face(p.mc_name, 64)}<div><b>${esc(p.mc_name)}</b>${facLabel(p.faction_id)}</div></div>
      <ul class="status">
        <li>${p.whitelisted ? '<span class="chip ok">✓ Whitelisté</span>' : '<span class="chip warn">Pas encore whitelisté</span>'}</li>
        <li>${ficheOk(p) ? '<span class="chip ok">✓ Fiche complète</span>' : `<span class="chip warn">À compléter : ${[!p.metier && "métier", !p.mort && "mourir ou survivre"].filter(Boolean).join(", ")}</span>`}</li>
        <li>${p.taille_fixe ? '<span class="chip muted">Garde la taille normale</span>' : sc ? (applied != null && Math.abs(applied - sc) < 0.0005 ? '<span class="chip ok">✓ Taille RP appliquée</span>' : '<span class="chip warn">Taille RP à appliquer par le staff</span>') : '<span class="chip muted">Taille RP non renseignée</span>'}</li>
      </ul>
      ${!p.whitelisted ? `<p class="small muted">${ficheOk(p) ? "Ta fiche est complète : le staff t'ajoute à la whitelist une fois ta candidature validée." : "Complète ta fiche : le staff t'ajoute à la whitelist une fois ta candidature validée."}</p>` : ""}
      ${(() => { const e = ecoPlayer(p.mc_name), ef = ecoFac(f); return e || ef ? `<dl class="account">
        ${e ? `<dt>Mon solde</dt><dd>${suE(e.solde)}</dd>` : ""}${ef ? `<dt>Banque de ${esc(f.name)}</dt><dd>${suE(ef.banque)}</dd>` : ""}</dl>` : ""; })()}
      <div class="profile-links">
        <a class="btn small ghost" href="#espace/historique">Mon historique</a>
        <a class="btn small ghost" href="#monde/succes" data-my-succes>Mes succès</a>
        <a class="btn small ghost" href="#communaute/joueur/${encodeURIComponent(p.mc_name)}">Ma fiche publique</a>
        ${f ? `<a class="btn small ghost" href="#communaute/faction/${f.id}">Ma faction</a>` : ""}
      </div>
    </aside>
    <form id="ficheForm" class="card form fiche-form">
      <fieldset><legend>Jeu</legend>
        <label>Faction<select name="faction_id">${facOpts(p.faction_id)}</select></label>
        <label>Temps de jeu prévu<select name="activite">${opt(ACT, p.activite)}</select></label>
        <label class="wide">Mourir ou survivre ?<select name="mort">${opt(MORT, p.mort)}</select></label>
      </fieldset>
      <fieldset><legend>Rôleplay</legend>
        <label class="wide">Métier RP<input name="metier" maxlength="200" value="${esc(p.metier)}" placeholder="Ex. : forgeron, garde du corps, journaliste…"></label>
        <label class="wide">Description du métier<textarea name="metier_desc" rows="3" maxlength="2000" placeholder="Ce que tu proposes aux autres joueurs">${esc(p.metier_desc)}</textarea></label>
        <label class="wide">Description du personnage<textarea name="perso_desc" rows="3" maxlength="2000" placeholder="Qui est ton personnage ?">${esc(p.perso_desc)}</textarea></label>
      </fieldset>
      <fieldset><legend>Taille RP</legend>
        <label class="chk wide"><input type="hidden" name="taille_fixe" value="0"><input type="checkbox" name="taille_fixe" value="1" id="tailleFixe"${p.taille_fixe ? " checked" : ""}> Je ne veux pas changer de taille en jeu (je garde la taille normale)</label>
        <label>Taille IRL (cm)<input name="taille_cm" type="number" min="50" max="250" step="1" value="${p.taille_cm ?? ""}" id="tailleIn" placeholder="175"${p.taille_fixe ? " disabled" : ""}></label>
        <div class="taille-info" id="tailleInfo">${p.taille_fixe ? '<span class="muted">Tu gardes la taille normale du jeu.</span>' : tailleTxt(sc, applied)}</div>
        <p class="muted small wide">Visible seulement par toi et le staff. Le staff applique la taille en jeu.</p>
      </fieldset>
      <div class="wide actions save-bar"><button class="btn" id="ficheSave" disabled>Enregistré ✓</button><span class="muted small" id="ficheDirty"></span></div>
    </form></div>`);
  const form = $("ficheForm"), save = $("ficheSave");
  const initial = JSON.stringify(formData(form));
  form.addEventListener("input", () => {
    const dirty = JSON.stringify(formData(form)) !== initial;
    save.disabled = !dirty; save.textContent = dirty ? "Enregistrer" : "Enregistré ✓";
    $("ficheDirty").textContent = dirty ? "Modifications non enregistrées" : "";
  });
  $("tailleIn").oninput = (e) => ($("tailleInfo").innerHTML = tailleTxt(scaleOf(+e.target.value), applied));
  $("tailleFixe").onchange = (e) => { $("tailleIn").disabled = e.target.checked;
    $("tailleInfo").innerHTML = e.target.checked ? '<span class="muted">Tu gardes la taille normale du jeu.</span>' : tailleTxt(scaleOf(+$("tailleIn").value), applied); };
  form.onsubmit = (e) => { e.preventDefault(); act(() => call("PUT", "/api/me/player", formData(form)), "Fiche enregistrée"); };
  document.querySelector("[data-my-succes]").onclick = () => { try { localStorage.setItem("sumenium-who", p.mc_name); } catch (e) {} if (window.setWho) window.setWho(p.mc_name); };
}
function tailleTxt(sc, applied) {
  if (!sc) return '<span class="muted">Indique ta taille pour calculer ta taille en jeu.</span>';
  const st = applied == null ? '<span class="chip warn">pas encore appliquée</span>'
    : Math.abs(applied - sc) < 0.0005 ? '<span class="chip ok">appliquée en jeu</span>' : `<span class="chip warn">en jeu : ${fmt(applied)}, à mettre à jour</span>`;
  return `Échelle <b>${fmt(sc)}</b> (≈ ${fmt(Math.round(sc * 180) / 100)} blocs) ${st}`;
}

/* ---------- Historique (journal du mod Sumenium Economy, montants en CENTIMES) ---------- */
const TX = { ACHAT: "Achat en boutique", ACHAT_SERVICE: "Achat de service", RACHAT_FISC: "Vente au FISC", ACHAT_FISC: "Achat au FISC",
  FRAIS_BOUTIQUE: "Frais de boutique", REMBOURSEMENT_BOUTIQUE: "Remboursement de boutique", SUPPRESSION_BOUTIQUE: "Suppression de boutique",
  DEPOT_FACTION: "Dépôt à la faction", RETRAIT_FACTION: "Retrait de la faction", ADMIN: "Opération du staff", IMPORT: "Reprise de Savs",
  BON_UTILISE: "Bon de service utilisé", HDV_OFFRE: "Offre à l'HDV", HDV_REMBOURSEMENT: "Offre HDV rendue", HDV_VENTE: "Vente à l'HDV",
  ACHAT_TETE: "Achat d'une tête", REPRISE_FISC: "Objet rare vendu au FISC", REVENTE_FISC: "Objet rare acheté au FISC", DEMANDE_REPRISE: "Objet rare demandé au FISC" };
const su = (cents) => (cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }) + "\u00a0Su";
const itemLabel = (t) => { const id = String(t.item || "").replace(/^minecraft:/, ""); return (typeof NAMES !== "undefined" && NAMES[id]) || t.itemName || id.replace(/_/g, " "); };
function txRow(t, uuid) {
  const me = `joueur:${uuid}`, from = (t.from || "").toLowerCase(), to = (t.to || "").toLowerCase();
  const amount = t.amount || 0, tax = t.tax || 0;
  let sign = 0, value = amount, who = "";
  if (from === me && to !== me) { sign = -1; who = t.toName || (t.to === "fisc" ? "FISC" : ""); }
  else if (to === me && from !== me) { sign = 1; value = amount - (t.type === "RACHAT_FISC" ? 0 : tax); who = t.fromName || (t.from === "fisc" ? "FISC" : ""); }
  else if (from.startsWith("faction:") || to.startsWith("faction:")) who = from.startsWith("faction:") ? `banque ${from.slice(8)}` : `banque ${to.slice(8)}`;
  const units = t.unitFirst != null && t.qty > 1 ? ` (de ${su(t.unitFirst)} à ${su(t.unitLast)} l'unité)` : "";
  const what = t.item ? `${t.qty ? t.qty + " × " : ""}${itemLabel(t)}${units}` : (t.note || "");
  const taxShown = t.type === "REVENTE_FISC" ? 0 : tax;  // la revente du FISC n'est pas une taxe
  return `<tr><td class="nowrap">${new Date(t.t).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
    <td>${esc(TX[t.type] || t.type)}</td><td>${esc(what)}${who ? `<span class="muted small"> · ${sign < 0 ? "à" : sign > 0 ? "de" : ""} ${esc(who)}</span>` : ""}</td>
    <td class="num ${sign < 0 ? "amt-neg" : sign > 0 ? "amt-pos" : ""}">${sign < 0 ? "−" : sign > 0 ? "+" : ""}${su(value)}${!sign && (from || to) && !from.startsWith("joueur:") ? '<span class="muted small"> (faction)</span>' : ""}</td>
    <td class="num muted">${taxShown ? su(taxShown) : ""}</td></tr>`;
}
let hType = "", hRows = [], hMore = false, hUuid = null;
async function loadHistory(path, el, append) {
  try {
    const before = append && hRows.length ? hRows[hRows.length - 1].t : "";
    const r = await call("GET", `${path}${path.includes("?") ? "&" : "?"}type=${encodeURIComponent(hType)}${before ? "&before=" + before : ""}`);
    if (!r.uuid) {
      el.innerHTML = `<p class="empty">${r.reason === "fiche" ? "Relie d'abord ton pseudo Minecraft (onglet Ma fiche)." : "Ce pseudo n'est pas encore dans la whitelist : l'historique arrivera une fois whitelisté."}</p>`;
      return;
    }
    hUuid = r.uuid; hRows = append ? hRows.concat(r.rows) : r.rows; hMore = r.more;
  } catch (e) { el.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
  const sum = hRows.reduce((a, t) => { const me = `joueur:${hUuid}`, f = (t.from || "").toLowerCase(), to = (t.to || "").toLowerCase();
    if (f === me && to !== me) a.out += t.amount || 0; else if (to === me && f !== me) a.in += (t.amount || 0) - (t.type === "RACHAT_FISC" ? 0 : t.tax || 0); return a; }, { in: 0, out: 0 });
  el.innerHTML = hRows.length ? `<p class="small muted">${hRows.length} opération${hRows.length > 1 ? "s" : ""} affichée${hRows.length > 1 ? "s" : ""} ·
      reçu <b class="amt-pos">+${su(sum.in)}</b> · dépensé <b class="amt-neg">−${su(sum.out)}</b></p>
    <div class="tbl-wrap"><table class="tbl left hist"><thead><tr><th>Date</th><th>Opération</th><th>Détail</th><th class="num">Montant</th><th class="num">Taxe</th></tr></thead>
    <tbody>${hRows.map((t) => txRow(t, hUuid)).join("")}</tbody></table></div>
    ${hMore ? '<div class="actions"><button class="btn small ghost" id="hMore">Plus ancien</button></div>' : ""}`
    : '<p class="empty">Aucune opération pour l\'instant.</p>';
  const more = el.querySelector("#hMore");
  if (more) more.onclick = () => loadHistory(path, el, true);
}
const typeSelect = (id) => `<select id="${id}" aria-label="Type d'opération"><option value="">Toutes les opérations</option>${Object.entries(TX).map(([k, v]) => `<option value="${k}"${k === hType ? " selected" : ""}>${v}</option>`).join("")}</select>`;
function historique() {
  view(head("Mon historique", "Tes achats, ventes, frais et dépôts, d'après le journal du serveur (mis à jour toutes les 5 minutes). Visible seulement par toi et le staff.") +
    `<div class="bar">${typeSelect("hType")}</div><div id="hList"><p class="empty">Chargement…</p></div>`);
  $("hType").onchange = (e) => { hType = e.target.value; loadHistory("/api/me/historique", $("hList"), false); };
  loadHistory("/api/me/historique", $("hList"), false);
}

/* ---------- Joueurs ---------- */
let jq = "", jf = "";
function joueurs() {
  const q = jq.toLowerCase();
  const list = D.players.filter((p) => (!q || [p.mc_name, p.metier, p.metier_desc, p.perso_desc].join(" ").toLowerCase().includes(q))
    && (!jf || String(p.faction_id || "none") === jf));
  view(head("Joueurs", "Les fiches RP de tous les joueurs : métier, faction et choix « mourir ou survivre ».") + `<div class="bar">
      <input type="search" id="jq" placeholder="Chercher un joueur, un métier…" value="${esc(jq)}" aria-label="Chercher un joueur">
      <select id="jf" aria-label="Faction"><option value="">Toutes les factions</option><option value="none"${jf === "none" ? " selected" : ""}>Solo</option>
      ${D.factions.map((f) => `<option value="${f.id}"${String(f.id) === jf ? " selected" : ""}>${esc(f.name)}</option>`).join("")}</select>
      ${isStaff() ? '<form class="inline" id="addPlayer"><input name="mc_name" required maxlength="16" pattern="[A-Za-z0-9_]{3,16}" placeholder="Pseudo Minecraft" aria-label="Pseudo de la fiche à ajouter"><button class="btn small">Ajouter une fiche</button></form>' : ""}</div>
    <p class="count">${plural(list.length, "joueur", "joueurs")}</p>
    <div class="cards">${list.map(playerCard).join("") || '<p class="empty">Aucun joueur ne correspond.</p>'}</div>`);
  $("jq").oninput = (e) => { jq = e.target.value; const pos = e.target.selectionStart; joueurs(); $("jq").focus(); $("jq").setSelectionRange(pos, pos); };
  $("jf").onchange = (e) => { jf = e.target.value; joueurs(); };
  if (isStaff()) {
    $("addPlayer").onsubmit = (e) => { e.preventDefault(); act(() => call("POST", "/api/admin/players", { mc_name: e.target.mc_name.value.trim() }), "Fiche ajoutée"); };
  }
  bindPlayerEditors();
}
function playerCard(p) {
  const mine = p.id === D.meId;
  return `<article class="pcard${mine ? " mine" : ""}">
    <header>${face(p.mc_name)}<div><b>${plink(p.mc_name)}</b>${facLabel(p.faction_id)}</div></header>
    ${p.metier ? `<p class="metier">${esc(p.metier)}</p>` : '<p class="metier muted">Métier non renseigné</p>'}
    <div class="tags">${p.mort ? `<span class="chip m-${esc(p.mort)}" title="${esc(MORT[p.mort])}">${esc(MORT_COURT[p.mort])}</span>` : ""}
      ${p.activite ? `<span class="chip">${esc(ACT_COURT[p.activite])}</span>` : ""}
      ${isStaff() && !p.linked ? '<span class="chip muted">Discord non relié</span>' : ""}
      ${isStaff() && D.wlSynced && !p.whitelisted ? '<span class="chip warn">pas whitelisté</span>' : ""}
      ${isStaff() && p.discord_name ? `<span class="chip muted">@${esc(p.discord_name)}</span>` : ""}</div>
    ${p.metier_desc || p.perso_desc ? `<details><summary>Descriptions</summary>${p.metier_desc ? `<h4>Métier</h4>${para(p.metier_desc)}` : ""}${p.perso_desc ? `<h4>Personnage</h4>${para(p.perso_desc)}` : ""}</details>` : ""}
    ${isStaff() ? `<details class="edit" data-pid="${p.id}"><summary>Modifier (staff)</summary></details>` : ""}
  </article>`;
}
function bindPlayerEditors() {
  document.querySelectorAll("details.edit[data-pid]").forEach((d) => d.addEventListener("toggle", () => {
    if (!d.open || d.querySelector("form")) return;
    const p = D.players.find((x) => x.id === +d.dataset.pid);
    d.insertAdjacentHTML("beforeend", `<form class="form compact">
      <label>Pseudo<input name="mc_name" value="${esc(p.mc_name)}" maxlength="16"></label>
      <label>Faction<select name="faction_id">${facOpts(p.faction_id)}</select></label>
      <label>Métier<input name="metier" value="${esc(p.metier)}"></label>
      <label>Activité<select name="activite">${opt(ACT, p.activite)}</select></label>
      <label>Mourir ou survivre<select name="mort">${opt(MORT, p.mort)}</select></label>
      <label>Taille IRL (cm)<input name="taille_cm" type="number" min="50" max="250" value="${p.taille_cm ?? ""}"></label>
      <label>Taille appliquée en jeu<input name="taille_appliquee" type="number" step="0.0001" min="0.05" max="3" value="${p.taille_appliquee ?? ""}" placeholder="vide = pas encore"></label>
      <label class="chk"><input type="hidden" name="taille_fixe" value="0"><input type="checkbox" name="taille_fixe" value="1"${p.taille_fixe ? " checked" : ""}> Ne veut pas changer de taille</label>
      <label class="wide">Description du métier<textarea name="metier_desc" rows="2">${esc(p.metier_desc)}</textarea></label>
      <label class="wide">Description du personnage<textarea name="perso_desc" rows="2">${esc(p.perso_desc)}</textarea></label>
      <div class="wide actions"><button class="btn small">Enregistrer</button>
        ${p.linked ? '<button type="button" class="btn small ghost" data-act="unlink">Délier Discord</button>' : ""}
        <button type="button" class="btn small danger" data-act="del">Supprimer la fiche</button></div></form>`);
    const f = d.querySelector("form");
    f.onsubmit = (e) => { e.preventDefault(); const v = formData(f); v.taille_appliquee = v.taille_appliquee === "" ? null : +v.taille_appliquee;
      act(() => call("PUT", `/api/admin/players/${p.id}`, v), "Fiche mise à jour"); };
    f.querySelector('[data-act="del"]').onclick = () => confirm(`Supprimer la fiche de ${p.mc_name} ? (annulable depuis l'historique)`)
      && act(() => call("DELETE", `/api/admin/players/${p.id}`), "Fiche supprimée");
    const u = f.querySelector('[data-act="unlink"]');
    if (u) u.onclick = () => confirm(`Délier le compte Discord de ${p.mc_name} ?`) && act(() => call("PUT", `/api/admin/players/${p.id}`, { unlink: true }), "Compte délié");
  }));
}

/* ---------- Factions ---------- */
function factions() {
  const myF = me() && me().faction_id;
  const list = [...D.factions].sort((a, b) => (b.id === myF) - (a.id === myF) || a.name.localeCompare(b.name));
  view(head("Factions", "De 3 à 8 joueurs par faction. Les coordonnées ne sont visibles que par les membres de la faction et le staff.") +
    `${isStaff() ? '<form class="bar inline" id="addFac"><input name="name" required maxlength="40" placeholder="Nom de la faction" aria-label="Nom de la nouvelle faction"><button class="btn small">Créer une faction</button></form>' : ""}
    ${loginHint("Pour modifier ta faction ou ajouter ses coordonnées,")}
    <div class="fac-grid">${list.map(facCard).join("") || '<p class="empty">Aucune faction.</p>'}</div>
    ${newFacCard()}`);
  bindNewFac();
  bindMap();
  if (isStaff()) $("addFac").onsubmit = (e) => { e.preventDefault(); act(() => call("POST", "/api/factions", { name: e.target.name.value.trim() }), "Faction créée"); };
  bindFac();
}
/* ---------- Nouvelle faction : demande d'un joueur, validée par le staff ---------- */
const colTag = (c, name) => `<span class="ftag" style="--fc:${(MC_COL[c] || MC_COL.white)[1]}">${esc(name)}</span>`;
function facDemItem(d) {
  const mine = me() && me().id === d.player_id;
  return `<li class="dem"><div>${colTag(d.couleur, d.name)} <span class="muted small">proposée par ${plink(d.auteur)} · ${new Date(d.ts * 1000).toLocaleDateString("fr-FR")}</span></div>
    <div class="small">${d.membres.map(plink).join(", ")} <span class="muted">(${d.membres.length} joueurs)</span></div>
    ${d.theme ? `<p class="small">${esc(d.theme)}</p>` : ""}
    <div class="actions">${isStaff() ? `<button class="btn small" data-fd-ok="${d.id}">Accepter</button><button class="btn small ghost danger" data-fd-no="${d.id}">Refuser</button>` : ""}
      ${mine ? `<button class="btn small ghost" data-fd-cancel="${d.id}">Annuler ma demande</button>` : ""}</div></li>`;
}
function newFacCard() {
  const open = D.settings.factions_ouvertes === "1", p = me();
  const pend = (D.factionDemandes || []).filter((d) => d.statut === "attente");
  const myPend = p && pend.find((d) => d.player_id === p.id);
  const mineDone = p && (D.factionDemandes || []).filter((d) => d.player_id === p.id && (d.statut === "refusee" || d.statut === "acceptee"));
  return `<section class="card" id="newFac"><h3>Créer une nouvelle faction</h3>
    ${!open && !isStaff() ? '<p class="muted">La création de nouvelles factions est fermée pour le moment : les factions actuelles ne sont pas encore toutes complètes. Tu peux rejoindre une faction existante (contact « Recrutement » sur sa fiche).</p>'
      : !ME ? loginHint("Pour proposer une faction,") : !p ? '<p class="muted">Relie d\'abord ton pseudo Minecraft dans Mon espace.</p>'
      : myPend ? '<p>Ta demande est en attente de validation par le staff.</p>'
      : `<p class="small muted">De 3 à 8 joueurs (toi compris), chacun avec une fiche sur le site. Le staff valide la demande et crée la faction en jeu.</p>
        <form id="newFacForm" class="form compact">
          <label>Nom<input name="name" required minlength="2" maxlength="40" placeholder="Nom de la faction"></label>
          <label>Couleur en jeu<select name="couleur">${Object.entries(MC_COL).map(([k, [l]]) => `<option value="${k}"${k === "white" ? " selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="wide">Thème, projet<textarea name="theme" rows="2" maxlength="2000" placeholder="Ce que la faction veut construire"></textarea></label>
          <fieldset class="wide pick"><legend>Membres <span class="muted small" id="nfCount">1 / 8</span></legend>
            <input type="search" id="nfQ" placeholder="Chercher un joueur" aria-label="Chercher un joueur">
            <div class="pick-list">${[...D.players].sort((a, b) => (!!a.faction_id - !!b.faction_id) || a.mc_name.localeCompare(b.mc_name)).map((x) =>
              `<label class="chk" data-n="${esc(norm(x.mc_name))}"><input type="checkbox" name="m" value="${esc(x.mc_name)}"${x.id === p.id ? " checked disabled" : ""}> ${esc(x.mc_name)}${x.faction_id ? ` <small class="muted">${esc(facName(x.faction_id))}</small>` : ""}</label>`).join("")}</div>
          </fieldset>
          <div class="wide actions"><button class="btn small">Envoyer la demande</button></div></form>`}
    ${mineDone && mineDone.length ? mineDone.map((d) => `<p class="small">${d.statut === "acceptee" ? "✅" : "❌"} Ta demande « ${esc(d.name)} » a été ${d.statut === "acceptee" ? "acceptée" : "refusée"}${d.reponse ? ` : ${esc(d.reponse)}` : ""}.</p>`).join("") : ""}
    ${pend.length ? `<h4>Demandes en attente</h4><ul class="dem-list">${pend.map(facDemItem).join("")}</ul>` : ""}</section>`;
}
function bindNewFac() {
  const f = $("newFacForm");
  if (f) {
    const count = () => ($("nfCount").textContent = `${f.querySelectorAll('input[name="m"]:checked').length} / 8`);
    f.addEventListener("change", count);
    $("nfQ").oninput = (e) => { const q = norm(e.target.value); f.querySelectorAll(".pick-list label").forEach((l) => (l.hidden = q && !l.dataset.n.includes(q))); };
    f.onsubmit = (e) => { e.preventDefault();
      const membres = [...f.querySelectorAll('input[name="m"]:checked')].map((x) => x.value);
      act(() => call("POST", "/api/factions/demandes", { name: f.name.value.trim(), couleur: f.couleur.value, theme: f.theme.value, membres }), "Demande envoyée au staff"); };
  }
  bindFacDem();
}
function bindFacDem() {
  document.querySelectorAll("[data-fd-ok]").forEach((b) => (b.onclick = () => { const d = D.factionDemandes.find((x) => x.id === +b.dataset.fdOk);
    confirm(`Créer la faction « ${d.name} » avec ${d.membres.join(", ")} ? Ils seront placés dans cette faction sur le site. Pense ensuite aux commandes en jeu (Outils staff).`)
      && act(() => call("PUT", `/api/factions/demandes/${d.id}`, { action: "accepter" }), "Faction créée"); }));
  document.querySelectorAll("[data-fd-no]").forEach((b) => (b.onclick = () => { const why = prompt("Raison du refus (visible par le joueur, facultatif) :");
    if (why !== null) act(() => call("PUT", `/api/factions/demandes/${b.dataset.fdNo}`, { action: "refuser", reponse: why }), "Demande refusée"); }));
  document.querySelectorAll("[data-fd-cancel]").forEach((b) => (b.onclick = () => confirm("Annuler ta demande ?")
    && act(() => call("PUT", `/api/factions/demandes/${b.dataset.fdCancel}`, { action: "annuler" }), "Demande annulée")));
}
function bindFac() {
  document.querySelectorAll("[data-fac-edit]").forEach((b) => (b.onclick = () => facEdit(+b.dataset.facEdit)));
  document.querySelectorAll("[data-fac-del]").forEach((b) => (b.onclick = () => {
    const f = fac(+b.dataset.facDel);
    if (confirm(`Supprimer la faction ${f.name} ? Les joueurs gardent leur fiche.`)) act(() => call("DELETE", `/api/factions/${f.id}`), "Faction supprimée");
  }));
  document.querySelectorAll("form[data-base-add]").forEach((f) => (f.onsubmit = (e) => {
    e.preventDefault(); act(() => call("POST", "/api/bases", { faction_id: +f.dataset.baseAdd, ...formData(f) }), "Coordonnées ajoutées");
  }));
  document.querySelectorAll("[data-base-del]").forEach((b) => (b.onclick = () => confirm("Supprimer ces coordonnées ?")
    && act(() => call("DELETE", `/api/bases/${b.dataset.baseDel}`), "Coordonnées supprimées")));
}
function usineChip(c) {
  const u = usine(c.usine_id);
  return u ? `<span class="chip u-${u.taille}"${c.projet_faction_id ? ' title="Débloquée par un projet communautaire"' : (c.tour || 1) > 1 ? ` title="Choisie au ${c.tour}e tour"` : ""}>${c.projet_faction_id ? "★ " : ""}${esc(u.nom)}${!c.projet_faction_id && (c.tour || 1) > 1 ? ` <small>T${c.tour}</small>` : ""}</span>` : "";
}
function facCard(f) {
  const ms = members(f.id);
  const ok = ms.length >= 3 && ms.length <= 8;
  const ch = D.choix.filter((c) => c.faction_id === f.id);
  const pr = (D.realises || []).filter((r) => r.faction_id === f.id);
  const bases = D.bases.filter((b) => b.faction_id === f.id);
  const mine = me() && me().faction_id === f.id;
  const showBases = isStaff() || mine;
  const ef = ecoFac(f);
  const row = (l, v) => (v ? `<dt>${l}</dt><dd>${esc(v)}</dd>` : "");
  return `<article class="card fac${mine ? " mine" : ""}" id="fac-${f.id}">
    <header><h3><a class="faclink" href="#communaute/faction/${f.id}"><span class="ftag big"${facStyle(f)}>${esc(f.name)}</span></a>${mine ? ' <span class="chip ok">Ma faction</span>' : ""}</h3><span class="chip ${ok ? "ok" : "warn"}">${ms.length}/8 · ${ok ? "valide" : ms.length < 3 ? "3 minimum" : "trop de joueurs"}</span></header>
    <p class="members">${ms.map((p) => { const r = ef && (ef.membres.find((m) => norm(m.nom) === norm(p.mc_name)) || {}).role;
      return `<span>${plink(p.mc_name)}${ROLE_MOD[r] ? ` <small class="muted">${ROLE_MOD[r]}</small>` : ""}</span>`; }).join("") || '<span class="muted">Aucun membre</span>'}</p>
    ${ef ? `<p class="fac-bank"><b>${suE(ef.banque)}</b> <span class="muted small">en banque</span></p>` : ""}
    <dl>${row("Thème", f.theme)}${row("Hub et usines prévues", f.hub)}${row("Autres projets", f.autres_projets)}
      ${f.recrutement ? (() => { const c = ms.find((p) => norm(p.mc_name) === norm(f.recrutement));
        return `<dt>Recrutement</dt><dd>${c ? `Contacter ${plink(c.mc_name)}` : esc(f.recrutement)}</dd>`; })() : ""}
      ${f.tirage ? `<dt>Tirage des usines</dt><dd>${f.tirage}ᵉ</dd>` : ""}
      ${ch.length ? `<dt>Usines</dt><dd>${ch.map(usineChip).join(" ")}</dd>` : ""}
      <dt>Projets communautaires validés</dt><dd>${pr.length ? pr.map((r) => `<a class="chip" href="#communaute/projets">${esc((projet(r.projet_id) || {}).nom || "?")}</a>`).join(" ") : '<span class="muted">Aucun pour l\'instant</span>'}</dd></dl>
    ${showBases ? `<details class="bases"><summary>Coordonnées (${bases.length})</summary>
      <table class="mini"><tbody>${bases.map((b) => `<tr><td>${esc({ hub: "Hub", usine: "Usine", base: "Base" }[b.type])}</td><td>${esc(b.nom)}</td>
        <td class="num">${b.x != null && b.z != null ? mapBtn(b) : `${b.x ?? "?"} / ${b.y ?? "?"} / ${b.z ?? "?"}`}</td>
        <td>${canEditFac(f.id) ? `<button class="x" data-base-del="${b.id}" aria-label="Supprimer">✕</button>` : ""}</td></tr>`).join("") || '<tr><td class="muted">Aucune coordonnée.</td></tr>'}</tbody></table>
      ${canEditFac(f.id) ? `<form class="inline coords" data-base-add="${f.id}"><select name="type" aria-label="Type"><option value="base">Base</option><option value="hub">Hub</option><option value="usine">Usine</option></select>
        <input name="nom" placeholder="Nom" maxlength="80" aria-label="Nom"><input name="x" type="number" placeholder="X" required aria-label="X"><input name="y" type="number" placeholder="Y" aria-label="Y"><input name="z" type="number" placeholder="Z" required aria-label="Z">
        <button class="btn small">Ajouter</button></form>` : ""}</details>` : ""}
    ${canManageFac(f.id) ? `<div class="actions"><button class="btn small ghost" data-fac-edit="${f.id}">Modifier</button>${isStaff() ? `<button class="btn small danger" data-fac-del="${f.id}">Supprimer</button>` : ""}</div>`
      : mine ? '<p class="muted small">Seul le chef de la faction (rôle en jeu) peut modifier cette fiche.</p>' : ""}
  </article>`;
}
function facEdit(fid) {
  const f = fac(fid);
  const card = $("fac-" + fid);
  card.innerHTML = `<form class="form compact"><h3>${esc(f.name)}</h3>
    <label>Nom<input name="name" value="${esc(f.name)}" maxlength="40" required></label>
    <label class="wide">Thème<textarea name="theme" rows="2">${esc(f.theme)}</textarea></label>
    <label class="wide">Hub et usines prévues<textarea name="hub" rows="2">${esc(f.hub)}</textarea></label>
    <label class="wide">Autres projets<textarea name="autres_projets" rows="2">${esc(f.autres_projets)}</textarea></label>
    ${(() => { const ms = members(fid), cur = f.recrutement || "", inList = ms.some((p) => p.mc_name === cur);
      return `<label>Contact recrutement<select name="recrutement"><option value="">— personne —</option>
        ${cur && !inList ? `<option value="${esc(cur)}" selected>Texte actuel : ${esc(cur.slice(0, 40))}</option>` : ""}
        ${ms.map((p) => `<option${p.mc_name === cur ? " selected" : ""}>${esc(p.mc_name)}</option>`).join("")}</select></label>`; })()}
    <p class="muted small wide">L'ordre au tirage des usines est donné par le tirage au sort (le staff peut le corriger dans Communauté › Usines).</p>
    <div class="wide actions"><button class="btn small">Enregistrer</button><button type="button" class="btn small ghost" id="facCancel">Annuler</button></div></form>`;
  card.querySelector("form").onsubmit = (e) => { e.preventDefault(); act(() => call("PUT", `/api/factions/${fid}`, formData(e.target)), "Faction enregistrée"); };
  $("facCancel").onclick = () => render();
}

/* ---------- Projets communautaires ---------- */
function projets() {
  const P = D.projets || [], R = D.realises || [];
  const myF = me() && me().faction_id;
  const byP = (id) => R.filter((r) => r.projet_id === id);
  const can = (pr) => !myF ? null : pr.unique_srv ? (byP(pr.id).length ? false : true) : pr.illimite ? true : !byP(pr.id).some((r) => r.faction_id === myF);
  view(head("Projets communautaires", "Un projet réalisé pour le serveur débloque une usine en plus pour ta faction.") + `
    <div class="card steps">
      <ol>
        <li><b>Réalise le projet</b> avec ta faction.</li>
        <li><b>Demande la validation</b> avec le bouton « Demander la validation » ci-dessous (ou ouvre un ticket sur Discord avec DraftBot, comme avant) : dis ce qui a été fait, où, et l'usine souhaitée.</li>
        <li><b>Le staff valide</b> : le projet et l'usine apparaissent ici et sur la fiche de ta faction.</li>
      </ol>
      <p class="small muted">Règles : un projet <b>unique</b> ne peut être fait que par une seule faction sur tout le serveur. Les autres : une fois par faction. L'organisation d'un évènement n'a pas de limite.</p>
    </div>
    ${projDemCard()}
    ${isStaff() ? projetStaffForm() : ""}
    <div class="tbl-wrap tips"><table class="tbl left projets"><thead><tr><th>Projet</th><th>Usine débloquée</th><th>Règle</th><th>Réalisé par</th>${myF ? "<th>Pour ma faction</th>" : ""}</tr></thead><tbody>
    ${P.map((pr) => {
      const done = byP(pr.id), c = can(pr);
      return `<tr><td>${projetNom(pr)}</td><td>${esc(taillesTxt(pr.tailles))}</td><td>${reglesProjet(pr)}</td>
        <td>${done.map((r) => `<a href="#communaute/faction/${r.faction_id}" class="chip${r.faction_id === myF ? " ok" : ""}" title="${esc(r.note || "")}">${esc(facName(r.faction_id))}${r.usine_id ? ` → ${esc((usine(r.usine_id) || {}).nom || "")}` : ""}</a>`).join(" ") || '<span class="muted">—</span>'}
          ${isStaff() ? done.map((r) => `<button class="x" data-pf-del="${r.id}" title="Retirer ce projet de ${esc(facName(r.faction_id))}" aria-label="Retirer">✕</button>`).join("") : ""}</td>
        ${myF ? `<td>${c === true ? (() => { const pd = (D.projetDemandes || []).find((d) => d.projet_id === pr.id && d.faction_id === myF && PD_OPEN.includes(d.statut));
          return pd ? (pd.statut === "a_completer" ? `<span class="chip warn">À compléter</span> <button class="btn small" data-pd-edit="${pd.id}">Compléter</button>` : '<span class="chip warn">Demande envoyée</span>')
            : `<span class="chip ok">Disponible</span>${canWrite() ? ` <button class="btn small ghost" data-pd-ask="${pr.id}">Demander la validation</button>` : ""}`; })()
          : pr.unique_srv ? '<span class="chip muted">Déjà pris</span>' : '<span class="chip muted">Déjà fait</span>'}</td>` : ""}</tr>`;
    }).join("") || '<tr><td colspan="5" class="empty">Aucun projet.</td></tr>'}</tbody></table></div>
    ${isStaff() ? projetListEditor() : ""}`);
  bindProjets();
}
function projetNom(pr) {
  if (!pr.description) return `<b>${esc(pr.nom)}</b>`;
  return `<span class="ptip" tabindex="0"><b>${esc(pr.nom)}</b><span class="ptip-i" aria-hidden="true">?</span>
    <span class="ptip-box" role="tooltip"><b>${esc(pr.nom)}</b>${esc(pr.description)}
      <span class="ptip-meta">Débloque une usine ${esc(taillesTxt(pr.tailles))} · ${pr.unique_srv ? "unique sur le serveur" : pr.illimite ? "sans limite" : "1 fois par faction"}</span></span></span>`;
}
// Demandes de validation : en cours (staff : toutes ; joueur : celles de sa faction) et réponses récentes
const PD_OPEN = ["attente", "a_completer"];
const pdImg = (d, id) => `/api/projets/demandes/${d.id}/images/${id}`;
let pdForm = null;  // { projet: id, demande: id|null } : formulaire de demande ouvert
function projDemCard() {
  const L = D.projetDemandes || [], pend = L.filter((d) => PD_OPEN.includes(d.statut)), done = L.filter((d) => d.statut === "acceptee" || d.statut === "refusee");
  const form = pdForm ? projDemForm() : "";
  if (!pend.length && !done.length && !form) return "";
  return `${form}<section class="card" id="projDem"><h3>${isStaff() ? "Demandes de validation" : "Demandes de ta faction"}</h3>
    ${pend.length ? `<ul class="dem-list">${pend.map(projDemItem).join("")}</ul>` : '<p class="muted small">Aucune demande en cours.</p>'}
    ${done.length ? `<details><summary>${isStaff() ? "Demandes traitées" : "Réponses récentes"} (${done.length})</summary><ul class="dem-list">${done.map(projDemDone).join("")}</ul></details>` : ""}</section>`;
}
// Formulaire de la faction : description + jusqu'à 3 images (captures d'écran du projet)
function projDemForm() {
  const pr = projet(pdForm.projet) || { nom: "?" }, d = pdForm.demande ? (D.projetDemandes || []).find((x) => x.id === pdForm.demande) : null;
  const imgs = d ? d.images || [] : [];
  return `<form class="card form" id="pdFormEl"><h3>${d ? "Compléter la demande" : "Demander la validation"} : ${esc(pr.nom)}</h3>
    ${d && d.reponse ? `<p class="banner info">Message du staff : ${esc(d.reponse)}</p>` : ""}
    <label class="wide">Ce qui a été fait<textarea name="note" rows="4" maxlength="1000" required placeholder="Description, coordonnées (x / y / z), usine souhaitée…">${esc(d ? d.note : "")}</textarea></label>
    <div class="wide"><b class="small">Images (3 au plus)</b>
      <div class="pd-imgs" id="pdImgs">${imgs.map((id) => `<span class="pd-img"><img src="${pdImg(d, id)}" alt="Image jointe"><button type="button" class="x" data-pd-imgdel="${id}" aria-label="Retirer l'image">✕</button></span>`).join("")}</div>
      ${imgs.length < 3 ? `<input type="file" id="pdFiles" accept="image/*" multiple aria-label="Ajouter des images"><p class="muted small">Captures d'écran du projet en jeu. Les images sont réduites automatiquement et visibles seulement par ta faction et le staff.</p>` : ""}
      <div class="pd-imgs" id="pdPrev"></div></div>
    <div class="wide actions"><button class="btn small">${d ? "Renvoyer au staff" : "Envoyer la demande"}</button><button type="button" class="btn small ghost" id="pdClose">Fermer</button></div></form>`;
}
const dateFr = (t) => (t ? new Date(t * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
// Demande traitée : une ligne résumée, et tout le détail en l'ouvrant (texte, photos, qui a demandé, qui a traité)
function projDemDone(d) {
  const ok = d.statut === "acceptee";
  return `<li><details class="dem done"><summary><span>${ok ? "✅" : "❌"} <b>${esc((projet(d.projet_id) || {}).nom || "?")}</b> · ${esc(facName(d.faction_id))}</span>
      <span class="muted small">${ok ? "validé" : "refusé"}${d.traite_par ? ` par ${esc(d.traite_par)}` : ""} · ${dateFr(d.updated)}</span></summary>
    <p class="small muted">Demandé par ${plink(d.auteur)} le ${dateFr(d.ts)}${(d.images || []).length ? ` · ${d.images.length} image${d.images.length > 1 ? "s" : ""}` : ""}</p>
    <p class="small">${esc(d.note)}</p>
    ${d.reponse ? `<p class="small"><b>Réponse du staff :</b> ${esc(d.reponse)}</p>` : ""}
    ${(d.images || []).length ? `<div class="pd-imgs">${d.images.map((id) => `<a class="pd-img" href="${pdImg(d, id)}" target="_blank" rel="noopener" title="Voir en grand"><img src="${pdImg(d, id)}" alt="Image jointe" loading="lazy"></a>`).join("")}</div>` : ""}
  </details></li>`;
}
function projDemItem(d) {
  const pr = projet(d.projet_id) || { nom: "?", tailles: "" }, ok = pr.tailles.split(",");
  const mineF = me() && me().faction_id === d.faction_id;
  return `<li class="dem" data-pd="${d.id}"><div><b>${esc(pr.nom)}</b> · <a href="#communaute/faction/${d.faction_id}">${esc(facName(d.faction_id))}</a>
      ${d.statut === "a_completer" ? '<span class="chip warn">À compléter</span>' : '<span class="chip">En attente du staff</span>'}
      <span class="muted small">demandé par ${plink(d.auteur)} · ${new Date(d.ts * 1000).toLocaleDateString("fr-FR")}</span></div>
    <p class="small">${esc(d.note)}</p>
    ${d.reponse && d.statut === "a_completer" ? `<p class="small"><b>Le staff demande${d.traite_par ? ` (${esc(d.traite_par)}, ${dateFr(d.updated)})` : ""} :</b> ${esc(d.reponse)}</p>` : d.reponse ? `<p class="small muted">Message précédent du staff : ${esc(d.reponse)}</p>` : ""}
    ${(d.images || []).length ? `<div class="pd-imgs">${d.images.map((id) => `<a class="pd-img" href="${pdImg(d, id)}" target="_blank" rel="noopener" title="Voir en grand"><img src="${pdImg(d, id)}" alt="Image jointe" loading="lazy"></a>`).join("")}</div>` : ""}
    ${isStaff() ? `<div class="actions inline">${d.statut === "attente" ? `<select data-pd-usine aria-label="Usine débloquée"><option value="">Aucune usine pour l'instant</option>${D.usines.filter((u) => ok.includes(u.taille)
        && !D.choix.some((c) => c.faction_id === d.faction_id && c.usine_id === u.id)).map((u) => { const n = D.choix.filter((c) => c.usine_id === u.id).length;
          return `<option value="${u.id}">${esc(u.nom)} (${u.taille}, ${n}/${TAILLE_USINE[u.taille][1]})</option>`; }).join("")}</select>
      <button class="btn small" data-pd-ok="${d.id}">Valider</button><button class="btn small ghost" data-pd-back="${d.id}">Renvoyer à compléter</button>` : '<span class="muted small">En attente de la faction</span>'}
      <button class="btn small ghost danger" data-pd-no="${d.id}">Refuser</button></div>`
      : mineF ? `<div class="actions">${d.statut === "a_completer" ? `<button class="btn small" data-pd-edit="${d.id}">Compléter la demande</button>` : `<button class="btn small ghost" data-pd-edit="${d.id}">Modifier</button>`}
          <button class="btn small ghost" data-pd-cancel="${d.id}">Annuler</button></div>` : ""}</li>`;
}
function bindProjDem() {
  const open = (projetId, demandeId) => { pdForm = { projet: projetId, demande: demandeId || null }; projets();
    const f = $("pdFormEl"); if (f) { f.scrollIntoView({ behavior: "smooth", block: "start" }); f.note.focus({ preventScroll: true }); } };
  document.querySelectorAll("[data-pd-ask]").forEach((b) => (b.onclick = () => open(+b.dataset.pdAsk)));
  document.querySelectorAll("[data-pd-edit]").forEach((b) => (b.onclick = () => { const d = D.projetDemandes.find((x) => x.id === +b.dataset.pdEdit); open(d.projet_id, d.id); }));
  document.querySelectorAll("[data-pd-cancel]").forEach((b) => (b.onclick = () => confirm("Annuler cette demande ?")
    && act(() => call("PUT", `/api/projets/demandes/${b.dataset.pdCancel}`, { action: "annuler" }), "Demande annulée")));
  document.querySelectorAll("[data-pd-ok]").forEach((b) => (b.onclick = () => {
    const li = b.closest("[data-pd]"), u = li.querySelector("[data-pd-usine]").value;
    act(() => call("PUT", `/api/projets/demandes/${b.dataset.pdOk}`, { action: "accepter", usine_id: u ? +u : null }), "Projet validé");
  }));
  document.querySelectorAll("[data-pd-back]").forEach((b) => (b.onclick = () => { const why = prompt("Ce qu'il manque pour valider le projet (la faction le verra et pourra compléter sa demande) :");
    if (why && why.trim()) act(() => call("PUT", `/api/projets/demandes/${b.dataset.pdBack}`, { action: "renvoyer", reponse: why.trim() }), "Demande renvoyée à la faction"); }));
  document.querySelectorAll("[data-pd-no]").forEach((b) => (b.onclick = () => { const why = prompt("Raison du refus (visible par la faction, facultatif) :");
    if (why !== null) act(() => call("PUT", `/api/projets/demandes/${b.dataset.pdNo}`, { action: "refuser", reponse: why }), "Demande refusée"); }));
  const f = $("pdFormEl");
  if (!f) return;
  const d = pdForm.demande ? D.projetDemandes.find((x) => x.id === pdForm.demande) : null, files = $("pdFiles");
  let picked = [];
  if (files) files.onchange = () => {
    const room = 3 - (d ? (d.images || []).length : 0);
    picked = [...files.files].slice(0, room);
    if (files.files.length > room) toast(`${room} image${room > 1 ? "s" : ""} au plus : les suivantes sont ignorées.`, true);
    $("pdPrev").innerHTML = picked.map((x) => `<span class="pd-img"><img src="${URL.createObjectURL(x)}" alt="Aperçu"></span>`).join("");
  };
  document.querySelectorAll("[data-pd-imgdel]").forEach((b) => (b.onclick = () => confirm("Retirer cette image ?")
    && act(() => call("DELETE", `/api/projets/demandes/${d.id}/images/${b.dataset.pdImgdel}`), "Image retirée")));
  $("pdClose").onclick = () => { pdForm = null; projets(); };
  f.onsubmit = (e) => { e.preventDefault(); act(async () => {
    const imgs = [];
    for (const x of picked) imgs.push(await shrinkImage(x));  // réduites d'abord : une image illisible n'envoie rien
    const note = f.note.value;
    const id = d ? (await call("PUT", `/api/projets/demandes/${d.id}`, { action: "completer", note }), d.id)
      : (await call("POST", "/api/projets/demandes", { projet_id: pdForm.projet, note })).id;
    for (const image of imgs) await call("POST", `/api/projets/demandes/${id}/images`, { image });
    pdForm = null;
  }, d ? "Demande renvoyée au staff" : "Demande envoyée au staff"); };
}
function projetStaffForm() {
  return `<form id="pfForm" class="card form compact"><h3>Valider un projet (après le ticket)</h3>
    <label>Projet<select name="projet_id" id="pfProjet" required><option value="">— choisir —</option>${(D.projets || []).map((pr) => `<option value="${pr.id}">${esc(pr.nom)} (${esc(taillesTxt(pr.tailles))})</option>`).join("")}</select></label>
    <label>Faction<select name="faction_id" required>${facOpts(null, "— choisir —")}</select></label>
    <label>Usine débloquée<select name="usine_id" id="pfUsine"><option value="">Choisis d'abord le projet</option></select></label>
    <label>Note (facultatif)<input name="note" maxlength="500" placeholder="Ex. : ticket de linetaru du 14/10"></label>
    <div class="wide actions"><button class="btn small">Valider le projet</button><span class="muted small">Les règles (unique, 1 fois par faction) sont vérifiées.</span></div></form>`;
}
function projetListEditor() {
  return `<details class="card"><summary>Modifier la liste des projets</summary>
    <div class="tbl-wrap"><table class="tbl left edit"><thead><tr><th>Nom</th><th>Ce qu'il faut faire</th><th>Usine</th><th>Unique</th><th>Sans limite</th><th></th></tr></thead><tbody>
    ${(D.projets || []).map((pr) => `<tr data-pr="${pr.id}"><td><input name="nom" value="${esc(pr.nom)}" aria-label="Nom"></td><td><textarea name="description" rows="2" aria-label="Ce qu'il faut faire">${esc(pr.description || "")}</textarea></td>
      <td>${["moyenne", "petite", "grosse"].map((t) => `<label class="chk"><input type="checkbox" name="t_${t}"${pr.tailles.split(",").includes(t) ? " checked" : ""}> ${t}</label>`).join(" ")}</td>
      <td><input type="checkbox" name="unique_srv"${pr.unique_srv ? " checked" : ""} aria-label="Unique"></td><td><input type="checkbox" name="illimite"${pr.illimite ? " checked" : ""} aria-label="Sans limite"></td>
      <td><button type="button" class="btn small ghost" data-pr-save="${pr.id}">Enregistrer</button> <button type="button" class="x" data-pr-del="${pr.id}" aria-label="Supprimer">✕</button></td></tr>`).join("")}
    </tbody></table></div>
    <form class="actions inline" id="prAdd"><input name="nom" required maxlength="80" placeholder="Nom du nouveau projet" aria-label="Nom du nouveau projet"><button class="btn small ghost">Ajouter un projet</button></form></details>`;
}
function bindProjets() {
  bindProjDem();
  document.querySelectorAll("[data-pf-del]").forEach((b) => (b.onclick = () => confirm("Retirer ce projet à la faction ? L'usine qu'il a débloquée sera retirée aussi.")
    && act(() => call("DELETE", `/api/projets/realises/${b.dataset.pfDel}`), "Projet retiré")));
  const f = $("pfForm");
  if (!f) return;
  $("pfProjet").onchange = () => {
    const pr = projet(+$("pfProjet").value);
    const sel = $("pfUsine");
    if (!pr) { sel.innerHTML = '<option value="">Choisis d\'abord le projet</option>'; return; }
    const ok = pr.tailles.split(",");
    sel.innerHTML = '<option value="">Aucune usine pour l\'instant</option>' + D.usines.filter((u) => ok.includes(u.taille)).map((u) => {
      const n = D.choix.filter((c) => c.usine_id === u.id).length, max = TAILLE_USINE[u.taille][1];
      return `<option value="${u.id}">${esc(u.nom)} (${u.taille}, ${n}/${max}${n >= max ? " complet" : ""})</option>`;
    }).join("");
  };
  f.onsubmit = (e) => { e.preventDefault(); act(() => call("POST", "/api/projets/realises", formData(f)), "Projet validé"); };
  document.querySelectorAll("[data-pr-save]").forEach((b) => (b.onclick = () => {
    const tr = b.closest("tr"), v = (n) => tr.querySelector(`[name="${n}"]`);
    act(() => call("PUT", `/api/projets/${b.dataset.prSave}`, { nom: v("nom").value, description: v("description").value,
      tailles: ["grosse", "moyenne", "petite"].filter((t) => v("t_" + t).checked).join(","), unique_srv: v("unique_srv").checked, illimite: v("illimite").checked }), "Projet enregistré");
  }));
  document.querySelectorAll("[data-pr-del]").forEach((b) => (b.onclick = () => confirm("Supprimer ce projet de la liste ?") && act(() => call("DELETE", `/api/projets/${b.dataset.prDel}`), "Projet supprimé")));
  const add = $("prAdd");
  if (add) add.onsubmit = (e) => { e.preventDefault(); act(() => call("POST", "/api/projets", { nom: e.target.nom.value.trim(), tailles: "petite" }), "Projet ajouté"); };
}

/* ---------- Fiche d'un joueur : tout ce qu'on sait de lui, réuni ---------- */
const SD = () => window.SiteData || { stats: () => null, data: () => null, borderBlocks: () => ({ players: [], teams: {} }) };
const okMc = (n) => /^[A-Za-z0-9_]{2,16}$/.test(n);
const rankOf = (rows, name) => { rows = rows.filter((r) => okMc(r[0])); const i = rows.findIndex((r) => norm(r[0]) === norm(name)); return i < 0 ? null : { v: rows[i][1], rank: i + 1, n: rows.length }; };
const tile = (label, v, rk, cls = "") => `<div class="stat ${cls}"><b>${v}</b><span>${label}${rk ? ` · ${rk.rank}ᵉ / ${rk.n}` : ""}</span></div>`;
const itemFr = (id, nom) => { const k = String(id || "").replace(/^minecraft:/, ""); return (typeof NAMES !== "undefined" && NAMES[k]) || nom || k.replace(/_/g, " "); };
const mapBtn = (o) => o && o.x !== undefined && o.x !== null && (!o.monde || o.monde === "minecraft:overworld")
  ? `<button class="linkbtn" data-map="${o.x},${o.y},${o.z}" title="Voir sur la carte">📍 ${o.x} / ${o.y} / ${o.z}</button>` : "";
const icoE = (item) => { const id = String(item || "").replace(/^minecraft:/, ""); if (!/^[a-z0-9_]+$/.test(id)) return '<span class="eco-ico ph"></span>';
  return `<img class="eco-ico" src="icons/${id}.png" alt="" loading="lazy" data-ph="${esc(itemFr(id).slice(0, 10))}" onerror="iconFail(this)">`; };
// Boutiques (Marché) en tableau compact : icône, objet, prix, stock, propriétaire, position sur la carte
function shopRows(list, withOwner) {
  if (!list.length) return '<p class="empty">Aucune.</p>';
  return `<div class="tbl-wrap"><table class="tbl left shops-mini"><thead><tr><th>Vend</th><th>Prix</th><th>Stock</th>${withOwner ? "<th>Boutique de</th>" : ""}<th>Où</th></tr></thead><tbody>${list.map((b) => {
    const lot = b.type === "lot", first = lot ? ((b.lot || [])[0] || {}).item : b.item;
    const name = b.type === "service" ? (b.service || "Service") : lot ? `Lot : ${(b.lot || []).map((x) => `${fmt(x.quantite)} ${itemFr(x.item, x.nom)}`).join(", ")}` : itemFr(b.item, b.nom);
    const ench = b.details && b.details.enchantements ? b.details.enchantements.map((e) => esc((e.nom || String(e.id).replace(/^minecraft:/, "")) + (e.niveau > 1 ? " " + e.niveau : ""))).join(", ") : "";
    const owner = b.proprietaireType === "faction" ? (ecoToFac(b.faction) ? flink(ecoToFac(b.faction)) : esc(b.proprietaire)) : plink(b.proprietaire);
    return `<tr><td><span class="shop-name">${b.type === "service" ? "🎫" : icoE(first)}<span><b>${esc(name)}</b>${!lot && b.quantite > 1 ? ` <span class="muted small">× ${fmt(b.quantite)}</span>` : ""}${ench ? `<small class="muted"> · ${ench}</small>` : ""}</span></span></td><td>${suE(b.prix)}</td>
      <td>${b.type === "service" ? '<span class="chip ok">illimité</span>' : b.rupture ? '<span class="chip warn">Rupture</span>'
        : b.stock != null ? `${fmt(b.stock)}${stockPct(b) != null ? ` <small class="muted">(${stockPct(b)} %)</small>` : ""}${lowStock(b) ? ' <span class="chip warn">faible</span>' : ""}` : ""}</td>${withOwner ? `<td>${owner}</td>` : ""}<td>${mapBtn(b)}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}
function bindMap() {
  document.querySelectorAll("#espView [data-map]").forEach((b) => (b.onclick = () => { const [x, y, z] = b.dataset.map.split(",").map(Number); if (window.showOnMap) window.showOnMap(x, y, z); }));
}
function notFound(what) {
  view(`<div class="card center"><h3>${what} introuvable</h3><p class="muted">Le nom a peut-être changé.</p><a class="btn ghost" href="#communaute/${what === "Joueur" ? "joueurs" : "factions"}">Voir la liste</a></div>`);
}
function joueurPage() {
  const p = D.players.find((x) => norm(x.mc_name) === norm(arg));
  const name = p ? p.mc_name : arg;
  const S = SD().stats(), bb = SD().borderBlocks();
  const tabs = ((S && S.tab) || []).map((t) => [t.label, rankOf(t.rows, name)]);
  const eco = ecoPlayer(name), rich = rankOf(((ECO && ECO.joueurs) || []).filter((j) => j.solde > 0).map((j) => [j.nom, j.solde]), name);
  const border = rankOf(bb.players, name);
  if (!p && !eco && !tabs.some(([, x]) => x) && !border) return notFound("Joueur");
  const f = p && p.faction_id ? fac(p.faction_id) : null;
  const shops = ((ECO && ECO.boutiques) || []).filter((b) => b.proprietaireType === "joueur" && norm(b.proprietaire) === norm(name));
  const efP = f ? ecoFac(f) : null, facId = efP ? efP.id : eco && eco.faction;
  const facShops = facId ? ((ECO && ECO.boutiques) || []).filter((b) => b.proprietaireType === "faction" && b.faction === facId) : null;
  const hdv = ((ECO && ECO.hdv) || []).filter((a) => norm(a.vendeur) === norm(name) && (!a.fin || a.fin > Date.now()));
  const cand = D.candidats.find((c) => norm(c.mc_name) === norm(name));
  const team = S && S.playerTeams && S.playerTeams[name];
  view(`<p class="crumbs"><a href="#communaute/joueurs">← Tous les joueurs</a></p>
    <section class="card profile-head">
      ${face(name, 80)}
      <div><h3>${esc(name)}${p && p.id === D.meId ? ' <span class="chip ok">C\'est toi</span>' : ""}</h3>
        <p class="tags">${f ? flink(f) : eco && eco.faction ? `<span class="chip">${esc(eco.faction)}</span>` : '<span class="chip muted">Solo</span>'}
          ${team && (!f || norm(team) !== norm(f.name)) ? `<span class="chip muted" title="Équipe en jeu">${esc(team)}</span>` : ""}
          ${p && p.mort ? `<span class="chip m-${esc(p.mort)}" title="${esc(MORT[p.mort])}">${esc(MORT_COURT[p.mort])}</span>` : ""}
          ${p && p.activite ? `<span class="chip">${esc(ACT_COURT[p.activite])}</span>` : ""}
          ${cand ? '<a class="chip warn" href="#communaute/elections">Candidat à la mairie</a>' : ""}</p>
        ${p && p.metier ? `<p class="metier">${esc(p.metier)}</p>` : `<p class="muted">${p ? "Métier non renseigné" : "Pas encore de fiche RP sur le site"}</p>`}
      </div>
    </section>
    <div class="stats">
      ${tabs.map(([l, x]) => tile(l, x ? fmt(x.v) : "–", x)).join("")}
      ${tile("Blocs de bordure", border ? "+" + fmt(Math.round(border.v)) : "–", border, "sun")}
      ${tile("Solde", eco ? suE(eco.solde) : "–", rich, "leaf")}
    </div>
    ${p && (p.metier_desc || p.perso_desc) ? `<div class="boards boards-2">${p.metier_desc ? `<div class="board"><h3>Métier</h3>${para(p.metier_desc)}</div>` : ""}${p.perso_desc ? `<div class="board"><h3>Personnage</h3>${para(p.perso_desc)}</div>` : ""}</div>` : ""}
    <div class="profile-links"><a class="btn small ghost" href="#monde/succes" data-who="${esc(name)}">Voir ses succès</a><a class="btn small ghost" href="#classements/stats">Statistiques</a></div>
    <h3 class="sec">Ses boutiques <small>${fmt(shops.length)}</small></h3>${shopRows(shops)}
    ${facShops ? `<h3 class="sec">Boutiques de sa faction <small>${fmt(facShops.length)}</small></h3>${shopRows(facShops, true)}` : ""}
    ${hdv.length ? `<h3 class="sec">À l'hôtel des ventes <small>${fmt(hdv.length)}</small></h3><ul class="now">${hdv.map((a) => `<li><a href="#marche/hdv">${esc(itemFr(a.item, a.nom))}${a.quantite > 1 ? ` × ${fmt(a.quantite)}` : ""}</a> · ${suE(a.offreActuelle || a.prixDepart)}</li>`).join("")}</ul>` : ""}`);
  document.querySelectorAll("[data-who]").forEach((b) => (b.onclick = () => { try { localStorage.setItem("sumenium-who", b.dataset.who); } catch (e) {} if (window.setWho) window.setWho(b.dataset.who); }));
  bindMap();
}
/* ---------- Fiche d'une faction ---------- */
function factionPage() {
  const f = D.factions.find((x) => String(x.id) === arg || norm(x.name) === norm(arg));
  if (!f) return notFound("Faction");
  const ef = ecoFac(f), S = SD().stats(), bb = SD().borderBlocks();
  const keys = [f.name, ef && ef.tag, ef && ef.id].map(norm).filter(Boolean);
  const t = ((S && S.teams) || []).find((x) => keys.includes(norm(x.team)));
  const blocks = t ? bb.teams[t.team] || 0 : 0;
  const ms = members(f.id);
  const shops = ef ? ((ECO && ECO.boutiques) || []).filter((b) => b.proprietaireType !== "fisc" && b.faction === ef.id) : [];
  view(`<p class="crumbs"><a href="#communaute/factions">← Toutes les factions</a></p>
    <div class="stats">
      ${tile("Membres", fmt(ms.length))}
      ${tile("Banque", ef ? suE(ef.banque) : "–", null, "leaf")}
      ${t ? tile("Succès", fmt(t.bac_advancements)) + tile("Premiers succès", fmt(t.bac_advfirst)) + tile("Morts", fmt(t.Morts)) : ""}
      ${tile("Blocs de bordure", "+" + fmt(Math.round(blocks)), null, "sun")}
    </div>
    <div class="cards">${ms.map((p) => { const role = ef && (ef.membres.find((m) => norm(m.nom) === norm(p.mc_name)) || {}).role;
      return `<a class="pcard mini" href="#communaute/joueur/${encodeURIComponent(p.mc_name)}">${face(p.mc_name, 32)}<div><b>${esc(p.mc_name)}</b>
        <span class="muted small">${ROLE_MOD[role] ? ROLE_MOD[role] + " · " : ""}${esc(p.metier || "Métier non renseigné")}</span></div></a>`; }).join("") || '<p class="empty">Aucun membre.</p>'}</div>
    ${loginHint("Pour modifier ta faction,")}
    <div class="fac-grid one">${facCard(f)}</div>
    <h3 class="sec">Boutiques de la faction <small>${fmt(shops.filter((b) => b.proprietaireType === "faction").length)}</small></h3>${shopRows(shops.filter((b) => b.proprietaireType === "faction"))}
    <h3 class="sec">Boutiques de ses membres <small>${fmt(shops.filter((b) => b.proprietaireType === "joueur").length)}</small></h3>${shopRows(shops.filter((b) => b.proprietaireType === "joueur"), true)}`);
  bindFac();
  bindMap();
}

/* ---------- Usines ---------- */
// Règles des tours (envoyées par le Worker, qui les vérifie aussi)
const TAILLE_TXT = { grosse: "grosse", moyenne: "moyenne", petite: "petite" };
const comboTxt = (c) => { const n = {}; c.forEach((t) => (n[t] = (n[t] || 0) + 1));
  return Object.entries(n).map(([t, k]) => `${k} ${TAILLE_TXT[t]}${k > 1 ? "s" : ""}`).join(" + "); };
const fitsCombo = (sizes, combos) => combos.some((c) => { const left = [...c]; return sizes.every((t) => { const i = left.indexOf(t); if (i < 0) return false; left.splice(i, 1); return true; }); });
// Ordre de passage : factions par rang au tirage (sans rang à la fin) ; la première qui n'a pas validé a la main
function turnState(tour) {
  const order = [...D.factions].sort((a, b) => (a.tirage == null) - (b.tirage == null) || (a.tirage ?? 0) - (b.tirage ?? 0) || a.name.localeCompare(b.name));
  const done = new Set((D.usineFini || []).filter((x) => x.tour === tour).map((x) => x.faction_id));
  const cur = order.find((f) => !done.has(f.id)) || null;
  return { order, done, cur, next: cur ? order.slice(order.indexOf(cur) + 1).find((f) => !done.has(f.id)) : null };
}
function usines() {
  const myFid = isStaff() ? staffFaction : me() && me().faction_id;
  const open = D.settings.usines_ouvertes === "1";
  const tour = +D.settings.usine_tour || 1, TOURS = D.usineTours || {}, rules = TOURS[tour];
  const T = turnState(tour), myTurn = !!myFid && T.cur && T.cur.id === myFid && !T.done.has(myFid);
  const realFid = me() && me().faction_id, alerte = open && !isStaff() && realFid && T.cur && T.cur.id === realFid;
  document.title = alerte ? "🔔 À toi de choisir · Suménium" : "Communauté · Suménium";
  const MAX = D.usineMax || { grosse: 3, moyenne: 4, petite: 5 };
  const mineNow = myFid ? D.choix.filter((c) => c.faction_id === myFid && !c.projet_faction_id && (c.tour || 1) === tour) : [];
  const sizesNow = mineNow.map((c) => (usine(c.usine_id) || {}).taille);
  const canAdd = (t) => !!rules && fitsCombo([...sizesNow, t], rules.combos);
  view(head("Usines", "Résultats du tirage, règles du tour en cours et places restantes. ★ = usine débloquée par un projet communautaire.") + (open ? loginHint("Pour choisir les usines de ta faction,") : "") + `<div class="card rules">
      <h3>Règles</h3>
      <ul class="rules-list">${Object.entries(TOURS).map(([k, r]) => `<li class="${+k === tour ? "cur" : ""}"><b>${esc(r.nom)}</b> (${esc(r.quand)})${+k === tour ? ' <span class="chip ok">tour en cours</span>' : ""} :
        ${r.combos.map(comboTxt).join(", ou ")}, dans l'ordre du tirage.</li>`).join("")}</ul>
      <p class="muted small">Chaque faction choisit à son tour : quand elle a validé ses choix, la main passe à la suivante. La page se met à jour toute seule.</p>
      <p>Chaque usine du même type est limitée sur le serveur : grosses ${MAX.grosse}, moyennes ${MAX.moyenne}, petites ${MAX.petite}.
        Des usines supplémentaires sont disponibles en accomplissant des <a href="#communaute/projets">projets communautaires</a>.</p>
      <p>${open ? `<span class="chip ok">Choix ouverts · ${esc(rules ? rules.nom : "")}</span>` : '<span class="chip warn">Choix fermés</span>'}
      ${isStaff() ? `<label class="chk">Agir pour la faction <select id="usFac">${facOpts(staffFaction, "— choisir —")}</select></label>` : ""}
      ${myFid && rules ? `<span class="muted">${esc(facName(myFid))} · ${esc(rules.nom)} : ${sizesNow.length ? sizesNow.map((t) => TAILLE_TXT[t]).join(" + ") : "rien choisi"}${["grosse", "moyenne", "petite"].some(canAdd) ? ` · encore possible : ${["grosse", "moyenne", "petite"].filter(canAdd).map((t) => TAILLE_TXT[t]).join(", ")}` : " · choix complet"}</span>` : ""}</p>
    </div>
    ${open && rules ? liveCard(T, myFid, myTurn, rules, realFid) : ""}
    ${tirageTable(myFid, open && rules ? T : null)}
    ${isStaff() ? `<div class="card staff-tirage"><h3>Ordre du tirage (staff)</h3>
      <p class="muted small">À faire une seule fois en début de saison : l'ordre est tiré au hasard parmi les factions existantes. Pour corriger un rang à la main : « Modifier » sur la fiche de la faction.</p>
      <div class="actions"><button class="btn small" id="tirageGo">Tirer l'ordre au sort</button>
        <label class="chk"><input type="checkbox" id="tirageForce"> refaire le tirage (remplace l'ordre actuel)</label></div>
      <details><summary>Corriger l'ordre à la main</summary><ol class="order-list">${T.order.map((f, i) => `<li>${flink(f)}
        <button class="x" data-ord="${i}" data-dir="-1"${i === 0 ? " disabled" : ""} aria-label="Monter ${esc(f.name)}">↑</button>
        <button class="x" data-ord="${i}" data-dir="1"${i === T.order.length - 1 ? " disabled" : ""} aria-label="Descendre ${esc(f.name)}">↓</button></li>`).join("")}</ol></details></div>` : ""}
    <details class="all-usines"${open || isStaff() ? " open" : ""}><summary>Toutes les usines et places restantes</summary>
    ${Object.entries(TAILLE_USINE).map(([t, [label]]) => `<h3 class="sec">${label} <small>${MAX[t]} max par usine sur le serveur</small></h3>
      <div class="usines">${D.usines.filter((u) => u.taille === t).map((u) => {
        const takers = D.choix.filter((c) => c.usine_id === u.id);
        const mineC = myFid && takers.find((c) => c.faction_id === myFid);
        const full = takers.length >= MAX[t];
        const oldTour = mineC && (mineC.tour || 1) !== tour;
        const can = myFid && canEditFac(myFid) && (open || isStaff()) && !(mineC && mineC.projet_faction_id) && !(oldTour && !isStaff()) && (isStaff() || myTurn);
        const blocked = !mineC && !isStaff() && (full || !canAdd(t));
        return `<div class="usine${mineC ? " has" : ""}${full ? " full" : ""}"><div><b>${esc(u.nom)}</b>
          <span class="muted small">${takers.length}/${MAX[t]}</span></div>
          <div class="takers">${takers.map((c) => { const f = fac(c.faction_id); return f ? `<a class="chip" href="#communaute/faction/${f.id}">${c.projet_faction_id ? "★ " : ""}${esc(f.name)}${(c.tour || 1) > 1 ? ` <small>T${c.tour}</small>` : ""}</a>` : ""; }).join("")}</div>
          ${can ? `<button class="btn small ${mineC ? "ghost" : ""}" data-us="${u.id}" data-on="${mineC ? 0 : 1}"${blocked ? ` disabled title="${full ? "Plus de place sur le serveur" : "Pas possible avec les règles du tour"}"` : ""}>${mineC ? "Retirer" : "Choisir"}</button>` : mineC && oldTour && !mineC.projet_faction_id ? `<span class="muted small">Choisie au ${(mineC.tour || 1) === 1 ? "1er" : mineC.tour + "e"} tour</span>` : ""}</div>`;
      }).join("")}</div>`).join("")}</details>`);
  if (isStaff()) $("usFac").onchange = (e) => { staffFaction = e.target.value ? +e.target.value : null; usines(); };
  document.querySelectorAll("[data-us]").forEach((b) => (b.onclick = () =>
    act(() => call("POST", `/api/factions/${myFid}/usines`, { usine_id: +b.dataset.us, on: b.dataset.on === "1" }), b.dataset.on === "1" ? "Usine choisie" : "Usine retirée")));
  document.querySelectorAll("[data-fini]").forEach((b) => (b.onclick = () => {
    const fid = +b.dataset.fini, on = b.dataset.on !== "0", f = fac(fid);
    const msg = on ? (isStaff() && fid !== realFid ? `Valider le tour de ${f.name} et passer la main à la faction suivante ?` : "Valider les choix de ta faction ? Tu ne pourras plus les changer, la main passe à la faction suivante.")
      : `Rendre la main à ${f.name} ? Elle pourra de nouveau choisir.`;
    if (confirm(msg)) act(() => call("POST", `/api/factions/${fid}/usines/fini`, { tour, on }), on ? "Choix validés" : "Main rendue");
  }));
  document.querySelectorAll("[data-ord]").forEach((b) => (b.onclick = () => {
    const ids = T.order.map((f) => f.id), i = +b.dataset.ord, j = i + +b.dataset.dir;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    act(() => call("POST", "/api/admin/tirage", { order: ids }), "Ordre mis à jour");
  }));
  const tg = $("tirageGo");
  if (tg) tg.onclick = () => confirm($("tirageForce").checked ? "Refaire le tirage ? L'ordre actuel sera remplacé." : "Tirer au sort l'ordre des factions ?")
    && act(() => call("POST", "/api/admin/tirage", { force: $("tirageForce").checked }), "Ordre tiré au sort");
  startLive();
}
// Carte « en direct » : qui a la main, qui suit, bouton pour valider
function liveCard(T, myFid, myTurn, rules, realFid) {
  if (!T.cur) return `<div class="card live done"><h3>${esc(rules.nom)} terminé</h3><p>Toutes les factions ont validé leurs choix.</p></div>`;
  const mineNow = myFid ? D.choix.filter((c) => c.faction_id === myFid && !c.projet_faction_id && (c.tour || 1) === (+D.settings.usine_tour || 1)) : [];
  return `<div class="card live${myTurn && !isStaff() ? " me" : ""}">
    <div class="live-head"><span class="live-dot" aria-hidden="true"></span><span class="muted small">En direct · ${esc(rules.nom)}</span></div>
    <p class="live-now">${myTurn && !isStaff() ? "<b>C'est à ta faction de choisir !</b>" : `Au tour de ${flink(T.cur)}`}${T.next ? ` <span class="muted small">· ensuite ${flink(T.next)}</span>` : ""}</p>
    ${myTurn && !isStaff() ? `<p class="small">Choisis tes usines plus bas (${esc(rules.combos.map(comboTxt).join(", ou "))}), puis valide pour passer la main.</p>` : ""}
    <div class="actions">${(myTurn && canEditFac(myFid)) || isStaff() ? `<button class="btn small" data-fini="${T.cur.id}">${isStaff() && T.cur.id !== realFid ? `Valider le tour de ${esc(T.cur.name)}` : `Valider mes choix${mineNow.length ? ` (${mineNow.length})` : ""}`}</button>` : ""}</div></div>`;
}
// Mise à jour en direct de la page Usines (toutes les 4 s quand elle est affichée)
let liveTimer = null, liveSig = "";
function startLive() {
  if (liveTimer) return;
  liveTimer = setInterval(async () => {
    if (area !== "communaute" || sub !== "usines") { clearInterval(liveTimer); liveTimer = null; document.title = "Communauté · Suménium"; return; }
    if (document.hidden || busy || !D) return;
    try {
      const L = await call("GET", "/api/usines/live");
      const sig = JSON.stringify(L);
      if (sig === liveSig) return;
      const first = !liveSig; liveSig = sig;
      D.choix = L.choix; D.usineFini = L.usineFini;
      D.settings.usine_tour = L.usine_tour; D.settings.usines_ouvertes = L.usines_ouvertes;
      L.tirage.forEach((t) => { const f = fac(t.id); if (f) f.tirage = t.tirage; });
      if (!first && !document.querySelector("#espView :focus")) usines();
    } catch (e) {}
  }, 4000);
}
function tirageTable(myFid, T) {
  const fs = [...D.factions].sort((a, b) => (a.tirage ?? 999) - (b.tirage ?? 999) || a.name.localeCompare(b.name));
  const state = (f) => !T ? "" : T.done.has(f.id) ? `<td class="st"><span class="chip ok">✓ validé</span>${isStaff() ? ` <button class="x" data-fini="${f.id}" data-on="0" title="Rendre la main à ${esc(f.name)}" aria-label="Rendre la main">↺</button>` : ""}</td>`
    : T.cur && T.cur.id === f.id ? '<td class="st"><span class="chip warn">▶ choisit</span></td>' : '<td class="st"><span class="muted small">en attente</span></td>';
  const cell = (fid, t) => D.choix.filter((c) => c.faction_id === fid && (usine(c.usine_id) || {}).taille === t).map(usineChip).join(" ") || '<span class="muted">—</span>';
  return `<div class="card"><h3>Résultats du tirage</h3>
    <div class="tbl-wrap"><table class="tbl left tirage"><thead><tr><th>Ordre</th><th>Faction</th>${T ? "<th>Tour en cours</th>" : ""}<th>Grosse</th><th>Moyenne</th><th>Petite</th></tr></thead><tbody>
    ${fs.map((f) => `<tr class="${f.id === myFid ? "mine" : ""}${T && T.cur && T.cur.id === f.id ? " turn" : ""}"><td>${f.tirage ? f.tirage + "ᵉ" : "–"}</td><td><b>${flink(f)}</b></td>${state(f)}
      <td data-l="Grosse">${cell(f.id, "grosse")}</td><td data-l="Moyenne">${cell(f.id, "moyenne")}</td><td data-l="Petite">${cell(f.id, "petite")}</td></tr>`).join("")}</tbody></table></div></div>`;
}

/* ---------- Élections ---------- */
function elections() {
  const st = D.settings.election || "fermee";
  const p = me();
  const mine = p && D.candidats.find((c) => c.player_id === p.id);
  const tour = st === "tour1" ? 1 : st === "tour2" ? 2 : 0;
  const res = (cid, t) => { const r = (D.results || []).find((x) => x.candidat_id === cid && x.tour === t); return r ? r.n : 0; };
  const total = (t) => (D.results || []).filter((x) => x.tour === t).reduce((a, x) => a + x.n, 0);
  const shown = D.candidats.filter((c) => tour !== 2 || c.tour2);
  view(head("Élection du maire", tour ? "Un vote par compte et par tour ; tu peux changer ton vote tant que le tour est ouvert. Le vote est secret." : "Les candidats et leur programme.") + `
    <div class="card status-line"><span class="chip ${st === "fermee" ? "muted" : st === "resultats" ? "ok" : "warn"}">${esc(ELECTION[st])}</span></div>
    ${st === "candidatures" && canWrite() && p ? candForm(mine) : ""}
    ${isStaff() ? `<div class="card staff-cand"><h3>Candidature d'un autre joueur (staff)</h3>
      <p class="muted small">Pour un joueur qui ne peut pas le faire lui-même : choisis sa fiche, puis remplis ou corrige sa candidature et son affiche.</p>
      <div class="form compact"><label>Joueur<select id="candFor"><option value="">— choisir —</option>${[...D.players].sort((a, b) => a.mc_name.localeCompare(b.mc_name)).map((x) => `<option value="${x.id}"${x.id === candForId ? " selected" : ""}>${esc(x.mc_name)}${D.candidats.some((c) => c.player_id === x.id) ? " (candidat)" : ""}</option>`).join("")}</select></label></div>
      <div id="candForBox">${candForId ? candForm(D.candidats.find((c) => c.player_id === candForId), D.players.find((x) => x.id === candForId), "cf2") : ""}</div></div>` : ""}
    ${st === "candidatures" ? loginHint("Pour te présenter,") : tour ? loginHint("Pour voter,") : ""}
    <div class="cards">${shown.map((c) => {
      const voted = tour && D.myVotes[tour] === c.id;
      return `<article class="pcard${voted ? " mine" : ""}"><header>${face(c.mc_name)}
        <div><b>${plink(c.mc_name)}</b>${c.tour2 ? '<span class="chip ok">2nd tour</span>' : ""}</div></header>
        ${c.affiche_v ? `<a class="affiche" href="${afficheUrl(c)}" target="_blank" rel="noopener" title="Voir l'affiche en grand"><img src="${afficheUrl(c)}" alt="Affiche de ${esc(c.mc_name)}" loading="lazy"></a>` : ""}
        ${para(c.resume)}
        <p class="links">${c.lien ? `<a href="${esc(c.lien)}" target="_blank" rel="noopener noreferrer nofollow">Programme</a>` : ""}
          ${c.affiche ? `<a href="${esc(c.affiche)}" target="_blank" rel="noopener noreferrer nofollow">${c.affiche_v ? "Autre lien" : "Affiche"}</a>` : ""}</p>
        ${D.results ? `<p class="small">1er tour : <b>${res(c.id, 1)}</b> / ${total(1)}${c.tour2 ? ` · 2nd tour : <b>${res(c.id, 2)}</b> / ${total(2)}` : ""}</p>` : ""}
        <div class="actions">${tour && canWrite() && p ? `<button class="btn small${voted ? " ghost" : ""}" data-vote="${c.id}">${voted ? "Ton vote ✓" : "Voter"}</button>` : ""}
          ${isStaff() ? `<label class="chk"><input type="checkbox" data-t2="${c.id}"${c.tour2 ? " checked" : ""}> Qualifié 2nd tour</label>
          <button class="btn small danger" data-cdel="${c.id}">Retirer</button>` : ""}</div></article>`;
    }).join("") || '<p class="empty">Aucun candidat pour l\'instant.</p>'}</div>`);
  bindCandForm("", mine, null);
  if (candForId) bindCandForm("cf2", D.candidats.find((c) => c.player_id === candForId), candForId);
  const cfor = $("candFor");
  if (cfor) cfor.onchange = () => { candForId = cfor.value ? +cfor.value : null; elections(); };
  document.querySelectorAll("[data-vote]").forEach((b) => (b.onclick = () => act(() => call("POST", "/api/votes", { candidat_id: +b.dataset.vote }), "Vote enregistré")));
  document.querySelectorAll("[data-t2]").forEach((b) => (b.onchange = () => act(() => call("PUT", `/api/candidats/${b.dataset.t2}`, { tour2: b.checked }))));
  document.querySelectorAll("[data-cdel]").forEach((b) => (b.onclick = () => confirm("Retirer ce candidat ?") && act(() => call("DELETE", `/api/candidats/${b.dataset.cdel}`), "Candidat retiré")));
}
let candForId = null;
// Formulaire de candidature : le sien (px = ""), ou celui d'un autre joueur rempli par le staff (px = "cf2", pl = sa fiche)
function candForm(c, pl, px = "") {
  const other = !!pl;
  return `<form id="${px}candForm" class="${other ? "" : "card "}form"><h3>${other ? `Candidature de ${esc(pl.mc_name)}` : c ? "Ma candidature" : "Me présenter"}</h3>
    <label class="wide">Résumé du programme<textarea name="resume" rows="4" maxlength="2000">${esc(c && c.resume)}</textarea></label>
    <div class="wide affiche-edit">
      <div class="affiche-prev" id="${px}affPrev">${c && c.affiche_v ? `<img src="${afficheUrl(c)}" alt="Affiche">` : '<span class="muted small">Pas encore d\'affiche</span>'}</div>
      <div><label>Affiche (image)<input type="file" id="${px}affFile" accept="image/*"></label>
        <p class="muted small">PNG, JPEG, WebP ou GIF (photo de téléphone acceptée). L'image est réduite automatiquement (1600 px maximum) et visible par tous.</p>
        ${c && c.affiche_v ? `<button type="button" class="btn small ghost" id="${px}affDel">Retirer l'affiche</button>` : ""}</div>
    </div>
    <label>Lien vers le programme<input name="lien" type="url" placeholder="https://…" value="${esc(c && c.lien)}"></label>
    <label>Autre lien (facultatif)<input name="affiche" type="url" placeholder="https://…" value="${esc(c && c.affiche)}"></label>
    <div class="wide actions"><button class="btn">${c ? "Mettre à jour" : other ? "Déposer sa candidature" : "Déposer ma candidature"}</button>${c ? `<button type="button" class="btn ghost danger" id="${px}candWithdraw">Retirer</button>` : ""}</div></form>`;
}
function bindCandForm(px, c, playerId) {
  const cf = $(px + "candForm");
  if (!cf) return;
  const file = $(px + "affFile");
  file.onchange = () => { const f = file.files[0]; if (f) $(px + "affPrev").innerHTML = `<img src="${URL.createObjectURL(f)}" alt="Aperçu de l'affiche">`; };
  cf.onsubmit = (e) => { e.preventDefault(); act(async () => {
    const f = file.files[0], image = f ? await shrinkImage(f) : null;  // réduite avant d'enregistrer : une erreur d'image n'enregistre rien
    const fields = { resume: cf.resume.value, lien: cf.lien.value, affiche: cf.affiche.value };
    const id = c ? (await call("PUT", `/api/candidats/${c.id}`, fields), c.id) : (await call("POST", "/api/candidats", playerId ? { ...fields, player_id: playerId } : fields)).id;
    if (image) await call("PUT", `/api/candidats/${id}/affiche`, { image });
  }, "Candidature enregistrée"); };
  const del = $(px + "affDel");
  if (del) del.onclick = () => confirm("Retirer l'affiche ?") && act(() => call("DELETE", `/api/candidats/${c.id}/affiche`), "Affiche retirée");
  const cw = $(px + "candWithdraw");
  if (cw) cw.onclick = () => confirm(playerId ? "Retirer cette candidature ?" : "Retirer ta candidature ?") && act(() => call("DELETE", `/api/candidats/${c.id}`), "Candidature retirée");
}
const afficheUrl = (c) => `/api/candidats/${c.id}/affiche?v=${c.affiche_v}`;
// Réduit l'image dans le navigateur (1600 px max, WebP ou JPEG) pour rester sous ~900 ko
async function shrinkImage(file) {
  if (file.type && !file.type.startsWith("image/")) throw new Error("Ce fichier n'est pas une image.");
  if (file.size > 40e6) throw new Error("Image trop lourde (40 Mo maximum avant réduction).");
  const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i);
    i.onerror = () => ko(new Error(/heic|heif/i.test(file.type + file.name) ? "Format HEIC (photo d'iPhone) non lu par ce navigateur : enregistre l'image en JPEG ou PNG, ou fais une capture d'écran." : "Image illisible : essaie en PNG ou JPEG."));
    i.src = URL.createObjectURL(file); });
  let side = 1600, q = 0.85;
  for (let tries = 0; tries < 8; tries++) {
    const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    let url = cv.toDataURL("image/webp", q);
    if (!url.startsWith("data:image/webp")) url = cv.toDataURL("image/jpeg", q);
    if (url.length * 0.75 < 900_000) { URL.revokeObjectURL(img.src); return url; }
    if (q > 0.6) q -= 0.1; else side = Math.round(side * 0.8);
  }
  throw new Error("Image trop lourde, même réduite.");
}

function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}
function suggest(name) {
  const a = norm(name);
  let best = null, bestD = Infinity;
  for (const w of D.wlFree) {
    const b = norm(w);
    const dist = a.length >= 4 && (b.startsWith(a) || a.startsWith(b)) ? 0.5 : lev(a, b);
    if (dist < bestD) { bestD = dist; best = w; }
  }
  return best && bestD <= Math.max(1, Math.floor(Math.min(a.length, norm(best).length) / 3)) ? best : null;
}
function renameCell(p) {
  const sug = suggest(p.mc_name);
  return `<select data-ren="${p.id}" aria-label="Pseudo du serveur pour ${esc(p.mc_name)}"><option value="">—</option>
    ${D.wlFree.map((w) => `<option${w === sug ? " selected" : ""}>${esc(w)}</option>`).join("")}</select>
    <button class="btn small ghost" data-ren-go="${p.id}">Renommer</button>`;
}
const copyBtn = (cmd) => `<code>${esc(cmd)}</code> <button class="x copy" data-copy="${esc(cmd)}" aria-label="Copier">⧉</button>`;

function staff() {
  const s = D.settings;
  const tailles = D.players.filter((p) => p.taille_cm && !p.taille_fixe).map((p) => ({ p, sc: scaleOf(p.taille_cm) }));
  const fixes = D.players.filter((p) => p.taille_fixe);
  const todo = tailles.filter(({ p, sc }) => p.taille_appliquee == null || Math.abs(p.taille_appliquee - sc) >= 0.0005);
  const aWl = D.wlSynced ? D.players.filter((p) => !p.whitelisted).sort((a, b) => ficheOk(b) - ficheOk(a) || a.mc_name.localeCompare(b.mc_name)) : [];
  const fDem = (D.factionDemandes || []).filter((d) => d.statut === "attente"), pDem = (D.projetDemandes || []).filter((d) => PD_OPEN.includes(d.statut));
  const absentes = D.factions.filter((f) => ECO && !ecoFac(f));
  const nav = [["st-dem", `Demandes (${fDem.length + pDem.filter((d) => d.statut === "attente").length})`], ["st-wl", `À whitelister (${aWl.filter(ficheOk).length})`], ["st-taille", `Tailles RP (${todo.length})`], ["st-bordure", "Bordure"], ["st-hist", "Historique d'un joueur"], ["st-reglages", "Réglages"], ["st-import", "Import"], ["st-histo", "Historique"]];
  view(head("Outils staff", "Whitelist, tailles RP, bordure, réglages et historique de toutes les modifications.") +
    `<nav class="anchors">${nav.map(([id, l]) => `<a href="#" data-jump="${id}">${l}</a>`).join("")}</nav>
    <section class="card" id="st-dem"><h3>Demandes des joueurs</h3>
      <h4>Nouvelles factions</h4>${fDem.length ? `<ul class="dem-list">${fDem.map(facDemItem).join("")}</ul>` : '<p class="muted small">Aucune demande.</p>'}
      <h4>Projets communautaires</h4>${pDem.length ? `<ul class="dem-list">${pDem.map(projDemItem).join("")}</ul>` : '<p class="muted small">Aucune demande.</p>'}
      ${absentes.length ? `<h4>Factions du site absentes du serveur</h4>
        <p class="muted small">Pas encore créées dans le mod (aucune faction en jeu ne correspond). Lance ces commandes en jeu, dans l'ordre : le premier joueur ajouté devient chef.</p>
        ${absentes.map((f) => { const d = (D.factionDemandes || []).find((x) => x.faction_id === f.id), names = d ? d.membres : members(f.id).map((p) => p.mc_name);
          return `<details class="cmds-box"><summary>${colTag(d ? d.couleur : "white", f.name)} <span class="muted small">${names.length} joueurs${d ? "" : " · couleur à choisir (white par défaut)"}</span></summary>
            <ul class="cmd-list">${facCmds(f.name, d ? d.couleur : "white", names).map((c) => `<li>${copyBtn(c)}</li>`).join("")}</ul></details>`; }).join("")}` : ""}
    </section>
    <section class="card" id="st-wl"><h3>À whitelister</h3>
      ${D.wlSynced ? `<p class="muted small">Joueurs avec une fiche mais absents de la whitelist. Vérifie la candidature, lance la commande en jeu : ils disparaissent d'ici la prochaine synchronisation (10 min).</p>
      ${D.wlFree && D.wlFree.length ? `<p class="muted small">Si une fiche porte un pseudo Discord ou une faute de frappe alors que le joueur est déjà whitelisté, choisis son vrai pseudo dans « Pseudo du serveur » et renomme la fiche (${plural(D.wlFree.length, "pseudo whitelisté", "pseudos whitelistés")} sans fiche).</p>` : ""}
      <div class="tbl-wrap"><table class="tbl left"><thead><tr><th>Joueur</th><th>Discord</th><th>Faction</th><th>Fiche</th>${D.wlFree && D.wlFree.length ? "<th>Pseudo du serveur</th>" : ""}<th>Commande</th></tr></thead><tbody>
      ${aWl.map((p) => `<tr><td>${esc(p.mc_name)}</td><td>${p.discord_name ? "@" + esc(p.discord_name) : '<span class="muted">non relié</span>'}</td>
          <td>${p.faction_id ? esc(facName(p.faction_id)) : '<span class="muted">solo</span>'}</td>
          <td>${ficheOk(p) ? '<span class="chip ok">complète</span>' : `<span class="chip warn">manque ${[!p.metier && "métier", !p.mort && "mourir/survivre"].filter(Boolean).join(", ")}</span>`}</td>
          ${D.wlFree && D.wlFree.length ? `<td class="ren">${renameCell(p)}</td>` : ""}
          <td>${copyBtn(`/whitelist add ${p.mc_name}`)}</td></tr>`).join("")
        || '<tr><td colspan="6" class="empty">Tout le monde est whitelisté.</td></tr>'}</tbody></table></div>`
      : '<p class="muted small">La whitelist du serveur n\'a pas encore été synchronisée (toutes les 10 minutes).</p>'}</section>
    <section class="card" id="st-taille"><h3>Tailles RP</h3>
      <p class="muted small">Copie la commande, lance-la en jeu, puis coche « appliquée ». Échelle = taille IRL ÷ 1,87 m.</p>
      <div class="tbl-wrap"><table class="tbl left"><thead><tr><th>Joueur</th><th>IRL</th><th>Échelle</th><th>Commande</th><th>Appliquée</th></tr></thead><tbody>
      ${tailles.sort((a, b) => (todo.includes(b) - todo.includes(a)) || a.p.mc_name.localeCompare(b.p.mc_name)).map(({ p, sc }) => {
        const ok = p.taille_appliquee != null && Math.abs(p.taille_appliquee - sc) < 0.0005;
        return `<tr><td>${esc(p.mc_name)}</td><td>${p.taille_cm} cm</td><td>${fmt(sc)}${p.taille_appliquee != null && !ok ? ` <span class="chip warn">en jeu ${fmt(p.taille_appliquee)}</span>` : ""}</td>
          <td>${copyBtn(`/attribute ${p.mc_name} minecraft:scale base set ${sc}`)}</td>
          <td><input type="checkbox" data-applied="${p.id}" data-sc="${sc}"${ok ? " checked" : ""} aria-label="Taille appliquée pour ${esc(p.mc_name)}"></td></tr>`;
      }).join("") || '<tr><td colspan="5" class="empty">Aucune taille renseignée.</td></tr>'}</tbody></table></div>
      ${fixes.length ? `<p class="small">Gardent la taille normale (rien à appliquer${fixes.some((p) => p.taille_appliquee != null && p.taille_appliquee !== 1) ? ", sauf remettre <code>1</code> si une taille avait déjà été appliquée" : ""}) : ${fixes.map((p) => `${esc(p.mc_name)}${p.taille_appliquee != null && p.taille_appliquee !== 1 ? ` (${copyBtn(`/attribute ${p.mc_name} minecraft:scale base set 1`)})` : ""}`).join(", ")}</p>` : ""}
      <p class="muted small">Pour cocher « ne veut pas changer de taille » à la place d'un joueur : Communauté › Joueurs › Modifier (staff).</p></section>
    <section class="card" id="st-bordure"><h3>Bordure après un changement de multiplicateur</h3><div id="borderTool"><p class="empty">Chargement…</p></div></section>
    <section class="card" id="st-hist"><h3>Historique économique d'un joueur</h3>
      <p class="muted small">Achats, ventes, rachats du FISC, frais… d'après le journal du mod. Utile pour vérifier un abus (prix mal réglé, par exemple).</p>
      <div class="bar"><select id="shPlayer" aria-label="Joueur"><option value="">— choisir un joueur —</option>${D.players.map((p) => `<option>${esc(p.mc_name)}</option>`).join("")}</select>${typeSelect("shType")}</div>
      <div id="shList"></div></section>
    <section class="card form" id="st-reglages"><h3>Réglages</h3>
      <label>Élection<select id="setElection">${opt(ELECTION, s.election)}</select></label>
      <label>Choix d'usines<select id="setUsOpen"><option value="1"${s.usines_ouvertes === "1" ? " selected" : ""}>Ouverts</option><option value="0"${s.usines_ouvertes !== "1" ? " selected" : ""}>Fermés</option></select></label>
      <label>Création de factions par les joueurs<select id="setFacOpen"><option value="0"${s.factions_ouvertes !== "1" ? " selected" : ""}>Fermée</option><option value="1"${s.factions_ouvertes === "1" ? " selected" : ""}>Ouverte</option></select></label>
      <label>Tour de choix d'usines<select id="setUsTour">${Object.entries(D.usineTours || {}).map(([k, r]) => `<option value="${k}"${String(s.usine_tour || "1") === k ? " selected" : ""}>${esc(r.nom)} : ${esc(r.combos.map(comboTxt).join(" / "))}</option>`).join("")}</select></label>
      <div class="wide actions"><button class="btn small" id="saveSettings">Enregistrer les réglages</button></div></section>
    <section class="card" id="st-import"><h3>Importer le Google Sheet</h3>
      <p class="muted small">Fichier JSON produit par <code>tools/import_sheet.py</code>. L'import ajoute ce qui manque et complète les champs vides, sans rien écraser.</p>
      <input type="file" id="importFile" accept="application/json,.json"></section>
    <section class="card" id="st-histo"><h3>Historique</h3><p class="muted small">Chaque modification est enregistrée. « Annuler » remet les valeurs d'avant.</p>
      <div id="auditList" class="audit-scroll"><p class="empty">Chargement…</p></div><button class="btn small ghost" id="auditMore" hidden>Plus ancien</button></section>`);
  document.querySelectorAll("[data-jump]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); $(a.dataset.jump).scrollIntoView({ behavior: "smooth", block: "start" }); }));
  $("saveSettings").onclick = () => act(() => call("PUT", "/api/admin/settings",
    { election: $("setElection").value, usines_ouvertes: $("setUsOpen").value, usine_tour: $("setUsTour").value, factions_ouvertes: $("setFacOpen").value }), "Réglages enregistrés");
  bindFacDem(); bindProjDem();
  document.querySelectorAll("[data-ren-go]").forEach((b) => (b.onclick = () => {
    const sel = document.querySelector(`select[data-ren="${b.dataset.renGo}"]`), p = D.players.find((x) => x.id === +b.dataset.renGo);
    if (!sel.value) return toast("Choisis d'abord le pseudo du serveur.", true);
    if (confirm(`Renommer la fiche « ${p.mc_name} » en « ${sel.value} » ?`)) act(() => call("PUT", `/api/admin/players/${p.id}`, { mc_name: sel.value }), "Fiche renommée");
  }));
  bindCopy();
  document.querySelectorAll("[data-applied]").forEach((b) => (b.onchange = () =>
    act(() => call("PUT", `/api/admin/players/${b.dataset.applied}`, { taille_appliquee: b.checked ? +b.dataset.sc : null }))));
  $("importFile").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    let data; try { data = JSON.parse(await f.text()); } catch { return toast("Ce fichier n'est pas un JSON valide.", true); }
    act(async () => { const r = await call("POST", "/api/admin/import", data);
      toast(`Import : ${r.done.factions} factions et ${r.done.players} joueurs créés, ${r.done.completes} fiches complétées, ${r.done.usines} choix d'usines ajoutés`); });
  };
  const shGo = () => { const n = $("shPlayer").value; if (n) loadHistory(`/api/admin/historique?joueur=${encodeURIComponent(n)}`, $("shList"), false); else $("shList").innerHTML = ""; };
  $("shPlayer").onchange = shGo;
  $("shType").onchange = (e) => { hType = e.target.value; shGo(); };
  borderTool();
  auditRows = []; auditEnd = false; loadAudit();
  $("auditMore").onclick = loadAudit;
}
function bindCopy(root = document) {
  root.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast("Commande copiée"))));
}
// Taille « théorique » de la bordure : 5 blocs de départ + gains de tous les succès obtenus au multiplicateur actuel.
async function borderTool() {
  try { WORLD = await (await fetch("data.json?t=" + Date.now())).json(); } catch (e) { WORLD = null; }
  const el = $("borderTool"); if (!el) return;
  const cur = WORLD && WORLD.border && WORLD.border.size, exp = WORLD && WORLD.expectedDiameter;
  if (!cur || !exp) { el.innerHTML = '<p class="muted small">Les données arrivent à la prochaine mise à jour du site.</p>'; return; }
  const target = Math.round(exp), diff = target - Math.round(cur);
  const dims = ["overworld", "the_nether", "the_end"];
  const cmds = (secs) => dims.map((d) => `execute in minecraft:${d} run worldborder set ${target}${secs ? " " + secs : ""}`);
  el.innerHTML = `<p class="small">Le WB-Addon <b>ne recalcule pas</b> la bordure quand on change le multiplicateur : <code>set_multiplier</code> ne fait que mettre à jour l'affichage des contributions.
      Les succès déjà obtenus gardent le gain calculé avec l'ancien multiplicateur.</p>
    <div class="stats mini-stats">
      <div class="stat"><b>${fmt(Math.round(cur))}</b><span>Diamètre actuel</span></div>
      <div class="stat sun"><b>${fmt(target)}</b><span>Avec ×${fmt(WORLD.multiplier)} pour tout</span></div>
      <div class="stat ${diff < 0 ? "" : "leaf"}"><b>${diff > 0 ? "+" : ""}${fmt(diff)}</b><span>Écart</span></div>
    </div>
    ${Math.abs(diff) < 2 ? '<p class="chip ok">La bordure correspond déjà au multiplicateur actuel.</p>' : `
    <p class="small">Pour appliquer le multiplicateur actuel à tous les succès déjà obtenus, lance ces trois commandes (en jeu ou depuis la console).
      ${diff < 0 ? "<b>La bordure va rétrécir</b> : les joueurs qui se retrouvent dehors prennent des dégâts. Préviens-les, ou fais-la rétrécir lentement avec la 2e version (10 min)." : ""}</p>
    <p class="small"><b>Immédiat</b></p>${cmds(0).map((c) => `<p class="cmd">${copyBtn(c)}</p>`).join("")}
    <p class="small"><b>Progressif sur 10 minutes</b></p>${cmds(600).map((c) => `<p class="cmd">${copyBtn(c)}</p>`).join("")}
    <p class="muted small">Calcul : bordure de départ (5) + somme des gains de chaque succès obtenu, recalculés avec le multiplicateur actuel (mode ${WORLD.mode === "tiers" ? "paliers" : "individuel"}).
      Les succès « Fin de partie » à valeur fixe ne dépendent pas du multiplicateur. Relance le calcul après la prochaine mise à jour du site si un succès vient d'être obtenu.</p>`}`;
  bindCopy(el);
}
async function loadAudit() {
  try {
    const before = auditRows.length ? auditRows[auditRows.length - 1].id : "";
    const r = await call("GET", `/api/admin/audit${before ? "?before=" + before : ""}`);
    auditRows = auditRows.concat(r.rows); auditEnd = r.rows.length < 100;
  } catch (e) { toast(e.message, true); }
  const list = $("auditList"); if (!list) return;
  const name = (a) => {
    if (a.entity === "players") return (D.players.find((p) => p.id === +a.entity_id) || {}).mc_name || `joueur #${a.entity_id}`;
    if (a.entity === "factions") return facName(+a.entity_id) || `faction #${a.entity_id}`;
    if (a.entity === "usine_choix") { const [f, u] = a.entity_id.split(":").map(Number); return `${facName(f)} · ${(usine(u) || {}).nom || "usine"}`; }
    if (a.entity === "projet_faction") { const v = JSON.parse(a.after || a.before || "{}"); return `projet ${(projet(v.projet_id) || {}).nom || "#" + a.entity_id}${v.faction_id ? " · " + facName(v.faction_id) : ""}`; }
    if (a.entity === "projets") return `liste des projets · ${(projet(+a.entity_id) || {}).nom || "#" + a.entity_id}`;
    return `${a.entity} ${a.entity_id}`;
  };
  const diff = (a) => {
    const b = a.before ? JSON.parse(a.before) : {}, n = a.after ? JSON.parse(a.after) : {};
    return Object.keys({ ...b, ...n }).filter((k) => JSON.stringify(b[k]) !== JSON.stringify(n[k]))
      .map((k) => `<span class="df"><i>${esc(k)}</i> ${esc(short(b[k]))} → <b>${esc(short(n[k]))}</b></span>`).join(" ");
  };
  const ACTION = { create: "création", update: "modification", delete: "suppression", claim: "pseudo relié", revert: "annulation", vote: "vote", import: "import" };
  list.innerHTML = auditRows.map((a) => `<div class="audit${a.reverted ? " rev" : ""}">
      <div><b>${esc(a.actor_name || "?")}</b> · ${esc(ACTION[a.action] || a.action)} · ${esc(name(a))}
        <span class="muted small">${new Date(a.ts * 1000).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span></div>
      <div class="small">${a.entity === "votes" ? '<span class="muted">vote secret</span>' : diff(a)}</div>
      ${!a.reverted && !["revert", "vote"].includes(a.action) && a.entity !== "import" ? `<button class="btn small ghost" data-rev="${a.id}">Annuler</button>` : a.reverted ? '<span class="chip">annulé</span>' : ""}</div>`).join("") || '<p class="empty">Aucune modification.</p>';
  $("auditMore").hidden = auditEnd;
  list.querySelectorAll("[data-rev]").forEach((b) => (b.onclick = () => confirm("Annuler cette modification ?")
    && act(() => call("POST", `/api/admin/audit/${b.dataset.rev}/revert`), "Modification annulée")));
}
const short = (v) => (v === null || v === undefined || v === "" ? "∅" : String(v).length > 60 ? String(v).slice(0, 57) + "…" : String(v));

/* ---------- entrée ---------- */
let started = false;
async function start() {
  if (started) return;
  started = true;
  if (!LIVE) { checking = false; render(); return; }
  try { await reload(); }
  catch (e) { toast(e.message, true); }
  finally {
    checking = false; render();
    // Retour de la connexion Discord : on revient sur la page de départ
    let next = null; try { next = sessionStorage.getItem(NEXT_KEY); sessionStorage.removeItem(NEXT_KEY); } catch (e) {}
    if (next && ME && /^#espace\/?$|^#?$/.test(location.hash) && next !== location.hash) location.replace(next);
  }
}
function show(a, s, x) {
  area = AREAS[a] ? a : "espace";
  arg = x || "";
  const subs = AREAS[area].subs.map(([k]) => k);
  sub = area === "communaute" && (s === "joueur" || s === "faction") && arg ? s : subs.includes(s) ? s : subs[0];
  if (!started) { start(); render(); return; }
  render();
  // les autres joueurs ont pu modifier des choses : on relit en arrière-plan (au plus toutes les 20 s)
  if (D && !busy && Date.now() - lastLoad > 20000) reload().catch(() => {});
}
window.addEventListener("hashchange", renderAcct);
start();
// Pour les autres onglets : retrouver la faction de l'Espace depuis le mod (id) ou un nom d'équipe
const facByName = (n) => (D && n ? D.factions.find((f) => { const e = ecoFac(f); return [f.name, e && e.tag, e && e.id].map(norm).includes(norm(n)); }) || null : null);
window.Espace = { show, data: () => D, facOfEco: (id) => ecoToFac(id), facByName };
})();
