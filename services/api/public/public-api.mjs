/**
 * SCRBRD — the signed-out pages (SCRBRD-083 phase 1).
 *
 * docs/design/SCRBRD-083_public_pages.md §2. Every route here runs as the
 * ANONYMOUS principal whatever the request carries: an Authorization header,
 * a staff token, a pad credential — none of it is read, so a signed-in coach
 * who opens a public link sees exactly what a stranger sees, byte for byte
 * (§2.1). Anonymous, every row-level policy in db/ denies, and the only data
 * reachable is what db/59's public_*() functions return: the header, the
 * log, the people the log names (for the formatter, never sent), and the
 * team's shot sectors. redact.mjs applies the rule to the log before
 * anything is serialised.
 *
 *   GET /api/public/matches/:id           the header (team level)
 *   GET /api/public/matches/:id/log       the redacted log (?since=seq)
 *   GET /api/public/matches/:id/shots     the team's sectors (L7)
 *   GET /api/public/competitions/:id/standings  a published competition's table
 *                                         (SCRBRD-114 phase 3a, db/69): sides and
 *                                         figures, never a boy, never a reason (A1)
 *   GET /live/:id, /scorecard/:id         the HTML shells (noindex; OG title)
 *   GET /table/:id, /fixtures/:id         phase 2: answered as not found
 *
 * OFF UNTIL SWITCHED ON. `enabled` comes from PUBLIC_PAGES=on (server.mjs);
 * off, every one of these paths is the same 404 an unknown fixture gets,
 * because go-live waits on the information officer's written confirmation
 * of PUBLIC_DATA.md (the design's phase 1 "before live").
 *
 * NOT FOUND IS ONE ANSWER. An unpublished fixture, a fixture that does not
 * exist, an id that is not a uuid and a switched-off deployment all get the
 * same status, the same headers and the same body (principle 10).
 *
 * CACHING (§2.6). Each read is cached per fixture for 5 s while it is live and
 * 60 s otherwise (doubled while one fixture takes more than HOT_PER_MINUTE
 * requests a minute), and dropped at once when db/59's triggers say something
 * it depends on changed (LISTEN public_data_changed): a withdrawn consent, a
 * never-public mark, a names-off switch, a publication, a guardian link, a
 * surname. If the LISTEN connection is down the TTL is the ceiling, and on
 * reconnecting everything is dropped (a notification may have been missed).
 * At the edge: `no-store` on the log (it carries labels) and on every 404,
 * 429 and shell; `public, max-age=30` on the header and the sectors, which
 * are team facts.
 *
 * RATE LIMIT (§2.8). A token bucket per client address: 120 a minute, bursts
 * of 30, then 429 with Retry-After. The address is the socket's, or — behind
 * `trustProxyHops` proxies that append to X-Forwarded-For (Cloud Run, Render,
 * Firebase Hosting) — the one that many hops from the right, which a client
 * cannot forge by sending its own header.
 *
 * No access log row is written (there is no principal to log against) and
 * nothing is counted per page (§9 Q8, decided no).
 */
import pg from "pg";
import { ANON, withPrincipal } from "../auth/auth.mjs";
import { ROBOTS } from "@scrbrd/policy/public";
import { projectLog } from "./redact.mjs";
import { resultFromRow, resultWords } from "@scrbrd/scoring";
/** @import { IncomingMessage, ServerResponse } from "node:http" */
/** @import { Pool, Db } from "../api-types.mjs" */
/** @import { PublicLog, PersonRow, LogRow } from "./redact.mjs" */

export const LIVE_TTL_MS = 5_000;
export const SETTLED_TTL_MS = 60_000;
export const HOT_PER_MINUTE = 2_000;
export const RATE = Object.freeze({ perMinute: 120, burst: 30 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API = /^\/api\/public\/matches\/([^/]+)(\/log|\/shots)?$/;
/** A published competition's table (SCRBRD-114 phase 3a). */
const STANDINGS = /^\/api\/public\/competitions\/([^/]+)\/standings$/;
const SHELL = /^\/(live|scorecard|table|fixtures)\/([^/]+)$/;
/** The two shells phase 1 serves; the other two answer not found until phase 2. */
const SERVED_SHELLS = new Set(["live", "scorecard"]);

/** Is this a path the public router answers (on or off)? @param {string} path */
export const isPublicPath = (path) => path.startsWith("/api/public/") || SHELL.test(path);

// ── Headers ─────────────────────────────────────────────────────

/** Every public response carries these (D1, §2.7). */
export const PUBLIC_HEADERS = Object.freeze({
  "x-robots-tag": ROBOTS,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
});
/** The shells say nofollow too, as the robots meta in them does. */
const SHELL_ROBOTS = `${ROBOTS}, nofollow`;
export const NO_STORE = "no-store";
export const TEAM_LEVEL = "public, max-age=30";

/** The one not-found body, for every reason a public read has nothing. */
export const NOT_FOUND = JSON.stringify({ error: "not_found" });

// ── The cache ───────────────────────────────────────────────────

/**
 * @template T
 * @typedef {{value: T, at: number, ttl: number}} Held
 */
/**
 * One fixture's cached answers, and what they depend on.
 * @typedef {object} Entry
 * @property {Held<any> | undefined} [header]
 * @property {Held<any> | undefined} [log]      a PublicLog
 * @property {Held<any> | undefined} [shots]
 * @property {Held<any> | undefined} [standings]  a competition's table, keyed by its id
 * @property {Set<string>} players   the real player ids its log names
 * @property {Map<string, Promise<any>>} inflight
 */

/**
 * How many fixtures the cache holds at once. A request for any well-formed
 * id makes an entry (a "not found" is cached like an answer, so a missing
 * fixture and an unpublished one cost the same), so without a bound a script
 * walking random ids from many addresses would grow it without end. The
 * oldest entry goes first; a school's busy Saturday is a few hundred.
 */
export const MAX_ENTRIES = 5_000;

/**
 * The per-fixture cache. `drop()` is what a notification calls.
 */
export class PublicCache {
  /** @param {() => number} now @param {number} [max] */
  constructor(now, max = MAX_ENTRIES) {
    this.now = now;
    this.max = max;
    /** @type {Map<string, Entry>} */
    this.entries = new Map();
    /** @type {Map<string, number>} requests this minute, per fixture */
    this.hits = new Map();
    this.minute = -1;
  }

  /** @param {string} matchId @returns {Entry} */
  entry(matchId) {
    let e = this.entries.get(matchId);
    if (!e) {
      e = { players: new Set(), inflight: new Map() };
      this.entries.set(matchId, e);
      // A Map iterates in insertion order: the first key is the oldest.
      while (this.entries.size > this.max) this.entries.delete(/** @type {string} */ (this.entries.keys().next().value));
    }
    return e;
  }

  /** Count a request for a fixture; true while it is hot. @param {string} matchId */
  hit(matchId) {
    const minute = Math.floor(this.now() / 60_000);
    // One minute's counts at a time, so the map never outlives the minute.
    if (minute !== this.minute) { this.hits.clear(); this.minute = minute; }
    const n = (this.hits.get(matchId) ?? 0) + 1;
    this.hits.set(matchId, n);
    return n > HOT_PER_MINUTE;
  }

  /**
   * The cached answer for `part`, or a fresh one from `load()` — one load at
   * a time per fixture and part, however many requests arrive together.
   * @template T
   * @param {string} matchId @param {"header" | "log" | "shots" | "standings"} part
   * @param {number} ttl @param {() => Promise<T>} load
   * @returns {Promise<T>}
   */
  async get(matchId, part, ttl, load) {
    const e = this.entry(matchId);
    const held = e[part];
    if (held && this.now() - held.at < held.ttl) return held.value;
    const pending = e.inflight.get(part);
    if (pending) return pending;
    const p = (async () => {
      try {
        const value = await load();
        // Stored only if nothing dropped this fixture while it loaded: a
        // notification that arrived mid-query must not be undone by the
        // answer that was already on its way.
        if (this.entries.get(matchId) === e) {
          e[part] = { value, at: this.now(), ttl };
          if (part === "log") for (const id of /** @type {PublicLog} */ (value)?.playerIds ?? []) e.players.add(id);
        }
        return value;
      } finally {
        e.inflight.delete(part);
      }
    })();
    e.inflight.set(part, p);
    return p;
  }

  /**
   * A change the database announced. A fixture's own change drops it; a
   * player's drops every fixture whose log names him; anything else (a
   * school's names-off switch, a competition, a message this build does not
   * know) drops everything, which is always safe.
   * @param {{k?: unknown, id?: unknown} | null} note
   */
  drop(note) {
    const id = typeof note?.id === "string" ? note.id.toLowerCase() : null;
    if (note?.k === "match" && id) { this.entries.delete(id); return; }
    if (note?.k === "player" && id) {
      for (const [m, e] of this.entries) if (e.players.has(id)) this.entries.delete(m);
      return;
    }
    this.entries.clear();
  }
}

// ── The rate limit ──────────────────────────────────────────────

/** A token bucket per client address. */
export class RateLimit {
  /** @param {() => number} now @param {{perMinute: number, burst: number}} [rate] */
  constructor(now, rate = RATE) {
    this.now = now;
    this.rate = rate;
    /** @type {Map<string, {tokens: number, at: number}>} */
    this.buckets = new Map();
    this.swept = now();
  }

  /**
   * Take one token for `ip`. 0 when allowed; otherwise the whole seconds to
   * wait before the next token.
   * @param {string} ip
   */
  take(ip) {
    const t = this.now();
    const perMs = this.rate.perMinute / 60_000;
    const b = this.buckets.get(ip) ?? { tokens: this.rate.burst, at: t };
    b.tokens = Math.min(this.rate.burst, b.tokens + (t - b.at) * perMs);
    b.at = t;
    this.buckets.set(ip, b);
    this.sweep(t);
    if (b.tokens >= 1) { b.tokens -= 1; return 0; }
    return Math.max(1, Math.ceil((1 - b.tokens) / perMs / 1000));
  }

  /** Forget buckets that have refilled: they hold nothing a new one would not. @param {number} t */
  sweep(t) {
    if (t - this.swept < 60_000) return;
    this.swept = t;
    const full = (this.rate.burst / this.rate.perMinute) * 60_000;
    for (const [ip, b] of this.buckets) if (t - b.at > full) this.buckets.delete(ip);
  }
}

/**
 * The client's address. With `hops` trusted proxies in front, each of which
 * appends the address it received from to X-Forwarded-For, the client is the
 * entry `hops` from the right; whatever the client wrote itself is further
 * left and is never read. With none, the socket's.
 * @param {IncomingMessage} req @param {number} hops
 */
export function clientAddress(req, hops) {
  const socket = req.socket?.remoteAddress ?? "unknown";
  if (!hops) return socket;
  const raw = req.headers["x-forwarded-for"];
  const chain = String(Array.isArray(raw) ? raw.join(",") : raw ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return chain.length >= hops ? chain[chain.length - hops] : socket;
}

// ── The shells ──────────────────────────────────────────────────

const esc = (/** @type {unknown} */ s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/**
 * The theme's first decision, before anything paints — the same few lines as
 * apps/web/index.html's (public.test.mjs holds them equal), so a public page
 * opened in daylight does not flash the dark one.
 */
export const THEME_BOOT = `(function () {
        var t = "floodlit", m;
        try {
          var p = localStorage.getItem("scrbrd:theme");
          if (p === "daylight" || p === "floodlit") t = p;
          else if (window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches) t = "daylight";
        } catch (e) {
          try { if (matchMedia("(prefers-color-scheme: light)").matches) t = "daylight"; } catch (e2) { /* floodlit */ }
        }
        var d = document.documentElement, bg = t === "daylight" ? "#eef0ea" : "#05070a";
        d.setAttribute("data-theme", t);
        d.style.colorScheme = t === "daylight" ? "light" : "dark";
        d.style.background = bg;
        m = document.querySelector('meta[name="theme-color"]');
        if (m) m.setAttribute("content", bg);
      })();`;

/**
 * "Hilton College 1XI v Westville Boys' High 1XI" and the score by innings:
 * the WhatsApp preview (D3). Team facts only.
 * @param {any} h  the header
 */
export function shellTitle(h) {
  const sides = `${h.homeLabel ?? h.homeTeam ?? "Home"} v ${h.awayLabel ?? "Away"}`;
  const score = (h.scores ?? []).map((/** @type {any} */ s) => `${s.runs ?? 0}/${s.wickets ?? 0}`).join(" & ");
  return score ? `${sides} · ${score}` : sides;
}

/**
 * The page a shell serves: the public bundle, told which fixture and which
 * view, and nothing about any child.
 * @param {{view: string, matchId: string, header: any}} o
 */
export function shellHtml({ view, matchId, header }) {
  const title = shellTitle(header);
  const what = view === "scorecard" ? "Scorecard" : "Live score";
  return `<!doctype html>
<html lang="en-ZA">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="${SHELL_ROBOTS}" />
    <meta name="referrer" content="no-referrer" />
    <meta name="theme-color" content="#05070a" />
    <meta name="color-scheme" content="dark light" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(what)} · SCRBRD" />
    <title>${esc(title)} · SCRBRD</title>
    <script>
      ${THEME_BOOT}
    </script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root" data-view="${esc(view)}" data-match="${esc(matchId)}"></div>
    <script type="module" src="/public-app.js"></script>
  </body>
</html>
`;
}

/** The one not-found page: the same for every reason there is nothing. */
export const NOT_FOUND_HTML = `<!doctype html>
<html lang="en-ZA">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="${SHELL_ROBOTS}" />
    <title>Not found · SCRBRD</title>
  </head>
  <body style="font-family:system-ui,sans-serif;background:#05070a;color:#e8ecef;padding:24px">
    <h1 style="font-size:20px">This page is not available.</h1>
    <p>The link may be wrong, or the match may not be public.</p>
  </body>
</html>
`;

// ── The router ──────────────────────────────────────────────────

/**
 * @typedef {object} PublicOptions
 * @property {Pool} pool
 * @property {boolean} enabled          PUBLIC_PAGES=on
 * @property {string | null} secret     PUBLIC_PSEUDONYM_SECRET (required when enabled)
 * @property {number} [trustProxyHops]  PUBLIC_TRUST_PROXY_HOPS
 * @property {string | null} [listenUrl] where to LISTEN; none, no notifications (tests)
 * @property {() => number} [now]
 * @property {{perMinute: number, burst: number}} [rate]
 */

/** @param {PublicOptions} o */
export function publicPages({ pool, enabled, secret, trustProxyHops = 0, listenUrl = null, now = Date.now, rate = RATE }) {
  if (enabled && !secret) throw new Error("public pages need PUBLIC_PSEUDONYM_SECRET");
  const cache = new PublicCache(now);
  const limit = new RateLimit(now, rate);
  const listener = enabled && listenUrl ? listen(listenUrl, cache) : null;

  /** Run `fn` as nobody: RLS denies every table, and only db/59's definers answer. @template T @param {(c: Db) => Promise<T>} fn */
  const asNobody = async (fn) => {
    const client = await pool.connect();
    try { return await withPrincipal(client, ANON, fn); } finally { client.release(); }
  };

  /** @param {any} h @param {boolean} hot */
  const ttlFor = (h, hot) => (h?.status === "live" ? LIVE_TTL_MS : SETTLED_TTL_MS) * (hot ? 2 : 1);

  /** The header, or null for a fixture that is not served. @param {string} id @param {boolean} hot */
  const header = (id, hot) => cache.get(id, "header", SETTLED_TTL_MS * (hot ? 2 : 1), async () => {
    const { rows } = await asNobody((c) => c.query(`select * from public_match_header($1)`, [id]));
    const r = rows[0];
    if (!r) return null;
    // The match's frozen playing conditions (SCRBRD-114, db/61), so the page
    // folds the log as the server does: a league with no free hit stands the
    // wicket there too. None for a match with no document.
    const { rows: pc } = await asNobody((c) => c.query(`select play, doc_hash from public_match_conditions($1)`, [id]));
    // The result as the server reads it (SCRBRD-114 phase 3a, db/69): who won
    // and by what, and a decision's kind and side — never its reason.
    const { rows: pr } = await asNobody((c) => c.query(`select * from public_match_result($1)`, [id]));
    return {
      conditions: pc[0]?.play ?? null, conditionsHash: pc[0]?.doc_hash ?? null,
      id,
      homeLabel: r.home_label, homeCode: r.home_code, homeTeam: r.home_team,
      awayLabel: r.away_label, awayCode: r.away_code, awayTeam: r.away_team, awayOnPlatform: r.away_on_platform,
      sport: r.sport, format: r.format, overs: r.overs,
      startsAt: r.starts_at ? new Date(r.starts_at).toISOString() : null,
      ground: r.ground, status: r.status,
      tossWonBy: r.toss_won_by, tossDecision: r.toss_decision,
      published: { home: r.home_published === true, away: r.away_published === true },
      scores: (r.scores ?? []).map((/** @type {any} */ s) => ({
        innings: Number(s.innings), runs: s.runs == null ? null : Number(s.runs),
        wickets: Number(s.wickets ?? 0), balls: Number(s.balls ?? 0) })),
      servedOn: r.served_on,
      result: publicResult(pr[0], { home: r.home_label ?? r.home_team ?? "Home", away: r.away_label ?? "Away" }),
    };
  }).then(async (h) => {
    // A live fixture's header lives 5 s, not 60: re-read once the short TTL is up.
    if (h && h.status === "live") {
      const e = cache.entry(id);
      if (e.header) e.header.ttl = ttlFor(h, hot);
    }
    return h;
  });

  /** @param {string} id @param {any} h @param {boolean} hot @returns {Promise<PublicLog>} */
  const log = (id, h, hot) => cache.get(id, "log", ttlFor(h, hot), async () => {
    const { people, rows } = await asNobody(async (c) => {
      // People first: an event that arrives between the two reads names
      // someone this set lacks, and he is shown as a position until the next
      // read — never the other way round.
      const people = /** @type {PersonRow[]} */ ((await c.query(`select * from public_match_people($1)`, [id])).rows);
      const rows = /** @type {LogRow[]} */ ((await c.query(`select * from public_match_log($1, 0)`, [id])).rows);
      return { people, rows };
    });
    return projectLog({ rows, people, secret: /** @type {string} */ (secret), matchId: id, on: h.servedOn });
  });

  /** @param {string} id @param {any} h @param {boolean} hot */
  const shots = (id, h, hot) => cache.get(id, "shots", ttlFor(h, hot), async () => {
    const { rows } = await asNobody((c) => c.query(`select * from public_shot_sectors($1)`, [id]));
    return rows.map((r) => ({ innings: Number(r.innings), sector: Number(r.sector), shots: Number(r.shots), runs: Number(r.runs) }));
  });

  /** A published competition's table, or null. @param {string} id @param {boolean} hot */
  const standings = (id, hot) => cache.get(id, "standings", SETTLED_TTL_MS * (hot ? 2 : 1), async () => {
    const { rows } = await asNobody((c) => c.query(`select * from public_competition_standing($1)`, [id]));
    if (!rows.length) return null;
    return rows.map((r) => ({
      rank: r.rank, division: r.division ?? null, side: r.side, played: r.played, won: r.won, lost: r.lost, tied: r.tied,
      drawn: r.drawn, noResult: r.no_result, points: r.points == null ? null : Number(r.points),
      nrr: r.nrr == null ? null : Number(r.nrr), basis: r.basis,
    }));
  });

  /**
   * @param {ServerResponse} res @param {number} status @param {string} body
   * @param {{type?: string, cache: string, robots?: string, extra?: Record<string, string>}} h
   * @param {boolean} head
   */
  const send = (res, status, body, { type = "application/json; charset=utf-8", cache: cc, robots, extra = {} }, head) => {
    res.writeHead(status, {
      ...PUBLIC_HEADERS, ...(robots ? { "x-robots-tag": robots } : {}),
      "content-type": type, "cache-control": cc, "content-length": Buffer.byteLength(body), ...extra,
    });
    res.end(head ? undefined : body);
  };
  /** @param {ServerResponse} res @param {boolean} shell @param {boolean} head */
  const notFound = (res, shell, head) => (shell
    ? send(res, 404, NOT_FOUND_HTML, { type: "text/html; charset=utf-8", cache: NO_STORE, robots: SHELL_ROBOTS }, head)
    : send(res, 404, NOT_FOUND, { cache: NO_STORE }, head));

  /**
   * Answer a request if it is a public one. Returns false for every other
   * path, having touched nothing.
   * @param {IncomingMessage} req @param {ServerResponse} res
   * @returns {Promise<boolean>}
   */
  async function handle(req, res) {
    const url = new URL(/** @type {string} */ (req.url), "http://public.invalid");
    const path = url.pathname;
    if (!isPublicPath(path)) return false;
    const shellMatch = SHELL.exec(path);
    const shell = !!shellMatch;
    const head = req.method === "HEAD";
    if (!enabled || (req.method !== "GET" && !head)) { notFound(res, shell, head); return true; }

    const wait = limit.take(clientAddress(req, trustProxyHops));
    if (wait) {
      send(res, 429, shell ? "Too many requests. Try again shortly.\n" : JSON.stringify({ error: "rate_limited" }),
        { type: shell ? "text/plain; charset=utf-8" : "application/json; charset=utf-8", cache: NO_STORE,
          extra: { "retry-after": String(wait) } }, head);
      return true;
    }

    const standingsMatch = STANDINGS.exec(path);
    if (standingsMatch) {
      const cid = standingsMatch[1].toLowerCase();
      if (!UUID.test(cid)) { notFound(res, false, head); return true; }
      try {
        const rows = await standings(cid, cache.hit(cid));
        if (!rows) { notFound(res, false, head); return true; }
        send(res, 200, JSON.stringify({ competitionId: cid, rows }), { cache: TEAM_LEVEL }, head);
      } catch (/** @type {any} */ err) {
        console.error(`GET ${path} (public) →`, err.code || "", err.message);
        send(res, 503, JSON.stringify({ error: "unavailable" }), { cache: NO_STORE }, head);
      }
      return true;
    }
    const apiMatch = API.exec(path);
    const id = (shellMatch ? shellMatch[2] : apiMatch?.[1] ?? "").toLowerCase();
    if (!UUID.test(id) || (shellMatch && !SERVED_SHELLS.has(shellMatch[1])) || (!shellMatch && !apiMatch)) {
      notFound(res, shell, head); return true;
    }
    try {
      const hot = cache.hit(id);
      const h = await header(id, hot);
      if (!h) { notFound(res, shell, head); return true; }
      if (shellMatch) {
        send(res, 200, shellHtml({ view: shellMatch[1], matchId: id, header: h }),
          { type: "text/html; charset=utf-8", cache: NO_STORE, robots: SHELL_ROBOTS }, head);
      } else if (!apiMatch?.[2]) {
        const { servedOn: _day, conditions: _conditions, conditionsHash: _hash, ...match } = h;
        send(res, 200, JSON.stringify({ match, fold: { startsAt: h.startsAt, format: h.format,
          ...(h.conditions ? { conditions: h.conditions, conditionsHash: h.conditionsHash } : {}) } }), { cache: TEAM_LEVEL }, head);
      } else if (apiMatch[2] === "/log") {
        const l = await log(id, h, hot);
        const since = Math.max(0, Number.parseInt(url.searchParams.get("since") ?? "0", 10) || 0);
        send(res, 200, JSON.stringify({
          matchId: id, servedOn: h.servedOn, last: l.last,
          events: since ? l.events.filter((e) => e.seq > since) : l.events,
          people: l.people,
        }), { cache: NO_STORE }, head);
      } else {
        send(res, 200, JSON.stringify({ matchId: id, sectors: await shots(id, h, hot) }), { cache: TEAM_LEVEL }, head);
      }
    } catch (/** @type {any} */ err) {
      console.error(`GET ${path} (public) →`, err.code || "", err.message);
      send(res, 503, JSON.stringify({ error: "unavailable" }), { cache: NO_STORE }, head);
    }
    return true;
  }

  return {
    handle,
    cache,
    /** Stop listening (tests, shutdown). */
    close: () => listener?.close(),
    /** Whether the LISTEN connection is up, for /api/health. */
    listening: () => listener?.up() ?? false,
  };
}

/**
 * The result on the public page (SCRBRD-114 phase 3a): public_match_result()'s
 * row as structure and words, each side named by its label. A decision's
 * reason is not in the row and so not in the words (PUBLIC_DATA §3).
 * @param {any} row  @param {{home: string, away: string}} names
 */
export function publicResult(row, names) {
  if (!row) return null;
  const r = resultFromRow({ ...row, decision: row.decision_kind ? { kind: row.decision_kind, side: row.decision_side,
                                                                     overrides_play: row.decision_overrides_play === true } : null });
  if (!r) return null;
  return {
    outcome: r.outcome, marginKind: r.marginKind, margin: r.marginValue, decidedBy: r.decidedBy, winnerSide: r.winnerSide,
    playOutcome: r.playOutcome, playWinnerSide: r.playWinnerSide, playMarginKind: r.playMarginKind, playMargin: r.playMarginValue,
    decisionApplied: r.decisionApplied,
    decision: r.decision ? { kind: r.decision.kind, side: r.decision.side, overridesPlay: r.decision.overridesPlay === true } : null,
    text: resultWords(r, { reasons: false, nameOf: (key, side) => (side === "away" ? names.away : names.home) }),
  };
}

/**
 * LISTEN public_data_changed on a connection of its own, and drop what each
 * notification touches. Reconnects after a failure; on (re)connecting the
 * whole cache is dropped, because a change may have happened while nobody
 * was listening.
 * @param {string} url @param {PublicCache} cache
 */
function listen(url, cache) {
  /** @type {pg.Client | null} */
  let client = null;
  let up = false;
  let closed = false;
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  const retry = () => {
    up = false;
    if (closed || timer) return;
    timer = setTimeout(() => { timer = null; connect(); }, 5_000);
    timer.unref?.();
  };
  const connect = async () => {
    if (closed) return;
    const c = new pg.Client({ connectionString: url });
    client = c;
    c.on("error", () => { c.end().catch(() => {}); retry(); });
    c.on("end", retry);
    c.on("notification", (n) => {
      if (n.channel !== "public_data_changed") return;
      /** @type {any} */
      let note;
      try { note = JSON.parse(n.payload ?? "null"); } catch { note = null; }
      cache.drop(note);
    });
    try {
      await c.connect();
      await c.query("LISTEN public_data_changed");
      cache.drop(null);
      up = true;
    } catch {
      c.end().catch(() => {});
      retry();
    }
  };
  connect();
  return {
    up: () => up,
    close: () => { closed = true; if (timer) clearTimeout(timer); up = false; client?.end().catch(() => {}); },
  };
}
