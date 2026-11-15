'use strict';
/* test-token-display.js — BU-102 regression pins (2026-11-15).
   Tokens (綿毛トークン 15341822/23, ドッペル・トークン
   53855410/11) are NOT pool cards: data.json carries only their
   names, deliberately no cards row, so the pool stays 362. The
   display layer resolves a card through cardData(), and the null
   row made tokens invisible to it — isMonster() false, no field
   ATK/DEF plate, no stats on the detail surfaces (resident
   preview / info pop / card-info sheet). The fix mirrors the
   engine's TOKEN_CARD_DATA (engine.js, babelcdb values) on the
   client and lets cardData() fall back to it; the two detail
   gates that read DATA.cards directly (setPreview / openInfoPop)
   now read cardData() instead.
   Contract pinned here:
   - the pool is untouched: 362 cards rows, no token code among
     them, token names present in data.names;
   - cardData(token) returns the babelcdb row — cross-checked
     field-by-field against the engine's own TOKEN_CARD_DATA
     parsed out of engine.js, so client and core cannot drift;
   - isMonster(token) is true, cardKind is 'normal', the marks
     chip and the meta/stats lines render exactly like a printed
     Normal monster's;
   - a face-up token's slotStatsHTML carries the ATK/DEF plate
     (Doppel 400/400, Fluff 0/0), defence form included, while
     the SZONE no-plate rule and the non-monster rule still hold;
   - setPreview / openInfoPop accept a token and the rendered
     detail carries its stats;
   - pool cards still resolve to their data.json row itself and
     unknown codes still resolve to null.
   Method: vm + stub DOM, the test-poolcov harness technique,
   against the REAL client.js / data.json / engine.js. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const V2 = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const engineSrc = fs.readFileSync(path.join(V2, 'engine.js'), 'utf8');

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
const Engine = require(path.join(V2, 'engine.js'));
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
sandbox.Engine = Engine; // client.js reads window.Engine at load
vm.createContext(sandbox);
const src = fs.readFileSync(path.join(V2, 'client.js'), 'utf8') +
  '\n;globalThis.__T = { setDATA: (d) => { DATA = d; }, cardData, isMonster, slotStatsHTML, cardMetaLine, statsLine, cardKind, marksChipHTML, setPreview, openInfoPop, previewState: () => previewState };';
vm.runInContext(src, sandbox, { filename: 'client.js' });
const T = sandbox.__T;
T.setDATA(data);

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

// ---------- pool integrity: tokens stay out of data.json cards ----------
const TOKENS = [15341822, 15341823, 53855410, 53855411];
ok(Object.keys(data.cards).length === 362, 'TD1: pool is still 362 card rows');
for (const c of TOKENS) ok(!(c in data.cards), 'TD1: no cards row for token ' + c);
ok(data.names[15341822] === '綿毛トークン' && data.names[15341823] === '綿毛トークン', 'TD1: Fluff Token names registered');
ok(data.names[53855410] === 'ドッペル・トークン' && data.names[53855411] === 'ドッペル・トークン', 'TD1: Doppel Token names registered');

// ---------- independent expectation: the engine's own rows ----------
const engRows = {};
for (const m of engineSrc.matchAll(/\{\s*code:\s*(\d+),\s*type:\s*(\d+),\s*level:\s*(\d+),\s*attribute:\s*(\d+),\s*race:\s*(\d+),\s*atk:\s*(\d+),\s*def:\s*(\d+)\s*\}/g)) {
  engRows[+m[1]] = { type: +m[2], level: +m[3], attribute: +m[4], race: +m[5], atk: +m[6], def: +m[7] };
}
for (const c of TOKENS) ok(!!engRows[c], 'TD2: engine TOKEN_CARD_DATA carries ' + c);

// ---------- cardData resolves every token to the engine's values ----------
for (const c of TOKENS) {
  const d = T.cardData(c), e = engRows[c];
  ok(!!d, 'TD3: cardData(' + c + ') resolves');
  if (!d || !e) continue;
  for (const f of ['type', 'level', 'attribute', 'race', 'atk', 'def']) {
    ok(d[f] === e[f], 'TD3: cardData(' + c + ').' + f + ' === engine ' + e[f]);
  }
  ok(d.code === c && d.alias === 0 && Array.isArray(d.setcodes), 'TD3: cardData(' + c + ') has the data.json row shape');
}

// ---------- monster classification + detail lines ----------
for (const c of TOKENS) {
  ok(!!T.isMonster(c), 'TD4: isMonster(' + c + ') is true');
  ok(T.cardKind(c) === 'normal', 'TD4: cardKind(' + c + ') is normal (TYPE_NORMAL|TYPE_TOKEN)');
}
ok(T.statsLine(53855410) === '攻400／守400', 'TD5: statsLine Doppel is 攻400／守400');
ok(T.statsLine(15341822) === '攻0／守0', 'TD5: statsLine Fluff is 攻0／守0');
const metaFluff = T.cardMetaLine(15341822, null);
ok(metaFluff.includes('風属性') && metaFluff.includes('植物族') && metaFluff.includes('レベル1'), 'TD5: meta line Fluff = 風属性／植物族／レベル1 (' + metaFluff + ')');
const metaDoppel = T.cardMetaLine(53855411, null);
ok(metaDoppel.includes('闇属性') && metaDoppel.includes('戦士族') && metaDoppel.includes('レベル1'), 'TD5: meta line Doppel = 闇属性／戦士族／レベル1 (' + metaDoppel + ')');
ok(T.marksChipHTML(15341822).includes('attr-wind') && T.marksChipHTML(15341822).includes('race-plant'), 'TD5: marks chip Fluff carries wind + plant icons');
ok(T.marksChipHTML(53855410).includes('attr-dark') && T.marksChipHTML(53855410).includes('race-warrior'), 'TD5: marks chip Doppel carries dark + warrior icons');

// ---------- the field ATK/DEF plate ----------
const FACEUP_ATK = 0x1, FACEUP_DEF = 0x4; // core position values (engine POS masks: FACEUP 0x5 / DEFENSE 0xC)
const plate = (code, pos, loc) => T.slotStatsHTML({ code, pos, curAtk: null, curDef: null }, 0, loc == null ? Engine.LOC.MZONE : loc);
const pd = plate(53855410, FACEUP_ATK);
ok(pd.includes('slotplate') && pd.includes('ATK <b>400</b>') && pd.includes('DEF <b>400</b>'), 'TD6: face-up Doppel token plate prints ATK 400 / DEF 400');
const pf = plate(15341823, FACEUP_ATK);
ok(pf.includes('slotplate') && pf.includes('ATK <b>0</b>') && pf.includes('DEF <b>0</b>'), 'TD6: face-up Fluff token plate prints ATK 0 / DEF 0');
ok(plate(53855411, FACEUP_DEF).includes('defmode'), 'TD6: defence-position token plate keeps the defmode form');
ok(plate(53855410, FACEUP_ATK, Engine.LOC.SZONE) === '', 'TD6: SZONE no-plate rule (J5) still applies to tokens');
ok(plate(53129443, FACEUP_ATK) === '', 'TD6: non-monster (ブラック・ホール) still gets no plate');

// ---------- detail surfaces accept a token ----------
T.setPreview(53855410, null);
const ps = T.previewState();
ok(!!ps && ps.code === 53855410, 'TD7: setPreview accepts the Doppel token');
ok(els.preview.innerHTML.includes('ATK 400') && els.preview.innerHTML.includes('DEF 400'), 'TD7: resident preview prints the token stats');
ok(els.preview.innerHTML.includes('ドッペル・トークン'), 'TD7: resident preview prints the token name');
T.openInfoPop(15341822, null);
ok(els.infopop.innerHTML.includes('綿毛トークン') && els.infopop.innerHTML.includes('攻0／守0'), 'TD7: info pop prints the Fluff token name + stats');
ok(els.infopop.innerHTML.includes('風属性') && els.infopop.innerHTML.includes('植物族'), 'TD7: info pop prints the Fluff token meta line');

// ---------- no regressions in the lookup itself ----------
ok(T.cardData(15341821) === data.cards[15341821], 'TD8: pool card (ダンディライオン) still resolves to its data.json row itself');
ok(T.cardData(99999999) === null, 'TD8: unknown code still resolves to null');
ok(T.isMonster(99999999) === null || T.isMonster(99999999) === false || !T.isMonster(99999999), 'TD8: unknown code is not a monster');

console.log(failures ? ('FAILURES: ' + failures) : 'ALL TOKEN-DISPLAY CHECKS PASSED');
process.exit(failures ? 1 : 0);
