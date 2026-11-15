'use strict';
/* test-fix9396d.js — follow-up round 2026-11-16 (BU-104 remainder,
 * BU-106, BU-107).
 *
 * BU-104 (remainder): fix9396c put the keep-all / anywhere rule
 * on the DOCK's text, but the breaking words live in the TRAY
 * (#chaintray .ct-cause-txt) — the small dish at bottom-right.
 * The public-build re-verification (d1c454e, 4 duels) saw the
 * tray split long names mid-word repeatedly (「ラビリンス・
 * ウォール・シ／ャドウ」「シャド／ウ」「ガーディア／ン」
 * 「チェ／ーン」「チ／ェーン」), and the re-ask ordinal split
 * as 「（2回／目）」. The pre-fix Chromium probe in this round
 * reproduced both tray splits in one live duel
 * (probe-fix9396d-pre.json: 2 of 5 tray texts bad). The rule now
 * covers the tray cause line and the floating card names'
 * two-line fallback (.ct-name.wrap2, which drops the nowrap);
 * the name inside <b> and the ordinal suffix ride as nowrap
 * units. Pinned by source + live computed style; the line-break
 * proof is the Chromium probe re-run (post-fix: 0 bad tray
 * texts expected).
 *
 * BU-106: the opponent-draw ghost flew straight from the deck
 * pile to the hand chip — across the header, over the logline
 * (probe-fix9396d pre: max 1,236 px2, every opponent draw; the
 * re-verification saw the card-back icon hide 「ロー」 of
 * 「相手：1枚ドロー」). The flight now starts below the header
 * (ghost top = live header bottom + 2) and bends at the chip's
 * x: drop below the header, slide across, rise to the chip. The
 * rise runs at the chip's x, right of the logline's right edge.
 * Pinned by source + a live fxFly keyframe walk (the sampled
 * path never intersects the measured logline rect); the wild
 * proof is the Chromium probe re-run (post-fix: maxLog 0).
 *
 * BU-107: notice text broke long names mid-word (「ゲ／ート」
 * 「シャド／ウ」「墓／地」 — 17 of 18 notices bad in one wild
 * duel, probe-fix9396d pre). Same keep-all / anywhere pair on
 * .fx-notice .nt. Pinned by source + live computed style; the
 * line-break proof is the Chromium probe re-run.
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

// ---------- source pins ----------
// BU-104: the tray's text holds words together
ok(html.includes('#chaintray .ct-cause-txt,#chaintray .ct-name{word-break:keep-all;overflow-wrap:anywhere;}'), 'D104a: the tray cause line and card names hold words together (keep-all / anywhere)');
ok(html.includes('#chaintray .ct-cause-txt b{white-space:nowrap;}'), 'D104b: the tray name inside <b> is one nowrap unit');
ok(html.includes('.ct-cause-txt .reask-n{white-space:nowrap;}'), 'D104c: the re-ask ordinal is one nowrap unit');
ok(clientSrc.includes("cause.tray += '<span class=\"reask-n\">' + sfx + '</span>';"), 'D104d: the ordinal rides the tray as a nowrap span');
ok(clientSrc.includes('cause.label += sfx;') && !clientSrc.includes("cause.label += '<span"), 'D104e: the dock label stays plain text (nbHTML escapes markup — the suffix glues into its unit there)');
// BU-106: the draw flight bends below the header
ok(clientSrc.includes('function fxFly(code, faceDown, fromPt, toPt, w, h, dur, delay, deckKey, via)'), 'D106a: fxFly takes an optional via point');
ok(clientSrc.includes('const frames = via'), 'D106b: the via builds its own keyframe path');
ok(clientSrc.includes('(via.cx - fromPt.cx)'), 'D106c: the via is an absolute layer point (translated relative to the start)');
ok(clientSrc.includes('const belowY = Math.max(fromPt.cy + 26, hbBottom + 28);'), 'D106d: the draw flight starts below the header (ghost top = header bottom + 2, live)');
ok(clientSrc.includes('const startPt = { cx: fromPt.cx, cy: belowY, w: fromPt.w, h: fromPt.h };'), 'D106e: the ghost starts at the below-header seat, not at the pile centre');
ok(clientSrc.includes('fxFly(null, true, startPt, toPt, 40, 52, undefined, undefined, undefined, { cx: toPt.cx, cy: belowY });'), 'D106f: the draw flight bends at the chip x');
ok(!clientSrc.includes('if (fromPt && toPt) fxFly(null, true, fromPt, toPt, 40, 52);'), 'D106g: the old straight-across draw flight is gone');
// BU-106 (second instance): hand-to-field flights from the chip
ok(clientSrc.includes('function fxChipVia(fromPt, w, h)'), 'D106n: the chip-bend helper exists');
ok(clientSrc.includes('if (fromPt.cy - h / 2 >= hbBottom) return null;'), 'D106o: flights starting below the header keep the straight path (own seat)');
ok(clientSrc.includes('return { cx: fromPt.cx, cy: hbBottom + h / 2 + 2 };'), 'D106p: the bend drops vertically at the chip x to below the header');
ok((clientSrc.match(/fxChipVia\(fromPt, toPt\.w - 2, toPt\.h - 24\)/g) || []).length === 3, 'D106q: the three hand-to-field flights (summon / special summon / set) bend at the chip');
// BU-107: the notice's text holds words together
ok(html.includes('.fx-notice .nt{font-size:12.5px;font-weight:800;color:#ffe9a8;line-height:1.3;letter-spacing:.02em;word-break:keep-all;overflow-wrap:anywhere;}'), 'D107a: the notice text holds words together (keep-all / anywhere)');

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

const CHAIN_SOLVED_DRAW = { prompt: { name: 'SELECT_CHAIN', player: 0, forced: false,
    entries: [{ code: 99937011, con: 0, loc: 4, seq: 1, pos: 1, desc: 104791551246337, mode: 0 }],
    context: null, trigger: { kind: 'solved', code: 62411811, con: 1, turn: 1, phase: 'DRAW' }, retryCount: 0 },
  state: { chain: [], turnCount: 1, turnPlayer: 0, phaseName: 'DRAW' } };

(async () => {
  const window = await boot();
  const doc = window.document;
  const trayText = () => (doc.querySelector('#chaintray .ct-cause-txt') || {}).textContent || '';
  const ask = (fixture) => window.eval(`(() => {
    window.__captured = [];
    const p = ${JSON.stringify(fixture.prompt)};
    const s = ${JSON.stringify(fixture.state)};
    uiAnswer(p, s).then(b => window.__captured.push([...b]));
    return true;
  })()`);

  // BU-104 live: the tray cause line for the exact string the
  // re-verification saw split (《ラビリンス・ウォール・シャドウ》
  // — here the solved trigger names 《迷宮に潜むシャドウ・グール》)
  ask(CHAIN_SOLVED_DRAW);
  await sleep(100);
  const causeTxt = doc.querySelector('#chaintray .ct-cause-txt');
  ok(!!causeTxt, 'D104f: the tray cause line renders');
  const csTxt = causeTxt ? window.getComputedStyle(causeTxt) : null;
  ok(csTxt && csTxt.wordBreak === 'keep-all' && csTxt.overflowWrap === 'anywhere', 'D104g: the tray cause line holds words together (keep-all / anywhere)');
  const bEl = causeTxt ? causeTxt.querySelector('b') : null;
  const csB = bEl ? window.getComputedStyle(bEl) : null;
  ok(bEl && csB && csB.whiteSpace === 'nowrap', 'D104h: the tray name inside <b> is one nowrap unit — "' + (bEl ? bEl.textContent : '') + '"');
  doc.querySelector('#chaintray .ct-yes').click();
  doc.querySelector('#chain-pass').click();
  await sleep(50);
  // second ask: the ordinal must ride as a nowrap span, not text
  ask(CHAIN_SOLVED_DRAW);
  await sleep(100);
  ok(trayText().includes('（2回目）'), 'D104i: the re-asked tray question reads （2回目） — "' + trayText() + '"');
  const reask = doc.querySelector('#chaintray .reask-n');
  ok(reask && reask.textContent === '（2回目）', 'D104j: the ordinal is a .reask-n span');
  const csRe = reask ? window.getComputedStyle(reask) : null;
  ok(csRe && csRe.whiteSpace === 'nowrap', 'D104k: the ordinal never splits (nowrap)');
  doc.querySelector('#chaintray .ct-no').click();
  await sleep(50);

  // BU-107 live: the notice for the exact string the
  // re-verification saw split (「ゲ／ート」)
  window.eval("fxNoticeShow('相手の《合体魔神－ゲート・ガーディアン》が直接攻撃', '攻撃宣言', false)");
  const nt = doc.querySelector('#fxlayer .fx-notice .nt');
  ok(!!nt, 'D107b: the notice element is created');
  const csNt = nt ? window.getComputedStyle(nt) : null;
  ok(csNt && csNt.wordBreak === 'keep-all' && csNt.overflowWrap === 'anywhere', 'D107c: the notice text holds words together (keep-all / anywhere)');

  // BU-106 live: capture fxFly's keyframes and walk the path
  window.eval(`HTMLElement.prototype.animate = function(frames, opts){ this.__frames = frames; this.__opts = opts; return { cancel(){}, finished: Promise.resolve() }; };`);
  const readFrames = () => JSON.parse(window.eval('JSON.stringify(((els) => els.length ? els[els.length - 1].__frames : null)(document.querySelectorAll("#fxlayer .fx-ghost")))'));
  // the draw flight: start below the header, via at the chip x
  window.eval('fxFly(null, true, {cx:78,cy:111,w:40,h:52}, {cx:313,cy:57,w:77,h:18}, 40, 52, undefined, undefined, undefined, {cx:313,cy:111})');
  const via = readFrames();
  ok(!!via && via.length === 3, 'D106h: the via flight has three keyframes');
  ok(via && via[0].transform === 'translate(0px,0px)', 'D106i: the via flight starts at the below-header seat');
  ok(via && via[1].transform === 'translate(235px,0px)' && via[1].offset === 0.55, 'D106j: the via is the chip x at the same height (slide across below the header)');
  ok(via && via[2].transform === 'translate(235px,-54px) scale(.72)', 'D106k: the flight ends on the chip, shrunk');
  // walk the sampled path against the probe-measured logline rect
  const LOG = { left: 84.8, right: 268.6, top: 47, bottom: 78.3 };
  const parseT = (s) => { const m = /translate\(([-\d.]+)px,([-\d.]+)px\)(?: scale\(([\d.]+)\))?/.exec(s || ''); return m ? { x: +m[1], y: +m[2], s: m[3] ? +m[3] : 1 } : null; };
  let maxOv = 0;
  if (via) {
    const k = via.map(f => parseT(f.transform));
    const off = [0, via[1].offset == null ? 0.55 : via[1].offset, 1];
    for (let ti = 0; ti <= 50; ti++) {
      const t = ti / 50;
      let seg = t <= off[1] ? 0 : 1;
      const t0 = seg === 0 ? 0 : off[1], t1 = seg === 0 ? off[1] : 1;
      const f = (t - t0) / (t1 - t0);
      const a = k[seg], b = k[seg + 1];
      const tx = a.x + (b.x - a.x) * f, ty = a.y + (b.y - a.y) * f, s = a.s + (b.s - a.s) * f;
      // ghost placed at left 58 / top 85 (centre 78,111, 40x52), scale about its centre
      const cx = 58 + tx + 20, cy = 85 + ty + 26, w = 40 * s, h = 52 * s;
      const l = cx - w / 2, r = cx + w / 2, tp = cy - h / 2, bt = cy + h / 2;
      const ow = Math.max(0, Math.min(r, LOG.right) - Math.max(l, LOG.left));
      const oh = Math.max(0, Math.min(bt, LOG.bottom) - Math.max(tp, LOG.top));
      maxOv = Math.max(maxOv, ow * oh);
    }
  }
  ok(maxOv === 0, 'D106l: the via flight never covers the logline (max overlap ' + maxOv + ' px2 over 51 samples)');
  // the old straight flight is unchanged when no via is given
  window.eval('fxFly(null, true, {cx:78,cy:85,w:40,h:52}, {cx:313,cy:57,w:77,h:18}, 40, 52)');
  const straight = readFrames();
  ok(!!straight && straight.length === 3 && straight[1].transform === 'translate(117.5px,-30px)' && straight[1].offset === 0.55, 'D106m: the via-less flight keeps the old -16px lift (other flights untouched)');
  // the set flight: chip start, via below the header, zone landing
  window.eval('fxFly(null, true, {cx:313,cy:57,w:53,h:68}, {cx:195,cy:150,w:55,h:92}, 53, 68, 380, 0, undefined, {cx:313,cy:116})');
  const setF = readFrames();
  ok(!!setF && setF.length === 3, 'D106r: the set flight has three keyframes');
  ok(setF && setF[1].transform === 'translate(0px,59px)' && setF[1].offset === 0.55, 'D106s: the set flight drops vertically at the chip x first');
  ok(setF && setF[2].transform === 'translate(-118px,93px) scale(.72)', 'D106t: the set flight ends on the zone, shrunk');
  let maxOvSet = 0;
  if (setF) {
    const k2 = setF.map(f => parseT(f.transform));
    for (let ti = 0; ti <= 50; ti++) {
      const t = ti / 50;
      const seg = t <= 0.55 ? 0 : 1;
      const t0 = seg === 0 ? 0 : 0.55, t1 = seg === 0 ? 0.55 : 1;
      const f = (t - t0) / (t1 - t0);
      const a = k2[seg], b = k2[seg + 1];
      const tx = a.x + (b.x - a.x) * f, ty = a.y + (b.y - a.y) * f, s = a.s + (b.s - a.s) * f;
      const cx = 286.5 + tx + 26.5, cy = 23 + ty + 34, w = 53 * s, h = 68 * s;
      const l = cx - w / 2, r = cx + w / 2, tp = cy - h / 2, bt = cy + h / 2;
      const ow = Math.max(0, Math.min(r, LOG.right) - Math.max(l, LOG.left));
      const oh = Math.max(0, Math.min(bt, LOG.bottom) - Math.max(tp, LOG.top));
      maxOvSet = Math.max(maxOvSet, ow * oh);
    }
  }
  ok(maxOvSet === 0, 'D106u: the set flight never covers the logline (max overlap ' + maxOvSet + ' px2 over 51 samples)');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
