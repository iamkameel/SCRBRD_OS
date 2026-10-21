# Data event register entry: [reference]

**Template. Copy it for each data event and fill in the headings.** It holds no data
and must stay that way in the repository.

Keep each filled-in entry only on the encrypted disk where a dump may live
(`docs/pilot/BACKUP_RESTORE.md` §3), with the passphrase in the password manager.
Never in this repository and never in a chat. Write no child's name, and no personal
value (an email, an identity number, a date of birth, a value from a record). Name
stores, tables, column classes and counts only.

A correction is a later, dated note in the history below. Do not edit an earlier note.

A pilot with no event is itself an entry: "no data event recorded, 31 October 2026",
signed by the information officer and the second reader.

## Entry

- **reference:** [the reference as issued, `DE-` and its code]
- **kind:** [kind, from the list in `docs/design/INCIDENTS_AND_BREACHES.md` §3.2]
- **severity:** [severity, from the list in `docs/design/INCIDENTS_AND_BREACHES.md` §3.3]
- **discovered_at:** [date and time]
- **discovered_by:** [the app user, or for a provider's message: the provider and the date of its message]
- **summary:** [at most 500 characters; names no child]
- **schools:** [every school whose people are in scope]
- **created_at:** [date and time]

## What was seen, or could have been

[What was seen, or what could have been seen, in plain words.]

## Stores, tables and column classes

Column classes: health, discipline, identity, contact, safeguarding. Values are never
written here.

- [store, table, column class]

## Whose data

- **By count, per school:** [school: count]
- **Subjects list:** [held by the information officer as ids only; no names here]

## Who had access in the window, and how we know

- [the access log rows (their keys), a provider's ticket number, or a provider log line's time]

## What we switched off, and when

- [what was switched off, the time, and by whom]

## Classification and both signatures

- **classification:** [compromise, near_miss, outage or not_personal_data]
- **second reader (counterpart):** [the person, by role; the name is held by the information officer]
- **signed by the information officer:** [date]
- **signed by the second reader:** [date]

## Who was told, when, by which route, and the text sent

- [who, when, the route, and the text sent or where it is kept]

## What the Regulator said

- [the Regulator's reference, what it said, and the date]

## What changed afterwards

- [what changed, and why]

## History

Each act is one dated row. Rows are added, never changed. Kinds: `contained`,
`evidence`, `classified`, `dissented`, `school_told`, `dso_concern_raised` (the
concern's reference only, never its content), `regulator_notified`,
`families_notified`, `held_back_s22_3`, `review`, `closed`, `note`.

Kept for 7 years after the closing note (`docs/design/INCIDENTS_AND_BREACHES.md` §7.4).

| at | by | kind | body, and any classification, counterpart, subjects count or Regulator reference |
|---|---|---|---|
| [date and time] | [app user] | [kind] | [text] |
