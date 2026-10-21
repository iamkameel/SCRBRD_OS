# Secrets rotation

Design: `docs/design/INCIDENTS_AND_BREACHES.md` §9.3 (D26). This page covers the secrets
the platform uses, where each one is set, how to rotate it, and what breaks when you do.

**Names only.** This file names environment variables and secrets. It never holds a
value, and no value goes in a chat or a commit. The lead fills each dashboard path in
square brackets and checks it on solo run 2.

Last checked: [date], by [the lead].

| secret (name) | where it lives | how to rotate it | what breaks |
|---|---|---|---|
| `SESSION_SECRET` | Render, environment variables: [Render dashboard path] | set a new value, then redeploy | everyone signs in again. On a match day, rotate last, and never mid-innings |
| `DATABASE_URL` (the `scrbrd_app` role's password) | Supabase, the role's password: [Supabase path]; then Render, environment variables: [Render path] | reset the role's password in Supabase; set the connection string in Render; redeploy | the API is down for the redeploy |
| `SCRBRD_PROD_OWNER_URL` (the owner connection string) | GitHub secret: [GitHub path]; the owner's machine | reset the owner's password in Supabase; update the GitHub secret | the drill workflow needs the new one |
| `OWNER_RECOVERY_SECRET` | Render, environment variables: [Render path] | set a new value, or unset it | owner recovery is closed until it is set again |
| `PUBLIC_PSEUDONYM_SECRET` (32 or more characters) | Render, environment variables: [Render path] | set a new value of 32 or more characters | every public pseudonym changes; shared public links to pseudonymous ids stop resolving. Rotate only on exposure |
| `BACKUP_PASSPHRASE` | GitHub secret: [GitHub path]; the password manager | a new passphrase; re-encrypt the kept dumps; delete the drill's encrypted artifacts made under the old one | — (none recorded) |
| `ANTHROPIC_API_KEY` | Render, environment variables: [Render path] | revoke the key in the provider's console; set the new one | the scorebook reader and Stats Magic pause |
| `GOOGLE_WEATHER_API_KEY` | Render, environment variables: [Render path] | as `DEPLOYING.md:375` describes | weather pauses |
| Firebase service credentials, and FCM | Firebase console: [Firebase path]; Render, environment variables: [Render path]. Variable names: [the lead fills] | revoke the credential in the Firebase console; reissue it; set it in Render; redeploy | push pauses; sign-in may pause |
| Supabase service and anon keys, and Storage | Supabase: [Supabase path]. Variable names: [the lead fills] | regenerate the key in Supabase; set it in Render; redeploy | the photo store pauses |
