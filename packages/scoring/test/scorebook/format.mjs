/**
 * THE SCOREBOOK FORMAT — one match's "paper", as a scorer writes it, and the
 * card the paper states, typed independently of any fold.
 *
 * The scoring proof (scorebook-proof.test.mjs) replays the balls through the
 * pad's own event builders and holds every figure of the fold to the card.
 * Kameel, 12 Nov 2026: "Yes, but use invented matches for now". A real
 * school's scorebook may be typed into the same format later.
 *
 * NO NAMES, EVER. A batter is his batting-order number (B1…B11); a bowler is
 * his bowler number (BW1…); a fielder who is not named as a bowler is his
 * fielding side's number (F1…F11). Sides are keys (Home, Away).
 *
 * ── The paper ─────────────────────────────────────────────────────────────
 *
 *   # a comment, to the end of the line
 *   match INV-01                 the fixture's own code
 *   title A chase won by wickets
 *   date 2026-11-01              decides the Edition of the Laws (4th from 1 Oct 2026)
 *   overs 5                      overs per innings
 *   sides Home Away              home first; the keys every other line uses
 *   conditions cup               optional: cup (a tie goes to a super over), league,
 *                                or declaration (a declaration match: no free hit)
 *
 *   innings 1 Home               the side batting; the other fields
 *   innings 2 Away overs=4 target=31   the umpires' figures at the break, if any
 *   super 1 Away                 the first super over's innings for Away
 *   open B1 B2                   the openers, striker first
 *   over BW1  1 . 4 wd 2 . 1     an over: its bowler, then each delivery in order
 *   revise overs=4 target=33     the umpires' revision, between overs
 *   declare                      the innings declared (otherwise it ends as the Laws say)
 *
 * A delivery, in the scorer's marks:
 *   .  0          a dot
 *   1 2 3 5       runs off the bat; 4 and 6 are boundaries
 *   4r 6r         four (six) off the bat, all run: not a boundary
 *   2b 1lb        byes, leg byes
 *   wd  wd+2      a wide; a wide and the runs run (or the boundary) off it
 *   nb  nb+4      a no-ball; and runs off the bat (4 and 6 boundaries)
 *   nbh nbbm      the pad's other no-ball kinds: a waist-high full toss (height)
 *                 and a beamer. Neither earns a free hit (only the front-foot nb
 *                 does); every nb mark below may carry either (nbh+2, nbbm+1&W:…).
 *                 The pad offers no "back foot" kind: front foot, waist high, beamer.
 *   nb+4r         a no-ball, four off the bat all run
 *   nb+2b nb+1lb  a no-ball and byes / leg byes off it
 *   sr            a delivery the umpire called deliberate short running: no
 *                 run stands, five penalty runs to the fielding side
 *   W:how         a wicket. how is b, lbw, c/F3, cb (caught and bowled),
 *                 st/F1, hw (hit wicket), ro/F4 (run out), ob (obstructing).
 *                 After a comma: +N (runs completed off the bat before a run
 *                 out), +Nb / +Nlb (byes, leg byes completed), ns (the
 *                 non-striker is out), end=s / end=b (the end he was out at)
 *   wd&W:st/F1    a wicket off a wide; nb+1&W:ro/F2,ns,end=b off a no-ball
 *   1@illegal_fielding  a fair delivery that does not count in the over (Law 17.3.2.5),
 *                 and the five penalty runs to the batting side that go with it. The
 *                 reason is one of fielder_returning, illegal_fielding,
 *                 distracting_striker, obstructing_batter; the mark before the @ is
 *                 a run, bye or leg bye mark (the runs that stand), never a wicket.
 * Between deliveries, on the over's line:
 *   rh:B4         B4 retires hurt          back:B4  he resumes, at the empty end
 *   rto:B4        B4 retires out           timed:B5 B5, due in, is timed out
 *   pen+5:helmet_struck   five penalty runs to the batting side, for a reason
 *   pen-5:time_wasting    five to the fielding side
 *   bw:BW3/injury         BW3 finishes the over (injury | suspended)
 *   susp:beamers  the umpires suspend the bowler now bowling, for the reason named
 *                 (one of the engine's SUSPENSION_REASON); a bw:BWn/suspended
 *                 follows on the same line when the over is unfinished
 *   kp:F2         F2 takes the wicket-keeper's gloves (the fielding side's keeper
 *                 event). While a keeper is on record a stumping is his alone.
 * The next batter in the order walks in whenever an end is empty and a
 * delivery is next: the paper's batting order is the order they came in.
 *
 * ── The card the paper states ─────────────────────────────────────────────
 *
 *   card 1                       for the 1st innings (super overs number on)
 *   bat B1 23 18 3 0 c F3 b BW2  runs, balls, fours, sixes, how out
 *   bat B4 0 0 0 0 not out       "not out", "retired hurt", "c&b BW1", "run out (F2)" …
 *   extras b 1 lb 2 w 3 nb 1 p 0 byes, leg byes, wide runs, no-ball runs, penalty runs
 *   total 87/4 5.0               runs/wickets and the overs bowled
 *   fow 1-12 B2 2.3              wicket-score, the batter out, the over he fell in
 *   notinover 6                  optional: how many deliveries the innings had that were not
 *                                one of the over (the @ marks): each was faced, none is a legal ball
 *   milestone fifty B5 59        optional, one line each: every milestone of the innings the
 *   milestone hat_trick BW3 3    card states (fifty or hundred, a batter's runs; five_for, a
 *                                bowler's wickets; hat_trick, three). A card with any of these
 *                                says it has exactly these, no others.
 *   keeper F2 ct 1 st 1          optional, in the order they kept: the keeper's catches
 *                                and stumpings (a card with none says the fold has none)
 *   bowl BW1 2-0-17-1 wd 1 nb 0  O-M-R-W, the number of wides and no-balls bowled
 *   result Away won by 6 wickets the result as the paper writes it
 *
 * The paper's conventions (where a source could differ): a bowler's wides and
 * no-balls are the DELIVERIES, not the runs; "w" in the extras is every run
 * a wide gave, "nb" only the one-run penalty of each no-ball (runs off the bat
 * are the batter's, byes and leg byes off one are byes and leg byes); a
 * wicket on the last ball of an over falls at x.6; penalty runs are in "p",
 * in the total of the side they were awarded to.
 */

/**
 * @typedef {object} Step  one mark on the paper, in the order it was written
 * @property {"ball" | "rh" | "back" | "rto" | "timed" | "pen" | "bw" | "susp" | "kp"} kind
 * @property {string} text   the mark as written, for a mismatch's message
 * @property {Delivery} [d]
 * @property {string} [who]  the batter (rh, back, rto, timed), the bowler (bw) or the keeper (kp)
 * @property {number} [runs] penalty runs, signed: + to the batting side
 * @property {string} [reason]
 */

/**
 * @typedef {object} Delivery
 * @property {"run" | "B" | "LB" | "Wd" | "Nb" | "W"} type
 * @property {number} value          runs as the event carries them
 * @property {boolean} [notBoundary] four or six all run: not a boundary
 * @property {"byes" | "leg_byes"} [nbRuns]
 * @property {boolean} [shortRun]
 * @property {"height" | "beamer"} [nbType]  a no-ball's kind when not the front foot
 * @property {string} [notInOver]            the reason the delivery is not one of the over
 * @property {Wicket} [wicket]
 */

/**
 * @typedef {object} Wicket
 * @property {string} how        the canonical dismissal
 * @property {string | null} fielder  F3, BW2 — or "bowler" for caught and bowled
 * @property {boolean} nonStriker
 * @property {"striker_end" | "bowler_end" | null} end
 */

/**
 * @typedef {object} Line  one line of an innings: an over, a revision or a declaration
 * @property {"over" | "revise" | "declare"} kind
 * @property {string} [bowler]
 * @property {Step[]} [steps]
 * @property {number | null} [overs]
 * @property {number | null} [target]
 * @property {number} at   the line number in the file
 */

/**
 * @typedef {object} PaperInnings
 * @property {string} side
 * @property {number | null} superOver
 * @property {number | null} overs   the umpires' allotment at the break, if they gave one
 * @property {number | null} target  the umpires' target at the break, if they gave one
 * @property {[string, string] | null} openers
 * @property {Line[]} lines
 */

/**
 * @typedef {object} CardBatter
 * @property {string} who  @property {number} runs  @property {number} balls
 * @property {number} fours  @property {number} sixes  @property {string} howOut
 */
/**
 * @typedef {object} CardBowler
 * @property {string} who  @property {string} overs  @property {number} maidens
 * @property {number} runs  @property {number} wickets  @property {number} wides  @property {number} noBalls
 */
/**
 * @typedef {object} Card
 * @property {number} innings  1-based, as the paper numbers them
 * @property {CardBatter[]} batting
 * @property {{b: number, lb: number, w: number, nb: number, p: number}} extras
 * @property {number} total  @property {number} wickets  @property {string} overs
 * @property {{wicket: number, runs: number, who: string, over: string}[]} fow
 * @property {{who: string, catches: number, stumpings: number}[]} keepers
 * @property {number} notInOver  deliveries faced that were not one of the over
 * @property {{kind: string, who: string, value: number}[]} milestones  when any is given, the innings' milestones exactly
 * @property {CardBowler[]} bowling
 */

/**
 * @typedef {object} Scorebook
 * @property {string} file
 * @property {string} match  @property {string} title  @property {string} date
 * @property {number} overs  @property {[string, string]} sides
 * @property {string | null} conditions
 * @property {PaperInnings[]} innings
 * @property {Card[]} cards
 * @property {string | null} result
 */

const HOW = Object.freeze({
  b: "bowled", lbw: "lbw", c: "caught", cb: "caught", st: "stumped", hw: "hit_wicket",
  ro: "run_out", ob: "obstructing_field", ht: "hit_twice",
});
const FIELDED = new Set(["c", "st"]);
/** The offences whose delivery is not one of the over (events.mjs NOT_IN_OVER), spelt out so the fixture does not borrow the engine's list. */
const NOT_IN_OVER = new Set(["fielder_returning", "illegal_fielding", "distracting_striker", "obstructing_batter"]);
const PLAYER = /^(B|BW|F)([1-9]|1[01])$/;

/** @param {string} msg @param {string} file @param {number} at @returns {never} */
const fail = (msg, file, at) => { throw new Error(`${file}:${at}: ${msg}`); };

/**
 * A wicket mark, after the "W:". @param {string} s @param {() => never} bad
 * @returns {{wicket: Wicket, value: number, nbRuns?: "byes" | "leg_byes"}}
 */
function parseWicket(s, bad) {
  const [head, ...opts] = s.split(",");
  const [how, fielder = null] = head.split("/");
  if (!Object.hasOwn(HOW, how)) bad();
  if (FIELDED.has(how) && !fielder) bad();
  if (fielder != null && !PLAYER.test(fielder)) bad();
  /** @type {Wicket} */
  const wicket = { how: HOW[/** @type {keyof typeof HOW} */ (how)], fielder: how === "cb" ? "bowler" : fielder, nonStriker: false, end: null };
  let value = 0;
  /** @type {"byes" | "leg_byes" | undefined} */
  let nbRuns;
  for (const o of opts) {
    const m = /^\+(\d)(b|lb)?$/.exec(o);
    if (m) { value = Number(m[1]); if (m[2]) nbRuns = m[2] === "b" ? "byes" : "leg_byes"; }
    else if (o === "ns") wicket.nonStriker = true;
    else if (o === "end=s") wicket.end = "striker_end";
    else if (o === "end=b") wicket.end = "bowler_end";
    else bad();
  }
  return { wicket, value, ...(nbRuns ? { nbRuns } : {}) };
}

/**
 * One delivery mark. @param {string} t @param {() => never} bad @returns {Delivery}
 */
export function parseDelivery(t, bad) {
  if (t.includes("@")) {
    // A delivery that does not count in the over: the mark, then @ and why.
    const [mark, reason] = t.split("@");
    const d = parseDelivery(mark, bad);
    if (!NOT_IN_OVER.has(reason) || d.wicket || d.type === "W" || d.type === "Wd" || d.type === "Nb" || d.shortRun) bad();
    return { ...d, notInOver: reason };
  }
  if (t === "." || t === "0") return { type: "run", value: 0 };
  if (/^[1-6]$/.test(t)) return { type: "run", value: Number(t) };
  if (/^[46]r$/.test(t)) return { type: "run", value: Number(t[0]), notBoundary: true };
  let m = /^([1-6])(b|lb)$/.exec(t);
  if (m) return { type: m[2] === "b" ? "B" : "LB", value: Number(m[1]) };
  if (t === "sr") return { type: "run", value: 0, shortRun: true };
  if (t.startsWith("W:")) {
    const w = parseWicket(t.slice(2), bad);
    return { type: "W", value: w.value, wicket: w.wicket, ...(w.nbRuns ? { nbRuns: w.nbRuns } : {}) };
  }
  const [extra, wk] = t.split("&");
  m = /^(wd|nbh|nbbm|nb)(?:\+([0-6])(r|b|lb)?)?$/.exec(extra);
  if (!m) bad();
  const type = m[1] === "wd" ? "Wd" : "Nb";
  const value = Number(m[2] ?? 0);
  /** @type {Delivery} */
  const d = { type, value };
  if (m[1] === "nbh") d.nbType = "height";
  if (m[1] === "nbbm") d.nbType = "beamer";
  if (m[3] === "r") { if (type !== "Nb") bad(); d.notBoundary = true; }
  if (m[3] === "b" || m[3] === "lb") { if (type !== "Nb") bad(); d.nbRuns = m[3] === "b" ? "byes" : "leg_byes"; }
  if (wk != null) {
    if (!wk.startsWith("W:")) bad();
    d.wicket = parseWicket(wk.slice(2), bad).wicket;
  }
  return d;
}

/** @param {string} t @param {() => never} bad @returns {Step} */
function parseStep(t, bad) {
  let m = /^(rh|back|rto|timed):(B\d+)$/.exec(t);
  if (m) return { kind: /** @type {"rh" | "back" | "rto" | "timed"} */ (m[1]), who: m[2], text: t };
  m = /^pen([+-])(\d+):([a-z_]+)$/.exec(t);
  if (m) return { kind: "pen", runs: (m[1] === "+" ? 1 : -1) * Number(m[2]), reason: m[3], text: t };
  m = /^bw:(BW\d+)\/(injury|suspended)$/.exec(t);
  if (m) return { kind: "bw", who: m[1], reason: m[2], text: t };
  m = /^susp:([a-z_]+)$/.exec(t);
  if (m) return { kind: "susp", reason: m[1], text: t };
  m = /^kp:(F\d+)$/.exec(t);
  if (m) return { kind: "kp", who: m[1], text: t };
  return { kind: "ball", d: parseDelivery(t, bad), text: t };
}

/** `key=value` options on a line. @param {string[]} toks */
const options = (toks) => Object.fromEntries(toks.map((x) => x.split("=")).map(([k, v]) => [k, Number(v)]));

/**
 * Read a scorebook. @param {string} text @param {string} [file]
 * @returns {Scorebook}
 */
export function parseScorebook(text, file = "scorebook") {
  /** @type {Scorebook} */
  const book = { file, match: "", title: "", date: "", overs: 20, sides: ["Home", "Away"], conditions: null, innings: [], cards: [], result: null };
  /** @type {PaperInnings | null} */
  let inn = null;
  /** @type {Card | null} */
  let card = null;
  text.split("\n").forEach((raw, k) => {
    const at = k + 1;
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    const [word, ...rest] = line.split(/\s+/);
    const bad = () => fail(`cannot read ${JSON.stringify(line)}`, file, at);
    switch (word) {
      case "match": book.match = rest[0]; return;
      case "title": book.title = rest.join(" "); return;
      case "date": book.date = rest[0]; return;
      case "overs": book.overs = Number(rest[0]); return;
      case "sides": if (rest.length !== 2) bad(); book.sides = [rest[0], rest[1]]; return;
      case "conditions": book.conditions = rest[0]; return;
      case "innings": case "super": {
        const side = word === "innings" ? rest[1] : rest[1];
        if (!book.sides.includes(side)) bad();
        const o = options(rest.slice(2));
        inn = { side, superOver: word === "super" ? Number(rest[0]) : null, overs: o.overs ?? null, target: o.target ?? null, openers: null, lines: [] };
        book.innings.push(inn);
        card = null;
        return;
      }
      case "open": if (!inn || rest.length !== 2 || !rest.every((p) => /^B\d+$/.test(p))) bad();
        /** @type {PaperInnings} */ (inn).openers = [rest[0], rest[1]]; return;
      case "over": {
        if (!inn || !/^BW\d+$/.test(rest[0])) bad();
        /** @type {PaperInnings} */ (inn).lines.push({ kind: "over", bowler: rest[0], steps: rest.slice(1).map((t) => parseStep(t, bad)), at });
        return;
      }
      case "revise": {
        if (!inn) bad();
        const o = options(rest);
        /** @type {PaperInnings} */ (inn).lines.push({ kind: "revise", overs: o.overs ?? null, target: o.target ?? null, at });
        return;
      }
      case "declare": if (!inn) bad(); /** @type {PaperInnings} */ (inn).lines.push({ kind: "declare", at }); return;
      case "card": {
        inn = null;
        card = { innings: Number(rest[0]), batting: [], extras: { b: 0, lb: 0, w: 0, nb: 0, p: 0 }, total: -1, wickets: -1, overs: "", fow: [], keepers: [], notInOver: 0, milestones: [], bowling: [] };
        book.cards.push(card);
        return;
      }
      case "bat": {
        if (!card || rest.length < 6) bad();
        const [who, r, b, f, s, ...how] = rest;
        /** @type {Card} */ (card).batting.push({ who, runs: Number(r), balls: Number(b), fours: Number(f), sixes: Number(s), howOut: how.join(" ") });
        return;
      }
      case "extras": {
        if (!card || rest.length !== 10) bad();
        const c = /** @type {Card} */ (card);
        for (let i = 0; i < rest.length; i += 2) {
          const key = rest[i];
          if (!Object.hasOwn(c.extras, key)) bad();
          c.extras[/** @type {keyof Card["extras"]} */ (key)] = Number(rest[i + 1]);
        }
        return;
      }
      case "total": {
        const m = /^(\d+)\/(\d+)$/.exec(rest[0] ?? "");
        if (!card || !m || !rest[1]) bad();
        const c = /** @type {Card} */ (card);
        c.total = Number(/** @type {RegExpExecArray} */ (m)[1]); c.wickets = Number(/** @type {RegExpExecArray} */ (m)[2]); c.overs = rest[1];
        return;
      }
      case "fow": {
        const m = /^(\d+)-(\d+)$/.exec(rest[0] ?? "");
        if (!card || !m || rest.length !== 3) bad();
        /** @type {Card} */ (card).fow.push({ wicket: Number(/** @type {RegExpExecArray} */ (m)[1]), runs: Number(/** @type {RegExpExecArray} */ (m)[2]), who: rest[1], over: rest[2] });
        return;
      }
      case "milestone": {
        const bowlerKind = rest[0] === "five_for" || rest[0] === "hat_trick";
        if (!card || rest.length !== 3 || !(bowlerKind || rest[0] === "fifty" || rest[0] === "hundred") || !(bowlerKind ? /^BW\d+$/ : /^B\d+$/).test(rest[1])) bad();
        /** @type {Card} */ (card).milestones.push({ kind: rest[0], who: rest[1], value: Number(rest[2]) });
        return;
      }
      case "notinover": if (!card || rest.length !== 1) bad(); /** @type {Card} */ (card).notInOver = Number(rest[0]); return;
      case "keeper": {
        if (!card || rest.length !== 5 || !/^F\d+$/.test(rest[0]) || rest[1] !== "ct" || rest[3] !== "st") bad();
        /** @type {Card} */ (card).keepers.push({ who: rest[0], catches: Number(rest[2]), stumpings: Number(rest[4]) });
        return;
      }
      case "bowl": {
        const m = /^(\d+(?:\.\d)?)-(\d+)-(\d+)-(\d+)$/.exec(rest[1] ?? "");
        if (!card || !m || rest[2] !== "wd" || rest[4] !== "nb") bad();
        const g = /** @type {RegExpExecArray} */ (m);
        /** @type {Card} */ (card).bowling.push({ who: rest[0], overs: g[1], maidens: Number(g[2]), runs: Number(g[3]), wickets: Number(g[4]),
          wides: Number(rest[3]), noBalls: Number(rest[5]) });
        return;
      }
      case "result": book.result = rest.join(" "); return;
      default: bad();
    }
  });
  if (!book.match || !book.date) fail("a scorebook needs its match and date", file, 0);
  return book;
}

/** "4.3" → 27 legal balls. @param {string} o */
export const ballsOf = (o) => { const [ov, b = "0"] = String(o).split("."); return Number(ov) * 6 + Number(b); };

/**
 * Does the card add up on its own — every way a scorer adds a book — before
 * any fold is asked? A card that does not is a typing mistake in the
 * fixture, not an engine bug: these checks read nothing but the card.
 * @param {Card} c @returns {string[]}  each sum that does not agree
 */
export function cardArithmetic(c) {
  const out = [];
  const sum = (/** @type {number[]} */ xs) => xs.reduce((a, b) => a + b, 0);
  const extras = c.extras.b + c.extras.lb + c.extras.w + c.extras.nb + c.extras.p;
  const bat = sum(c.batting.map((b) => b.runs));
  if (bat + extras !== c.total) out.push(`batters ${bat} + extras ${extras} = ${bat + extras}, not the total ${c.total}`);
  const bowled = sum(c.bowling.map((b) => b.runs));
  const notBowlers = c.extras.b + c.extras.lb + c.extras.p;
  if (bowled + notBowlers !== c.total) out.push(`bowlers ${bowled} + byes, leg byes and penalties ${notBowlers} = ${bowled + notBowlers}, not the total ${c.total}`);
  const balls = sum(c.bowling.map((b) => ballsOf(b.overs)));
  if (balls !== ballsOf(c.overs)) out.push(`bowlers' balls ${balls}, not the innings' ${ballsOf(c.overs)}`);
  const nbs = sum(c.bowling.map((b) => b.noBalls));
  if (nbs !== c.extras.nb) out.push(`bowlers' no-balls ${nbs}, not the extras' ${c.extras.nb}`);
  const wides = sum(c.bowling.map((b) => b.wides));
  if (wides > c.extras.w || (wides === 0) !== (c.extras.w === 0)) out.push(`bowlers' wides ${wides} cannot give ${c.extras.w} wide runs`);
  const faced = sum(c.batting.map((b) => b.balls));
  if (faced !== ballsOf(c.overs) + nbs + c.notInOver) out.push(`balls faced ${faced}, not the legal balls ${ballsOf(c.overs)}, no-balls ${nbs} and deliveries not in the over ${c.notInOver}`);
  const out_ = c.batting.filter((b) => b.howOut !== "not out" && b.howOut !== "retired hurt").length;
  if (out_ !== c.wickets) out.push(`${out_} batters out, not ${c.wickets} wickets`);
  if (c.fow.length !== c.wickets) out.push(`${c.fow.length} falls of wicket, not ${c.wickets}`);
  const notBowler = /^(run out|retired out|timed out|obstructing|hit the ball twice)/;
  const toBowlers = c.batting.filter((b) => b.howOut !== "not out" && b.howOut !== "retired hurt" && !notBowler.test(b.howOut)).length;
  const taken = sum(c.bowling.map((b) => b.wickets));
  if (taken !== toBowlers) out.push(`bowlers took ${taken}, the batters' column says ${toBowlers}`);
  const stumped = c.batting.filter((b) => /^st /.test(b.howOut)).length;
  const caught = c.batting.filter((b) => /^c /.test(b.howOut)).length;
  if (sum(c.keepers.map((k) => k.stumpings)) > stumped) out.push(`keepers' stumpings ${sum(c.keepers.map((k) => k.stumpings))}, more than the ${stumped} stumped`);
  if (sum(c.keepers.map((k) => k.catches)) > caught) out.push(`keepers' catches ${sum(c.keepers.map((k) => k.catches))}, more than the ${caught} caught`);
  c.fow.forEach((f, i) => {
    if (f.wicket !== i + 1) out.push(`fall of wicket ${i + 1} numbered ${f.wicket}`);
    if (i > 0 && f.runs < c.fow[i - 1].runs) out.push(`fall of wicket ${i + 1} at ${f.runs}, below the one before`);
    if (f.runs > c.total) out.push(`fall of wicket ${i + 1} at ${f.runs}, above the total`);
  });
  for (const b of c.batting) {
    if (b.fours * 4 + b.sixes * 6 > b.runs) out.push(`${b.who}'s boundaries are more than his ${b.runs}`);
  }
  return out;
}
