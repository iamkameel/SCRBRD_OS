import { D } from "../design/tokens.js";

// ══════════════════════════════════════════════════════
//  THE ROADMAP — one list, read by Settings › Roadmap and by the pitch deck
//
// `status` is checked against the repository, not asserted:
//   shipped  — built, drawn, and covered by a walk that would fail if it broke
//   partial  — the DATA exists and is permission-scoped; no screen draws it
//   planned  — not started
// "partial" is the honest and uncomfortable category. Re-read against the
// code each time this file is touched; the grep is the source, not memory.
export const UPGRADES = [
  // ── Shipped ──────────────────────────────────────────────────
  { id: "up2",  category: "AI & Analysis", priority: "high",   status: "shipped", title: "Shot Pattern Wagon Wheel",
    desc: "A boy's scoring zones across every innings, on his own profile. Placements are stored batter-relative and mirrored at render, so a left-hander's cover drive is comparable with a right-hander's.", effort: "High" },
  { id: "up3",  category: "Integrations",  priority: "high",   status: "shipped", title: "Live Score Sync",
    desc: "Match Centre reads the live fold from the ball log. Offline queue, device handover, voided balls and a way out of quarantine all covered.", effort: "Medium" },
  { id: "up4",  category: "Comms",         priority: "high",   status: "shipped", title: "Parent Broadcast Alerts",
    desc: "Push to a registered device when something happens to their child. Delivery is per-person and permission-scoped; the prompt itself names nobody.", effort: "Medium" },
  { id: "up12", category: "Fitness",       priority: "medium", status: "shipped", title: "Medical Clearance Workflow",
    desc: "Clearance requirements, adult clearances and a register a school can actually be audited against.", effort: "Medium" },
  { id: "up15", category: "Fitness",       priority: "high",   status: "shipped", title: "Bowling Workload & Welfare",
    desc: "Spells, breaches and directives against age-group limits, on the Training screen, with a school's own Open-band ceiling set from Settings.", effort: "Low" },
  { id: "up19", category: "Admin",         priority: "medium", status: "shipped", title: "Officials & Kit Registers",
    desc: "The panel of umpires and scorers, with accreditation; the kit the school holds and who has it out.", effort: "Medium" },
  { id: "up20", category: "Admin",         priority: "medium", status: "shipped", title: "Module Switches",
    desc: "A school turns a module off for itself or for one person; off at any school you belong to is off, and a write is refused as surely as a read.", effort: "Low" },
  { id: "up21", category: "Admin",         priority: "high",   status: "shipped", title: "Who Read What",
    desc: "Every restricted read, every read from outside the school and every support session, on the school's own record under Settings › School.", effort: "Low" },
  { id: "up22", category: "Integrations",  priority: "medium", status: "shipped", title: "Reduced-Overs Matches",
    desc: "A revised limit and target mid-innings, entered by the umpire, replayed by the same reducer.", effort: "Medium" },

  // ── Built underneath, not yet drawn ──────────────────────────
  { id: "up5",  category: "AI & Analysis", priority: "high",   status: "partial", title: "Opposition Dossier",
    desc: "Batter-against-bowler match-ups, the derby record and the opponent's squad are all computed and permission-scoped. Nothing on screen reads them yet — this is the largest single gap in the product.", effort: "Medium" },
  { id: "up16", category: "Admin",         priority: "medium", status: "partial", title: "Caps, Honours & Milestones on the Passport",
    desc: "Recorded, consented and readable; simply not shown. The cheapest item here and the one a pupil actually opens.", effort: "Low" },
  { id: "up11", category: "Admin",         priority: "low",    status: "partial", title: "Season History Archive",
    desc: "Seasons and competitions are modelled; there is no year-on-year view over them.", effort: "Medium" },
  { id: "up23", category: "Admin",         priority: "low",    status: "partial", title: "Support Access Screen",
    desc: "A platform administrator can begin a one-hour, one-school session through the API and the school sees it here. Nothing draws the platform side yet.", effort: "Low" },
  { id: "up24", category: "AI & Analysis", priority: "low",    status: "partial", title: "DRS Review Panel",
    desc: "Built and switched off platform-wide until there is ball-tracking to feed it.", effort: "High" },

  // ── Planned ──────────────────────────────────────────────────
  { id: "up17", category: "AI & Analysis", priority: "high",   status: "planned", title: "Match Insights & Intelligence Ribbon",
    desc: "An insight anchored to the delivery that caused it, typed so it can be ranked rather than cycled, and carrying whether a machine derived it or a scorer confirmed it.", effort: "Medium" },
  { id: "up18", category: "AI & Analysis", priority: "medium", status: "planned", title: "Pitch Map",
    desc: "Line and length per delivery — the bowling half of the wagon wheel. The only chart form genuinely missing.", effort: "Medium" },
  { id: "up1",  category: "AI & Analysis", priority: "medium", status: "planned", title: "Post-Match Report",
    desc: "A written report from the scorecard, the phases and the conditions. Should say which of it was derived and which asserted.", effort: "Medium" },
  { id: "up6",  category: "Fitness",       priority: "medium", status: "planned", title: "Fitness Test Logging",
    desc: "Beep tests, speed gates, vertical jump, grip strength, tracked across a season.", effort: "Low" },
  { id: "up7",  category: "Media",         priority: "medium", status: "planned", title: "Video & Photo Clips",
    desc: "No media is modelled at all today. For a product whose users are fifteen-year-olds, that is a real absence.", effort: "High" },
  { id: "up9",  category: "Comms",         priority: "medium", status: "planned", title: "In-App Parent Messaging",
    desc: "Secure one-to-one between coach and parent, replacing the WhatsApp group. Nothing is modelled yet.", effort: "High" },
  { id: "up13", category: "Admin",         priority: "medium", status: "planned", title: "Invoicing & Subscriptions",
    desc: "invoice.read and invoice.manage are already granted to the principal and the bursar, with no table behind them. The finance role currently cannot do the thing its name describes.", effort: "High" },
  { id: "up8",  category: "Integrations",  priority: "low",    status: "planned", title: "CricHQ / PlayCricket Import",
    desc: "CSV import exists and goes through the ordinary write policies. A direct API sync does not.", effort: "High" },
  { id: "up10", category: "Admin",         priority: "low",    status: "planned", title: "PDF Scorecard Export",
    desc: "One-click export of any scorecard with the school's branding.", effort: "Low" },
  { id: "up14", category: "AI & Analysis", priority: "low",    status: "planned", title: "Training Recommendation Engine",
    desc: "Next focus per player from recent form, skill gaps and workload.", effort: "High" },
];
export const STATUS_TONE  = { shipped: D.emerald, partial: D.amber, planned: D.textMuted };
export const STATUS_LABEL = { shipped: "Shipped", partial: "Built, not drawn", planned: "Planned" };
