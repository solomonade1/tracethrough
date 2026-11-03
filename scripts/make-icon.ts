/**
 * Generates the placeholder app icon (apps/desktop/build/icon.png): the ◎ mark on the accent
 * colour. Pure Node (zlib) so no image tooling is needed. Replace with a designed icon later.
 *   pnpm exec tsx scripts/make-icon.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const SIZE = 512;
const SAMPLES = 4; // per axis, for anti-aliasing
const ACCENT = [0x35, 0x59, 0xe0];
const WHITE = [0xff, 0xff, 0xff];

/** Coverage helpers in unit space (0..1). */
function insideRoundedSquare(x: number, y: number, r: number): boolean {
  const m = 0.04;
  const cx = Math.min(Math.max(x, m + r), 1 - m - r);
  const cy = Math.min(Math.max(y, m + r), 1 - m - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= m && x <= 1 - m && y >= m && y <= 1 - m;
}

function markAt(x: number, y: number): boolean {
  const d = Math.hypot(x - 0.5, y - 0.5);
  const ring = d >= 0.25 && d <= 0.31;
  const dot = d <= 0.13;
  return ring || dot;
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let py = 0; py < SIZE; py++) {
  const row = py * (SIZE * 4 + 1);
  raw[row] = 0; // filter: none
  for (let px = 0; px < SIZE; px++) {
    let bg = 0;
    let fg = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const x = (px + (sx + 0.5) / SAMPLES) / SIZE;
        const y = (py + (sy + 0.5) / SAMPLES) / SIZE;
        if (!insideRoundedSquare(x, y, 0.2)) continue;
        bg++;
        if (markAt(x, y)) fg++;
      }
    }
    const total = SAMPLES * SAMPLES;
    const alpha = bg / total;
    const mix = bg ? fg / bg : 0;
    const o = row + 1 + px * 4;
    for (let c = 0; c < 3; c++) raw[o + c] = Math.round(ACCENT[c]! * (1 - mix) + WHITE[c]! * mix);
    raw[o + 3] = Math.round(alpha * 255);
  }
}

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

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // colour type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = resolve(import.meta.dirname, '../apps/desktop/build/icon.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
