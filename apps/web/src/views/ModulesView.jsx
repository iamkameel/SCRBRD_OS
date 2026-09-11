import { useEffect, useMemo, useState } from "react";
import { roleGrants } from "@scrbrd/policy/roles";
import { D } from "../design/tokens.js";
import { Badge, Btn, Card, Input, Modal, Pill, SectionHeader } from "../ui/primitives.jsx";
import { api } from "../lib/api.js";
import { useLive } from "../lib/live.js";
import { schoolsWhere } from "../lib/session.js";

// ══════════════════════════════════════════════════════
//  MODULES — what the product offers, and to whom
// ══════════════════════════════════════════════════════
//
// THE SENTENCE THIS SCREEN MUST NOT LET ANYBODY BELIEVE is "I have given this
// coach access to Analytics." Nothing here grants anything. The switches are
// an AND on top of the permissions somebody already holds:
//
//     visible  =  RBAC says yes  AND  this module is on for you
//
// Turning a module on for a person who lacks its capability gives them nothing
// at all, and the screen says so in as many words rather than leaving an
// administrator to infer it from a menu that did not change.
//
// THREE LEVELS, SHOWN SEPARATELY. "Analytics is off" is not something anybody
// can act on. "The platform default is on, your school was not granted it, and
// somebody here hid it from two people" is three different conversations, and
// collapsing them into one boolean is how a setting becomes unexplainable.
const KIND = {
  module:  { label: "Module",  icon: "▦", color: D.indigo, sub: "A destination in the menu" },
  feature: { label: "Feature", icon: "⚙", color: D.violet, sub: "Something the product does" },
};

function ModulesView({ role }) {
  const [nonce, bump] = useState(0);

  // Where this person may act. Platform administrators hold no school
  // assignment at all, so this comes back empty for them — which is right:
  // they set the platform default and grant schools, and the per-school view
  // below needs a school to be about.
  const schools = useMemo(() => schoolsWhere("school.feature.manage"), [nonce]);
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? "");
  useEffect(() => { if (!schoolId && schools[0]) setSchoolId(schools[0].id); }, [schools, schoolId]);

  // Both capability checks decide LAYOUT — which controls to draw — and
  // neither decides an outcome. Every write below is refused or allowed by the
  // policies on feature_flag, feature_grant and feature_suppression, under the
  // caller's own identity. A wrong answer here draws a button that then says
  // no, which is a UI bug and never an access one.
  const isPlatform = roleGrants(role, "platform.feature.manage");
  const canSuppress = roleGrants(role, "school.feature.manage");

  const settings = useLive("module_settings", role, nonce);
  const hidden   = useLive("module_suppressions", role, nonce);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [person, setPerson] = useState(null);   // the module being hidden from someone

  const rows = settings.rows.filter((r) => !!r);
  const modules  = rows.filter((r) => r.kind === "module");
  const features = rows.filter((r) => r.kind === "feature");

  const act = async (fn) => {
    setErr(null);
    try { await fn(); bump((n) => n + 1); }
    catch (e) {
      setErr(e.code === "feature_locked"
        ? "That feature is locked by the platform and cannot be granted."
        : e.status === 403 ? "You cannot change that switch."
        : e.code || "Could not change that switch.");
    } finally { setBusy(null); }
  };

  const setPlatform = (key, enabled, reason) => act(async () => {
    setBusy(key);
    await api(`/api/admin/features/${key}`, { method: "POST", body: { enabled, reason } });
  });
  const setGrant = (key, granted) => act(async () => {
    setBusy(key);
    await api(`/api/admin/modules/${key}/grant`, { method: "POST", body: { schoolId, granted } });
  });
  const setHidden = (key, isHidden, reason, personId) => act(async () => {
    setBusy(key);
    await api(`/api/admin/modules/${key}/suppress`, {
      method: "POST", body: { schoolId, personId: personId ?? null, hidden: isHidden, reason } });
  });

  const peopleFor = (key) => hidden.rows.filter((h) => h.key === key && h.personId);

  const Row = ({ r }) => {
    const k = KIND[r.kind] ?? KIND.feature;
    const people = peopleFor(r.key);
    return (
      <div style={{ padding: "14px 16px", borderTop: `1px solid ${D.border}` }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "180px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontFamily: D.body, fontSize: "14px", fontWeight: 600,
                color: r.resolved ? D.textPrimary : D.textMuted }}>
                {r.label || r.key}
              </span>
              {/* The resolved answer, first and largest, because it is the only
                  one anybody arrives asking about. The three levels beneath it
                  are how it got that way. */}
              <Badge color={r.resolved ? D.emerald : D.textMuted}>
                {r.resolved ? "ON" : "OFF"}
              </Badge>
              {r.locked && <Badge color={D.amber}>🔒 Locked by the platform</Badge>}
            </div>
            {r.reason && (
              <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted, marginTop: "4px" }}>
                {r.reason}
              </div>
            )}
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
              <Pill color={r.platform_default ? k.color : D.textMuted}>
                Platform: {r.platform_default ? "on" : "off"}
              </Pill>
              {/* Only shown when a grant row exists. "No grant" and "granted
                  false" are the same resolved answer and different facts, and
                  a pill that appeared for both would tell an administrator a
                  conversation happened that did not. */}
              {r.school_granted != null && (
                <Pill color={r.school_granted ? D.teal : D.rose}>
                  This school: {r.school_granted ? "granted" : "revoked"}
                </Pill>
              )}
              {r.school_hidden && <Pill color={D.rose}>Hidden by this school</Pill>}
              {r.people_hidden > 0 && (
                <Pill color={D.orange}>
                  Hidden from {r.people_hidden} {r.people_hidden === 1 ? "person" : "people"}
                </Pill>
              )}
            </div>
            {people.length > 0 && (
              <div style={{ marginTop: "8px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {people.map((h) => (
                  <button key={h.personId} className="pressBtn"
                    onClick={() => canSuppress && setHidden(r.key, false, null, h.personId)}
                    disabled={!canSuppress}
                    title={canSuppress ? "Show this module to this person again" : undefined}
                    style={{ padding: "4px 10px", borderRadius: D.pill,
                      background: D.surf2, border: `1px solid ${D.border}`,
                      cursor: canSuppress ? "pointer" : "default",
                      fontFamily: D.body, fontSize: "11px", color: D.textSecondary }}>
                    {h.personName || "Someone"}{canSuppress ? " ✕" : ""}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
            {isPlatform && (
              <>
                <Btn size="sm" variant="ghost" disabled={busy === r.key}
                  onClick={() => setPlatform(r.key, !r.platform_default,
                    r.platform_default ? null : "Enabled from the modules screen.")}>
                  {r.platform_default ? "Default off" : "Default on"}
                </Btn>
                {schoolId && (
                  <Btn size="sm" variant="ghost" disabled={busy === r.key || r.locked}
                    onClick={() => setGrant(r.key, !(r.school_granted === true))}>
                    {r.school_granted === true ? "Revoke here" : "Grant here"}
                  </Btn>
                )}
              </>
            )}
            {canSuppress && schoolId && (
              <>
                <Btn size="sm" variant={r.school_hidden ? "primary" : "ghost"} disabled={busy === r.key}
                  onClick={() => setHidden(r.key, !r.school_hidden,
                    r.school_hidden ? null : "Hidden from the modules screen.")}>
                  {r.school_hidden ? "Show at this school" : "Hide at this school"}
                </Btn>
                <Btn size="sm" variant="ghost" disabled={busy === r.key}
                  onClick={() => setPerson(r)}>
                  Hide from someone
                </Btn>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const Section = ({ title, sub, list }) => (
    <Card style={{ marginBottom: "18px" }}>
      <div style={{ padding: "13px 16px" }}>
        <div style={{ fontFamily: D.head, fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em",
          textTransform: "uppercase", color: D.textMuted }}>{title}</div>
        <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted, marginTop: "2px" }}>{sub}</div>
      </div>
      {list.map((r) => <Row key={r.key} r={r}/>)}
    </Card>
  );

  return (
    <div className="os-page">
      <SectionHeader
        title="Modules & features"
        sub="What the product offers this school — and what it never decides"
        color={D.indigo}/>

      {/* Said once, at the top, in the words an administrator would use. The
          alternative is a screen that looks like a permissions editor, and
          somebody concluding they granted a coach access to something. */}
      <Card style={{ padding: "13px 16px", marginBottom: "18px",
        background: D.indigo + "0c", border: `1px solid ${D.indigo}28` }}>
        <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textSecondary, lineHeight: 1.55 }}>
          These switches decide what the product <strong>offers</strong>. They never decide
          who may see what — that stays with a person's role. Switching a module{" "}
          <strong>on</strong> gives nobody access they did not already have; switching one{" "}
          <strong>off</strong> takes the data away from everybody it is off for, not just the
          menu entry.
        </div>
      </Card>

      {schools.length > 1 && (
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" }}>
          {schools.map((s) => (
            <button key={s.id} onClick={() => setSchoolId(s.id)} className="pressBtn"
              style={{ padding: "6px 13px", borderRadius: D.pill, cursor: "pointer",
                background: schoolId === s.id ? D.indigo + "1c" : D.surf1,
                border: `1px solid ${schoolId === s.id ? D.indigo + "55" : D.border}`,
                fontFamily: D.body, fontSize: "12px",
                color: schoolId === s.id ? D.textPrimary : D.textSecondary }}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      {err && (
        <Card style={{ padding: "11px 14px", marginBottom: "16px",
          background: D.rose + "12", border: `1px solid ${D.rose}33` }}>
          <span style={{ fontFamily: D.body, fontSize: "12px", color: D.roseText }}>{err}</span>
        </Card>
      )}

      {settings.loading && (
        <Card style={{ padding: "28px", textAlign: "center" }}>
          <span style={{ color: D.textMuted, fontFamily: D.body, fontSize: "13px" }}>Loading switches…</span>
        </Card>
      )}
      {!settings.loading && settings.error && (
        <Card style={{ padding: "28px", textAlign: "center" }}>
          <span style={{ color: D.textMuted, fontFamily: D.body, fontSize: "13px" }}>
            Could not load the switches ({settings.error}).
          </span>
        </Card>
      )}

      {!settings.loading && !settings.error && (
        <>
          <Section title="Modules" sub={KIND.module.sub} list={modules}/>
          <Section title="Features" sub={KIND.feature.sub} list={features}/>
        </>
      )}

      {person && (
        <HideFromPerson
          module={person} role={role} schoolId={schoolId}
          onClose={() => setPerson(null)}
          onDone={(personId, reason) => {
            setPerson(null);
            setHidden(person.key, true, reason, personId);
          }}/>
      )}
    </div>
  );
}

/**
 * Hiding a module from one person.
 *
 * The list is the school's own people, read through the governed `users`
 * resource — so an administrator picks from exactly the people they may
 * already see, and this screen adds no way to enumerate anybody else.
 */
function HideFromPerson({ module, role, schoolId, onClose, onDone }) {
  const { rows: people, loading } = useLive("users", role);
  const [sel, setSel] = useState(null);
  const [reason, setReason] = useState("");
  const [q, setQ] = useState("");

  const shown = people
    .filter((u) => !schoolId || u.school === schoolId)
    .filter((u) => !q || (u.name || "").toLowerCase().includes(q.toLowerCase()))
    .slice(0, 40);

  return (
    <Modal title={`Hide ${module.label || module.key} from one person`} onClose={onClose} width="520px">
      {/* The thing an administrator is most likely to get wrong, said where
          they are about to do it. */}
      <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, marginBottom: "14px",
        lineHeight: 1.5 }}>
        This hides the module from them. It does not change what they are permitted to see —
        their role still decides that, and it will again the moment this is lifted.
      </div>

      <Input label="Find a person" value={q} onChange={setQ} placeholder="Name"/>

      <div style={{ border: `1px solid ${D.border}`, borderRadius: D.lg, overflow: "hidden",
        maxHeight: "220px", overflowY: "auto", marginBottom: "14px" }}>
        {loading && (
          <div style={{ padding: "18px", textAlign: "center", fontFamily: D.body,
            fontSize: "12px", color: D.textMuted }}>Loading people…</div>
        )}
        {!loading && shown.length === 0 && (
          <div style={{ padding: "18px", textAlign: "center", fontFamily: D.body,
            fontSize: "12px", color: D.textMuted }}>Nobody matches.</div>
        )}
        {shown.map((u, i) => (
          <button key={u.id} onClick={() => setSel(u.id)} className="pressBtn"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
              width: "100%", padding: "9px 12px", cursor: "pointer", textAlign: "left",
              borderTop: i === 0 ? "none" : `1px solid ${D.border}`,
              background: sel === u.id ? D.indigo + "14" : "transparent", border: "none" }}>
            <span style={{ fontFamily: D.body, fontSize: "12px", color: D.textPrimary }}>{u.name}</span>
            <span style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted }}>{u.role}</span>
          </button>
        ))}
      </div>

      <Input label="Why (optional)" value={reason} onChange={setReason}
        placeholder="On leave for the term"/>

      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <Btn onClick={onClose} variant="ghost">Cancel</Btn>
        <Btn onClick={() => onDone(sel, reason || null)} disabled={!sel}>Hide from this person</Btn>
      </div>
    </Modal>
  );
}

export { ModulesView };
