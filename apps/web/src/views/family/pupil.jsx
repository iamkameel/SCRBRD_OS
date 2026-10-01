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
import { useState } from "react";
import { T } from "../../design/tokens.js";
import { useLive, useRatings } from "../../lib/live.js";
import { signedIn } from "../../lib/api.js";
import { humanDate, stat } from "../../lib/format.js";
import { ownRecordId } from "../../lib/family.js";
import { CareerWagonWheel, DismissalMethodCard } from "../ProfilesView.jsx";
import { Action, Card, Line, Page, Title } from "./parts.jsx";
import { LastMatchCard, LiveCard, NextFixtureCard, NoticesCard, SeasonCard, TrainingCard } from "./cards.jsx";
import { ChildMatches, FixtureDetail, MatchFor } from "./matches.jsx";
import { Health, TheirRecord } from "./childfile.jsx";

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
        {!signedIn() ? <Line>Sign in to see your own record. The demonstration holds nobody's.</Line>
          : loading ? <Line quiet>Reading your record…</Line>
          : error ? <Line quiet>Could not load your record just now.</Line>
          : <Line>Your account is not linked to your own record yet. Ask the school office.</Line>}
      </Card>
    </Page>
  );
}

// ── S1 · Home ──────────────────────────────────────────

export function PupilHome({ role }) {
  const { me, loading, error } = useSelf(role);
  const { rows: matches } = useLive("matches", role);
  const [open, setOpen] = useState(null);
  if (!me) return <NoSelf loading={loading} error={error} testid="pupil-home"/>;
  if (open?.kind === "match") return <MatchFor match={open.match} child={me} role={role} self matches={matches} onBack={() => setOpen(null)}/>;
  if (open?.kind === "fixture") return <Page testid="pupil-home"><FixtureDetail match={open.match} child={me} role={role} self onBack={() => setOpen(null)}/></Page>;
  const now = Date.now();
  return (
    <Page testid="pupil-home">
      <header style={{ display: "grid", gap: "2px" }}>
        <Title testid="pupil-name">{me.name}</Title>
        <Line quiet>{[me.schoolName, me.team].filter(Boolean).join(" · ")}</Line>
      </header>
      <NextFixtureCard child={me} matches={matches} role={role} self now={now} onOpen={(m) => setOpen({ kind: "fixture", match: m })}/>
      <LiveCard child={me} matches={matches} self now={now} onFollow={(m) => setOpen({ kind: "match", match: m })}/>
      <LastMatchCard child={me} matches={matches} self now={now} onOpen={(m) => setOpen({ kind: "match", match: m })}/>
      <SeasonCard child={me} role={role} self/>
      <TrainingCard child={me} role={role} now={now}/>
      <NoticesCard child={me} role={role}/>
    </Page>
  );
}

// ── S2 · Matches ───────────────────────────────────────

export function PupilMatches({ role }) {
  const { me, loading, error } = useSelf(role);
  if (!me) return <NoSelf loading={loading} error={error} testid="pupil-matches"/>;
  return <Page testid="pupil-matches"><ChildMatches child={me} role={role} self/></Page>;
}

// ── S3 · Passport ──────────────────────────────────────

const TABS = [["season", "Season"], ["career", "Career"], ["wheel", "Wheel"], ["honours", "Honours"]];
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
  const { rows: career } = useLive("career", role);
  if (!me) return <NoSelf loading={loading} error={error} testid="pupil-passport"/>;
  const c = career.find((r) => r.id === me.id) ?? null;
  return (
    <Page testid="pupil-passport">
      <header style={{ display: "grid", gap: "2px" }}>
        <h1 style={{ ...T.role.title.lg, color: T.content.primary, margin: 0 }}>{me.name}</h1>
        <Line quiet>{[me.schoolName, me.team, hand(me.batHand)].filter(Boolean).join(" · ")}</Line>
      </header>
      <PassportBoard me={me} role={role} c={c}/>
      <div role="tablist" aria-label="Passport" style={{ display: "flex", gap: T.space.xs, overflowX: "auto", borderBottom: `1px solid ${T.line.normal}` }}>
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} data-testid={`passport-tab-${id}`}
            onClick={() => setTab(id)} className="os-state"
            style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, cursor: "pointer", background: "transparent", border: "none",
              borderBottom: `2px solid ${tab === id ? T.brand.accentText : "transparent"}`, marginBottom: "-1px",
              color: tab === id ? T.content.primary : T.content.secondary, ...T.role.control, fontSize: "15px", fontWeight: tab === id ? 600 : 500 }}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" data-testid={`passport-panel-${tab}`} style={{ display: "grid", gap: T.space.md }}>
        {tab === "season" && <SeasonTab me={me} role={role} career={c}/>}
        {tab === "career" && <CareerTab me={me} role={role} career={c}/>}
        {tab === "wheel" && <CareerWagonWheel player={{ id: me.id, name: me.name, batHand: me.batHand }} role={role}/>}
        {tab === "honours" && <HonoursTab me={me} role={role}/>}
      </div>
    </Page>
  );
}

/** The passport's board: his career, figures first, on the black board (§2.2 S3, §1). His caps line from his side's ledger. */
function PassportBoard({ me, role, c }) {
  const { rows: caps } = useLive("caps", role, 0, { teamCode: me.team });
  const cap = caps.find((r) => r.playerId === me.id) ?? null;
  return (
      <section data-testid="passport-board" aria-label="Your career, in figures"
        style={{ background: T.board.face, border: `1px solid ${T.board.rule}`, borderRadius: T.radius.lg,
          padding: `${T.space.md} ${T.space.lg}`, display: "grid", gap: T.space.md }}>
        <div style={{ display: "flex", gap: T.space.xl, flexWrap: "wrap" }}>
          {cap && <Fig k="Caps" v={cap.appearances ?? cap.capNo} testid="passport-caps"/>}
          <Fig k="Runs" v={c ? c.runs : 0} testid="passport-runs"/>
          <Fig k="Wickets" v={c ? c.wkts : 0} testid="passport-wickets"/>
        </div>
        <div style={{ display: "flex", gap: T.space.lg, flexWrap: "wrap", ...T.role.figure.md, color: T.board.figure }}>
          <span>AVG {stat(c?.avg)}</span><span>SR {stat(c?.sr)}</span><span>ECON {stat(c?.econ)}</span>
        </div>
        {cap && <span style={{ ...T.role.body, fontSize: "14px", color: T.board.dim }}>Cap {cap.capNo} · {me.team} · first {humanDate(cap.firstOn)}</span>}
      </section>
  );
}

function SeasonTab({ me, role, career }) {
  const { rows } = useLive("career_by_season", role);
  const seasons = rows.filter((r) => r.id === me.id).sort((a, b) => String(b.season ?? "").localeCompare(String(a.season ?? "")));
  return (
    <>
      {seasons.length ? seasons.map((s) => (
        <Card key={s.season ?? "?"} label={`Season ${s.season ?? ""}${s.currentSeason ? " · this season" : ""}`} testid="passport-season">
          <p style={{ ...T.role.figure.sm, fontSize: "16px", color: T.content.primary, margin: 0 }}>
            {s.innings} inns · {s.runs} runs · avg {stat(s.avg)}
          </p>
          {s.ballsBowled > 0 && <p style={{ ...T.role.figure.sm, fontSize: "16px", color: T.content.primary, margin: 0 }}>{s.wkts} wkts · econ {stat(s.econ)}</p>}
        </Card>
      )) : <Line quiet>No season on record yet.</Line>}
      {career?.form?.length > 0 && (
        <Card label="Form · last innings first" testid="passport-form">
          <p style={{ ...T.role.figure.sm, fontSize: "16px", color: T.content.primary, margin: 0 }}>{career.form.join(" · ")}</p>
        </Card>
      )}
    </>
  );
}

function CareerTab({ me, role, career }) {
  const breakdown = useLive("dismissal_breakdown", role);
  return (
    <>
      <Card label="Career" testid="passport-career">
        {career ? (
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: T.space.md }}>
            {[["Innings", career.innings], ["Runs", career.runs], ["Average", stat(career.avg)], ["Strike rate", stat(career.sr)],
              ["Wickets", career.wkts], ["Economy", stat(career.econ)], ["Bowling average", stat(career.bowlAvg)]].map(([k, v]) => (
              <div key={k}>
                <dt style={{ ...T.role.label, color: T.content.secondary }}>{k}</dt>
                <dd style={{ ...T.role.figure.md, color: T.content.primary, margin: 0 }}>{v}</dd>
              </div>
            ))}
          </dl>
        ) : <Line quiet>No innings on record yet.</Line>}
      </Card>
      <DismissalMethodCard title="How you're out" testId="passport-how-out" color={T.sport.batting} live={breakdown}
        playerId={me.id} side="batting" emptyMessage="You have not been out yet."/>
      <DismissalMethodCard title="How you take wickets" testId="passport-how-wickets" color={T.sport.bowling} live={breakdown}
        playerId={me.id} side="bowling" emptyMessage="No wickets yet."/>
    </>
  );
}

function HonoursTab({ me, role }) {
  const { rows: rec } = useLive("recognition", role, 0, { playerId: me.id });
  const { rows: lines } = useLive("passport", role, 0, { playerId: me.id });
  const miles = rec.filter((r) => r.family === "milestone");
  const honours = rec.filter((r) => r.family !== "milestone");
  return (
    <>
      <Card label="Milestones" testid="passport-milestones">
        {miles.length ? miles.map((m, i) => (
          <Line key={`${m.kind}-${i}`}>{m.label}{m.opponent ? ` · v ${m.opponent}` : ""}{m.on ? ` · ${humanDate(m.on)}` : ""}</Line>
        )) : <Line quiet>No milestone yet.</Line>}
      </Card>
      <Card label="Honours and caps" testid="passport-honours">
        {honours.length ? honours.map((h, i) => (
          <Line key={`${h.family}-${h.kind}-${i}`}>{h.label}{h.season ? ` · ${h.season}` : h.on ? ` · ${humanDate(h.on)}` : ""}</Line>
        )) : <Line quiet>None on record yet.</Line>}
      </Card>
      {lines.length > 0 && (
        <Card label="Passport lines" testid="passport-lines">
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
  const [show, setShow] = useState({ record: false, conduct: false });
  if (!me) return <NoSelf loading={loading} error={error} testid="pupil-me"/>;
  return (
    <Page testid="pupil-me">
      <Title>Me</Title>
      <Card label="My health" testid="me-health"><Health child={me} role={role} self/></Card>
      <Card label="My ratings" testid="me-ratings"><MyRatings me={me} role={role}/></Card>
      <Card label="My record" testid="me-record"
        aside={!show.record && <Action testid="me-record-show" onClick={() => setShow((s) => ({ ...s, record: true }))}>Show</Action>}>
        {show.record ? <TheirRecord child={me} role={role}/> : <Line quiet>Your date of birth, address and ID number, as the school holds them.</Line>}
      </Card>
      <Card label="Conduct matters" testid="me-conduct"
        aside={!show.conduct && <Action testid="me-conduct-show" onClick={() => setShow((s) => ({ ...s, conduct: true }))}>Show</Action>}>
        {show.conduct ? <MyConduct me={me} role={role}/> : <Line quiet>Anything the school has recorded about your conduct. Yours to read.</Line>}
      </Card>
      {onNav && <div><Action testid="me-settings" onClick={() => onNav("settings")}>Settings: theme, colours, devices</Action></div>}
    </Page>
  );
}

function MyRatings({ me, role }) {
  const { ratings, loading, error } = useRatings(role);
  const r = ratings[me.id];
  if (loading && !r) return <Line quiet>Reading your ratings…</Line>;
  if (error) return <Line quiet>Could not load your ratings just now.</Line>;
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
  if (loading && !rows.length) return <Line quiet>Reading…</Line>;
  if (error) return <Line quiet>Could not load this just now.</Line>;
  if (!mine.length) return <Line testid="me-conduct-none">Nothing is on record.</Line>;
  return mine.map((m) => (
    <div key={m.id} data-testid={`me-matter-${m.id}`} style={{ border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, padding: T.space.md, display: "grid", gap: "2px" }}>
      <span style={{ ...T.role.label, color: T.content.secondary }}>{humanDate(m.occurredOn)} · {m.state}</span>
      <span style={{ ...T.role.body, color: T.content.primary }}>{m.body}</span>
      {m.outcome && <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>Outcome: {m.outcome}</span>}
    </div>
  ));
}
