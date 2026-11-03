'use strict';
/* cap-oppinfo.js — visual capture for the opponent-info round
   (user request 2026-11-04: tap an opponent's card, see its
   public info — face-up only; and check info mid-selection
   without disturbing the selection).
   One real-browser flow per height, served from this worktree:
   1) start a real duel, fabricate the opponent's face-up board
      over the stalled opening state through the client's own
      render(), then make a REAL mouse click on the opponent's
      monster slot (genuine hit-testing) — the resident preview
      must show the opponent card. Shoot oppinfo-board.
   2) open a synthetic SELECT_CARD, select a candidate, peek
      the sheet down, then make a REAL mouse click on the
      opponent's face-up spell slot — the tap lands on the
      sheet wrap and must be forwarded to the read-only detail
      (infopop) floating over the board, selection untouched.
      Shoot oppinfo-peek.
   Usage: node cap-oppinfo.js <outDir> [heights=620,700]      */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = __dirname;
const OUT = process.argv[2] || path.join(ROOT, 'shots-oppinfo');
const HEIGHTS = (process.argv[3] || '620,700').split(',').map(Number);
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

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'v2', 'data.json'), 'utf8'));
const ggMain = data.decks.gg.main;
const OPP_MON = ggMain.find(c => (data.cards[c].type & 0x1) && data.cards[c].level >= 5) || ggMain.find(c => (data.cards[c].type & 0x1));
const OPP_ST = ggMain.find(c => (data.cards[c].type & 0x6)) || ggMain[0];
const OWN_MON = 99937011; // Mudora
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('opp monster:', OPP_MON, data.names[OPP_MON], '| opp s/t:', OPP_ST, data.names[OPP_ST]);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const report = {};
  for (const H of HEIGHTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: H, deviceScaleFactor: 2 });
    page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)));
    await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
    await page.click('#startbtn');
    await page.waitForFunction(() => {
      try { return !!currentPrompt && document.querySelectorAll('.slot').length >= 10; } catch (e) { return false; }
    }, { timeout: 60000 });
    await sleep(800);
    const shoot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '-h' + H + '.png') }); console.log('  captured', name + '-h' + H + '.png'); };
    const clickSlot = async (sel) => {
      const box = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, sel);
      if (!box) return false;
      await page.mouse.click(box.x, box.y);
      return true;
    };

    // ---- 1) fabricated opponent board over the stalled duel ----
    await page.evaluate((om, ost, own) => {
      const mon = (code, pos) => ({ code, pos, materials: 0, counters: null, curAtk: null, curDef: null });
      duelState.players[1].mzone[1] = mon(om, 0x1);
      duelState.players[1].szone[1] = mon(ost, 0x5);
      duelState.players[0].mzone[0] = mon(own, 0x1);
      sheetClose(); dockClose(); closeInfoPop();
      render(duelState);
    }, OPP_MON, OPP_ST, OWN_MON);
    await sleep(500);
    await clickSlot('#oppMzone .slot[data-zone="1:4:1"]');
    await sleep(500);
    const boardInfo = await page.evaluate(() => ({
      pv: previewState && { code: previewState.code, con: previewState.con },
      pvName: (document.querySelector('#preview .pv-name') || {}).textContent || (document.getElementById('preview') || {}).textContent.slice(0, 40),
    }));
    console.log('h=' + H + ' board tap preview:', JSON.stringify(boardInfo));
    await shoot('oppinfo-board');

    // ---- 2) mid-selection peek info (real hit-testing through the wrap) ----
    await page.evaluate((om, own) => {
      window.__capResolved = false;
      const prompt = { name: 'SELECT_CARD', player: 0, min: 1, max: 1, cancelable: true, retryCount: 0, context: null,
        cards: [ { code: om, con: 1, loc: 4, seq: 1, releaseParam: 0 }, { code: own, con: 0, loc: 4, seq: 0, releaseParam: 0 } ] };
      uiAnswer(prompt, duelState).then(() => { window.__capResolved = true; });
    }, OPP_MON, OWN_MON);
    await page.waitForFunction(() => !!document.querySelector('[data-grid]'), { timeout: 20000 });
    await sleep(400);
    // uiAnswer refreshed the board from the worker's real snapshot
    // (wiping the step-1 fabrication), so fabricate again now that
    // the sheet is up — render() does not touch the sheet's DOM.
    await page.evaluate((om, ost, own) => {
      const mon = (code, pos) => ({ code, pos, materials: 0, counters: null, curAtk: null, curDef: null });
      duelState.players[1].mzone[1] = mon(om, 0x1);
      duelState.players[1].szone[1] = mon(ost, 0x5);
      duelState.players[0].mzone[0] = mon(own, 0x1);
      render(duelState);
    }, OPP_MON, OPP_ST, OWN_MON);
    await sleep(400);
    await page.click('[data-grid="0"]');
    await sleep(300);
    await page.click('#peekbtn');
    await sleep(500);
    await clickSlot('#oppSzone .slot[data-zone="1:8:1"]');
    await sleep(600);
    const peekInfo = await page.evaluate(() => ({
      infopopOn: document.getElementById('infopop').className === 'on',
      infopopTtl: (document.querySelector('#infopop .ttl') || {}).textContent || '',
      selKept: !!document.querySelector('[data-grid="0"].sel'),
      resolved: window.__capResolved,
      promptPending: !!currentPrompt,
    }));
    console.log('h=' + H + ' peek info:', JSON.stringify(peekInfo));
    await shoot('oppinfo-peek');
    report[H] = { boardInfo, peekInfo };
    await page.close();
  }
  fs.writeFileSync(path.join(OUT, 'styles.json'), JSON.stringify(report, null, 1));
  await browser.close();
  server.close();
  console.log('done');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
