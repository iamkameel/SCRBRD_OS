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
  classifying a compromise; families with the Regulator or within 7 days; a review
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
| **S3** identifying data only | names, initials and surnames, team sheets, ages groups, the fact of a sign-in | the school's information officer within 24 hours; notify if a compromise, in proportion |
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

