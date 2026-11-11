'use strict';
/* cap-fxround5.js — FX/UI round 5 verification rig (I1/I2/I3).
   Part S (synth, 390x620, DSF2): fabricated gridSheet with 1 and 2
     candidates (I2 tile widths / itext) + mid-band text-fit on the
     boot board.
   Part L (live, default fonts): one real duel, passive clicker.
     Mid-band text-fit sampled throughout (text rect must sit inside
     its element box for pwho / lp / logline / prevlog), layout fit
     (handbar bottom <= viewport), and the history modal opened
     twice — counts must grow modestly and the first opening's rows
     must be a prefix of the second's (I3: no re-appended copies).
   Part M (minfont): real duel under the minimum-font-size:16px
     profile (/tmp/chrome-minfont): text-fit + stack fit + crop.
   Usage: node cap-fxround5.js <serveRoot> <outDir> <synth|live|minfont> [maxSeconds] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] || 'synth';
const MAXS = +(process.argv[5] || 170);
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

async function launch(resp, opts) {
  opts = opts || {};
  await new Promise(r => server.listen(0, '127.0.0.1', r)).catch(() => {});
  const port = server.address().port;
  const launchOpts = { executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] };
  if (opts.userDataDir) launchOpts.userDataDir = opts.userDataDir;
  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 160)));
  await page.evaluateOnNewDocument((r) => { try { localStorage.setItem('v2fx', JSON.stringify({ cutin: true, resp: r })); } catch (e) {} }, resp);
  await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
  return { browser, page };
}

const MIDMEASURE = () => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1) }; };
  const T = (el) => { if (!el || !el.firstChild) return null; const rg = document.createRange(); rg.selectNodeContents(el); const r = rg.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1) }; };
  const fit = (el, tr) => (el && tr) ? { overT: +(el.t - tr.t).toFixed(1), overB: +(tr.b - el.b).toFixed(1) } : null;
  const pwho = document.querySelector('#phasebar .pwho');
  const lp = document.querySelector('#phasebar .lp');
  const ll = document.getElementById('logline');
  const pv = document.querySelector('#chainbar .prevlog');
  const hb = document.getElementById('handbar');
  return {
    pwho: R(pwho), pwhoFit: fit(R(pwho), T(pwho)),
    lp: R(lp), lpFit: fit(R(lp), T(lp)),
    logline: R(ll), loglineFit: fit(R(ll), T(ll)), logText: ll ? ll.textContent : null,
    prevlog: R(pv), prevlogFit: fit(R(pv), T(pv)),
    phasebar: R(document.getElementById('phasebar')), midbar: R(document.getElementById('midbar')),
    handBottom: hb ? +hb.getBoundingClientRect().bottom.toFixed(1) : null,
    layout: window.__layout ? { fit: window.__layout.fit, budget: window.__layout.budget } : null,
  };
};

const CLICKER = () => {
  const doc = document, q = (s, r) => (r || doc).querySelector(s);
  const click = (el) => { if (el) { el.click(); return true; } return false; };
  if (doc.getElementById('dock').className === 'on') { click(q('#chain-pass')) || click(q('#dock [data-chain]')); return; }
  if (doc.getElementById('sheetwrap').classList.contains('on')) {
    const sheet = doc.getElementById('sheet');
    const cok = q('#counter-confirm', sheet);
    if (q('[data-inc]', sheet) && cok && cok.disabled) return click(q('[data-inc]', sheet));
    if (cok && !cok.disabled) return click(cok);
    if (q('.grid', sheet)) {
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

async function startDuel(page) {
  await page.click('#todeck');
  await page.waitForFunction(() => { const b = document.getElementById('startbtn'); return b && !b.disabled; }, { timeout: 30000 });
  await page.click('#startbtn');
  await sleep(2000);
}

/* ------------------------------ synth (I2 + I1 statics) ------------------------------ */
async function synth() {
  const { browser, page } = await launch('auto');
  const rep = {};
  // Start a real duel first so the fabricated sheets open over the
  // board (over the start overlay they would be hidden in shots).
  await startDuel(page);
  await page.evaluate(CLICKER).catch(() => {});
  await sleep(1200);
  // I2: fabricate selection sheets with 1 and 2 candidates via the
  // real gridSheet (script-scope function, callable from the page).
  // The live game keeps processing, so a fabricated sheet can be
  // reclaimed by an arriving prompt — re-fabricate until the shot
  // lands with the sheet actually open.
  for (const n of [1, 2]) {
    for (let attempt = 0; attempt < 12; attempt++) {
      rep['grid' + n] = await page.evaluate((n) => {
        const codes = [83764718, 16435215]; // 死者蘇生 / 墓穴の道連れ (long texts)
        gridSheet({
          title: 'カードの選択', sub: '1枚選んでください', showText: true,
          prompt: { retryCount: 0, min: 1 },
          cards: codes.slice(0, n).map(code => ({ code, locLabel: '墓地' })),
          selected: new Set(), valid: () => false, confirmLabel: '決定', cancelable: true,
          onToggle: () => {}, onConfirm: () => {},
        });
        const grid = document.querySelector('#sheet .grid');
        const cards = [...grid.querySelectorAll('.gcard')];
        const it = cards[0].querySelector('.itext');
        const cs = it ? getComputedStyle(it) : null;
        return {
          gridW: +grid.getBoundingClientRect().width.toFixed(1),
          widths: cards.map(c => +c.getBoundingClientRect().width.toFixed(1)),
          itext: it ? { fs: cs.fontSize, clamp: cs.webkitLineClamp, maxH: cs.maxHeight, h: +it.getBoundingClientRect().height.toFixed(1) } : null,
        };
      }, n);
      // Wait for the sheet's slide-up to settle (rect top stable
      // across two polls) before shooting — DOM presence alone
      // races both the animation and the game's teardown.
      let settled = false, lastTop = null;
      for (let w = 0; w < 10 && !settled; w++) {
        await sleep(80);
        const st = await page.evaluate((n) => {
          const sw = document.getElementById('sheetwrap');
          const sh = document.getElementById('sheet');
          if (!sw.classList.contains('on') || !sh) return null;
          if (document.querySelectorAll('#sheet .grid .gcard').length !== n) return null;
          return sh.getBoundingClientRect().top;
        }, n);
        if (st !== null && lastTop !== null && Math.abs(st - lastTop) < 0.6) settled = true;
        if (st !== null) lastTop = st;
      }
      if (settled) { await page.screenshot({ path: path.join(OUT, 'synth-grid' + n + '.png') }); break; }
    }
    await page.evaluate(() => sheetClose());
    await sleep(300);
  }
  rep.midBoot = await page.evaluate(MIDMEASURE);
  fs.writeFileSync(path.join(OUT, 'synth-report.json'), JSON.stringify(rep, null, 1));
  console.log('SYNTH DONE', JSON.stringify(rep));
  await browser.close();
}

/* ------------------------------ live / minfont ------------------------------ */
async function live(minfontMode) {
  const { browser, page } = await launch('auto', minfontMode ? { userDataDir: '/tmp/chrome-minfont' } : {});
  await startDuel(page);
  const rep = { samples: [], modals: [], worst: { overT: 0, overB: 0 }, maxHandBottom: 0 };
  const t0 = Date.now();
  let modalCount = 0, lastModalTurn = -1, shot = 0;
  while ((Date.now() - t0) / 1000 < MAXS) {
    const st = await page.evaluate(() => ({
      dockOn: document.getElementById('dock').className === 'on',
      sheetOn: document.getElementById('sheetwrap').classList.contains('on'),
      result: document.getElementById('result').style.display === 'flex',
      turn: (document.getElementById('turninfo') || {}).textContent || '',
    })).catch(() => ({ result: true }));
    if (st.result) break;
    const turnNum = +((st.turn.match(/ターン(\d+)/) || [])[1] || 0);
    // history modal: twice, at least 2 turns apart, screen free
    if (modalCount < 2 && !st.dockOn && !st.sheetOn && turnNum >= 3 && turnNum >= lastModalTurn + 2) {
      await page.click('#logline').catch(() => {});
      await sleep(900);
      const m = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#sheet .loghistrow')].map(e => e.textContent);
        return { sub: (document.querySelector('#sheet .sub') || {}).textContent || '', rowCount: rows.length, rows, dupes: rows.length - new Set(rows).size };
      }).catch(() => null);
      if (m && m.rowCount) {
        rep.modals.push(m);
        modalCount++; lastModalTurn = turnNum;
        await page.screenshot({ path: path.join(OUT, (minfontMode ? 'minfont' : 'live') + '-modal' + modalCount + '.png') });
      }
      await page.click('#sheet-cancel').catch(() => {});
      await sleep(400);
    }
    await page.evaluate(CLICKER).catch(() => {});
    await sleep(850);
    const m = await page.evaluate(MIDMEASURE).catch(() => null);
    if (m && m.logText && m.logText !== '対戦を準備中…') {
      rep.samples.push(m);
      for (const k of ['pwhoFit', 'lpFit', 'loglineFit', 'prevlogFit']) {
        const f = m[k]; if (!f) continue;
        rep.worst.overT = Math.max(rep.worst.overT, f.overT, 0);
        rep.worst.overB = Math.max(rep.worst.overB, f.overB, 0);
      }
      if (m.handBottom) rep.maxHandBottom = Math.max(rep.maxHandBottom, m.handBottom);
      if (shot < 4 && rep.samples.length % 25 === 0) {
        await page.screenshot({ path: path.join(OUT, (minfontMode ? 'minfont' : 'live') + '-board' + (shot++) + '.png') });
        if (m.midbar) await page.screenshot({ path: path.join(OUT, (minfontMode ? 'minfont' : 'live') + '-mid' + shot + '.png'), clip: { x: 0, y: Math.max(0, m.midbar.t - 4), width: 390, height: m.midbar.h + 8 } });
      }
    }
  }
  // modal prefix check
  if (rep.modals.length === 2) {
    const [a, b] = rep.modals;
    rep.prefixOk = a.rows.every((r, i) => b.rows[i] === r);
    rep.growth = b.rowCount - a.rowCount;
    rep.subs = [a.sub, b.sub];
  }
  fs.writeFileSync(path.join(OUT, (minfontMode ? 'minfont' : 'live') + '-report.json'), JSON.stringify(rep, null, 1));
  console.log((minfontMode ? 'MINFONT' : 'LIVE') + ' DONE samples=' + rep.samples.length + ' worstOverT=' + rep.worst.overT + ' worstOverB=' + rep.worst.overB + ' maxHandBottom=' + rep.maxHandBottom + ' modals=' + rep.modals.map(m => m.rowCount + '/' + m.dupes).join(',') + ' prefixOk=' + rep.prefixOk + ' growth=' + rep.growth);
  await browser.close();
}

(async () => {
  try {
    if (MODE === 'live') await live(false);
    else if (MODE === 'minfont') await live(true);
    else await synth();
  } catch (e) { console.error('FATAL', e); process.exit(1); }
  server.close();
})();
