/**
 * Generates the app icon and favicons from one set of shapes, in pure Node (zlib), so no image
 * tooling is needed:
 *   apps/desktop/build/icon.svg                 master artwork (vector)
 *   apps/desktop/build/icon.png                 1024 px, used by electron-builder for every platform
 *   apps/desktop/src/renderer/public/favicon.svg
 *   apps/desktop/src/renderer/public/favicon.ico   16, 32 and 48 px
 *
 * The mark is a "T": the bar is a browser request, the stem is the trace, and the ring is the
 * server call it led to (Browser blue to Server violet, as in the app's source badges). Favicons
 * crop the icon's outer margin, and the 16 px size drops the centre dot so it stays legible.
 *
 *   pnpm exec tsx scripts/make-icon.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const mixRgb = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => v + (b[i]! - v) * t) as RGB;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** All geometry in a 1024 × 1024 design space. */
const C = {
  bgTop: '#18223a',
  bgBottom: '#0a0e18',
  browser: '#6ea8ff',
  server: '#b79cff',
  hole: '#0f1626',
  dot: '#e7ebf3',
};
const TILE = { x: 64, y: 64, size: 896, r: 200 };
const BAR = { x: 216, y: 228, w: 592, h: 124 };
const STEM = { x: 454, y: 300, w: 116, h: 300 };
const RING = { cx: 512, cy: 706, r: 118, stroke: 64 };
const DOT_R = 40;

// ---------- vector ----------

function svg(opts: { crop: boolean; dot: boolean }): string {
  const view = opts.crop ? `${TILE.x} ${TILE.y} ${TILE.size} ${TILE.size}` : '0 0 1024 1024';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}">
  <defs>
    <linearGradient id="bg" x1="0" y1="${TILE.y}" x2="0" y2="${TILE.y + TILE.size}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.bgTop}"/><stop offset="1" stop-color="${C.bgBottom}"/></linearGradient>
    <linearGradient id="trace" x1="0" y1="${STEM.y}" x2="0" y2="${STEM.y + STEM.h}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.browser}"/><stop offset="1" stop-color="${C.server}"/></linearGradient>
  </defs>
  <rect x="${TILE.x}" y="${TILE.y}" width="${TILE.size}" height="${TILE.size}" rx="${TILE.r}" fill="url(#bg)"/>
  <rect x="${BAR.x}" y="${BAR.y}" width="${BAR.w}" height="${BAR.h}" rx="${BAR.h / 2}" fill="${C.browser}"/>
  <rect x="${STEM.x}" y="${STEM.y}" width="${STEM.w}" height="${STEM.h}" fill="url(#trace)"/>
  <circle cx="${RING.cx}" cy="${RING.cy}" r="${RING.r}" fill="${C.hole}" stroke="${C.server}" stroke-width="${RING.stroke}"/>${
    opts.dot ? `\n  <circle cx="${RING.cx}" cy="${RING.cy}" r="${DOT_R}" fill="${C.dot}"/>` : ''
  }
</svg>
`;
}

// ---------- raster ----------

const rgb = Object.fromEntries(Object.entries(C).map(([k, v]) => [k, hex(v)])) as Record<keyof typeof C, RGB>;

function insideRoundRect(x: number, y: number, rx: number, ry: number, w: number, h: number, r: number): boolean {
  if (x < rx || x > rx + w || y < ry || y > ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Colour at a design-space point, or undefined outside the tile (painter's order, top layer last). */
function colourAt(x: number, y: number, dot: boolean): RGB | undefined {
  if (!insideRoundRect(x, y, TILE.x, TILE.y, TILE.size, TILE.size, TILE.r)) return undefined;
  let c = mixRgb(rgb.bgTop, rgb.bgBottom, clamp01((y - TILE.y) / TILE.size));
  if (insideRoundRect(x, y, BAR.x, BAR.y, BAR.w, BAR.h, BAR.h / 2)) c = rgb.browser;
  if (x >= STEM.x && x <= STEM.x + STEM.w && y >= STEM.y && y <= STEM.y + STEM.h)
    c = mixRgb(rgb.browser, rgb.server, clamp01((y - STEM.y) / STEM.h));
  const d = Math.hypot(x - RING.cx, y - RING.cy);
  if (d <= RING.r + RING.stroke / 2) c = d < RING.r - RING.stroke / 2 ? rgb.hole : rgb.server;
  if (dot && d <= DOT_R) c = rgb.dot;
  return c;
}

/** RGBA pixels at `size` px; `crop` maps the tile (not the full canvas) onto the image. */
function render(size: number, opts: { crop: boolean; dot: boolean }): Buffer {
  const samples = size <= 64 ? 8 : 4;
  const origin = opts.crop ? TILE.x : 0;
  const span = opts.crop ? TILE.size : 1024;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let n = 0;
      const sum = [0, 0, 0];
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = origin + ((px + (sx + 0.5) / samples) / size) * span;
          const y = origin + ((py + (sy + 0.5) / samples) / size) * span;
          const c = colourAt(x, y, opts.dot);
          if (!c) continue;
          n++;
          for (let i = 0; i < 3; i++) sum[i]! += c[i]!;
        }
      }
      const o = (py * size + px) * 4;
      for (let i = 0; i < 3; i++) out[o + i] = n ? Math.round(sum[i]! / n) : 0;
      out[o + 3] = Math.round((n / (samples * samples)) * 255);
    }
  }
  return out;
}

// ---------- encoders ----------

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO container with PNG-compressed entries (supported by every current browser and Windows). */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const head = Buffer.alloc(6 + images.length * 16);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    head[e] = size >= 256 ? 0 : size;
    head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4); // planes
    head.writeUInt16LE(32, e + 6); // bits per pixel
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.data)]);
}

// ---------- write ----------

const desktop = resolve(import.meta.dirname, '../apps/desktop');
function write(rel: string, data: string | Buffer) {
  const out = resolve(desktop, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, data);
  console.log(`wrote ${out} (${data.length} bytes)`);
}

write('build/icon.svg', svg({ crop: false, dot: true }));
write('build/icon.png', png(1024, render(1024, { crop: false, dot: true })));
write('src/renderer/public/favicon.svg', svg({ crop: true, dot: false }));
write(
  'src/renderer/public/favicon.ico',
  ico([16, 32, 48].map((size) => ({ size, data: png(size, render(size, { crop: true, dot: size > 16 })) }))),
);
