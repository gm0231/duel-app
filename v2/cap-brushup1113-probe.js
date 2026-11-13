'use strict';
/* cap-brushup1113-probe.js — BU-20261113-01 investigation rig.
 * Question: in the opponent's DRAW phase, is the Gravekeeper's Trap
 * confirmation presented TWICE for one core timing (client
 * re-presentation), or does the CORE itself deliver two prompts at
 * two distinct timings (spec)?
 * Method: engine-level real duels (Ishizu human seat vs GG bot).
 * The human policy sets 墓守の罠 at the first chance and then passes
 * EVERY confirmation. Every human prompt is recorded with the raw
 * core message stream that arrived since the previous human prompt,
 * so the events between two trap prompts are visible verbatim.
 * Usage: node cap-brushup1113-probe.js [maxSeeds] */
const fs = require('fs');
const path = require('path');
const V2 = __dirname;
const factory = require(path.join(V2, 'build', 'ocgcore.js'));
const Engine = require(path.join(V2, 'engine.js'));
const { MSG, LOC, POS_FACEUP } = Engine;
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const TRAP = 98715423;
const MAXSEEDS = +(process.argv[2] || 16);

function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; } return a; } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}
const msgName = (m) => MSG[m[0]] || ('#' + m[0]);

(async () => {
  const M = await factory();
  const report = [];
  let goodPhases = 0;
  for (let seed = 1; seed <= MAXSEEDS && goodPhases < 4; seed++) {
    installSeededCrypto(seed * 7919 + 13);
    const stream = [];
    const humanMem = Engine.makeBotMemory();
    let trapSet = false;
    const prompts = [];
    const humanAnswerer = async (prompt, state) => {
      const since = stream.splice(0, stream.length);
      const rec = {
        turn: state.turnCount, tp: state.turnPlayer, phase: state.phaseName, name: prompt.name,
        since: since.slice(-40),
      };
      if (prompt.name === 'SELECT_CHAIN') {
        rec.entries = (prompt.entries || []).map(e => ({ code: e.code, desc: String(e.desc) }));
        rec.forced = !!prompt.forced;
        rec.hasTrap = rec.entries.some(e => e.code === TRAP);
      }
      if (prompt.name === 'SELECT_EFFECTYN' || prompt.name === 'SELECT_YESNO') {
        rec.code = prompt.code; rec.desc = String(prompt.desc);
      }
      prompts.push(rec);
      switch (prompt.name) {
        case 'SELECT_IDLECMD': {
          const si = (prompt.sset || []).findIndex(e => e.code === TRAP);
          if (si >= 0 && !trapSet) { trapSet = true; return Engine.cmdResp(4, si); }
          if (prompt.toEP) return Engine.cmdResp(7, 0);
          if (prompt.toBP) return Engine.cmdResp(6, 0);
          return Engine.cmdResp(7, 0);
        }
        case 'SELECT_BATTLECMD':
          if (prompt.toEP) return Engine.cmdResp(3, 0);
          if (prompt.toM2) return Engine.cmdResp(2, 0);
          return Engine.cmdResp(3, 0);
        case 'SELECT_CHAIN': return Engine.i32resp(prompt.forced ? 0 : -1);
        case 'SELECT_EFFECTYN': case 'SELECT_YESNO': return Engine.i32resp(0);
        case 'SELECT_POSITION': return Engine.i32resp([1, 4, 2, 8].find(x => prompt.mask & x) || prompt.mask);
        default: return Engine.botAnswer(prompt, state, data, humanMem);
      }
    };
    const duel = new Engine.Duel(M, data, {
      seed, deckP0: data.decks.ishizu, deckP1: data.decks.gg,
      humanTeam: 0, humanAnswerer,
      pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), maxSteps: 20000,
      onMessage: (m) => {
        let tag = msgName(m);
        if (Engine.SELECT_TYPES.has(m[0])) {
          try { const p = Engine.parsePrompt(m); if (p) tag += ':p' + p.player; } catch (e) {}
        }
        stream.push(tag);
      },
    });
    const stats = await duel.run();
    // opponent draw phases with the trap standing set & offered
    const oppDraw = prompts.filter(p => p.tp === 1 && p.phase === 'DRAW');
    const trapPhases = [];
    for (const p of oppDraw) if (p.name === 'SELECT_CHAIN' && p.hasTrap) trapPhases.push(p);
    const byTurn = {};
    for (const p of trapPhases) byTurn[p.turn] = (byTurn[p.turn] || 0) + 1;
    const multi = Object.entries(byTurn).filter(([, n]) => n >= 2);
    if (trapPhases.length) goodPhases++;
    report.push({ seed, stop: stats.stopReason, turns: stats.turns, trapSet, oppDrawPrompts: oppDraw.length, trapChainInOppDraw: trapPhases.length, multiTrapTurns: multi });
    console.log('seed', seed, 'stop:', stats.stopReason, 'turns:', stats.turns, 'trapSet:', trapSet,
      'oppDrawPrompts:', oppDraw.length, 'trapChainPrompts:', trapPhases.length, 'turnsWith2+TrapPrompts:', JSON.stringify(multi));
    if (multi.length) {
      // dump the full prompt sequence of those turns with the in-between stream
      for (const [turn] of multi) {
        console.log('--- seed', seed, 'turn', turn, 'opponent DRAW phase, all human prompts that turn ---');
        for (const p of prompts.filter(x => x.turn === +turn && x.tp === 1)) {
          console.log(' [' + p.phase + ']', p.name, p.hasTrap ? 'TRAP-ENTRY' : '', p.forced ? 'FORCED' : '',
            'entries:', p.entries ? p.entries.map(e => e.code).join(',') : (p.code || ''));
          console.log('   since-prev-human-prompt:', p.since.join(' '));
        }
      }
    }
    // also dump any EFFECTYN naming the trap anywhere
    for (const p of prompts) if (p.name === 'SELECT_EFFECTYN' && p.code === TRAP)
      console.log('seed', seed, 'EFFECTYN for trap at turn', p.turn, p.phase, 'desc', p.desc);
  }
  console.log('SUMMARY', JSON.stringify(report, null, 1));
})().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
