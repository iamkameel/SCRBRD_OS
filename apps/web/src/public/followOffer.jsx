import { T } from "../design/tokens.js";
import { SCHOOL_CODE, schoolOfSide } from "../lib/schoolName.js";

/**
 * "Follow Hilton College's matches" (EXPERIENCE_PASS §2.4 step 2, Q8).
 *
 * Drawn on the public match page at a pause (the innings break, the result),
 * the moment a watcher might want more. AN OFFER, NEVER A WALL: nothing is
 * hidden behind it and it asks nothing on this page. It is a plain link to
 * /app?follow=<school code>&from=<this match>: the public pages have no
 * sign-in and no API client (tools/check-bundle.mjs holds that), so the one
 * sign-in (Google, or the office's code) happens in the app. The app then
 * ASKS, by the school's name as this match's public page gives it: "Follow
 * Hilton College? Follow · Not now" (Kameel, 15 Nov: a shared link asks
 * before it follows, one tap, for everyone). Only Follow writes the row
 * (lib/follow.js). `nofollow`, as every link off a public page.
 *
 * A school is offered when its side is on SCRBRD and published this fixture
 * (the page is served for it). Its name is the school's alone, without the
 * team ("Hilton College", not "Hilton College 1XI"). Nothing about a child.
 */

/** The pauses the offer is drawn at: statusSentence()'s states (lib/matchCentre.js). */
export const FOLLOW_PAUSES = Object.freeze(["innings_break", "result", "complete"]);

export { schoolOfSide };
const CODE = SCHOOL_CODE;

/**
 * The schools to offer: each side on SCRBRD that published this fixture.
 * @param {any} header the public header (services/api/public/public-api.mjs header())
 * @returns {{code: string, name: string}[]}
 */
export function followable(header) {
  if (!header) return [];
  /** @type {{code: string, name: string}[]} */
  const out = [];
  const add = (/** @type {any} */ code, /** @type {string} */ name) => {
    if (typeof code === "string" && CODE.test(code) && name && !out.some((x) => x.code === code)) out.push({ code, name });
  };
  if (header.published?.home === true) add(header.homeCode, schoolOfSide(header.homeLabel, header.homeTeam));
  if (header.published?.away === true && header.awayOnPlatform === true) add(header.awayCode, schoolOfSide(header.awayLabel, header.awayTeam));
  return out;
}

/** The possessive: "Hilton College's", "St Andrews'". @param {string} name */
const theirs = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/**
 * @param {{ header: any, state: string, matchId?: string }} props  `state`: the status sentence's (statusSentence().state);
 *   `matchId`: this page's fixture, by which the app names the school before it asks
 */
export function FollowOffer({ header, state, matchId = "" }) {
  if (!FOLLOW_PAUSES.includes(state)) return null;
  const schools = followable(header);
  if (!schools.length) return null;
  return (
    <aside data-testid="follow-offer" aria-label="Follow a school"
      style={{ display: "grid", gap: T.space.sm, margin: `${T.space.md} 0`, padding: T.space.md, borderRadius: T.radius.lg,
        border: `1px solid ${T.line.normal}`, background: T.fill.panel }}>
      {schools.map((s) => (
        <a key={s.code} href={`/app?follow=${encodeURIComponent(s.code)}${matchId ? `&from=${encodeURIComponent(matchId)}` : ""}`} rel="nofollow" data-testid={`follow-offer-${s.code}`} className="pressBtn"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.md, minHeight: "44px", textDecoration: "none",
            color: T.content.primary, flexWrap: "wrap" }}>
          <span style={{ display: "grid", gap: "2px", minWidth: 0 }}>
            <span style={{ ...T.role.body, fontWeight: 700, overflowWrap: "anywhere" }}>Follow {theirs(s.name)} matches</span>
            <span style={{ ...T.role.body, fontSize: "13px", color: T.content.secondary }}>Their live boards lead your Today. One sign-in; nothing else to fill in.</span>
          </span>
          <span aria-hidden="true" style={{ ...T.role.body, fontWeight: 700, color: T.brand.accentText }}>Follow ›</span>
        </a>
      ))}
    </aside>
  );
}
