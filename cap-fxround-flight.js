'use strict';
/* cap-fxround-flight.js — catch a hand->field flight ghost mid-transit
   by polling the ghost's real rect. Usage:
   node cap-fxround-flight.js <repoRoot> <outPng> [scene=opp-summon|my-set] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');
const ROOT = path.resolve(process.argv[2]);
const OUTPNG = process.argv[3];
const SCENE = process.argv[4] || 'opp-summon';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.m4a': 'audio/m4a', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const SETUP = `
window.__cap = (() => {
  const E = window.Engine;
  const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos: pos == null ? 1 : pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
  const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
  const base = () => ({ players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 1, log: [], lastAttack: null, events: [] });
  const ZORGA = 31525442, KELBEK = 25926710, AGIDO = 16135253, GKTRAP = 98715423;
  const D = {};
  D['opp-summon'] = (() => { const b = base(); b.players[0].mzone[0] = mon(ZORGA); b.players[1].hand = [{code:KELBEK},{code:AGIDO},{code:ZORGA}];
    const t = base(); t.players[0].mzone[0] = mon(ZORGA); t.players[1].hand = [{code:AGIDO},{code:ZORGA}]; t.players[1].mzone[2] = mon(KELBEK);
    return { b, t, evs: [{ kind: 'summon', code: KELBEK, con: 1 }] }; })();
  D['my-set'] = (() => { const b = base(); b.players[0].hand = [{code:GKTRAP}]; b.players[1].mzone[0] = mon(KELBEK);
    const t = base(); t.players[1].mzone[0] = mon(KELBEK); t.players[0].szone[1] = { code: GKTRAP, pos: 8 };
    return { b, t, evs: [{ kind: 'set', code: GKTRAP, con: 0, loc: E.LOC.SZONE }] }; })();
  return {
    baseline(name) { const d = D[name]; window.__fx.reset(); render(d.b); window.__fx.process([], d.b); },
    trigger(name) { const d = D[name]; render(d.t); window.__fx.process(d.evs, d.t); return window.__fx.log.slice(-6); },
    ghosts() { return [...document.querySelectorAll('#fxlayer .fx-ghost')].map(g => { const r = g.getBoundingClientRect(); return { cls: g.className, cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; }); },
  };
})();`;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
  await page.click('#todeck');
  await page.waitForFunction(() => { const b = document.getElementById('startbtn'); return b && !b.disabled; }, { timeout: 30000 });
  await page.click('#startbtn');
  await page.waitForFunction(() => { try { return !!currentPrompt && window.__fx && window.__fx.ready; } catch (e) { return false; } }, { timeout: 60000 });
  await sleep(600);
  await page.evaluate(SETUP);
  await page.evaluate((n) => window.__cap.baseline(n), SCENE);
  await sleep(150);
  const log = await page.evaluate((n) => window.__cap.trigger(n), SCENE);
  console.log('trigger log:', JSON.stringify(log));
  const samples = [];
  let shot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 1600) {
    const gs = await page.evaluate(() => window.__cap.ghosts());
    if (gs.length) samples.push({ at: Date.now() - t0, gs });
    // mid-transit: a ghost whose center is in the upper-middle band
    // (between the opponent hand chip row and the monster zones)
    const mid = gs.find(g => g.cy > 60 && g.cy < 150 && g.w >= 30);
    if (mid && !shot) { await page.screenshot({ path: OUTPNG }); shot = true; console.log('mid-flight shot at', Date.now() - t0, JSON.stringify(mid)); break; }
    await sleep(30);
  }
  if (!shot) { await page.screenshot({ path: OUTPNG }); console.log('no mid-transit ghost caught; samples:', JSON.stringify(samples).slice(0, 600)); }
  await browser.close(); server.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
