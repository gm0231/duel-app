'use strict';
/* cap-chaospod.js — visual capture for per-card illustrations
   (Chaos Pod, user art 2026-11-03, 10th delivery). Two real-play
   flows per height (2 copies in the Ishizu deck):
   - summon: draw the Pod, tap it (preview), normal-summon it
     face-up through the real action sheet (board tile).
   - set: draw the Pod, set it face-down through the real sheet
     — its grinning face ghosting under the breathing setown
     veil is the surface a FLIP monster actually shows in play.
   Usage: node cap-chaospod.js <outDir> [heights=620,700]      */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = __dirname;
const OUT = process.argv[2] || path.join(ROOT, 'shots-chaospod');
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

const POD = 79106360;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function drawPod(browser, port, H) {
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
    got = await page.evaluate(code => [...document.querySelectorAll('#hand .hcard')].some(h => h.dataset.code === String(code)), POD);
    if (!got) console.log('h=' + H + ' try ' + (tries + 1) + ': no Chaos Pod in hand, restarting');
  }
  console.log('h=' + H + ': Chaos Pod in opening hand after ' + tries + ' tr' + (tries === 1 ? 'y' : 'ies'));
  return got ? page : (await page.close(), null);
}

async function drain(page) {
  for (let i = 0; i < 8; i++) {
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.offsetParent !== null && (x.textContent.trim() === '発動しない' || x.textContent.trim() === 'パス'));
      if (b) { b.click(); return b.textContent.trim(); } return null;
    });
    if (!clicked) return;
    console.log('  drained prompt via:', clicked);
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
    // ---- summon flow ----
    let page = await drawPod(browser, port, H);
    if (!page) { report[H].summon = 'FAILED: never drew'; }
    else {
      const shoot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '-h' + H + '.png') }); console.log('  captured', name + '-h' + H + '.png'); };
      await shoot('hand');
      await page.click('#hand .hcard[data-code="' + POD + '"]');
      await sleep(500);
      await shoot('preview');
      const summoned = await page.evaluate(() => {
        const b = [...document.querySelectorAll('#sheet button, #dock button, .sheetbtn, button')].find(x => x.textContent.trim() === '通常召喚' && x.offsetParent !== null);
        if (b) { b.click(); return true; } return false;
      });
      console.log('  summon button clicked:', summoned);
      await sleep(700);
      const placed = await page.evaluate(() => {
        const s = document.querySelector('#myMzone .slot.hl') || document.querySelector('#myMzone .slot');
        if (s) { s.click(); return s.getAttribute('data-zone'); } return null;
      });
      console.log('  placed at zone:', placed);
      await sleep(700);
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => /攻撃表示/.test(x.textContent) && x.offsetParent !== null);
        if (b) b.click();
      });
      await sleep(900);
      await drain(page);
      await sleep(400);
      await shoot('field');
      report[H].summon = await page.evaluate(() => {
        const t = [...document.querySelectorAll('#myMzone .tile .art')].map(a => (a.getAttribute('style') || '').slice(0, 80));
        return { fieldArts: t };
      });
      await page.close();
    }
    // ---- set flow ----
    page = await drawPod(browser, port, H);
    if (!page) { report[H].set = 'FAILED: never drew'; }
    else {
      const shoot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '-h' + H + '.png') }); console.log('  captured', name + '-h' + H + '.png'); };
      await page.click('#hand .hcard[data-code="' + POD + '"]');
      await sleep(500);
      const setClicked = await page.evaluate(() => {
        const b = [...document.querySelectorAll('#sheet button, #dock button, .sheetbtn, button')].find(x => x.textContent.trim() === 'モンスターをセット' && x.offsetParent !== null);
        if (b) { b.click(); return true; } return false;
      });
      console.log('  set button clicked:', setClicked);
      await sleep(700);
      const placed = await page.evaluate(() => {
        const s = document.querySelector('#myMzone .slot.hl') || document.querySelector('#myMzone .slot');
        if (s) { s.click(); return s.getAttribute('data-zone'); } return null;
      });
      console.log('  placed at zone:', placed);
      await sleep(700);
      await drain(page);
      await sleep(400);
      await shoot('set');
      await sleep(2300);
      await shoot('set2');
      report[H].set = await page.evaluate(() => {
        const t = document.querySelector('#myMzone .tile.setown .art');
        return { setTileArt: t ? (t.getAttribute('style') || '') : null, setTileVeil: !!document.querySelector('#myMzone .tile.setown .veil') };
      });
      console.log('  set styles:', JSON.stringify(report[H].set));
      await page.close();
    }
  }
  fs.writeFileSync(path.join(OUT, 'styles.json'), JSON.stringify(report, null, 1));
  await browser.close();
  server.close();
  console.log('done');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
