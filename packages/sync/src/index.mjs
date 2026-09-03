/**
 * @scrbrd/sync — getting the ball log off the device.
 *
 * This is CLIENT code. It lives in a package rather than beside the API
 * because both sides need it and neither owns it: the browser scorer runs it
 * for real, and the Node smoke tests drive the same engine against the same
 * server. A second implementation for the browser would be a second set of
 * bugs, in the one place where losing an over is unrecoverable.
 *
 * It also has to be importable into a browser bundle, which is why it depends
 * on @scrbrd/scoring and nothing under services/.
 */
export * from "./sync-engine.mjs";
export * from "./indexeddb-storage.mjs";
