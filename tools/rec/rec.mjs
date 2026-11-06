// Deterministic renderer: steps the lab at fixed 1/30 s and writes JPEG frames.
// usage: node rec.mjs <outdir> <cam> <fromS> <toS> [every] [w] [h]
//   or:  node rec.mjs <outdir> probe   -> prints profiling
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const [out = 'frames', cam = 'chase', from = '0', to = '30', every = '1', W = '540', H = '760'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/usr/sbin/google-chrome-stable', headless: 'new', protocolTimeout: 900000,
  args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', `--window-size=${W},${H}`, '--no-sandbox'],
});
const page = await browser.newPage();
page.setDefaultTimeout(600000);
await page.setViewport({ width: +W, height: +H, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => logs.push('PAGEERR ' + e.message));
await page.goto('http://127.0.0.1:8797/lab.html?rec&cam=' + cam, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.LAB && document.getElementById("load").style.display==="none"', { timeout: 180000 });
if (cam === 'eval') {
  const code = fs.readFileSync(from, 'utf8');
  const r = await page.evaluate(code);
  if (typeof r === 'string' && r.startsWith('{"')) { const o = JSON.parse(r); for (const [k, v] of Object.entries(o)) if (String(v).startsWith('data:image')) { fs.writeFileSync(`${out}/${k}.jpg`, Buffer.from(v.split(',')[1], 'base64')); delete o[k]; } console.log(JSON.stringify(o)); }
  else console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1)); console.log(logs.filter((l) => !l.includes('404')).join('\n')); await browser.close(); process.exit(0);
}
if (cam === 'probe') {
  console.log(JSON.stringify(await page.evaluate(() => [LAB.prof(), LAB.prof(), LAB.prof()])));
  console.log(logs.join('\n')); await browser.close(); process.exit(0);
}
await page.evaluate((c) => LAB.setCam(c), cam);
await page.evaluate(() => LAB.restart());
// fast-forward
let st = { s: 0 };
while (st.s < +from) st = await page.evaluate((f) => LAB.runTo(f, 20000), +from);
await page.evaluate((c) => LAB.setCam(c), cam);
let i = 0, n = 0; const meta = [];
let prevS = -1;
for (let guard = 0; guard < 20000; guard++) {
  const s = await page.evaluate((k) => LAB.adv(k), +every);
  if (s.s >= +to || s.s < prevS - 5) break; prevS = s.s;
  const url = await page.evaluate(() => LAB.shot(0.85));
  fs.writeFileSync(`${out}/f${String(n).padStart(5, '0')}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  meta.push({ n, s: +s.s.toFixed(2), v: +s.v.toFixed(2), cap: s.cap.replace(/\n/g, ' | ') });
  n++;
}
fs.writeFileSync(`${out}/meta.json`, JSON.stringify({ meta, events: await page.evaluate(() => LAB.events()), logs }, null, 1));
console.log('frames', n, 'logs', logs.length, logs.slice(0, 8).join('\n'));
await browser.close();
