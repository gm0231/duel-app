'use strict';
/* probe-scroll.js — foreground scroll proof at 390x620: play until
   my idle prompt with logHist >= 13 (enough rows to overflow the
   62dvh sheet at 620), tap 履歴， measure the sheet's scroll
   geometry, scroll to the bottom, screenshot both states. */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');
const ROOT = __dirname;
const OUT = path.join(ROOT, 'shots-logfix');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.m4a': 'audio/m4a', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
const DRIVER_SRC = `
window.__drv = { mem: null };
window.__drvStep = function () {
  const E = window.Engine;
  if (!window.__drv.mem) window.__drv.mem = E.makeBotMemory();
  if (typeof currentPrompt === 'undefined' || !currentPrompt) return 'noprompt';
  if (currentPrompt.prompt.name === 'SELECT_IDLECMD' && duelState && duelState.turnPlayer === HP && logHist.length >= 13) return 'HOLD';
  try { finishPrompt(E.botAnswer(currentPrompt.prompt, duel.state, DATA, window.__drv.mem)); } catch (e) { return 'err'; }
  return 'answered';
};
`;
(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 620, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  let held = false;
  for (let attempt = 1; attempt <= 4 && !held; attempt++) {
    await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
    await page.evaluate(DRIVER_SRC);
    await page.click('#startbtn');
    const t0 = Date.now();
    for (let i = 0; i < 320 && !held; i++) {
      const r = await page.evaluate(() => window.__drvStep());
      if (r === 'HOLD') held = true;
      else await new Promise(r2 => setTimeout(r2, 90));
    }
    console.log('attempt', attempt, 'held:', held, 'in', Math.round((Date.now() - t0) / 1000), 's');
  }
  if (!held) { await browser.close(); server.close(); return; }
  await new Promise(r => setTimeout(r, 500));
  const geo = await page.evaluate(() => {
    const btn = document.querySelector('#loghistbtn');
    const r = btn.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, logLen: logHist.length, prompt: currentPrompt.prompt.name };
  });
  console.log('GEO', JSON.stringify(geo));
  await page.touchscreen.tap(geo.cx, geo.cy);
  await new Promise(r => setTimeout(r, 800));
  const m1 = await page.evaluate(() => {
    const s = document.querySelector('#sheet');
    return { cls: document.querySelector('#sheetwrap').className, rows: s.querySelectorAll('.loghistrow').length,
      scrollHeight: s.scrollHeight, clientHeight: s.clientHeight, scrollTop: s.scrollTop,
      firstRow: (s.querySelector('.loghistrow') || {}).textContent || null };
  });
  console.log('OPEN', JSON.stringify(m1));
  await page.screenshot({ path: path.join(OUT, 'scroll620-top.png') });
  const m2 = await page.evaluate(() => {
    const s = document.querySelector('#sheet');
    s.scrollTop = s.scrollHeight;
    return { scrollTop: s.scrollTop, lastRow: ([...s.querySelectorAll('.loghistrow')].pop() || {}).textContent || null };
  });
  await new Promise(r => setTimeout(r, 350));
  console.log('SCROLLED', JSON.stringify(m2));
  await page.screenshot({ path: path.join(OUT, 'scroll620-bottom.png') });
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
