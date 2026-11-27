/**
 * THE PUPIL'S APP — his passport and his Saturday (redesign step 4, phase A;
 * docs/design/STEP4_parent_pupil.md §2.2): Home (S1, without the check-in
 * card), Matches (S2, opening S3's fixture and the Match Centre), Passport
 * (S3, the Wheel tab included — SCRBRD-102's panel has landed) and Me (S4,
 * without "My body").
 *
 * Everything about HIM comes through his `selfaccess` assignment, which
 * names him and nobody else; everything about the TEAM through `player` —
 * the fixture list, the team sheet, the bus. Neither carries a team-mate's
 * availability, injury, fitness or return date (K3, db/55), and nothing here
 * asks for one: the team sheet is names and places.
 *
 * The words are chosen so a nine-year-old can read them and an
 * eighteen-year-old is not patronised (§1.2).
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { T } from "../../design/tokens.js";
import { useLive, useRatings } from "../../lib/live.js";
import { signedIn } from "../../lib/api.js";
import { humanDate } from "../../lib/format.js";
import { fixturesOf, ownRecordId } from "../../lib/family.js";
import { withOpponents } from "../../lib/matchCentre.js";
import { CareerWagonWheel, DismissalMethodCard } from "../ProfilesView.jsx";
import { Action, Back, Card, Line, NoneOr, Page, Title } from "./parts.jsx";
import { pageName } from "../../lib/backStack.js";
import { ReadState } from "../../ui/primitives.jsx";
import { readState } from "../../lib/readState.js";
import { InjuryLine, LastMatchCard, LiveCard, NewsCard, NextFixtureCard, NoticesCard, SeasonCard, TrainingCard } from "./cards.jsx";
import { ChildMatches, FixtureDetail, MatchFor } from "./matches.jsx";
import { Health, TheirRecord } from "./childfile.jsx";
import { MyLiftLine } from "../lifts.jsx";
import { CaptainCard, captainFixture, useCaptaincy } from "./captain.jsx";
import { TodoCard, useTodoList } from "./todo.jsx";
import { leadOf } from "../../lib/homeLead.js";
import { owes } from "../../lib/todo.js";
import { Compare } from "../compare.jsx";
import { SealMark } from "../../ui/sealMark.jsx";
import { honourWords, isSealed, isWithdrawn, provenanceOf, seasonOnce } from "../../lib/recognitionWords.js";
import { PersonalBests } from "./bests.jsx";
import { SeasonTrend } from "../seasontrend.jsx";
import { RecordBoards } from "../records.jsx";
import { basisWords, careerAverage, childRate } from "../../lib/compare.js";
import { AppointedCard, AppointedOnMatch } from "./scoring.jsx";
import { DsoCard } from "./dso.jsx";
import { EighteenCard, HealthConsentSection } from "../healthconsent.jsx";

// His Skills door (GA-I26a §4, STEP4 item 7): the staff Skills screen, read
// under his own assignments, which reach him alone. Its own chunk, loaded
// only when he opens it, as the staff menu loads it.
const SkillsView = lazy(() => import("../SkillsView.jsx").then((m) => ({ default: m.SkillsView })));

/** The pupil himself, in the shape the shared cards take: his own player row. */
function useSelf(role) {
  const id = ownRecordId();
  const { rows, loading, error } = useLive("players", role);
  const p = id ? rows.find((r) => r.id === id) : null;
  const me = p ? { id: p.id, name: p.name, knownAs: null, team: p.team, school: p.school, schoolName: p.schoolName,
    batHand: p.batHand, bowlStyle: p.bowlStyle, bowlArm: p.bowlArm } : null;
  return { me, loading, error };
}

function NoSelf({ loading, error, testid }) {
  return (
    <Page testid={testid}>
      <Card label="Your record">
        {!signedIn() ? <Line>Sign in to see your record. The demo has no real players.</Line>
          : loading ? <Line quiet>Reading your record…</Line>
          : error ? <Line quiet>Your record would not load. Try again in a moment.</Line>
          : <Line>Your account is not linked to your own record yet. Ask the school office.</Line>}
      </Card>
    </Page>
  );
}

// ── S1 · Home ──────────────────────────────────────────

export function PupilHome({ role, onNav, onOpenScorer }) {
  const { me, loading, error } = useSelf(role);
  // Retry bumps this nonce: the same read again, same role, same params.
  const [nonce, setNonce] = useState(0);
  const matchesRead = useLive("matches", role, nonce);
  const { rows: matches } = matchesRead;
  const [open, setOpen] = useState(null);
  if (!me) return <NoSelf loading={loading} error={error} testid="pupil-home"/>;
  if (open?.kind === "match") {
    return (
      <>
        <AppointedOnMatch role={role} match={open.match} onOpenScorer={onOpenScorer}/>
        <MatchFor match={open.match} child={me} role={role} self matches={matches} backLabel={pageName("myhome")} onBack={() => setOpen(null)}/>
      </>
    );
  }
  if (open?.kind === "fixture") {
    return (
      <Page testid="pupil-home">
        <AppointedOnMatch role={role} match={open.match} onOpenScorer={onOpenScorer}/>
        <FixtureDetail match={open.match} child={me} role={role} self backLabel={pageName("myhome")} onBack={() => setOpen(null)}/>
      </Page>
    );
  }
  return <PupilHomeBody me={me} role={role} onNav={onNav} onOpenScorer={onOpenScorer} matches={matches} matchesRead={matchesRead}
    retry={() => setNonce((n) => n + 1)} setOpen={setOpen}/>;
}

/**
 * His Home (redesign slice 8; the role reviews' direction §2.6, §3.1): one
 * lead, chosen by his match day (lib/homeLead.js), then what is asked of him,
 * then the quiet rest, then the DSO card. Its own component, so the day's
 * reads (hooks) are made for him alone, once he is known.
 */
function PupilHomeBody({ me, role, onNav, onOpenScorer, matches, matchesRead, retry, setOpen }) {
  const now = Date.now();
  // SCRBRD-138 §1.2: the gate, read once here, from his own honour row; nothing server-side widens.
  const { cap } = useCaptaincy(me, role, undefined);
  // GA-I20 A1 (D12): his own list, read once; the lead asks it whether the next fixture's answer is owed.
  const todo = useTodoList({ child: me, matches, matchesRead, now, self: true });
  const next = fixturesOf(matches, me, now).upcoming[0] ?? null;
  // Slice 9: an answer given in the lead keeps the lead where it is for this visit (the row does not move), while the
  // list reads again so its count is true.
  const [answeredHere, setAnsweredHere] = useState(/** @type {string | null} */ (null));
  const owed = owes(todo.t, next?.id) || (next != null && answeredHere === next.id);
  const lead = leadOf({ matches, child: me, now, captain: !!cap && !!captainFixture(me, matches, now), owed });
  const onAnswered = () => { setAnsweredHere(next?.id ?? null); todo.retry(); };
  const toMatch = (m) => setOpen({ kind: "match", match: m });
  const toFixture = (m) => setOpen({ kind: "fixture", match: m });
  const captainCard = (place) => <CaptainCard cap={cap} me={me} role={role} matches={matches} now={now} place={place} onOpen={(m, kind) => setOpen({ kind, match: m })}/>;
  const nextCard = (weight) => (
    <NextFixtureCard child={me} matches={matches} role={role} self now={now} onOpen={toFixture} weight={weight} cardAbove={lead.kind === "captain"} onAnswered={onAnswered}
      said={readState(matchesRead, { what: "the fixtures" })} onRetry={retry}/>
  );
  const lastCard = (weight) => <LastMatchCard child={me} matches={matches} self now={now} onOpen={toMatch} weight={weight}/>;
  return (
    <Page testid="pupil-home">
      <header style={{ display: "grid", gap: "2px" }}>
        <Title testid="pupil-name">{me.name}</Title>
        <Line quiet>{[me.schoolName, me.team].filter(Boolean).join(" · ")}</Line>
        {/* Question 6 (a): his open injury, one quiet line, opening his own Health on Me. */}
        <InjuryLine child={me} role={role} onOpen={onNav ? () => onNav("me") : null}/>
      </header>
      {/* The lead: exactly one block (§2.6). */}
      {lead.kind === "live" && <LiveCard child={me} matches={matches} self now={now} onFollow={toMatch} under={lead.captainUnder ? captainCard("under") : null}/>}
      {lead.kind === "captain" && captainCard("lead")}
      {lead.kind === "result" && lastCard("lead")}
      {(lead.kind === "next" || lead.kind === "none") && nextCard("lead")}
      {/* Then what is asked of him: the fixture (when it did not lead), his list, his appointment, his captain's card. */}
      {lead.kind !== "next" && lead.kind !== "none" && (next || lead.kind !== "live") && nextCard("standard")}
      {/* His answer for the fixture above is not asked twice (§2.6); the count stays the list's own. */}
      <TodoCard todo={todo} matches={matches} lead={next?.id ?? null} onOpen={toFixture}/>
      {/* Q2: appointed to score, he keeps this app; the appointment is a block here. */}
      <AppointedCard role={role} onOpenScorer={onOpenScorer}/>
      {/* SCRBRD-138 C1: on any other day, under his own next fixture (question 5 (a) leads with it only on his match day). */}
      {lead.kind !== "live" && lead.kind !== "captain" && captainCard("card")}
      {/* SCRBRD-124 phase 2 (db/76): his own lifts, for a pupil of eighteen
          still at school (Kameel, 2026-10-01); nothing for anybody younger. */}
      <MyLiftLine/>
      {/* The quiet rest: what there is to read. */}
      {lead.kind !== "result" && lastCard("quiet")}
      <SeasonCard child={me} role={role} self/>
      <TrainingCard child={me} role={role} now={now}/>
      <NoticesCard child={me} role={role} onOpen={onNav ? () => onNav("notifications") : null}/>
      <NewsCard child={me} role={role}/>
      {/* Q7: the DSO card, last. */}
      <DsoCard onRaise={onNav ? () => onNav("safeguarding") : null}/>
    </Page>
  );
}

// ── S2 · Matches ───────────────────────────────────────

export function PupilMatches({ role }) {
  const { me, loading, error } = useSelf(role);
  if (!me) return <NoSelf loading={loading} error={error} testid="pupil-matches"/>;
  // RECOGNITION R9 (D23): his side's record boards as a pavilion board shows
  // them — the holders and former holders, never an ordered list of his side
  // (the read sends him none).
  return (
    <Page testid="pupil-matches">
      <ChildMatches child={me} role={role} self/>
      <RecordBoards role={role} school={me.school} side={me.team} testid="pupil-records"/>
    </Page>
  );
}

// ── S3 · Passport ──────────────────────────────────────

// "Compare" is GA-I24-I25 D10 (Q1, Kameel 8 Oct 2026): himself against one
// team-mate on his own side, figures only, the floor, no verdict.
const TABS = [["season", "Season"], ["career", "Career"], ["wheel", "Wagon wheel"], ["honours", "Honours"], ["compare", "Compare"]];
const hand = (h) => (h === "L" ? "left-hand bat" : h === "R" ? "right-hand bat" : null);

/** One figure on the passport board: the figure in the figure face, its name under it. */
function Fig({ k, v, testid }) {
  return (
    <div style={{ display: "grid", gap: "2px", minWidth: "72px" }}>
      <span data-testid={testid} style={{ ...T.role.figure.lg, color: T.board.figure }}>{v}</span>
      <span style={{ ...T.role.label, color: T.board.dim }}>{k}</span>
    </div>
  );
}

/**
 * The passport (§2.2 S3): his career on a black board, figures first, then
 * four tabs. Everything is his — his career row, his caps line, his seasons,
 * his wheel, his honours — read under his own selfaccess or his side's
 * profile read and narrowed to him.
 */
export function PupilPassport({ role }) {
  const { me, loading, error } = useSelf(role);
  const [tab, setTab] = useState("season");
  const [nonce, setNonce] = useState(0);
  const careerRead = useLive("career", role, nonce);
  const { rows: career } = careerRead;
  if (!me) return <NoSelf loading={loading} error={error} testid="pupil-passport"/>;
  const c = career.find((r) => r.id === me.id) ?? null;
  return (
    <Page testid="pupil-passport">
      <header style={{ display: "grid", gap: "2px" }}>
        <h1 style={{ ...T.role.title.lg, color: T.content.primary, margin: 0 }}>{me.name}</h1>
        <Line quiet>{[me.schoolName, me.team, hand(me.batHand)].filter(Boolean).join(" · ")}</Line>
      </header>
      <PassportBoard me={me} role={role} c={c} careerRead={careerRead} onRetry={() => setNonce((n) => n + 1)}/>
      <TabRow>
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} data-testid={`passport-tab-${id}`}
            onClick={() => setTab(id)} className="os-state"
            style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, cursor: "pointer", background: "transparent", border: "none",
              borderBottom: `2px solid ${tab === id ? T.brand.accentText : "transparent"}`, marginBottom: "-1px",
              color: tab === id ? T.content.primary : T.content.secondary, ...T.role.control, fontSize: "15px", fontWeight: tab === id ? 600 : 500 }}>
            {label}
          </button>
        ))}
      </TabRow>
      <div role="tabpanel" data-testid={`passport-panel-${tab}`} style={{ display: "grid", gap: T.space.md }}>
        {tab === "season" && <SeasonTab me={me} role={role} career={c}/>}
        {tab === "career" && <CareerTab me={me} role={role} career={c} careerRead={careerRead} onRetry={() => setNonce((n) => n + 1)}/>}
        {tab === "wheel" && <CareerWagonWheel player={{ id: me.id, name: me.name, batHand: me.batHand }} role={role}/>}
        {tab === "honours" && <HonoursTab me={me} role={role}/>}
        {tab === "compare" && <Compare role={role} self={{ id: me.id, name: me.name, team: me.team, school: me.school }}/>}
      </div>
    </Page>
  );
}

/**
 * The passport's tab row (C15): five tabs that do not fit a phone scroll
 * sideways, and the row says so. While more lies off either edge, a chevron
 * stands beside that edge, in a slot of its own, never over a tab; at the
 * end the slot is empty. It takes no tap and does not move.
 */
function TabRow({ children }) {
  const row = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [more, setMore] = useState({ left: false, right: false });
  const measure = () => {
    const el = row.current;
    if (!el) return;
    const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  };
  useEffect(() => {
    measure();
    globalThis.addEventListener?.("resize", measure);
    return () => globalThis.removeEventListener?.("resize", measure);
  }, []);
  // Each hint has a slot of its own beside the row, never over it (CI's narrow walk: a tab under the
  // chevron is one a pupil taps thinking it is the chevron). Both slots are always kept, so showing a
  // chevron moves no tab. Decorative: aria-hidden, takes no tap; 16px, above the 12px floor.
  const slot = (side) => ({ flex: "0 0 24px", width: "24px", pointerEvents: "none", display: "flex", alignItems: "center",
    justifyContent: side === "right" ? "flex-end" : "flex-start", color: T.content.secondary, fontSize: "16px", userSelect: "none" });
  return (
    <div style={{ display: "flex", alignItems: "stretch", minWidth: 0, borderBottom: `1px solid ${T.line.normal}` }} data-testid="passport-tabs"
      data-more-left={more.left || undefined} data-more-right={more.right || undefined}>
      <span aria-hidden="true" style={slot("left")}>{more.left && <span data-testid="passport-tabs-more-left">‹</span>}</span>
      <div ref={row} role="tablist" aria-label="Passport" onScroll={measure}
        style={{ flex: "1 1 auto", minWidth: 0, display: "flex", gap: T.space.xs, overflowX: "auto", scrollbarWidth: "thin" }}>
        {children}
      </div>
      <span aria-hidden="true" style={slot("right")}>{more.right && <span data-testid="passport-tabs-more-right">›</span>}</span>
    </div>
  );
}

/** One rate on the board, or the count and the word in its place (Q12). */
function RateFig({ k, r, testid }) {
  return (
    <span data-testid={testid} data-held={r.held ? "true" : "false"}>
      {k} {r.held ? <span style={{ ...T.role.body, fontSize: "14px", color: T.board.dim }}>{r.text}</span> : r.text}
    </span>
  );
}

/** The passport's board: his career, figures first, on the black board (§2.2 S3, §1). His caps line from his side's ledger. */
function PassportBoard({ me, role, c, careerRead, onRetry }) {
  const { rows: caps } = useLive("caps", role, 0, { teamCode: me.team });
  // His figures are drawn only of a career read that answered. A read that
  // failed is not a boy who has scored nothing, and a figure of 0 would say so.
  const careerSaid = readState(careerRead, { what: "your career figures" });
  const careerAnswered = careerSaid.state === "ok" || careerSaid.state === "empty";
  const cap = caps.find((r) => r.playerId === me.id) ?? null;
  return (
      <section data-testid="passport-board" aria-label="Your career figures"
        style={{ background: T.board.face, border: `1px solid ${T.board.rule}`, borderRadius: T.radius.lg,
          padding: `${T.space.md} ${T.space.lg}`, display: "grid", gap: T.space.md }}>
        <div style={{ display: "flex", gap: T.space.xl, flexWrap: "wrap" }}>
          {cap && <Fig k="Caps" v={cap.appearances ?? cap.capNo} testid="passport-caps"/>}
          <Fig k="Runs" v={c ? c.runs : careerAnswered ? 0 : "—"} testid="passport-runs"/>
          <Fig k="Wickets" v={c ? c.wkts : careerAnswered ? 0 : "—"} testid="passport-wickets"/>
        </div>
        <div style={{ display: "flex", gap: T.space.lg, flexWrap: "wrap", ...T.role.figure.md, color: T.board.figure }}>
          {c ? (
            <>
              <RateFig k="Average" r={careerAverage(c)} testid="passport-avg"/>
              <RateFig k="Strike rate" r={childRate(c.sr, c.ballsFaced)} testid="passport-sr"/>
              <RateFig k="Economy" r={childRate(c.econ, c.ballsBowled)} testid="passport-econ"/>
            </>
          ) : <><span>Average —</span><span>Strike rate —</span><span>Economy —</span></>}
        </div>
        {c && <span data-testid="passport-basis" style={{ ...T.role.body, fontSize: "14px", color: T.board.dim }}>{basisWords(c)}</span>}
        {!careerAnswered && <ReadState compact onBoard read={careerSaid} onRetry={onRetry} testId="passport-career-read-state"/>}
        {cap && <span style={{ ...T.role.body, fontSize: "14px", color: T.board.dim }}>Cap {cap.capNo} · {me.team} · first played {humanDate(cap.firstOn)}</span>}
      </section>
  );
}

function SeasonTab({ me, role, career }) {
  const [nonce, setNonce] = useState(0);
  const seasonsRead = useLive("career_by_season", role, nonce);
  const { rows } = seasonsRead;
  const seasons = rows.filter((r) => r.id === me.id).sort((a, b) => String(b.season ?? "").localeCompare(String(a.season ?? "")));
  return (
    <>
      {seasons.length ? seasons.map((s) => (
        <Card key={s.season ?? "?"} label={`Season ${s.season ?? ""}${s.currentSeason ? " · this season" : ""}`} testid="passport-season">
          <p style={{ ...T.role.figure.sm, fontSize: "16px", color: T.content.primary, margin: 0 }}>
            {s.innings} innings · {s.runs} runs · average {careerAverage(s).held ? `(${careerAverage(s).text})` : careerAverage(s).text}{careerAverage(s).held || /balls not recorded/.test(careerAverage(s).text) ? "" : ` · ${careerAverage(s).count}`}
          </p>
          {s.ballsBowled > 0 && <p style={{ ...T.role.figure.sm, fontSize: "16px", color: T.content.primary, margin: 0 }}>{s.wkts} wickets · economy {childRate(s.econ, s.ballsBowled).text}{childRate(s.econ, s.ballsBowled).held ? "" : ` · ${childRate(s.econ, s.ballsBowled).count}`}</p>}
        </Card>
      )) : <NoneOr read={seasonsRead} what="your seasons" none="No seasons yet. Play a match and it shows here." onRetry={() => setNonce((n) => n + 1)} testid="passport-season-none"/>}
      {/* GA-I23 slice 2 (B2, B5): his own season, innings by innings, read
          through his own self link; a team-mate's he never reads (Q7). */}
      {/* Quiet when he has no innings at all, as the family Home is. */}
      {signedIn() && (
        <SeasonTrend role={role} playerId={me.id} who="You" self bare quietWhenNone
          frame={(panel) => <Card label="Innings by innings" testid="passport-trend">{panel}</Card>}/>
      )}
      {career?.form?.length > 0 && (
        <Card label="Your last innings · newest first" testid="passport-form">
          <p style={{ ...T.role.figure.sm, fontSize: "16px", color: T.content.primary, margin: 0 }}>{career.form.join(" · ")}</p>
        </Card>
      )}
    </>
  );
}

function CareerTab({ me, role, career, careerRead, onRetry }) {
  const breakdown = useLive("dismissal_breakdown", role);
  return (
    <>
      <Card label="Career" testid="passport-career">
        {career ? (
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: T.space.md }}>
            {[["Innings", career.innings], ["Runs", career.runs], ["Balls faced", childRate(null, career.ballsFaced).count],
              ["Average", careerAverage(career)], ["Strike rate", childRate(career.sr, career.ballsFaced)],
              ["Wickets", career.wkts], ["Balls bowled", childRate(null, career.ballsBowled).count],
              ["Economy", childRate(career.econ, career.ballsBowled)], ["Bowling average", childRate(career.bowlAvg, career.ballsBowled)]].map(([k, v]) => {
              const held = typeof v === "object" && v !== null && v.held;
              const shown = typeof v === "object" && v !== null ? v.text : v;
              return (
                <div key={k}>
                  <dt style={{ ...T.role.label, color: T.content.secondary }}>{k}</dt>
                  <dd data-figure={k} data-held={held ? "true" : undefined}
                    style={{ ...(held ? { ...T.role.body, fontSize: "14px", color: T.content.secondary } : { ...T.role.figure.md, color: T.content.primary }), margin: 0 }}>{shown}</dd>
                </div>
              );
            })}
          </dl>
        ) : <NoneOr read={careerRead} what="your career" none="No innings yet. Your first one will show here." onRetry={onRetry} testid="passport-career-none"/>}
      </Card>
      <DismissalMethodCard title="How you're out" testId="passport-how-out" color={T.sport.batting} live={breakdown}
        playerId={me.id} side="batting" emptyMessage="You have not been out yet."/>
      <DismissalMethodCard title="How you take wickets" testId="passport-how-wickets" color={T.sport.bowling} live={breakdown}
        playerId={me.id} side="bowling" emptyMessage="No wickets yet."/>
    </>
  );
}

function HonoursTab({ me, role }) {
  // Retry bumps this nonce; the read keeps its { playerId } param, so it asks
  // for the same boy again and nobody else.
  const [nonce, setNonce] = useState(0);
  const recRead = useLive("recognition", role, nonce, { playerId: me.id });
  const { rows: matches } = useLive("matches", role);
  // His own end of each fixture names the opponent (the server's is the host's).
  const rec = withOpponents(recRead.rows, matches);
  const { rows: lines } = useLive("passport", role, 0, { playerId: me.id });
  const miles = rec.filter((r) => r.family === "milestone");
  const honours = rec.filter((r) => r.family !== "milestone");
  return (
    <>
      {/* RECOGNITION R5 (D23, D24): his own bests, School Records first. */}
      <PersonalBests role={role} playerId={me.id} who="Your" testid="passport-bests"/>
      <Card label="Milestones" testid="passport-milestones">
        {miles.length ? miles.map((m, i) => {
          // Where it came from (R4): the seal's mark beside its words, and
          // "from the scorebook" for a card read off a book (D6, §7).
          const said = provenanceOf(m);
          return (
            <Line key={`${m.kind}-${i}`} testid="passport-milestone">
              <SealMark sealed={isSealed(m)} testid="passport-milestone-seal"/>{" "}
              {m.label}{m.opponent ? ` · v ${m.opponent}` : ""}{m.on ? ` · ${humanDate(m.on)}` : ""}
              {said.length > 0 && <span style={{ color: T.content.secondary }} data-testid="passport-milestone-source"> · {said.join(" · ")}</span>}
            </Line>
          );
        }) : <NoneOr read={recRead} what="your milestones" none="No milestones yet. They show here when you reach one." onRetry={() => setNonce((n) => n + 1)} testid="passport-milestones-none"/>}
      </Card>
      <Card label="Honours and caps" testid="passport-honours">
        {honours.length ? honours.map((h, i) => (
          // A withdrawn honour stays on his own passport, its date and no
          // reason (D3, D4): "Half colours 2026 · withdrawn 3 Oct 2026".
          isWithdrawn(h)
            ? <Line key={`${h.family}-${h.kind}-${i}`} quiet testid="passport-honour-withdrawn">{honourWords(h)}</Line>
            : <Line key={`${h.family}-${h.kind}-${i}`}>{h.label}{seasonOnce(h) ? ` · ${seasonOnce(h)}` : h.season ? "" : h.on ? ` · ${humanDate(h.on)}` : ""}</Line>
        )) : <NoneOr read={recRead} what="your honours" none="No honours yet. They show here when you earn one." onRetry={() => setNonce((n) => n + 1)} testid="passport-honours-none"/>}
      </Card>
      {lines.length > 0 && (
        <Card label="Also on your passport" testid="passport-lines">
          {lines.map((l, i) => (
            <Line key={`${l.family}-${i}`}>{l.label}: {l.value}<span style={{ color: T.content.secondary }}> · {[l.confidence, l.source, l.on].filter(Boolean).join(" · ")}</span></Line>
          ))}
        </Card>
      )}
    </>
  );
}

// ── S4 · Me ────────────────────────────────────────────

/**
 * His own file (§2.2 S4): his health at every tier, his ratings, his record
 * behind a tap, and his conduct record on request and never on Home (§9 Q6).
 * "My body" waits for SCRBRD-110's check-ins (phase E); the consents he will
 * read here are phase B's.
 */
export function PupilMe({ role, onNav }) {
  const { me, loading, error } = useSelf(role);
  const [show, setShow] = useState({ record: false, conduct: false, skills: false });
  // One answer, two places (as Settings → Me had it): the eighteen card and his own row redraw together.
  const [consentNonce, setConsentNonce] = useState(0);
  const consentChanged = () => setConsentNonce((n) => n + 1);
  if (!me) return <NoSelf loading={loading} error={error} testid="pupil-me"/>;
  // His skills, every score with its date and any target his coach set: the
  // Skills screen, opened from his ratings card rather than a fifth item on
  // the bar (STEP4 §2.0: four items; every other screen from a card on them).
  // What it draws for him is GA-I26a §4.4's: himself alone, "your coach",
  // no Set target, no Why, no notes and no coaching point.
  if (show.skills) return (
    <div data-testid="pupil-skills" style={{ display: "grid", gap: "12px", alignContent: "start" }}>
      <div style={{ padding: "16px 16px 0" }}><Back testid="skills-back" onClick={() => setShow((s) => ({ ...s, skills: false }))}>{pageName("me")}</Back></div>
      <Suspense fallback={<Page><Line quiet>Opening your skills…</Line></Page>}>
        <SkillsView role={role}/>
      </Suspense>
    </div>
  );
  return (
    <Page testid="pupil-me">
      <Title>Me</Title>
      {/* Q16: the eighteen card and his own health-monitoring row live on his Me (EXPERIENCE_PASS §1.6). */}
      <EighteenCard role={role} nonce={consentNonce} onChanged={consentChanged}/>
      <Card label="My health" testid="me-health"><Health child={me} role={role} self/></Card>
      <HealthConsentSection role={role} playerId={me.id} nonce={consentNonce} onChanged={consentChanged}/>
      <Card label="My ratings" testid="me-ratings"
        aside={<Action testid="me-skills-open" onClick={() => setShow((s) => ({ ...s, skills: true }))}>Your skills</Action>}>
        <MyRatings me={me} role={role}/>
      </Card>
      <Card label="My record" testid="me-record"
        aside={!show.record && <Action testid="me-record-show" onClick={() => setShow((s) => ({ ...s, record: true }))}>Show</Action>}>
        {show.record ? <TheirRecord child={me} role={role} self/> : <Line quiet>Your date of birth and address, as the school has them. For your ID number, ask the school office.</Line>}
      </Card>
      <Card label="Your conduct record" testid="me-conduct"
        aside={!show.conduct && <Action testid="me-conduct-show" onClick={() => setShow((s) => ({ ...s, conduct: true }))}>Show</Action>}>
        {show.conduct ? <MyConduct me={me} role={role}/> : <Line quiet>Anything the school has recorded about your conduct. Yours to read.</Line>}
      </Card>
      {onNav && <div><Action testid="me-settings" onClick={() => onNav("settings")}>Settings: dark or light, colours, devices</Action></div>}
    </Page>
  );
}

function MyRatings({ me, role }) {
  const { ratings, loading, error } = useRatings(role);
  const r = ratings[me.id];
  if (loading && !r) return <Line quiet>Reading your ratings…</Line>;
  if (error) return <Line quiet>Your ratings would not load. Try again in a moment.</Line>;
  const bits = r ? [["Batting", r.batting?.value], ["Bowling", r.bowling?.value]].filter(([, v]) => v != null) : [];
  if (!bits.length) return <Line quiet>Your coach has not rated you yet.</Line>;
  return (
    <p data-testid="me-ratings-line" style={{ ...T.role.figure.sm, fontSize: "16px", color: T.content.primary, margin: 0 }}>
      {bits.map(([k, v]) => `${k} ${Number(v).toFixed(1)}`).join(" · ")} <span style={{ ...T.role.body, color: T.content.secondary }}>(out of 20)</span>
    </p>
  );
}

function MyConduct({ me, role }) {
  const { rows, loading, error } = useLive("disciplinary_records", role);
  const mine = rows.filter((m) => m.playerId === me.id);
  if (loading && !rows.length) return <Line quiet>Loading…</Line>;
  if (error) return <Line quiet>This would not load. Try again in a moment.</Line>;
  if (!mine.length) return <Line testid="me-conduct-none">Nothing has been recorded.</Line>;
  return mine.map((m) => (
    <div key={m.id} data-testid={`me-matter-${m.id}`} style={{ border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, padding: T.space.md, display: "grid", gap: "2px" }}>
      <span style={{ ...T.role.label, color: T.content.secondary }}>{humanDate(m.occurredOn)} · {m.state}</span>
      <span style={{ ...T.role.body, color: T.content.primary }}>{m.body}</span>
      {m.outcome && <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>Outcome: {m.outcome}</span>}
    </div>
  ));
}
