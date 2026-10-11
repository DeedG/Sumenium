/**
 * Espace Suménium — Worker Cloudflare
 *
 *  - /api/*  : connexion Discord, données de la saison (base D1), historique
 *  - le reste : le site statique, servi depuis GitHub Pages
 *
 * Droits (rôles Discord) :
 *  - Staff ou Admins            → tout modifier, historique, annulation, import
 *  - En attente de vérification → lecture seule
 *  - Suménien                   → modifier uniquement ses propres infos (et sa faction)
 *  - rien de tout ça            → refusé
 */

const TEXT_MAX = 2000;
const SESSION_HOURS = 12;
const MORT = ["", "oui", "sauf1", "sauf1_accord", "accord", "non"];
const ACTIVITE = ["", "tres", "bcp", "moyen", "peu"];

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return proxy(req, env, url);
    // sans secret solide, les sessions seraient falsifiables : on refuse tout
    if (!env.DISCORD_CLIENT_SECRET || env.DISCORD_CLIENT_SECRET.length < 16 || !/^\d{15,22}$/.test(env.GUILD_ID || "")) {
      return json({ error: "L'espace n'est pas encore configuré." }, 503);
    }
    try {
      return await api(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Erreur interne du serveur." }, 500);
    }
  },
};

/* ------------------------------------------------------------------ outils */

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

const now = () => Math.floor(Date.now() / 1000);
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s) => b64url(new TextEncoder().encode(s));
const unb64url = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
async function hmacKey(env, purpose) {
  const raw = await sha256(`sumenium:${purpose}:${env.DISCORD_CLIENT_SECRET}`);
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function sign(env, payload) {
  const body = b64urlText(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env, "session"), new TextEncoder().encode(body));
  return `${body}.${b64url(sig)}`;
}
async function verify(env, token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = await crypto.subtle.sign("HMAC", await hmacKey(env, "session"), new TextEncoder().encode(body));
  if (b64url(expected) !== sig) return null;
  try {
    const p = JSON.parse(unb64url(body));
    return p.exp > now() ? p : null;
  } catch { return null; }
}
async function ingestToken(env) {
  return b64url(await sha256(`sumenium:ingest:${env.DISCORD_CLIENT_SECRET}`));
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const setCookie = (name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

function str(v, max = TEXT_MAX) {
  if (v === undefined || v === null) return "";
  return String(v).slice(0, max).trim();
}
function int(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
const MC_NAME = /^[A-Za-z0-9_]{3,16}$/;

/* --------------------------------------------------------------- proxy site */

async function proxy(req, env, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Méthode non autorisée", { status: 405 });
  const target = env.SITE_ORIGIN.replace(/\/$/, "") + url.pathname + url.search;
  const res = await fetch(target, { headers: { "user-agent": "sumenium-worker" }, redirect: "follow" });
  const out = new Response(res.body, res);
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  out.headers.delete("access-control-allow-origin");
  return out;
}

/* -------------------------------------------------------------- session/rôles */

function levelFromRoles(env, roles) {
  const has = (id) => roles.includes(id);
  if (has(env.ROLE_ADMIN) || has(env.ROLE_STAFF)) return "staff";
  if (has(env.ROLE_ATTENTE)) return "attente";
  if (has(env.ROLE_SUMENIEN)) return "sumenien";
  return null;
}

async function session(req, env) {
  return verify(env, cookies(req).sid);
}
async function need(req, env, level) {
  const s = await session(req, env);
  if (!s) fail(401, "Connecte-toi avec Discord pour continuer.");
  const rank = { attente: 1, sumenien: 2, staff: 3 };
  if (rank[s.level] < rank[level]) {
    fail(403, level === "staff" ? "Réservé au staff." : "Ton compte est encore en attente de vérification : lecture seule pour l'instant.");
  }
  if (req.method !== "GET" && req.headers.get("x-requested-with") !== "sumenium") fail(400, "Requête refusée.");
  return s;
}

/* ---------------------------------------------------------------- historique */

async function audit(env, s, entity, id, action, before, after) {
  await env.DB.prepare(
    "INSERT INTO audit (ts, actor_id, actor_name, entity, entity_id, action, before, after) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(now(), s ? s.id : null, s ? s.name : "système", entity, String(id), action,
    before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null).run();
}

const TABLES = {
  players: ["mc_name", "discord_id", "faction_id", "metier", "metier_desc", "perso_desc", "activite", "mort", "taille_cm", "taille_appliquee", "deleted"],
  factions: ["name", "theme", "hub", "projet_commu", "autres_projets", "recrutement", "tirage", "deleted"],
  bases: ["faction_id", "type", "nom", "x", "y", "z", "deleted"],
  candidats: ["player_id", "resume", "lien", "affiche", "tour2", "deleted"],
  prix: ["minerai", "roche", "prix", "ordre", "deleted"],
};

async function row(env, table, id) {
  return env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
}

/** Met à jour une ligne (champs autorisés uniquement) et l'inscrit dans l'historique. */
async function update(env, s, table, id, fields, action = "update") {
  const before = await row(env, table, id);
  if (!before) fail(404, "Élément introuvable.");
  const cols = Object.keys(fields).filter((k) => TABLES[table].includes(k));
  if (!cols.length) return before;
  const sets = cols.map((c) => `${c} = ?`).join(", ");
  const hasUpdated = ["players", "factions", "bases", "candidats"].includes(table);
  await env.DB.prepare(`UPDATE ${table} SET ${sets}${hasUpdated ? ", updated = ?" : ""} WHERE id = ?`)
    .bind(...cols.map((c) => fields[c]), ...(hasUpdated ? [now()] : []), id).run();
  const after = await row(env, table, id);
  await audit(env, s, table, id, action, pick(before, cols), pick(after, cols));
  return after;
}
async function insert(env, s, table, fields) {
  const cols = Object.keys(fields).filter((k) => TABLES[table].includes(k));
  const res = await env.DB.prepare(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
  ).bind(...cols.map((c) => fields[c])).run();
  const id = res.meta.last_row_id;
  await audit(env, s, table, id, "create", null, pick(await row(env, table, id), cols));
  return id;
}
const pick = (o, cols) => Object.fromEntries(cols.map((c) => [c, o ? o[c] : null]));

/* ---------------------------------------------------------------------- API */

async function api(req, env, url) {
  const p = url.pathname;
  const m = req.method;
  const body = m === "GET" || m === "HEAD" ? {} : await req.json().catch(() => ({}));
  let mm;

  /* ---- connexion ---- */
  if (p === "/api/auth/login") return login(req, env, url);
  if (p === "/api/auth/callback") return callback(req, env, url);
  if (p === "/api/auth/logout") {
    return new Response(null, { status: 302, headers: { location: "/#espace", "set-cookie": setCookie("sid", "", 0) } });
  }

  /* ---- synchronisation depuis GitHub (whitelist) ---- */
  if (p === "/api/ingest/whitelist" && m === "POST") {
    if (req.headers.get("authorization") !== `Bearer ${await ingestToken(env)}`) fail(401, "Jeton invalide.");
    const list = Array.isArray(body.players) ? body.players : [];
    const stmts = [env.DB.prepare("DELETE FROM whitelist")];
    for (const w of list) {
      if (w && MC_NAME.test(w.name || "")) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO whitelist (mc_name, uuid) VALUES (?, ?)").bind(w.name, str(w.uuid, 40)));
    }
    await env.DB.batch(stmts);
    return json({ ok: true, count: stmts.length - 1 });
  }

  /* ---- qui suis-je ---- */
  if (p === "/api/me" && m === "GET") {
    const s = await session(req, env);
    if (!s) return json({ user: null });
    const player = await env.DB.prepare("SELECT * FROM players WHERE discord_id = ? AND deleted = 0").bind(s.id).first();
    return json({ user: { id: s.id, name: s.name, avatar: s.avatar, level: s.level }, player });
  }

  /* ---- toutes les données lisibles ---- */
  if (p === "/api/data" && m === "GET") {
    const s = await need(req, env, "attente");
    return json(await allData(env, s));
  }

  /* ---- ma fiche ---- */
  if (p === "/api/me/claim" && m === "POST") {
    const s = await need(req, env, "sumenien");
    return json(await claim(env, s, str(body.mc_name, 16)));
  }
  if (p === "/api/me/player" && m === "PUT") {
    const s = await need(req, env, "sumenien");
    const me = await env.DB.prepare("SELECT * FROM players WHERE discord_id = ? AND deleted = 0").bind(s.id).first();
    if (!me) fail(400, "Relie d'abord ton pseudo Minecraft.");
    const f = playerFields(body);
    if ("faction_id" in body) {
      const fid = int(body.faction_id);
      if (fid !== me.faction_id) {
        if (fid !== null) await checkFactionRoom(env, fid);
        f.faction_id = fid;
      }
    }
    return json({ player: await update(env, s, "players", me.id, f) });
  }

  /* ---- factions ---- */
  if ((mm = p.match(/^\/api\/factions\/(\d+)$/)) && m === "PUT") {
    const s = await need(req, env, "sumenien");
    const fid = Number(mm[1]);
    await canEditFaction(env, s, fid);
    const f = {};
    for (const k of ["theme", "hub", "projet_commu", "autres_projets", "recrutement"]) if (k in body) f[k] = str(body[k]);
    if (s.level === "staff") {
      if ("name" in body && str(body.name, 40)) f.name = str(body.name, 40);
      if ("tirage" in body) f.tirage = int(body.tirage);
    }
    return json({ faction: await update(env, s, "factions", fid, f) });
  }
  if (p === "/api/factions" && m === "POST") {
    const s = await need(req, env, "staff");
    const name = str(body.name, 40);
    if (!name) fail(400, "Donne un nom à la faction.");
    return json({ id: await insert(env, s, "factions", { name }) });
  }
  if ((mm = p.match(/^\/api\/factions\/(\d+)$/)) && m === "DELETE") {
    const s = await need(req, env, "staff");
    await update(env, s, "factions", Number(mm[1]), { deleted: 1 }, "delete");
    return json({ ok: true });
  }

  /* ---- usines ---- */
  if ((mm = p.match(/^\/api\/factions\/(\d+)\/usines$/)) && m === "POST") {
    const s = await need(req, env, "sumenien");
    const fid = Number(mm[1]);
    await canEditFaction(env, s, fid);
    return json(await toggleUsine(env, s, fid, int(body.usine_id), !!body.on));
  }

  /* ---- bases ---- */
  if (p === "/api/bases" && m === "POST") {
    const s = await need(req, env, "sumenien");
    const fid = int(body.faction_id);
    await canEditFaction(env, s, fid);
    return json({ id: await insert(env, s, "bases", { faction_id: fid, ...baseFields(body) }) });
  }
  if ((mm = p.match(/^\/api\/bases\/(\d+)$/)) && (m === "PUT" || m === "DELETE")) {
    const s = await need(req, env, "sumenien");
    const b = await row(env, "bases", Number(mm[1]));
    if (!b || b.deleted) fail(404, "Coordonnée introuvable.");
    await canEditFaction(env, s, b.faction_id);
    if (m === "DELETE") { await update(env, s, "bases", b.id, { deleted: 1 }, "delete"); return json({ ok: true }); }
    return json({ base: await update(env, s, "bases", b.id, baseFields(body)) });
  }

  /* ---- prix d'échange ---- */
  if (p === "/api/prix" && m === "PUT") {
    const s = await need(req, env, "staff");
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const existing = (await env.DB.prepare("SELECT * FROM prix WHERE deleted = 0").all()).results;
    const keep = new Set();
    let ordre = 0;
    for (const r of rows) {
      const f = { minerai: str(r.minerai, 60), roche: str(r.roche, 60), prix: Number(r.prix) || 0, ordre: ordre++ };
      if (!f.minerai) continue;
      if (r.id && existing.some((e) => e.id === r.id)) { keep.add(r.id); await update(env, s, "prix", r.id, f); }
      else keep.add(await insert(env, s, "prix", f));
    }
    for (const e of existing) if (!keep.has(e.id)) await update(env, s, "prix", e.id, { deleted: 1 }, "delete");
    return json({ ok: true });
  }

  /* ---- élections ---- */
  if (p === "/api/candidats" && m === "POST") {
    const s = await need(req, env, "sumenien");
    const st = await setting(env, "election");
    if (st !== "candidatures" && s.level !== "staff") fail(400, "Les candidatures ne sont pas ouvertes.");
    const me = await env.DB.prepare("SELECT id FROM players WHERE discord_id = ? AND deleted = 0").bind(s.id).first();
    if (!me) fail(400, "Relie d'abord ton pseudo Minecraft.");
    const dup = await env.DB.prepare("SELECT id FROM candidats WHERE player_id = ? AND deleted = 0").bind(me.id).first();
    if (dup) fail(400, "Tu es déjà candidat : modifie ta candidature.");
    return json({ id: await insert(env, s, "candidats", { player_id: me.id, ...candidatFields(body) }) });
  }
  if ((mm = p.match(/^\/api\/candidats\/(\d+)$/)) && (m === "PUT" || m === "DELETE")) {
    const s = await need(req, env, "sumenien");
    const c = await row(env, "candidats", Number(mm[1]));
    if (!c || c.deleted) fail(404, "Candidature introuvable.");
    if (s.level !== "staff") {
      const me = await env.DB.prepare("SELECT id FROM players WHERE discord_id = ?").bind(s.id).first();
      if (!me || me.id !== c.player_id) fail(403, "Tu ne peux modifier que ta candidature.");
    }
    if (m === "DELETE") { await update(env, s, "candidats", c.id, { deleted: 1 }, "delete"); return json({ ok: true }); }
    const f = candidatFields(body);
    if (s.level === "staff" && "tour2" in body) f.tour2 = body.tour2 ? 1 : 0;
    return json({ candidat: await update(env, s, "candidats", c.id, f) });
  }
  if (p === "/api/votes" && m === "POST") {
    const s = await need(req, env, "sumenien");
    const st = await setting(env, "election");
    if (st !== "tour1" && st !== "tour2") fail(400, "Le vote n'est pas ouvert.");
    const tour = st === "tour1" ? 1 : 2;
    const c = await row(env, "candidats", int(body.candidat_id));
    if (!c || c.deleted || (tour === 2 && !c.tour2)) fail(400, "Ce candidat n'est pas éligible pour ce tour.");
    const me = await env.DB.prepare("SELECT id FROM players WHERE discord_id = ? AND deleted = 0").bind(s.id).first();
    if (!me) fail(400, "Relie d'abord ton pseudo Minecraft pour voter.");
    await env.DB.prepare("INSERT OR REPLACE INTO votes (tour, discord_id, candidat_id, ts) VALUES (?,?,?,?)").bind(tour, s.id, c.id, now()).run();
    await audit(env, s, "votes", `${tour}:${s.id}`, "vote", null, { tour });
    return json({ ok: true });
  }

  /* ---- staff ---- */
  if ((mm = p.match(/^\/api\/admin\/players\/(\d+)$/)) && (m === "PUT" || m === "DELETE")) {
    const s = await need(req, env, "staff");
    const id = Number(mm[1]);
    if (m === "DELETE") { await update(env, s, "players", id, { deleted: 1 }, "delete"); return json({ ok: true }); }
    const f = playerFields(body);
    if ("mc_name" in body) {
      const n = str(body.mc_name, 16);
      if (!MC_NAME.test(n)) fail(400, "Pseudo Minecraft invalide.");
      f.mc_name = n;
    }
    if ("faction_id" in body) f.faction_id = int(body.faction_id);
    if ("unlink" in body && body.unlink) f.discord_id = null;
    if ("taille_appliquee" in body) f.taille_appliquee = body.taille_appliquee === null ? null : Number(body.taille_appliquee);
    return json({ player: await update(env, s, "players", id, f) });
  }
  if (p === "/api/admin/players" && m === "POST") {
    const s = await need(req, env, "staff");
    const n = str(body.mc_name, 16);
    if (!MC_NAME.test(n)) fail(400, "Pseudo Minecraft invalide.");
    return json({ id: await insert(env, s, "players", { mc_name: n }) });
  }
  if (p === "/api/admin/settings" && m === "PUT") {
    const s = await need(req, env, "staff");
    const allowed = { election: ["fermee", "candidatures", "tour1", "tour2", "resultats"], usines_ouvertes: ["0", "1"], usines_max: null };
    for (const [k, v] of Object.entries(body)) {
      if (!(k in allowed)) continue;
      const val = str(v, 20);
      if (allowed[k] && !allowed[k].includes(val)) fail(400, `Valeur invalide pour ${k}.`);
      const before = await setting(env, k);
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(k, val).run();
      await audit(env, s, "settings", k, "update", { value: before }, { value: val });
    }
    return json({ ok: true });
  }
  if (p === "/api/admin/audit" && m === "GET") {
    await need(req, env, "staff");
    const before = int(url.searchParams.get("before")) || 2 ** 31;
    const rows = (await env.DB.prepare("SELECT * FROM audit WHERE id < ? ORDER BY id DESC LIMIT 100").bind(before).all()).results;
    return json({ rows });
  }
  if ((mm = p.match(/^\/api\/admin\/audit\/(\d+)\/revert$/)) && m === "POST") {
    const s = await need(req, env, "staff");
    return json(await revert(env, s, Number(mm[1])));
  }
  if (p === "/api/admin/import" && m === "POST") {
    const s = await need(req, env, "staff");
    return json(await importData(env, s, body));
  }

  fail(404, "Adresse inconnue.");
}

/* ----------------------------------------------------------- règles métier */

function playerFields(b) {
  const f = {};
  for (const k of ["metier", "metier_desc", "perso_desc"]) if (k in b) f[k] = str(b[k]);
  if ("activite" in b) {
    if (!ACTIVITE.includes(b.activite)) fail(400, "Choix invalide pour l'activité.");
    f.activite = b.activite;
  }
  if ("mort" in b) {
    if (!MORT.includes(b.mort)) fail(400, "Choix invalide pour « Mourir ou survivre ».");
    f.mort = b.mort;
  }
  if ("taille_cm" in b) {
    const t = int(b.taille_cm);
    if (t !== null && (t < 50 || t > 250)) fail(400, "Taille IRL entre 50 et 250 cm.");
    f.taille_cm = t;
  }
  return f;
}
function baseFields(b) {
  const type = ["hub", "usine", "base"].includes(b.type) ? b.type : "base";
  return { type, nom: str(b.nom, 80), x: int(b.x), y: int(b.y), z: int(b.z) };
}
function candidatFields(b) {
  const f = {};
  for (const k of ["resume", "lien", "affiche"]) if (k in b) f[k] = str(b[k]);
  for (const k of ["lien", "affiche"]) if (f[k] && !/^https:\/\//.test(f[k])) fail(400, "Les liens doivent commencer par https://");
  return f;
}

async function setting(env, key) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return r ? r.value : null;
}

async function checkFactionRoom(env, fid) {
  const f = await row(env, "factions", fid);
  if (!f || f.deleted) fail(400, "Faction introuvable.");
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE faction_id = ? AND deleted = 0").bind(fid).first();
  if (n.n >= 8) fail(400, "Cette faction est complète (8 joueurs maximum).");
}

async function canEditFaction(env, s, fid) {
  const f = fid ? await row(env, "factions", fid) : null;
  if (!f || f.deleted) fail(404, "Faction introuvable.");
  if (s.level === "staff") return f;
  const me = await env.DB.prepare("SELECT faction_id FROM players WHERE discord_id = ? AND deleted = 0").bind(s.id).first();
  if (!me || me.faction_id !== fid) fail(403, "Tu ne peux modifier que ta propre faction.");
  return f;
}

async function claim(env, s, name) {
  if (!MC_NAME.test(name)) fail(400, "Pseudo Minecraft invalide (3 à 16 lettres, chiffres ou _).");
  const already = await env.DB.prepare("SELECT * FROM players WHERE discord_id = ? AND deleted = 0").bind(s.id).first();
  if (already) fail(400, `Ton compte est déjà relié à ${already.mc_name}. Demande au staff pour changer.`);
  // une ancienne fiche supprimée garde le lien Discord : on le libère
  await env.DB.prepare("UPDATE players SET discord_id = NULL WHERE discord_id = ? AND deleted = 1").bind(s.id).run();
  const wl = await env.DB.prepare("SELECT mc_name FROM whitelist WHERE mc_name = ?").bind(name).first();
  if (!wl) fail(400, "Ce pseudo n'est pas dans la whitelist du serveur. Vérifie l'orthographe, ou attends d'être whitelisté (le site la relit toutes les 10 minutes).");
  const existing = await env.DB.prepare("SELECT * FROM players WHERE mc_name = ?").bind(wl.mc_name).first();
  if (existing && existing.discord_id && existing.discord_id !== s.id) fail(409, "Ce pseudo est déjà relié à un autre compte Discord. Contacte le staff.");
  if (existing) {
    await update(env, s, "players", existing.id, { discord_id: s.id, deleted: 0, mc_name: wl.mc_name }, "claim");
    return { player: await row(env, "players", existing.id) };
  }
  const id = await insert(env, s, "players", { mc_name: wl.mc_name, discord_id: s.id });
  return { player: await row(env, "players", id) };
}

async function toggleUsine(env, s, fid, uid, on) {
  if (s.level !== "staff" && (await setting(env, "usines_ouvertes")) !== "1") fail(400, "Les choix d'usines sont fermés pour le moment.");
  const u = uid ? await env.DB.prepare("SELECT * FROM usines WHERE id = ?").bind(uid).first() : null;
  if (!u) fail(404, "Usine introuvable.");
  const has = await env.DB.prepare("SELECT 1 FROM usine_choix WHERE faction_id = ? AND usine_id = ?").bind(fid, uid).first();
  if (on && !has) {
    if (s.level !== "staff") {
      const max = { grosse: 3, moyenne: 4, petite: 5 }[u.taille];
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM usine_choix WHERE usine_id = ?").bind(uid).first();
      if (n.n >= max) fail(400, `Plus de place pour « ${u.nom} » (${max} maximum sur le serveur).`);
      const mine = (await env.DB.prepare("SELECT u.taille FROM usine_choix c JOIN usines u ON u.id = c.usine_id WHERE c.faction_id = ?").bind(fid).all()).results;
      const count = (t) => mine.filter((x) => x.taille === t).length + (u.taille === t ? 1 : 0);
      const total = mine.length + 1;
      const maxTotal = Number(await setting(env, "usines_max")) || 3;
      if (total > maxTotal) fail(400, `Ta faction a déjà ${maxTotal} usines.`);
      if (count("grosse") > 1 || count("grosse") + count("moyenne") > 2) {
        fail(400, "Combinaisons possibles : 1 grosse + 1 moyenne + 1 petite, 2 moyennes + 1 petite, ou 3 petites.");
      }
    }
    await env.DB.prepare("INSERT INTO usine_choix (faction_id, usine_id) VALUES (?, ?)").bind(fid, uid).run();
    await audit(env, s, "usine_choix", `${fid}:${uid}`, "update", { on: false }, { on: true });
  } else if (!on && has) {
    await env.DB.prepare("DELETE FROM usine_choix WHERE faction_id = ? AND usine_id = ?").bind(fid, uid).run();
    await audit(env, s, "usine_choix", `${fid}:${uid}`, "update", { on: true }, { on: false });
  }
  return { ok: true };
}

async function revert(env, s, auditId) {
  const a = await env.DB.prepare("SELECT * FROM audit WHERE id = ?").bind(auditId).first();
  if (!a) fail(404, "Entrée d'historique introuvable.");
  if (a.reverted) fail(400, "Cette modification a déjà été annulée.");
  const before = a.before ? JSON.parse(a.before) : null;
  if (a.entity === "usine_choix") {
    const [fid, uid] = a.entity_id.split(":").map(Number);
    if (before && before.on) await env.DB.prepare("INSERT OR IGNORE INTO usine_choix (faction_id, usine_id) VALUES (?, ?)").bind(fid, uid).run();
    else await env.DB.prepare("DELETE FROM usine_choix WHERE faction_id = ? AND usine_id = ?").bind(fid, uid).run();
    await audit(env, s, "usine_choix", a.entity_id, "revert", JSON.parse(a.after || "null"), before);
  } else if (a.entity === "settings") {
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(a.entity_id, before.value).run();
    await audit(env, s, "settings", a.entity_id, "revert", JSON.parse(a.after || "null"), before);
  } else if (TABLES[a.entity]) {
    const id = Number(a.entity_id);
    if (a.action === "create") await update(env, s, a.entity, id, { deleted: 1 }, "revert");
    else if (before) await update(env, s, a.entity, id, before, "revert");
  } else {
    fail(400, "Ce type de modification ne peut pas être annulé.");
  }
  await env.DB.prepare("UPDATE audit SET reverted = 1 WHERE id = ?").bind(auditId).run();
  return { ok: true };
}

async function allData(env, s) {
  const q = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results;
  const staff = s.level === "staff";
  const me = await env.DB.prepare("SELECT * FROM players WHERE discord_id = ? AND deleted = 0").bind(s.id).first();
  const players = (await q("SELECT p.*, u.discord_name FROM players p LEFT JOIN users u ON u.discord_id = p.discord_id WHERE p.deleted = 0 ORDER BY p.mc_name"))
    .map((p) => {
      const own = me && me.id === p.id;
      const out = { id: p.id, mc_name: p.mc_name, faction_id: p.faction_id, metier: p.metier, metier_desc: p.metier_desc,
        perso_desc: p.perso_desc, activite: p.activite, mort: p.mort, linked: !!p.discord_id, taille_appliquee: p.taille_appliquee };
      if (staff || own) Object.assign(out, { taille_cm: p.taille_cm, discord_name: p.discord_name || null });
      return out;
    });
  const factions = await q("SELECT * FROM factions WHERE deleted = 0 ORDER BY name");
  const usines = await q("SELECT * FROM usines ORDER BY ordre, id");
  const choix = await q("SELECT * FROM usine_choix");
  const prix = await q("SELECT * FROM prix WHERE deleted = 0 ORDER BY ordre, id");
  const settings = Object.fromEntries((await q("SELECT * FROM settings")).map((r) => [r.key, r.value]));
  // Coordonnées : visibles seulement par la faction concernée et le staff
  const bases = staff ? await q("SELECT * FROM bases WHERE deleted = 0 ORDER BY faction_id, type, nom")
    : me && me.faction_id ? await q("SELECT * FROM bases WHERE deleted = 0 AND faction_id = ? ORDER BY type, nom", me.faction_id) : [];
  const candidats = await q("SELECT c.*, p.mc_name FROM candidats c JOIN players p ON p.id = c.player_id WHERE c.deleted = 0 ORDER BY c.id");
  const myVotes = Object.fromEntries((await q("SELECT tour, candidat_id FROM votes WHERE discord_id = ?", s.id)).map((v) => [v.tour, v.candidat_id]));
  let results = null;
  if (staff || settings.election === "resultats") {
    results = await q("SELECT tour, candidat_id, COUNT(*) AS n FROM votes GROUP BY tour, candidat_id");
  }
  return { players, factions, usines, choix, prix, settings, bases, candidats, myVotes, results, meId: me ? me.id : null };
}

async function importData(env, s, data) {
  // Import initial depuis le Google Sheet (fichier préparé hors ligne). N'écrase rien d'existant.
  const done = { factions: 0, players: 0, usines: 0, prix: 0 };
  const fidByName = {};
  for (const f of data.factions || []) {
    const name = str(f.name, 40);
    if (!name) continue;
    let ex = await env.DB.prepare("SELECT id FROM factions WHERE name = ?").bind(name).first();
    if (!ex) {
      await insert(env, s, "factions", { name, theme: str(f.theme), hub: str(f.hub), projet_commu: str(f.projet_commu),
        autres_projets: str(f.autres_projets), recrutement: str(f.recrutement), tirage: int(f.tirage) });
      ex = await env.DB.prepare("SELECT id FROM factions WHERE name = ?").bind(name).first();
      done.factions++;
    }
    fidByName[name.toLowerCase()] = ex.id;
  }
  for (const p of data.players || []) {
    const n = str(p.mc_name, 16);
    if (!MC_NAME.test(n)) continue;
    const ex = await env.DB.prepare("SELECT id FROM players WHERE mc_name = ?").bind(n).first();
    if (ex) continue;
    const fid = p.faction ? fidByName[String(p.faction).toLowerCase()] ?? null : null;
    await insert(env, s, "players", { mc_name: n, faction_id: fid, metier: str(p.metier), metier_desc: str(p.metier_desc),
      perso_desc: str(p.perso_desc), activite: ACTIVITE.includes(p.activite) ? p.activite : "",
      mort: MORT.includes(p.mort) ? p.mort : "", taille_cm: int(p.taille_cm),
      taille_appliquee: p.taille_appliquee ?? null });
    done.players++;
  }
  for (const [fname, list] of Object.entries(data.usine_choix || {})) {
    const fid = fidByName[fname.toLowerCase()];
    if (!fid) continue;
    for (const uname of list) {
      const u = await env.DB.prepare("SELECT id FROM usines WHERE nom = ? COLLATE NOCASE").bind(str(uname, 80)).first();
      if (u) { await env.DB.prepare("INSERT OR IGNORE INTO usine_choix (faction_id, usine_id) VALUES (?, ?)").bind(fid, u.id).run(); done.usines++; }
    }
  }
  await audit(env, s, "import", "sheet", "import", null, done);
  return { ok: true, done };
}

/* ------------------------------------------------------------ Discord OAuth */

function redirectUri(env) {
  return `${env.PUBLIC_URL}/api/auth/callback`;
}

async function login(req, env, url) {
  const state = b64url(crypto.getRandomValues(new Uint8Array(18)));
  const q = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID, response_type: "code", redirect_uri: redirectUri(env),
    scope: "identify guilds.members.read", state, prompt: "none",
  });
  return new Response(null, {
    status: 302,
    headers: { location: `https://discord.com/oauth2/authorize?${q}`, "set-cookie": setCookie("oauth_state", state, 600) },
  });
}

async function callback(req, env, url) {
  const back = (msg) => new Response(null, {
    status: 302,
    headers: [["location", `/#espace${msg ? "?erreur=" + encodeURIComponent(msg) : ""}`], ["set-cookie", setCookie("oauth_state", "", 0)]],
  });
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== cookies(req).oauth_state) return back("La connexion a expiré, réessaie.");

  const tok = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code", code, redirect_uri: redirectUri(env) }),
  });
  if (!tok.ok) return back("Discord a refusé la connexion.");
  const { access_token } = await tok.json();
  const auth = { authorization: `Bearer ${access_token}` };
  const user = await (await fetch("https://discord.com/api/users/@me", { headers: auth })).json();
  const memberRes = await fetch(`https://discord.com/api/users/@me/guilds/${env.GUILD_ID}/member`, { headers: auth });
  if (memberRes.status === 404) return back("Tu n'es pas membre du serveur Discord Suménium.");
  if (!memberRes.ok) return back("Impossible de vérifier tes rôles Discord, réessaie dans un instant.");
  const member = await memberRes.json();
  const level = levelFromRoles(env, member.roles || []);
  if (!level) return back("Ton compte Discord n'a pas encore de rôle Suménium.");

  const name = member.nick || user.global_name || user.username;
  const avatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null;
  await env.DB.prepare(
    "INSERT INTO users (discord_id, discord_name, avatar, level, last_login) VALUES (?,?,?,?,?) " +
    "ON CONFLICT(discord_id) DO UPDATE SET discord_name = excluded.discord_name, avatar = excluded.avatar, level = excluded.level, last_login = excluded.last_login"
  ).bind(user.id, name, avatar, level, now()).run();

  const sid = await sign(env, { id: user.id, name, avatar, level, exp: now() + SESSION_HOURS * 3600 });
  return new Response(null, {
    status: 302,
    headers: [["location", "/#espace"], ["set-cookie", setCookie("sid", sid, SESSION_HOURS * 3600)], ["set-cookie", setCookie("oauth_state", "", 0)]],
  });
}
