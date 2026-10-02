# What is still prototype in SCRBRD OS

*Swept 1 October 2026, on main at da9506f plus PR #61.*

A prototype leftover here means one of four things:

- a control that does nothing;
- an edit that changes only the screen and is lost on reload;
- invented data shown to a signed-in person as if it were real;
- a label left over from an earlier design.

**Not counted:**

- **Demo mode** (nobody signed in) runs on sample data on purpose and says so. It is not a leftover.
- **Features planned and not started** are listed at the end, separately.

**Severity:**

- **High:** invented records or figures that a signed-in person could take as real.
- **Medium:** controls that look live and are not.
- **Low:** wrong labels or cosmetic issues.

---

## 1. Invented data shown to signed-in people (High)

| # | Screen | What is shown | Why it matters | Fix | Who |
|---|---|---|---|---|---|
| 1.1 | **Management → Audit log** (`ManagementView.jsx`, `AUDIT_LOG`) | Six made-up entries with names and actions ("G. Sutherland updated fixture…", "Dr Khumalo: medical clearance updated — T. Pretorius", "User u14 role changed…") | It reads as a real record of who did what, including a named child's medical clearance. A school would trust it. | Read the real audit (`access_log`, `scoring_audit` and the other audit tables, under their own capabilities), or remove the tab until it does | Opus (it reads audit and minors' records) |
| 1.2 | **Management → Ground tasks** (`GROUND_TASKS`) | Five invented tasks with assignees and dates ("Prepare Main Oval — 1XI vs Michaelhouse", "E. Mzimba") | Groundskeepers would see jobs nobody set | Wire to the groundskeeper's real duties (SCRBRD-085 built the phone view over duties), or remove | Sonnet |
| 1.3 | **Logistics → Equipment** (`LogisticsView.jsx`, `EQUIPMENT_INVENTORY`) | A fixed inventory (24 Dukes match balls, helmets…) and KPI tiles counted from it | The kit register shipped elsewhere (roadmap "Officials & Kit Registers"). This copy never changes. | Read the real kit register, or remove this tab and point to it | Sonnet |
| 1.4 | **Analytics → Performance** (`AnalyticsView.jsx`, `SEASON_TREND`, `SEASON_OPP`) | The season worm and per-player bars are fixed arrays. The screen already says so in an amber note. | It is honest, but it is still invented figures on a stats screen | A season-per-player career read, then draw from it (the code comment names the read it needs) | Opus (read) + Sonnet (screen) |
| 1.5 | **Global search** (`GlobalSearch.jsx`, `SCHOOLS_REGISTRY`) | Search results include schools from the mock registry, signed in or not | A school that isn't on the platform appears as a result | Search the `schools` read | Sonnet |
| 1.6 | **Profiles** (`ProfilesView.jsx`, `KZN_SCHOOLS`, `"Hilton College"` fallback) | The school name falls back to a mock list and a hard-coded "Hilton College" | It names the wrong school for any school but the seed's | Use `schoolName` from the read only, with no fallbacks | Sonnet |

## 2. Controls that look live and are not (Medium)

| # | Screen | Controls | API today | Fix | Who |
|---|---|---|---|---|---|
| 2.1 | **Management → Users** | Add, edit, promote, suspend, delete. Each changes only the screen; one role per person is shown. | `POST /api/users` (adds a role to an existing account by email) | **In progress** (SCRBRD-132 A1+A2, Sonnet). End a role is queued (C1, Opus). Suspend comes with safeguarding phase 2. | — |
| 2.2 | **Injuries** (`InjuryView.jsx`) | Update Progress, Clear for Training, Refer to Physio | Clearance yes (`/api/clearances`); injury updates and referral no | Wire Clear for Training to clearances. Injury updates and referral need routes over minors' medical data. | Opus |
| 2.3 | **Injuries → Log injury form** | Every field's `onChange` does nothing, so the form cannot be filled in or saved | No injury write route | Remove the form until the route exists, then build both | Opus |
| 2.4 | **Squad → player panel** (`SquadView.jsx`) | Edit Profile, Log Injury, Set Availability | Availability yes; profile partly (team, date of birth, contacts); injury no | Set Availability now. Edit Profile to the routes that exist. Log Injury with 2.3. | Sonnet; Opus for injury |
| 2.5 | **Skills → fitness/skills card** | "Update Scores" | — | **Removed in PR #61** | done |

## 3. Wrong labels and leftovers (Low)

| # | Screen | What | Fix |
|---|---|---|---|
| 3.1 | **Skills** (`SkillsView.jsx`) | Each skill bar's axis reads "0 · Target: 90 · 100", but ratings run 1–20. The 8px text is also under the 12px floor. | Axis "1 · 20" at 12px, or no axis; no invented "Target" |
| 3.2 | **Management tabs** (`TABS_MAP` by role name) | Tabs are chosen by role-name string, not capability | Gate on capabilities, as the rest of the app does |
| 3.3 | **Fields** (`FieldsView.jsx`) | The pitch drawing's cracks are `Math.random()`, so they change on every render | Fixed decoration, or derived from the ground report |
| 3.4 | **Rulebook** (`RulebookView.jsx`, `RULES`) | A fixed summary of the Laws beside the live clauses. It is labelled as a reference summary, which is fine. Check it against the 4th Edition. | Review text only |

## 4. Missing pieces behind real screens

| # | What | Why | Who |
|---|---|---|---|
| 4.1 | **End a role** (withdraw one assignment, with a reason, on the record) | A role can be added but never taken away from any screen | Opus, migration (queued as SCRBRD-132 C1) |
| 4.2 | **Suspend an account** | Designed in safeguarding phase 2 | Opus, with safeguarding phase 2 |
| 4.3 | **Injury write routes** (log, update, refer) | Needed by 2.2–2.4 | Opus, migration if new columns |
| 4.4 | **Invitation notices and saved "checked defaults"** for leagues | SCRBRD-131 item 4 | Opus, migration |
| 4.5 | **Season-per-player career read** | Needed by 1.4 | Opus |

## 5. Planned, not started (roadmap, for completeness)

These are honest "planned" items on Settings → Roadmap, not leftovers:

- **Coming next:** Match Insights ribbon, pitch map, fitness test logging, video and photo clips.
- **Bigger pieces:** in-app parent messaging, invoicing and subscriptions, CricHQ / PlayCricket import, PDF scorecard export, a training recommendation engine.
- **Smaller stats:** ground records, bowling analysis by batting order.

---

## Suggested order

1. **1.1, 1.2 and 1.3** (invented records and tasks shown as real): remove or wire first, before any school sees them. 1.2 and 1.3 are small (Sonnet). 1.1 is Opus because it reads audit.
2. **2.1**, already in progress, then **4.1** End a role.
3. **2.4** Set Availability and Edit Profile, plus **1.5, 1.6, 3.1 and 3.2** in one Sonnet batch.
4. **4.3** injury routes, then **2.2–2.4** injury buttons (Opus).
5. **1.4** with its career read, and **4.2** with safeguarding phase 2.

---

## Clean-up plan (decided by Kameel, 1 October 2026)

### Decisions

- **Ground tasks:** wire it, read-only, to the groundskeeper duties that already exist (SCRBRD-085).
- **Equipment:** remove the Logistics copy and point to the real kit register. Keep one register, not two.
- **Injuries:** medical staff and coaches may log an injury. Medical staff update its phase, clear for training and refer. Parents see their own child's injuries.
- **Audit log:**
  - **Who sees it:** whoever holds `audit.read` today.
  - **Children's names:** masked as elsewhere.
  - **Reads:** every read of it is logged.

### Wave A: take down the invented data and wire what exists

- **Who and scope:** Sonnet, screens only, no migration.
- **Ground tasks:** read-only from duties (1.2).
- **Equipment:** tab removed, with a link to the kit register (1.3).
- **Audit log:** the invented entries come down until Wave B, with the line "The audit log is coming" (1.1).
- **School names:** the global search and Profiles use the real schools read (1.5, 1.6).
- **Skills axis:** 1–20 at 12px (3.1).
- **Management tabs:** chosen by capability, not role name (3.2).
- **Squad:** Set Availability, and Edit Profile on the routes that exist (2.4).
- **Injuries:** the dead buttons and the log form are hidden, with the line "Recording injuries is coming" (2.2, 2.3).
- **Fields:** the drawing is fixed (3.3).
- **Already in progress:** Management users (2.1, SCRBRD-132 A1+A2).

### Wave B: server pieces

- **Who and timing:** Opus, two at a time, after the db/71–76 PR.
- **Migrations:** each takes the next number, db/77 onwards.

1. **B1, end a role.** It replaces Promote and Delete in Management (4.1).
2. **B2, the real audit log**, under `audit.read`. Children's names are masked and every read is logged (1.1). **Built (2026-10-02): db/79.**
3. **B3, injury routes:**
   - log, update phase, clear for training (through clearances), refer;
   - wire the injury buttons Wave A hid (2.2–2.4, 4.3).
4. **B4, season-per-player career read.** Analytics then draws the worm and bars from it (1.4, 4.5).
5. **B5, league invitation notices**, with the "checked defaults" stored on the set (4.4).

### Wave C: with safeguarding phase 2

- **Suspend an account** (4.2).
- **Rulebook summary:** check it against the 4th Edition (3.4).
