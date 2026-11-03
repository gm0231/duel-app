'use strict';
/* probe-guard.js — isolate the cause: same page, same button.
   (1) while SELECT_IDLECMD is open, call openLogHistory() -> ?
   (2) answer everything until a gap where currentPrompt===null and
       the chainbar is idle, call openLogHistory() again -> ? */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');
const ROOT = __dirname;
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
  try { finishPrompt(E.botAnswer(currentPrompt.prompt, duel.state, DATA, window.__drv.mem)); } catch (e) { return 'err'; }
  return 'answered';
};
`;
(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 700, isMobile: true, hasTouch: true });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
  await page.evaluate(DRIVER_SRC);
  await page.click('#startbtn');
  // play until log has a few entries and we are mid-duel
  for (let i = 0; i < 200; i++) {
    const done = await page.evaluate(() => (typeof logHist !== 'undefined' && logHist.length >= 4));
    if (done) break;
    await page.evaluate(() => window.__drvStep());
    await new Promise(r => setTimeout(r, 100));
  }
  // (1) force the situation: wait for ANY currentPrompt, then call openLogHistory
  let r1 = null;
  for (let i = 0; i < 100 && !r1; i++) {
    r1 = await page.evaluate(() => {
      if (!currentPrompt) return null;
      const name = currentPrompt.prompt.name;
      openLogHistory();
      return { prompt: name, sheet: document.querySelector('#sheetwrap').className, logLen: logHist.length };
    });
    if (!r1) await new Promise(r => setTimeout(r, 100));
  }
  console.log('WITH PROMPT OPEN:', JSON.stringify(r1));
  // (2) hunt for a no-prompt gap with idle chainbar
  let r2 = null;
  for (let i = 0; i < 300 && !r2; i++) {
    await page.evaluate(() => window.__drvStep());
    r2 = await page.evaluate(() => {
      if (currentPrompt) return null;
      if (!document.querySelector('#loghistbtn')) return null;
      openLogHistory();
      return { sheet: document.querySelector('#sheetwrap').className, has: document.querySelector('#sheet').innerHTML.includes('対戦の履歴'), rows: document.querySelectorAll('#sheet .loghistrow').length, logLen: logHist.length };
    });
    if (!r2) await new Promise(r => setTimeout(r, 60));
  }
  console.log('IN NO-PROMPT GAP:', JSON.stringify(r2));
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
