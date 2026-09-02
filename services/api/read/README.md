# SCRBRD — Read Path (Step 3)

Wires the frontend's existing `getData()` seam to a real API, **one module at a
time**, with the rest still on mock. Reads go live before writes because they're
safe and they prove the whole pipe: token → principal → RLS → masked view → rows.

## Files

| File | Role |
|---|---|
| `read-api.mjs` | Server read layer. `readResource()` runs every read through `runAsPrincipal()`; PII/clinical resources read the `*_masked` views. |
| `data-client.mjs` | Client accessor. `getData(resource)` serves mock or live per a feature flag. Views call this and don't change. |
| `read.test.mjs` | 30 assertions: reads run under a principal txn, use masked views, do no handler-side RBAC; client honours flags and never silently falls back to mock. |

Repo layout assumed: `read/` and `auth/` are siblings (imports use `../auth/...`).

## The key property

**The server does no RBAC.** `readResource()` picks a query and returns rows —
identical SQL for every role. Because it runs inside `runAsPrincipal()`, the
database does the work:

- **RLS** filters rows: a spectator's `select … from injury` returns 0 rows; a
  coach's `select … from player_masked` returns only their team.
- **Masked views** null columns: an analyst reading `player_masked` gets
  `born IS NULL`.

So there is no place in the handler to get authorization wrong — it isn't there.
That's the payoff of Steps 1–2.

## Rollout: flip one resource at a time

```js
const data = createDataClient({
  apiBase: "https://api.scrbrd.co.za",
  getToken: () => auth.token,
  mockSource: (resource, params) => MOCK[resource],   // the existing seed
  flags: { matches: true, competitions: true,         // ← live
           players: false, injuries: false },         // ← still mock
});
// every view keeps calling data.getData("players") — unaware which are live
```

Recommended order (safest first):
1. `matches`, `competitions`, `live_score` — public-ish, no PII, proves the pipe.
2. `players` — first masked resource; confirm PII masking in the UI for analyst.
3. `injuries` — strongest RBAC case; confirm spectator sees nothing, medical sees notes.
4. Remaining resources as their queries are added to `READ_QUERIES`.

`setFlag(resource, true)` can flip a resource at runtime from remote config, so a
module can go live (or be rolled back) without a deploy.

## Failure handling

A live read that fails (401, 500, network) **throws** — it never silently returns
mock data, because stale data masking an auth failure is worse than an error. The
caller decides: show an error, retry, or (for the scorer) fall to the offline
path. `onError` surfaces failures to telemetry.

## What this is NOT

- Not the scorecard *replay*. Full batting/bowling cards derive from replaying
  `ball_event`; `live_score` here reads the pre-aggregated `match_live_score`
  view (derived, never stored). Full replay is a read built in Step 4 alongside
  the write path, reusing the same event log.
- Not caching. Add a small TTL cache in `getData` later if needed; kept out now
  so correctness is obvious.

## Honest limits

Unit-tested with a fake pool and fake fetch — the logic, the transaction shape,
and the masked-view usage are proven here. The real gate is running it against
Postgres with `rls_verify.sql` applied: point one view at the live API and
confirm, in the actual UI, that an analyst's player list shows blank PII and a
spectator's injuries list is empty.
