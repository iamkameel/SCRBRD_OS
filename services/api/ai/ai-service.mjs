/**
 * SCRBRD — AI service (server side).
 *
 * Two features use Claude: StatGuru natural-language search, and live
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

/**
 * One place for model choice.
 *
 * Both features run on Claude Opus 5. Commentary is a short, highly
 * constrained generation, so it runs at low effort — that trades thinking
 * depth within the same model rather than dropping to a weaker one, and keeps
 * latency down for a call that happens once per delivery. StatGuru answers
 * open questions over squad and fixture context, so it runs at the default.
 *
 * ⚠️ Cost note for the pilot: a T20 innings is ~120 deliveries, so commentary
 * is ~250 calls per match. Measure it against a real match before turning it
 * on for a full season, and revisit the model choice deliberately rather than
 * by drift.
 */
export const AI_MODELS = {
  statguru:   { model: "claude-opus-5", maxTokens: 400 },
  commentary: { model: "claude-opus-5", maxTokens: 120, effort: "low" },
};

let _client = null;
/** Lazily construct, so importing this module never requires a key. */
function client() {
  if (!_client) _client = new Anthropic(); // resolves ANTHROPIC_API_KEY / auth profile
  return _client;
}

const textOf = (msg) => msg?.content?.find((b) => b.type === "text")?.text?.trim() ?? null;

/**
 * StatGuru — a natural-language question over the school's own data.
 *
 * `context` is assembled by the caller from data the principal is already
 * allowed to see. This function must never be handed rows straight from a
 * table: the read path applies row scoping and column masking first, so a
 * question asked by an analyst cannot surface a minor's PII through the model.
 */
export async function askStatGuru({ question, context, today = new Date() }) {
  if (!question?.trim()) return null;
  try {
    const msg = await client().messages.create({
      model: AI_MODELS.statguru.model,
      max_tokens: AI_MODELS.statguru.maxTokens,
      system: [
        "You are SCRBRD StatGuru, a cricket intelligence assistant for South African school cricket.",
        "Be concise and factual, and use cricket terminology.",
        "Answer only from the supplied data. If the data does not contain the answer, say so plainly rather than estimating.",
        `Today is ${today.toDateString()}.`,
        "",
        "Data available to this user:",
        context ?? "(none)",
      ].join("\n"),
      messages: [{ role: "user", content: question }],
    });
    return textOf(msg);
  } catch {
    // Surfaced to the user as "StatGuru offline — check your connection."
    return null;
  }
}

/**
 * One line of broadcast commentary for a delivery.
 *
 * `situation` is a pre-rendered description built by the caller from derived
 * state, so this module never needs to understand the scoring model.
 */
export async function describeDelivery({ situation }) {
  if (!situation?.trim()) return null;
  try {
    const msg = await client().messages.create({
      model: AI_MODELS.commentary.model,
      max_tokens: AI_MODELS.commentary.maxTokens,
      output_config: { effort: AI_MODELS.commentary.effort },
      system: [
        "You are a live cricket television commentator.",
        "Write ONE broadcast-quality line for the delivery described. Be vivid, conversational and informative, and add tactical insight where it earns its place. 20-35 words.",
        "Write only the commentary sentence: no quotes, no labels, no asterisks. Starting mid-sentence is fine where it sounds natural.",
      ].join("\n"),
      messages: [{ role: "user", content: situation }],
    });
    return textOf(msg);
  } catch {
    return null; // the UI proceeds without a commentary line
  }
}

/** Is the service configured to reach Claude at all? Used by /api/health. */
export const aiConfigured = () =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
