'use strict';
/* cap-layoutfix2.js — layout-fix round 2 verification rig (J1'/J2'/J4').
   Modes:
     unsel620 / unsel998 : render the two REAL SELECT_UNSELECT_CARD
       prompts captured from a live core duel (the Xyz material
       selection for Baromett: finishable=false; the second also
       cancelable=false with min already met) through the shipped
       window.__unselect seam over a live duel; assert the footer
       is never empty, guidance is present, geometry is in view.
     live620 / live844   : passive-clicker duels (chain response
       mode 'on' so the dock shows) sampling the band line and the
       dock context line: every .nb unit must stay on one rendered
       line and inside the mid band; ctx lines are classified by
       whether they name an antecedent. Ends with an inflated-font
       (16px) band measurement.
   Usage: node cap-layoutfix2.js <serveRoot> <outDir> <mode> [maxSeconds] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] || 'unsel620';
const MAXS = +(process.argv[5] || 240);
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.m4a': 'audio/m4a', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CHROME = '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome';

// The two material prompts, captured verbatim from a real core
// duel (scripted human, Baromett Xyz summon, seed 1) — see the
// layout-fix2 design record. NOT fabricated shapes.
const PROMPT_A = { name: 'SELECT_UNSELECT_CARD', player: 0, finishable: false, cancelable: true, min: 1, max: 1, selectHint: 513, retryCount: 0,
  select: [ { code: 63542003, con: 0, loc: 4, seq: 0, pos: 1 }, { code: 63542003, con: 0, loc: 4, seq: 1, pos: 1 } ], unselect: [] };
const PROMPT_B = { name: 'SELECT_UNSELECT_CARD', player: 0, finishable: false, cancelable: false, min: 1, max: 1, selectHint: 513, retryCount: 0,
  select: [ { code: 63542003, con: 0, loc: 4, seq: 1, pos: 1 } ], unselect: [ { code: 63542003, con: 0, loc: 4, seq: 0, pos: 1 } ] };

async function launch(height, resp) {
  await new Promise(r => server.listen(0, '127.0.0.1', r)).catch(() => {});
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 160)));
  await page.evaluateOnNewDocument((respMode) => {
    try { localStorage.setItem('v2fx', JSON.stringify({ cutin: true, resp: respMode })); } catch (e) {}
    // Record every dock presentation (the sampler's cadence can
    // miss short-lived docks; the observer cannot).
    window.__dockLog = [];
    document.addEventListener('DOMContentLoaded', () => {
      const dock = document.getElementById('dock');
      if (!dock) return;
      new MutationObserver(() => {
        if (dock.className === 'on') {
          const ctx = dock.querySelector('.ctx');
          window.__dockLog.push(ctx ? ctx.textContent.replace(/\s+/g, ' ') : '(no ctx)');
        }
      }).observe(dock, { attributes: true, attributeFilter: ['class'] });
    });
  }, resp || 'auto');
  await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
  return { browser, page };
}

async function startDuel(page) {
  await page.click('#todeck');
  await page.waitForFunction(() => { const b = document.getElementById('startbtn'); return b && !b.disabled; }, { timeout: 30000 });
  await page.click('#startbtn');
  await sleep(2000);
}

const UNSELGEOM = () => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1), w: +r.width.toFixed(1) }; };
  const sh = document.getElementById('sheet');
  const sub = sh.querySelector('.sub');
  return {
    vh: window.innerHeight,
    sheet: R(sh), btnrow: R(sh.querySelector('.btnrow')),
    finishBtn: !!document.getElementById('unselect-finish'),
    cancelBtn: !!document.getElementById('unselect-cancel'),
    btnnote: (sh.querySelector('.btnnote') || {}).textContent || null,
    subText: sub ? sub.textContent.replace(/\s+/g, ' ') : null,
    purpose: (sh.querySelector('.purpose') || {}).textContent || null,
    tiles: sh.querySelectorAll('[data-unselect]').length,
    btnrowInSheet: (() => { const b = sh.querySelector('.btnrow'); if (!b) return null; const br = b.getBoundingClientRect(), sr = sh.getBoundingClientRect(); return br.bottom <= sr.bottom + 0.6 && br.bottom <= window.innerHeight + 0.6; })(),
  };
};

async function unsel(height) {
  const { browser, page } = await launch(height, 'auto');
  await startDuel(page);
  const rep = { height, states: {} };
  for (const [key, prompt] of [['A_first', PROMPT_A], ['B_second', PROMPT_B]]) {
    let geom = null;
    for (let attempt = 0; attempt < 10 && !geom; attempt++) {
      await page.evaluate((p) => { window.__unselect.open(JSON.parse(JSON.stringify(p))); }, prompt);
      await sleep(450);
      const g = await page.evaluate(UNSELGEOM);
      if (g.tiles === prompt.select.length + prompt.unselect.length) geom = g;
    }
    rep.states[key] = geom;
    await page.screenshot({ path: path.join(OUT, 'unsel' + height + '-' + key + '.png') });
  }
  fs.writeFileSync(path.join(OUT, 'unsel' + height + '-report.json'), JSON.stringify(rep, null, 1));
  console.log('UNSEL' + height, JSON.stringify(rep.states));
  await browser.close();
}

const CLICKER = () => {
  const doc = document, q = (s, r) => (r || doc).querySelector(s);
  const click = (el) => { if (el) { el.click(); return true; } return false; };
  if (doc.getElementById('result').style.display === 'flex') return;
  if (doc.getElementById('dock').className === 'on') { click(q('#chain-pass')) || click(q('#dock [data-chain]')); return; }
  if (doc.getElementById('sheetwrap').classList.contains('on')) {
    const sheet = doc.getElementById('sheet');
    if (q('[data-unselect]', sheet)) {
      const fin = q('#unselect-finish', sheet);
      if (fin) return click(fin);
      const tile = q('[data-unselect]:not(.sel)', sheet) || q('[data-unselect]', sheet);
      return click(tile);
    }
    if (q('#grid-confirm', sheet) || q('.grid', sheet)) {
      const gc = q('#grid-confirm', sheet);
      const card = q('[data-grid="0"]', sheet);
      if (card && gc && gc.disabled) return click(card);
      if (gc && !gc.disabled) return click(gc);
      if (click(q('#grid-cancel', sheet))) return;
      return click(q('#sheetx'));
    }
    if (click(q('#sheet-cancel')) || click(q('.optbtn:not(.disabled)', sheet))) return;
    return;
  }
  const pb = doc.getElementById('phasebtn'); if (pb && !pb.disabled) { pb.click(); return; }
  const a = q('[data-act]'); if (a) a.click();
};

const SAMPLE = () => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1), w: +r.width.toFixed(1) }; };
  const out = {};
  const ll = document.getElementById('logline');
  const mb = document.getElementById('midbar');
  if (ll && mb) {
    const mbr = mb.getBoundingClientRect(), llr = ll.getBoundingClientRect();
    const units = [...ll.querySelectorAll('.nb')].map(sp => {
      const r = sp.getBoundingClientRect();
      return { text: sp.textContent, h: +r.height.toFixed(1), t: +r.top.toFixed(1), b: +r.bottom.toFixed(1),
        split: r.height > (parseFloat(getComputedStyle(sp).lineHeight) || 17) * 1.6,
        outside: r.top < mbr.top - 0.6 || r.bottom > mbr.bottom + 0.6 };
    });
    out.band = { text: ll.textContent.replace(/\s+/g, ' '), ll: R(ll), mb: R(mb), units,
      llOutside: llr.top < mbr.top - 0.6 || llr.bottom > mbr.bottom + 0.6 };
  }
  const dock = document.getElementById('dock');
  if (dock && dock.className === 'on') {
    const ctx = dock.querySelector('.ctx');
    if (ctx) {
      const units = [...ctx.querySelectorAll('.nb')].map(sp => {
        const r = sp.getBoundingClientRect();
        return { text: sp.textContent, h: +r.height.toFixed(1), split: r.height > (parseFloat(getComputedStyle(sp).lineHeight) || 20) * 1.6 };
      });
      out.ctx = { text: ctx.textContent.replace(/\s+/g, ' '), units };
    }
  }
  out.over = document.getElementById('result').style.display === 'flex';
  return out;
};

async function live(height) {
  const { browser, page } = await launch(height, 'on');
  await startDuel(page);
  const rep = { height, bandSamples: 0, bandViol: [], bandTexts: new Set(), ctxSamples: 0, ctxClasses: {}, ctxViol: [], shots: [], duels: 1 };
  const t0 = Date.now();
  let shotBand = false, shotDock = false;
  while ((Date.now() - t0) / 1000 < MAXS) {
    // SAMPLE BEFORE CLICKING: sampling after the clicker's pass
    // systematically landed after the dock had already closed.
    const s = await page.evaluate(SAMPLE).catch(() => null);
    if (!s) { await sleep(150); continue; }
    if (s.band && s.band.text && s.band.text !== '読み込み中…') {
      rep.bandSamples++;
      rep.bandTexts.add(s.band.text);
      for (const u of s.band.units) if (u.split || u.outside) rep.bandViol.push({ text: s.band.text, unit: u });
      if (s.band.llOutside) rep.bandViol.push({ text: s.band.text, unit: { llOutside: true } });
      if (!shotBand && s.band.text.includes('ラビリンス・ウォール・シャドウ')) {
        shotBand = true; rep.shots.push('band-labyrinth');
        await page.screenshot({ path: path.join(OUT, 'live' + height + '-band-labyrinth.png') });
        // inflated-font geometry on THIS long line, before it scrolls away
        rep.inflatedLong = await page.evaluate(() => {
          const ll = document.getElementById('logline'); const mb = document.getElementById('midbar');
          ll.style.fontSize = '16px';
          const mbr = mb.getBoundingClientRect();
          const units = [...ll.querySelectorAll('.nb')].map(sp => {
            const r = sp.getBoundingClientRect();
            return { text: sp.textContent, h: +r.height.toFixed(1), outside: r.top < mbr.top - 0.6 || r.bottom > mbr.bottom + 0.6, split: r.height > (parseFloat(getComputedStyle(sp).lineHeight) || 22) * 1.6 };
          });
          const keep = { text: ll.textContent.replace(/\s+/g, ' '), mbH: +mbr.height.toFixed(1), units };
          ll.style.fontSize = '';
          return keep;
        }).catch(() => null);
        if (rep.inflatedLong) await page.screenshot({ path: path.join(OUT, 'live' + height + '-band-labyrinth-inflated.png') });
      }
    }
    if (s.ctx) {
      rep.ctxSamples++;
      const t = s.ctx.text;
      const cls = /《[^》]+》の効果解決の後/.test(t) ? 'solved'
        : /《[^》]+》.*への応答/.test(t) ? 'named-response'
        : /開始時/.test(t) ? 'phase'
        : /効果への応答/.test(t) ? 'BARE' : 'other';
      rep.ctxClasses[cls] = (rep.ctxClasses[cls] || 0) + 1;
      for (const u of s.ctx.units) if (u.split) rep.ctxViol.push({ text: t, unit: u });
      if (!shotDock && t.includes('ラビリンス・ウォール・シャドウ')) {
        shotDock = true; rep.shots.push('dock-labyrinth');
        await page.screenshot({ path: path.join(OUT, 'live' + height + '-dock-labyrinth.png') });
      }
    }
    if (s.over) {
      if (shotBand && shotDock) break;
      if (rep.duels >= 5) break;
      // restart cleanly: full reload + fresh duel (the in-page
      // rematch path left the result overlay state ambiguous and
      // the sampler looped on it).
      rep.duels++;
      await page.reload({ waitUntil: 'load' }).catch(() => {});
      await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 }).catch(() => {});
      await startDuel(page).catch(() => {});
      await sleep(800);
      continue;
    }
    await page.evaluate(CLICKER).catch(() => {});
    await sleep(150);
  }
  rep.dockLog = await page.evaluate(() => window.__dockLog || []).catch(() => []);
  // inflated-font band measurement (minimum-font-size environments)
  const infl = await page.evaluate(() => {
    const ll = document.getElementById('logline'); const mb = document.getElementById('midbar');
    if (!ll || !mb) return null;
    ll.style.fontSize = '16px';
    const mbr = mb.getBoundingClientRect();
    const units = [...ll.querySelectorAll('.nb')].map(sp => {
      const r = sp.getBoundingClientRect();
      return { text: sp.textContent, h: +r.height.toFixed(1), outside: r.top < mbr.top - 0.6 || r.bottom > mbr.bottom + 0.6, split: r.height > (parseFloat(getComputedStyle(sp).lineHeight) || 22) * 1.6 };
    });
    return { text: ll.textContent.replace(/\s+/g, ' '), mbH: +mbr.height.toFixed(1), units };
  }).catch(() => null);
  rep.inflated = infl;
  if (infl) await page.screenshot({ path: path.join(OUT, 'live' + height + '-band-inflated.png') });
  rep.bandTexts = [...rep.bandTexts].slice(0, 60);
  fs.writeFileSync(path.join(OUT, 'live' + height + '-report.json'), JSON.stringify(rep, null, 1));
  console.log('LIVE' + height, 'bandSamples', rep.bandSamples, 'bandViol', rep.bandViol.length, 'ctxSamples', rep.ctxSamples, 'ctxClasses', JSON.stringify(rep.ctxClasses), 'ctxViol', rep.ctxViol.length, 'inflatedViol', infl ? infl.units.filter(u => u.split || u.outside).length : 'n/a', 'shots', rep.shots.join(','));
  await browser.close();
}

const DOCKGEOM = () => {
  const dock = document.getElementById('dock');
  const ctx = dock.querySelector('.ctx');
  if (!ctx) return { on: dock.className === 'on', ctx: null };
  const units = [...ctx.querySelectorAll('.nb')].map(sp => {
    const r = sp.getBoundingClientRect();
    return { text: sp.textContent, h: +r.height.toFixed(1), w: +r.width.toFixed(1),
      split: r.height > (parseFloat(getComputedStyle(sp).lineHeight) || 20) * 1.6 };
  });
  const cause = dock.querySelector('.causename');
  return { on: dock.className === 'on', text: ctx.textContent.replace(/\s+/g, ' '), units,
    cause: cause ? cause.textContent : null,
    passBtn: !!document.getElementById('chain-pass') };
};

async function dock(height) {
  const prompts = JSON.parse(fs.readFileSync('/tmp/chain-prompts.json', 'utf8'));
  const { browser, page } = await launch(height, 'on');
  await startDuel(page);
  const rep = { height, kinds: {} };
  for (const kind of ['ctx', 'solved', 'attack', 'phase']) {
    const cap = prompts[kind];
    if (!cap) { rep.kinds[kind] = 'not captured'; continue; }
    await page.evaluate((c) => { window.__chain.open(JSON.parse(JSON.stringify(c.prompt)), JSON.parse(JSON.stringify(c.state))); }, cap);
    await sleep(600);
    rep.kinds[kind] = await page.evaluate(DOCKGEOM);
    await page.screenshot({ path: path.join(OUT, 'dock' + height + '-' + kind + '.png') });
  }
  fs.writeFileSync(path.join(OUT, 'dock' + height + '-report.json'), JSON.stringify(rep, null, 1));
  console.log('DOCK' + height, JSON.stringify(rep.kinds).slice(0, 1500));
  await browser.close();
}

(async () => {
  if (MODE === 'unsel620') await unsel(620);
  else if (MODE === 'unsel998') await unsel(998);
  else if (MODE === 'live620') await live(620);
  else if (MODE === 'live844') await live(844);
  else if (MODE === 'dock620') await dock(620);
  else if (MODE === 'dock844') await dock(844);
  else { console.error('unknown mode', MODE); process.exit(1); }
  process.exit(0);
})();
