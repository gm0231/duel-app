'use strict';
/* engine.js — ocgcore (API v11) client engine shared by the browser UI (client.js)
   and the Node verification harness (test-node.js).
   All message layouts and response encodings are taken from the core sources
   (playerop.cpp / operations.cpp / processor.cpp / field.cpp) and cross-checked
   against the verified PoC driver (poc/duel.js). Do not invent formats. */
(function (global) {

// ---------------------------------------------------------------- constants
const MSG = {1:'RETRY',2:'HINT',3:'WAITING',4:'START',5:'WIN',6:'UPDATE_DATA',7:'UPDATE_CARD',8:'REQUEST_DECK',
10:'SELECT_BATTLECMD',11:'SELECT_IDLECMD',12:'SELECT_EFFECTYN',13:'SELECT_YESNO',14:'SELECT_OPTION',15:'SELECT_CARD',
16:'SELECT_CHAIN',18:'SELECT_PLACE',19:'SELECT_POSITION',20:'SELECT_TRIBUTE',21:'SORT_CHAIN',22:'SELECT_COUNTER',
23:'SELECT_SUM',24:'SELECT_DISFIELD',25:'SORT_CARD',26:'SELECT_UNSELECT_CARD',30:'CONFIRM_DECKTOP',31:'CONFIRM_CARDS',
32:'SHUFFLE_DECK',33:'SHUFFLE_HAND',34:'REFRESH_DECK',35:'SWAP_GRAVE_DECK',36:'SHUFFLE_SET_CARD',37:'REVERSE_DECK',
38:'DECK_TOP',39:'SHUFFLE_EXTRA',40:'NEW_TURN',41:'NEW_PHASE',42:'CONFIRM_EXTRATOP',50:'MOVE',53:'POS_CHANGE',54:'SET',
55:'SWAP',56:'FIELD_DISABLED',60:'SUMMONING',61:'SUMMONED',62:'SPSUMMONING',63:'SPSUMMONED',64:'FLIPSUMMONING',
65:'FLIPSUMMONED',70:'CHAINING',71:'CHAINED',72:'CHAIN_SOLVING',73:'CHAIN_SOLVED',74:'CHAIN_END',75:'CHAIN_NEGATED',
76:'CHAIN_DISABLED',80:'CARD_SELECTED',81:'RANDOM_SELECTED',83:'BECOME_TARGET',90:'DRAW',91:'DAMAGE',92:'RECOVER',
93:'EQUIP',94:'LPUPDATE',95:'UNEQUIP',96:'CARD_TARGET',97:'CANCEL_TARGET',100:'PAY_LPCOST',101:'ADD_COUNTER',
102:'REMOVE_COUNTER',110:'ATTACK',111:'BATTLE',112:'ATTACK_DISABLED',113:'DAMAGE_STEP_START',114:'DAMAGE_STEP_END',
120:'MISSED_EFFECT',121:'BE_CHAIN_TARGET',122:'CREATE_RELATION',123:'RELEASE_RELATION',130:'TOSS_COIN',131:'TOSS_DICE',
132:'ROCK_PAPER_SCISSORS',133:'HAND_RES',140:'ANNOUNCE_RACE',141:'ANNOUNCE_ATTRIB',142:'ANNOUNCE_CARD',
143:'ANNOUNCE_NUMBER',160:'CARD_HINT',161:'TAG_SWAP',162:'RELOAD_FIELD',163:'AI_NAME',164:'SHOW_HINT',165:'PLAYER_HINT',
170:'MATCH_KILL',180:'CUSTOM_MSG',190:'REMOVE_CARDS'};
const SELECT_TYPES = new Set([10,11,12,13,14,15,16,18,19,20,21,22,23,24,25,26,132,140,141,142,143]);
const PHASES = {1:'DRAW',2:'STANDBY',4:'MAIN1',8:'BATTLE_START',16:'BATTLE_STEP',32:'DAMAGE',64:'DAMAGE_CAL',128:'BATTLE',256:'MAIN2',512:'END'};
// The wire carries positions both as the four single-bit values
// and as the face-up / face-down MASKS (a set card announces
// 0xA, a flipped spell/trap changes 0xA -> 0x5) — name all six.
const POS_NAME = { 1: '表側攻撃表示', 2: '裏側攻撃表示', 4: '表側守備表示', 8: '裏側守備表示', 5: '表側表示', 10: '裏側表示' };
const posName = (pos) => POS_NAME[pos & 0xF] || '表示形式不明';
const LOC = { DECK:0x01, HAND:0x02, MZONE:0x04, SZONE:0x08, GRAVE:0x10, REMOVED:0x20, EXTRA:0x40, OVERLAY:0x80 };
const POS = { FU_ATK:0x1, FD_ATK:0x2, FU_DEF:0x4, FD_DEF:0x8 };
const POS_FACEUP = 0x5, POS_ATTACK = 0x3, POS_DEFENSE = 0xC;
// Duel option flags (ocgapi_constants.h) — Genesis-format restrictions on an
// MR5 base, per the user's format decision:
//   base set (unchanged from the verified PoC/MR5 configuration):
//     0x4000  DUEL_FSX_MMZONE                 (Fusion/Synchro/Xyz use main zones)
//     0x8000  DUEL_TRAP_MONSTERS_NOT_USE_ZONE
//     0x10000 DUEL_RETURN_TO_DECK_TRIGGERS
//     0x20000 DUEL_TRIGGER_ONLY_IN_LOCATION
//     0x40000 DUEL_SPSUMMON_ONCE_OLD_NEGATE
//     0x80000 DUEL_CANNOT_SUMMON_OATH_OLD
//   Genesis restrictions:
//     DUEL_EMZONE (0x2000) NOT set  -> no Extra Monster Zones; the core's
//       get_tofield_count then always masks MZONE seq 5/6 as unusable, so
//       Extra-Deck summons land in main zones 0-4 only.
//     DUEL_PZONE (0x800) NOT set    -> no Pendulum Zones (the card pool has
//       no Pendulum cards anyway; audited in NOTES.md).
//     DUEL_1ST_TURN_DRAW (0x200) NOT set -> the starting player does not
//       draw on turn 1 (core: processor.cpp only draws on turn 1 when this
//       flag is present). Opening hand 5, then 1 draw per turn.
// The flags are passed verbatim to OCG_DuelOptions via poc_create in
// v2/build/driver.cpp, so this constant IS the core-level configuration;
// no driver/WASM change is involved.
const FLAGS_GENESIS = 0x40000 | 0x10000 | 0x80000 | 0x4000 | 0x8000 | 0x20000;
const GLOBALS_ORDER = ['constant.lua','archetype_setcode_constants.lua','card_counter_constants.lua','utility.lua',
  'cards_specific_functions.lua','chain.lua','deprecated_functions.lua','proc_equip.lua','proc_fusion.lua',
  'proc_fusion_spell.lua','proc_gemini.lua','proc_link.lua','proc_maximum.lua','proc_normal.lua','proc_pendulum.lua',
  'proc_persistent.lua','proc_ritual.lua','proc_rush.lua','proc_skill.lua','proc_spirit.lua','proc_synchro.lua',
  'proc_union.lua','proc_workaround.lua','proc_xyz.lua'];
const ATTRIBUTES = [[0x01,'地'],[0x02,'水'],[0x04,'炎'],[0x08,'風'],[0x10,'光'],[0x20,'闇'],[0x40,'神']];
const RACES = [[0x1,'戦士'],[0x2,'魔法使い'],[0x4,'天使'],[0x8,'悪魔'],[0x10,'アンデット'],[0x20,'機械'],[0x40,'水'],[0x80,'炎'],
  [0x100,'岩石'],[0x200,'鳥獣'],[0x400,'植物'],[0x800,'昆虫'],[0x1000,'雷'],[0x2000,'ドラゴン'],[0x4000,'獣'],[0x8000,'獣戦士'],
  [0x10000,'恐竜'],[0x20000,'魚'],[0x40000,'海竜'],[0x80000,'爬虫類'],[0x100000,'サイキック'],[0x200000,'幻神獣'],
  [0x400000,'創造神'],[0x800000,'幻竜'],[0x1000000,'サイバース'],[0x2000000,'幻想魔族']];

// ---------------------------------------------------------------- shuffling
// The core deals each deck in the EXACT order the cards were registered
// (last registered = top of the deck); shuffling before registration is the
// client's job, as in the ygopro family. The data bundle stores deck lists
// grouped by card type (monsters first, then spells, then traps), so without
// a shuffle every duel would deal the same spell/trap-heavy opening hand and
// the monsters only near deck-out (verified empirically: identical draw
// sequences across seeds before this was added).
function randBelow(n) {
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto &&
             typeof globalThis.crypto.getRandomValues === 'function') ? globalThis.crypto : null;
  if (c) { // unbiased via rejection sampling on a u32
    const limit = Math.floor(4294967296 / n) * n;
    const buf = new Uint32Array(1);
    let x;
    do { c.getRandomValues(buf); x = buf[0]; } while (x >= limit);
    return x % n;
  }
  return Math.floor(Math.random() * n);
}
function shuffledCopy(arr) { // Fisher-Yates on a copy; the input is not mutated
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randBelow(i + 1);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// ---------------------------------------------------------------- byte IO
class Reader {
  constructor(buf, off) { this.b = buf; this.o = off || 0; }
  u8() { return this.b[this.o++]; }
  u16() { const v = this.b[this.o] | (this.b[this.o+1] << 8); this.o += 2; return v; }
  i16() { const v = this.u16(); return v > 0x7fff ? v - 0x10000 : v; }
  u32() { const v = (this.b[this.o] | (this.b[this.o+1] << 8) | (this.b[this.o+2] << 16) | (this.b[this.o+3] << 24)) >>> 0; this.o += 4; return v; }
  i32() { return this.u32() | 0; }
  u64n() { const lo = this.u32(), hi = this.u32(); return lo + hi * 4294967296; } // exact for values < 2^53
  u64raw() { const lo = this.u32(), hi = this.u32(); return [lo, hi]; }
  bytes(n) { const v = this.b.subarray(this.o, this.o + n); this.o += n; return v; }
  locInfo() { const con = this.u8(), loc = this.u8(), seq = this.u32(), pos = this.u32(); return { con, loc, seq, pos }; }
}
function splitMessages(buf) {
  const out = []; let o = 0;
  while (o + 4 <= buf.length) {
    const len = (buf[o] | (buf[o+1] << 8) | (buf[o+2] << 16) | (buf[o+3] << 24)) >>> 0;
    if (len === 0 || o + 4 + len > buf.length) break;
    out.push(buf.subarray(o + 4, o + 4 + len));
    o += 4 + len;
  }
  return out;
}
// ---------------------------------------------------------------- responses
function i32resp(v) { const a = new Uint8Array(4); new DataView(a.buffer).setInt32(0, v, true); return a; }
function cancelResp() { return i32resp(-1); } // valid wherever int32 -1 is accepted (card selects, chain pass, sort keep, unselect finish/cancel)
function cardsResp(indices) { // parse_response_cards "type 2": i32 type=2, u32 count, u8 indices — PoC-verified
  const out = new Uint8Array(8 + indices.length);
  const dv = new DataView(out.buffer);
  dv.setInt32(0, 2, true); dv.setUint32(4, indices.length, true);
  indices.forEach((p, i) => { out[8 + i] = p; });
  return out;
}
function cmdResp(type, index) { return i32resp(((index || 0) << 16) | type); }
function placeResp(zones) { // zones: [{con, loc, seq}]
  const out = new Uint8Array(zones.length * 3);
  zones.forEach((z, i) => { out[i*3] = z.con; out[i*3+1] = z.loc; out[i*3+2] = z.seq; });
  return out;
}
function counterResp(amounts) {
  const out = new Uint8Array(amounts.length * 2);
  const dv = new DataView(out.buffer);
  amounts.forEach((a, i) => dv.setInt16(i * 2, a, true));
  return out;
}
function sortResp(order) { return new Uint8Array(order); } // int8 permutation; first byte -1 (0xff) = keep order
function unselectToggleResp(idx) { const out = new Uint8Array(8); const dv = new DataView(out.buffer); dv.setInt32(0, 1, true); dv.setInt32(4, idx, true); return out; }
function u64resp(lo, hi) { const out = new Uint8Array(8); const dv = new DataView(out.buffer); dv.setUint32(0, lo >>> 0, true); dv.setUint32(4, hi >>> 0, true); return out; }

// ---------------------------------------------------------------- prompt parsing
// Returns a structured prompt for SELECT_* messages, or null for other messages.
// Entry layouts are from playerop.cpp (edo9300/ygopro-core, API v11).
function cardEntry(r, withPos) { // code u32 + loc_info(10B)
  const code = r.u32(); const li = r.locInfo();
  return { code, con: li.con, loc: li.loc, seq: li.seq, pos: li.pos };
}
function parsePrompt(msg) {
  const type = msg[0];
  if (!SELECT_TYPES.has(type)) return null;
  const r = new Reader(msg, 1);
  switch (type) {
    case 11: { // SELECT_IDLECMD
      const player = r.u8();
      const lists = [];
      const sizes = [10, 10, 7, 10, 10]; // summon, spsummon, reposition(u8 seq), mset, sset — entry byte sizes after the code
      for (let li = 0; li < 5; li++) {
        const n = r.u32(); const entries = [];
        for (let i = 0; i < n; i++) {
          const code = r.u32(); const con = r.u8(); const loc = r.u8();
          const seq = sizes[li] === 7 ? r.u8() : r.u32();
          entries.push({ code, con, loc, seq });
        }
        lists.push(entries);
      }
      const nAct = r.u32(); const activate = [];
      for (let i = 0; i < nAct; i++) {
        const code = r.u32(); const con = r.u8(); const loc = r.u8(); const seq = r.u32();
        const desc = r.u64n(); const mode = r.u8();
        activate.push({ code, con, loc, seq, desc, mode });
      }
      const toBP = r.u8(), toEP = r.u8(), canShuffle = r.u8();
      return { type, name: 'SELECT_IDLECMD', player, summon: lists[0], spsummon: lists[1], repos: lists[2],
               mset: lists[3], sset: lists[4], activate, toBP: !!toBP, toEP: !!toEP, canShuffle: !!canShuffle };
    }
    case 10: { // SELECT_BATTLECMD
      const player = r.u8();
      const nAct = r.u32(); const activate = [];
      for (let i = 0; i < nAct; i++) {
        const code = r.u32(); const con = r.u8(); const loc = r.u8(); const seq = r.u32();
        const desc = r.u64n(); const mode = r.u8();
        activate.push({ code, con, loc, seq, desc, mode });
      }
      const nAtk = r.u32(); const attack = [];
      for (let i = 0; i < nAtk; i++) {
        const code = r.u32(); const con = r.u8(); const loc = r.u8(); const seq = r.u8(); const direct = r.u8();
        attack.push({ code, con, loc, seq, direct: !!direct });
      }
      const toM2 = r.u8(), toEP = r.u8();
      return { type, name: 'SELECT_BATTLECMD', player, activate, attack, toM2: !!toM2, toEP: !!toEP };
    }
    case 16: { // SELECT_CHAIN
      const player = r.u8(); const speCount = r.u8(); const forced = r.u8();
      const hint0 = r.u32(), hint1 = r.u32();
      const n = r.u32(); const entries = [];
      for (let i = 0; i < n; i++) {
        const e = cardEntry(r); e.desc = r.u64n(); e.mode = r.u8();
        entries.push(e);
      }
      return { type, name: 'SELECT_CHAIN', player, speCount, forced: !!forced, entries };
    }
    case 15: case 20: { // SELECT_CARD / SELECT_TRIBUTE
      const player = r.u8(); const cancelable = r.u8();
      const min = r.u32(), max = r.u32(), count = r.u32();
      const cards = [];
      for (let i = 0; i < count; i++) {
        if (type === 20) { // SELECT_TRIBUTE entries are 11B: code, con, loc, seq u32, release_param — NO position (playerop.cpp)
          const code = r.u32(); const con = r.u8(); const loc = r.u8(); const seq = r.u32(); const releaseParam = r.u8();
          cards.push({ code, con, loc, seq, pos: 0, releaseParam });
        } else {
          cards.push(cardEntry(r));
        }
      }
      return { type, name: type === 15 ? 'SELECT_CARD' : 'SELECT_TRIBUTE', player, cancelable: !!cancelable, min, max, cards };
    }
    case 26: { // SELECT_UNSELECT_CARD
      const player = r.u8(); const finishable = r.u8(); const cancelable = r.u8();
      const min = r.u32(), max = r.u32();
      const n1 = r.u32(); const select = [];
      for (let i = 0; i < n1; i++) select.push(cardEntry(r));
      const n2 = r.u32(); const unselect = [];
      for (let i = 0; i < n2; i++) unselect.push(cardEntry(r));
      return { type, name: 'SELECT_UNSELECT_CARD', player, finishable: !!finishable, cancelable: !!cancelable, min, max, select, unselect };
    }
    case 23: { // SELECT_SUM
      const player = r.u8(); const modeByte = r.u8(); // 0 = exact (arg.max>0), 1 = exceed
      const acc = r.u32(), min = r.u32(), max = r.u32();
      const nMust = r.u32(); const must = [];
      for (let i = 0; i < nMust; i++) { const e = cardEntry(r); e.sumParam = r.u32(); must.push(e); }
      const n = r.u32(); const cards = [];
      for (let i = 0; i < n; i++) { const e = cardEntry(r); e.sumParam = r.u32(); cards.push(e); }
      return { type, name: 'SELECT_SUM', player, mode: modeByte === 0 ? 'exact' : 'exceed', acc, min, max, must, cards };
    }
    case 22: { // SELECT_COUNTER
      const player = r.u8(); const counterType = r.u16(); const count = r.u16();
      const n = r.u32(); const cards = [];
      for (let i = 0; i < n; i++) {
        const code = r.u32(); const con = r.u8(); const loc = r.u8(); const seq = r.u8(); const cnt = r.u16();
        cards.push({ code, con, loc, seq, count: cnt });
      }
      return { type, name: 'SELECT_COUNTER', player, counterType, count, cards };
    }
    case 18: case 24: { // SELECT_PLACE / SELECT_DISFIELD
      const player = r.u8(); const count = r.u8(); const flag = r.u32();
      return { type, name: type === 18 ? 'SELECT_PLACE' : 'SELECT_DISFIELD', player, count, flag };
    }
    case 19: { // SELECT_POSITION
      const player = r.u8(); const code = r.u32(); const mask = r.u8();
      return { type, name: 'SELECT_POSITION', player, code, mask };
    }
    case 13: { // SELECT_YESNO
      const player = r.u8(); const desc = r.u64n();
      return { type, name: 'SELECT_YESNO', player, desc };
    }
    case 12: { // SELECT_EFFECTYN
      const player = r.u8(); const e = cardEntry(r); const desc = r.u64n();
      return { type, name: 'SELECT_EFFECTYN', player, code: e.code, con: e.con, loc: e.loc, seq: e.seq, pos: e.pos, desc };
    }
    case 14: { // SELECT_OPTION
      const player = r.u8(); const n = r.u8(); const options = [];
      for (let i = 0; i < n; i++) options.push(r.u64n());
      return { type, name: 'SELECT_OPTION', player, options };
    }
    case 25: case 21: { // SORT_CARD / SORT_CHAIN — entries: code u32, con u8, loc u32, seq u32
      const player = r.u8(); const n = r.u32(); const cards = [];
      for (let i = 0; i < n; i++) {
        const code = r.u32(); const con = r.u8(); const loc = r.u32(); const seq = r.u32();
        cards.push({ code, con, loc, seq });
      }
      return { type, name: type === 25 ? 'SORT_CARD' : 'SORT_CHAIN', player, cards };
    }
    case 132: { // ROCK_PAPER_SCISSORS
      const player = r.u8();
      return { type, name: 'ROCK_PAPER_SCISSORS', player };
    }
    case 140: { // ANNOUNCE_RACE
      const player = r.u8(); const count = r.u8(); const [lo, hi] = r.u64raw();
      return { type, name: 'ANNOUNCE_RACE', player, count, availLo: lo, availHi: hi };
    }
    case 141: { // ANNOUNCE_ATTRIB
      const player = r.u8(); const count = r.u8(); const avail = r.u32();
      return { type, name: 'ANNOUNCE_ATTRIB', player, count, avail };
    }
    case 142: { // ANNOUNCE_CARD — opcodes are u64 stack-machine words; keep them exact as BigInt
      const player = r.u8(); const n = r.u8(); const opcodes = [];
      for (let i = 0; i < n; i++) { const [lo, hi] = r.u64raw(); opcodes.push((BigInt(hi) << 32n) | BigInt(lo)); }
      return { type, name: 'ANNOUNCE_CARD', player, opcodes };
    }
    case 143: { // ANNOUNCE_NUMBER
      const player = r.u8(); const n = r.u8(); const options = [];
      for (let i = 0; i < n; i++) options.push(r.u64n());
      return { type, name: 'ANNOUNCE_NUMBER', player, options };
    }
  }
  return null;
}

// SELECT_SUM validity — mirrors playerop.cpp select_sum_check1 and the exceed-mode check.
function sumParamsOf(cards) { return cards.map(c => c.sumParam); }
function sumCheck1(oparam, size, index, acc) {
  if (acc === 0 || index === size) return false;
  const o1 = oparam[index] & 0xffff, o2 = oparam[index] >> 16;
  if (index === size - 1) return acc === o1 || acc === o2;
  return (acc > o1 && sumCheck1(oparam, size, index + 1, acc - o1)) ||
         (o2 > 0 && acc > o2 && sumCheck1(oparam, size, index + 1, acc - o2));
}
function sumSelectionValid(prompt, chosenIdx) {
  const must = prompt.must, chosen = chosenIdx.map(i => prompt.cards[i]);
  if (prompt.mode === 'exact') {
    const tot = chosen.length;
    if (tot < prompt.min || tot > prompt.max) return false;
    const oparam = sumParamsOf(must.concat(chosen));
    return sumCheck1(oparam, tot + must.length, 0, prompt.acc);
  }
  // exceed mode
  let sum = 0, mx = 0, mn = 0x7fffffff;
  for (const c of must.concat(chosen)) {
    const o1 = c.sumParam & 0xffff, o2 = c.sumParam >> 16;
    const ms = (o2 && o2 < o1) ? o2 : o1;
    sum += ms; mx += (o2 > o1) ? o2 : o1; if (ms < mn) mn = ms;
  }
  return !(mx < prompt.acc || sum - mn >= prompt.acc);
}

// ---------------------------------------------------------------- announce-card filter
// Faithful port of is_declarable() in playerop.cpp (edo9300/ygopro-core): the
// core validates a declared code by running the prompt's opcode stack against
// the card data. The UI uses the same check to offer only declarable cards.
const OPC = {
  ADD: 0x4000000000000000n, SUB: 0x4000000100000000n, MUL: 0x4000000200000000n, DIV: 0x4000000300000000n,
  AND: 0x4000000400000000n, OR: 0x4000000500000000n, NEG: 0x4000000600000000n, NOT: 0x4000000700000000n,
  BAND: 0x4000000800000000n, BOR: 0x4000000900000000n, BNOT: 0x4000001000000000n, BXOR: 0x4000001100000000n,
  LSHIFT: 0x4000001200000000n, RSHIFT: 0x4000001300000000n,
  ALLOW_ALIASES: 0x4000001400000000n, ALLOW_TOKENS: 0x4000001500000000n,
  ISCODE: 0x4000010000000000n, ISSETCARD: 0x4000010100000000n, ISTYPE: 0x4000010200000000n,
  ISRACE: 0x4000010300000000n, ISATTRIBUTE: 0x4000010400000000n,
  GETCODE: 0x4000010500000000n, GETSETCARD: 0x4000010600000000n, GETTYPE: 0x4000010700000000n,
  GETRACE: 0x4000010800000000n, GETATTRIBUTE: 0x4000010900000000n,
};
function isDeclarable(cd, opcodes) {
  const stack = [];
  let allowAlias = false, allowToken = false;
  const bin = (f) => { if (stack.length >= 2) { const rhs = stack.pop(); const lhs = stack.pop(); stack.push(f(lhs, rhs)); } };
  const un = (f) => { if (stack.length >= 1) stack.push(f(stack.pop())); };
  for (const opcode of opcodes) {
    switch (opcode) {
      case OPC.ADD: bin((a, b) => a + b); break;
      case OPC.SUB: bin((a, b) => a - b); break;
      case OPC.MUL: bin((a, b) => a * b); break;
      case OPC.DIV: bin((a, b) => (b === 0n ? 0n : a / b)); break;
      case OPC.AND: bin((a, b) => (a !== 0n && b !== 0n) ? 1n : 0n); break;
      case OPC.OR: bin((a, b) => (a !== 0n || b !== 0n) ? 1n : 0n); break;
      case OPC.NEG: un((a) => -a); break;
      case OPC.NOT: un((a) => (a === 0n ? 1n : 0n)); break;
      case OPC.BAND: bin((a, b) => a & b); break;
      case OPC.BOR: bin((a, b) => a | b); break;
      case OPC.BXOR: bin((a, b) => a ^ b); break;
      case OPC.BNOT: un((a) => ~a); break;
      case OPC.LSHIFT: bin((a, b) => a << b); break;
      case OPC.RSHIFT: bin((a, b) => a >> b); break;
      case OPC.ISCODE: un((a) => (a === BigInt(cd.code) ? 1n : 0n)); break;
      case OPC.ISTYPE: un((a) => BigInt(cd.type) & a); break;
      case OPC.ISRACE: un((a) => BigInt(cd.race) & a); break;
      case OPC.ISATTRIBUTE: un((a) => BigInt(cd.attribute) & a); break;
      case OPC.GETCODE: stack.push(BigInt(cd.code)); break;
      case OPC.GETTYPE: stack.push(BigInt(cd.type)); break;
      case OPC.GETRACE: stack.push(BigInt(cd.race)); break;
      case OPC.GETATTRIBUTE: stack.push(BigInt(cd.attribute)); break;
      case OPC.ISSETCARD: {
        if (stack.length >= 1) {
          const sc = Number(stack.pop() & 0xffffffffn);
          const settype = sc & 0xfff, setsubtype = sc & 0xf000;
          let res = 0n;
          for (const c of (cd.setcodes || [])) {
            if ((c & 0xfff) === settype && (c & 0xf000 & setsubtype) === setsubtype) { res = 1n; break; }
          }
          stack.push(res);
        }
        break;
      }
      case OPC.ALLOW_ALIASES: allowAlias = true; break;
      case OPC.ALLOW_TOKENS: allowToken = true; break;
      default: stack.push(opcode); break;
    }
  }
  if (stack.length !== 1 || stack[0] === 0n) return false;
  const TYPE_MONSTER = 0x1, TYPE_TOKEN = 0x4000;
  return cd.code === 78734254 || cd.code === 13857930 ||
    ((allowAlias || !cd.alias) && (allowToken || ((cd.type & (TYPE_MONSTER + TYPE_TOKEN)) !== (TYPE_MONSTER + TYPE_TOKEN))));
}

// ---------------------------------------------------------------- game state
// Client-side mirror of the field, maintained from the core's message stream.
// Cards in piles are tracked as code arrays; removal prefers the exact sequence
// and falls back to the first matching code (hand order can change silently in
// a few paths — matching by code self-heals the mirror).
class GameState {
  constructor(data, deckP0, deckP1) {
    this.names = data.names || {};
    this.cardData = data.cards || {};
    this.humanPlayer = 0; // core seat treated as "自分" in logs; Duel overrides from opts
    this.reset(data, deckP0, deckP1);
  }
  reset(data, deckP0, deckP1) {
    const mk = (deck) => ({
      lp: 8000,
      hand: [],                       // [{code|null}]
      deckCount: deck.main.length,
      extra: deck.extra.map(code => ({ code, pos: POS.FD_DEF, materials: 0 })), // [{code, pos, materials}]
      grave: [],                      // [code]
      removed: [],                    // [code]
      mzone: Array(7).fill(null),     // {code|null, pos, materials, curAtk?, curDef?}
      szone: Array(8).fill(null),     // {code|null, pos}
    });
    this.players = [mk(deckP0 || data.decks.ishizu), mk(deckP1 || data.decks.gg)];
    // Retained for the CPU policy's remaining-deck estimates (botView reads
    // only the bot's own list in full; the opponent's is used solely to
    // subtract publicly-visible cards — see the CPU policy header).
    this.deckLists = [deckP0 || data.decks.ishizu, deckP1 || data.decks.gg];
    this.turnPlayer = 0; this.turnCount = 0; this.phase = 0; this.phaseName = '';
    this.transit = [0, 0];            // overlay units in flight to an entry-less pile (see MOVE case)
    this.graveResync = new Set();     // players whose grave identities must be re-queried (MSG_SWAP_GRAVE_DECK)
    this.chain = [];                  // [{code, con, loc, seq, desc, player, negated, disabled, solved}]
    this.solvingLink = 0;             // chain_count currently resolving (0 = building)
    this.winner = null; this.winReason = 0;
    this.lastAttack = null;           // {attacker, target|null}
    this.deckTop = [null, null];
    this.log = [];                    // recent event strings (system text only)
    this.events = [];                 // transient event queue for presentation (SE cues), drained by the client
    this.dlog = [];                   // detailed history entries for the history sheet (see pushDLog)
    this.chainSeq = 0;                // chain-episode counter: entries of one chain share an id
  }
  nameOf(code) { return this.names[code] || ('#' + code); }
  who(p) { return p === this.humanPlayer ? '自分' : '相手'; }
  pushLog(s) { this.log.push(s); if (this.log.length > 60) this.log.shift(); }
  pushEvent(e) { this.events.push(e); if (this.events.length > 300) this.events.splice(0, this.events.length - 300); }
  // Detailed history (log-detail round, 2026-11-03 — user: the log
  // only carried headlines; effects, processing and outcomes were
  // nowhere written down). Entries are stamped with the turn, the
  // turn player and the phase at message time so the client's
  // history sheet can group by turn and by chain episode without
  // re-deriving context. Two shapes:
  //   {k:'info'|'phase'|'dmg', s}         finished Japanese text
  //   {k:'act'|'solve'|'neg'|'dis', con, code, desc, loc, link, tgt?}
  //     chain lines — the client appends the effect number via its
  //     audited fx resolver (the mirror deliberately does not guess
  //     numbers; fxmap lives client-side).
  // `cid` = chain episode id (0 = not part of a chain), `sol` =
  // the link whose resolution produced the entry (0 = none).
  // Everything is composed from message payloads and mirror state
  // only — never inferred identities for hidden cards: entries
  // about the opponent's face-down cards stay generic, and the
  // opponent's draws stay count-only, exactly like pushLog.
  pushDLog(e) {
    e.turn = this.turnCount; e.tp = this.turnPlayer; e.ph = this.phaseName || '';
    e.cid = e.cid || 0; e.sol = e.sol || 0;
    this.dlog.push(e);
    if (this.dlog.length > 600) this.dlog.splice(0, this.dlog.length - 600);
  }
  chainCid() { return (this.chain.length || this.solvingLink) ? this.chainSeq : 0; }
  // The card whose effect is currently asking something: the link being solved,
  // else the newest chain link. Used to give every prompt a visible source.
  chainContext() {
    // desc rides along (MSG_CHAINING carries the link's effect
    // description) so confirmation UIs can name WHICH effect of the
    // asking card is behind a sub-prompt, not just the card.
    if (this.solvingLink > 0 && this.chain[this.solvingLink - 1]) {
      const l = this.chain[this.solvingLink - 1];
      return { code: l.code, con: l.con, loc: l.loc, seq: l.seq, player: l.player, link: this.solvingLink, desc: l.desc };
    }
    if (this.chain.length) {
      const l = this.chain[this.chain.length - 1];
      return { code: l.code, con: l.con, loc: l.loc, seq: l.seq, player: l.player, link: this.chain.length, desc: l.desc };
    }
    return null;
  }
  _pileRemove(arr, seq, code, getCode) {
    if (seq >= 0 && seq < arr.length && getCode(arr[seq]) === code) { arr.splice(seq, 1); return; }
    const i = arr.findIndex(e => getCode(e) === code);
    if (i >= 0) { arr.splice(i, 1); return; }
    if (seq >= 0 && seq < arr.length) arr.splice(seq, 1);
    else if (arr.length) arr.pop();
  }
  _pileInsert(arr, seq, entry) {
    if (seq >= 0 && seq <= arr.length) arr.splice(seq, 0, entry); else arr.push(entry);
  }
  // Overlay units have no location of their own in the core's wire format:
  // a unit's loc_info is (controller, host_location | OVERLAY, host_sequence)
  // — it always names its HOST's current location, and when the host changes
  // location the core sends only the host's own MOVE (no per-unit updates).
  // The mirror therefore counts units on the host's entry: hosts live in
  // mzone or extra entries (both carry a `materials` count). Hosts in piles
  // without entries (grave/removed) hold no count: the core releases their
  // units with separate MOVEs encoded against the host's new location, and
  // those units are counted at their destination instead.
  _hostEntry(p, li) {
    const base = li.loc & ~LOC.OVERLAY;
    if (base === LOC.MZONE) return p.mzone[li.seq] || null;
    if (base === LOC.EXTRA) return p.extra[li.seq] || null;
    return null;
  }
  _removeAt(li, code) {
    const p = this.players[li.con]; if (!p) return;
    if (li.loc & LOC.OVERLAY) {
      const host = this._hostEntry(p, li);
      if (host) host.materials = Math.max(0, (host.materials || 0) - 1);
      else {
        // No host entry: the host sits in an entry-less pile (grave/removed/
        // deck/hand), so this is a unit being released from a host that was
        // moved there — its count was parked in transit[] by the host's MOVE.
        const base = li.loc & ~LOC.OVERLAY;
        if (base === LOC.GRAVE || base === LOC.REMOVED || base === LOC.DECK || base === LOC.HAND)
          this.transit[li.con] = Math.max(0, (this.transit[li.con] || 0) - 1);
      }
      return;
    }
    switch (li.loc) {
      case LOC.MZONE: p.mzone[li.seq] = null; break;
      case LOC.SZONE: p.szone[li.seq] = null; break;
      case LOC.HAND: this._pileRemove(p.hand, li.seq, code, e => e.code); break;
      case LOC.GRAVE: this._pileRemove(p.grave, li.seq, code, e => e); break;
      case LOC.REMOVED: this._pileRemove(p.removed, li.seq, code, e => e); break;
      case LOC.EXTRA: this._pileRemove(p.extra, li.seq, code, e => e.code); break;
      case LOC.DECK: p.deckCount = Math.max(0, p.deckCount - 1); break;
    }
  }
  _insertAt(li, code) {
    const p = this.players[li.con]; if (!p) return;
    if (li.loc & LOC.OVERLAY) {
      const host = this._hostEntry(p, li);
      if (host) host.materials = (host.materials || 0) + 1;
      return;
    }
    switch (li.loc) {
      case LOC.MZONE: p.mzone[li.seq] = { code, pos: li.pos, materials: 0 }; break;
      case LOC.SZONE: p.szone[li.seq] = { code, pos: li.pos }; break;
      case LOC.HAND: this._pileInsert(p.hand, li.seq, { code }); break;
      case LOC.GRAVE: this._pileInsert(p.grave, li.seq, code); break;
      case LOC.REMOVED: this._pileInsert(p.removed, li.seq, code); break;
      case LOC.EXTRA: this._pileInsert(p.extra, li.seq, { code, pos: li.pos, materials: 0 }); break;
      case LOC.DECK: p.deckCount++; break;
    }
  }
  apply(msg) {
    const t = msg[0]; const r = new Reader(msg, 1);
    switch (t) {
      case 5: { this.winner = r.u8(); this.winReason = r.u8(); this.pushDLog({ k: 'info', s: '決着：' + this.who(this.winner) + ' の勝利' }); break; } // WIN
      case 40: this.turnPlayer = r.u8(); this.turnCount++; break; // NEW_TURN
      case 41: { const ph = r.u16(); this.phase = ph; this.phaseName = PHASES[ph] || ('PH' + ph); break; } // NEW_PHASE
      case 94: { const p = r.u8(); this.players[p].lp = r.i32(); break; } // LPUPDATE
      case 91: { const p = r.u8(); const amt = r.u32(); const before = this.players[p].lp; this.players[p].lp -= amt; this.pushLog(this.who(p) + 'に ' + amt + ' ダメージ'); this.pushDLog({ k: 'dmg', cid: this.chainCid(), sol: this.solvingLink, s: this.who(p) + ' に ' + amt + ' ダメージ（LP ' + before + ' → ' + this.players[p].lp + '）' }); this.pushEvent({ kind: 'damage', player: p, amount: amt }); break; } // DAMAGE
      case 92: { const p = r.u8(); const amt = r.u32(); const before = this.players[p].lp; this.players[p].lp += amt; this.pushDLog({ k: 'info', cid: this.chainCid(), sol: this.solvingLink, s: this.who(p) + ' は ' + amt + ' 回復（LP ' + before + ' → ' + this.players[p].lp + '）' }); this.pushEvent({ kind: 'recover', player: p, amount: amt }); break; } // RECOVER
      case 100: { const p = r.u8(); const amt = r.u32(); const before = this.players[p].lp; this.players[p].lp -= amt; this.pushDLog({ k: 'info', cid: this.chainCid(), sol: this.solvingLink, s: this.who(p) + ' はコストとして LP を ' + amt + ' 払った（LP ' + before + ' → ' + this.players[p].lp + '）' }); break; } // PAY_LPCOST
      case 50: { // MOVE: code, from loc_info, to loc_info, reason
        const code = r.u32(); const from = r.locInfo(); const to = r.locInfo(); const reason = r.u32();
        if (code !== 0) { // code 0 = deck-internal reorder noise
          // If the moving card is itself an Xyz host, its overlay count rides
          // on its mirror entry and must follow it to the new location: the
          // core sends no per-unit MOVEs when a host changes location (unit
          // loc_infos silently re-encode against the host's new location).
          // Hosts landing in entry-less piles (grave/removed) drop the count
          // here; the core then releases each unit with its own MOVE, which
          // counts it at its destination.
          let carry = 0;
          const fp = this.players[from.con];
          if (fp && !(from.loc & LOC.OVERLAY)) {
            if (from.loc === LOC.MZONE && fp.mzone[from.seq]) carry = fp.mzone[from.seq].materials || 0;
            else if (from.loc === LOC.EXTRA && fp.extra[from.seq]) {
              // The core's seq is authoritative for where the host sat. The
              // mirror's extra order is deck-list order (the pre-registration
              // shuffle is never reported to the client), so the entry at seq
              // may show a different code — but any units credited to that
              // index were credited for this host, so claim them here;
              // _removeAt below removes the host's own entry by code.
              carry = fp.extra[from.seq].materials || 0;
              fp.extra[from.seq].materials = 0;
            }
          }
          this._removeAt(from, code);
          if (to.loc !== 0) this._insertAt(to, code);
          if (carry && !(to.loc & LOC.OVERLAY)) {
            const tp = this.players[to.con];
            if (tp && to.loc === LOC.MZONE && tp.mzone[to.seq]) tp.mzone[to.seq].materials = carry;
            else if (tp && to.loc === LOC.EXTRA) { const e = tp.extra[to.seq]; if (e && e.code === code) e.materials = carry; }
            else if (to.loc === LOC.GRAVE || to.loc === LOC.REMOVED || to.loc === LOC.DECK || to.loc === LOC.HAND) {
              // The destination pile has no per-card entries to hold the
              // count, but the units are still attached to the host in the
              // core until it releases them with their own MOVEs (encoded
              // against the host's new location). Park the count in
              // transit[] so batch-boundary totals stay exact; _removeAt
              // drains it as each unit's release MOVE arrives.
              this.transit[to.con] = (this.transit[to.con] || 0) + carry;
            }
          }
          const nm = this.nameOf(code);
          // Every change to a hand must be explained in the log (Phase 2 requirement).
          if (from.loc === LOC.HAND && to.loc !== LOC.HAND && to.loc !== LOC.MZONE && to.loc !== LOC.SZONE) {
            const dest = to.loc === LOC.GRAVE ? (reason & 0x4000 ? '手札から捨てた' : '手札から墓地へ送った')
              : to.loc === LOC.REMOVED ? '手札から除外した'
              : to.loc === LOC.DECK ? '手札からデッキに戻した'
              : to.loc === LOC.EXTRA ? '手札からEXデッキに戻した' : '手札から移動した';
            this.pushLog(this.who(from.con) + '：' + nm + ' を' + dest);
          }
          if (to.loc === LOC.HAND && from.loc !== LOC.HAND) {
            const src = from.loc === LOC.GRAVE ? '墓地から' : from.loc === LOC.REMOVED ? '除外されている'
              : from.loc === LOC.DECK ? 'デッキから' : (from.loc === LOC.MZONE || from.loc === LOC.SZONE) ? 'フィールドから' : '';
            this.pushLog(this.who(to.con) + '：' + nm + ' を' + src + '手札に加えた');
          }
          if (to.loc === LOC.GRAVE && (reason & 0x1) && (from.loc === LOC.MZONE || from.loc === LOC.SZONE))
            this.pushEvent({ kind: 'destroy', code, con: from.con, fromLoc: from.loc, battle: !!(reason & 0x20) });
          if (to.loc === LOC.REMOVED && from.loc !== LOC.REMOVED)
            this.pushEvent({ kind: 'banish', code, con: from.con });
          // Detailed history: every publicly-visible movement gets an
          // outcome line (destroyed / banished / sent / returned /
          // milled / discarded), attributed to the chain link being
          // solved when there is one. Zone ARRIVALS are covered by
          // the summon/set/activation lines, so only departures and
          // pile-to-pile moves are written here.
          {
            const sol = this.solvingLink, cid = this.chainCid();
            const fromField = from.loc === LOC.MZONE || from.loc === LOC.SZONE;
            const toField = to.loc === LOC.MZONE || to.loc === LOC.SZONE;
            let s = null;
            if (from.loc & LOC.OVERLAY) {
              const dst = to.loc === LOC.GRAVE ? 'が墓地へ送られた' : to.loc === LOC.HAND ? 'が手札に戻った'
                : to.loc === LOC.REMOVED ? 'が除外された' : to.loc === LOC.DECK ? 'がデッキに戻った' : null;
              if (dst) s = this.who(from.con) + '：' + nm + '（エクシーズ素材）' + dst;
            } else if (fromField && toField && from.con !== to.con) {
              s = this.who(from.con) + '：' + nm + ' のコントロールが ' + this.who(to.con) + ' へ移った';
            } else if (to.loc & LOC.OVERLAY) {
              const host = this._hostEntry(this.players[to.con], to);
              s = this.who(from.con) + '：' + nm + ' が' + (host && host.code ? '《' + this.nameOf(host.code) + '》' : 'モンスター') + ' のエクシーズ素材になった';
            } else if (fromField) {
              if (to.loc === LOC.GRAVE) s = this.who(from.con) + '：' + nm + ' は' + ((reason & 0x1) ? ((reason & 0x20) ? '戦闘で破壊され、墓地へ送られた' : '効果で破壊され、墓地へ送られた') : '墓地へ送られた');
              else if (to.loc === LOC.REMOVED) s = this.who(from.con) + '：' + nm + ' は除外された';
              else if (to.loc === LOC.HAND) s = this.who(from.con) + '：' + nm + ' は手札に戻った';
              else if (to.loc === LOC.DECK) s = this.who(from.con) + '：' + nm + ' はデッキに戻った';
              else if (to.loc === LOC.EXTRA) s = this.who(from.con) + '：' + nm + ' はEXデッキに戻った';
            } else if (from.loc === LOC.HAND) {
              if (to.loc === LOC.GRAVE) s = this.who(from.con) + '：' + nm + ' を' + ((reason & 0x4000) ? '手札から捨てた' : '手札から墓地へ送った');
              else if (to.loc === LOC.REMOVED) s = this.who(from.con) + '：' + nm + ' を手札から除外した';
              else if (to.loc === LOC.DECK) s = this.who(from.con) + '：' + nm + ' を手札からデッキに戻した';
              else if (to.loc === LOC.EXTRA) s = this.who(from.con) + '：' + nm + ' を手札からEXデッキに戻した';
            } else if (from.loc === LOC.DECK) {
              if (to.loc === LOC.GRAVE) s = this.who(from.con) + '：' + nm + ' がデッキから墓地へ送られた';
              else if (to.loc === LOC.REMOVED) s = this.who(from.con) + '：' + nm + ' がデッキから除外された';
              else if (to.loc === LOC.HAND) s = this.who(from.con) + '：' + nm + ' をデッキから手札に加えた';
              else if (to.loc === LOC.EXTRA) s = this.who(from.con) + '：' + nm + ' がデッキからEXデッキへ送られた';
            } else if (from.loc === LOC.GRAVE) {
              if (to.loc === LOC.HAND) s = this.who(from.con) + '：' + nm + ' を墓地から手札に加えた';
              else if (to.loc === LOC.REMOVED) s = this.who(from.con) + '：' + nm + ' が墓地から除外された';
              else if (to.loc === LOC.DECK) s = this.who(from.con) + '：' + nm + ' が墓地からデッキに戻った';
              else if (to.loc === LOC.EXTRA) s = this.who(from.con) + '：' + nm + ' が墓地からEXデッキに戻った';
            } else if (from.loc === LOC.REMOVED) {
              if (to.loc === LOC.HAND) s = this.who(from.con) + '：除外されている ' + nm + ' を手札に加えた';
              else if (to.loc === LOC.GRAVE) s = this.who(from.con) + '：' + nm + ' が除外から墓地へ送られた';
              else if (to.loc === LOC.DECK) s = this.who(from.con) + '：' + nm + ' が除外からデッキに戻った';
            } else if (from.loc === LOC.EXTRA) {
              if (to.loc === LOC.GRAVE) s = this.who(from.con) + '：' + nm + ' がEXデッキから墓地へ送られた';
              else if (to.loc === LOC.REMOVED) s = this.who(from.con) + '：' + nm + ' がEXデッキから除外された';
              else if (to.loc === LOC.HAND) s = this.who(from.con) + '：' + nm + ' がEXデッキから手札に加わった';
            }
            if (s) this.pushDLog({ k: 'info', cid, sol, s });
          }
        }
        break;
      }
      case 90: { // DRAW: player, drawn u32, per card code u32 + pos u32
        const p = r.u8(); const n = r.u32(); const drawn = [];
        for (let i = 0; i < n; i++) { const code = r.u32(); r.u32(); drawn.push(code); this.players[p].hand.push({ code }); }
        this.players[p].deckCount = Math.max(0, this.players[p].deckCount - n);
        if (n > 0) {
          this.pushLog(this.who(p) + '：' + n + ' 枚ドロー');
          // Detailed: the human's own draws are named (their own
          // information); the opponent's stay count-only — the wire
          // knows the codes, the player must not.
          if (p === this.humanPlayer && drawn.every(c => c)) this.pushDLog({ k: 'info', cid: this.chainCid(), sol: this.solvingLink, s: this.who(p) + '：ドロー（' + drawn.map(c => this.nameOf(c)).join('、') + '）' });
          else this.pushDLog({ k: 'info', cid: this.chainCid(), sol: this.solvingLink, s: this.who(p) + '：' + n + ' 枚ドロー' });
        }
        break;
      }
      case 33: { // SHUFFLE_HAND: player, count u32, codes — exact new order
        const p = r.u8(); const n = r.u32(); const codes = [];
        for (let i = 0; i < n; i++) codes.push(r.u32());
        this.players[p].hand = codes.map(code => ({ code }));
        this.pushLog(this.who(p) + 'の手札をシャッフル（' + n + ' 枚）');
        // cid/sol stamped: a search effect shuffles the hand in
        // the middle of its own resolution — without the stamp the
        // line would split the chain episode's run in the sheet
        // (frame check: the searched spell's grave-send landed in
        // an orphan box behind the unstamped shuffle line).
        this.pushDLog({ k: 'info', cid: this.chainCid(), sol: this.solvingLink, s: this.who(p) + '：手札をシャッフル（' + n + ' 枚）' });
        break;
      }
      case 39: { // SHUFFLE_EXTRA: player, count u32, codes
        const p = r.u8(); const n = r.u32(); const extra = [];
        const prev = this.players[p].extra;
        const used = new Array(prev.length).fill(false);
        for (let i = 0; i < n; i++) {
          const code = r.u32();
          // Preserve per-copy overlay counts across the reorder (matched by
          // code, first unused copy first); counts are 0 except for a host
          // holding units, which only exists mid-summon-procedure.
          let mats = 0;
          for (let j = 0; j < prev.length; j++) if (!used[j] && prev[j].code === code) { used[j] = true; mats = prev[j].materials || 0; break; }
          extra.push({ code, pos: POS.FD_DEF, materials: mats });
        }
        if (n) this.players[p].extra = extra;
        break;
      }
      case 35: { // SWAP_GRAVE_DECK: player u8, u32 extra-size-before, u32 bitmapLen, bitmap
        // Duel.SwapDeckAndGrave (Exchange of the Spirit) swaps the player's
        // whole deck and graveyard with ONE message — there are no per-card
        // MOVEs. Payload after the player byte: the Extra Deck size before
        // extraction (informational), then a bitmap over the post-swap main
        // deck list (= the old graveyard, in grave order): a set bit marks a
        // card that is an Extra-Deck monster — the core pulls those OUT of
        // the new deck into the Extra Deck instead (field::swap_deck_and_grave
        // in the core source). The deck is shuffled right after (MSG_SHUFFLE_DECK).
        // Mirror update: the new deck count is old-grave minus the extracted
        // cards; the extracted cards join the extra pile with their known
        // codes; the new grave is the old deck — count known, identities not
        // (the deck was face-down), so it becomes unknown placeholders whose
        // codes the Duel layer refills from the core query at the next prompt
        // boundary (graveResync, cf. MSG_SHUFFLE_SET_CARD re-identification).
        // Ignoring this message leaves deckCount at the pre-swap value: the
        // split is wrong immediately, and as the real (larger) deck drains,
        // deckCount clamps at 0 while cards keep arriving elsewhere — the
        // player's total inflates permanently (reproduced: test-swap.js).
        const p = r.u8(); r.u32(); const blen = r.u32(); const buff = r.bytes(blen);
        const P = this.players[p];
        const oldGrave = P.grave;
        const oldDeckCount = P.deckCount;
        let extracted = 0;
        for (let i = 0; i < oldGrave.length; i++) {
          const bit = i < blen * 8 ? (buff[i >> 3] >> (i & 7)) & 1 : 0;
          if (bit) { extracted++; P.extra.push({ code: oldGrave[i], pos: POS.FD_DEF, materials: 0 }); }
        }
        P.deckCount = oldGrave.length - extracted;
        P.grave = new Array(oldDeckCount).fill(null);
        this.deckTop[p] = null;
        this.graveResync.add(p);
        this.pushLog(this.who(p) + '：デッキと墓地が入れ替わった');
        this.pushDLog({ k: 'info', cid: this.chainCid(), sol: this.solvingLink, s: this.who(p) + '：デッキと墓地が入れ替わった（デッキ ' + P.deckCount + ' 枚／墓地 ' + P.grave.length + ' 枚）' });
        break;
      }
      case 36: { // SHUFFLE_SET_CARD: loc u8, count u8, count from-loc_infos, count to-loc_infos
        // Duel.ShuffleSetCard (Morphing Jar #2 shuffles the monsters it just
        // set) and the group-set shuffle physically permute face-down cards
        // among their zones. The first loc_info list names the affected
        // slots; the second list, in the same card order, names each card's
        // post-shuffle slot — but an entry is an EMPTY loc_info unless the
        // card carries Xyz materials: for ordinary set cards the permutation
        // itself is deliberately not disclosed on the wire (neither player
        // may track which is which). Keeping the pre-shuffle code<->zone
        // pairing would record identities the core has since permuted
        // (observed live: a zone's MOVE-in code names one excavated monster
        // while the core's query and the later POS_CHANGE name another).
        // Exact pairs (material hosts) are moved as-is; every other affected
        // slot's code becomes unknown (0, flagged `shuffled`) until the Duel
        // layer's live query re-identifies it at a prompt boundary
        // (refreshFieldStats) or a later message names the card again —
        // cases 53/62 treat 0 as unknown and refill it.
        const loc = r.u8(); const ct = r.u8();
        const froms = []; for (let i = 0; i < ct; i++) froms.push(r.locInfo());
        const tos = []; for (let i = 0; i < ct; i++) tos.push(r.locInfo());
        const zoneOf = (li) => li.loc === LOC.MZONE ? this.players[li.con].mzone : this.players[li.con].szone;
        const before = froms.map(li => { const z = zoneOf(li); return z ? z[li.seq] : null; });
        const exactEntries = new Set();
        for (let i = 0; i < ct; i++) if (tos[i] && tos[i].loc !== 0 && before[i]) exactEntries.add(before[i]);
        const exactTargets = new Set();
        for (let i = 0; i < ct; i++) if (tos[i] && tos[i].loc !== 0) exactTargets.add(tos[i].con + '|' + tos[i].loc + '|' + tos[i].seq);
        for (let i = 0; i < ct; i++) {
          const li = froms[i]; const z = zoneOf(li); if (!z) continue;
          if (exactTargets.has(li.con + '|' + li.loc + '|' + li.seq)) continue;
          const e = z[li.seq];
          if (e && !exactEntries.has(e)) { e.code = 0; e.shuffled = true; }
        }
        for (let i = 0; i < ct; i++) {
          if (tos[i] && tos[i].loc !== 0 && before[i]) zoneOf(tos[i])[tos[i].seq] = before[i];
        }
        if (ct > 0) this.pushDLog({ k: 'info', cid: this.chainCid(), sol: this.solvingLink, s: 'セットカード ' + ct + ' 枚がシャッフルされた' });
        break;
      }
      case 32: break; // SHUFFLE_DECK: player only
      case 53: { // POS_CHANGE: code, con u8, loc u8, seq u8, prevPos u8, newPos u8
        const code = r.u32(); const con = r.u8(); const loc = r.u8(); const seq = r.u8(); const ppos = r.u8(); const npos = r.u8();
        const zone = loc === LOC.MZONE ? this.players[con].mzone : this.players[con].szone;
        // A stored code of 0 is "unknown", exactly like null: the core zeroes
        // codes on the wire for hidden cards (see case 62), so a POS_CHANGE
        // carrying the true code must fill a 0 as well as a null — and a
        // POS_CHANGE carrying 0 must never erase a known code.
        if (zone[seq]) { zone[seq].pos = npos; if (!zone[seq].code && code) zone[seq].code = code; }
        // Detailed: a position change is an outcome worth reading —
        // but only with a known identity (a hidden card's change is
        // the opponent's private information in form, if not in
        // fact: naming it would leak the set card).
        const known = code || (zone[seq] && zone[seq].code);
        if (ppos !== npos && known && !(con !== this.humanPlayer && (ppos & 0xA) && (npos & 0xA)))
          this.pushDLog({ k: 'info', cid: this.chainCid(), sol: this.solvingLink, s: this.who(con) + '：' + this.nameOf(known) + ' の表示形式が ' + posName(ppos) + ' → ' + posName(npos) });
        break;
      }
      case 54: case 60: case 62: case 64: { // SET / SUMMONING / SPSUMMONING / FLIPSUMMONING: code + loc_info
        // SPSUMMONING for a face-down special summon carries code 0 (the core
        // zeroes it); the monster's MOVE into the zone just before carried
        // the true code and the mirror recorded it. Rule for all four: a
        // non-zero announcement is authoritative, a 0 never overwrites a
        // known code (position still updates).
        const code = r.u32(); const li = r.locInfo();
        const zone = li.loc === LOC.MZONE ? this.players[li.con].mzone : this.players[li.con].szone;
        if (zone[li.seq]) { if (code !== 0) zone[li.seq].code = code; zone[li.seq].pos = li.pos; }
        else if (li.loc === LOC.MZONE) this.players[li.con].mzone[li.seq] = { code, pos: li.pos, materials: 0 };
        else this.players[li.con].szone[li.seq] = { code, pos: li.pos };
        if (t === 54) { this.pushLog(this.who(li.con) + '：カードをセット'); this.pushEvent({ kind: 'set', code, con: li.con, loc: li.loc }); }
        if (t === 60) { this.pushLog(this.who(li.con) + '：' + this.nameOf(code) + ' を召喚'); this.pushEvent({ kind: 'summon', code, con: li.con }); }
        if (t === 62) { this.pushLog(this.who(li.con) + '：' + this.nameOf(code) + ' を特殊召喚'); this.pushEvent({ kind: 'spsummon', code, con: li.con }); }
        if (t === 64) this.pushEvent({ kind: 'flipsummon', code, con: li.con });
        // Detailed versions. A set card is named only for its owner
        // (the opponent's set identity is hidden information; the
        // shared wire carries it but the history must not print it).
        // Summons are public events; a 0 code (face-down special
        // summon) falls back to whatever the zone entry already
        // knows, and stays generic while it knows nothing.
        if (t === 54) {
          this.pushDLog({ k: 'info', cid: this.chainCid(), sol: this.solvingLink, s: li.con === this.humanPlayer && code
            ? this.who(li.con) + '：' + this.nameOf(code) + ' をセット（' + posName(li.pos) + '）'
            : this.who(li.con) + '：カードをセット' });
        } else {
          const zc = (zone[li.seq] && zone[li.seq].code) || code;
          // A face-down summon of the opponent's stays unnamed even
          // when the mirror happens to know the code (the preceding
          // MOVE carried it) — hidden information is hidden.
          const nm = zc && (li.con === this.humanPlayer || !(li.pos & 0xA)) ? this.nameOf(zc) : null;
          const verb = t === 60 ? 'を召喚' : t === 62 ? 'を特殊召喚' : 'を反転召喚';
          this.pushDLog({ k: 'info', cid: this.chainCid(), sol: this.solvingLink, s: nm
            ? this.who(li.con) + '：' + nm + ' ' + verb + '（' + posName(li.pos) + '）'
            : this.who(li.con) + '：モンスター' + verb });
        }
        break;
      }
      case 55: { // SWAP: code1, info1, code2, info2 — control swap, cards stay in their slots
        const c1 = r.u32(); const i1 = r.locInfo(); const c2 = r.u32(); const i2 = r.locInfo();
        const z1 = i1.loc === LOC.MZONE ? this.players[i1.con].mzone : this.players[i1.con].szone;
        const z2 = i2.loc === LOC.MZONE ? this.players[i2.con].mzone : this.players[i2.con].szone;
        const tmp = z1[i1.seq]; z1[i1.seq] = z2[i2.seq]; z2[i2.seq] = tmp;
        // The entries themselves (with their codes) change slots above; these
        // corrective writes follow the same rule as everywhere else: a 0 on
        // the wire means "hidden", never an identity to overwrite with.
        if (z1[i1.seq] && c2) z1[i1.seq].code = c2;
        if (z2[i2.seq] && c1) z2[i2.seq].code = c1;
        this.pushDLog({ k: 'info', cid: this.chainCid(), sol: this.solvingLink, s: c1 && c2
          ? this.nameOf(c1) + ' と ' + this.nameOf(c2) + ' のコントロールが入れ替わった'
          : 'モンスターのコントロールが入れ替わった' });
        break;
      }
      case 70: { // CHAINING
        const code = r.u32(); const li = r.locInfo();
        const tcon = r.u8(); const tloc = r.u8(); const tseq = r.u32(); const desc = r.u64n(); r.u32();
        if (!this.chain.length) this.chainSeq++;
        this.chain.push({ code, con: li.con, loc: li.loc, seq: li.seq, pos: li.pos, player: tcon,
                          tloc, tseq, desc, negated: false, disabled: false, solved: false });
        this.pushLog('チェーン' + this.chain.length + '：' + this.nameOf(code));
        this.pushEvent({ kind: 'activate', code, con: li.con, loc: li.loc });
        // Detailed: the activation line of the episode. The wire's
        // target fields name the ACTIVATING card itself when the
        // effect has no target (observed on every non-targeting
        // activation in the pool) — self-reference means "no
        // target", never a target. A real target is named only
        // when it is public information: face-up on the field, in
        // a public pile (grave / banished), or the human's own
        // card. A targeted face-down card of the opponent's is
        // designated by slot in a real game, never by identity.
        let tgt = null;
        if (!(tcon === li.con && tloc === li.loc && tseq === li.seq)) {
          if (tloc === LOC.MZONE || tloc === LOC.SZONE) {
            const tz = tloc === LOC.MZONE ? this.players[tcon].mzone[tseq] : this.players[tcon].szone[tseq];
            if (tz && tz.code && ((tz.pos & POS_FACEUP) || tcon === this.humanPlayer)) tgt = this.nameOf(tz.code);
          } else if (tloc === LOC.GRAVE) {
            const gc = this.players[tcon].grave[tseq];
            if (gc) tgt = this.nameOf(gc);
          } else if (tloc === LOC.REMOVED) {
            const rc = this.players[tcon].removed[tseq];
            if (rc) tgt = this.nameOf(rc);
          } else if (tloc === LOC.HAND && tcon === this.humanPlayer) {
            const hc = this.players[tcon].hand[tseq];
            if (hc && hc.code) tgt = this.nameOf(hc.code);
          }
        }
        this.pushDLog({ k: 'act', cid: this.chainSeq, link: this.chain.length, con: li.con, code, desc, loc: li.loc, tgt });
        break;
      }
      case 72: { // CHAIN_SOLVING
        this.solvingLink = r.u8();
        const link = this.chain[this.solvingLink - 1];
        if (link) this.pushDLog({ k: 'solve', cid: this.chainSeq, link: this.solvingLink, con: link.con, code: link.code, desc: link.desc, loc: link.loc });
        break;
      }
      case 73: { const n = r.u8(); const link = this.chain[n - 1]; if (link) link.solved = true; break; } // CHAIN_SOLVED
      case 75: { const n = r.u8(); const link = this.chain[n - 1]; if (link) { link.negated = true; this.pushDLog({ k: 'neg', cid: this.chainSeq, link: n, con: link.con, code: link.code, desc: link.desc, loc: link.loc }); } this.pushEvent({ kind: 'negate' }); break; } // CHAIN_NEGATED
      case 76: { const n = r.u8(); const link = this.chain[n - 1]; if (link) { link.disabled = true; this.pushDLog({ k: 'dis', cid: this.chainSeq, link: n, con: link.con, code: link.code, desc: link.desc, loc: link.loc }); } break; } // CHAIN_DISABLED
      case 74: this.chain = []; this.solvingLink = 0; break; // CHAIN_END
      case 110: { // ATTACK: attacker loc_info, target loc_info (zeroed = direct)
        const a = r.locInfo(); const tg = r.locInfo();
        this.lastAttack = { attacker: a, target: tg.loc === 0 ? null : tg };
        const az = a.loc === LOC.MZONE ? this.players[a.con].mzone[a.seq] : null;
        const tz = tg.loc === LOC.MZONE ? this.players[tg.con].mzone[tg.seq] : null;
        // The log names attacker and target (W-16): a bare 「攻撃宣言」
        // left nothing searchable in the history after the fact.
        if (az && az.code) {
          const direct = tg.loc === 0 || !tz || !tz.code;
          this.pushLog(direct
            ? this.who(a.con) + '：' + this.nameOf(az.code) + ' が直接攻撃'
            : this.who(a.con) + '：' + this.nameOf(az.code) + ' が ' + this.nameOf(tz.code) + ' を攻撃');
          this.pushDLog({ k: 'info', s: direct
            ? this.who(a.con) + '：' + this.nameOf(az.code) + ' が直接攻撃を宣言'
            : this.who(a.con) + '：' + this.nameOf(az.code) + ' が ' + this.nameOf(tz.code) + ' に攻撃を宣言' });
        } else { this.pushLog('攻撃宣言'); this.pushDLog({ k: 'info', s: '攻撃宣言' }); }
        this.pushEvent({ kind: 'attack', code: az ? az.code : null, con: a.con, direct: tg.loc === 0 });
        break;
      }
      case 31: { // CONFIRM_CARDS: shownPlayer, count u32, entries code+con+loc+seq — reveal knowledge
        const shown = r.u8(); const n = r.u32();
        const confirmed = [];
        for (let i = 0; i < n; i++) {
          const code = r.u32(); const con = r.u8(); const loc = r.u8(); const seq = r.u32();
          confirmed.push({ code, con, loc, seq });
          if (shown === this.humanPlayer && code && loc === LOC.HAND && this.players[con].hand[seq]) this.players[con].hand[seq].code = code;
          if (shown === this.humanPlayer && loc === LOC.DECK && seq === this.players[con].deckCount - 1) this.deckTop[con] = code;
        }
        // A confirmation is information the SHOWN player is entitled to
        // read (Zolga the Prophet's look at the top 5 of BOTH decks is
        // the pool's example). Previously this message updated only the
        // mirror's knowledge — no event, no log — so the client could
        // never show WHAT was confirmed and the effect resolved
        // invisibly (at most the single top card surfaced later, buried
        // in the deck pile sheet). Forward the full entry list as an
        // event; the client presents it when shown === its human seat.
        // (Knowledge above is keyed to humanPlayer, not a hardcoded
        // seat 0: with the human on seat 1 the old condition tracked
        // the CPU's knowledge instead.)
        if (confirmed.length) {
          this.pushEvent({ kind: 'confirm', shown, cards: confirmed });
          if (shown === this.humanPlayer) {
            const names = confirmed.filter(c => c.code).map(c => this.nameOf(c.code));
            if (names.length) this.pushLog('確認：' + names.join('、'));
            // Detailed: whose cards, from where. Deck groups are
            // listed top-first (seq descending — the same order the
            // confirmation sheet presents).
            const groups = new Map();
            for (const c of confirmed) {
              if (!c.code) continue;
              const key = c.con + ':' + c.loc;
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key).push(c);
            }
            const LOCN = { 1: 'デッキ', 2: '手札', 4: 'フィールド', 8: 'フィールド', 16: '墓地', 32: '除外されているカード', 64: 'EXデッキ' };
            for (const [key, cs] of groups) {
              const [con, loc] = key.split(':').map(Number);
              if (loc === LOC.DECK) cs.sort((a, b) => b.seq - a.seq);
              this.pushDLog({ k: 'info', cid: this.chainCid(), sol: this.solvingLink, s: '確認：' + this.who(con) + ' の' + (LOCN[loc] || 'カード') + '（' + cs.map(c => this.nameOf(c.code)).join('、') + '）' });
            }
          }
        }
        break;
      }
      case 30: case 42: { // CONFIRM_DECKTOP / CONFIRM_EXTRATOP: player, count, codes...
        const p = r.u8(); const n = r.u32();
        let last = null; for (let i = 0; i < n; i++) last = r.u32();
        if (t === 30 && last != null) this.deckTop[p] = last;
        break;
      }
      case 38: { // DECK_TOP: player, seq u32, code, pos
        const p = r.u8(); r.u32(); const code = r.u32(); r.u32();
        this.deckTop[p] = code;
        break;
      }
      case 162: { // RELOAD_FIELD: counts + zone occupancy snapshot (arrives at duel start)
        r.u32(); // duel options
        for (let p = 0; p < 2; p++) {
          const P = this.players[p];
          P.lp = r.i32();
          for (let s = 0; s < 7; s++) { const has = r.u8(); if (has) { const pos = r.u8(); const mats = r.u32(); if (!P.mzone[s]) P.mzone[s] = { code: null, pos, materials: mats }; } }
          for (let s = 0; s < 8; s++) { const has = r.u8(); if (has) { const pos = r.u8(); r.u32(); if (!P.szone[s]) P.szone[s] = { code: null, pos }; } }
          P.deckCount = r.u32(); const handN = r.u32();
          const graveN = r.u32(); const remN = r.u32(); const extraN = r.u32(); r.u32();
          while (P.hand.length < handN) P.hand.push({ code: null });
          while (P.grave.length < graveN) P.grave.push(null);
          while (P.removed.length < remN) P.removed.push(null);
          if (P.extra.length > extraN) P.extra.length = extraN;
        }
        const chainN = r.u32();
        for (let i = 0; i < chainN; i++) { r.u32(); r.locInfo(); r.u8(); r.u8(); r.u32(); r.u64n(); }
        break;
      }
      default: break; // all other messages: not needed for the board mirror in this phase
    }
  }
  totalCards(p) {
    const P = this.players[p];
    return P.deckCount + (this.transit[p] || 0) + P.hand.length +
      P.extra.reduce((a, c) => a + 1 + (c.materials || 0), 0) +
      P.grave.length + P.removed.length +
      P.mzone.reduce((a, c) => a + (c ? 1 + (c.materials || 0) : 0), 0) +
      P.szone.reduce((a, c) => a + (c ? 1 : 0), 0);
  }
}

// ---------------------------------------------------------------- CPU policy
// Competent baseline opponent for the two decks in the pool, written fresh
// for this client in the spirit of the ygopro AI: evaluate only the current
// prompt's legal options with board/hand heuristics, never touch legality.
//
// FAIR INFORMATION: the core's local message stream carries real card codes
// for cards the bot seat cannot legally see (opponent hand contents,
// opponent face-down cards — playerop.cpp writes pcard->data.code into
// MSG_SELECT_CARD unconditionally, and MSG_DRAW/MSG_MOVE do the same into
// the shared mirror). Decisions therefore never read the raw state: every
// handler works on botView(), which masks hidden identities (opponent hand
// -> count only, opponent face-down cards -> code null), and prompt
// candidates are masked the same way before evaluation (maskEntry). The
// only decklist knowledge used is (a) the bot's OWN decklist — a player
// always knows their own deck — to compute what remains in its deck, and
// (b) for ANNOUNCE_CARD (Gravekeeper's Trap), the opponent's remaining deck
// estimated from PUBLIC zones only, mirroring what a human who knows the
// fixed opposing decklist could infer.
//
// Live ATK/DEF: mirror cells carry curAtk/curDef after Duel.refreshFieldStats
// (Duel.run refreshes before every bot answer; test harnesses do the same).
// When no live value is present the printed value is used — exact whenever
// no modifier applies.
//
// Termination: every prompt type is answered by a bounded strategy (see the
// per-handler notes, esp. SELECT_UNSELECT_CARD and SELECT_SUM); the policy
// never relies on the driver's stall guards.
const CT = { MONSTER: 0x1, SPELL: 0x2, TRAP: 0x4, EFFECT: 0x20, FUSION: 0x40, TUNER: 0x1000,
             SYNCHRO: 0x2000, QUICKPLAY: 0x10000, CONTINUOUS: 0x20000, FIELD: 0x80000,
             FLIP: 0x200000, XYZ: 0x800000, LINK: 0x4000000 };
const EXTRA_TYPES = CT.FUSION | CT.SYNCHRO | CT.XYZ | CT.LINK;
// Key cards of the pool (codes), named once for the heuristics below.
const CC = {
  MUDORA: 99937011, KELDO: 63542003, KELBEK: 25926710, AGIDO: 16135253, ZOLGA: 31525442,
  CARBON: 15079028, VERN_MORI: 36745317, VERN_HANA: 62133026, VERN_OKA: 9350312,
  CHAOS_POD: 79106360, SILKY: 55702233, SPHINX: 46148485, KALDAN: 86605515,
  HAND_DESTRUCTION: 16435215, TAIYOU: 38699854, MOON: 14087893, MISCHIEF: 51612489,
  REBELLION: 71593652, REBORN: 83764718, COROLLA: 14108995, FOOLISH_GOODS: 35726888,
  GK_TRAP: 98715423, EXCHANGE: 17484499, BLAST_HELD: 51208877, SPIRITUAL_SWORDS: 78625592,
  TITANOCIDER: 67037924, TRANSMIGRATION: 46652477,
  LUCE: 45409943, HORUS: 36898537, PLUTO: 37706769, BAROMETT: 62967433,
  HYPERION: 63101468, TRILOSUKTA: 21368273, CASTEL: 82633039, MINERVA: 30100551,
  SANGA: 25955164, HUGA: 62340868, SUIGA: 98434877, DARK_GUARDIAN: 26746975,
  HEAVY_TANK: 35026117, SHADOW_GHOUL: 62411811, SWAMP_KING: 45223540,
  MEDUSA_WORM: 2694423, CHAOS_HUNTER: 97940434,
  WALL_SHADOW: 34771947, TERRAFORMING: 73628505, FUSION_DEPLOYMENT: 6498706,
  DARK_ELEMENT: 53194323, FORCE_GUARDIAN: 96661780, DEMON_WIND: 60176682,
  SEVENTH_SWORD: 45725480, CONCEALING: 12923641, RAIGEKI: 12580477, METAVERSE: 89208725,
  JIRAI_TRAP: 33055499, GRAVE_HOLE: 31548215, SOLEMN_STRIKE: 40605147, LOST_WIND: 74003290,
  GG_COMBINED: 8505920, GG_THUNDERWIND: 34904525, GG_WINDWATER: 61398234, GG_WATERTHUNDER: 97783338,
};
const GUARDIAN_PIECES = [CC.SANGA, CC.HUGA, CC.SUIGA];
// Cards that PROFIT from being sent to / placed in the graveyard (mill
// triggers, grave searches, self-reset): cheap to discard, good to mill.
const GRAVE_PROFIT = new Set([CC.KELBEK, CC.BLAST_HELD, CC.LOST_WIND, CC.TITANOCIDER,
  CC.DARK_ELEMENT, CC.FORCE_GUARDIAN, CC.DEMON_WIND, CC.JIRAI_TRAP, CC.SHADOW_GHOUL, CC.REBELLION]);
const MILL_WHEN_SENT = new Set([CC.KELBEK]); // sent hand/deck -> GY: mill 5
// (v11 recipe swap: AGIDO is now the classic 《アギド》 — it has no
// mill/grave-profit effects; only its battle-destruction trigger.)
const NEGATION_CODES = new Set([CC.SOLEMN_STRIKE, CC.GRAVE_HOLE]);

function makeBotMemory() {
  return {
    summonedYet: false,   // legacy field of the old policy (kept for shape compatibility)
    oppFieldSnap: null,   // "seq:code" set of the opponent's face-up monsters at the previous bot prompt
    pendingSummon: null,  // {code, turn} — Extra/contact summon chosen at IDLECMD, for material picks
    pendingFusionSpell: 0,// turn on which 天至る叛逆 was activated (fusion flow in progress)
    lastAttacker: null,   // {seq, turn} — attacker chosen at BATTLECMD, for the target SELECT_CARD
    plannedTargetSeq: -1, // monster-zone seq the current attack was planned against
    unselectStreak: {},   // termination guard for SELECT_UNSELECT_CARD
    attempts: {},         // per-turn attempt counts for IDLECMD activations/summons (anti-cancel-loop)
  };
}

// ---------------------------------------------------------------- fair view
// Sanitized snapshot for decisions. Opponent hidden information is removed
// structurally: hand entries become {code:null}, face-down field cards lose
// their code and live stats, the opponent's Extra Deck is counts/face-up
// only, deck tops are dropped entirely.
function botView(state, me, data) {
  const opp = 1 - me;
  const P = state.players;
  const cell = (c, mine) => {
    if (!c) return null;
    const faceUp = (c.pos & POS_FACEUP) !== 0;
    const out = { pos: c.pos, faceUp, atkPos: (c.pos & POS_ATTACK) !== 0, materials: c.materials || 0, code: null };
    if (mine || faceUp) {
      out.code = c.code || null;
      out.curAtk = c.curAtk; out.curDef = c.curDef; out.curLevel = c.curLevel;
    }
    return out;
  };
  const zones = (p, mine) => ({
    mzone: P[p].mzone.map(c => cell(c, mine)),
    szone: P[p].szone.map(c => cell(c, mine)),
  });
  const decks = state.deckLists || null;
  return {
    me, opp, data,
    lp: [P[0].lp, P[1].lp],
    deckCount: [P[0].deckCount, P[1].deckCount],
    hand: [0, 1].map(p => P[p].hand.map(e => ({ code: p === me ? (e.code || null) : null }))),
    extra: [0, 1].map(p => P[p].extra.map(e => (p === me || (e.pos & POS_FACEUP))
      ? { code: e.code || null, pos: e.pos, materials: e.materials || 0 }
      : { code: null, pos: e.pos, materials: e.materials || 0 })),
    grave: [P[0].grave.slice(), P[1].grave.slice()],
    removed: [P[0].removed.slice(), P[1].removed.slice()],
    zones: [zones(0, me === 0), zones(1, me === 1)],
    turnPlayer: state.turnPlayer, turnCount: state.turnCount,
    phase: state.phase, phaseName: state.phaseName,
    chain: state.chain.map(l => ({ code: l.code, con: l.con, player: l.player, loc: l.loc, tloc: l.tloc, seq: l.seq, desc: l.desc })),
    lastAttack: state.lastAttack,
    myDeck: decks ? decks[me] : null,
    oppDeck: decks ? decks[opp] : null,
  };
}
// Prompt candidates get the same masking as the view: an entry pointing at
// an opponent card the bot may not see (hand, or face-down on the field)
// loses its code before any evaluation. Reveals created by an effect itself
// (墓穴の道連れ shows both hands) keep their codes — that knowledge is legal.
function maskEntry(e, view, ctxCode) {
  const me = view.me;
  if (e.con === me || e.con == null) return e;
  if (ctxCode === CC.HAND_DESTRUCTION) return e; // the effect itself reveals the hand
  if (e.loc === LOC.HAND || e.loc === LOC.DECK) return Object.assign({}, e, { code: null });
  if ((e.loc === LOC.MZONE || e.loc === LOC.SZONE) && e.pos != null && !(e.pos & POS_FACEUP))
    return Object.assign({}, e, { code: null });
  return e;
}

// The human seat gets the same fair-information treatment as the bot
// (user report 2026-11-04: a target-selection grid showed the
// opponent's face-down cards with their names and art). The core
// writes real codes into SELECT_* messages unconditionally (see the
// CPU policy header), and the bot path masks them before evaluation;
// the human path handed the raw prompt to the UI, which rendered
// whatever code it found. Before a prompt reaches the human
// answerer, every candidate pointing at a card the human may not see
// (opponent hand / deck, opponent face-down field or Extra card)
// loses its code, so the identity never reaches the UI layer at all.
// Answers are index-based, so masking changes nothing about WHAT may
// be chosen — only about what is shown. The driver's stored prompt
// (the MSG_RETRY path) stays pristine; masking re-applies to a copy
// on every ask. The one legal reveal exception is shared with the
// bot: 墓穴の道連れ shows both hands before its choices.
function maskPromptForHuman(prompt, state) {
  const ctxCode = prompt.context ? prompt.context.code : 0;
  const view = { me: prompt.player };
  const fix = (e) => {
    if (!e || typeof e !== 'object') return e;
    let x = e;
    // SELECT_TRIBUTE and the command lists carry no position on the
    // wire; recover the mirror's true position for field entries so
    // the face-down test judges the card as it actually lies — a
    // face-up card must stay visible, and pos 0 must not let a
    // face-down one slip through either.
    if ((x.loc === LOC.MZONE || x.loc === LOC.SZONE) && (x.pos == null || x.pos === 0) && state) {
      const P = state.players[x.con];
      const cell = P ? (x.loc === LOC.MZONE ? P.mzone[x.seq] : P.szone[x.seq]) : null;
      if (cell && cell.pos != null) x = Object.assign({}, x, { pos: cell.pos });
    }
    x = maskEntry(x, view, ctxCode);
    // maskEntry has no Extra Deck rule (the bot meets its candidates
    // through botView, which nulls hidden Extra cards); the human
    // prompt needs it stated: an opponent Extra card that is not
    // face-up is hidden information.
    if (x.code != null && x.con !== view.me && x.loc === LOC.EXTRA && x.pos != null && !(x.pos & POS_FACEUP))
      x = Object.assign({}, x, { code: null });
    return x;
  };
  const out = Object.assign({}, prompt);
  for (const k of ['cards', 'select', 'unselect', 'must', 'entries',
                   'summon', 'spsummon', 'repos', 'mset', 'sset', 'activate', 'attack'])
    if (Array.isArray(prompt[k])) out[k] = prompt[k].map(fix);
  return out;
}

// ---------------------------------------------------------------- valuation
function cdOf(data, code) { return code ? data.cards[code] : null; }
function isMonsterCd(cd) { return !!cd && (cd.type & CT.MONSTER) !== 0; }
function isExtraCd(cd) { return !!cd && (cd.type & EXTRA_TYPES) !== 0; }
function atkOf(cell, data) {
  if (!cell) return 0;
  if (cell.curAtk != null) return cell.curAtk;
  const cd = cdOf(data, cell.code);
  return cd ? cd.atk : 0;
}
function defOf(cell, data) {
  if (!cell) return 0;
  if (cell.curDef != null) return cell.curDef;
  const cd = cdOf(data, cell.code);
  return cd ? cd.def : 0;
}
function levelOf(cell, data) {
  if (!cell) return 0;
  if (cell.curLevel != null) return cell.curLevel;
  const cd = cdOf(data, cell.code);
  return cd ? (cd.level & 0xff) : 0;
}
// Battle strength of a face-up monster in its current position.
function battlePower(cell, data) { return cell.atkPos ? atkOf(cell, data) : defOf(cell, data); }
// Presence value of a monster on the field (ours: what we lose if it goes;
// opponent's: what we gain by removing it).
function boardValue(cell, data) {
  if (!cell) return 0;
  const cd = cdOf(data, cell.code);
  if (!cell.faceUp) return cd ? 450 + (cd.def || 0) * 0.25 : 500; // set monster: blind presence
  let v = battlePower(cell, data);
  if (isExtraCd(cd)) v += 150;
  v += (cell.materials || 0) * 120;
  if (cd && cd.code === CC.DARK_GUARDIAN) v += 500;   // battle-indestructible wall
  if (cd && cd.code === CC.GG_COMBINED) v += 300;
  return v;
}
function monList(view, p) {
  const out = [];
  view.zones[p].mzone.forEach((c, seq) => { if (c) out.push(Object.assign({ seq }, c)); });
  return out;
}
function faceUpMons(view, p) { return monList(view, p).filter(c => c.faceUp); }
function oppMaxPower(view, data) {
  let m = 0;
  for (const c of faceUpMons(view, view.opp)) m = Math.max(m, battlePower(c, data));
  return m;
}
function myStrongestAtk(view, data) {
  let m = 0;
  for (const c of faceUpMons(view, view.me)) if (c.atkPos) m = Math.max(m, atkOf(c, data));
  return m;
}
// What a card is worth in hand (keep-value). Discard decisions use
// discardCost() instead; this is the generic "how good is this card" scale.
function handValue(code, view, data) {
  const cd = cdOf(data, code);
  if (!cd) return 200;
  if (isMonsterCd(cd)) {
    let v = Math.max(cd.atk, cd.def * 0.72);
    if (cd.type & CT.TUNER) v += 120;
    if (code === CC.KELBEK) v += 150;
    if (GUARDIAN_PIECES.includes(code)) v += 180;
    if (code === CC.VERN_MORI || code === CC.VERN_HANA || code === CC.VERN_OKA) v += 220; // enablers
    if (code === CC.MUDORA || code === CC.KELDO) v += 200;
    if (code === CC.HEAVY_TANK) v += 250;
    if (code === CC.CHAOS_HUNTER) v += 150;
    return v;
  }
  const fixed = {
    [CC.RAIGEKI]: 1700, [CC.SOLEMN_STRIKE]: 1600, [CC.GRAVE_HOLE]: 1500, [CC.REBORN]: 1400,
    [CC.GK_TRAP]: 1100, [CC.FUSION_DEPLOYMENT]: 1050, [CC.DARK_ELEMENT]: 1200,
    [CC.CONCEALING]: 1250, [CC.MOON]: 950, [CC.FOOLISH_GOODS]: 950, [CC.TERRAFORMING]: 850,
    [CC.METAVERSE]: 850, [CC.SPIRITUAL_SWORDS]: 900, [CC.BLAST_HELD]: 1000,
    [CC.TITANOCIDER]: 950, [CC.LOST_WIND]: 900, [CC.TRANSMIGRATION]: 700,
    [CC.SEVENTH_SWORD]: 750, [CC.FORCE_GUARDIAN]: 800, [CC.DEMON_WIND]: 800,
    [CC.EXCHANGE]: 650, [CC.TAIYOU]: 550, [CC.COROLLA]: 600, [CC.REBELLION]: 700,
    [CC.HAND_DESTRUCTION]: 500, [CC.MISCHIEF]: 350, [CC.WALL_SHADOW]: 900, [CC.JIRAI_TRAP]: 700,
  };
  return fixed[code] != null ? fixed[code] : 500;
}
// Cost of giving this hand card up (discard / cost / banish from hand).
// LOW = give it up first. Cards that profit in the graveyard are cheap;
// duplicates and currently-dead cards are cheap; disruption is expensive.
function discardCost(code, view, data) {
  let v = handValue(code, view, data);
  if (GRAVE_PROFIT.has(code)) v -= 1400;
  if (MILL_WHEN_SENT.has(code)) v -= 250; // discarding Kelbek/Agido also mills: extra profit
  const handCodes = view.hand[view.me].map(e => e.code);
  if (handCodes.filter(c => c === code).length > 1) v -= 450; // duplicate
  if (GUARDIAN_PIECES.includes(code)) {
    const elsewhere = [...view.grave[view.me], ...view.removed[view.me],
      ...monList(view, view.me).map(c => c.code), ...view.zones[view.me].szone.map(c => c && c.code)];
    if (elsewhere.includes(code)) v -= 350; // this name is already secured elsewhere
  }
  if (code === CC.TAIYOU && !monList(view, view.me).some(c => !c.faceUp) &&
      !monList(view, view.opp).some(c => !c.faceUp)) v -= 300; // no face-downs to flip
  if (code === CC.COROLLA && !handCodes.some(c => c === CC.VERN_MORI || c === CC.VERN_HANA || c === CC.VERN_OKA)) v -= 250;
  if (code === CC.EXCHANGE && view.grave[view.me].length + view.grave[view.opp].length < 20) v -= 250; // far from live
  return v;
}
// Value of a card sitting in a graveyard (as a resource / as a threat).
function graveValue(code, data) {
  const cd = cdOf(data, code);
  if (!cd) return 100;
  let v = isMonsterCd(cd) ? Math.max(cd.atk, cd.def * 0.6) * 0.55 : 260;
  if (GRAVE_PROFIT.has(code)) v += 650;         // it still works from the grave
  if (MILL_WHEN_SENT.has(code)) v += 150;
  if (code === CC.EXCHANGE) v += 500;           // unlocks the Ishizu grave effects
  if (isExtraCd(cd)) v += 200;                  // revival target quality
  return v;
}
// Cards of `player` still possibly in their deck, computed from public
// information: own deck = own list minus everything of ours we can see;
// opponent deck = their list minus their PUBLIC zones (their hand cards are
// indistinguishable — they stay "possible", which is the honest estimate).
function remainingDeck(view, p, data) {
  const list = p === view.me ? view.myDeck : view.oppDeck;
  if (!list) return null;
  const counts = new Map();
  for (const c of list.main) counts.set(c, (counts.get(c) || 0) + 1);
  const sub = (code) => { if (code && counts.get(code) > 0) counts.set(code, counts.get(code) - 1); };
  if (p === view.me) {
    for (const e of view.hand[p]) sub(e.code);
    for (const c of monList(view, p)) sub(c.code);
    for (const c of view.zones[p].szone) sub(c && c.code);
  }
  for (const c of view.grave[p]) sub(c);
  for (const c of view.removed[p]) sub(c);
  for (const c of faceUpMons(view, p)) sub(c.code);
  for (const e of view.extra[p]) if (e.code && (e.pos & POS_FACEUP)) sub(e.code);
  return counts;
}
function deckHas(counts, code) { return !!counts && (counts.get(code) || 0) > 0; }

// ---------------------------------------------------------------- attacks
// Evaluate one attacker (ATK a) against one opposing monster cell.
// Returns a score (>0 worth doing) or -Infinity. Face-down targets are a
// gamble on the pool's DEF distribution (most set monsters are weak or
// flip monsters; the big DEF walls are 2200-3000).
function attackScore(view, data, a, t, myValue) {
  if (!t.faceUp) {
    if (a >= 2400) return 1000;
    if (a >= 2100) return 650;
    if (a >= 1800 && faceUpMons(view, view.opp).length === 0) return 250;
    return -Infinity;
  }
  const power = battlePower(t, data);
  const threat = boardValue(t, data);
  if (a > power) return threat + (t.atkPos ? (a - atkOf(t, data)) * 0.25 : 0);
  if (a === power && t.atkPos) return threat - myValue * 0.65; // trade: only if clearly ahead
  return -Infinity;
}
// All (attacker, target) pairs worth considering. attackers: [{seq, atk}].
// Direct attacks (targetSeq -1) are included when the entry allows them.
function attackPlans(view, data, attackers, directSeqs) {
  const targets = monList(view, view.opp);
  const plans = [];
  for (const at of attackers) {
    const myCell = view.zones[view.me].mzone[at.seq];
    const myValue = boardValue(myCell, data);
    if (directSeqs.has(at.seq)) plans.push({ seq: at.seq, atk: at.atk, targetSeq: -1, score: at.atk });
    for (const t of targets) {
      const s = attackScore(view, data, at.atk, t, myValue);
      if (s > -Infinity) plans.push({ seq: at.seq, atk: at.atk, targetSeq: t.seq, score: s });
    }
  }
  return plans;
}
// Lethal check: can the field be cleared and the remaining attackers deal
// >= the opponent's LP directly? Returns the first clearing attack to make
// (weakest sufficient attacker against the weakest clearable defender).
function lethalPlan(view, data, attackers) {
  const targets = monList(view, view.opp);
  if (!targets.length) return null;
  const defs = targets.map(t => ({ seq: t.seq, power: t.faceUp ? battlePower(t, data) : 1400, atkPos: t.atkPos, faceUp: t.faceUp }))
    .sort((x, y) => x.power - y.power);
  const atks = attackers.slice().sort((x, y) => x.atk - y.atk);
  const used = new Set();
  let first = null;
  for (const d of defs) {
    let pick = null;
    for (const a of atks) {
      if (used.has(a.seq)) continue;
      if (a.atk > d.power || (d.faceUp && d.atkPos && a.atk === d.power)) { pick = a; break; }
    }
    if (!pick) return null; // this defender cannot be cleared
    used.add(pick.seq);
    if (!first) first = { seq: pick.seq, atk: pick.atk, targetSeq: d.seq, score: 5000 };
  }
  let directDmg = 0;
  for (const a of attackers) if (!used.has(a.seq)) directDmg += a.atk;
  if (directDmg >= view.lp[view.opp]) return first;
  return null;
}
function hasProfitableAttack(view, data) {
  const attackers = faceUpMons(view, view.me).filter(c => c.atkPos && atkOf(c, data) > 0)
    .map(c => ({ seq: c.seq, atk: atkOf(c, data) }));
  if (!attackers.length) return false;
  // Empty opposing field: a direct attack can only gain LP differential —
  // the attacker survives it by definition — so ANY ready attacker makes
  // the battle phase worth entering, even below the 240 plan bar that
  // gates attacks into monsters. (Tuning round 2: the bar previously
  // kept the bot out of the battle phase entirely in exactly this spot.)
  if (monList(view, view.opp).length === 0) return true;
  const direct = new Set();
  if (lethalPlan(view, data, attackers)) return true;
  return attackPlans(view, data, attackers, direct).some(p => p.score >= 240);
}
// Would flipping / standing THIS monster up (it is currently face-down or
// in face-up defense position) create an attack worth making, judged by
// the same plan evaluation the battle phase itself uses? Against an
// empty opposing field any ATK > 0 qualifies (free direct damage, see
// hasProfitableAttack); otherwise the plan involving this monster must
// clear the usual 240 bar, or complete a lethal line.
function profitableAttackIfStood(view, data, cell) {
  const atk = atkOf(cell, data);
  if (atk <= 0) return false;
  const attackers = faceUpMons(view, view.me).filter(c => c.atkPos && atkOf(c, data) > 0)
    .map(c => ({ seq: c.seq, atk: atkOf(c, data) }));
  if (!attackers.some(a => a.seq === cell.seq)) attackers.push({ seq: cell.seq, atk });
  const oppEmpty = monList(view, view.opp).length === 0;
  if (lethalPlan(view, data, attackers)) return true;
  const direct = new Set(oppEmpty ? attackers.map(a => a.seq) : []);
  const bar = oppEmpty ? 1 : 240;
  return attackPlans(view, data, attackers, direct).some(p => p.seq === cell.seq && p.score >= bar);
}

// ---------------------------------------------------------------- main phase
// Score for firing one IDLECMD "activate" entry (0 = leave it). Entries are
// the bot's own cards only, so codes are always visible here.
// Wall Shadow ② / Heavy Tank ③: place a guardian piece from hand/deck/
// banished face-up in our S/T zone as a Continuous Spell. It is the Gate
// Guardian deck's fusion engine: a piece there is a face-up card on our
// field, so it is a legal material for the contact fusions (field
// materials) and for Dark Guardian's procedure (face-up field).
function guardianPlaceScore(view, data, rem, fieldUp, oppMons) {
  const me = view.me;
  const handCodes = view.hand[me].map(x => x.code);
  const pieceSomewhere = GUARDIAN_PIECES.some(g => deckHas(rem, g) || handCodes.includes(g) || view.removed[me].includes(g));
  if (!pieceSomewhere) return 0;
  return (fieldUp && oppMons.length) ? 1200 : 900;
}
function activationScore(e, view, data, prompt) {
  const me = view.me, opp = view.opp;
  const cd = cdOf(data, e.code);
  if (!cd) return 0;
  const myMons = monList(view, me), oppMons = monList(view, opp);
  const oppFU = faceUpMons(view, opp);
  const handCodes = view.hand[me].map(x => x.code);
  const rem = remainingDeck(view, me, data);
  const fieldUp = (() => { const f = view.zones[me].szone[5]; return !!(f && f.faceUp); })();
  const ggOnField = faceUpMons(view, me).some(c => isExtraCd(cdOf(data, c.code)) || c.code === CC.DARK_GUARDIAN);
  const bestGraveMonster = Math.max(0, ...view.grave[me].concat(view.grave[opp])
    .map(c => { const d = cdOf(data, c); return isMonsterCd(d) ? d.atk : 0; }));
  switch (e.code) {
    case CC.RAIGEKI: {
      if (oppMons.length >= 2) return 1600;
      if (oppMons.length === 1 && oppFU.length === 1 &&
          (battlePower(oppFU[0], data) >= 2200 || isExtraCd(cdOf(data, oppFU[0].code)))) return 1300;
      return 0;
    }
    case CC.CONCEALING: {
      const tot = oppFU.reduce((s, c) => s + battlePower(c, data), 0);
      if (oppFU.length >= 2 && tot >= 3000) return 1400;
      if (oppFU.length === 1 && battlePower(oppFU[0], data) >= 2600) return 1100;
      return 0;
    }
    case CC.TERRAFORMING:
      return (!fieldUp && deckHas(rem, CC.WALL_SHADOW)) ? 1000 : 0;
    case CC.METAVERSE:
      return (!fieldUp && deckHas(rem, CC.WALL_SHADOW)) ? 1000 : 0;
    case CC.WALL_SHADOW:
      // From hand: activating the field spell itself. From the field zone
      // the entry is its ② — the guardian-piece placement scored below
      // with Heavy Tank's ③ (an earlier version of this case returned
      // `fieldUp ? 0 : 1050` for EVERY Wall Shadow entry, which silently
      // scored the face-up spell's own ② at 0 forever: the first matching
      // case in the switch wins, so the placement case never ran).
      if (e.loc !== LOC.SZONE) return fieldUp ? 0 : 1050;
      return guardianPlaceScore(view, data, rem, fieldUp, oppMons);
    case CC.FOOLISH_GOODS: {
      if (deckHas(rem, CC.EXCHANGE) && !view.grave[me].includes(CC.EXCHANGE)) return 1050;
      if (deckHas(rem, CC.DARK_ELEMENT) && !handCodes.includes(CC.DARK_ELEMENT)) return 1000;
      for (const g of [CC.FORCE_GUARDIAN, CC.DEMON_WIND, CC.JIRAI_TRAP])
        if (deckHas(rem, g) && !handCodes.includes(g)) return 850;
      if (deckHas(rem, CC.LOST_WIND)) return 550;
      return 0;
    }
    case CC.FUSION_DEPLOYMENT:
      return (myMons.length <= 1 || myStrongestAtk(view, data) < 2400) ? 1050 : 800;
    case CC.DARK_ELEMENT: {
      if (myStrongestAtk(view, data) >= 3000) return 0;
      if (view.lp[me] >= 3200) return 1500;
      if (view.lp[me] >= 2000 && myStrongestAtk(view, data) < 2000) return 1200;
      return 0;
    }
    case CC.SEVENTH_SWORD: {
      const lv7 = view.hand[me].filter(x => { const d = cdOf(data, x.code); return isMonsterCd(d) && (d.level & 0xff) === 7; });
      if (lv7.length >= 2) return 900;
      const summonable = view.hand[me].some(x => { const d = cdOf(data, x.code); return isMonsterCd(d) && (d.level & 0xff) <= 4; });
      if (lv7.length === 1 && myMons.length === 0 && !summonable) return 950; // dead card -> 2 draws
      if (lv7.length === 1 && view.grave[me].includes(lv7[0].code)) return 800;
      return 0;
    }
    case CC.FORCE_GUARDIAN:
      return ggOnField && myStrongestAtk(view, data) >= 2000 ? 1250 : 0;
    case CC.DEMON_WIND: {
      if (!ggOnField) return 0;
      return oppFU.some(c => battlePower(c, data) >= 1800) || view.zones[opp].szone.some(c => c && c.faceUp) ? 1200 : 0;
    }
    case CC.HAND_DESTRUCTION: {
      const others = handCodes.filter(c => c !== CC.HAND_DESTRUCTION);
      const graveFriendly = others.filter(c => GRAVE_PROFIT.has(c) || MILL_WHEN_SENT.has(c)).length;
      return others.length >= 2 && graveFriendly * 2 >= others.length ? 650 : 0;
    }
    case CC.REBORN:
      if (bestGraveMonster >= 2100 && (myStrongestAtk(view, data) < bestGraveMonster || myMons.length <= 1)) return 1250;
      return bestGraveMonster >= 2600 ? 1100 : 0;
    case CC.EXCHANGE: {
      if (view.lp[me] <= 1200) return 0;
      if (view.deckCount[me] <= 16) return 1400;
      if (view.deckCount[opp] <= 10) return 0; // don't hand them a fresh deck
      return view.deckCount[me] <= view.deckCount[opp] ? 800 : 0;
    }
    case CC.GK_TRAP: {
      const cellTrap = view.zones[me].szone[e.seq];
      if (cellTrap && !cellTrap.faceUp) return view.grave[opp].length >= 4 ? 1100 : 950; // flip it face-up
      // ② search: needs a spare discard and a reason to dig
      const cheapest = Math.min(...handCodes.filter(c => c !== CC.GK_TRAP).map(c => discardCost(c, view, data)), Infinity);
      if (cheapest > 800) return 0;
      if (myMons.length <= 2 || myStrongestAtk(view, data) < 1800) return 1000;
      return view.hand[me].length >= 5 ? 700 : 0;
    }
    case CC.MUDORA: case CC.KELDO: {
      if (e.loc === LOC.HAND) {
        const others = handCodes.filter(c => c !== e.code);
        if (!others.length) return 0;
        if (others.some(c => MILL_WHEN_SENT.has(c))) return 1250; // discard mills for free
        const cheapest = Math.min(...others.map(c => discardCost(c, view, data)));
        return cheapest <= 700 ? 1050 : 0;
      }
      // ② graveyard shuffle (field/grave copy, ignition timing in main)
      const topOpp = view.grave[opp].map(c => graveValue(c, data)).sort((a, b) => b - a);
      return (topOpp[0] || 0) + (topOpp[1] || 0) >= 1500 ? 850 : 0;
    }
    case CC.VERN_MORI: case CC.VERN_HANA: case CC.VERN_OKA: {
      const gyEarth = view.grave[me].some(c => { const d = cdOf(data, c); return isMonsterCd(d) && d.attribute === 0x01; });
      const handEarth = handCodes.some(c => { const d = cdOf(data, c); return isMonsterCd(d) && d.attribute === 0x01 && c !== e.code; });
      if (view.hand[me].length < 2) return 0;
      if (e.code === CC.VERN_HANA) return gyEarth ? 1100 : 0;
      if (e.code === CC.VERN_OKA) {
        // unique part is a deck search for any Vernusylph card:
        // worth firing for the search alone, better with a revive.
        if (gyEarth) return 1100;
        return handEarth ? 900 : 700;
      }
      if (gyEarth) return 1150;
      return handEarth && deckHas(rem, CC.KELBEK) !== false ? 950 : 0; // discard becomes the revive target pool
    }
    case CC.CARBON: {
      if (!prompt.summon.length) return 0; // normal summon already spent
      const hasTarget = rem ? [...rem.keys()].some(c => { const d = cdOf(data, c); return d && d.race === 0x4 && d.attribute === 0x01 && (d.level & 0xff) === 4 && d.atk > 1400; })
                            : true;
      return hasTarget ? 800 : 0;
    }
    case CC.SPHINX:
      return (deckHas(rem, CC.TAIYOU) || deckHas(rem, CC.MOON) ||
              view.grave[me].includes(CC.TAIYOU) || view.grave[me].includes(CC.MOON)) ? 750 : 0;
    case CC.COROLLA:
      return handCodes.some(c => c === CC.VERN_MORI || c === CC.VERN_HANA || c === CC.VERN_OKA) ? 800 : 0;
    case CC.TAIYOU: {
      const pod = myMons.find(c => !c.faceUp && c.code === CC.CHAOS_POD);
      const worm = myMons.find(c => !c.faceUp && c.code === CC.MEDUSA_WORM);
      const myTot = faceUpMons(view, me).reduce((s, c) => s + battlePower(c, data), 0);
      const oppTot = oppFU.reduce((s, c) => s + battlePower(c, data), 0);
      if (pod && oppTot - myTot >= 1800) return 1300;
      if (worm && oppFU.length) return 1200;
      return 0;
    }
    case CC.MOON: {
      const best = myStrongestAtk(view, data);
      const wall = oppFU.find(c => battlePower(c, data) > best && defOf(c, data) < best);
      if (wall && best >= 1500) return 1000;
      if (oppFU.some(c => atkOf(c, data) >= 2600)) return 650;
      return 0;
    }
    case CC.MISCHIEF:
      return monList(view, opp).some(c => !c.faceUp) && myStrongestAtk(view, data) >= 1800 ? 500 : 0;
    case CC.REBELLION: {
      if (e.loc === LOC.HAND) {
        const mats = view.grave[me].filter(c => { const d = cdOf(data, c); return d && (d.race === 0x8 || d.race === 0x4); }).length;
        const luceReady = view.extra[me].some(x => x.code === CC.LUCE);
        return mats >= 3 && luceReady ? 1350 : 0;
      }
      if (e.loc === LOC.GRAVE) {
        const mats = view.grave[me].filter(c => { const d = cdOf(data, c); return d && (d.race === 0x8 || d.race === 0x4); }).length;
        const cheap = handCodes.some(c => { const d = cdOf(data, c); return d && (d.race === 0x8 || d.race === 0x4) && discardCost(c, view, data) <= 600; });
        return mats >= 2 && cheap ? 600 : 0;
      }
      return 0;
    }
    case CC.JIRAI_TRAP:
      return (myMons.length === 0 || myStrongestAtk(view, data) < 2100) ? 1000 : 400;
    case CC.TITANOCIDER: {
      if (oppFU.some(c => isExtraCd(cdOf(data, c.code)) && atkOf(c, data) >= 1900)) return 1050;
      return oppFU.some(c => atkOf(c, data) >= 2300) ? 800 : 0;
    }
    case CC.LOST_WIND:
      return oppFU.some(c => isExtraCd(cdOf(data, c.code)) && atkOf(c, data) >= 1700) ? 950 : 0;
    case CC.TRANSMIGRATION: {
      const topOpp = view.grave[opp].map(c => graveValue(c, data)).sort((a, b) => b - a);
      return (topOpp[0] || 0) + (topOpp[1] || 0) >= 1700 ? 800 : 0;
    }
    case CC.CASTEL:
      return oppFU.some(c => battlePower(c, data) >= 1800) ? 1150 : 0;
    case CC.PLUTO:
      return oppFU.some(c => { const d = cdOf(data, c.code); return d && (d.type & CT.EFFECT) && atkOf(c, data) >= 1800; }) ? 1000 : 0;
    case CC.LUCE:
      if (oppFU.some(c => battlePower(c, data) >= 1800)) return 1200;
      return view.zones[opp].szone.some(c => c && c.faceUp) ? 800 : 0;
    case CC.BAROMETT: {
      const hasNormalTrap = view.grave[me].some(c => { const d = cdOf(data, c); return d && (d.type & CT.TRAP) && !(d.type & CT.CONTINUOUS) && !(d.type & 0x100000); });
      return hasNormalTrap ? 950 : 0;
    }
    case CC.MINERVA:
      return view.deckCount[me] > 10 ? 900 : (view.deckCount[me] > 6 ? 500 : 0);
    case CC.HYPERION: // ① copy an "Agent" — only Pluto qualifies in this pool
      return (view.grave[me].includes(CC.PLUTO) || handCodes.includes(CC.PLUTO)) ? 700 : 0;
    case CC.HEAVY_TANK: // ③ from the field: the same guardian-piece placement as Wall Shadow ②
      return guardianPlaceScore(view, data, rem, fieldUp, oppMons);
    case CC.SHADOW_GHOUL: {
      if (e.loc !== LOC.HAND) return 0;
      return (!fieldUp && !handCodes.includes(CC.WALL_SHADOW) && deckHas(rem, CC.WALL_SHADOW)) ? 950 : 0;
    }
    case CC.SWAMP_KING: {
      if (e.loc !== LOC.HAND) return 0;
      if (handCodes.some(c => GUARDIAN_PIECES.includes(c))) return 850;
      return myMons.length === 0 ? 600 : 0;
    }
    case CC.GG_THUNDERWIND: // ① search a card naming all three guardians
      return e.loc === LOC.MZONE ? 1000 : 0;
    case CC.GG_WATERTHUNDER: // ① zero an opposing monster's ATK
      return oppFU.some(c => atkOf(c, data) >= 2000) ? 1000 : 0;
    case CC.MEDUSA_WORM: // flip itself face-down to re-arm the flip destruction
      return (e.loc === LOC.MZONE && oppMaxPower(view, data) > 700) ? 650 : 0;
    default:
      return 0;
  }
}
// Extra-Deck / procedure special summon evaluation. Returns the entry index
// to take, or -1. Material costs are estimated from the visible board; the
// follow-up material SELECT_CARD is answered by the material logic, which
// re-derives the cheapest legal combination from the actual candidates.
function pickSpsummon(prompt, view, data, mem) {
  const me = view.me;
  // A guardian piece can be a field material from TWO places: the monster
  // zone, or the S/T zone, where Wall Shadow ② / Heavy Tank ③ park it
  // face-up as a Continuous Spell. Both are face-up cards on our field
  // for the Gate Guardian contact fusions and for Dark Guardian's
  // procedure. An earlier version only looked in the monster zone, so a
  // placed piece counted as "missing" and every fusion built on placed
  // pieces was declined unseen. An S/T piece has no battle presence:
  // flat card-value cost, zero battle power for the veto below.
  const fieldPiece = (piece, needFaceUp) => {
    const m = monList(view, me).find(c => c.code === piece && (!needFaceUp || c.faceUp));
    if (m) return { cost: boardValue(m, data), power: battlePower(m, data) };
    const s = view.zones[me].szone.find(c => c && c.faceUp && c.code === piece);
    if (s) return { cost: 400, power: 0 };
    return null;
  };
  let best = -1, bestGain = 249;
  prompt.spsummon.forEach((e, i) => {
    const cd = cdOf(data, e.code);
    if (!cd || !isMonsterCd(cd)) return;
    const bonus = { [CC.CASTEL]: 650, [CC.MINERVA]: 500, [CC.BAROMETT]: 450, [CC.LUCE]: 500,
      [CC.HYPERION]: 250, [CC.PLUTO]: 450, [CC.TRILOSUKTA]: 400, [CC.HORUS]: 150,
      [CC.GG_COMBINED]: 350 }[e.code] || 200;
    let cost = null;
    if (e.loc === LOC.EXTRA && (cd.type & CT.XYZ)) {
      const rank = cd.level & 0xff;
      const mats = faceUpMons(view, me).concat(monList(view, me).filter(c => !c.faceUp))
        .filter(c => levelOf(c, data) === rank).sort((a, b) => boardValue(a, data) - boardValue(b, data));
      if (mats.length >= 2) cost = boardValue(mats[0], data) + boardValue(mats[1], data);
    } else if (e.loc === LOC.EXTRA && (cd.type & CT.SYNCHRO)) {
      const lvl = cd.level & 0xff;
      const field = monList(view, me);
      let bestCombo = Infinity;
      const n = field.length;
      for (let mask = 1; mask < (1 << n); mask++) {
        let sum = 0, hasTuner = false, c = 0;
        for (let j = 0; j < n; j++) if (mask & (1 << j)) {
          sum += levelOf(field[j], data);
          const d = cdOf(data, field[j].code);
          if (d && (d.type & CT.TUNER)) hasTuner = true;
          c += boardValue(field[j], data);
        }
        if (hasTuner && sum === lvl && c < bestCombo) bestCombo = c;
      }
      if (bestCombo < Infinity) cost = bestCombo;
    } else if (e.loc === LOC.EXTRA && (cd.type & CT.FUSION)) {
      // Gate Guardian contact fusions: named pieces, locations decide the cost.
      const needs = e.code === CC.GG_COMBINED ? GUARDIAN_PIECES
        : e.code === CC.GG_THUNDERWIND ? [CC.SANGA, CC.HUGA]
        : e.code === CC.GG_WINDWATER ? [CC.HUGA, CC.SUIGA]
        : e.code === CC.GG_WATERTHUNDER ? [CC.SUIGA, CC.SANGA] : null;
      if (!needs) { cost = 600; } // unknown fusion (e.g. via substitution): modest flat cost
      else {
        cost = 0;
        for (const piece of needs) {
          const fp = fieldPiece(piece, false);
          const inHand = view.hand[me].some(x => x.code === piece);
          const inGrave = view.grave[me].includes(piece);
          const fieldOnly = e.code !== CC.GG_COMBINED;
          if (fp) cost += fp.cost;
          else if (!fieldOnly && inGrave) cost += 250;
          else if (!fieldOnly && inHand) cost += handValue(piece, view, data) * 0.35;
          else { cost = null; break; }
        }
        // two-piece field fusions trade ~5000 ATK of board for ~2500: only
        // when the pieces are already weakened (halved/zeroed effects).
        // Pieces parked in the S/T zone contribute no battle power, so a
        // fusion built on them is nearly free and never vetoed here.
        if (cost != null && e.code !== CC.GG_COMBINED) {
          const piecePower = needs.reduce((s, piece) => {
            const fp = fieldPiece(piece, false);
            return s + (fp ? fp.power : 0);
          }, 0);
          if (piecePower > cd.atk + 400) cost = null;
        }
      }
    } else if (e.code === CC.DARK_GUARDIAN) {
      // procedure: return the three guardians (hand/face-up field/grave/removed) to the deck
      cost = 0;
      for (const piece of GUARDIAN_PIECES) {
        const fp = fieldPiece(piece, true); // procedure says face-up field
        if (fp) cost += fp.cost;
        else if (view.grave[me].includes(piece) || view.removed[me].includes(piece)) cost += 250;
        else if (view.hand[me].some(x => x.code === piece)) cost += handValue(piece, view, data) * 0.35;
        else { cost = null; break; }
      }
      if (cost != null && cost > 2600) cost = null;
    } else if (e.loc === LOC.HAND || e.loc === LOC.GRAVE) {
      cost = cd.atk >= 1500 ? 200 : null;
    }
    if (cost == null) return;
    const gain = cd.atk + bonus - cost;
    if (gain > bestGain) { bestGain = gain; best = i; }
  });
  if (best >= 0) mem.pendingSummon = { code: prompt.spsummon[best].code, turn: view.turnCount };
  return best;
}
// Normal summon / set decision. Returns {kind, idx} into prompt.summon /
// prompt.mset, or null.
function pickSummon(prompt, view, data) {
  const me = view.me;
  const oppPow = oppMaxPower(view, data);
  const myField = monList(view, me);
  const weakestField = myField.slice().sort((a, b) => boardValue(a, data) - boardValue(b, data));
  let best = null;
  const consider = (kind, e, i) => {
    const cd = cdOf(data, e.code);
    if (!cd || !isMonsterCd(cd)) return;
    const lvl = cd.level & 0xff;
    const isFlip = (cd.type & CT.FLIP) !== 0 || e.code === CC.CHAOS_POD || e.code === CC.MEDUSA_WORM;
    if (kind === 'summon') {
      if (isFlip) return; // flip monsters are set, never summoned face-up
      let tributes = lvl <= 4 ? 0 : lvl <= 6 ? 1 : 2;
      if (e.code === CC.HEAVY_TANK) tributes = 0;
      if (weakestField.length < tributes) return;
      let cost = 0;
      for (let k = 0; k < tributes; k++) cost += boardValue(weakestField[k], data);
      // setting instead when the wall clearly survives and the attacker wouldn't
      if (oppPow > cd.atk && cd.def >= oppPow && prompt.mset.some(m => m.code === e.code)) return;
      let gain = cd.atk - cost * 0.85;
      if (e.code === CC.KALDAN && view.hand[me].concat(view.grave[me]).some(c =>
          { const d = cdOf(data, c.code !== undefined ? c.code : c); return d && (d.type & CT.TRAP) && (d.type & CT.CONTINUOUS); })) gain += 250;
      if (e.code === CC.HEAVY_TANK) gain += 150;
      if (gain > 150 && (!best || gain > best.gain)) best = { kind, idx: i, gain };
    } else { // mset — a Tribute Set of a level 5+ monster costs the same
      // tributes as a Tribute Summon (the core asks SELECT_TRIBUTE for it);
      // the cost must be charged here too. Without it the bot kept
      // "setting" guardian pieces by tributing its whole board — e.g. its
      // only attacker — for a face-down wall (measured in test-cpu-tune).
      let tributes = lvl <= 4 ? 0 : lvl <= 6 ? 1 : 2;
      if (e.code === CC.HEAVY_TANK) tributes = 0;
      if (weakestField.length < tributes) return;
      let cost = 0;
      for (let k = 0; k < tributes; k++) cost += boardValue(weakestField[k], data);
      let gain = cd.def * 0.8 - cost * 0.85;
      if (isFlip) gain += e.code === CC.CHAOS_POD ? 500 : 750;
      if (oppPow > cd.atk && cd.def >= oppPow) gain += 250; // safe wall
      if (gain > 150 && (!best || gain > best.gain)) best = { kind, idx: i, gain };
    }
  };
  prompt.summon.forEach((e, i) => consider('summon', e, i));
  prompt.mset.forEach((e, i) => consider('mset', e, i));
  return best;
}

// ---------------------------------------------------------------- chains
// Value of firing one SELECT_CHAIN entry now (0 = pass). The core only
// offers currently-legal activations, so an offered reactive card means its
// timing condition is live; the judgment here is purely "is it worth it".
function chainEntryValue(e, view, data, mem) {
  const me = view.me, opp = view.opp;
  const chain = view.chain;
  const top = chain[chain.length - 1];
  const topOpp = top && top.player === opp ? top : null;
  const below = chain[chain.length - 2];
  const chainWar = !!(topOpp && below && below.player === me &&
    (NEGATION_CODES.has(top.code) || top.code === CC.HYPERION || top.code === CC.GG_WINDWATER || top.code === CC.GG_COMBINED));
  const topCd = topOpp ? cdOf(data, topOpp.code) : null;
  const topThreat = topCd ? (isMonsterCd(topCd) ? Math.max(topCd.atk, handValue(topOpp.code, view, data)) : handValue(topOpp.code, view, data)) : 0;
  const isOppBattle = view.turnPlayer === opp && /BATTLE|DAMAGE/.test(view.phaseName);
  const la = view.lastAttack;
  const atkCell = (isOppBattle && la && la.attacker.con === opp) ? view.zones[opp].mzone[la.attacker.seq] : null;
  // damage / destruction the current attack would inflict on us
  let atkDmg = 0, myMonDies = false, myMonValue = 0;
  if (atkCell) {
    const a = atkOf(atkCell, data);
    if (!la.target) atkDmg = a;
    else {
      const t = view.zones[me].mzone[la.target.seq];
      if (t) {
        myMonValue = boardValue(t, data);
        if (t.atkPos) { atkDmg = Math.max(0, a - atkOf(t, data)); myMonDies = a > atkOf(t, data); }
        else myMonDies = a > defOf(t, data);
      }
    }
  }
  const newBigOpp = (mem.newOppSeqs || []).map(s => view.zones[opp].mzone[s])
    .filter(c => c && c.faceUp).sort((x, y) => atkOf(y, data) - atkOf(x, data))[0] || null;
  switch (e.code) {
    case CC.SOLEMN_STRIKE: {
      if (view.lp[me] <= 1600) return 0;
      if (chainWar) return 1500;
      if (topOpp && isMonsterCd(topCd) && (topThreat >= 1800 || isExtraCd(topCd))) return view.lp[me] >= 2400 ? 1500 : 0;
      if (!chain.length && newBigOpp) { // summon-negation window
        const a = atkOf(newBigOpp, data);
        if ((a >= 2200 || (isExtraCd(cdOf(data, newBigOpp.code)) && a >= 2000)) && view.lp[me] >= 2400) return 1500;
      }
      return 0;
    }
    case CC.GRAVE_HOLE: {
      if (topOpp && isMonsterCd(topCd) && (topOpp.tloc === LOC.HAND || topOpp.tloc === LOC.GRAVE || topOpp.tloc === LOC.REMOVED))
        return view.lp[opp] <= 2000 ? 3000 : 2000; // negate + 2000 burn
      return 0;
    }
    case CC.HYPERION: { // ② banish a Fairy from hand/grave: negate-and-banish an opposing effect
      const hasFairy = view.hand[me].some(x => { const d = cdOf(data, x.code); return d && d.race === 0x4; }) ||
                       view.grave[me].some(c => { const d = cdOf(data, c); return d && d.race === 0x4; });
      if (!hasFairy || !topOpp) return 0;
      if (chainWar) return 1500;
      if (isMonsterCd(topCd) && topThreat >= 2000) return 1400;
      if (topOpp.code === CC.RAIGEKI || topOpp.code === CC.CONCEALING || topOpp.code === CC.DEMON_WIND) return 1400;
      return 0;
    }
    case CC.GG_COMBINED: // ① negate an effect that targets our card (offered only then)
      return topOpp ? 1350 : 0;
    case CC.GG_WINDWATER: { // ① negate an opposing field spell/trap effect
      if (!topOpp) return 0;
      if ([CC.RAIGEKI, CC.CONCEALING, CC.DEMON_WIND, CC.FORCE_GUARDIAN].includes(topOpp.code)) return 1500;
      if (topOpp.code === CC.REBORN && bestGraveAtk(view, data) >= 2200) return 1100;
      return 0;
    }
    case CC.GG_WATERTHUNDER: { // ① zero an opposing monster's ATK
      if (atkCell && atkOf(atkCell, data) >= 1800) return 1350;
      const big = faceUpMons(view, opp).sort((x, y) => atkOf(y, data) - atkOf(x, data))[0];
      return big && atkOf(big, data) >= 2200 ? 1100 : 0;
    }
    case CC.SPIRITUAL_SWORDS: {
      if (!atkCell) return 0;
      if (atkDmg >= view.lp[me] && view.lp[me] > 1000) return 1600; // stops lethal
      return ((atkDmg >= 1200 || (myMonDies && myMonValue >= 1300)) && view.lp[me] > 1400) ? 1400 : 0;
    }
    case CC.BLAST_HELD: {
      if (!atkCell) return 0;
      const big = faceUpMons(view, opp).sort((x, y) => (cdOf(data, y.code) ? cdOf(data, y.code).atk : 0) - (cdOf(data, x.code) ? cdOf(data, x.code).atk : 0))[0];
      if (!big) return 0;
      const bigOrig = cdOf(data, big.code) ? cdOf(data, big.code).atk : 0; // burn is the ORIGINAL atk
      const selfBurn = !view.grave[me].includes(CC.EXCHANGE);
      if (bigOrig >= view.lp[opp] && (!selfBurn || bigOrig < view.lp[me])) return 2000; // lethal burn
      if (bigOrig >= 2300) return 1400;
      if (bigOrig >= 1900 && (!selfBurn || (myMonDies && myMonValue >= 1500))) return 1250;
      return 0;
    }
    case CC.MOON: {
      if (atkCell && atkOf(atkCell, data) >= 1800 && (myMonDies || atkDmg >= 1500)) return 1400; // flip the attacker: attack stops
      if (newBigOpp && atkOf(newBigOpp, data) >= 2400) return 1050;
      return 0;
    }
    case CC.LOST_WIND:
      if (newBigOpp && isExtraCd(cdOf(data, newBigOpp.code)) && atkOf(newBigOpp, data) >= 1700) return 1150;
      return faceUpMons(view, opp).some(c => isExtraCd(cdOf(data, c.code)) && atkOf(c, data) >= 2000) ? 1000 : 0;
    case CC.TITANOCIDER:
      if (newBigOpp && isExtraCd(cdOf(data, newBigOpp.code)) && atkOf(newBigOpp, data) >= 1900) return 1150;
      return 0;
    case CC.TRANSMIGRATION: {
      if (topOpp && topOpp.code === CC.REBORN) return 1300; // shuffle their revival target away
      if (topOpp && topOpp.tloc === LOC.GRAVE && graveValue(topOpp.code, data) >= 800) return 1200;
      return 0;
    }
    case CC.MUDORA: case CC.KELDO: {
      const topOppGrave = view.grave[opp].map(c => graveValue(c, data)).sort((a, b) => b - a);
      return (topOppGrave[0] || 0) + (topOppGrave[1] || 0) >= 1700 ? 1050 : 0;
    }
    case CC.GK_TRAP: { // ② search during the opponent's main phase: dig for a defender
      if (view.turnPlayer !== opp || /BATTLE|DAMAGE/.test(view.phaseName)) return 0;
      const cheapest = Math.min(...view.hand[me].filter(x => x.code !== CC.GK_TRAP).map(x => discardCost(x.code, view, data)), Infinity);
      return cheapest <= 700 && myStrongestAtk(view, data) < 1500 ? 1000 : 0;
    }
    case CC.CASTEL:
      return faceUpMons(view, opp).some(c => battlePower(c, data) >= 2200) ? 1050 : 0;
    case CC.LUCE:
      return newBigOpp && atkOf(newBigOpp, data) >= 2200 ? 1100 : 0;
    default:
      return 0;
  }
}
function bestGraveAtk(view, data) {
  let m = 0;
  for (const p of [0, 1]) for (const c of view.grave[p]) { const d = cdOf(data, c); if (isMonsterCd(d)) m = Math.max(m, d.atk); }
  return m;
}
function chainAnswer(prompt, view, data, mem) {
  if (!prompt.entries.length) return i32resp(-1);
  let best = -1, bestV = 0;
  prompt.entries.forEach((e, i) => {
    const v = chainEntryValue(e, view, data, mem);
    if (v > bestV) { bestV = v; best = i; }
  });
  if (prompt.forced) return i32resp(best >= 0 ? best : 0);
  return i32resp(bestV >= 1000 ? best : -1);
}
// SELECT_EFFECTYN: the prompt names the card whose optional effect is asked.
function effectYnAnswer(prompt, view, data, mem) {
  const me = view.me;
  const myDeck = view.deckCount[me], oppDeck = view.deckCount[view.opp];
  switch (prompt.code) {
    case CC.SANGA: case CC.HUGA: case CC.SUIGA:
      return i32resp(1); // zero the attacker's ATK during damage calculation: free save
    case CC.KELBEK: {
      if (prompt.loc === LOC.GRAVE) { // ② mill trigger
        if (myDeck <= 8 && oppDeck > 6) return i32resp(0); // don't mill ourselves out
        return i32resp(1);
      }
      return i32resp(1); // ① special summon trigger
    }
    case CC.SILKY: {
      const oppBest = Math.max(0, ...faceUpMons(view, view.opp).map(c => atkOf(c, data)));
      const myFaceUp = faceUpMons(view, me);
      const myWeakest = myFaceUp.length ? Math.min(...myFaceUp.map(c => atkOf(c, data))) : Infinity;
      return i32resp((oppBest >= 1700 && myWeakest <= 1800) || oppBest >= 2600 ? 1 : 0);
    }
    case CC.CHAOS_HUNTER: {
      const cheapest = Math.min(...view.hand[me].filter(x => x.code !== prompt.code).map(x => discardCost(x.code, view, data)), Infinity);
      return i32resp(cheapest <= 900 ? 1 : 0);
    }
    case CC.ZOLGA: { // ② would destroy the monster tribute-summoned with Zolga — usually ours
      const la = view.lastAttack;
      if (la && la.attacker.con === me) return i32resp(view.lp[view.opp] <= 2000 ? 1 : 0);
      return i32resp(1);
    }
    default:
      break;
  }
  const ALWAYS_YES = new Set([CC.SPHINX, CC.BLAST_HELD, CC.LOST_WIND, CC.TITANOCIDER,
    CC.GG_COMBINED, CC.GG_THUNDERWIND, CC.GG_WINDWATER, CC.GG_WATERTHUNDER,
    CC.SHADOW_GHOUL, CC.HORUS, CC.TRILOSUKTA, CC.BAROMETT, CC.MUDORA, CC.KELDO]);
  if (ALWAYS_YES.has(prompt.code)) return i32resp(1);
  if (prompt.con === me) {
    if (MILL_WHEN_SENT.has(prompt.code) && myDeck <= 8) return i32resp(0);
    return i32resp(1); // own optional trigger: this pool's are beneficial
  }
  return i32resp(0);
}
function yesNoAnswer(prompt, view, data, mem) {
  const me = view.me;
  const ctx = prompt.context;
  if (ctx && ctx.code === CC.AGIDO) return i32resp(1); // classic Agido: the post-dice revival is free value
  if (ctx && ctx.code === CC.KELBEK) return i32resp(1); // set a trap from the graveyard: free
  if (ctx && (ctx.code === CC.LOST_WIND || ctx.code === CC.TITANOCIDER)) return i32resp(1); // re-set itself
  if (ctx && ctx.code === CC.BAROMETT)
    return i32resp(view.hand[me].some(x => { const d = cdOf(data, x.code); return isMonsterCd(d) && (d.level & 0xff) === 4; }) ? 1 : 0);
  if (ctx && (ctx.player === me || ctx.con === me)) {
    if (MILL_WHEN_SENT.has(ctx.code) && view.deckCount[me] <= 8) return i32resp(0);
    return i32resp(1);
  }
  return i32resp(0);
}

// ---------------------------------------------------------------- IDLECMD / BATTLECMD assembly
// Attempt gate: if an activation/summon keeps getting cancelled during its
// selection sub-prompts, the core returns to IDLECMD and offers it again —
// a deterministic policy would re-pick it forever. Cap attempts per turn.
function attemptOk(mem, view, kind, e) {
  if (!mem.attempts) mem.attempts = {};
  if (Object.keys(mem.attempts).length > 400) mem.attempts = {};
  const key = view.turnCount + '|' + kind + '|' + e.code + '|' + e.loc + '|' + e.seq;
  mem.attempts[key] = (mem.attempts[key] || 0) + 1;
  return mem.attempts[key] <= 2;
}
function idleAnswer(prompt, view, data, mem) {
  const me = view.me;
  const isMain1 = view.phaseName === 'MAIN1';
  // Chaos Pod flip is a full board reset: only when clearly behind, and
  // before anything else (our own plays would be shuffled away too).
  const podIdx = prompt.repos.findIndex(e => e.code === CC.CHAOS_POD);
  if (podIdx >= 0) {
    const myTot = faceUpMons(view, me).reduce((s, c) => s + battlePower(c, data), 0);
    const oppTot = faceUpMons(view, view.opp).reduce((s, c) => s + battlePower(c, data), 0);
    if (oppTot - myTot >= 1800) return cmdResp(2, podIdx);
  }
  // activations, best first
  let bestAct = -1, bestScore = 499;
  prompt.activate.forEach((e, i) => {
    const s = activationScore(e, view, data, prompt);
    if (s > bestScore) { bestScore = s; bestAct = i; }
  });
  if (bestAct >= 0) {
    const e = prompt.activate[bestAct];
    if (attemptOk(mem, view, 'act', e)) {
      if (e.code === CC.REBELLION && e.loc === LOC.HAND) mem.pendingFusionSpell = view.turnCount;
      return cmdResp(5, bestAct);
    }
    bestAct = -1; // this activation keeps aborting; move on to other plays
  }
  // Medusa Worm flip summon: destroys the opponent's biggest monster
  const wormIdx = prompt.repos.findIndex(e => e.code === CC.MEDUSA_WORM);
  if (wormIdx >= 0 && faceUpMons(view, view.opp).length) return cmdResp(2, wormIdx);
  // special summons, then normal summon / set
  const sp = pickSpsummon(prompt, view, data, mem);
  if (sp >= 0 && attemptOk(mem, view, 'sp', prompt.spsummon[sp])) return cmdResp(1, sp);
  const sm = pickSummon(prompt, view, data);
  if (sm) {
    const e = sm.kind === 'summon' ? prompt.summon[sm.idx] : prompt.mset[sm.idx];
    if (attemptOk(mem, view, sm.kind, e)) return cmdResp(sm.kind === 'summon' ? 0 : 3, sm.idx);
  }
  // repositioning: shelter outclassed attackers, ready defenders and
  // set monsters for a profitable attack
  const oppPow = oppMaxPower(view, data);
  for (let i = 0; i < prompt.repos.length; i++) {
    const e = prompt.repos[i];
    const cell = view.zones[me].mzone[e.seq];
    if (!cell) continue;
    if (!cell.faceUp) {
      // Flip summon purely to attack: only in MAIN1, never Chaos Pod
      // (its flip is a board reset, judged by its own branch above), and
      // only when the flipped monster's attack clears the same bar the
      // battle planner uses — including a free direct attack into an
      // empty opposing field. A set wall currently holding back the
      // opponent's best attacker stays set (working-wall guard). Named
      // exception: our own face-up Labyrinth Wall Shadow forbids a
      // monster of printed level 4 or lower from attacking on the turn
      // it is summoned / flip summoned, so flipping such a monster "to
      // attack" this turn buys nothing and only exposes it — its flip
      // effect, when wanted, is judged by the dedicated branches.
      const wallShadowUp = (() => { const f = view.zones[me].szone[5]; return !!(f && f.faceUp && f.code === CC.WALL_SHADOW); })();
      const cdCell = cdOf(data, cell.code);
      const summonTurnLocked = wallShadowUp && cdCell && (cdCell.level & 0xff) <= 4;
      if (isMain1 && cell.code !== CC.CHAOS_POD && !summonTurnLocked &&
          !(defOf(cell, data) >= oppPow && oppPow > atkOf(cell, data)) &&
          profitableAttackIfStood(view, data, cell)) return cmdResp(2, i);
      continue;
    }
    if (cell.atkPos) {
      if (defOf(cell, data) >= oppPow && atkOf(cell, data) < oppPow && defOf(cell, data) > atkOf(cell, data)) return cmdResp(2, i);
    } else if (isMain1 && atkOf(cell, data) >= 1600) {
      const oppMons = monList(view, view.opp);
      if (!oppMons.length || oppMons.some(t => !t.faceUp || battlePower(t, data) < atkOf(cell, data))) return cmdResp(2, i);
    } else if (isMain1 && atkOf(cell, data) > 0) {
      // Below the 1600 stand-up line: stand the defender up when its own
      // attack is worth making by the battle planner's measure (the
      // measured DEF_LOCK defect: a 500-ATK defender sat in defense for
      // whole games, even facing an empty field, because only ATK >=
      // 1600 monsters were ever stood up). Same working-wall guard: a
      // defender whose DEF is currently holding the opponent's best
      // attacker stays down.
      if (!(defOf(cell, data) >= oppPow && oppPow > atkOf(cell, data)) &&
          profitableAttackIfStood(view, data, cell)) return cmdResp(2, i);
    }
  }
  // set backrow: traps and quick-plays (never plain spells, never the field spell)
  let bestSet = -1, bestSetV = -1;
  prompt.sset.forEach((e, i) => {
    const d = cdOf(data, e.code);
    if (!d || e.code === CC.WALL_SHADOW) return;
    if (!((d.type & CT.TRAP) || (d.type & CT.QUICKPLAY))) return;
    const v = handValue(e.code, view, data);
    if (v > bestSetV) { bestSetV = v; bestSet = i; }
  });
  const wantBattle = isMain1 && prompt.toBP && hasProfitableAttack(view, data);
  if (isMain1) {
    if (wantBattle) return cmdResp(6, 0);
    if (bestSet >= 0) return cmdResp(4, bestSet);
    if (prompt.toEP) return cmdResp(7, 0);
    if (prompt.toBP) return cmdResp(6, 0);
    return cmdResp(7, 0);
  }
  if (bestSet >= 0) return cmdResp(4, bestSet);
  if (prompt.toEP) return cmdResp(7, 0);
  return cmdResp(7, 0);
}
function bestAttackPlan(view, data, attackers, directSeqs) {
  const plans = attackPlans(view, data, attackers, directSeqs);
  let best = null;
  for (const p of plans) {
    if (p.score < 240) continue;
    if (!best || p.score > best.score + 50 || (p.score >= best.score - 50 && p.atk < best.atk)) best = p;
  }
  return best;
}
function battleAnswer(prompt, view, data, mem) {
  const me = view.me;
  const attackers = prompt.attack.map(e => ({ seq: e.seq, atk: atkOf(view.zones[me].mzone[e.seq], data), direct: e.direct }));
  const bestAtk = Math.max(0, ...attackers.map(a => a.atk));
  // battle-step activations: unblock our best attacker
  for (let i = 0; i < prompt.activate.length; i++) {
    const e = prompt.activate[i];
    if (e.code === CC.MOON) {
      const wall = faceUpMons(view, view.opp).find(c => battlePower(c, data) > bestAtk && defOf(c, data) < bestAtk);
      if (wall && bestAtk >= 1500) return cmdResp(0, i);
    }
    if (e.code === CC.TITANOCIDER || e.code === CC.LOST_WIND) {
      const blocker = faceUpMons(view, view.opp).find(c => c.atkPos && isExtraCd(cdOf(data, c.code)) && atkOf(c, data) > bestAtk);
      if (blocker) return cmdResp(0, i);
    }
    if (e.code === CC.GG_WATERTHUNDER) {
      const blocker = faceUpMons(view, view.opp).find(c => c.atkPos && atkOf(c, data) > bestAtk);
      if (blocker) return cmdResp(0, i);
    }
  }
  if (prompt.attack.length) {
    const directSeqs = new Set(prompt.attack.filter(e => e.direct).map(e => e.seq));
    const plan = lethalPlan(view, data, attackers) || bestAttackPlan(view, data, attackers, directSeqs);
    if (plan) {
      mem.lastAttacker = { seq: plan.seq, turn: view.turnCount };
      mem.plannedTargetSeq = plan.targetSeq;
      const idx = prompt.attack.findIndex(e => e.seq === plan.seq);
      if (idx >= 0) return cmdResp(1, idx);
    }
    // Empty opposing field, nothing above the 240 bar: a direct attack
    // still can only gain (the attacker cannot be battled back), so take
    // it anyway — weakest direct attacker first, saving the bigger ones
    // for later battle steps. Declining here was the tuning-round-2
    // browser defect: a face-up monster idling in front of an open field.
    if (monList(view, view.opp).length === 0 && directSeqs.size) {
      const cands = attackers.filter(a => directSeqs.has(a.seq) && a.atk > 0).sort((x, y) => x.atk - y.atk);
      if (cands.length) {
        mem.lastAttacker = { seq: cands[0].seq, turn: view.turnCount };
        mem.plannedTargetSeq = -1;
        const idx = prompt.attack.findIndex(e => e.seq === cands[0].seq);
        if (idx >= 0) return cmdResp(1, idx);
      }
    }
  }
  if (prompt.toM2) return cmdResp(2, 0);
  if (prompt.toEP) return cmdResp(3, 0);
  return cmdResp(3, 0);
}

// ---------------------------------------------------------------- SELECT_CARD
// Mode is inferred from the candidate composition first (robust even when
// the prompt carries no chain context), refined by the asking card.
function selectCardAnswer(prompt, view, data, mem) {
  const me = view.me, opp = view.opp;
  const ctx = prompt.context || null;
  const ctxCode = ctx ? ctx.code : 0;
  const entries = prompt.cards.map((e, i) => ({ e: maskEntry(e, view, ctxCode), i }));
  if (!entries.length) return cardsResp([]);
  const min = prompt.min, max = prompt.max;
  const locCost = (x) => {
    const e = x.e;
    if (e.con === opp) return -1000; // giving up the opponent's card is free
    if (e.loc === LOC.HAND) return discardCost(e.code, view, data);
    if (e.loc === LOC.MZONE) { const c = view.zones[me].mzone[e.seq]; return c ? boardValue(c, data) : 600; }
    if (e.loc === LOC.SZONE) return 500;
    if (e.loc === LOC.GRAVE) return graveValue(e.code, data);
    if (e.loc === LOC.REMOVED) return 400;
    if (e.loc === LOC.DECK) return handValue(e.code, view, data) * 0.4;
    return 500;
  };
  const threat = (x) => {
    const e = x.e;
    if (e.con === opp) {
      if (e.loc === LOC.MZONE) { const c = view.zones[opp].mzone[e.seq]; return c ? (c.faceUp ? boardValue(c, data) : 1000) : 700; }
      if (e.loc === LOC.SZONE) { const c = view.zones[opp].szone[e.seq]; return c && c.faceUp ? 850 : 950; }
      if (e.loc === LOC.GRAVE) return graveValue(e.code, data);
      return handValue(e.code, view, data);
    }
    return -locCost(x);
  };
  const take = (sorted, n) => cardsResp(sorted.slice(0, n).map(x => x.i));
  // --- battle target selection: no chain in progress, we just declared an
  // attacker at BATTLECMD. Candidates are the opponent's monsters; hidden
  // ones were masked, so face-down targets are judged by position only.
  const battlePhase = ['BATTLE', 'BATTLE_STEP', 'BATTLE_START', 'DAMAGE', 'DAMAGE_CAL'].includes(view.phaseName);
  if (battlePhase && view.chain.length === 0 && mem.lastAttacker && mem.lastAttacker.turn === view.turnCount &&
      entries.length && entries.every(x => x.e.con === opp && x.e.loc === LOC.MZONE)) {
    const atkCell = view.zones[me].mzone[mem.lastAttacker.seq];
    const A = atkOf(atkCell, data);
    let pick = -1, bestS = -Infinity;
    for (const x of entries) {
      const t = view.zones[opp].mzone[x.e.seq];
      if (!t) continue;
      let s = attackScore(view, data, A, t, boardValue(atkCell, data));
      if (x.e.seq === mem.plannedTargetSeq) s += 100000;
      if (s > bestS) { bestS = s; pick = x.i; }
    }
    return cardsResp([pick >= 0 ? pick : entries[0].i]);
  }
  // --- Baromett ②: special summon a level-4 from hand — pick the best body
  if (ctxCode === CC.BAROMETT && entries.every(x => x.e.loc === LOC.HAND)) {
    const s = entries.slice().sort((a, b) => (cdOf(data, b.e.code) ? cdOf(data, b.e.code).atk : 0) - (cdOf(data, a.e.code) ? cdOf(data, a.e.code).atk : 0));
    return take(s, Math.max(1, min));
  }
  // --- Vernusylph ② target: double our strongest Vernusylph's ATK
  if (ctxCode === CC.VERN_MORI && entries.every(x => x.e.con === me && x.e.loc === LOC.MZONE)) {
    const s = entries.slice().sort((a, b) => atkOf(view.zones[me].mzone[b.e.seq], data) - atkOf(view.zones[me].mzone[a.e.seq], data));
    return take(s, Math.max(1, min));
  }
  // --- Book of Taiyou: flip our set flip-monster if it pays, else expose theirs
  if (ctxCode === CC.TAIYOU) {
    const pref = (x) => {
      if (x.e.con === me && x.e.code === CC.CHAOS_POD) return 3000;
      if (x.e.con === me && x.e.code === CC.MEDUSA_WORM) return 2900;
      if (x.e.con === me) { const d = cdOf(data, x.e.code); return 1500 + (d ? d.atk : 0); }
      return 1000;
    };
    return take(entries.slice().sort((a, b) => pref(b) - pref(a)), Math.max(1, min));
  }
  // --- Hand Destruction: the effect revealed the opponent's hand to us
  if (ctxCode === CC.HAND_DESTRUCTION) {
    const s = entries.slice().sort((a, b) => handValue(b.e.code, view, data) - handValue(a.e.code, view, data));
    return take(s, Math.max(1, min));
  }
  // --- pick a monster from our own Extra Deck (fusion target etc.)
  if (entries.every(x => x.e.con === me && x.e.loc === LOC.EXTRA)) {
    const bonus = { [CC.LUCE]: 500, [CC.GG_COMBINED]: 400, [CC.HYPERION]: 250, [CC.CASTEL]: 300 };
    const s = entries.slice().sort((a, b) => ((cdOf(data, b.e.code) ? cdOf(data, b.e.code).atk : 0) + (bonus[b.e.code] || 150)) -
                                             ((cdOf(data, a.e.code) ? cdOf(data, a.e.code).atk : 0) + (bonus[a.e.code] || 150)));
    return take(s, Math.max(1, min));
  }
  // --- fusion materials for 天至る叛逆 (returned to the deck): cheapest first
  if ((mem.pendingFusionSpell === view.turnCount || ctxCode === CC.REBELLION) &&
      entries.every(x => x.e.con === me && x.e.loc !== LOC.EXTRA)) {
    return take(entries.slice().sort((a, b) => locCost(a) - locCost(b)), Math.max(1, min));
  }
  // --- materials for the Extra/contact summon chosen at IDLECMD
  if (mem.pendingSummon && mem.pendingSummon.turn === view.turnCount && entries.every(x => x.e.con === me)) {
    const target = cdOf(data, mem.pendingSummon.code);
    if (target && (target.type & CT.XYZ)) {
      // Material attachment for the summon itself takes >= 2 FIELD
      // monsters. A same-turn detach selection for the new monster's own
      // effect (Castel: candidates are its OVERLAY units, min = max = 1)
      // also lands in this branch if it is not fenced off, and answering
      // it with 2 picks is rejected by the core — the deterministic
      // re-answer then loops to the driver's retry cap and aborts the
      // duel (measured in test-cpu-tune, seed 91063 trajectory).
      if (min >= 2 && entries.every(x => x.e.loc === LOC.MZONE)) {
        const rank = target.level & 0xff;
        const lv = (x) => { const c = view.zones[me].mzone[x.e.seq]; return c ? levelOf(c, data) : (cdOf(data, x.e.code) ? cdOf(data, x.e.code).level & 0xff : 0); };
        const matching = entries.filter(x => lv(x) === rank).sort((a, b) => locCost(a) - locCost(b));
        const want = Math.min(max, Math.max(2, min));
        if (matching.length >= want) return take(matching, want);
      }
    }
    if (target && (target.type & CT.SYNCHRO)) {
      const lvl = target.level & 0xff;
      const combos = [];
      const n = Math.min(entries.length, 8);
      const sub = entries.slice(0, n);
      for (let mask = 1; mask < (1 << n); mask++) {
        let sum = 0, hasTuner = false, cost = 0; const picks = [];
        for (let j = 0; j < n; j++) if (mask & (1 << j)) {
          const x = sub[j]; const d = cdOf(data, x.e.code);
          sum += d ? (d.level & 0xff) : 0;
          if (d && (d.type & CT.TUNER)) hasTuner = true;
          cost += locCost(x); picks.push(x.i);
        }
        if (hasTuner && sum === lvl) combos.push({ cost, picks });
      }
      combos.sort((a, b) => a.cost - b.cost);
      if (combos.length) return cardsResp(combos[Math.min(prompt.retryCount || 0, combos.length - 1)].picks);
    }
    // contact fusion / other: location tier (grave < removed < hand < field), then cheapest
    const tier = (x) => x.e.loc === LOC.GRAVE ? 0 : x.e.loc === LOC.REMOVED ? 1 : x.e.loc === LOC.HAND ? 2 : 3;
    return take(entries.slice().sort((a, b) => (tier(a) - tier(b)) || (locCost(a) - locCost(b))), Math.max(1, min));
  }
  // --- return cards from the graveyards to the decks: theirs first (their
  // grave resources are the threat), ours only to fill the required count
  if (ctxCode === CC.TRANSMIGRATION || ctxCode === CC.MUDORA || ctxCode === CC.KELDO) {
    const scored = entries.map(x => ({ x, v: x.e.con === opp ? graveValue(x.e.code, data) : -graveValue(x.e.code, data) }))
      .sort((a, b) => b.v - a.v);
    const picks = [];
    for (const s of scored) { if (picks.length >= min) break; picks.push(s.x.i); }
    for (const s of scored) { if (picks.length >= max) break; if (s.v >= 700 && !picks.includes(s.x.i)) picks.push(s.x.i); }
    return cardsResp(picks);
  }
  // --- guardian-piece placement (Wall Shadow ② / Heavy Tank ③): the
  // candidates are guardian pieces from hand/deck/banished. Prefer a name
  // that is not already face-up on our field — the payoffs (the contact
  // fusions' distinct names, Dark Guardian's one-of-each trio) need
  // distinct pieces, and the generic branches below kept placing the
  // highest-ATK duplicate (measured: Sanga placed twice while
  // Kazejin/Suijin sat in the deck). This branch must precede the
  // all-DECK search branch, which otherwise captures deck placements.
  // Deck copies before hand copies.
  if ((ctxCode === CC.WALL_SHADOW || ctxCode === CC.HEAVY_TANK) &&
      entries.length && entries.every(x => GUARDIAN_PIECES.includes(x.e.code))) {
    const onFieldNames = new Set();
    for (const c of monList(view, me)) if (c && c.faceUp) onFieldNames.add(c.code);
    for (const c of view.zones[me].szone) if (c && c.faceUp) onFieldNames.add(c.code);
    const score = (x) => (onFieldNames.has(x.e.code) ? 100 : 1000) +
      (cdOf(data, x.e.code) ? cdOf(data, x.e.code).atk : 0) * 0.05 - locCost(x) * 0.05;
    const s = entries.slice().sort((a, b) => score(b) - score(a));
    return take(s, Math.max(1, min));
  }
  // --- search / send from our own deck
  if (entries.every(x => x.e.loc === LOC.DECK)) {
    const pieceCount = (code) => (view.hand[me].some(y => y.code === code) ? 1 : 0) +
      (view.grave[me].includes(code) ? 1 : 0) + (view.removed[me].includes(code) ? 1 : 0) +
      (monList(view, me).some(c => c.code === code) ? 1 : 0);
    const score = (x) => {
      const e = x.e, d = cdOf(data, e.code);
      if (ctxCode === CC.FOOLISH_GOODS) {
        if (e.code === CC.EXCHANGE) return 2000;
        if (e.code === CC.DARK_ELEMENT) return 1500;
        return GRAVE_PROFIT.has(e.code) ? 1000 + graveValue(e.code, data) : handValue(e.code, view, data) * 0.3;
      }
      if ([CC.DARK_ELEMENT, CC.FORCE_GUARDIAN, CC.DEMON_WIND, CC.JIRAI_TRAP, CC.SHADOW_GHOUL].includes(ctxCode)) {
        if (e.code === CC.WALL_SHADOW) return 1800;
        if (GUARDIAN_PIECES.includes(e.code)) return 1500 - pieceCount(e.code) * 300 + (d ? d.atk * 0.1 : 0);
        return handValue(e.code, view, data) * 0.5;
      }
      if (ctxCode === CC.GK_TRAP) {
        let v = isMonsterCd(d) ? d.atk : 0;
        if (e.code === CC.KELBEK && faceUpMons(view, opp).some(c => isExtraCd(cdOf(data, c.code)))) v += 350;
        if (e.code === CC.KELDO && !view.grave[me].includes(CC.EXCHANGE)) v += 300;
        if (e.code === CC.MUDORA) v += 150;
        if (e.code === CC.ZOLGA) v += 100;
        return v;
      }
      if (ctxCode === CC.CARBON) return isMonsterCd(d) ? d.atk : 0;
      if (ctxCode === CC.GG_THUNDERWIND) {
        const pref = [CC.DARK_ELEMENT, CC.DEMON_WIND, CC.FORCE_GUARDIAN, CC.JIRAI_TRAP].indexOf(e.code);
        return pref >= 0 ? 2000 - pref * 100 : 100;
      }
      if (ctxCode === CC.SPHINX) return e.code === CC.MOON ? 1000 : e.code === CC.TAIYOU ? 900 : 0;
      return isMonsterCd(d) ? d.atk + handValue(e.code, view, data) * 0.2 : handValue(e.code, view, data);
    };
    const s = entries.slice().sort((a, b) => score(b) - score(a));
    if (min === 0 && prompt.cancelable) return score(s[0]) >= 400 ? take(s, 1) : cardsResp([]);
    return take(s, Math.max(1, min));
  }
  // --- discard / cost from our hand: cheapest first
  if (entries.every(x => x.e.con === me && x.e.loc === LOC.HAND)) {
    const s = entries.slice().sort((a, b) => discardCost(a.e.code, view, data) - discardCost(b.e.code, view, data));
    if (min === 0 && prompt.cancelable) {
      return s.length && discardCost(s[0].e.code, view, data) < -300 ? take(s, 1) : cardsResp([]);
    }
    return take(s, Math.max(1, min));
  }
  // --- picks from graveyards / banished (revive, salvage, recycle):
  // biggest body for revival, otherwise the most valuable resource
  if (entries.every(x => x.e.loc === LOC.GRAVE || x.e.loc === LOC.REMOVED)) {
    const s = entries.slice().sort((a, b) => {
      const da = cdOf(data, a.e.code), db = cdOf(data, b.e.code);
      const va = isMonsterCd(da) ? da.atk + graveValue(a.e.code, data) * 0.3 : graveValue(a.e.code, data);
      const vb = isMonsterCd(db) ? db.atk + graveValue(b.e.code, data) * 0.3 : graveValue(b.e.code, data);
      return vb - va;
    });
    return take(s, Math.max(1, min));
  }
  // --- field targets (removal, bounce, flip): biggest threat first.
  // Book of Moon prefers high ATK / low DEF; face-down targets are judged
  // by position only (their codes were masked).
  if (entries.some(x => x.e.loc === LOC.MZONE || x.e.loc === LOC.SZONE)) {
    const s = entries.slice().sort((a, b) => {
      if (ctxCode === CC.MOON) {
        const ta = a.e.con === opp && a.e.loc === LOC.MZONE ? (() => { const c = view.zones[opp].mzone[a.e.seq]; return c && c.faceUp ? atkOf(c, data) * 2 - defOf(c, data) : -500; })() : -1000;
        const tb = b.e.con === opp && b.e.loc === LOC.MZONE ? (() => { const c = view.zones[opp].mzone[b.e.seq]; return c && c.faceUp ? atkOf(c, data) * 2 - defOf(c, data) : -500; })() : -1000;
        return tb - ta;
      }
      return threat(b) - threat(a);
    });
    return take(s, Math.max(1, min));
  }
  // --- anything else of ours (mixed costs): cheapest first
  if (entries.every(x => x.e.con === me)) {
    return take(entries.slice().sort((a, b) => locCost(a) - locCost(b)), Math.max(1, min));
  }
  return take(entries, Math.max(1, min));
}
// SELECT_TRIBUTE: weakest loss per release point until the value is met.
function tributeAnswer(prompt, view, data) {
  const me = view.me;
  const scored = prompt.cards.map((e, i) => {
    let loss;
    if (e.con === view.opp) loss = -1000;
    else if (e.loc === LOC.MZONE) { const c = view.zones[me].mzone[e.seq]; loss = c ? boardValue(c, data) : 600; }
    else if (e.loc === LOC.HAND) loss = handValue(e.code, view, data);
    else loss = 600;
    return { i, loss, rp: e.releaseParam || 1 };
  }).sort((a, b) => (a.loss / a.rp) - (b.loss / b.rp));
  const picks = [];
  let sum = 0;
  for (const s of scored) {
    if (sum >= prompt.min || picks.length >= prompt.max) break;
    picks.push(s.i); sum += s.rp;
  }
  return cardsResp(picks);
}
// SELECT_UNSELECT_CARD — termination-critical. Core semantics (playerop.cpp
// + operations.cpp): a toggle moves one card between the pools; the parent
// process finishes when the selection reaches max, or when -1 is sent while
// finishable (with >= min selected) / cancelable. When NEITHER flag is set,
// -1 is rejected — the only way out is toggling up to max. Strategy:
//   - finishable and the current selection already equals the desired set
//     (and size >= min): finish.
//   - neither flag: only ever toggle ON (selection size strictly grows, so
//     at most max toggles remain) — desired cards first.
//   - otherwise move monotonically toward the desired set (each toggle cuts
//     the symmetric difference by one), then finish.
// A per-signature streak in mem force-progresses if anything unexpected
// repeats, so the handler is bounded independent of heuristic correctness.
function unselectAnswer(prompt, view, data, mem) {
  const me = view.me, opp = view.opp;
  const ctxCode = prompt.context ? prompt.context.code : 0;
  const pool = prompt.select.map((e, i) => ({ e: maskEntry(e, view, ctxCode), idx: i }));
  const chosen = prompt.unselect.map((e, j) => ({ e: maskEntry(e, view, ctxCode), idx: prompt.select.length + j }));
  const all = pool.concat(chosen);
  const keyOf = (x) => x.e.con + '|' + x.e.loc + '|' + x.e.seq + '|' + (x.e.code || 0);
  const giveUp = (x) => {
    if (x.e.con === opp) return -1000;
    if (x.e.loc === LOC.MZONE) { const c = view.zones[me].mzone[x.e.seq]; return c ? boardValue(c, data) : 600; }
    if (x.e.loc === LOC.HAND) return discardCost(x.e.code, view, data);
    if (x.e.loc === LOC.GRAVE) return graveValue(x.e.code, data);
    return 500;
  };
  const threatOf = (x) => x.e.con === opp
    ? (x.e.loc === LOC.MZONE ? (() => { const c = view.zones[opp].mzone[x.e.seq]; return c ? (c.faceUp ? boardValue(c, data) : 1000) : 700; })() : 800)
    : -giveUp(x);
  const targetMode = all.every(x => x.e.con === opp) ||
    [CC.CASTEL, CC.LUCE, CC.DEMON_WIND, CC.RAIGEKI].includes(ctxCode);
  let desired;
  if (targetMode) {
    const s = all.slice().sort((a, b) => threatOf(b) - threatOf(a));
    const want = Math.max(prompt.min, s.filter(x => threatOf(x) >= 800).length);
    desired = new Set(s.slice(0, Math.min(Math.max(want, 0), prompt.max)).map(keyOf));
  } else {
    const s = all.slice().sort((a, b) => giveUp(a) - giveUp(b));
    desired = new Set(s.slice(0, Math.min(Math.max(prompt.min, 0), prompt.max)).map(keyOf));
  }
  const chosenKeys = new Set(chosen.map(keyOf));
  const eqDesired = chosen.length === desired.size && [...chosenKeys].every(k => desired.has(k));
  // streak guard (paranoia): same prompt signature answered too many times
  const sig = prompt.name + '|' + all.map(keyOf).sort().join(',') + '|' + prompt.min + '/' + prompt.max;
  mem.unselectStreak[sig] = (mem.unselectStreak[sig] || 0) + 1;
  if (mem.unselectStreak[sig] > all.length + prompt.max + 3) {
    if (pool.length) return unselectToggleResp(pool[0].idx);
    return cancelResp();
  }
  if (prompt.finishable && eqDesired && chosen.length >= prompt.min) return cancelResp();
  if (!prompt.finishable && !prompt.cancelable) {
    const inD = pool.filter(x => desired.has(keyOf(x)));
    const pick = inD[0] || pool.slice().sort((a, b) => targetMode ? threatOf(b) - threatOf(a) : giveUp(a) - giveUp(b))[0];
    if (pick) return unselectToggleResp(pick.idx);
    return cancelResp();
  }
  const missing = pool.filter(x => desired.has(keyOf(x)));
  if (missing.length) return unselectToggleResp(missing[0].idx);
  const extra = chosen.filter(x => !desired.has(keyOf(x)));
  if (extra.length && prompt.finishable) return unselectToggleResp(extra[0].idx);
  if (prompt.finishable && chosen.length >= prompt.min) return cancelResp();
  if (pool.length) {
    const pick = pool.slice().sort((a, b) => targetMode ? threatOf(b) - threatOf(a) : giveUp(a) - giveUp(b))[0];
    return unselectToggleResp(pick.idx);
  }
  return cancelResp();
}
// SELECT_SUM: exhaustive subset search (candidate counts are tiny here),
// ordered so valid sets surface early; the start offset rotates with the
// driver's retry count so a rejected answer is never repeated identically.
function sumAnswer(prompt, view, data) {
  const n = prompt.cards.length;
  const base = prompt.cards.map((c, i) => i).sort((a, b) => prompt.cards[b].sumParam - prompt.cards[a].sumParam);
  const rot = n > 0 ? (prompt.retryCount || 0) % n : 0;
  const order = base.slice(rot).concat(base.slice(0, rot));
  const chosen = [];
  let nodes = 0;
  const dfs = (k) => {
    if (sumSelectionValid(prompt, chosen)) return true;
    if (++nodes > 60000) return false;
    for (let j = k; j < order.length; j++) {
      chosen.push(order[j]);
      if (dfs(j + 1)) return true;
      chosen.pop();
    }
    return false;
  };
  dfs(0);
  return cardsResp(chosen);
}
function counterAnswer(prompt) {
  const amounts = prompt.cards.map(() => 0);
  let remaining = prompt.count;
  const order = prompt.cards.map((c, i) => i).sort((a, b) => prompt.cards[b].count - prompt.cards[a].count);
  for (const i of order) {
    if (remaining <= 0) break;
    const takeN = Math.min(remaining, prompt.cards[i].count);
    amounts[i] = takeN; remaining -= takeN;
  }
  return counterResp(amounts);
}
// SELECT_PLACE: own zones, center-out; the trap monster 地雷蜘蛛の餌食 prefers
// the column opposite the opponent's biggest monster (its effect destroys
// the monster in its column). SELECT_DISFIELD disables the least useful
// zones (opponent's empty zones first).
function placeAnswer(prompt, view, data) {
  const avail = (~prompt.flag) >>> 0;
  const me = view.me, opp = view.opp;
  const zones = [];
  const seen = new Set();
  const push = (con, loc, seq) => {
    const k = con + '|' + loc + '|' + seq;
    if (!seen.has(k)) { seen.add(k); zones.push({ con, loc, seq }); }
  };
  if (prompt.name === 'SELECT_DISFIELD') {
    for (let s = 0; s < 5; s++) if ((avail & (0x10000 << s)) && !view.zones[opp].mzone[s]) push(opp, LOC.MZONE, s);
    for (let s = 0; s < 5; s++) if ((avail & (0x1000000 << s)) && !view.zones[opp].szone[s]) push(opp, LOC.SZONE, s);
    for (let s = 0; s < 5; s++) if ((avail & (0x100 << s)) && !view.zones[me].szone[s]) push(me, LOC.SZONE, s);
    for (let s = 0; s < 7; s++) if ((avail & (1 << s)) && !view.zones[me].mzone[s]) push(me, LOC.MZONE, s);
    for (let s = 0; s < 7; s++) if (avail & (1 << s)) push(me, LOC.MZONE, s);
    for (let s = 0; s < 7; s++) if (avail & (0x10000 << s)) push(opp, LOC.MZONE, s);
    for (let s = 0; s < 5; s++) if (avail & (0x1000000 << s)) push(opp, LOC.SZONE, s);
    return placeResp(zones.slice(0, prompt.count));
  }
  const ctx = prompt.context;
  const mOrder = [2, 1, 3, 0, 4, 5, 6], sOrder = [2, 1, 3, 0, 4];
  if (ctx && ctx.code === CC.JIRAI_TRAP) {
    const big = faceUpMons(view, opp).sort((a, b) => atkOf(b, data) - atkOf(a, data))[0];
    if (big && (avail & (1 << big.seq))) push(me, LOC.MZONE, big.seq);
  }
  for (const s of mOrder) if (avail & (1 << s)) push(me, LOC.MZONE, s);
  for (const s of sOrder) if (avail & (0x100 << s)) push(me, LOC.SZONE, s);
  if (avail & 0x2000) push(me, LOC.SZONE, 5);
  if (avail & 0x4000) push(me, LOC.SZONE, 6);
  if (avail & 0x8000) push(me, LOC.SZONE, 7);
  for (const s of mOrder) if (avail & (0x10000 << s)) push(opp, LOC.MZONE, s);
  for (const s of sOrder) if (avail & (0x1000000 << s)) push(opp, LOC.SZONE, s);
  if (avail & 0x40000000) push(opp, LOC.SZONE, 6);
  if (avail & 0x80000000) push(opp, LOC.SZONE, 7);
  return placeResp(zones.slice(0, prompt.count));
}
function positionAnswer(prompt, view, data) {
  const cd = cdOf(data, prompt.code);
  const has = (p) => (prompt.mask & p) !== 0;
  if (cd && ((cd.type & CT.FLIP) || prompt.code === CC.CHAOS_POD || prompt.code === CC.MEDUSA_WORM)) {
    if (has(POS.FD_DEF)) return i32resp(POS.FD_DEF);
  }
  if (cd && isMonsterCd(cd)) {
    const oppPow = oppMaxPower(view, data);
    if (cd.atk >= cd.def) {
      if (has(POS.FU_ATK) && !(oppPow > cd.atk && cd.def >= oppPow)) return i32resp(POS.FU_ATK);
      if (has(POS.FU_DEF)) return i32resp(POS.FU_DEF);
      if (has(POS.FU_ATK)) return i32resp(POS.FU_ATK);
    } else {
      if (has(POS.FU_DEF) && (cd.def >= 1500 || oppPow > cd.atk)) return i32resp(POS.FU_DEF);
      if (has(POS.FU_ATK)) return i32resp(POS.FU_ATK);
      if (has(POS.FU_DEF)) return i32resp(POS.FU_DEF);
    }
  }
  for (const p of [POS.FU_ATK, POS.FU_DEF, POS.FD_DEF, POS.FD_ATK]) if (has(p)) return i32resp(p);
  return i32resp(prompt.mask);
}
function announceCardAnswer(prompt, view, data) {
  const rem = remainingDeck(view, view.opp, data);
  let best = 0, bestV = -1;
  for (const key of Object.keys(data.cards)) {
    const cd = data.cards[key];
    if (!isDeclarable(cd, prompt.opcodes)) continue;
    if (rem && !deckHas(rem, cd.code)) continue; // publicly accounted for elsewhere
    let v = isMonsterCd(cd) ? cd.atk : handValue(cd.code, view, data) * 1.4;
    if (cd.code === CC.RAIGEKI) v = 3400;
    if (cd.code === CC.DARK_GUARDIAN) v = 3900;
    if (v > bestV) { bestV = v; best = cd.code; }
  }
  if (best) return i32resp(best);
  for (const key of Object.keys(data.cards)) if (isDeclarable(data.cards[key], prompt.opcodes)) return i32resp(+key);
  return i32resp(data.decks.ishizu.main[0]);
}
function announceRaceAnswer(prompt, view, data) {
  const mine = monList(view, view.me).concat(view.hand[view.me].map(x => ({ code: x.code })));
  const bits = [];
  for (let b = 0; b < 32; b++) if ((prompt.availLo >>> b) & 1) bits.push({ b, w: 0, n: 0 });
  for (let b = 0; b < 32; b++) if ((prompt.availHi >>> b) & 1) bits.push({ b: b + 32, w: 1, n: 0 });
  for (const bit of bits) {
    if (bit.b >= 32) continue;
    for (const c of mine) { const d = cdOf(data, c.code); if (d && ((d.race >>> bit.b) & 1)) bit.n++; }
  }
  bits.sort((a, b) => b.n - a.n);
  let lo = 0, hi = 0;
  bits.slice(0, prompt.count).forEach(bit => { if (bit.w) hi |= (1 << (bit.b - 32)); else lo |= (1 << bit.b); });
  return u64resp(lo >>> 0, hi >>> 0);
}
function announceAttribAnswer(prompt, view, data) {
  const mine = monList(view, view.me).concat(view.hand[view.me].map(x => ({ code: x.code })));
  const bits = [];
  for (let b = 0; b < 32; b++) if ((prompt.avail >>> b) & 1) {
    let n = 0;
    for (const c of mine) { const d = cdOf(data, c.code); if (d && d.attribute === (1 << b)) n++; }
    bits.push({ b, n });
  }
  bits.sort((a, b) => b.n - a.n);
  let mask = 0;
  bits.slice(0, prompt.count).forEach(bit => { mask |= (1 << bit.b); });
  return i32resp(mask);
}
// CPU policy entry point (internal). Signature unchanged from the old
// policy: botAnswer(prompt, state, data, mem) -> Uint8Array response.
function botAnswerInternal(prompt, state, data, mem) {
  mem = mem || makeBotMemory();
  const view = botView(state, prompt.player, data);
  // Snapshot-diff the opponent's face-up monsters: a monster that appeared
  // since our last prompt marks a summon-response window (used for summon
  // negation and on-summon reactions). Public information only.
  const snap = new Set(faceUpMons(view, view.opp).map(c => c.seq + ':' + c.code));
  mem.newOppSeqs = mem.oppFieldSnap ? [...snap].filter(k => !mem.oppFieldSnap.has(k)).map(k => parseInt(k, 10)) : [];
  mem.oppFieldSnap = snap;
  if (view.turnPlayer === view.me) mem.summonedYet = false; // legacy field upkeep
  switch (prompt.name) {
    case 'SELECT_IDLECMD': return idleAnswer(prompt, view, data, mem);
    case 'SELECT_BATTLECMD': return battleAnswer(prompt, view, data, mem);
    case 'SELECT_CHAIN': return chainAnswer(prompt, view, data, mem);
    case 'SELECT_EFFECTYN': return effectYnAnswer(prompt, view, data, mem);
    case 'SELECT_YESNO': return yesNoAnswer(prompt, view, data, mem);
    case 'SELECT_CARD': return selectCardAnswer(prompt, view, data, mem);
    case 'SELECT_TRIBUTE': return tributeAnswer(prompt, view, data);
    case 'SELECT_UNSELECT_CARD': return unselectAnswer(prompt, view, data, mem);
    case 'SELECT_SUM': return sumAnswer(prompt, view, data);
    case 'SELECT_COUNTER': return counterAnswer(prompt);
    case 'SELECT_PLACE': case 'SELECT_DISFIELD': return placeAnswer(prompt, view, data);
    case 'SELECT_POSITION': return positionAnswer(prompt, view, data);
    case 'SELECT_OPTION': return i32resp(0); // no pool effect needs a smarter default (see NOTES)
    case 'SORT_CARD': {
      const mine = prompt.cards.every(c => c.con === view.me);
      if (mine && prompt.cards.some(c => c.loc === LOC.DECK)) {
        const order = prompt.cards.map((c, i) => i)
          .sort((a, b) => handValue(prompt.cards[b].code, view, data) - handValue(prompt.cards[a].code, view, data));
        return sortResp(order);
      }
      return sortResp(prompt.cards.map((_, i) => i));
    }
    case 'SORT_CHAIN': return cancelResp();
    case 'ROCK_PAPER_SCISSORS': return i32resp(1);
    case 'ANNOUNCE_RACE': return announceRaceAnswer(prompt, view, data);
    case 'ANNOUNCE_ATTRIB': return announceAttribAnswer(prompt, view, data);
    case 'ANNOUNCE_CARD': return announceCardAnswer(prompt, view, data);
    case 'ANNOUNCE_NUMBER': {
      let best = 0;
      prompt.options.forEach((v, i) => { if (v <= 8 && v >= (prompt.options[best] || 0)) best = i; });
      return i32resp(best);
    }
  }
  return i32resp(0);
}

// ---------------------------------------------------------------- safety net
// The policy must never throw into Duel.run (a throw stalls the duel), so
// every answer goes through this wrapper: any internal error degrades to a
// minimal legal completion for that prompt type.
function botFallback(prompt, data) {
  switch (prompt.name) {
    case 'SELECT_CHAIN': return i32resp(prompt.forced && prompt.entries && prompt.entries.length ? 0 : -1);
    case 'SELECT_EFFECTYN': case 'SELECT_YESNO': return i32resp(0);
    case 'SELECT_IDLECMD':
      if (prompt.toEP) return cmdResp(7, 0);
      if (prompt.toBP) return cmdResp(6, 0);
      return cmdResp(7, 0);
    case 'SELECT_BATTLECMD':
      if (prompt.toM2) return cmdResp(2, 0);
      return cmdResp(3, 0);
    case 'SELECT_CARD': return cardsResp(prompt.cards.slice(0, Math.max(1, prompt.min)).map((_, i) => i));
    case 'SELECT_TRIBUTE': {
      const order = prompt.cards.map((c, i) => i).sort((a, b) => (prompt.cards[a].releaseParam || 1) - (prompt.cards[b].releaseParam || 1));
      const picks = []; let sum = 0;
      for (const i of order) { if (sum >= prompt.min || picks.length >= prompt.max) break; picks.push(i); sum += prompt.cards[i].releaseParam || 1; }
      return cardsResp(picks);
    }
    case 'SELECT_UNSELECT_CARD':
      if (prompt.finishable || prompt.cancelable) return cancelResp();
      return prompt.select.length ? unselectToggleResp(0) : cancelResp();
    case 'SELECT_SUM': return cardsResp([]);
    case 'SELECT_COUNTER': {
      const amounts = prompt.cards.map(() => 0);
      let rem = prompt.count;
      prompt.cards.forEach((c, i) => { const t = Math.min(rem, c.count); amounts[i] = t; rem -= t; });
      return counterResp(amounts);
    }
    case 'SELECT_PLACE': case 'SELECT_DISFIELD': {
      const avail = (~prompt.flag) >>> 0;
      const me = prompt.player, op = 1 - me;
      const zones = [];
      const push = (con, loc, seq) => { if (zones.length < prompt.count) zones.push({ con, loc, seq }); };
      for (let s = 0; s < 7 && zones.length < prompt.count; s++) if (avail & (1 << s)) push(me, LOC.MZONE, s);
      for (let s = 0; s < 5 && zones.length < prompt.count; s++) if (avail & (0x100 << s)) push(me, LOC.SZONE, s);
      if (avail & 0x2000) push(me, LOC.SZONE, 5);
      if (avail & 0x4000) push(me, LOC.SZONE, 6);
      if (avail & 0x8000) push(me, LOC.SZONE, 7);
      for (let s = 0; s < 7 && zones.length < prompt.count; s++) if (avail & (0x10000 << s)) push(op, LOC.MZONE, s);
      for (let s = 0; s < 5 && zones.length < prompt.count; s++) if (avail & (0x1000000 << s)) push(op, LOC.SZONE, s);
      if (avail & 0x40000000) push(op, LOC.SZONE, 6);
      if (avail & 0x80000000) push(op, LOC.SZONE, 7);
      return placeResp(zones);
    }
    case 'SELECT_POSITION': {
      for (const p of [POS.FU_ATK, POS.FU_DEF, POS.FD_DEF, POS.FD_ATK]) if (prompt.mask & p) return i32resp(p);
      return i32resp(prompt.mask);
    }
    case 'SORT_CARD': return sortResp(prompt.cards.map((_, i) => i));
    case 'SORT_CHAIN': return cancelResp();
    case 'ROCK_PAPER_SCISSORS': return i32resp(1);
    case 'ANNOUNCE_RACE': {
      let lo = 0;
      for (let k = 0; k < prompt.count; k++) {
        for (let b = 0; b < 32; b++) if (((prompt.availLo >>> b) & 1) && !(lo & (1 << b))) { lo |= (1 << b); break; }
      }
      return u64resp(lo >>> 0, 0);
    }
    case 'ANNOUNCE_ATTRIB': {
      let mask = 0;
      for (let k = 0; k < prompt.count; k++) {
        for (let b = 0; b < 32; b++) if (((prompt.avail >>> b) & 1) && !(mask & (1 << b))) { mask |= (1 << b); break; }
      }
      return i32resp(mask);
    }
    case 'ANNOUNCE_CARD': {
      for (const key of Object.keys(data.cards)) if (isDeclarable(data.cards[key], prompt.opcodes)) return i32resp(+key);
      return i32resp(data.decks.ishizu.main[0]);
    }
    case 'ANNOUNCE_NUMBER': return i32resp(0);
    default: return i32resp(0);
  }
}
function botAnswer(prompt, state, data, mem) {
  try {
    return botAnswerInternal(prompt, state, data, mem);
  } catch (e) {
    if (globalThis.__CPU_DEBUG) console.error('bot policy error on', prompt.name, e);
    try { return botFallback(prompt, data); } catch (e2) { return i32resp(0); }
  }
}

// ---------------------------------------------------------------- duel driver
// Async driver: mirrors the PoC's process loop, but pauses for the human seat.
// opts:
//   humanAnswerer(prompt, state) -> Promise<Uint8Array>   (seat 0)
//   botAnswerer(prompt, state, mem) -> Uint8Array         (seat 1; default botAnswer)
//   onUpdate(state)                                       (after every message batch)
//   onLog(line)
//   pace: { bot: ms, botChain: ms, batch: ms, human: 0 }   (delays, watchability)
//   seed: number
//   maxSteps: safety cap
//   deckP0 / deckP1: deck objects for core seats 0/1 (default ishizu / gg)
//   humanTeam: core seat answered by humanAnswerer (default 0)
//   onMessage(msgBytes): raw tap of every core message (tests/diagnostics)
const sleepDefault = (ms) => new Promise(res => setTimeout(res, ms));
class Duel {
  constructor(M, data, opts) {
    this.M = M; this.data = data; this.opts = opts || {};
    this.deckP0 = this.opts.deckP0 || data.decks.ishizu;
    this.deckP1 = this.opts.deckP1 || data.decks.gg;
    this.humanTeam = this.opts.humanTeam || 0;
    this.state = new GameState(data, this.deckP0, this.deckP1);
    this.state.humanPlayer = this.humanTeam;
    this.stats = { prompts: 0, retries: 0, humanPrompts: 0, botPrompts: 0, turns: 0, steps: 0, stopReason: '' };
    this.botMem = makeBotMemory();
    this.over = false;
    this._duelHandle = null;
  }
  _register() {
    const M = this.M, data = this.data, ccall = M.ccall;
    const cards = data.cards;
    for (const key of Object.keys(cards)) {
      const c = cards[key];
      const raceLo = c.race % 4294967296, raceHi = Math.floor(c.race / 4294967296);
      ccall('poc_register_card', null, ['number','number','string','number','number','number','number','number','number','number','number','number','number'],
        [c.code, c.alias, (c.setcodes || []).join(','), c.type, c.level, c.attribute, raceLo, raceHi, c.atk, c.def, c.lscale, c.rscale, c.link_marker]);
    }
    const enc = new TextEncoder();
    for (const name of Object.keys(data.scripts)) {
      const bytes = enc.encode(data.scripts[name]);
      const ptr = M._malloc(bytes.length);
      M.HEAPU8.set(bytes, ptr);
      ccall('poc_register_script_buf', null, ['string','number','number'], [name, ptr, bytes.length]);
      M._free(ptr);
    }
  }
  async run() {
    const M = this.M, ccall = M.ccall, opts = this.opts;
    const sleep = opts.sleep || sleepDefault;
    const pace = Object.assign({ bot: 520, botChain: 260, batch: 30 }, opts.pace || {});
    const log = opts.onLog || (() => {});
    this._register();
    const duel = ccall('poc_create', 'number', ['number','bigint','number','number','number'],
      [opts.seed || 20261102, BigInt(FLAGS_GENESIS), 8000, 5, 1]);
    if (!duel) throw new Error('OCG_CreateDuel failed');
    this._duelHandle = duel;
    let globalFails = 0;
    for (const g of GLOBALS_ORDER) {
      if (!(g in this.data.scripts)) { globalFails++; continue; }
      if (ccall('poc_load_global', 'number', ['number','string'], [duel, g]) !== 1) globalFails++;
    }
    log('global scripts: ' + (GLOBALS_ORDER.length - globalFails) + '/' + GLOBALS_ORDER.length + ' ok');
    const addDeck = (team, deck) => {
      // Shuffle fresh copies per duel (see "shuffling" note above): the core
      // deals the registered order verbatim, so registration order must
      // already be random. Copies keep data.decks pristine for rematches.
      const main = shuffledCopy(deck.main), extra = shuffledCopy(deck.extra);
      main.forEach((code, i) => ccall('poc_new_card', null, ['number','number','number','number','number','number','number','number'], [duel, team, 0, code, team, LOC.DECK, i, 1]));
      // Extra Deck cards MUST be registered face-down (POS.FD_DEF): the core
      // stores the position verbatim, and the contact-fusion procedure
      // condition (proc_fusion.lua Fusion.ContactCon) requires the fusion
      // monster to be IsFacedown() — with pos=1 (face-up) every contact
      // fusion was silently never offered. See NOTES "GG contact fusions".
      extra.forEach((code, i) => ccall('poc_new_card', null, ['number','number','number','number','number','number','number','number'], [duel, team, 0, code, team, LOC.EXTRA, i, POS.FD_DEF]));
    };
    addDeck(0, this.deckP0);
    addDeck(1, this.deckP1);
    ccall('poc_start', null, ['number'], [duel]);
    const scratch = ccall('poc_scratch', 'number', [], []);
    const respond = (bytes) => { M.HEAPU8.set(bytes, scratch); ccall('poc_respond', null, ['number','number'], [duel, bytes.length]); };

    const maxSteps = opts.maxSteps || 20000;
    let lastPromptKey = '', samePrompt = 0, lastPrompt = null, retryStreak = 0;
    while (this.stats.steps++ < maxSteps) {
      const status = ccall('poc_process', 'number', ['number'], [duel]);
      const len = ccall('poc_msg_len', 'number', [], []);
      const ptr = ccall('poc_msg_ptr', 'number', [], []);
      const buf = M.HEAPU8.slice(ptr, ptr + len);
      const msgs = splitMessages(buf);
      let pending = null, sawRetry = false;
      for (const m of msgs) {
        if (m[0] === 1) { this.stats.retries++; sawRetry = true; }
        if (opts.onMessage) opts.onMessage(m);
        this.state.apply(m);
        if (SELECT_TYPES.has(m[0])) pending = m;
      }
      if (opts.onUpdate) opts.onUpdate(this.state);
      if (this.state.winner !== null) { this.stats.stopReason = 'duel ended (MSG_WIN)'; this.over = true; break; }
      if (status === 0) { this.stats.stopReason = 'duel ended (status END)'; this.over = true; break; }
      if (status === 1) {
        let prompt = null;
        if (pending) {
          prompt = parsePrompt(pending);
          if (!prompt) { this.stats.stopReason = 'unparseable prompt type ' + pending[0]; break; }
          prompt.retryCount = 0;
          prompt.context = this.state.chainContext(); // source card of the asking effect (may be null)
          prompt.rawKey = pending[0] + ':' + Array.from(pending.slice(0, 24)).join(',');
          lastPrompt = prompt;
          retryStreak = 0;
        } else if (sawRetry && lastPrompt) {
          // MSG_RETRY: the core rejected the last answer and waits for a new
          // response to the SAME prompt — it does not re-send the prompt.
          if (++retryStreak > 12) { this.stats.stopReason = 'answer rejected repeatedly (' + lastPrompt.name + ')'; break; }
          prompt = lastPrompt;
          prompt.retryCount = retryStreak;
        } else {
          this.stats.stopReason = 'AWAITING but no select message';
          break;
        }
        const key = (prompt.rawKey || prompt.name) + '#' + (prompt.retryCount || 0);
        if (key === lastPromptKey && !prompt.retryCount) { if (++samePrompt > 8) { this.stats.stopReason = 'same prompt repeated >8 (' + prompt.name + ')'; break; } }
        else { samePrompt = 0; lastPromptKey = key; }
        this.stats.prompts++;
        let bytes;
        if (prompt.player === this.humanTeam && opts.humanAnswerer) {
          this.stats.humanPrompts++;
          bytes = await opts.humanAnswerer(maskPromptForHuman(prompt, this.state), this.state);
        } else {
          this.stats.botPrompts++;
          const wait = prompt.name === 'SELECT_CHAIN' ? pace.botChain : pace.bot;
          if (wait) await sleep(wait);
          // The CPU policy values monsters by their CURRENT atk/def; keep the
          // mirror's live stats fresh for the bot seat (the human path already
          // refreshes from client.js before answering).
          try { this.refreshFieldStats(); } catch (e) {}
          bytes = (opts.botAnswerer || botAnswer)(prompt, this.state, this.data, this.botMem);
        }
        if (!bytes) { this.stats.stopReason = 'answerer returned nothing for ' + prompt.name; break; }
        respond(bytes);
        // BU-12 (brushup round 3): one task boundary between the
        // answer and the next poc_process(). The core call that
        // completes a chain resolution and advances to the next
        // command prompt is a single synchronous WASM call
        // (isolated measurement: <= ~56 ms Node / ~37 ms page);
        // it cannot be split from JS — but the player's tap
        // feedback and the closing sheet get a paint first.
        // Uses the harness-provided sleep, so stubbed test sleeps
        // keep test timing unchanged. Nothing runs between
        // respond and process except this yield: processing
        // order and results are untouched.
        await sleep(0);
      } else if (pace.batch) {
        await sleep(pace.batch);
      }
    }
    if (!this.over) this.stats.stopReason = this.stats.stopReason || 'step cap';
    this.stats.turns = this.state.turnCount;
    ccall('poc_destroy', null, ['number'], [duel]);
    this._duelHandle = null;
    return this.stats;
  }
  // Live card query via the driver's OCG_DuelQuery bridge. Returns the parsed
  // TLV record set {code,pos,level,atk,def,baseAtk,baseDef} or null (empty slot
  // / duel not running). Record format is card::get_infos in card.cpp:
  // repeated [u16 recordLen][u32 flag][value (recordLen-4 bytes)], QUERY_END last.
  queryCard(con, loc, seq) {
    if (!this._duelHandle) return null;
    const M = this.M;
    const FLAGS = 0x1 | 0x2 | 0x10 | 0x100 | 0x200 | 0x400 | 0x800; // CODE, POSITION, LEVEL, ATK, DEF, BASE_ATK, BASE_DEF
    const len = M.ccall('poc_query_card', 'number', ['number','number','number','number','number'],
      [this._duelHandle, FLAGS, con, loc, seq]);
    if (!len) return null;
    const ptr = M.ccall('poc_query_ptr', 'number', [], []);
    const buf = M.HEAPU8.slice(ptr, ptr + len);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const out = {};
    let o = 0;
    while (o + 6 <= buf.length) {
      const recLen = dv.getUint16(o, true);
      if (recLen < 4 || o + 2 + recLen > buf.length) break;
      const flag = dv.getUint32(o + 2, true);
      if (flag === 0x80000000) break; // QUERY_END
      const v = o + 6;
      if (flag === 0x1) out.code = dv.getUint32(v, true);
      else if (flag === 0x2) out.pos = dv.getUint32(v, true);
      else if (flag === 0x10) out.level = dv.getUint32(v, true);
      else if (flag === 0x100) out.atk = dv.getInt32(v, true);
      else if (flag === 0x200) out.def = dv.getInt32(v, true);
      else if (flag === 0x400) out.baseAtk = dv.getInt32(v, true);
      else if (flag === 0x800) out.baseDef = dv.getInt32(v, true);
      o += 2 + recLen;
    }
    return out;
  }
  // Refresh current (effect-modified) ATK/DEF/level on every occupied monster
  // zone of the state mirror. Call at prompt boundaries / after message batches.
  refreshFieldStats() {
    const st = this.state;
    // Grave identities after MSG_SWAP_GRAVE_DECK: the new grave is the old
    // (face-down) deck, so the mirror holds unknown placeholders; the grave
    // is public, so refill every code from the core's own record — the same
    // re-identification pattern as MSG_SHUFFLE_SET_CARD below.
    if (st.graveResync && st.graveResync.size) {
      for (const p of Array.from(st.graveResync)) {
        const P = st.players[p];
        for (let s = 0; s < P.grave.length; s++) {
          const q = this.queryCard(p, LOC.GRAVE, s);
          if (q && q.code) P.grave[s] = q.code;
        }
        st.graveResync.delete(p);
      }
    }
    for (let p = 0; p < 2; p++) {
      for (let s = 0; s < 7; s++) {
        const cell = st.players[p].mzone[s];
        if (!cell) continue;
        const q = this.queryCard(p, LOC.MZONE, s);
        if (q) {
          const prevAtk = cell.curAtk, prevDef = cell.curDef;
          if (q.atk != null) cell.curAtk = q.atk;
          if (q.def != null) cell.curDef = q.def;
          if (q.level != null) cell.curLevel = q.level;
          if (q.pos != null) cell.queryPos = q.pos;
          // Detailed history: a live ATK/DEF change on a face-up,
          // identified monster is an outcome (effect modifiers
          // landing and expiring both pass through here). First
          // observation (prev undefined) is the baseline, never a
          // "change". Face-down stats are not public information.
          if (cell.code && (q.pos == null || (q.pos & POS_FACEUP))) {
            const parts = [];
            if (prevAtk != null && q.atk != null && prevAtk !== q.atk) parts.push('攻撃力 ' + prevAtk + ' → ' + q.atk);
            if (prevDef != null && q.def != null && prevDef !== q.def) parts.push('守備力 ' + prevDef + ' → ' + q.def);
            if (parts.length) st.pushDLog({ k: 'info', cid: st.chainCid(), sol: st.solvingLink, s: st.who(p) + '：' + st.nameOf(cell.code) + ' の' + parts.join('／') });
          }
          // A slot whose set cards were shuffled (MSG_SHUFFLE_SET_CARD) had
          // its code voided by the mirror — the wire hides the permutation.
          // The live query is the core's own record: re-identify from it.
          if (cell.shuffled && q.code) { cell.code = q.code; cell.shuffled = false; }
        }
      }
    }
    for (let p = 0; p < 2; p++) {
      for (let s = 0; s < 8; s++) {
        const cell = st.players[p].szone[s];
        if (!cell || !cell.shuffled) continue;
        const q = this.queryCard(p, LOC.SZONE, s);
        if (q && q.code) { cell.code = q.code; cell.shuffled = false; }
      }
    }
  }
}

const Engine = { MSG, SELECT_TYPES, PHASES, LOC, POS, POS_FACEUP, POS_ATTACK, POS_DEFENSE, FLAGS_GENESIS,
  ATTRIBUTES, RACES, Reader, splitMessages, i32resp, cancelResp, cardsResp, cmdResp, placeResp,
  counterResp, sortResp, unselectToggleResp, u64resp, parsePrompt, sumSelectionValid, isDeclarable,
  shuffledCopy, randBelow,
  GameState, botAnswer, makeBotMemory, botView, maskPromptForHuman, Duel };
// Diagnostic-only surface for the tuning harnesses (test-cpu-tune*.js):
// the policy's internal scorers, exposed read-only so a trace can name
// the exact gate/score that declined an offered play. Not used by the
// client or by any decision path.
Engine.debug = { activationScore, pickSummon, pickSpsummon, hasProfitableAttack,
  profitableAttackIfStood, attackPlans, attackScore, lethalPlan, bestAttackPlan, handValue, discardCost,
  boardValue, atkOf, defOf, battlePower, monList, faceUpMons, oppMaxPower,
  myStrongestAtk, levelOf, CC };
if (typeof module !== 'undefined') module.exports = Engine;
else global.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
