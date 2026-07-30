/**
 * Generează iconițele PWA (PNG) fără nicio dependință: un encoder PNG
 * minimal (zlib e built-in) + desen pe buffer RGBA.
 * Logo: gradient indigo→violet, colțuri rotunjite, bare de grafic albe.
 *
 *   node scripts/gen-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // scanlines cu filtrul 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const r = size * 0.22; // raza colțurilor
  // Gradient diagonal indigo (#6366f1) → violet (#8b5cf6)
  const c1 = [0x63, 0x66, 0xf1];
  const c2 = [0x8b, 0x5c, 0xf6];

  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRounded(x, y)) continue; // transparent
      const t = (x + y) / (2 * size);
      px[i] = Math.round(c1[0] + (c2[0] - c1[0]) * t);
      px[i + 1] = Math.round(c1[1] + (c2[1] - c1[1]) * t);
      px[i + 2] = Math.round(c1[2] + (c2[2] - c1[2]) * t);
      px[i + 3] = 255;
    }
  }

  // Bare de grafic albe, rotunjite sus (stilul logo-ului din platformă)
  const bars = [
    { cx: 0.32, h: 0.28 },
    { cx: 0.5, h: 0.42 },
    { cx: 0.68, h: 0.56 },
  ];
  const bw = size * 0.115;
  const baseline = size * 0.76;
  for (const b of bars) {
    const x0 = b.cx * size - bw / 2;
    const x1 = b.cx * size + bw / 2;
    const y0 = baseline - b.h * size;
    const cap = bw / 2;
    for (let y = Math.floor(y0 - cap); y <= baseline; y++) {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        let inside = false;
        if (y >= y0 && x >= x0 && x <= x1) inside = true;
        else {
          // capătul rotunjit de sus
          const dx = x - b.cx * size;
          const dy = y - y0;
          if (dy < 0 && dx * dx + dy * dy <= cap * cap) inside = true;
        }
        if (inside) {
          const i = (y * size + x) * 4;
          px[i] = 255;
          px[i + 1] = 255;
          px[i + 2] = 255;
          px[i + 3] = 255;
        }
      }
    }
  }
  return encodePNG(size, size, px);
}

mkdirSync("public", { recursive: true });
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  writeFileSync(`public/${name}`, makeIcon(size));
  console.log(`✓ public/${name}`);
}
