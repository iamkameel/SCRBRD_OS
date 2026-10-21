# Production sheet

One page: where production runs, who holds each login, and the switches that stop it.
Design: `docs/design/INCIDENTS_AND_BREACHES.md` §9.4 (D27), §6.1 (D11).

**The lead fills every placeholder in square brackets** from the provider's own page,
on the day this sheet is written. No account, login or contact is written here until
then. **No password, key, token, connection string or phone number goes on this sheet.**
Secret names and where they live are in `docs/pilot/SECRETS_ROTATION.md`.

- Written: [date]
- Filled by: [the lead]
- Checked by: [the deputy, once named]

## API: Render

- **Provider and address:** Render, `scrbrd.onrender.com`
- **Region:** [region, if known]
- **Account (email):** [account email: held by the lead]
- **Who holds the login:** [by role: the owner; the deputy once added]
- **Status page:** [URL]
- **How the provider tells us of a breach, and which inbox:** [route; inbox]
- **Log retention on this plan:** [days, as read from the provider's page on the day]

## Database: Supabase Postgres

- **Provider and plan:** Supabase Postgres, Free
- **Version:** [as the Supabase project reports it]
- **Region:** [region, if known]
- **Account (email):** [account email: held by the lead]
- **Who holds the login:** [by role: the owner; the deputy once added]
- **Status page:** [URL]
- **How the provider tells us of a breach, and which inbox:** [route; inbox]
- **Log retention on this plan:** [days, as read from the provider's page on the day]
- **Failed statements in the Postgres logs:** [yes or no, from one deliberate failed insert on a test row; the statement text carries `$1`-style placeholders, not values]

## Photo store: Supabase Storage

- **Account:** [the same account as the database, or the other one]
- **Who holds the login:** [by role]
- **Status page:** [URL]
- **How the provider tells us of a breach, and which inbox:** [route; inbox]
- **Log retention on this plan:** [days]

## Web app: Firebase Hosting

- **Project:** Firebase project `scrbrd-os`
- **Account (email):** [account email: held by the lead]
- **Who holds the login:** [by role]
- **Status page:** [URL]
- **How the provider tells us of a breach, and which inbox:** [route; inbox]
- **Log retention on this plan:** [days]

## Sign-in: Firebase Authentication with Google

- **Account (email):** [account email: held by the lead]
- **Who holds the login:** [by role]
- **Status page:** [URL]
- **How the provider tells us of a breach, and which inbox:** [route; inbox]

## Push: Firebase Cloud Messaging

- **Account (email):** [account email: held by the lead]
- **Who holds the login:** [by role]
- **How the provider tells us of a breach, and which inbox:** [route; inbox]

## Backups

- **Encrypted dumps:** the owner's encrypted dumps (`docs/pilot/BACKUP_RESTORE.md` §3), on [the encrypted disk]
- **Drill artifacts:** the drill's encrypted artifacts on GitHub, in the account [GitHub account]
- **Who holds the passphrase:** [by role; the passphrase is in the password manager, never in a chat]

## Reader: Anthropic (scorebook reader)

- **Account (email):** [account email: held by the lead]
- **Who holds the login:** [by role]
- **Flag state on production:** `scorebook_reader` off at every school, confirmed on [date] (pilot item P8)
- **How the provider tells us of a breach, and which inbox:** [route; inbox]

## The switches

From `docs/design/INCIDENTS_AND_BREACHES.md` §6.1. Each path is filled by the lead on
the day the sheet is written and checked on solo run 2.

| to stop | the switch | dashboard path | who may do it |
|---|---|---|---|
| everything | suspend the Render web service | [Render dashboard path] | the owner; the deputy once added |
| every public page and the pavilion screen | `PUBLIC_PAGES` off on Render (on the redeploy it triggers, a minute or two) | [Render dashboard path to the variable] | the owner; the deputy |
| one side's public page | **Withdraw** in Match Details | [app path] | the director of sport or the office |
| one module at one school | the module flag | [platform console path] | the platform |
| photos leaving the platform | the `scorebook_reader` flag, or remove its key | [platform console path; Render path to the key] | the platform |
| one account | account set inactive; sign out everywhere | [app path] | the school's office; the owner |
| one support session | end the support session | [app path] | the person who began it; the office |
| every session on the platform | rotate `SESSION_SECRET` on Render | [Render dashboard path] | the owner |
| owner recovery | unset `OWNER_RECOVERY_SECRET` on Render | [Render dashboard path] | the owner |
| the database role's password | reset in Supabase, then set `DATABASE_URL` on Render | [Supabase path; Render path] | the owner |
