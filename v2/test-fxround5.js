'use strict';
/* test-fxround5.js — FX/UI round 5 regression (I1/I2/I3).
   I1: the mid-band text rows must size from the font's natural
       line height (line-height:normal), never a squeeze below it —
       round 4's 1.2/1.35 fittings left the phase label's text
       taller than its line box (measured on the live build: 15px
       of text in a 12px box, LP 24px in 21.6px, the runs
       overlapping), and the published-build field check showed
       the label half-eaten by the LP row. The phase bar's floor
       and the layout budget follow the natural stack (39 / 220).
   I2: the selection grid must collapse unused tracks (auto-fit)
       so 1-2 candidate sheets use the sheet width (the chain
       dock's round-4 defect class), and the in-tile effect text
       gets a readable size/budget (12px, 8 lines).
   I3: captureDLog must align the detailed-history stream by
       VALUE. The state arrives through the worker transport,
       which structured-clones every snapshot, so the old anchor
       on object identity (lastIndexOf) never matched and the
       whole stream was re-appended on EVERY render — the history
       sheet filled with repeated copies (published build: the
       500-entry cap, 222/240 rendered rows duplicated). The
       behavioral checks below feed captureDLog JSON-cloned
       states, exactly like the worker path; on the pre-fix tree
       FX5-7 fails (the count doubles on a plain re-render). */
const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

async function main() {
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); return; }
  const V2 = __dirname;
  const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
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

  // ---------- I1 successor (layout redesign 2026-11-12) ----------
  // The phase cell I1 fitted no longer exists: the redesign
  // retired the whole phasebar structure. I1's defect — text
  // taller than its line box, glyphs half-eaten — is answered
  // structurally now.
  // BU-73 successor (2026-11-13): the status bars and the mid
  // band are gone too — the LP stands on the central band's
  // plates (full 28px / compact 24px, fitted line), the mid
  // band's rows became the header (81px floor), and the latest
  // event takes two lines at full type (no clamp, no shrink).
  const lpplate = ruleDecls(/\.lpplate \.lp\{([^}]*)\}/);
  ok(!!lpplate && lpplate['font-size'] === '28px' && lpplate['line-height'] === '1',
    'FX5-1: I1 successor (BU-73) — the LP is a fitted 28px line (line-height 1) on the central band plates (full tier)');
  const logline = ruleDecls(/#logline\{([^}]*)\}/);
  ok(!!logline && !('height' in logline) && logline['line-height'] === '1.25' && !('-webkit-line-clamp' in logline) && !/function fitLogline/.test(clientSrc) && !/#chainbar \.prevlog/.test(html) && !/prevlog/.test(clientSrc),
    'FX5-2: I1 successor (BU-73, ex layout-fix3 K2) — the latest-event line stands IN FULL at full type with no line clamp (the clamp cut event tails) and no whole-line shrink; the prevlog line is gone (absorbed into it)');
  const header = ruleDecls(/#header\{([^}]*)\}/);
  ok(!!header && !('min-height' in header) && !('height' in header) && /const LAYOUT_MODES = \{/.test(clientSrc),
    'FX5-3: I1 successor (BU-73) — the header carries the old band\'s role at 81px by construction (no height of its own) and the budget is the mode table');
  const grid = ruleDecls(/\.grid\{([^}]*)\}/);
  ok(!!grid && /auto-fit/.test(grid['grid-template-columns'] || '') && !/auto-fill/.test(grid['grid-template-columns'] || ''),
    'FX5-4: I2 — the selection grid collapses unused tracks (auto-fit), so few-candidate sheets use the full width');
  const itext = ruleDecls(/\.gcard \.itext\{([^}]*)\}/);
  // layout-fix3 K4 supersedes J1 (user decision 2026-11-12): the
  // full-text-in-tile design was rejected in real play ("a wall
  // of text") — tiles are compact and uniform with NO effect
  // text, the full text lives in the detail modal, and the dock
  // candidate keeps its text in a fixed-height scrolling region.
  // The retired rule may only survive as display:none.
  ok(!!itext && itext['display'] === 'none',
    'FX5-5: I2 successor (layout-fix3 K4) — the in-tile effect text is RETIRED (display:none); candidate tiles carry no effect text');

  // ---------- I3: captureDLog under worker-style cloned states ----------
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
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'FX5-6: client boots');

  // Feed captureDLog a stream that is JSON-cloned between calls —
  // the exact condition the Web Worker transport creates (every
  // snapshot a deep copy; no object identity survives).
  ev('dlogPrev = []; histEntries = []; window.__feed = (entries) => { captureDLog({ dlog: JSON.parse(JSON.stringify(entries)) }); };');
  const info = (s, turn) => ({ turn: turn || 1, tp: 0, ph: null, k: 'info', cid: 0, sol: 0, s });
  const stream = [info('行A'), info('行B'), info('行C'), info('行D')];
  ev('window.__feed(' + JSON.stringify(stream) + ')');
  ok(ev('histEntries.length') === 4, 'FX5-7a: I3 — the first capture takes the stream once (4 entries)');
  ev('window.__feed(' + JSON.stringify(stream) + ')'); // a plain re-render of the same state
  ok(ev('histEntries.length') === 4, 'FX5-7b: I3 — a re-render of the cloned same state appends NOTHING (pre-fix: doubled to 8)');
  stream.push(info('行E', 2), info('行F', 2), info('行G', 2));
  ev('window.__feed(' + JSON.stringify(stream) + ')');
  ok(ev('histEntries.length') === 7, 'FX5-7c: I3 — appended entries are taken exactly once (7)');
  stream.push(info('相手：カードをセット', 2), info('相手：カードをセット', 2)); // legitimate identical entries
  ev('window.__feed(' + JSON.stringify(stream) + ')');
  ok(ev('histEntries.length') === 9 && ev('histEntries.filter(e => e.text === "相手：カードをセット").length') === 2,
    'FX5-7d: I3 — legitimately identical appended entries are both kept (9, the pair intact)');
  // Head-trim slide (the mirror caps at 600): drop the first 3,
  // append 3 new — only the 3 new ones may be captured.
  const slid = stream.slice(3).concat([info('行H', 3), info('行I', 3), info('行J', 3)]);
  ev('window.__feed(' + JSON.stringify(slid) + ')');
  ok(ev('histEntries.length') === 12 && ev('histEntries.filter(e => e.text === "行H").length') === 1 && ev('histEntries.filter(e => e.text === "行A").length') === 1,
    'FX5-7e: I3 — a head-trim slide captures only the new tail (12; markers appear once)');
  // The modal renders what was captured — once each.
  ev('openLogHistory()');
  const rows = doc.querySelectorAll('#sheet .loghistrow').length;
  const sub = (doc.querySelector('#sheet .sub') || {}).textContent || '';
  ok(rows === 12 && /全 12 件/.test(sub), 'FX5-8: I3 — the history sheet renders the captured stream once each (12 rows, sub 全 12 件); got rows=' + rows + ' sub=' + sub);

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL FXROUND5 CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
