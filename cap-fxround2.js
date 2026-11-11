'use strict';
/* cap-fxround2.js — FX/UI round 2 verification rig.
   One real duel (player = Ishizu, CPU = GG, player first, chain
   response mode 'on' so chain docks actually appear), 390x620.
   Targeted captures + geometry probes for F1..F7:
     F1 phase banner frames while a phase scene is live
     F2 first text-bearing selection grids: screenshot + tile geometry
     F3 chain dock: screenshot, [data-act] presence, button answers
     F4 detail pop left open -> next prompt must close it
     F5 ace scene: #fxcutin .cs text sampled across the scene
     F6a my damage number / red chip rects vs #logline rect
     F6b round FX elements vs opponent deck-chip rect intersections
     F7 attack-target sheet: DOM candidate count vs board state
   Usage: node cap-fxround2.js <repoRoot> <outDir> [maxSeconds] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');
const ROOT = path.resolve(process.argv[2]);
const OUT = process.argv[3];
const MAXS = +(process.argv[4] || 420);
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.m4a': 'audio/m4a', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rep = { f1: 0, f2: [], f3: [], f4: null, f5: null, f6a: [], f6b: [], f7: [], fxError: null, finished: false, diag: { f4try: 0, f4open: 0, docks: 0, cpuSnaps: 0 } };
let prevDockOn = false;
const saveRep = () => fs.writeFileSync(path.join(OUT, 'round2-report.json'), JSON.stringify(rep, null, 1));

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 160)));
  const REMATCH = process.argv[5] || ''; // 'my:op:first' -> auto-start via the rematch restore
  await page.evaluateOnNewDocument((rm) => {
    try {
      localStorage.setItem('v2fx', JSON.stringify({ cutin: true, resp: 'on' }));
      if (rm) { const [my, op, first] = rm.split(':'); sessionStorage.setItem('v3rematch', JSON.stringify({ my, op, first })); }
    } catch (e) {}
    window.__capHold = false;
  }, REMATCH);
  await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
  if (!REMATCH) {
    await page.click('#todeck');
    await page.waitForFunction(() => { const b = document.getElementById('startbtn'); return b && !b.disabled; }, { timeout: 30000 });
    await page.click('#startbtn');
  } else {
    await sleep(4000); // the rematch restore clicks start itself
  }

  const t0 = Date.now();
  let lastSave = 0;
  let f4stage = 0, f4since = 0, f4clicked = false; // 0 idle, 1 view opened (watching the next dispatch), 2 done
  let f3acted = false;
  let lastPhaseShot = 0, lastDmgShot = 0;
  const f6bSeen = new Set();

  while (Date.now() - t0 < MAXS * 1000) {
    const snap = await page.evaluate(() => {
      const out = { scenes: [], sheetOn: false, dockOn: false, kind: null, result: false, now: 0, fxerr: null };
      try {
        out.scenes = window.__fx.scenes();
        out.now = window.__fx.now();
        out.fxerr = window.__fx.error;
        const sw = document.getElementById('sheetwrap'), dk = document.getElementById('dock');
        out.sheetOn = !!sw && sw.className === 'on';
        out.dockOn = !!dk && dk.className === 'on';
        out.kind = out.sheetOn ? ('sheet:' + (sw.dataset.kind || '')) : (out.dockOn ? 'dock' : null);
        out.result = document.getElementById('result').style.display === 'flex';
      } catch (e) {}
      return out;
    }).catch(() => null);
    if (!snap) { await sleep(150); continue; }
    rep.fxError = snap.fxerr;
    if (snap.dockOn && !prevDockOn) rep.diag.docks++;
    prevDockOn = snap.dockOn;
    if (Date.now() - lastSave > 20000) { lastSave = Date.now(); saveRep(); } // periodic: a timeout kill must not lose the evidence
    if (snap.result) { rep.finished = true; saveRep(); break; }

    // ---- F6b probe: round FX elements vs opponent deck chip
    const probe = await page.evaluate(() => {
      const chip = document.querySelector('[data-pile="deck:1"]');
      if (!chip) return [];
      const cr = chip.getBoundingClientRect();
      const hits = [];
      const els = document.querySelectorAll('#fxlayer *, #fxcutin *');
      for (const el of els) {
        const cs = getComputedStyle(el);
        const round = (cs.borderRadius || '').includes('50%') || /fx3-portal|fx-portal|vortex|ring|fx3-core/.test(el.className || '');
        if (!round) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        if (parseFloat(cs.opacity || '1') < 0.15) continue;
        const ix = Math.max(0, Math.min(r.right, cr.right) - Math.max(r.left, cr.left));
        const iy = Math.max(0, Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top));
        if (ix > 2 && iy > 2) hits.push({ cls: String(el.className), rect: [r.left, r.top, r.width, r.height].map(Math.round), chip: [cr.left, cr.top, cr.width, cr.height].map(Math.round), overlap: [Math.round(ix), Math.round(iy)] });
      }
      return hits;
    }).catch(() => []);
    for (const h of probe || []) {
      const k = h.cls + '|' + h.rect.join(',');
      if (!f6bSeen.has(k)) { f6bSeen.add(k); if (rep.f6b.length < 24) rep.f6b.push(h); }
    }

    // ---- F1: phase banner while live
    const phaseLive = snap.scenes.some(s => s.kind === 'phase');
    if (phaseLive && rep.f1 < 5 && Date.now() - lastPhaseShot > 2600) {
      const vis = await page.evaluate(() => { const b = document.querySelector('#fxlayer .fx-phase'); return b ? parseFloat(b.style.opacity || '0') : 0; }).catch(() => 0);
      if (vis > 0.4) {
        lastPhaseShot = Date.now();
        await page.screenshot({ path: path.join(OUT, 'f1-phase-' + (rep.f1++) + '.png') }).catch(() => {});
      }
    }

    // ---- F5: ace scene .cs sampling
    const aceLive = snap.scenes.find(s => s.kind === 'ace');
    if (aceLive && !rep.f5) {
      rep.f5 = { t0: aceLive.t0, samples: [] };
      for (let i = 0; i < 7; i++) {
        const cs = await page.evaluate(() => { const e = document.querySelector('#fxcutin .cs'); return e ? e.textContent : null; }).catch(() => null);
        rep.f5.samples.push({ atMs: Math.round((Date.now() - t0)), cs });
        if (i === 3) await page.screenshot({ path: path.join(OUT, 'f5-ace-mid.png') }).catch(() => {});
        if (i === 6) await page.screenshot({ path: path.join(OUT, 'f5-ace-late.png') }).catch(() => {});
        await sleep(260);
      }
      saveRep();
    }

    // ---- F6a: my damage number / red chip vs logline
    if (Date.now() - lastDmgShot > 3000 && rep.f6a.length < 3) {
      const dmg = await page.evaluate(() => {
        const ll = document.getElementById('logline'); if (!ll) return null;
        const lr = ll.getBoundingClientRect();
        const out = { logline: [lr.left, lr.top, lr.width, lr.height].map(Math.round), logText: ll.textContent, hits: [] };
        for (const el of document.querySelectorAll('.fx3-dmgnum, .fx3-lpchip')) {
          const r = el.getBoundingClientRect();
          if (r.width < 4) continue;
          const cs = getComputedStyle(el);
          if (parseFloat(cs.opacity || '1') < 0.2) continue;
          const ix = Math.max(0, Math.min(r.right, lr.right) - Math.max(r.left, lr.left));
          const iy = Math.max(0, Math.min(r.bottom, lr.bottom) - Math.max(r.top, lr.top));
          out.hits.push({ cls: String(el.className), text: el.textContent, rect: [r.left, r.top, r.width, r.height].map(Math.round), overlapWithLogline: [Math.round(ix), Math.round(iy)] });
        }
        return out.hits.length ? out : null;
      }).catch(() => null);
      if (dmg) {
        lastDmgShot = Date.now();
        rep.f6a.push(dmg);
        await page.screenshot({ path: path.join(OUT, 'f6a-dmg-' + rep.f6a.length + '.png') }).catch(() => {});
        saveRep();
      }
    }

    // ---- F2 / F7: sheets
    if (snap.sheetOn) {
      const sheetInfo = await page.evaluate(() => {
        const sh = document.getElementById('sheet');
        const ttl = sh.querySelector('.ttl');
        const grid = sh.querySelector('.grid');
        const cards = sh.querySelectorAll('.gcard');
        const itext = sh.querySelector('.gcard .itext');
        const out = { title: ttl ? ttl.textContent : '', cards: cards.length, hasText: !!itext, scrollH: sh.scrollHeight, clientH: sh.clientHeight, cueVisible: (() => { const c = sh.querySelector('#gridmore'); return c ? getComputedStyle(c).display !== 'none' : null; })() };
        if (cards.length && itext) {
          const t = cards[0].getBoundingClientRect();
          const it = itext.getBoundingClientRect();
          const loc = cards[0].querySelector('.loc');
          const nm = cards[0].querySelector('.nm');
          const lr = loc ? loc.getBoundingClientRect() : null;
          const nr = nm ? nm.getBoundingClientRect() : null;
          out.tile = [t.width, t.height].map(Math.round);
          out.itextFont = getComputedStyle(itext).fontSize;
          out.itextRect = [it.left, it.top, it.width, it.height].map(Math.round);
          out.locRect = lr ? [lr.left, lr.top, lr.width, lr.height].map(Math.round) : null;
          out.nmRect = nr ? [nr.left, nr.top, nr.width, nr.height].map(Math.round) : null;
          out.locOverlapsNm = !!(lr && nr && lr.bottom > nr.top && lr.left < nr.right && nr.left < lr.right);
        }
        if (grid) out.gridCols = getComputedStyle(grid).gridTemplateColumns;
        return out;
      }).catch(() => null);
      if (sheetInfo) {
        if (sheetInfo.hasText && sheetInfo.cards > 0 && rep.f2.length < 3) {
          await page.evaluate(() => { window.__capHold = true; });
          await sleep(500);
          await page.screenshot({ path: path.join(OUT, 'f2-grid-' + rep.f2.length + '.png') }).catch(() => {});
          rep.f2.push(sheetInfo); saveRep();
          await page.evaluate(() => { window.__capHold = false; });
        }
        if (/の攻撃/.test(sheetInfo.title) && rep.f7.length < 3) {
          const board = await page.evaluate(() => {
            try {
              const P = duelState.players[1];
              return { oppMzone: P.mzone.map(c => c ? { code: c.code, pos: c.pos } : null) };
            } catch (e) { return null; }
          }).catch(() => null);
          await page.evaluate(() => { window.__capHold = true; });
          await sleep(400);
          await page.screenshot({ path: path.join(OUT, 'f7-attack-' + rep.f7.length + '.png') }).catch(() => {});
          rep.f7.push({ sheet: sheetInfo, board }); saveRep();
          await page.evaluate(() => { window.__capHold = false; });
        }
      }
    }

    // ---- F3: chain dock
    if (snap.dockOn && rep.f3.length < 2) {
      const dockInfo = await page.evaluate(() => {
        const dk = document.getElementById('dock');
        const cands = dk.querySelectorAll('[data-chain]');
        const act = dk.querySelector('[data-chainact]');
        return { cands: cands.length, hasActBtn: !!act, actLabel: act ? act.textContent : null, ctx: (dk.querySelector('.ctx') || {}).textContent || '' };
      }).catch(() => null);
      if (dockInfo && dockInfo.cands > 0) {
        await page.evaluate(() => { window.__capHold = true; });
        await sleep(450);
        await page.screenshot({ path: path.join(OUT, 'f3-dock-' + rep.f3.length + '.png') }).catch(() => {});
        rep.f3.push(dockInfo); saveRep();
        await page.evaluate(() => { window.__capHold = false; });
        if (!f3acted) {
          f3acted = true;
          // answer THIS dock with the explicit button when present
          await page.evaluate(() => {
            const act = document.querySelector('#dock [data-chainact]');
            if (act) { act.click(); window.__f3via = 'button'; }
            else { const c = document.querySelector('#dock [data-chain]'); if (c) { c.click(); window.__f3via = 'box'; } }
          }).catch(() => {});
          await sleep(1200);
          const closed = await page.evaluate(() => document.getElementById('dock').className !== 'on').catch(() => null);
          rep.f3.push({ answeredViaButtonTest: closed, via: await page.evaluate(() => window.__f3via).catch(() => null) });
          saveRep();
        }
      }
    }

    // ---- F4: open the card-detail VIEW sheet (board tap -> preview
    // -> preview tap -> openCardInfo), then watch the next prompt:
    // the view (and any info pop) must not survive into it.
    if (f4stage === 0 && !snap.sheetOn && !snap.dockOn) {
      // staging on the CPU's turn: the defect window is a view
      // opened AFTER the last answer (finishPrompt closes sheets),
      // with the next prompt arriving on its own. The log-history
      // VIEW opens from the log line at any time.
      const cpuTurn = await page.evaluate(() => { try { return duelState && duelState.turnPlayer === 1; } catch (e) { return false; } }).catch(() => false);
      if (cpuTurn) rep.diag.cpuSnaps++;
      if (cpuTurn) {
        rep.diag.f4try++;
        await page.evaluate(() => { const l = document.getElementById('logline'); if (l) l.click(); }).catch(() => {});
        await sleep(450);
        const view = await page.evaluate(() => {
          const sw = document.getElementById('sheetwrap');
          return { on: sw.className === 'on', kind: sw.dataset.kind || null, pop: document.getElementById('infopop').className === 'on' };
        }).catch(() => null);
        if (view && view.on && view.kind === 'view') {
          rep.diag.f4open++;
          f4stage = 1; f4since = Date.now();
          await page.evaluate(() => { window.__capHold = true; }); // nobody touches the view while we wait
          await page.screenshot({ path: path.join(OUT, 'f4-view-open.png') }).catch(() => {});
        }
      }
    } else if (f4stage === 1) {
      if (snap.dockOn) {
        // the chain dock arrived while the view was open: record
        // whether the view (and pop) survived into it
        const st = await page.evaluate(() => {
          const sw = document.getElementById('sheetwrap');
          return { sheetOn: sw.className === 'on', sheetKind: sw.dataset.kind || null, closing: sw.dataset.closing || null, pop: document.getElementById('infopop').className === 'on', dockOn: true };
        }).catch(() => null);
        rep.f4 = { atDock: st };
        await page.screenshot({ path: path.join(OUT, 'f4-prompt.png') }).catch(() => {});
        await page.evaluate(() => { window.__capHold = false; });
        f4stage = 2; saveRep();
      } else if (!snap.sheetOn && !snap.dockOn) {
        // the view vanished with no prompt UI arriving — count it
        // and retry (tells us views open but do not survive)
        rep.diag.f4lost = (rep.diag.f4lost || 0) + 1;
        await page.evaluate(() => { window.__capHold = false; });
        f4stage = 0; saveRep();
      } else if (snap.kind === 'sheet:prompt' || Date.now() - f4since > 90000) {
        // a sheet prompt consumed the view (no defect there), or
        // no dock came: release and retry on a later CPU turn
        if (Date.now() - f4since > 90000) rep.f4 = { timedOutWaitingDock: true };
        await page.evaluate(() => { window.__capHold = false; });
        f4stage = snap.kind === 'sheet:prompt' ? 0 : 2; saveRep();
      }
    }

    // ---- F7 assist: in my battle phase, tap my face-up attacker
    // and pick 攻撃 so the target sheet actually opens
    if (rep.f7.length < 3 && !snap.sheetOn && !snap.dockOn) {
      const did = await page.evaluate(() => {
        const pi = document.getElementById('phaseinfo');
        if (!pi || !pi.textContent.includes('バトル')) return 'nophase';
        try {
          const P = duelState.players[0];
          for (let s = 0; s < 7; s++) {
            const c = P.mzone[s];
            if (c && c.code != null && c.pos === 1) {
              const el = document.querySelector('.slot[data-zone="0:4:' + s + '"]');
              if (el) { el.click(); return 'tapped'; }
            }
          }
        } catch (e) { return 'err'; }
        return 'nomon';
      }).catch(() => 'x');
      if (did === 'tapped') {
        await sleep(550);
        const atk = await page.evaluate(() => {
          const sw = document.getElementById('sheetwrap');
          if (!sw || sw.className !== 'on') return 'nosheet';
          const btns = [...document.querySelectorAll('#sheet [data-action-idx], #sheet button, #sheet .optbtn')];
          const b = btns.find(x => { const t = (x.textContent || '').trim(); return t === '攻撃' || t.startsWith('攻撃'); });
          if (b) { b.click(); return 'attacked'; }
          const c = document.getElementById('sheet-cancel'); if (c) c.click();
          return 'noatk';
        }).catch(() => 'x');
        if (atk === 'attacked') await sleep(500);
      }
    }

    // ---- clicker (round-1 discipline + hold gate + F3 button)
    await page.evaluate(() => {
      if (window.__capHold) return;
      const doc = document;
      const $ = (id) => doc.getElementById(id);
      const q = (sel, root) => (root || doc).querySelector(sel);
      const click = (el) => { if (el) el.click(); };
      if ($('result').style.display === 'flex') return;
      const sheetOn = $('sheetwrap').className === 'on';
      const dockOn = $('dock').className === 'on';
      // NOTE (round-2 lesson): the clicker never taps board tiles
      // ([data-act]) — that is the round-1 discipline that keeps
      // duels completing. Tapping tiles stalls the duel (info-view
      // loops on actionless monsters, preview taps on opponent
      // tiles), which starved every capture in several runs.
      if (sheetOn) {
        const sheet = $('sheet');
        const inc = q('[data-inc]', sheet);
        const counterOk = q('#counter-confirm', sheet);
        if (inc && counterOk && counterOk.disabled) click(inc);
        else if (counterOk && !counterOk.disabled) click(counterOk);
        else if (q('#grid-confirm', sheet) && !q('#grid-confirm', sheet).disabled) click(q('#grid-confirm', sheet));
        else if (q('[data-action-idx]', sheet)) click(q('[data-action-idx]', sheet));
        else if (q('[data-code]', sheet)) click(q('[data-code]', sheet));
        else if (q('[data-pos]', sheet)) click(q('[data-pos]', sheet));
        else if (q('.posbtn', sheet)) click(q('.posbtn', sheet));
        else if (q('#yn-yes', sheet)) click(q('#yn-yes', sheet));
        else if (q('[data-num]', sheet)) click(q('[data-num]', sheet));
        else if (q('[data-bit]', sheet)) click(q('[data-bit]', sheet));
        else if (q('[data-unselect]', sheet)) click(q('[data-unselect]', sheet));
        else if (q('#unselect-finish', sheet)) click(q('#unselect-finish', sheet));
        else if (q('#sort-ok', sheet)) click(q('#sort-ok', sheet));
        else if (q('#fb-auto', sheet)) click(q('#fb-auto', sheet));
        else if (q('[data-pile-act]', sheet)) click(q('[data-pile-act]', sheet));
        else if (q('[data-grid]:not(.sel)', sheet) || q('[data-grid]', sheet)) click(q('[data-grid]:not(.sel)', sheet) || q('[data-grid]', sheet));
        else if (q('.optbtn:not(.disabled)', sheet)) click(q('.optbtn:not(.disabled)', sheet));
        else if (q('#grid-cancel', sheet)) click(q('#grid-cancel', sheet));
        else if (q('#sheet-cancel', sheet)) click(q('#sheet-cancel', sheet));
      } else if (dockOn) {
        click(q('#dock [data-act]') || q('#chain-pass', $('dock')) || q('[data-chain]', $('dock')));
      } else if ($('placehint').className === 'on') {
        click(q('.slot.hl'));
      } else if (!$('phasebtn').disabled) {
        click($('phasebtn'));
      }
    }).catch(() => {});
    await sleep(170);
  }
  saveRep();
  console.log(JSON.stringify({ finished: rep.finished, f1: rep.f1, f2: rep.f2.length, f3: rep.f3, f4: rep.f4, f5: rep.f5 && rep.f5.samples, f6a: rep.f6a.length, f6b: rep.f6b.length, f7: rep.f7.length, fxError: rep.fxError }, null, 1));
  await browser.close(); server.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
