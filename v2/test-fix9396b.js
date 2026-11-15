'use strict';
/* test-fix9396b.js — follow-up round 2026-11-15 (BU-94 remainder,
 * BU-99 remainder, obs-1, obs-3). Public build 06d7df8's re-verification
 * left two remainders; the Chromium rig (fix9396b-1115/probe-bu94b99.js,
 * 5 real duels) measured the causes, and this file pins the fixes.
 *
 * BU-94 remainder: the opponent-name tag sat at a fixed top:47px —
 * row 2's band — so it covered the turn readout (1,152 px2), the
 * latest-event line (4,411 px2) and the opponent-hand chip
 * (839 px2) in the wild, and a move notice covered it in turn
 * (4,416 px2). The tag now gets its own band BELOW row 2 (below a
 * live notice when one is up), positioned per frame, and the header
 * grows to hold it; the notice's anchor reads the header bottom
 * EXCLUDING the tag's band so the tag never pushes the notice down
 * into it. The residual notice-vs-row-1 overlap (max 800 px2 over
 * the history button) was a 1-frame stale top: the anchor set top
 * from the pre-growth header. The growth is now applied BEFORE the
 * top is set. Pinned here by source; the overlap proof is the
 * Chromium rig's re-run on the fixed build.
 *
 * obs-1 (new, from the same re-verification): the battle-start
 * chain question appeared twice with the identical text. The core
 * source (ocgcore-poc processor.cpp) shows the two asks are two
 * DIFFERENT windows — the Start Step (PhaseEvent, hint 28 /
 * TIMING_BATTLE_START) and the Battle Step's End (BattleCommand
 * case 1, QuickEffect for the opponent then the turn player,
 * hint 29 / TIMING_BATTLE_STEP_END) — but the client labelled
 * both 「バトルフェイズ開始時」 because lastTrigger is stale
 * (128 is not a major phase). The asked player's hint_timing
 * mask rides on every SELECT_CHAIN message; the driver keeps it
 * on the prompt and refines a phase trigger from it, so the
 * second window now reads 「バトルステップ終了時」. The same
 * refinement covers the Battle Phase's End Step (TIMING_BATTLE_END
 * → 「バトルフェイズ終了時」). Pinned here by source + a live
 * parsePrompt check + phaseTrigText checks; the tray-text proof
 * is the Chromium rig's re-run.
 *
 * obs-3: a selection-sheet tile's location badge wrapped mid-word
 * (「相手のモンスターゾー ン3」, 2 lines, 30.5px) — the longest
 * label (12 chars) is wider than a tile at 9.5px. The badge is
 * nowrap now and its type steps down to the 8px floor in sheetOpen
 * (the 12-char label fits a 390px tile at 8px). Pinned here by
 * source + a live sheet check; the 1-line proof is the rig.
 *
 * BU-99 remainder: the re-presented identical chain question (see
 * obs-1 and the probe's prompt log: identical trigger + entries
 * 0.5-4.5s apart, e.g. two 'solved' windows for one resolution)
 * is the engine asking again, not a swallowed tap — but the
 * client gave no signal the second question was new. The
 * obs-1 label fix is the first half of the answer; the
 * long-press behaviour itself (250ms hold on しない / パス)
 * is measured by the Chromium rig's probe-bu99.js, which drives
 * real mouse down/up holds. Its outcome is recorded in
 * fix9396b-1115/RECORD.md (no source pin here until the probe
 * lands a mechanism).
 *
 * BU-96: resolved as spec (no vertical cut anywhere; the 「…」
 * is the user's 1-line rule) — recorded in the backlog, no code.
 * BU-93 / BU-95: closed by the previous round's re-verification.
 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
const engineSrc = fs.readFileSync(path.join(V2, 'engine.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- source pins ----------
// BU-94: tag own band
ok(!html.includes('.fx-oppnametag{position:absolute;top:47px;'), 'B94a: the tag no longer has a fixed top:47px (row 2 band)');
ok(clientSrc.includes('function fxOppTagPosition()'), 'B94b: fxOppTagPosition positions the tag per frame');
ok(clientSrc.includes('tagTopVp = nr.bottom + 2'), 'B94c: with a notice up the tag stacks below the notice');
ok(clientSrc.includes('let row2Bottom = hr.top + 71;'), 'B94d: with no notice the tag starts below row 2');
ok(clientSrc.includes('const effBottom = hr.bottom - fxTagGrowPx;'), 'B94e: the notice anchor reads the header bottom excluding the tag band');
ok(clientSrc.includes('while (nt && d.offsetHeight > Math.max(0, effBottom - gr.top) && fs > 9)'), 'B94f: the notice font fit measures against the tag-excluded bottom');
ok(clientSrc.includes('const hr2 = hb.getBoundingClientRect();'), 'B94g: the notice top is set from the header re-read AFTER the growth');
ok(clientSrc.includes('function fxTagRestoreHeader()'), 'B94h: the tag restores only its own growth when it leaves');
ok(clientSrc.includes('if (fxOppTagEl) {'), 'B94i: the notice restore preserves a live tag band');
ok(clientSrc.includes("hb.style.minHeight = (base + fxTagGrowPx) + 'px';"), 'B94j: the notice restore keeps base + tag growth while the tag lives');
// obs-1: hint refinement
ok(engineSrc.includes('return { type, name: \'SELECT_CHAIN\', player, speCount, forced: !!forced, entries, hint0, hint1 };'), 'O1a: parsePrompt keeps hint0/hint1 on the SELECT_CHAIN prompt');
ok(engineSrc.includes("const refined = (h0 & 0x4000000) ? 'BATTLE_STEP_END' : (h0 & 0x10) ? 'BATTLE' : null;"), 'O1b: the trigger is refined from the asked player hint_timing mask');
ok(engineSrc.includes('prompt.trigger = Object.assign({}, prompt.trigger, { phase: refined });'), 'O1c: the refinement copies the trigger (lastTrigger is never mutated)');
ok(clientSrc.includes('function phaseTrigText(ph)'), 'O1d: phaseTrigText names the window');
ok(clientSrc.includes("if (ph === 'BATTLE_STEP_END') return 'バトルステップ終了時';"), 'O1e: the Battle Step End window reads 終了時');
ok(clientSrc.includes("if (ph === 'BATTLE') return 'バトルフェイズ終了時';"), 'O1f: the Battle End Step window reads 終了時');
ok(clientSrc.includes('phaseTrigText(trig.phase)'), 'O1g: the tray and the dock label both use phaseTrigText');
// obs-3: tile location badge
ok(html.includes('.gcard .loc{') && html.includes('white-space:nowrap;max-width:calc(100% - 6px);overflow:hidden;text-overflow:ellipsis;'), 'O3a: the tile location badge is nowrap with a tile-bounded clip');
ok(clientSrc.includes("sheet.querySelectorAll('.gcard .loc').forEach"), 'O3b: sheetOpen fits every tile location badge');
ok(clientSrc.includes('while (el.scrollWidth > el.clientWidth + 1 && fs > 8)'), 'O3c: the badge type steps down to the 8px floor before clipping');
// BU-94 single-notice growth still intact (fix9396 pins, kept)
ok(clientSrc.includes('function fxNoticeGrowHeader(over)'), 'B94k: fxNoticeGrowHeader still exists');
ok(clientSrc.includes('fxNoticeGrowHeader(cap - topVp)'), 'B94l: the notice anchor still grows the header by the exact deficit');

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

(async () => {
  const window = await boot();
  const doc = window.document;

  // obs-1: phaseTrigText wording (live)
  ok(window.eval("phaseTrigText('BATTLE_STEP_END')") === 'バトルステップ終了時', 'O1h: phaseTrigText BATTLE_STEP_END');
  ok(window.eval("phaseTrigText('BATTLE')") === 'バトルフェイズ終了時', 'O1i: phaseTrigText BATTLE');
  ok(window.eval("phaseTrigText('BATTLE_START')") === 'バトルフェイズ開始時', 'O1j: phaseTrigText BATTLE_START (unchanged)');
  ok(window.eval("phaseTrigText('DRAW')") === 'ドロー開始時', 'O1k: phaseTrigText DRAW (unchanged)');
  ok(window.eval("phaseTrigText('MAIN1')") === 'メイン1開始時', 'O1l: phaseTrigText MAIN1 (unchanged)');
  ok(window.eval("phaseTrigText('')") === 'ターン開始時', 'O1m: phaseTrigText empty (unchanged)');

  // obs-1: parsePrompt keeps the hint masks (live, synthetic wire bytes)
  // SELECT_CHAIN: type 16, player 0, speCount 0, forced 0,
  // hint0 = TIMING_BATTLE_STEP_END, hint1 = 0, n = 0 entries.
  const p = window.eval(`(() => {
    const b = new Uint8Array([16, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0]);
    return Engine.parsePrompt(b);
  })()`);
  ok(p && p.name === 'SELECT_CHAIN', 'O1n: synthetic SELECT_CHAIN parses');
  ok(p && p.hint0 === 0x4000000 && p.hint1 === 0, 'O1o: the hint masks survive parsing (hint0 = TIMING_BATTLE_STEP_END)');

  // BU-94: the tag shows without a fixed row-2 top (live drive)
  window.eval("fxOppNameTag('相手：《合体魔神－ゲート・ガーディアン》を特殊召喚', { how: 'spsummon', code: 0 })");
  const tag = doc.querySelector('#fxlayer .fx-oppnametag');
  ok(!!tag, 'B94m: the name tag element is created');
  ok(tag && tag.textContent.includes('ゲート・ガーディアン'), 'B94n: the tag names the summoned card');
  ok(tag && tag.style.top !== '47px', 'B94o: the tag carries no fixed 47px top (jsdom geometry is 0, so the per-frame loop leaves it unset here)');
  await sleep(100);
  ok(!!doc.querySelector('#fxlayer .fx-oppnametag'), 'B94p: the tag is still up inside its dwell');

  // obs-3: the tile location badge is nowrap (live sheet drive)
  window.eval(`__select.open({ name: 'SELECT_CARD', player: 0, cancelable: true, min: 1, max: 1, context: null,
    cards: [{ code: 45409943, con: 1, loc: 4, seq: 2, pos: 1 }, { code: 99937011, con: 0, loc: 16, seq: 0, pos: 1 }] })`);
  await sleep(100);
  const locs = [...doc.querySelectorAll('#sheet .gcard .loc')];
  ok(locs.length === 2, 'O3d: the sheet renders two location badges');
  const cs = locs.length ? window.getComputedStyle(locs[0]) : null;
  ok(cs && cs.whiteSpace === 'nowrap', 'O3e: the tile badge is nowrap (live style)');
  ok(locs.length && locs[0].textContent === '相手のモンスターゾーン3', 'O3f: the badge still names the full zone (no truncation of the label)');
  const fs0 = locs.length ? parseFloat(cs.fontSize) : 0;
  ok(fs0 <= 9.5 && fs0 >= 8, 'O3g: the badge type is within the 9.5..8px fit range (jsdom measures 0, so it stays at 9.5 here)');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
