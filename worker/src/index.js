import { COMMANDES_STAFF } from "./commandes-staff.js";
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
const SESSION_DAYS = 30;        // durée de la connexion
const RECHECK_HOURS = 6;        // revérification des rôles Discord, sans redemander la connexion
const MORT = ["", "oui", "sauf1", "sauf1_accord", "accord", "non"];
const ACTIVITE = ["", "tres", "bcp", "moyen", "peu"];

export default {
  // Déclencheur fiable (Cloudflare) de la mise à jour du site : le cron de GitHub est souvent retardé de plusieurs heures
  async scheduled(event, env) {
    if (!env.GITHUB_DISPATCH_TOKEN) return;
    const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/update.yml/dispatches`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, accept: "application/vnd.github+json",
        "user-agent": "sumenium-worker", "x-github-api-version": "2022-11-28", "content-type": "application/json" },
      body: JSON.stringify({ ref: "main" }),
    });
    if (!r.ok) console.error("Déclenchement de la mise à jour refusé :", r.status, (await r.text()).slice(0, 200));
  },

  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // Autre adresse (www.sumenium.com, ancienne sumenium.alheon.fr) : les pages et la connexion renvoient vers l'adresse officielle (PUBLIC_URL).
    // Les autres /api/* restent servies sur les deux adresses (scripts de mise à jour, sessions en cours).
    const pub = new URL(env.PUBLIC_URL);
    if (url.host !== pub.host && pub.hostname !== "localhost" && (!url.pathname.startsWith("/api/") || url.pathname === "/api/auth/login")) {
      return Response.redirect(pub.origin + url.pathname + url.search, 301);
    }
    if (url.pathname === "/.well-known/security.txt") {
      return new Response(`Contact: ${pub.origin}/confidentialite.html\nPreferred-Languages: fr, en\nCanonical: ${pub.origin}/.well-known/security.txt\nExpires: ${new Date(Date.now() + 300 * 86400000).toISOString()}\n`,
        { headers: securityHeaders(new Headers({ "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" })) });
    }
    if (!url.pathname.startsWith("/api/")) return proxy(req, env, url);
    // sans secret solide, les sessions seraient falsifiables : on refuse tout
    if (!env.DISCORD_CLIENT_SECRET || env.DISCORD_CLIENT_SECRET.length < 16 || !/^\d{15,22}$/.test(env.GUILD_ID || "")) {
      return json({ error: "L'espace n'est pas encore configuré." }, 503);
    }
    try {
      const res = await api(req, env, url);
      if (req.__cookie) res.headers.append("set-cookie", req.__cookie);
      return res;
    } catch (e) {
      const extra = req.__cookie ? { "set-cookie": req.__cookie } : {};
      if (e instanceof HttpError) return json({ error: e.message }, e.status, extra);
      if (/UNIQUE constraint failed/.test(String(e && e.message))) return json({ error: "Ce nom est déjà utilisé." }, 409, extra);
      console.error(e);
      return json({ error: "Erreur interne du serveur." }, 500, extra);
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
    headers: securityHeaders(new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers })),
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
  // GitHub Pages garde ses fichiers 10 min en cache : on force une copie fraîche chaque minute
  const bust = (url.search ? "&" : "?") + "_v=" + Math.floor(Date.now() / 60000);
  const target = env.SITE_ORIGIN.replace(/\/$/, "") + url.pathname + url.search + bust;
  const res = await fetch(target, { headers: { "user-agent": "sumenium-worker" }, redirect: "follow" });
  const out = new Response(res.body, res);
  securityHeaders(out.headers);
  // Jamais plus de 5 minutes de cache ; les données (JSON) sont toujours revalidées
  out.headers.set("cache-control", /\.json$/.test(url.pathname) ? "no-cache" : "public, max-age=300");
  out.headers.delete("access-control-allow-origin");
  return out;
}

function securityHeaders(h) {
  h.set("strict-transport-security", "max-age=31536000");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "strict-origin-when-cross-origin");
  h.set("x-frame-options", "SAMEORIGIN");
  h.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  return h;
}

/* -------------------------------------------------------------- session/rôles */

function levelFromRoles(env, roles) {
  const has = (id) => roles.includes(id);
  if (has(env.ROLE_ADMIN) || has(env.ROLE_STAFF)) return "staff";
  if (has(env.ROLE_ATTENTE)) return "attente";
  if (has(env.ROLE_SUMENIEN)) return "sumenien";
  return null;
}

/** Session : cookie signé valable 30 jours. Toutes les 6 h, les rôles sont revérifiés auprès de Discord
 *  avec le jeton de renouvellement (sans rien demander au joueur). Quitter le Discord ou perdre ses rôles coupe l'accès. */
async function session(req, env) {
  if (req.__s !== undefined) return req.__s;
  let s = await verify(env, cookies(req).sid);
  if (s && !(s.chk > now() - RECHECK_HOURS * 3600)) s = await recheck(req, env, s);
  req.__s = s;
  return s;
}
async function recheck(req, env, s) {
  const u = await env.DB.prepare("SELECT refresh_token FROM users WHERE discord_id = ?").bind(s.id).first();
  if (!u || !u.refresh_token) return dropSession(req);
  let tok;
  try {
    tok = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "refresh_token", refresh_token: u.refresh_token }),
    });
  } catch { return s; } // Discord injoignable : on garde la session, on réessaiera
  if (tok.status >= 500 || tok.status === 429) return s;
  if (!tok.ok) return dropSession(req, s.id); // jeton révoqué (application retirée du compte)
  const t = await tok.json();
  const mres = await fetch(`https://discord.com/api/users/@me/guilds/${env.GUILD_ID}/member`, { headers: { authorization: `Bearer ${t.access_token}` } });
  if (mres.status >= 500 || mres.status === 429) return s;
  const level = mres.ok ? levelFromRoles(env, (await mres.json()).roles || []) : null;
  if (!level) return dropSession(req, s.id);
  await env.DB.prepare("UPDATE users SET refresh_token = ?, level = ?, last_login = ? WHERE discord_id = ?")
    .bind(t.refresh_token || u.refresh_token, level, now(), s.id).run();
  const fresh = { ...s, level, chk: now(), exp: now() + SESSION_DAYS * 86400 };
  req.__cookie = setCookie("sid", await sign(env, fresh), SESSION_DAYS * 86400);
  return fresh;
}
async function dropSession(req, id) {
  req.__cookie = setCookie("sid", "", 0);
  return null;
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
  projets: ["nom", "description", "tailles", "unique_srv", "illimite", "ordre", "deleted"],
  projet_faction: ["projet_id", "faction_id", "usine_id", "note", "ts", "deleted"],
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
  const hasUpdated = ["players", "factions", "bases", "candidats", "projet_faction"].includes(table);
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
    const s = await verify(env, cookies(req).sid);
    if (s) await env.DB.prepare("UPDATE users SET refresh_token = NULL WHERE discord_id = ?").bind(s.id).run();
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

  /* ---- journal des transactions (mod Sumenium Economy), envoyé par la mise à jour du site ---- */
  if (p === "/api/ingest/journal" && (m === "GET" || m === "POST")) {
    if (req.headers.get("authorization") !== `Bearer ${await ingestToken(env)}`) fail(401, "Jeton invalide.");
    if (m === "GET") {
      const r = await env.DB.prepare("SELECT MAX(t) AS t FROM tx").first();
      return json({ lastT: (r && r.t) || 0 });
    }
    return json(await ingestJournal(env, Array.isArray(body.lines) ? body.lines.slice(0, 1000) : []));
  }
  if (p === "/api/me/historique" && m === "GET") {
    const s = await need(req, env, "attente");
    const me = await env.DB.prepare("SELECT mc_name FROM players WHERE discord_id = ? AND deleted = 0").bind(s.id).first();
    if (!me) return json({ uuid: null, reason: "fiche", rows: [] });
    return json(await history(env, me.mc_name, url));
  }
  if (p === "/api/admin/commandes" && m === "GET") {
    await need(req, env, "staff");
    return json(COMMANDES_STAFF);
  }
  if (p === "/api/admin/historique" && m === "GET") {
    await need(req, env, "staff");
    const n = str(url.searchParams.get("joueur"), 16);
    if (!MC_NAME.test(n)) fail(400, "Choisis un joueur.");
    return json(await history(env, n, url));
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
  // Affiche de candidature : image stockée dans D1 (réduite à moins de 1 Mo par le navigateur)
  if ((mm = p.match(/^\/api\/candidats\/(\d+)\/affiche$/))) {
    const cid = Number(mm[1]);
    if (m === "GET") {
      await need(req, env, "attente");
      const a = await env.DB.prepare("SELECT a.mime, a.data FROM affiches a JOIN candidats c ON c.id = a.candidat_id WHERE a.candidat_id = ? AND c.deleted = 0").bind(cid).first();
      if (!a) fail(404, "Pas d'affiche.");
      return new Response(new Uint8Array(a.data), { headers: securityHeaders(new Headers({
        "content-type": a.mime, "cache-control": "private, max-age=86400", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
        "content-disposition": "inline" })) });
    }
    if (m !== "PUT" && m !== "DELETE") fail(405, "Méthode refusée.");
    const s = await need(req, env, "sumenien");
    const c = await row(env, "candidats", cid);
    if (!c || c.deleted) fail(404, "Candidature introuvable.");
    if (s.level !== "staff") {
      const me = await env.DB.prepare("SELECT id FROM players WHERE discord_id = ?").bind(s.id).first();
      if (!me || me.id !== c.player_id) fail(403, "Tu ne peux modifier que ta candidature.");
    }
    if (m === "DELETE") {
      await env.DB.prepare("DELETE FROM affiches WHERE candidat_id = ?").bind(cid).run();
      await audit(env, s, "candidats", cid, "update", { affiche_image: "oui" }, { affiche_image: "retirée" });
      return json({ ok: true });
    }
    const mt = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ""));
    if (!mt) fail(400, "Image invalide (JPEG, PNG ou WebP).");
    const bytes = Uint8Array.from(atob(mt[2]), (ch) => ch.charCodeAt(0));
    if (bytes.length > 1_000_000) fail(400, "Image trop lourde (1 Mo maximum).");
    const magic = { "image/jpeg": [0xff, 0xd8], "image/png": [0x89, 0x50], "image/webp": [0x52, 0x49] }[mt[1]];
    if (bytes[0] !== magic[0] || bytes[1] !== magic[1]) fail(400, "Le contenu ne correspond pas à une image.");
    await env.DB.prepare("INSERT OR REPLACE INTO affiches (candidat_id, mime, data, updated) VALUES (?,?,?,?)").bind(cid, mt[1], bytes, now()).run();
    await audit(env, s, "candidats", cid, "update", null, { affiche_image: `${Math.round(bytes.length / 1024)} ko` });
    return json({ ok: true });
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

  /* ---- projets communautaires (validés par le staff après un ticket Discord) ---- */
  if (p === "/api/projets/realises" && m === "POST") {
    const s = await need(req, env, "staff");
    return json(await addProjet(env, s, body));
  }
  if ((mm = p.match(/^\/api\/projets\/realises\/(\d+)$/)) && (m === "PUT" || m === "DELETE")) {
    const s = await need(req, env, "staff");
    const pf = await row(env, "projet_faction", Number(mm[1]));
    if (!pf || pf.deleted) fail(404, "Projet introuvable.");
    if (m === "DELETE") await update(env, s, "projet_faction", pf.id, { deleted: 1 }, "delete");
    else await update(env, s, "projet_faction", pf.id, { note: str(body.note, 500) });
    await syncProjetUsine(env, pf.id);
    return json({ ok: true });
  }
  if (p === "/api/projets" && m === "POST") {
    const s = await need(req, env, "staff");
    return json({ id: await insert(env, s, "projets", projetFields(body, true)) });
  }
  if ((mm = p.match(/^\/api\/projets\/(\d+)$/)) && (m === "PUT" || m === "DELETE")) {
    const s = await need(req, env, "staff");
    const id = Number(mm[1]);
    if (m === "DELETE") { await update(env, s, "projets", id, { deleted: 1 }, "delete"); return json({ ok: true }); }
    return json({ projet: await update(env, s, "projets", id, projetFields(body, false)) });
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
      await freeName(env, n, id);
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
    await freeName(env, n, 0);
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

/** Libère un pseudo occupé par une fiche SUPPRIMÉE (elle garde l'historique sous un autre nom).
 *  Une fiche active avec ce pseudo bloque le renommage. */
async function freeName(env, name, keepId) {
  const other = await env.DB.prepare("SELECT id, mc_name, deleted FROM players WHERE mc_name = ? AND id != ?").bind(name, keepId).first();
  if (!other) return;
  if (!other.deleted) fail(409, `Le pseudo ${other.mc_name} est déjà celui d'une autre fiche. Supprime-la ou renomme-la d'abord.`);
  await env.DB.prepare("UPDATE players SET mc_name = ?, discord_id = NULL WHERE id = ?").bind(`${other.mc_name}~${other.id}`, other.id).run();
}

const TAILLES_USINE = ["grosse", "moyenne", "petite"];
function projetFields(b, creating) {
  const f = {};
  if ("nom" in b || creating) { f.nom = str(b.nom, 80); if (!f.nom) fail(400, "Donne un nom au projet."); }
  if ("tailles" in b || creating) {
    const t = String(b.tailles || "petite").split(",").map((x) => x.trim()).filter((x) => TAILLES_USINE.includes(x));
    if (!t.length) fail(400, "Choisis au moins une taille d'usine.");
    f.tailles = t.join(",");
  }
  if ("description" in b) f.description = str(b.description, 600);
  if ("unique_srv" in b) f.unique_srv = b.unique_srv ? 1 : 0;
  if ("illimite" in b) f.illimite = b.illimite ? 1 : 0;
  if ("ordre" in b) f.ordre = int(b.ordre) || 0;
  return f;
}

/** Valide un projet communautaire pour une faction, avec l'usine qu'il débloque.
 *  Règles : projet « unique » = une seule fois sur le serveur ; sinon une fois par faction, sauf les projets illimités (évènements). */
async function addProjet(env, s, b) {
  const pr = await row(env, "projets", int(b.projet_id));
  if (!pr || pr.deleted) fail(400, "Choisis un projet.");
  const fac = await row(env, "factions", int(b.faction_id));
  if (!fac || fac.deleted) fail(400, "Choisis une faction.");
  if (pr.unique_srv) {
    const ex = await env.DB.prepare("SELECT f.name FROM projet_faction pf JOIN factions f ON f.id = pf.faction_id WHERE pf.projet_id = ? AND pf.deleted = 0").bind(pr.id).first();
    if (ex) fail(400, `« ${pr.nom} » est un projet unique, déjà réalisé par ${ex.name}.`);
  } else if (!pr.illimite) {
    const ex = await env.DB.prepare("SELECT 1 FROM projet_faction WHERE projet_id = ? AND faction_id = ? AND deleted = 0").bind(pr.id, fac.id).first();
    if (ex) fail(400, `${fac.name} a déjà réalisé « ${pr.nom} » (une seule fois par faction).`);
  }
  let usineId = null;
  if (b.usine_id) {
    const u = await env.DB.prepare("SELECT * FROM usines WHERE id = ?").bind(int(b.usine_id)).first();
    if (!u) fail(400, "Usine introuvable.");
    if (!pr.tailles.split(",").includes(u.taille)) fail(400, `Ce projet débloque une usine ${pr.tailles.replace(",", " ou ")}, pas une ${u.taille}.`);
    const has = await env.DB.prepare("SELECT 1 FROM usine_choix WHERE faction_id = ? AND usine_id = ?").bind(fac.id, u.id).first();
    if (has) fail(400, `${fac.name} a déjà « ${u.nom} ».`);
    usineId = u.id;
  }
  const id = await insert(env, s, "projet_faction", { projet_id: pr.id, faction_id: fac.id, usine_id: usineId, note: str(b.note, 500), ts: now(), deleted: 0 });
  await syncProjetUsine(env, id);
  return { id };
}

/** Garde l'usine d'un projet en phase avec le projet (ajoutée s'il est actif, retirée s'il est supprimé). */
async function syncProjetUsine(env, pfId) {
  const pf = await row(env, "projet_faction", pfId);
  await env.DB.prepare("DELETE FROM usine_choix WHERE projet_faction_id = ?").bind(pfId).run();
  if (pf && !pf.deleted && pf.usine_id) {
    await env.DB.prepare("INSERT OR IGNORE INTO usine_choix (faction_id, usine_id, projet_faction_id) VALUES (?, ?, ?)").bind(pf.faction_id, pf.usine_id, pfId).run();
  }
}

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const acc = (v) => (v === null || v === undefined || v === "" ? null : String(v).slice(0, 80).toLowerCase());

/** Range les lignes du journal (montants en centimes), sans doublons ; garde 180 jours. */
async function ingestJournal(env, lines) {
  const stmts = [];
  for (const line of lines) {
    if (typeof line !== "string" || line.length > 8000) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || !Number.isFinite(Number(o.t)) || !o.type) continue;
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO tx (id, t, type, actor, from_acc, to_acc, item, data) VALUES (?,?,?,?,?,?,?,?)")
      .bind(hex(await sha256(line)), Math.round(Number(o.t)), str(o.type, 40), acc(o.actor), acc(o.from), acc(o.to), o.item ? str(o.item, 80) : null, line));
  }
  let added = 0;
  for (let i = 0; i < stmts.length; i += 100) {
    const res = await env.DB.batch(stmts.slice(i, i + 100));
    added += res.reduce((a, r) => a + ((r.meta && r.meta.changes) || 0), 0);
  }
  await env.DB.prepare("DELETE FROM tx WHERE t < ?").bind(Date.now() - 180 * 86400000).run();
  return { ok: true, added };
}

/** Historique d'un joueur : les transactions où il est acheteur, vendeur ou à l'origine de l'action. */
async function history(env, mcName, url) {
  const wl = await env.DB.prepare("SELECT mc_name, uuid FROM whitelist WHERE mc_name = ?").bind(mcName).first();
  if (!wl || !wl.uuid) return { uuid: null, reason: "whitelist", rows: [] };
  const uuid = wl.uuid.toLowerCase(), account = `joueur:${uuid}`;
  const before = int(url.searchParams.get("before")) || 9e15;
  const type = str(url.searchParams.get("type"), 40);
  const LIMIT = 100;
  const rows = (await env.DB.prepare(
    `SELECT data FROM tx WHERE (actor = ? OR from_acc = ? OR to_acc = ?) AND t < ?${type ? " AND type = ?" : ""} ORDER BY t DESC LIMIT ?`
  ).bind(uuid, account, account, before, ...(type ? [type] : []), LIMIT + 1).all()).results;
  return { uuid, name: wl.mc_name, rows: rows.slice(0, LIMIT).map((r) => JSON.parse(r.data)), more: rows.length > LIMIT };
}

async function claim(env, s, name) {
  if (!MC_NAME.test(name)) fail(400, "Pseudo Minecraft invalide (3 à 16 lettres, chiffres ou _).");
  const already = await env.DB.prepare("SELECT * FROM players WHERE discord_id = ? AND deleted = 0").bind(s.id).first();
  if (already) fail(400, `Ton compte est déjà relié à ${already.mc_name}. Demande au staff pour changer.`);
  // une ancienne fiche supprimée garde le lien Discord : on le libère
  await env.DB.prepare("UPDATE players SET discord_id = NULL WHERE discord_id = ? AND deleted = 1").bind(s.id).run();
  // Le pseudo n'a pas besoin d'être déjà whitelisté : la fiche se remplit AVANT la whitelist.
  // S'il y est, on reprend l'orthographe exacte du serveur.
  const wl = await env.DB.prepare("SELECT mc_name FROM whitelist WHERE mc_name = ?").bind(name).first();
  const exact = wl ? wl.mc_name : name;
  const existing = await env.DB.prepare("SELECT * FROM players WHERE mc_name = ?").bind(exact).first();
  if (existing && existing.discord_id && existing.discord_id !== s.id) fail(409, "Ce pseudo est déjà relié à un autre compte Discord. Contacte le staff.");
  if (existing) {
    await update(env, s, "players", existing.id, { discord_id: s.id, deleted: 0, mc_name: exact }, "claim");
    return { player: await row(env, "players", existing.id) };
  }
  const id = await insert(env, s, "players", { mc_name: exact, discord_id: s.id });
  return { player: await row(env, "players", id) };
}

async function toggleUsine(env, s, fid, uid, on) {
  if (s.level !== "staff" && (await setting(env, "usines_ouvertes")) !== "1") fail(400, "Les choix d'usines sont fermés pour le moment.");
  const u = uid ? await env.DB.prepare("SELECT * FROM usines WHERE id = ?").bind(uid).first() : null;
  if (!u) fail(404, "Usine introuvable.");
  const has = await env.DB.prepare("SELECT projet_faction_id FROM usine_choix WHERE faction_id = ? AND usine_id = ?").bind(fid, uid).first();
  if (has && has.projet_faction_id && !on) fail(400, "Cette usine a été débloquée par un projet communautaire : retire le projet dans l'onglet Projets.");
  if (on && !has) {
    if (s.level !== "staff") {
      const max = { grosse: 3, moyenne: 4, petite: 5 }[u.taille];
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM usine_choix WHERE usine_id = ?").bind(uid).first();
      if (n.n >= max) fail(400, `Plus de place pour « ${u.nom} » (${max} maximum sur le serveur).`);
      const mine = (await env.DB.prepare("SELECT u.taille FROM usine_choix c JOIN usines u ON u.id = c.usine_id WHERE c.faction_id = ? AND c.projet_faction_id IS NULL").bind(fid).all()).results;
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
    else if (before) {
      if (a.entity === "players" && before.mc_name) await freeName(env, before.mc_name, id);
      await update(env, s, a.entity, id, before, "revert");
    }
    if (a.entity === "projet_faction") await syncProjetUsine(env, id);
  } else {
    fail(400, "Ce type de modification ne peut pas être annulé.");
  }
  await env.DB.prepare("UPDATE audit SET reverted = 1 WHERE id = ?").bind(auditId).run();
  return { ok: true };
}

async function allData(env, s) {
  // Une seule requête groupée vers la base (un aller-retour au lieu de quinze)
  const staff = s.level === "staff";
  const Q = (sql, ...a) => env.DB.prepare(sql).bind(...a);
  const myFaction = "(SELECT faction_id FROM players WHERE discord_id = ? AND deleted = 0)";
  const [meR, playersR, factionsR, usinesR, choixR, projetsR, realisesR, prixR, settingsR, basesR, candidatsR, votesR, resultsR, wlCountR, wlFreeR] = await env.DB.batch([
    Q("SELECT * FROM players WHERE discord_id = ? AND deleted = 0", s.id),
    Q("SELECT p.*, u.discord_name, (w.mc_name IS NOT NULL) AS wl FROM players p LEFT JOIN users u ON u.discord_id = p.discord_id LEFT JOIN whitelist w ON w.mc_name = p.mc_name WHERE p.deleted = 0 ORDER BY p.mc_name"),
    Q("SELECT * FROM factions WHERE deleted = 0 ORDER BY name"),
    Q("SELECT * FROM usines ORDER BY ordre, id"),
    Q("SELECT * FROM usine_choix"),
    Q("SELECT * FROM projets WHERE deleted = 0 ORDER BY ordre, id"),
    Q("SELECT id, projet_id, faction_id, usine_id, note, ts FROM projet_faction WHERE deleted = 0 ORDER BY ts"),
    Q("SELECT * FROM prix WHERE deleted = 0 ORDER BY ordre, id"),
    Q("SELECT * FROM settings"),
    // Coordonnées : visibles seulement par la faction concernée et le staff
    staff ? Q("SELECT * FROM bases WHERE deleted = 0 ORDER BY faction_id, type, nom")
      : Q(`SELECT * FROM bases WHERE deleted = 0 AND faction_id = ${myFaction} ORDER BY type, nom`, s.id),
    Q("SELECT c.*, p.mc_name, a.updated AS affiche_v FROM candidats c JOIN players p ON p.id = c.player_id LEFT JOIN affiches a ON a.candidat_id = c.id WHERE c.deleted = 0 ORDER BY c.id"),
    Q("SELECT tour, candidat_id FROM votes WHERE discord_id = ?", s.id),
    Q("SELECT tour, candidat_id, COUNT(*) AS n FROM votes GROUP BY tour, candidat_id"),
    Q("SELECT COUNT(*) AS n FROM whitelist"),
    // Pseudos whitelistés sans fiche : aide le staff à corriger les fiches importées sous un autre nom
    Q("SELECT w.mc_name FROM whitelist w WHERE NOT EXISTS (SELECT 1 FROM players p WHERE p.mc_name = w.mc_name AND p.deleted = 0) ORDER BY w.mc_name"),
  ]);
  const me = meR.results[0] || null;
  const players = playersR.results.map((p) => {
    const own = me && me.id === p.id;
    const out = { id: p.id, mc_name: p.mc_name, faction_id: p.faction_id, metier: p.metier, metier_desc: p.metier_desc,
      perso_desc: p.perso_desc, activite: p.activite, mort: p.mort, linked: !!p.discord_id, whitelisted: !!p.wl, taille_appliquee: p.taille_appliquee };
    if (staff || own) Object.assign(out, { taille_cm: p.taille_cm, discord_name: p.discord_name || null });
    return out;
  });
  const settings = Object.fromEntries(settingsR.results.map((r) => [r.key, r.value]));
  return {
    user: { id: s.id, name: s.name, avatar: s.avatar, level: s.level },
    players, factions: factionsR.results, usines: usinesR.results, choix: choixR.results, projets: projetsR.results,
    realises: realisesR.results, prix: prixR.results, settings, bases: basesR.results, candidats: candidatsR.results,
    myVotes: Object.fromEntries(votesR.results.map((v) => [v.tour, v.candidat_id])),
    results: staff || settings.election === "resultats" ? resultsR.results : null,
    meId: me ? me.id : null, wlSynced: wlCountR.results[0].n > 0, wlFree: staff ? wlFreeR.results.map((r) => r.mc_name) : null,
  };
}

async function importData(env, s, data) {
  // Import depuis le Google Sheet (fichier préparé hors ligne).
  // Crée ce qui manque et complète les champs vides ; ne remplace jamais une valeur déjà saisie,
  // et ne ressuscite pas une fiche supprimée. Le même fichier peut être réimporté sans risque.
  const done = { factions: 0, players: 0, completes: 0, usines: 0 };
  const empty = (v) => v === null || v === undefined || v === "";
  const fill = async (table, cur, wanted) => {
    const f = {};
    for (const [k, v] of Object.entries(wanted)) if (empty(cur[k]) && !empty(v)) f[k] = v;
    if (Object.keys(f).length) { await update(env, s, table, cur.id, f, "import"); done.completes++; }
  };
  const fidByName = {};
  for (const f of data.factions || []) {
    const name = str(f.name, 40);
    if (!name) continue;
    const wanted = { theme: str(f.theme), hub: str(f.hub), projet_commu: str(f.projet_commu),
      autres_projets: str(f.autres_projets), recrutement: str(f.recrutement), tirage: int(f.tirage) };
    let ex = await env.DB.prepare("SELECT * FROM factions WHERE name = ?").bind(name).first();
    if (!ex) {
      await insert(env, s, "factions", { name, ...wanted });
      ex = await env.DB.prepare("SELECT * FROM factions WHERE name = ?").bind(name).first();
      done.factions++;
    } else if (!ex.deleted) await fill("factions", ex, wanted);
    if (!ex.deleted) fidByName[name.toLowerCase()] = ex.id;
  }
  for (const p of data.players || []) {
    const n = str(p.mc_name, 16);
    if (!MC_NAME.test(n)) continue;
    const wanted = { faction_id: p.faction ? fidByName[String(p.faction).toLowerCase()] ?? null : null,
      metier: str(p.metier), metier_desc: str(p.metier_desc), perso_desc: str(p.perso_desc),
      activite: ACTIVITE.includes(p.activite) ? p.activite : "", mort: MORT.includes(p.mort) ? p.mort : "",
      taille_cm: int(p.taille_cm), taille_appliquee: p.taille_appliquee ?? null };
    const ex = await env.DB.prepare("SELECT * FROM players WHERE mc_name = ?").bind(n).first();
    if (!ex) { await insert(env, s, "players", { mc_name: n, ...wanted }); done.players++; }
    else if (!ex.deleted) await fill("players", ex, wanted);
  }
  for (const [fname, list] of Object.entries(data.usine_choix || {})) {
    const fid = fidByName[fname.toLowerCase()];
    if (!fid) continue;
    for (const uname of list) {
      const u = await env.DB.prepare("SELECT id FROM usines WHERE nom = ? COLLATE NOCASE").bind(str(uname, 80)).first();
      if (!u) continue;
      const r = await env.DB.prepare("INSERT OR IGNORE INTO usine_choix (faction_id, usine_id) VALUES (?, ?)").bind(fid, u.id).run();
      if (r.meta.changes) done.usines++;
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
  const { access_token, refresh_token } = await tok.json();
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
    "INSERT INTO users (discord_id, discord_name, avatar, level, last_login, refresh_token) VALUES (?,?,?,?,?,?) " +
    "ON CONFLICT(discord_id) DO UPDATE SET discord_name = excluded.discord_name, avatar = excluded.avatar, level = excluded.level, last_login = excluded.last_login, refresh_token = excluded.refresh_token"
  ).bind(user.id, name, avatar, level, now(), refresh_token || null).run();

  const sid = await sign(env, { id: user.id, name, avatar, level, chk: now(), exp: now() + SESSION_DAYS * 86400 });
  return new Response(null, {
    status: 302,
    headers: [["location", "/#espace"], ["set-cookie", setCookie("sid", sid, SESSION_DAYS * 86400)], ["set-cookie", setCookie("oauth_state", "", 0)]],
  });
}
