# The guardian's terms, version `popia-2026-01`

**Status:** Approved 2026-11-05 (Kameel, Build Board: 'Text approved; all eight as recommended'). Written by Fable.
**Read, and nothing else:** `docs/design/GA-I20_parent_action_list.md`, `READERS_child_data.md`, `docs/policy/SIGNIN_PRIVACY_NOTICE.md`, `docs/policy/PUBLIC_DATA.md`, `ACCOUNT_LIFECYCLE.md`, `ACCESS_REQUESTS.md`, `SAFEGUARDING_DSO.md` (the family parts), `NOTIFICATIONS.md`, `STEP4_parent_pupil.md`, `SCRBRD-140_signup_and_school_linking.md`, `INCIDENTS_AND_BREACHES.md` §3.4–4.5, `apps/web/src/lib/guardianLink.js`, `db/08_schema_programme.sql` (`guardian_link_verify`, `guardian_consent_record`, `guardian_consent_withdraw`, `player_guardian_status`, `match_squad_is_registered`), `db/62` header. All at `origin/main` on 5 Nov.
**The rule I wrote to:** every sentence promises something a design decided or the code does. A promise the system does not keep is a POPIA risk; so is leaving out something it does. §2 traces each sentence; §3 lists what only Kameel can settle. Three facts from the reading I could not make a safe sentence of are in §3, not in the text.

---

## 1 · The terms, as a parent reads them on a phone

*About 700 words of body against the brief's aim of 600. Every sentence traces (§2); the hundred over the aim is the readers list and the rights, which I would not cut without Kameel choosing what a parent is not told. Two candidates if he wants it shorter: the scorebook-photo sentence and the support-staff sentence (both true, both rarely asked about).*

> ### The school's terms for your child on SCRBRD
> *Version popia-2026-01*
>
> You agree for **one child, at one school**, on your own link to him. The school is responsible for his record; SCRBRD runs the app for it. His other parent agrees for herself.
>
> **What we keep about him**
> His name, date of birth, team, playing role and age group. His ID number, address, phone, email, boarding house, height and weight, where the school records them. Every ball he faces or bowls. His availability answers and the reason given. Team sheets, honours, injuries and treatment, bowling load, coaches' skill ratings and notes, conduct records, the people to ring if he is hurt, lifts, notices about him, and who has looked at his record. A photo of a paper scorebook page naming him is kept 30 days to check the import.
>
> **Why**
> To run the school's cricket: pick sides, score matches, keep him safe and well, and keep in touch with you. If he has his own sign-in, the same agreement covers his account.
>
> **Who can see it, and who never can**
> You, his other parent and the boy himself. His coaches and team staff: his side's details, whether he is fit and what is wrong, his bowling load. The office, director of sport and principal: his file. The physio: his health in full. The coach, team manager, physio and, on the day, a lift driver: the numbers to ring. Team-mates and their parents: his name on the sheet and scorecard, nothing more. The other school's coaches: his named squad and figures for five days before a fixture, logged. Scouts: only with your yes. Neither you nor he sees his coaches' notes; he sees his ratings and you do not; conduct matters reach you the school's own way, not in the app. SCRBRD's support staff read him only to help the school, as a school role, an hour at a time, logged.
>
> **What is public, and what never is**
> Nothing until the school publishes a match; then team scores and results. His name on a public scorecard is an initial and surname, only if you separately say yes; until then he is "Batter" or "Bowler". From twelve he may say no himself, and his no stands. Never public, whatever anyone agrees: his full name, a photo, his date of birth, his health or why he is not playing, conduct, contact details, ratings, notes, a page about him, or any figure of his across matches. A no takes effect at once, on past scorecards too.
>
> **Health**
> Injuries are never public. If the school runs health monitoring (daily check-ins, training load) it asks you separately; you read his check-ins only when the school shares them by a recorded act. His match overs are outside it.
>
> **Safeguarding**
> The school's Designated Safeguarding Officer keeps safeguarding records under the school's Safeguarding Policy. They are not shown in the app, and the Officer decides what a family is told. You may raise a concern from any screen.
>
> **Your phone**
> A lock-screen notification never carries his name; it only says there is a notice to read.
>
> **How long**
> Match scores are the shared record of those matches and are kept for good. Everything that says who he is is removed from them after the school's retention period once he leaves, by a dated, logged act. Lift records are kept one season.
>
> **Eighteen, and leaving**
> Your link stays open while he is at school. From eighteen his consents are his; you may still say no, never a new yes. The link ends on the later of his eighteenth birthday and the day he leaves the school system; his record is then his own.
>
> **Your rights**
> *See it:* Family shows his file; ask the office in writing for everything, answered within 30 days (aim: ten working days), free. *Correct it:* contacts yourself; the record through the office, with evidence; a wrong score by amendment, both versions kept. *Ask who looked:* the office can tell you. *Withdraw this agreement* by telling the office: you keep sight of his record, but he cannot be selected, and lifts and health monitoring stop, until it is agreed again. *Complain* to the Information Regulator of South Africa.
>
> The Information Regulator of South Africa (inforegulator.org.za).
>
> **If something goes wrong**
> If his data is seen by someone who should not have seen it, the school's information officer emails you: what happened, what has been done, what to do, and who it was if known.
>
> **Contact**
> The school's information officer: {school contact}. For your sign-in account, SCRBRD's information officer: {SCRBRD contact}. Google sign-in is covered by the privacy notice.

---

## 2 · Trace: each sentence to what makes it true

| # | sentence (short) | source |
|---|---|---|
| 1 | one child, one school, your own link; each parent for herself | GA-I20 §2.4 ("the one record that is per link"), §5.2 N6 ("the function updates only hers"); db/08 `guardian_consent_record` `a.person_id = p_guardian` |
| 2 | school responsible, SCRBRD runs it | ACCESS D1; INCIDENTS §3.4 (operator/responsible party; **counsel to confirm**, A5 there) |
| 3 | name, DOB, team, role, age group; ID, address, phone, email, boarding house, height, weight | READERS §1 A–A5 |
| 4 | scores ball by ball | READERS B (`ball_event`) |
| 5 | availability and reason | READERS C (`reason_kind`, `note`); GA-I20 §4.4 |
| 6 | sheets, honours, injuries, load, ratings and notes, conduct, contacts, lifts, notices, who looked | READERS D, E, F, G, H/H2, I, L, N, O, S |
| 7 | scorebook photo 30 days | READERS T (SCRBRD-120 §4: purged 30 days after confirmation) |
| 8 | why: pick sides, score, safe and well, keep in touch | db/08 `match_squad_is_registered` (selection is where processing bites); READERS B; F/G/J; NOTIFICATIONS §1 |
| 9 | you, other parent, the boy | READERS §2 parent/pupil; STEP4 §3.2 |
| 10 | coaches: side details, fit/what is wrong, load | READERS F (coach: status and nature), G (coach: load, logged) |
| 11 | office, director, principal see the file | READERS A2–A5 (office all four; DOB to director/principal), F, I |
| 12 | physio: health in full | READERS F |
| 13 | emergency contacts: who reads the numbers | READERS L; STEP4 P7a ("the coach on the bus, the team manager, the physio, the driver on the day"); 124 `lift_contacts()` logged |
| 14 | team-mates and their parents: sheet and scorecard names only | READERS rule 2, A, B2 (parent never a team-mate's figures) |
| 15 | other school: named squad and figures, five days, logged | READERS A (other school's staff), B2; PUBLIC_DATA §5 (five days) |
| 16 | scouts only with your yes | READERS Q; db/08 `scouting_consent_set` comment (no office escape hatch) |
| 17 | notes never to you or him; ratings he sees, you don't; conduct by the school's own way | READERS H/H2, I; STEP4 §3.2, Q5; READERS Q15 ("the app stays silent") |
| 18 | support staff: a school role, an hour, logged | READERS §2 "Platform / support" |
| 19 | nothing public until published; team scores and results | PUBLIC_DATA §1 rule 1, L1, A1 |
| 20 | initial and surname, separate yes, else Batter/Bowler | PUBLIC_DATA rules 3–4, C1 ("separate from the guardian-link consent") |
| 21 | from twelve he may say no | PUBLIC_DATA C1/C4 (21 Oct sentence); READERS Q7 |
| 22 | never public list; no page; no figure across matches | PUBLIC_DATA §3 N1–N5, A3, A4, A8 |
| 23 | a no at once, past scorecards too | PUBLIC_DATA rule 6, C3 |
| 24 | injuries never public | PUBLIC_DATA N2; READERS F |
| 25 | health monitoring asked separately; check-ins shared by a recorded act; match overs outside it | READERS G/G2 (parent: no standing read; `wellness_share`; "match overs are not under the health consent"); GA-I20 R8c; STEP4 §4.1 card |
| 26 | DSO keeps records; not in app; Officer decides what a family is told | SAFEGUARDING §1 item 2, §4.3 (p38's rule), §4.4 ("Parents have no standing access"); ACCESS §3.3 fixed sentence |
| 27 | raise a concern from any screen | GA-I20 §4.5 (persona header "Raise a concern", db/57) |
| 28 | lock screen never his name | NOTIFICATIONS §1, D14 (payload "stands": `push-api.mjs:76-81`) |
| 29 | scores kept for good | LIFECYCLE §0 item 6, §6.2 (match record forever); §6.4 screen words |
| 30 | identity removed after the school's period, dated and logged act | LIFECYCLE D22, D24 (`player_minimise`, due list, "nothing on a clock") — **period unstated here; §3 Q3** |
| 31 | lifts one season | LIFECYCLE §6.2 ("built, `lift_purge()`") |
| 32 | link open at school; no-only from 18; ends on the later date | db/62 header; READERS Q1 (21 Oct); GA-I20 D13; PUBLIC_DATA C6 and §5a |
| 33 | his consents his from 18 | STEP4 §3.3; READERS K (pupil) |
| 34 | Family shows his file | LIFECYCLE §6.4 ("Me and Family show the file"); STEP4 P6–P7 |
| 35 | ask in writing; 30 days; aim ten; free | ACCESS D7, D8 (decided 30 Oct); slice 0 runbook answers by hand — **PAIA sections for counsel, ACCESS A1** |
| 36 | correct: contacts yourself; office with evidence; score as amendment, both versions | ACCESS D9, §5.2; LIFECYCLE §6.4 |
| 37 | office can tell you who read | INCIDENTS §8.4 ("the office gives the name on request, from Who Read What"); SAFEGUARDING §4.3 (DSO reads excluded — the sentence does not promise completeness) |
| 38 | withdraw via the office; keep sight; not selected; lifts and health stop | db/08 `guardian_consent_withdraw` comment ("does not touch verification"), `player_guardian_status` → `pending_consent`, `match_squad_is_registered`; GA-I20 §4.3 withdrawn words, §5.1 R3 ("refuses a `consent_pending` link") |
| 39 | complain to the Information Regulator | ACCESS §3.3 last fixed sentence; INCIDENTS §3.4 — **details untraced; §3 Q2** |
| 40 | breach: email from the school's officer with the four things | INCIDENTS D8 (email to each live verified guardian), §3.4 s22(5) |
| 41 | contacts | **untraced placeholders; §3 Q1** |
| 42 | Google sign-in covered by the privacy notice | SIGNIN_PRIVACY_NOTICE (signed 2 Oct); S140 §7.3–7.5 |
| 43 | the Information Regulator of South Africa (inforegulator.org.za) | Kameel Q2; counsel confirms (Q8) |
| 44 | if he has his own sign-in, the same agreement covers his account | Kameel Q5; db/08 5949, 5955 (the `self` link at `popia-2026-01`); S140 §7.3 |

**Left out as UNTRACED** (nothing on the list says it): any sentence on selling, advertising or analytics; the in-app "Who has seen his record" view (INCIDENTS D20, designed, not built — hence sentence 37 says "the office"); the in-app `compromise` notice (READERS X9: unbuilt — hence sentence 40 says email only); an in-app withdrawal switch for the terms (STEP4 §4.1 draws it read-only; no route on the list — hence "by telling the office"); a health-record retention period (SCRBRD-110 §7.5, not on the list).

---

## 3 · Questions for Kameel

| # | question | recommendation |
|---|---|---|
| **Q1** | **Contacts.** The school's information officer (POPIA default: the principal, INCIDENTS §4.3) and SCRBRD's (you). Names, emails, and whether a postal address is needed for s22(4). | Make both a per-school and a platform setting read into the constant's two placeholders; the text itself stays one version. The principal by default, named by the office |
| **Q2** | **The Information Regulator's details** (address, email, complaint form). Not in any design. | Put them in the terms as a fixed line; confirm with counsel that naming the Regulator without a route to it is enough, else add the line |
| **Q3** | **Retention periods.** LIFECYCLE §6.2's periods were "recommendations to confirm or change" (Q11; approved "as recommended" 7 Oct, which confirms the shape, arguably the numbers). The text says "the school's retention period". State 5 years after leaving, or keep it general? | **Keep it general** in v1 and show the dated figure on the Family record (ACCESS §4 W already lists "his retention dates per class"). A number in the terms needs a new version to change |
| **Q4** | **Withdrawal: a conversation with the office, or a switch in the app?** `guardian_consent_withdraw()` admits the guardian herself; STEP4 §4.1 drew it read-only; GA-I20 §4.3 already words the withdrawn state. | **Office in v1**, as written. A one-tap withdrawal that stops selection, lifts and health monitoring deserves its own screen and confirmation (Opus, after N6), and the text then gains one sentence and a new version |
| **Q5** | **The pupil's own link carries the same version** (db/08 5949, 5955: the `self` link is written `consent_version = 'popia-2026-01'` from the school's signed form; S140 §7.3 calls it the s35 consent for his account). Does this text cover that, or does the self link need its own text (or the same text with "his account" said)? | One text, one version, with one added sentence under *Why*: "If he has his own sign-in, the same agreement covers his account." Otherwise two constants drift apart |
| **Q6** | **The owner's key reads everything outside safeguarding and recognition, unlogged** (READERS §2 `superadmin`). The text promises logged support reads and says nothing of the key. ACCESS §2 says the key's register read "is logged like every other"; READERS lists it as unlogged. | Either log the key's reads of a child's record (Opus, small) and say nothing more, or add a sentence. **Log them.** An unlogged standing read by the platform owner is the one thing in the map a parent would object to |
| **Q7** | **"Who looked" is the office's answer today, not the app's.** Promise the in-app view now (INCIDENTS D20, Sonnet A6) or after it lands? | After it lands, with a new version. The text says "the office can tell you", which is true now |
| **Q8** | **Counsel.** Sentences 2, 35 and 40 rest on readings of POPIA/PAIA flagged for counsel in ACCESS A1/A5 and INCIDENTS §3.4. | Counsel reads the text once before it is the constant; the pilot's school signs it as its own terms |

### 3a · Kameel's decisions (5 Nov 2026, "Text approved; all eight as recommended")

| # | decided | where it lands |
|---|---|---|
| Q1 | Both contacts are placeholders filled at render. The school's information officer from a per-school setting; **no such column exists**, so until one does the app renders "the principal of {school}, through the school office" (POPIA's default officer, INCIDENTS §4.3), with no migration for it. SCRBRD's: a platform constant, "the SCRBRD information officer, via the school office" (no platform contact exists in the code) | `apps/web/src/lib/guardianLink.js` `termsContacts()` |
| Q2 | One fixed line under *Your rights*: "The Information Regulator of South Africa (inforegulator.org.za)." | §1; trace row 43 |
| Q3 | Retention kept general in v1 | the text as written |
| Q4 | Withdrawal through the office in v1 | the text as written |
| Q5 | One added sentence under *Why*: "If he has his own sign-in, the same agreement covers his account." | §1; trace row 44 |
| Q6 | Log the owner's key's reads of a child's record | **another builder** (not N6) |
| Q7 | "Who looked" stays the office's answer until the in-app view lands | the text as written |
| Q8 | Counsel reads sentences 2, 35, 40 and 43 once, **outside the code**; a change from counsel is a new version | no code |

The version stays `popia-2026-01`: the text above, with Q2 and Q5, is that version. Any later edit is a new version (§4).

---

## 4 · Notes for the Opus builder of N6 (GA-I20 A2)

- **Version:** `GUARDIAN_TERMS_VERSION = "popia-2026-01"` (`apps/web/src/lib/guardianLink.js:21`) stays the record's string. The text above is that version; db/98 and db/62 already wrote links at this version without any text, so this is the text they are deemed to have agreed (Kameel to confirm the office showed the paper equivalent; else the row says "agreed, version popia-2026-01" and the screen offers "Read the terms").
- **Where the text lives:** one exported constant beside the version, e.g. `GUARDIAN_TERMS = { version, title, sections: [{heading, body}] }` in `guardianLink.js` (pure, tested under node), rendered by the family screen and by the office's confirm dialog ("The office is shown it, never asked to type it", guardianLink.js:17-19). No copy in the database; the row keeps the version only.
- **Placeholders:** `{school contact}` and `{SCRBRD contact}` are the only substitutions; the body otherwise renders verbatim. A test asserts the rendered text contains no other `{`.
- **Changing the text needs a new version.** Any edit to a sentence is a new `popia-YYYY-NN`, a new constant beside the old (the old stays for reading past agreements), and every link at the old version shows "The terms changed · Read and agree again" (GA-I20 R8a fires on `consent_version ≠ current`, if Kameel wants re-consent; else only an information line). A static test fails if the text changed and the version did not (hash the body).
- **The screen before "I agree":** the child's name once, the school's name, the whole text scrolled to the end (the button is disabled until the last section is on screen), the version string, and the sentence "Your agreement, this version and the time are kept against your name" (the parent's twin of `confirmWords`). Then `POST /api/players/:id/guardians/consent {guardianId: me, consentVersion}`; the done words are the record's: "Agreed · {consent_at} · {version}".
- **Refusals** are the function's: `no_verified_link` ("The school has not verified your link yet"), `not_permitted` (another guardian's link), `no_consent_version`. Re-use `guardianLinkWords()` with parent-facing text.
- **Floors:** 12 px minimum, 44 px button, `prefers-reduced-motion`; the a11y walk reads the whole text as one landmark. No child's name in the route, the title or any push.
- **Proof (A2 row):** API: the parent's agreement lands as `consent_state = 'granted'` with the version; refused for another guardian's link; the pupil's own account cannot agree his parent's terms. Unit: the constant's hash matches the version; the rendered text has no untraced placeholder.

---

**To the lead:** Ready for Kameel, with eight questions; 700 words against the 600 aim, two cut candidates named in §1. The text carries 42 traced claims and 0 untraced claims; five facts were left out as untraced (selling/analytics, the in-app who-read view, the in-app breach notice, an in-app withdrawal switch, a health retention period), listed under §2. Kameel must settle the two contact placeholders (Q1) and the Regulator's details (Q2) before it becomes a constant. Two changes I recommend to the system rather than the text: log the owner's key's reads of a child's record (Q6) and treat the pupil's self link as covered by the same version (Q5). Counsel reads sentences 2, 35 and 40 once (Q8).
