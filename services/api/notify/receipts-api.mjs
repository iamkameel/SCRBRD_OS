/**
 * SCRBRD — opening a notice, and marking notices read (NOTIFICATIONS.md D17).
 *
 * Read state is a `notification_read` row per person per notice, written AS
 * THE READER, so it follows the person across every device. Nothing here asks
 * who may read what: the receipt's own policy (db/08) demands the reader's own
 * id and a notice the reader can see, and my_notifications (db/89) is the
 * notification policy read as the caller. A receipt therefore cannot be
 * written for somebody else, nor for a notice its writer cannot see — and a
 * request that tries learns nothing a stranger would not.
 *
 * WHAT MARKS A NOTICE READ: opening it (POST /api/notifications/:id/read) and
 * "Mark all read" (POST /api/notifications/read-all). Appearing in a list does
 * not. Opening is also how a tiered notice's body is read: notification_by_id()
 * returns it, and logs that open as a disclosure, as log_restricted_read()
 * logs a read of the record behind it.
 *
 * Both answer the reader's unread count afterwards, counted over the same view
 * the summary counts, in the same transaction — the badge cannot disagree with
 * the list it sits over.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { ApiRequest, ApiResponse, Handler, Pool } from "../api-types.mjs" */

/** D16's one sentence, for "expired", "not yours" and "never existed" alike. */
export const GONE = "This notice is no longer available.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {string} code @param {number} [status] @param {string} [detail] */
const err = (code, status = 400, detail = undefined) =>
  Object.assign(new Error(code), { status, ...(detail ? { detail } : {}) });

const UNREAD = `select count(*)::int as unread from my_notifications where not read`;

/**
 * @param {{ pool: Pool, secret: string }} deps
 * @returns {Record<string, Handler>}
 */
export function receiptRoutes({ pool, secret }) {
  /** @param {(req: ApiRequest) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error"),
                                ...(e.status && e.detail ? { detail: e.detail } : {}) });
    }
  };

  return {
    // POST /api/notifications/:id/read
    //
    // Opens the notice and marks it read, in one transaction as the reader.
    // A notice the reader may not have, an expired one and one that never
    // existed are one answer (404, GONE): a 403 here would say the id is real.
    // A retracted notice opens as its stub (D19) and is not marked: there is
    // nothing in it to have read.
    open: handle(async (req) => {
      const id = String(req.params?.id ?? "");
      if (!UUID.test(id)) throw err("no_such_notification", 404, GONE);
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows: [found] } = await client.query(`select notification_by_id($1::uuid) as notice`, [id]);
        const notice = found?.notice;
        if (!notice) throw err("no_such_notification", 404, GONE);
        if (notice.withdrawn) {
          const { rows: [c] } = await client.query(UNREAD);
          return { notice, unread: c.unread };
        }
        await client.query(
          `insert into notification_read (notification_id, person_id)
           values ($1::uuid, app_user_id()) on conflict do nothing`, [id]);
        const { rows: [c] } = await client.query(UNREAD);
        return { notice: { ...notice, read: true }, unread: c.unread };
      });
    }),

    // POST /api/notifications/read-all
    //
    // Every notice the reader's list holds and has not read. The reader's
    // own: another person's count does not move.
    readAll: handle(async (req) =>
      runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rowCount } = await client.query(
          `insert into notification_read (notification_id, person_id)
           select id, app_user_id() from my_notifications where not read
           on conflict do nothing`);
        const { rows: [c] } = await client.query(UNREAD);
        return { marked: rowCount ?? 0, unread: c.unread };
      })),
  };
}
