'use strict';
/* cap-loghist.js — repro/evidence for the dead 履歴 (log history)
   button. Serves the worktree, starts a real duel, and holds the
   game at the human's SELECT_IDLECMD (their own main phase — the
   moment a player would tap 履歴）. Then taps the button with real
   coordinates and reports what happened.
   Usage: node cap-loghist.js <height> <outPrefix> [mode]
     mode 'hold' (default): stop answering at my first idle prompt.
     mode 'play': bot-play until my 2nd turn idle prompt. */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = __dirname;
const H = +(process.argv[2] || 700);
const PREFIX = process.argv[3] || ('loghist-' + H);
const MODE = process.argv[4] || 'hold';
const OUT = path.join(ROOT, 'shots-logfix');
fs.mkdirSync(OUT, { recursive: true });
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
window.__drv = { mem: null, holds: 0, turns: 0 };
window.__drvStep = function () {
  const E = window.Engine;
  if (!window.__drv.mem) window.__drv.mem = E.makeBotMemory();
  if (typeof currentPrompt === 'undefined' || !currentPrompt) return 'noprompt';
  const prompt = currentPrompt.prompt;
  if (prompt.name === 'SELECT_IDLECMD' && duelState && duelState.turnPlayer === HP) {
    window.__drv.holds++;
    if (window.__drv.holds >= ${+(process.argv[5] || 0) || (MODE === 'hold' ? 1 : 2)}) return 'HOLD';
  }
  try { finishPrompt(E.botAnswer(prompt, duel.state, DATA, window.__drv.mem)); } catch (e) { return 'err:' + e.message; }
  return 'answered';
};
`;

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: H, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
  await page.evaluate(DRIVER_SRC);
  await page.click('#startbtn');
  // drive until the driver reports HOLD at my idle prompt
  let held = false;
  for (let i = 0; i < 1500 && !held; i++) {
    const r = await page.evaluate(() => window.__drvStep());
    if (r === 'HOLD') held = true;
    else await new Promise(r2 => setTimeout(r2, 120));
  }
  console.log('held at idle prompt:', held);
  // let the board settle / any batch pacing finish
  await new Promise(r => setTimeout(r, 600));
  const probe = await page.evaluate(() => {
    const btn = document.querySelector('#loghistbtn');
    const out = { hasBtn: !!btn, logHistLen: (typeof logHist !== 'undefined' ? logHist.length : -1),
      prompt: (typeof currentPrompt !== 'undefined' && currentPrompt) ? currentPrompt.prompt.name : null,
      sheetClass: document.querySelector('#sheetwrap').className,
      dockClass: document.querySelector('#dock').className,
      chainClass: document.querySelector('#chainbar').className };
    if (btn) {
      const r = btn.getBoundingClientRect();
      out.rect = { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      const el = document.elementFromPoint(out.rect.cx, out.rect.cy);
      out.atPoint = el ? (el.id || el.className || el.tagName) : null;
    }
    return out;
  });
  console.log('PROBE', JSON.stringify(probe));
  if (!probe.hasBtn) { console.log('NO BUTTON — chainbar not idle'); await browser.close(); server.close(); return; }
  await page.screenshot({ path: path.join(OUT, PREFIX + '-before.png') });
  // real tap on the button centre
  await page.touchscreen.tap(probe.rect.cx, probe.rect.cy);
  await new Promise(r => setTimeout(r, 700));
  const after = await page.evaluate(() => ({
    sheetClass: document.querySelector('#sheetwrap').className,
    sheetHasHistory: document.querySelector('#sheet').innerHTML.includes('対戦の履歴'),
    rows: document.querySelectorAll('#sheet .loghistrow').length,
  }));
  console.log('AFTER TAP', JSON.stringify(after));
  await page.screenshot({ path: path.join(OUT, PREFIX + '-after.png') });
  if (after.sheetHasHistory) {
    // scroll the sheet content and close via 盤面に戻る
    await page.evaluate(() => { const s = document.querySelector('#sheet'); s.scrollTop = s.scrollHeight; });
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(OUT, PREFIX + '-scrolled.png') });
    const closeBtn = await page.$('#sheet-cancel');
    if (closeBtn) { await closeBtn.tap(); await new Promise(r => setTimeout(r, 500)); }
    const closed = await page.evaluate(() => document.querySelector('#sheetwrap').className);
    console.log('AFTER CLOSE sheetClass=', JSON.stringify(closed));
    await page.screenshot({ path: path.join(OUT, PREFIX + '-closed.png') });
  }
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
