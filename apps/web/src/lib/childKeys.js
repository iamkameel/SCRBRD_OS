/**
 * What this device keeps under one child's id, named in one place, so the
 * screen that must forget a child (lib/family.js forgetChild) and the screen
 * that wrote the key (views/healthconsent.jsx) cannot drift apart. A leaf
 * module: no imports, so the sign-up chunk that draws the health card pulls
 * nothing else in with it.
 */

/** Health monitoring's one-time card, "Not now" on this device (SCRBRD-110 §9.1). @param {string} playerId */
export const healthPromptKey = (playerId) => `scrbrd:health-consent-prompt:${playerId}`;
