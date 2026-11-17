'use strict';
/* test-fixa07bu19.js — A-07 + BU-19 (fix-a07bu19-1117).
   A-07: the result screen could surface under an active finisher
   wash (triage-1117-oldbu2: 2/2 finisher duels, up to 1275 ms
   early). Root cause: the duel-end handler awaited the gate once
   with a real-ms setTimeout, and the gate is capped at 3600 ms
   while the remain can reach ~4676 ms — and the FX clock lags
   wall time under hit-stop. The fix loops the wait until the
   gate reads 0. Pins: the waiter with a scripted gate (it must
   not resolve after the first wait), the frozen-clock guard, and
   the immediate return with no finisher.
   BU-19: the "カードの確認" sheet showed exactly one card but
   never said WHY. The engine now stamps the resolving link on
   the confirm event; the trap ③ draw check (which resolves no
   link) is derived from its observed activation in the same draw
   phase. Pins: the wording per effect (search / show / declare /
   generic), the cause attachment (solving link, draw-check
   derivation, and its guards), and the reason line on both the
   light form and the blocking sheet. */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const fxmap = JSON.parse(fs.readFileSync(path.join(V2, 'fxmap.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));

async function boot() {
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  // The inline script in index.html starts the data.json /
  // fxmap.json downloads at PARSE time, so the stub must already
  // be in place then (beforeParse) — a stub installed after
  // construction answers those fetches with a rejection, and the
  // client then runs with FXMAP empty (the other jsdom tests
  // live with that gap; this round's wording pins need the map).
  const fetchStub = async (url) => {
    if (String(url).includes('ocgcore.wasm')) return { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf };
    if (String(url).includes('fxmap.json')) return { ok: true, status: 200, url: String(url), json: async () => fxmap };
    return { ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf };
  };
  const dom = new JSDOM(html, {
    url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) { window.fetch = fetchStub; },
  });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
  window.fetch = fetchStub;
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

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const SID = (code, idx) => code * 1048576 + idx;
const HAND = 2, DECK = 1, EXTRA = 64;
const KELDO = 63542003, CARBON = 15079028, TRAP = 98715423, TERRA = 73628505,
  DISPATCH = 6498706, KING = 45223540, ZOLGA = 31525442, BAKUDAN = 51208877,
  HANA = 62133026, ROLLBACK = 6351147, META = 89208725, BOLT = 12580477;

(async () => {
  const window = await boot();
  const doc = window.document;
  const C = window.__confirm;
  const fx = window.__fx;

  // ---- Part C first: rendering (show() drains the queue) ----
  // C1: light form, search reveal
  C.push({ kind: 'confirm', shown: 0, cards: [{ code: KELDO, con: 1, loc: HAND, seq: 0 }], causeCode: KELDO, causeDesc: SID(KELDO, 0) });
  const p1 = C.show();
  let r = doc.querySelector('.fcl-reason');
  ok(!!r && r.textContent === '《宿神像ケルドウ》①で加えたカード', 'C1: light form names the searching effect (got: ' + (r && r.textContent) + ')');
  await p1;
  ok(!doc.querySelector('.fx-confirm-light'), 'C1b: light form advances on its own');
  // C2: light form, draw check
  C.push({ kind: 'confirm', shown: 0, cards: [{ code: BOLT, con: 1, loc: HAND, seq: 0 }], causeCode: TRAP, causeDesc: SID(TRAP, 1) });
  const p2 = C.show();
  r = doc.querySelector('.fcl-reason');
  ok(!!r && r.textContent === '《墓守の罠》③の宣言チェック：引いたカード', 'C2: light form names the draw check (got: ' + (r && r.textContent) + ')');
  await p2;
  // C3: sheet, 3 cards, generic cause (Zolga look)
  C.push({
    kind: 'confirm', shown: 0,
    cards: [
      { code: BOLT, con: 0, loc: DECK, seq: 5 }, { code: KELDO, con: 0, loc: DECK, seq: 4 }, { code: CARBON, con: 1, loc: DECK, seq: 3 },
    ],
    causeCode: ZOLGA, causeDesc: 0,
  });
  const p3 = C.show();
  r = doc.querySelector('#sheet .cf-reason');
  ok(!!r && r.textContent === '《予見者ゾルガ》の効果で確認', 'C3: sheet names the looking effect (got: ' + (r && r.textContent) + ')');
  doc.getElementById('sheet-cancel').click();
  await p3;
  // C4: no cause -> no reason line
  C.push({ kind: 'confirm', shown: 0, cards: [{ code: KELDO, con: 1, loc: HAND, seq: 0 }] });
  const p4 = C.show();
  ok(!doc.querySelector('.fcl-reason'), 'C4: a causeless confirm stays unlabelled');
  await p4;
  // C5: two causes in one group -> no reason line
  C.push({ kind: 'confirm', shown: 0, cards: [{ code: KELDO, con: 1, loc: HAND, seq: 0 }], causeCode: KELDO, causeDesc: SID(KELDO, 0) });
  C.push({ kind: 'confirm', shown: 0, cards: [{ code: CARBON, con: 1, loc: HAND, seq: 0 }], causeCode: CARBON, causeDesc: SID(CARBON, 0) });
  const p5 = C.show();
  ok(!doc.querySelector('.fcl-reason'), 'C5: two causes in one group stay unlabelled');
  await p5;

  // ---- Part A: wording ----
  const R = C.reason;
  ok(R(KELDO, SID(KELDO, 0), HAND) === '《宿神像ケルドウ》①で加えたカード', 'A1: keldo search');
  ok(R(CARBON, SID(CARBON, 0), HAND) === '《地久神－カルボン》①で加えたカード', 'A2: carbon search');
  ok(R(TRAP, SID(TRAP, 1), HAND) === '《墓守の罠》③の宣言チェック：引いたカード', 'A3: trap draw check');
  ok(R(TERRA, 0, HAND) === '《テラ・フォーミング》①で加えたカード', 'A4: terraforming, desc-less single segment');
  ok(R(DISPATCH, SID(DISPATCH, 0), EXTRA) === '《融合派兵》①で見せたカード', 'A5: fusion dispatch show');
  ok(R(KING, SID(KING, 0), EXTRA) === '《沼地の魔道王》①で見せたカード', 'A6: swamp king show');
  ok(R(BAKUDAN, SID(BAKUDAN, 1), HAND) === '《運命の抱く爆弾》②で加えたカード', 'A7: bomb grave salvage');
  ok(R(HANA, SID(HANA, 0), HAND) === '《花と野原の春化精》①で加えたカード', 'A8: hana salvage');
  ok(R(ZOLGA, 0, DECK) === '《予見者ゾルガ》の効果で確認', 'A9: zolga look, number unpinned -> card only');
  ok(R(12345, 0, HAND) === '', 'A10: unknown code stays silent');
  ok(R(TRAP, SID(TRAP, 0), HAND) === '《墓守の罠》②で加えたカード', 'A11: trap search (idx 0 -> ② via map)');
  ok(R(ROLLBACK, SID(ROLLBACK, 0), HAND) === '《トランザクション・ロールバック》①の効果で確認', 'A12: rollback copies an effect, adds nothing -> generic');
  ok(R(META, SID(META, 0), HAND) === '《メタバース》①で加えたカード', 'A13: metaverse search branch');
  ok(R(DISPATCH, SID(DISPATCH, 0), HAND) === '《融合派兵》①の効果で確認', 'A14: show wording needs the EX location');
  ok(R(KELDO, SID(KELDO, 0), EXTRA) === '《宿神像ケルドウ》①の効果で確認', 'A15: search wording needs the hand location');
  ok(R(KELDO, SID(KELDO, 0), DECK) === '《宿神像ケルドウ》①の効果で確認', 'A16: search wording does not fire for a deck confirm');
  ok(R(TRAP, 0, HAND) === '《墓守の罠》②で加えたカード', 'A17: desc-less stamped trap confirm is ② (① never confirms, ③ never stamps)');

  // ---- Part B: cause attachment ----
  const st = (phase, turn) => ({ phaseName: phase, turnCount: turn });
  const card = (code) => ({ code, con: 1, loc: HAND, seq: 0 });
  C.queueEvents([{ kind: 'confirm', shown: 0, cards: [card(KELDO)], solCode: KELDO, solDesc: SID(KELDO, 0) }], st('MAIN1', 4));
  let q = C.queue();
  ok(q[q.length - 1].causeCode === KELDO && q[q.length - 1].causeDesc === SID(KELDO, 0), 'B1: solving link stamps the cause');
  C.queueEvents([{ kind: 'activate', code: TRAP, con: 0, loc: 8 }], st('DRAW', 4));
  C.queueEvents([{ kind: 'confirm', shown: 0, cards: [card(BOLT)] }], st('DRAW', 4));
  q = C.queue();
  ok(q[q.length - 1].causeCode === TRAP && q[q.length - 1].causeDesc === SID(TRAP, 1), 'B2: trap ③ activation derives the draw check');
  C.queueEvents([{ kind: 'confirm', shown: 0, cards: [card(BOLT)] }], st('DRAW', 7));
  q = C.queue();
  ok(q[q.length - 1].causeCode == null, 'B3: a link-less confirm without an activation stays causeless');
  C.queueEvents([{ kind: 'activate', code: TRAP, con: 0, loc: 8 }], st('MAIN1', 8));
  C.queueEvents([{ kind: 'confirm', shown: 0, cards: [card(BOLT)] }], st('DRAW', 8));
  q = C.queue();
  ok(q[q.length - 1].causeCode == null, 'B4: an activation in MAIN1 is not a ③ activation');
  C.queueEvents([{ kind: 'confirm', shown: 0, cards: [card(BOLT)] }], st('DRAW', 9));
  q = C.queue();
  ok(q[q.length - 1].causeCode == null, 'B5: a stale activation from an earlier turn derives nothing');
  C.queueEvents([{ kind: 'activate', code: TRAP, con: 0, loc: 8 }], st('DRAW', 10));
  C.queueEvents([{ kind: 'confirm', shown: 0, cards: [card(KELDO)], solCode: KELDO, solDesc: SID(KELDO, 0) }], st('DRAW', 10));
  q = C.queue();
  ok(q[q.length - 1].causeCode === KELDO, 'B6: the solving link wins over the draw-check derivation');

  // ---- Part D: A-07 waiter ----
  let calls = 0;
  const seq = [1200, 800, 0];
  let t0 = Date.now();
  await fx.awaitFinisherGate(() => { calls++; return seq[Math.min(calls - 1, seq.length - 1)]; });
  const el1 = Date.now() - t0;
  ok(calls === 3 && el1 >= 1900 && el1 < 4000, 'D1: waiter loops until the gate reads 0 (calls ' + calls + ', ' + el1 + ' ms)');
  t0 = Date.now();
  await fx.awaitFinisherGate(() => 100, 250);
  const el2 = Date.now() - t0;
  ok(el2 >= 250 && el2 < 2000, 'D2: frozen clock still resolves via the guard (' + el2 + ' ms)');
  t0 = Date.now();
  await fx.awaitFinisherGate(() => 0);
  ok(Date.now() - t0 < 200, 'D3: a zero gate returns at once');
  ok(fx.finisherGateMs() === 0, 'D4: no finisher scene -> real gate 0');

  window.close();
  console.log(failures === 0 ? 'ALL FIXA07BU19 CHECKS PASSED' : failures + ' FAILED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
