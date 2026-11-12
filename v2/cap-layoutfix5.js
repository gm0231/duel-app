'use strict';
/* cap-layoutfix5.js — layout-fix round 5 verification rig (M1).
   M1: 墓守の罠②'s discard sheet (SELECT_CARD, HINTMSG_DISCARD)
   is unselectable on FIRST render in real play — ~20 taps on art /
   name bar / border select nothing, the confirm stays disabled,
   the sheet does not scroll, and tile bottoms + the 詳細 buttons
   sit below the visible fold. Tapping peek ("選択に戻る") and back
   re-renders it and selection works. This rig opens the REAL
   captured discard prompt (cap-m1-capture.js, seed 2) verbatim
   through window.__select over a live duel and measures the
   FIRST render: tile geometry vs the viewport, the candidate
   scroller's real scrollability, hit-testing (what element is
   actually on top of each tile centre), and a REAL mouse tap on a
   tile (selection + confirm enablement). Then it repeats the
   parent's exact recovery — peek on, peek off — and re-measures,
   so the mechanism (what the second render changes) is visible
   instead of guessed. A 12-candidate control prompt (the round-3
   ART.selectCard) runs the same measurements.
   Usage: node cap-layoutfix5.js <serveRoot> <outDir> <mode> [maxSeconds]
   Modes: discard620 | discard844 | discard700 | control620 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] || 'discard620';
const MAXS = +(process.argv[5] || 240);
fs.mkdirSync(OUT, { recursive: true });
const PROMPT = JSON.parse(fs.readFileSync('/home/hatch/workspace/.lf5-scratch/m1-discard-prompt.json', 'utf8'));
const ART = JSON.parse(fs.readFileSync('/home/hatch/workspace/.lf3-scratch/lf3-artifacts.json', 'utf8'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mpeg', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css' };
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

async function launch(width, height) {
  await new Promise(r => server.listen(0, '127.0.0.1', r)).catch(() => {});
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 160)));
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

// Full first-render geometry + hit-test + scrollability, in one
// evaluate so the measurements are a single consistent snapshot.
const MEASURE = () => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1), w: +r.width.toFixed(1) }; };
  const vh = window.innerHeight;
  const sheet = document.getElementById('sheet');
  const wrap = document.getElementById('sheetwrap');
  const sc = sheet ? sheet.querySelector('.sheet-scroll') : null;
  const tiles = sheet ? [...sheet.querySelectorAll('.gcard')] : [];
  const conf = document.getElementById('grid-confirm');
  const detail = sheet ? [...sheet.querySelectorAll('[data-gdetail]')] : [];
  const tilesGeom = tiles.map((t, i) => {
    const r = t.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    const nm = t.querySelector('.nm');
    const nmR = nm ? nm.getBoundingClientRect() : null;
    const topNm = nmR ? document.elementFromPoint(nmR.left + nmR.width / 2, nmR.top + nmR.height / 2) : null;
    return { i, code: t.dataset.grid, rect: R(t), sel: t.classList.contains('sel'),
      bottomInside: r.bottom <= vh + 0.6,
      centreHit: topEl ? (topEl.closest('.gcard') ? 'tile' : (topEl.id || topEl.className || topEl.tagName)) : 'none',
      nmRect: nmR ? { t: +nmR.top.toFixed(1), b: +nmR.bottom.toFixed(1) } : null,
      nmHit: topNm ? (topNm.closest('.gcard') ? 'tile' : (topNm.id || topNm.className || topNm.tagName)) : 'none' };
  });
  // scrollability of the candidate region, measured for real:
  // ask for a scroll offset and read back what stuck.
  let scrollProbe = null;
  if (sc) {
    const before = sc.scrollTop;
    sc.scrollTop = 60;
    scrollProbe = { before, after: sc.scrollTop, scrollH: sc.scrollHeight, clientH: sc.clientHeight, canScroll: sc.scrollHeight > sc.clientHeight + 1, stuck: sc.scrollTop };
    sc.scrollTop = before;
  }
  return {
    vh, appvh: getComputedStyle(document.documentElement).getPropertyValue('--appvh').trim(),
    wrapClass: wrap ? wrap.className : null, wrapClosing: wrap ? !!wrap.dataset.closing : null,
    sheetClass: sheet ? sheet.className : null,
    sheetRect: R(sheet),
    sheetMaxH: sheet ? getComputedStyle(sheet).maxHeight : null,
    sheetOverflow: sheet ? getComputedStyle(sheet).overflowY : null,
    scRect: sc ? R(sc) : null, scrollProbe,
    tiles: tilesGeom.length, tilesGeom,
    detailRects: detail.map(d => R(d)),
    detailInside: detail.map(d => { const r = d.getBoundingClientRect(); return r.bottom <= vh + 0.6; }),
    confirm: conf ? { disabled: conf.disabled, rect: R(conf), label: conf.textContent.trim() } : null,
    cancel: !!document.getElementById('grid-cancel'),
    gridmoreVisible: (() => { const g = document.getElementById('gridmore'); return g ? getComputedStyle(g).display !== 'none' : null; })(),
    peekText: (document.getElementById('peekbtn') || {}).textContent || null,
  };
};

async function runCase(page, key, prompt) {
  const rep = { key, prompt: { cards: prompt.cards.length, min: prompt.min, max: prompt.max, hint: prompt.selectHint, cancelable: prompt.cancelable } };
  await page.evaluate((p) => { window.__select.open(JSON.parse(JSON.stringify(p))); }, prompt);
  await sleep(700); // past the 280ms entrance + 90..265ms row stagger
  rep.first = await page.evaluate(MEASURE);
  await page.screenshot({ path: path.join(OUT, key + '-first.png') });
  // a REAL mouse tap on tile 0's centre (what the parent did ~20x)
  rep.tap = await page.evaluate(() => {
    const t = document.querySelector('#sheet .gcard[data-grid="0"]');
    if (!t) return { error: 'no tile 0' };
    const r = t.getBoundingClientRect();
    return { centre: { x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) } };
  });
  if (rep.tap.centre) {
    await page.mouse.click(rep.tap.centre.x, rep.tap.centre.y);
    await sleep(400);
  }
  rep.afterTap = await page.evaluate(MEASURE);
  await page.screenshot({ path: path.join(OUT, key + '-aftertap.png') });
  // the parent's exact recovery: peek ("選択に戻る") then back
  await page.evaluate(() => { const b = document.getElementById('peekbtn'); if (b) b.click(); });
  await sleep(500);
  await page.evaluate(() => { const b = document.getElementById('peekbtn'); if (b) b.click(); });
  await sleep(500);
  rep.afterPeekToggle = await page.evaluate(MEASURE);
  await page.screenshot({ path: path.join(OUT, key + '-afterpeek.png') });
  // and tap tile 0 again on the re-rendered sheet
  const c2 = await page.evaluate(() => {
    const t = document.querySelector('#sheet .gcard[data-grid="0"]');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (c2) {
    await page.mouse.click(c2.x, c2.y);
    await sleep(400);
  }
  rep.afterPeekTap = await page.evaluate(MEASURE);
  await page.screenshot({ path: path.join(OUT, key + '-afterpeektap.png') });
  // close the sheet for the next case
  await page.evaluate(() => { try { sheetClose(); } catch (e) {} });
  await sleep(400);
  return rep;
}

(async () => {
  const specs = {
    discard620: { w: 390, h: 620, key: 'discard620', prompt: PROMPT },
    discard844: { w: 390, h: 844, key: 'discard844', prompt: PROMPT },
    discard700: { w: 390, h: 700, key: 'discard700', prompt: PROMPT },
    control620: { w: 390, h: 620, key: 'control620', prompt: ART.selectCard },
  };
  const spec = specs[MODE] || specs.discard620;
  const { browser, page } = await launch(spec.w, spec.h);
  await startDuel(page);
  const rep = await runCase(page, spec.key, spec.prompt);
  fs.writeFileSync(path.join(OUT, spec.key + '-report.json'), JSON.stringify(rep, null, 1));
  const f = rep.first, at = rep.afterTap, ap = rep.afterPeekToggle, apt = rep.afterPeekTap;
  const summ = (m) => m ? { tiles: m.tiles, scCanScroll: m.scrollProbe && m.scrollProbe.canScroll, scStuck: m.scrollProbe && m.scrollProbe.stuck, tilesBottomInside: m.tilesGeom.map(t => t.bottomInside), centreHit: m.tilesGeom.map(t => t.centreHit), nmHit: m.tilesGeom.map(t => t.nmHit), detailInside: m.detailInside, confirmDisabled: m.confirm && m.confirm.disabled, confirmBottom: m.confirm && m.confirm.rect && m.confirm.rect.b, sheetBottom: m.sheetRect && m.sheetRect.b, vh: m.vh } : null;
  console.log(JSON.stringify({ mode: MODE, first: summ(f), afterTap: summ(at), afterPeekToggle: summ(ap), afterPeekTap: summ(apt) }, null, 1));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
