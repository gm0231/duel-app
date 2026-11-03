'use strict';
/* cap-cardan.js — visual capture for per-card illustrations (Cardan,
   user art 2026-11-03, 6th delivery). Real play only for the board
   surfaces: start real duels until the opening hand contains Cardan
   (3 copies in the Ishizu deck),
   then tap it (preview), normal-summon it through the real action
   sheet (board tile) and shoot every stage at 390x620 / 390x700.
   The cut-in big card is shot via fxCutinShow(86605515) directly:
   Cardan is not a keycard, so no real-play path reaches a cut-in
   with him — that substitution is declared in the round report.
   Usage: node cap-cardan.js <outDir> [heights=620,700]          */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = __dirname;
const OUT = process.argv[2] || path.join(ROOT, 'shots-cardan');
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

const CARDAN = 86605515;
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
    for (; tries < 40 && !got; tries++) {
      await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
      await page.click('#startbtn');
      await page.waitForFunction(() => {
        try { return !!currentPrompt && window.__fx && window.__fx.ready && document.querySelectorAll('.slot').length >= 10; }
        catch (e) { return false; }
      }, { timeout: 60000 });
      await sleep(600);
      got = await page.evaluate(code => [...document.querySelectorAll('#hand .hcard')].some(h => h.dataset.code === String(code)), CARDAN);
      if (!got) console.log('h=' + H + ' try ' + (tries + 1) + ': no Cardan in hand, restarting');
    }
    console.log('h=' + H + ': Cardan in opening hand after ' + tries + ' tr' + (tries === 1 ? 'y' : 'ies'));
    if (!got) { report[H] = 'FAILED: Cardan never drew'; await page.close(); continue; }
    const shoot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '-h' + H + '.png') }); console.log('  captured', name + '-h' + H + '.png'); };
    await shoot('hand');
    // tap the Cardan hand card -> preview must switch to him
    await page.click('#hand .hcard[data-code="' + CARDAN + '"]');
    await sleep(500);
    await shoot('preview');
    // normal summon through the real action sheet
    const summoned = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#sheet button, #dock button, .sheetbtn, button')].find(x => x.textContent.trim() === '通常召喚' && x.offsetParent !== null);
      if (b) { b.click(); return true; } return false;
    });
    console.log('  summon button clicked:', summoned);
    await sleep(700);
    // placement flow: tap a highlighted own monster-zone slot
    const placed = await page.evaluate(() => {
      const s = document.querySelector('#myMzone .slot.hl') || document.querySelector('#myMzone .slot');
      if (s) { s.click(); return s.getAttribute('data-zone'); } return null;
    });
    console.log('  placed at zone:', placed);
    await sleep(700);
    // a position choice may follow: pick 攻撃表示 (attack) if offered
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /攻撃表示/.test(x.textContent) && x.offsetParent !== null);
      if (b) b.click();
    });
    await sleep(900);
    // Cardan's ① is an on-summon optional effect and opens response
    // windows (unlike the previous five): answer them through the
    // real UI (発動しない / パス) until the board settles, so the
    // field frame shows the tile itself.
    const drain = async () => {
      for (let i = 0; i < 8; i++) {
        const clicked = await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find(x => x.offsetParent !== null && (x.textContent.trim() === '発動しない' || x.textContent.trim() === 'パス'));
          if (b) { b.click(); return b.textContent.trim(); } return null;
        });
        if (!clicked) return;
        console.log('  drained prompt via:', clicked);
        await sleep(600);
      }
    };
    await drain();
    await sleep(500);
    await shoot('field');
    // cut-in big card (declared substitution: no real-play path for Cardan)
    await drain();
    await page.evaluate(code => { fxCutinShow(code); }, CARDAN);
    await sleep(600);
    await shoot('cutin');
    // six-arts frame: real duel session, board painted via the
    // client's own render() with all six deliveries side by side
    // (declared fabrication — the six almost never co-occur
    // in one real opening hand).
    await drain();
    await page.evaluate(() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null, null, null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(99937011, 0x1);
      b.players[0].mzone[1] = mon(62320425, 0x1);
      b.players[0].mzone[2] = mon(25926710, 0x1);
      b.players[0].mzone[3] = mon(63542003, 0x1);
      b.players[0].mzone[4] = mon(86605515, 0x1);
      b.players[0].hand = [{ code: 99937011 }, { code: 62320425 }, { code: 25926710 }, { code: 63542003 }, { code: 31525442 }, { code: 86605515 }];
      window.__fx.reset(); render(b); window.__fx.process([], b);
    });
    await sleep(600);
    await shoot('both');
    const styles = await page.evaluate(() => {
      const grab = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundImage.slice(0, 90) : null; };
      return {
        handArt: grab('#hand .hcard[data-code="86605515"] .himg'),
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
