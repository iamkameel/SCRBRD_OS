# A parent asks: "who read my child's record?"

**For the school office.** The target is **five minutes** from the question to the answer. `tools/smoke-who-read.mjs` rehearses these steps on the seed data on every verify, so a change that breaks them is caught. It is the PILOT_DAY_RUNBOOK checklist item "a parent's question 'who read my child's record' can be answered ... in under five minutes".

A full request for everything held about a child is a different job: use `ACCESS_REQUEST_RUNBOOK.md`. This page is the quick question only.

## Who may do this

Only someone who holds **audit.read** at the school: the principal, the director of sport and the school office (`schooladmin`), and the platform administrator. A coach, team manager, scorer, parent or pupil cannot. The Designated Safeguarding Officer holds it too, but for his own concerns only; he is not the route for this question.

Before anyone opens the child's record, check that the asker may ask: step 2 of `ACCESS_REQUEST_RUNBOOK.md` (a live, verified guardian link, or photo ID and documents). Write no child's name in a message or file name.

## The steps

| # | what you do | about |
|---|---|---|
| 1 | Check standing (above). Note the child's roster entry. | 1 min |
| 2 | Sign in as the office. Open **Settings**, then **School**. Scroll to **On the record: who read what**. | 30 s |
| 3 | Ask for the reads about **that one child**: the log's per-child question, `GET /api/read/access_log?playerId=<the child's id>`, signed in as the office. | 1 min |
| 4 | Read the list from the top. Each row is one read: **who**, **what** kind of record, which **fields**, **when**, and **how** (own school, platform, or a support session). | 1 min |
| 5 | Write the answer for the parent, by role, school and kind of record (below). | 1 to 2 min |

The reading of your own question is on the record too: it names the child in the log, as every read of the log does.

## What the answer shows

- Every read of a **restricted field** of his record at this school (a date of birth, an injury note, a clinical note), and every read of his record made from **outside** the school (the platform, or a support session).
- For each: the reader's name (the office sees it), the kind of record (`players`, `injuries` ...), the fields that came back, how many records, the time, and how they reached the school.
- Newest first, up to 500 rows, this school's rows only. Another school's office sees none of this school's reads.

## What it never shows

- **Safeguarding.** A read of a concern is never on this list, even if the concern names the child. The log hides every safeguarding row from the principal, the office, the director of sport and the platform alike (db/57), so the list cannot tip anyone off. Do not look elsewhere for it. If the parent asks about it, say nothing about whether any exists and point them to the Designated Safeguarding Officer's card in the app.
- **Reads that left nothing restricted.** A coach reading the squad list or a fixture writes no row. "Nobody read his date of birth" is true; "nobody looked at his name" is not something this can say. Do not say it.
- **Reads before the log began**, and the reasons or free text behind any act.
- The audit tab (`audit_log()`) is a different view: it also leaves out every safeguarding row and every free text, and shows a child as initials. It cannot answer for one child.

## What you tell the parent

By **role, school and kind of record**: "In the last term, the school's physio and the U15A coach read his injury record on [dates]." The names of staff stay with the office; give one in person only if the parent asks. This is the same line as `ACCESS_REQUEST_RUNBOOK.md` section 6.

## Gap, until the screen has a child picker

The API answers for one child, but **the screen does not yet**. **On the record: who read what** lists the school's 40 newest restricted reads across all children, shows no child, and has no filter. So step 3 is a request the office cannot make from the screen alone: someone with the office's signed-in session makes the per-child call for now. Until the screen gains a "this child" choice (a UI change, not SQL), the five minutes holds only when that person is at hand. Rehearse with them before the pilot.
