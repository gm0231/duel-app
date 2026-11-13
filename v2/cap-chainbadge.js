'use strict';
/* cap-chainbadge.js — BU-74/76 verification rig: real-browser
   measurement of the implemented chain tray + the enlarged peek
   toggles (BU-76), at 390x620 and 390x700.
   - The tray is raised through the REAL showChainTray with a
     fabricated prompt (the approved mock's scene: opponent
     Raigeki, two chainable set traps), then measured: host /
     tray / badges / chip rects, mini-card size, and which board
     elements the tray covers (intersection areas).
   - The tray peek is toggled by a real click on #ctpeek.
   - The dock peek strip is measured with the dock's real ttl
     markup: how much of the (enlarged) peek button stays
     visible inside the strip. Mode "old" serves the pre-BU-74/76
     tree (49px strip, 40px button) for the before/after table.
   - #peekbtn is measured on a real view sheet, with the
     #sheetx clearance beside it.
   Usage: node cap-chainbadge.js <serveRoot> <outDir> <mode>
   Modes: new620 | new700 | old620 | old700 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] || 'new620';
fs.mkdirSync(OUT, { recursive: true });
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
const RAIGEKI = 12580477, HAKAMORI = 98715423, ROLLBACK = 6351147;

const MEASURE_TRAY = () => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), b: +r.bottom.toFixed(1) }; };
  const app = document.getElementById('app').getBoundingClientRect();
  const host = document.getElementById('chainui');
  const hr = host.getBoundingClientRect();
  const inter = (el) => {
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, hr.right) - Math.max(r.left, hr.left));
    const h = Math.max(0, Math.min(r.bottom, hr.bottom) - Math.max(r.top, hr.top));
    return r.width * r.height ? Math.round(1000 * (w * h) / (r.width * r.height)) / 10 : 0;
  };
  const covered = {};
  document.querySelectorAll('.slot').forEach(s => { const p = inter(s); if (p > 0) covered['slot ' + s.dataset.zone] = p; });
  document.querySelectorAll('#hand .hcard').forEach((c, i) => { const p = inter(c); if (p > 0) covered['hand[' + i + ']'] = p; });
  for (const [name, el] of [['preview', document.getElementById('preview')], ['lpband', document.getElementById('lpband')], ['header', document.getElementById('header')]]) {
    const p = inter(el); if (p > 0) covered[name] = p;
  }
  document.querySelectorAll('[data-pile]').forEach(pl => { const p = inter(pl); if (p > 0) covered['pile ' + pl.dataset.pile] = p; });
  const det = document.querySelector('#preview [data-open-detail], #preview .pdet, #preview button');
  return {
    vh: window.innerHeight,
    app: { w: +app.width.toFixed(1), h: +app.height.toFixed(1) },
    chainui: R(host), chaintray: R(document.getElementById('chaintray')),
    ctpeek: R(document.getElementById('ctpeek')),
    yes: R(document.querySelector('#chaintray .ct-yes')), no: R(document.querySelector('#chaintray .ct-no')),
    cards: [...document.querySelectorAll('#chaintray .ct-card')].map(R),
    causeArt: R(document.querySelector('#chaintray .ct-cause-art')),
    trayAreaPct: +(100 * (hr.width * hr.height) / (app.width * app.height)).toFixed(1),
    covered,
    detailCoveredPct: det ? inter(det) : null,
  };
};
const MEASURE_STRIP = () => {
  const app = document.getElementById('app').getBoundingClientRect();
  const dock = document.getElementById('dock');
  const btn = document.getElementById('dock-peek');
  const dr = dock.getBoundingClientRect(), br = btn.getBoundingClientRect();
  const visTop = Math.max(br.top, app.top), visBot = Math.min(br.bottom, app.bottom);
  return {
    stripVisibleH: +(app.bottom - dr.top).toFixed(1),
    btnH: +br.height.toFixed(1),
    btnVisibleH: +Math.max(0, visBot - visTop).toFixed(1),
    ttlBottomGap: +(app.bottom - document.querySelector('#dock .ttl').getBoundingClientRect().bottom).toFixed(1),
  };
};
const MEASURE_PEEKBTN = () => {
  const pb = document.getElementById('peekbtn'), sx = document.getElementById('sheetx');
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
  const a = R(pb), b = R(sx);
  return { peekbtn: a, sheetx: b, gapX: (a && b) ? +(a.x - (b.x + b.w)).toFixed(1) : null, peekText: pb ? pb.textContent : null };
};

(async () => {
  const isNew = MODE.startsWith('new');
  const h = MODE.endsWith('700') ? 700 : 620;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: h, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 160)));
  await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
  await page.click('#todeck');
  await page.waitForFunction(() => { const b = document.getElementById('startbtn'); return b && !b.disabled; }, { timeout: 30000 });
  await page.click('#startbtn');
  await sleep(3500);
  const rep = { mode: MODE, root: ROOT };

  if (isNew) {
    // raise the tray through the real builder (approved scene)
    await page.evaluate((RAIGEKI, HAKAMORI, ROLLBACK) => {
      const prompt = { name: 'SELECT_CHAIN', forced: false, entries: [
        { code: HAKAMORI, con: 0, loc: 8, seq: 3, desc: HAKAMORI * 1048576 },
        { code: ROLLBACK, con: 0, loc: 8, seq: 4, desc: ROLLBACK * 1048576 },
      ] };
      const cause = { code: RAIGEKI, con: 1, tray: '相手の<b>《サンダー・ボルト》</b>の発動にチェーンできます' };
      showChainTray(prompt, cause, [0, 1], () => {});
    }, RAIGEKI, HAKAMORI, ROLLBACK);
    await sleep(600);
    rep.tray = await page.evaluate(MEASURE_TRAY);
    await page.screenshot({ path: path.join(OUT, MODE + '-tray.png') });
    // peek the tray away with a real click on the chip
    await page.click('#ctpeek');
    await sleep(400);
    rep.trayPeek = await page.evaluate(() => {
      const host = document.getElementById('chainui');
      const tray = document.getElementById('chaintray');
      const pk = document.getElementById('ctpeek');
      const pr = pk.getBoundingClientRect();
      return { hostPeek: host.classList.contains('peek'), chipText: pk.textContent, chipH: +pr.height.toFixed(1),
        trayVisibility: getComputedStyle(tray).visibility, appTraypeek: document.getElementById('app').classList.contains('traypeek') };
    });
    await page.screenshot({ path: path.join(OUT, MODE + '-traypeek.png') });
    await page.click('#ctpeek'); // back
    await sleep(300);
    await page.evaluate(() => chainTrayClose());
  }

  // dock peek strip (real ttl markup, real CSS)
  await page.evaluate(() => {
    const dock = document.getElementById('dock');
    dock.innerHTML = '<div class="ttl"><span>チェーン応答</span><button class="dockpeekbtn" id="dock-peek">盤面を見る</button></div><div class="ctx">ctx</div>';
    dock.className = 'on';
    document.getElementById('app').classList.add('dockpeek');
  });
  await sleep(450);
  rep.strip = await page.evaluate(MEASURE_STRIP);
  await page.evaluate(() => { document.getElementById('app').classList.remove('dockpeek'); const d = document.getElementById('dock'); d.className = ''; d.innerHTML = ''; });

  // sheet peek button on a real view sheet
  const hand = await page.$('#hand .hcard');
  if (hand) { await hand.click(); await sleep(300); await page.click('#preview'); await sleep(600); }
  rep.peekbtn = await page.evaluate(MEASURE_PEEKBTN);
  await page.screenshot({ path: path.join(OUT, MODE + '-sheet.png') });
  fs.writeFileSync(path.join(OUT, MODE + '-report.json'), JSON.stringify(rep, null, 1));
  console.log(JSON.stringify(rep, null, 1));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
