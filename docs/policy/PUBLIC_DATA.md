# What the public may see about a child (SCRBRD-083)

Status: **decided** by Kameel, 2026-09-25, scenario by scenario on the decision sheet
(https://claude.ai/artifact/UvkiCMwk8hDZ9xXAh5Zs2o, 31 of 31 answered). This is the
rule every public page is built against. Nothing public exists yet.

"Public" means **signed out**: anyone with the link, including people who are nobody
the platform knows. Everything here is about pupils. Adults doing a public job (umpires,
scorers, coaches named on a fixture) are outside this rule.

**Before any public page goes live**, the school's information officer confirms this
rule against POPIA. The Act treats a child's personal information as special, and the
ground for publishing it on these pages is the prior consent of a competent person.

---

## 1. The rule

1. **Off until switched on.** A fixture, a competition page or an overlay is private
   until its school publishes it (L1, A1).
2. **Each school speaks for its own children.** A child appears in public only under
   his own school's settings and his own consent. A side whose school is not on the
   platform is never named, and nor is a name the scorer typed in (L5, L6).
3. **No name without consent.** A child is named in public only when consent is
   recorded for him (C1), and never while he carries a never-public mark (C5).
   Before consent is recorded he is a position: "Batter", "Bowler" (C2).
4. **Initial and surname, never more.** A consenting child is shown as "D Erasmus".
   A full name, a first name alone, a photo or a date of birth is never shown (L2, A8, N1).
5. **Some things are never public**, whatever the consent (§3).
6. **A "no" is immediate and reaches the past.** Withdrawn consent or a never-public
   mark changes every public page at once, finished scorecards included (C3).
7. **Findable by link, not by search.** Every public page tells search engines not to
   index it (D1).

## 2. Surface by surface

| Id | Surface | Decision |
|---|---|---|
| L1 | Team names, score, result on the live page | Public once the school publishes the fixture |
| L2 | Batters' and bowler's names on the live board | Initial and surname, only for a child with consent; otherwise "Batter" / "Bowler" |
| L3 | Ground and time while the match is on | Shown; names follow L2 |
| L4 | Ball-by-ball commentary and dismissals | Same rule as L2 |
| L5 | The other school's players | Each side named only by its own school's rule; a side not on the platform is never named |
| L6 | A name the scorer typed in | Never named publicly: shown as a position. *Note: "limited information about a player is available to a stranger."* |
| L7 | Shot maps and wagon wheels | Team-level only on public pages |
| A1 | Results and standings | Public |
| A2 | Full scorecards after the match | Same name rule as L2 |
| A3 | Leaderboards across a competition | Not public |
| A4 | A public page per player | Never |
| A5 | The honours board | Only honours marked public (`honour.is_public`), names by the L2 rule |
| A6 | Milestones (fifty, five-for) | **Automatically on the live page, under the L2 rule** (the one answer that differs from the recommendation, which was news posts only) |
| A7 | Team sheets before the match | Not public; the school's own channels. *Note: "Opposing schools will have access to each other's team squads 5 days prior to their head-to-head fixtures."* See §5. |
| A8 | Photographs of pupils | None on public pages. *Note: photo and video sharing will come later, for registered users only.* |
| D1 | Search engines | Public pages are not indexed |
| D2 | The stream overlay (built) | Brought under the L2 consent rule |
| D3 | A live link shared on WhatsApp | Expected; the page shows only what this rule allows |
| D4 | News posts naming pupils | News stays signed-in for now |

## 3. Never public (N1–N5)

No setting and no consent makes these public:

- **Date of birth and exact age.** The age group ("U15") stays.
- **Health:** injury, illness, and why a boy is not playing, including the bare word
  "unavailable".
- **Discipline:** any reference to a conduct matter.
- **Contact, home and identity:** address, phone, email, guardian, ID number,
  hometown, boarding house, height, weight.
- **Judgements:** coaches' notes, skill ratings, scouting interest.

In the policy package this is a list of table columns, checked by a test against every
column the tables mask (`packages/policy/src/tables.mjs`). A newly masked column has to
be placed on the list, or the test fails.

## 4. Consent (C1–C7)

- **C1 Who:** a verified guardian, recorded per child. The school may record it from
  its own admission forms, naming the form and the date. This is a consent of its own,
  separate from the guardian-link consent that governs processing at all.
- **C2 Before anyone decides:** not named.
- **C3 Withdrawal:** takes effect everywhere at once, past pages included. The record
  of the consent is end-dated, never deleted.
- **C4 Age groups:** the same rule at every age. A school can also switch names off for
  any age group it chooses (the overlay's `name_display = 'none'` already does this for
  one fixture).
- **C5 A child who must never appear:** a never-public mark that authorised staff can
  set. It overrides every consent, and no page shows or records the reason.
- **C6 Turning 18:** his own consent counts from his birthday. Until he gives it, his
  guardian's stands.
- **C7 Clubs:** the same rules as schools.

## 5. Open

- **The opposition window (A7 note).** The note says opposing schools see each other's
  squads 5 days before their fixture. The opposition dossier that is built (signed-in,
  cross-school: squad and figures) opens **14 days** before (`opposition_window_days()`
  in `db/08`). One number has to be chosen: 5 for everything, or 5 for the squad and
  14 for the figures. This is not a public-page question and does not block §1–§4.

## 5a. How the rule reads in code (`packages/policy/src/public.mjs`)

Encoded 2026-09-25. Where the decisions above left a gap, the code takes the reading
below. Each is a product call Kameel can overturn; the code changes with it.

- **Consent is judged on the day a page is served, not the match day.** That is what
  makes a withdrawal reach past scorecards (C3). It also means a consent recorded
  today names a boy on his old scorecards, and that pages carrying names cannot be
  cached past the day.
- **The latest record governs.** If two guardians disagree, the later one decides, and
  a "no" is never outvoted by an earlier "yes".
- **At 18 (C6):** once he has given his own record, only his records count, so his
  "no" beats a guardian's standing "yes". A record he made before 18 counts for
  nothing. No date of birth reaches the public read: the database works out
  "he was 18 that day" and passes only yes or no (keeping N1 true).
- **A boy playing up an age group (C4):** if either his own age group or the side's
  has names switched off, he is not named.
- **Never public, beyond §3's words:** bowling-workload breaches (a record about a
  boy's body), the reason colours were withdrawn (can be a conduct matter), and a
  pupil's login email and a guardian's list of linked children.
- **Names:** the formatter guesses the surname from the full name. It is wrong for a
  two-word surname with no particle ("Maria Santos Silva" → "M Silva") and for a
  name stored surname-first without a comma ("Khumalo Sipho" → "K Sipho", which
  shows a first name). The step 2 migration adds a stored surname so nothing is
  guessed.
- **Not covered by this rule yet:** a pupil who scores (the rule treats scorers as
  adults) — his name as an official needs the same consent.

## 6. What has to be built before the first public page

1. **The rule in code:** `packages/policy/src/public.mjs`, pure, with tests (the
   never-public list against `tables.mjs`, the name rule's every branch). Every public
   read calls it; no screen decides.
2. **The records it reads (a migration, Opus):** per-child public-name consent (C1,
   versioned and end-dated, with the guardian or the pupil at 18 as the giver); the
   never-public mark (C5, reason held away from every page); a school's per-age-group
   switch (C4); a publish flag per fixture and competition (L1, A1).
3. **Signed-out reads** that apply the rule on the server, never in the browser, and a
   `noindex` on every public page.
4. **The overlay brought under the rule** (D2).
5. **The information officer's confirmation** of this document.
