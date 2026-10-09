/* ── Homes (GA-I30) ──────────────────────────────────────────────────
   One place per domain. A HOME is a menu entry that gathers destinations which
   already exist, so a person lands in one place for grounds, transport or
   competitions instead of hunting through the menu.

   A home decides NOTHING about who may see what. Each section (and each link)
   names the destination it came from (`from`), and is drawn only when the
   reader reaches that destination today: the same capability check
   (NAV_CAPABILITY, through roleGrants, in design/roles.js) and then the same
   module switch (lib/features.js useNav). There is no list of roles anywhere
   in this file. A reader who reaches none of a home's sections is not offered
   the home.

   `key` is the nav key the home is drawn under, and it is a destination that
   existed before homes did, so every `nav-<key>` test id, every saved session
   and every walk that names it still lands where it did. `absorbs` lists
   destinations that were their own menu entries and now live inside the home;
   they are still routes (App renders them as the home opened on that
   section), they are just not a second item in the menu.

   Nothing here is a read. A section is the view that was already there, with
   the reads it already makes.

   THIS FILE IMPORTS NOTHING, ON PURPOSE. design/roles.js and lib/features.js
   are in the public pages' static graph (session.js reaches features.js), and
   that graph sits at its ceiling (tools/check-bundle.mjs). The homes are the
   signed-in shell's, so they live here, outside it, and reach the menu through
   lib/homeNav.js.
*/
export const HOMES = {
  competitions: {
    key: "competitions", title: "Competitions", color: "amber", absorbs: ["leagues"],
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
    key: "fields", title: "Fields & Pitch Profiles", color: "teal", absorbs: [],
    sections: [
      { key: "fields", label: "Fields & pitches", from: "fields" },
    ],
    links: [{ to: "logistics", section: "grounds", label: "Ground schedule", from: "logistics" }],
  },
};

/** absorbed destination → the home it is drawn inside */
export const HOME_OF = Object.fromEntries(Object.values(HOMES).flatMap((h) => h.absorbs.map((k) => [k, h.key])));

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
 * Reach, collapsed to what the menu draws: an absorbed destination becomes its
 * home (at the place it held, once), and a home none of whose sections is in
 * the reach is dropped. Order is the reach's own.
 * @param {string[]} reach
 */
export const collapseHomes = (reach) => {
  const out = /** @type {string[]} */ ([]);
  for (const k of reach) {
    const h = HOME_OF[k] ?? k;
    if (HOMES[h] && !homeParts(h, reach).visible) continue;
    if (!out.includes(h)) out.push(h);
  }
  return out;
};
