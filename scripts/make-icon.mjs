// Генерирует build/icon.png (1024×1024) без внешних инструментов: скруглённый квадрат с акцентом
// и стилизованной лупой. electron-builder сам конвертирует PNG в .icns/.ico.
import fs from "node:fs";
import zlib from "node:zlib";

const S = 1024;
const px = Buffer.alloc(S * S * 4);
const accent = [15, 118, 110];
const accent2 = [12, 92, 86];
const white = [255, 255, 255];

function put(x, y, rgb, a) {
  const i = (y * S + x) * 4;
  const inv = 1 - a;
  px[i] = Math.round(rgb[0] * a + px[i] * inv);
  px[i + 1] = Math.round(rgb[1] * a + px[i + 1] * inv);
  px[i + 2] = Math.round(rgb[2] * a + px[i + 2] * inv);
  px[i + 3] = Math.max(px[i + 3], Math.round(a * 255));
}

const margin = 92, r = 200;
const inRoundRect = (x, y) => {
  const lx = Math.max(margin + r - x, 0, x - (S - margin - r));
  const ly = Math.max(margin + r - y, 0, y - (S - margin - r));
  return r - Math.hypot(lx, ly);
};
const cx = 450, cy = 440, R = 190, ring = 58;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const d = inRoundRect(x + 0.5, y + 0.5);
    if (d > -1) {
      const a = Math.min(1, d + 1);
      const t = y / S;
      const c = accent.map((v, k) => Math.round(v * (1 - t * 0.35) + accent2[k] * t * 0.35));
      put(x, y, c, a);
    }
    // кольцо лупы
    const dist = Math.hypot(x - cx, y - cy);
    const ringD = ring / 2 - Math.abs(dist - R);
    if (ringD > -1) put(x, y, white, Math.min(1, ringD + 1));
    // ручка
    const ux = 0.7071, uy = 0.7071;
    const px0 = x - (cx + ux * (R + 10)), py0 = y - (cy + uy * (R + 10));
    const along = px0 * ux + py0 * uy;
    const across = Math.abs(-px0 * uy + py0 * ux);
    if (along > 0 && along < 230) {
      const hd = 40 - across;
      if (hd > -1) put(x, y, white, Math.min(1, hd + 1));
    }
    // галочка внутри
    const check = [[370, 445], [430, 505], [545, 385]];
    for (let k = 0; k < 2; k++) {
      const [x1, y1] = check[k], [x2, y2] = check[k + 1];
      const vx = x2 - x1, vy = y2 - y1, len = Math.hypot(vx, vy);
      const tt = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / (len * len)));
      const dd = Math.hypot(x - (x1 + vx * tt), y - (y1 + vy * tt));
      const cd = 26 - dd;
      if (cd > -1) put(x, y, white, Math.min(1, cd + 1));
    }
  }
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
fs.mkdirSync("build", { recursive: true });
fs.writeFileSync("build/icon.png", png);
console.log("build/icon.png", png.length, "bytes");
