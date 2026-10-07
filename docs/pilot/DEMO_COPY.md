# The demonstration copy

A second SCRBRD, separate from production, filled with invented people. It is
for the steps in REHEARSAL.md marked S (Sent, handover, the ground display,
the public match page) and for showing SCRBRD to someone without opening the
school's real records. It follows DEPLOYING.md, "A demonstration is not a
pilot".

Three rules, none negotiable:

1. **Its own database.** A second Supabase project. Never the production
   project, and never a second schema inside it.
2. **Invented people only.** Its only data is the seed in `db/98_seed_pilot.sql`.
   Never type a real child's name into it, and never import a school list.
3. **Its own secrets.** New values for every secret. Do not copy any secret
   from the production service.

It takes about 30 minutes. It costs nothing on the free plans.

## 1. Make the two SQL files

On a computer with the repository and Node:

```sh
node tools/bundle-sql.mjs
```

This writes two files to the repository root:

| File | What it is |
|---|---|
| `scrbrd-supabase-rebuild.sql` | every migration plus the invented-people seed (about 2.8 MB) |
| `scrbrd-supabase-verify.sql` | the checks that prove it applied |

Both were rehearsed on 3 October 2026 against an empty Postgres. Both
finished with no error, and the checks ended "ALL RLS LIVE ASSERTIONS PASSED"
with "83 applied" and "11 players seeded".

## 2. A second Supabase project

1. On supabase.com: **New project**. Name it `scrbrd-demo`. Pick the same
   region as production (Europe). Save the database password it shows in your
   password manager as "SCRBRD demo — Supabase owner".
2. Check the project name at the top of the dashboard reads `scrbrd-demo`
   before every paste below.
3. **SQL Editor → New query.** Paste all of `scrbrd-supabase-rebuild.sql` and
   **Run**. If the editor refuses a file that size, use the command at the end
   of this section.
4. New query: paste `scrbrd-supabase-verify.sql`, **Run**. The last result
   row must read OK in every column, including "83 applied" and
   "11 players seeded". Anything else: stop and send me the row.
5. New query, with a new password from your password manager (32+ characters,
   letters and digits only), saved as "SCRBRD demo — scrbrd_app":

   ```sql
   ALTER ROLE scrbrd_app WITH PASSWORD '<new demo app password>';
   ```

   The migrations create this role with a development password that is
   published in the repository, so this step is not optional.
6. Green **Connect** button, at the top of the dashboard → **Session pooler**.
   Copy the string and put the role and the new password into it:

   ```
   postgresql://scrbrd_app.<demo project ref>:<new demo app password>@aws-1-<region>.pooler.supabase.com:5432/postgres
   ```

   Keep it in the password manager as "SCRBRD demo — DATABASE_URL". It must
   contain the **demo** project's reference, not production's.

If the SQL Editor will not take the rebuild file, run this from the
repository instead, with the **owner** string (role `postgres.<demo project
ref>` and the step 1 password). Then do steps 4–6:

```sh
DATABASE_URL='<demo owner string>' node tools/migrate.mjs --seed
```

Never add `--reset` against Supabase.

## 3. A second Render service

Use **New → Web Service**, not Blueprint. A second Blueprint would try to
reuse the production service's name.

| Setting | Value |
|---|---|
| Repository | `iamkameel/SCRBRD_OS`, branch `main` |
| Name | `scrbrd-demo` |
| Region | Frankfurt |
| Plan | Free |
| Runtime | Node |
| Build command | `corepack enable && pnpm install --frozen-lockfile && VITE_API_BASE= pnpm build` |
| Start command | `node services/api/server.mjs` |
| Health check path | `/api/health` |

Environment:

| Key | Value |
|---|---|
| `NODE_ENV` | `development` — this is what allows sign-in without a code, and it is why this service must never hold real data |
| `ALLOW_DEV_LOGIN` | `1` |
| `SERVE_CLIENT` | `apps/web/dist` |
| `DATABASE_URL` | "SCRBRD demo — DATABASE_URL" from step 2.6 |
| `SESSION_SECRET` | a new random 32+ characters. Set it even though development does not insist: without it, every restart (the free service sleeps) signs everyone out and breaks a handover in progress |
| `PUBLIC_PAGES` | `on` — only for the ground display and public-page steps |
| `PUBLIC_PSEUDONYM_SECRET` | another new random 32+ characters, different from `SESSION_SECRET` |
| `PUBLIC_TRUST_PROXY_HOPS` | `1` |

Leave these unset: `GOOGLE_WEATHER_API_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, any AI key, and `WEB_ORIGIN`. Google sign-in
will say it is not set up for this address. That is expected. The demo signs
in without a code (section 4).

**Create Web Service.** The first build takes about 5 minutes.

## 4. Check it

1. Open `https://<demo service>.onrender.com/api/health`. The first answer can
   take up to a minute. You should see `"ok":true`, `"db":"ok"`,
   `"auth":"dev_login_enabled"` and `"public":"on"`.
2. Open `https://scrbrd.onrender.com/api/health` (production). It must still
   say `"auth":"token_only"`. If production ever says `dev_login_enabled`,
   remove `ALLOW_DEV_LOGIN` from production at once and tell me.
3. Open `https://<demo service>.onrender.com/app`. Under the sign-in form, the
   box "Pilot accounts — click to fill" lists the seeded people. Tap one, leave
   **Sign-in code** empty, and tap **Sign In**. Every person is invented and
   has an `example.invalid` address:

   | Tap | Address | Use for |
   |---|---|---|
   | Scorer | `scorer@example.invalid` | scoring, Sent, handover |
   | Head Coach | `coach@example.invalid` | Pick the side, publishing the public page |
   | Parent | `parent@example.invalid` | the parent's view |

   Production does not show that box, and it refuses these addresses.

   The seed uses two real school names, Hilton College and Westville Boys'
   High. Every person in it is invented. Score the 1st XI fixture against
   Michaelhouse. The seed dates it three days after the database was built.

## 5. After the rehearsal

Withdraw any public page you published on the demo. Then, in Render,
**Settings → Suspend Web Service**. Do this so a public demo page naming
invented boys at real schools is not left on the internet. Resume it the next
time you want to show SCRBRD. Delete the Supabase project only if you will not
demo again: rebuilding it means repeating sections 1 and 2.

The demo never gets a backup, a school list or a real account. If any of those
is ever needed, it is production's job.
