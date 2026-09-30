#!/usr/bin/env node
/**
 * The scorebook importer, phase 1, through the API and against Postgres
 * (SCRBRD-120, db/63; docs/design/SCRBRD-120_scorebook_importer.md §8's
 * phase 1 proofs that an API can show; db/99 §41 holds the rest — the
 * support session, the pad's credential, the RLS zeros — with principals).
 *
 *   A. The module arrives off, and the route and the database both say so
 *   B. The photos: JPEG or PNG only, stripped of their metadata before they
 *      are stored; read only by the two roles at the school, each read on
 *      access_log; a parent, a pupil, another school and the principal
 *      (audit.read: the card, never a page) see none
 *   C. The card: saved as a card and nothing else; every cell ticked before a
 *      submit; the arithmetic in words
 *   D. Two people: the confirmer cannot save; a revision author and a
 *      submitter cannot confirm; a return needs a note
 *   E. The seal: a card whose ending disagrees with its figures is refused
 *      at the commit, and nothing is written
 *   F. The commit: three events per innings under the derived keys, the
 *      summary the constructor's shape, typed names in its typed map only;
 *      the difference acknowledged (D4); the match complete and scoring_claim
 *      refusing; the fold and SQL agree; no delivery reader sees an innings;
 *      the public log carries no typed name
 *   G. A league's fixture: confirmed by the league, not the director of
 *      sport; its conditions fixed under the version of its start day, and a
 *      later publish touches nothing
 *   H. Live or imported, never both: a summary over a live delivery is
 *      refused (LIVE_INNINGS); a ball after the commit goes nowhere near the
 *      log
 *   I. An approved amendment voiding a summary lets a new import through
 *   J. The purge: the photos deleted after the window, the rows kept; an
 *      abandoned import's at once
 *   K. The arithmetic's two halves agree over the PARITY list
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-scorebook.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import {
  inningsStart, batters, bowler, ball, BALL_TYPE, newEventId, fromRow, deriveMatch, inningsSummary,
  summaryCodes, cellPaths, ballsOfOvers,
} from "@scrbrd/scoring";
import { baseCard, TYPED, PARITY } from "../packages/scoring/test/scorebook-cards.mjs";
import { jpegWithMetadata, pngWithMetadata, SECRET_WORDS } from "../services/api/io/test-images.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8893);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();
const HIL = "11111111-1111-1111-1111-111111111111";
const LEAGUE = "99999999-0000-0000-0000-000000000001";
// Six Hilton boys (five of the 1st XI and one playing up) and the rest of the school.
const P = ["01", "02", "03", "04", "05", "11"].map((n) => `aaaaaaaa-0000-0000-0000-0000000000${n}`);
const DNB = ["12", "13", "06"].map((n) => `aaaaaaaa-0000-0000-0000-0000000000${n}`);
const STORE = mkdtempSync(join(tmpdir(), "scrbrd-smoke-scorebook-"));

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 500)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-scorebook-secret", SCOREBOOK_STORE_DIR: STORE,
         SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));
const pool = new pg.Pool({ connectionString: DB });
const q = async (text, params) => (await pool.query(text, params)).rows;

const api = async (path, { method = "GET", token, body, raw, type } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": type ?? "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const ct = res.headers.get("content-type") ?? "";
  if (ct.startsWith("image/")) return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
};
const login = async (email, deviceId = "sb-desk") =>
  (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId } })).body?.token;

/** A fixture two days ago, as a seed would write it (D13: the fixture exists first). */
const fixture = async ({ team = "1XI", competition = null, days = -2, opponent = "Opposition XI" } = {}) => (await q(
  `insert into match (school_id, team_code, opponent, starts_at, format, overs, status, competition_id)
   values ($1, $2, $3, (sa_today() + $4::int)::timestamp AT TIME ZONE 'Africa/Johannesburg' + interval '10 hours', 'T20', 20, 'scheduled', $5)
   returning id`, [HIL, team, opponent, days, competition]))[0].id;

/** The chase: the away side's reply, our boys bowling and fielding, one run short (a tie). */
const chaseCard = () => {
  const c = baseCard(["t:11", "t:12", "t:13", "t:14", "t:15", "t:16"]);
  const swap = { "t:1": P[0], "t:2": P[1], "t:3": P[2], "t:4": P[3], "t:5": P[4] };
  c.innings = 1; c.battingSide = "away";
  for (const b of c.batting) { b.fielderRef = swap[b.fielderRef] ?? b.fielderRef; b.bowlerRef = swap[b.bowlerRef] ?? b.bowlerRef; }
  for (const b of c.bowling) b.ref = swap[b.ref];
  return c;
};
const CHASE_TYPED = { "t:11": "Opp Opener Eleven", "t:12": "Opp Twelve", "t:13": "Opp Thirteen", "t:14": "Opp Fourteen",
                      "t:15": "Opp Fifteen", "t:16": "Opp Sixteen" };
const allTicked = (cards) => Object.fromEntries(cellPaths(cards).map((p) => [p, true]));
const accessRows = async (importId) => (await q(
  `select person_id, fields from access_log where resource = 'scorebook_page' and $1 = any(record_ids) order by occurred_at`, [importId]));

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const scorer = await login("scorer@example.invalid");      // scorer, Hilton: writes
  const scorerPad = await login("scorer@example.invalid", "sb-pad");   // the same scorer, on a pad
  const coach = await login("coach@example.invalid");        // coach of the 1st XI: writes
  const sarah = await login("sarah@example.invalid");        // director of sport (and a U16B coach): confirms
  const head = await login("principal@example.invalid");     // principal: audit.read, the card not the page
  const parent = await login("parent@example.invalid");
  const pupil = await login("spectator@example.invalid");    // a pupil (role player)
  const wes = await login("coach.wes@example.invalid");      // another school's coach
  const league = await login("league@example.invalid");      // competitionadmin, no school
  const platform = await login("platform@example.invalid");  // the platform's key: the purge
  const owner = await login("owner@example.invalid");
  ok("everyone signs in", [scorer, coach, sarah, head, parent, pupil, wes, league, platform, owner].every(Boolean));
  const health = await api("/api/health");
  ok("the store in development is a local directory", health.body?.pages === "local", JSON.stringify(health.body));

  const M = await fixture();

  // ── A ──────────────────────────────────────────────────────────
  group("A. The module arrives off");
  const off = await api(`/api/matches/${M}/scorebook`, { method: "POST", token: scorer });
  ok("the route refuses: module_disabled", off.status === 403 && off.body?.error === "module_disabled", JSON.stringify(off.body));
  const offList = await api(`/api/matches/${M}/scorebook`, { token: scorer });
  ok("the list tells the scorer so (module: false), what he may do, and no import",
     offList.status === 200 && offList.body?.module === false && offList.body?.may?.write === true && offList.body?.imports?.length === 0,
     JSON.stringify(offList.body));
  await q(`insert into feature_grant (key, school_id, granted, note) values ('scorebook_import', $1, true, 'smoke-scorebook')`, [HIL]);
  const early = await api(`/api/matches/${await fixture({ days: 3 })}/scorebook`, { method: "POST", token: scorer });
  ok("granted to Hilton: a fixture not yet played takes no import", early.body?.error === "not_yet_played", JSON.stringify(early.body));
  const opened = await api(`/api/matches/${M}/scorebook`, { method: "POST", token: scorer });
  ok("the scorer opens an import for the fixture", opened.status === 200 && /^[0-9a-f-]{36}$/.test(opened.body?.id ?? ""), JSON.stringify(opened.body));
  const I = opened.body.id;
  const again = await api(`/api/matches/${M}/scorebook`, { method: "POST", token: coach });
  ok("one open import per match (import_open, 409)", again.status === 409 && again.body?.error === "import_open" && again.body?.detail === I);
  ok("a parent opens nothing", (await api(`/api/matches/${M}/scorebook`, { method: "POST", token: parent })).status === 403);

  // ── B ──────────────────────────────────────────────────────────
  group("B. The photos");
  const jpg = jpegWithMetadata({ salt: 1 });
  const up1 = await api(`/api/scorebook/${I}/pages`, { method: "POST", token: scorer, raw: jpg, type: "image/jpeg" });
  ok("a JPEG is taken, as page 1, stripped", up1.status === 200 && up1.body?.pageNo === 1 && up1.body?.removed?.includes("APP1"), JSON.stringify(up1.body));
  const up2 = await api(`/api/scorebook/${I}/pages`, { method: "POST", token: coach, raw: pngWithMetadata({ salt: 2 }), type: "image/png" });
  ok("a PNG is taken, as page 2", up2.status === 200 && up2.body?.pageNo === 2, JSON.stringify(up2.body));
  ok("the same photo twice is refused by its hash", (await api(`/api/scorebook/${I}/pages`, { method: "POST", token: scorer, raw: jpg, type: "image/jpeg" })).body?.error === "duplicate_page");
  const svg = await api(`/api/scorebook/${I}/pages`, { method: "POST", token: scorer, raw: Buffer.from("<svg onload=alert(1)/>"), type: "image/png" });
  ok("anything but a JPEG or a PNG is refused, whatever it says it is (415)", svg.status === 415 && svg.body?.error === "not_an_image", JSON.stringify(svg.body));
  { const anon = await api(`/api/scorebook/${I}/pages`, { method: "POST", raw: pngWithMetadata({ salt: 4 }), type: "image/png" });
    ok("no token: refused before the photo is read", anon.status === 401 && anon.body?.error === "missing_token", JSON.stringify(anon.body)); }
  ok("a parent adds no page", (await api(`/api/scorebook/${I}/pages`, { method: "POST", token: parent, raw: pngWithMetadata({ salt: 3 }), type: "image/png" })).status === 403);
  const files = readdirSync(join(STORE, HIL, I));
  ok("two objects stored, under the school and the import", files.length === 2 && files.every((f) => /^[0-9a-f-]{36}\.(jpg|png)$/.test(f)), files.join());
  const kept = files.map((f) => readFileSync(join(STORE, HIL, I, f)));
  ok("no stored photo carries a GPS position, a device, a caption or a comment",
     kept.every((b) => SECRET_WORDS.every((w) => !b.includes(Buffer.from(w, "latin1")))));
  const pages = await q(`select page_no, object_key, sha256, bytes, mime from scorebook_import_page where import_id = $1 order by page_no`, [I]);
  ok("the rows say what was stored", pages.length === 2 && pages[0].mime === "image/jpeg" && pages[1].mime === "image/png");

  const before = (await accessRows(I)).length;
  const read1 = await api(`/api/scorebook/${I}/pages/1`, { token: scorer });
  ok("the scorer reads page 1: the stored bytes, never cached, sniffing off",
     read1.status === 200 && read1.bytes?.length === pages[0].bytes && read1.headers.get("cache-control")?.includes("no-store")
     && read1.headers.get("x-content-type-options") === "nosniff", read1.status);
  const read2 = await api(`/api/scorebook/${I}/pages/2`, { token: sarah });
  ok("the director of sport reads page 2", read2.status === 200 && read2.headers.get("content-type") === "image/png");
  const log = await accessRows(I);
  ok("each read wrote access_log: who, the import, page:<n>", log.length === before + 2
     && log.at(-2)?.person_id === "88888888-0000-0000-0000-000000000006" && log.at(-2)?.fields?.[0] === "page:1"
     && log.at(-1)?.person_id === "88888888-0000-0000-0000-000000000007" && log.at(-1)?.fields?.[0] === "page:2", JSON.stringify(log));
  for (const [who, t] of [["a parent", parent], ["a pupil", pupil], ["another school's coach", wes], ["the principal (audit.read)", head]]) {
    const r = await api(`/api/scorebook/${I}/pages/1`, { token: t });
    ok(`${who} reads no page (403)`, r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
  }
  ok("...and none of those reads was logged as a read", (await accessRows(I)).length === before + 2);
  ok("signed out: nothing", (await api(`/api/scorebook/${I}/pages/1`)).status >= 400);
  { const hg = await api(`/api/scorebook/${I}`, { token: head });
    ok("the principal reads the card and its history (audit.read), and is given no name by the import",
       hg.status === 200 && Object.keys(hg.body?.names ?? { x: 1 }).length === 0, JSON.stringify(hg.body?.names));
    ok("...nor the name of anybody in its history", hg.body?.revisions?.length > 0 && hg.body.revisions.every((r) => r.actorId && r.actorName === null)); }
  for (const [who, t] of [["a parent", parent], ["a pupil", pupil], ["another school's coach", wes]]) {
    ok(`${who} reads no import`, (await api(`/api/scorebook/${I}`, { token: t })).status === 403);
  }
  const wesList = await api(`/api/matches/${M}/scorebook`, { token: wes });
  ok("another school's coach lists none for the match (the fixture is not his)", wesList.status === 403 && !wesList.body?.imports, JSON.stringify(wesList.body));
  ok("the coach lists the one open import, with its pages", (await api(`/api/matches/${M}/scorebook`, { token: coach })).body?.imports?.[0]?.pages === 2);
  // What each person is told they may do: the functions' own checks (§9.4 2).
  const mayOf = async (t) => { const r = await api(`/api/matches/${M}/scorebook`, { token: t }); return r.status === 200 ? `${r.body.module}:${["write", "confirm", "read"].filter((k) => r.body.may?.[k]).join("+")}` : r.status; };
  ok("the scorer is told write and read, the module on", await mayOf(scorer) === "true:write+read", await mayOf(scorer));
  ok("the director of sport confirm and read", await mayOf(sarah) === "true:confirm+read", await mayOf(sarah));
  ok("the principal (audit.read) none of the three, and still lists", await mayOf(head) === "true:", await mayOf(head));
  for (const [who, t] of [["a parent", parent], ["a pupil", pupil], ["the league's administrator, on a friendly", league]]) ok(`${who} may do nothing: 403`, await mayOf(t) === 403, await mayOf(t));
  ok("...and the league's administrator reads no friendly's import, and no page of it",
     (await api(`/api/scorebook/${I}`, { token: league })).status === 403 && (await api(`/api/scorebook/${I}/pages/1`, { token: league })).status === 403);
  ok("the import says the same to each", (await api(`/api/scorebook/${I}`, { token: sarah })).body?.may?.confirm === true
     && (await api(`/api/scorebook/${I}`, { token: scorer })).body?.may?.write === true && (await api(`/api/scorebook/${I}`, { token: scorer })).body?.may?.confirm === false);

  // A wrong photo, taken off by a writer and by nobody else (§9.4 1).
  const wrong = await api(`/api/scorebook/${I}/pages`, { method: "POST", token: scorer, raw: pngWithMetadata({ salt: 5 }), type: "image/png" });
  ok("a third page, the wrong one, is added as page 3", wrong.status === 200 && wrong.body?.pageNo === 3, JSON.stringify(wrong.body));
  for (const [who, t] of [["a parent", parent], ["another school's coach", wes], ["the director of sport (a confirmer)", sarah], ["the principal (audit.read)", head]]) {
    const r = await api(`/api/scorebook/${I}/pages/3`, { method: "DELETE", token: t });
    ok(`${who} removes no page (403)`, r.status === 403 && r.body?.error === "not_permitted", `${r.status} ${JSON.stringify(r.body)}`);
  }
  ok("signed out: no page removed", (await api(`/api/scorebook/${I}/pages/3`, { method: "DELETE" })).status >= 400);
  const vBefore = (await q(`select version from scorebook_import where id = $1`, [I]))[0].version;
  const rm = await api(`/api/scorebook/${I}/pages/3`, { method: "DELETE", token: scorer });
  ok("the scorer takes page 3 off: one revision on, its photo deleted at once",
     rm.status === 200 && rm.body?.version === vBefore + 1 && rm.body?.purged?.due === 1 && rm.body?.purged?.deleted === 1, JSON.stringify(rm.body));
  ok("...the store holds the other two only", readdirSync(join(STORE, HIL, I)).length === 2);
  const [rmRow] = await q(`select removed_by, removed_at is not null as removed, deleted_at is not null as deleted from scorebook_import_page where import_id = $1 and page_no = 3`, [I]);
  ok("...and the row stays, saying who removed it and that its photo is gone",
     rmRow?.removed_by === "88888888-0000-0000-0000-000000000006" && rmRow.removed && rmRow.deleted, JSON.stringify(rmRow));
  ok("a removed page is not served", (await api(`/api/scorebook/${I}/pages/3`, { token: scorer })).body?.error === "page_removed");
  ok("...nor removed twice", (await api(`/api/scorebook/${I}/pages/3`, { method: "DELETE", token: scorer })).body?.error === "page_removed");
  const got3 = await api(`/api/scorebook/${I}`, { token: coach });
  ok("the import lists page 3 as removed, and the list counts two",
     got3.body?.pages?.find((p) => p.pageNo === 3)?.removedAt != null
     && (await api(`/api/matches/${M}/scorebook`, { token: coach })).body?.imports?.[0]?.pages === 2);
  ok("the revision says so", got3.body?.revisions?.at(-1)?.action === "pages" && got3.body?.revisions?.at(-1)?.note === "page 3 removed");

  // ── C ──────────────────────────────────────────────────────────
  group("C. The card");
  const got0 = await api(`/api/scorebook/${I}`, { token: scorer });
  ok("the screen is told which innings already have deliveries: none", got0.body?.innings?.length === 0 && got0.body?.import?.state === "draft");
  const card0 = baseCard(P, DNB);
  card0.endReason = "all_out";   // wrong on purpose: four down (E)
  const chase = chaseCard();
  chase.batting[4].runs = 37; chase.unreconciled = { runs: 3, note: "the book's batting is three short" };   // D4 (F)
  const typed = { ...TYPED, ...CHASE_TYPED };
  ok("the cards add up but for the ending (the seal's to refuse)", summaryCodes(card0, { typed, ours: "home" }) === "" && summaryCodes(chase, { typed, ours: "home" }) === "");
  const sneaky = { ...card0, captain: "Opp Fielder One", batting: card0.batting.map((b) => ({ ...b, nickname: "Tebza" })) };
  const s1 = await api(`/api/scorebook/${I}/save`, { method: "POST", token: scorer,
    body: { cards: [sneaky, chase], typed: { ...typed, "t:x": "not a key" }, checked: {}, version: got0.body.import.version } });
  ok("saved; the draft is now in review", s1.status === 200 && s1.body?.refusals?.every((r) => r.length === 0), JSON.stringify(s1.body).slice(0, 300));
  const [row1] = await q(`select state, card, typed from scorebook_import where id = $1`, [I]);
  ok("...as a card and nothing else: no stray field kept, no bad typed key",
     row1.state === "review" && !JSON.stringify(row1.card).includes("captain") && !JSON.stringify(row1.card).includes("Tebza") && !("t:x" in row1.typed));
  const stale = await api(`/api/scorebook/${I}/save`, { method: "POST", token: coach, body: { cards: [card0], typed, checked: {}, version: 1 } });
  ok("a save over somebody else's is refused (version_conflict, 409)", stale.status === 409 && stale.body?.error === "version_conflict");
  const unticked = await api(`/api/scorebook/${I}/submit`, { method: "POST", token: scorer, body: { version: s1.body.version } });
  ok("not every cell ticked: not submitted, the cells named", unticked.body?.error === "cells_unchecked" && unticked.body?.detail?.includes("0.total"),
     JSON.stringify(unticked.body).slice(0, 200));
  const badSum = structuredClone(chase); badSum.unreconciled = null;
  const s2 = await api(`/api/scorebook/${I}/save`, { method: "POST", token: scorer,
    body: { cards: [card0, badSum], typed, checked: allTicked([card0, badSum]), version: s1.body.version } });
  const refused = await api(`/api/scorebook/${I}/submit`, { method: "POST", token: scorer, body: { version: s2.body.version } });
  ok("a card that does not add up is refused, in words, by cell",
     refused.body?.error === "card_refused" && refused.body?.detail?.[1]?.[0]?.code === "batting_plus_extras"
     && /do not add up/.test(refused.body?.detail?.[1]?.[0]?.text ?? ""), JSON.stringify(refused.body).slice(0, 300));
  // The database asks too: SQL refuses what the route would, whoever sends it.
  const [direct] = await q(`select summary_reconciles($1::jsonb, $2::jsonb, 'home') as codes`, [JSON.stringify(badSum), JSON.stringify(typed)]);
  ok("...and summary_reconciles() says the same", direct.codes.join() === "batting_plus_extras", direct.codes.join());

  // ── D ──────────────────────────────────────────────────────────
  group("D. Two people");
  const s3 = await api(`/api/scorebook/${I}/save`, { method: "POST", token: scorer,
    body: { cards: [card0, chase], typed, checked: allTicked([card0, chase]), version: s2.body.version } });
  ok("the confirmer cannot save (not permitted)", (await api(`/api/scorebook/${I}/save`, { method: "POST", token: sarah,
    body: { cards: [card0, chase], typed, checked: {}, version: s3.body.version } })).status === 403);
  const sub = await api(`/api/scorebook/${I}/submit`, { method: "POST", token: scorer, body: { version: s3.body.version } });
  ok("every cell ticked, the cards adding up: submitted", sub.status === 200, JSON.stringify(sub.body));
  ok("a submitted import's pages stay on it (not_editable)",
     (await api(`/api/scorebook/${I}/pages/1`, { method: "DELETE", token: scorer })).body?.error === "not_editable");
  ok("the scorer cannot confirm his own (no confirm capability)", (await api(`/api/scorebook/${I}/confirm`, { method: "POST", token: scorer, body: {} })).status === 403);
  // A person holding both halves through two assignments: the owner's key.
  const MU = await fixture({ team: "U16B" });
  const J = (await api(`/api/matches/${MU}/scorebook`, { method: "POST", token: scorer })).body?.id;
  const oneCard = [baseCard(P, DNB)];
  const js = await api(`/api/scorebook/${J}/save`, { method: "POST", token: owner, body: { cards: oneCard, typed: TYPED, checked: allTicked(oneCard), version: 1 } });
  const jsub = await api(`/api/scorebook/${J}/submit`, { method: "POST", token: scorer, body: { version: js.body?.version } });
  ok("an import the owner typed a cell of, submitted by the scorer", jsub.status === 200, JSON.stringify(jsub.body));
  const own = await api(`/api/scorebook/${J}/confirm`, { method: "POST", token: owner, body: {} });
  ok("a revision author cannot confirm it (cannot_confirm_your_own)", own.body?.error === "cannot_confirm_your_own", JSON.stringify(own.body));
  ok("...nor return it", (await api(`/api/scorebook/${J}/return`, { method: "POST", token: owner, body: { note: "look at the extras line" } })).body?.error === "cannot_confirm_your_own");
  ok("a return says why, in ten characters or more", (await api(`/api/scorebook/${J}/return`, { method: "POST", token: sarah, body: { note: "no" } })).body?.error === "note_required");
  ok("the director of sport returns it with a note", (await api(`/api/scorebook/${J}/return`, { method: "POST", token: sarah, body: { note: "check the extras line" } })).status === 200);
  const J2 = await api(`/api/scorebook/${J}`, { token: scorer });
  ok("returned: the note on it", J2.body?.import?.state === "returned" && J2.body?.import?.returnedNote === "check the extras line");
  const up3 = await api(`/api/scorebook/${J}/pages`, { method: "POST", token: scorer, raw: jpegWithMetadata({ salt: 9 }), type: "image/jpeg" });
  ok("a page added to the returned import", up3.body?.pageNo === 1);
  await api(`/api/scorebook/${J}/save`, { method: "POST", token: scorer, body: { cards: oneCard, typed: TYPED, checked: allTicked(oneCard), version: J2.body.import.version + 1 } });
  const jv = (await api(`/api/scorebook/${J}`, { token: scorer })).body?.import?.version;
  const jsub2 = await api(`/api/scorebook/${J}/submit`, { method: "POST", token: owner, body: { version: jv } });
  ok("the owner submits it himself", jsub2.status === 200, JSON.stringify(jsub2.body));
  ok("...and the submitter cannot confirm it", (await api(`/api/scorebook/${J}/confirm`, { method: "POST", token: owner, body: {} })).body?.error === "cannot_confirm_your_own");

  // ── E ──────────────────────────────────────────────────────────
  group("E. The seal");
  const sealed = await api(`/api/scorebook/${I}/confirm`, { method: "POST", token: sarah, body: { acknowledgeUnreconciled: true } });
  ok("'all out' with four down is refused at the seal, in words",
     sealed.body?.error === "seal_refused" && sealed.body?.detail?.seal === "not_the_laws_reason" && sealed.body?.detail?.innings === 0,
     JSON.stringify(sealed.body));
  ok("...and nothing was written: no event, the match not complete, the import still submitted",
     (await q(`select count(*)::int as n from ball_event where match_id = $1`, [M]))[0].n === 0
     && (await q(`select status from match where id = $1`, [M]))[0].status === "scheduled"
     && (await q(`select state from scorebook_import where id = $1`, [I]))[0].state === "submitted");
  await api(`/api/scorebook/${I}/return`, { method: "POST", token: sarah, body: { note: "innings one ended on its overs" } });
  card0.endReason = "overs";
  const v4 = (await api(`/api/scorebook/${I}`, { token: scorer })).body.import.version;
  await api(`/api/scorebook/${I}/save`, { method: "POST", token: scorer, body: { cards: [card0, chase], typed, checked: allTicked([card0, chase]), version: v4 } });
  const sub2 = await api(`/api/scorebook/${I}/submit`, { method: "POST", token: scorer, body: { version: v4 + 1 } });
  ok("corrected and resubmitted", sub2.status === 200, JSON.stringify(sub2.body));

  // ── F ──────────────────────────────────────────────────────────
  group("F. The commit");
  const noAck = await api(`/api/scorebook/${I}/confirm`, { method: "POST", token: sarah, body: {} });
  ok("a recorded difference needs the confirmer's acknowledgement (D4)", noAck.body?.error === "unreconciled_not_acknowledged", JSON.stringify(noAck.body));
  const done = await api(`/api/scorebook/${I}/confirm`, { method: "POST", token: sarah, body: { acknowledgeUnreconciled: true, note: "checked against the book" } });
  ok("confirmed by the director of sport", done.status === 200 && done.body?.ok === true, JSON.stringify(done.body));
  const keys = [0, 1].flatMap((n) => ["start", "summary", "end"].map((k) => `scorebook:${I}:${n}:${k}`));
  ok("exactly three events per innings, under the derived keys", JSON.stringify(done.body?.keys) === JSON.stringify(keys), JSON.stringify(done.body?.keys));
  const rows = await q(`select * from ball_event where match_id = $1 order by seq`, [M]);
  ok("...and nothing else in the log", rows.length === 6 && rows.map((r) => r.idempotency_key).join() === keys.join());
  ok("authored by the submitter, from the import's device, carrying their source",
     rows.every((r) => r.scorer_user_id === "88888888-0000-0000-0000-000000000006" && r.device_id === `scorebook:${I}`
       && r.payload.source?.import === I && r.payload.source?.checkedBy === "88888888-0000-0000-0000-000000000006"
       && r.payload.source?.confirmedBy === "88888888-0000-0000-0000-000000000007"));
  const summary = fromRow(rows[1]);
  const built = inningsSummary({ innings: 0, card: card0, typed, source: summary.source, id: rows[1].idempotency_key, clientTs: summary.clientTs });
  // jsonb keeps its own key order: compared with every object's keys sorted.
  const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
  ok("the summary is the constructor's shape: card, typed names this card uses, source",
     canon(summary.card) === canon(built.card) && canon(summary.typed) === canon(built.typed)
     && canon(Object.keys(rows[1].payload).sort()) === canon(["card", "source", "typed"])
     && Object.keys(summary.typed).sort().join() === "t:1,t:2,t:3,t:4,t:5", JSON.stringify(summary.typed));
  ok("no ball column on a summary", rows[1].ball_type === null && rows[1].value === null && rows[1].bowler_id === null && rows[1].striker_id === null);
  const typedNames = Object.values(typed);
  const players = await q(`select full_name from player where full_name = any($1::text[])`, [typedNames]);
  ok("no typed name became a player row (D6)", players.length === 0);
  ok("typed names only in the summaries' typed maps",
     rows.filter((r) => r.kind !== "innings_summary").every((r) => typedNames.every((n) => !JSON.stringify(r.payload).includes(n))));
  ok("the chase opened on its target", rows[3].payload.target === 128, JSON.stringify(rows[3].payload.target));
  const [m] = await q(`select status from match where id = $1`, [M]);
  ok("the match is complete (D10)", m.status === "complete");
  const claim = await api(`/api/matches/${M}/session/claim`, { method: "POST", token: scorerPad, body: { device: "sb-pad" } });
  ok("...and scoring_claim() refuses it", claim.body?.ok === false && claim.body?.reason === "match_complete", JSON.stringify(claim.body));
  const [aud] = await q(`select detail from scoring_audit where match_id = $1 and event = 'scorebook_import'`, [M]);
  ok("the commit is on scoring_audit", aud?.detail?.import === I && aud?.detail?.keys?.length === 6);
  const [imp] = await q(`select state, confirmed_by, applied_keys, unreconciled_acknowledged from scorebook_import where id = $1`, [I]);
  ok("the import is confirmed, naming what it wrote", imp.state === "confirmed" && imp.applied_keys.join() === keys.join() && imp.unreconciled_acknowledged === true);
  const [cond] = await q(`select set_id, fixed_at from match_conditions where match_id = $1`, [M]);
  ok("the playing conditions were fixed at the commit (a friendly: no version)", cond && cond.set_id === null);
  const fold = deriveMatch(rows.map(fromRow), { startsAt: null, format: "T20" });
  const sqlScore = await q(`select innings, runs, wickets, legal_balls from match_live_score where match_id = $1 order by innings`, [M]);
  const handover = await q(`select (innings_score_as_folded($1, 0::smallint)).*`, [M]);
  ok("the fold and SQL agree: runs, wickets, balls", sqlScore.length === 2
     && sqlScore.every((s) => Number(s.runs) === fold.innings[s.innings].runs && Number(s.wickets) === fold.innings[s.innings].wickets
                              && Number(s.legal_balls) === fold.innings[s.innings].balls)
     && handover[0].runs === 127 && handover[0].wickets === 4 && handover[0].legal_balls === 120, JSON.stringify(sqlScore));
  ok("both innings sealed on their figures; the match a tie", fold.innings.every((x) => x.sealed) && fold.result?.margin === "tie", JSON.stringify(fold.result));
  ok("no bowler_spell, no shot sector, no milestone notice for an imported innings",
     (await q(`select count(*)::int as n from bowler_spell where match_id = $1`, [M]))[0].n === 0
     && (await q(`select count(*)::int as n from milestone_notice where match_id = $1`, [M]))[0].n === 0
     && (await q(`select count(*)::int as n from bowler_over where match_id = $1`, [M]))[0].n === 0);
  await q(`insert into fixture_publication (match_id, side, school_id, team_code, published, set_by)
           values ($1, 'home', $2, '1XI', true, '88888888-0000-0000-0000-000000000007')`, [M, HIL]);
  const pub = await q(`select kind, detail from public_match_log($1, 0) order by seq`, [M]);
  const pubText = JSON.stringify(pub);
  ok("the public log serves the summaries' cards, and no typed name, source or note",
     pub.filter((r) => r.kind === "innings_summary").length === 2 && typedNames.every((n) => !pubText.includes(n))
     && !/source|checkedBy|typed|three short/.test(pubText), pubText.slice(0, 300));
  ok("no shot sector served", (await q(`select count(*)::int as n from public_shot_sectors($1)`, [M]))[0].n === 0);

  // ── F2 ─────────────────────────────────────────────────────────
  group("F2. What a book leaves unrecorded stays NULL through the reads (D12, db/64)");
  {
    // A second import: a home innings in which the book has no balls column for
    // three of our boys. 12 (J Sithole) has no other record; 04 (M Cele) has a
    // live one; 05 (R Pillay, the pupil account) has a book innings with balls
    // from F and now a second without.
    const [B12, B13, B04, B05] = [DNB[0], DNB[1], P[3], P[4]];
    const careerOf = async (id, resource = "career") =>
      ((await api(`/api/read/${resource}`, { token: sarah })).body?.rows ?? []).filter((r) => r.player_id === id);
    const before04 = (await careerOf(B04))[0];
    const M2 = await fixture({ days: -4 });
    const I2 = (await api(`/api/matches/${M2}/scorebook`, { method: "POST", token: scorer })).body?.id;
    const nobook = baseCard([B12, B13, DNB[2], B04, B05, P[0]]);
    for (const i of [0, 4]) Object.assign(nobook.batting[i], { balls: null, fours: null, sixes: null });
    const book2 = [nobook];
    const sv = await api(`/api/scorebook/${I2}/save`, { method: "POST", token: scorer, body: { cards: book2, typed: TYPED, checked: allTicked(book2), version: 1 } });
    const sb = await api(`/api/scorebook/${I2}/submit`, { method: "POST", token: scorer, body: { version: sv.body?.version } });
    const cf = await api(`/api/scorebook/${I2}/confirm`, { method: "POST", token: sarah, body: {} });
    ok("a second import, with no balls for two of our boys, is committed", sb.status === 200 && cf.status === 200, JSON.stringify([sb.body, cf.body]));

    const [c12] = await careerOf(B12);
    ok("a boy whose one innings is a book's without balls: balls faced, fours and sixes are null, not 0",
       c12 && Number(c12.runs) === 34 && c12.balls_faced === null && c12.fours === null && c12.sixes === null, JSON.stringify(c12));
    ok("...and the read says how partial: one innings without balls (34 runs in it) and without boundaries, one from a book",
       c12 && c12.innings_without_balls === 1 && c12.runs_without_balls === 34 && c12.innings_without_boundaries === 1 && c12.book_innings === 1, JSON.stringify(c12));
    ok("...so no strike rate: (runs − runs_without_balls) over null balls is nothing to divide",
       c12 && c12.balls_faced === null && Number(c12.runs) - c12.runs_without_balls === 0);
    ok("he has not bowled: 0 wides, a fact, where the view has no row", c12 && Number(c12.wides) === 0 && Number(c12.no_balls) === 0 && c12.bowling_without_extras === 0, JSON.stringify(c12));
    const [c13] = await careerOf(B13);
    ok("a book innings with every figure recorded reads as recorded: 12 off 15, a four, no sixes, nothing unrecorded",
       c13 && Number(c13.runs) === 12 && Number(c13.balls_faced) === 15 && Number(c13.fours) === 1 && Number(c13.sixes) === 0
       && c13.innings_without_balls === 0 && c13.innings_without_boundaries === 0 && c13.book_innings === 1, JSON.stringify(c13));
    const [c04] = await careerOf(B04);
    // 04 already has the first book's innings (25, no balls) beside his live ones.
    ok("a boy with live innings and book innings without balls: his balls stay his recorded balls, the runs take the book's 25 more",
       c04 && Number(c04.balls_faced) === Number(before04.balls_faced) && Number(c04.runs) === Number(before04.runs) + 25
       && c04.runs_without_balls === before04.runs_without_balls + 25 && c04.book_innings === before04.book_innings + 1, JSON.stringify([before04, c04]));
    ok("...so (runs − runs_without_balls) / balls has not moved, where runs / balls has",
       (Number(c04.runs) - c04.runs_without_balls) * Number(before04.balls_faced) === (Number(before04.runs) - before04.runs_without_balls) * Number(c04.balls_faced)
       && Number(c04.runs) * Number(before04.balls_faced) !== Number(before04.runs) * Number(c04.balls_faced));
    const [c05] = await careerOf(B05);
    ok("a boy with a book innings with balls (40 off 30, five fours, a six) and one without: 80 runs, 30 balls, 40 runs unrecorded",
       c05 && Number(c05.runs) === 80 && Number(c05.balls_faced) === 30 && Number(c05.fours) === 5 && Number(c05.sixes) === 1
       && c05.runs_without_balls === 40 && c05.innings_without_balls === 1 && c05.innings_without_boundaries === 1 && c05.book_innings === 2, JSON.stringify(c05));
    ok("...his bowling row in the first book has no wides or no-balls: null, one row unrecorded",
       c05 && c05.wides === null && c05.no_balls === null && c05.bowling_without_extras === 1 && Number(c05.balls_bowled) === 24, JSON.stringify(c05));

    const seasons = await careerOf(B12, "career_by_season");
    ok("the season read says the same: null balls, the unrecorded columns, one from a book",
       seasons.length === 1 && seasons[0].balls_faced === null && seasons[0].fours === null && seasons[0].innings_without_balls === 1
       && seasons[0].runs_without_balls === 34 && seasons[0].book_innings === 1, JSON.stringify(seasons));
    const s05 = await careerOf(B05, "career_by_season");
    ok("...and a season's rows sum to the lifetime read for his balls and his unrecorded runs",
       s05.reduce((a, r) => a + Number(r.balls_faced ?? 0), 0) === Number(c05.balls_faced)
       && s05.reduce((a, r) => a + r.runs_without_balls, 0) === c05.runs_without_balls, JSON.stringify(s05));

    // The dashboard: the pupil account linked to 05 reads his own strike rate over the innings whose balls are recorded.
    const pillay = await login("pillay@example.invalid");
    const mine = (await api("/api/read/summary", { token: pillay })).body?.rows?.[0];
    ok("the pupil's own runs include the book (80), and his strike rate is over the recorded balls: 40 off 30 is 133, not 80 off 30",
       mine && Number(mine.my_runs) === 80 && Number(mine.my_strike_rate) === 133, JSON.stringify(mine));

    // The passport says where the career came from.
    const pp = (await api(`/api/read/passport?playerId=${B05}`, { token: coach })).body?.rows ?? [];
    const careerLines = pp.filter((l) => l.family === "career");
    ok("the passport's career lines are sourced to the match record, not the ball log alone",
       careerLines.length >= 1 && careerLines.every((l) => l.recorded_by === "the match record") && !pp.some((l) => l.recorded_by === "the ball log"), JSON.stringify(pp));
  }

  // ── G ──────────────────────────────────────────────────────────
  group("G. A league's fixture");
  const [set] = await q(`insert into condition_set (competition_id, version, title, effective_from, created_by)
    values ($1, 50, 'Smoke scorebook version', sa_today() - 30, '88888888-0000-0000-0000-000000000021') returning id`, [LEAGUE]);
  await q(`insert into condition_value (set_id, key, value, status, entered_by) values ($1, 'format.free_hit', 'false', 'unconfirmed', '88888888-0000-0000-0000-000000000021')`, [set.id]);
  await q(`update condition_set set status = 'published', published_by = '88888888-0000-0000-0000-000000000021', published_at = now() where id = $1`, [set.id]);
  const ML = await fixture({ competition: LEAGUE });
  const L = (await api(`/api/matches/${ML}/scorebook`, { method: "POST", token: scorer })).body?.id;
  const lcard = [baseCard(P, DNB)];
  await api(`/api/scorebook/${L}/save`, { method: "POST", token: scorer, body: { cards: lcard, typed: TYPED, checked: allTicked(lcard), version: 1 } });
  await api(`/api/scorebook/${L}/submit`, { method: "POST", token: scorer, body: { version: 2 } });
  // The league's administrator reads no roster of the school's: the import
  // names the card's own boys to him, and nothing more (§9.4 3).
  ok("the league's administrator reads no roster of the school's", (await api(`/api/read/players`, { token: league })).body?.rows?.some?.((r) => r.id === P[0]) !== true);
  const lget = await api(`/api/scorebook/${L}`, { token: league });
  const cardIds = [...new Set(lcard.flatMap((c) => [...c.batting.flatMap((b) => [b.ref, b.fielderRef, b.bowlerRef]), ...c.didNotBat, ...c.bowling.map((b) => b.ref)]))]
    .filter((r) => /^[0-9a-f-]{36}$/.test(r ?? "")).sort();
  const realNames = Object.fromEntries((await q(`select id, full_name from player where id = any($1::uuid[])`, [cardIds])).map((r) => [r.id, r.full_name]));
  ok("...the import names the card's own boys to him, each by his own name, and no other",
     lget.status === 200 && JSON.stringify(Object.keys(lget.body?.names ?? {}).sort()) === JSON.stringify(cardIds)
     && cardIds.every((id) => lget.body.names[id] === realNames[id]), JSON.stringify(lget.body?.names));
  ok("...a name and nothing else", Object.values(lget.body?.names ?? {}).every((v) => typeof v === "string"));
  ok("another school's coach reads no import, so no name", (await api(`/api/scorebook/${L}`, { token: wes })).status === 403);
  const [scorerName] = await q(`select name from app_user where id = '88888888-0000-0000-0000-000000000006'`);
  ok("...and the history names who wrote each revision (§9.4 4)",
     lget.body?.revisions?.length >= 3 && lget.body.revisions.every((r) => r.actorId === "88888888-0000-0000-0000-000000000006" && r.actorName === scorerName.name),
     JSON.stringify(lget.body?.revisions));
  ok("the director of sport is not told she may confirm a league's fixture, and the league's administrator is",
     (await api(`/api/matches/${ML}/scorebook`, { token: sarah })).body?.may?.confirm === false
     && (await api(`/api/matches/${ML}/scorebook`, { token: league })).body?.may?.confirm === true);
  ok("the director of sport does not confirm a league's fixture", (await api(`/api/scorebook/${L}/confirm`, { method: "POST", token: sarah, body: {} })).status === 403);
  const lc = await api(`/api/scorebook/${L}/confirm`, { method: "POST", token: league, body: {} });
  ok("the league's administrator does", lc.status === 200, JSON.stringify(lc.body));
  const [lcond] = await q(`select set_id, doc_hash from match_conditions where match_id = $1`, [ML]);
  ok("fixed at the commit under the version in force on its start day", lcond?.set_id === set.id);
  const [later] = await q(`insert into condition_set (competition_id, version, title, effective_from, created_by)
    values ($1, 51, 'Smoke scorebook later', sa_today() - 1, '88888888-0000-0000-0000-000000000021') returning id`, [LEAGUE]);
  await q(`insert into condition_value (set_id, key, value, status, entered_by) values ($1, 'format.free_hit', 'true', 'unconfirmed', '88888888-0000-0000-0000-000000000021')`, [later.id]);
  await q(`update condition_set set status = 'published', published_by = '88888888-0000-0000-0000-000000000021', published_at = now() where id = $1`, [later.id]);
  const [lcond2] = await q(`select set_id, doc_hash from match_conditions where match_id = $1`, [ML]);
  ok("...and a later publish touches nothing", lcond2.set_id === set.id && lcond2.doc_hash === lcond.doc_hash);

  // ── H ──────────────────────────────────────────────────────────
  group("H. Live or imported, never both");
  const MV = await fixture();
  const c1 = await api(`/api/matches/${MV}/session/claim`, { method: "POST", token: scorerPad, body: { device: "sb-pad" } });
  let cseq = 0;
  const env = (payload) => { cseq += 1; const p = { ...payload, id: newEventId("sb-pad", MV) };
    return { epoch: c1.body.epoch, deviceId: "sb-pad", clientSeq: cseq, clientTs: Date.now(), innings: 0, idempotencyKey: p.id, payload: p }; };
  const sent = await api(`/api/matches/${MV}/events`, { method: "POST", token: scorerPad, body: { events: [
    inningsStart({ battingTeam: "1XI", bowlingTeam: "Opposition XI", squad: P.map((id) => ({ id, name: id })), overs: 20 }),
    batters({ striker: P[0], nonStriker: P[1] }), bowler({ bowler: "M Bowler" }), ball({ type: BALL_TYPE.RUN, value: 1 }),
  ].map(env) } });
  ok("a live over begun on the pad", sent.body?.accepted?.length === 4, JSON.stringify(sent.body));
  const forged = await api(`/api/matches/${MV}/events`, { method: "POST", token: scorerPad, body: { events: [
    env(inningsSummary({ innings: 0, card: baseCard(P, DNB), typed: TYPED, source: { kind: "scorebook", import: MV, checkedBy: "x", confirmedBy: "y" } })),
  ] } });
  ok("the pad cannot write a summary itself: refused per event, nothing written",
     (forged.body?.accepted?.length ?? 0) === 0 && (await q(`select count(*)::int as n from ball_event where match_id = $1 and kind = 'innings_summary'`, [MV]))[0].n === 0,
     JSON.stringify(forged.body).slice(0, 300));
  const V = (await api(`/api/matches/${MV}/scorebook`, { method: "POST", token: scorer })).body?.id;
  await api(`/api/scorebook/${V}/save`, { method: "POST", token: scorer, body: { cards: lcard, typed: TYPED, checked: allTicked(lcard), version: 1 } });
  await api(`/api/scorebook/${V}/submit`, { method: "POST", token: scorer, body: { version: 2 } });
  const live = await api(`/api/scorebook/${V}/confirm`, { method: "POST", token: sarah, body: {} });
  ok("a summary over a live delivery is refused: LIVE_INNINGS, in words",
     live.body?.error === "laws_refused" && live.body?.detail?.law === "live_innings" && /scored live/.test(live.body?.detail?.text ?? ""), JSON.stringify(live.body));
  ok("...and nothing was written", (await q(`select count(*)::int as n from ball_event where match_id = $1`, [MV]))[0].n === 4);
  const after = await api(`/api/matches/${M}/events`, { method: "POST", token: scorerPad, body: { events: [
    { epoch: 1, deviceId: "sb-pad", clientSeq: 99, clientTs: Date.now(), innings: 1, idempotencyKey: "sb-late-ball",
      payload: { ...ball({ innings: 1, type: BALL_TYPE.RUN, value: 4 }), id: "sb-late-ball" } }] } });
  ok("a ball sent after the commit goes nowhere near the log",
     (await q(`select count(*)::int as n from ball_event where match_id = $1 and kind = 'ball'`, [M]))[0].n === 0, JSON.stringify(after.body).slice(0, 200));

  // ── I ──────────────────────────────────────────────────────────
  group("I. An amendment, then a new import");
  const reopen = await api(`/api/matches/${M}/scorebook`, { method: "POST", token: scorer });
  ok("a new import opens on a match an import completed", reopen.status === 200, JSON.stringify(reopen.body));
  const K = reopen.body.id;
  const fixed = chaseCard(); fixed.batting[4].runs = 40;   // the book, read again: no difference
  await api(`/api/scorebook/${K}/save`, { method: "POST", token: scorer, body: { cards: [fixed], typed, checked: allTicked([fixed]), version: 1 } });
  await api(`/api/scorebook/${K}/submit`, { method: "POST", token: scorer, body: { version: 2 } });
  const twice = await api(`/api/scorebook/${K}/confirm`, { method: "POST", token: sarah, body: {} });
  ok("while the first summary stands, the innings takes no second book (SUMMARISED_INNINGS)",
     ["summarised_innings", "already_summarised"].includes(twice.body?.detail?.law), JSON.stringify(twice.body));
  const amend = await api(`/api/matches/${M}/amendments`, { method: "POST", token: scorer,
    body: { targetKey: `scorebook:${I}:1:summary`, reason: "The chase's batting was misread from the book." } });
  const decided = await api(`/api/amendments/${amend.body?.id}/decide`, { method: "POST", token: sarah, body: { approve: true, note: "Confirmed against the book." } });
  ok("the amendment voiding the chase's summary is approved", decided.body?.ok === true, JSON.stringify(decided.body));
  const redo = await api(`/api/scorebook/${K}/confirm`, { method: "POST", token: sarah, body: {} });
  ok("...and the new import goes through", redo.status === 200 && redo.body?.keys?.length === 3, JSON.stringify(redo.body));
  const rows2 = await q(`select * from ball_event where match_id = $1 order by seq`, [M]);
  const fold2 = deriveMatch(rows2.map(fromRow), { format: "T20" });
  const [s2q] = await q(`select (innings_score_as_folded($1, 1::smallint)).*`, [M]);
  ok("the chase is the new card's, in the fold and in SQL", fold2.innings[1].runs === 127 && fold2.innings[1].summarised?.import === K
     && s2q.runs === 127 && fold2.innings[1].sealed, JSON.stringify(s2q));

  // ── J ──────────────────────────────────────────────────────────
  group("J. The purge");
  ok("before the window nothing is due", (await api(`/api/scorebook/purge`, { method: "POST", token: platform })).body?.due === 0);
  await q(`update scorebook_import set confirmed_at = confirmed_at - interval '31 days' where id = $1`, [I]).catch(async () => {
    // A confirmed import does not change (its guard): age it as the table's owner would, trigger aside.
    await q(`alter table scorebook_import disable trigger scorebook_import_guard`);
    await q(`update scorebook_import set confirmed_at = confirmed_at - interval '31 days' where id = $1`, [I]);
    await q(`alter table scorebook_import enable trigger scorebook_import_guard`);
  });
  ok("a scorer's purge names nothing", (await api(`/api/scorebook/purge`, { method: "POST", token: scorer })).body?.due === 0);
  const purged = await api(`/api/scorebook/purge`, { method: "POST", token: platform });
  ok("the platform's purge deletes the two photos past the window", purged.body?.due === 2 && purged.body?.deleted === 2, JSON.stringify(purged.body));
  ok("...from the store", !existsSync(join(STORE, HIL, I)) || readdirSync(join(STORE, HIL, I)).length === 0);
  const [prow] = await q(`select pages_purged_at from scorebook_import where id = $1`, [I]);
  const prows = await q(`select deleted_at from scorebook_import_page where import_id = $1`, [I]);
  ok("...and the rows kept, each saying when (the removed page's too)", prows.length === 3 && prows.every((r) => r.deleted_at) && !!prow.pages_purged_at);
  ok("a deleted page is not read", (await api(`/api/scorebook/${I}/pages/1`, { token: scorer })).body?.error === "page_deleted");
  const ab = await api(`/api/scorebook/${J}/abandon`, { method: "POST", token: scorer });
  ok("an abandoned import's photos go at once", ab.body?.ok === true && ab.body?.purged?.deleted === 1, JSON.stringify(ab.body));
  ok("...its row kept, abandoned", (await q(`select state from scorebook_import where id = $1`, [J]))[0].state === "abandoned");

  // ── K ──────────────────────────────────────────────────────────
  group("K. The arithmetic's two halves agree");
  let agree = 0;
  for (const [name, change, want] of PARITY) {
    const c = baseCard(P, DNB);
    change(c);
    const js = summaryCodes(c, { typed: TYPED, ours: "home" });
    const [sq] = await q(`select array_to_string(summary_reconciles($1::jsonb, $2::jsonb, 'home'), ',') as codes`, [JSON.stringify(c), JSON.stringify(TYPED)]);
    if (js === sq.codes && js === want) agree += 1; else ok(`parity: ${name}`, false, `js ${js} · sql ${sq.codes} · want ${want}`);
  }
  ok(`summaryRefusal() and summary_reconciles() agree on all ${PARITY.length} cards`, agree === PARITY.length);
  ok("ballsOfOvers and scorebook_overs_balls agree", (await q(`select scorebook_overs_balls('47.3') as a, scorebook_overs_balls('3.6') as b`))
    .every((r) => r.a === ballsOfOvers("47.3") && r.b === null));
} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.stack ?? e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`SCOREBOOK SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
