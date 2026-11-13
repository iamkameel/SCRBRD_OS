#!/usr/bin/env node
/**
 * PUBLIC_BY_TERMS slice 2: the rule. docs/design/PUBLIC_BY_TERMS.md §5.1, as
 * publicName() (packages/policy/src/public.mjs) judges it for one child, one
 * surface and the day served, proved without a database:
 *
 *   §5.1   every line, in order, on each of card, live and board;
 *   B1     a no covers every surface its wording could reach; a yes only the
 *          surfaces its wording named (the old wording: card and live);
 *   B2     a no counts if its giver was competent the day it was given,
 *          whatever has happened to the link since; a yes needs a live giver;
 *   §10    must-nevers 1, 3, 5 and 7 at the rule (11 is the cache's, in
 *          services/api/public/public.test.mjs);
 *   OFF    with no surface — every public read today — the answer is main's,
 *          over a grid of 45,366 inputs, with and without the by-terms facts;
 *   §4.1   the terms versions, in order, and the drift test between this
 *          list and every version the code, the migrations and (from slice 4)
 *          the SQL list write.
 *
 *   R3     Reading 3 (13 Nov 2026, Kameel): a no line 5 does not count still
 *          stops the default, but never overrides a counted yes.
 *
 * Falsified by: letting a no's surface narrow it (B1 fails); dropping
 * `giverLive` from a yes (B2 fails); reading `byTermsAllowed` truthily (line 6
 * fails); reading `byTerms` with no surface (OFF fails); a version on the
 * list in another order (the order group fails); letting the default name him
 * over an uncounted no, or letting that no outweigh a counted yes (R3 fails).
 *
 * Invented names only.
 *
 *   node packages/policy/test/public-by-terms.test.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  publicName, NAME_SURFACES, TERMS, TERMS_VERSIONS, termsRank, termsAtLeast, SURFACES,
} from "../src/public.mjs";
import { migrationFiles } from "../../../services/api/migration-names.mjs";
import { nameGrid } from "./name-grid.mjs";
/** @import { NameFacts, NameConsent } from "../src/public.mjs" */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DB = process.env.SCRBRD_DB_DIR ?? join(ROOT, "db");

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${d}`}`);
  if (c) pass++; else fail++;
};
const group = (/** @type {string} */ t) => console.log("\n" + t);
/** @param {() => unknown} f */
const throws = (f) => { try { f(); return false; } catch { return true; } };

const ON = "2026-11-26";
const NAMED = "T Bekker";
const ALL = /** @type {const} */ (["card", "live", "board"]);

/** A guardian's record in the by-surface shape. @param {Partial<NameConsent>} [c] @returns {NameConsent} */
const g = (c = {}) => ({ by: "guardian", competent: true, givenOn: "2026-10-03", endedOn: null, surface: null, giverLive: true, ...c });
/** A refusal: a record that ends the day it begins. @param {Partial<NameConsent>} [c] */
const gNo = (c = {}) => g({ endedOn: c.givenOn ?? "2026-10-03", ...c });
/** The pupil's own. @param {Partial<NameConsent>} [c] @returns {NameConsent} */
const p = (c = {}) => ({ by: "pupil", competent: true, givenOn: "2026-09-01", endedOn: null, surface: null, giverLive: true, ...c });
const pNo = (/** @type {Partial<NameConsent>} */ c = {}) => p({ endedOn: c.givenOn ?? "2026-09-01", ...c });

/** Every fact in favour of a name, nothing answered, by terms off. @type {NameFacts} */
const BASE = Object.freeze({
  on: ON, fullName: "Tiaan Bekker", surname: "Bekker", label: "Batter",
  typed: false, schoolOnPlatform: true, schoolPublished: true, neverPublic: false, namesOff: false,
  consents: [], byTerms: false, byTermsAllowed: true,
});
/** @param {"card"|"live"|"board"} surface @param {Partial<NameFacts>} [change] */
const at = (surface, change = {}) => publicName({ ...BASE, surface, ...change });
/** The answer on each surface, as "card:T Bekker live:Batter board:Batter". @param {Partial<NameFacts>} change */
const each = (change) => ALL.map((s) => `${s}:${at(s, change)}`).join(" ");
/** @param {Partial<NameFacts>} change @param {readonly string[]} named  the surfaces that name him */
const only = (change, named) => ALL.every((s) => (at(s, change) === NAMED) === named.includes(s));
const BY_TERMS = { byTerms: true, byTermsAllowed: true };

// ═══════════════════════════════════════════════════════════════════
group("OFF — no surface is today's rule, exactly: every output is main's");
// ═══════════════════════════════════════════════════════════════════
{
  // Recorded from packages/policy/src/public.mjs at main 410fab53, before
  // slice 2, over nameGrid() (name-grid.mjs): one answer per input, joined by
  // "\n", a thrown error recorded as "throw:<class>".
  const MAIN = { n: 45366, digest: "06a3d934fa878967a11ac41a8f44b2271a277df4b64e8debbdd5feabe6ac0d4d" };
  const run = (/** @type {any} */ x) => { try { return publicName(x); } catch (/** @type {any} */ e) { return `throw:${e.constructor.name}`; } };
  const digest = (/** @type {Record<string, any>[]} */ grid) => createHash("sha256").update(grid.map(run).join("\n")).digest("hex");
  const plain = nameGrid();
  ok(`the grid is the one main was read over (${MAIN.n} inputs)`, plain.length === MAIN.n, String(plain.length));
  ok("...and every answer over it is main's", digest(plain) === MAIN.digest, digest(plain));
  ok("...with byTerms and byTermsAllowed both true on every input: still main's",
     digest(nameGrid({ extra: BY_TERMS })) === MAIN.digest);
  ok("...and with the by-surface consent fields on every record too: still main's",
     digest(nameGrid({ extra: BY_TERMS, consentExtra: { surface: "board", giverLive: false, adult: true } })) === MAIN.digest);
  const named = plain.map(run).filter((x) => !["Batter", "Bowler", "Player"].includes(x)).length;
  ok("the grid names some and not others, so it tests something", named > 500 && named < plain.length / 2, String(named));
  ok("nobody answered and by terms on, with no surface: not named",
     publicName({ ...BASE, ...BY_TERMS }) === "Batter" && publicName({ ...BASE, byTerms: true, byTermsAllowed: true, consents: undefined }) === "Batter");
  ok("...and with a surface, named: the by-terms route exists only on a surface", at("card", BY_TERMS) === NAMED);
}

// ═══════════════════════════════════════════════════════════════════
group("§1.1 — the three surfaces, and nothing else (must-never 7)");
// ═══════════════════════════════════════════════════════════════════
{
  ok("card, live and board, frozen", JSON.stringify(NAME_SURFACES) === JSON.stringify(ALL) && Object.isFrozen(NAME_SURFACES));
  for (const bad of ["D2", "stream", "Card", "", null, "A2", "L2", "pack", 1]) {
    ok(`a surface ${JSON.stringify(bad)} is refused loudly, not answered`,
       throws(() => publicName({ ...BASE, ...BY_TERMS, surface: /** @type {any} */ (bad) })));
  }
  ok("the stream overlay is a decided surface but never a name surface", Object.hasOwn(SURFACES, "D2") && !NAME_SURFACES.includes(/** @type {any} */ ("D2")));
  ok("the day served is still required on a surface", throws(() => at("card", { on: "2026-11-31" })));
}

// ═══════════════════════════════════════════════════════════════════
group("§5.1 line 1 — the surface exists for him");
// ═══════════════════════════════════════════════════════════════════
for (const s of ALL) {
  const yes = { consents: [g({ surface: s })], ...BY_TERMS };
  ok(`${s}: with every fact in favour and his own surface's yes, named`, at(s, yes) === NAMED);
  ok(`${s}: a typed name (L6) → a position, whatever is answered`, at(s, { ...yes, typed: true }) === "Batter");
  ok(`${s}: his school not on the platform (L5) → not named`, at(s, { ...yes, schoolOnPlatform: false }) === "Batter");
  ok(`${s}: not published for him → not named`, at(s, { ...yes, schoolPublished: false }) === "Batter");
  for (const k of /** @type {const} */ (["typed", "schoolOnPlatform", "schoolPublished"])) {
    const f = /** @type {Record<string, unknown>} */ ({ ...BASE, ...yes, surface: s });
    delete f[k];
    ok(`${s}: ${k} missing → not named`, publicName(/** @type {NameFacts} */ (f)) === "Batter");
  }
}

// ═══════════════════════════════════════════════════════════════════
group("§5.1 lines 2 and 3 — a mark, names off: before every answer and every default");
// ═══════════════════════════════════════════════════════════════════
for (const s of ALL) {
  const yes = { consents: [g({ surface: s }), p({ adult: true, surface: s })], ...BY_TERMS };
  ok(`${s}: a never-public mark → not named, over an explicit yes and by terms`, at(s, { ...yes, neverPublic: true }) === "Batter");
  ok(`${s}: names off (or no date of birth on file) → not named`, at(s, { ...yes, namesOff: true }) === "Batter");
  ok(`${s}: either missing, or truthy but not true/false → not named`,
     at(s, { ...yes, neverPublic: undefined }) === "Batter" && at(s, { ...yes, namesOff: undefined }) === "Batter"
     && at(s, { ...yes, neverPublic: /** @type {any} */ (0) }) === "Batter");
}
{
  const refusals = [{ neverPublic: true }, { namesOff: true }, { typed: true }, { schoolPublished: false },
    { consents: [gNo()] }, { byTerms: false }, { byTermsAllowed: false }].map((c) => at("card", { ...BY_TERMS, ...c }));
  ok("seven causes, one answer: the label", refusals.every((r) => r === "Batter"), refusals.join(" | "));
  ok("the caller's label, or \"Player\"", at("card", { neverPublic: true, label: "Fielder" }) === "Fielder"
     && at("card", { neverPublic: true, label: undefined }) === "Player");
}

// ═══════════════════════════════════════════════════════════════════
group("§5.1 line 4 — his own standing no, from twelve; from eighteen, his records alone");
// ═══════════════════════════════════════════════════════════════════
{
  ok("his no at fourteen, the old wording: not named anywhere, over his guardian's yes and by terms",
     only({ consents: [g({ givenOn: "2026-10-10" }), pNo({ givenOn: "2026-09-01" })], ...BY_TERMS }, []),
     each({ consents: [g({ givenOn: "2026-10-10" }), pNo()], ...BY_TERMS }));
  ok("...given before his guardian's yes, it still stands: a guardian cannot lift it",
     only({ consents: [pNo({ givenOn: "2026-08-01" }), g({ givenOn: "2026-11-01", surface: "card" })] }, []));
  ok("his no to the live page alone: live is a position; card and board go on to the guardians and the default",
     only({ consents: [pNo({ surface: "live" }), g({ surface: "card" })], ...BY_TERMS }, ["card", "board"]),
     each({ consents: [pNo({ surface: "live" }), g({ surface: "card" })], ...BY_TERMS }));
  ok("his no from a self link since replaced still counts (must-never 3)",
     only({ consents: [pNo({ giverLive: false }), g({ givenOn: "2026-11-01" })], ...BY_TERMS }, []));
  ok("a yes he gave before eighteen names nobody, even marked competent (must-never 14)",
     only({ consents: [p({ surface: "card" })] }, []) && only({ consents: [p({ surface: "card", adult: false })] }, []));
  ok("his yes at eighteen names him on its surface, over his guardian's older no",
     only({ consents: [gNo({ givenOn: "2026-03-01" }), p({ adult: true, surface: "card", givenOn: "2026-09-01" })] }, ["card"]));
  ok("...and his no at eighteen unnames him over his guardian's yes",
     only({ consents: [g({ givenOn: "2026-10-01" }), pNo({ adult: true, givenOn: "2026-09-01" })], ...BY_TERMS }, []));
  ok("...and from eighteen, once he has a record, his guardian's yes and the default are not read",
     only({ consents: [g({ givenOn: "2026-10-01" }), p({ adult: true, surface: "live" })], ...BY_TERMS }, ["live"]),
     each({ consents: [g({ givenOn: "2026-10-01" }), p({ adult: true, surface: "live" })], ...BY_TERMS }));
  ok("his own yes at eighteen lifts his own no from fourteen",
     only({ consents: [pNo({ givenOn: "2025-03-01" }), p({ adult: true, givenOn: "2026-09-01" })] }, ["card", "live"]));
  ok("his yes at eighteen needs a live self link (B2)",
     only({ consents: [p({ adult: true, giverLive: false })], ...BY_TERMS }, []));
  ok("a record of his dated after the day served has not begun",
     only({ consents: [g({ surface: "card" }), pNo({ givenOn: "2026-12-01" })] }, ["card"])
     && only({ consents: [g({ surface: "card" }), p({ adult: true, surface: "live", givenOn: "2026-12-01" })] }, ["card"]));
}

// ═══════════════════════════════════════════════════════════════════
group("§5.1 line 5, B1 — wording narrows a yes, never a no");
// ═══════════════════════════════════════════════════════════════════
{
  ok("a yes to the old wording names card and live, never board",
     only({ consents: [g({ surface: null })] }, ["card", "live"]), each({ consents: [g({ surface: null })] }));
  ok("...and on board the default decides, as for a family that never answered there",
     only({ consents: [g({ surface: null })], ...BY_TERMS }, ["card", "live", "board"]));
  ok("a no to the old wording is a no on card, live and board, by terms on",
     only({ consents: [gNo({ surface: null })], ...BY_TERMS }, []), each({ consents: [gNo({ surface: null })], ...BY_TERMS }));
  ok("...and so is a withdrawal of the old wording's yes",
     only({ consents: [g({ surface: null, givenOn: "2026-06-01", endedOn: "2026-10-03" })], ...BY_TERMS }, []));
  ok("B1's case: guardian A's old-wording no in October, guardian B agrees to -03: line 6 is never reached",
     only({ consents: [gNo({ givenOn: "2026-10-03", surface: null })], ...BY_TERMS }, []));
  ok("a no to one surface covers that surface only",
     only({ consents: [g({ surface: null, givenOn: "2026-06-01" }), gNo({ surface: "card", givenOn: "2026-11-20" })] }, ["live"]));
  ok("a yes to one surface names that surface only",
     ALL.every((s) => only({ consents: [g({ surface: s })] }, [s])));
  ok("a wording nobody can read: its no covers every surface, its yes names none",
     only({ consents: [gNo({ surface: /** @type {any} */ ("stream") })], ...BY_TERMS }, [])
     && only({ consents: [gNo({ surface: undefined })], ...BY_TERMS }, [])
     && only({ consents: [g({ surface: /** @type {any} */ ("stream") })] }, [])
     && only({ consents: [g({ surface: undefined })] }, []));
  ok("...and, being no answer anywhere, its yes leaves each surface to the default",
     only({ consents: [g({ surface: /** @type {any} */ ("stream") })], ...BY_TERMS }, ALL));
}

// ═══════════════════════════════════════════════════════════════════
group("§5.1 line 5, B2 — a no never lapses by someone else's act; a yes needs a live giver");
// ═══════════════════════════════════════════════════════════════════
{
  const revoked = gNo({ giverLive: false, givenOn: "2026-10-03" });
  ok("B2's case: a mother's no, her link since revoked; the father agrees to -03: not named",
     only({ consents: [revoked], ...BY_TERMS }, []));
  ok("...and the father's explicit yes before her no does not name him either",
     only({ consents: [g({ givenOn: "2026-09-01" }), revoked], ...BY_TERMS }, []));
  ok("...only a live competent yes given after her no names him",
     only({ consents: [revoked, g({ givenOn: "2026-11-01" })] }, ["card", "live"]));
  ok("a withdrawal counts the same, its giver since revoked or dated out",
     only({ consents: [g({ giverLive: false, givenOn: "2026-06-01", endedOn: "2026-10-03" })], ...BY_TERMS }, []));
  ok("a yes from a giver no longer live today does not count",
     only({ consents: [g({ giverLive: false })] }, []) && only({ consents: [g({ giverLive: undefined })] }, [])
     && only({ consents: [g({ giverLive: /** @type {any} */ (1) })] }, []));
  ok("...and is not an answer, so the default may still name him (her terms record is the database's to judge)",
     only({ consents: [g({ giverLive: false })], ...BY_TERMS }, ALL));
  ok("a yes not competent the day it was given names nobody",
     only({ consents: [g({ competent: false })] }, []) && only({ consents: [g({ competent: /** @type {any} */ ("yes") })] }, []));
  // Reading 3 is decided: its group follows this one.
  ok("a record from someone the rule does not know counts neither way",
     only({ consents: [/** @type {any} */ ({ ...gNo(), by: "coach" })], ...BY_TERMS }, ALL));
}

// ═══════════════════════════════════════════════════════════════════
group("§5.1 Reading 3 — a no that is not counted still stops the default, never a counted yes");
// ═══════════════════════════════════════════════════════════════════
{
  // 13 Nov 2026 (Kameel): "As recommended: an uncounted no still stops the
  // default." Line 5 counts a no only from a giver competent the day it was
  // given; §0.4 and must-never 3 say no default outvotes a no, whoever gave it.
  // So such a no stops line 6, and only line 6.
  /** A guardian's no given before her link was verified: not competent that day. @param {Partial<NameConsent>} [c] */
  const unNo = (c = {}) => gNo({ competent: false, ...c });

  // An uncounted no, with no counted answer.
  ok("an uncounted no and nothing counted, by terms on: not named anywhere",
     only({ consents: [unNo()], ...BY_TERMS }, []), each({ consents: [unNo()], ...BY_TERMS }));
  ok("...with its competence missing or truthy but not true, the same",
     only({ consents: [unNo({ competent: undefined })], ...BY_TERMS }, [])
     && only({ consents: [unNo({ competent: /** @type {any} */ ("yes") })], ...BY_TERMS }, []));
  ok("...an uncounted withdrawal is a no too",
     only({ consents: [g({ competent: false, givenOn: "2026-06-01", endedOn: "2026-10-03" })], ...BY_TERMS }, []));
  ok("...and so is his own, given while it did not count (whoever gave it)",
     only({ consents: [pNo({ competent: false })], ...BY_TERMS }, []));
  ok("...its giver since revoked: still a no (must-never 3)",
     only({ consents: [unNo({ giverLive: false })], ...BY_TERMS }, []));
  ok("...on the surfaces its wording reaches: a no to card leaves live and board to the default (B1)",
     only({ consents: [unNo({ surface: "card" })], ...BY_TERMS }, ["live", "board"]),
     each({ consents: [unNo({ surface: "card" })], ...BY_TERMS }));
  ok("...and one dated after the day served has not begun",
     only({ consents: [unNo({ givenOn: "2026-12-01" })], ...BY_TERMS }, ALL));

  // An uncounted no, then a later counted yes.
  const thenYes = [unNo({ givenOn: "2026-10-03" }), g({ givenOn: "2026-11-01" })];
  ok("an uncounted no, then his verified other guardian's yes: named on the yes's surfaces",
     only({ consents: thenYes }, ["card", "live"]), each({ consents: thenYes }));
  ok("...by terms on: card and live by the yes; board, which the yes never named, stopped by the no",
     only({ consents: thenYes, ...BY_TERMS }, ["card", "live"]), each({ consents: thenYes, ...BY_TERMS }));
  ok("...the same giver's own yes once her link is verified: named",
     only({ consents: [unNo({ givenOn: "2026-10-03" }), g({ givenOn: "2026-11-01", surface: "board" })], ...BY_TERMS }, ["board"]));

  // A counted yes, then a later uncounted no: the latest COUNTED answer is the
  // yes, and a counted yes names him. Line 5 decides, so the uncounted no is
  // never read there; it stops only the default, where no counted answer is.
  const thenNo = [g({ givenOn: "2026-10-01" }), unNo({ givenOn: "2026-11-01" })];
  ok("a counted yes, then a later uncounted no: named, the counted yes being the latest counted answer",
     only({ consents: thenNo }, ["card", "live"]), each({ consents: thenNo }));
  ok("...but not named by default where the yes does not reach: board, by terms on",
     only({ consents: thenNo, ...BY_TERMS }, ["card", "live"]), each({ consents: thenNo, ...BY_TERMS }));
  ok("...the same on a one-surface yes",
     only({ consents: [g({ surface: "live", givenOn: "2026-10-01" }), unNo({ givenOn: "2026-11-01" })], ...BY_TERMS }, ["live"]));
  ok("...a counted no is still a no, whatever uncounted answer follows",
     only({ consents: [gNo({ givenOn: "2026-10-01" }), g({ competent: false, givenOn: "2026-11-01" })], ...BY_TERMS }, []));

  // The adult switch: once he has a record given at eighteen, only his records count.
  const adultYes = p({ adult: true, givenOn: "2026-09-01" });
  ok("his yes at eighteen, then his guardian's uncounted no: named, only his records being read",
     only({ consents: [adultYes, unNo({ givenOn: "2026-11-01" })], ...BY_TERMS }, ["card", "live"]),
     each({ consents: [adultYes, unNo({ givenOn: "2026-11-01" })], ...BY_TERMS }));
  ok("...and his own uncounted no after it does not outweigh it either",
     only({ consents: [adultYes, pNo({ competent: false, givenOn: "2026-11-01" })], ...BY_TERMS }, ["card", "live"]));
  ok("...while his own counted no at eighteen does",
     only({ consents: [adultYes, pNo({ adult: true, givenOn: "2026-11-01" })], ...BY_TERMS }, []));
}

// ═══════════════════════════════════════════════════════════════════
group("§5.1 line 5 — the latest explicit answer, by the day it was given");
// ═══════════════════════════════════════════════════════════════════
{
  ok("A's no in October, B's yes in November: named (the later decides)",
     only({ consents: [gNo({ givenOn: "2026-10-03" }), g({ givenOn: "2026-11-01" })] }, ["card", "live"]));
  ok("A's yes in October, B's no in November: not named",
     only({ consents: [g({ givenOn: "2026-10-01" }), gNo({ givenOn: "2026-11-01" })] }, []));
  ok("a tie on the day goes to the no",
     only({ consents: [g({ givenOn: "2026-11-01" }), gNo({ givenOn: "2026-11-01" })] }, []));
  ok("a withdrawal is a no on the day it was made, so it outweighs another guardian's earlier yes",
     only({ consents: [g({ givenOn: "2026-10-05" }), g({ givenOn: "2026-10-01", endedOn: "2026-10-10" })] }, []));
  ok("...and a yes given after that withdrawal names him again",
     only({ consents: [g({ givenOn: "2026-10-01", endedOn: "2026-10-10" }), g({ givenOn: "2026-10-20" })] }, ["card", "live"]));
  ok("a withdrawal reaches the past: served before it, named; from its day, not (C3)",
     only({ on: "2026-10-09", consents: [g({ givenOn: "2026-10-01", endedOn: "2026-10-10" })] }, ["card", "live"])
     && only({ on: "2026-10-10", consents: [g({ givenOn: "2026-10-01", endedOn: "2026-10-10" })] }, []));
  ok("an answer dated after the day served has not begun",
     only({ consents: [g({ givenOn: "2026-12-01" })] }, []) && only({ consents: [g(), gNo({ givenOn: "2026-12-01" })] }, ["card", "live"]));
  ok("an end before its start is a no on the day served, on every surface its wording reaches (main does not name him either)",
     only({ consents: [g({ givenOn: "2026-10-10", endedOn: "2026-10-05" })], ...BY_TERMS }, [])
     && only({ consents: [g({ givenOn: "2026-10-10", endedOn: "2026-10-05", surface: "card" })], ...BY_TERMS }, ["live", "board"])
     && only({ consents: [g({ givenOn: "2026-10-10", endedOn: "2026-10-05" }), g({ givenOn: ON })] }, [])
     && publicName({ ...BASE, consents: [g({ givenOn: "2026-10-10", endedOn: "2026-10-05" })] }) === "Batter");
  ok("a day that cannot be read is a no, the latest it could be",
     only({ consents: [g({ givenOn: "2026-11-25" }), g({ givenOn: "03/10/2026" })], ...BY_TERMS }, [])
     && only({ consents: [g({ givenOn: "2026-10-01", endedOn: "soon" })], ...BY_TERMS }, [])
     && only({ consents: [g({ givenOn: "2026-02-30" })], ...BY_TERMS }, []));
}

// ═══════════════════════════════════════════════════════════════════
group("§5.1 line 6 — public by terms, only where no explicit answer counts");
// ═══════════════════════════════════════════════════════════════════
for (const s of ALL) {
  ok(`${s}: nobody answered, the database finds line 6 holds, the read allows it: named`, at(s, BY_TERMS) === NAMED);
  ok(`${s}: nobody answered and by terms off: not named (must-never 1)`,
     at(s, { byTerms: false }) === "Batter" && at(s, { byTerms: undefined }) === "Batter" && at(s, { consents: undefined, byTerms: false }) === "Batter");
  ok(`${s}: a read that does not allow by terms (the overlay, a pack, a shared card) names nobody by it`,
     [false, undefined, "true", 1, null].every((v) => at(s, { byTerms: true, byTermsAllowed: /** @type {any} */ (v) }) === "Batter"));
  ok(`${s}: byTerms must be exactly true`,
     [undefined, "true", 1, null].every((v) => at(s, { byTerms: /** @type {any} */ (v), byTermsAllowed: true }) === "Batter"));
}
{
  // must-never 3: a default outvoting a no — anyone's, of any date, at any
  // wording, on any surface, a revoked or replaced giver's included.
  const noes = {
    "the other guardian's old no": [gNo({ givenOn: "2025-02-01", surface: null })],
    "the pupil's own": [pNo()],
    "the guardian's own at agreement (a chose_off writes a refusal on that surface)": [gNo({ givenOn: ON, surface: "card" })],
    "a revoked giver's": [gNo({ giverLive: false })],
    "a replaced self link's": [pNo({ giverLive: false })],
  };
  for (const [who, consents] of Object.entries(noes)) {
    const covered = ALL.filter((s) => at(s, { consents, ...BY_TERMS }) === "Batter");
    ok(`must-never 3: the default never outvotes ${who}`, consents[0].surface ? covered.includes(consents[0].surface) : covered.length === 3, covered.join(","));
  }
  // must-never 5: the database answers byTerms false while the school's basis
  // or the platform setting is off, or for a default_on choice the setting no
  // longer allows; the rule then names nobody by terms, and explicit yeses stand.
  ok("must-never 5: by terms off names nobody who has no explicit yes", only({ byTerms: false }, []));
  ok("...and an explicit yes stands with the setting off", only({ consents: [g({ surface: "board" })], byTerms: false }, ["board"]));
  ok("an explicit yes is named whether or not the read allows by terms",
     only({ consents: [g({ surface: null })], byTermsAllowed: false }, ["card", "live"]));
}

// ═══════════════════════════════════════════════════════════════════
group("§4.1 — the terms versions: one ordered list, never string order");
// ═══════════════════════════════════════════════════════════════════
{
  ok("popia-2026-01, -02, -03, -04, oldest first, frozen",
     JSON.stringify(TERMS_VERSIONS) === JSON.stringify(["popia-2026-01", "popia-2026-02", "popia-2026-03", "popia-2026-04"])
     && Object.isFrozen(TERMS_VERSIONS) && Object.isFrozen(TERMS));
  ok("ISSUED is -01 (in force), OPT_IN is -02 (tier C, reserved), BY_TERMS is -03 (tier A), FORCED_CHOICE is -04 (tier B)",
     TERMS.ISSUED === "popia-2026-01" && TERMS.OPT_IN === "popia-2026-02" && TERMS.BY_TERMS === "popia-2026-03"
     && TERMS.FORCED_CHOICE === "popia-2026-04");
  ok("ranked by the list", TERMS_VERSIONS.every((v, i) => termsRank(v) === i));
  ok("-03 or later: -03 and -04 are, -01 and -02 are not",
     termsAtLeast(TERMS.BY_TERMS, TERMS.BY_TERMS) && termsAtLeast(TERMS.FORCED_CHOICE, TERMS.BY_TERMS)
     && !termsAtLeast(TERMS.ISSUED, TERMS.BY_TERMS) && !termsAtLeast(TERMS.OPT_IN, TERMS.BY_TERMS));
  ok("a version the list does not hold is refused, even one that sorts later as a string",
     throws(() => termsRank("popia-2026-10")) && throws(() => termsAtLeast("popia-2026-10", TERMS.BY_TERMS))
     && throws(() => termsAtLeast(TERMS.BY_TERMS, "popia-2026-05")) && throws(() => termsRank(undefined)) && throws(() => termsRank(" popia-2026-01")));
}

// ═══════════════════════════════════════════════════════════════════
group("§4.1 — drift: every terms version the code and the migrations write is on the list");
// ═══════════════════════════════════════════════════════════════════
const VERSION = /\bpopia-\d{4}-\d{2}\b/g;
/** Every file under `dir` matching `re`, as paths. @param {string} dir @param {RegExp} re @returns {string[]} */
const filesUnder = (dir, re) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (e.name === "node_modules" || e.name === "dist" ? [] : filesUnder(join(dir, e.name), re))
    : re.test(e.name) ? [join(dir, e.name)] : []);
{
  const web = readFileSync(join(ROOT, "apps", "web", "src", "lib", "guardianLink.js"), "utf8");
  const issued = web.match(/export const GUARDIAN_TERMS_VERSION = "([^"]+)"/)?.[1];
  ok(`the web issues ${issued}: TERMS.ISSUED`, issued === TERMS.ISSUED, issued);

  const sources = [
    ...migrationFiles(DB).map((f) => join(DB, f)),
    ...filesUnder(join(ROOT, "apps", "web", "src"), /\.(m?js|jsx)$/),
    ...filesUnder(join(ROOT, "services", "api"), /\.mjs$/),
  ];
  /** @type {Map<string, string[]>} */
  const found = new Map();
  for (const f of sources) {
    for (const m of readFileSync(f, "utf8").matchAll(VERSION)) found.set(m[0], [...(found.get(m[0]) ?? []), f.slice(ROOT.length + 1)]);
  }
  const outside = [...found].filter(([v]) => !TERMS_VERSIONS.includes(v));
  ok(`every terms version written in ${sources.length} migrations and sources is on the list (${[...found.keys()].join(", ")})`,
     found.size > 0 && outside.length === 0, outside.map(([v, fs]) => `${v} in ${fs[0]}`).join("; "));
  ok("...and the check sees one that is not", ![..."x popia-2026-07 y".matchAll(VERSION)].every((m) => TERMS_VERSIONS.includes(m[0])));
}

// The SQL copy (§4.1: "the list lives in the policy package and in SQL").
// Slice 4 (db/150) writes it as terms_versions(), an ordered text[]; from then
// the latest migration that writes it must say this list, in this order.
// Until then there is no second copy to drift, and this says so.
/** The list in a `terms_versions()` body, or null. @param {string} sql */
const sqlList = (sql) => {
  const m = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+terms_versions\s*\(\s*\)[\s\S]*?\$\$([\s\S]*?)\$\$/i.exec(sql);
  const arr = m && /ARRAY\s*\[([^\]]*)\]/i.exec(m[1]);
  return arr ? [...arr[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
};
{
  const files = migrationFiles(DB);
  const writing = files.filter((f) => /FUNCTION\s+terms_versions\s*\(/i.test(readFileSync(join(DB, f), "utf8")));
  const last = writing[writing.length - 1];
  if (last) {
    const list = sqlList(readFileSync(join(DB, last), "utf8"));
    ok(`the latest terms_versions() (${last}) is TERMS_VERSIONS, in order`, JSON.stringify(list) === JSON.stringify(TERMS_VERSIONS), JSON.stringify(list));
  } else {
    ok("no migration writes terms_versions() yet (slice 4, db/150): there is one copy, this one", writing.length === 0);
  }
  const good = `CREATE OR REPLACE FUNCTION terms_versions() RETURNS text[] AS $$ SELECT ARRAY['popia-2026-01','popia-2026-02','popia-2026-03','popia-2026-04']::text[] $$ LANGUAGE sql IMMUTABLE;`;
  ok("the reader finds the list in a body written like that", JSON.stringify(sqlList(good)) === JSON.stringify(TERMS_VERSIONS));
  ok("...and sees two swapped", JSON.stringify(sqlList(good.replace("'popia-2026-02','popia-2026-03'", "'popia-2026-03','popia-2026-02'"))) !== JSON.stringify(TERMS_VERSIONS));
  ok("...and one more", JSON.stringify(sqlList(good.replace("]::", ",'popia-2026-05']::"))) !== JSON.stringify(TERMS_VERSIONS));
}

console.log("\n" + "─".repeat(52));
console.log(`PUBLIC BY TERMS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
