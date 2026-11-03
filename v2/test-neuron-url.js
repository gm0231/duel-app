'use strict';
/* test-neuron-url.js — REAL-network end-to-end for the URL import
   (user spec 2026-11-04: pasting the link must be enough).
   Unlike test-neuron.js (jsdom, stubbed fetch), this drives the
   actual app in Chromium against the live internet:
   - Case A: the user's real Neuron share link
     (https://neuron.konami.net/link/qae5uv7gmv1b9qrt, the Mai
     deck "Alluring Heroines") must come back through the app's
     own relay chain and land on the measured-correct verdict:
     composition 44/15/3, 51pt, and — under the bundled GENESYS
     list 202610 — "cannot be used" for the release cutoff,
     naming the two ORIGINAL ARTWORK COLLECTION cards (OCG
     release 2026-09-26, after the list's 2026-03-01 cutoff).
   - Case B: the real deck code 2t9x91u (MILLENNIUM PROPHECY)
     must drive search -> member_deck -> verdict -> AUTO-SAVE.
   The public relays are flaky (measured from this network:
   allorigins answers roughly one attempt in three), so each
   case retries the whole in-app flow up to 3 times and reports
   the attempt count; a pass on any attempt is a real pass (the
   flow itself is never stubbed or shortened).
   Needs: puppeteer-core + chromium (duel-review rig), and a
   working egress for the browser (this VM: the local chained
   relay on 127.0.0.1:18081). Run manually:
     node test-neuron-url.js [port] */
const fs = require('fs');
const http = require('http');
const path = require('path');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer-core');
const CHROME = (() => {
  const base = '/home/hatch/.cache/puppeteer/chrome';
  for (const d of fs.readdirSync(base).sort().reverse()) {
    const p = path.join(base, d, 'chrome-linux64', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('no cached chrome found');
})();
const V2 = __dirname;
const PORT = +(process.argv[2] || 8902);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(V2, p);
      if (!file.startsWith(V2) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(rsp);
    });
    srv.listen(PORT, '127.0.0.1', () => res(srv));
  });
}

async function openPanel(page) {
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loadmsg') && document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
  await page.click('#todeck');
  await page.click('#deckimport');
  await sleep(400);
}

async function runFlow(page, input, marker, tries) {
  for (let t = 1; t <= tries; t++) {
    await page.$eval('#neurontext', (el, v) => { el.value = v; }, input);
    await page.$eval('#neuronresult', el => { el.innerHTML = ''; });
    await page.click('#neuronparse');
    try {
      await page.waitForFunction(m => document.getElementById('neuronresult').textContent.includes(m), { timeout: 180000 }, marker);
      console.log('  flow succeeded on attempt', t);
      return true;
    } catch (e) {
      const txt = await page.$eval('#neuronresult', el => el.textContent.slice(0, 120));
      console.log('  attempt', t, 'did not reach the marker; result so far:', JSON.stringify(txt));
    }
  }
  return false;
}

(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--proxy-server=http://127.0.0.1:18081', '--ignore-certificate-errors', '--window-size=390,844'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 700 });
  page.on('pageerror', e => console.log('  pageerror:', String(e).slice(0, 200)));

  // ---- Case A: the real share link
  await openPanel(page);
  const aOk = await runFlow(page, 'https://neuron.konami.net/link/qae5uv7gmv1b9qrt', 'Alluring Heroines', 3);
  ok(aOk, 'A1: the real share link imports end-to-end in a real browser');
  if (aOk) {
    const txt = await page.$eval('#neuronresult', el => el.textContent);
    ok(txt.includes('メイン（44枚）') && txt.includes('エクストラ（15枚）') && txt.includes('サイド（3枚）'), 'A2: composition 44/15/3');
    ok(txt.includes('ポイント合計：51pt'), 'A3: point total 51pt');
    ok(txt.includes('このデッキは使えません') && txt.includes('ハーピィ・レディ－華麗なる分身－') && txt.includes('香水戦術'),
      'A4: list-202610 cutoff verdict names both 2026-09-26 cards');
    await page.screenshot({ path: path.join(V2, 'shot-neuron-url-share.png') });
    console.log('  shot: shot-neuron-url-share.png');
  }

  // ---- Case B: the real deck code -> auto-save
  await page.evaluate(() => localStorage.clear());
  await openPanel(page);
  const bOk = await runFlow(page, '2t9x91u', '自動で保存しました', 3);
  ok(bOk, 'B1: the real deck code imports and auto-saves end-to-end');
  if (bOk) {
    const txt = await page.$eval('#neuronresult', el => el.textContent);
    ok(txt.includes('MILLENNIUM PROPHECY') && txt.includes('Genesis適合 ― そのまま対戦できます'), 'B2: verdict is playable Genesis-legal');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('v2saveddecks') || '[]'));
    ok(saved.length === 1 && saved[0].name === 'MILLENNIUM PROPHECY' && saved[0].poolOk === true, 'B3: the deck is persisted');
    await page.screenshot({ path: path.join(V2, 'shot-neuron-url-code.png') });
    console.log('  shot: shot-neuron-url-code.png');
  }

  await browser.close();
  srv.close();
  console.log(failures === 0 ? 'ALL URL E2E CHECKS PASSED' : failures + ' URL E2E CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
