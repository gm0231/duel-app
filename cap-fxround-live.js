'use strict';
/* cap-fxround-live.js — one full real duel (player = Ishizu, CPU =
   GG, player goes second so the CPU moves first) driven by a
   test-fx-style clicker, measuring:
     - event coverage: engine state.events kinds vs __fx.log records
     - beat discipline: start gaps between major FX scenes
     - prompt gate: future-booked major scenes at prompt-open time
     - BU-22: peek bar mirrors while a prompt sheet is lowered
     - A-07: the result overlay's first frames
   Usage: node cap-fxround-live.js <repoRoot> <outDir> [maxSeconds] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');
const ROOT = path.resolve(process.argv[2]);
const OUT = process.argv[3];
const MAXS = +(process.argv[4] || 480);
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MAJORS = new Set(['chainpop', 'chainsolve', 'summoncall', 'portal', 'attack', 'setactivate', 'ace', 'keycardact', 'synchro', 'finisher', 'phase']);

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
  // install the coverage tally wrapper BEFORE the duel is created
  await page.evaluate(() => {
    window.__cov = { events: {}, batches: 0 };
    const orig = createClientDuel;
    createClientDuel = (data, opts) => orig(data, Object.assign({}, opts, {
      onUpdate: (s) => {
        try {
          (window.__pendingEvs = window.__pendingEvs || []).push(...(s.events || []));
          window.__cov.batches++;
          for (const e of (s.events || [])) { window.__cov.events[e.kind] = (window.__cov.events[e.kind] || 0) + 1; if (e.kind === 'banish' || e.kind === 'recover' || e.kind === 'pay') (window.__cov.detail = window.__cov.detail || []).push({ kind: e.kind, code: e.code, con: e.con, player: e.player, amount: e.amount }); }
        } catch (err) {}
        opts.onUpdate(s);
      },
    }));
  });
  await page.evaluate(() => {
    window.__pair = [];
    let logCur = 0;
    setInterval(() => {
      try {
        const log = window.__fx.log;
        const fresh = log.slice(logCur); logCur = log.length;
        const evs = (window.__pendingEvs || []); window.__pendingEvs = [];
        for (const e of evs) {
          if (e.kind !== 'banish') continue;
          const hit = fresh.filter(r => (r.to === 'removed' || r.kind === 'vanish') && (e.code == null || r.code === e.code));
          window.__pair.push({ code: e.code, con: e.con, presented: hit.length > 0, kinds: hit.map(h => h.kind + ':' + (h.to || h.via || '')) });
        }
      } catch (err) {}
    }, 300);
  });
  await page.click('#todeck');
  await page.waitForFunction(() => { const b = document.getElementById('startbtn'); return b && !b.disabled; }, { timeout: 30000 });
  await page.click('#seg-first [data-v="second"]');
  await page.click('#startbtn');

  const sceneSeen = new Map(); // kind|t0 -> {kind,t0,dur}
  const gateSamples = [];
  let wasOpen = false;
  let stripN = 0, lastStripAt = 0, peekDone = false, resultShots = false;
  const t0 = Date.now();
  let finished = false;

  while (Date.now() - t0 < MAXS * 1000) {
    // ---- sampling (cheap, every loop)
    const snap = await page.evaluate(() => {
      const out = { scenes: [], open: false, kind: null, turn: null, result: false, fxerr: null };
      try {
        out.scenes = window.__fx.scenes();
        out.fxerr = window.__fx.error;
        const sw = document.getElementById('sheetwrap'), dk = document.getElementById('dock');
        out.open = (sw && sw.className === 'on') || (dk && dk.className === 'on');
        out.kind = sw && sw.className === 'on' ? ('sheet:' + (sw.dataset.kind || '')) : (dk && dk.className === 'on' ? 'dock' : null);
        out.turn = (typeof duelState !== 'undefined' && duelState) ? duelState.turnPlayer : null;
        out.result = document.getElementById('result').style.display === 'flex';
        out.now = window.__fx.now();
      } catch (e) {}
      return out;
    }).catch(() => null);
    if (snap) {
      for (const s of snap.scenes) { const k = s.kind + '|' + s.t0; if (!sceneSeen.has(k)) sceneSeen.set(k, s); }
      if (snap.open && !wasOpen) {
        const futureMajors = snap.scenes.filter(s => MAJORS.has(s.kind) && s.t0 > snap.now + 40).length;
        gateSamples.push({ kind: snap.kind, futureMajors, atSec: Math.round((Date.now() - t0) / 1000) });
      }
      wasOpen = snap.open;
      if (snap.result) {
        if (!resultShots) {
          resultShots = true;
          await page.screenshot({ path: path.join(OUT, 'result-f0.png') });
          await sleep(700);
          await page.screenshot({ path: path.join(OUT, 'result-f1.png') });
        }
        finished = true;
        break;
      }
      // opponent-turn strip
      if (snap.turn === 1 && !snap.open && stripN < 26 && Date.now() - lastStripAt > 650) {
        lastStripAt = Date.now();
        await page.screenshot({ path: path.join(OUT, 'strip-opp-' + String(stripN++).padStart(2, '0') + '.png') }).catch(() => {});
      }
    }
    // ---- BU-22 peek check on the first prompt sheet
    if (!peekDone) {
      const pk = await page.evaluate(() => {
        const sw = document.getElementById('sheetwrap');
        return sw && sw.className === 'on' && sw.dataset.kind === 'prompt' ? document.getElementById('peekbtn').offsetParent !== null : false;
      }).catch(() => false);
      if (pk) {
        peekDone = true;
        await page.click('#peekbtn').catch(() => {});
        await sleep(450);
        const pb = await page.evaluate(() => { const b = document.getElementById('peekbar'); return b ? { cls: b.className, btns: b.querySelectorAll('.bigbtn,.optbtn,.posbtn').length, html: b.innerHTML.slice(0, 120) } : null; });
        fs.writeFileSync(path.join(OUT, 'peekbar.json'), JSON.stringify(pb, null, 1));
        await page.screenshot({ path: path.join(OUT, 'bu22-peek.png') });
        await page.click('#peekbtn').catch(() => {});
        await sleep(300);
      }
    }
    // ---- clicker (test-fx discipline, condensed)
    await page.evaluate(() => {
      const doc = document;
      const $ = (id) => doc.getElementById(id);
      const q = (sel, root) => (root || doc).querySelector(sel);
      const click = (el) => { if (el) el.click(); };
      if ($('result').style.display === 'flex') return;
      const sheetOn = $('sheetwrap').className === 'on';
      const dockOn = $('dock').className === 'on';
      if (sheetOn) {
        const sheet = $('sheet');
        const inc = q('[data-inc]', sheet);
        const counterOk = q('#counter-confirm', sheet);
        if (inc && counterOk && counterOk.disabled) click(inc);
        else if (counterOk && !counterOk.disabled) click(counterOk);
        else if (q('#grid-confirm', sheet) && !q('#grid-confirm', sheet).disabled) click(q('#grid-confirm', sheet));
        else if (q('[data-action-idx]', sheet)) click(q('[data-action-idx]', sheet));
        else if (q('[data-code]', sheet)) click(q('[data-code]', sheet));
        else if (q('[data-pos]', sheet)) click(q('[data-pos]', sheet));
        else if (q('.posbtn', sheet)) click(q('.posbtn', sheet));
        else if (q('#yn-yes', sheet)) click(q('#yn-yes', sheet));
        else if (q('[data-num]', sheet)) click(q('[data-num]', sheet));
        else if (q('[data-bit]', sheet)) click(q('[data-bit]', sheet));
        else if (q('[data-unselect]', sheet)) click(q('[data-unselect]', sheet));
        else if (q('#unselect-finish', sheet)) click(q('#unselect-finish', sheet));
        else if (q('#sort-ok', sheet)) click(q('#sort-ok', sheet));
        else if (q('#fb-auto', sheet)) click(q('#fb-auto', sheet));
        else if (q('[data-pile-act]', sheet)) click(q('[data-pile-act]', sheet));
        else if (q('[data-grid]:not(.sel)', sheet) || q('[data-grid]', sheet)) click(q('[data-grid]:not(.sel)', sheet) || q('[data-grid]', sheet));
        else if (q('.optbtn:not(.disabled)', sheet)) click(q('.optbtn:not(.disabled)', sheet));
        else if (q('#grid-cancel', sheet)) click(q('#grid-cancel', sheet));
        else if (q('#sheet-cancel', sheet)) click(q('#sheet-cancel', sheet));
      } else if (dockOn) {
        click(q('#chain-pass', $('dock')) || q('[data-chain]', $('dock')));
      } else if ($('placehint').className === 'on') {
        click(q('.slot.hl'));
      } else if (!$('phasebtn').disabled) {
        click($('phasebtn'));
      }
    }).catch(() => {});
    await sleep(160);
  }

  const cov = await page.evaluate(() => window.__cov).catch(() => null);
  const pair = await page.evaluate(() => window.__pair).catch(() => null);
  if (pair) fs.writeFileSync(path.join(OUT, 'banish-pairs.json'), JSON.stringify(pair, null, 1));
  const fxlog = await page.evaluate(() => window.__fx.log).catch(() => []);
  const fxerr = await page.evaluate(() => window.__fx.error).catch(() => 'n/a');
  const tally = {};
  for (const r of fxlog) {
    let k = r.kind;
    if (k === 'flight') k = 'flight:' + (r.from || '?') + '>' + (r.to || '?');
    if (k === 'summoncall') k = 'summoncall:' + (r.how || '?');
    if (k === 'place') k = 'place:' + (r.how || '?');
    tally[k] = (tally[k] || 0) + 1;
  }
  const majors = [...sceneSeen.values()].filter(s => MAJORS.has(s.kind)).sort((a, b) => a.t0 - b.t0);
  const gaps = [];
  for (let i = 1; i < majors.length; i++) gaps.push({ from: majors[i - 1].kind, to: majors[i].kind, gap: majors[i].t0 - majors[i - 1].t0 });
  const report = { finished, cov, fxTally: tally, fxError: fxerr, gateSamples, majorScenes: majors.length, gaps };
  fs.writeFileSync(path.join(OUT, 'live-report.json'), JSON.stringify(report, null, 1));
  console.log('finished:', finished, 'batches:', cov && cov.batches, 'fxError:', fxerr);
  console.log('events:', JSON.stringify(cov && cov.events));
  console.log('majors:', majors.length, 'gateSamples:', JSON.stringify(gateSamples.slice(0, 12)));
  await browser.close(); server.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
