/**
 * SCRBRD — the wire to Firebase Cloud Messaging, and nothing else.
 *
 * This file is deliberately the thinnest thing in the notify module. Every
 * decision about WHO receives a notice and WHAT of it travels is made in
 * push-api.mjs against the database's own policies; this takes a token and an
 * already-decided payload and posts it. If it ever grows a branch that reads a
 * notification, a capability or a person, that branch is in the wrong file.
 *
 * NO CREDENTIAL LIVES IN THIS REPOSITORY. FCM v1 wants an OAuth2 access token
 * minted from a service-account key, and a checked-in service-account key is
 * exactly the exposure one of the older prototypes is still carrying. So the
 * key never appears here: the caller supplies an `accessToken()` provider,
 * which in a deployment reads a secret from the environment or a secret store
 * and mints a short-lived token. With nothing configured the module reports
 * itself unconfigured and the route refuses, rather than pretending to send.
 *
 * ONE PROJECT, scrbrd-os. The earlier prototypes had their own Firebase
 * projects and their own rules; none of that is inherited or referenced, and
 * the project id comes from the environment so that it cannot be quietly
 * pointed at another one by an import.
 */

/** The FCM v1 endpoint for a project. */
const endpoint = (projectId) =>
  `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;

/**
 * Is push delivery wired up in this environment?
 *
 * Checked by the route so an unconfigured deployment answers "not configured"
 * instead of writing a delivery log full of attempts that never left the
 * building. A log of pretend sends is worse than an empty one: it will be read
 * later as evidence that a parent was told.
 */
export function fcmConfigured(env = process.env) {
  return Boolean(env.FCM_PROJECT_ID && (env.FCM_ACCESS_TOKEN || env.FCM_SERVICE_ACCOUNT));
}

/**
 * The real transport.
 *
 * `send` returns a plain verdict rather than throwing, because the caller has
 * to record something for every device either way — and because one dead token
 * among forty must not abandon the other thirty-nine.
 *
 * `rejected` is the verdict that matters operationally: FCM says UNREGISTERED
 * or INVALID_ARGUMENT when a browser has cleared its storage or a phone has
 * been wiped, and the caller retires the row on the strength of it. Anything
 * else is `failed` and the row stays live to be retried, because a 503 from
 * Google is not a statement about the device.
 */
export function fcmTransport({ projectId, accessToken, fetchImpl = fetch }) {
  return {
    name: "fcm",
    async send({ token, payload }) {
      let bearer;
      try { bearer = await accessToken(); }
      catch (e) { return { ok: false, rejected: false, detail: `no_access_token: ${e.message}` }; }

      let res;
      try {
        res = await fetchImpl(endpoint(projectId), {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body: JSON.stringify({ message: { token, ...payload } }),
        });
      } catch (e) {
        return { ok: false, rejected: false, detail: `transport_error: ${e.message}` };
      }

      if (res.ok) return { ok: true };
      const text = await res.text().catch(() => "");
      // 404 and 400 UNREGISTERED/INVALID_ARGUMENT are the device's verdict on
      // itself. 401/403 are OUR credential's problem and must never retire a
      // parent's phone — a misconfigured key would otherwise quietly empty
      // every registration in the school.
      const rejected = res.status === 404 ||
        (res.status === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(text));
      return { ok: false, rejected, detail: `${res.status} ${text.slice(0, 200)}` };
    },
  };
}

/**
 * The transport a deployment gets by default, or null when nothing is wired.
 *
 * FCM_ACCESS_TOKEN is the simple path — an operator or a sidecar refreshes it
 * — and is read at call time rather than captured, so a rotated token is
 * picked up without a restart.
 */
export function transportFromEnv(env = process.env) {
  if (!fcmConfigured(env)) return null;
  return fcmTransport({
    projectId: env.FCM_PROJECT_ID,
    accessToken: async () => {
      if (env.FCM_ACCESS_TOKEN) return env.FCM_ACCESS_TOKEN;
      // A service-account key would be exchanged for a token here. Left
      // unimplemented on purpose rather than half-implemented: minting one
      // needs a signing library and a decision about where the key lives, and
      // an operator who sets FCM_SERVICE_ACCOUNT should get this sentence
      // rather than a silent failure.
      throw new Error("FCM_SERVICE_ACCOUNT is set but token minting is not implemented; supply FCM_ACCESS_TOKEN");
    },
  });
}
