import { useMemo, useState } from "react";
import { roleGrants } from "@scrbrd/policy/roles";
import { D } from "../design/tokens.js";
import { Badge, Btn, Card, EmptyState, Input, Modal, Pill, SectionHeader } from "../ui/primitives.jsx";
import { api } from "../lib/api.js";
import { useLive } from "../lib/live.js";
import { profile } from "../lib/session.js";

// ══════════════════════════════════════════════════════
//  SPONSORS — the boards a school sells, and the terms behind them
// ══════════════════════════════════════════════════════
//
// Two screens' worth of information that must not be one screen's worth of
// permission. A sponsor's NAME and LOGO are meant to be seen — that is what
// the sponsor is paying for, and they end up on a public overlay. What the
// board was SOLD FOR is commercially confidential, masked per row behind
// sponsorship.finance.read inside sponsorship_masked.
//
// This file renders both and enforces neither. The mask has already happened
// by the time a row reaches here: a director of sport's placement arrives with
// contract_value_zar null, and there is no field on it for a bug in this
// component to reveal.
const PLACEMENTS = {
  broadcast_overlay: { label: "Broadcast overlay", icon: "📺", color: D.violet,
                       sub: "On the stream, over the score" },
  scorecard_footer:  { label: "Scorecard footer",  icon: "📋", color: D.sky,
                       sub: "Under the scorecard" },
  fixture_list:      { label: "Fixture list",      icon: "🗓", color: D.teal,
                       sub: "Beside the season's fixtures" },
  ground_board:      { label: "Ground board",      icon: "🏟", color: D.emerald,
                       sub: "At the boundary" },
};

/**
 * The schools this person could sign a sponsor FOR.
 *
 * Derived from their own assignments, and used to fill in a field the route
 * requires — not to decide anything. `sponsor` is anchored on school_id and
 * the INSERT policy evaluates sponsorship.manage against it, so naming the
 * wrong school here produces a refusal rather than a sponsor on somebody
 * else's scoreboard. What this avoids is a form that cannot be submitted
 * because the client had no school to put in it.
 *
 * A list rather than a value because people hold assignments at more than one
 * school — Sarah is a director of sport at Hilton and a parent at Westville —
 * and a form that silently picked the first would be guessing on their behalf.
 */
function manageableSchools() {
  const seen = new Map();
  for (const a of profile()?.assignments ?? []) {
    if (!a.school || !roleGrants(a.role, "sponsorship.manage")) continue;
    if (!seen.has(a.school)) seen.set(a.school, { id: a.school, name: a.schoolName || "This school" });
  }
  return [...seen.values()];
}

const rand = (n) =>
  "R" + Math.round(n).toLocaleString("en-ZA").replace(/,/g, " ");

function SponsorsView({ role }) {
  // A nonce rather than a refetch handle: useLive re-runs when it changes, and
  // a write here has to be followed by a READ THROUGH THE SAME PATH. Pushing
  // the row this component just posted into local state would show a school
  // office a placement that the server may have shaped differently — and would
  // show it with terms this reader may not be entitled to see.
  const [nonce, bump] = useState(0);
  const sponsors  = useLive("sponsors", role, nonce);
  const deals     = useLive("sponsorships", role, nonce);
  const cats      = useLive("sponsor_categories", role, nonce);

  const [signing, setSigning] = useState(false);
  const [placing, setPlacing] = useState(null);   // the sponsor being placed
  const [sel, setSel] = useState(null);

  /**
   * WHETHER THIS READER IS ENTITLED TO THE TERMS — asked only to choose a WORD.
   *
   * A masked value and an unrecorded one both arrive as null, and they mean
   * opposite things: "you may not see this" versus "nobody wrote it down". A
   * screen that printed the same dash for both would tell a bursar their
   * contracts have no values in them.
   *
   * So the capability is consulted here, and it decides a LABEL and nothing
   * else. The row already left the server masked; if this answer were wrong in
   * either direction the worst outcome is a misleading caption, never a
   * disclosure. That is the only shape a client-side capability check may
   * take — the same one the navigation uses.
   */
  const entitledToTerms = roleGrants(role, "sponsorship.finance.read");
  // Computed once per render from the session, not from `role`: the role
  // picker in the top bar changes what a demo shows, and a real write has to
  // name a school this person is actually assigned to.
  const schools = useMemo(manageableSchools, [nonce]);
  const money = (v) =>
    v != null ? rand(v) : (entitledToTerms ? "Not recorded" : "Confidential");

  const bySponsor = useMemo(() => {
    const by = new Map();
    for (const d of deals.rows) by.set(d.sponsorId, [...(by.get(d.sponsorId) ?? []), d]);
    return by;
  }, [deals.rows]);

  const selected = sponsors.rows.find((s) => s.id === sel) ?? null;
  const loading = sponsors.loading || deals.loading;
  const error = sponsors.error || deals.error;
  // Named for what it means here — the rows came from the server rather than
  // the demo fixture — and deliberately not `signedIn`, which is a real export
  // of lib/api.js and would read as a call to it.
  const isLive = sponsors.live;

  // Committed surfaces, for the top line. Counted over the placements that are
  // running TODAY — a contract that ended in March is not a committed board.
  const running = deals.rows.filter((d) => d.running);
  const committed = new Set(running.map((d) => d.placement));

  return (
    <div className="os-page">
      <SectionHeader
        title="Sponsors"
        sub="The boards a school sells — and the terms that stay between the school and the sponsor"
        color={D.amber}/>

      {loading && (
        <Card style={{ padding: "28px", textAlign: "center" }}>
          <span style={{ color: D.textMuted, fontFamily: D.body, fontSize: "13px" }}>Loading sponsorships…</span>
        </Card>
      )}
      {/* "We could not ask" and "there are none" are different sentences and
          only one of them is true at a time. */}
      {!loading && error && (
        <Card style={{ padding: "28px", textAlign: "center" }}>
          <span style={{ color: D.textMuted, fontFamily: D.body, fontSize: "13px" }}>
            Could not load sponsorships ({error}).
          </span>
        </Card>
      )}

      {!loading && !error && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: "12px", flexWrap: "wrap", marginBottom: "18px" }}>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {Object.entries(PLACEMENTS).map(([k, p]) => {
                const on = committed.has(k);
                return (
                  <Pill key={k} color={on ? p.color : D.textMuted}>
                    {p.icon} {p.label}{on ? " · sold" : " · open"}
                  </Pill>
                );
              })}
            </div>
            {isLive && schools.length > 0 && (
              <Btn onClick={() => setSigning(true)} size="sm">＋ Sign a sponsor</Btn>
            )}
          </div>

          {sponsors.rows.length === 0 ? (
            <EmptyState
              icon="🤝"
              title="No sponsors yet"
              sub={isLive
                ? "A school administrator or the finance office can sign a sponsor and place them on a surface."
                : "Sign in to see your school's sponsors."}/>
          ) : (
            <div className="sc-grid-2" style={{ alignItems: "start" }}>
              <Card>
                <div style={{ padding: "13px 16px", borderBottom: `1px solid ${D.border}` }}>
                  <span style={{ fontFamily: D.head, fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em",
                    textTransform: "uppercase", color: D.textMuted }}>
                    {sponsors.rows.length} {sponsors.rows.length === 1 ? "sponsor" : "sponsors"}
                  </span>
                </div>
                <div style={{ padding: "8px" }}>
                  {sponsors.rows.map((s) => {
                    const on = sel === s.id;
                    const mine = bySponsor.get(s.id) ?? [];
                    return (
                      <button key={s.id} onClick={() => setSel(on ? null : s.id)} className="pressBtn"
                        style={{ display: "flex", alignItems: "center", gap: "11px", width: "100%",
                          padding: "10px 11px", marginBottom: "3px", borderRadius: D.md, cursor: "pointer",
                          textAlign: "left", background: on ? D.amber + "12" : "transparent",
                          border: `1px solid ${on ? D.amber + "33" : "transparent"}` }}>
                        {/* The board as it would be drawn: the logo text and
                            colour a school chose, not a generic swatch. */}
                        <span style={{ display: "flex", alignItems: "center", justifyContent: "center",
                          width: "48px", height: "34px", borderRadius: D.sm, flexShrink: 0,
                          background: s.logoBg || D.surf3, border: `1px solid ${D.border}`,
                          fontFamily: D.head, fontSize: "8px", fontWeight: 800, letterSpacing: "0.04em",
                          color: "#fff", overflow: "hidden", whiteSpace: "nowrap" }}>
                          {s.logoText || s.name.slice(0, 8).toUpperCase()}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: D.body, fontSize: "13px", fontWeight: 600,
                            color: s.active ? D.textPrimary : D.textMuted, overflow: "hidden",
                            textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.name}
                          </div>
                          <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted }}>
                            {s.category.replace(/_/g, " ")}
                            {mine.length ? ` · ${mine.length} placement${mine.length === 1 ? "" : "s"}` : " · not placed"}
                          </div>
                        </div>
                        {!s.active && <Badge color={D.textMuted}>Inactive</Badge>}
                        {/* A brand signed under a category that was later
                            prohibited. The row stays; saying nothing about it
                            would be the screen telling a school all is well. */}
                        {s.categoryPermitted === false && <Badge color={D.rose}>Category refused</Badge>}
                      </button>
                    );
                  })}
                </div>
              </Card>

              {selected ? (
                <Card style={{ padding: "18px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "13px", marginBottom: "16px" }}>
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "center",
                      width: "70px", height: "48px", borderRadius: D.md, flexShrink: 0,
                      background: selected.logoBg || D.surf3, border: `1px solid ${D.borderMed}`,
                      fontFamily: D.head, fontSize: "10px", fontWeight: 800, color: "#fff",
                      overflow: "hidden", whiteSpace: "nowrap" }}>
                      {selected.logoText || selected.name.slice(0, 8).toUpperCase()}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: D.head, fontSize: "17px", fontWeight: 800, color: D.textPrimary }}>
                        {selected.name}
                      </div>
                      <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted, marginTop: "2px" }}>
                        {selected.category.replace(/_/g, " ")}
                      </div>
                    </div>
                  </div>

                  {selected.categoryPermitted === false && (
                    <div style={{ padding: "11px 13px", borderRadius: D.md, marginBottom: "14px",
                      background: D.rose + "12", border: `1px solid ${D.rose}33` }}>
                      <div style={{ fontFamily: D.head, fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em",
                        textTransform: "uppercase", color: D.roseText, marginBottom: "4px" }}>
                        This category may not be placed on school sport
                      </div>
                      <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textSecondary }}>
                        {selected.categoryNote}
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    marginBottom: "8px" }}>
                    <span style={{ fontFamily: D.head, fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em",
                      textTransform: "uppercase", color: D.textMuted }}>
                      Placements ({(bySponsor.get(selected.id) ?? []).length})
                    </span>
                    {isLive && schools.length > 0 && selected.active
                      && selected.categoryPermitted !== false && (
                      <Btn onClick={() => setPlacing(selected)} size="sm" variant="ghost">＋ Place</Btn>
                    )}
                  </div>

                  {(bySponsor.get(selected.id) ?? []).length === 0 ? (
                    <div style={{ padding: "22px", textAlign: "center", border: `1px solid ${D.border}`,
                      borderRadius: D.lg }}>
                      <span style={{ color: D.textMuted, fontFamily: D.body, fontSize: "12px" }}>
                        Signed, but not on any surface yet.
                      </span>
                    </div>
                  ) : (
                    <div style={{ border: `1px solid ${D.border}`, borderRadius: D.lg, overflow: "hidden" }}>
                      {(bySponsor.get(selected.id) ?? []).map((d, i) => {
                        const p = PLACEMENTS[d.placement] ?? { label: d.placement, icon: "◻", color: D.textMuted };
                        return (
                          <div key={d.id}
                            style={{ padding: "11px 13px", borderTop: i === 0 ? "none" : `1px solid ${D.border}`,
                              background: d.running ? "transparent" : D.surf0 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                              gap: "10px", marginBottom: "5px" }}>
                              <span style={{ fontFamily: D.body, fontSize: "12px", color: D.textPrimary }}>
                                {p.icon} {p.label}
                                {d.matchId && (
                                  <span style={{ color: D.textMuted }}> · one fixture</span>
                                )}
                              </span>
                              <Badge color={d.running ? p.color : D.textMuted}>
                                {d.running ? "Running" : "Not running"}
                              </Badge>
                            </div>
                            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap",
                              fontFamily: D.mono, fontSize: "11px", color: D.textSecondary }}>
                              <span>{d.startsOn} → {d.endsOn}</span>
                              {/* Confidential vs Not recorded — see
                                  entitledToTerms above for why the two must
                                  not both render as a dash. */}
                              <span style={{ color: d.contractValueZar == null ? D.textMuted : D.textSecondary }}>
                                {money(d.contractValueZar)}
                              </span>
                              <span style={{ color: d.schoolSharePct == null ? D.textMuted : D.textSecondary }}>
                                {d.schoolSharePct == null
                                  ? (entitledToTerms ? "share not recorded" : "share confidential")
                                  : `${d.schoolSharePct}% to the school`}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!entitledToTerms && (bySponsor.get(selected.id) ?? []).length > 0 && (
                    <div style={{ marginTop: "10px", fontFamily: D.body, fontSize: "11px", color: D.textMuted }}>
                      Contract values are held by the finance office. This screen never received them.
                    </div>
                  )}
                </Card>
              ) : (
                <Card style={{ padding: "34px", textAlign: "center" }}>
                  <span style={{ color: D.textMuted, fontFamily: D.body, fontSize: "13px" }}>
                    Select a sponsor to see where they appear.
                  </span>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {signing && (
        <SignSponsor
          categories={cats.rows}
          schools={schools}
          onClose={() => setSigning(false)}
          onDone={() => { setSigning(false); bump((n) => n + 1); }}/>
      )}
      {placing && (
        <PlaceSponsor
          sponsor={placing}
          entitledToTerms={entitledToTerms}
          onClose={() => setPlacing(null)}
          onDone={() => { setPlacing(null); bump((n) => n + 1); }}/>
      )}
    </div>
  );
}

/**
 * Signing a brand.
 *
 * THE REFUSED CATEGORIES ARE SHOWN, and that is the point of the form.
 *
 * scrbrd-beta-2's category list simply did not mention alcohol, gambling or
 * tobacco. A list that omits them teaches a school office nothing and leaves
 * them to discover the refusal by being refused — or, worse, never to think
 * about it at all, so that widening the list later is an edit rather than a
 * decision. Here they are present, unclickable, each with the reason written
 * out beside it. The conversation has already happened by the time somebody
 * reaches for the dropdown.
 *
 * The form does NOT decide the refusal. sponsor_category_gate in db/08 does,
 * and the error it raises is rendered verbatim below — so a category prohibited
 * in the database but not yet reflected here is still refused, and says why.
 */
function SignSponsor({ categories, schools, onClose, onDone }) {
  const [name, setName] = useState("");
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? "");
  const [category, setCategory] = useState("");
  const [logoText, setLogoText] = useState("");
  const [logoBg, setLogoBg] = useState("#0b3d2e");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const allowed  = categories.filter((c) => c.permitted);
  const refused  = categories.filter((c) => !c.permitted);

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      await api("/api/sponsors", { method: "POST", body: {
        schoolId, name, category,
        logoText: logoText || null, logoBg: logoBg || null } });
      onDone();
    } catch (e) {
      // The server's detail, not a code. "you may not advertise betting to
      // children" and "that hex colour is malformed" are different
      // conversations and a single "invalid" flattens both.
      setErr(e.status === 403 ? "You cannot sign a sponsor for this school."
           : e.code === "category_refused" ? "That category may not be placed on school sport."
           : e.code || "Could not sign this sponsor.");
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Sign a sponsor" onClose={onClose} width="560px">
      {/* Shown only when there is a decision. One school is not a choice, and
          a dropdown with a single option is a control that asks a person to
          confirm something they cannot change. */}
      {schools.length > 1 && (
        <div style={{ marginBottom: "14px" }}>
          <span style={{ display: "block", fontFamily: D.head, fontSize: "10px", fontWeight: 700,
            color: D.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "6px" }}>
            School
          </span>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {schools.map((s) => (
              <button key={s.id} onClick={() => setSchoolId(s.id)} className="pressBtn"
                style={{ padding: "6px 12px", borderRadius: D.pill, cursor: "pointer",
                  background: schoolId === s.id ? D.amber + "1c" : D.surf2,
                  border: `1px solid ${schoolId === s.id ? D.amber + "55" : D.border}`,
                  fontFamily: D.body, fontSize: "12px",
                  color: schoolId === s.id ? D.textPrimary : D.textSecondary }}>
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <Input label="Sponsor name" value={name} onChange={setName} placeholder="Ridgeway Bank"/>

      <div style={{ marginBottom: "14px" }}>
        <span style={{ display: "block", fontFamily: D.head, fontSize: "10px", fontWeight: 700,
          color: D.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "6px" }}>
          Category
        </span>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
          {allowed.map((c) => {
            const on = category === c.name;
            return (
              <button key={c.name} onClick={() => setCategory(c.name)} className="pressBtn"
                style={{ padding: "6px 12px", borderRadius: D.pill, cursor: "pointer",
                  background: on ? D.amber + "1c" : D.surf2,
                  border: `1px solid ${on ? D.amber + "55" : D.border}`,
                  fontFamily: D.body, fontSize: "12px",
                  color: on ? D.textPrimary : D.textSecondary }}>
                {c.name.replace(/_/g, " ")}
              </button>
            );
          })}
        </div>

        {refused.length > 0 && (
          <div style={{ border: `1px solid ${D.border}`, borderRadius: D.lg, overflow: "hidden" }}>
            <div style={{ padding: "8px 12px", background: D.surf0,
              fontFamily: D.head, fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em",
              textTransform: "uppercase", color: D.textMuted }}>
              Not available on school sport
            </div>
            {refused.map((c, i) => (
              <div key={c.name} aria-disabled="true"
                style={{ padding: "9px 12px", borderTop: i === 0 ? "none" : `1px solid ${D.border}` }}>
                <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted,
                  textDecoration: "line-through" }}>
                  {c.name.replace(/_/g, " ")}
                </div>
                <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted, marginTop: "2px" }}>
                  {c.note}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "12px" }}>
        <div style={{ flex: 1 }}>
          <Input label="Board text" value={logoText} onChange={(v) => setLogoText(v.slice(0, 24))}
            placeholder="RIDGEWAY"/>
        </div>
        <div style={{ width: "140px" }}>
          <Input label="Board colour" value={logoBg} onChange={setLogoBg} placeholder="#0b3d2e"/>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center",
          width: "88px", height: "40px", borderRadius: D.sm,
          background: /^#[0-9a-fA-F]{6}$/.test(logoBg) ? logoBg : D.surf3,
          border: `1px solid ${D.border}`, fontFamily: D.head, fontSize: "9px",
          fontWeight: 800, color: "#fff", overflow: "hidden", whiteSpace: "nowrap" }}>
          {logoText || (name ? name.slice(0, 8).toUpperCase() : "BOARD")}
        </span>
        <span style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted }}>
          How it appears on an overlay.
        </span>
      </div>

      {err && (
        <div style={{ padding: "10px 12px", borderRadius: D.md, marginBottom: "14px",
          background: D.rose + "12", border: `1px solid ${D.rose}33`,
          fontFamily: D.body, fontSize: "12px", color: D.roseText }}>
          {err}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <Btn onClick={onClose} variant="ghost">Cancel</Btn>
        <Btn onClick={submit} disabled={busy || !name.trim() || !category || !schoolId}>
          {busy ? "Signing…" : "Sign sponsor"}
        </Btn>
      </div>
    </Modal>
  );
}

/**
 * Placing them on a surface, for a period, on terms.
 *
 * The money fields are shown to everybody who can reach this form, and that is
 * not a hole: writing a contract value requires sponsorship.manage, and
 * READING one back requires sponsorship.finance.read. A school administrator
 * can record what was agreed and will not see it again on the placement list.
 * That is the honest consequence of the split and is said out loud below,
 * rather than left for somebody to discover.
 */
function PlaceSponsor({ sponsor, entitledToTerms, onClose, onDone }) {
  const today = new Date().toISOString().slice(0, 10);
  const [placement, setPlacement] = useState("ground_board");
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [value, setValue] = useState("");
  const [share, setShare] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      await api("/api/sponsorships", { method: "POST", body: {
        sponsorId: sponsor.id, placement, startsOn, endsOn,
        contractValueZar: value === "" ? null : Number(value),
        schoolSharePct: share === "" ? null : Number(share) } });
      onDone();
    } catch (e) {
      setErr(e.status === 403 ? "You cannot place a sponsor for this school."
           : e.code === "ends_before_starts" ? "A contract cannot end before it starts."
           : e.code || "Could not place this sponsor.");
    } finally { setBusy(false); }
  };

  return (
    <Modal title={`Place ${sponsor.name}`} onClose={onClose} width="560px">
      <div style={{ marginBottom: "14px" }}>
        <span style={{ display: "block", fontFamily: D.head, fontSize: "10px", fontWeight: 700,
          color: D.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "6px" }}>
          Surface
        </span>
        <div style={{ display: "grid", gap: "6px" }}>
          {Object.entries(PLACEMENTS).map(([k, p]) => {
            const on = placement === k;
            return (
              <button key={k} onClick={() => setPlacement(k)} className="pressBtn"
                style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%",
                  padding: "9px 12px", borderRadius: D.md, cursor: "pointer", textAlign: "left",
                  background: on ? p.color + "14" : D.surf2,
                  border: `1px solid ${on ? p.color + "44" : D.border}` }}>
                <span style={{ fontSize: "15px" }}>{p.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: D.body, fontSize: "12px",
                    fontWeight: 600, color: D.textPrimary }}>{p.label}</span>
                  <span style={{ display: "block", fontFamily: D.body, fontSize: "11px",
                    color: D.textMuted }}>{p.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: "12px" }}>
        <div style={{ flex: 1 }}><Input label="Runs from" value={startsOn} onChange={setStartsOn} type="date"/></div>
        <div style={{ flex: 1 }}><Input label="Runs to"   value={endsOn}   onChange={setEndsOn}   type="date"/></div>
      </div>

      <div style={{ display: "flex", gap: "12px" }}>
        <div style={{ flex: 1 }}>
          <Input label="Contract value (ZAR)" value={value} onChange={setValue} type="number" placeholder="185000"/>
        </div>
        <div style={{ width: "160px" }}>
          <Input label="School's share %" value={share} onChange={setShare} type="number" placeholder="70"/>
        </div>
      </div>
      {!entitledToTerms && (
        <div style={{ marginTop: "-4px", marginBottom: "14px", fontFamily: D.body,
          fontSize: "11px", color: D.textMuted }}>
          You can record the terms here and will not see them again — contract values are
          readable only by the finance office.
        </div>
      )}

      {err && (
        <div style={{ padding: "10px 12px", borderRadius: D.md, marginBottom: "14px",
          background: D.rose + "12", border: `1px solid ${D.rose}33`,
          fontFamily: D.body, fontSize: "12px", color: D.roseText }}>
          {err}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <Btn onClick={onClose} variant="ghost">Cancel</Btn>
        <Btn onClick={submit} disabled={busy || !startsOn || !endsOn}>
          {busy ? "Placing…" : "Place sponsor"}
        </Btn>
      </div>
    </Modal>
  );
}

export { SponsorsView };
