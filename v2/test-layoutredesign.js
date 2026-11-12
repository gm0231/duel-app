'use strict';
/* test-layoutredesign.js — layout redesign (2026-11-12) contracts,
   including the fx-ui round 5 ports (I2 grid/itext, I3 detailed
   history dedup — I1's phasebar fittings are superseded by the
   slim mid band and checked as LR-1/LR-2 below).
   I3: captureDLog must align the detailed-history stream by
   VALUE. The state arrives through the worker transport, which
   structured-clones every snapshot, so an anchor on object
   identity never matches and the whole stream is re-appended on
   EVERY render (published build: 222/240 history rows were
   duplicates). The checks feed captureDLog JSON-cloned states,
   exactly like the worker path.
   Redesign contracts:
   - LR-1/LR-2: the mid band is one fitted row; its lines carry
     explicit line-heights and the latest-event line is a single
     nowrap line with no frozen height (it can never be eaten
     vertically — the round-5 I1 defect shape).
   - LR-3: the tile unit never drops below the pre-redesign
     build's unit for the same viewport (the user's absolute
     floor: board art may only grow), and the stack's dead band
     stays in [8, 24) at every probed budget.
   - LR-4: the marks chip (attribute / star+level / race icons)
     renders for monsters and never for spells/traps.
   - LR-5: the chain dock carries a 盤面を見る (peek) control;
     peeking rides on #app (the dock's own className stays the
     exact 'on' contract), and the two 聞かない are real buttons.
   - LR-6: fxNotice exists and reading time scales with text. */
const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const tick = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); return; }
  const V2 = __dirname;
  const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8'); // layout-fix3 K4 pin (LR-I2b)
  const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
  const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));

  const ruleDecls = (re) => {
    const m = html.match(re);
    if (!m) return null;
    const d = {};
    for (const part of m[1].split(';')) {
      const i = part.indexOf(':');
      if (i > 0) d[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return d;
  };

  // ---------- round 5 I2 ports ----------
  const grid = ruleDecls(/\.grid\{([^}]*)\}/);
  ok(!!grid && /auto-fit/.test(grid['grid-template-columns'] || '') && !/auto-fill/.test(grid['grid-template-columns'] || ''),
    'LR-I2a: I2 — the selection grid collapses unused tracks (auto-fit), so few-candidate sheets use the full width');
  const itext = ruleDecls(/\.gcard \.itext\{([^}]*)\}/);
  // layout-fix J1 superseded the clamp with full in-tile text;
  // layout-fix3 K4 (user decision) retires the in-tile text
  // entirely: the rule survives only as display:none so stale
  // markup renders inert, and candidates carry no effect text.
  ok(!!itext && itext['display'] === 'none' && !clientSrc.includes('class="itext"'),
    'LR-I2b: I2 successor (layout-fix3 K4) — candidate tiles carry NO effect text; the retired .itext rule is display:none');

  // ---------- LR-1 / LR-2: the slim mid band ----------
  const midbar = ruleDecls(/#midbar\{([^}]*)\}/);
  const phaseinfo = ruleDecls(/#phaseinfo\{([^}]*)\}/);
  const logline = ruleDecls(/#logline\{([^}]*)\}/);
  // layout-fix J2 supersedes the frozen height with a 62px minimum
  // (inflated system fonts grow the band; the fit loop absorbs it).
  ok(!!midbar && midbar['min-height'] === '62px' && !('height' in midbar) && !!phaseinfo && phaseinfo['line-height'] === '1.25' && phaseinfo['font-size'] === '17px',
    'LR-1: the mid band is one fitted 62px-minimum row; the phase name stands at 17px with a fitted line box');
  // layout-fix3 K2 supersedes the two-line clamp: it silently
  // cut the TAIL of long lines (verb endings, destinations) in
  // real play. No clamp at all now — fitLogline shrinks the
  // whole line to the two-line budget and the band grows (and
  // is re-absorbed) if a line still needs a third.
  ok(!!logline && !('height' in logline) && logline['line-height'] === '1.35' && !('-webkit-line-clamp' in logline) && logline['font-size'] === '12.5px',
    'LR-2: the latest-event line is 12.5px with NO line clamp (layout-fix3 K2 — the tail is never cut)');

  // ---------- boot ----------
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const doc = window.document;
  window.Audio = class { constructor(src) { this.src = src; } play() { return Promise.resolve(); } pause() {} };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (url) => String(url).includes('ocgcore.wasm')
    ? { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf }
    : { ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf };
  const inject = (file) => {
    const s = doc.createElement('script');
    s.textContent = fs.readFileSync(path.join(V2, file), 'utf8');
    doc.body.appendChild(s);
  };
  inject('build/ocgcore.js');
  const origFactory = window.OcgCoreModule;
  window.OcgCoreModule = (opts) => origFactory(Object.assign({}, opts, { wasmBinary }));
  inject('engine.js');
  inject('duel-worker.js');
  inject('client.js');
  const ev = (src) => window.eval(src);
  for (let i = 0; i < 100 && !doc.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await new Promise(r => setTimeout(r, 50));
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'LR-0: client boots');

  // ---------- LR-3: the board floor ----------
  for (const b of [592, 612, 652, 692, 752, 836, 892]) {
    const r = ev('(() => { const L = computeLayout(390, ' + b + '); return { w: L.tileW, lw: legacyTileW(390, ' + b + '), ch: L.contentH, mode: L.mode }; })()');
    ok(r.w >= r.lw, 'LR-3a budget ' + b + ': tileW ' + r.w + ' >= legacy ' + r.lw + ' (board art never shrinks)');
    // computeLayout fills its budget (the 8px safety lives in
    // layoutFit's budget derivation, checked by test-layout):
    // contentH meets the budget with rounding slack only.
    ok(r.ch <= b && b - r.ch < 16, 'LR-3b budget ' + b + ': contentH ' + r.ch + ' fills the budget (slack ' + (b - r.ch) + ' < 16)');
  }
  ok(ev('computeLayout(390, 612).mode') === 'compact' && ev('computeLayout(390, 836).mode') === 'full',
    'LR-3c: the budget tiers switch at 700 (compact below, full above)');

  // ---------- LR-4: marks chip ----------
  const chip = ev('(() => { const mon = Object.keys(DATA.cards).map(Number).find(c => (DATA.cards[c].type & 1) && DATA.cards[c].attribute && DATA.cards[c].race); return marksChipHTML(mon); })()');
  ok(typeof chip === 'string' && chip.includes('assets/icons/attr-') && chip.includes('assets/icons/star.png') && chip.includes('assets/icons/race-'),
    'LR-4a: a monster\'s marks chip carries attribute + star + race icons');
  const spellChip = ev('(() => { const sp = Object.keys(DATA.cards).map(Number).find(c => (DATA.cards[c].type & 0x6) && !(DATA.cards[c].type & 1)); return marksChipHTML(sp); })()');
  ok(spellChip === '', 'LR-4b: spells/traps carry no marks chip');

  // ---------- LR-6: reading time + notice ----------
  ok(ev('typeof fxNotice') === 'function' && ev('fxReadMs("あ")') < ev('fxReadMs("あ".repeat(30))'),
    'LR-6a: fxNotice exists; reading time scales with the text it carries');
  ev('fxNotice("《テスト》が破壊された", "相手のターン｜効果で破壊")');
  ok(!!doc.querySelector('#fxlayer .fx-notice'), 'LR-6b: the notice floats in the FX layer (not a prompt — nothing to tap)');

  // ---------- status bars render ----------
  ev('(() => { const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [{}], deckCount: 38, lp: 8000 }); const b = { players: [P(), P()], phaseName: "MAIN1", turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], dlog: [] }; duelState = b; render(b); return true; })()');
  ok(doc.getElementById('oppDeckName').textContent.length > 0 && doc.getElementById('myDeckName').textContent.length > 0,
    'LR-7a: both status bars name their deck');
  ok(doc.getElementById('oppHandN').textContent === '1', 'LR-7b: the opponent hand count rides the top bar chip');
  ok(/^ターン\d+・自分$/.test(doc.getElementById('turninfo').textContent), 'LR-7c: the mid band states the turn count and owner compactly (the phase name is never the one ellipsized)');

  // ---------- LR-5: dock peek + button-grade dismissals ----------
  const KELDO = 63542003, MUDORA = 99937011;
  ev('fxSettings.resp = "auto"');
  ev('(() => { const s = duelState; s.chain = [{ code: ' + KELDO + ', con: 1, loc: 4, seq: 0, desc: 0 }]; window.__lrdone = false; uiAnswer({ name: "SELECT_CHAIN", forced: false, entries: [{ code: ' + MUDORA + ', con: 0, loc: 8, seq: 0, desc: ' + (MUDORA * 1048576) + ' }] }, s).then(() => { window.__lrdone = true; }); return true; })()');
  for (let i = 0; i < 60 && doc.getElementById('dock').className !== 'on'; i++) await tick(50);
  ok(doc.getElementById('dock').className === 'on', 'LR-5a: the chain dock dispatched');
  ok(!!doc.querySelector('#dock .cause .causename'), 'LR-5b: the cause card stands as its own row in the dock');
  const dis = doc.querySelector('#dock button.disbtn[data-dismiss]');
  const duelDis = doc.querySelector('#dock button.disbtn[data-dueldismiss]');
  ok(!!dis && !!duelDis, 'LR-5c: both 聞かない controls are real buttons (not text links)');
  const pk = doc.getElementById('dock-peek');
  ok(!!pk, 'LR-5d: the dock header carries the 盤面を見る control');
  pk.click();
  ok(doc.getElementById('app').classList.contains('dockpeek') && doc.getElementById('dock').className === 'on',
    'LR-5e: peeking rides on #app; the dock class contract (exactly "on") is untouched');
  pk.click();
  ok(!doc.getElementById('app').classList.contains('dockpeek'), 'LR-5f: a second tap returns the dock');
  doc.querySelector('#dock #chain-pass').click();
  for (let i = 0; i < 40 && !ev('window.__lrdone'); i++) await tick(50);
  ok(ev('window.__lrdone') === true && !doc.getElementById('app').classList.contains('dockpeek'),
    'LR-5g: the prompt answers normally and peek state is cleaned up');

  // ---------- I3 port: captureDLog under worker-style cloned states ----------
  ev('dlogPrev = []; histEntries = []; window.__feed = (entries) => { captureDLog({ dlog: JSON.parse(JSON.stringify(entries)) }); };');
  const info = (s, turn) => ({ turn: turn || 1, tp: 0, ph: null, k: 'info', cid: 0, sol: 0, s });
  const stream = [info('行A'), info('行B'), info('行C'), info('行D')];
  ev('window.__feed(' + JSON.stringify(stream) + ')');
  ok(ev('histEntries.length') === 4, 'LR-I3a: the first capture takes the stream once (4 entries)');
  ev('window.__feed(' + JSON.stringify(stream) + ')');
  ok(ev('histEntries.length') === 4, 'LR-I3b: a re-render of the cloned same state appends NOTHING (pre-fix: doubled to 8)');
  stream.push(info('行E', 2), info('行F', 2), info('行G', 2));
  ev('window.__feed(' + JSON.stringify(stream) + ')');
  ok(ev('histEntries.length') === 7, 'LR-I3c: appended entries are taken exactly once (7)');
  stream.push(info('相手：カードをセット', 2), info('相手：カードをセット', 2));
  ev('window.__feed(' + JSON.stringify(stream) + ')');
  ok(ev('histEntries.length') === 9 && ev('histEntries.filter(e => e.text === "相手：カードをセット").length') === 2,
    'LR-I3d: legitimately identical appended entries are both kept (9, the pair intact)');
  const slid = stream.slice(3).concat([info('行H', 3), info('行I', 3), info('行J', 3)]);
  ev('window.__feed(' + JSON.stringify(slid) + ')');
  ok(ev('histEntries.length') === 12 && ev('histEntries.filter(e => e.text === "行H").length') === 1 && ev('histEntries.filter(e => e.text === "行A").length') === 1,
    'LR-I3e: a head-trim slide captures only the new tail (12; markers appear once)');
  ev('openLogHistory()');
  const rows = doc.querySelectorAll('#sheet .loghistrow').length;
  const sub = (doc.querySelector('#sheet .sub') || {}).textContent || '';
  ok(rows === 12 && /全 12 件/.test(sub), 'LR-I3f: the history sheet renders the captured stream once each (12 rows); got rows=' + rows + ' sub=' + sub);

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL LAYOUT-REDESIGN CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
