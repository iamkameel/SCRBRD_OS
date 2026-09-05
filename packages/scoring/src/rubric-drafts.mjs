/**
 * SCRBRD — DRAFT behavioural anchors. NOT COACHING CONSENSUS.
 *
 * Every entry here was written to be argued with. They are a first pass at what
 * a 4, 8, 12, 16 and 20 should look like for each attribute, so that the people
 * who actually know — a head coach, a director of sport — have something to
 * redline instead of a blank form. Filling in a blank form for 33 attributes is
 * a job nobody starts; correcting somebody else's wrong sentence takes a
 * minute and produces a better sentence.
 *
 * WHY THEY ARE KEPT SEPARATE FROM `ANCHORS`
 * ────────────────────────────────────────
 * Because rubric.mjs already says, correctly, that a placeholder anchor is
 * worse than none: a coach reads it and calibrates against it, and the drift
 * that follows is indistinguishable from a player changing. Merging these into
 * ANCHORS would close the gate on the strength of writing that no coach has
 * approved.
 *
 * So they live here, `rubricIsReady()` still returns false, `unanchoredSkills()`
 * still lists all 32, and anything that displays one is obliged to say it is a
 * draft. What they buy is a starting point, not a shipped rubric.
 *
 * HOW TO APPROVE ONE
 * ──────────────────
 * Move the entry into ANCHORS in rubric.mjs, edited to whatever the coach
 * actually said. When the last one moves, the gate opens by itself.
 *
 * THE SCALE THESE ARE WRITTEN AGAINST
 * ───────────────────────────────────
 *    4 — a beginner, or a weakness that costs the team
 *    8 — functional at the level below; adequate in a school side
 *   12 — a reliable first-team schoolboy
 *   16 — the best in the school; noticed by opposition coaches
 *   20 — provincial trial standard, which is the ceiling and does not move
 *
 * Written as OBSERVABLE BEHAVIOUR, deliberately. "Good technique" is not an
 * anchor; "plays the ball under his eyes with a still head" is something two
 * coaches can agree they did or did not see.
 */

export const DRAFT_ANCHORS = Object.freeze({
  // ── TECHNICAL: with the bat ──
  "technical.timing": Object.freeze({
    4:  "Hits at the ball rather than through it; middles little, and mostly by accident.",
    8:  "Finds the middle off the front foot when the ball is there; hard hands under pressure.",
    12: "Consistently middles good-length bowling; recognises when to let the ball come to him.",
    16: "Timing survives a change of pace; scores freely off both feet without visible effort.",
    20: "Times the ball under provincial-standard pace and spin, on slow tracks as well as true ones.",
  }),
  "technical.power": Object.freeze({
    4:  "Cannot clear the inner ring; boundaries come from placement and edges only.",
    8:  "Clears the ring off a full ball; struggles to hit square or behind with any force.",
    12: "Clears the rope down the ground when set; reliable gap-piercing in the arc.",
    16: "Clears the boundary off good-length bowling on demand, both sides of the wicket.",
    20: "Hits for six against provincial pace and against spin, from ball one if the situation asks.",
  }),
  "technical.shotRange": Object.freeze({
    4:  "Two or three scoring shots, all on one side of the wicket.",
    8:  "Front-foot drives and a leg-side clip; visibly short of options against a good field.",
    12: "Scores all round the wicket; has a sweep or a cut he trusts under pressure.",
    16: "Full range including at least one shot that manufactures a gap where the field has none.",
    20: "Options against every length and line at provincial pace, chosen rather than defaulted to.",
  }),
  "technical.defence": Object.freeze({
    4:  "Plays at almost everything; no judgement of what to leave.",
    8:  "Defends the straight ball; drawn into playing outside off stump.",
    12: "Solid front and back defence; leaves well outside off; sees off a new ball.",
    16: "Defends good bowling for long periods without scoring, and does it deliberately.",
    20: "Technique holds against provincial seam and swing on a helpful surface.",
  }),
  "technical.againstPace": Object.freeze({
    4:  "Backs away; head falls to the off side against anything quick.",
    8:  "Handles medium pace; hurried and cramped against genuine speed.",
    12: "Watches the ball onto the bat against the fastest in the age group; ducks and sways correctly.",
    16: "Scores off quick bowling rather than surviving it; pulls and hooks by choice.",
    20: "Comfortable against provincial-standard pace, including the short ball, on a quick pitch.",
  }),
  "technical.againstSpin": Object.freeze({
    4:  "Reads nothing out of the hand; plays from the crease and hopes.",
    8:  "Defends spin off the front foot; no method for using the crease or the sweep.",
    12: "Uses feet and crease depth; picks the obvious variation; rotates strike against spin.",
    16: "Reads the ball out of the hand; attacks spin without losing shape.",
    20: "Picks a provincial leg-spinner from the hand and scores off both the stock ball and the variation.",
  }),

  // ── TECHNICAL: with the ball ──
  "technical.lineAndLength": Object.freeze({
    4:  "Sprays both sides; concedes extras; cannot repeat a length.",
    8:  "Lands most on the cut strip; length varies over by over.",
    12: "Repeats a good length on a chosen line; bowls a maiden when asked to.",
    16: "Hits the same spot under pressure at the death and with a short boundary.",
    20: "Sustains a provincial-standard channel across a long spell, on any surface.",
  }),
  "technical.seamAndSwing": Object.freeze({
    4:  "Nothing off the seam or in the air; the ball goes straight on.",
    8:  "Occasional movement, unintended; cannot say which way it will go.",
    12: "Swings the new ball one way on demand; gets something off the seam on a helpful pitch.",
    16: "Moves it both ways with a repeatable action; sets a batter up over an over.",
    20: "Controls conventional swing and seam at provincial pace, including with an older ball.",
  }),
  "technical.spin": Object.freeze({
    4:  "Rolls the ball out; no revolutions, no turn, no drift.",
    8:  "Turns it on a helpful surface only; loses the ball entirely when trying for more.",
    12: "Genuine revolutions; turns it on a good pitch and holds a length while doing so.",
    16: "Drift as well as turn; changes pace through the air without a change of action.",
    20: "Spins it hard enough to beat provincial batters on a flat pitch, in control throughout.",
  }),
  "technical.variations": Object.freeze({
    4:  "One ball, repeated; the change-up is obvious from the hand and from the run-up.",
    8:  "Has a second delivery but telegraphs it; uses it at the wrong moments.",
    12: "Slower ball or wrong'un disguised well enough to be useful; used with a plan.",
    16: "Two or more variations, hidden, and chosen for the batter rather than the over.",
    20: "Provincial-standard disguise; a variation that takes wickets rather than saving runs.",
  }),

  // ── TECHNICAL: in the field, and behind the stumps ──
  "technical.catching": Object.freeze({
    4:  "Drops the straightforward chance; hands hard, watches the ball onto the ground.",
    8:  "Takes the catch that comes to him; goes to ground reluctantly.",
    12: "Reliable in the ring and in the deep; takes the low one moving forward.",
    16: "Takes the difficult chance more often than not; safe under a swirling ball.",
    20: "Catches at provincial slip or in the deep with the game on it.",
  }),
  "technical.groundFielding": Object.freeze({
    4:  "Lets the ball through; fumbles the routine pick-up.",
    8:  "Stops what comes at him; slow to the ball moving sideways.",
    12: "Attacks the ball; clean pick-up and release; saves singles consistently.",
    16: "Turns twos into ones; runs out from the ring; dives to stop rather than to look busy.",
    20: "Saves runs at provincial standard, on either hand, at full speed.",
  }),
  "technical.throwing": Object.freeze({
    4:  "Cannot reach the keeper from the ring on the full.",
    8:  "Reaches the stumps but slowly and off target.",
    12: "Flat, accurate throw from the ring; hits one set of stumps in three.",
    16: "Throws down the stumps from the ring under pressure; reaches from the boundary on one bounce.",
    20: "Provincial-standard arm: accurate from the deep, released quickly, either hand up.",
  }),
  "technical.glovework": Object.freeze({
    4:  "Not a keeper; concedes byes standing back to medium pace.",
    8:  "Safe standing back to seam; uncomfortable standing up.",
    12: "Stands up to the spinners; clean take, tidy stumping, few byes.",
    16: "Takes the ball moving away standing up; effects stumpings off good spin.",
    20: "Keeps to provincial seam and spin on a poor surface without conceding cheap byes.",
  }),

  // ── MENTAL ──
  "mental.concentration": Object.freeze({
    4:  "Loses focus within an over; gets out or bowls badly straight after a good passage.",
    8:  "Concentrates in bursts; the loose ball or loose shot arrives predictably after a boundary.",
    12: "Bats or bowls long spells without a lapse; refocuses between deliveries.",
    16: "Sustains focus through a session; the mistake after a milestone does not come.",
    20: "Concentrates at provincial intensity for a full day's play or a full spell, every time.",
  }),
  "mental.composure": Object.freeze({
    4:  "Visibly rattled by a dropped catch, a sledge or a bad decision; performance collapses.",
    8:  "Recovers from a setback within an over or two, with help.",
    12: "Keeps method under pressure; the plan does not change because the score did.",
    16: "Better in a tight game than a loose one; trusted with the last over.",
    20: "Composure holds at provincial level with a result on the line and a crowd on it.",
  }),
  "mental.decisions": Object.freeze({
    4:  "Shot or delivery chosen without reference to the situation.",
    8:  "Makes the obvious right choice; caught out by anything unusual.",
    12: "Reads the situation and plays it; knows when to hold and when to go.",
    16: "Makes the unobvious right choice, and can explain it afterwards.",
    20: "Decision-making stands up at provincial level against opponents actively setting him up.",
  }),
  "mental.anticipation": Object.freeze({
    4:  "Reacts after the event; caught flat-footed in the field.",
    8:  "Reads the straightforward cue: the drive, the obvious single.",
    12: "Moves before the ball is hit; backs up without being told.",
    16: "Reads the batter's or bowler's intention early and is in position for it.",
    20: "Anticipates at provincial tempo, in the field and at the crease.",
  }),
  "mental.determination": Object.freeze({
    4:  "Gives up when the game turns; body language goes first.",
    8:  "Keeps going when it is close; fades once it is not.",
    12: "Works at a weakness without being chased; competes in a losing side.",
    16: "Drives standards in others; the innings or spell that turns a game comes from here.",
    20: "The competitiveness a provincial selector picks on top of the skill.",
  }),
  "mental.bravery": Object.freeze({
    4:  "Avoids the short ball and the close catching position.",
    8:  "Fields where he is put; visibly unhappy at short leg or against genuine pace.",
    12: "Takes on the short ball; fields close without flinching.",
    16: "Volunteers for the hard job; puts his body in the way of the ball.",
    20: "Physical courage at provincial pace, in the field and at the crease, sustained.",
  }),
  "mental.leadership": Object.freeze({
    4:  "Takes no responsibility; contributes nothing to the group when not batting or bowling.",
    8:  "Leads by example when going well; quiet when not.",
    12: "Sets a field, talks to a bowler, supports a younger player without being asked.",
    16: "Changes how the side plays; others look to him when it is going badly.",
    20: "Would captain a provincial age-group side on merit.",
  }),
  "mental.teamwork": Object.freeze({
    4:  "Plays for himself; visible frustration at team-mates' mistakes.",
    8:  "Does his job; contributes little beyond it.",
    12: "Supports the man at the other end; celebrates others' wickets and runs.",
    16: "Makes the players around him better; absorbs a setback so somebody else does not have to.",
    20: "The player a provincial coach builds a dressing room around.",
  }),
  "mental.workRate": Object.freeze({
    4:  "Coasts in the field; first to complain about a long session.",
    8:  "Works when watched.",
    12: "Chases everything; first to nets and does the unglamorous work.",
    16: "Sets the standard others follow; extra work is habitual rather than instructed.",
    20: "The training and playing intensity a provincial programme expects, unprompted.",
  }),
  "mental.gameAwareness": Object.freeze({
    4:  "Does not know the target, the over rate or who is bowling next.",
    8:  "Knows the score; does not adjust to it.",
    12: "Plays the situation: rotates in a chase, blocks out an over, protects a partner.",
    16: "Reads a game two or three overs ahead and positions himself for it.",
    20: "Understands a provincial match as a whole, including conditions, and plays accordingly.",
  }),

  // ── PHYSICAL ──
  "physical.pace": Object.freeze({
    4:  "Slowest in the side; turns twos into ones for the fielding team.",
    8:  "Adequate between the wickets; caught in the field on anything wide.",
    12: "Quick enough to run three; cuts off the boundary at a good speed.",
    16: "Among the fastest in the school; runs a two others would not attempt.",
    20: "Provincial-standard running speed, sustained through an innings.",
  }),
  "physical.acceleration": Object.freeze({
    4:  "Slow off the mark; beaten to every ball in the ring.",
    8:  "Gets going eventually; loses the first two strides.",
    12: "Sharp over the first five metres; turns quickly for the second run.",
    16: "Explosive off the mark in the field and out of the blocks between wickets.",
    20: "First-step speed at provincial fielding standard.",
  }),
  "physical.agility": Object.freeze({
    4:  "Stiff; cannot change direction or get low without losing balance.",
    8:  "Moves adequately in one plane; awkward diving or turning.",
    12: "Gets down and up quickly; dives and recovers to throw.",
    16: "Moves like an athlete in any direction; takes catches others cannot reach.",
    20: "Provincial-standard athleticism in the field or behind the stumps.",
  }),
  "physical.balance": Object.freeze({
    4:  "Falls away at the crease or in delivery; head moves through the action.",
    8:  "Balanced when set; loses shape when hurried or when reaching.",
    12: "Still head; balanced at the point of contact and at release.",
    16: "Holds shape playing late, moving, or bowling into the wind.",
    20: "Balance holds at provincial pace and tempo, under fatigue.",
  }),
  "physical.stamina": Object.freeze({
    4:  "Fades within three overs of a spell or twenty minutes at the crease.",
    8:  "Manages a short spell; second spell noticeably worse than the first.",
    12: "Bowls a full allocation or bats a long innings without losing quality.",
    16: "Third and fourth spells as good as the first; still moving at the end of a day.",
    20: "Endurance for a provincial workload across consecutive days.",
  }),
  "physical.strength": Object.freeze({
    4:  "Physically overmatched; bat turns in the hands, throws fall short.",
    8:  "Strong enough for the age group; struggles against older opposition.",
    12: "Strong through the hitting zone and in the field for the age group.",
    16: "Physically dominant among his peers without loss of technique.",
    20: "Provincial-standard strength for the role, appropriate to age and maturation.",
  }),
  "physical.naturalFitness": Object.freeze({
    4:  "Frequently unavailable; recovers slowly from minor knocks.",
    8:  "Available most weeks; carries niggles through a season.",
    12: "Robust; trains and plays a full programme without breaking down.",
    16: "Recovers quickly between matches; rarely misses through soft-tissue injury.",
    20: "The durability a provincial programme's match and training load requires.",
  }),
  "physical.bowlingPace": Object.freeze({
    4:  "Not quick enough to trouble anyone; the batter has time to reset.",
    8:  "Military medium; hurries nobody at this level.",
    12: "Quick enough to be respected in the age group; makes the batter hurry.",
    16: "Among the quickest in the school; the short ball is a genuine option.",
    20: "Provincial age-group pace, repeatable across a spell rather than in one ball.",
  }),
});

/** Every attribute with a draft, as "group.attribute". */
export const DRAFTED = Object.freeze(Object.keys(DRAFT_ANCHORS));
