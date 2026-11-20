/**
 * Each live fixture's own log, folded (redesign slice 4: one status on Today
 * and Matches).
 *
 * A fixture is live from its first ball until somebody confirms the result
 * (db/165, db/130). Between the last ball and the coach's confirmation its
 * log already decides it, and every screen must say so the one way:
 * "Provisional", "Hilton won by 12 runs · provisional" (DESIGN_DIRECTION
 * §2.2), never "Live", never a take-over. Only a fold of the log knows that,
 * so a screen that lists live fixtures asks for each one's events, the same
 * GET /api/matches/:id/events read and deriveMatch() fold the Match Centre
 * makes, and hands the card the innings AND the result.
 *
 * NOTHING NEW IS READ: the route and the reader's rights are the Match
 * Centre's. Asked once per live fixture, and again on `nonce`.
 */
import { useEffect, useState } from "react";
import { deriveMatch, fromRow } from "@scrbrd/scoring";
import { api, signedIn } from "./api.js";
import { resultSaidOf } from "./matchCard.js";

/**
 * @param {string[]} ids  the live fixtures on screen
 * @param {number} [nonce]  bumped to read again
 * @returns {Record<string, {innings: any[], result: any, conditions: any}>}  by id; absent while asking or when the read failed
 */
export function useLiveFolds(ids, nonce = 0) {
  const key = signedIn() ? ids.join(",") : "";
  const [got, setGot] = useState(/** @type {Record<string, {innings: any[], result: any, conditions: any}>} */ ({}));
  useEffect(() => {
    if (!key) return undefined;
    let off = false;
    Promise.all(key.split(",").map((id) => api(`/api/matches/${id}/events`)
      .then((r) => {
        const f = deriveMatch((r?.events ?? []).map(fromRow), r?.fold ?? {});
        return /** @type {[string, any]} */ ([id, { innings: f.innings ?? [], result: f.result ?? null, conditions: r?.fold?.conditions ?? null }]);
      }, () => /** @type {[string, any]} */ ([id, null]))))
      .then((pairs) => { if (!off) setGot(Object.fromEntries(pairs.filter(([, f]) => f))); });
    return () => { off = true; };
  }, [key, nonce]);
  return got;
}

/**
 * Each finished fixture's result in words, by id: the server's (GET
 * /api/matches/:id/result, the Match Centre's read) and each innings' total
 * by side from the same answer. So a match the coach has confirmed reads as
 * the result ("Hilton won by 12 runs"), never "Result to confirm". Null for
 * a read that failed, absent while asking. Signed in only.
 * @param {string[]} ids  @param {number} [nonce]
 * @returns {Record<string, {text: string | null, innings: any[]} | null>}
 */
export function useResultsSaid(ids, nonce = 0) {
  const key = signedIn() ? ids.join(",") : "";
  const [got, setGot] = useState(/** @type {Record<string, {text: string | null, innings: any[]} | null>} */ ({}));
  useEffect(() => {
    if (!key) return undefined;
    let off = false;
    Promise.all(key.split(",").map((id) => api(`/api/matches/${id}/result`)
      .then((r) => /** @type {[string, any]} */ ([id, { text: resultSaidOf(r), innings: Array.isArray(r?.innings) ? r.innings : [] }]),
        () => /** @type {[string, any]} */ ([id, null]))))
      .then((pairs) => { if (!off) setGot(Object.fromEntries(pairs)); });
    return () => { off = true; };
  }, [key, nonce]);
  return got;
}
