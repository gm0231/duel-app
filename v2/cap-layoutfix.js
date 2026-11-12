'use strict';
/* cap-layoutfix.js — layout-fix round verification rig (J1/J2/J4/J5).
   Modes:
     synth620 / synth844 / synth998 : fabricated gridSheet (2 long-text
       candidates, the J1 case) over a live duel; geometry of sheet /
       grid / btnrow before and after scrolling; screenshots.
     keeptest : word-break:keep-all behaviour probe for J2 log lines.
     live : passive-clicker duel(s) sampling J2 (logline lines/fit +
       which events the band shows), J3 (notice records), J5d (any
       monster-code tile rendered inside a szone row), own-set tiles.
   Usage: node cap-layoutfix.js <serveRoot> <outDir> <mode> [maxSeconds] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] || 'synth620';
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
const HEIGHTS = { synth620: 620, synth844: 844, synth998: 998 };

async function launch(height) {
  await new Promise(r => server.listen(0, '127.0.0.1', r)).catch(() => {});
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 160)));
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('v2fx', JSON.stringify({ cutin: true, resp: 'auto' })); } catch (e) {}
    window.__notices = [];
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver((muts) => {
        for (const m of muts) for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList && n.classList.contains('fx-notice')) window.__notices.push(n.textContent.replace(/\s+/g, ' '));
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    });
  });
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

const SHEETGEOM = () => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1), w: +r.width.toFixed(1) }; };
  const sh = document.getElementById('sheet');
  const grid = sh.querySelector('.grid');
  const btn = sh.querySelector('.btnrow');
  const conf = document.getElementById('grid-confirm');
  const sc = sh.querySelector('.sheet-scroll');
  return {
    vh: window.innerHeight,
    flex: sh.classList.contains('flexsheet'), wrapFixed: getComputedStyle(document.getElementById('sheetwrap')).position,
    sheet: R(sh), grid: R(grid), btnrow: R(btn), confirm: R(conf),
    scroller: sc ? { r: R(sc), scrollH: sc.scrollHeight, clientH: sc.clientHeight } : null,
    sheetScroll: { h: sh.scrollHeight, c: sh.clientHeight, top: sh.scrollTop },
    confirmInView: conf ? (conf.getBoundingClientRect().top >= 0 && conf.getBoundingClientRect().bottom <= window.innerHeight) : null,
    cards: [...sh.querySelectorAll('.gcard')].map(c => { const it = c.querySelector('.itext'); return { r: R(c), itextH: it ? it.offsetHeight : 0, itextFull: it ? it.textContent.length : 0 }; }),
  };
};

async function synth(height) {
  const { browser, page } = await launch(height);
  await startDuel(page);
  await sleep(1500);
  const rep = { height };
  const N = +(process.env.SYNTH_N || 2);
  for (let attempt = 0; attempt < 12; attempt++) {
    rep.geom = await page.evaluate((n) => {
      const pool = [83764718, 16435215, 70781052, 44095762, 25774483, 6351147];
      const codes = pool.slice(0, n);
      try {
        gridSheet({
          title: 'カードの選択', purpose: 'エクシーズ素材にするカードを選択', sub: n + '枚選んでください（現在 0 枚）', showText: true,
          prompt: { retryCount: 0, min: 2 },
          cards: codes.map(code => ({ code, locLabel: 'フィールド' })),
          selected: new Set(), valid: () => false, confirmLabel: '決定', cancelable: true,
          onToggle: () => {}, onConfirm: () => {},
        });
      } catch (e) { return { err: String(e && e.stack || e) }; }
      return null;
    }, N).then((r) => { if (r && r.err) throw new Error(r.err); return page.evaluate(SHEETGEOM); }).catch(e => ({ err: String(e) }));
    let settled = false, lastTop = null;
    for (let w = 0; w < 10 && !settled; w++) {
      await sleep(80);
      const st = await page.evaluate(() => {
        const sw = document.getElementById('sheetwrap'); const sh = document.getElementById('sheet');
        if (!sw.classList.contains('on') || !sh) return null;
        if (document.querySelectorAll('#sheet .grid .gcard').length === 0) return null;
        return sh.getBoundingClientRect().top;
      });
      if (st !== null && lastTop !== null && Math.abs(st - lastTop) < 0.6) settled = true;
      if (st !== null) lastTop = st;
    }
    if (settled) break;
  }
  rep.geom = await page.evaluate(SHEETGEOM);
  await page.screenshot({ path: path.join(OUT, 'synth' + height + '-top.png') });
  // scroll the candidate region to its bottom and re-measure
  await page.evaluate(() => { const sc = document.querySelector('#sheet .sheet-scroll') || document.getElementById('sheet'); sc.scrollTop = sc.scrollHeight; });
  await sleep(350);
  rep.geomAfterScroll = await page.evaluate(SHEETGEOM);
  await page.screenshot({ path: path.join(OUT, 'synth' + height + '-scrolled.png') });
  fs.writeFileSync(path.join(OUT, 'synth' + height + '-report.json'), JSON.stringify(rep, null, 1));
  console.log('SYNTH' + height, JSON.stringify(rep.geom), 'AFTER-SCROLL confirmInView=', rep.geomAfterScroll && rep.geomAfterScroll.confirmInView);
  await browser.close();
}

async function keeptest() {
  const { browser, page } = await launch(620);
  const lines = [
    'チェーン1：ラビリンス・ウォール・シャドウ',
    '相手：ラビリンス・ウォール・シャドウ をセット',
    '相手：エルフェンノーツ～狂奏のラプソディア～ を特殊召喚',
    '自分：マジックカード「死者蘇生」を発動',
    '相手：合体魔神－ゲート・ガーディアン を特殊召喚',
  ];
  const res = await page.evaluate((lines) => {
    const out = {};
    for (const wb of ['normal', 'keep-all']) {
      out[wb] = lines.map(t => {
        const d = document.createElement('div');
        d.style.cssText = 'width:190px;font-size:12.5px;line-height:1.35;word-break:' + wb + ';';
        d.textContent = t;
        document.body.appendChild(d);
        // split into rendered lines via range rects
        const range = document.createRange(); range.selectNodeContents(d);
        const rects = [...range.getClientRects()];
        const byTop = {};
        for (const r of rects) { const k = Math.round(r.top); (byTop[k] = byTop[k] || []).push(r); }
        const nLines = Object.keys(byTop).length;
        const h = d.getBoundingClientRect().height;
        d.remove();
        return { text: t, lines: nLines, h: +h.toFixed(1) };
      });
    }
    return out;
  }, lines);
  console.log(JSON.stringify(res, null, 1));
  fs.writeFileSync(path.join(OUT, 'keeptest.json'), JSON.stringify(res, null, 1));
  await browser.close();
}

const CLICKER = () => {
  const doc = document, q = (s, r) => (r || doc).querySelector(s);
  const click = (el) => { if (el) { el.click(); return true; } return false; };
  if (doc.getElementById('result').style.display === 'flex') return;
  if (doc.getElementById('dock').className === 'on') { click(q('#chain-pass')) || click(q('#dock [data-chain]')); return; }
  if (doc.getElementById('sheetwrap').classList.contains('on')) {
    const sheet = doc.getElementById('sheet');
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
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1) }; };
  const ll = document.getElementById('logline');
  let lineRects = [];
  if (ll && ll.firstChild) {
    const rg = document.createRange(); rg.selectNodeContents(ll);
    lineRects = [...rg.getClientRects()].map(r => ({ t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), w: +r.width.toFixed(1) }));
  }
  const mb = document.getElementById('midbar');
  // J5d: monster tiles in szone rows (tile with a slotplate = monster stats)
  const bad = [];
  for (const rowId of ['oppSzone', 'mySzone']) {
    const row = document.getElementById(rowId);
    if (row) row.querySelectorAll('.slot.hs').forEach(s => {
      const nm = s.querySelector('.nm');
      bad.push(rowId + ':' + (s.dataset.zone || '?') + ':' + (nm ? nm.textContent : '(noname)'));
    });
  }
  // own set tiles state
  const ownSet = [...document.querySelectorAll('#myMzone .tile.setown, #mySzone .tile.setown')].length;
  const notices = (window.__notices || []).length;
  return {
    logText: ll ? ll.textContent : null,
    logEl: R(ll), logLines: lineRects, midbar: R(mb),
    logClipped: (ll && mb) ? (lineRects.length && (lineRects[lineRects.length - 1].b > mb.getBoundingClientRect().bottom - 1)) : null,
    logDelta: (ll && mb && lineRects.length) ? +(mb.getBoundingClientRect().bottom - lineRects[lineRects.length - 1].b).toFixed(1) : null,
    badZoneTiles: bad, ownSetTiles: ownSet, noticeCount: notices,
    result: document.getElementById('result').style.display === 'flex',
    turn: (document.getElementById('turninfo') || {}).textContent || '',
  };
};

async function live() {
  const { browser, page } = await launch(620);
  await startDuel(page);
  const rep = { samples: [], badZone: [], maxOwnSet: 0, logClips: 0, logTexts: [] };
  const t0 = Date.now();
  let shotN = 0;
  while ((Date.now() - t0) / 1000 < MAXS) {
    await page.evaluate(CLICKER).catch(() => {});
    await sleep(800);
    const s = await page.evaluate(SAMPLE).catch(() => null);
    if (!s) continue;
    if (s.result) { rep.result = true; await page.screenshot({ path: path.join(OUT, 'live-result.png') }); break; }
    rep.samples.push(s);
    if (s.badZoneTiles.length) rep.badZone.push(...s.badZoneTiles);
    rep.maxOwnSet = Math.max(rep.maxOwnSet, s.ownSetTiles);
    if (s.logClipped) rep.logClips++;
    if (s.logText && rep.logTexts[rep.logTexts.length - 1] !== s.logText) rep.logTexts.push(s.logText);
    if (s.ownSetTiles > 0 && shotN < 3) { await page.screenshot({ path: path.join(OUT, 'live-ownset' + (shotN++) + '.png') }); }
  }
  rep.notices = await page.evaluate(() => (window.__notices || []).slice(-200)).catch(() => []);
  fs.writeFileSync(path.join(OUT, 'live-report.json'), JSON.stringify(rep, null, 1));
  console.log('LIVE DONE samples=' + rep.samples.length + ' badZone=' + JSON.stringify(rep.badZone) + ' maxOwnSet=' + rep.maxOwnSet + ' logClips=' + rep.logClips + ' notices=' + rep.notices.length + ' result=' + !!rep.result);
  console.log('NOTICES', JSON.stringify(rep.notices, null, 1));
  console.log('LOGTEXTS', JSON.stringify(rep.logTexts, null, 1));
  await browser.close();
}

async function dockshots() {
  const { browser, page } = await launch(620);
  await startDuel(page);
  await sleep(1200);
  // J4 case A: empty-chain window answered to a special summon (trigger)
  await page.evaluate(() => {
    const prompt = { name: 'SELECT_CHAIN', player: HP, forced: false, retryCount: 0, entries: [{ code: 6351147, desc: 0, loc: 8, con: HP, seq: 0 }], context: null,
      trigger: { kind: 'summon', code: 25955164, con: 1 - HP, verb: 62 } };
    uiChain(prompt, duelState);
  });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'dock-trigger.png') });
  // J4 case B: answering chain link 1 (context)
  await page.evaluate(() => {
    const prompt = { name: 'SELECT_CHAIN', player: HP, forced: false, retryCount: 0, entries: [{ code: 6351147, desc: 0, loc: 8, con: HP, seq: 0 }],
      context: { code: 34771947, con: 1 - HP, link: 1, solving: false }, trigger: null };
    uiChain(prompt, duelState);
  });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'dock-context.png') });
  // J5c: an own face-down monster tile on the board (veil check)
  await page.evaluate(() => {
    const slot = document.querySelector('#myMzone .slot');
    const card = { code: 46148485, pos: 8, materials: 0 };
    slot.innerHTML = tileHTML(card, HP, null, 4) + slotStatsHTML(card, HP, 4);
    document.getElementById('dock').className = '';
  });
  await sleep(2400); // mid-breath
  await page.screenshot({ path: path.join(OUT, 'ownset-tile.png'), clip: { x: 0, y: 300, width: 390, height: 320 } });
  console.log('DOCKSHOTS DONE');
  await browser.close();
}

async function reshist() {
  const { browser, page } = await launch(620);
  await startDuel(page);
  const t0 = Date.now();
  let done = false;
  while ((Date.now() - t0) / 1000 < MAXS && !done) {
    await page.evaluate(CLICKER).catch(() => {});
    await sleep(700);
    done = await page.evaluate(() => document.getElementById('result').style.display === 'flex').catch(() => false);
  }
  const rep = { resultReached: done };
  if (done) {
    await sleep(600);
    await page.screenshot({ path: path.join(OUT, 'result.png') });
    await page.click('#reshistbtn');
    await sleep(600);
    rep.histOpened = await page.evaluate(() => document.getElementById('sheetwrap').classList.contains('on') && document.getElementById('result').style.display === 'none');
    await page.screenshot({ path: path.join(OUT, 'result-history.png') });
    await page.click('#sheet-cancel');
    await sleep(500);
    rep.resultRestored = await page.evaluate(() => document.getElementById('result').style.display === 'flex' && !document.getElementById('sheetwrap').classList.contains('on'));
    await page.screenshot({ path: path.join(OUT, 'result-restored.png') });
  }
  console.log('RESHIST', JSON.stringify(rep));
  await browser.close();
}

async function peekshot() {
  const { browser, page } = await launch(620);
  await startDuel(page);
  await sleep(1200);
  await page.evaluate(() => {
    gridSheet({
      title: 'カードの選択', purpose: '墓地へ送るカードを選択', sub: '1枚選んでください（現在 0 枚）', showText: true,
      prompt: { retryCount: 0, min: 1 },
      cards: [25955164, 62340868, 98715423].map(code => ({ code, locLabel: 'フィールド' })),
      selected: new Set(), valid: () => false, confirmLabel: '決定', cancelable: true,
      onToggle: () => {}, onConfirm: () => {},
    });
  });
  await sleep(600);
  const before = await page.evaluate(() => {
    const pk = document.getElementById('peekbtn'); const sh = document.getElementById('sheet');
    return { pkBottom: pk.style.bottom, sheetH: sh.offsetHeight, pkRectB: +pk.getBoundingClientRect().bottom.toFixed(1), sheetTop: +sh.getBoundingClientRect().top.toFixed(1) };
  });
  await page.click('#peekbtn');
  await sleep(600);
  const peeked = await page.evaluate(() => {
    const sh = document.getElementById('sheet'); const pk = document.getElementById('peekbtn');
    return { wrapPeek: document.getElementById('sheetwrap').classList.contains('peek'), sheetTop: +sh.getBoundingClientRect().top.toFixed(1), pkTop: +pk.getBoundingClientRect().top.toFixed(1) };
  });
  await page.screenshot({ path: path.join(OUT, 'peek-on.png') });
  await page.click('#peekbtn');
  await sleep(600);
  const restored = await page.evaluate(() => {
    const sh = document.getElementById('sheet');
    return { wrapPeek: document.getElementById('sheetwrap').classList.contains('peek'), sheetTop: +sh.getBoundingClientRect().top.toFixed(1) };
  });
  console.log('PEEK', JSON.stringify({ before, peeked, restored }));
  await browser.close();
}

(async () => {
  try {
    if (MODE === 'keeptest') await keeptest();
    else if (MODE === 'live') await live();
    else if (MODE === 'dockshots') await dockshots();
    else if (MODE === 'reshist') await reshist();
    else if (MODE === 'peekshot') await peekshot();
    else await synth(HEIGHTS[MODE] || 620);
  } catch (e) { console.error('FATAL', e); process.exit(1); }
  server.close();
})();
