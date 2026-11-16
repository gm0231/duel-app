'use strict';
/* test-tilefix.js — BU-101 pins: candidate tiles keep the ONE
 * standard size whatever the VISIBLE count (parent verification
 * of BU-100, 2026-11-15: on the declare grid a search leaving
 * 1 card — 《墓守の罠》 — stretched that tile across the full
 * sheet width, and a selection-sheet search leaving 2 —
 * 《剣神官ムドラ》x2 — stretched both; the art read as a wide
 * band. The K4 rule (2026-11-12) / BU-79 decision is uniform
 * tiles at any count).
 *
 * Mechanism (measured at 390x620, probe-tile-stretch.js in
 * hidden_files/tilefix-1115/): the base .grid rule was
 * repeat(auto-fit, minmax(106px,1fr)). BU-79's rescue for the
 * genuine 1-2 candidate case was a :has() override switching
 * to auto-fill — but :has() counts DOM children, and BU-100's
 * word search hides tiles with display:none (they stay in the
 * DOM), so the override never fired under a filter and
 * auto-fit collapsed the phantom tracks around the survivors:
 * 1 visible tile = 366px wide, 2 visible = 179px, resolved
 * template "366px 0px 0px" (standard tile: 116.7 x 170).
 * A second, same-family deviation: the declare grid's
 * UNFILTERED rows measured 182px tall, not 170 — the shared
 * grid-auto-rows:1fr takes the largest content contribution,
 * and a not-yet-rendered tile contributed its
 * contain-intrinsic-size fallback (172px content-box = 182px
 * outer) instead of its true size (160px content-box = 170px
 * outer; tile scrollHeight measures 168 = content + padding).
 *
 * Fix (index.html only): the base .grid rule is auto-fill —
 * phantom tracks always hold the standard column, at any
 * visible count and however it came about; the BU-79 :has()
 * override is retired as redundant (the 3+ rendering is
 * unchanged, every track is filled either way); the
 * contain-intrinsic-size fallback is the true 160px.
 * smallfix3-1116 (BU-90) supersedes the auto-fill mechanism with
 * flex (centred rows, tile-carried standard width) — see
 * test-smallfix3.js SF3-90; TF-S1 pins the new form.
 *
 * TF-S: source pins. TF-B: real-Chromium geometry at 390x620 —
 * the standard is the many-candidate size measured in the
 * same run, and every few/filtered state must match it. */
const fs = require('fs');
const http = require('http');
const path = require('path');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');

// ---------- source pins ----------
{
  const m = html.match(/\.grid\{([^}]*)\}/);
  const decls = m ? m[1] : '';
  // smallfix3-1116 (BU-90) supersedes the auto-fill mechanism:
  // the grid is flex with centred rows and the tile carries its
  // own standard width — the same guarantee (standard column at
  // any visible count), pinned in its new form (full pins:
  // test-smallfix3 SF3-90).
  ok(/display:flex/.test(decls) && /justify-content:center/.test(decls) && !/grid-template-columns/.test(decls),
    'TF-S1: the base .grid rule is flex with centred rows (the tile cap holds the standard column at any visible count)');
  ok(!/\.grid:has\(> \.gcard/.test(html),
    'TF-S2: the BU-79 :has() override is retired (it counted DOM children and missed display:none filtering)');
  const cis = html.match(/#sheet \.gcard\{content-visibility:auto;contain-intrinsic-size:auto (\d+)px;\}/);
  ok(!!cis && cis[1] === '160',
    'TF-S3: the skipped-tile intrinsic fallback is the true content-box height 160px (was 172px -> 182px rows)');
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mpeg', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CHROME = (() => {
  const base = '/home/hatch/.cache/puppeteer/chrome';
  for (const d of fs.readdirSync(base).sort().reverse()) {
    const p = path.join(base, d, 'chrome-linux64', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('no cached chrome found');
})();

const MEASURE = () => {
  const sheet = document.getElementById('sheet');
  if (!sheet) return { domTiles: 0, visTiles: 0, rects: [] };
  const tiles = [...sheet.querySelectorAll('.gcard')];
  const vis = tiles.filter(t => t.style.display !== 'none' && t.getBoundingClientRect().width > 0);
  return {
    domTiles: tiles.length, visTiles: vis.length,
    rects: vis.slice(0, 6).map(t => { const r = t.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; }),
  };
};

(async () => {
  const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(V2, '..', p);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
    page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 160)));
    await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
    await page.click('#todeck');
    await page.waitForFunction(() => { const b = document.getElementById('startbtn'); return b && !b.disabled; }, { timeout: 30000 });
    await page.click('#startbtn');
    await sleep(2500);

    const typeQuery = async (q) => {
      await page.evaluate((qq) => {
        const inp = document.querySelector('#sheet .cardsearch-input');
        inp.value = qq;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }, q);
      await sleep(120);
    };
    // Every visible tile in the state matches the standard (w,h from the many-state) within 1px.
    let STD = null;
    const sameAsStd = (m) => m.rects.length > 0 && m.rects.every(r => Math.abs(r.w - STD.w) <= 1 && Math.abs(r.h - STD.h) <= 1);
    const fmt = (m) => m.rects.map(r => r.w + 'x' + r.h).join(',');

    // ---- declare grid: many, then filtered to 1 and 2 ----
    await page.evaluate(() => window.__announce.open({ name: 'ANNOUNCE_CARD', player: 0, context: { code: 98715423, con: 0, loc: 8, seq: 0 } }));
    await sleep(300);
    {
      const m = await page.evaluate(MEASURE);
      STD = m.rects[0];
      ok(m.domTiles >= 100 && m.visTiles === m.domTiles && !!STD && STD.h >= 169 && STD.h <= 171 && STD.w >= 110 && STD.w <= 125,
        'TF-B1: declare grid, unfiltered — the standard tile (' + (STD ? STD.w + 'x' + STD.h : 'none') + ', ' + m.domTiles + ' tiles)');
      ok(sameAsStd(m), 'TF-B1b: every measured unfiltered declare tile is the standard size (' + fmt(m) + ')');
    }
    await typeQuery('墓守'); // exactly 1 hit: 《墓守の罠》
    {
      const m = await page.evaluate(MEASURE);
      ok(m.visTiles === 1 && sameAsStd(m),
        'TF-B2: declare grid filtered to 1 visible tile — standard size, no full-width stretch (' + fmt(m) + ')');
    }
    await typeQuery('ガイウ'); // exactly 2 hits: 《邪帝ガイウス》《怨邪帝ガイウス》
    {
      const m = await page.evaluate(MEASURE);
      ok(m.visTiles === 2 && sameAsStd(m),
        'TF-B3: declare grid filtered to 2 visible tiles — standard size (' + fmt(m) + ')');
    }
    await typeQuery('');
    {
      const m = await page.evaluate(MEASURE);
      ok(m.visTiles === m.domTiles && sameAsStd(m), 'TF-B4: declare grid, filter cleared — standard size restored (' + fmt(m) + ')');
    }

    // ---- selection sheet: 3 candidates, filtered to 1 ----
    const grave = (code, seq) => ({ code, con: 0, loc: 16, seq, pos: 1 }); // LOC.GRAVE
    const MUDORA = 99937011, KELDO = 63542003, SORCERY = 83764718, TRAP = 98715423;
    await page.evaluate((cards) => window.__select.open({ name: 'SELECT_CARD', player: 0, cancelable: true, min: 1, max: 2, context: null, cards }),
      [grave(MUDORA, 0), grave(KELDO, 1), grave(SORCERY, 2)]);
    await sleep(300);
    {
      const m = await page.evaluate(MEASURE);
      ok(m.visTiles === 3 && sameAsStd(m), 'TF-B5: selection sheet, 3 candidates — standard size (' + fmt(m) + ')');
    }
    await page.click('#grid-search-toggle');
    await sleep(120);
    await typeQuery('ムドラ');
    {
      const m = await page.evaluate(MEASURE);
      ok(m.visTiles === 1 && sameAsStd(m),
        'TF-B6: selection sheet filtered to 1 visible tile — standard size, no full-width stretch (' + fmt(m) + ')');
    }

    // ---- genuine few-candidate sheets (no search): BU-79's cases ----
    await page.evaluate((cards) => window.__select.open({ name: 'SELECT_CARD', player: 0, cancelable: true, min: 1, max: 2, context: null, cards }),
      [grave(MUDORA, 0), grave(MUDORA, 1)]);
    await sleep(300);
    {
      const m = await page.evaluate(MEASURE);
      ok(m.domTiles === 2 && m.visTiles === 2 && sameAsStd(m),
        'TF-B7: genuine 2-candidate sheet (《剣神官ムドラ》x2) — standard size (' + fmt(m) + ')');
    }
    await page.evaluate((cards) => window.__select.open({ name: 'SELECT_CARD', player: 0, cancelable: true, min: 1, max: 1, context: null, cards }),
      [grave(TRAP, 0)]);
    await sleep(300);
    {
      const m = await page.evaluate(MEASURE);
      ok(m.domTiles === 1 && m.visTiles === 1 && sameAsStd(m),
        'TF-B8: genuine 1-candidate sheet — standard size (' + fmt(m) + ')');
    }

    // ---- unselect sheet: 2 candidates ----
    await page.evaluate((sel) => window.__unselect.open({ name: 'SELECT_UNSELECT_CARD', player: 0, finishable: true, cancelable: true, min: 1, max: 1, context: null, select: sel, unselect: [] }),
      [grave(MUDORA, 0), grave(KELDO, 1)]);
    await sleep(300);
    {
      const m = await page.evaluate(MEASURE);
      ok(m.domTiles === 2 && m.visTiles === 2 && sameAsStd(m),
        'TF-B9: unselect sheet, 2 candidates — standard size (' + fmt(m) + ')');
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures === 0 ? 'ALL TILE-FIX CHECKS PASSED' : failures + ' TILE-FIX CHECK(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
