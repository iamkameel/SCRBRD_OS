/**
 * THE FAMILY APP — the parent's four destinations (redesign step 4, phase A;
 * docs/design/STEP4_parent_pupil.md §2.1): Home (P1), Matches (P2, opening
 * P3 and P4), Notices (P5) and Family (P6, with P7a and P7b).
 *
 * A parent's screen is about one child and is calm (DESIGN_DIRECTION §6).
 * The children come from `my_children` (G1) — her own live guardian links
 * and nothing else — and the switcher (§3.1) shows one child per Home: every
 * card below is handed that child and narrows what it reads to him, so
 * nothing on the screen names another child, even for a parent whose staff
 * role reads the whole side.
 *
 * NOTHING HERE DECIDES ACCESS. Every read is the server's, under the
 * reader's own policy; the screens only choose what to draw.
 */
import { useState } from "react";
import { T } from "../../design/tokens.js";
import { useLive } from "../../lib/live.js";
import { signedIn } from "../../lib/api.js";
import { useNav } from "../../lib/features.js";
import { humanDate } from "../../lib/format.js";
import { tenantWords } from "../../lib/words.js";
import { chooseChild, recallChild, rememberChild } from "../../lib/family.js";
import { Card, ChildSwitcher, Line, NoneOr, Page, Title } from "./parts.jsx";
import { readState } from "../../lib/readState.js";
import { LastMatchCard, LiveCard, NextFixtureCard, NoticesCard, SeasonCard } from "./cards.jsx";
import { ChildMatches, FixtureDetail, MatchFor } from "./matches.jsx";
import { ChildFileCard } from "./childfile.jsx";
import { LiftsToday } from "../lifts.jsx";
import { TodoCard } from "./todo.jsx";

/** The children this parent answers for, the one chosen, and the fixture list the cards share. */
function useChildren(role) {
  // Retry bumps this nonce: the same two reads again, same role, same params.
  const [nonce, setNonce] = useState(0);
  const { rows: kids, loading, error } = useLive("my_children", role, nonce);
  const matchesRead = useLive("matches", role, nonce);
  const { rows: matches } = matchesRead;
  const [picked, setPicked] = useState(recallChild);
  const child = chooseChild(kids, matches, picked, Date.now());
  const choose = (c) => { rememberChild(c.id); setPicked(c.id); };
  // "No fixture is arranged" is said only of a fixtures read that answered.
  const matchesSaid = readState(matchesRead, { what: "the fixtures" });
  // matchesRead is the whole read: the To-do card takes { loading, error } from it, the next-fixture card the sentence.
  return { kids, child, choose, loading, error, matches, matchesRead, matchesSaid, retry: () => setNonce((n) => n + 1) };
}

/** What a family screen says when there is no child to show — and why, honestly. */
function NoChild({ loading, error, testid }) {
  return (
    <Page testid={testid}>
      <Card label="Family" testid="family-none">
        {!signedIn() ? <Line>Sign in to see your family. The demonstration holds no family's records.</Line>
          : loading ? <Line quiet>Reading your family…</Line>
          : error ? <Line quiet>Could not load your family just now. This is not the same as there being nobody.</Line>
          : <Line>No child is linked to your account yet. The school office verifies each link; ask them if one is missing.</Line>}
      </Card>
    </Page>
  );
}

/** "Hilton College · 1XI" — the school line under his name. */
const schoolLine = (c) => [c.schoolName, c.team].filter(Boolean).join(" · ");

// ── P1 · Home — one child ──────────────────────────────

export function FamilyHome({ role, onNav }) {
  const { kids, child, choose, loading, error, matches, matchesRead, matchesSaid, retry } = useChildren(role);
  const nav = useNav(role);
  const [open, setOpen] = useState(null);
  if (!child) return <NoChild loading={loading} error={error} testid="family-home"/>;
  if (open?.kind === "match") return <MatchFor match={open.match} child={child} role={role} matches={matches} onBack={() => setOpen(null)}/>;
  if (open?.kind === "fixture") {
    return <Page testid="family-home"><FixtureDetail match={open.match} child={child} role={role} onBack={() => setOpen(null)}/></Page>;
  }
  const now = Date.now();
  return (
    <Page testid="family-home">
      <ChildSwitcher kids={kids} chosen={child} onChoose={(c) => { setOpen(null); choose(c); }}/>
      {/* Keyed on the child: a switch starts every card afresh, so nothing
          read for one child is ever drawn under the other's name. */}
      <div key={child.id} data-testid="family-home-body" data-child={child.id} style={{ display: "grid", gap: T.space.md }}>
        <header style={{ display: "grid", gap: "2px" }}>
          <Title testid="family-child">{child.knownAs || child.name}</Title>
          <Line quiet testid="family-child-school">{schoolLine(child)}</Line>
        </header>
        <NextFixtureCard child={child} matches={matches} role={role} now={now} said={matchesSaid} onRetry={retry}
          onOpen={(m) => setOpen({ kind: "fixture", match: m })}
          onMatches={nav.includes("fixtures") ? () => onNav?.("fixtures") : null}/>
        {/* GA-I20 A0: what is owed for him, under the next fixture: his fixtures'
            answers, narrowed to him, and the one door of each row. */}
        <TodoCard child={child} matches={matches} matchesRead={matchesRead} now={now}
          onOpen={(m) => setOpen({ kind: "fixture", match: m })}/>
        {/* SCRBRD-124 phase 2 (db/76): his lifts on the day — the driver's
            number and car, the marks, "confirm collected"; her own card when
            she drives. */}
        <LiftsToday child={child} matches={matches}/>
        <LiveCard child={child} matches={matches} now={now} onFollow={(m) => setOpen({ kind: "match", match: m })}/>
        <LastMatchCard child={child} matches={matches} now={now} onOpen={(m) => setOpen({ kind: "match", match: m })}/>
        <SeasonCard child={child} role={role}/>
        <NoticesCard child={child} role={role} onOpen={nav.includes("notices") ? () => onNav?.("notices") : null}/>
      </div>
    </Page>
  );
}

// ── P2 · Matches — his fixtures ────────────────────────

export function FamilyMatches({ role }) {
  const { kids, child, choose, loading, error } = useChildren(role);
  if (!child) return <NoChild loading={loading} error={error} testid="family-matches"/>;
  return (
    <Page testid="family-matches">
      <ChildMatches key={child.id} child={child} role={role}
        head={<ChildSwitcher kids={kids} chosen={child} onChoose={choose}/>}/>
    </Page>
  );
}

// ── P5 · Notices ───────────────────────────────────────

/**
 * Notices and the newsfeed in one list, newest first, unread first-lit, each
 * saying which child it is about when it names one. What arrives is what RLS
 * delivered (§2.1 P5): nothing is filtered here, because for a parent nothing
 * needs to be — a medical notice about another child cannot reach her.
 */
export function FamilyNotices({ role }) {
  const [nonce, setNonce] = useState(0);
  const notesRead = useLive("notifications", role, nonce);
  const { rows: notes } = notesRead;
  const { rows: news } = useLive("news", role, nonce);
  const { rows: kids } = useLive("my_children", role);
  const items = [
    ...notes.map((n) => ({ key: `n-${n.id}`, at: n.time, title: n.title, body: n.body, unread: !n.read,
      about: kids.find((k) => k.id === n.subjectPerson) ?? null })),
    ...news.filter((p) => !p.draft).map((p) => ({ key: `p-${p.id}`, at: p.at, title: p.title, body: p.body, unread: false,
      from: p.audience, about: null })),
  ].sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  const unread = items.filter((i) => i.unread).length;
  return (
    <Page testid="family-notices">
      <Title>Notices</Title>
      {/* "Nothing unread" is a count; it is said of notices that were read. */}
      {["ok", "empty"].includes(readState(notesRead, { what: "the notices" }).state) && <Line quiet>{unread ? `${unread} unread` : "Nothing unread"}</Line>}
      {!items.length && <Card label="Notices"><NoneOr read={notesRead} what="notices" none="No notices yet." onRetry={() => setNonce((n) => n + 1)} testid="notices-none"/></Card>}
      {items.map((i) => (
        <article key={i.key} data-testid="notice" data-unread={i.unread ? "true" : undefined}
          style={{ background: T.surface.raised, border: `1px solid ${i.unread ? T.line.strong : T.line.normal}`,
            borderRadius: T.radius.lg, padding: `${T.space.md} ${T.space.lg}`, display: "grid", gap: T.space.xs }}>
          <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap", alignItems: "baseline" }}>
            {i.unread && <span style={{ ...T.role.label, color: T.content.primary }}>New</span>}
            <span style={{ ...T.role.label, color: T.content.secondary }}>{humanDate(String(i.at ?? "").slice(0, 10))}</span>
            {i.about && <span data-testid="notice-about" style={{ ...T.role.label, color: T.content.secondary }}>About {i.about.knownAs || i.about.name}</span>}
            {i.from && <span style={{ ...T.role.label, color: T.content.secondary }}>{i.from}</span>}
          </div>
          <h2 style={{ ...T.role.body, fontWeight: i.unread ? 700 : 600, color: T.content.primary, margin: 0 }}>{i.title}</h2>
          {i.body && <p style={{ ...T.role.body, color: T.content.secondary, margin: 0 }}>{i.body}</p>}
        </article>
      ))}
    </Page>
  );
}

// ── P6 · Family — the file ─────────────────────────────

/**
 * Every child as a section: Family is the one screen about all of them
 * (§3.1). Each child's card is its own component (childfile.jsx), so a later
 * card — lifts, consents, the account — is added beside it, not into it.
 */
export function FamilyFile({ role }) {
  const { rows: kids, loading, error } = useLive("my_children", role);
  if (!kids.length) return <NoChild loading={loading} error={error} testid="family-file"/>;
  return (
    <Page testid="family-file">
      <Title>Family</Title>
      {kids.map((c) => <ChildFileCard key={c.id} child={c} role={role} w={tenantWords({ kind: c.schoolKind, relationship: c.relationship })}/>)}
    </Page>
  );
}
