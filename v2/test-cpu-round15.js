'use strict';
/* test-cpu-round15.js — round 15: reading the opponent's theme.
 * Contract under test (all decisions on PUBLIC information only):
 *  - Sphinx blind-spot fix: a DEF-over-ATK body that can beat an
 *    opposing face-up monster in battle stands in Attack Position,
 *    unless the opposing strongest both outpowers its ATK and is
 *    walled by its DEF (survival caveat).
 *  - oppPublicInfo counts registered copies minus publicly seen ones.
 *  - themeForecast fires only on a visible resource signal of an
 *    identified theme; otherwise it returns null (fallback).
 *  - themeGraveBonus prices theme-specific graveyard resources.
 *  - The position forecast may only add a wall, and never when this
 *    body can destroy part of the forecast's own premise in battle.
 * Method: hand-built botView-shaped fixtures against the real
 * engine functions (Engine.debug), no duel needed. */
const fs = require('fs');
const path = require('path');
const Engine = require(path.join(__dirname, 'engine.js'));
const { themeForecast, oppPublicInfo, themeGraveBonus, positionAnswer } = Engine.debug;
const { POS } = Engine;
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const SPHINX = 46148485, KELDO = 63542003;
const IDEA = 67584223;            // 天帝従騎イデア (vassal, 800/1000)
const EIDOS = 59463312;           // 冥帝従騎エイドス (vassal, 800/1000)
const EIDOLON = 31596518;         // 冥帝王エイドス (2400/1000, not a vassal)
const PRIME = 54241725, PANTHEISM = 22842126, STORMFORTH = 79844764;
const SANGA = 25955164, KAZEJIN = 62340868;

const cell = (code, atkPos) => ({ code, faceUp: true, atkPos: !!atkPos, curAtk: null, curDef: null, materials: 0 });
function view(oppDeckId, mut) {
  const v = {
    me: 0, opp: 1, data, turnCount: 3, phaseName: 'MAIN1', turnPlayer: 0,
    lp: [8000, 8000], deckCount: [30, 30],
    zones: [
      { mzone: [null, null, null, null, null], szone: [null, null, null, null, null, null, null, null] },
      { mzone: [null, null, null, null, null], szone: [null, null, null, null, null, null, null, null] },
    ],
    hand: [[], []], grave: [[], []], removed: [[], []], extra: [[], []],
    myDeck: data.decks.ishizu, oppDeck: data.decks[oppDeckId],
  };
  if (mut) mut(v);
  return v;
}
const posOf = (resp) => new DataView(resp.buffer, resp.byteOffset, 4).getInt32(0, true);
const sphinxPrompt = { code: SPHINX, mask: POS.FU_ATK | POS.FU_DEF };

// --- Sphinx blind-spot fix
{
  const v = view('gg', (x) => { x.zones[1].mzone[2] = cell(EIDOS, true); }); // an 800 ATK body up
  const mem = Engine.makeBotMemory();
  ok(posOf(positionAnswer(sphinxPrompt, v, data, mem)) === POS.FU_ATK,
     'sphinx stands vs a beatable body (was: always DEF on own stats)');
}
{
  // Their strongest (2800) outpowers Sphinx ATK but is walled by DEF:
  // the wall stays, even with a beatable 1500 next to it.
  const v = view('monarch', (x) => {
    x.zones[1].mzone[1] = cell(23064604, true);  // Erebus 2800 ATK
    x.zones[1].mzone[3] = cell(EIDOS, true);     // a beatable 800 beside it
  });
  const mem = Engine.makeBotMemory();
  ok(posOf(positionAnswer(sphinxPrompt, v, data, mem)) === POS.FU_DEF,
     'sphinx walls when their strongest (2800) beats ATK but not DEF');
}
{
  const v = view('gg', () => {});
  const mem = Engine.makeBotMemory();
  ok(posOf(positionAnswer(sphinxPrompt, v, data, mem)) === POS.FU_ATK,
     'sphinx attacks into an empty opposing field (round-13 rule intact)');
}

// --- oppPublicInfo: public accounting only
{
  const v = view('monarch', (x) => { x.grave[1] = [STORMFORTH]; x.removed[1] = [PRIME]; });
  const info = oppPublicInfo(v, data);
  ok(info.left(STORMFORTH) === 2 && info.seenN(STORMFORTH) === 1, 'public info: Stormforth 1 seen, 2 unseen');
  ok(info.left(PRIME) === 2 && info.seenN(PRIME) === 1, 'public info: Prime Monarch 1 seen (banished), 2 unseen');
}

// --- themeForecast: signal-gated
{
  const bare = view('monarch', (x) => { x.hand[1] = [{ code: 1 }, { code: 2 }, { code: 3 }]; });
  ok(themeForecast(bare, data) === null, 'forecast: no visible resource signal -> null (fallback)');
  const loaded = view('monarch', (x) => {
    x.zones[1].mzone[2] = cell(IDEA, false);       // vassal standing
    x.hand[1] = [{ code: 1 }, { code: 2 }];
  });
  const fc = themeForecast(loaded, data);
  ok(fc && fc.nextAtk === 2800 && fc.theme === 'monarch', 'forecast: vassal up + hand -> monarch 2800');
  const custom = view('monarch', (x) => { x.oppDeck = { main: [4, 5, 6], extra: [] }; });
  ok(themeForecast(custom, data) === null, 'forecast: unidentified deck -> null');
}

// --- themeGraveBonus
{
  const v = view('monarch', () => {});
  ok(themeGraveBonus(v, data, PRIME) === 900, 'grave bonus: Prime Monarch is a sleeping body (900)');
  ok(themeGraveBonus(v, data, PANTHEISM) === 500, 'grave bonus: Monarch S/T are grave resources (500)');
  const one = view('gg', (x) => { x.grave[1] = [SANGA]; });
  ok(themeGraveBonus(one, data, SANGA) === 600, 'grave bonus: last GG piece in grave carries Dark Element (600)');
  const two = view('gg', (x) => { x.grave[1] = [SANGA, KAZEJIN]; });
  ok(themeGraveBonus(two, data, SANGA) === 0, 'grave bonus: not the last piece -> 0');
}

// --- position forecast: caution only, premise-breaking excluded
{
  // Signal from the stocked graveyard (no vassal standing); the
  // beatable target (a 2400 Monarch) is not part of the premise, so
  // the forecast may wall Sphinx (2500/3000 walls the forecast 2800).
  const v = view('monarch', (x) => {
    x.grave[1] = [PRIME, PANTHEISM, 33609262];            // grave stock signal
    x.hand[1] = [{ code: 1 }, { code: 2 }, { code: 3 }];
    x.zones[1].mzone[2] = cell(EIDOLON, true);            // 2400 ATK up, beatable
  });
  const mem = Engine.makeBotMemory();
  const p = posOf(positionAnswer(sphinxPrompt, v, data, mem));
  ok(p === POS.FU_DEF && mem.r15Log.some(e => e.kind === 'position'),
     'forecast walls Sphinx vs stocked monarch grave, and the change is logged');
}
{
  // Same forecast, but the beatable target IS the standing vassal
  // (the premise itself): breaking it wins over walling.
  const v = view('monarch', (x) => {
    x.zones[1].mzone[2] = cell(IDEA, false);              // Idea DEF 1000: beatable by 2500
    x.hand[1] = [{ code: 1 }, { code: 2 }];
  });
  const mem = Engine.makeBotMemory();
  const p = posOf(positionAnswer(sphinxPrompt, v, data, mem));
  ok(p === POS.FU_ATK && !mem.r15Log.some(e => e.kind === 'position'),
     'forecast does not wall when the body can destroy the premise (vassal)');
}
{
  // No forecast (bare board): base judgement untouched.
  const v = view('monarch', (x) => { x.zones[1].mzone[2] = cell(EIDOS, true); });
  const mem = Engine.makeBotMemory();
  ok(posOf(positionAnswer(sphinxPrompt, v, data, mem)) === POS.FU_ATK && mem.r15Log.length === 0,
     'no signal -> no forecast, no log, base judgement');
}

console.log(failures ? ('FAILURES: ' + failures) : 'ALL PASS');
process.exit(failures ? 1 : 0);
