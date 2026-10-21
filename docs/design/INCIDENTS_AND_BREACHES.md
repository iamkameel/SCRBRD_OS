# Data events and security compromises: POPIA s22, the match-day outage, and the audit log

Design for Kameel's review (Fable, 2026-10-21). Nothing is built. Kameel added this
problem to Fable's list on 2026-10-21 as "incidents and breaches"; this document
does not use either word for it (§2).

Haiku's map of what exists is the basis (`incidents-map.md`, scratchpad, 2026-10-21,
read from `origin/main` at `5e03ec4`). Line numbers below are from that map and that
commit. Opus builds from this after Kameel decides; Sonnet takes the screens; Haiku
the documents. The pilot is Saturday 31 October at Westville, scored live; feature
freeze is 26 October. §12 marks what must exist by the pilot and what follows.

**This is not legal advice.** §3.4 states POPIA s22 as I read the Act. Every place a
South African privacy lawyer should confirm is marked **[lawyer]**, and §13 Q17 asks
for that hour.

## 0 · Summary

SCRBRD holds children's names, dates of birth, guardians, consents and, for some
boys, medical, workload and safeguarding data. Today nothing says what happens when
some of it is seen by the wrong person: there is no definition, no register, no
decision chain, no notice to the Regulator, a school or a family, no clock and no
kill switch (map §3, §6, §12). The information officer is also the platform's owner
and holds the owner key, so nobody checks him. On match day, the runbook has no rule
for the server or the database being down and "[who to call]" is still blank.

This design settles:

- **Words.** A *data event* is anything recorded in the register, from a lost phone
  to a provider's outage. A *security compromise* is the subset that meets POPIA
  s22. Neither word collides with a cricket incident or a bowling breach (§2).
- **What counts and who decides.** Fourteen kinds of event (§3.2), four severities
  (§3.3), the s22 duties as I read them (§3.4), and a chain of two people: the
  information officer and a second reader who is not him. If they disagree, notify
  (§4).
- **The clock.** Contain within the hour; classify within 24 hours; the school's own
  information officer told within 24 hours; the Regulator within 72 hours of
  discovery for a compromise; families with the Regulator or within 7 days; a review
  at 30 days (§5).
- **Containment.** What can be switched off today (Render's suspend, `PUBLIC_PAGES`,
  a module flag, an account, a session, a secret) and the read-only mode that follows
  the pilot. The pad holds every ball on the phone through any of it (§6).
- **The register** (append-only, like `access_log`), **the audit log** (failed writes
  counted, restricted reads refused when they cannot be logged, 5-year retention, a
  parent's view) and **logging hygiene** (no personal value in a server log) (§7–§9).
- **The match-day outage at Westville:** the pad keeps scoring, the paper scorebook
  is kept in step as it already is, nobody "switches", and the lead decides after
  play whether the importer fills a gap. The runbook text and the shape of "who to
  call" are in §10.
- **Third parties:** Render, Supabase, Anthropic, Firebase and GitHub, and what to do
  when the breach is theirs (§11).

By the pilot: documents, decisions, one logging fix and one workflow change. The
tables, the notice kind, read-only mode and the parent's view come after (§12).

## 1 · The rules this design keeps

- **No child's name or photograph on a public page, and none on a lock screen**
  (`docs/policy/PUBLIC_DATA.md`; `NOTIFICATIONS.md` rule 2; `push-api.mjs:41-61`).
  A notice about a compromise is a pointer like every other push.
- **Children are told through their guardians.** A pupil is a data subject, but the
  competent person acts for him; a pupil of 18 or more is told himself.
- **The DSO's rules stand.** A data event that puts a child at risk reaches the DSO
  through a safeguarding concern (`SAFEGUARDING_DSO.md` §3), not through a second
  door, and the hidden-log rule (§4.3 there) is not loosened here.
- **The audit log carries no free text and no child's full name** (db/79 header
  lines 38–64). The register is a separate table with its own door, because it must
  carry free text.
- **The match record is append-only.** Nothing here writes a `ball_event`; the
  importer's events carry their source as SCRBRD-120 says.
- **No platform role gains school authority.** The register's platform capability
  reads the register; it does not read a school's data.
- **No new runtime dependency**, and nothing ships to production in the pilot week
  that is not on the §12 pilot list.

## 2 · Words

**D1.** The platform's words are:

| word | means | not to be confused with |
|---|---|---|
| **data event** | anything written in the register: something that did, might have, or nearly let personal information be seen, changed, lost or made unavailable by the wrong person or at the wrong time | an on-field *incident* (`discipline.jsx:293 ReportIncident`; `suspendSheet.jsx:243`) |
| **security compromise** (or **compromise**) | a data event where there are reasonable grounds to believe personal information was accessed or acquired by an unauthorised person: POPIA s22's own words | a bowling-workload *breach* (`bowling_breach_watch()`, db/08:5014; `NOTIFICATIONS.md:82`) |
| **near miss** | a data event where the wrong person could have seen something and the evidence says nobody did | — |
| **outage** | a data event where a store or the API was unavailable or lost writes; an integrity and availability event under s19, not by itself a compromise | rain |
| **the register** | `data_event` and its notes (§7) | the DSO's register (`safeguarding_register`, `SAFEGUARDING_DSO.md` §2) |
| **the officer** | SCRBRD's information officer (Kameel) | the school's own information officer (§4.3) |
| **the second reader** | the person who must read and sign every classification beside the officer (§4.2) | — |

In code: table `data_event`, notification kind `compromise`, capabilities
`compromise.read` and `compromise.manage`, access-log resource prefix `data_event`.
"compromise" appears today only as a design word in `live.js:15` (map §11), so nothing
collides. "incident", "breach" and "register" are not used in any new identifier.

## 3 · What counts

### 3.1 The test

A data event is recorded whenever someone with a reason to think so believes one of
these happened, or nearly happened:

- personal information was seen, copied or taken by someone the policy would not
  have admitted (a *confidentiality* event);
- personal information was changed, lost or undone by something other than the
  app's own doors (an *integrity* event: a restore that undid a consent withdrawal
  is one);
- a store or the API was unavailable during play or at a time families relied on it
  (an *availability* event).

Recording is cheap and never wrong. Classifying is the decision (§4). The threshold
for *compromise* is the Act's: reasonable grounds to believe an unauthorised person
accessed or acquired the information. **[lawyer]**: the threshold for a locked phone,
and for a wrong read rule where the log shows no read happened (§3.2, kinds 1 and 2).

### 3.2 Kinds

**D2.** The register's `kind` is one of this closed list. The right-hand column is the
design's view of whether the kind meets s22 on its own; the decision is still made
per event (§4).

| # | kind | example | s22? |
|---|---|---|---|
| 1 | `device_lost` | a phone signed in as a scorer, coach, office or DSO is lost or stolen; a match's balls and the squads' names are on it (`packages/sync`, IndexedDB), and a 30-minute token (db/85) | **depends**: no, if the phone was locked and the account disabled and signed out within the hour (§6.1); yes, if the phone was unlocked or the account was used after it was lost |
| 2 | `wrong_read_rule` | a policy, RLS or generated read lets A see B's data: a parent sees another child; a coach sees another school's medical; the dossier opens early | **depends** on `access_log`: yes where a row shows a read by someone the rule should not have admitted; a near miss where the log shows none (the log must be trusted for this, §8) |
| 3 | `wrong_public` | a child named without consent, a never-public mark ignored, a date of birth or a photograph on a public page or the pavilion screen | **yes**: the public is unauthorised by definition; scope is who could have opened the link in the window |
| 4 | `log_exposure` | a server log carrying an email or an ID number (`server.mjs:1461`, §9) is read by someone outside the chain, or pasted into a chat or an AI assistant | yes if the log carried personal values and left the provider's console; a near miss otherwise |
| 5 | `secret_exposure` | `SESSION_SECRET`, `DATABASE_URL`, `OWNER_RECOVERY_SECRET`, `PUBLIC_PSEUDONYM_SECRET`, `BACKUP_PASSPHRASE`, an API key, committed or shared | **depends**: a compromise only where the evidence says it was used (a sign-in, a query, an artifact downloaded); rotate regardless (§9.3) |
| 6 | `dump_exposure` | a dump (`BACKUP_RESTORE.md` §3) lost, left unencrypted, or sent anywhere on the "never" list | **yes**: it is every school and every family, and the dump holds special personal information |
| 7 | `provider` | Render, Supabase, Anthropic, Firebase or GitHub reports a breach, or our account there is accessed by someone else | yes where our data was in the provider's scope; the provider's notice is the trigger (§11) |
| 8 | `insider` | a staff member reads beyond need (the whole school's medical; a support session used for something other than its reason; the owner key used without a register entry) | **yes**: an authorised account used for an unauthorised purpose is an unauthorised person for the data read **[lawyer]** |
| 9 | `misdirected` | an export, a notice, an email or a sign-in code sent to the wrong person; a CSV to the wrong school | yes, unless the recipient confirms in writing it was deleted unread and the officer believes it |
| 10 | `page_shared` | a photograph of a scorebook page, with both sides' boys' names, shared outside the platform by someone who read it in the importer | **depends**: the names in a scorebook are the names in a public scorecard, so no on names alone; yes if the page carried more |
| 11 | `safeguarding_exposure` | a concern's content, a reporter's identity, or a share, seen by someone outside db/57's doors | **yes**, and severity S1 (§3.3): the DSO is told through a concern, not through this register |
| 12 | `outage` | the API or the database unreachable during play; writes lost; a restore that moved the record back in time | no on its own; a compromise only if the restore undid a withdrawal or an erasure and the data was then served (`BACKUP_RESTORE.md:321-322`), which this design treats as kind 2 |
| 13 | `reader_exposure` | a scorebook page sent to the third-party reader when the flag should have been off, or before the operator agreement held | **yes**, as a transfer without a basis (SCRBRD-120 §5.4) **[lawyer]** |
| 14 | `other` | anything the officer cannot place | decided per event |

### 3.3 Severity

**D3.** Severity decides who is told first and how fast, not whether s22 applies:

| severity | the data | first call |
|---|---|---|
| **S1** a child at risk | whereabouts, a lift, a never-public mark's reason, anything safeguarding, an address or a school beside a name for a child with the mark | the DSO, within the hour, by a safeguarding concern; the school's principal by phone |
| **S2** special personal information | health, discipline, an ID number, a full record (profile with contacts), a guardian's details, a dump | the school's information officer within 24 hours; the Regulator and families if a compromise |
| **S3** identifying data only | names, initials and surnames, team sheets, age groups, the fact of a sign-in | the school's information officer within 24 hours; notify if a compromise, in proportion |
| **S4** no personal data | a secret with no evidence of use, an outage with no loss, a near miss | the register only; the 30-day review |

### 3.4 POPIA s22 as I read it

The Act's own text is the source. Nothing below cites regulations or guidance notes,
because I have not read them; **[lawyer]** confirms each line and adds the
Regulator's current form and route.

- **Who must act (s22(1)).** The *responsible party* must notify the Regulator and
  the data subject when there are reasonable grounds to believe that the personal
  information of a data subject has been accessed or acquired by any unauthorised
  person. A data subject whose identity cannot be established is not notified.
- **The operator's duty (s21(2)).** An *operator* must notify the responsible party
  *immediately* on the same grounds. `BACKUP_RESTORE.md` §3 says "SCRBRD processes
  this information for the schools": that is the operator's position, and it means
  the school is told immediately, before any classification (§5).
- **When (s22(2)).** As soon as reasonably possible after discovery, allowing for
  law enforcement's legitimate needs and for measures reasonably necessary to find
  the scope and restore the system's integrity. The Act gives no number of hours.
  §5's 72 hours is this design's own ceiling, chosen because a smaller number than
  "reasonably possible" is a discipline, not because the Act says so. **[lawyer]**:
  whether the Regulator has published a shorter expectation.
- **Delaying the data subject (s22(3)).** Only if a public body responsible for
  preventing, detecting or investigating offences, or the Regulator, determines that
  notifying would impede a criminal investigation. Not at the officer's own
  discretion.
- **How (s22(4)).** In writing, by at least one of: post to the last known
  physical or postal address; email to the last known email address; a prominent
  place on the responsible party's website; the news media; or as the Regulator
  directs. The platform holds a guardian's email (`app_user.email`), so email is the
  route it can serve itself (§4.5); a platform notice is in addition, not instead.
- **What it says (s22(5)).** Enough for the data subject to protect themselves:
  the possible consequences; the measures taken or intended; what the data subject
  should do; and, if known, who the unauthorised person is.
- **Publicity (s22(6)).** The Regulator may direct the responsible party to
  publicise the compromise.

**The open question is who the responsible party is.** For a school's pupils'
records, the school is the responsible party and SCRBRD its operator; the school's
information officer (by default its principal) owes the s22 notice and SCRBRD owes
the s21(2) notice to the school. For the platform's own accounts, sign-ins and the
sign-in privacy notice (`SIGNIN_PRIVACY_NOTICE.md`), SCRBRD looks like a responsible
party itself. A pilot school has no capacity to draft a Regulator notice. **D4:**
whichever party owes it in law, SCRBRD prepares every notice, the school's
information officer reads and co-signs the ones about its pupils, and one notice goes
to the Regulator in both names. **[lawyer]**: confirm the standing, and whether a
notice in both names satisfies the Act for both.

### 3.5 What else the Act asks of the register

The register is also the s19 record: s19(2) asks a responsible party to identify
risks, establish and maintain safeguards, verify them and update them. A closed data
event with a review is that verification, written down. Children (s34–35) and
health (s26–33) are special categories; S1 and S2 above are the design's map of
them.

## 4 · Who decides

### 4.1 The chain

**D5.** Every data event has four roles, and no one person holds all four:

| role | who | does |
|---|---|---|
| **reporter** | anyone: a scorer, a coach, a parent, a provider's email, a monitor | says what they saw; writes nothing else and forwards nothing (§10.3) |
| **lead** | the person on duty for the platform that day (at the pilot, Kameel at the ground) | records the event within the hour, contains it (§6), tells the officer |
| **officer** | SCRBRD's information officer (Kameel) | classifies, decides notices, signs them |
| **second reader** | a named person who is not the officer (§4.2) | reads the entry and the evidence; signs the classification or dissents |

At the pilot, the lead and the officer are the same person. That is tolerable for a
day because the second reader is not.

### 4.2 The second reader

The information officer is the owner, holds the owner key (db/01:147), can read
every school's audit log (`audit.read` at platform level) and is the one person who
could cause an `insider` event nobody else would see (map §2, §12). The Act lets an
information officer designate deputy information officers (s56, as I recall it;
**[lawyer]**). **D6:**

- Kameel designates a **deputy information officer** for SCRBRD, in writing, with
  name and date in `docs/policy/`. The deputy is not an employee of the platform
  if that can be arranged, and not a person Kameel supervises.
- **No classification stands with one signature.** The officer proposes; the second
  reader signs or dissents within the 24-hour window (§5). **If they disagree, the
  safer course wins: notify.**
- For any event where the officer is the actor (the owner key, a support session he
  began, a dump he holds), the second reader classifies and the officer is the
  reporter.
- Until a deputy is named, **the second reader for any event touching a school's
  pupils is that school's own information officer** (the principal, or whoever the
  school names). This is right anyway: that officer owes the s22 notice for those
  pupils (§3.4). For the pilot, Westville's.
- The deputy holds what the role needs and no more: `compromise.read` and
  `compromise.manage` (§7.4), a Render login that can suspend the service (§6.2),
  and the emergency-access share of the password manager for the secrets sheet
  (§9.3). Not the owner key.

### 4.3 Who at the school is told

**D7.**

| who | when | by whom | how |
|---|---|---|---|
| the school's **information officer** (the principal unless the school names another) | at once by phone for S1; within 24 hours for any event that might be a compromise of its pupils' data (s21(2)); at the 30-day review for S4 | the officer | phone, then a written entry the school can keep |
| the **DSO** | only when a child is at risk (S1): a safeguarding concern's content, a never-public child's whereabouts, a lift's details | the lead, by raising a **safeguarding concern** through the ordinary form, `p_about_kind = 'child'` where one child is named, else `'unknown'` with the account "A data event (reference DE-…) may have exposed …" | `SAFEGUARDING_DSO.md` §3.3's notice; the DSO's clocks and hidden-log rule apply unchanged |
| the **director of sport** and the **office** | an outage that touched a fixture; a wrong public page on their side; any event that needs them to act (a Withdraw, a re-link, a new sign-in code) | the lead | phone on the day; the school's officer in writing |
| **coaches and scorers** | only what they must do (sign in again, stop using a device) | the lead | in person or by the office |

A school is never told another school's event except where its own pupils were in
scope (a Westville boy's name on the other side's page is Westville's event too).

### 4.4 Telling families

**D8.** A family is told when the officer and second reader classify a compromise of
their child's data, or when the officer decides to tell them of a lesser event
because they would want to know (a wrong-read near miss involving their child is
one). The route:

1. **The s22(4) notice is an email** to each live verified guardian's last known
   email, from the officer, co-signed by the school's officer, carrying s22(5)'s four
   things in plain words. A guardian without an email is posted through the school.
   The platform does not send this email itself in v1: the officer sends it from the
   platform's own address with the list the register produces (§7.3, "the subjects
   list").
2. **A platform notice** of kind `compromise` reaches the same guardians (§4.5) so
   that the in-app Family screen says the same thing the email said, and so the read
   count tells the officer who has seen it.
3. **The school's own channel** (its parent mailer, its app) carries the same text if
   the school's officer wants it to; the school decides, since it is the school's
   relationship.
4. **A notice on the website** (s22(4)(c)) only where the scope is wider than the
   platform's own list of emails (a public page seen by the public) or the Regulator
   directs it. It names no child.

**Children.** A pupil under 18 is never a recipient of a `compromise` notice; his
guardians are. A pupil of 18 or more with `selfaccess` is his own data subject and
receives his own. Nothing names a child on a lock screen: the push is the pointer
(§4.5).

### 4.5 The `compromise` notice

**D9.** A new kind, added to `NOTIFICATIONS.md` D1's list and db/89's CHECK in the
migration that builds the register (§12, A2):

| kind | writer | required_capability | audience | urgency | pushed | retractable | lives |
|---|---|---|---|---|---|---|---|
| `compromise` | `compromise_notify()` (§7.3), SECURITY DEFINER; never a route | `news.read` | **to one person**: one row per live verified guardian, `recipient_id` the guardian, `subject_person_id` the child, the school and team anchors set (the `lift_notify_family()` shape, SCRBRD-124 decision 13); the pupil of 18+ as his own recipient; the officer's and deputy's own rows for a new event (§7.3) | medium | yes; no preference (a person may not mute the notice that their child's data was exposed); adults have no quiet hours, and no pupil under 18 receives one | **never** (a notice of a compromise is not taken back; a later fact is a second notice) | 2 years, with the register |

Title "A data security notice". Body, in-app: "Something about {child's initials and
surname}'s record on SCRBRD was seen by someone who should not have seen it, or may
have been. Please read the email we sent to {masked email}. Open to read what we
know." The push is D14's fixed pointer and says none of this. The in-app body uses the
initials rule (db/79's `audit_mask_name`), not the full name, so a screen left open
names nobody fully.

Where a notice is held back under s22(3), the register says who determined that and
when; the notice goes out when the determination lifts.

## 5 · The clock

**D10.** From discovery (T0, the moment the lead or officer first knows, not the
moment it happened):

| by | what | who |
|---|---|---|
| **T + 1 hour** | the register entry is opened with what is known (§7.2); the first containment step is taken (§6.1); for S1, the DSO's concern is raised and the school's principal phoned | the lead |
| **T + 24 hours** | the evidence is gathered (`access_log`, the register's subjects list, provider logs); the officer proposes a classification; the second reader signs or dissents; the school's information officer is told of anything that may be a compromise of its pupils' data (s21(2) "immediately" is read as "within the day", **[lawyer]**) | officer, second reader |
| **T + 72 hours** | for a compromise: the Regulator's notice is sent, in both names (§3.4 D4), on the Regulator's current form; the register records the time and any reference the Regulator returns | the officer |
| **with the Regulator's notice, and in any case by T + 7 days** | the family notices go (§4.4), unless s22(3) applies; each school's officer has the text a day before | the officer, the school's officer |
| **T + 30 days** | the review: cause, what changed (a migration, a rule, a document), what the Regulator said, the entry closed. For S4 and near misses this is the only decision beyond the entry | officer, second reader |

The clock is written on the register entry (`discovered_at`, `classified_at`,
`regulator_notified_at`, `families_notified_at`, `closed_at`) so that the Regulator's
question "when did you know and when did you tell" is answered by columns, not memory.
An entry open past any of its deadlines shows red on the officer's screen (A11), as
the DSO's inbox shows a concern past 24 hours.

## 6 · Containment

### 6.1 What can be switched off today

The map found no kill switch, read-only mode or maintenance route (map §6). What it
found are these, and the pilot runs on them:

| to stop | the switch | who | takes effect | side effects |
|---|---|---|---|---|
| **everything** | suspend the Render web service (its dashboard) | the owner; the deputy once added (§4.2) | within a minute | every client gets no answer; the pad holds balls (`Held` / `On device`) and resends on resume; the pavilion screen says "reconnecting"; no handover; no sign-in |
| **every public page and the pavilion screen** | `PUBLIC_PAGES` off on Render (`server.mjs:239-245`; DEPLOYING.md:318) | the owner, the deputy | on the redeploy the variable change triggers, a minute or two | every public path 404s; the app is unaffected |
| **one side's public page** | **Withdraw** in Match Details (`PILOT_DAY_RUNBOOK.md` "After the match" 4) | the director of sport or office | at once | that page only |
| **one module at one school** | the module flag (`packages/policy/src/modules.mjs`; `feature_flag.locked`, `feature_grant`) | the platform | at once | that module returns `module_disabled` |
| **photos leaving the platform** | the `scorebook_reader` flag; or remove the key so `readerConfig()` returns `none` (`scorebook-reader.mjs:80`) | the platform | at once | the importer works by hand (SCRBRD-120 §6.4) |
| **one account** | `account_set_active(id, false, reason)` (db/85:343) and `auth_sign_out_everywhere()` (db/85:326) | the school's office or the owner | the next request (db/85 checks each request) | that person is out everywhere; a scorer's pad stops sending until signed in again, and holds its balls |
| **one support session** | `support_access_end()` (db/22:148) | the person who began it or the office | at once | — |
| **every session on the platform** | rotate `SESSION_SECRET` on Render (undocumented; the map §9 says it signs everyone out) | the owner | on redeploy | everyone signs in again; scorers at the ground need a code or Google and signal. Confirm on solo run 2 that a pad mid-match recovers (§12 P6) |
| **the owner recovery door** | unset `OWNER_RECOVERY_SECRET` (DEPLOYING.md:275-300) | the owner | on redeploy | recovery impossible until set again |
| **the database owner string** | reset `scrbrd_app`'s password in Supabase and set Render's `DATABASE_URL` | the owner | on redeploy | the API is down for the redeploy |

**D11.** For the pilot, the kill switch is **suspend the service on Render**, and the
public kill switch is **`PUBLIC_PAGES` off**. Both are written on the production
sheet (§9.4) with the dashboard path. The deputy gets a Render login that can do both
before 31 October or, failing that, the owner's password manager's emergency access.

### 6.2 Read-only mode, after the pilot

**D12.** `PLATFORM_MODE`, an environment variable read at boot like `PUBLIC_PAGES`,
with three values:

- `normal` (the default when unset);
- `read_only`: every route that writes returns `503 platform_read_only` with a
  `Retry-After`, except `GET /api/health`, sign-out, and the push worker's own reads.
  Scoring writes are refused like any other, which the pad already treats as "keep
  the ball and retry" (`sync-engine.mjs` backoff), so a scorer sees `Held`, not
  `Refused`; §12 P6 confirms that on the current build. Handover is refused with its
  own reason so the sheet says "SCRBRD is read-only; no handover until it is back".
- `closed`: everything but `/api/health` returns 503, and `/api/health` says
  `"mode":"closed"`.

The variable lives outside the database on purpose: if the database is the thing in
doubt, the switch must not depend on it. `/api/health` reports `mode`. The app shows
one banner in `read_only`: "SCRBRD is read-only while we fix something. Scoring
carries on on your phone and sends when we are back." (Sonnet, A3). Who may set it:
the owner and the deputy, through Render. Opus builds the middleware (A3): it touches
every write route and a mistake there is silent.

### 6.3 Containment steps by kind

| kind | first hour |
|---|---|
| `device_lost` | disable the account and sign it out everywhere; if the lost phone held the match, the lead force-releases the match so the standby can claim (§10); note whether the phone was locked |
| `wrong_read_rule` | take the module or the page off (flag, Withdraw, `PUBLIC_PAGES`); if the rule is in a generated read, read-only mode once it exists; pull the `access_log` rows for the window before anything else changes |
| `wrong_public` | Withdraw the side; `PUBLIC_PAGES` off if more than one page; keep the public payload for the entry (`parLeaks()`, `public-api.mjs:721`) |
| `log_exposure` | delete the pasted copy where it was pasted; note who could read the provider console in the window (§9.2) |
| `secret_exposure` | rotate on the secrets sheet (§9.3), in the order the sheet gives; `SESSION_SECRET` last on a match day |
| `dump_exposure` | treat as a compromise of everything; rotate nothing (the dump is a copy, the live database is not changed), tell every school's officer |
| `provider` | read the provider's notice; list what of ours was in scope; rotate the keys that provider held (§11) |
| `insider` | end the support session; disable the account if the reading continues; preserve the `access_log` rows (they are append-only; nothing to do but not to restore over them) |
| `misdirected` | ask the recipient in writing to delete and confirm; revoke the link or code |
| `page_shared` | nothing to switch; record who read the page (db/63's access row per page read, db/63:1266) |
| `safeguarding_exposure` | raise the concern; the DSO decides the rest; the lead touches no safeguarding row |
| `outage` | §10 |
| `reader_exposure` | flag off, key removed; record `read_by` (provider, model, time, hashes) from the import |

## 7 · The register

### 7.1 Shape

**D13.** Two tables and no UPDATE on either, as `access_log` is written (db/08:62-65):

- `data_event`: one row per event, written once at discovery. `id`, `reference`
  (`DE-7K3M-2026`, the safeguarding reference's shape), `kind` (§3.2), `severity`
  (§3.3), `discovered_at`, `discovered_by` (an `app_user`, or null with
  `reporter_text` for a provider's email), `summary` (free text, ≤ 500, written so
  that it names no child: "a roster read by an account that should not have held the
  role"), `schools uuid[]` (every school whose people are in scope), `created_at`.
- `data_event_note`: the entry's history, one row per act, append-only:
  `event_id`, `at`, `by`, `kind` (`contained`, `evidence`, `classified`,
  `dissented`, `school_told`, `dso_concern_raised` (the concern's reference only,
  never its content), `regulator_notified`, `families_notified`, `held_back_s22_3`,
  `review`, `closed`, `note`), `body` (free text), `classification`
  (`compromise | near_miss | outage | not_personal_data`, on a `classified` row),
  `counterpart` (`app_user`, on `classified` and `dissented`: the second reader),
  `subjects_count integer`, `regulator_reference text`.

The current state of an event is the newest note of each kind; the officer's screen
(A11) folds them. A wrong note is corrected by a later note, as a wrong ball is by an
amendment. `closed_at` and the other clock columns of §5 are views over the notes,
not columns to update.

### 7.2 What the entry records, in words

Who discovered it and when; what was seen or could have been; which stores, tables
and column classes (health, discipline, identity, contact, safeguarding), never the
values; whose data by count per school and, in the subjects list, by id; who had
access in the window and how we know (the `access_log` rows' keys, a provider's
ticket number, a Render log line's time); what we switched off and when; the
classification and both signatures; who was told, when, by which route, and the text
sent; what the Regulator said; what changed afterwards.

### 7.3 The subjects list

**D14.** `data_event_subject (event_id, player_id, school_id, data_classes text[])`,
append-only, written by the lead and officer as the scope becomes known, read only
under `compromise.manage`. It exists so that `compromise_notify(event_id)` can write
one `compromise` notice per live verified guardian of every listed child (and to
the child himself at 18+), and produce the officer's email list (the guardians'
emails, once, for the s22(4)(b) mail) without the officer pasting ids into SQL. It
holds ids, not names; the screen resolves them under the reader's own policy.
Removing a child wrongly added is a note (`subject_withdrawn`) and a second row with
`withdrawn = true`, never a DELETE.

`compromise_notify()` also writes, on a new event, one `compromise` row each to the
officer and the deputy ("A data event was opened: DE-…") so that the deputy learns of
every event the hour it is recorded and the owner cannot hold one back by not
mentioning it.

### 7.4 Who reads, who writes, how long

**D15.**

- `compromise.manage` (write `data_event`, `_note`, `_subject`; call
  `compromise_notify()`): the officer and the deputy. A platform capability in its own
  bundle, held by `superadmin` and by a new `deputyinfoofficer` platform role that
  holds nothing else. Not `platformadmin`.
- `compromise.read`: the same two, platform-wide; and `audit.read` at a school reads
  the events whose `schools` include that school, the notes, and the count of its
  own subjects. The school's principal is its information officer and must see its
  own events. The school never reads another school's rows or subjects.
- Every read of the register writes an `access_log` row with resource `data_event`,
  as `audit_log()` does for itself (db/79:66-72).
- The register appears in the audit log (db/79) as a new kind `event`, one row per
  note, with the reference and the note kind and **no body**: the free text stays
  behind its own door, as db/79's "NOT here" list requires.
- **Retention: 7 years after the closing note**, then the rows are deleted; the
  subjects list is deleted at 7 years too. The Regulator may ask years later, and
  role endings are kept 7 years already (`ACCOUNT_LIFECYCLE.md` D22). Q7.

### 7.5 Before the table exists

**D16.** For the pilot, the register is a document, not a table: one file per event,
from the template `docs/policy/DATA_EVENT_TEMPLATE.md` (the fields of §7.1–7.2 as
headings; no data in the repository), kept **where a dump may live and nowhere else**
(`BACKUP_RESTORE.md` §3: an encrypted disk, a password-managed passphrase, never a
chat). When the table lands, the pilot's entries are typed into it by the officer as
notes dated when they happened. A pilot with no entry is itself an entry: "no data
event recorded, 31 October 2026", signed by both.

## 8 · The audit log

What the Regulator or a parent will ask is: who read this child's record, when, from
where, and how do you know the log is whole. Today the log cannot answer the last part,
and it answers the first part only for some reads.

### 8.1 Failed writes

`log_restricted_read()` ends `EXCEPTION WHEN OTHERS THEN NULL` (db/08:592;
db/20:56-57). A failed log write is invisible. **D17**, in a new `db/NN` that
re-creates the function as db/20 and db/22 did:

- the function **returns boolean** (true: logged; false: not), and in the exception
  branch does `RAISE WARNING 'access_log write failed: %', SQLSTATE` with **SQLSTATE
  only**, never `SQLERRM` or a value, so the warning reaches the Postgres log
  (Supabase's) with nothing personal in it;
- the API's callers (`read-api.mjs:3480-3494`; `audit_log()`; db/63:1266) read the
  boolean. **A platform-wide or support-session read, and any read that returned a
  restricted column, is refused when it cannot be logged** (fail closed: the
  response is `503 audit_unavailable`, and the row is not returned). **An ordinary
  school reader's read that would be logged for another reason is served and
  counted** (fail open): a coach at the ground is not locked out of his roster by a
  logging hiccup, and the count is the evidence that it happened;
- the API keeps an in-memory counter of failed log writes since boot and exposes it
  on `/api/health` as `"audit_failed": n`. Keep-warm treats `n > 0` as a warning
  (§12 P9's change makes warnings loud).

### 8.2 Which reads are logged

Today an ordinary school reader is logged only when a watched column comes back
non-null (`read-api.mjs:3488-3494`); a routine roster read is not. Logging every list
render would make the log unreadable and tell a parent nothing he cares about.
**D18**: the log must hold, for every child,

1. every read that returned a restricted column (exists);
2. every read by a platform-wide or support-session reader (exists);
3. **every single-record read of a child's file**: the profile view, the family
   screen's view of one child, the dossier, regardless of which columns came back
   (new: the row's `record_ids` is one child and `fields` says `profile`);
4. **every export**: a CSV, a printable Passport, a report that leaves the screen
   (new; the CSV refusal just merged in #174 is the place the row is written);
5. every read of the audit log and the register (exists for the log; §7.4 for the
   register).

Not logged: a team sheet, a scorecard, a match list, a fixture. Those are the match
record and a name on them is the public rule's business, not the log's.

### 8.3 Retention

**D19.** `access_log` rows are deleted **5 years** after `occurred_at`, as
`ACCOUNT_LIFECYCLE.md` D22 recommends; never minimised (a log with holes is not a
log). `access_log_purge_due()` runs on the one scheduler (§12 A9) and writes one row
to the log saying how many rows it removed and up to which date. Nothing is purged
while an open data event names that period in its evidence note. Q8.

### 8.4 The parent's view

db/08:506 promises a parent a view of who read their child's record; none exists
(map §1). **D20.** `my_child_access_log(player_id, before_key, limit)`, SECURITY
DEFINER, for a live verified guardian of that child (or the pupil himself at 18+):
rows whose `record_ids` include the child, newest first, each saying **when, the
reader's role and school** ("a coach at Westville Boys' High School"; "the school
office"; "SCRBRD support, in a support session the office approved"; "the platform")
and **what kind of record** (`fields` mapped to plain words: "his profile", "his
injury record", "his contact details"). Not the reader's name: s23(1)(b) gives the
data subject the identity *or categories* of those who had access, the category is
what a parent can act on, and a named coach on a parent's phone is a conversation the
school should have in person. The office gives the name on request, from Who Read
What. Safeguarding rows are hidden from this view as from every other (db/57:563;
db/79:169), and the view's own read is logged. The Family screen gains "Who has seen
his record" (Sonnet, A6). Q9.

For the pilot, a parent who asks is answered by the school office from "On the record:
who read what" (`SettingsView.jsx:1187`), and the runbook says so (§10.4).

### 8.5 After a restore

A restore ends the log at the dump's moment (`BACKUP_RESTORE.md:321-322`). **D21.**
A restore is always a data event of kind `outage` whose evidence note records the
gap (dump time to restore time), whether the old database's log could still be read
and where its copy is, and every withdrawal and erasure put back by hand. The first
`access_log` row after a restore is written by the lead, resource `restore`, so the
log itself shows the seam.

### 8.6 Platform-wide `audit.read`

`platformadmin` holds `audit.read` platform-wide (db/01:234; db/86), so the platform
reads every school's log at rest, and nobody wrote down that this is meant (map §1).
**D22.** After the pilot, `platformadmin`'s `audit.read` applies **only inside a
support session at that school** (db/22), stamped as every support read is. The
owner key keeps it (it keeps everything; that is what the second reader is for). For
the pilot: list who holds `platformadmin` today; if it is Kameel alone, nothing
changes on the day. Q10.

### 8.7 Sign-ins

`auth_session` rows are kept a day past expiry (db/85). "Did anyone sign in as the
office last month, and from what" cannot be answered. **D23.** A `sign_in_log`
(person, at, method `google | code`, device class from the user agent, no IP in v1,
Q18) kept **1 year**, written by `app_session_begin()`, read under `audit.read` at
the person's schools and by the person themself on Me. Small; after the pilot.

## 9 · Logging hygiene and secrets

### 9.1 No personal value in a server log

**D24.** The rule: a server log line may carry a code, a route, an id, a time and a
count. Never a value a person typed or a value that is a person (an email, an ID
number, a name, a DETAIL string, a request body). Where it stands today:

| place | today | change |
|---|---|---|
| `server.mjs:1461` | logs `err.code`, `err.message`, **`err.detail`**; a unique violation on `app_user.email` or `official.id_number` puts the value in DETAIL | log `err.code` and `err.constraint`; drop `detail`; for `err.message`, log it only when `err.code` is not a Postgres code (Postgres messages can embed values) |
| `scorebook-api.mjs:467, :502, :521` | logs `e.detail` | same |
| `owner-recovery-api.mjs:50, :59, :62` | logs the email on every attempt, deliberately | log whether the email matched the owner (`true/false`) and the time; the email never. The owner knows his own address |
| `public-api.mjs:659-731` | logs the path with ids | stands: ids and no names |
| `server.mjs:1471` | masks the database password | stands |

A unit test walks `services/api` for `console.error(` and `console.log(` calls whose
arguments include `.detail`, `.email`, `.id_number` or a request body and fails on
any (Opus writes it beside the fix, A12 lists it; the fix itself is pilot-critical,
§12 P4).

### 9.2 Who reads the provider logs, for how long

The repository says nothing about Render's or Supabase's log retention or who can
read them (map §9, §14). **D25.** The production sheet (§9.4) records, for each of
Render, Supabase and Firebase: the account email, who holds the login (today: Kameel;
the deputy after §4.2), the plan's log retention as read from the provider's page on
the day the sheet is written, and whether the provider's Postgres logs include failed
statements. Postgres by default logs the text of a failing statement; the API's
queries are parameterised, so the text should carry `$1` placeholders and not
values, but the lead confirms that on Supabase's log viewer with one deliberate
failed insert on a test row, and writes the answer on the sheet.

### 9.3 The secrets sheet

Rotation is written for two secrets and not for the rest (map §9). **D26.**
`docs/pilot/SECRETS_ROTATION.md` (Haiku drafts from this table; the lead fills the
dashboard paths; **no secret value ever appears in it**):

| secret | where set | rotating it | consequence |
|---|---|---|---|
| `SESSION_SECRET` | Render | set a new value, redeploy | everyone signs in again; on a match day, last and never mid-innings |
| `DATABASE_URL` (the `scrbrd_app` password) | Supabase, then Render | reset the role's password; set the string; redeploy | the API is down for the redeploy |
| the owner connection string (`SCRBRD_PROD_OWNER_URL`) | GitHub secret; Kameel's machine | reset the owner password in Supabase; update the secret | the drill workflow needs the new one |
| `OWNER_RECOVERY_SECRET` | Render | set a new value or unset | recovery closed until set |
| `PUBLIC_PSEUDONYM_SECRET` | Render | set a new value (32+) | every public pseudonym changes; shared public links to pseudonymous ids stop resolving. Rotate only on exposure |
| `BACKUP_PASSPHRASE` | GitHub secret; password manager | new passphrase; re-encrypt kept dumps; delete the drill's encrypted artifacts made under the old one | — |
| `ANTHROPIC_API_KEY` | Render | revoke in the provider console; set the new one | the reader and Stats Magic pause |
| `GOOGLE_WEATHER_API_KEY` | Render | DEPLOYING.md:375 | weather pauses |
| Firebase service credentials, FCM | Firebase console; Render | revoke, reissue | push pauses; sign-in may pause |
| Supabase service and anon keys, Storage | Supabase | regenerate | the photo store pauses |

### 9.4 The production sheet

The docs disagree on where production lives (map §0, §13). **D27.**
`docs/pilot/PRODUCTION_SHEET.md`, one page: for each of the API (Render,
`scrbrd.onrender.com`), the database (Supabase Postgres, Free), the photo store
(Supabase Storage), the web app (Firebase Hosting), sign-in (Firebase Auth / Google),
push (FCM), the backups (Kameel's encrypted dumps; the drill's encrypted GitHub
artifacts), the reader (Anthropic, flag off): the provider, the region if known, the
account email, who holds the login, the status page, how the provider notifies a
breach (which inbox), the log retention (§9.2), and the switches of §6.1 with their
dashboard paths. DEPLOYING.md:9-10 (Cloud Run, Cloud SQL) is corrected to match
(Haiku). No secret and no phone number on the sheet.

## 10 · The match-day outage at Westville

### 10.1 The principle

The pad writes every ball to the phone before it counts it (`sync-engine.mjs:1-16`),
and the app shell is cached (`sw.js`). The paper scorebook is kept by the school's
scorer or the umpires through every match already; the runbook compares the pad to
"the umpires' book" at each innings end. So there is **no switch to paper**: paper is
always the second record, the pad is always the first, and the only decision is made
after play: *is the pad's record whole, or does the importer fill a gap?* **D28:**
that decision is the lead's, and it is a register entry either way.

### 10.2 The runbook text

To add to `docs/pilot/PILOT_DAY_RUNBOOK.md` under "If something goes wrong" (Haiku,
word for word, after Kameel's edits; §12 P1):

> ### The server or the database is down
>
> Signs: the pill stays **Held** or **On device** although the phone has signal; the
> health address does not answer, or shows `"db":"unreachable"`; the pavilion screen
> says "reconnecting".
>
> 1. **Keep scoring on the pad.** Every ball is saved on the phone before it counts.
>    Nothing is lost while the phone works. Do not reload, clear the match or sign
>    out.
> 2. **The paper scorebook is kept as always**, ball by ball. Today it is the second
>    record: check it against the pad at the end of every over, not only at the
>    innings.
> 3. **No handover while the server is down.** If the scoring phone dies, the standby
>    does not claim the match. From that ball the paper book is the only record; the
>    standby writes the time and the over on it and scores on paper.
> 4. **Tell [the match-day lead].** The lead decides nothing during play except
>    whether to suspend the service deliberately (see "The app shows something it
>    should not"). Play goes on.
> 5. **When the server returns the balls send by themselves.** Wait for **Sent**. The
>    pavilion screen catches up on its own.
> 6. **After the match** the lead opens the scorecard and compares it with the book.
>    If every ball is there, nothing more is done. If balls are missing (a lost or
>    dead phone, balls **For review** that cannot be released, a cleared match), the
>    lead imports the book through the scorebook importer, typed by hand (the reader
>    stays off), and the imported balls carry their source. Either way the lead writes
>    a register entry.
>
> ### The app shows something it should not
>
> Another school's boy's details, a name on the pavilion screen where a position should
> be, a date of birth, anything that is not yours to see.
>
> 1. **Do not photograph it, screenshot it or forward it.** Note the time and which
>    screen.
> 2. **Tell [the match-day lead] at once.** The lead can take the public page down
>    (**Withdraw**) in a minute and every public page off in a few. The match goes on
>    on the pad.
> 3. The lead writes a register entry; the information officer and the second reader
>    decide within 24 hours whether families are told.
>
> ### A phone with the app signed in is lost
>
> 1. **Tell [the match-day lead] at once.** The lead or the school office disables that
>    account and signs it out everywhere.
> 2. If it was the scoring phone, the lead force-releases the match so the standby
>    can claim it. Balls that had not been sent are on paper only; the standby carries
>    on from the book.
> 3. The register entry says whether the phone was locked, when the account was
>    disabled, and what was on it.

And under "No signal at the ground", one line after step 4: "If the signal is back
but the pill does not move, see 'The server or the database is down'."

### 10.3 Who to call

**D29.** The runbook's "[who to call]" is four roles, and the numbers live on a
printed card each scorer carries, never in this repository:

| role | for | who at the pilot |
|---|---|---|
| **the match-day lead** | the pill says **For review**; the server or database is down; the app shows something it should not; a phone is lost; whether to import after play | Kameel, at the ground |
| **the school office** | **Waiting for your school office**; a sign-in code; no scoring button on an account | a named Westville office person, agreed with the school by 29 October |
| **the second reader** | a compromise decision when the lead is the subject or is busy on the field; the person the lead phones at T + 1 hour | Westville's information officer until a deputy is named (§4.2) |
| **the standby scorer** | the handover; the paper book if the first phone dies | the second scorer |

Phone numbers go on the card at the go/no-go on 29 October. The repository holds the
roles, the card holds the numbers.

### 10.4 Before the day: checks the design needs

For solo run 2 (27 October) and the production verify (28 October), added to the
runbook's checklist (§12 P6):

- [ ] With the API stopped (or suspended on Render), score six balls on a practice
      match: the pill says **Held**, not **Refused**; on resume they go to **Sent**.
- [ ] With the API up and the database string wrong (a test server), the same: the
      server's 5xx leaves balls **Held**.
- [ ] `PUBLIC_PAGES` off and on again: the pavilion page 404s, then returns, within a
      few minutes; note the time it took.
- [ ] `account_set_active(false)` on a test scorer mid-practice: the pad stops sending
      and holds; enabled again and signed in, it sends.
- [ ] A parent's question "who read my child's record" can be answered from "On the
      record: who read what" by the office in under five minutes.
- [ ] The register template is on the lead's encrypted disk; both scorers hold the
      card; the second reader knows they are it.

## 11 · Third parties

**D30.** Each provider is an operator (or a sub-operator) for the data it holds for
us, and a breach at a provider is a data event of kind `provider` the moment its
notice reaches the inbox on the production sheet:

| provider | what of ours it holds | when its breach is announced |
|---|---|---|
| **Render** | the API process, every environment secret (§9.3), the API's stderr logs (which must by then carry no personal value, §9.1), the request metadata | rotate every secret Render held, in the sheet's order; the register entry lists which secrets, and the log retention tells the window; a compromise only where a secret shows use or a log carried a value |
| **Supabase** | the database (everything), the Storage bucket (scorebook photos of both sides' boys), the Postgres logs, the Auth tables if any | the Postgres project is the database: a confirmed breach of it is kind 6's scope (every school, every family) and the Regulator's notice goes in 72 hours; rotate `scrbrd_app` and the owner string; the dumps are the recovery |
| **Anthropic** (the reader) | page photos in transit, and whatever its terms keep; the sign-off's item 1 is still "to confirm" (`SCOREBOOK_READER_SIGNOFF.md`) | **the flag stays off until item 1 is confirmed in writing** (Q14); while it is off, no photo has left the platform and there is nothing to notify. When it is on: the `read_by` hashes say which pages, the import says which match, the register entry names the match and both schools' officers are told |
| **Firebase / Google** | sign-in identities and emails, hosting, push tokens | a sign-in compromise is kind 5 for every account: rotate `SESSION_SECRET` (everyone signs in again), tell every school's officer; push tokens alone are S4 |
| **GitHub** | the repository, the drill's encrypted dump artifacts, the secrets the workflows use | delete the artifacts, rotate `BACKUP_PASSPHRASE` and the owner string; a readable artifact is kind 6 |

Each provider's own notice is kept with the entry. We do not wait for a provider to
classify for us: the 24-hour clock runs from our discovery, which is their notice.

## 12 · Slices

Migration numbers are TBD; db/114 and db/115 are taken. Every builder commits and
pushes its branch after each step and at least every 30 minutes (CLAUDE.md, "Saving
progress").

### 12.1 By the pilot (before the 26 October freeze; documents may land to 29 October)

| # | what | tier | notes |
|---|---|---|---|
| **P1** | The runbook text of §10.2, the four roles of §10.3, the checks of §10.4, in `PILOT_DAY_RUNBOOK.md`; a paper step in `SCORER_HELP.md` "No signal" | Haiku | word for word from this design after Kameel's edits; the lead reads it before it lands |
| **P2** | The decision chain: Kameel names the second reader for the pilot (D6) and asks Westville for its information officer's name and the office contact; both written in `docs/policy/INFORMATION_OFFICER.md` with the deputy designation when it comes | Kameel; Haiku records | a decision, not code |
| **P3** | `docs/policy/DATA_EVENT_TEMPLATE.md` (§7.1–7.2 as headings, no data) and the rule that the register lives where a dump may live (D16) | Haiku | the pilot's entries are files on the encrypted disk |
| **P4** | Logging hygiene fix (D24): `server.mjs:1461`, `scorebook-api.mjs:467/502/521`, `owner-recovery-api.mjs:50/59/62` | **Opus** | four small edits where a mistake is silent; the unit test may follow (A12) |
| **P5** | `docs/pilot/PRODUCTION_SHEET.md` (D27) and the DEPLOYING.md:9-10 correction | Haiku drafts; the lead fills the provider facts | no secret, no phone number |
| **P6** | The checks of §10.4 run on solo run 2 and the production verify; results written on the runbook's checklist | the lead | confirms the pad's `Held` behaviour this design leans on |
| **P7** | `docs/pilot/SECRETS_ROTATION.md` (D26) | Haiku drafts; the lead fills paths | — |
| **P8** | Confirm on production that `scorebook_reader` is off for every school and stays off through the pilot (D30, Q14); confirm who holds `platformadmin` (D22) | the lead | a read, not a change |
| **P9** | `keep-warm.yml` exits non-zero when health is not `ok:true, db:ok` (and, once A5 lands, when `audit_failed > 0`), so GitHub emails the owner on failure; today it only warns in its own log (`keep-warm.yml:52-57`) | **Sonnet** | one workflow change; the only alert the pilot will have |
| **P10** | Decide Q11: whether `OWNER_RECOVERY_SECRET` is unset for the pilot week | Kameel | — |

### 12.2 After the pilot

| # | what | tier | notes |
|---|---|---|---|
| **A1** | `db/TBD`: `data_event`, `data_event_note`, `data_event_subject` (D13, D14); capabilities `compromise.read`, `compromise.manage`; role `deputyinfoofficer`; RLS as D15; `audit_log()` gains kind `event`; db/99 assertions (no body in the audit row; a school reads only its own; every read logged) | **Opus** | the register |
| **A2** | Same or next migration: notification kind `compromise` in db/89's CHECK and `packages/policy/src/notifications.mjs`; `compromise_notify()` (D9, §7.3); the SG-9 rule holds (`recipient_id` never a pupil under 18) | **Opus** | — |
| **A3** | `PLATFORM_MODE` read-only and closed modes (D12): middleware in `server.mjs`, `/api/health` `mode`, handover's own reason; the app's banner | **Opus** (server); Sonnet (banner) | touches every write route |
| **A4** | `auth_epoch_bump_all()` and `auth_epoch_bump_school(school)` in `db/TBD`: a platform-wide and a per-school sign-out that does not need a secret rotation; a `system` notice to those signed out | **Opus** | replaces "rotate `SESSION_SECRET`" as the session kill switch |
| **A5** | `db/TBD` re-creating `log_restricted_read()` returning boolean (D17); the API's fail-closed and counted paths; `audit_failed` on health; `access_log_purge_due()` (D19); the broader logging of D18 (profile reads, exports) | **Opus** | the log the Regulator is answered from |
| **A6** | `my_child_access_log()` (D20) and the Family screen's "Who has seen his record" | **Opus** (function); Sonnet (screen) | the promise at db/08:506 |
| **A7** | Owner-key and recovery alerts: a `compromise` row to the officer and deputy whenever `/api/auth/owner/recover` is called or a code is issued, and whenever the owner key reads a school's data outside a support session (`platform_wide` rows, db/20) | **Opus** | the deputy sees what the owner does |
| **A8** | `platformadmin`'s `audit.read` narrowed to support sessions (D22) | **Opus** (policy, RLS) | — |
| **A9** | One scheduler for every purge: scorebook pages (db/63:1284), lifts (db/76), register redaction (db/92), `access_log` (A5), `sign_in_log` (A10): a GitHub Actions schedule calling platform routes with a key, or `pg_cron` on Supabase; the lead picks | **Opus** design note; Sonnet build | ends "run it by hand" (DEPLOYING.md:421-426) |
| **A10** | `sign_in_log` (D23) | **Opus** | small |
| **A11** | The officer's register screen in Settings: open events with their clocks red past deadline, the notes, the subjects list under `compromise.manage`; an in-app "Report a data problem" form for staff and parents that opens an entry (the safeguarding form's shape, less its fields) | Sonnet over A1 | — |
| **A12** | The logging unit test (D24); `docs/policy/` gains the s22 notice templates (Regulator; family email; website) with s22(5)'s four parts as headings, for the lawyer to mark up | **Opus** (test); Haiku (templates) | — |
| **A13** | Doc conflicts (§14) settled as Kameel decides | Haiku | — |

Not in this design, noted for their own: `retention.mjs` and `account_erase()`
(`ACCOUNT_LIFECYCLE.md` D22, §6.3), the safeguarding purge and the SAPS/NDSO referral
route (`SAFEGUARDING_DSO.md` §9.5). This design's A9 is the scheduler they will share.

## 13 · Questions for Kameel

Each with the recommendation, so "as recommended" is an answer.

1. **Words.** *data event* for everything in the register, *security compromise* for
   the s22 subset, notice kind `compromise`, table `data_event` (D1).
   **Recommend: yes.**
2. **The second reader.** Designate a deputy information officer in writing, not a
   person you supervise; until then, the school's own information officer is the
   second reader for its pupils' events; disagreement means notify (D6).
   **Recommend: yes, and ask Westville for its officer's name at the go/no-go.**
3. **Responsible party or operator.** SCRBRD prepares every notice; the school's
   officer co-signs those about its pupils; one Regulator notice in both names (D4).
   **Recommend: yes, with the lawyer confirming the standing (Q17).**
4. **The clock.** Contain T+1h; classify and tell the school T+24h; the Regulator
   by T+72h from discovery for a compromise; families with the Regulator or by
   T+7d; review T+30d (D10). **Recommend: as written.**
5. **The lost-phone threshold.** A locked phone whose account is disabled and signed
   out within the hour is a data event, not a compromise; unlocked, or used after
   loss, is a compromise (kind 1). **Recommend: yes, marked [lawyer].**
6. **The pilot's kill switch.** Suspend the Render service; `PUBLIC_PAGES` off for
   the public; the deputy gets a Render login before 31 October (D11). Read-only
   mode after the pilot (D12). **Recommend: yes.**
7. **Register retention.** 7 years after the closing note; the school's `audit.read`
   holders read their own school's events (D15). **Recommend: yes.**
8. **The audit log.** 5-year retention; restricted and platform reads refused when
   they cannot be logged, ordinary reads served and counted; single-record file reads
   and exports logged (D17–D19). **Recommend: yes.**
9. **The parent's view** shows the reader's role and school, not the name; the office
   gives the name on request (D20). **Recommend: yes.**
10. **`platformadmin`'s platform-wide `audit.read`** narrowed to support sessions
    after the pilot (D22). **Recommend: yes.**
11. **Owner recovery during the pilot week.** Unset `OWNER_RECOVERY_SECRET` from 26
    October to the day after the pilot, if DEPLOYING.md's gate means an unset secret
    closes the route; set it again after. **Recommend: yes, if you will not need it
    that week.**
12. **The match-day decision.** Nobody switches to paper; the pad is the first
    record and the book the second; the lead decides after play whether the importer
    fills a gap, and writes an entry either way (D28). **Recommend: yes.**
13. **The family route.** Email under s22(4)(b) from the officer, co-signed by the
    school's officer; a `compromise` notice in the app; the school's channel at the
    school's choice; the website only for a public-page scope or at the Regulator's
    direction (D8). **Recommend: yes.**
14. **The reader.** `scorebook_reader` stays off at every school until the sign-off's
    item 1 (retention and training terms) is confirmed in writing; the signature of
    2 October is read as conditional on items 1–7, as it says (D30).
    **Recommend: yes.**
15. **At the school.** The principal (as the school's information officer) always;
    the DSO only for S1, through a concern; the director of sport and office for
    what they must do (D7). **Recommend: yes.**
16. **Keep-warm fails loud** so GitHub emails you on a failed health check (P9).
    **Recommend: yes, before the freeze.**
17. **A lawyer.** One hour with a South African privacy lawyer on §3.4, §4.2 (s56)
    and D4, before the pilot if one can be found this week, otherwise before the
    first school beyond Westville; the templates of A12 are what they mark up.
    **Recommend: before the first school beyond Westville at the latest.**
18. **IP addresses in the sign-in log** (D23). An IP is personal information under
    POPIA and would make the log itself something to protect. **Recommend: no IP in
    v1; device class and method only.**
19. **The 72 hours.** The Act says "as soon as reasonably possible"; 72 hours is our
    own ceiling. Keep it as a ceiling, or set a shorter one? **Recommend: keep 72 as
    the ceiling and aim for 24 when the scope is already known.**

## 14 · Doc conflicts this design needs settled

From the map's §13, each with the answer this design assumes until Kameel says
otherwise (Haiku records the decision, A13):

- **Hosting.** Render and Supabase (`BACKUP_RESTORE.md`; `PILOT_DAY_RUNBOOK.md:24`),
  not Cloud Run and Cloud SQL (`DEPLOYING.md:9-10`). Postgres version as the
  Supabase project reports it, not `backup-drill.yml:53`'s 17 by assumption.
- **The first match** is 31 October (`PILOT_DAY_RUNBOOK.md`), not 15 October
  (`BACKUP_RESTORE.md:4`). The pre-pilot dump and the drill move with it.
- **`system` notice life** is 180 days (NOTIFICATIONS.md D2) or two years (D22 there;
  `ACCOUNT_LIFECYCLE.md:696`): this design's `compromise` notice is two years, with
  the register; `system` is the notifications design's to settle.
- **Lifts** are three years (db/76; DEPLOYING.md:571), not one season
  (`ACCOUNT_LIFECYCLE.md:692`); the built code is the fact.
- **The owner key with no school** (`SCRBRD_RISK_REGISTER.md:22`) stays open in the
  risk file; A7 and D22 are its answer, and the risk file should say so when they
  land.
