import { useState, useEffect } from "react";
import SCRBRD_LOGO from "../assets/scrbrd-logo.jpg";
import { ROLES } from "../design/roles.js";
import { T, clr } from "../design/tokens.js";
import { mode as apiMode, signIn, signInWithCode, devLoginAvailable } from "../lib/session.js";
import { Icon } from "../ui/icons.jsx";

// ══════════════════════════════════════════════════════
//  LOGIN PAGE
//
//  Two modes, and the difference is never hidden.
//
//  LIVE — an API is reachable. Sign-in is real: the token is minted server
//    side and a failure is a failure. It does NOT fall back to the demo
//    accounts below, because a person who typed the wrong thing and got in
//    anyway has been told a lie about a permission decision, and every screen
//    they see afterwards inherits that lie.
//
//  DEMO — no API. Mock accounts, mock data, and the page says so. This is a
//    legitimate way to run SCRBRD: the product has to open on a laptop at a
//    school with nothing behind it. What it must not do is look identical to
//    the real thing.
// ══════════════════════════════════════════════════════

// The pilot's seeded people, mirroring db/98_seed_pilot.sql. A development
// convenience, shown only when the server has dev login switched on — there is
// deliberately no endpoint that lists accounts, because that is an enumeration
// oracle, so this list is maintained by hand alongside the seed.
const PILOT_ACCOUNTS = [
  { email: "scorer@example.invalid",  label: "Scorer",         role: "scorer" },
  { email: "coach@example.invalid",   label: "Head Coach",     role: "coach" },
  { email: "sarah@example.invalid",   label: "Director of Sport", role: "directorofsport" },
  { email: "parent@example.invalid",  label: "Parent",         role: "guardian" },
  // A pupil reading their OWN file. Self-access is a built, policy-enforced
  // role — a boy may read his own medical record and his own attribute scores —
  // and until now there was no way into the demo as one, so the boundary it
  // draws could not be seen. It is also the account that shows what a pupil
  // does NOT get: the coaches' development notes about him.
  { email: "pillay@example.invalid",  label: "Player",         role: "player" },
  { email: "medical@example.invalid", label: "Medical",        role: "medical" },
  // A genuine spectator. The account seeded as spectator@example.invalid holds
  // a PLAYER assignment, and the player bundle includes medical.status.read —
  // so it is the wrong account to demonstrate what a bystander can see, and
  // the wrong one to test with.
  { email: "watcher@example.invalid", label: "Spectator",      role: "spectator" },
  // The bursar. The only demo account holding sponsorship.finance.read, and
  // therefore the only one that can show the commercial mask doing anything:
  // every other account here sees a placement with its contract value blanked,
  // which on its own is indistinguishable from a value nobody recorded.
  { email: "bursar@example.invalid",  label: "Finance",        role: "finance" },
  // The body that accredits officials: competition administration holds the
  // register, and no school role does — which is the boundary the Officials
  // screen draws.
  { email: "league@example.invalid",  label: "League Admin",   role: "competitionadmin" },
  // The head. The only demo account holding sponsorship.exclusivity.waive —
  // the one decision the commercial roles deliberately cannot take for
  // themselves — so it is the only one that can show the waiver working.
  { email: "principal@example.invalid", label: "Principal",    role: "principal" },
  // The office. Answers requests and keeps the clearance register; without
  // an account on this list the whole onboarding path could only be walked
  // through the API.
  { email: "registrar@example.invalid", label: "Registrar",    role: "schooladmin" },
];

// `liveOnly`: opened from the pad of a live fixture to send what it has saved
// (SCRBRD-078). There is a server behind that pad whatever the check below
// says — the phone may have had no signal when it asked — so the demo is never
// offered and a failed sign-in is a failed sign-in. `onBack` returns to the pad.
function LoginPage({ onLogin, onSignUp, liveOnly = false, onBack }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  // Whether THIS SERVER accepts the development sign-in. Asked, not assumed.
  const [devLogin, setDevLogin] = useState(false);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [liveState, setLive]    = useState(null);   // null = still asking
  const live = liveOnly ? true : liveState;

  useEffect(() => { apiMode().then(m => setLive(m === "live")).catch(() => setLive(false)); }, []);
  useEffect(() => { devLoginAvailable().then(setDevLogin).catch(() => setDevLogin(false)); }, []);

  // Mock credentials map: email → {role, name}
  const MOCK_USERS = {
    "admin@hilton.co.za":       { role:"superadmin",    name:"Admin User",            pw:"admin123" },
    "gsutherland@hilton.co.za": { role:"directorofsport", name:"Graham Sutherland",   pw:"sports123" },
    "c.hendricks@hilton.co.za": { role:"coach",         name:"Craig Hendricks",       pw:"coach123" },
    "james@hilton.co.za":       { role:"player",        name:"James Whitfield",       pw:"player123" },
    "helen.w@gmail.com":        { role:"guardian",      name:"Helen Whitfield",       pw:"parent123" },
    "bwessels@hilton.co.za":    { role:"scorer",        name:"Brian Wessels",         pw:"scorer123" },
    "emzimba@hilton.co.za":     { role:"facilities",    name:"Ernest Mzimba",         pw:"ground123" },
    "skhumalo@hilton.co.za":    { role:"medical",       name:"Dr Khumalo",            pw:"medic123" },
  };

  const handleLogin = async () => {
    setLoading(true); setError("");

    // Live: the server decides. No fallback — see the header.
    if (live) {
      try {
        // A CODE is the real path. SCRBRD sends no email, so the school office
        // issues one and hands it over; this is the exchange that turns it into
        // a session bound to this device.
        //
        // With the box empty, the seeded accounts sign in through the
        // development route — but only where the SERVER says it accepts it,
        // which is never in production. Offering it anywhere else would be a
        // button that works on a laptop and errors in front of a school.
        const code = password.trim();
        const p = code
          ? await signInWithCode(email.trim(), code)
          : devLogin
            ? await signIn(email.trim())
            : (() => { throw Object.assign(new Error("code_required"), { code: "code_required" }); })();
        onLogin(primaryRole(p), p?.user?.name || email, p);
      } catch (e) {
        setError(
          e.code === "code_required"
            ? "Enter the sign-in code your school office gave you."
          : e.code === "invalid_or_expired_code"
            ? "That code is not valid any more. Ask the office for a new one."
          : e.code === "no_such_user"
            ? "No account for that address on this server."
          : e.code === "dev_login_disabled"
            ? "This server does not accept development sign-in."
            : "Could not sign in. The server may be unreachable.");
      }
      setLoading(false);
      return;
    }

    await new Promise(r=>setTimeout(r,700));
    const user = MOCK_USERS[email.toLowerCase()];
    if (user && user.pw === password) {
      onLogin(user.role, user.name);
    } else if (user) {
      setError("Incorrect password. Try: " + user.pw);
    } else {
      setError("No account found. Sign up or try a demo account below.");
    }
    setLoading(false);
  };

  /**
   * Which role to draw the workspace with, when someone holds several.
   *
   * A placeholder for the real thing. The workspace is meant to be assembled
   * from ALL of a person's assignments — Sarah is a director of sport at one
   * school and a guardian at another, and neither view is the whole truth.
   * Until the dashboard engine exists, the shell needs one role to lay out
   * navigation, so this picks the widest. It affects presentation only: every
   * request is authorised server-side against every assignment, so choosing
   * wrong shows the wrong menu, never the wrong data.
   */
  const primaryRole = (p) => {
    const held = (p?.assignments ?? []).map(a => a.role).filter(r => ROLES[r]);
    // Widest first. Every policy role has an identity now, so an unranked one
    // still lands somewhere real rather than on ROLES[undefined] — which is
    // what an empty shell looked like: signed in, no navigation, no name.
    const RANK = ["platformadmin","principal","directorofsport","schooladmin","sportsadmin",
                  "coach","assistantcoach","teammanager","analyst","scorer","medical",
                  "guardian","player"];
    return RANK.find(r => held.includes(r)) ?? held[0] ?? "spectator";
  };

  // The demonstration's front door. There is no OAuth behind it and there
  // never was: it hands the shell a role and a name, and the shell runs on
  // mock data. That is fine on a laptop with no server — it is what the demo
  // is for — and it is a lie on the live site, where it used to sit above the
  // real sign-in labelled "Continue with Google". A school evaluating the
  // product clicked it, saw a working roster, and had no way to know that
  // nothing on screen was theirs or would be kept. So it renders only when
  // there is no server, and says what it does.
  const handleDemoEntry = async () => {
    setOauthLoading(true);
    await new Promise(r=>setTimeout(r,600));
    onLogin("schooladmin","Demo School Admin");
    setOauthLoading(false);
  };

  const DEMO_ACCOUNTS = [
    { role:"superadmin",   email:"admin@hilton.co.za",       pw:"admin123",   label:"Super Admin" },
    { role:"coach",        email:"c.hendricks@hilton.co.za", pw:"coach123",   label:"Head Coach" },
    { role:"player",       email:"james@hilton.co.za",       pw:"player123",  label:"Player" },
    { role:"guardian",     email:"helen.w@gmail.com",        pw:"parent123",  label:"Parent" },
  ];

  return (
    <div style={{minHeight:"100vh",background:T.surface.canvas,display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
      <div style={{width:"100%",maxWidth:"420px"}}>
        <div style={{textAlign:"center",marginBottom:"32px"}}>
          <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"30px",objectFit:"contain",filter:"brightness(1.15)",marginBottom:"16px"}}/>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:"22px",fontWeight:800,color:T.content.primary,marginBottom:"6px"}}>Welcome back</div>
          <div data-testid="login-subtitle" style={{fontFamily:"'DM Sans',sans-serif",fontSize:"13px",color:T.content.tertiary}}>
            {liveOnly ? "Sign in to send what the scorer has saved on this device. Nothing is lost while you do."
                      : "Sign in to your SCRBRD account"}
          </div>
          {onBack&&(
            <button onClick={onBack} className="pressBtn" data-testid="login-back-to-pad"
              style={{marginTop:"10px",background:"none",border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:"12px",color:T.brand.blueText}}>
              ‹ Back to the scorer
            </button>
          )}
        </div>

        <div style={{borderRadius:"20px",border:`1px solid ${T.line.normal}`,background:T.fill.panel,padding:"28px",backdropFilter:"blur(20px)"}}>
          {/* Demo entry — only where there is no server. See handleDemoEntry. */}
          {live === false && <>
          <button onClick={handleDemoEntry} disabled={oauthLoading} data-testid="login-demo" className="pressBtn" style={{width:"100%",padding:"12px",borderRadius:"12px",cursor:"pointer",background:T.fill.field,border:`1px solid ${T.line.normal}`,display:"flex",alignItems:"center",justifyContent:"center",gap:"10px",marginBottom:"20px",transition:"all .2s"}}>
            <span aria-hidden="true" style={{color:T.content.secondary,fontSize:"16px"}}><Icon name="play"/></span>
            <span style={{fontFamily:"'Syne',sans-serif",fontSize:"13px",fontWeight:700,color:T.content.primary}}>{oauthLoading?"Opening the demo…":"Explore the demo — nothing is saved"}</span>
          </button>

          <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"20px"}}>
            <div style={{flex:1,height:"1px",background:T.fill.track}}/>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:T.content.tertiary}}>or email</span>
            <div style={{flex:1,height:"1px",background:T.fill.track}}/>
          </div>
          </>}

          {/* Email + password */}
          {[
            { id:"login-email", label:"Email", type:"email", autoComplete:"email", value:email, onChange:setEmail, placeholder:"you@school.co.za" },
            live
              ? { id:"login-password", label:"Sign-in code", type:"password", autoComplete:"one-time-code",
                  value:password, onChange:setPassword,
                  placeholder: devLogin ? "from your school office — or leave blank for a demo account"
                                        : "from your school office" }
              : { id:"login-password", label:"Password", type:"password", autoComplete:"current-password", value:password, onChange:setPassword, placeholder:"••••••••" },
          ].map(f=>(
            <div key={f.label} style={{marginBottom:"14px"}}>
              {/* A real <label htmlFor>, not a styled div. The div looked the
                  same and did none of the work: no accessible name, no click
                  target, nothing for voice control to say. */}
              <label htmlFor={f.id} style={{display:"block",fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.content.tertiary,marginBottom:"6px"}}>{f.label}</label>
              <input id={f.id} value={f.value} type={f.type} autoComplete={f.autoComplete}
                onChange={e=>f.onChange(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&handleLogin()}
                placeholder={f.placeholder}
                aria-invalid={error?true:undefined}
                aria-describedby={error?"login-error":undefined}
                style={{width:"100%",padding:"11px 14px",borderRadius:"10px",background:T.fill.field,border:`1px solid ${error?clr(T.semantic.critical,0.5):T.line.normal}`,fontFamily:"'DM Sans',sans-serif",fontSize:"14px",color:T.content.primary,boxSizing:"border-box"}}/>
            </div>
          ))}

          {/* role="alert" so a failed sign-in is announced. Without it the
              only signal is a colour change, which someone using a screen
              reader never learns about at all — they press Sign In and
              nothing appears to happen. */}
          {error&&<div id="login-error" role="alert" style={{fontFamily:"'DM Sans',sans-serif",fontSize:"12px",color:T.semantic.criticalText,marginBottom:"12px",padding:"8px 12px",borderRadius:"8px",background:clr(T.semantic.critical,0.1),border:`1px solid ${clr(T.semantic.critical,0.2)}`}}>{error}</div>}

          <button onClick={handleLogin} disabled={loading} className="pressBtn" style={{width:"100%",padding:"12px",borderRadius:"12px",cursor:"pointer",background:T.light.action,border:"none",fontFamily:"'Syne',sans-serif",fontSize:"13px",fontWeight:700,color:T.light.ink,marginBottom:"14px",boxShadow:`0 4px 20px ${clr(T.brand.blue,0.35)}`}}>
            {loading?"Signing in…":"Sign In"}
          </button>

          <div style={{textAlign:"center"}}>
            <button onClick={onSignUp} className="pressBtn" style={{background:"none",border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:"12px",color:T.content.tertiary}}>
              New to SCRBRD? <span style={{color:T.brand.blueText,fontWeight:600}}>Create an account →</span>
            </button>
          </div>
        </div>

        {/* Accounts. Which list depends on whether there is a server. */}
        <div style={{marginTop:"20px",borderRadius:"14px",border:`1px solid ${clr(T.brand.blue,0.2)}`,background:clr(T.brand.blue,0.05),padding:"16px"}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.brand.blueText,marginBottom:"10px"}}>
            {live ? "✦ Pilot accounts — click to fill" : "✦ Demo accounts — click to fill"}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"6px"}}>
            {(live ? PILOT_ACCOUNTS : DEMO_ACCOUNTS).map(d=>(
              <button key={d.email} onClick={()=>{setEmail(d.email);setPassword(d.pw||"");setError("");}} className="pressBtn"
                style={{padding:"7px 10px",borderRadius:"8px",cursor:"pointer",background:T.fill.panel,border:`1px solid ${T.line.subtle}`,textAlign:"left"}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:700,color:T.content.secondary,display:"flex",alignItems:"center",gap:"5px"}}><Icon name={ROLES[d.role]?.icon}/> {d.label}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"9px",color:T.content.tertiary,marginTop:"2px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.email}</div>
              </button>
            ))}
          </div>
          {/* Said out loud, because a demo that looks like the product is how
              someone comes to believe a roster on screen is their school's. */}
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:"9px",color:T.content.tertiary,marginTop:"10px",lineHeight:1.5}}>
            {live === null ? "Checking for a server…"
              : live ? "Signed in against the live API. Data is real and permission-checked."
                     : "No server reachable — demonstration data only. Nothing is saved beyond this device."}
          </div>
        </div>
      </div>
    </div>
  );
}

export { LoginPage };
