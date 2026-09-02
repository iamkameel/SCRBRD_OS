/**
 * Re-export shim.
 *
 * The policy itself lives in `@scrbrd/policy` so that the client and the
 * database generator import the SAME module rather than two copies kept
 * byte-identical by hand. This file exists only so the paths documented in
 * services/api/README.md and rls/README.md keep resolving.
 *
 * Do not add policy here. Edit packages/policy/src/policy.mjs, then run
 * `pnpm rls:generate` to re-emit db/02_rls_policies.sql.
 */
export * from "@scrbrd/policy";
