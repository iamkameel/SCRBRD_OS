# Pilot match day runbook

15 October 2026. Westville Boys' High School v [opponent]. One fixture scored on the app and shown on the pavilion screen.

Fill in before the day: [opponent], [match link from the Match Centre], [who to call].

Every button name below is written as the app shows it. The scorers' own one-page guide is `docs/pilot/SCORER_HELP.md`.

---

## The day before (14 October)

### Check the server

1. Open `https://scrbrd-os.web.app/api/health` in a browser. Hosting sends `/api` to the API. If the school has been given a custom domain, use that address instead.
2. It must show `"ok":true` and `"db":"ok"`.
3. It must show `"public":"on"`. If it says `off`, the pavilion screen cannot work: public pages stay off until the information officer has confirmed `docs/policy/PUBLIC_DATA.md` in writing (`DEPLOYING.md`, "Turning the public pages on").
4. `"auth":"token_only"` is right for the pilot. `"auth":"dev_login_enabled"` means a test server.

### Phones and accounts

1. Charge both scorers' phones and restart them.
2. Each scorer opens `https://scrbrd-os.web.app/app` on their own phone (the home page at `https://scrbrd-os.web.app` has a **Log in** link to it). They tap **Continue with Google**, or type their email and the code from the school office in **Sign-in code** and tap **Sign In**. A code works once and expires, so ask the office for a fresh one on the morning if it was used.
3. If the screen says **Waiting for your school office**, the office has not linked that account yet. Ask [who to call].
4. Tap **Match Centre** (the bottom bar on a phone, or under **More**). The fixture must be listed. While it is upcoming its button reads **Start Scoring →**; once live it reads **Open Live Scorer →**. If there is no button, that account is not offered scoring: tell [who to call].
5. Rehearse on a practice match, not the real fixture: **Open SCRBRD Scorer**, then **Start Practice Match**. Score a few balls, a **Wicket** and an **Undo**. A practice match stays on the phone and is never counted.
6. **Do not** score balls on the real fixture before the match.

### Pavilion screen

1. Someone who may publish Westville Boys' High School's side (the director of sport or the office) taps the fixture's card in the Match Centre to open **Match Details**. Under **Public page** they tap **Publish** for the home side. If Westville Boys' High School is the away side, the home school publishes its own side.
2. A **Ground display** section appears with a link and a QR code. Choose **Floodlit** or **Daylight**, **Normal (12 s)** or **Long (24 s)**, and tick **Reduce motion** if wanted. The choices travel in the link.
3. Open that link in the pavilion screen's browser: [match link from the Match Centre]. Nobody signs in on it and nothing on it can be pressed.
4. Before the toss it shows **Before the toss** and "The board opens with the first ball."
5. If it says "This page is not available", the link is wrong or the match is not public (the side is not published, or public pages are off).
6. Test the Wi-Fi where the screen sits.

---

## Two hours before play

1. Agree who scores first and who stands by.
2. Both scorers sign in again, at the gate where there is signal.
3. The first scorer opens the fixture from **Match Centre** (**Open Live Scorer →** or **Start Scoring →**). If no toss is recorded, the pad shows **The toss**. Answer it only when the umpires have told you the result: the side batting first opens the innings and that cannot be undone on the pad.
4. The standby opens the same fixture afterwards. Their pad should say **Someone else is scoring this match**. Leave it.
5. Check the pavilion screen still shows **Before the toss**.
6. Open the health address again.

---

## During play

### First ball

1. The first scorer answers the sheets: the toss, the openers, **Opening Bowler**. If an amber bar says **Can't score yet**, its button opens the sheet that is missing.
2. The sync pill under the scoreboard should say **Sent**.

### Through the innings

- The pavilion screen shows only what has been sent. If the pill says **Held** or **On device**, the screen is behind until the balls go.
- At the end of each innings the check sheet opens. Compare it with the umpires' book, then tap **That is right — close the innings**. If it is wrong, tap **Take back the last ball**. After the first innings tap **Start 2nd Innings →**.
- A handover needs signal on both phones, because arming and claiming both call the server. The sheet will not arm while balls are unsent or a ball is half entered. Do it between balls, ideally at the end of an over. The steps are in the scorers' guide: **Hand over**, **Hand over scoring**, the six-digit code, **Take over**, **Claim this match**, then the second scorer types the physical scoreboard's figures and taps **Confirm and take over**.

### Rain or bad light

1. The scorer taps **Pad menu**, then **Play stopped**, picks **Rain**, **Bad light**, **Wet ground** or **Other**, and taps **Stop play**. The keys grey out. The pavilion screen shows **Play stopped**.
2. To restart, the scorer taps **Resume**, types the umpires' overs (and the target in a chase), and taps the button at the bottom of the sheet.
3. If play cannot restart, the scorer taps **End innings (rain)**. In a chase the sheet asks for the umpires' par score.

---

## If something goes wrong

### Pill says Refused

The server turned some balls down. They stay on that phone and still count on its board.

1. Tap the pill. The sheet **Refused by the server** lists each ball with the reason.
2. If the sheet says what to name first (a bowler, the next batter), name them on the pad, then tap **Record again**.
3. Tap **Discard** only when the scorer and the umpires' book agree the ball was wrong.

### Pill says For review

The server held balls sent under a token the phone no longer held. They are not in the scorebook. A supervisor decides on each one. Call [who to call].

### No signal at the ground

1. Scoring carries on. The pill says **Held** or **On device**, and the balls are saved on the phone.
2. If the page reloads or the phone restarts, the pad reopens with its score. If a bar says **Sign in**, tap it and sign in again. If the old code has been used, ask the office for a new one.
3. When signal returns the balls send by themselves. Wait for **Sent**.
4. There is no handover without signal.

### A bar says another device holds the match

- **Someone else is scoring this match** with a **Try again** button: another phone holds it. Do not score on both.
- **Another device has taken over scoring this match**: a handover finished. This phone sends nothing more.
- **Score on this device**: another device scored since this one last held the match, and the pad is showing the server's log.

### The pavilion screen

- **Last updated** followed by a time and "reconnecting", bottom right: the screen has lost its connection. Check the pavilion Wi-Fi.
- The screen says **This display is no longer available.** The side has been withdrawn from the public page.

---

## After the match

1. After the second innings the scorer's screen says **Match Complete**. The scorer stays until the pill says **Sent**, moving to where there is signal if needed.
2. In the Match Centre tap **Open match**, then **Scorecard**, and compare with the umpires' book.
3. The public page is at the link in the **Public page** panel: [match link from the Match Centre]. Only players whose family has consented are named; everyone else is shown by position.
4. To take the public page down, tap **Withdraw** in the same panel.

---

## Checklist for 14 October

- [ ] Health address shows `"ok":true`, `"db":"ok"`, `"public":"on"`
- [ ] Both scorers signed in, and the fixture and its button are there
- [ ] Both scorers rehearsed on a practice match
- [ ] Home side published and the pavilion screen shows **Before the toss**
- [ ] Pavilion Wi-Fi tested
- [ ] Phones charged
- [ ] [who to call] known to both scorers
