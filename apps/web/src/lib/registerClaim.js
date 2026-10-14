/**
 * SCRBRD — what the join screen says about the staff register's claim
 * (POST /api/join/register-claim, SCRBRD-140 phase 2 §2.2, §4.2).
 *
 * Kept apart from lib/staffRegister.js (the office's side) because the join
 * screen is in the entry bundle and the office's screens are not: this file
 * imports one small table of words and nothing else.
 *
 * THE RULES THE WORDS KEEP:
 *   - A staff member who is granted nothing reads no sentence from the claim at
 *     all, so a refused person learns nothing about whether she was listed.
 *   - A cooldown is said as the person's own state: it never says why, never
 *     names anyone, and never says a parent's claim was involved.
 */
import { JOIN_WORDS } from "./joinSchool.js";

/**
 * The cooldown, said as the person's own state and nothing else (design §4.2).
 * Who can lift it is not a secret: the school's safeguarding lead.
 */
export const COOLDOWN_SENTENCE = JOIN_WORDS.request_cooldown;

/**
 * Why a claim could not be checked. The claim is never the only way in: an
 * ordinary request can still be sent below it, so this says so.
 * @param {any} e
 * @returns {{ kind: "cooldown" | "error", words: string }}
 */
export function claimFailure(e) {
  if (e?.status === 409 && e?.code === "request_cooldown") return { kind: "cooldown", words: COOLDOWN_SENTENCE };
  if (e?.status === undefined || e?.status === null) {
    return { kind: "error", words: "Could not reach SCRBRD to check the school's staff list. Check your connection, then try again. You can still send a request below." };
  }
  if (e?.code === "missing_token" || e?.code === "token_expired") return { kind: "error", words: "You were signed out. Sign in again." };
  return { kind: "error", words: "The school's staff list could not be checked just now. Try again, or send a request below." };
}

/**
 * What the claim answered. Granted words are the server's, as it wrote them
 * ("You're in. The office listed you as …"); nothing granted is no words at
 * all, so the screen shows the ordinary request form and says nothing about
 * whether the person was listed.
 * @param {any} r  { granted, requested, words }
 * @returns {{ kind: "granted", words: string } | { kind: "none" }}
 */
export function claimResult(r) {
  if (Array.isArray(r?.granted) && r.granted.length > 0 && typeof r.words === "string" && r.words) return { kind: "granted", words: r.words };
  return { kind: "none" };
}
