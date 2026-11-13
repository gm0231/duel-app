'use strict';
/* cap-dmglayout.js — BU-72/73 verification rig: real-browser rect
   measurement of the IMPLEMENTED build (not the mock).
   Measures, at 390x620 and 390x700: the header height, the LP
   band height, their sum (acceptance: <= 134px with the standard
   two-line event line), the phase/history button heights, the
   tile size (--sw x --sh and the first slot's rect) and the hand
   card height — plus the worst case (a three-line event line).
   Mode old* serves a pristine tree and measures the retired
   topbar+midbar+mybar stack for the before/after table.
   Usage: node cap-dmglayout.js <serveRoot> <outDir> <mode>
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

const MEASURE_NEW = () => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1), w: +r.width.toFixed(1) }; };
  const cs = getComputedStyle(document.documentElement);
  const ll = document.getElementById('logline');
  const slot = document.querySelector('#oppMzone .slot') || document.querySelector('.slot');
  const hcard = document.querySelector('.hcard');
  return {
    vh: window.innerHeight,
    header: R(document.getElementById('header')),
    lpband: R(document.getElementById('lpband')),
    oppPlate: R(document.getElementById('oppPlate')),
    myPlate: R(document.getElementById('myPlate')),
    phasebtn: R(document.getElementById('phasebtn')),
    loghistbtn: R(document.getElementById('loghistbtn')),
    logline: R(ll), loglineText: ll ? ll.textContent : null,
    slot: R(slot),
    hcard: R(hcard),
    vars: { sw: cs.getPropertyValue('--sw').trim(), sh: cs.getPropertyValue('--sh').trim(), hw: cs.getPropertyValue('--hw').trim(), hh: cs.getPropertyValue('--hh').trim() },
    compactui: document.getElementById('app').classList.contains('compactui'),
  };
};
const MEASURE_OLD = () => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1), w: +r.width.toFixed(1) }; };
  const cs = getComputedStyle(document.documentElement);
  const slot = document.querySelector('#oppMzone .slot') || document.querySelector('.slot');
  const hcard = document.querySelector('.hcard');
  return {
    vh: window.innerHeight,
    topbar: R(document.getElementById('topbar')),
    midbar: R(document.getElementById('midbar')),
    mybar: R(document.getElementById('mybar')),
    slot: R(slot),
    hcard: R(hcard),
    vars: { sw: cs.getPropertyValue('--sw').trim(), sh: cs.getPropertyValue('--sh').trim(), hw: cs.getPropertyValue('--hw').trim(), hh: cs.getPropertyValue('--hh').trim() },
    compactui: document.getElementById('app').classList.contains('compactui'),
  };
};
// A representative two-line event line and a three-line worst case,
// written into the line the way nbHTML renders units (plain text is
// enough for the height question).
const LONG2 = '相手：《墓守の罠》の効果で《剣神官ムドラ》を手札に加えた';
const LONG3 = '自分：《現世と冥界の逆転》を発動。お互いのデッキと墓地を全て入れ替えた。相手の墓地のカードがデッキに戻った';

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
    rep.natural = await page.evaluate(MEASURE_NEW);
    await page.evaluate((t) => { document.getElementById('logline').textContent = t; }, LONG2);
    await sleep(300);
    rep.twoLine = await page.evaluate(MEASURE_NEW);
    await page.evaluate((t) => { document.getElementById('logline').textContent = t; }, LONG3);
    await sleep(300);
    rep.threeLine = await page.evaluate(MEASURE_NEW);
    await page.screenshot({ path: path.join(OUT, MODE + '.png') });
  } else {
    rep.natural = await page.evaluate(MEASURE_OLD);
    await page.screenshot({ path: path.join(OUT, MODE + '.png') });
  }
  fs.writeFileSync(path.join(OUT, MODE + '-report.json'), JSON.stringify(rep, null, 1));
  console.log(JSON.stringify(rep, null, 1));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
