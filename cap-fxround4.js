'use strict';
/* cap-fxround4.js — FX/UI round 4 verification rig (H1/H2/H3).
   Part S (synth, 390x620, DSF2, default fonts): fabricated board +
     real uiAnswer chain prompts.
     H1: burst frames during the dock's arrival animation; per-frame
         ghost metric (std + correlation vs the dock-closed crop) on a
         region that is empty dock ground in the settled state.
     H2: 1-candidate dock (candidate width vs dock width) and a tall
         dock (2 candidates + duelsection) — pass row and the pass
         note (.sub) must be fully inside the 620px viewport.
     H3: mid-band geometry in the default font environment (the
         frozen 78px budget must be unchanged).
   Part M (minfont): real duel launched with a Chrome profile whose
     minimum font size is 16px (the environment that reproduced H3):
     mid-band geometry + crops; the log line must not be clipped and
     the whole stack must still fit 620px.
   Part L (live): one real duel, passive clicker, periodic shots.
   Usage: node cap-fxround4.js <serveRoot> <outDir> <synth|minfont|live> [maxSeconds] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] || 'synth';
const MAXS = +(process.argv[5] || 150);
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.m4a': 'audio/m4a', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let file;
  if (p.startsWith('/ev/')) file = path.join(OUT, p.slice(4));
  else { if (p.endsWith('/')) p += 'index.html'; file = path.join(ROOT, p); }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const KELDO = 63542003, MUDORA = 99937011, KELBEK = 25926710;
const CHROME = '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome';

async function launch(resp, opts) {
  opts = opts || {};
  await new Promise(r => server.listen(0, '127.0.0.1', r)).catch(() => {});
  const port = server.address().port;
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'];
  const launchOpts = { executablePath: CHROME, args };
  if (opts.userDataDir) launchOpts.userDataDir = opts.userDataDir;
  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 160)));
  await page.evaluateOnNewDocument((r) => {
    try { localStorage.setItem('v2fx', JSON.stringify({ cutin: true, resp: r })); } catch (e) {}
  }, resp);
  await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
  return { browser, page, port };
}

async function fabricate(page) {
  await page.evaluate((K, M, KB) => {
    const P = () => ({ mzone: [null, null, null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
    const b = { players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], dlog: [], lastAttack: null };
    const mon = (code, pos) => ({ code, pos, materials: 0, counters: null, curAtk: null, curDef: null });
    b.players[1].mzone[0] = mon(K, 0x1);
    b.players[1].mzone[1] = mon(KB, 0x1);
    b.players[0].mzone[0] = mon(M, 0x1);
    duelState = b; render(b);
    document.getElementById('start').style.display = 'none';
    window.__dispatchChain = (entries, topCode) => {
      duelState.chain = topCode ? [{ code: topCode }] : [];
      window.__synthDone = false;
      uiAnswer({ name: 'SELECT_CHAIN', forced: false, entries }, duelState).then(() => { window.__synthDone = true; });
    };
    window.__entries = {
      mudraFx: { code: 99937011, con: 0, loc: 8, seq: 0, desc: 99937011 * 1048576 },
      keldoFx: { code: 63542003, con: 0, loc: 16, seq: 1, desc: 63542003 * 1048576 },
      trapAct: { code: 98715423, con: 0, loc: 8, seq: 2, desc: 0 },
    };
  }, KELDO, MUDORA, KELBEK);
  await sleep(600);
}

async function ghostMetric(page, imgOpen, imgClosed, regionCss) {
  return page.evaluate(async (io, ic, rg) => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const [open, closed] = await Promise.all([load('/ev/' + io), load('/ev/' + ic)]);
    const S = 2;
    const rx = rg[0] * S, ry = rg[1] * S, rw = rg[2] * S, rh = rg[3] * S;
    const crop = (img) => { const c = document.createElement('canvas'); c.width = rw; c.height = rh; const x = c.getContext('2d'); x.drawImage(img, rx, ry, rw, rh, 0, 0, rw, rh); return x.getImageData(0, 0, rw, rh).data; };
    const A = crop(open), B = crop(closed);
    const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    let ma = 0, mb = 0, n = 0; const la = [], lb = [];
    for (let i = 0; i < A.length; i += 16) { const a = lum(A, i), b = lum(B, i); la.push(a); lb.push(b); ma += a; mb += b; n++; }
    ma /= n; mb /= n;
    let va = 0, vb = 0, cov = 0;
    for (let i = 0; i < n; i++) { va += (la[i] - ma) ** 2; vb += (lb[i] - mb) ** 2; cov += (la[i] - ma) * (lb[i] - mb); }
    return { stdOpen: +Math.sqrt(va / n).toFixed(2), stdClosed: +Math.sqrt(vb / n).toFixed(2), corr: +(cov / Math.sqrt(va * vb || 1)).toFixed(3) };
  }, imgOpen, imgClosed, regionCss).catch(e => ({ error: String(e) }));
}

/* ------------------------------ synth ------------------------------ */
async function synth() {
  const rep = { h1: { frames: [] }, h2: {}, h3: {} };
  const save = () => fs.writeFileSync(path.join(OUT, 'synth-report.json'), JSON.stringify(rep, null, 1));
  const { browser, page } = await launch('auto');
  await fabricate(page);
  // populate the preview strip (bright text under the dock's right side)
  await page.evaluate(() => { const s = document.querySelector('.slot[data-zone="1:4:0"]'); if (s) s.click(); });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'h1-board-closed.png') });

  // ---- H1: burst frames across the arrival animation (1 candidate)
  await page.evaluate(() => window.__dispatchChain([window.__entries.mudraFx], 63542003));
  await page.waitForFunction(() => document.getElementById('dock').className === 'on', { timeout: 15000 }).catch(() => {});
  const burst = [];
  for (let i = 0; i < 9; i++) {
    const f = 'h1-frame-' + i + '.png';
    await page.screenshot({ path: path.join(OUT, f) }).catch(() => {});
    burst.push(f);
    await sleep(30);
  }
  await sleep(600); // settled
  await page.screenshot({ path: path.join(OUT, 'h1-settled.png') });
  const dockRect = await page.evaluate(() => { const r = document.getElementById('dock').getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); });
  rep.h1.dockRect = dockRect;
  // ground region: right part of the dock, vertically centred so it is
  // inside the dock in every frame despite the 14px arrival shift
  const region = [dockRect[0] + 250, dockRect[1] + Math.min(150, Math.max(60, dockRect[3] - 130)), 120, 70];
  rep.h1.region = region;
  for (const f of burst.concat(['h1-settled.png'])) {
    rep.h1.frames.push({ file: f, ...(await ghostMetric(page, f, 'h1-board-closed.png', region)) });
    save();
  }
  // ---- H2a: single candidate geometry (settled)
  rep.h2.single = await page.evaluate(() => {
    const dk = document.getElementById('dock'); const dr = dk.getBoundingClientRect();
    const cand = dk.querySelector('.cand'); const cr = cand ? cand.getBoundingClientRect() : null;
    const act = dk.querySelector('.candact'); const ar = act ? act.getBoundingClientRect() : null;
    return { dock: [dr.left, dr.top, dr.width, dr.height].map(Math.round), cand: cr ? [cr.left, cr.top, cr.width, cr.height].map(Math.round) : null, candact: ar ? [ar.left, ar.top, ar.width, ar.height].map(Math.round) : null };
  });
  await page.evaluate(() => { const b = document.getElementById('chain-pass'); if (b) b.click(); });
  await sleep(700);

  // ---- H2b: tall dock — register a dismissal (duelsection), then a
  // 2-candidate prompt; pass row + pass note must fit fully at 620.
  await page.evaluate(() => window.__dispatchChain([window.__entries.mudraFx], 63542003));
  await page.waitForFunction(() => document.getElementById('dock').className === 'on', { timeout: 15000 }).catch(() => {});
  await sleep(400);
  await page.evaluate(() => { const b = document.querySelector('#dock [data-dueldismiss]'); if (b) b.click(); });
  await sleep(900);
  await page.evaluate(() => window.__dispatchChain([window.__entries.keldoFx, window.__entries.trapAct], 99937011));
  await page.waitForFunction(() => document.getElementById('dock').className === 'on', { timeout: 15000 }).catch(() => {});
  await sleep(800);
  rep.h2.tall = await page.evaluate(() => {
    const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); };
    const dk = document.getElementById('dock');
    const sub = dk.querySelector('.sub');
    const cands = dk.querySelector('.cands');
    return {
      dock: R(dk), pass: R(document.getElementById('chain-pass')), sub: R(sub),
      subText: sub ? sub.textContent : null,
      subFullyInViewport: sub ? (sub.getBoundingClientRect().bottom <= 620 && sub.getBoundingClientRect().top >= 0) : null,
      passInViewport: (() => { const p = document.getElementById('chain-pass'); if (!p) return null; const r = p.getBoundingClientRect(); return r.top >= 0 && r.bottom <= 620; })(),
      candWidths: [...dk.querySelectorAll('.cand')].map(c => Math.round(c.getBoundingClientRect().width)),
      hasDuelSection: !!dk.querySelector('.duelsection'),
      candsScroll: cands ? [cands.scrollHeight, cands.clientHeight] : null,
    };
  });
  await page.screenshot({ path: path.join(OUT, 'h2-tall.png') });
  save();
  await page.evaluate(() => { const b = document.getElementById('chain-pass'); if (b) b.click(); });
  await sleep(700);

  // ---- H3: mid-band geometry, default font environment
  rep.h3 = await page.evaluate(() => {
    const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { t: Math.round(r.top * 10) / 10, b: Math.round(r.bottom * 10) / 10, h: Math.round(r.height * 10) / 10 }; };
    const ll = document.getElementById('logline');
    ll.textContent = '相手：合体魔神－ゲート・ガーディアン を特殊召喚';
    const cs = getComputedStyle(ll);
    let textRect = null;
    try { const rg = document.createRange(); rg.selectNodeContents(ll); const rr = rg.getBoundingClientRect(); textRect = { t: Math.round(rr.top * 10) / 10, b: Math.round(rr.bottom * 10) / 10, h: Math.round(rr.height * 10) / 10 }; } catch (e) {}
    return { midbar: R(document.getElementById('midbar')), chainbar: R(document.getElementById('chainbar')), logline: R(ll), phasebar: R(document.getElementById('phasebar')), logFS: cs.fontSize, logLH: cs.lineHeight, textRect };
  });
  save();
  await browser.close();
  console.log('SYNTH DONE', JSON.stringify(rep.h1.frames), JSON.stringify(rep.h2), JSON.stringify(rep.h3));
}

/* ------------------------------ minfont ------------------------------ */
async function minfont() {
  const rep = {};
  const { browser, page } = await launch('auto', { userDataDir: '/tmp/chrome-minfont' });
  await page.click('#todeck');
  await page.waitForFunction(() => { const b = document.getElementById('startbtn'); return b && !b.disabled; }, { timeout: 30000 });
  await page.click('#startbtn');
  await sleep(2000);
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      const doc = document, q = (s, r) => (r || doc).querySelector(s);
      if (doc.getElementById('dock').className === 'on') { const p = q('#chain-pass'); if (p) p.click(); return; }
      if (doc.getElementById('sheetwrap').className === 'on') { const c = q('#sheet-cancel') || q('.optbtn:not(.disabled)'); if (c) c.click(); return; }
      const pb = doc.getElementById('phasebtn'); if (pb && !pb.disabled) { pb.click(); return; }
      const a = q('[data-act]'); if (a) a.click();
    }).catch(() => {});
    await sleep(900);
  }
  rep.geo = await page.evaluate(() => {
    const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { t: Math.round(r.top * 10) / 10, b: Math.round(r.bottom * 10) / 10, h: Math.round(r.height * 10) / 10 }; };
    const ll = document.getElementById('logline'); const cs = getComputedStyle(ll);
    let textRect = null;
    try { const rg = document.createRange(); rg.selectNodeContents(ll); const rr = rg.getBoundingClientRect(); textRect = { t: Math.round(rr.top * 10) / 10, b: Math.round(rr.bottom * 10) / 10, h: Math.round(rr.height * 10) / 10 }; } catch (e) {}
    return {
      ih: window.innerHeight, midbar: R(document.getElementById('midbar')), chainbar: R(document.getElementById('chainbar')),
      logline: R(ll), phasebar: R(document.getElementById('phasebar')), handbar: R(document.getElementById('handbar')),
      logFS: cs.fontSize, logLH: cs.lineHeight, logText: ll.textContent, textRect,
      prevlogText: (document.querySelector('#chainbar .prevlog') || {}).textContent || null,
    };
  });
  await page.screenshot({ path: path.join(OUT, 'minfont-board.png') });
  const mb = rep.geo.midbar;
  if (mb) await page.screenshot({ path: path.join(OUT, 'minfont-midband.png'), clip: { x: 0, y: Math.max(0, mb.t - 4), width: 390, height: mb.h + 8 } });
  fs.writeFileSync(path.join(OUT, 'minfont-report.json'), JSON.stringify(rep, null, 1));
  await browser.close();
  console.log('MINFONT DONE', JSON.stringify(rep.geo));
}

/* ------------------------------ live ------------------------------ */
async function live() {
  const { browser, page } = await launch('auto');
  await page.click('#todeck');
  await page.waitForFunction(() => { const b = document.getElementById('startbtn'); return b && !b.disabled; }, { timeout: 30000 });
  await page.click('#startbtn');
  const t0 = Date.now();
  let shot = 0, lastShot = 0, dockShots = 0, lastDock = false;
  while (Date.now() - t0 < MAXS * 1000) {
    const st = await page.evaluate(() => ({
      dockOn: document.getElementById('dock').className === 'on',
      result: document.getElementById('result').style.display === 'flex',
    })).catch(() => ({ dockOn: false, result: false }));
    if (st.result) { await page.screenshot({ path: path.join(OUT, 'live-result.png') }).catch(() => {}); break; }
    if (st.dockOn && !lastDock && dockShots < 3) {
      await sleep(1000); // settled dock
      await page.screenshot({ path: path.join(OUT, 'live-dock-' + dockShots + '.png') }).catch(() => {});
      dockShots++;
    }
    lastDock = st.dockOn;
    if (Date.now() - lastShot > 9000) {
      lastShot = Date.now();
      await page.screenshot({ path: path.join(OUT, 'live-' + String(shot++).padStart(2, '0') + '.png') }).catch(() => {});
    }
    await page.evaluate(() => {
      const doc = document, q = (s, r) => (r || doc).querySelector(s);
      const click = (el) => { if (el) { el.click(); return true; } return false; };
      if (doc.getElementById('dock').className === 'on') { click(q('#chain-pass')) || click(q('#dock [data-chain]')); return; }
      if (doc.getElementById('sheetwrap').className === 'on') {
        const sheet = doc.getElementById('sheet');
        const cok = q('#counter-confirm', sheet);
        if (q('[data-inc]', sheet) && cok && cok.disabled) return click(q('[data-inc]', sheet));
        if (cok && !cok.disabled) return click(cok);
        const gc = q('#grid-confirm', sheet); if (gc && !gc.disabled) return click(gc);
        if (click(q('[data-action-idx]', sheet))) return;
        if (click(q('[data-code]', sheet))) return;
        if (click(q('[data-pos]', sheet))) return;
        if (click(q('.posbtn', sheet))) return;
        if (click(q('#yn-yes', sheet))) return;
        if (click(q('[data-num]', sheet))) return;
        if (click(q('[data-bit]', sheet))) return;
        if (click(q('[data-unselect]', sheet))) return;
        if (click(q('#unselect-finish', sheet))) return;
        if (click(q('#sort-ok', sheet))) return;
        if (click(q('#fb-auto', sheet))) return;
        if (click(q('[data-pile-act]', sheet))) return;
        const g = q('[data-grid]:not(.sel)', sheet) || q('[data-grid]', sheet); if (click(g)) return;
        if (click(q('.optbtn:not(.disabled)', sheet))) return;
        if (click(q('#grid-cancel', sheet))) return;
        click(q('#sheet-cancel', sheet));
        return;
      }
      if (doc.getElementById('placehint').className === 'on') { click(q('.slot.hl')); return; }
      const pb = doc.getElementById('phasebtn');
      if (pb && !pb.disabled) { pb.click(); return; }
      click(q('[data-act]'));
    }).catch(() => {});
    await sleep(500);
  }
  await browser.close();
  console.log('LIVE DONE shots=' + shot + ' dockShots=' + dockShots);
}

(async () => {
  try { if (MODE === 'live') await live(); else if (MODE === 'minfont') await minfont(); else await synth(); }
  catch (e) { console.error('FATAL', e); process.exit(1); }
  process.exit(0);
})();
