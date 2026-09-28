# Cricket South Africa's Safeguarding Policy, checked against SCRBRD

Status: **research, for Kameel's review** (2026-09-27). Nothing here is built and no rule
is changed by this document. It checks what SCRBRD has decided, designed and built
against Cricket South Africa's *Safeguarding Policy: Against Harassment and Abuse in
Cricket* (2025), supplied by Kameel. Page numbers are the policy's own. Quotes are kept
short because the policy is copyrighted (p2).

**Decided since the brief (Kameel, 2026-09-27): SCRBRD will have Designated
Safeguarding Officers.** §4.1 writes that up as backlog items. It is not a question
here.

Two terms, to avoid a clash:
- **The Guardian** (capital G, in quotes where it matters) is CSA's appointed
  safeguarding partner (p22). SCRBRD's `guardian` role is a parent. They are unrelated.
- **DSO** means a club's (for us, a school's) Designated Safeguarding Officer. **PDSO**,
  **DDSO** and **NDSO** are the provincial, district and national ones (p11, p22).

**Does the policy reach schools?** It is written for CSA's clubs, members and hubs (p9
"DSO"), and it applies to "all children, coaches, volunteers, umpires, administrators …
and parents of children participating in CSA organised activities", including cricket
weeks, festivals and coaching programmes (p21). School cricket runs through the
provincial unions and those events, and PUBLIC_DATA C7 already says clubs and schools
follow one rule. This check treats the policy as SCRBRD's baseline for every tenant
(Question 1).

---

## 1. Summary

**Conflicts (six).** None of them is large, and each has a small fix.

1. **Children's own say from 12.** CSA says a photo or video must not carry a child's
   name without "the permission of the child and parent / guardian" (p34), and that
   from 12 a child's own permission is needed to take any image or hold any interview
   (p32, p34, p71–72). SCRBRD's consent comes from a guardian alone until 18. That
   matters for the stream overlay (SCRBRD-104, PUBLIC_DATA D2), the graphics pack on a
   stream (SCRBRD-106) and photo and video sharing (SCRBRD-092).
2. **The DSO signs off media, and nobody does in SCRBRD.** Live streaming is on the
   DSO's authorisation form (Annexure C, p73), and the DSO may refuse any footage
   (p32, p71). SCRBRD lets `broadcast.publish` holders publish an overlay and plans
   photo consent without any DSO step.
3. **Pupils see team-mates' injury dates.** The `player` role holds
   `medical.status.read`, so a pupil sees a team-mate's `date_injured`, `rtw_date` and
   `restricted`. CSA: medical needs are "not in general view to other
   parents/caregivers or children" (p52).
4. **Clearances are narrower and last longer than CSA allows.** The register has no
   Sexual Offences Register check at all. It requires nothing of administrators, and
   only the Children's Act register of officials and scorers. It accepts a clearance
   valid for up to five years. CSA wants all three checks for every adult coach,
   administrator and technical official, renewed every 24 months (p19, p24–26).
5. **Emergency contacts are released by role, not by a DSO decision.** CSA: a parent's
   or child's phone number goes to nobody else unless that is in the child's best
   interest, "and this decision must be made by the DSO" (p52). SCRBRD's release is
   well reasoned, but no DSO has made that decision.
6. **Trips need a DSO's clearance.** Every trip with a child must be cleared by the
   club or tour DSO, and a checklist goes to the NDSO (p45, p76). SCRBRD's trips check
   drivers and vehicles but have no DSO step.

**Agreements.** Most of what the platform already does meets the policy or goes
further: no photos in public, the never-public mark, names by consent, `noindex`,
masked medical tiers, a coach's overview instead of the physio's notes, the recorded
parent share in SCRBRD-110, the access log, pointer-only push, and the adult clearance
register with its driver guard.

**What the policy adds.** The main addition is the DSO: a school-level role, a way for
anyone to raise a concern and route it to the right DSO, a confidential concern record
kept apart from discipline, a thin referral to provincial and national level, a
retention rule, and a DSO's power to suspend an adult pending an enquiry. Around it
are smaller items: new clearance kinds (Sexual Offences Register, the annual
Safeguarding Awareness Certificate, DSO training, the signed acknowledgement), a
consent to being filmed, a link to The Guardian's anonymous reporting app, rules for
any future messaging, and a DSO route for serious injuries and workload patterns.

**What the policy does not say.** It says nothing about scoring apps, digital
platforms, messaging or social media contact between adults and children. It covers
online abuse in one line ("in person or online", p9) and bullying by "malicious SMS or
email messages" (p39). Live streaming appears once, as a tick box (p73). Where this
document proposes rules for messaging (SG-9) it says so: they follow the policy's
"never alone with a child" principle (p34 rule 6, p35), not a written rule.

---

## 2. Conflicts

Each conflict gives what it is, where, what the policy says, and the smallest change
that fixes it.

### K1 · A child's own consent from 12, for images, video and a name on them

- **Where:** `docs/policy/PUBLIC_DATA.md` §4 C1 (a verified guardian gives consent),
  C4 ("the same rule at every age") and C6 (his own consent counts from 18);
  §2 D2 (the overlay under the L2 rule); `SCRBRD-083_public_pages.md` §5 (the overlay
  and the graphics pack name a child by `publicName()`, which reads guardian
  consent); backlog SCRBRD-092 §3 ("the giver being a verified guardian (or the pupil
  himself from 18)").
- **The policy:** "Any photograph or video of a child may not include the child's
  name without the permission of the child and parent / guardian" (p34, rule 2). "If
  the child is over the age of 12, the child's permission to capture any image must be
  obtained" (p34, rule 7). Media and interviews need both parent and athlete "if
  between the ages of 12 and 18" to sign (p32, p34 rule 3). The parent's form says
  "my permission alone is not enough" (p72).
- **Why it bites:** a stream is a video. The overlay puts a child's name on it, so it
  needs the child's permission as well as the parent's. SCRBRD-092's photos need the
  same.
- **Smallest change:**
  1. Add a **pupil's own assent** record to the consent pattern db/47 set: the same
     shape, `given_by = 'pupil'`, accepted from his 12th birthday. It is needed
     **as well as** the guardian's, not instead of it.
  2. The overlay and any graphic shown on a stream name a child only when both
     records are present. Until then they use the role word, which is what
     SCRBRD-104's block already does today.
  3. SCRBRD-092's photo and video consent requires both from 12.
  4. PUBLIC_DATA C4 gains one line: "except images and video, where a child's own
     permission is also needed from 12 (CSA p34)".
  5. Whether a pupil's own "no" should also take his **text** name off public pages
     is Question 6.

  Tier: Opus (a migration and `public.mjs`), and the PUBLIC_DATA wording is Kameel's.

### K2 · Nobody authorises media for the school, and CSA says the DSO does

- **Where:** backlog SCRBRD-104 (the overlay, for schools' YouTube and Facebook
  streams); `SCRBRD-083_public_pages.md` §5.2 (the overlay serves names when
  `match_broadcast.published` and the side's `fixture_publication` are true, both
  under `broadcast.publish`: the director of sport and the sports admin); SCRBRD-092
  (photo and video consent with no approver).
- **The policy:** media "must be made available to the Club DSO with the
  understanding that the use of said materials can be denied" (p32, item 4). Consent
  is authorised only when "the DSO for the Club and the Club Chairperson" have
  authorised it (p32, item 3). "The final decision … lies solely with the Club DSO or
  the CRICKET SOUTH AFRICA NDSO" (p71). The DSO's section of Annexure C lists
  "Interview / Photograph / Video graph / Live stream" (p73).
- **Smallest change:** a **stream authorisation** record, one row per school per
  season or per fixture, written only by the DSO (SG-1). The overlay cannot be
  published without it. The DSO can also withdraw it, and withdrawal takes names off
  at once, as a consent withdrawal does. For SCRBRD-092, the DSO (not the uploader)
  holds the takedown. Tier: Opus.
- **Note:** SCRBRD does not carry the video. The school's camera does, and the school
  answers for it. But the overlay is SCRBRD's, and CSA puts live streaming in front of
  the DSO. A child with a never-public mark (C5) may also be a child the policy says
  may not be photographed at all: a ward of court or a child through Children's Court
  proceedings (p33). The DSO is the person who knows that.

### K3 · Pupils see a team-mate's injury status and return date

- **Where:** `packages/policy/src/roles.mjs`, the `player` bundle holds
  `medical.status.read` ("A pupil knows WHO is unavailable and until when");
  `tables.mjs` `injury` (unmasked at that tier: `date_injured`, `rtw_date`,
  `restricted`); `STEP4_parent_pupil.md` §8 phase A (the pupil walk asserts "the Squad
  shows a team-mate's `rtw_date`").
- **The policy:** "Staff and coaches should be aware of children with medical needs.
  This information should be accessible to staff and coaches who need it, but not in
  general view to other parents/caregivers or children" (p52, item 6). "No
  stakeholder may discuss any child's behaviour or circumstances in the presence of
  another child" (p52, item 4).
- **SCRBRD's own rule agrees with CSA:** PUBLIC_DATA N2 treats even the bare word
  "unavailable" as health. Signed in, a team-mate is "other children".
- **Smallest change:** withdraw `medical.status.read` from `player`
  (`WITHDRAWN_SINCE_01` and a `db/NN`). A pupil then learns the side from the team
  sheet, which is how STEP4 §2.2 already handles availability. STEP4's phase A walk
  flips its assertion. His own injury still reaches him through `selfaccess`. Tier:
  Opus (a role change touching minors' medical data).
- **Built 2026-09-28:** `db/55_medical_status_withdrawn.sql`, from `player` and `enquiry` (SCRBRD-115;
  `docs/design/SAFEGUARDING_DSO.md` §6.3 has the note on what `enquiry` is in the code).

### K4 · The clearance register is narrower and longer-lived than CSA's

- **Where:** `db/08_schema_programme.sql`, `adult_clearance` and
  `clearance_requirement` (~4794–4860).
  - The kinds are `police_clearance`, `child_protection`, `first_aid`,
    `driving_permit` and `coaching_accreditation`. There is **no Sexual Offences
    Register kind**.
  - Requirements: `official` and `scorer` need only `child_protection`. `schooladmin`,
    `sportsadmin`, `directorofsport`, `principal`, `media` and `scout` need nothing.
  - `clearance_expiry_within_reason` allows up to 1,827 days (five years).
- **The policy:**
  - "All adult coaches, administrators, technical officials" must be cleared against
    the Sexual Offences Register and the Child Protection Register "every 24 months",
    and have a criminal check every 24 months (p19).
  - Anyone working "more than 5 days in a 3 months cycle" needs the Sexual Offences
    Register check, with a certificate "not older than 24 months" (p24).
  - The Child Protection Register check is the same (p25).
  - The criminal check must be "not older than 6 months" at the start, then re-checked
    every 24 months (p26).
  - Service providers working more than a week need the Sexual Offences Register and
    a criminal check (p35).
- **Smallest change (one migration, Opus):**
  1. Add the kind `sexual_offences_register`.
  2. Add requirement rows: all three checks for every adult coach, administrator,
     official, scorer, medical, driver, transport coordinator, media, scout and
     facilities role.
  3. Add a per-kind maximum age: 24 months for the three checks, and a police
     clearance no older than 6 months when first recorded.
  4. Leave existing rows alone. They lapse on their own dates.
  5. A pupil holding `scorer` is not an adult. The register should not show him as
     "missing" (the requirement is for adults, p19).

  The new safeguarding kinds are SG-7.
- **Built 2026-09-28:** `db/56_clearance_csa.sql`, K4 with SG-7's kinds (SCRBRD-116). Existing rows lapse on their
  own dates; nothing that blocks a trip refuses more from the paste.

### K5 · Emergency contacts are released by role, not by a DSO's decision

- **Where:** `capabilities.mjs` `player.emergency.read`, held by coach, assistant
  coach, team manager, medical, director of sport, school admin and transport
  coordinator; `trip_contacts()` (`db/08` ~4724, `db/41`: the named driver, inside a
  window around the trip); `STEP4_parent_pupil.md` P7a ("the coach on the bus, the
  team manager, the physio, the driver on the day").
- **The policy:** "You may not give addresses and telephone numbers of guardians or
  children to anyone … unless it is in the best interest of the child to do so and
  this decision must be made by the DSO" (p52, item 8).
- **How far apart they are:** the substance agrees. Every release is for the child's
  safety, and addresses stay with the office (`player.pii.read`). What is missing is
  the DSO's decision.
- **Smallest change:** no code. The school's DSO approves the list of roles that
  reach emergency contacts once, when the school goes live, and again whenever it
  changes. The approval is recorded as a dated line in the school's DSO register
  (SG-1). P7a already shows parents who can see the numbers.

### K6 · A trip with children is not cleared by a DSO

- **Where:** `trip`, `vehicle`, `trip_driver_cleared()` and `trip_vehicle_fits()`
  (`db/08` ~2753–2830, ~4997); STEP4 P3 (the bus card).
- **The policy:** "every trip or tour, no matter whether it is a day trip or longer …
  must be cleared by either the club DSO or the tour DSO" (p45). If a child is on it,
  Annexure F goes to the NDSO, completed "2 DAYS BEFORE TRIP" (p76). The transport
  policy puts the vehicle and driver checks on the DSO too (p46).
- **Smallest change:** a `cleared_by` / `cleared_at` pair on the trip, written by a
  DSO (SG-1). The coordinator's screen shows "not yet cleared by the DSO". Whether an
  uncleared trip is refused or only warned about is Question 11. The Annexure F
  checklist is SG-11. Tier: Opus (migration), then Sonnet (screen).

---

## 3. Agreements

Short, because these need no action.

- **Who is a child.** CSA: under 18 (p9). SCRBRD: `majority_on(born)`, C6, option C.
  CSA also names "young adults" over 18 as a vulnerable group (p12, p20). That supports
  keeping a parent involved while an 18-year-old is still at school (SCRBRD-083 §6,
  SCRBRD-110 §7.4).
- **No photos in public** (PUBLIC_DATA A8; SCRBRD-083 §1.9, §5.3; STEP4 monogram).
  This is stricter than CSA, which allows photos with consent. Rule 5 on p34 forbids
  publishing any child's "photo, video, name or personal details … in a public forum
  such as in a mass media or web-based medium" unless the child is your own.
- **Names only by consent, initial and surname, no page per player, `noindex`**
  (PUBLIC_DATA §1). This keeps to the spirit of the Media Policy's aim that children
  be "protected from exposure through media" (p32). It also keeps to the list of
  forbidden interview questions (where he lives, school, grade, p32): a stranger
  cannot search for him or join his records together. Question 7 raises the one edge:
  a public page does show his school and age group.
- **Never public N1–N5.** Health, discipline, contact, home and identity match p52:
  "Sharing of personal information about children and their families is forbidden".
- **The never-public mark (C5)** covers the wards of court and Children's Court cases
  CSA says may not be photographed (p33). SCRBRD-092 already lets the mark override
  every media consent.
- **The medical tiers and ADR 0002.** Staff who need it see medical needs (p52 items 5
  and 6). The coach gets an overview, and the physio's notes stay with the physio.
  Clinical data is held apart, as "a safe and secure place, inaccessible by
  individuals other than appropriately authorised employees" (p52 item 2).
- **SCRBRD-110's parent share.** CSA allows sharing a child's personal information
  with "the child's parents or guardians or the club's designated DSO" (p52 item 7).
  The share is a recorded act by the coach or physio, to a verified guardian, and
  logged. Team-mates never see the data, which matches p52 item 6.
- **SCRBRD-110 and "physical abuse".** CSA's definition includes "age-inappropriate or
  physique-inappropriate training loads; when injured or in pain" (p10). The age-band
  directive, the breaches, the flag that never marks a boy injured, and personal
  limits all serve that definition. SG-12 adds one route to the DSO.
- **The disciplinary record (db/25)** fits CSA's "document complaints of bullying"
  (p41):
  - authorship is fixed and the outcome belongs to the school;
  - every read is logged;
  - parents do not hold `discipline.read` (STEP4 Q5), which matches p38, where the DSO
    decides whether telling parents would harm the child.
- **Adult clearances exist**: the register, never edited, revocable with a reason; a
  lapsed driver cannot take a side. Vehicle insurance and roadworthy dates are checked.
  K4 widens this but does not replace it.
- **The access log and pointer-only push** go beyond what CSA asks. They are what a
  DSO will need to answer "who saw this".
- **Backfilled records are signed-in only** (SCRBRD-099). Old boys and current pupils
  are not published from a photo of a scorebook.
- **AI commentary** sends no name to the provider and filters out physical and health
  words (SCRBRD-083 §4.1). SG-10 adds a tone check.

---

## 4. What the policy adds

Each item is a proposed backlog entry. The `SG-n` labels are placeholders until the
items get SCRBRD numbers. Tiers follow CLAUDE.md: Opus for policy, RLS and minors'
data; Sonnet for screens over an existing API.

### 4.1 The Designated Safeguarding Officer (decided: SCRBRD will have them)

#### What the policy requires of a DSO

- **Appointment.**
  - Every club "must appoint a Designated Safeguarding Officer". The chairperson
    appoints and informs the NDSO (p17).
  - The DSO completes a SASCOC-accredited course through The Guardian (p22), and the
    training is annual (p19).
  - CSA names at least two NDSOs, "preferably one man and one woman" (p15).
  - Provinces appoint PDSOs, and PDSOs appoint DDSOs to help clubs (p22).
- **Duties that touch the platform:**
  - being the point of contact for reports;
  - investigating allegations;
  - informing the NDSO "if there are any allegations that may in any way lead to the
    registering of a criminal offence", and ensuring they reach the authorities
    (p17–18);
  - making sure every member can report anonymously (p18 k);
  - checking clearances, the SAC and declarations of good standing (p17 a–c);
  - clearing trips (p45) and authorising media (p32, p73);
  - deciding who gets contact details (p52);
  - searching and handling drug matters (p37–38).
- **Reporting a concern:**
  - A disclosure goes "as soon as possible to the DSO". The person who heard it
    completes Annexure A "within 24 hours" (p27).
  - "Under no circumstances may details of the abuse be divulged to any person other
    than the DSO unless the transference of this information will benefit the child
    directly" (p27).
  - The DSO reports child abuse to SAPS (p27). The DSO informs the NDSO within 24
    hours, and that report carries only the child's "gender …, age …, nature of abuse
    and where abuse happened. No other details may be disclosed" (p27).
  - All staff and volunteers are legally bound to report to SAPS, the NDSO and The
    Guardian (p30).
  - Anonymous reports must "receive attention within 72 hours", and CSA points
    athletes to The Guardian's Anonymous Reporting App (p53).
- **Interim protection:** if a child complains of sexual harassment, "the DSO must
  immediately suspend all interactions between the suspect and the club pending the
  outcome of a disciplinary enquiry" (p42).
- **Recording:** Annexure A (p66–68) records:
  - the reporter: name, contact, relationship, and how they learned of it;
  - the victim: name, age, contact, and whether an athlete, staff, volunteer or
    official;
  - the nature: psychological, physical, sexual harassment, sexual abuse, neglect,
    bullying or other;
  - date, time and place;
  - the alleged harasser, if known;
  - whether it is a suspicion or recognised abuse;
  - an account "with as much accurate detail as possible";
  - any authorities already told.
  The flow chart asks for statements "verbatim" (p29).
- **Who may see a concern:** the form is "STRICTLY CONFIDENTIAL and only for use by
  the club DSO or any person they deem would be able to assist the victim or" the NDSO
  (p68). The identity of a whistle-blower "may not be disclosed without their consent"
  and is "accessible only to the club's DSOs", who share "on a 'need to know basis'"
  (p63).
- **Keeping it:**
  - Information suggesting that someone in a position of trust is unsuitable is kept
    "for as long as the participant remains active in the sport or for 5 years,
    whichever is longer", even when no formal proceeding followed (p64).
  - That information may go to the safeguarding officer of another sports body when
    the person applies there and the DSO judges it necessary (p64).
  - "Any other records relating to other complaints will be retained for a period of
    3 years" (p64).
- **Who may not see it:** everyone else. That includes the coach who is told about it
  only when the DSO judges he must be (p52 item 5), the parent where the DSO decides
  telling would harm the child (p38), and anyone the concern is about.

#### SG-1 · A DSO role at school level

- **Priority:** P1, design first.
- **Tier:** the design pass is Opus under CLAUDE.md today; Question 2 asks whether it
  should join Fable's list. The build is Opus for roles, RLS, migrations and tests,
  then Sonnet for screens, with Opus review.
- **What:** a role `dso` in `roles.mjs`, school-scoped (also club or academy scoped).
  - **ADR 0003:** it passes both tests. It needs different data access, since no
    existing role should read concern records. It needs different approval authority:
    trip clearance, media and stream authorisation, the emergency-contact decision
    (K2, K5, K6).
  - **Capabilities (working names):**
    - `safeguarding.concern.read` and `safeguarding.concern.manage`, level 4;
    - `safeguarding.media.authorise`;
    - `safeguarding.trip.clear`;
    - `safeguarding.suspend` (SG-4);
    - `player.public.withhold`, which the DSO should hold (C5 is a safeguarding
      mark);
    - `clearance.read` and `clearance.manage` (p17 a–c);
    - `player.pii.read`, `player.emergency.read` and `player.age.read` at the school,
      because a DSO must be able to reach a family.
  - **Appointment:** by the principal (the school's "chairperson"). Add it to
    `GRANTABLE_ROLES.principal`, not the office's.
  - **Several DSOs** per school are allowed, so a child can go to a man or a woman
    (p15's instinct for the NDSO; p37's same-sex DSO for a search).
  - **Clearances:** a DSO needs the three checks, the SAC and the annual DSO course
    (SG-7).
  - **Visible to everyone:** every signed-in person sees their school's DSO name and
    how to reach them (p18 i, p19), and the link to The Guardian's app (SG-6).
- **Also holds:** a small **DSO register** per school. It records the emergency-contact
  role list the DSO approved (K5), stream authorisations (K2) and trip clearances (K6),
  each dated and signed by a person.

#### SG-2 · Raise a concern, and route it to the right DSO

- **Priority:** P1, in the same design pass.
- **Tier:** Opus (functions, RLS, notification), then Sonnet (the form).
- **Who can raise one:** anyone signed in, whatever their role, including a pupil and
  a parent. It is a `SECURITY DEFINER` function any signed-in user may call, not a
  capability that some bundle might forget. People who are not signed in use The
  Guardian's app or phone (SG-6).
- **What the form asks:** Annexure A's fields, minimised.
  - The child is picked from people the reporter can already see, or described in
    words.
  - Contact details come from the player record for the DSO. They are not typed
    again.
  - "What happened" is free text, with a prompt to use the child's own words (p29).
  - The reporter may tick "about an adult at this school" or "about the DSO".
- **Routing:**
  - The default is the school's DSO or DSOs.
  - A concern about an adult with authority at the school (principal, director of
    sport, the office) also goes to the PDSO.
  - A concern about the DSO goes to the PDSO only.
- **Telling the DSO:** one `notification` per recipient, using SCRBRD-110's
  `recipient_id`. It carries no name ("A safeguarding concern has been raised. Open
  SCRBRD to read it."), and the push is a pointer, as always.
- **Clocks the screen shows:** 24 hours from disclosure to the form (p27); 24 hours
  from the DSO receiving it to the NDSO referral (p27); 72 hours for an anonymous
  report (p53).
- **What the reporter gets back:** "Received — the DSO has it", the same shape as the
  umpire's "Recorded — the school has it" (db/25). He cannot read it back and cannot
  see its state.

#### SG-3 · The concern record, apart from discipline

- **Priority:** P1, design.
- **Tier:** Opus.
- **Its own tables:** `safeguarding_concern`, plus a notes/actions log. It is **never**
  a `disciplinary_record` row. `discipline.read` is held by `competitionadmin` across
  every school, and `discipline.write` by a one-fixture umpire. A concern that landed
  there would be read by exactly the wrong people.
- **Reads:**
  - only `safeguarding.concern.read` in scope;
  - a `RESTRICTIVE` policy removes it from every support session (as SCRBRD-110 §6.5
    does);
  - Question 9 asks whether the masterkey reads it;
  - every read goes on the access log.
- **Hiding the log itself:** the log rows are hidden from ordinary `audit.read`
  holders (principal, director of sport, office). If they could read the log, the log
  would itself say that a concern exists. Only DSOs and the PDSO can read those rows.
- **Sharing on need to know (p52 item 5, p63):** the DSO can share part of a concern
  with a named person. That is a recorded act with an expiry, the same pattern as
  `wellness_share`. There is no standing permission.
- **Whistle-blower identity (p63):** stored apart and shown only to DSOs, with a
  "reporter asked not to be named" flag.
- **Retention (p64):** a concern flagged "about a person in a position of trust" is
  kept for the longer of five years and the subject's last active assignment anywhere
  on the platform. Other concerns are kept three years from closing. Then a logged
  purge, like SCRBRD-110's `health_purge_log`. Question 8 raises the case of a child
  victim.

#### SG-4 · A DSO can suspend an adult pending an enquiry

- **Priority:** P1.
- **Tier:** Opus.
- **What:** p42 requires immediate suspension where a child complains of sexual
  harassment. SCRBRD already has `duty_suspension` (db/34, db/35): an open row makes
  an assignment grant nothing. Add a **safeguarding suspension** with these rules:
  - the DSO sets it;
  - it covers every assignment the person holds at the school;
  - its reason is held in the concern, not on the suspension;
  - the office and the person see only "suspended by the DSO";
  - the DSO lifts it with a second recorded act.
- **Also:** the suspended person's pending trips and duties show "driver needed" or
  "coach needed", never why.

#### SG-5 · Provincial and national DSOs

- **Priority:** P2.
- **Tier:** Opus.
- **What:** a PDSO or DDSO is a `dso` assignment at a `union` tenant, and the NDSO is
  one at the `federation` tenant (`school.kind` already has both; `school.province`
  exists). They do **not** read schools' concern records.
- **A school's DSO refers:** one `safeguarding_referral` row, addressed to the union
  or federation, carrying only what p27 allows: the child's gender, an age band, the
  nature and where it happened. It also carries the school, the date, and a link the
  PDSO can use to ask the school's DSO for more.
- **The PDSO also receives** the concerns SG-2 routes to them directly: about the DSO,
  or about school leadership. For those they are the DSO.
- **Tour DSO:** a `dso` assignment scoped to a fixture or season (p45, "the tour
  DSO").

#### SG-6 · Anonymous reporting: point to The Guardian's app

- **Priority:** P1.
- **Tier:** Sonnet.
- **What:** CSA requires every member to be able to report anonymously and names The
  Guardian's Anonymous Reporting App (p19, p53). A report made inside SCRBRD is not
  anonymous: the platform knows who is signed in, and the access log says so.
- **So:** a "Report anonymously" link to The Guardian's app on every home screen, next
  to the DSO card. The in-app route (SG-2) says honestly that it is *named* but
  confidential. Question 10 asks whether SCRBRD should ever build its own anonymous
  channel.

### 4.2 Vetting, codes of conduct and training

#### SG-7 · Safeguarding kinds in the clearance register

- **Priority:** P1 (with K4's migration).
- **Tier:** Opus.
- **What:** add these kinds to `adult_clearance`:
  - `safeguarding_awareness`: the SAC, which every coach and every person working
    within CSA must hold, "renewed annually" (p11, p20, p22);
  - `dso_training`: annual (p19, p22);
  - `good_standing_declaration` (p17 c);
  - `safeguarding_acknowledgement`: Annexure G, signed "before they can work,
    volunteer or assist in any way" (p65, p82), and the Code of Ethics signature (p17);
  - `references_checked`: two traceable references, contacted by the DSO (p23).
- **Requirement rows** follow CSA: the SAC for every adult role that meets children,
  and the acknowledgement for everyone.
- **What is recorded:** as today, that a named person saw the document, its reference
  and its date, never a scan.

#### SG-8 · The policy documents, visible

- **Priority:** P3.
- **Tier:** Sonnet.
- **What:** the school's safeguarding policy, code of conduct and code of ethics must
  be available "online or in hard copy for anyone to view" (p19). The school sets
  links to them in Settings, shown beside the DSO card. No documents are stored.

### 4.3 Contact between adults and children

#### SG-9 · Rules for any messaging, before `up9` is designed

- **Priority:** P2, as a design constraint.
- **Tier:** Opus design, then Sonnet.
- **The policy is silent here.** These rules come from its principle that no
  photographer or service provider is ever alone with a child (p34 rule 6, p35), and
  from its concern with "malicious SMS", "cell phones" and online abuse (p9, p39).
- **Where things stand:**
  - Today SCRBRD has no messaging. Team notices go to a whole side
    (`news.publish.team`), and pushes carry a pointer.
  - The roadmap's `up9` plans "secure one-to-one between coach and parent" (adult to
    adult).
  - SCRBRD-110 adds `notification.recipient_id` for staff-to-staff referrals and for
    the parent share.
- **Proposed rules:**
  1. No private channel between an adult and a pupil. A message from a coach to a
     pupil goes to a team, or to the pupil **with his guardian copied**.
  2. `recipient_id` may name an adult or a guardian. It never names a pupil, unless
     the notice is the system's own (his own flag acknowledged, a share made about
     him). A test asserts this.
  3. Every message is kept and can be opened by a DSO on a concern (SG-3), logged.
  4. A pupil can report any message to the DSO in one tap (SG-2).
  5. No photos in messages until SCRBRD-092 exists.

### 4.4 Media

#### SG-10 · Consent to being filmed, and a tone check on AI lines

- **Priority:** P2 (before SCRBRD-104 lifts its block).
- **Tier:** Opus.
- **Consent to being filmed:** CSA requires parental consent for "any image being
  captured" under 18 (p34 rule 8), and the child's own from 12 (rule 7). SCRBRD-092's
  consent screen gains a separate opt-in, "filmed and streamed at matches", on K1's
  two-record pattern. The school uses it to decide whom its camera may show. SCRBRD
  cannot enforce the camera, but it can tell a DSO before a streamed fixture how many
  children in the squads have not agreed. It gives a count, never names.
- **A tone check on AI lines:** images may be reproduced only "as a positive story …
  which will do no harm to the child" (p71), and mocking is bullying (p39).
  SCRBRD-083 §4.1's discard filter gains a short list of derisive words about a
  labelled player ("shocker", "howler", "embarrassing" …). The prompt forbids them too.

#### SG-11 · The trip checklist

- **Priority:** P3.
- **Tier:** Opus (migration), then Sonnet.
- **What:** Annexure F (p76–81) as a checklist attached to a trip that carries
  children, for tours and overnight stays, completed by the tour DSO and sent to the
  NDSO referral inbox (SG-5) two days before.
- **Vehicle items CSA adds (p46):**
  - the driver's licence is more than five years old;
  - the insurance covers business use;
  - the vehicle is registered with a breakdown service;
  - there is a first aid kit.
  Each is a nullable fact on `vehicle` or `adult_clearance`, shown as unknown until
  recorded.

### 4.5 Health, incidents and collection

#### SG-12 · Serious incidents and workload patterns reach the DSO

- **Priority:** P3.
- **Tier:** Opus.
- **Serious incidents:** a serious incident ("Death, serious injury, physical abuse,
  or sexual abuse") goes "immediately to the DSO" (p51). When an `injury` is recorded
  with emergency services called or the most serious severity, the DSO gets one
  notice (no name in the push).
- **Workload patterns:** CSA counts inappropriate training loads as physical abuse
  (p10). SCRBRD-110's flag may be referred to the DSO as well as to the director of
  sport. A pattern also sends one notice to the DSO: a second directive breach for the
  same boy within 28 days, or a flag unanswered after 72 hours.

#### SG-13 · Who may collect a child

- **Priority:** P3, and only if schools ask.
- **Tier:** Opus.
- **What:** only a parent or guardian may fetch a child. Anyone else needs two hours'
  notice with "name, ID number and relationship" (p43). A guardian could record a
  one-off alternative collector against a trip's return. But this puts a third
  party's ID number on the platform (level 4). Recommendation: do not build it until a
  school asks. Instead, show the return time and the rule on the bus card.

---

## 5. Questions for Kameel

**Decided (Kameel, 2026-09-27): every recommendation below** ("all recommendations for the safeguarding
questions"), and Q2 as **Fable's list** — safeguarding joined it in `CLAUDE.md` the same day. So: CSA's policy
is the baseline for every tenant; a coach learns nothing of a concern by default (need-to-know shares, recorded,
expiring); parents have no standing access; concerns about staff or leadership also route to the provincial DSO,
are hidden from ordinary audit readers, and a principal cannot remove a DSO while a concern naming the principal
is open; a pupil of 12 or more may take his own text name off public pages; school and age group stay on public
pages (noted for the officer); CSA's retention periods are minimums (the officer is asked about the victim case);
no masterkey or support read of concerns; no in-house anonymous channel (link to The Guardian's app); uncleared
trips warn now and refuse once every school has a DSO; pupils lose `medical.status.read`; p52 and p63 read as the
child's file and safeguarding records, written into PUBLIC_DATA for the officer to confirm.


1. **Adopt the CSA policy as the platform's baseline for every tenant**, schools and
   clubs alike? *Recommendation: yes.* PUBLIC_DATA C7 already treats clubs and schools
   the same, and school cricket runs through CSA's unions and events. A school's own
   policy (or the Department of Basic Education's) can add to it but not go below it.
2. **Which tier designs the DSO work (SG-1 to SG-5)?** Under CLAUDE.md today it is
   Opus: authorization, privacy, and minors' disciplinary-grade data. *Recommendation:
   add it to Fable's list.* It touches roles, RLS, notifications, the access log,
   support access, retention and cross-tenant routing, and a wrong model would be
   expensive to unwind. A design pass comes before any build either way.
3. **Confidentiality from coaches.** Does a coach learn anything when a concern is
   raised about a boy on his side? *Recommendation: no, not by default.* The DSO
   shares on need to know, as a recorded act with an expiry (SG-3; p27, p52 item 5,
   p63). A coach who raised the concern sees only "received".
4. **Parents' access to a concern about their child.** *Recommendation: no standing
   read.* Guardians never hold `safeguarding.concern.read`. The DSO decides when and
   how to tell them, and records it. The DSO may decide not to, where telling would
   harm the child, and then refers to Social Development and the NDSO (p38). No
   automatic notice goes to a parent, not even "something was raised".
5. **A concern about a staff member, including leadership.** The principal appoints
   the DSO and holds `audit.read`. The director of sport holds `discipline.write` and
   `audit.read`. *Recommendation:*
   - route any concern about an adult with authority at the school to the PDSO as
     well (SG-2), and one about the DSO to the PDSO only;
   - hide concern rows and their access-log rows from ordinary `audit.read`;
   - the DSO's suspension (SG-4) says "suspended by the DSO" and nothing more;
   - the principal cannot end a DSO's appointment while a concern naming the
     principal is open. The PDSO can.
6. **A pupil's own "no" to his public name before 18.** K1 adds a pupil's assent from
   12 for images and video. Should a pupil of 12 or more also be able to take his
   **text** name off public pages? *Recommendation: yes, a "no" only.* It fails
   closed, as option C does for a parent after 18. His "yes" is still not needed for
   text names, because CSA asks for it only for images, video and interviews.
   PUBLIC_DATA C1 and C4 would change, so this is your call.
7. **School and age group beside a named child.** CSA forbids a journalist to ask a
   child "What school do you attend?" or "What grade are you in?" (p32). A public page
   shows "D Erasmus", the school and "U15". *Recommendation: keep it.* In school
   cricket the school is the team, an age group is not a grade, and the rule already
   blocks search, per-player pages and cross-match linkage. Ask the information officer
   to note it when confirming PUBLIC_DATA.
8. **How long to keep a concern.** CSA: a position-of-trust concern is kept for the
   longer of five years and the person's time active in the sport; other complaints
   three years (p64). *Recommendation: adopt CSA's periods as minimums.* Also ask the
   information officer whether a concern where a child was the victim should be kept
   until at least three years after the child turns 18, so that it still exists when
   he can act on it as an adult. Deletion is logged.
9. **Does the masterkey read concerns?** `superadmin` holds every capability, so it
   would. *Recommendation: no.* Exclude `safeguarding.*` from the masterkey. Give
   support sessions the same `RESTRICTIVE` exclusion SCRBRD-110 uses. Where access is
   ever needed, the NDSO is the route, not the operator.
10. **Anonymous reporting.** *Recommendation: link to The Guardian's app (SG-6) and do
    not build an anonymous channel.* SCRBRD cannot make a signed-in report anonymous
    without weakening the access log. CSA names that app, and The Guardian is CSA's
    partner.
11. **An uncleared trip: refuse or warn?** *Recommendation: warn now, refuse later.*
    Show "not cleared by the DSO" from launch. Refuse departure (`trip_mark`) once
    each school has appointed a DSO. The driver guard's "missing does not refuse" rule
    reasons the same way.
12. **Pupils and team-mates' injuries (K3).** Withdraw `medical.status.read` from
    `player`? *Recommendation: yes.* It follows N2, which SCRBRD already holds, and
    p52. A pupil learns the side from the team sheet.
13. **How to read "personal information … is forbidden" (p52) and "accessible only to
    the club's DSOs" (p63).** Read literally, they forbid team sheets and scorecards.
    *Recommendation:* read p52 as covering the child's file (contact, home, identity,
    health, family: N1–N5), and p63 as covering safeguarding and enquiry records. Say
    so in PUBLIC_DATA and have the information officer confirm it.

---

## Appendix · Where each finding comes from

| Topic | Policy (page) | SCRBRD |
|---|---|---|
| Definitions: child, adult, young adult, DSO, NDSO/PDSO, SAC | p9, p11, p12 | `majority_on()`, PUBLIC_DATA C6 |
| Physical abuse includes inappropriate training loads | p10 | SCRBRD-110 |
| Clubs' duties: clearances every 24 months, anonymous reporting | p19 | `db/08` clearance register |
| DSO appointment and duties | p15–18, p22 | none yet (SG-1 to SG-5) |
| Recruitment, SOR, CPR, criminal checks | p23–26 | `db/08` ~4794 |
| Reporting abuse: 24 hours, NDSO minimum data, SAPS | p27–30 | none yet (SG-2, SG-5) |
| Media and interviews | p32–33, Annexures B/C p69–73 | PUBLIC_DATA, SCRBRD-083, -092, -104 |
| Photography | p34 | A8, SCRBRD-092 |
| Service providers | p35 | clearance register |
| Anti-bullying; sexual harassment | p39–42 | db/25; SG-4 |
| Child collection; travel; transport | p43–46, Annexure F p76–81 | `trip`, `vehicle`, `db/41` |
| Incidents | p51, Annexure E p75 | `injury`; SG-12 |
| Protection of information | p52 | tiers, K3, K5 |
| Anonymous reports | p53 | SG-6 |
| Discipline vs punishment | p61–62 | db/25 (outcomes are the school's) |
| Confidentiality; retention | p63–64 | SG-3 |
| Acknowledgement of regulations | p65, Annexure G p82 | SG-7 |
