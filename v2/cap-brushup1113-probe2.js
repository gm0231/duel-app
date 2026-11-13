'use strict';
/* cap-brushup1113-probe2.js — BU-20261113-01, batch-level follow-up.
 * Replays ONE seeded duel (seed 5: trap set on turn 1) and prints the
 * raw core stream with poc_process BATCH boundaries (onUpdate marks)
 * plus parsed HINT values, from NEW_TURN of turn 2 to the standby
 * phase, so the two trap chain prompts in the opponent's draw phase
 * can be attributed to exact batches/timings. */
const fs = require('fs');
const path = require('path');
const V2 = __dirname;
const factory = require(path.join(V2, 'build', 'ocgcore.js'));
const Engine = require(path.join(V2, 'engine.js'));
const { MSG } = Engine;
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const TRAP = 98715423;

function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; } return a; } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}

(async () => {
  const M = await factory();
  installSeededCrypto(5 * 7919 + 13);
  const lines = [];
  let inWindow = false, done = false;
  const humanMem = Engine.makeBotMemory();
  let trapSet = false;
  const humanAnswerer = async (prompt, state) => {
    if (inWindow && !done) {
      lines.push('>>> HUMAN PROMPT ' + prompt.name + ' turn=' + state.turnCount + ' phase=' + state.phaseName +
        (prompt.name === 'SELECT_CHAIN' ? ' entries=[' + (prompt.entries || []).map(e => e.code).join(',') + ']' : '') +
        ' rawKey=' + (prompt.rawKey || '?'));
      if (state.turnCount === 2 && state.phaseName !== 'DRAW' && prompt.name === 'SELECT_CHAIN') { done = true; }
    }
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
    seed: 5, deckP0: data.decks.ishizu, deckP1: data.decks.gg,
    humanTeam: 0, humanAnswerer,
    pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), maxSteps: 20000,
    onMessage: (m) => {
      const nm = MSG[m[0]] || ('#' + m[0]);
      if (nm === 'NEW_TURN') {
        // turn about to start belongs to the NEXT state; window opens at the NEW_TURN that begins turn 2
        inWindow = true;
      }
      if (!inWindow || done) return;
      let extra = '';
      if (m[0] === 2) { try { const h = Engine.parseHint(m); if (h) extra = ' sub=' + h.sub + ' player=' + h.player + ' value=' + h.value; } catch (e) {} }
      if (Engine.SELECT_TYPES.has(m[0])) { try { const p = Engine.parsePrompt(m); if (p) extra = ' player=' + p.player; } catch (e) {} }
      lines.push('  msg ' + nm + extra);
      if (nm === 'NEW_PHASE') lines.push('  -- (phase boundary in stream)');
    },
    onUpdate: (state) => { if (inWindow && !done) lines.push('‖ batch end (turn=' + state.turnCount + ' phase=' + state.phaseName + ' tp=' + state.turnPlayer + ')'); },
  });
  await duel.run();
  // print only the turn-2 window: from the second NEW_TURN marker onward is messy; print all, capped
  console.log(lines.slice(0, 220).join('\n'));
})().catch(e => { console.error('PROBE2 ERROR', e); process.exit(1); });
