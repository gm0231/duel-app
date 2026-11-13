'use strict';
/* test-layoutfix3.js — layout-fix round 3 contracts (K1..K5),
 * written against the parent's published-build re-verification
 * (K1-K3) and two direct user instructions from real play (K4, K5).
 *
 * K1 (the Xyz material sheet lied about the count): the core's
 *     SELECT_UNSELECT_CARD prompts for a material choice carry
 *     per-step toggle bounds (min=max=1 for a 2-material summon),
 *     and the sheet printed them as the requirement. Fix: the
 *     driver decodes the command-prompt special-summon pick; for
 *     a core-declared Xyz material selection (hint 513) with no
 *     chain context it attaches prompt.materialFor {code, min,
 *     max} parsed from the picked monster's printed material
 *     line, and the sheet's count line names the monster, the
 *     requirement and the remainder. Measured scope (30 bot
 *     duels, 263 unselect prompts): hint 513 = 22 — 16 procedure
 *     steps (this fix) + 6 Magnacarrier effect steps whose
 *     min/max are already the true 3〜3 (context-gated out,
 *     untouched); every other hint family untouched.
 * K2 (the band's event line lost its tail): #logline carried a
 *     two-line -webkit-line-clamp — long lines (subject + long
 *     name + verb) were cut at the band's bottom edge, and the
 *     round-2 rectangular measurement could not see it (a
 *     clamped span has no box). Fix: no clamp anywhere; the
 *     renderer shrinks the whole line (fitLogline, floor 10px)
 *     to the two-line budget, and if it still needs a third line
 *     the band grows and layoutFit absorbs the new height.
 *     Geometry is asserted in the Chrome rig (cap-layoutfix3.js)
 *     with REAL event strings; here: source pins.
 * K3 (history named the wrong Xyz host): the mirror resolved an
 *     Extra-Deck host through its extra LIST order at the core's
 *     seq — the orders differ, so Castel's materials were logged
 *     as 《宵闇のルーチェ》's. The material MOVEs are applied
 *     BEFORE the host's SPSUMMONING announcement (measured), so
 *     the fix registers those lines as pending and rewrites them
 *     with the announced code when SPSUMMONING lands. Asserted
 *     below on REAL summons of two different Xyz monsters
 *     (Baromett and Castel).
 * K4 (selection candidates were walls of text — user decision
 *     replacing the round-1/2 full-text-inline policy): grid and
 *     unselect tiles carry NO effect text (art, name, marks,
 *     stats, location, 詳細 only; uniform tiles); the full text
 *     lives in the detail modal. Dock candidates keep the full
 *     effect body, but inside a fixed-height region with its
 *     own scroll.
 * K5 (floating notices cover EVERY card movement — user
 *     decision): one grouped notice per (seat, from, to) per
 *     batch naming every moved card; attack declarations name
 *     attacker and target; a settings toggle (default ON,
 *     persisted with the other FX settings) silences them.
 *     Asserted on synthetic state pairs through the real
 *     window.__fx.process pipeline (the test-fx method), plus a
 *     live-duel tally in the Chrome rig.
 */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
const engineSrc = fs.readFileSync(path.join(V2, 'engine.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const name = (c) => data.names[c];

// ---------- source pins ----------
{
  ok(engineSrc.includes('function xyzMaterialReq(code, data)') && engineSrc.includes('prompt.materialFor = { code: pick, min: req.min, max: req.max }') &&
     engineSrc.includes("prompt.selectHint === 513 && !prompt.context") && engineSrc.includes('xyzPick[prompt.player]'),
    'LF3-K1a: the driver attaches materialFor only to context-free hint-513 unselect prompts, from the decoded spsummon pick');
  ok(clientSrc.includes('const mf = prompt.materialFor;') && clientSrc.includes('のエクシーズ素材 ') && clientSrc.includes("'、あと ' + (mf.min - selCount) + ' 枚'"),
    'LF3-K1b: the unselect sheet renders the material requirement + remainder when materialFor is attached');
  ok(!/#logline\{[^}]*line-clamp/.test(html) && !clientSrc.includes('function fitLogline') &&
     clientSrc.includes('lastBandH') && clientSrc.includes('layoutFit(false); } catch (e) {}'),
    'LF3-K2a: BU-73 successor — no line-clamp on #logline and the whole-line shrink (fitLogline) is abolished; header growth re-enters layoutFit');
  // LF3-K3a SUPERSEDED by layout-fix4 L2 (see test-layoutfix4.js
  // LF4-L2a): the round-3 contract pushed the material line at MOVE
  // time and rewrote it in place at SPSUMMONING — the rewrite broke
  // the client's value-keyed capture alignment (whole-stream
  // duplicates) and snapshots between the batches captured the
  // wrong host. The successor contract HOLDS the line and pushes it
  // at the announcement with the true name; nothing is ever
  // rewritten in place.
  ok(engineSrc.includes('this.pendingMatLines.push({ con: matPending.con, who: matPending.who, nm: matPending.nm, cid, sol })') &&
     !engineSrc.includes('pm.e.s =') && engineSrc.includes("(this.cardData[zc].type & 0x800000)"),
    'LF3-K3a: Extra-host material lines are HELD at MOVE time and pushed at the Xyz announcement with the announced name (layout-fix4 L2 successor; no in-place rewrite)');
  ok(!clientSrc.includes('class="itext"') && html.includes('grid-auto-rows:1fr') &&
     /\.cand \.fxline\{[^}]*max-height:97px[^}]*overflow-y:auto/.test(html),
    'LF3-K4a: no inline effect text on candidate tiles; uniform grid rows; the dock effect body lives in a fixed-height scrolling region');
  ok(clientSrc.includes("notice: true") && clientSrc.includes("if (typeof savedFx.notice === 'boolean') fxSettings.notice = savedFx.notice") &&
     clientSrc.includes("if (!fxSettings.notice) { fxRecord('noticesuppressed', { text }); return; }") &&
     clientSrc.includes('function fxEmitMoveNotes(notes, evs)') && html.includes('id="seg-notice"') && clientSrc.includes('fxseg-notice') &&
     engineSrc.includes('target: tz ? tz.code : null'),
    'LF3-K5a: the notice setting (default on, persisted), the fxNotice gate, the grouped move emission, both settings UIs, and the attack target on the engine event');
}

// ---------- K1: the printed-requirement parser over the whole pool ----------
{
  const xyz = Object.values(data.cards).filter(c => (c.type & 0x800000));
  let allParsed = xyz.length === 10;
  for (const c of xyz) { const r = Engine.xyzMaterialReq(c.code, data); if (!r || typeof r.min !== 'number') allParsed = false; }
  ok(allParsed, 'LF3-K1c: xyzMaterialReq parses all 10 Xyz monsters in the pool');
  const b = Engine.xyzMaterialReq(62967433, data), ca = Engine.xyzMaterialReq(82633039, data), mg = Engine.xyzMaterialReq(84025439, data);
  ok(b && b.min === 2 && b.max === null, 'LF3-K1d: Baromett 「×２体以上」 -> min 2, no upper bound');
  ok(ca && ca.min === 2 && ca.max === 2, 'LF3-K1e: Castel 「×２」 -> exactly 2');
  ok(mg && mg.min === 3 && mg.max === 3, 'LF3-K1f: Great Magnus 「×３」 -> exactly 3');
}

function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; } return a; } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}

// The round-2 scripted seat, parameterised by the Xyz target:
// rush two Level-4s (Keldo/Mudra hand effects, Zolga), pick the
// target from the Extra, toggle through the material prompts.
function scriptedHuman(TARGET, capture) {
  const { i32resp, cancelResp, cardsResp, cmdResp, placeResp, sortResp, unselectToggleResp, POS, LOC } = Engine;
  const KELDO = 63542003, ZOLGA = 31525442, MUDRA = 99937011, KERBEK = 25926710;
  let prompts = 0;
  return (prompt, state) => {
    if (++prompts > 4000) throw new Error('budget');
    switch (prompt.name) {
      case 'SELECT_IDLECMD': {
        const bi = prompt.spsummon.findIndex(e => e.code === TARGET);
        if (bi >= 0) return cmdResp(1, bi);
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
        if (prompt.cancelable && prompt.min === 0) return cardsResp([]);
        const picks = [];
        const order = prompt.cards.map((c, i) => i).sort((a, b2) => {
          const rank = (c) => c.code === KERBEK ? 0 : c.code === ZOLGA ? 1 : 2;
          return rank(prompt.cards[a]) - rank(prompt.cards[b2]);
        });
        for (const i of order) { if (picks.length >= Math.max(1, prompt.min)) break; picks.push(i); }
        return cardsResp(picks);
      }
      case 'SELECT_UNSELECT_CARD': {
        capture.push(JSON.parse(JSON.stringify(prompt)));
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
  const captured = {};
  // ---------- K1 + K3 on real summons of two different Xyz ----------
  for (const [key, TARGET] of [['baromett', 62967433], ['castel', 82633039]]) {
    installSeededCrypto(1 * 2654435761 % 4294967296);
    const main = [];
    for (let i = 0; i < 10; i++) main.push(63542003, 31525442, 99937011, 25926710);
    const unsel = [];
    let summoned = false;
    const duel = new Engine.Duel(M, data, {
      seed: 1, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
      deckP0: { name: 'lf3-xyz', main, extra: [TARGET], side: [] }, deckP1: data.decks.gg, humanTeam: 0, onLog: () => {},
      onMessage: (m) => { if (m && m[0] === 62) { const r = new Engine.Reader(m, 1); const code = r.u32(); const con = r.u8(); if (code === TARGET && con === 0) summoned = true; } },
      humanAnswerer: async (p, s) => scriptedHuman(TARGET, unsel)(p, s),
      botAnswerer: (p, s) => Engine.botAnswer(p, s, data, Engine.makeBotMemory()),
    });
    await duel.run();
    captured[key] = unsel;
    const matSteps = unsel.filter(p => p.selectHint === 513);
    ok(summoned && matSteps.length >= 2, 'LF3-K1g-' + key + ': the scripted duel really summons ' + name(TARGET) + ' (material steps: ' + matSteps.length + ')');
    ok(matSteps.every(p => p.materialFor && p.materialFor.code === TARGET && p.materialFor.min === 2),
      'LF3-K1h-' + key + ': every material step carries materialFor for the picked monster with min 2');
    ok(matSteps.every(p => key === 'baromett' ? p.materialFor.max === null : p.materialFor.max === 2),
      'LF3-K1i-' + key + ': the upper bound matches the printed line (' + (key === 'baromett' ? '以上 = open' : 'exactly 2') + ')');
    ok(unsel.every(p => p.selectHint === 513 || !p.materialFor),
      'LF3-K1j-' + key + ': materialFor never appears on a non-513 prompt');
    // K3: the detailed history's material lines name the summoned host
    const matLines = duel.state.dlog.filter(e => typeof e.s === 'string' && e.s.includes('エクシーズ素材になった'));
    ok(matLines.length >= 2 && matLines.every(e => e.s.includes('《' + name(TARGET) + '》')),
      'LF3-K3b-' + key + ': all ' + matLines.length + ' material history lines name 《' + name(TARGET) + '》 (K3, real summon)');
  }

  // ---------- K1 scope control: bot corpus (Magnacarrier keeps its true 3; context never gains materialFor) ----------
  {
    const decks = Object.keys(data.decks);
    let ctxPrompts = 0, ctx513 = 0, proc513 = 0, leaks = 0;
    for (let i = 0; i < decks.length; i++) for (let j = 0; j < decks.length; j++) {
      if (i === j) continue;
      installSeededCrypto((777 + i * 31 + j * 7) * 2654435761 % 4294967296);
      const mems = [Engine.makeBotMemory(), Engine.makeBotMemory()];
      const wrap = (seat) => (prompt, state) => {
        if (prompt.name === 'SELECT_UNSELECT_CARD') {
          if (prompt.context) { ctxPrompts++; if (prompt.materialFor) leaks++; if (prompt.selectHint === 513) { ctx513++; if (prompt.min !== 3) leaks++; } }
          else if (prompt.selectHint === 513 && prompt.materialFor) proc513++;
          else if (prompt.selectHint === 513 && !prompt.materialFor) leaks++;
        }
        return Engine.botAnswer(prompt, state, data, mems[seat]);
      };
      const duel = new Engine.Duel(M, data, {
        seed: 777 + i * 31 + j * 7, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
        deckP0: data.decks[decks[i]], deckP1: data.decks[decks[j]], humanTeam: 0, onLog: () => {},
        humanAnswerer: async (p, s) => wrap(0)(p, s), botAnswerer: (p, s) => wrap(1)(p, s),
      });
      await duel.run();
    }
    console.log('  [info] corpus unselect: context=' + ctxPrompts + ' (513: ' + ctx513 + '), procedure 513 with materialFor=' + proc513 + ', leaks=' + leaks);
    ok(ctx513 >= 1, 'LF3-K1k: the corpus really contains Magnacarrier-class effect material prompts (context + hint 513)');
    ok(proc513 >= 1, 'LF3-K1l: the corpus really contains procedure material prompts carrying materialFor');
    ok(leaks === 0, 'LF3-K1m: no context prompt ever gains materialFor, every context 513 keeps its true min=3, every procedure 513 gains materialFor');
  }

  // ---------------------------------------------------------- jsdom
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH) — render parts skipped'); }
  if (JSDOM) {
    const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
    const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
    const { window } = dom;
    window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
    const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
    const fxmap = JSON.parse(fs.readFileSync(path.join(V2, 'fxmap.json'), 'utf8'));
    window.fetch = async (url) => {
      if (String(url).includes('ocgcore.wasm')) return { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf };
      // the real fxmap.json for its own URL (the test-clarity
      // discipline): effect identification only exists when
      // FXMAP loads, exactly as in production.
      if (String(url).includes('fxmap.json')) return { ok: true, status: 200, json: async () => fxmap, arrayBuffer: async () => wasmBuf };
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
    ok(window.document.getElementById('loadmsg').textContent.includes('準備完了'), 'LF3-C0: client boots');
    const doc = window.document;
    const subText = () => (doc.querySelector('#sheet .sub') || {}).textContent || '';

    // ---- K1 renders: the REAL captured material prompts ----
    const bA = captured.baromett.find(p => p.unselect.length === 0);
    const cB = captured.castel.find(p => p.unselect.length === 1);
    ok(!!bA && !!cB, 'LF3-K1n: both material steps were captured for rendering (A: fresh, B: one picked)');
    if (bA) {
      window.__unselect.open(JSON.parse(JSON.stringify(bA)));
      ok(subText().includes('《神羊樹バロメット》のエクシーズ素材 2 枚以上') && subText().includes('現在 0 枚選択中') && subText().includes('あと 2 枚') && !subText().includes('1〜1'),
        'LF3-K1o: Baromett step A reads the true requirement (2+, 0 picked, 2 to go) — no 1〜1 anywhere');
      ok(!doc.querySelector('#sheet .itext'), 'LF3-K4b: the material sheet tiles carry no inline effect text (K4)');
    }
    if (cB) {
      window.__unselect.open(JSON.parse(JSON.stringify(cB)));
      ok(subText().includes('《鳥銃士カステル》のエクシーズ素材 2 枚') && subText().includes('現在 1 枚選択中') && subText().includes('あと 1 枚'),
        'LF3-K1p: Castel step B reads exactly-2 with 1 picked and 1 to go');
    }
    { // control: the round-2 fixture WITHOUT materialFor renders exactly as before
      const legacy = { name: 'SELECT_UNSELECT_CARD', player: 0, finishable: false, cancelable: true, min: 1, max: 1,
        select: [{ code: 63542003, con: 0, loc: 4, seq: 0, pos: 1 }, { code: 63542003, con: 0, loc: 4, seq: 1, pos: 1 }],
        unselect: [], selectHint: 513, retryCount: 0 };
      window.__unselect.open(JSON.parse(JSON.stringify(legacy)));
      ok(subText().includes('1〜1 枚（現在 0 枚選択中）'),
        'LF3-K1q: without materialFor the count line is byte-identical to the old rendering (other uses untouched)');
    }

    // ---- K4 renders: a many-candidate selection sheet + the detail modal ----
    {
      const graveCards = [99937011, 86605515, 46148485, 15079028, 25926710, 31525442].map(code => ({ code, con: 0, loc: 16, seq: 0, pos: 1 }));
      window.__select.open({ name: 'SELECT_CARD', player: 0, min: 1, max: 3, cancelable: true, cards: graveCards, context: null, selectHint: 506, retryCount: 0 });
      const tiles = doc.querySelectorAll('#sheet .gcard');
      ok(tiles.length === 6, 'LF3-K4c: the salvage sheet renders all 6 candidates');
      ok(!doc.querySelector('#sheet .itext'), 'LF3-K4d: no tile carries an .itext wall (K4)');
      const tail = (data.texts[99937011].text || '').slice(-24);
      ok(![...tiles].some(t => t.textContent.includes(tail)), 'LF3-K4e: no tile text contains the effect body tail');
      ok([...tiles].every(t => t.querySelector('.gdetail') && t.querySelector('.nmtext')), 'LF3-K4f: every tile keeps name + 詳細 button');
      doc.querySelector('#sheet [data-gdetail="0"]').click();
      const pop = doc.getElementById('infopop');
      ok(!!pop && pop.classList.contains('on') && pop.textContent.includes(tail),
        'LF3-K4g: 詳細 opens the modal with the FULL effect text (tail included)');
      doc.getElementById('infopop-close').click();
    }
    // ---- K4 dock: a long-effect candidate keeps its whole body in the fixed region ----
    {
      // probe (the test-clarity method): find a pool effect whose
      // body is long, via the client's own entryEffect.
      const probe = window.eval(`(() => {
        const cands = [99937011, 63542003, 25926710];
        for (const code of cands) for (let idx = 0; idx < 3; idx++) {
          const e = { code, con: 0, loc: 16, seq: 0, desc: code * 1048576 + idx };
          const fx = entryEffect(e, 'chain');
          if (fx && fx.body && fx.body.length > 28) return { code, idx, body: fx.body };
        }
        return null;
      })()`);
      ok(!!probe, 'LF3-K4h: probe found a long-effect candidate for the dock');
      if (probe) {
        const chainFx = { name: 'SELECT_CHAIN', player: 0, forced: false,
          entries: [{ code: probe.code, con: 0, loc: 16, seq: 0, desc: probe.code * 1048576 + probe.idx, mode: 0 }],
          context: null, trigger: { kind: 'phase', code: 0, con: 0, turn: 1, phase: 'MAIN1' }, retryCount: 0 };
        const chainState = { players: [{}, {}], chain: [{ code: 63542003, con: 1, loc: 4, seq: 0, desc: 0 }], turnCount: 1, turnPlayer: 1, phaseName: 'MAIN1', log: [] };
        window.__chain.open(chainFx, chainState);
        doc.querySelector('#chaintray .ct-yes').click(); // BU-74: the dock is the tray's second stage
        const fx = doc.querySelector('#dock .cand .fxline');
        ok(!!fx, 'LF3-K4i: the dock candidate renders its effect line');
        if (fx) {
          const cs = window.getComputedStyle(fx);
          ok(cs.maxHeight === '97px' && cs.overflowY === 'auto',
            'LF3-K4j: the effect region is fixed-height with its own scroll (max-height ' + cs.maxHeight + ', overflow-y ' + cs.overflowY + ')');
          ok(fx.textContent.replace(/\s+/g, ' ').includes(probe.body.replace(/\s+/g, ' ')),
            'LF3-K4k: the region carries the FULL body (' + fx.textContent.length + ' chars), not an excerpt');
        }
        ok(!!doc.getElementById('chain-pass'), 'LF3-K4l: パス stays rendered beside the region (buttons always visible)');
      }
    }

    // ---- K5: synthetic movement scenarios through the real fx pipeline ----
    {
      const F = window.__fx;
      const P = (over) => Object.assign({ mzone: [null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 40, lp: 8000 }, over || {});
      const S = (p0, p1) => ({ players: [p0, p1 || P()], chain: [], turnCount: 1, turnPlayer: 0, phaseName: 'MAIN1', solvingLink: 0, winner: null });
      const MON = (code, mats) => ({ code, pos: 1, materials: mats || 0, curAtk: 1500, curDef: 1500 });
      const run = (s0, evs, s1) => { F.reset(); F.process([], s0); const at = F.log.length; F.process(evs || [], s1); return F.log.slice(at); };
      const notes = (recs, from, to) => recs.filter(r => r.kind === 'movenote' && r.from === from && r.to === to);

      // mill: 3 cards deck -> grave in one batch = ONE grouped notice naming all three
      let recs = run(S(P()), [], S(P({ grave: [99937011, 86605515, 46148485], deckCount: 37 })));
      let g = notes(recs, 'deck', 'grave');
      ok(g.length === 1 && g[0].text.includes('《剣神官ムドラ》') && g[0].text.includes('《賢瑞官カルダーン》') && g[0].text.includes('《転輪のスフィンクス》') && g[0].text.includes('墓地へ送られた'),
        'LF3-K5b: a 3-card mill is ONE notice naming all three cards');
      ok(recs.some(r => r.kind === 'notice' && r.text === g[0].text), 'LF3-K5c: the grouped mill notice is actually presented (notice record)');
      // search: deck -> hand names the card
      recs = run(S(P()), [], S(P({ hand: [{ code: 15079028 }], deckCount: 39 })));
      g = notes(recs, 'deck', 'hand');
      ok(g.length === 1 && g[0].text.includes('《地久神－カルボン》') && g[0].text.includes('手札に加わった'), 'LF3-K5d: a search (deck->hand) names the card');
      // discard: hand -> grave
      recs = run(S(P({ hand: [{ code: 99937011 }] })), [], S(P({ grave: [99937011] })));
      g = notes(recs, 'hand', 'grave');
      ok(g.length === 1 && g[0].text.includes('《剣神官ムドラ》'), 'LF3-K5e: a discard (hand->grave) names the card');
      // banish from the field
      recs = run(S(P({ mzone: [MON(86605515), null, null, null, null] })), [], S(P({ removed: [86605515] })));
      g = notes(recs, 'field', 'removed');
      ok(g.length === 1 && g[0].text.includes('《賢瑞官カルダーン》') && g[0].text.includes('除外された'), 'LF3-K5f: a field banish names the card');
      // bounce of an opponent monster
      recs = run(S(P(), P({ mzone: [MON(86605515), null, null, null, null] })), [], S(P(), P({ hand: [{ code: null }] })));
      g = notes(recs, 'field', 'hand');
      ok(g.length === 1 && g[0].text.includes('相手の') && g[0].text.includes('《賢瑞官カルダーン》') && g[0].text.includes('手札に戻った'), 'LF3-K5g: an opponent bounce names the card and the seat');
      // detach: an Xyz material leaves for the graveyard
      recs = run(S(P({ mzone: [MON(82633039, 2), null, null, null, null] })), [], S(P({ mzone: [MON(82633039, 1), null, null, null, null], grave: [99937011] })));
      g = notes(recs, 'overlay', 'grave');
      ok(g.length === 1 && g[0].text.includes('《剣神官ムドラ》'), 'LF3-K5h: a detached material reaching the graveyard is named');
      // grouping cap: 5 milled cards still make ONE notice (4 names + ほか1種)
      recs = run(S(P()), [], S(P({ grave: [99937011, 86605515, 46148485, 15079028, 25926710], deckCount: 35 })));
      g = notes(recs, 'deck', 'grave');
      ok(g.length === 1 && g[0].text.includes('ほか1種'), 'LF3-K5i: five simultaneous moves stay one grouped notice (4 names + ほか1種)');
      // banish from the deck with a same-batch return to the deck:
      // the per-card residual claims only the NET deck drop (2 of
      // 3); the masked remainder is COUNTED (moveleft), never
      // guessed at — and the whole batch must process without an
      // fx error (an earlier attribution attempt threw inside
      // fxProcessInner on this shape and aborted the batch:
      // test-fx FXL live-duel attribution)
      recs = run(S(P(), P({ grave: [99937011] })), [], S(P(), P({ removed: [25955164, 98434877, 62340868], deckCount: 38 })));
      g = notes(recs, 'deck', 'removed');
      ok(g.length === 1 && g[0].text.includes('《雷魔神－サンガ》') && g[0].text.includes('《水魔神－スーガ》') && g[0].text.includes('除外された'),
        'LF3-K5n: a deck banish names the cards the residual can pin down, even in a masked batch');
      ok(F.error === null, 'LF3-K5o: the masked-banish batch runs without an fx error (got: ' + F.error + ')');
      ok(recs.filter(r => r.kind === 'moveleft').length === 1, 'LF3-K5p: the one masked card is counted as moveleft, not silently dropped');
      // attack declarations: with a target, and direct
      recs = run(S(P()), [{ kind: 'attack', code: 86605515, con: 1, direct: false, target: 99937011 }], S(P()));
      ok(recs.some(r => r.kind === 'notice' && r.text === '相手の《賢瑞官カルダーン》が《剣神官ムドラ》に攻撃'), 'LF3-K5j: an attack declaration names attacker and target');
      recs = run(S(P()), [{ kind: 'attack', code: 86605515, con: 0, direct: true, target: null }], S(P()));
      ok(recs.some(r => r.kind === 'notice' && r.text === '《賢瑞官カルダーン》が直接攻撃'), 'LF3-K5k: a direct attack reads as such');
      // the setting: off silences, on restores
      F.settings.notice = false;
      recs = run(S(P()), [], S(P({ grave: [99937011], deckCount: 39 })));
      ok(!recs.some(r => r.kind === 'notice') && recs.some(r => r.kind === 'noticesuppressed'), 'LF3-K5l: with the setting OFF no notice is presented (suppressions recorded)');
      F.settings.notice = true;
      recs = run(S(P()), [], S(P({ grave: [99937011], deckCount: 39 })));
      ok(recs.some(r => r.kind === 'notice'), 'LF3-K5m: with the setting back ON notices return');
    }
    window.close();
  }

  console.log(failures ? ('\n' + failures + ' FAILURES') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
