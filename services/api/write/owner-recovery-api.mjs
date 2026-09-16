/**
 * A way back in for the owner, when the code has expired and there is no
 * office to ask.
 *
 * Every OTHER account's code is reissued by somebody who holds user.invite
 * at their school — that is the whole security model in db/05_auth.sql. The
 * owner's account, by design, answers to nobody at a school (a platform-wide
 * assignment), so there is no office for it either. Before this the only
 * path was tools/bootstrap.mjs --owner or a hand-written SQL script pasted
 * into the Supabase editor — both correct, both slow, and both done under
 * the exact pressure ("I'm locked out right now") that makes a mistake
 * likeliest.
 *
 * OWNER_RECOVERY_SECRET is a SEPARATE secret from SESSION_SECRET, unset by
 * default (this route refuses until it is set) — set once, on Render, known
 * only to the operator, never passed through this codebase's chat history or
 * committed anywhere. Leaking it is not "create an account with any
 * privilege": owner_recovery_issue() (db/18) will only ever refresh a code
 * for an account that ALREADY holds a platform-wide superadmin assignment.
 * It cannot create that assignment or touch any other account.
 */
import { timingSafeEqual, createHash } from "node:crypto";
import { newMagicCode } from "../auth/auth.mjs";

// Comparing two strings of different lengths throws from timingSafeEqual
// rather than differing only in timing, which leaks the length and defeats
// the point of using it. Hashing both sides first makes every comparison the
// same fixed length, so a wrong-length guess and a right-length wrong guess
// look identical from outside.
const sha256 = (s) => createHash("sha256").update(String(s)).digest();
const secretsMatch = (given, expected) => !!expected && timingSafeEqual(sha256(given ?? ""), sha256(expected));

const err = (code, status) => Object.assign(new Error(code), { status, code });

/** POST /api/auth/owner/recover { email }, header x-owner-recovery-secret. */
export function ownerRecoveryRoutes({ pool, secret }) {
  return {
    recover: async (body, req) => {
      const configured = process.env.OWNER_RECOVERY_SECRET;
      const email = (body?.email || "").trim();
      const given = req?.headers?.["x-owner-recovery-secret"];
      const at = new Date().toISOString();

      if (!configured) throw err("recovery_not_configured", 501);
      if (!secretsMatch(given, configured)) {
        // The email is logged, the secret never is — this line is the only
        // record an attempt happened, for the operator's own server logs.
        console.error(`owner/recover ${at} refused: wrong recovery secret (email=${email || "(none)"})`);
        throw err("not_permitted", 403);
      }
      if (!email) throw err("email_required", 400);

      const { raw, hash, expiresInSec } = newMagicCode(secret, 24 * 60 * 60);
      const { rows } = await pool.query(`select * from owner_recovery_issue($1, $2, $3)`, [email, hash, expiresInSec]);
      const r = rows[0];
      if (!r?.ok) {
        console.error(`owner/recover ${at} refused: ${r?.reason || "no_result"} (email=${email})`);
        throw err(r?.reason || "not_owner", 404);
      }
      console.error(`owner/recover ${at} issued a code for ${email}`);
      // The one moment this code exists in readable form — same rule as
      // every other login code in this codebase.
      return { code: raw, expiresAt: r.expires_at };
    },
  };
}
