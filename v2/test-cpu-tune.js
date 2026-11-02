'use strict';
/* test-cpu-tune.js — CPU tuning investigation (branch client-cpu-tune).
 *
 * Reproduces the real-browser observation (human Ishizu vs CPU Gate
 * Guardian, CPU passive for 5 turns) as a harness matchup: seat 0 =
 * Ishizu driven by the SHIPPED policy (Engine.botAnswer — stated choice:
 * the shipped game pairs the human against this same policy core, and the
 * mirror-match suite uses bot-vs-bot too), seat 1 = Gate Guardian driven
 * by the shipped policy, going second (its turns are overall turns
 * 2/4/6/8/10, exactly like the browser game).
 *
 * Diagnostic only: the GG seat's OWN hand is logged verbatim (legal for
 * the bot itself; the shipped policy still decides through botView —
 * fairness is a property of the policy, not of this harness's logging).
 * For each of the GG seat's first 6 turns we record its hand, field, the
 * IDLECMD/BATTLECMD offers it received and the command it chose. Turns
 * with no face-up monster produced and no attack are classified:
 *   NOTHING_OFFERED    — no summon / special-summon entry and no
 *                        summon-producing activation was offered all turn
 *   OFFERED_BUT_NO_BODY— a body play WAS offered (direct summon entry,
 *                        spsummon entry, or a producer activation:
 *                        Fusion Deployment, Dark Element, Swamp King
 *                        hand effect, Wall Shadow / Heavy Tank piece
 *                        placement) yet no face-up monster appeared
 *   ATTACK_DECLINED    — (separately) battle phase offered an attack
 *                        entry and the bot chose otherwise
 * Aggregates: % of duels with a GG attack by bot turn 5, average first
 * attack bot-turn, classification counts. Gates: every duel completes,
 * MSG_RETRY == 0, combined card conservation exact.
 */
const fs = require('fs');
const path = require('path');

const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const { Reader, LOC } = Engine;

const VERBOSE = !!process.env.TUNE_VERBOSE;
const N_DUELS = 12;
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

const GG_SEAT = 1;
const name = (data, code) => (code ? (data.names[code] || ('#' + code)) : '·');
const short = (data, code) => name(data, code).replace(/－.*$/, '').slice(0, 10);

async function runDuel(M, data, seed) {
  installSeededCrypto(seed * 2654435761 % 4294967296);
  const deckP0 = data.decks.ishizu, deckP1 = data.decks.gg;
  const expected = [deckP0.main.length + deckP0.extra.length, deckP1.main.length + deckP1.extra.length];
  const mems = [Engine.makeBotMemory(), Engine.makeBotMemory()];
  const prompts = [0, 0];
  let duelRef = null;

  // ---- GG-seat trace
  const tr = {
    botTurn: 0, lastTurnCount: -1,
    turns: [],           // per bot-turn record
    cur: null,           // current bot-turn record
    firstFaceUpTurn: 0, firstAttackTurn: 0,
    attacks: 0,
  };
  const newTurnRec = (state) => ({
    botTurn: tr.botTurn, turnCount: state.turnCount,
    hand: state.players[GG_SEAT].hand.map(e => e.code),
    deck: state.players[GG_SEAT].deckCount,
    graveN: state.players[GG_SEAT].grave.length, removedN: state.players[GG_SEAT].removed.length,
    myMonsStart: [], oppMons: [], idle: [], battle: [],
    faceUpSummon: false, attacked: false,
  });
  const snapField = (state, rec) => {
    const P = state.players[GG_SEAT], O = state.players[1 - GG_SEAT];
    rec.myMonsStart = P.mzone.map((c, s) => c ? { code: c.code, pos: c.pos, seq: s } : null).filter(Boolean);
    rec.mySzone = P.szone.map((c, s) => c ? { code: c.code, pos: c.pos, seq: s } : null).filter(Boolean);
    rec.oppMons = O.mzone.map((c, s) => c ? { code: c.code, pos: c.pos, seq: s } : null).filter(Boolean);
    rec.lp = [state.players[0].lp, state.players[1].lp];
  };
  const decodeCmd = (bytes) => {
    const v = new DataView(bytes.buffer, bytes.byteOffset, 4).getInt32(0, true);
    return { type: v & 0xffff, idx: v >> 16 };
  };
  const onMessage = (m) => {
    const t = m[0];
    if (t === 60 || t === 62 || t === 64) { // SUMMONING / SPSUMMONING / FLIPSUMMONING
      const r = new Reader(m, 1); r.u32(); const li = r.locInfo();
      if (li.con === GG_SEAT && (li.pos & 0x5) && tr.cur) tr.cur.faceUpSummon = true;
      if (li.con === GG_SEAT && (li.pos & 0x5) && !tr.firstFaceUpTurn) tr.firstFaceUpTurn = tr.botTurn;
    } else if (t === 110) { // ATTACK
      const r = new Reader(m, 1); const li = r.locInfo();
      if (li.con === GG_SEAT) {
        tr.attacks++;
        if (tr.cur) tr.cur.attacked = true;
        if (!tr.firstAttackTurn) tr.firstAttackTurn = tr.botTurn;
      }
    }
  };
  const answerGG = (prompt, state) => {
    prompts[GG_SEAT]++;
    if (prompts[0] + prompts[1] > PROMPT_BUDGET) throw new Error('prompt budget exceeded');
    if (duelRef) { try { duelRef.refreshFieldStats(); } catch (e) {} }
    if (state.turnPlayer === GG_SEAT && state.turnCount !== tr.lastTurnCount) {
      tr.lastTurnCount = state.turnCount;
      tr.botTurn++;
      tr.cur = newTurnRec(state);
      snapField(state, tr.cur);
      tr.turns.push(tr.cur);
    }
    const ans = Engine.botAnswer(prompt, state, data, mems[GG_SEAT]);
    if (tr.cur && state.turnPlayer === GG_SEAT && tr.botTurn <= 6) {
      if (prompt.name === 'SELECT_IDLECMD') {
        const ch = decodeCmd(ans);
        const lists = { 0: prompt.summon, 1: prompt.spsummon, 2: prompt.repos, 3: prompt.mset, 4: prompt.sset, 5: prompt.activate };
        const chosen = lists[ch.type] ? lists[ch.type][ch.idx] : null;
        tr.cur.idle.push({
          phase: state.phaseName,
          summon: prompt.summon.map(e => e.code), spsummon: prompt.spsummon.map(e => e.code),
          mset: prompt.mset.map(e => e.code),
          activate: prompt.activate.map(e => ({ code: e.code, loc: e.loc, seq: e.seq })),
          choice: { type: ch.type, code: chosen ? chosen.code : null },
        });
      } else if (prompt.name === 'SELECT_BATTLECMD') {
        const ch = decodeCmd(ans);
        tr.cur.battle.push({
          attack: prompt.attack.map(e => ({ seq: e.seq, direct: !!e.direct })),
          choice: ch.type,
        });
      }
    }
    return ans;
  };
  const answerOpp = (prompt, state) => {
    prompts[0]++;
    if (prompts[0] + prompts[1] > PROMPT_BUDGET) throw new Error('prompt budget exceeded');
    if (duelRef) { try { duelRef.refreshFieldStats(); } catch (e) {} }
    return Engine.botAnswer(prompt, state, data, mems[0]);
  };

  const duel = new Engine.Duel(M, data, {
    seed, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
    deckP0, deckP1, humanTeam: 0,
    onLog: () => {}, onMessage,
    humanAnswerer: async (prompt, state) => answerOpp(prompt, state),
    botAnswerer: (prompt, state) => answerGG(prompt, state),
  });
  duelRef = duel;
  let stats = null, error = null;
  try { stats = await duel.run(); } catch (e) { error = e; }
  const combinedOk = duel.state.totalCards(0) + duel.state.totalCards(1) === expected[0] + expected[1];
  return {
    over: duel.over, winner: duel.state.winner, turns: stats ? stats.turns : duel.state.turnCount,
    retries: stats ? stats.retries : 0, error: error ? String(error && error.message || error) : null,
    combinedOk, tr,
  };
}

// ---- classification
const PRODUCERS = [
  { code: 6498706, kind: 'fusion-deployment' },                    // Fusion Deployment (hand)
  { code: 53194323, kind: 'dark-element', fromHandOnly: true },    // Dark Element ① (hand)
  { code: 45223540, kind: 'swampking-ss', fromHandOnly: true },    // Swamp King hand effect
  { code: 34771947, kind: 'wallshadow-place', szoneOnly: true },   // Wall Shadow ② (field)
  { code: 35026117, kind: 'tank-place', mzoneOnly: true },         // Heavy Tank ③ (field)
];
function classifyTurn(rec, data) {
  if (rec.faceUpSummon || rec.attacked) return null; // turn produced offense/presence
  const offers = { directSummon: new Set(), spsummon: new Set(), producers: new Set() };
  for (const id of rec.idle) {
    for (const c of id.summon) { const cd = data.cards[c]; if (cd && (cd.atk >= 1400 || c === 35026117)) offers.directSummon.add(c); }
    for (const c of id.spsummon) offers.spsummon.add(c);
    for (const a of id.activate) {
      for (const p of PRODUCERS) {
        if (a.code !== p.code) continue;
        if (p.fromHandOnly && a.loc !== LOC.HAND) continue;
        if (p.szoneOnly && a.loc !== LOC.SZONE) continue;
        if (p.mzoneOnly && a.loc !== LOC.MZONE) continue;
        offers.producers.add(p.kind);
      }
    }
  }
  const n = offers.directSummon.size + offers.spsummon.size + offers.producers.size;
  if (n > 0) return {
    cls: 'OFFERED_BUT_NO_BODY',
    detail: [...offers.directSummon].map(c => 'summon:' + short(data, c)).join(',') +
      [...offers.spsummon].map(c => 'sp:' + short(data, c)).join(',') +
      [...offers.producers].map(k => 'act:' + k).join(','),
  };
  return { cls: 'NOTHING_OFFERED', detail: 'hand=' + rec.hand.map(c => short(data, c)).join('/') };
}

(async () => {
  const M = await factory();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const clsCounts = {};
  let duelsWithAttackBy5 = 0, firstAttacks = [], firstFaceUps = [];
  let notOver = 0, retries = 0, totalsBad = 0, errors = 0;
  for (let i = 0; i < N_DUELS; i++) {
    const seed = 91000 + i * 7;
    const r = await runDuel(M, data, seed);
    if (!r.over) notOver++;
    if (!r.combinedOk) totalsBad++;
    if (r.error) { errors++; console.log('  duel error:', r.error); }
    retries += r.retries;
    if (r.tr.firstAttackTurn && r.tr.firstAttackTurn <= 5) duelsWithAttackBy5++;
    if (r.tr.firstAttackTurn) firstAttacks.push(r.tr.firstAttackTurn);
    if (r.tr.firstFaceUpTurn) firstFaceUps.push(r.tr.firstFaceUpTurn);
    console.log('duel seed=' + seed + ' winner=P' + r.winner + ' turns=' + r.turns +
      ' ggFirstFaceUpTurn=' + (r.tr.firstFaceUpTurn || '-') + ' ggFirstAttackTurn=' + (r.tr.firstAttackTurn || '-') +
      ' ggAttacks=' + r.tr.attacks);
    for (const rec of r.tr.turns) {
      if (rec.botTurn > 5) break;
      const c = classifyTurn(rec, data);
      if (VERBOSE) {
        console.log('  T' + rec.botTurn + ' hand=[' + rec.hand.map(x => short(data, x)).join(', ') + ']' +
          ' field=[' + rec.myMonsStart.map(m => short(data, m.code) + (m.pos & 0x5 ? 'FU' : 'FD')).join(', ') + ']' +
          ' sz=[' + (rec.mySzone || []).map(m => short(data, m.code)).join(', ') + ']' +
          ' deck=' + rec.deck + ' gy=' + rec.graveN + ' rm=' + rec.removedN +
          ' | idle choices: ' + rec.idle.map(x => x.choice.type + (x.choice.code ? ':' + short(data, x.choice.code) : '')).join(' ') +
          (c ? ' | ' + c.cls + ' ' + c.detail : ' | produced'));
      }
      if (c) { clsCounts[c.cls] = (clsCounts[c.cls] || 0) + 1; if (VERBOSE || c.cls !== 'NOTHING_OFFERED') console.log('    classify T' + rec.botTurn + ': ' + c.cls + ' — ' + c.detail); }
    }
  }
  const avg = (a) => a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : '-';
  console.log('DISTRIBUTION over ' + N_DUELS + ' duels (GG seat 1, policy Ishizu seat 0):');
  console.log('  duels with a GG attack by bot turn 5: ' + duelsWithAttackBy5 + '/' + N_DUELS +
    ' (' + Math.round(100 * duelsWithAttackBy5 / N_DUELS) + '%)');
  console.log('  avg first-attack bot turn: ' + avg(firstAttacks) + ' (attacked in ' + firstAttacks.length + '/' + N_DUELS + ' duels)');
  console.log('  avg first-face-up bot turn: ' + avg(firstFaceUps) + ' (face-up in ' + firstFaceUps.length + '/' + N_DUELS + ' duels)');
  console.log('  no-body/no-attack turn classifications (bot turns 1-5): ' + JSON.stringify(clsCounts));
  ok(notOver === 0 && errors === 0, 'TUNE: all ' + N_DUELS + ' duels completed');
  ok(retries === 0, 'TUNE: MSG_RETRY == 0');
  ok(totalsBad === 0, 'TUNE: combined conservation exact in all duels');
  console.log(failures ? failures + ' CHECK(S) FAILED' : 'ALL TUNE CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
