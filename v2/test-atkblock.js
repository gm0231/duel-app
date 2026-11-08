'use strict';
/* test-atkblock.js — cannot-attack reasons (attack-block round,
   2026-11-04). The cannot-activate mechanisms had a twin silence:
   a monster whose attack SELECT_BATTLECMD does not offer got no
   row at all, so a correct ruling (Baromett Xyz-summoned under
   the opponent's 《ラビリンス・ウォール・シャドウ》) read as a
   bug. Loads the REAL client.js (vm + stub DOM, same technique
   as test-poolcov) against the REAL data.json and asserts:
     A. derivations equal the enumerated sets — the FIELD
        summon-turn block is exactly {ラビリンス・ウォール・
        シャドウ: 元々のレベル5以上を除く}, the SELF block is
        exactly {迷宮の重魔戦車};
     B. the pool-wide audit: exactly 4 cards carry an attack-
        barring clause; the other two are enumerated UNCOVERED
        with their reachability evidence (Horus's Pendulum-
        material rider — the pool holds zero Pendulum monsters;
        光の護封霊剣② — it sits only in the human's deck, so the
        blocked side is always the CPU, never this UI);
     C. the revive-rider derivation set is empty today (the
        rider's attack half rides the monsterRevived latch and
        arms only for a future pool card carrying the clause);
     D. behaviour: the reported Baromett case states the named
        reason, and every neighbouring case stays silent —
        no source on the field, next turn, the Level exception,
        defense position, a special-summoned self-block card, a
        flip by effect (not a flip summon), an ambiguous flip
        summon, an identity-less previous occupant.            */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const V2 = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));

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
  '\n;globalThis.__T = { setDATA: (d) => { DATA = d; } };';
vm.runInContext(src, sandbox, { filename: 'client.js' });
sandbox.__T.setDATA(data); // before any derivation call: they cache on first use
const AB = sandbox.__atkblock;
const E = sandbox.Engine;

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const SHADOW = 34771947, BAROMETT = 62967433, MUDORA = 99937011, TANK = 35026117, GG12 = 8505920;
const FU_ATK = 1, FU_DEF = 4, FD_DEF = 8, MZONE = E.LOC.MZONE;

function mkState(turnCount, mine, opp, myFz, oppFz) {
  const mz = (list) => { const a = Array(7).fill(null); (list || []).forEach(([seq, code, pos]) => { a[seq] = { code, pos }; }); return a; };
  const sz = (fz) => { const a = Array(8).fill(null); if (fz) a[5] = fz; return a; };
  return { turnCount, players: [
    { mzone: mz(mine), szone: sz(myFz) },
    { mzone: mz(opp), szone: sz(oppFz) },
  ] };
}
const feed = (state, evs) => AB.track(evs || [], state);
const reason = (code, con, seq, state) => AB.reason(code, con, MZONE, seq, state);

// ---- A. derivations -------------------------------------------------
{
  const fb = AB.summonTurnBlockCards();
  ok(fb.length === 1 && fb[0].code === SHADOW && fb[0].exempt === 5,
    'A1: FIELD summon-turn block derivation == {ラビリンス・ウォール・シャドウ: Lv5以上を除く}');
  const sb = AB.selfSummonBlockCards();
  ok(sb.length === 1 && sb[0] === TANK,
    'A2: SELF summon-turn block derivation == {迷宮の重魔戦車}');
}

// ---- B. pool-wide audit ---------------------------------------------
{
  const barring = Object.keys(data.texts).filter(code =>
    /攻撃できない|攻撃を行えない|攻撃を行なえない/.test(data.texts[code].text)).map(Number).sort((a, b) => a - b);
  // the four Super Quantal Mech Beasts joined with the Super Quant
  // deck (2026-11-08): their bar is a material-condition continuous
  // (「X素材が無いこのカードは攻撃できない」) enforced by the core
  // itself — NOT a summon-turn block, so the A1/A2 derivations above
  // correctly stay at their enumerated sets.
  ok(JSON.stringify(barring) === JSON.stringify([TANK, SHADOW, 36898537, 78625592, 85252081, 11646785, 57031794, 57450198].sort((a, b) => a - b)),
    'B1: pool-wide attack-barring clauses == exactly the 8 enumerated cards');
  const pend = Object.values(data.cards).filter(c => (c.type & 0x1000000) !== 0).length;
  ok(pend === 0, 'B2: pool holds zero Pendulum monsters (Horus rider branch unreachable)');
  const ggAll = [...data.decks.gg.main, ...data.decks.gg.extra];
  ok(!ggAll.includes(78625592) && [...data.decks.ishizu.main, ...data.decks.ishizu.extra].includes(78625592),
    'B3: 光の護封霊剣 sits only in the human deck (its direct-attack block can only ever face the CPU)');
  const rider = Object.keys(data.texts).filter(code =>
    /この効果で特殊召喚したモンスターは攻撃できず、その効果は発動できない/.test(data.texts[code].text));
  ok(rider.length === 0, 'C1: no pool card carries the revive rider today (attack half arms via the latch only)');
}

// ---- D1. the reported case: Baromett under Shadow --------------------
{
  AB.reset();
  feed(mkState(2, [], [])); // T2 baseline: empty fields
  const st = mkState(3, [[2, BAROMETT, FU_ATK]], [], null, { code: SHADOW, pos: FU_ATK });
  feed(st, [{ kind: 'spsummon', code: BAROMETT, con: 0 }]);
  const r = reason(BAROMETT, 0, 2, st);
  ok(r != null && r.includes('《ラビリンス・ウォール・シャドウ》'),
    'D1: Baromett Xyz-summoned this turn under Shadow states the named reason');
  const lb = AB.liveBlock(st);
  ok(lb && lb.code === SHADOW && lb.exempt === 5, 'D1b: liveBlock finds the opponent field spell');
  // the opponent's own monster is barred too (TargetRange is both fields)
  const stBoth = mkState(3, [[2, BAROMETT, FU_ATK]], [[0, MUDORA, FU_ATK]], null, { code: SHADOW, pos: FU_ATK });
  feed(stBoth, [{ kind: 'summon', code: MUDORA, con: 1 }]);
  ok(reason(MUDORA, 1, 0, stBoth) != null, 'D1c: the block states for the opponent side too (both-fields range)');
}

// ---- D2. no Shadow on the field -> silence ---------------------------
{
  AB.reset();
  feed(mkState(2, [], []));
  const st = mkState(3, [[2, BAROMETT, FU_ATK]], []);
  feed(st, [{ kind: 'spsummon', code: BAROMETT, con: 0 }]);
  ok(reason(BAROMETT, 0, 2, st) === null, 'D2: same summon with no Shadow stays silent');
}

// ---- D3. next turn -> silence ----------------------------------------
{
  AB.reset();
  feed(mkState(2, [], []));
  feed(mkState(3, [[2, BAROMETT, FU_ATK]], [], null, { code: SHADOW, pos: FU_ATK }),
    [{ kind: 'spsummon', code: BAROMETT, con: 0 }]);
  const st5 = mkState(5, [[2, BAROMETT, FU_ATK]], [], null, { code: SHADOW, pos: FU_ATK });
  feed(st5);
  ok(reason(BAROMETT, 0, 2, st5) === null, 'D3: the same Baromett next turn stays silent (block is summon-turn only)');
}

// ---- D4. the printed-Level exception ----------------------------------
{
  AB.reset();
  feed(mkState(2, [], []));
  const st = mkState(3, [[0, GG12, FU_ATK]], [], null, { code: SHADOW, pos: FU_ATK });
  feed(st, [{ kind: 'summon', code: GG12, con: 0 }]);
  ok(reason(GG12, 0, 0, st) === null, 'D4: an original-Level-12 monster summoned this turn is exempt');
  // ...while a Level-4 normal summon in the same field IS barred
  const st2 = mkState(3, [[1, MUDORA, FU_ATK]], [], null, { code: SHADOW, pos: FU_ATK });
  feed(st2, [{ kind: 'summon', code: MUDORA, con: 0 }]);
  ok(reason(MUDORA, 0, 1, st2) != null, 'D4b: a Level-4 normal summon under Shadow is barred');
}

// ---- D5. defense position: no effect claim for a basic-rule absence ---
{
  AB.reset();
  feed(mkState(2, [], []));
  const st = mkState(3, [[2, BAROMETT, FU_DEF]], [], null, { code: SHADOW, pos: FU_ATK });
  feed(st, [{ kind: 'spsummon', code: BAROMETT, con: 0 }]);
  ok(reason(BAROMETT, 0, 2, st) === null, 'D5: a defense-position monster gets no effect reason');
}

// ---- D6. self block: kind matters --------------------------------------
{
  AB.reset();
  feed(mkState(1, [], []));
  const stN = mkState(1, [[0, TANK, FU_ATK]], []);
  feed(stN, [{ kind: 'summon', code: TANK, con: 0 }]);
  const rN = reason(TANK, 0, 0, stN);
  ok(rN != null && rN.includes('召喚したターン'), 'D6: Heavy Tank normal-summoned this turn states its own clause');
  AB.reset();
  feed(mkState(1, [], []));
  const stS = mkState(1, [[0, TANK, FU_ATK]], []);
  feed(stS, [{ kind: 'spsummon', code: TANK, con: 0 }]);
  ok(reason(TANK, 0, 0, stS) === null, 'D6b: a special-summoned Heavy Tank stays silent (its clause hooks normal summon)');
}

// ---- D7. flip summon of a monster set on an earlier turn ---------------
{
  AB.reset();
  feed(mkState(1, [[0, MUDORA, FD_DEF]], []), [{ kind: 'set', code: MUDORA, con: 0, loc: MZONE }]);
  feed(mkState(2, [[0, MUDORA, FD_DEF]], []));
  const st = mkState(3, [[0, MUDORA, FU_ATK]], [], null, { code: SHADOW, pos: FU_ATK });
  feed(st, [{ kind: 'flipsummon', code: MUDORA, con: 0 }]);
  ok(reason(MUDORA, 0, 0, st) != null, 'D7: a flip summon this turn is barred under Shadow');
  // flipped face-up by an EFFECT on a later turn: not a summon at all
  AB.reset();
  feed(mkState(1, [[0, MUDORA, FD_DEF]], []), [{ kind: 'set', code: MUDORA, con: 0, loc: MZONE }]);
  feed(mkState(2, [[0, MUDORA, FD_DEF]], []));
  const stFx = mkState(3, [[0, MUDORA, FU_ATK]], [], null, { code: SHADOW, pos: FU_ATK });
  feed(stFx); // no flipsummon event: an effect turned it face-up
  ok(reason(MUDORA, 0, 0, stFx) === null, 'D7b: a monster flipped by an effect (not flip-summoned) stays silent');
  // ...but set AND flipped by an effect on the SAME turn: it was
  // summoned (set) this turn, so the block truly applies
  AB.reset();
  feed(mkState(1, [], []));
  feed(mkState(1, [[0, MUDORA, FD_DEF]], []), [{ kind: 'set', code: MUDORA, con: 0, loc: MZONE }]);
  const stSame = mkState(1, [[0, MUDORA, FU_ATK]], [], null, { code: SHADOW, pos: FU_ATK });
  feed(stSame);
  ok(reason(MUDORA, 0, 0, stSame) != null, 'D7c: set this turn and flipped by an effect this turn is barred (it was summoned this turn)');
}

// ---- D8. ambiguous flip summon stays silent -----------------------------
{
  AB.reset();
  feed(mkState(1, [[0, MUDORA, FD_DEF], [1, MUDORA, FD_DEF]], []),
    [{ kind: 'set', code: MUDORA, con: 0, loc: MZONE }, { kind: 'set', code: MUDORA, con: 0, loc: MZONE }]);
  feed(mkState(2, [[0, MUDORA, FD_DEF], [1, MUDORA, FD_DEF]], []));
  const st = mkState(3, [[0, MUDORA, FU_ATK], [1, MUDORA, FU_ATK]], [], null, { code: SHADOW, pos: FU_ATK });
  feed(st, [{ kind: 'flipsummon', code: MUDORA, con: 0 }]);
  ok(reason(MUDORA, 0, 0, st) === null && reason(MUDORA, 0, 1, st) === null,
    'D8: two identical face-down copies turning up in one batch cannot be attributed — silence');
}

// ---- D9. identity-less previous occupant proves no arrival --------------
{
  AB.reset();
  const ghost = mkState(3, [[0, null, FD_DEF]], [], null, { code: SHADOW, pos: FU_ATK });
  // a cell the mirror holds without an identity (code null)
  ghost.players[0].mzone[0] = { code: null, pos: FD_DEF };
  feed(ghost);
  const st = mkState(3, [[0, MUDORA, FU_ATK]], [], null, { code: SHADOW, pos: FU_ATK });
  feed(st);
  ok(reason(MUDORA, 0, 0, st) === null, 'D9: an identity-less previous occupant mints no arrival claim');
}

console.log(failures === 0 ? 'ALL ATTACK-BLOCK CHECKS PASSED' : failures + ' ATTACK-BLOCK CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
