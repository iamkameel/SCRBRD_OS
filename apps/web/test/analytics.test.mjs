#!/usr/bin/env node
/**
 * Analytics does not start — does not even load — until this device said yes.
 *
 * The loader is injected so the assertion is about the SDK being fetched, not
 * about Google being reachable: a fake loader counts its calls.
 */
import { startAnalyticsIfConsented, setAnalyticsConsent, analyticsConsented } from "../src/lib/firebase.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };

let loads = 0;
const fakeSdk = { isSupported: async () => true, getAnalytics: (app) => ({ app }) };
const load = async () => { loads++; return fakeSdk; };

ok("a fresh device has not consented", (await analyticsConsented()) === false);
ok("boot without consent resolves null", (await startAnalyticsIfConsented({ load })) === null);
ok("...and never loaded the SDK", loads === 0, `loads = ${loads}`);

const started = await setAnalyticsConsent(true, { load });
ok("consent is recorded", (await analyticsConsented()) === true);
ok("turning it on starts Analytics now", started != null && loads === 1, `loads = ${loads}`);
ok("...against the Firebase app", started?.app?.options?.projectId === "scrbrd-os" || started?.app != null);
ok("the next boot starts it too", (await startAnalyticsIfConsented({ load })) != null);
ok("...without loading twice", loads === 1, `loads = ${loads}`);

await setAnalyticsConsent(false, { load });
ok("turning it off is recorded", (await analyticsConsented()) === false);

console.log(`\n${"─".repeat(52)}\nANALYTICS CONSENT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
