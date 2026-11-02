'use strict';
/* test-cpu-tune2.js — CPU tuning round 2 diagnostic harness.
 *
 * Reproduces the REAL-BROWSER shape that round 1's both-policy harness
 * could not: seat 0 = Ishizu driven by a SCRIPTED PASSIVE HUMAN (summon
 * the strongest monster face-up in attack position, attack the CPU's
 * monster with it, pass every chain, never activate, never set), seat 1
 * = Gate Guardian driven by the SHIPPED policy (Engine.botAnswer),
 * going second (bot turns are overall turns 2/4/6/8/10, as in the
 * browser game). The passive seat delegates only mechanical
 * sub-selections (TRIBUTE / UNSELECT / SUM / COUNTER / PLACE / SORT /
 * ANNOUNCE) to Engine.botAnswer; every strategic prompt is scripted.
 *
 * Diagnostic only: the GG seat's OWN hand and field are logged verbatim
 * (legal — it is the bot's own information; the shipped policy still
 * decides through the fair masked botView). Every IDLECMD the GG seat
 * receives in its first 6 turns is traced with the offers AND, via
 * Engine.debug (the policy's own internal scorers, exposed read-only),
 * the exact score/gate that declined each offered play. Every no-attack
 * battle situation and every draw-only main phase is classified by the
 * rule responsible:
 *
 *   NO_ATKPOS_MONSTER   battle never entered / no attack entry because
 *                       the bot had no face-up attack-position monster
 *                       (sub: REPOS_GATE — a face-up DEF monster whose
 *                       ATK is below the reposition threshold 1600 was
 *                       never stood up; SUMMONED_IN_DEF — its summon
 *                       position was DEF; SET_ONLY / NO_MONSTER)
 *   PLAN_BELOW_240      attack entries existed but every plan scored
 *                       below the 240 profitability bar (incl. a direct
 *                       attack into an empty opposing field)
 *   OTHER               anything else (printed in full for eyeballing)
 *   ACT_SCORE_LT_500    a draw-only turn where an activation was offered
 *                       but activationScore returned < 500 for each
 *   TRIBUTE_SHORTAGE    a draw-only turn whose hand monsters all needed
 *                       more tributes than the field could pay
 *   SPSUMMON_DECLINED   a special summon was offered and pickSpsummon
 *                       returned -1 (gain below the 249 bar)
 *   SUMMON_GAIN_LT_150  summon/set offered, pickSummon's gain bar missed
 *   NOTHING_OFFERED     the core offered no play at all that turn
 *
 * Gates: every duel completes, MSG_RETRY == 0, combined conservation
 * exact. The printed distributions are the round-2 evidence; the gate
 * checks keep the harness itself honest.
 */
const fs = require('fs');
const path = require('path');

const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const { LOC, POS, POS_FACEUP, POS_ATTACK } = Engine;
const DBG = Engine.debug;
const CC = DBG.CC;
const GUARDIAN_PIECES = [CC.SANGA, CC.HUGA, CC.SUIGA];

const VERBOSE = !!process.env.TUNE2_VERBOSE;
const N_DUELS = parseInt(process.env.TUNE2_DUELS || '12', 10);
const PROMPT_BUDGET = 6000;

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => {
    for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; }
    return a;
  } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}

const GG = 1, HUMAN = 0;
const nm = (data, code) => (code ? (data.names[code] || ('#' + code)) : '·');
const short = (data, code) => nm(data, code).replace(/－.*$/, '').slice(0, 12);

// ---------------------------------------------------------------- passive human (seat 0)
function passiveAnswer(prompt, state, data, mem) {
  switch (prompt.name) {
    case 'SELECT_IDLECMD': {
      let best = -1, bestAtk = -1;
      prompt.summon.forEach((e, i) => { const d = data.cards[e.code]; const a = d ? d.atk : 0; if (a > bestAtk) { bestAtk = a; best = i; } });
      if (best >= 0) return Engine.cmdResp(0, best);
      let bi = -1, ba = -1;
      prompt.spsummon.forEach((e, i) => { const d = data.cards[e.code]; const a = d ? d.atk : 0; if (a > ba) { ba = a; bi = i; } });
      if (bi >= 0) return Engine.cmdResp(1, bi);
      if (prompt.toBP) return Engine.cmdResp(6, 0);
      if (prompt.toEP) return Engine.cmdResp(7, 0);
      return Engine.cmdResp(7, 0);
    }
    case 'SELECT_BATTLECMD': {
      if (prompt.attack.length) {
        let bi = -1, ba = -1;
        prompt.attack.forEach((e, i) => {
          const c = state.players[HUMAN].mzone[e.seq];
          const d = c && data.cards[c.code];
          const a = c && c.curAtk != null ? c.curAtk : (d ? d.atk : 0);
          if (a > ba) { ba = a; bi = i; }
        });
        return Engine.cmdResp(1, bi >= 0 ? bi : 0);
      }
      if (prompt.toM2) return Engine.cmdResp(2, 0);
      return Engine.cmdResp(3, 0);
    }
    case 'SELECT_POSITION': {
      for (const p of [POS.FU_ATK, POS.FU_DEF, POS.FD_DEF, POS.FD_ATK]) if (prompt.mask & p) return Engine.i32resp(p);
      return Engine.i32resp(prompt.mask);
    }
    case 'SELECT_CHAIN': return prompt.forced ? Engine.i32resp(0) : Engine.i32resp(-1);
    case 'SELECT_EFFECTYN': return Engine.i32resp(0);
    case 'SELECT_YESNO': return Engine.i32resp(0);
    case 'SELECT_OPTION': return Engine.i32resp(0);
    case 'SELECT_CARD': {
      const cards = prompt.cards, min = Math.max(1, prompt.min);
      if (cards.length && cards.every(e => e.con === GG && e.loc === LOC.MZONE)) {
        // battle target: hit the weakest opposing monster (by the stats a
        // player can see: current ATK/DEF from the state mirror)
        const scored = cards.map((e, i) => {
          const c = state.players[GG].mzone[e.seq];
          let pow = 0;
          if (c) {
            const d = data.cards[c.code];
            pow = (c.pos & POS_ATTACK)
              ? (c.curAtk != null ? c.curAtk : (d ? d.atk : 0))
              : (c.curDef != null ? c.curDef : (d ? d.def : 0));
          }
          return { i, pow };
        }).sort((a, b) => a.pow - b.pow);
        return Engine.cardsResp(scored.slice(0, min).map(x => x.i));
      }
      // generic cost/discard: give up the lowest printed-ATK own hand card
      const idx = cards.map((e, i) => ({ e, i })).sort((a, b) => {
        const va = (a.e.con === HUMAN && a.e.loc === LOC.HAND) ? (data.cards[a.e.code] ? data.cards[a.e.code].atk : 0) : 100000 + a.i;
        const vb = (b.e.con === HUMAN && b.e.loc === LOC.HAND) ? (data.cards[b.e.code] ? data.cards[b.e.code].atk : 0) : 100000 + b.i;
        return va - vb;
      }).slice(0, min).map(x => x.i);
      return Engine.cardsResp(idx);
    }
    default:
      // mechanical sub-selections only (TRIBUTE/UNSELECT/SUM/COUNTER/
      // PLACE/DISFIELD/SORT/ANNOUNCE): the shipped generic answers are
      // fine — they do not define this seat's strategic shape.
      return Engine.botAnswer(prompt, state, data, mem);
  }
}

// ---------------------------------------------------------------- duel runner with GG tracing
async function runDuel(M, data, seed) {
  installSeededCrypto(seed * 2654435761 % 4294967296);
  const deckP0 = data.decks.ishizu, deckP1 = data.decks.gg;
  const expected = deckP0.main.length + deckP0.extra.length + deckP1.main.length + deckP1.extra.length;
  const mems = [Engine.makeBotMemory(), Engine.makeBotMemory()];
  const prompts = [0, 0];
  let duelRef = null;

  const tr = {
    botTurn: 0, lastTurnCount: -1, cur: null, turns: [],
    firstAttackTurn: 0, attacks: 0, firstFaceUpTurn: 0,
  };
  const newTurnRec = (state) => ({
    botTurn: tr.botTurn, turnCount: state.turnCount,
    handStart: state.players[GG].hand.map(e => e.code),
    deckStart: state.players[GG].deckCount,
    idle: [], battleCmds: [], positions: [], summonedSeqs: [],
    acted: false, attacked: false, faceUpSummon: false,
    battleEntered: false,
  });
  const onMessage = (m) => {
    const t = m[0];
    if (t === 60 || t === 62 || t === 64) {
      const r = new Engine.Reader(m, 1); r.u32(); const li = r.locInfo();
      if (li.con === GG && tr.cur) tr.cur.summonedSeqs.push(li.seq);
      if (li.con === GG && (li.pos & POS_FACEUP) && tr.cur) { tr.cur.faceUpSummon = true; tr.cur.acted = true; }
      if (li.con === GG && (li.pos & POS_FACEUP) && !tr.firstFaceUpTurn) tr.firstFaceUpTurn = tr.botTurn;
    } else if (t === 110) {
      const r = new Engine.Reader(m, 1); const li = r.locInfo();
      if (li.con === GG) { tr.attacks++; if (tr.cur) { tr.cur.attacked = true; tr.cur.acted = true; } if (!tr.firstAttackTurn) tr.firstAttackTurn = tr.botTurn; }
    }
  };
  const decodeCmd = (bytes) => {
    const v = new DataView(bytes.buffer, bytes.byteOffset, 4).getInt32(0, true);
    return { type: v & 0xffff, idx: v >> 16 };
  };

  const answerGG = (prompt, state) => {
    prompts[GG]++;
    if (prompts[0] + prompts[1] > PROMPT_BUDGET) throw new Error('prompt budget exceeded');
    if (duelRef) { try { duelRef.refreshFieldStats(); } catch (e) {} }
    if (state.turnPlayer === GG && state.turnCount !== tr.lastTurnCount) {
      tr.lastTurnCount = state.turnCount;
      tr.botTurn++;
      tr.cur = newTurnRec(state);
      tr.turns.push(tr.cur);
    }
    const view = Engine.botView(state, GG, data);
    const ans = Engine.botAnswer(prompt, state, data, mems[GG]);
    if (tr.cur && state.turnPlayer === GG && tr.botTurn <= 6) {
      if (prompt.name === 'SELECT_IDLECMD') {
        const ch = decodeCmd(ans);
        if ([0, 1, 2, 3, 4, 5].includes(ch.type)) tr.cur.acted = true;
        tr.cur.idle.push({
          phase: state.phaseName,
          hand: state.players[GG].hand.map(e => e.code),
          myField: DBG.monList(view, GG).map(c => ({ code: c.code, faceUp: c.faceUp, atkPos: c.atkPos, atk: DBG.atkOf(c, data), def: DBG.defOf(c, data), seq: c.seq })),
          mySzone: view.zones[GG].szone.map(c => c ? { code: c.code, faceUp: c.faceUp } : null).filter(Boolean),
          oppField: DBG.monList(view, 0).map(c => ({ code: c.code, faceUp: c.faceUp, atkPos: c.atkPos, atk: DBG.atkOf(c, data), def: DBG.defOf(c, data), seq: c.seq })),
          summon: prompt.summon.map(e => e.code), spsummon: prompt.spsummon.map(e => e.code),
          mset: prompt.mset.map(e => e.code), sset: prompt.sset.map(e => e.code),
          ssetValues: prompt.sset.map(e => ({ code: e.code, v: DBG.handValue(e.code, view, data) })),
          grave: view.grave[GG].slice(), removed: view.removed[GG].slice(),
          repos: prompt.repos.map(e => e.seq),
          actScores: prompt.activate.map(e => ({ code: e.code, loc: e.loc, seq: e.seq, score: DBG.activationScore(e, view, data, prompt) })),
          spPick: DBG.pickSpsummon(prompt, view, data, Engine.makeBotMemory()),
          smPick: (() => { const s = DBG.pickSummon(prompt, view, data); return s ? { kind: s.kind, code: (s.kind === 'summon' ? prompt.summon : prompt.mset)[s.idx].code, gain: Math.round(s.gain) } : null; })(),
          profitable: state.phaseName === 'MAIN1' ? DBG.hasProfitableAttack(view, data) : null,
          // per-monster: would standing/flipping this monster up create a
          // profitable attack right now (the policy's own measure)?
          stoodProfit: Object.fromEntries(DBG.monList(view, GG).filter(c => !c.atkPos || !c.faceUp)
            .map(c => [c.seq, stoodProfitFn(view, data, c)])),
          toBP: prompt.toBP, toEP: prompt.toEP,
          choice: ch,
        });
      } else if (prompt.name === 'SELECT_BATTLECMD') {
        if (process.env.TUNE2_DUMP) console.log('    RAW BATTLECMD turn=' + state.turnCount + ' phase=' + state.phaseName +
          ' attack=[' + prompt.attack.map(e => 'code' + e.code + '/seq' + e.seq + '/direct' + e.direct).join(',') + '] toM2=' + prompt.toM2 + ' toEP=' + prompt.toEP);
        tr.cur.battleEntered = true;
        const ch = decodeCmd(ans);
        const attackers = prompt.attack.map(e => ({ seq: e.seq, atk: DBG.atkOf(view.zones[GG].mzone[e.seq], data), direct: e.direct }));
        const directSeqs = new Set(prompt.attack.filter(e => e.direct).map(e => e.seq));
        const plans = DBG.attackPlans(view, data, attackers, directSeqs);
        const best = DBG.bestAttackPlan(view, data, attackers, directSeqs);
        const lethal = DBG.lethalPlan(view, data, attackers);
        tr.cur.battleCmds.push({ attack: attackers, plans, best, lethal: !!lethal, choice: ch.type });
      } else if (prompt.name === 'SELECT_POSITION') {
        const v = new DataView(ans.buffer, ans.byteOffset, 4).getInt32(0, true);
        tr.cur.positions.push({ code: prompt.code, mask: prompt.mask, chosen: v });
      }
    }
    return ans;
  };
  const answerHuman = (prompt, state) => {
    prompts[HUMAN]++;
    if (prompts[0] + prompts[1] > PROMPT_BUDGET) throw new Error('prompt budget exceeded');
    if (duelRef) { try { duelRef.refreshFieldStats(); } catch (e) {} }
    return passiveAnswer(prompt, state, data, mems[HUMAN]);
  };

  const duel = new Engine.Duel(M, data, {
    seed, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
    deckP0, deckP1, humanTeam: 0,
    onLog: () => {}, onMessage,
    humanAnswerer: async (prompt, state) => answerHuman(prompt, state),
    botAnswerer: (prompt, state) => answerGG(prompt, state),
  });
  duelRef = duel;
  let stats = null, error = null;
  try { stats = await duel.run(); } catch (e) { error = e; }
  const combinedOk = duel.state.totalCards(0) + duel.state.totalCards(1) === expected;
  return {
    over: duel.over, winner: duel.state.winner, turns: stats ? stats.turns : duel.state.turnCount,
    retries: stats ? stats.retries : 0, error: error ? String(error && error.message || error) : null,
    combinedOk, tr,
  };
}

// The policy's stand-up measure, replicated harness-side from the
// exported attackPlans/lethalPlan so the SAME yardstick can be run
// against a pre-fix engine (which lacks profitableAttackIfStood) for
// before/after counts. Evaluation only — never a decision path.
function stoodProfitLocal(view, data, cell) {
  const atk = DBG.atkOf(cell, data);
  if (atk <= 0) return false;
  const attackers = DBG.faceUpMons(view, view.me).filter(c => c.atkPos && DBG.atkOf(c, data) > 0)
    .map(c => ({ seq: c.seq, atk: DBG.atkOf(c, data) }));
  if (!attackers.some(a => a.seq === cell.seq)) attackers.push({ seq: cell.seq, atk });
  const oppEmpty = DBG.monList(view, view.opp).length === 0;
  if (DBG.lethalPlan(view, data, attackers)) return true;
  const direct = new Set(oppEmpty ? attackers.map(a => a.seq) : []);
  const bar = oppEmpty ? 1 : 240;
  return DBG.attackPlans(view, data, attackers, direct).some(p => p.seq === cell.seq && p.score >= bar);
}
const stoodProfitFn = DBG.profitableAttackIfStood || stoodProfitLocal;

// ---------------------------------------------------------------- classification
// Classify one bot turn that produced no attack.
function classifyNoAttack(rec, data) {
  const main1 = rec.idle.filter(x => x.phase === 'MAIN1');
  const last = main1[main1.length - 1];
  // case: battle commands existed (BP entered)
  if (rec.battleCmds.length) {
    const bc = rec.battleCmds[0];
    if (!bc.attack.length) {
      // BP entered but the core offered no attack entry. If every
      // attack-position monster was summoned this very turn, the named
      // reason is a summon-turn attack restriction (in this pool:
      // 迷宮の重魔戦車 cannot attack the turn it is summoned).
      const src = last || rec.idle[rec.idle.length - 1];
      const atkPos = src ? src.myField.filter(c => c.faceUp && c.atkPos && c.atk > 0) : [];
      if (atkPos.length && atkPos.every(c => rec.summonedSeqs.includes(c.seq))) {
        // name the restriction: our own face-up Labyrinth Wall Shadow
        // bars summoned/flip-summoned monsters of printed level <= 4
        // from attacking that turn; the Heavy Tank carries the same
        // restriction in its own text. Both are legal named reasons.
        const wallUp = src && (src.mySzone || []).some(s => s.faceUp && s.code === CC.WALL_SHADOW);
        const why = atkPos.map(c => {
          const lv = (data.cards[c.code] || {}).level & 0xff;
          return short(data, c.code) + '/' + c.atk + (wallUp && lv <= 4 ? ' [own Wall Shadow ①: lv' + lv + ' summoned this turn]' : ' [summon-turn restriction]');
        }).join(', ');
        return { rule: 'CANNOT_ATTACK_THIS_TURN', detail: 'bp entered, no attack entry; attacker(s) summoned this turn: ' + why };
      }
      return noAtkPosDetail(src, data, 'bp-entered-no-attack-entry', rec);
    }
    const bestScore = Math.max(-Infinity, ...bc.plans.map(p => p.score));
    return {
      rule: 'PLAN_BELOW_240',
      detail: 'attack entries=' + bc.attack.map(a => 'seq' + a.seq + '/atk' + a.atk + (a.direct ? '/DIRECT' : '')).join(',') +
        ' plans=' + bc.plans.map(p => 'seq' + p.seq + '->' + (p.targetSeq === -1 ? 'DIRECT' : 'seq' + p.targetSeq) + ':' + Math.round(p.score)).join(',') +
        ' bestPlanScore=' + (bestScore === -Infinity ? 'none' : Math.round(bestScore)) + ' lethal=' + bc.lethal,
    };
  }
  // case: battle phase never entered
  if (!last) return { rule: 'OTHER', detail: 'no MAIN1 idle traced' };
  return noAtkPosDetail(last, data, 'bp-never-entered', rec);
}
function noAtkPosDetail(idleRec, data, tag, rec) {
  if (!idleRec) return { rule: 'OTHER', detail: tag + ': no idle record' };
  const mine = idleRec.myField;
  const atkPos = mine.filter(c => c.faceUp && c.atkPos && c.atk > 0);
  if (atkPos.length) {
    // attack-position monsters existed but no plan cleared the policy's
    // profitability bar (attackScore / 240 threshold): a judgment call
    // against the opposing field, NOT the empty-field defect.
    return { rule: 'DECLINED_UNPROFITABLE', detail: tag + ': attacker(s) ' + atkPos.map(c => short(data, c.code) + '/' + c.atk).join(',') +
      ' vs opp [' + idleRec.oppField.map(c => short(data, c.code) + (c.faceUp ? (c.atkPos ? 'FUa' : 'FUd') : 'FD') + '/' + (c.atkPos ? c.atk : c.def)).join(',') +
      '] profitable=' + idleRec.profitable };
  }
  const fuDef = mine.filter(c => c.faceUp && !c.atkPos);
  if (fuDef.length) {
    const parts = fuDef.map(c => {
      const reposOffered = idleRec.repos.includes(c.seq);
      const justSummoned = rec && rec.summonedSeqs.includes(c.seq);
      const wouldProfit = idleRec.stoodProfit ? !!idleRec.stoodProfit[c.seq] : null;
      return short(data, c.code) + ' ATK' + c.atk + '/DEF' + c.def +
        ' reposOffered=' + reposOffered + ' stoodProfitable=' + wouldProfit +
        (justSummoned ? ' summoned-this-turn(position change not yet legal)'
          : (wouldProfit ? ' DEFECT: profitable stand-up not taken' : ' standing not profitable — correct defense'));
    });
    return { rule: 'NO_ATKPOS_MONSTER', detail: tag + ': face-up DEF only: ' + parts.join('; ') };
  }
  const fd = mine.filter(c => !c.faceUp);
  if (fd.length) return { rule: 'NO_ATKPOS_MONSTER', detail: tag + ': face-down monster(s) only' };
  return { rule: 'NO_ATKPOS_MONSTER', detail: tag + ': no monster on field' };
}
// Classify one draw-only bot turn (no summon/spsummon/set/activate/repos
// choice, no attack): name the gate for every card in hand at the turn's
// last MAIN1 idle, from the core's offers + the policy's own scores.
function classifyDrawOnly(rec, data) {
  const main1 = rec.idle.filter(x => x.phase === 'MAIN1');
  const last = main1[main1.length - 1];
  if (!last) return [{ rule: 'OTHER', detail: 'no MAIN1 idle traced' }];
  const out = [];
  const fieldN = last.myField.length;
  for (const code of new Set(last.hand)) {
    const d = data.cards[code];
    const inSummon = last.summon.includes(code), inMset = last.mset.includes(code);
    const acts = last.actScores.filter(a => a.code === code);
    // a monster that was offered as a summon/set is classified by the
    // summon gates first — its hand activation (if any) is secondary
    if (d && (d.type & 0x1) && (inSummon || inMset)) {
      const lvl = d.level & 0xff;
      const trib = code === CC.HEAVY_TANK ? 0 : (lvl <= 4 ? 0 : lvl <= 6 ? 1 : 2);
      if (trib > fieldN) out.push({ rule: 'TRIBUTE_SHORTAGE', detail: short(data, code) + ' lv' + lvl + ' needs ' + trib + ' tributes, field has ' + fieldN });
      else out.push({ rule: 'SUMMON_GAIN_LT_150', detail: short(data, code) + ' offered as ' + (inSummon ? 'summon' : '') + (inMset ? 'set' : '') + ', pickSummon gain bar missed (pick=' + JSON.stringify(last.smPick) + ')' });
      continue;
    }
    if (acts.length) {
      const top = Math.max(...acts.map(a => a.score));
      out.push({ rule: 'ACT_SCORE_LT_500', detail: short(data, code) + ' activate offered, activationScore=' + top + ' (<500)' });
      continue;
    }
    if (d && ((d.type & 0x4) || (d.type & 0x10000))) { // trap or quick-play spell: settable from hand
      if (last.sset.includes(code)) {
        const sv = (last.ssetValues || []).find(x => x.code === code);
        out.push({ rule: 'SSET_DECLINED', detail: short(data, code) + ' in sset offers but not set (handValue=' + (sv ? sv.v : '?') + ')' });
      } else {
        out.push({ rule: 'NOT_OFFERED_BY_CORE', detail: short(data, code) + ' settable but not in sset offers (mySzone=' + (last.mySzone || []).length + '/5: ' +
          (last.mySzone || []).map(s => short(data, s.code) + (s.faceUp ? 'FU' : 'FD')).join(',') + ')' });
      }
      continue;
    }
    if (inSummon || inMset) {
      const lvl = d ? (d.level & 0xff) : 0;
      const trib = code === CC.HEAVY_TANK ? 0 : (lvl <= 4 ? 0 : lvl <= 6 ? 1 : 2);
      if (trib > fieldN) out.push({ rule: 'TRIBUTE_SHORTAGE', detail: short(data, code) + ' lv' + lvl + ' needs ' + trib + ' tributes, field has ' + fieldN });
      else out.push({ rule: 'SUMMON_GAIN_LT_150', detail: short(data, code) + ' offered as ' + (inSummon ? 'summon' : '') + (inMset ? 'set' : '') + ', pickSummon gain bar missed (pick=' + JSON.stringify(last.smPick) + ')' });
      continue;
    }
    if (last.spsummon.includes(code)) { out.push({ rule: 'SPSUMMON_DECLINED', detail: short(data, code) + ' spsummon offered, pickSpsummon=-1' }); continue; }
    // guardian pieces / their payoff spells: the bot may be holding them
    // for the trio payoffs (contact fusions, Dark Element, Dark Guardian
    // procedure). Name which trio members are still missing from every
    // public zone — "waiting for the fusion line" (a real plan; the
    // fusion route is live once the parent's engine fix lands) vs a
    // complete trio the core still did not offer (an offer-side fact).
    if (GUARDIAN_PIECES.includes(code) || code === CC.DARK_ELEMENT) {
      const have = new Set([...last.hand,
        ...last.myField.map(c => c.code), ...(last.mySzone || []).map(s => s.code),
        ...(last.grave || []), ...(last.removed || [])]);
      const missing = GUARDIAN_PIECES.filter(p => !have.has(p));
      out.push({ rule: 'WAITING_FOR_TRIO', detail: short(data, code) + ' held for trio payoff (contact fusion / Dark Element / Dark Guardian); missing: ' +
        (missing.length ? missing.map(p => short(data, p)).join(',') : 'none — trio complete but core offered no payoff') });
      continue;
    }
    if (d && (d.type & 0x2)) { /* spell not offered as activation: condition unmet at core level */
      out.push({ rule: 'NOT_OFFERED_BY_CORE', detail: short(data, code) + ' in hand, core offered no activation/summon for it' });
      continue;
    }
    out.push({ rule: 'NOT_OFFERED_BY_CORE', detail: short(data, code) + ' in hand, core offered no play for it' });
  }
  if (!out.length) out.push({ rule: 'NOTHING_OFFERED', detail: 'hand=' + last.hand.map(c => short(data, c)).join('/') });
  return out;
}

const SCAN = !!process.env.TUNE2_SCAN;
(async () => {
  const M = await factory();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const noAttackRules = {}, drawOnlyGates = {};
  const otherDetails = [], drawOnlyDetails = [], actScoreDetails = [];
  const events = { FREE_DIRECT_DECLINED_ATKPOS: 0, FREE_DIRECT_DECLINED_DEFONLY: 0, DEF_LOCK: 0 };
  const examples = { FREE_DIRECT_DECLINED_ATKPOS: [], FREE_DIRECT_DECLINED_DEFONLY: [], DEF_LOCK: [] };
  let notOver = 0, retries = 0, totalsBad = 0, errors = 0;
  let duelsWithAttack = 0, duelsWithAttackBy5 = 0, firstAttacks = [], directAttackOpps = 0, directAttacksTaken = 0;
  let drawOnlyTurns = 0, botTurnsSeen = 0;
  const seedList = process.env.TUNE2_SEEDS ? process.env.TUNE2_SEEDS.split(',').map(s => parseInt(s, 10)) : null;
  const nDuels = seedList ? seedList.length : (SCAN ? parseInt(process.env.TUNE2_DUELS || '120', 10) : N_DUELS);
  for (let i = 0; i < nDuels; i++) {
    const seed = seedList ? seedList[i] : (SCAN ? 70000 + i * 13 : 91000 + i * 7);
    const r = await runDuel(M, data, seed);
    if (!r.over) notOver++;
    if (!r.combinedOk) totalsBad++;
    if (r.error) { errors++; console.log('  duel error:', r.error); }
    retries += r.retries;
    if (r.tr.attacks > 0) duelsWithAttack++;
    if (r.tr.firstAttackTurn && r.tr.firstAttackTurn <= 5) duelsWithAttackBy5++;
    if (r.tr.firstAttackTurn) firstAttacks.push(r.tr.firstAttackTurn);
    if (!SCAN) console.log('duel seed=' + seed + ' winner=P' + r.winner + ' turns=' + r.turns +
      ' ggFirstAttackTurn=' + (r.tr.firstAttackTurn || '-') + ' ggAttacks=' + r.tr.attacks);
    for (const rec of r.tr.turns) {
      if (rec.botTurn > 6) continue; // only turns 1-6 carry decision traces
      botTurnsSeen++;
      // direct-attack opportunity: at some MAIN1 idle the opposing field
      // was empty while the bot had a monster (any position) on the field
      const oppEmptyMain1 = rec.idle.some(x => x.phase === 'MAIN1' && x.oppField.length === 0 && x.myField.length > 0);
      if (oppEmptyMain1) { directAttackOpps++; if (rec.attacked) directAttacksTaken++; }
      // --- round-2 failure events
      if (!rec.attacked) {
        const main1Idles = rec.idle.filter(x => x.phase === 'MAIN1');
        const firstM1 = main1Idles[0];
        const emptyIdle = main1Idles.find(x => x.oppField.length === 0 && x.myField.length > 0);
        if (emptyIdle && firstM1) {
          // only monsters that were already on the field when the turn
          // began can be "declined" — a monster summoned/set this turn
          // may be under a named summon-turn restriction, and a face-down
          // monster whose flip cannot yield an attack this turn under
          // our own face-up Wall Shadow (printed level <= 4) is likewise
          // a named exception, not a decline
          const wallUp = (emptyIdle.mySzone || []).some(s => s.faceUp && s.code === CC.WALL_SHADOW);
          const persisted = emptyIdle.myField.filter(c => firstM1.myField.some(f => f.seq === c.seq) && !rec.summonedSeqs.includes(c.seq));
          const ready = persisted.filter(c => (c.faceUp && c.atkPos && c.atk > 0) ||
            (c.faceUp && !c.atkPos && c.atk > 0) ||
            (!c.faceUp && !(wallUp && ((data.cards[c.code] || {}).level & 0xff) <= 4)));
          if (ready.length) {
            const hadAtkPos = ready.some(c => c.faceUp && c.atkPos);
            const key = hadAtkPos ? 'FREE_DIRECT_DECLINED_ATKPOS' : 'FREE_DIRECT_DECLINED_DEFONLY';
            const cls0 = classifyNoAttack(rec, data);
            if (cls0.rule !== 'CANNOT_ATTACK_THIS_TURN') {
              events[key]++;
              if (examples[key].length < 4) examples[key].push('seed' + seed + ' T' + rec.botTurn + ': ' +
                ready.map(c => short(data, c.code) + (c.faceUp ? (c.atkPos ? 'FUa' : 'FUd') : 'FD') + '/' + c.atk).join(','));
            }
          }
        }
        const main1 = rec.idle.filter(x => x.phase === 'MAIN1');
        const lastM1 = main1[main1.length - 1], firstM1b = main1[0];
        if (lastM1 && firstM1b) {
          // a true lock: the monster sat in face-up defense all turn,
          // repositioning was offered, AND standing it up would have
          // created a profitable attack by the policy's own measure
          const locked = lastM1.myField.some(c => c.faceUp && !c.atkPos && c.atk < 1600 &&
            lastM1.repos.includes(c.seq) && !rec.summonedSeqs.includes(c.seq) &&
            lastM1.stoodProfit && lastM1.stoodProfit[c.seq] &&
            firstM1b.myField.some(f => f.seq === c.seq));
          if (locked) {
            events.DEF_LOCK++;
            if (examples.DEF_LOCK.length < 4) examples.DEF_LOCK.push('seed' + seed + ' T' + rec.botTurn);
          }
        }
      }
      if (!rec.attacked) {
        const c = classifyNoAttack(rec, data);
        noAttackRules[c.rule] = (noAttackRules[c.rule] || 0) + 1;
        if (c.rule === 'OTHER' && otherDetails.length < 12) otherDetails.push('seed' + seed + ' T' + rec.botTurn + ': ' + c.detail);
        if (!SCAN) console.log('  no-attack T' + rec.botTurn + ' [' + c.rule + '] ' + c.detail);
      }
      if (!rec.acted) {
        drawOnlyTurns++;
        const gates = classifyDrawOnly(rec, data);
        for (const g of gates) {
          drawOnlyGates[g.rule] = (drawOnlyGates[g.rule] || 0) + 1;
          if (g.rule === 'ACT_SCORE_LT_500' && actScoreDetails.length < 20) actScoreDetails.push('seed' + seed + ' T' + rec.botTurn + ': ' + g.detail);
          if (drawOnlyDetails.length < 16) drawOnlyDetails.push('seed' + seed + ' T' + rec.botTurn + ' hand=[' + rec.handStart.map(x => short(data, x)).join(',') + '] [' + g.rule + '] ' + g.detail);
          if (!SCAN) console.log('  draw-only T' + rec.botTurn + ' [' + g.rule + '] ' + g.detail);
        }
      }
      if (VERBOSE) {
        console.log('  T' + rec.botTurn + ' hand=[' + rec.handStart.map(x => short(data, x)).join(', ') + '] deck=' + rec.deckStart +
          ' acted=' + rec.acted + ' attacked=' + rec.attacked + ' positions=' +
          rec.positions.map(p => short(data, p.code) + ':mask' + p.mask.toString(16) + '->' + p.chosen.toString(16)).join(' ') +
          ' battleCmds=' + rec.battleCmds.map(b => '[atk:' + b.attack.map(a => 'seq' + a.seq + '/' + a.atk + (a.direct ? 'd' : '')).join(',') + ' choice=' + b.choice + ']').join(' '));
        for (const id of rec.idle) {
          console.log('    idle ' + id.phase + ' field=[' + id.myField.map(c => short(data, c.code) + (c.faceUp ? (c.atkPos ? 'FUa' : 'FUd') : 'FD')).join(',') +
            '] opp=[' + id.oppField.map(c => short(data, c.code) + (c.faceUp ? (c.atkPos ? 'FUa' : 'FUd') : 'FD')).join(',') +
            '] offers sum=[' + id.summon.map(c => short(data, c)).join(',') + '] sp=[' + id.spsummon.map(c => short(data, c)).join(',') +
            '] act=[' + id.actScores.map(a => short(data, a.code) + ':' + a.score).join(',') + '] choice=' + id.choice.type +
            (id.choice.type === 5 ? ':' + short(data, (rec.idle && id.actScores[id.choice.idx]) ? id.actScores[id.choice.idx].code : 0) : ''));
        }
      }
    }
  }
  const avg = (a) => a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : '-';
  console.log('DISTRIBUTION over ' + nDuels + ' duels (GG seat 1 = shipped policy, seat 0 = passive human script)' + (SCAN ? ' [SCAN]' : '') + ':');
  console.log('  bot turns traced: ' + botTurnsSeen);
  console.log('  duels with a GG attack: ' + duelsWithAttack + '/' + nDuels + '; by bot turn 5: ' + duelsWithAttackBy5 + '/' + nDuels + '; avg first-attack turn ' + avg(firstAttacks));
  console.log('  empty-opposing-field MAIN1 situations (bot had a monster): ' + directAttackOpps + ', attacked that turn: ' + directAttacksTaken);
  console.log('  failure events: ' + JSON.stringify(events));
  for (const k of Object.keys(examples)) for (const ex of examples[k]) console.log('    example ' + k + ': ' + ex);
  console.log('  draw-only bot turns: ' + drawOnlyTurns);
  console.log('  no-attack classifications: ' + JSON.stringify(noAttackRules));
  for (const d of otherDetails) console.log('    OTHER detail: ' + d);
  console.log('  draw-only gate classifications: ' + JSON.stringify(drawOnlyGates));
  for (const d of actScoreDetails) console.log('    act-score detail: ' + d);
  for (const d of drawOnlyDetails) console.log('    draw-only detail: ' + d);
  ok(notOver === 0 && errors === 0, 'TUNE2: all ' + nDuels + ' duels completed');
  ok(retries === 0, 'TUNE2: MSG_RETRY == 0');
  ok(totalsBad === 0, 'TUNE2: combined conservation exact in all duels');
  console.log(failures ? failures + ' CHECK(S) FAILED' : 'ALL TUNE2 CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
