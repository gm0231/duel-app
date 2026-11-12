'use strict';
/* cap-m1-live.js — M1 live-flow reproduction rig (v2).
 * Plays REAL duels (Ishizu vs GG, human side) with a trap-seeking
 * clicker: sets 墓守の罠 from hand at the first chance, activates
 * its ② at the next chance, then the MOMENT the discard sheet
 * appears it measures the FIRST render (same MEASURE as
 * cap-layoutfix5.js) BEFORE any peek toggle, and screenshots it.
 * Progress is appended to a log file (unbuffered) so it can be
 * watched while the process runs.
 * Usage: node cap-m1-live.js <serveRoot> <outDir> [maxDuels] [maxSeconds] */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');
const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MAXDUELS = +(process.argv[4] || 8);
const MAXS = +(process.argv[5] || 900);
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'm1live-progress.log');
const log = (s) => { const line = new Date().toISOString().slice(11, 19) + ' ' + s + '\n'; fs.appendFileSync(LOG, line); console.log(s); };
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
const TRAP = 98715423;

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
    return { i, rect: R(t), sel: t.classList.contains('sel'),
      bottomInside: r.bottom <= vh + 0.6,
      centreHit: topEl ? (topEl.closest('.gcard') ? 'tile' : (topEl.id || topEl.className || topEl.tagName)) : 'none',
      nmRect: nmR ? { t: +nmR.top.toFixed(1), b: +nmR.bottom.toFixed(1) } : null,
      nmHit: topNm ? (topNm.closest('.gcard') ? 'tile' : (topNm.id || topNm.className || topNm.tagName)) : 'none' };
  });
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
    sheetClass: sheet ? sheet.className : null, sheetRect: R(sheet),
    sheetMaxH: sheet ? getComputedStyle(sheet).maxHeight : null,
    scRect: sc ? R(sc) : null, scrollProbe,
    tiles: tilesGeom.length, tilesGeom,
    detailInside: detail.map(d => { const r = d.getBoundingClientRect(); return r.bottom <= vh + 0.6; }),
    confirm: conf ? { disabled: conf.disabled, rect: R(conf), label: conf.textContent.trim() } : null,
    cancel: !!document.getElementById('grid-cancel'),
    gridmoreVisible: (() => { const g = document.getElementById('gridmore'); return g ? getComputedStyle(g).display !== 'none' : null; })(),
    peekText: (document.getElementById('peekbtn') || {}).textContent || null,
    sheetHTMLlen: sheet ? sheet.innerHTML.length : 0,
  };
};

// One clicker step, run in-page. Returns a short status string.
const STEP = () => {
  const doc = document, q = (s, r) => (r || doc).querySelector(s);
  // Only click what a human could tap: a display:none button
  // (e.g. #sheetx, which CSS shows for view sheets only) must
  // never be "clicked" by script — doing so closed a prompt sheet
  // with the prompt still pending and stranded the duel.
  const click = (el) => { if (el && el.offsetParent !== null) { el.click(); return true; } return false; };
  const TRAP = 98715423;
  const txt = (el) => (el ? (el.textContent || '') : '');
  window.__m1 = window.__m1 || {};
  if (doc.getElementById('result').style.display === 'flex') return 'result';
  const sh = doc.getElementById('sheet');
  if (doc.getElementById('sheetwrap').classList.contains('on') && sh) {
    const purpose = txt(q('.purpose', sh));
    // TARGET is the trap's own discard cost: purpose + trap context.
    // Other discards (e.g. 丘①'s cost) are answered and the duel goes on.
    if (purpose.includes('捨てるカードを選択') && txt(sh).includes('墓守の罠')) return 'TARGET:' + (sh.querySelectorAll('.gcard').length) + 'tiles';
    const ttl = txt(q('.ttl', sh));
    if (ttl.includes('墓守の罠')) {
      const btns = [...sh.querySelectorAll('.optbtn:not(.disabled)')];
      const setBtn = btns.find(b => txt(b).includes('セット'));
      const actBtn = btns.find(b => txt(b).includes('発動'));
      if (actBtn) { actBtn.click(); return 'trap-activate'; }
      if (setBtn) { setBtn.click(); return 'trap-set'; }
      // nothing usable this turn: remember, so we advance the phase instead of re-opening
      window.__m1.trapClosed = true;
      if (click(q('#sheet-cancel', sh))) return 'trap-sheet-close';
      return 'trap-sheet-idle';
    }
    // announce sheet: tiles carry data-code (not data-grid); a tap
    // only selects, #announce-ok declares
    if (q('#announce-ok', sh)) {
      const ok = q('#announce-ok', sh);
      if (!ok.disabled) { ok.click(); return 'announce-ok'; }
      const card = q('.gcard[data-code]:not(.sel)', sh);
      if (card) { card.click(); return 'announce-pick'; }
      return 'announce-idle';
    }
    if (q('[data-grid]', sh)) {
      const gc = q('#grid-confirm', sh);
      if (gc && !gc.disabled) { gc.click(); return 'grid-confirm'; }
      // avoid discarding the trap as a cost: prefer a non-trap tile
      const tiles = [...sh.querySelectorAll('[data-grid]:not(.sel)')];
      const nonTrap = tiles.find(t => !(t.querySelector('.nmtext') || {}).textContent || !(t.querySelector('.nmtext').textContent.includes('墓守の罠')));
      const card = nonTrap || tiles[0];
      if (card) { card.click(); return 'grid-pick'; }
      if (click(q('#grid-cancel', sh))) return 'grid-cancel';
      return 'grid-idle';
    }
    if (q('[data-unselect]', sh)) {
      const fin = q('#unselect-finish', sh);
      if (fin) { fin.click(); return 'unselect-finish'; }
      if (click(q('[data-unselect]:not(.sel)', sh))) return 'unselect-pick';
      if (click(q('#unselect-cancel', sh))) return 'unselect-cancel';
      return 'unselect-idle';
    }
    // counter sheet: raise the first counter until confirm enables
    if (q('[data-inc]', sh)) {
      const cc = q('#counter-confirm', sh);
      if (cc && !cc.disabled) { cc.click(); return 'counter-confirm'; }
      if (click(q('[data-inc]', sh))) return 'counter-inc';
      return 'counter-idle';
    }
    if (click(q('#sort-ok', sh))) return 'sort-ok';
    // generic option sheet: prefer an attack, then a normal summon,
    // then setting (defence) — the clicker plays to finish the duel
    // quickly so more duels reach the trap's turn; otherwise first.
    {
      const opts = [...sh.querySelectorAll('.optbtn:not(.disabled)')];
      const atk = opts.find(b => txt(b).trim() === '攻撃');
      const summon = opts.find(b => txt(b).includes('通常召喚'));
      const setOpt = opts.find(b => txt(b).includes('セット'));
      const pick = atk || summon || setOpt || opts[0];
      if (pick) { pick.click(); return 'optbtn' + (pick === atk ? '-atk' : pick === summon ? '-summon' : pick === setOpt ? '-set' : ''); }
    }
    if (click(q('.posbtn', sh))) return 'posbtn';
    if (click(q('.bigbtn:not([disabled])', sh))) return 'bigbtn';
    if (click(q('#sheet-cancel', sh))) return 'sheet-cancel';
    if (click(q('#sheetx'))) return 'sheet-x';
    return 'sheet-idle';
  }
  if (doc.getElementById('dock').className === 'on') {
    if (click(q('#chain-pass'))) return 'dock-pass';
    if (click(q('#dock [data-chain]'))) return 'dock-chain';
    return 'dock-idle';
  }
  // Board clicks only open an action sheet while an IDLE/BATTLE
  // prompt is live (client.js triage-#2: otherwise the tap is only
  // buffered). Outside that window we just wait for the engine.
  // NOTE: currentPrompt / duelState are top-level `let` bindings,
  // so they are bare globals here — NOT window.* properties.
  const cp = (typeof currentPrompt !== 'undefined') ? currentPrompt : null;
  const cpName = cp ? cp.prompt.name : null;
  // SELECT_PLACE / SELECT_DISFIELD: tap a highlighted zone
  if (cpName === 'SELECT_PLACE' || cpName === 'SELECT_DISFIELD') {
    const z = doc.querySelector('[data-zone].hl') || doc.querySelector('[data-zone].picked');
    if (z) { z.click(); return 'place'; }
    const any = doc.querySelector('[data-zone]');
    if (any) { any.click(); return 'place-any'; }
    return 'place-wait';
  }
  if (cpName === 'SELECT_IDLECMD' || cpName === 'SELECT_BATTLECMD') {
    const st = (typeof duelState !== 'undefined') ? duelState : null;
    const turn = st ? st.turnCount : 0;
    if (window.__m1.turn !== turn) { window.__m1 = { turn, trapClosed: false }; }
    const trapEl = (() => {
      // in hand: the hand card carries data-code; on the field the
      // slot template has NO data-code, so find it via state and
      // its action key (con:loc:seq, SZONE = 8).
      const inHand = doc.querySelector('[data-code="' + TRAP + '"]');
      if (inHand) return inHand;
      const hp = (typeof HP !== 'undefined') ? HP : 0;
      const sz = st && st.players[hp] ? st.players[hp].szone : null;
      if (!sz) return null;
      const seq = sz.findIndex(c => c && c.code === TRAP);
      return seq >= 0 ? doc.querySelector('[data-act="' + hp + ':8:' + seq + '"]') : null;
    })();
    if (trapEl && !window.__m1.trapClosed && (window.__m1.trapOpenCount || 0) < 2) {
      window.__m1.trapOpenCount = (window.__m1.trapOpenCount || 0) + 1;
      trapEl.click(); return 'trap-open';
    }
    // survive: develop a hand monster before passing the phase.
    // Only one normal summon per turn — after a couple of fruitless
    // taps the remaining hand cards have no action (not in
    // actionMap, so the tap is swallowed); advance the phase then.
    const handMon = doc.querySelector('#hand [data-act]');
    if (handMon && (window.__m1.handMonCount || 0) < 2) {
      window.__m1.handMonCount = (window.__m1.handMonCount || 0) + 1;
      handMon.click(); return 'hand-mon';
    }
    // in the battle phase, attack with a field monster before phasing
    if (cpName === 'SELECT_BATTLECMD' && (window.__m1.battleMonCount || 0) < 2) {
      const hp = (typeof HP !== 'undefined') ? HP : 0;
      const mz = st && st.players[hp] ? st.players[hp].mzone : null;
      if (mz) {
        const seq = mz.findIndex(c => c && c.code != null);
        if (seq >= 0) {
          const monEl = doc.querySelector('[data-act="' + hp + ':4:' + seq + '"]');
          if (monEl) { window.__m1.battleMonCount = (window.__m1.battleMonCount || 0) + 1; monEl.click(); return 'battle-mon'; }
        }
      }
    }
    const pb = doc.getElementById('phasebtn');
    if (pb && !pb.disabled) { pb.click(); return 'phase'; }
    const a = q('[data-act]');
    if (a) { a.click(); return 'act'; }
    return 'idle-wait';
  }
  return 'wait';
};

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)).catch(() => {});
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const t0 = Date.now();
  let found = null;
  for (let duel = 1; duel <= MAXDUELS && !found && (Date.now() - t0) / 1000 < MAXS; duel++) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 620, deviceScaleFactor: 2 });
    page.on('pageerror', e => log('[pageerror] ' + String(e).slice(0, 160)));
    await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
    await page.click('#todeck');
    await page.waitForFunction(() => { const b = document.getElementById('startbtn'); return b && !b.disabled; }, { timeout: 30000 });
    await page.click('#startbtn');
    await sleep(2000);
    log('duel ' + duel + ' started');
    const counts = {};
    const recent = [];
    let steps = 0, stalled = false;
    while ((Date.now() - t0) / 1000 < MAXS && steps < 1200) {
      steps++;
      const st = await page.evaluate(STEP).catch(() => 'eval-error');
      if (st === 'eval-error') { log('duel ' + duel + ' eval-error (page/browser gone?); moving on'); break; }
      // heartbeat: every 100 steps, log the page state so a quiet duel is visible
      if (steps % 100 === 0) {
        const hb = await page.evaluate(() => {
          const s = (typeof duelState !== 'undefined') ? duelState : null;
          const cp = (typeof currentPrompt !== 'undefined') ? currentPrompt : null;
          return {
            turn: s ? s.turnCount : null, turnPlayer: s ? s.turnPlayer : null,
            phase: s ? s.phaseName : null,
            hpLP: s ? s.players[0].lp : null, opLP: s ? s.players[1].lp : null,
            hand: s ? s.players[(typeof HP !== 'undefined' ? HP : 0)].hand.length : null,
            cp: cp ? cp.prompt.name : null,
            sheet: document.getElementById('sheetwrap').className + '/' + (document.getElementById('sheetwrap').dataset.kind || ''),
            dock: document.getElementById('dock').className,
            result: document.getElementById('result').style.display,
          };
        }).catch(() => null);
        if (hb) log('duel ' + duel + ' hb step ' + steps + ': ' + JSON.stringify(hb));
      }
      counts[st.split(':')[0]] = (counts[st.split(':')[0]] || 0) + 1;
      recent.push(st.split(':')[0]); if (recent.length > 25) recent.shift();
      if (recent[0] === 'wait' || recent[0] === 'idle-wait') recent.length = 0;
      if (recent.length === 25 && recent.every(s => s === recent[0])) { log('duel ' + duel + ' STALLED on "' + recent[0] + '" after ' + steps + ' steps'); stalled = true; break; }
      if (st === 'result') { log('duel ' + duel + ' ended (result) after ' + steps + ' steps; counts: ' + JSON.stringify(counts)); break; }
      if (st.startsWith('TARGET:')) {
        log('duel ' + duel + ' TARGET SHEET after ' + steps + ' steps; counts: ' + JSON.stringify(counts));
        await sleep(700);
        found = { duel, steps };
        found.first = await page.evaluate(MEASURE);
        await page.screenshot({ path: path.join(OUT, 'm1live-first.png') });
        found.taps = [];
        for (let i = 0; i < found.first.tiles; i++) {
          const c = await page.evaluate((idx) => {
            const t = document.querySelector('#sheet .gcard[data-grid="' + idx + '"]');
            if (!t) return null;
            const r = t.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }, i);
          if (!c) { found.taps.push({ i, error: 'no tile' }); continue; }
          await page.mouse.click(c.x, c.y);
          await sleep(250);
          const after = await page.evaluate((idx) => {
            const t = document.querySelector('#sheet .gcard[data-grid="' + idx + '"]');
            const conf = document.getElementById('grid-confirm');
            return { sel: t ? t.classList.contains('sel') : null, confirmDisabled: conf ? conf.disabled : null };
          }, i);
          found.taps.push({ i, ...after });
        }
        found.afterTaps = await page.evaluate(MEASURE);
        await page.screenshot({ path: path.join(OUT, 'm1live-aftertaps.png') });
        break;
      }
      await sleep(200);
    }
    if (!found) { log('duel ' + duel + ' no target; steps: ' + steps + (stalled ? ' (stalled)' : '') + '; counts: ' + JSON.stringify(counts)); await page.close().catch(() => {}); }
    else { await page.screenshot({ path: path.join(OUT, 'm1live-end.png') }); }
  }
  if (found) {
    fs.writeFileSync(path.join(OUT, 'm1live-report.json'), JSON.stringify(found, null, 1));
    log('FOUND: ' + JSON.stringify({ duel: found.duel, firstTiles: found.first.tiles, firstConfirmDisabled: found.first.confirm && found.first.confirm.disabled, scrollProbe: found.first.scrollProbe, taps: found.taps, afterConfirmDisabled: found.afterTaps.confirm && found.afterTaps.confirm.disabled }));
  } else log('NOT FOUND in ' + MAXDUELS + ' duels / ' + Math.round((Date.now() - t0) / 1000) + 's');
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
