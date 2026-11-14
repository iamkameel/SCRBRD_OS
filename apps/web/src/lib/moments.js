/**
 * THE MOMENT CARDS (SCRBRD-133 §5, decided 2 Oct, D1–D16; EXPERIENCE_PASS
 * Slice 2, C4): which card a read's new lines earn, how big, for how long,
 * and how a flurry is merged and queued. One module for the Match Centre,
 * the public page and the ground display (live.js useMoments()), so the
 * three cannot say a moment differently.
 *
 * PURE. No React, no DOM, no clock: momentsFrom() reads the lines that
 * arrived in one read and the fold before and after it, and returns cards;
 * enqueue() decides what waits. lib/moments.test.mjs (apps/web/test) feeds it
 * each trigger of §5.2 from a built log and asserts the exact card, the merge
 * and the drop. A wrong trigger is a silent lie on a public screen (§8 G3),
 * so every card here is matched on a field the generator or the fold sets,
 * never on the words of a line: a milestone line carries its fact
 * (`moment`, @scrbrd/scoring commentary.mjs), a penalty its side.
 *
 * WORDS. A card says only what the page already says: the generator's lines
 * and the fold's figures, in the page's own names (on the public page and the
 * display, the public projection's: publicName() or a position). A side by
 * `side()`, the caller's. A retirement, a bowler change, the keeper, a new
 * batter are no card (§5.2's last row): a retirement's reason is health (N2).
 *
 * ONLY WHAT ARRIVES. The caller passes the lines new since its last read and
 * nothing on the first: a reload replays nothing (live.js useArrivals()).
 * More than GAP deliveries in one read is a gap (the phone slept, the tab was
 * hidden, §4.4): no card for any of them; the board cuts to where the match
 * stands, and only the result, which is that state, is still its card.
 */

/** A card's size: a beat (the chip's colour), a big card (the board's lime), or held until the state changes. */
export const SIZE = Object.freeze({ BEAT: "beat", BIG: "big", HELD: "held" });

/** §5.2's times, in ms. A held card has none. */
export const SHOW_MS = Object.freeze({ beat: 2500, short: 4000, long: 6000 });

/** More than this many deliveries arriving in one read is a gap: no card (§4.4). */
export const GAP = 6;

/** At most this many cards wait their turn (§5.3; the built QUEUE_MAX was four). */
export const QUEUE_MAX = 3;

/**
 * §5.3's order of size, biggest first: the card a ball keeps when it earns
 * several, and the order a queue is judged in.
 */
export const ORDER = Object.freeze(["result", "stopped", "super_over_tied", "super_over", "hat_trick", "five_wickets", "hundred",
  "partnership_100", "fifty", "partnership_50", "wicket", "target", "revision", "innings_closed", "penalty", "six", "four"]);
const rank = (/** @type {string} */ kind) => { const i = ORDER.indexOf(kind); return i < 0 ? ORDER.length : i; };

/** A delivery's line: what GAP counts. */
const DELIVERY = new Set(["ball", "four", "six", "wicket"]);

const WORD = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const cap = (/** @type {string} */ s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const oversText = (/** @type {number} */ balls) => `${Math.floor(balls / 6)}${balls % 6 ? `.${balls % 6}` : ""}`;
/** The event a line was told from: `e:<id>` and `e:<id>#<n>` are one ball's. */
const ballOf = (/** @type {{key?: string}} */ c) => { const m = /^e:(.+?)(?:#\d+)?$/.exec(c?.key ?? ""); return m ? m[1] : null; };

/**
 * @typedef {{key: string, kind: string, size: string, ms: number | null, title: string, body: string | null,
 *   eyebrow: string | null, line: any}} Card
 *   `kind` one of ORDER; `ms` how long it shows (null: held); `title` the card's words, `body` the line under
 *   them, `eyebrow` the small line above (a merged moment's: "with a six"); `line` the commentary line it came from
 */

/**
 * The cards one read's arrivals earn, merged per ball, biggest first within a
 * ball and in the order the balls came.
 *
 * @param {any[]} arrivals  the commentary lines new in this read, in the generator's order
 * @param {{innings?: any[]} | null} before  the fold as the page last drew it (null: nothing yet)
 * @param {{innings?: any[]} | null} after  the fold this read gives
 * @param {{side?: (inn: any) => string}} [o]  `side`: a side's name, as the page writes it
 * @returns {Card[]}
 */
export function momentsFrom(arrivals, before, after, { side = (inn) => String(inn?.battingTeam ?? "") } = {}) {
  const all = Array.isArray(arrivals) ? arrivals : [];
  // A gap plays no steps: only what the state now is (the result) is still said, as the board cuts to it.
  const gap = all.filter((c) => DELIVERY.has(c?.kind)).length > GAP;
  const lines = gap ? all.filter((c) => c?.kind === "result") : all;
  const was = before?.innings ?? [];
  const now = after?.innings ?? [];
  /** @type {Card[]} */
  const cards = [];
  const card = (/** @type {any} */ line, /** @type {string} */ kind, /** @type {string} */ size, /** @type {number | null} */ ms,
    /** @type {string} */ title, /** @type {string | null} */ body = null) => cards.push({ key: line.key, kind, size, ms, title, body, eyebrow: null, line });
  const nameIn = (/** @type {any} */ inn, /** @type {any} */ id, /** @type {"batsmen" | "bowlers"} */ list) =>
    (inn?.[list] ?? []).find((/** @type {any} */ p) => p.id === id)?.name ?? null;

  for (const c of lines) {
    const inn = now[c.innings];
    switch (c.kind) {
      case "four": card(c, "four", SIZE.BEAT, SHOW_MS.beat, "Four"); break;
      case "six": card(c, "six", SIZE.BEAT, SHOW_MS.beat, "Six"); break;
      case "wicket": {
        // The batter out on this ball, as the card shows him: "c Pillay b Naidoo · D Erasmus 23 (18)".
        const id = ballOf(c);
        const b = id != null ? (inn?.ballLog ?? []).find((/** @type {any} */ x) => String(x.id) === id) : null;
        const outId = b ? (b.dismissed ?? b.strikerId) : null;
        const bat = outId != null ? (inn?.batsmen ?? []).find((/** @type {any} */ x) => x.id === outId) : null;
        card(c, "wicket", SIZE.BIG, SHOW_MS.short, "Wicket",
          bat ? `${bat.dismissal ? `${bat.dismissal} · ` : ""}${bat.name} ${bat.runs} (${bat.balls})` : null);
        break;
      }
      case "milestone": {
        const m = c.moment;
        if (!m) break;   // a line the generator gave no fact is no card: never guessed from its words
        if (m.kind === "batter_mark") {
          const kind = m.mark >= 100 ? "hundred" : "fifty";
          const title = m.mark === 50 ? "Fifty" : m.mark === 100 ? "Hundred" : String(m.mark);
          const who = nameIn(inn, m.player, "batsmen");
          card(c, kind, SIZE.BIG, SHOW_MS.short, title, who ? `${who} · ${m.mark} off ${m.balls}` : null);
        } else if (m.kind === "partnership") {
          const a = nameIn(inn, m.bat1, "batsmen"), b = nameIn(inn, m.bat2, "batsmen");
          card(c, m.mark >= 100 ? "partnership_100" : "partnership_50", SIZE.BIG, SHOW_MS.short, `Partnership ${m.mark}`,
            a && b ? `${a} and ${b} · ${m.balls} balls` : null);
        } else if (m.kind === "bowler_wickets") {
          const who = nameIn(inn, m.player, "bowlers");
          card(c, "five_wickets", SIZE.BIG, SHOW_MS.short, `${cap(WORD[m.wickets] ?? String(m.wickets))} wickets`,
            who ? `${who} ${m.wickets}/${m.runs}` : null);
        } else if (m.kind === "hat_trick") {
          card(c, "hat_trick", SIZE.BIG, SHOW_MS.long, "Hat-trick", nameIn(inn, m.player, "bowlers"));
        }
        // "On a hat-trick" (hat_trick_ball) is the board's tag, not a card (§5.2 row 7).
        break;
      }
      case "innings_end":
        if (inn) card(c, "innings_closed", SIZE.BIG, SHOW_MS.long, "Innings closed", `${side(inn)} ${inn.runs}/${inn.wickets} (${oversText(inn.balls ?? 0)} overs)`);
        break;
      case "innings_start": {
        if (!inn) break;
        const so = inn.superOver != null;
        const firstOfPair = so && !(now[c.innings - 1]?.superOver === inn.superOver);
        if (firstOfPair) card(c, "super_over", SIZE.BIG, SHOW_MS.long, "Super over", `${side(inn)} to bat`);
        else if (inn.target != null) card(c, "target", SIZE.BIG, SHOW_MS.long, `Target ${inn.target}`, `from ${inn.overs} overs`);
        break;
      }
      case "revision": {
        const r = inn?.revised;
        if (!r) break;
        const title = r.overs != null ? `Overs revised to ${r.overs}` : r.target != null ? `Target revised to ${r.target}` : null;
        if (title) card(c, "revision", SIZE.BIG, SHOW_MS.long, title,
          r.overs != null && (r.target ?? inn.target) != null ? `Target ${r.target ?? inn.target} from ${r.overs} overs` : null);
        break;
      }
      case "penalty": {
        const m = c.moment;
        if (!m || !inn) break;
        // The side, never the boy (083 Q4): to the batting side, or to the fielding one.
        const to = m.toBatting ? side(inn) : side({ ...inn, battingTeam: inn.bowlingTeam, teamKey: inn.bowlingTeamKey });
        card(c, "penalty", SIZE.BIG, SHOW_MS.short, `${m.runs} penalty ${m.runs === 1 ? "run" : "runs"}`, to ? `to ${to}` : null);
        break;
      }
      case "result": card(c, "result", SIZE.HELD, null, c.text ?? "Result"); break;
      default: break;
    }
  }

  // Fold states (§5.2 rows 14 and 18), held until the state changes.
  const last = now.length ? now[now.length - 1] : null;
  const lastWas = was[now.length - 1] ?? null;
  if (!gap && last?.stopped && !lastWas?.stopped && lines.length) {
    const why = { rain: "rain", bad_light: "bad light", wet_ground: "a wet ground" }[String(last.stopped.reason)] ?? null;
    cards.push({ key: `stopped:${now.length - 1}:${last.interruptions?.length ?? 0}`, kind: "stopped", size: SIZE.HELD, ms: null,
      title: "Play stopped", body: `${why ? `${why} · ` : ""}${oversText(last.balls ?? 0)} ov, ${last.runs}/${last.wickets}`, eyebrow: null, line: null });
  }
  return mergeByBall(cards);
}

/** A ball's moments are one card: the biggest, with the next as its eyebrow (§5.3). @param {Card[]} cards */
function mergeByBall(cards) {
  /** @type {Card[]} */
  const out = [];
  /** @type {Map<string, Card[]>} */
  const by = new Map();
  for (const c of cards) {
    const b = c.line ? ballOf(c.line) : null;
    if (b == null) { out.push(c); continue; }
    const list = by.get(b);
    if (list) list.push(c); else { by.set(b, [c]); out.push(c); }
  }
  return out.map((c) => {
    const b = c.line ? ballOf(c.line) : null;
    const same = b != null ? by.get(b) ?? [c] : [c];
    if (same.length < 2) return c;
    const [top, ...rest] = [...same].sort((x, y) => rank(x.kind) - rank(y.kind));
    const four = rest.find((x) => x.kind === "four" || x.kind === "six");
    const wicket = rest.find((x) => x.kind === "wicket");
    return {
      ...top,
      // A wicket that is also a hat-trick or a five-for keeps the dismissal as the card's line.
      body: wicket?.body && (top.kind === "hat_trick" || top.kind === "five_wickets") ? wicket.body : top.body,
      eyebrow: four ? `with a ${four.kind}` : wicket && top.kind !== "hat_trick" && top.kind !== "five_wickets" ? "with a wicket" : null,
    };
  });
}

/**
 * The board's two tags (§5.2 rows 7 and 9; EXPERIENCE_PASS C5), words beside
 * the chips, no motion: "Free hit" while the fold says the next ball is one,
 * and "Hat-trick ball" from the generator's "on a hat-trick" line until that
 * bowler's next counted ball (a wide or a no-ball neither makes nor breaks a
 * hat-trick, as facts.mjs reads it). Names nobody.
 * @param {any} inn  the innings the board shows  @param {any[]} lines  the commentary  @param {number} n  that innings' number
 * @returns {string[]}
 */
export function boardTags(inn, lines, n) {
  if (!inn || inn.complete) return [];
  const out = [];
  if (inn.freeHit === true) out.push("Free hit");
  const on = [...(lines ?? [])].reverse().find((c) => c?.innings === n && c.kind === "milestone" && c.moment?.kind === "hat_trick_ball");
  if (on) {
    const log = Array.isArray(inn.ballLog) ? inn.ballLog : [];
    const at = log.findIndex((/** @type {any} */ b) => String(b.id) === ballOf(on));
    const later = at < 0 ? [] : log.slice(at + 1);
    if (at >= 0 && !later.some((/** @type {any} */ b) => (b.bowlerId ?? b.bowler) === on.moment.player && b.type !== "Wd" && b.type !== "Nb")) out.push("Hat-trick ball");
  }
  return out;
}

/**
 * What waits behind the card on show (§5.3): a beat behind a big card is
 * dropped; a big card behind a big card waits; a held card ends the queue
 * (nothing after it waits); at most QUEUE_MAX wait.
 * @param {Card[]} queue  what already waits  @param {Card[]} cards  the new ones
 * @param {Card | null} showing  the card on show
 * @returns {Card[]}
 */
export function enqueue(queue, cards, showing) {
  let q = [...queue];
  for (const c of cards) {
    const ahead = [showing, ...q].filter(Boolean);
    if (ahead.some((x) => x?.size === SIZE.HELD) && c.size !== SIZE.HELD) continue;
    if (c.size === SIZE.BEAT && ahead.some((x) => x?.size !== SIZE.BEAT)) continue;
    if (c.size === SIZE.HELD) q = q.filter((x) => x.size === SIZE.HELD);
    q.push(c);
  }
  return q.slice(-QUEUE_MAX);
}
