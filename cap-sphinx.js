'use strict';
/* cap-sphinx.js — visual capture for per-card illustrations (Sphinx,
   user art 2026-11-03, 7th delivery). Real play for the hand and
   preview surfaces: start real duels until the opening hand
   contains Sphinx (only 1 copy in the Ishizu deck), tap her
   (preview) and shoot at 390x620 / 390x700.
   Declared substitutions (as in earlier rounds):
   - Field tile: Sphinx is level 10 and cannot be tribute-summoned
     from an opening hand, so the field frame is painted via the
     client's own render() inside the real duel session.
   - Cut-in: Sphinx IS a keycard, so a real-play cut-in path
     exists; the frame calls fxCutinShow(46148485) — the exact
     function the keycard-summon path itself calls — inside the
     real session, rather than staging a full tribute summon.
   Usage: node cap-sphinx.js <outDir> [heights=620,700]          */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = __dirname;
const OUT = process.argv[2] || path.join(ROOT, 'shots-sphinx');
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

const SPHINX = 46148485;
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
    for (; tries < 80 && !got; tries++) {
      await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
      await page.click('#startbtn');
      await page.waitForFunction(() => {
        try { return !!currentPrompt && window.__fx && window.__fx.ready && document.querySelectorAll('.slot').length >= 10; }
        catch (e) { return false; }
      }, { timeout: 60000 });
      await sleep(600);
      got = await page.evaluate(code => [...document.querySelectorAll('#hand .hcard')].some(h => h.dataset.code === String(code)), SPHINX);
      if (!got) console.log('h=' + H + ' try ' + (tries + 1) + ': no Sphinx in hand, restarting');
    }
    console.log('h=' + H + ': Sphinx in opening hand after ' + tries + ' tr' + (tries === 1 ? 'y' : 'ies'));
    if (!got) { report[H] = 'FAILED: Sphinx never drew'; await page.close(); continue; }
    const shoot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '-h' + H + '.png') }); console.log('  captured', name + '-h' + H + '.png'); };
    await shoot('hand');
    // tap the Sphinx hand card -> preview must switch to her
    await page.click('#hand .hcard[data-code="' + SPHINX + '"]');
    await sleep(500);
    await shoot('preview');
    // cut-in big card (declared substitution: fxCutinShow is the
    // function the real keycard-summon path calls)
    await page.evaluate(code => { fxCutinShow(code); }, SPHINX);
    await sleep(600);
    await shoot('cutin');
    // seven-arts frame: real duel session, board painted via the
    // client's own render() with all seven deliveries on show —
    // Sphinx face-up on the field AND in hand (declared
    // fabrication: the seven almost never co-occur in real play,
    // and Sphinx cannot reach the field from an opening hand).
    await page.evaluate(() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null, null, null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(99937011, 0x1);
      b.players[0].mzone[1] = mon(62320425, 0x1);
      b.players[0].mzone[2] = mon(25926710, 0x1);
      b.players[0].mzone[3] = mon(63542003, 0x1);
      b.players[0].mzone[4] = mon(46148485, 0x1);
      b.players[0].hand = [{ code: 31525442 }, { code: 86605515 }, { code: 46148485 }];
      window.__fx.reset(); render(b); window.__fx.process([], b);
    });
    await sleep(600);
    await shoot('both');
    const styles = await page.evaluate(() => {
      const grab = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundImage.slice(0, 90) : null; };
      return {
        handArt: grab('#hand .hcard[data-code="46148485"] .himg'),
        fieldArt: (() => { const t = [...document.querySelectorAll('#myMzone .tile .art')].map(a => getComputedStyle(a).backgroundImage.slice(0, 90)); return t; })(),
        bigcard: grab('#fxcutin .bigcard'),
      };
    });
    report[H] = styles;
    console.log('  styles h=' + H + ':', JSON.stringify(styles, null, 1));
    await page.close();
  }
  fs.writeFileSync(path.join(OUT, 'styles.json'), JSON.stringify(report, null, 1));
  await browser.close();
  server.close();
  console.log('done');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
