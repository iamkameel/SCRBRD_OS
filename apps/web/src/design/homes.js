/* ── Homes (GA-I30; EXPERIENCE_PASS §1.2–§1.5, Q1, Q21) ─────────────────
   One place per domain. A HOME is a menu entry that gathers destinations which
   already exist, so a person lands in one place for the day, the matches, the
   team, grounds, transport or competitions instead of hunting through the menu.

   A home decides NOTHING about who may see what. Each section (and each link)
   names the destination it came from (`from`), and is drawn only when the
   reader reaches that destination today: the same capability check
   (NAV_CAPABILITY, through roleGrants, in design/roles.js) and then the same
   module switch (lib/features.js useNav). There is no list of roles anywhere
   in this file. A reader who reaches none of a home's sections is not offered
   the home.

   `key` is the nav key the home is drawn under, and it is a destination that
   existed before homes did, so every `nav-<key>` test id, every saved session
   and every walk that names it still lands where it did. A reader who does not
   reach that key but reaches another of the home's sections gets the home
   under the first section he reaches (entryKey below), never under a key he
   was not offered. `absorbs` lists destinations that were their own menu
   entries and now live inside the home; they are still routes (App renders
   them as the home opened on that section), they are just not a second item
   in the menu.

   Nothing here is a read. A section is the view that was already there, with
   the reads it already makes.

   THIS FILE IMPORTS NOTHING, ON PURPOSE. design/roles.js and lib/features.js
   are in the public pages' static graph (session.js reaches features.js), and
   that graph sits at its ceiling (tools/check-bundle.mjs). The homes are the
   signed-in shell's, so they live here, outside it, and reach the menu through
   lib/homeNav.js.
*/
export const HOMES = {
  // Today (§1.3): the day sheet, what needs the reader ("To resolve", only for
  // someone who can act on one of its rows, Q17), and the news, read where the
  // day is read. The driver's, groundskeeper's and scorer's day screens stay
  // the Today a holder of those capabilities lands on.
  dashboard: {
    key: "dashboard", title: "Today", color: "emerald", absorbs: ["readiness", "news"],
    sections: [
      { key: "dashboard", label: "Today",      from: "dashboard" },
      { key: "readiness", label: "To resolve", from: "readiness" },
      { key: "news",      label: "News",       from: "news"      },
    ],
    links: [],
  },
  // Matches: the fixtures, the same fixtures by date, and who is umpiring
  // them. Competitions and the Rulebook are found from here, on its bar.
  matches: {
    key: "matches", title: "Matches", color: "sky", absorbs: ["calendar", "officials"],
    sections: [
      { key: "matches",   label: "Matches",   from: "matches"   },
      { key: "calendar",  label: "Calendar",  from: "calendar"  },
      { key: "officials", label: "Officials", from: "officials" },
    ],
    links: [
      { to: "competitions", label: "Competitions", from: "competitions" },
      { to: "rulebook",     label: "Rulebook",     from: "rulebook"     },
    ],
  },
  // Team (Q21: one home): the side and the boys in it. Seven sections on
  // paper; each is the screen it was, under its own capability, so a reader
  // is shown exactly the ones that were his menu entries before.
  squad: {
    key: "squad", title: "Team", color: "indigo", absorbs: ["profiles", "injuries", "training", "skills", "analytics", "selection"],
    sections: [
      { key: "squad",     label: "Squad",     from: "squad"     },
      { key: "profiles",  label: "Players",   from: "profiles"  },
      { key: "injuries",  label: "Who's out", from: "injuries"  },
      { key: "training",  label: "Training",  from: "training"  },
      { key: "skills",    label: "Skills",    from: "skills"    },
      { key: "analytics", label: "Stats",     from: "analytics" },
      { key: "selection", label: "Selection", from: "selection" },
    ],
    links: [],
  },
  competitions: {
    key: "competitions", title: "Competitions", color: "amber", absorbs: ["leagues"], under: "matches",
    sections: [
      { key: "competitions", label: "Competitions", from: "competitions" },
      { key: "leagues",      label: "Leagues",      from: "leagues"      },
    ],
    links: [],
  },
  // Transport: the trips and the fleet, the kit register, and the ground
  // schedule that has always sat on the Logistics screen under its capability.
  logistics: {
    key: "logistics", title: "Logistics", color: "orange", absorbs: [],
    sections: [
      { key: "transport", label: "Transport", from: "logistics" },
      { key: "equipment", label: "Equipment", from: "logistics" },
      { key: "grounds",   label: "Grounds",   from: "logistics" },
    ],
    links: [{ to: "fields", label: "Fields & pitch profiles", from: "fields" }],
  },
  // Grounds: the fields and their pitches. The ground schedule is on the
  // Logistics screen under transport.read; it is linked to, not copied, so a
  // reader sees it exactly where, and only if, they did before.
  fields: {
    key: "fields", title: "Fields & Pitch Profiles", color: "teal", absorbs: [], under: "logistics",
    sections: [
      { key: "fields", label: "Fields & pitches", from: "fields" },
    ],
    links: [{ to: "logistics", section: "grounds", label: "Ground schedule", from: "logistics" }],
  },
};

/**
 * The homes whose bar the shell draws above the screen (App.jsx). The three
 * older homes draw theirs inside their own screens, under the header. A
 * framed home's section keys are the destinations themselves, so choosing a
 * section is choosing that destination and its route.
 */
export const FRAMED = Object.freeze(["dashboard", "matches", "squad"]);

/**
 * A destination reached from a bar rather than the menu while the reader
 * reaches the one it sits under (§1.2 rule 2): Competitions and the Rulebook
 * are on the Matches bar, Fields on the Logistics bar. A reader who does not
 * reach the parent keeps the entry.
 */
export const UNDER = Object.freeze({
  ...Object.fromEntries(Object.values(HOMES).filter((h) => h.under).map((h) => [h.key, h.under])),
  rulebook: "matches",
});

/**
 * In the header on every screen, for everybody (§1.2 rule 3): the bell,
 * "Raise a concern" and the person's own name, which opens their Settings.
 * Still routes; never menu entries. The persona bars never held them.
 */
export const HEADER = Object.freeze(["notifications", "safeguarding", "settings"]);

/** absorbed destination → the home it is drawn inside */
export const HOME_OF = Object.fromEntries(Object.values(HOMES).flatMap((h) => h.absorbs.map((k) => [k, h.key])));

/** The home a destination belongs to: the home that absorbed it, else itself. @param {string} k */
export const homeOf = (k) => HOME_OF[k] ?? k;

/**
 * What a reach (the destinations a reader holds, capability- and module-
 * narrowed) shows of one home: the sections and links whose `from` is in it.
 * `visible` is false when no section is, and then the home is not offered.
 * @param {string} homeKey @param {string[]} reach
 */
export const homeParts = (homeKey, reach) => {
  const h = HOMES[homeKey];
  const sections = h.sections.filter((s) => reach.includes(s.from));
  return { sections, links: h.links.filter((l) => reach.includes(l.from)), visible: sections.length > 0 };
};

/**
 * The menu key a home is drawn under for this reach: its own key when the
 * reader reaches it, else the first section he does. Never a destination
 * outside the reach (a union selector's Team is `selection`, not `squad`).
 * @param {string} homeKey @param {string[]} reach
 * @returns {string | null}
 */
export const entryKey = (homeKey, reach) => (reach.includes(homeKey) ? homeKey : homeParts(homeKey, reach).sections[0]?.from ?? null);

/**
 * Reach, collapsed to what the menu draws: an absorbed destination becomes its
 * home (at the place it held, once); a home none of whose sections is in the
 * reach is dropped; the header's three leave; and a destination under another
 * leaves when the reader reaches the one it is under. Order is the reach's own.
 * Only ever removes: every key returned is in the reach.
 * @param {string[]} reach
 */
export const collapseHomes = (reach) => {
  const out = /** @type {string[]} */ ([]);
  for (const k of reach) {
    if (HEADER.includes(k)) continue;
    const h = homeOf(k);
    if (HOMES[h] && !homeParts(h, reach).visible) continue;
    if (UNDER[h] && reach.includes(UNDER[h])) continue;
    const e = HOMES[h] ? entryKey(h, reach) : h;
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
};

/**
 * The menu's word for an entry where it is not the destination's own
 * (design/roles.js NAV_META): a home with one section the reader reaches is
 * named by that section (§1.2: a union selector sees "Selection", not
 * "Team"), and a home with several by its title.
 * @param {string} k  a key collapseHomes() returned  @param {string[]} reach
 * @returns {string | null}  null: the destination's own word
 */
export const entryLabel = (k, reach) => {
  const h = homeOf(k);
  if (!HOMES[h]) return null;
  const { sections } = homeParts(h, reach);
  return sections.length === 1 ? sections[0].label : HOMES[h].title;
};

/**
 * Which menu entry is lit while `page` is open: the entry of its home, or of
 * the home it sits under; null for a page with no entry (the header's).
 * @param {string} page  @param {string[]} menu  what collapseHomes() returned
 * @returns {string | null}
 */
export const entryFor = (page, menu) => {
  if (menu.includes(page)) return page;
  const h = homeOf(page);
  const hit = menu.find((k) => homeOf(k) === h);
  if (hit) return hit;
  const up = UNDER[h];
  return up ? menu.find((k) => homeOf(k) === up) ?? null : null;
};
