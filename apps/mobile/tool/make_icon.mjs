#!/usr/bin/env node
/**
 * Generates the launcher icon from the project's own design tokens.
 *
 * Written as a raw PNG encoder over Node's built-in zlib rather than pulling
 * in sharp or ImageMagick: neither is available on the build machine, and a
 * committed generator means the icon can be regenerated and tweaked rather
 * than being an opaque binary nobody can edit.
 *
 * The mark is the product's own signature: the 45-degree hazard rule from
 * apps/web/src/app/globals.css — the real-world signage for "caution,
 * machinery operating", which is what this product is — over the near-black
 * machine-hall ground, with a container silhouette cut through it.
 *
 *   node tool/make_icon.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const VOID = [0x0b, 0x0b, 0x0c];
const HAZARD = [0xff, 0xc4, 0x00];
const CHALK = [0xf2, 0xf2, 0xf0];
const STEEL = [0x17, 0x18, 0x1b];

/** Minimal RGBA PNG encoder: one IHDR, one IDAT, one IEND. */
function encodePng(width, height, rgba) {
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 = compression/filter/interlace, all 0

  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Draw the mark.
 *
 * `inset` scales the artwork inside the canvas. Adaptive-icon foregrounds are
 * masked to roughly the middle 66%, so they need the mark drawn smaller than a
 * legacy square icon does or the system crops it.
 */
function draw(size, { background = true, inset = 1 } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (background) set(x, y, VOID, 255);
    }
  }

  const c = size / 2;
  const half = (size * inset) / 2;
  const L = Math.round(c - half);
  const R = Math.round(c + half);
  const span = R - L;

  // Container body: a wide rounded-ish slab, the freight box the agents move.
  const bx0 = L + Math.round(span * 0.13);
  const bx1 = L + Math.round(span * 0.87);
  const by0 = L + Math.round(span * 0.30);
  const by1 = L + Math.round(span * 0.70);
  const radius = Math.round(span * 0.045);

  const inBody = (x, y) => {
    if (x < bx0 || x > bx1 || y < by0 || y > by1) return false;
    // Square off the corners with a circular test so the slab reads as a
    // container rather than a plain rectangle at small sizes.
    const cx = x < bx0 + radius ? bx0 + radius : x > bx1 - radius ? bx1 - radius : x;
    const cy = y < by0 + radius ? by0 + radius : y > by1 - radius ? by1 - radius : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2 || (cx === x && cy === y);
  };

  // The hazard rule: 45-degree stripes, the one marking this product owns.
  const stripe = Math.max(2, Math.round(span * 0.072));
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      if (!inBody(x, y)) continue;
      const band = Math.floor((x + y) / stripe) % 2 === 0;
      set(x, y, band ? HAZARD : STEEL, 255);
    }
  }

  // Container ribs — vertical chalk lines, so the slab reads as corrugated
  // steel rather than as an abstract striped block.
  const ribs = 4;
  for (let n = 1; n <= ribs; n++) {
    const x = bx0 + Math.round(((bx1 - bx0) * n) / (ribs + 1));
    for (let w = 0; w < Math.max(1, Math.round(span * 0.012)); w++) {
      for (let y = by0; y <= by1; y++) {
        if (inBody(x + w, y)) set(x + w, y, VOID, 255);
      }
    }
  }

  // Top and bottom rails in chalk, framing the body.
  const rail = Math.max(2, Math.round(span * 0.028));
  for (let r = 0; r < rail; r++) {
    for (let x = bx0; x <= bx1; x++) {
      if (inBody(x, by0 + r)) set(x, by0 + r, CHALK, 255);
      if (inBody(x, by1 - r)) set(x, by1 - r, CHALK, 255);
    }
  }

  return px;
}

const targets = [
  // Legacy square launcher icons.
  ['android/app/src/main/res/mipmap-mdpi/ic_launcher.png', 48, { inset: 0.86 }],
  ['android/app/src/main/res/mipmap-hdpi/ic_launcher.png', 72, { inset: 0.86 }],
  ['android/app/src/main/res/mipmap-xhdpi/ic_launcher.png', 96, { inset: 0.86 }],
  ['android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', 144, { inset: 0.86 }],
  ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 192, { inset: 0.86 }],
  ['android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png', 48, { inset: 0.72 }],
  ['android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png', 72, { inset: 0.72 }],
  ['android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png', 96, { inset: 0.72 }],
  ['android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png', 144, { inset: 0.72 }],
  ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png', 192, { inset: 0.72 }],
  // Adaptive-icon foreground: transparent, mark kept inside the safe zone.
  ['android/app/src/main/res/drawable-mdpi/ic_launcher_foreground.png', 108, { background: false, inset: 0.60 }],
  ['android/app/src/main/res/drawable-hdpi/ic_launcher_foreground.png', 162, { background: false, inset: 0.60 }],
  ['android/app/src/main/res/drawable-xhdpi/ic_launcher_foreground.png', 216, { background: false, inset: 0.60 }],
  ['android/app/src/main/res/drawable-xxhdpi/ic_launcher_foreground.png', 324, { background: false, inset: 0.60 }],
  ['android/app/src/main/res/drawable-xxxhdpi/ic_launcher_foreground.png', 432, { background: false, inset: 0.60 }],
  // Play Store listing asset: 512x512, required for submission.
  ['playstore-icon-512.png', 512, { inset: 0.86 }],
];

for (const [path, size, opts] of targets) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(size, size, draw(size, opts)));
  console.log(`  ${path}  ${size}x${size}`);
}
console.log('\nicons written');
