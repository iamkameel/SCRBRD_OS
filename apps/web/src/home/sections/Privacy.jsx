import { T } from "../../design/tokens.js";
import { Header } from "./Header.jsx";
import { Footer } from "./Footer.jsx";
import { homeBody, homeHead, textLink } from "./shared.jsx";

/**
 * /privacy: how SCRBRD treats children's data, in the words of
 * docs/policy/PUBLIC_DATA.md (SCRBRD-142 §4.2, phase 1). A static page: it
 * reads nothing and collects nothing.
 *
 * Props
 *   homeHref  the way back. Default "/".
 *   appHref, logo, prefs  passed to the header and footer.
 *
 * The words below are PUBLIC_DATA.md's, put plainly: §1 (the rule), §3 (never
 * public), §4 (consent) and §2 (what each public page shows). When that
 * document changes this page changes with it; home-page.test.mjs holds each
 * heading to the document it comes from. Nothing here promises a page that
 * does not exist: the listing of matches on the home page, public news,
 * standings and honours pages are not described, because they are not built.
 */

export const PRIVACY_RULE = [
  ["Off until switched on", "A match page is private until the school that is playing publishes it."],
  ["Each school speaks for its own children", "A child appears in public only under their own school's settings and their own consent. A side whose school is not on SCRBRD is never named, and nor is a name a scorer typed in."],
  ["No name without consent", "A child is named in public only when a verified parent or guardian has said yes, and never while the school has marked the child as one who must not appear. Before consent is recorded the page says \"Batter\" or \"Bowler\"."],
  ["Initial and surname, never more", "A child whose parent has agreed is shown as an initial and surname, such as \"J Smith\". A full name, a first name alone, a photograph or a date of birth is never shown."],
  ["Some things are never public", "Whatever anyone agrees to, the list below stays out of public view."],
  ["A \"no\" is immediate and reaches the past", "When a parent withdraws consent, or a child is marked as one who must not appear, every public page changes at once, finished scorecards included."],
  ["Findable by link, not by search", "Match pages tell search engines not to index them. They are shared by link, the way a school shares a match."],
];

export const PRIVACY_NEVER = [
  ["Date of birth and exact age", "The age group, such as U15, stays."],
  ["Health", "Injury, illness, and why a child is not playing, including the bare word \"unavailable\"."],
  ["Discipline", "Any reference to a conduct matter."],
  ["Contact, home and identity", "Address, phone, email, guardian, ID number, hometown, boarding house, height, weight."],
  ["Judgements", "Coaches' notes, skill ratings, scouting interest."],
];

export const PRIVACY_CONSENT = [
  "Consent is recorded for each child by a verified parent or guardian. A school may record it from its own admission forms, naming the form and the date.",
  "Until it is recorded, the child is not named.",
  "Withdrawing it takes effect everywhere at once, on past pages too. The record is end-dated, never deleted.",
  "The same rule applies at every age. A school can also switch names off for any age group it chooses.",
  "From a child's eighteenth birthday their own consent counts. Until it is given, the guardian's stands.",
  "A child who must never appear can be marked by authorised staff. The mark overrides every consent, and no page shows or records the reason.",
  "Clubs follow the same rules as schools.",
];

export const PRIVACY_SURFACES = [
  ["Team names, score and result on the live page", "Public once the school publishes the match."],
  ["Batters' and bowlers' names, and the commentary", "Initial and surname, only for a child with consent; otherwise \"Batter\" or \"Bowler\". The commentary may say which shot was played and where it went, as words."],
  ["Shot maps and wagon wheels", "Drawn for the whole side only, never for one child."],
  ["Full scorecards after the match", "The same name rule as the live page."],
  ["Leaderboards across a competition, a page for each player, team sheets before a match, photographs", "Not public."],
];

function H2({ children }) {
  return <h2 style={{ ...homeHead(), fontSize: "20px", fontWeight: 700, color: T.content.primary, margin: `${T.space.xxl} 0 ${T.space.md}` }}>{children}</h2>;
}

function Pairs({ rows, numbered }) {
  const List = numbered ? "ol" : "ul";
  return (
    <List style={{ margin: 0, paddingLeft: numbered ? T.space.xl : T.space.lg, display: "grid", gap: T.space.md }}>
      {rows.map(([t, d]) => (
        <li key={t} style={{ ...homeBody(), fontSize: "16px", color: T.content.secondary, lineHeight: 1.55 }}>
          <strong style={{ color: T.content.primary }}>{t}.</strong> {d}
        </li>
      ))}
    </List>
  );
}

export function Privacy({ homeHref = "/", appHref, logo, prefs }) {
  return (
    <>
      <Header appHref={appHref} logo={logo} />
      <main style={{ flex: 1, maxWidth: "760px", margin: "0 auto", width: "100%", boxSizing: "border-box", padding: `${T.space.xl} ${T.space.lg} ${T.space.huge}` }}>
        <h1 style={{ ...homeHead(), fontSize: "clamp(26px,5vw,40px)", fontWeight: 800, color: T.content.primary, lineHeight: 1.15 }}>How SCRBRD treats children's data</h1>
        <p style={{ ...homeBody(), fontSize: "16px", color: T.content.secondary, lineHeight: 1.6, marginTop: T.space.md }}>
          &quot;Public&quot; here means signed out: anyone with the link, including people SCRBRD does not know. This is the rule every public page is built against. The school's information officer confirmed it in writing on 28 September 2026, before any public page was switched on.
        </p>
        <p style={{ ...homeBody(), fontSize: "16px", color: T.content.secondary, lineHeight: 1.6, marginTop: T.space.md }}>
          It is about pupils. Adults doing a public job, such as umpires, scorers and coaches named on a fixture, are outside it.
        </p>

        <H2>The rule</H2>
        <Pairs rows={PRIVACY_RULE} numbered />

        <H2>What is never public</H2>
        <Pairs rows={PRIVACY_NEVER} />

        <H2>Consent</H2>
        <ul style={{ margin: 0, paddingLeft: T.space.lg, display: "grid", gap: T.space.md }}>
          {PRIVACY_CONSENT.map((c) => <li key={c} style={{ ...homeBody(), fontSize: "16px", color: T.content.secondary, lineHeight: 1.55 }}>{c}</li>)}
        </ul>

        <H2>What a public match page shows</H2>
        <Pairs rows={PRIVACY_SURFACES} />

        <H2>Questions</H2>
        <p style={{ ...homeBody(), fontSize: "16px", color: T.content.secondary, lineHeight: 1.6 }}>
          Ask your school's office. It records consent and can withdraw it.
        </p>
        <p style={{ margin: `${T.space.lg} 0 0` }}><a href={homeHref} data-testid="privacy-home" style={textLink()}>Back to the home page</a></p>
      </main>
      <Footer prefs={prefs} />
    </>
  );
}
