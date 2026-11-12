'use strict';
/* cap-m1-closegate.js — isolate the sheetClose -> fxPromptGate race.
 * Real flow: the trap's zone-action sheet (kind='view') is open when
 * the cost prompt arrives; uiAnswer calls sheetClose() (185ms timer
 * that empties the sheet), then the async gate (refreshFieldStats +
 * fxPromptGate, up to 1200ms) runs, then dispatchPrompt opens the
 * grid sheet. Two orderings:
 *  A (gate fast, <185ms): sheetOpen runs before the close timer fires
 *     -> timer must early-return on gen mismatch.
 *  B (gate slow, >185ms): timer empties the sheet first, then the
 *     grid sheet re-opens from a fully closed wrap.
 * This rig drives the REAL functions in-page (sheetClose is a window
 * global; window.__select.open is the gridSheet entry) with the REAL
 * captured discard prompt, and measures + real-taps the first render.
 * Usage: node cap-m1-closegate.js <serveRoot> <outDir> [gateMs] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');
const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const GATE = +(process.argv[4] || 250);
fs.mkdirSync(OUT, { recursive: true });
const PROMPT = JSON.parse(fs.readFileSync('/home/hatch/workspace/.lf5-scratch/m1-discard-prompt.json', 'utf8'));
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
const MEASURE = () => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1), w: +r.width.toFixed(1) }; };
  const vh = window.innerHeight;
  const sheet = document.getElementById('sheet');
  const wrap = document.getElementById('sheetwrap');
  const sc = sheet ? sheet.querySelector('.sheet-scroll') : null;
  const tiles = sheet ? [...sheet.querySelectorAll('.gcard')] : [];
  const conf = document.getElementById('grid-confirm');
  let scrollProbe = null;
  if (sc) { const b = sc.scrollTop; sc.scrollTop = 60; scrollProbe = { scrollH: sc.scrollHeight, clientH: sc.clientHeight, after: sc.scrollTop }; sc.scrollTop = b; }
  return {
    vh, wrapClass: wrap ? wrap.className : null, wrapClosing: wrap ? !!wrap.dataset.closing : null,
    wrapKind: wrap ? wrap.dataset.kind : null,
    sheetClass: sheet ? sheet.className : null, sheetRect: R(sheet),
    scRect: sc ? R(sc) : null, scrollProbe,
    tiles: tiles.map((t, i) => {
      const r = t.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      return { i, rect: R(t), sel: t.classList.contains('sel'), bottomInside: r.bottom <= vh + 0.6,
        centreHit: topEl ? (topEl.closest('.gcard') ? 'tile' : (topEl.id || topEl.className || topEl.tagName)) : 'none' };
    }),
    confirm: conf ? { disabled: conf.disabled, rect: R(conf) } : null,
    sheetHTMLlen: sheet ? sheet.innerHTML.length : 0,
  };
};
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)).catch(() => {});
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
  await page.click('#todeck');
  await page.waitForFunction(() => { const b = document.getElementById('startbtn'); return b && !b.disabled; }, { timeout: 30000 });
  await page.click('#startbtn');
  await sleep(2500);
  // Step 1: open a REAL zone-action view sheet by tapping a hand card.
  const opened = await page.evaluate(() => {
    const a = document.querySelector('[data-act]');
    if (!a) return 'no-act';
    a.click();
    const w = document.getElementById('sheetwrap');
    return 'sheetwrap=' + w.className + ' kind=' + w.dataset.kind + ' html=' + document.getElementById('sheet').innerHTML.length;
  });
  console.log('action sheet:', opened);
  await page.screenshot({ path: path.join(OUT, 'closegate-' + GATE + '-view.png') });
  // Step 2: uiAnswer's prompt-arrival path: sheetClose() (185ms timer).
  await page.evaluate(() => { sheetClose(); });
  console.log('sheetClose() called; gateMs =', GATE);
  // Step 3: the async gate delay, then the grid sheet opens.
  await sleep(GATE);
  await page.evaluate((p) => { window.__select.open(p); }, PROMPT);
  await sleep(700);
  const first = await page.evaluate(MEASURE);
  await page.screenshot({ path: path.join(OUT, 'closegate-' + GATE + '-first.png') });
  const taps = [];
  for (let i = 0; i < first.tiles.length; i++) {
    const c = await page.evaluate((idx) => {
      const t = document.querySelector('#sheet .gcard[data-grid="' + idx + '"]');
      if (!t) return null;
      const r = t.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, i);
    if (!c) { taps.push({ i, error: 'no tile' }); continue; }
    await page.mouse.click(c.x, c.y);
    await sleep(250);
    const after = await page.evaluate((idx) => {
      const t = document.querySelector('#sheet .gcard[data-grid="' + idx + '"]');
      const conf = document.getElementById('grid-confirm');
      return { sel: t ? t.classList.contains('sel') : null, confirmDisabled: conf ? conf.disabled : null };
    }, i);
    taps.push({ i, ...after });
  }
  const afterTaps = await page.evaluate(MEASURE);
  await page.screenshot({ path: path.join(OUT, 'closegate-' + GATE + '-aftertaps.png') });
  const rep = { gateMs: GATE, opened, first, taps, afterTaps };
  fs.writeFileSync(path.join(OUT, 'closegate-' + GATE + '-report.json'), JSON.stringify(rep, null, 1));
  console.log('GATE', GATE, 'tiles:', first.tiles.length, 'confirmDisabled:', first.confirm && first.confirm.disabled,
    'wrapClosing:', first.wrapClosing, 'scrollProbe:', JSON.stringify(first.scrollProbe),
    'taps:', JSON.stringify(taps), 'afterConfirmDisabled:', afterTaps.confirm && afterTaps.confirm.disabled);
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
