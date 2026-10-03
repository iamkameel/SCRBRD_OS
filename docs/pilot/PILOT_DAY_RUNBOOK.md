# Pilot Match Day — Runbook

15 October 2026, Westville Boys' High. Scoring and live broadcast for one fixture.

---

## The Day Before

### Phones and Accounts

1. Charge both scorers' phones to 100% and restart them
2. Sign in with each scorer's account (`scorer@example.invalid` logins at your school)
3. Open the app, tap **Match Centre**, find the fixture (1XI vs Michaelhouse), and tap **Open Live Scorer**
4. Verify that both pads open without a login code required — if they ask for a code, the session has ended; sign out and sign back in
5. Close the app on both phones

### API Health Check

1. Visit the health check: `https://your-api-url/api/health`
2. Confirm all three lines show green: `db: ok`, `auth: ok` (or `auth: "dev_login_enabled"` for a test run)
3. Note the URL for the display screen (below)

### Ground Display Screen

1. Open a tablet or laptop on the pavilion WiFi
2. Go to `https://your-api-url/display/77777777-0000-0000-0000-000000000002` (ask your technical person for the correct match ID)
3. Bookmark it
4. Do not close the browser — close the tab only; test that refreshing (Ctrl+R) shows the current score
5. Test WiFi signal at the scorer's box — if weak, you may have connectivity issues during the match

---

## Two Hours Before Play

### Fixture Details

1. Confirm the teams, the match location and time, and the ground with the umpires
2. Check that both scorers have the right fixture open (both phones show the same match)
3. Verify the toss in the app (if your school records it in advance). If not recorded:
   - The pad will ask the toss question when the first scorer opens the match
   - Make sure they have signal before play starts so the server knows who bats first

### Ground Display

1. On the pavilion screen, open the display page (bookmarked above)
2. Refresh the page (Ctrl+R)
3. Verify that it shows "No match started" or the current score if one exists
4. Leave it open; it will update automatically every 10 seconds
5. Do not close the app on the scorers' phones if the display needs to update

---

## During the Match

### Before First Ball

1. Confirm with the umpires that play is about to start
2. First scorer: tap to open the pad. Answer any setup sheets (toss, openers, bowler)
3. Both scorers: tap the score area to confirm you can see it — the board should show the team names and 0 runs
4. Check the sync pill (bottom of the pad) — it should say **Sent** (if signed in) or **On device** (if no signal)

### During Play

**If there is signal:**

- Watch the sync pill: if it ever says **Held**, there is an error. Stop and ask the office (below)
- Reload the pavilion screen every two overs so spectators see the up-to-date score

**If there is no signal:**

- The scorers can keep scoring. Balls stay on the phone in the **On device** state
- Every time one scorer finishes an over, check the boards match — runs, wickets, overs
- Do not hand over during an over if there is no signal (below)

### Score Handover

**If changing scorers between innings (preferred):**

1. First scorer: open the pad menu (**⋯**) and tap **Hand over**
2. Wait for the sync pill to say **Sent** (if there is signal). Wait for signal to come back if needed — do not hand over without all balls sent
3. Tap **Arm handover**. A code appears (example: 123456)
4. Read the code aloud to the second scorer
5. Second scorer: on their phone, open the same match, tap the pad menu (**⋯**), tap **Hand over**, then **Take over**
6. Type the code: 1, 2, 3, 4, 5, 6
7. Second scorer: check the board on their screen against the physical scoreboard (runs, wickets, overs, batters)
8. If they match, tap **Confirm**
9. If they do not match, tap back and ask the office to help (below)

**If you must hand over mid-over (phone dying, scorer leaving):**

1. First scorer: wait until the bowler is running in (to avoid confusion), then hand the phone to the second scorer
2. Second scorer: keep scoring from where the first scorer left off
3. No code is needed — the new scorer signs in with their account and the app joins the same match
4. You will be on a different token, and the sync system tracks both scorers — this is recorded in the match history

### Stopping Play (Rain)

1. Scorer: tap the pad menu (**⋯**) and tap **Play stopped**
2. Select the reason (Rain, Bad light, Wet ground)
3. Tap **Stop**
4. Pavilion screen: it will show the over as stopped; batters and bowlers are removed from the board

### Resuming Play

1. Scorer: tap the pad menu (**⋯**) and tap **Resume play**
2. If the umpires shortened the overs (for example, from 20 to 16), enter the new overs
3. In the chase, enter the new target the umpires set
4. Tap **Resume**
5. The board updates; scoring continues

---

## If Something Goes Wrong

### Scorer's App Refused Balls

If the sync pill shows **Held 2** (or any number) — the server refused some balls:

1. Do not keep scoring — you are now out of sync with the server
2. Call the office (see below)
3. The office will review the refused balls and approve or discard them
4. The app will say when it is safe to score again

### Connection Lost or Worse

If the pad says "Signing in…" or does not respond for more than 30 seconds:

1. Do not reload the page — keep the app open
2. Check the phone's WiFi or mobile signal
3. If there is still no connection after 5 minutes, close the app and reopen the match (do not restart the phone)
4. If it still does not connect, continue scoring offline — the pad will send everything when the connection returns

### Technical Help (Call the Office)

If you need to contact your technical person or the school office:

1. The match ID is in the app: open the Match Centre, find the fixture, and tap it — the ID is in the URL
2. Tell them the scorer's name, the phone's device ID (in the app settings or sign-in page), and what is not working
3. Ask them to check the API health: `https://your-api-url/api/health`
4. If they fix it, reload the page and carry on — you do not have to restart

---

## After the Match

### Check the Scorecard

1. When both innings are finished, the app shows a result screen
2. Review it (runs, wickets, overs per side)
3. Tap **Accept**
4. The match is sealed and sent to the server

### Send Results to School

1. In the Match Centre, find the fixture and tap it
2. Go to the **Result** tab
3. The school will see:
   - Team names and overs (example: Hilton College 1st innings 42 all out off 15.2 overs)
   - The man of the match (if set)
   - Full scorecard (every batter and bowler's figures)
4. Copy the link to the match and send it to the school or post on their sports board
5. That link is the live scorecard — it updates every time a match is scored

---

## Offline Day (No Signal at the Ground)

If the ground has no signal:

1. Before the match, sign in at a place with signal (the office, home) so both phones have an active session
2. Open the match on both phones — the app will load the fixture details
3. Close the app but leave WiFi on — the app will cache the fixture details
4. At the ground, open the app; it will try to connect but carry on offline
5. Score normally — every ball is saved on the phone
6. The pavilion display will show "No match active" (offline, no signal)
7. After the match, go back to a place with signal (the office) and reload the app
8. All balls will send to the server and the scorecard will appear online

---

## Checklist for 14 October (Day Before)

- [ ] Both scorers' phones charged and restarted
- [ ] Both scorers signed in and can open the fixture
- [ ] API health check is green
- [ ] Display screen bookmarked and working
- [ ] Pavilion WiFi tested at the scorer's box
- [ ] Umpires confirmed start time and teams
