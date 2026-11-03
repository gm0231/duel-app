'use strict';
/* cap-books.js — visual capture for per-card illustrations (Book of
   Taiyou / Book of Moon, user art 2026-11-03, 8th/9th deliveries —
   the first SPELLS with individual art). For each book: start real
   duels until the opening hand contains it (1 copy each in the
   Ishizu deck), tap it (preview), then SET it through the real
   action sheet and shoot the own-set tile — the book's face
   ghosting under the breathing setown veil is the new surface
   these deliveries add. A final fabricated board (declared, via
   the client's own render() in the real session) shows both
   books face-up in the S/T zone alongside the set one.
   Usage: node cap-books.js <outDir> [heights=620,700]          */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = __dirname;
const OUT = process.argv[2] || path.join(ROOT, 'shots-books');
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

const BOOKS = [{ code: 38699854, slug: 'taiyou' }, { code: 14087893, slug: 'tsuki' }];
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const report = {};
  for (const H of HEIGHTS) {
    report[H] = {};
    for (const book of BOOKS) {
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
        got = await page.evaluate(code => [...document.querySelectorAll('#hand .hcard')].some(h => h.dataset.code === String(code)), book.code);
        if (!got) console.log('h=' + H + ' ' + book.slug + ' try ' + (tries + 1) + ': not in hand, restarting');
      }
      console.log('h=' + H + ' ' + book.slug + ': in opening hand after ' + tries + ' tr' + (tries === 1 ? 'y' : 'ies'));
      if (!got) { report[H][book.slug] = 'FAILED: never drew'; await page.close(); continue; }
      const shoot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '-h' + H + '.png') }); console.log('  captured', name + '-h' + H + '.png'); };
      await shoot('hand-' + book.slug);
      await page.click('#hand .hcard[data-code="' + book.code + '"]');
      await sleep(500);
      await shoot('preview-' + book.slug);
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
      await shoot('set-' + book.slug);
      await sleep(2300); // half a breath cycle later (veil at the other extreme)
      await shoot('set2-' + book.slug);
      const styles = await page.evaluate((code) => {
        const t = document.querySelector('#mySzone .tile.setown .art');
        const hand = document.querySelector('#hand .hcard[data-code="' + code + '"] .himg');
        return {
          setTileArt: t ? (t.getAttribute('style') || '') : null,
          setTileVeil: !!document.querySelector('#mySzone .tile.setown .veil'),
        };
      }, book.code);
      report[H][book.slug] = styles;
      console.log('  styles:', JSON.stringify(styles));
      await page.close();
    }
    // fabricated both-books board in a fresh real session (declared)
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: H, deviceScaleFactor: 2 });
    await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
    await page.click('#startbtn');
    await page.waitForFunction(() => {
      try { return !!currentPrompt && window.__fx && window.__fx.ready && document.querySelectorAll('.slot').length >= 10; }
      catch (e) { return false; }
    }, { timeout: 60000 });
    await page.evaluate(() => {
      const st = (code, pos) => ({ code, pos, materials: 0 });
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null, null, null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[4] = mon(46148485, 0x1);
      b.players[0].szone[0] = st(38699854, 0x5);  // Taiyou face-up
      b.players[0].szone[1] = st(14087893, 0x5);  // Tsuki face-up
      b.players[0].szone[2] = st(38699854, 0xa);  // Taiyou set (veil ghost)
      b.players[0].hand = [{ code: 38699854 }, { code: 14087893 }];
      window.__fx.reset(); render(b); window.__fx.process([], b);
    });
    await sleep(600);
    await page.screenshot({ path: path.join(OUT, 'both-h' + H + '.png') });
    console.log('  captured both-h' + H + '.png');
    await page.close();
  }
  fs.writeFileSync(path.join(OUT, 'styles.json'), JSON.stringify(report, null, 1));
  await browser.close();
  server.close();
  console.log('done');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
