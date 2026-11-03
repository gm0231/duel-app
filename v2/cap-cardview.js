'use strict';
/* cap-cardview.js — visual capture for the card-view round +
   the keycard S/T activation cut-in (2026-11-04). Serves THIS
   worktree's v2, parks a real duel, then paints fabricated
   states through the client's own render()/fxProcess and
   screenshots at phone sizes. Usage:
     node cap-cardview.js <scenario>
   Scenarios: grave-620 grave-700 detail-620 detail-700
              keyact-620 keyact-700                        */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const APP = __dirname;
const OUT = '/home/hatch/workspace/duel-app-cardview-shots';
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.m4a': 'audio/m4a', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/app/')) p = p.slice(4);
  if (p.endsWith('/')) p += 'index.html';
  // the app references ../assets/... (repo-root assets, as on
  // Pages where /v2/ and /assets/ are siblings): map them to the
  // worktree root instead of 404ing inside v2/
  const file = p.startsWith('/assets/') ? path.join(APP, '..', p) : path.join(APP, p);
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const SETUP = `
window.__cap = (() => {
  const MUDORA = 99937011, KELBEK = 25926710, MORI = 36745317, HORUS = 36898537, KELDO = 63542003, ZOLGA = 31525442;
  const UNLISTED = 16135253, LUCE = 45409943, KEY1 = 98715423;
  const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
  const base = () => ({ players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], dlog: [], lastAttack: null, deckTop: [null, null] });
  const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos: pos == null ? 1 : pos, materials: 0, counters: null, curAtk: d ? d.atk : null, curDef: d ? d.def : null }; };
  return {
    paintBoard() {
      const b = base();
      seatDeckKeys = ['ishizu', 'gg'];
      b.players[0].mzone[1] = mon(MORI); b.players[0].mzone[3] = mon(KELBEK);
      b.players[1].mzone[0] = mon(ZOLGA);
      b.players[0].grave = [UNLISTED, MUDORA, KELDO, KELBEK];
      b.players[0].removed = [null, KELBEK];
      b.players[0].extra = [{ code: LUCE }, { code: HORUS }];
      b.players[0].hand = [{ code: MUDORA }, { code: KELDO }];
      duelState = b; window.__fx.reset(); render(b); window.__fx.process([], b);
      return true;
    },
    graveSheet() { openPileSheet('grave', 0); },
    detailSheet() { openCardInfo(MUDORA); },
    keyBase() {
      const b = base();
      seatDeckKeys = ['ishizu', 'gg'];
      b.players[1].mzone[0] = mon(KELBEK);
      b.players[1].szone[0] = mon(KEY1, 0xa);
      b.players[0].mzone[1] = mon(MORI);
      duelState = b; window.__fx.reset(); render(b); window.__fx.process([], b);
      return true;
    },
    keyFire() {
      const b = base();
      seatDeckKeys = ['ishizu', 'gg'];
      b.players[1].mzone[0] = mon(KELBEK);
      b.players[1].szone[0] = mon(KEY1, 0x5);
      b.players[0].mzone[1] = mon(MORI);
      b.chain = [{ code: KEY1, con: 1, loc: Engine.LOC.SZONE, seq: 0, desc: 0 }];
      duelState = b; render(b);
      const before = window.__fx.log.length;
      window.__fx.process([{ kind: 'activate', code: KEY1, con: 1, loc: Engine.LOC.SZONE }], b);
      const sc = window.__fx.scenes().find(s => s.kind === 'keycardact');
      return { scene: sc || null, newLog: window.__fx.log.slice(before) };
    },
  };
})()`;

const SCEN = {
  'grave-620': { height: 620, mode: 'grave' },
  'grave-700': { height: 700, mode: 'grave' },
  'detail-620': { height: 620, mode: 'detail' },
  'detail-700': { height: 700, mode: 'detail' },
  'keyact-620': { height: 620, mode: 'keyact', fx: 1000 },
  'keyact-700': { height: 700, mode: 'keyact', fx: 1000 },
};

(async () => {
  const name = process.argv[2];
  const S = SCEN[name];
  if (!S) { console.error('unknown scenario', name); process.exit(2); }
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: S.height, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)));
  await page.goto('http://127.0.0.1:' + port + '/app/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
  const toDeck = await page.$('#todeck');
  if (toDeck) { await page.click('#todeck'); await new Promise(r => setTimeout(r, 400)); }
  await page.click('#startbtn');
  await page.waitForFunction(() => {
    try { return typeof currentPrompt !== 'undefined' && !!currentPrompt && window.__fx && window.__fx.ready && document.querySelectorAll('.slot').length >= 10; }
    catch (e) { return false; }
  }, { timeout: 60000 });
  await new Promise(r => setTimeout(r, 800));
  await page.evaluate(SETUP);
  if (S.mode === 'grave' || S.mode === 'detail') {
    await page.evaluate(() => window.__cap.paintBoard());
    await page.evaluate((m) => { if (m === 'grave') window.__cap.graveSheet(); else window.__cap.detailSheet(); }, S.mode);
    await new Promise(r => setTimeout(r, 900)); // sheet-in + row stagger settle
    const probe = await page.evaluate(() => {
      const g = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height), txt: (e.textContent || '').slice(0, 24) }; };
      const sheet = document.getElementById('sheet');
      return { sheet: g('#sheet'), scrollH: sheet ? sheet.scrollHeight : null, clientH: sheet ? sheet.clientHeight : null, art: g('#sheet .infoart'), ttl: g('#sheet .ttl'), sub: g('#sheet .sub'), cardtext: g('#sheet .cardtext'), thumbs: [...document.querySelectorAll('#sheet .pthumb')].map(e => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), bg: (e.style.backgroundImage || 'class').slice(0, 44) }; }) };
    });
    console.log('PROBE', JSON.stringify(probe));
  } else {
    await page.evaluate(() => window.__cap.keyBase());
    const trig = await page.evaluate(() => window.__cap.keyFire());
    console.log('trig:', JSON.stringify(trig));
    if (!trig.scene) { console.log('NO SCENE'); process.exit(3); }
    const t0 = trig.scene.t0;
    let localMs = null;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      localMs = await page.evaluate((t0arg, tgt) => {
        const fx = window.__fx; if (!fx) return null;
        const local = fx.now() - t0arg;
        if (local >= tgt) { fx.hitStop(1600); return fx.now() - t0arg; }
        return null;
      }, t0, S.fx).catch(() => null);
      if (localMs != null) break;
      await new Promise(r => setTimeout(r, 8));
    }
    console.log('froze at local', localMs);
    await new Promise(r => setTimeout(r, 130));
  }
  const out = path.join(OUT, name + '.png');
  await page.screenshot({ path: out });
  console.log(JSON.stringify({ scenario: name, file: out, height: S.height }));
  await browser.close(); server.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); try { server.close(); } catch (_) {} process.exit(1); });
