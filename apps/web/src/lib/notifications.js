/**
 * One store for a person's notices: the list, the count, and what marks a
 * notice read (docs/design/NOTIFICATIONS.md D17).
 *
 * Before this, the list was read by each screen and the count was each
 * screen's own .filter(!read) over it, and "Mark all read" changed one page's
 * memory: every badge counted every notice for ever, and two badges could
 * disagree. Now:
 *
 *   - the LIST is GET /api/read/notifications (my_notifications, db/89,
 *     newest 200), and the COUNT is the summary's unread_alerts — the same
 *     view, counted by the server, never by the length of a list that has a
 *     LIMIT on it;
 *   - opening a notice is POST /api/notifications/:id/read, which marks it
 *     read for this person on every device, and returns its body (a tiered
 *     notice lists its title only; its open is logged by the server);
 *   - "Mark all read" is POST /api/notifications/read-all;
 *   - every badge, the Notices screens, Family and the day sheet read this
 *     one store, so a notice opened on one screen is read on all of them.
 *
 * An open or a mark-all decrements the count at once (optimistic) and then
 * takes the server's count from the answer, counted over the same view in the
 * same transaction. A refusal puts the optimistic change back.
 *
 * A CACHED NOTICE IS NOT PERMISSION. The store's state belongs to one
 * session: its key is the role and the bearer token, and a different key
 * starts from nothing — loading, no rows, no count — so a person who signs in
 * after somebody else on the same tab never sees, even for a frame, what the
 * first one was sent. Signed out, the store is the demo: the mock notices
 * scoped through the client-side copy of authorize(), read state kept in
 * memory, nothing sent anywhere.
 */
import { useEffect, useSyncExternalStore } from "react";
import { api, getToken, signedIn } from "./api.js";
import { scoped } from "../rbac/index.js";

/** D16's one sentence, the server's own words for "not available". */
export const GONE = "This notice is no longer available.";

/**
 * A notification row from GET /api/read/notifications or from opening one,
 * in the shape the screens draw.
 * @param {any} r
 */
export function asNotification(r) {
  return {
    id: r.id, type: r.kind, urgency: r.urgency, title: r.title,
    // Null for a tiered notice until it is opened (D17): the list carries its
    // title only.
    body: r.body ?? null,
    tiered: !!r.tiered,
    time: r.published_at, read: !!r.read, team: r.team_code, school: r.school_id,
    // What the notice is about (SCRBRD-137 S12): a fixture, say, by its id. The
    // cockpit's notices lane shows only those about the match it is open on.
    subjectKind: r.subject_kind ?? null, subjectId: r.subject_id ?? null,
    // The child a notice is about, when it is about one (step 4 P1/P5): a
    // family screen says whose it is, and a parent who is also staff sees on
    // a child's Home only the notices about that child or about nobody.
    subjectPerson: r.subject_person_id ?? null,
    // On a "withdrawn" notice, the notice it says was withdrawn (D18).
    retracts: r.retracts_id ?? null,
    // The mock carried a `roles: [...]` list, and it was never security — it
    // was a filter the browser applied to rows it already held. The server
    // does not send a notice this person may not have, so there is nothing
    // left to filter and no list to carry.
    live: true,
  };
}

/**
 * What opening a notice answered, as a screen draws it: the whole notice, a
 * stub (D19: withdrawn, when, and which notice says so), or gone (D16).
 * @param {any} n  the server's `notice`, or null
 */
export function asOpened(n) {
  if (!n) return { gone: true, sentence: GONE };
  if (n.withdrawn) {
    return { withdrawn: true, id: n.id, retractedAt: n.retracted_at ?? null, withdrawal: n.withdrawal_id ?? null,
             sentence: withdrawnWords(n.retracted_at) };
  }
  return { ...asNotification(n), read: true };
}

/** "This notice was withdrawn on 3 October." @param {string | null | undefined} at */
export function withdrawnWords(at) {
  const d = at ? new Date(at) : null;
  if (!d || Number.isNaN(d.getTime())) return "This notice was withdrawn.";
  const day = d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", timeZone: "Africa/Johannesburg" });
  return `This notice was withdrawn on ${day}.`;
}

// ── The state ───────────────────────────────────────────────────────
/**
 * @typedef {{ rows: any[], live: boolean, loading: boolean, error: string | null, status: number | null }} ListRead
 * @typedef {{ key: string | null, list: ListRead, unread: number | null, opened: Record<string, any>,
 *             demoRead: Record<string, true> }} State
 */
const LOADING = Object.freeze({ rows: [], live: false, loading: true, error: null, status: null });

/** @returns {State} */
const blank = (/** @type {string | null} */ key) =>
  ({ key, list: LOADING, unread: null, opened: {}, demoRead: {} });

/** @type {State} */
let state = blank(null);
/** @type {Set<() => void>} */
const listeners = new Set();
let generation = 0;   // a fetch answers only the session that asked

function set(/** @type {Partial<State>} */ next) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

/** Whose state this is: the role, and the session (the bearer itself). */
export function sessionKey(/** @type {string} */ role) {
  return `${role ?? ""}|${signedIn() ? getToken() : "demo"}`;
}

/** The demo: the mock notices through the client-side scope, read in memory. */
function demoRows(/** @type {string} */ role, /** @type {Record<string, true>} */ demoRead) {
  return scoped("notifications", role).map((n) => ({ ...n, read: !!(n.read || demoRead[n.id]) }));
}
const countUnread = (/** @type {any[]} */ rows) => rows.filter((n) => !n.read).length;

/**
 * Read the list and the count for this role's session. A changed session
 * starts again from nothing; the same session re-reads only when `force`.
 * @param {string} role @param {{ force?: boolean }} [o]
 */
export async function refresh(role, { force = false } = {}) {
  const key = sessionKey(role);
  // Asked already in this session (answered, or on its way): the screens
  // that mount together share one read.
  if (state.key === key && !force && state.list !== LOADING) return;
  if (state.key !== key) state = blank(key);
  if (!signedIn()) {
    const rows = demoRows(role, state.demoRead);
    set({ key, list: { rows, live: false, loading: false, error: null, status: null }, unread: countUnread(rows) });
    return;
  }
  const mine = ++generation;
  set({ key, list: { ...state.list, loading: true } });
  const [list, count] = await Promise.all([
    api("/api/read/notifications").then(
      (b) => ({ rows: (b?.rows ?? []).map(asNotification), live: true, loading: false, error: null, status: null }),
      (/** @type {any} */ e) => ({ rows: [], live: false, loading: false, error: e?.code || "unreachable", status: e?.status ?? null })),
    // The count is the server's, over the same view: never this list's length.
    api("/api/read/summary").then((b) => b?.rows?.[0]?.unread_alerts ?? null, () => null),
  ]);
  if (mine !== generation || state.key !== key) return;
  set({ list, unread: typeof count === "number" ? count : null });
}

/** Mark one row read (or not) in the list held now. */
const withRead = (/** @type {any[]} */ rows, /** @type {string} */ id, /** @type {boolean} */ read) =>
  rows.map((n) => (n.id === id ? { ...n, read } : n));

/**
 * Open a notice: read it and mark it read (D17). Resolves to what a screen
 * draws: the whole notice, a stub, or gone.
 * @param {string} role @param {string} id
 */
export async function open(role, id) {
  const key = sessionKey(role);
  if (state.key !== key) return { gone: true, sentence: GONE };
  const row = state.list.rows.find((n) => n.id === id);
  const wasUnread = !!row && !row.read;
  if (!signedIn()) {
    const demoRead = { ...state.demoRead, [id]: /** @type {true} */ (true) };
    const rows = withRead(state.list.rows, id, true);
    const opened = row ? { ...row, read: true } : { gone: true, sentence: GONE };
    set({ demoRead, list: { ...state.list, rows }, unread: countUnread(rows), opened: { ...state.opened, [id]: opened } });
    return opened;
  }
  // Optimistic: the row reads as read and the count falls, at once.
  const before = { list: state.list, unread: state.unread };
  if (wasUnread) {
    set({ list: { ...state.list, rows: withRead(state.list.rows, id, true) },
          unread: state.unread == null ? null : Math.max(0, state.unread - 1) });
  }
  try {
    const b = await api(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST", body: {} });
    if (state.key !== key) return asOpened(b?.notice);
    const opened = asOpened(b?.notice);
    set({ opened: { ...state.opened, [id]: opened },
          unread: typeof b?.unread === "number" ? b.unread : state.unread });
    return opened;
  } catch (/** @type {any} */ e) {
    if (state.key !== key) return { gone: true, sentence: GONE };
    if (e?.status === 404) {
      // Gone since the list was read (expired, withdrawn from under it, or a
      // link that was never this person's): said in the one sentence, and the
      // row leaves the list. The count is the server's again on next read.
      const opened = { gone: true, sentence: GONE };
      set({ opened: { ...state.opened, [id]: opened },
            list: { ...state.list, rows: state.list.rows.filter((n) => n.id !== id) } });
      void refresh(role, { force: true });
      return opened;
    }
    set(before);
    return { failed: true, sentence: "Could not open this notice. Try again." };
  }
}

/** "Mark all read" (D17): every notice in this person's list. @param {string} role */
export async function markAll(role) {
  const key = sessionKey(role);
  if (state.key !== key) return false;
  const rows = state.list.rows.map((n) => (n.read ? n : { ...n, read: true }));
  if (!signedIn()) {
    const demoRead = { ...state.demoRead };
    for (const n of state.list.rows) demoRead[n.id] = true;
    set({ demoRead, list: { ...state.list, rows }, unread: 0 });
    return true;
  }
  const before = { list: state.list, unread: state.unread };
  set({ list: { ...state.list, rows }, unread: 0 });
  try {
    const b = await api("/api/notifications/read-all", { method: "POST", body: {} });
    if (state.key === key && typeof b?.unread === "number") set({ unread: b.unread });
    return true;
  } catch {
    if (state.key === key) set(before);
    return false;
  }
}

/**
 * What reporting a notice says back (D11, CSA SG-9 rule 4), by the server's
 * answer. The reporter is never told who else reported it, nor anything about
 * the DSO; the person who posted it is never told who reported it.
 */
export const REPORT_WORDS = Object.freeze({
  taken: "Reported to the school's safeguarding officer. Whoever posted it is not told it was you.",
  unheld: "Reported, but your school has no safeguarding officer on SCRBRD yet. Please tell the school directly too.",
  already_reported: "You have already reported this notice.",
  no_such_notice: GONE,
  not_reportable: "Only a notice somebody wrote can be reported.",
  demo: "Sign in to report a notice.",
  failed: "Could not report it. Try again.",
});

/**
 * Whether a row may be reported: words a person wrote (`notice`), and not
 * the system's own "A notice was withdrawn". The server asks again.
 * @param {any} n  a row from asNotification()
 */
export const reportable = (n) => !!n && n.type === "notice" && !n.retracts;

/**
 * Report a person's notice to the school's DSOs, in one tap (D11). Resolves to
 * `{ done, words }`: `done` once the server holds a report from this person
 * (taken now, or before).
 * @param {string} id
 * @returns {Promise<{ done: boolean, words: string }>}
 */
export async function report(id) {
  if (!signedIn()) return { done: false, words: REPORT_WORDS.demo };
  try {
    const b = await api(`/api/notifications/${encodeURIComponent(id)}/report`, { method: "POST", body: {} });
    return { done: true, words: b?.unheld ? REPORT_WORDS.unheld : REPORT_WORDS.taken };
  } catch (/** @type {any} */ e) {
    const code = /** @type {keyof typeof REPORT_WORDS} */ (e?.code);
    return { done: code === "already_reported", words: REPORT_WORDS[code] ?? REPORT_WORDS.failed };
  }
}

/** The store's state now. Tests and non-React callers. */
export function snapshot() { return state; }
/** Forget everything: a sign-out, or a test between cases. */
export function resetNotifications() { generation++; state = blank(null); for (const l of listeners) l(); }

function subscribe(/** @type {() => void} */ l) { listeners.add(l); return () => { listeners.delete(l); }; }

/**
 * The store, for a screen. `nonce` is a screen's Retry: bumping it re-reads
 * the list and the count (the same reads, nothing wider). `fresh`: read again
 * on mount (the screens that list notices), not only on first use.
 *
 * `list` is the read state lib/readState.js turns into a sentence; `unread`
 * is the server's count, or null while uncounted — a badge says nothing then,
 * rather than a number nobody counted.
 * @param {string} role @param {number} [nonce] @param {{ fresh?: boolean }} [o]
 */
export function useNotifications(role, nonce = 0, { fresh = false } = {}) {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  const key = sessionKey(role);
  // A badge shares the session's read; a screen that lists notices (`fresh`)
  // reads again when it opens, and every badge moves with it.
  useEffect(() => { void refresh(role, { force: fresh || nonce > 0 }); }, [key, nonce]);   // eslint-disable-line react-hooks/exhaustive-deps
  const mine = s.key === key;
  return {
    list: mine ? s.list : LOADING,
    rows: mine ? s.list.rows : [],
    unread: mine ? s.unread : null,
    opened: mine ? s.opened : {},
    open: (/** @type {string} */ id) => open(role, id),
    markAll: () => markAll(role),
  };
}
