/**
 * Who at a union looked: the family's lines (docs/design/UNION_SELECTOR_FIND.md
 * §3, §7, S4). A union selector's list writes one `'list'` row per boy each
 * time it answers (db/125), so a busy selector would bury the opened-passport
 * lines under his searches. The family sees each reader's list appearances
 * grouped per SA day with a count; an opened passport (`'passport'`) and a
 * name-only read (`'name'`) stay one line each, as before.
 *
 * The day is the child's: Africa/Johannesburg, taken from the row's own
 * timestamp, never the browser's zone and never the UTC date of the string.
 * A list answered at 01:00 SAST (23:00 UTC the day before) is on the SA day.
 * Kameel answered §7's Q3 yes (30 Oct 2026), so no "closes by 02:00" line.
 *
 * Pure (no DOM, no clock), so apps/web/test proves it under plain node.
 */

const ZONE = "Africa/Johannesburg";
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const WORDS = new Intl.DateTimeFormat("en-ZA", { timeZone: ZONE, day: "numeric", month: "short", year: "numeric" });

const asDate = (at) => {
  if (at == null || at === "") return null;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** The SA day of a timestamp, "YYYY-MM-DD", or null for none. */
export function saDay(at) {
  const d = asDate(at);
  if (!d) return null;
  const p = Object.fromEntries(DAY.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** The SA day in words, "30 Oct 2026", or "—". */
export function saDayWords(at) {
  const d = asDate(at);
  return d ? WORDS.format(d).replace(/\./g, "") : "—";
}

/**
 * @typedef {{playerId: string, readAt: string, readerName: string, readerRole: string,
 *            organisation: string, what: string}} UnionRead
 * @typedef {{kind: "list", playerId: string, readerName: string, readerRole: string,
 *            organisation: string, day: string | null, count: number, readAt: string}
 *           | {kind: "passport" | "name", playerId: string, readerName: string, readerRole: string,
 *            organisation: string, day: string | null, count: 1, readAt: string}} UnionReadLine
 */

/**
 * The family's lines, newest first: `'list'` rows grouped per boy, per reader
 * (his name, role and institution, as the log copied them) and per SA day,
 * with a count; every other row one line. A group sits where its newest row
 * falls, and `readAt` is that newest row's time.
 * @param {UnionRead[]} rows
 * @returns {UnionReadLine[]}
 */
export function unionReadLines(rows = []) {
  const at = (r) => asDate(r.readAt)?.getTime() ?? 0;
  const tie = (r) => [r.playerId, r.readerName, r.readerRole, r.organisation, r.what].map((x) => String(x ?? "")).join("\u0000");
  const sorted = [...rows].filter(Boolean).sort((a, b) => at(b) - at(a) || (tie(a) < tie(b) ? -1 : tie(a) > tie(b) ? 1 : 0));
  /** @type {UnionReadLine[]} */
  const out = [];
  const groups = new Map();
  for (const r of sorted) {
    const day = saDay(r.readAt);
    const base = { playerId: r.playerId, readerName: r.readerName, readerRole: r.readerRole,
                   organisation: r.organisation, day, readAt: r.readAt };
    if (r.what !== "list") { out.push({ kind: r.what === "name" ? "name" : "passport", ...base, count: 1 }); continue; }
    const key = JSON.stringify([r.playerId, r.readerName, r.readerRole, r.organisation, day]);
    const g = groups.get(key);
    if (g) { g.count += 1; continue; }
    const line = { kind: "list", ...base, count: 1 };
    groups.set(key, line);
    out.push(line);
  }
  return out;
}

const times = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

/**
 * One line in words (§3), after the boy's name:
 *   list:     "appeared in {reader}'s list ({role}), {union} · 3 times on 30 Oct 2026"
 *   passport: "{reader} ({role}), {union} · opened his passport on 30 Oct 2026"
 *   name:     "{reader} ({role}), {union} · his name only, on 30 Oct 2026"
 * @param {UnionReadLine} l
 */
export function unionReadWords(l) {
  const on = saDayWords(l.readAt);
  if (l.kind === "list") return `appeared in ${l.readerName}'s list (${l.readerRole}), ${l.organisation} · ${times(l.count)} on ${on}`;
  return `${l.readerName} (${l.readerRole}), ${l.organisation} · ${l.kind === "name" ? "his name only, on" : "opened his passport on"} ${on}`;
}
