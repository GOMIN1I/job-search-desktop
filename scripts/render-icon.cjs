// Рендер build/icon.svg в build/icon.png (1024×1024) средствами Electron (без внешних утилит).
// Запуск: npx electron scripts/render-icon.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const big = fs.readFileSync(path.join(__dirname, "..", "build", "icon.svg"), "utf8");
  const small = fs.readFileSync(path.join(__dirname, "..", "build", "icon-small.svg"), "utf8");
  // Маленькие размеры (≤48) рисуются из упрощённой версии: крупная карточка и одна маркерная полоса.
  const sizes = [1024, 512, 256, 128, 64, 48, 32, 24, 16];
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  for (const s of sizes) {
    win.setContentSize(s, s);
    const svg = s <= 48 ? small : big;
    const html = `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${s}" height="${s}"></body></html>`;
    await win.loadURL("data:text/html;base64," + Buffer.from(html).toString("base64"));
    await new Promise((r) => setTimeout(r, 300));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: s, height: s });
    const out = s === 1024 ? "icon.png" : `icon-${s}.png`;
    fs.writeFileSync(path.join(__dirname, "..", "build", out), img.resize({ width: s, height: s }).toPNG());
  }
  // ICO с PNG-вложениями (Windows): 16, 24, 32, 48, 64, 128, 256.
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = icoSizes.map((s) => fs.readFileSync(path.join(__dirname, "..", "build", `icon-${s}.png`)));
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoSizes.length, 4);
  let offset = 6 + 16 * icoSizes.length;
  const dir = Buffer.alloc(16 * icoSizes.length);
  icoSizes.forEach((s, i) => {
    const e = i * 16;
    dir.writeUInt8(s >= 256 ? 0 : s, e); dir.writeUInt8(s >= 256 ? 0 : s, e + 1); dir.writeUInt8(0, e + 2); dir.writeUInt8(0, e + 3);
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6); dir.writeUInt32LE(pngs[i].length, e + 8); dir.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  fs.writeFileSync(path.join(__dirname, "..", "build", "icon.ico"), Buffer.concat([header, dir, ...pngs]));
  app.quit();
});
