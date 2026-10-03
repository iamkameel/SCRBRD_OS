# The pilot school's load

**What this is.** The steps that turn the pilot school's lists into a working SCRBRD
before the pilot starts on 15 October 2026. The school sends its staff list and squads
around 5 October. The load is planned for 6 October. Written 3 October 2026 against
`ddac71f` (production at db/82).

**The rule behind every step.** Each row goes in through the app's own screen or
route, signed in as a named person, so row-level security applies and the record
shows who did it. SQL is used only where no screen or route exists, and only for
rows that hold no child's data (the school, the union, the grounds). Those gaps are
listed at the end.

**The people:**

- **Kameel** holds the owner's key (`superadmin`).
- **The principal** appoints the DSO.
- **The school office** (`schooladmin`) does the day-to-day enrolment.
- **The DSO** checks the result.

## Where the lists live

The school's real files never go into this repository, an email thread, a chat or an
AI tool. They stay in one folder on Kameel's machine, outside the repo. Delete them
once step 12 has passed. The templates in `templates/` use invented names only.

## Before 6 October (Kameel)

| | What | How | Check |
|---|---|---|---|
| P1 | Production is a real-data deployment | Use DEPLOYING.md, "A demonstration is not a pilot": migrations only, no `98_seed_pilot.sql`, `NODE_ENV=production`, no `ALLOW_DEV_LOGIN` | `POST /api/auth/dev-login` is refused |
| P2 | The owner's key and the school | `SESSION_SECRET=… node tools/bootstrap.mjs --owner --email <Kameel> --name "<Kameel>" --school <CODE> "<School name>" KwaZulu-Natal`. Running it again mints a fresh code and changes nothing else. SQL as the schema owner: no screen creates a school (gap 1) | `GET /api/schools` lists the school |
| P3 | The KZN union tenant, which the DSO's go-live needs (SAFEGUARDING_DSO §9.1) | `select code from school where kind = 'union' and province = 'KwaZulu-Natal'`. If no row comes back, insert one row with `kind = 'union'` (gap 1) | `school_union(<school id>)` returns it |
| P4 | Google sign-in, if staff and parents will use it | DEPLOYING.md, SCRBRD-140: the provider is on in Firebase and the privacy paragraph is signed | The sign-in screen shows "Continue with Google" |
| P5 | The lists are clean | The office fills the three templates (below). Kameel runs `node tools/pilot-load-check.mjs --dir <folder> --on 2026-10-15 --db` and sends back every `✗` line until there are none | `0 errors` |

## What is NOT loaded, and why

| Not loaded | Why |
|---|---|
| **Any medical detail.** No injuries, illnesses, allergies, medication or fitness notes from the school's medical forms | A child's health is special personal information under POPIA. SCRBRD takes it through two consented paths only. The first is the medical role's own record, appointed by the principal or the director of sport. The office cannot appoint it (`roles.mjs`, GRANTABLE_ROLES). The second is health-monitoring consent, which only a verified parent, or the boy himself from eighteen, can give (db/60). A spreadsheet has neither person behind it. |
| **ID numbers.** Leave `id_number` blank | The importer accepts an ID number and can derive the birthday from it. But `born` is enough, and no step on day one reads an ID number. It is the most damaging field to leak, and the platform restricts it (`player.identity.read`, the office only). Collect it when a flow needs it; none does yet. The checker warns on every one. |
| **A pupil's email, phone, hometown or address** | No step on day one needs them. All are masked, and all are on the never-public list (PUBLIC_DATA §3). The importer does not take an address at all. |
| **Health-monitoring consent** | The parent gives it in the app (Settings → Me, or the one-time prompt). The office cannot record it, by design. |
| **Public-name consent and the never-public mark** | No screen or route exists (gap 5). Until one does, nobody is named on a public page: a child shows as "Batter" or "Bowler" (PUBLIC_DATA C2). That is the safe default. Do not write these with SQL. |
| **Emergency contacts** | Parents add them in Family → the child's file, after they sign in. |
| **Pupil accounts** | Not part of this load. The office enrols a pupil one at a time later, after his guardian is linked (Settings → People, role `player`). |
| **Discipline, notes, ratings, scouting** | Nothing from a previous system. These start empty. |

## The templates

The three templates are in `templates/`. Fill one row per line, keep the header exactly
as it is, write dates as `YYYY-MM-DD`, and save as CSV (UTF-8).

| File | One row per | Columns | Used by |
|---|---|---|---|
| `players.csv` | boy | The importer's own twelve columns, in its order. Fill `full_name`, `team_code`, `born`. Fill `squad_no`, `playing_role` (batter, bowler, allrounder, keeper), `batting_style` (R/L), `bowling_arm` (R/L) and `bowling_style` (F/M/S) if known. Leave the last four blank. | `POST /api/import/players`, step 5 |
| `staff.csv` | role a person holds | `name, email, role, team_code`. `team_code` is required for coach, assistantcoach and teammanager, and blank otherwise | Settings → People, steps 3 and 6 |
| `guardians.csv` | guardian, per child | The guardians import's own four columns: `player_full_name, guardian_name, guardian_email, relationship`. The child's name must match `players.csv` exactly. A parent of two boys takes two rows with the same email. `relationship` is `parent`: enrolment records a parent link only, so the import refuses any other value (gap 3) | `POST /api/import/guardians`, step 7 |

Sides are `U9`–`U16` with an optional `A`–`F` (`U14A`), or `1XI`, `2XI`…. A boy's side
must be his age group by birth or older. "U14" means fourteen and under on 1 January.
The roles are the ones in `packages/policy/src/roles.mjs`. Staff usually take `coach`,
`assistantcoach`, `teammanager` or `scorer`. Leadership takes `principal`,
`directorofsport` or `schooladmin`. A DSO is never put on this list: the principal
appoints the DSO in step 4.

**The checker** reads only these files and, with `--db`, the local database's
`birth_age_group()`. It sends nothing anywhere. It flags:

- duplicate boys, ID numbers, staff lines and guardian lines;
- a bad or missing date of birth (the importer's own rule);
- a side that is not a school side, or that a boy's birthday does not fit;
- a guardian with no email;
- a child in `guardians.csv` who is not in `players.csv`, or who is eighteen;
- one email used by two different people.

It also names the roles the office cannot grant.

## On 6 October: the order

The times assume a dozen staff, about 60 boys, about 100 guardian lines and about 30
fixtures.

| # | Step | Who | Screen (route) | Time | How to check it worked |
|---|---|---|---|---|---|
| 1 | Sign in | Kameel | Sign-in screen with the code from P2 (`POST /api/auth/redeem`), or Google | 1 min | Settings shows the owner's key |
| 2 | Switch on the pilot's modules | Kameel | Modules (`POST /api/admin/modules/:key/grant`): the modules decided for the pilot. Lift clubs wait for the principal's lift policy (DEPLOYING.md) | 2 min | The Modules screen shows them on for the school |
| 3 | Principal and office accounts, and a director of sport if there is one | Kameel (`user.role.assign`). Only the owner or a platform admin may grant `principal`; `schooladmin` also the principal, never the office | Settings → People → Add (`POST /api/users`). Leave "issue a code" off unless the person signs in this week (codes last three days) | 3 min | People lists each person with their role |
| 4 | Appoint the DSO | The principal, signed in. Only the principal appoints a DSO (CSA p17). The office and the director of sport cannot | Settings → People → Add, role `dso` (`POST /api/users`). The principal cannot issue the DSO's code, so Kameel issues it (People → issue code, `POST /api/auth/invite`), or the DSO signs in with Google and Kameel confirms the claim | 5 min | Every signed-in person's Safeguarding card names the DSO (`dso_contacts()`) |
| 5 | Players: dry run, then commit | Kameel, with the office beside him reading the report. No import screen exists (gap 2). The route needs `player.profile.manage`, which the office and the owner hold | `POST /api/import/players`, recipe below | 5 min | The commit answers `committed: true, inserted: <rows>`. Squad shows every side. `GET /api/export/players` gives the same count in `x-scrbrd-rows` |
| 6 | Staff | The office (`user.role.assign`; it grants coach, assistantcoach, teammanager, scorer, official and more). Kameel or the principal does the roles the checker lists as "office cannot grant" | Settings → People → Add, one per `staff.csv` line, with the role and side. No code yet | about 1 min a line | People lists each person with role and side. A coach who is also a parent is one account with two roles |
| 7 | Guardians: dry run, then commit | Kameel, with the office beside him, on the office's own sign-in: the route needs exactly what Settings → People needs for one guardian (`user.role.assign` at the school, and may grant `guardian`). Kameel decided on 3 Oct that the office vouches for every link in the file | `POST /api/import/guardians`, the step 5 recipe with `guardians.csv`. Each row is `enrol_person()` under the office's identity: the link is written verified by the office, with the family's consent still pending. One email for two boys is one account with two links. A boy not found, or two boys of one name, is an error on that line, never a guess; so is one email under two names, an email that is another person's account or a pupil's, and any relationship but `parent`. Sending the file again changes nothing | 5 min | The commit answers `committed: true`. People shows each guardian against each child |
| 8 | Grounds | The office or Kameel (`facility.manage` at the school). No screen yet (gap 4) | `POST /api/grounds {schoolId, name, surface?, parentId?}`, one call per ground, the step 5 token. A pitch on a field names the field as `parentId`. The same name twice at the school is refused (409) | 2 min | `GET /api/read/grounds` lists them; Fields lists them, and the fixture form offers them |
| 9 | Fixtures | The office or the director of sport (`fixture.create`) | Calendar → Add fixture (`POST /api/fixtures`): side, date and time, opponent (typed, or the school if it is on SCRBRD), ground, format | about 1 min each | Calendar shows each fixture; an opposing school on SCRBRD sees it too |
| 10 | Check the result | The DSO | The DSO reads People and Squad as a second pair of eyes: no stranger linked to a child, no adult in a team role the school did not list | 10 min | The DSO says so in writing (an email to Kameel) |
| 11 | Ways in, **in the week of 12 October** | The office: codes for coaches, scorers and parents. Kameel: codes for the principal, director of sport, DSO and office, which nobody below the owner may issue (db/81) | People → issue code (`POST /api/auth/invite`), handed over in person or by phone, never by email. Or Google sign-in, with the office confirming each claim on Claims (Kameel for leadership) | 1 min each | The person reaches their own screen |
| 12 | Walk it and close | Kameel | One coach sees his side; one parent sees their child and the health-consent prompt; the DSO card shows. Then delete the list files | 10 min | The files are gone |

Kameel's own steps take about 30 minutes. The office's take two to three hours, most of
it the guardian lines.

### Step 5, the import recipe

There is no import screen yet, so Kameel calls the route the screen would call. The
token is the one the browser already holds. In DevTools → Network, open any `/api/`
request and copy the `Authorization` value after `Bearer `. It lasts 30 minutes. The
file goes from disk to the request through a pipe and is never written anywhere else.

```sh
API=https://<the web app's domain>          # Hosting forwards /api/** to the API
TOKEN=<pasted from the browser>
SCHOOL=$(curl -sS "$API/api/schools" | jq -r '.rows[] | select(.name=="<School name>") | .id')

# 1. Dry run: nothing is written, every error comes back with its line number.
jq -Rs --arg s "$SCHOOL" '{schoolId:$s, csv:.}' players.csv |
  curl -sS -X POST "$API/api/import/players" -H "authorization: Bearer $TOKEN" \
       -H 'content-type: application/json' --data @- | jq

# 2. Only when the dry run says "clean": true and the office has read it.
jq -Rs --arg s "$SCHOOL" '{schoolId:$s, csv:., commit:true}' players.csv |
  curl -sS -X POST "$API/api/import/players" -H "authorization: Bearer $TOKEN" \
       -H 'content-type: application/json' --data @- | jq
```

The import is all or nothing. A file with any error commits nothing, even with
`commit: true`, and running it twice updates rows instead of duplicating them
(`tools/smoke-csv.mjs`). The template the route itself serves
(`GET /api/import/players/template`) has the same header as `templates/players.csv`.

## The gaps, for the lead

These steps have no screen or route today. Nothing here builds one.

1. **Creating a school or a union.** Today this is `tools/bootstrap.mjs --school` or SQL.
   Proposed shape: `POST /api/admin/schools {code, name, kind, province}` under
   `platform.tenant.manage`, behind a platform-only screen.
2. **An import screen.** Proposed shape: Settings → Import, over the existing
   `POST /api/import/:kind`. It would show the dry-run report by line and offer
   "Commit" only when the report is clean. It needs no new API, so it is Sonnet work.
3. **Built 3 Oct for guardians** (`IMPORTS.guardians`, `tools/smoke-guardian-import.mjs`).
   Still open: enrolment writes every link as `parent`, so recording a grandparent or a
   court-appointed guardian needs `enrol_person()` to take a relationship (a migration),
   and there is no import screen (gap 2). The proposal as it stood: **Bulk guardian (and staff) enrolment.** Proposed shape: an `IMPORTS.guardians`
   kind, each row calling `enrol_person()` under the office's own identity, with dry
   run as the default and the child matched by name as the players import does it.
   Linking adults to children in bulk is a safeguarding decision (SCRBRD-140 D5), so
   it is Kameel's call. Staff could instead wait for the SCRBRD-140 phase 2 register,
   which `staff.csv`'s columns already match.
4. **Built 3 Oct as a route** (`POST /api/grounds`, `tools/smoke-grounds.mjs`); Add ground on
   Fields is still to come. The proposal as it stood: **Creating a ground.** Proposed shape: `POST /api/grounds {schoolId, name, surface?,
   parentId?}` under `facility.manage`, with Add ground on Fields. The table's policy
   is already there.
5. **Public-name consent and the never-public mark.** `public_name_consent_set()` and
   `player_never_public_set()`/`_end()` exist in db/47, but no route or screen calls
   them. Proposed shape: `POST /api/players/:id/public-name-consent {yes, version,
   formName?, formDate?}` and `POST /api/players/:id/never-public {reason}` / `…/end`.
   The mark has to ship with or before the consent entry.
6. **Recording clearances.** `POST /api/clearances` exists but has no screen. The CSA
   checks for coaches and the DSO therefore start out shown as missing.
7. **The Staff screen** reads the old `staff` and `coach` tables, which nothing writes,
   so it will be empty for the pilot school. People shows everyone. Proposed shape:
   point Staff at the role assignments, or retire it in favour of People.
