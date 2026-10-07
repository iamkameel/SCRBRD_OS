# Dress rehearsal, 8 October 2026

Kameel, two or three phones and a TV. Westville Boys' High School, pilot on 15 October. Tick each box as you go. Write every problem in the log at the end, with the time.

## Read first: what a practice match is

A practice match is scored on the real pad, with typed teams and names. It is kept on that phone only. It sends nothing to the server, appears in no fixture list, Match Centre or statistic, and is never counted. One exception: **Use my location** on its setup screen asks our server for the weather at the phone's position. Do not tap it.

So a practice match cannot show **Sent**, a handover, the ground display or a public page: none of these exist for it. Steps marked P use a practice match, on production, with invented names only. Never type a real child's name.

Steps marked S need a fixture on a server. Production has no seed, and its roster holds the school's real boys after the 6 October load. A test fixture there would put real children in the ball log, which cannot be deleted. So do S steps only on a demonstration copy (a separate database with the seed, per DEPLOYING.md, "A demonstration is not a pilot"). If there is none, skip them: they are first seen on 15 October.

## 1. Wake the service (P)

☐ On phone A, open `https://scrbrd.onrender.com/api/health` with a stopwatch. See `"ok":true`, `"db":"ok"`, `"public":"on"`, `"auth":"token_only"`. Time to the answer: ______ (up to a minute is expected).

☐ Then open `https://scrbrd.onrender.com/app`. Time to the sign-in screen: ______.

## 2. Sign in (P)

☐ Phone A: tap **Continue with Google**. Phone B: type your email and a fresh office code in **Sign-in code**, tap **Sign In**. Phone C: either. You should reach the app, not **Waiting for your school office**. A code works once: note who issued it.

☐ Tap **Match Centre** (bottom bar, or under **More**). The 15 October fixture is listed with **Start Scoring →** (or **Open Live Scorer →** once live). Do not open it.

## 3. Pick the side (look only)

The coach steps are not rehearsed with a real save. **Pick the side** lists the team's real boys, and **Save the side** writes them to the real fixture. A practice match has no side to pick. So look, and do not save.

☐ Coach's phone: **Match Centre**, tap the fixture's card. Under **Match Details** you should see **Pick the side**. Tap it, read the list, tap **Close**. Never tap **Save the side**. No button means this account does not hold that side: log it.

## 4. Toss, openers, an over, a wicket, undo (P)

☐ **Match Centre**, **Open SCRBRD Scorer**, **Start Practice Match**. Choose Custom overs, 2. Type two made-up teams and eleven made-up names each ("Test Batter 1").

☐ At **The toss** pick a winner, then **Bat**. Name the openers and the **Opening Bowler**. The pad shows the practice label "Practice match · kept on this phone".

☐ Open the **Pad menu**, tap **Basic Scoring**. Score a **Dot**, a four, a single and a **Wide**, then balls until the over ends (six legal balls). See the new-over sheet; pick a bowler.

☐ Score a **Wicket**, choose how out, tap **Confirm Out**. Pick the next batter on **Batting Order**, or type a name and tap **Go**.

☐ Tap **Undo**. See the last ball disappear and the score go back.

## 5. Phone offline for an over

☐ (P) Airplane mode on. Score one over. See the pill read **On device**: that is right for a practice match. Airplane mode off. Reopen `https://scrbrd.onrender.com/app`, then on "Practice match in progress" tap Resume. The score is as you left it.

☐ (S) Demonstration copy: airplane mode on, score an over. See **Held** with a count. Airplane mode off. See the count fall, then **Sent**.

## 6. Hand over and take over (S)

☐ Phone A, pill at **Sent**, between overs: tap **Hand over**, then **Hand over scoring**. A six-digit code shows.

☐ Phone B, same fixture: tap **Take over**, type the code, tap **Claim this match**. Type the physical scoreboard's runs, wickets, overs and balls. Tap **Confirm and take over**. Score one ball on B.

☐ Phone A now shows **Handed over** and scores nothing more.

## 7. The ground display (S, or pre-toss on the real fixture)

☐ On a phone, open the fixture's **Match Details**. Under **Public page** tap **Publish** for the home side. A Ground display section shows a link and QR code. Publishing is public: use the real fixture only if you accept that, answer nothing at the toss, and tap **Withdraw** afterwards unless you leave it until 14 October. The page names no boy while no family consent is recorded. If it names one, tap **Withdraw** and log it.

☐ Open the link on the TV. Choose **Floodlit**, then **Daylight**, and the 12-second or 24-second setting, and tick **Reduce motion** once. Reopen the new link each time. See **Before the toss**, readable from the back of the room.

☐ (S) Score balls on A. The TV follows within seconds. Switch off the TV's Wi-Fi: see **Last updated** and "reconnecting".

## 8. Signed out, on a phone (S for the match page)

☐ A phone with no session (private tab): open `https://scrbrd.onrender.com`. See the home page and its **Log in** link.

☐ Open the match link from step 7 (`/live/` and the match id). See the match page, not "This page is not available".

## 9. End the innings and the match

☐ (P) Finish the innings. The check sheet opens. Tap **That is right — close the innings**, then **Start 2nd Innings →**. Finish the chase. See **Match Complete**.

☐ (P) Back on the start screen, tap **Practice Matches**, then **Delete all practice matches**. Confirm. See "Deleted. No practice match, name or weather record is left on this phone." Do this on every phone.

☐ (S) Wait for **Sent**. In **Open match**, check the scorecard.

## What went wrong

| Time | Phone | Step | What happened | Screenshot |
|---|---|---|---|---|
| | | | | yes / no |
| | | | | yes / no |
| | | | | yes / no |
| | | | | yes / no |

## Afterwards, send Claude

- The log, filled in.
- Every screenshot, named by the step.
- The exact time of each problem, with the phone, so the server logs can be matched. Include the two stopwatch times from step 1.
- The steps you skipped, and why.
