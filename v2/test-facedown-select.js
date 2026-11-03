'use strict';
/* test-facedown-select.js — regression for the face-down selection
 * leak (user report 2026-11-04: in an effect's target-selection
 * screen, the opponent's face-down set cards showed their names and
 * art and could be picked while seeing what they were).
 *
 * Root cause: the core writes real card codes into SELECT_* messages
 * unconditionally (playerop.cpp), the bot path masked them before
 * evaluation (maskEntry / botView), but the HUMAN path handed the
 * raw prompt to the UI, and every selection surface rendered
 * whatever code it found (gridSheet / uiUnselect names, art, stats,
 * full text, 詳細 popups).
 *
 * Contract pinned here, two layers:
 *  A/B (engine): Duel.run delivers human prompts through
 *      maskPromptForHuman — a candidate pointing at a card the human
 *      may not see (opponent hand / deck, opponent face-down field
 *      or Extra card) arrives with code === null, while con / loc /
 *      seq / pos survive (slot + position are public). Own cards,
 *      public cards and the 墓穴の道連れ hand reveal keep their
 *      codes. Answers are index-based, so a masked candidate stays
 *      selectable and the duel plays out identically.
 *  C (client, jsdom): the selection grid renders a hidden candidate
 *      as the card back with a public-only label — no name, no art,
 *      no stats, no text, no 詳細 button — and does so even for a
 *      synthetic prompt that still carries the real code (the
 *      render-side twin of the engine rule).
 *
 * Method: A = direct pins on Engine.maskPromptForHuman.
 * B = two rigged real duels vs the production core/data (Book of
 * Taiyou targeting the CPU's set monster; Hand Destruction's
 * revealed-hand choice). Non-vacuity gates fail the test if the
 * scenarios never occur. C = the real client booted in jsdom,
 * sheets opened through the __select / __unselect test surfaces. */
const fs = require('fs');
const path = require('path');

const V2 = __dirname;
const Engine = require(path.join(V2, 'engine.js'));
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const { LOC, POS_FACEUP } = Engine;

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const TAIYOU = 38699854, WORM = 2694423, MUDORA = 99937011, HORUS = 36898537, HD = 16435215;

// ---------------------------------------------------------------- A
{
  const st = { players: [{ mzone: Array(7).fill(null), szone: Array(8).fill(null) },
                         { mzone: Array(7).fill(null), szone: Array(8).fill(null) }] };
  st.players[1].mzone[0] = { code: MUDORA, pos: 0x1 }; // opponent face-up ATK
  st.players[1].mzone[1] = { code: WORM, pos: 0x8 };   // opponent face-down DEF
  const p = { name: 'SELECT_CARD', player: 0, context: null, cards: [
    { code: WORM, con: 1, loc: LOC.MZONE, seq: 1, pos: 0x8 },   // opp face-down monster
    { code: MUDORA, con: 1, loc: LOC.MZONE, seq: 0, pos: 0x1 }, // opp face-up monster
    { code: HD, con: 1, loc: LOC.SZONE, seq: 0, pos: 0xa },     // opp set S/T
    { code: WORM, con: 0, loc: LOC.MZONE, seq: 0, pos: 0x8 },   // own face-down monster
    { code: MUDORA, con: 1, loc: LOC.HAND, seq: 0, pos: 0xa },  // opp hand
    { code: MUDORA, con: 1, loc: LOC.GRAVE, seq: 0, pos: 0x1 }, // opp grave (public)
    { code: HORUS, con: 1, loc: LOC.EXTRA, seq: 0, pos: 0x8 },  // opp Extra, face-down
    { code: HORUS, con: 1, loc: LOC.EXTRA, seq: 1, pos: 0x5 },  // opp Extra, face-up
  ] };
  const m = Engine.maskPromptForHuman(p, st);
  ok(m.cards.map(c => c.code).join(',') === [null, MUDORA, null, WORM, null, MUDORA, null, HORUS].join(','),
    'A1: mask matrix — opp face-down field/set/hand/Extra lose codes; face-up, grave, own face-down keep them');
  ok(m.cards[0].con === 1 && m.cards[0].loc === LOC.MZONE && m.cards[0].seq === 1 && m.cards[0].pos === 0x8,
    'A2: masked entry keeps con/loc/seq/pos (slot and position are public)');
  ok(p.cards[0].code === WORM, 'A3: masking copies — the stored prompt stays pristine (retry path)');

  const hd = { name: 'SELECT_CARD', player: 0, context: { code: HD }, cards: [
    { code: MUDORA, con: 1, loc: LOC.HAND, seq: 0, pos: 0xa }] };
  ok(Engine.maskPromptForHuman(hd, st).cards[0].code === MUDORA,
    'A4: 墓穴の道連れ context — the effect itself revealed the hand, codes stay');

  const trib = { name: 'SELECT_TRIBUTE', player: 0, context: null, cards: [
    { code: MUDORA, con: 1, loc: LOC.MZONE, seq: 0, pos: 0 },  // wire carries no pos; mirror says face-up
    { code: WORM, con: 1, loc: LOC.MZONE, seq: 1, pos: 0 }] }; // mirror says face-down
  const mt = Engine.maskPromptForHuman(trib, st);
  ok(mt.cards[0].code === MUDORA && mt.cards[1].code === null,
    'A5: position-less entries (SELECT_TRIBUTE) recover pos from the mirror before the face-down test');
}

// ------------------------------------------------------------- B rig
const LIST_FIELDS = ['cards', 'select', 'unselect', 'must', 'entries', 'summon', 'spsummon', 'repos', 'mset', 'sset', 'activate', 'attack'];
function scanPrompt(prompt) {
  // returns a list of leak descriptions for one delivered human prompt
  const leaks = [];
  const ctxHD = prompt.context && prompt.context.code === HD;
  for (const k of LIST_FIELDS) {
    if (!Array.isArray(prompt[k])) continue;
    for (const e of prompt[k]) {
      if (!e || e.con !== 1 || e.code == null) continue;
      if (ctxHD) continue;
      if (e.loc === LOC.HAND || e.loc === LOC.DECK) leaks.push(k + ':opp-hidden-pile:' + e.code);
      if ((e.loc === LOC.MZONE || e.loc === LOC.SZONE || e.loc === LOC.EXTRA) && e.pos != null && !(e.pos & POS_FACEUP))
        leaks.push(k + ':opp-facedown:' + e.code);
    }
  }
  return leaks;
}

async function riggedDuel(M, opts) {
  const duel = new Engine.Duel(M, data, Object.assign({
    pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), maxSteps: 6000,
  }, opts));
  const stats = await duel.run();
  return { duel, stats };
}

(async () => {
  const factory = require(path.join(V2, 'build', 'ocgcore.js'));
  const M = await factory();

  // ---- B1: Book of Taiyou vs the CPU's set monster ----
  {
    const humanMem = Engine.makeBotMemory(), cpuMem = Engine.makeBotMemory();
    const leaks = [];
    let sawTaiyouOppFD = false, ownHandKept = false, chosenSeq = -1, flippedAfter = false, promptsAfterChoice = 0;
    const oppHasFD = (state) => state.players[1].mzone.some(c => c && !(c.pos & POS_FACEUP));
    const humanAnswerer = async (prompt, state) => {
      leaks.push(...scanPrompt(prompt));
      if (chosenSeq >= 0 && promptsAfterChoice < 3) {
        promptsAfterChoice++;
        const cell = state.players[1].mzone[chosenSeq];
        if (cell && (cell.pos & POS_FACEUP)) flippedAfter = true;
      }
      if (prompt.name === 'SELECT_CARD') {
        for (const c of prompt.cards) if (c.con === 0 && c.loc === LOC.HAND && c.code != null) ownHandKept = true;
        const idx = prompt.cards.findIndex(c => c.con === 1 && c.loc === LOC.MZONE && c.pos != null && !(c.pos & POS_FACEUP));
        if (prompt.context && prompt.context.code === TAIYOU && idx >= 0) {
          sawTaiyouOppFD = true; chosenSeq = prompt.cards[idx].seq;
          return Engine.cardsResp([idx]);
        }
        return Engine.cardsResp(prompt.cards.map((_, i) => i).slice(0, Math.max(1, prompt.min)));
      }
      if (prompt.name === 'SELECT_IDLECMD') {
        const ai = (prompt.activate || []).findIndex(a => a.code === TAIYOU);
        if (ai >= 0 && oppHasFD(state)) return Engine.cmdResp(5, ai);
        if (prompt.toEP) return Engine.cmdResp(7, 0);
        if (prompt.toBP) return Engine.cmdResp(6, 0);
        return Engine.cmdResp(7, 0);
      }
      if (prompt.name === 'SELECT_BATTLECMD') { if (prompt.toEP) return Engine.cmdResp(3, 0); if (prompt.toM2) return Engine.cmdResp(2, 0); return Engine.cmdResp(3, 0); }
      if (prompt.name === 'SELECT_CHAIN') return Engine.i32resp(prompt.forced ? 0 : -1);
      if (prompt.name === 'SELECT_POSITION') return Engine.i32resp([1, 4, 2, 8].find(x => prompt.mask & x));
      if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return Engine.i32resp(0);
      return Engine.botAnswer(prompt, state, data, humanMem);
    };
    const cpuAnswerer = (prompt, state, d, mem) => {
      if (prompt.name === 'SELECT_IDLECMD') {
        if (prompt.mset && prompt.mset.length) return Engine.cmdResp(3, 0);
        if (prompt.toEP) return Engine.cmdResp(7, 0);
        if (prompt.toBP) return Engine.cmdResp(6, 0);
        return Engine.cmdResp(7, 0);
      }
      if (prompt.name === 'SELECT_BATTLECMD') { if (prompt.toEP) return Engine.cmdResp(3, 0); if (prompt.toM2) return Engine.cmdResp(2, 0); return Engine.cmdResp(3, 0); }
      if (prompt.name === 'SELECT_CHAIN') return Engine.i32resp(prompt.forced ? 0 : -1);
      if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return Engine.i32resp(0);
      return Engine.botAnswer(prompt, state, data, cpuMem);
    };
    await riggedDuel(M, {
      seed: 42,
      deckP0: { main: [...Array(20).fill(TAIYOU), ...Array(20).fill(WORM)], extra: [] },
      deckP1: { main: Array(40).fill(WORM), extra: [] },
      humanTeam: 0, humanAnswerer, botAnswerer: cpuAnswerer,
    });
    ok(sawTaiyouOppFD, 'B1: non-vacuity — Taiyou target selection offered the CPU face-down monster');
    ok(leaks.length === 0, 'B2: no human prompt in the Taiyou duel leaked a hidden identity' + (leaks.length ? ' — ' + leaks.slice(0, 3).join('; ') : ''));
    ok(flippedAfter, 'B3: the masked candidate stayed selectable — Taiyou flipped the chosen set monster face-up');
    ok(ownHandKept, 'B4: own hand candidates kept their codes in the same duel (no over-masking)');
  }

  // ---- B2: Hand Destruction's revealed-hand choice ----
  {
    const humanMem = Engine.makeBotMemory();
    const leaks = [];
    let sawHD = false, hdCodesVisible = false;
    const humanAnswerer = async (prompt, state) => {
      leaks.push(...scanPrompt(prompt));
      if (prompt.name === 'SELECT_CARD') {
        const idx = prompt.cards.findIndex(c => c.con === 1 && c.loc === LOC.HAND);
        if (prompt.context && prompt.context.code === HD && idx >= 0) {
          sawHD = true;
          if (prompt.cards[idx].code != null) hdCodesVisible = true;
          return Engine.cardsResp([idx]);
        }
        return Engine.cardsResp(prompt.cards.map((_, i) => i).slice(0, Math.max(1, prompt.min)));
      }
      if (prompt.name === 'SELECT_IDLECMD') {
        const ai = (prompt.activate || []).findIndex(a => a.code === HD);
        if (ai >= 0) return Engine.cmdResp(5, ai);
        if (prompt.toEP) return Engine.cmdResp(7, 0);
        if (prompt.toBP) return Engine.cmdResp(6, 0);
        return Engine.cmdResp(7, 0);
      }
      if (prompt.name === 'SELECT_BATTLECMD') { if (prompt.toEP) return Engine.cmdResp(3, 0); if (prompt.toM2) return Engine.cmdResp(2, 0); return Engine.cmdResp(3, 0); }
      if (prompt.name === 'SELECT_CHAIN') return Engine.i32resp(prompt.forced ? 0 : -1);
      if (prompt.name === 'SELECT_POSITION') return Engine.i32resp([1, 4, 2, 8].find(x => prompt.mask & x));
      if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return Engine.i32resp(0);
      return Engine.botAnswer(prompt, state, data, humanMem);
    };
    await riggedDuel(M, {
      seed: 7,
      deckP0: { main: [...Array(20).fill(HD), ...Array(20).fill(WORM)], extra: [] },
      deckP1: { main: Array(40).fill(WORM), extra: [] },
      humanTeam: 0, humanAnswerer,
    });
    ok(sawHD, 'B5: non-vacuity — Hand Destruction asked the human to pick from the CPU hand');
    ok(hdCodesVisible, 'B6: the revealed hand stays visible for the choice (legal reveal, not masked)');
    ok(leaks.length === 0, 'B7: no human prompt in the Hand Destruction duel leaked a hidden identity' + (leaks.length ? ' — ' + leaks.slice(0, 3).join('; ') : ''));
  }

  // ---------------------------------------------------------- C jsdom
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH) — engine parts A/B already ran'); }
  if (JSDOM) {
    const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
    const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
    const backRule = (html.match(/\.gcard\.back\{[^}]*\}/) || [''])[0];
    ok(backRule.includes("url('../assets/card-back-s.jpg')"), 'C0: .gcard.back paints the user card-back image');

    const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
    const { window } = dom;
    window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
    const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
    window.fetch = async (url) => {
      if (String(url).includes('ocgcore.wasm')) return { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf };
      return { ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf };
    };
    const inject = (file) => {
      const s = window.document.createElement('script');
      s.textContent = fs.readFileSync(path.join(V2, file), 'utf8');
      window.document.body.appendChild(s);
    };
    inject('build/ocgcore.js');
    const origFactory = window.OcgCoreModule;
    window.OcgCoreModule = (opts) => origFactory(Object.assign({}, opts, { wasmBinary }));
    inject('engine.js');
    inject('duel-worker.js');
    inject('client.js');
    for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
      await new Promise(r => setTimeout(r, 50));
    ok(window.document.getElementById('loadmsg').textContent.includes('準備完了'), 'C1: client boots');

    const gridOf = () => [...window.document.querySelectorAll('#sheet .gcard')];

    // C2: the engine-delivered (masked) shape
    window.__select.open({ name: 'SELECT_CARD', player: 0, cancelable: true, min: 1, max: 1, context: null, cards: [
      { code: null, con: 1, loc: LOC.MZONE, seq: 2, pos: 0x8 },
      { code: WORM, con: 0, loc: LOC.HAND, seq: 0, pos: 0xa },
      { code: MUDORA, con: 1, loc: LOC.MZONE, seq: 0, pos: 0x1 },
    ] });
    let cells = gridOf();
    ok(cells.length === 3, 'C2: grid renders all three candidates');
    ok(cells[0].classList.contains('back') && cells[0].textContent.includes('裏側のモンスター（守備表示）') &&
       cells[0].textContent.includes('相手のモンスターゾーン3') && !cells[0].querySelector('[data-gdetail]'),
      'C3: masked candidate = card back + public label (slot, defense), no detail button');
    ok(cells[1].textContent.includes('メデューサ・ワーム') && !cells[1].classList.contains('back'),
      'C4: own hand candidate still shows its name');
    ok(cells[2].textContent.includes('剣神官ムドラ') && !cells[2].classList.contains('back'),
      'C5: opponent FACE-UP candidate still shows its name (public info untouched)');
    cells[0].click();
    const tray = window.document.getElementById('tray');
    ok(!!tray && tray.textContent.includes('裏側のモンスター') && !tray.textContent.includes('メデューサ'),
      'C6: selecting the hidden candidate puts a generic chip in the tray, never a name');

    // C3: a prompt that still carries the real code (render-side twin)
    window.__select.open({ name: 'SELECT_CARD', player: 0, cancelable: true, min: 1, max: 1, context: null, cards: [
      { code: WORM, con: 1, loc: LOC.MZONE, seq: 1, pos: 0x8 },
    ] });
    cells = gridOf();
    ok(cells.length === 1 && cells[0].classList.contains('back') && !cells[0].textContent.includes('メデューサ') &&
       !cells[0].querySelector('[data-gdetail]') && !(cells[0].getAttribute('style') || '').includes('card-art'),
      'C7: even with a real code present, the grid masks an opponent face-down candidate (no name/art/detail)');

    // C4: Hand Destruction context at the render layer
    window.__select.open({ name: 'SELECT_CARD', player: 0, cancelable: false, min: 1, max: 1,
      context: { code: HD, con: 0, loc: LOC.HAND, seq: 0 }, cards: [
      { code: MUDORA, con: 1, loc: LOC.HAND, seq: 1, pos: 0xa },
    ] });
    cells = gridOf();
    ok(cells.length === 1 && !cells[0].classList.contains('back') && cells[0].textContent.includes('剣神官ムドラ'),
      'C8: Hand Destruction context — revealed opponent hand candidate renders its name');

    // C5: the unselect grid obeys the same rule
    window.__unselect.open({ name: 'SELECT_UNSELECT_CARD', player: 0, finishable: true, cancelable: true, min: 1, max: 1,
      context: null, select: [{ code: null, con: 1, loc: LOC.SZONE, seq: 0, pos: 0x8 }], unselect: [] });
    cells = gridOf();
    ok(cells.length === 1 && cells[0].classList.contains('back') && cells[0].textContent.includes('裏側のカード') &&
       !cells[0].querySelector('[data-uinfo]'),
      'C9: unselect grid — masked set S/T renders as the card back, no info button');
    window.close();
  }

  console.log(failures === 0 ? 'ALL FACEDOWN-SELECT CHECKS PASSED' : failures + ' FACEDOWN-SELECT CHECK(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
