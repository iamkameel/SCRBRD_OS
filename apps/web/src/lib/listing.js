/**
 * A school's listing on the SCRBRD home page, and a ground added on Fields: the
 * words and the two small rules the screens add, as pure functions
 * (views/listing.jsx, views/addground.jsx).
 *
 * Nothing here decides who may. GET/POST /api/schools/:id/listing
 * (services/api/write/listing-api.mjs) says who may read and who may change,
 * and POST /api/grounds (planner-api.mjs groundCreate) checks facility.manage
 * under the table's own policy. This is the sentences, and the checks a form
 * makes before it asks (a name of 2 to 80 characters is the route's rule, said
 * here so a short name is not sent just to be refused).
 *
 * The listing words follow docs/design/SCRBRD-142_public_home_page.md §1–§2:
 * the home page's card is team-level (school names, team codes, scores, status),
 * names no child and never the ground; a fixture is on it only when a school
 * that lists has also published its side (§1.2).
 */

/** What the school's switch says listing does. Two sentences, nothing the design does not promise. */
export const LISTING_WORDS = [
  "When your school lists, its published matches appear on the SCRBRD home page with team names and scores only: no player is named and the ground is never shown.",
  "Switching off takes them off the page within seconds.",
];

/** Why a reader who may read the setting may not change it. */
export const LISTING_READ_ONLY = "You can see this setting but not change it: only someone who may publish for the whole school can.";

const LISTING_REFUSAL = {
  not_signed_in: "Your session has ended. Sign in again; nothing was changed.",
  not_permitted: "You may not change this school's listing: only someone who may publish for the whole school can.",
  no_such_school: "That school could not be found.",
  no_answer: "Nothing was changed. Try again.",
};

/** @param {any} e a thrown ApiError */
export const listingRefusal = (e) => LISTING_REFUSAL[e?.code]
  ?? (e?.status ? `Not changed. The server said ${e.code || `HTTP ${e.status}`}.` : "Could not reach the server. Nothing was changed.");

/**
 * The line under a fixture's Publish switch (§7 phase 2). One per school the
 * reader may publish for; null when the reader cannot read that school's
 * listing (the route answered 404), so a reader who may not see the setting is
 * told nothing about it.
 *
 * Listing alone shows nothing: the fixture is on the home page only once its
 * side is published too (§1.2), and only while the deployment's public pages
 * are on, so the sentence says which of those is still to do rather than
 * promising a card that is not coming.
 * @param {{ listed: boolean | null, published: boolean, pagesOn: boolean | null }} s
 *   `listed` null: not readable
 * @returns {string | null}
 */
export function listingLine({ listed, published, pagesOn }) {
  if (listed == null) return null;
  if (!listed) return "Your school does not list its matches on the SCRBRD home page: this fixture will not appear there. You can change that in Settings → School.";
  const head = "Your school lists its matches on the SCRBRD home page";
  if (pagesOn === false) return `${head}. Public pages are switched off on this deployment, so nothing appears there yet.`;
  return published ? `${head}: this fixture will appear there.` : `${head}: this fixture will appear there once you publish it.`;
}

// ── Add ground ──

export const GROUND_NAME_MIN = 2;
export const GROUND_NAME_MAX = 80;
export const GROUND_SURFACE_MAX = 40;

const GROUND_REFUSAL = {
  not_signed_in: "Your session has ended. Sign in again; nothing was added.",
  not_permitted: "You may not add a ground at this school.",
  school_required: "Choose the school this ground belongs to.",
  name_invalid: `Give the ground a name of ${GROUND_NAME_MIN} to ${GROUND_NAME_MAX} characters.`,
  surface_invalid: `The surface can be up to ${GROUND_SURFACE_MAX} characters.`,
  parent_invalid: "That field cannot hold a pitch. Choose another, or none.",
  ground_exists: "A ground with that name already exists at this school.",
};

/** @param {any} e a thrown ApiError */
export const groundRefusal = (e) => GROUND_REFUSAL[e?.code]
  ?? (e?.status ? `Nothing was added. The server said ${e.code || `HTTP ${e.status}`}.` : "Could not reach the server. Nothing was added.");

/** The name as the route reads it: trimmed, runs of spaces collapsed. */
export const cleanGroundName = (/** @type {unknown} */ s) => String(s ?? "").trim().replace(/\s+/g, " ");

/**
 * Is the form ready to send? The route's own limits, said before the trip.
 * @param {{ schoolId: string, name: string, surface: string }} f
 */
export function groundFormReady({ schoolId, name, surface }) {
  const n = cleanGroundName(name).length;
  return Boolean(schoolId) && n >= GROUND_NAME_MIN && n <= GROUND_NAME_MAX && surface.trim().length <= GROUND_SURFACE_MAX;
}

/**
 * The fields a pitch may be put on at one school: its grounds that are not
 * themselves on another (the database refuses a pitch on a pitch, "too deep"),
 * by name.
 * @param {Array<{ id: string, name: string, school: string, parentId: string | null }>} grounds
 * @param {string} schoolId
 */
export const fieldsOf = (grounds, schoolId) => grounds
  .filter((g) => g.school === schoolId && !g.parentId)
  .sort((a, b) => a.name.localeCompare(b.name));

/** The body POST /api/grounds takes: surface and parentId only when given. */
export function groundBody({ schoolId, name, surface, parentId }) {
  /** @type {{ schoolId: string, name: string, surface?: string, parentId?: string }} */
  const body = { schoolId, name: cleanGroundName(name) };
  if (surface.trim()) body.surface = surface.trim();
  if (parentId) body.parentId = parentId;
  return body;
}
