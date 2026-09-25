import { useState, useEffect, useRef, useMemo } from "react";
import { flushSync } from "react-dom";
import {
  deriveInnings, inningsStart, batters as battersEvent, bowler as bowlerEvent,
  ball as ballEvent, penalty as penaltyEvent, revision as revisionEvent, retire as retireEvent, sealInnings,
  newEventId, KIND, battingFirst, tossFromRow, firstInningsSides, fromRow,
  noPlacement, NO_CONTACT_SHOTS, PLACEMENT_NULL, PLACEMENT_SOURCE, CAPTURE_PROFILE,
  DISMISSAL, DISMISSAL_LABEL, RETIRE_REASON, BOWLER_CHANGE_REASON, isMidOver, scoringReadiness, SCORING_BLOCK, lawsRefusal, REFUSAL_TEXT, LOCAL_ONLY,
} from "@scrbrd/scoring";
import { D, T, clr } from "../design/tokens.js";
import { deviceId } from "../lib/device.js";
import { loadMatch, saveMatch, saveAside, storageKind } from "../lib/persist.js";
import { api, signedIn } from "../lib/api.js";
import { profile } from "../lib/session.js";
import { PadSync } from "../lib/sync.js";
import { refusalWords } from "../lib/handover.js";
import { withoutEvents, recordAgain, recordAgainRefusal, heldInOrder, undoOnPad, reconcile, padLogFrom, inningsInPlay, withOrphans } from "@scrbrd/sync";
import { HeldSheet } from "./held.jsx";
import { PadMenu } from "./padMenu.jsx";
import { SyncBanner } from "./syncBanner.jsx";
import { TossSheet } from "./toss.jsx";
import { SEGS } from "./field.js";
import { fmtOv } from "./format.js";
import { ALL_SHOTS } from "./shots.js";
import { AnalysisDashboard, ManhattanChart } from "./charts.jsx";
import { DynamicBar, EventOverlay, FreeHitBanner, InningsOverBanner, PartnershipCard, ScorecardPanel, buildEventCfg, detectMilestone } from "./panels.jsx";
import { FocusPad, ScoringBlocked, ScoringPanel } from "./scoring.jsx";
import { SetupScreen } from "./setup.jsx";
import { BattingOrderSheet, HandoverSheet, Innings2Sheet, InningsReviewSheet, NewOverSheet, NoBallSheet, PenaltySheet, RevisionSheet, ShotSelectorSheet, WicketSheet } from "./sheets.jsx";
import { INT_TEAMS } from "./teams.js";
import { BallDot, Btn, CaptureProfilePicker, Card, GS, Glass, Lbl } from "./ui.jsx";

// Reconstruct an event log from a seeded innings object.
//
// The demo seeder (seed.js) still builds innings objects directly — it is the
// stand-in for the production replay and is meant to be deleted when the real
// event stream lands. Until then, resuming a seeded match converts its ball
// log back into events so the live scorer runs on one representation only.
// Batter and bowler changes are inferred from each ball's stamped striker and
// bowler, which is exactly the information a delivery record carries.
function eventsFromInnings(i){
  if(!i) return [];
  const ctx={ flagFor: k => INT_TEAMS[k]?.flag };
  const evs=[inningsStart({battingTeam:i.battingTeam,bowlingTeam:i.bowlingTeam,
    squad:i.squad,bowlingSquad:i.bowlingSquad,twelfthMan:i.twelfthMan,
    teamKey:i.teamKey,bowlingTeamKey:i.bowlingTeamKey,overs:i.overs??20})];

  // The openers are the first two batters the seeded innings recorded. Both
  // ends must be named: the scorer refuses to accept a delivery unless it
  // knows the striker AND the non-striker, so losing one here makes the first
  // tap open the batting-order sheet instead of scoring.
  const openers=(i.batsmen||[]).slice(0,2).map(b=>b.id).filter(Boolean);
  if(openers.length===2) evs.push(battersEvent({striker:openers[0],nonStriker:openers[1]}));

  for(const b of (i.ballLog||[])){
    // Ask the replay who is on strike rather than tracking it here — strike
    // rotation is its rule, and a second copy of that rule is exactly the
    // duplication this whole refactor removed. The repeated fold is O(n²) over
    // one innings, which is nothing for ~120 deliveries and runs once, on resume.
    const st=deriveInnings(evs, ctx);
    const s=b.strikerId??b.striker??null, bw=b.bowlerId??b.bowler??null;
    // A striker who is neither of the current pair is a new arrival.
    if(s&&s!==st.striker&&s!==st.nonStriker) evs.push(battersEvent({striker:s}));
    // Replay clears the bowler at the end of each over, so this re-announces
    // them exactly when a real over change would.
    if(bw&&bw!==st.bowler) evs.push(bowlerEvent({bowler:bw}));
    // The crease this ball was bowled to, stamped like any delivery the pad
    // records (crease() in the engine), after the arrivals above.
    const at=deriveInnings(evs, ctx);
    evs.push(ballEvent({type:b.type,value:b.value,shot:b.shot,seg:b.seg,zone:b.zone,
      bowlerApproach:b.bowlerApproach,dismissal:b.dismissal,fielder:b.fielder,
      striker:at.striker??null,nonStriker:at.nonStriker??null,bowler:at.bowler??null}));
  }
  return evs;
}

/**
 * The squad for a fixture, from the server.
 *
 * Returns null rather than throwing when there is no server or no team sheet:
 * a scorer with a fixture and no roster still has to be able to score, naming
 * players as they come in. Refusing to open the pad because a lookup failed
 * would strand them at the moment play starts.
 */
async function liveSquad(cfg) {
  if (!cfg?.matchId || !signedIn()) return null;
  try {
    const { rows } = await api("/api/read/players");
    const team = rows.filter((p) => !cfg.teamCode || p.team_code === cfg.teamCode);
    // batHand travels with the squad because placement is stored
    // batter-relative: without it every left-hander's innings is mirrored.
    return (team.length ? team : rows).map((p) => ({
      id: p.id, name: p.full_name,
      batHand: /^l/i.test(p.batting_style || "") ? "L" : "R",
    }));
  } catch {
    return null;
  }
}

/**
 * The toss for a fixture, as the server recorded it. SCRBRD-067.
 *
 * Read through the fixture list the Match Centre already reads —
 * GET /api/read/matches, under fixture.read, whose rows carry toss_won_by,
 * toss_decision and the server's own bats_first (read-api.mjs) — rather than
 * a new endpoint: the scorer holds fixture.read over any match it may score,
 * and a second read of the same row would be a second policy to keep in step.
 *
 * Null when there is no toss, no server, or the read failed. Null is not
 * "the home side": the pad then asks (TossSheet), because the innings it
 * opens cannot be undone.
 */
async function liveToss(cfg) {
  if (!cfg?.matchId || !signedIn()) return null;
  try {
    const { rows } = await api("/api/read/matches");
    return tossFromRow(rows.find((r) => r.id === cfg.matchId));
  } catch {
    return null;
  }
}

/**
 * The server's log for a fixture, as events — or null when there is no
 * session or no answer. SCRBRD-075.
 *
 * A device opening a live fixture it has nothing saved for used to write a
 * first-innings innings_start of its own, under a new id — the incoming side
 * of a handover included, whose outbox then sent it after the takeover: the
 * server's log gained a second start, and the pad's board read 0/0 with
 * nobody in while the server's was the outgoing scorer's innings. If the
 * server has a log, it is THE log, and the pad replays it; only a fixture the
 * server has nothing for is started here. (With no signal the pad cannot ask,
 * so it starts one — and the comparison before its first claim finds out,
 * packages/sync attach.mjs, before anything is sent.)
 */
async function liveLog(cfg) {
  if (!cfg?.matchId || !signedIn()) return null;
  try {
    const r = await api(`/api/matches/${cfg.matchId}/events`);
    return (r?.events ?? []).map(fromRow);
  } catch {
    return null;
  }
}

/*
 * The toss the scorer answers on the pad (SCRBRD-067) is recorded, not only
 * used: the server derives the innings order and the result from it, and a
 * second device opening this fixture reads it instead of asking again. It
 * used to be POSTed once, best effort, the moment it was answered, and with
 * no signal it was simply lost (SCRBRD-075). It is now queued in the outbox,
 * on disk, and is the first thing the outbox sends — before the innings_start,
 * since the server freezes the toss once the match has any event — and it is
 * compared with whatever toss the server already has before it is written
 * (lib/sync.js settleToss, packages/sync tossDecision).
 */

/**
 * Has this over left the phone yet?
 *
 * The single most useful thing a scorer can know, and the artifact showed none
 * of it. It matters most at the two moments where being wrong is expensive:
 * before handing the phone to someone else (a handover with unsynced balls is
 * refused, and the scorer should understand why), and at the end of a match on
 * a ground with no signal, where walking away is how an innings is lost.
 *
 * "Saved" and "sent" are deliberately different words. Saved means the log is
 * on this device and a reload will not lose it. Sent means the rest of the
 * school can see it. A scorer offline all afternoon is fully saved and not at
 * all sent, and telling them "saved" alone would be true and misleading.
 */
function SyncPill({ sync, storage, onOpenHeld }) {
  const S = {
    synced:  { dot: D.emerald, label: "Sent",   title: "Every ball is on the server" },
    // The server refused these, or already holds a different event under the
    // same id (db/36). It wrote nothing, so they are on this device only and
    // will not be resent; a person has to look. Named, not folded into
    // "Sent": a refused ball the board still shows is exactly the
    // disagreement a scorer must be told about.
    held:    { dot: D.rose, label: `Refused ${sync.held}`,
               title: `The server did not accept ${sync.held === 1 ? "one event" : `${sync.held} events`}${sync.heldReason ? ` — ${REFUSAL_TEXT[sync.heldReason] ?? sync.heldReason}` : ""}. They are kept on this device.` },
    // The server took these into quarantine, not into its log: sent under a
    // token this device no longer held. They used to leave the queue and the
    // pill said "Sent" — true of the request, false of the scorebook.
    quarantined: { dot: D.rose, label: `For review ${sync.rejected}`,
               title: `The server held ${sync.rejected === 1 ? "one event" : `${sync.rejected} events`} for a supervisor to review. They are not in the scorebook.` },
    syncing: { dot: D.amber, label: `Sending ${sync.pending}`, title: "Balls still on their way" },
    waiting: { dot: D.amber, label: `Held ${sync.pending}`, title: "No connection — balls are saved and will send when there is one" },
    local:   sync.reason === "handed_over"
      ? { dot: D.sky, label: "Handed over", title: "You gave the scoring token to someone else" }
      : sync.reason === "handover_pending" || sync.reason === "verifying"
      ? { dot: D.amber, label: "Handover pending", title: "Someone has armed a handover — use ⇄ Take over to claim it" }
      // db/33 (SCRBRD-034): the result is declared and the database refuses
      // every claim. Not "On device (match_complete)": the scorer should
      // know retrying will not help and where a correction goes instead.
      : sync.reason === "match_complete"
      ? { dot: D.sky, label: "Match complete", title: refusalWords("match_complete") }
      : { dot: D.textMuted, label: "On device", title: `Saved here only (${sync.reason ?? "no server"})` },
    offline: { dot: D.textMuted, label: "On device", title: "Saved here only" },
  }[sync.state] ?? { dot: D.textMuted, label: "On device", title: "Saved here only" };

  const pillStyle = {display:"flex",alignItems:"center",gap:"6px",background:D.surf1,
    border:`1px solid ${D.border}`,borderRadius:D.pill,padding:"4px 11px",flexShrink:0};
  const inner = (
    <>
      <div style={{width:"6px",height:"6px",borderRadius:"50%",background:S.dot}}/>
      <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textSecondary}}>{S.label}</span>
    </>
  );
  // Held events wait on a person, so the pill that names them is also the
  // way to them (SCRBRD-070): a count with nothing behind it was the gap.
  if (sync.state === "held" && onOpenHeld) return (
    <button type="button" onClick={onOpenHeld} className="pressBtn" data-testid="held-open"
      title={`${S.title} Tap to see them.`}
      aria-label={`Sync status: ${S.label}. ${S.title} Open the list.`}
      style={{...pillStyle,cursor:"pointer",border:`1px solid ${D.rose}55`}}>
      {inner}
    </button>
  );
  return (
    <div title={`${S.title}${storage ? ` · ${storage}` : ""}`}
      aria-label={`Sync status: ${S.label}. ${S.title}`}
      style={pillStyle}>
      {inner}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════ */
// `onSignIn` is the shell's way to its sign-in page and back to this pad
// (App.jsx): a live pad that is signed out says so and offers it (SCRBRD-078).
function SCRBRD({resume,onSignIn}={}){
  const[screen,setScreen]=useState("setup");
  const[match,setMatch]=useState(null);
  // ── The event log is the state ──────────────────────────
  // One log per innings. Everything the UI renders — score, scorecard, wagon
  // wheel, worm, partnerships, fall of wickets — is a fold over these, so
  // there is no second copy of the score to drift out of step with them.
  const[events,setEvents]=useState([[],[]]);
  const[curIn,setCurIn]=useState(0);
  const[modal,setModal]=useState(null);
  const[modalCtx,setModalCtx]=useState({});
  const[activeTab,setActiveTab]=useState("score");
  const[selSeg,setSelSeg]=useState(null);
  // Hub state — replaces modal-based shot/field flow
  const[hubStage,setHubStage]=useState(0);
  const[hubShot,setHubShot]=useState(null);
  const[hubApproach,setHubApproach]=useState(null);
  const[selShot,setSelShot]=useState(null);
  const[scoringCtx,setScoringCtx]=useState(null);
  // Overlay: config object {label,sub,color,...} | null
  const[eventOverlay,setEventOverlay]=useState(null);
  // Milestone queue — show one at a time
  const milestoneQRef=useRef([]);
  const[lastOverDCB,setLastOverDCB]=useState(null);
  // Free hit: true after a height/front-foot no-ball
  const[freeHit,setFreeHit]=useState(false);
  // Undo truncates the event log; there is no snapshot stack to keep.
  // Drag-to-reorder cards
  const[cardOrder,setCardOrder]=useState(["scoring","partnership","commentary"]);
  const cardDragRef=useRef(null);
  const[fieldView,setFieldView]=useState("wagon");
  const[hidden,setHidden]=useState(new Set());
  const scoreKeyRef=useRef(0);
  const [uiMode,setUiMode]=useState("focus"); // focus = one-tap pad · pro = full shot capture
  const [focusQuick,setFocusQuick]=useState(false); // one-tap speed mode inside focus scoring
  // ── Identity of this device, and what the server has seen ──
  // Both are refs rather than state: they are read while appending an event
  // and must never trigger a re-render of the scoring pad mid-tap.
  const deviceIdRef = useRef(deviceId());
  const matchIdRef = useRef(null);
  // A pad with a server behind it: a real fixture, opened from the Match
  // Centre or restored after a reload (App.jsx puts `live` on its cfg). The
  // demo's seeded fixtures and a match started on the setup screen have
  // none, and nothing of theirs is ever queued.
  const live = resume?.cfg?.live === true && !!resume?.cfg?.matchId;
  // Who opened it: a person, from the Match Centre ("open"), or the session
  // restore after a reload ("restore"), which never takes a match another
  // device has claimed since this one held it (packages/sync attach.mjs).
  const intent = resume?.cfg?.restored ? "restore" : "open";
  // This pad's connection to the server (lib/sync.js PadSync): the outbox,
  // open from the moment the pad is — UNATTACHED until this device holds the
  // token (SCRBRD-078) — and everything the pad needs to say about it. Undo
  // asks its engine what has left the device (undoOnPad); there is no second
  // copy of that answer here.
  const syncRef = useRef(null);
  // Undo withdrawals not yet on disk (SCRBRD-074), each resolving true once
  // its event is out of the stored outbox, or false when it could not be
  // taken out and is being put back in the log. A save of the log waits for
  // every one of them (the persist effect below).
  const withdrawalsRef = useRef(new Set());
  // What PadSync last said (its status()): the pill and the banner read it.
  const [padStatus, setPadStatus] = useState(null);
  // Bumped once the outbox is open, so the log-watching effect offers it
  // the log it already has.
  const [outboxReady, setOutboxReady] = useState(0);
  // Bumped when a finished match's outbox is cleared (SCRBRD-079), so the
  // log is saved again with what the server had.
  const [outboxCleared, setOutboxCleared] = useState(0);
  // The pad's log as it stands, for code that runs outside a render: the
  // comparison before a claim reads it (attach.mjs), and it must see what
  // hydration loaded, not the empty log of the first render.
  const eventsRef = useRef([[], []]);
  // Ids this pad minted since it opened. While no token is held an event
  // may be cut by undo only if it is one of these: nothing is sent while
  // unattached, so they have certainly never left the device — while an
  // event from an earlier session may have (SCRBRD-079: queued before the
  // markers existed), and gets a void.
  const mintedRef = useRef(new Set());
  // Ids the server is known to have that the outbox need never be offered:
  // a log taken from the server (SCRBRD-075), and the part of a finished
  // match's log saved as sent when its outbox was cleared (SCRBRD-079).
  const serverKnownRef = useRef(new Set());
  // The first of those, taken at hydration before the outbox was open: marked
  // sent on disk once it is, so no later session queues them either. (A
  // cleared match's are not: marking them would put back the storage the
  // clear just removed.)
  const adoptedRef = useRef([]);
  // How many events of each innings were on the server when the outbox was
  // cleared (SCRBRD-079), saved with the log so a reload does not queue a
  // finished match again.
  const serverHasRef = useRef(null);
  // A toss answered before the outbox opened; queued as soon as it does.
  const pendingTossRef = useRef(null);
  // Resolves when hydration has put the saved (or server's) log on the pad;
  // nothing is compared or offered before.
  const hydration = useRef(null);
  if (!hydration.current) { let done; hydration.current = { promise: new Promise((r) => { done = r; }), done: () => done() }; }
  // A live fixture's first innings (SCRBRD-067): the home side's roster as
  // the server gave it, and the toss — read at hydration, or answered on the
  // pad. Refs, like the two above: read when the innings opens, never drawn.
  const homeSquadRef = useRef(null);
  const tossRef = useRef(null);


  // ── Derivation ──────────────────────────────────────────
  const scoringCtxRef = useRef({ flagFor: k => INT_TEAMS[k]?.flag });
  const innings = useMemo(
    () => events.map(evs => (evs.length ? deriveInnings(evs, scoringCtxRef.current) : null)),
    [events],
  );
  eventsRef.current = events;

  // What the pill says, from what PadSync last said. `local` is a pad that
  // holds no token — with no signal, signed out, refused, or handed over;
  // the banner says which, in words (SyncBanner).
  const sync = useMemo(() => {
    const st = padStatus;
    if (!st) return { state: "offline", pending: 0, held: 0, heldList: [], reason: null };
    const base = { pending: st.pending, held: st.held, heldReason: st.heldReason, heldList: st.heldList,
                   rejected: st.rejected, reason: st.reason };
    return { ...base,
      state: st.held ? "held"
        : st.rejected ? "quarantined"
        : !st.attached ? "local"
        : st.pending === 0 && !st.tossPending ? "synced"
        // The last send got no answer: waiting, whatever navigator.onLine
        // says (it is true on a signal that reaches nothing).
        : st.online && st.reason !== "unreachable" ? "syncing" : "waiting" };
  }, [padStatus]);
  const attached = !!padStatus?.attached;
  // Locked while a handover is waiting on this device (SCORING_HANDOVER_SPEC
  // §4 step 2): the way in is the code, and the log is the one it brings.
  const padLock = live && !attached && (padStatus?.reason === "handover_pending" || padStatus?.reason === "verifying");
  const padLockRef = useRef(false);
  padLockRef.current = padLock;

  /**
   * Everything in the log that the outbox does not already answer for goes
   * to it. One path, watching the log, rather than a call inside emit().
   *
   * emit() is not the only writer: the innings and its squad are written
   * during hydration, and a log is taken from the server at a handover. The
   * outbox opens with the pad, unattached (SCRBRD-078), so an event recorded
   * with no signal and no session is on disk in the queue at once, and goes
   * out when the device next holds the token. What the outbox already
   * answers for — queued, held, or put in a request in some session — and
   * what the server is known to have is never offered again.
   *
   * Nothing here is awaited. The queue writes to disk before it considers a
   * ball recorded and sends when there is a connection; the board moves on the
   * tap either way. A throw would be a scoring surface that stopped working
   * because the network did.
   */
  const offeredRef = useRef(new Set());
  useEffect(() => {
    const outbox = syncRef.current?.engine;
    if (!outbox || !hydratedRef.current) return;
    for (const ev of events.flat()) {
      if (!ev?.id || offeredRef.current.has(ev.id)) continue;
      offeredRef.current.add(ev.id);
      if (serverKnownRef.current.has(ev.id) || outbox.isKnown(ev.id)) continue;
      outbox.record(ev).catch(() => {});
    }
  }, [events, outboxReady]);

  /**
   * Append to the current innings' log. This is the only way state changes.
   *
   * Every event is stamped with an id here, and this is the only place that
   * happens. The id is the event's identity everywhere afterwards: the server
   * dedupes retries on it, and a `void` names its target with it. An event
   * without one cannot be undone once it has left the device, so minting it at
   * the single point of append is what keeps that from being possible.
   *
   * A pad waiting on a handover records nothing (SCORING_HANDOVER_SPEC §4
   * step 2: scoring stays locked until the takeover): what it would record is
   * a second log over the one it is about to be handed.
   */
  const emit = (...evs) => {
    if (padLockRef.current) return;
    setEvents(prev => {
      const cp = [...prev];
      const stamped = evs.map(e => ({
        ...e,
        innings: curIn,
        id: e.id ?? newEventId(deviceIdRef.current, matchIdRef.current ?? "local"),
      }));
      for (const e of stamped) mintedRef.current.add(e.id);
      cp[curIn] = [...cp[curIn], ...stamped];
      return cp;
    });
  };

  /** What the innings WOULD be with these extra events — used to decide what
   *  happens next (over ended? innings ended?) without duplicating the rules. */
  const project = (...evs) => deriveInnings([...events[curIn], ...evs], scoringCtxRef.current);

  const inn=innings[curIn];

  // ── Durability ──────────────────────────────────────────
  // A phone locks, a battery dies, a browser reloads the tab. On a ground with
  // no signal there is nowhere else the match exists, so the log goes to disk
  // on every change and is rehydrated on return.
  const [matchId, setMatchId] = useState(null);
  const [saveState, setSaveState] = useState({ kind: null, restored: false, savedAt: null });
  const hydratedRef = useRef(false);

  // Resume a live match handed over from the Match Centre. A log already saved
  // on this device WINS over the seeded reconstruction: it is what this scorer
  // actually recorded, and the seed is only a stand-in for a match nobody here
  // has scored yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!resume?.cfg) { hydratedRef.current = true; hydration.current.done(); return; }
      const id = resume.cfg.matchId ?? null;
      setMatch(resume.cfg);
      setMatchId(id);
      matchIdRef.current = id;

      const saved = id ? await loadMatch(id) : null;
      if (cancelled) return;
      if (saved?.events?.some(e => e.length)) {
        // A finished match whose outbox was cleared (SCRBRD-079): what was on
        // the server then is known to be there, and is never queued again.
        if (Array.isArray(saved.serverHas)) {
          serverHasRef.current = saved.serverHas;
          saved.events.forEach((evs, i) => (evs ?? []).slice(0, saved.serverHas[i] ?? 0)
            .forEach(e => e?.id && serverKnownRef.current.add(e.id)));
        }
        eventsRef.current = saved.events;
        setEvents(saved.events);
        setCurIn(saved.curIn ?? 0);
        setSaveState({ kind: await storageKind(), restored: true, savedAt: saved.savedAt ?? null });
      } else if (resume.events || resume.innings) {
        setEvents((resume.events ?? (resume.innings || []).map(i => (i ? eventsFromInnings(i) : []))));
        setCurIn(resume.curIn || 0);
        setSaveState({ kind: await storageKind(), restored: false, savedAt: null });
      } else {
        // A real fixture with nothing saved on this device. If the server
        // has a log, it is THE log (SCRBRD-075): the pad replays it and never
        // starts one of its own — a first visit, and the incoming side of a
        // handover, which the protocol hands the log to (spec §4 step 2).
        const server = live ? await liveLog(resume.cfg) : null;
        if (cancelled) return;
        if (server?.length) {
          for (const e of server) if (e?.id) { serverKnownRef.current.add(e.id); adoptedRef.current.push(e.id); }
          const log = padLogFrom(server);
          eventsRef.current = log;
          setEvents(log);
          setCurIn(inningsInPlay(log));
          setSaveState({ kind: await storageKind(), restored: false, savedAt: null });
        } else {
          // A fixture nobody has scored yet (or none this pad can ask about,
          // with no signal). The squad comes from the server, and goes into
          // the log rather than beside it: innings_start carries the players,
          // so the scorecard replays correctly later on a device that never
          // loaded a roster.
          //
          // Which side bats is the recorded toss's answer (SCRBRD-067), never
          // the order the fixture lists its sides in: innings_start is the one
          // event undo will not walk past. No toss — none recorded, or no way
          // to ask — and nothing opens: the scorer is asked first (TossSheet).
          const [squad, toss] = await Promise.all([liveSquad(resume.cfg), liveToss(resume.cfg)]);
          if (cancelled) return;
          homeSquadRef.current = squad;
          tossRef.current = toss;
          const openId = newEventId(deviceIdRef.current, id ?? "local");
          const log = [toss ? [inningsStart({
            ...firstInningsSides({ batsFirst: toss.batsFirst, fixture: resume.cfg, homeSquad: squad }),
            overs: resume.cfg.overs ?? 20,
            // A fixture that carries a declaration passes it on; none does yet,
            // so this innings opens undeclared — exactly as before — and the
            // scorer declares it on the opener sheet before the first ball.
            captureProfile: resume.cfg.captureProfile ?? undefined,
            id: openId,
          })] : [], []];
          if (toss) mintedRef.current.add(openId);
          eventsRef.current = log;
          setEvents(log);
          setCurIn(0);
          if (!toss) setModal("toss");
          setSaveState({ kind: await storageKind(), restored: false, savedAt: null });
        }
      }
      setScreen("match");
      hydratedRef.current = true;
      hydration.current.done();
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * The pad's log replaced by the server's (attach.mjs "behind"; a handover
   * claim). Applied at once and only if nothing was recorded on the pad since
   * the two were compared — a tap in between makes it two logs, which is not
   * this function's to settle — and marked known, so it is never queued.
   * @returns {boolean} whether it was taken
   */
  const adoptLog = (log, compared) => {
    const ids = new Set(compared.flatMap((evs) => (evs ?? []).map((e) => e?.id)));
    let took = false;
    flushSync(() => setEvents((prev) => {
      if (prev.some((evs) => (evs ?? []).some((e) => e?.id && !ids.has(e.id)))) return prev;
      took = true;
      return log;
    }));
    if (!took) return false;
    for (const evs of log) for (const e of evs ?? []) if (e?.id) serverKnownRef.current.add(e.id);
    eventsRef.current = log;
    setCurIn(inningsInPlay(log));
    return true;
  };

  // ── The outbox ──────────────────────────────────────────
  // Opened with the pad for a live match, UNATTACHED (SCRBRD-078): what is
  // recorded is queued on disk at once, whether or not there is a signal, a
  // session or a token. Then it attaches — the comparison with the server's
  // log, the claim, the flush — and keeps trying for as long as the reason
  // is the network. Every outcome except success is survivable: no signal,
  // signed out, or a colleague already holding the token all leave the scorer
  // working locally, which is the whole point of the offline design, and the
  // banner says which. Refusing to open the pad because sync is unavailable
  // would be exactly the wrong failure.
  useEffect(() => {
    if (!matchId || !live) return;
    let stopped = false;
    const ps = new PadSync({
      matchId, userId: profile()?.user?.id, intent,
      hooks: {
        padLog: () => eventsRef.current,
        adopt: (log) => adoptLog(log, eventsRef.current),
        restore: (orphans) => {
          // Events the queue has and the saved log lost (the tab died between
          // the two writes): put back where the scorer recorded them, so the
          // pad shows every ball the server is about to be sent.
          for (const o of orphans) offeredRef.current.add(o.idempotencyKey);
          flushSync(() => setEvents((prev) => {
            const onPad = new Set(prev.flatMap((evs) => (evs ?? []).map((e) => e?.id)));
            const next = withOrphans(prev, orphans.filter((o) => !onPad.has(o.idempotencyKey)));
            eventsRef.current = next;
            return next;
          }));
        },
        followToss: (server) => followServerToss(server),
        onStatus: (st) => { if (!stopped) setPadStatus(st); },
      },
    });
    syncRef.current = ps;
    (async () => {
      const engine = await ps.open();
      if (stopped || !engine) return;
      if (pendingTossRef.current) { await engine.queueToss(pendingTossRef.current); pendingTossRef.current = null; }
      await hydration.current.promise;
      if (stopped) return;
      if (adoptedRef.current.length) { await engine.markSent(adoptedRef.current); adoptedRef.current = []; }
      setOutboxReady((n) => n + 1);
      ps.attach();
    })();
    return () => {
      stopped = true;
      ps.stop();
      if (syncRef.current === ps) syncRef.current = null;
    };
    // `live` and `intent` come from `resume`, which is fixed for the life of
    // the pad (App.jsx keys it by match); listed so the rule has nothing to say.
  }, [matchId, live, intent]);

  // Persist on every change to the log. Skipped until hydration has finished,
  // or the empty initial state would overwrite the very log being restored.
  useEffect(() => {
    if (!hydratedRef.current || !matchId) return;
    if (!events.some(e => e.length)) return;
    let cancelled = false;
    // An undo that withdrew an unsent ball from the outbox is saved only once
    // the withdrawal is on disk (SCRBRD-074): a crash in between then leaves
    // the ball in the saved log and out of the outbox, which the next start
    // heals by re-offering the log — never the reverse, a ball sent that the
    // pad no longer shows. A log that depends on a failed withdrawal is not
    // saved at all: the ball is being put back, and that version saves.
    const gate = Promise.all([...withdrawalsRef.current]);
    (async () => {
      if (!(await gate).every(Boolean)) return;
      const ok = await saveMatch(matchId, { events, curIn, cfg: match,
        ...(serverHasRef.current ? { serverHas: serverHasRef.current } : {}) });
      if (!cancelled && ok) setSaveState(s => ({ ...s, savedAt: Date.now() }));
    })();
    return () => { cancelled = true; };
  }, [events, curIn, matchId, outboxCleared]);

  // ── A finished match's outbox goes (SCRBRD-079) ─────────
  // Once the match is over on the pad — the second innings closed — or the
  // server has declared it complete, and everything this device recorded is
  // the server's (attached, or found all there by the comparison), and the
  // queue holds nothing: no event waiting, none held for a person, no toss
  // unsent — the outbox's storage for this match is removed, sent markers and
  // all. The engine refuses the clear itself if anything is left. What was on
  // the server is saved with the log (serverHas), so reopening the finished
  // match queues none of it again; everything after it would be new.
  const matchOver = innings[1]?.sealed === true;
  useEffect(() => {
    const ps = syncRef.current, engine = ps?.engine, st = padStatus;
    if (!engine || !st || engine.cleared || !hydratedRef.current) return;
    const done = matchOver || st.reason === "match_complete";
    const onServer = st.attached
      || (st.reason === "match_complete" && !!st.reconcile && st.reconcile.state !== "fork" && st.reconcile.mine.length === 0);
    if (!done || !onServer || st.pending || st.held || st.tossPending || st.syncing) return;
    let cancelled = false;
    (async () => {
      if (!(await engine.clearOutbox()) || cancelled) return;
      serverHasRef.current = eventsRef.current.map((evs) => (evs ?? []).length);
      for (const evs of eventsRef.current) for (const e of evs ?? []) if (e?.id) serverKnownRef.current.add(e.id);
      setOutboxCleared((n) => n + 1);
    })();
    return () => { cancelled = true; };
  }, [padStatus, matchOver]);

  const startMatch=cfg=>{
    setMatch(cfg);
    const sq1=cfg.squad1||[], sq2=cfg.squad2||[];
    const tk1=cfg.teamKey1||cfg.team1, tk2=cfg.teamKey2||cfg.team2;
    const bsq1=INT_TEAMS[tk2]?.players.map(p=>p.name)||sq2;
    const bsq2=INT_TEAMS[tk1]?.players.map(p=>p.name)||sq1;

    // Opening an innings is an event, not an object. Both innings are opened
    // up front so the second already knows its squads when the chase begins.
    // The capture profile chosen at setup is declared on BOTH, for the same
    // reason (SCRBRD-039); the innings break may change the second's.
    const captureProfile=cfg.captureProfile??undefined;
    // The side names follow the keys, which setup already ordered by the toss
    // (setup.jsx: teamKey1 is whoever bats first). team1/team2 stay in the
    // order they were picked, so naming the batting side from team1 put the
    // first-picked side's name on the other side's innings whenever it
    // fielded first (SCRBRD-067). In setup a side's name IS its key.
    const open1=[inningsStart({innings:0,battingTeam:tk1,bowlingTeam:tk2,
      squad:sq1,bowlingSquad:bsq1,twelfthMan:cfg.twelfth1||null,teamKey:tk1,bowlingTeamKey:tk2,overs:cfg.overs||20,captureProfile})];
    const open2=[inningsStart({innings:1,battingTeam:tk2,bowlingTeam:tk1,
      squad:sq2,bowlingSquad:bsq2,twelfthMan:cfg.twelfth2||null,teamKey:tk2,bowlingTeamKey:tk1,overs:cfg.overs||20,captureProfile})];

    // Openers and opening bowler chosen in setup step 4.
    if(cfg.opener1&&cfg.opener2&&cfg.openBowler){
      open1.push(battersEvent({innings:0,striker:cfg.opener1,nonStriker:cfg.opener2}));
      open1.push(bowlerEvent({innings:0,bowler:cfg.openBowler}));
    }
    setEvents([open1,open2]);
    // A match started here has no fixture id yet; mint one so the log is
    // durable from the first ball rather than from whenever it gets an id.
    setMatchId(cfg.matchId ?? `local-${Date.now().toString(36)}`);
    hydratedRef.current = true;
    setCurIn(0);setScreen("match");setModal(null);
  };

  const toggleLine=k=>setHidden(prev=>{const n=new Set(prev);n.has(k)?n.delete(k):n.add(k);return n;});

  // ── Declaring what this innings will capture (SCRBRD-039) ──
  // Open until the first ball, and not after: the declaration is a promise
  // about the balls to come, and the fold ignores one that arrives behind
  // them. A real fixture opens its innings during hydration, before anyone
  // has been asked, so the opener sheet offers it here. Choosing re-declares
  // the innings from itself — every field as it stands, plus the profile —
  // the same move the innings break already makes (SCRBRD-063).
  //
  // Only before the openers are named, too. innings_start is the one event
  // undo will not walk past (undo.mjs FOUNDATION), so a declaration made
  // between the striker and the non-striker would pin the striker in place.
  const canDeclare=!!inn?.battingTeam&&(inn?.ballLog?.length??0)===0&&(inn?.batsmen?.length??0)===0;
  const declareCapture=(captureProfile)=>{
    if(!canDeclare||captureProfile===inn.declaredProfile)return;
    emit(inningsStart({
      battingTeam:inn.battingTeam, bowlingTeam:inn.bowlingTeam,
      teamKey:inn.teamKey, bowlingTeamKey:inn.bowlingTeamKey,
      squad:inn.squad, bowlingSquad:inn.bowlingSquad, twelfthMan:inn.twelfthMan,
      overs:inn.overs, target:inn.target, captureProfile,
    }));
  };

  // ── The first innings of a live fixture (SCRBRD-067) ─────
  // The side the toss put in bats; the home roster (the one the pad reads)
  // goes with the home side, batting or bowling. firstInningsSides says which.
  const openFirstInnings=(batsFirst)=>{
    if(!match||curIn!==0||padLockRef.current)return;
    // Decided against the log as it is when the update applies, not as this
    // render saw it: the toss's answer waits for a disk write before it opens
    // the innings, and a second tap in that time must find it already open —
    // two first-innings starts would be two different sides in.
    const open={...inningsStart({
      ...firstInningsSides({batsFirst,fixture:match,homeSquad:homeSquadRef.current}),
      overs:match.overs??20,
      captureProfile:match.captureProfile??undefined,
    }),innings:0,id:newEventId(deviceIdRef.current,matchIdRef.current??"local")};
    setEvents(prev=>{
      if((prev[0]??[]).some(e=>e.kind===KIND.INNINGS_START))return prev;
      mintedRef.current.add(open.id);
      const cp=[...prev];
      cp[0]=[...(prev[0]??[]),open];
      return cp;
    });
  };
  // The scorer's answer to the toss sheet. It opens the innings from the
  // answer at once — the same rule the server applies, so no round trip
  // stands between the coin and the first ball — and is queued as the toss
  // (SCRBRD-075): on disk BEFORE the innings it opens exists, so no flush can
  // carry the innings_start without it, and the outbox sends it first. With
  // no signal it waits there, not in a request that failed and was dropped.
  const answeringTossRef=useRef(false);
  const answerToss=async(toss)=>{
    const batsFirst=battingFirst(toss);
    if(!batsFirst||answeringTossRef.current)return;
    answeringTossRef.current=true;
    try{
      tossRef.current={wonBy:toss.wonBy,decision:toss.decision,batsFirst};
      if(live){
        const engine=syncRef.current?.engine;
        const answer={wonBy:toss.wonBy,decision:toss.decision};
        if(engine) await engine.queueToss(answer).catch(()=>{ pendingTossRef.current=answer; });
        else pendingTossRef.current=answer;
      }
      openFirstInnings(batsFirst);
      setModal("opener");
    }finally{ answeringTossRef.current=false; }
  };
  // The server already had a different toss, and nothing on the pad depends
  // on the side in yet (tossDecision "follow"): the pad takes the server's
  // and, when it puts the other side in, re-opens the first innings from it —
  // appended, as the capture declaration is, since innings_start is the one
  // event undo will not walk past. Read through refs: this runs inside a
  // flush, long after the render that made it.
  const matchRef=useRef(null);
  matchRef.current=match;
  const followServerToss=(server)=>{
    const batsFirst=battingFirst(server);
    const fixture=matchRef.current;
    if(!batsFirst||!fixture)return;
    tossRef.current={wonBy:server.wonBy,decision:server.decision,batsFirst};
    setEvents(prev=>{
      const inn0=prev[0]??[];
      if(!inn0.some(e=>e.kind===KIND.INNINGS_START))return prev;   // nothing open yet: it opens from tossRef
      const cur=deriveInnings(inn0);
      const homeKey=fixture.teamKey1??fixture.team1;
      const homeIn=(cur.teamKey??cur.battingTeam)===homeKey;
      if((homeIn?"home":"away")===batsFirst)return prev;              // the same side in: nothing to change
      const id=newEventId(deviceIdRef.current,matchIdRef.current??"local");
      mintedRef.current.add(id);
      const cp=[...prev];
      cp[0]=[...inn0,{...inningsStart({
        ...firstInningsSides({batsFirst,fixture,homeSquad:homeIn?cur.squad:cur.bowlingSquad}),
        overs:cur.overs??fixture.overs??20,
        captureProfile:cur.declaredProfile??undefined,
      }),innings:0,id}];
      eventsRef.current=cp;
      return cp;
    });
  };

  // ── The gate ────────────────────────────────────────────
  // SCRBRD-040. Whether a delivery may be recorded is asked of the scoring
  // package, not of this file, and the answer names what is missing. The pad
  // shows that answer in words (ScoringBlocked) and every path that records a
  // ball checks the same answer, so the screen cannot say "ready" while the
  // engine refuses, or the reverse. It used to be three inline checks here:
  // a missing batter or bowler popped a sheet with no reason given, and no
  // innings at all returned false and did nothing.
  const readiness=scoringReadiness(inn);

  // The fix for each reason is the sheet that already existed for it. Only an
  // innings with nobody batting had none: a fixture resumed with no toss or
  // no roster on the device opened on a pad that refused every tap in
  // silence. Opening it here writes the same innings_start hydration writes —
  // the side the toss put in, with whatever roster there is — and with no
  // toss to go on it asks for one first (SCRBRD-067): never team1 by default.
  const fixBlock=(b)=>{
    switch(b?.code){
      case SCORING_BLOCK.NO_INNINGS:
        if(curIn===1){setModal("innings2");return;}
        if(!match?.team1)return;
        if(!tossRef.current){setModal("toss");return;}
        openFirstInnings(tossRef.current.batsFirst);
        setModal("opener");return;
      case SCORING_BLOCK.INNINGS_OVER: setModal("inningsReview");return;
      case SCORING_BLOCK.OPENERS: setModal("opener");return;
      case SCORING_BLOCK.NEXT_BATTER: setModal(inn?.striker?"opener":"newBatsman");return;
      case SCORING_BLOCK.OPENING_BOWLER: setModal("bowler");return;
      case SCORING_BLOCK.NEXT_BOWLER:
        setModalCtx({lastBowlerId:inn?.ballLog?.[inn.ballLog.length-1]?.bowlerId??null});
        setModal("newOver");return;
      default: return; // innings closed: nothing to fix, only to say
    }
  };

  // A tap on the pad while blocked still opens the fix — it is what the
  // scorer's hand is asking for — but the pad now says why, above it. A pad
  // waiting on a handover is blocked first: its fix is the code.
  const guardReady=()=>{
    if(padLock){setModal("handover");return false;}
    if(readiness.ready)return true;
    fixBlock(readiness.blocked[0]);
    return false;
  };

  // Hub stage 0: approach toggle
  const onApproach=(a)=>setHubApproach(prev=>prev===a?null:a);

  // Hub stage 0: shot selected → advance to field
  const onShot=(shotId)=>{
    if(!guardReady())return;
    setHubShot(shotId);
    setHubStage(1);
    setSelSeg(null);
  };

  // Hub stage 0: skip shot → go straight to field
  const onShotSkip=()=>{
    if(!guardReady())return;
    setHubShot(null);
    setHubStage(1);
    setSelSeg(null);
  };

  // Hub stage 1: the scorer taps where the ball went → advance to runs.
  // `p` is a full placement (theta, radius and the seg/zone derived from
  // them), not a sector index. It is held whole until commit so nothing has
  // to reconstruct the point from the parts.
  const onFieldSel=(p)=>{
    setSelSeg(p);
    setHubStage(2);
  };

  // Hub stage 2: run value selected → commit
  const onRun=(value)=>{
    if(!inn||!selSeg)return;
    // Hit body → automatically leg-byes (ball didn't hit bat)
    const effectiveType=hubShot==="hit_body"?"LB":"run";
    commitBall(effectiveType,value,hubShot,null,null,hubApproach,selSeg);
  };

  // Focus-mode commits
  const onRunQuick=(value)=>{
    if(!guardReady())return;
    commitBall("run",value,null,null,null,null);
  };
  // 3-phase commit: type may be run / B (bye) / LB (leg-bye), with shot + area
  const onCommitDetailed=(type,value,shot,seg,zone)=>{
    if(!guardReady())return;
    commitBall(type,value,shot,seg,zone,null);
  };
  // Wicket carrying the shot + area context captured in phases 1–2
  const onWicketCtx=(shot,seg,zone)=>{
    if(!guardReady())return;
    setModalCtx({shot,seg:seg??null,zone:zone??null});
    setModal("wicket");
  };

  const onBye=()=>{
    if(!inn||!selSeg)return;
    commitBall("B",1,hubShot,null,null,hubApproach,selSeg);
  };

  const onLegBye=()=>{
    if(!inn||!selSeg)return;
    commitBall("LB",1,hubShot,null,null,hubApproach,selSeg);
  };

  // Hub stage 2: wicket
  const onHubWicket=()=>{
    if(!guardReady())return;
    setModalCtx({shot:hubShot,seg:selSeg?.seg??null,zone:selSeg?.zone??null});
    setModal("wicket");
  };

  // Wide / No Ball — bypass hub entirely
  const onWide=()=>{
    if(!guardReady())return;
    commitBall("Wd",0,null,null,null,hubApproach);
  };

  const onNoBall=()=>{
    if(!guardReady())return;
    setModal("noBall");
  };

  // Reset hub back to stage 0
  const resetHub=()=>{
    setHubStage(0);setHubShot(null);setSelSeg(null);setScoringCtx(null);setSelShot(null);
  };

  // Back one stage in hub
  const onBack=()=>{
    if(hubStage===2){setHubStage(1);setSelSeg(null);}
    else if(hubStage===1){setHubStage(0);setHubShot(null);}
  };

  // Drain milestone queue — called when EventOverlay completes
  const onOverlayDone=()=>{
    const next=milestoneQRef.current.shift();
    if(next)setEventOverlay(next);
    else setEventOverlay(null);
  };
  // Watchdog: whatever happens to the animation timers, no overlay may be
  // left on screen. Bounded slightly above the longest milestone duration.
  useEffect(()=>{
    if(!eventOverlay)return;
    const t=setTimeout(()=>{
      const next=milestoneQRef.current.shift();
      setEventOverlay(next||null);
    },3200);
    return()=>clearTimeout(t);
  },[eventOverlay]);
  // (Blur suppression while a modal is open is handled at render time by
  //  EventOverlay's `suppressBlur` prop — mutating the event object here
  //  used to re-arm its dismiss timers and strand queued overlays.)

  // Whether THIS innings has been closed, as opposed to merely being over. The
  // two come apart for as long as the scorer has not confirmed the review,
  // which is exactly the window the banner exists to cover.
  //
  // Asked of the replay rather than by scanning the log for the event kind: a
  // seal whose figures the log does not produce is refused there (see
  // sealRefusal), and a screen that counted the event would call such an
  // innings closed while the model called it open — a disagreement with nothing
  // to reconcile it.
  const inningsClosed=inn?.sealed===true;

  // ── Closing an innings ──────────────────────────────────
  // SCRBRD-038. Until now the ball that completed an innings also closed it,
  // and the close existed only as an inference: `innings_end` was defined in
  // the event model, honoured by the replay, imported by this file — and never
  // emitted by anything. So every replay re-derived the ending, and the reason
  // for it was nowhere in the log.
  //
  // Confirming the review writes it, and writes it through sealInnings(), which
  // stamps the figures this sheet just showed onto the event. That is what the
  // reducer checks the seal against, so the gate is a property of the model and
  // not of this file: nothing can close an innings by asserting that it is
  // closed. The reason comes from the replay rather than from a control, because
  // the laws decide it and the scorer is being asked to check the figures, not
  // to classify them. A declaration is the one ending a scorer declares, and it
  // arrives through the revision/declare path rather than here.
  const closeInnings=()=>{
    // An innings that is not over has nothing to seal, and a seal built from it
    // would carry no reason and be refused. Nothing in the UI can reach this —
    // the sheet only opens on a complete innings — which is why it is cheap.
    if(!inn?.complete)return;
    emit(sealInnings(inn));
    setModal(null);
    if(curIn===0){setCurIn(1);setModal("innings2");}
    else setScreen("result");
  };

  // ── Undo ────────────────────────────────────────────────
  // The artifact kept a deep-copy snapshot stack capped at ten entries,
  // because aggregates could not be recomputed — a scorer who spotted at ball
  // 14 that ball 2 was wrong could not reach it. Re-deriving from the log is
  // exact and has no depth limit.
  //
  // WHICH undo applies depends on whether the server already has the event,
  // and the rule lives in @scrbrd/scoring rather than here: it will apply
  // identically on a second device during a handover, and two implementations
  // of it would be one too many. See packages/scoring/src/undo.mjs.
  //
  // An event the server REFUSED (held, SCRBRD-070) never reached it, so undo
  // drops it from the log wherever it sits — never a void, which the server
  // would refuse and hold in its turn (SCRBRD-071) — and lets its held copy
  // go: the scorer has just taken it off the board with their own hand.
  // undoOnPad asks undo.mjs with the device's outbox; the rule is there.
  //
  // An event that never left the device (SCRBRD-074) is cut from the log AND
  // withdrawn from the outbox, or it is sent anyway and the server records a
  // ball the pad no longer shows. The decision and the withdrawal happen in
  // this one tick — withdraw takes it out of the queue before its first
  // await — so a flush cannot pick it up in between, and one already in
  // flight has marked it sent, which makes it a void instead. The shorter log
  // is saved only once the withdrawal is on disk (withdrawalsRef, the
  // persist effect below). Which outbox: see the start of undoLastBall.
  const undoLastBall=()=>{
    if(padLock)return;
    const engine=syncRef.current?.engine??null;
    // Which outbox undo asks. Attached: the engine, whose markers say what
    // has left. A live pad holding no token (SCRBRD-078): the engine, but
    // "never sent" only for what this pad minted since it opened — nothing is
    // sent while unattached, so those have certainly not left, while an event
    // from an earlier session may have (queued before the markers existed,
    // SCRBRD-079) and is voided. No engine yet on a live pad: every undo a
    // void. No server behind the match at all: LOCAL_ONLY.
    const outbox=!live?(matchIdRef.current?null:LOCAL_ONLY)
      :!engine?null
      :engine.attached?engine
      :{isHeld:k=>engine.isHeld(k),isUnsent:k=>mintedRef.current.has(k)&&engine.isUnsent(k)};
    // A void is appended here, not through emit(), so it is stamped here: the
    // log-watching effect offers the outbox only events with ids, and a void
    // without one was never sent — the server kept every ball undone by one.
    const undone=undoOnPad(events,curIn,outbox,
      ()=>{const id=newEventId(deviceIdRef.current,matchIdRef.current??"local");mintedRef.current.add(id);return id;});
    if(undone.withdraw&&engine){
      const outbox=engine;
      const target=undone.target, inn=curIn, at=events[curIn].length-1;
      // The withdrawal failed or was refused: the outbox still has the
      // event and will send it, so the log gets it back where it was.
      const putBack=()=>setEvents(prev=>{
        if(prev.some(evs=>evs.some(e=>e.id===target.id)))return prev;
        const cp=[...prev], evs=[...(cp[inn]??[])];
        evs.splice(Math.min(at,evs.length),0,target);
        cp[inn]=evs;
        return cp;
      });
      const w=outbox.withdraw(undone.withdraw).then(ok=>ok,()=>false).then(ok=>{
        withdrawalsRef.current.delete(w);
        if(!ok)putBack();
        return ok;
      });
      withdrawalsRef.current.add(w);
    }
    if(undone.action!=="none")setEvents(undone.log);
    if(undone.discard)engine?.discardHeld(undone.discard).catch(()=>{});
    resetHub();
    setModal(null);
    scoreKeyRef.current++;
  };

  // ── Held events (SCRBRD-070) ────────────────────────────
  // An event the server refused, or that conflicts with one it already has,
  // is on this device only. Resolving one changes THE LOG — the same
  // setEvents → saveMatch path undo takes, so the board re-derives and a
  // reload restores what the scorer chose — and only then lets the held copy
  // go. Crash between the two and either the log still has it (it is sent,
  // refused and held again on the next start) or the held list still names
  // an event the log no longer has (shown as off the board, discarded with a
  // tap). Neither loses it, neither doubles it. The rules are in
  // packages/sync/src/held.mjs.
  const discardHeldEvents=async(keys)=>{
    const outbox=syncRef.current?.engine;
    if(!outbox)return;
    setEvents(prev=>withoutEvents(prev,keys));
    for(const k of keys)await outbox.discardHeld(k);
  };
  const recordHeldAgain=async(keys)=>{
    const outbox=syncRef.current?.engine;
    if(!outbox)return;
    const scope=heldInOrder(outbox.held).filter(h=>keys.includes(h.idempotencyKey));
    // Judged again at the moment of the tap, not when the sheet drew: the
    // log may have moved since.
    if(!scope.length||recordAgainRefusal(events,outbox.held,scope))return;
    const {log}=recordAgain(events,outbox.held,scope,
      ()=>{const id=newEventId(deviceIdRef.current,matchIdRef.current??"local");mintedRef.current.add(id);return id;});
    setEvents(log);
    for(const h of scope)await outbox.discardHeld(h.idempotencyKey);
  };

  // ── Taking over (SCRBRD-075) ─────────────────────────────
  // The incoming device's claim is answered with the server's log (spec §4
  // step 2), and the pad takes it: nothing this pad minted may be sent over
  // a log the server has already started, and the score the scorer is about
  // to confirm is the server's. Anything the pad had that the server does not
  // is saved aside on this device first, and said — never lost, never merged.
  //
  // Which rule the outbox then follows is the comparison's. The server has
  // nothing the pad lacks: whatever the pad has beyond it is its own
  // continuation of that log, and goes out under the new token (rebase). The
  // server has moved on past the pad: the pad takes its log, and anything it
  // queued under an older token goes to quarantine by the epoch rule — not
  // into the log the scorer is confirming — along with its own unsent toss
  // set aside with the rest.
  const handoverLogRef=useRef(null);
  const handoverRebaseRef=useRef(false);
  const [asideCount,setAsideCount]=useState(0);
  const takeHandedOverLog=async(rows)=>{
    const server=(rows??[]).map(fromRow);
    handoverLogRef.current=server;
    const engine=syncRef.current?.engine;
    if(engine)await engine.markSent(server.map(e=>e?.id).filter(Boolean));
    const r=reconcile(eventsRef.current,server,{held:engine?.held??[],pending:engine?.pending??[]});
    handoverRebaseRef.current=r.extra.length===0;
    if(!r.extra.length)return;
    if(r.mine.length){
      const toss=engine?await engine.setTossAside():null;
      await saveAside(matchIdRef.current,{events:eventsRef.current,notOnServer:r.mine,...(toss?{toss}:{})});
      setAsideCount(r.mine.length);
    }
    adoptLog(padLogFrom(server),eventsRef.current);
  };

  // Legacy onScore kept for any remaining modal references
  const onScore=(type,value)=>{
    if(!guardReady())return;
    if(type==="Wd"){commitBall("Wd",value,null,null,null,hubApproach);return;}
    if(type==="Nb"){setModal("noBall");return;}
    setScoringCtx({type,value});
  };

  const onShotSelected=(shotId)=>{setSelShot(shotId);setModal(null);if(scoringCtx?.type==="W"){setModalCtx({shot:shotId});setModal("wicket");}};
  const onShotSkipped=()=>{setSelShot(null);setModal(null);if(scoringCtx?.type==="W"){setModalCtx({shot:null});setModal("wicket");}};

  // WHO FACED IT, ON THE EVENT — for every delivery, not only the ones that
  // come through commitBall(). The no-ball sheet and the wicket sheet build
  // their own ball, and until SCRBRD-068's follow-up neither stamped the
  // crease: a no-ball and a wicket ball reached the server with no striker,
  // non-striker or bowler, so every SQL career figure left them out — balls
  // faced, runs conceded, no-balls, dismissals. The fold never reads these
  // (it tracks the crease itself), so the board is unchanged; the Laws never
  // read them either. Taken from the innings BEFORE the ball: the striker who
  // faced it is the one there before it rotated them.
  const crease=(i)=>({
    striker: i?.striker ?? null,
    nonStriker: i?.nonStriker ?? null,
    bowler: i?.bowler ?? null,
  });

  // Called once shot AND field are both known.
  //
  // This used to be sixty lines of parallel bookkeeping: runs, extras, batter
  // figures, bowler figures, partnership, maidens and strike rotation, each
  // updated by hand on every branch. It is now one event. What happens next —
  // did the over end, did the innings end — is read from the projection rather
  // than recomputed here, so the rules live in exactly one place.
  /**
   * Record a delivery.
   *
   * `placement` is the whole set of shot-placement fields, built by
   * placementFromTap() or noPlacement() — never assembled here. It carries its
   * own derived seg and zone, which is what keeps the point and the sector it
   * reduces to from drifting apart. Callers that pass a bare seg/zone (the
   * one-tap pad, which never asks where the ball went) get an explicit
   * "not required" rather than a silent blank.
   */
  const commitBall=(type,value,shot,seg,zone,approach,placement)=>{
    // Every delivery comes through here, including the hub's stage-2 paths
    // that were only checked at stage 0. The same answer the pad shows.
    if(!readiness.ready||padLock)return;
    const place=placement??(seg!=null
      ? {seg,zone,placementSource:PLACEMENT_SOURCE.SECTOR,captureProfile:CAPTURE_PROFILE.STANDARD}
      : noPlacement(
          // A shot with no bat contact has nowhere to go, and that is a
          // different fact from a scorer skipping the step.
          NO_CONTACT_SHOTS.has(shot) ? PLACEMENT_NULL.NO_CONTACT : PLACEMENT_NULL.NOT_REQUIRED,
          CAPTURE_PROFILE.QUICK));
    const before=inn;
    // WHO FACED IT, ON THE EVENT
    // ──────────────────────────
    // Until now a ball carried no striker and no bowler: attribution existed
    // only as replay state, rebuilt by walking `batters` and `bowler` events
    // and applying strike rotation. That is fine for a scorecard the device
    // draws, and impossible for anything else — a career average in SQL would
    // have meant re-implementing the whole rotation state machine as a window
    // function, which is a third fold over the log and the most intricate one.
    //
    // The event should record what happened, and who was on strike is part of
    // what happened. The columns already existed and were always NULL, which
    // is why ball_event.striker_id sits unused in the shot_points query.
    //
    // Taken from `before`, not `after`: the striker who faced this delivery is
    // the one at the crease before it rotated them.
    const ev=ballEvent({
      type,value,shot,bowlerApproach:approach||null,freeHit,
      ...crease(before),
      ...place,
    });
    const after=project(ev);
    const endedOver=after.balls>before.balls&&after.balls%6===0;
    const endedInnings=after.complete;
    const lastBowlerId=before?.bowler||null; // cleared by the projection at over end

    emit(ev);

    setSelSeg(null);setSelShot(null);setScoringCtx(null);setHubStage(0);setHubShot(null);
    scoreKeyRef.current++;
    if(endedOver){
      const ovLog=after.overLog[after.overLog.length-1];
      if(ovLog)setLastOverDCB(ovLog);
    }
    const mile=detectMilestone(ev,before);
    const showBallOverlay=type==="run"&&(value===4||value===6);
    const queue=[];
    if(showBallOverlay)queue.push(buildEventCfg(value,null));
    if(mile)queue.push(buildEventCfg(null,mile));
    // If a modal is about to open (end of over/innings), mark overlays as
    // non-blocking so the blur never covers the sheet underneath.
    const modalPending=endedInnings||endedOver;
    if(queue.length>0){
      const q=modalPending?queue.map(c=>({...c,noBlur:true})):queue;
      milestoneQRef.current=q.slice(1);
      setEventOverlay(q[0]);
    }
    setFreeHit(after.freeHit);
    if(endedInnings)setModal("inningsReview");
    else if(endedOver){setModalCtx({lastBowlerId});setModal("newOver");}
  };

  // After shot selected and field selected — commit the ball
  const commitFromField=(seg,zone)=>{
    if(!scoringCtx)return;
    commitBall(scoringCtx.type,scoringCtx.value,selShot,seg,zone,hubApproach);
  };

  const handleSegSelect=(s)=>{
    setSelSeg(s);
    if(scoringCtx&&scoringCtx.type!=="W"&&scoringCtx.type!=="Wd"&&scoringCtx.type!=="Nb"&&s){
      commitBall(scoringCtx.type,scoringCtx.value,selShot,s.seg,s.zone,hubApproach);
    }
  };

  // A wicket with no delivery: retired out, timed out (SCRBRD-081). A retire
  // event marked W (events.mjs retire()), never a ball — the over does not
  // move and the bowler takes nothing. What follows is read from the
  // projection, as after a ball: the innings may be over, or an end empty.
  // `keepModal` leaves the sheet it came from open (timed out, from the
  // batting-order sheet, still has an end to fill).
  const recordNonBallWicket=(ev,{keepModal=false}={})=>{
    const after=project(ev);
    emit(ev);
    setSelSeg(null);setSelShot(null);setScoringCtx(null);setModalCtx({});
    scoreKeyRef.current++;setHubStage(0);setHubShot(null);
    milestoneQRef.current=[];
    setEventOverlay({...buildEventCfg("W",null),noBlur:true});
    if(after.complete)setModal("inningsReview");
    else if(keepModal)return;
    else if(after.striker==null||after.nonStriker==null)setModal("newBatsman");
    else setModal(null);
  };
  // Offered on the batting-order sheet only when the Laws would take it:
  // the same question the server asks, of a batter nobody has named yet.
  const canTimeOut=!!inn&&lawsRefusal({innings,events},retireEvent({innings:curIn,batter:"\u0000",reason:RETIRE_REASON.TIMED_OUT}))===null;
  const recordTimedOut=id=>recordNonBallWicket(retireEvent({batter:id,reason:RETIRE_REASON.TIMED_OUT}),{keepModal:true});

  const confirmWicket=(mode,fielder,extra={})=>{
    if(!readiness.ready){setModal(null);return;}
    if(mode===DISMISSAL.RETIRED_OUT){
      recordNonBallWicket(retireEvent({batter:extra.dismissed??inn.striker,reason:RETIRE_REASON.OUT}));
      return;
    }
    // The dismissal, the fielder, whose wicket it is and whether the bowler is
    // credited are all decided by the replay. The fielder in particular used to
    // be dropped from the log entirely, so a replayed scorecard could never
    // render "c Botha b Mkhize".
    // A run out carries the runs completed before it, who was out when it
    // was not the striker, and — when runs were completed — the end the
    // wicket was put down at (SCRBRD-069), which the fold empties.
    const ev=ballEvent({type:"W",value:extra.runs??0,shot:modalCtx?.shot||null,
      seg:modalCtx?.seg??null,zone:modalCtx?.zone??null,
      dismissal:mode,fielder:fielder||null,freeHit,
      ...crease(inn),
      ...(extra.dismissed?{dismissed:extra.dismissed}:{}),
      ...(extra.outAt?{outAt:extra.outAt}:{})});
    const before=inn;
    const after=project(ev);
    const endedOver=after.balls>before.balls&&after.balls%6===0;
    const endedInnings=after.complete;
    const stood=after.wickets>before.wickets; // a free hit can save the batter

    emit(ev);

    setSelSeg(null);setSelShot(null);setScoringCtx(null);setModalCtx({});
    scoreKeyRef.current++;setHubStage(0);setHubShot(null);
    {
      // A wicket always opens a follow-up sheet (new batsman / new over /
      // innings break), so every overlay in this chain is non-blocking.
      const wicketCfg={...buildEventCfg("W",null),noBlur:true};
      const mile=detectMilestone({type:"W",value:0,striker:before?.striker,bowler:before?.bowler},before);
      milestoneQRef.current=(mile?[mile]:[]).map(m=>({...buildEventCfg(null,m),noBlur:true}));
      setEventOverlay(wicketCfg);
    }
    setFreeHit(after.freeHit);
    if(endedInnings)setModal("inningsReview");
    else if(!stood){if(endedOver){setModalCtx({lastBowlerId:before?.bowler||null});setModal("newOver");}}
    else if(endedOver)setModal("newBatsmanThenOver");
    else setModal("newBatsman");
  };

  // A batter arriving and a bowler taking the ball are events, not mutations.
  // Without them in the log the log could not stand alone: a delivery record
  // says nothing about who walked in after the last wicket.
  const addBatsman=(name,isStriker)=>{
    const asStriker=isStriker||!inn?.striker;
    emit(battersEvent(asStriker?{striker:name}:{nonStriker:name}));
  };

  // `reason` only for a change during an over (SCRBRD-080): the sheet asks
  // "Injury or suspended?" then, and the server refuses a change without one.
  const addBowler=(name,reason)=>emit(bowlerEvent({bowler:name,...(reason?{reason}:{})}));
  const midOver=isMidOver(inn);
  // The bowler sheet asks the question the server asks when the event
  // arrives — lawsRefusal() over the same two arrays this screen already
  // folds — so a bowler it offers is one the server will take. It used to
  // compare names against the last bowler, a rule of its own that knew
  // nothing of a mid-over change (Law 17.8: "or parts thereof").
  // Mid-over the sheet itself insists on the reason; what it asks the Laws
  // here is the rest (Law 17.8), so it offers a reason the server will take.
  const bowlerRefusal=id=>lawsRefusal({innings,events},bowlerEvent({innings:curIn,bowler:id,...(midOver?{reason:BOWLER_CHANGE_REASON.INJURY}:{})}));

  const awardPenalty=(runs,to,reason)=>{
    emit(penaltyEvent({runs,toBattingTeam:to==="batting",reason}));
    setModal(null);
  };
  // The umpires' revision goes into the log like a ball. Everything that
  // reads the innings — the over count on the pad, the innings-over rule, the
  // result, the other device, the server — derives it from there.
  const reviseInnings=({overs,target,reason})=>{
    emit(revisionEvent({overs,target,reason}));
    setModal(null);
  };

  const getSquad=()=>{
    if(!inn)return[];
    return inn.squad||[];
  };

  /* ── Modal router ── */
  const renderModal=()=>{
    if(!modal)return null;

    if(modal==="shot")return (
      <ShotSelectorSheet
        onSelect={shot=>{onShotSelected(shot);}}
        onSkip={onShotSkipped}
        onClose={()=>{setScoringCtx(null);setModal(null);}}/>
    );

    if(modal==="noBall")return (
      <NoBallSheet
        onConfirm={(nbType,runs,nbRuns)=>{
          // `nbRuns` only when the scorer said byes or leg byes (SCRBRD-068);
          // off the bat is the event's default and is left off it.
          emit(ballEvent({type:"Nb",value:runs,shot:selShot,
            seg:selSeg?.seg??null,zone:selSeg?.zone??null,nbType,...(nbRuns?{nbRuns}:{}),
            ...crease(inn)}));
          setSelSeg(null);setModal(null);scoreKeyRef.current++;
          // A height no-ball or a beamer earns a free hit. The replay also
          // tracks this; setting it here keeps the banner immediate.
          if(nbType==="height"||nbType==="beamer")setFreeHit(true);
        }}
        onClose={()=>setModal(null)}/>
    );

    if(modal==="revise")return (
      <RevisionSheet
        overs={inn?.overs??match?.overs??20}
        target={curIn===1?(inn?.target??((innings[0]?.runs||0)+1)):null}
        isChase={curIn===1}
        onClose={()=>setModal(null)}
        onConfirm={reviseInnings}/>
    );

    if(modal==="toss")return (
      <TossSheet
        home={match?.team1} away={match?.team2}
        onConfirm={answerToss}
        onClose={()=>setModal(null)}/>
    );

    if(modal==="held")return (
      <HeldSheet
        held={sync.heldList??[]}
        events={events}
        innings={innings}
        live={attached}
        onDiscard={discardHeldEvents}
        onRecordAgain={recordHeldAgain}
        onClose={()=>setModal(null)}/>
    );

    if(modal==="handover")return (
      <HandoverSheet
        matchId={matchId} device={deviceIdRef.current}
        epoch={syncRef.current?.engine?.epoch}
        pending={sync.pending}
        held={sync.held??0}
        onShowHeld={()=>setModal("held")}
        ballInFlight={scoringCtx!=null}
        startTab={sync.reason==="handover_pending"||sync.reason==="verifying"?"take":"hand"}
        onHandedOver={()=>{
          // This device armed it and someone else has now claimed and
          // verified it — its own token is gone. It sends nothing more (a
          // stale lease check would only earn a confusing not_token_holder
          // for a device that already knows it handed over), and nothing it
          // records from here is sent: the log is the other device's now.
          syncRef.current?.handedOver();
          setModal(null);
        }}
        onClaimed={takeHandedOverLog}
        onTakenOver={(newEpoch)=>{
          // The token is this device's, under the generation the transfer
          // made — no claim of its own, which would only burn another. What
          // the server had at the claim is marked sent; the rest follows the
          // comparison made at the claim (takeHandedOverLog).
          syncRef.current?.reattach(newEpoch,handoverLogRef.current??[],{rebase:handoverRebaseRef.current});
          handoverLogRef.current=null;
        }}
        onCancelled={(newEpoch)=>{
          // The arming device took the token back (the protocol's cancel is
          // its own claim): the same device's continuation, under the new
          // generation.
          if(newEpoch!=null)syncRef.current?.reattach(newEpoch,[],{rebase:true});
        }}
        onClose={()=>setModal(null)}/>
    );

    if(modal==="penalty")return (
      <PenaltySheet
        battingTeam={inn?.battingTeam||"Batting"}
        bowlingTeam={inn?.bowlingTeam||"Bowling"}
        onConfirm={awardPenalty}
        onClose={()=>setModal(null)}/>
    );

    if(modal==="opener")return (
      <BattingOrderSheet
        squad={getSquad()}
        batsmen={inn?.batsmen||[]}
        teamKey={inn?.teamKey}
        twelfthMan={inn?.twelfthMan}
        header={canDeclare?<CaptureProfilePicker value={inn.declaredProfile} onChange={declareCapture}/>:null}
        onTimedOut={canTimeOut?recordTimedOut:null}
        onSend={name=>{
          const hasStriker=!!(inn?.striker);
          const hasNonStriker=!!(inn?.nonStriker);
          if(!hasStriker){addBatsman(name,true);setModalCtx(p=>({...p,openerCount:(p.openerCount||0)+1}));}
          else if(!hasNonStriker){addBatsman(name,false);setModal("bowler");}
          else{addBatsman(name,true);setModal("bowler");}
        }}
        onClose={()=>setModal(null)}/>
    );

    if(modal==="bowler"){
      const lastBowler=inn?.bowlers.find(b=>b.id===modalCtx?.lastBowlerId);
      return (
        <NewOverSheet
          ovNum={0}
          prevBowlers={inn?.bowlers||[]}
          bowlingSquad={inn?.bowlingSquad||[]}
          bowlingTeamKey={inn?.bowlingTeamKey}
          lastBowlerName={lastBowler?.name||null}
          refuses={bowlerRefusal}
          onClose={()=>setModal(null)}
          onConfirm={name=>{addBowler(name);setModal(null);}}/>
      );
    }

    if(modal==="wicket"){
      // Build fielding squad objects from bowlingTeamKey or bowlingSquad names
      const bowlingTeamKey=inn?.bowlingTeamKey;
      const teamData=INT_TEAMS[bowlingTeamKey];
      const fieldingSquad=teamData
        ?teamData.players.filter((_,i)=>i<11)
        :(inn?.bowlingSquad||[]).map(n=>({name:n,role:"BOWL"}));
      return (
        <WicketSheet
          batName={inn?.batsmen.find(b=>b.id===inn.striker)?.name||"Batsman"}
          striker={inn?.striker!=null?{id:inn.striker,name:inn.batsmen.find(b=>b.id===inn.striker)?.name??String(inn.striker)}:null}
          nonStriker={inn?.nonStriker!=null?{id:inn.nonStriker,name:inn.batsmen.find(b=>b.id===inn.nonStriker)?.name??String(inn.nonStriker)}:null}
          fieldingSquad={fieldingSquad}
          onClose={()=>{setModal(null);setScoringCtx(null);setSelShot(null);resetHub();}}
          onConfirm={(mode,fielder,extra)=>{confirmWicket(mode,fielder,extra);}}/>
      );
    }

    if(modal==="newBatsman"||modal==="newBatsmanThenOver"){
      const isThenOver=modal==="newBatsmanThenOver";
      return (
        <BattingOrderSheet
          squad={getSquad()}
          batsmen={inn?.batsmen||[]}
          teamKey={inn?.teamKey}
          twelfthMan={inn?.twelfthMan}
          onTimedOut={canTimeOut?recordTimedOut:null}
          onSend={name=>{
            // To the END THAT IS EMPTY. This sent every new batter to the
            // striker's end, which is right only when the striker was out
            // mid-over: after a wicket on the last ball the survivor has
            // already changed ends, and after the non-striker is out the
            // striker is still in — naming the new man as striker dropped a
            // not-out batter from the crease, and the server refused it
            // (crease_occupied). Retired out and a run out's end make an
            // empty non-striker's end ordinary (SCRBRD-081, SCRBRD-069).
            addBatsman(name,inn?.striker==null);
            if(isThenOver)setModal("newOver");else setModal(null);
          }}
          onClose={()=>setModal(null)}/>
      );
    }

    if(modal==="newOver"){
      const lastBowler=inn?.bowlers.find(b=>b.id===modalCtx?.lastBowlerId);
      return (
        <NewOverSheet
          ovNum={Math.floor((inn?.balls||0)/6)}
          prevBowlers={inn?.bowlers||[]}
          bowlingSquad={inn?.bowlingSquad||[]}
          bowlingTeamKey={inn?.bowlingTeamKey}
          lastBowlerName={lastBowler?.name||null}
          refuses={bowlerRefusal}
          midOver={midOver}
          onClose={()=>setModal(null)}
          onConfirm={(name,reason)=>{addBowler(name,reason);setModal(null);}}/>
      );
    }

    if(modal==="inningsReview")return (
      <InningsReviewSheet
        inn={inn} inningsNo={curIn+1}
        onConfirm={closeInnings}
        onFixLastBall={()=>{undoLastBall();setModal(null);}}
        onClose={()=>setModal(null)}/>
    );

    if(modal==="innings2")return (
      <Innings2Sheet
        target={(innings[0]?.runs||0)+1}
        teamName={innings[1]?.battingTeam||innings[0]?.bowlingTeam||match?.team2||""}
        overs={match?.overs||20}
        declared={innings[1]?.declaredProfile??innings[0]?.declaredProfile??null}
        onClose={()=>setModal(null)}
        onStart={(captureProfile)=>{
          // SCRBRD-063. The second innings never got its own INNINGS_START —
          // nothing set inn.target, so inningsOverReason() could never return
          // target_reached, and a chase that reached its target just kept
          // being scored. A plain REVISION event would set the target without
          // that risk, but it also flags the innings `revised` — the pad
          // would show a "(revised)" badge on a normal chase that was never
          // touched by rain or an umpire, which is worse than the bug it
          // would fix. So this re-declares INNINGS_START, sourcing every
          // field from `innings[1]` first: the from-scratch match setup
          // already gave this innings its real team/squad data up front
          // (`startMatch`'s `open2`), so re-declaring it here from itself is
          // a no-op except for adding the one field that was always missing.
          // Only the real-fixture resume path — which never emits an
          // INNINGS_START for innings 1 at all — falls through, and it falls
          // through to the FIRST innings with its sides swapped, not to
          // `match`: on a live fixture the toss decides who batted first
          // (SCRBRD-067), so team2 is not necessarily batting now. Whoever
          // bowled then bats now, with the squad they bowled with — the home
          // roster when the away side batted first, none (typed names) when
          // it did not — and the side that batted first bowls with its own.
          emit(inningsStart({
            battingTeam: innings[1]?.battingTeam || innings[0]?.bowlingTeam || match?.team2,
            bowlingTeam: innings[1]?.bowlingTeam || innings[0]?.battingTeam || match?.team1,
            teamKey: innings[1]?.teamKey || innings[0]?.bowlingTeamKey || match?.teamKey2 || match?.team2,
            bowlingTeamKey: innings[1]?.bowlingTeamKey || innings[0]?.teamKey || match?.teamKey1 || match?.team1,
            squad: innings[1]?.squad?.length ? innings[1].squad : (innings[0]?.bowlingSquad ?? []),
            bowlingSquad: innings[1]?.bowlingSquad?.length ? innings[1].bowlingSquad : (innings[0]?.squad ?? []),
            twelfthMan: innings[1]?.twelfthMan ?? null,
            overs: innings[1]?.overs || match?.overs || 20,
            target: (innings[0]?.runs || 0) + 1,
            // What the break chose (SCRBRD-039). Left off when nothing was
            // chosen: absence keeps whatever innings[1] already declared.
            captureProfile: captureProfile ?? undefined,
          }));
          setModal("opener");
        }}/>
    );

    if(modal==="editOrder")return (
      <BattingOrderSheet
        squad={getSquad()}
        batsmen={inn?.batsmen||[]}
        teamKey={inn?.teamKey}
        twelfthMan={inn?.twelfthMan}
        onSend={name=>{addBatsman(name,true);setModal(null);}}
        onClose={()=>setModal(null)}/>
    );

    return null;
  };

  /* ── Result ── */
  if(screen==="result"){
    const i1=innings[0],i2=innings[1];
    const win1=i1&&i2&&i1.runs>i2.runs,tie=i1&&i2&&i1.runs===i2.runs;
    const winner=tie?"Match Tied":win1?i1.battingTeam:i2?.battingTeam;
    const margin=win1?`by ${i1.runs-(i2?.runs||0)} runs`:i2?`by ${10-i2.wickets} wickets`:"";
    return (
      <div style={{minHeight:"100vh",background:D.base,padding:"24px",display:"flex",flexDirection:"column",alignItems:"center"}}>
        <GS/>
        <div style={{width:"100%",maxWidth:"920px"}}>
          <Glass style={{padding:"36px",textAlign:"center",marginBottom:"28px"}}>
            <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:"12px"}}>Match Complete</div>
            <div style={{fontFamily:D.mono,fontSize:"clamp(28px,5vw,48px)",fontWeight:500,background:D.grad,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",marginBottom:"6px"}}>{winner}</div>
            {!tie&&<div style={{color:D.emerald,fontSize:"16px",fontFamily:D.body,fontWeight:500}}>{margin}</div>}
          </Glass>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"20px",marginBottom:"28px"}}>
            {[0,1].map(ii=>innings[ii]&&<ScorecardPanel key={ii} innings={innings} idx={ii}/>)}
          </div>
          <div style={{textAlign:"center"}}>
            <Btn variant="primary" size="lg" onClick={()=>{setScreen("setup");setEvents([[],[]]);setCurIn(0);setMatch(null);setSelSeg(null);}}>
              New Match
            </Btn>
          </div>
        </div>
      </div>
    );
  }

  if(screen==="setup")return (<><GS/><SetupScreen onStart={startMatch}/></>);

  /* ── MATCH SCREEN ── */
  const NAV=[{id:"score",icon:"🏏",label:"Score"},{id:"cards",icon:"📋",label:"Cards"},{id:"analysis",icon:"📊",label:"Analysis"},{id:"history",icon:"📜",label:"History"}];
  const target2=curIn===1?(inn?.target??((innings[0]?.runs||0)+1)):null;
  // Determine if shot selection is in progress (show field in "confirm shot" mode)
  const awaitingField=scoringCtx&&scoringCtx.type!=="W"&&scoringCtx.type!=="Wd"&&scoringCtx.type!=="Nb"&&modal===null;

  /* Drag-to-reorder cards in score tab */
  const handleCardDragStart=(e,id)=>{cardDragRef.current=id;e.dataTransfer.effectAllowed="move";};
  const handleCardDragOver=(e,id)=>{
    e.preventDefault();
    if(!cardDragRef.current||cardDragRef.current===id)return;
    const from=cardOrder.indexOf(cardDragRef.current);
    const to=cardOrder.indexOf(id);
    if(from<0||to<0)return;
    const next=[...cardOrder];next.splice(from,1);next.splice(to,0,cardDragRef.current);
    setCardOrder(next);
  };
  const handleCardDrop=()=>{cardDragRef.current=null;};

  return (
    <>
      <GS/>
      {eventOverlay&&<EventOverlay event={eventOverlay} onDone={onOverlayDone} suppressBlur={!!modal}/>}
      {freeHit&&<FreeHitBanner onDismiss={()=>setFreeHit(false)}/>}
      {inn?.complete&&!inningsClosed&&!modal&&<InningsOverBanner onReview={()=>setModal("inningsReview")}/>}
      {renderModal()}
      <div style={{minHeight:"100vh",background:D.base,paddingBottom:"88px"}}>
        {/* Top bar */}
        <div style={{position:"sticky",top:0,zIndex:100,background:D.glass,
          backdropFilter:"blur(24px) saturate(1.8)",WebkitBackdropFilter:"blur(24px) saturate(1.8)",
          borderBottom:`1px solid ${D.border}`,padding:"10px 18px",
          display:"flex",alignItems:"center",gap:"12px"}}>
          <div style={{fontFamily:D.head,fontSize:"17px",fontWeight:800,
            background:D.grad,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",
            letterSpacing:"0.04em",flexShrink:0}}>SCRBRD</div>
          <div style={{width:"1px",height:"16px",background:D.border,flexShrink:0}}/>
          <div style={{flex:1,fontFamily:D.body,fontSize:"13px",fontWeight:500,color:D.textSecondary,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>
            <span style={{marginRight:"3px"}}>{innings[0]?.teamFlag||""}</span>
            <span style={{color:D.sky}}>{match?.team1}</span>
            <span style={{color:D.textMuted,fontSize:"11px"}}> vs </span>
            <span style={{marginRight:"3px"}}>{innings[1]?.teamFlag||""}</span>
            <span style={{color:D.emerald}}>{match?.team2}</span>
            <span style={{color:D.textMuted,fontSize:"11px"}}> · {inn?.overs??match?.overs}ov{inn?.revised&&<span style={{color:D.amber}} title={`revised: ${inn.revised.reason}`}> (revised)</span>}</span>
          </div>
          {/* The pad's menu: today, the theme (DESIGN_DIRECTION §3.1). Ahead
              of Revise so it stays on screen at phone width, where the end
              of this bar runs off the right edge. */}
          <PadMenu/>
          <button onClick={()=>setModal("revise")} className="pressBtn" data-testid="revise-innings" title="Revise overs / target (rain)"
            style={{flexShrink:0,padding:"4px 10px",borderRadius:D.pill,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted}}>
            ☔ Revise
          </button>
          {/* Visible to whoever currently holds the token (to offer it) and
              to whoever's own claim was refused because one is already
              pending (to take it) — anyone else has nothing to do here. */}
          {(attached||sync.reason==="handover_pending"||sync.reason==="verifying")&&(
            <button onClick={()=>setModal("handover")} className="pressBtn" data-testid="open-handover"
              title={sync.reason==="handover_pending"||sync.reason==="verifying"?"A handover is pending — enter the code":"Hand scoring to someone else"}
              style={{flexShrink:0,padding:"4px 10px",borderRadius:D.pill,cursor:"pointer",
                background:sync.reason==="handover_pending"?`${D.amber}14`:"transparent",
                border:`1px solid ${sync.reason==="handover_pending"?D.amber+"55":D.border}`,
                fontFamily:D.head,fontSize:"10px",fontWeight:700,color:sync.reason==="handover_pending"?D.amber:D.textMuted}}>
              ⇄ {sync.reason==="handover_pending"||sync.reason==="verifying"?"Take over":"Handover"}
            </button>
          )}
          {/* Awaiting field prompt */}
          {awaitingField&&(
            <div style={{background:`${D.amber}14`,border:`1px solid ${D.amber}44`,borderRadius:D.pill,padding:"4px 12px",
              fontFamily:D.body,fontSize:"11px",fontWeight:500,color:D.amber,flexShrink:0}}>
              {selShot?ALL_SHOTS.find(s=>s.id===selShot)?.label||"Shot selected":"Select field position"}
            </div>
          )}
          {inn&&(
            <div style={{display:"flex",alignItems:"center",gap:"7px",background:D.surf1,
              border:`1px solid ${D.border}`,borderRadius:D.pill,padding:"4px 13px",flexShrink:0}}>
              <div className="liveDot" style={{width:"6px",height:"6px",borderRadius:"50%",background:D.emerald}}/>
              <span style={{fontFamily:D.mono,fontSize:"14px",fontWeight:500,color:D.textPrimary,letterSpacing:"-0.01em"}}>{inn.runs}/{inn.wickets}</span>
              <span style={{color:D.textMuted,fontSize:"11px",fontFamily:D.mono}}>{fmtOv(inn.balls)}</span>
            </div>
          )}
          <SyncPill sync={sync} storage={saveState.kind} onOpenHeld={()=>setModal("held")}/>
          {/* The score, announced.
              Tapping a key on the pad changes numbers in three places and
              says nothing. For a screen-reader user that is the entire
              feedback loop missing: press "4", hear silence, and have no way
              to know whether the ball registered — on the one screen where
              a missed delivery cannot be reconstructed later.
              aria-live="polite" waits for a pause rather than interrupting,
              and the text is written to be heard rather than read: "142 for
              3, 14.2 overs" is what a scorer would say out loud. */}
          {inn&&(
            <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {`${inn.runs} for ${inn.wickets}, ${fmtOv(inn.balls)} overs`}
            </div>
          )}
        </div>

        {/* Dynamic Content Bar — always visible when match active */}
        {inn&&<DynamicBar inn={inn} match={match} target={target2} isChase={curIn===1} lastOver={lastOverDCB}/>}

        {/* Content */}
        <div style={{maxWidth:"1320px",margin:"0 auto",padding:"16px"}}>
          {/* Not while a sheet is open: the sheet IS the fix in progress, and
              a second button offering the same fix behind it only competes. */}
          {/* Where this pad stands with the server, in words, on every tab:
              signed out, no signal, refused, forked, handed over (SCRBRD-078). */}
          {live&&!modal&&<SyncBanner status={padStatus} match={match} asideCount={asideCount}
            onSignIn={onSignIn&&padStatus?.online?onSignIn:null}
            onRetry={()=>syncRef.current?.attach("open")}
            onScoreHere={()=>syncRef.current?.attach("open")}
            onTakeOver={()=>setModal("handover")}/>}
          {activeTab==="score"&&!modal&&<ScoringBlocked readiness={readiness} onFix={fixBlock}/>}
          {activeTab==="score"&&uiMode==="focus"&&(
            <FocusPad inn={inn} match={match} curIn={curIn} target={target2}
              onCommitDetailed={onCommitDetailed} onWicketCtx={onWicketCtx}
              onWide={onWide} onNoBall={onNoBall}
              onUndo={undoLastBall} onPro={()=>setUiMode("pro")}
              quick={focusQuick} onToggleQuick={()=>setFocusQuick(v=>!v)}/>
          )}
          {activeTab==="score"&&uiMode!=="focus"&&(
            <div className="pro-score-grid">
              {/* Left column: fixed scoring panel */}
              <ScoringPanel
                inn={inn} innings={innings} curIn={curIn} match={match}
                hubStage={hubStage} hubShot={hubShot} hubApproach={hubApproach}
                selSeg={selSeg} freeHit={freeHit}
                fieldView={fieldView} setFieldView={setFieldView}
                hidden={hidden} toggleLine={toggleLine}
                setModal={setModal} scoreKey={scoreKeyRef.current}
                onApproach={onApproach} onShot={onShot} onShotSkip={onShotSkip}
                onFieldSel={onFieldSel} onRun={onRun} onBye={onBye} onLegBye={onLegBye}
                onWicket={onHubWicket} onWide={onWide} onNoBall={onNoBall} onReset={resetHub}
                onBack={onBack} onUndo={undoLastBall}/>
              {/* Right column: draggable cards */}
              <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"6px",padding:"2px 0"}}>
                  <Lbl sx={{color:D.textMuted,fontSize:"9px"}}>⠿ drag cards to reorder</Lbl>
                  <button onClick={()=>setUiMode("focus")} className="pressBtn" style={{marginLeft:"auto",padding:"4px 10px",borderRadius:D.pill,background:D.emerald+"14",border:`1px solid ${D.emerald}33`,color:D.emerald,fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.1em",cursor:"pointer"}}>⚡ FOCUS MODE</button>
                </div>
                {cardOrder.map(cardId=>{
                  const dragProps={
                    draggable:true,
                    onDragStart:e=>handleCardDragStart(e,cardId),
                    onDragOver:e=>handleCardDragOver(e,cardId),
                    onDrop:handleCardDrop,
                    style:{cursor:"grab",transition:"opacity .15s"},
                  };
                  if(cardId==="scoring")return (
                    <div key="scoring" {...dragProps}>
                      <ScorecardPanel innings={innings} idx={curIn}/>
                      {curIn===1&&innings[0]&&<div style={{marginTop:"12px"}}><ScorecardPanel innings={innings} idx={0}/></div>}
                    </div>
                  );
                  if(cardId==="partnership")return (
                    <div key="partnership" {...dragProps}>
                      <PartnershipCard inn={inn}/>
                    </div>
                  );
                  if(cardId==="commentary")return (
                    <div key="commentary" {...dragProps}>
                      <ManhattanChart inn={inn} match={match}/>
                    </div>
                  );
                  return null;
                })}
              </div>
            </div>
          )}
          {activeTab==="cards"&&(
            <div className="sc-grid-2">
              <div><Lbl sx={{marginBottom:"10px"}}>1st Innings</Lbl><ScorecardPanel innings={innings} idx={0}/></div>
              <div>
                <Lbl sx={{marginBottom:"10px"}}>2nd Innings</Lbl>
                {innings[1]
                  ?<ScorecardPanel innings={innings} idx={1}/>
                  :<Card style={{padding:"36px",textAlign:"center"}}><span style={{color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>Not started yet</span></Card>
                }
              </div>
            </div>
          )}
          {activeTab==="analysis"&&<AnalysisDashboard inn={inn} match={match} curIn={curIn} innings={innings}/>}
          {activeTab==="history"&&(
            <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
              {/* Commentary log — shows shot type per ball */}
              <Card>
                <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`}}>
                  <Lbl>Ball-by-Ball Commentary</Lbl>
                </div>
                <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:"6px"}}>
                  {[...(inn?.ballLog||[])].reverse().slice(0,30).map((b,i)=>{
                    const shot=b.shot?ALL_SHOTS.find(s=>s.id===b.shot):null;
                    const seg=b.seg!=null?SEGS[b.seg]:null;
                    return (
                      <div key={i} style={{display:"flex",alignItems:"flex-start",gap:"10px",padding:"8px 0",
                        borderBottom:`1px solid ${D.border}`,opacity:1-i*.025}}>
                        <BallDot ball={b} size={24}/>
                        <div style={{flex:1}}>
                          <div style={{fontFamily:D.body,fontSize:"12px",color:D.textPrimary,fontWeight:500}}>
                            {b.type==="W"?"WICKET — "+(DISMISSAL_LABEL[b.dismissal]??b.dismissal)+(b.outAt?` at the ${b.outAt==="bowler_end"?"bowler's":"striker's"} end`:"")+(b.value?`, ${b.value} run${b.value!==1?"s":""}`:""):
                             b.type==="Wd"?"Wide ball":
                             b.type==="Nb"?`No Ball (${b.nbType?.replace("_"," ")||""}), ${b.value||0}+1 runs${b.nbRuns?` (${b.nbRuns==="leg_byes"?"leg byes":"byes"})`:""}`:
                             b.type==="Pen"?`Penalty ${b.value} runs to ${b.to} team — ${b.reason}`:
                             b.type==="B"?`Bye, ${b.value} run${b.value!==1?"s":""}`:
                             b.type==="LB"?`Leg Bye, ${b.value} run${b.value!==1?"s":""}`:
                             `${b.value} run${b.value!==1?"s":""}`}
                          </div>
                          <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginTop:"2px",display:"flex",gap:"8px",flexWrap:"wrap"}}>
                            {shot&&<span style={{color:shot.color}}>🏏 {shot.label}</span>}
                            {seg&&<span>📍 {seg.label}{b.zone==="boundary"?" · Boundary":b.zone==="outer"?" · Outfield":""}</span>}
                            <span style={{color:D.textMuted}}>Over {(b.over||0)+1}.{(b.ballInOver||0)+1}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {!inn?.ballLog?.length&&<div style={{color:D.textMuted,fontFamily:D.body,fontSize:"13px",padding:"12px"}}>No balls bowled yet.</div>}
                </div>
              </Card>
              {/* Over cards */}
              <Card>
                <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`}}>
                  <Lbl>Over-by-Over</Lbl>
                </div>
                <div style={{padding:"16px",display:"flex",flexWrap:"wrap",gap:"12px"}}>
                  {(inn?.overLog||[]).map((ov,oi)=>{
                    const ovRuns=ov.balls.reduce((s,b)=>s+(b.value||0),0);
                    const hasWkt=ov.balls.some(b=>b.type==="W");
                    const hasBnd=ov.balls.some(b=>b.value===4||b.value===6);
                    return (
                      <div key={oi} style={{minWidth:"130px",background:D.surf2,borderRadius:D.md,padding:"10px 12px",
                        border:`1px solid ${hasWkt?D.rose+"30":hasBnd?D.indigo+"25":D.border}`}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:"7px",alignItems:"center"}}>
                          <Lbl>Ov {ov.over+1}</Lbl>
                          <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textSecondary}}>{ovRuns}r{hasWkt?" W":""}</span>
                        </div>
                        <div style={{display:"flex",gap:"3px",flexWrap:"wrap"}}>
                          {ov.balls.map((b,bi)=><BallDot key={bi} ball={b} size={22}/>)}
                        </div>
                      </div>
                    );
                  })}
                  {!inn?.overLog?.length&&<div style={{color:D.textMuted,fontFamily:D.body,fontSize:"13px"}}>No overs completed.</div>}
                </div>
              </Card>
            </div>
          )}
        </div>

        {/* Stadium Bar */}
        <div style={{position:"fixed",bottom:"20px",left:"50%",transform:"translateX(-50%)",zIndex:150,
          background:D.glass,backdropFilter:"blur(28px) saturate(2)",WebkitBackdropFilter:"blur(28px) saturate(2)",
          border:`1px solid ${D.borderMed}`,borderRadius:D.pill,padding:"6px",display:"flex",gap:"2px",
          boxShadow:`${T.elevation.xl},0 0 0 1px ${T.line.subtle},${T.elevation.sheen}`}}>
          {NAV.map(n=>{
            const active=activeTab===n.id;
            return (
              <button key={n.id} onClick={()=>setActiveTab(n.id)} className="pressBtn" style={{
                display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",
                padding:"9px 22px",borderRadius:D.pill,cursor:"pointer",border:"none",
                background:active?D.grad:"transparent",
                boxShadow:active?`0 4px 20px ${clr(D.indigo,.5)},0 0 28px ${clr(D.indigo,.35)}`:"none",
                transition:"all .3s cubic-bezier(.34,1.56,.64,1)"}}>
                <span style={{fontSize:"16px",lineHeight:1,filter:active?"none":"grayscale(.6) opacity(.7)"}}>{n.icon}</span>
                <span style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:active?T.light.ink:D.textMuted}}>{n.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

export { SCRBRD };
