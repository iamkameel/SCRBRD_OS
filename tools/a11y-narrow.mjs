/**
 * The narrow-screen, keyboard and daylight pass (gap analysis I32), as measurements.
 *
 * The pilot's scorers, coaches and parents are on phones, outdoors, in sun. The
 * ratchets in smoke-a11y.mjs count type, taps and contrast at 390; this module
 * is what the same screens are asked at 320 (the narrowest phone), 375 and 414,
 * and at 200% zoom, where a layout either reflows or it breaks:
 *
 *   - sideways: the page, or the shell's scrolling main, is wider than the screen;
 *   - offscreen: something with text or a tap in it sits outside the screen and
 *     no scrolling container of its own brings it back;
 *   - clipped: text cut off by its own box (overflow hidden, an ellipsis, a clamp);
 *   - overlap: two things that read or tap drawn over one another;
 *   - small / tiny: text under 12px, tapped things under 44px (the repo's floors);
 *   - weak: text under 4.5:1 (3:1 for large type) on the colour it is drawn on,
 *     and a field's edge or an icon-only control's glyph under 3:1 (WCAG 1.4.11).
 *
 * `narrowAudit` only measures; it fails nothing. smoke-a11y.mjs decides which of
 * its lists must be empty on which screen (they all must, at 320), and the
 * exploratory runs print the lists in full so a failure can be read, not guessed.
 *
 * Everything here runs in the page. No dependency, no network.
 */

export const NARROW_WIDTHS = [320, 375, 414];

/**
 * @param {import("playwright-core").Page} page
 * @param {{ root?: string | null, tap?: number, floor?: number }} [opts]
 */
export const narrowAudit = (page, { root = null, tap = 44, floor = 12 } = {}) => page.evaluate(({ root, tap, floor }) => {
  const base = root ? document.querySelector(root) : document.body;
  const out = { found: !!base, sideways: [], offscreen: [], clipped: [], overlap: [], small: [], tiny: [], weak: [] };
  if (!base) return out;
  const W = window.innerWidth;

  // ── colour ──
  const parse = (c) => { const m = c && c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lin = (x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const ratioOf = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // The colour behind an element: its own and its ancestors' backgrounds, composited down to the first opaque one.
  // Null where a gradient or an image is in the way, because that is not one colour.
  const behind = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 1) break; }
    }
    let c = { r: 255, g: 255, b: 255, a: 1 };
    const rootBg = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (rootBg && rootBg.a > 0) c = over(rootBg, c);
    for (let i = layers.length - 1; i >= 0; i--) c = over(layers[i], c);
    return c;
  };

  // ── what is there ──
  const describe = (el) => {
    const t = el.getAttribute("data-testid");
    const text = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 28);
    return `<${el.tagName.toLowerCase()}${t ? ` ${t}` : ""}> "${text}"`;
  };
  const shown = (el) => {
    if (el.closest(".sr-only, script, style, noscript")) return false;
    // The skip link waits off the screen until Tab brings it in (and tabPath() measures it then).
    if (el.matches(".skip-link") && document.activeElement !== el) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };
  // A box the person can scroll sideways to bring a wide thing back (a scorecard's table).
  const scrollsSideways = (el) => {
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (/(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth) return true;
    }
    return false;
  };
  // A box that cuts the element off, on an axis nothing between them scrolls. A scrolling box (auto, scroll) brings its
  // contents back; a fixed box is not clipped by what it is written inside.
  const clippedByAncestor = (el) => {
    const r = el.getBoundingClientRect();
    let scrollX = false, scrollY = false;
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      if (!scrollX && /(hidden|clip)/.test(cs.overflowX) && (r.left < b.left - 1 || r.right > b.right + 1)) return e;
      if (!scrollY && /(hidden|clip)/.test(cs.overflowY) && (r.top < b.top - 1 || r.bottom > b.bottom + 1)) return e;
      if (/(auto|scroll)/.test(cs.overflowX)) scrollX = true;
      if (/(auto|scroll)/.test(cs.overflowY)) scrollY = true;
      if (cs.position === "fixed") break;
    }
    return null;
  };

  // What of an element is on screen: its box cut down by every ancestor that clips or scrolls. Something scrolled out of its
  // list is not under the footer that list scrolls beneath; null when none of it shows.
  const visibleRect = (el) => {
    let { left, right, top, bottom } = el.getBoundingClientRect();
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const b = e.getBoundingClientRect();
      if (cs.overflowX !== "visible") { left = Math.max(left, b.left); right = Math.min(right, b.right); }
      if (cs.overflowY !== "visible") { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
      if (right <= left || bottom <= top) return null;
    }
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  };
  // A bar fixed to the screen (the bottom nav, a sheet) is drawn over whatever scrolls under it; that is not an overlap
  // so long as the page can be scrolled clear of it, which the walks assert on their own.
  const isFixed = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) if (/^(fixed|sticky)$/.test(getComputedStyle(e).position)) return true; return false; };
  const TAPPED = "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=radio], [role=switch], [role=checkbox], [role=menuitem], [role=menuitemradio]";
  const own = (el) => [...el.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim());

  // ── sideways ──
  const de = document.documentElement;
  if (de.scrollWidth > W + 1) out.sideways.push(`page ${de.scrollWidth} > ${W}`);
  if (document.body.scrollWidth > W + 1) out.sideways.push(`body ${document.body.scrollWidth} > ${W}`);
  const main = document.getElementById("os-content");
  if (main && main.scrollWidth > main.clientWidth + 1) out.sideways.push(`main ${main.scrollWidth} > ${main.clientWidth}`);
  if (root && base.scrollWidth > base.clientWidth + 1 && !/(auto|scroll)/.test(getComputedStyle(base).overflowX)) out.sideways.push(`${root} ${base.scrollWidth} > ${base.clientWidth}`);
  // Who is pushing it out: a box that sticks out of a parent that is itself inside the screen (or the main's own width).
  if (out.sideways.length) {
    const limit = main ? main.getBoundingClientRect().right : W;
    const over = [...document.body.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().width && el.getBoundingClientRect().right > limit + 1 && !(scrollsSideways(el) && getComputedStyle(el).position !== "absolute"));
    // The outermost boxes past the edge first: they are the ones a rule on a parent can fix.
    for (const el of over.slice(0, 5)) out.sideways.push(`wide: ${describe(el)} ${Math.round(el.getBoundingClientRect().left)}..${Math.round(el.getBoundingClientRect().right)} (display ${getComputedStyle(el).display}, minWidth ${getComputedStyle(el).minWidth}, width ${getComputedStyle(el).width})`);
  }

  const all = [base, ...base.querySelectorAll("*")].filter((el) => !el.closest("svg") || el.tagName === "svg");
  const boxes = [];
  for (const el of all) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    const isTap = el.matches(TAPPED) && !el.closest("[aria-hidden=true]");
    const hasText = own(el);

    // ── offscreen / clipped by a parent ──
    if (hasText || isTap) {
      if ((r.right > W + 1 || r.left < -1) && !scrollsSideways(el)) out.offscreen.push(`${describe(el)} ${Math.round(r.left)}..${Math.round(r.right)} of ${W}`);
      else {
        const by = clippedByAncestor(el);
        if (by && !scrollsSideways(el)) out.clipped.push(`${describe(el)} cut by ${describe(by)}`);
      }
    }
    // ── clipped by itself ──
    const cs = getComputedStyle(el);
    if (hasText && /(hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) out.clipped.push(`${describe(el)} scrollWidth ${el.scrollWidth} > ${el.clientWidth}${cs.textOverflow === "ellipsis" ? " (ellipsis)" : ""}`);
    else if (hasText && /(hidden|clip)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && cs.display !== "inline") out.clipped.push(`${describe(el)} scrollHeight ${el.scrollHeight} > ${el.clientHeight}`);

    // ── type floor ──
    if (hasText) {
      const size = parseFloat(cs.fontSize);
      if (size < floor) out.small.push(`${size}px ${describe(el)}`);
    }
    // ── tap floor ──
    if (isTap && (r.width < tap || r.height < tap)) out.tiny.push(`${Math.round(r.width)}x${Math.round(r.height)} ${describe(el)}`);

    if (hasText || isTap) { const v = visibleRect(el); if (v) boxes.push({ el, r: v, isTap, fixed: isFixed(el) }); }
  }

  // ── overlap: two things that read or tap, drawn over one another ──
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el) || a.fixed !== b.fixed) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w <= 3 || h <= 3) continue;
      // Two inline runs of one paragraph report boxes that cross where the line breaks; nothing is drawn over anything.
      if (getComputedStyle(a.el).display === "inline" && getComputedStyle(b.el).display === "inline") continue;
      const smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (w * h < smaller * 0.2) continue;
      // Inline runs of one paragraph legitimately share a line box's edges; a real overlap is deep in both directions.
      if (w < 4 && h < 4) continue;
      out.overlap.push(`${describe(a.el)} over ${describe(b.el)} (${Math.round(w)}x${Math.round(h)})`);
    }
  }

  // ── contrast: text ──
  const seen = new Set();
  const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim() || !/[\p{L}\p{N}]/u.test(n.nodeValue)) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || el.closest("svg") || !shown(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.webkitTextFillColor && /rgba\(0, 0, 0, 0\)|transparent/.test(cs.webkitTextFillColor)) continue;
    const fg = parse(cs.color), bg = behind(el);
    if (!fg || !bg) continue;
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    // A control that is off says so, and WCAG exempts it.
    if (el.closest("[disabled], [aria-disabled=true]")) continue;
    const ratio = ratioOf(over(fg, bg), bg);
    if (ratio < need) out.weak.push(`text ${ratio.toFixed(2)}:1 (< ${need}) ${size}px ${describe(el)}`);
  }
  // ── contrast: a field's edge, and an icon-only control's glyph, against what is behind (WCAG 1.4.11, 3:1) ──
  for (const el of base.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea")) {
    if (!shown(el) || el.disabled) continue;
    const cs = getComputedStyle(el), bg = behind(el.parentElement ?? el);
    if (!bg) continue;
    const bw = parseFloat(cs.borderTopWidth) || 0, edge = parse(cs.borderTopColor);
    const own = parse(cs.backgroundColor);
    // A field is told from its surround by its border, or by a fill that is itself 3:1 from what is behind.
    let best = 1;
    if (bw >= 1 && edge && edge.a > 0) best = Math.max(best, ratioOf(over(edge, bg), bg));
    if (own && own.a > 0) best = Math.max(best, ratioOf(over(own, bg), bg));
    if (best < 3) out.weak.push(`field edge ${best.toFixed(2)}:1 (< 3) ${describe(el)}`);
  }
  // A placeholder is text, and is read against the field it is in.
  for (const el of base.querySelectorAll("input[placeholder]:not([type=hidden]), textarea[placeholder]")) {
    if (!shown(el) || el.disabled || el.value) continue;
    const ph = getComputedStyle(el, "::placeholder"), bg = behind(el), fg = parse(ph.color);
    if (!bg || !fg) continue;
    const ratio = ratioOf(over({ ...fg, a: fg.a * (Number(ph.opacity) || 1) }, bg), bg);
    if (ratio < 4.5) out.weak.push(`placeholder ${ratio.toFixed(2)}:1 (< 4.5) ${describe(el)}`);
  }
  for (const el of base.querySelectorAll("button, [role=button], a[href]")) {
    if (!shown(el) || el.disabled || el.closest("[aria-hidden=true]")) continue;
    if (el.textContent.trim() || !el.querySelector("svg")) continue;      // a control with words is a text check
    const cs = getComputedStyle(el), bg = behind(el), fg = parse(cs.color);
    if (!bg || !fg) continue;
    const ratio = ratioOf(over(fg, bg), bg);
    if (ratio < 3) out.weak.push(`icon ${ratio.toFixed(2)}:1 (< 3) ${describe(el)}`);
  }
  return out;
}, { root, tap, floor });

/**
 * Tab through the page from the top and report each stop: what it is, whether it is on screen, whether it shows a
 * focus ring, and — the thing "visible focus" really asks — whether the ring clears 3:1 against what is behind it.
 * Stops at `max`, or when focus comes back round to the first stop.
 *
 * @param {import("playwright-core").Page} page
 */
export async function tabPath(page, max = 80) {
  const stops = [];
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      const t = el.getAttribute("data-testid");
      const name = (el.getAttribute("aria-label") || el.textContent || el.id || "").replace(/\s+/g, " ").trim().slice(0, 28);
      const ring = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
      const shadow = cs.boxShadow && cs.boxShadow !== "none";
      const on = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
      return { key: `${el.tagName}|${t}|${name}|${Math.round(r.left)}|${Math.round(r.top + window.scrollY)}`, label: `<${el.tagName.toLowerCase()}${t ? ` ${t}` : ""}> "${name}"`, ring, shadow, on,
               outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`, offset: cs.outlineOffset };
    });
    if (!s) continue;
    if (stops.length && stops[0].key === s.key) break;
    stops.push(s);
  }
  return stops;
}
