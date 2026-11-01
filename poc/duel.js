'use strict';
/* Shared driver + simple answering bot for the ocgcore WASM PoC.
   Works in Node (run.js) and in the browser (index.html). */
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
const LOC_DECK = 0x01, LOC_EXTRA = 0x40, LOC_MZONE = 0x04, LOC_SZONE = 0x08;
// DUEL_MODE_MR5 as defined in ocgapi_constants.h
const FLAGS_MR5 = 0x800 /*PZONE*/ | 0x2000 /*EMZONE*/ | 0x40000 /*SPSUMMON_ONCE_OLD_NEGATE*/ |
                  0x10000 /*RETURN_TO_DECK_TRIGGERS*/ | 0x80000 /*CANNOT_SUMMON_OATH_OLD*/ |
                  0x4000 /*FSX_MMZONE*/ | 0x8000 /*TRAP_MONSTERS_NOT_USE_ZONE*/ | 0x20000 /*TRIGGER_ONLY_IN_LOCATION*/;
const GLOBALS_ORDER = ['constant.lua','archetype_setcode_constants.lua','card_counter_constants.lua','utility.lua',
  'cards_specific_functions.lua','chain.lua','deprecated_functions.lua','proc_equip.lua','proc_fusion.lua',
  'proc_fusion_spell.lua','proc_gemini.lua','proc_link.lua','proc_maximum.lua','proc_normal.lua','proc_pendulum.lua',
  'proc_persistent.lua','proc_ritual.lua','proc_rush.lua','proc_skill.lua','proc_spirit.lua','proc_synchro.lua',
  'proc_union.lua','proc_workaround.lua','proc_xyz.lua'];

class Reader {
  constructor(buf, off) { this.b = buf; this.o = off || 0; }
  u8() { return this.b[this.o++]; }
  u16() { const v = this.b[this.o] | (this.b[this.o+1] << 8); this.o += 2; return v; }
  u32() { const v = (this.b[this.o] | (this.b[this.o+1] << 8) | (this.b[this.o+2] << 16) | (this.b[this.o+3] << 24)) >>> 0; this.o += 4; return v; }
  i32() { return this.u32() | 0; }
  u64() { const lo = this.u32(), hi = this.u32(); return lo + hi * 4294967296; }
  bytes(n) { const v = this.b.subarray(this.o, this.o + n); this.o += n; return v; }
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
function i32resp(v) { const a = new Uint8Array(4); new DataView(a.buffer).setInt32(0, v, true); return a; }

async function runDuel(M, data, log) {
  const ccall = M.ccall;
  const cards = data.cards, names = data.names || {};
  const nameOf = c => names[c] || ('#' + c);
  // register cards
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
  const duel = ccall('poc_create', 'number', ['number','bigint','number','number','number'], [20261102, BigInt(FLAGS_MR5), 8000, 5, 1]);
  if (!duel) throw new Error('OCG_CreateDuel failed');
  log('duel created (handle ' + duel + '), flags=MR5 0x' + FLAGS_MR5.toString(16));
  let globalFails = 0;
  for (const g of GLOBALS_ORDER) {
    if (!(g in data.scripts)) { log('global script missing from bundle: ' + g); globalFails++; continue; }
    const r = ccall('poc_load_global', 'number', ['number','string'], [duel, g]);
    if (r !== 1) { log('global script load returned ' + r + ': ' + g); globalFails++; }
  }
  log('global scripts loaded (' + (GLOBALS_ORDER.length - globalFails) + '/' + GLOBALS_ORDER.length + ' ok)');
  const addDeck = (team, deck) => {
    // v11 API: duelist MUST be 0 for a normal duel (nonzero = tag-duel reserve deck)
    deck.main.forEach((code, i) => ccall('poc_new_card', null, ['number','number','number','number','number','number','number','number'], [duel, team, 0, code, team, LOC_DECK, i, 1]));
    deck.extra.forEach((code, i) => ccall('poc_new_card', null, ['number','number','number','number','number','number','number','number'], [duel, team, 0, code, team, LOC_EXTRA, i, 1]));
  };
  addDeck(0, data.decks.ishizu);
  addDeck(1, data.decks.gg);
  log('decks loaded: P0 ishizu ' + data.decks.ishizu.main.length + '+' + data.decks.ishizu.extra.length +
      ' / P1 gg ' + data.decks.gg.main.length + '+' + data.decks.gg.extra.length);
  ccall('poc_start', null, ['number'], [duel]);

  const scratch = ccall('poc_scratch', 'number', [], []);
  const respond = (bytes) => {
    M.HEAPU8.set(bytes, scratch);
    ccall('poc_respond', null, ['number','number'], [duel, bytes.length]);
  };
  const summonedYet = {0: false, 1: false};
  let placeAttempts = 0, lastPromptKey = '';
  const hist = {}; const phasesSeen = []; const tailMsgs = []; let prompts = 0, retries = 0, turns = 0;
  const firstPrompts = [];

  function answer(msg) {
    const type = msg[0], r = new Reader(msg, 1);
    switch (type) {
      case 16: { // SELECT_CHAIN
        const player = r.u8(); r.u8(); const forced = r.u8();
        return { bytes: i32resp(forced ? 0 : -1), why: 'chain ' + (forced ? 'forced->first' : 'pass') + ' (P' + player + ')' };
      }
      case 11: { // SELECT_IDLECMD
        const player = r.u8();
        const lists = [];
        const sizes = [10, 10, 7, 10, 10]; // code+con+loc+seq(u32)=10B; repositionable seq is u8 -> 7B (per playerop.cpp write side)
        for (let li = 0; li < 5; li++) {
          const n = r.u32();
          if (n > 200) throw new Error('IDLECMD list ' + li + ' count insane: ' + n + ' msg hex: ' + Array.from(msg.slice(0, 64)).join(' '));
          const entries = [];
          for (let i = 0; i < n; i++) { const code = r.u32(); entries.push(code); r.bytes(sizes[li] - 4); }
          lists.push(entries);
        }
        const nAct = r.u32(); r.bytes(nAct * 19);
        const toBP = r.u8(), toEP = r.u8(); r.u8();
        if (!summonedYet[player]) {
          const idx = lists[0].findIndex(code => (cards[code] && (cards[code].level || 0) <= 4));
          if (idx >= 0) { summonedYet[player] = true; return { bytes: i32resp((idx << 16) | 0), why: 'normal summon ' + nameOf(lists[0][idx]) + ' (P' + player + ')' }; }
        }
        if (toEP) return { bytes: i32resp(7), why: 'idle -> end phase (P' + player + ', toBP=' + toBP + ')' };
        if (toBP) return { bytes: i32resp(6), why: 'idle -> battle phase (P' + player + ')' };
        return { bytes: i32resp(7), why: 'idle -> end phase (forced try)' };
      }
      case 10: { // SELECT_BATTLECMD
        const player = r.u8();
        const nAct = r.u32(); r.bytes(nAct * 19);
        const nAtk = r.u32(); r.bytes(nAtk * 8);
        const toM2 = r.u8(), toEP = r.u8();
        if (toEP) return { bytes: i32resp(3), why: 'battle -> end phase (P' + player + ')' };
        if (toM2) return { bytes: i32resp(2), why: 'battle -> main2 (P' + player + ')' };
        return { bytes: i32resp((0 << 16) | 1), why: 'battle -> attack first (P' + player + ')' };
      }
      case 19: { // SELECT_POSITION
        r.u8(); r.u32(); const mask = r.u8();
        for (const p of [1, 4, 2, 8]) if (mask & p) return { bytes: i32resp(p), why: 'position ' + p };
        return { bytes: i32resp(mask), why: 'position raw ' + mask };
      }
      case 15: case 20: case 26: { // SELECT_CARD / TRIBUTE / UNSELECT_CARD
        const player = r.u8(); const cancelable = r.u8();
        const min = r.u32(), max = r.u32(), count = r.u32();
        const picks = [];
        for (let i = 0; i < Math.min(min, count); i++) picks.push(i);
        const out = new Uint8Array(8 + picks.length);
        new DataView(out.buffer).setInt32(0, 2, true);
        new DataView(out.buffer).setUint32(4, picks.length, true);
        picks.forEach((p, i) => { out[8 + i] = p; });
        return { bytes: out, why: 'select ' + picks.length + '/' + count + ' cards (min ' + min + ', P' + player + ')' };
      }
      case 18: case 24: { // SELECT_PLACE / DISFIELD
        const player = r.u8(); const count = r.u8(); const flag = r.u32();
        const avail = (~flag) >>> 0;
        const zones = [];
        // interpretation A: bits 0-6 = asked player's MZONE, 8-12 SZONE; 16-22 / 24-28 opponent
        const mz = avail & 0x7f, sz = (avail >> 8) & 0x1f;
        const order = [2, 3, 1, 4, 0, 5, 6];
        for (const s of order) { if (zones.length >= count) break; if (mz & (1 << s)) zones.push([player, LOC_MZONE, s]); }
        for (let s = 0; zones.length < count && s < 5; s++) if (sz & (1 << s)) zones.push([player, LOC_SZONE, s]);
        const bytes = new Uint8Array(zones.length * 3);
        zones.forEach((z, i) => { bytes[i*3] = z[0]; bytes[i*3+1] = z[1]; bytes[i*3+2] = z[2]; });
        return { bytes, why: 'place ' + zones.map(z => 'P' + z[0] + ' loc' + z[1] + ' seq' + z[2]).join(',') };
      }
      case 13: return { bytes: i32resp(0), why: 'yesno -> no' };
      case 12: return { bytes: i32resp(0), why: 'effectyn -> no' };
      case 14: return { bytes: i32resp(0), why: 'option -> 0' };
      case 25: { // SORT_CARD: identity order
        const player = r.u8(); const count = r.u8();
        const idx = []; for (let i = 0; i < count; i++) idx.push(i);
        return { bytes: new Uint8Array(idx), why: 'sort card identity (P' + player + ')' };
      }
      case 21: return { bytes: i32resp(-1), why: 'sort chain -> keep' };
      case 132: return { bytes: i32resp(1), why: 'rps -> 1' };
      case 140: case 141: { // ANNOUNCE_RACE / ATTRIB: first listed value
        r.u8(); const n = r.u8(); const first = type === 140 ? r.u64() : r.u32();
        return { bytes: i32resp(first | 0), why: 'announce first of ' + n };
      }
      case 142: { // ANNOUNCE_CARD: answer with a code from P0 deck
        return { bytes: i32resp(data.decks.ishizu.main[0]), why: 'announce card -> deck code' };
      }
      case 143: { // ANNOUNCE_NUMBER
        r.u8(); const n = r.u8(); const first = r.u32();
        return { bytes: i32resp(first), why: 'announce number first of ' + n };
      }
      default:
        return null;
    }
  }

  let status = 2, steps = 0, stopReason = 'step cap', retryOnly = 0, winInfo = null;
  while (steps++ < 3000) {
    status = ccall('poc_process', 'number', ['number'], [duel]);
    const len = ccall('poc_msg_len', 'number', [], []);
    const ptr = ccall('poc_msg_ptr', 'number', [], []);
    const buf = M.HEAPU8.slice(ptr, ptr + len);
    const msgs = splitMessages(buf);
    let pending = null;
    for (const m of msgs) {
      const t = m[0]; hist[MSG[t] || ('MSG_' + t)] = (hist[MSG[t] || ('MSG_' + t)] || 0) + 1;
      if (t === 1) retries++;
      if (t === 5) { winInfo = { winner: m[1], reason: m[2], turn: turns }; log('MSG_WIN: winner=P' + m[1] + ' reason=' + m[2] + ' (1=LP, 2=deck-out) at turn ' + turns); }
      if (t === 40) { turns++; }
      if (t === 41) { const rr = new Reader(m, 1); const ph = rr.u16(); const nm = (PHASES[ph] || ('PH' + ph)); if (phasesSeen[phasesSeen.length-1] !== nm) phasesSeen.push(nm); }
      if (SELECT_TYPES.has(t)) pending = m;
      tailMsgs.push(MSG[t] || ('MSG_' + t)); if (tailMsgs.length > 8) tailMsgs.shift();
    }
    if (winInfo) { stopReason = 'duel ended (MSG_WIN received)'; break; }
    if (status === 0) { stopReason = 'duel ended (OCG_DUEL_STATUS_END)'; break; }
    if (status === 1) {
      if (!pending) {
        if (msgs.some(m => m[0] === 1) && ++retryOnly < 10) continue;
        stopReason = 'AWAITING but no select message in buffer';
        break;
      }
      prompts++;
      const key = pending[0] + ':' + Array.from(pending.slice(0, 12)).join(',');
      if (key === lastPromptKey) placeAttempts++; else { placeAttempts = 0; lastPromptKey = key; }
      if (placeAttempts > 5) { stopReason = 'same prompt repeated >5 times (' + (MSG[pending[0]] || pending[0]) + ') — bot answer rejected?'; break; }
      const ans = answer(pending);
      if (firstPrompts.length < 12) firstPrompts.push((MSG[pending[0]] || pending[0]) + (ans ? ' -> ' + ans.why : ' -> UNHANDLED'));
      if (!ans) { stopReason = 'unhandled prompt ' + (MSG[pending[0]] || pending[0]) + ' (hex: ' + Array.from(pending.slice(0, 24)).map(x => x.toString(16).padStart(2, '0')).join(' ') + ')'; break; }
      respond(ans.bytes);
    }
  }
  const summary = { status, steps, turns, prompts, retries, stopReason, winInfo, tailMsgs, phasesSeen: phasesSeen.slice(0, 16), firstPrompts, hist };
  log('--- summary ---');
  log(JSON.stringify(summary, null, 1));
  ccall('poc_destroy', null, ['number'], [duel]);
  return summary;
}
if (typeof module !== 'undefined') module.exports = { runDuel };
