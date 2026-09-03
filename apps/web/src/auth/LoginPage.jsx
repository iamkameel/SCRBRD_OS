import { useState, useEffect } from "react";
import SCRBRD_LOGO from "../assets/scrbrd-logo.jpg";
import { ROLES } from "../design/roles.js";
import { SCRBRD } from "../scorer/engine.jsx";
import { mode as apiMode, signIn } from "../lib/session.js";

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
  { email: "parent@example.invalid",  label: "Parent",         role: "parent" },
  { email: "medical@example.invalid", label: "Medical",        role: "medical" },
  // A genuine spectator. The account seeded as spectator@example.invalid holds
  // a PLAYER assignment, and the player bundle includes medical.status.read —
  // so it is the wrong account to demonstrate what a bystander can see, and
  // the wrong one to test with.
  { email: "watcher@example.invalid", label: "Spectator",      role: "spectator" },
];

function LoginPage({ onLogin, onSignUp }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [live,     setLive]     = useState(null);   // null = still asking

  useEffect(() => { apiMode().then(m => setLive(m === "live")).catch(() => setLive(false)); }, []);

  // Mock credentials map: email → {role, name}
  const MOCK_USERS = {
    "admin@hilton.co.za":       { role:"superadmin",    name:"Admin User",            pw:"admin123" },
    "gsutherland@hilton.co.za": { role:"sportsmaster",  name:"Graham Sutherland",     pw:"sports123" },
    "c.hendricks@hilton.co.za": { role:"coach",         name:"Craig Hendricks",       pw:"coach123" },
    "james@hilton.co.za":       { role:"player",        name:"James Whitfield",       pw:"player123" },
    "helen.w@gmail.com":        { role:"parent",        name:"Helen Whitfield",       pw:"parent123" },
    "bwessels@hilton.co.za":    { role:"scorer",        name:"Brian Wessels",         pw:"scorer123" },
    "emzimba@hilton.co.za":     { role:"groundskeeper", name:"Ernest Mzimba",         pw:"ground123" },
    "skhumalo@hilton.co.za":    { role:"medical",       name:"Dr Khumalo",            pw:"medic123" },
  };

  const handleLogin = async () => {
    setLoading(true); setError("");

    // Live: the server decides. No fallback — see the header.
    if (live) {
      try {
        const p = await signIn(email.trim());
        onLogin(primaryRole(p), p?.user?.name || email, p);
      } catch (e) {
        setError(e.code === "no_such_user"
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

  const handleGoogleOAuth = async () => {
    setOauthLoading(true);
    await new Promise(r=>setTimeout(r,1200));
    // Simulate Google OAuth — returns schooladmin for demo
    onLogin("schooladmin","Demo User (Google)");
    setOauthLoading(false);
  };

  const DEMO_ACCOUNTS = [
    { role:"superadmin",   email:"admin@hilton.co.za",       pw:"admin123",   label:"Super Admin" },
    { role:"coach",        email:"c.hendricks@hilton.co.za", pw:"coach123",   label:"Head Coach" },
    { role:"player",       email:"james@hilton.co.za",       pw:"player123",  label:"Player" },
    { role:"parent",       email:"helen.w@gmail.com",        pw:"parent123",  label:"Parent" },
  ];

  return (
    <div style={{minHeight:"100vh",background:"#03050c",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
      <div style={{width:"100%",maxWidth:"420px"}}>
        <div style={{textAlign:"center",marginBottom:"32px"}}>
          <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"30px",objectFit:"contain",filter:"brightness(1.15)",marginBottom:"16px"}}/>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:"22px",fontWeight:800,color:"#fff",marginBottom:"6px"}}>Welcome back</div>
          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"13px",color:"rgba(255,255,255,0.45)"}}>Sign in to your SCRBRD account</div>
        </div>

        <div style={{borderRadius:"20px",border:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.02)",padding:"28px",backdropFilter:"blur(20px)"}}>
          {/* Google OAuth button */}
          <button onClick={handleGoogleOAuth} disabled={oauthLoading} className="pressBtn" style={{width:"100%",padding:"12px",borderRadius:"12px",cursor:"pointer",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",display:"flex",alignItems:"center",justifyContent:"center",gap:"10px",marginBottom:"20px",transition:"all .2s"}}>
            <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/><path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>
            <span style={{fontFamily:"'Syne',sans-serif",fontSize:"13px",fontWeight:700,color:"rgba(255,255,255,0.85)"}}>{oauthLoading?"Connecting…":"Continue with Google"}</span>
          </button>

          <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"20px"}}>
            <div style={{flex:1,height:"1px",background:"rgba(255,255,255,0.08)"}}/>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"rgba(255,255,255,0.3)"}}>or email</span>
            <div style={{flex:1,height:"1px",background:"rgba(255,255,255,0.08)"}}/>
          </div>

          {/* Email + password */}
          {[
            { id:"login-email", label:"Email", type:"email", autoComplete:"email", value:email, onChange:setEmail, placeholder:"you@school.co.za" },
            { id:"login-password", label:"Password", type:"password", autoComplete:"current-password", value:password, onChange:setPassword, placeholder:"••••••••" },
          ].map(f=>(
            <div key={f.label} style={{marginBottom:"14px"}}>
              {/* A real <label htmlFor>, not a styled div. The div looked the
                  same and did none of the work: no accessible name, no click
                  target, nothing for voice control to say. */}
              <label htmlFor={f.id} style={{display:"block",fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:"6px"}}>{f.label}</label>
              <input id={f.id} value={f.value} type={f.type} autoComplete={f.autoComplete}
                onChange={e=>f.onChange(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&handleLogin()}
                placeholder={f.placeholder}
                aria-invalid={error?true:undefined}
                aria-describedby={error?"login-error":undefined}
                style={{width:"100%",padding:"11px 14px",borderRadius:"10px",background:"rgba(255,255,255,0.05)",border:`1px solid ${error?"rgba(244,63,94,0.5)":"rgba(255,255,255,0.1)"}`,fontFamily:"'DM Sans',sans-serif",fontSize:"14px",color:"#fff",boxSizing:"border-box"}}/>
            </div>
          ))}

          {/* role="alert" so a failed sign-in is announced. Without it the
              only signal is a colour change, which someone using a screen
              reader never learns about at all — they press Sign In and
              nothing appears to happen. */}
          {error&&<div id="login-error" role="alert" style={{fontFamily:"'DM Sans',sans-serif",fontSize:"12px",color:"#f87171",marginBottom:"12px",padding:"8px 12px",borderRadius:"8px",background:"rgba(244,63,94,0.1)",border:"1px solid rgba(244,63,94,0.2)"}}>{error}</div>}

          <button onClick={handleLogin} disabled={loading} className="pressBtn" style={{width:"100%",padding:"12px",borderRadius:"12px",cursor:"pointer",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",border:"none",fontFamily:"'Syne',sans-serif",fontSize:"13px",fontWeight:700,color:"#fff",marginBottom:"14px",boxShadow:"0 4px 20px rgba(99,102,241,0.35)"}}>
            {loading?"Signing in…":"Sign In"}
          </button>

          <div style={{textAlign:"center"}}>
            <button onClick={onSignUp} className="pressBtn" style={{background:"none",border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:"12px",color:"rgba(255,255,255,0.4)"}}>
              New to SCRBRD? <span style={{color:"#a5b4fc",fontWeight:600}}>Create an account →</span>
            </button>
          </div>
        </div>

        {/* Accounts. Which list depends on whether there is a server. */}
        <div style={{marginTop:"20px",borderRadius:"14px",border:"1px solid rgba(99,102,241,0.2)",background:"rgba(99,102,241,0.05)",padding:"16px"}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(99,102,241,0.7)",marginBottom:"10px"}}>
            {live ? "✦ Pilot accounts — click to fill" : "✦ Demo accounts — click to fill"}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"6px"}}>
            {(live ? PILOT_ACCOUNTS : DEMO_ACCOUNTS).map(d=>(
              <button key={d.email} onClick={()=>{setEmail(d.email);setPassword(d.pw||"");setError("");}} className="pressBtn"
                style={{padding:"7px 10px",borderRadius:"8px",cursor:"pointer",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",textAlign:"left"}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:700,color:"rgba(255,255,255,0.7)"}}>{ROLES[d.role]?.icon} {d.label}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"9px",color:"rgba(255,255,255,0.3)",marginTop:"2px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.email}</div>
              </button>
            ))}
          </div>
          {/* Said out loud, because a demo that looks like the product is how
              someone comes to believe a roster on screen is their school's. */}
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:"9px",color:"rgba(255,255,255,0.32)",marginTop:"10px",lineHeight:1.5}}>
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
