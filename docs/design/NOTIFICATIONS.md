# Notifications — one model for the whole app

**Decided 2026-10-07 (Kameel): approved as recommended; S0 (lock the hand-written notice route) built now, S1–S5 after the pilot.** S0 built (#90, merged 2026-10-08). Pulled forward 2026-10-08 (Kameel): S1–S5 now, not after the pilot. S1 built (#97, merged 2026-10-08; db/89 live).

Design for Kameel's review (Fable, 2026-10-07). Only S0 is built (#90, merged 2026-10-08). Opus
builds from it; Sonnet takes the screens over the routes once they exist.

Haiku's map of what exists is the basis (`notifications-map.md`, scratchpad,
2026-10-07). Three of its gaps were checked by the lead before this was written:
nothing writes `notification_read` (8.1); the publish route checks only that its
strings are non-empty (8.3); no system-written notice is ever pushed (8.5).

Line numbers below are `origin/main` at `6fe31ae`.

## 0. The problem in one paragraph

`notification` (db/08:220) is a good table with no contract around it. `kind` is
free text written by eight SQL functions and one route. Nothing is ever pushed
unless a person presses a button that no screen has. Read state is kept in one
component's memory, so every badge counts every notice for ever. Nothing can be
taken back. Eight designs now each assume a piece of a notifications model that
does not exist: corrections (GA-I36 D4), recognition (D6, D18, D20, D25),
account lifecycle (D20, D21), the parent's action list, lift clubs, safeguarding,
workload and the captain's view. This document is that model.

## 1. The rules this design keeps

- **A notice can reduce what someone receives. It never expands what they may
  know.** db/08:218, `tables.mjs:692`. RLS decides who sees a row; nothing in
  this design asks that question a second time.
- **No child's name on a lock screen or a public page** (`PUBLIC_DATA.md`;
  `push-api.mjs:41-61`). Every push is a pointer.
- **SG-9 stands**: `recipient_id` never names a pupil unless the notice is
  `kind = 'system'` (db/57:597-608, `CSA_SAFEGUARDING_CHECK.md:583-586`).
- **The DSO's notices name nobody** (`SAFEGUARDING_DSO.md` decision 3).
- **A safeguarding notice is the system's**: nobody inserts or updates one
  through a route (db/57:584-592).
- **The match record is append-only.** This design writes no `ball_event`.
- **No platform role gains school authority.** The worker that pushes acts as
  each recipient, never as a superuser over the notice.
- **Welfare notices gain no quiet hours** (SCRBRD-136 D11).
- **`is_public` is dormant** (SCRBRD-142 lead note 2). This design removes its
  one reader.

## 2. Kinds and their contract

### D1 · One closed list of kinds, enforced in the database

`kind` gains a CHECK in a new migration (db/08 is frozen; a constraint added by
`ALTER TABLE` in `db/NN` is how db/57 added `recipient_id`). The list, with the
word each means:

| kind | means |
|---|---|
| `injury` | an injury record was opened, changed or cleared |
| `recognition` | a milestone, an honour, a record |
| `welfare` | a bowling directive breached; a wellness flag; a referral |
| `safeguarding` | a concern raised, shared, or a claim declined |
| `system` | a fact about the reader's own account, role, link or seat |
| `availability` | an answer is wanted about a fixture |
| `fixture` | a fixture published, moved, cancelled, or a round decided |
| `lift` | a seat's state; a day-safety alert |
| `notice` | **new.** Words a person wrote, to a side, a school or a competition |

The same list lives once in code, `packages/policy/src/notifications.mjs`
(`KINDS`, `SUBJECT_KINDS`, the per-kind table below), and a unit test reads the
migration and asserts the CHECKs agree with it. `push-api.mjs`'s own
`SUBJECT_KINDS` (35-39) imports from there.

### D2 · The per-kind contract

"Writer" is who may insert. "Audience" is how RLS admits a reader: the generated
policy demands `news.read` **and** `required_capability` in the row's scope
(`tables.mjs:716-718`), the anchors (731-735), and the RESTRICTIVE
`recipient_id` cut (db/57:579-580). "Lives" is the default `expires_at` a
trigger sets when the writer leaves it null (D4).

| kind | writer | required_capability | audience anchor | urgency | pushed | retractable | lives |
|---|---|---|---|---|---|---|---|
| `injury` | `notify_injury()` (db/08:1381) | `medical.nature.read` | team + `subject_person_id` | medium; high if severe | yes | no (a cleared or changed record writes its own notice) | 90 days |
| `recognition` | `milestone_notify()` (db/08:5699); the recognition design's honour and record notices | `news.read` | side: team scope; family: one row per live guardian with `recipient_id` (D7) | side's live notice low; family's sealed notice medium | low: no; medium: yes | **yes**, by the system on a void (GA-I36 D4, recognition D20) | 180 days |
| `welfare` | `bowling_breach_watch()` (db/08:5284); SCRBRD-110's flag and referral | `player.workload.read`; `wellness.alert`; `wellness.read` with `recipient_id` for a referral | team + `subject_person_id`; referral by `recipient_id` | high; referral medium | **always**; no preference, no quiet hours | yes, by the system when the breach no longer folds (GA-I36 Q6) | 30 days |
| `safeguarding` | db/57's functions; SCRBRD-140 D7 | `safeguarding.concern.read`; `news.read` for a share | school; `recipient_id` for a share or a suspension | high; share medium | **always**; no preference, no quiet hours | **never** | 30 days |
| `system` | `role_assignment_end()` (db/77:406); lifecycle D20; db/65 and db/70 for a pupil; SCRBRD-140 join notice | `news.read`; `user.role.assign` for the join notice | `recipient_id`, read through a door (`notification_role_ended`, db/77:258) | medium | yes; no preference; minors' quiet hours apply | no | 180 days |
| `availability` | `availability_ask_again()` (db/65:317) | `availability.read` | team + `subject_person_id` | medium | yes; preference allowed | no; expires at the fixture's start | the fixture's start |
| `fixture` | `progression_check()` (db/72:236, 247) | `fixture.read`; `competition.manage` | team or competition | published low; moved or cancelled medium | low: no; medium: yes | yes, by the system when a later change supersedes it (`retraction_kind = 'superseded'`) | the fixture's start + 7 days |
| `lift` | db/70:782, db/76:179-260 | `transport.*` as db/70 and db/76 draw them | `recipient_id` (the asker, the driver, each live guardian) | seat medium; day-safety high | yes; preference allowed for medium; high always | no (a changed seat writes a new notice, SCRBRD-124 decision 13) | the lift's `meet_at` + 1 day |
| `notice` | **only** the `news_post` trigger (D10); never a route | `news.read`, forced | team, school or competition; **no** `subject_person_id`, **no** `recipient_id` | low or medium, the author's choice; never high | low: no; medium: yes; preference allowed | yes, by the author or a `news.publish.school` holder, through the post's withdrawal | 60 days |

Three rules fall out of the table and are enforced, not promised:

- **D3 · Push is decided by urgency alone.** `low` is in-app only. `medium` is
  pushed, may be muted by a preference, and is held through a minor's quiet
  hours. `high` is always pushed, to everyone the row admits, at any hour. No
  kind-specific push code anywhere.
- **D4 · Defaults and shape are a trigger.** `notification_contract()` BEFORE
  INSERT: sets `expires_at` by kind when null; refuses `kind = 'notice'` with a
  `subject_person_id`, a `recipient_id`, `urgency = 'high'` or a
  `required_capability` other than `news.read`; refuses `is_public = true` for
  every kind (the flag stays dormant and empty, SCRBRD-142). It replaces nothing
  in db/57's SG-9 trigger, which stays.
- **D5 · `subject_kind` gains `welfare` and `news`.** The CHECK (db/08:246) is
  dropped and re-added in the same `db/NN`, as SCRBRD-110 planned (lines
  269-273). `welfare` for the breach and flag notices (today they say `match`,
  which is the fixture, not the subject). `news` for a `notice` row, whose
  `subject_id` is the post.

### D6 · `is_public` chooses nothing

`buildPayload()` (push-api.mjs:63-82) loses its `is_public` branch. Every push is
a pointer. The column stays, dormant and documented, as SCRBRD-142 asked; D4
keeps it false. The `notification_public_is_general` CHECK and the index are
left alone (frozen file, and harmless). A `db/99` assertion: no row is public.

## 3. Who gets what

### D7 · Four shapes of audience, and nothing else

| shape | how it is addressed | who reads it |
|---|---|---|
| **the side** | `scope_level = 'team'`, `team_code`, no person | every assignment in the team that holds `news.read` and the row's capability: coaches, scorer, every pupil on the side, every guardian scoped to a child on the side (STEP4 P5; recognition A19) |
| **the school** or **the competition** | `scope_level`, no team, no person | every assignment at that anchor with the capabilities |
| **about one child** | the side's shape **plus** `subject_person_id` | the team's staff with the capability; the child's own guardians through the person anchor; **never** another family (`tables.mjs:727-735`). The pupil himself only when the capability is one he holds, which for `injury`, `welfare`, `lift` and `availability` it is not |
| **to one person** | `recipient_id` (db/57), with the anchors still set | that person only, if the anchors and capability also admit them, or through a door (`notification_role_ended`, lifecycle's `account_status_change.notice_id`, `guardian_link_ending.notice_id`) |

**A notice to a family is one row per live guardian**, `recipient_id` the
guardian, `subject_person_id` the child: db/76's `lift_notify_family()` pattern
(SCRBRD-124 decision 13). This is how recognition D6's sealed notice, lifecycle
§3.5's "Rohan left" notice and GA-I20's words reach a parent and not the side.
A single row addressed by capability cannot do this: `player.profile.read` is a
coach's too.

**A parent with two children** reads two sets of rows, each anchored on one
child's school and `subject_person_id`. Notices labels each row with the child
it names (STEP4 P5) and never sums across schools (GA-I20 D10). **A child at
two schools** is two `player` rows; each school's notices anchor on its own.
Nothing joins them.

**A pupil** (and the eighteen-year-old still at school) reads the side's rows
under `news.read`: the team plan (SCRBRD-138 §5.2), the side's "Fifty for Rohan"
(recognition D6), a fixture moved, a `notice`. He reads a row addressed to him
alone only when it is `system` (SG-9). He never reads `injury`, `welfare`,
`safeguarding` or `lift`, because he holds none of their capabilities.

**A person with no live assignment at a school** reads nothing from it except
through a door. A door admits exactly one row by its audit record and never a
row somebody published (db/77:251-260 is the pattern; lifecycle copies it).

### D8 · The address book is widened by one case

`push_candidates(school)` (db/08:3749) enumerates live tokens of people with an
active assignment at the school. A `recipient_id` row whose recipient has just
lost that assignment — db/77's role-ended notice, lifecycle's link-ended notice
— is therefore never pushed (map 8.12). New: `push_candidates_for(notice)`
returns that recipient's own live tokens when `recipient_id` is set, and falls
back to the school enumeration otherwise. It still decides nothing: every row
goes back through the notice's own policy as that person (push-api.mjs:187-204).
A disabled account fails `app_session_begin()` and is told nothing (lifecycle
§2.5, stands).

## 4. Writing a notice

### D9 · People write posts. The system writes notices.

Today a person with `news.publish.team` can `POST /api/notifications` with any
`kind`, any `required_capability`, a `subject_person_id` and a body that names a
medical condition (map 8.3). Nothing in the route or the policy ties the tier
declared to the words written, and nothing can: a machine cannot read a body
for a disclosure.

So the shape is tied instead. **A person's words become a `notice` row only
through `news_post`.** The route `POST /api/notifications` is **closed** (410)
and `POST /api/notifications/:id/push` with it (S3 pushes without a button).
`news_post` already has what a person needs: three scopes under
`news.publish.*`, a title of 3-140, a body of 1-4000, drafts, withdrawal
(`db/12`, SCRBRD-142 §4). It gains one column, `urgency IN ('low','medium')`
(default `low`), shown on the compose screen as **"Send to phones too"**.

### D10 · The post's trigger writes the notice

AFTER INSERT OR UPDATE on `news_post`, SECURITY DEFINER:

- `published_at` becomes non-null → one `notification`: `kind 'notice'`, the
  post's scope and anchor, `required_capability 'news.read'`, `urgency` from
  the post, `title` the post's title, `body` the post's first 280 characters,
  `subject_kind 'news'`, `subject_id` the post, `published_by` the author, no
  person. Opening the row opens the post.
- the title or body of a published post changes → the row's title and body are
  re-synced. The row's `published_at` does not move.
- `published_at` goes back to null (withdrawal) → the row is retracted,
  `retraction_kind 'withdrawn'`, `retracted_by` the withdrawer (§7).

The old merge of two streams in `family.jsx:113-131` goes: Notices reads
`notifications` only; News reads `news_post` as it does. This is the close of
map 8.4.

### D11 · What a person-written notice may not contain, and how that holds

| may not | held by |
|---|---|
| a tier above `news.read` | D4's trigger refuses; `news_post` has no such column |
| a child as subject, or one person as recipient | D4's trigger refuses; `news_post` has no such column. A post about one boy is still a post to the side, which is the SG-9 rule for any message (138 §5.1) |
| `high` urgency, so a muted parent or a sleeping pupil is reached | the `news_post` CHECK; D4 |
| medical, home or disciplinary facts about a child | **not machine-checkable.** Three things stand in for it: the compose screen says, above the body, "Everyone on the side reads this, pupils and parents too. Nothing about a child's health, home or discipline; those have their own screens." The post is retractable by the author and by any `news.publish.school` holder at the school (SCRBRD-142 finding 1, applied here). And **any reader may report a notice in one tap** (CSA SG-9 rule 4): `notification_report(id)`, SECURITY DEFINER, writes one no-name `safeguarding` row to the school's DSOs, "A notice was reported at your school; open Safeguarding to see it", with the notice id in `subject_id`, and refuses a second report of the same notice by the same person |
| a public reading | D4 keeps `is_public` false; public news is SCRBRD-142's `news_post.is_public` path, not this table |

**Audit:** the `notice` row itself (`published_by`, `published_at`, `subject_id`
the post) is the record of publishing. A retraction writes `access_log`
`notification.retract` (person, notice id, school) (§7). A report writes the
DSO's notice and an `access_log` `notification.report` row readable by
`safeguarding.concern.read` only, as db/57 keeps its own rows.

### D12 · Before the pilot: lock the route; after it: close it

Until S2 lands, `POST /api/notifications` is **locked** (S0, no migration):
`kind` must be `notice`; `requiredCapability`, `isPublic`, `subjectPersonId`
and `recipientId` are refused if present; `urgency` ≤ `medium`;
`subjectKind` from the shared list. No web code calls the route (map §3), so
nothing breaks. See §10 on whether S0 goes before the pilot: yes.

## 5. Delivery

### D13 · A notice is pushed after commit, by a worker, as each recipient

No button. The mechanism, in order:

1. **Outbox.** AFTER INSERT on `notification`, `notification_enqueue()` writes
   one row to `notification_push_job (notification_id PK, state
   queued|done|dropped, due_at, attempts, claimed_at, claimed_by, last_error,
   done_at)` when `urgency <> 'low'`, and `pg_notify('notification_push', id)`.
   The table is the app's, not a person's: owned by `scrbrd_app`, no per-person
   policy, in the manner of `push_candidates()` (db/08:3749-3765). Opus settles
   the exact grant.
2. **Wake and poll.** One `LISTEN` in `services/api/notify/worker.mjs`, and a
   60-second poll of `due_at <= now()` so a restart loses nothing and retries
   run. A job is **claimed** before work (`UPDATE … SET claimed_at = now(),
   claimed_by = $instance WHERE claimed_at IS NULL OR claimed_at < now() -
   interval '5 minutes' RETURNING`), so two API instances send once.
3. **Re-read the notice.** Expired (`expires_at <= now()`) or retracted →
   `dropped`, nothing sent (closes map 8.6: expiry honoured before any wire).
4. **Enumerate** with `push_candidates_for(notice)` (D8), grouped per person.
5. **Per person, as them:** `select 1 from notification where id = $1` under
   `withPrincipal` (push-api.mjs:187-204, unchanged). Not visible, or
   `AuthError` (disabled) → skipped, no row (map 8.15: intended; a person who
   is not the audience leaves no trace). Visible → the preference and quiet
   hours check (§8); muted → skipped, no row; held → this person is left for
   the next run and the job's `due_at` becomes the earlier of its current value
   and the quiet-hours end. Any token already `sent` for this notice → skipped.
6. **Send** each remaining token; record `notification_delivery` as the
   recipient, exactly as today (push-api.mjs:217-245), retire a rejected token.
7. **Retry.** If any delivery is `failed` (not `rejected`) and `attempts < 5`,
   the job's `due_at` = now + 1 min, 5 min, 30 min, 2 h, 8 h by attempt, capped
   at `expires_at`. Otherwise `done`. Closes map 8.14.
8. **Not configured.** No transport → jobs stay `queued`, untouched, until one
   appears or they expire. Nothing is marked failed for a key nobody set.

`fanOut()` keeps its body but loses step 1's caller gate (push-api.mjs:141-160):
the worker has no caller. The gate was "pushing is publishing"; now publishing
is writing the row, and the row's own policy is the gate, asked once per person.

### D14 · The pointer

The payload is `{notification: {title: "SCRBRD", body}, data: {notificationId}}`
and nothing else (push-api.mjs:76-81, stands). `body` is one of two fixed
strings: "You have a new notice." for `medium`, "You have a notice that needs
you now." for `high`. Neither names a kind, a child, a school or a side (Q1).
Priority is metadata, not content: `high` sets FCM `android.priority = "high"`
and `apns-priority 10`, so a welfare page wakes a dozing phone; `medium` sends
normal. The service worker (`firebase-messaging-sw.js:31-41`) shows what it is
given and looks nothing up (stands).

### D15 · Token refresh, credentials, and "unavailable" said plainly (I17)

- **Refresh.** On every app start with permission already granted, the client
  calls `getToken()` and `POST /api/devices {token, platform, label}` again.
  The route becomes an upsert as the person: a live row with this token →
  `last_seen_at = now()`; a new token → inserted, and this person's other live
  `web` rows for the same `device_id` retired `replaced` (the existing reason,
  db/08:3620-3621; no new value, no frozen CHECK touched). FCM's web SDK has no
  refresh event; a re-register on open is the supported pattern.
- **Stale.** The worker retires tokens with `last_seen_at < now() - 90 days`
  as `stale`. A phone that opens the app keeps its token fresh by the rule
  above.
- **Credentials.** `transportFromEnv()` (fcm.mjs:110-124) implements
  `FCM_SERVICE_ACCOUNT`: an RS256 JWT signed with `node:crypto`, exchanged at
  `oauth2.googleapis.com/token`, cached until five minutes before expiry. No
  new dependency (CLAUDE.md). `FCM_ACCESS_TOKEN` stays as the manual path. The
  key is a Render secret, never in the repo (Q10).
- **Said plainly.** `GET /api/read/my_devices` (read-api) gains an envelope
  `push: {available: boolean, reason: 'ok'|'not_configured'|'unsupported'}`
  (server side: transport present; client side: `pushSupported()`, and on iOS
  "add to Home Screen first"). Settings → Alerts shows, in words, "Alerts to
  this phone are not available right now. Every notice is still in the app."
  with the reason, and disables the toggle. Never a spinner, never a silent
  no-op.

### D16 · Foreground and deep links (8.8)

- `App.jsx` wires `onPushWhileOpen()` (push.js:118-124) at mount: on a message
  it refetches `notifications` and `summary`, then shows one in-app bar, "New
  notice ›", whose words come from the governed read and never from the
  payload (the payload is a pointer). Reduced motion: the bar appears without
  sliding.
- `/app?notice=<id>` (the worker's `notificationclick`, sw:43-48): `App.jsx`
  reads the parameter once, opens Notices with that row expanded, marks it
  read (§6), and drops the parameter from the URL. The row is fetched by id
  through `notification_by_id(id)` (§7); if nothing comes back the screen says
  "This notice is no longer available." and nothing more, the same words for
  "expired", "not yours" and "never existed".

## 6. Read state and counts (I12)

### D17 · One view, one count, one receipt table

- **`my_notifications`**, a `security_invoker` view: `notification` rows the
  policy admits, not expired, not retracted, LEFT JOIN `notification_read` as
  `read`, the retracts-pointer of §7. The `notifications` read resource
  (read-api.mjs:609-619) selects from it, with `LIMIT 200`. The summary's
  `unread_alerts` (read-api.mjs:701-705) becomes `count(*) from
  my_notifications where not read`. The two cannot disagree: same view, same
  session.
- **Receipts** are `notification_read` rows (db/08:279), written as the reader
  by two routes: `POST /api/notifications/:id/read` and
  `POST /api/notifications/read-all` (`INSERT … SELECT id FROM
  my_notifications WHERE NOT read ON CONFLICT DO NOTHING`, under RLS; the
  insert policy at db/08:1833-1837 already demands self and visibility). Read
  state is per person across every device.
- **What marks a row read:** opening it in Notices; arriving by deep link;
  "Mark all read". Appearing in a list does not. A `notice` row is read the
  same way, which gives news posts the read state they lack (map 8.4).
- **One client store.** `useNotifications()` holds the list and the count from
  the two reads above, and every badge reads it: `TopBar.jsx:16`,
  `Sidebar.jsx:108`, `MobileNav.jsx:120`, `App.jsx:388`, `DashboardView.jsx:335`,
  `family.jsx:131`, `cards.jsx:132`, `PitchDeckView.jsx:595`. Local `readIds`
  (NotificationsView.jsx:21-34) goes. An optimistic decrement is allowed, then
  the summary is refetched.
- **Opening a tiered notice is a disclosure.** For a row whose
  `required_capability` is not `news.read` (injury, welfare, safeguarding, a
  referral), the list shows the **title** only (today's titles name nobody:
  "Injury recorded", "Bowling directive exceeded") and the body on open; the
  open is logged to `access_log` (`resource 'notification.open'`, `record_ids`
  [the notice], `fields ['body']`), as `log_restricted_read()` logs a read of
  the record behind it. A `news.read` row shows its body in the list and is
  not logged.

**Test that would have caught today:** `smoke-summary.mjs:92-94` marks one row
read and asserts `unread_alerts` fell by one and the list's `read` flipped, on
a second device session.

## 7. Retraction

### D18 · Three columns, one function, one door

`notification` gains `retracted_at timestamptz`, `retracted_by uuid REFERENCES
app_user(id)` (null = the system), `retraction_kind text CHECK IN
('correction','withdrawn','superseded')`, and `retracts_id uuid REFERENCES
notification(id)` (set on a "withdrawn" notice, pointing at what it withdraws).
`milestone_notice` gains `retracted_at` as GA-I36 N4 says.

`notification_retract(p_id, p_kind, p_say boolean)`, SECURITY DEFINER:

- sets the three columns on the row (refusing a `safeguarding` row, and
  refusing a person whose `p_kind` is `correction`: that word is the system's);
- when `p_say`, inserts **one** "withdrawn" notice: the same `school_id`,
  `team_code`, `scope_level`, `required_capability`, `subject_person_id` and
  `recipient_id` as the original (so exactly the original's audience), the
  same `kind`, `retracts_id` the original, `urgency` = the original's capped to
  `medium` (so a phone told a false thing is told it was false, and a notice
  nobody was paged about pages nobody now: Q7), title "A notice was withdrawn",
  body by kind in plain words: "'Fifty for D Erasmus' was withdrawn after the
  scorecard was corrected." The family words of recognition D20 §6 for a
  family row. It names a child only where the original did, to the same
  readers;
- enqueues the "withdrawn" row like any other (D13);
- writes `access_log` `notification.retract` when `retracted_by` is a person.

Who may call it: the system's triggers (GA-I36 N4 `milestone_retract()`, its
breach re-check, recognition D19/D20/D21, D10's post withdrawal,
`progression_check()` superseding a fixture notice) with `correction` or
`superseded`; the author of a post or a `news.publish.school` holder at its
school with `withdrawn`, through the post's withdrawal only. No route retracts
a `notification` directly.

### D19 · What readers see

- Every read of §6 excludes retracted rows; so do `recognition()` (db/08:5762)
  and `milestone_notice_read` (db/08:5693), per GA-I36 N4.
- `notification_by_id(id)` (D16) returns a retracted row the caller may read as
  a **stub**: `{id, withdrawn: true, retracted_at, retracts_id of its
  "withdrawn" notice}` and no title or body. The screen says "This notice was
  withdrawn on 3 October" and shows the "withdrawn" notice beneath it
  (GA-I36 Q4: hide it and say so). An unseen caller gets nothing (D16's one
  sentence).
- **Un-retract** (recognition D20, Q7, stands): a mark re-reached clears
  `retracted_at`, `retracted_by` and `retraction_kind` on the **same** row and
  sends no second notice. Its "withdrawn" notice is itself retracted
  (`superseded`, no say), so the list does not read "withdrawn" about a notice
  that stands. The row's `published_at` is unchanged; it reappears where it was.
- **A phone that already showed the push.** The pointer said nothing, so
  nothing false is on the lock screen. Best effort, the worker sends a
  **data-only recall** `{data: {notificationId, recall: "1"}}` to every token
  with a `sent` delivery for the row; the service worker, on a message with no
  `notification` and `recall`, closes any shown notification with that `tag`
  (sw:40 sets `tag` to the id already) and shows nothing. Not recorded as a
  state; `detail` on the delivery row notes `recalled <time>`. A tap on a
  recalled-too-late push lands on D19's stub.

## 8. Quiet hours and preferences

### D20 · Preferences govern push only. Notices shows what RLS delivers.

STEP4 P5 stands. A preference never hides a row from Notices, the badge or the
parent's action list (GA-I20 D2: the first thing a filter hides is a consent
nobody answered).

`notification_pref (person_id, kind, subject_player_id, push boolean NOT NULL,
updated_at)`, PRIMARY KEY `(person_id, kind, coalesce(subject_player_id,
zero-uuid))`. Identity-governed like `device_push_token` (db/08:3670-3678): own
rows only, no capability. A CHECK refuses `kind IN ('safeguarding','welfare',
'system')`. The worker applies a row at step 5 of D13 to `medium` notices only
(`high` is never muted, D3); a row with `subject_player_id` applies to notices
whose `subject_person_id` is that child; a row without applies to the kind.

| who | may switch off push for | may never switch off |
|---|---|---|
| **a parent**, per child and per kind (STEP4 G9, now built) | `notice`, `recognition`, `fixture`, `availability`, `lift` (seat notices) | `lift` day-safety (high), `injury` severe (high), `system`, anything `high` |
| **a pupil** (and the eighteen-year-old at school) | `notice`, `recognition`, `fixture`, `availability` | `system`; anything `high`. He holds no `lift`, `injury`, `welfare` or `safeguarding` rows to mute |
| **staff** | `notice`, `recognition`, `fixture` | `welfare`, `safeguarding`, `injury` severe, `system`, `lift` day-safety |
| **a DSO** | as staff | `safeguarding`, which cannot even have a row |

Settings → Alerts shows the kinds the person actually receives (derived from
their roles), each with its toggle, and the locked ones in words: "Always on:
safety and welfare notices." A parent's screen groups by child.

### D21 · Quiet hours for minors are fixed by the platform

A person for whom `person_is_pupil()` (db/57:292) is true receives no `medium`
push between **21:00 and 06:00 Africa/Johannesburg** (Q4). Held notices are
sent at 06:00 by D13 step 5. `high` is never held: the one `high` row that
reaches a pupil today is the eighteen-year-old's own day-safety lift alert
(SCRBRD-124 decision 13, `lift_alert_family()`), and a boy left in a car is
told at any hour. A severe-injury notice does not reach a pupil at all. Not
school-set (GA-I20 D3's reason) and
not a pupil's own setting: a minor does not set the hours he is left alone.

Adults get no quiet hours in v1 (Q5); per-kind preferences are the adult's tool.
Welfare notices acquire none, ever (SCRBRD-136 D11, stands; enforced because
they are `high`).

## 9. Leavers and disabled accounts (8.12)

- **The role-ended notice is pushed** (Q6), as a pointer, through D8's recipient
  path. The person has lost the assignment; the notice is the fact they most
  need on a phone. It reads through db/77's door (stands).
- **A pupil who leaves** gets db/77's `system` notice (lifecycle §3.5), pushed
  under D21's hours. His guardians each get their family row (D7).
- **A disabled account** is pushed nothing (lifecycle §2.5, stands):
  `app_session_begin()` refuses, step 5 skips. Disabling retires that person's
  live tokens `signed_out` (lifecycle D20's words, "every device was signed
  out", made true for push too). On re-enable the one `system` notice is written
  and pushed only after the person has registered a device again.
- **A dead token's holder** is told "You were signed out. Sign in again." at
  sign-in, never by push (lifecycle D21, stands).
- **Erasure.** `notification.recipient_id` and `subject_person_id` cascade
  (db/57:573, db/08:257); `notification_read`, `notification_delivery`,
  `notification_pref` and `notification_push_job` cascade with the notice or
  the person. `access_log` rows stay, as they do for every resource.
- **Retention.** Notices two years, then deleted, with their receipts,
  deliveries and jobs (lifecycle D22 recommends; stands once Kameel settles the
  schedule, Q8). `device_push_token` rows: retired rows one year after
  `retired_at`.

## 10. Decisions and questions

### Decisions

| # | decision | where it stands or why |
|---|---|---|
| D1 | One closed list of kinds, CHECKed in db/NN, mirrored once in `packages/policy/src/notifications.mjs`, agreement tested | free text today (map §1) |
| D2 | The per-kind contract table (§2): writer, capability, audience, urgency, push, retractability, life | eight designs assumed pieces of it |
| D3 | Push by urgency alone: low in-app only, medium pushed and mutable, high always | SCRBRD-136 D11; no kind-specific push code |
| D4 | `notification_contract()` trigger: default expiry by kind; a `notice` carries no person, no tier, no high; `is_public` always false | db/08 frozen; db/57's trigger stays |
| D5 | `subject_kind` gains `welfare` and `news` | SCRBRD-110 lines 269-273 planned it |
| D6 | `buildPayload()` ignores `is_public`; the flag is dormant and empty | SCRBRD-142 lead note 2 |
| D7 | Four audience shapes; a family notice is one row per live guardian with `recipient_id` | db/76 `lift_notify_family()`; SCRBRD-124 decision 13 |
| D8 | `push_candidates_for(notice)`: a recipient's own tokens when `recipient_id` is set | map 8.12 |
| D9 | People write `news_post`; the system writes `notification`; the publish and manual push routes close | map 8.3, 8.4 |
| D10 | The `news_post` trigger writes, re-syncs and retracts the `notice` row; `news_post.urgency` low/medium, "Send to phones too" | one stream for readers |
| D11 | A person-written notice's limits: shape by trigger, words by the compose screen, retraction by author or `news.publish.school`, a one-tap report to the DSOs | CSA SG-9 rule 4; SCRBRD-142 finding 1 |
| D12 | S0 locks the publish route before the pilot; S2 closes it after | no web caller exists |
| D13 | Outbox + LISTEN + poll worker; claimed jobs; re-read for expiry and retraction; per-person policy check as them; backoff retries to five; nothing failed when no key is set | map 8.5, 8.6, 8.14 |
| D14 | Pointer only, two fixed bodies by urgency; priority is metadata | push-api.mjs:41-61 |
| D15 | Re-register on every open; stale after 90 days; service-account JWT in `node:crypto`; `my_devices.push.available` and plain words in Settings | I17 |
| D16 | `onPushWhileOpen` refetches and shows a bar from the governed read; `/app?notice=` opens, marks read, one sentence when absent | map 8.8 |
| D17 | `my_notifications` view feeds the list and the count; receipts by two routes; one client store; opening a tiered notice is logged | I12; map 8.1, 8.2 |
| D18 | `retracted_at`, `retracted_by`, `retraction_kind`, `retracts_id`; `notification_retract()`; one "withdrawn" notice to the original's exact audience, pushed iff the original was | GA-I36 D4, Q4; recognition D20, D21 |
| D19 | Reads exclude retracted rows; `notification_by_id` returns a stub; un-retract clears the same row and retracts its "withdrawn" notice; data-only recall closes a shown push | recognition Q7 |
| D20 | Preferences govern push only, never visibility; per kind and per child; `safeguarding`, `welfare`, `system` and `high` cannot be muted | STEP4 P5, G9; GA-I20 D2 |
| D21 | Minors: no medium push 21:00-06:00 SAST, platform-fixed; adults: none in v1 | SCRBRD-136 D11 |
| D22 | The role-ended notice is pushed; a disabled account is not and its tokens are retired; retention two years with the notice | lifecycle D20-D22 |

### Questions, each with a recommendation

| # | question | recommendation |
|---|---|---|
| Q1 | May the `high` pointer say "You have a notice that needs you now."? A bystander learns that something urgent happened at a school, and nothing else. | **Yes.** A welfare page that reads like a newsletter is not a page. |
| Q2 | Fold `news_post` into `notification` as `kind 'notice'`, or keep the post as the body and write the notice by trigger (D10)? | **Trigger.** SCRBRD-142's public news, drafts and 4000-character bodies live on `news_post`; a bell row pointing at it costs one trigger. |
| Q3 | Lock `POST /api/notifications` before the pilot (S0)? | **Yes.** Half a day, no migration, no screen uses it, and it is the one door a bearer could misuse during the pilot. |
| Q4 | Minors' quiet hours 21:00-06:00 SAST, fixed? | **Yes.** Not school-set (a setting and a paste), not the pupil's. If a school's Saturday starts before six, a fixture notice waits until six. |
| Q5 | Adults' quiet hours in v1? | **No.** Per-kind preferences first; hours only if asked. Welfare and safeguarding would be exempt anyway. |
| Q6 | Push the role-ended notice? Today it cannot be (map 8.12). | **Yes**, pointer only. It is the notice a person most needs away from the app. |
| Q7 | Push the "withdrawn" notice? | **Iff the original was pushed** (urgency capped to medium). A phone told a false fifty is told it was false; nobody is paged about a withdrawal they never heard of. |
| Q8 | Retention: notices two years, with receipts and deliveries? | **Yes**, following lifecycle D22's schedule when it is settled; one row per table in `retention.mjs`. |
| Q9 | May a pupil mute push for `recognition` (his own fifty)? | **Yes.** It is low or medium, his, and in-app regardless. Never `system`. |
| Q10 | FCM service-account token minting in `node:crypto`, or an operator-refreshed `FCM_ACCESS_TOKEN` for the pilot? | **Both:** the access token for the pilot if S3 is not in; minting in S3, no dependency. The key is a Render secret. |
| Q11 | The one-tap "Report this notice" (D11) in S2, or later? | **S2.** It is one function and one button, and it is the SG-9 rule that makes a person-written notice acceptable to a child. |
| Q12 | Should `availability` notices be retracted when the answer lands, or expire at the fixture's start (D2)? | **Expire.** GA-I20's list already leaves when the source changes; a retraction here is mechanism for a row that is about to expire. |

### Assumptions

| # | assumption | if wrong |
|---|---|---|
| A1 | A pupil's role bundle holds `news.read` (138 §5.2 and STEP4 P5 assume it) | the side's `notice` and `recognition` rows do not reach him; D20's pupil row shrinks to `system`, which he cannot mute anyway |
| A2 | The three seed rows (db/98:619-630) carry kinds in D1's list and `is_public = false` | the D1 CHECK is added `NOT VALID` and the seed is corrected in the same `db/NN` |
| A3 | `news_post` is not in a frozen file in the sense of `DEPLOYING.md` (db/12 is not db/01 or db/09) | the `urgency` column goes on a side table `news_post_push (post_id PK, urgency)` and the trigger reads it |
| A4 | FCM's web SDK returns the current token from `getToken()` on each open, rotated or not | D15 adds a weekly `deleteToken()` + `getToken()` cycle |
| A5 | `app_session_begin()` (db/85) is what `withPrincipal` runs, so a disabled recipient raises `AuthError` in the worker as it does in `fanOut()` today | the worker checks `app_user.active` itself before step 5 |

## 11. Build slices, in order

| slice | scope | migration | routes and screens | tests | tier | closes |
|---|---|---|---|---|---|---|
| **S0 · lock the door** (before the pilot) | D12's route lock; D6's pointer-only `buildPayload()`; `SUBJECT_KINDS` gains `welfare` (code only; the CHECK waits for S1, so `welfare` is accepted by the route and refused by the database until then: the route says so); `fanOut()` skips an expired notice | none | `POST /api/notifications` locked; no screen | a unit test for push-api (first under `services/api/notify/`): lock refusals, pointer for a public row, expired not sent; `smoke-push.mjs` updated | **Opus** | **8.3** (locked) |
| **S1 · the contract and read state** | D1, D4, D5 (CHECKs, trigger); D18's four columns and `notification_retract()` (no triggers call it yet); D17's view, two receipt routes, one client store, tiered-open logging; D19's `notification_by_id()` and stub; `recognition()` and `milestone_notice_read` exclude retracted rows | **db/NN** | `POST /api/notifications/:id/read`, `/read-all`; `notifications` and `summary` over `my_notifications`; NotificationsView, every badge, Family and cards on the store | `db/99` section (CHECK refusals, trigger refusals, retracted excluded, stub, receipts self-only); `rls.test.mjs`; `smoke-summary.mjs` strengthened as §6 says; web test for the store; `smoke-read.mjs` "a cached notification is not permission" kept | **Opus** schema and routes; **Sonnet** screens | **I12**; 8.1, 8.2, 8.10 (columns) |
| **S2 · one stream** | D9, D10, D11: `news_post.urgency`, the trigger, withdrawal retracts, `notification_report()`, publish and manual push routes return 410; Family merge removed; compose words and "Send to phones too" | **db/NN** | `POST /api/news` gains `urgency`; `POST /api/notifications/:id/report`; NewsView compose; Notices "Report" | `db/99`: a post publishes one row, an edit re-syncs, a withdrawal retracts, a report writes one no-name DSO row and refuses a repeat; `smoke-push.mjs` moves to publishing through `/api/news` | **Opus** (trigger, report function, route closure); **Sonnet** compose | **8.3** (closed), 8.4 |
| **S3 · delivery** | D8, D13, D14, D15, D16, D22's push parts: `notification_push_job`, `notification_enqueue()`, `push_candidates_for()`, the worker, backoff, stale tokens, service-account minting, device upsert, `my_devices.push`, foreground bar, deep link; disabling retires tokens | **db/NN** | `POST /api/devices` upsert; `GET /api/read/my_devices` envelope; Settings → Alerts words; App deep link and bar | worker unit tests with the echo transport (claim once across two fakes, expired dropped, retracted dropped, retries to five, held person sent at 06:00, disabled skipped); fcm.mjs unit test (minting, 401 never retires); `smoke-push.mjs` end to end through a trigger; `smoke-end-role.mjs` asserts the role-ended notice reached the recipient path | **Opus** worker, SQL, FCM; **Sonnet** Settings, bar, deep link | **I17**; 8.5, 8.6, 8.8, 8.9, 8.12, 8.14 |
| **S4 · preferences and quiet hours** | D20, D21: `notification_pref`, the worker's step 5, minors' hours; Settings → Alerts per kind and per child | **db/NN** | `POST /api/notifications/prefs`; `GET /api/read/my_notification_prefs`; Settings → Alerts | `db/99`: own rows only, locked kinds refused; worker test: medium muted, high not, pupil held at 22:00 SAST and sent at 06:00, a parent's per-child row mutes one child's notices and not the other's | **Opus** schema and worker; **Sonnet** screen | STEP4 G9 |
| **S5 · retraction triggers** (with GA-I36 A2 and recognition) | the callers of `notification_retract()`: `milestone_retract()`, the breach re-check, recognition D19-D21, `progression_check()` superseding; un-retract; data-only recall in the worker and the service worker's close | GA-I36 A2's **db/NN** (this design adds nothing of its own here) | none new; Notices shows "withdrawn" rows and stubs | GA-I36 A2's `db/99` section, with recognition Q7 read as D19 says; worker test: recall sent to `sent` tokens only; a service-worker unit test that a recall closes by tag and shows nothing | **Opus** | GA-I36 D4; recognition D20 |

**Order.** S0 before the pilot. S1 and S2 may run in parallel after it (S2
depends on S1's `notification_retract()` only at its last step). S3 after S1.
S4 after S3. S5 when GA-I36 A2 is scheduled; S1 gives it the columns and the
function so A2 writes only triggers.

**Which slice closes what.** I12: **S1**. I17: **S3**. 8.3: **S0 locks it
before the pilot; S2 closes it.** S0 should go before the pilot: it is a route
change and a payload change, no migration, no screen, and it removes the only
door through which a bearer token could put a child's medical words under
`news.read` or on a lock screen.
