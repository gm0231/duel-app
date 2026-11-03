'use strict';
/* probe-revive.js — production-path verification of the
   死者蘇生 rider latch in the live page. A monster is summoned
   by normal play; then the engine's REAL event shapes
   ({kind:'activate', code:28958464, con, loc} at CHAINING and
   {kind:'spsummon', code, con} at SPSUMMON — engine.js:738/716)
   are pushed into the real GameState event queue in two
   separate drains (the production batching: activation and
   summon never share a batch), through the real
   drainSeEvents -> noteReviveFromEvents path. Tapping the
   monster must show the revive reason on its sheet.
   390x620.                                                  */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const REAL = __dirname;
const OUT = path.join(__dirname, 'spotshots');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.m4a': 'audio/m4a', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(REAL, p);
  if (!file.startsWith(REAL) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const DRIVER = `
window.__drv = { mem: null, ready: false, code: 0, seq: -1 };
window.__drvStep = function () {
  const E = window.Engine;
  if (!window.__drv.mem) window.__drv.mem = E.makeBotMemory();
  if (typeof currentPrompt === 'undefined' || !currentPrompt) return 'noprompt';
  const prompt = currentPrompt.prompt, state = duel.state, P = state.players[HP];
  if (prompt.name === 'SELECT_IDLECMD') {
    // a monster with NO activation currently offered: its sheet
    // is where the greyed reason row must appear
    const offered = new Set((prompt.activate || []).filter(a => a.loc === E.LOC.MZONE).map(a => a.seq));
    const cand = P.mzone.map((c, i) => c && (c.pos & E.POS_FACEUP) && !offered.has(i) ? { c, i } : null).filter(Boolean)[0];
    if (cand) { window.__drv.ready = true; window.__drv.code = cand.c.code; window.__drv.seq = cand.i; return 'ready'; }
    const si = (prompt.summon || []).findIndex(a => { const cd = DATA.cards[a.code]; return cd && cd.level === 4; });
    if (si >= 0) { finishPrompt(E.cmdResp(0, si)); return 'ns'; }
    if (prompt.toEP) { finishPrompt(E.cmdResp(7, 0)); return 'toEP'; }
  }
  finishPrompt(E.botAnswer(prompt, state, DATA, window.__drv.mem));
  return 'bot:' + prompt.name;
};
'installed'`;

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 620 });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  let verdict = null;
  for (let attempt = 1; attempt <= 4 && !verdict; attempt++) {
    await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('loadmsg') && document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
    await page.evaluate(DRIVER);
    await page.click('#startbtn');
    const t0 = Date.now();
    let ready = null;
    while (Date.now() - t0 < 90000 && !ready) {
      const r = await page.evaluate('window.__drvStep()').catch(() => 'evalerr');
      if (r === 'ready') { ready = await page.evaluate('({ code: window.__drv.code, seq: window.__drv.seq })'); break; }
      await new Promise(r2 => setTimeout(r2, 300));
    }
    if (!ready) { console.log('attempt ' + attempt + ': no field monster without an offer'); continue; }
    console.log('attempt ' + attempt + ': monster ' + ready.code + ' at seq ' + ready.seq);
    // production path: two separate drains, real event shapes
    await page.evaluate((code) => {
      duel.state.events.push({ kind: 'activate', code: 28958464, con: HP, loc: 2 });
      drainSeEvents(duel.state);
      duel.state.events.push({ kind: 'spsummon', code, con: HP });
      drainSeEvents(duel.state);
    }, ready.code);
    await page.evaluate((seq) => { const el = document.querySelector('[data-act="' + HP + ':4:' + seq + '"]'); if (el) el.click(); }, ready.seq);
    await new Promise(r => setTimeout(r, 800));
    let sheetText = await page.evaluate('document.getElementById("sheet").innerText');
    if (!sheetText.trim()) {
      await page.evaluate((seq) => { const el = document.querySelector('[data-act="' + HP + ':4:' + seq + '"]'); if (el) el.click(); }, ready.seq);
      await new Promise(r => setTimeout(r, 800));
      sheetText = await page.evaluate('document.getElementById("sheet").innerText');
    }
    await page.screenshot({ path: path.join(OUT, 'probe-revive.png') });
    console.log('sheet: ' + sheetText.replace(/\n+/g, ' | ').slice(0, 500));
    verdict = sheetText.includes('《マジックカード「死者蘇生」》の効果で特殊召喚されたため、このターンは効果を発動できません') ? 'PASS' : 'FAIL';
  }
  console.log('VERDICT[revive]: ' + (verdict || 'NOT-REPRODUCED'));
  await browser.close();
  server.close();
  process.exit(verdict === 'PASS' ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
