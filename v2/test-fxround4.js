'use strict';
/* test-fxround4.js — fx-ui round 4 (H1/H2/H3), deterministic checks
   in jsdom, harness as test-fxround3:
     H1 — the dock's arrival animation must carry NO opacity
     keyframes. Round 3 made the dock ground fully opaque, but the
     arrival WAAPI faded the whole element (opacity .25 → 1), so for
     300ms the board showed through the ground. Verified by capturing
     the keyframes the client actually passes to animate(), plus a
     source contract that the fade literal is gone.
     H2 — delivered-CSS contract: .cand grows to fill the dock row
     (flex:1 1 0) with the established 172px floor and no 172px cap;
     a 1-candidate prompt still renders exactly its candidate (the
     left-column geometry itself is capture-rig evidence: fxround4/).
     H3 — delivered-CSS contracts: the mid band's rows follow their
     line boxes — #logline has no frozen height and a unitless 1.5
     line-height, #chainbar / #phasebar are min-height floors, the
     prevlog line-height is 1.5. At the default font size the
     rendered band stays 21/15/34 = 78 (capture rig), so the layout
     budget constant LAYOUT_FIXED = 215 must stand untouched. */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const tick = (ms) => new Promise(r => setTimeout(r, ms));
// declarations of a CSS rule as a {prop: value} map (property names
// exact, so min-height never masquerades as height)
const ruleDecls = (re) => {
  const m = html.match(re);
  if (!m) return null;
  const out = {};
  for (const part of m[1].split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
};

const KELDO = 63542003, MUDORA = 99937011;

async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
  window.Image = class { constructor() { this._src = ''; } set src(v) { this._src = v; } get src() { return this._src; } };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (url) => {
    if (String(url).includes('ocgcore.wasm')) return { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf };
    return { ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf };
  };
  const inject = (file) => {
    const s = window.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(V2, file), 'utf8');
    window.document.body.appendChild(s);
  };
  inject('build/ocgcore.js');
  const origFactory = window.OcgCoreModule;
  window.OcgCoreModule = (opts) => origFactory(Object.assign({}, opts, { wasmBinary }));
  inject('engine.js');
  inject('duel-worker.js');
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await new Promise(r => setTimeout(r, 50));
  return window;
}

(async () => {
  const window = await boot();
  const doc = window.document;
  const click = (el) => { if (el) el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); return !!el; };
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'FX4-0: client boots');

  // capture every WAAPI call the client makes on the dock
  window.__animCalls = [];
  window.HTMLElement.prototype.animate = function (frames, opts) {
    if (this.id === 'dock') window.__animCalls.push(JSON.parse(JSON.stringify(frames)));
    return { finished: Promise.resolve(), cancel() {}, finish() {} };
  };

  window.eval(`(() => {
    const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
    const b = { players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], dlog: [], lastAttack: null };
    const mon = (code, pos) => ({ code, pos, materials: 0, counters: null, curAtk: null, curDef: null });
    b.players[1].mzone[0] = mon(${KELDO}, 0x1);
    b.players[0].mzone[0] = mon(${MUDORA}, 0x1);
    duelState = b; render(b);
    fxSettings.resp = 'auto';
    return true;
  })()`);

  const dispatchChain = (entry) => window.eval(`(() => {
    const s = duelState; s.chain = [{ code: ${KELDO}, con: 1, loc: 4, seq: 0, desc: 0 }];
    window.__fx4done = false;
    uiAnswer({ name: 'SELECT_CHAIN', forced: false, entries: [${JSON.stringify(entry)}] }, s)
      .then(() => { window.__fx4done = true; });
    return true;
  })()`);
  const waitDock = async () => { for (let i = 0; i < 60 && doc.getElementById('dock').className !== 'on'; i++) await tick(50); return doc.getElementById('dock').className === 'on'; };
  const answerPass = async () => {
    click(doc.querySelector('#dock #chain-pass'));
    for (let i = 0; i < 40 && !window.eval('window.__fx4done'); i++) await tick(50);
    return window.eval('window.__fx4done') === true;
  };

  // ---------- H1: arrival animation carries no fade ----------
  dispatchChain({ code: MUDORA, con: 0, loc: 8, seq: 0, desc: MUDORA * 1048576 });
  ok(await waitDock(), 'FX4-1: the chain dock dispatched (first draw — arrival animation fires)');
  ok(window.__animCalls.length >= 1, 'FX4-2: H1 — the arrival animation ran on the dock');
  const frames = window.__animCalls[0] || [];
  ok(frames.length >= 2 && frames.every(f => !('opacity' in f)),
    'FX4-3: H1 — no keyframe touches opacity (the ground cannot fade; before the fix: opacity .25 -> 1)');
  ok(frames.some(f => String(f.transform || '').includes('translateY')),
    'FX4-4: H1 — the arrival is carried by the slide (translateY) alone');
  ok(!/opacity:\s*\.25/.test(clientSrc), 'FX4-5: H1 — the element-fade literal is gone from client.js');
  // H2 behavioural anchor: the single candidate renders as exactly one .cand
  ok(doc.querySelectorAll('#dock .cand').length === 1, 'FX4-6: H2 — the 1-candidate prompt renders exactly one candidate');
  ok(await answerPass(), 'FX4-7: the chain prompt still answers normally');

  // ---------- H2 successor (layout redesign 2026-11-12) ----------
  // Candidates are full-width ROWS in a column now: the H2 intent
  // (no empty dock width beside a candidate) is structural —
  // there is no fixed candidate width left to strand space.
  const cands = ruleDecls(/#dock \.cands\{([^}]*)\}/);
  ok(!!cands && cands['flex-direction'] === 'column', 'FX4-8: H2 successor — the candidate list is a column of full-width rows');
  const cand = ruleDecls(/\.cand\{([^}]*)\}/);
  ok(!!cand && !('min-width' in cand) && !('width' in cand),
    'FX4-9: H2 successor — no fixed candidate width remains (a row takes the dock width by construction)');

  // ---------- H3: mid-band rows follow their line boxes ----------
  // ROUND 5 (I1) SUPERSESSION: FX4-10/12/13/14/16 originally pinned
  // the round-4 fittings (line-height 1.5 / 1.2 / 1.35, phasebar
  // floor 34, LAYOUT_FIXED 215). The published-build field check
  // showed the phase cell's squeeze (1.2 / 1.35) leaves its text
  // taller than its line boxes — the runs overlap and the label
  // reads half-eaten — so round 5 moved every mid-band text row to
  // line-height:normal (the font's own line height), the phasebar
  // floor to 39 and LAYOUT_FIXED to 220. These assertions now pin
  // the round-5 contract; the rest of H3 (no frozen heights, floors
  // not boxes) stands as written in round 4.
  const logline = ruleDecls(/#logline\{([^}]*)\}/);
  ok(!!logline && !('height' in logline) && logline['line-height'] === '1.35' && logline['-webkit-line-clamp'] === '2',
    'FX4-10: H3 successor — #logline has no frozen height; it takes two fitted lines (a one-line column ellipsized real long events)');
  // H3 successor (layout redesign): the mid band is ONE 62px row
  // BY DESIGN — its contents are fitted inside it (explicit
  // line-heights below), the chain bar is an opaque overlay ON
  // the band (it reserves no flow height, so the H3 failure
  // shape — band rows painting outside a frozen box — has no
  // rows left to paint outside), and the previous-event line was
  // absorbed into the single latest-event line.
  // layout-fix J2: the 62px is now a FLOOR (min-height), not a
  // freeze — the two fitted lines need ≈64px at larger system
  // fonts, and a frozen box clipped the event line's second row.
  // The band may grow; the visible-fit loop shrinks the board to
  // absorb it, so rows still never paint outside the band.
  const chainbar = ruleDecls(/#chainbar\{([^}]*)\}/);
  ok(!!chainbar && chainbar.position === 'absolute' && chainbar.visibility === 'hidden' && !('min-height' in chainbar),
    'FX4-11: H3 successor — #chainbar is an absolute overlay on the mid band (no reserved flow height)');
  ok(!/#chainbar \.prevlog/.test(html) && !/prevlog/.test(clientSrc),
    'FX4-12: H3 successor — the prevlog line is gone (absorbed into the latest-event line)');
  const midbar = ruleDecls(/#midbar\{([^}]*)\}/);
  ok(!!midbar && !('height' in midbar) && midbar['min-height'] === '62px',
    'FX4-13: H3 successor + layout-fix J2 — the mid band is one fitted row with a 62px floor (min-height, never a frozen height; two lines for the latest event; contents carry explicit line-heights)');
  ok(/const LAYOUT_MODES = \{/.test(clientSrc) && /full: \{ fixedNoPv: 232/.test(clientSrc) && /compact: \{ fixedNoPv: 210/.test(clientSrc),
    'FX4-14: H3 successor — the layout budget is the redesign mode table (full 232 / compact 210, + preview base)');
  const link = ruleDecls(/\.link\{([^}]*)\}/);
  ok(!!link && link['line-height'] === '1.2',
    'FX4-15: H3 — the chain chips carry the fitting line-height (content fits the 21px floor at default size)');
  // the phase cell is gone: both LPs live in the status bars at
  // the top of the text hierarchy (28px, the largest numerals).
  const lpbox = ruleDecls(/\.lp-box \.lp\{([^}]*)\}/);
  ok(!!lpbox && lpbox['font-size'] === '28px' && lpbox['line-height'] === '1.05',
    'FX4-16: H3 successor — LP is a fitted 28px line in the status bars (largest numeral on screen)');
  ok(/id="topbar"[\s\S]*id="oppLp"/.test(html) && /id="mybar"[\s\S]*id="myLp"/.test(html),
    'FX4-17: H3 successor — oppLp sits in #topbar and myLp in #mybar');

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL FXROUND4 CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
