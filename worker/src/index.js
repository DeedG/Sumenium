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
      const res = await api(req, env, url, ctx);
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
  // Pages HTML : seules les sources connues du site peuvent charger du contenu (scripts du site, polices Google,
  // têtes de skin, avatars Discord, carte). Bloque l'injection de scripts tiers et l'affichage du site dans un cadre étranger.
  if ((res.headers.get("content-type") || "").includes("text/html")) out.headers.set("content-security-policy", CSP);
  return out;
}

const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com", "img-src 'self' data: blob: https://mc-heads.net https://textures.minecraft.net https://cdn.discordapp.com", "connect-src 'self'",
  "frame-src https://carte.sumenium.com", "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"].join("; ");
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
  players: ["mc_name", "discord_id", "faction_id", "metier", "metier_desc", "perso_desc", "activite", "mort", "taille_cm", "taille_appliquee", "taille_fixe", "deleted"],
  factions: ["name", "theme", "hub", "projet_commu", "autres_projets", "recrutement", "tirage", "deleted"],
  bases: ["faction_id", "type", "nom", "x", "y", "z", "deleted"],
  candidats: ["player_id", "resume", "lien", "affiche", "tour2", "deleted"],
  prix: ["minerai", "roche", "prix", "ordre", "deleted"],
  projets: ["nom", "description", "tailles", "unique_srv", "illimite", "ordre", "deleted"],
  projet_faction: ["projet_id", "faction_id", "usine_id", "note", "ts", "deleted"],
  faction_demandes: ["name", "theme", "couleur", "membres", "player_id", "statut", "reponse", "faction_id", "ts", "updated"],
  projet_demandes: ["projet_id", "faction_id", "player_id", "note", "statut", "reponse", "ts", "updated"],
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

async function api(req, env, url, ctx) {
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

  /* ---- sauvegarde de la base (lue une fois par semaine par le NAS ; secret BACKUP_TOKEN) ---- */
  if (p === "/api/admin/backup" && m === "GET") {
    const tok = env.BACKUP_TOKEN || "", got = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (tok.length < 32 || !(await sameSecret(got, tok))) fail(401, "Jeton de sauvegarde invalide.");
    const tables = (await env.DB.prepare("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type DESC, name").all()).results;
    const t = url.searchParams.get("table");
    if (!t) return json({ version: 1, at: new Date().toISOString(), schema: tables });
    if (!tables.some((x) => x.type === "table" && x.name === t)) fail(400, "Table inconnue.");
    const after = Number(url.searchParams.get("after")) || 0, lim = 500;
    const rows = (await env.DB.prepare(`SELECT rowid AS __rowid, * FROM "${t}" WHERE rowid > ? ORDER BY rowid LIMIT ${lim}`).bind(after).all()).results;
    const b64 = (u8) => { let x = ""; for (let i = 0; i < u8.length; i += 0x8000) x += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(x); };
    for (const r of rows) for (const [k, v] of Object.entries(r)) {
      if (v instanceof ArrayBuffer) r[k] = { $b64: b64(new Uint8Array(v)) };
      else if (ArrayBuffer.isView(v)) r[k] = { $b64: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
      else if (Array.isArray(v)) r[k] = { $b64: b64(Uint8Array.from(v)) };  // BLOB renvoyé en tableau d'octets
    }
    return json({ table: t, rows, next: rows.length === lim ? rows[rows.length - 1].__rowid : null });
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
  // Sans connexion : la partie publique (fiches RP, factions, usines, projets, élections). Les modifications demandent la connexion.
  if (p === "/api/data" && m === "GET") {
    return json(await allData(env, await session(req, env)));
  }
  if (p === "/api/status" && m === "GET") return serverStatus(env, ctx);

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
    await canManageFaction(env, s, fid);  // le chef de la faction (rôle du mod) ou le staff
    const f = {};
    for (const k of ["theme", "hub", "autres_projets"]) if (k in body) f[k] = str(body[k]);
    if ("name" in body) {
      const n = str(body.name, 40).trim();
      if (n.length < 2) fail(400, "Le nom de la faction doit faire au moins 2 caractères.");
      f.name = n;
    }
    // Contact recrutement : un membre de la faction (ou personne)
    if ("recrutement" in body) {
      const n = str(body.recrutement, 500);
      const cur = ((await row(env, "factions", fid)) || {}).recrutement || "";
      if (n && n === cur) { /* inchangé (ancien texte libre conservé) */ }
      else if (n) {
        const m2 = await env.DB.prepare("SELECT mc_name FROM players WHERE faction_id = ? AND deleted = 0 AND mc_name = ?").bind(fid, n).first();
        if (!m2) fail(400, "Le contact recrutement doit être un membre de la faction.");
        f.recrutement = m2.mc_name;
      } else f.recrutement = "";
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
    return json(await toggleUsine(env, s, fid, int(body.usine_id), !!body.on, ctx));
  }

  if ((mm = p.match(/^\/api\/factions\/(\d+)\/usines\/fini$/)) && m === "POST") {
    const s = await need(req, env, "sumenien");
    const fid = Number(mm[1]);
    await canEditFaction(env, s, fid);
    const tour = int(body.tour) || Number(await setting(env, "usine_tour")) || 1;
    if (s.level !== "staff" && tour !== (Number(await setting(env, "usine_tour")) || 1)) fail(400, "Ce n'est pas le tour en cours.");
    return json(await usineFini(env, s, fid, tour, body.on !== false, ctx));
  }
  // Suivi en direct du tirage (relu toutes les quelques secondes par la page Usines)
  if (p === "/api/usines/live" && m === "GET") {
    const [st, ch, fi, fs] = await env.DB.batch([
      env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('usine_tour','usines_ouvertes')"),
      env.DB.prepare("SELECT * FROM usine_choix"),
      env.DB.prepare("SELECT faction_id, tour FROM usine_fini"),
      env.DB.prepare("SELECT id, tirage FROM factions WHERE deleted = 0")]);
    const set = Object.fromEntries(st.results.map((r) => [r.key, r.value]));
    return json({ usine_tour: set.usine_tour, usines_ouvertes: set.usines_ouvertes, choix: ch.results, usineFini: fi.results, tirage: fs.results },
      200, { "cache-control": "no-store" });
  }
  // Tirage au sort de l'ordre des factions (une fois en début de saison ; refait seulement si force)
  if (p === "/api/admin/tirage" && m === "POST") {
    const s = await need(req, env, "staff");
    const fs = (await env.DB.prepare("SELECT id, tirage FROM factions WHERE deleted = 0").all()).results;
    let order;
    if (Array.isArray(body.order)) {  // ordre corrigé à la main par le staff (flèches)
      order = body.order.map(int);
      const ids = fs.map((f) => f.id).sort((a, b) => a - b);
      if (order.length !== ids.length || [...order].sort((a, b) => a - b).some((v, i) => v !== ids[i])) fail(400, "L'ordre doit contenir chaque faction une fois.");
    } else {
      if (fs.some((f) => f.tirage) && !body.force) fail(400, "Un ordre existe déjà : coche « refaire le tirage » pour le remplacer.");
      order = fs.map((f) => f.id);
      for (let i = order.length - 1; i > 0; i--) {
        const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    for (const [i, id] of order.entries()) if ((fs.find((f) => f.id === id) || {}).tirage !== i + 1) await update(env, s, "factions", id, { tirage: i + 1 });
    if (!Array.isArray(body.order)) {
      const names = (await env.DB.prepare("SELECT name FROM factions WHERE deleted = 0 ORDER BY tirage").all()).results;
      announce(env, ctx, `🎲 **Tirage au sort de l'ordre des factions** : ${names.map((f, i) => `${i + 1}. ${f.name}`).join(" · ")}`);
    }
    return json({ ok: true, order });
  }

  /* ---- demandes de nouvelle faction (validées par le staff) ---- */
  if (p === "/api/factions/demandes" && m === "POST") {
    const s = await need(req, env, "sumenien");
    if (s.level !== "staff" && (await setting(env, "factions_ouvertes")) !== "1") fail(400, "La création de nouvelles factions est fermée pour le moment.");
    const me = await env.DB.prepare("SELECT id, mc_name FROM players WHERE discord_id = ? AND deleted = 0").bind(s.id).first();
    if (!me) fail(400, "Relie d'abord ton pseudo Minecraft.");
    const name = str(body.name, 40).trim();
    if (name.length < 2) fail(400, "Donne un nom à la faction (2 caractères au moins).");
    if (await env.DB.prepare("SELECT 1 FROM factions WHERE name = ? AND deleted = 0").bind(name).first()
      || await env.DB.prepare("SELECT 1 FROM faction_demandes WHERE name = ? COLLATE NOCASE AND statut = 'attente'").bind(name).first()) fail(400, "Ce nom est déjà pris.");
    if (await env.DB.prepare("SELECT 1 FROM faction_demandes WHERE player_id = ? AND statut = 'attente'").bind(me.id).first()) fail(400, "Tu as déjà une demande en attente.");
    const couleur = MC_COLORS.includes(body.couleur) ? body.couleur : "white";
    const wanted = [...new Set([me.mc_name, ...(Array.isArray(body.membres) ? body.membres : []).map((x) => str(x, 16))].map((x) => x.toLowerCase()))].filter(Boolean);
    const found = [];
    for (const n of wanted) {
      const pl = await env.DB.prepare("SELECT mc_name FROM players WHERE mc_name = ? AND deleted = 0").bind(n).first();
      if (!pl) fail(400, `Pas de fiche pour « ${n} » : chaque membre doit avoir une fiche sur le site.`);
      found.push(pl.mc_name);
    }
    if (found.length < 3) fail(400, "Il faut au moins 3 joueurs (toi compris) pour créer une faction.");
    if (found.length > 8) fail(400, "8 joueurs maximum par faction.");
    const id = await insert(env, s, "faction_demandes", { name, theme: str(body.theme, 2000), couleur, membres: JSON.stringify(found), player_id: me.id, statut: "attente", ts: now(), updated: now() });
    return json({ id });
  }
  if ((mm = p.match(/^\/api\/factions\/demandes\/(\d+)$/)) && m === "PUT") {
    const s = await need(req, env, "sumenien");
    const d = await row(env, "faction_demandes", Number(mm[1]));
    if (!d || d.statut !== "attente") fail(404, "Demande introuvable ou déjà traitée.");
    const action = String(body.action || "");
    if (action === "annuler") {
      const me = await env.DB.prepare("SELECT id FROM players WHERE discord_id = ? AND deleted = 0").bind(s.id).first();
      if (s.level !== "staff" && (!me || me.id !== d.player_id)) fail(403, "Seul l'auteur de la demande peut l'annuler.");
      await update(env, s, "faction_demandes", d.id, { statut: "annulee", updated: now() });
      return json({ ok: true });
    }
    if (s.level !== "staff") fail(403, "Réservé au staff.");
    if (action === "refuser") { await update(env, s, "faction_demandes", d.id, { statut: "refusee", reponse: str(body.reponse, 500), updated: now() }); return json({ ok: true }); }
    if (action !== "accepter") fail(400, "Action inconnue.");
    if (await env.DB.prepare("SELECT 1 FROM factions WHERE name = ? AND deleted = 0").bind(d.name).first()) fail(400, "Une faction porte déjà ce nom.");
    const fid = await insert(env, s, "factions", { name: d.name, theme: d.theme });
    const membres = JSON.parse(d.membres || "[]");
    for (const n of membres) {
      const pl = await env.DB.prepare("SELECT id FROM players WHERE mc_name = ? AND deleted = 0").bind(n).first();
      if (pl) await update(env, s, "players", pl.id, { faction_id: fid });
    }
    // contact recrutement par défaut : l'auteur de la demande (futur chef)
    await update(env, s, "factions", fid, { recrutement: membres[0] || "" });
    await update(env, s, "faction_demandes", d.id, { statut: "acceptee", reponse: str(body.reponse, 500), faction_id: fid, updated: now() });
    return json({ ok: true, faction_id: fid });
  }

  /* ---- demandes de validation d'un projet communautaire (en plus des tickets Discord) ---- */
  if (p === "/api/projets/demandes" && m === "POST") {
    const s = await need(req, env, "sumenien");
    const me = await env.DB.prepare("SELECT id, faction_id FROM players WHERE discord_id = ? AND deleted = 0").bind(s.id).first();
    if (!me || !me.faction_id) fail(400, "Il faut faire partie d'une faction pour demander la validation d'un projet.");
    const pr = await row(env, "projets", int(body.projet_id));
    if (!pr || pr.deleted) fail(400, "Projet introuvable.");
    if (pr.unique_srv && await env.DB.prepare("SELECT 1 FROM projet_faction WHERE projet_id = ? AND deleted = 0").bind(pr.id).first()) fail(400, "Ce projet unique a déjà été réalisé.");
    if (!pr.unique_srv && !pr.illimite && await env.DB.prepare("SELECT 1 FROM projet_faction WHERE projet_id = ? AND faction_id = ? AND deleted = 0").bind(pr.id, me.faction_id).first()) fail(400, "Ta faction a déjà réalisé ce projet.");
    if (await env.DB.prepare("SELECT 1 FROM projet_demandes WHERE projet_id = ? AND faction_id = ? AND statut = 'attente'").bind(pr.id, me.faction_id).first()) fail(400, "Une demande est déjà en attente pour ce projet.");
    const note = str(body.note, 1000).trim();
    if (note.length < 5) fail(400, "Décris en quelques mots ce qui a été fait (et où : coordonnées).");
    return json({ id: await insert(env, s, "projet_demandes", { projet_id: pr.id, faction_id: me.faction_id, player_id: me.id, note, statut: "attente", ts: now(), updated: now() }) });
  }
  if ((mm = p.match(/^\/api\/projets\/demandes\/(\d+)$/)) && m === "PUT") {
    const s = await need(req, env, "sumenien");
    const d = await row(env, "projet_demandes", Number(mm[1]));
    if (!d || d.statut !== "attente") fail(404, "Demande introuvable ou déjà traitée.");
    const action = String(body.action || "");
    if (action === "annuler") {
      const me = await env.DB.prepare("SELECT faction_id FROM players WHERE discord_id = ? AND deleted = 0").bind(s.id).first();
      if (s.level !== "staff" && (!me || me.faction_id !== d.faction_id)) fail(403, "Seule la faction concernée peut annuler sa demande.");
      await update(env, s, "projet_demandes", d.id, { statut: "annulee", updated: now() });
      return json({ ok: true });
    }
    if (s.level !== "staff") fail(403, "Réservé au staff.");
    if (action === "refuser") { await update(env, s, "projet_demandes", d.id, { statut: "refusee", reponse: str(body.reponse, 500), updated: now() }); return json({ ok: true }); }
    if (action !== "accepter") fail(400, "Action inconnue.");
    await addProjet(env, s, { projet_id: d.projet_id, faction_id: d.faction_id, usine_id: body.usine_id, note: str(body.note, 500) || d.note });
    await update(env, s, "projet_demandes", d.id, { statut: "acceptee", reponse: str(body.reponse, 500), updated: now() });
    return json({ ok: true });
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
    // Le staff peut déposer la candidature d'un autre joueur (player_id)
    const me = s.level === "staff" && body.player_id
      ? await env.DB.prepare("SELECT id FROM players WHERE id = ? AND deleted = 0").bind(int(body.player_id)).first()
      : await env.DB.prepare("SELECT id FROM players WHERE discord_id = ? AND deleted = 0").bind(s.id).first();
    if (!me) fail(400, s.level === "staff" && body.player_id ? "Fiche joueur introuvable." : "Relie d'abord ton pseudo Minecraft.");
    const dup = await env.DB.prepare("SELECT id FROM candidats WHERE player_id = ? AND deleted = 0").bind(me.id).first();
    if (dup) fail(400, body.player_id ? "Ce joueur est déjà candidat : modifie sa candidature." : "Tu es déjà candidat : modifie ta candidature.");
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
    if (m === "GET") {  // public, comme les candidatures
      const a = await env.DB.prepare("SELECT a.mime, a.data FROM affiches a JOIN candidats c ON c.id = a.candidat_id WHERE a.candidat_id = ? AND c.deleted = 0").bind(cid).first();
      if (!a) fail(404, "Pas d'affiche.");
      return new Response(new Uint8Array(a.data), { headers: securityHeaders(new Headers({
        "content-type": a.mime, "cache-control": "public, max-age=86400", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
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
    const allowed = { election: ["fermee", "candidatures", "tour1", "tour2", "resultats"], usines_ouvertes: ["0", "1"], usine_tour: Object.keys(USINE_TOURS),
      factions_ouvertes: ["0", "1"], usines_max: null };
    const changed = {};
    for (const [k, v] of Object.entries(body)) {
      if (!(k in allowed)) continue;
      const val = str(v, 20);
      if (allowed[k] && !allowed[k].includes(val)) fail(400, `Valeur invalide pour ${k}.`);
      const before = await setting(env, k);
      if (before === val) continue;
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(k, val).run();
      await audit(env, s, "settings", k, "update", { value: before }, { value: val });
      changed[k] = val;
    }
    // Annonces du tirage : ouverture (ou changement de tour pendant que c'est ouvert), fermeture
    const ouvert = (await setting(env, "usines_ouvertes")) === "1";
    if (changed.usines_ouvertes === "0") announce(env, ctx, "⏸️ Les choix d'usines sont fermés pour le moment.");
    else if (ouvert && ("usines_ouvertes" in changed || "usine_tour" in changed)) await announceTour(env, ctx, Number(await setting(env, "usine_tour")) || 1);
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
  if ("taille_fixe" in b) f.taille_fixe = b.taille_fixe && b.taille_fixe !== "0" ? 1 : 0;
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

// Chef de faction : rôle « chef » dans le mod (eco.json publié avec le site), et membre de cette faction sur le site
async function ecoData(env) {
  try {
    const r = await fetch(env.SITE_ORIGIN.replace(/\/$/, "") + "/eco.json?_v=" + Math.floor(Date.now() / 60000), { headers: { "user-agent": "sumenium-worker" } });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}
async function isChef(env, s, fid) {
  const me = await env.DB.prepare("SELECT mc_name, faction_id FROM players WHERE discord_id = ? AND deleted = 0").bind(s.id).first();
  if (!me || me.faction_id !== fid) return false;
  const eco = await ecoData(env);
  const n = me.mc_name.toLowerCase();
  return !!(eco && (eco.factions || []).some((f) => (f.membres || []).some((m) => String(m.nom).toLowerCase() === n && m.role === "chef")));
}
async function canManageFaction(env, s, fid) {
  const f = await canEditFaction(env, s, fid);
  if (s.level !== "staff" && !(await isChef(env, s, fid))) fail(403, "Seul le chef de la faction (ou le staff) peut modifier sa fiche.");
  return f;
}
// Comparaison en temps constant (empreintes SHA-256 de même longueur)
async function sameSecret(a, b) {
  const h = async (x) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(x))));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
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

// Règles des tours de choix d'usines. Chaque faction choisit, dans l'ordre du tirage, une des combinaisons du tour en cours
// (les usines débloquées par un projet communautaire ne comptent pas). Chaque usine est limitée sur le serveur.
const MC_COLORS = ["black", "dark_blue", "dark_green", "dark_aqua", "dark_red", "dark_purple", "gold", "gray", "dark_gray", "blue", "green", "aqua", "red", "light_purple", "yellow", "white"];
const USINE_MAX = { grosse: 3, moyenne: 4, petite: 5 };
// Ouverture de la saison 7 : vendredi 9 octobre 2026 à 21 h
const SAISON_DEBUT = "2026-10-09T21:00:00+02:00";
const USINE_TOURS = {
  1: { nom: "1er tour", quand: "avant le lancement de la saison, ouverte le vendredi 9 octobre 2026",
       combos: [["grosse", "moyenne", "petite"], ["moyenne", "moyenne", "petite"], ["petite", "petite", "petite"]] },
  2: { nom: "2e tour", quand: "trois semaines après l'ouverture, à partir du vendredi 30 octobre 2026",
       combos: [["grosse"], ["moyenne", "petite"], ["petite", "petite"]] },
};
// Les usines déjà prises dans ce tour (plus la nouvelle) tiennent-elles dans au moins une combinaison ?
const fitsCombo = (sizes, combos) => combos.some((c) => { const left = [...c]; return sizes.every((t) => { const i = left.indexOf(t); if (i < 0) return false; left.splice(i, 1); return true; }); });
async function toggleUsine(env, s, fid, uid, on, ctx) {
  const staff = s.level === "staff";
  const ouvert = (await setting(env, "usines_ouvertes")) === "1";
  if (!staff && !ouvert) fail(400, "Les choix d'usines sont fermés pour le moment.");
  const tour = Number(await setting(env, "usine_tour")) || 1;
  const rules = USINE_TOURS[tour];
  const u = uid ? await env.DB.prepare("SELECT * FROM usines WHERE id = ?").bind(uid).first() : null;
  if (!u) fail(404, "Usine introuvable.");
  const has = await env.DB.prepare("SELECT projet_faction_id, tour FROM usine_choix WHERE faction_id = ? AND usine_id = ?").bind(fid, uid).first();
  if (has && has.projet_faction_id && !on) fail(400, "Cette usine a été débloquée par un projet communautaire : retire le projet dans l'onglet Projets.");
  if (!staff && !(has && has.projet_faction_id)) {
    const t = await usineTurn(env, tour);
    if (t.done.has(fid)) fail(400, "Ta faction a déjà validé ses choix pour ce tour : demande au staff pour changer.");
    if (t.current !== fid) fail(400, t.current ? `Ce n'est pas encore ton tour : on attend ${t.currentName}.` : "Le tour est terminé.");
  }
  if (on && has && !staff) fail(400, `Ta faction a déjà « ${u.nom} ».`);
  if (on && !has) {
    if (!staff) {
      if (!rules) fail(400, "Aucun tour de choix n'est défini pour le moment.");
      const max = USINE_MAX[u.taille];
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM usine_choix WHERE usine_id = ?").bind(uid).first();
      if (n.n >= max) fail(400, `Plus de place pour « ${u.nom} » (${max} maximum sur le serveur).`);
      const mine = (await env.DB.prepare("SELECT u.taille FROM usine_choix c JOIN usines u ON u.id = c.usine_id WHERE c.faction_id = ? AND c.projet_faction_id IS NULL AND c.tour = ?").bind(fid, tour).all()).results;
      if (!fitsCombo([...mine.map((x) => x.taille), u.taille], rules.combos)) {
        fail(400, `${rules.nom} : combinaisons possibles ${rules.combos.map((c) => c.join(" + ")).join(", ou ")}.`);
      }
    }
    await env.DB.prepare("INSERT INTO usine_choix (faction_id, usine_id, tour) VALUES (?, ?, ?)").bind(fid, uid, tour).run();
    await audit(env, s, "usine_choix", `${fid}:${uid}`, "update", { on: false }, { on: true, tour });
    if (ouvert) announce(env, ctx, `🏭 **${await facNameDb(env, fid)}** prend **${u.nom}** (${u.taille}).`);
  } else if (!on && has) {
    if (!staff && has.tour !== tour) fail(400, "Cette usine a été choisie à un tour précédent : seul le staff peut la retirer.");
    await env.DB.prepare("DELETE FROM usine_choix WHERE faction_id = ? AND usine_id = ?").bind(fid, uid).run();
    await audit(env, s, "usine_choix", `${fid}:${uid}`, "update", { on: true, tour: has.tour }, { on: false });
    if (ouvert) announce(env, ctx, `↩️ **${await facNameDb(env, fid)}** retire ${u.nom}.`);
  }
  return { ok: true };
}

/* ---- annonces Discord (webhook du salon du tirage ; secret DISCORD_WEBHOOK_TIRAGE) ---- */
function announce(env, ctx, content) {
  const hook = env.DISCORD_WEBHOOK_TIRAGE;
  const local = /^http:\/\/localhost/.test(env.PUBLIC_URL || "") && /^http:\/\/127\.0\.0\.1:\d+\//.test(hook || "");  // tests locaux
  if (!hook || !(local || /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(hook))) return;
  const send = fetch(hook, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: String(content).slice(0, 1900), username: "Suménium · Usines", allowed_mentions: { parse: [] } }) })
    .then((r) => { if (!r.ok) console.error("Webhook Discord refusé :", r.status); }).catch((e) => console.error("Webhook Discord :", e));
  if (ctx && ctx.waitUntil) ctx.waitUntil(send);
}
const facNameDb = async (env, fid) => ((await env.DB.prepare("SELECT name FROM factions WHERE id = ?").bind(fid).first()) || {}).name || "?";
const SITE_USINES = "https://sumenium.com/#communaute/usines";
// Message d'ouverture d'un tour : règles, ordre de passage et faction qui commence
async function announceTour(env, ctx, tour) {
  const rules = USINE_TOURS[tour];
  if (!rules) return;
  const t = await usineTurn(env, tour);
  const fs = (await env.DB.prepare("SELECT id, name FROM factions WHERE deleted = 0 ORDER BY tirage IS NULL, tirage, name COLLATE NOCASE").all()).results;
  announce(env, ctx, `📣 **Choix des usines : ${rules.nom}** — ${rules.combos.map((c) => c.join(" + ")).join(", ou ")}.\n`
    + `Ordre : ${fs.map((f, i) => `${i + 1}. ${f.name}${t.done.has(f.id) ? " ✓" : ""}`).join(" · ")}\n`
    + (t.current ? `➡️ Au tour de **${t.currentName}** !` : "🏁 Toutes les factions ont déjà validé.") + `\nEn direct : <${SITE_USINES}>`);
}

// Ordre de passage du tour : factions triées par tirage (celles sans rang à la fin) ; la première qui n'a pas validé a la main
async function usineTurn(env, tour) {
  const [fs, fini] = await env.DB.batch([
    env.DB.prepare("SELECT id, name, tirage FROM factions WHERE deleted = 0 ORDER BY tirage IS NULL, tirage, name COLLATE NOCASE"),
    env.DB.prepare("SELECT faction_id FROM usine_fini WHERE tour = ?").bind(tour)]);
  const done = new Set(fini.results.map((r) => r.faction_id));
  const cur = fs.results.find((f) => !done.has(f.id));
  return { done, current: cur ? cur.id : null, currentName: cur ? cur.name : null };
}
async function usineFini(env, s, fid, tour, on, ctx) {
  const staff = s.level === "staff";
  if (!staff) {
    if ((await setting(env, "usines_ouvertes")) !== "1") fail(400, "Les choix d'usines sont fermés pour le moment.");
    if (!on) fail(403, "Seul le staff peut rendre la main à une faction.");
    const t = await usineTurn(env, tour);
    if (t.current !== fid) fail(400, t.current ? `Ce n'est pas ton tour : on attend ${t.currentName}.` : "Le tour est terminé.");
  }
  if (on) await env.DB.prepare("INSERT OR IGNORE INTO usine_fini (faction_id, tour, ts) VALUES (?, ?, ?)").bind(fid, tour, now()).run();
  else await env.DB.prepare("DELETE FROM usine_fini WHERE faction_id = ? AND tour = ?").bind(fid, tour).run();
  await audit(env, s, "usine_fini", `${fid}:${tour}`, "update", { fini: !on }, { fini: on });
  if ((await setting(env, "usines_ouvertes")) === "1") {
    const name = await facNameDb(env, fid), t = await usineTurn(env, tour), rules = USINE_TOURS[tour] || { nom: `tour ${tour}` };
    const picks = (await env.DB.prepare("SELECT u.nom FROM usine_choix c JOIN usines u ON u.id = c.usine_id WHERE c.faction_id = ? AND c.tour = ? AND c.projet_faction_id IS NULL ORDER BY u.ordre").bind(fid, tour).all()).results;
    const list = picks.map((x) => x.nom).join(", ") || "aucune usine";
    const byStaff = s.level === "staff" && !(await env.DB.prepare("SELECT 1 FROM players WHERE discord_id = ? AND faction_id = ? AND deleted = 0").bind(s.id, fid).first());
    let msg = !on ? `↺ Le staff rend la main à **${name}**.` : byStaff ? `⏭️ Tour de **${name}** validé par le staff : ${list}.` : `✅ **${name}** a validé ses choix : ${list}.`;
    if (t.current) msg += `\n➡️ Au tour de **${t.currentName}** !`;
    else {
      const all = (await env.DB.prepare("SELECT f.name, u.nom FROM usine_choix c JOIN usines u ON u.id = c.usine_id JOIN factions f ON f.id = c.faction_id WHERE c.tour = ? AND c.projet_faction_id IS NULL AND f.deleted = 0 ORDER BY f.tirage, u.ordre").bind(tour).all()).results;
      const by = {}; all.forEach((x) => (by[x.name] = [...(by[x.name] || []), x.nom]));
      msg += `\n🏁 **${rules.nom} terminé !**\n${Object.entries(by).map(([f, l]) => `• ${f} : ${l.join(", ")}`).join("\n")}`;
    }
    announce(env, ctx, msg);
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
    if (before && before.on) await env.DB.prepare("INSERT OR IGNORE INTO usine_choix (faction_id, usine_id, tour) VALUES (?, ?, ?)").bind(fid, uid, before.tour || 1).run();
    else await env.DB.prepare("DELETE FROM usine_choix WHERE faction_id = ? AND usine_id = ?").bind(fid, uid).run();
    await audit(env, s, "usine_choix", a.entity_id, "revert", JSON.parse(a.after || "null"), before);
  } else if (a.entity === "usine_fini") {
    const [fid, tour] = a.entity_id.split(":").map(Number);
    if (before && before.fini) await env.DB.prepare("INSERT OR IGNORE INTO usine_fini (faction_id, tour, ts) VALUES (?, ?, ?)").bind(fid, tour, now()).run();
    else await env.DB.prepare("DELETE FROM usine_fini WHERE faction_id = ? AND tour = ?").bind(fid, tour).run();
    await audit(env, s, "usine_fini", a.entity_id, "revert", JSON.parse(a.after || "null"), before);
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

/* ------------------------------------------------- statut du serveur Minecraft */
// « Server List Ping » (le même échange que la liste des serveurs du jeu) : MOTD, version, joueurs. Gardé 10 s en cache.
const vint = (n) => { const out = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return out; };
const mcString = (str) => { const b = [...new TextEncoder().encode(str)]; return [...vint(b.length), ...b]; };
const packet = (body) => new Uint8Array([...vint(body.length), ...body]);
async function pingMinecraft(host, port, label) {
  const { connect } = await import("cloudflare:sockets");
  const sock = connect({ hostname: host, port });
  const t0 = Date.now();
  const timer = new Promise((_, ko) => setTimeout(() => ko(new Error("délai dépassé")), 4000));
  const run = (async () => {
    const w = sock.writable.getWriter();
    const portB = [(port >> 8) & 0xff, port & 0xff];
    await w.write(packet([0x00, ...vint(767), ...mcString(label), ...portB, 0x01]));  // handshake → état « status »
    await w.write(packet([0x00]));                                                     // demande de statut
    const r = sock.readable.getReader();
    let buf = new Uint8Array(0);
    const readVar = (pos) => { let v = 0, i = 0, b; do { if (pos + i >= buf.length) return null; b = buf[pos + i]; v |= (b & 0x7f) << (7 * i); i++; } while (b & 0x80 && i < 5); return [v, pos + i]; };
    for (;;) {
      const { value, done } = await r.read();
      if (done) throw new Error("connexion fermée");
      const nb = new Uint8Array(buf.length + value.length); nb.set(buf); nb.set(value, buf.length); buf = nb;
      const len = readVar(0); if (!len) continue;
      if (buf.length < len[1] + len[0]) continue;
      const id = readVar(len[1]); const sl = readVar(id[1]);
      const text = new TextDecoder().decode(buf.slice(sl[1], sl[1] + sl[0]));
      return { data: JSON.parse(text), ms: Date.now() - t0 };
    }
  })();
  try { return await Promise.race([run, timer]); } finally { try { sock.close(); } catch (_) {} }
}
async function serverStatus(env, ctx) {
  const cache = caches.default, key = new Request(new URL("/__cache/status", env.PUBLIC_URL).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  const host = env.MC_HOST || "play.sumenium.com", port = Number(env.MC_PORT || 25565);
  let out;
  try {
    const { data, ms } = await pingMinecraft(host, port, env.MC_ADDRESS || "play.sumenium.com");
    const pl = data.players || {};
    out = { online: true, ms, motd: data.description ?? "", version: (data.version || {}).name || "",
      players: { online: pl.online || 0, max: pl.max || 0, sample: (pl.sample || []).map((x) => x.name).filter((n) => /^[A-Za-z0-9_]{1,16}$/.test(n)) },
      favicon: typeof data.favicon === "string" && data.favicon.startsWith("data:image/png;base64,") && data.favicon.length < 20000 ? data.favicon : null };
  } catch (e) {
    out = { online: false, error: String(e && e.message || e).slice(0, 120) };
  }
  out.checked = new Date().toISOString();
  // 10 s en cache côté Cloudflare (un seul ping pour tous les visiteurs), rien côté navigateur
  ctx.waitUntil(cache.put(key, json(out, 200, { "cache-control": "public, max-age=10" })));
  return json(out, 200, { "cache-control": "no-store" });
}

async function allData(env, s) {
  // Une seule requête groupée vers la base (un aller-retour au lieu de quinze). s = null : visiteur non connecté.
  const pub = !s;
  s = s || { id: "", level: null };
  const staff = s.level === "staff";
  const Q = (sql, ...a) => env.DB.prepare(sql).bind(...a);
  const myFaction = "(SELECT faction_id FROM players WHERE discord_id = ? AND deleted = 0)";
  const [meR, playersR, factionsR, usinesR, choixR, projetsR, realisesR, prixR, settingsR, basesR, candidatsR, votesR, resultsR, wlCountR, wlFreeR, finiR, facDemR, projDemR] = await env.DB.batch([
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
    Q("SELECT faction_id, tour FROM usine_fini"),
    Q("SELECT d.*, p.mc_name AS auteur FROM faction_demandes d JOIN players p ON p.id = d.player_id WHERE d.statut = 'attente' OR d.updated > ? ORDER BY d.id DESC", now() - 30 * 86400),
    staff ? Q("SELECT d.*, p.mc_name AS auteur FROM projet_demandes d JOIN players p ON p.id = d.player_id WHERE d.statut = 'attente' OR d.updated > ? ORDER BY d.id DESC", now() - 30 * 86400)
      : Q(`SELECT d.*, p.mc_name AS auteur FROM projet_demandes d JOIN players p ON p.id = d.player_id WHERE d.faction_id = ${myFaction} AND (d.statut = 'attente' OR d.updated > ?) ORDER BY d.id DESC`, s.id, now() - 30 * 86400),
  ]);
  const me = meR.results[0] || null;
  const players = playersR.results.map((p) => {
    const own = me && me.id === p.id;
    const out = { id: p.id, mc_name: p.mc_name, faction_id: p.faction_id, metier: p.metier, metier_desc: p.metier_desc,
      perso_desc: p.perso_desc, activite: p.activite, mort: p.mort };
    if (!pub) Object.assign(out, { linked: !!p.discord_id, whitelisted: !!p.wl, taille_appliquee: p.taille_appliquee });
    if (staff || own) Object.assign(out, { taille_cm: p.taille_cm, taille_fixe: !!p.taille_fixe, discord_name: p.discord_name || null });
    return out;
  });
  let settings = Object.fromEntries(settingsR.results.map((r) => [r.key, r.value]));
  if (!staff) settings = { election: settings.election, usines_ouvertes: settings.usines_ouvertes, usine_tour: settings.usine_tour, factions_ouvertes: settings.factions_ouvertes };
  return {
    user: pub ? null : { id: s.id, name: s.name, avatar: s.avatar, level: s.level },
    players, factions: factionsR.results, usines: usinesR.results, choix: choixR.results, projets: projetsR.results,
    usineTours: USINE_TOURS, usineMax: USINE_MAX, usineFini: finiR.results, saisonDebut: SAISON_DEBUT, mcColors: MC_COLORS,
    factionDemandes: pub ? [] : facDemR.results.map((d) => ({ ...d, membres: JSON.parse(d.membres || "[]") })),
    projetDemandes: pub ? [] : projDemR.results,
    realises: staff ? realisesR.results : realisesR.results.map(({ note, ...r }) => r), settings, bases: basesR.results, candidats: candidatsR.results,
    myVotes: Object.fromEntries(votesR.results.map((v) => [v.tour, v.candidat_id])),
    results: staff || settings.election === "resultats" ? resultsR.results : null,
    meId: me ? me.id : null, wlSynced: !pub && wlCountR.results[0].n > 0, wlFree: staff ? wlFreeR.results.map((r) => r.mc_name) : null,
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
