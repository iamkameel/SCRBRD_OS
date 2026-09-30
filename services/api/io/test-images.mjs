/**
 * Small images for the tests and the walk (SCRBRD-120): a JPEG and a PNG,
 * each carrying the metadata a phone would put in a photo of a scorebook
 * page — a GPS position, a device, a comment, a caption naming a boy — so
 * the tests can prove it is gone. Built byte by byte; not decodable
 * pictures, and they need not be: page-image.mjs reads structure, never
 * pixels. Not a test itself.
 */
import { crc32, deflateSync } from "node:zlib";

/** The words the metadata carries, which must never be kept. */
export const SECRET_WORDS = ["GPSLatitude", "Pixel 9 Pro", "Photo of T Ngcobo", "exif-caption"];

/** @param {number} marker @param {Buffer} body */
const seg = (marker, body) => {
  const head = Buffer.alloc(4);
  head[0] = 0xff; head[1] = marker; head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
};

/**
 * A baseline JPEG's structure, `width` by `height`, with APP1 (EXIF: GPS and
 * the device), APP13 (IPTC caption), a COM comment and a trailer after EOI.
 * `salt` changes the entropy bytes, so two pages hash apart.
 * @param {{ width?: number, height?: number, salt?: number }} [o]
 */
export function jpegWithMetadata({ width = 1600, height = 1200, salt = 0 } = {}) {
  const sof = Buffer.alloc(15);
  sof[0] = 8; sof.writeUInt16BE(height, 1); sof.writeUInt16BE(width, 3); sof[5] = 3;
  for (let c = 0; c < 3; c++) { sof[6 + c * 3] = c + 1; sof[7 + c * 3] = 0x11; sof[8 + c * 3] = 0; }
  const sosHead = Buffer.from([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);
  const scan = Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, salt & 0xff, 0xff, 0xd0, 0x78, 0x9a]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from("JFIF\0\x01\x02\0\0\x01\0\x01\0\0", "latin1")),
    seg(0xe1, Buffer.from("Exif\0\0GPSLatitude -29.6 GPSLongitude 30.4 Make Google Model Pixel 9 Pro", "latin1")),
    seg(0xed, Buffer.from("Photoshop 3.0\0Photo of T Ngcobo", "latin1")),
    seg(0xfe, Buffer.from("exif-caption", "latin1")),
    seg(0xdb, Buffer.alloc(65, 1)),
    seg(0xc0, sof),
    seg(0xc4, Buffer.alloc(20, 2)),
    seg(0xda, sosHead),
    scan,
    Buffer.from([0xff, 0xd9]),
    Buffer.from("TRAILER Pixel 9 Pro", "latin1"),
  ]);
}

/** @param {string} type @param {Buffer} data */
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
};

/**
 * A real (decodable) greyscale PNG, `width` by `height`, with tEXt, iTXt
 * and eXIf chunks carrying the secret words.
 * @param {{ width?: number, height?: number, salt?: number }} [o]
 */
export function pngWithMetadata({ width = 8, height = 4, salt = 0 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((width + 1) * height, salt & 0xff);
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("tEXt", Buffer.from("Comment\0Photo of T Ngcobo", "latin1")),
    chunk("eXIf", Buffer.from("MM\0*GPSLatitude Pixel 9 Pro", "latin1")),
    chunk("pHYs", Buffer.from([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1])),
    chunk("IDAT", deflateSync(raw)),
    chunk("iTXt", Buffer.from("Description\0\0\0\0\0exif-caption", "latin1")),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
