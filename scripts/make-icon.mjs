// Renders the 1024x1024 source icon used by `npm run tauri icon`.
// Hand-rolled so the repo needs no image dependencies: it rasterises a few
// shapes with 3x supersampling and writes a PNG using Node's built-in zlib.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 1024;
const SS = 3; // supersampling factor per axis

const INK = [49, 46, 129]; // indigo-900, used for cut-outs
const WHITE = [255, 255, 255];

/** Signed-distance test for an axis-aligned rounded rectangle. */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  // Nearest point on the inner (un-rounded) rectangle.
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  const insideCross = (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r);
  return insideCross || dx * dx + dy * dy <= r * r;
}

function inTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const s = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const t = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const u = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  return (s >= 0 && t >= 0 && u >= 0) || (s <= 0 && t <= 0 && u <= 0);
}

/** Diagonal indigo -> violet wash across the tile. */
function gradient(x, y) {
  const t = Math.min(1, Math.max(0, (x / SIZE) * 0.55 + (y / SIZE) * 0.45));
  const from = [79, 70, 229];
  const to = [168, 85, 247];
  return from.map((c, i) => Math.round(c + (to[i] - c) * t));
}

// Filmstrip geometry.
const STRIP = { x0: 152, y0: 232, x1: 872, y1: 792, r: 44 };
const HOLE = 64;
const HOLE_GAP = (STRIP.x1 - STRIP.x0 - 5 * HOLE) / 6;
const HOLES = [];
for (let i = 0; i < 5; i++) {
  const hx = STRIP.x0 + HOLE_GAP * (i + 1) + HOLE * i;
  HOLES.push([hx, 268], [hx, 692]);
}

const TRI = [
  [446, 402],
  [446, 622],
  [634, 512],
];

function sampleAt(x, y) {
  if (!inRoundRect(x, y, 8, 8, SIZE - 8, SIZE - 8, 224)) return null;
  let color = gradient(x, y);
  if (inRoundRect(x, y, STRIP.x0, STRIP.y0, STRIP.x1, STRIP.y1, STRIP.r)) {
    color = WHITE;
    for (const [hx, hy] of HOLES) {
      if (inRoundRect(x, y, hx, hy, hx + HOLE, hy + HOLE, 16)) {
        color = INK;
        break;
      }
    }
    if (inTriangle(x, y, ...TRI)) color = INK;
  }
  return color;
}

function render() {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  const per = SS * SS;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sampleAt(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            hits++;
          }
        }
      }
      const o = (y * SIZE + x) * 4;
      if (hits > 0) {
        rgba[o] = Math.round(r / hits);
        rgba[o + 1] = Math.round(g / hits);
        rgba[o + 2] = Math.round(b / hits);
        rgba[o + 3] = Math.round((hits / per) * 255);
      }
    }
  }
  return rgba;
}

// --- minimal PNG container ---------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPng(rgba) {
  const stride = SIZE * 4;
  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc((stride + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "app-icon.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, toPng(render()));
console.log(`wrote ${out}`);
