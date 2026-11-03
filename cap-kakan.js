'use strict';
/* cap-kakan.js — visual capture for the per-card illustration of
   《春化精の花冠》 (Vernusylph Flower Crown, 14108995 — user art
   2026-11-03, 14th delivery), a SPELL like the books. Two
   paintings exist: the plain 'kakan' (forest) registered in
   CARD_ART, and the deck-scoped 'kakan-ishizu' (Egyptian) in
   DECK_ART. The player seat plays the Ishizu deck in a default
   duel, so the REAL-play surfaces below resolve the Egyptian
   variant; the plain-art fallback is pinned by test-cardart's
   flipped-seat fixture (the GG deck does not run Kakan, so no
   real duel can show it).
   Flow per height: start real duels until the opening hand
   contains Kakan (1 copy in the 45-card Ishizu deck), shoot the
   hand, tap it (resident preview = big art), then SET it through
   the real action sheet and shoot the own-set tile (the art
   ghosting under the breathing setown veil). A final fabricated
   board (declared, via the client's own render() in the real
   session) shows Kakan face-up in the S/T zone alongside the
   set one.
   Usage: node cap-kakan.js <outDir> [heights=620,700]          */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = __dirname;
const OUT = process.argv[2] || path.join(ROOT, 'shots-kakan');
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

const KAKAN = 14108995;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const report = {};
  for (const H of HEIGHTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: H, deviceScaleFactor: 2 });
    page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)));
    let got = false, tries = 0;
    for (; tries < 160 && !got; tries++) {
      await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
      await page.click('#startbtn');
      await page.waitForFunction(() => {
        try { return !!currentPrompt && window.__fx && window.__fx.ready && document.querySelectorAll('.slot').length >= 10; }
        catch (e) { return false; }
      }, { timeout: 60000 });
      await sleep(600);
      got = await page.evaluate(code => [...document.querySelectorAll('#hand .hcard')].some(h => h.dataset.code === String(code)), KAKAN);
      if (!got && tries % 20 === 19) console.log('  h=' + H + ' kakan: ' + (tries + 1) + ' tries so far');
    }
    console.log('h=' + H + ' kakan: in opening hand after ' + tries + ' tr' + (tries === 1 ? 'y' : 'ies'));
    if (!got) { report[H] = 'FAILED: never drew'; await page.close(); continue; }
    const shoot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '-h' + H + '.png') }); console.log('  captured', name + '-h' + H + '.png'); };
    await shoot('hand-kakan');
    await page.click('#hand .hcard[data-code="' + KAKAN + '"]');
    await sleep(500);
    await shoot('preview-kakan');
    // set the spell through the real action sheet
    const setClicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#sheet button, #dock button, .sheetbtn, button')].find(x => x.textContent.trim() === '魔法・罠をセット' && x.offsetParent !== null);
      if (b) { b.click(); return true; } return false;
    });
    console.log('  set button clicked:', setClicked);
    await sleep(700);
    const placed = await page.evaluate(() => {
      const s = document.querySelector('#mySzone .slot.hl') || document.querySelector('#mySzone .slot');
      if (s) { s.click(); return s.getAttribute('data-zone'); } return null;
    });
    console.log('  placed at zone:', placed);
    await sleep(700);
    // answer any response windows through the real UI
    for (let i = 0; i < 8; i++) {
      const clicked = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => x.offsetParent !== null && (x.textContent.trim() === '発動しない' || x.textContent.trim() === 'パス'));
        if (b) { b.click(); return b.textContent.trim(); } return null;
      });
      if (!clicked) break;
      console.log('  drained prompt via:', clicked);
      await sleep(600);
    }
    await sleep(400);
    await shoot('set-kakan');
    await sleep(2300); // half a breath cycle later (veil at the other extreme)
    await shoot('set2-kakan');
    const styles = await page.evaluate((code) => {
      const t = document.querySelector('#mySzone .tile.setown .art');
      const hand = document.querySelector('#hand .hcard[data-code="' + code + '"] .himg');
      const pv = document.querySelector('#preview .pv-art');
      return {
        setTileArt: t ? (t.getAttribute('style') || '') : null,
        setTileVeil: !!document.querySelector('#mySzone .tile.setown .veil'),
        seatDecks: typeof seatDeckKeys !== 'undefined' ? seatDeckKeys.slice() : null,
      };
    }, KAKAN);
    report[H] = styles;
    console.log('  styles:', JSON.stringify(styles));
    await page.close();

    // fabricated board in a fresh real session (declared): Kakan
    // face-up + set in the S/T zone (Ishizu seat -> Egyptian art)
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 390, height: H, deviceScaleFactor: 2 });
    await page2.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
    await page2.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
    await page2.click('#startbtn');
    await page2.waitForFunction(() => {
      try { return !!currentPrompt && window.__fx && window.__fx.ready && document.querySelectorAll('.slot').length >= 10; }
      catch (e) { return false; }
    }, { timeout: 60000 });
    await page2.evaluate((code) => {
      const st = (c, pos) => ({ code: c, pos, materials: 0 });
      const P = () => ({ mzone: [null, null, null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].szone[0] = st(code, 0x5);  // Kakan face-up
      b.players[0].szone[2] = st(code, 0xa);  // Kakan set (veil ghost)
      b.players[0].hand = [{ code }];
      window.__fx.reset(); render(b); window.__fx.process([], b);
    }, KAKAN);
    await sleep(600);
    await page2.screenshot({ path: path.join(OUT, 'field-kakan-h' + H + '.png') });
    console.log('  captured field-kakan-h' + H + '.png');
    await page2.close();
  }
  fs.writeFileSync(path.join(OUT, 'styles.json'), JSON.stringify(report, null, 1));
  await browser.close();
  server.close();
  console.log('done');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
