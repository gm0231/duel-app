'use strict';
/* test-poolcov.js — pool-wide coverage gate for the clarity
   mechanisms (pool-coverage round, user direction 2026-11-03:
   coverage of the WHOLE pool is the premise, not per-incident
   patches; anything uncovered is enumerated here, with counts).
   Loads the REAL client.js (vm + stub DOM, same technique as
   test-fxidentify) against the REAL data.json / fxmap.json and
   asserts, for all 165 cards (63 -> 89 with the Super Quant deck,
   89 -> 144 with the Elfennotes / White Forest decks, 2026-11-08;
   144 -> 147 with the v12/v13 additions; 147 -> 165 with the
   Monarch deck, 2026-11-11):
     A. every fxmap target (map / pmap / yn / bare) names an
        existing printed segment of that card;
     B. every described activatable desc idx resolves (via
        resolveEffect or scopedEffect) or sits in EXCEPTIONS
        with a stated reason;
     C. every activatable script block WITHOUT a description is
        either the S/T activation convention, bare-covered, or
        enumerated as non-prompt machinery;
     D. the lingering-restriction scan over all card texts finds
        EXACTLY the enumerated set (a future pool card carrying
        a new restriction fails here until it is classified);
     E. the attribute-lock derivation equals the Vernusylph pair;
     F. behaviour spot-checks: yn follow-ups, pmap scopes, bare
        pinning, once-per-turn usage tracking, 死者蘇生 latch;
     G. (brushup round 2) card-name activation limits: the
        derivation equals the enumerated set, and the reason
        fires exactly while the limit is spent (turn scope
        expires; duel scope persists);
     H. (brushup round 2) grave-sent timing: derivation equals
        {巨神封じの矢: ②}; arrivals are stamped per turn and
        never across an identity-less observation;
     I. (brushup round 2) EX-summon type locks: derivation
        equals {トリロスークタ: ②/S}; the lock rises only on
        the restricting effect's own number and expires with
        the turn.
   It also PRINTS the per-card classification table (the audit;
   the same table lives in NOTES.md).                        */
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
sandbox.Engine = require(path.join(V2, 'engine.js')); // client.js reads window.Engine at load
vm.createContext(sandbox);
const src = fs.readFileSync(path.join(V2, 'client.js'), 'utf8') +
  '\n;globalThis.__T = { DATA: () => DATA, setDATA: (d) => { DATA = d; }, setFXMAP: (m) => { FXMAP = m; }, descEffect, effectSegments, resolveEffect, resolveYesNo, scopedEffect, entryEffect, foreignFollowFx, CIRCLED_NUM };';
vm.runInContext(src, sandbox, { filename: 'client.js' });
const T = sandbox.__T;
T.setDATA(data);
T.setFXMAP(fxmap);
const PC = sandbox.__poolcov;
const ML = sandbox.__mlock;
const SID = (code, idx) => code * 1048576 + idx;

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

// ---------- independent re-derivation (mirrors gen-fxmap) ----------
function describedBlocks(code) {
  const s = data.scripts['c' + code + '.lua'];
  if (!s) return null;
  const out = new Set();
  const starts = [...s.matchAll(/Effect\.CreateEffect/g)].map(m => m.index);
  starts.forEach((st, i) => {
    const b = s.slice(st, i + 1 < starts.length ? starts[i + 1] : s.length);
    const sid = b.match(/SetDescription\(\s*aux\.Stringid\(id,(\d+)\)/);
    if (!sid) return;
    if (!/(SetTarget\(|SetOperation\(|SetCost\()/.test(b)) return;
    out.add(+sid[1]);
  });
  for (const m of s.matchAll(/Vernusylph\.AddSpSummonEffect\(\s*c\s*,\s*id\s*,\s*(\d+)/g)) out.add(+m[1]);
  for (const m of s.matchAll(/local\s+(\w+)\s*=\s*Fusion\.CreateSummonEff/g)) {
    const re = new RegExp(m[1] + ':SetDescription\\(\\s*aux\\.Stringid\\(id,(\\d+)\\)');
    const sid = s.match(re);
    if (sid) out.add(+sid[1]);
  }
  // Clone-registered descriptions (mirror of gen-fxmap.js).
  for (const m of s.matchAll(/local\s+(\w+)\s*=\s*\w+\s*:\s*Clone\(\)/g)) {
    const re = new RegExp(m[1] + '\\s*:\\s*SetDescription\\(\\s*aux\\.Stringid\\(id,(\\d+)\\)');
    const sid = s.match(re);
    if (sid) out.add(+sid[1]);
  }
  return out;
}
function undescribedActivatable(code) {
  const s = data.scripts['c' + code + '.lua'];
  if (!s) return [];
  const out = [];
  const starts = [...s.matchAll(/Effect\.CreateEffect/g)].map(m => m.index);
  starts.forEach((st, i) => {
    const b = s.slice(st, i + 1 < starts.length ? starts[i + 1] : s.length);
    const hasDesc = /SetDescription\(\s*aux\.Stringid\(id,/.test(b);
    const hasOp = /(SetTarget\(|SetOperation\(|SetCost\()/.test(b);
    if (!hasOp || hasDesc) return;
    const typ = (b.match(/SetType\((EFFECT_TYPE_[A-Z_]+)\)/) || [])[1] || '-';
    const rng = (b.match(/SetRange\((LOCATION_[A-Z_]+)\)/) || [])[1] || '-';
    const ev = (b.match(/SetCode\((EVENT_[A-Z_0-9]+)\)/) || [])[1] || '-';
    out.push({ typ, rng, ev });
  });
  return out;
}

// ---------- B: exceptions (described idx knowingly unresolvable) ----------
const EXCEPTIONS = {
  // summon procedure description — never an activation prompt;
  // printed ①② are continuous (battle indestructible / immunity)
  '26746975|0': '特殊召喚手続きの説明。発動プロンプトにはならない',
  // SINGLE name-substitute continuous inside ①'s own text
  '45223540|1': '①本文内の同名扱い持続効果。プロンプトにならない',
  // EX-summon restriction FIELD effect — part of ②'s own text
  '21368273|2': '②本文のEX召喚制限（持続）。発動エントリにならない',
  // old-style texts carry NO circled numbers at all — there is
  // no printed number to resolve to (full text is shown)
  '2694423|0': '公式テキストに効果番号が存在しない（旧書式）',
  '2694423|1': '公式テキストに効果番号が存在しない（旧書式）',
  '79106360|0': '公式テキストに効果番号が存在しない（リバース書式）',
  '16135253|0': '公式テキストに効果番号が存在しない（旧書式）',
  // env-decks round (2026-11-08): described indices that name
  // restriction hints / procedures, never activation prompts
  '17749468|0': '特殊召喚手続きの説明。発動プロンプトにはならない',
  '4398189|3': '①の闇属性EXロック（CLIENT_HINT付き持続制限）の説明。プロンプトにならない',
  '42302563|2': '②のSモンスター限定ロック（CLIENT_HINT付き持続制限）の説明。プロンプトにならない',
  '82956214|1': '①のEX召喚ロック（CLIENT_HINT付き持続制限）の説明。プロンプトにならない',
  // Monarch round (2026-11-11): described indices that name the
  // EX-summon locks the card's own effects register on resolution
  '59463312|4': '②本文のEX特殊召喚ロック（解決時に登録される持続制限）の説明。プロンプトにならない',
  '67584223|3': '③本文のEX特殊召喚ロック（解決時に登録される持続制限）の説明。プロンプトにならない',
  '9283801|3': '①本文のEX特殊召喚ロック（解決後に登録される持続制限）の説明。プロンプトにならない',
  '95457011|2': '①本文のEX特殊召喚ロック（CLIENT_HINT付き持続制限）の説明。プロンプトにならない',
};
// ---------- C: undescribed blocks knowingly not prompt-bearing ----------
const NON_PROMPT = {
  '12923641': '自己破壊トリガー（強制処理、選択エントリにならない）＋発動/持続',
  '14108995': '①持続（タイプ扱い）。発動はS/T発動の慣例で表示',
  '26746975': '特殊召喚成功時の登録処理（②免疫の付与）。発動ではない',
  '35026117': '召喚成功時の登録処理（②攻撃制限の付与）。発動ではない',
  '45409943': '①持続（破壊耐性）。発動エントリにならない',
  '62133026': '②持続（対象耐性）。①はヘルパー経由で記述あり',
  '9350312': '②持続（春化精モンスターの効果破壊耐性）。①はヘルパー経由で記述あり',
  '86605515': '②の適用効果（罠の破壊耐性フィールド）。発動ではない',
  '98715423': '①のロック機構（ドローイベント処理）。発動ではない',
  '34771947': 'フィールド魔法の持続処理。発動ではない',
  // Super Quant round (2026-11-08): FIELD continuous effects that
  // carry a SetTarget function but are never activations
  '1825445': '②持続（「超量」カードへの対象耐性）。発動エントリにならない',
  '75493362': '②持続（妖精族の攻撃力アップ）。発動エントリにならない',
  '84025439': '②の段階適用（素材6種類時のサーチ／ドローロック持続）。発動エントリにならない。①と②の発動側はOVERRIDESで番号特定済み',
  // env-decks round (2026-11-08): continuous / machinery blocks of
  // the Elfennotes / White Forest additions, hand-audited
  '821049': '③の解決で登録されるSモンスターへの攻撃力アップ持続。発動ではない',
  '4398189': '②持続（「白き森」モンスターの戦闘破壊耐性）。発動エントリにならない',
  '12375297': '①持続（Sモンスター以外のEX特殊召喚ロック）。発動エントリにならない',
  '17749468': '②の適用機構（チェーン登録＋攻撃力ダウン処理）。発動ではない',
  '41373230': '融合召喚成功時の登録処理（②耐性の付与）。発動ではない',
  '41924516': '②持続（自軍Sモンスターの攻撃力アップ＋貫通付与）。発動エントリにならない',
  '50954680': '②は強制トリガー（ダメージ計算時の攻撃力アップ、自動でチェーンに乗る）。選択プロンプトにならない',
  '51522296': '①持続（「ドラグマ」モンスターへの効果耐性）。発動エントリにならない',
  '53971455': '墓地へ送られた時の登録処理（②エンドフェイズ発動の予約）。発動ではない',
  '60303688': '②のEX召喚ロック機構（発動後の持続制限）。発動ではない',
  '62849088': '特殊召喚の記録処理（②の分岐条件の集計）。発動ではない',
  '64491754': '①持続（中央ゾーンのモンスターの効果破壊耐性）。発動エントリにならない',
  '77313225': '②持続（自軍Sモンスターの攻撃力アップ＋効果破壊耐性）。発動エントリにならない',
  '82044279': '③の適用処理（破壊時の攻撃力アップ、持続）。発動ではない',
  '85065943': '①持続（対象耐性）＋融合召喚成功時のフラグ登録処理。発動ではない',
  // Monarch round (2026-11-11): continuous / machinery blocks of
  // the Monarch additions, hand-audited
  '61466310': '①持続（EXデッキからの特殊召喚ロック）。発動エントリにならない',
  '79844764': '①の適用機構（発動ターンEX特殊召喚ロックの登録処理）。発動ではない',
};

// ---------- A + B + classification table ----------
const clsCount = { '番号特定': 0, '番号特定（スコープ/yn/bare）': 0, '単一効果/発動慣例': 0, '番号対象なし': 0, '未カバー': 0 };
console.log('---- pool classification (165) ----');
for (const code of Object.keys(data.cards)) {
  const fx = fxmap[code];
  const segs = T.effectSegments(+code);
  const desc = describedBlocks(code) || new Set();
  let cls;
  if (fx && (fx.id || fx.map)) cls = '番号特定';
  else if (fx && (fx.pmap || fx.yn || fx.bare)) cls = '番号特定（スコープ/yn/bare）';
  else if (segs.length <= 1) cls = '単一効果/発動慣例';
  else cls = '番号対象なし';
  // A: fxmap targets exist
  if (fx) {
    const segNs = new Set(segs.map(s => s.n));
    const targets = [];
    if (fx.map) for (const k of Object.keys(fx.map)) targets.push(fx.map[k]);
    if (fx.pmap) for (const k of Object.keys(fx.pmap)) targets.push(fx.pmap[k].idle, fx.pmap[k].chain);
    if (fx.yn) for (const k of Object.keys(fx.yn)) targets.push(fx.yn[k]);
    if (fx.bare) for (const b of fx.bare) targets.push(b.n);
    ok(targets.every(n => segNs.has(n)), 'A ' + code + ' ' + data.names[code] + ': fxmap targets all name existing segments');
  }
  // B: every described idx resolves or is an exception
  for (const idx of desc) {
    const r = T.resolveEffect(+code, SID(+code, idx)) ||
      T.scopedEffect(+code, SID(+code, idx), 4, 'idle') || T.scopedEffect(+code, SID(+code, idx), 4, 'chain') ||
      T.scopedEffect(+code, SID(+code, idx), 16, 'idle') || T.scopedEffect(+code, SID(+code, idx), 16, 'chain');
    if (!r && !EXCEPTIONS[code + '|' + idx]) {
      ok(false, 'B ' + code + ' ' + data.names[code] + ': described idx ' + idx + ' neither resolves nor is an enumerated exception');
      cls = '未カバー';
    }
  }
  // C: undescribed activatable blocks are classified
  const und = undescribedActivatable(code);
  const bareCovers = (u) => {
    if (!fx || !fx.bare) return false;
    const locBit = { LOCATION_HAND: 2, LOCATION_MZONE: 4, LOCATION_SZONE: 8, LOCATION_GRAVE: 16 }[u.rng];
    // event triggers may carry no SetRange (Minerva ②): the
    // bare table's chain-scope entry is what covers them
    return fx.bare.some(b => b.loc === locBit || (u.ev !== '-' && b.scope === 'chain'));
  };
  for (const u of und) {
    const isActivation = u.typ === 'EFFECT_TYPE_ACTIVATE';
    if (isActivation || bareCovers(u) || NON_PROMPT[code]) continue;
    ok(false, 'C ' + code + ' ' + data.names[code] + ': undescribed activatable block ' + JSON.stringify(u) + ' is unclassified');
    cls = '未カバー';
  }
  clsCount[cls] = (clsCount[cls] || 0) + 1;
  console.log(code + ' | ' + data.names[code] + ' | segs=' + segs.length + ' | desc=' + [...desc].join(',') + ' | ' + cls);
}
console.log('classification counts:', JSON.stringify(clsCount));
ok(Object.keys(data.cards).length === 165, 'pool is 165 cards');
ok(clsCount['未カバー'] === 0, 'no card is left unclassified/uncovered without an enumerated reason');

// ---------- D: lingering-restriction scan ----------
const RESTRICTION_PATTERNS = [
  { re: /このターン、自分は([地水炎風光闇神])属性以外のモンスターの効果を発動できない/, kind: '属性ロック（モンスター効果）', handling: 'ラッチ＋理由表示（対象：場のモンスター）' },
  { re: /このターン、自分はSモンスターしかEXデッキから特殊召喚できない/, kind: 'EX召喚種別制限', handling: '使用記録＋理由表示（対象：EXデッキシートの各行 — brushup round 2、検証は I）' },
  { re: /この効果で特殊召喚したモンスターは攻撃できず、その効果は発動できない/, kind: '蘇生モンスターへの制約', handling: 'ラッチ＋理由表示（対象：そのモンスターのシート）' },
  { re: /このターンそのモンスターは攻撃できない/, kind: '攻撃制限（相手モンスター）', handling: '対象外（攻撃の可否 — 発動シートの対象ではない）' },
  { re: /このターン、相手モンスターは直接攻撃できない/, kind: '攻撃制限（相手全体）', handling: '対象外（攻撃の可否）' },
  { re: /このカードが墓地へ送られたターンには発動できない/, kind: '墓地発動のタイミング制限', handling: '到着ターン記録＋理由表示（対象：墓地シートの行 — brushup round 2、検証は H）' },
  { re: /このカード名のカードはデュエル中に１枚しか発動できない/, kind: 'カード名発動制限（デュエル中1枚）', handling: '使用記録＋理由表示（対象：手札シート／プレビューの理由行 — brushup round 2、検証は G）' },
  { re: /このカード名のカードは１ターンに１枚しか発動できない/, kind: 'カード名発動制限（1ターン1枚）', handling: '使用記録＋理由表示（対象：手札シート／プレビューの理由行 — brushup round 2、検証は G）' },
];
const found = [];
for (const code of Object.keys(data.texts)) {
  const t = data.texts[code].text || '';
  for (const p of RESTRICTION_PATTERNS) if (p.re.test(t)) found.push(code + ':' + p.kind);
}
const EXPECTED_RESTRICTIONS = [
  '36745317:属性ロック（モンスター効果）', '62133026:属性ロック（モンスター効果）',
  '9350312:属性ロック（モンスター効果）',
  '21368273:EX召喚種別制限',
  '36898537:攻撃制限（相手モンスター）', '78625592:攻撃制限（相手全体）',
  '67037924:墓地発動のタイミング制限',
  '17484499:カード名発動制限（デュエル中1枚）',
  '35726888:カード名発動制限（1ターン1枚）', '45725480:カード名発動制限（1ターン1枚）',
  // env-decks round (2026-11-08): ストリチア ② carries the same
  // S-only EX lock clause; the four Dogmatika S/T carry the
  // 1-turn name limit. (《白き森の魔女》's limit is phrased
  // 「発動できず」 and is NOT matched by the derivation pattern —
  // enumerated as a gap in NOTES.md, not here.)
  '42302563:EX召喚種別制限', '64491754:EX召喚種別制限',
  '31002402:カード名発動制限（1ターン1枚）', '35569555:カード名発動制限（1ターン1枚）',
  '60921537:カード名発動制限（1ターン1枚）', '82956214:カード名発動制限（1ターン1枚）',
  // v13 (2026-11-10): the Magic Card "Monster Reborn" returns to
  // the pool — it carries both the revive-rider restriction and a
  // 1-turn card-name activation limit.
  '28958464:蘇生モンスターへの制約', '28958464:カード名発動制限（1ターン1枚）',
  // Monarch round (2026-11-11): 《帝王の深怨》 carries the 1-turn
  // card-name activation limit. (《帝王の烈旋》's limit is phrased
  // 「発動できず」 and is NOT matched by the derivation pattern —
  // the same enumerated gap as 《白き森の魔女》, see NOTES.md.)
  '33609262:カード名発動制限（1ターン1枚）',
];
ok(JSON.stringify([...found].sort()) === JSON.stringify([...EXPECTED_RESTRICTIONS].sort()),
  'D: restriction scan finds exactly the enumerated set (found: ' + found.join(' / ') + ')');

// ---------- E: attribute-lock derivation ----------
const lockSet = ML.cards().map(c => c.code).sort((a, b) => a - b);
ok(JSON.stringify(lockSet) === JSON.stringify([9350312, 36745317, 62133026]),
  'E: lock derivation = {丘と芽吹の春化精, 森と目覚の春化精, 花と野原の春化精} (' + lockSet.join(',') + ')');

// ---------- F: behaviour spot-checks ----------
// yn follow-ups
ok(T.resolveYesNo(30100551, SID(30100551, 0)).n === 2, 'F1: Minerva YESNO idx0 = follow-up of ②');
ok(T.resolveYesNo(35026117, SID(35026117, 2)).n === 3, 'F2: Heavy Tank YESNO idx2 = follow-up of ③');
ok(T.resolveEffect(9350312, SID(9350312, 0)).n === 1, 'F3: Hills idx0 = printed ① (hand ignition via the Vernusylph helper)');
ok(T.resolveEffect(9350312, SID(9350312, 1)).follow === true, 'F4: Hills idx1 (the shared string-base yes/no, asked by Hills itself) = count-rule follow-up of ①');
// pmap scopes
ok(T.scopedEffect(63101468, SID(63101468, 0), 4, 'idle').n === 1 && T.scopedEffect(63101468, SID(63101468, 0), 4, 'chain').n === 2,
  'F5: Hyperion idx0 = ① idle / ② chain');
// bare pinning
ok(T.entryEffect({ code: 30100551, desc: 0, loc: 4 }, 'idle').n === 1, 'F6: Minerva desc-less MZONE idle entry = ①');
ok(T.entryEffect({ code: 30100551, desc: 0, loc: 16 }, 'chain').n === 2, 'F7: Minerva desc-less GRAVE chain entry = ②');
ok(T.scopedEffect(30100551, 221, 16, 'chain').n === 2 && T.entryEffect({ code: 30100551, desc: 221, loc: 16 }, 'chain').n === 2,
  'F7b: Minerva\'s REAL EFFECTYN shape (desc=221, a non-Stringid value captured from the core in cap-minerva2.js) still pins ② via the bare table');
ok(T.entryEffect({ code: 37706769, desc: 0, loc: 16 }, 'idle').n === 2, 'F8: Pluto desc-less GRAVE idle entry = ②');
ok(T.entryEffect({ code: 31525442, desc: 0, loc: 2 }, 'idle').n === 1 && T.entryEffect({ code: 31525442, desc: 0, loc: 16 }, 'chain').n === 2,
  'F9: Zorga desc-less entries = ① (hand/idle) and ② (grave/chain)');
// foreign follow-up (Vernusylph helper string table)
const vernCtx = { code: 36745317, desc: SID(36745317, 1), loc: 2 };
ok(!!T.foreignFollowFx(vernCtx, { desc: SID(9350312, 1) }), 'F10: Vernusylph follow-up (foreign desc 9350312) recognised via the resolving link');
ok(T.foreignFollowFx(vernCtx, { desc: SID(36745317, 0) }) === null, 'F11: a decodable own desc is NOT forced into the follow-up form');
ok(T.foreignFollowFx({ code: 9350312, desc: SID(9350312, 0), loc: 2 }, { desc: SID(9350312, 1) }) === null,
  'F11b: Hills resolving itself — its own string-base desc is NOT foreign (the base card joined the pool in v11; F10 guards the other side)');
// OPT parsing + candidates
ok(JSON.stringify([...PC.optCovered(82633039)].sort()) === '[1,2]', 'F12: Castel OPT clause covers ①②');
ok(JSON.stringify([...PC.optCovered(37706769)]) === '[2]', 'F13: Pluto OPT clause covers ② only');
ok(JSON.stringify(PC.fieldCandidates(82633039)) === '[1,2]', 'F14: Castel field candidates = ①②');
ok(JSON.stringify(PC.fieldCandidates(30100551)) === '[1]', 'F15: Minerva field candidates = ① (② is trigger-phrased)');
ok(JSON.stringify(PC.fieldCandidates(31525442)) === '[]', 'F16: Zorga has no field candidate (hand ignition + grave trigger)');
// usage tracking -> OPT reason
PC.reset();
ok(PC.optCoverage(82633039).shared === true, 'F17a: Castel clause is SHARED (いずれか１つしか使用できない)');
ok(PC.optCoverage(98715423).shared === false, 'F17b: Gravekeeper\'s Trap clause is PER-EFFECT (それぞれ)');
PC.trackUsedFx({ turnCount: 1, chain: [{ code: 82633039, con: 0, loc: 4, seq: 0, desc: SID(82633039, 0) }] });
ok(PC.optUsedReason(82633039) === 'このターン既に使用済みです', 'F17: Castel after ① only -> OPT reason STATED (shared clause is spent by either effect)');
PC.trackUsedFx({ turnCount: 2, chain: [] });
ok(PC.optUsedReason(82633039) === null, 'F19: usage record expires with the turn');
PC.reset();
ok(JSON.stringify(PC.fieldCandidates(98715423)) === '[2]', 'F18a: Gravekeeper\'s Trap field candidates = ② only (③ is a draw-phase trigger: 発動する)');
ok(JSON.stringify(PC.fieldCandidates(63101468)) === '[1]', 'F18b: Hyperion field candidates = ① only (② is a response-only quick effect, never a sheet activation)');
PC.trackUsedFx({ turnCount: 1, chain: [{ code: 63101468, con: 0, loc: 4, seq: 0, desc: SID(63101468, 0) }] });
ok(JSON.stringify(PC.usedFx().find(u => u.code === 63101468).n) === '[1]' && PC.optUsedReason(63101468) === 'このターン既に使用済みです',
  'F18c: Hyperion chain-opening link attributes to ① (pmap idle) and the OPT reason fires (sole field candidate spent)');
PC.reset();
PC.trackUsedFx({ turnCount: 1, chain: [{ code: 99937011, con: 1, loc: 2, seq: 0, desc: SID(99937011, 0) }, { code: 63101468, con: 0, loc: 4, seq: 0, desc: SID(63101468, 0) }] });
ok(JSON.stringify(PC.usedFx().find(u => u.code === 63101468).n) === '[2]' && PC.optUsedReason(63101468) === null,
  'F18d: Hyperion responding link attributes to ② (pmap chain); OPT reason stays silent (① unspent)');
// 死者蘇生 latch — the rider card left the pool in the v11 recipe
// swap (the classic 《死者蘇生》 carries no rider) and returned in
// v13; the latch is exercised against a fixture DATA whose texts
// carry the rider under the code; the mechanism derives the code
// from the text, exactly as in production. Real DATA returns after
// F25 (with v13 the fixture text is identical to the real one).
const fixtureData = JSON.parse(JSON.stringify(data));
fixtureData.names['28958464'] = 'マジックカード「死者蘇生」';
fixtureData.texts['28958464'] = { name: 'マジックカード「死者蘇生」', text: 'このカード名のカードは１ターンに１枚しか発動できない。\n①：自分か相手の墓地のモンスター１体を対象として発動できる。そのモンスターを自分フィールドに特殊召喚する。このターン、この効果で特殊召喚したモンスターは攻撃できず、その効果は発動できない。' };
T.setDATA(fixtureData);
PC.reset();
const fakeState = { turnCount: 3, players: [{ mzone: [null, { code: 82633039 }, null, null, null] }, { mzone: [] }] };
PC.noteRevive([{ kind: 'activate', code: 28958464, con: 0 }, { kind: 'spsummon', code: 82633039, con: 0 }], fakeState);
ok(PC.revivedReason(82633039, 4, 1, 3) === '《マジックカード「死者蘇生」》の効果で特殊召喚されたため、このターンは効果を発動できません',
  'F20: revived Castel gets the named 死者蘇生 reason');
ok(PC.revivedReason(82633039, 4, 1, 4) === null && PC.revivedReason(82633039, 4, 2, 3) === null,
  'F21: revive reason is bound to the turn and the zone');
PC.reset();
PC.noteRevive([{ kind: 'activate', code: 28958464, con: 0 }, { kind: 'spsummon', code: 82633039, con: 0 }, { kind: 'spsummon', code: 99937011, con: 0 }], fakeState);
ok(PC.revivedReason(82633039, 4, 1, 3) === null, 'F22: ambiguous batch (two own special summons) latches NOTHING');
// cross-batch arming (production shape: activation and summon
// arrive in DIFFERENT event batches — chain windows intervene)
PC.reset();
const stChain = { turnCount: 3, chain: [{}], players: fakeState.players };
PC.noteRevive([{ kind: 'activate', code: 28958464, con: 0 }], stChain);
ok(PC.revivedReason(82633039, 4, 1, 3) === null, 'F23a: activation alone does not latch yet');
PC.noteRevive([{ kind: 'spsummon', code: 82633039, con: 0 }], { turnCount: 3, chain: [], players: fakeState.players });
ok(PC.revivedReason(82633039, 4, 1, 3) === '《マジックカード「死者蘇生」》の効果で特殊召喚されたため、このターンは効果を発動できません',
  'F23b: the next own special summon while armed latches across batches');
PC.reset();
PC.noteRevive([{ kind: 'activate', code: 28958464, con: 0 }], stChain);
PC.noteRevive([], { turnCount: 3, chain: [], players: fakeState.players });
PC.noteRevive([{ kind: 'spsummon', code: 82633039, con: 0 }], { turnCount: 3, chain: [], players: fakeState.players });
ok(PC.revivedReason(82633039, 4, 1, 3) === null, 'F24: negated Reborn (chain closed summon-less) disarms — a later summon is NOT attributed');
PC.reset();
PC.noteRevive([{ kind: 'activate', code: 28958464, con: 0 }], stChain);
PC.noteRevive([{ kind: 'activate', code: 99937011, con: 0 }], stChain);
PC.noteRevive([{ kind: 'spsummon', code: 82633039, con: 0 }], { turnCount: 3, chain: [], players: fakeState.players });
ok(PC.revivedReason(82633039, 4, 1, 3) === null, 'F25: an intervening own activation disarms (conservative miss, never a false claim)');
T.setDATA(data); // restore the real pool for the sections below

// ---------- G: card-name activation limits (brushup round 2) ----------
ok(JSON.stringify(PC.nameLimitCards().map(x => x.code + ':' + x.scope).sort()) === JSON.stringify([
  '17484499:duel', '28958464:turn', '31002402:turn', '33609262:turn', '35569555:turn', '35726888:turn', '45725480:turn', '60921537:turn', '82956214:turn',
]), 'G1: card-name limit derivation = {現世と冥界の逆転:duel, マジックカード「死者蘇生」/おろかな副葬/七星の宝刀/帝王の深怨/凶導の福音/凶導の聖告/凶導の葬列/ドラグマ・パニッシュメント:turn} (the Magic Card returns to the pool in v13; the classic has no name limit; 帝王の深怨 joins with the Monarch deck, 2026-11-11)');
PC.reset();
ok(PC.nameLimitReason(35726888) === null, 'G2: おろかな副葬 unspent -> silent');
PC.trackUsedFx({ turnCount: 1, chain: [{ code: 35726888, con: 0, loc: 2, seq: 0, desc: SID(35726888, 0) }] });
ok(PC.nameLimitReason(35726888) === 'このカード名のカードは１ターンに１枚しか発動できません',
  'G3: after activating おろかな副葬, its name limit states the reason');
PC.trackUsedFx({ turnCount: 2, chain: [] });
ok(PC.nameLimitReason(35726888) === null, 'G4: the turn-scope limit expires with the turn');
PC.reset();
PC.trackUsedFx({ turnCount: 1, chain: [{ code: 17484499, con: 0, loc: 2, seq: 0, desc: SID(17484499, 0) }] });
PC.trackUsedFx({ turnCount: 7, chain: [] });
ok(PC.nameLimitReason(17484499) === 'このカード名のカードはデュエル中に１枚しか発動できません',
  'G5: the duel-scope limit persists across turns');
ok(PC.nameLimitReason(35726888) === null, 'G6: an unspent limit of the same family stays silent');
ok(PC.nameLimitReason(82633039) === null, 'G7: a card with no card-name activation limit stays silent');

// ---------- H: grave-sent timing (brushup round 2) ----------
ok(JSON.stringify(PC.graveSentCards()) === JSON.stringify([{ code: 67037924, n: 2 }]),
  'H1: grave-sent derivation = {巨神封じの矢: ②}');
PC.reset();
const gsState = (grave, turnCount) => ({ turnCount, players: [{ grave }, { grave: [] }] });
PC.trackGraveArrivals(gsState([], 3));
ok(PC.graveSentReason(67037924, 3) === null, 'H2: not in the grave -> silent');
PC.trackGraveArrivals(gsState([67037924], 3));
ok(PC.graveSentReason(67037924, 3) === 'このターンに墓地へ送られたため、②の効果は発動できません',
  'H3: on its arrival turn the grave sheet states the reason');
ok(PC.graveSentReason(67037924, 4) === null, 'H4: the reason is bound to the arrival turn');
PC.trackGraveArrivals(gsState([67037924, 67037924], 5));
ok(PC.graveSentReason(67037924, 5) !== null, 'H5: a second copy arriving later re-arms the note on ITS arrival turn');
ok(PC.graveSentReason(67037924, 3) !== null, 'H5b: the first copy\'s stamp also survives while it remains in the grave');
PC.reset();
PC.trackGraveArrivals(gsState([null], 3));
PC.trackGraveArrivals(gsState([67037924], 3));
ok(PC.graveSentReason(67037924, 3) === null && PC.graveStamps().length === 0,
  'H6: an identity-less observation in between stamps NOTHING (the deck/grave swap window)');
PC.reset();
PC.trackGraveArrivals(gsState([], 3));
PC.trackGraveArrivals(gsState([67037924], 3));
ok(PC.graveStamps().length === 1, 'H7a: the arrival is stamped');
PC.trackGraveArrivals(gsState([], 3));
ok(PC.graveSentReason(67037924, 3) === null && PC.graveStamps().length === 0,
  'H7: a stamp dies when its copy leaves the grave');
PC.reset();
PC.trackGraveArrivals(gsState([67037924], 1));
PC.trackGraveArrivals(gsState([67037924, 67037924], 3));
ok(PC.graveSentReason(67037924, 3) !== null, 'H8 setup: a second copy arriving on turn 3 is claimable');
PC.trackGraveArrivals(gsState([67037924], 3));
ok(PC.graveSentReason(67037924, 3) === null,
  'H8: one copy leaving makes the record ambiguous — stamps drop (silence over a guess)');

// ---------- I: EX-summon type locks (brushup round 2) ----------
ok(JSON.stringify(PC.exLockCards()) === JSON.stringify([{ code: 21368273, n: 2, typeBit: 0x2000, token: 'Sモンスター' }, { code: 42302563, n: 2, typeBit: 0x2000, token: 'Sモンスター' }, { code: 64491754, n: 2, typeBit: 0x2000, token: 'Sモンスター' }]),
  'I1: EX-lock derivation = {マナドゥム・トリロスークタ: ②, 獄花の大燿聖ストリチア: ②, エルフェンノーツ～廻郷のパラレリズム～: ② — Synchro only}');
PC.reset();
ok(PC.exSummonLock() === null, 'I2: no lock before the restricting effect is used');
PC.trackUsedFx({ turnCount: 1, chain: [{ code: 21368273, con: 0, loc: 4, seq: 0, desc: SID(21368273, 0) }] });
ok(PC.exSummonLock() === null, 'I3: using ① does NOT raise the lock (the clause lives in ②)');
PC.trackUsedFx({ turnCount: 1, chain: [{ code: 21368273, con: 0, loc: 4, seq: 0, desc: SID(21368273, 1) }] });
const exLk = PC.exSummonLock();
ok(!!exLk && exLk.typeBit === 0x2000 && exLk.code === 21368273, 'I4: using ② raises the Synchro-only lock');
ok(PC.exLockReason(exLk) === '《マナドゥム・トリロスークタ》②の効果の制約で、このターンはSモンスターしかEXデッキから特殊召喚できません',
  'I5: the lock reason names the source card and effect');
PC.trackUsedFx({ turnCount: 2, chain: [] });
ok(PC.exSummonLock() === null, 'I6: the lock expires with the turn');
PC.reset();

console.log(failures ? failures + ' CHECK(S) FAILED' : 'ALL POOLCOV CHECKS PASSED');
process.exit(failures ? 1 : 0);
