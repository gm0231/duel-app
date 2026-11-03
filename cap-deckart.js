'use strict';
/* cap-deckart.js — visual capture for DECK-SCOPED illustrations
   (user decision 2026-11-03). The human plays the Ishizu deck
   (the boot default), so the two overridden cards must show
   their Egyptian art on every surface:
     36745317 Mori 《森と目覚の春化精》 -> card-art-mori-ishizu
     62133026 Hana 《花と野原の春化精》 -> card-art-hana-ishizu
   One real-play flow per card per height: draw her, tap her
   (resident preview), normal-summon her face-up through the
   real action sheet (board tile = small art).
   Usage: node cap-deckart.js <outDir> [heights=620,700]       */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = __dirname;
const OUT = process.argv[2] || path.join(ROOT, 'shots-deckart');
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

const SISTERS = [
  { slug: 'mori', code: 36745317 },
  { slug: 'hana', code: 62133026 },
];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function drawCard(browser, port, H, code) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: H, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)));
  let got = false, tries = 0;
  for (; tries < 120 && !got; tries++) {
    await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
    await page.click('#startbtn');
    await page.waitForFunction(() => {
      try { return !!currentPrompt && window.__fx && window.__fx.ready && document.querySelectorAll('.slot').length >= 10; }
      catch (e) { return false; }
    }, { timeout: 60000 });
    await sleep(600);
    got = await page.evaluate(c => [...document.querySelectorAll('#hand .hcard')].some(h => h.dataset.code === String(c)), code);
    if (!got && tries % 10 === 9) console.log('  h=' + H + ' code ' + code + ': ' + (tries + 1) + ' tries so far');
  }
  console.log('h=' + H + ' code ' + code + ': in opening hand after ' + tries + ' tr' + (tries === 1 ? 'y' : 'ies'));
  return got ? page : (await page.close(), null);
}

async function drain(page) {
  for (let i = 0; i < 8; i++) {
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.offsetParent !== null && (x.textContent.trim() === '発動しない' || x.textContent.trim() === 'パス'));
      if (b) { b.click(); return b.textContent.trim(); } return null;
    });
    if (!clicked) return;
    await sleep(600);
  }
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const report = {};
  for (const H of HEIGHTS) {
    report[H] = {};
    for (const { slug, code } of SISTERS) {
      const page = await drawCard(browser, port, H, code);
      if (!page) { report[H][slug] = 'FAILED: never drew'; continue; }
      const shoot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '-h' + H + '.png') }); console.log('  captured', name + '-h' + H + '.png'); };
      await shoot('hand-' + slug);
      await page.click('#hand .hcard[data-code="' + code + '"]');
      await sleep(500);
      await shoot('preview-' + slug);
      const pvStyle = await page.evaluate(() => {
        const a = document.querySelector('#preview .pv-art');
        return a ? (a.getAttribute('style') || '') : null;
      });
      const summoned = await page.evaluate(() => {
        const b = [...document.querySelectorAll('#sheet button, #dock button, .sheetbtn, button')].find(x => x.textContent.trim() === '通常召喚' && x.offsetParent !== null);
        if (b) { b.click(); return true; } return false;
      });
      console.log('  ' + slug + ' summon button clicked:', summoned);
      await sleep(700);
      const placed = await page.evaluate(() => {
        const s = document.querySelector('#myMzone .slot.hl') || document.querySelector('#myMzone .slot');
        if (s) { s.click(); return s.getAttribute('data-zone'); } return null;
      });
      console.log('  ' + slug + ' placed at zone:', placed);
      await sleep(700);
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => /攻撃表示/.test(x.textContent) && x.offsetParent !== null);
        if (b) b.click();
      });
      await sleep(900);
      await drain(page);
      await sleep(400);
      await shoot('field-' + slug);
      report[H][slug] = await page.evaluate(() => {
        const arts = [...document.querySelectorAll('#myMzone .tile .art')].map(a => (a.getAttribute('style') || '').slice(0, 90));
        return { fieldArts: arts };
      });
      report[H][slug].pvStyle = (pvStyle || '').slice(0, 90);
      console.log('  ' + slug + ' styles:', JSON.stringify(report[H][slug]));
      await page.close();
    }
  }
  fs.writeFileSync(path.join(OUT, 'styles.json'), JSON.stringify(report, null, 1));
  await browser.close();
  server.close();
  console.log('done');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
