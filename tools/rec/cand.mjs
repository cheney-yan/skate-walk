
import puppeteer from 'puppeteer-core'; import fs from 'fs';
const b = await puppeteer.launch({ executablePath: '/usr/sbin/google-chrome-stable', headless: 'new', protocolTimeout: 900000, args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const p = await b.newPage(); const names = process.argv[2].split(','); await p.setViewport({ width: 300 * names.length, height: 700 });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('http://127.0.0.1:8797/models/cand/view.html?m=' + names.join(','), { waitUntil: 'load', timeout: 300000 });
await p.waitForFunction('window.SHOT', { timeout: 600000 });
for (const [k, y] of [['f', 0], ['b', Math.PI]]) { const u = await p.evaluate((y) => SHOT(y), y); fs.writeFileSync(process.argv[3] + k + '.jpg', Buffer.from(u.split(',')[1], 'base64')); }
console.log(JSON.stringify(await p.evaluate(() => INFO))); await b.close();
