'use strict';
/* cap-fxround2-synth.js — fxround2 AFTER evidence in a REAL browser
   (390x620) for the scenes live draws would not deal: a fabricated
   board (test-oppinfo pattern) + synthetic prompts driven through
   the REAL uiAnswer/uiChain/gridSheet. The rendering, layout and
   answer paths are the production client's; only the prompts'
   origin is synthetic. (Live-drawn prompts: fxround2/before*.) */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const SERVE_DIR = process.argv[2];
const OUT = process.argv[3];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const KELDO = 63542003, MUDORA = 99937011, KELBEK = 25926710, GYAKUTEN = 17484499, TRAPHOLE = 98715423, ROLLBACK = 6351147, MCSOSEI = 28958464, ZOLGA = 31525442, SPHINX = 46148485;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SERVE_DIR, p);
    if (!f.startsWith(SERVE_DIR) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome',
    headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
  const rep = { f3: {}, f4: {}, f2: {}, f7cue: {} };
  const save = () => fs.writeFileSync(path.join(OUT, 'synth-report.json'), JSON.stringify(rep, null, 1));
  await page.goto('http://127.0.0.1:' + port + '/v2/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('loadmsg') && document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });

  // fabricated board (no live duel started — nothing else drives uiAnswer)
  await page.evaluate((K, M, KB) => {
    const P = () => ({ mzone: [null, null, null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
    const b = { players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], dlog: [], lastAttack: null };
    const mon = (code, pos) => ({ code, pos, materials: 0, counters: null, curAtk: null, curDef: null });
    b.players[1].mzone[0] = mon(K, 0x1);
    b.players[1].mzone[1] = mon(KB, 0x1);
    b.players[0].mzone[0] = mon(M, 0x1);
    duelState = b; render(b);
    fxSettings.resp = 'on';
    // the state a real duel is in: the title page is put away
    // (same style switch the start flow itself uses)
    document.getElementById('start').style.display = 'none';
  }, KELDO, MUDORA, KELBEK);
  await sleep(600);

  // ---- F4 precondition: open the detail view the real user way ----
  await page.evaluate(() => { const s = document.querySelector('.slot[data-zone="1:4:0"]'); if (s) s.click(); });
  await sleep(300);
  await page.evaluate(() => { const pv = document.getElementById('preview'); if (pv) pv.click(); });
  await sleep(500);
  rep.f4.viewOpen = await page.evaluate(() => { const sw = document.getElementById('sheetwrap'); return sw.className === 'on' && sw.dataset.kind === 'view'; });
  await page.screenshot({ path: path.join(OUT, 'f4-view-open.png') });

  // ---- F3+F4: chain prompt dispatch while the view is open ----
  await page.evaluate((M, K) => {
    window.__synthChain = false;
    duelState.chain = [{ code: K }];
    const e = { code: M, con: 0, loc: 8, seq: 0, desc: M * 1048576 };
    uiAnswer({ name: 'SELECT_CHAIN', forced: false, entries: [e] }, duelState).then(() => { window.__synthChain = true; });
  }, MUDORA, KELDO);
  await page.waitForFunction(() => document.getElementById('dock').className === 'on', { timeout: 15000 }).catch(() => {});
  await sleep(600); // let the view's 185ms exit motion land
  rep.f4.viewAfterDock = await page.evaluate(() => { const sw = document.getElementById('sheetwrap'); return { cls: sw.className, kind: sw.dataset.kind || null }; });
  rep.f3 = await page.evaluate(() => {
    const dk = document.getElementById('dock');
    const btn = dk.querySelector('[data-chainact]');
    const r = btn ? btn.getBoundingClientRect() : null;
    return { dockOn: dk.className === 'on', hasActBtn: !!btn, label: btn ? btn.textContent : null,
             btnRect: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null,
             ctx: (dk.querySelector('.ctx') || {}).textContent || '' };
  });
  await page.screenshot({ path: path.join(OUT, 'f3-dock-after.png') });
  // click the button for real — the prompt must resolve through it
  await page.evaluate(() => { const b = document.querySelector('#dock [data-chainact]'); if (b) b.click(); });
  await sleep(800);
  rep.f3.resolvedViaButton = await page.evaluate(() => window.__synthChain === true);
  save();

  // ---- F2 + F7 cue: a 9-card SELECT_CARD grid (overflows the sheet) ----
  await page.evaluate((codes) => {
    window.__synthGrid = false;
    const locs = [2, 16, 1, 2, 16, 1, 2, 16, 1];
    const cards = codes.map((code, i) => ({ code, con: 0, loc: locs[i], seq: i, releaseParam: 0 }));
    uiAnswer({ name: 'SELECT_CARD', player: 0, min: 1, max: 1, cancelable: true, retryCount: 0, context: null, cards }, duelState)
      .then(() => { window.__synthGrid = true; });
  }, [MCSOSEI, KELDO, GYAKUTEN, MUDORA, TRAPHOLE, ROLLBACK, KELBEK, ZOLGA, SPHINX]);
  await page.waitForFunction(() => !!document.querySelector('[data-grid]'), { timeout: 15000 }).catch(() => {});
  await sleep(700);
  rep.f2 = await page.evaluate(() => {
    const g = document.querySelector('.gcard'), grid = document.querySelector('.grid'), sheet = document.getElementById('sheet');
    const it = g.querySelector('.itext'), loc = g.querySelector('.loc'), nm = g.querySelector('.nm');
    const R = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
    const cue = document.getElementById('gridmore');
    return { tile: R(g), cols: getComputedStyle(grid).gridTemplateColumns, itextFont: getComputedStyle(it).fontSize,
             locRect: R(loc), nmRect: R(nm), locPos: getComputedStyle(loc).position,
             sheetScrollH: sheet.scrollHeight, sheetClientH: sheet.clientHeight,
             cuePresent: !!cue, cueVisible: cue ? getComputedStyle(cue).display !== 'none' : null,
             cueText: cue ? cue.textContent : null, title: (document.querySelector('#sheet .ttl') || {}).textContent || '' };
  });
  rep.f7cue.cueAtTop = rep.f2.cueVisible;
  await page.screenshot({ path: path.join(OUT, 'f2-grid-after.png') });
  await page.evaluate(() => { const s = document.getElementById('sheet'); s.scrollTop = s.scrollHeight; });
  await sleep(400);
  rep.f7cue.cueAtBottom = await page.evaluate(() => { const c = document.getElementById('gridmore'); return c ? getComputedStyle(c).display !== 'none' : null; });
  await page.screenshot({ path: path.join(OUT, 'f2-grid-scrolled.png') });
  // answer the grid so nothing dangles
  await page.evaluate(() => { const t = document.querySelector('[data-grid="0"]'); if (t) t.click(); });
  await sleep(200);
  await page.evaluate(() => { const c = document.getElementById('grid-confirm'); if (c) c.click(); });
  await sleep(500);
  rep.f2.resolved = await page.evaluate(() => window.__synthGrid === true);
  save();
  console.log(JSON.stringify(rep, null, 1));
  await browser.close();
  server.close();
}
main().catch(e => { console.error('SYNTH FATAL', e); process.exit(2); });
