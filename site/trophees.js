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
  let DATA = null, LANG = null, loading = null;

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
      ${kills.length ? `<h3 class="sec">Têtes gagnées au combat <small>${fmt(kills.length)}</small></h3><div class="troph-grid">${kills.map((t) => card(t)).join("")}</div>` : ""}`;
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
      <div class="sec-head"><h3>Trophées</h3><p class="sub2">À chaque mort, une tête du joueur tombe avec la cause, le jour de la saison et le temps de survie. Sa rareté vient de points qui s'additionnent : tué par un joueur +2, par un boss +4, cause rare sur le serveur +1 à +3, longue survie ${seuils || "+1 à +4"} (1 jour = 20 min de jeu, sans l'AFK).</p></div>
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

  window.Trophees = { mount, hall, load };
})();
