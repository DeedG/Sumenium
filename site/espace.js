/* Espace Suménium : fiches joueurs, factions, projets communautaires, usines, élections, prix, outils staff.
   Fonctionne uniquement sur sumenium.alheon.fr (l'API et la connexion Discord y sont servies). */
(() => {
const HOST = "sumenium.alheon.fr";
const LIVE = location.hostname === HOST || location.hostname === "localhost" || location.hostname === "127.0.0.1";
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
// Sous-onglets, regroupés : ce qui me concerne / la vie du serveur / le staff
const GROUPS = [
  ["Moi", [["fiche", "Ma fiche"]]],
  ["Serveur", [["factions", "Factions"], ["projets", "Projets"], ["usines", "Usines"], ["joueurs", "Joueurs"], ["elections", "Élections"], ["prix", "Prix du FISC"]]],
  ["Staff", [["staff", "Outils staff"]]],
];
const SUBS = GROUPS.flatMap(([, l]) => l);
// Échelle RP : 1,87 m IRL = taille normale (1), comme dans l'ancien tableau
const scaleOf = (cm) => (cm ? Math.round((cm / 187) * 10000) / 10000 : null);

let ME = null, D = null, sub = "fiche", busy = false, staffFaction = null, auditRows = [], auditEnd = false, WORLD = null;

/* ---------- API ---------- */
async function call(method, path, body) {
  const r = await fetch(path, {
    method, credentials: "same-origin",
    headers: { "content-type": "application/json", "x-requested-with": "sumenium" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && ME) { ME = null; D = null; render(); }
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
  D = await call("GET", "/api/data");
  render();
}

/* ---------- helpers ---------- */
const isStaff = () => ME && ME.level === "staff";
const canWrite = () => ME && ME.level !== "attente";
const me = () => D && D.players.find((p) => p.id === D.meId);
const fac = (id) => D.factions.find((f) => f.id === id);
const facName = (id) => (fac(id) || {}).name || "";
const members = (fid) => D.players.filter((p) => p.faction_id === fid);
const usine = (id) => D.usines.find((u) => u.id === id);
const projet = (id) => (D.projets || []).find((x) => x.id === id);
const canEditFac = (fid) => isStaff() || (canWrite() && me() && me().faction_id === fid);
const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}"${k === (cur ?? "") ? " selected" : ""}>${esc(v)}</option>`).join("");
const facOpts = (cur, none = "Sans faction (solo)") => `<option value="">${none}</option>` + D.factions.map((f) =>
  `<option value="${f.id}"${f.id === cur ? " selected" : ""}>${esc(f.name)} (${members(f.id).length}/8)</option>`).join("");
const formData = (form) => Object.fromEntries(new FormData(form).entries());
const para = (t) => (t ? `<p class="txt">${esc(t)}</p>` : "");
const head = (title, sub2) => `<div class="sec-head"><h3>${title}</h3>${sub2 ? `<p class="sub2">${sub2}</p>` : ""}</div>`;
const face = (n, size = 32) => `<img class="face" src="https://mc-heads.net/avatar/${encodeURIComponent(n)}/${size}" alt="" width="${size}" height="${size}" loading="lazy">`;
const plural = (n, one, many) => `${fmt(n)} ${n > 1 ? many : one}`;
const reglesProjet = (pr) => pr.unique_srv ? '<span class="chip lvl-staff">Unique sur le serveur</span>'
  : pr.illimite ? '<span class="chip ok">Sans limite</span>' : '<span class="chip">1 fois par faction</span>';
const taillesTxt = (t) => t.split(",").map((x) => TAILLE_MOT[x] || x).join(" ou ");
// Fiche suffisante pour être whitelisté : métier + « mourir ou survivre » (faction facultative : on peut jouer seul)
const ficheOk = (p) => !!(p.metier && p.mort);

/* ---------- squelette ---------- */
function render() {
  const root = $("espaceRoot");
  if (!LIVE) {
    root.innerHTML = `<div class="card center"><h3>L'espace joueurs est sur sumenium.alheon.fr</h3>
      <p>Fiches, factions, usines et élections se gèrent avec ton compte Discord, sur l'adresse du serveur.</p>
      <a class="btn" href="https://${HOST}/#espace">Ouvrir l'Espace Suménium</a></div>`;
    return;
  }
  if (!ME) {
    const err = new URLSearchParams(location.hash.split("?")[1] || "").get("erreur");
    root.innerHTML = `${err ? `<div class="banner">${esc(err)}</div>` : ""}<div class="card center">
      <h3>Connecte-toi avec Discord</h3>
      <p>L'espace est réservé aux membres du Discord Suménium. Tu restes connecté 30 jours sur cet appareil.</p>
      <a class="btn discord" href="/api/auth/login">Se connecter avec Discord</a>
      <p class="muted small">On lit seulement ton pseudo Discord et tes rôles sur le serveur Suménium. Rien n'est publié sur Discord.</p></div>`;
    return;
  }
  if (!D) { root.innerHTML = '<p class="empty">Chargement…</p>'; return; }
  if (!SUBS.some(([k]) => k === sub) || (sub === "staff" && !isStaff())) sub = "fiche";
  const badge = { staff: isStaff() ? D.players.filter((p) => D.wlSynced && !p.whitelisted && ficheOk(p)).length : 0 };
  root.innerHTML = `<div class="who-bar">
      <div class="who-me">${ME.avatar ? `<img src="${esc(ME.avatar)}" alt="" width="36" height="36">` : ""}
        <div><b>${esc(ME.name)}</b><span class="chip lvl-${esc(ME.level)}">${esc(LEVEL[ME.level])}</span></div></div>
      <a class="link" href="/api/auth/logout">Se déconnecter</a></div>
    ${ME.level === "attente" ? '<div class="banner info">Ton compte est en attente de vérification : tu peux tout consulter, et tu pourras remplir ta fiche une fois le vocal passé avec le staff.</div>' : ""}
    <nav class="subtabs" aria-label="Espace joueurs">${GROUPS.filter(([g]) => g !== "Staff" || isStaff()).map(([g, items]) =>
      `<span class="grp">${g}</span>` + items.map(([k, l]) => `<a href="#espace/${k}" aria-current="${k === sub ? "page" : "false"}">${l}${badge[k] ? ` <span class="badge">${badge[k]}</span>` : ""}</a>`).join("")).join("")}</nav>
    <div id="espView"></div>`;
  ({ fiche, joueurs, factions, projets, usines, elections, prix, staff })[sub]();
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
      <div class="profile-id">${face(p.mc_name, 64)}<div><b>${esc(p.mc_name)}</b><span class="muted small">${f ? esc(f.name) : "Solo"}</span></div></div>
      <ul class="status">
        <li>${p.whitelisted ? '<span class="chip ok">✓ Whitelisté</span>' : '<span class="chip warn">Pas encore whitelisté</span>'}</li>
        <li>${ficheOk(p) ? '<span class="chip ok">✓ Fiche complète</span>' : `<span class="chip warn">À compléter : ${[!p.metier && "métier", !p.mort && "mourir ou survivre"].filter(Boolean).join(", ")}</span>`}</li>
        <li>${sc ? (applied != null && Math.abs(applied - sc) < 0.0005 ? '<span class="chip ok">✓ Taille RP appliquée</span>' : '<span class="chip warn">Taille RP à appliquer par le staff</span>') : '<span class="chip muted">Taille RP non renseignée</span>'}</li>
      </ul>
      ${!p.whitelisted ? `<p class="small muted">${ficheOk(p) ? "Ta fiche est complète : le staff t'ajoute à la whitelist une fois ta candidature validée." : "Complète ta fiche : le staff t'ajoute à la whitelist une fois ta candidature validée."}</p>` : ""}
      <div class="profile-links">
        <a class="btn small ghost" href="#succes" data-my-succes>Mes succès</a>
        ${f ? `<a class="btn small ghost" href="#espace/factions">Ma faction</a>` : ""}
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
        <label>Taille IRL (cm)<input name="taille_cm" type="number" min="50" max="250" step="1" value="${p.taille_cm ?? ""}" id="tailleIn" placeholder="175"></label>
        <div class="taille-info" id="tailleInfo">${tailleTxt(sc, applied)}</div>
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
  form.onsubmit = (e) => { e.preventDefault(); act(() => call("PUT", "/api/me/player", formData(form)), "Fiche enregistrée"); };
  document.querySelector("[data-my-succes]").onclick = () => { try { localStorage.setItem("sumenium-who", p.mc_name); } catch (e) {} if (window.setWho) window.setWho(p.mc_name); };
}
function tailleTxt(sc, applied) {
  if (!sc) return '<span class="muted">Indique ta taille pour calculer ta taille en jeu.</span>';
  const st = applied == null ? '<span class="chip warn">pas encore appliquée</span>'
    : Math.abs(applied - sc) < 0.0005 ? '<span class="chip ok">appliquée en jeu</span>' : `<span class="chip warn">en jeu : ${fmt(applied)}, à mettre à jour</span>`;
  return `Échelle <b>${fmt(sc)}</b> (≈ ${fmt(Math.round(sc * 180) / 100)} blocs) ${st}`;
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
      ${isStaff() ? '<button class="btn small" id="addPlayer">Ajouter une fiche</button>' : ""}</div>
    <p class="count">${plural(list.length, "joueur", "joueurs")}</p>
    <div class="cards">${list.map(playerCard).join("") || '<p class="empty">Aucun joueur ne correspond.</p>'}</div>`);
  $("jq").oninput = (e) => { jq = e.target.value; const pos = e.target.selectionStart; joueurs(); $("jq").focus(); $("jq").setSelectionRange(pos, pos); };
  $("jf").onchange = (e) => { jf = e.target.value; joueurs(); };
  if (isStaff()) {
    $("addPlayer").onclick = () => {
      const n = prompt("Pseudo Minecraft du joueur à ajouter :");
      if (n) act(() => call("POST", "/api/admin/players", { mc_name: n.trim() }), "Fiche ajoutée");
    };
  }
  bindPlayerEditors();
}
function playerCard(p) {
  const mine = p.id === D.meId;
  return `<article class="pcard${mine ? " mine" : ""}">
    <header>${face(p.mc_name)}<div><b>${esc(p.mc_name)}</b>${p.faction_id ? `<span class="chip">${esc(facName(p.faction_id))}</span>` : '<span class="chip muted">Solo</span>'}</div></header>
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
      <label class="wide">Description du métier<textarea name="metier_desc" rows="2">${esc(p.metier_desc)}</textarea></label>
      <label class="wide">Description du personnage<textarea name="perso_desc" rows="2">${esc(p.perso_desc)}</textarea></label>
      <div class="wide actions"><button class="btn small">Enregistrer</button>
        ${p.linked ? '<button type="button" class="btn small ghost" data-act="unlink">Délier Discord</button>' : ""}
        <button type="button" class="btn small danger" data-act="del">Supprimer la fiche</button></div></form>`);
    const f = d.querySelector("form");
    f.onsubmit = (e) => { e.preventDefault(); act(() => call("PUT", `/api/admin/players/${p.id}`, formData(f)), "Fiche mise à jour"); };
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
    `${isStaff() ? '<div class="bar"><button class="btn small" id="addFac">Créer une faction</button></div>' : ""}
    <div class="fac-grid">${list.map(facCard).join("") || '<p class="empty">Aucune faction.</p>'}</div>`);
  if (isStaff()) $("addFac").onclick = () => { const n = prompt("Nom de la nouvelle faction :"); if (n) act(() => call("POST", "/api/factions", { name: n.trim() }), "Faction créée"); };
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
  return u ? `<span class="chip u-${u.taille}"${c.projet_faction_id ? ' title="Débloquée par un projet communautaire"' : ""}>${c.projet_faction_id ? "★ " : ""}${esc(u.nom)}</span>` : "";
}
function facCard(f) {
  const ms = members(f.id);
  const ok = ms.length >= 3 && ms.length <= 8;
  const ch = D.choix.filter((c) => c.faction_id === f.id);
  const pr = (D.realises || []).filter((r) => r.faction_id === f.id);
  const bases = D.bases.filter((b) => b.faction_id === f.id);
  const mine = me() && me().faction_id === f.id;
  const showBases = isStaff() || mine;
  const row = (l, v) => (v ? `<dt>${l}</dt><dd>${esc(v)}</dd>` : "");
  return `<article class="card fac${mine ? " mine" : ""}" id="fac-${f.id}">
    <header><h3>${esc(f.name)}${mine ? ' <span class="chip ok">Ma faction</span>' : ""}</h3><span class="chip ${ok ? "ok" : "warn"}">${ms.length}/8 · ${ok ? "valide" : ms.length < 3 ? "3 minimum" : "trop de joueurs"}</span></header>
    <p class="members">${ms.map((p) => `<span>${esc(p.mc_name)}</span>`).join("") || '<span class="muted">Aucun membre</span>'}</p>
    <dl>${row("Thème", f.theme)}${row("Hub et usines prévues", f.hub)}${row("Projet communautaire prévu", f.projet_commu)}${row("Autres projets", f.autres_projets)}${row("Recrutement", f.recrutement)}
      ${f.tirage ? `<dt>Tirage des usines</dt><dd>${f.tirage}ᵉ</dd>` : ""}
      ${ch.length ? `<dt>Usines</dt><dd>${ch.map(usineChip).join(" ")}</dd>` : ""}
      ${pr.length ? `<dt>Projets réalisés</dt><dd>${pr.map((r) => `<span class="chip">${esc((projet(r.projet_id) || {}).nom || "?")}</span>`).join(" ")}</dd>` : ""}</dl>
    ${showBases ? `<details class="bases"><summary>Coordonnées (${bases.length})</summary>
      <table class="mini"><tbody>${bases.map((b) => `<tr><td>${esc({ hub: "Hub", usine: "Usine", base: "Base" }[b.type])}</td><td>${esc(b.nom)}</td>
        <td class="num">${b.x ?? "?"} / ${b.y ?? "?"} / ${b.z ?? "?"}</td>
        <td>${canEditFac(f.id) ? `<button class="x" data-base-del="${b.id}" aria-label="Supprimer">✕</button>` : ""}</td></tr>`).join("") || '<tr><td class="muted">Aucune coordonnée.</td></tr>'}</tbody></table>
      ${canEditFac(f.id) ? `<form class="inline coords" data-base-add="${f.id}"><select name="type" aria-label="Type"><option value="base">Base</option><option value="hub">Hub</option><option value="usine">Usine</option></select>
        <input name="nom" placeholder="Nom" maxlength="80" aria-label="Nom"><input name="x" type="number" placeholder="X" required aria-label="X"><input name="y" type="number" placeholder="Y" aria-label="Y"><input name="z" type="number" placeholder="Z" required aria-label="Z">
        <button class="btn small">Ajouter</button></form>` : ""}</details>` : ""}
    ${canEditFac(f.id) ? `<div class="actions"><button class="btn small ghost" data-fac-edit="${f.id}">Modifier</button>${isStaff() ? `<button class="btn small danger" data-fac-del="${f.id}">Supprimer</button>` : ""}</div>` : ""}
  </article>`;
}
function facEdit(fid) {
  const f = fac(fid);
  const card = $("fac-" + fid);
  card.innerHTML = `<form class="form compact"><h3>${esc(f.name)}</h3>
    ${isStaff() ? `<label>Nom<input name="name" value="${esc(f.name)}" maxlength="40"></label><label>Ordre au tirage<input name="tirage" type="number" min="1" value="${f.tirage ?? ""}"></label>` : ""}
    <label class="wide">Thème<textarea name="theme" rows="2">${esc(f.theme)}</textarea></label>
    <label class="wide">Hub et usines prévues<textarea name="hub" rows="2">${esc(f.hub)}</textarea></label>
    <label class="wide">Projet communautaire prévu<textarea name="projet_commu" rows="2">${esc(f.projet_commu)}</textarea></label>
    <label class="wide">Autres projets<textarea name="autres_projets" rows="2">${esc(f.autres_projets)}</textarea></label>
    <label class="wide">Recrutement (contact)<input name="recrutement" value="${esc(f.recrutement)}"></label>
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
        <li><b>Ouvre un ticket sur Discord</b> en indiquant le projet et l'usine souhaitée.</li>
        <li><b>Le staff valide</b> : le projet et l'usine apparaissent ici et sur la fiche de ta faction.</li>
      </ol>
      <p class="small muted">Règles : un projet <b>unique</b> ne peut être fait que par une seule faction sur tout le serveur. Les autres : une fois par faction. L'organisation d'un évènement n'a pas de limite.</p>
    </div>
    ${isStaff() ? projetStaffForm() : ""}
    <div class="tbl-wrap"><table class="tbl left projets"><thead><tr><th>Projet</th><th>Usine débloquée</th><th>Règle</th><th>Réalisé par</th>${myF ? "<th>Pour ma faction</th>" : ""}</tr></thead><tbody>
    ${P.map((pr) => {
      const done = byP(pr.id), c = can(pr);
      return `<tr><td><b>${esc(pr.nom)}</b></td><td>${esc(taillesTxt(pr.tailles))}</td><td>${reglesProjet(pr)}</td>
        <td>${done.map((r) => `<span class="chip${r.faction_id === myF ? " ok" : ""}" title="${esc(r.note || "")}">${esc(facName(r.faction_id))}${r.usine_id ? ` → ${esc((usine(r.usine_id) || {}).nom || "")}` : ""}</span>`).join(" ") || '<span class="muted">—</span>'}
          ${isStaff() ? done.map((r) => `<button class="x" data-pf-del="${r.id}" title="Retirer ce projet de ${esc(facName(r.faction_id))}" aria-label="Retirer">✕</button>`).join("") : ""}</td>
        ${myF ? `<td>${c === true ? '<span class="chip ok">Disponible</span>' : pr.unique_srv ? '<span class="chip muted">Déjà pris</span>' : '<span class="chip muted">Déjà fait</span>'}</td>` : ""}</tr>`;
    }).join("") || '<tr><td colspan="5" class="empty">Aucun projet.</td></tr>'}</tbody></table></div>
    ${isStaff() ? projetListEditor() : ""}`);
  bindProjets();
}
function projetStaffForm() {
  return `<form id="pfForm" class="card form compact"><h3>Valider un projet (après le ticket)</h3>
    <label>Projet<select name="projet_id" id="pfProjet" required><option value="">— choisir —</option>${(D.projets || []).map((pr) => `<option value="${pr.id}">${esc(pr.nom)} (${esc(taillesTxt(pr.tailles))})</option>`).join("")}</select></label>
    <label>Faction<select name="faction_id" required>${facOpts(null, "— choisir —")}</select></label>
    <label>Usine débloquée<select name="usine_id" id="pfUsine"><option value="">Choisis d'abord le projet</option></select></label>
    <label>Note (n° de ticket…)<input name="note" maxlength="500" placeholder="Ticket #123"></label>
    <div class="wide actions"><button class="btn small">Valider le projet</button><span class="muted small">Les règles (unique, 1 fois par faction) sont vérifiées.</span></div></form>`;
}
function projetListEditor() {
  return `<details class="card"><summary>Modifier la liste des projets</summary>
    <div class="tbl-wrap"><table class="tbl left edit"><thead><tr><th>Nom</th><th>Usine</th><th>Unique</th><th>Sans limite</th><th></th></tr></thead><tbody>
    ${(D.projets || []).map((pr) => `<tr data-pr="${pr.id}"><td><input name="nom" value="${esc(pr.nom)}"></td>
      <td>${["moyenne", "petite", "grosse"].map((t) => `<label class="chk"><input type="checkbox" name="t_${t}"${pr.tailles.split(",").includes(t) ? " checked" : ""}> ${t}</label>`).join(" ")}</td>
      <td><input type="checkbox" name="unique_srv"${pr.unique_srv ? " checked" : ""} aria-label="Unique"></td><td><input type="checkbox" name="illimite"${pr.illimite ? " checked" : ""} aria-label="Sans limite"></td>
      <td><button type="button" class="btn small ghost" data-pr-save="${pr.id}">Enregistrer</button> <button type="button" class="x" data-pr-del="${pr.id}" aria-label="Supprimer">✕</button></td></tr>`).join("")}
    </tbody></table></div>
    <div class="actions"><button type="button" class="btn small ghost" id="prAdd">Ajouter un projet</button></div></details>`;
}
function bindProjets() {
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
    act(() => call("PUT", `/api/projets/${b.dataset.prSave}`, { nom: v("nom").value,
      tailles: ["grosse", "moyenne", "petite"].filter((t) => v("t_" + t).checked).join(","), unique_srv: v("unique_srv").checked, illimite: v("illimite").checked }), "Projet enregistré");
  }));
  document.querySelectorAll("[data-pr-del]").forEach((b) => (b.onclick = () => confirm("Supprimer ce projet de la liste ?") && act(() => call("DELETE", `/api/projets/${b.dataset.prDel}`), "Projet supprimé")));
  const add = $("prAdd");
  if (add) add.onclick = () => { const n = prompt("Nom du nouveau projet :"); if (n) act(() => call("POST", "/api/projets", { nom: n.trim(), tailles: "petite" }), "Projet ajouté"); };
}

/* ---------- Usines ---------- */
function usines() {
  const myFid = isStaff() ? staffFaction : me() && me().faction_id;
  const open = D.settings.usines_ouvertes === "1";
  const mine = myFid ? D.choix.filter((c) => c.faction_id === myFid && !c.projet_faction_id).length : 0;
  view(head("Usines", "Résultats du tirage et places restantes. ★ = usine débloquée par un projet communautaire.") + `<div class="card">
      <p><b>Règles :</b> chaque faction choisit 1 grosse + 1 moyenne + 1 petite, ou 2 moyennes + 1 petite, ou 3 petites
      (${esc(D.settings.usines_max || 3)} usines au total pour ce tour), dans l'ordre du tirage. Chaque usine est limitée sur le serveur : 3 grosses, 4 moyennes, 5 petites du même type.</p>
      <p>${open ? '<span class="chip ok">Choix ouverts</span>' : '<span class="chip warn">Choix fermés</span>'}
      ${isStaff() ? `<label class="chk">Agir pour la faction <select id="usFac">${facOpts(staffFaction, "— choisir —")}</select></label>` : ""}
      ${myFid ? `<span class="muted">${esc(facName(myFid))} : ${plural(mine, "usine choisie", "usines choisies")} au tirage</span>` : ""}</p>
    </div>
    ${tirageTable(myFid)}
    <details class="all-usines"${open || isStaff() ? " open" : ""}><summary>Toutes les usines et places restantes</summary>
    ${Object.entries(TAILLE_USINE).map(([t, [label, max]]) => `<h3 class="sec">${label} <small>${max} max par usine sur le serveur</small></h3>
      <div class="usines">${D.usines.filter((u) => u.taille === t).map((u) => {
        const takers = D.choix.filter((c) => c.usine_id === u.id);
        const has = myFid && takers.some((c) => c.faction_id === myFid);
        const fromProjet = myFid && takers.some((c) => c.faction_id === myFid && c.projet_faction_id);
        const full = takers.length >= max;
        const can = myFid && canEditFac(myFid) && (open || isStaff()) && !fromProjet;
        return `<div class="usine${has ? " has" : ""}${full ? " full" : ""}"><div><b>${esc(u.nom)}</b>
          <span class="muted small">${takers.length}/${max}</span></div>
          <div class="takers">${takers.map((c) => `<span class="chip">${c.projet_faction_id ? "★ " : ""}${esc(facName(c.faction_id))}</span>`).join("")}</div>
          ${can ? `<button class="btn small ${has ? "ghost" : ""}" data-us="${u.id}" data-on="${has ? 0 : 1}"${!has && !isStaff() && (full || mine >= (+D.settings.usines_max || 3)) ? " disabled" : ""}>${has ? "Retirer" : "Choisir"}</button>` : ""}</div>`;
      }).join("")}</div>`).join("")}</details>`);
  if (isStaff()) $("usFac").onchange = (e) => { staffFaction = e.target.value ? +e.target.value : null; usines(); };
  document.querySelectorAll("[data-us]").forEach((b) => (b.onclick = () =>
    act(() => call("POST", `/api/factions/${myFid}/usines`, { usine_id: +b.dataset.us, on: b.dataset.on === "1" }), b.dataset.on === "1" ? "Usine choisie" : "Usine retirée")));
}
function tirageTable(myFid) {
  const fs = [...D.factions].sort((a, b) => (a.tirage ?? 999) - (b.tirage ?? 999) || a.name.localeCompare(b.name));
  const cell = (fid, t) => D.choix.filter((c) => c.faction_id === fid && (usine(c.usine_id) || {}).taille === t).map(usineChip).join(" ") || '<span class="muted">—</span>';
  return `<div class="card"><h3>Résultats du tirage</h3>
    <div class="tbl-wrap"><table class="tbl left tirage"><thead><tr><th>Ordre</th><th>Faction</th><th>Grosse</th><th>Moyenne</th><th>Petite</th></tr></thead><tbody>
    ${fs.map((f) => `<tr${f.id === myFid ? ' class="mine"' : ""}><td>${f.tirage ? f.tirage + "ᵉ" : "–"}</td><td><b>${esc(f.name)}</b></td>
      <td>${cell(f.id, "grosse")}</td><td>${cell(f.id, "moyenne")}</td><td>${cell(f.id, "petite")}</td></tr>`).join("")}</tbody></table></div></div>`;
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
  view(head("Élection du maire", `<span class="chip">${esc(ELECTION[st])}</span>${tour ? " Un vote par compte et par tour ; tu peux changer ton vote tant que le tour est ouvert. Le vote est secret." : ""}`) + `
    ${st === "candidatures" && canWrite() && p ? candForm(mine) : ""}
    <div class="cards">${shown.map((c) => {
      const voted = tour && D.myVotes[tour] === c.id;
      return `<article class="pcard${voted ? " mine" : ""}"><header>${face(c.mc_name)}
        <div><b>${esc(c.mc_name)}</b>${c.tour2 ? '<span class="chip ok">2nd tour</span>' : ""}</div></header>
        ${para(c.resume)}
        <p class="links">${c.lien ? `<a href="${esc(c.lien)}" target="_blank" rel="noopener noreferrer nofollow">Programme</a>` : ""}
          ${c.affiche ? `<a href="${esc(c.affiche)}" target="_blank" rel="noopener noreferrer nofollow">Affiche</a>` : ""}</p>
        ${D.results ? `<p class="small">1er tour : <b>${res(c.id, 1)}</b> / ${total(1)}${c.tour2 ? ` · 2nd tour : <b>${res(c.id, 2)}</b> / ${total(2)}` : ""}</p>` : ""}
        <div class="actions">${tour && canWrite() && p ? `<button class="btn small${voted ? " ghost" : ""}" data-vote="${c.id}">${voted ? "Ton vote ✓" : "Voter"}</button>` : ""}
          ${isStaff() ? `<label class="chk"><input type="checkbox" data-t2="${c.id}"${c.tour2 ? " checked" : ""}> Qualifié 2nd tour</label>
          <button class="btn small danger" data-cdel="${c.id}">Retirer</button>` : ""}</div></article>`;
    }).join("") || '<p class="empty">Aucun candidat pour l\'instant.</p>'}</div>`);
  const cf = $("candForm");
  if (cf) cf.onsubmit = (e) => { e.preventDefault(); act(() => mine ? call("PUT", `/api/candidats/${mine.id}`, formData(cf)) : call("POST", "/api/candidats", formData(cf)), "Candidature enregistrée"); };
  const cw = $("candWithdraw");
  if (cw) cw.onclick = () => confirm("Retirer ta candidature ?") && act(() => call("DELETE", `/api/candidats/${mine.id}`), "Candidature retirée");
  document.querySelectorAll("[data-vote]").forEach((b) => (b.onclick = () => act(() => call("POST", "/api/votes", { candidat_id: +b.dataset.vote }), "Vote enregistré")));
  document.querySelectorAll("[data-t2]").forEach((b) => (b.onchange = () => act(() => call("PUT", `/api/candidats/${b.dataset.t2}`, { tour2: b.checked }))));
  document.querySelectorAll("[data-cdel]").forEach((b) => (b.onclick = () => confirm("Retirer ce candidat ?") && act(() => call("DELETE", `/api/candidats/${b.dataset.cdel}`), "Candidat retiré")));
}
function candForm(c) {
  return `<form id="candForm" class="card form"><h3>${c ? "Ma candidature" : "Me présenter"}</h3>
    <label class="wide">Résumé du programme<textarea name="resume" rows="4" maxlength="2000">${esc(c && c.resume)}</textarea></label>
    <label>Lien vers le programme<input name="lien" type="url" placeholder="https://…" value="${esc(c && c.lien)}"></label>
    <label>Lien vers l'affiche<input name="affiche" type="url" placeholder="https://…" value="${esc(c && c.affiche)}"></label>
    <div class="wide actions"><button class="btn">${c ? "Mettre à jour" : "Déposer ma candidature"}</button>${c ? '<button type="button" class="btn ghost danger" id="candWithdraw">Retirer</button>' : ""}</div></form>`;
}

/* ---------- Prix du FISC ---------- */
function prix() {
  const h = head("Prix du FISC", "Ce que le FISC paie, en suméniens, pour chaque minerai brut.");
  if (!isStaff()) {
    return view(h + `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Minerai</th><th>Roche</th><th>Prix (suméniens)</th></tr></thead><tbody>
      ${D.prix.map((r) => `<tr><td>${esc(r.minerai)}</td><td>${esc(r.roche)}</td><td>${fmt(r.prix)}</td></tr>`).join("")}</tbody></table></div>`);
  }
  const line = (r) => `<tr data-id="${r.id || ""}"><td><input name="minerai" value="${esc(r.minerai)}" aria-label="Minerai"></td><td><input name="roche" value="${esc(r.roche)}" aria-label="Roche"></td>
    <td><input name="prix" type="number" step="0.01" min="0" value="${r.prix ?? ""}" aria-label="Prix"></td><td><button type="button" class="x" aria-label="Supprimer la ligne">✕</button></td></tr>`;
  view(h + `<form id="prixForm"><div class="tbl-wrap"><table class="tbl edit"><thead><tr><th>Minerai</th><th>Roche</th><th>Prix</th><th></th></tr></thead>
    <tbody id="prixBody">${D.prix.map(line).join("")}</tbody></table></div>
    <div class="actions"><button type="button" class="btn small ghost" id="prixAdd">Ajouter une ligne</button><button class="btn small">Enregistrer les prix</button></div></form>`);
  const body = $("prixBody");
  body.onclick = (e) => { if (e.target.closest(".x")) e.target.closest("tr").remove(); };
  $("prixAdd").onclick = () => body.insertAdjacentHTML("beforeend", line({ minerai: "", roche: "", prix: "" }));
  $("prixForm").onsubmit = (e) => {
    e.preventDefault();
    const rows = [...body.querySelectorAll("tr")].map((tr) => ({ id: +tr.dataset.id || null,
      minerai: tr.querySelector('[name="minerai"]').value, roche: tr.querySelector('[name="roche"]').value, prix: tr.querySelector('[name="prix"]').value }));
    act(() => call("PUT", "/api/prix", { rows }), "Prix enregistrés");
  };
}

/* ---------- Staff ---------- */
// Suggestion de pseudo whitelisté proche (fautes de frappe, majuscules, _ ajoutés…)
const norm = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
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
  const tailles = D.players.filter((p) => p.taille_cm).map((p) => ({ p, sc: scaleOf(p.taille_cm) }));
  const todo = tailles.filter(({ p, sc }) => p.taille_appliquee == null || Math.abs(p.taille_appliquee - sc) >= 0.0005);
  const aWl = D.wlSynced ? D.players.filter((p) => !p.whitelisted).sort((a, b) => ficheOk(b) - ficheOk(a) || a.mc_name.localeCompare(b.mc_name)) : [];
  const nav = [["st-wl", `À whitelister (${aWl.filter(ficheOk).length})`], ["st-taille", `Tailles RP (${todo.length})`], ["st-bordure", "Bordure"], ["st-reglages", "Réglages"], ["st-import", "Import"], ["st-histo", "Historique"]];
  view(head("Outils staff", "Whitelist, tailles RP, bordure, réglages et historique de toutes les modifications.") +
    `<nav class="anchors">${nav.map(([id, l]) => `<a href="#" data-jump="${id}">${l}</a>`).join("")}</nav>
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
      }).join("") || '<tr><td colspan="5" class="empty">Aucune taille renseignée.</td></tr>'}</tbody></table></div></section>
    <section class="card" id="st-bordure"><h3>Bordure après un changement de multiplicateur</h3><div id="borderTool"><p class="empty">Chargement…</p></div></section>
    <section class="card form" id="st-reglages"><h3>Réglages</h3>
      <label>Élection<select id="setElection">${opt(ELECTION, s.election)}</select></label>
      <label>Choix d'usines<select id="setUsOpen"><option value="1"${s.usines_ouvertes === "1" ? " selected" : ""}>Ouverts</option><option value="0"${s.usines_ouvertes !== "1" ? " selected" : ""}>Fermés</option></select></label>
      <label>Usines max par faction<input id="setUsMax" type="number" min="1" max="20" value="${esc(s.usines_max || 3)}"></label>
      <div class="wide actions"><button class="btn small" id="saveSettings">Enregistrer les réglages</button></div></section>
    <section class="card" id="st-import"><h3>Importer le Google Sheet</h3>
      <p class="muted small">Fichier JSON produit par <code>tools/import_sheet.py</code>. L'import ajoute ce qui manque et complète les champs vides, sans rien écraser.</p>
      <input type="file" id="importFile" accept="application/json,.json"></section>
    <section class="card" id="st-histo"><h3>Historique</h3><p class="muted small">Chaque modification est enregistrée. « Annuler » remet les valeurs d'avant.</p>
      <div id="auditList" class="audit-scroll"><p class="empty">Chargement…</p></div><button class="btn small ghost" id="auditMore" hidden>Plus ancien</button></section>`);
  document.querySelectorAll("[data-jump]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); $(a.dataset.jump).scrollIntoView({ behavior: "smooth", block: "start" }); }));
  $("saveSettings").onclick = () => act(() => call("PUT", "/api/admin/settings",
    { election: $("setElection").value, usines_ouvertes: $("setUsOpen").value, usines_max: $("setUsMax").value }), "Réglages enregistrés");
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
async function show(s) {
  if (s && SUBS.some(([k]) => k === s)) sub = s;
  if (!started) {
    started = true;
    render();
    if (!LIVE) return;
    try { const r = await call("GET", "/api/me"); ME = r.user; }
    catch (e) { ME = null; }
    if (ME) { try { await reload(); } catch (e) { toast(e.message, true); } return; }
  }
  render();
  // les autres joueurs ont pu modifier des choses : on relit à chaque changement d'onglet
  if (ME && !busy) reload().catch((e) => toast(e.message, true));
}
window.Espace = { show };
})();
