# CRI-0.2 screenshot set: what clips

Evidence for Sprint 1's redesign of the match page (docs/design/CRICINFO_GAP_PLAN.md section 6, Sprint 0). Produced by `tools/shots-cri02.mjs`; no app code changed.

- Screens: fixtures, summary, scorecard, commentary, pad. Widths: 360, 390, 768, 1440. Themes: Daylight (colour scheme light), Floodlit (dark).
- Data: the seed plus tools/fixture-matchcentre.mjs's live fixture (Hilton College 1XI v Westville Boys' High 1XI, ten overs, second innings under way). Invented names only. The Match Centre is read as the seeded director of sport, the pad as the seeded scorer.
- Measured in the page by `narrowAudit` (tools/a11y-narrow.mjs), the narrow walk's own audit, with its floors: 12px text, 44px taps. Widths 360 and 390 are drawn as a touch phone, 768 and 1440 as a desktop; the 44px tap floor is the phone floor, so on 768 and 1440 read the "tap target" lists as secondary.
- Pictures are PNG, or JPEG at quality 70 where the PNG ran over about 300 KB; a page taller than 3200px is cut at 3200px. The shell scrolls its main, so the viewport is grown to the content's height before each picture; on a phone the fixed bottom bar is therefore drawn at the foot of the picture, over the last content, not at the foot of the first screen.
- Each line is one element, written as the audit describes it, with the width and theme it was seen at. Identical elements are merged. Lines are capped at 25 per kind per screen; the count is given.

## Pictures

| Screen | Width | Theme | File | Size | Note |
|---|---|---|---|---|---|
| Fixtures list (Match Centre) | 360 | Daylight | fixtures-360-daylight.png | 137 KB |  |
| Match Centre, Summary | 360 | Daylight | summary-360-daylight.png | 258 KB | cut at 3200px of 3612 |
| Scorecard | 360 | Daylight | scorecard-360-daylight.png | 115 KB |  |
| Commentary | 360 | Daylight | commentary-360-daylight.png | 261 KB | cut at 3200px of 7195 |
| Scoring pad | 360 | Daylight | pad-360-daylight.png | 53 KB |  |
| Fixtures list (Match Centre) | 390 | Daylight | fixtures-390-daylight.png | 131 KB |  |
| Match Centre, Summary | 390 | Daylight | summary-390-daylight.png | 268 KB | cut at 3200px of 3481 |
| Scorecard | 390 | Daylight | scorecard-390-daylight.png | 115 KB |  |
| Commentary | 390 | Daylight | commentary-390-daylight.png | 268 KB | cut at 3200px of 6793 |
| Scoring pad | 390 | Daylight | pad-390-daylight.png | 53 KB |  |
| Fixtures list (Match Centre) | 768 | Daylight | fixtures-768-daylight.png | 206 KB |  |
| Match Centre, Summary | 768 | Daylight | summary-768-daylight.jpg | 211 KB |  |
| Scorecard | 768 | Daylight | scorecard-768-daylight.png | 135 KB |  |
| Commentary | 768 | Daylight | commentary-768-daylight.jpg | 234 KB | cut at 3200px of 5462 |
| Scoring pad | 768 | Daylight | pad-768-daylight.png | 59 KB |  |
| Fixtures list (Match Centre) | 1440 | Daylight | fixtures-1440-daylight.jpg | 99 KB |  |
| Match Centre, Summary | 1440 | Daylight | summary-1440-daylight.jpg | 257 KB |  |
| Scorecard | 1440 | Daylight | scorecard-1440-daylight.png | 187 KB |  |
| Commentary | 1440 | Daylight | commentary-1440-daylight.jpg | 302 KB | cut at 3200px of 5168 |
| Scoring pad | 1440 | Daylight | pad-1440-daylight.png | 62 KB |  |
| Fixtures list (Match Centre) | 360 | Floodlit | fixtures-360-floodlit.png | 149 KB |  |
| Match Centre, Summary | 360 | Floodlit | summary-360-floodlit.png | 265 KB | cut at 3200px of 3612 |
| Scorecard | 360 | Floodlit | scorecard-360-floodlit.png | 113 KB |  |
| Commentary | 360 | Floodlit | commentary-360-floodlit.png | 265 KB | cut at 3200px of 7195 |
| Scoring pad | 360 | Floodlit | pad-360-floodlit.png | 52 KB |  |
| Fixtures list (Match Centre) | 390 | Floodlit | fixtures-390-floodlit.png | 151 KB |  |
| Match Centre, Summary | 390 | Floodlit | summary-390-floodlit.png | 275 KB | cut at 3200px of 3481 |
| Scorecard | 390 | Floodlit | scorecard-390-floodlit.png | 113 KB |  |
| Commentary | 390 | Floodlit | commentary-390-floodlit.png | 276 KB | cut at 3200px of 6793 |
| Scoring pad | 390 | Floodlit | pad-390-floodlit.png | 52 KB |  |
| Fixtures list (Match Centre) | 768 | Floodlit | fixtures-768-floodlit.png | 208 KB |  |
| Match Centre, Summary | 768 | Floodlit | summary-768-floodlit.jpg | 207 KB |  |
| Scorecard | 768 | Floodlit | scorecard-768-floodlit.png | 132 KB |  |
| Commentary | 768 | Floodlit | commentary-768-floodlit.jpg | 231 KB | cut at 3200px of 5462 |
| Scoring pad | 768 | Floodlit | pad-768-floodlit.png | 58 KB |  |
| Fixtures list (Match Centre) | 1440 | Floodlit | fixtures-1440-floodlit.jpg | 98 KB |  |
| Match Centre, Summary | 1440 | Floodlit | summary-1440-floodlit.jpg | 250 KB |  |
| Scorecard | 1440 | Floodlit | scorecard-1440-floodlit.png | 186 KB |  |
| Commentary | 1440 | Floodlit | commentary-1440-floodlit.jpg | 296 KB | cut at 3200px of 5168 |
| Scoring pad | 1440 | Floodlit | pad-1440-floodlit.png | 61 KB |  |

## Seen in the pictures, not measured

Read off the 360 and 390 pictures by eye; the audit above does not flag these. They are layout facts for Sprint 1, not faults of the floors.

- Match header (Summary, Scorecard, Commentary), 360 and 390: the title "Hilton College 1XI v Westville Boys' High 1XI" wraps and leaves "1XI" alone on a line; the "Corrected" note appears twice (a line under the score and a chip under the venue); the header, its buttons and the tab strip take about 450px before any score content, which is most of the first screen.
- Tab strip, 360 and 390: seven tabs scroll sideways and the Commentary label is cut at the right edge ("Commentar") with no fade or arrow to say there is more; Partnerships, Analytics and Match details are off screen.
- Scorecard, 360 and 390: 11 batters' rows with "Did not bat" each take a full row, so the bowling card and fall of wickets sit below the second screen; the dismissal line wraps to two lines ("c P Govender b P Govender").
- Commentary, every width: grouped by over, newest over first, with an end-of-over summary line, but no filter (wickets, boundaries, an over) and no jump to an over; the whole match is one scroll (5168px at 1440). At 1440 the column runs the full content width (about 950px), so a commentary line sits far from its ball number. On a phone the Summary label is cut on the left when the Commentary tab is selected (the strip has scrolled to it).
- Fixtures list, 360: the three buttons of an upcoming card wrap onto two rows ("Dossier" alone); opponents are shortened to codes ("WES 1XI", "WBH") on some cards and written in full on others.
- Pad, 360 and 390: the match title in the header wraps to two or three lines and pushes the board down; the board's team name wraps ("WESTVILLE BOYS' HIGH / 1XI"). At 768 and 1440 the pad is the phone layout in a wider column, with empty space either side.

## Fixtures list (Match Centre)

Nothing found at any width or theme.

## Match Centre, Summary

### Scrolls sideways, content cut at the edge until scrolled: 2 elements

- <div mc-tabs role=tablist> "Match Centre" content 713px in a 336px box (360 Daylight; 360 Floodlit)
- <div mc-tabs role=tablist> "Match Centre" content 713px in a 366px box (390 Daylight; 390 Floodlit)

## Scorecard

### Scrolls sideways, content cut at the edge until scrolled: 2 elements

- <div mc-tabs role=tablist> "Match Centre" content 714px in a 336px box (360 Daylight; 360 Floodlit)
- <div mc-tabs role=tablist> "Match Centre" content 714px in a 366px box (390 Daylight; 390 Floodlit)

## Commentary

### Scrolls sideways, content cut at the edge until scrolled: 2 elements

- <div mc-tabs role=tablist> "Match Centre" content 715px in a 336px box (360 Daylight; 360 Floodlit)
- <div mc-tabs role=tablist> "Match Centre" content 715px in a 366px box (390 Daylight; 390 Floodlit)

## Scoring pad

Nothing found at any width or theme.

## Shell around every screen (sidebar, bottom bar, top bar)

### Text under 12px: 1 element

- 9px <span> "▾" (1440 Daylight; 1440 Floodlit)

### Tap target under 44px: 27 elements

- 5x16 <button sidebar-toggle> "Collapse navigation" (1440 Daylight; 1440 Floodlit)
- 181x32 <button> "Cricket▾" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-dashboard> "Dashboard" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-news> "Newsfeed" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-matches> "Match Centre" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-calendar> "Calendar" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-competitions> "Competitions" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-officials> "Officials" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-squad> "Squad" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-profiles> "Profiles" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-injuries> "Injuries" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-staff> "Staff" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-analytics> "Analytics" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-skills> "Skills" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-training> "Training" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-logistics> "Logistics" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-fields> "Fields" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-sponsors> "Sponsors" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-readiness> "To resolve" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-management> "Management" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-children> "Home" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-family> "Family" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-notifications> "Alerts8" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-safeguarding> "Safeguarding" (1440 Daylight; 1440 Floodlit)
- 197x39 <button nav-settings> "Settings" (1440 Daylight; 1440 Floodlit)
- ... and 2 more
