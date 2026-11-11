'use strict';
/* cap-fxround3.js — FX/UI round 3 verification rig (G1/G2/G3/BU-15).
   Part S (synth): fabricated board + real uiAnswer prompts, 390x620.
     G1a dock translucency over a populated preview strip (pixel ghost
         metric via in-page canvas: std of the dock-open crop in a
         content-free region + correlation with the dock-closed crop)
     G1b peeked view sheet vs an arriving chain prompt (round-2 F4 gap:
         uiAnswer tested className === 'on', a peeked sheet is 'on peek')
     G2  tall dock geometry (3 visible candidates + duelsection)
     G3on resp 'on' (毎回): dismissal controls offered but inert (BU-32)
     BU15 autopass chip geometry vs preview / own szone / pilebar
   Part L (live): real duel (Ishizu vs GG, player first), resp 'auto'.
     Dismiss-on-first-sight autopilot: every chain prompt's rendered
     candidates are logged (name + effect line); any class the rig
     duel-dismissed that is rendered again is a spec violation.
   Usage: node cap-fxround3.js <serveRoot> <outDir> <synth|live> [maxSeconds] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] || 'synth';
const MAXS = +(process.argv[5] || 540);
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
const KELDO = 63542003, MUDORA = 99937011, KELBEK = 25926710, TRAPHOLE = 98715423, MCSOSEI = 28958464;

async function launch(resp) {
  await new Promise(r => server.listen(0, '127.0.0.1', r)).catch(() => {});
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
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

/* ------------------------------ synth ------------------------------ */
async function synth() {
  const rep = { g1a: {}, g1b: {}, g2: {}, g3on: {}, bu15: {} };
  const save = () => fs.writeFileSync(path.join(OUT, 'synth-report.json'), JSON.stringify(rep, null, 1));
  const { browser, page, port } = await launch('auto');

  // fabricated board (round-2 synth pattern)
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
      soseiAct: { code: 28958464, con: 0, loc: 2, seq: 3, desc: 0 },
    };
  }, KELDO, MUDORA, KELBEK);
  await sleep(600);

  // ---- G1a: preview populated, then a chain dock over it
  await page.evaluate(() => { const s = document.querySelector('.slot[data-zone="1:4:0"]'); if (s) s.click(); });
  await sleep(500);
  rep.g1a.preview = await page.evaluate(() => {
    const pv = document.getElementById('preview'); const r = pv.getBoundingClientRect();
    return { on: pv.className, rect: [r.left, r.top, r.width, r.height].map(Math.round), name: (pv.querySelector('.pv-name') || {}).textContent || '', textLen: ((pv.querySelector('.pv-text') || {}).textContent || '').length };
  });
  await page.screenshot({ path: path.join(OUT, 'g1a-preview.png') });
  await page.evaluate(() => window.__dispatchChain([window.__entries.mudraFx], 63542003));
  await page.waitForFunction(() => document.getElementById('dock').className === 'on', { timeout: 15000 }).catch(() => {});
  await sleep(900); // entrance animation (300ms) fully landed
  rep.g1a.dock = await page.evaluate(() => {
    const dk = document.getElementById('dock'); const r = dk.getBoundingClientRect();
    return { on: dk.className === 'on', bg: getComputedStyle(dk).backgroundColor, rect: [r.left, r.top, r.width, r.height].map(Math.round) };
  });
  await page.screenshot({ path: path.join(OUT, 'g1a-dock.png') });
  // ghost metric: content-free region inside the dock (right of the
  // single candidate, below the context line). Compare the dock-open
  // crop's luminance std (flat bg -> ~0) and its correlation with the
  // dock-closed crop of the same region (the underlying content).
  rep.g1a.ghost = await page.evaluate(async (dockRect) => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const [open, closed] = await Promise.all([load('/ev/g1a-dock.png'), load('/ev/g1a-preview.png')]);
    const S = 2; // deviceScaleFactor
    const rx = (dockRect[0] + 245) * S, ry = (dockRect[1] + 52) * S, rw = 130 * S, rh = 74 * S;
    const crop = (img) => { const c = document.createElement('canvas'); c.width = rw; c.height = rh; const x = c.getContext('2d'); x.drawImage(img, rx, ry, rw, rh, 0, 0, rw, rh); return x.getImageData(0, 0, rw, rh).data; };
    const A = crop(open), B = crop(closed);
    const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    let ma = 0, mb = 0, n = 0; const la = [], lb = [];
    for (let i = 0; i < A.length; i += 16) { const a = lum(A, i), b = lum(B, i); la.push(a); lb.push(b); ma += a; mb += b; n++; }
    ma /= n; mb /= n;
    let va = 0, vb = 0, cov = 0;
    for (let i = 0; i < n; i++) { va += (la[i] - ma) ** 2; vb += (lb[i] - mb) ** 2; cov += (la[i] - ma) * (lb[i] - mb); }
    return { stdOpen: Math.sqrt(va / n).toFixed(2), stdClosed: Math.sqrt(vb / n).toFixed(2), corr: (cov / Math.sqrt(va * vb || 1)).toFixed(3), regionCss: [dockRect[0] + 245, dockRect[1] + 52, 130, 74] };
  }, rep.g1a.dock.rect).catch(e => ({ error: String(e) }));
  save();
  await page.evaluate(() => { const b = document.getElementById('chain-pass'); if (b) b.click(); });
  await sleep(700);

  // ---- G1b: view sheet -> peek -> chain prompt arrives
  await page.evaluate(() => { const pv = document.getElementById('preview'); if (pv) pv.click(); });
  await sleep(600);
  rep.g1b.viewOpen = await page.evaluate(() => { const sw = document.getElementById('sheetwrap'); return { cls: sw.className, kind: sw.dataset.kind || null }; });
  await page.evaluate(() => { const b = document.getElementById('peekbtn'); if (b) b.click(); });
  await sleep(500);
  rep.g1b.peeked = await page.evaluate(() => { const sw = document.getElementById('sheetwrap'); return { cls: sw.className, kind: sw.dataset.kind || null }; });
  await page.screenshot({ path: path.join(OUT, 'g1b-peeked.png') });
  await page.evaluate(() => window.__dispatchChain([window.__entries.keldoFx], 99937011));
  await page.waitForFunction(() => document.getElementById('dock').className === 'on', { timeout: 15000 }).catch(() => {});
  await sleep(900);
  rep.g1b.afterDock = await page.evaluate(() => { const sw = document.getElementById('sheetwrap'); return { cls: sw.className, kind: sw.dataset.kind || null, dockOn: document.getElementById('dock').className === 'on' }; });
  await page.screenshot({ path: path.join(OUT, 'g1b-peek-dock.png') });
  save();
  await page.evaluate(() => { const b = document.getElementById('chain-pass'); if (b) b.click(); });
  await sleep(700);

  // ---- G2: dismiss Mudra (single-candidate prompt), then a tall dock
  await page.evaluate(() => window.__dispatchChain([window.__entries.mudraFx], 63542003));
  await page.waitForFunction(() => document.getElementById('dock').className === 'on', { timeout: 15000 }).catch(() => {});
  await sleep(400);
  await page.evaluate(() => { const b = document.querySelector('#dock [data-dueldismiss]'); if (b) b.click(); });
  await sleep(900); // flash auto-pass resolves the prompt
  rep.g2.afterDismiss = await page.evaluate(() => ({ dockOn: document.getElementById('dock').className === 'on', chip: document.getElementById('autopass').textContent }));
  await page.evaluate(() => window.__dispatchChain([window.__entries.mudraFx, window.__entries.keldoFx, window.__entries.trapAct, window.__entries.soseiAct], 63542003));
  await page.waitForFunction(() => document.getElementById('dock').className === 'on', { timeout: 15000 }).catch(() => {});
  await sleep(700);
  rep.g2.tall = await page.evaluate(() => {
    const dk = document.getElementById('dock'); const r = dk.getBoundingClientRect();
    const pass = document.getElementById('chain-pass'); const pr = pass ? pass.getBoundingClientRect() : null;
    const cands = dk.querySelector('.cands');
    return {
      dockRect: [r.left, r.top, r.width, r.height].map(Math.round),
      passRect: pr ? [pr.left, pr.top, pr.width, pr.height].map(Math.round) : null,
      passInViewport: pr ? (pr.top >= 0 && pr.bottom <= 620) : null,
      candCount: dk.querySelectorAll('.cand').length,
      hasDuelSection: !!dk.querySelector('.duelsection'),
      candsScroll: cands ? [cands.scrollHeight, cands.clientHeight, cands.scrollWidth, cands.clientWidth] : null,
      dockDisplay: getComputedStyle(dk).display, dockMaxHeight: getComputedStyle(dk).maxHeight,
    };
  });
  await page.screenshot({ path: path.join(OUT, 'g2-dock.png') });
  save();
  await page.evaluate(() => { const b = document.getElementById('chain-pass'); if (b) b.click(); });
  await sleep(700);

  // ---- G3on: resp 'on' — dismissal controls offered but inert (BU-32)
  await page.evaluate(() => { fxSettings.resp = 'on'; });
  await page.evaluate(() => window.__dispatchChain([window.__entries.keldoFx], 99937011));
  await page.waitForFunction(() => document.getElementById('dock').className === 'on', { timeout: 15000 }).catch(() => {});
  await sleep(500);
  rep.g3on.first = await page.evaluate(() => {
    const dk = document.getElementById('dock');
    return { candCount: dk.querySelectorAll('.cand').length, hasChainDismiss: !!dk.querySelector('[data-dismiss]'), hasDuelDismiss: !!dk.querySelector('[data-dueldismiss]'), note: (dk.querySelector('.respnote') || {}).textContent || null };
  });
  await page.screenshot({ path: path.join(OUT, 'g3on-dock.png') });
  if (rep.g3on.first.hasDuelDismiss) {
    await page.evaluate(() => { const b = document.querySelector('#dock [data-dueldismiss]'); if (b) b.click(); });
    await sleep(500);
    rep.g3on.afterDismissClick = await page.evaluate(() => ({ chip: document.getElementById('autopass').textContent, dockOn: document.getElementById('dock').className === 'on' }));
    await page.evaluate(() => { const b = document.getElementById('chain-pass'); if (b) b.click(); });
    await sleep(600);
    await page.evaluate(() => window.__dispatchChain([window.__entries.keldoFx], 99937011));
    await page.waitForFunction(() => document.getElementById('dock').className === 'on', { timeout: 15000 }).catch(() => {});
    await sleep(500);
    rep.g3on.second = await page.evaluate(() => ({ candCount: document.getElementById('dock').querySelectorAll('.cand').length, chip: document.getElementById('autopass').textContent }));
    await page.screenshot({ path: path.join(OUT, 'g3on-dock2.png') });
    await page.evaluate(() => { const b = document.getElementById('chain-pass'); if (b) b.click(); });
    await sleep(600);
  }

  // ---- BU15: chip geometry with a dismissal registered, dock closed
  await page.evaluate(() => { fxSettings.resp = 'auto'; updateAutoPassChip(); });
  await sleep(400);
  rep.bu15 = await page.evaluate(() => {
    const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? [r.left, r.top, r.width, r.height].map(Math.round) : null; };
    const inter = (a, b) => { if (!a || !b) return null; const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])); const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])); return [Math.round(ix), Math.round(iy)]; };
    const chip = document.getElementById('autopass');
    const out = { chipText: chip.textContent, chipClass: chip.className, chip: R(chip), preview: R(document.getElementById('preview')), topbar: R(document.getElementById('topbar')), turninfo: R(document.getElementById('turninfo')) };
    const sz = document.querySelector('#myField .zrow'); out.mySzoneRow = R(sz);
    const pb = document.querySelector('#myField .pilebar'); out.myPilebar = R(pb);
    out.overlaps = { preview: inter(out.chip, out.preview), szoneRow: inter(out.chip, out.mySzoneRow), pilebar: inter(out.chip, out.myPilebar), turninfo: inter(out.chip, out.turninfo) };
    out.chipInTopbar = !!(out.chip && out.topbar && out.chip[0] >= out.topbar[0] && out.chip[1] >= out.topbar[1] && out.chip[0] + out.chip[2] <= out.topbar[0] + out.topbar[2] && out.chip[1] + out.chip[3] <= out.topbar[1] + out.topbar[3]);
    return out;
  });
  await page.screenshot({ path: path.join(OUT, 'bu15-chip.png') });
  save();
  await browser.close();
  console.log('SYNTH DONE', JSON.stringify(rep, null, 1));
}

/* ------------------------------ live ------------------------------ */
async function live() {
  const rep = { docks: [], violations: [], dismissedClasses: [], chipTimeline: [], finished: false, stalled: false, fxError: null };
  const save = () => fs.writeFileSync(path.join(OUT, 'live-report.json'), JSON.stringify(rep, null, 1));
  const rigDismissed = new Set();
  const { browser, page } = await launch('auto');
  await page.click('#todeck');
  await page.waitForFunction(() => { const b = document.getElementById('startbtn'); return b && !b.disabled; }, { timeout: 30000 });
  await page.click('#startbtn');

  const t0 = Date.now();
  let lastSig = '', lastChange = Date.now(), lastSave = 0, lastChip = '', duels = 0;
  while (Date.now() - t0 < MAXS * 1000) {
    const snap = await page.evaluate(() => {
      const out = { dockOn: false, sheetOn: false, kind: null, placeOn: false, phaseEnabled: false, result: false, chip: '', cands: [] };
      try {
        out.fxerr = window.__fx && window.__fx.error;
        const dk = document.getElementById('dock'), sw = document.getElementById('sheetwrap');
        out.dockOn = dk.className === 'on';
        out.sheetOn = sw.className === 'on';
        out.kind = out.sheetOn ? (sw.dataset.kind || '') : null;
        out.placeOn = document.getElementById('placehint').className === 'on';
        out.phaseEnabled = !document.getElementById('phasebtn').disabled;
        out.result = document.getElementById('result').style.display === 'flex';
        out.chip = document.getElementById('autopass').textContent;
        if (out.dockOn) out.cands = [...dk.querySelectorAll('.cand')].map(c => ({
          idx: c.dataset.chain,
          name: (c.childNodes[0] ? c.childNodes[0].textContent : '').trim(),
          fx: (c.querySelector('.fxline') || { textContent: '' }).textContent.trim(),
          hasDuelBtn: !!c.querySelector('[data-dueldismiss]'),
        }));
      } catch (e) {}
      return out;
    }).catch(() => null);
    if (!snap) { await sleep(150); continue; }
    rep.fxError = snap.fxerr || null;
    if (snap.chip !== lastChip) { lastChip = snap.chip; rep.chipTimeline.push({ at: Math.round((Date.now() - t0) / 1000), chip: snap.chip }); }
    if (snap.result) {
      // one duel ended: record it and rematch (dismissal state is
      // per-duel, so the rig's dismissed set resets with it). Keep
      // going until the time budget ends or enough docks were seen —
      // a single passive-clicker duel may offer no chain window at
      // all, which says nothing about the suppression behaviour.
      duels++;
      rep.finished = true; rep.duels = duels;
      await page.screenshot({ path: path.join(OUT, 'live-duel' + duels + '-result.png') }).catch(() => {});
      rigDismissed.clear(); rep.dismissedClasses = []; lastSig = ''; lastChange = Date.now();
      save();
      if (rep.docks.length >= 6) break;
      await page.evaluate(() => { const b = document.getElementById('againbtn'); if (b) b.click(); }).catch(() => {});
      await sleep(2500);
      continue;
    }

    let acted = false;
    if (snap.dockOn) {
      const sig = snap.cands.map(c => c.name + '|' + c.fx).join(';;');
      if (sig !== lastSig) {
        lastSig = sig; lastChange = Date.now();
        const ev = { at: Math.round((Date.now() - t0) / 1000), candidates: snap.cands, dismissedNow: [] };
        for (const c of snap.cands) {
          const key = c.name + '|' + c.fx;
          if (rigDismissed.has(key)) {
            if (!rep.violations.some(v => v.key === key)) {
              rep.violations.push({ key, at: ev.at });
              await page.screenshot({ path: path.join(OUT, 'violation-' + rep.violations.length + '.png') }).catch(() => {});
            }
          } else if (c.hasDuelBtn) {
            rigDismissed.add(key); rep.dismissedClasses.push(key); ev.dismissedNow.push(key);
            await page.evaluate((idx) => { const b = document.querySelector('#dock [data-dueldismiss="' + idx + '"]'); if (b) b.click(); }, c.idx).catch(() => {});
            acted = true;
            await sleep(300);
          }
        }
        rep.docks.push(ev); save();
        await sleep(650); // a full dismissal set resolves via the flash path
        const still = await page.evaluate(() => document.getElementById('dock').className === 'on').catch(() => false);
        if (still) {
          await page.evaluate(() => { const b = document.getElementById('chain-pass'); if (b) { b.click(); return; } const c = document.querySelector('#dock [data-chain]'); if (c) c.click(); }).catch(() => {});
          acted = true;
        }
      }
    } else if (snap.sheetOn) {
      lastSig = '';
      acted = await page.evaluate(() => {
        const doc = document, q = (s, r) => (r || doc).querySelector(s);
        const sheet = doc.getElementById('sheet');
        const click = (el) => { if (el) { el.click(); return true; } return false; };
        const inc = q('[data-inc]', sheet), cok = q('#counter-confirm', sheet);
        if (inc && cok && cok.disabled) return click(inc);
        if (cok && !cok.disabled) return click(cok);
        const gc = q('#grid-confirm', sheet); if (gc && !gc.disabled) return click(gc);
        if (click(q('[data-action-idx]', sheet))) return true;
        if (click(q('[data-code]', sheet))) return true;
        if (click(q('[data-pos]', sheet))) return true;
        if (click(q('.posbtn', sheet))) return true;
        if (click(q('#yn-yes', sheet))) return true;
        if (click(q('[data-num]', sheet))) return true;
        if (click(q('[data-bit]', sheet))) return true;
        if (click(q('[data-unselect]', sheet))) return true;
        if (click(q('#unselect-finish', sheet))) return true;
        if (click(q('#sort-ok', sheet))) return true;
        if (click(q('#fb-auto', sheet))) return true;
        if (click(q('[data-pile-act]', sheet))) return true;
        const g = q('[data-grid]:not(.sel)', sheet) || q('[data-grid]', sheet); if (click(g)) return true;
        if (click(q('.optbtn:not(.disabled)', sheet))) return true;
        if (click(q('#grid-cancel', sheet))) return true;
        if (click(q('#sheet-cancel', sheet))) return true;
        return false;
      }).catch(() => false);
      if (acted) lastChange = Date.now();
    } else if (snap.placeOn) {
      lastSig = '';
      acted = await page.evaluate(() => { const s = document.querySelector('.slot.hl'); if (s) { s.click(); return true; } return false; }).catch(() => false);
      if (acted) lastChange = Date.now();
    } else if (snap.phaseEnabled) {
      lastSig = '';
      acted = await page.evaluate(() => { const b = document.getElementById('phasebtn'); if (b && !b.disabled) { b.click(); return true; } return false; }).catch(() => false);
      if (acted) lastChange = Date.now();
    } else {
      lastSig = '';
      acted = await page.evaluate(() => { const b = document.querySelector('[data-act]'); if (b) { b.click(); return true; } return false; }).catch(() => false);
      if (acted) lastChange = Date.now();
    }
    if (Date.now() - lastSave > 15000) { lastSave = Date.now(); save(); }
    if (Date.now() - lastChange > 90000) { rep.stalled = true; await page.screenshot({ path: path.join(OUT, 'live-stalled.png') }).catch(() => {}); save(); break; }
    await sleep(160);
  }
  save();
  await browser.close();
  console.log('LIVE DONE finished=' + rep.finished + ' docks=' + rep.docks.length + ' dismissed=' + rep.dismissedClasses.length + ' violations=' + rep.violations.length);
}

(async () => {
  try { if (MODE === 'live') await live(); else await synth(); }
  catch (e) { console.error('RIG FATAL', e); process.exit(2); }
  process.exit(0);
})();
