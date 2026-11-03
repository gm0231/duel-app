'use strict';
/* cap-neuron.js — visual capture for Neuron import Phase 1.
   Drives the real UI in a real browser: title -> deck page ->
   import panel, pastes the verbatim official deck-page fixture
   (test-neuron-fixture.html) and a points-illegal code list, and
   shoots the verdict states + the deck page with the saved deck.
   Usage: node cap-neuron.js <outDir> [heights=620,700]          */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'shots-neuron');
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const fixture = fs.readFileSync(path.join(__dirname, 'test-neuron-fixture.html'), 'utf8');
  const gd = JSON.parse(fs.readFileSync(path.join(__dirname, 'genesys-data.json'), 'utf8'));
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  // points-illegal example: Kelbek x3 (150pt) + clean fillers to 42
  const lp = new Set(gd.lp), late = new Set(gd.late), ng = new Set(gd.ng), pool = new Set(Object.keys(data.cards).map(Number));
  const fillers = [];
  for (const k of Object.keys(gd.names).map(Number)) {
    if (gd.points[k] || lp.has(k) || late.has(k) || ng.has(k) || pool.has(k)) continue;
    fillers.push(k); if (fillers.length >= 13) break;
  }
  const illegalText = '#main\n' + [25926710, 25926710, 25926710, ...fillers.flatMap(r => [r, r, r])].join('\n');

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  for (const H of HEIGHTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: H, deviceScaleFactor: 2 });
    page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)));
    await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
    await page.click('#todeck');
    await sleep(300);
    // --- import OK flow ---
    await page.click('#deckimport');
    await sleep(300);
    await page.evaluate((t) => { document.getElementById('neurontext').value = t; }, fixture);
    await page.click('#neuronparse');
    await page.waitForFunction(() => document.getElementById('neuronresult').textContent.includes('Genesis'), { timeout: 30000 });
    await page.evaluate(() => { const r = document.getElementById('neuronresult'); r.scrollTop = r.scrollHeight; });
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, 'import-ok-h' + H + '.png') });
    // --- save -> deck page ---
    await page.click('#neuronsave');
    await sleep(900);
    await page.screenshot({ path: path.join(OUT, 'deckpage-saved-h' + H + '.png') });
    // --- import NG flow ---
    await page.click('#deckimport');
    await sleep(300);
    await page.evaluate((t) => { document.getElementById('neurontext').value = t; document.getElementById('neuronresult').innerHTML = ''; }, illegalText);
    await page.click('#neuronparse');
    await page.waitForFunction(() => document.getElementById('neuronresult').textContent.includes('このデッキは使えません'), { timeout: 30000 });
    await page.evaluate(() => { const r = document.getElementById('neuronresult'); r.scrollTop = r.scrollHeight; });
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, 'import-ng-h' + H + '.png') });
    await page.close();
    console.log('height', H, 'done');
  }
  await browser.close();
  server.close();
  console.log('CAP DONE ->', OUT);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
