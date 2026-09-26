import { useEffect, useState } from "react";
import { ROLES } from "../design/roles.js";
import { ROLES as POLICY_ROLES, ROLE_CAPABILITIES, SUBJECT_SCOPED_ROLES, TEAM_SCOPED_ROLES } from "@scrbrd/policy/roles";
import { PLATFORM_ONLY } from "@scrbrd/policy/capabilities";
import { D, textOn } from "../design/tokens.js";
import { Badge, Btn, Card, EmptyState, Input, Select } from "../ui/primitives.jsx";
import { api, signedIn } from "../lib/api.js";
import { useLive } from "../lib/live.js";
import { holdsCapability } from "../rbac/index.js";

/**
 * Support access, the platform side. SCRBRD-012, roadmap up23.
 *
 * `POST /api/support/access` and `/api/support/access/:id/end` (db/22) were
 * built with nothing to press: a platform administrator answering a ticket
 * about one school had curl or nothing. The school's half — who reached us,
 * why, until when — has been in Settings › School all along. This is the
 * other half: choose a school, say why, begin; watch it run down; end it.
 *
 * WHAT THIS SCREEN DECIDES: nothing. support_access_begin() checks the
 * capability, the school, the role, the reason and the minutes, and answers
 * with a verdict rather than an exception; every one of those verdicts is
 * shown here in words. The hour belongs to the database too — the assignment
 * it issues stops by itself, because app_can() reads expires_at on every
 * statement — so the countdown below is a display of the server's
 * `expires_at`, and whether a session is live is the server's `live`, never
 * this browser's clock. When the two disagree the screen asks the server
 * again and believes it.
 */

// What each verdict from support_access_begin()/_end() means, in the words a
// person acts on. Anything unmapped is still shown — by its code — rather
// than swallowed.
const REFUSAL = {
  not_permitted: "You do not hold support access. Only a platform administrator can begin or end a session.",
  school_unknown: "That school is not on the platform.",
  role_unknown: "Choose the role you will reach the school as.",
  role_not_supportable: "A platform role cannot be taken into a school. Support reaches a school as one of its own roles.",
  role_needs_subject: "That role is only ever about one child. Support reaches a school the way its office does, never the way a parent does.",
  reason_required: "Say why, in at least ten characters. The school reads this sentence on its own record.",
  minutes_out_of_range: "A session runs from one minute to four hours. Longer is an appointment, and the school makes those.",
  already_live: "You already have a session open at this school in this role. End it, or let it run out, first.",
  refused: "The database refused that combination: a coach, assistant coach or team manager must name a side.",
  bad_request: "That is not a school the platform can name. Choose one from the list.",
  no_such_access: "That session does not exist.",
  unreachable: "The server did not answer. Look at your sessions below before trying again: it may or may not have begun.",
};
const say = (e) => REFUSAL[e?.code] ?? (e?.status ? `Refused (${e.code || e.status}).` : REFUSAL.unreachable);

// The roles a session may be issued in, read from the policy rather than
// listed by hand: none carrying a platform-only capability (the database
// refuses those as role_not_supportable), none that means somebody's child
// (role_needs_subject), and not a pupil's own. Team-scoped roles are left out
// because this form names no side, and the database would refuse them for it.
const PLATFORM_CAPS = new Set(PLATFORM_ONLY);
const SUPPORT_ROLES = POLICY_ROLES.filter((r) =>
  !(ROLE_CAPABILITIES[r] ?? []).some((c) => PLATFORM_CAPS.has(c)) &&
  !SUBJECT_SCOPED_ROLES.includes(r) && !TEAM_SCOPED_ROLES.includes(r) && r !== "player");

const MINUTES = [15, 30, 60, 120, 240];
const H = () => ({ fontFamily: D.head, fontSize: "13px", fontWeight: 700, color: D.textPrimary });
const SUB = () => ({ fontFamily: D.body, fontSize: "11px", color: D.textMuted, lineHeight: 1.5 });
const MONO = () => ({ fontFamily: D.mono, fontSize: "10px", color: D.textMuted });
const clock = (t) => (t ? new Date(t).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }) : "—");
const roleLabel = (r) => ROLES[r]?.label ?? r;

/** Minutes and seconds to the server's expires_at. A display, not a verdict. */
function Countdown({ expiresAt, onZero }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, new Date(expiresAt).getTime() - now);
  useEffect(() => { if (left === 0) onZero?.(); }, [left === 0]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (left === 0) return <span data-testid="support-countdown">asking the server whether it has ended…</span>;
  const s = Math.floor(left / 1000);
  const hm = s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`
                       : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  return <span data-testid="support-countdown">{hm} left</span>;
}

function SupportAccessPanel({ role }) {
  // Courtesy only: this decides what to draw. The database is the guard —
  // support_access_begin() refuses anyone without the capability.
  if (!holdsCapability(role, "platform.support.impersonate")) return null;
  // No demonstration fallback: a support session is a real act on a real
  // school's record, and there is nothing honest to show without a server.
  if (!signedIn()) {
    return (
      <Card sx={{ padding: "16px" }} data-testid="support-access">
        <EmptyState icon="life-buoy" message="Sign in to the live platform to begin a support session."/>
      </Card>
    );
  }
  return <SupportAccessLive role={role}/>;
}

function SupportAccessLive({ role }) {
  const [nonce, setNonce] = useState(0);
  const again = () => setNonce((n) => n + 1);
  const sessions = useLive("support_access", role, nonce);
  const mine = sessions.rows.filter((s) => s.mine);
  const open = mine.filter((s) => s.live);
  const past = mine.filter((s) => !s.live).slice(0, 10);

  // Liveness is the server's: re-read every half minute, so a session the
  // school ended — or one whose hour ran out — says so here without a reload.
  useEffect(() => {
    if (!open.length) return undefined;
    const t = setInterval(again, 30000);
    return () => clearInterval(t);
  }, [open.length]);

  const [schools, setSchools] = useState({ rows: [], error: null, loading: true });
  useEffect(() => {
    let off = false;
    api("/api/schools")
      .then((r) => { if (!off) setSchools({ rows: r?.rows ?? [], error: null, loading: false }); })
      .catch((e) => { if (!off) setSchools({ rows: [], error: e.code || "unreachable", loading: false }); });
    return () => { off = true; };
  }, []);

  const [form, setForm] = useState({ schoolId: "", role: "", minutes: "60", reason: "" });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState("");
  const [begun, setBegun] = useState("");
  const [endSaid, setEndSaid] = useState({});

  const begin = async () => {
    setRefused(""); setBegun(""); setBusy(true);
    try {
      const r = await api("/api/support/access", { method: "POST", body: {
        schoolId: form.schoolId || null, role: form.role || null,
        reason: form.reason, minutes: Number(form.minutes) } });
      const school = schools.rows.find((s) => s.id === form.schoolId)?.name ?? "the school";
      setBegun(`Begun at ${school} as ${roleLabel(form.role)}, until ${clock(r.expiresAt)}. ${school} can see it, and why.`);
      setForm((f) => ({ ...f, reason: "" }));
      again();
    } catch (e) {
      // The server's verdict either way; only the wording knows no school was chosen.
      setRefused(e?.code === "school_unknown" && !form.schoolId ? "Choose the school the ticket is about." : say(e));
    } finally { setBusy(false); }
  };

  const end = async (s) => {
    setEndSaid((m) => ({ ...m, [s.id]: "" }));
    try {
      const r = await api(`/api/support/access/${s.id}/end`, { method: "POST" });
      if (r?.note === "already_ended") setEndSaid((m) => ({ ...m, [s.id]: "It had already been ended." }));
      again();
    } catch (e) { setEndSaid((m) => ({ ...m, [s.id]: say(e) })); }
  };

  // A render function rather than a component: a component declared in here
  // would be a new type on every render, remounting each Countdown.
  const row = (s) => (
    <div key={s.id} data-testid={`support-session-${s.id}`}
         style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", borderTop: `1px solid ${D.border}`, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: "220px" }}>
        <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textPrimary, fontWeight: 600 }}>
          {s.schoolName ?? "A school"} as {roleLabel(s.role)}
        </div>
        <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textSecondary }}>{s.reason}</div>
        <div style={MONO()}>
          began {clock(s.startedAt)} · {s.live
            ? <>until {clock(s.expiresAt)} · <Countdown expiresAt={s.expiresAt} onZero={again}/></>
            : s.endedAt ? `ended ${clock(s.endedAt)}${s.endedByName ? ` by ${s.endedByName}` : ""}`
            : `ran out at ${clock(s.expiresAt)}`}
        </div>
        {endSaid[s.id] && <div role="alert" style={{ fontFamily: D.body, fontSize: "11px", color: textOn(D.rose), marginTop: "4px" }}>{endSaid[s.id]}</div>}
      </div>
      <Badge color={s.live ? D.amber : D.textMuted}>{s.live ? "Live now" : "Over"}</Badge>
      {s.live && <Btn size="sm" variant="danger" onClick={() => end(s)} data-testid="support-end">End now</Btn>}
    </div>
  );

  return (
    <div style={{ display: "grid", gap: "16px" }} data-testid="support-access">
      <Card sx={{ padding: "16px" }}>
        <div style={H()}>Begin a support session</div>
        <div style={{ ...SUB(), marginTop: "3px", marginBottom: "12px", maxWidth: "66ch" }}>
          One school, as one of its own roles, for the minutes you choose — an hour unless you say otherwise, four at most.
          It stops by itself. The school sees who you are, the role and your reason, and can end it sooner.
          Every read you make while it is live is written to that school's own record.
        </div>
        <div style={{ maxWidth: "560px" }}>
          <Select label="School" value={form.schoolId} onChange={set("schoolId")} data-testid="support-school"
            options={[{ value: "", label: schools.loading ? "Loading schools…" : "Choose a school" },
                      ...schools.rows.map((s) => ({ value: s.id, label: s.name }))]}/>
          {schools.error && <div role="alert" style={{ ...SUB(), color: textOn(D.rose), marginTop: "-8px", marginBottom: "10px" }}>Could not load the schools ({schools.error}).</div>}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px" }}>
            <Select label="As" value={form.role} onChange={set("role")} data-testid="support-role"
              options={[{ value: "", label: "Choose a role" }, ...SUPPORT_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))]}/>
            <Select label="For" value={form.minutes} onChange={set("minutes")} data-testid="support-minutes"
              options={MINUTES.map((m) => ({ value: String(m), label: m < 60 ? `${m} min` : `${m / 60} h` }))}/>
          </div>
          <Input label="Reason — the school reads this" value={form.reason} onChange={set("reason")} data-testid="support-reason"
                 placeholder="e.g. ticket 4411: roster import failing at this school"/>
          {refused && <div role="alert" data-testid="support-refused" style={{ fontFamily: D.body, fontSize: "11px", color: textOn(D.rose), marginBottom: "8px" }}>{refused}</div>}
          {begun && <div role="status" data-testid="support-begun" style={{ fontFamily: D.body, fontSize: "11px", color: textOn(D.emerald), marginBottom: "8px" }}>{begun}</div>}
          <Btn size="sm" onClick={begin} disabled={busy} data-testid="support-begin">{busy ? "Beginning…" : "Begin session"}</Btn>
        </div>
      </Card>

      <Card sx={{ padding: "16px" }}>
        <div style={H()}>Your sessions</div>
        <div style={{ ...SUB(), marginTop: "3px", marginBottom: "8px" }}>
          Live or not is the server's answer, re-read every half minute. A session the school ends shows here as ended, by them.
        </div>
        {sessions.loading && !mine.length
          ? <EmptyState loading/>
          : sessions.error
            ? <EmptyState error/>
            : mine.length === 0
              ? <EmptyState icon="life-buoy" message="You have not begun a support session."/>
              : <>
                  {open.map(row)}
                  {past.length > 0 && <div style={{ ...MONO(), marginTop: "10px" }}>Recent</div>}
                  {past.map(row)}
                </>}
      </Card>
    </div>
  );
}

export { SupportAccessPanel, SUPPORT_ROLES };
