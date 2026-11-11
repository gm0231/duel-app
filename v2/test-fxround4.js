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

  // ---------- H2: candidate growth contract ----------
  const cand = ruleDecls(/\.cand\{([^}]*)\}/);
  ok(!!cand && cand.flex === '1 1 0', 'FX4-8: H2 — candidates grow to fill the dock row (flex:1 1 0)');
  ok(!!cand && cand['min-width'] === '172px' && !('max-width' in cand),
    'FX4-9: H2 — the 172px floor stands and the 172px cap is gone (3+ candidates keep the horizontal scroll)');

  // ---------- H3: mid-band rows follow their line boxes ----------
  const logline = ruleDecls(/#logline\{([^}]*)\}/);
  ok(!!logline && !('height' in logline) && logline['line-height'] === '1.5',
    'FX4-10: H3 — #logline has no frozen height; its line box scales with the used font size (1.5)');
  const chainbar = ruleDecls(/#chainbar\{([^}]*)\}/);
  ok(!!chainbar && chainbar['min-height'] === '21px' && !('height' in chainbar),
    'FX4-11: H3 — #chainbar is a 21px floor, not a frozen 21px box');
  const prevlog = ruleDecls(/#chainbar \.prevlog\{([^}]*)\}/);
  ok(!!prevlog && prevlog['line-height'] === '1.5', 'FX4-12: H3 — the chainbar prevlog line box scales too (1.5)');
  const phasebar = ruleDecls(/#phasebar\{([^}]*)\}/);
  ok(!!phasebar && phasebar['min-height'] === '34px' && !('height' in phasebar),
    'FX4-13: H3 — #phasebar is a 34px floor, not a frozen 34px box');
  ok(/const LAYOUT_FIXED = 215;/.test(clientSrc),
    'FX4-14: H3 — the layout budget stands (default-font rendered band is unchanged at 78px; growth is fit-loop absorbed)');
  const link = ruleDecls(/\.link\{([^}]*)\}/);
  ok(!!link && link['line-height'] === '1.2',
    'FX4-15: H3 — the chain chips carry the fitting line-height (content fits the 21px floor at default size)');
  const plp = ruleDecls(/#phasebar \.lp\{([^}]*)\}/);
  const pwho = ruleDecls(/#phasebar \.pwho\{([^}]*)\}/);
  ok(!!plp && plp['line-height'] === '1.35' && !!pwho && pwho['line-height'] === '1.2',
    'FX4-16: H3 — the phase cell lines are fitted (12 + 21.6 <= 34 at default size) and the label uses .pwho');
  ok(/<div class="pwho">/.test(html), 'FX4-17: H3 — the phase label markup uses the fitted class');

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL FXROUND4 CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
