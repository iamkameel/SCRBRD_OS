import { D } from "../design/tokens.js";

// ══════════════════════════════════════════════════════
//  THE ROADMAP — one list, read by Settings › Roadmap and by the pitch deck
//
//   shipped  — built, drawn, and covered by the walk(s) named in `walk`
//   partial  — the DATA exists and is permission-scoped; no screen draws it
//   planned  — not started
//
// `walk` is what makes "shipped" answerable instead of asserted. Every shipped
// entry names the walks that cover it, and apps/web/test/roadmap.test.mjs
// checks each one exists on disk and is registered in tools/run-smoke-api.mjs,
// so a walk that is deleted or renamed takes the claim down with it.
//
// `undrawn` is the same idea pointing the other way. A "partial" claims the
// data exists and no screen draws it, and that claim goes stale just as easily
// — up16 sat here saying "simply not shown" while RecognitionCard had been on
// the player profile all along. So each partial names a real identifier from
// services/api, and the test checks it is real AND that no view references it.
// Naming something real is the floor: an invented testid nobody would ever use
// would pass forever.
//
// BE PRECISE ABOUT WHAT THAT PROVES. It proves the named walk exists and runs.
// It does not prove the walk would fail if the feature broke — no test can
// prove that about another test — so the screens say "names the walk that
// covers it" rather than "a walk would fail if it broke", which was the older
// and larger claim nothing was keeping.
//
// "partial" is the honest and uncomfortable category. Re-read against the
// code each time this file is touched; the grep is the source, not memory.
export const UPGRADES = [
  // ── Shipped ──────────────────────────────────────────────────
  { id: "up2",  category: "AI & Analysis", priority: "high",   status: "shipped", title: "Shot Pattern Wagon Wheel",
    desc: "A boy's scoring zones across every innings, on his own profile. Placements are stored batter-relative and mirrored at render, so a left-hander's cover drive is comparable with a right-hander's.", effort: "High", walk: ["read", "browser-read"] },
  { id: "up3",  category: "Integrations",  priority: "high",   status: "shipped", title: "Live Score Sync",
    desc: "Match Centre reads the live fold from the ball log. Offline queue, device handover, voided balls and a way out of quarantine all covered — a stale-epoch ball is reviewed and released or discarded from a panel in Match Centre, by whoever holds the approval capability, not by editing the table by hand. A delivery that completes an innings opens a review of the derived figures rather than sealing it, and confirming writes the innings_end event that records why it ended.", effort: "Medium", walk: ["sync", "browser-sync", "handover", "browser-handover", "quarantine", "browser-quarantine", "browser-innings-end"] },
  { id: "up4",  category: "Comms",         priority: "high",   status: "shipped", title: "Parent Broadcast Alerts",
    desc: "Push to a registered device when something happens to their child. Delivery is per-person and permission-scoped; the prompt itself names nobody.", effort: "Medium", walk: ["push", "broadcast"] },
  { id: "up12", category: "Fitness",       priority: "medium", status: "shipped", title: "Medical Clearance Workflow",
    desc: "Clearance requirements, adult clearances and a register a school can actually be audited against.", effort: "Medium", walk: ["clearance"] },
  { id: "up15", category: "Fitness",       priority: "high",   status: "shipped", title: "Bowling Workload & Welfare",
    desc: "Spells, breaches and directives against age-group limits, on the Training screen, with a school's own Open-band ceiling set from Settings.", effort: "Low", walk: ["workload"] },
  { id: "up19", category: "Admin",         priority: "medium", status: "shipped", title: "Officials & Kit Registers",
    desc: "The panel of umpires and scorers, with accreditation; the kit the school holds and who has it out.", effort: "Medium", walk: ["officials", "kit"] },
  { id: "up20", category: "Admin",         priority: "medium", status: "shipped", title: "Module Switches",
    desc: "A school turns a module off for itself or for one person; off at any school you belong to is off, and a write is refused as surely as a read.", effort: "Low", walk: ["modules"] },
  { id: "up21", category: "Admin",         priority: "high",   status: "shipped", title: "Who Read What",
    desc: "Every restricted read, every read from outside the school and every support session, on the school's own record under Settings › School.", effort: "Low", walk: ["audit", "access"] },
  { id: "up5",  category: "AI & Analysis", priority: "high",   status: "shipped", title: "Opposition Dossier",
    desc: "The other side's squad and what the ball log says about each of them, on the fixture in Match Centre, inside the fourteen-day window before it. Cricket columns only, figures withheld below a thirty-ball floor with the evidence named, and every read written to the other school's access log. Head-to-Head is now derived from the fixtures rather than the hand-written table it replaced, and the match-ups say how much of the log they can speak for.", effort: "Medium", walk: ["opposition", "browser-dossier"] },
  { id: "up22", category: "Integrations",  priority: "medium", status: "shipped", title: "Reduced-Overs Matches",
    desc: "A revised limit and target mid-innings, entered by the umpire, replayed by the same reducer.", effort: "Medium", walk: ["scorecard"] },
  // Was listed "partial — simply not shown" until the walk field went in and
  // somebody looked. RecognitionCard has been on the player profile since it
  // was built, and two walks assert it. See the note above about re-reading
  // this file against the code: this is what it costs when nobody does.
  { id: "up16", category: "Admin",         priority: "medium", status: "shipped", title: "Caps, Honours & Milestones on the Passport",
    desc: "Colours, half-colours, honours, captaincy, a side's cap ledger and the milestones the ball log threw up \u2014 on the boy's own profile, in the server's words, each carrying the season it belongs to and whether it may go on a public board.", effort: "Low", walk: ["recognition", "browser-read"] },
  { id: "up45", category: "AI & Analysis", priority: "medium", status: "shipped", title: "Contact Density Map",
    desc: "A continuous heat map over the ground from a batter's captured placements, smoothed by a 2D Gaussian kernel rather than drawn as forty overlapping spokes. Sector-era balls carry no distance and are excluded, with the count said aloud rather than dropped silently.", effort: "Medium", walk: ["read", "browser-read"] },
  { id: "up46", category: "AI & Analysis", priority: "medium", status: "shipped", title: "Directional Reach Chart",
    desc: "Batting power and directionality by the ground's own angular families \u2014 fine leg through third man \u2014 as a spider chart of mean reach per direction. \u201cPrecision\u201d is deliberately not drawn: the log records where a ball landed, never where a batter meant it to go, so no axis claims to measure intent.", effort: "Medium", walk: ["read", "browser-read"] },

  { id: "up24", category: "AI & Analysis", priority: "low",    status: "shipped", title: "DRS Review Panel",
    desc: "The screen is built and proven end to end — a match's reviews listed with the Law 36 components and always how the decision was known, and a form to record one for whoever holds scoring.correct — and it stays switched off for every school on the platform, on purpose, until there is ball-tracking to feed it. “Pitching in line” entered by a person today is a judgement wearing the visual language of a measurement, which is exactly what the platform switch (drs_review in packages/policy/src/modules.mjs, enforced again by a trigger in Postgres) exists to prevent. Nobody sees this panel by default; a platform administrator throwing that one switch is the only way it becomes visible anywhere, and switching it back off makes it disappear again without touching a row on record.", effort: "High", walk: ["drs", "browser-drs"] },
  // Was "partial — no screen draws it". Drawn now; staff only, by product
  // decision, although the database would let a pupil read his own.
  { id: "up51", category: "Admin",         priority: "high",   status: "shipped", title: "Disciplinary Record",
    desc: "A matter about a named child, filed by the umpire who stood at the match or by the school, concluded or withdrawn by the school. Drawn as a Conduct tab on the boy's profile for staff who read the record, with the school's own filing form and the way to close a matter; the umpire reports from the fixture in Match Centre and is told it landed without being shown it back. In the app the head, the office and the director of sport read it, and every read is on the school's own record; the league holds the read through the API but has no roster to open a profile from, so no screen draws it for them. Pupils do not see it in the app yet: the database would let a boy read his own, and by product decision the screen is staff-only for now.", effort: "Medium", walk: ["discipline", "browser-discipline"] },

  // Was "partial — nothing draws the platform side". Drawn now, in
  // apps/web/src/views/support.jsx, under Settings › Support.
  { id: "up23", category: "Admin",         priority: "low",    status: "shipped", title: "Support Access Screen",
    desc: "A platform administrator chooses a school, a role and a reason, and begins a session from Settings › Support: one school, an hour unless they say otherwise, four at most. The countdown is the server's expiry and whether it is live is the server's answer, so it stops by itself with nobody watching. The school sees who, as what and why under Settings › School, and a session ended early from the platform side reads as ended, and by whom, at the school. Every refusal — no reason worth reading, a session already open, a role a school cannot hold — is said in words. Only a support holder is offered the tab; the database refuses anyone else regardless.", effort: "Low", walk: ["support", "browser-support"] },

  // ── Built underneath, not yet drawn ──────────────────────────
  { id: "up11", category: "Admin",         priority: "low",    status: "partial", title: "Season History Archive",
    desc: "Seasons and competitions are modelled; there is no year-on-year view over them.", effort: "Medium", undrawn: ["seasons"] /* the read exists; no view calls it */ },

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
    desc: "invoice.read and invoice.manage are granted to schooladmin, principal and the finance role, with no table behind either. SCRBRD-030 split the old commercial `finance` bundle in two — this pair is now the entire reason the role exists — and a bursar holding it still cannot invoice anyone.", effort: "High" },
  { id: "up8",  category: "Integrations",  priority: "low",    status: "planned", title: "CricHQ / PlayCricket Import",
    desc: "CSV import exists and goes through the ordinary write policies. A direct API sync does not.", effort: "High" },
  { id: "up10", category: "Admin",         priority: "low",    status: "planned", title: "PDF Scorecard Export",
    desc: "One-click export of any scorecard with the school's branding.", effort: "Low" },
  { id: "up14", category: "AI & Analysis", priority: "low",    status: "planned", title: "Training Recommendation Engine",
    desc: "Next focus per player from recent form, skill gaps and workload.", effort: "High" },
  // Inspired by a deep dive into howstat.com, the long-running cricket
  // statisticians' site — checked against this codebase's own schema and
  // read path before being written down, not carried over as marketing copy.
  // up47 is the one that matters most: it is a real, present gap in a
  // shipped feature, found by reading contextFrom() itself, not a new idea.
  { id: "up47", category: "AI & Analysis", priority: "high",   status: "shipped", title: "Stats-Magic Answers From Real Figures",
    desc: "contextFrom() now folds /read/career into the context, keyed onto the roster by player_id and written under the roster's own name — never the career row's, which is the masking guarantee. A batter never dismissed gets “no average (never dismissed)” rather than a fabricated zero, and a player with nothing in the ball log is named rather than silently omitted. Every figure was checked against the career views directly for a real seeded player.", effort: "Medium", walk: ["statsmagic"] },
  { id: "up48", category: "AI & Analysis", priority: "medium", status: "shipped", title: "Dismissal Analysis",
    desc: "How a boy gets out, and how a bowler takes his wickets, broken down by method — bowled, caught, lbw, run out, stumped and the rest, read from two new views (db/26_dismissal_breakdown.sql) grouping the same rows player_dismissals and player_bowling_career already fold into one count each. \"Caught and bowled\" is deliberately not its own line: ball_event has no fielder/catcher column, so there is nothing to distinguish the bowler taking his own catch from any other fielder taking it off him. On the player profile's Career tab now, beside the batting and bowling career cards, with a bar per method and a wicket whose method was never recorded shown as \"Method not recorded\" rather than dropped.", effort: "Medium", walk: ["dismissals", "browser-dismissals"] },
  { id: "up49", category: "AI & Analysis", priority: "low",    status: "planned", title: "Ground Records",
    desc: "Team and player figures per venue — average first-innings score at this ground, who has scored most runs here, home advantage by result. match.ground_id already links every fixture to a ground; nothing aggregates across it. howstat.com's Ground Records menu is the model to build against.", effort: "Medium" },
  { id: "up50", category: "AI & Analysis", priority: "low",    status: "planned", title: "Bowling Analysis by Batting Order",
    desc: "A bowler's wickets split by where the batter they dismissed sat in the order — top, middle or tail — instead of one blended average, so a coach can tell a new-ball wicket-taker from a tail-ender. Derivable from the event log's own batting sequence; no position is stored anywhere today. howstat.com runs this as a standing page for Test, ODI and T20 bowling.", effort: "High" },
];
export const STATUS_TONE  = { shipped: D.emerald, partial: D.amber, planned: D.textMuted };
export const STATUS_LABEL = { shipped: "Shipped", partial: "Built, not drawn", planned: "Planned" };
