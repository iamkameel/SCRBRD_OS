# Solo test on the demo copy

One person tests all of SCRBRD, end to end, on the demo copy. Kameel, from 8 October 2026. The 15 October pilot is this test. Westville's real pilot is postponed.

The demo copy is the `scrbrd-demo` Supabase project and its own Render service (`DEMO_COPY.md`). Every person in it is invented. Every address ends `@example.invalid`. Production is never touched.

## Before you start

1. Paste the two cast files into `scrbrd-demo`, in this order. Check that the dashboard says `scrbrd-demo` first.
   - `demo-players-330.sql`: the 330 invented boys and their parents. It is file 10 on the demo copy kit. It is not in the repository.
   - `demo-cast.sql`: everyone else, and the fixtures. It is file 11 on the demo copy kit (or, with the repository: `node tools/demo-cast.mjs demo-cast.sql`). It is about 70 KB, one paste.
   - Paste `demo-cast.sql` on the morning of your first test day. It makes one fixture for that day, and one for each day after it to 17 October. A second paste is refused.
   - Each file ends with tables. Keep the last three of `demo-cast.sql`: the people, the pupils and the fixtures.
2. Create the demo Render service, as in `DEMO_COPY.md` section 3. `NODE_ENV` is `development` and `ALLOW_DEV_LOGIN` is `1`. Set `PUBLIC_PAGES` to `on` for the ground display and the public pages.
3. Run the health check, as in `DEMO_COPY.md` section 4. The demo says `"auth":"dev_login_enabled"`. Production still says `"auth":"token_only"`.

If a paste stops with an error, nothing was changed. Read the first line of the error and send it to Claude.

## How to switch role

1. Tap **Sign out** (your name, or the foot of the menu).
2. On the sign-in screen, type the person's address in **Email**.
3. Leave **Sign-in code** empty. Tap **Sign In**.

That is all. The demo service lets anyone in by address alone. That is why it must never hold real people.

Each browser tab is its own sign-in. Reloading a tab signs you out of it, but not out of the pad: a pad that was scoring carries on. So one laptop can be several people at once, one per tab.

## The set-up for one person

| Device | Who | What it is for |
|---|---|---|
| Phone 1 | `scorer1.wes` | The pad. Scores today's match. |
| Phone 2 | `coach.wes.1xi`, then `scorer2.wes` | The coach before the toss. The second scorer for the handover. |
| Laptop, tab 1 | `parent.001` | The 1XI captain's father, following the match live. |
| Laptop, tab 2 | nobody | The ground display, once the page is published. |
| Laptop, tab 3 | anyone | Office, director, DSO and the rest, one after another. |

Use a second browser profile, or a private window, for a second device that is the same person. Two tabs in one browser count as one device.

Keep the laptop tab 1 open while you score. Do not reload it.

## The cast

Every address ends `@example.invalid`. The names are invented: "WES 1XI Coach (demo)" and so on.

### At each school

| Job | Westville | Kearsney | Made by |
|---|---|---|---|
| Principal | `principal.wes` | `principal.kea` | the platform account |
| Director of sport | `dos.wes` | `dos.kea` | the principal |
| DSO (safeguarding) | `dso.wes` | `dso.kea` | the principal |
| Medical (physio) | `medical.wes` | `medical.kea` | the director of sport |
| School office | `registrar.wes` (seed) | `office.kea` (the 330 file) | — |
| Scorer one | `scorer1.wes` | `scorer1.kea` | the office |
| Scorer two | `scorer2.wes` | `scorer2.kea` | the office |
| Official (umpire) | `official.wes` | `official.kea` | the office |
| Transport coordinator | `transport.wes` | `transport.kea` | the office |
| Driver | `driver.wes` | `driver.kea` | the office |
| Assistant coach, 1XI | `assistant.wes.1xi` | — | the office |

### Per side

Every side has a coach and a team manager at both schools. The address is the job, the school and the side:

| Side | Coach | Team manager |
|---|---|---|
| 1XI | `coach.wes.1xi`, `coach.kea.1xi` | `manager.wes.1xi`, `manager.kea.1xi` |
| 2XI | `coach.wes.2xi`, `coach.kea.2xi` | `manager.wes.2xi`, `manager.kea.2xi` |
| 3XI | `coach.wes.3xi`, `coach.kea.3xi` | `manager.wes.3xi`, `manager.kea.3xi` |
| U12A | `coach.wes.u12a`, `coach.kea.u12a` | `manager.wes.u12a`, `manager.kea.u12a` |
| U13A | `coach.wes.u13a`, `coach.kea.u13a` | `manager.wes.u13a`, `manager.kea.u13a` |
| U14A | `coach.wes.u14a`, `coach.kea.u14a` | `manager.wes.u14a`, `manager.kea.u14a` |
| U14B | `coach.wes.u14b`, `coach.kea.u14b` | `manager.wes.u14b`, `manager.kea.u14b` |
| U15A | `coach.wes.u15a`, `coach.kea.u15a` | `manager.wes.u15a`, `manager.kea.u15a` |
| U15B | `coach.wes.u15b`, `coach.kea.u15b` | `manager.wes.u15b`, `manager.kea.u15b` |
| U16A | `coach.wes.u16a`, `coach.kea.u16a` | `manager.wes.u16a`, `manager.kea.u16a` |
| U16B | `coach.wes.u16b`, `coach.kea.u16b` | `manager.wes.u16b`, `manager.kea.u16b` |

### Pupils and their parents

| Pupil | Side | His parent | Note |
|---|---|---|---|
| `pupil.wes.1xi` | WES 1XI, number 1 | `parent.001` | Holds the captaincy |
| `pupil.wes.u14a` | WES U14A, number 1 | `parent.106` | Use these two to compare the parent's and the pupil's views |
| `pupil.wes.u16b` | WES U16B, number 1 | `parent.061` | |

Every one of the 330 boys has a parent account: `parent.001` to `parent.330`. Westville's boys are 1 to 165, Kearsney's 166 to 330. The cast file's second table names each pupil's parent: check it matches this one.

### The seed's own accounts

These came with the demo copy. Most are at Hilton College, the seed's first school.

| Address | Who |
|---|---|
| `owner` | The owner's key: every school |
| `platform` | Platform admin: switches modules on |
| `league` | Runs the KZN Schools T20 League |
| `registrar`, `principal`, `sarah`, `bursar` | Hilton: office, head, director of sport, bursar |
| `coach`, `coach2`, `u14coach` | Hilton coaches |
| `scorer`, `e.ndlovu`, `medical`, `dso`, `driver` | Hilton: scorer, umpire, physio, DSO, driver |
| `parent`, `pillay` | Hilton: a parent, and an injured pupil |
| `parent.whitfield`, `parent.bekker`, `parent.naidoo`, `parent.cele` | Hilton parents |
| `analyst`, `spectator`, `watcher` | Read-only accounts |
| `registrar.wes`, `coach.wes` | Westville: office, and a second 1XI coach |

## The fixtures

Westville host Kearsney at Westville Main, every side once. Times are South African.

| Date | Time | Fixture | Ready for you |
|---|---|---|---|
| Today (the paste day) | 14:30, or an hour or so after the paste if later | WES 1XI v KEA 1XI | Scorer `scorer1.wes`, umpire `official.wes`, Kearsney's XI named, minibus booked with `driver.wes` |
| Thu 8 Oct | 14:30 | U16A | |
| Fri 9 Oct | 14:30 | U14B | |
| Sat 10 Oct | 09:30 | 2XI | |
| Sat 10 Oct | 14:00 | 3XI | |
| Mon 12 Oct | 14:30 | U15A | |
| Tue 13 Oct | 14:30 | U13A | |
| Wed 14 Oct | 14:30 | U12A | |
| Thu 15 Oct | 10:00 | U14A | Scorer `scorer1.wes` |
| Thu 15 Oct | 14:30 | U16B | Scorer `scorer1.wes` |
| Fri 16 Oct | 14:30 | U15B | |
| Sat 17 Oct | 10:00 | 1XI | Left out if you paste on 17 October: today's is the 1XI's |

They are friendlies. They play under the platform's standard conditions.

Lift clubs are switched on at Westville, with a signed policy.

## The scenarios

Do them in this order on a test day: 1 to 4 before the toss, 5 to 7 during the match, the rest after. Each says who to be, what to do, what you should see, and what counts as a failure. Write every failure in the log at the end, with the time.

### 1. The office

Sign in as `registrar.wes`.

1. Tap **Settings**, then **People**. You see Westville's accounts, and the boys with no account.
2. Tap **+ Enrol a person**. Enrol an invented parent for a Westville boy: **Full name** "Test Parent", **Email** `test.parent@example.invalid`, **Role** Parent / Guardian, **Which child** any boy. Tap **Enrol**.
3. Sign out. Sign in as `test.parent`. Tap **Family**. You see that boy, and the line saying his terms are not agreed yet.
4. Back as `registrar.wes`: **Squad**, a side, a boy, **Edit Profile**. Under **Public match pages**, tap **Record a yes from a signed form** and record it.
5. Tap **Staff**. Tap **Everyone**, then **Clearance register**. The cast is listed. Most checks are missing: that is right for invented people.
6. Under **Settings**, **People**, look for **Google sign-ins waiting for you**.

You should see: only Westville's people and boys. Never a Kearsney boy.

A failure: a Kearsney name anywhere; the new parent seeing any boy but his own; the enrolment refused.

Not testable on the demo: Google sign-in is not set up for the demo address, so the claims list is always empty. The office has no screen yet to verify a pending link or to record a family's agreement to the terms. See "What the demo cannot test".

### 2. The coach

Sign in as `coach.wes.1xi` on phone 2.

1. On the **Dashboard**, the **Match day** card names today's fixture against Kearsney College 1XI, the time and the bus.
2. Tap **Open the Coach tab**. Read **The side** and **Our bowlers this week**. Tap **Signals**. Tap **Seen** on one card.
3. Tap **Match Centre**, then today's fixture's card. Under **Match Details**, tap **Pick the side**. Choose eleven boys. Tap **Save the side**.
4. Tap **Squad**, the 1XI. In **Availability**, tap **Available** or **Doubtful** for two boys.
5. Tap **Readiness**. Tap today's row. It opens the fixture's **Match-day duties**: **Scorer appointed**, umpire and transport on record.

You should see: only the 1XI's fixtures (today and 17 October). The side saved. Duties showing the scorer and the umpire.

A failure: another side's fixture; a Kearsney boy offered in **Pick the side**; an injury's nature on the coach's screens; any page error.

Then sign in as `coach.kea.1xi` in tab 3. Today's fixture shows from the away end. His XI is already named.

### 3. The team manager

Sign in as `manager.wes.u14a`.

1. **Match Centre**: only the U14A fixture on 15 October.
2. Open it. The **Coach** tab shows **The side** and the bus, and no bowling load.
3. **Squad**, U14A: answer **Availability** for a boy.

A failure: the bowling load shown to him; another side's fixture.

### 4. The parent, before the match

Sign in as `parent.106` (the U14A boy's father) on the laptop.

1. The bar shows **Home**, **Matches**, **Family**. **Family** shows one boy, his own.
2. Tap his card, then **Consents**. Turn **Show [name] on public match pages** to **On**.
3. On his card, add a number to his emergency contacts, and save.
4. **Settings**, then **Me**: make the yearly driver's declaration. Choose the number you just added.
5. **Matches**, the U14A fixture on 15 October: offer a lift for this fixture.
6. Sign in as another U14A parent in another tab (`parent.107`). Ask for a seat on that lift. Back as `parent.106`, accept it.

You should see: one child only, everywhere. The lift confirmed once both of you have said yes.

A failure: any other child; another parent's phone number before the day.

Then sign in as `pupil.wes.u14a`. Compare. He has **Home**, **Matches**, **Passport** and **Me**. He sees his own record and his side's fixture. He sees no lift controls and no team-mate's private details.

### 5. The scorer: the full match

Sign in as `scorer1.wes` on phone 1, after scenario 2 saved the side. The sheet is `SCORER_HELP.md`; these are the checks.

1. **Match Centre**, today's fixture, **Start Scoring →**. Answer **The toss**, then **Bat** or **Bowl**, the openers and the **Opening Bowler**.
2. Kearsney's names: the pad cannot read another school's team sheet. Type each Kearsney player's name as he comes in ("K Batter 1"). That is expected.
3. Score an over with a **Dot**, a four, a **Wide** and a **No ball**. Check the score counts one extra for each, and the over has six legal balls.
4. Score a **Wicket**, then **Confirm Out**. Pick the next batter on **Batting Order**.
5. Tap **Undo** once. The last ball goes, and the score goes back.
6. Offline: switch on airplane mode. Score an over. The pill reads **Held** with a count. Switch it off. The count falls, then **Sent**.
7. Rain: **Pad menu**, **Play stopped**, **Rain**, **Stop play**. Then **Resume**.

A failure: a ball lost after airplane mode; a wrong count of extras; the score different on the laptop after **Sent**.

### 6. The handover

1. Phone 1, pill at **Sent**, between overs: **Hand over**, then **Hand over scoring**. Read the six-digit code.
2. Phone 2: sign out, sign in as `scorer2.wes`. Open the same fixture. Tap **Take over**, type the code, **Claim this match**. Type the score from phone 1's board. Tap **Confirm and take over**.
3. Phone 1 shows **Handed over**. Score the rest of the match on phone 2.
4. At the end: **Match Complete**. Wait for **Sent**.

A failure: both phones able to score; a wrong figure accepted at the takeover.

### 7. The ground display and the live page

Before the toss, as `dos.wes` (a coach may not publish): today's fixture, **Match Details**, **Public page**, **Publish** for Westville. The **Ground display** section shows a link and a QR code.

1. Open the link in laptop tab 2. Try **Floodlit**, then **Daylight**. Score a ball on the pad: the display follows within seconds.
2. Laptop tab 1, as `parent.001`: **Home** shows the **Live** card. Tap **Follow the match**. His son's line shows when he bats.
3. Switch off the laptop's Wi-Fi for a minute: the display shows **Last updated**, then catches up.
4. Afterwards, as `dos.wes`, tap **Withdraw**.

A failure: a boy's full name on the display; a boy named whose family has not said yes; the display stuck after Wi-Fi returns.

### 8. The pupil and the captain

Sign in as `pupil.wes.1xi`.

1. **Home** shows a card headed "Captain", with Westville and the 1XI.
2. Open today's fixture. The captain's section shows the day, **The side** as named, and the season so far.

You should see: what any team-mate may see, laid out for the captain.

A failure: a team-mate's injury, load, availability or ratings anywhere on it.

Then `pupil.wes.u16b`: no captain card. **Me** is his own record only.

### 9. The DSO

1. As `manager.wes.u14a`: tap **Raise a concern** (the hand icon). Write an invented account that names nobody. Tap **Send to the DSO**. Note the reference.
2. As `dso.wes`: **Safeguarding**, **Inbox**. The concern is there with its clock. Open it. Add a note.
3. As `dso.kea`, `dos.wes`, `principal.wes`, `registrar.wes` and `coach.wes.1xi`: **Safeguarding** shows no concern.
4. As `manager.wes.u14a` again: **What you have raised** shows the reference and nothing more.

A failure: anyone but Westville's DSO reading the account.

### 10. Medical, transport and the driver

1. `medical.wes`: **Injuries** and **Training** (the load). There is no Westville injury to see: recording one has no screen yet.
2. `transport.wes`: **Logistics** shows today's minibus, `WES DEMO 1`, and its trip.
3. `driver.wes`: today's trip, with its two buttons. Tap "We've left", then "We've arrived".
4. `coach.wes.1xi`: the **Match day** card says the bus and its seats.

A failure: the driver seeing a trip that is not his; `driver.kea` seeing Westville's.

Kearsney cannot book its own bus to a Westville fixture: a trip belongs to the host school. Expected for now.

### 11. The director of sport

Sign in as `dos.wes`.

1. **Readiness**: every Westville fixture, each with its duty count.
2. **Officials**, **Staff** and the **Clearance register**: the whole school.
3. **Match Centre**: all twelve fixtures.
4. After the match, as `scorer2.wes`: on the fixture's full-time card tap "Something to correct", pick a ball and file a correction. The director cannot yet approve it on a screen.

A failure: a Kearsney record; a fixture missing.

### 12. The public pages

Only with `PUBLIC_PAGES` on. In a private window, signed out:

1. Open the service's address. The home page shows, with **Log in**.
2. Open the published match link (`/live/` and the match id). The match page shows.

A failure: a full name, a photo or a date of birth of any boy; a page that names a boy whose family said no.

### 13. Signing out

1. Two tabs in one browser, both `coach.wes.1xi`. **Sign out** in one. The other is signed out on its next step.
2. A second browser profile as the same coach stays signed in: it is another device.
3. "Sign out everywhere" has no button yet. `tools/smoke-demo-cast.mjs` proves the server side.

A failure: a signed-out tab still reading data.

## What the demo cannot test

Each needs a change to the app, not to the data:

- Claims: Google sign-in is not set up for the demo address. Setting it up is configuration (Firebase and the demo domain), not code.
- Verifying a link and recording a family's agreement: the routes exist (`/api/players/:id/guardians/verify`, `…/consent`). There is no screen.
- Recording an injury: no route and no screen. "Recording and updating injuries is coming."
- Adding a vehicle or booking a trip: the routes exist. There is no screen. The cast booked today's trip for you.
- Approving a correction: the director has no screen to decide it.
- Sign out everywhere: the route exists. There is no button.
- The away school's bus: a trip belongs to the host school, so Kearsney cannot book one to Westville.
- The away team sheet on the pad: the host's scorer cannot read the visitors' named XI. He types their names.

## The log

| Time | Device | Scenario | What happened | Screenshot |
|---|---|---|---|---|
| | | | | yes / no |
| | | | | yes / no |
| | | | | yes / no |

Send Claude the log, the screenshots named by scenario, and the steps you skipped.
