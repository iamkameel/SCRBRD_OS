# The scorebook reader: sign-off for the information officer

**For:** Kameel, as information officer. **Written:** 2026-09-30. **Status:** not yet signed. Until it is, the
`scorebook_reader` switch stays off in production and no page is ever sent anywhere.
**Design:** `docs/design/SCRBRD-120_scorebook_importer.md` §6 and D8. §9.5 records the facts as built.

## What it does, in one paragraph

A scorer photographs the paper scorebook. With the reader on, the platform sends those page photos to an AI model,
which reads the handwriting and fills in the scorecard. A person still checks every cell against the photo and ticks
it, and a second person confirms, exactly as when the card is typed by hand. The reader saves typing. It is never
trusted on its own.

## What leaves the platform, and what does not

| Sent | Never sent |
|---|---|
| The page photos of one import, metadata already stripped | The squad or roster, or any name from our database |
| A hint: which innings, and balls per over | Dates of birth, ID numbers, contact details, medical data |
| Nothing else | The school's name, beyond what is written in the book itself |

The photos carry what the book carries: both teams' boys' names in handwriting, and the figures.

## Who receives it

Anthropic, the provider of the Claude models the platform already uses for Stats Magic. It would act as an
**operator** under POPIA. Its processing is likely to be outside South Africa, which makes this a **cross-border
transfer** (POPIA s72).

## What must be true before you sign (tick each one)

1. **Retention.** Anthropic's terms for our API account are read and filed, including how long API inputs and outputs
   are kept and whether zero data retention applies to our account. *To confirm with Anthropic; do not assume it.*
2. **Use.** The same terms say our inputs are not used to train models. *To confirm.*
3. **An operator agreement** (POPIA s20–21) is in place: Anthropic's commercial terms or data processing addendum,
   accepted for the account that holds the key.
4. **Cross-border.** Recorded that the transfer rests on the operator's binding terms, s72(1)(b).
5. **The privacy notice** of each school that switches it on gains the line below.
6. **The processing record.** Every read writes `read_by` on the import: provider, model, time, and a hash of each page
   sent. The record is kept with the import's rows after the photos are deleted.
7. **Per school.** The platform switches the reader on for one school at a time, only where that school's notice
   carries the line.

## The line for the school's privacy notice (proposed)

> When a paper scorebook is imported, photographs of its pages may be read by an automated service (Anthropic's Claude)
> to fill in the scorecard, which a member of staff then checks. Only the photographs are sent. They are not kept by the
> service beyond the time needed to read them*, and the school deletes its copies 30 days after the scorecard is
> confirmed.
>
> \* adjust to what item 1 confirms.

## What you are signing

That the reader may be switched on, school by school, under items 1–7. Photos remain deleted 30 days after
confirmation (D7), and every other rule of the importer stands.

**Signed:** ______________________ (information officer) **Date:** __________

**Retention confirmed as:** ______________________
