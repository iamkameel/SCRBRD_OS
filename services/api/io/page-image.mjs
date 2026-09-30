/**
 * SCRBRD — a scorebook page's photo, checked and stripped before it is kept
 * (SCRBRD-120 §5.2).
 *
 * A phone's photo carries more than the page: in its metadata, where it was
 * taken (GPS), which phone took it, when, and sometimes the owner's name.
 * None of that is needed to check a scorecard, and all of it would be kept
 * about a child's school for as long as the photo is. So:
 *
 *   ONLY JPEG OR PNG, by what the bytes are (their signature), never by what
 *   a client says they are; at most PAGE_MAX_BYTES; a width and height that a
 *   page can have. Anything else is refused whole.
 *
 *   STRIPPED, WITHOUT A DECODER. The design asked for a re-encode (§5.2); this
 *   platform has no image library and the API adds none, so the metadata is
 *   removed from the file's structure instead, which removes the same things:
 *     JPEG  every APPn segment but APP0 (JFIF) — APP1 is EXIF with GPS and
 *           XMP, APP2 the ICC profile, APP13 Photoshop/IPTC, the rest makers'
 *           notes — and every COM comment; and anything after the image's
 *           end marker (some phones append a second image or a trailer).
 *           The compressed image data and the tables it needs are copied as
 *           they are. One consequence: an image whose orientation lived in
 *           EXIF shows as the sensor stored it, which a reviewer can rotate.
 *     PNG   every chunk but those the picture needs (IHDR, PLTE, IDAT, IEND)
 *           and a few that only say how to show it (tRNS, gAMA, cHRM, sRGB,
 *           sBIT, bKGD, pHYs). tEXt, zTXt, iTXt and eXIf — where a PNG keeps
 *           words and EXIF — and every chunk this list does not name go. Each
 *           chunk's CRC is checked, so a file that is not what it claims is
 *           refused rather than half-kept.
 *
 * Pure: bytes in, bytes out. services/api/io/page-image.test.mjs holds it.
 */
import { crc32 } from "node:zlib";

/** The most a page's photo may weigh, as sent (§5.2: 8 MB). */
export const PAGE_MAX_BYTES = 8 * 1024 * 1024;
/** The longest side a page's photo may have. */
export const PAGE_MAX_SIDE = 12000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "bKGD", "pHYs"]);

/**
 * @typedef {{ ok: true, bytes: Buffer, mime: "image/jpeg" | "image/png", ext: "jpg" | "png",
 *             width: number, height: number, removed: string[] }
 *         | { ok: false, reason: "page_too_large" | "not_an_image" | "image_unreadable" | "image_size" }} PageImage
 */

/**
 * The photo as it will be kept, or why it will not be.
 * @param {Buffer} input
 * @returns {PageImage}
 */
export function sanitisePage(input) {
  if (!Buffer.isBuffer(input) || input.length === 0) return { ok: false, reason: "not_an_image" };
  if (input.length > PAGE_MAX_BYTES) return { ok: false, reason: "page_too_large" };
  /** @type {PageImage} */
  let out;
  if (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) out = stripJpeg(input);
  else if (input.subarray(0, 8).equals(PNG_SIGNATURE)) out = stripPng(input);
  else return { ok: false, reason: "not_an_image" };
  if (out.ok && (out.width < 1 || out.height < 1 || out.width > PAGE_MAX_SIDE || out.height > PAGE_MAX_SIDE)) {
    return { ok: false, reason: "image_size" };
  }
  return out;
}

/**
 * @param {Buffer} b
 * @returns {PageImage}
 */
function stripJpeg(b) {
  /** @type {Buffer[]} */
  const parts = [b.subarray(0, 2)];           // SOI
  /** @type {string[]} */
  const removed = [];
  let width = 0, height = 0, sawScan = false;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return { ok: false, reason: "image_unreadable" };
    // Fill bytes: any number of 0xFF before a marker.
    while (i < b.length && b[i] === 0xff && b[i + 1] === 0xff) i += 1;
    const marker = b[i + 1];
    if (marker === undefined) return { ok: false, reason: "image_unreadable" };
    if (marker === 0xd9) {                     // EOI: the image ends, and whatever follows goes
      parts.push(b.subarray(i, i + 2));
      if (i + 2 < b.length) removed.push("trailer");
      if (!sawScan || !width) return { ok: false, reason: "image_unreadable" };
      return { ok: true, bytes: Buffer.concat(parts), mime: "image/jpeg", ext: "jpg", width, height, removed };
    }
    // Markers with no length: TEM and RSTn (should not appear here, but are harmless).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { parts.push(b.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > b.length) return { ok: false, reason: "image_unreadable" };
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) return { ok: false, reason: "image_unreadable" };
    const seg = b.subarray(i, i + 2 + len);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if ((isApp && marker !== 0xe0) || marker === 0xfe) {
      removed.push(marker === 0xfe ? "COM" : `APP${marker - 0xe0}`);
    } else {
      parts.push(seg);
    }
    // Start of frame (baseline, progressive, …, not DHT/JPG/DAC): the size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && len >= 7) {
      height = b.readUInt16BE(i + 5);
      width = b.readUInt16BE(i + 7);
    }
    i += 2 + len;
    if (marker === 0xda) {                     // SOS: the entropy-coded data, copied to the next marker
      sawScan = true;
      let j = i;
      while (j < b.length - 1) {
        if (b[j] === 0xff) {
          const n = b[j + 1];
          if (n !== 0x00 && !(n >= 0xd0 && n <= 0xd7) && n !== 0xff) break;
        }
        j += 1;
      }
      if (j >= b.length - 1) return { ok: false, reason: "image_unreadable" };
      parts.push(b.subarray(i, j));
      i = j;
    }
  }
  return { ok: false, reason: "image_unreadable" };
}

/**
 * @param {Buffer} b
 * @returns {PageImage}
 */
function stripPng(b) {
  /** @type {Buffer[]} */
  const parts = [PNG_SIGNATURE];
  /** @type {string[]} */
  const removed = [];
  let width = 0, height = 0, i = 8, first = true;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.subarray(i + 4, i + 8).toString("latin1");
    if (!/^[A-Za-z]{4}$/.test(type) || i + 12 + len > b.length) return { ok: false, reason: "image_unreadable" };
    const chunk = b.subarray(i, i + 12 + len);
    const crc = b.readUInt32BE(i + 8 + len);
    if ((crc32(b.subarray(i + 4, i + 8 + len)) >>> 0) !== crc) return { ok: false, reason: "image_unreadable" };
    if (first) {
      if (type !== "IHDR" || len !== 13) return { ok: false, reason: "image_unreadable" };
      width = b.readUInt32BE(i + 8);
      height = b.readUInt32BE(i + 12);
      first = false;
    }
    if (PNG_KEEP.has(type)) parts.push(chunk); else removed.push(type);
    i += 12 + len;
    if (type === "IEND") {
      if (i < b.length) removed.push("trailer");
      return { ok: true, bytes: Buffer.concat(parts), mime: "image/png", ext: "png", width, height, removed };
    }
  }
  return { ok: false, reason: "image_unreadable" };
}
