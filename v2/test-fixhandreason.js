'use strict';
/* test-fixhandreason.js — hand-activation reasons (fix-handreason-1117).
   The hand sheet previously stated only a spent card-name limit
   when an activation was not offered. This round adds the
   per-effect once-per-turn spend (handUsedReason) and every
   mechanically derivable target / condition / cost reason
   (handTargetReason), and stays silent when nothing is derivable.
   Loads the REAL client.js (vm + stub DOM, same technique as
   test-poolcov) against the REAL data.json / fxmap.json.
   Pins:
     H1-H5  handCandidates classification (spot checks + pool-wide
            structural checks + the audit table printed below)
     H6-H12 handUsedReason (spend, expiry, per-effect vs shared,
            and the name-limit gap it closes)
     H13-H27 handTargetReason on synthetic live states
     H28    LP-cost branch (fixture text: no pool card carries an
            LP cost on a hand candidate segment)
     H29    the sheet wiring: openActionSheet shows the grey row
            with the derived reason, and nothing when underivable
   Measurement behind the buckets (probe-handreason.js, 60 duels
   Ishizu vs GG, 2,902 idle prompts): 1,309 not-offered
   sightings of hand-candidate cards; the buckets explain 1,279;
   the residual 30 are 丘① (deck contents, not live-known) and
   天至① (EX-side: every ルーチェ copy already summoned). */
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
  '\n;globalThis.__T = { DATA: () => DATA, setDATA: (d) => { DATA = d; }, setFXMAP: (m) => { FXMAP = m; }, setSeatDecks: (a, b) => { seatDeckKeys = [a, b]; }, setDuelState: (s) => { duelState = s; }, setPrompt: (p) => { currentPrompt = p; cmdPromptOpen = !!p; }, setActionMap: (m) => { actionMap = m; }, openActionSheet, effectSegments, handCandidates, handUsedReason, handTargetReason, nameLimitReason };';
vm.runInContext(src, sandbox, { filename: 'client.js' });
const T = sandbox.__T;
T.setDATA(data);
T.setFXMAP(fxmap);
const PC = sandbox.__poolcov;
const SID = (code, idx) => code * 1048576 + idx;
const E = sandbox.Engine;

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

// ---------- H1-H3: handCandidates spot checks ----------
const HANA = 62133026, MORI = 36745317, KELDO = 63542003, MUDORA = 99937011, SILKY = 55702233, ZORUA = 31525442, OKA = 9350312;
const TAIYOU = 38699854, TSUKI = 14087893, SOSEI = 83764718, MC = 28958464, FUKUSO = 35726888, TENSEI = 71593652;
const GEN = 17484499, HAKAMORI = 98715423, BAKUDAN = 51208877, ROLLBACK = 6351147, GOFUU = 78625592;
const KELBEK = 25926710, SPHINX = 46148485, CHAOSPOD = 79106360, MICHIZURE = 16435215, SOUDO = 51612489;
ok(JSON.stringify(T.handCandidates(TAIYOU)) === '[1]', 'H1a: 太陽の書 hand candidates = ①');
ok(JSON.stringify(T.handCandidates(TSUKI)) === '[1]', 'H1b: 月の書 hand candidates = ①');
ok(JSON.stringify(T.handCandidates(SOSEI)) === '[1]', 'H1c: 死者蘇生 hand candidates = ①');
ok(JSON.stringify(T.handCandidates(MC)) === '[1]', 'H1d: マジックカード「死者蘇生」 hand candidates = ①');
ok(JSON.stringify(T.handCandidates(FUKUSO)) === '[1]', 'H1e: おろかな副葬 hand candidates = ① (no 発動できる wording — the activation itself)');
ok(JSON.stringify(T.handCandidates(TENSEI)) === '[1]', 'H1f: 天至る叛逆 hand candidates = ① only (② is grave-bound)');
ok(JSON.stringify(T.handCandidates(HANA)) === '[1]', 'H2a: 花 hand candidates = ①');
ok(JSON.stringify(T.handCandidates(MORI)) === '[1]', 'H2b: 森 hand candidates = ①');
ok(JSON.stringify(T.handCandidates(KELDO)) === '[1]', 'H2c: ケルドウ hand candidates = ①');
ok(JSON.stringify(T.handCandidates(MUDORA)) === '[1]', 'H2d: ムドラ hand candidates = ①');
ok(JSON.stringify(T.handCandidates(SILKY)) === '[1]', 'H2e: シルキィ hand candidates = ① (state condition, not a trigger)');
ok(JSON.stringify(T.handCandidates(ZORUA)) === '[1]', 'H2f: ゾルガ hand candidates = ①');
ok(JSON.stringify(T.handCandidates(OKA)) === '[1]', 'H2g: 丘 hand candidates = ①');
ok(JSON.stringify(T.handCandidates(MICHIZURE)) === '[1]', 'H2h: 墓穴の道連れ hand candidates = ①');
ok(JSON.stringify(T.handCandidates(SOUDO)) === '[1]', 'H2i: 騒動 hand candidates = ① (quick-play spell)');
ok(JSON.stringify(T.handCandidates(KELBEK)) === '[]', 'H3a: ケルベク has no hand candidate (① is a past-tense trigger)');
ok(JSON.stringify(T.handCandidates(SPHINX)) === '[]', 'H3b: スフィンクス has no hand candidate (① trigger, ② field)');
ok(JSON.stringify(T.handCandidates(GEN)) === '[]', 'H3c: 現世と冥界の逆転 has no hand candidate (trap: set first)');
ok(JSON.stringify(T.handCandidates(HAKAMORI)) === '[]', 'H3d: 墓守の罠 has no hand candidate (trap: set first)');
ok(JSON.stringify(T.handCandidates(BAKUDAN)) === '[]', 'H3e: 運命の抱く爆弾 has no hand candidate (trap: set first)');
ok(JSON.stringify(T.handCandidates(ROLLBACK)) === '[]', 'H3f: トランザクション・ロールバック has no hand candidate (trap: set first)');
ok(JSON.stringify(T.handCandidates(GOFUU)) === '[]', 'H3g: 光の護封霊剣 has no hand candidate (trap: set first)');
ok(JSON.stringify(T.handCandidates(CHAOSPOD)) === '[]', 'H3h: カオスポッド has no hand candidate (flip, unnumbered)');
ok(JSON.stringify(T.handCandidates(80532587)) === '[]', 'H3i: 旧神ヌトス has no hand candidate (① activates on the field; 手札から is the summon source, not the activation)');
ok(JSON.stringify(T.handCandidates(94573223)) === '[1]', 'H3j: 甲虫装機 ギガマンティス hand candidates = ① (equips itself from the hand)');
ok(JSON.stringify(T.handCandidates(96570609)) === '[2]', 'H3k: 天帝アイテール hand candidates = ② only (① is a summon trigger)');
ok(JSON.stringify(T.handCandidates(57554544)) === '[1]', 'H3l: 炎王の孤島 hand candidates = ① only (② is a FIELD effect, not a hand activation)');
ok(JSON.stringify(T.handCandidates(72345736)) === '[1]', 'H3m: 六武衆の結束 hand candidates = ① only (② is a FIELD effect)');
ok(JSON.stringify(T.handCandidates(72332074)) === '[1]', 'H3n: 超量皆殺アルファンボール hand candidates = ① only (② is a GRAVE effect)');
ok(JSON.stringify(T.handCandidates(34771947)) === '[1]', 'H3o: ラビリンス・ウォール・シャドウ hand candidates = ① only (②③ are FIELD effects)');

// ---------- H4-H5: pool-wide structural checks + audit table ----------
{
  const all = Object.keys(data.cards).map(Number);
  let bad = [];
  const withCands = [];
  for (const code of all) {
    const cands = T.handCandidates(code);
    const segs = T.effectSegments(code).map(s => s.n);
    for (const n of cands) if (!segs.includes(n)) bad.push(code + ':' + n);
    if (cands.length) withCands.push(code);
    // traps: a hand candidate must come from an explicit 手札から発動できる segment
    const d = data.cards[String(code)];
    if ((d.type & 0x4) && cands.length) {
      const txt = (data.texts[String(code)] || {}).text || '';
      if (!/手札から発動できる/.test(txt)) bad.push(code + ':trap-without-hand-text');
    }
  }
  ok(bad.length === 0, 'H4: every hand candidate names an existing printed segment; traps only via explicit hand text' + (bad.length ? ' — ' + bad.slice(0, 5).join(', ') : ''));
  console.log('H5 audit: pool cards with hand candidates: ' + withCands.length + ' / ' + all.length);
  const byType = {};
  for (const code of withCands) {
    const t = data.cards[String(code)].type;
    const k = (t & 0x1) ? 'monster' : (t & 0x2) ? 'spell' : (t & 0x4) ? 'trap' : 'other';
    byType[k] = (byType[k] || 0) + 1;
  }
  console.log('H5 audit: by type ' + JSON.stringify(byType));
  for (const code of withCands) console.log('H5 audit: ' + code + ' ' + (data.names[String(code)] || '?') + ' cands=' + JSON.stringify(T.handCandidates(code)));
}

// ---------- H6-H12: handUsedReason ----------
PC.reset();
ok(T.nameLimitReason(HANA) === null, 'H6a: 花 carries no card-name activation limit (nameLimitReason stays silent)');
PC.trackUsedFx({ turnCount: 1, chain: [{ code: HANA, con: 0, loc: 2, seq: 0, desc: SID(HANA, 0) }] });
ok(T.handUsedReason(HANA) === 'このターン既に使用済みです', 'H6b: 花① used this turn -> OPT reason STATED (the gap nameLimitReason cannot close)');
ok(T.nameLimitReason(HANA) === null, 'H6c: nameLimitReason still silent after use — the per-effect clause is not its form');
PC.trackUsedFx({ turnCount: 2, chain: [] });
ok(T.handUsedReason(HANA) === null, 'H6d: the spend expires with the turn');
PC.reset();
PC.trackUsedFx({ turnCount: 1, chain: [{ code: KELDO, con: 0, loc: 2, seq: 0, desc: SID(KELDO, 0) }] });
ok(T.handUsedReason(KELDO) === 'このターン既に使用済みです', 'H7: ケルドウ① used -> OPT reason fires');
PC.reset();
PC.trackUsedFx({ turnCount: 1, chain: [{ code: KELDO, con: 0, loc: 2, seq: 0, desc: SID(KELDO, 1) }] });
ok(T.handUsedReason(KELDO) === null, 'H8: ケルドウ② used (per-effect clause) -> ① unspent, silent');
PC.reset();
PC.trackUsedFx({ turnCount: 1, chain: [{ code: SILKY, con: 0, loc: 2, seq: 0, desc: SID(SILKY, 0) }] });
ok(T.handUsedReason(SILKY) === 'このターン既に使用済みです', 'H9: シルキィ used -> whole-card OPT form fires');
PC.reset();
PC.trackUsedFx({ turnCount: 1, chain: [{ code: OKA, con: 0, loc: 2, seq: 0, desc: SID(OKA, 0) }] });
ok(T.handUsedReason(OKA) === 'このターン既に使用済みです', 'H10a: 丘① used -> OPT reason fires (丘 DOES carry a ①-only clause)');
PC.reset();
PC.trackUsedFx({ turnCount: 1, chain: [{ code: TAIYOU, con: 0, loc: 2, seq: 0, desc: SID(TAIYOU, 0) }] });
ok(T.handUsedReason(TAIYOU) === null, 'H10b: 太陽の書 has no once-per-turn clause -> silent even after use');
PC.reset();
PC.trackUsedFx({ turnCount: 1, chain: [{ code: MC, con: 0, loc: 2, seq: 0, desc: SID(MC, 0) }] });
ok(T.handUsedReason(MC) === null, 'H11: MC死者蘇生 is name-limited, not OPT-limited -> handUsedReason stays silent (nameLimitReason owns it)');
ok(T.nameLimitReason(MC) === 'このカード名のカードは１ターンに１枚しか発動できません', 'H11b: ...and nameLimitReason does state it');
PC.reset();
ok(T.handUsedReason(GEN) === null && T.handUsedReason(CHAOSPOD) === null, 'H12: no hand candidate -> no used reason, ever');

// ---------- H13-H27: handTargetReason on synthetic states ----------
// state builder: hand = [codes], mzone/szone = sparse arrays of {code,pos} / {code}, grave = [codes]
const FU_ATK = 0x1, FU_DEF = 0x4, FD_ATK = 0x2, FD_DEF = 0x8;
function st(o) {
  const p = (x) => ({
    hand: (x.hand || []).map(c => ({ code: c })),
    mzone: (x.mzone || []).map(c => c ? { code: c.code, pos: c.pos } : null),
    szone: (x.szone || []).map(c => c ? { code: c } : null),
    grave: (x.grave || []).slice(),
    lp: x.lp != null ? x.lp : 8000,
    deckCount: x.deckCount != null ? x.deckCount : 40,
  });
  // pad zones to full length (engine state shape)
  const pad = (arr, n) => { while (arr.length < n) arr.push(null); return arr; };
  const a = p(o.me || {}), b = p(o.opp || {});
  pad(a.mzone, 7); pad(b.mzone, 7); pad(a.szone, 8); pad(b.szone, 8);
  return { turnCount: 1, phaseName: 'MAIN1', players: [a, b] };
}
T.setSeatDecks('ishizu', 'gg');
const LUCE = 45409943;
ok(T.handTargetReason(TAIYOU, st({})) === '対象になる裏側表示モンスターがいません', 'H13a: 太陽の書, no face-down monster anywhere -> reason');
ok(T.handTargetReason(TAIYOU, st({ opp: { mzone: [{ code: 82633039, pos: FD_DEF }] } })) === null, 'H13b: ...a face-down monster on the opponent field -> silent');
ok(T.handTargetReason(TAIYOU, st({ me: { mzone: [{ code: 82633039, pos: FD_ATK }] } })) === null, 'H13c: ...a face-down monster on the own field -> silent');
ok(T.handTargetReason(TSUKI, st({})) === '対象になる表側表示モンスターがいません', 'H14a: 月の書, no face-up monster -> reason');
ok(T.handTargetReason(TSUKI, st({ me: { mzone: [{ code: 82633039, pos: FU_ATK }] } })) === null, 'H14b: ...a face-up monster -> silent');
ok(T.handTargetReason(SILKY, st({ me: { mzone: [{ code: 82633039, pos: FU_ATK }] } })) === '両方のフィールドに表側表示モンスターがいません', 'H15a: シルキィ, face-up only on the own field -> both-fields reason');
ok(T.handTargetReason(SILKY, st({ me: { mzone: [{ code: 82633039, pos: FU_ATK }] }, opp: { mzone: [{ code: 82633039, pos: FU_DEF }] } })) === null, 'H15b: ...face-up on both fields -> silent');
ok(T.handTargetReason(SOSEI, st({})) === '自分か相手の墓地にモンスターがいません', 'H16a: 死者蘇生, both graves monster-less -> reason');
ok(T.handTargetReason(SOSEI, st({ opp: { grave: [LUCE] } })) === null, 'H16b: ...a monster in the opponent grave -> silent');
ok(T.handTargetReason(HANA, st({ me: { hand: [HANA, KELDO], grave: [LUCE] } })) === '自分の墓地に地属性モンスターがいません', 'H17a: 花, grave holds only a DARK monster -> attribute reason');
ok(T.handTargetReason(HANA, st({ me: { hand: [HANA, KELDO], grave: [KELBEK] } })) === null, 'H17b: ...an EARTH monster in the grave -> silent');
ok(T.handTargetReason(HANA, st({ me: { hand: [HANA], grave: [KELBEK] } })) === '手札に捨てるモンスターまたは「春化精」カードがありません', 'H18a: 花, hand holds only 花 -> no valid discard');
ok(T.handTargetReason(HANA, st({ me: { hand: [HANA, KELDO], grave: [KELBEK] } })) === null, 'H18b: ...another monster in hand -> silent');
ok(T.handTargetReason(KELDO, st({ me: { hand: [KELDO, TAIYOU] } })) === '手札に捨てる天使族・地属性モンスターがありません', 'H19a: ケルドウ, no other earth-angel in hand -> reason (a spell is not a valid discard)');
ok(T.handTargetReason(KELDO, st({ me: { hand: [KELDO, MUDORA] } })) === null, 'H19b: ...another earth-angel in hand -> silent');
ok(T.handTargetReason(ZORUA, st({})) === 'フィールドに天使族・地属性モンスターがいません', 'H20a: ゾルガ, empty field -> field-condition reason');
ok(T.handTargetReason(ZORUA, st({ me: { mzone: [{ code: KELDO, pos: FU_ATK }] } })) === null, 'H20b: ...an earth-angel on the field -> silent');
ok(T.handTargetReason(ZORUA, st({ me: { mzone: [{ code: LUCE, pos: FU_ATK }] } })) === 'フィールドに天使族・地属性モンスターがいません', 'H20c: ...a DARK fiend on the field does NOT satisfy the condition');
ok(T.handTargetReason(TENSEI, st({ me: { grave: [LUCE, LUCE] } })) === '墓地に融合素材が足りません（現在2体／必要3体）', 'H21a: 天至, 2 fiend/angel in grave, Luce needs 3 -> material reason with live counts');
ok(T.handTargetReason(TENSEI, st({ me: { grave: [LUCE, LUCE, LUCE] } })) === null, 'H21b: ...3 in grave -> silent');
ok(T.handTargetReason(TENSEI, st({ me: { grave: [] } })) === '墓地に融合素材が足りません（現在0体／必要3体）', 'H21c: ...empty grave -> 0-body count');
T.setSeatDecks(null, null);
ok(T.handTargetReason(TENSEI, st({ me: { grave: [] } })) === null, 'H21d: deck unknown (no seat key) -> silent, never a guessed fusion claim');
T.setSeatDecks('ishizu', 'gg');
ok(T.handTargetReason(MICHIZURE, st({ me: { hand: [MICHIZURE, KELDO] }, opp: { hand: [] } })) === '相手の手札がありません', 'H22a: 墓穴の道連れ, opponent hand empty -> reason');
ok(T.handTargetReason(MICHIZURE, st({ me: { hand: [MICHIZURE] }, opp: { hand: [KELDO] } })) === '自分の手札に捨てるカードがありません', 'H22b: ...own hand holds only the spell itself -> reason');
ok(T.handTargetReason(MICHIZURE, st({ me: { hand: [MICHIZURE, KELDO] }, opp: { hand: [KELDO] } })) === null, 'H22c: ...both hands hold a card -> silent');
ok(T.handTargetReason(FUKUSO, st({ me: { szone: [SOSEI, SOSEI, SOSEI, SOSEI, SOSEI] } })) === '魔法・罠ゾーンに空きがありません', 'H23a: おろかな副葬, S/T zones full -> reason');
ok(T.handTargetReason(FUKUSO, st({})) === null, 'H23b: ...zones free -> silent');
ok(T.handTargetReason(57554544, st({ me: { hand: [57554544, KELDO], szone: [null, null, null, null, null, SOSEI] } })) === 'フィールドゾーンに空きがありません', 'H24a: 炎王の孤島, field zone occupied -> reason (a field spell is placed from the hand)');
ok(T.handTargetReason(57554544, st({ me: { hand: [57554544, KELDO] } })) === null, 'H24b: ...field zone free -> silent');
ok(T.handTargetReason(GEN, st({})) === null, 'H25a: 現世 (no hand candidate) stays silent even with nothing derivable');
ok(T.handTargetReason(CHAOSPOD, st({})) === null, 'H25b: カオスポッド (no hand candidate) stays silent');
ok(T.handTargetReason(15079028, st({})) === null, 'H25c: 地久神－カルボン (field/grave effects only) stays silent');
ok(T.handTargetReason(KELDO, st({ me: { hand: [KELDO, MUDORA], mzone: [{ code: 82633039, pos: FU_ATK }, { code: 82633039, pos: FU_ATK }, { code: 82633039, pos: FU_ATK }, { code: 82633039, pos: FU_ATK }, { code: 82633039, pos: FU_ATK }] } })) === 'モンスターゾーンに空きがありません', 'H26: ケルドウ, monster zones full -> the self-summon cannot land');
ok(T.handTargetReason(SILKY, st({ me: { mzone: [{ code: 82633039, pos: FU_ATK }] }, opp: { mzone: [{ code: 82633039, pos: FU_ATK }] } })) === null, 'H27: シルキィ, zones free and both fields face-up -> silent');

// ---------- H28: LP-cost branch (fixture — no pool card carries an LP cost on a hand candidate) ----------
{
  const fixture = JSON.parse(JSON.stringify(data));
  fixture.texts[String(TSUKI)] = { name: '月の書', text: '①：１０００LPを払って発動できる。フィールドの表側表示モンスター１体を対象として発動できる。そのモンスターを裏側守備表示にする。' };
  T.setDATA(fixture);
  ok(T.handTargetReason(TSUKI, st({ me: { lp: 800, mzone: [{ code: 82633039, pos: FU_ATK }] } })) === 'LPが足りません', 'H28a: fixture 月の書 with LP 800 < 1000 -> LP reason');
  ok(T.handTargetReason(TSUKI, st({ me: { lp: 8000, mzone: [{ code: 82633039, pos: FU_ATK }] } })) === null, 'H28b: ...LP 8000 -> silent (target exists, cost payable)');
  T.setDATA(data);
}

// ---------- H29: sheet wiring ----------
// The sheet is built by openActionSheet; drive it with a stub
// actionMap holding only a set action (no activate) and check the
// grey row appears with the derived reason, and that it stays
// absent when nothing is derivable.
function sheetHTMLFor(code, acts, state) {
  T.setDuelState(state);
  T.setPrompt({ prompt: { name: 'SELECT_IDLECMD' } });
  T.setActionMap(new Map([['0:2:0', acts]]));
  T.openActionSheet('0:2:0');
  const html = els.sheet ? els.sheet.innerHTML : '';
  return html;
}
{
  const s1 = st({ me: { hand: [TAIYOU] } });
  const h1 = sheetHTMLFor(TAIYOU, [{ label: '魔法・罠をセット', bytes: [], code: TAIYOU, desc: 0, activate: false }], s1);
  ok(h1.includes('効果を発動') && h1.includes('対象になる裏側表示モンスターがいません'), 'H29a: sheet shows the grey row with the derived reason (太陽の書, no face-down target)');
  const s2 = st({ me: { hand: [OKA, KELDO] } });
  const h2 = sheetHTMLFor(OKA, [{ label: '魔法・罠をセット', bytes: [], code: OKA, desc: 0, activate: false }], s2);
  ok(!h2.includes('optbtn disabled'), 'H29b: sheet shows NO grey row when nothing is derivable (丘, zones free, discard in hand)');
  const s3 = st({ me: { hand: [HANA, KELDO], grave: [KELBEK] } });
  PC.reset();
  PC.trackUsedFx({ turnCount: 1, chain: [{ code: HANA, con: 0, loc: 2, seq: 0, desc: SID(HANA, 0) }] });
  const h3 = sheetHTMLFor(HANA, [{ label: 'モンスターをセット', bytes: [], code: HANA, desc: 0, activate: false }], s3);
  ok(h3.includes('このターン既に使用済みです'), 'H29c: sheet shows the OPT reason (花① used this turn)');
  PC.reset();
  const h4 = sheetHTMLFor(TAIYOU, [{ label: '効果を発動', bytes: [], code: TAIYOU, desc: 0, activate: true }], s1);
  ok(!h4.includes('optbtn disabled'), 'H29d: an offered activation shows no grey row');
}

// ---------- H30: a hand card with NO offered action at all ----------
// The tap used to go nowhere for these cards (no actionMap entry),
// so the reason was unreachable for exactly the cards that need it
// most (no summon, no set, no activation). The sheet now opens as
// an info view from the hand itself.
function sheetHTMLNoActs(code, state) {
  T.setDuelState(state);
  T.setPrompt({ prompt: { name: 'SELECT_IDLECMD' } });
  T.setActionMap(new Map()); // the engine offered NOTHING for this card
  if (els.sheet) els.sheet.innerHTML = ''; // openActionSheet returns early with no card: stale HTML must not leak in
  T.openActionSheet('0:2:0');
  return els.sheet ? els.sheet.innerHTML : '';
}
{
  const s1 = st({ me: { hand: [TAIYOU] } });
  const h1 = sheetHTMLNoActs(TAIYOU, s1);
  ok(h1.includes('太陽の書') && h1.includes('optbtn disabled') && h1.includes('対象になる裏側表示モンスターがいません'), 'H30a: no offered action, derivable reason -> sheet opens WITH the grey reason row');
  const s2 = st({ me: { hand: [OKA, KELDO] } });
  const h2 = sheetHTMLNoActs(OKA, s2);
  ok(h2.includes('丘と芽吹の春化精') && !h2.includes('optbtn disabled'), 'H30b: no offered action, nothing derivable -> sheet opens as an info view, no grey row');
  const s3 = st({ me: { hand: [] } });
  const h3 = sheetHTMLNoActs(TAIYOU, s3);
  ok(h3 === '', 'H30c: no card in the slot -> no sheet at all');
}

console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
