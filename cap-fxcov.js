'use strict';
/* cap-fxcov.js — visual capture for the FX coverage round: the
   summon callout. A real duel is parked at its first prompt, then
   fabricated states are drawn with the production render() and
   fired through window.__fx.process in production order (the
   redesigncap method), so the frames show the production scene —
   geometry, rim, timing — over a real board.
   Scenes: own normal summon (gold rim), opponent normal summon
   (lapis rim), own generic special summon (portal + callout),
   flip summon (flip beat + callout).
   Usage: node cap-fxcov.js <outDir> [heights=620,700]          */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = __dirname;
const OUT = process.argv[2] || path.join(ROOT, 'shots-fxcov');
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

const SETUP = `
window.__cap = (() => {
  const E = window.Engine;
  const mon = (code, pos, mats) => { const d = DATA.cards[code]; return { code, pos: pos == null ? 1 : pos, materials: mats || 0, curAtk: d.atk, curDef: d.def }; };
  const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
  const base = () => ({ players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null });
  const ZORGA = 31525442, KELBEK = 25926710, AGIDO = 16135253;
  const D = {};
  D['callout-summon-me'] = (()=>{ const b=base(); b.players[0].hand=[{code:ZORGA}]; b.players[1].mzone[0]=mon(KELBEK); const t=base(); t.players[1].mzone[0]=mon(KELBEK); t.players[0].mzone[2]=mon(ZORGA); return {b,t,evs:[{kind:'summon',code:ZORGA,con:0}]}; })();
  D['callout-summon-opp'] = (()=>{ const b=base(); b.players[0].mzone[0]=mon(ZORGA); const t=base(); t.players[0].mzone[0]=mon(ZORGA); t.players[1].mzone[2]=mon(KELBEK); return {b,t,evs:[{kind:'summon',code:KELBEK,con:1}]}; })();
  D['callout-spsummon'] = (()=>{ const b=base(); b.players[0].hand=[{code:AGIDO}]; b.players[1].mzone[0]=mon(KELBEK); const t=base(); t.players[1].mzone[0]=mon(KELBEK); t.players[0].mzone[1]=mon(AGIDO); return {b,t,evs:[{kind:'spsummon',code:AGIDO,con:0}]}; })();
  D['callout-flipsummon'] = (()=>{ const b=base(); b.players[0].mzone[0]=mon(ZORGA,8); const t=base(); t.players[0].mzone[0]=mon(ZORGA,1); return {b,t,evs:[{kind:'flipsummon',code:ZORGA,con:0}]}; })();
  return {
    baseline(name){ const d=D[name]; window.__fx.reset(); render(d.b); window.__fx.process([], d.b); return window.__fx.log.slice(); },
    trigger(name){ const d=D[name]; render(d.t); const before=window.__fx.log.length; window.__fx.process(d.evs, d.t); return { newLog: window.__fx.log.slice(before), scenes: window.__fx.scenes() }; },
  };
})();`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
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
    await page.waitForFunction(() => { try { return !!currentPrompt && window.__fx && window.__fx.ready && document.querySelectorAll('.slot').length >= 10; } catch (e) { return false; } }, { timeout: 60000 });
    await sleep(600);
    await page.evaluate(SETUP);
    for (const name of ['callout-summon-me', 'callout-summon-opp', 'callout-spsummon', 'callout-flipsummon']) {
      const blog = await page.evaluate((n) => window.__cap.baseline(n), name);
      await sleep(120);
      await page.screenshot({ path: path.join(OUT, name + '-h' + H + '-f00-baseline.png') });
      const trig = await page.evaluate((n) => window.__cap.trigger(n), name);
      report[name + '@' + H] = { baselineLog: blog, trigger: trig };
      // frame by FX-scene-local time, not wall sleeps: screenshot
      // overhead in this environment runs to several hundred ms,
      // which overshoots a 900 ms scene if slept naively.
      const waitLocal = async (ms) => {
        await page.waitForFunction((want) => {
          const sc = window.__fx.scenes().find(s => s.kind === 'summoncall');
          return sc && (window.__fx.now() - sc.t0) >= want;
        }, { timeout: 15000 }, ms);
        return page.evaluate(() => { const sc = window.__fx.scenes().find(s => s.kind === 'summoncall'); return sc ? Math.round(window.__fx.now() - sc.t0) : -1; });
      };
      const l1 = await waitLocal(110);
      await page.screenshot({ path: path.join(OUT, name + '-h' + H + '-f01-stamp.png') });
      const l2 = await waitLocal(400);
      await page.screenshot({ path: path.join(OUT, name + '-h' + H + '-f02-hold.png') });
      report[name + '@' + H].frameLocalMs = { f01: l1, f02: l2 };
      console.log('  captured', name, 'h' + H, JSON.stringify(trig.newLog));
      await sleep(900); // let the callout finish before the next scene
    }
    await page.close();
  }
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(OUT, 'styles.json'), JSON.stringify(report, null, 1));
  console.log('done');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
