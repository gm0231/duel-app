'use strict';
/* test-layoutfix5.js — layout-fix round 5 contracts (M1).
 *
 * M1 (the 墓守の罠② discard sheet could not be used on first
 * render, real play, turn 5): the sheet opened with its tiles
 * untappable (~20 taps: image, name bar, frame, double-tap, long
 * press), the confirm button stayed disabled, the sheet did not
 * scroll, and the lower tile row + detail buttons were cut off
 * below the visible area. Pressing 選択に戻る (peek) re-rendered
 * it and the sheet then worked. Chrome could NOT reproduce the
 * dead first render in any configuration tried — seam rig with the
 * real captured prompt (4 tiles, 620/844), the close->gate race
 * both orderings (gate 100/250 ms), the 12-candidate control, the
 * live flow (real duels: a 1-tile 丘① discard and the real 3-tile
 * trap discard both work on first render) — so the cause is in
 * the real phone's conditions, not in the prompt or the handlers:
 * (i) the sheet's height budget (--appvh) was frozen at duel
 * start (one-shot layout, NO resize listener), so a visible area
 * that shrank afterwards (app chrome) left the sheet budgeted
 * taller than the screen; (ii) the candidate scroller used
 * flex:1 1 auto, which on iOS WebKit can size to its content
 * (the classic flex-scroll quirk), killing scrolling and pushing
 * the confirm row out of the sheet. Fix: (a) sheetOpen re-measures
 * the conservative visible height on every open, so the budget
 * tracks the live viewport; (b) the scroller keeps flex:1 1 auto
 * WITH min-height:0 (basis 0 was tried and rejected — it
 * collapses the scroller to 0px in this content-sized sheet;
 * min-height:0 is the actual iOS flex-scroll fix, letting the
 * scroller shrink below its content); (c) a post-open fit
 * self-check (ensureSheetFits, at the 360 ms settle point)
 * clamps a sheet that still overflows the live visible area and
 * pins a scroller that still cannot move — and lifts the sheet
 * when its bottom anchor sits below the visible area (a phone
 * WebView whose layout viewport runs taller than the visible
 * area; the lift path cannot be exercised in Chrome and is
 * confirmed by real-play re-verification). Same-structure sweep: uiUnselect (Xyz
 * materials) does NOT use gridSheet — it scrolls as a whole sheet
 * (overflow-y:auto on #sheet) — and the sheetOpen refresh covers
 * it too; asserted below. The announce sheet is the same whole-
 * sheet model. Other prompt sheets are short lists.
 *
 * The decisive check is the viewport-shrink simulation: start the
 * duel at 390x844, shrink the viewport to 390x620 WITHOUT any
 * layout re-run (there is no resize listener — that is the defect),
 * then open the REAL captured trap-discard prompt. Pristine
 * (8d6121f) budgets the sheet from the stale 844px and it
 * overflows the 620px viewport; fixed, --appvh is refreshed at
 * open and the sheet fits, scrolls, and answers a real tap.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');

// ---------- source pins ----------
{
  ok(clientSrc.includes("document.documentElement.style.setProperty('--appvh', viewportHeights().baseH + 'px')") &&
     clientSrc.includes('function sheetOpen(html, kind)') &&
     /function sheetOpen\(html, kind\) \{[\s\S]{0,1200}setProperty\('--appvh'/.test(clientSrc),
    'LF5-M1a: sheetOpen re-measures the conservative visible height (--appvh) on every open');
  ok(/#sheet \.sheet-scroll\{overflow-y:auto;min-height:0;flex:1 1 auto;\}/.test(html) &&
     !/\.sheet-scroll\{[^}]*flex:1 1 0/.test(html),
    'LF5-M1b: the candidate scroller is flex:1 1 auto with min-height:0 (basis 0 collapses it to 0px in this content-sized sheet — measured)');
  ok(clientSrc.includes('function ensureSheetFits()') &&
     clientSrc.includes('setTimeout(ensureSheetFits, 360)') &&
     clientSrc.includes("sheet.style.maxHeight = Math.max(120, vh.visibleBottom - 108) + 'px'") &&
     clientSrc.includes("sc.style.flex = 'none'") &&
     clientSrc.includes("sheet.dataset.fit = fit || 'ok'"),
    'LF5-M1c: ensureSheetFits exists, runs at the 360 ms settle point, clamps an overflowing sheet into the live visible area and pins a scroller that cannot move');
  ok(clientSrc.includes("sheet.style.maxHeight = ''") && clientSrc.includes("sheet.style.bottom = ''") && clientSrc.includes('delete sheet.dataset.fit;'),
    'LF5-M1d: a stale inline clamp / lift / fit verdict is cleared on every open and re-derived');
}

// Real captured trap-discard prompt (seed-2 scripted duel, verbatim).
const TRAP_PROMPT = {
  type: 15, name: 'SELECT_CARD', player: 0, cancelable: false, min: 1, max: 1,
  cards: [
    { code: 28958464, con: 0, loc: 2, seq: 0, pos: 10 },
    { code: 36745317, con: 0, loc: 2, seq: 1, pos: 10 },
    { code: 86605515, con: 0, loc: 2, seq: 2, pos: 10 },
    { code: 67037924, con: 0, loc: 2, seq: 3, pos: 10 },
  ],
  selectHint: 501, retryCount: 0,
  context: { code: 98715423, con: 0, loc: 8, seq: 0, player: 0, link: 1, desc: 103510623387648 },
  trigger: null,
};
// 12-candidate control prompt (same shape, real pool codes).
const CONTROL12 = {
  type: 15, name: 'SELECT_CARD', player: 0, cancelable: false, min: 1, max: 1,
  cards: [28958464, 36745317, 86605515, 67037924, 63542003, 99937011, 25926710, 31525442, 62133026, 46148485, 98715423, 17484499]
    .map((code, i) => ({ code, con: 0, loc: 2, seq: i, pos: 10 })),
  selectHint: 526, retryCount: 0, context: null, trigger: null,
};
// Fabricated Xyz-material unselect prompt (12 candidates, finishable,
// so the whole-sheet scroll is actually exercised).
const UNSELECT6 = {
  type: 15, name: 'SELECT_UNSELECT_CARD', player: 0, cancelable: false,
  finishable: true, min: 2, max: 2,
  select: [63542003, 99937011, 25926710, 62133026, 31525442, 46148485, 28958464, 36745317, 86605515, 67037924, 98715423, 17484499]
    .map((code, i) => ({ code, con: 0, loc: 4, seq: i, pos: 10 })),
  unselect: [], retryCount: 0, context: null, trigger: null,
};

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

// One consistent snapshot: first-render geometry + hit-test + scroll.
const MEASURE = () => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1), w: +r.width.toFixed(1) }; };
  const vh = window.innerHeight;
  const sheet = document.getElementById('sheet');
  const wrap = document.getElementById('sheetwrap');
  const sc = sheet ? sheet.querySelector('.sheet-scroll') : null;
  const tiles = sheet ? [...sheet.querySelectorAll('.gcard')] : [];
  let scrollProbe = null;
  if (sc) { const b = sc.scrollTop; sc.scrollTop = 60; scrollProbe = { scrollH: sc.scrollHeight, clientH: sc.clientHeight, after: sc.scrollTop }; sc.scrollTop = b; }
  let sheetScrollProbe = null;
  if (sheet && !sc) { const b = sheet.scrollTop; sheet.scrollTop = 60; sheetScrollProbe = { scrollH: sheet.scrollHeight, clientH: sheet.clientHeight, after: sheet.scrollTop }; sheet.scrollTop = b; }
  return {
    vh,
    appvh: getComputedStyle(document.documentElement).getPropertyValue('--appvh').trim(),
    fit: sheet ? (sheet.dataset.fit || null) : null,
    sheetRect: R(sheet), sheetMaxH: sheet ? getComputedStyle(sheet).maxHeight : null,
    scRect: sc ? R(sc) : null, scrollProbe, sheetScrollProbe,
    tiles: tiles.map((t, i) => {
      const r = t.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      return { i, rect: R(t), sel: t.classList.contains('sel'), bottomInside: r.bottom <= vh + 0.6,
        centreHit: topEl ? (topEl.closest('.gcard') ? 'tile' : (topEl.id || topEl.className || topEl.tagName)) : 'none' };
    }),
    confirm: (() => { const c = document.getElementById('grid-confirm') || document.getElementById('unselect-finish'); return c ? { disabled: c.disabled, rect: R(c) } : null; })(),
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
    const startDuel = async (page) => {
      await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
      await page.click('#todeck');
      await page.waitForFunction(() => { const b = document.getElementById('startbtn'); return b && !b.disabled; }, { timeout: 30000 });
      await page.click('#startbtn');
      await sleep(2000);
    };
    const openTrap = (page, prompt) => page.evaluate((p) => { window.__select.open(p); }, prompt);
    const tapTile = async (page, idx) => {
      const c = await page.evaluate((i) => {
        const t = document.querySelector('#sheet .gcard[data-grid="' + i + '"]');
        if (!t) return null;
        const r = t.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, idx);
      if (!c) return null;
      await page.mouse.click(c.x, c.y);
      await sleep(300);
      return page.evaluate((i) => {
        const t = document.querySelector('#sheet .gcard[data-grid="' + i + '"]');
        const conf = document.getElementById('grid-confirm');
        return { sel: t ? t.classList.contains('sel') : null, confirmDisabled: conf ? conf.disabled : null };
      }, idx);
    };

    // --- M1e: no-shrink control (390x620 throughout) ---
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
      page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 160)));
      await startDuel(page);
      await openTrap(page, TRAP_PROMPT);
      await sleep(700);
      const m = await page.evaluate(MEASURE);
      ok(m.sheetRect.b <= 620 + 0.6, 'LF5-M1e: no-shrink trap sheet fits the 620px viewport (bottom ' + m.sheetRect.b + ')');
      ok(m.tiles.length === 4 && m.tiles.every(t => t.centreHit === 'tile'), 'LF5-M1e: all 4 first-render tiles hit-test to a tile');
      ok(m.fit === 'ok' || m.fit === 'clamped' || m.fit === 'scroller-forced', 'LF5-M1e: the fit self-check ran (dataset.fit=' + m.fit + ')');
      const tap = await tapTile(page, 0);
      ok(tap && tap.sel === true && tap.confirmDisabled === false, 'LF5-M1e: a real first-render tap selects tile 0 and enables 決定');
      await page.close();
    }

    // --- M1f: viewport-shrink (start 844 -> shrink to 620, no layout re-run) ---
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
      page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 160)));
      await startDuel(page);
      const appvhBefore = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--appvh').trim());
      await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
      await sleep(300);
      await openTrap(page, TRAP_PROMPT);
      await sleep(700);
      const m = await page.evaluate(MEASURE);
      ok(appvhBefore === '844px', 'LF5-M1f: the duel started with --appvh=844px (precondition: stale budget)');
      ok(m.appvh === '620px', 'LF5-M1f: opening the sheet refreshes --appvh to the live 620px (was ' + m.appvh + ')');
      ok(m.sheetRect.b <= 620 + 0.6, 'LF5-M1f: shrunken trap sheet fits the 620px viewport (bottom ' + m.sheetRect.b + ')');
      ok(m.tiles.length === 4 && m.tiles.slice(0, 3).every(t => t.centreHit === 'tile'), 'LF5-M1f: the visible row-1 tiles hit-test to a tile after the shrink');
      const tap = await tapTile(page, 0);
      ok(tap && tap.sel === true && tap.confirmDisabled === false, 'LF5-M1f: a real first-render tap selects tile 0 and enables 決定 after the shrink');
      await page.close();
    }

    // --- M1g: 12-candidate control at the shrunken viewport ---
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
      page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 160)));
      await startDuel(page);
      await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
      await sleep(300);
      await openTrap(page, CONTROL12);
      await sleep(700);
      const m = await page.evaluate(MEASURE);
      ok(m.sheetRect.b <= 620 + 0.6, 'LF5-M1g: shrunken 12-candidate sheet fits the 620px viewport (bottom ' + m.sheetRect.b + ')');
      ok(m.scrollProbe && m.scrollProbe.scrollH > m.scrollProbe.clientH + 1 && m.scrollProbe.after === 60,
        'LF5-M1g: the candidate region scrolls after the shrink (scrollH ' + (m.scrollProbe && m.scrollProbe.scrollH) + ' > clientH ' + (m.scrollProbe && m.scrollProbe.clientH) + ')');
      // scroll to the bottom: the last tile must come fully inside
      const lastInside = await page.evaluate(() => {
        const sc = document.querySelector('#sheet .sheet-scroll');
        if (!sc) return false;
        sc.scrollTop = sc.scrollHeight;
        const tiles = [...document.querySelectorAll('#sheet .gcard')];
        const last = tiles[tiles.length - 1];
        const r = last.getBoundingClientRect();
        return r.bottom <= window.innerHeight + 0.6 && r.top >= sc.getBoundingClientRect().top - 0.6;
      });
      ok(lastInside === true, 'LF5-M1g: scrolling reaches the last candidate fully inside the sheet');
      // scroll back to the top before tapping tile 0 (it is above the fold now)
      await page.evaluate(() => { const sc = document.querySelector('#sheet .sheet-scroll'); if (sc) sc.scrollTop = 0; });
      await sleep(150);
      const tap = await tapTile(page, 0);
      ok(tap && tap.sel === true && tap.confirmDisabled === false, 'LF5-M1g: a real first-render tap selects tile 0 and enables 決定 (12 candidates)');
      await page.close();
    }

    // --- M1i: same shrink, but with dvh neutralised ---
    // On the real phone the layout viewport (which dvh follows)
    // can stay tall while the visible area shrinks (app chrome
    // over the WebView), so min(100dvh-108, appvh-108) is decided
    // by the STALE appvh term and the sheet overflows. Simulate
    // that WebView condition by forcing the sheet's max-height to
    // depend on --appvh alone, and use the 12-candidate prompt
    // (whose content exceeds the 512px budget, so the cap decides
    // the sheet's height — the 4-tile trap sheet is shorter than
    // either cap and cannot discriminate). Pristine then overflows
    // the 620px viewport, fixed fits (the refresh at open
    // re-budgets it).
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
      page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 160)));
      await startDuel(page);
      await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
      await sleep(300);
      await page.addStyleTag({ content: '#sheet{max-height:calc(var(--appvh,100dvh) - 108px) !important;}' });
      await openTrap(page, CONTROL12);
      await sleep(700);
      const m = await page.evaluate(MEASURE);
      ok(m.appvh === '620px', 'LF5-M1i: with dvh neutralised, opening the sheet refreshes --appvh to the live 620px (was ' + m.appvh + ')');
      // the sheet is bottom-anchored, so a too-tall budget overflows
      // at the TOP (the title slides above the viewport), not the
      // bottom: assert the whole sheet sits inside the viewport.
      ok(m.sheetRect.t >= -0.6 && m.sheetRect.b <= 620 + 0.6, 'LF5-M1i: with dvh neutralised, the shrunken 12-candidate sheet sits wholly inside the 620px viewport (top ' + m.sheetRect.t + ', bottom ' + m.sheetRect.b + ')');
      ok(m.fit !== null && m.fit !== undefined, 'LF5-M1i: the fit self-check ran under the neutralised dvh (dataset.fit=' + m.fit + ')');
      const tap = await tapTile(page, 0);
      ok(tap && tap.sel === true && tap.confirmDisabled === false, 'LF5-M1i: a real first-render tap selects tile 0 and enables 決定 with dvh neutralised');
      await page.close();
    }
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
      page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 160)));
      await startDuel(page);
      await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
      await sleep(300);
      await page.evaluate((p) => { window.__unselect.open(p); }, UNSELECT6);
      await sleep(700);
      const m = await page.evaluate(MEASURE);
      ok(m.sheetRect.b <= 620 + 0.6, 'LF5-M1h: shrunken unselect sheet fits the 620px viewport (bottom ' + m.sheetRect.b + ')');
      ok(m.sheetScrollProbe && m.sheetScrollProbe.scrollH > m.sheetScrollProbe.clientH + 1 && m.sheetScrollProbe.after === 60,
        'LF5-M1h: the unselect sheet scrolls as a whole after the shrink (scrollH ' + (m.sheetScrollProbe && m.sheetScrollProbe.scrollH) + ' > clientH ' + (m.sheetScrollProbe && m.sheetScrollProbe.clientH) + ')');
      ok(m.tiles.length === 12, 'LF5-M1h: the unselect sheet renders its 12 candidates');
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? ('\n' + failures + ' FAILURES') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
