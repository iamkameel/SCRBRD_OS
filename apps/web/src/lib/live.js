/**
 * SCRBRD — reading live rows in place of mock ones.
 *
 * The views were written against the mock constants and read them through the
 * choke point in rbac/ — row-scoped and column-masked for the signed-in
 * principal, which is the right shape but the wrong data once there is a
 * server. This is the bridge: same call site, same shape, real rows.
 *
 * WHY AN ADAPTER AND NOT A RESHAPED API
 * ────────────────────────────────────
 * The API returns the database's column names, and it should — it is the
 * schema's vocabulary, and the read tests assert against it. The views speak
 * the product's vocabulary (`homeTeam`, `venue`, `status: "upcoming"`). One of
 * those has to bend, and it is cheaper and safer for the translation to live
 * in one named function than for either side to compromise.
 *
 * WHAT THIS IS NOT
 * ────────────────
 * Not an authorization layer. The rows arriving here have already been filtered
 * by row-level security and column-masked per capability, in Postgres, for this
 * person. Nothing below re-checks that, and nothing below should be trusted to:
 * if a field is present it is because the database decided this person may see
 * it. The mock fallback IS scoped client-side (through rbac/), because mock
 * rows have no database behind them — that is a demo affordance, not security.
 */
import { useEffect, useState } from "react";
import { api, signedIn } from "./api.js";

/** DB fixture status → the vocabulary the views filter on. */
const MATCH_STATUS = { scheduled: "upcoming", live: "live", complete: "complete", abandoned: "complete" };

/**
 * A fixture, in the shape the Match Centre draws.
 *
 * `opponent` is free text because a school SCRBRD does not host has no row to
 * point at, and `team_code` is the home side's scope anchor rather than a
 * display name — so the home team reads as the school's own team code until
 * there is a place to store a display name for it.
 */
function asMatch(r) {
  return {
    id: r.id,
    homeTeam: r.team_code ?? "Home",
    awayTeam: r.opponent,
    venue: r.ground ?? null,
    groundId: null,
    date: r.starts_at ? String(r.starts_at).slice(0, 10) : null,
    status: MATCH_STATUS[r.status] ?? "upcoming",
    result: null,
    competition: null,
    overs: r.overs,
    format: r.format,
    schoolId: r.school_id,
    // The scorecard is DERIVED, never stored — a live score comes from
    // replaying ball_event, not from a column. The Match Centre shows a
    // placeholder until the live-score read is wired to the same view.
    scorecard: null,
    live: true,
  };
}

const ADAPT = { matches: asMatch };

/**
 * Live rows for a resource, falling back to what was passed in.
 *
 * Returns `mockRows` immediately so the page paints without waiting, then
 * swaps once the server answers. On failure it keeps the fallback and reports
 * it: a fixture list that silently empties on a flaky connection looks like
 * "no matches today", which is a different and much worse statement.
 */
export function useLiveRows(resource, mockRows) {
  const [state, setState] = useState({ rows: mockRows, live: false, error: null });

  useEffect(() => {
    if (!signedIn() || !ADAPT[resource]) return;
    let cancelled = false;
    (async () => {
      try {
        const { rows } = await api(`/api/read/${resource}`);
        if (!cancelled) setState({ rows: rows.map(ADAPT[resource]), live: true, error: null });
      } catch (e) {
        if (!cancelled) setState({ rows: mockRows, live: false, error: e.code || "unreachable" });
      }
    })();
    return () => { cancelled = true; };
    // mockRows is rebuilt on every render by the scoped() call above the hook;
    // depending on it would refetch forever.
  }, [resource]);

  return state;
}
