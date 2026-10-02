/**
 * A QR code, for the ground display's setup section (SCRBRD-133 §1.3): the
 * director of sport points the pavilion TV's camera-less browser at nothing —
 * he scans this with his phone, or types the link. Pure, no dependency: byte
 * mode, error correction M, the version the text needs (1–40), the mask the
 * standard's penalty rule picks. It is ISO/IEC 18004 as Project Nayuki's
 * reference encoder writes it (MIT), reduced to the one mode a URL needs.
 *
 * apps/web/test/qr.test.mjs holds the matrices to a second, independent
 * encoder's for the same text and mask.
 *
 *   qrMatrix(text) → boolean[][]  (true is a dark module; no quiet zone)
 */

// Error correction M's codewords per block, and blocks, by version (index 0 unused).
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31,
  33, 35, 37, 38, 40, 43, 45, 47, 49];
/** Error correction M's two format bits. */
const ECL_BITS = 0;

/** @param {number} ver */
function rawModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}
/** @param {number} ver */
const dataCodewords = (ver) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver];

// ── Reed–Solomon over GF(2^8), 0x11D ──
/** @param {number} x @param {number} y */
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
/** @param {number} degree */
function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}
/** @param {number[]} data @param {number[]} divisor */
function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ /** @type {number} */ (result.shift());
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

/** The text's bytes, UTF-8. @param {string} text */
const utf8 = (text) => [...new TextEncoder().encode(text)];

/**
 * The QR code for `text`, as rows of dark (true) and light (false) modules.
 * @param {string} text  @param {{mask?: number}} [o]  a mask forced (0–7), for the test; else the best
 * @returns {boolean[][]}
 */
export function qrMatrix(text, { mask = -1 } = {}) {
  const bytes = utf8(text);
  let ver = 1;
  for (; ver <= 40; ver++) {
    const countBits = ver < 10 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  }
  if (ver > 40) throw new RangeError("too long for a QR code");

  // The bit stream: byte mode, the count, the bytes, the terminator, padding.
  /** @type {number[]} */
  const bits = [];
  const put = (/** @type {number} */ val, /** @type {number} */ len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0x4, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(ver) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Split into blocks, add each one's error correction, interleave.
  const nBlocks = BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const shortBlocks = nBlocks - (raw % nBlocks);
  const shortLen = Math.floor(raw / nBlocks);
  const divisor = rsDivisor(eccLen);
  /** @type {number[][]} */
  const blocks = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < shortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  /** @type {number[]} */
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((blk, j) => { if (i !== shortLen - eccLen || j >= shortBlocks) codewords.push(blk[i]); });
  }

  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (/** @type {number} */ x, /** @type {number} */ y, /** @type {boolean} */ dark) => { modules[y][x] = dark; isFn[y][x] = true; };

  // Timing, finders, alignment, format and version areas.
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (/** @type {number} */ x, /** @type {number} */ y) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const alignAt = (() => {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    const out = [6];
    for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
  })();
  alignAt.forEach((ax, i) => alignAt.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === alignAt.length - 1) || (i === alignAt.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = (/** @type {number} */ m) => {
    const d = (ECL_BITS << 3) | m;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((d << 10) | rem) ^ 0x5412;
    const bit = (/** @type {number} */ i) => ((f >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const v = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((v >>> i) & 1) !== 0, a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, dark); set(b, a, dark);
    }
  }

  // The codewords, in the zigzag.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
      if (!isFn[y][x] && i < codewords.length * 8) {
        modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
        i++;
      }
    }
  }

  const maskBit = (/** @type {number} */ m, /** @type {number} */ x, /** @type {number} */ y) => [
    (x + y) % 2, y % 2, x % 3, (x + y) % 3, (Math.floor(x / 3) + Math.floor(y / 2)) % 2,
    ((x * y) % 2) + ((x * y) % 3), (((x * y) % 2) + ((x * y) % 3)) % 2, (((x + y) % 2) + ((x * y) % 3)) % 2][m] === 0;
  const applyMask = (/** @type {number} */ m) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFn[y][x] && maskBit(m, x, y)) modules[y][x] = !modules[y][x];
  };
  let chosen = mask;
  if (chosen < 0) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const p = penalty(modules);
      if (p < best) { best = p; chosen = m; }
      applyMask(m);
    }
  }
  applyMask(chosen); drawFormat(chosen);
  return modules;
}

/** The standard's penalty score for a masked symbol (lower is better). @param {boolean[][]} m */
function penalty(m) {
  const size = m.length;
  let result = 0;
  const finderLike = (/** @type {boolean[]} */ line) => {
    let n = 0;
    const s = line.map((d) => (d ? 1 : 0)).join("");
    const pad = "0000" + s + "0000";
    for (let i = 0; i + 11 <= pad.length; i++) {
      const w = pad.slice(i, i + 11);
      if (w === "10111010000" || w === "00001011101") n++;
    }
    return n;
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      const line = Array.from({ length: size }, (_, b) => (pass === 0 ? m[a][b] : m[b][a]));
      let run = 1;
      for (let b = 1; b <= size; b++) {
        if (b < size && line[b] === line[b - 1]) run++;
        else { if (run >= 5) result += 3 + (run - 5); run = 1; }
      }
      result += finderLike(line) * 40;
    }
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) result += 3;
  }
  let dark = 0;
  for (const row of m) for (const d of row) if (d) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return result + k * 10;
}

/**
 * The matrix as one SVG path ("M x y h1 v1 h-1 z" per dark module), on a
 * grid with a four-module quiet zone: draw it at any size with
 * `viewBox="0 0 {size} {size}"`.
 * @param {boolean[][]} m  @returns {{d: string, size: number}}
 */
export function qrPath(m) {
  const q = 4;
  let d = "";
  m.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + q} ${y + q}h1v1h-1z`; }));
  return { d, size: m.length + q * 2 };
}
