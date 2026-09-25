/**
 * SCRBRD API — the shapes every route module shares, as JSDoc types.
 *
 * Types only: nothing here runs and nothing imports this file at runtime.
 * Modules name these with `@import` in a comment, which tsc reads and node
 * never sees.
 *
 * WHY STRUCTURAL, NOT pg's OWN TYPES. A route factory takes `{ pool, secret }`
 * and the unit suites hand it a fake pool that answers a few queries. Typing
 * the parameter as `pg.Pool` would make every fake a cast; typing it as "has
 * query(), and connect() gives something with query() and release()" is what
 * the code actually relies on, and a real `pg.Pool` satisfies it as well.
 */

/**
 * A query result. Rows are `any` on purpose: what comes back is decided by
 * the SQL text, which the checker cannot read. It is a real boundary, like a
 * JSON body.
 * @typedef {object} QueryResult
 * @property {any[]} rows
 * @property {number | null} [rowCount]
 */

/**
 * Anything a statement can be sent to: the pool, a dedicated client inside a
 * transaction, or a test's fake.
 * @typedef {object} Db
 * @property {(text: string, params?: any[]) => Promise<QueryResult>} query
 */

/** A connection checked out of the pool; must be released. @typedef {Db & { release: (err?: any) => void }} DbClient */

/** The pool: a Db that can also hand out a dedicated connection. @typedef {Db & { connect: () => Promise<DbClient> }} Pool */

/**
 * The request a route handler is given — Express-shaped, built by the
 * dispatcher in server.mjs.
 *
 * `params` holds the one capture group of the route's pattern (`id`), or the
 * resource name on the read and export paths. A route with no capture group
 * gets `id: undefined`, which is why the values may be absent.
 *
 * `body` is parsed JSON from the wire: `any`, because until a handler has
 * validated a field it is whatever the client sent.
 * @typedef {object} ApiRequest
 * @property {Record<string, string | undefined>} params
 * @property {Record<string, string>} [query]
 * @property {any} [body]
 * @property {import("node:http").IncomingHttpHeaders} [headers]
 */

/**
 * The response shim a handler answers through: status() then json().
 * @typedef {object} ApiResponse
 * @property {(code: number) => ApiResponse} status
 * @property {(body: unknown) => ApiResponse} json
 */

/**
 * The shim plus the two methods a file download needs (rawRes in server.mjs).
 * @typedef {object} RawResponse
 * @property {(code: number) => RawResponse} status
 * @property {(body: unknown) => RawResponse} json
 * @property {(code: number, headers: Record<string, string | number>) => RawResponse} writeHead
 * @property {(body?: string | Buffer) => RawResponse} end
 */

/** One route. @typedef {(req: ApiRequest, res: ApiResponse) => unknown} Handler */

/**
 * A route whose pattern has a capture group (`/api/matches/:id/…`): the
 * dispatcher only calls it when the pattern matched, so `id` is always there.
 * @typedef {ApiRequest & { params: { id: string } }} IdRequest
 * @typedef {(req: IdRequest, res: ApiResponse) => unknown} IdHandler
 */

/**
 * A route in server.mjs's EXACT table: handed the parsed body and the raw
 * request, and its return value is the 200 answer.
 * @typedef {(body: any, req: { headers?: import("node:http").IncomingHttpHeaders }) => Promise<unknown>} ExactHandler
 */

/** What every route factory is built from. @typedef {{ pool: Pool, secret: string }} RouteDeps */

/**
 * An Error carrying an HTTP status, as the modules' `err()` helpers build it.
 * @typedef {Error & { status: number }} HttpError
 */

/**
 * An Error being dressed before it is thrown — `const e = new Error(code);
 * e.status = 400; throw e;`. Every field is optional, so casting a fresh
 * Error to this is sound; it is what lets the assignments after it check.
 * @typedef {Error & { status?: number, code?: string, detail?: unknown, module?: string }} DressedError
 */

/**
 * What a `catch` receives in this codebase: an Error from node or pg, perhaps
 * with a SQLSTATE `code`, pg's `detail`, and an HTTP `status` the thrower
 * chose. Catch bindings can only be `any` or `unknown` to the checker, so
 * handlers annotate `catch (/** @type {any} *\/ e)` — this names what that
 * `any` is.
 * @typedef {Error & { code?: string, status?: number, detail?: string }} CaughtError
 */

export {};
