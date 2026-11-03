'use strict';
/* cap-horus.js — visual capture for the per-card illustration of
   《メタファイズ・ホルス・ドラゴン》 (36898537 — user art
   2026-11-04, 17th delivery): plain CARD_ART entry 'horus', the
   first EXTRA-deck monster with individual art. Horus lives in
   the EX deck, so its home surfaces are the EX pile sheet and
   the card-info / resident-preview pair it feeds: one real-play
   flow per height — start a real duel as the Ishizu deck, open
   the own EXデッキ sheet from the pile chip, tap the Horus row
   (card info sets the resident preview to the big painting),
   close back out and shoot the preview strip. The post-summon
   board tile is pinned by test-cardart's fabricated board
   (CA11ad), exactly as the deck-scoped deliveries pinned their
   non-Ishizu surfaces by fixture.
   Usage: node cap-horus.js <outDir> [heights=620,700]          */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = __dirname;
const OUT = process.argv[2] || path.join(ROOT, 'shots-horus');
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

const HORUS = 36898537;
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
    await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
    await page.click('#startbtn');
    await page.waitForFunction(() => {
      try { return !!currentPrompt && window.__fx && window.__fx.ready && document.querySelectorAll('.slot').length >= 10; }
      catch (e) { return false; }
    }, { timeout: 60000 });
    await sleep(600);
    const shoot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '-h' + H + '.png') }); console.log('  captured', name + '-h' + H + '.png'); };

    // 1) own EX pile sheet — Horus must be listed (x2 in the EX deck)
    await page.click('[data-pile="extra:0"]');
    await sleep(700);
    const exInfo = await page.evaluate(c => {
      const rows = [...document.querySelectorAll('#sheet .sortrow')].map(r => r.dataset.info);
      const ttl = (document.querySelector('#sheet .ttl') || {}).textContent || '';
      return { ttl, horusRows: rows.filter(x => x === String(c)).length, rowCount: rows.length };
    }, HORUS);
    console.log('h=' + H + ' EX sheet:', JSON.stringify(exInfo));
    await shoot('extra-horus');

    // 2) tap the Horus row -> card info (sets the resident preview)
    await page.click('#sheet .sortrow[data-info="' + HORUS + '"]');
    await sleep(700);
    const infoTtl = await page.evaluate(() => (document.querySelector('#sheet .ttl') || {}).textContent || '');
    console.log('h=' + H + ' info sheet title:', infoTtl);
    await shoot('info-horus');

    // 3) close the info sheet (and the pile sheet if it resurfaces)
    //    so the resident preview strip stands alone with Horus
    for (let i = 0; i < 3; i++) {
      const closed = await page.evaluate(() => {
        const b = document.getElementById('sheet-cancel');
        const sheet = document.getElementById('sheet');
        if (b && sheet && sheet.offsetParent !== null) { b.click(); return true; }
        return false;
      });
      if (!closed) break;
      await sleep(500);
    }
    await sleep(400);
    await shoot('preview-horus');
    report[H] = await page.evaluate(() => {
      const a = document.querySelector('#preview .pv-art');
      const nm = document.querySelector('#preview .pv-name');
      return { pvStyle: a ? (a.getAttribute('style') || '').slice(0, 90) : null, pvName: nm ? nm.textContent : null };
    });
    report[H].exSheet = exInfo;
    report[H].infoTitle = infoTtl;
    console.log('  horus styles:', JSON.stringify(report[H]));
    await page.close();
  }
  fs.writeFileSync(path.join(OUT, 'styles.json'), JSON.stringify(report, null, 1));
  await browser.close();
  server.close();
  console.log('done');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
