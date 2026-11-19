import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiBase, signedIn } from "./api.js";
import { SCHOOL_CODE, schoolOfSide } from "./schoolName.js";

/**
 * THE FOLLOW LIST, client side (EXPERIENCE_PASS Q8, §2.4, §3.8; db/160).
 *
 * A signed-in person's list of schools whose PUBLIC matches lead his Today.
 * It opens no new read: the Today is the home page's public list, kept by
 * the server to the schools on his own list (GET /api/follows/today). Team
 * facts only, as on the home page: no child, no ground, no officials.
 *
 * THE DOOR FROM A MATCH PAGE. The public page has no sign-in and no API
 * client (tools/check-bundle.mjs holds it), so its "Follow Hilton College's
 * matches" is a plain link to /app?follow=<school code>&from=<match>. The
 * app reads it once (followAsked()) and takes it out of the address
 * (dropFollowAsk()). After the one sign-in (Google or the office's code) it
 * ASKS, and follows nothing until the person taps Follow (Kameel, 15 Nov:
 * "A shared link asks before it follows: one tap, for everyone."):
 * askFollow() names the school from that match's public page, the same read
 * a stranger gets, and only for a side of it that published, so a link
 * cannot dress one school's code in another's name; confirmFollow() writes
 * the row; dismissFollow() ("Not now") writes nothing. A link that names no
 * match, or a school not on that match's page, is not offered.
 *
 * Nothing is pushed (Q23 waits for push delivery).
 */

const CODE = SCHOOL_CODE;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The poll while one of the followed schools' fixtures is live, as the home page's strip polls (home/reads.js). */
export const FOLLOW_POLL_MS = 15_000;

/**
 * The `follow` hint in the address: the school's code and the match it came
 * from, or null when the code is not one or the match is not an id.
 * @param {string} [search] @returns {{code: string, from: string} | null}
 */
export function followAsked(search = globalThis.location?.search ?? "") {
  try {
    const q = new URLSearchParams(search);
    const code = q.get("follow"), from = q.get("from");
    return code && CODE.test(code) && from && UUID.test(from) ? { code, from: from.toLowerCase() } : null;
  } catch { return null; }
}

/** Take the hint out of the address, so a reload or a shared link does not carry it. */
export function dropFollowAsk() {
  try {
    const u = new URL(window.location.href);
    if (!u.searchParams.has("follow") && !u.searchParams.has("from")) return;
    u.searchParams.delete("follow");
    u.searchParams.delete("from");
    window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
  } catch { /* the address stays as it was */ }
}

/** Words for what the server answered a follow. @param {any} e */
export function followProblem(e) {
  const code = e?.code ?? e?.error;
  if (code === "no_such_school") return "That school is not on SCRBRD, so there is nothing to follow.";
  if (code === "too_many") return "You follow fifty schools already. Stop following one to add another.";
  if (e?.status === 401 || code === "not_signed_in") return "Sign in again to follow a school.";
  return "Could not follow that school just now. Try again from its match page.";
}

// The news of a follow made from a link, for the list to say once.
/** @type {{ name: string } | { problem: string } | null} */
let lastFollow = null;
// The question a link asks, until it is answered: { code, name }.
/** @type {{ code: string, name: string } | null} */
let pending = null;
const listeners = new Set();
const tell = () => { for (const l of listeners) l(); };

/**
 * A link's question, after the sign-in: name the school from the match's
 * public page and hold the question for the Followed schools block. Writes
 * nothing. Resolves to the question, or null when there is nothing to ask.
 * @param {{code: string, from: string}} ask
 * @param {typeof fetch} [get] the public read (tests pass their own)
 */
export async function askFollow(ask, get = globalThis.fetch) {
  pending = null; lastFollow = null;
  try {
    const res = await get(`${apiBase()}/api/public/matches/${encodeURIComponent(ask.from)}`, { credentials: "omit", headers: { accept: "application/json" } });
    const m = res.ok ? (await res.json())?.match : null;
    const sides = m ? [
      m.published?.home === true ? { code: m.homeCode, name: schoolOfSide(m.homeLabel, m.homeTeam) } : null,
      m.published?.away === true && m.awayOnPlatform === true ? { code: m.awayCode, name: schoolOfSide(m.awayLabel, m.awayTeam) } : null,
    ] : [];
    const side = sides.find((x) => x && x.code === ask.code && x.name);
    if (side) pending = { code: side.code, name: side.name };
    else lastFollow = { problem: "That school's match page is not available, so there is nothing to follow from it." };
  } catch {
    lastFollow = { problem: "Could not open that school's match page just now. Follow it from the page again." };
  }
  tell();
  return pending;
}

/** The link's question, if one is waiting. */
export const followQuestion = () => pending;

/** "Follow": now, and only now, the row is written. */
export async function confirmFollow() {
  const ask = pending;
  if (!ask) return null;
  pending = null;
  return followFromLink(ask.code);
}

/** "Not now": the question goes, and nothing is written. */
export function dismissFollow() {
  pending = null; lastFollow = null;
  tell();
}

/**
 * Follow the school a match page's link named, as the signed-in person.
 * Resolves to its name, or a problem in words; never throws.
 * @param {string} code
 */
export async function followFromLink(code) {
  try {
    const r = await api("/api/follows", { method: "POST", body: { code } });
    lastFollow = { name: String(r?.school?.name ?? "that school") };
  } catch (e) {
    lastFollow = { problem: followProblem(e) };
  }
  tell();
  return lastFollow;
}

/**
 * The follower's Today: his list, and the public fixtures of its schools
 * today. Polls while one is live and the page is visible.
 * @returns {{ loading: boolean, failed: boolean, schools: {id: string, code: string, name: string, since: string}[],
 *   data: {asOf: string | null, fixtures: any[] | null} | null, live: boolean, note: any, ask: {code: string, name: string} | null,
 *   unfollow: (id: string) => Promise<boolean>, reload: () => void }}
 */
export function useFollowed() {
  const [state, setState] = useState(/** @type {{loading: boolean, failed: boolean, body: any}} */ ({ loading: true, failed: false, body: null }));
  const [nonce, setNonce] = useState(0);
  const [note, setNote] = useState(lastFollow);
  const [ask, setAsk] = useState(pending);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    const on = () => { setNote(lastFollow); setAsk(pending); setNonce((n) => n + 1); };
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, []);

  useEffect(() => {
    if (!signedIn()) { setState({ loading: false, failed: false, body: null }); return undefined; }
    let off = false;
    /** @type {any} */
    let timer = null;
    const read = async () => {
      try {
        const body = await api("/api/follows/today");
        if (off) return;
        setState({ loading: false, failed: false, body });
        if (body?.fixtures?.some((/** @type {any} */ f) => f.status === "live")) timer = setTimeout(again, FOLLOW_POLL_MS);
      } catch {
        if (!off) setState((s) => ({ loading: false, failed: true, body: s.body }));
      }
    };
    const again = () => {
      if (off) return;
      if (document.hidden) { timer = setTimeout(again, FOLLOW_POLL_MS); return; }
      read();
    };
    read();
    return () => { off = true; clearTimeout(timer); };
  }, [nonce]);

  const unfollow = useCallback(async (/** @type {string} */ id) => {
    try {
      await api(`/api/follows/${encodeURIComponent(id)}`, { method: "DELETE" });
      lastFollow = null;
      if (alive.current) { setNote(null); setNonce((n) => n + 1); }
      return true;
    } catch { return false; }
  }, []);

  const body = state.body;
  const fixtures = Array.isArray(body?.fixtures) ? body.fixtures : null;
  return {
    loading: state.loading, failed: state.failed,
    schools: Array.isArray(body?.schools) ? body.schools : [],
    data: body ? { asOf: body.asOf ?? null, fixtures } : null,
    live: !!fixtures?.some((/** @type {any} */ f) => f.status === "live"),
    note, ask, unfollow, reload: () => setNonce((n) => n + 1),
  };
}
