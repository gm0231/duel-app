'use strict';
/* cap-fxround.js — capture rig for the fx-ui round (beats / flights /
   prompt gate / tap targets). Serves a given repo root, parks a real
   duel at its first prompt, then fires fabricated state pairs through
   render() + window.__fx.process in production order (the redesigncap
   method) so frames show production scenes over a real board.
   Usage: node cap-fxround.js <repoRoot> <outDir> [mode]
     mode: staged (default) | live | both                        */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = path.resolve(process.argv[2]);
const OUT = process.argv[3];
const MODE = process.argv[4] || 'both';
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
  const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
  const base = () => ({ players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 1, log: [], lastAttack: null, events: [] });
  const ZORGA = 31525442, KELBEK = 25926710, AGIDO = 16135253, KELDO = 63542003, MUDRA = 99937011, GKTRAP = 98715423;
  const D = {};
  // opponent builds a 2-link chain across TWO batches 300 ms apart
  // (the engine's botChain pace — the BU-10 worst case: the second
  // pop fires while the first is still mid-flight)
  D['opp-double-act'] = (() => { const b = base(); b.players[0].mzone[0] = mon(ZORGA); b.players[1].mzone[2] = mon(KELBEK); b.players[1].hand = [{code:KELDO},{code:MUDRA},{code:AGIDO}];
    const t1 = base(); t1.players[0].mzone[0] = mon(ZORGA); t1.players[1].mzone[2] = mon(KELBEK); t1.players[1].hand = [{code:MUDRA},{code:AGIDO}];
    t1.chain = [{ code: KELDO, con: 1 }];
    const t2 = base(); t2.players[0].mzone[0] = mon(ZORGA); t2.players[1].mzone[2] = mon(KELBEK); t2.players[1].hand = [{code:AGIDO}];
    t2.chain = [{ code: KELDO, con: 1 }, { code: MUDRA, con: 1 }]; return { b, t1, t2, evs: [] }; })();
  // opponent normal summon out of the hand
  D['opp-summon'] = (() => { const b = base(); b.players[0].mzone[0] = mon(ZORGA); b.players[1].hand = [{code:KELBEK},{code:AGIDO},{code:ZORGA}];
    const t = base(); t.players[0].mzone[0] = mon(ZORGA); t.players[1].hand = [{code:AGIDO},{code:ZORGA}]; t.players[1].mzone[2] = mon(KELBEK);
    return { b, t, evs: [{ kind: 'summon', code: KELBEK, con: 1 }] }; })();
  // own normal summon out of the hand
  D['my-summon'] = (() => { const b = base(); b.players[0].hand = [{code:ZORGA}]; b.players[1].mzone[0] = mon(KELBEK);
    const t = base(); t.players[1].mzone[0] = mon(KELBEK); t.players[0].mzone[2] = mon(ZORGA);
    return { b, t, evs: [{ kind: 'summon', code: ZORGA, con: 0 }] }; })();
  // own S/T set out of the hand
  D['my-set'] = (() => { const b = base(); b.players[0].hand = [{code:GKTRAP}]; b.players[1].mzone[0] = mon(KELBEK);
    const t = base(); t.players[1].mzone[0] = mon(KELBEK); t.players[0].szone[1] = { code: GKTRAP, pos: 8 };
    return { b, t, evs: [{ kind: 'set', code: GKTRAP, con: 0, loc: E.LOC.SZONE }] }; })();
  return {
    baseline(name) { const d = D[name]; window.__fx.reset(); render(d.b); window.__fx.process([], d.b); return window.__fx.log.slice(); },
    trigger(name) { const d = D[name]; render(d.t); const before = window.__fx.log.length; window.__fx.process(d.evs, d.t); return { newLog: window.__fx.log.slice(before), scenes: window.__fx.scenes() }; },
    triggerStep(name, which) { const d = D[name]; render(d[which]); const before = window.__fx.log.length; window.__fx.process([], d[which]); return { newLog: window.__fx.log.slice(before), scenes: window.__fx.scenes() }; },
    scenes() { return window.__fx.scenes(); },
    now() { return window.__fx.now(); },
  };
})();`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function bootDuel(page, port) {
  await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
  await page.click('#todeck');
  await page.waitForFunction(() => { const b = document.getElementById('startbtn'); return b && !b.disabled && b.textContent.includes('デュエル開始'); }, { timeout: 30000 });
  await page.click('#startbtn');
  await page.waitForFunction(() => { try { return !!currentPrompt && window.__fx && window.__fx.ready && document.querySelectorAll('.slot').length >= 10; } catch (e) { return false; } }, { timeout: 60000 });
  await sleep(700);
}

async function staged(browser, port, report) {
  const H = 620;
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: H, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)));
  await bootDuel(page, port);
  await page.evaluate(SETUP);
  const waitSceneLocal = async (kind, idx, want) => {
    try {
      await page.waitForFunction((k, i, w) => {
        const ss = window.__fx.scenes().filter(s => s.kind === k);
        return ss.length > i && (window.__fx.now() - ss[i].t0) >= w;
      }, { timeout: 12000 }, kind, idx, want);
    } catch (e) { /* scene may already be gone; capture anyway */ }
    return page.evaluate((k, i) => { const ss = window.__fx.scenes().filter(s => s.kind === k); return ss.length > i ? Math.round(window.__fx.now() - ss[i].t0) : -1; }, kind, idx);
  };
  // ---- scene 1: opponent double activation, two batches 300 ms apart
  {
    const name = 'opp-double-act';
    await page.evaluate((n) => window.__cap.baseline(n), name);
    await sleep(150);
    const trig1 = await page.evaluate((n) => window.__cap.triggerStep(n, 't1'), name);
    report[name] = { trigger1: trig1 };
    let l = await waitSceneLocal('chainpop', 0, 250);
    await page.screenshot({ path: path.join(OUT, name + '-f1-pop1-250.png') });
    report[name].pop1at250 = l;
    await sleep(50); // second batch lands ~300 ms after the first (botChain pace)
    const trig2 = await page.evaluate((n) => window.__cap.triggerStep(n, 't2'), name);
    report[name].trigger2 = trig2;
    report[name].scenesAtStep2 = await page.evaluate(() => window.__cap.scenes());
    l = await waitSceneLocal('chainpop', 1, 250);
    await page.screenshot({ path: path.join(OUT, name + '-f2-pop2-250.png') });
    report[name].pop2at250 = l;
    l = await waitSceneLocal('chainpop', 1, 720);
    await page.screenshot({ path: path.join(OUT, name + '-f3-pop2-720.png') });
    report[name].scenesAfter = await page.evaluate(() => window.__cap.scenes());
    console.log(' ', name, 'step1:', JSON.stringify(trig1.newLog), 'step2:', JSON.stringify(trig2.newLog), 'scenes@step2:', JSON.stringify(report[name].scenesAtStep2));
    await sleep(1200);
  }
  // ---- scene 2: opponent summon (flight + callout)
  {
    const name = 'opp-summon';
    await page.evaluate((n) => window.__cap.baseline(n), name);
    await sleep(150);
    const trig = await page.evaluate((n) => window.__cap.trigger(n), name);
    report[name] = { trigger: trig };
    await sleep(240);
    await page.screenshot({ path: path.join(OUT, name + '-f1-flight.png') });
    const l = await waitSceneLocal('summoncall', 0, 420);
    await page.screenshot({ path: path.join(OUT, name + '-f2-callout.png') });
    report[name].calloutLocal = l;
    console.log(' ', name, JSON.stringify(trig.newLog));
    await sleep(1200);
  }
  // ---- scene 3: own summon
  {
    const name = 'my-summon';
    await page.evaluate((n) => window.__cap.baseline(n), name);
    await sleep(150);
    const trig = await page.evaluate((n) => window.__cap.trigger(n), name);
    report[name] = { trigger: trig };
    await sleep(240);
    await page.screenshot({ path: path.join(OUT, name + '-f1-flight.png') });
    const l = await waitSceneLocal('summoncall', 0, 420);
    await page.screenshot({ path: path.join(OUT, name + '-f2-callout.png') });
    report[name].calloutLocal = l;
    console.log(' ', name, JSON.stringify(trig.newLog));
    await sleep(1200);
  }
  // ---- scene 4: own set
  {
    const name = 'my-set';
    await page.evaluate((n) => window.__cap.baseline(n), name);
    await sleep(150);
    const trig = await page.evaluate((n) => window.__cap.trigger(n), name);
    report[name] = { trigger: trig };
    await sleep(220);
    await page.screenshot({ path: path.join(OUT, name + '-f1-flight.png') });
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, name + '-f2-landed.png') });
    console.log(' ', name, JSON.stringify(trig.newLog));
    await sleep(800);
  }
  await page.close();
}

async function measure(browser, port, report) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)));
  await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
  const rects = (sel) => page.evaluate((s) => {
    const out = {};
    document.querySelectorAll(s).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out[s + '[' + i + ']'] = { w: Math.round(r.width), h: Math.round(r.height) };
    });
    return out;
  }, sel);
  // title screen buttons
  Object.assign(report.measure || (report.measure = {}), await rects('#todeck'));
  await page.screenshot({ path: path.join(OUT, 'ui-title.png') });
  // deck page
  await page.click('#todeck');
  await sleep(600);
  Object.assign(report.measure, await rects('#deckpage .seg button'));
  Object.assign(report.measure, await rects('#deckpage .seg3 button'));
  Object.assign(report.measure, await rects('#deckpage .deck'));
  Object.assign(report.measure, await rects('#startbtn'));
  await page.screenshot({ path: path.join(OUT, 'ui-deckpage.png') });
  await page.close();
  // in-duel controls: park at first prompt again
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
  page2.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)));
  await bootDuel(page2, port);
  const rects2 = (sel) => page2.evaluate((s) => {
    const out = {};
    document.querySelectorAll(s).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out[s + '[' + i + ']'] = { w: Math.round(r.width), h: Math.round(r.height) };
    });
    return out;
  }, sel);
  Object.assign(report.measure, await rects2('#dock .bigbtn'));
  Object.assign(report.measure, await rects2('#dock .optbtn'));
  Object.assign(report.measure, await rects2('#fxbtn'));
  Object.assign(report.measure, await rects2('#menubtn'));
  Object.assign(report.measure, await rects2('#autopass'));
  report.fxbtnClass = await page2.evaluate(() => document.getElementById('fxbtn').className);
  await page2.screenshot({ path: path.join(OUT, 'ui-duel-prompt.png') });
  // open a view sheet (history) to measure sheetx / peekbtn
  await page2.evaluate(() => { try { openLogHistory(); } catch (e) { try { sheetOpenView('<div class="ttl">計測</div>'); } catch (e2) {} } });
  await sleep(500);
  Object.assign(report.measure, await rects2('#sheetx'));
  Object.assign(report.measure, await rects2('#peekbtn'));
  await page2.screenshot({ path: path.join(OUT, 'ui-viewsheet.png') });
  await page2.click('#peekbtn').catch(() => {});
  await sleep(400);
  await page2.screenshot({ path: path.join(OUT, 'ui-viewsheet-peek.png') });
  report.peekbar = await page2.evaluate(() => { const pb = document.getElementById('peekbar'); return pb ? { cls: pb.className, btns: pb.querySelectorAll('.bigbtn,.optbtn,.posbtn').length } : null; });
  await page2.close();
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const report = { root: ROOT };
  if (MODE === 'staged' || MODE === 'both') await staged(browser, port, report);
  if (MODE === 'measure' || MODE === 'both') await measure(browser, port, report);
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log('done ->', OUT);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
