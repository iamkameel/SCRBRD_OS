import { useCallback, useEffect, useRef, useState } from "react";
import { api, signedIn } from "./api.js";

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
 * matches" is a plain link to /app?follow=<school code>. The app reads the
 * code once (followAsked()), takes it out of the address (dropFollowAsk()),
 * and after the one sign-in (Google or the office's code) follows it
 * (followFromLink()). The hint grants nothing: it names a school whose
 * matches are public already, and the server refuses a code that names none.
 *
 * Nothing is pushed (Q23 waits for push delivery).
 */

/** A school's code as the link carries it (school.code: "HIL", "verify-051"). */
const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

/** The poll while one of the followed schools' fixtures is live, as the home page's strip polls (home/reads.js). */
export const FOLLOW_POLL_MS = 15_000;

/** The `follow` hint in the address, if it is a school code; null otherwise. @param {string} [search] */
export function followAsked(search = globalThis.location?.search ?? "") {
  try {
    const v = new URLSearchParams(search).get("follow");
    return v && CODE.test(v) ? v : null;
  } catch { return null; }
}

/** Take the hint out of the address, so a reload or a shared link does not carry it. */
export function dropFollowAsk() {
  try {
    const u = new URL(window.location.href);
    if (!u.searchParams.has("follow")) return;
    u.searchParams.delete("follow");
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
const listeners = new Set();
const tell = () => { for (const l of listeners) l(); };

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
 *   data: {asOf: string | null, fixtures: any[] | null} | null, live: boolean, note: any,
 *   unfollow: (id: string) => Promise<boolean>, reload: () => void }}
 */
export function useFollowed() {
  const [state, setState] = useState(/** @type {{loading: boolean, failed: boolean, body: any}} */ ({ loading: true, failed: false, body: null }));
  const [nonce, setNonce] = useState(0);
  const [note, setNote] = useState(lastFollow);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    const on = () => { setNote(lastFollow); setNonce((n) => n + 1); };
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
    note, unfollow, reload: () => setNonce((n) => n + 1),
  };
}
