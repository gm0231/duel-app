'use strict';
/* test-purpose.js — brushup round 3 pins.
   BU-13.1: the SELECT_CARD purpose inference (手札の上限) may
   fire ONLY for the provable rule-process hand-limit discard.
   Every guard gets a negative case: break one condition and the
   inference must return null (an effect's discard cost, target
   or material selection must never be mislabeled).
   BU-13.2: the context-line phase granularity (W-27) — battle
   sub-steps collapse to バトルフェイズ, damage-step timings are
   named ダメージ計算の確認, other phases keep their names.
   DS-07: the VS curtain must never be opacity-faded again
   (source pin; the frame-level proof lives in shots-r3).     */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const V2 = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const Engine = require(path.join(V2, 'engine.js'));
const HAND = Engine.LOC.HAND, GRAVE = Engine.LOC.GRAVE;

let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

function stubEl() {
  return {
    children: [], style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    textContent: '', innerHTML: '', className: '', disabled: false, volume: 1,
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    appendChild() {}, click() {}, animate: () => ({}), getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    setAttribute() {}, play: () => Promise.resolve(), pause() {}, load() {},
  };
}
const els = {};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Math, JSON,
  document: {
    getElementById: (id) => els[id] || (els[id] = stubEl()),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, createElement: () => stubEl(), body: stubEl(),
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Audio: class { constructor() {} play() { return Promise.resolve(); } pause() {} },
  fetch: async () => ({ ok: true, json: async () => data, arrayBuffer: async () => new ArrayBuffer(0) }),
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0,
  location: { href: 'http://localhost/v2/', search: '' },
  navigator: { userAgent: 'node' },
  Engine,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(V2, 'client.js'), 'utf8'), sandbox, { filename: 'client.js' });
const P = sandbox.__purpose;
ok(!!P && typeof P.infer === 'function' && typeof P.phaseCtx === 'function', 'P0: __purpose surface exists');

const handCards = (n, over) => Array.from({ length: n }, (_, i) => Object.assign({ code: 1000 + i, con: 0, loc: HAND, seq: i }, over || {}));
const basePrompt = () => ({ name: 'SELECT_CARD', player: 0, cancelable: false, context: null, min: 2, max: 2, cards: handCards(8) });
const baseState = () => ({ phaseName: 'END', chain: [], players: [{ hand: handCards(8) }, { hand: [] }] });

ok(P.infer(basePrompt(), baseState()) === 'handlimit', 'P1: genuine end-phase over-limit discard is identified');
{ const p = basePrompt(); p.context = { code: 1, link: 1 }; ok(P.infer(p, baseState()) === null, 'P2: an asking effect (context set) is NOT labeled'); }
{ const s = baseState(); s.chain = [{ code: 1 }]; ok(P.infer(basePrompt(), s) === null, 'P3: a live chain is NOT labeled'); }
{ const s = baseState(); s.phaseName = 'MAIN1'; ok(P.infer(basePrompt(), s) === null, 'P4: main phase is NOT labeled'); }
{ const p = basePrompt(); p.cancelable = true; ok(P.infer(p, baseState()) === null, 'P5: a cancelable selection is NOT labeled'); }
{ const p = basePrompt(); p.min = 1; ok(P.infer(p, baseState()) === null, 'P6: count below the excess is NOT labeled (cost-shaped)'); }
{ const p = basePrompt(); p.max = 3; ok(P.infer(p, baseState()) === null, 'P7: min != max is NOT labeled'); }
{ const p = basePrompt(); p.cards = handCards(8); p.cards[3] = { code: 9, con: 0, loc: GRAVE, seq: 0 }; ok(P.infer(p, baseState()) === null, 'P8: a non-hand candidate is NOT labeled'); }
{ const p = basePrompt(); p.cards = handCards(8, { con: 1 }); ok(P.infer(p, baseState()) === null, 'P9: the other player\'s cards are NOT labeled'); }
{ const p = basePrompt(); p.name = 'SELECT_TRIBUTE'; ok(P.infer(p, baseState()) === null, 'P10: tribute prompts are NOT labeled'); }
{ const s = baseState(); s.players[0].hand = handCards(6); const p = basePrompt(); p.min = 0; p.max = 0; ok(P.infer(p, s) === null, 'P11: hand at the limit is NOT labeled'); }
{ const s = baseState(); s.players[0].hand = handCards(7); const p = basePrompt(); p.min = 1; p.max = 1; p.cards = handCards(7); ok(P.infer(p, s) === 'handlimit', 'P12: excess of exactly 1 is identified'); }

ok(P.phaseCtx('BATTLE_START') === 'バトルフェイズ', 'W1: BATTLE_START -> バトルフェイズ');
ok(P.phaseCtx('BATTLE_STEP') === 'バトルフェイズ', 'W2: BATTLE_STEP -> バトルフェイズ');
ok(P.phaseCtx('BATTLE') === 'バトルフェイズ', 'W3: BATTLE -> バトルフェイズ');
ok(P.phaseCtx('DAMAGE') === 'ダメージ計算の確認', 'W4: DAMAGE -> ダメージ計算の確認');
ok(P.phaseCtx('DAMAGE_CAL') === 'ダメージ計算の確認', 'W5: DAMAGE_CAL -> ダメージ計算の確認');
ok(P.phaseCtx('MAIN1') === 'メイン1' && P.phaseCtx('END') === 'エンド' && P.phaseCtx('DRAW') === 'ドロー', 'W6: other phases keep their names');

// ---- select-hint purpose line (2026-11-05): the hint value ->
// purpose sentence mapping is a mechanical table over the
// HINTMSG_* system ids (constant.lua). Representative values
// pin the wording; everything that proves no specific purpose
// (generic SELECT, a raw card code, an aux.Stringid card-string
// id, non-numbers) must yield null so the sheet keeps the
// generic heading instead of a guessed purpose.
ok(typeof P.hintText === 'function' && typeof P.purposeText === 'function', 'H0: hint purpose surface exists');
ok(P.hintText(509) === '特殊召喚するカードを選択', 'H1: HINTMSG_SPSUMMON -> 特殊召喚するカードを選択');
ok(P.hintText(503) === '除外するカードを選択', 'H2: HINTMSG_REMOVE -> 除外するカードを選択');
ok(P.hintText(506) === '手札に加えるカードを選択', 'H3: HINTMSG_ATOHAND -> 手札に加えるカードを選択');
ok(P.hintText(502) === '破壊するカードを選択', 'H4: HINTMSG_DESTROY -> 破壊するカードを選択');
ok(P.hintText(501) === '捨てるカードを選択', 'H5: HINTMSG_DISCARD -> 捨てるカードを選択');
ok(P.hintText(504) === '墓地へ送るカードを選択', 'H6: HINTMSG_TOGRAVE -> 墓地へ送るカードを選択');
ok(P.hintText(507) === 'デッキに戻すカードを選択', 'H7: HINTMSG_TODECK -> デッキに戻すカードを選択');
ok(P.hintText(505) === '手札に戻すカードを選択', 'H8: HINTMSG_RTOHAND -> 手札に戻すカードを選択');
ok(P.hintText(500) === 'リリースするカードを選択' && P.hintText(531) === 'リリースするカードを選択', 'H9: RELEASE / TRIBUTE -> リリース');
ok(P.hintText(511) === '融合素材にするカードを選択' && P.hintText(512) === 'シンクロ素材にするカードを選択' && P.hintText(513) === 'エクシーズ素材にするカードを選択', 'H10: material hints -> 素材にするカードを選択');
ok(P.hintText(519) === '取り除くエクシーズ素材を選択', 'H11: HINTMSG_REMOVEXYZ');
ok(P.hintText(551) === '対象とするカードを選択', 'H12: HINTMSG_TARGET');
ok(P.hintText(510) === 'セットするカードを選択' && P.hintText(527) === 'フィールドに出すカードを選択' && P.hintText(579) === '墓地に戻すカードを選択', 'H13: SET / TOFIELD / RTOGRAVE');
ok(P.hintText(560) === null, 'H14: HINTMSG_SELECT (bare "select") proves nothing -> null');
ok(P.hintText(529) === null && P.hintText(530) === null, 'H15: SELF / OPPO name sides, not purposes -> null');
ok(P.hintText(14087893) === null, 'H16: a raw card code is not a generic purpose -> null');
ok(P.hintText(2035286017) === null, 'H17: an aux.Stringid card-string id is not a generic purpose -> null');
ok(P.hintText(null) === null && P.hintText(undefined) === null && P.hintText('509') === null, 'H18: non-numbers -> null');
ok(P.purposeText({ selectHint: 509 }) === '特殊召喚するカードを選択', 'H19: purposeText reads prompt.selectHint');
ok(P.purposeText({}) === null && P.purposeText(null) === null && P.purposeText({ selectHint: 560 }) === null, 'H20: no provable purpose -> null (generic heading kept)');

const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
ok(!/vs\.animate\(\[\{ opacity: 0 \}, \{ opacity: 1 \}\]/.test(clientSrc), 'D1: the VS curtain is not opacity-faded (DS-07)');
ok(!clientSrc.includes('id="sheet-cancel">盤面に戻る'), 'D2: no close button says 盤面に戻る anymore (W-28)');
ok(clientSrc.includes('手札の上限') && clientSrc.includes('このカードを捨てる'), 'D3: hand-limit title + discard confirm are wired');
ok(clientSrc.includes('class="purpose"'), 'D4: the purpose line is rendered by the selection sheets');
ok(clientSrc.includes('contextLineHTML(o.prompt)'), 'D5: the effect context line still renders beside the purpose line');

console.log(fails ? ('\n' + fails + ' FAILURES') : '\nALL PURPOSE CHECKS PASSED');
process.exit(fails ? 1 : 0);
