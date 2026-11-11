'use strict';
/* cap-fxround-pop2.js — focused capture: the SECOND link's pop in a
   two-batch opponent chain, framed by that scene's own FX-local
   time. Usage: node cap-fxround-pop2.js <repoRoot> <outPng>      */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');
const ROOT = path.resolve(process.argv[2]);
const OUTPNG = process.argv[3];
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
  const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos: pos == null ? 1 : pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
  const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
  const base = () => ({ players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 1, log: [], lastAttack: null, events: [] });
  const ZORGA = 31525442, KELBEK = 25926710, AGIDO = 16135253, KELDO = 63542003, MUDRA = 99937011;
  const b = base(); b.players[0].mzone[0] = mon(ZORGA); b.players[1].mzone[2] = mon(KELBEK); b.players[1].hand = [{code:KELDO},{code:MUDRA},{code:AGIDO}];
  const t1 = base(); t1.players[0].mzone[0] = mon(ZORGA); t1.players[1].mzone[2] = mon(KELBEK); t1.players[1].hand = [{code:MUDRA},{code:AGIDO}]; t1.chain = [{ code: KELDO, con: 1 }];
  const t2 = base(); t2.players[0].mzone[0] = mon(ZORGA); t2.players[1].mzone[2] = mon(KELBEK); t2.players[1].hand = [{code:AGIDO}]; t2.chain = [{ code: KELDO, con: 1 }, { code: MUDRA, con: 1 }];
  return {
    baseline() { window.__fx.reset(); render(b); window.__fx.process([], b); },
    step1() { render(t1); window.__fx.process([], t1); return window.__fx.scenes(); },
    step2() { render(t2); window.__fx.process([], t2); return window.__fx.scenes(); },
    pop2() { const ss = window.__fx.scenes().filter(s => s.kind === 'chainpop'); if (!ss.length) return null; const s = ss[ss.length - 1]; return { t0: s.t0, dur: s.dur, local: Math.round(window.__fx.now() - s.t0), count: ss.length }; },
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
  await page.evaluate(() => window.__cap.baseline());
  await sleep(150);
  console.log('step1 scenes:', JSON.stringify(await page.evaluate(() => window.__cap.step1())));
  await sleep(300);
  console.log('step2 scenes:', JSON.stringify(await page.evaluate(() => window.__cap.step2())));
  // wait until the LAST chainpop's local time reaches ~300, then shoot
  await page.waitForFunction(() => { const p = window.__cap.pop2(); return p && p.local >= 300; }, { timeout: 15000 }).catch(() => {});
  const info = await page.evaluate(() => window.__cap.pop2());
  await page.screenshot({ path: OUTPNG });
  console.log('captured pop2 at local:', JSON.stringify(info), '->', OUTPNG);
  await browser.close(); server.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
