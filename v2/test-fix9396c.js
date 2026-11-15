'use strict';
/* test-fix9396c.js — follow-up round 2026-11-15 (BU-99, BU-94
 * remainder, BU-104, BU-105, obs-3 remainder).
 *
 * BU-99 (mechanism, settled by the in-process engine rig
 * fix9396c-1115/analyze-bu99.js): the engine asks the same
 * question twice at one timing — the phase-start window and the
 * draw-event window (and, after a resolution, the phase window
 * again and the point-event window) carry the identical wording,
 * identical trigger and identical entries. 40 in-process duels
 * (Ishizu vs GG, human seat answered by the bot policy):
 * 4,851 human SELECT_CHAIN prompts, 594 byte-identical re-asks
 * and 1,331 same-label re-asks at the same turn+phase, 594/594
 * and 1,329/1,331 with a PASS as the first answer, MSG_RETRY 0
 * — the first tap IS accepted, the engine asks again. At DRAW,
 * 66% of draw phases ask 2+ times, which is why the
 * re-verification saw 13/13 first taps at draw "fail". The
 * second window is a real, rule-correct window (a fresh chance
 * to chain), so it must not be suppressed; instead the question
 * is numbered — the Nth time the same wording arrives in one
 * turn+phase it reads （N回目） — on the tray text AND the dock
 * context line. Counted on SHOWN questions only (auto-passed
 * zero-option prompts never reach uiChain). The key is the cause
 * label — the wording the player reads — so a new chain link
 * (a new cause) correctly resets the count.
 *
 * BU-94 (remainder): the notice's old bottom anchor put it over
 * the logline for the whole dwell (a 2-line notice spans y43-77
 * over row 2's y47-78) — the latest-event line was covered 100%
 * of the time while any notice was up, and the "same channel"
 * rationale failed because the notice lingers while the line
 * moves on to newer events. The notice now sits in its own band
 * BELOW row 2 (fxRow2Bottom + 2, the name tag stacked under it),
 * the header grows to hold it, and the font fit is gone (full
 * 12.5px; the K5 name grouping bounds the text). The per-frame
 * anchor alone lagged a logline growth by ~2 frames (one duel:
 * a 3-line logline overlapped the notice for 2 sampler ticks /
 * 3,837 px2), so the notice also re-anchors synchronously when
 * the logline's text changes (MutationObserver, disconnected on
 * leave). Pinned here by source + a live jsdom notice; the
 * overlap proof (notice x logline = 0 in a real duel) is the
 * Chromium rig's re-run.
 *
 * BU-104: dock text broke long card names mid-word
 * (「ラビリンス・ウォール・シ ャドウ」「シャド ウ」
 * 「ガーディア ン」). The dock's text elements now use the
 * keep-all / anywhere pair (words hold together; the overflow
 * break is the last resort only). Pinned by source + live
 * computed style.
 *
 * BU-105: the extended chain sheet's パス behaved two ways —
 * once it only closed the sheet back to the folded dock, once
 * it advanced the game at once. The engine rig shows both were
 * the same answer: the pass was accepted (-1) both times, and
 * the difference was what the engine asked next (a re-ask of
 * the same question, vs the next phase). The fix is the BU-99
 * ordinal: the re-ask now reads （2回目）, so the same button
 * visibly gives the same result. Pinned here by source (the
 * ordinal rides on the cause shared by tray and dock) + live
 * (two identical prompts answered by パス both resolve to the
 * -1 bytes, the second labelled （2回目）).
 *
 * obs-3 (remainder): the 8px font fit was not enough on a
 * narrow sheet — 「相手のモンスターゾーン3」 still ellipsized
 * to 「相手のモンスターゾー…」 and hid the 3. The badge is
 * now split: a truncatable text part + a never-clipped number
 * part (the wording is unchanged). Pinned here live; the CSS
 * and builder pins live in test-fix9396b.js (O3a..).
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
// BU-99: the re-ask ordinal
ok(clientSrc.includes('let lastChainQ = null;'), 'C99a: the last shown chain question is remembered (lastChainQ)');
ok(clientSrc.includes("const qkey = state.turnCount + '|' + state.phaseName + '|' + (cause ? cause.label : '効果への応答');"), 'C99b: the re-ask key is turn + phase + cause label (the wording the player reads)');
ok(clientSrc.includes("const sfx = '（' + reaskN + '回目）';"), 'C99c: the Nth re-ask reads （N回目）');
ok(clientSrc.includes('cause.label += sfx; cause.tray += sfx;'), 'C99d: the ordinal rides on both the dock label and the tray text');
{
  const iChain = clientSrc.indexOf('function uiChain(');
  const iCount = clientSrc.indexOf('lastChainQ = { key: qkey, n: reaskN };');
  const iNext = clientSrc.indexOf('window.__chain', iChain);
  ok(iChain > 0 && iCount > iChain && iCount < iNext, 'C99e: the count happens inside uiChain (shown questions only — auto-passed zero-option prompts never reach it)');
}
ok(clientSrc.includes('lastChainQ = null; // fix9396c-1115 (BU-99): the re-ask ordinal restarts with the duel'), 'C99f: the ordinal restarts with the duel');
// BU-94: the notice's seat below row 2
ok(clientSrc.includes('function fxRow2Bottom()'), 'C94a: the row-2 edge is a shared helper');
ok(clientSrc.includes('const seatTop = fxRow2Bottom() + 2;'), 'C94b: the notice seats below row 2');
ok(clientSrc.includes("d.style.top = Math.max(0, Math.round(seatTop - lr.top)) + 'px';"), 'C94c: the notice top is set from the row-2 seat');
{
  const tagFn = clientSrc.slice(clientSrc.indexOf('function fxOppTagPosition()'), clientSrc.indexOf('function fxOppTagPosition()') + 2000);
  ok(tagFn.includes('fxRow2Bottom()'), 'C94d: the tag uses the same row-2 helper (one seat, no drift)');
}
ok(!clientSrc.includes('(hr2.bottom - fxTagGrowPx) - lr.top - 2 - d.offsetHeight'), 'C94e: the old bottom-anchor formula is gone (no notice over the logline)');
ok(!clientSrc.includes("nt.style.fontSize = fs + 'px';"), 'C94f: the notice no longer steps its type down mid-dwell');
ok(clientSrc.includes('logMo = new MutationObserver(() => anchorNotice());'), 'C94j: the notice re-anchors when the logline text changes (no 2-frame lag)');
ok(clientSrc.includes('logMo.observe(lg, { childList: true, characterData: true, subtree: true });'), 'C94k: the observer watches the logline');
ok(clientSrc.includes('if (logMo) { try { logMo.disconnect(); } catch (e) {} }'), 'C94l: the observer is disconnected when the notice leaves');
// BU-104: dock word-break rule
ok(html.includes('#dock .ctx,#dock .causename,#dock .cand .cname,#dock .cand .fxline,#dock .sub,#dock .duelsection{word-break:keep-all;overflow-wrap:anywhere;}'), 'C104a: the dock text rule holds words together (keep-all / anywhere)');
// BU-105: the ordinal is attached before the tray is shown, so both stages carry it
{
  const iSfx = clientSrc.indexOf('cause.label += sfx; cause.tray += sfx;');
  const iTray = clientSrc.indexOf('showChainTray(prompt, cause', iSfx);
  ok(iSfx > 0 && iTray > iSfx, 'C105a: the ordinal is baked into the cause before the tray is shown (tray and dock share it)');
}
ok(clientSrc.includes("if (pass) pass.addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(-1)); });"), 'C105b: the dock パス answers -1 (unchanged)');
// obs-3: the split badge builder
ok(clientSrc.includes('function locBadgeHTML(label)'), 'C03a: locBadgeHTML splits the label into text + number');
ok(html.includes('.gcard .loc .loc-num{') && html.includes('flex:0 0 auto;'), 'C03b: the number part never shrinks or clips');

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

const CHAIN_DRAW = { prompt: { name: 'SELECT_CHAIN', player: 0, forced: false,
    entries: [{ code: 99937011, con: 0, loc: 4, seq: 1, pos: 1, desc: 104791551246337, mode: 0 }],
    context: null, trigger: { kind: 'phase', code: 0, con: 0, turn: 1, phase: 'DRAW' }, retryCount: 0 },
  state: { chain: [], turnCount: 1, turnPlayer: 0, phaseName: 'DRAW' } };
const CHAIN_SOLVED_DRAW = { prompt: { name: 'SELECT_CHAIN', player: 0, forced: false,
    entries: [{ code: 99937011, con: 0, loc: 4, seq: 1, pos: 1, desc: 104791551246337, mode: 0 }],
    context: null, trigger: { kind: 'solved', code: 62411811, con: 1, turn: 1, phase: 'DRAW' }, retryCount: 0 },
  state: { chain: [], turnCount: 1, turnPlayer: 0, phaseName: 'DRAW' } };
const CHAIN_MAIN1 = { prompt: { name: 'SELECT_CHAIN', player: 0, forced: false,
    entries: [{ code: 99937011, con: 0, loc: 4, seq: 1, pos: 1, desc: 104791551246337, mode: 0 }],
    context: null, trigger: { kind: 'phase', code: 0, con: 0, turn: 1, phase: 'MAIN1' }, retryCount: 0 },
  state: { chain: [], turnCount: 1, turnPlayer: 0, phaseName: 'MAIN1' } };

(async () => {
  const window = await boot();
  const doc = window.document;
  const trayText = () => (doc.querySelector('#chaintray .ct-cause-txt') || {}).textContent || '';
  const dockCtx = () => (doc.querySelector('#dock .ctx') || {}).textContent || '';
  // drive a chain prompt through the real uiAnswer path and
  // capture the resolved answer bytes in the window realm
  const ask = (fixture) => window.eval(`(() => {
    window.__captured = [];
    const p = ${JSON.stringify(fixture.prompt)};
    const s = ${JSON.stringify(fixture.state)};
    uiAnswer(p, s).then(b => window.__captured.push([...b]));
    return true;
  })()`);

  // BU-99 + BU-105: the same DRAW question twice
  ask(CHAIN_DRAW);
  await sleep(100);
  ok(!trayText().includes('（2回目）'), 'C99g: the first DRAW question carries no ordinal — "' + trayText() + '"');
  ok(trayText().includes('ドロー開始時にチェーンできます'), 'C99g2: the first DRAW question reads as before');
  doc.querySelector('#chaintray .ct-yes').click();
  ok(dockCtx().includes('ドロー開始時') && !dockCtx().includes('（2回目）'), 'C99g3: the first dock context line carries no ordinal');
  doc.querySelector('#chain-pass').click();
  await sleep(50);
  const b1 = window.eval('window.__captured');
  ok(b1 && b1.length === 1 && b1[0].join(',') === '255,255,255,255', 'C105c: the first パス resolves to the -1 bytes (255,255,255,255)');
  ask(CHAIN_DRAW);
  await sleep(100);
  ok(trayText().includes('（2回目）'), 'C99h: the re-asked DRAW question reads （2回目） on the tray — "' + trayText() + '"');
  doc.querySelector('#chaintray .ct-yes').click();
  ok(dockCtx().includes('ドロー開始時（2回目）'), 'C99h2: the re-asked dock context line reads ドロー開始時（2回目）');
  doc.querySelector('#chain-pass').click();
  await sleep(50);
  const b2 = window.eval('window.__captured');
  ok(b2 && b2.length === 1 && b2[0].join(',') === '255,255,255,255', 'C105d: the second パス resolves to the SAME -1 bytes (same button, same result — only the label differs)');

  // BU-99: a different cause in the same turn+phase resets the count
  ask(CHAIN_SOLVED_DRAW);
  await sleep(100);
  ok(!trayText().includes('（2回目）'), 'C99i: a different cause (post-resolution) in the same turn+phase carries no ordinal');
  doc.querySelector('#chaintray .ct-no').click();
  await sleep(50);
  // BU-99: the same wording in a different phase resets the count
  ask(CHAIN_MAIN1);
  await sleep(100);
  ok(!trayText().includes('（2回目）') && trayText().includes('メイン1開始時'), 'C99j: the same wording in a different phase carries no ordinal');

  // BU-104: the dock's text elements hold words together (live computed style)
  doc.querySelector('#chaintray .ct-yes').click();
  const csName = doc.querySelector('#dock .cand .cname') ? window.getComputedStyle(doc.querySelector('#dock .cand .cname')) : null;
  const csCtx = doc.querySelector('#dock .ctx') ? window.getComputedStyle(doc.querySelector('#dock .ctx')) : null;
  const csCause = doc.querySelector('#dock .causename') ? window.getComputedStyle(doc.querySelector('#dock .causename')) : null;
  ok(csName && csName.wordBreak === 'keep-all' && csName.overflowWrap === 'anywhere', 'C104b: the candidate name holds words together (keep-all / anywhere)');
  ok(csCtx && csCtx.wordBreak === 'keep-all' && csCtx.overflowWrap === 'anywhere', 'C104c: the dock context line holds words together');
  ok(!csCause || (csCause.wordBreak === 'keep-all' && csCause.overflowWrap === 'anywhere'), 'C104d: the dock cause name holds words together');
  doc.querySelector('#chain-pass').click();
  await sleep(50);

  // BU-94: a live notice seats below row 2 at full type (jsdom
  // geometry is 0, so row 2's nominal bottom is 71 and the seat
  // is 73; the old bottom anchor would have set top 0)
  window.eval("fxNoticeShow('攻撃宣言｜《宵闇のルーチェ》が《合体魔神》を攻撃', '', false)");
  const notice = doc.querySelector('#fxlayer .fx-notice');
  ok(!!notice, 'C94g: the notice element is created');
  const nTop = notice ? parseFloat(notice.style.top) : -1;
  ok(nTop >= 73, 'C94h: the notice top is below row 2 (top ' + nTop + 'px, row 2 nominal bottom 71)');
  const nt = notice ? notice.querySelector('.nt') : null;
  ok(nt && !nt.style.fontSize, 'C94i: the notice type is not stepped down (full 12.5px, header absorbs the height)');

  // obs-3: the split badge on a narrow sheet (live sheet drive)
  window.eval(`__select.open({ name: 'SELECT_CARD', player: 0, cancelable: true, min: 1, max: 1, context: null,
    cards: [{ code: 45409943, con: 1, loc: 4, seq: 2, pos: 1 }, { code: 99937011, con: 0, loc: 16, seq: 0, pos: 1 }] })`);
  await sleep(100);
  const badge = doc.querySelector('#sheet .gcard .loc');
  ok(!!badge, 'C03c: the sheet renders the location badge');
  const num = badge ? badge.querySelector('.loc-num') : null;
  const txt = badge ? badge.querySelector('.loc-txt') : null;
  ok(num && num.textContent === '3', 'C03d: the zone number is its own element and reads 3');
  ok(txt && txt.textContent === '相手のモンスターゾーン', 'C03e: the text part carries the wording unchanged');
  ok(badge && badge.textContent === '相手のモンスターゾーン3', 'C03f: the badge as a whole still reads the full label');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
