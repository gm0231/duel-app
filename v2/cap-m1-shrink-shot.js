'use strict';
/* cap-m1-shrink-shot.js — evidence screenshot for the round-5 fix:
 * start the duel at 390x844, shrink the viewport to 390x620
 * (no layout re-run), neutralise dvh (the WebView condition), open
 * the 12-candidate control prompt, and screenshot the first render.
 * Usage: node cap-m1-shrink-shot.js <serveRoot> <outDir> */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');
const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
fs.mkdirSync(OUT, { recursive: true });
const CONTROL12 = {
  type: 15, name: 'SELECT_CARD', player: 0, cancelable: false, min: 1, max: 1,
  cards: [28958464, 36745317, 86605515, 67037924, 63542003, 99937011, 25926710, 31525442, 62133026, 46148485, 98715423, 17484499]
    .map((code, i) => ({ code, con: 0, loc: 2, seq: i, pos: 10 })),
  selectHint: 526, retryCount: 0, context: null, trigger: null,
};
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mpeg', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CHROME = '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome';
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)).catch(() => {});
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
  await page.click('#todeck');
  await page.waitForFunction(() => { const b = document.getElementById('startbtn'); return b && !b.disabled; }, { timeout: 30000 });
  await page.click('#startbtn');
  await sleep(2000);
  await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
  await sleep(300);
  await page.addStyleTag({ content: '#sheet{max-height:calc(var(--appvh,100dvh) - 108px) !important;}' });
  await page.evaluate((p) => { window.__select.open(p); }, CONTROL12);
  await sleep(700);
  const m = await page.evaluate(() => {
    const sheet = document.getElementById('sheet');
    const r = sheet.getBoundingClientRect();
    const sc = sheet.querySelector('.sheet-scroll');
    return { appvh: getComputedStyle(document.documentElement).getPropertyValue('--appvh').trim(),
      fit: sheet.dataset.fit || null, top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
      scrollH: sc ? sc.scrollHeight : null, clientH: sc ? sc.clientHeight : null };
  });
  console.log('shrink-shot:', JSON.stringify(m));
  await page.screenshot({ path: path.join(OUT, 'shrink-fixed-first.png') });
  // tap tile 0, then screenshot the selected state
  const c = await page.evaluate(() => {
    const t = document.querySelector('#sheet .gcard[data-grid="0"]');
    const r = t.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(c.x, c.y);
  await sleep(300);
  const after = await page.evaluate(() => {
    const t = document.querySelector('#sheet .gcard[data-grid="0"]');
    const conf = document.getElementById('grid-confirm');
    return { sel: t.classList.contains('sel'), confirmDisabled: conf.disabled, label: conf.textContent.trim() };
  });
  console.log('after-tap:', JSON.stringify(after));
  await page.screenshot({ path: path.join(OUT, 'shrink-fixed-aftertap.png') });
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
