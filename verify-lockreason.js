'use strict';
/* verify-minerva3.js — real-browser end-to-end check of the fix.
   Serves the worktree, plays the actual page (390x700) with an
   in-page driver that mirrors repro-minerva3b's Vernusylph line:
   fire a Vernusylph hand effect, Xyz-summon Minerva, then TAP her
   tile and read the action sheet. PASS = the greyed 発動 row states
   the attribute-lock reason. Retries fresh duels (random shuffle)
   until the line materialises or attempts run out.               */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'shots-lockreason');
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

const DRIVER_SRC = `
window.__drv = { vernu: false, mem: null, log: [] };
window.__drvStep = function () {
  const E = window.Engine;
  if (!window.__drv.mem) window.__drv.mem = E.makeBotMemory();
  const log = (s) => { if (window.__drv.log.length < 120) window.__drv.log.push(s); };
  if (typeof currentPrompt === 'undefined' || !currentPrompt) return 'noprompt';
  const prompt = currentPrompt.prompt, state = duel.state, P = state.players[HP];
  const MINERVA = 30100551;
  const minerva = P.mzone.find(c => c && c.code === MINERVA);
  if (prompt.name === 'SELECT_IDLECMD') {
    if (minerva) {
      const ai = prompt.activate.findIndex(a => a.code === MINERVA && a.loc === E.LOC.MZONE);
      if (window.__drv.vernu && ai < 0) {
        const seq = P.mzone.indexOf(minerva);
        const el = document.querySelector('[data-act="' + HP + ':4:' + seq + '"]');
        if (el) { el.click(); log('TILE_TAP seq=' + seq); return 'sheet'; }
        return 'notile';
      }
      if (ai >= 0) { log('ACTIVATE_MINERVA'); finishPrompt(E.cmdResp(5, ai)); return 'activated'; }
    }
    if (!window.__drv.vernu) {
      const vi = prompt.activate.findIndex(a => (a.code === 36745317 || a.code === 62133026) && a.loc === E.LOC.HAND);
      if (vi >= 0) { window.__drv.vernu = true; log('VERNU ' + prompt.activate[vi].code); finishPrompt(E.cmdResp(5, vi)); return 'vernu'; }
    }
    const xs = prompt.spsummon.findIndex(a => a.code === MINERVA);
    if (xs >= 0) { log('XYZ'); finishPrompt(E.cmdResp(1, xs)); return 'xyz'; }
    const fieldLv4 = P.mzone.filter(c => c && (c.pos & E.POS_FACEUP) && DATA.cards[c.code] && DATA.cards[c.code].level === 4).length;
    if (fieldLv4 < 2) {
      const si = prompt.summon.findIndex(a => { const cd = DATA.cards[a.code]; return cd && cd.level === 4; });
      if (si >= 0) { log('NS ' + prompt.summon[si].code); finishPrompt(E.cmdResp(0, si)); return 'ns'; }
    }
    if (prompt.toEP) { finishPrompt(E.cmdResp(7, 0)); return 'toEP'; }
    if (prompt.toBP) { finishPrompt(E.cmdResp(6, 0)); return 'toBP'; }
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
  await page.setViewport({ width: 390, height: 700 });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  let verdict = null;
  for (let attempt = 1; attempt <= 6 && !verdict; attempt++) {
    await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('loadmsg') && document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
    await page.evaluate(DRIVER_SRC);
    await page.click('#startbtn');
    const t0 = Date.now();
    let lastAct = '';
    while (Date.now() - t0 < 150000) {
      const r = await page.evaluate('window.__drvStep()').catch(() => 'evalerr');
      if (r === 'sheet') {
        await new Promise(r2 => setTimeout(r2, 700));
        const sheetText = await page.evaluate('document.getElementById("sheet").innerText');
        await page.screenshot({ path: path.join(OUT, 'sheet-attempt' + attempt + '.png') });
        const log = await page.evaluate('window.__drv.log');
        console.log('attempt ' + attempt + ': SHEET OPENED. log=' + JSON.stringify(log));
        console.log('sheet text: ' + sheetText.replace(/\n+/g, ' | ').slice(0, 500));
        verdict = /《(森と目覚の春化精|花と野原の春化精)》の効果の制約で、このターンは地属性以外のモンスター効果を発動できません/.test(sheetText) ? 'PASS' : 'FAIL-NAME-MISSING';
        break;
      }
      if (r !== 'noprompt' && r !== lastAct) { lastAct = r; }
      await new Promise(r2 => setTimeout(r2, 350));
    }
    if (!verdict) {
      const log = await page.evaluate('window.__drv ? window.__drv.log : []').catch(() => []);
      console.log('attempt ' + attempt + ': line did not materialise. log=' + JSON.stringify(log));
    }
  }
  console.log('VERDICT: ' + (verdict || 'NOT-REPRODUCED-IN-BROWSER'));
  await browser.close();
  server.close();
  process.exit(verdict === 'PASS' ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
