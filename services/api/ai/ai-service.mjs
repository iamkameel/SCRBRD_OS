/**
 * SCRBRD — AI service (server side).
 *
 * Two features use Claude: Stats-Magic natural-language search, and live
 * broadcast commentary on a delivery.
 *
 * Why this is server-side
 * ──────────────────────
 * The artifact called https://api.anthropic.com/v1/messages directly from the
 * browser with no Authorization header at all. That worked only inside the
 * artifact host, which injected credentials. In a real deployment it returns
 * 401 — and the obvious "fix" of putting the API key in the client would ship
 * it to every spectator, parent and student who opens the app. The key lives
 * here, in the service, and the browser calls our own endpoint.
 *
 * Why commentary must never block scoring
 * ───────────────────────────────────────
 * School grounds routinely have no usable data connection. Commentary is an
 * enhancement layer: every function here fails soft, returning null rather
 * than throwing, and no scoring path awaits one. A ball must be recordable
 * with the network entirely absent.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readResource } from "../read/read-api.mjs";

/**
 * One place for model choice.
 *
 * Both features run on Claude Opus 5. Commentary is a short, highly
 * constrained generation, so it runs at low effort — that trades thinking
 * depth within the same model rather than dropping to a weaker one, and keeps
 * latency down for a call that happens once per delivery. Stats-Magic answers
 * open questions over squad and fixture context, so it runs at the default.
 *
 * ⚠️ Cost note for the pilot: a T20 innings is ~120 deliveries, so commentary
 * is ~250 calls per match. Measure it against a real match before turning it
 * on for a full season, and revisit the model choice deliberately rather than
 * by drift.
 */
export const AI_MODELS = {
  statsMagic: { model: "claude-opus-5", maxTokens: 400 },
  commentary: { model: "claude-opus-5", maxTokens: 120, effort: "low" },
};

let _client = null;
/** Lazily construct, so importing this module never requires a key. */
function client() {
  if (!_client) _client = new Anthropic(); // resolves ANTHROPIC_API_KEY / auth profile
  return _client;
}

/** The one call that leaves the building. Injectable, so a test can read what would have gone. */
const sendDefault = (params) => client().messages.create(params);

const textOf = (msg) => msg?.content?.find((b) => b.type === "text")?.text?.trim() ?? null;

/*
 * NO CHILD'S NAME LEAVES THE PLATFORM.
 *
 * Both features describe pupils to a third party: commentary names the batter
 * and the bowler, Stats-Magic is handed a roster. A school's data is scoped and
 * masked all the way to the browser and was then sent, in clear, to a model
 * provider abroad. POPIA calls a child's name personal information and the
 * processing of it by an operator a thing the school must be able to account
 * for; "the commentary was more vivid with names" is not an account.
 *
 * So every name is swapped for a stable token before the call and swapped
 * back in the answer. The model is told the tokens are names and to use them
 * verbatim, which it does; a token it drops or bends simply stays as it is,
 * and the line reads oddly rather than leaking. Longest name first, so
 * "S Naidoo" is not left as "S PLAYER_2".
 */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function maskNames(text, names = []) {
  const list = [...new Set(names.filter((n) => typeof n === "string" && n.trim()))]
    .sort((a, b) => b.length - a.length);
  let out = text ?? "";
  // Lookarounds rather than \b: a name that ends in a bracket or an initial's
  // full stop has no word boundary after it, and \b would leave it in clear.
  const whole = (re) => new RegExp(`(?<![\\w])${re}(?![\\w])`, "gi");
  list.forEach((name, i) => { out = out.replace(whole(escapeRe(name)), `PLAYER_${i + 1}`); });
  const unmask = (t) => list.reduce((acc, name, i) =>
    acc.replace(whole(`PLAYER[_ ]?${i + 1}`), name), t ?? "");
  return { text: out, unmask, tokens: list.map((_, i) => `PLAYER_${i + 1}`) };
}

const TOKEN_RULE = "People are referred to by tokens like PLAYER_1 and PLAYER_2. Those are names: use them verbatim, exactly as written, wherever you would use the person's name, and never invent a name for them.";

/*
 * Figures, not stored anywhere, computed HERE.
 *
 * /read/career returns the raw counts the two career views aggregate and no
 * ratios, for the reason its own comment gives: the division-by-zero cases are
 * the interesting ones and SQL would have to pick a lie for each. A batter who
 * has never been out has NO average, which is not an average of zero; a bowler
 * who has taken no wicket has no bowling average and no strike rate. So each
 * ratio is null when its denominator is, and a null is written as a phrase
 * saying why rather than as a number.
 */
const rate = (num, den, dp) => (den > 0 ? (num / den).toFixed(dp) : null);
const matchesWord = (n) => `${n} ${n === 1 ? "match" : "matches"}`;

/**
 * One player's figures as a line the model can quote from.
 *
 * `matches` is the "is there a record at all" test, not `runs`: the career
 * views carry `WHERE matches > 0`, and /read/career left-joins them and
 * coalesces the misses to 0. So 0 balls off 0 matches is a player who has
 * never faced one, and 0 runs off 12 balls in 1 match is a real duck. Printing
 * both as "0" would hand the model a fabricated figure and no way to tell.
 */
function careerLine(name, c) {
  const n = (k) => Number(c?.[k] ?? 0);
  const bat = n("bat_matches") === 0 ? "no record" : [
    matchesWord(n("bat_matches")),
    `${n("runs")} runs off ${n("balls_faced")} balls`,
    rate(100 * n("runs"), n("balls_faced"), 1) ? `SR ${rate(100 * n("runs"), n("balls_faced"), 1)}` : "no strike rate (no ball faced)",
    rate(n("runs"), n("dismissals"), 2) ? `average ${rate(n("runs"), n("dismissals"), 2)}` : "no average (never dismissed)",
    `${n("fours")}x4 ${n("sixes")}x6`,
  ].join(", ");
  const bowl = n("bowl_matches") === 0 ? "no record" : [
    matchesWord(n("bowl_matches")),
    `${n("wickets")} wickets`,
    `${n("runs_conceded")} runs off ${n("balls_bowled")} legal balls`,
    rate(6 * n("runs_conceded"), n("balls_bowled"), 2) ? `economy ${rate(6 * n("runs_conceded"), n("balls_bowled"), 2)}` : "no economy (no legal ball bowled)",
    rate(n("runs_conceded"), n("wickets"), 2) ? `average ${rate(n("runs_conceded"), n("wickets"), 2)}` : "no average (no wicket)",
  ].join(", ");
  return `${name} — batting: ${bat}; bowling: ${bowl}`;
}

/**
 * The data Stats-Magic may see: built HERE, from the read path, under the
 * caller's own identity.
 *
 * The browser used to assemble this and post it. That let the model be handed
 * whatever the page held — a masked column the browser legitimately had for
 * one purpose became context for another — and, since the endpoint took any
 * string, whatever anybody cared to post. Now the rows come from readResource
 * under RLS and the masking views, the same door every screen uses, and the
 * client sends a question and nothing else. No session, no context: the read
 * path refuses before any of this runs.
 *
 * `career` is keyed on the ROSTER, by player_id, and every stats line is
 * written with the roster's own `full_name` — never the career row's. That is
 * deliberate and it is the masking guarantee: `names` is collected from the
 * roster, askStatsMagic masks the whole context string with exactly that list,
 * and a stats line that introduced a name the roster did not carry would go to
 * the provider in clear. Keying the other way round would be one join away
 * from doing precisely that.
 */
export function contextFrom({ players = [], matches = [], career = [] }) {
  const names = players.map((p) => p.full_name).filter(Boolean);
  const roster = players.map((p) => [p.full_name, p.playing_role, p.team_code, p.school_name].filter(Boolean).join(", ")).join("; ");
  const fixtures = matches.slice(0, 8).map((m) =>
    `${m.team_code ?? "?"} v ${m.opponent ?? m.away_team_code ?? "?"} ${m.starts_at ? String(m.starts_at).slice(0, 10) : ""} ${m.status ?? ""}`.trim()).join("; ");
  const byId = new Map(career.filter((c) => c?.player_id).map((c) => [String(c.player_id), c]));
  const played = [], unplayed = [];
  for (const p of players) {
    if (!p.full_name) continue;
    const c = byId.get(String(p.id));
    // A career row of coalesced zeros and no career row at all say the same
    // thing — nothing has been recorded — and are named together.
    if (Number(c?.bat_matches ?? 0) || Number(c?.bowl_matches ?? 0)) played.push(careerLine(p.full_name, c));
    else unplayed.push(p.full_name);
  }
  // Named rather than silently absent. A roster of thirty and figures for six
  // invites the model to read the other twenty-four as unknown when what is
  // known about them is that nothing has been recorded.
  const none = unplayed.length ? ` Nothing recorded yet in the ball log for: ${unplayed.join("; ")}.` : "";
  const figures = played.length
    ? ` Career figures, from the deliveries this user may read: ${played.join(". ")}.${none}`
    : (unplayed.length ? ` No career figures: nothing recorded yet in the ball log for any of them.` : "");
  return { names, context: `Players: ${roster || "(none)"}. Recent fixtures: ${fixtures || "(none)"}.${figures}` };
}

export async function statsMagicContext(pool, secret, bearer, read = readResource) {
  const [players, matches, career] = await Promise.all([
    read(pool, secret, bearer, "players"),
    read(pool, secret, bearer, "matches"),
    read(pool, secret, bearer, "career"),
  ]);
  return contextFrom({
    players: players?.rows ?? players ?? [],
    matches: matches?.rows ?? matches ?? [],
    career: career?.rows ?? career ?? [],
  });
}

/**
 * Stats-Magic — a natural-language question over the school's own data.
 *
 * `context` and `names` come from statsMagicContext(), never from the client.
 */
export async function askStatsMagic({ question, context, names = [], today = new Date(), send = sendDefault }) {
  if (!question?.trim()) return null;
  const masked = maskNames(context ?? "(none)", names);
  const q = maskNames(question, names).text;   // a question that names a pupil is masked too
  try {
    const msg = await send({
      model: AI_MODELS.statsMagic.model,
      max_tokens: AI_MODELS.statsMagic.maxTokens,
      system: [
        "You are SCRBRD Stats-Magic, a cricket intelligence assistant for South African school cricket.",
        "Be concise and factual, and use cricket terminology.",
        "Answer only from the supplied data. If the data does not contain the answer, say so plainly rather than estimating.",
        TOKEN_RULE,
        `Today is ${today.toDateString()}.`,
        "",
        "Data available to this user:",
        masked.text,
      ].join("\n"),
      messages: [{ role: "user", content: q }],
    });
    const answer = textOf(msg);
    return answer == null ? null : masked.unmask(answer);
  } catch {
    // Surfaced to the user as "Stats-Magic offline — check your connection."
    return null;
  }
}

/**
 * One line of broadcast commentary for a delivery.
 *
 * `situation` is a pre-rendered description built by the caller from derived
 * state, so this module never needs to understand the scoring model.
 */
export async function describeDelivery({ situation, names = [], send = sendDefault }) {
  if (!situation?.trim()) return null;
  const masked = maskNames(situation, names);
  try {
    const msg = await send({
      model: AI_MODELS.commentary.model,
      max_tokens: AI_MODELS.commentary.maxTokens,
      output_config: { effort: AI_MODELS.commentary.effort },
      system: [
        "You are a live cricket television commentator.",
        "Write ONE broadcast-quality line for the delivery described. Be vivid, conversational and informative, and add tactical insight where it earns its place. 20-35 words.",
        "Write only the commentary sentence: no quotes, no labels, no asterisks. Starting mid-sentence is fine where it sounds natural.",
        TOKEN_RULE,
      ].join("\n"),
      messages: [{ role: "user", content: masked.text }],
    });
    const line = textOf(msg);
    return line == null ? null : masked.unmask(line);
  } catch {
    return null; // the UI proceeds without a commentary line
  }
}

/** Is the service configured to reach Claude at all? Used by /api/health. */
export const aiConfigured = () =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
