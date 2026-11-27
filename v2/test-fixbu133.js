'use strict';
/* test-fixbu133.js — fix-bu133-1128 (run 27, 2026-11-28).
 *
 * BU-133: at the finishing blow the LP band briefly showed a NEGATIVE
 * value. Filed samples (parent re-checked in the run-27 logs):
 * real play h700 myLp "-51", probe-bu131 "-451", "-1340", "-300".
 *
 * Mechanism (two display paths, both display-side only):
 *   (a) fxLpCount: the engine keeps overkill LP (negative) in the
 *       snapshot until the trailing MSG_WIN batch, and the LP loop
 *       calls fxLpCount(p, cur.lp[p]) with that negative target —
 *       the count interpolated start -> negative and onDone WROTE
 *       the negative value. It stayed until the finisher drain
 *       (trailing batch) landed on 0.
 *   (b) render(): writes op.lp / me.lp straight to the plate when
 *       no LP scene is busy. In the same-batch winner case the
 *       finisher is created in fxProcess (AFTER render in onUpdate)
 *       and fxLpCount then returns early (finisher owns the seat),
 *       so a negative write from render stood until the finisher
 *       drain started at t=1600.
 * The finisher drain itself already clamped (Math.max(0, ...)).
 *
 * Adopted: clamp the DISPLAY at 0 in both sinks — fxLpCount's
 * target at entry (a lethal count runs start -> 0, MD-style) and
 * render()'s plate write. The engine LP, the lpchange records and
 * the overkill accounting (BU-77: the result screen's "N の超過
 * ダメージ" is computed from the raw value) are untouched.
 * Rejected: clamping in the engine — the overkill number is real
 * data (result screen, BU-77 accounting); only the plate lies.
 *
 * Pinned by source + jsdom behaviour below; the live proof is the
 * Chromium driver run (play-2026-11-28.js, RESP='every' after the
 * driver fix): its SNAP logs myLp/oppLp every step, and no
 * negative sample may appear.
 */
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- BU-133 source pins ----------
{
  const start = clientSrc.indexOf('function fxLpCount(con, to, startAtFx, opts)');
  const end = clientSrc.indexOf('// BU-72: fxHealFloat is abolished', start);
  ok(start > 0 && end > start, 'F133a: the fxLpCount body is found (setup)');
  if (start > 0 && end > start) {
    const body = clientSrc.slice(start, end);
    ok(body.includes('to = Math.max(0, to);'), 'F133b: fxLpCount clamps its display target at 0 on entry');
    ok(body.includes('BU-133'), 'F133c: the fxLpCount clamp is documented as BU-133');
    ok(body.includes('if (start != null && start < 0) { start = 0; fxLpShown[con] = 0; }'),
      'F133d: a leaked negative shown value is normalised to 0 at entry');
    ok(body.includes('fxLpShown[con] = to; el.textContent = to;'),
      'F133e: the early-return / onDone writes use the (clamped) target');
  }
  const rStart = clientSrc.indexOf('function render(state)');
  const rEnd = clientSrc.indexOf('// LP plates (BU-73)', rStart);
  ok(rStart > 0 && rEnd > rStart, 'F133f: the render() LP-plate block is found (setup)');
  if (rStart > 0 && rEnd > rStart) {
    const body = clientSrc.slice(rStart, rEnd);
    ok(body.includes("$('oppLp').textContent = Math.max(0, op.lp);"),
      'F133g: render() clamps the opponent LP plate at 0');
    ok(body.includes("$('myLp').textContent = Math.max(0, me.lp);"),
      'F133h: render() clamps the own LP plate at 0');
    ok(body.includes('BU-133'), 'F133i: the render() clamp is documented as BU-133');
  }
  ok(clientSrc.includes('const v = Math.max(0, Math.round(drainFrom * (1 - u * u)));'),
    'F133j: the finisher drain still clamps at 0 (pre-existing, unchanged)');
  ok(clientSrc.includes("fxRecord('lpchange', { player: p, from: prev.lp[p], to: cur.lp[p] });"),
    'F133k: lpchange still records the RAW engine values (no engine-side clamp)');
  ok(clientSrc.includes("'（' + (-myLp) + ' の超過ダメージ）'"),
    'F133l: the result screen still computes overkill from the raw negative LP');
}

// ---------- live behaviour in jsdom ----------
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
  inject('neuron.js');
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await sleep(50);
  return window;
}

// synthetic state factory (shape mirrors engine.js state; cf. test-fx.js)
function fakeState(lp0, lp1, winner) {
  const P = (lp) => ({ mzone: [null, null, null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 40, lp });
  return { players: [P(lp0), P(lp1)], phaseName: '', turnCount: 1, chain: [], solvingLink: 0, winner: winner != null ? winner : null, turnPlayer: 0, log: [], dlog: [] };
}

(async () => {
  const window = await boot();
  const doc = window.document;
  const ev = (src) => window.eval(src);
  const fx = window.__fx;
  const plate = (con) => doc.getElementById(con === 0 ? 'myLp' : 'oppLp').textContent;
  const plateNum = (con) => { const t = plate(con); const n = parseInt(t, 10); return Number.isNaN(n) ? null : n; };

  // sample the plate while a count scene runs; returns every value seen
  async function samplePlate(con, ms) {
    const seen = [];
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const n = plateNum(con); if (n != null) seen.push(n); await sleep(50); }
    return seen;
  }
  // one lethal case: baseline at `from`, then a damage batch to `to`
  // (winner still null: the trailing MSG_WIN batch has not arrived —
  // the exact BU-133 window). Returns the values the plate showed.
  async function lethalCase(from, to, label) {
    ev('__fx.reset()');
    fx.process([], fakeState(from, 8000));
    await sleep(900); // let the baseline settle (no count runs: first call is the baseline)
    fx.process([{ kind: 'damage', player: 0, amount: from - to }], fakeState(to, 8000));
    const seen = await samplePlate(0, 1200);
    const min = seen.length ? Math.min(...seen) : null;
    ok(min != null && min >= 0, label + ': plate never negative during the lethal count (min ' + min + ', seen ' + seen.slice(0, 8).join(',') + (seen.length > 8 ? '…' : '') + ')');
    ok(plate(0) === '0', label + ': plate lands on 0 (got ' + plate(0) + ')');
    ok(ev('__fx.lpShown(0)') === 0, label + ': lpShown is 0 (got ' + ev('__fx.lpShown(0)') + ')');
    return seen;
  }

  // the three filed magnitudes (run 27: -51 / -451 / -1340)
  await lethalCase(450, -51, 'F133m(-51)');
  await lethalCase(1400, -451, 'F133n(-451)');
  await lethalCase(800, -1340, 'F133o(-1340)');

  // render() path: same-batch winner — render writes the final value
  // directly, fxLpCount returns early (finisher owns the seat).
  {
    ev('__fx.reset()');
    fx.process([], fakeState(8000, 8000));
    await sleep(300);
    ev('render(' + JSON.stringify(fakeState(-300, 8000, 1)) + ')');
    ok(plate(0) === '0', 'F133p(render): same-batch winner render shows 0, not -300 (got ' + plate(0) + ')');
    ev('render(' + JSON.stringify(fakeState(8000, -1250, 0)) + ')');
    ok(plate(1) === '0', 'F133q(render): opponent plate shows 0, not -1250 (got ' + plate(1) + ')');
  }

  // regression: non-lethal damage still counts and shows its numeral
  {
    ev('__fx.reset()');
    fx.process([], fakeState(8000, 8000));
    await sleep(300);
    const before = ev('__fx.log.length');
    fx.process([{ kind: 'damage', player: 0, amount: 350 }], fakeState(7650, 8000));
    await samplePlate(0, 1000);
    ok(plate(0) === '7650', 'F133r: non-lethal damage still lands on 7650 (got ' + plate(0) + ')');
    const recs = ev('__fx.log').slice(before);
    ok(recs.some(r => r.kind === 'dmgnum' && r.amount === 350), 'F133s: non-lethal damage still emits its −350 numeral');
  }

  // regression: a heal still counts up and shows its numeral
  {
    const before = ev('__fx.log.length');
    fx.process([], fakeState(8000, 8000));
    await sleep(300);
    fx.process([], fakeState(7650, 8000)); // set up a lowered baseline first (counts down, fine)
    await samplePlate(0, 1000);
    const b2 = ev('__fx.log.length');
    fx.process([], fakeState(8000, 8000)); // heal: delta +350, no damage event
    await samplePlate(0, 1000);
    ok(plate(0) === '8000', 'F133t: heal still lands on 8000 (got ' + plate(0) + ')');
    const recs = ev('__fx.log').slice(b2);
    ok(recs.some(r => r.kind === 'healnum' && r.amount === 350), 'F133u: heal still emits its +350 numeral');
    void before;
  }

  ok(!ev('__fx.error'), 'F133v: no FX error across the cases (got ' + ev('__fx.error') + ')');
  console.log(failures === 0 ? 'ALL FIXBU133 CHECKS PASSED' : failures + ' FIXBU133 CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
