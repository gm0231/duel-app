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
const LOC = { DECK:0x01, HAND:0x02, MZONE:0x04, SZONE:0x08, GRAVE:0x10, REMOVED:0x20, EXTRA:0x40, OVERLAY:0x80 };
const POS = { FU_ATK:0x1, FD_ATK:0x2, FU_DEF:0x4, FD_DEF:0x8 };
const POS_FACEUP = 0x5, POS_ATTACK = 0x3, POS_DEFENSE = 0xC;
// DUEL_MODE_MR5 (ocgapi_constants.h) — same flags as the verified PoC.
const FLAGS_MR5 = 0x800 | 0x2000 | 0x40000 | 0x10000 | 0x80000 | 0x4000 | 0x8000 | 0x20000;
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
      extra: deck.extra.map(code => ({ code, pos: POS.FD_DEF })), // [{code, pos}]
      grave: [],                      // [code]
      removed: [],                    // [code]
      mzone: Array(7).fill(null),     // {code|null, pos, materials, curAtk?, curDef?}
      szone: Array(8).fill(null),     // {code|null, pos}
    });
    this.players = [mk(deckP0 || data.decks.ishizu), mk(deckP1 || data.decks.gg)];
    this.turnPlayer = 0; this.turnCount = 0; this.phase = 0; this.phaseName = '';
    this.chain = [];                  // [{code, con, loc, seq, desc, player, negated, disabled, solved}]
    this.solvingLink = 0;             // chain_count currently resolving (0 = building)
    this.winner = null; this.winReason = 0;
    this.lastAttack = null;           // {attacker, target|null}
    this.deckTop = [null, null];
    this.log = [];                    // recent event strings (system text only)
    this.events = [];                 // transient event queue for presentation (SE cues), drained by the client
  }
  nameOf(code) { return this.names[code] || ('#' + code); }
  who(p) { return p === this.humanPlayer ? '自分' : '相手'; }
  pushLog(s) { this.log.push(s); if (this.log.length > 60) this.log.shift(); }
  pushEvent(e) { this.events.push(e); if (this.events.length > 300) this.events.splice(0, this.events.length - 300); }
  // The card whose effect is currently asking something: the link being solved,
  // else the newest chain link. Used to give every prompt a visible source.
  chainContext() {
    if (this.solvingLink > 0 && this.chain[this.solvingLink - 1]) {
      const l = this.chain[this.solvingLink - 1];
      return { code: l.code, con: l.con, loc: l.loc, seq: l.seq, player: l.player, link: this.solvingLink };
    }
    if (this.chain.length) {
      const l = this.chain[this.chain.length - 1];
      return { code: l.code, con: l.con, loc: l.loc, seq: l.seq, player: l.player, link: this.chain.length };
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
  _removeAt(li, code) {
    const p = this.players[li.con]; if (!p) return;
    if (li.loc & LOC.OVERLAY) {
      const host = p.mzone[li.seq];
      if (host) host.materials = Math.max(0, host.materials - 1);
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
      const host = p.mzone[li.seq];
      if (host) host.materials++;
      return;
    }
    switch (li.loc) {
      case LOC.MZONE: p.mzone[li.seq] = { code, pos: li.pos, materials: 0 }; break;
      case LOC.SZONE: p.szone[li.seq] = { code, pos: li.pos }; break;
      case LOC.HAND: this._pileInsert(p.hand, li.seq, { code }); break;
      case LOC.GRAVE: this._pileInsert(p.grave, li.seq, code); break;
      case LOC.REMOVED: this._pileInsert(p.removed, li.seq, code); break;
      case LOC.EXTRA: this._pileInsert(p.extra, li.seq, { code, pos: li.pos }); break;
      case LOC.DECK: p.deckCount++; break;
    }
  }
  apply(msg) {
    const t = msg[0]; const r = new Reader(msg, 1);
    switch (t) {
      case 5: this.winner = r.u8(); this.winReason = r.u8(); break; // WIN
      case 40: this.turnPlayer = r.u8(); this.turnCount++; break; // NEW_TURN
      case 41: { const ph = r.u16(); this.phase = ph; this.phaseName = PHASES[ph] || ('PH' + ph); break; } // NEW_PHASE
      case 94: { const p = r.u8(); this.players[p].lp = r.i32(); break; } // LPUPDATE
      case 91: { const p = r.u8(); const amt = r.u32(); this.players[p].lp -= amt; this.pushLog(this.who(p) + 'に ' + amt + ' ダメージ'); this.pushEvent({ kind: 'damage', player: p, amount: amt }); break; } // DAMAGE
      case 92: { const p = r.u8(); const amt = r.u32(); this.players[p].lp += amt; this.pushEvent({ kind: 'recover', player: p, amount: amt }); break; } // RECOVER
      case 100: { const p = r.u8(); const amt = r.u32(); this.players[p].lp -= amt; break; } // PAY_LPCOST
      case 50: { // MOVE: code, from loc_info, to loc_info, reason
        const code = r.u32(); const from = r.locInfo(); const to = r.locInfo(); const reason = r.u32();
        if (code !== 0) { // code 0 = deck-internal reorder noise
          this._removeAt(from, code);
          if (to.loc !== 0) this._insertAt(to, code);
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
        }
        break;
      }
      case 90: { // DRAW: player, drawn u32, per card code u32 + pos u32
        const p = r.u8(); const n = r.u32();
        for (let i = 0; i < n; i++) { const code = r.u32(); r.u32(); this.players[p].hand.push({ code }); }
        this.players[p].deckCount = Math.max(0, this.players[p].deckCount - n);
        if (n > 0) this.pushLog(this.who(p) + '：' + n + ' 枚ドロー');
        break;
      }
      case 33: { // SHUFFLE_HAND: player, count u32, codes — exact new order
        const p = r.u8(); const n = r.u32(); const codes = [];
        for (let i = 0; i < n; i++) codes.push(r.u32());
        this.players[p].hand = codes.map(code => ({ code }));
        this.pushLog(this.who(p) + 'の手札をシャッフル（' + n + ' 枚）');
        break;
      }
      case 39: { // SHUFFLE_EXTRA: player, count u32, codes
        const p = r.u8(); const n = r.u32(); const extra = [];
        for (let i = 0; i < n; i++) extra.push({ code: r.u32(), pos: POS.FD_DEF });
        if (n) this.players[p].extra = extra;
        break;
      }
      case 32: break; // SHUFFLE_DECK: player only
      case 53: { // POS_CHANGE: code, con u8, loc u8, seq u8, prevPos u8, newPos u8
        const code = r.u32(); const con = r.u8(); const loc = r.u8(); const seq = r.u8(); r.u8(); const npos = r.u8();
        const zone = loc === LOC.MZONE ? this.players[con].mzone : this.players[con].szone;
        if (zone[seq]) { zone[seq].pos = npos; if (zone[seq].code == null) zone[seq].code = code; }
        break;
      }
      case 54: case 60: case 62: case 64: { // SET / SUMMONING / SPSUMMONING / FLIPSUMMONING: code + loc_info
        const code = r.u32(); const li = r.locInfo();
        const zone = li.loc === LOC.MZONE ? this.players[li.con].mzone : this.players[li.con].szone;
        if (zone[li.seq]) { zone[li.seq].code = code; zone[li.seq].pos = li.pos; }
        else if (li.loc === LOC.MZONE) this.players[li.con].mzone[li.seq] = { code, pos: li.pos, materials: 0 };
        else this.players[li.con].szone[li.seq] = { code, pos: li.pos };
        if (t === 54) { this.pushLog(this.who(li.con) + '：カードをセット'); this.pushEvent({ kind: 'set', code, con: li.con, loc: li.loc }); }
        if (t === 60) { this.pushLog(this.who(li.con) + '：' + this.nameOf(code) + ' を召喚'); this.pushEvent({ kind: 'summon', code, con: li.con }); }
        if (t === 62) { this.pushLog(this.who(li.con) + '：' + this.nameOf(code) + ' を特殊召喚'); this.pushEvent({ kind: 'spsummon', code, con: li.con }); }
        if (t === 64) this.pushEvent({ kind: 'flipsummon', code, con: li.con });
        break;
      }
      case 55: { // SWAP: code1, info1, code2, info2 — control swap, cards stay in their slots
        const c1 = r.u32(); const i1 = r.locInfo(); const c2 = r.u32(); const i2 = r.locInfo();
        const z1 = i1.loc === LOC.MZONE ? this.players[i1.con].mzone : this.players[i1.con].szone;
        const z2 = i2.loc === LOC.MZONE ? this.players[i2.con].mzone : this.players[i2.con].szone;
        const tmp = z1[i1.seq]; z1[i1.seq] = z2[i2.seq]; z2[i2.seq] = tmp;
        if (z1[i1.seq]) z1[i1.seq].code = c2;
        if (z2[i2.seq]) z2[i2.seq].code = c1;
        break;
      }
      case 70: { // CHAINING
        const code = r.u32(); const li = r.locInfo();
        const tcon = r.u8(); const tloc = r.u8(); const tseq = r.u32(); const desc = r.u64n(); r.u32();
        this.chain.push({ code, con: li.con, loc: li.loc, seq: li.seq, pos: li.pos, player: tcon,
                          tloc, tseq, desc, negated: false, disabled: false, solved: false });
        this.pushLog('チェーン' + this.chain.length + '：' + this.nameOf(code));
        this.pushEvent({ kind: 'activate', code, con: li.con, loc: li.loc });
        break;
      }
      case 72: this.solvingLink = r.u8(); break; // CHAIN_SOLVING
      case 73: { const n = r.u8(); const link = this.chain[n - 1]; if (link) link.solved = true; break; } // CHAIN_SOLVED
      case 75: { const n = r.u8(); const link = this.chain[n - 1]; if (link) link.negated = true; this.pushEvent({ kind: 'negate' }); break; } // CHAIN_NEGATED
      case 76: { const n = r.u8(); const link = this.chain[n - 1]; if (link) link.disabled = true; break; } // CHAIN_DISABLED
      case 74: this.chain = []; this.solvingLink = 0; break; // CHAIN_END
      case 110: { // ATTACK: attacker loc_info, target loc_info (zeroed = direct)
        const a = r.locInfo(); const tg = r.locInfo();
        this.lastAttack = { attacker: a, target: tg.loc === 0 ? null : tg };
        this.pushLog('攻撃宣言');
        const az = a.loc === LOC.MZONE ? this.players[a.con].mzone[a.seq] : null;
        this.pushEvent({ kind: 'attack', code: az ? az.code : null, con: a.con, direct: tg.loc === 0 });
        break;
      }
      case 31: { // CONFIRM_CARDS: shownPlayer, count u32, entries code+con+loc+seq — reveal knowledge
        const shown = r.u8(); const n = r.u32();
        for (let i = 0; i < n; i++) {
          const code = r.u32(); const con = r.u8(); const loc = r.u8(); const seq = r.u32();
          if (shown === 0 && loc === LOC.HAND && this.players[con].hand[seq]) this.players[con].hand[seq].code = code;
          if (shown === 0 && loc === LOC.DECK && seq === this.players[con].deckCount - 1) this.deckTop[con] = code;
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
    return P.deckCount + P.hand.length + P.extra.length + P.grave.length + P.removed.length +
      P.mzone.reduce((a, c) => a + (c ? 1 + (c.materials || 0) : 0), 0) +
      P.szone.reduce((a, c) => a + (c ? 1 : 0), 0);
  }
}

// ---------------------------------------------------------------- bot policy
// Simple legal-answer policy ported from the verified PoC bot (same choices),
// operating on parsed prompts. Used for the CPU seat (player 1) and, in the
// Node harness, for the simulated-human seat (player 0).
function makeBotMemory() { return { summonedYet: false }; }
function botAnswer(prompt, state, data, mem) {
  const cards = data.cards;
  switch (prompt.name) {
    case 'SELECT_CHAIN':
      return i32resp(prompt.forced ? 0 : -1);
    case 'SELECT_IDLECMD': {
      if (!mem.summonedYet) {
        const idx = prompt.summon.findIndex(e => (cards[e.code] && (cards[e.code].level || 0) <= 4));
        if (idx >= 0) { mem.summonedYet = true; return cmdResp(0, idx); }
      }
      if (prompt.toEP) return cmdResp(7, 0);
      if (prompt.toBP) return cmdResp(6, 0);
      return cmdResp(7, 0);
    }
    case 'SELECT_BATTLECMD': {
      if (prompt.attack.length) return cmdResp(1, 0);
      if (prompt.toEP) return cmdResp(3, 0);
      if (prompt.toM2) return cmdResp(2, 0);
      return cmdResp(3, 0);
    }
    case 'SELECT_POSITION': {
      for (const p of [POS.FU_ATK, POS.FU_DEF, POS.FD_ATK, POS.FD_DEF]) if (prompt.mask & p) return i32resp(p);
      return i32resp(prompt.mask);
    }
    case 'SELECT_CARD': case 'SELECT_TRIBUTE': {
      if (prompt.cancelable && prompt.min === 0) return cardsResp([]);
      let picks = [];
      if (prompt.name === 'SELECT_TRIBUTE') {
        const order = prompt.cards.map((c, i) => i).sort((a, b) => prompt.cards[a].releaseParam - prompt.cards[b].releaseParam);
        let sum = 0;
        for (const i of order) { if (sum >= prompt.min) break; picks.push(i); sum += prompt.cards[i].releaseParam; }
      } else {
        for (let i = 0; i < Math.min(prompt.min, prompt.cards.length); i++) picks.push(i);
      }
      return cardsResp(picks);
    }
    case 'SELECT_UNSELECT_CARD': {
      if (prompt.finishable || prompt.cancelable) return cancelResp();
      return unselectToggleResp(0);
    }
    case 'SELECT_SUM': {
      // greedy DFS for a valid subset (small n in practice)
      const n = prompt.cards.length;
      const chosen = [];
      const dfs = (start) => {
        if (sumSelectionValid(prompt, chosen)) return true;
        if (chosen.length >= Math.min(prompt.max || n, n) && prompt.mode === 'exact') return false;
        for (let i = start; i < n; i++) {
          chosen.push(i);
          if (dfs(i + 1)) return true;
          chosen.pop();
        }
        return false;
      };
      dfs(0);
      return cardsResp(chosen);
    }
    case 'SELECT_COUNTER': {
      const amounts = prompt.cards.map(() => 0);
      let remaining = prompt.count;
      prompt.cards.forEach((c, i) => { const take = Math.min(remaining, c.count); amounts[i] = take; remaining -= take; });
      return counterResp(amounts);
    }
    case 'SELECT_PLACE': case 'SELECT_DISFIELD': {
      const avail = (~prompt.flag) >>> 0;
      const zones = [];
      const order = [2, 3, 1, 4, 0, 5, 6];
      for (const s of order) { if (zones.length >= prompt.count) break; if (avail & (1 << s)) zones.push({ con: prompt.player, loc: LOC.MZONE, seq: s }); }
      for (let s = 0; zones.length < prompt.count && s < 5; s++) if (avail & (0x100 << s)) zones.push({ con: prompt.player, loc: LOC.SZONE, seq: s });
      for (const s of order) { if (zones.length >= prompt.count) break; if (avail & (0x10000 << s)) zones.push({ con: 1 - prompt.player, loc: LOC.MZONE, seq: s }); }
      for (let s = 0; zones.length < prompt.count && s < 5; s++) if (avail & (0x1000000 << s)) zones.push({ con: 1 - prompt.player, loc: LOC.SZONE, seq: s });
      // pendulum-zone bits (own 14/15 -> szone 6/7, opp 30/31)
      if (zones.length < prompt.count && (avail & 0x4000)) zones.push({ con: prompt.player, loc: LOC.SZONE, seq: 6 });
      if (zones.length < prompt.count && (avail & 0x8000)) zones.push({ con: prompt.player, loc: LOC.SZONE, seq: 7 });
      if (zones.length < prompt.count && (avail & 0x40000000)) zones.push({ con: 1 - prompt.player, loc: LOC.SZONE, seq: 6 });
      if (zones.length < prompt.count && (avail & 0x80000000)) zones.push({ con: 1 - prompt.player, loc: LOC.SZONE, seq: 7 });
      return placeResp(zones.slice(0, prompt.count));
    }
    case 'SELECT_YESNO': case 'SELECT_EFFECTYN': return i32resp(0);
    case 'SELECT_OPTION': return i32resp(0);
    case 'SORT_CARD': return sortResp(prompt.cards.map((_, i) => i));
    case 'SORT_CHAIN': return cancelResp();
    case 'ROCK_PAPER_SCISSORS': return i32resp(1);
    case 'ANNOUNCE_RACE': {
      let lo = 0, hi = 0, need = prompt.count;
      for (let b = 0; b < 32 && need > 0; b++) if (prompt.availLo & (1 << b)) { lo |= (1 << b); need--; }
      for (let b = 0; b < 32 && need > 0; b++) if (prompt.availHi & (1 << b)) { hi |= (1 << b); need--; }
      return u64resp(lo, hi);
    }
    case 'ANNOUNCE_ATTRIB': {
      let mask = 0, need = prompt.count;
      for (let b = 0; b < 32 && need > 0; b++) if (prompt.avail & (1 << b)) { mask |= (1 << b); need--; }
      return i32resp(mask);
    }
    case 'ANNOUNCE_CARD': return i32resp(data.decks.ishizu.main[0]);
    case 'ANNOUNCE_NUMBER': return i32resp(0);
  }
  return i32resp(0);
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
      [opts.seed || 20261102, BigInt(FLAGS_MR5), 8000, 5, 1]);
    if (!duel) throw new Error('OCG_CreateDuel failed');
    this._duelHandle = duel;
    let globalFails = 0;
    for (const g of GLOBALS_ORDER) {
      if (!(g in this.data.scripts)) { globalFails++; continue; }
      if (ccall('poc_load_global', 'number', ['number','string'], [duel, g]) !== 1) globalFails++;
    }
    log('global scripts: ' + (GLOBALS_ORDER.length - globalFails) + '/' + GLOBALS_ORDER.length + ' ok');
    const addDeck = (team, deck) => {
      deck.main.forEach((code, i) => ccall('poc_new_card', null, ['number','number','number','number','number','number','number','number'], [duel, team, 0, code, team, LOC.DECK, i, 1]));
      deck.extra.forEach((code, i) => ccall('poc_new_card', null, ['number','number','number','number','number','number','number','number'], [duel, team, 0, code, team, LOC.EXTRA, i, 1]));
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
          bytes = await opts.humanAnswerer(prompt, this.state);
        } else {
          this.stats.botPrompts++;
          const wait = prompt.name === 'SELECT_CHAIN' ? pace.botChain : pace.bot;
          if (wait) await sleep(wait);
          bytes = (opts.botAnswerer || botAnswer)(prompt, this.state, this.data, this.botMem);
        }
        if (!bytes) { this.stats.stopReason = 'answerer returned nothing for ' + prompt.name; break; }
        respond(bytes);
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
    for (let p = 0; p < 2; p++) {
      for (let s = 0; s < 7; s++) {
        const cell = st.players[p].mzone[s];
        if (!cell) continue;
        const q = this.queryCard(p, LOC.MZONE, s);
        if (q) {
          if (q.atk != null) cell.curAtk = q.atk;
          if (q.def != null) cell.curDef = q.def;
          if (q.level != null) cell.curLevel = q.level;
          if (q.pos != null) cell.queryPos = q.pos;
        }
      }
    }
  }
}

const Engine = { MSG, SELECT_TYPES, PHASES, LOC, POS, POS_FACEUP, POS_ATTACK, POS_DEFENSE, FLAGS_MR5,
  ATTRIBUTES, RACES, Reader, splitMessages, i32resp, cancelResp, cardsResp, cmdResp, placeResp,
  counterResp, sortResp, unselectToggleResp, u64resp, parsePrompt, sumSelectionValid, isDeclarable,
  GameState, botAnswer, makeBotMemory, Duel };
if (typeof module !== 'undefined') module.exports = Engine;
else global.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
