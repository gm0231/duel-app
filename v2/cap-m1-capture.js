'use strict';
/* cap-m1-capture.js — capture a REAL 墓守の罠② discard prompt
 * (SELECT_CARD, HINTMSG_DISCARD 501) from a scripted core duel,
 * verbatim, for the M1 first-render rig. The human (Ishizu, seat 0)
 * sets 墓守の罠 from hand at the first chance and activates its ②
 * at the next Main Phase; the discard-cost prompt is saved to the
 * workspace scratch dir (never /tmp — round 3 lost its evidence
 * to a /tmp reset). Seeds are tried until the prompt is captured.
 * Usage: node cap-m1-capture.js [maxSeed] */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));

const V2 = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const OUTDIR = '/home/hatch/workspace/.lf5-scratch';
fs.mkdirSync(OUTDIR, { recursive: true });
const OUT = path.join(OUTDIR, 'm1-discard-prompt.json');
const MAXSEED = +(process.argv[2] || 12);

const TRAP = 98715423, KELDO = 63542003, ZOLGA = 31525442, MUDRA = 99937011, KERBEK = 25926710;

function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; } return a; } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}

class Captured extends Error {}

function makeHuman(capture, log) {
  const { i32resp, cancelResp, cardsResp, cmdResp, placeResp, sortResp, unselectToggleResp, POS, LOC } = Engine;
  let prompts = 0;
  return (prompt, state) => {
    if (++prompts > 4000) throw new Error('budget');
    switch (prompt.name) {
      case 'SELECT_IDLECMD': {
        // 墓守の罠② first: a set copy in the activate list.
        const ti = prompt.activate.findIndex(e => e.code === TRAP);
        if (ti >= 0) { log.push('activate trap desc=' + prompt.activate[ti].desc + ' loc=' + prompt.activate[ti].loc); return cmdResp(5, ti); }
        // set the trap from hand at the first chance
        const si = prompt.sset.findIndex(e => e.code === TRAP);
        if (si >= 0) { log.push('set trap'); return cmdResp(4, si); }
        // minimal Ishizu line (round-4 scripted seat)
        const myMons = state.players[0].mzone.filter(Boolean).length;
        if (myMons >= 1) {
          const ai = prompt.activate.findIndex(e => (e.code === KELDO || e.code === MUDRA) && e.loc === LOC.HAND);
          if (ai >= 0) return cmdResp(5, ai);
          const zi = prompt.spsummon.findIndex(e => e.code === ZOLGA);
          if (zi >= 0) return cmdResp(1, zi);
        }
        if (prompt.summon.length) return cmdResp(0, 0);
        if (myMons === 0) {
          const ai = prompt.activate.findIndex(e => (e.code === KELDO || e.code === MUDRA) && e.loc === LOC.HAND);
          if (ai >= 0 && state.players[0].hand.length >= 3) return cmdResp(5, ai);
        }
        if (prompt.toEP) return cmdResp(7, 0);
        if (prompt.toBP) return cmdResp(6, 0);
        return cmdResp(7, 0);
      }
      case 'SELECT_BATTLECMD': {
        if (prompt.toEP) return cmdResp(3, 0);
        if (prompt.toM2) return cmdResp(2, 0);
        return cmdResp(3, 0);
      }
      case 'SELECT_CHAIN': return cancelResp();
      case 'SELECT_EFFECTYN': case 'SELECT_YESNO': return i32resp(0);
      case 'SELECT_OPTION': return i32resp(0);
      case 'SELECT_POSITION': return i32resp(POS.FU_ATK);
      case 'SELECT_PLACE': case 'SELECT_DISFIELD': {
        const avail = (~prompt.flag) >>> 0; const zones = [];
        for (const s of [0, 1, 2, 3, 4]) { if (zones.length >= prompt.count) break; if (avail & (1 << s)) zones.push({ con: prompt.player, loc: LOC.MZONE, seq: s }); }
        for (let s = 0; zones.length < prompt.count && s < 5; s++) if (avail & (0x100 << s)) zones.push({ con: prompt.player, loc: LOC.SZONE, seq: s });
        return placeResp(zones.slice(0, prompt.count));
      }
      case 'SELECT_CARD': case 'SELECT_TRIBUTE': {
        if (prompt.selectHint === 501 || (prompt.context && prompt.context.code === TRAP)) {
          capture.prompt = JSON.parse(JSON.stringify(prompt));
          capture.log = log.slice();
          throw new Captured('discard prompt captured');
        }
        if (prompt.cancelable && prompt.min === 0) return cardsResp([]);
        const picks = [];
        const order = prompt.cards.map((c, i) => i).sort((a, b) => {
          const rank = (c) => c.code === KERBEK ? 0 : c.code === ZOLGA ? 1 : 2;
          return rank(prompt.cards[a]) - rank(prompt.cards[b]);
        });
        for (const i of order) { if (picks.length >= Math.max(1, prompt.min)) break; picks.push(i); }
        return cardsResp(picks);
      }
      case 'SELECT_UNSELECT_CARD': {
        if (prompt.unselect.length >= prompt.min && prompt.finishable) return cancelResp();
        if (prompt.select.length) return unselectToggleResp(0);
        return cancelResp();
      }
      case 'SELECT_SUM': {
        const picks = [];
        for (let i = 0; i < prompt.cards.length && picks.length < prompt.min; i++) picks.push(i);
        return cardsResp(picks);
      }
      case 'SORT_CARD': return sortResp(prompt.cards.map((_, i) => i));
      case 'SORT_CHAIN': return cancelResp();
      case 'ROCK_PAPER_SCISSORS': return i32resp(1);
      case 'ANNOUNCE_RACE': case 'ANNOUNCE_ATTRIB': case 'ANNOUNCE_CARD': case 'ANNOUNCE_NUMBER': return i32resp(0);
      case 'SELECT_COUNTER': return Engine.counterResp(prompt.cards.map(() => 0));
      default: return i32resp(0);
    }
  };
}

(async () => {
  const M = await factory();
  for (let seed = 1; seed <= MAXSEED; seed++) {
    installSeededCrypto((seed * 2654435761) % 4294967296);
    const capture = {};
    const log = [];
    const duel = new Engine.Duel(M, data, {
      seed, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
      deckP0: data.decks.ishizu, deckP1: data.decks.gg, humanTeam: 0, onLog: () => {},
      onMessage: () => {},
      onUpdate: () => {},
      humanAnswerer: async (p, s) => makeHuman(capture, log)(p, s),
      botAnswerer: (p, s) => Engine.botAnswer(p, s, data, Engine.makeBotMemory()),
    });
    try {
      await duel.run();
      console.log('seed', seed, 'no capture; human log:', JSON.stringify(log));
    } catch (e) {
      if (e instanceof Captured) {
        const p = capture.prompt;
        console.log('seed', seed, 'CAPTURED: name=' + p.name, 'min/max=' + p.min + '/' + p.max,
          'cancelable=' + p.cancelable, 'selectHint=' + p.selectHint,
          'cards=' + p.cards.length, 'context=' + JSON.stringify(p.context));
        console.log('  human log:', JSON.stringify(capture.log));
        console.log('  card codes:', p.cards.map(c => c.code).join(','));
        fs.writeFileSync(OUT, JSON.stringify(p, null, 1));
        console.log('saved to', OUT);
        process.exit(0);
      }
      console.log('seed', seed, 'error:', String(e).slice(0, 200), '; human log:', JSON.stringify(log));
    }
  }
  console.log('NO CAPTURE in seeds 1..' + MAXSEED);
  process.exit(1);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
