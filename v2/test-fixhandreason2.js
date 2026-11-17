'use strict';
/* test-fixhandreason2.js — trap-activation reasons (fix-handreason2-1117).
   The hand sheet stayed silent for TRAPS: handCandidates only
   counts a trap with an explicit 「手札から発動できる」 segment,
   so 現世 / ロールバック got no row at all — only the set
   button. This round adds the trap half of the hand surface:
   (a) the rule — a trap cannot be activated from the hand, it
   must be set first — and (b) the activation condition of
   segment ① when mechanically derivable (grave counts, a
   target's existence), on the same grey row after a 。.
   The one exception is タイフーン, whose own text grants a
   conditional hand activation — it never gets the blanket rule,
   only its condition. Two corrections to the round's brief, both
   from the official texts: 現世 needs EACH grave 15+ (not 15
   total), and ロールバック① targets the OPPONENT's grave.
   Secondary: the field sheet's generic '今は発動できません'
   becomes the phase reason for an ignition in the wrong phase
   (the observed case: カルボン① in battle phase).
   Loads the REAL client.js (vm + stub DOM, same technique as
   test-fixhandreason) against the REAL data.json / fxmap.json.
   Pins:
     T1-T14 trapHandReason on synthetic live states
     T15-T26 trapConditionReason per pattern (P1-P12)
     T27-T32 fieldPhaseReason (phase / turn / prompt guards)
     T33-T36 sheet wiring (hand trap rows, field phase row,
            preview) + the 36-trap pool audit (H5-style) */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const V2 = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const fxmap = JSON.parse(fs.readFileSync(path.join(V2, 'fxmap.json'), 'utf8'));

function stubEl() {
  const el = {
    children: [], style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    textContent: '', innerHTML: '', className: '', disabled: false, volume: 1,
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    appendChild() {}, click() {}, animate: () => ({}), getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    setAttribute() {}, play: () => Promise.resolve(), pause() {}, load() {},
  };
  return el;
}
const els = {};
const documentStub = {
  getElementById: (id) => els[id] || (els[id] = stubEl()),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, createElement: () => stubEl(), body: stubEl(),
};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Math, JSON,
  document: documentStub,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Audio: class { constructor() {} play() { return Promise.resolve(); } pause() {} },
  fetch: async () => ({ ok: true, json: async () => data, arrayBuffer: async () => new ArrayBuffer(0) }),
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0,
  location: { href: 'http://localhost/v2/', search: '' },
  navigator: { userAgent: 'node' },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.Engine = require(path.join(V2, 'engine.js'));
vm.createContext(sandbox);
const src = fs.readFileSync(path.join(V2, 'client.js'), 'utf8') +
  '\n;globalThis.__T = { DATA: () => DATA, setDATA: (d) => { DATA = d; }, setFXMAP: (m) => { FXMAP = m; }, setSeatDecks: (a, b) => { seatDeckKeys = [a, b]; }, setDuelState: (s) => { duelState = s; }, setPrompt: (p) => { currentPrompt = p; cmdPromptOpen = !!p; }, setActionMap: (m) => { actionMap = m; }, openActionSheet, effectSegments, handCandidates, handUsedReason, handTargetReason, trapHandReason, trapConditionReason, fieldPhaseReason, nameLimitReason, handTapReason };';
vm.runInContext(src, sandbox, { filename: 'client.js' });
const T = sandbox.__T;
T.setDATA(data);
T.setFXMAP(fxmap);
const PC = sandbox.__poolcov;
const SID = (code, idx) => code * 1048576 + idx;
const E = sandbox.Engine;

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const FU_ATK = 0x1, FU_DEF = 0x4, FD_ATK = 0x2, FD_DEF = 0x8;
const GEN = 17484499, ROLLBACK = 6351147, HAKAMORI = 98715423, BAKUDAN = 51208877, GOFUU = 78625592;
const TYPHOON = 14883228, TENSEI2 = 46652477, LIVING = 97077563, ESCAPE = 94192409, ARISTIA = 50590801;
const DRAGMA = 82956214, HAKAIRIN = 83555666, ARROW = 67037924, SHINGEN = 54241725, MAGNASLAYER = 47819246;
const HOUJU = 38643567, GENCHANGE = 34460239, NARAKU = 29401950, JIRAI = 33055499, METABA = 89208725;
const TAIYOU = 38699854, KARUBON = 15079028, KELDO = 63542003, MUDORA = 99937011;
const MAGNUS = 84025439, CASTEL = 82633039, GIGAMANTIS = 94573223, LUCE = 45409943;
const NARAKU_CARD = 29401950, RENGEKI = 18235309, SHINGEN_CARD = 54241725;
const RULE = '罠は手札からは発動できない。セットしてから発動する';

// synthetic live state (zones accept codes or {code, pos} objects)
function st(o) {
  const zone = (x, n) => {
    const arr = (x || []).map(c => {
      if (c == null) return null;
      if (typeof c === 'object') return { code: c.code, pos: c.pos != null ? c.pos : FU_ATK };
      return { code: c, pos: FU_ATK };
    });
    while (arr.length < n) arr.push(null);
    return arr;
  };
  const p = (x) => ({
    hand: (x.hand || []).map(c => ({ code: c })),
    mzone: zone(x.mzone, 7),
    szone: zone(x.szone, 8),
    grave: (x.grave || []).slice(),
    lp: x.lp != null ? x.lp : 8000,
    deckCount: x.deckCount != null ? x.deckCount : 40,
  });
  const a = p(o.me || {}), b = p(o.opp || {});
  return {
    turnCount: o.turnCount != null ? o.turnCount : 1,
    turnPlayer: o.turnPlayer != null ? o.turnPlayer : 0,
    phaseName: o.phaseName || 'MAIN1',
    players: [a, b],
  };
}
T.setSeatDecks('ishizu', 'gg');

// ---------- T1-T14: trapHandReason ----------
ok(T.trapHandReason(GEN, st({})) === RULE + '。お互いの墓地のカードがそれぞれ15枚以上必要です（現在 自分0枚／相手0枚）', 'T1a: 現世, both graves empty -> rule + per-grave counts');
ok(T.trapHandReason(GEN, st({ me: { grave: [LUCE, LUCE, LUCE, LUCE] }, opp: { grave: [] } })) === RULE + '。お互いの墓地のカードがそれぞれ15枚以上必要です（現在 自分4枚／相手0枚）', 'T1b: 現世, own 4 / opp 0 -> counts update per side');
ok(T.trapHandReason(GEN, st({ me: { grave: Array(15).fill(LUCE) }, opp: { grave: Array(15).fill(LUCE) } })) === RULE, 'T1c: 現世, 15/15 -> condition holds, rule alone (no invented condition)');
ok(T.trapHandReason(GEN, st({ me: { grave: Array(15).fill(LUCE) }, opp: { grave: Array(14).fill(LUCE) } })) === RULE + '。お互いの墓地のカードがそれぞれ15枚以上必要です（現在 自分15枚／相手14枚）', 'T1d: 現世, 15/14 -> the SHORT side is the reason (each grave needs 15, not 15 total)');
ok(T.trapHandReason(ROLLBACK, st({})) === RULE + '。相手の墓地に通常罠カードがありません', 'T2a: ロールバック, opponent grave empty -> rule + opponent-grave reason');
ok(T.trapHandReason(ROLLBACK, st({ opp: { grave: [NARAKU_CARD] } })) === RULE, 'T2b: ロールバック, opponent grave holds a normal trap -> rule alone');
ok(T.trapHandReason(ROLLBACK, st({ opp: { grave: [ROLLBACK, ROLLBACK] } })) === RULE + '。相手の墓地に通常罠カードがありません', 'T2c: ロールバック, opponent grave holds only rollback copies -> excluded by the 「以外」 clause');
ok(T.trapHandReason(ROLLBACK, st({ opp: { grave: [HAKAMORI] } })) === RULE + '。相手の墓地に通常罠カードがありません', 'T2d: ロールバック, opponent grave holds only a CONTINUOUS trap -> not a normal trap');
ok(T.trapHandReason(ROLLBACK, st({ me: { grave: [NARAKU_CARD] } })) === RULE + '。相手の墓地に通常罠カードがありません', 'T2e: ロールバック, a normal trap in the OWN grave does NOT satisfy ① (it targets the opponent grave)');
ok(T.trapHandReason(BAKUDAN, st({})) === RULE, 'T3a: 爆弾 (attack trigger) -> rule alone, no invented condition');
ok(T.trapHandReason(HAKAMORI, st({})) === RULE, 'T3b: 墓守の罠 (continuous ①) -> rule alone');
ok(T.trapHandReason(GOFUU, st({})) === RULE, 'T3c: 光の護封霊剣 (attack trigger) -> rule alone');
ok(T.trapHandReason(NARAKU, st({})) === RULE, 'T3d: 奈落の落とし穴 (summon trigger) -> rule alone');
ok(T.trapHandReason(JIRAI, st({})) === RULE, 'T3e: 地雷蜘蛛の餌食 (no condition to check) -> rule alone');
ok(T.trapHandReason(METABA, st({})) === RULE, 'T3f: メタバース (deck contents, not live-known) -> rule alone');
ok(T.trapHandReason(TAIYOU, st({})) === null, 'T4a: a non-trap (太陽の書) gets no trap reason');
{
  // a trap with an explicit hand activation is the existing hand
  // machinery's job — the blanket rule must never appear for it
  const fixture = JSON.parse(JSON.stringify(data));
  fixture.texts[String(NARAKU)] = { name: '奈落の落とし穴', text: '①：手札から発動できる。相手フィールドのモンスター１体を対象として発動できる。そのモンスターを破壊する。' };
  T.setDATA(fixture);
  ok(JSON.stringify(T.handCandidates(NARAKU)) === '[1]', 'T4b setup: fixture 奈落 has a hand candidate');
  ok(T.trapHandReason(NARAKU, st({})) === null, 'T4b: explicit hand activation -> no trap rule');
  T.setDATA(data);
}

// ---------- T5-T14: typhoon (the conditional hand activation) ----------
ok(T.trapHandReason(TYPHOON, st({})) === '相手フィールドに魔法・罠カードが2枚以上ありません（現在0枚）', 'T5a: タイフーン, opponent field empty -> head condition, NO blanket rule');
ok(T.trapHandReason(TYPHOON, st({ opp: { szone: [NARAKU_CARD] } })) === '相手フィールドに魔法・罠カードが2枚以上ありません（現在1枚）', 'T5b: タイフーン, opponent field holds 1 -> live count');
ok(T.trapHandReason(TYPHOON, st({ opp: { szone: [NARAKU_CARD, NARAKU_CARD] }, me: { szone: [NARAKU_CARD] } })) === '自分フィールドに魔法・罠カードがあるため、手札からは発動できません', 'T5c: タイフーン, opponent 2+ but own field holds one -> own-field reason');
ok(T.trapHandReason(TYPHOON, st({ opp: { szone: [{ code: NARAKU_CARD, pos: FD_DEF }, { code: NARAKU_CARD, pos: FD_DEF }] } })) === 'フィールドに表側表示の魔法・罠カードがありません', 'T5d: タイフーン, hand condition met but no face-up S/T target -> ① target reason');
ok(T.trapHandReason(TYPHOON, st({ opp: { szone: [{ code: NARAKU_CARD, pos: FU_ATK }, { code: NARAKU_CARD, pos: FD_DEF }] } })) === null, 'T5e: タイフーン, hand condition met and a face-up target exists -> silent (the engine should offer it)');

// ---------- T15-T26: trapConditionReason per pattern ----------
ok(T.trapConditionReason(TENSEI2, st({})) === 'お互いの墓地にカードが2枚ありません', 'T15a: 転生の予言, both graves empty -> total-count reason');
ok(T.trapConditionReason(TENSEI2, st({ me: { grave: [LUCE] } })) === 'お互いの墓地にカードが2枚ありません', 'T15b: 転生の予言, 1 total -> still short');
ok(T.trapConditionReason(TENSEI2, st({ me: { grave: [LUCE] }, opp: { grave: [LUCE] } })) === null, 'T15c: 転生の予言, 2 total -> condition holds, silent');
ok(T.trapConditionReason(LIVING, st({})) === '自分の墓地にモンスターがいません', 'T16a: リビングデッド, own grave empty -> reason');
ok(T.trapConditionReason(LIVING, st({ me: { grave: [LUCE] } })) === null, 'T16b: リビングデッド, a monster in the own grave -> silent');
ok(T.trapConditionReason(ESCAPE, st({})) === 'フィールドにモンスターがいません', 'T17a: 強制脱出装置, no monster anywhere -> reason');
ok(T.trapConditionReason(ESCAPE, st({ opp: { mzone: [{ code: LUCE, pos: FU_ATK }] } })) === null, 'T17b: 強制脱出装置, a monster on the opponent field -> silent');
ok(T.trapConditionReason(ARISTIA, st({})) === '自分フィールドに表側表示モンスターがいません', 'T18a: アリスティア, no own face-up monster -> reason');
ok(T.trapConditionReason(ARISTIA, st({ me: { mzone: [{ code: LUCE, pos: FU_ATK }] } })) === null, 'T18b: アリスティア, an own face-up monster -> silent');
ok(T.trapConditionReason(DRAGMA, st({})) === '相手フィールドに表側表示モンスターがいません', 'T19a: ドラグマ, no opponent face-up monster -> reason');
ok(T.trapConditionReason(DRAGMA, st({ opp: { mzone: [{ code: LUCE, pos: FU_ATK }] } })) === null, 'T19b: ドラグマ, an opponent face-up monster -> silent');
ok(T.trapConditionReason(HAKAIRIN, st({})) === '相手フィールドに表側表示モンスターがいません', 'T19c: 破壊輪, no opponent face-up monster -> reason');
ok(T.trapConditionReason(ARROW, st({})) === '相手フィールドに表側表示モンスターがいません', 'T19d: 巨神封じの矢, no opponent face-up monster -> reason (the EX-summoned qualifier is NOT claimed)');
ok(T.trapConditionReason(ARROW, st({ opp: { mzone: [{ code: LUCE, pos: FU_ATK }] } })) === null, 'T19e: 巨神封じの矢, an opponent face-up monster exists -> silent (whether it was EX-summoned is untracked)');
ok(T.trapConditionReason(SHINGEN, st({ me: { grave: [RENGEKI] } })) === '自分の墓地に「帝王」魔法・罠カードが2枚ありません', 'T20a: 真源の帝王, 1 帝王 S/T in grave -> reason with the name');
ok(T.trapConditionReason(SHINGEN, st({ me: { grave: [RENGEKI, SHINGEN_CARD] } })) === null, 'T20b: 真源の帝王, 2 帝王 S/T in grave -> silent');
ok(T.trapConditionReason(MAGNASLAYER, st({})) === '自分フィールドに「超量」Xモンスターがいません', 'T21a: マグナスレイヤー, no own 超量 Xyz -> reason');
ok(T.trapConditionReason(MAGNASLAYER, st({ me: { mzone: [{ code: MAGNUS, pos: FU_ATK }] } })) === null, 'T21b: マグナスレイヤー, an own 超量 Xyz -> silent');
ok(T.trapConditionReason(MAGNASLAYER, st({ me: { mzone: [{ code: CASTEL, pos: FU_ATK }] } })) === '自分フィールドに「超量」Xモンスターがいません', 'T21c: マグナスレイヤー, an Xyz WITHOUT 超量 in its name does NOT satisfy the target');
ok(T.trapConditionReason(HOUJU, st({})) === '自分フィールドに「甲虫装機」と名のついたモンスターがいません', 'T22a: 甲虫装機の宝珠, no own 甲虫装機 monster -> reason');
ok(T.trapConditionReason(HOUJU, st({ me: { mzone: [{ code: GIGAMANTIS, pos: FU_ATK }] } })) === null, 'T22b: 甲虫装機の宝珠, an own 甲虫装機 monster -> silent');
ok(T.trapConditionReason(GENCHANGE, st({})) === '自分フィールドに表側表示モンスターがいません', 'T23a: ジェネレーション・チェンジ (unnumbered text), no own face-up monster -> reason');
ok(T.trapConditionReason(GENCHANGE, st({ me: { mzone: [{ code: LUCE, pos: FU_ATK }] } })) === null, 'T23b: ジェネレーション・チェンジ, an own face-up monster -> silent');
ok(T.trapConditionReason(NARAKU, st({})) === null, 'T24a: trigger segments never yield a condition (奈落)');
ok(T.trapConditionReason(HAKAMORI, st({})) === null, 'T24b: a continuous ① yields no condition (墓守の罠)');
ok(T.trapConditionReason(TAIYOU, st({})) === null, 'T24c: trapConditionReason on a non-trap is null');

// ---------- T27-T32: fieldPhaseReason ----------
// カルボン① is an ignition (release this normally summoned card);
// in battle phase on the own turn at an idle prompt the phase is
// the certain reason. The state helper carries turnPlayer +
// phaseName; the sheet helper below sets the prompt.
function fieldState(phase, tp, promptName) {
  const s = st({ me: { mzone: [{ code: KARUBON, pos: FU_ATK }] }, turnPlayer: tp, phaseName: phase });
  T.setDuelState(s);
  T.setPrompt(promptName ? { prompt: { name: promptName } } : null);
  return s;
}
fieldState('MAIN1', 0, 'SELECT_IDLECMD');
ok(T.fieldPhaseReason(KARUBON) === null, 'T27a: カルボン, MAIN1 idle -> no phase reason');
fieldState('BATTLE', 0, 'SELECT_BATTLECMD');
ok(T.fieldPhaseReason(KARUBON) === '起動効果はメインフェイズにしか発動できません', 'T27b: カルボン, BATTLE idle own turn -> phase reason (the observed case)');
fieldState('BATTLE', 0, 'SELECT_IDLECMD');
ok(T.fieldPhaseReason(KARUBON) === '起動効果はメインフェイズにしか発動できません', 'T27c: カルボン, BATTLE via SELECT_IDLECMD -> phase reason too');
fieldState('BATTLE', 1, 'SELECT_BATTLECMD');
ok(T.fieldPhaseReason(KARUBON) === null, 'T28a: カルボン, opponent turn -> no phase reason (the turn is not the claim)');
fieldState('BATTLE', 0, 'SELECT_CHAIN');
ok(T.fieldPhaseReason(KARUBON) === null, 'T28b: カルボン, chain prompt -> generic (the immediate blocker is the chain)');
fieldState('BATTLE', 0, null);
ok(T.fieldPhaseReason(KARUBON) === null, 'T28c: カルボン, no prompt at all -> generic');
fieldState('END', 0, 'SELECT_IDLECMD');
ok(T.fieldPhaseReason(KARUBON) === '起動効果はメインフェイズにしか発動できません', 'T28d: カルボン, END phase -> phase reason');
{
  const s = st({ me: { szone: [{ code: HAKAMORI }] }, turnPlayer: 0, phaseName: 'BATTLE' });
  T.setDuelState(s);
  T.setPrompt({ prompt: { name: 'SELECT_BATTLECMD' } });
  ok(T.fieldPhaseReason(HAKAMORI) === null, 'T29: 墓守の罠② can fire on either main phase -> no phase reason (the guard holds)');
}
{
  const s = st({ me: { mzone: [{ code: 25926710, pos: FU_ATK }] }, turnPlayer: 0, phaseName: 'BATTLE' });
  T.setDuelState(s);
  T.setPrompt({ prompt: { name: 'SELECT_BATTLECMD' } });
  ok(T.fieldPhaseReason(25926710) === null, 'T30: ケルベク (trigger-only field candidates) -> no phase reason');
}
fieldState('MAIN2', 0, 'SELECT_IDLECMD');
ok(T.fieldPhaseReason(KARUBON) === null, 'T32: カルボン, MAIN2 idle -> no phase reason');

// ---------- T33-T36: sheet wiring + preview + pool audit ----------
// The sheet is built by openActionSheet; drive it with a stub
// actionMap holding only a set action (no activate) and check the
// grey row appears with the derived reason, the set button stays
// above it, and nothing appears when the activation is offered.
function sheetHTMLFor(code, acts, state, key) {
  T.setDuelState(state);
  T.setPrompt({ prompt: { name: 'SELECT_IDLECMD' } });
  T.setActionMap(new Map([[key || '0:2:0', acts]]));
  if (els.sheet) els.sheet.innerHTML = '';
  T.openActionSheet(key || '0:2:0');
  return els.sheet ? els.sheet.innerHTML : '';
}
{
  const s1 = st({ me: { hand: [GEN] } });
  const h1 = sheetHTMLFor(GEN, [{ label: '魔法・罠をセット', bytes: [], code: GEN, desc: 0, activate: false }], s1);
  ok(h1.includes('効果を発動') && h1.includes('罠は手札からは発動できない') && h1.includes('お互いの墓地のカードがそれぞれ15枚以上必要です（現在 自分0枚／相手0枚）'), 'T33a: sheet shows the trap row with rule + counts (現世, graves empty)');
  ok(h1.indexOf('魔法・罠をセット') < h1.indexOf('optbtn disabled'), 'T33b: the set button stays ABOVE the reason row');
  const s2 = st({ me: { hand: [ROLLBACK] }, opp: { grave: [NARAKU_CARD] } });
  const h2 = sheetHTMLFor(ROLLBACK, [{ label: '魔法・罠をセット', bytes: [], code: ROLLBACK, desc: 0, activate: false }], s2);
  ok(h2.includes('罠は手札からは発動できない') && !h2.includes('通常罠カードがありません'), 'T33c: sheet shows the rule alone when the condition holds (ロールバック, normal trap in opponent grave)');
  const h3 = sheetHTMLFor(GEN, [{ label: '効果を発動', bytes: [], code: GEN, desc: 0, activate: true }], s1);
  ok(!h3.includes('optbtn disabled'), 'T33d: an offered activation shows no grey row');
  // field sheet: カルボン on the field, battle phase, no action
  const s4 = st({ me: { mzone: [{ code: KARUBON, pos: FU_ATK }] }, turnPlayer: 0, phaseName: 'BATTLE' });
  const h4 = sheetHTMLFor(KARUBON, [], s4, '0:4:0');
  ok(h4.includes('効果を発動') && h4.includes('起動効果はメインフェイズにしか発動できません'), 'T34a: field sheet shows the phase reason (カルボン, battle)');
  const s5 = st({ me: { mzone: [{ code: KARUBON, pos: FU_ATK }] }, turnPlayer: 0, phaseName: 'MAIN1' });
  const h5 = sheetHTMLFor(KARUBON, [], s5, '0:4:0');
  ok(h5.includes('効果を発動') && h5.includes('今は発動できません') && !h5.includes('メインフェイズにしか'), 'T34b: field sheet keeps the generic form in MAIN1');
  // preview: a hand trap with NO offered action at all
  T.setDuelState(st({ me: { hand: [GEN] } }));
  T.setPrompt({ prompt: { name: 'SELECT_IDLECMD' } });
  T.setActionMap(new Map()); // no offered action for this card
  ok((T.handTapReason(GEN, '0:2:0') || '').indexOf('罠は手札からは発動できない') === 0, 'T35a: preview states the trap rule for a no-action hand trap');
  ok(T.handTapReason(TAIYOU, '0:2:0') === '対象になる裏側表示モンスターがいません', 'T35b: preview regression — 太陽の書 still states its target reason');
}
// ---------- T36: the 36-trap pool audit ----------
// On a fully empty state, every trap must produce exactly one of:
//   rule+condition (13), the typhoon head reason (1), rule alone (22).
// This pins the coverage claim: no trap is silently unclassified,
// and no trap gets a condition its text cannot support.
{
  const empty = st({});
  const withCond = [], headOnly = [], ruleOnly = [];
  for (const code of Object.keys(data.texts)) {
    const c = data.cards[code];
    if (!c || !(c.type & 0x4)) continue;
    const r = T.trapHandReason(+code, empty);
    if (r === null) { ok(false, 'T36 setup: trap ' + code + ' returned null (must always state the rule or its head condition)'); continue; }
    if (r.indexOf('罠は手札からは発動できない') !== 0) headOnly.push(+code);
    else if (r === RULE) ruleOnly.push(+code);
    else withCond.push(+code);
  }
  const expectCond = [GEN, ROLLBACK, TENSEI2, LIVING, ESCAPE, ARISTIA, DRAGMA, HAKAIRIN, ARROW, SHINGEN, MAGNASLAYER, HOUJU, GENCHANGE].sort((a, b) => a - b);
  const expectHead = [TYPHOON];
  const expectRule = [18158393, 18235309, 1825445, 22201234, 24092792, 29401950, 31548215, 33055499, 38798785, 40605147, 44095762, 51208877, 53582587, 62995268, 70342110, 74003290, 78625592, 81066751, 84749824, 89208725, 96216229, 98715423].sort((a, b) => a - b);
  ok(JSON.stringify(withCond.sort((a, b) => a - b)) === JSON.stringify(expectCond), 'T36a: 13 traps carry a derivable condition on an empty state (got ' + withCond.length + ')');
  ok(JSON.stringify(headOnly) === JSON.stringify(expectHead), 'T36b: typhoon alone takes the head-condition path');
  ok(JSON.stringify(ruleOnly.sort((a, b) => a - b)) === JSON.stringify(expectRule), 'T36c: 22 traps stay rule-only on an empty state (got ' + ruleOnly.length + ')');
  ok(withCond.length + headOnly.length + ruleOnly.length === 36, 'T36d: the audit covers all 36 pool traps');
}

console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
