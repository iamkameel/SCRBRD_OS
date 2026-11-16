/**
 * "APPOINTED TO SCORE" ON A PARENT'S OR A PUPIL'S HOME (EXPERIENCE_PASS Q2,
 * decided 13 Nov; Slice 4). A pupil or a parent who is also appointed to score
 * keeps the persona's four-item bar (design/roles.js PERSONA_KEEPS); scoring
 * is this block on Home, and the same line on the appointed match when it is
 * opened. There is no fifth bar item.
 *
 * The fixtures and the appointment are the scorer's home's own
 * (lib/scorerHome.js scorerFixtures, appointmentOf): the same reads, the same
 * rule, and the same words, "Appointed to score" and "Your side's fixture",
 * word for word (views/ScorerHomeView.jsx; smoke-browser-scorer-home.mjs).
 * The block lists what the scorer's home lists: the fixtures he is appointed
 * to first, then today's and the next fixtures of his side he may score
 * (Kameel, 8 Oct: the appointment only shapes the list; a scorer whose
 * assignment covers the side may claim any fixture of it). Under Q2 nothing
 * else on the persona's bar reaches the scorer's home, so this is his way to
 * the pad. No child is named: a fixture is its two sides.
 *
 * PRESENTATION ONLY. "Open the pad" goes through the shell's own route
 * (App.jsx openScorer), and the claim is decided in Postgres as for any scorer.
 */
import { useMemo } from "react";
import { roleGrants } from "@scrbrd/policy/roles";
import { T } from "../../design/tokens.js";
import { signedIn } from "../../lib/api.js";
import { profile } from "../../lib/session.js";
import { useLive } from "../../lib/live.js";
import { personaOf } from "../../lib/features.js";
import { humanDate, humanDateTime } from "../../lib/format.js";
import { SCORE_CAPABILITY, scorerFixtures } from "../../lib/scorerHome.js";
import { Action, Card, Line } from "./parts.jsx";

/** "Westville 1XI v Hilton 1XI", as the scorer's home says it. @param {any} m */
const sidesOf = (m) => `${m.homeLabel ?? m.homeTeam ?? "Home"} v ${m.awayLabel ?? m.awayTeam ?? "Away"}`;

/** The fixtures the person signed in may score, today's and the next, appointed first. Null when he holds no scoring role. */
export function useAppointed(role) {
  const me = profile();
  // Only in a persona's own app (Q2): staff who are also parents keep the staff menu, whose scorer's home and
  // Match Centre already reach the pad, so their family Home draws no second block.
  const scores = signedIn() && personaOf(role) != null && (me?.assignments ?? []).some((a) => !!a?.role && roleGrants(a.role, SCORE_CAPABILITY));
  const matchesRead = useLive("matches", role);
  const officialsRead = useLive("officials", role);
  const now = Date.now();
  const items = useMemo(() => (!scores ? [] : scorerFixtures({ matches: matchesRead.rows, assignments: me?.assignments ?? [],
    officials: officialsRead.rows, userId: me?.user?.id ?? null, now }).items),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the clock is read per render; the rows decide
  [scores, matchesRead.rows, officialsRead.rows, me?.assignments, me?.user?.id]);
  return scores ? items : null;
}

/** The one line about one fixture he may score, in the scorer's home's words. */
function Appointed({ item, onOpenScorer, testid }) {
  const { match: m, appointment: a } = item;
  return (
    <div data-testid={testid} data-match={m.id} data-group={item.group} style={{ display: "grid", gap: "2px" }}>
      {a ? (
        <p style={{ ...T.role.label, color: T.brand.accentText, margin: 0 }} data-testid={`${testid}-words`}>
          Appointed to score{a.appointedAt ? ` · named ${humanDate(a.appointedAt)}` : ""}
        </p>
      ) : (
        <p style={{ ...T.role.label, color: T.content.tertiary, margin: 0 }} data-testid={`${testid}-words`}>Your side&apos;s fixture</p>
      )}
      <Line strong>{sidesOf(m)}</Line>
      <Line quiet>{humanDateTime(m.date, m.time)}{m.venue ? ` · ${m.venue}` : ""}</Line>
      {a?.paused
        ? <Line testid={`${testid}-paused`}>The school office has paused your appointment to this match. They can tell you more.</Line>
        : onOpenScorer && <div><Action primary testid={`${testid}-open`} label={`Open the pad: ${sidesOf(m)}`} onClick={() => onOpenScorer(m)}>Open the pad</Action></div>}
    </div>
  );
}

/** Home's block: every fixture he may score, today's and the next, appointed first. Not drawn without one. */
export function AppointedCard({ role, onOpenScorer }) {
  const items = useAppointed(role);
  if (!items?.length) return null;
  return (
    <Card label="Scoring" testid="appointed-card">
      {items.map((i) => <Appointed key={i.match.id} item={i} onOpenScorer={onOpenScorer} testid="appointed"/>)}
    </Card>
  );
}

/** The same line on a fixture he may score, when it is opened from Home. Not drawn otherwise. */
export function AppointedOnMatch({ role, match, onOpenScorer }) {
  const items = useAppointed(role);
  const item = items?.find((i) => i.match.id === match?.id) ?? null;
  if (!item) return null;
  return <Card label="Scoring" testid="appointed-match"><Appointed item={item} onOpenScorer={onOpenScorer} testid="appointed-match-line"/></Card>;
}
