'use strict';
/* cap-layoutfix3.js — layout-fix round 3 verification rig (K1..K5).
   Modes:
     unsel620 / unsel844 : the REAL material prompts (with the
       driver's materialFor) captured from scripted core duels —
       Baromett step A and Castel step B — through window.__unselect
       over a live duel. Asserts the true requirement text, no
       inline effect text on tiles, uniform tile heights.
     band620 / band844 / band360 : REAL band lines harvested from
       real bot duels (GG's longest names + verbs) pushed through
       the shipped render path (state.log swap + renderLogTxt
       reset + render()). The assertion is COMPLETENESS, not
       containment-by-clamp: every .nb unit has a non-zero rect
       and lies fully inside #logline; #logline's bottom stays
       inside #midbar; the font size fitLogline settled on is
       recorded. (Round 2's failure mode — measuring boxes while
       a clamp ate the text — cannot recur: a missing unit has
       no box and fails the non-zero check.)
     sheet620            : a REAL 12-candidate SELECT_CARD prompt
       through window.__select — uniform tile heights, no .itext,
       footer visible; then 詳細 opens the modal with full text.
       Plus a REAL captured SELECT_CHAIN prompt in the dock: the
       candidate's .fxline is capped at 97px with the full body
       present (scrollHeight > clientHeight proves the scroll
       region is real), buttons visible.
     fx620               : passive-clicker live duels tallying the
       K5 records (movenote groups by from->to, notice /
       noticedrop / moveleft counts), screenshotting a live
       notice; then the notice setting is switched OFF mid-duel
       (suppressions must appear, no .fx-notice may show) and
       back ON.
   Usage: node cap-layoutfix3.js <serveRoot> <outDir> <mode> [maxSeconds] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] || 'unsel620';
const MAXS = +(process.argv[5] || 240);
fs.mkdirSync(OUT, { recursive: true });
const ART = JSON.parse(fs.readFileSync('/home/hatch/workspace/.lf3-scratch/lf3-artifacts.json', 'utf8'));
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

async function launch(width, height, fxPref) {
  await new Promise(r => server.listen(0, '127.0.0.1', r)).catch(() => {});
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 160)));
  if (fxPref) await page.evaluateOnNewDocument((pref) => { try { localStorage.setItem('v2fx', JSON.stringify(pref)); } catch (e) {} }, fxPref);
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
const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1), w: +r.width.toFixed(1) }; };

// ---------------------------------------------------------- unsel (K1 + K4)
const UNSELGEOM = () => {
  const R2 = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1), w: +r.width.toFixed(1) }; };
  const sh = document.getElementById('sheet');
  const tiles = [...sh.querySelectorAll('.gcard')];
  return {
    vh: window.innerHeight,
    subText: (sh.querySelector('.sub') || {}).textContent.replace(/\s+/g, ' ') || null,
    purpose: (sh.querySelector('.purpose') || {}).textContent || null,
    tiles: tiles.length,
    itext: sh.querySelectorAll('.itext').length,
    tileHeights: tiles.map(t => +t.getBoundingClientRect().height.toFixed(1)),
    btnnote: (sh.querySelector('.btnnote') || {}).textContent || null,
  };
};
async function unsel(height) {
  const { browser, page } = await launch(390, height);
  await startDuel(page);
  const rep = { height, states: {} };
  const cases = [['baromettA', ART.material.baromett[0]], ['castelB', ART.material.castel[1]]];
  for (const [key, prompt] of cases) {
    await page.evaluate((p) => { window.__unselect.open(JSON.parse(JSON.stringify(p))); }, prompt);
    await sleep(500);
    rep.states[key] = await page.evaluate(UNSELGEOM);
    await page.screenshot({ path: path.join(OUT, 'unsel' + height + '-' + key + '.png') });
  }
  fs.writeFileSync(path.join(OUT, 'unsel' + height + '-report.json'), JSON.stringify(rep, null, 1));
  console.log('UNSEL' + height, JSON.stringify(rep.states));
  await browser.close();
}

// ---------------------------------------------------------- band (K2)
const BANDGEOM = (str) => {
  const ll = document.getElementById('logline');
  const mb = document.getElementById('midbar');
  const llr = ll.getBoundingClientRect(), mbr = mb.getBoundingClientRect();
  // A unit is VISIBLE-complete when its box lies fully inside the
  // BAND (inline line boxes can overhang the #logline block box
  // by their half-leading, so the block is the wrong reference;
  // the band is what the player sees, and nothing clips inside
  // it now — no clamp, no overflow hidden on the line).
  const units = [...ll.querySelectorAll('.nb')].map(sp => {
    const r = sp.getBoundingClientRect();
    return { text: sp.textContent, zero: r.width === 0 || r.height === 0,
      rect: { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), l: +r.left.toFixed(1), r: +r.right.toFixed(1) },
      inside: r.top >= mbr.top - 2 && r.bottom <= mbr.bottom + 2 && r.left >= mbr.left - 2 && r.right <= mbr.right + 2 };
  });
  const tile = document.querySelector('#board .slot .tile') || document.querySelector('.slot .tile');
  const hand = document.getElementById('handbar');
  return { str, fontSize: getComputedStyle(ll).fontSize, llH: +llr.height.toFixed(1),
    llInsideBand: llr.bottom <= mbr.bottom + 0.6 && llr.top >= mbr.top - 0.6,
    mbH: +mbr.height.toFixed(1), mbBottom: +mbr.bottom.toFixed(1), vh: window.innerHeight,
    tileH: tile ? +tile.getBoundingClientRect().height.toFixed(1) : null,
    tileW: (window.__layout || {}).tileW || null,
    legacyTileW: (typeof legacyTileW === 'function') ? legacyTileW(window.innerWidth, window.innerHeight) : null,
    mbRect: { t: +mbr.top.toFixed(1), b: +mbr.bottom.toFixed(1), l: +mbr.left.toFixed(1), r: +mbr.right.toFixed(1) },
    llRect: { t: +llr.top.toFixed(1), b: +llr.bottom.toFixed(1), l: +llr.left.toFixed(1), r: +llr.right.toFixed(1) },
    stackBottom: hand ? +hand.getBoundingClientRect().bottom.toFixed(1) : null,
    units, allUnitsVisible: units.length > 0 && units.every(u => !u.zero && u.inside),
    text: ll.textContent.replace(/\s+/g, ' ') };
};
async function band(width, height) {
  const { browser, page } = await launch(width, height);
  await startDuel(page);
  const rep = { width, height, lines: [] };
  for (const str of ART.band) {
    const g = await page.evaluate((s) => {
      const st = duelState;
      st.log = st.log.slice(0, -1).concat([s]);
      renderLogTxt = null;
      render(st);
      return true;
    }, str).then(() => page.evaluate(BANDGEOM, str)).catch(e => ({ str, error: String(e).slice(0, 120) }));
    rep.lines.push(g);
    if (str.includes('水雷魔神') && str.includes('破壊され')) await page.screenshot({ path: path.join(OUT, 'band' + width + 'x' + height + '-ggdestroy.png') });
    if (str.includes('特殊召喚') && str.includes('風水魔神')) await page.screenshot({ path: path.join(OUT, 'band' + width + 'x' + height + '-ggsummon.png') });
  }
  rep.worst = rep.lines.map(l => ({ str: l.str, ok: l.allUnitsVisible && l.llInsideBand, fs: l.fontSize, llH: l.llH, mbH: l.mbH, tileW: l.tileW, legacy: l.legacyTileW }));
  fs.writeFileSync(path.join(OUT, 'band' + width + 'x' + height + '-report.json'), JSON.stringify(rep, null, 1));
  console.log('BAND' + width + 'x' + height, JSON.stringify(rep.worst));
  await browser.close();
}

// ---------------------------------------------------------- sheet + dock (K4)
async function sheet() {
  const { browser, page } = await launch(390, 620);
  await startDuel(page);
  const rep = {};
  await page.evaluate((p) => { window.__select.open(JSON.parse(JSON.stringify(p))); }, ART.selectCard);
  await sleep(600);
  rep.select = await page.evaluate(() => {
    const sh = document.getElementById('sheet');
    const tiles = [...sh.querySelectorAll('.gcard')];
    const hs = tiles.map(t => +t.getBoundingClientRect().height.toFixed(1));
    const conf = document.getElementById('grid-confirm');
    return { tiles: tiles.length, itext: sh.querySelectorAll('.itext').length, heights: hs,
      uniform: hs.length > 0 && Math.max(...hs) - Math.min(...hs) <= 1,
      confirmVisible: !!conf && conf.getBoundingClientRect().bottom <= window.innerHeight + 0.6,
      sub: (sh.querySelector('.sub') || {}).textContent.replace(/\s+/g, ' ') };
  });
  await page.screenshot({ path: path.join(OUT, 'sheet620-select.png') });
  // detail modal from the first tile
  await page.evaluate(() => { const b = document.querySelector('#sheet [data-gdetail="0"]'); if (b) b.click(); });
  await sleep(500);
  rep.detail = await page.evaluate(() => {
    const pop = document.getElementById('infopop');
    return { on: !!pop && pop.classList.contains('on'), hasText: !!pop && !!pop.querySelector('.cardtext'), len: pop ? pop.textContent.length : 0 };
  });
  await page.screenshot({ path: path.join(OUT, 'sheet620-detail.png') });
  await page.evaluate(() => { const c = document.getElementById('infopop-close'); if (c) c.click(); });
  await page.evaluate(() => { try { sheetClose(); } catch (e) {} });
  await sleep(400);
  // dock with a REAL captured chain prompt — the one whose
  // candidate effect body is longest (measured with the client's
  // own entryEffect, so the scroll region is genuinely exercised)
  if (ART.chains && ART.chains.length) {
    const pick = await page.evaluate((chains) => {
      let best = -1, bestLen = -1;
      chains.forEach((c, i) => {
        for (const e of c.prompt.entries) {
          const fx = entryEffect(e, 'chain');
          const len = fx && fx.body ? fx.body.length : 0;
          if (len > bestLen) { bestLen = len; best = i; }
        }
      });
      return { idx: best, len: bestLen };
    }, ART.chains);
    const cap = ART.chains[Math.max(0, pick.idx)];
    await page.evaluate((c) => { window.__chain.open(JSON.parse(JSON.stringify(c.prompt)), JSON.parse(JSON.stringify(c.state))); }, cap);
    await sleep(600);
    rep.dock = await page.evaluate(() => {
      const dock = document.getElementById('dock');
      const fx = dock.querySelector('.cand .fxline');
      return { on: dock.className === 'on', fxPresent: !!fx,
        fxClientH: fx ? fx.clientHeight : null, fxScrollH: fx ? fx.scrollHeight : null,
        fxTextLen: fx ? fx.textContent.length : 0,
        passVisible: !!document.getElementById('chain-pass'),
        candH: fx ? +fx.closest('.cand').getBoundingClientRect().height.toFixed(1) : null };
    });
    rep.dock.bodyLen = pick.len;
    await page.screenshot({ path: path.join(OUT, 'sheet620-dock.png') });
    // scroll-mechanism proof: the longest REAL candidate body
    // (110 chars) happens to fit the 97px region exactly, so the
    // overflow path is exercised with another real card's full
    // text (Luce, from the page's own DATA) in the same element.
    rep.dockScrollTest = await page.evaluate(() => {
      const fx = document.querySelector('#dock .cand .fxline');
      if (!fx) return null;
      fx.textContent = cardText(45409943);
      const before = { clientH: fx.clientHeight, scrollH: fx.scrollHeight };
      fx.scrollTop = 40;
      return { ...before, scrollTopAfter: fx.scrollTop, overflow: before.scrollH > before.clientH };
    });
  }
  fs.writeFileSync(path.join(OUT, 'sheet620-report.json'), JSON.stringify(rep, null, 1));
  console.log('SHEET620', JSON.stringify(rep));
  await browser.close();
}

// ---------------------------------------------------------- fx live (K5)
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
      return click(q('[data-unselect]:not(.sel)', sheet) || q('[data-unselect]', sheet));
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
async function fx() {
  const { browser, page } = await launch(390, 620);
  await startDuel(page);
  const rep = { phases: {} };
  const tally = () => page.evaluate(() => {
    const log = window.__fx.log;
    const t = { movenote: {}, samples: {}, notice: 0, noticedrop: 0, noticesuppressed: 0, moveleft: 0, moveleftSamples: [] };
    for (const r of log) {
      if (r.kind === 'movenote') { const k = r.from + '->' + r.to; t.movenote[k] = (t.movenote[k] || 0) + 1; if (!t.samples[k]) t.samples[k] = r.text; }
      else if (r.kind === 'notice') t.notice++;
      else if (r.kind === 'noticedrop') t.noticedrop++;
      else if (r.kind === 'noticesuppressed') t.noticesuppressed++;
      else if (r.kind === 'moveleft') { t.moveleft++; if (t.moveleftSamples.length < 4) t.moveleftSamples.push(r.code + '@' + r.con); }
    }
    return t;
  });
  const freshDuel = async (preStart) => {
    await page.reload({ waitUntil: 'load' }).catch(() => {});
    await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 }).catch(() => {});
    if (preStart) await preStart();
    await startDuel(page).catch(() => {});
  };
  const playFor = async (seconds, watch) => {
    const t0 = Date.now(); const seen = { noticeText: null };
    while ((Date.now() - t0) / 1000 < seconds) {
      if (watch) { const vis = await page.evaluate(() => { const n = document.querySelector('.fx-notice'); return n ? n.textContent.replace(/\s+/g, ' ') : null; }).catch(() => null); if (vis && !seen.noticeText) { seen.noticeText = vis; await page.screenshot({ path: path.join(OUT, 'fx620-notice.png') }).catch(() => {}); } }
      await page.evaluate(CLICKER).catch(() => {});
      await sleep(160);
    }
    return seen;
  };
  // phase 1: notices ON — play, watch for a visible notice, screenshot it
  const seen1 = await playFor(MAXS * 0.4, true);
  if (seen1.noticeText) rep.noticeSample = seen1.noticeText;
  rep.phases.on = await tally();
  // phase 2: fresh duel with the setting turned OFF on the start
  // screen (before the duel starts, so no notice can legitimately
  // be on screen) — suppressions must accumulate and no .fx-notice
  // element may ever show
  await freshDuel(async () => {
    const okSet = await page.evaluate(() => { const b = document.querySelector('#seg-notice [data-v="off"]'); if (!b) return false; b.click(); return window.__fx.settings.notice === false; }).catch(() => false);
    rep.offSettingVerified = okSet;
  });
  await page.evaluate(() => { window.__fx.log.length = 0; });
  let sawNoticeEl = false;
  { const t1 = Date.now();
    while ((Date.now() - t1) / 1000 < MAXS * 0.3) {
      const vis = await page.evaluate(() => !!document.querySelector('.fx-notice')).catch(() => false);
      if (vis) sawNoticeEl = true;
      await page.evaluate(CLICKER).catch(() => {});
      await sleep(160);
    } }
  rep.phases.off = await tally(); rep.phases.off.sawNoticeElement = sawNoticeEl;
  // phase 3: fresh duel with the setting flipped back ON via the
  // start screen (phase 2's OFF persisted across the reload — the
  // persistence itself is part of the spec) — notices flow again
  await freshDuel(async () => {
    const okSet = await page.evaluate(() => { const b = document.querySelector('#seg-notice [data-v="on"]'); if (!b) return false; b.click(); return window.__fx.settings.notice === true; }).catch(() => false);
    rep.onSettingVerified = okSet;
  });
  await page.evaluate(() => { window.__fx.log.length = 0; });
  await playFor(MAXS * 0.3, false);
  const after = await tally();
  rep.phases.backOn = { notice: after.notice, movenoteKinds: Object.keys(after.movenote).length, movenote: after.movenote };
  fs.writeFileSync(path.join(OUT, 'fx620-report.json'), JSON.stringify(rep, null, 1));
  console.log('FX620', JSON.stringify(rep));
  await browser.close();
}

(async () => {
  if (MODE === 'unsel620') await unsel(620);
  else if (MODE === 'unsel844') await unsel(844);
  else if (MODE === 'band620') await band(390, 620);
  else if (MODE === 'band844') await band(390, 844);
  else if (MODE === 'band360') await band(360, 640);
  else if (MODE === 'sheet620') await sheet();
  else if (MODE === 'fx620') await fx();
  else { console.error('unknown mode', MODE); process.exit(1); }
  process.exit(0);
})();
