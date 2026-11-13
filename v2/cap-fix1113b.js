'use strict';
/* cap-fix1113b.js — before/after capture rig for the fix round
 * 2026-11-13 #2 (BU-63..67), derived from cap-brushup1113.js.
 * Scenes:
 *   decksum — deck page summary line: are 「先」 and 「攻」 on the
 *             same painted line (F5/BU-67)?
 *   board   — a real duel: set one monster + one S/T, measure the
 *             own set tiles' name bands (rect vs tile width,
 *             scrollWidth vs clientWidth — F3/BU-65); whenever a
 *             card-selection grid opens, measure the marks chip's
 *             seat inside a .gcard (F4/BU-66); measure the preview
 *             strip's thumbnail (pv-art marks — F4/BU-66).
 *   piledeck— open the own deck pile sheet in a live duel: how
 *             many card rows does it render (F2/BU-64)?
 *   quit    — その他 → 選択に戻る: before = instant reload with no
 *             confirmation; after = confirmation sheet, cancel
 *             path, confirm path, and the landing veil timeline
 *             (F1/BU-63).
 * Usage: node cap-fix1113b.js <decksum|board|piledeck|quit> <outdir> [height]
 * Geometry is measured, never eyeballed; screenshots accompany. */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');
const CHROME = '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome';
const ROOT = path.join(__dirname, '..');
const V2 = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const TYPES = {}; for (const [code, c] of Object.entries(data.cards)) TYPES[code] = c.type || 0;
const isMon = (code) => (TYPES[code] & 1) !== 0;
const isST = (code) => (TYPES[code] & 6) !== 0;

const scene = process.argv[2];
const OUT = process.argv[3];
const H = +(process.argv[4] || 620);
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/v2/'; if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  fs.readFile(f, (e, buf) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(buf); } });
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const STATE = () => {
  const doc = document;
  const cp = (typeof currentPrompt !== 'undefined') ? currentPrompt : null;
  const st = (typeof duelState !== 'undefined') ? duelState : null;
  const hp = (typeof HP !== 'undefined') ? HP : 0;
  const me = st ? st.players[hp] : null;
  const pb = doc.getElementById('phasebtn');
  return {
    resultShown: doc.getElementById('result').style.display === 'flex',
    sheetOn: doc.getElementById('sheetwrap').classList.contains('on'),
    sheetTitle: (doc.querySelector('#sheet .ttl') || {}).textContent || '',
    sheetPurpose: (doc.querySelector('#sheet .purpose') || {}).textContent || '',
    opts: [...doc.querySelectorAll('#sheet .optbtn:not(.disabled)')].map(b => b.textContent.trim()),
    hasGrid: !!doc.querySelector('#sheet [data-grid]'), hasAnnounce: !!doc.querySelector('#sheet #announce-ok'),
    hasUnselect: !!doc.querySelector('#sheet [data-unselect]'), hasCounter: !!doc.querySelector('#sheet [data-inc]'),
    hasPosbtn: !!doc.querySelector('#sheet .posbtn'), hasSortOk: !!doc.querySelector('#sheet #sort-ok'),
    dockOn: doc.getElementById('dock').className === 'on',
    prompt: cp ? cp.prompt.name : null,
    turn: st ? st.turnCount : 0, tp: st ? st.turnPlayer : -1, phase: st ? st.phaseName : '',
    hp,
    hand: me ? me.hand.filter(Boolean).map(c => c.code) : [],
    myMon: me ? me.mzone.map(c => c ? { code: c.code, pos: c.pos } : null) : [],
    myST: me ? me.szone.map(c => c ? { code: c.code, pos: c.pos } : null) : [],
    phaseBtn: pb ? { text: pb.textContent.trim(), cw: pb.clientWidth, sw: pb.scrollWidth, dis: pb.disabled } : null,
  };
};

async function startDuel(page) {
  await page.goto('http://127.0.0.1:8979/v2/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.getElementById('todeck'); return b && !b.disabled; }, { timeout: 60000 });
  await sleep(800);
  await page.evaluate(() => document.getElementById('todeck').click());
  await page.waitForFunction(() => document.getElementById('deckpage').style.display === 'flex', { timeout: 15000 });
  await page.evaluate(() => document.getElementById('startbtn').click());
  await page.waitForFunction(() => document.querySelectorAll('#hand .hcard').length >= 4, { timeout: 60000 });
  await sleep(600);
}

const measureSetTiles = (page) => page.evaluate(() => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; };
  const tiles = [...document.querySelectorAll('.tile.setown')].map(t => {
    const nm = t.querySelector('.nm');
    const info = { tile: R(t), loc: t.closest('.slot') ? t.closest('.slot').dataset.zone : null, cls: t.className };
    if (nm) {
      const r = nm.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      info.nm = { rect: R(nm), text: nm.textContent.trim(), cw: nm.clientWidth, sw: nm.scrollWidth,
        ellipsised: nm.scrollWidth > nm.clientWidth + 1, inInner: !!nm.closest('.inner'),
        topAtCenter: top ? (top.className || top.tagName) : null };
    }
    const slot = t.closest('.slot');
    const plate = slot ? slot.querySelector('.slotplate') : null;
    info.plate = plate ? { rect: R(plate), text: plate.textContent.trim() } : null;
    const m = t.querySelector('.marks');
    info.chip = m ? [...m.querySelectorAll('img')].map(i => i.getAttribute('src').split('/').pop()) : null;
    return info;
  });
  return { setTiles: tiles };
});

/* F4: marks seat inside a selection-grid card + preview thumbnail */
const measureGridChips = (page) => page.evaluate(() => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, top: Math.round(r.top * 10) / 10, left: Math.round(r.left * 10) / 10 }; };
  const cards = [...document.querySelectorAll('#sheet .gcard')].slice(0, 6).map(g => {
    const m = g.querySelector('.marks');
    const nm = g.querySelector('.nm');
    return { gcard: R(g), nmRect: R(nm),
      chip: m ? { rect: R(m), insideNm: !!m.closest('.nm'), position: getComputedStyle(m).position,
        imgs: [...m.querySelectorAll('img')].map(i => i.getAttribute('src').split('/').pop()) } : null };
  });
  return { gridCards: cards };
});
const measurePreview = (page) => page.evaluate(() => {
  const pv = document.getElementById('preview');
  if (!pv) return null;
  const art = pv.querySelector('.pv-art');
  const m = art ? art.querySelector('.marks') : null;
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; };
  return { pvOn: pv.classList.contains('on'), pvRect: R(pv), pvArt: R(art), pvArtChip: m ? [...m.querySelectorAll('img')].map(i => i.getAttribute('src').split('/').pop()) : null,
    metaHasStIcon: !!pv.querySelector('.pv-meta .sticon'), compact: pv.classList.contains('compact') };
});

/* one generic driver step; goal flags live in window.__goal */
const STEP = async (page) => page.evaluate(() => {
  const doc = document, q = (s, r) => (r || doc).querySelector(s), qa = (s, r) => [...(r || doc).querySelectorAll(s)];
  const txt = (el) => (el ? (el.textContent || '') : '');
  const click = (el) => { if (el && el.offsetParent !== null) { el.click(); return true; } return false; };
  window.__goal = window.__goal || {};
  const G = window.__goal;
  if (doc.getElementById('result').style.display === 'flex') return 'result';
  const sh = doc.getElementById('sheet');
  if (doc.getElementById('sheetwrap').classList.contains('on') && sh) {
    // goal sheet: we opened a hand card to set it
    if (G.wantSetSheet) {
      const btns = qa('.optbtn:not(.disabled)', sh);
      const setBtn = btns.find(b => txt(b).includes('セット'));
      G.wantSetSheet = false;
      if (setBtn) { setBtn.click(); return 'goal-set'; }
      if (click(q('#sheet-cancel', sh))) return 'goal-sheet-cancel';
      return 'goal-sheet-idle';
    }
    // goal sheet: we opened a set S/T to flip it face-up
    if (G.wantActivateSheet) {
      const btns = qa('.optbtn:not(.disabled)', sh);
      const actBtn = btns.find(b => txt(b).includes('発動'));
      G.wantActivateSheet = false;
      if (actBtn) { actBtn.click(); return 'goal-activate'; }
      if (click(q('#sheet-cancel', sh))) return 'goal-act-cancel';
      return 'goal-act-idle';
    }
    if (q('#announce-ok', sh)) {
      const ok = q('#announce-ok', sh);
      if (!ok.disabled) { ok.click(); return 'announce-ok'; }
      if (click(q('.gcard[data-code]:not(.sel)', sh))) return 'announce-pick';
      return 'announce-idle';
    }
    if (q('[data-grid]', sh)) {
      const gc = q('#grid-confirm', sh);
      if (gc && !gc.disabled) { gc.click(); return 'grid-confirm'; }
      if (click(q('[data-grid]:not(.sel)', sh))) return 'grid-pick';
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
    if (q('[data-inc]', sh)) {
      const cc = q('#counter-confirm', sh);
      if (cc && !cc.disabled) { cc.click(); return 'counter-confirm'; }
      if (click(q('[data-inc]', sh))) return 'counter-inc';
      return 'counter-idle';
    }
    if (click(q('#sort-ok', sh))) return 'sort-ok';
    {
      const opts = qa('.optbtn:not(.disabled)', sh);
      const atk = opts.find(b => txt(b).trim() === '攻撃');
      const summon = opts.find(b => txt(b).includes('通常召喚'));
      const pick = atk || summon || opts[0];
      if (pick) { pick.click(); return 'optbtn'; }
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
  const cp = (typeof currentPrompt !== 'undefined') ? currentPrompt : null;
  const cpName = cp ? cp.prompt.name : null;
  if (cpName === 'SELECT_PLACE' || cpName === 'SELECT_DISFIELD') {
    const z = doc.querySelector('[data-zone].hl') || doc.querySelector('[data-zone].picked');
    if (z) { z.click(); return 'place'; }
    return 'place-wait';
  }
  if (cpName === 'SELECT_BATTLECMD') {
    const st = (typeof duelState !== 'undefined') ? duelState : null;
    const hp = (typeof HP !== 'undefined') ? HP : 0;
    const me = st ? st.players[hp] : null;
    if (G.attack !== false && me) {
      const atkSeq = me.mzone.findIndex(c => c && (c.pos & 1) && c.atk > 0);
      const el = atkSeq >= 0 ? doc.querySelector('[data-act="' + hp + ':4:' + atkSeq + '"]') : null;
      if (el && !G['atkTried' + st.turnCount + ':' + atkSeq]) { G['atkTried' + st.turnCount + ':' + atkSeq] = 1; el.click(); return 'attack-open'; }
    }
    if (click(doc.getElementById('phasebtn'))) return 'phasebtn-battle';
    return 'battle-wait';
  }
  if (cpName === 'SELECT_IDLECMD') {
    if (click(doc.getElementById('phasebtn'))) return 'phasebtn';
    return 'idle-wait';
  }
  return 'wait:' + cpName;
});

(async () => {
  await new Promise(r => server.listen(8979, r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const out = { scene, height: H };
  try {
    if (scene === 'veil') {
      // F1b/BU-63: land from a mid-duel exit with data.json
      // DELAYED by 1500ms, and sample what covers the screen
      // while the boot load runs. Before the fix the title
      // overlay (「読み込み中…」) stood until the fetch landed;
      // after it, the deck page frame is up from the start.
      await page.goto('http://127.0.0.1:8979/v2/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => { const b = document.getElementById('todeck'); return b && !b.disabled; }, { timeout: 60000 });
      await page.evaluate(() => sessionStorage.setItem('v3todeck', JSON.stringify({ my: 'ishizu', op: 'gg', first: 'first' })));
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.url().includes('data.json')) setTimeout(() => req.continue().catch(() => {}), 1500);
        else req.continue().catch(() => {});
      });
      const t0 = Date.now();
      await page.evaluate(() => location.reload());
      const samples = [];
      for (let i = 0; i < 40; i++) {
        const s = await page.evaluate(() => ({
          startDisplay: document.getElementById('start').style.display,
          startVisible: document.getElementById('start').getBoundingClientRect().height > 0 && document.getElementById('start').style.display !== 'none',
          deckpageDisplay: document.getElementById('deckpage').style.display,
          loadmsg: document.getElementById('loadmsg').textContent,
          topEl: (() => { const el = document.elementFromPoint(innerWidth / 2, 24); return el ? (el.id || el.className || el.tagName) : null; })(),
        })).catch(() => null);
        samples.push({ t: Date.now() - t0, s });
        await sleep(120);
      }
      out.samples = samples;
      const firstDeck = samples.find(x => x.s && x.s.deckpageDisplay === 'flex');
      out.deckpageVisibleAtMs = firstDeck ? firstDeck.t : null;
      const covered = samples.filter(x => x.s && x.s.startDisplay !== 'none' && x.s.deckpageDisplay !== 'flex');
      out.titleVeilSamples = covered.length;
      await page.screenshot({ path: path.join(OUT, 'veil-landing.png') });
    } else if (scene === 'gridsynth') {
      // F4/BU-66: drive the REAL gridSheet renderer with a mixed
      // candidate set (quick-play / continuous / counter /
      // monster) and measure the marks chip's seat inside the
      // grid cards (a live duel cannot guarantee a grid prompt
      // on demand; the renderer and CSS under test are the real
      // ones).
      await startDuel(page);
      await sleep(500);
      out.opened = await page.evaluate(() => {
        const sel = new Set();
        gridSheet({
          title: 'カードを選択', sub: '1枚選んでください', purpose: '測定用',
          cards: [
            { code: 28958464, locLabel: '手札' },   // MC死者蘇生 (quick-play)
            { code: 98715423, locLabel: '手札' },   // 墓守の罠 (continuous trap)
            { code: 6351147, locLabel: '手札' },    // ロールバック (normal trap)
            { code: 36745317, locLabel: '手札' },   // 森と目覚の春化精 (monster)
          ],
          selected: sel, valid: () => sel.size === 1, confirmLabel: '決定', cancelable: true,
          onToggle: (i) => { sel.has(i) ? sel.delete(i) : sel.add(i); return 'ok'; },
          onConfirm: () => {}, prompt: { retryCount: 0, context: null, min: 1, max: 1 },
        });
        return true;
      });
      await sleep(700);
      out.gridMeasure = await measureGridChips(page);
      out.gridPreview = await measurePreview(page);
      await page.screenshot({ path: path.join(OUT, 'grid-synth.png') });
    } else if (scene === 'setcards') {
      // F3/BU-65: render the four named cards as the owner's set
      // cards through the REAL tileHTML/slotStatsHTML into live
      // board slots (a rendering scene — the duel state is not
      // touched; it exists so the four cards are measured on the
      // same geometry before and after, which a drawn hand in a
      // live duel cannot guarantee).
      await startDuel(page);
      await sleep(600);
      out.render = await page.evaluate(() => {
        const hp = (typeof HP !== 'undefined') ? HP : 0;
        const cards = [
          { code: 36745317, pos: 0x8, loc: 4, seq: 0 },  // 森と目覚の春化精 (set monster, face-down defense)
          { code: 62133026, pos: 0x8, loc: 4, seq: 2 },  // 花と野原の春化精 (set monster)
          { code: 51208877, pos: 0xa, loc: 8, seq: 0 },  // 運命の抱く爆弾 (set trap)
          { code: 98715423, pos: 0xa, loc: 8, seq: 2 },  // 墓守の罠 (set trap)
        ];
        const done = [];
        for (const c of cards) {
          const slot = document.querySelector('[data-zone="' + hp + ':' + c.loc + ':' + c.seq + '"]');
          if (!slot) continue;
          const card = { code: c.code, pos: c.pos, materials: 0, counters: 0, curAtk: null, curDef: null };
          const st = slotStatsHTML(card, hp, c.loc);
          slot.classList.toggle('hs', !!st);
          slot.innerHTML = tileHTML(card, hp, hp + ':' + c.loc + ':' + c.seq, c.loc) + st;
          done.push(c.code);
        }
        return done;
      });
      await sleep(350);
      out.setMeasure = await measureSetTiles(page);
      await page.screenshot({ path: path.join(OUT, 'setcards.png') });
    } else if (scene === 'decksum') {
      await page.goto('http://127.0.0.1:8979/v2/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => { const b = document.getElementById('todeck'); return b && !b.disabled; }, { timeout: 60000 });
      await sleep(800);
      await page.evaluate(() => document.getElementById('todeck').click());
      await page.waitForFunction(() => document.getElementById('deckpage').style.display === 'flex', { timeout: 15000 });
      await sleep(500);
      const measureSum = () => page.evaluate(() => {
        const el = document.getElementById('decksum');
        const out2 = { text: el ? el.textContent.trim() : null, units: [] };
        if (!el) return out2;
        // find the character range of 先攻 / 後攻 in the rendered text
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const t = node.textContent;
          for (const word of ['先攻', '後攻']) {
            const i = t.indexOf(word);
            if (i >= 0) {
              const rects = [];
              for (let k = 0; k < word.length; k++) {
                const rg = document.createRange(); rg.setStart(node, i + k); rg.setEnd(node, i + k + 1);
                const r = rg.getBoundingClientRect();
                rects.push({ ch: word[k], top: Math.round(r.top * 10) / 10, left: Math.round(r.left * 10) / 10 });
              }
              const sameLine = rects.every(r => Math.abs(r.top - rects[0].top) < 1);
              out2.units.push({ word, rects, split: !sameLine, inUnitSpan: !!(node.parentElement && node.parentElement.closest('[data-nb],.nbunit')) });
            }
          }
        }
        const r = el.getBoundingClientRect();
        out2.rect = { w: Math.round(r.width), h: Math.round(r.height) };
        return out2;
      });
      out.defaultPick = await measureSum();
      await page.screenshot({ path: path.join(OUT, 'decksum-default.png') });
      // pick a long-named opponent (Genesys theme) to stress the wrap
      await page.evaluate(() => document.getElementById('opdeckcur').click());
      await sleep(700);
      await page.evaluate(() => { const b = [...document.querySelectorAll('#deckcatlist .catbtn')].find(x => x.dataset.cat === 'genesys'); if (b) b.click(); });
      await sleep(900);
      await page.evaluate(() => { const b = document.querySelector('#seg-opdeck button[data-v="elfennotes"]'); if (b) b.click(); });
      await sleep(900);
      out.longPick = await measureSum();
      await page.screenshot({ path: path.join(OUT, 'decksum-longpick.png') });
    } else if (scene === 'piledeck') {
      await startDuel(page);
      await sleep(400);
      const pileMeasure = () => page.evaluate(() => {
        const sheet = document.getElementById('sheet');
        const rows = sheet ? [...sheet.querySelectorAll('.sortrow')] : [];
        const scroller = sheet ? (sheet.closest('#sheetwrap') || sheet) : null;
        return {
          sheetOn: document.getElementById('sheetwrap').classList.contains('on'),
          title: sheet ? (sheet.querySelector('.ttl') || {}).textContent || '' : '',
          subText: sheet ? (sheet.querySelector('.sub') || {}).textContent || '' : '',
          rowCount: rows.length,
          rowNames: rows.slice(0, 50).map(r => r.textContent.trim().slice(0, 30)),
          sheetScroll: sheet ? { sh: sheet.scrollHeight, ch: sheet.clientHeight } : null,
          wrapScroll: scroller ? { sh: scroller.scrollHeight, ch: scroller.clientHeight } : null,
        };
      });
      // open own deck pile via a real hit-test click on the chip
      const chip = await page.evaluate(() => {
        const hp = (typeof HP !== 'undefined') ? HP : 0;
        const el = document.querySelector('[data-pile="deck:' + hp + '"]');
        if (!el) return null; const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: el.textContent.trim() };
      });
      out.chip = chip;
      if (chip) { await page.mouse.click(chip.x, chip.y); await sleep(900); }
      out.ownDeckSheet = await pileMeasure();
      await page.screenshot({ path: path.join(OUT, 'piledeck-own.png') });
      // scroll the sheet region to the bottom and re-measure the last row visibility
      await page.evaluate(() => { const w = document.getElementById('sheetwrap'); if (w) w.scrollTop = w.scrollHeight; const s = document.getElementById('sheet'); if (s) s.scrollTop = s.scrollHeight; });
      await sleep(400);
      out.ownDeckSheetScrolled = await pileMeasure();
      await page.screenshot({ path: path.join(OUT, 'piledeck-own-scrolled.png') });
      await page.evaluate(() => { const c = document.getElementById('sheet-cancel'); if (c) c.click(); });
      await sleep(500);
      // opponent deck pile (must stay count-only: hidden information)
      const ochip = await page.evaluate(() => {
        const hp = (typeof HP !== 'undefined') ? HP : 0;
        const el = document.querySelector('[data-pile="deck:' + (1 - hp) + '"]');
        if (!el) return null; const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: el.textContent.trim() };
      });
      if (ochip) { await page.mouse.click(ochip.x, ochip.y); await sleep(900); }
      out.opDeckSheet = await pileMeasure();
      await page.screenshot({ path: path.join(OUT, 'piledeck-opponent.png') });
    } else if (scene === 'quit') {
      let navCount = 0;
      page.on('framenavigated', (f) => { if (f === page.mainFrame()) navCount++; });
      await startDuel(page);
      // wait for the その他 menu to be live (first idle prompt)
      await page.waitForFunction(() => { const b = document.getElementById('menubtn'); return b && !b.disabled; }, { timeout: 90000 });
      await page.evaluate(() => document.getElementById('menubtn').click());
      await sleep(600);
      await page.screenshot({ path: path.join(OUT, 'quit-menu.png') });
      const navBefore = navCount;
      await page.evaluate(() => { const c = document.getElementById('sheet-cancel'); if (c) c.click(); });
      await sleep(1200);
      out.afterBackClick = await page.evaluate(() => ({
        sheetOn: document.getElementById('sheetwrap').classList.contains('on'),
        sheetText: (document.getElementById('sheet') || {}).textContent || '',
        startShown: document.getElementById('start').style.display !== 'none',
        deckpageShown: document.getElementById('deckpage').style.display === 'flex',
      }));
      out.navigatedAfterBackClick = navCount > navBefore;
      await page.screenshot({ path: path.join(OUT, 'quit-after-backclick.png') });
      // after-fix path: a confirmation sheet is up. Cancel it first.
      if (out.afterBackClick.sheetOn && !out.navigatedAfterBackClick) {
        const cancelBtn = await page.evaluate(() => {
          const btns = [...document.querySelectorAll('#sheet button')];
          const b = btns.find(x => /やめる|対局に戻る|キャンセル/.test(x.textContent));
          if (b) { b.click(); return b.textContent.trim(); } return null;
        });
        out.confirmCancelButton = cancelBtn;
        await sleep(700);
        out.afterConfirmCancel = await page.evaluate(() => ({
          sheetOn: document.getElementById('sheetwrap').classList.contains('on'),
          duelAlive: typeof duelState !== 'undefined' && !!duelState,
        }));
        // re-open and confirm the exit this time
        await page.evaluate(() => document.getElementById('menubtn').click());
        await sleep(500);
        await page.evaluate(() => { const c = document.getElementById('sheet-cancel'); if (c) c.click(); });
        await sleep(700);
        await page.evaluate(() => {
          const btns = [...document.querySelectorAll('#sheet button')];
          const b = btns.find(x => /終了する/.test(x.textContent));
          if (b) b.click();
        });
        // landing timeline: sample the cover state for ~4s
        const samples = [];
        const t0 = Date.now();
        for (let i = 0; i < 28; i++) {
          const s = await page.evaluate(() => {
            const at = (id) => document.getElementById(id);
            const top = document.elementFromPoint(innerWidth / 2, 24);
            return {
              startDisplay: at('start').style.display, deckpageDisplay: at('deckpage').style.display,
              loadmsg: (at('loadmsg') || {}).textContent || '',
              topEl: top ? (top.id || top.className || top.tagName) : null,
              todeckDisabled: (at('todeck') || {}).disabled,
            };
          }).catch(() => null);
          samples.push({ t: Date.now() - t0, s });
          if (s && s.deckpageDisplay === 'flex' && i > 6) break;
          await sleep(180);
        }
        out.landingTimeline = samples;
        await page.screenshot({ path: path.join(OUT, 'quit-landing.png') });
      }
    } else if (scene === 'deck') {
      await page.goto('http://127.0.0.1:8979/v2/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => { const b = document.getElementById('todeck'); return b && !b.disabled; }, { timeout: 60000 });
      await sleep(800);
      await page.evaluate(() => document.getElementById('todeck').click());
      await page.waitForFunction(() => document.getElementById('deckpage').style.display === 'flex', { timeout: 15000 });
      await sleep(500);
      const measure = () => page.evaluate(() => {
        const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
        const sum = document.getElementById('decksum');
        const rows = [...document.querySelectorAll('#deckpage .setrow')];
        const soundRow = rows.find(r => r.textContent.includes('音'));
        const sw = document.querySelector('#deckpage .switch');
        const inter = (a, b) => a && b ? Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0;
        const sumR = R(sum), swR = R(sw);
        let cover = null;
        if (sumR) {
          const el = document.elementFromPoint(sumR.x + sumR.w / 2, sumR.y + 4);
          cover = el ? (el.id || el.className || el.tagName) : null;
        }
        return { decksum: sumR, decksumText: sum ? sum.textContent.trim() : null, soundRow: R(soundRow), switch: swR,
          overlapSumSwitchPx: inter(sumR, swR), overlapSumSoundRowPx: inter(sumR, R(soundRow)), coverAtSumTopCenter: cover,
          dpMainScroll: (() => { const m = document.querySelector('.dp-main'); return m ? { sh: m.scrollHeight, ch: m.clientHeight, oy: getComputedStyle(m).overflowY } : null; })(),
          // clip-aware: what is actually PAINTED at the switch's
          // centre (rect intersection alone cannot see clipping)
          topAtSwitchCenter: (() => { if (!swR) return null; const el = document.elementFromPoint(swR.x + swR.w / 2, swR.y + swR.h / 2); return el ? (el.id || el.className || el.tagName) : null; })(),
          dpMainRect: R(document.querySelector('.dp-main')) };
      });
      out.initial = await measure();
      await page.screenshot({ path: path.join(OUT, 'deck-initial.png') });
      // re-pick the opponent deck: open category page, character, pick GG row in modal
      await page.evaluate(() => document.getElementById('opdeckcur').click());
      await sleep(700);
      await page.evaluate(() => { const b = [...document.querySelectorAll('#deckcatlist .catbtn')].find(x => x.dataset.cat === 'character'); if (b) b.click(); });
      await sleep(900);
      await page.evaluate(() => { const b = document.querySelector('#seg-opdeck button[data-v="gg"]'); if (b) b.click(); });
      await sleep(900);
      out.afterPick = await measure();
      await page.screenshot({ path: path.join(OUT, 'deck-after-pick.png') });
      // scroll the middle region to its bottom: the sound row must
      // become fully visible + tappable inside its own region, and
      // the summary must stay clean in the fixed foot
      await page.evaluate(() => { const m = document.querySelector('.dp-main'); if (m) m.scrollTop = m.scrollHeight; });
      await sleep(400);
      out.afterPickScrolled = await measure();
      await page.screenshot({ path: path.join(OUT, 'deck-after-pick-scrolled.png') });
    } else if (scene === 'board') {
      await startDuel(page);
      const goals = { phaseMeasured: false, setMon: false, setST: false, faceST: false };
      let phaseMeasure = null, idleSteps = 0;
      for (let i = 0; i < 4200 && idleSteps < 60; i++) {
        const s = await page.evaluate(STATE);
        if (s.resultShown) break;
        if (!goals.phaseMeasured && s.prompt === 'SELECT_IDLECMD' && s.tp === s.hp && s.phase === 'MAIN1' && s.phaseBtn && !s.phaseBtn.dis) {
          phaseMeasure = await page.evaluate(() => {
            const b = document.getElementById('phasebtn');
            const ti = document.getElementById('turninfo'), pi = document.getElementById('phaseinfo');
            const M = (el) => el ? { text: el.textContent.trim(), cw: el.clientWidth, sw: el.scrollWidth } : null;
            return { phasebtn: { text: b.textContent.trim(), cw: b.clientWidth, sw: b.scrollWidth, clipped: b.scrollWidth > b.clientWidth + 1 }, turninfo: M(ti), phaseinfo: M(pi) };
          });
          goals.phaseMeasured = true;
          await page.screenshot({ path: path.join(OUT, 'board-mp1-phasebtn.png') });
        }
        // set goals during own idle
        if (s.prompt === 'SELECT_IDLECMD' && s.tp === s.hp && !s.sheetOn) {
          const haveSetMon = s.myMon.some(c => c && !(c.pos & 1));
          const haveSetST = s.myST.some(c => c && !(c.pos & 1));
          const tried = await page.evaluate(() => { window.__goal = window.__goal || {}; window.__goal.triedST = window.__goal.triedST || {}; window.__goal.triedMon = window.__goal.triedMon || {}; return { st: window.__goal.triedST, mon: window.__goal.triedMon }; });
          const monCode = s.hand.find(c => isMon(c) && !tried.mon[c]);
          const stCode = s.hand.find(c => isST(c) && !tried.st[c]);
          if (!haveSetMon && monCode != null) {
            const done = await page.evaluate((code) => {
              const el = document.querySelector('#hand [data-code="' + code + '"]');
              if (!el) return false; window.__goal.triedMon[code] = 1; window.__goal.wantSetSheet = true; el.click(); return true;
            }, monCode);
            if (done) { await sleep(350); continue; }
          }
          if (!haveSetST && stCode != null) {
            const done = await page.evaluate((code) => {
              const el = document.querySelector('#hand [data-code="' + code + '"]');
              if (!el) return false; window.__goal.triedST[code] = 1; window.__goal.wantSetSheet = true; el.click(); return true;
            }, stCode);
            if (done) { await sleep(350); continue; }
          }
          // once an S/T stands set, try to flip it face-up on a
          // later own idle (type-icon evidence on a face-up S/T)
          if (goals.setST === true && !goals.faceST) {
            const setSeq = s.myST.findIndex(c => c && !(c.pos & 1));
            if (setSeq >= 0 && !goals['faceTried' + s.turn]) {
              goals['faceTried' + s.turn] = 1;
              const done = await page.evaluate((seq) => {
                const st2 = (typeof duelState !== 'undefined') ? duelState : null;
                const hp2 = (typeof HP !== 'undefined') ? HP : 0;
                const el = document.querySelector('[data-act="' + hp2 + ':8:' + seq + '"]');
                if (!el) return false; window.__goal = window.__goal || {}; window.__goal.wantActivateSheet = true; el.click(); return true;
              }, setSeq);
              if (done) { await sleep(350); continue; }
            }
          }
        }
        const act = await STEP(page);
        if (act === 'sheet-idle' || act === 'dock-idle' || act === 'goal-sheet-idle') idleSteps++; else idleSteps = 0;
        await sleep(160);
        // F4: whenever a selection grid is on screen, pin the marks
        // chip's seat inside the grid cards and the preview strip
        if (s.hasGrid && !out.gridMeasure) {
          out.gridMeasure = await measureGridChips(page);
          out.gridPreview = await measurePreview(page);
          await page.screenshot({ path: path.join(OUT, 'board-grid.png') });
        }
        if (!out.previewMeasure) out.previewMeasure = await measurePreview(page);
        // settle goals
        const s2 = await page.evaluate(STATE);
        if (s2.myMon.some(c => c && !(c.pos & 1))) goals.setMon = true;
        if (s2.myST.some(c => c && !(c.pos & 1))) goals.setST = true;
        if (s2.myST.some(c => c && (c.pos & 1))) goals.faceST = true;
        if (goals.setMon === true && goals.setST === true && !out.setMeasure) {
          out.setMeasure = await measureSetTiles(page);
          await page.screenshot({ path: path.join(OUT, 'board-set-cards.png') });
        }
        if (goals.phaseMeasured && goals.setMon === true && goals.setST === true && (goals.faceST || i > 2400)) break;
      }
      out.goals = goals; out.phaseMeasure = phaseMeasure;
      await sleep(500);
      if (!out.setMeasure) out.setMeasure = await measureSetTiles(page);
      await page.screenshot({ path: path.join(OUT, 'board-final.png') });
      // hand close-up: full shot already includes the hand; also record
      // which hand cards carry a marks chip and what it contains
      out.handChips = await page.evaluate(() => [...document.querySelectorAll('#hand .hcard')].map(h => {
        const m = h.querySelector('.marks');
        return { code: h.dataset.code, chip: m ? [...m.querySelectorAll('img')].map(i => i.getAttribute('src').split('/').pop()) : null, lv: m ? (m.querySelector('.lv') || {}).textContent || null : null };
      }));
      // marks chips on every board tile (S/T type-icon evidence)
      out.boardChips = await page.evaluate(() => [...document.querySelectorAll('.slot .tile')].map(t => {
        const m = t.querySelector('.marks');
        const slot = t.closest('.slot');
        return { zone: slot ? slot.dataset.zone : null, cls: t.className, chip: m ? [...m.querySelectorAll('img')].map(i => i.getAttribute('src').split('/').pop()) : null };
      }).filter(x => x.chip));
      // BU-61 label sweep: every phase-button label + phase readout
      // combination, measured on the live elements (deterministic;
      // the render overwrites the text on the next prompt anyway)
      out.labelSweep = await page.evaluate(() => {
        const b = document.getElementById('phasebtn'), ti = document.getElementById('turninfo'), pi = document.getElementById('phaseinfo');
        const rows = [];
        const combos = [
          ['ターン1・自分', 'メインフェイズ 1', 'バトルフェイズへ'],
          ['ターン1・自分', 'バトルフェイズ', 'メインフェイズ2へ'],
          ['ターン1・自分', 'メインフェイズ 2', 'エンドフェイズへ'],
          ['ターン12・自分', 'メインフェイズ 1', 'バトルフェイズへ'],
          ['ターン3・相手', 'バトルフェイズ', '相手のターン'],
        ];
        for (const [t, p, l] of combos) {
          ti.textContent = t; pi.textContent = p; b.textContent = l;
          rows.push({ turn: t, phase: p, label: l,
            btn: { cw: b.clientWidth, sw: b.scrollWidth, clipped: b.scrollWidth > b.clientWidth + 1 },
            phaseinfo: { cw: pi.clientWidth, sw: pi.scrollWidth, clipped: pi.scrollWidth > pi.clientWidth + 1 },
            turninfo: { cw: ti.clientWidth, sw: ti.scrollWidth, clipped: ti.scrollWidth > ti.clientWidth + 1 } });
        }
        return rows;
      });
    } else if (scene === 'result') {
      await startDuel(page);
      let ended = false;
      for (let i = 0; i < 3400; i++) {
        const s = await page.evaluate(STATE);
        if (s.resultShown) { ended = true; break; }
        await STEP(page);
        await sleep(130);
      }
      out.duelEnded = ended;
      if (ended) {
        await sleep(900);
        await page.screenshot({ path: path.join(OUT, 'result-screen.png') });
        const histMeasure = () => page.evaluate(() => {
          const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
          const sheet = document.getElementById('sheet');
          const ttl = sheet ? sheet.querySelector('.ttl') : null;
          const sheetR = R(sheet);
          // coverage: what is painted on top at the sheet's own
          // center — if it belongs to #result, the sheet is buried
          let topAtSheetCenter = null, sheetCoveredByResult = null;
          if (sheetR) {
            const el = document.elementFromPoint(sheetR.x + sheetR.w / 2, Math.min(innerHeight - 4, sheetR.y + sheetR.h / 2));
            topAtSheetCenter = el ? (el.id || el.className || el.tagName) : null;
            sheetCoveredByResult = !!(el && el.closest && el.closest('#result'));
          }
          return { sheetOn: document.getElementById('sheetwrap').classList.contains('on'),
            resultDisplay: document.getElementById('result').style.display,
            title: ttl ? ttl.textContent.trim() : null, sheetRect: sheetR,
            sheetCoveredByResult, topAtSheetCenter,
            firstVisibleRow: (() => { const rows = [...sheet.querySelectorAll('.histrow, [data-logidx]')]; const v = rows.find(r => { const b = r.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; }); return v ? v.textContent.trim().slice(0, 40) : null; })() };
        });
        // entry 1: the result screen's own history button (real hit-test click)
        const btn = await page.evaluate(() => { const b = document.getElementById('reshistbtn'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        if (btn) { await page.mouse.click(btn.x, btn.y); await sleep(900); }
        out.viaResultButton = await histMeasure();
        await page.screenshot({ path: path.join(OUT, 'result-history-reshistbtn.png') });
        // close the sheet the way a user does (sheet x), result should restore
        await page.evaluate(() => { const x = document.getElementById('sheetx'); if (x && x.offsetParent !== null) x.click(); const c = document.getElementById('sheet-cancel'); if (c && c.offsetParent !== null) c.click(); });
        await sleep(700);
        out.afterClose = await page.evaluate(() => ({ sheetOn: document.getElementById('sheetwrap').classList.contains('on'), resultDisplay: document.getElementById('result').style.display }));
        // entry 2: mid-bar history button via JS click (it is under the overlay for real taps)
        await page.evaluate(() => document.getElementById('loghistbtn').click());
        await sleep(900);
        out.viaLoghistBtn = await histMeasure();
        await page.screenshot({ path: path.join(OUT, 'result-history-loghistbtn.png') });
      }
    }
    console.log(JSON.stringify(out, null, 1));
  } catch (e) {
    console.log(JSON.stringify({ scene, error: String(e && e.message || e), partial: out }, null, 1));
  } finally {
    await browser.close(); server.close();
  }
})();
