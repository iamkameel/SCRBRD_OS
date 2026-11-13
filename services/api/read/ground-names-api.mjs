/**
 * SCRBRD — whom the big screen at the ground may name, and by what label
 * (PUBLIC_BY_TERMS §2.5, slice 1; Kameel, 12 Nov 2026, 21:00: "we should be
 * masking the names of any boy that doesn't have a public profile").
 *
 *   GET /api/matches/:id/ground-names
 *     { matchId, sides: [{ team, position_only, log_seq }], labels: { <player id>: "D Erasmus" } }
 *
 * ONE READ, ONE SNAPSHOT (Fable's red-team, 13 Nov, B1). Everything here is
 * ground_screen_names() (db/153): each side's position-only answer, and,
 * only for a side answered false, the public page's own facts
 * (public_match_people(), db/59) for that side's first-squad boys. Sides
 * and facts come from one statement, so the flag and the labels can never
 * disagree, and a position-only side carries no boy's facts at all: no
 * reader can set the labels beside the flag to find the boy whose mark
 * turned it. Nothing else is asked; there is no second request.
 *
 * THE SAME RULE AS THE PUBLIC PAGE, NOT A SECOND ONE. The label is nameFor()
 * (redact.mjs: publicName(), the one rule) on those facts, as the public log
 * makes it, its published-fixture test included. It is asked whether or not
 * the public pages are switched on (PUBLIC_PAGES): the question is whether
 * the public page WOULD name him. A fixture no school has published names
 * nobody, as on the public page.
 *
 * THE SAME GATE: ground_screen_names() answers a reader outside it — not the
 * host's staff, a pupil, a pad credential, a roster-mover who may not read
 * the mark, signed out (refused before anything is read) — no rows, so no
 * sides and no labels.
 *
 * LABELS ONLY. The label the public page would show, keyed by the player id
 * the signed-in log carries. No reason, no consent, no mark, no date, no
 * name beyond the label: the name columns go no further than nameFor(). A
 * boy left out is shown by position. Never cached (no-store).
 *
 * What a host staff reader can infer (READERS_child_data K: a coach reads no
 * consent): which boys the public page would not name. The crowd sees the
 * same on the screen. Recorded in the PR for the red-team.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { nameFor } from "../public/redact.mjs";
/** @import { RouteDeps, IdHandler } from "../api-types.mjs" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The labels, from public_match_people()'s rows: nameFor() on the day each
 * row was served, and nothing for a boy it does not name.
 * @param {any[]} people  @returns {Record<string, string>}
 */
export function groundLabels(people) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const p of Array.isArray(people) ? people : []) {
    const label = nameFor(p, p?.served_on);
    if (label && typeof p?.player_id === "string" && UUID.test(p.player_id)) out[p.player_id] = label;
  }
  return out;
}

/** @param {RouteDeps} deps @returns {Record<string, IdHandler>} */
export function groundNamesRoutes({ pool, secret }) {
  return {
    read: async (req, res) => {
      res.setHeader?.("cache-control", "no-store");
      const id = String(req.params.id ?? "");
      if (!UUID.test(id)) return res.status(404).json({ error: "no_such_fixture" });
      try {
        const rows = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) =>
          (await client.query(`select team, position_only, log_seq, people from ground_screen_names($1)`, [id])).rows);
        res.json(groundAnswer(id, rows));
      } catch (/** @type {any} */ e) {
        // A fixed word: never a database message.
        res.status(e?.status || 500).json({ error: e?.status && typeof e.code === "string" ? e.code : "unavailable" });
      }
    },
  };
}

/**
 * The answer from ground_screen_names()'s rows: the sides as the database
 * answered them, and labels only from the facts it sent for a side answered
 * false. A side answered anything but false lends no label, whatever came.
 * @param {string} matchId @param {any[]} rows
 */
export function groundAnswer(matchId, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const sides = list.map((r) => ({ team: r.team, position_only: r.position_only !== false, log_seq: Number(r.log_seq) || 0 }));
  /** @type {Record<string, string>} */
  const labels = {};
  for (const r of list) if (r.position_only === false) Object.assign(labels, groundLabels(r.people));
  return { matchId, sides, labels };
}
