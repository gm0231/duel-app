'use strict';
/* cap-layoutfix4.js — layout-fix round 4 verification rig (L1..L3).
   Modes:
     bandchain : the REAL chain band line "チェーン1：《ラビリンス・
       ウォール・シャドウ》" (harvested verbatim from a real duel's
       engine pushLog) pushed through the shipped render path
       (state.log swap + renderLogTxt reset + render()) at several
       widths and phase-button labels, with the chain bar on/off.
       Assertion is COMPLETENESS against the BAND: every .nb unit
       has a non-zero rect and lies fully inside #midbar; the
       number of visual lines is counted from distinct .nb tops;
       #midbar's height vs its content height is recorded (a
       band shorter than its content is the half-clipped-line
       failure). Screenshots for the failing configurations.
   Usage: node cap-layoutfix4.js <serveRoot> <outDir> <mode> [maxSeconds] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] || 'bandchain';
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

const CHAIN_STR = 'チェーン1：《ラビリンス・ウォール・シャドウ》';
// A longer event line (control): subject + long name + verb.
const EVENT_STR = '相手：《水雷魔神－ゲート・ガーディアン》を特殊召喚';
const VARIANTS = [
  'チェーン1：《ラビリンス・ウォール・シャドウ》',
  'チェーン1：《ラビリンス・ウォール・シャドウ》 の発動が無効になった',
  'チェーン1：《ラビリンス・ウォール・シャドウ》 の効果が無効になった',
  '相手：《水雷魔神－ゲート・ガーディアン》を特殊召喚',
  '自分：《神羊樹バロメット》は効果で破壊され、墓地へ送られた',
];

// bandclip: artificially compress the band (the phone's symptom:
// a 3-line chain display with the last line half-cut at the band's
// bottom edge) and verify ensureBandFits repairs it on the next
// band render — all units back inside the band, the box grown to
// its content height. Control: unconstrained, the invariant is
// inert (no inline minHeight).
async function bandclip() {
  const rep = { cases: [] };
  for (const [w, h] of [[390, 844], [390, 620]]) {
    const { browser, page } = await launch(w, h);
    try {
      await startDuel(page);
      for (const str of ['チェーン1：《ラビリンス・ウォール・シャドウ》 の発動が無効になった',
                         'チェーン1：《ラビリンス・ウォール・シャドウ》']) {
        // Control first: unconstrained render.
        const ctrl = await page.evaluate((s) => {
          const pb = document.getElementById('phasebtn'); pb.disabled = true; pb.textContent = '処理中…';
          const mb = document.getElementById('midbar');
          mb.style.height = ''; mb.style.overflow = ''; mb.style.minHeight = ''; // reset any prior clip-test constraint
          const st = duelState; st.chain = []; st.log = st.log.slice(0, -1).concat([s]);
          renderLogTxt = null; render(st);
          return { inlineMinH: mb.style.minHeight || '', mbH: +mb.getBoundingClientRect().height.toFixed(1) };
        }, str).catch(e => ({ error: String(e).slice(0, 160) }));
        rep.cases.push({ w, h, str, phase: 'control', inlineMinH: ctrl.inlineMinH, mbH: ctrl.mbH });
        console.log('CLIP-CTRL', JSON.stringify(rep.cases[rep.cases.length - 1]));
        // Compressed: pin the box to 62px with overflow hidden (the
        // phone's symptom), then re-render the band (same text, new
        // renderLogTxt) and check the repair.
        const g = await page.evaluate((s) => {
          const mb = document.getElementById('midbar');
          mb.style.height = '62px'; mb.style.overflow = 'hidden';
          const cut = mb.scrollHeight > mb.clientHeight + 1; // the constraint really cut content
          const st = duelState;
          renderLogTxt = null; render(st);
          const ll = document.getElementById('logline');
          const mbr = mb.getBoundingClientRect();
          // With overflow:hidden the clip region is the PADDING box,
          // not the border box: a unit ending on the bottom border
          // is already cut. (The first version of this check used
          // the border box and passed a still-clipped line.)
          const padTop = mbr.top + mb.clientTop, padBottom = padTop + mb.clientHeight;
          const units = [...ll.querySelectorAll('.nb')].map(sp => {
            const r = sp.getBoundingClientRect();
            return { text: sp.textContent, inside: r.top >= padTop - 0.6 && r.bottom <= padBottom + 0.6 };
          });
          return { cut, inlineMinH: mb.style.minHeight || '',
            mbH: +mbr.height.toFixed(1), mbScrollH: mb.scrollHeight, mbClientH: mb.clientHeight,
            lines: [...new Set(units.map(u => u.text))].length,
            allInside: units.length > 0 && units.every(u => u.inside),
            units: units.map(u => ({ text: u.text, inside: u.inside })) };
        }, str).catch(e => ({ error: String(e).slice(0, 160) }));
        const row = { w, h, str, phase: 'compressed', ...g };
        rep.cases.push(row);
        console.log('CLIP', JSON.stringify(row));
        await page.screenshot({ path: path.join(OUT, 'bandclip-' + w + 'x' + h + '-' + rep.cases.length + '.png') });
      }
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(OUT, 'bandclip-report.json'), JSON.stringify(rep, null, 1));
  console.log('DONE bandclip');
}

async function bandvar() {
  const rep = { cases: [] };
  for (const [w, h] of [[390, 844], [390, 620], [375, 667]]) {
    const { browser, page } = await launch(w, h);
    try {
      await startDuel(page);
      for (const str of VARIANTS) {
        const g = await page.evaluate((s) => {
          const pb = document.getElementById('phasebtn'); pb.disabled = true; pb.textContent = '処理中…';
          const st = duelState; st.chain = []; st.log = st.log.slice(0, -1).concat([s]);
          renderLogTxt = null; render(st); return true;
        }, str).then(() => page.evaluate(BANDCHAIN_GEOM)).catch(e => ({ error: String(e).slice(0, 160) }));
        const row = { w, h, str, lines: g.lines, allInside: g.allInside, llH: g.llH, mbH: g.mbH,
          mbScrollH: g.mbScrollH, llFont: g.llFont, llW: g.llW,
          llBottomVsMb: g.llRect ? +(g.llRect.b - g.mbRect.b).toFixed(1) : null,
          stackBottom: g.stackBottom, vh: g.vh, fit: g.layout && g.layout.fit,
          layout: g.layout };
        rep.cases.push(row);
        console.log('VAR', JSON.stringify(row));
        if (!g.allInside || (g.lines >= 3 && g.llRect && g.mbRect && g.llRect.b > g.mbRect.b + 0.6)) {
          await page.screenshot({ path: path.join(OUT, 'bandvar-' + w + 'x' + h + '-' + rep.cases.length + '.png') });
        }
      }
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(OUT, 'bandvar-report.json'), JSON.stringify(rep, null, 1));
  console.log('DONE bandvar');
}

// bandwidth: the phase button grows AFTER the band text was fitted
// (a new prompt changes the label without changing the log text —
// the render() band hook is skipped then, so the logline is laid
// out at a narrower width with the old fit). Measure whether any
// .nb unit then overflows the logline box / overlaps the buttons.
async function bandwidth() {
  const rep = { cases: [] };
  for (const [w, h] of [[390, 844], [390, 620]]) {
    const { browser, page } = await launch(w, h);
    try {
      await startDuel(page);
      for (const str of [CHAIN_STR, 'チェーン1：《ラビリンス・ウォール・シャドウ》 の発動が無効になった']) {
        for (const label of ['メインフェイズ2へ', 'バトルフェイズへ', 'エンドフェイズへ']) {
          const g = await page.evaluate((s, lab) => {
            const pb = document.getElementById('phasebtn');
            const st = duelState; st.chain = []; st.log = st.log.slice(0, -1).concat([s]);
            phaseAction = null; pb.disabled = true; pb.textContent = '処理中…';
            renderLogTxt = null; render(st); // fit at the short-label width
            phaseAction = { label: lab, bytes: null }; // the next prompt's long label
            render(st); // same log text, new width — the refit must catch it in THIS render
            const ll = document.getElementById('logline');
            const mb = document.getElementById('midbar');
            const pbr = pb.getBoundingClientRect(), mbr = mb.getBoundingClientRect(), llr = ll.getBoundingClientRect();
            const units = [...ll.querySelectorAll('.nb')].map(sp => {
              const r = sp.getBoundingClientRect();
              return { text: sp.textContent, fs: getComputedStyle(sp).fontSize,
                rect: { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), l: +r.left.toFixed(1), r: +r.right.toFixed(1) },
                overLogRight: r.right > llr.right + 0.6, overMbRight: r.right > mbr.right + 0.6,
                overPhaseBtn: r.right > pbr.left + 0.6 && r.top < pbr.bottom && r.bottom > pbr.top };
            });
            return { llW: +llr.width.toFixed(1), llH: +llr.height.toFixed(1), llScrollH: ll.scrollHeight,
              mbH: +mbr.height.toFixed(1), pbW: +pbr.width.toFixed(1), pbLabel: pb.textContent,
              lines: [...new Set(units.map(u => u.rect.t))].length, units,
              anyOverLog: units.some(u => u.overLogRight), anyOverBtn: units.some(u => u.overPhaseBtn) };
          }, str, label).catch(e => ({ error: String(e).slice(0, 160) }));
          const row = { w, h, str, label, llW: g.llW, llH: g.llH, mbH: g.mbH, pbW: g.pbW,
            lines: g.lines, anyOverLog: g.anyOverLog, anyOverBtn: g.anyOverBtn,
            units: g.units && g.units.map(u => ({ text: u.text, fs: u.fs, overLogRight: u.overLogRight, overPhaseBtn: u.overPhaseBtn })) };
          rep.cases.push(row);
          console.log('BW', JSON.stringify(row));
        }
      }
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(OUT, 'bandwidth-report.json'), JSON.stringify(rep, null, 1));
  console.log('DONE bandwidth');
}

const BANDCHAIN_GEOM = () => {
  const ll = document.getElementById('logline');
  const mb = document.getElementById('midbar');
  const mi = document.querySelector('.mid-info');
  const llr = ll.getBoundingClientRect(), mbr = mb.getBoundingClientRect();
  const units = [...ll.querySelectorAll('.nb')].map(sp => {
    const r = sp.getBoundingClientRect();
    return { text: sp.textContent, fs: getComputedStyle(sp).fontSize,
      rect: { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), l: +r.left.toFixed(1), r: +r.right.toFixed(1) },
      zero: r.width === 0 || r.height === 0,
      insideBand: r.top >= mbr.top - 0.6 && r.bottom <= mbr.bottom + 0.6 && r.left >= mbr.left - 0.6 && r.right <= mbr.right + 0.6 };
  });
  const tops = [...new Set(units.map(u => u.rect.t))].sort((a, b) => a - b);
  return {
    llW: +llr.width.toFixed(1), llH: +llr.height.toFixed(1), llScrollH: ll.scrollHeight, llClientH: ll.clientHeight,
    llFont: getComputedStyle(ll).fontSize, llLineH: getComputedStyle(ll).lineHeight,
    llRect: { t: +llr.top.toFixed(1), b: +llr.bottom.toFixed(1) },
    mbH: +mbr.height.toFixed(1), mbScrollH: mb.scrollHeight, mbClientH: mb.clientHeight,
    mbRect: { t: +mbr.top.toFixed(1), b: +mbr.bottom.toFixed(1) },
    miH: mi ? +mi.getBoundingClientRect().height.toFixed(1) : null,
    midLine1H: (() => { const e = document.querySelector('.mid-line1'); return e ? +e.getBoundingClientRect().height.toFixed(1) : null; })(),
    phaseBtnW: (() => { const e = document.getElementById('phasebtn'); return e ? +e.getBoundingClientRect().width.toFixed(1) : null; })(),
    phaseBtnLabel: (document.getElementById('phasebtn') || {}).textContent || '',
    chainbarOn: document.getElementById('chainbar').className,
    chainbarRect: (() => { const e = document.getElementById('chainbar'); const r = e.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), w: +r.width.toFixed(1) }; })(),
    lines: tops.length, lineTops: tops,
    units, allInside: units.length > 0 && units.every(u => !u.zero && u.insideBand),
    stackBottom: (() => { const h = document.getElementById('handbar'); return h ? +h.getBoundingClientRect().bottom.toFixed(1) : null; })(),
    vh: window.innerHeight,
    layout: window.__layout ? { fit: window.__layout.fit, budget: window.__layout.budget, contentH: window.__layout.contentH, tileW: window.__layout.tileW } : null,
    text: ll.textContent.replace(/\s+/g, ' '),
  };
};

async function bandchain() {
  const cases = [];
  for (const [w, h] of [[390, 844], [390, 620], [375, 667], [360, 640]]) {
    for (const pbLabel of ['処理中…', 'メインフェイズ2へ']) {
      for (const chain of [false, true]) {
        cases.push({ w, h, pbLabel, chain });
      }
    }
  }
  const rep = { cases: [] };
  for (const c of cases) {
    const { browser, page } = await launch(c.w, c.h);
    try {
      await startDuel(page);
      const g = await page.evaluate((str, pbLabel, chainOn) => {
        const pb = document.getElementById('phasebtn');
        pb.disabled = true; pb.textContent = pbLabel;
        // Chain bar on/off: a live chain overlays the band.
        const st = duelState;
        if (chainOn) st.chain = [{ code: 34771947, con: 1, loc: 4, seq: 0, desc: 0 }];
        else st.chain = [];
        st.log = st.log.slice(0, -1).concat([str]);
        renderLogTxt = null;
        render(st);
        return true;
      }, CHAIN_STR, c.pbLabel, c.chain).then(() => page.evaluate(BANDCHAIN_GEOM))
        .catch(e => ({ error: String(e).slice(0, 160) }));
      const row = { w: c.w, h: c.h, pb: c.pbLabel, chain: c.chain, lines: g.lines, allInside: g.allInside,
        llH: g.llH, mbH: g.mbH, mbScrollH: g.mbScrollH, llFont: g.llFont, llW: g.llW,
        llBottomVsMb: g.llRect ? +(g.llRect.b - g.mbRect.b).toFixed(1) : null,
        stackBottom: g.stackBottom, vh: g.vh, fit: g.layout && g.layout.fit };
      rep.cases.push(row);
      console.log('CHAIN', JSON.stringify(row));
      if (!g.allInside || g.lines >= 3) {
        await page.screenshot({ path: path.join(OUT, 'bandchain-' + c.w + 'x' + c.h + '-' + (c.chain ? 'chain' : 'nochain') + '-' + (c.pbLabel === '処理中…' ? 'short' : 'long') + '.png') });
      }
    } finally { await browser.close(); }
  }
  // Event-line control at 390x844, short label, no chain.
  {
    const { browser, page } = await launch(390, 844);
    try {
      await startDuel(page);
      const g = await page.evaluate((str) => {
        const pb = document.getElementById('phasebtn'); pb.disabled = true; pb.textContent = '処理中…';
        const st = duelState; st.chain = []; st.log = st.log.slice(0, -1).concat([str]);
        renderLogTxt = null; render(st); return true;
      }, EVENT_STR).then(() => page.evaluate(BANDCHAIN_GEOM)).catch(e => ({ error: String(e).slice(0, 160) }));
      console.log('EVENT-CTRL', JSON.stringify({ lines: g.lines, allInside: g.allInside, llH: g.llH, mbH: g.mbH, llFont: g.llFont }));
      rep.eventCtrl = { lines: g.lines, allInside: g.allInside, llH: g.llH, mbH: g.mbH };
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(OUT, 'bandchain-report.json'), JSON.stringify(rep, null, 1));
  console.log('DONE bandchain');
}

(async () => {
  if (MODE === 'bandchain') await bandchain();
  else if (MODE === 'bandvar') await bandvar();
  else if (MODE === 'bandwidth') await bandwidth();
  else if (MODE === 'bandclip') await bandclip();
  else { console.log('unknown mode ' + MODE); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
