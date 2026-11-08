/* Trophées : une tête de joueur à chaque mort (mod Suménium Economy 2.10.0).
   Données : trophees.json (export du mod) et icons/deaths_fr.json (messages de mort du jeu en français). */
(() => {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  const norm = (s) => String(s || "").toLowerCase();
  const JOUR = 24000;
  const TIERS = [
    ["PRISMATIQUE", "Prismatique"], ["LEGENDAIRE", "Légendaire"], ["EPIQUE", "Épique"],
    ["RARE", "Rare"], ["PEU_COMMUNE", "Peu commune"], ["COMMUNE", "Commune"],
  ];
  const TIER = Object.fromEntries(TIERS);
  const RANK = Object.fromEntries(TIERS.map(([k], i) => [k, TIERS.length - i]));
  const CAUSE = {
    fall: "Chute", lava: "Lave", drown: "Noyade", inFire: "Flammes", onFire: "Brûlure", outOfWorld: "Vide", starve: "Faim",
    genericKill: "/kill", explosion: "Explosion", "explosion.player": "Explosion", magic: "Magie", indirectMagic: "Magie", wither: "Effet de Wither",
    anvil: "Enclume", fallingBlock: "Bloc tombé", lightningBolt: "Foudre", freeze: "Gel", cactus: "Cactus",
    sweetBerryBush: "Buisson de baies", hotFloor: "Bloc de magma", inWall: "Étouffement", cramming: "Entassement",
    flyIntoWall: "Choc en élytres", fallingStalactite: "Stalactite", stalagmite: "Stalagmite", dryout: "Déshydratation",
    generic: "Mort", fireworks: "Feu d'artifice", badRespawnPoint: "Lit ou ancre explosive", thorns: "Épines", dragonBreath: "Souffle du dragon",
    campfire: "Feu de camp", enderPearl: "Perle de l'Ender", mace_smash: "Masse", outsideBorder: "Hors de la bordure",
  };
  let DATA = null, LANG = null, BEST = null, loading = null, bestLoading = null;

  function load() {
    if (loading) return loading;
    loading = Promise.all([
      fetch("trophees.json?t=" + Math.floor(Date.now() / 60000)).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("icons/deaths_fr.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]).then(([d, l]) => { DATA = d; LANG = l || {}; return DATA; });
    return loading;
  }

  const tr = (k) => (LANG && LANG[k]) || k.split(".").pop().replace(/_/g, " ");
  function arg(a) {
    if (typeof a === "string" && a.startsWith("§t:")) return tr(a.slice(3));
    return a;
  }
  /** Message de mort en français, comme dans le jeu. */
  function message(t) {
    if (!t.msgKey) return esc(t.msgText || "Mort");
    const tpl = (LANG && LANG[t.msgKey]) || t.msgKey;
    const args = (t.msgArgs || []).map(arg);
    let i = 0;
    return esc(tpl).replace(/%(?:(\d+)\$)?s/g, (_, n) => {
      const v = args[n ? Number(n) - 1 : i++];
      return v == null ? "" : `<b>${esc(v)}</b>`;
    });
  }
  function causeLabel(key) {
    if (key === "pvp") return "Tué par un joueur";
    if (key.startsWith("mob:")) return "Tué par : " + tr("entity." + key.slice(4).replace(":", "."));
    const id = key.replace(/^type:/, "");
    return CAUSE[id] || id;
  }
  function survie(ticks) {
    const j = Math.floor((ticks || 0) / JOUR), h = Math.floor((ticks || 0) / 72000);
    return `${fmt(j)} jour${j > 1 ? "s" : ""}${h ? ` · ${fmt(h)} h de jeu` : ""}`;
  }
  const head = (n, s = 40) => `<img class="face" src="heads/${encodeURIComponent(norm(n))}.png" data-n="${esc(n)}" data-s="${s}" onerror="headFail(this)" alt="" width="${s}" height="${s}" loading="lazy">`;
  const plink = (n) => `<a href="#communaute/joueur/${encodeURIComponent(n)}">${esc(n)}</a>`;
  const date = (t) => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

  function card(t, showName = true) {
    return `<article class="troph tr-${esc(t.tier)}">
      ${head(t.name, 44)}
      <div class="tr-body">
        <p class="tr-top"><span class="tr-title">Tête de ${showName ? plink(t.name) : esc(t.name)}</span><span class="tr-tier">${esc(TIER[t.tier] || t.tier)}</span></p>
        <p class="tr-msg">${message(t)}</p>
        <p class="tr-meta">Jour ${fmt(t.jour)} · ${date(t.t)} · a survécu ${survie(t.survie)}</p>
        ${(t.raisons || []).length ? `<p class="tr-why">${t.raisons.map(esc).join(" · ")}</p>` : ""}
      </div>
      <span class="tr-n" title="Numéro du trophée">n° ${fmt(t.id)}</span>
    </article>`;
  }
  const byRarity = (a, b) => (RANK[b.tier] || 0) - (RANK[a.tier] || 0) || b.points - a.points || b.t - a.t;
  const empty = (msg) => `<p class="empty">${msg}</p>`;
  const NONE = "Aucun trophée pour l'instant : la première tête tombera à la prochaine mort.";

  function counts(list) {
    const c = {};
    for (const t of list) c[t.tier] = (c[t.tier] || 0) + 1;
    return TIERS.filter(([k]) => c[k]).map(([k, l]) => `<span class="tr-chip tr-${k}">${fmt(c[k])} ${esc(l)}</span>`).join("");
  }

  function rows(list, fmtv, hl) {
    if (!list.length) return empty("Personne pour l'instant.");
    let rank = 0, prev = null;
    return `<ol class="tr-rank">${list.map(([n, v], i) => {
      if (v !== prev) rank = i + 1;
      prev = v;
      return `<li class="${hl && norm(hl) === norm(n) ? "cur" : ""}"><span class="r">${rank}</span>${head(n, 20)}${plink(n)}<b>${fmtv(v)}</b></li>`;
    }).join("")}</ol>`;
  }

  /** Vitrine d'un joueur (fiche, Mon espace). */
  async function mount(el, name) {
    if (!el) return;
    el.innerHTML = empty("Chargement des trophées…");
    const d = await load();
    if (!d) { el.innerHTML = empty("Trophées indisponibles pour le moment."); return; }
    const mine = d.trophees.filter((t) => norm(t.name) === norm(name)).sort(byRarity);
    const kills = d.trophees.filter((t) => t.killer && norm(t.killer) === norm(name)).sort(byRarity);
    const live = Object.entries(d.survies || {}).find(([n]) => norm(n) === norm(name));
    const next = live ? (d.seuils || []).find((s) => s > live[1] / JOUR) : null;
    el.innerHTML = `
      <div class="tr-head">
        <div><h3>Trophées de ${esc(name)}</h3><p class="sub2">Une tête tombe à chaque mort : la cause, le jour et le temps de survie y sont gravés. Plus la mort est rare, plus la tête brille.</p></div>
        ${live ? `<div class="tr-live"><span>Survie en cours</span><b>${survie(live[1])}</b>${next ? `<small>Prochain palier : ${fmt(next)} jours</small>` : ""}</div>` : ""}
      </div>
      ${mine.length ? `<p class="tr-chips">${counts(mine)}</p><div class="troph-grid">${mine.map((t) => card(t, false)).join("")}</div>` : empty("Aucune tête pour l'instant : pas encore mort depuis l'arrivée des trophées.")}
      ${kills.length ? `<h3 class="sec">Têtes gagnées au combat <small>${fmt(kills.length)}</small></h3><div class="troph-grid">${kills.map((t) => card(t)).join("")}</div>` : ""}
      <div class="tr-mobs"></div>`;
    mountMobs(el.querySelector(".tr-mobs"), name);
  }

  /** Classements › Trophées. */
  async function hall(el) {
    if (!el) return;
    el.innerHTML = empty("Chargement des trophées…");
    const d = await load();
    if (!d) { el.innerHTML = empty("Trophées indisponibles pour le moment."); return; }
    const all = d.trophees.slice();
    const top = all.filter((t) => RANK[t.tier] >= RANK.EPIQUE).sort(byRarity).slice(0, 12);
    const recent = all.slice().sort((a, b) => b.t - a.t).slice(0, 8);
    const live = Object.entries(d.survies || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const best = {};
    for (const t of all) best[t.name] = Math.max(best[t.name] || 0, t.survie || 0);
    const longest = Object.entries(best).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const coll = {};
    for (const t of all) coll[t.name] = (coll[t.name] || 0) + Math.max(0, (RANK[t.tier] || 1) - 1);
    const collectors = Object.entries(coll).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const total = d.total || 0;
    const causes = Object.entries(d.causes || {}).filter(([k]) => k !== "type:genericKill").sort((a, b) => a[1] - b[1]);
    const seuils = (d.seuils || []).map((s, i) => `<b>${fmt(s)} j</b> +${i + 1}`).join(" · ");
    el.innerHTML = `
      <div class="sec-head"><h3>Trophées</h3><p class="sub2">À chaque mort, une tête du joueur tombe avec la cause, le jour de la saison et le temps de survie. Sa rareté vient de points qui s'additionnent : tué par un joueur +2, par un boss +4, cause rare sur le serveur +1 à +3, longue survie ${seuils || "+1 à +4"} (1 jour = 20 min de jeu, sans l'AFK). Les têtes de mobs sont dans le <a href="#classements/bestiaire">Bestiaire</a>.</p></div>
      <p class="tr-chips">${TIERS.slice().reverse().map(([k, l]) => `<span class="tr-chip tr-${k}">${esc(l)}</span>`).join("")}</p>
      <h3 class="sec">Les plus rares</h3>
      ${top.length ? `<div class="troph-grid">${top.map((t) => card(t)).join("")}</div>` : empty(all.length ? "Aucune tête épique ou mieux pour l'instant." : NONE)}
      <div class="boards boards-3">
        <div class="board"><h3>Survies en cours</h3><p class="sub2">Temps de jeu depuis la dernière mort.</p>${rows(live, (v) => `${fmt(Math.floor(v / JOUR))} j`)}</div>
        <div class="board"><h3>Plus longues survies</h3><p class="sub2">Avant une mort, depuis l'arrivée des trophées.</p>${rows(longest, (v) => `${fmt(Math.floor(v / JOUR))} j`)}</div>
        <div class="board"><h3>Collectionneurs</h3><p class="sub2">Points de rareté de leurs têtes (peu commune 1, rare 2… prismatique 5).</p>${rows(collectors, (v) => fmt(v))}</div>
      </div>
      <h3 class="sec">Dernières têtes</h3>
      ${recent.length ? `<div class="troph-grid">${recent.map((t) => card(t)).join("")}</div>` : empty(NONE)}
      <h3 class="sec">Causes de mort <small>${fmt(total)} morts</small></h3>
      <p class="sub2">Une cause sous 5 % des morts donne +1, sous 1 % +2, et la toute première +3${d.trophees.length && total < 150 ? " (à partir de 150 morts comptées)" : ""}.</p>
      ${causes.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Cause</th><th>Morts</th><th>Part</th></tr></thead><tbody>${causes.map(([k, n]) => {
        const p = total ? n / total : 0;
        const bonus = k === "pvp" ? "" : p < 0.01 ? ' <span class="tr-chip tr-RARE">+2</span>' : p < 0.05 ? ' <span class="tr-chip tr-PEU_COMMUNE">+1</span>' : "";
        return `<tr><td>${esc(causeLabel(k))}${bonus}</td><td>${fmt(n)}</td><td>${(p * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %</td></tr>`;
      }).join("")}</tbody></table></div>` : empty("Aucune mort comptée pour l'instant.")}`;
  }


  /* ---------------- Bestiaire (têtes de mobs) ---------------- */
  function loadBest() {
    if (bestLoading) return bestLoading;
    bestLoading = Promise.all([load(),
      fetch("bestiaire.json?t=" + Math.floor(Date.now() / 60000)).then((r) => (r.ok ? r.json() : null)).catch(() => null)])
      .then(([, b]) => { BEST = b; return BEST; });
    return bestLoading;
  }
  const mobName = (e) => (e.e ? tr("entity.minecraft." + e.e) + (e.s || "") : e.en);
  const groupName = (e) => (e.secret ? "Têtes secrètes" : e.e ? tr("entity.minecraft." + e.e) : e.en);
  const mobImg = (e, s = 40) => `<img class="mob-ico" src="heads/mob/${esc(e.hash)}.png" alt="" width="${s}" height="${s}" loading="lazy" onerror="this.style.visibility='hidden'">`;
  const pct = (x) => (x * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " %";

  /** Statistiques par tête : meilleure rareté, nombre, premier à l'avoir, pour tous ou un joueur. */
  function index(b, who) {
    const by = {};
    for (const o of b.obtentions || []) {
      if (who && norm(o.name) !== norm(who)) continue;
      const x = (by[o.hash] = by[o.hash] || { n: 0, best: null, first: null, tiers: {} });
      x.n += o.n || 1;
      x.tiers[o.tier] = (x.tiers[o.tier] || 0) + (o.n || 1);
      if (!x.best || RANK[o.tier] > RANK[x.best]) x.best = o.tier;
      if (!x.first || o.t < x.first.t) x.first = o;
    }
    return by;
  }

  function mobTile(e, st, showSecret) {
    const has = !!st;
    const hidden = e.secret && !has && !showSecret;
    const tiers = has ? TIERS.filter(([k]) => st.tiers[k]).map(([k, l]) => `${l} ×${fmt(st.tiers[k])}`).join(", ") : "";
    const title = hidden ? "Tête secrète : trouvez le mob qui la porte…"
      : `${mobName(e)} · rareté de base ${TIER[e.base]}${has ? ` · obtenue ${fmt(st.n)} fois (${tiers}) · première par ${st.first.name || "?"} le ${date(st.first.t)}` : " · pas encore obtenue"}`;
    return `<div class="mob ${has ? "tr-" + esc(st.best) + " got" : "miss"}" title="${esc(title)}">
      ${hidden ? '<span class="mob-ico mob-q">?</span>' : mobImg(e)}
      <span class="mob-n">${hidden ? "???" : esc(mobName(e))}</span>
      <span class="mob-t">${has ? `<b class="tr-c">${esc(TIER[st.best])}</b>${st.n > 1 ? ` ×${fmt(st.n)}` : ""}` : `<span class="muted">${esc(TIER[e.base])}</span>`}</span>
    </div>`;
  }

  /** Classements › Bestiaire (et filtre sur un joueur). */
  async function bestiaire(el, who) {
    if (!el) return;
    el.innerHTML = empty("Chargement du bestiaire…");
    const b = await loadBest();
    const tirage = (b && b.tirage) || { plus1: 0.12, plus2: 0.025, plus3: 0.005 };
    const intro = `<div class="sec-head"><h3>Bestiaire</h3><p class="sub2">La collection des têtes de mobs du serveur. Chaque tête existe en plusieurs raretés : à toi de toutes les trouver.</p></div>
      <details class="card best-note"${b && (b.obtentions || []).length ? "" : " open"}><summary><b>Comment ça marche ?</b></summary>
        <ul class="join-list">
          <li><b>Une tête tombe</b> quand tu tues un mob <b>avec une arme Butin</b> (Butin I minimum ; Butin II et III donnent plus de chances). Chaque mob a sa chance, parfois minuscule (l'Enderman !).</li>
          <li><b>Sa rareté</b> part de la rareté de base du mob (une poule est commune, un Enderman rare, le Warden légendaire), puis un tirage peut la monter : <b>${pct(tirage.plus1)}</b> de chances de +1 cran, <b>${pct(tirage.plus2)}</b> de +2, <b>${pct(tirage.plus3)}</b> de +3. Une tête de cochon prismatique, ça existe…</li>
          <li><b>Les têtes s'empilent</b> par mob et par rareté. Elles sont <b>indestructibles</b> au sol (feu, lave, explosions, cactus) et ne disparaissent jamais.</li>
          <li><b>Les têtes secrètes</b> (???) ne tombent que de mobs très particuliers. À vous de chercher.</li>
          <li><b>Tes anciennes têtes</b> de mobs : prends-les en main (une ou toute la pile) et tape <code>/tete convertir</code> pour les faire entrer au bestiaire, à la rareté de base du mob.</li>
          <li><b>Un musée ?</b> Accroupi + clic droit (main vide) sur une tête posée affiche une étiquette avec son nom et sa rareté (même geste pour la retirer). En regardant une tête posée ou dans un cadre, son détail s'affiche au-dessus de ta barre d'inventaire.</li>
        </ul>
        <p class="small muted">Les têtes des joueurs (une à chaque mort) sont dans <a href="#classements/trophees">Classements › Trophées</a>.</p>
      </details>`;
    if (!b || !(b.catalogue || []).length) { el.innerHTML = intro + empty("Le bestiaire s'affichera ici dès que le serveur l'aura envoyé (après la mise à jour du mod)."); return; }
    const cat = b.catalogue.slice();
    const all = index(b, null), mine = who ? index(b, who) : null;
    const st = mine || all;
    const players = [...new Set((b.obtentions || []).map((o) => o.name).filter(Boolean))].sort((x, y) => x.localeCompare(y, "fr"));
    const visible = cat.filter((e) => !e.secret), secrets = cat.filter((e) => e.secret);
    const got = visible.filter((e) => st[e.hash]).length, gotS = secrets.filter((e) => st[e.hash]).length;
    // collectionneurs : têtes différentes
    const per = {};
    for (const o of b.obtentions || []) if (o.name) (per[o.name] = per[o.name] || new Set()).add(o.hash);
    const coll = Object.entries(per).map(([n, s]) => [n, s.size]).sort((x, y) => y[1] - x[1]).slice(0, 10);
    const recent = (b.obtentions || []).filter((o) => o.src !== "conversion").slice(-10).reverse();
    const byHash = Object.fromEntries(cat.map((e) => [e.hash, e]));
    const rare = (b.obtentions || []).filter((o) => RANK[o.tier] >= RANK.LEGENDAIRE).slice(-8).reverse();
    const line = (o) => { const e = byHash[o.hash]; if (!e) return ""; const hid = e.secret;
      return `<li>${hid ? '<span class="mob-ico mob-q sm">?</span>' : mobImg(e, 22)}<span>${o.name ? plink(o.name) : "?"} · ${esc(hid ? "tête secrète" : mobName(e))}${o.n > 1 ? ` ×${fmt(o.n)}` : ""}</span><b class="tr-c tr-${esc(o.tier)}">${esc(TIER[o.tier])}</b></li>`; };
    // groupes par créature, dans l'ordre alphabétique français
    const groups = {};
    for (const e of visible) (groups[groupName(e)] = groups[groupName(e)] || []).push(e);
    const order = Object.keys(groups).sort((x, y) => x.localeCompare(y, "fr"));
    const q = (el.dataset.q || "").toLowerCase(), show = el.dataset.show || "toutes";
    const keep = (e) => (!q || (mobName(e) + " " + e.en).toLowerCase().includes(q)) && (show === "toutes" || (show === "obtenues") === !!st[e.hash]);
    const grid = order.map((g) => {
      const list = groups[g].filter(keep);
      if (!list.length) return "";
      const n = groups[g].filter((e) => st[e.hash]).length;
      return `<section class="mob-group"><h4>${esc(g)} <small>${fmt(n)}/${fmt(groups[g].length)}</small></h4><div class="mob-grid">${list.map((e) => mobTile(e, st[e.hash])).join("")}</div></section>`;
    }).join("");
    const sec = secrets.filter((e) => !q || (st[e.hash] && (mobName(e) + " " + e.en).toLowerCase().includes(q)));
    el.innerHTML = intro + `
      <div class="best-bar">
        <select id="bestWho" aria-label="Joueur"><option value="">Tout le serveur</option>${players.map((n) => `<option${norm(n) === norm(who) ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>
        <select id="bestShow" aria-label="Têtes affichées"><option value="toutes">Toutes les têtes</option><option value="obtenues"${show === "obtenues" ? " selected" : ""}>Obtenues</option><option value="manquantes"${show === "manquantes" ? " selected" : ""}>Manquantes</option></select>
        <input id="bestQ" type="search" placeholder="Chercher un mob…" value="${esc(el.dataset.q || "")}" aria-label="Chercher un mob">
      </div>
      <div class="stats best-stats">
        <div class="stat"><span>${who ? "Têtes de " + esc(who) : "Têtes trouvées"}</span><b>${fmt(got)} / ${fmt(visible.length)}</b><div class="best-prog"><i style="width:${visible.length ? (got / visible.length) * 100 : 0}%"></i></div></div>
        <div class="stat"><span>Têtes secrètes</span><b>${fmt(gotS)} / ${fmt(secrets.length)}</b></div>
        <div class="stat"><span>Têtes obtenues</span><b>${fmt(Object.values(st).reduce((a, x) => a + x.n, 0))}</b></div>
      </div>
      <div class="boards boards-3">
        <div class="board"><h3>Collectionneurs</h3><p class="sub2">Têtes de mobs différentes.</p>${rows(coll, (v) => fmt(v), who)}</div>
        <div class="board"><h3>Dernières têtes</h3>${recent.length ? `<ul class="best-list">${recent.map(line).join("")}</ul>` : empty("Aucune pour l'instant.")}</div>
        <div class="board"><h3>Légendaires et prismatiques</h3>${rare.length ? `<ul class="best-list">${rare.map(line).join("")}</ul>` : empty("Aucune pour l'instant. Le Warden est légendaire d'office…")}</div>
      </div>
      ${grid ? `<div class="mob-groups">${grid}</div>` : empty("Aucune tête ne correspond.")}
      ${sec.length ? `<div class="mob-groups"><section class="mob-group"><h4>Têtes secrètes <small>${fmt(gotS)}/${fmt(secrets.length)}</small></h4><div class="mob-grid">${sec.map((e) => mobTile(e, st[e.hash])).join("")}</div></section></div>` : ""}`;
    const redraw = () => bestiaire(el, el.dataset.who || "");
    el.dataset.who = who || "";
    el.querySelector("#bestWho").onchange = (ev) => { el.dataset.who = ev.target.value; redraw(); };
    el.querySelector("#bestShow").onchange = (ev) => { el.dataset.show = ev.target.value; redraw(); };
    el.querySelector("#bestQ").oninput = (ev) => {
      el.dataset.q = ev.target.value; const pos = ev.target.selectionStart; redraw().then(() => { const i = el.querySelector("#bestQ"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } });
    };
  }

  /** Collection d'un joueur, sous ses trophées (fiche, Mes stats). */
  async function mountMobs(el, name) {
    if (!el) return;
    const b = await loadBest();
    if (!b || !(b.catalogue || []).length) { el.innerHTML = ""; return; }
    const mine = index(b, name);
    const list = b.catalogue.filter((e) => mine[e.hash]).sort((x, y) => RANK[mine[y.hash].best] - RANK[mine[x.hash].best] || mobName(x).localeCompare(mobName(y), "fr"));
    const total = b.catalogue.filter((e) => !e.secret).length;
    el.innerHTML = `<h3 class="sec">Bestiaire <small>${fmt(list.filter((e) => !e.secret).length)} / ${fmt(total)} têtes de mobs</small></h3>
      ${list.length ? `<div class="mob-grid">${list.map((e) => mobTile(e, mine[e.hash], true)).join("")}</div>` : empty("Aucune tête de mob pour l'instant. Une arme Butin, et en chasse !")}
      <p class="small"><a href="#classements/bestiaire/${encodeURIComponent(name)}">Voir sa collection dans le bestiaire</a></p>`;
  }

  window.Trophees = { mount, hall, load, bestiaire, mountMobs };
})();
