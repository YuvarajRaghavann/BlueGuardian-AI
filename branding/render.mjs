import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const mark = fs.readFileSync(new URL('./logo-mark.svg', import.meta.url), 'utf8');
const inner = mark.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const out = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage();
async function shot(file, size, html) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
  fs.mkdirSync(file.substring(0, file.lastIndexOf('/')), { recursive: true });
  await p.screenshot({ path: file, omitBackground: true });
}
// mark only, with an inner scale (fraction of canvas)
const markAt = (size, frac, bg = '', radius = 0) => `<div style="width:${size}px;height:${size}px;display:grid;place-items:center;background:${bg};border-radius:${radius}px;overflow:hidden">
  <div style="position:absolute;width:${size}px;height:${size}px;background:radial-gradient(circle at 50% 30%, rgba(140,124,255,${bg ? 0.35 : 0}), transparent 65%)"></div>
  <svg viewBox="0 0 64 64" width="${size * frac}" height="${size * frac}" style="position:relative">${inner}</svg></div>`;
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const BG = 'linear-gradient(160deg,#18213b 0%,#0b1020 100%)';
for (const [d, f] of Object.entries(dens)) {
  const s = Math.round(48 * f);
  await shot(`${out}/mipmap-${d}/ic_launcher.png`, s, markAt(s, 0.66, BG, Math.round(s * 0.22)));
  await shot(`${out}/mipmap-${d}/ic_launcher_round.png`, s, markAt(s, 0.62, BG, s / 2));
  const fg = Math.round(108 * f);
  await shot(`${out}/mipmap-${d}/ic_launcher_foreground.png`, fg, markAt(fg, 0.5));
  const sp = Math.round(112 * f);
  await shot(`${out}/drawable-${d}/splash_logo.png`, sp, markAt(sp, 1));
}
await shot(`${out}/../playstore-icon.png`, 512, markAt(512, 0.66, BG, 0));
await b.close();
console.log('done');
