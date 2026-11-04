'use strict';
/* test-hintpurpose.js — select-purpose line pins (user instruction
 * 2026-11-05: an effect's card selection must say, in plain words,
 * what the selection is for — for every card).
 *
 * A (engine, real core): the driver carries the core's own
 *    declaration into the prompt. Before a scripted selection the
 *    effect script calls Duel.Hint(HINT_SELECTMSG, player, value)
 *    (MSG_HINT subtype 3); GameState.apply drops MSG_HINT, so
 *    Duel.run taps it and attaches the value as prompt.selectHint,
 *    consumed on ANY prompt dispatch for that player (a hint must
 *    never leak across an intervening decision). This part
 *    recomputes the expected value from the RAW message stream
 *    with an independent simulation and demands equality on every
 *    prompt of four full duels, retries included (a retried prompt
 *    keeps its original hint).
 * B (engine): Engine.parseHint byte layout.
 * C (client, jsdom): the selection sheets render the purpose line
 *    from prompt.selectHint (grid sheet + unselect sheet), render
 *    nothing for an unprovable hint, and suppress the line where
 *    the title already states the purpose (tribute). */
const fs = require('fs');
const path = require('path');

const V2 = __dirname;
const Engine = require(path.join(V2, 'engine.js'));
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const { LOC } = Engine;

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

// ---------------------------------------------------------------- B
{
  const h = Engine.parseHint(new Uint8Array([2, 3, 1, 0xf5, 0x01, 0x00, 0x00]));
  ok(h && h.sub === 3 && h.player === 1 && h.value === 501, 'B1: parseHint decodes sub/player/value');
  const ev = Engine.parseHint(new Uint8Array([2, 1, 0, 0x10, 0x00, 0x00, 0x00]));
  ok(ev && ev.sub === 1 && ev.value === 16, 'B2: non-select hint subtypes still parse (the driver filters)');
  ok(Engine.parseHint(new Uint8Array([15, 3, 1, 0, 0, 0, 0])) === null, 'B3: non-HINT message -> null');
  ok(Engine.parseHint(new Uint8Array([2, 3])) === null && Engine.parseHint(null) === null, 'B4: short/absent message -> null');
}

// ---------------------------------------------------------------- A
async function plumbingDuel(M, deckP0, deckP1, seed, acc) {
  // independent expectation: track raw MSG_HINT bytes, per player,
  // clear on that player's prompt dispatch.
  const pending = [null, null];
  const firstByRawKey = new Map();
  const onMessage = (m) => {
    if (m[0] === 2 && m[1] === 3) {
      pending[m[2]] = (m[3] | (m[4] << 8) | (m[5] << 16) | (m[6] << 24)) >>> 0;
    }
  };
  const mem = Engine.makeBotMemory();
  const check = (prompt) => {
    acc.prompts++;
    if (prompt.retryCount > 0) {
      if (prompt.selectHint !== firstByRawKey.get(prompt.rawKey)) acc.mismatch++;
      return;
    }
    const expected = pending[prompt.player];
    pending[prompt.player] = null;
    firstByRawKey.set(prompt.rawKey, prompt.selectHint);
    if (prompt.selectHint !== expected) {
      acc.mismatch++;
      if (acc.mismatch <= 3) console.log('  mismatch on', prompt.name, 'got', prompt.selectHint, 'expected', expected);
    }
    if (['SELECT_CARD', 'SELECT_TRIBUTE', 'SELECT_SUM', 'SELECT_UNSELECT_CARD', 'SELECT_COUNTER'].includes(prompt.name)) {
      acc.cardSelects++;
      if (prompt.selectHint != null) acc.withHint++;
    }
  };
  const duel = new Engine.Duel(M, data, {
    seed, pace: { bot: 0, botChain: 0, batch: 0 }, deckP0, deckP1,
    onMessage, sleep: () => Promise.resolve(),
    humanAnswerer: async (p, s) => { check(p); return Engine.botAnswer(p, s, data, mem); },
    botAnswerer: (p, s, d) => { check(p); return Engine.botAnswer(p, s, d, mem); },
  });
  await duel.run();
}

(async () => {
  const factory = require(path.join(V2, 'build', 'ocgcore.js'));
  const M = await factory();
  const acc = { prompts: 0, cardSelects: 0, withHint: 0, mismatch: 0 };
  await plumbingDuel(M, data.decks.ishizu, data.decks.gg, 11, acc);
  await plumbingDuel(M, data.decks.gg, data.decks.ishizu, 222, acc);
  await plumbingDuel(M, data.decks.ishizu, data.decks.ishizu, 3333, acc);
  await plumbingDuel(M, data.decks.gg, data.decks.gg, 44444, acc);
  console.log('  prompts=' + acc.prompts + ' cardSelects=' + acc.cardSelects + ' withHint=' + acc.withHint + ' mismatch=' + acc.mismatch);
  ok(acc.mismatch === 0, 'A1: every prompt carries exactly the hint the raw stream implies (consume-on-dispatch)');
  ok(acc.cardSelects >= 80, 'A2: non-vacuity — card-select prompts observed (' + acc.cardSelects + ')');
  ok(acc.withHint >= acc.cardSelects * 0.9, 'A3: >=90% of card-select prompts arrive with their declared hint (' + acc.withHint + '/' + acc.cardSelects + ')');

  // ------------------------------------------------------------ C
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH) — engine parts A/B already ran'); }
  if (JSDOM) {
    const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
    const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
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

    const MUDORA = 99937011, WORM = 2694423;
    const purposeOf = () => window.document.querySelector('#sheet .purpose');
    const graveCard = { code: MUDORA, con: 0, loc: LOC.GRAVE, seq: 0, pos: 0x1 };

    window.__select.open({ name: 'SELECT_CARD', player: 0, cancelable: true, min: 1, max: 1, selectHint: 509,
      context: { code: 83764718, con: 0, loc: LOC.HAND, seq: 0 }, cards: [graveCard] });
    ok(!!purposeOf() && purposeOf().textContent === '特殊召喚するカードを選択', 'C2: grid sheet shows the SPSUMMON purpose line');
    const ctxEl = window.document.querySelector('#sheet .ctx');
    ok(!!ctxEl && ctxEl.textContent.includes('死者蘇生'), 'C3: the effect context line still renders beside it (not replaced)');

    window.__select.open({ name: 'SELECT_CARD', player: 0, cancelable: true, min: 1, max: 1, context: null, selectHint: 560, cards: [graveCard] });
    ok(!purposeOf(), 'C4: generic HINTMSG_SELECT -> no purpose line (no guessing)');

    window.__select.open({ name: 'SELECT_CARD', player: 0, cancelable: true, min: 1, max: 1, context: null, cards: [graveCard] });
    ok(!purposeOf(), 'C5: no hint at all -> no purpose line, sheet unchanged');

    window.__select.open({ name: 'SELECT_CARD', player: 0, cancelable: true, min: 1, max: 1, context: null, selectHint: 14087893, cards: [graveCard] });
    ok(!purposeOf(), 'C6: card-code hint (card-specific string) -> no purpose line');

    window.__select.open({ name: 'SELECT_TRIBUTE', player: 0, cancelable: false, min: 1, max: 1, context: null, selectHint: 500,
      cards: [{ code: WORM, con: 0, loc: LOC.MZONE, seq: 0, pos: 0x1, releaseParam: 1 }] });
    ok(!purposeOf() && window.document.querySelector('#sheet .ttl').textContent === 'リリースするカード',
      'C7: tribute — the title already states the purpose, the line is not duplicated');

    window.__unselect.open({ name: 'SELECT_UNSELECT_CARD', player: 0, finishable: true, cancelable: true, min: 1, max: 1, context: null, selectHint: 511,
      select: [graveCard], unselect: [] });
    ok(!!purposeOf() && purposeOf().textContent === '融合素材にするカードを選択', 'C8: unselect sheet shows the FMATERIAL purpose line');
    window.close();
  }

  console.log(failures === 0 ? 'ALL HINT-PURPOSE CHECKS PASSED' : failures + ' HINT-PURPOSE CHECK(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
